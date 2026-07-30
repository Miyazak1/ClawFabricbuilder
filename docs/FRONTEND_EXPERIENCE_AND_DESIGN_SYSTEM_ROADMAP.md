# Frontend Experience and Design System Roadmap

## Purpose

This document turns the Builder frontend direction into executable product,
interaction, and design-system slices. It is not a visual refresh brief. It is
the long-term product plan for making ClawFabric feel like a modern chat-first
builder that can discuss, plan, preview, review, and execute work safely.

The core product target is:

- chat naturally before acting;
- preserve project and conversation context as executable product intent;
- build only after clear execution intent;
- keep project folders and source folders as explicit work and permission
  boundaries;
- move large artifacts out of the chat flow into a dedicated workspace;
- make the interface feel modern, precise, and trustworthy.

## Product Direction

ClawFabric should become a conversation-grounded local app builder. The user
should be able to explore an idea through multiple chat turns, refine
requirements, review a plan, and then say "do it" or "按刚才方案做" to execute
against the selected project workspace.

The product should support three time horizons:

1. **Current creation loop**: select a project folder, chat, generate a draft,
   preview, review changes, save or discard.
2. **Working builder loop**: chat creates a persistent working brief; explicit
   execution generates from that brief; preview and changes live in an artifact
   workspace.
3. **Long-term visual builder loop**: the user can click or annotate preview
   elements, request localized edits, compare versions, run real previews,
   publish, and return to earlier checkpoints.

## Reference Product Lessons

These references should guide the product model, not be copied literally.

- **Codex** separates environment, approval mode, task activity, and right-side
  tools. The important lesson is that workspace and permissions are separate
  from intent. Having a project folder does not mean every message should edit.
- **Claude Code** separates plan/read-only behavior from edit behavior through
  permission modes. The lesson is that high-cost actions need independent
  permission and mode boundaries.
- **Cursor** separates Ask, Agent, Manual, and custom tool modes. The lesson is
  that chat can search and reason without changing files, while agent execution
  has stronger tool access.
- **aider** supports ask/code/architect flows. The lesson is that a user can
  discuss first, then issue a short contextual execution phrase after the
  earlier discussion is already in context.
- **OpenHands** models each agent step as either a conversation action or a
  code/tool action. The lesson is that a turn should choose an action type
  before performing work.
- **Lovable/Bolt/v0** separate prompt, preview, code, and publishing surfaces.
  The lesson is that a builder needs an artifact workspace, not just a chat
  transcript with large previews embedded in it.

Useful public references:

- Codex approval modes: https://help.openai.com/en/articles/11096431
- Codex environments and sandboxing: https://learn.chatgpt.com/codex/environments/modes
- Claude Code permissions: https://code.claude.com/docs/en/permissions
- Cursor modes: https://docs.cursor.com/agent
- Cursor Design Mode: https://cursor.com/blog/design-mode
- aider chat modes: https://aider.chat/docs/usage/modes.html
- OpenHands agents: https://docs.openhands.dev/openhands/usage/agents

## Product Principles

### Chat First

The default composer behavior is conversation. A selected source folder only
allows build execution; it must not increase the probability that ordinary
messages become builds.

Examples that must stay chat:

- `hi`
- `你好`
- `这个项目是什么`
- `我想先聊一下这个页面怎么做`
- `我们先确定风格`
- `我想做一个登录页，你觉得怎么设计`
- `为什么预览是空白`

### Explicit Execution

Build begins only when the message is an execution request, not merely an idea.

Examples that can build:

- `创建一个登录页`
- `帮我做一个 3D 官网`
- `把按钮颜色改成绿色`
- `开始实现`
- `按刚才方案做`
- `就按这个方案执行`

Contextual phrases such as `按刚才方案做` require a confirmed working brief or
approved plan. Without that, the assistant should answer or ask for
confirmation.

### Workspace Is A Boundary, Not Intent

Project/source folder selection is a prerequisite for writing and previewing,
not a signal that the user intends to write. Chat and planning can happen
without a selected folder. Build, save, local run, and publish require an
explicit project/workspace boundary.

### Artifacts Do Not Belong In The Chat Flow

The chat flow should contain messages, summaries, status, and compact action
rows. Large preview, diff, source, logs, and version history belong in an
artifact workspace with independent size, scroll, tabs, and expansion.

### Permission Is Independent

Intent routing decides what the user is asking for. Permission decides whether
the app may perform the requested action. These must remain independent so that
chat, plan, build, save, file read, command run, network, publish, and external
access can each have appropriate approval boundaries.

## Target Information Architecture

The desktop should converge on this shell:

```text
global rail        project list and settings
context sidebar   projects, current workspace, recent sessions
main column       chat flow and fixed composer
right drawer      Preview, Changes, Source, Versions, Logs, Permissions
top bar           project title, workspace state, permission state, drawer toggles
```

The layout contract:

- app chrome, global rail, context sidebar, title bar, and composer remain
  fixed;
- only the chat body scrolls in the main column;
- the artifact drawer has its own scroll and resize behavior;
- fullscreen preview is independent from both chat and drawer scroll;
- narrow screens collapse the artifact drawer behind a tool button rather than
  pushing the composer away.

## Top-Right Workspace Controls

The top-right area should become a compact workspace control cluster. It should
not be a random collection of buttons; it is the user's always-visible way to
open locations, inspect artifacts, and show or hide the right workspace.

Target controls:

```text
[Open location v] [Workspace menu] [Minimize drawer] [Show/hide drawer]
```

Recommended behavior:

- **Open location** opens a menu for safe destinations such as project folder,
  preview, generated artifact, saved version, or browser preview when available.
- **Workspace menu** opens quick access to Preview, Changes, Source, Versions,
  Logs, Permissions, and later Terminal.
- **Minimize drawer** keeps the artifact workspace mounted but narrow.
- **Show/hide drawer** toggles the right artifact workspace and must have a
  tooltip plus keyboard shortcut.
- The button group should stay stable while the drawer opens, closes, or
  switches tabs.
- The active drawer tab should be visible in this cluster, either through icon
  state or a small label.
- This cluster must be keyboard reachable and should avoid text-heavy buttons
  except for `Open location`, where the label clarifies the current target.

The Codex pattern to learn from is that the right side can be opened and closed
on demand without breaking the chat flow. ClawFabric should use the same idea
for Preview and project artifacts: the main chat remains readable, while the
right workspace becomes an inspectable tool surface.

## Composer Model

The composer remains a single natural-language input. Users should not have to
manually choose Chat or Build for every message.

The executable routing contract is defined in
[Composer Intent Routing Architecture](COMPOSER_INTENT_ROUTING_ARCHITECTURE.md).
This frontend roadmap summarizes the user-facing behavior, while that document
owns the route pipeline, admission rules, permission checks, evidence shape, and
test matrix.

The composer contains:

- workspace chip: current project/source folder state;
- attachment/source controls;
- explicit plan command;
- permission indicator;
- send button;
- contextual status such as `Discussing`, `Ready to build`, `Building draft`,
  or `Review draft`.

The internal route should evolve from `answer | build` to:

```ts
type ComposerRoute =
  | "answer"
  | "clarify"
  | "update_brief"
  | "plan"
  | "build";
```

Routing rules:

- read-only questions and greetings -> `answer`;
- exploratory design/product discussion -> `clarify` or `update_brief`;
- explicit plan command -> `plan`;
- explicit execution request -> `build`;
- contextual execution phrase -> `build` only when a confirmed brief or
  approved plan exists;
- ambiguous changes -> `clarify` before build.

## Conversation-Grounded Execution

The product needs a first-class working brief. It should be separate from raw
chat text and should be safe to feed into build generation.

Suggested shape:

```ts
type WorkingBrief = {
  projectId: string | null;
  title: string | null;
  goal: string | null;
  audience: string | null;
  pages: string[];
  features: string[];
  visualDirection: string[];
  technicalConstraints: string[];
  confirmedDecisions: string[];
  openQuestions: string[];
  lastUpdatedByTurnId: string | null;
  confidence: "draft" | "confirmed";
};
```

The assistant can update the brief during discussion without building. When the
user explicitly executes, build receives:

- latest user instruction;
- confirmed working brief;
- current project/workspace summary;
- selected source context;
- current draft or saved version evidence when applicable.

Acceptance examples:

- Discuss color, layout, and pages for several turns, then `按刚才方案做` builds
  from the confirmed brief.
- Ask `你觉得这个登录页怎么设计` after a source folder is selected and no draft is
  created.
- Say `创建一个登录页` in a selected workspace and a draft is created.
- Say `开始执行` without a confirmed brief and the assistant asks what to build.

## Artifact Workspace

The artifact workspace is a right-side drawer/panel. It should become the home
for work products.

Tabs:

- **Preview**: full static/runtime preview, device size controls, reload,
  fullscreen, open in browser.
- **Changes**: changed files, summaries, diff viewer, file filters.
- **Source**: source files and selected file content.
- **Versions**: saved versions, restore, compare.
- **Logs**: task stages, provider-safe progress, errors.
- **Permissions**: current source folders, approvals, denied/allowed actions.
- **Terminal**: future bounded command execution surface, only after independent
  permission and runtime gates exist.

Chat flow result card:

```text
Draft ready
2 files changed

[Preview] [Changes] [Save version] [Discard]
```

Preview requirements:

- inline chat preview is optional and must stay compact;
- full preview opens in the artifact drawer;
- fullscreen preview is one click from the drawer;
- 3D/WebGL/long-page previews must not be constrained by chat card height;
- closing the drawer/fullscreen returns the user to the same chat context.

### Terminal And Command-Line Tools

ClawFabric does not currently support arbitrary command-line execution as a
user-facing tool. The architecture already treats command execution as a later
permissioned capability, not as a renderer feature that can be added casually.

Mature agent products use Terminal as an execution and verification surface,
not merely as a place where the user can type commands:

- Codex CLI ties command execution to approval modes such as suggest,
  auto-edit, and full-auto.
- Claude Code treats Bash and PowerShell as permissioned tools with allow,
  ask, deny, sandbox, and project-directory scoping.
- Cursor Agent exposes terminal commands through its run-mode policy, so
  commands either run, ask first, or run in a restricted sandbox.
- Cline requires explicit approval for terminal commands and file changes
  unless the user enables narrower auto-approval behavior.

The shared lesson is:

```text
Terminal = execution tool + permission system + visible log + verification evidence
```

Terminal support should be a later gated product capability with these rules:

- no shell runs from the renderer;
- commands run only through a main-owned executor;
- every command is bound to a Project, Conversation, Task, Run, workspace, and
  permission decision;
- terminal output is summarized into renderer-safe facts by default;
- raw output remains private or explicitly bounded;
- network, process, filesystem, and environment access are independently
  permissioned;
- the UI shows command request, approval state, running state, exit code, and
  summarized output in the artifact workspace;
- the chat flow shows only compact command status rows.

Terminal UI should appear as an artifact drawer tab only when the execution
authority exists. Before that, the top-right workspace menu may show Terminal as
disabled or omit it entirely.

Terminal should be phased in:

1. **Reserved UI**: the artifact drawer and workspace menu reserve a Terminal
   destination, but it is hidden or disabled.
2. **Command proposal records**: the chat or Logs tab can show suggested
   commands and approval UI from fixture or non-executing records.
3. **Controlled commands**: main may execute a small allowlist such as build,
   lint, typecheck, and test commands, all tied to workspace and approval.
4. **Runtime Terminal**: dev-server start/stop, dependency installation, port
   management, open-in-browser, and publish checks become available only after
   runtime preview, sandbox, timeout, kill, and output-boundary contracts exist.

The first real command set should be validation-oriented, not open-ended:

- build project;
- run lint;
- run typecheck;
- run tests;
- start/stop approved preview server.

Dependency installation, arbitrary shell, network access, and publish commands
should remain later, higher-permission capabilities.

## Visual Design System

The current UI needs a unified design system rather than isolated CSS tweaks.
The target is a modern desktop tool: quiet, precise, dark-mode-ready, and
confident.

### Tokens

Create and use tokens for:

- app background;
- sidebar background;
- surface;
- surface raised;
- surface overlay;
- border subtle;
- border strong;
- text primary;
- text secondary;
- text muted;
- focus ring;
- status colors;
- shadow levels;
- radius;
- control height;
- spacing scale.

Guidelines:

- reduce visible borders where spacing or surface contrast can carry structure;
- use shadows only for composer, popovers, drawers, and modals;
- keep cards at 8px radius or less;
- avoid a one-note beige/cream theme by introducing neutral dark, cool gray,
  muted green, and restrained accent colors;
- make dark theme possible by token design even if not delivered immediately.

### Components

Stabilize these reusable components:

- `Button`: primary, secondary, ghost, destructive;
- `IconButton`: toolbar and circular send variants;
- `Composer`;
- `WorkspaceChip`;
- `WorkspacePicker`;
- `Popover`;
- `Modal`;
- `StatusPill`;
- `ActionBar`;
- `ArtifactDrawer`;
- `PreviewFrame`;
- `DiffPanel`;
- `PermissionCard`;
- `ActivityTimeline`;
- `EmptyState`;
- `Toast` or inline notification.

### Interaction Polish

Every interactive component needs:

- hover, pressed, disabled, and focus-visible states;
- stable heights and widths;
- no text overflow;
- predictable keyboard navigation;
- icon-only buttons with accessible labels and tooltips;
- motion only where it clarifies transitions.

## Execution Plan

### Slice 0 - Stabilize Current Foundation

Owner: main task.

Scope:

- finish project/source-folder binding;
- finish minimal permission path;
- keep chat possible without workspace;
- keep build gated by workspace;
- finish current layout and regression tests.

Exit criteria:

- current branch is clean or changes are committed;
- touched files and remaining frontend collision areas are listed;
- packaged desktop still launches.

### Slice 1 - Chat-First Router

Scope:

- implement the fail-safe first slice from
  [Composer Intent Routing Architecture](COMPOSER_INTENT_ROUTING_ARCHITECTURE.md);
- harden `builderComposerIntent` as a temporary fail-safe surface;
- add `clarify` and `update_brief` route semantics where feasible;
- prevent selected workspace from biasing ordinary chat into build;
- add tests for chat after workspace selection;
- keep plan explicit.

Exit criteria:

- `hi` with a selected source folder calls answer, not submit;
- `我想先聊一下这个页面怎么做` does not create a draft;
- `创建一个登录页` builds only when workspace exists;
- `按刚才方案做` builds only with confirmed brief or approved plan;
- no draft/review/save UI appears for chat-only turns.

### Slice 2 - Working Brief MVP

Scope:

- persist or derive a safe working brief from selected chat turns;
- show a compact brief summary in the UI;
- let users update or clear it;
- feed it into build execution.

Exit criteria:

- multi-turn discussion produces an inspectable brief;
- brief survives refresh/reopen where Conversation facts support it;
- contextual execution builds from the brief;
- ambiguous contextual execution asks for confirmation.

Current checkpoint:

- the desktop composer now derives a compact visible brief from the sanitized
  Task Stream projection and shows it as `Current brief`, `Approved plan`, or
  `Current result`;
- the brief can be cleared in the current renderer session without deleting
  Conversation history or changing main-owned prompt facts;
- clearing the visible brief removes renderer-side contextual-build readiness,
  so short execution phrases return to chat/clarification unless fresh work
  context appears;
- provider, credential, source tree, Git, digest, and receipt details remain
  hidden from the visible brief.

### Slice 3 - Artifact Drawer

Scope:

- add right drawer shell;
- move full Preview, Changes, Source, Versions, and Logs out of the chat flow;
- keep compact draft result card in chat;
- add fullscreen preview path.

Exit criteria:

- draft ready does not insert a large preview into chat;
- Preview opens in the drawer;
- fullscreen preview is available;
- Changes and Source are reachable from the drawer;
- chat scroll and drawer scroll are independent.

### Slice 4 - Design System Polish

Scope:

- introduce design tokens;
- refactor existing CSS toward components;
- polish button, line, shadow, composer, picker, drawer, pill, and action bar
  treatments;
- keep behavior unchanged.

Exit criteria:

- visual component states are consistent;
- borders are reduced where hierarchy can be carried by spacing/surface;
- composer and drawer feel like primary product surfaces;
- screenshots pass desktop and narrow viewport checks;
- layout tests still protect fixed composer and independent scroll.

### Slice 5 - Preview Runtime And Visual Edit Preparation

Scope:

- add robust preview device controls;
- support runtime preview/open-in-browser where allowed;
- prepare element selection and visual annotation metadata.

Exit criteria:

- long pages, canvas, and 3D previews can be inspected;
- preview errors explain whether static, runtime, network, or generated-code
  limits caused the issue;
- selected preview element context can be represented without granting hidden
  source authority.

### Slice 5b - Terminal Tool Foundation

Scope:

- define the terminal artifact tab UI without enabling execution;
- define main-owned command request, approval, execution, and result records;
- define renderer-safe command summary projection;
- gate command execution behind source folder, permission, and runtime policy.

Exit criteria:

- no renderer path can run a command;
- command UI can display pending/approved/denied/running/completed states from
  fixture data;
- command records bind Project, Conversation, Task, Run, workspace, and
  permission evidence;
- raw command output does not enter chat or renderer projections by default.

### Slice 6 - Production Workflow

Scope:

- publish/deploy flow;
- version compare and rollback;
- export/package;
- collaboration-ready task and artifact records.

Exit criteria:

- saved versions are auditable;
- publish is explicit and permissioned;
- rollback restores verified project facts;
- artifact records are durable and replayable.

## Coordination Rules

- Main task should finish storage, permission, generation, and authority gates
  before broad UI refactors.
- Frontend modernization should avoid parallel edits to `BuilderApp.tsx`,
  `BuilderPage.tsx`, and `styles.css` while main is touching those files.
- Refactor behavior and visual polish separately unless a component split is
  required to make the visual polish safe.
- Every visual slice needs screenshot evidence across desktop and narrow
  widths.
- Every routing slice needs tests proving chat does not create drafts.

## First Recommended Frontend Slice

The first independent frontend slice should be:

**Chat-first router + selected-workspace regression tests.**

Reason:

- it directly fixes the current user pain;
- it does not require the artifact drawer first;
- it clarifies the product contract for later working brief and design work.

The second frontend slice should be:

**Artifact drawer shell with Preview extraction.**

Reason:

- it fixes the inability to inspect full previews;
- it creates the correct structure before visual polish;
- it prepares for runtime preview and visual edit.

The third frontend slice should be:

**Design system polish pass.**

Reason:

- once chat and artifacts have the right shape, buttons, lines, shadows,
  surfaces, and motion can be refined without being invalidated by structural
  changes.
