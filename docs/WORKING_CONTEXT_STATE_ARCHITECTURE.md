# Working Context State Architecture

This document defines Builder's automatic context-management layer. It replaces
the idea of a user-facing `Brief` mode with an internal Working Context State
that can be inspected and audited without asking ordinary users to manage agent
memory.

## Product Decision

`Brief` is not a primary user mode.

Builder still needs the underlying capability: it must automatically summarize
the current direction, track confirmed and rejected constraints, know whether a
short phrase such as `按刚才方案做` is executable, and prove which context was
used when work starts. That capability is internal Working Context State, not a
button in the composer add menu.

Users should see ordinary product language:

```text
Direction updated
Needs confirmation
Ready to execute current direction
Using approved plan
Direction changed; execution paused
```

They should not need to understand `Brief`, `WorkingBrief`, `Task Capsule`,
receipt, digest, or route-signal vocabulary.

## Why This Exists

Modern agent systems separate context management from user actions:

- provider-side caching such as DeepSeek Context Caching reduces repeated-prefix
  cost, but does not decide which facts are current or safe to execute;
- memory-first systems such as Letta/MemGPT separate in-context memory,
  searchable history, and external memory;
- temporal systems such as Zep/Graphiti model facts as current or invalidated
  over time;
- agent-memory research such as A-MEM, MemOS, and MemInsight treats memory as a
  structured, versioned, and governable resource;
- context-engineering research treats context as a dynamic supply chain of
  instructions, knowledge, tools, memory, state, and the immediate query.

Builder's near-term version should not introduce graph memory, vector stores,
or sleep-time learning yet. It should first make the current project-local
context state explicit, fail-closed, and user-comprehensible.

## Context Layers

Builder context is layered. The layers have different purposes and must not be
collapsed into one summary field.

```text
Raw History
-> Compaction Summary
-> Handoff Packet
-> Working Context State
-> Approved Plan
-> Run Context Snapshot
-> Project Memory / Long-term Memory
```

| Layer | Purpose | Authority |
| --- | --- | --- |
| Raw History | Conversation messages, tool facts, file-read summaries, task stream facts | Conversation, Task, Run stores |
| Compaction Summary | Reduce prompt size and preserve narrative continuity | Derived context assembly only |
| Handoff Packet | Imported context from another task, fork, branch, or delegated agent | Provenance-bound imported facts |
| Working Context State | Current objective, constraints, rejected directions, ready/not-ready state | Main-owned product facts |
| Approved Plan | User-reviewed plan that may authorize later execution intent | Plan Review facts |
| Run Context Snapshot | Evidence of what one execution actually used | Run-bound snapshot facts |
| Project Memory | Long-term project rules, preferences, reusable facts | Later gated memory authority |

Compaction is a token and prompt-assembly mechanism. It cannot make a stale
direction executable. Working Context State is task semantics. It decides
whether a contextual execution phrase has enough current context to build.

Cross-session handoff is neither raw chat nor compaction. It is imported
context with provenance. A handoff can explain what another task did, what it
believes is current, which files or commits it touched, and what it recommends
next. It cannot silently grant write permission, approve a plan, or override a
newer correction in the current task.

## Automatic Compaction

Automatic compaction exists to keep long sessions usable when model context is
limited. It should run as part of context assembly, not as a user-facing mode.

Trigger examples:

- prompt assembly estimates that the next request would exceed a configured
  context budget;
- old tool outputs are large enough to crowd out the latest user intent;
- repeated logs, test output, file listings, or diagnostics can be replaced by
  a bounded summary plus references;
- a resumed task needs a compact narrative before model dispatch.

Compaction output should include:

```text
CompactionSummary
- conversation_id
- source_message_range
- summary
- durable_decisions[]
- unresolved_questions[]
- omitted_large_outputs[]
- source_refs[]
- created_at_ms
```

Rules:

- compaction never changes `WorkingContextState.state`;
- compaction never marks context `ready`;
- compaction never approves a plan or grants permission;
- compaction must preserve references to source turns and omitted outputs;
- newer raw messages and task facts outrank older compaction summaries;
- if a compaction summary conflicts with a current Working Context State fact,
  the Working Context State wins.

The product may later expose a small status such as `Context compressed`, but
the first version should usually keep this automatic and quiet unless it affects
latency or recovery.

## Cross-Session Handoff

Builder needs a first-class handoff model for cases where one task inserts
context into another task: user-directed delegation, forked conversations,
branch handoff, sub-agent results, or a main task asking another task to
continue from a checkpoint.

Handoff should be stored as a bounded packet:

```text
HandoffPacket
- handoff_id
- source_thread_id
- source_session_id
- source_task_address_id
- target_thread_id
- inserted_by
- inserted_at_ms
- summary
- decisions[]
- open_questions[]
- changed_files[]
- commit_refs[]
- verification_evidence[]
- requested_next_action
- authority_claims[]
- source_refs[]
```

Ingestion pipeline:

```text
Inserted handoff message
-> HandoffPacket fact
-> provenance and authority classification
-> candidate Working Context update
-> current-session reconciliation
-> renderer-safe status projection
```

Handoff rules:

- current-session user messages outrank imported handoff text;
- imported handoff text cannot grant write permission, approve a plan, publish,
  save, or dispatch providers;
- handoff may seed `discussing` or `needs_clarification` state immediately;
- handoff may seed `ready` only when it binds to current Task Address evidence
  or an approved-plan/current-result fact and there is no newer contradiction;
- if a handoff conflicts with local context, the UI should show
  `Needs confirmation` rather than building;
- handoff summaries should not be re-compacted into anonymous prose that loses
  `source_thread_id`, commit refs, or verification evidence;
- run snapshots must record when execution used imported handoff context.

## Working Context Shape

The eventual pure main-side contract should be exact, bounded, and
reference-first.

```text
WorkingContextState
- project_id
- session_id
- task_address_id
- conversation_id
- state
- objective_summary
- confirmed_constraints[]
- rejected_constraints[]
- open_questions[]
- latest_user_intent
- source_refs[]
- compaction_refs[]
- handoff_refs[]
- invalidated_by
- approved_plan_ref
- base_revision_ref
- updated_at_ms
```

Suggested state vocabulary:

```text
empty
discussing
ready
stale
approved_plan_ready
needs_clarification
```

Minimum rules:

- ordinary chat can update discussion context without writing source;
- explicit requirement updates can move `discussing` toward `ready`;
- corrections such as `不要按刚才那个做` invalidate earlier ready state;
- an approved plan creates `approved_plan_ready` only for the current
  Conversation head;
- `按刚才方案做` can build only from `ready` or `approved_plan_ready`;
- build admission records a Run Context Snapshot that binds the selected state;
- compaction summaries cannot change `state`;
- handoff packets can inform `state`, but only after provenance and
  current-session reconciliation;
- Project Memory cannot override a newer user correction.

## Existing Builder Mapping

Current implementation pieces already approximate the first version:

- `task_brief_updated` records task-brief facts into Conversation replay;
- `brief_correction` records a not-ready direction update;
- Task Capsule contracts and stores preserve bounded internal brief evidence;
- contextual submit admission reads the latest visible Task Stream fact instead
  of reviving the first historical ready brief;
- Run Context Snapshot records whether the execution used a task capsule,
  approved plan, route purpose, project base, and permission result;
- approved-plan and draft-continuation paths bind to the current Session/Task
  Address before provider dispatch.
- cloned, forked, delegated, or manually inserted task context should be treated
  as handoff input with explicit source refs rather than as ordinary chat text.

Those pieces are enough to keep improving the Builder loop, but the long-term
architecture should not leave the meaning scattered across Task Capsule,
route-decision, and snapshot code. A future `builder-working-context-state.v1`
contract should unify the ready/not-ready/stale decision and produce a bounded
renderer-safe status projection.

## Frontend Interaction Model

The composer remains a single natural-language input. Users should not pick a
Brief mode.

### Composer Add Menu

The `+` menu should be limited to user-understandable actions:

```text
Files and folders
Plan mode
```

Later entries may add attachments, plugins, or tools when their gates exist.
`Brief` should not appear in the default add menu.

### Composer Context Bar

The composer top edge may show compact state chips. These chips explain the
current interaction state without exposing internal memory.

Recommended chips:

| Internal state | User-facing chip |
| --- | --- |
| `discussing` | `Direction updated` |
| `ready` | `Ready to execute current direction` |
| `stale` | `Direction changed` |
| `approved_plan_ready` | `Using approved plan` |
| `needs_clarification` | `Needs confirmation` |

Interaction rules:

- chips are read-only status, not authority;
- clicking a chip may open the Logs/Task inspection surface later;
- chips do not grant read/write permission;
- chips do not submit, build, save, publish, or clear context;
- chip copy must stay ordinary-user language and avoid `Brief`,
  `WorkingContextState`, `Task Capsule`, digest, receipt, or provider terms.

### Plan Mode

Plan mode remains user-visible because it is a clear action: think through a
plan before editing. It is read-only with respect to source changes.

Plan mode may produce an Approved Plan candidate. Only explicit user approval
plus later execution intent can move the work toward build.

### Context Inspection

Default composer chrome should not display the whole working context. If users
need to inspect what the assistant thinks the direction is, use an on-demand
surface:

```text
Artifact Workspace -> Logs / Task -> Current direction
```

This surface is read-only in the first version. Correction still happens through
natural language such as `不对，先别按这个方向做`.

## Frontend States

The frontend should distinguish intent, context, and permission:

```text
Intent: what the user asked for.
Context: whether the current direction is executable.
Permission: what the app may do.
```

Example flows:

```text
User discusses idea
-> Context chip: Direction updated
-> no draft, no write permission request

User says "按刚才方案做"
-> if context ready: request workspace/permission as needed, then build
-> if stale or discussing: ask for confirmation, no build

User chooses Plan mode
-> Plan mode chip appears
-> next submit creates a plan proposal, no source write

User approves plan
-> Context chip: Using approved plan
-> next execution request starts approved-plan continuation
```

## Minimum Implementation Slices

1. **Architecture docs**: record this decision and update composer/frontend
   docs so Brief is internal Working Context State.
2. **Auto-compaction contract**: add a bounded Compaction Summary fact and
   prompt-assembly rules that preserve references but cannot change readiness.
3. **Handoff contract**: add a bounded Handoff Packet fact for cross-session,
   fork, branch, and delegated-agent context, with provenance and authority
   classification.
4. **UI cleanup**: remove `Brief` from the `+` menu. Keep Plan mode and Files
   and folders. Do not remove internal Task Capsule recording.
5. **Status projection**: add a renderer-safe context-state projection with
   user-facing labels only.
6. **Contract unification**: add a pure main-side
   `builder-working-context-state.v1` contract that reads current facts and
   emits `empty/discussing/ready/stale/approved_plan_ready/needs_clarification`.
7. **Regression tests**:
   - no user-visible Brief menu item;
   - ordinary chat updates internal context without creating a draft;
   - contextual build works only from current ready state;
   - brief correction makes older ready state stale;
   - approved-plan continuation uses only the current approved head;
   - compaction summary cannot make a stale context executable;
   - imported handoff context cannot override a newer local correction;
   - execution that uses handoff context records that dependency in the Run
     Context Snapshot.

## Non-Goals

- No user-facing Brief mode.
- No graph/vector memory in the near-term Builder loop.
- No sleep-time or background token-running memory reflection.
- No Project Memory overriding current user corrections.
- No renderer authority to write, clear, or approve Working Context State.
- No context chip that acts like permission, Save, publish, or delete authority.
- No handoff packet that silently becomes write permission, approved-plan
  authority, or current-session user intent.
