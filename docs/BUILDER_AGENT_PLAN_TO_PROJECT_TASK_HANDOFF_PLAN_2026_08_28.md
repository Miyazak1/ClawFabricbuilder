# Builder Agent Orchestration And Dual-Level Planning Architecture

Date: 2026-08-28

Status: target architecture and staged implementation contract.

Implementation status: the first single-task Agent Plan handoff is implemented and passed a real DeepSeek packaged desktop RC canary on 2026-08-28.

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

## Implemented O4 Closure

The first production slice now supports this exact path:

```text
Agent Plan mode
-> real provider streams Markdown in the Agent conversation
-> Main records the complete normalized plan artifact
-> user approves the exact digest
-> Main creates one idempotent build proposal
-> user confirms a new Project
-> Main materializes one Task Address and binds the approved plan
-> foreground handoff preserves requested_outcome=build
-> Task runtime resolves the full plan by Task Address
-> coding tools, automatic check, review, and Save use the normal Task pipeline
```

Three production-only contract gaps were found and fixed during the real RC run:

1. Agent conversation context uses `project: { project_id: null }`; plan recording previously expected `project === null`.
2. Provider Markdown may include terminal whitespace; plan persistence now normalizes it before computing the immutable digest.
3. Opening prior Project history leaves a Main-owned selected Project. Agent Plan admission now forces a projectless request, while foreground build proposals preserve explicit Build mode instead of asking semantic routing to infer execution from the task title.

The packaged canary begins with a cloned saved test profile, not an empty fixture. Its passing run observed:

- 2 existing Projects and 10 existing Tasks before the run;
- a 700-character durable Agent Plan and exact digest approval;
- exactly one proposal and one materialized Task Address;
- a new Project followed by automatic foreground coding;
- live Task Markdown, 12 programming tool activities, automatic check readiness, review, and Save;
- 3 Projects and 12 Tasks after completion;
- 52.3 seconds total wall time.

The same run exposed performance work that remains separate from orchestration correctness:

- the first coding Task received 559 live-output updates and dropped 381 intermediate renderer updates by design;
- Task Stream read latency reached 566.8 ms in the renderer window;
- Workbench task synchronization reached 377.8 ms;
- Main event-loop delay reached about 1.02 seconds.

These measurements make incremental Task Stream reads, bounded Workbench synchronization, and live-output batching the next performance priorities. They do not weaken the completed authority model or justify moving canonical state into Renderer memory.

## Complete Agent Plan Quality Contract

The initial O4 provider run proved the handoff mechanics, but its 700-character plan was not detailed enough to serve as the execution source for subordinate Tasks. Agent Plan mode now requires an implementation blueprint rather than a short recommendation.

A complete Agent Plan must adapt these concerns to the actual request:

- goals, non-goals, assumptions, and unresolved decisions;
- target users and end-to-end flows;
- features, controls, states, interactions, and failure behavior;
- visual behavior and, when relevant, concrete 3D scene behavior;
- technical architecture, data models, interfaces, modules, and file boundaries;
- implementation phases, dependencies, deliverables, and measurable acceptance criteria;
- test and verification coverage;
- performance, security, privacy, and accessibility requirements;
- risks, recovery, rollback, deployment, observability, and maintenance.

The provider output is admitted as an Agent Plan only when it contains at least 1,200 Unicode code points, eight substantive Markdown sections, and twelve concrete list items. These are structural lower bounds, not a target length and not permission to add filler. If the first answer is underspecified, Main requests one bounded repair that preserves the user's language and intent. If the repair remains incomplete, the request fails instead of creating a misleading approval artifact.

Plan artifact persistence happens after the conversation terminal event. Main must therefore publish a second Workbench change notification after plan recording so the approval card appears without requiring a restart, navigation, or unrelated refresh.

## August 31 Terminal And History Regression

The saved-profile investigation found failed structured responses and queued follow-ups, not an intentional provider wait for plan approval. The UI could also retain an old Project selection and display an older approval card beneath a newer failed request. These are separate from the remaining Main-thread performance work.

The current fixes preserve the existing Main-owned plan authority:

- Agent Plan requests and started-event matching are explicitly projectless even when a saved Project, unsaved draft, or historical revision is retained behind the Workbench.
- Terminal refresh targets the Agent conversation and Workbench, not the retained Project. Plan completion releases the composer without another user reply; failures restore the submitted instruction.
- Approval controls appear within the exact source message identified by the artifact's `source_message_id`, after its full Markdown body. A failed newer request cannot move an older plan's controls under its own bubble.
- Agent Plan explanations accept up to 12,000 code points and 48,000 UTF-8 bytes through kernel validation, Renderer answer validation, and Agent transcript projection. Ordinary answers retain their 4,000-code-point bound. Outer explanation whitespace is normalized before validation.
- A bounded provider repair resets the old live buffer through the existing digest-bound reset protocol and streams the replacement explanation. It does not concatenate two plans or silently wait for the entire repair before showing output.
- Current requirements are repeated as the final Plan user message. Earlier conversation remains context, but may not replace a new goal, explicit file names, literals, or acceptance checks.
- Plan validation diagnostics contain only allowlisted numeric aggregates, never plan text or credentials.
- The sticky Agent filter bar uses the declared opaque background token.

### Packaged Evidence

The final real DeepSeek run used a copy of the saved test profile. It did not modify original history or use global desktop input. Evidence is in `release/agent-plan-rc-20260831-final/result.json` and the adjacent 1280px/1000px review screenshots.

- Started with 2 Projects, 10 Tasks, and 59 old-task history items; continued an existing saved Task.
- One Plan submission produced 3,213 characters with live Markdown, the specified `index.html`, `package.json`, and `check.js`, and the expected verification requirements.
- Approval was visible and enabled beside its own completed plan without a follow-up message; the Stop control and submit lock were gone.
- Approved the exact digest, clicked New project, and materialized exactly one foreground Task with the full approved plan bound by Main.
- The first Task used real coding tools and checks. The test clicked Save version and verified the saved activity plus removal of the unsaved-draft indicator.
- A second Task reused the same Project, changed the requested subtitle while preserving the heading, and reached check-ready. This run does not claim a second version was saved.
- Finished with 3 Projects and 12 Tasks in 74.3 seconds.

Earlier runs are not counted as passes: one failed structured validation and needed resubmission, and another generated a 4,734-character plan that omitted two explicitly required files. The latter stopped before approval. The final current-instruction change passed the same saved-history requirements in one submission; this is one successful sample, not a long-running reliability claim.

Final focused verification: 439 frontend tests, 220 Node tests, TypeScript build, Windows packaging, and package-identity verification passed. Full repository lint still has pre-existing errors and is not a passing release gate.

Performance remains open: the final RC observed Main event-loop delay up to 1,193 ms, Workbench task synchronization up to 394 ms, and Renderer Task Stream reads up to 723 ms. This slice fixes plan scope, content admission, and terminal/review behavior; it does not complete O2 decomposition, O5 reconciliation, O6 scheduling, or the performance program.

## Multi-Round Plan Stability Follow-Up

The follow-up preserves the Main-owned authority model:

- Projectless Agent Plan context now includes the latest complete immutable
  plan and its digest-matching decision, rather than relying on a truncated
  chat summary. Current requirements remain authoritative. A prior plan or
  decision in context does not grant execution permission.
- Failed and cancelled revisions retain the prior artifact. Startup closes
  interrupted Agent runs with durable terminal facts without inventing an
  assistant reply. Review remains attached to the exact plan after restart.
- Agent-only conversation events no longer invalidate every Project Task
  projection. Workbench recording skips a previously synchronized head only
  after its writes succeeded; Agent stream caching is keyed by SQLite head.
- A real coding failure consumed all 8,192 response tokens as reasoning,
  returned `max-tokens`, and produced neither text nor tools. Build now allows
  one bounded continuation inside the same admitted run, with the complete
  original requirements and unchanged model settings/permissions. A second
  empty token-limit result fails with a specific internal cause. Cancellation
  remains available. High reasoning and the configured per-response token
  limit are not disabled or increased.

The real-provider canary now revises a complete plan, cancels an intermediate
revision, restarts before approval, clicks New project, executes and saves the
first Task, creates a second Task in that Project, checks it, and clicks Save
again. It verifies the revised requirement in actual source files and exact
Project/Task count changes. Check success must be present in canonical Task
facts even when completion is observed through the UI save checkpoint.

Canary fixes are not product successes: stale v36 bridge assertions and
missing Browser/Question tool kinds were aligned with current contracts;
mock readiness interfaces were brought up to date without weakening their
read-only restrictions. Native maximize/restore now has a real click check.
Additional screenshots open source through the tool record's Open button,
since the source menu is not always available after Save.

Failed attempts are retained under `release/agent-plan-stability-20260831`:
round 1 had an underspecified continuation-question assertion; round 2 hit
the empty token-limit coding failure; round 4 saved both tasks but failed an
obsolete screenshot selector; round 5 failed the second Task's automatic
checks; rounds 6 and 8 failed the cold-start window preflight. They are not
counted as successful end-to-end runs. The regression request now explicitly
keeps the subtitle mutable and limits its check to the fixed heading so the
two tasks do not accidentally impose conflicting fixture requirements.
Round 10 also completed both checks and saves but timed out while taking an
additional screenshot. Round 11 isolated the cold-start failure to a stale
Playwright native-window read handle. The corrected preflight only reacquires
invalidated read handles and preserves exactly one click per window action.
Supplemental theme screenshots and the strict workflow soak can now run
separately; the workflow still requires native maximize/restore, all plan and
approval gates, canonical successful check facts, real file changes, both
visible Save clicks, and exact final Project/Task counts.

### Final Consecutive RC Results

Rounds 12, 13, and 14 passed consecutively against the final packaged runtime
using separate copies of the saved test profile and the configured
`deepseek-v4-flash` provider. Original history was not changed. Each round
started with 2 Projects, 10 Tasks, and 59 existing history items, continued an
old Task, and finished with exactly 3 Projects and 12 Tasks.

| Round | Duration | Revised plan characters | Tool activities (Task 1 / 2) | Passed checks (Task 1 / 2) |
| --- | --- | --- | --- | --- |
| 12 | 81.107 s | 4,467 | 11 / 9 | 1 / 1 |
| 13 | 67.689 s | 1,907 | 11 / 11 | 1 / 1 |
| 14 | 63.569 s | 2,562 | 17 / 7 | 1 / 1 |

All three observed live complete Plan Markdown, review without a follow-up,
one initial submission, cancellation preserving the prior plan, a complete
revision preserving requirements, pending review after restart, exact-digest
approval, one new-project Task, automatic coding without redundant write
approval, a second Task in that Project, and two Save version clicks with
the unsaved state removed. Native title-bar maximize and restore matched
renderer dimensions in all three runs.

Evidence: `release/agent-plan-stability-20260831/round-{12,13,14}/result.json`.
Visual theme evidence is separately retained in rounds 7 and 9 and the
`native-window` directory. The final three runs deliberately omit additional
screenshots; they retain all functional UI and canonical check assertions.

Peak timings below take the maximum across both process lifetimes, before
and after the required restart:

| Round | Main event-loop delay | Workbench task sync | Renderer Task Stream read |
| --- | --- | --- | --- |
| 12 | 591.921 ms | 356.419 ms | 457.1 ms |
| 13 | 553.124 ms | 404.629 ms | 344.3 ms |
| 14 | 620.233 ms | 370.385 ms | 404.0 ms |

The prior single-run baseline reached 1,193 ms on the Main loop. These are
observational RC samples, not a controlled performance benchmark. Main
blocking and Workbench synchronization remain measurable next-stage work;
the change does not claim a fully smooth application under every workload.

Verification: 302 focused frontend tests, 268 focused Main/history tests,
and 101 packaged-canary tests passed (the Node groups overlap by six tests).
TypeScript, Windows packaging, package verification, changed-file lint, and
`git diff --check` passed. Extracted packaged Main/runtime files match the
current source. Full repository lint remains a known non-passing release
gate, and the full repository test suite was not run in this follow-up.

The final successful provider runs did not trigger empty-token-limit
recovery. Its one-continuation bound, second-failure terminal state,
cancellation, preservation of requirements, and non-replay of partial text
are covered by focused runtime tests. No model setting or per-response token
limit was weakened to obtain the successful RC samples.

### Performance And Interaction Follow-up

The next-stage Main synchronization benchmark, Agent navigation/scroll
fixes, and durable cancelled-turn notices are recorded in
`BUILDER_WORKBENCH_PERFORMANCE_AND_INTERACTION_RC_2026_08_31.md`.
Performance rounds 6-8 passed consecutively; round 9 additionally verifies
the cancellation notice after Stop and restart, then completes both Saves.
These are separate artifacts from the plan-stability rounds above.
