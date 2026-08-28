# Agent Companion Settings and Context Architecture

Date: 2026-08-18

Status: product and frontend architecture proposal.

Related documents:

- [Agent Companion Memory Architecture](AGENT_COMPANION_MEMORY_ARCHITECTURE.md)
- [Agent Companion Left Sidebar Architecture](AGENT_COMPANION_LEFT_SIDEBAR_ARCHITECTURE.md)
- [Persistent Agent Task Context Architecture](PERSISTENT_AGENT_TASK_CONTEXT_ARCHITECTURE.md)
- [Working Context State Architecture](WORKING_CONTEXT_STATE_ARCHITECTURE.md)
- [Trusted Work and Collaboration Architecture](TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md)

## Decision

Agent settings should define a durable collaborator, not a reusable prompt.

An Agent friend should have:

- identity;
- role;
- style;
- memory policy;
- project scope;
- tool and model capability policy;
- autonomy level;
- notification behavior;
- context assembly rules;
- version history.

Changing these settings should create a new Agent definition version when the
change can affect future behavior. This makes later answers auditable: every
message, task, and run can say which Agent version acted.

## Product Model

The user should experience the Agent as a long-lived contact:

```text
Agent friend
-> has personality and operating style
-> remembers durable preferences and relationship context
-> can be assigned projects
-> creates and resumes task capsules
-> can run long-term watches when permitted
-> can propose memory updates
-> stays inspectable and revocable
```

The implementation should not treat Agent settings as a single system prompt.
Prompt text is only one projection of structured Agent facts.

## Settings Surface

Agent settings should be accessible from:

- Agent row context menu;
- selected Agent sidebar header;
- Agent home;
- memory review screen when a setting conflict appears;
- task header when the current Agent version matters.

Recommended tabs:

| Tab | Purpose |
| --- | --- |
| Overview | Name, avatar, role, status, current version |
| Personality | Tone, collaboration style, response preferences |
| Capabilities | Modes, tools, models, skills, allowed work types |
| Projects | Connected projects, folder scopes, default project |
| Memory | Agent memory policy, project memory bindings, review queue |
| Autonomy | Long-running permission, standing intents, budgets |
| Context | Context assembly, token budget, recall scope, provider egress |
| Notifications | How the Agent alerts the user |
| Privacy | retention, deletion, import/export, sensitive data policy |
| Versions | Agent definition history and rollback |

This settings area should be a real management surface, not a long form full of
natural-language prompt instructions.

## Adding an Agent Friend

Creation flow:

```text
Add Agent
-> choose starting template or blank Agent
-> set name, avatar, and role
-> choose primary collaboration style
-> connect optional projects/folders
-> choose memory defaults
-> choose autonomy level
-> choose tools/provider/model policy
-> review permissions
-> create Agent definition version 1
```

Template examples:

| Template | Default role |
| --- | --- |
| Builder | General product/code collaborator |
| Designer | UI/UX reviewer and implementation planner |
| Researcher | Research, comparison, source synthesis |
| Reviewer | Code review, risk analysis, acceptance checks |
| Operator | Monitors, reminders, scheduled work |
| Blank | User-defined |

Creation rules:

- templates provide defaults, not hidden authority;
- every permission is visible before creation;
- memory defaults start conservative;
- connected projects can be added later;
- model/provider choices do not define Agent identity;
- creation should not start background work by itself.

## Agent Identity

Agent identity should be stable enough that the user can build a relationship
with it.

Identity fields:

```ts
type AgentProfile = Readonly<{
  agent_id: string;
  current_version_id: string;
  display_name: string;
  avatar_ref: string | null;
  role: string;
  short_description: string;
  relationship_scope: "personal" | "project" | "space";
  status: "active" | "paused" | "archived";
  created_at_ms: number;
  updated_at_ms: number;
}>;
```

Agent definition version:

```ts
type AgentDefinitionVersion = Readonly<{
  agent_id: string;
  version_id: string;
  display_name: string;
  role: string;
  style_contract_id: string;
  capability_policy_id: string;
  memory_policy_id: string;
  autonomy_policy_id: string;
  context_policy_id: string;
  created_at_ms: number;
  created_by: "user" | "system" | "migration";
  change_summary: string;
}>;
```

Rules:

- a response binds to the Agent version used for that response;
- a task binds to the Agent version that created or last materially changed it;
- later Agent setting changes do not rewrite old task history;
- rollback creates a new current version pointing to older settings, not a
  silent mutation.

## Personality and Style

Personality settings should shape communication, not bypass task authority.

Examples:

- concise vs detailed;
- proactive vs wait-for-confirmation;
- code-review strictness;
- design taste;
- language preference;
- how often to summarize;
- whether to ask clarifying questions early or make bounded assumptions.

These settings should compile into a `style_contract`, not into arbitrary
unreviewed prompt text.

Rules:

- personality cannot grant tools, files, network, save, publish, or memory
  access;
- user corrections can update personality memory after review;
- sensitive personal attributes should not be inferred unless needed and
  explicitly accepted;
- settings should show example behavior, not just labels.

## Capabilities

Capabilities define what the Agent is allowed to attempt.

Capability groups:

| Group | Examples |
| --- | --- |
| Conversation | Ask, explain, brainstorm |
| Planning | make plans, compare options, write specs |
| Code | inspect files, edit files, run checks |
| Design | UI critique, visual QA, style systems |
| Research | web/source review, citations, summaries |
| Project ops | package, release, version, evidence |
| Monitoring | watch checks, file changes, schedules |
| Delegation | ask another Agent/task to help |

Capabilities are not permissions. A capability says the Agent knows how to do
something. Permission says it may do that thing now, in this scope.

## Long-Running Permission

Long-running permission is what makes an Agent friend feel "online".

Autonomy levels:

| Level | Name | Meaning |
| --- | --- | --- |
| 0 | Chat only | The Agent responds only to user messages |
| 1 | Remember | The Agent may propose/save approved memories |
| 2 | Organize | The Agent may maintain task capsules and summaries |
| 3 | Remind | The Agent may create reminders and standing watches |
| 4 | Read-only monitor | The Agent may run bounded read/search/check actions |
| 5 | Draft work | The Agent may prepare drafts for review |
| 6 | Materialize | The Agent may save/commit/publish only behind explicit gates |

Settings needed for long-running permission:

```ts
type AgentAutonomyPolicy = Readonly<{
  policy_id: string;
  agent_id: string;
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  allowed_project_ids: readonly string[];
  allowed_tool_groups: readonly string[];
  allowed_triggers: readonly ("manual" | "schedule" | "project_event" | "task_event" | "external_event")[];
  max_run_minutes: number | null;
  max_daily_runs: number | null;
  cost_budget: string | null;
  notification_policy: "silent_badge" | "notify" | "ask_before_work";
  requires_review_for: readonly ("write" | "command" | "network" | "save" | "publish" | "memory")[];
  expires_at_ms: number | null;
}>;
```

Rules:

- long-running permission is per Agent and narrowed by project/task/run;
- a standing intent cannot exceed the Agent's autonomy policy;
- material side effects still need review gates;
- background work is always visible in Activity or Agent home;
- permissions can be paused globally or per Agent;
- expiration is required for broad monitoring permissions;
- memory alone never authorizes action.

## Standing Intents

Standing intents are the user-approved jobs that keep an Agent online.

Examples:

- "Watch this repo's checks and tell me if release breaks."
- "Every Friday, summarize project progress."
- "When this task finishes, remind me to review the UI."
- "Monitor docs changes and propose updates."

UI requirements:

- list active, paused, failed, expired, and completed intents;
- show trigger, scope, permission level, last run, next run;
- allow pause, edit, duplicate, delete;
- show recent results and failures;
- warn when a standing intent is broad, expensive, or provider-disclosing.

Standing intents should be shown in Agent settings and in Agent home when they
are active or recently fired.

## Context Management

Context management should be visible enough to build trust without making the
user manage prompt internals.

Context settings:

```ts
type AgentContextPolicy = Readonly<{
  policy_id: string;
  agent_id: string;
  default_context_mode: "focused" | "balanced" | "broad";
  include_agent_core_memory: boolean;
  include_project_memory: boolean;
  include_recent_task_history: boolean;
  include_related_task_summaries: boolean;
  provider_egress_policy: "local_only" | "ask" | "allowed_for_public" | "allowed_by_policy";
  max_memory_items: number;
  max_recent_messages: number;
  conflict_behavior: "ask" | "prefer_current_task" | "prefer_user_correction";
}>;
```

Recommended UI:

- Context Preview shows what will be included before a consequential run;
- Memory Used shows accepted memories after a run;
- Omitted Context shows relevant items excluded by budget or sensitivity;
- Context Conflict shows stale memory or project contradictions;
- "Use less context" and "Use broader context" adjust policy for the next turn.

Rules:

- current user instruction outranks memory;
- current project files outrank project memory;
- task-local context outranks broad Agent memory;
- provider egress requires sensitivity and consent checks;
- hidden prompt internals should remain hidden, but user-visible source facts
  and memory ids should be inspectable.

## Memory Relationship

Agent memory, project memory, task memory, and conversation history are related
but not interchangeable.

```text
Agent memory
  durable relationship, user preferences, operating habits

Project memory
  project-specific conventions, commands, architecture decisions

Task memory
  current objective, decisions, plan, run evidence, review state

Conversation history
  raw evidence and communication record

Standing intents
  future-facing memory plus permission contract
```

Authority order:

1. Current user instruction.
2. Current permission and review facts.
3. Current source/project state.
4. Active task capsule.
5. Accepted project memory for the same project.
6. Accepted Agent memory.
7. Episodic summaries and older conversations.
8. Imported or unreviewed memory candidates.

Important rule:

```text
Agent memory personalizes and recalls.
Project memory localizes.
Task memory executes.
Conversation history evidences.
Permission authorizes.
```

## Project and Session Relationship Under an Agent

The Agent can have one persistent companion conversation while still maintaining
multiple project/task histories.

Recommended model:

```text
Agent
-> primary companion conversation
-> projects
   -> task capsules
      -> task conversation threads
      -> plans
      -> runs
      -> reviews
      -> saved versions
```

The user can simply type in the Agent conversation:

```text
Help me make a static blog plan.
```

The Agent should then route the request:

```text
infer intent = plan
infer or ask project scope
create or reuse task capsule
assemble context
produce Plan as markdown in chat
record task state and memory candidates
```

The user does not need to manually create a new visible session for every
objective. New sessions are still useful when:

- the user wants hard separation;
- permissions differ materially;
- project scope changes;
- another human/Agent needs a separate review thread;
- the task becomes long enough to need independent history;
- the task is delegated or run in parallel.

## Memory Settings

Memory settings should expose both policy and content.

Policy controls:

- remember my preferences;
- remember project decisions;
- propose memory before saving;
- auto-save low-risk memories;
- never remember from this project;
- local-only memory;
- provider-disclosure behavior;
- retention period;
- archive/delete behavior.

Content controls:

- accepted memories;
- proposed memories;
- archived memories;
- superseded memories;
- source evidence;
- conflicts;
- memory usage history.

Per-memory actions:

- accept;
- reject;
- edit;
- scope to Agent/project/task;
- pin;
- archive;
- delete;
- mark sensitive;
- show source.

## Privacy and Data Controls

Privacy controls must be designed as primary settings, not advanced footnotes.

Required controls:

- pause all memory writes;
- pause background work;
- local-only mode;
- export Agent memory;
- delete Agent memory;
- delete project memory;
- purge derived indexes;
- review provider disclosure;
- list recent background actions;
- show why the Agent recalled a memory.

Deletion rules:

- deleting memory creates an immediate recall tombstone;
- derived vector/graph indexes must be purged or rebuilt;
- raw transcript retention follows app storage policy;
- deleting an Agent offers archive/export/purge choices;
- deleting a project removes or quarantines project-scoped memory.

## Notification Settings

Notification policy should match autonomy.

Examples:

| Event | Default |
| --- | --- |
| Needs review | notify |
| Background task completed | badge or notify |
| Standing watch failed | notify |
| Memory proposal | badge |
| Permission required | notify |
| Low-priority summary | silent badge |

Users should be able to set quiet hours or "only notify when blocked/needs
review" for each Agent.

## Add/Edit UX Details

The settings UI should avoid showing a raw prompt editor as the primary
interface.

Better controls:

- segmented controls for autonomy level;
- toggles for memory categories;
- checkboxes for tool groups;
- project picker for scope;
- budget inputs for time/cost/run limits;
- tabs for settings groups;
- preview panel for resulting behavior;
- version diff for setting changes.

Advanced users can still inspect generated policy text, but structured controls
should be the source of truth.

## Context and Memory Inspector

The inspector should answer:

- What does this Agent know about me?
- What does it know about this project?
- What context did it use for this answer?
- Which memories are proposed but not accepted?
- Which old memories were superseded?
- Which background intent caused this action?

Recommended views:

```text
Memory
  Accepted
  Proposed
  Conflicts
  Archived

Context
  Current task
  Project facts
  Agent memories used
  Recent messages used
  Omitted due to budget
  Omitted due to privacy

Activity
  Background runs
  Standing intent triggers
  Permission requests
```

## Failure States

Settings should make failures legible.

Examples:

- memory recall unavailable;
- provider egress blocked;
- project folder missing;
- standing intent expired;
- watch failed;
- context conflict detected;
- old Agent version used by historical task;
- memory candidate rejected or quarantined.

Failure states should not block ordinary chat unless the requested action
depends on the failed capability.

## Data Contracts

Agent settings should be backed by typed facts.

```ts
type AgentSettingsSummary = Readonly<{
  agent_id: string;
  current_version_id: string;
  profile: AgentProfile;
  style_contract_id: string;
  capability_policy_id: string;
  memory_policy_id: string;
  autonomy_policy_id: string;
  context_policy_id: string;
  connected_project_ids: readonly string[];
  active_standing_intent_count: number;
  proposed_memory_count: number;
  needs_review_count: number;
}>;
```

```ts
type AgentMemoryPolicy = Readonly<{
  policy_id: string;
  agent_id: string;
  default_review_behavior: "ask_before_save" | "auto_accept_low_risk" | "never_auto_save";
  allowed_memory_kinds: readonly (
    | "preference"
    | "semantic"
    | "procedural"
    | "relationship"
    | "project"
    | "episodic"
  )[];
  local_only: boolean;
  allow_provider_disclosure: boolean;
  retention_class: "manual" | "project_lifecycle" | "time_limited";
  max_core_memories: number;
}>;
```

## Migration From Current Builder

Near-term migration should be additive.

Step 1:

- keep existing Projects UI as default if Agent UI is disabled;
- introduce a single built-in Builder Agent behind the scenes;
- bind current projects/tasks to that Agent.

Step 2:

- expose Agent header and Agent settings;
- show projects under the selected Agent;
- hide generic composer readiness labels.

Step 3:

- add memory review and context inspector;
- add Agent definition versioning;
- add context snapshot memory-use display.

Step 4:

- add standing intents;
- add Activity and right-rail running-work monitor;
- support multiple Agent friends.

Step 5:

- support Agent-to-Agent delegation only after single-Agent memory, permission,
  and task capsules are reliable.

## Acceptance Criteria

- Users can add an Agent friend without writing a system prompt.
- Agent settings create versioned structured facts.
- Users can connect projects to an Agent and see those projects under it.
- Long-running permission is explicit, scoped, visible, and revocable.
- Standing intents cannot exceed the Agent's autonomy policy.
- Agent memory, project memory, task memory, and conversation history are
  visibly distinct.
- The user can inspect, correct, archive, delete, and scope memories.
- Context Preview can show which memories and project facts will be used for
  consequential work.
- Provider egress decisions respect memory sensitivity.
- Personality settings cannot grant permissions or mutate project state.
- Old tasks remain bound to the Agent version that produced them.
- Ordinary chat continues even if memory recall is degraded.

## Non-Goals

- No hidden always-on autonomy.
- No raw system-prompt editor as the primary Agent configuration model.
- No memory-as-permission shortcut.
- No automatic cross-project recall without scope checks.
- No background work that lacks a visible standing intent or task.
- No global Agent with implicit access to every folder.
- No silent rewriting of old task context after Agent settings change.

## Bottom Line

Agent settings are the control room for a durable collaborator. They define who
the Agent is, what it may remember, which projects it may work on, how much
autonomy it has, and how context is assembled. The design should make the Agent
feel like a long-term friend while keeping every consequential action scoped,
reviewable, and reversible.
