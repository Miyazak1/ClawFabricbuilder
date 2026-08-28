# Agent Workbench Task Supervision V2 Control and Result Closure Gate

Date: 2026-08-24

## Decision

Agent Workbench task supervision V2 is implemented as a development cutover. The public preload bridge is `builder-preload.v35`; no v34 compatibility path is retained.

The Workbench is a Main-owned supervision surface. Renderer code may select a task and request the bounded `cancel_task` operation, but it cannot choose or observe the generation request digest, dispatch provider work, grant permission, read source, or write source.

## Delivered Behavior

- The right-side Tasks console projects task identity from the durable Session Task Address store and task state from canonical SQLite conversation replay plus durable attention facts.
- Active task rows expose `Stop` only while Main owns an exact task-to-request binding.
- `Stop` submits only `agent_id`, `project_id`, `task_address_id`, and `operation`. Main resolves the hidden request digest and calls the generation service cancellation boundary.
- A rejected cancellation keeps the binding and `Stop` control visible. The control is removed only after cancellation is accepted or the run settles.
- One task admits at most one active request. A duplicate turn is rejected with durable `waiting_resource / concurrency_limit` attention.
- Different read-only task turns may run concurrently. Project-changing runs remain serialized by the existing Main-owned project task lease and report `waiting_resource / project_busy` on conflict.
- If restart leaves a durable `run_started` without a matching live Main request, the task projects as `Interrupted / Continue task`; it never remains falsely `Working`.
- Completed Workbench result messages support `Open task`, `Acknowledge`, and `Archive`. Acknowledgement also marks the message read and removes it from action-required counts.
- Result summaries remain derived from canonical task completion events. Message state is mutable metadata kept separate from immutable message content.

## Harness Alignment

DeepSeek Harness remains the execution authority. This slice does not emulate a resumable process that Harness does not expose.

- Cancellation is real and request-bound.
- Restart recovery is conversation continuation from durable facts, not process resurrection.
- A dedicated `pause_task` / `resume_task` operation is intentionally not exposed while runtime capability reports no session resume contract.
- `waiting_permission`, `waiting_user_input`, `waiting_resource`, and owner-paused attention remain durable states, but controls are shown only when backed by an executable runtime operation.

## Concurrency Policy

| Scope | Policy | User-visible result |
| --- | --- | --- |
| Same task | One active request | `concurrency_limit` attention |
| Different tasks, same project, write | Serialized project lease | `project_busy` attention |
| Different tasks, same project, read-only | Concurrent | Independent task progress |
| Different projects | Concurrent subject to runtime capacity | Independent task progress |
| App restart | No active process assumed | `Interrupted / Continue task` |

The project lease and task request bindings are deliberately Main-memory ownership. Durable SQLite events and attention records are the restart authority; an old process lease is never revived after restart.

## Authority Boundary

`builder-preload.v35` adds only:

```text
agentWorkbench.controlTask({ agent_id, project_id, task_address_id, operation: 'cancel_task' })
```

Forbidden Renderer inputs include `request_id`, request digest, provider identity, credentials, source paths, process handles, and permission decisions. IPC adapters require exact own-data fields and an active Renderer.

## Verification

The release gate completed with the following evidence:

- Focused Main runtime, IPC, task monitor, Workbench store, process host, programming runtime, and failure-canary tests passed.
- Focused Renderer Workbench port, controller, Builder Page, and app composition tests passed.
- TypeScript, ESLint, and the production Vite build passed.
- Full unit suite passed: 929 of 929 tests.
- Full Main and architecture boundary suite passed: 1,849 passed, 0 failed, 1 skipped.
- Windows installer and unpacked application were rebuilt successfully.
- Package verification passed, including network-denied CSP, Harness identity, ASAR closure, preload v35, and the bounded Workbench control channel.
- Packaged launch, default coding loop, Plan mode, Harness activity UI, and Harness compaction canaries passed.
- Packaged failure convergence passed for all three distinct paths:
  - an inactive runtime settled as `builder_generation_runtime_stalled` with the request retained for retry;
  - a killed Harness process settled promptly as `builder_generation_failed` without source mutation or a draft candidate;
  - an interrupted unchecked checkpoint survived restart with Continue, Review, and Undo available.

The crash canary deliberately gives idle supervision a 30-second fallback window. This prevents Windows process-tree discovery time from winning the race and verifies that process termination itself produces the failure fact within the 10-second crash bound.

## Deferred Follow-up

- Make checkpoint create/update/failure a first-class conversation recovery item instead of a Renderer-composed draft summary.
- Record Undo and Restore as request/result action rows in the conversation, with History retained as the detailed inspector.
- Expose bounded `run_control_requested` facts such as Cancel requested instead of filtering them from the activity stream.
- Project Save version and Discard draft completion as conversation facts.
- Refine Harness reasoning status, completed steps, and compaction into collapsed low-noise summaries without exposing provider raw logs.
- Add true pause/resume only when the Harness runtime exposes a verifiable session resume capability.
- Add runtime-capacity scheduling and queue position if cross-project parallelism exceeds the configured worker budget.
- Add richer public conflict ownership such as the blocking task title without exposing private request identity.
- Add structured result artifacts beyond the current bounded summary when Artifact/Capsule contracts are ready.
- Add explicit bulk archive and retention policies after real Workbench volume data exists.
