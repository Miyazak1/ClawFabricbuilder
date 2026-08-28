# Agent Project Task UI Migration Plan

Date: 2026-08-18

Status: migration plan grounded in current Builder frontend and main-side
facts.

Related documents:

- [Agent Companion Left Sidebar Architecture](AGENT_COMPANION_LEFT_SIDEBAR_ARCHITECTURE.md)
- [Agent Companion Settings and Context Architecture](AGENT_COMPANION_SETTINGS_AND_CONTEXT_ARCHITECTURE.md)
- [Task Conversation Management Architecture](TASK_CONVERSATION_MANAGEMENT_ARCHITECTURE.md)
- [Builder Session And Task Address Architecture](BUILDER_SESSION_TASK_ADDRESS_ARCHITECTURE.md)
- [Persistent Agent Task Context Architecture](PERSISTENT_AGENT_TASK_CONTEXT_ARCHITECTURE.md)

## Purpose

Builder needs to migrate from a project-first desktop app to an Agent-first
companion workbench without breaking the already implemented project,
conversation, preview, review, and runtime flows.

Current UI:

```text
Projects
-> saved projects
-> in-progress workspace projects
-> selected project page
-> conversation/activity timeline
-> right side workspace
```

Target UI:

```text
Agents
-> selected Agent friend
   -> projects
      -> tasks
         -> task conversation
         -> runs/reviews/results
   -> memory
   -> standing intents
```

This is a development-stage product cutover, not a compatibility migration for
an installed user base. Implementation may use short-lived bridges while a
slice is under construction, but the accepted product has one Agent-first
shell and no Project-first fallback.

## Current Implementation Snapshot

### Existing Frontend

The visible frontend is still project-first:

- `BuilderProjectCatalog` lists saved projects and in-progress workspaces;
- `BuilderPage` renders a selected project page;
- the top header uses project title/version/workspace controls;
- the right side workspace renders preview/source/changes/versions/permissions;
- the composer supports explicit mode selection and approval policy;
- the main timeline is a projected activity stream.

### Existing Main-Side Facts

The main side already has important Agent/Task foundations:

- Agent definition/version contracts and store;
- Agent assignment, supervision, budget, step, delegation, result, review facts;
- Conversation event chain and replay;
- Task stream projection;
- Task Capsule contract, store, and recording service;
- Session/Task Address contract, store, recording, and binding service;
- Run context snapshots and Agent task context snapshots.

### Missing Product/UI Capabilities

Missing or incomplete:

- visible Agent list;
- selected Agent home;
- Agent settings UI;
- Agent memory review UI;
- Agent-level autonomy and standing intent UI;
- project grouping under Agent;
- task rows under projects;
- task lifecycle actions: reopen, fork, archive, delete;
- parallel task monitor;
- user-visible Task Address lookup;
- memory fact store and memory inspector;
- complete Plan routing and Plan-as-artifact display.

## Migration Principles

- Replace the Project-first product shell once the Agent-first projection gate
  is green; do not ship or preserve two navigation models.
- Persist one default Builder Agent before allowing multiple Agents.
- Keep Project as file and permission boundary.
- Keep Task as objective boundary.
- Keep Conversation as evidence timeline.
- Keep renderer as projection consumer, not authority.
- Build read-only navigation projections before adding Agent settings, memory,
  or autonomy commands.
- Do not expose internal ids, provider envelopes, raw prompts, or source trees
  in sidebar rows.
- Make loading state stable before adding deeper hierarchy.

## Target Shell

Recommended end state:

```text
global rail
  Agents
  Activity
  Settings

selected Agent sidebar
  Agent header
  Needs attention
  Running work
  Projects
    project
      active task
      recent task
  Memory review
  History

main surface
  selected Task conversation
  or Agent home

right rail
  side workspace
  parallel task monitor
  context/memory inspector
```

Project search and creation live inside the selected Agent. Project is still a
source and permission boundary, but it is not a peer top-level product shell.

## Phase 0: Stabilize Current Project UI

Goal: avoid adding hierarchy on top of flicker and replay bugs.

Scope:

- old conversation replay must reliably load;
- loading should not blank top bar, composer, or sidebar;
- source file panels must scroll independently;
- composer readiness labels should stay quiet unless actionable;
- task stream typography should be consistent.

Exit criteria:

- opening an old project does not leave `Loading activity...` indefinitely;
- refresh keeps last known durable projection until replacement is ready;
- top bar buttons do not flicker during conversation refresh;
- project catalog keeps row height and scroll position stable.

## Phase 1: Introduce Default Agent Projection

Goal: establish the persisted default Agent as the product owner before the UI
cutover.

Implementation:

- create a default `Builder` Agent definition, version, and active lifecycle
  record during product bootstrap;
- bind current projects/tasks to this Agent in read-only projections;
- expose Agent identity in the primary header and navigation;
- require new Session/Task Address facts to bind the default Agent.

Frontend:

```text
Builder
current Agent
```

Main-side:

- use existing Agent definition/version store;
- do not add autonomy or memory writes yet;
- do not change build/plan execution.

Exit criteria:

- every new Task/Session resolves a persisted Agent id/version;
- missing Agent bootstrap reaches a fixed setup failure rather than a second
  navigation model;
- tests prove Agent identity cannot grant source or write permission.

## Phase 2: Agent-First Sidebar Read Model

Goal: render Agent -> Project -> Task as a read-only sidebar projection.

Implementation:

- add `AgentSidebarView` projection;
- include one default Builder Agent;
- nest existing project catalog rows under the selected Agent;
- show current and recent Task Address rows when available;
- require Task Address rows for task conversations; development fixtures that
  predate the contract are reset or migrated once.

Frontend structure:

```text
Builder
  Needs attention
  Running work
  Projects
    Focus timer
      current task
    clawfabric-builder
      Streaming Activity UI
      Agent Memory Architecture
```

Rules:

- project row click can preserve existing project open behavior;
- task row click opens task conversation when Task Address lookup exists;
- no settings/autonomy controls yet;
- sidebar rows use durable facts, not local component guesses.

Exit criteria:

- Agent-first view can display all existing projects;
- selected project behavior remains unchanged;
- every visible Task row is backed by a Task Address;
- no Project-first catalog remains mounted as a fallback.

## Phase 3: New Task Bootstrap

Goal: let the user start a task under Agent + Project without thinking about
raw sessions.

Flow:

```text
selected Agent
-> New task
-> choose/confirm Project
-> bootstrap composer shows Agent + Project + folder/branch/policy
-> first submit creates or binds Task Address
-> bootstrap context collapses into task header
```

Implementation:

- reuse existing workspace picker and project binding;
- bind first durable work turn to Session/Task Address;
- if user sends ordinary chat, keep it as Agent/project discussion until a
  durable objective appears;
- show a small task title/status in the header after creation.

Exit criteria:

- first-submit context is clear;
- follow-up composer is quiet;
- a created Task is visible under Agent -> Project.

## Phase 4: Task Conversation Navigation

Goal: make Task the visible unit of work.

Implementation:

- expose Task Address rows;
- add current Task header;
- add task status badges;
- add reopen/resume behavior;
- show completion summary when available;
- add timeline locator for plans/runs/reviews/failures/saves.

Rules:

- one main composer target at a time;
- switching Task changes header and timeline;
- switching Project changes sidebar grouping but should not destroy open Task
  history;
- task lifecycle actions target Task Address, not raw `conversation_id`.

Exit criteria:

- user can find and reopen an old Task;
- completed Task does not require scanning the full transcript;
- current composer target is always visible.

## Phase 5: Plan And Routing Closure

Goal: make Plan a reliable first-class path.

Implementation:

- route `计划`, `方案`, `实施计划`, `实现方案`, `优化方案`, and `步骤` through
  Plan unless the sentence clearly asks to create a product such as a plan
  manager app/page;
- invoke semantic classifier for more Plan/Build ambiguous Chinese and English
  requests;
- render Plan markdown inline;
- bind Plan review to Task Address;
- approved Plan can become Build only through explicit continuation and write
  permission gates.

Exit criteria:

- "帮我做一个静态博客实施计划" produces a Plan artifact, not mere echo or
  explanation;
- "做一个计划管理页面" can still produce Build;
- renderer and main route evidence agree.

## Phase 6: Agent Settings UI

Goal: expose Agent as configurable friend.

Implementation:

- settings tabs: Overview, Personality, Capabilities, Projects, Memory,
  Autonomy, Context, Notifications, Privacy, Versions;
- structured settings write versioned Agent definition/policy facts;
- project binding can be managed from Agent settings;
- settings changes do not rewrite old task history.

Exit criteria:

- user can add/edit/pause/archive Agent;
- settings create versioned facts;
- personality does not grant permission;
- default Builder Agent remains available.

## Phase 7: Memory Review And Context Inspector

Goal: make memory useful and inspectable.

Implementation:

- add Agent memory fact store;
- add memory proposal flow at task completion;
- add Memory Review entry in sidebar;
- add Context Preview/Memory Used after consequential runs;
- add delete/archive/supersede controls.

Exit criteria:

- accepted memory can be included in context snapshots by id;
- rejected memory is not used;
- user can see why a memory was used;
- project memory and Agent memory remain separate.

## Phase 8: Standing Intents And Activity

Goal: enable long-running online Agent behavior.

Implementation:

- add standing intent contracts and store;
- add Agent autonomy policy UI;
- add Activity view for background work;
- add right-rail monitor for running/blocked/review-needed tasks;
- add notification policy.

Exit criteria:

- background work is always tied to a visible standing intent or task;
- permissions are scoped, expiring, and revocable;
- parallel tasks do not interleave long streams in the main timeline.

## Read Models

### AgentSidebarView

```ts
type AgentSidebarView = Readonly<{
  selected_agent_id: string | null;
  agents: readonly AgentSidebarAgentRow[];
  selected_agent_home: AgentHomeSidebar | null;
}>;
```

### TaskConversationView

```ts
type TaskConversationView = Readonly<{
  agent_id: string;
  agent_version_id: string;
  project_id: string;
  session_id: string | null;
  task_address_id: string | null;
  conversation_id: string;
  title: string;
  status: string;
  composer_target: "agent_chat" | "task";
  items: readonly unknown[];
}>;
```

### AgentSettingsView

```ts
type AgentSettingsView = Readonly<{
  agent_id: string;
  current_version_id: string;
  profile_ready: boolean;
  capability_policy_ready: boolean;
  memory_policy_ready: boolean;
  autonomy_policy_ready: boolean;
  context_policy_ready: boolean;
  standing_intent_count: number;
  proposed_memory_count: number;
}>;
```

These read models should be projections. They should not create authority.

## Development Cutover Rules

- Current development projects may be reset or migrated once into the default
  Agent and Task Address model.
- Existing Conversation replay remains the activity authority; the cutover
  changes ownership and navigation, not event truth.
- Plan/Build flows are rebound to Agent/Project/Task identity before the old
  shell is removed.
- Temporary adapters may exist only inside an unfinished slice and must be
  deleted before the Agent-first acceptance gate passes.
- There is no product setting, feature flag, or runtime fallback that restores
  the Project-first shell after cutover.

## Risks

| Risk | Mitigation |
| --- | --- |
| Agent-first UI hides a project | Keep project search and an explicit unbound-project diagnostic inside the selected Agent |
| Too much hierarchy slows simple work | Default selected Builder Agent and quick New task |
| Development fixtures lack Task Address | Reset or run one bounded development migration before startup |
| Settings imply autonomy before runtime exists | Hide or disable unavailable controls with clear state |
| Parallel tasks clutter UI | Main timeline shows one focused task; right rail monitors background work |
| Memory feels magical or unsafe | Use memory review and context inspector |

## Acceptance Criteria

- A persisted default Builder Agent owns every visible Project and Task.
- Agent-first sidebar is the only accepted navigation shell.
- Every visible Task conversation has Agent, Project, Session, Task Address,
  and Conversation identity.
- New Task bootstrap clearly shows Agent and Project before first submit.
- Follow-up composer does not keep bootstrap context as permanent chrome.
- Task Address becomes the visible lifecycle unit where available.
- Plan routing and Plan review become task-bound.
- Agent settings are versioned structured facts, not raw prompt editing.
- Memory and standing intents are not exposed before they have safe authority.
- Loading/replay preserves stable layout and last known projections.

## Non-Goals

- No long-lived dual-shell architecture.
- No Project-first compatibility mode after Agent-first acceptance.
- No pretending multiple Agents exist before the default Agent path is stable.
- No background autonomy without visible standing intents.
- No migration that treats renderer state as authority.
- No exposing internal ids, raw prompts, provider payloads, or private source in
  sidebar rows.

## Bottom Line

The implementation may be sliced internally, but the product transition is a
clear cutover:

```text
current: Projects own the visible workflow.
next: A persisted default Builder Agent owns Projects and Tasks.
target: Agent friends own projects, tasks, memory, and online work.
```

The cutover reuses the current Conversation, Project, Git, permission, and
runtime authorities without preserving the obsolete Project-first product
hierarchy.
