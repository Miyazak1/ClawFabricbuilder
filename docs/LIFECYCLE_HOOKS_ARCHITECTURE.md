# Lifecycle Hooks Architecture

This document defines Builder's lifecycle hook architecture. It turns important
agent events into auditable product facts without immediately exposing arbitrary
user scripts or plugin code to ordinary users.

## Product Decision

Builder should have hooks, but not as a first-release user feature.

The near-term product needs deterministic lifecycle points for automatic
checkpointing, context compaction, permission audit, handoff intake, release
verification, and provider/source safety gates. Those are internal product
hooks owned by main process authority. They should be reliable, testable, and
visible as status or audit evidence where useful.

User-configured command hooks, plugin hooks, prompt hooks, and agent hooks are
future developer features. They must not arrive before Builder has a hook trust
store, a hook run ledger, timeouts, source-scoped configuration, and a Desktop
inspection surface.

## Competitive Reference

### Codex

Codex has first-class lifecycle hooks. Official docs describe hooks as scripts
that run during the Codex lifecycle, with events such as `SessionStart`,
`UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`,
`PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Stop`, and
`SessionEnd`.

Codex discovers hooks from `hooks.json` or inline `[hooks]` tables next to
active config layers, commonly user-level `~/.codex/*` and project-level
`<repo>/.codex/*`. Project hooks require project trust. Non-managed command
hooks require review and trust against the exact hook hash. Managed hooks can be
trusted by policy and can be made the only active hook source through
`allow_managed_hooks_only`.

Codex hook output can add model-visible context for events such as
`SessionStart`, `UserPromptSubmit`, `PostToolUse`, and compaction hooks.
Large additional context is capped and spilled to disk. `PreToolUse` can block
or rewrite input, `PermissionRequest` can allow or deny, and `Stop` can continue
the agent with a follow-up prompt.

Sources:

- https://learn.chatgpt.com/docs/hooks
- https://learn.chatgpt.com/docs/config-file/config-advanced
- https://learn.chatgpt.com/docs/config-file/config-reference
- https://github.com/openai/codex/blob/main/docs/config.md

### Claude Code

Claude Code exposes a rich hooks system with JSON settings. Hook definitions
are layered by source: user, project, project-local, managed policy, plugin, and
component-local definitions. Events include session, prompt, tool, permission,
compaction, subagent, task, and notification lifecycle points.

Claude Code supports multiple handler types: command, HTTP, MCP tool, prompt,
and agent hooks. The `/hooks` menu is a read-only browser that shows hook
events, matchers, handler type, source, and command details. It is a useful
model for an eventual Builder Desktop inspection surface.

Source:

- https://code.claude.com/docs/en/hooks

### OpenCode

OpenCode V2 treats hooks primarily as plugin runtime hooks rather than JSON
configuration. Plugins can intercept model requests and tool execution through
APIs such as `ctx.session.hook("request")`,
`ctx.tool.hook("execute.before")`, and `ctx.tool.hook("execute.after")`.
Runtime hooks can mutate model request fields, tool input, and tool result
objects. Hook failure fails the intercepted operation.

This is powerful for developers, but it implies in-process extension execution
and a larger safety surface than Builder should expose in V1.

Source:

- https://opencode.ai/v2/docs/build/plugins

### Pi

Pi uses TypeScript extensions. Extensions can subscribe to lifecycle events,
register tools, add commands, customize compaction, intercept tool calls, and
modify tool results. Events include `session_start`, `turn_start`, `context`,
provider request/response events, `tool_call`, `tool_result`,
`tool_execution_*`, `agent_end`, and `session_shutdown`.

Pi explicitly warns that extensions run with full system permissions and should
only be installed from trusted sources. This reinforces that Builder should not
ship arbitrary user code hooks before it has a trust and review model.

Source:

- https://pi.dev/docs/latest/extensions

### DotCraft

DotCraft presents lifecycle hooks as scripts at important moments in a session,
prompt, or tool call. Its Desktop model is especially relevant: hooks are shown
by source, can be inspected, enabled or disabled, and newly discovered or
changed hooks require trust. Configuration files remain the source of truth,
while Desktop owns the user's enablement and trust state.

Source:

- https://www.dotcraft.net/features/agent-system/hooks

## Lessons For Builder

Builder should copy the architecture lessons, not the full feature surface:

- Hooks must be lifecycle events, not hidden side effects scattered through UI
  handlers.
- Each hook event must have a stable input schema and a stable authority claim.
- Hook runs must be recorded as facts, especially when they block, rewrite,
  inject context, or influence a permission decision.
- User or workspace command hooks require explicit trust by exact content hash.
- Plugin and in-process hooks are more dangerous than command hooks and should
  come later.
- Context injection is useful but dangerous; it must be bounded, redacted, and
  run-bound.
- Compaction hooks are important because they let a project restore context
  after automatic summarization.
- Desktop should eventually inspect hooks, but ordinary users should not need a
  hook menu for the basic Builder workflow.

## Architecture

Builder's hook system should be main-owned.

```text
Lifecycle event source
-> Hook Event Assembler
-> Hook Registry
-> Hook Trust and Policy Gate
-> Hook Dispatcher
-> Hook Decision Reducer
-> Product service continuation
-> Hook Run Ledger
-> Renderer-safe status projection
```

### Hook Event Assembler

Creates immutable event inputs from existing product facts. It must not accept
renderer-created event bodies.

Minimum input fields:

```text
hook_event_version
event_name
event_id
project_id
conversation_id
task_id
turn_id
run_id
created_at_ms
permission_mode
source_ref
redaction_policy
payload
```

`source_ref` points to the facts used to assemble the event. It should identify
conversation head, run snapshot, draft checkpoint, revision receipt, permission
request, context assembly, or package canary evidence as appropriate.

### Hook Registry

V1 registry contains only internal product handlers compiled into Builder.

Future registry sources:

| Source | Scope | V1 | Future |
| --- | --- | --- | --- |
| Built-in product hooks | App | Yes | Yes |
| Managed policy hooks | Organization | No | Yes |
| User hooks | Machine | No | Yes |
| Workspace hooks | Project | No | Yes |
| Plugin hooks | Plugin | No | Later |
| Session hooks | Current task | No | Later |

### Hook Trust And Policy Gate

The gate decides whether a handler may run for an event.

V1 internal handlers are trusted by build-time authority. Future non-managed
handlers need:

- exact content digest trust;
- source location trust;
- project trust for workspace hooks;
- timeout;
- command allowlist or execution sandbox;
- environment variable policy;
- no secret echoing;
- maximum output size;
- event capability declarations;
- per-handler enablement state.

Trust must be invalidated when the hook body, command, args, matcher, timeout,
or source changes.

### Hook Dispatcher

Dispatch should be deterministic.

V1 should execute internal handlers synchronously for blocking events and
asynchronously only for pure observability events. Future command hooks may run
concurrently within one event, but Builder must reduce their results through a
documented precedence order.

Recommended reducer order:

1. malformed output -> hook failure fact;
2. explicit `deny` or `block` -> block the operation;
3. explicit `continue: false` -> stop or pause the lifecycle step;
4. approved rewrite -> use rewritten input only for events that allow rewrite;
5. additional context -> append only through bounded Context Assembly;
6. advisory output -> record and continue.

### Hook Run Ledger

Every hook run should create a durable fact:

```text
HookRun
  hook_run_id
  event_id
  handler_id
  source_kind
  trust_digest
  started_at_ms
  completed_at_ms
  status
  timeout_ms
  decision
  redacted_input_digest
  redacted_output_digest
  source_ref
  authority
```

The ledger is product evidence. It should not store raw secrets, provider
payloads, or full source trees.

### Renderer Projection

The renderer should receive status, not authority.

V1 examples:

```text
Checkpoint hook completed
Context compaction prepared
Permission policy check blocked this action
Release hook failed
```

Future Desktop hook management should show:

- hook source;
- event;
- matcher;
- handler type;
- trust status;
- enabled status;
- last run status;
- last failure reason;
- exact command or plugin identity after sanitization.

It should not show provider prompt bodies, full source context, secrets, or
unredacted hook stdin/stdout by default.

## Event Catalog

### V1 Internal Product Events

These events are worth implementing before user-configured hooks:

| Event | Blocking | Product use |
| --- | --- | --- |
| `user_instruction_admitted` | No | route evidence, context update |
| `before_context_assembly` | Yes | stale handoff, stale brief, redaction |
| `after_context_assembly` | No | run snapshot evidence |
| `before_auto_compaction` | Yes | checkpoint before losing raw context |
| `after_auto_compaction` | No | re-inject compacted continuity |
| `handoff_received` | Yes | conflict policy before using imported facts |
| `permission_request_created` | No | audit and UI projection |
| `permission_decision_recorded` | No | audit and next-action routing |
| `before_source_read` | Yes | scoped read guard |
| `before_source_write_admission` | Yes | protected path and checkpoint guard |
| `after_draft_checkpoint_recorded` | No | restore surface, auto checkpoint status |
| `before_save_version` | Yes | require review and verification facts |
| `after_revision_recorded` | No | history, Work Capsule seed |
| `before_provider_dispatch` | Yes | egress consent and redaction |
| `after_provider_response` | No | usage, failure, context accounting |
| `before_release_verify` | Yes | package gate |
| `after_packaged_canary` | No | release evidence |

### V2 Developer Events

These are reasonable after V1 is mature:

| Event | Capability |
| --- | --- |
| `SessionStart` | add bounded project context |
| `SessionEnd` | cleanup or export notes |
| `UserPromptSubmit` | block unsafe prompts or add reminders |
| `PreToolUse` | block or rewrite tool input |
| `PostToolUse` | inspect result, run formatter, add context |
| `PreCompact` | checkpoint or block compaction |
| `PostCompact` | restore concise context |
| `Stop` | require final verification or continue |

## Handler Types

V1:

- `builtin_policy`: deterministic product code;
- `builtin_audit`: record-only product code;
- `builtin_context`: bounded context assembly helper;
- `builtin_release_gate`: package/canary evidence gate.

V2:

- `command`: external command with JSON stdin and structured stdout;
- `http`: later, only if networking policy and secret handling are mature;
- `mcp_tool`: later, only for trusted local MCP servers;
- `prompt`: later, because it spends tokens and can be non-deterministic;
- `agent`: later, because it can start nested tool use and spend tokens.

Do not ship prompt hooks or agent hooks in the first public hook version.

## Context Injection Policy

Hook-produced context is useful for project reminders, checkpoint summaries, and
handoff notes. It is also a prompt injection and token budget risk.

Rules:

- only specific events may add context;
- context must enter through Context Assembly, not directly into provider
  prompts;
- output must be redacted before becoming model-visible;
- each handler has a token budget;
- overflow spills to a main-owned file only if the path is not model-visible
  without a safe preview;
- context is bound to the current project, conversation, turn, and run;
- hook context must be listed in Run Context Snapshot evidence.

## Permission And Safety Policy

Hooks do not replace Builder's permission model.

Allowed:

- deny a source read/write before it runs;
- require user approval before provider egress;
- require checkpoint before source mutation;
- add an audit note to the current run;
- ask the model to continue after failed verification in future V2.

Not allowed in V1:

- grant permissions;
- mutate Git;
- mutate SQLite product facts except through the hook ledger;
- read secrets;
- dispatch provider calls;
- dispatch arbitrary tools;
- expose raw source or provider prompts to renderer.

## UI Model

V1 has no ordinary user-facing Hooks menu.

Internal effects should appear as natural product status:

- `Checkpoint saved`
- `Context compressed`
- `Review required before saving`
- `Action blocked by project policy`
- `Release check failed`

V1.5 can add an advanced read-only `Hooks` or `Automation` diagnostic panel
showing hook run evidence.

V2 can add Desktop hook management if user/workspace hooks exist:

- source grouped by Built-in, Managed, User, Workspace, Plugin;
- trust state and content hash;
- enable or disable user/workspace hooks;
- inspect command and matcher;
- last run status;
- no inline editing of command bodies in the app.

## Implementation Slices

### Slice A: Internal Hook Event Contract

Add pure main-side event and run fact constructors:

- `builder-hook-event.v1`;
- `builder-hook-handler.v1`;
- `builder-hook-run.v1`;
- `builder-hook-decision.v1`.

No IPC, no renderer surface, no command execution.

### Slice B: Internal Hook Bus

Add a main-owned dispatcher with only built-in deterministic handlers.

Initial events:

- `before_context_assembly`;
- `before_auto_compaction`;
- `before_source_write_admission`;
- `after_draft_checkpoint_recorded`;
- `before_save_version`.

### Slice C: Hook Ledger Projection

Expose renderer-safe hook status through task stream or permissions/artifact
logs. The projection must be sanitized and must not expose hook stdin/stdout.

### Slice D: Desktop Diagnostics

Add read-only diagnostics for hook runs and source facts. This is for developer
debugging and packaged canary evidence, not ordinary daily use.

### Slice E: Command Hook MVP

Only after V1 is stable:

- user and workspace `hooks.json`;
- exact hash trust;
- timeout;
- stdout JSON parser;
- redacted input/output digest;
- no network by default;
- no secret env by default;
- `/hooks`-like Desktop review before first run.

### Slice F: Plugin Hooks

Only after command hooks are mature. Plugin hooks should be bundled, reviewed,
and trusted as part of plugin installation, not silently loaded.

## Non-Goals

Near-term Builder should not:

- expose user command hooks before checkpoint/context/save/provider basics are
  stable;
- execute arbitrary TypeScript plugins in process;
- use hook scripts as a substitute for permission authority;
- let hooks silently add provider prompt context;
- let hooks become a hidden automation layer that ordinary users cannot
  inspect;
- run token-spending prompt or agent hooks by default.

## Maturity Checklist

A hook capability is mature only when:

- every event has a stable schema and tests;
- every blocking decision has deterministic precedence;
- every run creates a ledger fact;
- trust is content-hash bound;
- untrusted project hooks cannot run;
- output is bounded and redacted;
- failures are visible but do not corrupt the task;
- packaged canary verifies at least one allow, one block, and one failure case;
- release evidence proves hooks do not bypass provider, source, Git, SQLite,
  permission, or revision authority.
