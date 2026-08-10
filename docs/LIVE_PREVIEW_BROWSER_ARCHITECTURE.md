# Live Preview Browser Architecture

This document defines Builder's future built-in browser for interactive project
preview. It is a post-MVP feature track that can be designed and implemented in
parallel only when it does not interfere with the MVP Programming Loop.

## Product Decision

Builder should keep the existing static preview as the safe default and add a
separate Live Preview runtime for projects that need JavaScript, canvas,
Three.js, WebGL, routing, timers, or other browser behavior.

The built-in browser is not a general web browser. It is an isolated local
preview surface for reviewed or draft project files.

## Current State

Current preview is a renderer-side static iframe:

- source: `BuilderSourceTreePreviewProjection`;
- component: `BuilderStaticPreview`;
- render mode: `<iframe sandbox="" srcDoc=...>`;
- CSP: `script-src 'none'`;
- JavaScript, iframe, object, embed, unsafe URL attributes, and app/server code
  are stripped or classified as runtime limitations;
- packaged canary already verifies static preview, runtime-unavailable copy,
  sandbox attributes, CSP, nonblank pixels, and restart preview restoration.

This is good and should remain. Live Preview must be additive.

## Static Preview Retirement Policy

Static Preview is a temporary primary preview surface and a long-term safety
fallback. It should not stay as a user-facing peer once the built-in browser is
proven reliable.

Retirement should happen in three stages:

1. **Primary de-emphasis**
   After Live Preview V1 has a real source resolver, WebContentsView attachment,
   packaged canary, restart cleanup, and nonblank JavaScript/canvas/WebGL
   evidence, Browser Preview becomes the default for web projects. Static moves
   behind a secondary `Safe preview` action.

2. **User-facing removal**
   After Browser Preview has passed at least one release cycle with packaged
   evidence for saved revisions, current drafts, failed runtime fallback,
   restart recovery, and permission-denied states, the `Static` mode switch can
   be removed from the normal Review Workspace. Static remains available only
   through error fallback, diagnostics, or a security review surface.

3. **Code deletion**
   Delete `BuilderStaticPreview` and static-preview canary coverage only after a
   replacement Browser Preview can prove every current static-preview guarantee:
   safe rendering without source mutation, no app IPC/Node/provider/tool
   authority, deterministic restart restoration, nonblank visual evidence, and
   clear behavior when JavaScript, WebGL, local servers, or network access are
   denied. If any guarantee is still unique to Static Preview, keep the code as
   hidden infrastructure instead of deleting it.

Do not delete Static Preview during the MVP Programming Loop. The first deletion
candidate is post-Live Preview V2, after dynamic dev-server preview has its own
permission, process lifecycle, network policy, packaged canary, and rollback
evidence.

## Electron Surface Choice

Use main-owned `WebContentsView` as the long-term embedded browser surface.

Do not use `BrowserView` for new work. Electron marks `BrowserView` deprecated
and points new embedded-content work at `WebContentsView`.

Do not use the renderer `<webview>` tag for MVP Live Preview. Electron's own
documentation does not recommend it because of stability and architectural
concerns, and enabling it would move too much preview authority into the
renderer.

Do not use ordinary renderer iframes for Live Preview. Iframes remain useful
for static sanitized `srcDoc`, but they cannot become Builder's trusted runtime
browser because they would mix preview lifecycle, evidence capture, navigation
control, and app UI concerns in the renderer.

Reference:

- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/api/browser-view
- https://www.electronjs.org/docs/latest/api/webview-tag
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/tutorial/web-embeds

## Non-Goals

Live Preview V1 must not:

- browse arbitrary external sites;
- load project files through unrestricted `file://` URLs;
- expose Node.js, Electron, preload, IPC, filesystem, Git, SQLite, provider,
  shell, secret, or permission authority to preview content;
- install dependencies;
- start a framework dev server;
- run backend code;
- access external network by default;
- save versions;
- publish or share;
- replace Review/Save authority.

## Supported Scope

Live Preview V1 supports static web projects that can run from local files
served through Builder's read-only preview server:

- `index.html`;
- CSS;
- local JavaScript files;
- local ES modules;
- canvas;
- WebGL and Three.js when assets are local;
- hash/history navigation inside the preview origin;
- local image/font/media assets when safe and bounded.

Deferred:

- Vite/React/Next dev-server adapters;
- backend/full-stack preview;
- dependency installation;
- external network assets;
- authenticated browser sessions;
- editing DOM elements from the preview surface.

## Dynamic Site Roadmap

Dynamic preview should be added in layers after the static-web browser path is
real.

V2 supports framework dev servers such as Vite, React, Vue, and Next dev mode.
It must be a dedicated dev-server adapter, not an escape hatch from the static
preview runtime.

V2 admission requires:

- a `CommandProfile`-discovered dev command, such as `npm run dev`, selected by
  main from project metadata and package scripts;
- explicit user permission before starting any process;
- loopback-only port ownership, with main selecting or validating the port and
  denying external bind addresses;
- bounded process lifecycle: start, health check, log collection, restart, stop,
  and cleanup on window close or app restart;
- redacted logs that do not expose secrets, environment values, provider
  context, source contents, or internal ids to renderer projections;
- navigation limited to the owned loopback origin;
- external network policy recorded as evidence and denied by default unless a
  later permission explicitly allows it;
- no source, Git, SQLite, provider, tool, permission, or save authority inside
  the preview contents.

V3 supports backend or full-stack preview only after separate security design
for environment variables, secrets, databases, migrations, authentication,
external network, long-running services, and process isolation.

V2 and V3 are post-MVP tracks. They must not block the current CheckRun,
Review/Save, restart recovery, or packaged MVP canary gates.

## Architecture Overview

```text
ReviewState or DraftCheckpoint
-> LivePreviewAdmission
-> Preview Source Snapshot
-> Read-only Local Preview Server
-> Main-owned WebContentsView
-> Preview Evidence Collector
-> PreviewRun fact
-> Renderer-safe PreviewStatusProjection
-> Review Workspace
```

The renderer asks for a preview. Main owns admission, server creation,
WebContentsView lifecycle, navigation policy, permission policy, evidence
capture, and disposal.

## Main Facts

```text
LivePreviewAdmission
  admission_id
  project_id
  conversation_id
  task_id?
  run_id?
  draft_checkpoint_id?
  source_tree_digest
  selected_entry_path
  preview_kind
  admitted_at_ms
  expires_at_ms
  authority

PreviewRun
  preview_run_id
  admission_id
  project_id
  source_tree_digest
  entry_url
  status
  started_at_ms
  completed_at_ms?
  console_error_count
  console_warning_count
  navigation_block_count
  network_block_count
  screenshot_digest?
  canvas_pixel_status
  webgl_status
  error_summary?
```

Allowed `PreviewRun.status`:

- `admitted`;
- `server_starting`;
- `loading`;
- `ready`;
- `ready_with_warnings`;
- `blocked`;
- `failed`;
- `stopped`.

## Preview Server

Live Preview V1 should use a main-owned read-only loopback server.

Rules:

- bind only to `127.0.0.1`;
- choose an ephemeral port;
- serve only the admitted source snapshot;
- resolve every request through normalized project-relative paths;
- deny path traversal, absolute paths, symlinks escaping the project root, and
  dot-Git internals;
- set restrictive response headers;
- no directory listing;
- no write endpoints;
- no proxying external network requests;
- dispose server when preview is closed or admission expires.

The server is evidence infrastructure, not a general dev server.

## WebContentsView Policy

Create preview contents in a dedicated non-persistent session partition such as
`preview:<admission_id>`.

Required web preferences:

- `nodeIntegration: false`;
- `contextIsolation: true`;
- `sandbox: true`;
- no preload by default;
- web security enabled;
- devTools disabled in packaged builds unless a later diagnostic gate allows
  it.

Required policies:

- deny permission requests;
- deny new windows;
- deny downloads;
- deny navigation outside the admitted preview origin;
- block external network by default;
- clear session storage on disposal;
- do not expose app IPC to preview contents.

## Network Policy

V1 network policy is local-only:

- allow admitted preview origin;
- allow same-origin local assets served by the preview server;
- deny `http`, `https`, `ws`, `wss`, `file`, `ftp`, `data` top-level
  navigations unless explicitly admitted by later gates;
- record blocked external requests as evidence.

Future external asset support requires a separate permission and privacy gate.

## Renderer IPC Surface

Renderer-safe APIs should be narrow and status-oriented:

```text
livePreview.requestCurrentDraftPreview({ project_id, conversation_id })
livePreview.reloadCurrentPreview({ project_id, conversation_id })
livePreview.stopCurrentPreview({ project_id, conversation_id })
livePreview.readCurrentPreviewStatus({ project_id, conversation_id })
```

Renderer must not pass:

- paths;
- arbitrary URLs;
- HTML strings;
- source content;
- command strings;
- preload paths;
- session partitions;
- BrowserWindow/WebContents identifiers.

Main resolves the current draft/review source from existing stores.

## UI Integration

Live Preview belongs in the Review Workspace right drawer.

UI behavior:

- keep `Preview` as the same user-facing tab;
- static preview remains the fallback and first render path;
- when Live Preview is available, show a compact segmented preview mode:
  `Static` / `Live`;
- before the source resolver and browser runtime are connected, keep Live
  disabled or visually secondary with `Browser preview unavailable`; do not make
  it look like a usable peer mode;
- if Live Preview is blocked after the runtime exists, show the
  runtime-unavailable message with a clearer reason;
- provide reload and stop controls only inside the preview toolbar;
- do not duplicate the global workspace selector inside the drawer content;
- do not hide latest chat behind the preview surface or composer;
- preview controls never save a version.

## Evidence Capture

Preview evidence must be captured in main or canary-controlled automation:

- console errors and warnings;
- navigation blocks;
- network blocks;
- screenshot digest;
- nonblank pixel evidence;
- canvas pixel status;
- WebGL context status;
- load timing and terminal status.

Renderer-safe projection should expose only summary fields:

```text
PreviewStatusProjection
  preview_kind
  status_label
  tone
  console_error_count
  console_warning_count
  blocked_request_count
  canvas_pixel_status
  webgl_status
  can_reload
  can_stop
```

Raw console text, source content, URLs beyond the preview origin, screenshots,
and internal ids remain main-owned evidence.

## Canary

Add a focused packaged canary before claiming Live Preview support.

Minimum canary project:

- `index.html`;
- local CSS;
- local JavaScript module;
- canvas draw;
- WebGL or Three.js-like canvas path without external assets.

Canary must prove:

- Live Preview launches from the review drawer;
- JavaScript executes;
- canvas/WebGL pixels are nonblank;
- console errors are captured;
- external network request is blocked and counted;
- navigation outside preview origin is blocked;
- preview stop disposes the server/session;
- restart returns to safe static or stopped state, not a dangling live server;
- no renderer IPC, Node.js, filesystem, Git, SQLite, provider, or shell
  authority is exposed to preview content.

## Implementation Slices

### Slice LP0: Architecture And Boundary Tests

Docs, static source checks, and boundary tests only.

Evidence:

- `BrowserView` is not used for new preview runtime;
- `<webview>` remains disabled;
- main window security defaults stay intact;
- static preview behavior remains unchanged.

### Slice LP1: Main-Only Preview Contracts

Add `LivePreviewAdmission`, `PreviewRun`, and sanitizer tests.

No Electron view, server, IPC, renderer UI, source mutation, or provider path.

### Slice LP2: Read-Only Preview Server

Add main-owned loopback static server over an admitted source snapshot.

Evidence:

- path traversal denied;
- symlink escape denied;
- dot-Git denied;
- external proxy denied;
- server disposes.

### Slice LP3: WebContentsView Runtime

Create and manage a dedicated `WebContentsView` for admitted previews.

Evidence:

- dedicated non-persistent session;
- permission requests denied;
- external navigation denied;
- new windows denied;
- downloads denied;
- no preload or Node integration.

Current checkpoint:

- add a preview-specific main-only WebContentsView runtime;
- accept only an existing `LivePreviewAdmission` and read-only static server;
- install navigation, network, permission, new-window, and download policies;
- return only a main-owned handle for future attachment;
- do not register IPC, change renderer UI, or touch provider/source mutation
  paths.

### Slice LP4: Evidence Collector

Capture console, navigation, network, screenshot, canvas, and WebGL summaries.

Evidence:

- nonblank canvas/WebGL canary;
- console error count;
- blocked request count;
- no raw source or console text in renderer projection.

Current checkpoint:

- add a preview-specific main-only evidence summary contract;
- accept only safe WebContentsView runtime status and bounded event summaries;
- count console errors/warnings and blocked runtime events;
- store screenshot as a digest only;
- store entry URL as a digest only;
- do not collect raw console text, external URLs, screenshot bytes, source
  content, IPC, renderer UI, provider, tool, or mutation authority.

### Slice LP5: Renderer Status And Review Drawer Integration

Expose minimal IPC and show Live Preview as a mode inside the existing Preview
drawer.

Evidence:

- static fallback still works;
- Live mode can start/stop/reload;
- duplicated preview controls do not return;
- newest chat remains visible.

Current checkpoint:

- add preview-specific `livePreview` preload namespace with
  `requestCurrentDraftPreview`, `reloadCurrentPreview`,
  `stopCurrentPreview`, and `readCurrentPreviewStatus`;
- register a preview-specific IPC runtime with active-renderer binding and
  exact `{ project_id, conversation_id }` payloads;
- expose only renderer-safe `builder-live-preview-status-projection.v1`;
- keep renderer source upload closed: renderer cannot pass `source_tree`, HTML,
  paths, URLs, session partitions, WebContents ids, or preload data;
- show `Static` / `Live` mode in the existing Preview panel, with Live
  start/reload/stop controls;
- when the main-owned preview source resolver is not connected, Live mode
  shows a truthful unavailable state instead of pretending a browser is
  running;
- do not attach `WebContentsView` to UI yet, do not mutate source/Git/SQLite,
  do not dispatch provider/tools, and do not save or admit revisions.

### Slice LP5b: Main-Owned Preview Source Resolver

Resolve trusted preview source snapshots for future Live Preview services.

Evidence:

- current draft source resolves only from the current DraftCheckpoint plus a
  fresh verified Git candidate read;
- saved revision source resolves only from existing Git plus SQLite Project
  Revision read authority;
- both paths bind exact project, conversation, candidate/checkpoint or revision,
  commit/tree, and source tree digest;
- renderer cannot provide `source_tree`, paths, URLs, HTML, or file contents;
- output is a main-only in-memory snapshot for future preview services;
- no user workspace write, server start, WebContentsView attachment, IPC
  registration, package/canary change, provider/tool dispatch, Save, or Revision
  admission.

Current checkpoint:

- add `builder-live-preview-source-resolver.v1`;
- expose `resolveCurrentDraftPreviewSource` and
  `resolveSavedRevisionPreviewSource`;
- fail closed with unavailable status when the required existing authority is
  absent, and reject drifted checkpoint, candidate, revision, commit/tree, or
  source tree digest evidence;
- keep the current renderer UI unchanged.

### Slice LP6: Packaged Live Preview Canary

Add `verify:packaged-live-preview` and include it in release only after stable.

Evidence:

- packaged app launches;
- local static-web preview runs JavaScript;
- WebGL/canvas nonblank proof passes;
- blocked network and navigation evidence passes;
- restart cleanup passes.

## Relationship To MVP Programming Loop

Live Preview is not required for the first MVP loop. The MVP may ship with
static preview plus clear runtime-unavailable messaging.

However, LP0-LP2 can be developed in parallel if they stay main-only and do not
touch Plan, ProgrammingRun, source edit, Review/Save, or provider prompt paths.

Live Preview becomes necessary before Builder claims strong support for:

- interactive web apps;
- canvas animation;
- Three.js/WebGL;
- browser routing;
- UI behavior verification.
