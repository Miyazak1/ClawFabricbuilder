# Builder B7 Lifecycle Refresh Coalescing

Date: 2026-08-27

Status: first lifecycle refresh coalescing slice after B6.

## Objective

B5/B6 made task-stream payloads measurable and bounded. B7 reduces avoidable
parallel lifecycle reads around save, catalog refresh, project/task lifecycle
actions, and Workbench materialization.

The goal is not to hide changes from the UI. It is to make refresh requests
drain through one App-owned queue so repeated lifecycle triggers cannot fan out
into duplicate catalog, project-tree, and Workbench reads at the same time.

## Implemented Change

`BuilderApp` now owns a lifecycle refresh drain:

- concurrent lifecycle refresh requests share one in-flight promise;
- requests that arrive while the drain is active are merged into the next loop;
- Workbench refresh is opt-in, so lightweight catalog refresh does not pull the
  Workbench projection;
- catalog and project-tree refreshes remain paired for project navigation and
  task list freshness.

## Boundaries

- B7 does not change task-stream read semantics.
- B7 does not change Browser/Preview WebContents behavior.
- B7 does not change dependency preparation or command execution.
- B7 keeps lifecycle reads separate from terminal settlement; known-task
  terminal settlement still refreshes conversation activity directly.

## Acceptance

B7 is accepted when:

1. lifecycle refresh calls use the App-owned drain instead of independent
   `Promise.all(...)` bursts;
2. `refreshCatalog` can refresh catalog/project tree without refreshing
   Workbench;
3. source tests guard the drain and its boundaries;
4. BuilderApp tests and type checks pass.
