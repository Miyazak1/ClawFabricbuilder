# Builder A0.3 Incremental Replay And Projection Gate

Date: 2026-08-25

Status: first vertical slice accepted in repository tests and the packaged
Windows Harness UI canary. This is not the full A0 exit.

## Objective

Make warm Conversation append, load, and task-stream projection proportional
to the newly committed suffix instead of the complete event history, without
moving authority out of Main or weakening digest, replay, restart, Save, Undo,
cancellation, and recovery semantics.

## Implemented Boundary

The canonical Conversation replay module now exposes an append-only
accumulator backed by the same transition table as complete replay. It does not
duplicate lifecycle rules. Each suffix must continue the prior sequence and
`previous_event` head, preserve project and Conversation identity, use unique
event and command identities, and pass the existing transition admissions.

The SQLite metadata authority keeps an in-memory cache per open database and
Conversation. A cache entry contains:

- the last SQLite-read and digest-validated head;
- immutable canonical events;
- the public replay snapshot;
- the replay accumulator;
- the verified stored byte count.

Warm reads still query the Main-owned Conversation head row. A matching head
returns the validated cache. A newer head reads only rows after the cached
cursor and advances the accumulator. A mismatch or validation failure deletes
the cache and returns to complete SQLite read and replay.

Append remains a `BEGIN IMMEDIATE` transaction with expected-head CAS. New rows
are inserted, read back by suffix, checked against canonical request bytes, and
then admitted through the replay accumulator. Any failure rolls back SQLite and
invalidates the in-memory cache.

Task-stream projection has a separate Main-authority path. The public projection
API retains complete sanitization and replay for untrusted callers. The
Main-owned path consumes the already frozen authority snapshot and caches only:

- the latest 512 public items and total projected item count;
- active runtime tool aggregation;
- incomplete assistant text aggregation;
- latest run progress stages;
- the exact last authority event reference and cursor.

Only a reference-contiguous suffix can advance this cache. Otherwise it rebuilds
from the complete validated authority state. Renderer durable changed hints are
also coalesced when they arrive in the same scheduling turn; live-only hints
remain isolated from durable reads.

## Packaged Before And After

The comparison uses the same deterministic 26-request packaged Harness UI
scenario and scenario coverage: `PB-01`, `PB-02`, `PB-04`, `PB-05`, `PB-07`,
and `PB-10`.

### Initial Build And Continuation

| Metric p95 | A0.2 baseline | A0.3 | Change |
| --- | ---: | ---: | ---: |
| Conversation append | 175.520 ms | 26.714 ms | -84.8% |
| Conversation load | 55.432 ms | 0.081 ms | -99.9% |
| Task-stream projection | 38.491 ms | 0.485 ms | -98.7% |
| Main task-stream IPC | 139.410 ms | 30.126 ms | -78.4% |
| Renderer task-stream read | 3,105.2 ms | 629.6 ms | -79.7% |
| Main event-loop delay | 328.991 ms | 86.376 ms | -73.7% |

Initial draft duration fell from 29,846 ms to 13,329 ms, a 55.3% reduction.
There was one complete Conversation read and 621 warm cache hits.

### Restart, Recovery, Multi-tool, Preview, Cancel, Save

| Metric p95 | A0.2 baseline | A0.3 | Change |
| --- | ---: | ---: | ---: |
| Conversation append | 266.449 ms | 62.977 ms | -76.4% |
| Conversation load | 91.366 ms | 0.086 ms | -99.9% |
| Task-stream projection | 58.492 ms | 1.230 ms | -97.9% |
| Main task-stream IPC | 217.817 ms | 69.507 ms | -68.1% |
| Renderer task-stream read | 6,108.0 ms | 1,845.6 ms | -69.8% |
| Main event-loop delay max | 8,287.945 ms | 2,856.321 ms | -65.5% |

There was one complete read after restart and 844 warm cache hits. All 193
appends were suffix-read and suffix-transition validated. Task-stream projection
remained below 2.603 ms at worst in this phase.

## Correctness Evidence

The packaged canary passed all existing closure facts, including:

- automatic failed-check repair and subsequent passing check;
- consecutive unsaved draft continuation;
- restart recovery and current checkpoint restoration;
- checkpoint Undo and external conflict refusal;
- cancellation terminalization and late-candidate rejection;
- workspace escape, stale edit, and unsupported tool denial;
- unchanged-work preservation;
- Save card dismissal and saved milestone visibility;
- stable Side Workspace mount count of one;
- completed action geometry and performance-trace privacy.

Repository evidence includes:

- 80 replay, SQLite, and task-stream projection tests;
- 212 Conversation, Generation, IPC, compatibility, and trace tests;
- 14 renderer Conversation controller tests;
- TypeScript and production Vite builds.

Eight existing `BuilderApp.test.tsx` scenarios still use draft fixtures that do
not project a terminal Agent activity after the product rule changed to show the
Save decision only after a stage settles. The real packaged terminal path and
the focused BuilderPage stage tests pass. Those fixtures should be corrected in
a UI test-maintenance slice rather than weakening the production stage gate.

## Residual Work And A0.4

The remaining renderer p95 is no longer dominated by replay. A durable read
still transports and sanitizes the complete visible task-stream window, and
high-level React surfaces still commit on many Conversation changes. In the
second phase, task-stream results reached about 99 KB, BuilderPage committed 328
times, and Side Workspace committed 308 times even though it mounted only once.

The next slice is A0.4 visible-window cursor reads and renderer isolation:

1. add Main-owned `after_cursor` or ETag-style unchanged responses;
2. return only changed public items and changed status projections;
3. merge the delta into a normalized renderer activity store;
4. split Activity and Side Workspace subscriptions so chat changes do not
   commit Browser, Preview, file, or History surfaces;
5. add strict `PB-03` 60-second streaming and `PB-06` 10 MB output fixtures.

