# Composer Intent Routing Architecture

## Purpose

This document defines ClawFabric Builder's own chat/build routing architecture.
It uses mature agent products as references, but it does not merge their
interaction models mechanically. ClawFabric's product target is a chat-first
local builder for ordinary users, so the composer must preserve natural
conversation while admitting work only when the user clearly asks for
side-effecting execution.

The central rule is:

```text
Workspace selection enables work.
It does not imply work intent.
```

The router must therefore decide both what the user is asking for and whether
the product is allowed to do it.

## Reference Synthesis

The reference products converge on the same boundary even though their UI and
storage models differ.

| Product | What To Learn | What Not To Copy |
| --- | --- | --- |
| Codex | Thread, Turn, Item, approval request, file-change evidence, interrupt, steer, and resumable work | developer-only repository assumptions and terminal-first density |
| DotCraft | project-local runtime, durable sessions, approvals, queued input, Goals, Agent Teams, reviewable project memory | `.craft` storage layout or treating project files as the only authority |
| Pi | JSONL session tree, fork/clone exploration, queued steering vs queued follow-up, provider abstraction, extensions/skills/packages, application-owned scrolling | unrestricted default read/write/edit/bash tools, terminal-only UI, or delegating permission to external sandboxing alone |
| aider | ask/code/architect flow; discuss first, then terse contextual execution such as `go ahead` | forcing every ordinary user to manually switch modes |
| Cursor | Ask/Agent/Manual capability split; read-only exploration is distinct from autonomous edits | closed product-specific UI assumptions |
| OpenHands | each step chooses conversation or code/tool action | unrestricted code-action runtime in the Builder MVP |
| OpenCode | action/resource permission rules, saved approvals, subagent as a permissioned action | terminal-only interaction and permissive non-interactive defaults |

ClawFabric's conclusion:

```text
Natural-language input stays single-composer.
Internal routing is explicit and testable.
Permissions are evaluated after intent, before side effects.
Task/brief state makes contextual execution possible.
```

Pi adds one important correction to the active-run model: "the user typed again
while the assistant is working" is not one behavior. Builder must classify that
input as cancel/interrupt, steering for the active turn, a queued follow-up for
after the active work completes, or a new task after the current turn is
terminal. This is a first-class route decision, not an incidental composer
state.

Pi also validates the long-term session shape: users need branching, retry,
clone, and compaction without losing durable facts. Builder should expose these
as project/task operations later, but the storage authority remains Builder's
Conversation, Task, Run, Candidate, Review, Permission, and Project Revision
facts, not Pi's JSONL layout.

The target is not merely to imitate Pi. For the capabilities Builder chooses to
adopt, the product standard is Pi parity or better while preserving Builder's
stronger desktop, review, version, and permission model:

- queued input must be at least as dependable as Pi's steering/follow-up split,
  but visible in ordinary desktop language rather than terminal commands;
- branching must be at least as safe as Pi's fork/clone tree, but bound to
  Project, Task, Run, Candidate, and Review facts instead of one session file;
- compaction must be at least as useful as Pi's compacted context, but never
  delete or blur durable work evidence;
- provider and capability abstraction must be as extensible as Pi packages, but
  every capability must declare action/resource permissions before dispatch;
- viewport ownership must match or exceed Pi's stable TUI regions: chat scrolls
  independently, composer focus survives sends, and side panels never make the
  conversation unusable.

## Product Contract

The user can:

- greet or ask questions without creating a draft;
- discuss a product, UI, or implementation direction across many turns;
- ask the assistant to summarize or refine the current plan;
- explicitly create a plan;
- say `按刚才方案做` after a confirmed brief or approved plan;
- review preview, files, changes, and logs before saving;
- continue chatting after a build without every follow-up becoming a build.

The user should not need to choose Chat or Build for every message. Explicit
Plan may remain a visible command because planning is a deliberate work mode and
is useful as a user-controlled checkpoint.

## Feedback Admission Rule

Composer feedback must be evaluated against the long-term routing model before
it becomes code. The question is not "which keyword failed today?" but whether
the feedback exposes one of these categories:

- a current chat-first or permission-boundary blocker;
- a missing route-state fact such as Task, Brief, Plan, Permission, Run, or
  Artifact evidence;
- a UI clarity issue that belongs in the conversation or artifact workspace
  slice;
- a future agent/tool/runtime capability that needs a separate gate;
- a product-model conflict that should be redesigned instead of patched.

Only current-stage routing blockers should be fixed in the active router slice.
Useful future feedback should update this document or the frontend roadmap
without pulling unfinished capabilities into the MVP. This is why
`workspace selected + exploratory plan discussion` must stay read-only now: it
is not a one-off phrase fix, it protects the core rule that workspace selection
enables work but never implies work intent.

## Routing Pipeline

Every submitted composer message follows this deterministic pipeline:

```text
1. Normalize message.
2. Load route context.
3. Classify candidate intent.
4. Resolve task/brief/plan state.
5. Admit or downgrade side-effecting intent.
6. Check permission and workspace requirements.
7. Dispatch answer, clarify, update_brief, plan, or build.
8. Record route decision evidence.
```

Route context includes:

- selected project and source-folder state;
- current conversation and active turn state;
- composer add-menu selections and active mode chips;
- active task capsule when present;
- visible working brief and confidence;
- approved plan or rejected plan state;
- current draft/candidate/review state;
- current permission policy;
- whether a run is active, interrupted, or awaiting approval;
- active-run input policy, including whether steering and queued follow-up are
  supported for the current run;
- branch/fork origin state when the conversation was cloned from another task
  or alternate direction;
- recent route decision evidence for recovery and debugging.

## Route Types

```ts
type ComposerRoute =
  | "answer"
  | "clarify"
  | "update_brief"
  | "plan"
  | "steer"
  | "queue_followup"
  | "cancel"
  | "build";
```

### answer

Use for ordinary conversation, greetings, project questions, explanations,
diagnosis, and safe read-only replies.

Examples:

- `hi`
- `你好`
- `你现在在做什么？`
- `这个项目是什么？`
- `为什么预览空白？`
- `这段代码大概是什么意思？`

`answer` may read already-admitted project context when read permission exists,
but it cannot write files, create a candidate, save a version, publish, run
commands, or create child tasks.

### clarify

Use when the user is exploring an idea or asking for judgment but has not yet
asked the assistant to execute.

Examples:

- `我想先聊一下这个页面怎么做`
- `我们先确定风格`
- `我想做一个 3D 官网，你觉得怎么设计？`
- `这个登录页应该走什么视觉方向？`

`clarify` can ask questions, compare options, and propose structure. It may
produce a draft brief proposal, but it must not create a code candidate.

### update_brief

Use when the message adds durable product intent or confirms a design decision
without asking for immediate execution.

Examples:

- `目标用户是小团队`
- `风格就按 Codex 那种克制深色工具感`
- `先做桌面端，不考虑移动端`
- `保存这个方向，后面按这个来`

`update_brief` writes Task/WorkingBrief facts, not source files. It is the bridge
that makes later contextual execution possible.

### plan

Use when the user explicitly asks for a plan, enters plan mode, or requests a
reviewable checkpoint before implementation.

Examples:

- `先给我方案`
- `列一个实现计划`
- `进入计划模式`
- `先不要写代码，规划一下`

`plan` may create a proposed plan and a review checkpoint. Approval of the plan
can promote contextual execution phrases such as `执行` into `build`.

Plan can be selected by UI as well as by natural language:

- `composerMode: "plan"` from the `+` menu forces the next eligible submit
  through the `plan` route;
- the active mode must be visible as a removable composer chip;
- after submit, the mode is consumed unless the user pins it explicitly in a
  later product slice;
- while plan mode is active, source writes, Save, command execution, publish,
  and delegation stay unavailable;
- if source context is needed for the plan, dispatch requests source-read
  approval rather than silently reading files.

Current Plan mode checkpoint: active composer Plan mode is part of route
context. The next non-empty submit records `route=plan`,
`dispatch=plan`, `matchedSignals=["composer_mode_plan"]`, and no
`write_project` permission requirement, even when the wording looks like a
direct build request. This keeps the visible mode chip, route evidence, and
main work dispatch aligned.

Current natural plan request checkpoint: explicit plan wording such as
`帮我先做下方案`, `先给我一个方案`, or `Plan this first` also routes to
`plan` in the renderer for a saved project or a bound local workspace that has
not been saved as Version 1 yet. Save Version is not a planning prerequisite.
The main-owned `submit` fallback recognizes the same public intent shape but
fails closed to a read-only `clarify` route with
`matchedSignals=["explicit_plan"]`, because `submit` is not the plan proposal
authority and must not create a draft from a plan request.

### build

Use only when the user clearly requests side-effecting creation or modification.

Examples:

- `创建一个登录页`
- `帮我做一个网页 3D`
- `把按钮颜色改成绿色`
- `开始实现`
- `按刚才方案做`
- `就按这个方案执行`

`build` requires a workspace, an admitted task/brief or sufficiently explicit
instruction, and write permission. Missing requirements downgrade to
`clarify` or a permission/workspace request, not a silent failure.

### steer

Use only during an active turn when the user's new input is clearly meant to
adjust the current in-flight work before it finishes.

Examples:

- `等一下，这个页面要偏暗色`
- `这里别用卡片，改成表格`
- `补充一下，移动端也要考虑`

`steer` may append a steering event to the active Turn only when the current
provider/tool segment supports safe steering. If the segment cannot accept new
input, the route must downgrade to `queue_followup` or ask whether to cancel.
It must not mutate an already-issued provider or tool request.

### queue_followup

Use during an active turn when the new input is a normal next question or next
instruction that should run after the current work reaches a terminal state.

Examples:

- `做完后再解释一下你改了什么`
- `下一步帮我把配色统一`
- `等这个结束后再给我一个总结`

Queued follow-up preserves the visible chat history and the user's text. It
does not create a second simultaneous build, does not clear the active response,
and does not gain permission from the active Run.

### cancel

Use when the user clearly asks to stop the active turn.

Examples:

- `停止`
- `取消`
- `别做了`
- `stop`

Cancel is an asynchronous command. The UI can show that cancellation was
requested, but terminal cancellation is only proven by a later Run completion
fact.

## Admission Rules

Intent classification is not enough. Side-effecting work must pass admission.

### Rule A - Chat Is Default

If a message can reasonably be handled as conversation, and it does not clearly
request side effects, route to `answer`, `clarify`, or `update_brief`.

### Rule B - Workspace Is Not Intent

Selected project/source folders do not increase build likelihood. They only
make build possible after execution intent is admitted.

### Rule C - Contextual Execution Needs Context

Short execution phrases such as `开始`, `做吧`, `继续`, `go ahead`, or
`按刚才方案做` route to `build` only when one of these exists:

- confirmed working brief;
- approved plan;
- active draft/candidate requiring a localized change;
- active task with clear internal brief state and no blocking open question.

Otherwise route to `clarify`.

### Rule D - Exploratory Creation Is Not Execution

Messages like `我想做一个...你觉得呢` or `我们能不能做...` route to `clarify` or
`update_brief`, even when they contain creation nouns.

### Rule E - Explicit Imperative Can Build

Messages with direct commands such as `创建`, `生成`, `实现`, `修改`, `加一个`,
`删除`, `替换`, `make`, `build`, `implement`, or `change` can route to `build`
when they pass workspace and permission checks.

### Rule F - Questions About Artifacts Stay Answer

Questions about preview, blank result, changes, source, history, or errors route
to `answer` unless the user asks to fix or modify.

### Rule G - Ambiguity Downgrades

When route confidence is low and build would create or modify files, choose
`clarify` and ask a compact question. Never build because the router is unsure.

### Rule H - Active Runs Have Separate Commands

During an active run:

- `stop`, `cancel`, `暂停` -> `cancel`;
- direct corrections about the in-flight result -> `steer` only when the active
  run supports safe steering;
- independent next questions or next tasks -> `queue_followup`;
- `继续`, `再试一次`, `按这个改` -> steer or queued input only when supported and
  only after the route context proves what is active;
- while a read-only answer is active, a clear build/change instruction must not
  be silently recorded as steering context. The current Builder queues it as the
  next build request, keeps a visible queued notice while the answer is active,
  and only dispatches after the answer finishes. That dispatch must still pass
  normal workspace and current-project write permission admission before any
  source-changing path runs;
- ordinary questions can be queued or answered after the run according to UI
  policy;
- no route may mutate an already-issued provider/tool request.

Current active-run checkpoint: Builder does not yet expose mature steering.
Until the provider/tool protocol can prove steer acceptance, the product should
prefer `queue_followup` for non-cancel input during active work. This keeps the
conversation usable without pretending that the current provider request can be
edited in place.

## Permission Admission

Intent answers "what does the user want?" Permission answers "may the app do
it?"

Minimum action/resource gates:

| Action | Resource | Early Default |
| --- | --- | --- |
| `read_project` | project/source path | allow selected workspace, ask external |
| `write_project` | target path | ask or allow current project only |
| `run_command` | full command text | deny until terminal/runtime gate |
| `access_network` | URL/domain | deny except provider API |
| `read_secret` | credential/key path | deny |
| `create_subtask` | target Agent/Task | deny until delegation gate |
| `publish_share` | artifact/publication target | deny until publication gate |

Permission denial does not change the route intent. It changes the dispatch
result to an approval request, safe explanation, or blocked state.

Implementation order:

1. **Current Builder boundary**: implement `read_project` and `write_project`
   for the selected workspace. `answer`, `clarify`, `update_brief`, and `plan`
   are read-only unless a separate source-read approval is requested. `build`
   is the first route that can request current-project write permission.
2. **Approval modes**: add a visible mode selector after the route decision
   evidence exists. Early modes should be limited to read-only chat, ask before
   write, and allow current project. Mode selection cannot replace durable
   permission facts.
3. **Tool permissions**: add command, network, external-directory, and secret
   permissions only when those tools exist behind main-owned execution gates.
4. **Agent permissions**: add subtask/delegation and multi-project scopes only
   after persistent Agent identity and Task-centered context are implemented.

Current Builder checkpoint:

- build-side generation is admitted through a main-owned `project.edit` check
  for the selected project;
- read-only chat keeps a stable logical Project/Conversation identity before a
  source folder is selected, and answering or failed-answer states must retain
  the prior visible conversation instead of resetting the chat flow;
- the composer can ask for current-project write approval before dispatching a
  build request;
- renderer-visible approval records expose only scope/status/result, not grant
  identifiers, source trees, receipts, credentials, or permission authority
  internals;
- approved-plan continuations, retries, restores, and generation entry points
  fail closed at the main runtime if the current-project write grant is absent;
- command, network, terminal, external-directory, publish, and delegation
  permissions remain out of scope until their separate gates exist.

Approval mode checkpoint:

- the desktop composer exposes `Read-only chat`, `Ask before write`, and
  `Allow current project` as user-facing mode choices;
- `Read-only chat` keeps the user's build intent inspectable while changing the
  dispatch to a blocked, side-effect-free answer path;
- `Allow current project` records approval through the main-owned current
  project write gate before it is shown as active;
- mode state is a UI/admission preference only, and does not replace durable
  permission facts or grant access to commands, network, external directories,
  publishing, or delegation.

## Goal Mode Is Separate

`Goal` must not be used as a synonym for plan, todo, title, working brief, or a
single build request. In ClawFabric, Goal mode means the user gives a bounded
objective and the agent accepts responsibility to keep working across steps:
plan, execute, verify, repair, summarize progress, and continue until the goal
is genuinely done or explicitly blocked.

This creates a different contract from the existing routes:

- `chat` answers or clarifies without an execution commitment;
- `plan` produces a reviewable plan and then stops for review or later
  execution;
- `update_brief` stores durable task context but does not promise progress;
- `build` performs one admitted generation or modification turn;
- `goal` is a future persistent-agent workflow with continuation, progress
  reporting, verification evidence, and done/blocked terminal states.

The current composer `Brief` entry only feeds the Task Capsule / Working Brief
path. It must not be presented as Goal mode until the persistent-agent runtime,
permission admission, progress projection, and completion/blockage semantics are
implemented.

## Task And Brief Requirements

The router needs a Task Capsule before it can support mature contextual
execution.

Minimum Task Capsule:

```ts
type TaskCapsule = {
  taskId: string;
  projectId: string | null;
  title: string;
  goal: string | null;
  currentBrief: WorkingBrief | null;
  planState: "none" | "proposed" | "approved" | "rejected";
  status: "discussing" | "ready" | "building" | "review" | "blocked" | "done";
  openQuestions: string[];
  lastRouteDecisionId: string | null;
};
```

The brief is agent working memory, not ordinary composer chrome. It should not
render as a default `Current brief` block or make users manage internal memory
while they are chatting. The system must still be able to explain, inspect, and
correct brief state through a future Task/Logs or memory disclosure surface.
Any correction removes contextual-build readiness for that task without deleting
the underlying conversation.

## Route Decision Evidence

Each submitted message should record a route decision object.

```ts
type RouteDecision = {
  decisionId: string;
  messageId: string;
  projectId: string | null;
  taskId: string | null;
  route: ComposerRoute;
  confidence: "low" | "medium" | "high";
  matchedSignals: string[];
  downgradedFrom: ComposerRoute | null;
  downgradeReason: string | null;
  requiredPermissions: string[];
  permissionResult: "not_required" | "allowed" | "ask" | "denied";
  dispatch:
    | "reply"
    | "brief_update"
    | "plan"
    | "build"
    | "steer"
    | "queue_followup"
    | "cancel"
    | "ask_workspace"
    | "ask_permission"
    | "blocked";
  activeRunInput:
    | "not_active"
    | "cancel_requested"
    | "steer_admitted"
    | "queued_followup"
    | "unsupported";
  createdAt: string;
};
```

This evidence supports debugging, tests, and future context snapshots. It also
prevents the UI from inferring route truth from cards or spinners.

Current Builder checkpoint: the desktop renderer/application layer creates a
temporary visible route preview for the composer, but durable route truth is
main-owned. Conversation main records `builder-composer-route-decision.v1` inside
each `turn_submitted` event, derives the decision id from the main-created
message id, binds work turns to the main-created task id, and accepts only the
fixed public matched-signal vocabulary. Workspace-gated continuation records a
fresh main-owned decision after the source folder is bound. The renderer preview
is only UI state and cannot become task, permission, provider, Git, source, or
Save authority.

Current signal parity checkpoint: renderer and main classifiers must not invent
private `matchedSignals` strings. The fixed public vocabulary includes ordinary
chat/build/brief/plan signals plus UI-mode signals such as
`composer_mode_plan` and future-mode boundary signals such as
`goal_mode_request`. Active-run input signals (`active_run_cancel`,
`active_run_followup`, `active_run_steer`, and `active_run_unsupported`) are
part of the same public vocabulary because they decide whether a message can
cancel, steer, or wait behind an already-active run. Node contract tests scan
both classifier surfaces for
hard-coded route signals and fail if any signal is missing from the public
vocabulary. Adding a route signal is therefore a route-contract change, not a
local UI string tweak.

Current contextual follow-up checkpoint: short confirmations such as `要`,
`可以`, `改吧`, `do it`, or `go ahead` do not become global build shortcuts.
They route to build only when the current visible conversation has prior build
context and the latest Assistant answer contains a public execution proposal
such as asking whether to directly modify, apply, generate, or implement the
change. The renderer derives this from the sanitized Task Stream projection, and
main re-reads the same project conversation before accepting
`pending_build_confirmation` as work evidence. A standalone confirmation remains
read-only chat even after a project is selected or a previous candidate exists.

Current current-artifact edit checkpoint: concise requests such as `改下颜色`
or `change the colors` can build only when a current result, approved plan, or
task brief already supplies durable work context. Without that context they are
clarification, not an implicit new project. This is recorded with
`current_artifact_direct_change` and the same missing-context downgrade evidence
used by defect feedback such as overlapping text.

Current semantic parity checkpoint: signal vocabulary alone is not enough. A
shared route-decision fixture now locks representative composer messages across
the renderer's temporary route preview and main-owned `submit` fallback. The
fixture covers read-only chat, clarification, brief updates, explicit plan
fallback, future Goal clarification, project-bound build, local Markdown
artifact creation, current-artifact direct changes, standalone confirmations,
and missing-context downgrade evidence. Renderer tests assert the preview
decision. Main-service tests submit the same instructions through the real main
boundary and assert whether the result is an explanation or a Git-backed
candidate. Updating one classifier without updating the shared fixture and the
other boundary is therefore a route-contract failure, not a frontend-only
change.

Current Task Capsule checkpoint: `update_brief` stays read-only. The shared
main-side `builder-task-capsule.v1`, `builder-working-brief.v1`, and
`builder-task-capsule-update.v1` contracts validate the bounded brief facts and
prove that a task capsule update is not provider dispatch, source mutation, Git
mutation, permission grant, Review, Revision, renderer authority, SQLite write,
or Conversation append by itself. Builder also has a main-only
`builder-task-capsule-store.v1` that can record or replay those update records
and read the latest Project/Task capsule context after restart, without IPC,
preload, provider, source, Git, permission, Review, Revision, or build dispatch
authority. The `builder-task-capsule-recording-service.v1` checkpoint composes
those two facts: it accepts an already-existing Conversation event window,
replays it, verifies the target `task_brief_updated` sequence, derives the
`builder-task-capsule-update.v1`, and records it idempotently in the main-owned
store. It still adds no renderer API, IPC/preload surface, Conversation append,
provider/model/tool dispatch, source or Git mutation, permission grant, Review,
Revision, Artifact, command execution, network access, or credential handling.
Selecting a workspace does not turn exploratory product discussion into work
admission, and must not request current-project write permission. The renderer
dispatches these turns through the answer path; generation main performs its own
read-only route classification and the conversation main service records
`task_brief_updated` / `builder-task-capsule.v1` without draft, Save, command,
or source-write authority. Later build route evidence can then bind to the
visible task id derived from the sanitized task stream. The desktop can inspect
the latest sanitized brief on demand through Artifact Logs as `Current
direction`, but this surface exposes no task id, route decision id, provider,
credential, source, Git, receipt, or correction authority.

## Test Matrix

The router should have product-level tests, not only unit regex tests.

### Must Stay Chat

- `hi` with no project -> `answer`
- `hi` with selected project -> `answer`
- `你好` with selected project and previous draft -> `answer`
- `你现在在做什么？` during idle -> `answer`
- `为什么预览空白？` after draft -> `answer`
- `我想先聊一下这个页面怎么做` -> `clarify`
- `我想做一个登录页，你觉得怎么设计？` -> `clarify`

### Must Update Brief

- `目标用户是小团队` after active task discussion -> `update_brief`
- `风格按 Codex 那种克制工具感` -> `update_brief`
- `先做桌面端，移动端以后再说` -> `update_brief`

### Must Plan

- `先给我方案` -> `plan`
- `进入计划模式` -> `plan`
- `先不要写代码，列步骤` -> `plan`

### Can Build

- `创建一个登录页` with workspace -> `build`
- `帮我做一个网页 3D` with workspace -> `build`
- `把按钮颜色改成绿色` with existing draft/project -> `build`
- `按刚才方案做` with confirmed brief -> `build`
- `go ahead` with approved plan -> `build`

### Must Not Build

- `按刚才方案做` without brief/plan -> `clarify`
- `继续` without active task or brief -> `clarify`
- `可以吗？` after discussion -> `answer` or `clarify`
- `我想做一个网页` without imperative or confirmation -> `clarify`
- any build route without workspace -> `ask_workspace`, not draft creation

### Permission Cases

- build intent + no write permission -> `ask_permission`
- build intent + denied write permission -> blocked explanation
- command request before terminal gate -> blocked explanation
- command request after terminal gate + ask policy -> approval request
- external directory read -> approval request or denial according to policy

## Implementation Slices

### Slice 1 - Hard Fail-Safe Router

Goal: stop accidental builds.

Deliverables:

- route type maps cleanly onto the current answer/build path;
- selected workspace no longer biases greetings/questions into build;
- tests cover chat-only inputs after workspace selection;
- ambiguous execution downgrades to clarify.

### Slice 2 - Route Decision Evidence

Goal: make routing inspectable.

Deliverables:

- route decision object emitted for every composer submit;
- tests assert downgrade reasons;
- UI can show route status without guessing from draft state.

Current checkpoint: renderer and main fallback routing share the same public
matched-signal vocabulary for current Builder routes, including
`local_file_artifact` for Markdown/README/notes/text artifact writes and
`active_run_followup` for the current safe queued follow-up surface. A main-only
Conversation fact now exists for `turn_followup_queued` / `queued_followup`
Task Stream projection, and the renderer reaches it only through a controlled
request-id-only IPC/preload `queueFollowup` command. This fact still does not
start a second Run, dispatch a provider/tool request, or expose source
authority. A renderer-safe `turn_followup_consumed` receipt is now part of the
conversation replay/projection contract so a later dispatcher can prove a
queued message was picked up by a normal submitted turn before any new Run
starts. The Conversation main service can now start a main-only queued
follow-up work/question turn by appending
`turn_submitted -> turn_followup_consumed -> run_started` in one replay-checked
event chain; this is still not exposed through IPC/preload and is not an
auto-dispatch executor. Successful `queueFollowup` calls now return only a
bounded main-recorded queued reference, and the existing submit/answer path can
carry that reference through normal route, workspace, and permission admission
before main consumes it through the replay-verified begin gate. Draft
continuation consumption remains a later explicit gate. Main `submit` now
dispatches from the resolved `RouteDecision` instead of a second boolean
answer/build classifier, so workspace admission, write permission, and provider
route selection cannot silently diverge.

### Slice 3 - Task Capsule And Working Brief

Goal: support "chat first, execute later."

Deliverables:

- durable task capsule;
- brief update route;
- no default composer brief block; future on-demand inspect/correct surface;
- contextual execution requires brief or approved plan.

### Slice 4 - Permission Admission

Goal: separate intent from authority.

Deliverables:

- action/resource permission check before build dispatch;
- write_project approval path;
- command/network remain denied or explicitly gated;
- tests prove permission denial does not mutate route intent.

### Slice 5 - Context Snapshot

Goal: make builds reproducible and debuggable.

Deliverables:

- build Run records included messages, brief, project revision, and permissions;
- unrelated task messages excluded;
- user-visible "why this built" diagnostics can be derived.

Current checkpoint: Builder records a main-owned
`builder-run-context-snapshot.v1` fact after Run start and before provider
progress, tool facts, interruption, cancellation, or terminal outcome. The
renderer sees only the compact Task Stream projection; snapshot ids, context
digests, provider/credential material, source tree details, Git receipts, Save
facts, raw prompts, and Project Revision evidence remain hidden. The desktop
Work logs now show a user-facing "Why this ran" explanation derived only from
that public projection, including route purpose, brief availability, project
base, write permission result, and the absence of terminal/network access.
When a build uses the current task capsule, the snapshot binds the current user
message plus the task capsule source message id, while still excluding the brief
text and all source/provider/private route material from renderer projections.

### Slice 6 - Agent-Ready Routing

Goal: prepare persistent Agents and subtask delegation.

Deliverables:

- route context binds `agent_id` and `task_id`;
- subtask/delegation intent remains denied until the delegation gate;
- Agent memory is retrieved only through task-centered context assembly.

### Slice 7 - Active-Run Input And Branching

Goal: make the composer behave like a continuing work surface while the
assistant is busy.

Deliverables:

- second submit during active work records `cancel`, `steer`, or
  `queue_followup` route evidence;
- queued follow-up preserves visible chat history and reuses normal admission
  after the active Run is terminal;
- unsupported steering downgrades to queued follow-up or asks whether to cancel;
- branch/fork/clone facts exist before any UI claims alternate directions are
  durable;
- compaction affects model context assembly only and never deletes Conversation,
  Task, Run, Permission, Candidate, Review, or Revision facts.

Pi parity/exceed acceptance:

- sending a second message during active work never erases prior messages or
  hides the active result;
- cancel, steer, and queued follow-up are separately recorded and separately
  rendered;
- queued follow-up runs through the normal route and permission pipeline after
  the active Run is terminal;
- users can later branch from a useful direction without replacing the original
  task history;
- compacted context can improve model performance, but users can still inspect
  the underlying conversation, decisions, versions, and outcomes.

## Acceptance Standard

The architecture is mature enough for the current product only when these are
true:

- ordinary chat remains chat in a selected workspace;
- multi-turn discussion can produce an inspectable brief;
- a short contextual execution phrase builds only from confirmed context;
- permission checks happen after intent and before side effects;
- every build has route decision and context evidence;
- no UI surface can create source changes without a Task/Run path;
- tests cover positive, negative, contextual, permission, and active-run cases.

Until those are true, keyword fixes are useful guardrails but not the final
intent architecture.
