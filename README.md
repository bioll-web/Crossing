# Crossing

> Beyond Technical Boundaries · 跨越技术的边界

[![Site](https://img.shields.io/badge/site-bioll--web.github.io/Crossing-blue)](https://bioll-web.github.io/Crossing/)
[![Hugo](https://img.shields.io/badge/built%20with-Hugo-ff4088)](https://gohugo.io/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A technical journal on low-level systems — from digital logic and
RISC-V processor design to OS kernels and C internals.

底层系统的学习记录 —— 从数字逻辑与 RISC-V 处理器设计，
到操作系统内核与 C 语言底层机制。

---

## About

I'm a sophomore at China University of Petroleum (Beijing), majoring in
computer science. My current focus is the low-level stack: understanding
how a machine is built from transistors up, and how an operating system
manages that machine.

This repository hosts my learning notes, source-level analyses, and
hands-on implementations. Everything here is a work-in-progress — I
publish as I learn.

我是一名中国石油大学（北京）的大二学生，计算机方向。
目前的学习重点是底层栈：理解一台机器如何从晶体管层级构建起来，
以及操作系统如何管理这台机器。

本仓库收录我的学习笔记、源码级分析和动手实现。所有内容都在持续更新 ——
边学边写，边写边改。

---

## 🌐 Live Site

**[bioll-web.github.io/Crossing](https://bioll-web.github.io/Crossing/)**

## 📚 Content Tracks

Three parallel tracks this term:

| Track | Topic | Stack |
|-------|-------|-------|
| **Term 1** | OS Kernel Deep Dive | Linux 0.01 source · Silberschatz *OS Concepts* (9e) · OS in 1,000 Lines (RISC-V + QEMU) · MIT 6.828 |
| **Term 2** ⭐ | **ysyx — Processor Design** | Digital logic · CMOS gates · Verilog · RISC-V ISA · NEMU |
| **Term 3** | C Language Internals | K&R · *C and Pointers* · *Expert C Programming* |

### ⭐ Spotlight: ysyx (一生一芯)

Term 2 is the **primary focus** of this repository.

[ysyx](https://ysyx.oscc.cc/) ("One Student One Chip") is a processor
design program hosted by Nanjing University and the Institute of Computing
Technology, CAS. Participants build a functional RISC-V processor from
the ground up — starting from logic gates, progressing through
microarchitecture, and culminating in a real tape-out.

I'm currently working through the pre-study phase (digital logic + CMOS
transistor-level gate design). Future posts will cover:

- Single-cycle and pipelined CPU implementations in Verilog
- NEMU (NJU Emulator) internals
- Cache design and memory hierarchy
- The admission defense and the D/C/B/A stages

Term 2 目前是本仓库的**核心方向**。一生一芯是一个从逻辑门一路做到
真实流片的处理器设计项目 —— 它不是读懂一个 CPU，而是**让自己设计
的硅片第一次点亮**。

---

## 📖 Literature Corner *(coming soon)*

除了技术内容，我也计划加入一个**文学导读**板块 ——
记录读古典文学、哲学随笔时的一些笔记与思考。

工科人读文学并非跨界猎奇，而是因为：
**一个系统如何运作，和一个人如何存在，本质上是同一类追问。**

A Literature Corner is planned alongside the technical content —
notes on classical Chinese poetry, philosophical essays, and reading
journals. Engineering and the humanities often ask the same question
in different dialects: *how does a system come into being, and what
does it mean to live within one?*

---

## 🛠 Tech Stack

- **[Hugo](https://gohugo.io/)** — static site generator (Go)
- **[hugo-book](https://github.com/alex-shpak/hugo-book)** — documentation theme, with custom overrides
- **GitHub Pages** — hosting
- **GitHub Actions** — CI/CD auto-deployment on push to `main`

### Local Development

```bash
git clone --recursive https://github.com/bioll-web/Crossing.git
cd Crossing
hugo server
# open http://localhost:1313/Crossing/
```

## 📖 About the Name

**Crossing** — a noun that means both *a traversal* and *a point of
intersection*. In Chinese I render it as 「渡口」— a ferry crossing,
where travelers from different directions briefly meet.

The name reflects what this site attempts: to move between hardware
and software, between low-level machinery and high-level abstraction,
between engineering rigor and humanistic reflection.

站名取自 "crossing" 的双重含义：穿越 与 交汇。
中文译作「渡口」—— 一个不同方向的旅人短暂相遇的地方。

## 📬 Contact

- **Email** · 3506979657@qq.com
- **Status** · Working on Linux kernel internals & ysyx pre-study

---

*Corrections, discussions, and collaborations are welcome — especially
from anyone working on systems, HPC, or processor design.*

*若你发现技术错误，或你恰好也在做系统开发、HPC、处理器设计，
欢迎来信讨论。*
