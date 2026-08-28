# Agent Home Control Plane And Task Delegation Architecture

Date: 2026-08-20

Status: target architecture and staged implementation contract.

Scope note: this document defines the built-in Task incubation and delegation
flow inside the broader
[Agent Workbench Message Fabric Architecture](AGENT_WORKBENCH_MESSAGE_FABRIC_ARCHITECTURE.md).
The Workbench document is authoritative for Agent Home messaging, plugins,
inbox behavior, external communication, and action routing.

## Decision

The Agent Workbench is the user's relationship-level control plane.
It does not require a Project and is not itself a hidden Project or Task.

The user may discuss any subject with the Agent. When the Workbench produces
actionable work, the Agent may propose or, when explicitly authorized, create a
Project-scoped Task conversation that performs the work.

```text
Agent Workbench discussion
-> understand and refine intent
-> answer in place, or propose bounded work
-> resolve Project and permission scope
-> create an addressable Task
-> run visibly in the Task execution plane
-> report the result back to Agent home
```

This preserves the feeling of talking to one long-lived collaborator without
using one infinite transcript as the execution, permission, and concurrency
boundary.

## Product Boundaries

| Concept | Purpose | Requires Project | May mutate source |
| --- | --- | --- | --- |
| Agent home | relationship chat, intent discovery, task control | no | no |
| Delegation proposal | reviewable description of proposed work | not initially | no |
| Project | source, repository, disclosure, and permission boundary | itself | no |
| Task Address | durable objective and conversation boundary | yes for file work | no |
| Run | one bounded execution attempt inside a Task | yes for file work | only through gates |

An Agent conversation may remember that work was discussed. It must not claim
that a Project, Task, file change, check, or save exists until the corresponding
main-owned fact has been recorded.

## Routing Outcomes

Every Agent-home turn resolves to one of these outcomes:

```ts
type AgentHomeTurnOutcome =
  | { kind: "answer_in_agent_home" }
  | { kind: "update_agent_working_context" }
  | { kind: "propose_task"; proposal_id: string }
  | { kind: "request_project_scope"; proposal_id: string }
  | { kind: "materialize_task"; task_address_id: string }
  | { kind: "control_existing_task"; task_address_id: string; action: string };
```

Examples:

| User turn | Outcome |
| --- | --- |
| `这个架构有什么优缺点？` | answer in Agent home |
| `先聊一下作品集应该怎么做` | update Agent working context |
| `就按这个做` with no Project | request Project scope |
| `在官网项目里开一个任务做这个` | materialize a Task after scope checks |
| `另外并行检查 loading 闪烁` | propose or create a parallel Task |
| `停掉刚才那个检查任务` | control the addressed Task |

Routing is semantic and context-aware. Keywords are useful evidence but are not
the authority for Project binding, permission, task creation, or execution.

## Delegation Proposal

Before Task creation, ambiguous or side-effecting work is represented as a
main-owned proposal:

```ts
type AgentTaskDelegationProposal = Readonly<{
  proposal_id: string;
  agent_id: string;
  source_conversation_id: string;
  source_turn_ids: readonly string[];
  title: string;
  objective: string;
  proposed_mode: "plan" | "build" | "review" | "research" | "monitor";
  project_requirement: "not_required" | "existing_required" | "new_or_existing";
  proposed_project_id: string | null;
  concurrency: "foreground" | "parallel";
  permission_requirements: readonly string[];
  context_capsule_ref: string;
  status: "proposed" | "approved" | "rejected" | "expired" | "materialized";
  created_at_ms: number;
  expires_at_ms: number | null;
}>;
```

The proposal contains a bounded objective and references to context evidence.
It does not copy the entire Agent transcript into a Project prompt.

## Creation Authority

Task creation is allowed only when one of these authorities exists:

1. The user explicitly asks to create/start/open the Task and Project scope is
   resolved.
2. The user approves a visible delegation proposal.
3. A standing intent explicitly permits this task kind, trigger, Project scope,
   budget, and notification behavior.

Even when Task creation is authorized:

- Project creation or folder binding remains explicit;
- file read, file write, command, network, save, commit, and publish gates remain
  independent;
- memory cannot grant action authority;
- renderer state cannot create the authoritative Task Address;
- the Task appears immediately in the Project tree or parallel-task monitor;
- cancel, pause, inspect, and permission controls remain available.

The initial implementation should support authorities 1 and 2. Standing-intent
creation belongs to the later autonomy phase.

## Context Handoff

The Agent home and Task conversation have different context scopes.

The handoff uses a context capsule assembled from:

- the accepted objective;
- the latest relevant Agent-home turns;
- explicit constraints and decisions;
- selected Agent memory references;
- selected Project memory references after Project binding;
- permission and provider-disclosure status;
- proposal and approval facts.

The capsule must exclude unrelated relationship chat and cannot imply source
facts before source-read authority exists. Its contents enter provider context
only through the existing disclosure gate.

After Task completion, a compact result report returns to Agent home:

```text
Task completed: Fix loading flicker
Project: ClawFabric Builder
Result: verified
Changed: 3 files
Review: required
```

The report links to the Task; it does not duplicate the full execution stream.

## Frontend Contract

### Agent Home

- remains usable with zero Projects;
- shows normal conversation and delegation proposal/result blocks;
- does not show a synthetic `Unassigned` Project;
- can open the exact Task created from a proposal;
- keeps Project metadata out of the composer until Project scope is relevant.

### Projects Column

- zero Projects: absent;
- one or more Projects: visible by default;
- user may collapse and restore it;
- a newly created first Project expands it;
- each Project contains its addressable Task conversations.

### Parallel Work

- foreground conversation stays focused on one surface;
- parallel Tasks appear in a right-side Activity/Tasks panel;
- each row shows objective, Project, state, elapsed time, permission wait, and
  cancel/open controls;
- completion creates an Agent-home result notice and a durable Task result;
- mutating Tasks with overlapping source scope are serialized or conflict-gated.

## Lifecycle

```text
discussion
-> proposal
-> project_scope_required | ready_for_approval
-> approved
-> Task Address materialized
-> queued | active | permission_wait | review_needed
-> completed | failed | cancelled | blocked
-> result reported to Agent home
```

Rejecting or expiring a proposal creates no Project, Task, run, or permission
fact. Retrying creates a new proposal or a recorded retry relationship; it does
not silently reuse stale scope.

## Current Implementation Foundation

Implemented in the current worktree:

- persisted default Builder Agent;
- durable Agent-scoped root conversation with `project_id: null`;
- Answer turns that do not create a Project or Task Address;
- main-owned Agent -> Project -> Task projection;
- Project-required Plan/Build paths;
- exact Task Address binding for Project conversations;
- zero-Project shell with conditional, collapsible Projects column;
- durable safe context-route evidence that lets a work discussion be followed
  by a contextual execution phrase;
- Project selection before that execution can proceed.

Not implemented yet:

- durable delegation proposal store and projection;
- Agent-home proposal/review blocks;
- main-owned materialize-from-proposal service;
- Task completion report back to Agent home;
- parallel-task right panel;
- standing-intent-authorized task creation.

## Staged Delivery

### Slice 1: Explicit Task Incubation

- create proposal contract/store;
- create proposal from explicit `new task`, `separate task`, and `parallel task`
  intents;
- approve/reject proposal;
- bind existing Project or request folder binding;
- materialize one Task Address through main authority;
- open the new Task and preserve Agent-home history.

### Slice 2: Visible Parallel Work

- Activity/Tasks side panel;
- task status and permission waits;
- open/cancel/pause controls;
- source-overlap conflict gate;
- completion report to Agent home.

### Slice 3: Policy-Governed Autonomy

- standing-intent contract;
- scoped triggers, budgets, expiration, and notifications;
- automatic proposal approval only where policy explicitly permits it;
- audit and revocation UI.

## Acceptance Criteria

- Agent chat works and persists with zero Projects.
- Work discussion followed by `就这样做` asks for Project scope rather than
  repeating the request or creating hidden work.
- Capability questions followed by a short confirmation do not create Tasks.
- Explicit parallel-task requests create at most one durable proposal/Task.
- Project and Task creation are idempotent under retries.
- Every created Task has a visible Task Address and origin proposal/turn link.
- No Task can exceed Project, permission, disclosure, or autonomy scope.
- Parallel mutating work cannot overwrite the same source silently.
- Completed work reports back to Agent home and remains inspectable in its Task.
- Reject, cancel, expiry, restart, and public-return-failure paths preserve
  truthful durable state.

## Bottom Line

The Agent should be allowed to organize work, but not to hide work.

The elegant model is:

```text
one long-lived Agent relationship
+ a projectless control-plane conversation
+ Agent-created, user-governed Task conversations
+ visible parallel execution
+ independent permission and review gates
```

This gives the user one natural place to talk while keeping execution bounded,
auditable, and recoverable.
