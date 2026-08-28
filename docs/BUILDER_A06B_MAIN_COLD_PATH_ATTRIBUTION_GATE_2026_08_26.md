# Builder A0.6b Main Cold-Path Attribution Gate

Date: 2026-08-26

Status: accepted as a deeper attribution gate. No behavioral optimization is
accepted in this gate because the remaining spike is still inside runtime
completion and authority settlement rather than one isolated low-risk local
operation.

## Objective

A0.6 split the residual packaged Main-process spike into broader terminal and
candidate-settle windows. A0.6b narrows the largest windows further:

- `PB-06` submit to command approval;
- provider completion to durable task-stream terminal;
- Harness runner internals;
- runtime event persistence.

The goal is to decide whether the next change should be performance tuning,
Browser work, or another architecture slice.

## Instrumentation Added

The packaged trace now reports fixed, numeric-only metrics for:

- Harness start context creation;
- provider config, secret resolution, and provider-dispatch admission;
- runtime run-contract construction;
- runner creation and `runner.run`;
- runner start-runtime, wait-completion, read-conversation-events,
  project-candidate, reconcile-runtime, and repair-runtime;
- runtime event persist, journal append, pending batch size, batch flush,
  Conversation recording, and tool-file binding.

The new fields are exposed through `verify-packaged-harness-stress` under
`main.runtime_metrics.harness_start`, `harness_runner`, and
`harness_runtime`.

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

### Hot-Path Regression Check

| Scenario | Metric | Result |
| --- | --- | ---: |
| `PB-03` | live-output events received / dropped | 605 / 0 |
| `PB-03` | durable task-stream reads | 7 |
| `PB-03` | complete task-stream reads | 0 |
| `PB-03` | BuilderPage commits | 34 |
| `PB-03` | Activity commits | 8 |
| `PB-03` | Side Workspace mounts / unmounts | 0 / 0 |
| `PB-06` | complete command output retained in Main | 10,485,760 B |
| `PB-06` | public output transported to renderer | 262,144 B |
| `PB-06` | renderer events / flushes | 1 / 1 |
| `PB-06` | command-output event-loop max | 22.200 ms |
| `PB-06` | Side Workspace mounts / unmounts | 0 / 0 |

The A0 hot path remains bounded. Large command-output ingestion is still below
the accepted command-window budget and does not remount the Side Workspace.

### Start And Runner Attribution

| Metric | Max |
| --- | ---: |
| `harness_start.build_context` | 812.853 ms |
| `harness_start.provider_config` | 0.088 ms |
| `harness_start.resolve_secret` | 0.998 ms |
| `harness_start.provider_dispatch` | 0.121 ms |
| `harness_start.run_contract` | 1.083 ms |
| `harness_start.runner_create` | 0.178 ms |
| `harness_start.runner_run` | 68,518.318 ms |
| `harness_runner.start_runtime` | 770.562 ms |
| `harness_runner.wait_completion` | 68,110.058 ms |
| `harness_runner.read_conversation_events` | 0.067 ms |
| `harness_runner.project_candidate` | 8.495 ms |
| `harness_runner.reconcile_runtime` | 1,626.615 ms |

`harness_start.runner_run` is the only start-side envelope large enough to
explain the `PB-06` submit-to-command-approval spike. Provider configuration,
secret resolution, provider dispatch admission, run-contract creation, and
runner construction are not meaningful contributors.

`wait_completion` necessarily includes real provider/runtime waiting, so its
wall-clock duration is not itself a UI defect. Its event-loop window still saw
sub-second delays, and the enclosing `runner_run` window saw the largest
application-level delay. The next split belongs inside the Harness runtime and
JSON-RPC peer rather than in Builder's submit preparation.

### Terminal And Runtime Event Attribution

| Metric | Max |
| --- | ---: |
| `pb06_completed_provider_to_task_stream_terminal` event-loop delay | 3,508.535 ms |
| `pb03_provider_complete_to_terminal` event-loop delay | 1,569.718 ms |
| `harness_response.reconcile` | 1,626.787 ms |
| `harness_response.complete_conversation` | 357.670 ms |
| `harness_runtime.persist_event` | 427.124 ms |
| `harness_runtime.record_events` | 427.004 ms |
| `harness_runtime.flush_pending_events` | 223.101 ms |
| `harness_runtime.journal_append` | 0.685 ms |
| `harness_runtime.bind_tool_file` | 1.437 ms |
| `conversation.append` | 157.312 ms |
| `task_stream.ipc` | 147.347 ms |
| `task_stream.projection` | 16.257 ms |

Runtime event recording explains several hundred milliseconds of terminal
settle work, but not the full multi-second application event-loop spike.
Journal append and tool-file binding are negligible. Conversation append and
task-stream IPC are bounded but still worth watching as history grows.

## Decision

Continue performance attribution before building Browser runtime activation.

Do not implement a blind cold-path optimization in this gate. The remaining
large delays cross provider/runtime completion, JSON-RPC processing, event
normalization, runtime completion, reconcile, Conversation append, and renderer
terminal acknowledgement. Weakening any one of those without a dominant local
cause would risk checkpoint, Undo, terminal, and recovery truth.

The next implementation target is `A0.6c`: split the Harness runtime and
JSON-RPC peer.

## Next Gate

`A0.6c` should add redacted metrics for:

- Harness process spawn/reuse and initialize;
- JSON-RPC frame stringify/write;
- stdout line splitting and JSON parse;
- notification dispatch by method;
- `session.event` normalization by event type;
- tool broker request handling by tool kind;
- command approval wait versus command execution;
- command-output completion event creation;
- `session.status` and terminal completion normalization;
- reconcile request/response in the runtime process;
- Main notification fan-out to renderer live, activity, and task-stream stores.

After A0.6c, a behavioral fix is allowed only if one segment dominates and has
a clear preservation strategy. Candidate fixes may include batching runtime
notification settlement, moving JSON parse/projection off the Main turn,
coalescing terminal notifications, or workerizing read-only runtime-frame
processing. SQLite/Git authority and final Conversation facts must stay
Main-owned.

## Verification

Focused tests passed:

```text
node --test tests\builder-performance-trace.test.cjs tests\verify-packaged-harness-stress-canary.test.cjs tests\builder-harness-generation-runner.test.cjs tests\builder-generation-main-service.test.cjs
npm exec tsc -b --pretty false
```

Packaged verification passed:

```text
npm run dist
npm run verify:packaged-harness-stress
```

