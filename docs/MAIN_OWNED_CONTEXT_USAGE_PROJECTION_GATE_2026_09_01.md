# Main-owned Context Usage Projection Gate

Date: 2026-09-01

## Objective

The task composer context ring must represent real Harness token pressure. It
must not use the provider-context assembly byte budget as a substitute for the
model context window.

## Authority path

1. DeepSeek Harness owns the generic session-projection registry. Its token
   meter registers the native `tokenUsage` and `contextPressure` units.
2. Builder's Harness carrier reads one consistent projection snapshot and
   sends only its numeric whole values to Main.
3. Main records canonical `context_usage_projected` events and folds them into
   `builder-context-usage-projection.v2`.
4. The task stream exposes the bounded projection. Renderer validates it and
   only renders the result.

The context ring uses native `projected_tokens`, falling back to native
`pressure_tokens` before the projected value exists. Provider pressure is the
uncached input plus cache reads and cache writes for the latest request; output
is excluded. Durable session totals keep uncached input, output, cache reads,
and cache writes in separate buckets. Cache hit percentage is derived from
those cumulative input buckets and is shown explicitly.

## Compaction lifecycle

- `context_compacting`: the ring keeps the last measured pressure and shows an
  active compaction state.
- `context_compacted`: the projection becomes
  `awaiting_post_compaction_projection` and records `last_compacted_at_ms`.
- The next native projection replaces the old pressure, so the ring drops to
  the real post-compaction value while cumulative cache totals remain durable.

No synthetic post-compaction token count is permitted.

## Boundaries

- Projection authority remains in Main.
- Only project-bound `task_conversation` addresses receive this projection.
  `project_root` transcripts do not manufacture token usage.
- Restored public transcripts cannot project usage because they do not contain
  canonical Harness runtime evidence.
- Renderer cannot supply percentages, context windows, compaction facts, or
  timestamps.
- Provider secrets, raw prompts, source text, and compaction summaries are not
  exposed.

## Verification

- Main token arithmetic, compaction replacement, and fail-closed sanitization.
- Harness session-projection snapshots with a real context window and cache buckets.
- Canonical conversation replay into the task stream.
- Renderer snapshot rejection of forged and cross-conversation projections.
- Composer rendering for unavailable, compacting, refreshing, and reduced
  post-compaction usage.
- TypeScript build, package verification, and packaged desktop canaries.
