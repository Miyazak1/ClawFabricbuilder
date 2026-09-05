# Builder Task Lifecycle Native Boundary Gate

Date: 2026-09-02

## Stage Goal

Align Builder task lifecycle behavior with the Main-owned Session/Task Address
model. Lifecycle controls must be explicit product actions, not renderer-owned
state changes and not compatibility fallbacks from older conversation shapes.

## Decisions

- Task lookup by conversation is task-scoped only.
- Session root history remains a session concept, not an executable task target.
- Project archive remains a Main-owned soft lifecycle overlay.
- Task archive remains a Main-owned soft Task Address lifecycle update.
- Delete, fork, and export materialization are not implemented by Task Address
  storage in this stage.
- Workbench navigation may request bounded lifecycle controls, but it may not
  provide conversation ids, file deletion intent, source trees, Git receipts, or
  provider/runtime instructions.

## Implemented Boundary

- `builder-session-task-address-store` admits
  `read_current_session_task_for_conversation` through
  `sanitizeBuilderTaskConversationAddress`.
- `builder-session-task-address-store` reports task archive authority as
  `main_owned_task_address_soft_archive`.
- `builder-agent-project-tree-ipc-adapter` reports a
  `read_and_bounded_lifecycle_methods_only` request surface instead of claiming
  to be read-only.
- `builder-agent-project-tree-projection` revalidates store-provided task nodes
  with the Task Address contract before rendering the Agent tree.

## Negative Space

- No compatibility path from root conversation history to task conversation.
- No renderer-selected conversation lifecycle mutation.
- No filesystem delete.
- No Git mutation.
- No provider dispatch.
- No fork/archive/export expansion beyond the currently admitted soft lifecycle
  actions.

## Verification Scope

Focused tests must prove:

- current task lookup rejects project-root conversation ids;
- project tree lifecycle IPC accepts only agent/project/task identity fields;
- archive task cannot smuggle file deletion intent;
- project tree projection fails closed on malformed or root-history Task Address
  records;
- lifecycle evidence accurately names archive authority and absence of
  delete/fork/export authority.
