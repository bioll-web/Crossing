---
title: "Lab 2: System Calls"
weight: 2
---

# Lab 2: System Calls

给 xv6 添加新的系统调用：`trace`、`sysinfo`。重点是理解**用户态到内核态的完整链路**：用户库 stub → `ecall` → trap handler → 系统调用表 → 内核函数。

> 本章笔记待补充。
