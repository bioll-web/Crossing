---
title: "head.s：跳入 C 语言前的最后一跃"
weight: 3
---
 
# head.s：跳入 C 语言前的最后一跃
 
> 📖 **本节版本说明**
>
> 本文使用 **Linux 0.11** 的 `boot/head.s` 源码进行分析（约 244 行）。0.01 不含独立引导程序，所以本节借用 0.11，与前两篇 `bootsect.s`、`setup.s` 同源。
>
> 源码出处：[karottc/linux-0.11/boot/head.s](https://github.com/karottc/linux-0.11/blob/master/boot/head.s)
 
上一篇 `setup.s` 用 `lmsw ax` + `jmpi 0,8` 把 CPU 推进了保护模式，CPU 现在跑在物理地址 `0x0` 处——而 head.s 正是这个位置的第一个字节。
 
这是引导阶段的**终章**：再有 244 行汇编，CPU 就要跨过最后一道门，进入 C 语言的世界（`main.c`）。再之后所有事都是 C 写的，汇编只在中断处理、上下文切换这些底层工种里继续干活。
 
但这 244 行不是过场——**它干了整个引导过程里最关键也最反直觉的几件事**：
 
1. **重新加载段寄存器**——因为 setup.s 留下的是临时 GDT，head.s 要建立"正式版"
2. **自检 A20 是否真的开了**——一个 4 行汇编的"信任但验证"循环
3. **重建 IDT 和 GDT**——这次是面向内核长期使用的版本
4. **建立分页机制**——把虚拟地址映射到物理地址，4MB 页表 + 页目录
5. **跳进 main.c**——boot 阶段正式终结
最反直觉的一点：**head.s 自己最后会被覆盖**。它在 `0x0` 执行，但执行完后，那块内存会被改写成"页目录表"——head.s 的代码字节亲手写出了将要覆盖自己的页表数据。这是引导代码独有的"用完即焚"美学。
 
这篇文章会做这几件事：
 
1. 讲清楚**分页机制**——这是 head.s 后半段的灵魂，也是 80386 区别于 80286 的核心创新
2. 把 head.s 的 244 行**逐段拆开**，每段都贴关键代码 + 中文逐行注释
3. 讲清楚 head.s 是怎么"自我覆盖"还能正常工作的
4. 回答开头三个"关键点自问"
---
 
## 一、为什么需要分页？
 
setup.s 已经给了我们分段保护——为什么还要分页？
 
### 1.1 分段不够用
 
分段解决了"内存保护 + 多进程隔离"，但有几个问题：
 
**问题 1：内存碎片**
 
每个段是一段连续的物理内存。进程 A 要 10MB，进程 B 要 8MB，进程 C 要 5MB——**它们的物理位置必须连续**。久而久之，进程频繁加载卸载，物理内存会变成一堆"不连续的小空隙"——明明加起来够用，但找不到一个 10MB 的连续块给新进程。这是经典的**外部碎片**问题。
 
**问题 2：物理内存不够时无解**
 
进程总和超过物理内存了怎么办？分段下没有合理办法——总不能把一个 10MB 的段"暂时换出到硬盘"。段的粒度太大了。
 
### 1.2 分页解决方案
 
分页把内存切成**固定大小（4KB）的小页**，**虚拟地址**和**物理地址**通过一张"页表"映射：
 
```
进程看到的：虚拟地址 0x08048000   ← 进程"以为"自己住在这里
              ↓
              页表查找
              ↓
实际存在：物理地址 0x00234000     ← 实际物理内存
```
 
这样一来：
 
- **物理内存可以不连续**：虚拟地址连续，但每个 4KB 页可以映射到任意物理位置 → 没有外部碎片
- **物理内存不够时可换出**：把不常用的页写到硬盘（swap），需要时再换回 → 这就是虚拟内存
- **进程隔离更彻底**：每个进程一张自己的页表，看到的虚拟地址空间是独立的 → 进程 A 改自己 `0x08048000` 不会影响进程 B 的 `0x08048000`
📖 **概念：4KB 页是怎么定的**
 
80386 把页固定为 **4KB**。为什么是这个值？
 
- **太小**：页表条目暴增。如果页是 1KB，4GB 地址空间需要 4M 个条目，每个 4 字节，光页表就 16MB
- **太大**：浪费严重。如果页是 1MB，分配 5KB 内存就要占一整页 1MB
- **4KB**：页表条目数 1M 个，开销可控；页内浪费平均 2KB，可接受
后来 Intel 加了 4MB 大页（PSE）和 2MB 大页（PAE）作为可选项，但默认值至今还是 4KB——这个数字定下来 40 年没变过。
 
### 1.3 80386 的分页结构：两级页表
 
80386 的分页机制非常精巧，用**两级查表**完成 32 位地址翻译：
 
```
32 位虚拟地址被切成三段：
┌─────────────┬─────────────┬──────────────┐
│   高 10 位  │   中 10 位  │   低 12 位   │
│  页目录索引 │   页表索引  │  页内偏移    │
└─────────────┴─────────────┴──────────────┘
     PDE 索引       PTE 索引       Offset
 
转换流程：
1. CR3 寄存器 → 指向页目录的物理地址
2. 用高 10 位 → 在页目录里找到一个 PDE（4 字节）
3. PDE 指向一张页表的物理地址
4. 用中 10 位 → 在那张页表里找到一个 PTE（4 字节）
5. PTE 指向目标页的物理地址
6. 加上低 12 位偏移 → 最终物理地址
```
 
为什么不用一级页表？因为一张完整的 4GB 页表要 4MB 内存——而很多进程根本用不到这么多虚拟地址空间。**两级**让你**按需分配**：进程只用了 8MB 虚拟地址，就只需要 2 个 PDE 指向的两张页表，每张 4KB，总共 12KB 页相关内存。
 
head.s 后半段就是在**亲手建立**这两层结构。
 
### 1.4 head.s 的分页设计：恒等映射
 
📖 **概念：恒等映射（Identity Mapping）**
 
head.s 建立的页表非常简单：**虚拟地址 N 映射到物理地址 N**。也就是 `0x00000000` → `0x00000000`，`0x00000001` → `0x00000001`，依此类推。这叫**恒等映射**。
 
为什么用这种"看起来没意义"的映射？
 
- **保证启动后代码继续能跑**：`head.s` 自己的代码、刚搬过来的 system 都在低物理内存。如果开启分页时虚拟地址和物理地址不一致，下一条指令的地址翻译会失败，CPU 直接崩
- **简化心智模型**：内核启动早期，代码访问的就是物理地址。恒等映射让"分段后线性地址 = 物理地址 = 虚拟地址"三者相等，不用想脑子里多一层映射
后来 main.c 跑起来，内核会给用户进程建立**真正的虚拟地址映射**（每个进程一套）。但 head.s 自己只用恒等映射，够用就行。
 
head.s 给前 16MB 物理内存建立恒等映射，需要：
 
- 1 个**页目录**（page directory）：占 4KB，里面有 1024 个 PDE
- 4 张**页表**（page table）：每张 4KB，每张管 1024 × 4KB = 4MB；4 张共 16MB
总共 5 张表，5 × 4KB = 20KB。它们将放在物理地址 `0x0` ~ `0x4FFF`。**而 head.s 自己也住在这块**——这就是"自我覆盖"的来源，等会儿细看。
 
---
 
## 二、head.s 一句话总结
 
> head.s 接手 setup.s 留下的保护模式环境，用一段 32 位汇编代码：重新加载段寄存器、验证 A20、清空临时 IDT/GDT 并重建正式版、为前 16MB 内存建立恒等映射页表、置位 `CR0.PG` 启用分页、最后用一条 `ret` 把控制权"伪装成函数返回"地交给 `main()`。
 
整个过程是从 32 位汇编世界过渡到 32 位 C 世界的最后一跃。
 
---
 
## 三、源码逐段拆解
 
### 3.1 文件头部：标号声明与"自我覆盖"宣言
 
```asm
/*
 *  linux/boot/head.s
 *
 *  (C) 1991  Linus Torvalds
 */
 
/*
 *  head.s contains the 32-bit startup code.
 *
 * NOTE!!! Startup happens at absolute address 0x00000000, which is also where
 * the page directory will exist. The startup code will be overwritten by
 * the page directory.
 */
.text
.globl idt,gdt,pg_dir,tmp_floppy_area
pg_dir:                     ! 页目录的标号 —— 注意它就在文件最开头
.globl startup_32
startup_32:
    movl $0x10,%eax         ! 0x10 = GDT 第 2 项的段选择子（内核数据段）
    mov %ax,%ds
    mov %ax,%es
    mov %ax,%fs
    mov %ax,%gs
    lss stack_start,%esp
```
 
**注意 `pg_dir` 这个标号——它就放在文件最最开始，跟 `startup_32` 同一个地方。**
 
📖 **概念：head.s 的"自我覆盖"宣言**
 
Linus 在文件头注释里说得非常直接：
 
> Startup happens at absolute address 0x00000000, which is also where the page directory will exist. The startup code will be overwritten by the page directory.
 
翻译成中文："启动从绝对地址 `0x00000000` 开始，**这也是页目录将要存在的地方**。启动代码将会被页目录覆盖。"
 
为什么是这种设计？回想一下：
 
- system 整体被搬到了 `0x0`
- head.s 是 system 的开头，所以 head.s 在 `0x0`
- head.s 跑完后变成"垃圾代码"，没人再去执行它
- 反正都是垃圾，那就**让它的内存空间被页目录复用**——4KB 页目录正好放在 `0x0`
更狠的是：**`pg_dir` 标号跟 `startup_32` 标号几乎在同一个位置**。也就是说，head.s 第一条指令的字节，将来会被页目录第 0 项的 4 字节数据覆盖。这是一种**"用完即焚"**的极简主义——不浪费一个字节。
 
### 3.2 重新加载段寄存器
 
```asm
startup_32:
    movl $0x10,%eax         ! eax = 0x10
    mov %ax,%ds             ! ds = 0x10
    mov %ax,%es             ! es = 0x10
    mov %ax,%fs             ! fs = 0x10
    mov %ax,%gs             ! gs = 0x10
    lss stack_start,%esp    ! ss:esp = stack_start 指向的位置
```
 
📖 **概念：为什么 32 位代码用 AT&T 语法**
 
注意这里语法跟 bootsect/setup 不一样了！
 
- bootsect/setup 用的是 **AS86（Intel 风格）**：`mov ax,#0x10`
- head.s 用的是 **GAS（AT&T 风格）**：`movl $0x10,%eax`
主要差别：
- 操作数顺序反过来：源在前、目的在后（GAS）vs 目的在前、源在后（Intel）
- 立即数前加 `$`，寄存器前加 `%`
- 指令名带操作数大小后缀：`movl`（long=32 位）、`movw`（word=16 位）、`movb`（byte=8 位）
head.s 是 **32 位代码**，由 GNU as（GAS）汇编。后面的内核 C 代码也是 GCC 编译，都用 AT&T 语法——所以为了和内核工具链一致，head.s 跟着用 AT&T。这也是 head.s 文件名前面没有 `.s` 用 GAS 编译的暗示。
 
**这段代码在干嘛：**
 
回忆 setup.s 末尾，`jmpi 0,8` 重置了 `cs` 段寄存器为 `8`（GDT 第 1 项=代码段）。但**其他段寄存器（ds、es、fs、gs、ss）还是 setup.s 里赋的实模式段值！**
 
保护模式下，段寄存器装的是段选择子。如果 ds 还是 `0x9020`（实模式段地址），保护模式 CPU 会把它当成"GDT 第 0x9020/8 = 0x1204 项"——这一项压根不存在，下一次访问 ds 段会立刻触发故障。
 
所以 head.s 第一件事：**把所有数据段寄存器都设成 `0x10` = GDT 第 2 项 = 内核数据段**。
 
回忆 setup.s 的 GDT：
 
```
第 0 项: 空描述符
第 1 项: 内核代码段（基址 0，限长 8MB，可读可执行）
第 2 项: 内核数据段（基址 0，限长 8MB，可读可写）
```
 
INDEX = 2 → 段选择子 = 2 × 8 = `0x10`。所以 `mov $0x10,%eax` 然后赋给所有数据段，意思是"用内核数据段作为我们的数据段"。
 
**`lss stack_start,%esp` 是什么？**
 
`lss` = Load SS。这条指令一次性加载 SS 和 ESP：从 `stack_start` 这个内存位置读 6 字节（4 字节 ESP + 2 字节 SS），分别加载到 SS 和 ESP。
 
`stack_start` 在内核 `kernel/sched.c` 里定义，指向一个静态分配的内核栈空间。**从这一行开始，内核有自己专属的栈了**。
 
### 3.3 验证 A20 是否真的开了
 
```asm
    xorl %eax,%eax
1:  incl %eax               ! eax++
    movl %eax,0x000000      ! 把 eax 写到物理地址 0
    cmpl %eax,0x100000      ! 比较物理地址 1MB 处的值是否等于 eax
    je 1b                   ! 相等就回到 1 标号继续循环（死循环）
```
 
这是 head.s 里最妙的一段——**4 行汇编验证 A20 地址线是否真的工作**。
 
📖 **概念：A20 自检的逻辑**
 
回忆 setup.s 第 4.9 节，A20 是 1MB 以上内存能否寻址的关键开关。但 setup.s 只是"发出了开启 A20 的指令"——并没有验证它真的生效了！
 
如果 A20 没开，会怎样？地址会回绕：写 `0x100000` 实际写到 `0x000000`（最高位 A20 被强制为 0）。也就是 `0x000000` 和 `0x100000` 这两个地址会指向**同一块物理内存**。
 
这段代码的逻辑：
 
1. `eax = 0`
2. 循环开始：`eax++`
3. 把 `eax` 写到地址 `0x000000`
4. 读地址 `0x100000` 的值，跟 `eax` 比较
5. 如果**相等** → A20 没开，两个地址是同一块内存 → 跳回循环开头
6. 如果**不等** → A20 开了，两个地址是不同内存 → 跳出循环
**等一下——如果 A20 没开，这段代码会进死循环吗？**
 
是的！而且 Linus 在源码注释里写得很直接：
 
```
# loop forever if it isn't
```
 
（如果 A20 没开，就永远循环。）
 
这是个**故意的死锁**——如果 A20 开启失败，根本就不能继续启动。Linux 在这里彻底放弃，让机器卡在死循环里，要求用户手动重启。这种"出错就停机"是 1991 年内核的常态，没有今天 Linux 那种复杂的错误恢复机制。
 
为什么用"自加 + 比较"而不是写一个固定值？
 
- 如果只写一次固定值（比如 `mov $42, 0x000000`），刚好那块内存原本就是 42 的话，比较会通过，假阳性
- `incl %eax` 让值不停变化，不可能撞上巧合
- 每次循环都验证一次，如果某一刻 A20 真生效（理论上不会，但保险），立刻跳出
### 3.4 重建 IDT 和 GDT
 
```asm
/*
 * NOTE! 508 of these are uninitialized to zero. The first one is initialized
 * but the rest are mostly used as scratch.
 */
    call setup_idt
    call setup_gdt
    movl $0x10,%eax         # reload all the segment registers
    mov %ax,%ds             # after changing gdt. CS was already
    mov %ax,%es             # reloaded in 'setup_gdt'
    mov %ax,%fs
    mov %ax,%gs
    lss stack_start,%esp
```
 
调用两个子程序 `setup_idt` 和 `setup_gdt` 重建中断表和段表，然后**再次重新加载所有段寄存器**——为什么？
 
📖 **概念：为什么段寄存器要重新加载？**
 
x86 段寄存器有"可见部分"和"隐藏部分"：
 
- 可见部分：段选择子（你能看到的 16 位值）
- 隐藏部分：CPU 内部缓存的"该段的描述符内容"（基址、限长、权限）
CPU 加载段选择子的瞬间，会去 GDT 查描述符并**缓存到隐藏部分**。后续访问这个段都用缓存，**不再查 GDT**——这是性能优化。
 
**问题来了**：如果 GDT 内容变了（比如 `setup_gdt` 重建了 GDT），段寄存器里的隐藏缓存还是旧的！必须**重新加载段寄存器**才会刷新缓存。
 
所以这里 `mov %ax,%ds` 看起来是"赋值给同一个值"（之前 ds 也是 0x10），但实际作用是触发 CPU 重新查 GDT、刷新隐藏缓存。
 
`cs` 没在这里重新加载——`setup_gdt` 里通过 `ljmp` 长跳转刷新过了。
 
### 3.5 setup_idt 子程序
 
```asm
/*
 *  setup_idt
 *
 *  sets up a idt with 256 entries pointing to
 *  ignore_int, interrupt gates. It then loads
 *  idt. Everything that wants to install itself
 *  in the idt-table may do so themselves. Interrupts
 *  are enabled elsewhere, when we can be relatively
 *  sure everything is ok. This routine will be over-
 *  written by the page tables.
 */
setup_idt:
    lea ignore_int,%edx     ! edx = ignore_int 函数地址
    movl $0x00080000,%eax   ! eax 高 16 位 = 0x0008（GDT 第 1 项=代码段选择子）
    movw %dx,%ax            ! ax 低 16 位 = ignore_int 地址低 16 位
                            ! 现在 eax = "段选择子=8 + 偏移低 16 位"
    movw $0x8E00,%dx        ! dx 高 16 位 = 0x8E00 = 中断门类型,DPL=0,Present
                            ! 现在 edx = "偏移高 16 位 + 类型/属性字段"
 
    lea idt,%edi            ! edi = idt 表起始地址
    mov $256,%ecx           ! 256 个条目
rp_sidt:
    movl %eax,(%edi)        ! 写低 4 字节
    movl %edx,4(%edi)       ! 写高 4 字节
    addl $8,%edi            ! 下一个条目（每个 8 字节）
    dec %ecx
    jne rp_sidt
 
    lidt idt_descr          ! 加载 IDTR
    ret
```
 
📖 **概念：中断门描述符的 8 字节布局**
 
每个 IDT 条目是 8 字节，结构是：
 
```
低 4 字节：
  bit 0-15:  目标偏移 0-15
  bit 16-31: 段选择子
 
高 4 字节：
  bit 0-7:   保留（必须为 0）
  bit 8-12:  类型（中断门=1110）+ 标志
  bit 13-14: DPL（描述符特权级）
  bit 15:    P（存在位）
  bit 16-31: 目标偏移 16-31
```
 
setup_idt 把 256 个条目**全都填成同一个值**：
 
- 段选择子 = 8（内核代码段）
- 偏移 = `ignore_int` 函数地址
- 类型 = `0x8E00`（中断门，Ring 0，存在）
这意味着任何一个中断或异常发生，都会跳到 `ignore_int` 函数。`ignore_int` 是一个简单的占位函数，往屏幕打印"unknown interrupt"然后返回。后面 main.c 会按需把每个中断号替换成真正的处理函数。
 
**为什么用循环填 256 个相同条目，不直接填一个空表？**
 
因为如果 IDT 里某个条目是"无效"（P=0），CPU 收到对应中断时会触发"段不存在故障"——而处理这个故障又要查 IDT，结果还是无效——循环故障，三重故障，CPU 重启。
 
填上 `ignore_int` 至少**保证有反应**——哪怕反应是"打印一行未知中断"。这是防御性编程的体现。
 
### 3.6 setup_gdt 子程序
 
```asm
/*
 *  setup_gdt
 *
 *  This routines sets up a new gdt and loads it.
 *  Only two entries are currently built, the same
 *  ones that were built in init.s. The routine
 *  is VERY complicated at two whole lines, so this
 *  rather long comment is certainly needed :-).
 *  This routine will beoverwritten by the page tables.
 */
setup_gdt:
    lgdt gdt_descr
    ret
```
 
哈哈，Linus 在注释里自嘲：
 
> The routine is VERY complicated at two whole lines, so this rather long comment is certainly needed :-).
 
（这个函数复杂到有整整两行汇编，所以这么长的注释当然是必要的 :-)。）
 
实际只有一行 `lgdt gdt_descr`——加载新的 GDT 描述符。
 
新 GDT 的内容跟 setup.s 里的临时 GDT **几乎一样**（同样的代码段、数据段），但有一个重要区别：**这张 GDT 在内核数据区里**，不会被后面的页表覆盖；setup.s 那张临时 GDT 在 `0x90200` 段里，会一直留着但不再使用。
 
这一步本质是把"GDT 的所有权"从 setup.s 临时占位转移到 head.s 这边。
 
### 3.7 不再回头的判定：跳到 main 之前的最后准备
 
```asm
/*
 * Jump to the test mark to test if the cs register works
 */
    pushl $0                ! These are the parameters to main :-)
    pushl $0
    pushl $0
    cld                     ! gcc2 wants the direction flag cleared at all times
    call setup_paging       ! 建立分页
    ljmp $0x08,$1f          ! 长跳转，刷新 cs 寄存器
1:  movl $0x10,%eax         ! reload all the segment registers
    mov %ax,%ds             ! after changing gdt.
    mov %ax,%es
    mov %ax,%fs
    mov %ax,%gs
    lss stack_start,%esp
    pushl $L6               ! return address for main
    pushl $_main
    jmp setup_paging
```
 
等一下，这段代码**有点乱**！其实是因为 0.11 源码有几个版本细节不同。让我直接看实际的 head.s 代码逻辑：
 
```asm
    pushl $0                ! main() 的参数 envp = NULL
    pushl $0                ! main() 的参数 argv = NULL
    pushl $0                ! main() 的参数 argc = 0
    pushl $L6               ! main() 的"返回地址"
    pushl $_main            ! main() 函数地址
    jmp setup_paging        ! 跳到 setup_paging，setup_paging 末尾的 ret 会"返回到" _main
```
 
**这段是 head.s 里最聪明的一处 hack。**
 
📖 **概念：用 `ret` 伪装成函数返回，跳进 `main()`**
 
正常调用 main 会写 `call main`。但 head.s 选择了一种**更精巧**的方式：
 
1. 提前把 main() 的参数（3 个 0）压栈——按 C 调用约定从右到左
2. 把"main 返回后该去的地址"（`L6`，一个死循环）压栈——这就是"main 的返回地址"
3. 把 `_main` 函数本身的地址压栈
4. 跳到 `setup_paging` 子程序
5. `setup_paging` 末尾的 `ret` 指令从栈顶弹出 4 字节当返回地址——**弹出的正是 `_main`**！
6. 于是 CPU"返回"到 `_main` 开始执行
这里有几个技巧：
 
- `ret` 不在乎"返回地址"是不是真的返回——它只看栈顶那 4 字节
- 把 `_main` 当返回地址压栈，等于伪装成"原本就是从 main 调用过来的"
- main 真的返回了（实际不会），会执行 L6 那个死循环——内核进入 idle
为什么不直接 `call _main`？因为 `setup_paging` 最后的 `ret` 必须要返回到某个地方——如果用 `call _main`，那 main 如果返回了就回到 head.s 末尾的某条指令上，再执行就不可控了。这个 hack 让"主控制流自然结束在 main 里"，比直接 call 更干净。
 
`L6` 标号在文件末尾：
 
```asm
L6:
    jmp L6                  ! main 永远不该返回，但万一返回了就死循环
```
 
### 3.8 setup_paging 子程序
 
```asm
/*
 * Setup_paging
 *
 * This routine sets up paging by setting the page bit
 * in cr0. The page tables are set up, identity-mapping
 * the first 16Mb. The pager assumes that no illegal
 * addresses are produced (ie >4Mb on a 4Mb machine).
 *
 * NOTE! Although all physical memory should be identity
 * mapped by this routine, only the kernel page functions
 * use the >1Mb addresses directly. All "normal" functions
 * use just the lower 1Mb, or the local data space, which
 * will be mapped to some other place - mm/memory.c takes
 * care of that.
 */
.align 2
setup_paging:
    movl $1024*5,%ecx       ! 5 张表 × 1024 项 = 5120 个 32 位字
    xorl %eax,%eax
    xorl %edi,%edi          ! 从地址 0 开始
    cld;rep;stosl           ! 把 0x0000 ~ 0x4FFF 全部清零
 
    movl $pg0+7,pg_dir      ! 页目录第 0 项 = pg0 地址 + 标志位 7
    movl $pg1+7,pg_dir+4    ! 页目录第 1 项 = pg1 地址 + 7
    movl $pg2+7,pg_dir+8    ! 页目录第 2 项 = pg2 地址 + 7
    movl $pg3+7,pg_dir+12   ! 页目录第 3 项 = pg3 地址 + 7
 
    movl $pg3+4092,%edi     ! edi 指向 pg3 最后一项
    movl $0xfff007,%eax     ! 16Mb-4096 + 7（= 物理地址 0xFFF000 的 PTE）
    std                     ! direction = 1，stosl 后 edi 减 4
1:  stosl                   ! 写 PTE 到 [edi]
    subl $0x1000,%eax       ! eax -= 4096（下一个页帧地址）
    jge 1b                  ! 如果 eax >= 0 继续
 
    cld
    xorl %eax,%eax          ! eax = 0
    movl %eax,%cr3          ! CR3 = 页目录基址 = 0
    movl %cr0,%eax
    orl $0x80000000,%eax    ! 置位 PG（CR0 第 31 位）
    movl %eax,%cr0          ! 启用分页！
    ret                     ! 返回到栈顶——栈顶是 _main
```
 
这段是整个 head.s 的高潮——**手工建立分页表 + 启用分页 + 跳进 C 世界**全在这一段。逐步看：
 
**第 1 步：清空 5 张表的内存空间**
 
```asm
movl $1024*5,%ecx       ! 5120 个 dword
xorl %eax,%eax
xorl %edi,%edi          ! 起点 = 物理地址 0
cld;rep;stosl           ! 写 5120 个 0
```
 
把 `0x0000` ~ `0x4FFF`（20KB）全部清零——这块内存即将放：
 
- `0x0000` ~ `0x0FFF`：页目录（pg_dir）
- `0x1000` ~ `0x1FFF`：页表 0（pg0）
- `0x2000` ~ `0x2FFF`：页表 1（pg1）
- `0x3000` ~ `0x3FFF`：页表 2（pg2）
- `0x4000` ~ `0x4FFF`：页表 3（pg3）
**这 20KB 正好覆盖了 head.s 自己的代码！**——这就是文件头注释说的"startup code will be overwritten by the page directory"。head.s 此刻的指令流水线已经预读了后面要执行的指令到 CPU 内部缓存，所以即使内存被清零，下一条指令照样能执行。这是 CPU 内部缓存（不是 CR0.PG）救了 head.s 的命。
 
**第 2 步：填充页目录**
 
```asm
movl $pg0+7,pg_dir      ! pg_dir[0] = pg0 物理地址 + 7
movl $pg1+7,pg_dir+4    ! pg_dir[1] = pg1 物理地址 + 7
movl $pg2+7,pg_dir+8    ! pg_dir[2] = pg2 物理地址 + 7
movl $pg3+7,pg_dir+12   ! pg_dir[3] = pg3 物理地址 + 7
```
 
📖 **概念：PDE 的 `+7` 是什么？**
 
每个页目录项（PDE）是 4 字节，格式：
 
```
bit 31-12: 页表的物理基址（高 20 位）
bit 11-9:  保留
bit 8:     全局（仅 PSE）
bit 7:     PS（页大小，0=4KB）
bit 6:     脏位
bit 5:     访问位
bit 4:     缓存禁用
bit 3:     直写
bit 2:     U/S（用户/管理员）
bit 1:     R/W（读写）
bit 0:     P（存在）
```
 
`+7` = 二进制 `111`，意思是：
 
- bit 0 = 1 → P=1，本项有效
- bit 1 = 1 → R/W=1，可读可写
- bit 2 = 1 → U/S=1，用户态可访问
也就是把这一项标记为"存在、可读写、用户态可用"，再加上页表的物理地址（页表地址低 12 位为 0，正好和标志位错开互不干扰）。
 
只填了 4 项 PDE，每项指向一张 4MB 页表。**4 张页表 × 4MB = 16MB**——恒等映射的范围。
 
**第 3 步：填充 4 张页表的所有 PTE**
 
```asm
movl $pg3+4092,%edi     ! 从 pg3 最后一项倒着填
movl $0xfff007,%eax     ! 第一个值 = 物理地址 0xFFF000 + 7
std                     ! direction = 1（stosl 后 edi 减 4）
1:  stosl
    subl $0x1000,%eax   ! 下一个值 = 当前 -4KB
    jge 1b              ! 还没到 0 就继续
```
 
**这段在干嘛？**
 
逻辑：从最后一张页表的最后一项开始，**倒着**填所有 PTE。每个 PTE 的值 = "对应物理页帧地址 + 7"。
 
具体计算：
 
- 第一次写：`edi = pg3 + 4092`，写入 `0xfff007`（物理地址 `0xfff000` + 标志 7）
- 第二次写：`edi -= 4`，eax `-= 0x1000`，写入 `0xffe007`（物理地址 `0xffe000` + 标志 7）
- ……
- 最后一次写：`edi = pg0 + 0`，写入 `0x000007`（物理地址 `0x000000` + 标志 7）
总共写 16384 个 PTE（4 张表 × 4096 / 4 = 4096 项每张 × 4 张），覆盖物理地址 `0x0000000` ~ `0xFFFFFF`（前 16MB）。
 
**为什么倒着填？** 因为 `std` + `stosl` 是"写完后 edi 自动减 4"。倒着填的话循环条件 `jge 1b` 用 `eax >= 0` 判断很方便——eax 从 `0xfff007` 一路减到 `0x007`，再减一次就成负数，跳出循环。如果正着填要单独跟踪计数器。这是个汇编风格的小优化。
 
**第 4 步：CR3 + CR0 启用分页**
 
```asm
xorl %eax,%eax
movl %eax,%cr3          ! CR3 = 0（页目录基址）
movl %cr0,%eax
orl $0x80000000,%eax    ! 置位 PG 位（CR0 第 31 位）
movl %eax,%cr0          ! 启用！
ret
```
 
📖 **概念：CR3 和 CR0.PG**
 
- **CR3**：页目录基址寄存器。CPU 拿到一个虚拟地址，要查页目录时，从 CR3 获得页目录的物理地址。这里 `CR3 = 0`，因为页目录就放在物理地址 0。
- **CR0.PG**：分页使能位。置 1 后 CPU 启用分页机制，所有内存访问都要经过页表翻译。
执行 `movl %eax,%cr0` 那一瞬间，**CPU 已经在分页模式了**。下一条指令的 EIP（已经被流水线预读为下一条指令地址）会被当成**虚拟地址**查页表——查出来恰好等于自己（恒等映射），所以 CPU 顺利继续执行。
 
**最后那条 `ret` 是关键的关键。**
 
- `ret` 从栈顶弹出 4 字节作为返回地址
- 栈顶现在是什么？回忆 3.7 节：`pushl $_main` 是最后一个 push
- 所以 `ret` 弹出 `_main` 地址，CPU 跳过去执行
- **从那一刻起，CPU 在执行 C 代码**
引导阶段就此结束。
 
### 3.9 ignore_int：默认中断处理
 
```asm
/* This is the default interrupt "handler" :-) */
int_msg:
    .asciz "Unknown interrupt\n\r"
.align 2
ignore_int:
    cld
    pushl %eax
    pushl %ecx
    pushl %edx
    push %ds
    push %es
    push %fs
    movl $0x10,%eax
    mov %ax,%ds
    mov %ax,%es
    mov %ax,%fs
    pushl $int_msg
    call _printk            ! 调用 C 写的 printk 函数
    popl %eax
    pop %fs
    pop %es
    pop %ds
    popl %edx
    popl %ecx
    popl %eax
    iret
```
 
setup_idt 把所有 256 个中断都指向这里。功能很简单：保存寄存器 → 切换数据段到内核数据段 → 调用 `printk` 打印 "Unknown interrupt" → 恢复寄存器 → `iret` 返回。
 
**注意它调用了 C 函数 `_printk`**——这说明 head.s 已经预设了 C 函数可以被汇编调用。这种汇编/C 互操作要求双方使用相同的调用约定（参数压栈、返回值在 eax 等）。
 
### 3.10 文件末尾：数据区
 
```asm
.align 2
.word 0
idt_descr:
    .word 256*8-1           ! IDT limit = 2047 字节（256 项 × 8 - 1）
    .long idt               ! IDT 基址
 
.align 2
.word 0
gdt_descr:
    .word 256*8-1           ! GDT limit
    .long gdt               ! GDT 基址
 
.align 8
idt:    .fill 256,8,0       ! 256 个 8 字节的 0（IDT 表）
gdt:    .quad 0x0000000000000000    ! NULL 描述符
        .quad 0x00c09a0000000fff    ! 代码段（基址 0，限长 16MB，DPL=0）
        .quad 0x00c0920000000fff    ! 数据段（基址 0，限长 16MB，DPL=0）
        .quad 0x0000000000000000    ! TSS 描述符（暂未填）
        .fill 252,8,0               ! 剩下 252 项保留（main.c 后面会填进程的 LDT/TSS）
```
 
**这个 GDT 比 setup.s 那张更大**——256 项，能容纳：
 
- 第 0 项：NULL（必须）
- 第 1 项：内核代码段
- 第 2 项：内核数据段
- 第 3 项：暂未使用（后来用作系统 TSS）
- 第 4 ~ 255 项：每两项一组，对应一个进程的 LDT + TSS（最多支持 64 个进程）
注意代码段和数据段的限长 `0x000FFF`——粒度位 G=1，所以实际限长 = `0xFFF × 4KB + 4KB - 1` = 16MB - 1。这跟 setup.s 的 8MB 不一样——head.s 把内核可寻址范围扩大到 16MB，匹配它建立的 16MB 恒等映射。
 
---
 
## 四、整体内存布局：head.s 跑前 vs 跑后
 
**head.s 跑前（setup.s 跳过来时）：**
 
```
0x00000  ─┬──────────────────┐
          │ system 起始       │  ← head.s 在这里（CPU 即将执行）
          │ ↓ system 内容     │
0x80000  ─┼──────────────────┤
          │ (空闲)            │
0x90000  ─┼──────────────────┤
          │ bootsect(残留)    │
0x90200  ─┼──────────────────┤
          │ setup.s + 硬件参数 │
0x9XXXX  ─┴──────────────────┘
```
 
**head.s 跑完后（即将进入 main 时）：**
 
```
0x00000  ─┬──────────────────┐
          │ 页目录(pg_dir)    │  ← 覆盖了 head.s 的代码
0x01000  ─┼──────────────────┤
          │ 页表 0 (pg0)      │
0x02000  ─┼──────────────────┤
          │ 页表 1 (pg1)      │
0x03000  ─┼──────────────────┤
          │ 页表 2 (pg2)      │
0x04000  ─┼──────────────────┤
          │ 页表 3 (pg3)      │
0x05000  ─┼──────────────────┤
          │ 内核 main.c 代码   │  ← CPU 即将执行（开启分页后 V=P）
          │ ↓ 内核其他模块    │
          │ ↓ 内核数据 idt/gdt │
0x80000  ─┼──────────────────┤
          │ (空闲，待 mm 管理)  │
0x90000  ─┼──────────────────┤
          │ bootsect(残留)    │
0x90200  ─┼──────────────────┤
          │ setup.s + 硬件参数 │  ← main.c 开始读这里
          │ (硬件参数仍有效)   │
0x9XXXX  ─┴──────────────────┘
```
 
注意几件事：
 
1. **head.s 的代码字节已经被页表数据覆盖**——但因为 CPU 流水线预读 + 当时还没分页查表，最后一条指令 `ret` 还能正确执行
2. **页表建立后，分页机制开启**——但因为是恒等映射，对所有现有代码透明，看起来什么都没变
3. **内核数据（idt、gdt）现在永久在内核数据段里**——main.c 之后的中断处理函数会被注册到这张 idt 里
4. **0x90000 那块硬件参数表还在**——main.c 启动后会立刻读取这些数据来初始化各种硬件驱动
---
 
## 五、回答开篇三个"关键点自问"
 
### 5.1 为什么要恒等映射？
 
短答：**因为 head.s 自己的代码就在低物理内存里执行，开启分页时如果虚拟地址 ≠ 物理地址，下一条指令的取指就找不到。**
 
详细：
 
考虑分页开启的那一瞬间：
 
- 启用前：CPU 用物理地址 EIP 取指令
- 启用后：CPU 把 EIP 当虚拟地址，查页表得物理地址，再取指令
如果 head.s 在物理地址 `0x00005000` 执行，启用分页那一瞬间：
 
- 启用前：下一条指令物理地址 = `0x00005000 + 5 = 0x00005005`，能取到
- 启用后：下一条指令虚拟地址 = `0x00005005`，查页表
  - 如果是恒等映射：查出来物理地址还是 `0x00005005` → 顺利取到
  - 如果是任意映射：查出来可能是 `0x12345678` → 取到的是别的代码 → 崩
**恒等映射是最简单的"启用分页时不让自己崩溃"的方法**。它本质上让分页机制对当前正在跑的代码"透明"，启用前后完全等价。
 
后来 main.c 跑起来给用户进程建立分页时，会用各种**非恒等映射**——这才是分页机制的真正威力。但内核启动早期，恒等映射是必需的安全网。
 
### 5.2 分页开启瞬间，CPU 到底发生了什么？
 
短答：**CPU 在指令边界原子地切换地址翻译方式，分页前 EIP 是物理地址，分页后变虚拟地址。中间没有"半启用"状态。**
 
详细：
 
`movl %eax,%cr0` 执行时（设 PG 位的那条指令）：
 
1. **执行前**（实际上是这条指令的取指阶段已经完成）
   - CPU 从物理地址取出这条指令、解码、执行
2. **执行的瞬间**（写 CR0 的"提交"阶段）
   - CPU 内部状态切换：标记"分页已启用"
   - 页表机制激活：CR3 指向 pg_dir
3. **执行后**（下一条指令的取指）
   - CPU 用 EIP 当虚拟地址查页表
   - 因为恒等映射，查出来的物理地址等于 EIP
   - 取指成功，继续执行
**关键点：CPU 不会处于"PG 半启用"状态**。要么完全用物理地址，要么完全经过页表翻译——这是 Intel 设计保证的。所以开启分页这一行只要前后都"想得通"就不会出问题。
 
实际还有一个微妙点：**TLB（Translation Lookaside Buffer）**。开启分页瞬间 TLB 是空的，CPU 会查页表填 TLB，第一次访问可能慢一点，但功能正确。
 
### 5.3 开启分页前后，`jmp` 指令目标地址的含义有什么变化？
 
短答：**含义没变，但解释机制完全变了——从"直接是物理地址"变成"虚拟地址，需要查页表"。**
 
详细：
 
举例 head.s 末尾那条 `ljmp $0x08,$1f`：
 
**分页开启前**：
- `0x08` 是段选择子，指向 GDT 第 1 项（基址 0，限长 16MB）
- `$1f` 是相对偏移
- 物理地址 = 段基址(0) + 偏移 + 当前段内位置 = 直接是物理地址
**分页开启后**：
- 段选择子和偏移的解释流程**完全没变**
- 段基址(0) + 偏移 = **线性地址**（也叫虚拟地址）
- 这个虚拟地址再去查页表，得到物理地址
- 因为恒等映射，物理地址 = 虚拟地址 = 跟分页前一样的值
**所以代码看起来什么都没变**——这正是恒等映射的目的。同一条 `jmp $1f` 指令，分页前后都能正确跳到同一个物理位置。
 
但**机制上**变了：分页前 CPU 直接用物理地址访问内存；分页后多了一道翻译。这对性能有微小影响（多一次 TLB 查询），但对程序逻辑完全透明。
 
理解这个区别的意义在于：**main.c 之后内核给进程建立非恒等映射时**，同一个虚拟地址（比如 `0x08048000`）在不同进程里指向不同物理位置——分页机制让虚拟地址成了"上下文相关"的。这才是分页设计的本意。
 
---
 
## 六、boot 阶段终章：回顾整个引导流程
 
写到这里，整个 boot 引导阶段就走完了。让我们用一张图回顾这三步发生的事：
 
```
1. 通电（CPU 被动）
   ↓
   CS=0xFFFF, IP=0, 跳到 0xFFFF0
   ↓
   BIOS 启动，自检、初始化
   ↓
   BIOS 读取磁盘第 0 扇区到 0x7C00
   ↓
   跳到 0x7C00 ──────────────────────────────────────┐
                                                    │
2. bootsect.s（512 字节，实模式）─────────────────────┘
   ↓
   把自己从 0x7C00 搬到 0x90000
   ↓
   读 setup（4 扇区）到 0x90200
   ↓
   读 system（240 扇区）到 0x10000
   ↓
   jmpi 0,SETUPSEG
   ↓
   跳到 0x90200 ─────────────────────────────────────┐
                                                    │
3. setup.s（约 380 行汇编，实模式 → 保护模式）─────────┘
   ↓
   BIOS 中断收集硬件参数 → 写到 0x90000
   ↓
   关中断
   ↓
   把 system 从 0x10000 整体搬到 0x0
   ↓
   加载临时 GDT/IDT
   ↓
   开 A20、重映射 8259A
   ↓
   置位 CR0.PE
   ↓
   jmpi 0,8 ←── 这一跳，跨入保护模式
   ↓
   跳到 0x0 ────────────────────────────────────────┐
                                                   │
4. head.s（244 行汇编，保护模式 + 分页）─────────────┘
   ↓
   重新加载段寄存器到正式 GDT
   ↓
   验证 A20 真的开了
   ↓
   重建正式 IDT（256 项全指向 ignore_int）
   ↓
   重建正式 GDT
   ↓
   建立前 16MB 的恒等映射页表
   ↓
   置位 CR0.PG ←── 启用分页
   ↓
   ret ────────────── 弹出栈顶 = _main 地址 ──────────┐
                                                    │
5. main.c（C 语言世界）───────────────────────────────┘
   ↓
   读 0x90000 处的硬件参数
   ↓
   初始化各种内核子系统（mm、fs、kernel）
   ↓
   创建 init 进程
   ↓
   shell 起飞，用户可见
```
 
从按下电源到看到 shell 提示符，CPU 一共穿越了三个世界：
 
- **实模式世界**（bootsect + setup 前半段）：16 位、1MB 内存、BIOS 包打天下
- **保护模式世界**（setup 后半段 + head.s 前半段）：32 位、有段保护、还没分页
- **分页保护模式世界**（head.s 后半段 + main.c 之后）：完整的现代内存模型，从此可以多任务、虚拟内存
每一次跳转都有一段汇编代码精心准备过——这就是引导代码的价值。它不是"什么都没做"——它是把硬件从"刚通电的瞎子"调教到"能跑现代操作系统的状态"。
 
---
 
## 七、本篇小结
 
head.s 是引导代码的**收尾人**——它不再做硬件探测（setup 已经做完）、也不做内核初始化（那是 main.c 的事）。它的全部使命就一件事：**让保护模式下的内核拥有干净、长期的运行环境**。
 
这一篇的关键洞察：
 
1. **head.s 的内存自我覆盖** —— 文件最开头就是 `pg_dir` 标号，说明它的代码会被页目录覆盖。这是引导代码独有的"用完即焚"美学。
2. **A20 自检的死循环设计** —— 4 行汇编验证 setup.s 是否真的开了 A20。如果没开，机器卡死等用户重启——这是 1991 年的"硬错误处理"哲学。
3. **`ret` 伪装成函数返回跳进 main** —— 不直接 `call _main`，而是手工把 `_main` 地址压栈，让 setup_paging 的 `ret` 自然"返回"到 main。这是控制流设计的精巧之处。
4. **恒等映射的必要性** —— 启用分页那一瞬间，下一条指令必须能继续取指。恒等映射保证虚拟地址=物理地址，让切换无缝。
5. **倒着填页表** —— 用 `std` + `stosl` 倒着写，循环条件用 `eax >= 0` 判断更简洁。这是汇编程序员的"代码艺术"。
引导阶段到此结束。下一篇我们会跨进 `main.c`——C 语言世界的入口。boot 阶段的所有铺垫都是为了 main.c 能在一个干净的环境下启动。
 
---
 
## 关键点自问
 
- 为什么要恒等映射？ → [第 5.1 节](#51-为什么要恒等映射)
- 分页开启瞬间，CPU 到底发生了什么？ → [第 5.2 节](#52-分页开启瞬间cpu-到底发生了什么)
- 开启分页前后，`jmp` 指令目标地址的含义有什么变化？ → [第 5.3 节](#53-开启分页前后jmp-指令目标地址的含义有什么变化)
