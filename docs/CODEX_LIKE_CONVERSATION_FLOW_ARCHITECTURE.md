# Codex-Like Conversation Flow Architecture

Date: 2026-08-13

## Product Correction

Builder's ordinary work progress belongs in the primary conversation. A user
must not open a Logs tab to learn whether the Agent is reading the project,
editing files, running a command, checking the result, waiting for approval, or
finished.

The target is not a faster text stream layered over the existing chat. The
target is a typed work conversation in which readable assistant commentary and
real actions appear together:

```text
Assistant commentary: what the Agent is about to do
Tool action: read, edit, command, check, browser, or other admitted work
Assistant summary: what that coherent step achieved
Next step, approval, review, or final result
```

The chat timeline is the canonical user narrative. The right-side workspace is
a contextual inspector for the selected file, diff, command result, check, or
preview. Raw logs remain diagnostic evidence and are not an ordinary product
destination.

This document specializes the broader contracts in
[Builder Conversation and Task Stream MVP](BUILDER_CONVERSATION_TASK_STREAM_MVP.md),
[Codex-Like Programming Runtime Architecture](CODEX_LIKE_PROGRAMMING_RUNTIME_ARCHITECTURE.md),
and [Side Workspace Architecture](SIDE_WORKSPACE_ARCHITECTURE.md).

## Reference Research

These products are architecture references only. They add no runtime or source
dependency to Builder.

### Codex

The public Codex app-server protocol models a Thread as a conversation, a Turn
as one execution, and an Item as one persisted unit such as an agent message,
reasoning summary, command execution, file change, plan, or tool call. Every
item follows the same lifecycle:

```text
item/started
-> zero or more item-specific deltas
-> item/completed
```

The same item id is used from start through completion. Command output, agent
message text, file changes, plan updates, and turn-level diffs have separate
typed notifications. The final completed item is authoritative.

This public protocol supports the conclusion that a rich client should update
stable work items instead of converting provider text into logs. It does not
publish the Codex Desktop renderer's private grouping or side-panel interaction
code. Desktop behavior beyond the protocol is therefore an observed product
reference, not claimed source evidence.

Primary reference:
[Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

### OpenCode

OpenCode stores assistant output as typed message parts. Text, reasoning,
tools, provider steps, and patches are siblings rather than one combined text
blob. A tool part keeps its identity while its state advances through pending,
running, completed, or error. Text and reasoning deltas update their existing
part ids.

OpenCode's provider `start-step` and `finish-step` events create source
snapshots, usage facts, and patch parts. They are useful execution boundaries,
but they are provider-turn boundaries rather than guaranteed human-meaningful
work milestones. OpenCode also provides a details toggle for tool execution;
tool output remains part of the conversation instead of requiring a separate
Logs workspace.

Primary references:

- [OpenCode session processor](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts)
- [OpenCode message contracts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/message-v2.ts)
- [OpenCode TUI details behavior](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/tui.mdx)

### Pi

Pi exposes separate Agent, Turn, Message, and Tool Execution lifecycles. Its JSON
stream uses delta-only message updates and a final authoritative message. Tool
execution has correlated start, update, and end events identified by
`toolCallId`.

Pi's interactive UI can collapse or expand tool output. Its implementation
updates an existing tool component rather than mounting separate start and end
rows. Command output is bounded for collapsed display and throttled before UI
updates. Pi also distinguishes steering input from follow-up input while work
is active.

Primary references:

- [Pi JSON event stream](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md)
- [Pi interactive UI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)
- [Pi tool execution component](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/components/tool-execution.ts)
- [Pi Bash tool rendering](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/bash.ts)

### Dot

Dot is a deliberately small coding agent influenced by Pi. Its published source
package maps provider stream parts into distinct thinking, text, tool, turn, and
agent events. The UI indexes tool blocks by tool-call id and updates the same
block when arguments and results arrive. Its current UI is simpler than the
Codex target and does not define a semantic work-step summary primitive, but it
confirms that stable correlated items do not require a large harness.

Primary reference:
[Dot coding agent 0.1.0](https://pypi.org/project/dot-coding-agent/).

## Common Finding

The shared implementation pattern is:

```text
provider and runtime events
-> typed durable or resumable parts
-> renderer-safe conversation projection
-> stable chat components
-> optional inline detail and contextual inspector
```

None of the reference architectures requires the user to interpret raw logs as
the primary progress experience. None treats every network chunk as a new chat
row. Tool state comes from the runtime that owns the action, not from assistant
prose that happens to mention an action.

## Builder Conversation Item Model

Builder should project its existing main-owned facts into stable conversation
items. The projection is not a new source of Run, Tool, CheckRun, Review,
Checkpoint, or Revision authority.

```text
ConversationItemProjection
  item_id
  conversation_id
  turn_id
  run_id?
  work_step_id?
  kind
  state
  sequence
  public_label
  public_summary?
  target_ref?
  started_at?
  completed_at?
```

Initial item kinds:

- `assistant_text`: readable commentary, progress explanation, or result text;
- `reasoning_status`: a short status or approved reasoning summary, never hidden
  chain-of-thought;
- `tool_action`: a correlated read, edit, command, check, browser, or admitted
  tool action;
- `approval`: permission, plan approval, or another explicit user decision;
- `patch_summary`: a bounded summary of source changes;
- `check_result`: running, passed, failed, cancelled, or unavailable check;
- `work_step`: the readable boundary and summary for one coherent phase;
- `context_compaction`: a compact system event when conversation context is
  summarized;
- `final_summary`: the terminal response for the current user request.

Initial item states:

```text
pending | running | completed | failed | declined | cancelled | blocked
```

Not every kind uses every state. The public projection must use fixed enum
values and bounded user-facing fields. Renderer code must not infer a tool
state from provider prose, CSS state, elapsed time, or the presence of output.

### Stable Identity

- Assistant text uses a stable message and part id for its entire stream.
- Tool actions use the admitted tool-call id for their entire lifecycle.
- A matching result updates the existing action row; it does not add a second
  completion row.
- The running row changes tense and state in place, for example `Editing files`
  to `Edited files` or `Running tests` to `Ran tests`.
- Generic thinking, provider-request, and result-preparation phases may update
  one temporary current-status row, but never become completed run history.
- A plain `responding` phase does not create a status row. Display-safe Ask
  output streams directly into the stable assistant message.
- CheckRun, approval, and review items retain their main-issued identities.
- Restart replay reconstructs the same completed item order and identity.
- A renderer refresh may replace the projection snapshot, but keyed components
  with unchanged ids must remain mounted.

The existing `builder-agent-activity-projection.v1` can supply safe phase and
activity facts to this model. It should not become a second competing timeline.
The target is one conversation-item projection composed from admitted facts.

## Human-Readable Commentary

Assistant text and action rows have different jobs.

Assistant commentary explains intent and outcome in ordinary language:

```text
I am checking how the current stream is stored and rendered before changing it.
```

The following action rows prove what actually happened:

```text
Read 4 files
Ran frontend tests
Edited BuilderPage.tsx
```

Commentary must not impersonate a tool result. An action must not appear merely
because the model wrote "I ran the tests." Tool, CheckRun, and edit facts come
from their main-owned execution authorities.

Commentary can stream while an assistant-text item is active. Raw Build and
Plan structured JSON remains main-only and is never exposed as prose. After a
Plan is admitted, main may construct a bounded public Markdown projection from
that record for the primary chat. If a Runtime cannot produce display-safe
commentary, Builder omits that commentary and continues to show real tool,
file, command, check, and approval facts. It does not invent provider-lifecycle
sentences such as `Preparing review` or `Changing files` as completed work.

The detailed visual, motion, Markdown, and Plan presentation contract is in
[Conversation Visual Streaming and Plan Markdown Spec](CONVERSATION_VISUAL_STREAMING_AND_PLAN_MARKDOWN_SPEC.md).

## Work Step

A Work Step is a semantic phase that a person can recognize, for example:

```text
Understand the current implementation
Repair streaming and scroll behavior
Run release checks
Prepare the result for review
```

A Work Step is not:

- one provider response step;
- one tool call;
- one Draft Checkpoint;
- one saved Project Version;
- a generic percentage progress estimate.

Provider step boundaries from OpenCode, Pi, or another harness may inform the
runtime, but Builder must not expose each one as a human milestone. One Work
Step may contain several provider turns and tool actions.

### Step Lifecycle

```text
work_step.started
-> zero or more assistant-text and action items
-> all child actions become terminal
-> work_step.completed | blocked | failed
-> readable step summary
```

A step closes when at least one of these is true:

- the current plan subgoal is achieved or cannot proceed;
- a coherent inspection, implementation, verification, or repair phase ends;
- the Agent is about to change objective or request a user decision;
- the Run itself becomes terminal.

Do not close and summarize a step after every tool call. A read-file batch or a
test-and-repair loop should remain one coherent phase when that is how a user
would describe the work.

### Step Summary

The summary answers:

```text
What was established or completed?
What changed, if anything?
What happens next or needs user attention?
```

It can be model-authored only from a bounded envelope of already-recorded
public facts. Main must omit unsupported claims and use deterministic fallback
copy if summary generation fails. A test can be described as passed only when a
matching successful CheckRun exists. A file can be described as changed only
when an admitted change fact exists.

### Checkpoint Relationship

A completed Work Step may trigger a Draft Checkpoint when source changed, but
the two facts remain separate:

- Work Step explains progress to the user.
- Draft Checkpoint provides recovery or undo.
- An optional Version marks a stable milestone; it does not gate continuation.

The UI must not announce every automatic checkpoint as a new completion card.
Recovery availability belongs in workspace or history controls without
interrupting or duplicating the conversation.

## Tool Action Rows

The collapsed row is concise and readable:

```text
Running frontend tests
Edited 2 files
Read BuilderPage.tsx
Checked the preview
```

Completed edit rows name each changed file and show bounded added/removed line
counts. Clicking a non-deleted file opens the existing read-only File workspace;
clicking a deleted file opens Changes. Completed checks name the exact
main-selected command profile, such as `npm test`, and open a read-only Command
Inspector containing the admitted command display and fixed result summary. The
inspector is not an interactive shell and does not grant process authority.

The same row moves from running to terminal state. It may show a spinner while
active and then a success, failure, decline, or cancellation state. It may also
show bounded duration, file count, or change count when those values are backed
by facts.

Expanding the row shows only a bounded public preview. Large command output,
source, and diffs belong in the contextual inspector. Raw provider payloads,
prompts, credentials, internal paths, receipts, and unrestricted command data
never enter the chat projection.

Tool rows are grouped only when grouping preserves meaning. For example,
several read operations may become `Read 6 files`, while one failed command
must remain independently visible because it needs attention.

## Contextual Inspector

Clicking a chat item opens the relevant right-side tool without removing or
replacing the chat item:

| Chat target | Side workspace destination |
| --- | --- |
| File read | Read-only File tab at the projected file and line |
| File edit | Review tab showing the admitted diff, with File navigation |
| Command or check | Read-only Command Inspector with bounded output |
| Browser or preview check | Browser tab in Project Preview mode |
| Plan or review decision | Review tab |

The first command detail surface is a read-only inspector, not an arbitrary
shell. A future Terminal may reuse visual components, but it requires separate
permission and execution authority.

`target_ref` is main-issued and opaque to the renderer. The renderer must not
send source trees, filesystem paths, commands, URLs, or output back to main as
authority. Opening, closing, or switching an inspector tab does not change Run,
CheckRun, Review, Draft, or Save state.

## Streaming and Rendering Contract

Smoothness comes from stable items and bounded repainting, not artificial typing
delays.

### Assistant Text

- Buffer provider deltas outside the full Builder React tree.
- Publish at most one visible text update per animation frame.
- Update only the active assistant-text component.
- Preserve the component key and DOM node for the complete stream.
- Avoid reparsing and replacing the entire conversation on each delta.
- Finalize rich Markdown when a stable block boundary or terminal message is
  available; incremental rendering must not repeatedly remount prior content.

### Command and Tool Output

- Tool progress has its own update budget, slower than assistant text.
- A target near 100 ms between visible command-output updates is appropriate
  for the first desktop implementation; output completion flushes immediately.
- Collapsed rows do not grow with every output chunk.
- Large output is stored and inspected through a bounded main-owned result, not
  accumulated without limit in renderer state.

### Scrolling

- Auto-follow only while the reader is already near the newest content.
- User upward scrolling releases the bottom anchor immediately.
- New chunks do not steal scroll position or focus.
- Returning to the bottom restores follow behavior.
- Expanding a prior action preserves the visible anchor as closely as possible.
- Provider chunk count is never a direct scroll command.

### Layout Stability

- Running and terminal states reserve stable icon and status dimensions.
- A spinner changing into a result icon must not resize the row.
- Timestamps, counts, and long labels wrap or truncate within stable bounds.
- One incoming item must not recreate earlier items, the composer, or the side
  workspace.

## Logs and Diagnostics

Logs are engineering evidence, not the user's progress narrative.

Ordinary users should not need Logs to answer:

- Is the Agent still working?
- What is it doing now?
- What did it change?
- Did the check pass?
- Does it need my approval?
- What should I review next?

Those answers belong in chat and the contextual inspector. Raw logs may remain
available through an advanced diagnostics or support export surface for crash,
provider, transport, and authority investigations. They should not occupy a
normal side-workspace tab or become acceptance evidence for the user flow.

## Ask, Plan, and Build

Internal mode and authority distinctions remain necessary, but they do not
justify different transcript architectures.

- Ask primarily produces assistant-text items and admitted read-only actions.
- Plan produces commentary, admitted inspection actions, a main-built Markdown
  Plan in chat, and an approval footer attached to that Plan item.
- Build produces commentary, write and command actions, checks, patch summaries,
  review state, and a final result.
- Auto selects the safe internal route, then projects the same item model.

The user experiences one continuous project conversation. Modes control what
the Agent may do, not where progress is displayed.

## Implementation Slices

### CF1: Conversation Item Contract

- define renderer-safe item kinds, states, identity, ordering, and sanitizers;
- compose from existing Conversation, Run, Tool, CheckRun, Review, and activity
  facts;
- add no new provider, source, command, or Save authority.

### CF2: Stable Chat Rendering

- render one keyed component per conversation item;
- isolate live assistant text and tool-output stores;
- add frame-bounded text updates and smart bottom anchoring;
- prove prior items and the composer do not remount during a stream.

### CF3: Real Action Rows

- correlate admitted tool start and terminal result by id;
- add compact running, completed, failed, declined, and cancelled states;
- add bounded inline expansion;
- stop showing duplicated start/result rows.

### CF4: Contextual Inspector

- add main-issued inspector targets;
- route files, edits, commands, checks, and previews to the correct side tab;
- keep command inspection read-only;
- preserve conversation position across open, switch, and close.

### CF5: Work Steps and Summaries

- add semantic Work Step identity and lifecycle;
- group coherent actions without equating provider steps with milestones;
- generate fact-grounded summaries with deterministic fallback;
- optionally create a separate Draft Checkpoint after source-changing steps.

### CF6: Product Cleanup

- remove Logs from ordinary side-workspace navigation;
- centralize review actions in the current review/workspace toolbar;
- remove the legacy `Review before saving` and `Result ready` cards from chat;
- remove composer-level `Review draft` shortcuts that duplicate the workspace;
- keep compact CheckRun state beside Save while Preview, Changes, and Files live
  in the contextual workspace;
- keep chat action density low;
- retain advanced diagnostics outside the normal workflow.

## Acceptance Matrix

The first complete slice must prove:

- many small provider deltas update one assistant item without visible flashing;
- a command remains one row from start through completion;
- while a Run is active, admitted Tool actions stay in chronological order and
  matching request/result states update the same row;
- after `run_completed`, that process history becomes one separate collapsed
  disclosure before the final response and expands back to its prior actions;
- the final response never owns a generic `Work details` section;
- final file changes and commands remain separate result rows after the response,
  with file and command inspectors available from factual rows;
- a single edit or command is never wrapped in a disclosure; only multiple
  actions of the same type may form an expandable group;
- provider lifecycle milestones and generic Agent Step receipts never become
  completed process history;
- an edit row opens the correct read-only file or diff inspector;
- scrolling upward remains stable while new text and actions arrive;
- a completed-run history disclosure appears only after its actions settle;
- summaries never claim unrecorded edits or successful checks;
- approval, failure, interruption, and cancellation remain visible in sequence;
- restart reconstructs terminal items without duplicate rows;
- Ask, Plan, Build, and approved-plan continuation use the same chat grammar;
- ordinary progress can be understood without opening Logs;
- the terminal assistant response is not followed by duplicate review/result
  summaries;
- the workspace toolbar carries check and save state while the side workspace
  carries the actual artifact;
- packaged canaries cover real streaming, action updates, side-panel routing,
  scroll behavior, and restart recovery.

The collapsed history label may show elapsed time only after the main projection
supplies durable start/end timing or a trusted `duration_ms`. The renderer must
not estimate historical duration from mount time, sequence numbers, or local
receipt time.

## Non-Goals

This architecture does not authorize:

- displaying hidden chain-of-thought;
- arbitrary shell or Terminal access;
- renderer-authored tool, check, edit, or save evidence;
- raw provider payloads or structured Build/Plan JSON in chat;
- using assistant prose as proof that an action occurred;
- treating Work Step completion as CheckRun success or Save Version;
- making every internal runtime event visible;
- replacing existing Git, SQLite, Draft, Review, Permission, or Revision
  authority.

## Decision

ClawFabric Builder will implement a typed Codex-like conversation flow, not a
Logs viewer embedded in chat. Human-readable commentary, correlated real
actions, semantic Work Steps, and terminal summaries form the main timeline.
The side workspace inspects selected artifacts and results. Stable identity and
bounded rendering provide smooth streaming. Main-owned facts continue to decide
what actually happened.

## Workspace Hierarchy Addendum (2026-08-18)

The conversation remains the default work surface after a Run completes.
Preview, Changes, Files, and History are contextual inspectors and therefore
start closed. A user action from Workspace or a factual chat row may open the
relevant inspector; completion itself must not expand the side workspace.

Status is split by meaning instead of rendered as peer toolbar pills:

- the title bar shows only the most important current-work state, such as
  `Unsaved draft` or `Viewing Version N`;
- the conversation may show a quiet, factual checkpoint summary for the current
  Run;
- History and Changes own revision, checkpoint, file, and restore detail;
- a current saved Version is not repeated beside the live Draft state.

The panel's selected file path is navigation state, not panel identity. Opening
a file from chat must reuse the mounted inspector and load the main-issued file
reference without resetting the entire side workspace.

The scroll container reserves a stable composer safe area from the first
visible waiting frame. A zero-text waiting item is sufficient to trigger the
near-bottom follow policy; the UI must not wait for the first text delta before
moving the live item above the composer.
