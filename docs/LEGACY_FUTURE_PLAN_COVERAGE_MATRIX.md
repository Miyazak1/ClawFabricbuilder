# Legacy Future Plan Coverage Matrix

## Purpose

This matrix records how future-facing plans from `D:\CODE\ClawFabric v5\docs`
map into the standalone Builder authority.

It is not a migration permission. Old documents remain reference material only.
They do not create runtime, package, import, protocol, renderer, API, schema, or
data compatibility obligations for `D:\CODE\clawfabric-builder`.

The standalone Builder is still before real-user data migration. The default
product posture is clean architecture first: no compatibility layer for old
projects, old provider profiles, old APIs, old renderer state, or old v1 schema
is created unless a future real-user migration gate explicitly authorizes it.

## Classification

| Status | Meaning |
| --- | --- |
| `rewritten` | The old intent is already expressed as new Builder authority. |
| `summarized` | The old family is represented at roadmap or gate level, but not as a detailed contract. |
| `principles-only` | Useful ideas may inform future work, but implementation details and old authorities are excluded. |
| `future-candidate` | The topic likely needs a later standalone Builder contract before implementation. |
| `intentionally-excluded` | The old product surface or compatibility shape should not migrate into Builder. |

## Coverage Matrix

| Old document family | Representative old documents | Coverage | Builder stage | New authority | Notes |
| --- | --- | --- | --- | --- | --- |
| Agentic product strategy and refactor roadmap | `CLAWFABRIC_AGENTIC_WORKFLOW_ENGINEERING_PRODUCT_STRATEGY_2026_07_15.md`, `CLAWFABRIC_AGENTIC_WORKFLOW_ENGINEERING_REFACTOR_TRANSITION_ROADMAP_2026_07_15.md`, `CLAWFABRIC_AGENTIC_WORKFLOW_ENGINEERING_EXECUTION_INDEX_2026_07_15.md` | `rewritten` | Now/Next/Later | `PRODUCT_VISION_AND_ROADMAP.md`, `IMPLEMENTATION_PLAN.md`, `ARCHITECTURE.md` | Rewritten around standalone Builder, local-first facts, and independent desktop gates. Old route/API/database assumptions are removed. |
| Conversation, task stream, and coding-agent references | `CHAT_*`, `AI_NATIVE_COLLABORATION_CONVERSATION_*`, Codex/DotCraft/Claude Code reference notes | `rewritten` | Now/Next | `BUILDER_CONVERSATION_TASK_STREAM_MVP.md`, `CODING_AGENT_SOURCE_REFERENCE_AUDIT_2026_07_22.md` | Builder uses project-local conversation, task, run, candidate, review, and save. It does not revive legacy Chat or generic provider authority. |
| Trusted collaboration fact model | `AI_NATIVE_COLLABORATION_DOMAIN_MODEL_P3.md`, `AI_NATIVE_COLLABORATION_ARCHITECTURE_CONSISTENCY_MAP_P3.md`, `AI_NATIVE_COLLABORATION_STATE_MACHINES_P3.md` | `summarized` | Now/Next/Later | `TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md` | Core facts are retained as new names and gates: Project Version, Task, Run, Artifact, Review, Permission, Contribution, Delegation, Publication. Old state tables are not imported. |
| Human-AI collaboration and review loop | `AI_NATIVE_COLLABORATION_REVIEW_CARD_INTERACTION_SPEC_P3.md`, `AI_NATIVE_COLLABORATION_ARTIFACT_REVIEW_DELIVERY_WRITE_P3.md`, `AI_NATIVE_COLLABORATION_PROJECTION_UTILITY_*` | `summarized` | Next | `IMPLEMENTATION_PLAN.md` Gate F2-F5, `TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md` | Review and save become explicit Builder gates. UI projections are future implementation details, not facts. |
| Agents as coworkers | `AI_NATIVE_COLLABORATION_AGENT_COWORKER_AUTOMATION_POLICY_P3.md`, `OPERATIONS_FIRST_AGENT_BLUEPRINT.md` | `summarized` | Later | `PRODUCT_VISION_AND_ROADMAP.md` Stage 3, `IMPLEMENTATION_PLAN.md` Track A | Agents become governed actors with identity, scope, permission, budgets, task/run history, pause/resume/cancel, and review. Old API endpoints and component lists are not copied. |
| Agent-to-agent delegation | Agent coworker policy, architecture consistency map, automation policy notes | `summarized` | Later | `TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md` Gate A2 | Delegation is authority intersection. Child agents cannot inherit broader permissions or silently mutate project truth. |
| Permissions, idempotency, transaction, and state-machine safety | `AI_NATIVE_COLLABORATION_CROSS_OBJECT_TRANSACTION_IDEMPOTENCY_CONTRACT_P3.md`, `AI_NATIVE_COLLABORATION_PERMISSION_ERROR_FEATURE_FLAG_CONTRACT_P3.md`, `AI_NATIVE_COLLABORATION_STATE_MACHINES_P3.md` | `principles-only` | Next/Later | `IMPLEMENTATION_PLAN.md` Gate F6, `TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md` | Fail-closed validation, append-only attempts, idempotent decisions, and explicit permission facts are retained. Old services, tables, and route contracts are excluded. |
| Contribution, inbox, admission, and share-for-review | `AI_NATIVE_COLLABORATION_CONTRIBUTION_ADMISSION_IMPLEMENTATION_GATE_P3.md`, `AI_NATIVE_COLLABORATION_CONTRIBUTION_INBOX_ADMISSION_WRITE_P3.md`, `AI_NATIVE_COLLABORATION_ARTIFACT_REVIEW_DELIVERY_WRITE_P3.md` | `future-candidate` | Later | `IMPLEMENTATION_PLAN.md` Track B/C, `TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md` | External input must enter as Contribution and require Review before materialization. A future Builder contract must define local-first admission before any network or team surface ships. |
| Spaces, contacts, chat, activity, and inbox | `PERSONAL_WORKSPACE_*`, `AI_NATIVE_COLLABORATION_CONVERSATION_ENTRY_NAVIGATION_MODEL_P3.md`, `AI_NATIVE_COLLABORATION_DELIVERY_ATTENTION_POLICY_P3.md` | `summarized` | Later | `PRODUCT_VISION_AND_ROADMAP.md`, `IMPLEMENTATION_PLAN.md` Track B | Spaces organize work and people; Contacts/Chat are communication; Activity/Inbox are projections. None becomes project source authority. |
| Community, channels, moderation, broadcast, and delivery network | `AI_NATIVE_COLLABORATION_COMMUNITY_AND_DELIVERY_NETWORK_P3.md`, `AI_NATIVE_COLLABORATION_COMMUNITY_MVP_EXECUTION_GATE_P3.md`, `AI_NATIVE_COLLABORATION_CHANNEL_BROADCAST_SURFACE_P3.md`, `AI_NATIVE_COLLABORATION_CHANNEL_MODERATION_SAFETY_GATE_P3.md` | `summarized` | Later | `PRODUCT_VISION_AND_ROADMAP.md` Stage 6, `IMPLEMENTATION_PLAN.md` Track C, `TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md` | Community is work discovery, share, reuse, remix, and collaboration. It is not an entertainment feed and cannot mutate Project Version, Run, Artifact, Review, Permission, Contribution, or Delegation facts. |
| Capability taxonomy, package, catalog, assignment, publish, review, and run | `AI_NATIVE_CAPABILITY_TAXONOMY_AND_PACKAGE_MODEL_P3.md`, `AI_NATIVE_CAPABILITY_REGISTRY_PACKAGE_INSTALLATION_GATE_P3.md`, `AI_NATIVE_COLLABORATION_CAPABILITY_*`, `CAPABILITY_RUN_*` | `future-candidate` | Later | `IMPLEMENTATION_PLAN.md` Track C/R, `TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md` | The useful concept is reusable capability as governed work. Builder still needs a standalone Capability/Template/Workflow contract before exposing catalog, install, assign, invoke, or publish surfaces. |
| Artifacts and availability | `ARTIFACT_AVAILABILITY_*`, `AI_NATIVE_COLLABORATION_ARTIFACT_REVIEW_DELIVERY_WRITE_P3.md`, `TS_LOCAL_RUNTIME_ARTIFACT_*` | `summarized` | Next/Later | `IMPLEMENTATION_PLAN.md` Gate F5, `TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md` | Artifact identity must bind producing Revision or Run. Availability can be missing or unavailable explicitly. Old materialization stores and runtime channels are not imported. |
| Workflow Bundle, conformance, node deployment, and compile-before-run | `CLAWFABRIC_AGENTIC_WORKFLOW_ENGINEERING_TECHNICAL_IMPLEMENTATION_PLAN_2026_07_15.md`, `CLAWFABRIC_WORKFLOW_BUNDLE_*`, `NODE_PROTOCOL_DEPENDENCY_MATRIX.md`, `WORKFLOW_EXPLICIT_PORT_DATAFLOW.md` | `future-candidate` | Later | `IMPLEMENTATION_PLAN.md` Workflow and Runtime Track, `TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md` Workflow Boundary | Builder keeps workflow ideas as future governed Workflow Version, node protocol, plan, permission, and artifact flow. No old compiler, bundle ABI, node runtime, or conformance implementation is copied. |
| Generated-code sandbox and runtime governance | `CLAWFABRIC_WORKFLOW_BUNDLE_GENERATED_ESM_RUNTIME_SANDBOX_GATE_2026_07_16.md`, `CLAWFABRIC_WORKFLOW_BUNDLE_WINDOWS_NATIVE_SANDBOX_HOST_GATE_2026_07_16.md`, `CLAWFABRIC_RUNTIME_GOVERNANCE_SPEC.md` | `principles-only` | Later | `IMPLEMENTATION_PLAN.md` Gate R2, `TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md` Runtime and Tool Safety | Execution needs a separate deny-by-default runtime with termination, resource bounds, environment, filesystem, network, process, and secret controls. Until then Builder may store/display code but cannot claim arbitrary execution. |
| Provider governance and adapter architecture | `LOCAL_PROVIDER_INVOCATION_*`, `PROVIDER_OUTPUT_*`, `VIDEOLINE_PROVIDER_ADAPTER_ARCHITECTURE.md`, `OS_SECURE_STORAGE_SECRET_RESOLVER_CONTRACT.md` | `principles-only` | Now/Next/Later | `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md` Gate F1/F4/R1 | Dedicated Builder provider settings, secret store, and generation transport are current authority. Future adapters must be explicit, typed, redacted, and separately verified. Old generic provider dispatch is excluded. |
| Video, media workflow, subgraph, and workflow-as-node | `VIDEOLINE_WORKFLOW_AS_NODE_AND_SUBGRAPH.md`, `VIDEOLINE_UNIFIED_NODE_CONTRACT.md`, `VIDEOLINE_COMFY_CAPABILITY_LOADING_STRATEGY.md`, `TTS_TALK_*` | `future-candidate` | Later | `IMPLEMENTATION_PLAN.md` Workflow and Runtime Track | Media and workflow-as-node ideas may inform future project adapters, templates, capabilities, and workflow composition. VideoLine domain workflows are not Builder MVP scope. |
| Rudder-inspired shell and visual system | `AI_NATIVE_COLLABORATION_RUDDER_REFERENCE_ADAPTATION_P3.md`, `AI_NATIVE_COLLABORATION_RUDDER_INSPIRED_APPLICATION_SHELL_EXECUTION_SPEC_P3.md`, `AI_NATIVE_COLLABORATION_INTERFACE_VISUAL_SYSTEM_RUDDER_REFERENCE_P3.md`, `CLAWFABRIC_FRONTEND_DESIGN_FULL.md`, `FRONTEND_DESIGN.md` | `principles-only` | Now/Next | Current frontend implementation and future UI slices | Builder may reuse ClawFabric visual language and workbench principles. It must not import old AppLayout, old Chat components, or old route authority. |
| Canvas, Job, server Workspace, Current State, Result Rail, Auto Edit, and old backend routes | `CANVAS_*`, `CHAT_CANVAS_*`, `JOB*`, `PERSONAL_WORKSPACE_RESULT_RAIL_*`, `AUTO_EDIT_*`, server collaboration/database rollout docs | `intentionally-excluded` | None | `ARCHITECTURE.md`, `LEGACY_MIGRATION_MAP.md` | These remain historical or compatibility evidence in the old repository. Builder should not create compatibility layers, route shims, database migrations, or renderer adapters for them. |
| Release, package, evidence, and canary practice | `CLAWFABRIC_RELEASE_AND_ROLLBACK_RUNBOOK.md`, `CUTOVER_CHECKLIST.md`, `FINAL_ARCHITECTURE_QUALITY_BAR.md`, provider output release packets | `principles-only` | Now/Next/Later | `RELEASE_EVIDENCE_2026_07_22.md`, `IMPLEMENTATION_PLAN.md` Release Evidence | The practice is retained: exact diff review, tests, typecheck, build, package verification, canaries, screenshots, and clean checkpoints. Old release status labels do not authorize Builder capabilities. |

## Default Migration Policy

Standalone Builder has no real-user migration obligation today. Until a future
real-user migration gate says otherwise:

- old projects are not imported;
- old provider profiles are not read;
- old API contracts are not maintained;
- old renderer state is not restored;
- old v1 schema is not read by the Builder product; only a future, explicitly
  authorized real-user migration tool may inspect it as read-only input;
- no compatibility route, IPC channel, package file, or bridge namespace is
  created for old application behavior.

When an old plan conflicts with a clean standalone Builder contract, clean
architecture wins. A migration exception requires a written product reason,
source profiles treated as read-only, a reversible plan, tests, package
evidence, and explicit user consent.

## Fact Authority Rule

Chat, community, comments, reactions, social presence, and assistant prose are
not source authority. They may create a Message, Task, Run, Contribution, or
Review request only through an explicit Builder gate.

Project code truth is a standard Git commit, tree, and parent OID. A Builder
Project Version/Revision is product metadata that binds those Git facts; it
does not copy source into a second revision chain. Conversation, Task, Run,
Review, Artifact, idempotency, and other provider-independent product metadata
belong in the Builder metadata database. `.clawfabric/` may hold bounded
project-local identity and configuration, but it must not become another
version database.

Attempt truth remains Run. Deliverable truth remains Artifact. Human decision
truth remains Review. Allowed action truth remains Permission. External input
truth remains Contribution until accepted. Delegation truth remains explicit
and bounded.
