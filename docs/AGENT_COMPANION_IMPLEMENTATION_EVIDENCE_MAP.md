# Agent Companion Implementation Evidence Map

Date: 2026-08-18

Status: current implementation map for the Agent companion architecture.

## Purpose

This document maps the current Builder implementation to the target Agent
companion product architecture.

The key product decision is:

```text
Agent friend
-> Project boundary
-> Task conversation
-> Run evidence
-> Plan, draft, review, memory, standing intent
```

The current codebase is not starting from zero. It already contains many of the
hard authority and task facts needed for that shape. The missing work is mostly
product projection, memory, and long-running coordination.

## Current Product Surface

The current visible product is still Project-first.

Evidence:

- `src/features/builder/presentation/BuilderProjectCatalog.tsx` renders
  `Projects`, `Your projects`, saved projects, and in-progress workspace
  projects.
- `src/features/builder/application/builderProjectCatalogController.ts` keeps
  saved and workspace projects as the catalog read model.
- There is no current `agent-sidebar`, `agent-catalog`, `agent-settings`, or
  `standing-intent` UI module.

Implication:

- the left sidebar can be migrated through a projection layer;
- existing Project capabilities should be rebound under the Agent-first shell,
  not preserved as a second navigation path;
- Agent must not be modeled as just a renamed project.

## Composer And Modes

The composer already has the right direction for explicit user control.

Evidence:

- `BuilderComposer.tsx` exposes `composerMode`.
- the add menu contains Ask mode, Plan mode, and Build mode entries;
- a selected mode is shown as a removable chip;
- `ready_to_execute` is intentionally hidden as default chrome, while real
  provider/context status labels can still appear.

What this already solves:

- users can force Plan/Ask/Build when natural-language routing is uncertain;
- mode choice is state, not a second send button;
- generic internal readiness is not exposed as a noisy status tag.

Remaining gap:

- the mode entry point is hidden under the add menu;
- no top-level Agent/task mental model explains why a mode belongs to a Task;
- mode labels are still English and implementation-like rather than fully
  product-polished.

## Intent Routing

Plan/方案 routing is partially closed and should be treated as a P1 completion
target, not a future research item.

Evidence:

- `builderComposerIntent.ts` has explicit Plan patterns for Chinese phrases such
  as `实施计划`, `优化方案`, `重构方案`, `实现方案`, and `开发方案`.
- `builder-semantic-route-classifier.cjs` has main-owned semantic routing
  examples:
  - plan: `做一个静态技术博客实施计划`;
  - plan: `给当前文件夹做一个优化方案`;
  - plan: `帮我出一个 README 重构方案`;
  - build: `做一个计划管理页面`;
  - build: `做一个学习计划表应用`;
  - build: `做一个方案展示页`.
- `BuilderApp.tsx` can call `ports.generator.classifyIntent` when local routing
  needs semantic help.
- route decisions can dispatch `answer`, `plan`, `build`, `update_brief`,
  `clarify`, `ask_workspace`, `ask_permission`, `queue_followup`, `steer`, or
  `cancel`.

What this already solves:

- Plan and Build are separate behaviors;
- "plan as content" and "plan as app/page/product to build" can be separated by
  semantic classification;
- active runs can accept cancel/steer/follow-up routing instead of losing user
  input.

Remaining gap:

- the semantic classifier is not invoked for every ambiguous natural-language
  phrase;
- renderer-local route and main dispatch still need acceptance coverage for the
  exact phrases users naturally type;
- a Plan result must consistently render as markdown in the conversation, not
  only as a summary/status card.

## Conversation And Task Stream

The strongest implemented foundation is the event/replay/projection layer.

Evidence:

- `builder-conversation-replay.cjs` defines `builder-conversation-replay.v2`.
- replay handles submitted turns, active-run messages, run start, run progress,
  plan review, run completion, and completion state.
- `builder-task-stream-projection.cjs` builds a public task stream from
  canonical conversation events.
- the task stream projects:
  - user messages;
  - brief updates;
  - run start;
  - run context snapshots;
  - programming run admissions;
  - runtime assistant messages from `assistant_text_delta` /
    `assistant_text_completed`;
  - runtime tool activity;
  - tool calls and tool results;
  - agent step progress;
  - run completion;
  - candidate review;
  - plan review.
- the projection authority declares conversation evidence as
  `sqlite_canonical_event_replay_or_absent`.

What this already solves:

- the system can support Codex-like streaming activity;
- tool rows can be evidence-backed, not fabricated by the renderer;
- replay can reconstruct old task activity if events are available;
- Plan, Build, Review, and tool events can live in one Task stream.

Remaining gap:

- the UI still needs stronger visual contracts for streaming rows, tool rows,
  markdown, links, status color, density, and loading transitions;
- user-facing Task boundaries are not yet visible enough;
- parallel tasks are not yet a visible right-rail concept.

## Loading And Persistence

Conversation loading has a real retained-projection mechanism, but the product
symptom indicates it is not yet sufficient.

Evidence:

- `builderConversationController.ts` distinguishes `loading`, `ready`,
  `refreshing`, `stale`, `absent`, and `unavailable`.
- when loading the same project, it retains the previous conversation while
  refreshing if current state is `absent`, `ready`, or `stale`;
- failed refresh can publish `stale` with the retained conversation.
- `BuilderApp.tsx` contains pending draft restore probes and retry logic after
  project activity loads.

What this already solves:

- the controller model is not a naive blank-on-refresh loader;
- stale data can remain visible while refresh fails;
- pending draft recovery is explicitly retried.

Remaining gap:

- old project reopen can still show indefinite `Loading activity...`;
- top bar, side panels, and composer may still flicker because their state is
  assembled from several async sources, not one stable page-level projection;
- loading tests should verify the full shell, not only conversation state.

## Project Files And Side Workspace

The side workspace already exposes source files as a panel/tab, but it is still
project/artifact-centered.

Evidence:

- `BuilderPage.tsx` builds artifact tabs including `preview`, `changes`,
  `source`, `versions`, `permissions`, terminal placeholder, and side-chat
  placeholder.
- `BuilderPage.tsx` renders source files through the side workspace file tree
  and content projection.
- Source file scrolling and tab reordering are explicitly visible product gaps
  from manual testing.

What this already solves:

- project source has a distinct workspace surface;
- source viewing can be made independent from chat messages;
- the existing side workspace can host future parallel task details.

Remaining gap:

- Source files must scroll internally for long content;
- workspace tabs need drag reorder;
- tabs should remember user order per project/task without becoming authority
  for source state.

## Agent Back-End Foundation

The Agent backend is broader than the UI currently exposes.

Evidence:

- implemented Agent definition/version/lifecycle contracts;
- Agent assignment and assignment status contracts/stores;
- supervision lease contracts/stores;
- budget audit contracts/services;
- goal contracts and goal materialization/admission;
- delegation contracts/services and result review/materialization;
- private source context records;
- parent task context projection;
- tool-call recording and step progress recording.

What this already solves:

- Agent identity can be versioned;
- Agent work can be assigned to a Project, Conversation, Task, and Run;
- permission boundaries and supervision policy are explicit;
- delegation and parallel/subordinate work have a main-side fact model;
- budget enforcement can gate long-running work.

Remaining gap:

- no Agent friend list UI;
- no Agent settings UI;
- no user-facing autonomy levels;
- no visible standing-intent lifecycle;
- no right-rail parallel task monitor.

## Memory Foundation

Memory is not implemented yet as a durable product feature, but there are
important integration hooks.

Evidence:

- `builder-agent-task-context-snapshot.cjs` accepts `included_memory_ids`;
- step progress and project work tests use `builder-agent-memory:*` ids as
  references;
- no current `builder-agent-memory-store`, `builder-agent-memory-fact`, or
  memory inspector module exists.

What this already solves:

- context snapshots can record which memories were used once a memory store
  exists;
- memory can be introduced without changing the idea that context snapshots are
  authoritative evidence;
- memory can stay separate from raw conversation replay.

Remaining gap:

- no memory fact contract;
- no memory write proposal/review flow;
- no recall index;
- no deletion/tombstone flow;
- no user-facing memory inspector;
- no provider egress policy tied to sensitivity labels.

## Architecture Reuse Map

| Target capability | Current implementation to reuse | Missing layer |
| --- | --- | --- |
| Agent friend list | Agent definition/version contracts | sidebar read model and settings UI |
| Agent under projects/tasks | Project catalog, Task Address, assignment records | Agent -> Project -> Task projection |
| Task conversation | conversation replay, task stream projection | visible Task boundary and task locator |
| Codex-like streaming | runtime assistant/tool events | polished streaming UI contract |
| Plan mode | explicit mode, Plan route, plan review | inline Plan markdown and phrase coverage |
| Build mode | write approval and generation dispatch | clearer Task continuation model |
| Ask mode | answer route and read-only dispatch | less project-first composer framing |
| Old session reopen | conversation controller retention | full-shell stable loading projection |
| Source workspace | side workspace files panel | internal scrolling and tab reorder |
| Parallel work | Agent delegation and budget facts | right rail and task switcher |
| Long-term memory | `included_memory_ids` context refs | memory fact store and inspector |
| Long-running Agent | assignment, supervision, budget | standing intents and autonomy UI |

## Recommended Near-Term Slices

### Slice 1: Stabilize Existing Builder Shell

Scope:

- activity loading/reopen;
- top bar/sidebar/composer flicker;
- Source files internal scrolling;
- tool evidence row typography;
- composer generic status cleanup.

Why first:

- it fixes currently observed user pain;
- it reduces noise before introducing Agent hierarchy;
- it avoids making Agent UI inherit unstable loading behavior.

### Slice 2: Finish Task Conversation And Plan Contract

Scope:

- Plan/方案 phrase acceptance tests;
- renderer/main route alignment;
- inline Plan markdown rendering;
- approved Plan continuation;
- Task boundary labels and route evidence.

Why second:

- a reliable Task conversation is the unit beneath every Agent;
- the user's concrete failure was Plan intent not becoming Plan.

### Slice 3: Add Default Builder Agent Projection

Scope:

- one default Builder Agent;
- read-only Agent -> Project -> Task sidebar projection;
- persisted Agent bootstrap and direct shell cutover;
- no new memory/autonomy behavior yet.

Why third:

- it changes the product mental model without changing authority boundaries;
- it gives the UI a place for future memory and online status.

### Slice 4: Agent Settings Skeleton

Scope:

- Add/Edit Agent;
- Agent versioning;
- personality and working style;
- capability toggles;
- permission/autonomy controls as visible settings.

Why fourth:

- settings become meaningful once Agent is visible;
- permission UI must precede long-running online behavior.

### Slice 5: Memory Fact Store And Inspector

Scope:

- durable memory facts;
- proposal/review;
- recall into context snapshots;
- source refs;
- delete/archive/supersede;
- sensitivity and provider egress.

Why fifth:

- memory should personalize and recall, but never authorize actions;
- the current context snapshot already has the right hook.

### Slice 6: Standing Intents And Parallel Task Monitor

Scope:

- watch/remind/monitor contracts;
- right rail for parallel tasks;
- notifications;
- cancel/pause/revoke;
- conflict handling for mutating work.

Why sixth:

- long-running Agent behavior depends on stable memory, permissions, and task
  projection.

## Implementation Rules

- Do not replace current project-first behavior in the first Agent slice.
- Do not treat memory as a prompt blob.
- Do not let renderer state grant permission or prove source truth.
- Do not add autonomous work before standing intents are visible and revocable.
- Do not merge parallel mutating task output without explicit review.
- Do not use a single infinite chat transcript as the Agent's long-term memory.

## Bottom Line

The current codebase already contains the difficult backend shape for a
Codex-like task system:

```text
canonical events
-> replay
-> task stream projection
-> plans, tool activity, run completion, review
```

The Agent companion plan should therefore reuse that foundation. The correct
next move is not a rewrite. It is to add the missing product projection:

```text
Project-first Builder UI
-> stable Task conversation
-> default Agent projection
-> Agent settings
-> memory
-> standing intents and parallel work
```
