# Builder A0.7 Behavioral Performance Gate

Date: 2026-08-26

Status: in progress. This gate is not accepted until a packaged build proves the
remaining user-visible Main-thread spikes are reduced without weakening Builder
authority.

## Objective

A0.6c proved the hot live-output path is bounded and that JSON-RPC local
processing is not the bottleneck. A0.7 turns that attribution into behavior
changes.

The goal is to make the programming loop feel acceptable during ordinary use:

- sending a message should not freeze unrelated panes;
- long model streaming should stay smooth;
- command approval, command output, save, reconcile, and terminal settlement
should not create multi-second application event-loop stalls;
- missing project environment or dependencies should end in a clear terminal
state rather than a repair loop or stale "thinking" state.

## Dependency And Local Environment Boundary

User feedback clarified an important product distinction: the user's machine
may already have dependencies installed, while Builder's admitted agent check
environment may only see the project source snapshot or a materialized check
workspace.

That means "dependency missing" must not be treated as "the user did not install
it." The correct states are:

- project-local dependency ready;
- project-local dependency missing;
- host toolchain visible to Builder Main;
- host toolchain not admitted to the agent;
- install or host-environment binding requires explicit approval.

Codex can often inspect the current local workspace directly. Builder should
not silently inherit that authority. It needs a Main-owned environment-readiness
capability that can report what is project-local, what is host-local, and what
requires user approval before use.

## Change 1: Approval Profile Reuse

Implemented:

- `builder-controlled-command-approval-service` now stores the command profile
  selected during the approval request in a main-owned `WeakMap` keyed by the
  approved execution object.
- `consume` no longer rebuilds a full project-understanding snapshot only to
  rediscover the already-approved profile.
- `consume` still sanitizes the run contract and source tree, validates the
  approval object, validates the exact run, validates the caller-provided
  command profile id, and checks the approved source-tree digest.

This is intentionally small. Packaged attribution showed approval preparation
itself is around 1-2 ms, while most `command_approval.request` time is user/UI
wait. Still, removing duplicate source-tree understanding from the consume path
is correct and reduces repeated work without changing authority.

## Rejected Experiment: Larger Runtime Event Batches

Tried and rejected:

- increasing `MAX_RUNTIME_EVENT_BATCH_SIZE` from 64 to 256.

Packaged stress result for the experiment:

| Metric | Result |
| --- | ---: |
| `a05_gate_verified` | `true` |
| application event-loop max | 3,852.468 ms |
| `harness_runtime.pending_batch_size_max` | 256 |
| `harness_runtime.record_events_count` | 117 |
| `harness_runtime.persist_event_max` | 466.210 ms |
| `harness_runtime.flush_pending_events_max` | 420.286 ms |
| `harness_runtime.record_events_total` | 15,379.106 ms |

Compared with A0.6c's 64-event batch baseline, the write count dropped only
slightly, while the single-flush spike got worse. The source was restored to
the conservative 64-event batch.

Conclusion: durable runtime settlement will not be fixed by simply increasing
batch size. The next implementation needs structural work: a bounded append
queue, terminal lightweight acknowledgement, or workerized/batched persistence
that preserves ordering while keeping the UI path responsive.

## Next Required Work

1. Add Runtime Readiness / Dependency Blocked.
   - A0.7.1 implemented the terminal closure layer: automatic check
     `environment_unavailable` projections are recorded as incomplete command
     facts, do not enter source repair, reconcile the Harness run, and produce
     a clear "check environment not ready" conversation closure.
   - A0.7.2 added `builder-runtime-readiness-snapshot.v1` and a materializer
     private readiness read, separating project-root dependency markers from
     candidate check workspace dependency access without exposing paths.
   - A0.7.3 added a bounded `builder-runtime-toolchain-probe.v1` contract that
     can reduce Node/npm/pnpm/yarn/bun probes to enum states and bounded
     version strings; it is consumed by the readiness snapshot contract but is
     not allowed to install packages or expose host details.
   - A0.7.4 wired the bounded probe into check runtime composition and added a
     check main-service preflight gate. Declared external dependencies with no
     prepared candidate workspace now become an `environment_unavailable`
     check result before runner dispatch; package scripts without declared
     dependencies can still use the packaged runtime.
   - A0.8 projected redacted readiness reasons into check status/outcome UI
     contracts. The Save card, check activity row, side inspector, and restored
     conversation state can now distinguish a generic unavailable check from a
     missing prepared dependency workspace, install approval requirement,
     denied install preparation, or missing host toolchain signal without
     exposing paths, raw output, environment variables, or install authority.
   - Remaining readiness work: add an explicit dependency preparation approval
     flow, persist reusable preparation receipts, and broaden the taxonomy
     beyond Node package managers.

2. Reduce terminal settlement spikes structurally.
   - Keep live deltas on the transient output channel.
   - Record durable runtime events through a bounded queue or coalesced append
     model.
   - Preserve event order and terminal facts before claiming completion.

3. Split user-wait time from CPU-blocking time in packaged reports.
   - Approval wait should remain visible, but not be treated as local CPU work.
   - Tool execution windows should show command runtime, output handling, and
     durable settlement separately.

4. Keep Browser Node activation blocked until A0 exit.
   - Browser contracts can continue.
   - Runtime Browser work should wait until stream, command, and terminal
     settlement no longer create multi-second Main-thread stalls.

## Verification

Focused tests passed after the accepted change and rejected batch rollback:

```text
node --test tests\builder-controlled-command-approval-service.test.cjs tests\builder-generation-main-service.test.cjs tests\verify-packaged-harness-stress-canary.test.cjs
npm exec tsc -b --pretty false
```

Additional A0.7.2/A0.7.3 focused verification:

```text
node --test tests\builder-check-runtime-identity.test.cjs tests\builder-packaged-check-runtime-resolver.test.cjs tests\builder-runtime-toolchain-probe.test.cjs tests\builder-runtime-readiness-snapshot.test.cjs tests\builder-check-workspace-materializer.test.cjs tests\builder-check-run-runner.test.cjs
npm exec tsc -b --pretty false
```

A0.7.4 production wiring verification:

```text
node --test tests\builder-check-run-main-service.test.cjs tests\builder-check-run-runtime-composition.test.cjs tests\builder-runtime-toolchain-probe.test.cjs tests\builder-runtime-readiness-snapshot.test.cjs tests\builder-check-workspace-materializer.test.cjs tests\builder-check-run-runner.test.cjs
```

Final packaged requalification also passed against the rebuilt conservative
package:

```text
npm run dist
npm run verify:packaged-harness-stress
```

Packaged result:

| Metric | Result |
| --- | ---: |
| `a05_gate_verified` | `true` |
| `PB-03` live-output received / dropped | 605 / 0 |
| `PB-03` task-stream reads / full reads | 7 / 0 |
| `PB-03` BuilderPage / Activity commits | 34 / 8 |
| `PB-06` renderer bytes / flushes | 262,144 / 1 |
| `save_card_dismissed_after_save` | `true` |
| `saved_project_reopened_without_draft` | `true` |
| command-output event-loop max | 26.165 ms |
| application event-loop max | 3,349.152 ms |
| `command_approval.prepare_max_ms` | 0.984 ms |
| `command_approval.consume_max_ms` | 0.432 ms |
| `command_approval.wait_decision_max_ms` | 798.232 ms |
| `harness_runtime.pending_batch_size_max` | 64 |
| `harness_runtime.flush_pending_events_max` | 220.020 ms |
| `harness_runtime.persist_event_max` | 437.648 ms |
| `harness_response.reconcile_max_ms` | 1,532.863 ms |
| `harness_candidate.git_persist_max_ms` | 1,221.446 ms |
| `harness_candidate.automatic_check_max_ms` | 1,131.334 ms |

Decision: the accepted A0.7 source change is safe, but A0.7 is not complete.
The current package is better instrumented and preserves the UI/save correctness
gates, yet the remaining multi-second application event-loop spikes are still
not acceptable as a final daily-driver performance profile.
