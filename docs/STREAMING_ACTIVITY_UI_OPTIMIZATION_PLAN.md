# Streaming Activity UI Optimization Plan

Date: 2026-08-18

Status: proposal and implementation plan.

Related documents:

- [Conversation Visual Streaming and Plan Markdown Spec](CONVERSATION_VISUAL_STREAMING_AND_PLAN_MARKDOWN_SPEC.md)
- [Codex-like Streaming Gap Audit](CODEX_LIKE_STREAMING_GAP_AUDIT.md)
- [Conversation Loading, Flicker, and Persistence Audit](CONVERSATION_LOADING_PERSISTENCE_AUDIT.md)
- [Programming Runtime Adapter And Event Protocol](PROGRAMMING_RUNTIME_ADAPTER_EVENT_PROTOCOL.md)
- [Codex-like Conversation Flow Architecture](CODEX_LIKE_CONVERSATION_FLOW_ARCHITECTURE.md)
- [Frontend Experience and Design System Roadmap](FRONTEND_EXPERIENCE_AND_DESIGN_SYSTEM_ROADMAP.md)

## Executive Summary

ClawFabric Builder already has the technical foundation for Codex-like streaming:

- a durable conversation event chain;
- a renderer-safe task stream projection;
- frame-coalesced live output;
- Harness runtime events for assistant text deltas and tool activity;
- separate public item types for runtime assistant messages and runtime tool facts;
- bounded Markdown rendering for conversation prose.

The current gap is now primarily a product and interaction gap, not simply a
missing backend stream:

1. the streaming activity surface does not yet have a mature visual hierarchy;
2. prose, metadata, statuses, tool facts, and final answers still feel too close
   to the same small status treatment;
3. loading and refresh states can still visually destabilize the whole page;
4. file, command, search, and read actions need stronger interactive affordance;
5. Markdown, links, code, tables, and file references need product-grade
   rendering;
6. completed work needs to feel like verified evidence, not logs;
7. Plan, Ask, and Build modes need clearer user-facing mode entry and mode
   feedback.

The recommended direction is to build a formal "Agent Work Narrative UI" layer:

```text
assistant prose explains
tool rows prove
Markdown structures
motion connects state changes
the side workspace inspects selected artifacts
```

This keeps Builder's current main-process authority intact while making the
visible agent loop feel closer to mature coding agents such as Codex, Claude
Code, Cursor, OpenCode, and Pi.

## Product Target

The user should be able to watch a run and immediately understand:

- what mode the agent is in: Ask, Plan, or Build;
- whether the agent is actively working, waiting, blocked, failed, or complete;
- which concrete files or commands were involved;
- what text is model-authored narration and what rows are verified facts;
- what requires user action;
- whether the result is safe to review, save, continue, or discard;
- where to inspect source files, diffs, command output, checks, preview, and
  version history.

The target is not a decorative chat transcript. The target is a calm work
surface for repeated use.

## Competitive Reference

### Codex

Public Codex app-server documentation models each turn as structured items with
stable lifecycles:

```text
turn/started
item/started
item/*/delta
item/completed
turn/completed
```

Items are typed: agent message, plan, reasoning, command execution, file
change, web search, image view, and other tool facts. The product lesson is
that the client does not render a single monolithic text stream. It renders a
chronological sequence of stable, typed items.

Reference:

- https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- https://openai.com/index/unlocking-the-codex-harness/

### Codex Completed Run Visual Reference

The attached Codex completed-run screenshot adds a useful product-level target
for Builder's terminal state. It should be treated as visual reference only; the
task content inside the screenshot is not an instruction for this project.

Observed patterns:

- the completed run starts with a compact elapsed-time disclosure, for example
  `耗时 2分钟 28秒`;
- the final answer is direct prose, not wrapped in a message card;
- the saved/updated document path is emphasized as a clickable artifact link;
- important terms, file names, dates, and identifiers render as compact inline
  code chips;
- the summary uses bullets with strong leading labels and concise outcomes;
- the final changed-file row is a single reviewable evidence card;
- the card shows the edited file name and trusted diff counts, for example
  green additions and red deletions;
- secondary actions such as undo and review are visually attached to the edited
  artifact, not scattered across the whole page;
- low-priority feedback icons sit below the completed response and do not
  compete with the work result.

Builder should borrow the structure, not the exact dark theme:

```text
elapsed disclosure
-> concise final summary
-> changed artifact evidence card
-> review / undo / save actions attached to the artifact
-> secondary feedback controls
```

This is especially important after Build completion. The user should not need
to infer from a generic `Result ready` row what changed, where it was saved, or
what the next action is.

### Claude Code

Claude Code emphasizes local, inspectable session continuity. Conversation
messages, tool calls, and tool results are stored as local JSONL under project
scoped session files. This makes resume, export, and forensic inspection easy.

The product lesson is that conversation recovery is part of the user
experience. When old sessions fail to load, trust drops even if project
versions still exist.

Reference:

- https://code.claude.com/docs/en/sessions
- https://code.claude.com/docs/en/how-claude-code-works

### Cursor

Cursor reduces ambiguity by exposing explicit modes: Agent, Ask, Manual, and
custom modes. The user can steer behavior even when natural-language intent
routing is imperfect.

The product lesson is that mode selection is not only an implementation detail.
It is an affordance that prevents costly misclassification.

Reference:

- https://docs.cursor.com/agent
- https://docs.cursor.com/en/agent/terminal
- https://docs.cursor.com/en/cli/reference/output-format

### OpenCode

OpenCode stores messages as typed parts. Text parts receive deltas and are
finalized; tool parts remain separate from text. Timing and tool state are
attached to the relevant part.

The product lesson is that text and tools should not share one generic row
renderer.

Reference:

- https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts

### Pi

Pi's tool render contract is strong. Tool renderers receive stable tool call
identity, partial state, expanded state, shared state, and invalidation hooks.
This allows a single tool row to update without remounting unrelated UI.

The product lesson is that advanced streaming UX needs a renderer contract, not
only event data.

Reference:

- https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts

## Current Builder Assessment

### What Is Already Good

Builder's current architecture has important strengths:

- Electron main owns authority, not the renderer.
- SQLite event chain is append-only and suitable for permission, review, save,
  and checkpoint authority.
- Runtime events now include assistant text delta/completion and tool lifecycle.
- Public task stream projection hides raw provider output.
- Live output is coalesced, reducing token-by-token React churn.
- Tool facts are typed by kind: read, search, edit, write, command.
- Markdown is rendered through an allowlist with unsafe HTML disabled.
- The side workspace already has Preview, Source, Versions, Files, and artifact
  inspection concepts.

This means Builder can reach a Codex-like experience without replacing the core
event architecture.

### Main Remaining Problems

#### 1. Visual hierarchy is too flat

Assistant prose, metadata, status rows, action rows, and result explanations
still share too many small-font and muted-color treatments. For Chinese and
English mixed content, this makes the main answer feel like diagnostic text.

#### 2. The page can still visually flicker

The reported issue where old sessions show `Loading activity...`, top toolbar
buttons flicker, and the right workspace flickers means loading state is still
too global. This must be solved before visual polish can feel reliable.

#### 3. Tool rows are not yet strong enough as evidence

Users need to scan file edits, command runs, failed checks, and repair steps
quickly. Tool rows should feel like verified facts, not casual prose.

#### 4. Streaming and final rendering need a cleaner handoff

The best pattern is:

```text
active stream: stable plain/prose node
completion: same item settles into bounded Markdown
history: detailed tool rows may collapse
final answer: remains readable and separate
```

The stream should not animate tokens, blink, remount old items, or reparse the
entire conversation on every delta.

#### 5. Source file and side inspector usability is incomplete

The reported Source files scroll issue shows that the right workspace still has
layout constraints that can trap content. Streaming UI quality depends on
inspector quality because tool rows need somewhere reliable to open details.

#### 6. Intent routing needs both LLM understanding and explicit mode controls

Natural language such as "帮我做一个 X 计划" and "帮我做一个 X 方案" should route
to Plan when context implies planning. However, mature products also expose
explicit modes because intent routing can fail.

Builder should do both:

- improve LLM/contextual intent classification;
- add explicit Ask, Plan, and Build triggers in the composer.

## Design Principles

1. **Truth before drama**: never make the UI look more capable than the verified
   event chain supports.
2. **Stable identity**: one run item, message item, or tool row updates in
   place. Unrelated UI does not remount.
3. **Readable prose**: assistant narration and final answers use primary text,
   comfortable line-height, and Markdown structure.
4. **Evidence rows**: files, commands, checks, reads, and searches are compact
   verified facts with clear state and target.
5. **Inspectors stay contextual**: the main timeline tells the story; the side
   workspace inspects selected artifacts.
6. **Mode clarity**: Ask, Plan, and Build should be visible state, not hidden
   prompt behavior.
7. **Motion is functional**: motion indicates arrival, state replacement,
   expansion, or focus. It does not decorate.
8. **Fallback is explicit**: when loading or replay fails, show a stable
   diagnosis instead of indefinite loading.

## Information Architecture

### Project-Scoped Sidebar and New Conversation Context

Codex's sidebar groups conversations under project folders. A project folder is
the stable top-level work context, and individual conversations/tasks are
children of that folder. Creating a new conversation inside a project may show a
composer context header with folder, locality, and branch information before
the first message is sent. After the conversation starts, that bootstrap
context should collapse into the task shell or header instead of remaining as a
permanent composer label.

Builder should adopt the same product principle:

```text
project folder / workspace
-> task or conversation list
-> new conversation bootstrap composer with explicit context
-> active conversation with context moved to shell/header
-> quiet composer for follow-up input
```

Required behavior:

- the sidebar should make project folders the primary grouping concept;
- conversations/tasks under the same project should visually belong to that
  project, not appear as unrelated cards;
- creating a new conversation from a project shows the selected folder/workspace
  context before first submit;
- the new-conversation bootstrap composer may show folder name, local/remote
  state, branch, provider/mode, or approval policy when these affect the first
  request;
- after the first user message is submitted, bootstrap context is no longer
  shown above the input as persistent composer chrome;
- the active conversation shell/header should carry durable project context;
- the follow-up composer should stay quiet except for mode, permission,
  attachment, failure, active-run, or approval states that change the user's
  next action;
- switching project folders changes the task list and new conversation context,
  but should not erase an already opened task's readable history.

This also reinforces the decision to hide generic composer readiness labels
such as `Ready to execute current direction`: once a task exists, the composer
should primarily be an input surface, not a duplicate project-status panel.

### Timeline Locator and Parallel Task Rail

Codex includes a compact scroll-side locator for jumping within a long
conversation. Builder can borrow the interaction pattern while changing the
semantic target: the locator should not only find chat messages; it can locate
historical task capsules, Plan decisions, Build runs, review checkpoints,
failures, saved versions, and resumed work.

The locator is a navigation aid, not another transcript. It should be compact
enough to sit beside the main conversation without competing with readable
content.

Recommended locator targets:

- user request;
- Plan proposed;
- Plan approved or rejected;
- Build run started;
- file changes prepared;
- check failed;
- check passed;
- candidate ready;
- version saved;
- task paused, resumed, merged, or superseded;
- handoff or coordination message;
- transcript fallback or recovery state.

Interaction requirements:

- hovering a locator mark previews a short label and excerpt;
- clicking a mark scrolls the main timeline to the corresponding item;
- keyboard users can open a locator list and move through marks;
- marks use stable task/run ids, not DOM index positions;
- the current viewport range is indicated subtly;
- failed, blocked, approved, and saved states have distinct icons or labels;
- the locator must not expose hidden provider data, raw prompts, source trees,
  internal ids, or credentials;
- locator marks must survive conversation refresh and old-session replay.

This is especially useful if Builder adopts internal Task Capsules inside one
project conversation. The user can stay in one conversation while still jumping
to a specific historical task.

### Parallel Task Presentation

Parallel tasks should not render as multiple simultaneous chat transcripts in
the main timeline. That would make the conversation unreadable and would blur
which task the composer is currently steering.

Recommended model:

```text
main conversation = focused task narrative
right rail / side workspace = parallel task monitor
timeline locator = historical task navigation
task capsule switcher = change focus when needed
```

The right side is the best place to monitor parallel work because it already
acts as contextual workspace. Builder does not need to call these "subagents" in
the UI. The user-facing concept can be "Parallel tasks", "Running work", or
"Task monitor".

Parallel task rail contents:

- task title;
- status: queued, running, blocked, needs review, failed, completed, cancelled;
- mode: Ask, Plan, Build, Review, Check;
- owning agent/thread reference if any, kept user-safe;
- last public update;
- progress evidence count;
- changed file count;
- check status;
- permission/review needed state;
- actions: Focus, Pause/Stop, Review, Open result, Merge into current task.

Focus behavior:

- only one task is the active conversation focus at a time;
- focusing a parallel task scrolls or switches the main timeline to that task
  capsule;
- the composer clearly shows which task receives the next user message;
- background tasks may append compact monitor updates, but they should not
  interleave long prose into the focused chat;
- if a background task needs user input, it appears as a right-rail attention
  state and may add one compact timeline marker.

Concurrency rules:

- each parallel task has its own task capsule, run ids, permission scope,
  context assembly, and cancellation state;
- permissions are granted per task/run, not globally to the whole conversation;
- two mutating tasks touching overlapping files must be serialized, blocked, or
  explicitly merged by main policy;
- read-only Ask or research tasks may run in parallel more freely;
- a completed background task should not auto-merge its result into the focused
  task without user review;
- right-rail status is a projection of durable task facts, not an independent
  authority.

Acceptance criteria:

- the main chat never shows two long assistant streams at the same time;
- parallel tasks are visible in a right-side monitor with clear status;
- selecting a parallel task makes its context and composer target explicit;
- blocked or review-needed background work is noticeable without hijacking the
  focused chat;
- overlapping file mutations are detected before both tasks write;
- completed parallel results can be reviewed and merged deliberately;
- the timeline locator can jump to historical task capsules and important run
  milestones.

### Parallel Task Entry Points

Parallel task discovery and focus switching need explicit front-end entry
points. The user should not have to remember that a background task exists.

Recommended entry points:

1. **Sidebar project group**

   Project folders remain the primary navigation container. Under each project,
   active and recent tasks appear as children. A running or blocked parallel
   task can show a compact status dot/spinner/count in the sidebar row.

   Use this for broad navigation:

   ```text
   clawfabric-builder
   ├─ Streaming Activity UI
   ├─ Loading / Session Recovery
   ├─ Side Workspace Tabs
   └─ 2 running
   ```

2. **Main header task switcher**

   The active conversation header should expose the current focused task. A
   small task switcher near the title can open a menu of sibling tasks in the
   same project.

   Use this for quick focus changes without leaving the current project:

   ```text
   Project: clawfabric-builder
   Task: Streaming Activity UI ▾
   ```

   The menu should group tasks by status:

   ```text
   Running
   - Tool row visual contract
   - Loading recovery

   Needs attention
   - Plan approval flow

   Recent
   - Streaming UI audit
   - DeepSeek Harness review
   ```

3. **Right-side task monitor**

   When any parallel task exists, the right rail should offer a `Tasks` or
   `Running work` tab. This is the primary live monitor for concurrent work.

   Each task item should include:

   - title;
   - status;
   - mode;
   - last public update;
   - changed file count;
   - check status;
   - review/permission attention state;
   - actions: Focus, Review, Stop, Merge, Open result.

   Use this for active coordination:

   ```text
   Running work
   - Loading recovery
     Running check...
     Focus | Stop

   - Tool row visual contract
     Ready for review
     Focus | Review | Merge
   ```

4. **Timeline locator**

   The locator beside the main timeline should mark task boundaries and major
   run milestones. Clicking a task marker should scroll to the task's boundary
   or switch focus if the target task is not currently expanded in the main
   timeline.

   Use this for historical positioning:

   ```text
   markers:
   user request
   plan proposed
   build started
   check failed
   review ready
   version saved
   task resumed
   ```

5. **Composer task target**

   The composer must always make the message target explicit when more than one
   task is active. It does not need a permanent verbose status pill, but it
   should show a compact target selector only when ambiguity exists.

   Example:

   ```text
   To: Streaming Activity UI ▾
   [Ask a question, or describe the next change...]
   ```

   If only one task is active, this selector can be hidden.

6. **Attention toast or compact marker**

   If a background task becomes blocked, fails, or needs review, it may create a
   compact nonmodal notification. The notification should not steal focus from
   the current task.

   Example:

   ```text
   Loading recovery needs review
   Review | Focus
   ```

Recommended front-end rule:

```text
sidebar = project and task discovery
header switcher = current focused task
right rail = live parallel task monitor
timeline locator = historical task navigation
composer target = where the next message goes
toast/marker = attention without hijacking focus
```

Default behavior:

- if there is one active task, keep the composer quiet;
- if there are multiple active tasks, show the compact composer target;
- if a background task needs review, show it in the right rail and add one
  compact attention marker;
- if the user clicks `Focus`, the main conversation switches to that task's
  narrative and the composer target follows it;
- if the user clicks `Merge`, show a review step before moving results into the
  focused task;
- if tasks touch overlapping files, show the conflict in the right rail before
  admitting both writes.

### Timeline Item Types

The main activity timeline should render these product-level items:

| Item | Purpose | Renderer |
| --- | --- | --- |
| User message | User intent | User bubble |
| Mode decision | Ask, Plan, or Build selected | Small mode chip / compact row |
| Assistant stream | Model-authored public narration | Streaming prose |
| Tool activity | Verified read/search/edit/write/command | Evidence row |
| Check result | Verified command/check outcome | Evidence row with result state |
| Plan result | Main-admitted plan content | Markdown plan document |
| Approval state | Plan/candidate decision | Footer attached to target item |
| Candidate result | Reviewable draft | Review block |
| Final answer | Completed assistant summary | Markdown prose |
| Loading/fallback | Load, replay, transcript, or error state | Stable diagnostic surface |

### Plan Result Rendering

Plan output must be rendered as complete Markdown content in the main chat.
It must not be reduced to only a summary row, `Result ready` state, or a
one-sentence description.

Required Plan chat structure:

```text
Plan title
short plan summary
numbered steps
purpose for each step
expected change for each step
approval / rejection footer
```

A compact summary may appear above the Plan as supporting prose, but it cannot
replace the Plan document itself. The user must be able to read and approve the
Plan without opening the right workspace. The right workspace may inspect
referenced files, preview, diffs, or versions, but it is not the primary Plan
reader.

### Mode Model

Mode should be explicit at the composer level:

```text
Ask   - answer/read only
Plan  - create a plan or方案; no mutation
Build - create/change files, run admitted checks
```

Rules:

- The selected mode appears inside the composer header.
- The submit button icon and accessible label reflect the selected mode.
- Natural-language routing may suggest a mode, but the user can override it.
- "计划", "方案", "实施方案", "roadmap", "proposal", "plan", "strategy" should
  map to Plan when the task intent is non-mutating.
- If the user says "按照这个方案执行", Plan should transition to Build only
  after an explicit or inferred execution intent is accepted by policy.
- Ask mode should not be allowed to mutate.
- Plan mode should not write files unless the user explicitly asks to save the
  plan as an artifact or doc.

### Composer Readiness Labels

Generic internal readiness labels such as `Ready to execute current direction`
should not be shown by default. They describe implementation state rather than
user value, add visual noise to the composer, and can make the input area feel
busy before the user has done anything.

Composer status should be visible only when it changes the user's next action:

- permission is required;
- the selected mode is Ask, Plan, or Build;
- the app is waiting for the user's approval;
- the current project is read-only or unavailable;
- a previous request failed and can be retried;
- the agent is actively running or cancellation is available.

The default idle composer should stay quiet:

```text
project/file context selector
mode selector
input
attachment/options controls
submit
```

If a readiness state is useful for diagnostics, keep it in a tooltip,
accessible label, debug panel, or non-default developer mode rather than as a
permanent pill inside the composer.

## Visual System

### Typography

Use one Windows-native UI stack:

```css
font-family:
  "Segoe UI Variable Text",
  "Segoe UI",
  "Microsoft YaHei UI",
  system-ui,
  sans-serif;
```

Use monospace only for code and commands:

```css
font-family:
  "Cascadia Mono",
  "Cascadia Code",
  Consolas,
  "Microsoft YaHei UI",
  monospace;
```

Recommended type ramp:

| Role | Size / line-height | Weight |
| --- | --- | --- |
| Assistant prose | 14px / 22px | 400 |
| Final answer | 14px / 22px | 400 |
| User message | 14px / 21px | 400 |
| Plan title | 16px / 23px | 650 |
| Plan heading | 14px / 21px | 650 |
| Tool row title | 13px / 19px | 600 |
| Tool metadata | 12px / 17px | 400 |
| Status row | 12px / 18px | 500 |
| Inline code | 12.5px / 18px | 500 |
| Code block | 12px / 19px | 400 |

Rationale:

- 12px is acceptable for metadata, not for the main assistant answer.
- Chinese mixed with English paths and code needs more line-height than compact
  Latin-only UI.
- The main reading measure should be around `68ch` to `76ch`.

### Color Roles

The conversation area should move toward crisp neutral surfaces with restrained
semantic colors. Avoid making the whole app read as one beige, cream, slate, or
green family.

Suggested light tokens:

| Token | Value | Use |
| --- | --- | --- |
| canvas | `#F7F8F8` | page background |
| surface | `#FFFFFF` | message and inspector surface |
| surface subtle | `#F2F4F3` | code, hover, subtle regions |
| border | `#DDE2DF` | normal border |
| border strong | `#C8D0CB` | active/focus border |
| text primary | `#1D211F` | prose and key labels |
| text secondary | `#4F5752` | statuses and supporting text |
| text muted | `#68716B` | metadata only |
| brand | `#2D6A58` | selected mode, safe primary accents |
| link | `#2764D9` | external/internal links |
| success | `#16845B` | passed checks |
| warning | `#9A5A13` | pending/fallback |
| danger | `#C13A4A` | failures |

Rules:

- Normal readable text must meet WCAG 4.5:1 contrast.
- Color cannot be the only signal for success, warning, or failure.
- Links should be blue rather than brand green, so users can distinguish action
  links from state labels.
- Tool rows should use icons plus labels, not large tinted cards.

### Spacing

Recommended rhythm:

| Space | Value |
| --- | --- |
| between turns | 18px |
| between paragraphs | 10px |
| between tool rows | 6px |
| heading to body | 6px |
| icon to content | 8px |
| Plan footer top separator | 12px |
| composer content padding | 12px to 16px |
| side inspector inner padding | 12px to 16px |

The UI should feel dense enough for work, but not compressed like logs.

## Streaming Behavior

### Active Assistant Text

Active text should:

- render in one stable node;
- use primary readable text;
- update at a frame-coalesced cadence;
- avoid token-level animation;
- avoid blinking cursors;
- avoid full Markdown reparsing for every delta;
- use `aria-live="polite"` on the active message container;
- preserve user scroll position when the user is reading earlier content.

### Completion Handoff

On `assistant_text_completed`:

1. seal the message in the durable event chain;
2. replace volatile live text with the completed public item;
3. render completed prose as bounded Markdown;
4. preserve the same timeline position;
5. hide duplicate terminal text when it exactly repeats the final assistant
   response;
6. keep verified tool rows before or alongside the answer according to event
   order.

### Retry Handling

If the runtime retries after partial output:

- discard only the correlated failed partial tail;
- preserve earlier completed narration;
- do not remount the whole conversation;
- do not show raw provider retry details as ordinary work;
- record a bounded diagnostic event for replay and support.

## Tool Row Interaction

### Row Anatomy

Each tool row should have:

```text
icon
primary action label
target label
state label
optional duration
optional result summary
```

Examples:

```text
Editing docs/plan.md
Edited docs/plan.md +42 -3
Running npm test
Ran npm test in 8s
Command failed: npm test
Reading src/app/BuilderApp.tsx
Searched docs for "streaming"
```

### Current Typography Inconsistency Root Cause

Observed packaged UI can show runtime tool rows with inconsistent visual size:
for example `Read index.html`, `Edited index.html`, and `Could not finish
index.html` can appear with different apparent font size and weight even though
they represent the same product concept: a tool activity fact.

The root cause is a renderer split:

- while a `programming_runtime_tool_activity` is still part of the ordinary
  timeline, `ActivityItem` renders it as a status item with
  `.cf-builder-activity-title` and `.cf-builder-activity-body`;
- after `run_completed`, `activityEntries()` moves visible runtime tool items
  into a synthetic `run_history` entry;
- `ActivityRunHistory` then renders the same product concept through
  `RuntimeHistoryAction`, using `.cf-builder-run-history-action`,
  `.cf-builder-runtime-history-action-button`, `strong`, and `small`;
- the two renderer paths use different grid tracks, gaps, inherited font
  behavior, line-height rules, text colors, and font weights.

Relevant implementation areas:

- `src/features/builder/presentation/BuilderPage.tsx`
  - `activityEntries(...)` hides runtime tool items and moves them into
    `run_history` after `run_completed`;
  - `ActivityItem(...)` renders active/current tool activity;
  - `RuntimeHistoryAction(...)` renders completed/history tool activity.
- `src/styles.css`
  - `.cf-builder-activity-title` and `.cf-builder-activity-body`;
  - `.cf-builder-run-history-action`;
  - `.cf-builder-runtime-history-action-button strong`;
  - `.cf-builder-runtime-history-action-button small`.

This should not be fixed by locally shrinking one label. The product-level fix
is to introduce one shared Tool Evidence Row visual contract and apply it to
active, completed, failed, cancelled, direct, and grouped-history states.

Required rule:

```text
same tool activity concept
-> same typography tokens
-> same icon alignment
-> same target/detail rhythm
-> only state, icon, tense, color, and disclosure context may change
```

Acceptance criteria:

- active `Editing index.html` and completed `Edited index.html` use the same
  title size, title line-height, and title weight;
- failed `Could not finish index.html` uses the same title typography as
  completed and active tool rows;
- details such as `Read index.html.` or `Edited index.html with an error.` use
  the same metadata typography everywhere;
- moving a row into completed run history must not make it look larger,
  smaller, bolder, or more important than it was during execution;
- grouped history summaries may have their own summary style, but the rows
  inside the group must use the shared Tool Evidence Row contract;
- tests should assert the shared CSS class or design token is used by both
  `ActivityItem` and `RuntimeHistoryAction`.

### States

| State | UI |
| --- | --- |
| active | spinner or progress icon, present tense |
| completed | check/state icon, past tense |
| failed | danger icon, short failure label |
| cancelled | neutral stopped icon |
| blocked | warning icon, user action nearby |

### Grouping

Rules:

- one action remains direct;
- multiple adjacent same-type actions may collapse;
- file actions and commands do not collapse into the same group;
- failed actions remain visible even after repair;
- expanded content should not cause large scroll jumps;
- collapsed group summary should expose count, kind, and most important target.

### Side Workspace Links

Rows open contextual inspectors:

- read/search -> Source or Files;
- edit/write -> Changes;
- command/check -> Command/check result view;
- preview result -> Preview;
- saved version -> Versions.

The renderer must pass main-issued opaque references, not arbitrary file paths
or raw commands.

### Side Workspace Tabs

The side workspace tabs should behave like lightweight editor tabs, not fixed
navigation buttons. Users may open Preview, Changes, Versions, Source files, and
individual files while following an agent run; once multiple tabs exist, tab
order becomes part of the user's working context.

Required behavior:

- tabs can be dragged horizontally to reorder within the side workspace tab
  strip;
- drag reordering preserves the active tab;
- closing a tab preserves the relative order of remaining tabs;
- opening a new file or inspector appends near the active related context
  where possible, otherwise at the end;
- keyboard users can reorder tabs through accessible commands or a menu;
- tab order is local UI state and must not grant source, command, preview, or
  filesystem authority;
- persisted tab order is optional for the first slice, but in-session order
  must remain stable across conversation refreshes;
- tab drag must not trigger accidental file open, preview reload, or source
  content remount.

Acceptance criteria:

- `Preview` and `index.html` can swap positions by drag;
- the selected tab remains selected after reorder;
- Source file scroll position is not reset by tab reorder;
- conversation streaming or task-stream refresh does not reset tab order;
- focus is restored to the moved tab after keyboard reorder;
- tab close buttons remain clickable and do not start a drag accidentally.

## Markdown and Rich Text

### Allowed Content

Conversation Markdown should support:

- headings h1 to h4;
- paragraphs;
- ordered and unordered lists;
- task-list checkboxes as disabled controls;
- inline code;
- code blocks;
- links with safe protocols;
- blockquotes;
- tables;
- horizontal rules;
- emphasis and strong emphasis.

It should not support:

- raw HTML;
- images;
- iframe;
- script or style;
- forms;
- custom protocols;
- arbitrary relative navigation;
- MDX.

### Links

Rules:

- `https`, `http`, and `mailto` links are allowed.
- Unsafe protocols are rendered as plain text.
- External links show an external-link affordance on hover/focus.
- Internal file references become clickable only when main provides a matching
  safe file reference.
- Clicking a link never gives the renderer source, shell, Browser, or file
  authority.

### Code Blocks

Code blocks should:

- use the monospace stack;
- have a subtle header with language when known;
- include a copy button on hover and keyboard focus;
- horizontally scroll without breaking the page;
- have a maximum height with internal scroll for very large output;
- avoid syntax highlighting until the safe rendering boundary is settled.

Syntax highlighting can be P2. The first priority is readable contrast,
wrapping, copy, and safe bounds.

## Loading, Flicker, and Recovery

Streaming polish depends on stable loading.

### Required Loading Model

Use separate states for:

```text
initial loading
same-project refreshing
project switching
conversation absent
conversation replay failed
projection failed
transcript fallback available
transcript fallback unavailable
```

Do not collapse these into one visible `Loading activity...` state.

### Last-Stable Shell

When opening or refreshing a project:

- keep the last stable toolbar until the next project shell is ready;
- keep the right workspace mounted where possible;
- disable unavailable actions instead of removing controls;
- show local skeleton only inside the panel whose data is missing;
- avoid resetting composer identity unless the selected project truly changes;
- do not let pending draft restore retries drive visible full-page loading.

### Transcript Fallback

SQLite should remain the source of truth. JSONL transcript should be a
non-authoritative fallback:

```text
SQLite event chain = authority
JSONL transcript = read-only history, export, diagnostic fallback
```

When SQLite replay fails but JSONL exists:

- show a stable read-only transcript;
- label it clearly;
- disable review/save/execute actions that require authoritative replay;
- provide a repair/export diagnostic path later.

## Motion

Motion should follow Fluent-style functional motion:

| Event | Motion |
| --- | --- |
| item arrival | opacity 0 to 1, translateY 4px to 0, 160ms |
| active status appears | opacity only, 120ms |
| tool state changes | icon/color cross-fade, fixed row height |
| disclosure expands | chevron rotation and content reveal, 180ms |
| plan approval footer changes | opacity and small translateY, 160ms |
| spinner | linear rotation only |

Forbidden:

- per-token animation;
- typewriter delay;
- blinking cursor;
- full-list fade on refresh;
- whole-panel remount flash;
- shimmer behind readable text;
- scale animation on dense work UI;
- scroll animation while the user is reading older content.

Respect `prefers-reduced-motion`:

- disable translation and continuous nonessential movement;
- keep labels and icons;
- use immediate replacement or short opacity-only transitions.

## Accessibility

Minimum requirements:

- normal text contrast at least 4.5:1;
- visible keyboard focus for every interactive row, link, button, tab, and
  disclosure;
- icon-only buttons have accessible labels and tooltips;
- active stream uses a restrained `aria-live="polite"` region;
- reduced motion is honored;
- row click targets are at least comfortable desktop targets;
- text remains selectable;
- code copy does not require pointer-only hover;
- failure, warning, and success include text labels, not only colors.

## Architecture Plan

### Renderer Contract

Create or formalize a small renderer contract around public task stream items:

```ts
type ActivityPresentationKind =
  | "assistant_stream"
  | "assistant_markdown"
  | "plan_markdown"
  | "tool_activity"
  | "check_result"
  | "candidate_review"
  | "mode_state"
  | "loading_state"
  | "fallback_transcript";
```

Each item needs:

- stable item id;
- run id;
- turn id where relevant;
- sequence;
- presentation kind;
- active/completed/failed/cancelled/blocked state;
- safe display text;
- optional main-issued target reference;
- optional duration from main, not renderer timers;
- optional grouping key.

### Main Authority

Main remains responsible for:

- provider credentials;
- project identity;
- workspace path authority;
- write permission;
- file and command admission;
- event append;
- event replay;
- checkpoint and version state;
- transcript archive generation;
- safe public projection.

Renderer remains responsible for:

- visual presentation;
- local expand/collapse state;
- local hover/focus state;
- invoking main-issued references;
- not interpreting raw source paths as authority.

### Event Projection

The task stream projection should avoid generic lifecycle rows like "provider
request started" unless they are useful diagnostics. Public work rows should
come from:

- assistant public text;
- real tool start/update/completion/failure;
- main-owned file changes;
- main-owned checks;
- plan/candidate review decisions;
- trusted run settlement.

## Implementation Plan

### Phase 0: Baseline Capture

Before changes:

- capture screenshots of current Ask stream, Plan result, Build result, failed
  request, source panel, old session load, and right workspace scroll;
- record current DOM remount behavior for active stream and toolbar;
- document current colors, font sizes, and contrast ratios;
- identify exact selectors used by activity, markdown, tool rows, composer, and
  side workspace.

Output:

- one before-state visual report;
- no behavior changes.

### Phase 1: Loading and Layout Stabilization

Fix the trust-breaking issues first:

- old session reopening should not stay at indefinite loading;
- same-project refresh should retain existing activity;
- project switch should keep a last-stable shell until next shell is ready;
- toolbar controls should disable instead of disappear where possible;
- side workspace should not remount during unrelated conversation refresh;
- Source files panel must scroll within its available height;
- pending restore probes must not cause visible loading loops.

Acceptance:

- no full toolbar flicker during conversation refresh;
- no full right workspace flicker during activity load;
- old project with Versions but no conversation shows a stable diagnostic;
- Source files content is scrollable and not clipped.

### Phase 2: Conversation Visual Type System

Split current activity styling into dedicated roles:

- assistant prose;
- final answer;
- status row;
- metadata;
- tool row;
- plan document;
- candidate review;
- failure/fallback diagnostic.

Changes:

- raise assistant prose to 14px / 22px;
- keep metadata at 12px / 17px;
- use primary text for prose and Plan;
- use muted text only for nonessential metadata;
- establish code, link, table, list, blockquote styles;
- restore list marker spacing for Markdown surfaces.

Acceptance:

- assistant answer no longer looks like status metadata;
- Chinese/English mixed paragraphs are readable;
- no text overlap or clipped buttons at common desktop widths.

### Phase 3: Tool Evidence Rows

Redesign tool rows around state and target:

- read/search/edit/write/command each has icon, label, state, and target;
- action rows are full-row clickable when they open inspectors;
- failures stay visible;
- repair steps appear chronologically;
- grouping applies only to multiple same-kind rows;
- command rows expose exit status and duration when trusted;
- file rows expose added/deleted lines when trusted.

Acceptance:

- one file edit is direct;
- multiple file edits can collapse;
- command rows do not collapse into file rows;
- failed command remains visible after a passing repair;
- keyboard users can open every inspector that pointer users can open.

### Phase 4: Streaming Handoff and Markdown Finalization

Make active and completed text feel continuous:

- active text remains a stable live node;
- completed text renders through Markdown without moving its position;
- Markdown parsing is deferred or bounded during streaming;
- repeated terminal text is hidden by presentation, not by deleting events;
- safe links and code blocks get polished interactions.

Acceptance:

- no token flicker;
- no whole-list remount;
- final Markdown appears in the same timeline location;
- links, code blocks, tables, and lists render safely and readably.

### Phase 5: Mode Controls and Intent Feedback

Add explicit mode controls:

- Ask;
- Plan;
- Build.

Behavior:

- composer shows current mode;
- natural-language routing can suggest Plan for "计划" and "方案";
- explicit mode wins over heuristic suggestion;
- user can change mode before submit;
- mode mismatch gets a subtle inline clarification only when risky.

Acceptance:

- "帮我做一个 X 计划" routes to Plan when no write is requested;
- "帮我做一个 X 方案" routes to Plan equivalently;
- "按这个方案执行" routes to Build only when execution intent is clear;
- Ask mode cannot mutate;
- Plan mode does not create files unless explicitly asked.

### Phase 6: Transcript and Recovery Polish

Build the user-facing part of transcript fallback:

- if authoritative conversation loads, normal UI is used;
- if authoritative replay fails but transcript exists, show read-only history;
- label fallback state;
- disable unsafe actions;
- expose diagnostic copy/export later.

Acceptance:

- users can read old conversations even if replay is broken;
- fallback does not enable save, review, restore, or execute;
- recovery state is clear and stable.

### Phase 7: Packaged Visual Canary

Add visual canaries:

- Ask stream;
- Build stream with read/edit/check;
- failed check then repair;
- Plan Markdown with approval;
- source file scroll;
- old session reopen;
- transcript fallback;
- reduced motion;
- narrow desktop layout;
- long Chinese/English mixed response.

Checks:

- no loading loop;
- no toolbar flicker;
- no overlapping text;
- no hidden Source files overflow;
- no raw provider JSON;
- no unsafe links;
- stable item identity for live stream;
- accessible focus state visible.

## Suggested File Areas

Likely implementation areas:

- `src/features/builder/presentation/BuilderPage.tsx`
- `src/features/builder/presentation/BuilderConversationMarkdown.tsx`
- `src/features/builder/application/builderLiveOutputStore.ts`
- `src/features/builder/application/builderConversationController.ts`
- `src/app/BuilderApp.tsx`
- `src/styles.css`
- `electron/builder-task-stream-projection.cjs`
- `electron/builder-programming-runtime-events.cjs`
- `electron/builder-conversation-main-service.cjs`
- `electron/builder-conversation-transcript-archive.cjs`
- packaged canary tests under `tests/`

Do not begin by broadly refactoring all layout. Start with stable state and
activity renderer boundaries.

## Test Strategy

### Unit Tests

- Markdown allowlist rejects unsafe HTML and unsafe URLs.
- Long Markdown falls back safely.
- Runtime tool activity groups only same-kind rows.
- Failed rows remain visible after repair.
- Plan and solution/方案 intents normalize to Plan.
- Ask mode cannot produce mutation admission.
- Plan mode cannot write without explicit file-save intent.

### Integration Tests

- task stream projection keeps stable item ids;
- assistant delta completion produces one completed message;
- duplicate terminal assistant text is hidden only in presentation;
- old session absent state is stable;
- transcript fallback is read-only;
- pending restore probe does not publish visible loading.

### Visual Tests

- desktop 1280x720;
- desktop 1440x900;
- narrow desktop around 1024px width;
- long source file in right workspace;
- long Chinese/English prose;
- reduced motion;
- hover and keyboard focus states.

### Packaged Canaries

- real provider Ask stream;
- real provider Plan for "方案";
- real provider Build with file edit and check;
- failed request retry;
- restart and old session load;
- side workspace scroll;
- save version after review.

## Risks

### Risk: UI claims unverified work

Mitigation:

- narration is separate from verified tool facts;
- renderer never invents file names, durations, or command results;
- main-issued references are required for inspector actions.

### Risk: Markdown becomes authority

Mitigation:

- Markdown links and file paths are display only unless matched to main-issued
  refs;
- no raw HTML;
- no arbitrary protocols.

### Risk: visual refactor reintroduces flicker

Mitigation:

- solve loading first;
- keep stable item ids;
- add tests for no full-list remount;
- avoid global state resets.

### Risk: explicit modes make the UI heavier

Mitigation:

- use compact segmented controls or a small dropdown in the composer header;
- preserve natural-language routing;
- make current mode visible, not noisy.

### Risk: too much animation hurts work UX

Mitigation:

- restrict motion to state changes;
- honor reduced motion;
- avoid token animation and large panel transitions.

## Recommended Priority

1. P0: old-session loading, toolbar flicker, right workspace flicker, Source
   files scrolling.
2. P1: conversation type ramp, colors, spacing, Markdown surface, link/code
   polish.
3. P1: tool evidence rows with stable state and inspector links.
4. P1: active stream to final Markdown handoff.
5. P2: explicit Ask/Plan/Build mode controls and improved intent routing.
6. P2: transcript fallback viewer and recovery diagnostics.
7. P3: syntax highlighting, richer copy/export, advanced command output
   inspection.

## Coordination Recommendation

The main task should own P0 if it currently has uncommitted changes in
`BuilderApp.tsx`, `BuilderPage.tsx`, `styles.css`, the runtime projection, and
packaged canaries. Those files are tightly coupled to the flicker/loading and
streaming renderer work.

This task can own or review the design/system spec, acceptance criteria, visual
QA checklist, and competitive comparison. After P0 is stable, either task can
take the P1 visual implementation, but only one task should edit the main
activity renderer at a time.

## Definition of Done

The streaming activity optimization is done when:

- a user can watch Ask, Plan, and Build and understand the mode and progress;
- active text streams without flashing or remounting old messages;
- final answers and Plans are comfortable Markdown documents in chat;
- tool rows feel like verified evidence and open the correct inspector;
- loading failures become stable, useful states;
- old sessions recover or show an explicit fallback;
- source files, command output, and long Markdown remain scrollable;
- keyboard and pointer interactions are equivalent;
- the UI passes packaged visual canaries on common desktop sizes;
- no raw provider JSON, private reasoning, credentials, or unauthorized paths
  leak into the renderer.

## Bottom Line

Builder's architecture can support a Codex-like experience. The important next
step is not adding more loose prose. It is turning the existing runtime event
chain into a polished, stable, typed work narrative that users can trust during
real desktop work.
