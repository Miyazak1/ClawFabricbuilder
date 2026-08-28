# Builder B2 Durable Terminal Settlement Decoupling

Date: 2026-08-27

Status: first implementation gate. This is a narrow performance slice after
B1 attribution, not a Browser Node, sandbox, dependency installation, or
Workbench architecture gate.

## Objective

B2 reduces the visible chat hot path after a command or plan run reaches a
terminal state. The canonical facts still live in Main and SQLite, but the
renderer should not fan out into unrelated durable reads before it can release
live output, composer state, and review controls.

The first accepted rule is:

```text
known task terminal settlement refreshes the conversation, not the whole project tree
```

## Change

`BuilderApp.readActivityAfterTerminal(...)` now derives the active task address
from the already loaded conversation first, then from the selected task state.
Only when both are missing does it refresh the agent project tree and search for
the first task address in the visible project.

This keeps the fallback for task materialization and workspace recovery, while
removing a common post-terminal fan-out:

```text
before: terminal -> project tree refresh -> conversation refresh/load
after:  terminal -> conversation refresh/load
        terminal -> project tree refresh only when task address is unknown
```

## Why This Slice

The previous path already had a bounded timeout around post-terminal refreshes,
which prevented permanent hangs but still made successful runs pay for an
unrelated project-tree read. That cost is most visible when the project tree is
large, the task-stream projection is cold, or storage is busy after reconcile.

B2 starts with this low-risk cut because it does not change event authority,
SQLite ownership, task-stream schema, Save gating, or review eligibility. It
only avoids a read that is unnecessary when the current conversation is already
bound to a task address.

## Boundaries

- Main and SQLite remain canonical for terminal facts and review state.
- Save/review gating continues to depend on refreshed Main projections, not
  optimistic renderer state.
- Unknown-task fallback still refreshes the project tree before choosing a task.
- Agent-only conversations still refresh workbench activity.
- Browser/Preview is not part of this sandbox or settlement path.
- Dependency preparation and install approval are not part of this performance
  slice.
- Workbench Node/App/Plugin architecture remains future work.

## Acceptance

B2 first gate is accepted when:

1. known-task terminal settlement does not call `agentProjectTree.refresh()`;
2. terminal completion still refreshes or loads the active conversation;
3. composer and live output release after terminal completion;
4. the unknown-task fallback still has a project-tree route;
5. focused unit and source tests pass.
