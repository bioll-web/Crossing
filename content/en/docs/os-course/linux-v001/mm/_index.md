---
title: "mm 内存管理"
weight: 4
bookCollapseSection: true
---

# mm 内存管理

x86 的内存管理有两层：**分段 + 分页**。v0.01 的策略是"分段基本透明、主要靠分页"，这也是后来 Linux 一直延续的路线。
