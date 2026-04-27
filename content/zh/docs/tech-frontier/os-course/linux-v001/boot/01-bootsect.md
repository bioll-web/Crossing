---
title: "bootsect.s：第一个 512 字节"
weight: 1
---
 
# bootsect.s：第一个 512 字节
 
> 📖 **本节版本说明**
>
> 本博客以 Linux 0.01 为主要分析对象，但 0.01 是以"运行于 Minix 之上的内核源码"形式发布的，**不含独立引导程序**（bootsect/setup/head）。本节（boot 引导阶段）的三篇文章使用 **Linux 0.11**（1991 年 12 月，第一个具备自启动能力的 Linux 版本）的源码进行分析——这也是赵炯《Linux 内核完全剖析》及绝大多数操作系统课程的标准做法。后续 `kernel`、`mm`、`fs` 等章节将回到 0.01 主线。
>
> 源码出处：[karottc/linux-0.11/boot/bootsect.s](https://github.com/karottc/linux-0.11/blob/master/boot/bootsect.s)
 
`bootsect.s` 是整个 Linux 内核里**第一个被 CPU 执行的字节**。它只有 512 字节，260 行汇编，但承担了一项不可替代的任务：把硬件世界和操作系统世界连接起来。
 
学这一篇之前我自己有个错觉——总觉得电脑通电后操作系统会"自动启动"。看完源码才意识到，**操作系统不会自己启动**。CPU 通电那一刻，它对硬盘上有什么东西、内核是用什么语言写的、文件系统长什么样，**一无所知**。Linux 之所以能从一块磁盘上"跑起来"，全靠这 512 字节的引导扇区一步步把内核搬进内存。
 
这篇文章会做三件事：
 
1. 讲清楚**为什么**需要 `bootsect.s`——CPU 通电后到底发生了什么、BIOS 干了什么
2. 把 `bootsect.s` 的 260 行源码**逐段拆解**，每段都贴关键代码 + 中文逐行注释
3. 回答开头三个"关键点自问"
---
 
## 一、CPU 通电的瞬间：一个"瞎子" CPU
 
### 1.1 上电复位时刻的 CPU 状态
 
x86 CPU 在通电（或按下 reset 按钮）的瞬间，会进入一个完全确定的初始状态：
 
| 项目 | 值 | 含义 |
|---|---|---|
| 工作模式 | **实模式**（Real Mode） | 16 位寻址，最多访问 1MB 内存 |
| `CS` 寄存器 | `0xFFFF` | 代码段 |
| `IP` 寄存器 | `0x0000` | 指令偏移 |
| 第一条指令物理地址 | `0xFFFF0` | `CS × 16 + IP` |
 
CPU 取的第一条指令在哪？`0xFFFF0`——这是 1MB 内存地址空间的最顶端附近。这里事先被硬件厂商**永久地接到了主板上的 BIOS 芯片**（或现代机器的 UEFI 固件）。
 
📖 **概念：实模式 vs 保护模式**
 
实模式是 8086 时代的产物（1978 年），用一种叫"段:偏移"的奇怪方式寻址：物理地址 = 段寄存器 × 16 + 偏移寄存器。这样能凑出 20 位地址，最大寻址 1MB。
 
保护模式是 80386（1985 年）引入的，用 32 位寻址，能访问 4GB 内存，并且支持权限检查、内存保护、虚拟内存——这些是"现代操作系统"的根基。
 
`bootsect.s` 全程跑在实模式下，下一篇 `setup.s` 末尾才会切换到保护模式。所以这一篇你看到的所有寻址，都是 16 位 + 段寄存器的老规矩。
 
### 1.2 BIOS 干了什么
 
BIOS（Basic Input/Output System）是固化在主板芯片上的一段程序，从 1981 年 IBM PC 诞生起就存在了。CPU 跳到 `0xFFFF0` 后，执行的就是 BIOS 代码。BIOS 干这几件事：
 
1. **POST（Power-On Self Test，加电自检）**：检查内存、显卡、键盘是否正常工作
2. **建立中断向量表**：把 `int 0x10`（显示）、`int 0x13`（磁盘）、`int 0x16`（键盘）等基本服务安装到内存最低 1KB 区域
3. **寻找可启动设备**：按照 CMOS 配置的启动顺序（软盘 → 硬盘 → 光盘 → 网卡）依次尝试
4. **加载引导扇区**：找到可启动设备后，把它的**第 0 号扇区**（512 字节）读到物理地址 `0x7C00`，然后用一条 `jmp 0x0000:0x7C00` 跳过去执行
**这"被读到 `0x7C00` 的 512 字节"就是 `bootsect.s` 编译后的产物**，俗称 **MBR**（Master Boot Record，主引导记录）。
 
### 1.3 为什么是 `0x7C00` 这个魔法数字？
 
这是 BIOS 设计者 1981 年定下的约定。原因很朴素——IBM PC 5150 最低配置 32KB 内存（地址 `0x0000` ~ `0x7FFF`），BIOS 要在内存末尾给自己留约 1KB 栈空间，剩下能塞 512 字节代码 + 512 字节栈的位置正好是 `0x7C00`：
 
```
0x7C00 = 0x8000 - 0x400 = 32KB 末尾 - 1KB
```
 
40 多年后，这个数字成了所有 x86 操作系统启动代码的"公共起点"——Linux、Windows、DOS、各种 BSD 都得遵守这个约定。
 
### 1.4 BIOS 怎么知道这 512 字节是"可启动的"？
 
BIOS 读完一个扇区后会检查最后两个字节是不是 `0x55, 0xAA`（小端存储成 `0xAA55`）。这是 IBM 当年规定的"引导扇区签名"。
 
如果不是这个签名，BIOS 就认为这设备没装系统，跳过去找下一个启动设备。所以你看 `bootsect.s` 文件最后会有：
 
```asm
.org 510            ! 强制定位到第 510 字节
boot_flag:
    .word 0xAA55    ! 写入两字节签名
```
 
`.org 510` 这条指令告诉汇编器："不管前面代码占了多少字节，下面这条数据必须从第 510 字节开始写。"这样无论 `bootsect.s` 实际代码长度是多少，最终编译出来的 binary 永远是 512 字节，最后两字节永远是 `0xAA55`。
 
---
 
## 二、bootsect.s 一句话总结
 
> bootsect 被 BIOS 加载到 `0x7C00`，把自己复制到 `0x90000` 处继续运行，然后用 BIOS 中断把磁盘上的 `setup.s`（4 个扇区）和 `system`（内核主体）依次读进内存，最后 `jmpi 0,SETUPSEG` 跳转到 `setup.s`。
 
听起来简单，但每一步都藏着设计取舍。下面看代码。
 
---
 
## 三、源码逐段拆解
 
### 3.1 文件头部：常量与段定义
 
```asm
SYSSIZE = 0x3000          ! 内核主体大小：0x30000 字节 = 196KB（足够当时的 Linux）
 
.globl begtext, begdata, begbss, endtext, enddata, endbss
.text
begtext:
.data
begdata:
.bss
begbss:
.text
 
SETUPLEN = 4              ! setup 程序占 4 个扇区
BOOTSEG  = 0x07c0         ! BIOS 把 bootsect 加载到 0x07c0:0000 = 物理地址 0x7C00
INITSEG  = 0x9000         ! bootsect 自己要搬到的目的地：物理地址 0x90000
SETUPSEG = 0x9020         ! setup 加载位置：物理地址 0x90200（紧贴 bootsect 之后）
SYSSEG   = 0x1000         ! 内核主体加载位置：物理地址 0x10000
ENDSEG   = SYSSEG + SYSSIZE   ! 内核主体结束位置：物理地址 0x40000
 
! ROOT_DEV: 0x000 - 与启动盘相同类型的软盘
!           0x301 - 第一硬盘的第一分区
!           0x306 - 第二硬盘的第一分区
ROOT_DEV = 0x306          ! 根文件系统所在设备
```
 
📖 **概念：段地址要乘以 16 才是物理地址**
 
`BOOTSEG = 0x07c0` 看起来只有 4 位数字，但它是**段地址**。实模式下：
 
```
物理地址 = 段地址 × 16 + 偏移地址
        = 段地址左移 4 位 + 偏移地址
```
 
所以：
- `0x07C0:0x0000` → 物理地址 `0x07C00`（即 `0x7C00`）
- `0x9000:0x0000` → 物理地址 `0x90000`
- `0x1000:0x0000` → 物理地址 `0x10000`
记住这个换算，下面所有"地址"都默认是物理地址。
 
### 3.2 内存布局图
 
把上面这些常量画在 1MB 的内存地图上，能更直观地看到 bootsect 计划"搬动什么、搬到哪"：
 
```
物理地址          内容
─────────────────────────────────────────────
0x00000  ┌──────────────────────┐
         │ BIOS 中断向量表      │  CPU 中断跳转表
0x00400  ├──────────────────────┤
         │ BIOS 数据区          │  键盘缓冲、显示模式等
0x00500  ├──────────────────────┤
         │ （空闲）             │
0x07C00  ├──────────────────────┤  ← bootsect 一开始在这里（BIOS 加载位置）
         │ bootsect.s（512 B）  │
0x07E00  ├──────────────────────┤
         │ （空闲）             │
0x10000  ├──────────────────────┤  ← system（内核主体）将被加载到这里
         │ system（≤ 196KB）    │
0x40000  ├──────────────────────┤
         │ （空闲）             │
0x90000  ├──────────────────────┤  ← bootsect 第二步要搬到这里
         │ bootsect（搬过来的） │
0x90200  ├──────────────────────┤  ← setup 加载位置（紧贴 bootsect）
         │ setup.s（4 扇区= 2KB）│
0x90A00  ├──────────────────────┤
         │ （未使用）           │
0x9FF00  ├──────────────────────┤  ← 栈顶（向下生长）
         │ 栈                   │
0xA0000  ├──────────────────────┤
         │ 显存等               │
0xFFFFF  └──────────────────────┘  1MB 末端
```
 
看这张图可以发现几件事：
 
- bootsect 自己的搬运目的地 `0x90000` 离最初位置 `0x7C00` **很远**——不是为了好看，是为了腾出空间给后面要加载的内核
- 内核主体 `system` 放在 `0x10000`——这是个低地址，因为后面 `setup.s` 切到保护模式后还要把它继续移动
- `setup` 紧贴 bootsect 之后（`0x90200` = `0x90000 + 512`）——方便 bootsect 跳过去
### 3.3 入口与第一件事：自我搬迁
 
```asm
entry _start
_start:
    mov ax,#BOOTSEG    ! ax = 0x07C0（bootsect 当前所在段）
    mov ds,ax          ! ds = 0x07C0，源段
    mov ax,#INITSEG    ! ax = 0x9000（bootsect 要搬到的段）
    mov es,ax          ! es = 0x9000，目的段
    mov cx,#256        ! 计数器：搬 256 个 word（= 512 字节）
    sub si,si          ! si = 0，源偏移
    sub di,di          ! di = 0，目的偏移
    rep                ! 重复执行下一条指令 cx 次
    movw               ! 把 ds:si 的一个 word 拷贝到 es:di，然后 si 和 di 各 +2
    jmpi go,INITSEG    ! 远跳转：跳到 INITSEG:go = 0x9000:go
```
 
**逐行讲清楚这段代码：**
 
第一步是把 bootsect 自己从 `0x7C00` 搬到 `0x90000`。涉及四个段寄存器你要先认识：
 
📖 **概念：段寄存器 ds、es、cs、ss**
 
实模式下 CPU 有 4 个段寄存器，每个都用来给一类访问"指定基地址"：
 
- `cs`（Code Segment）：代码段——CPU 取指令时用 `cs:ip`
- `ds`（Data Segment）：数据段——大多数 `mov` 指令默认用 `ds:offset`
- `es`（Extra Segment）：附加段——串操作（`movs/lods/stos`）的目的段
- `ss`（Stack Segment）：栈段——`push/pop/call/ret` 用 `ss:sp`
**`rep movw` 这条指令是什么意思？**
 
`movw` 单条指令的语义是：把 `ds:si` 处的一个 word（2 字节）复制到 `es:di`，然后 `si += 2`、`di += 2`。
 
`rep` 是前缀，意思是"重复执行下一条指令 `cx` 次，每次 `cx` 自减 1，到 0 停"。
 
合起来 `rep movw` + `cx=256` = 把 `ds:si` 处的 256 个 word（即 512 字节）复制到 `es:di`，正好整个 bootsect。
 
执行完这段后，**内存里就有两份一模一样的 bootsect**：一份在 `0x7C00`（原版），一份在 `0x90000`（拷贝）。但 CPU 还在执行 `0x7C00` 那份的代码——因为 `cs:ip` 还没变。
 
**`jmpi go,INITSEG` 是关键的一步：**
 
这是一条**远跳转**（far jump）指令，语法是 `jmpi 偏移,段`，会**同时修改 cs 和 ip**：
 
- `cs ← INITSEG (0x9000)`
- `ip ← go`（标号 `go` 在拷贝里的偏移）
跳转后 CPU 开始从 `0x9000:go` = `0x90000 + go 的偏移` 取指令——也就是开始执行**拷贝那份**的代码。原版那份就被弃用了，从此以后 bootsect 一直在 `0x90000` 里跑。
 
**为什么要搬走自己？**——这是开篇第一个自问，答案见文末第六节。
 
### 3.4 设置数据段和栈
 
```asm
go: mov ax,cs          ! ax = cs = 0x9000（刚才远跳转后 cs 已经是 INITSEG）
    mov ds,ax          ! ds = 0x9000
    mov es,ax          ! es = 0x9000
    ! 把栈顶设置在 0x9FF00
    mov ss,ax          ! ss = 0x9000
    mov sp,#0xFF00     ! sp = 0xFF00，栈顶 = ss:sp = 0x9000:0xFF00 = 0x9FF00
```
 
跳到拷贝里之后，第一件事是**统一段寄存器**——让 `ds`、`es`、`ss` 全都指向 `0x9000`，这样后面的所有内存访问都默认在 bootsect 自己这一段（`0x90000` ~ `0x9FFFF` 这 64KB 内）操作，不用每次都写段超越。
 
栈被设置在 `ss:sp = 0x9000:0xFF00` = 物理地址 `0x9FF00`。栈是向下生长的（`push` 会让 `sp` 减小），所以从 `0x9FF00` 往下到 `0x90A00`（setup 末尾）之间约 60KB 都是栈空间，绝对够用。
 
📖 **为什么栈要向下生长？**
 
这是 8086 设计时的约定，几乎所有现代 CPU 都沿用了。好处是：把代码、数据、栈分开放在内存的两端，**栈往中间扩，数据/堆往中间扩，两边都有空间增长，不容易冲突**。如果栈和堆都从同一端往同一方向长，会很快撞在一起。
 
### 3.5 加载 setup：用 BIOS 中断读磁盘
 
```asm
load_setup:
    mov dx,#0x0000          ! dh = 磁头号 = 0, dl = 驱动器号 = 0（第一软驱）
    mov cx,#0x0002          ! ch = 磁道号 = 0, cl = 起始扇区号 = 2
    mov bx,#0x0200          ! 读到 es:bx = 0x9000:0x0200 = 0x90200
    mov ax,#0x0200+SETUPLEN ! ah = 0x02（读扇区功能号）, al = 4（读 4 个扇区）
    int 0x13                ! 调用 BIOS 磁盘服务
    jnc ok_load_setup       ! 没出错（CF=0）就跳到 ok_load_setup
 
    mov dx,#0x0000          ! 出错了，准备复位驱动器
    mov ax,#0x0000          ! ah=0 = 复位功能
    int 0x13                ! 复位
    j load_setup            ! 重新尝试读
```
 
📖 **概念：BIOS 中断与 `int 0x13`**
 
实模式下没有"驱动程序"这个概念——BIOS 早就把基本硬件操作打包成了**中断服务**，软件只要用 `int 中断号` 就能调用它们。常用的几个：
 
- `int 0x10` —— 显示服务（写字符、清屏、设置光标）
- `int 0x13` —— 磁盘服务（读扇区、写扇区、复位驱动器）
- `int 0x16` —— 键盘服务（读按键）
- `int 0x1A` —— 时钟服务
`int 0x13` 怎么用？把功能号放在 `ah`，参数按规定放进对应寄存器，调 `int 0x13`，结果通过 CF（进位标志）和某些寄存器返回。
 
**这段代码具体在干嘛：**
 
它在调用 `int 0x13` 的"功能 02：读扇区"，参数是这样设的：
 
| 寄存器 | 值 | 含义 |
|---|---|---|
| `ah` | `0x02` | 功能号：读扇区 |
| `al` | `4` | 要读的扇区数（SETUPLEN = 4） |
| `ch` | `0` | 起始磁道号（柱面） |
| `cl` | `2` | 起始扇区号（**注意：磁盘扇区从 1 开始数，不是 0**） |
| `dh` | `0` | 磁头号 |
| `dl` | `0` | 驱动器号（0 = 第一软驱，0x80 = 第一硬盘） |
| `es:bx` | `0x9000:0x0200` | 读到内存的地址 = 物理 `0x90200` |
 
意思是：从软驱 0 的第 0 磁道、第 0 磁头、第 2 扇区开始，连续读 4 个扇区（共 2KB），存到内存 `0x90200` 处。
 
为什么是第 2 扇区开始？因为：
- 第 1 扇区（在 BIOS 看来）= bootsect 自己（已经被 BIOS 读到 `0x7C00` 了）
- 第 2 扇区开始 = setup.s 的 4 个扇区
- 第 6 扇区开始 = system（内核主体）
读完后用 `jnc ok_load_setup` 检查：`jnc` = "jump if no carry"，CF=0 表示读成功；CF=1 表示读失败，BIOS 会把错误码留在 `ah`。失败的话就复位驱动器重试——这个简单粗暴的"无限重试"循环正是源码注释里说的 "continuos read errors will result in a unbreakable loop. Reboot by hand."（持续的读错误会导致死循环，只能手工重启）。
 
### 3.6 探测磁盘几何参数
 
```asm
ok_load_setup:
    ! Get disk drive parameters, specifically nr of sectors/track
    mov dl,#0x00            ! 驱动器号 = 0
    mov ax,#0x0800          ! ah=8 = 获取驱动器参数
    int 0x13
    mov ch,#0x00            ! ch 高位清零（保留磁道号）
    seg cs                  ! 段超越前缀：下一条指令用 cs 段
    mov sectors,cx          ! 把每磁道扇区数（cl）存到变量 sectors
    mov ax,#INITSEG
    mov es,ax               ! es 重新设回 0x9000（int 0x13 可能改了它）
```
 
调用 `int 0x13` 的"功能 08：获取驱动器参数"。返回值里我们关心 `cl` 的低 6 位——**每磁道的扇区数**。把它存到一个叫 `sectors` 的变量里，后面读内核时要用。
 
📖 **概念：段超越前缀 `seg cs`**
 
`mov sectors,cx` 默认是 `mov ds:[sectors],cx`——把 `cx` 写到 `ds` 段的 `sectors` 偏移处。但这里 `sectors` 是定义在 `bootsect.s` 代码里的一个变量，它属于**代码段**（`cs` 段）。
 
所以前面加 `seg cs` 这个**段超越前缀**，告诉 CPU："下一条指令用 `cs` 段，不要用 `ds` 段"。等价于 `mov cs:[sectors],cx`。
 
这种用法在 bootsect 里反复出现，因为它把代码和数据混在同一个 `cs` 段里。后面进了内核就不会这么混着用了。
 
### 3.7 在屏幕上打印 "Loading system ..."
 
```asm
    ! Print some inane message
    mov ah,#0x03            ! ah=3 = 读取光标位置
    xor bh,bh               ! bh = 0（页号）
    int 0x10                ! 调用显示服务
 
    mov cx,#24              ! cx = 字符串长度（24 字节）
    mov bx,#0x0007          ! bh=0（页号）, bl=0x07（白字黑底）
    mov bp,#msg1            ! es:bp = 字符串地址
    mov ax,#0x1301          ! ah=0x13（写字符串）, al=0x01（移动光标）
    int 0x10
```
 
这段是给屏幕上打 "Loading system ..." 那行字。
 
为什么要先 `int 0x10` ah=3 读光标位置？因为 `int 0x10` ah=0x13 写字符串需要知道光标当前在哪——读完后光标位置存在 `dh:dl`（行:列），刚好可以传给下一次中断调用。
 
如果不读光标位置，字符串可能会从屏幕乱七八糟的位置开始打，覆盖 BIOS 自己输出的内容。这是个细节，初看会忽略。
 
`msg1` 在文件末尾定义：
 
```asm
msg1:
    .byte 13,10                     ! \r\n
    .ascii "Loading system ..."     ! 18 字符
    .byte 13,10,13,10               ! \r\n\r\n
                                    ! 共 2+18+4 = 24 字节
```
 
`13,10` 是 `\r\n`（回车换行）的 ASCII 码。
 
### 3.8 加载内核主体：调用 read_it
 
```asm
    ! ok, we've written the message, now
    ! we want to load the system (at 0x10000)
    mov ax,#SYSSEG          ! ax = 0x1000
    mov es,ax               ! es = 0x1000，目的段 = 0x10000
    call read_it            ! 调用读取子程序
    call kill_motor         ! 关闭软驱马达
```
 
把 `es` 设成 `0x1000`，然后 `call read_it` 调用一个子程序，把内核主体读到 `0x10000`。`read_it` 的细节我们待会儿单独看。
 
读完后调用 `kill_motor` 关闭软驱马达——因为 BIOS 读完后马达可能还在转，进了保护模式之后没法再用 `int 0x13` 控制它，所以**现在主动关掉**，让内核启动后处于"已知干净"的状态。这种"清理工作"的细节体现了 Linus 的工程审美。
 
### 3.9 确定根文件系统设备
 
```asm
    ! After that we check which root-device to use. If the device is
    ! defined (!= 0), nothing is done and the given device is used.
    ! Otherwise, either /dev/PS0 (2,28) or /dev/at0 (2,8), depending
    ! on the number of sectors that the BIOS reports currently.
    seg cs
    mov ax,root_dev         ! 读出编译时设定的 root_dev
    cmp ax,#0
    jne root_defined        ! 如果非 0，直接用它
 
    seg cs
    mov bx,sectors          ! 读出磁盘每磁道扇区数
    mov ax,#0x0208          ! /dev/ps0 的设备号 - 1.2MB 软盘
    cmp bx,#15
    je root_defined         ! 如果每磁道 15 扇区，认为是 1.2MB
    mov ax,#0x021c          ! /dev/PS0 - 1.44MB 软盘
    cmp bx,#18
    je root_defined         ! 如果每磁道 18 扇区，认为是 1.44MB
 
undef_root:
    jmp undef_root          ! 都不是？死循环（开发期占位符）
 
root_defined:
    seg cs
    mov root_dev,ax         ! 把最终决定的设备号写回 root_dev
```
 
如果编译时 `ROOT_DEV` 已经被设为非零值（这里是 `0x306`），就直接用编译时值；否则根据 BIOS 报告的"每磁道扇区数"猜是哪种软盘：
 
- 15 扇区/磁道 → 1.2MB 软盘（`/dev/ps0`）
- 18 扇区/磁道 → 1.44MB 软盘（`/dev/PS0`）
- 都不对 → 死循环
这种"靠物理参数猜设备类型"的做法很 1991——那个年代根本没有热插拔、没有 USB、设备种类有限，能这么写。
 
### 3.10 跳转到 setup：bootsect 的最后一行
 
```asm
    ! after that (everyting loaded), we jump to
    ! the setup-routine loaded directly after
    ! the bootblock:
    jmpi 0,SETUPSEG         ! 远跳转到 0x9020:0 = 0x90200
```
 
bootsect 全部任务完成。最后一条 `jmpi 0,SETUPSEG` 把控制权交给 setup.s。`SETUPSEG = 0x9020`，所以跳到 `0x9020:0` = 物理地址 `0x90200`——正是刚才从磁盘读 setup 时存放的位置。
 
**这一跳之后，bootsect 自己就再也不会被执行了**。它在 `0x90000` 这 512 字节的内存还在，但作为一段代码它的使命已经结束。setup.s 接手后会做硬件探测、切换保护模式，然后再交给 head.s。
 
---
 
## 四、read_it 子程序：把内核读进内存
 
`read_it` 是 bootsect 里最长、最绕的一段——因为它要应付 1991 年的两个老硬件限制：
 
1. **64KB 段边界**：实模式下 `es:bx` 寻址，`bx` 是 16 位，最多寻址 64KB。如果一次读太多就会"穿过段边界"导致地址回绕。
2. **磁盘按磁道组织**：磁盘读取是按磁道→磁头→扇区三层定位的，跨磁道时要切换磁头或柱面。
### 4.1 read_it 主循环
 
```asm
sread:  .word 1+SETUPLEN    ! 当前磁道已读扇区数（初值 = 1 + 4 = 5）
head:   .word 0             ! 当前磁头号
track:  .word 0             ! 当前磁道号
 
read_it:
    mov ax,es
    test ax,#0x0fff         ! es 必须是 0x?000 形式（低 12 位为 0）
die: jne die                ! 否则死循环
 
    xor bx,bx               ! bx = 0，段内偏移从头开始
 
rp_read:
    mov ax,es
    cmp ax,#ENDSEG          ! 已经读到 ENDSEG（0x4000）了吗？
    jb ok1_read             ! 没读够，继续
    ret                     ! 读够了，返回
 
ok1_read:
    seg cs
    mov ax,sectors          ! ax = 每磁道扇区数
    sub ax,sread            ! ax = 本磁道还剩多少扇区
    mov cx,ax
    shl cx,#9               ! cx = 剩余扇区数 × 512（要读的字节数）
    add cx,bx               ! cx = 读完后段内偏移
    jnc ok2_read            ! 没溢出（不会跨 64KB 边界）就直接读
    je ok2_read             ! 正好等于 0（完美对齐）也直接读
 
    ! 走到这里说明会跨 64KB 边界
    xor ax,ax
    sub ax,bx               ! ax = -bx = 0x10000 - bx（剩余空间）
    shr ax,#9               ! ax = 剩余空间能容纳的扇区数
 
ok2_read:
    call read_track         ! 调用真正的读扇区子程序
    mov cx,ax               ! cx = 这次实际读了多少扇区
    add ax,sread            ! ax = 当前磁道总共读了多少扇区
    seg cs
    cmp ax,sectors          ! 这个磁道读完了吗？
    jne ok3_read            ! 没读完
 
    ! 当前磁道读完了，准备换磁头/磁道
    mov ax,#1
    sub ax,head             ! ax = 1 - head（在两个磁头间切换）
    jne ok4_read            ! head=0 时 ax=1，head=1 时 ax=0
    inc track               ! head 已经是 1，要切到下一磁道
 
ok4_read:
    mov head,ax             ! 更新磁头号
    xor ax,ax               ! ax = 0（新磁道从扇区 0 开始）
 
ok3_read:
    mov sread,ax            ! 更新当前磁道已读扇区数
    shl cx,#9
    add bx,cx               ! 更新段内偏移
    jnc rp_read             ! 没溢出，继续读下一批
    ! 溢出了（要换段了）
    mov ax,es
    add ax,#0x1000          ! es += 0x1000（下一个 64KB 段）
    mov es,ax
    xor bx,bx               ! 偏移归零
    jmp rp_read             ! 继续读
```
 
逻辑听起来复杂，本质是**两层循环嵌套**：
 
- 外层（`rp_read`）：直到读够 ENDSEG 才停
- 每次（`ok1_read` ~ `ok3_read`）：算出"这一批能读多少"，调用 `read_track` 读，然后更新 `sread`/`head`/`track`/`bx`/`es`
**算"这一批能读多少"的依据是：取以下两个值的最小值：**
 
1. 当前磁道剩余扇区数（不要跨磁道）
2. 当前 64KB 段剩余空间（不要跨段边界）
如果取到第一个限制，下次循环要切磁头/磁道；取到第二个限制，下次循环要换 `es` 段。
 
### 4.2 read_track 子程序
 
```asm
read_track:
    push ax
    push bx
    push cx
    push dx
    mov dx,track            ! dx = 当前磁道号
    mov cx,sread
    inc cx                  ! cx = 起始扇区号（sread + 1，因为扇区从 1 起算）
    mov ch,dl               ! ch = 磁道号低 8 位
    mov dx,head             ! dx = 当前磁头号
    mov dh,dl               ! dh = 磁头号
    mov dl,#0               ! dl = 0（驱动器号）
    and dx,#0x0100          ! 只保留 dh 低 1 位（磁头号 0 或 1）
    mov ah,#2               ! 功能号 2 = 读扇区
    int 0x13
    jc bad_rt               ! 出错跳转
    pop dx
    pop cx
    pop bx
    pop ax
    ret
 
bad_rt:
    mov ax,#0
    mov dx,#0
    int 0x13                ! 复位驱动器
    pop dx
    pop cx
    pop bx
    pop ax
    jmp read_track          ! 重试
```
 
这是真正调用 `int 0x13` 读扇区的地方。出错就复位+重试，永远不放弃。
 
### 4.3 kill_motor：关闭软驱马达
 
```asm
kill_motor:
    push dx
    mov dx,#0x3f2           ! 软驱控制器 I/O 端口 0x3F2
    mov al,#0               ! 全部清零（停止马达 + 重置控制器）
    outb                    ! 写 al 到端口 dx
    pop dx
    ret
```
 
📖 **概念：I/O 端口与 `out` 指令**
 
x86 早期硬件用一种叫"I/O 端口"的机制和 CPU 通信——CPU 用 `in` 和 `out` 指令读写一组特殊地址（独立于内存地址空间）。每个外设占几个端口号，写不同值就触发不同操作。
 
软盘控制器在 `0x3F2`（数字输出寄存器，DOR）。把这个端口全部置 0 等于关掉马达 + 关掉所有驱动器选择 + 关掉中断+DMA 使能——一次性"重置"整个软驱状态。
 
---
 
## 五、文件末尾：数据与签名
 
```asm
sectors:
    .word 0                 ! 每磁道扇区数（运行时填入）
 
msg1:
    .byte 13,10
    .ascii "Loading system ..."
    .byte 13,10,13,10
 
.org 508                    ! 强制定位到第 508 字节
root_dev:
    .word ROOT_DEV          ! 第 508-509 字节：根设备号
boot_flag:
    .word 0xAA55            ! 第 510-511 字节：引导扇区签名
 
.text
endtext:
.data
enddata:
.bss
endbss:
```
 
`.org 508` 这条指令很关键——它告诉汇编器"下面这两个变量必须从第 508 字节开始放"，从而保证了：
 
| 字节范围 | 内容 |
|---|---|
| 0 ~ 507 | bootsect 代码 |
| 508 ~ 509 | `root_dev`（2 字节）—— 内核启动后会读这里来知道根文件系统在哪 |
| 510 ~ 511 | `boot_flag = 0xAA55`（2 字节）—— BIOS 的启动签名 |
 
最终编译出来正好 512 字节，BIOS 读完会发现最后是 `0xAA55`，确认这是引导扇区，然后跳过去执行。
 
---
 
## 六、回答开篇三个"关键点自问"
 
### 6.1 为什么要先把自己搬走？
 
短答：**为了腾出 `0x7C00` 这块地方，让后面要加载的内容不会撞到自己。**
 
详细原因：
 
`bootsect.s` 接下来要做几件事：
 
1. 把 `setup.s` 加载到 `0x90200`
2. 把 `system`（内核主体，最大 196KB）加载到 `0x10000` ~ `0x40000`
3. 后面 `setup.s` 还会把 `system` 从 `0x10000` 移动到 `0x0`（这是 0.11 的设计）
如果 bootsect 还待在 `0x7C00`，问题就来了：
 
- `0x7C00` 在 `0x10000` 之前的位置——内核主体加载不会直接覆盖它，但下一阶段 setup 把 system 移到 `0x0` 时会路过 `0x7C00`，这块如果还是代码就会被覆盖
- BIOS 数据区在 `0x400` 附近，bootsect 在 `0x7C00`，中间空间被切成碎片
- 最关键的是：**`0x7C00` 这个位置太尴尬**——它在内存最低 64KB 的中间，既不在底端、也不在顶端，会把可用内存切成两段碎片
把自己挪到 `0x90000`（接近 1MB 顶端）后：
 
- 低端连续大块内存（`0x10000` ~ `0x90000` = 512KB）全部空出来给内核用
- bootsect 自己缩到顶端边角，不碍事
- setup 紧贴 bootsect 之后（`0x90200`），方便跳转
这是一种典型的"我先清场，再让客人进来"的设计。
 
### 6.2 `0x7C00` 这个地址为什么是 BIOS 的约定？
 
短答：**1981 年 IBM PC 5150 工程师为引导扇区找的"既不挡道、又能 fit 进 32KB 内存"的地方。**
 
详细推导：
 
- IBM PC 5150 最低配置：32KB RAM，地址 `0x0000` ~ `0x7FFF`
- BIOS 自己要在内存末尾占约 1KB（栈 + 数据）：`0x7C00` ~ `0x7FFF`
- BIOS 决定把引导扇区放在自己的"前面"：`0x7C00` 开始，512 字节代码 + 512 字节栈，正好填到 BIOS 区前
这个数字一旦定下来就再也改不了——所有 OS 的引导代码都假设"我会被加载到 `0x7C00`"。Linus 1991 年写 bootsect 时也得遵守。
 
### 6.3 最后那两个字节 `0xAA55` 是做什么用的？
 
短答：**BIOS 用来识别"这扇区是不是可启动的"的特征码（boot signature）。**
 
详细：
 
BIOS 读完一个扇区（512 字节）后会做这个判断：
 
```c
if (sector[510] == 0x55 && sector[511] == 0xAA) {
    // 这是可启动扇区，跳过去执行
    jump_to(0x0000:0x7C00);
} else {
    // 不是，看下一个启动设备
    try_next_device();
}
```
 
这是 IBM 1981 年的硬性约定。`0x55` 和 `0xAA` 这两个值的二进制是 `01010101` 和 `10101010`——一对**互补的位模式**，刻意选择这种"看起来不像普通数据"的特征码，避免随机数据撞上签名。
 
如果你用十六进制编辑器看任何能启动的硬盘第一扇区，最后两字节永远是 `55 AA`（小端存储）。
 
---
 
## 七、本篇小结
 
512 字节的 `bootsect.s` 做了三件大事：
 
1. **自我搬迁**：从 BIOS 加载点 `0x7C00` 移到 `0x90000`，腾出空间给内核
2. **加载后续代码**：用 `int 0x13` 把 `setup.s`（4 扇区）和 `system`（196KB）依次读进内存
3. **交班**：用 `jmpi 0,SETUPSEG` 把控制权交给 setup.s
这一篇之后，CPU 还跑在实模式下，但所有内核组件都已经在内存里就位了。下一篇 `setup.s` 会做两件事：探测硬件参数、切换到保护模式——这是 x86 系统从 1980 年代过渡到 1990 年代的关键一跃。
 
---
 
## 关键点自问
 
- 为什么要先把自己搬走？→ [第 6.1 节](#61-为什么要先把自己搬走)
- `0x7C00` 这个地址为什么是 BIOS 的约定？→ [第 6.2 节](#62-0x7c00-这个地址为什么是-bios-的约定)
- 最后那两个字节 `0xAA55` 是做什么用的？→ [第 6.3 节](#63-最后那两个字节-0xaa55-是做什么用的)
