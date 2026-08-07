# Draft Checkpoint Architecture

## Decision

Builder should not require a formal `Save version` after every AI edit. A
mutating AI turn should create an automatic local Draft Checkpoint that the
user can compare, restore, discard, or continue from. `Save version` remains
the explicit milestone action that promotes reviewed work into a Project
Revision.

Draft Checkpoint is therefore an undo and recovery layer, not a replacement for
Review, Git authority, or Project Revision receipts.

## Product Meaning

User-facing language:

- `Checkpoint saved`
- `Restore`
- `Compare`
- `Continue from here`
- `Save version`

Avoid exposing staging, git add, branch refs, receipt digests, or internal
snapshot terms to ordinary users.

The desired loop is:

```text
AI changes the project
-> Builder saves a draft checkpoint automatically
-> User previews, compares, asks for changes, or restores
-> User saves a version only when the work is a real milestone
```

This keeps the ordinary loop fluid while preserving explicit review before a
verified version becomes current.

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

`Save version` remains the only ordinary path that records an accepted candidate
as the selected Project Revision and projects it to the current worktree.

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

Chat should show compact checkpoint status, not full Git details:

```text
Checkpoint saved
[Compare] [Restore] [Save version]
```

The Artifact workspace can show source diff, preview, logs, and verification
details for the selected checkpoint. History should separate formal saved
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
main-side contract. It creates deterministic in-memory Draft Checkpoint facts
only from a verified Git candidate receipt pair, session id, task address id,
base revision ref, source scope, and bounded public summaries. It records no
SQLite row, writes no Git ref, performs no Save, selects no Project Revision,
opens no IPC/preload surface, dispatches no provider/tool, mutates no source,
publishes nothing, and creates no Work Capsule.

Current store checkpoint: `builder-draft-checkpoint-store.v1` now persists those
already-validated Draft Checkpoint facts in a main-owned SQLite store with
idempotent replay, restart-safe reads, latest-checkpoint lookup for a Task
Address, and bounded ordered listing. It still opens no IPC/preload surface,
writes no Git ref, performs no Save, selects no Project Revision, dispatches no
provider/tool, mutates no source, publishes nothing, and creates no Work
Capsule.

Current status projection checkpoint:
`builder-draft-checkpoint-status-projection.v1` turns a verified latest/read
store result into renderer-safe copy such as `Checkpoint saved`, compare/restore
availability, changed-file count, and verification status. It exposes no
checkpoint id, candidate id, digest, commit, tree, source, SQLite schema, Git
evidence, provider data, permission grant, Save authority, publish authority, or
Work Capsule authority. Task Stream can carry this projection as optional
read-only status, but automatic recording from mutating Runs and UI restore or
compare actions remain separate future gates.

## Non-Goals

- no automatic formal Project Revision save;
- no background autonomous experiment branch;
- no hidden token-running work;
- no public sharing, export, or Work Capsule creation;
- no renderer-owned checkpoint facts;
- no direct filesystem snapshot controlled by the renderer;
- no replacement for Git/SQLite authority.

## Relationship To Other Architecture

Draft Checkpoints sit between Candidate and Project Revision:

```text
Run
-> Candidate
-> Draft Checkpoint
-> Review
-> Save version
-> Project Revision
```

Working Context State may refer to the latest Draft Checkpoint as current work
context, but it cannot make the checkpoint current source authority.

Work Capsule may only reference saved, reviewed Project Revisions. A Draft
Checkpoint is not a Work Capsule input until it is promoted through Review and
Save.

Storage Lifecycle must treat Draft Checkpoints as cleanup-managed product facts:
export/archive may include them for local recovery, while public export and
share surfaces should default to saved versions only.
