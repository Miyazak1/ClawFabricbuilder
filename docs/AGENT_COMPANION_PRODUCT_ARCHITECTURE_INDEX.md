# Agent Companion Product Architecture Index

Date: 2026-08-18

Status: index for the Agent-first product architecture documents.

## Purpose

This index connects the current Agent companion architecture documents into one
implementation story.

The product direction is:

```text
Agent friend
-> Agent Workbench and Message Fabric
-> Projects
-> Task conversations
-> Runs, plans, reviews, memory, standing intents
```

The current Builder implementation already has strong main-side facts for
conversation replay, task capsules, session/task addresses, route decisions,
Agent definitions, assignments, supervision, and context snapshots. The main
gap is the product-facing Agent-first UI and the memory/autonomy surfaces.

## Documents

| Document | Role |
| --- | --- |
| [Agent Workbench Message Fabric Architecture](AGENT_WORKBENCH_MESSAGE_FABRIC_ARCHITECTURE.md) | Authoritative Agent Home workbench, typed message fabric, plugin communication, inbox, action broker, external collaboration, and Task routing contract |
| [Agent Workbench Message Fabric v1 Implementation Gate](AGENT_WORKBENCH_MESSAGE_FABRIC_V1_IMPLEMENTATION_GATE_2026_08_21.md) | Implemented canonical message, SQLite, IPC, renderer, restart, package, and residual-risk evidence |
| [Agent Companion Memory Architecture](AGENT_COMPANION_MEMORY_ARCHITECTURE.md) | Long-term memory model, compression, recall, write path, security, deletion |
| [Agent Companion Current Implementation Gap Audit](AGENT_COMPANION_CURRENT_IMPLEMENTATION_GAP_AUDIT.md) | Evidence-based audit of what exists now, what is missing, and implementation priority |
| [Agent Companion Implementation Evidence Map](AGENT_COMPANION_IMPLEMENTATION_EVIDENCE_MAP.md) | Current implemented surfaces mapped to the target Agent companion architecture |
| [Agent Companion Near-Term Execution Slices](AGENT_COMPANION_NEAR_TERM_EXECUTION_SLICES.md) | P0/P1 implementation slices, file boundaries, test evidence, and coordination rules |
| [Agent Companion MVP Backlog and Decisions](AGENT_COMPANION_MVP_BACKLOG_AND_DECISIONS.md) | Decision log, MVP scope, backlog items, dependency order, and open questions |
| [Agent Companion Solution Completeness Audit](AGENT_COMPANION_SOLUTION_COMPLETENESS_AUDIT.md) | Coverage audit, implementation readiness, remaining contracts, and closure checklist |
| [Agent-First Projection and Data Contract](AGENT_FIRST_PROJECTION_AND_DATA_CONTRACT.md) | Agent, Project, Task, conversation, settings, parallel task, and memory projection contracts |
| [Agent Companion Left Sidebar Architecture](AGENT_COMPANION_LEFT_SIDEBAR_ARCHITECTURE.md) | Agent-first sidebar, Agent -> Project -> Task hierarchy, parallel task entry points |
| [Agent Companion Settings and Context Architecture](AGENT_COMPANION_SETTINGS_AND_CONTEXT_ARCHITECTURE.md) | Agent creation, personality, capabilities, memory settings, autonomy, context management |
| [Task Conversation Management Architecture](TASK_CONVERSATION_MANAGEMENT_ARCHITECTURE.md) | Single Task chat lifecycle, continuation/new-task rules, Task Capsule, Plan/Build/Ask relationship |
| [Agent Home Control Plane and Task Delegation Architecture](AGENT_HOME_CONTROL_PLANE_AND_TASK_DELEGATION_ARCHITECTURE.md) | Projectless Agent chat, controlled task incubation, Project binding, parallel work, and autonomy boundary |
| [Builder Agent Orchestration and Dual-Level Planning Architecture](BUILDER_AGENT_PLAN_TO_PROJECT_TASK_HANDOFF_PLAN_2026_08_28.md) | Agent-level plans, Task decomposition, Project assignment, independent Task plans, dependency scheduling, and result reconciliation |
| [Agent Project Task UI Migration Plan](AGENT_PROJECT_TASK_UI_MIGRATION_PLAN.md) | Practical migration from current project-first UI to Agent-first UI |
| [Task Intent Routing And Plan Mode Spec](TASK_INTENT_ROUTING_AND_PLAN_MODE_SPEC.md) | Ask/Plan/Build routing, 计划/方案 semantics, explicit modes, semantic classifier trigger policy |
| [Agent Companion Acceptance Test Matrix](AGENT_COMPANION_ACCEPTANCE_TEST_MATRIX.md) | Product and engineering acceptance scenarios for loading, Plan routing, Agent projection, memory, and autonomy |

## Recommended Reading Order

1. Start with [Agent Workbench Message Fabric Architecture](AGENT_WORKBENCH_MESSAGE_FABRIC_ARCHITECTURE.md).  
   It defines the selected Agent as a plugin-extensible relationship workbench,
   inbox, and control plane rather than another Task Conversation.

2. Read [Task Conversation Management Architecture](TASK_CONVERSATION_MANAGEMENT_ARCHITECTURE.md).  
   It defines the key correction: one visible task chat is one focused Task, not
   the Agent's whole lifetime.

3. Read [Agent Companion Memory Architecture](AGENT_COMPANION_MEMORY_ARCHITECTURE.md).  
   It explains how the Agent preserves continuity across many Tasks without
   relying on a single infinite transcript.

4. Read [Agent Companion Current Implementation Gap Audit](AGENT_COMPANION_CURRENT_IMPLEMENTATION_GAP_AUDIT.md).  
   It grounds the target architecture in current code: what already exists,
   what is still missing, and which gaps should be closed first.

5. Read [Agent Companion Implementation Evidence Map](AGENT_COMPANION_IMPLEMENTATION_EVIDENCE_MAP.md).  
   It maps current Project, Composer, routing, conversation, Agent, and memory
   hooks to the target product layers.

6. Read [Agent Companion Near-Term Execution Slices](AGENT_COMPANION_NEAR_TERM_EXECUTION_SLICES.md).  
   It defines the immediate P0/P1 implementation order and which code areas
   each slice may touch.

7. Read [Agent Companion MVP Backlog and Decisions](AGENT_COMPANION_MVP_BACKLOG_AND_DECISIONS.md).  
   It turns the architecture into issue-sized work, dependency order, and
   unresolved product decisions.

8. Read [Agent Companion Solution Completeness Audit](AGENT_COMPANION_SOLUTION_COMPLETENESS_AUDIT.md).  
   It verifies which parts of the plan are complete enough to implement and
   which lower-level contracts remain.

9. Read [Agent-First Projection and Data Contract](AGENT_FIRST_PROJECTION_AND_DATA_CONTRACT.md).  
   It defines the read models that make Agent-first UI a projection over
   existing main-side facts, not a new authority source.

10. Read [Agent Companion Left Sidebar Architecture](AGENT_COMPANION_LEFT_SIDEBAR_ARCHITECTURE.md).  
   It maps the product mental model into navigation.

11. Read [Agent Companion Acceptance Test Matrix](AGENT_COMPANION_ACCEPTANCE_TEST_MATRIX.md).  
   It converts the architecture into evidence that must be true before each
   phase is considered complete.

12. Read [Agent Companion Settings and Context Architecture](AGENT_COMPANION_SETTINGS_AND_CONTEXT_ARCHITECTURE.md).  
   It defines how Agent identity, personalization, memory, context, and autonomy
   become user-controllable settings.

13. Read [Task Intent Routing And Plan Mode Spec](TASK_INTENT_ROUTING_AND_PLAN_MODE_SPEC.md).  
   It closes the practical routing problem: "做一个方案/计划" should become Plan
   when the sentence means a proposal before source changes.

14. Read [Agent Project Task UI Migration Plan](AGENT_PROJECT_TASK_UI_MIGRATION_PLAN.md).  
   It defines the development-stage cutover from the current Project-first
   shell to the single Agent-first product shell.

15. Read [Agent Home Control Plane and Task Delegation Architecture](AGENT_HOME_CONTROL_PLANE_AND_TASK_DELEGATION_ARCHITECTURE.md).  
    It defines how the Agent may turn relationship-level conversation into
    visible Project Tasks without hiding work or bypassing permission gates.

## Implementation Priority

### P0: Stabilize Current Builder Surfaces

- old conversation replay loads reliably;
- loading refresh does not flicker top bar/sidebar/composer;
- side workspace source files scroll correctly;
- tool evidence row typography is consistent;
- composer does not show generic readiness labels as permanent chrome.

This protects the current experience before adding Agent hierarchy.

### P1: Close Task Conversation And Plan Routing

- one Task conversation has a clear current target;
- Task Capsule and Task Address are visible in projections;
- Plan requests produce reviewable Plan markdown;
- renderer and main route evidence match;
- 计划/方案 ambiguity uses semantic classifier when needed.

This is the most direct response to the user's observed failures.

### P2: Add Default Builder Agent Workbench Projection

- bootstrap one persisted default Builder Agent;
- attach current projects to it in read-only projection;
- introduce the built-in Workbench message projection for projectless chat;
- replace the Project-first shell with Agent -> Workbench -> Project -> Task
  navigation.

Implementation can be sliced, but the accepted product does not retain a
Project-first compatibility mode.

### P3: Agent Settings And Memory Review

- structured Agent settings;
- memory fact store;
- memory review UI;
- context preview and memory-used inspector;
- delete/archive/supersede controls.

### P4: Long-Running Agent Work

- standing intents;
- autonomy policy;
- Activity view;
- parallel task monitor;
- notifications.

This should arrive only after single-Agent task and memory boundaries are
reliable.

## Architectural Invariants

- Agent is the relationship and long-term identity.
- Agent Workbench is the communication and coordination control plane.
- Project is the source and permission boundary.
- Task is the objective boundary.
- Conversation is evidence, not memory.
- Plan is a reviewable artifact, not just a chat answer.
- Build is side-effecting work and needs permission gates.
- Memory personalizes and recalls, but never authorizes.
- Renderer projections never become authority.
- Existing Project, Conversation, Git, permission, and runtime authorities are
  reused, but the Project-first navigation shell is removed at cutover.

## Bottom Line

The refined strategy is not "one chat for everything." It is:

```text
one persistent Agent relationship
+ many scoped Task conversations
+ durable memory across Tasks
+ clear Project and permission boundaries
```

That gives Builder the warmth of an Agent friend and the reliability of a
Codex-like task architecture.
