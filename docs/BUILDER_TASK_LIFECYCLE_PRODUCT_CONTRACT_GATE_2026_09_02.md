Status: implemented as the product-contract follow-up to the native Task
Lifecycle Boundary Gate.

# Task Lifecycle Product Contract Gate

## External Product Baseline

- DeepSeek Harness documents session state as the runtime continuity unit. Builder
  must therefore treat Harness resume as a runtime-session operation, not as a
  generic Task lifecycle verb.
- Claude Code exposes explicit resume/continue and session export commands.
  The product contract is command-specific rather than hidden behind a generic
  task lifecycle surface.
- Cursor separates conversation history, checkpoints, restore, and deletion.
  Checkpoint restore is not the same product action as task deletion or archive.
- OpenAI Codex task work is project/workspace bounded. Builder keeps project
  source authority in Main and does not infer lifecycle authority from renderer
  navigation state.

References:

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md
- https://docs.anthropic.com/en/docs/claude-code/cli-usage
- https://docs.cursor.com/en/agent/chat/checkpoints
- https://help.openai.com/en/articles/11390924

## Product Contract Decision

The visible Builder contract now distinguishes these lifecycle surfaces:

- `resumeInterruptedRun`: resumes a paused or interrupted Harness run for the
  currently selected Task Address after Main verifies current project selection,
  current project write approval, Task Address resolution, and recorded
  DeepSeek Harness runtime evidence.
- `renameTask`: renames a Main-owned Task Address.
- `archiveTask`: performs a Main-owned soft Task Address archive.
- `exportTaskTranscript`: exports a Main-owned, read-only public Task transcript
  after Task Address and canonical conversation verification.

The product contract intentionally does not expose:

- `resumeTask`
- `deleteTask`
- `forkTask`
- `exportTask`
- `delete_files`
- renderer-provided conversation, source tree, commit, or tree authority for
  task lifecycle actions

Delete and fork are real product capabilities only after they receive their own
Main-owned contracts, records, projections, IPC adapters, and packaged canaries.
Generic `exportTask` stays absent; task transcript export is exposed only
through the explicit `exportTaskTranscript` contract.

## Implementation Notes

- The code-generation IPC channel changed from
  `clawfabric-builder:code-generator:resume-task` to
  `clawfabric-builder:code-generator:resume-interrupted-run`.
- The preload bridge, desktop port, application controller, hook, app, page, and
  composer now expose `resumeInterruptedRun`.
- Main service internals expose `prepare_resume_interrupted_run` and
  `resume_interrupted_run`.
- The UI copy can still say "continue task" for users, but the code contract no
  longer names this action as generic Task resume.

## Non-Goals

- No legacy channel compatibility.
- No alias from `resumeTask` to `resumeInterruptedRun`.
- No project/task delete implementation.
- No fork implementation.
- No generic export implementation.
- No root conversation fallback for Task lifecycle operations.
