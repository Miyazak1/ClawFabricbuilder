# Builder A0 Packaged Performance Baseline

Date: 2026-08-25

Status: first packaged, privacy-checked A0.1 baseline and A0.2a qualification.
This report is evidence for the next implementation slice, not acceptance of
the complete A0 gate.

A0.3 after-values and acceptance are recorded in
[Builder A0.3 Incremental Replay And Projection Gate](BUILDER_A03_INCREMENTAL_REPLAY_AND_PROJECTION_GATE_2026_08_25.md).

## Artifact And Method

The measured artifact was the unpacked Windows desktop at
`release-a0/win-unpacked/ClawFabric Builder.exe`. The deterministic packaged
Harness UI canary exercised 26 provider requests across initial generation,
automatic repair, continuation, restart recovery, checkpoint Undo, an external
conflict, adversarial tool boundaries, no-change work, cancellation, Save, and
an open Side Workspace.

The trace is opt-in and numeric-only. Its privacy assertions verified that no
content fields, project or request identifiers, paths, or URLs were recorded.
The run covered `PB-01`, `PB-02`, `PB-04`, `PB-05`, `PB-07`, and `PB-10`.
`PB-03` (controlled 60-second stream), `PB-06` (10 MB output burst), `PB-08`
(Agent Test Browser), and `PB-09` (sidebar resize during stream) remain open.

This is one deterministic qualification run per phase. It establishes the
first product baseline and reveals the dominant path, but the performance-plan
requirement for five warm repetitions still applies before a budget is accepted.

## Results

| Metric | Initial build and continuation | Restart, recovery, multi-tool, preview, cancel, save |
| --- | ---: | ---: |
| Conversation append p95 | 175.520 ms | 266.449 ms |
| Conversation load p95 | 55.432 ms | 91.366 ms |
| Task-stream projection p95 | 38.491 ms | 58.492 ms |
| Main task-stream IPC p95 | 139.410 ms | 217.817 ms |
| Renderer task-stream read p95 | 3,105.2 ms | 6,108.0 ms |
| Renderer clone/freeze p95 | 6.2 ms | 10.2 ms |
| Main event-loop delay p95 | 328.991 ms | 212.206 ms |
| Main event-loop delay max | 4,462.739 ms | 8,287.945 ms |
| Side Workspace mounts | 1 | 1 |
| Live-only notifications ignored by durable reader | 12 of 12 | 13 of 13 |

The second phase loaded a median of 256 events and about 615 KB per complete
Conversation load. Across that phase, 1,044 loads processed roughly 645 MB of
repeated payload. Task-stream reads returned about 61 KB median and reached
99 KB, but renderer end-to-end reads reached a 6.1 second p95. Clone/freeze was
only 10.2 ms p95, so serialization at the renderer boundary is not the primary
cause. Repeated Main load, replay, projection, IPC contention, and event-loop
blocking are the dominant combined path.

## A0.2a Result

Typed `live_only` changes are working as intended. Every observed live-only
notification was ignored by the durable renderer controller, while text still
arrived through the narrow live-output store. Repository tests additionally
prove that 100 consecutive live-only hints cause zero complete task-stream
reads. Terminal completion, cancellation, recovery, replay, Save, and Undo all
passed in the packaged run.

This removes full-history work from the text-delta path. It does not solve the
remaining durable amplification: the run still produced 143 and 180 durable
append notifications, and each durable refresh can revisit the complete
Conversation history.

## Product Regressions Closed During Qualification

- accepted cancellation now records a canonical terminal outcome immediately,
  so Save cannot race a still-active turn;
- the Save decision card appears only after the current active/waiting stage
  has settled and disappears while Save is in progress or after Save succeeds;
- completed file and command rows retain the message content column when the
  Side Workspace is open; the packaged canary checks their actual width;
- the Side Workspace remained mounted once throughout both measured phases.

## Decision And Next Slice

This slice was implemented and measured by A0.3. The next architecture target
is visible-window cursor delivery and renderer subscription isolation before
broader Browser or universal Process/Terminal expansion:

1. add unchanged/cursor task-stream responses;
2. deliver only changed public items and status projections;
3. normalize activity in a narrow renderer store;
4. isolate Side Workspace and Browser subscriptions from Conversation commits;
5. add strict `PB-03` and `PB-06` qualification.

Rollback must preserve the current full replay reader. A copied historical
database must produce the same terminal, review, checkpoint, and version facts
before the incremental path can become authoritative.
