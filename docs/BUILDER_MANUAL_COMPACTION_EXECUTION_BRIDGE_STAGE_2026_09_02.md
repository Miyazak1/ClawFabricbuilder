# Builder Manual Compaction Execution Bridge Stage - 2026-09-02

## Stage Goal

Add the first Main-owned execution bridge after manual compaction admission.

The bridge must prove that Builder will not call Harness manual compaction from
renderer state, free-form prompt text, or a stale conversation head. A valid
`builder-context-compaction-admission-record.v1` must be verified before the
runtime compaction method can be invoked.

## Harness Baseline

Sources:

- DeepSeek Harness compaction subsystem:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md
- DeepSeek Harness compaction package:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction/README.md
- DeepSeek Harness compaction API types:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction/src/index.ts
- Queued manual compaction design note:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-30-queued-manual-compaction.md

Findings:

- Manual `/compact` should not enter model history as normal prompt text.
- The command path calls `compactNow(agent, signal, sourceCommandId?)`.
- Manual compaction uses `turn: null`; automatic pressure compaction uses the
  active turn owner.
- `compaction/start`, `compaction/summary`, and `compaction/end` are log-only
  bookkeeping events. The successful surface mutation is a single replacement
  summary message.
- `compactNow` may return `null` when no useful safe range exists.
- Expected failures have a closed manual taxonomy. Pre-start busy/cancel cases
  leave no log record; failures after start are represented by `compaction/end`
  with error evidence.

## Builder Baseline

Builder already had:

- `builder-context-compaction-admission-record.v1`, an admission-only receipt;
- `builder-conversation-compaction-projection.v1`, a bounded committed
  conversation projection;
- `builder-context-compaction-summary.v1`, a bounded summary record;
- `builder-context-compaction-recording-service.v1`, a post-hoc committed
  summary recorder;
- `builder-context-usage-projection.v2`, runtime token pressure and compaction
  lifecycle projection;
- Harness lifecycle normalization for `compaction/start` and `compaction/end`.

The missing execution boundary was the bridge between the admission receipt and
the future Harness runtime method.

## Implemented Cut

Added `electron/builder-context-compaction-execution-bridge.cjs`.

The bridge:

- requires a `harness_runtime.manual_compact()` method supplied by Main;
- accepts only:
  - `session_id`;
  - `context_compaction_admission`;
  - `conversation_compaction_projection`;
  - `abort_signal`;
- sanitizes the admission against the exact conversation compaction projection
  before runtime invocation;
- passes a bounded runtime request containing:
  - the verified session id;
  - `source_command_id` equal to the admission id;
  - the abort signal;
- accepts a real `AbortController.signal` and forwards it unchanged;
- converts raw Harness success into
  `builder-context-compaction-execution-result.v1`;
- converts Harness `null` into `manual_compaction_noop`;
- rejects malformed Harness result ordering such as `summarySeq` before
  `startSeq`;
- normalizes runtime exceptions to a safe Builder bridge error.

The result intentionally does not include summary text, raw provider output,
source tree content, permission grants, SQLite writes, or revision authority.

## Boundary Left For Next Stage

This stage does not add:

- renderer or IPC command entry;
- a visible Composer/context-meter button;
- a real packaged Harness process-host invocation.

Those are now clearer follow-up cuts because they can consume the execution
bridge instead of inventing their own compaction authority.

## Verification

- `node --test tests\builder-context-compaction-execution-bridge.test.cjs`
- `node --test tests\builder-context-compaction-execution-bridge.test.cjs tests\builder-context-compaction-admission.test.cjs tests\builder-context-compaction-summary.test.cjs tests\builder-context-compaction-recording-service.test.cjs tests\builder-context-usage-projection.test.cjs`
- `npm exec tsc -b --pretty false`

The broader node test includes existing SQLite recording-service tests and needs
Windows Temp directory access. The read-only sandbox run failed only on Temp
directory creation; the same command passed with the required temp permission.
