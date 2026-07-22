# Legacy Documentation Migration Map

## Purpose

The standalone Builder was extracted from `D:\CODE\ClawFabric v5` to escape
legacy application coupling. This file records which ideas were rewritten into
the new authority and which documents remain historical references.

No document migration creates a runtime, package, import, or data dependency on
the old repository.

## Rewritten Into New Authority

The following old documents contain product principles that are now rewritten
in this repository:

| Old document | New authority |
| --- | --- |
| `CLAWFABRIC_AGENTIC_WORKFLOW_ENGINEERING_PRODUCT_STRATEGY_2026_07_15.md` | `PRODUCT_VISION_AND_ROADMAP.md` |
| `CLAWFABRIC_AGENTIC_WORKFLOW_ENGINEERING_REFACTOR_TRANSITION_ROADMAP_2026_07_15.md` | `PRODUCT_VISION_AND_ROADMAP.md`, `ARCHITECTURE.md` |
| `CLAWFABRIC_AGENTIC_WORKFLOW_ENGINEERING_EXECUTION_INDEX_2026_07_15.md` | `docs/README.md` |
| `AI_NATIVE_COLLABORATION_AGENT_COWORKER_AUTOMATION_POLICY_P3.md` | Agent stages and authority rules in the roadmap and trusted-work architecture |
| `AI_NATIVE_COLLABORATION_COMMUNITY_AND_DELIVERY_NETWORK_P3.md` | Collaboration and community boundaries in the roadmap and trusted-work architecture |
| `AI_NATIVE_COLLABORATION_DOMAIN_MODEL_P3.md` | Selected actor/run/artifact/review principles in the trusted-work architecture |

The new documents supersede these old files for standalone Builder product
decisions. They intentionally remove old routes, APIs, database assumptions,
and legacy UI ownership.

## Principles Only - Do Not Copy Implementations

These old families remain useful as design evidence, but their code paths and
wire contracts are not new-repository authority:

- Workflow Bundle, canonical plan, conformance, and sandbox gate documents;
- permission, idempotency, migration, event, and state-machine contracts;
- contribution admission, review, feedback, and trusted share projections;
- Rudder-inspired shell and progressive-disclosure visual specifications;
- Capability Run, Artifact, and provider governance safety evidence.

Reusable ideas include fail-closed validation, immutable versions, scoped
permissions, append-only attempts, explicit contribution admission, provenance,
and package canaries. Any reused implementation must be deliberately extracted,
minimized, tested, and recorded in `provenance/extraction-manifest.json`.

## Remain in the Old Repository

The following stay as compatibility or historical material and should not be
migrated into the standalone product docs:

- legacy Chat, ChatCreatePage, and chat-planner implementation gates;
- Canvas/Flow product pages and Canvas definition ownership;
- Job/JobMeta/DAG product surfaces;
- server Workspace Current State and Result Rail phases;
- old persisted-collaboration routes and backend database rollout details;
- Auto Edit product contracts;
- media-specific workflow fixtures and provider integrations;
- obsolete file lists, checkpoint handoffs, and release-specific test reports.

## Migration Rules

1. Rewrite current intent; do not bulk-copy old documents.
2. Never treat an old status label such as `execution-ready` as authorization in
   the new repository.
3. Do not reuse old identities for Project, Agent, Space, Run, or Artifact.
4. Do not import old application modules or add relative paths to the old tree.
5. Preserve useful security evidence through narrow extraction and new tests.
6. Keep future migration explicit, read-only at the source, and reversible.
