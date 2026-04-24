---
title: "Lab 8: Locks"
weight: 8
---

# Lab 8: Locks

减少锁竞争：把 xv6 的全局 `kmem` 锁拆成 per-CPU 锁，把全局 buffer cache 锁改成哈希桶粒度的细锁。

要点：**锁的粒度不是越细越好**，细锁带来的管理开销有时反而更大。这一 lab 让你亲手踩一次这个坑。

> 本章笔记待补充。
