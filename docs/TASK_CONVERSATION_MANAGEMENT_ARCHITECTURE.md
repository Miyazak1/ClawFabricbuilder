# Task Conversation Management Architecture

Date: 2026-08-18

Status: product and implementation architecture proposal grounded in current
Builder implementation.

Related documents:

- [Builder Session And Task Address Architecture](BUILDER_SESSION_TASK_ADDRESS_ARCHITECTURE.md)
- [Persistent Agent Task Context Architecture](PERSISTENT_AGENT_TASK_CONTEXT_ARCHITECTURE.md)
- [Agent Companion Memory Architecture](AGENT_COMPANION_MEMORY_ARCHITECTURE.md)
- [Agent Companion Left Sidebar Architecture](AGENT_COMPANION_LEFT_SIDEBAR_ARCHITECTURE.md)
- [Composer Intent Routing Architecture](COMPOSER_INTENT_ROUTING_ARCHITECTURE.md)
- [Conversation Visual Streaming and Plan Markdown Spec](CONVERSATION_VISUAL_STREAMING_AND_PLAN_MARKDOWN_SPEC.md)

## Decision

A single visible chat should represent one focused Task, not the Agent's entire
lifetime.

The higher-level product model is:

```text
Agent friend
-> Project
   -> Task
      -> Conversation
      -> Runs
      -> Plan reviews
      -> Draft reviews
      -> Context snapshots
      -> Memory proposals
```

The user may feel they are continuing to talk to the same Agent friend, but the
system should keep each durable objective inside an addressable Task. This keeps
context, permissions, replay, review, and completion manageable.

## Current Implementation Evidence

Current Builder already has several pieces needed for this model:

| Capability | Current evidence | Current shape |
| --- | --- | --- |
| Conversation events | `electron/builder-conversation-records.cjs` | append-only `builder-conversation-event.v2` chain with sequence, digest, payload, and authority |
| Conversation replay | `electron/builder-conversation-replay.cjs` | reconstructs turns, runs, queued followups, tool calls, runtime events, reviews |
| Public task stream | `electron/builder-task-stream-projection.cjs` | projects replayed events into safe public timeline items |
| Frontend timeline | `src/features/builder/presentation/BuilderPage.tsx` | renders user messages, run context, tool activity, assistant runtime messages, reviews |
| Task capsule | `electron/builder-task-capsule-contract.cjs` | stores current goal/brief/status for continuation |
| Task capsule recording | `electron/builder-task-capsule-recording-service.cjs` | records task capsule updates from verified conversation events |
| Session/Task address | `docs/BUILDER_SESSION_TASK_ADDRESS_ARCHITECTURE.md` and main stores | product-level address layer exists but is not fully exposed in UI |
| Context snapshots | `electron/builder-run-context-snapshot.cjs` and Agent task snapshots | records references used for model/tool work |
| Semantic routing | `electron/builder-semantic-route-classifier.cjs` | provider-backed classifier exists but is selectively invoked |

The direction is therefore right. The gap is not lack of low-level facts. The
gap is a clear product contract for how one Task chat is created, continued,
completed, reopened, and related to the Agent friend.

## Core Concepts

### Agent Friend

The durable collaborator with identity, role, memory, settings, and permissions.
The Agent can own many projects and tasks.

### Project

The workspace/folder/repository boundary. It controls file access, source
authority, save/version behavior, and project-local memory.

### Task

The durable objective. A Task can be a discussion, plan, build, review,
debugging pass, documentation pass, or long-running watch result.

### Conversation

The communication and event timeline inside a Task. It is evidence, not the
whole task state.

### Turn

One user input plus its route decision.

### Run

One answer, plan, build, check, retry, or failure attempt resulting from a Turn.

## Data Relationship

```text
Agent
  owns many Projects through explicit bindings
  owns Agent-level memory and settings

Project
  owns source/revision/workspace scope
  contains Task Addresses
  contains project memory

Task Address
  owns public task identity, title, goal, status
  binds one primary Conversation
  binds current Task Capsule
  binds plans, runs, reviews, artifacts, and completion summary

Conversation
  stores append-only events
  can be replayed into a public timeline
  provides evidence for task state updates

Task Capsule
  stores current working brief
  supports continuation phrases such as "continue" or "do it"
  is not a global memory store
```

## Conversation Is Evidence, Not Memory

The conversation timeline should preserve what happened:

- user messages;
- assistant responses;
- route decisions;
- context snapshots;
- run progress;
- tool activity;
- runtime assistant deltas;
- plan proposals;
- review decisions;
- draft candidates;
- save/version facts;
- queued followups;
- failures and retries.

It should not be used as the only source of working context. Each model turn
should assemble context from:

```text
current user message
+ current Task Capsule / Working Context State
+ accepted plan or current review state
+ recent task-local messages
+ relevant run/review facts
+ relevant project memory
+ relevant Agent memory
```

Older messages can be searched or summarized, but they should not be blindly
stuffed into every prompt.

## Task Lifecycle

Recommended lifecycle:

```text
draft
-> discussing
-> planned
-> active
-> review_needed
-> completed
-> archived
```

Failure states:

```text
blocked
cancelled
failed
stale
deleted_pending
deleted
```

Current Builder has pieces of this already:

- task capsule status: `discussing | ready`;
- route decisions: `answer | clarify | update_brief | plan | build`;
- project controller status: `answering | submitting | generating |
  draft_ready | generation_failed | submit_failed`;
- review states for plan and draft;
- product Task Address status vocabulary in the address architecture.

The next step is to align these into a single public Task status projection.

## Continuing The Current Task

The next user message should continue the current Task when:

- the selected Agent is the same;
- the selected Project is the same;
- the current Task is not completed or archived;
- the user refers to the current artifact, plan, brief, or result;
- the instruction is a refinement, correction, followup, steering, retry, or
  review decision;
- permissions needed by the instruction fit the current Task scope;
- no other visible Task has stronger recency or explicit reference.

Examples:

| User message | Route |
| --- | --- |
| "继续优化" | continue current Task if current brief or draft exists |
| "按刚才方案做" | build only if an approved/current plan exists and permissions allow |
| "这块布局乱了，改一下" | build current Task if draft/artifact context exists |
| "补充一条：不要用渐变" | update current brief or steer active run |
| "重新跑测试" | run/check current Task if check capability exists |

## Starting A New Task

New Tasks may be initiated from the Agent home control-plane conversation. The
user does not need to navigate into a Project and manually create a conversation
before describing the objective. The Agent may incubate the objective in Agent
home, then create a Task only after Project scope and creation authority are
resolved.

See [Agent Home Control Plane and Task Delegation Architecture](AGENT_HOME_CONTROL_PLANE_AND_TASK_DELEGATION_ARCHITECTURE.md)
for the proposal, approval, context handoff, and parallel-work contract.

The system should start a new Task when:

- the user names a clearly new objective;
- the Project or folder scope changes;
- permission scope changes materially;
- the previous Task is completed/archived;
- the user asks for a separate plan, review, or experiment;
- the request should run in parallel;
- the request references a different historical Task;
- the Agent cannot safely decide whether continuing would pollute context.

Examples:

| User message | Behavior |
| --- | --- |
| "另外做一个发布计划" | propose or create a new Task under the same Project |
| "换到另一个文件夹做官网" | ask/confirm Project switch and create new Task |
| "开一个并行任务检查 loading 闪烁" | create parallel Task and show in monitor |
| "这个任务归档，接下来做 Agent 设置" | complete/archive current Task, then create new Task |

## Ambiguous Boundary

If the message could reasonably be either a continuation or a new Task, ask a
small routing question or show a lightweight choice.

Example:

```text
Continue current task: Streaming Activity UI
Start new task: Agent Settings UI
```

Do not ask this for obvious refinements. The Agent should be helpful, not a
form.

## Single Task Conversation Structure

Inside a Task, the timeline should group related items:

```text
User request
Context snapshot
Plan / clarification / build start
Tool activity and assistant stream
Result
Review action
Completion summary
Memory proposals
```

The frontend can render this as a chat-like timeline, but internally it should
remain an ordered projection from durable facts.

Current rendering already supports:

- user message bubbles;
- status rows;
- tool evidence rows;
- runtime assistant messages;
- plan review controls;
- draft review controls;
- failure notices.

Missing interaction polish:

- collapsible run groups;
- task-level completion summary;
- timeline locator;
- clearer distinction between "assistant prose" and "tool evidence";
- task boundary markers;
- memory proposal cards after completion.

## Plan As First-Class Task Output

Plan is not just an answer. It is a reviewable task artifact.

For Plan turns:

```text
turn_submitted
-> run_context_snapshot_recorded
-> source read approval if needed
-> plan proposal
-> run_completed(result_kind = plan)
-> plan_reviewed(approved/rejected)
```

Rules:

- "plan", "方案", "实施计划", "实现方案", "优化方案", and "步骤" can all be Plan
  intents when the user asks for a proposal before changing files;
- Plan output should appear as markdown in the chat timeline;
- Plan review should be explicit;
- approving a Plan does not itself change files;
- "按这个方案做" can create a Build run only after plan review and write
  permission gates.

Current gap:

- renderer can classify explicit Plan in several cases;
- main service still has read-only fallback paths where Plan-like requests may
  become `clarify`/`explanation`;
- the semantic classifier is only invoked for selected ambiguous cases.

## Build As First-Class Task Execution

Build is a source-changing or artifact-producing run.

For Build turns:

```text
turn_submitted
-> route_decision(build)
-> run_context_snapshot_recorded
-> write approval if needed
-> programming_run_admitted
-> runtime tool/assistant events
-> candidate ready
-> review
-> save version if accepted
```

Rules:

- Project/folder selection alone is not Build intent;
- a vague "make it better" requires prior artifact/task context;
- write permission is per Project/Task/Run;
- overlapping mutating runs should be serialized or conflict-gated;
- draft review precedes save/version.

## Ask And Discussion Inside A Task

Ask is still valuable inside a Task.

Ask can:

- explain current project state;
- compare options;
- inspect context without writing;
- clarify user intent;
- update a working brief when the user sets direction;
- produce a non-review answer.

Ask should not:

- silently create a new project version;
- promote memory;
- grant permission;
- mark a Task complete;
- treat source facts as loaded unless read authority exists.

## Active Run Input

When a run is active, user input must be routed specially.

Current implementation already recognizes:

- cancel;
- steering when allowed;
- queued followup;
- unsupported active-run input.

Rules:

- active run input belongs to the active Task by default;
- steering changes the active run if the runtime supports it;
- queued followup becomes the next turn after the active run completes;
- cancel/interrupt must be recorded as run control facts;
- input should not accidentally create a new Task while a run is active unless
  the user explicitly asks to open parallel work.

## Completion

A Task should complete with a summary that can stand on its own.

Completion summary:

```text
Task completed
- objective
- final result
- changed files or artifacts
- accepted plan/review status
- verification evidence
- unresolved risks
- memory proposals
- follow-up task suggestions
```

Completion should not erase the conversation. It should add a task-level
projection that makes the next reopen cheap.

## Reopen, Resume, Fork, Archive

Operations:

| Operation | Meaning |
| --- | --- |
| Reopen | Return to a completed/archived Task for reading or followup |
| Resume | Continue an active or blocked Task |
| Fork | Start a new Task from a selected Task state or saved revision |
| Archive | Hide from default navigation while preserving replay |
| Delete | Lifecycle operation with export/dependency checks |

Rules:

- resume should use the latest Task Capsule or completion summary;
- fork must state whether it forks conversation state, source revision, or both;
- archive/delete act on product Task Address, not raw `conversation_id`;
- old low-level `task_id` remains execution evidence, not the whole product
  identity.

## Context Assembly For A Task Turn

Recommended order:

1. System and safety instructions.
2. Agent definition/version.
3. Current permission and Project scope.
4. Current Task Address and Task Capsule.
5. Current approved Plan or review state.
6. Latest user message.
7. Recent task-local conversation messages.
8. Relevant run/review facts.
9. Project memory for this Project.
10. Agent memory relevant to this Task.
11. Handoff/delegation summaries.

Every consequential run should record a Context Snapshot containing references,
not raw prompt bodies.

## UI Contract

The task conversation view should show:

- Task title and status in the header;
- Project scope and current version in the shell/header;
- one composer target;
- mode controls when useful: Ask, Plan, Build;
- Plan markdown inline in the timeline;
- tool evidence rows with consistent typography;
- review controls near the result they review;
- compact failure/retry affordances;
- completion summary after done.

Composer rules:

- bootstrap context can show Agent/Project/folder before first submit;
- after first submit, context moves to header/shell;
- generic readiness labels should not remain visible in composer chrome;
- active mode should be clear when user explicitly selects Ask/Plan/Build;
- context details belong in Context Preview/Inspector, not permanently above
  the input.

## Storage Contract

Authoritative storage should remain main-owned.

Expected stores:

- Conversation event store;
- Task Capsule store;
- Session/Task Address store;
- Run Context Snapshot store;
- Plan/Draft Review stores;
- Completion Summary store;
- Memory Proposal store.

Renderer state is a projection. It must not be the authority for task status,
memory, permissions, or review.

## Migration From Current Implementation

### Slice 1: Public Task Conversation Contract

- Define public Task Conversation view model from current task stream.
- Keep existing project/conversation replay.
- Add explicit current Task Address reference where available.

Exit criteria:

- current UI can say which Task the composer targets;
- no migration of old rows required.

### Slice 2: Plan Output Closure

- Ensure Plan-like natural language routes to Plan when appropriate.
- Display Plan markdown in chat.
- Keep Plan review separate from Build.

Exit criteria:

- "做一个 X 实施计划" and "做一个 X 方案" produce Plan, not simple explanation;
- "做一个计划管理页面" can still route to Build.

### Slice 3: Task Boundary Decisions

- Add continuation/new-task decision helper.
- Use Task Capsule and Task Address to resolve current target.
- Ask a lightweight boundary question only for true ambiguity.

Exit criteria:

- "继续优化" continues current Task;
- "另外做一个..." creates or proposes new Task.

### Slice 4: Completion Summary

- Add task completion summary fact.
- Add UI summary at end of completed Task.
- Generate memory proposals after completion.

Exit criteria:

- reopening old Task does not require full transcript scan;
- accepted facts remain traceable to conversation/run evidence.

### Slice 5: Archive/Fork/Reopen

- Add Task Address lifecycle UI.
- Add fork semantics for conversation/source/both.

Exit criteria:

- old Tasks are manageable without relying on raw conversation ids.

## Acceptance Criteria

- One visible chat maps to one focused Task.
- The same Agent can manage many Tasks without mixing their contexts.
- Conversation events remain append-only evidence.
- Task Capsule stores current continuation context.
- Task Address is the public identity for lifecycle operations.
- Plan, Build, Ask, active-run input, and review are distinct routes.
- Plan output appears as reviewable markdown in the timeline.
- Build requires project scope and write permission.
- Continuing and starting a new Task have explicit rules.
- Ambiguous task boundaries ask a small question.
- Completion creates a durable summary and optional memory proposals.
- Renderer projections never become authority.

## Non-Goals

- No single infinite Agent transcript as the primary context store.
- No automatic conversion of every chat message into a Task.
- No hidden task switching.
- No interleaving multiple long Task streams in one timeline.
- No using raw `conversation_id` as the user-facing lifecycle model.
- No treating Plan approval as file write approval.
- No memory promotion directly from unreviewed assistant text.

## Bottom Line

The right compromise is:

```text
User feeling:
I keep talking to the same Agent friend.

System truth:
Each durable objective is a Task with its own conversation, context, run,
review, and completion boundary.
```

This keeps the product warm and continuous while preserving the engineering
boundaries needed for reliability.
