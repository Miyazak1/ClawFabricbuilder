# Builder Conversation Node Taxonomy v1

Date: 2026-08-24

## Purpose

Builder's conversation surface is projected from Builder-owned facts, not from
ad hoc renderer state. This taxonomy names the first stable UI node groups so
future interaction work can place controls near the fact they operate on.

DeepSeek Harness is the interaction reference, but Builder keeps its product
authority boundaries. Harness session logs do not decide project identity,
workspace permissions, checkpoint validity, draft review, Version state, or
publication authority.

## Node Groups

### Message

Human and assistant-visible prose.

- `user_message`
- `transcript_message`
- `programming_runtime_assistant_message`
- `run_completed` when it carries `assistant_message`

Messages render as public chat content. Message actions attach to the message or
turn tail, not to the global toolbar.

### Reasoning

Harness reasoning status and, later, explicitly public reasoning blocks.

- `programming_runtime_status` with `status_kind: "reasoning"`

Current Builder facts contain only a safe status string. The UI may show a
collapsed Think-style status row, but it must not invent, reconstruct, or expose
reasoning text. If a future protocol carries displayable reasoning content, it
must be a distinct admitted public field with sanitizer coverage.

### Tool Evidence

Concrete local actions and their results.

- `tool_call_requested`
- `tool_call_result_recorded`
- `programming_runtime_tool_activity`
- completed run history folded from runtime tool activity

Tool rows render as one-line summaries first. Rows with evidence details use a
collapsed disclosure for diff, read, search, command, or failure evidence. A
result settles the same logical row as its request. Inspector/open actions
attach to the tool row.

### Checkpoint Event

Builder-owned recovery facts that protect the current draft.

- `checkpoint_recorded`

Checkpoint events are low-noise chat rows with a stable
`data-builder-checkpoint-turn-event` hook. Undo and history actions attach to
that row, and the saved-checkpoint settle animation must remain decorative and
respect reduced-motion settings.

### Product Fact

Builder-owned facts that are not model prose and not tool calls.

- `recovery_action_recorded`
- `run_control_requested`
- `candidate_reviewed`
- `plan_reviewed`
- `queued_followup_consumed`
- `run_started`
- `run_progress_recorded`
- `programming_runtime_status` except `reasoning`

Product facts are low-noise status rows. Recovery actions attach to the fact row
they affect. They do not belong in the title toolbar.

### Decision Card

Blocking or near-blocking human decisions.

- pending plan review
- current draft Save / Discard
- command approval
- provider context disclosure approval
- project write approval

Decision cards live near the composer because they decide what the next user
input can mean. They should use one-shot busy latches and remain explicit about
what authority they grant or deny.

### Turn Tail

Completed-turn actions and compact metrics.

Builder now renders a v1 turn tail on `run_completed` assistant messages. It
owns copy, compact completion metadata, and current draft work-entry affordances.
Future branch or feedback actions should extend that tail instead of moving into
the page header or global workspace controls.

## Header Boundary

The page header is for global project context and navigation-level controls:

- project title and coarse state;
- opening/history/draft badges;
- compact check-state icons without explanatory text;
- preview run/stop and project folder commands;
- workspace panel menu;
- task monitor toggle.

It should not carry draft Save / Discard, checkpoint restore, tool inspectors,
message actions, or verbose check-result summaries.

## Workspace Boundary

The workspace menu is a temporary destination picker and may use text labels.
The persistent side-workspace tab strip should stay compact: the active tab owns
the visible label, while inactive tabs keep labels available through title,
ARIA, and visually hidden text.
Side-workspace placeholders should show only a short destination title by
default. Implementation notes and future capability explanations should be
hidden or disclosed on demand, not rendered as permanent empty-state copy.

## Lifecycle Boundary

Project and task lists should expose low-noise lifecycle controls only when a
main-owned callback exists. Rename and Archive are the v1 controls because they
reduce clutter without claiming destructive filesystem authority.

Archive is a soft lifecycle action: the canonical store may hide archived rows
from the default projection, but hard delete needs a separate confirmation,
receipt, and main-owned file/task authority. Renderer UI must not infer deletion
or mutate project/task identity on its own.
