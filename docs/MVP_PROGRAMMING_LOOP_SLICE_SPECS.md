# MVP Programming Loop Slice Specs

This document breaks the MVP Programming Loop Implementation Spec into
engineering slices. Each slice must be independently testable, release-gated,
and compatible with Builder's existing main-owned authority model.

The slices are ordered. Later slices may prepare contracts early, but visible
product behavior should not skip ahead of the loop.

## Current Closure State

The foundational loop is not product-complete just because the core generation
and verification tests pass. The current implementation has meaningful
foundation pieces: main-owned conversation events, runtime/tool facts,
automatic Draft Checkpoints, CheckRun evidence, draft continuation, and
candidate-to-current workspace materialization. The remaining closure work is
primarily experience and product-history hardening:

- automatic materialization is now restart-durable and visible as project-folder
  synchronization state; that guarantee must remain covered by the packaged
  Harness UI canary;
- local Git state should be understandable as product history, not only as
  internal candidate/revision evidence;
- context management has two owners that must not be conflated: DeepSeek
  Harness owns token-pressure compaction inside one admitted runtime session,
  while Builder owns bounded cross-run context checkpoints, disclosure, replay,
  and stale-state tests;
- packaged canaries should cover the user-facing loop, including continued
  unsaved-draft work, recovery, and reload behavior.

Treat these as coding-loop completion criteria, not post-loop polish.

Current UI closure evidence:

- Task activity now exposes candidate-to-current materialization as a public
  `Project folder updated` or sync-attention row without Git receipts.
- Source files in the side workspace have dedicated file-content and file-tree
  scroll regions, so long Markdown/source previews do not depend on page-level
  scrolling.
- Natural Chinese plan deliverables such as `实施计划`, `优化方案`, and
  `重构方案` route directly to Plan while artifact names such as `计划管理页面`
  and `方案展示页` still route to Build.
- The side workspace now calls this surface `History`, separates current work
  from optional milestone Versions, and is available for an unsaved-only local
  project before its first Version exists.
- A verified current checkpoint appears as `Automatic recovery` with a direct
  Undo action backed by the existing main-owned previous-checkpoint command.
  The row exposes no Git/SQLite receipt or renderer-selected checkpoint id.
- The packaged Harness UI gate opens History after restart and verifies current
  recovery visibility, enabled Undo, horizontal layout bounds, and screenshot
  pixel variation before continuing through external-conflict-safe Undo.
- Builder cross-run context checkpoints now have main-side
  contract/store/recording-service foundations: successful SQLite conversation
  appends can best-effort derive a bounded summary, the summary store is
  restart-readable, and Working Context State can project the latest summary
  ref without making it executable. This is not the active runtime's compaction
  engine.
  A summary body that has passed the compaction-summary contract can now enter
  provider-context assembly as a `compaction_summary` candidate segment, while
  provider prompt egress still depends on the disclosure gate.
  Store/projection tests now cover restart-readable latest summary replay and
  same-conversation sibling task isolation, so another task's newer summary
  cannot silently become the current task's provider-context candidate.
  Latest-summary selection now prefers the widest recorded event window before
  write time, so a delayed older compaction window cannot supersede a broader
  current-window summary.
- The configured DeepSeek Harness runtime remains the sole owner of automatic
  in-run compaction. It measures actual token pressure at `thresholdRatio: 0.8`,
  optionally prunes oversized tool results, retains a recent balanced tail, and
  commits a durable replacement summary. Builder now accepts the required
  `compaction/prune`, `compaction/start`, `compaction/summary`, and
  `compaction/end` events plus their historical surface replacements without
  publishing private summary text as chat activity.
- Builder's cross-run projection no longer materializes the complete 4 MiB
  JSONL/Markdown export. A bounded replay projection retains the newest 32
  public entries, digests omitted history, and has source coverage at 1,020
  events with more than 4 MiB of public transcript text.
- A deterministic packaged-runtime gate now forces real token pressure through
  provider-reported usage and a bounded 20k canary context. The bundled Harness
  emits exactly one `compaction/start`, block-array `compaction/summary`,
  replacement `user/message`, and `compaction/end`, then continues the normal
  edit/check/repair loop. Builder keeps the private summary out of the canonical
  chat journal: the compacted and default packaged loops both finish with 38
  canonical events and two public assistant deltas. The gate also caught and
  fixed the real SDK's explicit `surfaceOp: "append"` union shape.
- The full packaged Harness UI canary now proves consecutive unsaved Build
  turns, physical candidate materialization, restart recovery, checkpoint undo,
  external-workspace conflict refusal, conflict recovery, continued work after
  restart, cancellation, stale-edit recovery, unsupported-tool recovery, and
  unchanged-work handling with a real provider. The canary also opens a runtime
  file from chat and then verifies that Files resumes the replacement current
  draft rather than remaining pinned to the old runtime snapshot.
- Restart reconstruction now retains the durable `current_materialization`
  projection. Checkpoint undo compares the physical workspace against the
  verified candidate proof digest, so an external edit is rejected with
  `builder_generation_workspace_changed` instead of being collapsed into a
  generic generation failure.

Still open:

- local Git history still needs a bounded, main-projected automatic checkpoint
  timeline and selectable restore semantics beyond current-work Undo and saved
  milestone cards;
- materialization and recovery conflicts need clearer user-facing inspection and
  repair affordances even though their release-path durability is now covered.

Builder cross-run summary egress remains separately disclosure-gated; its
event-count cadence is only a projection checkpoint frequency, never an in-run
compaction trigger.

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

- Composer `+` menu exposes manual `Ask mode`, `Plan mode`, and `Build mode`.
- `Ask mode` and `Build mode` are persistent until the user changes mode or
  closes the chip; `Plan mode` is one-shot and clears after the plan request is
  admitted.
- Active composer mode appears as a removable chip; closing it returns the
  composer to Auto routing.
- Chat timeline shows the plan proposal and an execution affordance such as
  `Apply plan`.
- If no project is selected, the plan is clearly chat-only and cannot be
  executed as source work.

### Tests And Evidence

- explicit `Plan mode` chip sends a request;
- persistent `Ask mode` and `Build mode` override automatic intent detection
  without bypassing read-only or write-approval gates;
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

- real read/search actions appear as correlated tool rows; discovery itself
  does not create a fixed `Reading project` sentence;
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

- timeline: model-authored public explanation followed by real edit facts;
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
renderer-safe current-work phase. The chat flow uses it only for an
unobtrusive temporary loading indicator before model narration or a real action
exists; fixed lifecycle sentences do not become chat history. Active CheckRun
work now joins the same projection from
the main-owned candidate activity registry, so a completed generation can show
`Running checks` while its current candidate is being verified. The registry
publishes only a bounded refresh hint; commands, output, paths, and runtime
handles remain private. This projection is read-only and grants no provider,
tool, source, command, Git, SQLite, permission, or Save authority.

The normal chat projection now owns the Codex-like live work narrative. The
stable Agent Activity phase and pending safe Tool statuses remain visible while
a Run is active. Matching Tool request/result pairs keep one stable row and
update its verb, icon, and state in place. When the Run records its terminal
outcome, settled process rows fold into a separate closed run-history disclosure
before the final response; expanding it restores the prior action order. The
final response does not own a generic `Work details` block. Admitted file-change
and CheckRun facts remain separate typed rows after the response and open the
matching read-only inspectors. A single fact is not collapsible; only multiple
facts of the same type may form an expandable group. Generic Agent Step receipts and provider
request lifecycle phases are temporary status inputs, not completed work
history. Run admission/control records, context snapshots, brief memory, and raw
evidence remain outside the user-facing projection.

Ephemeral provider text follows a narrower display contract. Ask may stream only
the decoded `explanation` field; Harness Build may stream only public assistant
text blocks and keeps reasoning separate. Structured Build and Plan never expose
their operation/proposal JSON as chat text. Completed Harness text is persisted
as a Task Stream assistant message, while an exact duplicate terminal summary is
shown once. The renderer buffers deltas outside the page state tree and commits
no more than one local message update per animation frame. The live message node
remains stable, and chat follows it only while the reader is near the bottom.

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
- no-check/skip evidence remains main-owned and is not exposed as a routine
  user button.

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
commands. The Review Workspace displays the automatically selected check status
without receiving a command line, raw output, runtime identity, or process
handle.

`builder-check-run-outcome-projection.v1` now closes the refresh/restart gap
between the stored terminal CheckRun and the active candidate registry. It
distinguishes verified `Not checked`, `Running checks`, a completed fixed-copy
result, and `Check status unavailable`. ReviewState consumes the same main-owned
read state, so an active check or failed status read blocks Save instead of
silently becoming an apparently saveable `Not checked` draft. The Task Stream
and renderer receive no CheckRun id, candidate id, digest, output, path, or Save
authority.

Skip/no-check evidence remains a durable candidate-bound decision, not a
renderer-only convenience or a routine user-facing button.
`builder-check-skip-decision.v1`,
`builder-check-skip-decision-store.v1`, and
`builder-check-skip-current-draft-service.v1` record/replay the owner decision
only after main verifies the current candidate, active activity guard, absence
of a CheckRun for that candidate, and the current DraftCheckpoint. The
CheckRun status service, ReviewState, SaveGate, IPC adapter/runtime, preload,
renderer port, and Review Workspace all consume the same fixed `skipped`
projection. Save admission may therefore allow a verified no-check decision
while still blocking a merely unchecked draft.

The latest packaged release checkpoint also proves the desktop CheckRun path:
`verify:release` runs lint, unit tests, boundary tests, package verification,
packaged launch smoke, the packaged provider canary, and the packaged
Plan-mode/mode-switching canary. The canaries cover a discovered `npm test`
check, main-selected CommandProfile approval, packaged runtime execution,
visible CheckRun status, Save gate behavior, restart recovery, hidden internal
evidence, persistent Ask/Build modes, one-shot Plan mode, whole-sentence
semantic plan routing, approved-plan execution into an unsaved draft, and
continuing that draft without forcing Save Version.

`builder-check-failure-triage.v1` now adds the first bounded diagnostic bridge
for failed CheckRun records. It consumes only an already verified CheckRun,
binds the triage to the current candidate/draft/check digest, classifies the
fixed failure class into a repairable/user-action bucket, and records a bounded
next-action hint without raw output, source reads, provider dispatch, command
execution, Git/SQLite writes, Save authority, IPC, or renderer authority.

Remaining Slice 6 gaps are narrower: richer environment-readiness projection,
FailureTriage persistence/projection, explicit cancellation controls, and
repair-loop input remain later checkpoints.

## Slice 7: Undo, Optional Milestone, And Restart Recovery Canary

### Purpose

Prove the current working state can continue without a Version action, can be
restored through a durable checkpoint, and can recover after packaged restart.
Also retain an optional formal milestone path.

### User Outcome

The user completes consecutive coding turns, restores a checkpoint, and
relaunches. The project working state, checkpoint history, optional milestone
history, and conversation continuity are coherent.

### Required Inputs

- current DraftCheckpoint;
- changed source tree;
- conversation boundary for the checkpoint;
- Git/snapshot restore result;
- optional Git candidate and SQLite Project Revision transaction when the
  milestone path is exercised.

### Required Facts

```text
RestoreReceipt
  project_id
  conversation_id
  draft_checkpoint_id
  restored_source_ref
  conflict_state
  restored_at_ms

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

Only checkpoint/restore authority may change working recovery state. A formal
Version remains optional and cannot be silently marked by check success,
preview success, provider output, hooks, or future agents.

### Tests And Evidence

- a second Build turn succeeds without a Version action;
- restore denied without a current valid checkpoint;
- restore detects newer external file changes;
- restored file state and conversation boundary match;
- optional Git candidate and SQLite milestone receipt match;
- working state and checkpoint history restore after restart;
- packaged canary covers the complete MVP loop.

## Cross-Slice Invariants

- Renderer never constructs provider prompts, source edits, CheckRun facts,
  Git candidates, or Project Revision receipts.
- Provider output never directly mutates source, Git, SQLite, permissions,
  preview, or revision state.
- Every mutating run has ExecutionApproval, ProgrammingRun, EditIntentPlan,
  WorkspaceGuardDecision, EditAttempt, and DraftCheckpoint evidence.
- Every optional milestone Version has explicit milestone evidence.
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
