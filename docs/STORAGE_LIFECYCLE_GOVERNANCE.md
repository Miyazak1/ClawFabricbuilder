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
- JSONL, Markdown, exported bundles, static previews, logs, and session-tree
  mirrors are derived projections. They can improve transparency, portability,
  recovery, and Pi-like session tree ergonomics, but they must never become a
  second product authority.
- Compaction is context assembly for model prompting. It is not data deletion,
  retention, archival, or legal cleanup.

## Product Lifecycle Surfaces

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

## Delivery Order

1. Read-only export from SQLite replay to JSONL/Markdown.
2. Archive Conversation and Archive Project UI filters.
3. Mirror repair/regeneration command.
4. Retention report listing caches, failed drafts, archived items, and estimated
   reclaimable space.
5. Delete Conversation with dependency checks.
6. Delete Project with active-run checks and full scoped cleanup.
7. Optional maintenance command for WAL checkpoint and vacuum.

The first destructive delete feature must ship with replay, foreign-key,
active-run, export-before-delete, and package/canary evidence.
