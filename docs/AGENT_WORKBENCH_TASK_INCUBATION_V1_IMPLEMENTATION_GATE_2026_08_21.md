# Agent Workbench Task Incubation v1 Implementation Gate

Date: 2026-08-21

## Outcome

Agent Workbench Task Incubation v1 is implemented as an approval-gated control-plane flow:

1. A projectless Agent conversation may produce a typed task proposal.
2. The proposal remains projectless and has no execution, source, permission, or provider authority.
3. The owner may reject it, bind it to an existing Project, or create a local Project and then bind it.
4. Main creates one deterministic Session Address, Task Address, and task Conversation Address.
5. The new Task starts in `draft` status and does not run until the user continues in Builder.
6. Workbench projects the materialized task back as an `Open task` action.

This reverses the old projectless build behavior. A natural-language build request in Agent Workbench no
longer needs to jump directly into the Project picker when task incubation is available. The old picker
remains a bounded fallback when the Workbench proposal authority is unavailable.

## Main-Owned Facts

- Proposal contract: `electron/builder-workbench-task-proposal-contract.cjs`
- Durable proposal/decision/materialization store:
  `electron/builder-workbench-task-proposal-store.cjs`
- Incubation and deterministic recovery service:
  `electron/builder-workbench-task-incubation-service.cjs`
- Canonical Workbench message store remains the message timeline authority.
- Canonical Session/Task Address store remains the task identity authority.

The proposal store persists three immutable record classes:

- `builder-workbench-task-proposal.v1`
- `builder-workbench-task-proposal-decision.v1`
- `builder-workbench-task-materialization.v1`

The materialization includes a bounded incubation context capsule that references the objective and origin
message. It explicitly records `provider_dispatch: false` and `permission_grant: false`.

## Recovery Contract

Identifiers for the Session, Task, conversation, proposal message, and status message are derived
deterministically from the proposal and selected Project. This makes retries idempotent across these crash
windows:

- proposal persisted before its Workbench message;
- approval persisted before Session Address creation;
- Session Address persisted before Task Address creation;
- Task Address persisted before materialization record creation;
- materialization persisted before status-message projection.

If approval exists but materialization is incomplete, retry resumes address creation instead of treating the
approval as terminal.

## Renderer Contract

Preload `builder-preload.v33` adds only:

- `agentWorkbench.createTaskProposal(request)`
- `agentWorkbench.decideTaskProposal(request)`

The renderer receives declarative proposal actions. It cannot provide source content, commands, model
requests, permissions, Session IDs, Task IDs, or conversation IDs. Main verifies the selected Project and
derives all materialized identities.

Pending proposal UI supports:

- select an existing Project and create the Task;
- create a new local Project, then create the Task;
- dismiss the proposal.

Materialized proposal UI supports opening the exact Task Address.

## Verification Evidence

- TypeScript build: passed.
- ESLint: passed.
- BuilderApp interaction suite: 113 passed.
- Workbench domain/controller/port/BuilderPage focused suite: 116 passed.
- Runtime, IPC, persistence, recovery, and Electron security suite: 47 passed.
- Deterministic interrupted-materialization recovery: passed.
- Restart recovery through the real generation IPC runtime: passed.
- Full boundary suite: 1803 passed, 1 skipped, 0 failed (1804 total).
- Packaged artifact verification: passed with 996 ASAR entries and the staged Harness runtime.
- Packaged launch smoke: passed against `builder-preload.v33` with isolated user data.
- Real packaged canary: passed with `builder-packaged-canary-result.v25`.
- Packaged canary verified all task-incubation assertions:
  - a projectless build request creates a visible Agent task proposal;
  - build remains blocked before Project/Task materialization;
  - user approval creates and binds the Task through main authority;
  - materialization does not auto-run the Task;
  - execution begins only after the user submits inside the materialized Task;
  - Source content loading, restart recovery, plan approval, revision save, checkpoint continuation, and
    checkpoint undo remain operational.

## Packaged Source Loading Findings

The real packaged canary exposed three renderer state-machine defects that focused tests had not detected:

1. A same-key React effect rerun invalidated the only in-flight file-content request and then returned early,
   leaving the Source view in `loading` permanently.
2. A temporary draft-identity mismatch discarded a successful file-tree response without releasing the
   request key, preventing the controller from retrying after the canonical draft returned.
3. Runtime workspace snapshots were keyed by `draft_id`, so checkpoint and undo transitions inside one
   Task hid a valid user-opened snapshot and forced an unstable current-draft read.

The renderer now invalidates request sequences only when a new request starts or the state is genuinely
cleared, releases stale tree requests for retry, and binds runtime snapshots to Project plus task
conversation identity. Snapshot visibility therefore survives draft replacement inside one Task while
remaining isolated across Projects and Tasks.

## Deliberate Limits

- Approval creates and opens a Task but does not auto-run it.
- A new Project still requires the native local-folder selection flow.
- Parallel execution is represented in the proposal contract but no parallel scheduler is admitted yet.
- Result return currently uses Workbench status messages; richer structured result cards remain a later slice.
- Proposal expiry is recorded but expiry automation is not yet implemented.
