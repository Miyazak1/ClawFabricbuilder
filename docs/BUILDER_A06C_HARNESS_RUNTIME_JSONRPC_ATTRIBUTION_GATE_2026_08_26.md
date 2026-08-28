# Builder A0.6c Harness Runtime And JSON-RPC Attribution Gate

Date: 2026-08-26

Status: accepted as an attribution gate. This gate does not claim the remaining
lag is release-acceptable.

## Objective

A0.6b proved that the hot streaming path was bounded, but the packaged desktop
still showed multi-second Main event-loop spikes during Harness runtime
completion and authority settlement. A0.6c splits the remaining region across:

- DeepSeek Harness process host initialization and prompt request;
- JSON-RPC frame parse, request serialization, write, notification dispatch, and
  response settlement;
- Harness tool broker HTTP request handling;
- controlled command approval and command execution;
- runtime event persistence and reconcile completion.

The goal is to decide whether the current lag is acceptable, whether it belongs
to the upstream Harness runtime itself, and which optimization is safe to do
first.

## Instrumentation Added

The packaged trace now reports fixed, numeric-only metrics for:

- `main.harness_process_host.*`: initialize, prompt, and generic request
  duration;
- `main.harness_jsonrpc.*`: request, request serialization, request write,
  stdout frame handling, JSON parse, notification dispatch, and response
  settlement;
- `main.harness_tool_broker.*`: broker start, dispatch, body read, JSON parse,
  tool execution, user-question wait, and response send;
- `main.command_approval.*`: approval request, decision, and consume;
- `main.command_executor.*`: execute envelope, workspace materialization,
  runtime resolution, private runtime read, process run, spawn, finish, and
  cleanup;
- `main.harness_runtime.*`: start run, host prompt, reconcile run, repair run,
  stop-with-failure, durable event persistence, pending flush, and
  Conversation recording.

Event-loop windows were expanded and the stress report now aggregates repeated
windows by name instead of reporting only the last occurrence.

No prompt text, user content, paths, URLs, credentials, or command output bodies
are recorded by these metrics.

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

### Hot Path

| Scenario | Metric | Result |
| --- | --- | ---: |
| `PB-03` | live-output events received / dropped | 605 / 0 |
| `PB-03` | durable task-stream reads | 7 |
| `PB-03` | complete task-stream reads | 0 |
| `PB-03` | BuilderPage commits | 34 |
| `PB-03` | Activity commits | 8 |
| `PB-06` | complete command output retained in Main | 10,485,760 B |
| `PB-06` | public output transported to renderer | 262,144 B |
| `PB-06` | renderer events / flushes | 1 / 1 |
| `PB-06` | command-output event-loop max | 16.089 ms |
| `PB-06` | Side Workspace mounts / unmounts | 0 / 0 |

The hot output path remains acceptable. Large command output is bounded,
redacted, retained privately, and does not explain the user-visible freeze.

### Remaining Spikes

| Window or Metric | Result |
| --- | ---: |
| application event-loop max | 3,242.197 ms |
| `pb06_output_to_terminal` max delay | 3,242.197 ms |
| `pb06_submit_to_command_approval` max delay | 3,242.197 ms |
| `pb06_completed_provider_to_task_stream_terminal` max delay | 1,432.355 ms |
| `pb03_provider_complete_to_terminal` max delay | 155.058 ms |
| `save_version_refresh` max delay | 484.704 ms |
| restart application event-loop max | 570.950 ms |

These numbers are not acceptable for a daily user-facing desktop build. They
are tolerable only as internal canary evidence while the next gate removes the
largest Main-thread spikes.

### Attribution

| Segment | Result |
| --- | ---: |
| `harness_tool_broker.dispatch` max | 1,666.778 ms |
| `harness_tool_broker.execute_tool` max | 1,664.529 ms |
| `harness_tool_broker.tool_execute_command` max | 1,664.527 ms |
| `command_approval.request` max | 754.719 ms |
| `command_approval.prepare` max | 0.998 ms |
| `command_approval.wait_decision` max | 753.310 ms |
| `harness_runtime.reconcile_run` max | 1,496.652 ms |
| `harness_response.reconcile` max | 1,497.978 ms |
| `harness_candidate.git_persist` max | 1,214.384 ms |
| `harness_candidate.materialize_current` max | 1,002.733 ms |
| `harness_candidate.automatic_check` max | 781.391 ms |
| `harness_runtime.persist_event` max | 340.794 ms |
| `harness_runtime.flush_pending_events` max | 198.465 ms |
| `conversation.append` max | 133.091 ms |
| `task_stream.ipc` max | 153.629 ms |
| `task_stream.projection` max | 14.589 ms |

JSON-RPC local processing is not the bottleneck:

| JSON-RPC Metric | Result |
| --- | ---: |
| request serialize max | 0.070 ms |
| request write max | 0.202 ms |
| frame handle max | 1.100 ms |
| parse frame max | 0.848 ms |
| dispatch notification max | 0.225 ms |
| settle response max | 0.220 ms |

Command execution itself is also not the multi-second blocker:

| Command Executor Metric | Result |
| --- | ---: |
| execute max | 909.565 ms |
| process run max | 326.182 ms |
| resolve runtime max | 288.912 ms |
| read private runtime max | 289.812 ms |
| materialize max | 1.519 ms |
| finish max | 0.777 ms |
| cleanup max | 1.110 ms |

## Decision

The current lag is not acceptable for user-ready daily work. It is acceptable
only for internal canary builds that prove correctness and gather evidence.

The remaining lag should not be described as "DeepSeek Harness runtime itself"
without qualification. The evidence says:

- upstream Harness/model wall-clock waiting is large but expected;
- JSON-RPC local parse/write/dispatch is small;
- the dominant Main-thread delays are in Builder's integration boundary:
  brokered tool execution, command approval request construction/wait envelope,
  runtime event persistence, reconcile, Git persistence, materialization, and
  terminal task-stream settlement.

Therefore the next optimization should target Builder-owned integration and
durable settlement first, while keeping Harness pinned and treating upstream
runtime replacement as a separate G1 lifecycle problem.

## Tutti Direction Assessment

The proposed Tutti-inspired architecture is aligned with the current repository
direction if used as a boundary model rather than as an imported kernel:

```text
Builder Core
-> DeepSeek Harness Runtime
-> Workbench Shell
-> Node Capabilities
```

Agreement:

- Builder Core must remain the authority for conversation, task stream,
  candidate, checkpoint, check, dependency readiness, save, Undo, and reconcile.
- DeepSeek Harness should sequence model work and request tools, but should not
  own browser state, dependency installation, UI layout, or desktop authority.
- Workbench Shell should own presentation snapshots, docks, panes, focus,
  sizing, and restore, not business truth.
- Browser, Preview, Files, Terminal, Run/Check, and future nodes should be host
  adapted capabilities with explicit permission and evidence boundaries.

Main risk:

- migrating to a Workbench/Node model before fixing event channels would move
  the same blocking behavior into more panes;
- Browser Node will amplify freezes if live output, durable facts, terminal
  output, and browser observations share broad renderer/Main refresh paths;
- plugin or extension loading must be manifest-only, pinned, reviewed, and
  signed before execution authority is allowed.

## Next Gate

`A0.7` should be a behavioral performance gate, not another broad architecture
rewrite:

1. classify dependency and toolchain readiness before repair loops:
   missing Node, npm, package manager, `node_modules`, or install permission
   should terminate as `blocked_environment/dependencies_missing`;
2. move command approval request preparation away from full source-tree
   understanding when possible, or cache the project-understanding snapshot by
   source-tree digest;
3. coalesce runtime event persistence further and decouple terminal settlement
   from full Conversation append/projection;
4. keep `save/reconcile` facts Main-owned, but make save refresh and terminal
   acknowledgement non-blocking for unrelated panes;
5. rerun packaged stress with Browser/right pane open before starting Browser
   runtime activation.

G1 Harness update work and G5 Browser Node work should wait until this A0
performance exit is accepted. Contract-only Browser design can continue, but
runtime activation should not start on top of the current spike profile.

## Verification

Focused tests passed:

```text
node --test tests\builder-performance-trace.test.cjs tests\verify-packaged-harness-stress-canary.test.cjs tests\builder-harness-jsonrpc-peer.test.cjs tests\builder-harness-programming-runtime.test.cjs tests\builder-harness-tool-broker-server.test.cjs tests\builder-harness-process-host.test.cjs tests\builder-controlled-command-approval-service.test.cjs tests\builder-controlled-command-executor.test.cjs tests\builder-generation-main-service.test.cjs
npm exec tsc -b --pretty false
```

Packaged verification passed:

```text
npm run dist
npm run verify:packaged-harness-stress
```

## Requalification Note

During A0.7 follow-up work, a packaged experiment increased Harness runtime
text-delta durable batches from 64 to 256. The experiment still passed the A0.5
stress gate, but it worsened the relevant spike profile:

- `pending_batch_size_max`: 256;
- `persist_event_max`: 466.210 ms;
- `flush_pending_events_max`: 420.286 ms;
- `record_events_count`: 117.

The source was restored to the 64-event batch. This confirms the next
performance fix should be structural runtime/durable settlement decoupling, not
a larger synchronous append batch.
