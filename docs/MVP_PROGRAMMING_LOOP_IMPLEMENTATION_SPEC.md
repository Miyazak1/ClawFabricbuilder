# MVP Programming Loop Implementation Spec

This document translates the Codex-like Programming Runtime Architecture into
the first shippable implementation target. It is intentionally narrower than
the full architecture and the post-MVP expansion plan.

## Goal

Builder MVP must prove one reliable local programming loop:

```text
select project
-> understand project
-> ask for a change
-> produce a read-only plan
-> approve execution
-> apply bounded edits
-> record an automatic draft checkpoint
-> show diff, preview, and basic check evidence
-> explicitly save a version
-> restart and recover the same project state
```

This is the release target. Hooks, open extensions, persistent Agents,
community, Work Capsule publishing, vector memory, autonomous branches, live
3D/WebGL preview, and multi-step repair are post-MVP tracks.

The slice-by-slice engineering plan for this release is defined in
[MVP Programming Loop Slice Specs](MVP_PROGRAMMING_LOOP_SLICE_SPECS.md).

## Reference Lessons

The MVP should take the mature shape from existing coding agents without
copying their product model blindly:

- Codex proves that the minimal coding loop is read, edit, command execution,
  approvals, sandbox boundaries, and reviewable patches.
- Claude Code proves that Plan Mode should be read-only, file writes and
  commands should be permissioned, and read-only commands can be recognized as a
  separate class.
- Pi proves that a small tool set plus sessions, compaction, and extension
  events can be powerful, but many product guarantees remain outside the core.
- OpenHands proves that command and file execution need a runtime boundary that
  returns structured observations, not just raw terminal text.

Builder's difference is product authority: Git, SQLite Revision, Review,
Permission, Draft Checkpoint, Task Stream, and Preview facts remain local
authority. Provider output proposes work; it does not own work.

Reference docs:

- https://help.openai.com/en/articles/11096431
- https://www.mintlify.com/openai/codex/concepts/approvals
- https://code.claude.com/docs/en/permissions
- https://pi.dev/docs/latest/usage
- https://docs.openhands.dev/openhands/usage/architecture/runtime

## MVP User Journey

### Step 1: Select Project

User selects or creates a project folder.

Required behavior:

- Composer is available for chat before selection, but programming execution is
  disabled until a project folder is selected.
- Project identity and source root are visible in the composer.
- If no project is selected, plan/chat can continue but source edits cannot be
  proposed as executable work.

Failure state:

- `project_not_selected`: explain that Builder can discuss, but cannot edit or
  verify until a folder is selected.

### Step 2: Understand Project

Builder creates or refreshes a lightweight project understanding snapshot.

Required behavior:

- Detect stack, package manager, likely entry points, likely build/test/lint
  commands, and key paths.
- Show ordinary status such as `Reading project`.
- Do not expose internal digests or source summaries by default.

MVP limit:

- Use manifest/config/README/file-tree scanning first.
- No vector index is required.
- No full symbol database is required.

### Step 3: Read-Only Plan

User asks for a plan or selects `Plan mode`.

Required behavior:

- Plan mode is selectable from the composer `+` menu when a project is bound.
- Natural language plan intent can route to plan.
- Plan route may read/search project context.
- Plan route must not write files, run write-capable commands, mutate Git,
  create Draft Checkpoints, or save versions.
- Output is a clear plan proposal with assumptions, steps, and open questions.

Failure state:

- `plan_failed`: show a normal assistant error and allow retry; no draft or
  revision is created.

### Step 4: Approve Execution

User explicitly approves executing the plan or current instruction.

Required behavior:

- The transition from plan to execute must be visible.
- Approval binds project, conversation, turn, plan or instruction digest, and
  permission mode.
- Approval does not grant shell/network/dependency-install authority by itself.

MVP UI:

- `Do it` / `Build` / `Apply plan` style action in the plan or composer.
- `Ask before write` remains the default permission mode.

### Step 5: Apply Bounded Edits

Builder admits and applies local source edits.

Required behavior:

- Provider output becomes an edit intent, not direct writes.
- Main-side logic validates project id, paths, write scope, protected path
  policy, current base tree, and user-changed file conflicts.
- Patch application should prefer expected-old checks or equivalent conflict
  detection.
- All changed paths are recorded.

MVP limit:

- Support create/update/delete only inside selected project root.
- Reject binary edits unless a separate artifact flow already exists.
- Dependency install and arbitrary shell remain out of MVP execution.

Failure states:

- `edit_rejected_by_policy`;
- `edit_conflict_with_user_changes`;
- `patch_apply_failed`;
- `protected_path_denied`.

### Step 6: Automatic Draft Checkpoint

Every successful mutating run records a local draft checkpoint.

Required behavior:

- User does not need to manually save just to avoid losing AI edits.
- Draft can be reviewed, discarded, and recovered after restart.
- Draft is not a saved Project Revision.

MVP UI:

- Show `Unsaved draft` or equivalent in project header.
- Review action is visible after a mutating run.

Failure state:

- `draft_checkpoint_failed`: source changes should not be silently promoted to a
  saved version; show recovery guidance.

### Step 7: Review Evidence

Builder shows the user what happened.

Required behavior:

- Show changed files and readable diff.
- Show static preview if an HTML/static artifact is available.
- Show basic check evidence if a command profile is available and approved or
  safe for the current policy.
- Show a concise change explanation: what changed, what was checked, and what
  was not checked.

MVP limit:

- Static preview is acceptable.
- Live JavaScript, dev-server preview, mobile viewport checks, and WebGL
  nonblank checks are post-MVP unless already available safely.
- A failed basic check may stop the run; automatic multi-step repair is not
  required.

### Step 8: Save Version

User explicitly saves a reviewed draft.

Required behavior:

- Save requires current draft checkpoint or candidate evidence.
- Save creates Git candidate evidence and SQLite Project Revision receipt.
- Save updates selected current revision only after receipt success.
- Save is restart-safe.

Not allowed:

- provider output silently saves;
- passing checks silently saves;
- preview success silently saves;
- hooks or future agents silently save.

### Step 9: Restart Recovery

Packaged app restart must restore the work state.

Required behavior:

- Current project list is restored.
- Current saved version is restored.
- Unsaved draft state is restored or safely marked recoverable/discardable.
- Conversation/task stream remains coherent enough to continue.

## MVP Backend Contracts

The following contracts/services are required for the first loop. Names are
implementation guidance; exact module names may follow existing local patterns.

| Contract or service | Purpose | Authority |
| --- | --- | --- |
| `ProjectUnderstandingSnapshot` | Stack, entry points, command candidates, key paths | main-owned read fact |
| `CommandProfile` | Known safe or approved commands | main-owned read fact |
| `PlanRun` | Read-only plan attempt | main-owned Run fact |
| `PlanProposal` | User-visible plan with assumptions and steps | renderer-safe projection |
| `ExecutionApproval` | User approval to execute current plan/instruction | Permission-bound fact |
| `ProgrammingRun` | Parent fact for one execution turn | main-owned Run fact |
| `EditIntentPlan` | Target paths and edit rationale | main-owned evidence |
| `WorkspaceGuardDecision` | Path, user-change, secret, binary, and scope policy | main-owned policy fact |
| `EditAttempt` | Applied patch or failure | main-owned source evidence |
| `DraftCheckpoint` | Automatic recoverable AI draft | local recovery fact |
| `CheckRun` | Basic lint/build/test evidence | permission-bound fact |
| `PreviewRun` | Static preview evidence | artifact evidence |
| `ReviewState` | Current reviewable draft projection | renderer-safe projection |
| `SaveVersionReceipt` | Accepted revision persistence | Git + SQLite authority |
| `RestartRecoveryCanary` | Packaged recovery proof | release evidence |

## MVP State Machine

```text
idle
-> project_selected
-> understanding_project
-> ready_for_plan
-> planning
-> plan_ready
-> awaiting_execution_approval
-> execution_admitted
-> editing
-> draft_checkpointing
-> review_ready
-> saving_version
-> version_saved
```

Terminal states:

- `failed`;
- `cancelled`;
- `discarded`;
- `recovered_after_restart`.

Allowed interruption behavior:

- User can cancel before source mutation.
- User can queue a follow-up while editing; Builder reconciles it after the
  current safe boundary.
- User can discard draft after checkpoint.
- User can continue editing from draft without saving first.

## Permission Matrix

| Operation | Chat without project | Plan mode | Execute mode | Save |
| --- | --- | --- | --- | --- |
| Discuss idea | Allowed | Allowed | Allowed | N/A |
| Read selected project files | Denied until selected | Allowed through source policy | Allowed through source policy | N/A |
| Search selected project | Denied until selected | Allowed through source policy | Allowed through source policy | N/A |
| Write selected project files | Denied | Denied | Requires execution approval and write policy | N/A |
| Delete files | Denied | Denied | Requires explicit visible approval | N/A |
| Run read-only command | Denied until selected | Optional later; not MVP blocker | Optional later; not MVP blocker | N/A |
| Run build/lint/test | Denied | Denied by default | Requires command profile and approval | N/A |
| Install dependencies | Denied | Denied | Post-MVP high-risk permission | N/A |
| Start dev server | Denied | Denied | Post-MVP/live-preview permission | N/A |
| Create draft checkpoint | Denied | Denied | Automatic after successful mutation | N/A |
| Save version | Denied | Denied | Denied directly | Explicit user action only |

## UI Projection Map

| Surface | MVP projection |
| --- | --- |
| Project sidebar | Saved projects, current version, unsaved draft marker |
| Composer top edge | Selected project, source folder status, plan mode chip, write mode |
| Composer `+` menu | Files/folders, Plan mode; no Brief user mode |
| Chat timeline | User request, assistant plan, execution status, change explanation |
| Status chips | Reading project, Planning, Ready to execute, Changing files, Review draft |
| Right drawer | Preview, Changes, Source summary if available, basic check result |
| Review actions | Preview, Changes, Discard draft, Save version |
| History/version surface | Saved version after explicit save |

The UI should avoid duplicate controls. One global workspace tab can choose the
right drawer view, while the drawer content should not repeat the same view
selector unless it adds local value.

## Failure Handling

| Failure | Required user-visible outcome |
| --- | --- |
| No selected project | Explain chat/plan only; ask user to choose folder for edits |
| Project understanding failed | Allow manual plan/chat; mark unknowns |
| Plan route failed | Keep composer usable; no draft |
| Plan mode tried to write | Fail closed; show read-only boundary |
| Execution not approved | Keep plan; no source mutation |
| Provider response malformed | Show failure; no source mutation |
| Path outside project | Deny; explain scope |
| User-changed file conflict | Pause for review; do not overwrite silently |
| Patch failed | Show edit failure; no save |
| Draft checkpoint failed | Do not claim recoverable draft; show recovery warning |
| Check failed | Show summary and changed files; stop or allow user follow-up |
| Preview failed | Show diff and preview error; Save may still require user judgment |
| Save failed | Keep draft; do not update current revision |
| Restart recovery failed | Surface integrity failure and avoid rewriting facts |

## Release Canary

MVP is not done until a packaged app can pass this canary with a real provider:

```text
1. Launch packaged app.
2. Select or create a small local project.
3. Ask for a read-only plan.
4. Confirm plan does not mutate files.
5. Approve execution.
6. Apply one bounded source change.
7. Record automatic draft checkpoint.
8. Show changed files and diff.
9. Show static preview if applicable.
10. Run or explicitly skip a basic check with evidence.
11. Save version.
12. Quit and relaunch packaged app.
13. Reopen project and verify saved version, draft state, and conversation
    continuity are coherent.
```

Required evidence:

- project understanding snapshot summary;
- plan run receipt;
- execution approval;
- edit attempt result;
- draft checkpoint receipt;
- review state projection;
- check/skip evidence;
- save version receipt;
- restart recovery result.

## Implementation Order

1. Stabilize explicit Plan mode submission and natural plan routing.
2. Add Project Understanding Snapshot and Command Profile Discovery.
3. Add ProgrammingRun and ExecutionApproval binding for execute mode.
4. Add EditIntentPlan and WorkspaceGuard for bounded project writes.
5. Make Draft Checkpoint automatic after successful mutating runs.
6. Consolidate Review Workspace: diff, preview, check evidence, save/discard.
7. Add CheckRun MVP with one discovered/approved command path.
8. Add packaged MVP canary for the full loop.

Do not start post-MVP feature tracks until this order is either complete or
explicitly re-scoped in the implementation plan.
