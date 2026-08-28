# Programming Runtime Adapter And Event Protocol

Date: 2026-08-14

## Authority And Scope

This document defines the minimum Builder-owned runtime contract needed for a
foundational AI coding loop:

```text
understand the admitted project
-> explain or plan
-> read and search
-> edit files
-> run bounded checks
-> repair when needed
-> present the result
-> keep a recoverable working checkpoint
```

It is subordinate to
[Foundational Coding Loop And Plugin Runtime Roadmap](FOUNDATIONAL_CODING_LOOP_PLUGIN_RUNTIME_ROADMAP.md)
and uses the source-adoption conclusions in
[DeepSeek Harness Adoption Audit](DEEPSEEK_HARNESS_ADOPTION_AUDIT.md).

This is not a public plugin API. It does not authorize subagents, arbitrary
shell access, general web access, deployment, or a plugin marketplace.

## Decisions

1. Builder owns protocol `builder-programming-runtime.v1`.
2. Runtime implementations are replaceable adapters, not product authorities.
3. Electron main owns admission, permissions, event commit, working-state
   reconciliation, checkpoints, cancellation, and recovery.
4. The renderer receives user-safe projections, never raw runtime authority.
5. The current structured generator and a future Harness adapter must emit the
   same canonical events.
6. A runtime may describe only capabilities it can actually prove.
7. A Build run is successful only when its real tool work has settled and its
   resulting working state has been reconciled.
8. When a selected runtime declares context compaction, that runtime owns the
   in-session trigger, retained region, replacement transaction, and retry
   behavior. Builder validates and projects the resulting facts; it does not
   substitute an event-count summarizer for the runtime algorithm.

## Core Adapter Contract

The implementation language may vary, but the semantic contract is:

```ts
interface ProgrammingRuntimeAdapter {
  readonly descriptor: RuntimeDescriptor;

  startRun(
    admission: RuntimeRunAdmission,
    input: RuntimeInput,
    sink: RuntimeEventSink,
  ): Promise<RuntimeRunHandle>;

  steerRun?(
    handle: RuntimeRunHandle,
    input: RuntimeFollowUp,
  ): Promise<RuntimeSteerReceipt>;

  cancelRun(
    handle: RuntimeRunHandle,
    reason: RuntimeCancelReason,
  ): Promise<RuntimeCancelReceipt>;

  closeSession?(session: RuntimeSessionRef): Promise<void>;

  dispose(): Promise<void>;
}
```

Optional methods are usable only when the descriptor declares the matching
capability. Main must not infer support from the presence of provider text or a
method-shaped object.

## Runtime Descriptor

```ts
interface RuntimeDescriptor {
  runtimeKind: string;
  protocolVersion: "builder-programming-runtime.v1";
  implementationVersion: string;
  capabilities: {
    streamingText: boolean;
    reasoningStatus: "none" | "bounded_status";
    nativeToolCalls: boolean;
    steering: "none" | "queued" | "live";
    cancellation: "cooperative" | "process" | "unsupported";
    sessionResume: "none" | "runtime_local";
    contextCompaction: boolean;
    parallelReadTools: boolean;
  };
}
```

`reasoningStatus` never means exposing private chain-of-thought. It permits only
short user-facing statuses backed by runtime lifecycle, such as `Reading the
project`, `Editing index.html`, or `Running npm test`.

`cancellation: "process"` means cancellation requires terminating an isolated
runtime process. It is a weaker capability than cooperative per-run cancel and
must be visible to main's cleanup policy.

## Run Admission

Only Electron main creates an admission:

```ts
interface RuntimeRunAdmission {
  projectId: string;
  conversationId: string;
  runId: string;
  mode: "ask" | "plan" | "build";
  workspaceRef: MainIssuedWorkspaceRef;
  providerRef: MainOwnedProviderRef;
  modelRef: MainOwnedModelRef;
  allowedTools: RuntimeToolKind[];
  permissionGrantRef?: MainIssuedPermissionGrantRef;
  limits: {
    maxSteps: number;
    maxDurationMs: number;
    maxModelTokens: number;
    maxToolOutputBytes: number;
  };
}
```

The admission contains references, not renderer-supplied absolute paths,
provider secrets, source trees, or arbitrary commands.

Mode policy is deliberately small:

| Mode | Allowed behavior |
| --- | --- |
| Ask | Read/search when needed; answer in conversation; no mutation. |
| Plan | Read/search when needed; emit complete Markdown in conversation; no mutation. |
| Build | Read/search/edit/write and admitted commands; create a recoverable checkpoint. |

## Canonical Event Envelope

Every accepted runtime event is normalized before durable commit:

```ts
interface RuntimeEventEnvelope<TType, TPayload> {
  protocolVersion: "builder-programming-runtime.v1";
  eventId: string;
  sequence: number;
  occurredAtMs: number;
  projectId: string;
  conversationId: string;
  runId: string;
  runtimeKind: string;
  eventSource: "runtime" | "main";
  turnId?: string;
  stepId?: string;
  toolCallId?: string;
  type: TType;
  payload: TPayload;
  runtimeEventRef?: string;
}
```

Main assigns `eventId` and canonical `sequence`. Runtime-local sequence values
may be retained as redacted diagnostic references but never become database or
UI authority.

`eventSource` prevents a structured generator from pretending to have native
tool calls. `runtime` means the adapter emitted a lifecycle, assistant, or real
runtime tool event. `main` means Builder recorded a file, command, check, or
terminal fact only after its own authority verified the action. A runtime event
sink cannot set `main` for itself.

The sink acknowledges accepted events so an adapter can detect a rejected,
duplicate, or closed run:

```ts
interface RuntimeEventSink {
  emit(event: RuntimeEventCandidate): Promise<{
    accepted: boolean;
    canonicalEventId?: string;
    canonicalSequence?: number;
    rejectionCode?: string;
  }>;
}
```

## Minimum Event Vocabulary

### Lifecycle

```text
run_started
turn_started
step_started
step_completed
turn_completed
run_blocked
run_cancelled
run_failed
run_completed
```

### Assistant Output

```text
assistant_text_delta
assistant_text_discarded
assistant_text_completed
assistant_reasoning_status
```

`assistant_text_delta` appends text to one stable message node. It must not
replace the entire conversation snapshot. `assistant_text_discarded` removes
only one uncommitted message attempt after a verified runtime retry; it carries
the discarded text digest and byte count so main can verify the exact tail.
`assistant_text_completed` seals the message and may include the final
normalized Markdown.

`assistant_reasoning_status` is ephemeral presentation state. It may be stored
for diagnostics, but it is not model reasoning and is not required in the
collapsed completed transcript.

### Public Narration And Tool Interleaving

Public narration comes only from assistant `text` content emitted by the
Runtime model. It is not synthesized from a checkpoint, provider lifecycle,
or renderer timer. A single model step may contain an ordered text block and
one or more tool calls:

```text
assistant text: explain the next meaningful action
tool call: request the real action
tool result: return the verified outcome to the model
next assistant step: explain the finding, repair, or next action
```

`assistant_text_delta` remains a volatile, animation-frame-coalesced live
surface. Once its matching `assistant_text_completed` arrives, main projects
one durable `programming_runtime_assistant_message` Task Stream item. Restart
replay rebuilds the same message from the canonical Runtime event chain. If
the completed public text is an exact prefix of the still-buffered live text,
the renderer shows only the uncommitted suffix. If it exactly matches the
terminal assistant response, the terminal duplicate is hidden in presentation
without deleting either canonical fact.

Reasoning blocks never enter this public narration channel. Public text is
bounded by the conversation message limits and checked by the conversation
record authority. Text that is unsuitable for public projection is omitted;
it must not make the Task Stream unavailable, and it must not be replaced by
invented lifecycle prose.

A provider retry is not a completed Step. When the runtime emits a correlated
retry record, the adapter discards any partial text from that failed request,
keeps earlier completed narration intact, and continues the same Step. The
renderer receives a bounded retain-byte reset for its volatile live buffer;
SQLite retains the canonical discard fact so restart replay cannot resurrect
the failed partial. Retry scheduling and backoff details are not ordinary user
work rows.

### Tool And Result Facts

```text
tool_call_started
tool_call_updated
tool_call_completed
tool_call_failed
file_change_recorded
check_result_recorded
```

Only actual tool work creates tool rows. Provider request lifecycle such as
`request started`, `response received`, or `preparing result` is not projected
as user-visible work.

## Tool Fact Contract

A tool call begins before execution:

```ts
interface ToolCallStartedPayload {
  toolKind: "read" | "search" | "edit" | "write" | "command";
  display: {
    activeLabel: string;
    completedLabel: string;
    targetLabel?: string;
    presentation: "file" | "changes" | "terminal" | "search";
  };
  argumentDigest: string;
}
```

Raw arguments remain main-owned. The renderer receives only safe display data
and main-issued references used to open the corresponding File, Changes,
Terminal, or Search view.

Exactly one terminal event follows each started tool call:

```ts
interface ToolCallCompletedPayload {
  durationMs: number;
  resultKind: "read" | "search" | "edit" | "write" | "command";
  resultRef: MainIssuedToolResultRef;
  summary: string;
}

interface ToolCallFailedPayload {
  durationMs: number;
  failureClass:
    | "denied"
    | "invalid_input"
    | "stale_file"
    | "not_found"
    | "timeout"
    | "cancelled"
    | "check_failed"
    | "runtime_failure";
  safeMessage: string;
}
```

Failures remain facts. They are not removed when the agent later repairs the
problem.

## Foundational Tool Semantics

### Read

Returns bounded UTF-8 content plus an observed file version. It classifies
missing, binary, oversized, and denied files without leaking outside the
admitted workspace.

### Search

Returns bounded structured path and text matches. Search does not authorize a
subsequent write by itself.

### Edit

Requires the observed version of every existing target file. A stale version
fails with `stale_file`; the runtime must read again before retrying. Successful
mutation emits `file_change_recorded` with a main-issued file/change reference
and added/deleted line counts.

### Write

Creates files only inside writable scope. Unexpected replacement requires an
explicitly admitted operation and current observed version.

### Command

Uses a main-owned command profile with bounded cwd, environment, duration,
output, and child-process policy. Completion records command display, exit code,
duration, output truncation, and a main-issued terminal-result reference.

The runtime cannot convert this capability into a renderer-controlled terminal.

## Ordering And Settlement Rules

1. Canonical sequence is contiguous inside a run.
2. Duplicate runtime event references are idempotent.
3. A tool start is committed before execution begins.
4. Every tool start receives exactly one completed or failed terminal event.
5. Mutations to the same canonical file are serialized.
6. Eligible read-only calls may execute concurrently, but their model-visible
   results are committed in deterministic call order.
7. A step completes only after all tool calls issued by that step have settled.
8. A turn completes only after its final assistant message is sealed.
9. A mutating run completes only after main reconciles working state and creates
   or updates the automatic recoverable checkpoint.
10. Gaps, malformed identifiers, late mutation results, and events after a
    terminal run state fail closed.

## Cancellation

Main translates user cancellation according to the declared capability:

| Capability | Required action |
| --- | --- |
| `cooperative` | Send per-run cancel, stop new tools, drain or cancel active tools, reconcile. |
| `process` | Stop input, terminate the isolated process tree, reconcile, then commit cancellation. |
| `unsupported` | Do not admit an interactive Build run that promises cancellation. |

The cancellation sequence is:

```text
mark cancellation requested
-> reject new tool calls
-> cancel or terminate active work
-> wait for bounded cleanup
-> inspect admitted working state
-> preserve recoverable changes
-> append run_cancelled
```

`run_cancelled` cannot mean only that the UI stopped listening.

## Recovery And Persistence

Builder's SQLite conversation event chain remains authoritative for product
recovery. Runtime-local JSONL or SQLite may support adapter resume and
diagnostics, but it does not decide:

- selected project identity;
- permissions;
- working-state admission;
- checkpoint restore;
- Review state;
- formal Version history.

On app restart, an unclosed run is projected as interrupted until main has
reconciled its working state. A runtime resume may continue only after project,
workspace, permission, and checkpoint references still match.

## DeepSeek Harness Mapping

The pinned audited Harness SDK uses newline-delimited JSON-RPC 2.0 over stdio.
Its current client-to-server methods are:

```text
initialize
session/prompt
shutdown
```

Its server-to-client notifications are:

```text
session.event
session.status
subagent.started
subagent.finished
```

Initial mapping:

| Harness signal | Builder treatment |
| --- | --- |
| `initialize` result | Adapter handshake evidence; no conversation row. |
| `session/prompt` result | Bind runtime message ID to the admitted run. |
| `session.status: running` | Lifecycle cue; never the sole proof of a started step. |
| `turn/start` | `turn_started`. |
| `step/start` | `step_started`. |
| `assistant/chunk` text delta | `assistant_text_delta`; reasoning remains outside public narration. |
| ordinary surface event with `surfaceOp: "append"` | Accept Harness's explicit append union member and continue normal event mapping. |
| `assistant/message` text block | `assistant_text_completed`; seals the accumulated public text. |
| `llm/retry` | Validate the active turn/step and retry identity; emit `assistant_text_discarded` for any failed partial. |
| `llm/retry-started` | Validate the matching scheduled retry and continue the same Builder Step. |
| `tool/call` | `tool_call_started` before Builder executes or accepts the tool. |
| `tool/result` | Normalize into terminal tool facts; never trust as project authority. |
| `compaction/prune` | Validate the private shadow-price record; emit no public work row. |
| replacement `tool/result` | Accept as a historical surface rewrite; do not replay it as a new tool execution. |
| `compaction/start` | Open one private compaction lifecycle bracket; emit no public narration. |
| `compaction/summary` | Validate the matching bracket and bounded text-block array; never publish or log the summary body as chat activity. |
| replacement `user/message` | Accept as Harness's model-visible checkpoint rewrite; do not present it as a new user message. |
| `compaction/end` | Close the matching bracket; an unclosed bracket prevents successful turn settlement. |
| `step/end` | `step_completed` after pending tool settlement. |
| `turn/end` | `turn_completed` after final text sealing. |
| `session.status: idle` | Settlement cue; not sufficient alone for `run_completed`. |
| `shutdown` | Graceful adapter close. |

The audited SDK has no per-turn cancel method, no per-session close method, no
protocol version negotiation, and `session/prompt` returns a message ID rather
than a completed prompt result. Therefore the first Builder spike must isolate
each active Harness conversation or run in a dedicated process and declare
`cancellation: "process"`.

The shutdown ladder is bounded:

```text
shutdown request
-> stdin close
-> process terminate
-> process-tree force kill
```

Harness automatic fallback model mounting is DeepSeek-specific and is disabled
or explicitly configured by Builder; it must not silently change the user's
selected provider or model.

### Context Compaction Ownership

The selected DeepSeek Harness composition already mounts JSONL session
persistence, semantic checkpoint policy, token metering, tool-result pruning,
and `dsh-compaction-basic`. Automatic compaction therefore belongs inside the
Harness serial pre-step boundary and is driven by measured model-context
pressure, not Builder conversation event count.

The Harness SDK server forwards every durable `SessionEvent` unchanged over
`session.event`. Its compaction lifecycle events are required extension events,
not `ignorable` forward-compatibility records. A Builder adapter declaring
`contextCompaction: true` must consequently understand those events and the
replacement `user/message` and `tool/result` surface operations.

Builder's separately persisted context summary is a cross-run product
checkpoint. It can support restart, task handoff, and a later provider-context
candidate after disclosure approval. It must not alter an active Harness
surface, decide when Harness compacts, or be described as proof that runtime
compaction occurred.

Packaged evidence now forces the bundled Harness across its token-pressure
threshold with an isolated deterministic provider. It proves one native
start/summary/replacement/end transaction survives JSON-RPC normalization, the
run continues through repair and reconciliation, and no private summary or
duplicate assistant row reaches the canonical conversation journal.

## Current Structured Runtime Mapping

The existing `structured_operations.v1` path remains a fallback adapter:

1. emit `run_started`, `turn_started`, and `step_started`;
2. keep the provider's JSON operation contract private to the adapter;
3. emit assistant text only when real user-facing text exists;
4. emit tool facts for actual main-owned read, apply, and check work, not for
   synthetic provider lifecycle labels;
5. emit file and check facts from verified main results;
6. settle step, turn, checkpoint, and run in order.

This adapter may have fewer capabilities. It must not fabricate multi-step
reasoning or native tool calls to make the UI look more agentic.

## Conversation Projection

The ordinary conversation follows these rules:

- streaming text grows inside a stable message node;
- the current real action appears in place, for example `Editing index.html`;
- settled actions change tense, for example `Edited index.html`;
- file edits and commands remain separate rows;
- multiple adjacent actions of the same type may collapse after completion;
- clicking a file row opens the main-issued File or Changes reference;
- clicking a command row opens its read-only command result;
- after completion, detailed history may collapse behind elapsed time while the
  final assistant summary remains visible;
- Ask with no real tools contains no Work details;
- Plan Markdown is complete and directly readable in conversation.

The UI never guesses tool execution from assistant prose.

## Internal Plugin Boundary

Version 1 permits only Builder-shipped registrations:

```text
runtime adapter
tool provider
provider protocol adapter
projection renderer
check profile
```

Every registration has a stable ID, version, declared capabilities, lifecycle,
and conformance tests. Plugins may narrow policy but cannot bypass main's
admission, permission, event, checkpoint, or cleanup authority.

No third-party loading contract is frozen by this document.

## Conformance Tests

Every runtime adapter must pass deterministic fixtures for:

1. Ask with streaming text and no mutation;
2. Plan with complete Markdown and no mutation;
3. Build read -> edit -> command -> complete;
4. failed command -> repair -> successful command;
5. stale edit -> re-read -> successful edit;
6. denied workspace escape;
7. duplicate event delivery;
8. event after terminal state;
9. cancellation with active command and child cleanup;
10. app restart with an interrupted mutating run;
11. automatic checkpoint creation and restore;
12. stable UI projection without whole-page remount or text replacement flicker.
13. provider retry after partial output removes only the failed attempt and
    preserves earlier completed narration.
14. successful Build with byte-identical source settles as a bounded assistant
    response with `checkpoint_status: not_applicable`, no candidate, no check,
    and no checkpoint.

Harness additionally requires a packaged Windows process lifecycle canary.

## Implementation Slices

### Slice 1: Contract And Fake Runtime

- add types and validation for descriptor, admission, events, and terminal
  states;
- build a deterministic fake runtime covering multi-step repair;
- prove event ordering, idempotence, and UI projection.

### Slice 2: Current Runtime Adapter

- map the existing structured path into canonical events;
- remove synthetic user-visible provider lifecycle rows;
- keep current generation behavior as the release fallback.

### Slice 3: Foundational Tool Layer

- implement admitted read, search, edit, write, and command contracts;
- add version-guarded edits, ordered scheduling, cancellation, and result refs;
- connect file and command rows to Side Workspace views.

### Slice 4: Harness Spike

- pin the audited Harness artifact and license evidence;
- implement JSON-RPC framing and event normalization in a dedicated process;
- run the minimal packaged Build canary;
- compare reliability, latency, recovery, and model quality against the current
  adapter before any default switch.

## Implementation Checkpoint: 2026-08-14

The first contract layer now exists in:

- `electron/builder-programming-runtime-contract.cjs`;
- `electron/builder-programming-runtime-events.cjs`;
- `electron/builder-fake-programming-runtime.cjs`;
- `electron/builder-structured-programming-runtime-bridge.cjs`.

It proves descriptor and run admission, append-only canonical event ordering,
runtime-versus-main fact provenance, text delta sealing, paired tool settlement,
deterministic failed-check repair, Plan Markdown, cooperative cancellation, and
structured fallback mapping.

Canonical events can now also be recorded as
`programming_runtime_event_recorded` facts in the SQLite conversation chain.
Conversation replay verifies the nested runtime sequence, previous-event link,
runtime identity, run-contract digest, project, conversation, and run binding.
Duplicate or out-of-order runtime events are rejected before append. The task
stream intentionally hides these internal records until the public activity
projection is complete.

This checkpoint is not yet a product cutover. The current structured Build path
still needs main-owned automatic check orchestration before it can settle one
truthful runtime chain and project it into the ordinary Builder UI. Today the
renderer automatically requests the check only after candidate completion;
that ordering must be replaced, not disguised as a single runtime run.

## Non-Goals

The protocol does not currently define:

- subagent orchestration;
- Code Mode or model-authored tools;
- arbitrary terminal sessions;
- network browsing or deployment;
- public plugin discovery, installation, or compatibility;
- collaboration or remote workspaces;
- autonomous background tasks.

These can be added only after the foundational coding loop is demonstrably
reliable.

## Acceptance Criteria

The protocol has done its job when a user can ask Builder to change a project
and observe one truthful continuous loop:

```text
AI reads the project
-> edits named files
-> runs a named check
-> repairs a failure when necessary
-> summarizes the result
-> leaves changes recoverable and undoable
```

No mandatory `Save Version` step is required for continuation. A formal Version
is an optional milestone action after the working checkpoint already exists.

For a successful Build that produces no source mutation, the runtime and
product terminal states intentionally differ in vocabulary while preserving the
same facts:

```text
runtime: run_completed(outcome=built, checkpoint_status=not_applicable)
conversation: run_completed(result_kind=explanation)
conversation: turn_completed(outcome=responded)
```

This state requires byte-identical admitted source and a non-empty bounded
assistant message. It does not enter candidate projection, Git persistence,
automatic checking, draft creation, or checkpoint creation. Real read/search
tool facts remain visible and restart-restorable.
