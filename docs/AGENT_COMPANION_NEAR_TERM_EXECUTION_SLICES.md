# Agent Companion Near-Term Execution Slices

Date: 2026-08-18

Status: implementation sequencing plan for the current Builder worktree.

## Purpose

This document turns the Agent companion architecture into near-term engineering
slices that can be executed without colliding with the active main-side release
work.

It is intentionally narrower than the full Agent companion roadmap. The focus is
the bridge from the current Project-first Builder to a stable Codex-like Task
conversation, before adding Agent-first navigation, memory, or long-running
autonomy.

The projection contracts that should guide later Agent-first UI work are defined
in [Agent-First Projection and Data Contract](AGENT_FIRST_PROJECTION_AND_DATA_CONTRACT.md).
The issue-sized MVP backlog and decision log are tracked in
[Agent Companion MVP Backlog and Decisions](AGENT_COMPANION_MVP_BACKLOG_AND_DECISIONS.md).

## Current State From Code

The current worktree shows these implemented pieces:

| Area | Evidence | State |
| --- | --- | --- |
| Project catalog | `BuilderProjectCatalog.tsx` renders saved and in-progress projects | implemented, Project-first |
| Composer modes | `BuilderComposer.tsx` exposes Ask, Plan, Build mode menu items and removable mode chip | implemented |
| Generic ready label cleanup | `BuilderComposer.tsx` suppresses `ready_to_execute` from visible composer chrome | implemented in current worktree |
| Local intent router | `builderComposerIntent.ts` has Plan/方案 patterns and active-run routing | implemented, needs acceptance coverage |
| Semantic route classifier | `builder-semantic-route-classifier.cjs` has Plan/Build examples and JSON contract | implemented, invoked selectively |
| Conversation replay | `builder-conversation-replay.cjs` rebuilds turns/runs/reviews from canonical events | implemented |
| Task stream projection | `builder-task-stream-projection.cjs` projects assistant deltas, tool rows, run completion, plan review | implemented |
| Loading retention | `builderConversationController.ts` can retain conversation during refresh and publish stale state | implemented, insufficient full-shell proof |
| Transcript archive | documented implementation update in `CONVERSATION_LOADING_PERSISTENCE_AUDIT.md` | implemented as main-only fallback archive |
| Source files scroll | `BuilderPage.tsx` marks file content/tree scroll regions; CSS constrains them inside the side workspace | implemented, needs visual QA |
| Version/checkpoint meaning | `BuilderPage.tsx` labels Versions as optional milestones and distinguishes unsaved draft checkpoint protection | implemented, needs visual QA |
| Agent backend facts | Agent definition, assignment, goal, budget, delegation, supervision modules exist | implemented as backend facts |
| Memory hook | `included_memory_ids` exists in task context snapshots | hook exists, memory store not implemented |
| Agent product UI | no Agent sidebar/settings modules found | missing |
| Standing intents | no standing-intent module found | missing |

## Execution Principle

Do not start with the full Agent shell. First make the existing Task
conversation reliable and readable.

Near-term order:

```text
P0 stabilize current Builder shell
-> P1 finish Task conversation and Plan routing
-> P2 introduce default Agent projection
```

Agent memory, standing intents, and parallel work should wait until the visible
Task conversation is trustworthy.

## Slice 0: Baseline And Conflict Guard

Goal:

- capture current behavior before implementation;
- avoid conflicting with active release/canary work;
- define which tests prove this slice.

Recommended file areas:

- read only:
  - `src/features/builder/presentation/BuilderPage.tsx`;
  - `src/features/builder/presentation/BuilderComposer.tsx`;
  - `src/styles.css`;
  - `src/app/BuilderApp.tsx`;
  - `src/features/builder/application/builderComposerIntent.ts`;
  - `src/features/builder/application/builderConversationController.ts`;
  - `electron/builder-task-stream-projection.cjs`;
  - `electron/builder-conversation-replay.cjs`.

Avoid in this phase:

- packaged canary script rewrites;
- generation main service rewrites;
- runtime event contract rewrites;
- release packaging changes.

Output:

- before-state screenshots or notes for:
  - active Ask stream;
  - Plan result;
  - Build result with tool rows;
  - failed command or failed file read;
  - old project reopen;
  - Source files scroll;
  - narrow desktop width.

Exit criteria:

- the target failing behaviors are reproducible or explicitly marked as not
  reproduced in this worktree;
- exact selectors for regression tests are recorded.

## Slice 1: Tool Evidence Row Visual Contract

Goal:

- make running, completed, and failed tool rows share one typography and spacing
  contract;
- remove the current impression that newly edited rows use a different font
  size from earlier evidence rows.

Why first:

- the user directly observed inconsistent row typography;
- this is a compact UI slice;
- it can be done without changing event contracts.

Recommended file areas:

- `src/features/builder/presentation/BuilderPage.tsx`;
- `src/features/builder/presentation/BuilderPage.test.tsx`;
- `src/styles.css`.

Implementation notes:

- keep `programming_runtime_tool_activity` as the evidence-backed item type;
- preserve row identity and sequence;
- treat file, command, read, search, and failed actions as variants of one row
  anatomy:

```text
icon
title/action label
target label
detail/status line
optional counts/duration
optional inspector affordance
```

Typography contract:

| Element | Size | Line height | Weight |
| --- | --- | --- | --- |
| row title | 12px | 17px | 600 |
| target/code chip | 11-12px | 16px | 500 |
| detail/status | 12px | 17px | 400 |
| metadata/duration | 11px | 15px | 400 |

State contract:

| State | Visual behavior |
| --- | --- |
| running | stable row, spinner only, no size change |
| completed | same row height rhythm, icon changes quietly |
| failed | same title scale, failure color only on icon/status |
| grouped | group header uses same scale, children do not jump |

Tests:

- completed file row and running file row share the same title/detail classes;
- failed row does not use a larger standalone status title;
- grouped file edits preserve diff count rendering;
- command and file rows remain distinguishable.

Exit criteria:

- screenshot comparison shows no font jump between `Edited index.html`,
  `Could not finish index.html`, and `Read index.html`;
- existing runtime tool row tests remain green.

## Slice 2: Composer Mode And Context Chrome Polish

Goal:

- keep Ask/Plan/Build as explicit user controls;
- keep the composer visually quiet after a conversation starts;
- avoid showing implementation status labels as permanent chrome.

Current evidence:

- Ask, Plan, and Build modes are already in the add menu;
- `ready_to_execute` is already suppressed in `visibleContextStatusLabel`;
- tests already assert the ready label is not visible.

Recommended file areas:

- `src/features/builder/presentation/BuilderComposer.tsx`;
- `src/features/builder/presentation/BuilderComposer.test.tsx`;
- `src/styles.css`.

Implementation notes:

- preserve the current add-menu mode model unless usability testing proves a
  segmented control is needed;
- keep the initial project/folder context visible before first submit;
- after the first turn, keep project state compact and avoid repeating folder
  metadata above every input;
- show provider/context warnings only when they require action.

Tests:

- `Ready to execute current direction` is absent by default;
- Plan mode can be selected and removed;
- Ask mode cannot dispatch write/build;
- Build mode still respects project and write approval gates.

Exit criteria:

- users can explicitly force Ask/Plan/Build;
- no duplicate send command appears;
- composer chrome does not compete with the conversation.

## Slice 3: Source Files Scroll And Workspace Tab Stability

Goal:

- fix Source files content clipping;
- keep side workspace panels stable during unrelated conversation refresh;
- prepare workspace tabs for later drag reorder.

Recommended file areas:

- `src/features/builder/presentation/BuilderPage.tsx`;
- `src/features/builder/presentation/BuilderPage.test.tsx`;
- `src/styles.css`;
- `src/features/builder/infrastructure/builderDesktopSideWorkspaceFilesPort.ts`
  only if the current projection lacks enough state for UI tests.

Implementation notes:

- the Source files panel should have a constrained internal scroll container;
- the page should not depend on browser window scroll for source content;
- tab order should be stored as renderer preference or project/task UI state,
  not as source authority.

Tests:

- long Markdown source has scrollable content region;
- horizontal code/content overflow stays inside the panel;
- refreshing activity does not remount the selected source tab;
- selected tab remains selected after activity refresh.

Exit criteria:

- the screenshot case where Source files cannot scroll is fixed;
- side workspace no longer jumps when activity refreshes.

## Slice 4: Loading And Last-Stable Shell

Goal:

- fix old project activity loading loops;
- remove full-page/topbar/sidebar flicker during async project load;
- retain last stable projections while new data loads.

Recommended file areas:

- `src/features/builder/application/builderConversationController.ts`;
- `src/features/builder/application/builderProjectController.ts`;
- `src/features/builder/application/builderProjectCatalogController.ts`;
- `src/features/builder/hooks/useBuilderConversationController.ts`;
- `src/app/BuilderApp.tsx`;
- `src/features/builder/presentation/BuilderPage.tsx`;
- relevant controller and app tests.

Do not combine with:

- tool row redesign;
- Agent sidebar migration;
- runtime event protocol changes.

Implementation notes:

- distinguish foreground project switch from background probe;
- keep last stable toolbar model until the target project toolbar model is
  ready;
- use `refreshing/stale` for same-project refresh, not `loading/null`;
- old projects with versions but no activity should reach a stable diagnostic:

```text
No recorded activity for this project yet.
Versions are available.
```

Tests:

- same-project refresh keeps old activity visible;
- old project with no conversation reaches `absent`, not indefinite loading;
- failed replay with previous activity shows stale state;
- toolbar controls disable rather than disappearing during refresh;
- pending draft restore probe does not publish visible loading repeatedly.

Exit criteria:

- the user-observed `Loading activity...` loop is gone;
- topbar and side workspace do not visually reset during conversation refresh.

## Slice 5: Plan/方案 Routing And Plan Markdown

Goal:

- make "做一个 X 计划" and "做一个 X 方案" reliably produce a Plan when the
  sentence means proposal/design before changes;
- make the Plan content visible as Markdown in the conversation.

Recommended file areas:

- `src/features/builder/application/builderComposerIntent.ts`;
- `src/features/builder/application/builderComposerIntent.test.ts`;
- `src/app/BuilderApp.tsx`;
- `src/app/BuilderApp.test.tsx`;
- `electron/builder-semantic-route-classifier.cjs`;
- `tests/builder-semantic-route-classifier.test.cjs`;
- `electron/builder-generation-main-service.cjs` only if route preservation
  requires main-side fix;
- `src/features/builder/presentation/BuilderConversationMarkdown.tsx`;
- `src/features/builder/presentation/BuilderPage.tsx`.

Implementation notes:

- explicit Plan mode always wins;
- deterministic local routing handles obvious Plan/方案 requests;
- semantic classifier handles ambiguous Plan-vs-Build phrases;
- classifier output is advisory routing evidence only;
- the main side must not silently downgrade a renderer-selected Plan to answer;
- Plan markdown is a public artifact attached to the Task timeline.

Tests:

- `帮我做一个静态技术博客实施计划` with workspace -> Plan;
- `给当前文件夹做一个优化方案` with workspace -> Plan;
- `把刚才聊的整理成方案` after discussion -> Plan or brief update then Plan;
- `做一个方案展示页` -> Build;
- `做一个计划管理页面` -> Build;
- Plan source read approval precedes source read;
- `run_completed.result_kind = plan`;
- Plan approval records review and does not write files;
- approved Plan continuation asks for write approval before Build.

Exit criteria:

- the user's reported "only repeats my request" path is covered by test;
- Plan is visible as readable Markdown, not just a compact summary.

## Slice 6: Persisted Default Agent And Shell Cutover

Goal:

- make Agent-first the only product shell while preserving the existing
  Project, Conversation, Git, permission, and runtime authorities.

Recommended file areas:

- new frontend projection module under `src/features/builder/application` or
  `presentation`;
- current project catalog snapshot as input;
- persisted Agent definition/version/lifecycle read model as required input.

Implementation notes:

- bootstrap one persisted default Builder Agent;
- produce its Project and Task tree from main-owned facts;
- map saved and workspace projects under that Agent;
- require Task Address records for rendered Task rows;
- remove the Project-first catalog shell after the projection gate passes.

Tests:

- existing saved projects appear under default Agent;
- in-progress workspace projects appear under default Agent;
- missing Agent facts show a fixed setup failure;
- selecting a project row still opens the same project id.

Exit criteria:

- Agent-first sidebar is the only accepted navigation shell;
- all development projects are attached to the persisted default Agent;
- temporary bridge code is removed before acceptance.

## Slice 7: Parallel Task Right Rail Preparation

Goal:

- define the UI container for future concurrent work before implementing
  autonomy.

Recommended file areas:

- `BuilderPage.tsx` right rail/side workspace area;
- future `AgentTaskMonitorProjection`;
- Agent delegation/assignment facts as eventual input.

Implementation notes:

- do not render multiple full chats in one main timeline;
- show parallel tasks as compact right-rail rows;
- each row has title, project, phase, last activity, and stop/open controls;
- opening a row switches focus to that Task conversation;
- mutating tasks require explicit permission and conflict checks.

Tests:

- read-only parallel task appears without disturbing current Task;
- mutating parallel task waits for permission;
- completed parallel task does not auto-merge or auto-save;
- focus switching preserves current composer text.

Exit criteria:

- parallel work has an interaction home;
- single focused Task conversation remains readable.

## Verification Order

Run verification in increasing blast-radius order:

1. targeted component tests for the touched React component;
2. targeted application/controller tests;
3. route classifier tests;
4. task stream projection tests;
5. typecheck/build;
6. packaged visual canary only after UI slices are stable.

Recommended exact checks by slice:

| Slice | Minimum automated evidence |
| --- | --- |
| Slice 1 | `BuilderPage.test.tsx` tool-row cases |
| Slice 2 | `BuilderComposer.test.tsx` mode and status cases |
| Slice 3 | `BuilderPage.test.tsx` side workspace scroll/tab cases |
| Slice 4 | `builderConversationController.test.ts`, `BuilderApp.test.tsx` loading cases |
| Slice 5 | `builderComposerIntent.test.ts`, `builder-semantic-route-classifier.test.cjs`, `BuilderApp.test.tsx` Plan cases |
| Slice 6 | new Agent sidebar projection tests |
| Slice 7 | new task monitor projection/UI tests |

## Coordination Rules

- Keep UI-only slices separate from main-side runtime/canary release slices.
- Do not edit packaged canary scripts unless the slice explicitly reaches
  packaged verification.
- Do not change generation/runtime event contracts while working on visual row
  styling.
- Do not add Agent memory or autonomy in the default Agent projection slice.
- Do not retain a product-facing Project-first fallback; short-lived
  development bridges must be deleted before Slice 6 exits.
- Treat current main-side Agent facts as reusable evidence, not as product UI.

## Definition Of Ready For Agent-First UI

Agent-first sidebar work should start only after:

- old project activity loading is stable;
- Plan/方案 routing is covered;
- Plan markdown is visible in chat;
- composer modes are understandable and quiet;
- Source files panel is scrollable;
- tool evidence rows have stable visual contract.

## Bottom Line

The next work should be deliberately boring in the best way:

```text
fix the current Task conversation
then expose it under one default Agent
then add memory and long-running behavior
```

That sequence gives the product a Codex-like working surface first, then adds
the Agent companion layer without destabilizing the already-working project and
permission foundations.
