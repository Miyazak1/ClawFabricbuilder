# Task Intent Routing And Plan Mode Spec

Date: 2026-08-18

Status: routing and UX specification grounded in current implementation.

Related documents:

- [Composer Intent Routing Architecture](COMPOSER_INTENT_ROUTING_ARCHITECTURE.md)
- [Task Conversation Management Architecture](TASK_CONVERSATION_MANAGEMENT_ARCHITECTURE.md)
- [Agent Project Task UI Migration Plan](AGENT_PROJECT_TASK_UI_MIGRATION_PLAN.md)
- [Conversation Visual Streaming and Plan Markdown Spec](CONVERSATION_VISUAL_STREAMING_AND_PLAN_MARKDOWN_SPEC.md)

## Purpose

Builder must route natural-language input into the right Task action:

```text
Ask
Plan
Build
Update brief
Continue current task
Start new task
Steer active run
Queue follow-up
Cancel
```

This is especially important for Chinese planning requests. The user expects
phrases such as "做一个 X 计划" and "做一个 X 方案" to produce a Plan when the
sentence means "make a proposal/implementation plan", not simply repeat the
request or ask a generic question.

## Current Implementation Evidence

Current Builder already has:

- local renderer-side routing in `src/features/builder/application/builderComposerIntent.ts`;
- explicit composer mode override for Ask/Plan/Build;
- main-side semantic route classifier in
  `electron/builder-semantic-route-classifier.cjs`;
- bridge/port support for `classifyIntent`;
- Plan proposal path through `proposePlan`;
- Plan source read approval before project-context Plan generation;
- Plan review before approved-plan Build continuation;
- route decision evidence rendered through composer data attributes and
  conversation context snapshots.

Current gap:

- semantic classification is selectively invoked, mostly for build ambiguity or
  missing context;
- some Plan-like requests can remain on the answer/clarify path;
- renderer and main fallback behavior can differ;
- Plan is not always treated as a first-class Task artifact in visible UX.

## Routing Layers

Routing should use three layers.

### Layer 1: Explicit User Mode

If the user manually selects Ask, Plan, or Build, that mode wins unless blocked
by permissions or impossible project state.

```text
Ask mode -> answer/clarify only
Plan mode -> plan
Build mode -> build, with permission/workspace gates
```

Use this as a user escape hatch when natural-language routing is imperfect.
This also answers the user's earlier idea: Ask and Build can be active modes
like Plan mode.

Rules:

- selected mode should be visible near the composer;
- selected mode should apply to the next submit;
- after a successful Plan or Build dispatch, mode may clear unless pinned;
- mode never bypasses permission gates;
- Ask mode can override build-looking language when the user wants discussion.

### Layer 2: Deterministic Local Router

The local router handles common, safe, fast cases:

- greeting/status question -> Ask;
- explicit Plan pattern -> Plan;
- explicit Build pattern -> Build;
- current artifact defect with prior context -> Build;
- vague change without context -> Clarify;
- brief correction -> Update brief;
- active run cancel/steer/follow-up -> control or queue.

Local routing should remain conservative. It should not send every message to a
provider just to decide the route.

### Layer 3: LLM Semantic Classifier

The semantic classifier should handle language where local rules are likely to
fail.

It should receive:

- current instruction;
- bounded product state;
- no conversation text;
- no working brief text;
- no source tree;
- no credentials;
- no write authority.

Current implementation already follows this authority shape. The change needed
is trigger policy.

## Plan Intent Contract

Plan means:

```text
The user wants analysis, proposal, implementation plan, steps, or方案 before
source mutation.
```

Chinese planning terms:

- 计划;
- 方案;
- 实施计划;
- 实现计划;
- 开发计划;
- 执行计划;
- 实施方案;
- 实现方案;
- 优化方案;
- 改版方案;
- 重构方案;
- 步骤;
- 路径;
- 实施路径;
- 技术选型;
- 落地方案.

English planning terms:

- plan;
- proposal;
- implementation plan;
- migration plan;
- approach;
- steps;
- roadmap;
- design plan;
- rollout plan.

Examples that should route to Plan:

| User message | Expected route |
| --- | --- |
| "帮我做一个静态技术博客实施计划" | Plan |
| "给当前文件夹做一个优化方案" | Plan |
| "写一个 README 重构方案" | Plan |
| "先给我一个实现步骤" | Plan |
| "把刚才聊的整理成计划" | Plan |
| "我们需要一个迁移方案" | Plan |
| "make an implementation plan for this project" | Plan |

## Build Intent Contract

Build means:

```text
The user wants source files, draft artifacts, UI, or project state changed now.
```

Examples that should route to Build:

| User message | Expected route |
| --- | --- |
| "做一个计划管理页面" | Build |
| "做一个方案展示页" | Build |
| "创建一个学习计划表应用" | Build |
| "把按钮颜色改成蓝色" | Build |
| "继续优化当前页面" with prior draft | Build |
| "按刚才批准的方案做" with approved plan | Build |
| "implement the approved plan" | Build |

The distinction is semantic:

```text
做一个 X 计划 = produce a plan about X
做一个 计划管理页面 = produce a page whose subject is plans
```

This is exactly why keyword-only routing is insufficient.

## Update Brief Contract

Update brief means:

```text
The user is changing the working direction, constraints, preferences, or goal,
but is not yet asking to execute.
```

Examples:

- "记住这个方向，后面按这个来";
- "先别做，我重新整理一下目标";
- "补充约束：不要用深色主题";
- "这个方案作废";
- "接下来以移动端优先".

Update brief should update Task Capsule or Working Context State, not produce a
source change.

## Continue Current Task Contract

Continuation means:

```text
The user wants to keep working inside the currently focused Task.
```

Examples:

- "继续";
- "继续优化";
- "接着做";
- "再修一下";
- "按这个来";
- "就这样做";
- "retry";
- "keep going".

Continuation can route to:

- Build, if current Task has build context and permission can be acquired;
- Plan, if the current mode or prior step is planning;
- Update brief, if the message changes direction;
- Queue follow-up, if a run is active.

Continuation should not create a new Task unless the user says "另外", "新开",
"单独", "并行", or references a different project/task.

## Start New Task Contract

New Task means:

```text
The user introduced a new durable objective that should not pollute the current
Task context.
```

New Task signals:

- "另外";
- "新开一个";
- "单独做";
- "并行做";
- different project/folder;
- different artifact class;
- current Task completed;
- explicit archive/fork/start request;
- incompatible permissions.

If the signal is weak, ask a small choice:

```text
Continue current task or start a new task?
```

## Semantic Classifier Trigger Policy

The classifier should be invoked when local routing has meaningful risk:

- local route is low confidence;
- local route is `clarify` because of Plan/Build ambiguity;
- text contains planning nouns near creation verbs;
- text contains "方案" or "计划" but could refer to either an artifact or a
  planning output;
- text says "做一个 X 计划/方案" and X is not obviously a UI/app/page/table name;
- workspace exists and the message could either update brief or produce Plan;
- prior Task context exists and a continuation phrase could mean plan review or
  build execution;
- renderer and main route would otherwise diverge.

It should not be invoked for:

- empty messages;
- clear greetings;
- explicit selected mode;
- active-run cancel;
- clear read-only status questions;
- clear current artifact defects when prior build context exists and user did
  not mention Plan/方案;
- high-confidence direct file changes.

Fail-closed behavior:

- classifier unavailable -> local route if high confidence;
- classifier unavailable and local route ambiguous -> Clarify;
- invalid classifier response -> Clarify;
- classifier says low confidence -> Clarify.

## Renderer/Main Consistency

The renderer and main service must agree on the final route decision.

Recommended contract:

```text
renderer provisional decision
-> optional semantic classifier
-> final route decision evidence
-> main consumes matching semantic classification by request digest
-> main records same route in conversation event/context snapshot
```

Problems to avoid:

- renderer shows Plan while main records Answer;
- renderer clears composer while main only explains;
- main fallback downgrades Plan to Clarify without user-visible reason;
- semantic classifier result is cached for a different product state.

Acceptance evidence:

- tests assert renderer decision and main recorded route match for core cases;
- context snapshot shows route and dispatch;
- Plan requests produce `run_completed(result_kind = plan)`;
- Answer fallback cannot masquerade as Plan success.

## Plan Mode UX

Plan mode should be a first-class composer mode.

Controls:

```text
Ask | Plan | Build
```

Behavior:

- Ask mode keeps the next submit conversational;
- Plan mode creates a reviewable Plan;
- Build mode tries to create/change files with permission gates;
- mode is visible before submit;
- mode can be cleared;
- mode should not remain as confusing persistent status after completion.

Plan mode should be useful even after routing improves because it lets expert
users express intent faster than natural language.

## Build Mode UX

Build mode should be explicit and permission-aware.

Behavior:

- if no Project/folder exists, open workspace picker;
- if no write approval exists, show approval prompt;
- if a Plan exists but is unreviewed, offer review before Build;
- if a Plan is approved, Build can use approved-plan continuation;
- if no brief/context exists, ask for clarification instead of writing.

Build mode should not hide the fact that writes need approval.

## Ask Mode UX

Ask mode should be explicit for safe discussion.

Behavior:

- no source mutation;
- no command execution;
- can read already available public task/project projections;
- can request source read approval if answering depends on source context;
- can update brief only when user explicitly says to remember/use as direction.

Ask mode helps the user say "do not build yet" without writing long caveats.

## Task Boundary UX

When a route decision also implies Task boundary changes:

| Situation | UI |
| --- | --- |
| clear continuation | keep current Task |
| clear new objective | create/propose new Task |
| ambiguous | inline two-option choice |
| active run follow-up | queue/steer/cancel controls |
| parallel requested | create background Task and show right rail |
| Project switch needed | project picker |

The composer target should always be visible when the decision can affect a
Task.

## Test Matrix

Required cases:

| Case | Expected |
| --- | --- |
| "帮我做一个静态技术博客实施计划" with workspace | Plan |
| "做一个计划管理页面" with workspace | Build |
| "给当前文件夹做一个优化方案" | Plan |
| "把刚才聊的整理成方案" | Plan |
| "继续优化" with draft | Build |
| "继续优化" without task context | Clarify |
| "按刚才方案做" with approved plan | Build |
| "按刚才方案做" with unreviewed plan | Plan review prompt |
| "先别写代码，出个方案" | Plan |
| "这个方案作废" | Update brief |
| active run + "停一下" | Cancel |
| active run + "补充：别用深色" | Steer or queue follow-up |
| no workspace + Build request | Workspace picker |
| read-only mode + Build request | Blocked/Ask mode response |

## Implementation Slices

### Slice 1: Route Evidence Audit

- Add tests comparing renderer route and main recorded route.
- Include Chinese Plan/方案 cases.
- Include Plan page/app false positives.

Exit criteria:

- mismatch cases are documented and reproducible.

### Slice 2: Classifier Trigger Expansion

- Invoke semantic classifier for Plan/方案 ambiguous cases.
- Keep explicit modes and clear local routes fast.
- Fail closed to Clarify.

Exit criteria:

- "帮我做一个 X 实施计划" reaches classifier or local Plan path.

### Slice 3: Main Plan Preservation

- Ensure main does not downgrade accepted Plan route to answer/clarify when
  renderer already selected Plan and source read approval passes.
- Record matching route decision in conversation event.

Exit criteria:

- Plan requests record Plan result or visible Plan failure.

### Slice 4: Plan Markdown Rendering

- Render Plan as markdown in conversation timeline.
- Show review actions near the Plan.

Exit criteria:

- user sees the full Plan content, not only a summary card.

### Slice 5: Ask/Plan/Build Mode Polish

- Add/verify segmented controls.
- Show current one-shot mode.
- Clear mode after dispatch unless pinned.

Exit criteria:

- user can explicitly force Ask, Plan, or Build without relying on classifier.

## Acceptance Criteria

- Plan and 方案 are equivalent planning intents when the sentence means a
  proposal before source changes.
- Keyword-only routing is not the only path for ambiguous requests.
- Explicit Ask/Plan/Build modes exist as reliable user controls.
- Renderer and main route evidence agree.
- Plan requests do not silently become simple answers.
- Build requests still require workspace and permission gates.
- Continuation phrases reuse current Task only when context supports it.
- New Task creation is explicit or strongly inferred from durable objective
  change.
- Active-run input cannot accidentally start unrelated work.
- Tests cover Chinese and English route examples.

## Non-Goals

- No provider call for every trivial message.
- No Plan keyword that always overrides sentence meaning.
- No Build route based only on project folder selection.
- No source mutation from semantic classifier output.
- No hidden route change after the composer displayed a different mode.
- No treating Plan approval as write approval.

## Bottom Line

Routing should feel natural, but it must be auditable:

```text
explicit mode when the user chooses one
+ local rules for obvious cases
+ LLM semantic classification for ambiguous language
+ main-side route evidence and context snapshot
```

That is the safest way to make "做一个方案/计划" behave like a mature Agent
tool without turning every sentence into a brittle keyword game.
