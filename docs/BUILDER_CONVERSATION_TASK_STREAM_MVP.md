# Builder Conversation and Task Stream MVP

## Product Correction

The current Builder proves natural-language generation, immutable save, reopen,
update, and preview. Its interaction is still too close to a one-shot generator:
one idea creates a project and one later message creates an update.

The next product milestone is a project-local, continuing human-AI work loop. It
must feel closer to working with Codex or Claude Code while preserving
ClawFabric's own Project Revision, Run, Review, Permission, and Artifact facts.

This is not a return to legacy Chat and it does not make conversation the source
of project truth.

## Reference Calibration

The interaction model is informed by source-level audits of Codex and DotCraft,
and by the readable plugin, hook, SDK, distribution, and behavior evidence
available for Claude Code. The evidence levels, pinned commits, source paths,
and inaccessible implementation boundaries are recorded in
[Coding Agent Source Reference Audit](CODING_AGENT_SOURCE_REFERENCE_AUDIT_2026_07_22.md).

These projects are references for product behavior, protocol structure, and
information architecture. They are not runtime dependencies or designs to
copy. Where implementation source is private or incomplete, this contract does
not infer missing behavior.

### Codex

Codex demonstrates a continuing project conversation in which the user can
steer active work, inspect progress, review diffs and command results, and make
follow-up requests. The durable code and repository state remain distinct from
the conversational transcript.

ClawFabric adopts the continuing composer, inspectable attempt, and explicit
review principles. It does not adopt Codex's repository, worktree, or developer-
only assumptions as the ordinary user's product model.

Source reference:
[openai/codex](https://github.com/openai/codex/tree/9fc715c0861c956c894a91890b78dc05b304ba29).

### Claude Code

Claude Code demonstrates resumable sessions, plan-before-edit modes, bounded
agent turns, explicit permission modes, tool feedback, interruption, and
follow-up recovery. These behaviors show that planning, tool use, execution,
and review need distinct states instead of one undifferentiated assistant
message.

ClawFabric adopts separate plan, approval, attempt, result, and review states.
It does not expose a terminal-first interface or grant arbitrary shell and file
authority in the Builder MVP.

The Claude Code core CLI is not present in the public repository. The source
audit therefore distinguishes readable plugin and hook implementations,
published SDK contracts, official behavior documentation, and unknown private
implementation.

Evidence references:
[Claude Code repository](https://github.com/anthropics/claude-code/tree/ac062f33ab0ca7c62b9df648d0f2027fa9b969f0) and
[Claude Agent SDK TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript/tree/2997b3d35a729ef823d4edf6cf3c690f86d888e3).

### DotCraft

DotCraft demonstrates project-scoped continuity: one project owns long-running
threads, turns, items, approvals, tools, and history across Desktop, CLI, IDE,
channels, and automations. Its Unified Session Core separates a Thread from a
Turn and from event-like Items, while each client renders approvals and work in
its native UI.

ClawFabric adopts the project-local continuity and multi-entry separation. It
does not copy DotCraft's `.craft/` storage layout, AppServer runtime, memory
system, or assumption that the project directory itself owns every authority.
ClawFabric Project Revision, Run, Artifact, Permission, and later Workflow facts
remain independently governed.

Source reference:
[DotHarness/dotcraft](https://github.com/DotHarness/dotcraft/tree/ffac645929d97150474d09fb004f16d220543182).

### Resulting ClawFabric Model

The common pattern is not "add a chat panel." It is:

```text
Project-local Conversation
-> user Message
-> one Turn with optional steering or interruption
-> optional Task
-> one or more bounded Runs
-> assistant explanation or candidate result
-> explicit Review / Save decision
-> immutable Project Revision or Artifact
```

Conversation keeps continuity. Runs prove attempts and outcomes. Project
Revision and Artifact remain the durable work truth.

## User Experience

Inside one Project, the user can:

- ask a question without changing source;
- ask AI to explain the current version;
- request a local or broad change;
- inspect the plan and progress for a task;
- preview a proposed result before saving it;
- ask for another change, reject the direction, or return to the saved version;
- diagnose a failed attempt and retry deliberately;
- compare a proposed result with the current saved version;
- explicitly save an accepted result as a new Version;
- reopen the Project and continue the same bounded work context.

The primary composer means “continue working with AI”, not “submit one update
form”. Ordinary language remains the main control surface.

## Fact Model

### Conversation

A Project Conversation is the local communication context for one Project. Its
append-only Messages record human requests and safe assistant responses.

Conversation is a communication authority only. It is not Project source,
Permission, Run, Review, or Artifact authority.

### Turn

A Turn binds one user request, the Project and base Revision visible when the
request was submitted, and any bounded steering that follows before the Turn is
terminal. A Turn can end with an explanation, a proposed plan, a candidate,
cancellation, interruption, or a fixed failure.

Turn continuity is not source continuity. Resuming a Conversation does not
silently restore an obsolete base Revision, and changing direction does not
rewrite already observed tool or provider results.

### Task

A user message may create a Task only when the user explicitly asks AI to do
work. Questions that only request an explanation do not need to create a source
change Task.

A Task binds the Project, base Revision, requesting Message, requested outcome,
and status. It cannot grant its own tools or permissions.

Task status is a planning projection. `completed` does not prove that checks
passed, a candidate was accepted, or a Revision was saved.

### Run

Each AI attempt is a Run bound to a Task or bounded explanation request. A Run
records progress and a terminal result. Retry creates a new Run; it never edits
the prior attempt.

Runs are interruptible. A new user message may steer a pending Run only through
an explicit steering event; it may not mutate an already-issued provider or tool
request. Interrupt, cancel, failure, and success remain distinct terminal facts.

### Task Stream

The Task Stream is an ordered projection of append-only facts such as:

```text
turn.submitted
plan.proposed | plan.revised | plan.approved
task.created | task.updated
run.started | run.progress.recorded | run.steered | run.interrupted | run.completed
tool.call.requested
candidate.created | candidate.accepted | candidate.rejected
verification.started | verification.completed
revision.saved | revision.conflicted
```

The first MVP does not need every event above, but it must preserve the split
between declared, planned, attempted, observed, verified, and saved states. An
assistant sentence cannot promote one state into another.

### Candidate Result

A Run may return:

- an explanation;
- a proposed plan;
- a code-change candidate;
- a verification result;
- a fixed safe failure.

A code-change candidate is not a saved Version. It may be previewed and compared
but becomes Project truth only after explicit Save creates an immutable Project
Revision.

### Review and Save

Accept, reject, revise, and save are explicit user decisions. Saving first
creates and verifies the Project Revision fact, then records the candidate as
accepted in the Conversation projection. Conversation may show the saved Version
number, but it is not Revision authority. Rejecting a candidate preserves
history but changes no Project source.

## Minimal Interaction Flow

```text
Open Project
-> user sends a message
-> classify as question or requested work
-> create bounded Task/Run when work is requested
-> show assistant status and safe result
-> explanation: continue conversation, no Revision
-> code candidate: preview and compare
-> user asks another change, rejects, or saves
-> Save publishes one immutable local Revision
-> continue from the new saved Revision
```

## Context Rules

The model may receive only bounded, explicit context:

- current trusted Project Revision;
- selected prior Messages needed for the current request;
- the latest bounded plan with its proposed, approved, or rejected state;
- current Task and prior attempt summary;
- approved tool results when later Permission gates exist.

Conversation history must not become an unbounded prompt transcript. Context
selection is deterministic, resource-bounded, and private data remains local
unless explicitly sent through the dedicated Builder provider authority.
Plan text is not treated as implementation approval by itself. The prompt
context preserves whether the latest plan is merely proposed, explicitly
approved, or rejected, so later "do it" style turns can be grounded without
silently reviving a rejected plan.

## UI Contract

- The main stage prioritizes the continuing conversation and the next review
  decision. Large artifacts must not turn the chat transcript into a preview
  container.
- A lightweight conversation and task stream shows user messages, AI status,
  explanations, candidate outcomes, failures, and save decisions.
- The composer remains available as the continuing input surface with one
  primary send action. Plan-first work may appear as a secondary composer tool,
  but it must route through the same conversation/task stream rather than a
  separate planning panel.
- Ordinary chat and explanations may work before a local project folder is
  selected. Build/draft/save flows must not use a logical New project as a
  hidden write target. The composer shows a current project/workspace chip.
  Clear build intent without an opened/saved project opens that project picker
  and preserves the user's text instead of immediately submitting or silently
  creating a target. Choosing New project is an explicit entry into the
  main-owned local workspace selection flow; the first desktop path asks for an
  empty local folder as the project read/write boundary. Cancellation fails
  closed with user-facing guidance, while successful selection creates a
  working local project identity. The renderer receives only the working
  Project identity, bounded project title, and source-folder display name/count,
  not the folder path or any write authority. The project remains unsaved until
  the user explicitly accepts a verified candidate as a Version.
- Chat flow may show only compact result summaries, thumbnails, and action rows.
  Full Preview, Changes, Source, Versions, and Logs belong in a separate
  artifact surface such as a right drawer/panel. That surface can be opened on
  demand, switched by tab, resized on desktop, and closed without losing the
  conversation position.
- A generated draft may auto-open the Preview artifact tab, but the chat scroll
  remains readable and the Review/Save decision remains visible. Full preview
  height is independent from the chat scroll height.

Provider output streaming consumes bounded OpenAI-compatible `text/event-stream`
deltas while preserving the same terminal generation result. Raw provider deltas
remain main-only. The current renderer path exposes only ephemeral live display
text extracted from approved generation result fields, so the conversation can
show active AI text for generation, explanation, approved-plan continuation,
and plan-first proposal runs without making it a durable Task Stream item.
Renderer-safe tool activity projection is now part of the visible conversation
workspace: pending tool requests appear as ordinary project steps, and a
matching recorded tool result folds the request into one final status row. This
projection is read-only UI language over already-admitted Task Stream facts; it
exposes no provider envelopes, prompts, credentials, source evidence, Git
receipts, raw tool output, Save authority, or Project Revision facts. Main's
project-id-only activity hint only tells the desktop conversation controller to
refresh the current read-only projection; it keeps the existing chat visible
while reading and never lets the renderer create, accept, or reinterpret work.
Agent Step Start/Result receipts now also have a pure renderer-safe progress
projection that can turn already-recorded main-store facts into bounded public
step status items. A main-only read service can compose the Step Start store,
Step Result store, and that projection for one owner/Project/Task/Run read,
returning only public progress items plus fixed read counts/statuses. A
separate main-side Conversation admission contract validates one selected
public progress item from the read-service result against a trusted active
Project/Conversation/Turn/Task/Run context and produces a digest-bound record.
The Conversation main service can now append that admission through a
trusted-context-only `record_agent_step_progress` method, then Conversation
replay accepts the admitted progress only while the matching work Run is active.
The renderer-safe Task Stream exposes only the public
`agent_step_progress_recorded` item with step id/index, recorded state, fixed
summary, and no raw output or revision authority. This still does not add an
IPC/preload command, subscribe to step stores, start or run Agent steps, dispatch
provider/model/tool work, read or write source, create progress events directly
from the stores, or let the renderer append progress. Until those later gates
land, the UI must not invent Agent step narration from live text, provider
deltas, or local state.

The chat flow should feel like the assistant is continuously working with the
user, but it must be driven by facts rather than invented narration. The current
MVP should show:

- `run_started` as a compact "assistant is working" row;
- `run_progress_recorded` stages as readable step updates such as reading
  context, writing the response, checking the response, and preparing the
  result;
- `tool_call_requested` and `tool_call_result_recorded` as sanitized project
  steps only after the tool facts have been admitted;
- `agent_step_progress_recorded` as sanitized Agent step status only after a
  main-side progress admission has been recorded into Conversation; recorded
  starts must not be described as live running work, and recorded results expose
  only fixed public summaries;
- `run_completed` as the terminal answer, plan, candidate, failure, cancelled,
  or interrupted result. Failed completions carry only a fixed public
  `failure_phase` such as `not_recorded`, `context_ready`,
  `provider_request_started`, `provider_response_received`, or
  `result_preparing`; this supports useful recovery text without exposing
  provider errors, prompts, credentials, source evidence, Git receipts, or
  internal exception material;
- a completion summary derived from the terminal result, candidate summary,
  plan summary, verification status, and review state when available. A
  successful chat-only explanation should not add a separate mechanical summary
  under the assistant answer; the answer text is already the user-facing
  terminal result.

Current UI checkpoint: durable `run_started` / `run_progress_recorded` status
rows remain visible in the chat flow even while ephemeral provider live output is
streaming. Provider text is only assistant-message text; it does not replace the
fact-backed work step. When provider live output has not produced display-safe
text yet, the chat flow uses the recorded work-status row as the visible waiting
state instead of adding a second default empty assistant reply. A waiting
live-output row is kept as an early fallback before any work-status item is
visible, and for explicit waiting copy such as approved-plan continuation.

The first summary can be compact. It should answer:

```text
What happened?
What changed, if anything?
What should the user review or do next?
```

Detailed tool-level narration, command output, file-by-file work, test runs,
repair loops, child Agent updates, and cross-task summaries require later
Permission, Tool Call, Context Snapshot, and Agent Delegation gates. The UI must
not display those steps unless their underlying facts exist.
- Candidate, saved, failed, and superseded states are visually distinct.
- The user can always identify the current saved Version.
- Engineering terms such as IPC, schema, receipt, adapter, and admission remain
  outside ordinary product copy.

## First MVP Boundary

Included:

- one local Project Conversation per Project;
- append-only human and assistant Messages;
- Turn identity with bounded steering and interruption;
- question/explanation and change-request outcomes;
- one active foreground Task/Run at a time;
- cancel, deliberate retry, candidate preview, reject, and explicit Save;
- restart restore for conversation, terminal runs, and current candidate state;
- main-only candidate proof restore by draft id from SQLite event indexes and
  Git-verified candidate source, without renderer-supplied receipt or source;
- fixed provider errors and no credential readback.

Excluded:

- legacy Chat, ChatCreatePage, or chat-planner authority;
- server chat, contacts, presence, or cross-device sync;
- autonomous background Agents;
- Agent-to-Agent delegation;
- arbitrary shell, network, backend, or generated-code execution;
- silent source save, publish, share, permission grant, or destructive action;
- community feed or collaborative editing.

## Implementation Gates

1. Pure Conversation/Message/Turn/Task/Run contracts and sanitizers.
2. Main-owned append-only local repository with restart and corruption tests.
3. Dedicated Builder provider request/result projection for question, plan, and
   code candidate outcomes.
4. Controlled Electron IPC and renderer ports; no generic provider dispatcher.
5. Controller state machine for send, cancel, retry, candidate, reject, and
   explicit Save.
6. Conversation/task-stream UI integrated into the current Builder workspace.
7. Packaged real-provider canary proving explanation, code candidate, explicit
   save, follow-up modification, and restart without duplicate dispatch.

Each gate remains independently reviewable. The first contract gate does not
authorize persistence, provider calls, source writes, or execution.

## Acceptance

The milestone is complete when a user can open one Project, hold a multi-turn
work conversation, ask a question without creating a Revision, request and
preview a code change, explicitly save it, request a second change based on the
new Version, restart the app, and continue without lost or duplicated work.
