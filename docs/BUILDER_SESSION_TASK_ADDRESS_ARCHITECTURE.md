# Builder Session And Task Address Architecture

## Purpose

Builder needs a product-level address layer for work. Low-level IDs already
exist, including `project_id`, `conversation_id`, `task_id`, `turn_id`, `run_id`,
`draft_id`, and Project Revision receipt digests. Those IDs are necessary facts,
but they are not enough for user-visible session trees, subagents, handoff,
forking, archive, delete, retention, or cross-session references.

The product concept is:

```text
Project
-> Session
  -> Task
    -> Turn
      -> Run
        -> Candidate / Review / Revision
```

Project remains the file and permission boundary. Session is the user-visible
long-running work line. Task is the executable goal or subgoal inside that work
line. Turn and Run remain lower-level execution facts. Candidate, Review, and
Revision remain artifact and save facts.

## Product Promise

Users and Agents should eventually be able to say things like:

- "Continue session X."
- "Use findings from task Y."
- "Fork this session before trying another direction."
- "Ask the Reviewer Agent to inspect this task."
- "Archive these old sessions."
- "Export this task before deleting it."

Those actions require stable product addresses. They must not rely on hidden
conversation IDs or a raw SQLite row selector.

## Authority Relationship

Session and Task addresses are product indices over facts. They do not replace
Git, SQLite replay, Project Revision receipts, Permission facts, or Review facts.

| Layer | Authority | What It Means |
| --- | --- | --- |
| Project | SQLite project row plus selected workspace facts | File and permission boundary |
| Session | Product session address facts | User-visible work line, branch/fork/archive/delete scope |
| Task | Product task address facts plus Agent Task facts | Executable objective, parent/child scope, delegation boundary |
| Conversation | SQLite conversation events | Communication and event history for a Session or Task |
| Turn | Conversation replay | One user input and its routing decision |
| Run | Conversation/Run facts | One execution attempt, answer, plan, draft, or failure |
| Candidate/Review/Revision | Git plus SQLite receipts | Artifact proposal, user decision, saved version |

If a Session mirror or exported JSONL file disagrees with SQLite, SQLite wins.
If a Session address points to missing required facts, the product must show an
integrity failure instead of inventing a recovered thread.

## Data Model

### BuilderSession

User-visible address for a long-running work line.

Required fields:

- `session_id`
- `project_id`
- `display_id`
- `title`
- `status`: `active | archived | deleted_pending | deleted`
- `root_conversation_id`
- `current_task_id`
- `parent_session_id`
- `forked_from_session_id`
- `forked_from_revision_receipt_digest`
- `created_by`
- `created_at_ms`
- `updated_at_ms`
- `archived_at_ms`

Rules:

- `session_id` is stable and public enough to reference in UI, handoff, and
  export metadata.
- `display_id` is short and user-facing, but never replaces `session_id` in
  durable facts.
- A Session may start without saved source changes.
- A Session can bind to one Project boundary at a time. Cross-project work
  requires an explicit new Session or a governed handoff.
- Archiving hides the Session from default UI but keeps facts replayable.
- Deleting a Session is a lifecycle operation with export/dependency checks, not
  a renderer filter.

### BuilderTaskAddress

User-visible address for an executable objective inside a Session.

Required fields:

- `task_address_id`
- `session_id`
- `project_id`
- `agent_id`
- `parent_task_address_id`
- `conversation_id`
- `title`
- `goal`
- `status`: `draft | discussing | planned | active | blocked | review_needed | completed | archived`
- `current_brief_id`
- `current_plan_id`
- `base_revision_receipt_digest`
- `produced_revision_receipt_digest`
- `created_by`
- `created_at_ms`
- `updated_at_ms`
- `closed_at_ms`

Rules:

- The current low-level Builder `task_id` remains a Run/conversation fact until
  a main-owned store binds it to `task_address_id`.
- A Task Address can be discussed before any file write.
- Build, tool, save, or delegation actions must bind to a Task Address once the
  address layer exists.
- Child tasks must explicitly record parent task, parent session, permission
  subset, expected result, and result return state.
- A Task Address is not a provider prompt and not a raw transcript.

### SessionReference

Safe cross-session or cross-task reference.

Required fields:

- `reference_id`
- `from_session_id`
- `from_task_address_id`
- `to_session_id`
- `to_task_address_id`
- `reference_kind`: `summary | approved_artifact | exported_conversation | saved_revision | delegated_result`
- `scope`
- `created_at_ms`
- `admission_state`

Rules:

- Cross-session references read public summaries, approved artifacts, saved
  revision facts, explicit exports, or delegated result records.
- They cannot silently read source trees, provider internals, credentials,
  private permission facts, or unrelated conversation events.
- If source reading is required, the normal permission gate must run.

## Fork, Clone, And Handoff Semantics

The product must distinguish these operations:

- Fork conversation: continue from a Session/Task conversation state while
  leaving source state unchanged.
- Fork project from saved revision: create a new Session whose base source state
  is a selected Project Revision.
- Clone current workspace: duplicate or bind a local folder through explicit
  workspace permission.
- Handoff: transfer or invite another Agent or person into a Session/Task with
  scoped context and scoped permissions.

These operations cannot share one generic "copy conversation" implementation.
Each must state what happens to conversation history, Project Revision base,
workspace permission, pending candidates, reviews, and derived JSONL/Markdown
mirrors.

## Agent And Subagent Rules

Subagents need addressable work units, but they must not inherit unrestricted
authority.

- A child Agent receives a child Task Address, not the parent's entire Session.
- A child Task can receive selected public context, explicit references, and a
  permission subset.
- Child results return as reviewable evidence or artifacts. They do not mutate
  the parent Project, Session, Task, or Revision automatically.
- Parent and child Sessions may communicate through references and delegation
  result records, not by sharing raw private transcripts.

## Storage Lifecycle Rules

Session and Task Address are the user-facing scopes for lifecycle management.

- Archive Session: hide from default UI while keeping SQLite facts replayable.
- Export Session/Task: derive JSONL/Markdown/bundle mirrors from SQLite replay.
- Delete Session/Task: destructive transaction with dependency checks.
- Retention: suggest archive or derived cleanup by Session/Task recency and
  status, but do not delete saved versions automatically.

Deleting or archiving must check active runs, pending candidates, pending
reviews, saved revision dependencies, child tasks, delegation results, and
derived mirrors. `conversation_id` alone is too low-level for this product
surface.

## Implementation Slices

1. Document address model and naming boundaries.
2. Add pure Session Address and Task Address contracts.
3. Add main-only SQLite stores for Session and Task Address facts.
4. Bind existing Builder conversations to a Session Address for new work.
5. Bind build/plan/save Runs to Task Address facts.
6. Add read-only Session/Task lookup and public summaries.
7. Add export/fork/archive preflight using Session/Task scopes.
8. Add child Task and subagent delegation address binding.
9. Add destructive delete only after export, dependency, active-run, and
   package/canary evidence.

Current checkpoint: the pure main-side address contract exists as
`builder-session-address.v1` and `builder-task-address.v1`. It validates exact
Session and Task Address facts, status vocabulary, lifecycle timing, parent
self-reference boundaries, and the absence of renderer, provider, Git, source,
permission grant, export materialization, SQLite write, or SQLite delete
authority. It does not create IDs, write SQLite, bind existing conversations,
expose IPC/preload APIs, fork, archive, delete, export files, or migrate old
facts.

## Non-Goals For The Current Builder MVP

- No unrestricted cross-session source reads.
- No automatic migration of old projects or old conversation formats.
- No exposing raw `conversation_id` as the entire product address model.
- No child Agent permission inheritance by default.
- No fork operation that leaves source state and conversation state ambiguous.
- No destructive delete before Archive/Export and dependency checks exist.
