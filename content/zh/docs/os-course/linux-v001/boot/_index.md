---
title: "boot 引导阶段"
weight: 2
bookCollapseSection: true
---

# boot 引导阶段

从按下电源到内核接手之前的所有事，都浓缩在 `boot/` 的几个汇编文件里。这一阶段 CPU 还处于**实模式**，寻址能力只有 1MB，必须手动搬运内核到内存、切换到**保护模式**、再跳转到 C 语言入口。

本章涉及的文件：

- `boot/bootsect.s` — 512 字节主引导扇区
- `boot/setup.s` — 收集硬件信息、切换保护模式
- `boot/head.s` — 保护模式下的最后准备，跳入 `main.c`
