---
title: "task_struct 与进程表示"
weight: 2
---

# task_struct 与进程表示

进程在内核中的"身份证"。v0.01 的 `task_struct` 相比现代 Linux 精简得多，但核心字段一样：

- 状态（runnable / sleeping / zombie ...）
- 计时信息
- 内存页目录指针
- 文件描述符表
- TSS 与 LDT

> 本章笔记待补充。
