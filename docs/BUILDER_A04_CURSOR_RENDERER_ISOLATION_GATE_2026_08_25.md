# Builder A0.4 Cursor And Renderer Isolation Gate

Date: 2026-08-25

Status: first vertical slice accepted in repository tests and the packaged
Windows Harness UI canary. This is not the complete A0 exit.

## Objective

Stop sending and republishing the complete visible task-stream window for every
durable change. Keep Conversation, SQLite, projection, and cursor authority in
Main while allowing the renderer to consume `full`, `incremental`, and
`unchanged` public-window results without weakening restart or compatibility.

The slice also isolates Activity and Side Workspace rendering from unchanged
cursor refreshes and unrelated chat updates. The existing v1 complete-read path
remains the compatibility and recovery fallback.

## Accepted Boundary

`electron/builder-task-stream-ipc-adapter.cjs` owns a versioned opaque cursor
and a bounded digest cache. A cursor read returns one of three admitted forms:

- `full`: a complete sanitized public window and its next cursor;
- `incremental`: a contiguous public suffix plus the retained window boundary;
- `unchanged`: a new cursor with no repeated public window.

Unknown, expired, mismatched, or non-contiguous cursor state returns `full`.
Callers that omit the cursor continue to receive the v1 complete snapshot.
Main remains authoritative for sanitization, the 512-item public window,
identity, sequence order, status projections, and payload admission.

`builderDesktopTaskStreamPort.ts` keeps a normalized renderer activity store
indexed by canonical sequence. It merges admitted suffixes, evicts sequences
before the Main-provided window boundary, rejects duplicate or malformed
sequence graphs, and rebuilds the immutable public snapshot. A rejected cursor
protocol falls back once to the legacy v1 read.

The Conversation controller treats durable changed notifications as background
refreshes. It does not publish a transient `refreshing` snapshot, does not
publish an admitted `unchanged` result, and publishes an incremental result
once. Notifications are typed and coalesced for 160 ms; `live_only` updates
remain on the narrow live-output store and cause no durable task-stream read.

Activity and Side Workspace keep stable callback identities and memoized
component boundaries. The packaged run proves that Side Workspace stays mounted
once while generation, Preview, files, History, Undo, cancellation, and Save
continue around it.

## Repository Evidence

Focused tests prove:

- Main `full`, `incremental`, and `unchanged` responses;
- unknown-base and legacy-v1 full fallback;
- equality between an incrementally merged public window and a complete Main
  projection;
- a real 512-item renderer window advancing from sequences `1..512` to
  `2..513` without duplication;
- zero controller publication for an unchanged normalized snapshot;
- one ready publication for a changed background refresh;
- typed changed coalescing and live-only isolation;
- Save decision placement, later activity growth following, and Side Workspace
  interaction behavior.

The focused Main suite passed 46 tests. The focused renderer controller and
port suite passed 28 tests. The broader BuilderPage qualification passed in the
147-test renderer run before the final coalescing adjustment; final validation
also includes TypeScript and the production package build.

## Packaged Qualification

The deterministic 26-request Windows Harness scenario covers `PB-01`, `PB-02`,
`PB-04`, `PB-05`, `PB-07`, and `PB-10`.

### Initial Build And Continuation

| Metric | Pre-A0.4 observation | A0.4 | Gate |
| --- | ---: | ---: | ---: |
| Renderer result bytes p95 | complete-window transport | 6,696 B | <= 8 KiB |
| Controller publishes | 77 | 34 | <= 40 |
| Activity commits | 126 | 84 | <= 100 |
| BuilderPage commits | 228 | 183 | <= 200 |
| Side Workspace commits | 11 | 11 | <= 20 |
| Side Workspace mounts | 1 | 1 | 1 |

The renderer read p95 was 743.2 ms in this run. It remains far below the A0.2
3,105.2 ms baseline, but is above the single A0.3 qualification value of
629.6 ms. A multi-run warm distribution is still required before accepting a
tighter initial-phase latency budget.

### Restart, Recovery, Multi-tool, Preview, Cancel, Save

| Metric | A0.3 / pre-isolation | A0.4 | Gate |
| --- | ---: | ---: | ---: |
| Renderer task-stream read p95 | 1,845.6 ms | 1,727.1 ms | <= 1,845.6 ms |
| Renderer result bytes p95 | about 98 KiB complete window | 9,445 B | <= 10 KiB |
| Controller publishes | 117 | 43 | <= 50 |
| Activity commits | 310 | 238 | <= 260 |
| BuilderPage commits | 330 | 258 | <= 280 |
| Side Workspace commits | 308 | 34 | <= 40 |
| Side Workspace mounts | 1 | 1 | 1 |

The renderer observed all three protocol forms in both phases. The second phase
used 3 full, 34 incremental, and 17 unchanged results. Main metrics still
include direct legacy reads made by canary task-stream polling; renderer result
metrics isolate the product cursor path and therefore provide the payload gate.

The canary now fails when cursor forms are absent, the heavy-phase read p95
exceeds the A0.3 value, renderer payload p95 exceeds the admitted window budget,
controller or component commit budgets regress, or Side Workspace remounts.

## Correctness Evidence

The same packaged run passed:

- failed automatic check, repair, and final passing check;
- consecutive coding turns before Save;
- project-folder materialization and restart recovery;
- current and earlier checkpoint History;
- Undo success and external-conflict refusal;
- cancellation terminalization and late-candidate rejection;
- workspace escape, stale edit, and unsupported tool rejection;
- no-change preservation;
- Save decision geometry, Save-card dismissal, and saved milestone visibility;
- performance-trace privacy.

## Residual Work

A0.4 accepts the cursor protocol and renderer isolation slice, not the complete
performance program. Remaining work includes:

1. `PB-03`, a controlled 60-second stream with frame and commit evidence;
2. `PB-06`, a 10 MB command-output burst with lazy payload evidence;
3. five warm repetitions before setting product-wide p95 budgets;
4. moving or batching remaining synchronous SQLite, file, and Git work;
5. a stable Browser process/view boundary proven under streaming and resize.

Universal Process/Terminal and the built-in Browser can proceed only on top of
these accepted authority and isolation contracts.
