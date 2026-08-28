# Agent Companion Left Sidebar Architecture

Date: 2026-08-18

Status: product and frontend architecture proposal.

Related documents:

- [Agent Companion Memory Architecture](AGENT_COMPANION_MEMORY_ARCHITECTURE.md)
- [Persistent Agent Task Context Architecture](PERSISTENT_AGENT_TASK_CONTEXT_ARCHITECTURE.md)
- [Streaming Activity UI Optimization Plan](STREAMING_ACTIVITY_UI_OPTIMIZATION_PLAN.md)
- [Conversation Visual Streaming and Plan Markdown Spec](CONVERSATION_VISUAL_STREAMING_AND_PLAN_MARKDOWN_SPEC.md)
- [Product Vision and Roadmap](PRODUCT_VISION_AND_ROADMAP.md)

## Decision

Builder's long-term product should use an Agent-first left sidebar.

Codex uses a project-first hierarchy:

```text
Project folder
-> task/conversation
```

Builder should add one higher product layer:

```text
Agent friend
-> project
-> task capsule
-> conversation thread / run / review
```

The reason is product identity. Builder is not only a project workbench. It is a
workspace where the user collaborates with persistent Agent companions that can
remember, monitor, plan, and work across projects when allowed.

## Product Mental Model

The sidebar should answer four questions in order:

1. Which Agent am I talking to?
2. What is this Agent currently responsible for?
3. Which project or folder is in scope?
4. Which task, session, review, or historical result do I want to open?

This is different from a pure IDE sidebar. The user's primary relationship is
with the Agent. Project management sits inside that relationship.

## Top-Level Shell

The stable app shell should have:

```text
global rail
-> selected area
   -> Agent list / selected Agent sidebar
      -> main conversation and work surface
      -> right workspace / monitor
```

Global rail entries:

| Entry | Purpose |
| --- | --- |
| Agents | Default home for Agent friends |
| Projects | Optional direct project browser for users who think project-first |
| Activity | Cross-Agent running work and review requests |
| Settings | App-wide settings |

The global rail can expose Projects as a shortcut, but the default work loop
should still enter through an Agent when companion memory and long-running work
are enabled.

## Sidebar Information Architecture

When an Agent is selected, the left sidebar should become that Agent's home.

Recommended structure:

```text
Agent header
  name, avatar, presence, current autonomy level
  quick actions: New task, Add project, Settings

Needs attention
  review requests
  blocked tasks
  permission requests

Running work
  active foreground task
  background tasks
  standing watches that recently fired

Projects
  project folder A
    active task
    recent task
    saved session
  project folder B
    active task
    recent task

Memory and context
  memory review
  recent important decisions
  context issues

History
  completed tasks
  archived sessions
```

The first visible group should be dynamic. If something needs review, it should
appear above ordinary project history. If nothing needs attention, the Agent's
active projects can be the first useful group.

## Row Types

The sidebar should not render everything as the same project card. Different
entities need different row contracts.

| Row | Meaning | Primary click |
| --- | --- | --- |
| Agent row | Persistent collaborator | Opens Agent home |
| Project row | Folder/workspace/repository managed by Agent | Expands project tasks |
| Task row | Bounded objective or work capsule | Opens task timeline |
| Conversation row | Communication thread attached to a task | Opens thread view |
| Watch row | Standing intent / monitor | Opens watch status |
| Review row | User decision needed | Opens review surface |
| Memory row | Proposed memory or context issue | Opens memory inspector |

Task rows and conversation rows may point to the same main surface in early
versions, but the data model should keep them separate. A conversation is how
the user talks. A task is what the Agent is responsible for.

## Agent List Mode

When no Agent is selected, the left content area can show all Agent friends.

Each Agent row should show:

- avatar or initials;
- display name;
- role subtitle;
- presence: offline, available, watching, running, needs review;
- small counts for running tasks, review requests, or failed watches;
- last meaningful public update;
- pinned project or primary scope when relevant.

Example:

```text
Builder
online · 2 running · 1 review
Working on clawfabric-builder

Designer
available
No active tasks

Researcher
watching · 3 monitors
Last checked docs 12 min ago
```

Rows should be dense and stable. Avoid large cards, marketing summaries, or
explanatory text that pushes real work below the fold.

## Selected Agent Sidebar

Once the user opens an Agent, the sidebar should focus on that Agent's work.

Header:

- Agent name and avatar;
- current state;
- autonomy indicator;
- settings button;
- compact "new" action.

Primary sections:

- Needs attention;
- Running work;
- Projects;
- Recent;
- Memory review.

The Agent header should not expose raw provider names, internal thread ids, or
prompt/memory internals by default. Advanced details belong in settings or
context inspector.

## Project Grouping

Project groups should work like Codex's project folders, but under the Agent.

Project row contents:

- project display name;
- folder/repository identity;
- local/remote indicator;
- branch when it matters;
- active task count;
- review/failure badge;
- optional last saved version.

Expanded project contents:

```text
Project: clawfabric-builder
  Streaming Activity UI
  Loading and Session Recovery
  Agent Memory Architecture
  Side Workspace Tabs
```

Collapsed rows should preserve status badges so the user can see where work is
alive without expanding every project.

## New Task and Bootstrap Context

Creating a new task should be explicit about scope before the first message.

Flow:

```text
Select Agent
-> choose New task
-> choose or confirm project/folder
-> bootstrap composer shows Agent + project + local/branch/permission context
-> user sends first message
-> task is created
-> bootstrap context collapses into shell/header
-> follow-up composer becomes quiet
```

This preserves the useful Codex pattern: the input can show folder context
before the first message, because the user is still choosing a work container.
After the first submit, persistent project status should move to the task
header or shell. The composer should not keep showing default labels such as
`Ready to execute current direction`.

## One Ongoing Chat, Many Task Capsules

Builder can support the user's desired "one Agent friend" experience without
forcing every objective into a separate visible chat.

Recommended model:

```text
Agent companion conversation
-> routes requests into task capsules
-> each task capsule owns context, permissions, runs, reviews, and results
-> the main timeline can focus one task capsule at a time
-> historical capsules remain addressable through sidebar and timeline locator
```

This gives the user a continuous relationship while preserving engineering
boundaries. The Agent can remember and resume, but file writes, plans, reviews,
and permissions remain scoped to specific tasks.

## Historical Navigation

The sidebar should combine with a timeline locator.

Left sidebar:

- finds Agent, project, task, watch, memory review;
- shows durable status;
- supports broad navigation.

Timeline locator:

- jumps inside the open task/conversation;
- locates plans, runs, reviews, failures, saves, and handoffs;
- does not replace the sidebar.

Quick switcher:

- searches across Agents, projects, tasks, watches, and memory facts;
- groups results by type;
- shows scope and status before opening;
- never exposes hidden provider context or secrets.

## Parallel Task Interaction

Parallel work should not become multiple long chats interleaved in the main
timeline. That is hard to read and makes the composer target ambiguous.

Recommended layout:

```text
left sidebar = durable navigation
main timeline = focused task or Agent conversation
right rail = running work / parallel task monitor / review queue
timeline locator = jump within current focus
```

Parallel task row in right rail:

- task title;
- project;
- status;
- last public update;
- progress evidence count;
- changed file count;
- check state;
- permission or review request;
- actions: Focus, Pause, Stop, Review, Open result.

Sidebar relationship:

- running parallel tasks appear under their project with status badges;
- the right rail is the live monitor;
- the sidebar is the durable place to find them later.

Focus rules:

- one task is the main composer target at a time;
- focusing a background task updates the main header and composer target;
- background tasks may add compact timeline markers, not long interleaved prose;
- mutating tasks touching overlapping files require serialization, conflict
  handling, or explicit merge review.

## Memory Entry Points

Memory should be discoverable but not noisy.

Sidebar memory surfaces:

- Memory review badge when there are proposed memories;
- Context issue badge when recall/conflict/egress problems need attention;
- optional Memory section inside selected Agent.

Do not show raw memory blocks in the default composer. Memory belongs in:

- Agent settings;
- memory inspector;
- context preview;
- task completion review;
- explicit "why did you use this context?" drilldown.

## Frontend State Contract

The frontend should render sidebar state from durable projections, not local UI
guesses.

Suggested view model:

```ts
type AgentSidebarView = Readonly<{
  selected_agent_id: string | null;
  agents: readonly AgentSidebarAgentRow[];
  selected_agent_home: AgentHomeSidebar | null;
}>;

type AgentSidebarAgentRow = Readonly<{
  agent_id: string;
  display_name: string;
  role: string;
  avatar_ref: string | null;
  presence: "offline" | "available" | "watching" | "running" | "needs_review";
  autonomy_level: number;
  active_task_count: number;
  review_count: number;
  last_public_update: string | null;
}>;

type AgentHomeSidebar = Readonly<{
  agent_id: string;
  needs_attention: readonly SidebarTaskRef[];
  running_work: readonly SidebarTaskRef[];
  projects: readonly SidebarProjectGroup[];
  memory_review_count: number;
  context_issue_count: number;
}>;

type SidebarProjectGroup = Readonly<{
  project_id: string;
  display_name: string;
  source_label: string;
  status: "idle" | "active" | "blocked" | "review_needed";
  active_task_count: number;
  rows: readonly SidebarTaskRef[];
}>;
```

## Visual Design Rules

- Keep the sidebar dense, stable, and scannable.
- Use icons for row type and status.
- Avoid nested cards.
- Avoid large prose descriptions inside rows.
- Use truncation with tooltip for long project/task names.
- Keep row height stable across loading and loaded states.
- Prefer small badges, dots, and counts over full sentence status labels.
- Use section headers sparingly.
- Preserve scroll position when rows refresh.
- Do not flash between empty, loading, and loaded layouts when replaying old
  sessions.

## Empty and Loading States

Sidebar empty states should be action-oriented.

Agent list empty:

```text
Create your first Agent
```

Selected Agent with no projects:

```text
Add a project or start a task
```

Project with no tasks:

```text
Start a task in this project
```

Loading rules:

- use skeleton rows with stable height;
- never collapse the entire sidebar during refresh;
- preserve the last known durable projection until replacement is ready;
- show retry affordance if replay fails;
- avoid flicker in top bar or composer caused by repeated global loading
  toggles.

## Implementation Slices

### Slice 1: Read-Only Agent Sidebar Projection

- Add Agent-first view model.
- Render Agent list and selected Agent home from the persisted default Agent
  projection.
- Replace the existing Project-first list once projection tests pass; do not
  retain a product-facing feature flag or fallback.

Exit criteria:

- no data mutation;
- no change to task execution;
- sidebar can show Agent -> Project -> Task hierarchy;
- the obsolete Project-first shell is no longer reachable.

### Slice 2: New Task Bootstrap Context

- Show Agent + project/folder context before first submit.
- Collapse bootstrap context into task header after task creation.
- Keep follow-up composer quiet.

Exit criteria:

- composer target is unambiguous;
- no persistent default readiness pill.

### Slice 3: Status and Review Badges

- Add needs-review, running, blocked, and failed badges.
- Preserve stable row heights.
- Persist scroll position on refresh.

Exit criteria:

- old-session replay does not flicker the sidebar;
- active/background work is findable.

### Slice 4: Parallel Task Monitor Integration

- Sidebar shows durable task placement.
- Right rail shows live monitor.
- Focus action updates main timeline and composer target.

Exit criteria:

- main chat does not interleave multiple long streams;
- blocked background work is visible.

### Slice 5: Memory Review Entry

- Add Agent memory review count.
- Link to memory inspector.
- Show context issue badges when memory recall or provider egress needs review.

Exit criteria:

- memory is discoverable;
- raw memory is not exposed in default composer.

## Acceptance Criteria

- The sidebar's top product layer is Agent, not Project.
- Projects remain visible as children of an Agent.
- Tasks and conversations are addressable under projects.
- A user can create work without manually starting a new visible chat each time.
- New-task bootstrap context appears only before first submit.
- Follow-up composer stays quiet unless the next action truly depends on a
  visible state.
- Parallel tasks are findable from sidebar and monitorable from the right rail.
- The main conversation has one active composer target.
- Memory review and context issues are reachable without turning the composer
  into an internal-state panel.
- Loading and replay keep layout stable.
- The accepted product has one Agent-first sidebar; any short-lived
  Project-first development bridge is removed before this gate passes.

## Non-Goals

- No social feed.
- No opaque hidden Agent state.
- No interleaved multi-task transcript in the main chat.
- No project memory treated as Agent identity.
- No composer surface that permanently displays internal context labels.
- No sidebar rows that expose raw prompts, provider envelopes, secrets, or
  internal ids.

## Bottom Line

The left sidebar should make Builder feel like a place where the user works
with persistent Agent friends. Projects, sessions, tasks, and reviews remain
first-class, but they live under the selected Agent instead of replacing the
Agent relationship.
