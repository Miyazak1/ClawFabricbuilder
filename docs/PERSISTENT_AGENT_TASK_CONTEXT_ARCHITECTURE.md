# Persistent Agent Task Context Architecture

## Purpose

This document turns the long-term "AI coworker in the chat list" direction into
an executable architecture. A persistent Agent is not a single long transcript
and not a hidden prompt preset. It is a governed actor that can keep identity,
work across tasks, receive messages like a contact, and later delegate scoped
subtasks to other Agents.

The key product decision is:

```text
Agent is the long-lived actor.
Task is the primary context container.
Conversation is the communication surface.
Memory is a curated projection, not the raw transcript.
```

This matters because a friend-like Agent may live for months or years. If all
context is stored as one growing chat log, the Agent will eventually mix
unrelated work, carry stale decisions, leak unnecessary information into model
prompts, and become hard to inspect or correct.

Agent Tasks must bind to the product-level Builder Session and Task Address
layer once that layer exists. The address layer is what users, subagents,
handoffs, forks, archives, deletes, and cross-session references point at; raw
`conversation_id` values remain lower-level replay facts. The address model is
defined in
[Builder Session and Task Address Architecture](BUILDER_SESSION_TASK_ADDRESS_ARCHITECTURE.md).

## Product Target

The user should be able to keep named Agents in a familiar chat list, such as:

- Builder Agent;
- Frontend Design Agent;
- Product Agent;
- Reviewer Agent;
- Publisher Agent;
- Personal Assistant Agent.

Each Agent can have an ongoing relationship with the user, but real work is
organized under tasks:

```text
Frontend Design Agent
-> Task: Modernize Builder chat flow
-> Task: Study Codex right drawer behavior
-> Task: Define persistent Agent context model
-> Task: Review packaged desktop icon issue
```

The Agent can discuss freely, but any durable work, delegated work, tool use,
permission scope, artifact, or review should be attached to a Task.

## Non-Goals

This architecture does not authorize autonomous background work yet. It also
does not authorize cloud social features, arbitrary shell execution, publishing,
or unrestricted Agent-to-Agent delegation. Those remain gated by Permission,
Run, Review, Artifact, and Publication facts.

The first implementation should improve context quality and product shape
without pretending that a fully autonomous coworker already exists.

## Context Layers

Persistent Agent context is assembled from layers. These layers must be stored
and retrieved separately.

| Layer | Purpose | Example | Authority |
| --- | --- | --- | --- |
| Agent Profile | Stable identity, role, scope, style, default tools | "Frontend Design Agent, modern restrained UI, no production deploy" | Agent Definition/Version |
| Agent Memory | Curated long-term facts and preferences | "User dislikes build-only composer behavior" | Memory fact with source and review state |
| Project State | Current project, version, trusted files, artifact state | selected Project Revision, current workspace folder | Project/Revision/Artifact facts |
| Task Context | Goal, decisions, status, allowed scope, current brief | "Create chat-first Builder shell" | Task and Task Context facts |
| Task Messages | Human/Agent discussion inside one task | latest clarification and decisions | Conversation Thread/Message facts |
| Run Evidence | Attempts, tool calls, failures, checks, diffs | typecheck passed, preview blank warning | Run and Tool event facts |
| Permission Scope | What can be read, written, executed, delegated | read project, write current workspace, no network | Permission facts |
| Delegation | Child task assignment and result return | "Ask Reviewer Agent to inspect layout risks" | Delegation facts |

The model prompt should be built from a budgeted selection of these layers. It
should never blindly include every message from the Agent's entire lifetime.

## Data Model

The exact storage technology can stay SQLite-first, but the product facts should
be shaped around these entities.

### AgentDefinitionVersion

Stable Agent identity and behavior contract.

Required fields:

- `agent_id`
- `version_id`
- `display_name`
- `role`
- `default_scope`
- `style_contract`
- `capability_policy`
- `default_permission_policy`
- `status`
- `created_at`

Rules:

- Updating an Agent profile creates a new version.
- A message from an Agent must bind the Agent version used for that response.
- Model name and provider credential are not Agent identity.

### AgentMemory

Curated long-term facts available across tasks.

Required fields:

- `memory_id`
- `agent_id`
- `memory_kind`: `user_preference | project_principle | product_decision | relationship_fact | operating_rule`
- `text`
- `source_task_id`
- `source_message_id`
- `confidence`
- `review_state`: `proposed | accepted | corrected | archived`
- `supersedes_memory_id`
- `created_at`
- `updated_at`

Rules:

- Raw chat messages do not automatically become memory.
- Memory must have source evidence.
- Newer accepted memory can supersede older memory.
- The user must eventually be able to inspect, correct, or delete memory.

### AgentTask

Primary container for work context.

Required fields:

- `task_id`
- `agent_id`
- `project_id`
- `parent_task_id`
- `title`
- `goal`
- `status`: `draft | discussing | planned | active | blocked | review_needed | completed | archived`
- `current_brief`
- `decision_summary`
- `open_questions`
- `allowed_scope`
- `budget_policy`
- `created_by`
- `created_at`
- `updated_at`
- `closed_at`

Rules:

- Every tool-using or build-producing Agent action must bind a Task.
- A Task can exist before code changes. Discussion and planning are valid Task
  states.
- Once Builder Session/Task Address facts exist, an AgentTask should reference
  the product Task Address rather than treating `conversation_id` as the public
  work unit.
- Closing a Task should produce a completion summary and optional memory
  promotion proposals.

### AgentTaskThread

Communication surface attached to a Task.

Required fields:

- `thread_id`
- `task_id`
- `agent_id`
- `thread_kind`: `main | child | review | handoff`
- `privacy_scope`
- `created_at`

Messages remain append-only. Summaries are projections and must not delete or
rewrite source messages.

### TaskContextSnapshot

Reproducible context bundle used for a model turn.

Required fields:

- `snapshot_id`
- `task_id`
- `agent_version_id`
- `base_project_revision_id`
- `included_memory_ids`
- `included_message_ids`
- `included_artifact_ids`
- `included_run_event_ids`
- `included_permission_ids`
- `context_digest`
- `token_budget`
- `created_at`

Rules:

- Every important Agent response or Run should record the context snapshot used.
- The snapshot stores references and digest, not necessarily a full duplicate
  of every source fact.
- For current Builder builds, the durable run context snapshot may include the
  current user message id and the latest task capsule source message id, but not
  the raw brief text, transcript copy, prompt, provider material, or source tree.
- This enables debugging: "why did the Agent think that?"

### Delegation

Scoped Agent-to-Agent assignment.

Required fields:

- `delegation_id`
- `parent_task_id`
- `child_task_id`
- `from_agent_id`
- `to_agent_id`
- `objective`
- `scope`
- `permission_subset`
- `budget`
- `expected_result`
- `status`
- `created_at`
- `completed_at`

Rules:

- Delegation is authority intersection, not inheritance.
- Child Agents cannot receive broader permissions than the parent task has.
- Child results return as evidence or proposals. They do not silently mutate the
  parent task, project, or publication.

## Context Assembly Algorithm

Each Agent turn should assemble context with a deterministic pipeline:

```text
1. Resolve Agent Definition/Version.
2. Resolve current Task and Project scope.
3. Resolve allowed permissions for this turn.
4. Load the current Task brief, decisions, open questions, and status.
5. Select recent Task messages within a fixed budget.
6. Retrieve accepted Agent memories relevant to the Task and Project.
7. Add current Project/Artifact/Run facts that are explicitly relevant.
8. Add child delegation summaries when present.
9. Exclude unrelated tasks by default.
10. Emit a TaskContextSnapshot before model or tool execution.
```

Default budget order:

1. System and safety instructions.
2. Agent Profile.
3. Permission and workspace scope.
4. Current Task brief and decisions.
5. Recent task-local messages.
6. Relevant accepted memories.
7. Project facts and selected artifact/run evidence.
8. Older task summaries.

The Agent should answer from the assembled context and say when it lacks
enough task-local context to act.

## Memory Promotion

Task completion should run a memory promotion step. The output is a proposal,
not automatic global memory.

Promotion candidates:

- durable user preference;
- durable product direction;
- durable project principle;
- repeated correction;
- stable Agent operating rule;
- future task that should be created.

Do not promote:

- temporary implementation detail;
- one-off command output;
- stale plan;
- failed speculation;
- private file content that is not needed later;
- tool output without human or system evidence.

Minimum completion summary:

```text
Task completed:
- goal handled
- key decisions
- changed files or artifacts
- verification evidence
- unresolved risks
- memory proposals
- follow-up tasks
```

## User Experience Model

The user-facing structure should feel familiar, but the underlying model is
task-centered.

```text
Left chat list
-> Agents
   -> Frontend Design Agent
      -> Current task chip
      -> Recent tasks
      -> Memory/settings
```

Expected interactions:

- user opens an Agent like a chat contact;
- the Agent can ask whether to continue an existing task or start a new one;
- the composer can chat without creating work;
- when discussion becomes durable work, the Agent creates or updates a Task;
- the Agent can show "working on task" state and compact progress;
- task detail shows brief, decisions, runs, artifacts, permissions, and child
  tasks;
- completed tasks remain searchable and can be reopened or forked.

## Intent Rules

Persistent Agents make intent routing more important, not less important.

Rules:

- Greeting and ordinary discussion stay chat.
- "Let's think through this" updates the task discussion, not source files.
- "Save this as the plan" updates the Task brief or creates a plan Review.
- "Do it", "按刚才方案执行", or "start implementation" can execute only when a
  current Task has a clear brief and required permissions.
- An Agent may propose creating a Task when the conversation has a durable goal,
  but should not silently convert every message into a work Task.
- A selected project folder is a workspace boundary, not execution intent.

## Permission Rules

Persistent Agents need explicit policy because they may outlive a single turn.

Minimum permission dimensions:

- read project files;
- write project files;
- run local commands;
- access network;
- access secrets;
- create child tasks;
- message other Agents;
- publish/share externally.

Default policy for early stages:

- chat and planning: no file write, no command execution;
- build: write current project only after explicit execution intent;
- command run: separate permission surface;
- delegation: disabled until child task authority exists;
- publish/share: disabled until Publication and Review gates exist.

## Implementation Slices

### Slice A - Task Capsule For Current Builder

Add a durable task capsule for continuing Builder work:

- `task_id`, `project_id`, `title`, `goal`, `current_brief`, `status`;
- compact task summary shown near composer;
- build execution can reference the task capsule;
- ordinary chat can update the brief without building.

Exit criteria:

- `hi` and exploratory messages never build;
- contextual build phrases require a task brief or approved plan;
- task brief survives restart.

Current checkpoint: Builder has a pure main-side Task Capsule contract for
`builder-working-brief.v1`, `builder-task-capsule.v1`, and
`builder-task-capsule-update.v1`. It preserves the existing Conversation payload
shape while giving later stores, route decisions, and Agent context snapshots a
shared verifier. The update record is evidence only: it does not append a
Conversation event, write SQLite, dispatch a provider, mutate source or Git,
grant permission, create Review/Revision facts, or expose renderer authority.
Builder also has a main-only Task Capsule store that persists those update
records with idempotent replay, latest-by-Project reads, task-scoped history
reads, schema fingerprint validation, and restart recovery. The store is still
not a renderer API, build admission path, provider/tool dispatcher, source
writer, permission grant, Review, Revision, Artifact, or Git authority. The
current recording-service checkpoint composes replayed Conversation events with
that store: it verifies a target `task_brief_updated` sequence, derives the
matching update record, writes it idempotently, and proves restart recovery from
the store. This is still a main-only context durability slice, not autonomous
Agent work, community sharing, build admission, IPC/preload, provider/tool
dispatch, source/Git mutation, permission grant, Review, Revision, Artifact,
command execution, network access, or credential handling. Generation main now
has an optional main-owned integration that calls this recording service only
after a read-only answer actually appends a new `task_brief_updated` event, so
the Task Capsule store starts following real Builder answer turns without
turning ordinary chat into durable work context. The desktop IPC runtime now
creates and closes the local Task Capsule store as part of its main-owned
runtime composition, so this durability path exists in real packaged runtime
assembly rather than only in contract tests. Generation main can now consult
the latest ready store record as supplementary route evidence for contextual
submit phrases, while keeping prompt construction tied to replayed Conversation
events rather than treating the store as a separate prompt database.

### Slice B - Context Snapshot Records

Record what context was used for important Agent responses and build runs.

Exit criteria:

- every build Run can explain included task, project revision, messages, and
  permissions;
- current Builder run snapshots bind task capsule source messages by id without
  exposing brief text through renderer projections;
- tests prove unrelated task messages are excluded.

### Slice C - Agent Profile Store

Introduce local Agent definitions before full autonomous Agents.

Exit criteria:

- one default Builder Agent exists as a versioned actor;
- messages and tasks bind `agent_id` and `agent_version_id`;
- UI can show Agent identity without implying extra autonomy.

### Slice D - Memory Proposal Flow

Add task completion summaries and proposed memory facts.

Exit criteria:

- completed task can propose memory;
- accepted memory can be used in future context assembly;
- user can archive or supersede memory.

### Slice E - Agent Chat List

Expose Agents as stable chat-list items.

Exit criteria:

- user can open an Agent;
- user can see current and recent tasks under that Agent;
- starting a new task is explicit but lightweight.

### Slice F - Delegation MVP

Allow a parent Agent to create a read-only child task.

Exit criteria:

- child task receives a scoped objective and context subset;
- child result returns as a proposal or evidence;
- owner review over an admitted child result is recorded before any parent
  materialization;
- parent does not inherit unreviewed child output as truth.

### Slice G - Tool-Using Persistent Agents

Add bounded tool access to persistent Agents.

Exit criteria:

- permissions are durable and revocable;
- task runs are cancellable and resumable;
- command/network access remains explicitly gated.

## Relationship To Existing Roadmap

This architecture refines these roadmap stages:

- Stage 1 Builder workbench should introduce Task capsules and context
  snapshots.
- Stage 2 human-AI collaboration should introduce durable permissions, task
  review, and tool-using work sessions.
- Stage 3 persistent AI Agents should introduce Agent profiles, Agent chat
  list, memory proposal, and task-centered context.
- Stage 4 Spaces and human collaboration can reuse Task, Contribution, Review,
  and Conversation facts.
- Stage 5 community and social features should publish verified work and task
  outcomes, not raw Agent transcripts.

## Engineering Invariants

- Chat transcript is not Agent memory.
- Agent memory is not Project truth.
- Task status is not Run evidence.
- Run success is not Review acceptance.
- Review acceptance is not Publication.
- Delegation result is not parent truth until reviewed or explicitly admitted.
- Project folder selection is not build intent.
- Persistent Agent identity is not a model name.

These invariants should be protected with tests as the implementation matures.
