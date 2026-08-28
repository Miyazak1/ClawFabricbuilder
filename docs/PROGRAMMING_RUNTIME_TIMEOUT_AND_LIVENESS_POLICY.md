# Programming Runtime Timeout and Liveness Policy

Status: active implementation authority; timeout/liveness separation, persistent
process supervision, packaged interrupted-work recovery, release evidence, and
real-provider long-run qualification complete

Date: 2026-08-19

## Purpose

This document defines how ClawFabric Builder supervises long-running coding
work. It replaces the current accidental policy in which one provider request
timeout can also terminate an entire multi-step programming run.

The immediate goal is narrow: a healthy AI coding loop must be allowed to read,
search, edit, run checks, repair failures, and summarize for as long as it is
making valid progress. Builder must still detect genuinely stalled work, bound
individual capabilities, stop owned processes, preserve recoverable changes,
and report the real reason a run stopped.

This policy applies to every `ProgrammingRuntime` implementation. DeepSeek
Harness is the first runtime that exposes the bug, but the policy belongs to
Builder rather than to a Harness-specific adapter.

## Decision Summary

Builder shall use separate time boundaries for separate responsibilities:

1. **Provider attempt policy** may bound one model request attempt when a
   provider protocol requires an absolute request deadline; a streaming
   adapter does not receive one by default merely for uniformity.
2. **Model stream idle timeout** detects a response stream that has stopped
   producing valid transport activity.
3. **Tool timeout** is owned by the tool or capability being executed.
4. **User-wait time** is paused while Builder is waiting for approval or an
   answer from the user.
5. **Runtime liveness supervision** detects a child runtime that is neither in a
   known wait state nor producing validated activity.
6. **Run absolute limit** is a wide emergency ceiling, not the normal way a
   coding turn ends.
7. **Step, token, and output budgets** remain independent loop controls.
8. **User cancellation** can stop a run immediately and is never reported as a
   timeout.

The provider configuration field `timeout_ms` must not be reused as a complete
programming-run duration or as the timeout for the whole JSON-RPC
`session/prompt` lifecycle.

## Implementation Status

Implemented on 2026-08-19:

- `builder-programming-runtime-supervision-policy.cjs` owns a 60-minute
  emergency run ceiling, five-minute runtime inactivity boundary, and separate
  initialize/shutdown limits;
- Harness JSON-RPC uses method-specific request limits and does not put a
  protocol timer around `session/prompt`;
- provider `timeout_ms` no longer becomes the complete programming-run limit;
- accepted normalized runtime activity rearms the inactivity watchdog;
- an active tool suspends runtime inactivity supervision while the tool owns
  its own deadline;
- runtime inactivity and the emergency run ceiling have distinct terminal
  classes, main-owned public codes, conversation outcomes, and user copy;
- Harness process supervision converges child `exit`, `close`, and `error`
  signals so a crashed Windows child rejects an in-flight prompt even when an
  inherited stdio handle delays `close`;
- the process host keeps a main-owned liveness probe active for the complete
  runtime lifecycle, including after `session/prompt` has acknowledged;
- the process host publishes one idempotent termination signal and the runtime
  races that signal against prompt completion and normalized event settlement,
  so a dead Harness cannot leave the UI waiting forever;
- the packaged Harness UI canary uses a two-second provider timeout setting and
  proves that a healthy, progressing 13.2-second multi-step run is not cut off;
- packaged failure canaries separately classify semantic inactivity as
  `builder_generation_runtime_stalled` and process disappearance as
  `builder_generation_failed`, preserve source before work starts, recover the
  composer, and reap the owned process tree;
- every admitted Harness `edit` or `write` records a Builder-owned workspace
  snapshot, and a non-cancelled runtime interruption now returns that final
  trusted snapshot instead of replacing it with `null`;
- when the interrupted snapshot differs from the admitted base, the Harness
  runner projects it through the normal Builder candidate contract and the main
  service performs the existing workspace guard, Git candidate verification,
  and automatic draft checkpoint recording;
- an interrupted candidate is explicitly left unchecked: Builder does not run
  the automatic check or repair loop against a terminated Harness session and
  does not claim that checks passed;
- packaged interruption after verified file writes now produces an unchecked,
  recoverable checkpoint; after app restart the user can Continue, Review, or
  Undo without first using Save Version;
- the complete `npm run verify:release` gate passed after all timeout,
  process-lifecycle, interrupted-checkpoint, and canary changes.

Real-provider release qualification completed on 2026-08-19:

- a non-default packaged DeepSeek soak completed in `150962 ms`, beyond the old
  120-second complete-run boundary;
- the artificial project used one 90-second main-owned check under its normal
  120-second command profile, retaining explicit capability-owned evidence for
  the long operation rather than borrowing the runtime-idle limit.

### Validation evidence

Final local release evidence on 2026-08-19:

- Vitest: 48 files and 866 tests passed;
- Node boundary suite passed after final soak instrumentation with 1,734 tests
  passed, 1 skipped, and zero failures;
- packaged app identity and bundled Harness runtime verified across 979 ASAR
  entries;
- default packaged conversation/checkpoint/Undo/restart canary passed;
- packaged Plan-mode and approved-plan continuation canary passed;
- packaged Harness coding-loop UI canary passed, including real reads, writes,
  automatic check repair, narration, cancellation, file opening, Undo, and
  restart recovery;
- deterministic Harness streaming continued for 13,155 ms with a configured
  provider timeout of 2,000 ms and completed successfully;
- the opt-in real-provider packaged soak used the verified saved DeepSeek
  profile and completed the coding loop in `150962 ms` with automatic checks
  passing;
- the soak created all 11 required non-empty modules plus the admitted
  `index.html` update, while leaving `package.json` and `check.js` unchanged;
- its Harness session retained 10 assistant messages, 18 tool calls, 18 matched
  tool results, and one balanced turn; public narration preceded tool facts;
- the resulting candidate remained recoverable from its automatic checkpoint
  without requiring Save Version;
- silent-runtime failure became visible in approximately 8.54 seconds under a
  canary-owned 10-second idle policy;
- an externally terminated Harness process became visible in approximately
  2.13 seconds and was classified as a runtime failure rather than inactivity;
- both failure cases preserved source, created no candidate, retained the
  retryable turn, recovered the composer, and reaped the process tree.

Packaged interrupted-work recovery evidence in that release gate:

- the process was terminated only after verified writes had changed the
  Builder-owned workspace snapshot;
- the changed snapshot passed the normal workspace guard and Git candidate
  verification before one automatic checkpoint was recorded;
- the checkpoint remained explicitly unchecked because the terminated runtime
  could not truthfully complete its automatic check;
- restart restored the checkpoint and exposed Continue, Review, and Undo;
- formal Save Version was not required to recover, inspect, continue, or undo.

The deterministic packaged evidence proves the Builder policy and recovery
contract without external API use. The separate opt-in real-provider soak now
also proves that a healthy DeepSeek coding run can cross the former 120-second
boundary and complete under the same packaged product runtime.

## Defect That Prompted This Policy

Before this implementation slice, the Harness integration conflated three
different scopes.

`electron/builder-generation-main-service.cjs` constructed the run contract
with:

```js
max_duration_ms: providerConfig.timeout_ms
```

`electron/builder-harness-runtime-composition.cjs` also constructed the Harness
process host with:

```js
request_timeout_ms: entry.provider_config.timeout_ms
```

`electron/builder-harness-programming-runtime.cjs` then armed one timer for that
`max_duration_ms` around the complete `host.prompt()` plus runtime settlement.

The result is one provider setting simultaneously acting as:

- a model-request budget;
- a JSON-RPC request budget;
- a multi-step coding-run budget.

Those scopes are not equivalent. One programming run may contain many provider
requests and many tool calls.

### Real failure evidence

On 2026-08-19, a real packaged Harness run was terminated after `120,733 ms`:

- it had reached step 17;
- it had produced 145 normalized runtime events;
- it was still producing assistant text immediately before termination;
- it had already performed real reads, searches, and edits;
- the terminal runtime failure was classified as `timeout`;
- Builder then recorded an interrupt and displayed the generic message
  `The draft could not be made. Try again.`

This was not user cancellation, provider silence, a hung child, or an idle
agent. Builder interrupted healthy work at the provider-configured 120-second
wall-clock boundary.

This evidence invalidates any claim that the existing timeout gate proves
long-run correctness. Existing tests prove that Builder can terminate and reap
a held process. They do not prove that a progressing run is admitted for an
appropriate duration.

## Reference Product Research

Research was performed against public documentation and current open-source
implementations on 2026-08-19.

### Codex

Codex separates command execution, provider stream liveness, cancellation, and
background-agent runtime:

- command execution has a per-command timeout and may explicitly disable it;
- provider streams use an idle timeout rather than a complete turn deadline;
- stream reconnect retries are independently bounded;
- background agent jobs may have their own maximum runtime;
- no public normal foreground-turn setting was found that binds a complete
  coding turn to one provider request timeout.

References:

- <https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs>
- <https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>
- <https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json>

### Claude Code

Claude Code also exposes separate controls:

- API request timeout: 10 minutes by default;
- Bash command timeout: 2 minutes by default;
- model-requested Bash maximum: 10 minutes by default;
- MCP tool execution has its own much wider budget;
- long commands can run in the background;
- transient provider failures are retried separately from tool execution.

References:

- <https://code.claude.com/docs/en/env-vars>
- <https://code.claude.com/docs/en/errors>
- <https://code.claude.com/docs/en/interactive-mode>

### OpenCode

OpenCode's main prompt loop continues while tool work remains. Its agent step
limit is optional and defaults to `Infinity`. When a configured final step is
reached, the model receives a last-step instruction so it can conclude. Shell
execution has its own timeout. The complete loop is not timed by the shell or
provider request setting.

Reference:

- <https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt.ts>

OpenCode has also experienced real stream-stall and retry-loop defects. Builder
should adopt the separation of scopes, not copy its implementation blindly.

### Pi

Pi's agent loop receives an `AbortSignal` and continues until the model stops,
tool results terminate the batch, policy stops the loop, or the caller cancels.
Bash owns a separate command timeout. Current Pi documentation gives Bash a
300-second default, a bounded override, and an explicit no-deadline mode for
appropriate calls.

References:

- <https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts>
- <https://github.com/earendil-works/pi>

### DeepSeek Harness

The audited local Harness checkout is commit
`47f943859bef60e4160492346772ded9b24f765a`.

Its agent-loop documentation explicitly states:

```text
No built-in turn budget
```

Harness instead separates:

- model-stream idle supervision through a rearmable `idleWatchdog`;
- capability-owned tool timeouts;
- Bash process-group termination;
- user or parent cancellation;
- plugin-owned loop policy;
- process teardown and quiescence.

Relevant upstream paths:

- `packages/core/agent-loop/README.md`
- `packages/util/timeout/README.md`
- `packages/shell/bash-local/README.md`
- `.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md`

The current DeepSeek adapter resolves `streamIdleTimeoutMs` per operation,
defaults it to `300,000 ms`, and passes one fused `AbortSignal` to both the
initial `fetch()` and every subsequent SSE read. Each accepted stream item
rearms the watchdog. It does not add an absolute wall-clock deadline over a
healthy streaming request. Its retry policy is separately resolved and owned
by the model-request recovery layer.

Builder therefore pins `streamIdleTimeoutMs: 300000` in
`electron/harness/builder-coding-loop.cordis.yml`. This makes the product
policy explicit without forking Harness or converting the idle watchdog into
a total request timer.

The Harness design is direct evidence that the old 120-second complete-run
deadline belonged to Builder's adapter, not to Harness.

## Time Boundary Vocabulary

Builder must use the following terms consistently in code, events, diagnostics,
and tests.

### Provider attempt

One outbound model request and its response stream. A retry is a new attempt
and must be recorded as such.

It is not a programming run.

An adapter may define an absolute attempt deadline when required by the
provider protocol or a non-streaming transport. For the current Harness
DeepSeek streaming adapter, Builder deliberately applies no default absolute
attempt deadline: stream silence, cancellation, bounded retry, runtime
liveness, and the emergency run ceiling are the applicable boundaries.

### Model stream idle interval

The maximum interval during which a model transport may produce no validated
data or accepted keep-alive activity while Builder is actively waiting for the
next stream item.

It is a sliding liveness window, not a total request duration.

### Tool call

One admitted capability invocation such as read, search, edit, write, command,
or check. Its timeout and hard-stop mechanism belong to that capability.

### Programming run

One user-directed Ask, Plan, or Build execution. A Build run can contain many
model attempts, steps, tool calls, check runs, and repairs.

### User wait

A state in which progress requires an approval, answer, permission decision, or
other explicit user action. User wait does not consume model-idle or
runtime-idle budget.

### Runtime idle interval

A period during which the runtime is expected to make progress but Builder
receives no validated activity and no capability-owned wait is active.

### Absolute run limit

A final emergency ceiling over one foreground run. It protects against an
unexpected endless-but-active loop. It must be wide, independently configured,
and must preserve recoverable work when reached.

## Required Default Policy

The first implementation should use these main-owned defaults:

| Boundary | Default | Owner | Reset behavior |
|---|---:|---|---|
| provider request attempt | provider-specific; no absolute default for Harness DeepSeek streaming | provider adapter | new attempt |
| model stream idle | 5 minutes | provider adapter | valid chunk or accepted transport keep-alive |
| Harness initialize/handshake | 30 seconds | Harness process host | never; one protocol operation |
| foreground Bash/command | capability profile | command runtime | new tool call |
| automatic check | check command profile | CheckRun runtime | new check attempt |
| user approval/answer wait | no elapsed deadline | permission/conversation owner | resumes after decision |
| runtime semantic idle | 5 minutes | programming runtime supervisor | validated semantic progress, subject to phase rules |
| complete foreground run | 60 minutes | programming runtime supervisor | never; emergency ceiling |
| process shutdown grace | 5 seconds before escalation | process host | each shutdown stage owns its wait |

The values above are product policy defaults, not renderer settings and not
provider capabilities. Advanced provider configuration may adjust provider
attempt behavior, but it cannot silently shorten the complete programming run.

The 60-minute absolute ceiling is intentionally longer than an ordinary coding
turn. A product surface may later support explicit background tasks with a
different policy, but must not make the foreground limit shorter by reusing an
unrelated setting.

## Phase-Aware Liveness State Machine

A single sliding timer over every runtime phase is still incorrect. For
example, a valid ten-minute test command may be silent for more than five
minutes. The runtime supervisor must know what it is waiting for.

```text
starting
  -> waiting_for_model
  -> running_tool
  -> waiting_for_user
  -> settling
  -> completed | failed | cancelled | limited
```

### `starting`

- governed by the Harness handshake timeout;
- child spawn failure and protocol initialization timeout are infrastructure
  failures;
- no source mutation may be accepted before admission and handshake complete.

### `waiting_for_model`

- a provider-specific attempt deadline applies only when the adapter declares
  one; model-stream idle policy always applies to the Harness DeepSeek stream;
- valid assistant deltas, reasoning deltas, tool-call deltas, accepted SSE
  keep-alives, and explicit retry lifecycle events update the appropriate
  provider liveness clock;
- malformed JSON, unknown event types, duplicate frames, stderr bytes, and raw
  child-process output must not extend semantic liveness.

### `running_tool`

- the admitted tool owns its timeout and termination mechanism;
- the generic five-minute runtime idle timer is suspended while an identified
  tool call is still inside its valid capability deadline;
- tool progress may update presentation but does not change the tool's absolute
  capability deadline unless that tool contract explicitly defines sliding
  idle semantics;
- the tool must produce exactly one terminal result fact.

### `waiting_for_user`

- provider, runtime-idle, and tool clocks are not charged;
- the run remains recoverable and cancellable;
- restart recovery must reconstruct the pending interaction from durable
  Builder facts.

### `settling`

- bounded by a short internal settlement/shutdown policy;
- no new model or tool work may start after terminal settlement begins;
- started capability work must drain or be explicitly terminated before the
  run is reported closed.

### Absolute ceiling

The 60-minute absolute run timer continues across model and tool work. It may be
paused during a durable user-wait state so a lunch break does not destroy a
valid task. When it wins:

- the terminal class is `run_limit_reached`, not provider timeout;
- Builder requests cooperative cancellation;
- the process host performs its bounded shutdown ladder;
- already admitted file changes are reconciled into a recoverable checkpoint;
- the conversation offers Continue, Review, and Undo when those actions are
  valid;
- Builder does not claim the project failed to generate from scratch.

## Valid Liveness Evidence

Only main-validated facts can extend liveness.

### May extend model/runtime liveness

- normalized assistant text or reasoning delta;
- normalized tool call requested;
- normalized tool result completed or failed;
- validated model retry started or completed;
- validated Harness status transition;
- a main-owned check progress event;
- an accepted protocol keep-alive for the model transport only.

### Must not extend semantic liveness

- arbitrary child stdout or stderr bytes;
- malformed or unknown notifications;
- duplicate notification sequence numbers;
- renderer events, animation frames, polling, or tab activity;
- provider prose claiming progress without a normalized event boundary;
- raw network bytes that the protocol parser rejects;
- repeated unchanged status snapshots.

Transport keep-alives may prevent a model socket idle timeout, but they do not
by themselves prove useful Agent progress for the complete-run policy.

## JSON-RPC Process Host Policy

The process host uses method-specific request supervision. Setup and teardown
remain tightly bounded, while a programming prompt is supervised by Builder's
runtime liveness and absolute-run policy rather than by provider configuration.

Required behavior:

| Method | Policy |
|---|---|
| initialize/handshake | short fixed timeout, default 30 seconds |
| session create/resume | bounded setup timeout |
| session prompt | supervised by programming-run liveness and absolute policy; never by provider `timeout_ms` |
| shutdown | short graceful timeout followed by EOF, terminate, and kill escalation |

The JSON-RPC peer may implement a prompt request ceiling slightly beyond the
main-owned absolute run limit as a final leak guard. That ceiling must not be
the primary run timer and must never be shorter than the runtime supervisor's
policy plus cleanup grace.

Notifications may refresh a pending prompt's liveness only after the runtime
normalizer accepts them. The peer must not blindly treat every received line as
progress.

### Child process termination signals

Process exit and stdio closure are related but are not interchangeable. On
Windows, the child may emit `exit` while `close` is delayed because a descendant
or inherited handle still owns one of the stdio pipes. Waiting only for `close`
can therefore leave `session/prompt` pending after the runtime has already
crashed.

The process host must:

- converge child `exit`, `close`, and `error` into one idempotent terminal path;
- close the JSON-RPC peer as soon as any terminal process signal proves the
  runtime can no longer complete the request;
- supervise the exact PID for the complete hosted runtime lifecycle, including
  after a prompt request has acknowledged but before normalized settlement;
- expose one main-only termination promise that settles on child exit, close,
  error, forced close, or confirmed PID disappearance;
- race that termination signal against both `session/prompt` and the runtime
  event normalizer's terminal settlement; prompt acknowledgement alone is not
  proof that the process remains alive or that the programming run completed;
- use PID disappearance only as a crash signal, never as progress;
- reject every pending request with a fixed runtime failure classification;
- retain a numeric exit code when the operating system provides one;
- keep graceful shutdown bounded by either `exit` or `close`, then escalate to
  process-tree termination when neither arrives;
- never restore a whole-prompt wall-clock timeout merely to mask missing child
  lifecycle handling.

Packaged failure evidence must distinguish a host-process crash from semantic
inactivity. A host crash converges immediately through process signals, the
persistent termination promise, or PID disappearance. A live process that
stops producing accepted semantic progress converges through runtime idle
supervision instead. The two cases have different diagnostics even though both
must recover the composer and reap the owned process tree.

## Capability-Owned Timeout Rules

### Model provider

- `provider_config.timeout_ms` must not be inferred to mean a complete run or
  automatically forwarded as a streaming request wall-clock deadline;
- an absolute provider-attempt deadline is an explicit adapter capability, not
  a cross-provider default;
- the current Harness DeepSeek adapter uses a five-minute sliding stream-idle
  watchdog and no absolute deadline while valid chunks continue;
- provider timeout, authentication failure, balance failure, rate limiting, and
  service overload remain distinct diagnostics;
- retry policy is bounded and recorded;
- a retry starts a new attempt budget but does not reset the complete-run
  absolute ceiling.

### Read, write, and edit

Local file operations do not receive arbitrary wall-clock kill timers. Their
safety comes from path admission, bounded bytes, opened-handle identity,
read-before-edit version checks, atomic publication, and cancellation checks at
safe boundaries.

### Search

Search owns a bounded execution and output policy. If backed by an external
process, its implementation must terminate the owned process tree when its
deadline wins.

### Command and automatic check

- each command profile declares its own timeout and output budget;
- a check timeout is a check result, not a whole-run provider failure;
- the model receives the timed-out command result and may choose a safer retry,
  narrower check, or final explanation;
- long-lived servers should use an explicit background-job contract rather
  than an arbitrarily huge foreground wait;
- process-group or process-tree cleanup must complete before the tool result is
  terminal.

## Terminal Classification

Builder must preserve the actual scope that stopped work.

```text
provider_attempt_timeout
model_stream_idle_timeout
tool_timeout
runtime_idle_timeout
run_limit_reached
user_cancelled
permission_denied
stale_workspace
runtime_crash
protocol_failure
check_failed
```

These classes may map to a smaller renderer-safe vocabulary, but main-owned
diagnostics and tests must retain the distinction.

`timeout` alone is insufficient because it cannot tell the user or agent what
can safely be retried.

## Recovery And Checkpoint Semantics

Timeout is not permission to discard valid work.

When any non-destructive runtime boundary stops a Build:

1. stop new dispatch;
2. cancel or drain started work according to its owner contract;
3. reap the owned child process tree;
4. compare the admitted runtime workspace with the last Builder checkpoint;
5. preserve verified changes as a recoverable checkpoint when safe;
6. record the terminal run fact and its exact failure class;
7. allow Continue, Review, or Undo from durable Builder state;
8. never require Save Version merely to recover or continue.

If workspace reconciliation cannot establish trustworthy file state, Builder
must fail closed and explain that the work needs review. It must not silently
promote uncertain changes.

## User Experience Contract

Ordinary users should see the consequence and next action, not internal timer
names.

Examples:

| Internal class | User-facing message |
|---|---|
| provider attempt timeout | `The AI service took too long to respond. Retrying is safe.` |
| model stream idle timeout | `The AI service stopped responding. Your project changes are preserved.` |
| tool timeout | `The project check took too long. The AI can retry with a narrower check.` |
| runtime idle timeout | `编码运行已停止继续推进；停止前完成的改动已保留，可检查后重试。` |
| run limit reached | `本轮运行时间较长，已暂停；暂停前完成的改动已保留，可继续检查或重试。` |
| user cancelled | `Stopped. Changes made before stopping are available to review or undo.` |

The generic message `The draft could not be made. Try again.` must not be used
when Builder knows a more actionable classification.

The conversation should retain the real tool and narration history preceding
the stop. A terminal warning is appended after that history; it must not replace
or erase it.

## Implementation Slices

### Slice 1: Decouple configuration scopes

- stop assigning `providerConfig.timeout_ms` to
  `run_contract.admission.limits.max_duration_ms`;
- define main-owned runtime supervision policy;
- retain an absolute provider timeout only for adapters whose explicit
  protocol contract defines one;
- keep `max_steps`, token limits, and output limits independent.

### Slice 2: Method-specific process-host timeouts

- replace the one-size JSON-RPC request timeout;
- keep short handshake and shutdown bounds;
- let `session/prompt` settle under runtime supervision;
- preserve idempotent close and process-tree cleanup.

### Slice 3: Phase-aware liveness supervisor

- track `starting`, `waiting_for_model`, `running_tool`, `waiting_for_user`, and
  `settling`;
- arm only the timer valid for the current phase;
- refresh liveness only from normalized accepted evidence;
- ensure unknown or malformed input fails closed without extending timers.

### Slice 4: Recovery-aware terminal handling

- add exact terminal classifications;
- reconcile partial file changes;
- preserve recoverable checkpoints;
- expose truthful Continue, Review, Retry, and Undo actions.

### Slice 5: Product copy and diagnostics

- replace the generic draft failure message;
- add redacted internal diagnostics containing boundary class and elapsed time;
- do not expose provider secrets, prompts, source content, or raw Harness
  protocol payloads.

### Slice 6: Canary and release gates

- prove a healthy multi-step run can exceed the provider timeout setting;
- prove silent work is still terminated and reaped;
- prove a long capability call is governed by its own timeout;
- prove cancellation and restart recovery remain correct.

## Required Tests

### Pure/unit tests

1. A provider configuration with `timeout_ms: 5_000` does not create a
   five-second complete-run contract.
2. Continuous valid runtime activity beyond the old provider timeout does not
   terminate the run.
3. A silent model stream reaches `model_stream_idle_timeout`.
4. Valid stream chunks rearm the idle watchdog.
5. Invalid, duplicate, and unknown notifications do not rearm it.
6. A valid long-running tool is not killed by the model/runtime idle timer.
7. The tool's own deadline still terminates and classifies that tool call.
8. User-wait time does not consume idle or absolute run budget.
9. The absolute run ceiling terminates even if activity continues forever.
10. User cancellation wins a race with timeout and is reported as cancellation.
11. Shutdown reaps every owned process descendant.
12. Partial verified changes become a recoverable checkpoint.

Fake clocks should prove long durations without making the main test suite wait
for minutes.

### Process integration tests

- initialize timeout remains short and deterministic;
- `session/prompt` may run beyond provider timeout while sending accepted
  events;
- a silent child reaches runtime liveness failure;
- malformed notification traffic cannot keep a child alive;
- graceful shutdown escalates through the existing bounded process ladder;
- child `exit` rejects a pending prompt even when stdout has not emitted
  `close`;
- late notifications after terminal settlement are rejected.

### Packaged deterministic canary

Use a deliberately tiny provider timeout and a deterministic Harness fixture
whose complete multi-step run lasts longer while continuing to emit valid
events. The run must succeed. This proves scope separation without adding a
two-minute delay to every release verification.

The failure canary must receive a dedicated canary-owned runtime policy instead
of abusing provider timeout to simulate a complete-run timeout.

### Packaged real-provider soak

A separate, non-default soak gate must exercise a real coding task lasting more
than 120 seconds and prove:

- narration continues;
- file and command facts remain clickable;
- checks and repair may continue;
- no fixed two-minute interruption occurs;
- completion or user cancellation reaps the Harness process;
- restart can recover the resulting checkpoint and conversation.

This soak is required before claiming the long-run defect fixed in a release,
but need not run in every fast local verification. The qualification run passed
on 2026-08-19 with a measured coding-loop duration of `150962 ms`.

Builder provides an explicit, non-default gate:

```text
npm run verify:packaged-harness:deepseek:soak -- --execute
```

The command reads one `builder-deepseek-packaged-canary-input.v2` JSON object
from standard input. It supports the same two credential-safe modes as the
focused DeepSeek canary:

- `first_config` receives the credential only through standard input and
  rejects credential material in command arguments or environment variables;
- `saved_profile` copies a verified local Builder provider profile into an
  isolated temporary user-data directory without projecting the credential to
  the renderer or command output.

The soak uses an artificial Focus Timer fixture, not an existing user project.
It requires one real Build run to create 11 non-empty modules plus one
`index.html` update, emit narration and tool facts, finish with a passing
automatic check, and finish after at least `120001 ms`. The check may pass on
the first attempt or after a model repair turn; the focused real-provider
canary separately retains the deterministic failed-then-repaired assertion.
Accordingly, the soak accepts one complete, balanced Harness turn for a direct
pass or multiple balanced turns when repair is needed; it never manufactures a
repair turn merely to satisfy the verifier.
The 12-path total keeps the fixture focused while still exercising a real
multi-file coding loop. A later product audit removed count-only approval for
ordinary text files: Builder now bases approval on operation semantics such as
deletion or lockfile mutation, while protected paths, workspace drift, source
budgets, checkpoints, and Undo remain enforced. A run completing at exactly
`120000 ms` does not pass. The gate is intentionally excluded from
`verify:release` so ordinary local verification cannot silently send project
content to a provider or incur API usage.

For repeatable timing, the artificial fixture's `npm test` performs 90 seconds
of bounded local check work before evaluating the generated source. This is not
provider or UI sleep: it is a real main-owned check command inside the normal
120-second command profile. Combined with the real DeepSeek read/edit cycle, it
forces the complete programming run beyond the former 120-second wall-clock
limit and simultaneously proves that an identified long tool is governed by
its own capability deadline rather than the generic runtime-idle clock. The
soak verifier has a separate 10-minute test-harness observation budget; that
budget is not product runtime policy.

## Earlier Evidence Reclassification

Existing Harness failure canaries that hold a request until timeout remain
valuable for:

- child-process termination;
- failure propagation;
- source non-mutation on pre-work failure;
- composer recovery;
- retryability.

By themselves, those earlier held-request canaries do not prove:

- healthy long-run admission;
- correct separation of provider, transport, tool, and run boundaries;
- idle-watchdog rearming;
- partial-work checkpoint recovery;
- correct user-facing timeout classification.

The 2026-08-19 deterministic packaged Harness UI and failure canaries now add
the missing scope-separation, idle-rearming, and interrupted-checkpoint
evidence described above. Earlier documents must still be read with their
narrower historical meaning; their result does not become stronger
retroactively. Real-provider long-run qualification remains separate.

## Authority Boundaries

- Electron main owns all timeout and liveness policy.
- Renderer state cannot extend a deadline, report progress authority, or choose
  a larger capability budget.
- Harness notifications are untrusted until normalized and admitted.
- Provider configuration cannot grant filesystem, command, checkpoint, save,
  or process authority.
- A timeout digest or timer token is evidence of policy application, not
  permission to mutate source.
- Runtime replacement must not change Builder's terminal classification and
  recovery contract.

## Non-Goals

This policy does not:

- add a general terminal or arbitrary shell;
- make background parallel tasks an MVP requirement;
- grant Harness product authority;
- replace Builder checkpoints with Harness persistence;
- require users to configure timeout values;
- remove step, token, output, permission, workspace, or process limits;
- guarantee that every external provider supports resumable requests.

## Completion Gate

This optimization is complete only when all of the following are true:

1. provider timeout no longer determines complete programming-run duration;
2. JSON-RPC `session/prompt` is not cut off by provider timeout;
3. model stream idle, tool timeout, runtime idle, absolute run limit, and user
   cancellation are separately classified;
4. a deterministic active run survives beyond the old timeout;
5. a silent run still terminates and reaps its process tree;
6. a real packaged run longer than 120 seconds completes or remains safely
   user-cancellable;
7. recoverable file changes survive a non-destructive stop;
8. the conversation displays actionable copy and retains prior work history;
9. `verify:release` and the dedicated packaged Harness gates pass;
10. release evidence names the exact tests and does not describe focused source
    tests as proof of real long-run behavior.

Current state on 2026-08-19: all items 1-10 are release-verified. Item 6 is
supported by the opt-in packaged DeepSeek soak measured at `150962 ms`; it is
separate from, and not substituted by, the deterministic 13.2-second packaged
canary.
