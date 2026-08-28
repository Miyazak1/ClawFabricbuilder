# Builder Agent Orchestration And Dual-Level Planning Architecture

Date: 2026-08-28

Status: target architecture and staged implementation contract.

Related architecture:

- `AGENT_HOME_CONTROL_PLANE_AND_TASK_DELEGATION_ARCHITECTURE.md`
- `AGENT_WORKBENCH_MESSAGE_FABRIC_ARCHITECTURE.md`
- `BUILDER_SESSION_TASK_ADDRESS_ARCHITECTURE.md`

## Decision

Builder uses two plan levels with different authority:

```text
Agent conversation: global planning and orchestration
  -> Agent Plan
  -> Task decomposition and dependency graph
  -> Project selection and Task assignment
  -> progress reconciliation and result synthesis

Project Task conversation: bounded execution
  -> Task Plan
  -> source work, checks, draft review, and save
  -> status, evidence, and result returned to Agent
```

The Agent is the coordinator. Project Task conversations act as subordinate execution agents, but remain normal, independently addressable conversations. A Task may create and revise its own local plan. That does not replace or mutate the Agent Plan.

## Plan Semantics

### Agent Plan

An Agent Plan describes the whole user outcome. It may span multiple Projects and Tasks and owns:

- objectives and success criteria;
- constraints and user decisions;
- task decomposition;
- dependencies and sequencing;
- proposed Project placement;
- completion policy and result synthesis.

It does not grant source read, source write, command, network, dependency installation, Save, commit, or publish authority.

### Task Plan

A Task Plan describes how one Task will deliver its assigned objective. It owns:

- implementation approach;
- files and components to inspect or change;
- local steps and checks;
- bounded implementation decisions;
- local recovery and retry strategy.

A Task Plan may refine implementation details but may not silently expand its assignment, change sibling responsibilities, or rewrite the Agent Plan. Conflicts are returned to the Agent as a typed change request.

## Ownership Matrix

| Concern | Agent | Task | Builder Main |
| --- | --- | --- | --- |
| Discuss whole outcome | owns | receives relevant context | records conversation |
| Author Agent Plan | proposes | no | stores and versions |
| Approve Agent Plan | no | no | records explicit user decision |
| Decompose work | proposes | may suggest changes | validates graph |
| Bind Project | proposes | no | verifies and materializes |
| Create Task Address | requests | no | sole authority |
| Author Task Plan | no | owns | stores and versions |
| Execute source work | coordinates | owns within assignment | enforces gates |
| Reassign or add Tasks | proposes | may request | records explicit admission |
| Reconcile progress | owns presentation | reports facts | joins canonical facts |
| Declare global completion | proposes | cannot | verifies completion policy |

## Canonical Records

### Agent Plan Artifact

```ts
type AgentPlanArtifact = Readonly<{
  agent_plan_id: string;
  agent_id: string;
  source_conversation_id: string;
  source_turn_id: string;
  source_run_id: string;
  version: number;
  markdown: string;
  content_digest: string;
  state: "proposed" | "approved" | "rejected" | "superseded" | "completed";
  approval_receipt_id: string | null;
  created_at_ms: number;
}>;
```

The complete Markdown plan is stored once by Main. Renderer state and task prompts carry references, not authoritative copies.

### Work Item

```ts
type AgentPlanWorkItem = Readonly<{
  work_item_id: string;
  agent_plan_id: string;
  title: string;
  objective: string;
  acceptance_criteria: readonly string[];
  constraints: readonly string[];
  dependency_ids: readonly string[];
  suggested_project_id: string | null;
  execution_mode: "foreground" | "parallel";
  state: "proposed" | "ready" | "assigned" | "active" | "blocked" | "completed" | "cancelled";
}>;
```

This is decomposition, not yet a Task. It creates no Project, Task Address, permission, or runtime work.

### Task Assignment

```ts
type AgentTaskAssignment = Readonly<{
  assignment_id: string;
  agent_plan_id: string;
  agent_plan_digest: string;
  work_item_id: string;
  project_id: string;
  task_address_id: string;
  requirement_summary: string;
  context_capsule_ref: string;
  state: "materializing" | "assigned" | "accepted" | "active" | "returned" | "failed" | "cancelled";
  idempotency_key: string;
}>;
```

The visible Task seed is the requirement summary. The runtime resolves the plan and work-item references from Main before composing context.

### Task Plan Link

Task-local plan records keep their existing Project and Task Address identity and add provenance:

```ts
type TaskPlanParent = Readonly<{
  assignment_id: string | null;
  parent_agent_plan_id: string | null;
  parent_agent_plan_digest: string | null;
}>;
```

A manually created Task Plan has null parent fields. Therefore existing Task Plan behavior remains valid and independent.

## Orchestration Flow

### 1. Plan In Agent

```text
user selects Plan mode
-> Agent streams complete Markdown plan
-> Main closes the run and records Agent Plan proposal
-> Agent conversation displays full plan plus Approve / Revise / Reject
```

Streaming text is normal Agent conversation output. The durable plan artifact is created only after a valid terminal response; partial output is never approvable.

### 2. Approve And Decompose

```text
user approves exact plan digest
-> Main records approval receipt
-> Agent proposes work-item decomposition
-> user may approve all, edit boundaries, or approve selected work items
```

Decomposition should be a structured model result validated by Main. It must not be inferred later from display text.

### 3. Resolve Projects

Each approved work item resolves independently to:

- an existing Project;
- a newly created Project after explicit confirmation;
- no Project for a read-only/research Task, when supported;
- blocked pending user choice.

One Agent Plan may assign several work items to one Project or distribute them across Projects.

### 4. Materialize And Start Tasks

```text
approved work item + resolved Project
-> idempotent materialization request
-> Main creates/reuses Session and Task Address
-> Main records Assignment and Context Capsule
-> Task appears immediately in Project tree and Agent task monitor
-> foreground Task opens, parallel Task starts visibly in background
```

Task creation does not imply execution or write approval. A Task may first discuss, inspect allowed context, or create a Task Plan.

### 5. Task Planning And Execution

The Task receives:

- requirement summary;
- exact work-item objective and acceptance criteria;
- parent Agent Plan reference and relevant bounded sections;
- dependency status from sibling Tasks;
- Project context allowed by existing disclosure policy.

The Task may then:

1. execute directly when the assignment is sufficiently bounded;
2. propose a Task Plan and wait for approval;
3. ask a local clarification;
4. report that the assignment needs global replanning.

After local approval, execution uses the existing Harness, tool broker, check, draft review, and Save pipeline.

### 6. Return And Reconcile

Task details remain in the Task conversation. Main emits a typed return record containing:

- Task Address and assignment identity;
- terminal state;
- concise result summary;
- check and review status;
- changed-file count or artifact references;
- blockers, unresolved questions, and suggested plan changes.

The Agent projection joins all assignment states and produces a global progress view. The Agent may summarize results, propose follow-up work, or request user decisions. It cannot mark the Agent Plan complete until Main verifies its completion policy.

## Dependency And Concurrency Model

Work items form a directed acyclic graph. Main validates unknown dependencies, self-dependencies, and cycles before approval.

- `ready`: every dependency is completed or explicitly waived;
- `blocked`: dependency, permission, conflict, or user decision is pending;
- `parallel`: ready work items have non-conflicting authority scopes;
- `serialized`: overlapping source scopes or explicit ordering require one-at-a-time execution.

The first release should use conservative Project-level mutation serialization. File-level conflict scheduling belongs to a later phase.

## Change Control

Task discoveries may require global changes. They return one of:

```ts
type TaskToAgentChangeRequest =
  | { kind: "clarification_required"; question: string }
  | { kind: "scope_change_proposed"; summary: string }
  | { kind: "dependency_change_proposed"; dependency_work_item_ids: readonly string[] }
  | { kind: "new_work_item_proposed"; objective: string }
  | { kind: "agent_plan_revision_required"; reason: string };
```

Only the Agent plane can propose a revised Agent Plan. User approval binds a new digest and supersedes the old version. Existing assignments remain linked to their original digest until explicitly migrated, cancelled, or allowed to finish.

## UI Contract

### Agent Conversation

- full streamed Agent Plan in normal Markdown;
- plan version and approval state;
- work-item checklist with Project, Task, dependency, and state;
- `New project`, `Use existing project`, `Open task`, `Pause`, and `Cancel` actions where admitted;
- global progress and returned results;
- no duplicate Task execution transcript.

### Task Conversation

- visible parent Agent Plan and assignment reference;
- concise assigned objective and acceptance criteria;
- independent Plan mode and Task Plan review;
- normal source, check, draft review, and Save controls;
- `Report to Agent` and typed blocker/change-request actions.

Agent Plan controls must never replace Task Plan controls.

## Authority And Security

- Main is the only authority for plan records, approval receipts, decomposition graphs, Project binding, Task Address creation, assignments, and result reconciliation.
- Agent Plan approval authorizes orchestration only.
- Work-item approval authorizes materialization only.
- Project creation authorizes identity and folder binding only.
- Task Plan approval authorizes the selected Task execution path only.
- Read, write, command, network, dependency preparation, Save, commit, and publish remain separate gates.
- A Task receives only its bounded capsule, not the entire Agent transcript or sibling private context.
- Models cannot forge completion, dependency satisfaction, approval, or Task identity.

## Recovery And Idempotency

- Restart restores proposed/approved plans and work-item state.
- Repeated plan approval returns the same receipt.
- Repeated project/task confirmation returns the existing Assignment and Task Address.
- Cancelling Project selection leaves the work item unassigned.
- Failure between Project creation and Task creation resumes from the same idempotency key.
- Failure after Task creation reopens the same Task Address.
- Stale plan digests fail closed.
- Cancelling one Task does not cancel siblings or the Agent Plan unless policy explicitly says so.
- Archived Tasks remain part of historical reconciliation but are excluded from active scheduling.

## Implementation Plan

### Phase O1: Agent Plan Artifact

- persist complete Agent Plan output and digest;
- add approve, revise, reject, and restart restoration;
- project full Markdown and approval actions in Agent conversation.

### Phase O2: Decomposition Graph

- add structured work-item generation and validation;
- add editable review UI and dependency visualization;
- no automatic Task creation yet.

### Phase O3: Assignment And Materialization

- bind work items to existing/new Projects;
- reuse Task proposal incubation and Task Address materialization;
- add Assignment and Context Capsule references;
- make creation idempotent.

### Phase O4: Task-Local Plan Integration

- expose parent assignment context in Task;
- preserve independent Task Plan creation and approval;
- resolve full Agent Plan through Main-owned references at runtime.

### Phase O5: Result Reconciliation

- return typed Task results and change requests;
- project global progress in Agent;
- verify completion policy and follow-up creation.

### Phase O6: Parallel Scheduling

- dependency-aware readiness;
- conservative Project mutation serialization;
- pause/cancel/retry and conflict reporting;
- real-model multi-Task packaged canaries.

## Acceptance Scenarios

1. Agent creates and streams a complete plan with zero Projects.
2. User approves it, confirms a new Project, and exactly one assigned Task starts.
3. Agent decomposes one plan into multiple Tasks across one or more Projects.
4. Each Task can create its own Task Plan without changing the Agent Plan.
5. A Task requests global replanning and cannot silently expand scope.
6. Dependencies prevent downstream Tasks from starting early.
7. Parallel Tasks do not mutate the same Project concurrently in the first release.
8. Results return to Agent and global completion is based on canonical Task facts.
9. Restart at every approval/materialization boundary resumes without duplicates.
10. No plan or orchestration action grants file, command, network, install, Save, or publish authority.

## Primary Engineering Risk

The largest risk is treating orchestration as prompt text instead of durable state. That would produce duplicate Tasks, stale plans, lost dependencies, false completion, and permission leakage after restart.

The implementation should therefore extend the existing Main-owned Task Address, Workbench Message Fabric, Context Capsule, and result-return services. It should not introduce direct model-to-model calls or a second execution runtime.
