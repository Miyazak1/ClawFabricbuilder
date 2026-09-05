# Task Restart Pause RC

Date: 2026-08-31

This document records the earlier resubmission-based implementation. Native
session recovery and its current desktop acceptance are documented in
`BUILDER_NATIVE_TASK_RESUME_RC_2026_08_31.md`; the semantic limitation below is
historical, not the current Resume implementation.

## Observed Failure

The saved test13 task retained an active turn and its final runtime status after
the desktop process exited. The task monitor already recognized the missing
active request, but the task conversation replayed the old status animation.
Existing recovery only ran when another turn was submitted.

The isolated saved-history copy confirmed one run, head sequence 16, an active
turn, and no terminal result. Its last runtime status was generation finishing.

## Change

- Before projecting an opened task, Main reconciles an inactive recorded run
  through the existing interruption event chain. No provider dispatch, source
  write, permission grant, or automatic resubmission occurs.
- The conversation service tracks turns started by the current process. Active
  work, retry windows, and cancellation settlement cannot be mistaken for a
  restart orphan, including paths without task-monitor cancellation bindings.
- Unreadable canonical history still uses the existing transcript fallback.
- Interrupted tasks display a static paused result. Completed interrupt-control
  rows and stale progress animations do not remain in the visible timeline.
- The empty composer offers one icon-only Resume button with a tooltip. Per the
  latest UI request, there is no adjacent paused label or extra pause icon.
- Resume preserves the original submitted instruction and Plan/Build/Ask route,
  using the existing submission and approval path. Typed input remains a normal
  submission. Opening the task does not resume it.

## Verification

- TypeScript build and Windows package verification passed.
- Frontend: 303 tests across BuilderApp, BuilderPage, BuilderComposer, and
  interrupted-task routing passed. The final icon-only change was rechecked in
  the 165 relevant Page/Composer/routing tests.
- Main conversation, generation IPC, and task monitor: 121 tests passed.
- Architecture, Electron security, and task-stream IPC: 19 tests passed.
- Focused lint for changed Main, composer, routing, and canary code passed.
  BuilderPage lint still reports its pre-existing unused review-state type import
  and synchronous terminal-tab effect. Both were verified in HEAD; they are not
  changed by this fix. A repository-wide clean lint/test claim is not made.
- Actual packaged desktop opened the saved task in an isolated profile twice.
  First opening recorded interruption and cleared active_turn_id (head 16 to 19).
  The second restart left history unchanged. Run count remained one throughout.
  The Resume button was enabled; no Stop button, progress spinner, or adjacent
  paused label was present. Both screenshots were inspected.
- Real-provider execution after Resume was not run in the initial verification. Resume
  through explicit write approval is covered by the BuilderApp integration test.
  The desktop canary copied no provider settings or credentials and did not click
  Resume. Original project files and the original history profile were untouched.

Evidence: `release/task-restart-recovery-20260831/result.json`, `paused-task.png`,
and `paused-task-reopened.png` in the same directory.

Reproduce: `node scripts/verify-packaged-task-restart-recovery.cjs`

RC: `release/win-unpacked/ClawFabric Builder.exe`

## Real Desktop Follow-Up

The follow-up clicked the actual window Close button during real DeepSeek tool
activity. This revealed that normal shutdown recorded user cancellation, unlike
an orphaned run. Main now uses a separate internal `pause_for_shutdown` operation:
it durably records an interrupted project turn before aborting transport/Harness.
Explicit user Stop remains cancelled. Harness receives the shutdown reason, and
late cancellation settlement cannot overwrite the recorded interruption.

`scripts/verify-deepseek-packaged-task-resume.cjs` uses a fresh isolated profile and
source directory. Only the authorized provider configuration is copied; original
project bindings and history are not copied. No package installation is requested.

Round 4 completed in 59,793 ms:

- Real tool activity, Close window, reopen the same Task Address, Paused.
- Opening did not dispatch another run. Clicking the icon-only Resume did.
- The second run completed as succeeded/candidate; one Builder check passed.
- The required three files existed and their required content was verified.
- Save version was actually clicked and Version 1 appeared. No active turn or
  Resume/Stop control remained. Screenshots were inspected.
- 232 focused Main and authority-boundary tests passed. Focused lint,
  TypeScript build and Windows package verification passed.

Evidence: `release/task-resume-deepseek-20260831/round-4/result.json` and numbered
screenshots in that directory. Earlier rounds contain script diagnostics and the
pre-fix normal-close cancellation reproduction, not successful resume results.

### Semantic Limitation

The user correctly identified that the current Resume callback submits the
original instruction again. It creates a second user message and a new turn.
This can complete a build, but is not evidence of checkpoint-aware continuation.
The successful canary intentionally verifies this current resubmission behavior;
it must not be presented as acceptance of true resume semantics.

A subsequent design needs Main-owned resume admission bound to the original task,
approved plan, interruption, completed operations and current workspace facts.
It should record a resume event rather than duplicate a user message, validate
existing changes, and continue only remaining work. A new execution run may be
necessary after process exit; that is distinct from starting the task over.

Current RC ASAR SHA-256:
`60F207A80BDE6D22E54F03921987DBF05A224B27B0F8A1A67B7584DB866ACC8A`
