# Builder Context Compaction Alignment Stage - 2026-09-02

## Stage Goal

Make Builder's context usage and compaction facts explainable, run-scoped, and
testable before adding a larger manual compaction product surface.

The working order for this stage:

1. Inspect Builder's current Main-owned context usage projection.
2. Recheck DeepSeek Harness native compaction semantics and comparable agent
   product behavior.
3. Land one narrow Builder fix that turns the evidence into an enforceable
   boundary.

## Harness Baseline

Sources:

- `electron/builder-context-usage-projection.cjs`
- `electron/builder-harness-runtime-event-normalizer.cjs`
- DeepSeek Harness compaction subsystem:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md
- DeepSeek Harness compaction package:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction/README.md
- DeepSeek Harness developer preview:
  https://deepseek.com/harness/en/

Findings:

- Harness treats compaction as log bookkeeping, not as an unstructured UI hint.
  `compaction/start`, `compaction/summary`, and `compaction/end` bracket the
  operation in the session log.
- The only successful surface mutation is the replacement summary message. The
  `compaction/*` events stay log-only.
- The lock is bracketed so a crash or incomplete compaction remains detectable
  as an unmatched start instead of a false finished state.
- Tool-call/result pairing is a boundary condition for any compacted surface.
- Builder already normalizes Harness compaction into two runtime activities:
  `context_compacting` and `context_compacted`, and normalizes Harness
  `session.context-usage` into `context_usage_projected`.

## Product Comparison

Sources:

- OpenAI Codex app-server resume, token usage, and compaction:
  https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Claude Code context management:
  https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code
- Cursor checkpoints and CLI context controls:
  https://docs.cursor.com/en/agent/chat/checkpoints
  https://docs.cursor.com/en/cli/using
- Windsurf Cascade memories and rules:
  https://docs.windsurf.com/zh/windsurf/cascade/memories

Cross-product principles:

- Context state is a first-class operational fact. Products expose usage,
  compression, resume, or durable memory/rule controls rather than leaving the
  renderer to infer state from free text.
- Resume and compression are distinct operations. Resume restores or continues
  a session; compression summarizes pressure inside a session.
- Durable context belongs in explicit stores or project files. Ephemeral
  conversation pressure should be projected as status, not promoted into broad
  authority.
- Checkpoints protect code changes; context compaction protects model-visible
  history. The two are related user experiences but different authority paths.

## Builder Gap

Builder's `builder-context-usage-projection.v2` is already Main-owned and strict:

- it accepts only `deepseek_harness_session_projection`;
- it computes `usage_percent` and `cache_hit_percent` itself;
- it rejects forged percentages and legacy model-usage fallback;
- it exposes `measurement_state` for `ready`, `awaiting_usage`, and
  `awaiting_post_compaction_projection`.

The remaining gap was run ownership. A task conversation can contain multiple
runtime runs. Before this stage, the projection scanned all
`runtime_activity_status` compaction events in the conversation and could let a
later or unrelated run's `context_compacting` / `context_compacted` state alter
the latest context usage projection for a different run.

That is too broad for Harness-native semantics: compaction and context usage are
session/run facts and should not be merged solely because they share a Builder
conversation.

## Implemented Cut

Updated `electron/builder-context-usage-projection.cjs` so compaction lifecycle
state is tracked per `run_id`.

The projection now:

- records `context_usage_projected` with its runtime `run_id`;
- buckets `context_compacting` and `context_compacted` by their runtime `run_id`;
- computes `measurement_state`, `compaction_state`, `last_compacted_at_ms`, and
  `updated_at_ms` from only the compaction bucket matching the selected usage
  projection's `run_id`;
- continues to preserve existing post-compaction behavior for the same run.

No wire schema, renderer contract, or UI behavior changed.

## Verification

- `node --test tests\builder-context-usage-projection.test.cjs`

The focused regression proves:

- same-run post-compaction pressure drop still projects as before;
- compaction activity from another run no longer changes the selected usage
  projection;
- a latest usage projection from another run starts with an idle compaction
  state unless that same run has compaction evidence.

