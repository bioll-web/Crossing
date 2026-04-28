---
title: "setup.s：硬件探测与保护模式切换"
weight: 2
---
 
# setup.s：硬件探测与保护模式切换
 
> 📖 **本节版本说明**
>
> 本文使用 **Linux 0.11** 的 `boot/setup.s` 源码进行分析（约 380 行）。0.01 不含独立引导程序，所以本节借用 0.11，与上一篇 `bootsect.s` 同源。
>
> 源码出处：[karottc/linux-0.11/boot/setup.s](https://github.com/karottc/linux-0.11/blob/master/boot/setup.s)
 
上一篇 `bootsect.s` 把 setup（4 个扇区，2KB）和 system（内核主体，约 196KB）都搬进了内存，最后用 `jmpi 0,SETUPSEG` 把控制权交到了 `0x90200`——这正是 setup.s 的入口。
 
这一跳之后，CPU 还在实模式下跑，但 setup 是 1991 年 Linux 启动里**最重要的一段代码**。它要做两件听上去简单、做起来非常微妙的事：
 
1. 用 BIOS 中断把硬件参数收集起来（内存大小、显卡类型、磁盘几何、键盘类型……），写到 `0x90000` 这一块固定地址，方便后面 C 代码读取
2. **从实模式切换到保护模式**——这一跳横跨 1980 年代到 1990 年代，是整个内核启动里最关键的一行代码
听起来像两件事，其实是同一件事的两面：**硬件参数必须趁现在还能用 BIOS 中断时收集好，因为一旦进了保护模式，BIOS 中断就再也用不了了**。
 
这篇文章会做这几件事：
 
1. 讲清楚**为什么需要保护模式**——它"保护"什么、和实模式差在哪
2. 讲清楚 GDT、IDT、段选择子、`CR0` 这几个概念——这是看懂 setup 后半段的前提
3. 把 setup.s 的源码**逐段拆开**，每段都贴关键代码 + 中文逐行注释
4. 回答开头三个"关键点自问"
---
 
## 一、为什么要切换到保护模式？
 
### 1.1 实模式的限制
 
上一篇我们说过，实模式是 8086 时代的产物。它有几个 1991 年已经无法接受的限制：
 
| 限制 | 实模式 | 后果 |
|---|---|---|
| 寻址范围 | 1MB | 内核大一点就装不下 |
| 内存保护 | 无 | 任何程序都能改任何地址，一个 bug 让整机崩溃 |
| 多任务 | 无 | 没法同时跑两个程序而互不干扰 |
| 特权级 | 无 | 用户程序可以直接执行 `cli` 关中断、读硬件端口 |
| 段长度 | 固定 64KB | 大数组放不下 |
 
到 1985 年的 80386，Intel 引入了**保护模式**（Protected Mode），把上面这些问题全部解决了：
 
- 32 位地址，可以寻址 4GB
- 通过段描述符表 + 页表实现**内存保护**
- 通过 4 个特权级（Ring 0/1/2/3）实现**特权隔离**
- 段长度可以最大 4GB
- 配合 TSS（任务状态段）实现**硬件级多任务**
### 1.2 保护模式"保护"的是什么？
 
短答：**保护进程之间的内存不被互相干扰，保护操作系统内核不被用户程序破坏。**
 
具体机制有三层：
 
1. **分段保护**：每个段都有"基址 + 长度 + 权限"，访问超出长度或权限不够会触发异常（GP 故障）
2. **特权级保护**：内核跑在 Ring 0，用户进程跑在 Ring 3。Ring 3 不能执行特权指令（如 `cli`、`hlt`、`out`），不能访问 Ring 0 的代码/数据
3. **分页保护**（可选，CR0.PG=1 时启用）：每个 4KB 页面都有"读/写/执行"权限位，访问越界 → 缺页异常
setup.s 这一步只开**分段保护**，分页保护要到下一篇 head.s 才开启。
 
### 1.3 切换到保护模式的"标准动作"
 
这是一套被 Intel 手册写死的固定流程，所有 x86 操作系统都得照着做：
 
```
1. 关中断（cli），因为切换过程中状态不一致，不能被中断打断
2. 加载 GDT（全局描述符表），告诉 CPU "段都长什么样"
3. 加载 IDT（中断描述符表），告诉 CPU "中断处理函数在哪"
4. 开启 A20 地址线（让 CPU 能寻址 1MB 以上的内存）
5. 重新映射 8259A 中断控制器（避免硬件 IRQ 和保护模式异常号冲突）
6. 置位 CR0 寄存器的 PE（Protection Enable）位 —— 一行代码完成切换
7. 远跳转一次，刷新 CPU 流水线 —— 必须远跳，近跳不行
```
 
setup.s 严格按这个顺序执行。看完上面这 7 步，再回来看代码就豁然开朗——每一段都对应清单里的一个步骤。
 
---
 
## 二、setup.s 一句话总结
 
> setup.s 用 BIOS 中断把硬件参数（光标位置、内存大小、显卡、磁盘几何、键盘）保存到 `0x90000` 起始的几十字节里；然后把内核主体从 `0x10000` 整体搬到 `0x0`（覆盖原本的 BIOS 中断向量表）；最后加载 GDT/IDT、置位 `CR0.PE`、远跳转到 `0x0`，进入保护模式下的 `head.s`。
 
整个过程仍然在实模式下进行——直到倒数第二行那条 `lmsw ax`。
 
---
 
## 三、必备前置概念
 
看 setup 后半段代码之前，你必须先认识几个保护模式的核心数据结构。**没有这些前置，代码看不懂；有了这些前置，代码非常清晰。**
 
### 3.1 GDT（全局描述符表）
 
📖 **概念：GDT 是什么**
 
实模式下，段寄存器装的是"段地址"，乘 16 就是物理基址。保护模式下完全变了——段寄存器装的不是地址，而是一个**"索引号"**，指向 GDT 表里的一个条目。每个条目（叫**段描述符**）描述一个段：基址、长度、权限、类型。
 
```
保护模式下，访问 [0x1000:offset] 的过程：
1. CPU 看 0x1000 这个值（叫"段选择子"，selector）
2. 从中提取索引号（高 13 位）
3. 用索引号从 GDT 里查出段描述符
4. 描述符里有：基址 base、长度 limit、权限
5. 检查 offset 是否 ≤ limit、当前特权级是否 ≥ 描述符权限
6. 通过检查，物理地址 = base + offset
```
 
每个段描述符是 **8 字节（64 位）**，结构由 Intel 规定死了：
 
```
描述符格式（8 字节，从低位到高位）：
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Limit 0-15  │ Base 0-15   │ Base 16-23  │ Type/Flags  │  低 4 字节
├─────────────┼─────────────┼─────────────┼─────────────┤
│             │ Limit 16-19 │             │             │
│ G/D/0/AVL   │ + Flags     │ Base 24-31  │ ...         │  高 4 字节
└─────────────┴─────────────┴─────────────┴─────────────┘
```
 
字段是**故意打散**的——这是为了保持和老格式（80286 的 6 字节描述符）的二进制兼容。看着丑，但能让旧代码继续跑。
 
GDT 是一张表，住在内存里，CPU 用一个特殊寄存器叫 **GDTR** 记住它的"地址 + 长度"。GDTR 是 48 位（16 位长度 + 32 位地址），通过 `lgdt` 指令加载。
 
### 3.2 IDT（中断描述符表）
 
类似 GDT，但描述的是中断处理。实模式下中断向量表（IVT）是固定在 `0x000` ~ `0x3FF` 这 1KB 里的简单数组（每项 4 字节：段:偏移）；保护模式下扩展成 IDT，每项 8 字节，包含完整的"段选择子 + 偏移 + 权限 + 类型"信息。
 
CPU 用 **IDTR** 记住 IDT 的地址，通过 `lidt` 指令加载。
 
setup.s 阶段不需要真的安装中断处理——它只加载一个**空的 IDT**（长度为 0），用来"占位"。真正的中断处理要到 head.s 和后面的 main.c 才安装。
 
### 3.3 段选择子（Selector）
 
保护模式下段寄存器装的 16 位值。结构是：
 
```
位 15        3   2   1   0
┌────────────┬───┬───────┐
│   INDEX    │TI │  RPL  │
└────────────┴───┴───────┘
   13 bits    1    2 bits
```
 
- **INDEX**（13 位）：段描述符在表里的下标
- **TI**（1 位）：表选择。0 = GDT，1 = LDT
- **RPL**（2 位）：请求特权级（Requested Privilege Level）
setup.s 末尾那条神奇的 `jmpi 0,8` 里的 `8` 就是一个段选择子。`8` 的二进制是 `0000 0000 0000 1 0 00`：
 
- INDEX = 1（GDT 第 1 项，下面会看到这正是代码段描述符）
- TI = 0（用 GDT，不用 LDT）
- RPL = 00（Ring 0，最高特权）
这一条会展开讲。
 
### 3.4 CR0 寄存器
 
CR0 是一个 32 位**控制寄存器**，最低位 PE（Protection Enable）控制 CPU 是否在保护模式：
 
```
位 31  30   ...   3   2   1   0
┌───┬────┬─────┬───┬───┬───┬───┐
│PG │CD/NW│ ... │TS │EM │MP │PE │
└───┴────┴─────┴───┴───┴───┴───┘
```
 
把 PE 设为 1，CPU 立刻进入保护模式。但是！**仅仅置位 PE 还不够**——CPU 流水线里可能还有"按实模式解码的指令"，它们的语义是错的。所以紧跟着必须 `jmpi 0,8`（远跳转）来**清空流水线**。
 
实模式下没有 `mov cr0,...` 指令（CR0 是 80286 才引入的），所以 setup 用一个折中的指令 `lmsw ax`（Load Machine Status Word）—— 它只能改 CR0 的低 16 位，正好够用来置 PE。
 
---
 
## 四、源码逐段拆解
 
### 4.1 文件头部：常量与硬件参数地址映射
 
```asm
INITSEG  = 0x9000     ! bootsect 把自己搬到的段，也是 setup 的"数据基地址"
SYSSEG   = 0x1000     ! system（内核主体）当前所在段 = 0x10000
SETUPSEG = 0x9020     ! setup 程序自己所在段 = 0x90200
 
.globl begtext, begdata, begbss, endtext, enddata, endbss
.text
begtext:
.data
begdata:
.bss
begbss:
.text
 
entry start
start:
```
 
这段定义和 bootsect 一样的段地址常量。`INITSEG = 0x9000` 是关键——所有后面收集到的硬件参数都会**写到 `0x9000:offset` 这块**，约定俗成。
 
📖 **概念：硬件参数的"内存约定"**
 
setup.s 把硬件参数固定写到 `0x90000` 起的几十字节里。这是 Linus 设计的一套"约定"：
 
| 偏移 | 长度 | 内容 |
|---|---|---|
| `0x00` | 1 byte | 光标列号 |
| `0x01` | 1 byte | 光标行号 |
| `0x02` | 2 bytes | 扩展内存大小（KB） |
| `0x04` | 2 bytes | 显示页面 |
| `0x06` | 1 byte | 显示模式 |
| `0x07` | 1 byte | 字符列数 |
| `0x08` | 2 bytes | EGA 信息 |
| `0x0A` | 2 bytes | EGA 信息 |
| `0x0C` | 2 bytes | EGA 信息 |
| `0x0E` | 1 byte | 显示状态 |
| `0x0F` | 1 byte | 显卡特征 |
| `0x10` | 1 byte | 屏幕行数 |
| `0x80` | 16 bytes | 第一硬盘参数表 |
| `0x90` | 16 bytes | 第二硬盘参数表 |
| `0x1FC` | 2 bytes | 根设备号 |
 
后面 C 语言写的 `console.c`、`hd.c` 直接用 `*(unsigned char*)0x90001` 这种**裸指针**访问这些参数。这是 1991 年特有的"硬编码地址"风格——简单粗暴，但工作得很好。
 
### 4.2 第一步：保存光标位置
 
```asm
! ok, the read went well so we get current cursor position and save it for
! posterity.
 
    mov ax,#INITSEG     ! ax = 0x9000
    mov ds,ax           ! ds = 0x9000，后面所有 mov [...] 默认写到 0x90000+
 
! Get memory size (extended mem, kB)
 
    mov ah,#0x88
    int 0x15
    mov [2],ax          ! 内存大小（KB）→ 0x90002
```
 
第一件事：把数据段 `ds` 设为 `INITSEG`。这样后面 `mov [2],ax` 这种短地址写法默认就是写到 `0x9000:[2]` = `0x90002`，省了写段超越前缀的麻烦。
 
📖 **概念：`int 0x15` ah=0x88 获取扩展内存大小**
 
`int 0x15` 是 BIOS 的"系统服务"，功能 `0x88` 返回从 1MB 开始的扩展内存大小（单位 KB）。返回值在 `ax` 里。
 
为什么要从 1MB 开始？因为前 1MB 是实模式时代规划好的特殊用途（中断向量表、BIOS 数据区、显存、BIOS ROM），不算"可用内存"。1MB 以上才是真正的扩展内存。这个机制叫 **HMA（High Memory Area）** 之上的扩展内存。
 
后来这个调用被发现只能报 64MB（因为 `ax` 是 16 位），所以现代 BIOS 还有 `int 0x15` ah=`0xE801`、`0xE820` 等更高级的内存探测调用。1991 年的 Linux 还没这些问题。
 
### 4.3 第二步：保存显卡信息
 
```asm
! Get video-card data:
 
    mov ah,#0x0f
    int 0x10
    mov [4],bx          ! bh = 显示页, bl = 当前模式
    mov [6],ax          ! ah = 字符列数, al = 显示模式
 
! check for EGA/VGA and some config parameters
 
    mov ah,#0x12
    mov bl,#0x10
    int 0x10
    mov [8],ax
    mov [10],bx
    mov [12],cx
```
 
`int 0x10` ah=`0x0f` 获取当前显示模式，`ah=0x12` bl=`0x10` 是 EGA/VGA 专用的"获取配置"调用。把返回结果都存到 `0x90004` ~ `0x9000D`。
 
这些数据后面 `console.c`（终端驱动）会用——它需要知道显存基址、字符列数、显卡类型来初始化屏幕。
 
### 4.4 第三步：保存硬盘参数
 
```asm
! Get hd0 data
 
    mov ax,#0x0000
    mov ds,ax           ! 临时把 ds 改成 0，因为 BIOS 的硬盘参数表指针在 IVT 里
    lds si,[4*0x41]     ! ds:si 指向第一硬盘参数表（中断 0x41 的向量本身就是个表指针）
    mov ax,#INITSEG
    mov es,ax
    mov di,#0x0080      ! 目标：0x90080
    mov cx,#0x10        ! 复制 16 字节
    rep
    movsb
```
 
这段比较 hack。`int 0x41` 这个"中断"实际上不是真的中断——BIOS 把它的中断向量"借用"成了第一硬盘参数表的地址。所以 `lds si,[4*0x41]` 实际是从 IVT 第 0x41 项读出一个 32 位指针，加载到 `ds:si`。然后用 `rep movsb` 复制 16 字节到 `0x90080`。
 
**这是 1981 年 IBM PC 的设计——把"硬盘参数表"塞进 IVT 的"未使用中断号"里**。1991 年 Linux 也只能照搬。
 
接着对第二硬盘做同样的事：
 
```asm
! Get hd1 data
 
    mov ax,#0x0000
    mov ds,ax
    lds si,[4*0x46]     ! 第二硬盘参数表在 int 0x46 的位置
    mov ax,#INITSEG
    mov es,ax
    mov di,#0x0090
    mov cx,#0x10
    rep
    movsb
```
 
### 4.5 第四步：检查是否真的有第二硬盘
 
```asm
! Check that there IS a hd1 :-)
 
    mov ax,#0x01500
    mov dl,#0x81        ! dl = 0x81 表示第二硬盘
    int 0x13
    jc no_disk1
    cmp ah,#3
    je is_disk1
no_disk1:
    mov ax,#INITSEG
    mov es,ax
    mov di,#0x0090
    mov cx,#0x10
    mov ax,#0x00
    rep
    stosb               ! 把 0x90090 ~ 0x9009F 全部清零
 
is_disk1:
```
 
`int 0x13` ah=`0x15` 是"获取磁盘类型"。如果第二硬盘不存在或不是固定盘（`ah != 3`），就把刚才存的"假参数"全部清零。
 
这是个**防御性编程**——上一步无脑复制了第二硬盘的参数表，但根本没确认这块盘是否存在。如果不存在，复制来的就是垃圾数据，C 代码读到会出错。所以这里一旦发现盘不在，就把垃圾擦掉。
 
### 4.6 第五步：关中断
 
```asm
! now we want to move to protected mode ...
 
    cli                 ! no interrupts allowed !
```
 
一条 `cli` 指令清掉 `EFLAGS.IF`，从现在开始 CPU 不响应任何可屏蔽中断。
 
📖 **概念：为什么必须关中断**
 
切换到保护模式的过程中，CPU 状态会经历这些阶段：
 
1. 实模式 + 旧 IDT（IVT）→ 实模式 + 新 IDT（空表）→ 保护模式 + 空 IDT
如果中间某个时刻来了一个中断，CPU 会去查 IDT——但 IDT 这时候是空的！结果是触发"双重故障"，整机重启。
 
所以**整个切换流程必须是原子的**：关中断 → 切换 → 跳转到新代码 → 设新 IDT → 开中断。中间任何一步出问题都不能被打断。
 
不可屏蔽中断（NMI）`cli` 关不掉——但 1991 年的设计哲学是"NMI 来了就当机重启",不试图处理。
 
### 4.7 第六步:把 system 从 0x10000 搬到 0x0
 
```asm
! first we move the system to it's rightful place
 
    mov ax,#0x0000
    cld                     ! 'direction'=0, movs moves forward
do_move:
    mov es,ax               ! destination segment
    add ax,#0x1000
    cmp ax,#0x9000
    jz end_move
    mov ds,ax               ! source segment
    sub di,di
    sub si,si
    mov cx,#0x8000          ! 32K word = 64KB
    rep
    movsw
    jmp do_move
 
! then we load the segment descriptors
 
end_move:
```
 
这段是 setup 里**最有戏剧性**的一段——它把 system（内核主体）从 `0x10000` 整体搬到 `0x0`。**这会覆盖原本住在 `0x0` ~ `0x3FF` 的 BIOS 中断向量表**！
 
为什么这么干？
 
📖 **概念：保护模式下,IVT 已经废了**
 
BIOS 中断向量表是实模式专用的。保护模式下中断查的是 IDT,而 IDT 由内核自己加载到任意位置。所以**一旦切换到保护模式,IVT 就成了死代码,占着 1KB 内存毫无价值**。Linus 决定:既然没用,那就直接覆盖掉,把内核的代码段从 `0x0` 开始放,这样保护模式下"地址 = 物理地址"最简单清晰。
 
具体逻辑:
 
- 外层循环每次把 64KB 从 `源段:0` 拷贝到 `目的段:0`
- 第一次:`ds=0x1000`,`es=0x0000`,搬第一个 64KB
- 第二次:`ds=0x2000`,`es=0x1000`,搬第二个 64KB
- ……
- 直到源段 `ax` 加到 `0x9000`(因为 `0x9000` 这块是 setup 自己,不能搬)
搬完 system 占用从 `0x0` 到 `0x80000`(8 块 64KB)。
 
### 4.8 第七步:加载 IDT 和 GDT
 
```asm
end_move:
    mov ax,#SETUPSEG    ! right, forgot this at first. didn't work :-)
    mov ds,ax
    lidt idt_48         ! load idt with 0,0
    lgdt gdt_48         ! load gdt with whatever appropriate
```
 
注释里 Linus 那句 `right, forgot this at first. didn't work :-)`(我一开始忘了这步,所以不工作 :-) )——Linus 的招牌幽默,说明他自己也踩过这个坑。
 
先把 `ds` 设回 `SETUPSEG`(0x9020),因为 `idt_48` 和 `gdt_48` 是 setup 代码段里定义的标号。然后:
 
- `lidt idt_48`:加载 IDT 寄存器,从 `idt_48` 这个位置读 6 字节作为 IDTR 的值
- `lgdt gdt_48`:加载 GDT 寄存器,同理
`idt_48` 和 `gdt_48` 长什么样,等会儿单独看。
 
### 4.9 第八步:开启 A20 地址线
 
```asm
! that was painless, now we enable A20
 
    call empty_8042
    mov al,#0xD1        ! command write
    out #0x64,al
    call empty_8042
    mov al,#0xDF        ! A20 on
    out #0x60,al
    call empty_8042
```
 
📖 **概念:什么是 A20 地址线?为什么要"开启"?**
 
8086(20 位地址线 A0~A19)寻址 1MB。但 8086 有个 quirk:如果段地址是 `0xFFFF`,偏移是 `0x10`,算出来物理地址是 `0xFFFF * 16 + 0x10 = 0x100000`——超出 20 位范围,**自动回绕**到 `0x00000`。很多 DOS 程序依赖这个"回绕"特性。
 
到了 80286(24 位地址线),回绕不再发生——`0x100000` 真的能寻址。但为了向下兼容老 DOS 程序,IBM 在主板上加了一个开关:**A20 地址线门(A20 Gate)**。默认关闭,A20 永远是 0,模拟 8086 回绕;开启后,A20 才能真正反映 CPU 输出的地址位。
 
要想用 1MB 以上的内存,**必须开启 A20**。开启的方法很奇怪——通过键盘控制器(8042 芯片)的特定端口指令。这是因为 IBM 当年发现键盘控制器有个空闲引脚正好能控制这条线,就硬连上了——又一个历史包袱。
 
代码逻辑:
1. `empty_8042` 等待键盘控制器空闲
2. 往端口 `0x64` 写 `0xD1` = "我要写控制端口的命令"
3. 往端口 `0x60` 写 `0xDF` = "开启 A20"
4. 再等一次 8042 处理完
### 4.10 第九步:重新映射 8259A 中断控制器
 
```asm
! well, that went ok, I hope. Now we have to reprogram the interrupts :-(
! we put them right after the intel-reserved hardware interrupts, at
! int 0x20-0x2F. There they won't mess up anything. Sadly IBM really
! messed this up with the original PC, and they haven't been able to
! rectify it afterwards. Thus the bios puts interrupts at 0x08-0x0f,
! which is used for the internal hardware interrupts as well. We just
! have to reprogram the 8259's, and it isn't fun.
 
    mov al,#0x11        ! initialization sequence
    out #0x20,al        ! send it to 8259A-1
    .word 0x00eb,0x00eb ! jmp $+2, jmp $+2
    out #0xA0,al        ! and to 8259A-2
    .word 0x00eb,0x00eb
    mov al,#0x20        ! start of hardware int's (0x20)
    out #0x21,al
    .word 0x00eb,0x00eb
    mov al,#0x28        ! start of hardware int's 2 (0x28)
    out #0xA1,al
    .word 0x00eb,0x00eb
    mov al,#0x04        ! 8259-1 is master
    out #0x21,al
    .word 0x00eb,0x00eb
    mov al,#0x02        ! 8259-2 is slave
    out #0xA1,al
    .word 0x00eb,0x00eb
    mov al,#0x01        ! 8086 mode for both
    out #0x21,al
    .word 0x00eb,0x00eb
    out #0xA1,al
    .word 0x00eb,0x00eb
    mov al,#0xFF        ! mask off all interrupts for now
    out #0x21,al
    .word 0x00eb,0x00eb
    out #0xA1,al
```
 
这段配上 Linus 写的注释看,是 setup 里最有"人味"的一段——那句 `it isn't fun`(这一点都不好玩)和 `Sadly IBM really messed this up`(IBM 真的把这事搞砸了)直接把 1991 年那个挫败感写在代码里了。
 
📖 **概念:为什么要重新映射 8259A?**
 
8259A 是可编程中断控制器,负责把硬件中断(键盘、磁盘、定时器等)转发给 CPU。一台 PC 上有两片 8259A 级联——主片管 IRQ0~IRQ7,从片管 IRQ8~IRQ15。
 
问题是:**IBM 把硬件中断映射到了 `int 0x08` ~ `int 0x0F`**。但 Intel 80386 把 `int 0x00` ~ `int 0x1F` 留给了 CPU 异常(除零、缺页、保护故障等),其中 `int 0x08` 是"双重故障"。
 
**冲突来了**:键盘按键应该触发 IRQ1 → `int 0x09`,但 `int 0x09` 是 CPU 的"协处理器段越界异常"!如果不修,内核分不清"用户按了键"和"协处理器出错"。
 
Linus 的解决方法:把硬件中断**重新映射到 `int 0x20` ~ `int 0x2F`**,跟 Intel 异常完全错开。这就是这段代码在干的事——通过往 8259A 的端口(`0x20/0x21` 主片,`0xA0/0xA1` 从片)写一系列 ICW(Initialization Command Word)完成重新编程。
 
那些 `.word 0x00eb,0x00eb` 是什么?看代码注释:`jmp $+2`——这是一种 1991 年硬件特有的"延时"技术。`out` 指令对慢设备(8259A 是上世纪 70 年代的芯片)发出后,需要给设备一点时间响应,而 `jmp $+2` 是一条"跳转到下一条指令"的空操作,只为消耗几个时钟周期。
 
最后一行 `mov al,#0xFF; out 0x21/0xA1` 把所有中断**屏蔽掉**——切换完保护模式之后由内核重新决定哪些中断要打开。
 
### 4.11 第十步:置位 CR0.PE,切换到保护模式
 
```asm
! well, that certainly wasn't fun :-\. Let's hope it works, and we don't
! need no steenking BIOS anyway (except for the initial loading :-).
! The BIOS-routine wants lots of unnecessary data, and it's less
! "interesting" anyway. This is how REAL programmers do it.
 
! Well, now's the time to actually move into protected mode. To make
! things as simple as possible, we do no register set-up or anything,
! we let the gnu-compiled 32-bit programs do that. We just jump to
! absolute address 0x00000, in 32-bit protected mode.
 
    mov ax,#0x0001      ! protected mode (PE) bit
    lmsw ax             ! This is it!
    jmpi 0,8            ! jmp offset 0 of segment 8 (cs)
```
 
**这是整个 Linux 启动里最戏剧性的三行代码。**
 
- `mov ax,#0x0001` —— `ax` 的最低位置 1,正是 CR0 里的 PE 位
- `lmsw ax` —— Load Machine Status Word,把 `ax` 加载到 CR0 的低 16 位。**执行完这一行,CPU 已经在保护模式了**
- `jmpi 0,8` —— 远跳转到 `0x0`,使用段选择子 `8`
这条 `lmsw ax` 的注释 Linus 写的是 `This is it!`——"就这样了!" 体现了那一行的关键性。
 
为什么不用 `mov cr0,ax`?因为 `mov cr0,...` 是 80386 才引入的指令,而 `lmsw` 从 80286 就存在。Linus 选了兼容性更广的写法。
 
为什么最后必须远跳?接下来详细讲。
 
### 4.12 那条神奇的 `jmpi 0,8` 详解
 
`lmsw ax` 把 PE 置位的瞬间,CPU **已经在保护模式**了。但有一个问题:**CPU 流水线里还有几条按"实模式语义"预解码的指令**——它们正等着执行。如果直接执行,语义就错了。
 
x86 的解决方法:**远跳转(far jump)会强制刷新流水线**,所有未解码的指令丢弃,从新地址重新取指。这是 Intel 在保护模式切换流程中的硬性要求。
 
那为什么是 `jmpi 0,8`?
 
- 偏移 = `0` —— 跳到 `0x0`,正是 `head.s` 在 system 内的起始位置(还记得我们刚把 system 搬到了 `0x0` 吗?)
- 段 = `8` —— 这是个**段选择子**,不是段地址!
回忆 3.3 节,段选择子的结构:
 
```
8 = 0000 0000 0000 1 0 00
INDEX = 1, TI = 0 (GDT), RPL = 00 (Ring 0)
```
 
意思是:用 GDT 第 1 项作为代码段。第 1 项是什么?往下看 GDT 表:
 
### 4.13 GDT 表本身
 
```asm
gdt:
    .word 0,0,0,0       ! dummy
                        ! 第 0 项必须是空描述符,Intel 规定
 
    .word 0x07FF        ! 8Mb - limit=2047 (2048*4096=8Mb)
    .word 0x0000        ! base address=0
    .word 0x9A00        ! code read/exec
    .word 0x00C0        ! granularity=4096, 386
                        ! 第 1 项:内核代码段(jmpi 0,8 用的就是这个)
 
    .word 0x07FF        ! 8Mb - limit=2047 (2048*4096=8Mb)
    .word 0x0000        ! base address=0
    .word 0x9200        ! data read/write
    .word 0x00C0        ! granularity=4096, 386
                        ! 第 2 项:内核数据段
```
 
**逐字段解读第 1 项(代码段描述符)的 8 字节:**
 
```
.word 0x07FF    →  Limit 0-15 = 0x07FF
.word 0x0000    →  Base 0-15  = 0x0000
.word 0x9A00    →  Base 16-23 = 0x00, 类型/权限 = 0x9A
.word 0x00C0    →  Limit 16-19 = 0xF, 标志 = 0xC, Base 24-31 = 0x00
```
 
合起来:
 
| 字段 | 值 | 含义 |
|---|---|---|
| Base | `0x00000000` | 段基址 = 0 |
| Limit | `0x000FFFFF` | 段长度 = 2^20 = 1M 单位 |
| G | 1 | 粒度 = 4KB |
| **实际段长** | **8MB** | `0xFFFFF × 4KB = 8MB` |
| Type | `0xA = 1010` | 代码段,可读可执行,未访问过 |
| DPL | `00` | 描述符特权级 = Ring 0 |
| P | 1 | 段存在 |
| D/B | 1 | 32 位段(默认操作数 32 位) |
 
**意思是:这个描述符定义了一个从 `0x0` 开始、8MB 大小、Ring 0 特权、可读可执行、32 位的代码段。**
 
所以 `jmpi 0,8` 的完整语义是:
 
> 跳到 GDT 第 1 项描述的代码段(基址 0,长度 8MB,Ring 0)的偏移 0 处,以 32 位模式执行。
 
也就是从物理地址 `0x0` 开始执行——正是刚才搬过来的 system 的起点(head.s 在 system 最前面)。
 
### 4.14 IDT 和 GDT 的"指针"
 
```asm
idt_48:
    .word 0             ! idt limit=0
    .word 0,0           ! idt base=0L
 
gdt_48:
    .word 0x800         ! gdt limit=2048, 256 GDT entries
    .word 512+gdt,0x9   ! gdt base = 0X9xxxx
                        ! 完整基址 = 0x90000 + 512 + gdt_offset
```
 
`lidt` 和 `lgdt` 不是直接拿表内容,而是拿"表的描述符"——长度 + 基址,共 6 字节。
 
- `idt_48`:长度 = 0,基址 = 0 —— 一张**空 IDT**。setup 阶段用不到中断,先占位
- `gdt_48`:长度 = 2048(256 项 × 8 字节),基址 = `0x90000 + 512 + gdt 偏移`
为什么基址是 `0x90000 + 512 + gdt`?因为:
 
- `0x90000` 是 setup 所在段的起点
- `+512` 是因为 setup 实际从段内偏移 512(也就是 `0x90200`)开始(由 bootsect 加载到这里)
- `+gdt` 是 gdt 标号在 setup.s 文件内的相对偏移
`+ 0x9` 这个高位字节就是 `0x90000` 的高位,加在 base 字段的最高字节。
 
### 4.15 setup.s 文件末尾
 
```asm
.text
endtext:
.data
enddata:
.bss
endbss:
```
 
跟 bootsect 一样的结构定义。`setup.s` 结束。
 
---
 
## 五、setup 整体内存布局变化
 
setup 跑完之前和之后,内存看起来完全不一样:
 
**setup 跑之前(bootsect 跳过来时):**
 
```
0x00000  ─┬──────────────────┐
          │ BIOS 中断向量表  │  ← 实模式还需要,不能动
0x00400  ─┼──────────────────┤
          │ BIOS 数据区      │
0x00500  ─┼──────────────────┤
          │ (空闲)           │
0x10000  ─┼──────────────────┤
          │ system(196KB)    │  ← 内核主体在这里
0x40000  ─┼──────────────────┤
          │ (空闲)           │
0x90000  ─┼──────────────────┤  ← 上一阶段 bootsect 搬来这里
          │ bootsect         │
0x90200  ─┼──────────────────┤
          │ setup.s ← CPU 在这里 │
0x90A00  ─┴──────────────────┘
```
 
**setup 跑完后(`jmpi 0,8` 跳出去时):**
 
```
0x00000  ─┬──────────────────┐
          │ system(已搬过来) │  ← 内核现在在 0x0
          │ head.s ← CPU 即将跳到这里 │
0x80000  ─┼──────────────────┤
          │ (空闲)           │
0x90000  ─┼──────────────────┤
          │ bootsect(残留)   │  ← 没用了,但还在
0x90200  ─┼──────────────────┤
          │ setup.s(残留)    │  ← 没用了,但还在
          │ + 硬件参数表     │  ← 这部分还要给内核读
0x9XXXX  ─┴──────────────────┘
```
 
注意几件事:
 
1. **BIOS 中断向量表被覆盖了**——因为保护模式下用不到了
2. **system 被搬到了 `0x0`**——保护模式下"线性地址 = 物理地址"最简单
3. **bootsect 和 setup 自己都没动**——它们留在 `0x9000:` 段,setup 写的硬件参数(如 `0x90002` 内存大小、`0x90080` 硬盘参数)等会儿还要被 head.s 和 main.c 读取
---
 
## 六、回答开篇三个"关键点自问"
 
### 6.1 调 BIOS 中断读硬件参数,为什么必须"现在"做?
 
短答:**因为切换到保护模式后,BIOS 中断就再也不能用了。**
 
详细原因:
 
BIOS 中断是**实模式专用**的。它依赖几个条件:
 
1. **实模式的中断向量表(IVT)** 在 `0x000` ~ `0x3FF`,固定位置
2. **BIOS 代码本身在 16 位段** 里,跑在实模式
3. **数据通过段:偏移传递**,用 `ds:si` 这种实模式寻址
切换到保护模式后:
 
1. IVT 变成了 IDT,而且 setup 加载的是空 IDT
2. 即使保留了 IVT,保护模式下访问它也要经过 GDT 描述符翻译
3. 段寄存器变成段选择子,实模式的 `ds:si` 寻址语义完全不同
所以一旦 `lmsw` 那一刻,**所有 BIOS 中断都失效了**。如果你需要 BIOS 给的任何信息,**必须在那一行之前调用完毕**。
 
setup.s 把所有 BIOS 调用集中在前半段(光标位置、内存大小、显卡、硬盘参数),把结果写到 `0x90000` 这块固定地址,然后再做切换——这个顺序是被物理规律强制的。
 
### 6.2 切换到保护模式为什么需要这么多步骤?
 
短答:**因为这是 CPU 模式切换中最复杂的一种,涉及"硬件状态、内存视图、中断系统"三个层面同时切换。**
 
详细:
 
把那 7 步对应的"为什么":
 
| 步骤 | 不做会怎样 |
|---|---|
| 关中断 | 切换中途如果来中断,IDT 不一致会导致重启 |
| 加载 GDT | 没 GDT,CPU 进保护模式后第一条指令的段选择子无法解析,直接故障 |
| 加载 IDT | 没 IDT,任何异常都会触发"无 IDT 故障"导致重启 |
| 开 A20 | 不开 A20,寻址会回绕到低 1MB,内核访问 1MB 以上的内存会读到错误数据 |
| 重映射 8259A | 不重映射,硬件中断号会和 CPU 异常号撞车 |
| 置位 CR0.PE | 这一行就是切换本身 |
| 远跳转 | 不跳,CPU 流水线里的"实模式预解码指令"会被错误执行 |
 
每一步都是为了"切换的一致性"——保证那一瞬间硬件、内存、中断三个层面**同时切换好**,中间不能有任何一刻处于"半保护模式"的不一致状态。
 
### 6.3 那条 `jmpi 0,8` 里的 `8` 到底是什么?
 
短答:**`8` 是一个段选择子,意思是"GDT 第 1 项,Ring 0,使用 GDT"。**
 
详细推导:
 
`8` 的二进制:`0000 0000 0000 1000`
 
按段选择子格式拆:
 
| 字段 | 位 | 值 | 含义 |
|---|---|---|---|
| INDEX | 15-3 | `0001` | GDT/LDT 中第 1 项 |
| TI | 2 | `0` | 用 GDT,不用 LDT |
| RPL | 1-0 | `00` | Ring 0(最高特权) |
 
而 GDT 第 1 项是 setup.s 自己定义的"内核代码段":
 
- 基址 = 0
- 限长 = 8MB
- Ring 0
- 32 位代码,可读可执行
所以 `jmpi 0,8` 翻译成普通话:
 
> 跳到 GDT 第 1 项描述的代码段(从物理地址 0 开始的 8MB 内核代码段)的偏移 0 处,以 32 位保护模式 Ring 0 特权级执行。
 
也就是从物理地址 `0x0` 开始执行 head.s。
 
为什么不是 `jmpi 0,0x10` 或别的?
 
- 段选择子的低 3 位永远是"TI + RPL",所以 `INDEX × 8` 才是有效选择子
- INDEX = 1 → 选择子 = 8
- INDEX = 2 → 选择子 = 16
- INDEX = 3 → 选择子 = 24
- ……
setup 后面也用到 `mov ax,#0x10; mov ds,ax` 这种——`0x10 = 16`,意思是"GDT 第 2 项,内核数据段"。这是 head.s 一开始要做的事。
 
---
 
## 七、本篇小结
 
setup.s 在 1991 年大概是 Linus 写得最纠结的一段代码——他要在不到 400 行汇编里**把 1980 年代的 IBM PC 兼容包袱(BIOS、A20、8259A、中断号冲突)全部处理干净,然后干净地跳进 1990 年代的 32 位世界**。从源码注释里那些 `it isn't fun`、`This is how REAL programmers do it` 看得出当时的挣扎。
 
这一篇之后的状态:
 
- CPU **已经在保护模式**(32 位、有 GDT 保护、Ring 0)
- 中断**全部屏蔽**(等 head.s 重新设置 IDT 后再开)
- 内核 system **已经在 `0x0`**(覆盖了原来的 IVT)
- 硬件参数**已经在 `0x90000`** 等着 C 代码读取
- A20 已开,1MB 以上的内存**真正可寻址**
- 8259A **重新映射到 int 0x20-0x2F**,跟 CPU 异常错开
下一篇 `head.s` 会接手这个干净的环境,做四件事:**重新加载段寄存器、重建 GDT 和 IDT、开启分页、跳进 C 语言写的 `main.c`**。这是从汇编世界进入 C 世界的最后一跃——也是整个引导过程的终章。
 
---
 
## 关键点自问
 
- 调 BIOS 中断读硬件参数,为什么必须"现在"做? → [第 6.1 节](#61-调-bios-中断读硬件参数为什么必须现在做)
- 切换到保护模式为什么需要这么多步骤? → [第 6.2 节](#62-切换到保护模式为什么需要这么多步骤)
- 那条 `jmpi 0,8` 里的 `8` 到底是什么? → [第 6.3 节](#63-那条-jmpi-08-里的-8-到底是什么)