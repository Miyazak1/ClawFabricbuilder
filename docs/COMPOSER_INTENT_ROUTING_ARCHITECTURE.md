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
- recent route decision evidence for recovery and debugging.

## Route Types

```ts
type ComposerRoute =
  | "answer"
  | "clarify"
  | "update_brief"
  | "plan"
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

- `composerMode: "plan"` from the `+` menu or `Plan first` command forces the
  next eligible submit through the `plan` route;
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
- active task with clear current brief and no blocking open question.

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

- `stop`, `cancel`, `暂停` -> cancel/interrupt;
- `继续`, `再试一次`, `按这个改` -> steer or queued input only when supported;
- ordinary questions can be queued or answered after the run according to UI
  policy;
- no route may mutate an already-issued provider/tool request.

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
- the composer can ask for current-project write approval before dispatching a
  build request;
- renderer-visible approval records expose only scope/status/result, not grant
  identifiers, source trees, receipts, credentials, or permission authority
  internals;
- approved-plan continuations, retries, restores, and generation entry points
  fail closed at the main runtime if the current-project write grant is absent;
- command, network, terminal, external-directory, publish, and delegation
  permissions remain out of scope until their separate gates exist.

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

The brief must be inspectable and clearable. Clearing a visible brief should
remove contextual-build readiness without deleting the underlying conversation.

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
  dispatch: "reply" | "brief_update" | "plan" | "build" | "ask_workspace" | "ask_permission" | "blocked";
  createdAt: string;
};
```

This evidence supports debugging, tests, and future context snapshots. It also
prevents the UI from inferring route truth from cards or spinners.

Current Builder checkpoint: the desktop renderer/application layer creates a
local route decision evidence object for every submitted composer message. It
includes local `decisionId`, `messageId`, selected `projectId`, `taskId: null`,
and `createdAt`. Workspace-gated continuation reuses the same `messageId` and
records a new decision id after the workspace is bound. This is not yet durable
SQLite task evidence; durable Task Capsule binding is the next slice.

Current Task Capsule checkpoint: when `update_brief` is submitted with a selected
workspace, the renderer uses the existing main conversation work path rather
than the pure answer path. Main records the explanation and emits
`task_brief_updated` / `builder-task-capsule.v1`; no draft, Save, command, or
source write is created. Without a selected workspace, the same message remains
chat-only and does not create a hidden project or task. Later build route
evidence can bind to the visible task id derived from the sanitized task stream.

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

### Slice 3 - Task Capsule And Working Brief

Goal: support "chat first, execute later."

Deliverables:

- durable task capsule;
- brief update route;
- clear/inspect brief UI;
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

### Slice 6 - Agent-Ready Routing

Goal: prepare persistent Agents and subtask delegation.

Deliverables:

- route context binds `agent_id` and `task_id`;
- subtask/delegation intent remains denied until the delegation gate;
- Agent memory is retrieved only through task-centered context assembly.

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
