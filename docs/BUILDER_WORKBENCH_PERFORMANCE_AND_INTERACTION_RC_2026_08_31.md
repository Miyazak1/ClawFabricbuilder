# Workbench Performance And Interaction RC

## Goal And Boundaries

Reduce repeated Main work on saved history and keep the Agent conversation
usable while its run is active. Verification uses disposable copies of the
saved test profile and the configured DeepSeek provider. Original history is
not edited. Desktop input is scoped to the launched Builder process; no
global mouse/keyboard automation is used.

Browser Preview, broader Agent/plugin capabilities, model reasoning settings,
permission expansion, and dependency installation are outside this slice.

## Implementation

- Task stream notifications carry a Main-only conversation identity beside
  the unchanged public event. Monitor invalidation and result synchronization
  target that conversation or Task Address instead of every sibling task.
- The monitor reads canonical conversation items without also constructing
  chat-only context, checkpoint, check-run, and filesystem review details.
  The full Task conversation read retains those details and authority checks.
- Metadata integrity evidence is reused only on the same SQLite connection
  with identical schema SQL, user version, external data version, and local
  total changes. Rollback drops the cache. Invalid foreign-key evidence is
  never cached. Event digest validation, WAL, FULL synchronous writes, and
  foreign-key enforcement are unchanged.
- Releasing or cancelling an active request always invalidates controls and
  publishes a Workbench update, including when attention status is unchanged.
- Agent conversation execution uses a stable, projectless controller and its
  own live-output store. Project selection cannot dispose that controller or
  clear its current request. Returning retains Plan mode, accumulated live
  Markdown, and Stop; hidden completion refreshes the durable review state.
- Upward wheel/key intent pauses auto-follow before a stream frame or resize
  can pull the conversation down. A small upward scroll within the bottom
  threshold must not immediately re-enable auto-follow.
- Agent cancellation, interruption, and failure now retain their canonical
  `turn_completed` outcome in the public transcript. Main records a separate
  `builder.chat.turn_status.v1` notice, not a fabricated assistant reply.
  Notices are excluded from prompt/memory admission, stay in Conversation
  filtering, and deduplicate by run identity across restart. Backfilled
  notices follow canonical Agent sequence without rewriting store cursors.

## Controlled Saved-History Replay

`scripts/measure-builder-workbench-history.cjs` clones the workspace profile,
hydrates all 12 saved Task monitor records, then performs three rounds of same-title Task
updates through Main. All 36 updates must preserve canonical task identity,
state, and result projection. The script does not copy provider credentials
or invoke a provider. It mutates and removes only its guarded temporary copy.

| Metric | Baseline | Optimized |
| --- | ---: | ---: |
| Warm update maximum | 313.039 ms | 8.151 ms |
| Total time for 36 updates | 7,317.628 ms | 181.868 ms |
| Monitor stream reads, including hydration | 264 | 48 |
| Task synchronization median, including hydration | 238.864 ms | 3.299 ms |
| All Task states preserved | yes | yes |

Artifacts: `release/workbench-performance-baseline.json` and
`release/workbench-performance-integrity-cache.json`. Intermediate files
record scoped invalidation and schema-cache-only experiments. This benchmark
measures repeat history synchronization, not provider latency or every UI
operation. Cold conversation validation still reaches roughly 400 ms.

## Desktop RC

The existing real-provider canary additionally types while planning, scrolls
up, opens an old Task, returns to the running Agent, and clicks Stop. It then
verifies a complete revised plan, restart, digest-bound approval, actual New
project creation, automatic foreground coding, canonical successful checks,
two explicit Save version clicks, and exact project/task count changes.

Native maximize/restore remains a real button-click check. When Playwright's
cached Main handle is destroyed, the verifier reads the existing Main window
state API and outer dimensions of the frameless window. It checks actual size
growth and agreement with inner dimensions, rejecting locked viewport
emulation. Electron's unsupported `Browser.getWindowForTarget` is not used.

Failed attempts are retained under `release/workbench-performance-20260831`:

- Round 1: invalidated Playwright native-window handle, before provider work.
- Round 2: switching away disposed the active Agent controller; Stop was lost.
- Rounds 3 and 4: the first script fallback used an unsupported Electron CDP
  method. These are verifier failures, not successful product tests.
- Round 5: upward scroll did not survive concurrent streaming; the revision
  finished while the verifier waited. A deterministic unit test reproduced
  auto-follow overwriting the gesture before its scroll event.

Rounds 6, 7, and 8 passed consecutively with the same performance/interaction
build. Each cloned catalog started with 2 visible projects and 10 tasks and
ended with 3 projects and 12 tasks. Both new tasks passed their checks and
were explicitly saved through the UI.

| Round | Total | Plan characters | Input frame | Scroll frame | Task/Agent roundtrip | Stop to idle |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 | 81.654 s | 3,903 | 228.842 ms | 62.537 ms | 462.348 ms | 487.321 ms |
| 7 | 53.877 s | 3,330 | 134.646 ms | 120.853 ms | 348.500 ms | 387.639 ms |
| 8 | 63.516 s | 4,104 | 129.707 ms | 89.008 ms | 346.349 ms | 336.123 ms |

These are individual application-scoped Playwright samples, not latency
percentiles. Maximum Main event-loop delay across those runs was 404.750 ms;
the remaining cold replay cost is not hidden by the warm-update comparison.

The user noticed two revision prompts without an intervening answer during
this test. The first was deliberately cancelled, but the UI omitted that
outcome. The durable terminal notice was added after rounds 6-8. Round 9 is
the follow-up acceptance run on the rebuilt package, with explicit checks
for the notice immediately after the cancelled prompt and after restart.

Round 9 passed in 74.058 seconds: live full-plan rendering, preserved prior
plan after Stop, one visible durable cancellation notice, restart without
duplication, revised-plan approval, exactly one new project and two tasks,
both successful checks, and both UI Save clicks. Native maximize/restore
reported 1920x1040 and 1280x820. Input frame was 127.787 ms, scroll frame
88.796 ms, Task/Agent roundtrip 312.545 ms, and Stop-to-idle 327.349 ms.
Maximum Main event-loop delay in this follow-up was 458.490 ms, so cold
blocking remains measurable despite the repeat-update improvement.

Evidence: `release/workbench-performance-20260831/round-9/result.json`,
`cancelled-turn-desktop.png`, and `saved-desktop.png`. The stopped notice
appears directly under the cancelled request; the saved screenshot shows
Version 2 and no unsaved-draft controls.

Verification: 443 focused frontend tests passed. The Main/performance/
security/canary group passed 271 tests, with the subsequent backfill and
Workbench IPC group passing 13 tests (overlapping coverage, not additive).
TypeScript build and package authority checks passed. Focused lint for the
terminal-outcome Main, parser, and canary changes passed.
Eight changed Main modules and both built renderer assets were compared
byte-for-byte against the final ASAR and match the workspace sources.

## Remaining Risks

This slice does not eliminate cold replay cost or promise frame-perfect UI
latency under arbitrary histories. Full repository lint remains non-passing:
the existing BuilderApp ref/effect diagnostics also reproduce on committed
HEAD. No broad unrelated refactor is included to silence them.
The full repository test suite was not run. Browser readiness/content was
not an acceptance criterion here; the final screenshot's blank Browser tab
must not be taken as evidence of a working preview.
