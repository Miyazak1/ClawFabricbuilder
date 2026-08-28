# Codex-like Streaming Gap Audit

Date: 2026-08-13

> 2026-08-22 implementation update: the structured-only provider path described
> below is no longer the active programming-runtime architecture. Builder now
> runs the bundled DeepSeek Harness and consumes its Session event log. The
> current parity matrix, implemented event set, privacy boundary, and remaining
> native Tool Presentation work are recorded in
> `DEEPSEEK_HARNESS_EVENT_PARITY_GATE_2026_08_22.md`.

This note records the implementation-level findings from inspecting the current
ClawFabric Builder codebase. The goal is to answer a specific product question:
why the app still cannot fully show Codex-like live work narration such as:

- short assistant progress notes during execution;
- command/file activity in the main timeline;
- completed work collapsed into a history row;
- final answer separated from the execution history.

## Short Answer

The missing piece is not simply "no system prompt".

The project already has system prompts, task stream events, live-output
coalescing, completed history folding, and a JSONL transcript archive. The main
gap is that Build mode currently asks the provider to return one structured JSON
operations object. That output contract intentionally leaves no channel for
free-form live assistant narration.

To reach the Codex-like effect, Builder needs a second, explicitly modeled
progress/narration channel for Build work, while keeping the existing JSON
operations contract intact.

## What Already Exists

### System Prompts

The project already defines separate prompts for code changes, explanations, and
plans in:

- `electron/builder-generation-kernel.cjs`

The code-change prompt begins from `CODE_CHANGE_SYSTEM_INSTRUCTION` and requires
the provider to return a JSON object with `kind`, `title`, `summary`, and
`operations`.

The explanation and plan prompts are also structured JSON prompts:

- explanation: `kind`, `title`, `summary`, `explanation`
- plan: `kind`, `title`, `summary`, `steps`

So the issue is not that the system prompt is missing. The issue is that the
Build prompt is intentionally optimized for structured source changes, not live
work narration.

### Structured Task Stream

The task stream already projects a durable event chain into renderer-safe items
in:

- `electron/builder-task-stream-projection.cjs`
- `src/features/builder/domain/builderConversationSnapshot.ts`

Implemented public item kinds include:

- `user_message`
- `run_started`
- `run_progress_recorded`
- `tool_call_requested`
- `tool_call_result_recorded`
- `agent_step_progress_recorded`
- `run_completed`
- `candidate_reviewed`
- `plan_reviewed`
- `turn_completed`

This is a good foundation. It means the product already has a typed timeline
surface rather than a raw chat-text blob.

### Live Output Coalescing

Renderer-side live output already exists in:

- `src/features/builder/application/builderLiveOutputStore.ts`

It buffers `display_delta_text` and flushes updates through a frame scheduler.
That is the correct shape for avoiding token-by-token full tree churn.

### Frontend Timeline Projection

The Builder page already folds completed work history in:

- `src/features/builder/presentation/BuilderPage.tsx`

The current activity projection can:

- keep work status as a stable item while running;
- replace tool request rows with result rows;
- hide in-progress work status after `run_completed`;
- collect completed tool rows into a `run_history` entry;
- render final `run_completed` assistant text separately.

This means part of the Codex-like interaction model is already present.

### Conversation Transcript Archive

There is already a non-authoritative transcript archive implementation:

- `electron/builder-conversation-transcript-archive.cjs`
- `tests/builder-conversation-transcript-archive.test.cjs`

The archive writes JSONL checkpoints derived from SQLite conversation replay. It
supports:

- `record_committed_conversation(...)`
- `repair_conversation(...)`
- `read_latest(...)`

The conversation main service calls the archive after SQLite append succeeds in:

- `electron/builder-conversation-main-service.cjs`

This means file-style transcript persistence has already started to exist in
the codebase. It is a sidecar, not the source of truth.

## What Is Actually Missing

### 1. Build Mode Has No Natural-Language Narration Channel

Current Build provider calls are designed around this contract:

```text
Return one JSON object only, with no markdown fence or surrounding text.
Use exactly the keys kind, title, summary, and operations.
```

That is correct for safe source-change generation, but it prevents output like:

```text
I am updating scholarships.js first, then I will adjust the city comparison page.
```

If we simply add "explain your progress while working" to the same prompt, we
risk breaking the JSON parser and source-change contract.

Required direction:

- keep JSON operations as the authoritative Build result;
- add a separate progress/narration channel outside the JSON operations object.

### 2. Ask Streaming Exists, Build Streaming Does Not Have Equivalent Prose

Explanation/Ask has an `on_output_delta` path in:

- `electron/builder-generation-host-adapter.cjs`

That path projects only the JSON `explanation` field into live output.

Build/Plan currently wait for a complete structured provider result and then
record fixed progress events. Build can show broad phases such as "Writing the
response", but not file-specific assistant narration.

Required direction:

- either add a Build-safe `on_progress_delta` / `assistant_progress` channel;
- or generate public narration from main-owned facts after each real step;
- do not mix free-form narration into the JSON operations payload.

### 3. Current Progress Stages Are Too Coarse

The durable run progress stages are currently:

- `context_ready`
- `provider_request_started`
- `provider_response_received`
- `result_preparing`

These are useful but too generic for Codex-like work narration. They cannot say:

- which file is being inspected;
- which file is being prepared;
- which command is running;
- what changed in a specific file;
- why a follow-up step is next.

Required direction:

- add more granular, public, main-admitted progress events; or
- extend `agent_step_progress_recorded` so it can represent source/file/command
  phases with bounded display text.

### 4. File Edits Are Results, Not Live Steps

Current Build mode mostly asks the model to return a complete operations list.
The actual file-change facts become visible after the model result is prepared.

That is different from Codex-style execution, where the user sees a sequence of
work facts while they happen:

- read file;
- edit file;
- run command;
- inspect output;
- edit another file.

Required direction:

- if Builder keeps one-shot JSON generation, show generated narration based on
  staged operations after they are admitted;
- if Builder moves toward a tool-execution agent, record each file/tool step as
  a first-class event.

### 5. Duration Is Still Not a Trusted Projection Field

Docs mention trusted timing, but the public run item currently does not expose
main-owned timing such as:

- `started_at_ms`
- `ended_at_ms`
- `duration_ms`

The renderer should not invent elapsed time. To show "completed in 2m 35s" like
Codex, main must persist or project trusted timing.

Required direction:

- add timing to the durable run record or a derived main-owned projection;
- display duration only when it comes from that trusted source.

### 6. Transcript Archive Is Not Yet a Loading Fallback

The JSONL transcript archive exists, but `read_stream` still reads from SQLite
and returns `conversation: null` or throws a projection error. The task stream
does not currently fall back to transcript archive when SQLite replay or task
stream projection fails.

Required direction:

- keep SQLite as authoritative;
- use transcript archive only as non-authoritative read-only fallback;
- clearly label fallback state in the UI;
- never use transcript fallback for permissions, draft restore, save/review, or
  execution admission.

### 7. Loading State Classification Is Still Too Blunt

The frontend controller can represent:

- `idle`
- `loading`
- `absent`
- `ready`
- `refreshing`
- `stale`
- `unavailable`

Recent WIP already improved retention: same-project refresh can keep the prior
conversation while entering `refreshing`, and pending draft restore now uses
`probe(...)` instead of visible `load(...)`.

Remaining gap:

- task stream read failures are still collapsed to `unavailable`;
- there is no user-visible distinction between absent history, replay failure,
  projection failure, read timeout, corrupted event chain, or migration gap;
- old-session loading can still look like generic "Loading activity..." instead
  of a stable diagnostic state.

Required direction:

- preserve last-stable shell during project open and refresh;
- classify read failures in main before they hit the renderer;
- expose stable fallback/diagnostic states.

### 8. Reasoning Is Not Public Narration

DeepSeek Harness represents reasoning, assistant text, and tool calls as
different content parts. Its native conversation UI renders reasoning through a
default-collapsed `Think` disclosure. While a turn is active the collapsed row
may show the latest reasoning line; once settled it retains a compact first-line
summary, with the complete body available on expansion.

Builder currently declares `reasoning_status: none`, configures the Harness
DeepSeek provider with thinking disabled, and ignores reasoning chunks in the
runtime normalizer. Consequently, analysis-like prose visible in the Builder
chat is ordinary assistant text. It cannot safely be folded as reasoning by
keyword, tone, or paragraph shape.

Required direction:

- normalize explicit reasoning delta/completion events only when the provider
  and runtime capability contract enables them;
- keep reasoning collapsed by default after completion;
- keep concise user-facing narration visible in the normal timeline;
- keep edit and command rows as separate clickable facts;
- do not require or expose private chain-of-thought.

### 9. Delta Durability Currently Amplifies Render Cost

The Harness client coalesces assistant chunks at animation-frame cadence.
Builder now also coalesces small Harness text chunks before durable conversation
persistence. It flushes at a bounded byte threshold, paragraph boundary, tool
boundary, or assistant-message completion, preserving narration/tool order
without rebuilding the durable projection for every provider fragment.

The real-provider canary no longer polls the complete stream every 200 ms, and
the focused real-DeepSeek packaged loop now passes. Harness retry events are
also normalized explicitly: a transient failed request can retract its own
partial live tail before retrying without replacing the conversation, and
restart replay omits that discarded attempt. Remaining product work is:

- animation-frame publication to the renderer;
- stable React node identity for the active message;
- deferred Markdown parsing while a block is still streaming;
- longer-output soak coverage that proves the bounded durable batching remains
  responsive under real project context.

## Prompt Implications

Adding a system prompt is necessary, but only for a new channel.

Do not modify the existing Build JSON prompt to produce mixed prose and JSON.
That would make output parsing less reliable.

Instead, introduce a separate contract such as:

```text
When the runtime asks for public progress narration, write one short
user-facing sentence about the current confirmed step. Do not mention schemas,
providers, prompts, credentials, internal event ids, or unverified execution.
```

That narration should be attached to structured event types such as:

- `assistant_progress_recorded`
- `source_change_prepared`
- `command_started`
- `command_completed`
- `run_narration_recorded`

The exact names can follow the existing event style, but the key point is that
progress text must be separate from the authoritative JSON operations result.

## Recommended Implementation Order

1. Keep current JSON operations generation unchanged.
2. Stabilize old-session loading and classify task stream failures.
3. Add trusted run timing to main-owned projection.
4. Add a Build-safe progress narration channel.
5. Project granular file/command facts into the same timeline model.
6. Use transcript archive as read-only fallback only after SQLite read/projection
   diagnostics exist.
7. Update packaged canary to assert:
   - Build live output uses stable nodes;
   - final answer is separate from work history;
   - single file/command facts are not over-collapsed;
   - duration only appears when trusted timing is present;
   - transcript fallback cannot enable review/save/execute actions.

## Bottom Line

The project is closer than it first appears. It already has most of the
structural rails: event chain, task stream, live output store, history folding,
and JSONL sidecar archive.

The structured-operations fallback still lacks a Build-safe public progress
channel. The Harness runtime now supplies model-authored narration as a distinct
stream alongside real tool facts without changing the fallback JSON contract.
The remaining work is to harden that path, keep reasoning separate, and retain
stable loading/render behavior across long and restored conversations.

## 2026-08-22 Harness Parity Closure

The Harness path now supplies the previously missing runtime-native stream:

- true assistant text deltas with bounded durable batching;
- private reasoning deltas projected only as `正在思考`;
- turn, step, retry, compaction, todo, usage, finish, session, and subagent
  lifecycle facts;
- native read/search/diff Tool Presentation metadata;
- Chinese public narration before meaningful tool batches and a separate Chinese
  final summary after the last command.

The real saved-profile DeepSeek packaged canary proves a failed check followed
by an automatic repair and passing check, a single final summary, and a grounded
answer to “how do I run and use this project?” without creating another draft.
Two integration defects found only by the real stream were fixed: legal empty
provider deltas are no longer rejected, and the packaged task-stream sanitizer
now accepts the bounded `presentation_detail` contract.

The remaining streaming risks are no longer missing Harness event capability.
They are product-level loading/render performance for very long restored
conversations, plus future Jobs/Goals/subagent and native session-resume
topologies that are not yet enabled in Builder's Agent Spine composition. See
`DEEPSEEK_HARNESS_EVENT_PARITY_GATE_2026_08_22.md` for the exact boundary and
verification evidence.
