# DeepSeek Harness Coding Loop Convergence V1 Gate

Date: 2026-08-23

Status: implemented and verified with the packaged application and a real saved
DeepSeek profile

## Objective

The coding loop must finish as a user-visible workflow rather than stop at a
tool row or a passing check. A run is complete only when Builder has projected
the Harness activity, resolved any repair or user-input branch, recorded a
terminal result, materialized the recoverable Project state, and returned the
composer to an interactive state with a concise Chinese handoff.

## Authority Boundary

- DeepSeek Harness owns model turns, reasoning transport, tool selection,
  retries, compaction lifecycle, and its append-only Session event log.
- Builder Main owns Project-scoped file access, automatic checks, candidate and
  checkpoint materialization, permission disclosure, durable Conversation
  facts, cancellation, revision authority, and the public task projection.
- The renderer displays sanitized Builder facts. It does not infer completion
  from elapsed time, expose raw reasoning, or manufacture progress text.

## Implemented Closure

| Scenario | Accepted behavior |
| --- | --- |
| Streaming progress | Harness text, reasoning lifecycle, tool preparation, retries, compaction, todo, subagent notifications, usage, and finish events are normalized; private reasoning becomes only bounded Chinese status text. |
| Plan | A Plan request produces reviewable Markdown, waits for approval when required, and can continue into the same bounded execution journey. |
| Edit and check | File operations remain Project-scoped. Builder runs the authoritative check and can ask Harness for a bounded repair without pretending that Harness has a shell in the production profile. |
| Human question | Native `ask_user_question` creates one durable `user_input_required` state. The next composer submission answers the pending Harness question and resumes the same run instead of creating unrelated work. |
| Permission and workspace block | Disclosure and write gates remain explicit Builder decisions and cannot be bypassed by provider output. |
| Failure, cancellation, idle timeout, and run limit | Every branch projects a typed terminal or attention state and releases the composer; no branch may remain as an unbounded visual spinner. |
| Restart and compaction | Durable Conversation facts replay after restart. A validated compaction summary may enter the authorized provider-context candidate path but never bypasses its disclosure gate. |
| Completion handoff | The final assistant summary appears once after the last command/check fact, in the user's language, and includes only observed verification plus a short run/use instruction when the files support one. |
| Project run/open | A recoverable draft or saved revision can be opened from the Project UI and run or stopped through the Builder-owned preview/runtime boundary. |

## Reported Stop And Root Cause

The packaged UI visibly reached all real product terminal facts:

1. `Edited index.html`
2. `Ran npm test`
3. a Chinese final summary
4. `Checkpoint saved`
5. `Project folder updated`

The application had therefore completed. The external packaged canary continued
waiting because its strict task-stream sanitizer did not yet recognize the new
`programming_runtime_status` item kind. The sanitizer rejected the whole stream,
the canary reduced that rejection to missing counts, and its outer timeout made
the successful run look stuck.

The verifier now:

- validates the exact public keys and value vocabularies for runtime status;
- enforces reasoning, activity, attention, cancellation, and failure
  cross-field invariants;
- digests status text instead of copying it into evidence;
- requires status items to belong to a matching active run and precede terminal
  completion;
- reports a stable `sanitize` probe phase when task-stream validation drifts;
- can locate the visible same-Project task while the Agent tree projection is
  temporarily behind the durable task address.

This fix changes verification only. It does not loosen the product event
contract or declare a run complete from DOM copy alone.

## Real DeepSeek Packaged Evidence

The saved-profile packaged canary completed in 21,163 ms and proved:

- the production DeepSeek profile was verified;
- Chinese narration appeared before tool actions;
- an automatic check failed, Harness repaired the source, and the next
  Builder-owned check passed;
- the final Chinese summary appeared exactly once after the last command fact;
- the candidate remained recoverable without forcing a formal Version save;
- a Chinese usage question was answered from the current draft without creating
  another candidate;
- package and check fixtures remained unchanged;
- the Harness Session contained 2 turns, 5 assistant messages, 5 tool calls, 5
  tool results, 2 files, and 19 retained events.

Credentials were copied only into an isolated guarded user-data directory for
the run. They were not placed in process arguments, environment output, logs,
or canary evidence. Endpoint and model identity are represented only by
digests, and cleanup is constrained to the verified canary directory prefix.

## Verification

- Packaged canary and real-provider verifier contracts: `105/105` passed.
- Native user-question broker, plugin, runtime composition, runner, and main
  service groups: passed.
- Runtime host, JSON-RPC, process, cancellation, restart, persistence,
  compaction, and task-stream groups: passed.
- Builder application, page, runtime contract, event normalizer, and TypeScript
  groups: passed.
- Windows distribution build and package integrity verification: passed.

Latest verified executable:
`release/win-unpacked/ClawFabric Builder.exe`.

## Gate Decision

DeepSeek Harness coding-loop convergence V1 is accepted. The reported terminal
screen is a successful product completion state; the former wait was a canary
contract drift and is now covered by strict regression tests.

This gate does not claim that production Bash, Jobs, or Goals are enabled.
Those should follow as separate slices: Builder-scoped Bash with permission and
evidence first, supervised parallel Jobs second, and durable user-visible Goals
after task/result attribution is stable.
