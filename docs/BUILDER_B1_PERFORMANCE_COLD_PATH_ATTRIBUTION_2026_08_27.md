# Builder B1 Performance Cold-Path Attribution

Date: 2026-08-27

Status: attribution gate. This is not a Browser Node, sandbox, or Workbench
implementation gate.

## Objective

User feedback says sending messages and generating work can still feel stuck or
laggy. A1 closed the dependency-readiness confusion; B1 narrows the remaining
performance work to measurable data flow:

```text
submit -> Main admission -> runtime streaming -> durable event persistence
-> reconcile -> conversation append/load -> task-stream projection -> IPC
-> renderer commit
```

The rule for this phase is unchanged:

```text
hot paths are narrow and transient; cold paths are complete and durable
```

B1 does not try to optimize by guesswork. It defines the spans that must be
measured before B2 changes any runtime, storage, or renderer behavior.

## Existing Evidence

Existing A0/A1 evidence already gives a strong direction:

- live output deltas are not the dominant bottleneck when they stay on the
  transient channel;
- terminal tab settlement itself was measured as bounded;
- large spikes were observed around Harness response reconcile, runtime
  reconcile, durable event persistence, and terminal task-stream settlement;
- increasing runtime event batch size reduced write count only slightly and made
  single-flush spikes worse, so larger batches are not the fix;
- dependency-unavailable runs now terminate as incomplete check facts instead
  of entering repair loops, which removes one stale "thinking" source.

## Attribution Buckets

B1 treats these as separate buckets. Reports and canaries should not collapse
them into one "generation took N seconds" number.

| Bucket | What It Means | Required Metrics |
| --- | --- | --- |
| Submit admission | renderer intent, Main admission, provider config, run contract | `main.harness_start.*`, submit-to-first-live event-loop window |
| Streaming | provider deltas and live-output display | `main.provider_output.*`, live-only task-stream changed counts |
| Durable runtime persistence | runtime event append/flush/order preservation | `main.harness_runtime.record_events.*`, `persist_event`, `flush_pending_events`, pending batch size |
| Reconcile | candidate/response/runtime reconciliation after provider completion | `main.harness_response.reconcile`, `main.harness_runtime.reconcile_run`, `main.harness_runner.reconcile_runtime` |
| Conversation storage | append, suffix validation, load, full-read/cache/suffix behavior | `main.conversation.append.*`, `main.conversation.load.*` |
| Task-stream projection and IPC | public projection cost and payload size | `main.task_stream.projection.*`, `main.task_stream.ipc.*`, cursor counts |
| Renderer commit | React commit scope and composer responsiveness | renderer performance trace sessions and input long-task evidence |

## B2 Candidate Slice

The next implementation slice should be **durable terminal settlement
decoupling**:

1. keep normal assistant text deltas on the transient live-output plane;
2. keep final conversation facts canonical in Main and SQLite;
3. avoid forcing every terminal settlement to synchronously rebuild and resend a
   full task-stream projection;
4. preserve event order and terminal facts before the UI claims completion;
5. keep Save/review gates tied to refreshed Main projections, not optimistic
   renderer guesses.

Acceptable first B2 shapes:

- typed terminal-settle notifications that trigger a narrow projection refresh;
- bounded durable append queue with ordering receipts;
- suffix-based conversation load/projection reuse for already validated event
  prefixes.

Rejected first B2 shapes:

- increasing runtime event batch size again;
- moving SQLite write authority to the renderer;
- hiding terminal facts until a later refresh;
- remounting Browser/Preview or Side Workspace as part of chat settlement;
- adding Browser Node, sandbox provider, or Workbench plugin architecture work
  to the same change.

## Boundaries

B1 and B2 may read Browser/Preview impact as performance context, but must not
activate Browser Node or mix browser sandbox with command sandbox. Browser
contracts remain separate from command execution, dependency preparation, and
runtime reconcile.

B1 and B2 may observe Workbench refresh fan-out, but must not redesign
Workbench data ownership in the performance slice. If Workbench refresh is a
measured contributor, the first fix should be typed/coalesced refresh routing,
not a new app/plugin architecture.

Dependency readiness remains closed under A1: detect before install, `Prepare
once` only for current-draft isolated check workspaces, and no project-root
install from Settings.

## Acceptance

B1 is accepted when:

1. the attribution buckets above are documented and source-tested;
2. the existing trace allowlist contains metrics for reconcile, durable runtime
   persistence, conversation storage, task-stream projection, IPC payload, and
   cursor behavior;
3. the next implementation target is a single B2 performance slice;
4. Browser Node, sandbox provider, Workbench architecture, and dependency
   installation are explicitly out of scope for B2;
5. focused tests pass.
