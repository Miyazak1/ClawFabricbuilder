# Codex-Like Programming Runtime Architecture

This document defines Builder's core programming runtime: the product and
engineering layer that lets AI read a project, plan, edit code, run checks,
repair failures, preview results, recover or undo work, and optionally mark a
stable milestone as a Version.

The current implementation order and the decision to remove mandatory
`Save version` from the ordinary loop are defined in
[Foundational Coding Loop And Plugin Runtime Roadmap](FOUNDATIONAL_CODING_LOOP_PLUGIN_RUNTIME_ROADMAP.md).
Where older sections of this document use save-oriented terminology, the
foundational roadmap is authoritative.

The goal is not to clone a terminal coding agent. Builder should become a
trusted desktop workbench whose AI programming loop is as capable as Codex-like
tools while staying integrated with Builder's own Git, SQLite, Permission,
Review, Draft Checkpoint, Working Context, Provider Adapter, and future Work
Capsule architecture.

## Product Decision

Builder's next core capability should be a unified Programming Run Pipeline.

Today the architecture has strong ingredients: provider settings, bounded
generation transport, Working Context, Permission gates, Review, Git/SQLite
facts, Draft Checkpoint, static preview, and release canaries. The missing
product shape is the single execution spine that makes them behave like one
coding agent:

```text
User instruction
-> route and context assembly
-> plan or execute
-> tool/action proposals
-> permission and policy gates
-> source edits
-> checks
-> repair loop
-> preview and diff
-> automatic draft checkpoint
-> continue, review, or undo
```

This pipeline is the v1 priority. Agent teams, community, plugin hooks, and
playful surfaces should be projections or extensions over this pipeline, not
substitutes for it.

## MVP Programming Loop

The smallest useful Codex-like Builder release should prove one stable local
programming loop before adding community, multi-agent work, open hooks, vector
memory, autonomous experiments, or complex preview infrastructure.

MVP loop:

```text
select project
-> understand project
-> user asks for a change
-> AI proposes a read-only plan
-> user approves execution
-> AI applies bounded source edits
-> Builder records an automatic draft checkpoint
-> Builder shows diff, preview, and basic check evidence
-> user continues, reviews, restores, or optionally marks a Version
-> packaged app restarts and recovers the project, conversation, and working state
```

MVP functions:

| Function | Required behavior | Main fact or service |
| --- | --- | --- |
| Project understanding | Detect stack, entry points, test/build commands, and key paths | `ProjectUnderstandingSnapshot` |
| Plan mode | Read-only project reasoning; no source writes or Git mutation | `PlanRun` / read-only route |
| Execute mode | Run a user-approved programming turn | `ProgrammingRun` |
| Safe editing | Generate edit intent, apply bounded patches, protect user work | `EditIntentPlan`, Patch/Edit Engine, `WorkspaceGuard` |
| Automatic draft | Preserve AI edits without forcing immediate manual save | `DraftCheckpoint` |
| Review | Show changed files, readable diff, preview, and basic checks | Review Workspace |
| Basic checks | Run discovered or approved lint/build/test command and summarize result | `CommandProfile`, `CheckRun` |
| Undo and restore | Return conversation and files to a known checkpoint without rewriting history | Draft Checkpoint and restore facts |
| Optional milestone | Mark a stable checkpoint as a formal Version when useful | Git candidate and SQLite Project Revision |
| Restart recovery | Reopen with current project, conversation, and working state intact | Packaged recovery canary |

MVP exclusions:

- arbitrary third-party extensions;
- public sharing or community feed;
- autonomous experiment branches;
- vector memory in the execution path;
- multi-agent delegation;
- multi-step automatic repair;
- live 3D/WebGL preview as a release blocker;
- public third-party plugin loading.

Static preview is enough for the first loop, but the architecture must leave a
clear path to Live Preview V1. Failed checks should be classified and visible,
but the MVP may stop after one failed check instead of attempting automatic
repair.

The concrete MVP implementation target is defined in
[MVP Programming Loop Implementation Spec](MVP_PROGRAMMING_LOOP_IMPLEMENTATION_SPEC.md).
That spec owns the MVP user journey, state machine, permission matrix, UI
projection map, failure handling, and packaged canary.

## Competitive Position

### Codex

Codex's product strength is not just chat. It is a loop where the agent can
inspect a repository, propose or apply edits, run commands under approvals,
handle failures, and report evidence. Codex also exposes lifecycle hooks such as
`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `PreCompact`, and `Stop`, which
show that mature coding agents treat prompt, tool, compaction, and stop points
as first-class runtime events.

Builder should copy that lifecycle discipline, but integrate it with Builder's
reviewable product facts instead of making shell execution the center of the
product.

### Pi

Pi is a strong reference for a small extensible runtime. Its extension model has
events such as `context`, provider request/response hooks, `tool_call`,
`tool_result`, `tool_execution_start`, `tool_execution_update`,
`tool_execution_end`, `turn_start`, `turn_end`, and session lifecycle events.
Extensions can mutate context, block or modify tool input, modify tool result,
register tools, and add commands.

Builder should absorb Pi's event vocabulary into an internal typed runtime:

- `context` becomes Builder's Context Assembly and Run Context Snapshot;
- `tool_call` becomes Tool Action Admission before local authority is used;
- `tool_result` becomes Tool Result Normalization and Check/Repair feedback;
- provider request/response hooks become Provider Runtime Event Normalizer
  events;
- session and turn hooks become Builder Session, Task, Run, and Hook ledger
  facts.

Builder should not copy Pi's early arbitrary TypeScript extension surface. Pi
warns that extensions run with full system permissions. Builder's ordinary
desktop product needs a stricter trust model, so v1 keeps extension-like power
inside built-in main-owned handlers.

### OpenCode

OpenCode V2 uses plugin runtime hooks such as `ctx.session.hook("request")` and
`ctx.tool.hook("execute.before" / "execute.after")`. This confirms the same
shape as Pi: model requests and tool execution are the natural interception
points. It is a good developer-runtime reference, but Builder should not expose
in-process plugin hooks before command hooks, trust review, and hook ledgers are
mature.

### Claude Code

Claude Code has a broad hook and settings system, including command, HTTP, MCP,
prompt, and agent handlers. It is the long-term reference for extensibility and
Desktop inspection. Builder should not open this whole surface in v1.

## Architecture Overview

```text
Composer / Handoff / Agent request
-> Intent Router
-> Working Context Service
-> Context Assembler
-> Run Admission
-> Programming Run Pipeline
   -> Provider Runtime Event Normalizer
   -> Tool Action Runtime
      -> Source Read
      -> Patch/Edit
      -> Check Run
      -> Preview
      -> Git Candidate
   -> Repair Loop
-> Draft Checkpoint
-> Review Workspace
-> Continue / Undo / Restore
-> Optional Milestone Version
```

The pipeline has one invariant: provider output never directly mutates source,
Git, SQLite, permissions, preview, or revision state. Provider output is parsed
into proposed actions. Builder then admits or rejects those actions through
local authority.

## Core Components

### 1. Programming Run Pipeline

The pipeline coordinates one AI programming turn.

Minimum fact:

```text
ProgrammingRun
  project_id
  conversation_id
  task_id
  turn_id
  run_id
  instruction_digest
  route
  context_snapshot_id
  provider_config_digest
  status
  started_at_ms
  completed_at_ms
  source_ref
  authority
```

Allowed statuses:

```text
admitted
context_ready
provider_running
awaiting_permission
applying_patch
running_checks
repairing
preview_ready
draft_checkpointed
review_required
completed
failed
cancelled
```

This run is the parent for tool actions, edit attempts, check runs, repair
attempts, preview evidence, draft checkpoint, and review state.

### 2. Context Assembly Binding

Every programming run must start with a run-bound context snapshot.

Inputs:

- latest user instruction;
- current Working Context State;
- approved plan, if present;
- Builder cross-run context checkpoint (distinct from the active runtime's
  private compaction summary);
- handoff packet status;
- selected project source summary;
- permission mode;
- provider context disclosure consent, when needed.

Output:

```text
RunContextSnapshot
  context_snapshot_id
  project_id
  conversation_id
  task_id
  turn_id
  run_id
  included_layers
  excluded_layers
  stale_or_conflict_notes
  prompt_egress_status
  redacted_context_digest
```

Context Assembly is the only path into provider prompt context. Hooks,
handoffs, memory, vector candidates, or plugin outputs cannot inject directly
into provider prompts.

### 3. Provider Runtime Event Normalizer

Provider protocols are not product authority. The normalizer converts provider
transport output into Builder events:

```text
provider_request_started
provider_text_delta
provider_reasoning_delta
provider_action_proposed
provider_usage_reported
provider_response_completed
provider_response_failed
provider_response_interrupted
```

`provider_action_proposed` is not a tool call yet. It becomes a Tool Action only
after Tool Action Admission validates schema, project identity, permission
scope, and run binding.

### 4. Tool Action Runtime

This is the biggest missing design for Codex-like capability.

Builder needs a local action model equivalent to Pi's `tool_call` /
`tool_result`, but main-owned and product-fact-bound.

```text
ToolActionProposal
  action_id
  project_id
  conversation_id
  task_id
  turn_id
  run_id
  action_kind
  input_digest
  requested_authority
  proposed_by
  status
```

Initial action kinds:

| Action | Purpose | Needs user approval |
| --- | --- | --- |
| `source_read` | Read bounded project files | Sometimes |
| `source_search` | Search paths or symbols | Sometimes |
| `patch_apply` | Apply text edits | Yes unless current project write is approved |
| `file_create` | Create a file | Yes |
| `file_delete` | Delete a file | Yes, always visible |
| `file_move` | Move or rename | Yes |
| `check_run` | Run lint/test/build command | Yes for command execution |
| `preview_start` | Start local preview | No for static, yes for dev server |
| `git_candidate_record` | Persist candidate commit/ref | Internal after reviewable draft |

Result fact:

```text
ToolActionResult
  action_id
  result_id
  status
  started_at_ms
  completed_at_ms
  output_summary
  output_digest
  error_class
  next_action_hint
```

No tool result becomes model-visible until it passes Tool Result Projection:

- redacted;
- bounded;
- classified;
- bound to run id;
- recorded in the run ledger.

### 5. Patch/Edit Engine

Builder should prefer patch/edit operations over full-file replacement.

The edit engine must support:

- single-file patch;
- multi-file patch set;
- create, delete, move, rename;
- expected-old content checks;
- conflict detection;
- UTF-8 validation;
- binary refusal or special binary flow;
- protected path policy;
- formatting hook after apply;
- rollback to pre-edit state on failed application.

Facts:

```text
EditPlan
  edit_plan_id
  run_id
  base_tree_digest
  target_paths
  edit_count
  risk_class
  status

EditAttempt
  edit_attempt_id
  edit_plan_id
  attempt_number
  status
  changed_file_count
  conflict_summary
  resulting_tree_digest
```

Patch failures should be fed back into the repair loop as structured failure,
not raw stack traces.

### 6. Check Run Runtime

Checks are first-class product evidence, not just terminal output.

```text
CheckRun
  check_run_id
  project_id
  run_id
  command_profile_id
  command_display
  permission_decision_id
  status
  started_at_ms
  completed_at_ms
  exit_code
  output_summary
  output_digest
  failure_class
```

Command profiles should be explicit:

- `npm test`;
- `npm run lint`;
- `npm run typecheck`;
- package-specific verify scripts;
- static analysis adapters;
- no arbitrary shell unless approved.

Check output to the model must be summarized and bounded. The full output can
stay in a main-owned evidence file or log reference.

### 7. Repair Loop

The repair loop is what turns a code generator into a coding agent.

```text
edit -> check -> classify failure -> repair context -> edit -> check
```

Limits:

- maximum repair attempts per run;
- maximum command executions;
- maximum provider calls;
- stop on repeated same failure class;
- stop on permission denial;
- stop on protected path or merge conflict;
- user-visible reason when stopped.

Repair context includes:

- failed check summary;
- changed paths;
- relevant snippets;
- prior repair attempt summaries;
- current Working Context State;
- user constraints.

### 8. Preview Runtime

Preview is part of programming evidence.

V1:

- static preview remains fallback;
- generated HTML/CSS preview can show static result;
- no JavaScript execution in static iframe path.

Live Preview V1:

- local read-only static server;
- isolated main-owned Electron `WebContentsView`;
- JavaScript, canvas, WebGL, and Three.js support;
- console/error capture;
- screenshot or nonblank pixel evidence;
- reload on draft checkpoint;
- loopback only;
- no external network without later permission gate.

Preview evidence:

```text
PreviewRun
  preview_run_id
  project_id
  run_id
  source_ref
  preview_kind
  status
  console_error_count
  screenshot_digest
  canvas_pixel_status
```

### 9. Draft Checkpoint Integration

Every successful mutating run should create a Draft Checkpoint before Builder
claims the work is recoverable or offers Undo.

```text
AI changes source
-> EditAttempt succeeds
-> optional CheckRun/PreviewRun completes
-> DraftCheckpoint recorded
-> Review Workspace projects diff, preview, checks, restore
```

Draft Checkpoint is the recovery layer. It is not Project Revision, not user
approval, and not publication authority.

### 10. Review Workspace

The Review Workspace is an inspection surface for the current working state.
It is available when useful, but it is not a mandatory gate before the next
coding turn.

It must show:

- changed files;
- readable diff;
- generated preview;
- check results;
- checkpoint status;
- risk notes;
- undo/restore actions;
- optional milestone action.

It should not show internal receipt digests by default. Advanced diagnostics can
link to them.

### 11. Optional Milestone Version

A formal Version is optional milestone metadata over a stable checkpoint. It
does not gate continuation and is not required after each AI edit.

The milestone path requires:

- a current draft checkpoint or candidate;
- accepted review state;
- Git candidate commit/ref;
- SQLite Project Revision receipt;
- selected current revision projection;
- restart recovery evidence.

No hook, provider output, preview success, or check success can silently mark a
formal milestone unless a future user-selected project policy explicitly
allows it. Automatic recovery checkpoints remain separate.

## Required Core Capabilities

The pipeline above is the execution spine. A Codex-like product also needs the
following supporting capabilities before it feels like a serious programming
agent rather than a chat surface that can generate code.

### Project Understanding Snapshot

Builder must be able to quickly explain what a selected project is, where its
entry points are, how it runs, how it is tested, and which files are most
important.

```text
ProjectUnderstandingSnapshot
  project_id
  base_tree_digest
  detected_stack
  package_manager
  app_entrypoints
  test_entrypoints
  build_entrypoints
  important_paths
  unknowns
  updated_at_ms
```

This snapshot is not long-term memory and not provider prompt authority by
itself. It is an input to Context Assembly, and it becomes stale when the Git
tree, package manifest, or saved Project Revision changes.

### Command Profile Discovery

Builder should discover safe, project-specific commands instead of asking the
model to invent shell commands.

Inputs:

- `package.json`, lockfiles, config files, README, and known framework files;
- previous successful CheckRun facts;
- user-approved command profiles;
- package manager detection.

Output:

```text
CommandProfile
  command_profile_id
  project_id
  command_display
  command_kind
  confidence
  source
  requires_permission
  risk_class
```

Initial command kinds:

- `lint`;
- `typecheck`;
- `unit_test`;
- `focused_test`;
- `build`;
- `format_check`;
- `preview_start`.

Arbitrary shell remains outside the default path. The model can propose a
command, but Check Run Admission should prefer known profiles and require
explicit approval for anything else.

### Failure Triage

Failed checks, preview errors, and provider/tool failures must be classified
before they are shown to the model or user as repair context.

```text
FailureTriage
  failure_triage_id
  run_id
  source_kind
  failure_class
  likely_paths
  likely_symbols
  relevant_output_summary
  confidence
  repairable
```

Failure classes should include:

- syntax or parse error;
- type error;
- lint violation;
- failing test assertion;
- missing dependency;
- missing script;
- runtime exception;
- preview console error;
- timeout;
- permission denied;
- protected path conflict;
- unknown infrastructure failure.

This lets the repair loop ask the model a bounded question: fix this classified
failure against these paths, not "read the whole terminal log and guess."

The current `builder-check-run-outcome-projection.v1` is deliberately narrower
than FailureTriage. It preserves a safe current-draft outcome across refresh and
restart and distinguishes not-run, running, completed, and unavailable reads,
but it carries only fixed public copy. It must not be treated as diagnostic or
repair evidence. `builder-check-failure-triage.v1` is the first separate
bounded, redacted, candidate-bound diagnostic contract for failed CheckRun
records. It does not yet persist triage, project it to the renderer, or feed a
provider repair request.

### Edit Intent Plan

Before mutating more than a trivial single file, Builder should have a small
edit intent plan.

```text
EditIntentPlan
  edit_intent_plan_id
  run_id
  target_paths
  file_operations
  reason
  risk_class
  requires_review
```

This plan is not necessarily user-facing for every small change, but it gives
Tool Action Admission and Review Workspace a stable explanation of why files
changed. It also makes multi-file changes easier to repair and easier to
discard.

### Run Context Refresh Policy

Programming work is not static. User messages, handoffs, compaction, failed
checks, applied edits, and saved versions can all make the current context
stale.

Builder needs a policy that decides whether a run can continue, must refresh
context, or must stop for user review.

```text
RunContextRefreshDecision
  run_id
  prior_context_snapshot_id
  reason
  decision
  next_context_snapshot_id
```

Allowed decisions:

- `continue_current_run`;
- `refresh_before_next_provider_call`;
- `pause_for_user_reconciliation`;
- `cancel_current_run`;
- `finish_safe_boundary_then_reconcile`.

This is where active-session interruptions and cross-session handoff insertion
become concrete. Default behavior is: finish the current admitted action or
reach a safe review boundary, then reconcile the new information before the
next provider call or source mutation.

### Run Interruption State Machine

Builder needs explicit run states for interruption, cancellation, and follow-up
work. Otherwise a user message during a long run can create invisible ambiguity.

```text
RunInterruption
  interruption_id
  run_id
  source
  message_digest
  received_at_ms
  disposition
  reconciled_at_ms
```

Disposition values:

- `queued_follow_up`;
- `interrupt_after_current_action`;
- `interrupt_now_safe`;
- `requires_user_choice`;
- `superseded_by_newer_instruction`;
- `merged_into_context_refresh`.

This should integrate with the existing active-run queued follow-up design and
HandoffPacket architecture, rather than becoming a separate chat shortcut.

### Environment Readiness

The agent must know whether the local project can actually run.

```text
EnvironmentReadiness
  project_id
  node_version
  python_version
  package_manager_status
  dependency_status
  port_conflicts
  missing_tools
  readiness_status
```

Dependency install, package manager mutation, global tool installation, and
network access are higher-risk operations and must go through explicit
Permission gates. Readiness detection is allowed to be read-only by default.

### Workspace Guard

Builder needs a consistent policy for files and paths the AI should not touch.

Guard inputs:

- Git status;
- ignored files;
- protected generated output;
- secret-looking files;
- binary files;
- lockfiles;
- files changed outside the current run;
- paths outside the selected project root.

Guard decisions:

- allow read;
- allow write after approval;
- require explicit high-risk approval;
- deny;
- defer because user changes conflict.

This protects user work and prevents provider output from drifting across
project boundaries.

### Interactive Preview Verification

Static preview is useful, but it cannot verify JavaScript, canvas, WebGL,
Three.js, interaction, timers, routing, or browser console failures.

Live Preview V1 should provide:

- isolated loopback preview server;
- Electron-owned preview surface;
- console error capture;
- screenshot evidence;
- nonblank canvas/WebGL pixel check;
- mobile and desktop viewport checks for visual apps;
- no external network by default.

Preview success is evidence, not acceptance. It feeds Review Workspace and
repair context, but it never saves a version.

### Change Explanation

Every reviewed draft should have a concise explanation of what changed and how
it was verified.

```text
ChangeExplanation
  run_id
  changed_paths
  summary
  verification_summary
  risk_notes
  unverified_items
```

This is the human bridge between raw diff and trust. It also becomes a strong
input for Work Capsule later.

### Automatic Draft Checkpoint Policy

Draft Checkpoint should behave like automatic local staging for AI work.

Rules:

- every successful mutating run records a checkpoint;
- checkpoints are restorable after restart;
- checkpoints can be compared and discarded;
- formal Versions are optional milestones;
- multiple checkpoints can collapse into one visible draft when appropriate;
- the user should not need to manually save just to avoid losing AI work.

This resolves the UX tension between fluid AI iteration and formal version
history.

### Quality Gate Strategy

Builder should not treat "run all tests" as the only quality strategy.

Quality levels:

- `none`: explain why no check was possible;
- `static`: parse, lint, or type-only evidence;
- `focused`: tests or checks related to changed files;
- `project`: normal project build/test;
- `release`: package-level canary and restart recovery.

The agent should choose the smallest meaningful check by default, explain what
was not run, and let the user escalate to heavier checks.

## Priority Extensions

The next maturity layer should land in this order:

1. `ProjectUnderstandingSnapshot` and `CommandProfileDiscovery`, because the
   agent must know what project it is inside and how to verify work.
2. `EditIntentPlan`, `WorkspaceGuard`, and `ToolActionAdmission`, because code
   mutation must be explainable and bounded.
3. `CheckRun`, `FailureTriage`, and one-step `RepairLoop`, because this is what
   turns generation into programming.
4. `AutomaticDraftCheckpointPolicy` and `ReviewWorkspace`, because users need
   recovery and review without manual staging friction.
5. `RunContextRefreshPolicy` and `RunInterruptionStateMachine`, because long
   sessions, handoff, and active user corrections need deterministic behavior.
6. `InteractivePreviewVerification`, because web/3D work cannot be trusted from
   static HTML alone.

## Event Vocabulary

Builder should use Pi-like lifecycle events internally, but expressed as product
facts:

| Pi-like concept | Builder event |
| --- | --- |
| `turn_start` | `programming_run_admitted` |
| `context` | `before_context_assembly` / `after_context_assembly` |
| provider request | `provider_request_started` |
| provider response | `provider_response_completed` / `provider_response_failed` |
| `tool_call` | `tool_action_proposed` / `tool_action_admitted` |
| `tool_result` | `tool_action_result_recorded` |
| `turn_end` | `programming_run_completed` |
| Harness in-run compaction | private validated `compaction/start` / `summary` / replacement / `end`; no fabricated public work row |
| Builder cross-run context checkpoint | disclosure-gated provider-context candidate and restart/handoff reference |
| session end | `builder_session_idle` / `builder_session_archived` |

These events feed the Lifecycle Hooks Architecture, but v1 handlers are
built-in only.

The Windows package now has a deterministic installed-runtime compaction gate.
It forces one native Harness replacement, verifies continued tool execution and
reconciliation, and proves that the private block-array summary produces no
additional public assistant row.

## UI Architecture

The user should not see "tool runtime" or "hook bus".

Ordinary UI:

```text
Model-authored explanation of the next meaningful action
Real read/search actions
Real file edits
Real commands and checks
Model-authored finding, repair explanation, and final summary
Collapsed completed-run history, expandable in place
Separate file and command result rows
Check status, Undo, and optional milestone actions in the workspace toolbar
Milestone Version saved when requested
```

Advanced UI:

- Run timeline;
- action ledger;
- check run details;
- provider usage summary;
- context snapshot summary;
- hook run diagnostics;
- Git/SQLite evidence.

The composer remains simple. The right side is the Review Workspace when a
draft exists. The chat timeline should show status and decisions, not every raw
tool output.

The terminal response must not be followed by separate `Review before saving`
or `Result ready` cards. Those duplicate the result instead of advancing the
conversation. Check state, Undo, and optional milestone actions remain compact
workspace-toolbar controls; Preview, Changes, Files, and History remain
inspectable in the right workspace.

The final response does not own a generic `Work details` disclosure. Concrete
result facts use the current admitted draft comparison and main-selected
CheckRun profile in separate typed rows after the response: file rows show
path plus bounded line deltas and open File/Changes, while command rows show the
exact safe `command_display` and open a read-only Command Inspector. Renderer
code does not invent paths, commands, or raw output, and the inspector does not
become a general Terminal. File and command facts never share one disclosure.
A single fact is a direct row without an arrow; only multiple facts of the same
type may form an expandable group.

The renderer follows that boundary deterministically. A factual Tool action
renders as live progress in chat and keeps one stable identity while its request
state changes in place to the matching result state. Once `run_completed`
exists, settled process rows fold into one independent, closed run-history
disclosure before the terminal response. Expanding it restores the chronological
actions; it is not nested in or owned by the response. Admitted draft changes
and CheckRun facts render after the response as separate typed result rows.
Generic Agent Step receipts and provider lifecycle stages may drive only an
unobtrusive temporary loading indicator before model text or a real action is
available. They do not create narration and do not survive as completed work. Run
admission/control records, context snapshots, brief updates, and raw evidence do
not render. The right workspace remains for artifacts such as Preview, Changes,
Files, and History. History distinguishes current automatic recovery from
optional milestone Versions; Logs are not part of the ordinary MVP workflow.

A Codex-like elapsed label requires durable main-issued start/end timing or a
trusted `duration_ms` on the Run projection. Until that exists, renderer-local
timing must not be presented as historical fact.

Live assistant text is a separate display projection, not a copy of the raw
provider stream. For Ask, main incrementally decodes only the approved
`explanation` string from the structured response. Harness Build projects only
the model's public text blocks and keeps reasoning private; real file and
command progress comes from admitted tool facts. Structured-operation Build and
Plan keep raw structured provider payload main-only. Once a Plan record is admitted, main projects a bounded
public Markdown document into the primary chat; this projection is not provider
JSON and grants no file, Browser, command, or mutation authority. Renderer
delivery uses a request-bound external store that coalesces chunks once per
animation frame, updates only the active assistant message, and preserves that
DOM node for the lifetime of the stream. Chat follows new text only while the
user is near the bottom, so reading earlier work is not interrupted by incoming
chunks.

Typography, color, motion, Markdown bounds, and Plan approval placement are
specified in [Conversation Visual Streaming and Plan Markdown Spec](CONVERSATION_VISUAL_STREAMING_AND_PLAN_MARKDOWN_SPEC.md).

The first convergence layer is `builder-agent-activity-projection.v1`. It is a
main-owned, renderer-safe summary over already-recorded Conversation, Run,
Tool, and Review facts. Renderer surfaces may use its current phase for a
temporary loading indicator, but not as model narration or completed history.
It does not replace Task Stream, ReviewState,
CheckRun, DraftCheckpoint, or Revision authority. Active CheckRun now joins
through the main-owned candidate activity registry as the fixed `Running
checks` phase; the public projection receives no command, output, path, or
runtime handle. Terminal and unavailable status survives refresh through the
separate CheckRun Outcome projection, while ReviewState fails closed during an
active or unreadable check. Repair must remain absent until its own bounded
diagnostic facts can be joined without speculation.

## Authority Boundaries

The programming runtime must preserve Builder's current trust model:

- renderer never constructs provider prompts, tool actions, Git facts, Review
  facts, CheckRun facts, or Revision receipts;
- provider output never directly mutates source or Git;
- source writes require Tool Action Admission and Permission;
- command checks require permission and command profile;
- Draft Checkpoint never becomes Save Version;
- SQLite product facts remain the semantic authority;
- Git remains code-object authority;
- preview is evidence, not acceptance;
- hooks are interceptors, not permission grants.

## Implementation Slices

### Slice P0: Programming Run Contract

Pure main-side contracts:

- `builder-programming-run.v1`;
- `builder-programming-run-event.v1`;
- `builder-run-context-snapshot-ref.v1`.

No provider dispatch changes yet.

### Slice P1: Tool Action Contract

Pure main-side contracts:

- `builder-tool-action-proposal.v1`;
- `builder-tool-action-admission.v1`;
- `builder-tool-action-result.v1`.

Initial action kinds: source read, patch apply, check run, preview start.

### Slice P2: Patch/Edit Engine

Introduce bounded patch application with expected-old checks and rollback.

Current checkpoint: structured create/update/delete operations are applied
atomically to a bounded in-memory source tree, then admitted by
`builder-edit-intent-plan.v1`, `builder-workspace-guard-report.v1`, and
`builder-edit-attempt.v1` before Git candidate persistence. The automatic Draft
Checkpoint stores the successful EditAttempt reference for restart-safe
evidence. Final Save projection now uses `builder-worktree-transaction.v1` to
stage file replacements privately and roll back applied create/update/delete
operations when a later filesystem operation or Git main-ref CAS fails. Its
durable, digest-only journal is reconciled against Git main on Save retry and
current-project reopen, with the SQLite-selected Project Revision defining the
intended commit. Unselected work restores the base tree; selected work
completes the resulting tree and repairs Git main through CAS when needed.
Visible approval continuation for risky edits and move/rename support remain
incomplete.

Evidence:

- conflict tests;
- protected path tests;
- create/delete/move tests;
- UTF-8 and binary refusal tests;
- no renderer source mutation.

### Slice P3: Check Run Runtime

Introduce command profiles and CheckRun facts.

Evidence:

- approved lint/test command profile;
- denied arbitrary command;
- failed check output summary;
- repair feedback projection.

Current checkpoint: CheckRun MVP now has main-owned current-draft approval,
candidate-bound execution admission, bounded packaged npm-script runtime,
immutable CheckRun v2 facts, explicit durable skip evidence, bounded main-only
FailureTriage for failed CheckRun facts, ReviewState/Save gate integration,
renderer-safe status/outcome projection, and packaged release canary coverage
for a discovered `npm test` check. The runtime still does not claim arbitrary
terminal authority, dependency installation, networked command execution, or
provider-suggested shell execution.

### Slice P4: Repair Loop MVP

Allow one bounded repair attempt after a failed CheckRun.

Evidence:

- failed check -> provider repair request uses bounded summary;
- repeated failure stops with visible reason;
- permission denial stops safely.

### Slice P5: Draft Checkpoint Default

Record Draft Checkpoint after every successful mutating run.

Evidence:

- restore after restart;
- compare checkpoint;
- discard checkpoint;
- continue without a Version action;
- optionally mark a checkpoint as a milestone.

Current verified closure (2026-08-20): restart reconstruction carries the
durable `current_materialization` projection back into the pending draft, while
workspace expectation uses the verified candidate proof's resulting tree
digest. A restarted service therefore distinguishes Builder's own materialized
draft from an external workspace edit. Undo fails closed with
`builder_generation_workspace_changed`, preserves both the external source and
candidate count, and succeeds after the physical workspace is restored. The
generation main-service suite covers this with a newly instantiated service,
and the packaged Harness UI canary exercises the same restart path end to end.

### Slice P6: Review Workspace V1

Unify diff, preview, check results, checkpoint state, and undo/restore actions.

Evidence:

- no duplicated preview controls;
- newest chat remains visible;
- right panel layout stable;
- user can undo, restore, or mark a milestone without hidden state.

### Slice P7: Live Preview V1

Add isolated local preview runtime for static web projects.

Evidence:

- JavaScript runs;
- Three.js/WebGL canvas is nonblank;
- console errors captured;
- no external network by default;
- static iframe fallback remains.

### Slice P8: Provider Event Normalizer In Main Path

Wire normalized provider events into live output and action proposal recording.

Evidence:

- DeepSeek chat path remains stable;
- unsupported provider tool calls are blocked;
- usage summary recorded;
- raw provider body stays main-only.

## Release Gate

The runtime is not mature until the packaged app can prove:

```text
open project
-> chat
-> plan
-> approve
-> edit files
-> run check
-> repair failure
-> preview
-> checkpoint
-> show diff
-> continue without saving a version
-> undo or restore
-> restart
-> recover current project and working state
```

Required canaries:

- default packaged provider canary;
- DeepSeek packaged canary;
- save/restart recovery;
- failed check repair;
- discard/restore checkpoint;
- static preview;
- live preview once enabled.

The packaged Harness UI gate currently proves the complete unsaved-draft path
through two Build turns, automatic check repair, candidate materialization,
application restart, checkpoint recovery, conflict-safe undo, successful undo
after conflict clearance, and a further continuation turn. It additionally
proves cancellation and unsupported/stale tool recovery without requiring a
formal Version save.

## Non-Goals

Near-term Builder should not:

- open arbitrary user/plugin extensions like Pi before the internal runtime is
  stable;
- treat provider tool calls as direct local tools;
- treat passing tests as user acceptance or publication authority;
- require a formal Version before the next coding turn;
- use vector memory as execution readiness;
- rely on static preview for JavaScript or 3D projects;
- expose raw tool logs, provider prompts, or private source context to the
  renderer.

## Maturity Checklist

Builder has a mature Codex-like programming runtime when:

- every run has a Run Context Snapshot;
- every provider response is normalized before affecting product state;
- every local action has Tool Action Admission and Result facts;
- every source edit is patch/edit evidence, not opaque text replacement;
- every check run has command profile, permission, output summary, and status;
- failed checks can drive bounded repair;
- every mutating run creates a Draft Checkpoint;
- Review Workspace shows diff, preview, check evidence, and checkpoint state;
- Undo/restore and optional milestone creation are restart-safe;
- packaged canaries prove the whole loop with a real provider.
