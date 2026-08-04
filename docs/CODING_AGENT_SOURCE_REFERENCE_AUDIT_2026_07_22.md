# Coding Agent Source Reference Audit

Date: 2026-07-22

This document records source-level evidence used to design ClawFabric Builder's
project-local Conversation and Task Stream. It separates readable implementation
evidence from public behavior descriptions and inaccessible private code.

The referenced projects are design inputs only. They create no runtime, package,
import, storage, protocol, trademark, or data dependency for ClawFabric Builder.

## Evidence Levels

- **Source evidence**: behavior is supported by readable implementation at a
  pinned commit or by an inspectable local distribution.
- **Published protocol evidence**: behavior is supported by public schemas,
  types, SDK bundles, or documented wire contracts, but not necessarily by the
  product's complete implementation source.
- **Product behavior reference**: behavior is described by official product
  documentation or observable UI. It is not implementation evidence.
- **Unknown**: the relevant implementation is private, incomplete, or absent
  from the public repository. Builder must not fill this gap by assumption.

## Codex

### Evidence boundary

- Open-source reference pinned to
  `openai/codex@9fc715c0861c956c894a91890b78dc05b304ba29`.
- The public repository contains readable CLI, TUI, app-server, and protocol
  source.
- The installed Codex desktop application exposes compiled renderer assets and
  protocol strings. Those artifacts prove the presence of surfaces such as
  approvals, diff review, file navigation, interrupt, steer, resume, and fork.
  They do not expose the private React state model or every desktop interaction
  rule.

### Source findings

- The app-server protocol is a bidirectional JSON-RPC-like protocol over JSONL.
  `Thread` is the persistent conversation aggregate, `Turn` is one execution,
  and `ThreadItem` is an extensible tagged union for messages, reasoning,
  commands, file changes, approvals, tools, review, and related activity.
- The observable lifecycle is `item/started`, zero or more item deltas, and
  `item/completed`, followed by terminal `turn/completed` status. UI projections
  must not treat a spinner or partial item as the terminal fact.
- Approval is a server request with a correlated response, not an assistant
  message. Decline and cancel have different semantics.
- Interrupt acknowledges a request; terminal interruption is proven only by the
  later turn completion event.
- Steer adds input to the current turn. Client queueing is a separate policy and
  must not be conflated with steer.
- Resume preserves a thread identity. Fork creates a new identity and preserves
  its origin relationship.
- File-change items and `turn/diff/updated` provide inspectable change evidence.
  The aggregate diff is a replaceable snapshot, not a stream to concatenate.

Primary source paths:

- `codex-rs/app-server-protocol/src/rpc.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/turn.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/item.rs`
- `codex-rs/app-server-protocol/src/protocol/common.rs`
- `codex-rs/tui/src/app/thread_routing.rs`

Pinned source:
[openai/codex](https://github.com/openai/codex/tree/9fc715c0861c956c894a91890b78dc05b304ba29).

## DotCraft

### Evidence boundary

- Source reference pinned to
  `DotHarness/dotcraft@ffac645929d97150474d09fb004f16d220543182`.
- The repository contains readable Desktop, Core, AppServer, protocol, storage,
  approval, and SDK implementations.
- DotCraft is Apache-2.0 licensed. ClawFabric currently adopts abstractions only;
  copying source later would require a separate license and attribution review.

### Source findings

- A Workspace owns the runtime and persistence boundary. `SessionThread` is the
  durable conversation aggregate; `SessionTurn` is one unit of agent work;
  `SessionItem` is the turn's atomic record; `SessionEvent` projects lifecycle
  changes.
- Desktop composes `ThreadHeader`, `MessageStream`, and `InputComposer`. Approval,
  user-input, and plan-approval composers replace the ordinary composer at the
  interaction point instead of appearing as unstructured assistant text.
- When idle, the composer starts a turn with optimistic UI; when busy, it uses a
  distinct enqueue operation. A failed optimistic start removes the local turn.
- Canonical thread history is stored as JSONL rollout data. SQLite is used for
  queryable metadata and projections. The in-memory recent-event replay buffer
  is not a durable stream and cannot be copied as Builder's recovery authority.
- AppServer clients share the same core through JSON-RPC transports. Reconnect
  rebuilds from thread read/list snapshots; live continuity requires connection
  to the same server instance.
- Diff in the Desktop renderer is reconstructed from tool activity and disk
  contents. It is useful presentation evidence but is not an immutable
  Candidate, Review, or Project Revision authority.
- SDKs that have no approval handler may default to accepting an approval. This
  is incompatible with Builder's fail-closed permission boundary.

Primary source paths:

- `desktop/src/main/index.ts`
- `desktop/src/renderer/components/layout/ConversationPanel.tsx`
- `desktop/src/renderer/components/conversation/MessageStream.tsx`
- `desktop/src/renderer/components/conversation/InputComposer.tsx`
- `desktop/src/renderer/utils/startTurn.ts`
- `src/DotCraft.Core/Protocol/SessionThread.cs`
- `src/DotCraft.Core/Protocol/SessionTurn.cs`
- `src/DotCraft.Core/Protocol/SessionItem.cs`
- `src/DotCraft.Core/Protocol/ThreadStore.cs`
- `src/DotCraft.Core/Protocol/AppServer/Wire/AppServerMethods.cs`
- `src/DotCraft.Core/Protocol/SessionApprovalService.cs`

Pinned source:
[DotHarness/dotcraft](https://github.com/DotHarness/dotcraft/tree/ffac645929d97150474d09fb004f16d220543182).

## Pi

### Evidence boundary

- Source reference inspected from
  [earendil-works/pi](https://github.com/earendil-works/pi/tree/a96fb984d8c8b065fc5d193309fc812a882adee0)
  on 2026-08-04.
- The public repository contains readable TypeScript monorepo packages for an
  agent core, coding-agent CLI, provider abstraction, and terminal UI library.
- This audit uses Pi as source-level architecture evidence for session
  branching, queued input, provider abstraction, extension packaging, and
  viewport ownership. Before any code-level dependency or copied design is
  introduced, the exact upstream commit must be pinned and reviewed separately.
- Pi is MIT licensed. ClawFabric currently adopts product and architecture
  principles only; source reuse would require a separate license and
  attribution review.

### Source findings

- Pi is a minimal terminal coding harness rather than an Electron desktop
  product. Its public package split is useful: `pi-coding-agent` owns the coding
  surface, `pi-agent-core` owns tool-calling and state management, `pi-ai`
  abstracts providers, and `pi-tui` owns terminal rendering.
- The default coding-agent surface gives the model `read`, `write`, `edit`, and
  `bash` tools. Builder must not copy this default because its ordinary-user
  desktop needs fail-closed permission admission before writes or command
  execution.
- Pi distinguishes queued steering from queued follow-up input: steering can be
  delivered after the current assistant turn finishes its current tool-call
  segment, while follow-up waits until all active work finishes. This supports
  Builder's future active-run input model: "send while working" is not the same
  command as "cancel" or "start a new build."
- Sessions are JSONL records with `id` and `parentId`, enabling an in-file
  tree. `/tree`, `/fork`, and `/clone` expose branching, recovery, and alternate
  direction exploration without rewriting history. Builder should adopt the
  concept, not the storage layout: Conversation, Task, Run, Candidate, Review,
  and Project Revision remain separate facts.
- Pi supports manual and automatic compaction while preserving full session
  history. Builder should treat compaction as a context assembly step, never as
  deletion of durable facts or as Project memory authority.
- Pi's extension, skill, prompt-template, and package model shows a useful
  long-term capability pattern: keep the core small and load specialized
  abilities through explicit packages. Builder can use this idea for future
  document writers, review helpers, tool adapters, and agent roles, but only
  after permission gates exist.
- Pi's containerization guide is explicit about the boundary: Pi has no built-in
  filesystem/process/network/credential permission system and recommends
  routing tools into a VM, Docker container, or policy sandbox when stronger
  isolation is needed. Builder must invert that default: permissions are a
  product fact before tool dispatch, and sandbox/runtime choices are downstream
  enforcement.
- `pi-tui` demonstrates application-owned scrolling, fixed editor/footer
  regions, overlays, focus handling, and differential rendering. Builder should
  translate this into desktop layout contracts: the chat region scrolls; title,
  sidebars, artifact panel, and composer remain stable; menus and pickers are
  overlays with focus restore.

Primary source paths:

- `packages/coding-agent/README.md`
- `packages/coding-agent/docs/containerization.md`
- `packages/tui/README.md`

Source reference:
[earendil-works/pi](https://github.com/earendil-works/pi/tree/a96fb984d8c8b065fc5d193309fc812a882adee0).

## Claude Code

### Evidence boundary

- Repository reference pinned to
  `anthropics/claude-code@ac062f33ab0ca7c62b9df648d0f2027fa9b969f0`.
- Agent SDK reference pinned to
  `anthropics/claude-agent-sdk-typescript@2997b3d35a729ef823d4edf6cf3c690f86d888e3`.
- The public Claude Code repository does **not** contain the core CLI source,
  build entrypoint, agent loop, permission engine, session persistence, or TUI.
  It contains plugins, commands, hooks, examples, documentation, and issue
  automation. Its license is all rights reserved.
- The npm CLI package installs a native binary. The Agent SDK distribution
  exposes types and a bundled process transport, but not the missing modular
  implementation source.

### Readable and published evidence

- Hook and SDK contracts expose session identifiers, resume/fork inputs,
  permission modes, tool approval decisions, plan-mode tools, structured file
  edits, task/todo records, interruption, terminal reasons, and bounded result
  categories.
- Public plugin source demonstrates pre-tool denial, stop blocking, prompt-based
  review orchestration, task/todo usage, transcript-aware stop hooks, and
  diff-based security review helpers.
- Published SDK behavior shows that `query()` launches the Claude Code binary
  using streaming JSON input/output and carries control requests and responses.
- These facts support Builder's separate Plan, Permission, Task, Edit, Result,
  and Interrupt concepts.

### Unknown implementation

The following must remain explicitly unknown: the core model/tool loop, exact
permission decision ordering implementation, transcript write and compaction
transactions, file-edit atomicity, task persistence and concurrency, interrupt
propagation races, retry behavior, and the built-in review implementation.
Official documentation can calibrate product behavior, but cannot be cited as
source implementation evidence for these areas.

Readable source examples:

- `plugins/hookify/core/rule_engine.py`
- `plugins/code-review/commands/code-review.md`
- `plugins/pr-review-toolkit/commands/review-pr.md`
- `plugins/security-guidance/hooks/diffstate.py`
- `plugins/security-guidance/hooks/security_reminder_hook.py`
- `plugins/security-guidance/hooks/session_state.py`
- `plugins/ralph-wiggum/hooks/stop-hook.sh`

Pinned repositories:

- [anthropics/claude-code](https://github.com/anthropics/claude-code/tree/ac062f33ab0ca7c62b9df648d0f2027fa9b969f0)
- [anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript/tree/2997b3d35a729ef823d4edf6cf3c690f86d888e3)

## ClawFabric Builder Decisions

The shared pattern is a continuing project-local work loop, not a chat panel and
not a one-shot generator:

```text
Project Conversation
-> Message
-> Turn
-> optional Task
-> one or more immutable Run attempts
-> ordered Activity Items
-> Candidate or explanation
-> explicit Review decision
-> Project Revision or Artifact
```

Builder will adopt these implementation principles:

1. Conversation preserves collaboration context but never owns project source.
2. Turn, Run, Activity Item, interaction request, and terminal outcome are
   distinct versioned records.
3. Retry creates a new Run. Steering and queueing are separate commands.
4. Interrupt is asynchronous and reaches a terminal state only through a
   persisted completion event.
5. Approvals and user-input requests are correlated interaction gates. Missing
   handlers, disconnects, malformed decisions, and timeouts fail closed.
6. UI cards are disposable projections. Restart rebuilds from persisted facts.
7. Change summaries and diff snapshots are review evidence. Only explicit Save
   can publish an immutable Project Revision.
8. Unknown provider item types remain safely preservable as data but cannot gain
   execution, permission, save, or artifact authority.
9. The provider adapter retains project, conversation, turn, run, item, request,
   causation, and idempotency identities across the boundary.
10. Active-run input distinguishes cancel, steering, and follow-up. A second
    composer submit while work is active must not mutate an already-issued
    provider/tool request or erase visible conversation history.
11. Branching and compaction are context-management features over durable
    facts. They do not rewrite Project source, Review, Save, Permission, or Run
    evidence.
12. Ordinary users see Project, Task, Progress, Preview, Changes, Review, and
    Version. Internal protocol and authority terms remain engineering evidence.

Builder will not adopt DotCraft's storage layout, Codex's developer-only
repository assumptions, Pi's unrestricted default `read`/`write`/`edit`/`bash`
tool authority, Claude Code's terminal-first interaction, a generic request bus,
renderer-owned durable state, memory-only replay, implicit tool approval, or
conversation-as-source-of-truth.
