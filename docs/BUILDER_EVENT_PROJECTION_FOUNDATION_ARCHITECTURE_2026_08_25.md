# Builder Event And Projection Foundation Architecture

Date: 2026-08-25

Status: active architecture authority for prerequisite Gate A0. Slice `A0.2a`
has repository acceptance; the remaining migration and packaged gates are open.

Depends on:

- [Current Event And Projection Audit](BUILDER_CURRENT_EVENT_PROJECTION_ARCHITECTURE_AUDIT_2026_08_25.md)
- [Mature Coding Desktop Architecture Research](MATURE_CODING_DESKTOP_ARCHITECTURE_RESEARCH_2026_08_25.md)
- [Builder Chat And Generation Performance Plan](BUILDER_CHAT_GENERATION_PERFORMANCE_PLAN.md)

## Decision

Preserve Builder's Main-owned authority and append-only semantic history, but
replace the current single-path propagation model with three explicit planes:

1. **Live stream plane** for high-frequency, run-scoped deltas.
2. **Semantic ledger plane** for authoritative user-visible and recovery facts.
3. **Materialized projection plane** for bounded, cursor-addressable UI views.

This is a structural migration, not a blanket rewrite. Existing Conversation
events remain readable and full replay remains the correctness oracle.

## Plane 1: Live Stream

Owns:

- assistant text/reasoning deltas;
- process and terminal output deltas;
- tool progress that is not yet a settled result;
- Browser load/action/observation progress.

Contract:

```text
stream_id
run_id
item_id
kind
sequence
offset
delta/ref
observed_at_ms
```

Rules:

- delivery is ordered and idempotent by `(stream_id, sequence)`;
- renderer stores assemble partial state without a complete Conversation read;
- animation-frame batching is allowed; semantic completion is never dropped;
- reconnect receives a bounded live snapshot or an explicit `live_unavailable`
  state;
- output beyond the memory budget spills to a private Main-owned blob/log;
- a live delta does not emit generic task-stream changed.

Crash recovery options are explicit:

- assistant text may be batch-spooled at a fixed interval for recovery;
- process/terminal output uses bounded retained scrollback plus spill;
- Browser progress is normally ephemeral; completed observations are durable.

Spool records are not individually replayed through the semantic Conversation
state machine. A settled record commits the final content or its immutable
evidence reference and digest.

## Plane 2: Semantic Ledger

Owns facts that affect recovery, model context, permissions, user decisions, or
public history:

- turn/run/step start and terminal boundaries;
- user message and completed assistant block/message;
- tool call admission and settled result;
- process/terminal start, ownership, exit, signal, and interruption;
- draft/check/review/checkpoint/Undo/Save/Discard facts;
- Browser action admission and completed observation evidence;
- project, task, and version lifecycle facts.

Rules:

- Main assigns sequence and validates compare-and-set head;
- append validates the known committed head and new suffix;
- immutable committed prefixes are not parsed/replayed twice per append;
- bounded append batches commit at semantic boundaries and explicit flush
  checkpoints;
- full replay runs on cold load, audit, migration, or cache-integrity failure;
- event schema and storage format have explicit versions and readers;
- unknown required events fail closed; declared informational events may be
  ignored only under a versioned contract.

The ledger may retain raw assistant chunks only if a replay-fidelity acceptance
case requires them. The default Builder target is a completed assistant block
plus optional recoverable spool reference, reducing durable event cardinality.

## Plane 3: Materialized Projections

Main owns incremental read models for:

- Conversation activity window;
- task supervision and attention;
- draft/review/checkpoint state;
- project/agent tree counts and summaries;
- command/terminal summaries;
- Browser tab and observation summaries.

Each projection has:

```text
projection_kind
scope_id
projection_version
ledger_cursor
revision
visible_window
has_earlier
```

Rules:

- appends fold only events after `ledger_cursor`;
- reads support `after_cursor` or return a bounded current snapshot;
- changed notifications include kind, scope, cursor, and revision;
- renderer refreshes only the affected controller/store;
- heavyweight evidence is represented by immutable refs and loaded on demand;
- a checksum/version mismatch discards the cache and rebuilds from the ledger;
- dual-projection tests compare incremental output with full replay.

## Process Boundaries

### Main

Retains:

- admission, permissions, identity, sequence assignment, and final commit;
- SQLite/Git/project authority;
- Browser session and WebContentsView registry;
- validation of worker/runtime results before they become facts.

### Execution Host

A supervised UtilityProcess or equivalent owns:

- runtime/Harness process lifecycle;
- subprocess and PTY process groups;
- output collection, backpressure, bounded retention, and spill;
- CPU-heavy read-only parsing/projection jobs approved by Main.

It cannot directly mutate product SQLite or Git authority.

### Renderer

Uses independent stores/selectors for:

- current live item;
- bounded durable activity;
- composer and decision cards;
- draft/review;
- project/agent navigation;
- Side Workspace layout;
- Browser chrome and observations.

A live text delta must not publish a new root BuilderApp snapshot.

## Browser Stability Contract

- `browser_session_id` and tab identity are Main-owned;
- React controls presentation and bounds, not WebContents lifetime;
- attach/detach/collapse does not recreate a tab;
- Project Preview, Agent Test, and User Web use separate session partitions;
- chat streams cannot navigate, resize, remount, or reload Browser state;
- Browser observations and screenshots are lazy evidence, not chat payloads;
- crash, stop, and orphan cleanup produce explicit lifecycle facts.

## Historical Data Migration

1. Freeze current event readers and capture representative anonymized fixtures.
2. Add envelope/storage schema versions without changing existing rows.
3. Implement a read-only compatibility adapter for each known historical shape.
4. Build the new projection beside the old projection.
5. Compare digests and visible results on copied databases.
6. Activate new reads behind a local feature flag.
7. Keep rollback to old reads until packaged soak passes.
8. Migrate or archive only copied data during qualification; production data is
   rewritten only by an explicit, backed-up, restart-safe migration.

## Gate A0: Foundation Migration

### A0.1 Measurement And Schema Inventory

- add redacted timing/counter instrumentation;
- inventory event envelope and nested runtime schema versions;
- freeze short, long, historical, interrupted, and oversized fixtures;
- record current baseline for Ask, Build, long stream, multi-tool, draft, and
  Browser/Preview-open scenarios.

Exit: measured report and historical compatibility matrix exist.

Progress on 2026-08-25: a redacted synthetic projection runner and an anonymous
historical `run_completed` compatibility fixture now exist. Product scenario
spans and packaged p95 evidence remain open.

### A0.2 Typed Change And Live/Durable Separation

- define live stream envelopes and typed changed events;
- route assistant/process progress directly to narrow stores;
- commit authoritative completion and bounded recovery checkpoints;
- remove unconditional task-stream refresh from live-only events.

Exit: 100 text deltas cause zero full Conversation/task-stream replay and no
lost completion, cancel, retry, or recovery fact.

Progress on 2026-08-25: slice `A0.2a` defines v2 `live_only` and
`durable_append` hints. One hundred `live_only` hints cause zero renderer
task-stream reads. Delta persistence still precedes renderer publication, so
`ARCH-001` and full A0.2 completion remain open. See
[the A0.2a gate](BUILDER_A0_LIVE_DELTA_REFRESH_ISOLATION_GATE_2026_08_25.md).

### A0.3 Incremental Ledger Append And Projection

- cache validated committed heads/prefixes;
- append and validate suffixes transactionally;
- add projection cursor/revision and incremental folding;
- add full-rebuild equality and cache-corruption fallback tests.

Exit: warm cost follows appended suffix size rather than total history.

### A0.4 Renderer And Workspace Isolation

- split narrow external stores and selectors;
- lazy-load source tree, diff, log, preview, and Browser evidence;
- stabilize Side Workspace and WebContentsView lifecycle;
- prove unrelated panels do not commit during live output.

Exit: React/Browser instrumentation meets isolation budgets.

### A0.5 Migration And Packaged Qualification

- run copied-database compatibility and rollback drills;
- run deterministic packaged stream, recovery, terminal-output, and Browser-open
  canaries;
- retain old read path until dual-read mismatches are zero for the qualification
  corpus;
- publish a dated residual-risk report.

Exit: Gate A0 is accepted and capability Gates G1-G7 may proceed.

## Acceptance Budgets

| ID | Required result |
| --- | --- |
| `ARCH-001` | live delta reaches renderer without waiting for semantic-ledger append |
| `ARCH-002` | 100 live deltas cause zero complete Conversation/task projection reads |
| `ARCH-003` | semantic completion is durable and exactly once after reconnect/restart |
| `ARCH-004` | warm append/projection work is proportional to suffix/cursor distance |
| `ARCH-005` | incremental and full-replay projections are digest-equivalent |
| `ARCH-006` | 10,000 historical facts across segments/checkpoints remain interactive |
| `ARCH-007` | routine Activity payload excludes source bodies, diffs, full logs, and Browser evidence |
| `ARCH-008` | live output does not commit unrelated project, workspace, or Browser React subtrees |
| `ARCH-009` | Browser tab/session identity survives chat streaming and workspace layout changes |
| `ARCH-010` | current and known historical Conversation fixtures load or fail with an explicit migration code |

## Non-Goals For A0

- adding language-specific toolchain providers;
- exposing an unrestricted shell;
- shipping the general User Web browser;
- replacing SQLite solely for performance;
- adopting every Harness event or persistence decision;
- redesigning the visible chat UI beyond changes needed for stable store
  ownership.

## Final Judgment

Performance work should happen next, but as an architecture foundation gate,
not as scattered tuning. Universal-language Process/Terminal work and the
built-in Browser both multiply live output and lifecycle events; building them
on the current full-replay hot path would create avoidable migration cost and
recurrent stalls.
