---
title: "printf 是怎么接收任意多个参数的？"
weight: 1
---
 
# printf 是怎么接收任意多个参数的？
 
你第一次学 C 的时候，大概觉得 `printf` 挺神奇——
 
```c
printf("hello\n");
printf("%d\n", 42);
printf("%s is %d years old\n", "Alice", 18);
```
 
参数一会儿一个，一会儿三个，但函数签名就一个 `printf`，它怎么知道你传了几个参数？每个参数是什么类型？
 
这背后有一套叫**可变参数（Variadic Arguments）**的机制，是 C 语言里少数几个"有点黑魔法感"的特性之一。这篇文章把它从头到尾拆开，看清楚它是怎么跑的。
 
---
 
## 一、先说一个你可能没注意到的事
 
`printf` 的函数签名长这样：
 
```c
int printf(const char *format, ...);
```
 
那个 `...` 不是省略号，是真实的 C 语法——叫**省略号参数**（ellipsis），意思是"这里可以跟任意数量、任意类型的参数"。
 
C 语言里满足这种形式的函数叫**可变参数函数**（variadic function）。`printf`、`scanf`、`sprintf` 都是。你自己也可以写一个。
 
---
 
## 二、参数是怎么传进来的？
 
理解可变参数，必须先知道 C 函数调用时参数**在内存里长什么样**。
 
### 2.1 函数调用栈是一列火车
 
想象一下：你调用 `printf("%d %d", 1, 2)`，CPU 在执行这行代码之前，会把参数**从右到左**依次压进一块叫"栈"的内存区域。
 
```
高地址
┌─────────────────┐
│      2          │  ← 最后压入
├─────────────────┤
│      1          │
├─────────────────┤
│  "%d %d"        │  ← 最先压入（但最靠近函数）
├─────────────────┤
│  返回地址        │
└─────────────────┘
低地址（栈顶）
```
 
📖 **概念：为什么从右到左压栈？**
 
C 语言规定参数从右到左入栈，是为了让**第一个参数永远最靠近栈顶**。这样函数内部只需要知道第一个参数的地址，就能顺着地址往上找到第二个、第三个……
 
这个设计让可变参数成为可能：只要找到第一个固定参数的地址，后面的参数都在它"旁边"，挨着放着。
 
### 2.2 参数在内存里是连续的
 
这是关键。三个参数压栈之后，它们在内存里是**一排挨着放的**：
 
```
[format 指针][参数1][参数2][参数3]...
     ↑
  我在这里，顺着走就能找到剩下的
```
 
可变参数的原理就是：**拿到第一个参数的地址，然后用指针算术一个一个往后读**。
 
---
 
## 三、`va_list` 这套工具
 
C 标准库提供了四个宏来操作可变参数，定义在 `<stdarg.h>` 里：
 
| 宏 | 作用 |
|---|---|
| `va_list` | 声明一个"指向当前参数位置"的变量 |
| `va_start(ap, last)` | 初始化，让 ap 指向最后一个固定参数之后的第一个可变参数 |
| `va_arg(ap, type)` | 读取当前参数（类型是 type），然后 ap 往后挪 |
| `va_end(ap)` | 清理，结束可变参数读取 |
 
光看表格还是抽象，直接用代码说话。
 
---
 
## 四、自己写一个简版 printf
 
先看一个最简单的可变参数函数——把所有传入的整数加起来：
 
```c
#include <stdarg.h>
#include <stdio.h>
 
// 把 count 个整数加起来
int sum(int count, ...) {
    va_list ap;          // 声明一个"游标"变量
    va_start(ap, count); // 初始化：让 ap 指向 count 之后的第一个参数
 
    int total = 0;
    for (int i = 0; i < count; i++) {
        total += va_arg(ap, int); // 读一个 int，ap 自动往后移
    }
 
    va_end(ap);          // 清理
    return total;
}
 
int main() {
    printf("%d\n", sum(3, 10, 20, 30)); // 输出 60
    printf("%d\n", sum(5, 1, 2, 3, 4, 5)); // 输出 15
    return 0;
}
```
 
看清楚了吗？`count` 是告诉函数"后面有几个参数"的关键。**可变参数函数本身不知道有多少个参数，你必须用某种方式告诉它**。
 
`printf` 用的方式更聪明——它通过**解析格式字符串**来知道参数数量和类型。
 
---
 
### 4.1 简版 printf 的实现
 
```c
#include <stdarg.h>
#include <stdio.h>
 
void my_printf(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);  // ap 指向 fmt 之后的第一个可变参数
 
    for (const char *p = fmt; *p != '\0'; p++) {
 
        // 不是 %，直接输出这个字符
        if (*p != '%') {
            putchar(*p);
            continue;
        }
 
        // 遇到 %，看下一个字符决定类型
        p++;  // 跳过 %，看格式符
        switch (*p) {
            case 'd': {
                // %d：读一个 int，转成字符串输出
                int val = va_arg(ap, int);
                // 简单处理：用标准库输出
                printf("%d", val);  // 偷懒用系统的，真实实现要自己转换
                break;
            }
            case 's': {
                // %s：读一个 char*，逐字符输出
                char *s = va_arg(ap, char *);
                while (*s) putchar(*s++);
                break;
            }
            case 'c': {
                // %c：读一个 int（char 会被提升为 int），输出字符
                int c = va_arg(ap, int);
                putchar(c);
                break;
            }
            case '%': {
                // %%：输出一个 %
                putchar('%');
                break;
            }
            default:
                // 不认识的格式符，原样输出
                putchar('%');
                putchar(*p);
        }
    }
 
    va_end(ap);  // 清理，必须调用
}
 
int main() {
    my_printf("hello %s, you are %d years old\n", "Alice", 18);
    my_printf("pi is about %d.%d\n", 3, 14);
    return 0;
}
```
 
这个实现大概 50 行，但已经把 printf 的灵魂展示出来了：
 
1. **遍历格式字符串**，逐字符扫描
2. **遇到 `%`** 就看下一个字符，决定从 `ap` 里读什么类型的值
3. **`va_arg(ap, type)`** 每调用一次，ap 就往后挪一个 `type` 大小的位置
4. **格式字符串就是"导航图"**：它告诉 printf 参数的数量和类型
---
 
## 五、`va_start` 和 `va_arg` 在底层干了什么？
 
这两个宏是整个机制的关键，展开来看：
 
### 5.1 `va_start` 的展开
 
在 x86-64 平台上，`va_start(ap, last)` 大概展开成：
 
```c
// va_list 本质上就是一个指针
typedef char* va_list;
 
// va_start：让 ap 指向 last 参数之后的地址
#define va_start(ap, last) \
    (ap = (char*)(&(last)) + sizeof(last))
```
 
📖 **概念：`va_start` 做的事情**
 
`&(last)` 是最后一个固定参数的地址。`+ sizeof(last)` 是往后跳过这个参数的大小。结果是 `ap` 指向了紧跟在最后固定参数之后的那个位置——正是第一个可变参数所在的地方。
 
就像你站在一排人的第一个固定人旁边，伸手往右一碰，碰到的就是第一个可变的人。
 
### 5.2 `va_arg` 的展开
 
```c
// va_arg：读取当前位置的 type 类型值，然后 ap 往后移
#define va_arg(ap, type) \
    (*(type*)((ap += sizeof(type)) - sizeof(type)))
```
 
拆开来理解：
 
1. `ap += sizeof(type)`：先把 ap 往后移动 type 的大小
2. `- sizeof(type)`：再退回去，得到这个参数的起始地址
3. `*(type*)(...)`：把那个地址解释成 type 类型，取值
本质就是：**把 ap 当成一把尺子，每次量一块 type 大小的内存，读出来，然后往后挪**。
 
---
 
## 六、printf 真实的 glibc 源码是什么样的？
 
上面的简版实现只有几十行。真实的 glibc `printf` 有多复杂？
 
答案是：**几千行**。
 
不是因为原理复杂，而是因为真实的 printf 要处理的边界情况太多了：
 
| 功能 | 复杂度 |
|---|---|
| `%d`、`%s`、`%c` | 简单 |
| `%f`、`%e`、`%g`（浮点数） | 浮点转字符串本身就很复杂 |
| `%5d`（宽度）、`%-10s`（左对齐） | 对齐逻辑 |
| `%05d`（补零）、`%+d`（强制符号）| 标志位处理 |
| `%lld`、`%zu`（长度修饰符） | 不同平台不同处理 |
| 线程安全 | 加锁 |
| 国际化（宽字符 `%ls`） | wchar 处理 |
| 格式字符串安全检查 | 防止崩溃 |
 
glibc 里 `printf` 的调用链大概长这样：
 
```
printf(fmt, ...)
  └─> vprintf(fmt, ap)          ← 把 ... 转换成 va_list
        └─> vfprintf(stdout, fmt, ap)  ← 核心函数，约 2000 行
              ├─> parse_one_spec()     ← 解析一个 % 格式说明符
              ├─> _itoa_word()         ← 整数转字符串
              ├─> __printf_fp()        ← 浮点数转字符串
              └─> outstring()          ← 输出到 FILE*
```
 
核心是 `vfprintf`——它接受一个已经打包好的 `va_list`，而不是 `...`。这是一个很重要的设计：
 
```c
// printf 的真实实现只有几行
int printf(const char *format, ...) {
    va_list arg;
    va_start(arg, format);
    int done = vfprintf(stdout, format, arg);
    va_end(arg);
    return done;
}
```
 
**所有真正的工作都在 `vfprintf` 里**。这样的好处是：`fprintf`、`sprintf`、`snprintf` 都可以复用同一套逻辑，只需要换一个"输出目标"。
 
---
 
## 七、一个容易踩的坑：类型提升
 
你可能注意到上面简版里有一行注释：
 
```c
// %c：读一个 int（char 会被提升为 int）
int c = va_arg(ap, int);
```
 
为什么是 `int` 而不是 `char`？
 
📖 **概念：默认参数提升（Default Argument Promotions）**
 
C 语言规定，在可变参数里：
 
- `char` 和 `short` **自动提升为 `int`**
- `float` **自动提升为 `double`**
所以如果你传了一个 `char` 进去，它在栈上实际占 `int` 的大小。如果用 `va_arg(ap, char)` 去读，读的字节数不对，后面所有参数都会错位。
 
这就是为什么 `va_arg(ap, char)` 是未定义行为——你必须写 `va_arg(ap, int)`，哪怕你传进去的是 `char`。
 
同理，`printf` 里 `%f` 对应的是 `double`，不是 `float`——因为 `float` 在可变参数里会被提升成 `double`。
 
---
 
## 八、为什么 printf 不安全？
 
学 C 的人早晚会碰到这个问题：
 
```c
printf(user_input);  // 危险！不要这么写
```
 
如果 `user_input` 是用户输入的字符串，里面藏着 `%s`、`%n` 之类的格式符，printf 会老老实实去栈上读对应的"参数"——但那块内存里根本没有参数，读出来的是随机内存，可能泄露敏感信息，甚至让攻击者控制程序。
 
这叫**格式字符串漏洞（Format String Vulnerability）**，是 C 语言经典安全漏洞之一。
 
防御方式很简单：
 
```c
// 永远不要直接把用户输入作为第一个参数
// ❌ 错误
printf(user_input);
 
// ✅ 正确：格式字符串用 %s，把用户输入作为参数
printf("%s", user_input);
```
 
---
 
## 九、小结
 
回到最开始的问题：**printf 是怎么支持任意多个参数的？**
 
答案分三层：
 
1. **硬件层**：函数调用时，参数从右到左连续压栈。第一个参数的地址固定，后面的参数挨着排。
2. **机制层**：`va_list` 本质是一个指针，`va_start` 让它指向第一个可变参数，`va_arg` 每次读一个参数后把指针往后移。
3. **应用层**：`printf` 用格式字符串（`%d`、`%s`……）当"说明书"，边扫描格式字符串，边用 `va_arg` 按需读取对应类型的参数。
整件事的关键是一个前提：**调用者和被调用者对栈的布局有共同的约定**（这叫调用约定，calling convention）。有了这个约定，被调用函数才能安全地"往后翻"调用者压进来的参数。
 
这就是 `printf` 的全部秘密——不是魔法，是约定。
 
---
 
## 关键点自问
 
- `va_list` 的本质是什么？→ 一个指向当前可变参数位置的指针（通常是 `char*`）
- `va_start` 做了什么？→ 让 `ap` 指向最后一个固定参数之后的地址
- `printf` 怎么知道有几个参数？→ 通过解析格式字符串里 `%` 的数量和类型
- 为什么 `%c` 要用 `va_arg(ap, int)` 而不是 `va_arg(ap, char)`？→ 默认参数提升，`char` 在可变参数里被提升为 `int`
