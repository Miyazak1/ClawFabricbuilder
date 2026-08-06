# Native Kernel Strategy

This document records the technology direction for native code in ClawFabric
Builder.

## Decision

Builder does not have a near-term Rust, Go, C#, or other native rewrite track.

The current product implementation remains centered on Electron, React,
TypeScript, and Node/Electron main-side contracts. That is the fastest path for
the active work: the trusted coding loop, continuing conversation, Permission,
Review, Revision, Work Capsule, provider canaries, and ordinary-user desktop
experience.

Native code is a future implementation option for narrow kernels only when a
specific bottleneck or trust boundary requires it.

## Rationale

The AI coding-agent ecosystem does not point to one universal language choice.
Terminal-first single-binary tools often choose Rust or Go. IDE, desktop, SDK,
and multi-entry products commonly keep TypeScript, Electron, Node, C#, or Python
in the main product surface.

ClawFabric Builder is currently limited by product semantics and trust
boundaries, not by CPU-bound native performance. A rewrite would add build,
packaging, IPC, Windows release, debugging, and test complexity before the core
Builder loop is proven.

The product risk areas remain:

- build intent versus read-only chat;
- source, Permission, Review, Revision, and Save authority;
- provider and package canary reliability;
- restart-safe facts;
- Work Capsule provenance and export boundaries;
- ordinary-user clarity.

Changing implementation language does not solve those boundaries by itself.

## Allowed Future Native Kernels

Native code may be introduced later as a sidecar, worker, or library behind a
small stable interface when evidence proves it is needed.

Candidate areas include:

- generated-code sandbox or runtime supervisor;
- large source-tree indexing;
- diff or patch application;
- filesystem watching;
- package and binary verification;
- high-performance search or cache;
- platform-specific isolation helpers.

Each native kernel must have its own gate, threat model where relevant, package
evidence, crash/restart behavior, and clear ownership boundary.

## Non-Goals

- No full application rewrite for trend alignment.
- No replacement of the existing Electron main contracts without a separate
  migration plan and evidence.
- No native module that grants renderer, provider, Git, filesystem, network,
  process, Save, publish, delete, or Permission authority by implication.
- No hidden native sidecar started from the renderer.
- No language or runtime capability claim before its adapter, package, and
  verification gates exist.

## Operating Rule

Use the current TypeScript/Electron architecture until one of two things is
true:

1. A measured bottleneck blocks the trusted coding loop or later agent runtime.
2. A security or isolation boundary is substantially safer as a native kernel.

Even then, introduce the smallest native boundary that solves that problem, and
keep Git, SQLite, Permission, Review, Revision, and public product facts in the
existing authority model unless a later architecture decision explicitly changes
that model.
