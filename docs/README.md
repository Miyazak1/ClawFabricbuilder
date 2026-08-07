# ClawFabric Builder Documentation

This directory is the product and architecture authority for the standalone
ClawFabric Builder application.

## Reading Order

1. [Product Vision and Roadmap](PRODUCT_VISION_AND_ROADMAP.md)
2. [Native Kernel Strategy](NATIVE_KERNEL_STRATEGY.md)
3. [Provider Protocol Adapter Architecture](PROVIDER_PROTOCOL_ADAPTER_ARCHITECTURE.md)
4. [Working Context State Architecture](WORKING_CONTEXT_STATE_ARCHITECTURE.md)
5. [Frontend Experience and Design System Roadmap](FRONTEND_EXPERIENCE_AND_DESIGN_SYSTEM_ROADMAP.md)
6. [Composer Intent Routing Architecture](COMPOSER_INTENT_ROUTING_ARCHITECTURE.md)
7. [Builder Session and Task Address Architecture](BUILDER_SESSION_TASK_ADDRESS_ARCHITECTURE.md)
8. [Persistent Agent Task Context Architecture](PERSISTENT_AGENT_TASK_CONTEXT_ARCHITECTURE.md)
9. [Storage Lifecycle Governance](STORAGE_LIFECYCLE_GOVERNANCE.md)
10. [Draft Checkpoint Architecture](DRAFT_CHECKPOINT_ARCHITECTURE.md)
11. [Work Capsule Architecture](WORK_CAPSULE_ARCHITECTURE.md)
12. [Trusted Work and Collaboration Architecture](TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md)
13. [Builder Conversation and Task Stream MVP](BUILDER_CONVERSATION_TASK_STREAM_MVP.md)
14. [Coding Agent Source Reference Audit](CODING_AGENT_SOURCE_REFERENCE_AUDIT_2026_07_22.md)
15. [Implementation Plan](IMPLEMENTATION_PLAN.md)
16. [Legacy Future Plan Coverage Matrix](LEGACY_FUTURE_PLAN_COVERAGE_MATRIX.md)
17. [Builder Architecture](ARCHITECTURE.md)
18. [Legacy Migration Map](LEGACY_MIGRATION_MAP.md)
19. [Release Evidence - 2026-07-22](RELEASE_EVIDENCE_2026_07_22.md)
20. [Extraction and documentation provenance](../provenance/extraction-manifest.json)

## Authority

- These documents define the future product direction for
  `D:\CODE\clawfabric-builder`.
- Documents in `D:\CODE\ClawFabric v5\docs` remain historical references and
  extraction evidence. They do not authorize dependencies on the old
  application tree or compatibility work.
- `provenance/extraction-manifest.json` records both code extraction evidence and
  the old documents rewritten into this repository's authority. Documentation
  migration creates no runtime, package, import, or data dependency.
- `LEGACY_FUTURE_PLAN_COVERAGE_MATRIX.md` classifies old future-plan document
  families as rewritten, summarized, principles-only, future-candidate, or
  intentionally excluded. It is a coverage map, not a compatibility promise.
- Product capabilities are real only when their implementation, tests, package
  verification, and required canaries pass. A roadmap item is not an execution
  authority by itself.

## Product Language

User-facing surfaces should say `Project`, `Version`, `History`, `Preview`,
`Agent`, `Task`, `Review`, `Space`, and `Share`.

Internal terms such as schema, digest, receipt, adapter, sandbox, and runtime
remain available for engineering evidence and advanced diagnostics, but are not
the ordinary user's primary interface.
