# Mature Coding Desktop Architecture Research

Date: 2026-08-25

Status: primary-source design research for Builder's next architecture gate.

## Research Question

How do mature coding runtimes and desktop applications keep live output
responsive while retaining authoritative history, recovery, bounded output,
isolated processes, and stable embedded browser state?

This research uses official repositories and documentation only. It does not
assume that one upstream design can be copied wholesale.

## OpenAI Codex

The Codex app-server protocol separates lifecycle items from their deltas:

- `item/agentMessage/delta` is an ordered append notification keyed by
  `itemId`;
- the final `agentMessage` item contains the accumulated reply;
- `item/commandExecution/outputDelta` streams process output while the final
  item contains aggregated output, status, exit code, and duration;
- standalone processes similarly emit `process/outputDelta` and a later
  `process/exited` notification;
- approvals are server-initiated requests presented inline in the active turn.

Builder should adopt the protocol distinction between partial notification and
authoritative completed item. It should not infer from this public protocol how
Codex stores internal history.

Primary source:
[Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

## Pi

Pi's RPC protocol emits `message_update` deltas without a cumulative message
snapshot. Clients assemble partial state from `message_start` plus indexed
deltas and treat `message_end.message` as authoritative. Direct Bash and tool
execution have separate progress events and terminal responses.

Pi's JSONL session format persists completed assistant messages. The
stream-only `pending` stop reason should not appear in persisted session JSONL.
Its session tree uses `id` and `parentId` for branching, and current versions are
migrated on load.

For large command output, Pi retains a bounded view and records a
`fullOutputPath` when output is truncated. This preserves usability without
placing the complete stream in every UI or model-context payload.

Useful adoption:

- delta events contain only delta data;
- completion carries the authoritative message;
- output retention and full-output evidence are separate;
- branch/session metadata has an explicit version and migration path.

Primary sources:
[Pi RPC protocol](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md),
[Pi session format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md), and
[Pi Bash streaming UI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/components/bash-execution.ts).

## DeepSeek Harness

DeepSeek Harness deliberately makes its typed append-only Session log the
source of model history. It persists `assistant/chunk` as well as the final
`assistant/message`, using source event sequences to connect the final surface
node to its chunks. That is a stronger replay-fidelity choice than Pi's
completed-message persistence.

Crucially, its persistence design does not synchronously rewrite or reread the
complete log for every event:

- `session/event` is a synchronous in-memory notification;
- persistence copies the event into a per-session controller without blocking
  the producer;
- a fixed batching window durably appends pending events;
- `session/flush` is the explicit ordering/error checkpoint;
- persistence exposes `readFrom(id, fromSeq)` for watermark-based read models;
- unchanged cold sessions can reuse a bounded LRU of validated immutable state;
- list/snapshot observation uses lightweight revisions without full-log loads;
- crash recovery balances an interrupted open turn rather than discarding its
  durable prefix.

Harness also separates capability contracts from providers and consumers. Its
subprocess layer owns process groups, bounded collection, private spill files,
credential scrubbing, termination escalation, and cleanup. Bash and terminal
tools consume that capability instead of owning process mechanics themselves.

Useful adoption:

- keep exact chunk replay only if it has a product requirement;
- batch durability asynchronously and make semantic flush points explicit;
- expose suffix reads and projection watermarks;
- keep process mechanics below shell/language-specific tools;
- retain bounded output plus private spill evidence.

Do not copy blindly:

- Harness is a developer preview and explicitly permits compatibility-breaking
  changes;
- its raw-chunk log is viable because append, persistence, and read-model paths
  are designed for it; adding raw chunks to Builder's current full-replay append
  path is not viable;
- its terminal sessions currently do not survive Harness process exit, while
  Builder needs explicit restart reconciliation.

Primary sources:
[Harness architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md),
[Harness sessions](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md),
[Harness persistence](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/persistence.md),
[Harness shell architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/shell.md), and
[Harness output retention](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/output-retention/README.md).

## Visual Studio Code

VS Code's event and scheduling utilities make coalescing an explicit primitive.
Its event library supports debounce, accumulation, and throttle with merge
functions. `ThrottledDelayer` prevents repeated requests from accumulating while
one asynchronous task is already running.

The terminal backend is process-isolated. The PTY host exposes process-data,
ready, exit, property, and replay events through IPC, has heartbeat-based
responsiveness detection, and can restart after unexpected termination. The
renderer-facing terminal process manager handles output as a stream, includes
acknowledgement/backpressure machinery, and keeps seamless-relaunch recording
separate from ordinary process output.

Useful adoption:

- event coalescing should be a named contract, not incidental booleans in each
  controller;
- process output needs identity, acknowledgement/backpressure, replay window,
  and lifecycle signals;
- PTY/process failure must not freeze the desktop Main process;
- restart/reconnect is a first-class state transition.

Primary sources:
[VS Code event utilities](https://github.com/microsoft/vscode/blob/main/src/vs/base/common/event.ts),
[VS Code async utilities](https://github.com/microsoft/vscode/blob/main/src/vs/base/common/async.ts),
[VS Code PTY host service](https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/ptyHostService.ts), and
[VS Code terminal process manager](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/terminalProcessManager.ts).

## Electron

Electron's process model assigns privileged lifecycle ownership to Main and
isolates each embedded web surface in a renderer process. Electron recommends a
UtilityProcess for CPU-intensive, untrusted, or crash-prone Node workloads
instead of keeping them in Main.

`WebContentsView` is a Main-process object and can adopt an existing
`WebContents`, allowing view presentation to change without replacing browser
identity. `session.fromPartition` provides stable in-memory or persistent
partitions. Remote content should run with Node integration disabled, context
isolation and sandboxing enabled, and a narrow IPC bridge.

Useful adoption:

- Browser identity and session partitions are Main-owned resources, not React
  component state;
- layout may attach/detach or resize a stable view without recreating its tab;
- heavy projection and process supervision can use UtilityProcess/worker
  boundaries while Main retains admission and commit authority;
- Project Preview, Agent Test, and User Web require separate partitions and
  capability policies.

Primary sources:
[Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model),
[WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view),
[Session partitions](https://www.electronjs.org/docs/latest/api/session),
[UtilityProcess](https://www.electronjs.org/docs/latest/api/utility-process), and
[Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

## Comparison Matrix

| Concern | Codex | Pi | Harness | VS Code / Electron | Builder implication |
| --- | --- | --- | --- | --- | --- |
| live assistant text | item delta notification | delta-only update | durable raw chunks | coalesced event primitives | dedicated ordered live stream |
| completion authority | final item | `message_end.message` | `assistant/message` citing chunks | final process/item state | one settled semantic record |
| persistence | public protocol does not specify | completed JSONL messages | batched append-only log | service-specific | choose replay fidelity explicitly |
| incremental reads | item/thread protocol | session branch APIs | `readFrom(fromSeq)` | event/replay channels | cursor and watermark required |
| large output | aggregate plus deltas | bounded result plus spill | retainer plus spill | terminal replay/backpressure | bounded view plus private blob |
| process isolation | app server/process handles | child process RPC | subprocess capability provider | PTY host/UtilityProcess | separate execution host |
| browser ownership | desktop-specific | not central | web UI, not desktop browser | Main-owned WebContentsView/session | stable Main browser registry |
| schema evolution | versioned protocol | load migration | strict format/version policy | API compatibility layers | explicit readers and migration |

## Cross-Project Conclusions

1. High-frequency deltas are ordered stream updates, not reasons to refetch an
   entire conversation graph.
2. A completed message/tool/process result is the authoritative public item.
3. Exact raw-chunk durability is optional, but if chosen it needs asynchronous
   batching and suffix reads.
4. Read models advance from a cursor/watermark and rebuild cold only when needed.
5. Large output is retained through bounded previews and separately addressed
   full evidence.
6. Terminal/process mechanics are isolated from both UI and language tools.
7. Embedded browser identity, partition, and lifecycle live outside React's
   render lifecycle.
8. Version and migration policy must be part of the storage contract, not a
   release afterthought.

