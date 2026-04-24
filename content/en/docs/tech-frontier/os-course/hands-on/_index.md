---
title: "手写操作系统"
weight: 3
bookCollapseSection: true
---

# 手写操作系统

两个平行使用的资源：

- **OS in 1,000 Lines**（RISC-V + QEMU）— 用来在一周内建立"OS 的全景"，每一步都是小的、可验证的。
- **MIT 6.828 / 6.S081（xv6-riscv）** — 在掌握全景后深入，补齐前者刻意简化掉的部分（文件系统、锁、真实调度）。

两个项目都基于 RISC-V + QEMU，这让它们可以共用同一套工具链，学习成本叠加而不是重复。
