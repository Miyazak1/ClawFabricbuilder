# Agent Companion Current Implementation Gap Audit

Date: 2026-08-18

Status: implementation gap audit for the Agent-first product plan.

Related documents:

- [Agent Companion Product Architecture Index](AGENT_COMPANION_PRODUCT_ARCHITECTURE_INDEX.md)
- [Task Conversation Management Architecture](TASK_CONVERSATION_MANAGEMENT_ARCHITECTURE.md)
- [Agent Project Task UI Migration Plan](AGENT_PROJECT_TASK_UI_MIGRATION_PLAN.md)
- [Task Intent Routing And Plan Mode Spec](TASK_INTENT_ROUTING_AND_PLAN_MODE_SPEC.md)
- [Agent Companion Memory Architecture](AGENT_COMPANION_MEMORY_ARCHITECTURE.md)
- [Agent Companion Left Sidebar Architecture](AGENT_COMPANION_LEFT_SIDEBAR_ARCHITECTURE.md)
- [Agent Companion Settings and Context Architecture](AGENT_COMPANION_SETTINGS_AND_CONTEXT_ARCHITECTURE.md)

## Purpose

This audit answers a practical question:

```text
Given what Builder already implements, what is actually missing before the
Agent friend -> Project -> Task conversation model becomes real?
```

The answer is not "start over." Builder already has a strong fact layer. The
missing work is mostly product projection, UI, routing closure, memory storage,
and long-running Agent control.

## Target Product Shape

```text
Agent friend
-> projects
   -> task conversations
      -> plans
      -> builds
      -> reviews
      -> completion summaries
      -> memory proposals
-> Agent settings
-> Agent memory
-> standing intents
-> activity / parallel task monitor
```

The user should feel they are collaborating with one long-lived Agent friend,
while the system keeps each durable objective inside a separate Task boundary.

## Current Implementation Summary

| Area | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Project catalog UI | Implemented | `src/features/builder/presentation/BuilderProjectCatalog.tsx` | Project-first, saved projects plus in-progress workspaces |
| Selected project shell | Implemented | `src/features/builder/presentation/BuilderPage.tsx` | Project title/header, composer, activity timeline, right workspace |
| Conversation event chain | Implemented | `electron/builder-conversation-records.cjs` | Append-only event facts with sequence, digest, payload, authority |
| Conversation replay | Implemented | `electron/builder-conversation-replay.cjs` | Reconstructs turns, runs, queued followups, tool calls, reviews |
| Public task stream | Implemented | `electron/builder-task-stream-projection.cjs` | Safe projection for renderer timeline |
| Runtime streaming projection | Implemented | `programming_runtime_assistant_message` and `programming_runtime_tool_activity` items | Supports Codex-like activity rendering foundation |
| Task Capsule | Partially implemented | `electron/builder-task-capsule-contract.cjs` | Current brief and continuation readiness exist, but UI is not Task-first |
| Task Capsule store/recording | Implemented main-side | `electron/builder-task-capsule-recording-service.cjs` | Records verified brief updates from conversation events |
| Session/Task Address | Partially implemented | `docs/BUILDER_SESSION_TASK_ADDRESS_ARCHITECTURE.md`, main stores/services | Product address facts exist, UI lookup/lifecycle not complete |
| Intent routing local rules | Implemented | `src/features/builder/application/builderComposerIntent.ts` | Ask/Plan/Build/update brief/continue/active-run controls |
| Semantic route classifier | Implemented but underused | `electron/builder-semantic-route-classifier.cjs` | Correct prompt exists; trigger policy needs expansion |
| Plan proposal path | Implemented but not fully closed | `proposePlan`, Plan source read approval, Plan review | Some Plan-like requests can still fall back to answer/clarify |
| Write permission gate | Implemented | current project write approval flow | Build path is permission-aware |
| Agent definition/version | Implemented main-side | `electron/builder-agent-definition-contract.cjs`, store | Not yet user-facing Agent settings |
| Agent assignment/supervision/budget | Implemented main-side | `electron/builder-agent-assignment-contract.cjs`, supervision, budget files | Strong autonomous-work skeleton, not visible as Agent friend UI |
| Agent task context snapshot | Implemented skeleton | `electron/builder-agent-task-context-snapshot.cjs` | Has `included_memory_ids`, but memory facts are not implemented |
| Agent memory fact store | Missing | no `builder-agent-memory-*` implementation found | Only memory ids appear as refs in tests/contracts |
| Standing intents | Missing | no standing intent store/UI found | Needed for long-running online Agent |
| Agent settings UI | Missing | no Agent settings frontend | Needed for friend identity, autonomy, memory policy |
| Agent-first sidebar | Missing | current catalog is Project-first | Needs Agent -> Project -> Task read model |
| Parallel task monitor | Missing or not productized | activity projection is single current project/task oriented | Right rail monitor needs durable task rows |
| Task lifecycle UI | Missing/partial | address docs/stores exist, UI absent | Reopen/fork/archive/delete not surfaced |
| Loading/replay stability | Known risk | existing loading audit and user screenshots | Must stabilize before deeper hierarchy |

## What Is Strong Already

### Main-Side Authority Discipline

The codebase consistently keeps authority in main-owned contracts/stores. Many
records explicitly deny renderer authority, provider dispatch, source mutation,
permission grants, and Git mutation unless that service is responsible for it.

This is a major advantage for Agent-first evolution. The product can add Agent
memory and long-running work without letting UI state become authority.

### Event Replay Foundation

Conversation history is not just freeform chat. It is a canonical event chain
with replay logic. This is exactly what Task conversations need:

```text
event facts
-> replay
-> public projection
-> UI timeline
```

The future Task conversation should reuse this pipeline rather than inventing a
separate chat history store.

### Task Capsule Foundation

Task Capsule already gives Builder a place to store current brief and
continuation readiness. This supports:

- "continue";
- "do it";
- "按刚才方案做";
- "继续优化";
- later Task completion summaries.

The gap is that users do not yet see Task as the main object.

### Semantic Routing Foundation

The semantic classifier prompt already encodes the hard distinction:

```text
做一个静态博客实施计划 -> Plan
做一个计划管理页面 -> Build
```

That means the product does not need a new conceptual classifier from scratch.
It needs better trigger policy, renderer/main consistency, and test coverage.

### Agent Work Skeleton

Agent definition, assignment, supervision, budget, delegation, and task context
snapshot contracts already exist. These are not yet an Agent friend product UI,
but they are the correct low-level facts for future autonomy.

## What Is Weak Or Missing

### Agent Is Not Yet The Product Entry

Current left sidebar starts from Projects. There is no user-visible Agent list,
selected Agent home, Agent header, Agent settings, memory review, or standing
intent list.

Impact:

- the product feels like a project generator/editor, not a long-term
  collaborator;
- Agent identity and memory cannot become visible or trusted;
- parallel/background work has no natural owner.

### Task Is Not Yet The Visible Conversation Boundary

Task Capsule and Task Address exist, but the UI still mostly exposes project
and conversation activity. A user cannot yet manage tasks as durable units:

- reopen;
- resume;
- fork;
- archive;
- delete;
- see completion summary;
- see memory proposals.

Impact:

- old work is hard to locate;
- "one Agent friend, many tasks" cannot feel real;
- context may look like a single project chat even when facts are task-like.

### Plan Is Not Fully First-Class

The route stack knows Plan, and Plan proposal/review paths exist, but the user
has observed Plan-like Chinese prompts that only repeat the request. Test data
also shows renderer Plan cases whose main submit fallback can still be
clarify/explanation.

Impact:

- "方案/计划" feels unreliable;
- users may not trust natural-language routing;
- explicit Plan mode becomes necessary as a workaround rather than a power
  feature.

### Memory Is Only Referenced, Not Implemented

`included_memory_ids` appears in Agent task context snapshots and tests, but
there is no concrete Agent memory fact store, memory proposal flow, inspector,
or recall integration.

Impact:

- Agent friend cannot retain durable preferences or relationship context yet;
- context snapshots cannot explain memory use with real memory facts;
- long-term continuity remains mostly conceptual.

### Long-Running Online Agent Is Not Productized

Agent assignment/supervision/budget facts exist, but there is no user-facing
standing intent or autonomy policy UI.

Impact:

- no clear way for user to say "stay online and watch this";
- background work would feel hidden or magical if added too early;
- notifications and revocation are not ready.

### Loading And Replay Stability Must Be Fixed Early

User-reported issues include old conversation loading failure and broad loading
flicker affecting chat and top bar. Agent-first hierarchy will amplify those
bugs if it sits on top of unstable projections.

Impact:

- old memory/task trust is weakened;
- sidebar rows may flicker or disappear;
- users will doubt persistence even if storage is correct.

## Priority Recommendation

### P0: Stabilize Existing Project Conversation

Do first because it protects current value.

Required outcomes:

- old conversation replay loads reliably;
- loading refresh retains last known projection;
- top bar/sidebar/composer do not flicker during activity refresh;
- Source files panel scrolls correctly;
- tool evidence row typography is unified.

Why:

Agent-first UI depends on stable projections. If current Project conversation
loads poorly, adding Agent hierarchy only adds more places to fail.

### P1: Close Task Conversation And Plan Routing

Required outcomes:

- Task conversation contract is implemented as a projection over existing facts;
- current composer target is visible;
- `计划/方案/实施计划/实现方案/步骤` reliably route to Plan when semantically
  planning;
- Plan markdown is visible in the timeline;
- renderer and main route evidence agree.

Why:

This directly addresses the user's core workflow: asking for a plan or方案 in a
project should create a reviewable Plan, not a generic echo.

### P2: Introduce Default Builder Agent Projection

Required outcomes:

- one default Builder Agent exists in projection;
- existing projects are grouped under it;
- Agent identity is visible without implying extra autonomy;
- Project-first navigation is removed after the Agent-first projection gate.

Why:

This moves the product toward Agent-first without a risky rewrite.

### P3: Add Agent Settings Skeleton

Required outcomes:

- Agent profile/settings UI;
- versioned settings facts;
- personality/capability/memory/autonomy/context tabs;
- project bindings visible under Agent.

Why:

Agent friend needs user-controlled identity and policy before memory/autonomy can
feel trustworthy.

### P4: Implement Memory Fact Store And Review

Required outcomes:

- Agent memory fact contract/store;
- memory proposal flow from task completion;
- memory inspector;
- context snapshot includes real memory ids;
- delete/archive/supersede flows.

Why:

Long-term Agent value depends on durable, inspectable memory.

### P5: Add Standing Intents And Parallel Task Monitor

Required outcomes:

- standing intent contract/store/UI;
- autonomy policy UI;
- Activity surface;
- right rail parallel task monitor;
- notification and revocation behavior.

Why:

Long-running online work should arrive only after single-task, memory, and
permission boundaries are reliable.

## Gap Matrix

| Target capability | Current implementation | Gap | Priority |
| --- | --- | --- | --- |
| Agent-first sidebar | Project catalog only | Agent list/home/read model | P2 |
| Agent settings | main-side Agent definition facts | frontend settings and structured policies | P3 |
| One Task chat | conversation event timeline exists | public Task Conversation projection and lifecycle | P1 |
| Task creation/switching | Task Capsule and Address facts partial | continuation/new-task UI and route policy | P1 |
| Plan as artifact | Plan proposal/review path exists | route closure and markdown timeline display | P1 |
| Build | write gates and draft review exist | bind consistently to Task Address | P1/P2 |
| Memory | memory ids only | memory fact store/review/recall | P4 |
| Long-running Agent | assignment/supervision/budget facts | standing intents/autonomy UI | P5 |
| Parallel tasks | single activity stream foundation | right rail monitor and conflict policy | P5 |
| Old session loading | replay exists | UI loading/flicker reliability | P0 |
| Project memory | project understanding snapshots exist | user-visible project memory distinction | P4 |
| Context transparency | run context snapshots exist | Context Preview/Memory Used inspector | P4 |

## Current-To-Target Data Path

Near-term path:

```text
persisted default Builder Agent
-> project catalog projection
-> project group under Agent
-> verified Task Address
-> Task Conversation view
-> completion summary and memory proposals
```

Because this is development-stage software without a user migration burden,
invalid fixtures are reset or migrated once:

```text
if Task Address exists:
  render Task row
else:
  show fixed development-data/setup failure
```

## Verification Strategy

Each phase needs proof tied to authoritative evidence.

The detailed product and engineering scenarios are tracked in
[Agent Companion Acceptance Test Matrix](AGENT_COMPANION_ACCEPTANCE_TEST_MATRIX.md).

| Phase | Evidence |
| --- | --- |
| P0 loading | frontend tests plus packaged/local replay smoke for old project |
| P1 routing | renderer route tests, main route tests, semantic classifier tests, task stream assertions |
| P1 Plan output | conversation replay contains `result_kind = plan`; UI renders markdown |
| P2 Agent projection | projection tests show default Agent -> Project rows without changing source authority |
| P3 settings | Agent definition/version tests plus UI tests for settings changes |
| P4 memory | memory store tests, context snapshot memory-id tests, inspector tests |
| P5 autonomy | standing intent tests, budget/permission tests, Activity monitor tests |

## Do Not Do Yet

- Do not rewrite the entire shell before stabilizing current loading.
- Do not introduce multiple visible Agents before default Builder Agent works.
- Do not add autonomous background work before standing intent UI exists.
- Do not let memory facts bypass existing permission/review gates.
- Do not make renderer state authoritative for Agent, Task, permission, memory,
  or review.
- Do not replace current conversation replay with an unrelated chat store.

## Bottom Line

Builder is closer to the target than the current UI suggests. The main side
already has many of the hard facts. The next correct move is to expose those
facts through a Task-first conversation and Agent-first navigation layer, while
closing Plan routing and loading stability before adding memory and long-running
autonomy.
