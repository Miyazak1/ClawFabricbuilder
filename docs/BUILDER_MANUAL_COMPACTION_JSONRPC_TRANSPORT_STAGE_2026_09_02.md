# Builder Manual Compaction JSON-RPC Transport Stage - 2026-09-02

## Stage Goal

Move manual context compaction from an abstract execution bridge toward a real
packaged Harness transport path, while keeping Main as the only admission and
execution authority.

## Harness Baseline

Sources reviewed:

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction/src/index.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-30-queued-manual-compaction.md

Findings:

- Harness already has manual compaction semantics through
  `compactNow(agent, signal, sourceCommandId?)`.
- Manual compaction binds to `turn: null`; automatic pressure compaction binds
  to the active turn.
- `compaction/start`, `compaction/summary`, and `compaction/end` are lifecycle
  records. The user-visible history mutation is the replacement summary.
- `compactNow` may return `null` when no useful safe range exists.
- Public source/search did not show an existing SDK JSON-RPC method named
  `session/compact`, so Builder now defines a narrow local transport contract
  that matches Harness manual compaction semantics without widening authority.

## Implemented Cut

Transport changes:

- `electron/builder-harness-jsonrpc-peer.cjs` now whitelists
  `session/compact`.
- `session/compact` uses the same long-running timeout policy as prompt and
  recovery requests.
- `electron/builder-harness-process-host.cjs` exposes `manual_compact()`.
- The host accepts only:
  - `session_id`;
  - `source_command_id`.
- The host sends only:
  - `sessionId`;
  - `sourceCommandId`.
- `source_command_id` must be a
  `builder-context-compaction-admission:<sha256>` id.
- Harness `null` is preserved as a no-op result.
- Harness success must echo the source command id and provide ordered
  `startSeq < summarySeq < endSeq` lifecycle sequence numbers.
- Remote JSON-RPC failures are normalized to safe Builder host errors without
  exposing runtime messages.

Bridge changes:

- `electron/builder-context-compaction-execution-bridge.cjs` now requires a
  verified Harness session id before invoking runtime compaction.
- The bridge still verifies the admission receipt against the current
  conversation compaction projection before any runtime call.
- The bridge now passes only `session_id`, `source_command_id`, and
  `abort_signal` to the runtime layer.

Runtime composition changes:

- Host wrappers preserve optional `manual_compact()` when the concrete process
  host supports it.
- Existing programming runs do not require manual compaction support during
  startup, so current prompt/resume/recovery paths remain unchanged.

## Boundary Still Left

This stage still does not add:

- renderer or IPC command entry;
- a visible Composer/context-meter button;
- automatic triggering from token pressure;
- post-compaction UI recovery or toast messaging.

## Verification

- `node --test tests\builder-harness-jsonrpc-peer.test.cjs`
- `node --test tests\builder-harness-process-host.test.cjs`
- `node --test tests\builder-context-compaction-execution-bridge.test.cjs`
- `node --test tests\builder-harness-jsonrpc-peer.test.cjs tests\builder-harness-process-host.test.cjs tests\builder-context-compaction-execution-bridge.test.cjs`
- `node --test tests\builder-harness-programming-runtime.test.cjs`
- `node --test tests\builder-harness-runtime-composition.test.cjs`
- `npm exec tsc -b --pretty false`

The runtime-composition test requires Windows Temp directory access for its
fixture workspaces. The read-only sandbox run failed only on `mkdtemp`; the
same command passed with the required temp permission.
