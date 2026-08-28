# Builder Worktree And Workspace Lifecycle Policy - 2026-08-26

Date: 2026-08-26

Status: product and runtime architecture proposal. This document is a design
decision record, not implementation evidence.

Related documents:

- [Builder Sandbox Settings And Runtime Policy Plan](BUILDER_SANDBOX_SETTINGS_AND_RUNTIME_POLICY_PLAN_2026_08_26.md)
- [Builder Runtime Readiness And Agent Environment Research](BUILDER_RUNTIME_READINESS_AGENT_ENVIRONMENT_RESEARCH_2026_08_26.md)
- [Builder Session And Task Address Architecture](BUILDER_SESSION_TASK_ADDRESS_ARCHITECTURE.md)
- [Draft Checkpoint Architecture](DRAFT_CHECKPOINT_ARCHITECTURE.md)
- [Side Workspace Architecture](SIDE_WORKSPACE_ARCHITECTURE.md)
- [Storage Lifecycle Governance](STORAGE_LIFECYCLE_GOVERNANCE.md)
- [Lifecycle Hooks Architecture](LIFECYCLE_HOOKS_ARCHITECTURE.md)

## Decision

Builder should treat worktrees and task workspaces as visible, manageable
project resources. They are not merely temporary folders hidden behind the
runtime.

The product should show where task work happens, which Task or Session owns a
workspace, whether it can be restored, and whether it is eligible for cleanup.
Cleanup must be governed by explicit lifecycle policy and recovery evidence,
not by deleting directories opportunistically.

## Product Reference

A Codex Worktrees settings screen reviewed on 2026-08-26 groups these controls
in one resource management surface:

- worktree root directory;
- whether to fetch upstream changes before creating a new worktree;
- whether old worktrees are automatically deleted;
- an automatic deletion limit;
- per-project worktree cards;
- an action to start a new chat in a selected worktree;
- deletion of a selected worktree;
- associated conversation display.

The useful lesson is that worktree state is part of the user-visible operating
model. Users need to know which isolated copy a task used, whether it is still
linked to a conversation, and how cleanup interacts with recovery.

## Product Model

Builder should expose a `Workspaces` or `Worktrees` settings area that answers:

- Where does Builder create task workspaces?
- Which Project does each workspace belong to?
- Which Session, Task, Run, candidate, check, or preview references it?
- Can a new Task start from this workspace?
- Can the workspace be deleted safely?
- If deleted, what recovery evidence remains?
- Is the source fresh relative to the upstream repository?
- Does the admitted check workspace have dependency access?

The user-facing hierarchy should be:

```text
Project
-> Workspace or Worktree
  -> Session
    -> Task
      -> Run
        -> Candidate / Check / Preview / Command
```

Project remains the file and permission boundary. A Workspace or Worktree is
the physical or virtual execution surface used by one or more product facts.

## Workspace Classes

Builder should distinguish these workspace classes:

| Workspace class | Purpose | User visibility | Cleanup policy |
| --- | --- | --- | --- |
| Project source root | User-selected source directory | visible as Project location | never auto-delete |
| Task worktree | isolated project copy for a Session or Task | visible in Workspaces settings | cleanup only when unpinned and recoverable |
| Candidate workspace | generated source state before save/review | visible through Task/Review/History | cleanup after checkpoint or review retention |
| Check workspace | materialized source used by checks | diagnostic visibility | cleanup after check result and output retention |
| Command workspace | guarded temporary workspace for approved command | diagnostic visibility | cleanup after process settlement |
| Dependency workspace | prepared install/cache bound to lockfile digest | visible in dependency diagnostics | cleanup by cache policy and revocation |
| Preview workspace | source or URL surface for preview/dev-server | visible through Preview status | cleanup after preview stop and evidence capture |
| Browser profile | user web session storage | Browser settings visibility | browser policy, not command cleanup |

These classes may share storage roots, but they must not share authority
semantics. Deleting a Check workspace is not the same as deleting a Task
worktree. Clearing a Browser profile is not the same as cleaning a command
workspace.

## Worktree Root Settings

Builder should support a configurable managed root for task worktrees:

```text
Builder Worktree Root
  root_path
  storage_policy_version
  owner_user_id
  created_at_ms
  disk_usage_projection
  health_status
```

Rules:

- The default root should live under Builder-managed application data.
- A custom root requires explicit user selection and path validation.
- The root must not be inside an active Project source root unless explicitly
  allowed by a future advanced policy.
- The renderer may display a redacted or user-approved path, but it must not
  receive cleanup authority from a displayed path.
- Worktree root changes affect future workspaces only unless a separate
  migration action is approved.

## Task Worktree Record

Suggested durable record:

```ts
type BuilderTaskWorkspaceV1 = Readonly<{
  record_version: "builder-task-workspace.v1";
  workspace_id: string;
  project_id: string;
  session_id: string | null;
  task_address_id: string | null;
  workspace_class: "task_worktree" | "candidate" | "check" | "command" | "dependency" | "preview";
  display_name: string;
  lifecycle_state:
    | "active"
    | "idle"
    | "pinned"
    | "cleanup_eligible"
    | "cleanup_blocked"
    | "cleanup_pending"
    | "deleted"
    | "recovery_only";
  source_base: {
    kind: "project_root" | "git_revision" | "draft_checkpoint" | "candidate";
    reference: string;
  };
  git_freshness:
    | "fresh"
    | "behind"
    | "ahead"
    | "diverged"
    | "unknown"
    | "not_applicable";
  dependency_state:
    | "not_checked"
    | "not_required"
    | "prepared"
    | "missing"
    | "stale"
    | "approval_required";
  recovery_ref: string | null;
  created_at_ms: number;
  last_used_at_ms: number;
  expires_at_ms: number | null;
}>;
```

The public projection may show display name, Project, associated Task or
conversation, lifecycle state, freshness, dependency status, and safe actions.
It must not show raw private paths, Git internals, process handles, sandbox
tokens, provider credentials, or Electron partitions.

## Association Rules

A workspace may be associated with:

- one Project;
- one current Session or Task owner;
- many historical Runs, candidates, checks, or previews;
- one recovery checkpoint chain;
- zero or one active command or dev-server process.

Rules:

- A Task may start in the Project source root only when policy explicitly allows
  direct source work.
- A Task worktree can start a new chat or Task when it is idle, recoverable, and
  still bound to the same Project.
- A workspace with an active Run, pending Review, active command, active preview
  server, or missing checkpoint is not cleanup eligible.
- A workspace can be detached from a Task only after a recovery manifest is
  recorded or the user explicitly discards unrecoverable state.
- A deleted workspace record remains as `recovery_only` when restoration is
  possible through checkpoint, Git candidate, or saved revision evidence.

## Git Freshness Policy

Fetching upstream updates is a source freshness operation, not a generation
side effect.

Builder should model these project-level choices:

| Policy | Meaning |
| --- | --- |
| `never_fetch` | create workspaces from local state only |
| `ask_before_fetch` | show a fetch prompt before creating a new workspace |
| `fetch_before_create` | fetch remotes before new task worktrees when possible |
| `offline_allowed` | continue without fetch and mark freshness unknown |

`fetch_before_create` must not imply merge, rebase, pull, dependency install,
or command execution. It may update remote refs only through Git authority and
must record a freshness result before the Task starts.

If the remote is unavailable, Builder may still create the workspace when policy
allows offline work, but the Task and workspace projection should show
`git_freshness: "unknown"` or a more specific non-fresh state.

## Cleanup Policy

Cleanup should be configurable but conservative.

Suggested settings:

```text
worktree_root
fetch_before_create: never | ask | always
auto_delete_old_worktrees: true | false
auto_delete_limit: number
cleanup_scope: unlinked_only | idle_recoverable | manual_only
minimum_retention_days: number
```

Cleanup eligibility requires:

- no active Run, command, preview server, browser automation, or process tree;
- no pending user question, permission request, Review, Save, or reconcile step;
- no missing recovery manifest for unsaved source changes;
- no unrecorded dependency workspace receipt;
- no visible Task, Session, or History item that depends on the physical
  workspace for recovery;
- root containment and symlink or junction checks before deletion.

Automatic cleanup should keep at least the configured number of recent eligible
worktrees per Project. It should prefer deleting unlinked, idle, recoverable
workspaces with the oldest `last_used_at_ms`.

## Recovery Manifest

Before deleting any workspace that ever held task output, Builder should record
a recovery manifest:

```ts
type BuilderWorkspaceRecoveryManifestV1 = Readonly<{
  manifest_version: "builder-workspace-recovery-manifest.v1";
  workspace_id: string;
  project_id: string;
  session_id: string | null;
  task_address_id: string | null;
  cleanup_reason: "manual_delete" | "auto_retention" | "root_migration" | "corruption_recovery";
  recoverability: "full" | "checkpoint_only" | "revision_only" | "not_recoverable";
  recovery_refs: readonly string[];
  source_tree_digest: string | null;
  dependency_receipt_refs: readonly string[];
  created_at_ms: number;
}>;
```

If recoverability is not full, the UI must say so. A cleaned workspace should
not appear as if its exact filesystem state is still available.

## Dependency Workspace Relationship

Dependency readiness should be tied to workspace lifecycle.

Rules:

- A Project may have dependencies installed in its source root while a candidate
  Check workspace does not have dependency access.
- Dependency preparation must be a separate approval and receipt.
- Dependency workspaces should bind to package-manager, lockfile, platform, and
  sandbox policy digests.
- Cleanup of dependency caches must not remove evidence required to explain a
  past check result.
- A missing dependency workspace should produce a terminal readiness state
  rather than a model repair loop.

This aligns with the runtime readiness decision: Builder should be precise
about whether the limitation is the user's machine, the Project source root, or
the admitted workspace.

## Side Workspace And Browser Relationship

The Workspaces settings area should not become the right-side workspace.

The Side Workspace shows active tools for the selected Task: Preview, Browser,
Files, Review, Terminal, or Side Chat. The Workspaces settings area manages
storage roots, cleanup, restore, and task/worktree associations.

Browser profiles are lifecycle-managed resources, but they are governed by
Browser policy:

- Project Preview uses ephemeral loopback-only sessions;
- Agent Test uses run-bound ephemeral sessions;
- User Web may use a durable browser profile when the user chooses it.

Clearing a Browser profile must not delete command or check workspaces. Deleting
a Task worktree must not clear User Web cookies or history.

## Settings Surface Proposal

Builder should add a Workspaces settings page with:

- managed worktree root display and change action;
- fetch-before-create policy;
- automatic cleanup toggle;
- cleanup retention limit;
- per-Project workspace groups;
- per-workspace status: active, idle, pinned, cleanup eligible, blocked,
  recovery only;
- associated Task or conversation title;
- safe actions: open Task, start Task from workspace, pin/unpin, cleanup,
  restore when available;
- dependency and freshness indicators;
- diagnostics for stale, orphaned, or corrupt workspace records.

First release should keep actions narrow:

- list workspaces;
- pin or unpin;
- manual cleanup of eligible workspaces;
- open associated Task;
- show recovery availability.

Starting a new Task from an old worktree, changing the root, auto-fetch, and
dependency workspace preparation can follow after the record and cleanup policy
are proven.

## Configuration File

After schema stabilization, workspace settings may be represented as:

```toml
[workspaces]
root = "default"
fetch_before_create = "ask"
auto_delete_old_worktrees = true
auto_delete_limit = 15
cleanup_scope = "idle_recoverable"
minimum_retention_days = 7

[workspaces.dependencies]
prepare_on_demand = false
cleanup_stale_receipts = false
```

Local project config may request stricter cleanup or freshness behavior, but it
must not weaken user-managed or enterprise-managed retention, recovery,
permission, or sandbox policy.

## Implementation Slices

### W1: Documentation And Projection Shape

- add this policy document;
- define public workspace projection fields;
- keep settings UI copy honest about current implementation.

### W2: Workspace Registry

- add a Main-owned workspace registry store;
- record workspace class, Project, Session/Task association, lifecycle state,
  freshness, dependency state, and recovery reference;
- prove restart-safe replay and orphan detection.

### W3: Cleanup Eligibility

- implement read-only cleanup eligibility computation;
- block cleanup for active run/process/review/preview/reconcile states;
- add root containment, symlink, and junction tests.

### W4: Manual Cleanup

- add manual cleanup for eligible workspaces only;
- write a recovery manifest before deletion;
- keep deleted records visible as recovery-only when appropriate.

### W5: Settings UI

- add Workspaces settings page;
- show root, retention policy, per-Project workspace cards, associated Task, and
  safe actions;
- keep raw paths and private internals out of renderer authority.

### W6: Advanced Lifecycle

- add fetch-before-create policy;
- add start-new-Task-from-workspace;
- add dependency workspace preparation receipts;
- add automatic retention cleanup after packaged gates pass.

## Acceptance Criteria

1. Project source roots are never auto-deleted.
2. Cleanup never runs while a workspace has an active Run, command, preview,
   Review, Save, or reconcile dependency.
3. Every deleted task workspace has a recovery manifest or an explicit
   unrecoverable discard decision.
4. Workspaces settings cannot grant source, command, network, browser, or
   dependency install authority by itself.
5. Fetch policy cannot imply merge, pull, install, or command execution.
6. Dependency presence in the Project source root is distinguished from
   dependency access in the admitted check workspace.
7. Browser profile cleanup and command/check workspace cleanup are separate
   authorities.
8. Renderer projections do not expose raw private paths, process handles,
   sandbox tokens, provider credentials, or Electron partitions.
9. Auto cleanup is bounded by per-Project retention and skips pinned or
   recovery-blocked workspaces.
10. Restart after interrupted cleanup restores either the workspace, the
    recovery-only record, or a visible integrity failure.
