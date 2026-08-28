# DeepSeek Harness Adoption Audit

Date: 2026-08-14

## Purpose

This audit evaluates DeepSeek Harness only against Builder's immediate goal:

> Let an ordinary user ask AI to understand a local project, edit code through
> real tools, run checks, repair failures, explain the result, continue, and
> undo safely.

It is not an evaluation of community features, broad automation, subagent
teams, plugin marketplaces, or a complete replacement product.

The implementation direction is owned by
[Foundational Coding Loop And Plugin Runtime Roadmap](FOUNDATIONAL_CODING_LOOP_PLUGIN_RUNTIME_ROADMAP.md).
The Builder-owned runtime seam is defined in
[Programming Runtime Adapter And Event Protocol](PROGRAMMING_RUNTIME_ADAPTER_EVENT_PROTOCOL.md).

## Audited Baseline

Local source:

```text
Repository: D:\DEEPSEEK HARNESS
Upstream: https://github.com/deepseek-ai/deepseek-harness
Branch: master
Commit: 47f943859bef60e4160492346772ded9b24f765a
Version: 0.1.0-rc.5
License: MIT
Audit date: 2026-08-14
```

The upstream README identifies the project as a developer preview and warns
that compatibility-breaking changes will occur. This audit therefore treats
the inspected commit as a research baseline, not a stable compatibility
promise.

Primary inspected sources:

- `docs/architecture.md`;
- `docs/agent-lifecycle.md`;
- `docs/tool-execution-pipeline.md`;
- `docs/subsystems/session.md`;
- `docs/subsystems/persistence.md`;
- `packages/core/agent-loop/src/agent.ts`;
- `packages/core/session/src/types.ts`;
- `packages/core/tools/src/index.ts`;
- `packages/fs/fs-observation-policy/README.md`;
- `packages/sdk/protocol/README.md`;
- `packages/sdk/protocol/src/types.ts`;
- `packages/sdk/server/README.md`;
- `packages/sdk/server/src/server.ts`;
- `packages/sdk/client/README.md`;
- `python/sdk/README.md`;
- `examples/jsonrpc-agent/README.md`;
- `packages/plan/plan-mode/README.md`;
- `packages/interaction/permission-presets/README.md`;
- `packages/shell/pwsh-sandbox/README.md`;
- `packages/sandbox/sandbox-windows-acl/README.md`.

## Executive Decision

Builder should not copy or fork the complete Harness core.

Builder should:

1. adopt the best runtime contracts and invariants;
2. create a Builder-owned adapter and canonical event protocol;
3. test a pinned Harness JSON-RPC runtime as the first external engine;
4. keep the current structured-operations engine as a fallback;
5. selectively port small isolated algorithms only when integration cannot
   provide the required control;
6. retain the option to implement a native Builder tool-loop runtime later.

The recommended relationship is:

```text
Builder product kernel
-> Builder runtime adapter
-> pinned Harness subprocess during the experiment
```

It is not:

```text
Builder UI
-> copied Harness monorepo internals
```

## Experiment Verdict (2026-08-17)

The feasibility experiment is complete and successful.

Harness is no longer only a proposed spike. The bundled Windows application
can select `deepseek_harness.v1` as its default compatible Build runtime and
complete a real multi-step loop through the Builder-owned adapter and tool
broker. The packaged deterministic-provider canary proves project reading,
multiple file writes, an automatic failed check, failure feedback to the same
agent turn, a repair read and version-checked edit, a passing check, a final
response, consecutive Build turns without saving a Version, restart recovery,
checkpoint undo, continuation, and cancellation without accepting a late
candidate or changing the recovered source.

This closes the question "can Harness serve as Builder's coding runtime?" with
**yes**. It does not yet close the separate production-hardening question.
Harness remains a conditionally selected default runtime with
`structured_operations.v1` as the pre-mutation fallback while broader
installed lifecycle and adversarial coverage continues.

The product boundary did not change during the experiment: Builder still owns
project identity, capabilities, tools, durable conversation facts, checks,
checkpoints, undo, Preview, and recovery. Harness owns the model/tool loop
inside one admitted run.

### Approved Plan Context Incident (2026-08-18)

A real installed-app run exposed an integration defect that deterministic
generation had previously hidden. Builder verified and approved a complete Plan
in SQLite, but the Harness Build input contained only the placeholder sentence
`Implement the approved plan.`. On an empty project the real model therefore
searched repeatedly for `README.md`, `plan.md`, `src`, and `package.json`, then
correctly stopped because neither project files nor the approved specification
were present in its admitted context. Candidate projection subsequently reported
an unchanged workspace, which the outer generation layer reduced to a generic
draft failure.

The repaired contract keeps authority in Electron main: the renderer still does
not submit Plan text. Main verifies the current approved Plan against the
conversation event chain, then places that bounded public Markdown inside the
Harness user input under explicit `<approved_plan>` boundaries. The packaged
Plan-mode canary now fails unless both the boundaries and a unique approved Plan
step reach the Harness provider request. The rebuilt package passes with
`approved_plan_context_reached_harness: true`, followed by candidate creation,
continuation without Save Version, automatic checking, and checkpoint Undo.

This establishes a runtime invariant:

> A continuation instruction may reference product-owned context only when the
> verified context itself, or an immutable main-issued reference that the
> runtime can resolve, is included in the admitted runtime input.

Prompt placeholders are not context transport and must never be accepted as
evidence that an approved Plan reached the coding runtime.

## Why Harness Is Relevant

Harness already implements the part Builder currently lacks: a genuine
multi-step agent loop.

One Harness Turn can contain several Steps. Each Step contains one model
request and all tool calls requested by that response. Tool results return to
the model so it can decide whether to read more, repair a failure, run another
check, or finish.

That is the foundational difference between an agent and Builder's current
single structured-result generation path.

## Designs To Adopt Now

### 1. Turn And Step Lifecycle

Harness records:

```text
turn/start
step/start
user/message
assistant/chunk
assistant/message
tool/call
tool/result
step/end
turn/end
```

Builder should adopt the same conceptual split:

- Run: Builder's product-owned execution interval;
- Turn: one admitted user direction and its autonomous continuation;
- Step: one model request plus the tool calls it requested;
- Tool Call: one concrete local action and its result.

This enables real progress, repair loops, cancellation boundaries, replay, and
Codex-like conversation projection.

Builder should not copy Harness event names directly into renderer state. It
should normalize them into Builder's own versioned event protocol.

### 2. Append-Only Model-Visible Log

Harness follows a strong rule: model-visible history derives from one
append-only event log. Raw assistant chunks, assembled assistant messages,
tool calls, and tool results are durable facts.

Builder should adopt the invariant:

> Anything used as model history must be reconstructable from committed
> conversation and runtime events.

This prevents the resumed agent from seeing a different history than the user
saw before restart.

Builder's SQLite conversation chain remains authoritative. A runtime-local
Harness JSONL log may help resume the runtime, but it does not replace Builder
project, permission, checkpoint, or history facts.

### 3. Tool Call Before Execution; Result After Settlement

Harness records `tool/call` before the tool runs and exactly one corresponding
`tool/result` after it settles.

Builder should adopt this pairing because it provides:

- a truthful active row while work runs;
- deterministic completed history;
- replay after restart;
- evidence for files and commands shown in chat;
- a natural boundary for timeout, denial, failure, and cancellation.

The renderer must never invent a tool call from assistant prose.

### 4. Layered Tool Execution Pipeline

Harness separates:

```text
pre-execute policy
-> monotonic guards
-> around-execute concerns
-> tool body
-> post-execute policy
-> result normalization
-> final result observation
```

Builder should adopt a smaller version:

```text
schema validation
-> capability admission
-> workspace and permission policy
-> optional one-shot approval
-> timeout/cancellation wrapper
-> tool execution
-> result normalization
-> durable fact commit
```

The important design is monotonic authority: later plugins may further deny or
annotate an operation but cannot turn a kernel denial into an allow.

### 5. Read-Before-Edit With Version Guards

Harness records whether a file was observed present or absent and uses the
observed version as a compare-and-swap guard for later mutation.

Builder should adopt this immediately:

- editing an existing file requires a prior read observation;
- creating a file requires an observed-absent or create-if-absent guard;
- an externally changed file causes a stale-version failure;
- the model receives a bounded instruction to re-read and retry;
- resumed sessions must re-read before editing when observation state is not
  safely persisted.

This protects user changes better than applying a patch against an assumed old
snapshot.

### 6. Ordered Tool Scheduling

Harness lets explicitly concurrency-safe calls overlap while exclusive calls
form barriers. Results are committed in model order even when read-only work
finishes out of order.

Builder should initially use a simpler rule:

- reads and searches may run in a bounded pool;
- edits, writes, and commands are exclusive;
- calls targeting the same canonical file are serialized;
- result facts commit in model call order;
- cancellation drains every started operation before a run is closed.

This gives predictable behavior without requiring Harness's complete
scheduler.

### 7. Canonical Result Versus Presentation

Harness separates the model-facing typed result from UI presentation metadata.
Tools can describe terminal, read, diff, search, and web render intents without
the UI guessing from tool names.

Builder should adopt this for the foundational tools:

- `read` result can open a File tab;
- `edit` result can open Changes for the exact file;
- `command` result can open a read-only Terminal detail;
- `search` result can open grouped matches;
- the chat row uses the same durable result as replay.

Presentation data remains a projection. It cannot grant source, command, or
checkpoint authority.

### 8. Pure Projection From Durable Events

Harness derives UI trajectory from the session log rather than making UI state
the source of truth.

Builder should continue and strengthen its existing projection approach:

- active events become present-tense rows;
- a matching result replaces the active row in place;
- completed tool rows fold into run history;
- model-authored public text remains in chronological conversation order;
- exact terminal assistant duplicates are suppressed only in presentation;
- replay produces the same visible trajectory;
- projection caches are disposable and rebuildable.

The implemented Builder adapter now preserves Harness text blocks as canonical
`assistant_text_delta` and `assistant_text_completed` events. Main projects a
completed text block as `programming_runtime_assistant_message`; the renderer
does not derive it from tool names or lifecycle phases. Reasoning remains a
separate non-public channel. A packaged Windows canary proves narration before
real tool facts, failed-check repair narration, one final summary, and absence
of the retired fixed `Preparing review` and `Changing files` copy.

### 9. Process Teardown Discipline

The Harness TypeScript SDK client uses a bounded shutdown ladder:

```text
protocol shutdown
-> stdin EOF
-> SIGTERM
-> SIGKILL
```

Builder should adopt the principle, translated to Windows process semantics:

- graceful protocol shutdown first;
- bounded wait;
- terminate the owned process tree;
- confirm exit before reporting cleanup complete;
- keep a bounded stderr tail for diagnostics;
- make close/dispose idempotent.

### 10. Verify The World, Not The Agent's Claim

Harness's testing discipline separates unit tests, real-provider tests,
published-artifact tests, and runtime-path tests.

Builder should keep its stronger product-specific extension of this rule:

- source tests prove contracts;
- package tests prove artifacts;
- packaged canaries prove installed Windows behavior;
- real-provider canaries prove actual model/tool interaction;
- preview and checks prove results independently from assistant prose.

## Designs To Defer

The following Harness capabilities are useful but not required for the first
coding loop:

- subagents;
- Code Mode and generated tool SDKs;
- goal/todo plugins beyond simple internal progress;
- broad provider catalogs;
- arbitrary external plugin loading;
- hook compatibility layers;
- workflow engines;
- telemetry exporters;
- session branching UI;
- plugin dependency composition equivalent to Cordis.

They should not consume implementation priority until the installed Builder
can complete the success criteria in the foundational roadmap.

## Designs Not To Copy As Product Policy

### Plan Is Soft In Harness

Harness Plan mode primarily changes model guidance and tools. It is not itself
the final security boundary.

Builder should retain a hard local rule: a read-only Plan run cannot obtain a
write or command capability regardless of what the model requests.

### Runtime Persistence Is Not Project Authority

Harness can use JSONL or SQLite session persistence. Builder must not let a
Harness session log decide:

- which project is selected;
- which paths are writable;
- whether a checkpoint exists;
- whether a restore is valid;
- whether a formal Version is current;
- whether an external side effect is approved.

### Shell Is Not The Product Center

The SDK example exposes foreground Bash, and its minimal composition can use
danger-full-access tools. Builder targets ordinary Windows users and must keep
commands behind bounded profiles, workspace scope, output budgets, and process
cleanup.

### Full Cordis Adoption Is Not An MVP Requirement

Cordis provides reversible effects and reactive service composition, but
adopting it throughout Builder would be a major architectural migration. The
foundational loop needs replaceable capabilities, not a complete framework
rewrite.

Builder should first implement a small typed internal plugin registry. Cordis
can be reconsidered only after measured experience shows that the smaller
contract cannot support required composition or disposal behavior.

## JSON-RPC Integration Findings

### Current Wire Surface

At the audited commit, the Harness SDK protocol uses newline-delimited JSON-RPC
2.0 over stdio.

Client requests:

```text
initialize
session/prompt
shutdown
```

Runtime notifications:

```text
session.event
session.status
subagent.started
subagent.finished
```

`initialize` binds a process-wide `cwd`, provider, model, and optional
`maxTokens`. `session/prompt` queues identified user content and immediately
returns a `messageId`. `session.status` reports whole-agent `running` or `idle`.

### Important Limitations

The current protocol has:

- no protocol-version negotiation beyond an informational server version;
- no per-turn cancel method;
- no per-session close method;
- no causal assistant-result id for one prompt;
- an `idle` boundary that describes the whole agent, not only one prompt;
- a DeepSeek-specific fallback adapter when no pre-registered provider exists;
- unfiltered notifications for every runtime session, requiring client-side
  session filtering.

These are not minor details. They affect the Builder adapter design.

### MVP Consequence

The first Harness spike should use one Builder-owned Runtime process per active
Builder conversation or one process per admitted run. It must not multiplex
unrelated user projects into one process.

Until Harness exposes safe per-turn cancellation, Builder cancellation means:

```text
stop accepting runtime output
-> request graceful shutdown
-> terminate the owned process tree if needed
-> wait for quiescence
-> reconcile current files with Builder checkpoint facts
-> append run_cancelled or run_failed
```

This is heavier than cooperative cancellation but preserves user control. The
adapter must not claim fine-grained cancel support merely because the internal
Harness tool registry accepts abort signals.

### Implemented Experiment Findings

The first Builder-owned development integration was exercised on Windows on
2026-08-17. The following is observed implementation evidence, not a claim about
the installed product:

- the official Harness source checkout can be prepared as a link-free Node
  runtime carrier without copying Harness source into Builder;
- Builder can resolve a deployed package closure, Harness's official
  source-workspace Node carrier, or a direct package root;
- a real Harness subprocess completes the capability handshake while Builder
  exposes only its bounded `read`, `search`, `edit`, and `write` broker surface;
- a deterministic loopback-provider canary completes two edits around a failed
  check and repair turn, then records a passed check and terminal completion;
- the canary performs six provider requests and requires no external network.

The live protocol also produced bookkeeping events not listed in the initial
source audit: `agent/inbox/spliced` and `session/title`. Builder accepts them for
sequence and deduplication accounting but deliberately does not project them as
user-visible work. They are lifecycle metadata, not evidence that the agent
read, edited, searched, or checked anything.

A 2026-08-20 follow-up audit of Harness's official
[`compaction` subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md),
[`compaction-basic` transaction](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction-basic/src/region.ts),
and [SDK JSON-RPC server](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/server/src/server.ts)
changes the ownership conclusion from "Builder should add automatic
summarization" to "Builder must respect Harness runtime compaction". The SDK
server forwards complete session events without filtering. Harness compaction
uses token-meter pressure, balanced recent-tail retention, optional tool-result
pruning, a model summary, and an append-only start/summary/replacement/end
transaction. These required events are not marked `ignorable`.

Builder now accepts `compaction/prune`, `compaction/start`,
`compaction/summary`, `compaction/end`, and their replacement surface events in
the runtime normalizer. It validates lifecycle ordering and keeps summary text
private. Builder's SQLite summary remains a distinct bounded cross-run product
checkpoint; its event-count cadence is not allowed to control the active
Harness session.

The installed-runtime gate now verifies this against the bundled Harness rather
than only a synthetic event fixture. Its isolated canary policy reports a 20k
model context and crosses the native 90% token-pressure threshold. The real SDK
emits an explicit `surfaceOp: "append"` for ordinary surface messages and a
text-block array for `compaction/summary.data.summary`; Builder now accepts
those upstream shapes directly. One successful summary replacement crosses the
JSON-RPC boundary, the private marker never enters the canonical journal, and
the same runtime continues through the complete edit/check/repair loop. The
production Cordis composition also mounts Harness's own tool-result pruner
ahead of `compaction-basic`; Builder does not implement a competing pruner.

Runtime-level edit tool facts are the correct evidence that Harness requested
and completed an edit. `file_change_recorded` remains a Builder main-process
fact emitted only after authoritative workspace reconciliation; the adapter
must not fabricate it directly from a Harness notification.

The pinned runtime closure is now staged into the Windows package and its
identity is verified during packaging. A packaged desktop UI canary launches
that bundled runtime without the development source checkout. It proves the
initial read/write/check/repair loop and then continues through additional
Build turns, restart recovery, checkpoint undo, external-change conflict
rejection, continuation after undo, and cancellation while the provider holds
a late response. The cancellation boundary records the user's request, closes
the workspace tool session, terminates the owned runtime before committing the
terminal fact, rejects the late candidate, preserves the current checkpoint,
and leaves source bytes unchanged.

The packaged Harness canary passes independently and is included in
`verify:release`. It now also proves a Builder-owned project search followed by
a matching file read and a read-only model answer, with the real search fact
visible in the conversation and no source, candidate, check, draft, or
checkpoint mutation. One 2026-08-17 full serial release run reached this final
canary and encountered an intermittent preview-evidence failure after the
preceding packaged canaries; an immediate independent rerun and the next full
`verify:release` run both passed. Keep the incident as stability evidence to
monitor rather than treating it as missing coding-loop functionality. Real
DeepSeek provider evidence and stale-edit/escape/unsupported-tool coverage
across the installed boundary are now green. The existing timeout canaries prove
deadline enforcement and child-process cleanup only; they do not prove that a
healthy long-running coding loop is admitted correctly. A 2026-08-19 real run
exposed that the provider request timeout was also bounding the complete
Harness run. The healthy long-run gate is therefore reopened until the scoped
timers and liveness tests in
[`PROGRAMMING_RUNTIME_TIMEOUT_AND_LIVENESS_POLICY.md`](PROGRAMMING_RUNTIME_TIMEOUT_AND_LIVENESS_POLICY.md)
pass. Broader update/uninstall and long-project soak evidence remain production
hardening gates.

The packaged experiment also exposed an important adapter rule: canonical
runtime event timestamps must come from the Electron main process observation
clock. Harness runs in a separate child process, so its `Date.now()` value can
legitimately be a few milliseconds ahead of the main process and must not be
used as Builder authority time. Harness source time remains validated and is
used only to calculate tool duration. Main-observed time is used for durable
event ordering, eliminating the intermittent future-dated rejection without
weakening the journal check.

## Source Reuse Assessment

### Legal Boundary

Harness is MIT licensed. Builder may use, copy, modify, and distribute covered
source when the copyright and permission notice are retained in copies or
substantial portions.

Third-party dependencies retain their own licenses and must be reviewed through
Harness's `THIRD_PARTY_NOTICES.md` and Builder's dependency process.

### Technical Boundary

The core agent packages are not isolated copy targets:

- `dsh-agent-loop` has peer dependencies on agent, LLM, scope, session,
  persistence, system prompt, tools, settings, invariants, and Cordis;
- `dsh-tools` depends on agent, code runtime, LLM, session, approval, scope,
  system prompt, invariants, and Cordis;
- session and projection packages also use Cordis and merged type surfaces.

Copying the loop would therefore create a private framework fork, not a small
shortcut.

### Approved Reuse Strategy

Prefer, in order:

1. use the pinned runtime through JSON-RPC;
2. implement Builder-owned contracts from documented behavior;
3. selectively port a small isolated algorithm with attribution and tests;
4. copy a package only after a separate dependency and maintenance review.

Likely selective-port candidates:

- same-file mutation queue;
- ordered read-only/exclusive scheduler;
- read-before-edit state machine;
- pure event projection/reducer behavior;
- process shutdown ladder;
- protocol fixture and malformed-frame test ideas.

Rejected copy targets for the foundational loop:

- complete Agent Loop;
- complete Cordis plugin graph;
- Harness Web UI;
- full persistence stack;
- default shell/sandbox composition;
- subagent and workflow systems.

Any copied source must record:

```text
upstream repository
upstream commit
original path
license notice
local modifications
characterization tests
```

## Builder Advantages To Preserve

Harness is stronger as an agent runtime. Builder has product capabilities that
should remain outside it:

- ordinary-user desktop project selection;
- installed Windows release verification;
- main-owned source and permission authority;
- Browser Preview integrated with the current working state;
- Files and Changes inspection in a side workspace;
- automatic recovery checkpoints tied to product history;
- a conversation designed to explain real work without requiring Logs;
- a future plugin experience that can expose capabilities without making a
  terminal the primary interface.

The integration succeeds only if Builder gains Harness-level coding ability
without losing these product strengths.

## Minimal Harness Spike

The spike includes only:

- one root session;
- one selected disposable project;
- DeepSeek provider route first;
- read, search, edit/create, and one bounded foreground command;
- raw session event capture;
- Builder canonical event translation;
- process shutdown and hard-cancel fallback;
- no subagents;
- no persistent terminal;
- no arbitrary network tools;
- no third-party Harness plugins;
- no formal Version requirement.

Required scenario:

```text
open fixture project
-> ask agent to make a small change
-> agent reads the relevant file
-> agent edits it
-> agent runs a failing check
-> agent repairs the failure
-> check passes
-> final response cites the real work
-> Builder creates a checkpoint
-> user asks for a follow-up without saving a Version
-> user cancels or restores safely
```

## Promotion Gates

Harness may become the default experimental Build runtime only when all gates
pass:

1. pinned artifact identity is verified at package time;
2. installed Windows app launches it without a development dependency;
3. handshake failure leaves the project unchanged;
4. session events translate without gaps or malformed authority fields;
5. file and command UI rows come from real paired tool facts;
6. writes cannot escape the admitted disposable workspace;
7. stale-file mutation fails and the agent can re-read;
8. cancellation reaps the process tree and reconciles file state;
9. restart recovers Builder conversation and checkpoint state;
10. a real-provider packaged canary completes read/edit/check/repair;
11. the current structured runtime still works as a pre-mutation fallback;
12. no Save Version action is required between consecutive Build turns.
13. model-authored public narration interleaves with real tool facts and the
    final assistant summary is not duplicated.

Current status on 2026-08-18:

- passed: 1-10 and 12-13 through source, main-process, packaged deterministic,
  and focused real-provider canaries, including restart, undo,
  external-change conflict, late-output cancellation, and a real DeepSeek
  failed-check repair loop;
- passed in the installed-app adversarial loop: workspace escape is denied
  without context leakage, stale mutation is rejected until re-read,
  unsupported tools are rejected, and the agent safely recovers;
- passed in the packaged failure gate: a held provider request reaches the
  admitted runtime deadline, a live Harness process tree can be force-terminated,
  both failures leave source and candidates unchanged, the failed turn remains
  retryable, the composer recovers, and all runtime/app descendants are reaped;
- retained and passing: 11 remains deliberately available as the pre-mutation
  fallback.

The no-change terminal-state gap is now closed. When a successful Harness Build
returns a byte-identical admitted workspace plus a non-empty bounded assistant
message, the generation runner returns `response_ready` instead of invoking
candidate projection. Electron main reconciles the runtime with
`checkpoint_status: not_applicable`, records the work turn as a durable
`explanation` / `responded` terminal, and returns the original model text to the
chat. It creates no Git candidate, automatic check, draft, or checkpoint and
never claims that files changed. Empty or oversized assistant output, runtime
failure, cancellation, source drift, and malformed completion still fail
closed.

An unsaved draft keeps its immutable candidate and Git evidence, but its
conversation head is a moving concurrency watermark. After a successful
no-change response or project question appends newer conversation events,
Electron main refreshes the cached pending-draft head from the verified replay
before admitting the next continuation. This allows the user to keep working on
the same draft without saving a Version, while an actually stale, regressed, or
forged admission still fails closed.

The default packaged desktop canary now exercises that boundary with a real
project-context Ask after multiple unsaved checkpoint turns. The local provider
fails unless the latest admitted `index.html` and `package.json` reach the
request, then returns an exact project-specific answer. Builder displays the
answer without creating a candidate, changing the saved revision, or discarding
the recoverable draft. This is evidence for Builder's existing Ask path rather
than evidence that Harness should own Ask.

Real-provider evidence on 2026-08-18:

- a focused real-DeepSeek packaged canary completed an explicit Build against a
  synthetic existing project before Version 1;
- the runtime produced two repair turns, eight assistant messages, nine paired
  tool calls/results, a failed automatic check, a repaired edit, and a passing
  second check;
- Builder retained the candidate as a recoverable unsaved checkpoint and did
  not require Save Version;
- `package.json` and `check.js` remained byte-identical to the seeded fixture;
- Builder previously collapsed the terminal Harness failure to a generic runner
  error. The runtime and runner now preserve fixed redacted failure/cause codes,
  with focused tests for host failure and timeout propagation;
- the local real-process deterministic coding loop remains green with 38
  canonical events across initial edit, failed check, repair, and passed check;
- the first successful real run was initially misclassified by a stale canary
  assertion that required the Plan-only `programming_run_admitted` event during
  a direct Build. The assertion now uses actual loop facts: run start/completion,
  narration, tool activity, failed/passed checks, and candidate readiness;
- a later release-package rerun exposed a real adapter gap: Harness emitted its
  known `llm/retry` lifecycle after a transient provider failure, while Builder
  rejected it as an unknown event. The normalizer now validates paired
  `llm/retry` / `llm/retry-started` records, discards only the failed request's
  uncommitted assistant tail, and keeps unknown event types fail-closed;
- the final rebuilt package completed two consecutive real-DeepSeek canaries
  after this repair. Both produced model narration before tools, automatic
  failed-check feedback and repair, a passing second check, and a recoverable
  candidate without Save Version;
- an Auto-mode misroute of a clear modification request is tracked separately
  as intent-routing work, not as evidence against the Harness runtime.

### Reasoning And Public Narration

Harness keeps reasoning, assistant text, and tools as different message parts.
Its native conversation UI presents reasoning as a `Think` disclosure that is
collapsed by default: while running the collapsed row can show the latest line,
and after settlement it keeps a compact first-line summary. Tool calls and
ordinary assistant Markdown remain separate timeline entries.

Builder does not yet implement that complete contract. Its Harness composition
currently disables DeepSeek thinking, and its normalizer accepts text deltas
while ignoring reasoning blocks. Analysis-like paragraphs visible in the chat
are therefore model-authored ordinary text. Builder must not relabel them as
reasoning based on wording. The correct sequence is:

1. add an explicit canonical reasoning delta/completion channel;
2. render it in a default-collapsed disclosure after completion;
3. keep concise public narration visible between tool groups;
4. keep file edits and commands as clickable factual rows;
5. never expose private chain-of-thought as a requirement of the coding loop.

## Final Assessment

The best Harness design is not its size or the statement that everything is a
plugin. Its most valuable contribution to Builder's immediate goal is the
coherent relationship between:

```text
Turn/Step loop
+ append-only model-visible events
+ paired tool calls/results
+ layered policy
+ read-before-edit
+ ordered execution
+ replayable UI projection
```

Builder should adopt those contracts now, test Harness as a replaceable engine,
and defer the rest. That is the shortest responsible path from the current
structured generator to a product where users can genuinely code with AI.
