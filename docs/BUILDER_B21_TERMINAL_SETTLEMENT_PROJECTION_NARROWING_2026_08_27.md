# Builder B2.1 Terminal Settlement Projection Narrowing

Date: 2026-08-27

Status: first projection-narrowing implementation after B2.

## Objective

B2.1 continues the performance route from B1/B2 by removing duplicate durable
task-stream reads around terminal settlement. B2 stopped known-task terminal
settlement from refreshing the whole project tree. B2.1 narrows the next layer:
the conversation controller must not perform a foreground terminal refresh and
then also perform a previously queued durable-changed background refresh for the
same selected task.

## Mechanism

`BuilderConversationController` coalesces durable `taskStream.changed` events
with a short timer so bursts of SQLite-backed task-stream changes do not cause
one read per event. Terminal completion also performs a foreground
conversation refresh/load so the visible composer, live output, review state,
and save gating can settle against canonical Main projections.

When those two paths overlap, the queued background refresh is redundant. The
foreground refresh is already reading the same selected task stream and is the
authoritative visible settlement path.

B2.1 therefore makes foreground controller reads cancel any queued durable
changed refresh before issuing their read:

```text
durable changed -> coalesced background refresh queued
terminal result -> foreground conversation refresh starts
              -> queued background refresh is canceled
              -> one durable task-stream read remains
```

## Boundaries

- Live-only changed events remain ignored by the durable controller path.
- Durable changed events that arrive during an active read still set
  `pendingChanged` and run a follow-up refresh after the active read settles.
- Background coalescing still handles durable changed bursts when no foreground
  settlement is running.
- Browser/Preview status reads are not driven by terminal settlement in this
  slice.
- Side Workspace file tree/content reads remain explicit user-visible workspace
  operations, not terminal-settlement work.
- Save/review gating remains based on refreshed Main projections.

## Acceptance

B2.1 is accepted when:

1. a queued durable changed refresh is canceled by a foreground refresh;
2. changed-event bursts still coalesce to one background refresh;
3. changed events during an active read still cause one follow-up refresh;
4. known-task terminal settlement remains independent from project-tree refresh;
5. focused controller, app, source, and type checks pass.
