# Builder Chat And Generation Performance Plan

Date: 2026-08-25

Status: measured performance evidence and implementation companion to
prerequisite Gate A0.

Architecture authority:
[Builder Event And Projection Foundation Architecture](BUILDER_EVENT_PROJECTION_FOUNDATION_ARCHITECTURE_2026_08_25.md).
Measured repository evidence:
[Builder Current Event And Projection Architecture Audit](BUILDER_CURRENT_EVENT_PROJECTION_ARCHITECTURE_AUDIT_2026_08_25.md).

## Background And Goal

Current user-visible symptoms include delayed message submission, visible
stalls while generation starts or streams, output/composer layout instability,
and concern that opening the Side Workspace or future Browser will amplify chat
work.

The goal is not to trade correctness for smooth animation. Builder must retain:

- Main/SQLite/Git authority;
- canonical Conversation replay and recovery;
- runtime tool facts, checkpoints, Undo, Review, Save, and Discard;
- Browser session and action truth;
- renderer/provider isolation.

The performance rule is:

> Hot paths are narrow and transient; cold paths are complete and durable.

Live text, process output, and Browser progress should update small dedicated
stores. Main-owned durable events remain complete, but they are committed and
projected at meaningful boundaries rather than forcing the entire product graph
through every high-frequency update.

## Assessment Status

This document distinguishes three evidence levels:

- `confirmed by source audit`: a control/data path is present in the current
  repository;
- `measurement required`: its contribution to wall time, frames, or user delay
  has not yet been quantified on a reference build.
- `measured scaling signal`: a focused source or SQLite probe has established
  growth behavior, but a packaged, repeated p95 baseline is still required.

The source audit and focused probes confirm total-history amplification in the
current append/read/projection path. Synthetic task projection rose from a
15.50 ms median at 100 events to 282.18 ms at 3,200 events. Synthetic SQLite
append reached 426.78 ms at 1,000 events. Current desktop data also shows runtime
facts are 47.9% of stored Conversation events. These are scaling signals, not a
packaged end-to-end p95 baseline, so Gate A0 still begins with redacted product
instrumentation and reproducible scenarios.

The first checked-in reproducible runner is now
`scripts/measure-builder-event-projection-baseline.cjs`. A 2026-08-25 run
measured 15.899 ms median at 100 events and 108.837 ms at 1,200 events. Slice
`A0.2a` also proves that 100 typed `live_only` hints cause zero complete
renderer task-stream reads. These results establish refresh isolation, not
incremental persistence or projection.

The first numeric-only packaged baseline now covers `PB-01`, `PB-02`, `PB-04`,
`PB-05`, `PB-07`, and `PB-10`. Its second phase measured a 6,108.0 ms renderer
task-stream read p95 while clone/freeze was only 10.2 ms p95; repeated complete
Conversation load/replay/projection and event-loop contention are therefore the
next measured target. See
[Builder A0 Packaged Performance Baseline](BUILDER_A0_PACKAGED_PERFORMANCE_BASELINE_2026_08_25.md).

## Current Mechanism Audit

### 1. Submit Path

Confirmed control path:

```text
BuilderComposer
-> BuilderPage onSubmitInstruction
-> BuilderApp submitInstructionText
-> intent / permission / project-state preparation
-> BuilderProjectController
-> generator submit | generate | generateApprovedPlan | answer | answerDraft
-> builderDesktopCodeGeneratorPort
-> Electron generation IPC runtime
-> builder-generation-main-service
-> selected runtime/provider
```

Relevant current sources:

- `src/features/builder/presentation/BuilderComposer.tsx` invokes
  `onSubmitInstruction`;
- `src/app/BuilderApp.tsx` owns `submitInstructionText`, intent classification,
  and generator routing;
- `src/features/builder/application/builderProjectController.ts` owns project
  generation transitions;
- `src/features/builder/infrastructure/builderDesktopCodeGeneratorPort.ts`
  sanitizes/clones the desktop boundary;
- `electron/builder-generation-ipc-runtime.cjs` binds renderer calls to Main;
- `electron/builder-generation-main-service.cjs` owns the admitted generation
  run and provider-output callback.

Measurement required: time from click/key submit to local optimistic user row,
to Main admission, to provider/runtime start, and to first visible output.
These spans must be separated; one aggregate "generation time" cannot identify
UI, Main, runtime, or provider delay.

### 2. Live Output Fast Path

Confirmed current fast path:

```text
generation Main onProviderOutputDelta
-> GENERATION_OUTPUT_CHANNEL
-> renderer liveOutputStore
-> requestAnimationFrame-batched projection
-> current Activity live-output slot
```

This is directionally correct: partial provider text does not need a complete
Conversation read to become visible.

Measurement required:

- input delta frequency and bytes;
- batches per second;
- time from Main observation to renderer commit;
- dropped/coalesced updates;
- Activity subtree versus full-app React commits.

### 3. Durable Task-Stream Slow Path

Confirmed current slow path can overlap live work:

```text
runtime event
-> record_programming_runtime_event
-> appendConversationEvents
-> notifyTaskStreamChanged
-> renderer subscription
-> task-stream read
-> sanitize / replay / project / clone / freeze
-> controller snapshot update
```

`electron/builder-conversation-main-service.cjs` emits task-stream changes.
`electron/builder-agent-conversation-service.cjs` exposes `read_stream`.
`electron/builder-generation-ipc-runtime.cjs` connects generation events and
stream reads.

The architectural issue is not durable recording itself. It is that a generic
`changed` signal can cause consumers to reacquire a complete projection even
when only one high-frequency item changed.

Measurement required: changed events per second, reads triggered per changed
kind, bytes returned, time waiting in the Main event loop, and redundant reads
coalesced by later snapshots.

### 4. SQLite Append, Read, Replay, And Projection

Confirmed current work in
`electron/builder-product-metadata-database.cjs`:

- `loadConversationState` selects and reconstructs Conversation state;
- event rows are JSON parsed, sanitized, canonical-JSON checked, and replayed;
- `appendConversationEvents` loads state before append and again after append;
- task-stream projection traverses events, creates public items, computes
  serialized size, and deep-freezes results.

These checks protect authority and replay correctness. Removing them globally
is not an accepted optimization. The target is to avoid repeating complete
validation/materialization on a hot append when the existing committed prefix
and cached projection are already known.

Measurement required:

- event count and stored bytes per conversation;
- `loadConversationState` p50/p95/max duration;
- append transaction duration split into pre-load/write/post-load;
- JSON parse/sanitize/canonical-check/replay/projection duration;
- cache hit/miss and cursor distance;
- synchronous Main blocking spans.

### 5. Renderer IPC Graph Validation

Confirmed current task-stream port behavior in
`src/features/builder/infrastructure/builderDesktopTaskStreamPort.ts`:

```text
assertPlainGraph
-> structuredClone
-> assertPlainGraph
-> deepFreeze/sanitized result
```

The generator and other ports also clone/sanitize at their trust boundaries.
This is valuable for renderer safety, but cost grows with graph bytes and
becomes wasteful when a small live update causes a multi-megabyte stream or
source projection to cross again.

Measurement required: payload bytes, graph node count, each validation/clone/
freeze duration, and which fields dominate size. The fix is primarily payload
shape and incremental reads, not deleting boundary checks.

### 6. React Subscription And Render Scope

Confirmed current structure:

- `BuilderApp` combines project, Conversation, catalog, tree, Workbench, and
  generation state;
- multiple hooks use `useSyncExternalStore` and return controller snapshots;
- `BuilderPage.tsx` is a large presentation surface containing Activity,
  composer, changes, command output, and Side Workspace wiring;
- `activityEntries(snapshot)` traverses Conversation items and builds temporary
  maps/sets/filtered/reversed collections during render;
- draft rendering computes `createBuilderSourceTreeChanges`, including source
  text splitting/diff work;
- command output has another external-store subscription.

A changed broad snapshot can therefore rerun work unrelated to the changed
field. Memoization alone cannot help if props and controller snapshots are
recreated broadly.

Measurement required: React Profiler commit count/duration and committed
component names for submit, delta, durable tool event, draft update, side-panel
resize, Browser observation, and Browser progress.

### 7. Side Workspace And Browser Coupling Risk

The current Side Workspace is rendered within `BuilderPage`. A future Browser
adds expensive, stateful Main and view resources. If Browser props or layout are
derived from broad chat snapshots, streaming can cause repeated React work,
layout measurement, or accidental remount even when the browser session did not
change.

Required boundary:

- Main Browser session outlives incidental Activity renders;
- Browser host identity is keyed by `browser_session_id`, not Conversation
  snapshot identity;
- chat delta cannot recreate tabs, WebContentsView, observation buffers, or
  resize observers;
- Side Workspace width/mode state has a dedicated store;
- Browser observations use lazy evidence refs and a dedicated projection.

## Instrumentation Plan

Add one opt-in local performance recorder controlled by a documented development
flag, for example `BUILDER_PERF_TRACE=1`. It records numeric spans and counters,
not message text, source, URLs, screenshots, cookies, credentials, or command
output.

### Main Spans And Counters

- generation IPC handler queue/start/end duration;
- intent and permission preparation duration;
- provider/runtime start and first-delta timestamps;
- SQLite append/load/transaction duration;
- Conversation event count and encoded bytes;
- JSON parse, sanitizer, canonical check, replay, and projection duration;
- task-stream changed events by type and cursor;
- task-stream read count, result bytes, and cache distance;
- synchronous fs/Git/check/checkpoint spans;
- process output input frequency versus committed durable updates;
- Browser observe/action duration, result bytes, and cleanup duration;
- Main event-loop delay histogram during scenarios.

### Renderer Spans And Counters

- IPC result bytes;
- assert/clone/sanitize/freeze duration;
- live-output received, batched, rendered, and dropped counts;
- task-stream subscription event and actual read counts;
- controller publish counts by store;
- React commit count/duration by major subtree;
- Activity entry projection and source-tree diff duration;
- composer input latency and long tasks;
- Side Workspace/Browser mount, unmount, resize, and layout counts.

### Correlation

Use opaque local trace ids:

```text
submit_trace_id
run_id
task_stream_cursor
runtime_request_id
browser_session_id
```

Do not use project names, prompts, filenames, URLs, or user account identifiers
as trace labels.

## Baseline Scenarios

Run each scenario at least five warm repetitions and retain median, p95 where
sample size permits, and worst observed value. Use the same packaged debug
artifact, machine power mode, fixture revision, Harness/provider stub, and
window size for before/after comparisons.

| ID | Scenario | Fixture |
| --- | --- | --- |
| `PB-01` | ordinary Ask with no file mutation | short active log and 10,000 historical facts across segments/checkpoints |
| `PB-02` | Build/generate with one edit and check | deterministic JS fixture |
| `PB-03` | 60-second long text stream | controlled delta rate and total bytes |
| `PB-04` | multi-tool repair loop | reads, searches, edits, failed/passed checks |
| `PB-05` | multi-file unsaved draft | large source tree and diff fixture |
| `PB-06` | command output burst | 10 MB mixed stdout/stderr with spill |
| `PB-07` | generate while Side Workspace is open | Preview/Changes/Terminal variants |
| `PB-08` | generate while Agent Test Browser is open | stable local page plus observations |
| `PB-09` | resize/collapse Side Workspace during stream | narrow and normal window widths |
| `PB-10` | renderer reload/reconnect during stream | durable/transient reconciliation |

Baseline report template:

| Metric | Before | After P0 | After P1 | Budget | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| submit to optimistic user row | pending | pending | pending | <= 50 ms p95 | pending |
| submit to Main admission | pending | pending | pending | measured/regression <= 10% | pending |
| Main delta to visible commit | pending | pending | pending | <= 100 ms p95 | pending |
| task-stream reads per 100 text deltas | pending | pending | pending | <= 2 unless durable boundaries require more | pending |
| full projection replays per 100 text deltas | pending | pending | pending | 0 | pending |
| Main long tasks > 50 ms | pending | pending | pending | 0 during normal stream | pending |
| full BuilderPage commits per 100 deltas | pending | pending | pending | 0 unrelated commits | pending |
| Browser remounts during one chat stream | pending | pending | pending | 0 | pending |
| composer input long tasks > 50 ms | pending | pending | pending | 0 | pending |

No number should be invented before the trace exists. The first implementation
change produces and checks in a dated baseline report.

## Phased Optimization

### P0A: Measure And Make Change Kinds Visible

- add the opt-in trace spans/counters;
- add opaque correlation ids;
- run `PB-01` through `PB-07` before behavior changes;
- type task-stream changed notifications at least as `live`, `activity_append`,
  `activity_settle`, `conversation_terminal`, `draft`, `project`, and `browser`;
- record refresh reasons and bytes.

Exit: baseline report identifies actual dominant spans and refresh fan-out.

### P0B: Stop Durable Full Refresh Per Delta

- keep `assistant_text_delta` and equivalent process/browser progress in
  transient stores;
- commit durable assistant blocks at bounded interval, semantic block end, tool
  boundary, cancellation, or terminal state;
- coalesce changed notifications by stream/cursor and flush once per bounded UI
  interval;
- do not call full task-stream `read` for a live-only change;
- preserve exact terminal text and recoverable committed boundaries.

Exit: `OUT-004`, `PERF-001` through `PERF-003`, replay, cancellation, and
duplicate-terminal tests pass; before/after trace proves refresh reduction.

### P0C: Localize Live Activity Rendering

- move live Activity state behind a narrow selector/store;
- isolate ActivityPanel from project catalog/tree/workbench snapshots;
- keep composer draft/input state local and responsive;
- memoize stable settled rows only after store boundaries are corrected;
- move expensive source-tree change computation behind draft/source identity
  and lazy Changes opening.

Exit: React trace proves live deltas do not recommit unrelated BuilderApp,
project tree, Side Workspace, or Browser subtrees.

### P1A: Incremental Task Stream

- add cursor-based reads and typed append batches;
- cache validated committed prefixes and disposable projections in Main;
- update public visible windows from appended events;
- rebuild from full canonical SQLite history on cache miss/corruption;
- preserve full replay tests as the correctness oracle.

Exit: warm projection cost tracks cursor distance; a fixture with 10,000
historical facts across segments/checkpoints remains interactive and
full-rebuild equality tests pass.

### P1B: Payload Slimming And Lazy Evidence

- separate Activity summary from source tree, draft bodies, diffs, full logs,
  screenshots, DOM, and preview data;
- return immutable bounded refs/digests from chat reads;
- load file/diff/log/browser evidence only when its inspector is opened;
- cap every payload and make truncation explicit;
- retain boundary validation on the smaller graphs.

Exit: payload traces prove routine deltas/settlements do not carry heavyweight
fields; Review, Preview, Terminal, and Browser inspectors still resolve exact
authorized evidence.

### P2A: Main Cold-Path Scheduling

- batch safe SQLite appends and projection updates;
- move CPU-heavy canonicalization/projection or read-only Git/fs work to a
  worker where authority ordering remains explicit;
- keep SQLite transaction ownership and mutation decisions in Main;
- prohibit worker results from becoming facts without Main validation;
- monitor event-loop delay and shutdown/cancellation behavior.

Exit: no normal streaming long task exceeds the release budget, with unchanged
replay and authority evidence.

### P2B: Stable Side Workspace And Browser Boundary

- split Side Workspace/Browser lifecycle from chat Activity rendering;
- use stable session/tab identity and dedicated layout state;
- apply resize updates only when dimensions actually change and coalesce them;
- keep Browser WebContentsView ownership in Main;
- lazy-load Browser observations and prevent chat payload crossover;
- verify no remount, navigation reset, or lost Browser state during generation.

Exit: `PB-08`/`PB-09`, Browser cleanup, layout stability, and React isolation
cases pass in the packaged app.

## Risks And Controls

| Risk | Control |
| --- | --- |
| transient deltas are lost on crash | commit bounded semantic/interval checkpoints and exact terminal blocks |
| coalescing hides tool facts | never coalesce call/result settlement identities; only refresh notifications/progress |
| cached projection diverges | full replay remains oracle; digest/cursor check and cache discard on mismatch |
| lazy payload breaks Review/Undo | immutable evidence refs resolve through Main and are covered by recovery tests |
| worker reorders authority | Main assigns sequence/commit and validates worker output |
| component split creates stale UI | selector contract tests and durable reload/reconnect integration tests |
| Browser appears smoother by losing state | session/action evidence and no-remount canaries |
| instrumentation leaks content | numeric/redacted schema, opt-in flag, tests rejecting sensitive fields |

## Functional Non-Regression Matrix

Every phase reruns:

- Conversation append/replay/canonical validation;
- Ask, Plan, Build, continuation, and cancellation;
- paired runtime tool call/result facts;
- failed-check repair and passed check;
- draft Review, Save, Discard, checkpoint, Undo, and restore;
- stale edit and source escape denial;
- renderer reload and Main/runtime interruption reconciliation;
- latest output/composer docking and resolved Save-card disappearance;
- Preview and Browser session isolation, action evidence, and cleanup;
- packaged deterministic and required real-provider canaries.

## Performance Acceptance

Use the detailed `PERF-*` cases in
[Universal Programming And Browser Acceptance Matrix](UNIVERSAL_PROGRAMMING_AND_BROWSER_ACCEPTANCE_MATRIX.md).
At minimum, release qualification requires:

- optimistic user row remains immediate;
- normal live output is visible within 100 ms p95 of Main observation;
- no full task-stream replay/read occurs per text delta;
- task-stream change bursts are typed and coalesced;
- Main has no unexplained >50 ms blocking span during normal streaming;
- composer input has no >50 ms long task during normal streaming;
- routine chat updates do not carry source/diff/log/browser bodies;
- Browser and Side Workspace do not remount or reset during chat streaming;
- 10,000 historical facts across segments/checkpoints and 10 MB output fixtures
  remain bounded and interactive;
- measured after-values and artifact identity are stored in a dated report.

## First Implementation Slice

The first code slice is Gate `A0.1`, followed by one vertical `A0.2` cut:

1. add local numeric tracing around task-stream changed/read, SQLite
   load/append/replay/projection, renderer clone/freeze, and React commit scope;
2. capture the `PB-01` through `PB-07` baseline;
3. inventory historical event/storage schemas and freeze copied fixtures;
4. define typed change and live-stream envelopes;
5. route assistant text delta to the live plane without a full task-stream read,
   while retaining final assistant completion and bounded recovery evidence;
6. rerun the same scenarios and publish the first before/after report.

Do not begin worker migration, broad component rewrites, universal Process/
Terminal providers, or Browser runtime work until this slice identifies and
reduces the measured hot path without breaking canonical replay.

## Current B-Line Handoff

As of 2026-08-27, A1 dependency readiness has closed the stale
environment/dependency failure loop. The next performance track starts with
[Builder B1 Performance Cold-Path Attribution](BUILDER_B1_PERFORMANCE_COLD_PATH_ATTRIBUTION_2026_08_27.md).

B1 keeps the investigation narrow:

- measure submit admission, streaming, durable runtime persistence, reconcile,
  conversation storage, task-stream projection/IPC, and renderer commit as
  separate buckets;
- do not collapse user wait, command runtime, durable settlement, and renderer
  commit into one generation-duration number;
- do not mix Browser Node activation, sandbox provider work, Workbench plugin
  architecture, or dependency installation into the performance slice.

The preferred B2 implementation target is durable terminal settlement
decoupling: preserve canonical Main/SQLite facts while preventing terminal
settlement from forcing full projection/read/IPC work onto the visible chat
path.

## Current G-Line Handoff

As of 2026-08-27, the next measured bottleneck is the end-to-end Harness tool
path:

```text
DeepSeek Harness maxParallelToolCalls
-> builder-tool-broker-plugin read/grep
-> loopback broker
-> Builder Main workspace tools
-> task-stream projection and renderer presentation
```

The mechanism risk is not that read/grep are unsafe. It is that Harness can
legitimately issue several concurrency-safe calls at once, while Builder Main
owns the source snapshot and previously served every `search` by synchronously
scanning every file and splitting/lowercasing content per request.

Implemented G1 controls:

- the per-run Harness tool broker now applies a read/search scheduler before
  dispatching to workspace tools;
- `search` is limited to one active request per run because it is CPU-heavy and
  scans the source snapshot;
- `read` is limited to two active requests per run, preserving useful parallel
  throughput without letting a burst monopolize Main;
- edit/write keep their existing workspace mutation ordering instead of being
  moved into the read/search scheduler;
- queue pressure is recorded with numeric-only metrics:
  `main.harness_tool_broker.tool_search.queued_count`,
  `main.harness_tool_broker.tool_search.queue_wait.duration_ms`,
  `main.harness_tool_broker.tool_search.active_count`,
  `main.harness_tool_broker.tool_read.queued_count`,
  `main.harness_tool_broker.tool_read.queue_wait.duration_ms`, and
  `main.harness_tool_broker.tool_read.active_count`;
- workspace `search` now uses a per-run in-memory source-tree index with folded
  paths and lines, refreshed after successful edit/write operations.

Boundaries:

- Main remains the authority for source-tree admission and tool dispatch.
- The search index is a pure derivative of the already-sanitized run snapshot;
  it does not read from disk and does not gain filesystem, process, renderer,
  provider, Git, SQLite, or Browser authority.
- Browser/Preview sandboxing remains independent from command/tool sandboxing.
  Browser WebContents policy should not be used as a subprocess sandbox, and
  command/tool scheduling should not control Browser navigation state.
- This slice does not change dependency install policy. Dependency preparation
  still follows detection first, then explicit one-time user approval, then
  isolated workspace preparation.

Next G slices:

1. G2 adds packaged PB-07: a controlled Harness turn that emits four `read`
   calls and four `grep` calls in one tool batch. The packaged stress gate must
   prove that `search` never exceeds one active broker execution per run, `read`
   never exceeds two, and both queues recorded wait pressure.
2. Renderer read/search presentation remains summary-first: task-stream only
   exposes read metadata and bounded search locations, while file content and
   command output stay behind explicit side-workspace/terminal reads. This is
   the lazy-open boundary for G2; future UI polish can make the affordance more
   visible without changing the data contract.
3. Move source-tree search from Main to a worker only after the scheduler and
   per-run index show remaining Main event-loop pressure. Main must still
   validate worker output before it becomes a tool result.
4. Fold these metrics into the existing packaged stress evidence gate alongside
   task-stream projection bytes, IPC result bytes, and renderer clone/freeze
   duration.

G2 packaged evidence captured on 2026-08-27:

- `npm run dist` refreshed `release/win-unpacked/ClawFabric Builder.exe` and
  passed `verify:package`.
- `npm run verify:packaged-harness-stress` passed with scenario coverage
  `PB-03`, `PB-06`, and `PB-07`.
- PB-07 produced a real broker queue-pressure batch: four `read` calls and
  four `grep` calls in one Harness tool turn.
- Main broker evidence showed `tool_read_active_max=2`,
  `tool_read_queued_count=2`, `tool_search_active_max=1`, and
  `tool_search_queued_count=3`.
- Renderer/task-stream remained bounded during the same packaged run:
  PB-03 had `task_stream_full_reads=0`; PB-06 retained only 256 KiB in the
  renderer while Main privately retained the full 10 MiB command output.

G3 implementation evidence captured on 2026-08-27:

- Root cause: runtime persistence was not only paying SQLite append cost.
  After `appendConversationEvents` returned an already verified metadata
  snapshot, `builder-conversation-main-service.cjs` sanitized the full event
  list and replayed the complete conversation again on every append batch.
- Implemented controls:
  - `builder-generation-main-service.cjs` now aligns runtime delta flush size
    with `MAX_APPEND_EVENTS`, so long streaming output batches up to the
    conversation authority limit instead of flushing at a smaller local limit.
  - `builder-product-metadata-database.cjs` marks same-process conversation
    authority results with a private `WeakSet`.
  - `builder-conversation-main-service.cjs` uses that trusted marker to accept
    the metadata authority's already verified snapshot on the hot path, while
    untrusted or forged authority results still use the old full sanitize and
    replay path.
  - `builder-product-metadata-database.cjs` freezes appended event arrays before
    wrapping the result, avoiding an extra deep walk over the historical event
    prefix.
- Focused tests passed:
  `node --test tests\builder-product-metadata-database.test.cjs
  tests\builder-conversation-main-service.test.cjs
  tests\builder-generation-main-service.test.cjs
  tests\builder-programming-runtime-conversation-persistence.test.cjs
  tests\builder-programming-runtime-events.test.cjs
  tests\builder-task-stream-projection.test.cjs`.
- Packaged validation passed after refreshing the Windows release:
  `npm run dist` and `npm run verify:packaged-harness-stress`.
- The packaged stress runner now enforces this as a G3 budget gate and reports
  `g3_runtime_persistence_evidence_verified: true`.
- Packaged stress comparison against the prior G2 run:
  - `main.harness_runtime.record_events_total_ms`: about 26,677 ms -> 8,835 ms.
  - `main.conversation.append_total_ms`: about 11,340 ms -> 1,759 ms.
  - `main.task_stream.ipc_total_ms`: about 4,812 ms -> 339 ms.
  - `main.task_stream.projection_total_ms`: about 2,189 ms -> 120 ms.
  - `main.application_event_loop_delay_max_ms`: about 4,282 ms -> 1,154 ms.
  - `main.harness_runtime.pending_batch_size_max`: 64 before G3 -> 128 after
    the batch-alignment change.
- A separate PB-03-only failure-before-PB06 run showed the same direction more
  sharply before a preview remount assertion stopped the canary:
  `record_events_total_ms=2,556 ms`, `conversation.append_total_ms=865 ms`,
  and `application_event_loop_delay_max_ms=338 ms`.

G4 Preview/Browser lifecycle evidence captured on 2026-08-27:

- Root cause of the observed preview stability failure was a canary boundary
  mismatch. The stress runner marked the inner static preview node as stable,
  but a completed draft may legitimately replace that static preview content
  when a new preview projection arrives.
- The Browser/Preview lifecycle contract is now tested at the host boundary:
  `[data-builder-side-workspace-browser="true"]` must remain connected through
  long streaming output and output burst tab switches. The inner static preview
  may refresh with new `srcDoc` when the candidate changes.
- Focused tests passed:
  `node --test tests\verify-packaged-harness-stress-canary.test.cjs` and
  `npm exec vitest -- run src/features/builder/presentation/BuilderPage.test.tsx`.
- Packaged stress passed with:
  `preview_stable_during_streaming: true`,
  `preview_stable_during_output_burst: true`,
  `renderer.side_workspace.mount_count` delta 0,
  `renderer.side_workspace.unmount_count` delta 0, and
  `main.application_event_loop_delay_max_ms` about 998 ms.

H1 Harness tool exposure and empty-project execution evidence captured on
2026-08-27:

- Root cause of the red command card observed during an approved-plan run was a
  capability mismatch: the Builder Main broker could omit `execute_command`,
  while the Harness-side broker plugin still registered the model-facing `bash`
  tool.
- Builder Main now launches the Harness broker plugin with an explicit
  `BUILDER_TOOL_BROKER_ALLOWED_METHODS` list. When command execution is not
  admitted, the plugin registers only file/readiness tools and does not expose
  `bash`.
- `ask_user_question` registration is also tied to the same allowed-methods
  list, so future capability narrowing does not leave a stale provider path.
- Approved-plan Harness input now states that an empty or sparse source tree is
  a valid new-project starting point. The runtime must use `write` to create
  required files rather than ending the run because `README`, `package.json`,
  `src`, or similar common files are absent.
- Focused tests passed:
  `node --test tests\builder-harness-tool-broker-plugin.test.cjs
  tests\builder-harness-runtime-composition.test.cjs
  tests\builder-harness-tool-broker-server.test.cjs` and
  `node --test tests\builder-generation-main-service.test.cjs`.
- The Windows packaged app was refreshed with `npm run dist`, producing
  `release\win-unpacked\ClawFabric Builder.exe` and
  `release\ClawFabric Builder Setup 0.1.0.exe`.
- Packaged stress passed on the refreshed build with
  `g3_runtime_persistence_evidence_verified: true`,
  `preview_stable_during_streaming: true`,
  `preview_stable_during_output_burst: true`,
  `main.harness_runtime.record_events_total_ms=8,514 ms`,
  `main.conversation.append_total_ms=1,523 ms`, and
  `main.application_event_loop_delay_max_ms=989 ms`.
- Active-run follow-up remains a next-request queue, not hidden current-run
  steering. Existing tests cover durable queued follow-up recording and
  consumption; the remaining user-visible issue is H2 optimistic message
  rendering, not a Harness input mutation.

I1 real-provider project journey evidence captured on 2026-08-27:

- User-visible hang root cause was reproduced with the real DeepSeek packaged
  Harness canary. After editing `index.html`, the model called the exposed
  `bash` tool with `npm test` and the UI stayed at tool preparation. This was
  the same mechanism shown in the user screenshot: the project had changed, but
  the agent loop was stuck trying to run a command inside the Harness turn.
- The product policy is now stricter than the earlier capability mismatch fix:
  project generation runs expose only `read`, `grep`, `edit`, `write`, and
  `ask_user_question` to Harness. Even when the controlled command runtime
  exists internally, `execute_command`/`bash` is not in
  `BUILDER_TOOL_BROKER_ALLOWED_METHODS` for the model-facing generation loop.
  Builder Main remains responsible for automatic checks after the turn.
- The real-provider canary assertion now distinguishes automatic Builder check
  command UI from Harness tool exposure. It verifies Harness session tool names
  directly and fails if the model-facing session contains `bash`.
- A refreshed packaged app passed the real DeepSeek journey with:
  `automatic_check_failed_then_passed: true`,
  `automatic_check_passed: true`,
  `bash_tool_hidden_from_harness: true`,
  `tool_call_names: { read: 5, edit: 2 }`, and
  `coding_loop_duration_ms: 21442`.

H2 immediate submit feedback evidence captured on 2026-08-27:

- Root cause of delayed first-message display was renderer coupling: the
  Activity list rendered user messages only after durable Task Stream snapshots
  arrived. Plan mode made this visible because the composer cleared input and
  then awaited `proposePlan(...)` before terminal activity refresh.
- Builder now keeps a small renderer-local pending user message list. Accepted
  composer submissions appear immediately as user bubbles while Main/SQLite
  records and Task Stream projection catch up.
- Pending messages are scoped by workspace epoch, project, task address, and
  message kind. Once durable activity includes the same user message, the local
  pending row is hidden/pruned to avoid duplicate bubbles.
- Active-run follow-up still uses the existing next-request queue semantics.
  The pending row only acknowledges that the follow-up was queued; it does not
  inject the text into the current Harness run.
- Focused tests passed:
  `npm exec vitest -- run src\features\builder\presentation\BuilderPage.test.tsx`,
  `npm exec vitest -- run src\app\BuilderApp.test.tsx`, and
  `npm exec tsc -b --pretty false`.
- The Windows packaged app was refreshed with `npm run dist` after H2, and
  `verify:package` passed with `harness_runtime: bundled_identity_verified`.

H3 pending-message identity evidence captured on 2026-08-27:

- Pending user messages no longer rely on a bare `message_kind:text` match.
  Durable `message_id` is used when available, durable `turn_id` is used as the
  next strongest identity, and text matching is gated by the Conversation
  `head_sequence` observed when the local pending row was created.
- This keeps optimistic feedback immediate while preventing two opposite UI
  failures: duplicate user bubbles after Task Stream catches up, and accidental
  suppression when a user intentionally sends the same text again later.
- Active-run queued follow-up now binds the pending row to the Main-issued
  queued follow-up `message_id` and `turn_id` once `queueFollowup(...)` returns.
  Normal submit still uses the sequence boundary until the Main submit path
  grows an explicit user-message receipt.
- Focused tests passed:
  `npm exec vitest -- run src\features\builder\presentation\BuilderPage.test.tsx`,
  `npm exec vitest -- run src\app\BuilderApp.test.tsx`, and
  `npm exec tsc -b --pretty false`.

I3 real end-to-end usability gate captured on 2026-08-28:

- The next release gate is now a real packaged desktop journey rather than a
  single fake-provider script. `scripts\verify-deepseek-packaged-e2e-gate.cjs`
  accepts the same stdin saved-profile input as the DeepSeek canaries and runs
  three user-critical paths in sequence.
- `real_existing_project_harness` runs the real DeepSeek Harness coding loop on
  an existing focus-timer fixture. It verifies that Harness can edit, recover
  from an automatic check failure, pass the check, answer a grounded follow-up,
  and keep `bash` hidden from the model-facing tool list.
- `real_empty_project_approved_plan` runs the real DeepSeek Plan journey on an
  empty bound project. It verifies that the initial plan remains available to
  the approved-plan execution turn, the approved plan reaches Harness build,
  the runtime writes a candidate from an empty source tree, the automatic check
  passes, and the composer is released.
- `packaged_dependency_prepare_once` keeps dependency readiness in the gate. It
  verifies detect-before-install behavior, visible `Preparing...` feedback,
  duplicate-prepare suppression, isolated-workspace-only dependency writes, no
  repair loop, check pass after preparation, cleared live output, and Save
  enablement after the prepared check.
- To address the user-observed empty-project failure, the Harness runtime system
  prompt no longer leads with "Inspect the project". It now states that empty
  or sparse projects are valid starting points for create-new-project and
  approved-plan requests, and that repeated searches proving files are absent
  are not progress.
- Focused tests passed:
  `node --test tests\builder-harness-runtime-composition.test.cjs
  tests\builder-generation-main-service.test.cjs`.
- The Windows package was refreshed with `npm run dist`, and
  `verify:package` passed.
- The new I3 gate passed on the refreshed package with total duration
  `60,207 ms`: `real_existing_project_harness` `32,726 ms`,
  `real_empty_project_approved_plan` `15,997 ms`, and
  `packaged_dependency_prepare_once` `11,484 ms`.
- The real Harness session evidence for the existing-project leg recorded
  `tool_call_names: { read: 2, edit: 2 }`, `bash_tool_hidden_from_harness:
  true`, `automatic_check_failed_then_passed: true`, and
  `project_usage_answer_grounded_in_current_draft: true`.

I4 Agent history end-to-end gate captured on 2026-08-28:

- `scripts\verify-deepseek-packaged-agent-history-e2e-canary.cjs` now covers a
  more realistic desktop state: a temporary packaged userData is seeded with
  24 historical Agent Workbench task proposal records before the current task
  starts.
- The canary starts from the Agent entry point, creates a foreground task
  proposal, accepts it as a new project task, binds the temporary project
  workspace, submits a real Build request, waits for real DeepSeek Harness
  coding activity, waits for candidate/check/checkpoint closure, and then asks
  a follow-up question against the same task.
- This gate intentionally reads project identity back through the Main-owned
  Agent project tree rather than relying on route-decision DOM attributes,
  because historical Agent flows may not have a fresh composer route decision
  after task materialization.
- An attempted broad Renderer route change exposed a real boundary risk:
  projectless Agent requests and ordinary no-workspace project requests are
  easy to conflate. The product code was restored to the tested workspace
  picker behavior; the I4 gate exercises the explicit Agent proposal path
  instead of weakening that boundary.
- Focused validation passed after restoring the product route behavior:
  `npm exec vitest -- run src\app\BuilderApp.test.tsx`,
  `npm exec tsc -b --pretty false`, `npm run dist`, and `verify:package`.
- The I4 real canary passed on the refreshed package in `28,671 ms`.
  It recorded `history_item_count: 24`, `project_count: 1`, `task_count: 1`,
  `candidate_ready_count: 1`, `programming_runtime_tool_activity_count: 9`,
  `programming_runtime_check_passed_count: 1`, `checkpoint_created_count: 1`,
  and a grounded Chinese follow-up answer for the continued task.

I5 real saved-history workflow matrix captured on 2026-08-28:

- `scripts\verify-deepseek-packaged-agent-history-e2e-canary.cjs` now clones
  durable Builder workspace metadata from the saved test profile into guarded
  temporary userData. Provider credentials use the existing bounded profile
  copy path. Transient Harness sessions, check workspaces, structured runtime
  snapshots, Git runtime state, and provider directories are excluded from the
  workspace clone.
- The matrix loads the real Agent project/task catalog, opens an existing task,
  asks a grounded Chinese continuation question, waits for Task Stream terminal
  evidence, returns to Agent, creates a new project task, runs real coding and
  checks, saves Version 1, then creates and executes a second Agent task in that
  now-existing project.
- Real history exposed a product bug hidden by the previous synthetic gate.
  `createLocalProject()` reused the retained old task `conversationProjectId`
  after returning to Agent, so Main correctly rejected rebinding the new folder
  to the old project and the UI silently returned to `new`. Agent new-project
  materialization now uses the explicit `createNewLocalProject()` controller
  path, which always sends `project_id: null`; ordinary current-project folder
  binding keeps its previous identity semantics.
- The matrix also distinguishes visible answer text from terminal completion.
  Existing-task continuation now waits for `recorded_active_turn_id: null` and
  an idle composer before starting the next Agent operation.
- The refreshed Windows package passed against a saved profile containing
  `52` projects, `11` tasks, `45` Workbench history items, and `22` cloned
  durable Builder state directories. The run ended with `53` projects and `13`
  tasks in temporary userData.
- The existing-task answer completed in `7,918 ms`. The first Agent task showed
  its submitted message in `2,553 ms`, first streaming Markdown in `7,101 ms`,
  and completed its checked draft in `37,127 ms`. The second Agent task showed
  its submitted message in `8,590 ms`, first streaming Markdown in `13,667 ms`,
  and completed in `37,928 ms`.
- Both Agent coding tasks produced real tool activity, streaming Markdown,
  candidate/check/checkpoint closure, and passed checks. Neither the new
  project nor the second task in the already approved project displayed a
  duplicate current-project write prompt.
- Focused validation passed:
  `npm exec vitest -- run src\app\BuilderApp.test.tsx -t "auto-starts a foreground Agent task proposal|keeps Agent task proposal project creation single-shot"`,
  `npm exec vitest -- run src\features\builder\application\builderProjectController.test.ts -t "explicitly new project"`,
  `node --test tests\verify-deepseek-packaged-agent-history-e2e-canary.test.cjs`,
  `npm exec tsc -b --pretty false`, `npm run dist`, and `verify:package`.

I6 Main runtime persistence and chat presentation closure captured on 2026-08-28:

- Real saved-history traces showed that Harness file reads and searches were not
  the desktop stall: the broker completed them in single-digit milliseconds.
  The dominant cost was `record_programming_runtime_events`, which took about
  `27,604 ms` across `72` batches while SQLite append time itself was only about
  `3,157 ms`.
- The hidden multiplier was Task Stream invalidation semantics. Every persisted
  runtime status/tool batch except a pure assistant-text delta was classified as
  `durable_append`. Main therefore synchronously ran
  `synchronizeTaskWorkbench()` for nearly every runtime batch, even though the
  Agent Workbench only needs a stable task/candidate/terminal boundary.
- Task Stream v2 now distinguishes three changes: `live_only` for text deltas,
  `runtime_append` for persisted runtime status/tool facts that refresh the
  conversation without rebuilding Workbench, and `durable_append` for stable
  task/candidate/terminal facts that also synchronize Workbench. SQLite remains
  authoritative and the Renderer continues to read runtime facts incrementally.
- Pure runtime appends also defer transcript archive/context compaction refresh.
  The next non-runtime stable append rebuilds those repairable derived facts from
  the complete authoritative conversation.
- The same slice closed two presentation defects. Optimistic user bubbles and
  their durable replacements share one reconciliation rule and user messages do
  not replay an entrance animation during identity handoff. Streaming Markdown
  resets inherited `white-space: pre-wrap`, while plain-text fallback preserves
  authored line breaks.
- The duplicated `Think / 正在思考` activity row is suppressed while the live
  output slot is present. The single inline live status remains visible before
  and during streamed Markdown with a spinner and restrained breathing motion;
  reduced-motion mode disables the added animation.
- The refreshed packaged real-model matrix again loaded `52` projects, `11`
  tasks, and `45` Agent history items, then continued an old task and completed
  two Agent coding tasks with real tool activity, streamed Markdown, checks, and
  draft closure. No duplicate project-write prompt appeared.
- Compared with the immediately preceding package, runtime event persistence
  fell from `27,604 ms` to `3,542 ms` (about `87%`), first-task Markdown appeared
  at `4,098 ms` instead of `21,111 ms`, first-task terminal fell from `54,824 ms`
  to `30,245 ms`, second-task terminal fell from `38,051 ms` to `21,304 ms`, and
  maximum Main event-loop delay fell from `4,073 ms` to `2,565 ms`.
- Focused validation passed: conversation authority `65/65`, Task Stream IPC,
  desktop Task Stream port `12/12`, conversation controller `17/17`, performance
  trace `3/3`, focused Builder presentation tests, TypeScript, `npm run dist`,
  `verify:package`, and the real packaged Agent-history matrix.

Remaining G-line work:

1. Add `verify:packaged-e2e:deepseek` to release-candidate validation whenever
   real-provider evidence is required. It is intentionally slower and consumes
   model calls, so it should remain an explicit release gate rather than a
   default unit-test path.
2. Add `verify:packaged-agent-history:deepseek` before any release that changes
   Agent Workbench, project/task catalog, task stream projection, or composer
   routing. It is the current guard for "real use with many prior tasks".
3. Keep the G3 packaged budget gate in release verification so runtime
   persistence and event-loop regressions fail before packaging.
4. Keep Harness tool exposure tied to Main-owned capabilities. If the command
   service is unavailable, no `bash` or `execute_command` path may be visible to
   the model.
5. Keep Browser/Preview lifecycle stability separate from command runtime
   persistence. Future Browser Node work should extend the host boundary rather
   than asserting that every inner static preview frame is immutable.
6. If user-visible stalls remain, split the remaining Main spikes between Git
   persistence, automatic check, command approval wait, and `save_version_refresh`
   instead of doing another broad Renderer-only optimization pass.
7. The next UX slice can extend the normal submit/plan Main response with an
   explicit user-message receipt. H3 already protects repeated identical text
   with a sequence boundary and uses Main-issued identity for queued follow-up.
