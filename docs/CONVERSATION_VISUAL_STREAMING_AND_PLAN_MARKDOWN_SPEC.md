# Conversation Visual Streaming and Plan Markdown Spec

Date: 2026-08-13

Implementation status: first slice completed on 2026-08-13.

Delivered in this slice:

- assistant streaming and completed prose use a stable, readable conversation
  treatment instead of the compact status treatment;
- Plan and completed assistant responses render through a bounded Markdown
  allowlist in the main chat;
- Plan approval and rejection update the Plan footer in place;
- assistant prose no longer repeats an avatar and `Assistant` heading;
- neutral color tokens, native Windows/CJK typography, focus states, quiet item
  entry/disclosure motion, and reduced-motion fallbacks are applied;
- packaged Plan canary verifies a visible Markdown heading and ordered steps in
  chat before approval.

Verification completed:

- `npm.cmd run verify:release` passed;
- packaged launch smoke passed;
- default packaged canary passed with `plan_markdown_visible=true`;
- packaged Plan mode canary passed through approval and build continuation.

## Decision

Builder will treat the conversation as a readable programming narrative, not a
uniform list of small status labels. Assistant prose, current work status,
admitted actions, final results, and plans have different visual roles even
though they share one chronological timeline.

The first implementation slice must do two things together:

1. establish a legible visual and motion system for streaming conversation;
2. render the public Plan as Markdown directly in chat, with approval controls
   attached to that Plan.

The right workspace remains an inspector for files, diffs, commands, checks,
and previews. It is not the primary Plan reader. A file reference in a Plan may
open the corresponding main-issued File or Changes tab, but reading the Plan
must not require opening the workspace.

This document specializes:

- [Codex-Like Conversation Flow Architecture](CODEX_LIKE_CONVERSATION_FLOW_ARCHITECTURE.md)
- [Codex-Like Programming Runtime Architecture](CODEX_LIKE_PROGRAMMING_RUNTIME_ARCHITECTURE.md)
- [Side Workspace Architecture](SIDE_WORKSPACE_ARCHITECTURE.md)
- [Frontend Experience and Design System Roadmap](FRONTEND_EXPERIENCE_AND_DESIGN_SYSTEM_ROADMAP.md)

## Research Basis

### Observed Codex Desktop Behavior

The screenshots supplied during the product review show these recurring
patterns:

- assistant commentary and the final response are high-contrast, comfortably
  sized prose without a card around every message;
- active actions appear in chronological order and change tense in place, for
  example from `Running command` to `Ran npm test`;
- file edits and commands are distinct action types;
- one action is shown directly, while multiple actions of the same type may be
  grouped behind one disclosure;
- command and file labels are interactive and open contextual detail;
- completed process history collapses only after the Run finishes;
- the final response remains outside the collapsed process history;
- inline code, file references, headings, lists, and validation results create
  scan-friendly structure inside assistant prose;
- motion is quiet. Activity comes from stable text growth, spinner rotation,
  state replacement, and disclosure transitions rather than whole-message
  flashing or artificial character animation.

These are observed product behaviors, not claims about Codex Desktop private
renderer code.

### Codex App-Server

The public Codex app-server protocol gives agent messages, Plans, commands, and
file changes separate stable items. One item advances from `item/started`
through item-specific deltas to `item/completed`. Plan mode has a dedicated
Plan item and an experimental `item/plan/delta`; agent prose has its own
`item/agentMessage/delta`. This supports separate renderers with stable
identity instead of one text blob or one Logs stream.

Reference:
[Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

### OpenCode

OpenCode stores message content as typed parts. A text part is created once,
receives deltas by part id, and is finalized with authoritative start/end
timing. Tool parts remain distinct from text. The important product lesson is
not OpenCode's exact theme; it is that Markdown prose and tool state do not need
to share one generic row renderer.

References:

- [OpenCode message contracts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/message-v2.ts)
- [OpenCode session processor](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts)

### Pi

Pi gives each tool call a stable `toolCallId`, passes partial and terminal state
to the same renderer, and exposes an explicit expanded state. Its tool renderer
can invalidate only the affected tool component. This supports Builder's
existing decision to update one action row in place and to keep large output in
a contextual inspector.

References:

- [Pi tool rendering contracts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts)
- [Pi coding-agent SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)

### Desktop Typography and Motion

Fluent 2 uses native platform fonts and a `14px / 20px` body role on Windows.
It recommends quick, natural motion, non-linear easing for ordinary movement,
and linear easing only for continuous movement such as rotation. Builder is a
Windows Electron application, so Segoe UI Variable with system fallbacks is a
more appropriate base than a web-marketing font.

References:

- [Fluent 2 typography](https://fluent2.microsoft.design/typography)
- [Fluent 2 motion](https://fluent2.microsoft.design/motion)
- [WCAG 2.2 contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)

## Current Implementation Audit

### What Is Already Correct

- high-frequency Ask deltas are buffered outside the full Builder tree;
- visible output is coalesced to at most one update per animation frame;
- the active live message keeps a stable component and DOM position;
- structured Build and Plan provider JSON is not exposed;
- admitted tool request/result pairs update one row while the Run is active;
- completed process history is separate from the final response;
- file and command results are separate and open contextual inspectors;
- a single result is direct, while multiple same-type results may be grouped;
- `prefers-reduced-motion` already disables the activity spinner.

### P0 Problems

#### Conversation prose is visually classified as metadata

`src/styles.css` currently applies `12px`, `1.45` line-height, and
`--cf-text-muted` to `.cf-builder-activity-body`. That same rule also covers
notes, statuses, version summaries, and other secondary content. As a result,
the assistant's actual answer has almost the same weight as diagnostic status.

The current `#747770` muted color has an approximate contrast ratio of
`4.40:1` on `#fcfbf8`, and `4.10:1` on `#f5f3ee`. Both are below the `4.5:1`
minimum used here for normal-size text. It is acceptable as non-essential
decoration only, not as the main answer, Plan, action label, or interactive
text.

#### Plan line structure is destroyed in the renderer

`publicPlanMessage()` already constructs title, summary, a Plan label, and a
numbered list separated by newlines. `ActivityItem` renders that text in one
ordinary `<p>`. HTML collapses the newlines, so the user receives one dense
paragraph rather than a readable Plan.

This is why Plan feels absent from chat even though a public text exists.

#### Every assistant-shaped item uses the same renderer

`run_completed` items with a public message all resolve to the same plain body.
The renderer does not distinguish:

- streaming commentary;
- final answer;
- Plan Markdown;
- failure explanation;
- current work status.

The data types are already different enough to select a renderer. The visual
layer is flattening them.

#### Motion communicates loading but not state change

The spinner is the only meaningful activity animation. Chevron rotation exists,
but list reveal, item arrival, request-to-result replacement, Plan approval,
and final-response settlement have no coordinated transition. Adding motion
without stable-item rules would bring flashing back, so motion must be defined
as a state transition contract rather than decorative animation.

### P1 Problems

- the repeated `Assistant` label adds noise to every response;
- assistant prose is constrained to `92%` rather than a readable character
  measure;
- inline code, code blocks, links, headings, quotes, tables, and lists have no
  conversation Markdown system;
- hover and keyboard focus on file/command facts are not visually equivalent;
- action icons use nearly the same color regardless of running, passed,
  blocked, or failed state;
- Plan approval is visually attached to a generic paragraph instead of a Plan
  document;
- approval creates additional status rows instead of updating the Plan footer
  as the primary decision surface.

## Visual System

### Font Stack

Use one native UI stack for conversation and controls:

```css
font-family:
  "Segoe UI Variable Text",
  "Segoe UI",
  "Microsoft YaHei UI",
  system-ui,
  sans-serif;
```

Use a separate native monospace stack only for code and commands:

```css
font-family:
  "Cascadia Mono",
  "Cascadia Code",
  Consolas,
  "Microsoft YaHei UI",
  monospace;
```

Do not download a web font for the MVP. It adds startup and packaging cost,
introduces a font swap, and does not improve familiarity for a Windows work
surface.

### Type Ramp

| Role | Size / line-height | Weight | Color |
| --- | --- | --- | --- |
| Assistant prose and final response | `13px / 20px` | 400 | primary text |
| User message | `14px / 21px` | 400 | bubble foreground |
| Plan title | `15px / 21px` | 650 | primary text |
| Plan section heading | `13px / 19px` | 650 | primary text |
| Plan list body | `13px / 20px` | 400 | primary text |
| Action title | `12px / 18px` | 600 | soft text |
| Current status | `12px / 18px` | 500 | secondary text |
| Action metadata and line counts | `12px / 17px` | 400 | secondary text |
| Inline code | `12.5px / 18px` | 500 | primary text |
| Code block | `12px / 19px` | 400 | code foreground |

The primary reading measure should be `min(760px, 74ch, 100%)`. Tool rows may
use a narrower `68ch` measure. Do not use viewport-scaled font sizes.

### Color Roles

The current warm cream palette makes the application read as one beige family
and weakens hierarchy. The conversation slice should move toward neutral
surfaces while preserving a restrained green brand accent.

Proposed light tokens:

```text
canvas                  #F7F8F8
surface                 #FFFFFF
surface_subtle          #F2F4F3
border                  #DDE2DF
border_strong           #C8D0CB
text_primary            #1D211F   16.28:1 on white
text_secondary          #4F5752    7.45:1 on white
text_muted              #68716B    5.04:1 on white
brand                   #2D6A58    6.34:1 on white
link                    #2764D9    5.37:1 on white
success                 #16845B    4.68:1 on white
warning                 #9A5A13    5.46:1 on white
danger                  #C13A4A    5.29:1 on white
```

Rules:

- primary answer and Plan text always use `text_primary`;
- subdued text is for timestamps, counts, and nonessential explanation only;
- links use blue so they are not confused with success or brand state;
- success, warning, and danger require an icon or label, never color alone;
- do not put a tinted background behind every action row;
- use surfaces and borders for focus or grouping, not as decorative cards;
- every interactive text and icon state must retain at least `3:1` non-text
  contrast, and normal text must retain at least `4.5:1`.

### Spacing and Rhythm

```text
between conversation turns       18px
between prose paragraphs          10px
between heading and body           6px
between adjacent tool rows         6px
icon-to-content gap                 8px
Plan approval separator top       12px
Plan approval controls gap          8px
```

Use baseline-aligned icons and reserve a fixed `20px` icon track for statuses
and actions. Assistant prose and Plan Markdown do not need a bot icon on every
paragraph. One turn-level identity cue is enough.

## Conversation Surfaces

### Streaming Assistant Prose

- render as high-contrast plain conversation text;
- omit the repeated `Assistant` heading after the first visible item in a turn;
- preserve the same outer message node for the full stream;
- do not animate individual characters, words, or delta chunks;
- do not show a blinking cursor;
- let text grow naturally at the frame-coalesced update rate;
- use `aria-live="polite"` on the active message container, not on every token;
- settle to the same Markdown typography as the final answer without moving
  earlier timeline items.

For the first slice, active Ask text may remain plain while streaming and
switch to Markdown once terminal. A later incremental Markdown slice may parse
only complete block boundaries. It must not reparse and remount the entire
conversation for each provider delta.

### Current Work Status

Current status is compact and temporary:

```text
[spinner] Reading project files
[spinner] Editing index.html
[spinner] Running npm test
```

Use `12px / 18px`, secondary color, and one line where possible. Generic
provider lifecycle states remain temporary and disappear at completion. Real
tool actions retain their correlated row and update in place.

The `responding` phase is not rendered as a status row. Ask output enters the
stable assistant message directly; a temporary `Writing response` row would
duplicate the stream and cause a visible replacement when the first text
arrives. Temporary status is reserved for an active admitted read/edit tool or
a running check. Provider request and result-preparation phases do not receive
their own sentence.

### Tool and Result Rows

- request title uses present progressive tense;
- terminal title uses past tense;
- icon and text state change in place;
- file and command actions never share one group;
- one action is direct;
- only multiple same-type actions may use a disclosure;
- the complete clickable row receives hover and `:focus-visible` treatment;
- command output and full file content open in the side inspector;
- a failed action retains its row and uses danger icon/text without a full red
  card.

### Final Response

The final response is the visual anchor of a completed Run:

- high-contrast Markdown prose;
- no bot avatar or `Assistant` title repeated immediately above it;
- headings, lists, inline code, code blocks, links, quotes, and tables follow
  the conversation Markdown styles;
- no generic `Work details` inside the response;
- completed process history remains before it;
- factual file and command result rows remain after it;
- no duplicate `Result ready` or `Review before saving` message follows it.

## Plan Markdown

### Product Behavior

The Plan is a first-class assistant document in the main conversation:

```text
Plan commentary and admitted read actions
-> completed process history disclosure
-> rendered Plan Markdown
-> approve / reject footer
-> approved, rejected, recording, or failed decision state
-> approved execution continues below in the same timeline
```

The user must be able to read and decide on the complete Plan without opening a
side tab. The side workspace remains useful for files named by the Plan.

### Canonical Public Format

The provider's raw structured Plan JSON remains main-only. Main constructs a
bounded public Markdown message from the already-admitted Plan record:

```markdown
## Improve conversation streaming

Make assistant output easier to read while preserving stable incremental
rendering and current authority boundaries.

1. **Define the conversation type and color scale**
   Increase prose legibility and separate narrative, status, and result roles.

2. **Render Plan results as Markdown in chat**
   Keep the Plan in the main timeline and attach approval controls to it.

3. **Add bounded state transitions**
   Animate item arrival and request-to-result changes without animating deltas.
```

The admitted Plan shown in chat is complete normalized Plan prose: title,
summary, step title, purpose, and `expected_change`. The provider's structured
JSON remains hidden, but no user-facing Plan field may be silently omitted.
Purpose and expected change render as nested Markdown bullets under each
numbered step so their roles remain visually distinct.

### Renderer Contract

Select the Plan renderer only when all are true:

- `item_kind === 'run_completed'`;
- `result_kind === 'plan'`;
- `terminal_status === 'succeeded'`;
- `assistant_message` is present;
- the matching main-issued Plan admission is valid.

Render the message with a bounded Markdown component. Recommended MVP
dependencies are `react-markdown` and `remark-gfm`; the implementation must:

- set `skipHtml`;
- use an explicit `allowedElements` list;
- exclude images, iframe, script, style, form controls, raw HTML, and MDX;
- provide custom components for headings, paragraphs, lists, links, code,
  blockquotes, horizontal rules, and tables;
- reject `javascript:`, `data:`, custom protocols, and untrusted relative URL
  navigation;
- never use `dangerouslySetInnerHTML` or `rehype-raw`;
- render task-list checkboxes disabled if task lists are enabled;
- cap Markdown input bytes, AST nodes, nesting depth, list items, table cells,
  and code-block bytes before mounting;
- fall back to safe plain text when parsing or bounds fail.

`react-markdown` is safe by default and supports element filtering and URL
transforms. Builder still needs its own stricter allowlist because provider text
must not gain Browser, filesystem, or source authority merely by becoming a
link.

References:

- [react-markdown](https://github.com/remarkjs/react-markdown)
- [remark-gfm](https://github.com/remarkjs/remark-gfm)

### File References

A Markdown string is not file authority.

- inline code such as `src/app.tsx` remains inert unless main supplies a
  matching renderer-safe file reference;
- when a matching reference exists, the custom code/link renderer may expose
  an `Open file` action that selects the existing File or Changes tab;
- renderer must send the opaque reference, not a source tree or arbitrary path;
- missing or stale references remain readable text;
- ordinary `http` and `https` links do not silently navigate Project Preview.

### Approval Footer

Approval belongs immediately below the Plan Markdown, separated by one subtle
rule. It is not a floating card and not a side-workspace requirement.

States:

```text
ready      Approve plan | Reject
recording  Recording decision... controls disabled
approved   Approved; execution continues below
rejected   Rejected; project unchanged
failed     Decision could not be recorded; Retry
```

The Plan item keeps its identity as the footer changes. A later
`plan_reviewed` event should update this footer rather than creating a duplicate
generic status row. The durable review event remains authoritative.

Optional low-priority actions such as Copy Plan may appear as icon buttons on
hover or keyboard focus. They must not compete with approval.

## Motion Contract

Motion must explain one of four things: arrival, relationship, state change, or
focus. It must never simulate progress that has not occurred.

### Tokens

```text
instant       0ms
state-fast  120ms
enter       160ms
expand      180ms
panel       220ms
ease-out    cubic-bezier(0.16, 1, 0.3, 1)
ease-io     cubic-bezier(0.4, 0, 0.2, 1)
linear      linear, spinner only
```

### Allowed Transitions

| Event | Transition |
| --- | --- |
| New complete timeline item | opacity `0 -> 1`, translateY `4px -> 0`, `160ms ease-out` |
| New active status row | opacity `0 -> 1`, `120ms`; no movement after mount |
| Tool request becomes result | icon cross-fade and color transition, `120ms`; row size fixed |
| Disclosure opens | chevron `160ms`; content reveal `180ms ease-out` |
| Plan approval footer appears | opacity and translateY `3px`, `160ms ease-out` |
| Focus moves to an inspector | border/background transition, `120ms`; no automatic panel bounce |
| Spinner | `900ms linear infinite` rotation |

### Forbidden Transitions

- no animation for each text delta;
- no typewriter delay;
- no blinking caret;
- no whole-list fade on activity refresh;
- no layout-scale animation;
- no pulsing card around an active response;
- no continuous shimmer behind readable text;
- no auto-scroll animation while the user is reading older content;
- no state color animation that temporarily drops below required contrast.

### Reduced Motion

Under `prefers-reduced-motion: reduce`:

- disable translation, scale, spinner rotation, and animated height;
- use immediate state replacement or a short opacity-only transition no longer
  than `80ms`;
- preserve every state label, icon, focus indicator, and disclosure control;
- do not remove progress information when animation is removed.

## Interaction Details

### Hover and Focus

- interactive rows use the same visible treatment for pointer hover and
  `:focus-visible`;
- focus rings use a `2px` outline with at least `3:1` contrast;
- expanding history keeps focus on the summary;
- opening a file or command moves focus to the new inspector heading only when
  initiated by keyboard; pointer clicks preserve expected pointer behavior;
- icon-only actions require tooltips and accessible labels.

### Selection and Copy

- prose and Markdown remain text-selectable;
- clicking blank message space does not open an inspector;
- inline code can be copied without triggering file navigation;
- code blocks have a copy icon in the top-right corner on hover/focus;
- copying never includes hidden action metadata or internal evidence.

### Scrolling

Keep the existing near-bottom follow policy. New motion adds no new scroll
commands. Expanding prior history should preserve the current visual anchor.
Plan approval and rejection must not force the user to the bottom if they have
scrolled away.

## Conflict Review

| Existing decision | Assessment | Resolution |
| --- | --- | --- |
| Raw Build and Plan structured JSON stays main-only | Compatible | Keep raw JSON hidden; expose only main-built bounded Plan Markdown |
| Chat is the primary planning surface | Compatible, currently under-realized | Render the complete Plan and decision footer in chat |
| Side workspace is the artifact inspector | Compatible | File references open File/Changes; Plan reading does not move to side |
| Stable RAF-coalesced Ask streaming | Compatible | Keep store; style the active node and finalize Markdown without remounting the timeline |
| Generic lifecycle phases do not survive completion | Compatible | Motion applies to visible state replacement only |
| Final response owns no Work details | Compatible | Plan is a dedicated result kind, not Work details |
| One action direct; multiple same-type actions expandable | Compatible | Preserve exactly; do not combine edit and command rows |
| Current Plan output is plain public text | Incomplete | Change the main public formatter to canonical Markdown and use a Plan renderer |
| Current `12px` muted activity body | Conflicts with readable chat | Split prose, status, metadata, and result type roles |
| Current warm neutral palette | Conflicts with desired hierarchy and palette guidance | Move conversation surfaces to crisp neutral tokens with restrained semantic colors |
| Current Plan review creates a later status item | Product-level duplication risk | Correlate review state into the Plan footer; preserve event authority |
| Approved Plan text is reused as a synthetic user instruction | Conflicts with chat truth and execution intent | Dispatch a fixed execution instruction, attach the approved Plan in a separate main-owned prompt field, and suppress the synthetic continuation message from the user-visible timeline |
| Browser reset removes Markdown list markers | Conflicts with readable Plan structure | Restore explicit ordered and unordered list styles inside the bounded Markdown surface |

## Implementation Slices

### VS1: Conversation Type and Color Roles

- introduce dedicated prose, status, action, metadata, code, and Plan classes;
- move assistant prose to `13px / 20px` and primary text;
- replace insufficient muted contrast for readable/interactive content;
- preserve current layout and authority behavior;
- add contrast tests for text tokens on every conversation surface.

### VS2: Bounded Markdown Renderer

- add a shared conversation Markdown component;
- use an allowlist, `skipHtml`, URL transform, and render bounds;
- style headings, paragraphs, lists, code, quotes, links, tables, and horizontal
  rules;
- add unit tests for XSS payloads, oversized documents, unsafe URLs, nested
  structures, and fallback behavior.

### VS3: Plan Markdown in Chat

- make `publicPlanMessage()` produce escaped canonical Markdown from the Plan
  record;
- select the Plan renderer from typed `run_completed/result_kind=plan` facts;
- render approval immediately under the Plan;
- update review state in the Plan footer;
- keep file references connected only through main-issued file refs;
- remove any Plan-reading dependency on a side tab.

### VS4: State Motion and Interaction Polish

- add one-time item arrival, request/result replacement, disclosure, and
  approval transitions;
- honor reduced motion across all new transitions;
- align pointer, keyboard, tooltip, and focus behavior;
- keep delta delivery and scroll-follow behavior unchanged.

### VS5: Packaged Visual Canary

- capture desktop screenshots for active Ask, active Build, completed Build,
  proposed Plan, approved Plan, failed command, and expanded history;
- assert stable live message node and bounded visible frame updates;
- assert Plan headings/list are real semantic elements in chat;
- assert raw HTML, images, unsafe links, and structured provider JSON are absent;
- assert approval controls are adjacent to the Plan;
- assert file and command result groups remain separate;
- run at `1280x720`, `1440x900`, and a narrow desktop viewport;
- verify reduced-motion mode;
- compare screenshots for overlap, wrapping, scroll jumps, and unintended card
  nesting.

## Acceptance Criteria

The slice is complete only when:

- ordinary assistant prose is clearly more prominent than status metadata;
- main prose and all interactive labels meet `4.5:1` contrast;
- Plan title, summary, and numbered steps render as Markdown in chat;
- every Plan step includes its purpose and expected change;
- Plan approval is possible without opening the side workspace;
- approving a Plan does not echo raw Markdown as a user message or create a
  plan document unless the approved Plan explicitly requests one;
- Plan raw structured JSON and hidden provider content remain absent;
- active streaming does not flash, remount prior messages, or animate tokens;
- tool request/result state changes occur in one stable row;
- animations are bounded, purposeful, and disabled or reduced by system
  preference;
- keyboard focus is visible and inspector actions remain accessible;
- one file or command remains direct, and multiple same-type actions remain the
  only expandable result groups;
- packaged screenshots show no overlap, clipped text, involuntary scroll jump,
  or one-note cream palette regression.

## Non-Goals

This specification does not authorize:

- exposing hidden chain-of-thought;
- showing provider reasoning content as Plan prose;
- rendering raw provider HTML, MDX, images, or scripts;
- treating a Markdown file path or link as source authority;
- arbitrary external Browser navigation;
- arbitrary Terminal access;
- animating progress that is not backed by a visible state;
- replacing Draft, CheckRun, Review, Save, Git, SQLite, or permission authority;
- moving Plan review into the side workspace.

## Final Product Rule

Conversation prose explains. Action rows prove. Markdown structures. Motion
connects state changes. The side workspace inspects the selected artifact.

Plan follows the same rule: the complete, readable Plan and its decision live
in chat; files and command details opened from that Plan live in the contextual
workspace.

## Implemented Layout Refinement (2026-08-18)

- The side workspace has no default tab and remains closed until the user opens
  Preview, Changes, Files, or History.
- Draft completion does not auto-open Preview. Packaged completion detection is
  based on the conversation/draft terminal state, not on Preview visibility.
- The header carries current state only. Checkpoint completion is a lightweight
  conversation fact, while Version and restore detail remain in History.
- Waiting output participates in scroll follow before its first text chunk.
  Additional chat-tail and scroll padding preserve a readable gap above the
  composer throughout streaming.
- Opening a file changes inspector navigation without changing the sidebar's
  mounted identity, preventing skeleton loops and whole-panel reload flashes.

Packaged acceptance must prove the sidebar is hidden at initial Build
completion, then open it through a public user control before inspecting
Preview, Changes, Files, or History.
