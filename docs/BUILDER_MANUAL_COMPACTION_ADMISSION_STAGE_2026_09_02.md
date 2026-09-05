# Builder Manual Compaction Admission Stage - 2026-09-02

## Stage Goal

Define the first Builder product boundary for manual context compaction without
starting a runtime compaction or adding UI.

This stage follows the working rule from the handoff:

1. Study DeepSeek Harness native behavior first.
2. Compare how other agent products expose context management.
3. Land one small Main-owned contract with focused tests.

## Harness Baseline

Sources:

- DeepSeek Harness compaction subsystem:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md
- DeepSeek Harness compaction package:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction/README.md
- Local normalizer:
  `electron/builder-harness-runtime-event-normalizer.cjs`
- Local compaction summary store and recorder:
  `electron/builder-context-compaction-summary.cjs`
  `electron/builder-context-compaction-summary-store.cjs`
  `electron/builder-context-compaction-recording-service.cjs`

Findings:

- Harness exposes compaction as an optional capability, not as part of the agent
  loop spine.
- Manual compaction is `compactNow(agent, signal, sourceCommandId?)`.
- Manual compaction is represented with `turn: null`, while automatic pressure
  compaction is bound to an active turn.
- `compaction/start`, `compaction/summary`, and `compaction/end` are log-only
  events. The successful visible surface change is one replacement summary
  message.
- Expected manual failures use a closed error taxonomy. A pre-start `busy`
  rejection does not create a log record; failures after start remain visible in
  the log through `compaction/end` with error evidence.
- Tool-call/result balance is a boundary condition for compacted ranges.

## Product Comparison

Sources:

- OpenAI Codex app-server:
  https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Claude Code context window:
  https://code.claude.com/docs/en/context-window
- Claude Code usage and limits:
  https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code
- Cursor CLI:
  https://docs.cursor.com/en/cli/using
- Cursor checkpoints:
  https://docs.cursor.com/en/agent/chat/checkpoints
- Windsurf Cascade memories and rules:
  https://docs.windsurf.com/zh/windsurf/cascade/memories

Cross-product principles:

- Context compaction is user-visible operational state, not free-form assistant
  prose.
- Manual compact and automatic pressure compact are separate triggers.
- Resume, compaction, durable memory, and code checkpoints are different
  authority paths.
- The user-facing control can be simple, but the underlying state must be
  replayable, attributable, and non-mutating until the real runtime operation is
  admitted.

## Builder Gap

Builder already has:

- Harness lifecycle normalization for `compaction/start` and `compaction/end`;
- `builder-context-usage-projection.v2` for token pressure and compaction state;
- `builder-context-compaction-summary.v1` for bounded summary records;
- `builder-context-compaction-recording-service.v1` for committed conversation
  checkpoint summaries.

The missing product boundary was before execution: Builder had no standalone
Main-owned receipt that says a manual compact request was admitted against the
current committed conversation projection, and that the receipt itself has no
authority to mutate Harness state, dispatch a model/provider call, write SQLite,
grant permissions, or create a revision.

## Implemented Cut

Added `electron/builder-context-compaction-admission.cjs`.

The new contract creates and sanitizes
`builder-context-compaction-admission-record.v1` records. Each record binds:

- `project_id`;
- `conversation_id`;
- `task_address_id`;
- `builder-conversation-compaction-projection.v1` id and digest;
- source event count, sequence, event id, and event digest;
- `trigger: manual`;
- `harness_operation: compactNow`;
- `harness_turn_binding: manual_turn_null`;
- `execution_boundary: admission_only_no_compaction_started`.

The record authority explicitly denies:

- renderer authority;
- IPC authority;
- model/provider dispatch;
- tool dispatch;
- source read/write;
- SQLite write;
- Harness session mutation;
- permission grant authority;
- revision authority;
- readiness authority.

This creates the handoff point that a future IPC button or background command
can consume before calling the real Harness manual compaction path.

## Verification

- `node --test tests\builder-context-compaction-admission.test.cjs`
- `node --test tests\builder-context-compaction-admission.test.cjs tests\builder-context-compaction-summary.test.cjs tests\builder-context-compaction-recording-service.test.cjs tests\builder-context-usage-projection.test.cjs`
- `npm exec tsc -b --pretty false`

The broader node test requires Windows Temp directory access for the existing
SQLite recording-service tests. The first read-only run failed only on Temp
directory creation; the same command passed with the required temp permission.

