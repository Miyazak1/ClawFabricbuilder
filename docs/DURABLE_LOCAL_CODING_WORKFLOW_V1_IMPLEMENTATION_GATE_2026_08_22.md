# Durable Local Coding Workflow V1 Implementation Gate

Date: 2026-08-22

Status: implemented and packaged/real-provider verified

## Decision

ClawFabric Builder now has the v1 durable local coding workflow needed before
parallel Agent work or community features become the main product focus.

The ordinary coding loop is:

```text
user request
-> admitted Harness run
-> bounded reads and edits
-> automatic project check
-> bounded model repair when the check fails
-> verified Git candidate
-> automatic Draft Checkpoint
-> CAS materialization into the selected project folder
-> one official post-check completion summary
-> continue, Ask, Undo, Review, or optionally mark a Version
```

`Save version` is not required between coding turns. A recoverable unsaved draft
is the normal working state; a Version remains an explicit milestone.

## Authority Model

| Concern | Authority | Meaning |
| --- | --- | --- |
| Source bytes and candidate lineage | Git objects and verified candidate receipts | Durable code facts before or after a formal Version. |
| Current product revision | SQLite Project Revision selection | The formal milestone selected by the product. A branch or worktree alone cannot change it. |
| Current editable project folder | Main-owned Git current projection plus CAS workspace materialization | The source visible to local tools and the user. External drift fails closed. |
| Unsaved recovery | SQLite Draft Checkpoint metadata bound to verified Git candidate evidence | Restart-safe recovery and Undo, not a formal Version or Review decision. |
| Conversation and run facts | Append-only SQLite Conversation events | Canonical messages, tool evidence, checks, materialization result, and terminal completion. |
| Transcript fallback | Redacted SQLite-derived JSONL archive | Read-only recovery when canonical replay fails; it grants no write, provider, Review, or Git authority. |
| Check status | Recorded Check Run facts | A passing check is evidence about a candidate, not permission to save or publish it. |
| Context compression | Main-owned compaction summary plus native Harness compaction events | Cross-run memory and active-run token-pressure handling. Neither bypasses provider-context disclosure. |

This split is deliberate. Git stores code truth, SQLite stores product meaning,
and the materialized workspace is a guarded current projection. Renderer state
is never authority for any of them.

## Implemented Durability

### Automatic materialization and recovery

- Successful mutating runs persist verified candidate evidence.
- The Automatic Draft Checkpoint Service records a restart-readable recovery
  point before the UI claims the draft is recoverable.
- The current projection gate updates the selected project folder with a CAS
  workspace expectation and records `current_materialization` in Conversation.
- An external workspace change blocks replacement and preserves the last
  recoverable candidate.
- Multiple Build turns can continue from the latest unsaved draft without a
  mandatory Version.
- Restart restores the current unsaved checkpoint, materialized source, history
  timeline, and Undo route.
- Undo re-resolves main-owned facts and refuses to overwrite an externally
  changed workspace.

### Conversation persistence

- SQLite Conversation replay is canonical.
- Project reopen retains the last verified projection while refreshing, so
  ordinary refresh does not blank the whole workspace.
- The JSONL transcript is a non-authoritative, read-only fallback for damaged
  canonical replay.
- Terminal `run_completed` facts persist the official final assistant summary
  after checks and materialization.

### Context compaction

Two different compaction scopes coexist:

1. DeepSeek Harness owns active-run token-pressure compaction. The packaged
   compaction canary proves start/end events, a private replacement summary, and
   successful continuation after replacement.
2. Builder records bounded cross-run summaries in SQLite. A summary that passes
   the compaction-summary contract can enter provider-context assembly as a
   `compaction_summary` candidate segment after restart.

Candidate eligibility is not egress authority. The disclosure gate still
decides whether assembled provider context may leave the device. Denied
disclosure sends no compaction-summary payload.

## Closure And Repair Correction

The real-provider gate previously exposed two related closure weaknesses.

First, a runtime final narration could duplicate the official post-check
completion. The renderer used to keep the earlier narration and hide the
official item, making the visible stream appear to stop on `Ran npm test`.
Deduplication now keeps the official `run_completed` item in its canonical
post-check position and hides only the earlier exact duplicate.

Second, the automatic repair prompt described the check failure but did not
restate the original user request. A model could therefore make a check pass
while drifting from the requested result. Repair now includes the original
end-user request, requires every original constraint to be preserved, and
forbids weakening, deleting, bypassing, or rewriting verification merely to
make it pass unless the user explicitly requested that change.

The UI now distinguishes these semantic nodes:

- `programming_runtime_assistant_message`: progress narration;
- `run_completed` with `data-builder-run-completion-message`: the one official
  terminal response.

This gives both users and packaged canaries one stable definition of completion.

## Acceptance Evidence

Automated regression:

- durable workflow service group: 137 passed;
- `BuilderPage.test.tsx`: 107 passed;
- packaged-canary and Harness repair contracts: 101 passed;
- TypeScript build and Windows package integrity: passed.

Packaged application:

- Harness UI canary v2 passed, including two unsaved Build turns, automatic
  failed-then-passed repair, real file/command facts, restart recovery, history,
  conflict-safe Undo, continuation, cancellation, workspace escape denial,
  stale-edit recovery, unsupported-tool recovery, and unchanged-work handling;
- Harness compaction canary v1 passed with one compaction replacement and
  continuation to `run_completed` while the private summary remained hidden;
- Plan-mode canary v4 passed with plan approval, execution, automatic check,
  official final summary after the last command, composer re-enable, and a
  grounded usage question against the current unsaved draft.

Real saved-profile DeepSeek:

- canary v2 passed twice consecutively after the repair correction;
- both runs observed an automatic check fail and then pass;
- package and check fixtures remained unchanged;
- Chinese narration preceded tools;
- one Chinese final summary appeared after the last command;
- the Chinese run/use answer was grounded in the current draft;
- the Ask follow-up created no new candidate;
- the candidate remained recoverable without `Save version`.

## V1 Non-Claims

This gate does not claim:

- automatic formal Version creation;
- public publishing or Work Capsule authority;
- arbitrary third-party plugin execution;
- full-shell anti-flicker coverage for every old-session migration state;
- deterministic generation of a structured run/use handoff card;
- packaged proof of cross-run compaction-summary disclosure admission;
- unlimited long-session scale;
- autonomous parallel Agent execution.

The cross-run summary path is contract- and service-tested, but its packaged
disclosure journey remains a separate hardening gate. The current run/use
handoff is available through a grounded Ask turn; deriving a stable command,
entrypoint, and preview handoff directly from Project Understanding is still a
product slice.

## Gate Result

Durable local coding workflow v1 is accepted as the current foundation. The
next stage should not reimplement automatic save, Git candidate history,
restart recovery, or compaction from scratch. It should harden the remaining
user handoff and reliability surfaces, then build task supervision and Agent
Workbench capabilities on these existing authorities.

