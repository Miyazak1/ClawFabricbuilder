# Agent Companion MVP Backlog and Decisions

Date: 2026-08-18

Status: MVP backlog and decision log for the Agent companion direction.

## Purpose

This document converts the Agent companion architecture into a product backlog
that can be turned into implementation tasks.

The companion closure audit for this backlog is
[Agent Companion Solution Completeness Audit](AGENT_COMPANION_SOLUTION_COMPLETENESS_AUDIT.md).

It answers three practical questions:

1. What have we decided?
2. What must ship before Agent-first UI is credible?
3. What should wait until the Task conversation is stable?

## Product Decisions

### D1: Agent Is The Long-Lived Relationship

Decision:

- the top product object is an Agent friend;
- the Agent can have personality, preferences, memory, permissions, and
  long-running presence;
- the Agent contains Projects and Tasks.

Reason:

- this matches the user's desired "chat friend" mental model;
- it gives long-term memory a clear owner;
- it avoids treating every isolated chat as a disconnected assistant.

Consequence:

- Agent settings and memory must become first-class product surfaces;
- a persisted default Builder Agent is required for the Agent-first cutover.

### D2: A Visible Conversation Is One Focused Task

Decision:

- one main chat should focus one Task at a time;
- the Agent can own many Tasks, but the main timeline should not show multiple
  unrelated tasks interleaved.

Reason:

- this preserves Codex-like clarity;
- it prevents parallel work from turning the chat into a noisy shared log;
- it keeps context, permissions, and review tied to one objective.

Consequence:

- parallel work belongs in a right rail or task monitor;
- switching tasks should be explicit;
- continuation phrases use Task Capsule / Task Address context.

### D3: Agent-First UI Is A Projection

Decision:

- the Agent-first sidebar and task tree should be read models over existing
  main-side facts;
- renderer selection state is display-only.

Reason:

- the codebase already has Agent records, Project catalog, Session/Task
  addresses, conversation replay, task stream projection, assignments, budgets,
  and supervision facts;
- duplicating authority in the renderer would weaken the current safety model.

Consequence:

- projection contracts must precede the Agent sidebar implementation;
- Project remains the source and permission boundary.

### D4: Plan/方案 Is A First-Class Route

Decision:

- "做一个 X 计划" and "做一个 X 方案" should route to Plan when the sentence
  means proposal/design before source changes;
- "做一个计划管理页面" and "做一个方案展示页" should route to Build when the
  sentence asks for a product/page/app.

Reason:

- the user reported a real failure where planning intent was repeated back as an
  answer;
- keyword-only routing cannot capture Chinese sentence meaning well enough.

Consequence:

- explicit Plan mode must exist;
- deterministic patterns should cover obvious phrases;
- semantic classifier should cover ambiguous Plan-vs-Build cases;
- main-side route preservation must be tested.

### D5: Memory Is Durable, Reviewed, And Scoped

Decision:

- raw chat history is evidence, not memory;
- long-term memory must be accepted, scoped, inspectable, editable, and
  deletable;
- memory can inform context but cannot grant permission.

Reason:

- the desired Agent friend needs long-term continuity;
- unreviewed hidden memory would create trust and privacy risk.

Consequence:

- memory fact contract and store are required before memory UI;
- context snapshots should record memory ids used in a run;
- provider egress must respect sensitivity.

### D6: Long-Running Agent Requires Standing Intents

Decision:

- autonomous/background behavior should be enabled through explicit standing
  intents, not inferred from general memory.

Reason:

- this supports "长期在线" while keeping user control;
- every long-running behavior needs scope, expiration, cancellation, and audit.

Consequence:

- standing intents come after Agent settings, memory review, and permission
  model are stable.

### D7: Agent-First Is A Development Cutover

Decision:

- persist the default Builder Agent during application bootstrap;
- replace the Project-first shell instead of shipping two navigation models;
- allow short-lived implementation bridges only while a cutover slice is
  incomplete;
- reset or migrate development fixtures that lack Agent or Task Address facts.

Reason:

- the product is still in development and has no installed-user compatibility
  burden;
- a synthetic Agent and permanent fallback would create duplicate identity,
  loading, routing, and testing paths before the primary architecture is proven.

Consequence:

- P2 is a persisted Agent bootstrap and shell cutover, not a display-only
  experiment;
- the Project-first sidebar, fallback flag, and synthetic recovered Task rows
  must be absent from the P2 accepted build;
- Project, Conversation, Git, permission, and runtime authorities are reused
  unchanged beneath the new shell.

## MVP Scope

MVP means:

```text
current Builder capabilities remain available under the new shell
+ Task conversation becomes reliable
+ Plan/方案 routing works
+ Plan markdown is visible
+ one default Agent projection exists
```

MVP does not include:

- multi-Agent marketplace;
- fully autonomous background work;
- vector/graph memory retrieval;
- cross-device sync;
- collaboration;
- remote deployment of Agent workers.

## Backlog Overview

| Priority | Theme | Outcome |
| --- | --- | --- |
| P0 | Current Builder stability | loading, flicker, source scroll, tool row typography fixed |
| P1 | Task conversation and Plan | reliable Plan/方案 routing and Plan markdown |
| P2 | Default Agent projection | current projects/tasks appear under one Agent |
| P3 | Agent settings | create/edit/pause/archive Agent identity and behavior |
| P4 | Memory | reviewed long-term memory facts and inspector |
| P5 | Standing intents and parallel tasks | long-running and concurrent work with visible controls |

## P0 Backlog: Current Builder Stability

### P0.1 Tool Evidence Row Typography

Problem:

- newly edited/running/failed tool rows can appear with inconsistent font size
  and visual weight.

Implementation target:

- one row anatomy for running, completed, failed, grouped, command, read, and
  file rows.

Primary files:

- `src/features/builder/presentation/BuilderPage.tsx`
- `src/features/builder/presentation/BuilderPage.test.tsx`
- `src/styles.css`

Acceptance:

- `Edited index.html`, `Could not finish index.html`, and `Read index.html`
  share the same title/detail scale;
- failures are distinguished by state color/icon, not oversized text;
- existing tool evidence remains clickable when it opens detail.

### P0.2 Composer Context Chrome

Problem:

- composer can expose internal status labels that do not help the user.

Current evidence:

- `Ready to execute current direction` is already suppressed in current
  `BuilderComposer.tsx`.

Implementation target:

- keep only actionable context/status labels visible;
- preserve explicit Ask/Plan/Build mode controls.

Acceptance:

- generic ready label is absent;
- Plan mode can be selected and cleared;
- project/folder status is visible before first submit, then compact.

### P0.3 Source Files Scroll

Problem:

- long Source files content can be clipped or depend on the outer page scroll.

Implementation target:

- Source files panel owns internal vertical and horizontal scrolling.

Primary files:

- `BuilderPage.tsx`
- `BuilderPage.test.tsx`
- `src/styles.css`

Acceptance:

- long Markdown source scrolls inside the source panel;
- horizontal code overflow stays inside the panel;
- selected source tab stays stable during conversation refresh.

### P0.4 Loading And Flicker

Problem:

- old projects can stay on `Loading activity...`;
- toolbar, sidebar, composer, and workspace controls can flicker during load.

Implementation target:

- use last-stable shell projection while new async sources load;
- split foreground project load from background probes.

Primary files:

- `builderConversationController.ts`
- `builderProjectController.ts`
- `BuilderApp.tsx`
- `BuilderPage.tsx`
- related tests.

Acceptance:

- old project with no conversation reaches `absent` or stable diagnostic;
- same-project refresh keeps previous activity visible;
- stale replay shows retry/diagnostic;
- toolbar controls disable instead of disappearing.

## P1 Backlog: Task Conversation And Plan

### P1.1 Plan/方案 Intent Coverage

Problem:

- natural language planning requests can be answered as text instead of routed
  to Plan.

Implementation target:

- local route covers obvious planning language;
- semantic route classifier covers ambiguous Plan-vs-Build phrases;
- explicit Plan mode always wins.

Primary files:

- `builderComposerIntent.ts`
- `builderComposerIntent.test.ts`
- `builder-semantic-route-classifier.cjs`
- `builder-semantic-route-classifier.test.cjs`
- `BuilderApp.tsx`
- `BuilderApp.test.tsx`

Acceptance:

- `帮我做一个静态技术博客实施计划` -> Plan;
- `给当前文件夹做一个优化方案` -> Plan;
- `把刚才聊的整理成方案` -> Plan or brief update then Plan;
- `做一个方案展示页` -> Build;
- `做一个计划管理页面` -> Build;
- route evidence is visible and main-side dispatch agrees.

### P1.2 Plan Markdown In Conversation

Problem:

- Plan content should be readable as Markdown in chat, not only summarized in a
  compact status block.

Implementation target:

- Plan result appears as a Markdown artifact in the timeline;
- approval/rejection controls are attached to the Plan.

Acceptance:

- Plan has heading, ordered steps, bullets, code/file refs when applicable;
- Plan approval records review but does not mutate files;
- approved Plan continuation asks for write permission before Build.

### P1.3 Task Boundary UX

Problem:

- users need to understand whether they are continuing the current Task,
  starting a new Task, or steering an active run.

Implementation target:

- surface Task title/goal compactly;
- preserve current Task Capsule for contextual instructions;
- clarify only when the boundary is genuinely ambiguous.

Acceptance:

- `继续优化` with active draft/brief continues current Task;
- `继续优化` without context asks for clarification;
- `另外...` proposes a new Task;
- active run input routes to cancel/steer/queue rather than starting hidden work.

## P2 Backlog: Default Agent Projection

### P2.1 Persisted Default Builder Agent

Problem:

- current UI is Project-first, while target product is Agent-first.

Implementation target:

- bootstrap one persisted default Builder Agent definition, version, and active
  lifecycle record;
- make that identity required by new Session/Task Address records.

Primary docs:

- `AGENT_FIRST_PROJECTION_AND_DATA_CONTRACT.md`
- `AGENT_COMPANION_LEFT_SIDEBAR_ARCHITECTURE.md`

Acceptance:

- saved projects appear under default Agent;
- in-progress workspace projects appear under default Agent;
- missing Agent facts produce a fixed setup failure, not another shell;
- selecting project rows opens the same project ids.

### P2.2 Task Rows Under Projects

Problem:

- the user needs history/task navigation, not just project cards.

Implementation target:

- map verified Session/Task Address records into task rows;
- reset or migrate development fixtures that do not satisfy the new identity
  contract.

Acceptance:

- Task Address with `agent_id/project_id/conversation_id` maps to one row;
- task row opens one focused Task conversation;
- every visible Task has a verified Task Address.

### P2.3 Task Locator

Problem:

- users need quick navigation through historical tasks and long timelines.

Implementation target:

- adapt the Codex-like timeline locator interaction for task/history navigation.

Acceptance:

- task locator jumps to relevant task/history item;
- active, blocked, review-needed, and completed tasks are distinguishable;
- locator does not mix multiple chats into the main timeline.

## P3 Backlog: Agent Settings

### P3.1 Add/Edit Agent

Implementation target:

- create Agent definition and version records;
- edit personality/working style through versioned instructions.

Acceptance:

- editing settings creates a new Agent version;
- old tasks remain bound to previous Agent version evidence.

### P3.2 Permissions And Autonomy

Implementation target:

- expose autonomy levels as product settings;
- keep actual file/source permissions separate.

Acceptance:

- Agent settings cannot grant write permission;
- autonomy changes are explicit and auditable;
- paused/revoked Agent stops future background work.

### P3.3 Context Management

Implementation target:

- expose what context is used by Agent, Project, Task, and Run.

Acceptance:

- user can see Agent memory, project context, task brief, and current run
  context separately;
- context preview omits secrets/private source unless authorized.

## P4 Backlog: Memory

### P4.1 Memory Fact Contract

Implementation target:

- define durable memory facts with scope, provenance, confidence, sensitivity,
  source refs, validity, and supersession.

Acceptance:

- raw chat does not become memory automatically;
- accepted memory facts can be inspected;
- deleted memory is removed from recall eligibility.

### P4.2 Memory Proposal And Review

Implementation target:

- propose memory candidates after meaningful work;
- user can accept, edit, reject, archive, or delete.

Acceptance:

- rejected memory is never injected;
- accepted memory id appears in context snapshot when used.

### P4.3 Recall And Compaction

Implementation target:

- retrieve relevant memory by Agent/Project/Task scope;
- compact durable patterns without losing provenance.

Acceptance:

- recalled memory is marked and cannot be re-ingested as new evidence;
- current user instruction and current source facts outrank memory.

## P5 Backlog: Standing Intents And Parallel Work

### P5.1 Standing Intent Contract

Implementation target:

- add watch/remind/monitor records with scope, expiration, and revocation.

Acceptance:

- standing intent cannot exceed Agent autonomy policy;
- every standing intent is visible and cancellable.

### P5.2 Parallel Task Monitor

Implementation target:

- add right rail for concurrent/background tasks;
- keep one focused Task conversation in the main timeline.

Acceptance:

- parallel read-only task can run without disturbing focused Task;
- mutating parallel task waits for permission and conflict check;
- completed result requires review before materialization.

## Issue Template

Use this template when converting backlog items into tasks:

```md
## Goal

## User-visible behavior

## Current evidence

## Files likely touched

## Files to avoid

## Authority boundaries

## Acceptance tests

## Manual verification

## Out of scope
```

## Dependency Order

```text
P0.1 Tool rows
P0.2 Composer chrome
P0.3 Source scroll
P0.4 Loading/flicker
P1.1 Plan/方案 routing
P1.2 Plan Markdown
P1.3 Task boundary UX
P2.1 Persisted default Agent
P2.2 Task rows
P2.3 Task locator
P3 Agent settings
P4 Memory
P5 Standing intents and parallel task monitor
```

The only intentional flexibility:

- P0.1 and P0.2 can run independently;
- P0.3 can run independently if it only changes layout;
- P1.1 and P1.2 should be verified together before release;
- P2 should wait for P0/P1 evidence.

## Open Questions

- Should explicit Ask/Plan/Build mode remain inside the add menu, or become a
  compact segmented control after user testing?
- Default Builder Agent persistence is resolved: persist it during Agent-first
  application bootstrap.
- Should task locator search across all Agent tasks by default, or only the
  selected Project?
- Should memory proposals be shown after every completed task, or batched into a
  periodic review queue?
- What is the minimum autonomy level needed for the first "long-running online"
  demo without overpromising background work?

## Non-Goals

- no hidden memory;
- no renderer-granted permission;
- no Agent UI that bypasses Project source boundaries;
- no autonomous mutation without explicit permission;
- no interleaved multi-task chat timeline;
- no full shell rewrite before P0/P1 are stable.

## Bottom Line

The MVP path is:

```text
make current Builder stable
-> make Task conversation and Plan reliable
-> project current work under one Agent
-> add settings and memory
-> add long-running and parallel behavior
```

This backlog keeps the Agent friend ambition intact while forcing every visible
step to be backed by current facts, clear authority, and testable behavior.
