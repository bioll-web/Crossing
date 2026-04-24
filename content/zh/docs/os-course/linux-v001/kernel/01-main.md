---
title: "main.c：C 世界的入口"
weight: 1
---

# main.c：C 世界的入口

`init/main.c` 是第一个用 C 写的函数，它按顺序初始化各个子系统，最后进入 `init()` 创建 1 号进程。读这个文件相当于看一遍"内核是如何组装自己的"。

初始化顺序（v0.01）：

1. `mem_init()` — 建立内存管理数据结构
2. `trap_init()` — 安装异常/中断向量
3. `sched_init()` — 初始化进程 0，准备时钟中断
4. `buffer_init()` — 磁盘缓冲区
5. `tty_init()` — 终端
6. 打开中断，`move_to_user_mode()`

> 本章笔记待补充。
