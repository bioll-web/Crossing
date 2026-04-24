---
title: "缓冲区机制 buffer cache"
weight: 2
---

# 缓冲区机制 buffer cache

磁盘慢、内存快。Linux 用 `buffer_head` 在内存里缓存磁盘块，读写先走缓存再回写磁盘。这是"存储金字塔"思想在内核里的第一次落地。

> 本章笔记待补充。
