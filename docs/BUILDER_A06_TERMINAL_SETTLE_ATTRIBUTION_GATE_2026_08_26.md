# Builder A0.6 Terminal Settle Attribution Gate

Date: 2026-08-26

Status: accepted as an attribution gate. This gate adds narrower packaged
measurements for the remaining Main-process cold and terminal spikes. It does
not claim that all cold-path latency has been removed.

## Objective

A0.5 proved that long live output and large command output no longer amplify
through full durable task-stream refreshes. The remaining risk was an
application-level Main event-loop spike during Harness settle and command
terminal scenarios.

This gate answers one question:

```text
Is the remaining spike caused by hot output ingestion, by UI/browser remount,
or by colder Main authority work after provider/runtime boundaries?
```

## Instrumentation Added

The performance trace now records numeric-only duration metrics and event-loop
windows for Harness candidate and response settlement:

- candidate workspace guard;
- candidate Git persist and Git verify;
- automatic draft checkpoint;
- automatic candidate check;
- check-fact recording;
- repair and reconcile;
- materializing the candidate to the current workspace;
- completing the Conversation candidate;
- response-only reconcile and Conversation completion.

The packaged stress canary also splits `PB-06` into:

- submit to command approval;
- command approval to command-provider completion;
- command-provider completion to final provider completion;
- completed provider to durable task-stream terminal;
- terminal tab settle.

All trace fields remain numeric and redacted. No prompt text, source content,
command output, paths, URLs, credentials, or opaque private references are
written to the trace.

## Packaged Evidence

Command:

```text
npm run verify:packaged-harness-stress
```

Package:

```text
D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe
```

Result: `a05_gate_verified: true`.

### PB-03 Long Stream

| Metric | Result |
| --- | ---: |
| End-to-end duration | 71,906 ms |
| Live-output events received / dropped | 605 / 0 |
| Durable task-stream reads | 8 |
| Complete task-stream reads | 0 |
| Controller publications | 5 |
| BuilderPage commits | 34 |
| Activity commits | 8 |
| Side Workspace commits | 0 |
| Side Workspace mounts / unmounts | 0 / 0 |

The hot streaming path remains bounded. It did not trigger complete
task-stream reads, and the Side Workspace stayed mounted.

### PB-06 Large Command Output

| Metric | Result |
| --- | ---: |
| Complete command output retained in Main | 10,485,760 B |
| Public output transported to renderer | 262,144 B |
| Renderer events / flushes | 1 / 1 |
| Renderer retained maximum | 262,144 B |
| Visible stdout / stderr | 131,072 / 131,072 B |
| Main spill write maximum | 0.241 ms |
| Command-output event-loop max | 19.726 ms |
| Side Workspace commits | 6 |
| Side Workspace mounts / unmounts | 0 / 0 |

The output-ingestion path is not the residual bottleneck. Complete output is
retained privately in Main, renderer transport remains bounded, and the
command-output-specific event-loop maximum stayed well below the 250 ms budget.

### Remaining Main Event-Loop Windows

| Window | Duration | Max Event-Loop Delay | Interpretation |
| --- | ---: | ---: | --- |
| `pb06_submit_to_command_approval` | 7,264.464 ms | 3,485.467 ms | dominant PB-06 spike before command approval appears |
| `pb06_completed_provider_to_task_stream_terminal` | 6,329.720 ms | 1,508.901 ms | terminal settlement after provider completion |
| `pb03_provider_complete_to_terminal` | 3,606.417 ms | 1,535.115 ms | response-only terminal settlement |
| `harness_response_reconcile` | 1,565.470 ms | 371.982 ms | response-only Harness reconcile contributes to PB-03 tail |
| `harness_candidate_git_persist` | 893.143 ms | 52.855 ms | cold Git receipt path, mostly asynchronous duration |
| `harness_candidate_automatic_check` | 562.907 ms | 41.976 ms | bounded check coordination |
| `harness_candidate_materialize_current` | 651.845 ms | 34.111 ms | bounded current-workspace materialization |
| `harness_candidate_reconcile` | 207.071 ms | 44.204 ms | bounded candidate reconcile |
| `pb06_terminal_tab_settle` | 10.994 ms | 0 ms | terminal UI settle is not the bottleneck |

The maximum application-level event-loop delay was `3,611.296 ms`. The
largest measured child window was `pb06_submit_to_command_approval`, not the
command-output window and not the terminal tab UI. The second class of spikes
occurs after provider completion while durable terminal/candidate state is
being reconciled.

## Decision

Do not start the built-in Browser or broader universal Terminal work on top of
an unexplained Main cold spike.

Do not perform an opportunistic low-level rewrite in this gate. The dominant
windows cross Harness startup/provider tool-request admission, Git receipts,
automatic checks, candidate materialization, Conversation completion, and
task-stream notification. Those are authority boundaries, so a blind
optimization could make the UI smoother by weakening recovery, checkpoint, or
version truth.

The current safe implementation outcome is:

- keep the new attribution windows and metrics;
- keep the strict packaged stress qualification;
- move the next stage to a narrower A0.6b source-and-runtime attribution gate.

## Next Gate

`A0.6b` should split `pb06_submit_to_command_approval` before any behavioral
rewrite:

- renderer submit to generation IPC entry;
- request sanitization and route/permission preparation;
- project/source context collection;
- runtime contract creation;
- Harness process/session acquisition;
- provider request to first structured tool request;
- command approval fact recording and renderer projection.

It should also split terminal completion into separate authority windows:

- provider terminal event received;
- runtime event normalization and journal append;
- candidate projector;
- Git receipt persistence;
- automatic check;
- materialization;
- Conversation terminal append;
- task-stream changed notification and first renderer terminal read.

Only after those windows identify one dominant synchronous local segment should
A0.6b introduce a minimal fix. Likely fix families are scheduling/caching or
workerizing cold read-only work, not reducing the authority checks themselves.

## Verification

Focused tests passed:

```text
node --test tests\builder-performance-trace.test.cjs tests\verify-packaged-harness-stress-canary.test.cjs
npm exec tsc -b --pretty false
```

Packaging and stress verification passed:

```text
npm run dist
npm run verify:packaged-harness-stress
```

