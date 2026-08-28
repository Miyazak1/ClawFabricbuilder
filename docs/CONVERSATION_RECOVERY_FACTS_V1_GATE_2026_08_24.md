# Conversation Recovery Facts V1 Gate

Date: 2026-08-24

Status: implemented and release-gated

## Objective

Make recovery, checkpoint, control, and review outcomes part of the Main-owned
conversation fact stream while preserving the DeepSeek Harness runtime as the
programming execution authority. The chat stream is the primary user-visible
fact line; History and inspectors remain the detail views.

## Delivered Contract

- `checkpoint_recorded` is a canonical conversation event with bounded public
  fields: status, changed file count, and verification status.
- One active run may record an initial checkpoint followed by one or more
  `updated` checkpoints. A second `created` checkpoint remains invalid.
- `recovery_action_recorded` exposes requested, completed, and failed recovery
  lifecycle phases without checkpoint ids, paths, Git receipts, or source.
- cancel and interrupt requests remain visible as bounded run-control facts.
- save and discard outcomes continue to use the existing Main-owned candidate
  review facts rather than renderer-manufactured completion copy.
- checkpoint, recovery, run-control, save, and discard rows survive restart
  through SQLite replay and task-stream projection.
- the renderer sanitizer and packaged evidence sanitizer enforce the same
  checkpoint evolution contract as Main replay.

## User Experience

- Checkpoint rows use low-noise Chinese copy and expose relevant Undo and
  History actions.
- A duplicate renderer-only checkpoint summary was removed.
- successful checks are represented by the activity stream and review state;
  failures and active checks retain attention-level visibility.
- raw provider reasoning and private Harness logs are not projected into chat.
  Bounded reasoning/activity/step/compaction statuses remain collapsible facts.

## DeepSeek Harness Alignment

The implementation does not translate Harness events into renderer authority.
Harness runtime events advance the trusted conversation context, Main records
product-level checkpoint and recovery facts, and SQLite replay remains the
conversation authority. Provider context disclosure and compaction summary
egress still pass through their existing gates.

## Packaged Bugs Found And Closed

1. The packaged canary rejected the new canonical event kinds and counted an
   obsolete item total. Its strict sanitizer and count contract now include
   checkpoint, recovery, run-control, and runtime status facts.
2. Source evidence could be checked before the first code line rendered. The
   canary now waits for ready line evidence instead of racing the file panel.
3. automatic check approval time was captured before runtime identity
   resolution. Strict admission could reject the authorization as older than
   the resolved runtime. Runtime resolution now precedes approval timestamping.
4. Harness runtime events advanced `state.context`, while automatic checkpoint
   completion used the stale context captured at run start. Checkpoint and
   candidate completion now continue from the latest runtime context.
5. a failed check repair creates a checkpoint and then updates it after repair.
   Main replay, renderer sanitization, and canary sanitization incorrectly
   allowed only one checkpoint per run. All three now accept bounded `updated`
   evolution and continue to reject a second `created` checkpoint.

## Verification

The final `npm run verify:release` completed with exit code 0.

- ESLint: passed.
- frontend unit tests: 57 files, 932 tests passed.
- architecture and Main-side boundary tests: 1855 passed, 1 expected skip.
- TypeScript and Vite production build: passed.
- Windows package and packaged launch smoke: passed.
- full packaged coding, checkpoint, undo, restart, and recovery canary: passed.
- packaged Plan Mode approval and execution canary: passed.
- packaged Harness UI repair, continuation, restart, undo, cancellation, and
  workspace-boundary canary: passed.
- packaged native Harness compaction canary: passed.
- packaged idle-stall, crash, and interrupted-checkpoint canary: passed.

Non-blocking warnings remain: existing React test `act(...)` warnings and the
existing Vite chunk-size warning.

## Follow-up Boundary

The next UI cleanup may reduce the project toolbar to current context, one
attention-worthy status, the primary Run action, and overflow. Undo, checkpoint,
successful check, save, and restore explanations should stay in the conversation
fact line or History instead of becoming permanent toolbar controls.
