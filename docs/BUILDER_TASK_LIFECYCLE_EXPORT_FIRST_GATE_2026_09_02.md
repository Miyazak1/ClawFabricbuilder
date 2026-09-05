Status: implemented as the first real Task lifecycle capability after the
Product Contract Gate.

# Task Lifecycle Export First Gate

## External Product Baseline

- DeepSeek Harness keeps the Session log as the source of truth and implements
  `/export` as a human command. The model sees nothing, the command has zero
  token effect, and the browser owns download destination behavior.
- DeepSeek Session Query separates exact read/query contracts from persistence
  backends. A public transcript is a projection over durable session data, not a
  renderer-owned copy of raw storage.
- Cursor exposes chat history management and exports conversations to Markdown.
  Cursor also treats checkpoints, delete, duplicate/fork, and export as
  different product actions.
- Claude Code exposes structured print output and explicit resume/continue
  controls. Machine-readable output is a deliberate CLI mode, not hidden behind
  a generic task lifecycle verb.
- OpenAI task sharing documents that sharing a task snapshot does not transfer
  chat history, local files, device access, connected app credentials, or
  workspace permissions.

References:

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session-query/session-log-export/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md
- https://docs.cursor.com/en/agent/chat/history
- https://docs.cursor.com/chat/overview
- https://docs.anthropic.com/en/docs/claude-code/cli-usage
- https://help.openai.com/en/articles/20001275

## Product Contract Decision

Builder now exposes `exportTaskTranscript` as the first real Task lifecycle
export capability.

The contract is deliberately narrow:

- Renderer supplies only `agent_id`, `project_id`, and `task_address_id`.
- Main reads the Task Address from `builder-session-task-address-store`.
- Main verifies agent/project/task identity before loading the conversation.
- Main loads the canonical SQLite conversation through the metadata authority.
- Main projects a bounded public task transcript in Markdown and JSONL.
- The output includes task title, goal, status, ids, public conversation
  messages, public run summaries, candidate summaries, and public review state.

The contract deliberately excludes:

- renderer-provided conversation ids;
- renderer-provided destination paths;
- source tree contents;
- git commit/tree authority;
- dependency readiness or installation authority;
- provider dispatch;
- delete and fork behavior;
- any compatibility alias such as `exportTask`.

## Implementation Notes

- `electron/builder-task-transcript-export.cjs` owns the pure export contract.
- `electron/builder-agent-project-tree-ipc-adapter.cjs` exposes the
  `clawfabric-builder:agent-project-tree:export-task-transcript` channel.
- `electron/builder-generation-ipc-runtime.cjs` resolves the Task Address and
  canonical conversation before invoking the export contract.
- `electron/preload.cjs` exposes only `agentProjectTree.exportTaskTranscript`.
- `src/features/builder/infrastructure/builderDesktopAgentProjectTreePort.ts`
  validates the three renderer-provided ids and forwards no path/source/git
  fields.
- `src/features/builder/presentation/BuilderAgentSidebar.tsx` mounts the
  explicit right-click action as "Export transcript".

## Non-Goals

- No `exportTask` compatibility method.
- No host-path file writer.
- No browser download manager.
- No project source export.
- No delete implementation.
- No fork implementation.
