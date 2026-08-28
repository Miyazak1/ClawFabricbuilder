# Agent Companion Solution Completeness Audit

Date: 2026-08-18

Status: completeness audit and closure checklist for the Agent companion plan.

## Purpose

This document audits whether the Agent companion solution is complete enough to
guide implementation.

It does not introduce a new architecture. It checks the current documentation
set for:

- coverage;
- remaining open decisions;
- implementation readiness;
- testability;
- overlap between documents;
- missing evidence.

## Current Documentation Set

| Document | Coverage | Current role |
| --- | --- | --- |
| `AGENT_COMPANION_PRODUCT_ARCHITECTURE_INDEX.md` | entry point and reading order | authoritative index |
| `AGENT_COMPANION_CURRENT_IMPLEMENTATION_GAP_AUDIT.md` | implemented vs missing from code evidence | gap audit |
| `AGENT_COMPANION_IMPLEMENTATION_EVIDENCE_MAP.md` | current implementation mapped to target product | reuse map |
| `AGENT_COMPANION_NEAR_TERM_EXECUTION_SLICES.md` | P0/P1 engineering slices | execution sequencing |
| `AGENT_COMPANION_MVP_BACKLOG_AND_DECISIONS.md` | decisions, MVP backlog, dependency order | issue/backlog bridge |
| `AGENT_FIRST_PROJECTION_AND_DATA_CONTRACT.md` | Agent-first read models and authority boundary | projection contract |
| `AGENT_COMPANION_LEFT_SIDEBAR_ARCHITECTURE.md` | Agent -> Project -> Task navigation | UI architecture |
| `AGENT_COMPANION_SETTINGS_AND_CONTEXT_ARCHITECTURE.md` | Agent settings, permissions, context controls | settings architecture |
| `AGENT_COMPANION_MEMORY_ARCHITECTURE.md` | layered durable memory | memory architecture |
| `TASK_CONVERSATION_MANAGEMENT_ARCHITECTURE.md` | one Task conversation model | task lifecycle |
| `TASK_INTENT_ROUTING_AND_PLAN_MODE_SPEC.md` | Ask/Plan/Build routing and Plan semantics | routing spec |
| `AGENT_PROJECT_TASK_UI_MIGRATION_PLAN.md` | staged Project-first to Agent-first migration | migration plan |
| `AGENT_COMPANION_ACCEPTANCE_TEST_MATRIX.md` | acceptance scenarios and evidence | verification matrix |

## Completeness Verdict

The solution is now complete enough to start P0/P1 implementation slices.

It is not complete enough to start full Agent memory, standing intents, or
multi-Agent autonomy implementation without additional lower-level contracts.

Recommended phase gate:

```text
Start implementation:
  P0 current Builder stability
  P1 Task conversation and Plan routing

Continue design before implementation:
  P3 Agent settings write commands
  P4 memory fact store
  P5 standing intents and parallel task scheduler
```

## Coverage Matrix

| Area | Covered? | Evidence | Gap |
| --- | --- | --- | --- |
| Product mental model | yes | index, backlog decisions, task conversation doc | no major gap |
| Current implementation audit | yes | gap audit, evidence map | keep updated as code changes |
| Codex-like Task conversation | yes | task conversation doc, visual streaming spec, acceptance matrix | implementation verification still needed |
| Plan/方案 routing | yes | intent routing spec, backlog, acceptance matrix | real-key/manual route canary still needed |
| Explicit Ask/Plan/Build modes | yes | execution slices, backlog, current code evidence | final UI placement decision open |
| Loading/flicker | yes | loading audit, near-term slices, acceptance matrix | full-shell test/canary still needed |
| Source files scroll | yes | near-term slices, backlog, acceptance matrix | implementation still needed |
| Tool evidence visual contract | yes | streaming UI plan, near-term slices, backlog | implementation still needed |
| Agent-first sidebar | yes | sidebar architecture, projection contract, migration plan | implementation still missing |
| Default Agent bootstrap | yes | projection contract, migration plan, backlog | persist immediately; no synthetic compatibility phase |
| Agent settings | mostly | settings architecture, projection contract, backlog | command contracts not fully specified |
| Memory architecture | strong conceptually | memory architecture, projection contract, backlog | memory fact/store schema still needed |
| Standing intents | partial | memory architecture, backlog, projection contract | scheduler/trigger contracts missing |
| Parallel tasks | partial | sidebar architecture, projection contract, backlog | monitor/scheduler conflict rules need detail |
| Provider/privacy/security | partial | memory architecture, projection authority, existing context disclosure docs | memory egress policy needs lower-level contract |
| Verification | yes for plan level | acceptance matrix and slice exit criteria | automated tests still to be written |

## What Is Ready For Implementation

These areas have enough product and technical specification to implement now.

### Ready: Tool Evidence Row Typography

Why ready:

- current UI symptom is known;
- affected file areas are narrow;
- current task stream projection already provides tool item data;
- acceptance criteria are concrete.

Implementation source:

- `AGENT_COMPANION_NEAR_TERM_EXECUTION_SLICES.md` Slice 1;
- `AGENT_COMPANION_MVP_BACKLOG_AND_DECISIONS.md` P0.1;
- `STREAMING_ACTIVITY_UI_OPTIMIZATION_PLAN.md` Tool Row Interaction.

### Ready: Composer Context Chrome

Why ready:

- Ask/Plan/Build mode controls exist;
- generic ready label is already suppressed in current worktree;
- remaining work is mostly polish and regression coverage.

Implementation source:

- near-term Slice 2;
- backlog P0.2.

### Ready: Source Files Scroll

Why ready:

- symptom is concrete;
- source panel is already a visible side workspace surface;
- implementation can be layout-only.

Implementation source:

- near-term Slice 3;
- backlog P0.3;
- acceptance matrix P0.

### Ready: Plan/方案 Routing Tests

Why ready:

- local router and semantic classifier exist;
- exact user phrases are known;
- expected behavior is defined.

Implementation source:

- `TASK_INTENT_ROUTING_AND_PLAN_MODE_SPEC.md`;
- backlog P1.1;
- acceptance matrix P1.

### Ready: Plan Markdown Rendering Verification

Why ready:

- bounded Markdown renderer exists in current docs and file list;
- Plan result type exists in task stream fixtures/tests;
- expected UI behavior is explicit.

Implementation source:

- `CONVERSATION_VISUAL_STREAMING_AND_PLAN_MARKDOWN_SPEC.md`;
- backlog P1.2;
- acceptance matrix P1 Plan Output.

## Needs More Design Before Implementation

### Needs Detail: Agent Settings Write Commands

Current coverage:

- settings UI and projection are described;
- Agent definition/version contracts exist.

Missing:

- exact command request/response schemas for:
  - create Agent;
  - update Agent version;
  - archive/revoke Agent;
  - bind/unbind Project;
  - change autonomy level.

Recommended next design artifact:

- `AGENT_SETTINGS_COMMAND_CONTRACT.md`.

### Needs Detail: Memory Fact Store

Current coverage:

- memory philosophy and layered model are strong;
- `included_memory_ids` hook exists.

Missing:

- exact memory fact schema;
- memory candidate schema;
- memory review records;
- tombstone/delete model;
- recall query contract;
- provider egress sensitivity gate.

Recommended next design artifact:

- `AGENT_MEMORY_FACT_STORE_CONTRACT.md`.

### Needs Detail: Standing Intents

Current coverage:

- standing intents are defined as explicit, scoped, revocable prospective
  memory/autonomy records.

Missing:

- trigger schema;
- schedule source;
- idle/wakeup policy;
- notification contract;
- conflict handling for mutating background work;
- expiration/renewal model.

Recommended next design artifact:

- `AGENT_STANDING_INTENT_AND_AUTONOMY_CONTRACT.md`.

### Needs Detail: Parallel Task Execution

Current coverage:

- right-rail monitor and single focused chat are defined.

Missing:

- queue model;
- concurrency limits;
- project/file lock policy;
- conflict detection before writes;
- parent/child task result review protocol.

Recommended next design artifact:

- `PARALLEL_TASK_MONITOR_AND_CONFLICT_CONTRACT.md`.

## Open Product Decisions

These decisions remain open and should be resolved before their affected phase.

| Decision | Needed before | Options | Current recommendation |
| --- | --- | --- | --- |
| Ask/Plan/Build placement | P1 UI polish | add menu, compact segmented control, command palette | keep add menu for now; test segmented control later |
| Default Agent persistence | P2 | resolved | persist during Agent-first application bootstrap |
| Task locator scope | P2/P5 | selected project, selected Agent, all Agents | selected Agent with project filters |
| Memory review cadence | P4 | after every task, batched queue, both | batched queue plus high-confidence inline suggestions |
| First long-running demo | P5 | reminders, project watch, background review | read-only project watch before mutating automation |

## Document Overlap Boundaries

The current documentation set has some natural overlap. Use these boundaries to
avoid confusion:

- `PRODUCT_ARCHITECTURE_INDEX` is the entry point only.
- `CURRENT_IMPLEMENTATION_GAP_AUDIT` answers "what does the code currently lack?"
- `IMPLEMENTATION_EVIDENCE_MAP` answers "what can we reuse?"
- `PROJECTION_AND_DATA_CONTRACT` answers "what read models should UI consume?"
- `NEAR_TERM_EXECUTION_SLICES` answers "what should we implement next, and in
  what order?"
- `MVP_BACKLOG_AND_DECISIONS` answers "what issue-sized work exists?"
- `ACCEPTANCE_TEST_MATRIX` answers "how do we prove it?"
- `LEFT_SIDEBAR_ARCHITECTURE` answers "how should navigation feel?"
- `SETTINGS_AND_CONTEXT_ARCHITECTURE` answers "how does the user control the
  Agent?"
- `MEMORY_ARCHITECTURE` answers "how does long-term memory work?"
- `TASK_CONVERSATION_MANAGEMENT_ARCHITECTURE` answers "what is one Task chat?"
- `TASK_INTENT_ROUTING_AND_PLAN_MODE_SPEC` answers "how does user intent route?"
- `AGENT_PROJECT_TASK_UI_MIGRATION_PLAN` answers "how do we migrate without a
  shell rewrite?"

## Implementation Entry Points

Recommended first implementation branch should read:

1. `AGENT_COMPANION_NEAR_TERM_EXECUTION_SLICES.md`
2. `AGENT_COMPANION_MVP_BACKLOG_AND_DECISIONS.md`
3. `AGENT_COMPANION_ACCEPTANCE_TEST_MATRIX.md`
4. the relevant specialized spec for that slice

For example:

| Work | Specialized spec |
| --- | --- |
| tool rows | `STREAMING_ACTIVITY_UI_OPTIMIZATION_PLAN.md` |
| loading/flicker | `CONVERSATION_LOADING_PERSISTENCE_AUDIT.md` |
| Plan markdown | `CONVERSATION_VISUAL_STREAMING_AND_PLAN_MARKDOWN_SPEC.md` |
| Plan/方案 routing | `TASK_INTENT_ROUTING_AND_PLAN_MODE_SPEC.md` |
| Agent sidebar | `AGENT_FIRST_PROJECTION_AND_DATA_CONTRACT.md` and `AGENT_COMPANION_LEFT_SIDEBAR_ARCHITECTURE.md` |
| Agent settings | `AGENT_COMPANION_SETTINGS_AND_CONTEXT_ARCHITECTURE.md` |
| memory | `AGENT_COMPANION_MEMORY_ARCHITECTURE.md` |

## Completion Checklist For The Plan

The plan can be called complete when all of the following are true:

- product hierarchy is defined;
- current implementation evidence is audited;
- implementation reuse map exists;
- read model/projection contract exists;
- P0/P1 near-term slices are defined;
- MVP backlog and decisions are defined;
- acceptance matrix exists;
- docs README links the Agent companion index;
- open decisions are explicitly listed;
- missing lower-level contracts are named;
- implementation entry points are clear.

Current status:

| Requirement | Status |
| --- | --- |
| product hierarchy | complete |
| current implementation evidence | complete |
| reuse map | complete |
| projection contract | complete |
| P0/P1 near-term slices | complete |
| MVP backlog and decisions | complete |
| acceptance matrix | complete |
| README entry | complete |
| open decisions | complete |
| missing lower-level contracts named | complete |
| implementation entry points | complete |

## Remaining Design Artifacts

These are not required before P0/P1 implementation, but they are required before
later Agent companion phases:

- `AGENT_SETTINGS_COMMAND_CONTRACT.md`
- `AGENT_MEMORY_FACT_STORE_CONTRACT.md`
- `AGENT_STANDING_INTENT_AND_AUTONOMY_CONTRACT.md`
- `PARALLEL_TASK_MONITOR_AND_CONFLICT_CONTRACT.md`

## Do Not Expand The Plan Further Before P0/P1

Further planning now has diminishing returns unless it serves one of the named
later contracts.

The next best work is implementation and verification of:

1. Tool Evidence Row typography;
2. Composer chrome regression coverage;
3. Source files scroll;
4. loading/flicker stability;
5. Plan/方案 routing;
6. Plan Markdown in chat.

## Bottom Line

The Agent companion solution is now sufficiently specified for near-term
implementation.

The safe handoff is:

```text
P0/P1 implementation may begin.
P2 Agent projection may begin after P0/P1 evidence.
P3-P5 need lower-level command/store/scheduler contracts before coding.
```
