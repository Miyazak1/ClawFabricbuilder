# Builder H Phase Desktop RC Evidence

Date: 2026-08-28

Status: accepted for the current packaged desktop scope.

## Objective

H phase closes the immediate usability gap between source-level tests and a
desktop application that can actually continue saved work. The qualification
covers the path from Agent planning and existing history through project work,
streaming tool activity, draft recovery, checks, Preview, cancellation, and an
explicit Version save.

This evidence does not qualify a general User Web browser, arbitrary external
Agent browsing, a universal process sandbox, or every project toolchain.

## Main And Workbench Performance

Workbench task projection is now hydrated by addressed Task instead of replaying
all Tasks in a project during a foreground read. Normal Workbench reads use the
projection cache and schedule cold history hydration outside the selected read.

The saved-profile DeepSeek matrix used 52 projects, 11 tasks, and 45 Agent
history entries. It completed two real coding turns and proved Agent proposal
visibility, automatic Task start after materialization, old Task continuation,
existing-project approval reuse, Markdown streaming, real read/edit activity,
and durable terminal settlement.

Observed saved-profile results:

- total matrix duration: 48.407 seconds;
- history load: 123 ms;
- Workbench read p95: 11.351 ms, maximum 13.685 ms;
- addressed Task synchronization p95: 202.873 ms, maximum 369.392 ms;
- Main event-loop maximum: 527.696 ms;
- Task Stream projection p95: 0.730 ms, maximum 3.308 ms.

The remaining 527.696 ms event-loop maximum is a residual optimization target,
not a seconds-long foreground stall. No Workbench read or task hydration in the
accepted matrix blocked Main for a full second.

## Browser And Preview

`verify:packaged-live-preview` passed against the packaged executable. The
canary created and saved a local canvas project, prepared a second unsaved
draft, and attached the real Electron WebContentsView.

The accepted evidence includes:

- current unsaved draft required before Preview start;
- JavaScript, Canvas, and WebGL executed with nonblank pixels;
- Preview followed right-sidebar resizing and expanded/restored layout;
- reload preserved the admitted loopback origin and did not leak WebContents;
- external fetch, navigation, and window creation were blocked;
- renderer-visible blocked request evidence remained bounded;
- Stop disposed the Preview WebContents;
- application restart left no Preview WebContents behind.

Browser/Preview did not receive command, dependency-install, project-write,
provider, Git, or SQLite authority.

## Restart And Recovery

`verify:packaged-harness-ui` passed the deterministic packaged recovery matrix
with 29 runtime provider requests. It proved:

- a failed automatic check is recorded, repaired, rerun, and passed;
- real file/search/check activity and model narration remain visible in chat;
- consecutive build turns work before Version save;
- current draft files are materialized to the selected project folder;
- restart restores the unsaved checkpoint and History recovery controls;
- checkpoint Undo blocks an external source conflict and preserves that edit;
- a valid Undo restores the previous checkpoint and can continue afterward;
- workspace escape, stale edit, and unsupported tool attempts fail closed and
  recover without source leakage;
- a search/read-only turn settles as a normal reply without making a candidate;
- cancellation records terminal facts, blocks late provider output, and
  preserves checkpoint source;
- the latest output remains above the Version decision card;
- Save dismisses the unsaved decision and exposes the saved milestone.

The final renderer qualification observed Task Stream read p95 of 95.8 ms,
clone/freeze p95 of 1.6 ms, and result payload p95 of 9,191 bytes. The largest
restart full-history result was 48,264 bytes and remained below the 64 KiB
restart budget.

## Canary Corrections

Two canary defects were found by direct desktop use and corrected without
weakening product contracts:

1. Live Preview fixture selection depended on provider request order. It now
   selects baseline or update source from the admitted user instruction, so
   classification and retry traffic cannot turn an update into a no-op.
2. Harness UI cancellation held a provider response after a fixed request
   count. The failed-check convergence pass added three requests, so the hold
   boundary and sequence assertions were moved together. Search/read-only work
   must complete before the intentional cancellation hold begins.

No product timeout, no-op rejection, search result, or cancellation guarantee
was relaxed to make these canaries pass.

## Verification

- `npm exec tsc -b --pretty false`
- 71 focused Main, Workbench, performance, failure, Agent-history, and Browser
  canary tests
- `npm run verify:packaged-live-preview`
- `npm run verify:packaged-harness-ui`
- saved-profile DeepSeek Agent-history end-to-end matrix with user-authorized
  test projects and conversation history
- `npm run verify:package`

Package verification reported production CSP `network_denied`, bundled Harness
identity verified, and 1,013 ASAR entries. Current artifacts:

- `release/win-unpacked/ClawFabric Builder.exe`
- `release/ClawFabric Builder Setup 0.1.0.exe`

## Residual Scope

- General User Web and external Agent Browser remain later Browser-loop work.
- Universal command/process sandbox enforcement remains separate from Electron
  WebContents sandboxing.
- The saved-profile event-loop maximum and Git/materialization latency remain
  optimization targets, although neither reproduced the original seconds-long
  Workbench foreground block.
- Full repository `verify:release` is not claimed by this focused RC evidence;
  this gate records the directly relevant focused tests, packaged journeys, and
  package integrity verification.
