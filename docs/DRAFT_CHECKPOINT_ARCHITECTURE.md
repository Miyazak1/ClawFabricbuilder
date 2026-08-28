# Draft Checkpoint Architecture

## Decision

Builder should not require a formal `Save version` after every AI edit. A
mutating AI turn should create an automatic local Draft Checkpoint that the
user can compare, restore, discard, or continue from. A formal Version is an
optional milestone that may reference a stable checkpoint; it is not required
to continue coding.

Draft Checkpoint is therefore an undo and recovery layer, not a replacement for
workspace authority, conflict detection, or optional Project Revision receipts.

It is also not the boundary that decides when chat should summarize a coherent
step. Work Step summaries explain recorded progress; Draft Checkpoints preserve
recoverable source state. See
[Codex-Like Conversation Flow Architecture](CODEX_LIKE_CONVERSATION_FLOW_ARCHITECTURE.md).

## Product Meaning

User-facing language:

- `Checkpoint saved`
- `Restore`
- `Compare`
- `Continue from here`
- `Mark version` when a milestone is useful

Avoid exposing staging, git add, branch refs, receipt digests, or internal
snapshot terms to ordinary users.

The desired loop is:

```text
AI changes the project
-> Builder saves a draft checkpoint automatically
-> User previews, compares, asks for changes, or restores
-> User optionally marks a version when the work is a real milestone
```

This keeps the ordinary loop fluid while preserving recovery and optional
milestone history.

## Boundary With Project Versions

A Draft Checkpoint may prove that Builder can recover a candidate work state,
but it must not claim any of these facts by itself:

- current Project Revision;
- accepted Review decision;
- published or shared work;
- final milestone;
- permission grant;
- external side effect;
- test or verification success unless a separate check fact exists.

The current working state does not wait for a Version action. Creating a formal
Version records milestone metadata and durable revision lineage over an already
stable checkpoint; it does not authorize the next coding turn.

## Fact Shape

The minimum durable product fact is:

```text
DraftCheckpoint
  project_id
  session_id
  task_id
  turn_id
  run_id
  candidate_ref_or_snapshot_ref
  base_revision_ref
  created_at_ms
  summary
  source_scope
  restore_state
  verification_summary
  lifecycle_state
```

The fact should be stored in SQLite as product metadata. Source bytes should
stay in Git candidate objects or a future internal snapshot store, not in the
checkpoint row.

## Candidate Ref Versus Snapshot Store

Near term, Builder should prefer existing Git candidate evidence:

- AI mutating turns already create reviewable candidate source states.
- Git stores source bytes efficiently and content-addresses them.
- restart recovery already verifies candidate evidence.
- a checkpoint can reference candidate refs without introducing another source
  database.

A separate internal snapshot store may be added later only if Git candidate refs
cannot support reliable undo history, partial restore, or high-frequency draft
checkpoint cleanup. If added, it must remain internal and must not replace
Project Revision authority.

## Lifecycle

Draft Checkpoints are durable enough for undo and restart recovery, but they are
not permanent history.

Lifecycle states:

- `active` - latest checkpoint for the current draft path.
- `superseded` - replaced by a newer draft checkpoint.
- `restored` - used as the base for a new candidate or draft.
- `promoted` - its candidate was saved as a Project Revision.
- `discarded` - user discarded the draft path.
- `expired` - retention cleanup removed restore eligibility.

Cleanup must keep any checkpoint required by an active draft, pending run,
recent restore window, saved revision lineage, or visible History/Review item.
Destructive cleanup must fail closed if the related Run is active or pending.

## UI Placement

Automatic checkpoints are recovery facts, not chat milestones. Do not append a
checkpoint card after each AI edit. The current workspace/history controls may
show compact recovery availability without full Git details:

```text
Recovery available
History: [Compare] [Restore]
History menu: [Mark version]
```

The contextual workspace can show source diff, preview, and verification
details for the selected checkpoint. Expandable work details remain in the
conversation. History should separate formal saved
versions from automatic checkpoints so users do not confuse every AI edit with
a milestone.

## Interaction Rules

- A successful mutating Run creates or refreshes a Draft Checkpoint before the
  UI claims the draft is recoverable.
- Failed Runs may create failure recovery facts, but not a successful
  checkpoint unless there is verified candidate source to restore.
- Restore creates a new draft path or candidate. It does not rewrite old
  checkpoints or old Project Revisions.
- Compare reads checkpoint evidence and source diff through main-owned
  adapters.
- Continue from a checkpoint uses that checkpoint as bounded context and base
  evidence for the next Run.
- Saving a version marks the relevant checkpoint as `promoted`, but the saved
  Project Revision remains the authority.

## Minimum Implementation Slices

1. Documentation decision and roadmap gate.
2. Pure main-side `builder-draft-checkpoint.v1` contract.
3. Main-only SQLite Draft Checkpoint store with restart-safe replay and
   retention-safe listing.
4. Main-side service that records a checkpoint from verified candidate evidence
   after a mutating Run.
5. Read-only task stream projection: latest checkpoint status and actions.
6. Restore/Compare actions through existing review and revision gates.
7. Retention cleanup integrated with storage lifecycle governance.

Current checkpoint: `builder-draft-checkpoint.v1` now exists as a pure
main-side contract. It creates deterministic Draft Checkpoint facts only from a
verified Git candidate receipt pair, session id, task address id, base revision
ref, source scope, bounded public summaries, and a candidate-bound successful
`builder-edit-attempt.v1` reference. It writes no Git ref, performs no Save,
selects no Project Revision, opens no IPC/preload surface, dispatches no
provider/tool, mutates no source, publishes nothing, and creates no Work
Capsule.

Current store checkpoint: `builder-draft-checkpoint-store.v1` now persists those
already-validated Draft Checkpoint facts in a main-owned SQLite store with
idempotent replay, restart-safe reads, latest-checkpoint lookup for a Task
Address, and bounded ordered listing. It still opens no IPC/preload surface,
writes no Git ref, performs no Save, selects no Project Revision, dispatches no
provider/tool, mutates no source, publishes nothing, and creates no Work
Capsule.

Current recording service checkpoint:
`builder-draft-checkpoint-recording-service.v1` now records a Draft Checkpoint
from verified candidate evidence into the main-owned store, reads it back,
confirms the latest checkpoint for the Task Address, and returns bounded
evidence for restart-safe recovery. It is still a pure main-side service: no
IPC/preload surface, no renderer-owned facts, no provider/model/tool dispatch,
no source write, no Git mutation, no permission grant, no Review decision, no
Save, no Project Revision selection, no publication, and no Work Capsule
creation. Runtime generation now calls this service only after Workspace Guard,
successful EditAttempt creation, Git candidate persistence, and Git candidate
verification. The service can now prepare the previous logical checkpoint for
the current Task Address, including repeated backward traversal after a prior
restore.

Current status projection checkpoint:
`builder-draft-checkpoint-status-projection.v1` turns a verified latest/read
store result into renderer-safe copy such as `Checkpoint saved`, compare/restore
availability, changed-file count, and verification status. It exposes no
checkpoint id, candidate id, digest, commit, tree, source, SQLite schema, Git
evidence, provider data, permission grant, Save authority, publish authority, or
Work Capsule authority. Task Stream can carry this projection as optional
read-only status. Automatic recording from mutating Runs is active. A direct
Undo action now submits only the pending `draft_id`; Electron main supplies the
selected Project, resolves the previous checkpoint, verifies Git evidence, and
either returns to the Project baseline or creates a new recoverable draft.
Compare, arbitrary checkpoint selection, and redo remain separate gates.
External workspace changes are already rejected visibly before materialization,
and the recoverable current draft is retained.

Current timeline projection checkpoint (2026-08-20):
`builder-draft-checkpoint-timeline-projection.v1` turns the main-owned bounded
Task Address checkpoint list into a newest-first renderer-safe timeline. It
projects at most 12 entries and exposes only checkpoint sequence, creation time,
fixed product copy, changed-file count, verification status, and whether an
entry represents current work. It does not expose checkpoint ids, candidate
ids, task/session/conversation ids, Git OIDs, source digests, SQLite evidence,
raw checkpoint summaries, restore authority, Save authority, or publication
authority. The Automatic Checkpoint Service returns this timeline only when the
latest stored candidate still matches the current unreviewed candidate; Task
Stream and the renderer sanitize it again at their own boundaries.

Current materialization checkpoint: verified mutating candidates can now be
projected back into the selected project workspace immediately after Conversation
candidate admission. Generation reads the candidate's Git-recorded workspace
base digest and calls the main-owned current projection gate with a CAS
workspace expectation. Success updates the Git main ref and materialized
worktree; conflicts or unavailable projection are recorded as non-fatal draft
materialization status so the verified candidate and automatic checkpoint remain
recoverable. This does not create a formal Project Revision, does not mark Save
complete, and does not remove the review/version milestone boundary.

Current durable materialization-status checkpoint: Conversation candidate
completion now records the bounded `current_materialization` status beside the
candidate result. Conversation record validation, replay, Task Stream
projection, renderer snapshot sanitization, and the activity timeline all carry
that status as renderer-safe copy. Old candidate records without this field are
treated as `not_recorded`; pending drafts restored from older conversation
proofs remain recoverable with a legacy `not_attempted` materialization reason.
This closes the reload/replay visibility gap for whether the current project
folder was updated, while still leaving local Git history UX and automatic
conversation compaction as separate follow-up slices.

Current recovery UI checkpoint: the History workspace distinguishes saved
milestones from active unsaved work. It shows the current automatic recovery
point with direct Undo, followed by a compact visual timeline of earlier
automatic checkpoints and then optional milestone Versions. Earlier timeline
rows are currently read-only. A selected-checkpoint restore must remain a
main-owned write command: the renderer may submit only the public checkpoint
sequence, and Electron main must re-resolve the current Project, Task Address,
candidate, checkpoint, Git receipt, workspace expectation, and write admission
before replacing current work. That command is intentionally not enabled until
the user explicitly authorizes its workspace-writing semantics.

The packaged Harness UI canary proves two consecutive Build checkpoints without
Save Version, restart restoration, current recovery visibility, at least one
earlier timeline entry, bounded History layout, a nonblank screenshot,
conflict-safe Undo, restoration of the prior source, and continuation after
Undo. Its independent strict canary sanitizer accepts the timeline only through
the same main projection contract.

## Non-Goals

- no automatic formal Project Revision save;
- no background autonomous experiment branch;
- no hidden token-running work;
- no public sharing, export, or Work Capsule creation;
- no renderer-owned checkpoint facts;
- no direct filesystem snapshot controlled by the renderer;
- no replacement for Git/SQLite authority.

## Relationship To Other Architecture

Draft Checkpoints preserve the current working lineage. A formal Project
Revision is an optional branch from a stable checkpoint:

```text
Run
-> Candidate
-> Draft Checkpoint
-> Continue / Undo / Restore
-> Optional Review
-> Optional Mark version
-> Project Revision milestone
```

Working Context State may refer to the latest Draft Checkpoint as current work
context, but it cannot make the checkpoint current source authority.

Work Capsule may initially require a reviewed Project Revision milestone. That
publication policy does not make Version creation part of the ordinary coding
loop.

Storage Lifecycle must treat Draft Checkpoints as cleanup-managed product facts:
export/archive may include them for local recovery, while public export and
share surfaces should default to explicitly marked milestone Versions only.
