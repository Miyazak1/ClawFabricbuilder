# Native Task Resume RC

Date: 2026-08-31

## Goal

Resume the existing Builder Task after Pause or desktop restart without
resubmitting its original requirement or treating completed file writes as new
work. Preserve Main-owned project, conversation, workspace and permission
authority. Verify the real desktop through check completion and an actual Save
version click.

## Runtime Decision

The pinned Harness runtime is commit
`47f943859bef60e4160492346772ded9b24f765a` (`0.1.0-rc.5`). Its public Agent factory
supports `ctx.agents.resume({ resumeSessionId, agentOptions })`. Cold loading
restores persisted native history and balances interrupted tool protocol with
`TOOL_NOT_STARTED` or `TOOL_OUTCOME_UNKNOWN` outcomes.

The stock SDK JSON-RPC server does not expose that operation. Builder now wraps
the public server in `electron/harness/builder-session-resume-server.mjs`, adding
one session-bound `session/resume` request. This does not patch the upstream
runtime archive, invent a fresh session on failure, or replay old tool calls.
Cold-load repair notifications are not emitted as new Builder tool activity.

## Main-Owned Recovery

- Renderer sends only the selected Task Address and interrupted run ID.
- Main checks project selection and current write permission, resolves the
  original canonical work turn, and requires the latest run to be interrupted.
- A process-local trusted context plus journal-head comparison prevents forged
  or stale resume admission. Existing project writer leases and active-request
  ownership prevent concurrent execution.
- The same Task Address, turn and original user message are retained. A new run
  references the interrupted run and the original Harness session root. Repeated
  pauses continue to use that root.
- The workspace snapshot persists both in-progress edits and the original
  source baseline. Resume restores those edits only if the real project still
  matches the baseline. External changes fail closed before a new run starts.
- The model receives its native history plus a continuation instruction to
  inspect current files, preserve completed work and verify uncertain outcomes.
  It does not receive the original requirement as another submitted user turn.
- Previous browser/command approvals and pending questions are not reused as
  current execution authority. The normal Main brokers and checks still apply.

## User Interface

- Active project coding work offers an icon-only Pause button. Other Stop
  controls retain cancellation semantics; cancelled tasks are not silently
  resurrected.
- Paused work has one icon-only Resume button when the composer is empty.
  Typing a new instruction remains a normal new submission.
- Completed interruption does not leave a running spinner. Opening a paused
  task does not dispatch a provider call.
- A late submission callback no longer refills the original requirement after
  Pause, which previously hid the Resume button.
- Full and truncated history validators accept the legitimate reopened turn,
  while rejecting wrong task/run references and attempt numbers. This fixes
  the real-desktop "Activity could not be refreshed" failure that hid Save.

## Verification

- `npm run dist`: TypeScript, frontend build, Windows packaging and exact
  packaged IPC/CSP/runtime-identity verification passed.
- 407 focused Node tests passed: conversation, generation, IPC, Harness,
  programming contracts, snapshots and architecture/security boundaries.
- 465 frontend tests passed across BuilderApp (139), BuilderPage (141), composer
  (21), project controller (69), desktop generator port (37), interrupted-task
  routing (4) and conversation snapshot validation (54).
- Focused lint for Main, resume adapter, controller, composer, history validator
  and canary passed. Repository-wide lint remains non-clean from existing
  unrelated findings; this is not a claim that the full repository suite passes.
- `git diff --check` passed.

Native runtime canaries use the pinned Electron/ASAR runtime with a deterministic
loopback provider, not a mocked native resume implementation:

- `scripts/verify-builder-harness-coding-loop.cjs --resume`: cold process restart,
  restored native tool history and edited workspace, external edit rejected,
  zero resumed file writes, terminal run completed.
- `--resume-unknown`: interrupts delivery of an already-applied write receipt;
  cold recovery includes `TOOL_OUTCOME_UNKNOWN`, verifies the current file and
  completes without reapplying the write. Four provider requests, zero resumed
  writes.

Real DeepSeek desktop acceptance uses an isolated profile and source folder,
with only the user-authorized saved provider configuration copied. Original
projects/history are untouched and no project dependency install is performed.

Evidence under `release/task-native-resume-deepseek-20260831/`:

- `round-4/result.json`: close via the actual window button, reopen the same
  task, Resume, check passed, Save version clicked. 26,565 ms. One user message,
  one turn, two runs. Three file writes before and after recovery.
- `manual-pause-2/result.json`: actual composer Pause, Resume, check passed,
  Save version clicked. 34,356 ms. One user message, one turn, two runs. Three
  writes before and after recovery. Paused and saved screenshots inspected.
- `final-restart/result.json`: final same-artifact close/reopen acceptance
  passed in 24,925 ms, including the actual Save click. One user message, one
  turn, two runs, one passed check. Two writes before interruption, three after
  completion. Final saved screenshot inspected.
- Earlier failed rounds are diagnostic evidence, not successful acceptance.
  The first manual-pause run specifically exposed the composer refill race.

Reproduce the real desktop checks:

```powershell
node scripts/verify-deepseek-packaged-task-resume.cjs release/task-resume-recheck
node scripts/verify-deepseek-packaged-task-resume.cjs release/task-pause-recheck --pause
```

RC: `release/win-unpacked/ClawFabric Builder.exe`

App ASAR SHA-256:
`8A291084D3DDDB70236C831FD5D6DC5C516F588CF07A3EA024E934690537313F`

## Boundaries

- Native recovery covers project coding runs. Agent planning/chat and explicit
  cancellation are not converted into this recovery path.
- Legacy tasks without native session history and the new baseline snapshot
  cannot be upgraded into guaranteed native recovery. No fallback resubmission
  is hidden behind Resume.
- An externally edited source baseline needs explicit reconciliation; this RC
  rejects it instead of merging or overwriting it automatically.
- Exactly-once recovery of arbitrary external side effects is not claimed. The
  uncertain-write canary proves inspect-before-reapply for file edits; other
  uncertain operations still require their own evidence and current authority.
- Native session and resumable workspace records are durable task data, not
  evicted by the 64-entry preview cache. A broader task-history retention policy
  remains separate work.
- No commit or GitHub push was performed for this goal.
