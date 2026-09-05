# Default Dark Theme And UI Polish Execution Plan

Date: 2026-08-31

Status: execution plan for making ClawFabric Builder default to dark mode and
polishing the current Agent-first desktop UI.

## Decision

Builder should default to a polished dark desktop theme. This should be
implemented as a small design-system slice, not as isolated color overrides.

The target product feel is:

```text
quiet desktop tool
-> dark by default
-> readable conversation and plans
-> precise project/task navigation
-> clear execution evidence
-> restrained accents and status colors
```

The first implementation should keep the current layout and authority model.
It should not redesign Agent, Project, Task, Workbench, or execution semantics.

## Current State

The implementation already has a useful foundation:

- `src/styles.css` centralizes most application colors through `--cf-*` tokens.
- Tailwind theme tokens exist in `@theme` for background, foreground, card,
  muted, border, primary, destructive, and ring.
- The Builder shell already separates global rail, Agent roster, Project/Task
  sidebar, main workbench, Composer, Task Monitor, and Artifact sidebar.
- Existing tests in `src/app/BuilderDesktopLayoutStyles.test.ts` assert several
  layout and style contracts.
- Existing docs already call for a quiet, precise, dark-mode-ready design
  system.

The current gaps:

- `:root` and `@theme` are light by default.
- There is no explicit `color-scheme: dark`.
- Some colors are hardcoded directly in `src/styles.css`, including `#ffffff`,
  warning/status colors, diff colors, terminal/code colors, and mixed surfaces.
- Conversation body, tool evidence, notes, and secondary status text still share
  too much typography and color treatment in some places.
- Workbench filters, Project/Task rows, Composer chips, Task Monitor rows,
  popovers, diff/source panels, and settings cards need dark-specific contrast
  review.
- Tests prove individual style fragments but do not yet prove the theme default
  or dark-token coverage.

## Non-Goals

- Do not add a theme picker in this slice.
- Do not implement light/dark user preference persistence yet.
- Do not change Builder Main authority, dependency readiness, tool permission,
  Project/Task execution, or Workbench message contracts.
- Do not introduce a new component library.
- Do not restyle the app into a marketing or hero-page layout.
- Do not use broad gradients, decorative orbs, or oversized card layouts.

## Slice 1: Default Dark Tokens

Primary file:

- `src/styles.css`

Implementation:

- Change `@theme` values to dark defaults:
  - `--color-background`;
  - `--color-foreground`;
  - `--color-card`;
  - `--color-muted`;
  - `--color-muted-foreground`;
  - `--color-border`;
  - `--color-primary`;
  - `--color-primary-foreground`;
  - `--color-destructive`;
  - `--color-ring`.
- Change `:root` `--cf-*` values to dark defaults.
- Add `color-scheme: dark` to `:root`.
- Add missing semantic tokens before touching component rules:
  - `--cf-surface-overlay`;
  - `--cf-surface-selected`;
  - `--cf-code-bg`;
  - `--cf-code-border`;
  - `--cf-link`;
  - `--cf-link-hover`;
  - `--cf-success-bg`;
  - `--cf-success-border`;
  - `--cf-success-text`;
  - `--cf-warning-bg`;
  - `--cf-warning-border`;
  - `--cf-warning-text`;
  - `--cf-danger-bg`;
  - `--cf-danger-border`;
  - `--cf-danger-text`.
- Keep primary UI neutral and use restrained accent colors only for focus,
  active states, links, and status.

Suggested dark palette:

| Token | Suggested value | Use |
| --- | --- | --- |
| `--cf-bg` | `#101412` | app canvas |
| `--cf-bg-subtle` | `#151a17` | secondary background |
| `--cf-surface` | `#191f1c` | panels and composer |
| `--cf-surface-muted` | `#202722` | hover and selected rows |
| `--cf-surface-raised` | `#242c27` | popovers/composer raised state |
| `--cf-surface-overlay` | `#27302a` | menus and floating panels |
| `--cf-border` | `#2d3832` | subtle separators |
| `--cf-border-strong` | `#3d4b44` | focused or selected borders |
| `--cf-text` | `#e7eee9` | primary text |
| `--cf-text-soft` | `#c4cec7` | secondary readable text |
| `--cf-text-muted` | `#9ba7a0` | metadata |
| `--cf-text-faint` | `#758179` | placeholders |
| `--cf-primary` | `#dce8df` | owner bubble / primary button |
| `--cf-primary-foreground` | `#111512` | text on primary |
| `--cf-primary-text` | `#8ed7b2` | selected/action text |
| `--cf-accent-strong` | `#7ab7ff` | focus/link accent |

Acceptance:

- application opens dark by default;
- no major panel has light background;
- primary, secondary, muted, placeholder, link, success, warning, and danger
  text remain readable on their backgrounds;
- `color-scheme` makes native inputs and scrollbars dark-compatible.

## Slice 2: Hardcoded Color Cleanup

Primary file:

- `src/styles.css`

Implementation:

- Replace hardcoded `#ffffff`, `white`, and light-only `color-mix(... white)`
  values with semantic tokens.
- Replace direct warning color `#9a6700` with `--cf-warning-text`.
- Replace direct diff colors with semantic status tokens.
- Preserve the intentionally dark terminal/code palette only after moving it to
  `--cf-code-*` tokens.
- Review every direct `rgba(...)` and direct hex after the token block.

Acceptance:

- `rg -n "#[0-9a-fA-F]{3,8}|rgba\\(|rgb\\(|white" src/styles.css` returns
  only approved exceptions or token definitions;
- approved exceptions are documented in comments when they are not obvious;
- diff, terminal, code, warning, success, danger, and selected states no longer
  depend on light backgrounds.

## Slice 3: Conversation And Workbench Readability

Primary files:

- `src/styles.css`
- `src/features/builder/presentation/BuilderPage.tsx`
- `src/features/builder/presentation/BuilderPage.test.tsx`

Implementation:

- Keep assistant Markdown and Plan Markdown visually stronger than metadata.
- Keep status/tool rows compact, but avoid making them look like primary
  assistant answers.
- Ensure pending user messages match durable user messages.
- In Agent Workbench, make owner bubbles, Agent Markdown, proposal cards, result
  cards, and filters use the same conversation hierarchy as Task conversations.
- Keep Workbench filters sticky but avoid a harsh full-width dark bar.

Acceptance:

- owner/user messages are visually consistent in pending and durable states;
- assistant answers are readable as primary content;
- tool evidence rows are recognizable as evidence/status rows;
- Plan markdown preserves headings, lists, code refs, and action controls;
- Workbench Conversation / Proposals / Results / Status filters remain legible
  and clearly selected.

## Slice 4: Navigation And Task Management Polish

Primary files:

- `src/styles.css`
- `src/features/builder/presentation/BuilderAgentRoster.tsx`
- `src/features/builder/presentation/BuilderAgentSidebar.tsx`
- `src/features/builder/presentation/BuilderPage.tsx`
- `src/features/builder/presentation/AgentTaskMonitorPanel` owner module if
  split later.

Implementation:

- Make global rail, Agent roster, Projects/Tasks sidebar, and main frame use
  distinct but low-contrast dark surfaces.
- Clarify selected Agent, selected Project, selected Task, hover, focus, and
  active-task count.
- Keep row height stable and text truncation predictable.
- In the Task Monitor, distinguish:
  - working;
  - needs attention;
  - review changes;
  - failed;
  - stopped;
  - ready/recent.
- Ensure Stop appears only for genuinely cancellable task states. Styling
  should reinforce the fixed state model, not hide stale operations.

Acceptance:

- user can tell which Agent/Project/Task is selected at a glance;
- attention and active states are visible without overwhelming the sidebar;
- right rail remains usable with many tasks;
- no task/project row wraps into layout breakage at narrow widths.

## Slice 5: Composer And Popovers

Primary files:

- `src/styles.css`
- `src/features/builder/presentation/BuilderComposer.tsx`
- `src/features/builder/presentation/BuilderComposer.test.tsx`

Implementation:

- Treat Composer as the main raised input surface.
- Make workspace chip, mode chip, approval chip, add menu, approval menu, and
  send/stop button share a coherent control language.
- Ensure focus-visible states are stronger than hover.
- Ensure disabled menu items are visibly disabled but still readable.
- Verify Workbench composer and Task composer both work in dark mode.

Acceptance:

- Composer remains visually prominent without looking like a floating card stack;
- active mode and approval state are easy to scan;
- menus are dark, readable, and keyboard-focusable;
- textarea placeholder is visible but clearly secondary.

## Slice 6: Artifact, Source, Diff, Preview, Settings

Primary files:

- `src/styles.css`
- `src/features/builder/presentation/BuilderPage.tsx`
- `src/app/BuilderApp.tsx`
- focused tests around Source, Diff, Preview, Settings.

Implementation:

- Move source/code/diff panels to `--cf-code-*` and status tokens.
- Use dark-compatible table, inline code, fenced code, and Markdown link styles.
- Keep preview iframe/container boundaries visible without making the preview
  itself dark if the preview content is user-generated.
- Make Settings surface dark and consistent with shell surfaces.
- Review expanded preview overlay and artifact drawer resize handle.

Acceptance:

- source file tree and content are readable;
- diff added/removed lines are visible but not neon;
- Markdown code blocks are readable;
- Settings does not flash or retain light surfaces;
- preview controls remain discoverable.

## Slice 7: Tests And Verification

Primary files:

- `src/app/BuilderDesktopLayoutStyles.test.ts`
- `src/features/builder/presentation/BuilderPage.test.tsx`
- `src/features/builder/presentation/BuilderComposer.test.tsx`
- `src/features/builder/presentation/BuilderAgentSidebar.test.tsx`
- `src/features/builder/presentation/BuilderAgentRoster.test.tsx`

Implementation:

- Add token tests:
  - `:root` contains `color-scheme: dark`;
  - `--cf-bg`, `--cf-surface`, `--cf-text`, `--cf-border`, and `--color-*`
    dark defaults exist;
  - no root token still points to the old light theme.
- Add style tests for:
  - Composer shell background and focus;
  - Workbench filters selected state;
  - owner/user bubbles;
  - Task Monitor selected row;
  - Artifact/source/diff dark tokens.
- Keep existing layout tests passing.
- If packaged canaries are available, run at least one launch smoke after the
  style slice.

Expected focused verification:

```text
npm exec tsc -b --pretty false
npm exec vitest run src/app/BuilderDesktopLayoutStyles.test.ts
npm exec vitest run src/features/builder/presentation/BuilderComposer.test.tsx
npm exec vitest run src/features/builder/presentation/BuilderAgentSidebar.test.tsx
npm exec vitest run src/features/builder/presentation/BuilderAgentRoster.test.tsx
npm exec vitest run src/features/builder/presentation/BuilderPage.test.tsx
```

Run broader packaged verification only after the focused UI slice is stable.

## Implementation Order

1. Add dark semantic tokens and `color-scheme: dark`.
2. Update existing token consumers that break immediately in dark mode.
3. Replace hardcoded light colors and document approved exceptions.
4. Polish Composer and popovers.
5. Polish Workbench and Task conversation readability.
6. Polish Agent roster, Projects/Tasks sidebar, and Task Monitor.
7. Polish Artifact/source/diff/preview/settings surfaces.
8. Add and update focused tests.
9. Run TypeScript and focused UI test suites.
10. Do a packaged/manual visual pass across:
    - fresh app with no projects;
    - Agent Workbench with conversation and proposal;
    - Project Task conversation with active work;
    - Source/Diff/Preview tabs;
    - Settings.

## Visual QA Checklist

- No full-screen white flash after launch or route switch.
- Text contrast is acceptable for primary content, metadata, disabled controls,
  status badges, links, and code.
- User and Agent messages feel like a conversation, not a diagnostics log.
- Plan output reads like a document with structure.
- Tool evidence is compact and inspectable.
- Selected Agent/Project/Task states are obvious.
- Task Monitor status states are distinguishable.
- Composer remains the strongest interactive affordance.
- Popovers, menus, and settings are dark-compatible.
- Diff/source/code panels are readable.
- Long Chinese and English text truncates or wraps cleanly.
- Reduced-motion behavior remains respected.

## Open Decisions

- Whether to support a light theme again later through a user preference.
- Whether default dark should use a near-black canvas or a softer graphite canvas.
- Whether owner/user bubbles should stay light-on-dark or invert to a light
  primary bubble with dark text.
- Whether Agent identity colors should be per-Agent once multi-Agent settings
  ship.
- Whether syntax highlighting should be introduced in this slice or later.

Recommended defaults:

- ship dark-only first;
- use softer graphite rather than pure black;
- keep owner/user bubble as light primary with dark text for strong contrast;
- defer per-Agent colors and syntax highlighting.

## Risks

- A broad token change can accidentally lower contrast in nested surfaces.
- Tailwind `bg-background text-foreground` usage must stay aligned with `--cf-*`
  tokens.
- Direct `color-mix` rules can look wrong in dark mode if they were tuned for
  white backgrounds.
- Snapshot-like CSS tests may need deliberate updates when tokens change.
- A purely CSS-only pass may miss product hierarchy issues in conversation,
  Plan, and task-monitor states.

## Bottom Line

The right next move is a bounded UI slice:

```text
Default dark tokens
-> hardcoded color cleanup
-> conversation/composer/navigation polish
-> artifact/source/diff/settings dark QA
-> focused tests
```

This will make Builder feel more like a serious desktop workbench while keeping
the existing Agent, Project, Task, permission, and runtime architecture stable.

## Integration And Acceptance

The theme work was found in the detached `5b95/clawfabric-builder` worktree at
`e8bae5b`. It consists of uncommitted edits to `src/styles.css` and
`src/app/BuilderDesktopLayoutStyles.test.ts`, not a separate theme commit.
Those edits were integrated into the current main working tree without
reverting the existing Plan and Workbench changes. No merge commit or push was
performed.

Acceptance fixes made during integration:

- Raised the faint text token to `#91a096`; text token contrast is tested at
  4.5:1 or better against the three primary dark surfaces.
- Preserved the opaque sticky Workbench filter background and covered the
  scroll container's top inset so text cannot show above the filter bar.
- Matched the native BrowserWindow startup background to `#0f1311`.
- Kept the preview document surface independent from the application's theme.
- Kept dark-only behavior; theme preferences and syntax highlighting remain
  outside this slice.

The 28 layout/style tests pass. Packaged screenshots cover the empty Agent
view, a saved-history Agent Plan and approval controls, composer menu, narrow
1000px layout, 1280px layout, maximized window, saved task, task monitor,
history, source viewer, and Settings. The Settings API-key input is empty
before screenshots; the provider configuration is not changed.

Window verification uses native resizing, not Playwright `setViewportSize`,
which can leave Chromium's emulated viewport fixed after a native maximize.
Actual title-bar clicks were verified at 1280x820 -> 1920x1040 -> 1280x820.
The regular packaged-history canary now verifies both native window state and
renderer dimensions. It waits for asynchronous native state changes and
reports the failing window phase. Evidence is under
`release/agent-plan-stability-20260831/native-window` and the numbered RC runs.
Cold-start diagnostics also identified an invalidated Playwright JSHandle
(`Execution context was destroyed`). The canary now reacquires only this
read-only handle, at most three times; it never replays a window action.

This acceptance does not claim an actual project preview was run or a new
browser verification workflow was completed. Source, chrome, conversation,
and Settings theme checks are separate from project browser behavior.
