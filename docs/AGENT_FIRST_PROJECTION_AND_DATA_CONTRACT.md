# Agent-First Projection and Data Contract

Date: 2026-08-18

Status: target data contract for the Agent companion UI migration.

## Purpose

This document defines the product-facing read models needed to turn the current
Project-first Builder into an Agent-first product without weakening the existing
main-process authority model.

The target UI hierarchy is:

```text
Agent
-> Project
-> Task
-> Conversation / Run / Plan / Review / Memory
```

The important implementation rule is:

```text
Agent-first UI is a projection, not a new authority source.
```

Renderer state can choose what to display and which row is selected. It cannot
grant permissions, prove source state, approve plans, mutate files, or decide
which memory is authoritative.

## Current Contract Evidence

The current worktree already contains the facts needed for most of the first
projection layer.

### Agent Identity

Evidence:

- `electron/builder-agent-definition-contract.cjs`
- `electron/builder-agent-definition-store.cjs`

Relevant fields:

```ts
type ExistingAgentDefinition = Readonly<{
  agent_id: string;
  owner_id: string;
  display_name: string;
  purpose: string;
  created_at_ms: number;
}>;

type ExistingAgentVersion = Readonly<{
  agent_version_id: string;
  definition_digest: string;
  agent_id: string;
  owner_id: string;
  version_number: number;
  instructions: string;
  permission_boundary: "explicit_permission_required";
  created_at_ms: number;
}>;
```

Product meaning:

- `display_name` becomes the Agent friend name;
- `purpose` becomes the Agent's short role description;
- `instructions` are versioned personality/working instructions;
- `permission_boundary` confirms that Agent identity cannot grant permission.

### Project And Task Address

Evidence:

- `electron/builder-session-task-address.cjs`
- `electron/builder-session-task-address-store.cjs`
- `electron/builder-session-task-address-binding-service.cjs`

Relevant fields:

```ts
type ExistingSessionAddress = Readonly<{
  session_id: string;
  project_id: string;
  display_id: string;
  title: string;
  status: "active" | "archived" | "deleted_pending" | "deleted";
  root_conversation_id: string;
  current_task_id: string | null;
  parent_session_id: string | null;
  forked_from_session_id: string | null;
  forked_from_revision_receipt_digest: string | null;
  created_by: string;
  created_at_ms: number;
  updated_at_ms: number;
  archived_at_ms: number | null;
}>;

type ExistingTaskAddress = Readonly<{
  task_address_id: string;
  session_id: string;
  project_id: string;
  agent_id: string;
  parent_task_address_id: string | null;
  conversation_id: string;
  title: string;
  goal: string;
  status:
    | "draft"
    | "discussing"
    | "planned"
    | "active"
    | "blocked"
    | "review_needed"
    | "completed"
    | "archived";
  current_brief_id: string | null;
  current_plan_id: string | null;
  base_revision_receipt_digest: string | null;
  produced_revision_receipt_digest: string | null;
  created_by: string;
  created_at_ms: number;
  updated_at_ms: number;
  closed_at_ms: number | null;
}>;
```

Product meaning:

- a session is the user-visible task container inside a project;
- a task address is the current objective boundary;
- `agent_id` binds the task to the Agent friend;
- `conversation_id` binds the task to replayable conversation evidence;
- `current_plan_id` makes Plan a first-class task artifact;
- project id remains the source and permission boundary.

### Task Capsule

Evidence:

- `electron/builder-task-capsule-contract.cjs`
- `electron/builder-task-capsule-store.cjs`

Relevant fields:

```ts
type ExistingTaskCapsule = Readonly<{
  task_id: string;
  project_id: string;
  title: string;
  goal: string;
  status: "discussing" | "ready";
  current_brief: {
    latest_user_goal: string;
    assistant_proposal: string;
    approved_plan: null;
    use_when_instruction_is_contextual: boolean;
  };
  last_route_decision_id: string;
  updated_at_ms: number;
}>;
```

Product meaning:

- Task Capsule is the compact current-task memory inside a conversation;
- it supports continuation phrases such as "继续优化";
- it is not global Agent memory;
- it cannot approve a Plan or grant write permission.

### Agent Assignment

Evidence:

- `electron/builder-agent-assignment-contract.cjs`
- `electron/builder-agent-assignment-store.cjs`
- `electron/builder-agent-assignment-supervision-service.cjs`

Relevant fields:

```ts
type ExistingAgentAssignment = Readonly<{
  assignment_id: string;
  agent_id: string;
  agent_version_id: string;
  owner_id: string;
  assigned_by: string;
  project_id: string;
  conversation_id: string;
  task_id: string;
  run_id: string;
  goal: string;
  permission_boundary: "explicit_permission_required";
  supervision_policy: "owner_supervised";
  result_contract: "review_required_before_materialization";
  budget: {
    max_steps: number;
    max_tool_calls: number;
    max_runtime_ms: number;
    max_private_source_bytes: number;
  };
  created_at_ms: number;
}>;
```

Product meaning:

- assignment facts can drive "currently working" and "parallel task" rows;
- supervision/budget facts can drive user-facing status;
- review is required before materialization;
- assignment cannot bypass project write gates.

### Conversation And Stream

Evidence:

- `electron/builder-conversation-replay.cjs`
- `electron/builder-task-stream-projection.cjs`
- `src/features/builder/domain/builderConversationSnapshot.ts`

Relevant product facts:

- conversation replay reconstructs turns and runs from append-only events;
- task stream projection exposes renderer-safe items:
  - user messages;
  - assistant runtime messages;
  - tool activities;
  - brief updates;
  - run start/progress/completion;
  - candidate review;
  - plan review.

Product meaning:

- the chat timeline should render from task stream projection;
- the renderer should not invent tool facts;
- stream items are the foundation for Codex-like run display.

### Memory Hook

Evidence:

- `electron/builder-agent-task-context-snapshot.cjs`

Relevant field:

```ts
type ExistingAgentTaskContextSnapshotHook = Readonly<{
  included_memory_ids: readonly string[];
}>;
```

Product meaning:

- context snapshots are ready to reference accepted memory facts;
- the actual memory fact store and inspector are still missing;
- memory must be added as an authoritative main-side fact layer, not as hidden
  prompt text.

## Target Read Models

### AgentHomeProjection

Purpose:

- drive the top-level Agent friend list and selected Agent home.

```ts
type AgentHomeProjection = Readonly<{
  projection_version: "agent-home-projection.v1";
  owner_id: string;
  selected_agent_id: string | null;
  agents: readonly AgentFriendSummary[];
  authority: ProjectionAuthority;
}>;
```

```ts
type AgentFriendSummary = Readonly<{
  agent_id: string;
  agent_version_id: string | null;
  display_name: string;
  purpose: string;
  lifecycle_status: "active" | "archived" | "revoked";
  presence:
    | "idle"
    | "working"
    | "waiting_for_permission"
    | "blocked"
    | "paused";
  unread_count: number;
  active_task_count: number;
  paused_task_count: number;
  memory_review_count: number;
  autonomy_level:
    | "chat_only"
    | "ask_before_work"
    | "supervised_background"
    | "standing_intents";
  last_activity_at_ms: number | null;
}>;
```

Projection inputs:

- Agent definition/version/lifecycle records;
- active assignment statuses;
- future memory review counts;
- future standing-intent statuses.

Bootstrap rule:

- the default Builder Agent is persisted before this projection can be read;
- missing or invalid Agent facts produce a fixed setup failure and never
  synthesize a display-only Agent from renderer or Project catalog state.

### AgentProjectTreeProjection

Purpose:

- render selected Agent -> Projects -> Tasks in the left sidebar.

```ts
type AgentProjectTreeProjection = Readonly<{
  projection_version: "agent-project-tree-projection.v1";
  agent_id: string;
  projects: readonly AgentProjectNode[];
  orphaned_tasks: readonly AgentTaskNode[];
  authority: ProjectionAuthority;
}>;
```

```ts
type AgentProjectNode = Readonly<{
  project_id: string;
  title: string;
  summary: string;
  source_boundary_label: string | null;
  revision_number: number | null;
  status: "saved" | "workspace" | "unavailable" | "stale";
  task_count: number;
  active_task_count: number;
  latest_activity_at_ms: number | null;
  tasks: readonly AgentTaskNode[];
}>;

type AgentTaskNode = Readonly<{
  task_address_id: string;
  task_id: string;
  session_id: string;
  conversation_id: string;
  project_id: string;
  agent_id: string;
  title: string;
  goal: string;
  status:
    | "draft"
    | "discussing"
    | "planned"
    | "active"
    | "blocked"
    | "review_needed"
    | "completed"
    | "archived";
  current_plan_id: string | null;
  has_unreviewed_draft: boolean;
  needs_permission: boolean;
  latest_activity_at_ms: number | null;
}>;
```

Projection inputs:

- project catalog snapshot;
- workspace project catalog snapshot;
- session/task address records;
- task stream latest run status;
- review/checkpoint status projections.

Cutover rule:

- Projects may have zero Tasks, but every rendered Task requires a verified
  Session/Task Address;
- development data without required addresses is reset or migrated once and is
  never projected as a synthetic recovered Task.

### TaskConversationProjection

Purpose:

- render the main chat surface for one focused Task.

```ts
type TaskConversationProjection = Readonly<{
  projection_version: "task-conversation-projection.v1";
  agent_id: string | null;
  project_id: string;
  session_id: string | null;
  task_address_id: string | null;
  task_id: string | null;
  conversation_id: string | null;
  title: string;
  goal: string | null;
  status:
    | "loading"
    | "ready"
    | "refreshing"
    | "stale"
    | "absent"
    | "unavailable";
  items: readonly TaskConversationItem[];
  current_plan_id: string | null;
  current_brief_id: string | null;
  active_run_id: string | null;
  permission_prompt: PermissionPromptProjection | null;
  review_prompt: ReviewPromptProjection | null;
  last_stable_head_sequence: number | null;
  authority: ProjectionAuthority;
}>;
```

Rules:

- `items` come from task stream projection only;
- `loading` may reuse the last stable `items`;
- `stale` must display a visible diagnostic;
- `absent` must not spin forever;
- `unavailable` must not enable unsafe actions.

### AgentSettingsProjection

Purpose:

- render Agent identity, behavior, memory, and autonomy settings.

```ts
type AgentSettingsProjection = Readonly<{
  projection_version: "agent-settings-projection.v1";
  agent_id: string;
  display_name: string;
  purpose: string;
  current_version: {
    agent_version_id: string;
    version_number: number;
    instructions: string;
    created_at_ms: number;
  };
  lifecycle_status: "active" | "archived" | "revoked";
  permission_boundary: "explicit_permission_required";
  autonomy_policy: AutonomyPolicyProjection;
  memory_policy: MemoryPolicyProjection;
  project_bindings: readonly AgentProjectBindingProjection[];
  authority: ProjectionAuthority;
}>;
```

Rules:

- editing personality creates a new Agent version;
- Agent settings never grant file write permission by themselves;
- archived/revoked Agents keep old task evidence readable;
- memory and autonomy settings require explicit UI and audit records.

### ParallelTaskMonitorProjection

Purpose:

- render concurrent or background tasks without mixing multiple chats into one
  timeline.

```ts
type ParallelTaskMonitorProjection = Readonly<{
  projection_version: "parallel-task-monitor-projection.v1";
  agent_id: string;
  focused_task_address_id: string | null;
  tasks: readonly ParallelTaskSummary[];
  authority: ProjectionAuthority;
}>;

type ParallelTaskSummary = Readonly<{
  task_address_id: string;
  project_id: string;
  title: string;
  phase:
    | "queued"
    | "working"
    | "waiting_for_permission"
    | "blocked"
    | "review_needed"
    | "completed"
    | "failed"
    | "paused";
  last_public_activity: string;
  can_open: boolean;
  can_pause: boolean;
  can_cancel: boolean;
  has_unreviewed_result: boolean;
  updated_at_ms: number;
}>;
```

Rules:

- the monitor can show many tasks;
- the main conversation focuses one task at a time;
- background results cannot auto-save or auto-merge;
- overlapping mutating tasks require conflict detection before execution.

### MemoryReviewProjection

Purpose:

- provide the visible memory layer needed for long-lived Agent behavior.

```ts
type MemoryReviewProjection = Readonly<{
  projection_version: "memory-review-projection.v1";
  agent_id: string;
  pending: readonly MemoryCandidateSummary[];
  accepted: readonly MemoryFactSummary[];
  archived: readonly MemoryFactSummary[];
  deleted_tombstones_visible: boolean;
  authority: ProjectionAuthority;
}>;
```

This projection cannot be fully implemented until a memory fact contract and
store exist.

Rules:

- raw chat transcript is evidence, not memory;
- accepted memory facts are scoped;
- memory deletion must remove recall eligibility;
- recalled memories must be marked in context snapshots;
- memory cannot grant permissions.

## Projection Authority

Every projection should include authority metadata:

```ts
type ProjectionAuthority = Readonly<{
  projection_authority: string;
  source_authority: readonly string[];
  renderer_authority: "display_only";
  permission_grant: "not_performed";
  provider_dispatch: "not_performed";
  source_mutation: "not_performed";
  git_mutation: "not_performed";
}>;
```

Required authority strings:

| Projection | Required source authority |
| --- | --- |
| AgentHomeProjection | Agent definition/version/lifecycle records; assignment status records |
| AgentProjectTreeProjection | project catalog plus session/task address records |
| TaskConversationProjection | task stream projection from canonical conversation replay |
| AgentSettingsProjection | Agent definition/version/lifecycle records |
| ParallelTaskMonitorProjection | assignment/delegation/status/budget facts |
| MemoryReviewProjection | future accepted memory facts and memory review records |

## UI State That Is Not Authority

These can be renderer-only preferences:

- selected Agent;
- expanded project rows;
- selected sidebar task;
- side workspace tab order;
- selected side workspace tab;
- composer draft text;
- local scroll position;
- collapsed tool groups;
- right rail width;
- theme and density choices.

These must not be renderer-only:

- project source tree truth;
- file content truth;
- write permission;
- source read approval;
- Plan approval;
- draft save/reject;
- Agent version creation;
- memory acceptance/deletion;
- standing-intent enablement;
- autonomous background permission.

## Loading Contract

Agent-first projection must not reintroduce current loading/flicker problems.

Rules:

- keep the last stable `AgentProjectTreeProjection` while refreshing;
- keep the last stable focused `TaskConversationProjection.items` during
  same-task refresh;
- show `refreshing` as a subtle status, not an empty page;
- project switch may show a transition, but top-level Agent chrome should stay
  stable;
- missing old conversation should become `absent`, not indefinite loading;
- replay failure with prior data should become `stale`, not blank.

## Default Agent Bootstrap

The first Agent-first build creates a persisted default Agent before rendering
the product shell. There is no synthetic Agent phase.

Input:

- owner id;
- application bootstrap or an explicit development-data reset.

Output:

- Agent definition;
- Agent version;
- lifecycle active record;
- future project/task bindings.

Authority:

- main-side Agent definition contract;
- no file/source permission grant.

### Phase C: Multi-Agent Support

Only after one persisted default Agent works:

- allow creating additional Agents;
- assign Projects/Tasks to an Agent;
- support role-specific memory and standing intents;
- expose per-Agent autonomy policy.

## IPC Boundary

Recommended read ports:

```ts
type BuilderAgentProjectionPort = Readonly<{
  readAgentHome(): Promise<AgentHomeProjection>;
  readAgentProjectTree(request: { agent_id: string }): Promise<AgentProjectTreeProjection>;
  readTaskConversation(request: {
    project_id: string;
    task_address_id?: string;
    conversation_id?: string;
  }): Promise<TaskConversationProjection>;
  readParallelTaskMonitor(request: { agent_id: string }): Promise<ParallelTaskMonitorProjection>;
}>;
```

Recommended write ports:

```ts
type BuilderAgentCommandPort = Readonly<{
  createAgent(request: CreateAgentRequest): Promise<AgentSettingsProjection>;
  updateAgentInstructions(request: UpdateAgentInstructionsRequest): Promise<AgentSettingsProjection>;
  archiveAgent(request: { agent_id: string; reason: string }): Promise<AgentSettingsProjection>;
  bindProjectToAgent(request: { agent_id: string; project_id: string }): Promise<AgentProjectTreeProjection>;
}>;
```

Rules:

- read ports return projections only;
- write ports call main-side contracts/stores;
- renderer must not compose authoritative writes from projection fields;
- IPC responses must omit provider secrets and private source bodies.

## Test Requirements

Minimum projection tests:

- persisted default Agent includes all current saved projects;
- persisted default Agent includes in-progress workspace projects;
- missing Agent facts fail with a fixed setup state rather than a Project-first
  fallback;
- Task Address with `agent_id/project_id/conversation_id` maps to one task row;
- data without required Task Address fails cutover validation and is reset or
  migrated before projection;
- selected project id and selected task id do not grant permissions;
- tab order preference does not affect source truth.

Minimum loading tests:

- Agent tree remains visible during project refresh;
- focused Task keeps last stable items during same-task refresh;
- absent conversation stops loading;
- stale replay shows diagnostic and retry.

Minimum authority tests:

- Agent projection cannot grant write permission;
- memory projection cannot approve actions;
- Plan approval remains separate from write approval;
- background task completion cannot save or merge output automatically.

## Relationship To Existing Documents

This contract sits between:

- [Agent Companion Current Implementation Gap Audit](AGENT_COMPANION_CURRENT_IMPLEMENTATION_GAP_AUDIT.md)
- [Agent Companion Implementation Evidence Map](AGENT_COMPANION_IMPLEMENTATION_EVIDENCE_MAP.md)
- [Agent Companion Near-Term Execution Slices](AGENT_COMPANION_NEAR_TERM_EXECUTION_SLICES.md)
- [Agent Companion Left Sidebar Architecture](AGENT_COMPANION_LEFT_SIDEBAR_ARCHITECTURE.md)
- [Agent Companion Settings and Context Architecture](AGENT_COMPANION_SETTINGS_AND_CONTEXT_ARCHITECTURE.md)
- [Agent Companion Memory Architecture](AGENT_COMPANION_MEMORY_ARCHITECTURE.md)

## Bottom Line

The Agent-first product should be built as a set of stable projections over the
facts Builder already has:

```text
Agent records
+ Project catalog
+ Session/Task addresses
+ Conversation replay
+ Task stream projection
+ Assignment/supervision/budget facts
+ future Memory facts
= Agent companion UI
```

This lets Builder feel like a persistent Agent friend while keeping Codex-like
Task boundaries, review gates, and source permissions intact.
