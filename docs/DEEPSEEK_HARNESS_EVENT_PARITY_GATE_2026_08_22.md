# DeepSeek Harness Event Parity Gate

Date: 2026-08-22

## Objective

Builder must consume the bundled DeepSeek Harness event model instead of
simulating a separate agent loop. The pinned runtime is
`deepseek-ai/deepseek-harness` commit
`47f943859bef60e4160492346772ded9b24f765a` (`0.1.0-rc.5`). Its append-only
Session event log remains the runtime source of truth. Builder may sanitize and
project those facts, but must not replace them with timers or invented progress.

Parity does not mean publishing raw chain-of-thought. Harness distinguishes
reasoning blocks from user-visible text. Builder preserves that distinction:
reasoning is accepted and validated, while the public surface receives only a
bounded Chinese lifecycle status.

## Implemented In This Gate

| Harness fact | Builder behavior | State |
| --- | --- | --- |
| `session.event` | Sequence-checked, append-only normalization | Implemented |
| `assistant/chunk: text-delta` | Durable batches at 64 UTF-8 bytes or sentence/paragraph boundary; renderer coalesces by animation frame | Implemented |
| Empty provider deltas | Empty reasoning, text, and tool-argument deltas are accepted as legal stream boundaries without manufacturing public text | Implemented |
| `block-start` / `block-end` | Block vocabulary and indexes are validated | Implemented |
| `reasoning-delta` | Raw text remains private; one `assistant_reasoning_status` produces `正在思考` | Implemented |
| `tool-call-delta` | Arguments stay private; public status reports that a tool call is being prepared | Implemented |
| `usage` and `assistant/message.usage` | One canonical `model_usage_recorded` fact with cache and reasoning token fields | Implemented |
| `finish` | Canonical `model_finish_recorded` fact plus a bounded finishing status | Implemented |
| `llm/retry` / `llm/retry-started` | Failed partial text is discarded and a replaceable Chinese retry status is shown | Implemented |
| `compaction/start` / `summary` / `end` | Lifecycle is visible; summary text remains private and enters the existing authorized context path | Implemented |
| `todo/write` | Whole-list schema is validated; only counts are exposed | Implemented |
| `session.status` | Running/idle becomes a bounded runtime activity status | Implemented |
| `subagent.started` / `finished` | Parent-bound notification is validated; child output remains private; lifecycle status is projected | Implemented |
| Concurrent safe tools | Harness may run four calls; only tools declaring `isConcurrencySafe()` can overlap | Implemented |
| Native Tool Presentation | Broker tools implement canonical output, `render`, `presentationMeta`, `presentCall`, and `presentResult`; Main projects bounded read/search/diff details | Implemented |
| Live renderer activity | `builder-generation-activity.v1` replaces one status in place and never appends it to assistant text | Implemented |

The runtime descriptor now declares `reasoning_status: bounded_status` and
`parallel_read_tools: true`.

## Deliberate Privacy Boundary

Builder must never render or persist raw reasoning text in the public
Conversation projection, IPC output, logs, errors, canary artifacts, or final
summary. The normalizer validates reasoning chunks so they still count as real
runtime progress and can rearm liveness supervision. It emits only fixed,
display-safe status text.

This is capability parity with the Harness reasoning stream, not a claim that
private chain-of-thought is a product transcript.

## Deployment Decisions Completed

### Thinking Policy

The owner explicitly authorized Harness-compatible reasoning transport on
2026-08-22. Both production and compaction Cordis profiles now use
`thinking: enabled` and `reasoningEffort: high`. A policy test locks both values.
Reasoning associated with tool calls may therefore be returned to DeepSeek on
the next tool round trip as required by the adapter. Raw reasoning is still not
written to Builder Conversation, renderer IPC, canary output, logs, or final
summaries.

The first real-provider run after enabling thinking exposed a valid empty
`text-delta`. Builder previously rejected all empty deltas. The normalizer now
accepts empty reasoning, text, and `argumentsDelta` fragments while emitting no
public text for them. This preserves the upstream streaming contract without
weakening Unicode, size, ordering, or privacy checks.

### Native Tool Presentation

Builder's read, grep, edit, and write broker tools now follow the pinned Harness
presentation contract. Full source text remains inside the Harness tool result
where the model needs it. Builder's public event protocol carries only bounded
metadata: read line windows, search locations/counts, and diff line counts.
Main remains authoritative for opening files, diff evidence, checks, and command
results. The renderer uses this metadata for compact expandable activity rows.

The packaged canary sanitizer is versioned with this public shape. A real run
initially completed successfully but was misreported as timed out because the
canary rejected the new `presentation_detail` key. The canary now validates all
three detail variants and accepts tasks projected temporarily through
`orphaned_tasks` while an unsaved project is being materialized.

## Remaining Parity Work

### 1. Native Jobs, Goals, And Executable Subagents

The current Agent Spine profile still sets `toolJobs: false` and `goals: false`,
and no subagent provider/tool is composed. Builder can now consume lifecycle
notifications, but the project runtime cannot create those facts itself.

Do not enable these flags alone. First bind each operation to Builder's project,
permission, budget, cancellation, review, and result-return contracts. Then add
a packaged canary proving parent/child cancellation and result attribution.

### 2. Harness Session Resume And Steering

Builder currently advertises `session_resume: none` and `steering: none` for the
programming runtime. Builder has its own durable Conversation and queued
follow-up authority, but it starts a dedicated Harness process/session per run.
True parity needs a resumable Harness session binding keyed by Builder Task
Address, plus an explicit rule for reconciling Harness JSONL with Builder SQLite.

## Acceptance Gates

The current slice is accepted only when all of the following pass:

- normalizer tests cover text, reasoning privacy, retry, compaction, todo,
  usage, finish, session status, subagent lifecycle, and concurrent reads;
- event journal and Conversation persistence accept the new typed facts;
- IPC rejects malformed activity text and private provider fields;
- renderer keeps one stable live node and one replaceable status line;
- no reasoning, todo content, child output, credentials, or absolute paths cross
  the public projection;
- packaged and real-provider canaries observe Chinese live activity, final
  summary, and completion without duplicate messages.

## Evidence From This Slice

- Runtime event, journal, task-stream, and persistence group: `64/64` passed.
- Focused normalizer group after empty-delta repair: `16/16` passed.
- Broker/workspace/native Tool Presentation group: `16/16` passed.
- Live output, desktop port, domain, and Builder page group: `195/195` passed.
- Programming runtime/check/repair/candidate closure group: `21/21` passed.
- Cordis policy and runtime composition group: `8/8` passed.
- Packaged canary contract group: `90/90` passed.
- Real-provider canary contract group: `13/13` passed.
- TypeScript and ESLint: passed.
- Windows distribution and package verification: passed; bundled Harness identity
  and production network-denied CSP verified.
- Deterministic real Harness process loop: initial edit, failed check, repair,
  passed check, and `run_completed`; `68` canonical events.
- Deterministic compaction loop: one compaction replacement, continued tool use,
  private summary hidden, and `run_completed`; `70` canonical events.
- Real saved-profile DeepSeek packaged loop: `2` turns, `6` assistant messages,
  `7/7` tool calls/results, failed check followed by passed check, one Chinese
  final summary after the last command, and a grounded Chinese project-usage
  answer without creating another candidate. Coding-loop duration: `29,691 ms`.

This gate establishes parity for the event and tool surface actually composed
by Builder. It does not claim that disabled Agent Spine Jobs/Goals, executable
subagents, native Harness session resume, or steering are already product
capabilities.
