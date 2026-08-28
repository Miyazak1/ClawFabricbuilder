# Agent Workbench Task Supervision, Result Return, and UX v1

Date: 2026-08-22

Status: implemented and packaged-canary verified

## Decision

The Agent Workbench is a control plane, not a Project execution surface.

- Workbench supports Chat, Plan, and explicit Task proposals.
- Workbench does not expose Build mode, source attachment, folder selection, or write-approval controls.
- Build or Plan work that requires Project execution becomes a Project-bound Task proposal before any execution path can start.
- Task execution remains inside the exact Project + Task Address conversation.
- Task status is derived from canonical Task conversation facts owned by main, never from renderer state or the immutable address label.

This is a development cutover. The public preload bridge is `builder-preload.v34` and the Workbench projection is `builder-agent-workbench-projection.v2`; no v33/v1 compatibility path is retained.

## Implemented Surface Boundary

`BuilderComposer` now has an explicit surface kind:

- `task`: Files, Chat/Ask, Plan, Build, and bounded approval controls remain available according to Task state.
- `workbench`: only Chat and Plan are visible. Files, Build, and approval controls are absent from the DOM.

`BuilderApp` clears composer mode when switching between Agent and Task surfaces. A stale Task Build mode cannot leak into Workbench. A defensive submit guard also converts an unexpected direct Workbench Build/Plan dispatch into a Task proposal instead of entering Project write execution.

Agent versus Project is explicit UI selection state. It is not inferred from a missing `projectId`, because an Agent conversation and a new unsaved Project can both be project-id-less. Entering Workbench hides the Project surface without incrementing the workspace epoch, rebuilding the Project controller, or clearing its selected draft. Returning through an exact Task Address therefore restores the still-mounted `draft_ready` state; activity-based draft restoration remains only a bounded fallback for restart or transient reconstruction.

## Canonical Task Monitor

Main composes `builder-workbench-task-monitor.v1` from:

1. `builder-session-task-address-store.v2` for Agent -> Project -> Task identity;
2. canonical Task conversation replay for current runtime and review facts;
3. deterministic projection logic for `active`, `attention`, and `recent` groups.

Projected states are:

- `draft`: Task exists and is ready to start;
- `working`: a canonical run is active;
- `waiting_plan_review`: the latest plan needs review;
- `waiting_review`: the latest candidate needs review;
- `failed` or `interrupted`: user attention is required;
- `stopped`: the latest run was cancelled;
- `ready`: the latest terminal result no longer needs review.

A newly materialized draft Task is Active, not Recent. This keeps the Workbench count aligned with the user's pending workload.

The projection is read-only. Its only renderer operation is `open_task`; it grants no provider dispatch, permission, source read, or source write authority.

## Result Return

Terminal Task results are synchronized into the durable Workbench message store as `builder.task.result.v1` messages.

- Message identity is deterministic from the Task result identity.
- Each message carries an exact Project + Task Address reference.
- Repeated synchronization and restart replay are idempotent.
- The Workbench stores a bounded summary, terminal state, result kind, and review state; it does not copy private provider context or source contents.
- The renderer can open the exact Task from either the result message or the right-side Task monitor.

## UX Contract

The Agent surface has a 328 px right-side Task panel when Tasks exist.

- Groups: Active, Needs attention, Recent.
- Each row has stable icon, title, Project label, and compact status.
- Selection reveals the latest bounded result summary or Task goal.
- `Open task` is explicit; selecting a row alone does not navigate.
- The panel has independent scrolling and stable scrollbar gutter.
- The panel can be collapsed and restored from the workspace toolbar.
- Reduced-motion mode disables the Working spinner.
- Draft Tasks use a neutral icon; completion check marks are reserved for Tasks with terminal results.
- Task proposal actions inherit the current submit lock. They remain visibly disabled until proposal creation settles, preventing an early click from being silently discarded.

Task result messages use a restrained result visual family and expose one bounded `Open task` action. Workbench messages retain safe Markdown and link behavior from the existing declarative message renderer.

## Main Runtime Wiring

The generation IPC runtime now:

- creates the Task monitor only after canonical Task address and conversation authorities exist;
- synchronizes terminal Task results on Task stream changes and Workbench reads;
- emits both Task stream and Workbench invalidation events after relevant Task facts change;
- rebuilds the monitor and idempotently restores result messages after restart;
- closes the new services in the existing main-owned shutdown sequence.

## User-Facing Language Contract

Provider output now follows the language of the current end-user instruction across all execution routes.

- Chinese Ask output streams the `explanation` field in Simplified Chinese.
- Chinese Plan output uses Simplified Chinese for the title, summary, and every step.
- Chinese Build output uses Simplified Chinese for user-facing title and summary values while preserving code, paths, commands, identifiers, and JSON keys.
- DeepSeek Harness uses Simplified Chinese for every public progress update and final summary when the original end-user change request is Chinese.
- Internal checks, repair prompts, tool results, and compaction messages cannot switch the run back to English.

## Verification

Verification completed:

- TypeScript build: passed.
- Focused hook, presentation, and application tests: 235 passed.
- Packaged canary script tests: 90 passed.
- Workbench store, incubation, monitor, result recording, IPC adapter, and generation runtime tests: passed.
- Electron security boundary and packaged canary script tests: passed.
- Windows package build and package integrity verification: passed.
- Generation, repair-language, and Harness persona contract tests: 73 passed.
- Real saved-profile DeepSeek Harness canary: passed with six assistant messages, two Harness turns, `chat_narration_is_chinese: true`, narration before tool actions, a failed-then-passed automatic check, and a recoverable unsaved candidate.
- Packaged Plan mode canary v3: passed, including Chinese natural-language Plan routing, review, approval, and approved-plan Harness execution.
- Packaged Harness UI canary v2: passed, including multi-turn continuation, restart checkpoint recovery, undo conflict handling, cancellation, boundary denial, stale-edit recovery, and unchanged-work handling.
- Packaged native Harness compaction canary v1: passed with one native compaction lifecycle, continuation after compaction, and no private summary in the canonical journal.
- Packaged Harness failure canary v3: passed for idle timeout, process crash, and interrupted-checkpoint restart recovery.
- Real `builder-packaged-canary-result.v25`: passed, including restart recovery, preview pixel evidence, plan review, automatic checks, Git/SQLite revision authority, and:
  - Agent Workbench exposes Plan but no Build or Files entries;
  - Task proposal precedes Project execution;
  - a terminal candidate appears in the right Task monitor;
  - `builder.task.result.v1` is visible in Workbench;
  - `Open task` returns to the exact original Task with `draft_ready` and the unsaved draft still visible.

## Deliberate Limits

v1 does not claim the following:

- arbitrary background Pause or Cancel from the Workbench;
- renderer-owned permission resolution;
- a durable cross-Task permission-wait fact beyond existing canonical Plan/review/failure facts;
- scheduling, resource conflict resolution, or concurrency limits across parallel Tasks;
- full result artifact embedding in Workbench;
- remote Agent, channel, forum, or collaboration message ingestion.

These require separate main-owned facts and admission contracts. They must not be approximated with mutable renderer labels.

## Next Slice

The next foundational slice should add main-owned parallel Task intervention facts:

1. durable `waiting_permission` and `waiting_user_input` states;
2. request-bound Pause/Cancel/Resume admission where the runtime actually supports it;
3. cross-Task resource conflict and concurrency policy;
4. compact result acknowledgement/archive UX;
5. a real packaged restart canary that observes the same Task result before and after relaunch.

After that control-plane work, the recommended product expansion slice is Local Microgame Preview Evidence v1: isolated HTML/JS/canvas/WebGL preview with first-frame, console, network-block, and cleanup evidence. Public community or Steam-like distribution remains downstream of runtime isolation, Capsule, review, and publication authority.
