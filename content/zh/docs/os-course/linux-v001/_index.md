---
title: "Linux 0.01 源码解析"
weight: 1
bookCollapseSection: true
---

# Linux 0.01 源码解析

选择 v0.01 而不是 v0.11 的原因：v0.01 是 Linus 在 1991 年释出的最早可用版本，代码量约一万行，没有 SMP、没有网络栈、没有模块机制，**复杂度处于"刚好能跑起一个内核"的下限**。读它的收益是：搞清楚"到底最少需要什么"，这个下限本身就是强有力的教学素材。

参考资源：

- 源码：[TUHS 归档](https://www.tuhs.org/) 与 [elixir.bootlin.com](https://elixir.bootlin.com/linux/0.01/source)
- 辅助读物：《Linux 内核设计的艺术》（v0.11 版，但绝大部分机制与 v0.01 同源）
