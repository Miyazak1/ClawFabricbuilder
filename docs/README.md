# ClawFabric Builder Documentation

This directory is the product and architecture authority for the standalone
ClawFabric Builder application.

## Reading Order

1. [Product Vision and Roadmap](PRODUCT_VISION_AND_ROADMAP.md)
2. [Trusted Work and Collaboration Architecture](TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md)
3. [Builder Conversation and Task Stream MVP](BUILDER_CONVERSATION_TASK_STREAM_MVP.md)
4. [Implementation Plan](IMPLEMENTATION_PLAN.md)
5. [Builder Architecture](ARCHITECTURE.md)
6. [Legacy Migration Map](LEGACY_MIGRATION_MAP.md)
7. [Release Evidence - 2026-07-22](RELEASE_EVIDENCE_2026_07_22.md)
8. [Extraction and documentation provenance](../provenance/extraction-manifest.json)

## Authority

- These documents define the future product direction for
  `D:\CODE\clawfabric-builder`.
- Documents in `D:\CODE\ClawFabric v5\docs` remain historical references and
  compatibility evidence. They do not authorize dependencies on the old
  application tree.
- `provenance/extraction-manifest.json` records both code extraction evidence and
  the old documents rewritten into this repository's authority. Documentation
  migration creates no runtime, package, import, or data dependency.
- Product capabilities are real only when their implementation, tests, package
  verification, and required canaries pass. A roadmap item is not an execution
  authority by itself.

## Product Language

User-facing surfaces should say `Project`, `Version`, `History`, `Preview`,
`Agent`, `Task`, `Review`, `Space`, and `Share`.

Internal terms such as schema, digest, receipt, adapter, sandbox, and runtime
remain available for engineering evidence and advanced diagnostics, but are not
the ordinary user's primary interface.
