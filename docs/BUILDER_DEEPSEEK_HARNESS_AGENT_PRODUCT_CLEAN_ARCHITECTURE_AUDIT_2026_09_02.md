# Builder DeepSeek Harness And Agent Product Clean Architecture Audit

Date: 2026-09-02

## Stage Goal

This stage audits Builder against DeepSeek Harness native behavior and current
agent product architecture patterns, then cuts any Builder path that lets a new
task target reuse project-root conversation history as if it were a task-scoped
conversation.

## Official Sources

- DeepSeek Harness product page: https://www.deepseek.com/harness/en/
- DeepSeek Harness architecture: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- DeepSeek Harness session subsystem: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md
- DeepSeek Harness compaction subsystem: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md
- OpenAI Codex enterprise/admin guide: https://help.openai.com/en/articles/11390924
- OpenAI ChatGPT Work and Codex guide: https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex
- Anthropic Claude Code CLI usage: https://docs.anthropic.com/en/docs/claude-code/cli-usage
- Cursor checkpoints: https://docs.cursor.com/en/agent/chat/checkpoints
- Cursor CLI output format: https://docs.cursor.com/en/cli/reference/output-format
- GitHub Copilot coding agent best practices: https://docs.github.com/en/copilot/using-github-copilot/using-copilot-coding-agent-to-work-on-tasks/best-practices-for-using-copilot-to-work-on-tasks
- Windsurf Memories and Rules: https://docs.windsurf.com/zh/windsurf/cascade/memories

## Cross Product Findings

1. Session and resume are first-class runtime concepts, not prompt fallback.
2. Task state, checkpoints, review branches, and terminal output are scoped to
   the work item rather than treated as global project history.
3. Compaction is context management and replay evidence; it is not authority to
   reinterpret old storage formats or migrate task identity implicitly.
4. Command, shell, network, and dependency authority stay product owned. Agent
   runtimes consume admitted facts and capabilities.
5. Durable instructions, memories, and rules are explicit context sources. They
   are not a replacement for runtime truth, session identity, or task identity.

## Local Builder Findings

- The DeepSeek sidecar already uses native session behavior: selected session
  ids, `ctx.agents.resume`, `server.handleRequest('session/prompt')`, and
  `ctx.compaction.compactNow`.
- Builder Main owns JSON-RPC transport containment, session/task address
  recording, target resolution, readiness, and execution admission.
- New task allocation already creates task-scoped conversation ids through
  `createBuilderConversationAddress(project_id, conversation_uuid)`.
- The conflicting path was admission: Task Address, existing target resolution,
  and generation target admission used the generic conversation sanitizer. That
  generic sanitizer accepts both project-root and task-scoped conversation
  addresses, which is correct for root session history but wrong for executable
  task targets.

## Implemented Cut

- Added `sanitizeBuilderTaskConversationAddress(project_id, conversation_id)`.
- Kept generic `sanitizeBuilderConversationAddress` for contexts that really
  admit project-root session history.
- Made `createBuilderSessionAddress` bind `root_conversation_id` to the same
  project.
- Made `createBuilderTaskAddress` require a same-project task-scoped
  `conversation_id`.
- Made `builder-session-task-target-service` fail closed when an existing Task
  Address points at project-root history.
- Made `builder-generation-main-service` admit task targets through the
  task-scoped sanitizer.

## Non Goals

- No root conversation compatibility for new task targets.
- No migration shim for old Task Address records.
- No renderer-owned task identity.
- No provider-owned dependency, command, or preview authority.
- No fork, archive, delete, or export implementation in this stage.

## Verification Scope

Focused verification for this stage must prove:

- Project-root session history remains explicit and same-project.
- Executable task conversations are task-scoped and same-project.
- Existing target resolution fails closed on project-root conversation history.
- Generation admission uses the task-scoped conversation sanitizer.
- The audit decision is recorded as a source-backed clean architecture gate.
