# Builder I1 Agent Browser Gate

Date: 2026-08-28

Status: accepted for the I1 scope. Focused tests, current packaged desktop,
real DeepSeek end-to-end, deterministic cancellation, restart cleanup, and
reference-machine performance evidence passed on 2026-08-28.

## Objective

I1 closes the first useful Browser loop without merging browser authority into
command execution, dependency preparation, project writes, or provider access.
The product presents one right-side Browser shell backed by three Main-owned
session classes:

| Session class | Owner | Navigation | Storage | Model access |
| --- | --- | --- | --- | --- |
| Project Preview | project preview admission | admitted loopback origin | ephemeral | preview evidence only |
| Agent Test | one programming run | admitted loopback origin | fresh ephemeral partition | bounded observation and actions |
| User Web | explicit user navigation | HTTP(S), one admitted origin per session | ephemeral in I1 | none |

The renderer never receives an Electron partition, WebContents, raw page
handle, debugging endpoint, cookie, or storage path.

## Implemented Facts

- `builder-browser-session-registry.v1` owns session admission, private
  partitions, lifecycle state, bounded cleanup, and class diagnostics.
- Agent Test can open the current run's local HTML app, observe bounded visible
  text, element references, accessibility facts, screenshot status, Console,
  and Network facts, then click, type, select, press keys, scroll, reload latest
  source, and close.
- Each Agent Test action records before/after observation digests. Repair can
  replace the server and session, then verify the latest source again.
- Agent Test native view layout is keyed by `owner_run_id`. The renderer reports
  only the visible right-sidebar rectangle; Builder Main verifies the active
  run, constrains bounds to the current window content area, and applies
  visibility. Stale runs receive `not_active` and cannot move another view.
- User Web navigation is explicit and Main-owned. Credentials in URLs,
  non-HTTP(S) schemes, cross-origin redirects, popups, permissions, and
  downloads are rejected in I1. User Web page content is not provider context.
- Project Preview, Agent Test, and User Web use separate partitions and cannot
  borrow one another's authority.
- Run cancellation, replacement, interruption, normal completion, app shutdown,
  and user close have distinct close reasons. WebContents are destroyed and
  ephemeral storage cleanup is bounded.
- The composer Stop action remains available while durable Agent Test Browser
  activity is active. Stop closes the run-bound Browser session through a
  narrow Main-owned IPC before cancelling any remaining generation request.
- A new process registry starts empty and cannot treat a pre-restart ephemeral
  session ID or partition as active authority.
- User Web reload waits for a real load completion/failure event instead of
  marking the page ready immediately after calling reload.

## Hard Bounds And Release Budgets

Hard correctness bounds in code:

| Operation | Bound |
| --- | --- |
| Agent Test initial load | 10,000 ms |
| Agent Test DOM/action script | 3,000 ms |
| Agent Test screenshot capture | 1,500 ms |
| User Web navigation or reload | 15,000 ms |
| Ephemeral browser storage cleanup | 1,000 ms |
| Visible DOM text | 16 KiB |
| Element references | 128 |
| Accessibility nodes | 192 |
| Console records | 100 |
| Network records | 100 |

Release measurements on the reference Windows machine must also satisfy:

- `main.user_web.layout.duration_ms` p95 <= 8 ms;
- `main.agent_test_browser.layout.duration_ms` p95 <= 8 ms;
- `main.browser_session.open.duration_ms` p95 <= 25 ms;
- responsive storage cleanup p95 <= 25 ms, while the 1,000 ms hard bound still
  prevents shutdown hangs;
- Browser observation must not push Main event-loop delay p95 above 25 ms;
- opening, resizing, observing, and closing Browser must not block composer
  input or trigger a complete conversation/task-stream replay;
- Browser metrics record numeric aggregates only, never URLs, page text, paths,
  identifiers, screenshots, or credentials.

These release budgets are acceptance targets, not claims from unit-test wall
times. They require a packaged trace from the qualification machine.

## Automated Evidence

The focused noninteractive Browser suite passed on 2026-08-28:

- 114 Node tests covering session contracts, registry, Project Preview, Agent
  Test, User Web, Harness broker/plugin/composition, cancellation, cleanup,
  performance trace, Main startup, and Electron security boundaries;
- 135 `BuilderPage` tests covering the right-side Browser surface and explicit
  User Web navigation;
- 131 `BuilderApp` tests, 25 desktop layout contract tests, bridge and User Web
  port tests;
- 14 real-DeepSeek packaged Harness canary contract tests. The canary now
  requires the model to consume bounded DOM/accessibility, screenshot-status,
  Console, and Network facts; observes the automatically activated Browser tab;
  proves its visible surface is contained by the artifact sidebar; and requires
  that surface to close after the run;
- `npm exec tsc -b --pretty false`;
- focused CJS ESLint checks.

The layout contract deliberately keeps the chat flow in a normal-flow inner
column and the draft decision card in normal composer flow. It does not restore
the older absolute-positioned card that could cover recent output.

The latest qualified Windows artifact was rebuilt on 2026-08-28 at 19:40 local
time. `verify:package` passed against its packaged `app.asar` with the exact
preload bridge and all three Browser boundaries.

## Packaged Real-Model RC

The current package passed this RC with the configured DeepSeek model and
disposable saved test projects.

1. Start a new task from an approved plan and build a small local Web app.
2. Confirm the Browser tab opens automatically when Agent Test starts and the
   native page is visibly contained in the right sidebar at the current window
   size.
3. Confirm the first frame is nonblank and the conversation remains scrollable;
   latest output and composer stay visible without overlap.
4. Introduce one deterministic DOM, Console, Network, or visual defect. Confirm
   DeepSeek observes it through Agent Test, edits the project, reloads latest
   source, and returns second-observation proof.
5. Cancel during Browser work. Confirm the task reaches one terminal state,
   composer unlocks, the Browser view disappears, and no stale `Stop` action or
   active session remains.
6. Restart the app with the same user data. Confirm no Agent Test or Project
   Preview session resumes silently and User Web requires explicit navigation.
7. Capture the performance trace and evaluate the release budgets above.

Step 2 now qualifies the dedicated Agent Test layout IPC keyed by the active
run ID. Fixed Main fallback bounds are used only before the renderer publishes
the first verified sidebar rectangle and are not sufficient acceptance
evidence. The real-provider canary records the contained sidebar and surface
rectangles and fails if the active tab is not `browser_placeholder` or the
surface remains active after completion. No GUI automation or desktop takeover is authorized for this RC
unless the user gives new explicit permission.

### User-driven command

Run this only after the user explicitly authorizes launching and automating the
packaged desktop RC. It copies the verified provider profile into disposable
canary user data; it does not print or place the credential in the command.

```powershell
$input = @{
  schema_version = 'builder-deepseek-packaged-canary-input.v2'
  mode = 'saved_profile'
  executable_path = (Resolve-Path '.\release\win-unpacked\ClawFabric Builder.exe').Path
  source_user_data_path = (Join-Path $env:APPDATA 'clawfabric-builder')
} | ConvertTo-Json -Compress
$input | node scripts/verify-deepseek-packaged-harness-canary.cjs --execute
```

The accepted real-model result includes
`agent_browser_opened_current_run_source: true`,
`agent_browser_reloaded_latest_run_source: true`, a bounded
`agent_browser_right_sidebar_surface`, and
`agent_browser_surface_closed_after_run: true`. It must also include
`save_version_completed: true`; reaching `Unsaved draft` is an intermediate
review checkpoint, not successful end-to-end completion.

The deterministic cancellation RC is
`npm run verify:packaged-agent-browser-cancellation`. It proved the active
surface and loopback WebContents were observed, cancellation was requested from
the UI, the composer recovered, the ephemeral WebContents was released, and a
same-user-data restart restored neither the surface nor a loopback WebContents.
The real DeepSeek RC measured cleanup p95 7.904 ms, layout p95 2.272 ms, and
open p95 1.91 ms, all within the release budgets.

The exact saved-profile input above passed a non-launching dry run on
2026-08-28: the production parser accepted it, the selected executable existed
at 210,939,904 bytes, and the bounded profile inspector verified
`deepseek-v4-flash` at `https://api.deepseek.com/v1`. This dry run did not start
Electron or contact the provider.

## Deferred Product Scope

Tabs, downloads, persistent User Web profiles, cookie/history controls,
credential import, external-origin agent navigation, uploads, arbitrary CDP,
and logged-in account automation remain future capabilities. Their absence in
I1 is intentional and must not be represented as an implementation failure.
