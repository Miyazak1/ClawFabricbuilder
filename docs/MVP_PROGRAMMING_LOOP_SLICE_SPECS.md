# MVP Programming Loop Slice Specs

This document breaks the MVP Programming Loop Implementation Spec into
engineering slices. Each slice must be independently testable, release-gated,
and compatible with Builder's existing main-owned authority model.

The slices are ordered. Later slices may prepare contracts early, but visible
product behavior should not skip ahead of the loop.

## Slice 0: Plan Mode Stabilization

### Purpose

Make planning reliable before execution work expands. Plan mode is the first
visible proof that Builder can reason over a project without mutating it.

### User Outcome

The user can either choose `Plan mode` from the composer menu or ask naturally
for a plan. The message sends successfully, produces a plan, and never creates
source edits, draft checkpoints, Git candidates, or Project Revisions.

### Required Inputs

- current project binding, when available;
- conversation id;
- turn id;
- latest user instruction;
- plan mode source: `explicit_chip` or `natural_language_intent`;
- selected source summary, if already available;
- permission mode.

### Required Facts

```text
PlanRun
  project_id?
  conversation_id
  turn_id
  run_id
  instruction_digest
  source
  status
  started_at_ms
  completed_at_ms
  authority

PlanProposal
  run_id
  title
  summary
  assumptions
  steps
  open_questions
  execution_hint
```

### Authority

Plan mode may:

- read bounded project context after project selection;
- search project files through read-only source policy;
- update conversation/task stream with plan status and proposal.

Plan mode may not:

- write source files;
- run write-capable commands;
- create Draft Checkpoints;
- create Git candidates;
- save Project Revisions;
- grant provider-context egress permission.

### UI Projection

- Composer `+` menu exposes `Plan mode` when a project is selected.
- Active plan mode appears as a removable chip.
- Chat timeline shows the plan proposal and an execution affordance such as
  `Apply plan`.
- If no project is selected, the plan is clearly chat-only and cannot be
  executed as source work.

### Tests And Evidence

- explicit `Plan mode` chip sends a request;
- natural language plan route sends a request;
- plan route is read-only in renderer and main;
- plan route cannot create draft/revision/source mutation facts;
- failed plan keeps composer usable;
- packaged canary proves plan mode does not silently no-op.

## Slice 1: Project Understanding And Command Profile Discovery

### Purpose

Give the agent enough project context to plan and verify without guessing.

### User Outcome

After project selection, Builder can say what kind of project it is, where the
main files are, and which commands are likely useful for build, lint, test, or
preview.

### Required Inputs

- selected project root;
- file tree summary;
- manifest files, such as `package.json`, lockfiles, config files, and README;
- previous saved version metadata, if available;
- previous successful CheckRun facts, if available.

### Required Facts

```text
ProjectUnderstandingSnapshot
  project_id
  root_digest
  source_tree_digest
  detected_stack
  package_manager
  entrypoints
  important_paths
  command_profile_ids
  unknowns
  stale_reason?
  updated_at_ms

CommandProfile
  command_profile_id
  project_id
  command_kind
  command_display
  cwd
  confidence
  discovered_from
  requires_user_approval
  risk_class
```

### MVP Detection Rules

Minimum stack detection:

- Node or frontend project from `package.json`;
- static HTML project from `index.html`;
- Markdown/text artifact project from project files;
- unknown project fallback.

Minimum command discovery:

- `npm run lint`;
- `npm run typecheck`;
- `npm test`;
- `npm run build`;
- package-manager equivalent when confidently detected.

### Authority

Discovery is read-only. It cannot install dependencies, run commands, mutate
files, or mark the project ready for execution by itself.

### UI Projection

- status: `Reading project`;
- composer project chip may show readiness such as `Ready to plan`;
- advanced diagnostics may show detected stack and command candidates;
- ordinary UI should not show digests.

### Tests And Evidence

- package manifest detection;
- static HTML fallback;
- unknown project fallback;
- stale snapshot when source tree changes;
- command profile confidence and risk class;
- no command execution during discovery.

## Slice 2: Execution Approval And ProgrammingRun Admission

### Purpose

Make the transition from "plan" to "do it" explicit, auditable, and bound to the
current project/task context.

### User Outcome

The user can approve the current plan or instruction. Builder starts one
ProgrammingRun with clear status and cannot reuse stale approval for a different
project, conversation, turn, plan, or provider configuration.

### Required Inputs

- current project id;
- conversation id;
- task id, when available;
- turn id;
- current plan run or latest instruction;
- permission mode;
- provider config digest;
- current ProjectUnderstandingSnapshot id.

### Required Facts

```text
ExecutionApproval
  approval_id
  project_id
  conversation_id
  task_id?
  turn_id
  approved_subject
  approved_subject_digest
  permission_mode
  provider_config_digest
  approved_at_ms
  expires_at_ms

ProgrammingRun
  run_id
  project_id
  conversation_id
  task_id?
  turn_id
  execution_approval_id
  context_snapshot_id
  status
  authority
```

### Authority

Execution approval allows Builder to attempt the approved work under the
current write policy. It does not approve shell commands, dependency
installation, network access, external directories, publish, save version, or
provider context egress.

### UI Projection

- plan card exposes `Apply plan`;
- composer may expose `Ready to execute current direction`;
- timeline shows `Execution started`;
- approval errors are visible and recoverable.

### Tests And Evidence

- approval binds exact project/conversation/turn/plan or instruction;
- stale plan cannot execute;
- cross-project approval fails closed;
- approval expiration fails closed;
- execution starts one ProgrammingRun only once for idempotent retries;
- no source mutation before execution admission.

## Slice 3: Edit Intent, Workspace Guard, And Patch Application

### Purpose

Turn provider output into bounded local source edits while protecting user work.

### User Outcome

Builder can change files inside the selected project, but only through an
auditable edit plan and guard decision. It never overwrites user work silently.

### Required Inputs

- ProgrammingRun;
- provider response normalized into proposed edit material;
- selected project root;
- current source tree digest;
- Git status or equivalent local change status;
- protected path policy;
- permission mode.

### Required Facts

```text
EditIntentPlan
  edit_intent_plan_id
  run_id
  target_paths
  file_operations
  reason
  risk_class
  status

WorkspaceGuardDecision
  guard_decision_id
  run_id
  path
  operation
  decision
  reason
  user_visible

EditAttempt
  edit_attempt_id
  edit_intent_plan_id
  attempt_number
  status
  changed_paths
  conflict_summary?
  resulting_tree_digest?
```

### Guard Rules

MVP deny:

- paths outside selected project root;
- secret-looking files such as `.env`;
- binary files;
- `.git` internals;
- unknown generated output directories when detected;
- user-changed files when expected-old content does not match;
- absolute paths supplied by provider output.

MVP require explicit visible approval:

- file delete;
- file move;
- lockfile change;
- large multi-file change above configured threshold.

### Patch Rules

- Prefer patch or structured edit over opaque full-tree replacement.
- Validate expected-old content or file digest before write.
- Normalize paths before policy checks.
- Roll back partially applied edit sets when application fails.
- Record changed paths for Review Workspace.

### UI Projection

- timeline status: `Changing files`;
- review summary: changed path count and operation types;
- guard denials are ordinary failure messages, not internal exceptions.

### Tests And Evidence

- rejects path traversal and absolute paths;
- rejects protected files;
- detects user-change conflict;
- supports create/update/delete within project root;
- rollback on failed multi-file patch;
- no renderer source mutation authority.

### Current Implementation Checkpoint

`builder-edit-intent-plan.v1` and `builder-workspace-guard-report.v1` now bind
structured candidate operations to expected-old content digests, protected-path
policy, and a fresh main-owned workspace read before Git candidate persistence.
`builder-edit-attempt.v1` now turns an allowed plan/report/candidate set into an
immutable successful attempt fact with changed paths, operation counts, base
and resulting tree digests, and an explicit atomic in-memory rollback model.
Its bounded id/digest/candidate reference is persisted in the automatic Draft
Checkpoint, so restart recovery can prove that the candidate passed the edit
admission chain instead of relying on transient generation state.

Final Save materialization now uses the main-only
`builder-worktree-transaction.v1` boundary. It prevalidates the expected old
files, stages replacement content below the private `.git` directory, applies
bounded create/update/delete operations, and restores every applied operation
when a later file operation or the Git main-ref CAS fails. A strict
`builder-worktree-transaction-journal.v1` stores only operation paths, content
digests, and old/resulting Git OIDs. On Save retry or current-project reopen,
main compares that journal with both the SQLite-selected Project Revision and
the actual Git main ref. SQLite selection defines the intended version: an
unselected interrupted candidate restores the base tree, while a selected
revision completes the resulting tree and advances Git main through CAS when
needed. Partial multi-file, Git update failure, restart rollback, and restart
completion are covered by fault/recovery tests without exposing source content
in the journal.

The main-owned `builder-agent-activity-projection.v1` now folds the latest
recorded Conversation/Run/Tool facts and current ReviewState into one
renderer-safe current-work phase. The chat flow can therefore show plain
states such as `Reading project`, `Planning`, `Changing files`, and
`Preparing review` without inferring them from provider text or exposing the
underlying receipts. Active CheckRun work now joins the same projection from
the main-owned candidate activity registry, so a completed generation can show
`Running checks` while its current candidate is being verified. The registry
publishes only a bounded refresh hint; commands, output, paths, and runtime
handles remain private. This projection is read-only and grants no provider,
tool, source, command, Git, SQLite, permission, or Save authority.

This slice is not complete yet. Delete, move, lockfile, and large-edit
decisions still need a visible approval-and-resume path instead of a terminal
failure. Move/rename operations remain a later checkpoint.

## Slice 4: Automatic Draft Checkpoint

### Purpose

Make AI edits recoverable by default without turning every edit into a saved
version.

### User Outcome

After successful AI mutation, the project shows an unsaved draft that can be
reviewed, continued, discarded, or recovered after restart.

### Required Inputs

- successful EditAttempt;
- ProgrammingRun;
- changed paths;
- current source tree digest;
- project and task identity;
- previous saved revision, if any.

### Required Facts

```text
DraftCheckpoint
  draft_checkpoint_id
  project_id
  conversation_id
  task_id?
  run_id
  base_revision_id?
  changed_paths
  source_ref
  status
  created_at_ms
```

### Authority

DraftCheckpoint is recovery state only. It cannot select current Project
Revision, publish, create Work Capsule, or mark the work accepted.

### UI Projection

- project header shows `Unsaved draft`;
- review actions include `Discard draft`;
- composer allows continuing from draft;
- saved project list may show draft marker.

### Tests And Evidence

- checkpoint records after successful mutation;
- no checkpoint after plan-only run;
- no checkpoint after failed edit;
- latest checkpoint is restart-readable;
- discard clears draft projection without corrupting saved version;
- save still requires explicit Review/Save path.

## Slice 5: Review Workspace Consolidation

### Purpose

Give users one clear place to inspect AI work and decide whether to save.

### User Outcome

After a draft exists, the right workspace shows preview, changes, source/check
evidence, and save/discard actions without duplicated controls or layout
collisions.

### Required Inputs

- DraftCheckpoint;
- EditAttempt;
- optional PreviewRun;
- optional CheckRun;
- ChangeExplanation;
- current ReviewState.

### Required Projection

```text
ReviewState
  project_id
  draft_checkpoint_id
  changed_files
  preview_status
  check_status
  change_explanation
  can_save
  can_discard
  blocking_reasons
```

### UI Rules

- One global workspace selector controls drawer mode.
- Drawer content should not duplicate the same selector unless it is local to a
  subview.
- Newest chat remains visible and is not hidden behind fixed composer/drawer
  layers.
- Static preview warning is compact and does not dominate the drawer.
- Save and discard actions are visible at review time.

### Tests And Evidence

- preview and changes are both reachable;
- no duplicate primary preview controls;
- drawer vertical divider does not move unless the drawer is selected/resized;
- latest chat is not obscured by composer;
- save/discard actions bind current draft only.

## Slice 6: CheckRun MVP

### Purpose

Add minimal verification evidence without opening arbitrary terminal authority.

### User Outcome

Builder can run one discovered or approved lint/build/test command, summarize
the result, and show whether work was checked, failed, or skipped.

### Required Inputs

- CommandProfile;
- ProgrammingRun;
- DraftCheckpoint or EditAttempt;
- user command approval, when required;
- bounded timeout and output budget.

### Required Facts

```text
CheckRun
  check_run_id
  project_id
  run_id
  command_profile_id
  command_display
  permission_decision_id?
  status
  exit_code?
  output_summary
  output_digest?
  failure_class?
  started_at_ms
  completed_at_ms
```

### MVP Command Policy

Allowed only through CommandProfile or explicit approval:

- lint;
- typecheck;
- unit test;
- build.

Denied in MVP:

- dependency installation;
- networked commands;
- long-running dev servers;
- arbitrary shell composed by provider output;
- destructive commands.

### UI Projection

- status: `Running check`;
- review shows `Checked`, `Failed`, or `Not checked`;
- failure summary is concise and actionable;
- full raw output stays main-owned or evidence-bound.

### Tests And Evidence

- command profile required unless explicit approval exists;
- denied destructive command;
- timeout handling;
- output summary truncation;
- failed check does not save version;
- skipped check creates explicit skip evidence.

### Current Implementation Checkpoint

The main-side fact chain now includes candidate- and checkpoint-bound execution
approval/admission, a temporary candidate workspace materializer, bounded
timeout/output/cancellation runner, immutable CheckRun v2 facts, SQLite store,
renderer-safe status projection, and a Save Version gate that re-reads current
raw CheckRun evidence while holding the candidate activity lock. A packaged
npm-compatible worker verifies the exact `package.json` lifecycle-script digest
before running only the approved main script through a pinned
`@npmcli/promise-spawn` runtime. The outer Electron/Node launcher remains
shell-disabled; the inner manifest script uses the platform shell explicitly
recorded by the CheckRun execution policy. Dependency installation and network
authority are not added, and a candidate snapshot without an available
dependency environment fails honestly instead of installing packages.
`builder-check-run-main-service.v1` provides the first main-only orchestration
contract across runtime resolution, one-shot approval/admission, candidate
materialization, execution, SQLite recording, cleanup fallback, and safe status
re-read without exposing IPC or renderer authority.
`builder-check-run-current-draft-service.v1` closes the next authority gap: the
renderer may identify only the current draft and a displayed CommandProfile.
Main replays the candidate conversation, re-reads the verified Git tree,
re-verifies the current DraftCheckpoint, derives a fresh candidate-bound
ProjectUnderstandingSnapshot, and only then invokes the CheckRun orchestrator.
The production composition is isolated behind
`builder-check-run-runtime-composition.v1` and a main-only process adapter. The
adapter accepts only the runner's shell-disabled process shape, tracks child
identity, and bounds cancellation to children it created.
Generation runtime now owns that composition and exposes only a main-only
current-draft service handle for a separate approval runtime. The first
`builder-check-run-approval-ipc-runtime.v1` contract accepts only current draft
and displayed CommandProfile identity, requires the active main frame,
coalesces repeated reads, rejects concurrent runs for the same draft, and
sanitizes fixed command labels plus CheckRun status projection. Electron main
now registers that runtime after generation and uses ordered asynchronous
shutdown: it removes CheckRun handlers, rejects new work, and waits for every
accepted bounded CheckRun to settle before generation runtime closes SQLite and
Git authorities. An unconfirmed drain stops shutdown before those authorities
close. Direct cancellation can remain a later optimization because the runner
already bounds timeout and process-tree termination. Preload and renderer do
now expose only the fixed current-draft availability and explicit approval
commands. The Review Workspace can run a discovered check and display its
bounded status without receiving a command line, raw output, runtime identity,
or process handle.

`builder-check-run-outcome-projection.v1` now closes the refresh/restart gap
between the stored terminal CheckRun and the active candidate registry. It
distinguishes verified `Not checked`, `Running checks`, a completed fixed-copy
result, and `Check status unavailable`. ReviewState consumes the same main-owned
read state, so an active check or failed status read blocks Save instead of
silently becoming an apparently saveable `Not checked` draft. The Task Stream
and renderer receive no CheckRun id, candidate id, digest, output, path, or Save
authority.

This checkpoint does not yet claim a complete desktop CheckRun workflow. Main
and renderer contracts, approval controls, status recovery, and packaged
verification assertions now exist. Explicit durable skip evidence, richer
environment-readiness projection, bounded diagnostic evidence for
FailureTriage, and a fresh real packaged release canary remain required before
Slice 6 is product-complete.

## Slice 7: Save Version And Restart Recovery Canary

### Purpose

Prove the draft can become a durable version only through explicit user review,
and prove the packaged app can recover after restart.

### User Outcome

The user saves a reviewed draft. After relaunch, the project, saved version,
draft status, and conversation continuity are coherent.

### Required Inputs

- ReviewState with `can_save=true`;
- current DraftCheckpoint;
- changed source tree;
- Git candidate creation result;
- SQLite Project Revision transaction.

### Required Facts

```text
SaveVersionReceipt
  project_id
  review_id
  draft_checkpoint_id
  git_commit_oid
  git_tree_oid
  parent_revision_id?
  project_revision_id
  selected_at_ms

RestartRecoveryCanaryResult
  package_id
  project_id
  project_revision_id
  draft_status
  conversation_status
  passed
```

### Authority

Only explicit Save Version can select a Project Revision. Check success,
preview success, provider output, hooks, draft checkpoint, or future agents
cannot silently save.

### Tests And Evidence

- save denied without current draft;
- save denied when ReviewState cannot save;
- Git candidate and SQLite receipt match;
- selected current revision restored after restart;
- draft discarded/saved status restored after restart;
- packaged canary covers the complete MVP loop.

## Cross-Slice Invariants

- Renderer never constructs provider prompts, source edits, CheckRun facts,
  Git candidates, or Project Revision receipts.
- Provider output never directly mutates source, Git, SQLite, permissions,
  preview, or revision state.
- Every mutating run has ExecutionApproval, ProgrammingRun, EditIntentPlan,
  WorkspaceGuardDecision, EditAttempt, and DraftCheckpoint evidence.
- Every saved version has explicit Review/Save evidence.
- Every command execution has CommandProfile or explicit approval.
- Every failure leaves the composer usable unless the app itself is restarting
  or blocked by an integrity failure.
- Post-MVP features cannot weaken the MVP permissions matrix.

## Slice Completion Checklist

Each slice is complete only when:

- pure contract tests pass;
- main-side service tests pass when a service exists;
- renderer-safe projection tests pass when UI consumes it;
- boundary tests prove no extra authority was added;
- `git diff --check` passes;
- focused packaged canary exists for user-visible behavior;
- documentation references the shipped behavior accurately.
