---
title: "Lab 5: Copy-on-Write Fork"
weight: 5
---

# Lab 5: Copy-on-Write Fork

把朴素的 fork 改造成 COW：子进程和父进程共享物理页，只在写时才真正复制。核心是**利用缺页异常作为复制触发时机**。

> 本章笔记待补充。
