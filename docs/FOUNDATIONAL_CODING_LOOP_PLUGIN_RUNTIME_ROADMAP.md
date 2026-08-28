# Foundational Coding Loop And Plugin Runtime Roadmap

Date: 2026-08-14
Updated: 2026-08-17

## Authority And Scope

This document defines Builder's current primary implementation direction. It
supersedes older roadmap language that made `Save version` a required final
step after every AI edit.

The immediate product goal is one trustworthy foundational coding loop:

```text
understand the selected project
-> read and search real files
-> edit through bounded tools
-> run relevant checks
-> use failures as repair context
-> explain the result with real tool evidence
-> create an automatic recovery checkpoint
-> continue, review, or undo
```

Formal versions remain available as optional milestones. They are not a gate
between one successful coding turn and the next.

This roadmap also establishes the first practical form of Builder's
"everything is a plugin" direction. Builder will not attempt to reproduce the
full Cordis architecture before the coding loop works. It will build a small,
stable kernel and make concrete capabilities replaceable through typed plugin
contracts.

The source-level DeepSeek Harness decision record is
[DeepSeek Harness Adoption Audit](DEEPSEEK_HARNESS_ADOPTION_AUDIT.md). The
minimum adapter, event, tool, cancellation, and recovery contract is
[Programming Runtime Adapter And Event Protocol](PROGRAMMING_RUNTIME_ADAPTER_EVENT_PROTOCOL.md).

## Product Decisions

### 1. The Coding Loop Comes First

The first release target is not a better structured code generator. It is an
agent that can repeatedly choose and use tools until the requested work is
finished, blocked, cancelled, or out of budget.

A Build run must be able to contain multiple model steps:

```text
model requests file read
-> read result enters model context
-> model requests edits
-> edits are applied and recorded
-> model requests a check
-> failed check enters model context
-> model repairs the failure
-> check passes
-> model writes the final response
```

One provider response containing a complete JSON operations object remains a
fallback adapter, not the target runtime.

### 2. Save Version Is Not A Required Loop Step

Recovery is required. A visible save ceremony after every change is not.

After every successful mutating boundary, Builder must automatically record a
recoverable checkpoint. The ordinary user flow is then:

- continue asking for changes;
- inspect Preview, Changes, Files, or check results;
- undo or restore a checkpoint;
- optionally mark a meaningful milestone as a Version.

`Save version` moves out of the primary completion flow. It may remain in
History or a secondary project action until automatic history and milestone
language are mature.

### 3. Builder Owns The Product; A Runtime Owns The Agent Loop

Builder remains authoritative for:

- selected project identity and admitted workspace root;
- secrets and provider configuration;
- process launch and shutdown;
- permission and policy decisions;
- automatic checkpoint, undo, and restore;
- current working state and formal milestone history;
- Preview, Changes, Files, and user-facing Review;
- packaged Windows release evidence.

A programming runtime may own:

- model request sequencing;
- Turn and Step progression;
- model-visible context assembly inside its admitted run;
- tool-call planning;
- tool-result feedback into later model steps;
- streaming assistant output;
- bounded retry, repair, and compaction behavior.

No runtime or plugin may silently expand its workspace, grant itself a
permission, publish work, select a formal Version, or make an external side
effect outside an admitted capability.

### 4. DeepSeek Harness Is A Candidate Runtime, Not Product Authority

The first integration experiment should use a pinned DeepSeek Harness runtime
through its JSON-RPC subprocess boundary. Builder should not copy the complete
Harness core into this repository and should not import its Web UI.

Reasons:

- Harness already proves a real multi-step tool loop;
- its JSON-RPC SDK is an intended embedding boundary;
- process isolation lets Builder keep its current Electron main authority;
- the runtime can be replaced without rewriting the product shell;
- Harness is still a developer preview and promises breaking changes;
- its core packages are deeply coupled to Cordis and other workspace packages;
- direct source copying would create a long-lived private fork.

The experiment must be removable. `ProgrammingRuntimeAdapter` is the product
contract; `HarnessRuntimeAdapter` is one implementation.

### 5. Plugin Architecture Starts Closed And Typed

The first plugin system is an internal composition system. Built-in plugins use
the same contracts future trusted external plugins may use, but v1 does not
load arbitrary third-party JavaScript into Electron main.

This preserves the architectural direction without making plugin discovery,
signing, marketplaces, dependency resolution, and hostile-code isolation MVP
blockers.

### 6. Builder Is A Shared Workbench For People And Agents

Builder is not only a simplified interface placed in front of an agent. It is
the shared project surface used by a person, the coding agent, and later other
admitted agents. The same working state, file facts, command results, Preview,
checkpoints, and undo history must therefore be understandable and actionable
from both sides.

This is the narrower product advantage Builder should pursue: not a more
general Agent runtime than Harness, but a coding workspace where people and
agents can understand the project, use bounded tools, inspect evidence, recover
from mistakes, and continue creating together.

## Target User Experience

### Ask

Ask may read admitted project context but does not mutate files. It streams the
answer directly without synthetic lifecycle rows such as "Started AI request".

### Plan

Plan may read and search the project. Its complete Markdown plan appears in the
main conversation. Approval can continue into Build, but Plan itself does not
grant write or command authority.

### Build

Build displays only real, useful work:

```text
Reading src/app.tsx
Edited src/app.tsx +18 -4
Running npm test
npm test passed in 12s
```

Active rows change in place from present tense to completed facts. File and
command rows open the corresponding side workspace artifact. On completion,
the detailed trajectory can collapse behind elapsed time while the final
answer and changed-file summary remain visible.

The user can immediately say "continue improving it". No Version action is
required first.

### Recovery

The product keeps recovery quiet but dependable:

- checkpoint creation is automatic;
- the conversation does not receive a card for every checkpoint;
- History exposes restore points;
- Undo reverts both the relevant conversation boundary and file state when the
  checkpoint is valid;
- a formal Version is optional milestone metadata over a stable checkpoint.

Current closure (2026-08-20): History is available as soon as an unsaved draft
has a verified automatic checkpoint, including before the first formal Version.
It separates `Current work` from optional milestone Versions and exposes Undo
through the existing main-owned previous-checkpoint command. The packaged
Harness UI gate verifies the restart-restored recovery row, an enabled Undo
action, at least one earlier automatic checkpoint in a bounded newest-first timeline,
bounded layout, and a nonblank screenshot before exercising conflict-safe Undo.
The timeline is deliberately read-only: selected-checkpoint restore is a
separate workspace-writing command and requires explicit authorization plus
main-side Project, Task Address, current-candidate, Git, and workspace-conflict
checks.

The same closure pass repaired two persistence contract drifts found by the
full boundary suite. Conversation JSONL checkpoints now obtain event-head
integrity evidence from a main-only compaction projection instead of expanding
the public export format. Project Save now accepts and strictly validates the
bounded `current_materialization` evidence returned by current Conversation
replay, so automatic workspace materialization no longer makes an otherwise
verified Version save fail before Git or SQLite admission.

## Architecture

```text
Renderer
  Composer / Conversation / Side Workspace / History
                         |
                         v
Electron Main Product Kernel
  Project Authority
  Runtime Admission
  Permission Kernel
  Conversation Event Store
  Checkpoint / Undo Service
  Artifact Projection
  Plugin Registry
                         |
                         v
ProgrammingRuntimeAdapter
  + structured_operations.v1      fallback
  + agent_tool_loop.v1             target
      + HarnessRuntimeAdapter      first experiment
      + NativeBuilderAdapter       future option
                         |
                         v
Admitted Tool Capability Layer
  read / search / edit / write / command / preview
                         |
                         v
Isolated Working State
  project worktree or Builder-owned draft workspace
```

## Stable Kernel

The following concerns belong to the stable kernel and are not ordinary
plugins:

1. project and workspace identity;
2. run admission and cancellation;
3. append-only conversation event commit;
4. permission decisions and capability tokens;
5. checkpoint, restore, and undo authority;
6. plugin registration, compatibility, and lifecycle;
7. secret isolation and redaction;
8. packaged process cleanup and recovery.

Plugins can contribute behavior around these concerns, but cannot replace their
final authority.

## Runtime Adapter Contract

The adapter should be provider-neutral and small enough to support both the
current generator and a real tool-loop runtime.

```text
ProgrammingRuntimeAdapter
  runtime_kind
  protocol_version
  capabilities()
  start_run(admission, input, event_sink)
  steer_run(run_id, input)
  cancel_run(run_id)
  resume_session(session_ref, event_sink)
  close_session(session_ref)
  dispose()
```

Required capability declarations:

```text
streaming_text
streaming_reasoning_summary
native_tool_calls
steering
cancellation
session_resume
context_compaction
subagents
parallel_tool_calls
```

Capability declarations are facts used by main. The renderer must not claim a
runtime capability or infer one from provider text.

## Canonical Runtime Events

All runtime implementations normalize into Builder-owned events before the UI
or product services consume them.

Minimum event vocabulary:

```text
run_started
turn_started
assistant_text_delta
assistant_reasoning_status
tool_call_started
tool_call_updated
tool_call_completed
tool_call_failed
file_change_recorded
check_result_recorded
step_completed
turn_completed
run_blocked
run_cancelled
run_failed
run_completed
```

Every event requires:

```text
project_id
conversation_id
run_id
sequence
occurred_at_ms
runtime_kind
```

Step and tool events also carry stable `step_id` and `tool_call_id` values.
Events are committed in deterministic model-visible order even when eligible
read-only work executes in parallel.

Raw runtime notifications may be retained in redacted diagnostics, but the
ordinary UI consumes only canonical Builder events.

## Foundational Tool Set

The first closed loop needs a deliberately small tool vocabulary.

### Read

- read a UTF-8 text file from the admitted workspace;
- return bounded content and a content/version identifier;
- record present, absent, binary, too-large, or denied outcomes;
- never accept renderer-supplied absolute authority paths.

### Search

- search file names and text with bounded result counts;
- remain inside the admitted workspace;
- return structured matches suitable for model context and UI projection.

### Edit

- require a prior observed file version for existing files;
- apply an exact patch or structured replacement;
- reject stale writes when the file changed after observation;
- serialize mutations targeting the same canonical file;
- emit changed path and line statistics.

### Write/Create

- create only inside admitted writable scope;
- fail on unexpected existing files unless replacement is explicitly admitted;
- apply protected-path and generated/binary-file policy.

### Command

- use a main-owned command profile or tightly bounded runtime capability;
- enforce cwd, environment, timeout, output budget, and cancellation;
- classify success, test failure, timeout, denial, and infrastructure failure;
- never become a general renderer-controlled shell.

Delete, dependency installation, network access, persistent processes, and
external publication are later capabilities with separate approval policies.

## Tool Pipeline

Each tool call passes through the same product pipeline:

```text
runtime proposes tool call
-> validate schema
-> resolve admitted capability
-> evaluate workspace and permission policy
-> request user approval only when required
-> execute with timeout and cancellation
-> normalize result
-> commit tool facts
-> send canonical result back to runtime
```

Policies are monotonic. A plugin may further restrict a call, attach a warning,
or require approval. It may not turn a kernel denial into an allow.

## Plugin Model

### Initial Plugin Categories

```text
RuntimePlugin       model/tool-loop implementation
ProviderPlugin      provider transport and model catalog
ToolPlugin          typed model-facing capability
PolicyPlugin        additional restrictions or approval requirements
ContextPlugin       read-only model context contribution
CheckPlugin         stack detection and bounded verification command
PreviewPlugin       project preview adapter and evidence collector
PresentationPlugin  renderer for a canonical tool/artifact result
```

### Plugin Manifest

Every plugin declares at least:

```text
plugin_id
plugin_version
api_version
kind
entrypoint
required_capabilities
provided_capabilities
platforms
trust_level
```

The first trust levels are:

- `builtin`: shipped and signed with Builder;
- `local_trusted`: explicitly installed and enabled by the user, later;
- `untrusted`: unsupported until an out-of-process sandbox exists.

### Lifecycle

Plugins receive bounded lifecycle calls:

```text
register
activate
start_session
start_run
stop_run
stop_session
deactivate
dispose
```

Activation and disposal must be idempotent. A failed plugin must not leave an
active process, permission grant, preview server, or source mutation lock.

### What Is Not A Plugin

Do not pluginize ordinary React components, database transaction integrity,
checkpoint authority, secret storage, or arbitrary internal helper functions.
Plugin boundaries exist where a capability must be replaceable, permissioned,
or independently packaged.

## Working State, Checkpoints, And Versions

### Working State

The selected project has one current working state visible to the user. A
runtime may operate in a Builder-owned worktree or draft workspace, but this is
an implementation detail. Files, Preview, Changes, and later runtime steps must
all resolve the same current state.

### Automatic Checkpoint

Builder creates a checkpoint at safe mutating boundaries:

- before the first mutation when needed for undo;
- after a coherent successful mutation step;
- before context compaction or runtime shutdown if recoverable changes exist;
- after a completed run when the current file state differs from its base.

High-frequency internal checkpoints may be coalesced in the UI. Checkpoint
creation must not interrupt the conversation with a save prompt.

### Undo And Restore

Undo is a product operation, not a provider request. It must:

- target a known checkpoint and conversation boundary;
- detect conflicts with newer user/external changes;
- restore through main-owned Git or snapshot services;
- append a new restore fact instead of deleting history;
- leave the project in a coherent state after restart.

Current implemented slice (2026-08-14):

- the automatic checkpoint service can resolve the previous logical checkpoint
  for the current Session/Task address, including repeated backward undo after
  a prior restore;
- the renderer submits only the current `draft_id`; Electron main supplies and
  verifies the selected Project, checkpoint, candidate, Git receipt, and write
  admission;
- undoing the first draft returns to the Project baseline and releases the
  pending draft; undoing later work creates a new recoverable draft from the
  previous verified checkpoint;
- Undo is a direct workspace action, while formal `Save version` is available
  from the secondary action menu.

This slice now provides a renderer-safe automatic-checkpoint timeline and
packaged proof of restart -> conflict-safe undo -> continue. It does not yet
provide redo, arbitrary checkpoint selection, or interactive conflict
resolution. Conflict detection itself is implemented and preserves external
bytes and the current recoverable draft.

### Formal Version

A Version is optional milestone metadata over a stable working checkpoint. It
may be created manually, automatically for an explicit export/release action,
or by a future project policy. It is not required to continue coding.

## DeepSeek Harness Integration Experiment

### Integration Rule

Use a pinned runtime artifact behind `HarnessRuntimeAdapter`. Do not couple
renderer components, product facts, or database schemas to Harness event names.

### Initial Composition

The first experiment should expose only:

- root agent;
- read, search, edit, write/create;
- one bounded foreground command capability;
- session persistence needed for runtime resume;
- context compaction;
- no subagents;
- no arbitrary network tool;
- no persistent interactive terminal;
- no external plugin loading.

Harness receives an admitted disposable worktree or Builder-owned draft root,
never a renderer-provided source path.

### Event Translation

Harness session, assistant, and tool notifications map into Builder canonical
events. Builder stores its own event chain and treats Harness persistence as
runtime recovery data, not Project, permission, checkpoint, or Version
authority.

### Exit Conditions

Do not promote the adapter to the default runtime unless a packaged Windows
canary proves:

1. launch and protocol handshake;
2. real streaming text without UI replacement flicker;
3. read -> edit -> command -> repair -> complete in one run;
4. file and command rows backed by real tool facts;
5. workspace escape is denied;
6. stale-file edits fail and require re-read;
7. cancellation terminates active work and drains child processes;
8. app restart leaves recoverable Builder checkpoints;
9. runtime failure falls back without corrupting the selected project;
10. packaged uninstall/update does not orphan runtime state or processes.

If these conditions fail because of unstable Harness behavior or unsuitable
Windows boundaries, retain the adapter contract and implement the same
canonical protocol in `NativeBuilderAdapter`.

Passing the experiment does not make Harness the product kernel. It permits a
separate decision to make `HarnessRuntimeAdapter` the default coding runtime.
In parallel, Builder should progressively own the smallest durable coding-loop
primitives: multi-step model progression, admitted read/search, read-version
checked edits, tool-result feedback, bounded checks, failure repair, and final
evidence summaries. These capabilities should first be specified as Builder
contracts, then reimplemented or selectively ported as isolated modules when
that reduces dependency and recovery risk. The default is not to copy the full
Harness core.

## Source Reuse Policy

DeepSeek Harness is MIT licensed, so selected source may legally be copied and
modified when the required copyright and license notice is retained.

Engineering policy:

- prefer protocol integration over source copying;
- prefer behavioral reimplementation from documented contracts for small pure
  algorithms;
- copy only isolated modules whose dependencies and ownership are understood;
- record copied file, upstream commit, local modifications, and license notice;
- add characterization tests before changing copied behavior;
- never copy the complete Cordis graph or Harness Web UI into Builder;
- never present copied Harness guarantees as Builder release evidence without
  packaged Builder tests.

Likely candidates for selective study or porting are pure projection rules,
ordered tool scheduling, same-file mutation serialization, read-before-edit
validation, and event normalization tests. The full Agent Loop is not an
approved copy target.

## Migration From The Current Runtime

The current structured operations path remains available during migration:

```text
structured_operations.v1
  one provider request
  one validated operations result
  bounded candidate application

agent_tool_loop.v1
  multiple model steps
  real tools and results
  repair and continuation
```

Both adapters emit the same canonical run events. UI code must not branch on
provider text or Harness-specific notifications.

Migration rules:

- Ask can continue using the current explanation path until runtime streaming
  is proven;
- Plan continues rendering complete Markdown in conversation;
- Build opts into `agent_tool_loop.v1` only through a feature gate during the
  experiment;
- failed adapter startup falls back before any mutation;
- fallback after mutation is forbidden unless the checkpoint and workspace
  state are reconciled first;
- the current JSON operations parser remains a release fallback until the new
  packaged canary is stable.

## Roadmap

### Phase 0: Rebaseline Product Semantics

Deliverables:

- make automatic checkpoint/undo the required recovery behavior;
- remove mandatory `Save version` from the loop definition and canary;
- define Version as an optional milestone;
- record this roadmap as the current authority.

Exit gate:

- architecture documents no longer contradict this product decision.

### Phase 1: Canonical Runtime Protocol

Deliverables:

- `ProgrammingRuntimeAdapter` contract;
- canonical runtime event schemas;
- deterministic event sequencing and validation;
- adapter capability negotiation;
- in-memory fake adapter for lifecycle tests;
- translation from current structured operations into canonical events.

Exit gate:

- Ask, Plan, and current Build can render from canonical events without
  runtime-specific UI branches.

### Phase 2: Foundational Tools And Workspace Guard

Deliverables:

- read and search tools;
- versioned edit and create tools;
- same-file mutation queue;
- bounded command tool;
- common policy pipeline;
- disposable or Builder-owned working root;
- tool presentation payloads for Files, Changes, and command details.

Exit gate:

- deterministic local tests prove path containment, stale-write rejection,
  ordered mutation, timeout, cancellation, and redaction.

### Phase 3: Harness Runtime Spike

Deliverables:

- pinned Harness runtime artifact;
- JSON-RPC process host in Electron main;
- `HarnessRuntimeAdapter`;
- Harness-to-Builder event translation;
- process lifecycle and crash diagnostics;
- feature-gated DeepSeek real-provider path.

Exit gate:

- a development canary completes read -> edit -> check -> repair -> final
  response against a disposable project.

Status: the development exit gate is now satisfied. The feature-gated
`deepseek_harness.v1` path launches a real Harness JSON-RPC process through the
Builder-owned process host and tool broker. A deterministic loopback-provider
canary proves read -> versioned edit -> failed check -> repair turn -> second
edit -> passed check -> final response. The canary uses the real Harness agent
loop but no external network or production model credential.

The experiment also has a repeatable Windows source-checkout preparation step.
`npm run prepare:harness-runtime` deploys Harness's official Node carrier,
restores dependencies omitted by the current deploy output, materializes
workspace links into a link-free closure, and verifies the JSON-RPC entrypoint.
`npm run verify:harness-coding-loop` runs the development loop gate. This is
development evidence only; Phase 6 remains open.

### Phase 4: Automatic Checkpoint And Undo Loop

Deliverables:

- checkpoint before/after coherent mutations;
- undo and restore bound to conversation boundaries;
- restart recovery for active working state;
- History projection for automatic restore points;
- optional milestone Version action outside the primary completion flow.

Status: the main-owned checkpoint loop is implemented and covered by service,
IPC, controller, UI, and packaged-app tests. A packaged Harness run now proves
multiple Build turns without Save Version, restart recovery, undo to the prior
source tree, and continuation after restart and undo. Packaged adversarial
evidence also proves repeated undo and an external-workspace conflict: the
conflicting undo is rejected visibly, external bytes remain unchanged, no false
candidate is created, and the same recoverable draft can be undone after the
conflict clears.
History now receives a separate bounded timeline projection from the main-owned
checkpoint store. The renderer sees no checkpoint/candidate ids, Git OIDs,
digests, SQLite evidence, or restore authority, and the packaged UI gate proves
that an earlier checkpoint remains visible after restart without horizontal
layout overflow.

Exit gate:

- user can complete multiple consecutive Build turns, restart, undo, and
  continue without ever pressing Save Version.

### Phase 5: Codex-Like Conversation Projection

Deliverables:

- live tool rows backed only by real runtime events;
- present-to-past in-place transitions;
- file and command detail opening in the side workspace;
- stable incremental assistant Markdown;
- elapsed-time trajectory collapse after completion;
- queue, steer, cancel, and follow-up behavior.

Exit gate:

- no synthetic lifecycle rows are shown as user work;
- long streaming runs do not remount or visibly flash the stable application
  shell.

### Phase 6: Packaged Runtime Gate

Deliverables:

- Windows packaged runtime bundling;
- launch, update, uninstall, and cleanup behavior;
- real-provider packaged canary;
- workspace escape and stale-write adversarial tests;
- cancellation and restart recovery canaries;
- fallback behavior before mutation.

Exit gate:

- the full foundational loop passes in the installed application, not only in
  source tests.

Status: the feasibility portion of this phase is satisfied. The packaged app
bundles and auto-discovers the pinned Harness runtime, selects it by default for
compatible Build requests, and proves read -> write -> failed check -> repair
-> passed check -> final response. The same packaged scenario proves repeated
Build turns without Save Version, restart recovery, checkpoint undo,
external-change conflict rejection, continuation after undo, and cancellation
that blocks a held late provider response from creating a candidate or changing
source.

Production hardening remains open. The deterministic packaged Harness canary
passes independently and is part of `verify:release`. A dedicated packaged
failure gate now also holds provider output until the admitted runtime deadline
and force-terminates the live Harness process tree. Both paths preserve the
source tree and candidate count, record one retryable failed run without
completing the turn, restore the composer and Retry action, reap the Harness
child, and leave no app descendants after shutdown. The public timeout is the
fixed `builder_generation_timeout` classification; arbitrary subprocess or
provider error text is not exposed.

One full serial run on
2026-08-17 ended in an intermittent preview-evidence failure in that final
canary; the immediate independent Harness rerun and the next complete
`verify:release` run both passed. Keep monitoring this timing edge, but the
current release gate is green. The focused real-provider packaged canary is now
green. A subsequent rerun exposed and then closed an adapter gap around
Harness's known model-retry lifecycle: failed streaming fragments are now
discarded before the retried request continues. Two consecutive real-DeepSeek
packaged loops passed after the fix. The current MVP treats unexpected Harness
exit as a bounded runtime failure and converges through the five-second admitted
deadline; immediate crash recognition requires a future protocol heartbeat or
explicit close notification. Broader installed stale-edit and workspace-escape
evidence remains required.

### Phase 7: Internal Plugin Composition

Deliverables:

- typed built-in plugin registry;
- provider, tool, check, preview, context, and presentation plugin contracts;
- manifest compatibility checks;
- deterministic activation/disposal;
- plugin diagnostics and capability inspection.

Exit gate:

- at least two providers or runtimes and two project check/preview adapters can
  be swapped without changing the core conversation UI.

### Phase 8: Trusted External Plugins

This is post-foundational-loop work.

Prerequisites:

- signed package and provenance design;
- explicit user installation and capability review;
- out-of-process isolation for untrusted code;
- version compatibility and rollback;
- plugin update and removal cleanup;
- release canaries for plugin failure containment.

## Test Strategy

### Contract Tests

- every adapter passes the same lifecycle suite;
- every canonical event validates and replays deterministically;
- duplicate events are idempotent;
- out-of-order or cross-run events fail closed;
- runtime-specific private fields never become UI authority.

### Tool Tests

- workspace traversal and symlink escape denial;
- stale observation rejection;
- same-file concurrent edit serialization;
- command timeout and output budget;
- cancellation before and during mutation;
- secret and binary-file handling;
- tool result ordering under parallel reads.

### Recovery Tests

- crash before mutation;
- crash after mutation but before final response;
- crash during check;
- checkpoint creation failure;
- restart with an incomplete runtime turn;
- undo with newer external file changes;
- optional Version creation from a stable checkpoint.

### Experience Tests

- Ask streams without fake work rows;
- Plan appears as complete Markdown in chat;
- Build exposes real file and command facts;
- active rows update without layout replacement;
- follow-up continues the current working state;
- file and command details open the correct side workspace content;
- checkpoint and Version labels are not repeated across the toolbar and chat.
- the conversation remains the default completed-Run surface and the side
  workspace stays closed until the user requests an inspector;
- live waiting output clears the composer safe area before the first text delta;

### Packaged Tests

- installed Windows app starts the runtime;
- JavaScript, canvas, and WebGL Preview behavior remains isolated;
- runtime and preview child processes are cleaned up;
- restart restores conversation and working state;
- release verification distinguishes source tests, packaged canary, and real
  provider evidence.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Harness RC breaks protocol | Pin artifact; isolate behind adapter; characterize wire behavior |
| Harness process escapes workspace | Disposable worktree plus Builder-owned tool authority and adversarial tests |
| Duplicate persistence systems disagree | Builder event/checkpoint stores stay authoritative; Harness persistence is runtime-local |
| Plugin architecture delays the loop | Internal typed registry only until Phase 7 |
| UI fabricates progress | Render only canonical tool/result facts |
| Automatic checkpoints create noise | Coalesce in UI; retain granular internal recovery facts |
| Undo overwrites external user edits | Version checks and explicit conflict state |
| Runtime dies after editing | Checkpoint working state independently of final assistant response |
| Full source copy creates fork debt | Prefer subprocess integration; selectively port only isolated code |

## Success Criteria

The foundational coding loop is complete only when an installed Builder can:

1. open a real local project;
2. answer a project question without mutation;
3. produce and display a read-only Markdown plan;
4. continue from approval into a tool-driven Build;
5. read and edit multiple files through real tools;
6. run a relevant check automatically;
7. use a failed check to perform at least one bounded repair;
8. show real file, command, and final response events in chat;
9. preview or inspect the resulting working state;
10. accept a follow-up improvement without a Save action;
11. undo to a coherent earlier checkpoint;
12. restart and continue from the recovered project and conversation;
13. deny workspace escape and clean up all child processes;
14. optionally mark a stable checkpoint as a formal Version.

The loop is not complete when only focused unit tests pass, when the provider
returns a plausible summary without real tool evidence, or when the source tree
works but the packaged Windows application cannot prove the same behavior.

## Phase 1 Production Status

The current structured Build path now uses the Phase 1 canonical event contract
in production code, not only in the fake runtime:

1. automatic check selection and execution are coordinated in Electron main;
2. initial Build and unsaved-draft continuation both bind provider dispatch to
   the current run before recording runtime facts;
3. verified candidate operations, automatic checkpoints, and automatic check
   outcomes are translated into the durable SQLite runtime-event chain;
4. the renderer consumes only the bounded task-stream projection;
5. active tool facts replace generic progress, while completed file and command
   facts remain separate and only adjacent repeated kinds collapse;
6. file and command facts open their matching read-only workspace inspectors;
7. canonical runtime facts suppress the older duplicate completion-action rows.

The current `structured_operations.v1` adapter still has an important limit:
the provider returns one complete validated operation set, so its file facts are
recorded after provider completion. It does not yet let the model observe each
tool result or use a failed command as repair input. The feature-gated Harness
adapter now proves that multi-step shape with a real Harness process and a
deterministic local provider. The same pinned Harness runtime is now bundled in
the Windows package. An installed-app UI canary now proves read, four initial
writes, a failed automatic check, failure feedback into the same Harness turn,
a repair read, a version-checked repair edit, a passing second check, final
response, real chat file/command facts, and an unsaved draft without requiring
Save Version. The deterministic repair canary has passed three consecutive
packaged runs, and the focused real-DeepSeek canary now supplies separate
real-provider evidence.
The bundled Harness runtime is now the default Build runtime when no override is
set and the configured provider is compatible. Electron main still owns the
selection: an explicit `disabled` override, a missing runtime, or an incompatible
provider selects `structured_operations.v1` before any Harness mutation begins.
The release gate keeps a dedicated `disabled` canary for that fallback and now
also runs the packaged Harness UI canary without an enablement environment
variable, proving the ordinary-launch default independently.

Current evidence includes passing Harness host, adapter, normalizer, broker,
workspace-tool, artifact-preparation, and packaged-canary tests; passing lint
and TypeScript checks; a safe no-provider handshake; the real-process local
coding-loop canary described in Phase 3; and the packaged failed-check repair
flow above. Canonical event time now comes from the Electron main observation
clock, while Harness source time is retained only for tool-duration evidence.
The Task Stream now also persists model-authored public narration from Harness
text blocks, places it before the corresponding real tool facts, restores it
after restart, omits unsafe narration without losing the activity stream, and
suppresses an exact duplicate terminal summary. The packaged UI canary proves
that behavior and rejects the retired fixed lifecycle copy.

The default packaged desktop canary now also proves success criterion 2 against
the current unsaved working state. Its local provider rejects the request unless
the admitted `index.html` and `package.json` contents reach the Ask prompt, and
returns a project-specific answer only after matching the latest checkpoint
text. The UI must show that exact answer while the pending candidate remains
recoverable and the saved revision, candidate count, and source state remain
unchanged. This closes the former indirect-only project-question evidence; it
does not claim that Ask is routed through Harness.

## Work After The Foundational Loop

The Harness feasibility experiment is finished and the installed foundational
coding loop satisfies the success criteria below. Remaining work is production
hardening and experience refinement, not a missing basic coding-loop stage:

1. keep the credentialed real-provider Harness canary in the explicit
   `verify:release:deepseek` gate and retain fixed redacted diagnostics for any
   provider/runtime failure;
2. retain diagnostics around the observed serial packaged-canary preview timing
   edge and require repeatable complete release runs;
3. broaden the now-passing installed workspace-escape, stale-edit, unsupported
   tool, timeout, runtime termination, child-process cleanup, and late-output
   cancellation scenarios across larger real projects;
4. keep the current structured runtime as a pre-mutation fallback until the
   installed Harness path passes every promotion gate;
5. broaden installed-app visual coverage for long narration, multiple adjacent
   tool batches, and completed-history folding without reintroducing lifecycle
   status rows.

Do not start by copying Harness source, replacing SQLite, opening arbitrary
shell access, or building a public plugin marketplace.

## 2026-08-18 Real-Provider Admission Update

The focused real-DeepSeek packaged canary now passes with an explicit Build
route, a controlled existing project, an initial failing check, bounded repair,
and no formal Version requirement. It proves real Harness model narration,
paired read/edit tool facts, failed-check feedback, repair, a passing second
check, candidate recovery without Save Version, and unchanged protected fixture
files. One earlier successful loop was held open by a stale canary condition
that incorrectly required the Plan-only `programming_run_admitted` event during
a direct Build; the gate now waits on actual run, tool, check, and candidate
facts. Broader production hardening remains open, but real-provider feasibility
is no longer the blocker.

The runtime failure path now preserves only fixed, redacted diagnostic codes
from the Harness programming runtime through the generation runner. It does not
retain provider response bodies, prompts, credentials, or arbitrary exception
messages. Targeted tests prove host failure and timeout classification, and the
source-level real-process deterministic loop still passes read -> edit ->
failed check -> repair -> passed check with 38 canonical events.

An installed approved-Plan run found a separate input-contract defect: the
verified Plan existed in Builder's conversation chain, but Harness received only
`Implement the approved plan.`. The real model could not infer the missing Plan
from an empty project and ended without a file change. Electron main now embeds
the verified public Plan Markdown in the admitted Harness input; renderer input
remains non-authoritative. The packaged Plan-mode canary inspects redacted
booleans rather than storing the prompt and proves that the Plan boundaries and
a unique approved step reached Harness before the Build succeeded.

Approved continuation is therefore subject to the following acceptance rule:

```text
verified current Plan in SQLite
-> main-owned bounded runtime input
-> Harness provider request contains approved Plan context
-> real tool loop may begin
```

A generic instruction that merely refers to "the approved plan" does not satisfy
this gate.

Two separate gaps must not be conflated with Harness adoption:

1. Auto intent routing can still classify an explicit project modification as
   Ask. The canary selects Build explicitly so runtime evidence is not confused
   with a routing failure.
2. Long model text previously amplified desktop work because each small Harness
   chunk was durably recorded and could trigger projection/render work. The
   runtime normalizer now coalesces small chunks up to a bounded byte threshold,
   paragraph boundary, tool boundary, or message completion. Renderer frame
   batching remains in place; longer real-project soak testing is still needed.
3. Harness model-request retries are now treated as a typed lifecycle rather
   than ignored noise. A retry removes only the failed request's uncommitted
   live tail, preserves prior completed narration, and remains replay-safe.
4. Completed Build runs with byte-identical source now settle through the
   first-class no-change response path. Builder preserves the model's useful
   explanation and real read/search facts, records the work turn as
   `responded`, and creates no candidate, check, draft, or checkpoint. This is
   covered by focused runtime/SQLite/controller tests and the packaged Harness
   UI canary.
5. The packaged no-change run now proves the complete read-only discovery path:
   Harness searches the admitted project through the Builder-owned `grep`
   adapter, reads the matching `index.html`, shows the real search/read facts in
   chat, and returns a useful answer without changing source, candidates,
   checks, drafts, or checkpoints.

Reasoning, public narration, and tool facts are distinct contracts. Harness's
native conversation UI renders reasoning in a dedicated `Think` disclosure,
collapsed by default, while ordinary text and tool calls stay in the timeline.
Builder currently disables DeepSeek thinking for this runtime and ignores true
reasoning blocks. Therefore analysis-like prose visible in Builder today is
ordinary assistant text, not a verified reasoning event. Before adding a
collapsed reasoning UI, Builder must first normalize explicit reasoning events;
it must not guess from prose.

## 2026-08-18 Foundational Loop Completion Audit

The installed Windows application now proves every item in `Success Criteria`:

- project question and complete Markdown Plan paths remain read-only;
- approved Plan context is carried by Electron main into the Harness Build;
- the default compatible Build runtime performs real search, read, create,
  version-checked edit, automatic check, failed-check feedback, bounded repair,
  and final model-authored summary;
- file, search, command, and final response facts appear in the conversation and
  open the corresponding read-only inspection surfaces;
- multiple Build turns continue from the recoverable working checkpoint without
  Save Version;
- restart, undo, external-change conflict, cancellation, workspace escape,
  stale edit, unsupported tool, timeout, crash, and child cleanup paths fail
  closed;
- Preview/Files inspection and optional formal Version creation remain Builder
  product capabilities outside Harness authority.

The deterministic packaged Harness UI canary now includes a search -> read ->
read-only answer turn and reports `real_search_fact_visible_in_chat: true` while
preserving source, candidate, and check counts. The focused real-DeepSeek
packaged canary separately proves the same adapter against a real provider for
the mutating read/edit/check/repair path.

This completion statement is intentionally narrow. Auto semantic routing,
long-project soak performance, conversation loading polish, richer reasoning
disclosure, side-workspace tab interaction, and parallel-task presentation are
valuable follow-up work, but they are not prerequisites for the foundational
AI coding loop defined by this roadmap.
