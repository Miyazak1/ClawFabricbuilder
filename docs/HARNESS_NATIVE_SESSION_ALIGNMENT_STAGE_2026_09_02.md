# Harness Native Session Alignment Stage - 2026-09-02

## Stage Goal

Align Builder task continuation with native DeepSeek Harness session semantics
before adding more product behavior. The working order for this stage is:

1. Study the Harness-native session, resume, checkpoint, compaction, and tool
   history behavior.
2. Compare the same user-facing recovery concepts in other agent products.
3. Ship only one narrow, testable Builder change that follows the evidence.

## Harness Baseline

Sources:

- `electron/harness/builder-session-resume-server.mjs`
- `electron/builder-harness-runtime-composition.cjs`
- DeepSeek Harness compaction docs:
  https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md
- DeepSeek Harness developer preview:
  https://deepseek.com/harness/en/

Findings:

- Harness treats capabilities as plugins. Sessions, tools, compaction, storage,
  and UI surfaces are composable capabilities, not hidden one-off branches.
- Everything the model sees is represented in an append-only session log. Resume,
  fork, search, and replay operate on the same event stream.
- Compaction is a log-recorded transaction. `compaction/start`,
  `compaction/summary`, and `compaction/end` are durable bookkeeping events; the
  visible surface changes through a replacement user message.
- Compaction boundaries must preserve tool-call/result pairing. This matters for
  any Builder projection that claims retained history is still usable.
- Builder already maps retained task continuation through
  `session/resume` and `agent.followup()` instead of silently starting a fresh
  Harness session.

## Product Comparison

Sources:

- OpenAI Codex app-server thread resume and compaction:
  https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Claude Code session and context behavior:
  https://code.claude.com/docs/en/how-claude-code-works
- Cursor checkpoint and CLI resume docs:
  https://docs.cursor.com/en/agent/chat/checkpoints
  https://docs.cursor.com/en/cli/using
- Windsurf Cascade memories and rules:
  https://docs.windsurf.com/zh/windsurf/cascade/memories

Cross-product principles:

- Resume is a first-class session operation, not just another prompt.
- Fork/side conversations are distinct from resume because they intentionally
  copy or branch history.
- Context pressure is user-visible enough to guide behavior. Codex exposes token
  usage events; Claude exposes context and compaction commands; Harness projects
  native token/context snapshots.
- Checkpoints are for reversible agent changes, while version control remains the
  durable project history boundary.
- Persistent rules belong in project files or explicit rule stores, not in
  fragile long conversation history.

## Builder Gap Matrix

| Area | Current Builder State | Risk | Stage Action |
| --- | --- | --- | --- |
| Native session resume | `prepareContinuation()` returns a native continuation projection and `generate()` passes `resume_session_run_id` into the run contract. | Main previously accepted only the session id and did not independently validate the projection shape or source digest before continuing. | Validate the complete projection before admitting continuation. |
| Workspace source freshness | Runtime composition checks the current source digest before returning a continuation projection. | A future composition or adapter regression could return mismatched continuation evidence and still be accepted by Main. | Main now rejects mismatched projection evidence before `begin_work`. |
| Fresh vs resumed run | Ordinary existing-project builds are intentionally fresh unless the request is a continuation. | Broad resume could accidentally leak old session context into unrelated edits. | Existing tests continue to assert ordinary builds do not call `prepareContinuation()`. |
| Compaction visibility | Native context usage projection is present; compaction canary covers packaged behavior. | Builder has no standalone manual compact product surface yet. | Defer UI/product expansion until continuation contract is locked. |

## Implemented Cut

Added `verifyNativeSessionContinuationProjection()` in
`electron/builder-generation-main-service.cjs`.

The Main service now requires a prepared continuation to prove:

- projection version is `builder-session-continuation-projection.v1`;
- status is `native_resumed`;
- reason is `previous_harness_session_available`;
- `session_run_id` matches the conversation-selected session;
- `source_tree_digest` matches the current Builder source tree;
- source freshness is `unchanged`;
- `observed_working_set` is present as an array.

If any proof is missing or inconsistent, Builder fails closed with
`builder_generation_source_context_unavailable` and does not start a fresh
Harness run.

## Verification

- `node --test tests\builder-generation-main-service.test.cjs`
- `node --test tests\builder-harness-runtime-composition.test.cjs tests\builder-harness-session-resume-server.test.cjs`
- `npm exec tsc -b --pretty false`
- `git diff --check -- electron\builder-generation-main-service.cjs tests\builder-generation-main-service.test.cjs`

The first non-escalated test attempts failed only because the read-only sandbox
could not create Windows temp directories. The same tests passed when rerun with
the required temp-directory permission.
