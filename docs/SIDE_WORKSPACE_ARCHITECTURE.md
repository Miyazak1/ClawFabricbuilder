# Side Workspace Architecture

The right-side workspace is not a browser-only panel. It is a contextual tool
surface for the current project, draft, review, and task state.

Live Preview is the first real tool in this surface. Files, Review, Terminal,
and Side Chat should plug into the same container instead of each creating a
separate drawer model.

## Product Goal

The side workspace should make Builder feel like a Codex-like programming
workbench:

- chat remains the primary planning and instruction surface;
- the side workspace shows the active artifact or tool needed for the current
  task;
- tools can switch without losing the current chat context;
- project facts come from main-owned Git, SQLite, source, and runtime authority;
- renderer UI never fabricates source, command, review, or browser evidence.

## Tool Model

Use a stable workspace container with a selected tool:

```text
SideWorkspace
  active_tool: project_browser | general_browser | files | review | terminal | side_chat
  project_id
  conversation_id
  draft_id?
  revision_ref?
  selected_file_path?
  selected_change_ref?
  tool_status_projection
```

The container owns layout behavior:

- right-side open/close;
- width and resize;
- focus and keyboard affordances;
- tool tabs or switcher;
- per-tool toolbar slot;
- empty, loading, unavailable, and blocked states.

Individual tools own their content, admission, and evidence.

## Tools

### Project Browser

Project Browser is the Live Preview tool. It is not a general web browser.

It should continue the existing Live Preview track:

- main-owned current draft or saved revision source resolver;
- loopback-only static server for Live Preview V1;
- main-owned `WebContentsView`;
- no renderer source tree, HTML, path, URL, or server authority;
- reload, stop, and evidence projection;
- packaged canary before claiming support.

Project Browser should be the default side workspace tool when a draft has
previewable web output or the user explicitly opens Preview.

It intentionally does not provide an address bar, arbitrary URL navigation,
downloads, persistent cookies, browser history, password storage, or general
tabs. Those features belong to a separate General Browser tool.

### General Browser

General Browser is a future Codex-style browser tool, separate from Project
Browser.

It may eventually include:

- address bar;
- back, forward, reload, and stop;
- tabs and new tab;
- page search;
- zoom;
- screenshot;
- print;
- downloads;
- history;
- cookie and browser data controls;
- optional import of cookies or passwords;
- browser settings;
- user-visible URL and origin indicators.

General Browser has a different risk profile from Project Browser. It can load
external pages, hold browsing state, and expose web content to the user and
possibly to agents. It therefore needs its own authority model before it is
implemented:

- isolated browser profile and session policy;
- explicit external navigation policy;
- download admission and target directory controls;
- cookie, history, cache, and site data retention controls;
- user consent before agent reads page text, DOM, screenshots, cookies, or
  credentials;
- clear separation between browser observations and build instructions;
- no automatic promotion of arbitrary web page content into provider prompt
  context.

General Browser should not reuse Project Browser's preview server or source
resolver authority. Project Browser is for local project artifacts; General
Browser is for user-directed web browsing.

### Files

Files should be the next tool after Browser is reliable.

First version should be read-only:

- project file tree;
- filter/search;
- selected file content;
- file status badges for added, changed, deleted, and unchanged;
- current draft vs saved revision selection;
- no edit, rename, delete, upload, or write authority.

Files must read from main-owned source projections. The renderer must not pass a
filesystem path to main as authority. It may submit only a project/revision/draft
identity plus a selected file id/path already issued by a main-owned projection.

Files becomes the right default tool when:

- the user asks to inspect files;
- the assistant references a concrete source file;
- the user clicks a file in Changes or Review;
- there is no previewable browser output but source artifacts exist.

### Review

Review is a full diff workspace, not just the current compact Changes card.

It should build on existing facts:

- Git candidate receipts;
- draft checkpoint state;
- CheckRun outcome;
- ReviewState projection;
- save gate;
- changed file projections.

Review should eventually include:

- changed file list;
- unified or split diff;
- file filters;
- per-file status;
- CheckRun summary;
- save, discard, skip-check, and later commit/push actions.

Review is more complex than Files because it can authorize product state
transitions. It should remain behind the existing ReviewState, Git, SQLite, and
save authority gates.

### Terminal

Terminal is a future tool and should not be implemented as a raw shell.

It depends on mature command authority:

- CommandProfile discovery;
- explicit user approval;
- bounded process runtime;
- cancel and drain;
- stdout/stderr redaction;
- environment readiness;
- activity locks shared with save/review.

Until those gates are mature, CheckRun is the safer command execution surface.
Terminal should open only for approved bounded commands, not arbitrary renderer
input.

### Side Chat

Side Chat is a future contextual conversation surface.

It should not duplicate the main chat. It should be scoped to the selected
artifact:

- selected file;
- selected diff hunk;
- selected browser state;
- selected terminal/check output;
- selected review item.

Side Chat messages should carry an explicit context reference and should not
silently become build instructions unless routed through the normal composer,
permission, and execution flow.

## Opening Rules

The side workspace can open from user action or system context.

User actions:

- Preview button opens Project Browser;
- New browser tab or URL action opens General Browser after the General Browser
  authority model exists;
- Files button opens Files;
- Changes or Review opens Review;
- approved check/command may open Terminal in the future;
- contextual ask may open Side Chat in the future.

System context:

- after a draft is proposed, open Review or Browser depending on available
  evidence and the previous user intent;
- after Live Preview starts, keep Browser active;
- after a user clicks a file from Review, switch to Files with that file
  selected;
- if a tool becomes unavailable, keep the container open and show a bounded
  unavailable state rather than switching silently.

No automatic opening rule should hide the latest chat, cover the composer, or
force focus away from an active user input.

## Authority Boundaries

The side workspace is a renderer surface. It is not an authority boundary.

Main owns:

- source tree reads;
- Git candidate and revision evidence;
- SQLite conversation and review facts;
- Live Preview source resolver and WebContentsView runtime;
- CheckRun/Terminal process lifecycle;
- save, discard, restore, and future commit/push admission.

Renderer may request:

- current project/conversation identity;
- a selected tool;
- a main-issued file/change/revision/tool id;
- a user command such as reload preview, open file, run approved check, save, or
  discard.

Renderer must not submit:

- source tree bodies;
- arbitrary filesystem paths as authority;
- raw shell commands;
- browser URLs;
- provider prompts or private context;
- Git object ids as unverified authority;
- save/revision facts.

## Files MVP Contract

Files MVP should be pure read-only and can arrive after Browser V1 is stable.

Suggested contracts:

```text
builder-side-workspace-file-tree.v1
  project_id
  source_kind: current_draft | saved_revision | inspected_revision
  root_label
  entries[]
  authority

builder-side-workspace-file-content.v1
  project_id
  source_ref
  file_ref
  text_preview | binary_summary
  language_hint
  status
  authority
```

Required safety tests:

- renderer cannot pass `source_tree`;
- renderer cannot read outside the projected source snapshot;
- stale draft/revision refs fail closed;
- deleted files show metadata but no content body;
- binary files return bounded summary only;
- large files are truncated with explicit status;
- no source write, Git write, SQLite write, provider dispatch, command
  execution, or save admission.

## Relationship To Live Preview

Live Preview remains a tool inside the side workspace.

Short term:

- keep the current `Preview` surface;
- finish Browser runtime evidence and packaged canary;
- avoid renaming implementation files during release stabilization.

Medium term:

- introduce side workspace naming at the UI/container level;
- keep Live Preview contracts preview-specific;
- add Files as a second tool;
- reuse open/close/resize/focus behavior across Browser and Files.

Long term:

- Review becomes the full code review workspace;
- Terminal opens only through approved command authority;
- Side Chat becomes contextual, not a second unbounded composer.

## Maturity Gates

Do not claim the side workspace is complete until:

- Browser has packaged canary evidence;
- Files read-only tree/content projections are main-owned and tested;
- Review save/discard/check transitions are stable under packaged app restart;
- Terminal has bounded command authority and shutdown drain;
- tool switching preserves chat/composer state;
- the latest chat is never covered by the side workspace or composer;
- keyboard and resize behavior are verified at desktop and narrow widths.

## Near-Term Plan

1. Finish Browser V1 and LP6 packaged canary after release boundaries are clear.
2. Rename product language and docs toward `Side Workspace` / `Artifact
   Workspace`, without broad implementation churn.
3. Add Files MVP as read-only tree plus selected file content.
4. Expand Review into a full diff workspace.
5. Add Terminal only after command authority is mature.
6. Add Side Chat as contextual artifact chat after Files and Review exist.
