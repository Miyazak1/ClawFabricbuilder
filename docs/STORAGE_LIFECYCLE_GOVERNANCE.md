# Storage Lifecycle Governance

This document defines the lifecycle boundary for Builder product facts. It
answers a long-term product risk: SQLite can remain the authoritative fact
store, but it must not become an append-only black box that users cannot clean,
archive, export, or inspect.

## Authority Model

- SQLite remains the durable product authority for Project, Conversation, Turn,
  Task, Run, Candidate, Review, Permission, Artifact, and Project Revision
  facts.
- Git remains the durable code authority for source trees and saved project
  versions.
- JSONL, Markdown, Work Capsule manifests, exported bundles, static previews,
  logs, and session-tree mirrors are derived projections. They can improve
  transparency, portability, recovery, reuse, and Pi-like session tree
  ergonomics, but they must never become a second product authority.
- Compaction is context assembly for model prompting. It is not data deletion,
  retention, archival, or legal cleanup.

## Product Lifecycle Surfaces

Lifecycle surfaces should be scoped by product-level Builder Sessions and Tasks
wherever the user is managing continuing work. `conversation_id` remains a
replay fact, but archive, export, delete, fork, handoff, and retention need the
user-visible address semantics described in
[Builder Session and Task Address Architecture](BUILDER_SESSION_TASK_ADDRESS_ARCHITECTURE.md).

### Project Lifecycle

`Delete Project` must eventually operate on the full project scope:

- project metadata and workspace bindings;
- scoped Conversation, Task, Run, Candidate, Review, Permission, Artifact, and
  Revision references;
- generated draft/candidate metadata that is not retained by saved versions;
- internal `builder-projects-v2` project materialization when Builder owns it;
- derived JSONL/Markdown mirrors, preview snapshots, and projection caches.

Deletion must fail closed while any active, pending, retryable, or restoring
Run can still mutate the project. Deleting a project must not silently delete
external user-selected folders unless the product has an explicit, separate,
well-reviewed folder deletion authority.

### Conversation Lifecycle

Builder should support three distinct conversation operations:

- `Archive Conversation`: hide it from default UI while keeping SQLite facts and
  replay integrity intact.
- `Export Conversation`: replay SQLite facts into JSONL/Markdown or a portable
  bundle. Export is read-only and derived; it grants no authority to edit
  SQLite, Git, or project source.
- `Delete Conversation`: destructive scoped deletion inside one transaction.
  If saved Versions, Reviews, or audit-critical Project Revision facts depend on
  the conversation, deletion must either be blocked or first convert the
  required evidence into an archived audit snapshot with explicit product
  semantics.

## Cleanup Priority

Builder should clean derived and temporary data before authority data:

- preview cache and static preview snapshots;
- Task Stream projection caches;
- stale live-output buffers and generated display logs;
- failed unsaved drafts older than the retention policy;
- temporary restored draft materializations;
- JSONL/Markdown mirror files that can be regenerated from SQLite;
- package/build/canary temporary folders.

Authoritative Conversation, Review, Permission, and Project Revision facts are
the last thing to delete, and only through a scoped lifecycle command with
tests.

## Retention Policy

The first product policy should be conservative:

- saved Versions are retained by default;
- archived Conversations stay replayable unless the user explicitly deletes
  them;
- failed unsaved drafts older than a configured age, for example 30 days, may be
  eligible for cleanup;
- inactive projects may be suggested for archive after a configured age, for
  example 90 days, but not deleted automatically;
- destructive delete should offer export first when the scoped data is
  user-visible or needed for provenance.

Retention rules must be visible and reversible where possible. A hidden timer
must not delete saved work or audit-critical facts.

## SQLite Technical Rules

- All archive, export, and delete operations must use main-owned services.
  Renderer code cannot issue raw SQL, table names, ids to delete, filesystem
  paths, or retention predicates.
- Destructive operations must run inside explicit transactions with foreign-key
  checks enabled and tested.
- Active/pending Run checks must happen in the same authority path that performs
  deletion.
- Deletion should be followed by a bounded SQLite maintenance strategy:
  checkpoint WAL, incremental vacuum where configured, or explicit `VACUUM`
  only from a controlled maintenance command.
- Table-level cleanup must be replay-tested. A deleted or archived scope must
  not leave orphan rows that later project into Task Stream, History, Preview,
  or Permission UI.

## JSONL And Session Tree Mirrors

Pi-like JSONL session trees are useful as a user-readable and repairable layer:

- export current or archived conversations;
- repair or regenerate mirrors from SQLite replay;
- support future fork/clone/branch UX;
- make context snapshots inspectable without exposing private provider, Git, or
  credential facts.

They are still mirrors. If a JSONL file conflicts with SQLite, SQLite wins, and
the mirror is regenerated or marked stale.

## Work Capsule Lifecycle

Work Capsule starts as a local derived manifest over saved and reviewed work. It
summarizes Project Revision, Artifact Preview, Review Decision, verification,
public summary, remix metadata, and Session/Task Address references without
copying private source trees, credentials, provider envelopes, raw prompts, or
unredacted logs into a share surface.

A local capsule manifest may be regenerated from Git and SQLite authority. An
exported capsule package is user-owned output and needs explicit path, overwrite,
privacy, and stale-reference rules before materialization. Capsule cleanup must
therefore distinguish local derived manifests from exported files the user chose
to create.

## Delivery Order

1. Read-only export from SQLite replay to JSONL/Markdown.
2. Local Work Capsule manifest contract over saved reviewed results.
3. Archive Conversation and Archive Project UI filters.
4. Mirror and local capsule repair/regeneration command.
5. Retention report listing caches, failed drafts, archived items, and estimated
   reclaimable space.
6. Delete Conversation with dependency checks.
7. Delete Project with active-run checks and full scoped cleanup.
8. Optional maintenance command for WAL checkpoint and vacuum.

Current checkpoint: Builder now has a pure main-side storage lifecycle report
contract, `builder-storage-lifecycle-report.v1`, and the product metadata
database exposes a read-only `read_storage_lifecycle_report` method that derives
its counts from SQLite project rows, revision receipts, and canonical
conversation replay. It accepts only sanitized derived-storage byte totals and
retention policy values from the caller, then returns deterministic read-only
recommendations for export, archive, delete preflight, derived cleanup, and
SQLite maintenance. The report deliberately performs no SQLite delete, VACUUM,
derived cleanup, export materialization, provider dispatch, source mutation, Git
mutation, renderer authority, or credential access. Active runs block
destructive recommendations, pending unsaved candidates block project deletion,
saved-version conversation dependencies block conversation deletion, and project
deletion remains an explicit future confirmation path rather than automatic
cleanup.

Builder also has a pure read-only conversation export contract,
`builder-conversation-export.v1`. It accepts a `conversation_loaded` result from
the metadata authority, replays the canonical events, and produces in-memory
JSONL plus Markdown text as derived mirrors. It strips Git candidate receipts and
internal provider/source details from the exported surface. It does not write the
mirror to disk, mutate SQLite or Git, materialize an export bundle, or grant
renderer export authority. A later main-owned export service may persist these
derived mirrors after adding path, overwrite, active-run, and package evidence.

The Work Capsule manifest slice follows the same read-only posture:
`builder-work-capsule-manifest.v1` references existing Git and SQLite facts,
produces an in-memory Local Work Capsule Manifest, writes no file, publishes
nothing, and grants no renderer, network, source, Git, Save, delete, or
community authority. A later materialization service must still add explicit
path, overwrite, stale-reference, active-run, privacy, and package evidence
before writing exportable capsule files.

The first destructive delete feature must ship with replay, foreign-key,
active-run, export-before-delete, and package/canary evidence.
