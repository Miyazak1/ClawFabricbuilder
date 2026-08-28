# Builder A0 Live Delta Refresh Isolation Gate

Date: 2026-08-25

Status: repository acceptance and packaged qualification for slice `A0.2a`.
This is not acceptance of all Gate `A0`.

## Objective

Stop high-frequency assistant text deltas from causing complete Conversation,
task-stream, and Workbench refreshes while preserving Main-owned SQLite facts,
terminal completion, cancel, retry, recovery, and restart replay.

## Implemented Boundary

`builder-task-stream-changed.v2` adds:

- `change_kind`: `live_only` or `durable_append`;
- `cursor`: the committed Conversation head sequence;
- the existing Main-owned `project_id` identity.

Conversation Main classifies an append as `live_only` only when every appended
event is a `programming_runtime_event_recorded` wrapper for
`assistant_text_delta`. Any mixed append or other fact is `durable_append`.

Generation IPC still publishes the typed renderer hint, but skips Task
Workbench synchronization for `live_only`. The renderer Conversation controller
ignores `live_only`; assistant text continues through the existing narrow live
output store. Legacy v1 hints retain their durable refresh behavior.

This slice deliberately keeps runtime delta persistence. Removing those rows
now would break current runtime journal continuity and reconstruction of
`assistant_text_completed`, which stores a digest and byte count rather than the
complete text. Semantic compaction belongs to a later migration with explicit
read compatibility.

## Measured Baseline

The reproducible command is:

```text
npm run measure:a0:event-projection
```

It uses fixed synthetic four-event answer turns and emits only counters,
runtime identity, and timings. The 2026-08-25 run on Node `v22.22.3`, Windows
x64 produced:

| Events | Repetitions | Median | p95 |
| ---: | ---: | ---: | ---: |
| 100 | 7 | 15.899 ms | 18.396 ms |
| 400 | 7 | 38.435 ms | 41.393 ms |
| 800 | 7 | 71.484 ms | 86.561 ms |
| 1,200 | 7 | 108.837 ms | 138.960 ms |

The result confirms total-history projection growth remains. Refresh isolation
removes repeated work per delta; it does not replace A0.3 incremental append and
projection.

## Historical Compatibility Fixture

The anonymous structural inventory contains 357 `run_completed` records:

- 302 are accepted by the current reader;
- 55 historical candidate records require migration;
- the 55 records omit `candidate_result.current_materialization`.

The fixture proves these old records are digest-valid in their original shape.
Adding the current default changes the event digest, so an explicit migration
must rewrite the copied event and every following `previous_event` link. A read
path must not silently normalize the production hash chain.

Fixture:
`tests/fixtures/builder-conversation-schema-compatibility.v1.json`.

## Verification

Passed repository checks:

- TypeScript build;
- 64 Conversation Main tests;
- 40 generation IPC runtime tests;
- 22 focused renderer task-stream/controller tests;
- 2 historical schema fixture tests;
- 1 redacted baseline contract test.

The renderer test sends 100 consecutive `live_only` hints and observes zero
durable task-stream reads. The IPC test observes two renderer hints but only one
Workbench refresh for a `live_only` followed by a `durable_append` event.

The full IPC run also exposed and fixed a Project Lifecycle SQLite handle leak
on composition failure. The close-path regression now passes.

Packaged qualification now passes on the rebuilt Windows desktop:

- isolated launch reports preload bridge `builder-preload.v36`;
- the DeepSeek Harness UI canary completes 26 provider requests across initial
  generation, automatic repair, continuation, restart recovery, checkpoint
  Undo, adversarial tool boundaries, no-change work, cancellation, and Save;
- cancellation records a canonical terminal run and turn before draft review
  actions become available;
- the visible Save card is dismissed only after the unsaved marker clears;
- `Version saved` returns to the conversation and Version 1 appears in History.

The numeric-only packaged baseline and measured bottleneck are recorded in
[Builder A0 Packaged Performance Baseline](BUILDER_A0_PACKAGED_PERFORMANCE_BASELINE_2026_08_25.md).

This packaged run also closed a cancellation/save consistency defect. Harness
cancellation previously stopped at `run_cancel_requested`, so the Project
controller could re-enable Save while Conversation still had an active turn.
The revision and review could commit before `candidate_accepted` was admitted,
leaving a partially saved version with no chat result. Cancellation is now a
non-retryable terminal outcome, and Save/Discard remain disabled with an
explicit finishing-work message until the canonical active turn closes.

## Residual Work

- `ARCH-001` is not yet met: delta persistence still precedes renderer output.
- A0.1 now has packaged evidence for `PB-01`, `PB-02`, `PB-04`, `PB-05`,
  `PB-07`, and `PB-10`; five warm repetitions plus strict `PB-03`, `PB-06`,
  `PB-08`, and `PB-09` remain.
- A0.3 must make warm append/projection proportional to the suffix.
- A0.4 must prove Side Workspace and Browser do not commit or remount on live
  output.
- A0.5 copied-database dual-read and rollback qualification remains pending.

Next implementation slice: use the completed Main/renderer instrumentation to
implement cached validated heads plus suffix-only append/projection behind a
local rollback flag.
