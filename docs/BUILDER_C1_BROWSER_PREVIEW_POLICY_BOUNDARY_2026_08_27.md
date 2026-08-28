# Builder C1 Browser Preview Policy Boundary

Date: 2026-08-27

Status: first Browser/Preview policy boundary slice after B7.

## Objective

B5-B7 reduced packaged streaming, task-stream, and lifecycle refresh cost. C1
keeps the next Browser/Preview work from crossing into command sandbox,
provider, tool, filesystem, Git, or SQLite authority.

The goal is not to finish the built-in browser. The goal is to make Project
Preview's browser policy explicit and testable before the right drawer grows
more browser capability.

## Implemented Change

Builder now has a main-owned Browser/Preview policy module:

- `electron/builder-browser-preview-policy.cjs`

The policy defines the Project Live Preview browser boundary:

- non-persistent Electron session partition;
- admitted loopback preview origin only;
- downloads, new windows, permissions, preload, renderer IPC, and external
  navigation blocked;
- Node integration disabled, context isolation enabled, Electron sandbox
  enabled, web security enabled;
- command execution, file write, source write, Git mutation, SQLite write,
  provider dispatch, and tool dispatch not performed.

`electron/builder-live-preview-webcontents-view-runtime.cjs` now consumes this
policy to derive `webPreferences` and the renderer-safe authority summary. The
runtime still owns WebContents creation and event policies. The renderer still
receives only status-oriented Live Preview IPC.

## Boundaries

- C1 is not an OS command sandbox provider.
- C1 does not let Browser or Preview approve shell commands.
- C1 does not add a general user web browser, cookies, downloads, uploads, or
  authenticated browsing.
- C1 does not change dependency preparation, command execution, task stream, or
  Workbench lifecycle behavior.
- Browser/Preview policy and command sandbox policy remain separate records.

This separation matters for the right drawer: embedded browser controls may
reload, stop, and report browser evidence, but they must not inherit command
approval or subprocess sandbox authority.

## Acceptance

C1 is accepted when:

1. Browser/Preview policy is represented by a dedicated main-side module;
2. Live Preview WebContents preferences are derived from that policy;
3. runtime status reports the policy version without exposing Electron objects,
   partitions beyond the existing status boundary, process handles, or command
   authority;
4. tests reject attempts to smuggle command authority into Browser/Preview
   policy;
5. existing WebContentsView runtime tests still prove non-persistent session,
   sandboxed preferences, blocked permissions, blocked navigation, blocked
   downloads, and blocked network outside the admitted preview origin.

## Next Step

The next Browser slice should attach this policy to settings/projection
diagnostics before expanding the right drawer browser. User-facing settings can
show "Project Preview: local-only, non-persistent, downloads blocked" without
claiming a completed command sandbox or general browser profile.

## Requalification 2026-08-28

The policy boundary has now been exercised by the real packaged Project Preview
path. Canvas/WebGL execution, loopback reload, sidebar resizing, Stop, restart
cleanup, and external fetch/navigation/window blocking passed. This does not
qualify a general User Web or external Agent Browser. See
[Builder H Phase Desktop RC Evidence](BUILDER_H_PHASE_DESKTOP_RC_EVIDENCE_2026_08_28.md).
