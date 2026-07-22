# Builder Architecture

This document defines the implemented standalone Builder boundary. For the
future product stages and cross-feature fact model, read
[Product Vision and Roadmap](PRODUCT_VISION_AND_ROADMAP.md) and
[Trusted Work and Collaboration Architecture](TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md).
The delivery order and release evidence are defined in
[Implementation Plan](IMPLEMENTATION_PLAN.md).

## Product Boundary

The first product loop is: describe an idea, generate a code draft, save a revision, reopen it, revise it, and inspect a static preview.

The desktop application owns four narrow authorities:

1. Builder provider settings and encrypted credentials.
2. Bounded code-generation transport.
3. Immutable local project revisions and verified project heads.
4. A controlled renderer bridge exposing only Builder operations.

Generated JavaScript is stored and displayed but is not executed in the first release. Workflow promotion, arbitrary code execution, collaboration, and publishing require later independent gates.

The current Project Revision authority is the first member of a broader trusted
work model. Future Goal, Task, Run, Artifact, Review, Permission, Contribution,
Agent Definition/Version, Delegation, Workflow Version, Space/Membership,
Identity/Contact/Conversation, and Publication authorities must be added
independently and must not be inferred from chat, community, model identity, or
renderer state.

## Isolation Rules

- No runtime import, symlink, workspace dependency, or relative path may point to `ClawFabric v5`.
- Legacy Chat, Canvas, Job, server collaboration, Current State, Auto Edit, and Python backend code are not product dependencies.
- Extraction copies are pinned in `provenance/extraction-manifest.json` and become independently maintained after import.
- The new application uses a distinct app id, profile, protocol, and project repository.
- Existing project or provider data is never read automatically. Migration must be explicit and source profiles remain read-only.

## Repository Documentation Authority

- `docs/` is authoritative for the standalone product.
- `D:\CODE\ClawFabric v5` is a reference and compatibility repository only.
- The [Legacy Migration Map](LEGACY_MIGRATION_MAP.md) records which old ideas
  were rewritten and which old systems remain excluded.
