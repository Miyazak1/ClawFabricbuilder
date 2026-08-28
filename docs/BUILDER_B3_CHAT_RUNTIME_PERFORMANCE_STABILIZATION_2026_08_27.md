# Builder B3 Chat Runtime Performance Stabilization

Date: 2026-08-27

Status: first stabilization gate after B1/B2/B2.1.

## Objective

B3 treats chat runtime performance as a product path, not a single refresh
bug. The target path is:

```text
send -> generate/run -> stream -> terminal facts -> draft/check/review state
-> composer/live output release
```

This phase keeps Browser Node, command sandbox provider work, and Workbench
plugin architecture out of scope. It focuses on reducing redundant reads and
making the remaining task-stream work measurable.

## Implemented Stabilization

B3 accepts two duplicate-read reductions as the first batch:

1. Foreground task-stream reads cancel queued durable-changed background
   refreshes. When terminal settlement is already reading the selected task
   stream, the 160ms coalesced durable refresh does not read it again.
2. Pending draft restore waits for an in-flight same-project/same-task
   conversation load before probing activity. If the selected conversation is
   already loading, restore discovery reschedules instead of opening a parallel
   `conversation.probe(...)` read.

Together these cover two high-frequency sources of perceived stutter:
terminal completion and automatic draft recovery.

## Measurement Contract

B3 requires renderer task-stream reads to remain visible in performance trace
without recording private content, paths, urls, or identifiers. The current
renderer trace surface includes:

- `renderer.task_stream.read.duration_ms`;
- `renderer.task_stream.read.result_bytes`;
- `renderer.task_stream.cursor.full_count`;
- `renderer.task_stream.cursor.incremental_count`;
- `renderer.task_stream.cursor.unchanged_count`;
- `renderer.task_stream.cursor.legacy_fallback_count`;
- `renderer.task_stream.changed.coalesced_count`;
- `renderer.task_stream.controller_publish_count`.

These metrics are enough to separate "provider is slow" from "renderer reread
or replayed too much" in a packaged canary trace.

## Boundaries

- Main and SQLite remain canonical for terminal, draft, check, save, and review
  facts.
- The renderer may cancel redundant local refresh work, but it must not invent
  terminal completion or review eligibility.
- Browser/Preview status reads are independent capability reads; ordinary chat
  terminal settlement must not start, reload, or reconfigure Browser/Preview.
- Side Workspace file tree/content reads remain explicit source/runtime file
  operations, not automatic terminal-settlement reads.
- Dependency preparation remains A1-owned: detect first, install only after the
  user approves `Prepare once`, and only in the isolated check workspace.

## Next Candidate

The next B3 slice should use trace evidence from a packaged run to pick one of:

- reduce full task-stream result bytes with narrower terminal/suffix reads;
- add a payload budget canary for large conversations;
- coalesce save/reject/undo lifecycle refreshes where catalog/project-tree/history
  reads currently happen in parallel after the visible conversation is already
  settled.

## Acceptance

B3 first gate is accepted when:

1. terminal foreground refresh cancels queued durable background refresh;
2. pending draft restore does not probe while the same selected conversation is
   already loading;
3. renderer task-stream read duration, result bytes, cursor behavior, and
   coalescing are traceable without private payload fields;
4. Browser/Preview and Side Workspace stay outside ordinary terminal-settlement
   work;
5. focused source, controller, app, and type checks pass.
