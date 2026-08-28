# Builder A0.5 Stress Qualification Gate

Date: 2026-08-25

Status: accepted as a single deterministic packaged qualification for `PB-03`
and `PB-06`. This closes the A0 stress slice; it does not declare all Main
process latency work complete.

## Objective

Prove that the architecture accepted in A0.2 through A0.4 remains bounded
under two workloads that ordinary functional canaries did not exercise:

- `PB-03`: a controlled 60-second Harness stream with 600 text deltas;
- `PB-06`: an exact 10 MiB command-output burst split evenly between stdout
  and stderr.

The gate must keep live deltas off the durable task-stream replay path, keep
Activity and Side Workspace rendering bounded, preserve an already-open
Preview, and retain complete command evidence without transporting it through
the renderer. Save, cancellation, restart recovery, and existing authority
boundaries must continue to pass in the packaged desktop.

## Accepted Architecture

### Live output

Harness text deltas remain on the narrow renderer live-output store. Typed
`live_only` notifications do not cause a complete durable task-stream read.
Activity subscribes to equivalent projected status, candidate, and live-output
facts instead of inheriting every `BuilderPage` render. Side Workspace is a
stable memoized boundary.

Preview stays mounted while another Side Workspace tab is active. Inactive
Preview content is hidden rather than destroyed, so a stream, command output,
or one-time Terminal attention transition cannot discard browser state. A new
command may focus Terminal once; later explicit user tab selection wins.

### Command output

The command executor owns complete stdout and stderr in Main. The public live
summary is capped independently per stream at 128 KiB and emitted in UTF-8-safe
chunks no larger than 64 KiB. This prevents a late stderr burst from evicting
the entire stdout summary and keeps the renderer's combined retention at
256 KiB.

Complete output is represented outside the renderer by an opaque
`builder-command-output:*` reference, byte and line counts, and SHA-256
digests. On-demand reads are capped at 64 KiB per page. The private retention
limit remains 16 MiB; an output beyond that limit is terminalized instead of
being admitted without a bound. Raw output references, paths, identifiers, and
content do not enter performance traces.

Runtime identity verification still performs a complete SHA-256 content hash
for every command. The hashing path is asynchronous so integrity is not traded
for Main-thread responsiveness. PB-06 records a command-window event-loop
delay metric separately from the application-lifetime diagnostic.

The renderer's truncation indicator is driven by the durable verified command
terminal fact. It is not inferred from the currently visible string length.

## Hard Budgets

`npm run verify:packaged-harness-stress` fails when any of these boundaries is
violated.

### PB-03

| Metric | Budget |
| --- | ---: |
| Provider duration | at least 59,000 ms |
| Received live-output events | at least 600 |
| Dropped live-output events | 0 |
| Durable task-stream reads | at most 12 |
| Complete cursor reads | 0 |
| Controller publications | at most 12 |
| BuilderPage commits | at most 40 |
| Activity commits | at most 40 |
| Side Workspace commits | at most 8 |
| Side Workspace mounts/unmounts during stream | 0 / 0 |

### PB-06

| Metric | Budget |
| --- | ---: |
| Complete command output | exactly 10 MiB |
| Public output transport | at most 256 KiB |
| Renderer retained output | at most 256 KiB |
| Renderer flushes | at most 8 |
| Side Workspace commits | at most 12 |
| Side Workspace mounts/unmounts during burst | 0 / 0 |
| Main spill write max | at most 50 ms |
| Command-window event-loop delay max | at most 250 ms |

The canary also fails when either 5 MiB private stream is incomplete, its line
count or digest is wrong, the opaque reference leaks into the renderer, the
truncation indicator is absent, Preview remounts, Save remains pending, restart
reopens a draft, or trace privacy is violated.

## Packaged Qualification

The joint Windows packaged run passed with `a05_gate_verified: true`.

### PB-03 Result

| Metric | Result | Gate |
| --- | ---: | ---: |
| End-to-end observed duration | 99,809 ms | >= 59,000 ms |
| Live-output events received / dropped | 605 / 0 | >= 600 / 0 |
| Durable task-stream reads | 8 | <= 12 |
| Complete cursor reads | 0 | 0 |
| Controller publications | 6 | <= 12 |
| BuilderPage commits | 35 | <= 40 |
| Activity commits | 9 | <= 40 |
| Side Workspace commits | 0 | <= 8 |
| Side Workspace mounts / unmounts | 0 / 0 | 0 / 0 |

The provider fixture emitted exactly 602 SSE events: one role event, 600 text
deltas spaced by 100 ms, and one terminal event. The renderer observed 605
live events because its metric includes admitted lifecycle output in addition
to the 600 controlled text deltas. No complete task-stream read occurred during
the measured interval.

### PB-06 Result

| Metric | Result | Gate |
| --- | ---: | ---: |
| Main bytes received | 10,485,760 B | exactly 10 MiB |
| Public bytes transported | 262,144 B | <= 256 KiB |
| Renderer events / flushes | 1 / 1 | flushes <= 8 |
| Renderer retained maximum | 262,144 B | <= 256 KiB |
| Visible stdout / stderr | 131,072 / 131,072 B | fair bounded summary |
| Side Workspace commits | 6 | <= 12 |
| Side Workspace mounts / unmounts | 0 / 0 | 0 / 0 |
| Main spill write maximum | 0.247 ms | <= 50 ms |
| Command-window event-loop delay maximum | 15.802 ms | <= 250 ms |

Both private 5 MiB streams retained all 80 lines, matched their recorded
digests, and were reachable only through the opaque Main-owned reference. The
renderer displayed the verified truncation state and never received that
reference.

## Interaction Regression

The packaged Harness UI v2 canary passed after the stress qualification. It
proved:

- Save appears only after active work settles, the latest output remains above
  the Save card, and the card disappears after Save;
- a saved milestone is visible and the unsaved draft is preserved until Save;
- restart restores the unsaved checkpoint and materialized project folder;
- cancellation records a canonical terminal fact, blocks a late candidate,
  and preserves the checkpoint source;
- Preview, Files, History, Undo, automatic repair, consecutive unsaved coding
  turns, stale-edit recovery, unsupported-tool recovery, and no-change work
  continue to function;
- trace privacy remains intact.

Focused repository verification also passed the command executor, runtime
identity, resolver, performance trace, Harness composition, generation IPC,
renderer command store/port, conversation projection, BuilderPage, and
BuilderApp suites, plus TypeScript compilation. The stale `BuilderApp.test.tsx`
Save-card assertions have been updated to distinguish the lightweight
`Unsaved draft` state from the composer decision card: Save/Discard is expected
only after the visible task stream carries current review/check evidence.

## Residual Risk And Next Gate

The application-lifetime event-loop diagnostic reached 23,790.092 ms in the
joint stress run. The command-window metric proves that PB-06 output ingestion
itself stayed at 15.802 ms, but the larger number means startup or another cold
Main path still has a severe synchronous stall. The PB-03 end-to-end duration
also includes about 40 seconds beyond the provider's nominal 60-second stream.
These diagnostics are not hidden by the A0.5 acceptance and must inform the
next cold-path investigation. The next trace revision now emits Main lifecycle
duration aggregates for ready handling, IPC runtime creation, IPC registration,
window creation, and IPC shutdown so the next packaged stress run can attribute
the stall before turning it into a hard budget.

A follow-up packaged stress run with lifecycle attribution completed after this
trace revision. The earlier 23,790.092 ms spike did not reproduce at the same
scale, but the joint PB-03/PB-06 run still recorded a 10,099.884 ms application
event-loop max. The explicit lifecycle durations were much smaller:
`ready_handler_max_ms=294.887`, `create_ipc_runtimes_max_ms=269.26`,
`register_ipc_runtimes_max_ms=0.212`, `create_main_window_max_ms=25.293`,
and `shutdown_ipc_runtimes_max_ms=46.151`. A PB-06-only run recorded
`application_event_loop_delay_max_ms=903.348` with similarly bounded lifecycle
durations. This rules out the newly measured startup/shutdown sections as the
source of the large joint-run spike; the next attribution pass needs
event-loop checkpoints around PB-03 streaming settle, save/version refresh,
close, and restart windows.

That attribution pass now emits fixed-name Main event-loop windows from the
packaged stress canary. In the latest full PB-03/PB-06 run, the application
event-loop max reached `43,486.544 ms` and was attributed to
`pb03_streaming_to_terminal` (`duration_ms=119,191.109`, `p95_ms=303.825`).
`pb06_output_to_terminal` reached `3,969.909 ms`, while
`save_version_refresh` stayed much smaller (`max_ms=494.404`) and
`restart_reopen_project` stayed smaller again (`max_ms=183.37`). This confirms
the main residual risk is the DeepSeek Harness long-stream/runtime-settle path,
not initial window creation, IPC registration, Save-card dismissal, or project
reopen.

The next gate should split `pb03_streaming_to_terminal` into narrower runtime
windows: provider stream ingestion, runtime event normalization, candidate
check coordination, failed-check repair/reconcile, task-stream durable terminal
read, and renderer clear-busy acknowledgment. The newly reported dependency
readiness issue belongs in that gate: missing dependencies should become a
bounded `environment_unavailable` or `blocked_environment/dependencies_missing`
terminal fact, skip automatic repair, run reconcile, and clear live/busy state.

One deterministic run is not a product-wide latency distribution. Five warm
repetitions, `PB-08` Agent Test Browser, and `PB-09` sidebar resize during a
stream remain open. Universal Process/Terminal and the built-in Browser may now
build on this bounded hot path, but their acceptance must add stable browser
process/view lifetime, navigation and console evidence, resize/stream
isolation, and cold Main-path budgets.

Acceptance plugins remain outside this hot path. The Unlazy decision in
`UNLAZY_PLUGIN_ACCEPTANCE_LAYER_DECISION_2026_08_25.md` places optional pinned,
reviewed `local_trusted` gates behind a thin Builder adapter after runtime tool,
check, and checkpoint facts. They must not enter the DeepSeek Harness kernel or
streaming/runtime-event path.

## Decision

A0.5 accepts the stress boundaries for the current architecture. The next
product slice should be the stable built-in Browser and universal programming
loop on top of these contracts, while a parallel architecture gate isolates
and removes the remaining cold Main-thread stall before broader feature load
can normalize it.
