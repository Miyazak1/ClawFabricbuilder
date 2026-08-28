# Builder Current Event And Projection Architecture Audit

Date: 2026-08-25

Status: measured current-state evidence. This document describes the repository
as it exists; it is not a target architecture.

## Executive Finding

The current slowdown is architectural amplification, not one isolated UI bug.
Builder already has a useful Main-owned authority boundary and a renderer live
output path, but every normalized runtime event also enters the canonical
Conversation path. A text batch can therefore cause synchronous persistence,
full-prefix validation and replay, a generic task-stream refresh, another full
projection, a large IPC graph copy, and broad React publication.

The authority model should be preserved. The hot-path coupling should not.

## Scope And Method

The audit covered:

- composer submission through runtime/provider execution;
- Harness event normalization and live-output delivery;
- Conversation append/load/replay and task-stream projection;
- renderer IPC validation and controller subscriptions;
- BuilderApp, BuilderPage, Activity, Side Workspace, and Preview ownership;
- focused tests, synthetic scaling probes, and anonymous numeric inspection of
  the current desktop SQLite database.

No prompt, source file, command output, URL, credential, or user-visible message
text was collected from the desktop database.

## Current Data Flow

### Submission

```text
BuilderComposer
-> BuilderPage onSubmitInstruction
-> BuilderApp submitInstructionText
-> intent / permission / project preparation
-> BuilderProjectController
-> builderDesktopCodeGeneratorPort
-> generation IPC
-> builder-generation-main-service
-> selected runtime/provider
```

Main authority, admission, and renderer isolation are appropriate boundaries.
The breadth of `BuilderApp.tsx` and `BuilderPage.tsx` means that a broad snapshot
publication can still recompute UI that did not semantically change.

### Runtime Output

The Harness normalizer batches assistant text at 64 UTF-8 bytes or punctuation
and paragraph boundaries in
`electron/builder-harness-runtime-event-normalizer.cjs`.

For every normalized runtime event,
`electron/builder-generation-main-service.cjs` first calls
`recordConversationProgrammingRuntimeEvent`. Only after that durable call
returns does `assistant_text_delta` reach `onProviderOutputDelta`.

The effective path is therefore:

```text
provider chunk
-> normalized runtime event
-> canonical Conversation append
-> generic task-stream changed hint
-> renderer live-output delta
```

The fast renderer path exists, but it is gated by the slow durable path.

### Conversation Persistence

`electron/builder-product-metadata-database.cjs` uses synchronous SQLite
`DatabaseSync` operations. `appendConversationEvents` currently:

1. opens an immediate transaction;
2. loads and validates the complete existing Conversation;
3. replays the old prefix plus the new events;
4. inserts the new rows and advances the compare-and-set head;
5. loads, validates, and replays the complete Conversation again;
6. returns the complete event list and snapshot.

`loadConversationState` parses and validates every stored event and replays the
entire prefix. The Conversation service sanitizes the authority result again,
then emits a changed hint containing only `project_id`. Transcript and
compaction hooks may load the Conversation again.

These checks provide strong integrity. Their placement makes append cost grow
with historical length and blocks the Electron Main event loop.

### Task Stream And Renderer

The renderer Conversation controller treats a matching changed hint as a full
`read()`. It coalesces multiple hints only while one read is active; a hint
arriving during that read queues one additional complete read. The hint has no
change kind, cursor, or affected surface.

Task-stream projection replays all events and walks them again to build public
items before retaining the latest 512. The desktop port then performs:

```text
assertPlainGraph
-> structuredClone
-> assertPlainGraph
-> deepFreeze
```

The boundary validation is sound. Repeatedly sending up to a 4 MiB graph for a
small live change is not.

## Scale And Measurements

### Focused Correctness Baseline

Command:

```text
node --test tests\builder-product-metadata-database.test.cjs tests\builder-conversation-main-service.test.cjs tests\builder-task-stream-projection.test.cjs
```

Result: 124 of 124 tests passed in 4.505 seconds. The existing implementation is
functionally guarded. This audit is not evidence that its current hot-path cost
is acceptable.

One projection test covering 1,200 events took approximately 167 ms in that
run.

### Synthetic Projection Scaling

Seven warm runs; table reports median and observed maximum.

| Events | Median | Maximum |
| ---: | ---: | ---: |
| 100 | 15.50 ms | 17.14 ms |
| 400 | 61.18 ms | 100.32 ms |
| 800 | 99.14 ms | 138.45 ms |
| 1,200 | 136.39 ms | 206.07 ms |
| 2,000 | 229.61 ms | 264.86 ms |
| 3,200 | 282.18 ms | 467.45 ms |

This probe isolates `projectBuilderTaskStream`. It shows total-history scaling;
it is not an end-to-end renderer latency measurement.

### Synthetic SQLite Scaling

One checkpoint run per size against a real temporary SQLite database, appending
valid four-event batches:

| Events | Append total | Load total |
| ---: | ---: | ---: |
| 100 | 44.23 ms | 23.00 ms |
| 400 | 146.65 ms | 61.84 ms |
| 800 | 276.44 ms | 125.01 ms |
| 1,000 | 426.78 ms | 149.66 ms |

Append includes current pre-load/replay, combined replay, insert, and post-load/
replay behavior. These are scaling signals, not statistically sufficient p95
release results.

### Current Desktop Database

Anonymous counts from the current desktop database:

| Metric | Value |
| --- | ---: |
| conversations | 140 |
| Conversation events | 6,014 |
| serialized event-record characters | 12,596,186 |
| largest Conversation | 723 events |
| `programming_runtime_event_recorded` | 2,878 events, 47.9% |
| nested `assistant_text_delta` | 635 events |
| average serialized delta record | about 2,594 characters |

The largest Conversations contain hundreds of events and roughly 0.25 to 1.76
million serialized characters. This is already large enough for complete
replay and graph-copy cost to be user-visible.

For five current-source-compatible Conversations, one-pass staged timings were:

| Events | parse/sanitize/canonical | replay | task projection |
| ---: | ---: | ---: | ---: |
| 510 | 103.31 ms | 63.22 ms | 105.05 ms |
| 244 | 52.26 ms | 30.84 ms | 54.14 ms |
| 201 | 54.67 ms | 62.90 ms | 80.18 ms |
| 188 | 31.77 ms | 20.67 ms | 38.72 ms |
| 171 | 43.12 ms | 53.58 ms | 73.98 ms |

SQLite row selection itself was below 3 ms in these probes. JSON validation,
replay, and projection dominated. The normal product path can perform some of
these stages more than once and adds IPC and React cost.

### Historical Compatibility Finding

Three of the five largest stored Conversations contain older `run_completed`
records rejected by the current source sanitizer. Field-name inspection did
not establish corruption; a nested receipt or schema change is the likely
class of issue. The packaged application and current checkout may also be on
different revisions.

Required follow-up: add explicit format/schema version readers and migration
fixtures before changing storage. Never rewrite the only production database
in place during qualification.

## Current Limits And Contract Mismatch

- canonical Conversation storage currently caps one active log at 1,024 events
  and 24 MiB;
- the public task-stream window retains the latest 512 items;
- the renderer port accepts at most 4 MiB, 20,000 nodes, 20,000 entries, and
  depth 64;
- generation prompt selection already uses only the latest bounded subset.

Existing future acceptance text mentions a 10,000-event Conversation fixture.
That cannot mean one current-format active event array. The target must define
10,000 historical facts across segments, archives, or materialized checkpoints,
with a bounded active window and deterministic cold rebuild.

## What Is Sound

- Main owns mutation, SQLite, Git, runtime admission, and privileged effects.
- append events have sequence, previous head, digest, and compare-and-set
  semantics;
- renderer ports reject unsafe or oversized graphs;
- live output already has a dedicated renderer store and animation-frame batch;
- task projection is deterministic and has strong replay tests;
- Preview WebContentsView ownership is Main-side.

These are foundations to retain.

## What Must Change

- a 64-byte text delta must not synchronously execute the complete durable
  Conversation pipeline before it becomes visible;
- append validation must validate the committed head plus appended suffix, not
  revalidate and replay the whole prefix twice on every append;
- changed notifications need type, stream identity, cursor, and affected
  projection;
- task/activity views need incremental materialization and cursor reads;
- routine chat reads must not carry source trees, full drafts, diffs, logs, or
  Browser evidence;
- live Activity, durable Conversation, draft/review, project tree, and Side
  Workspace/Browser need independent renderer subscriptions;
- heavy validation, projection rebuild, Git, and file work must not monopolize
  the Main event loop;
- historical event schemas need explicit compatibility and migration policy.

## Audit Conclusion

Small throttles alone would hide symptoms and leave total-history work in the
hot path. The next implementation stage should be an event/projection
foundation migration with instrumentation, dual-read verification, and rollback
before universal-language and Browser features add more event volume.

