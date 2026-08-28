# Agent Workbench Message Fabric v1 Implementation Gate

Date: 2026-08-21

Status: implemented and release-gated.

## Delivered Slice

This slice establishes the first durable Agent Workbench path. A projectless
conversation with the default Builder Agent is now recorded as typed,
main-owned Workbench messages and rendered from a declarative projection.

The slice deliberately does not create a Project or Task merely because the
owner starts chatting. Project work still crosses the existing explicit
Project and Task execution boundary.

## Runtime Contract

- Canonical message envelope, thread, and user-state contracts reject proxies,
  accessors, unknown keys, malformed identifiers, and oversized payloads.
- SQLite owns immutable messages, threads, cursors, inbox counts, and mutable
  per-owner message state.
- Agent conversation recording is idempotent and maps owner and Agent turns to
  typed Workbench messages.
- Unknown namespaced content types survive storage but project to bounded plain
  fallback text. Raw plugin payloads never reach the renderer.
- Renderer IPC is sender-bound and exposes only read plus bounded message-state
  updates. It grants no provider, permission, filesystem, Git, or execution
  authority.
- The preload contract is `builder-preload.v32` and exposes the exact
  `agentWorkbench.read`, `agentWorkbench.updateMessageState`, and
  `agentWorkbench.subscribeChanged` surface.

## Renderer Contract

- Selecting the Builder Agent shows an Agent Workbench stream, not a Project
  Task transcript.
- A projectless conversation hides the persistent `Choose project` context.
  The workspace picker appears only when the owner explicitly opens it or a
  Build path requires Project binding.
- Owner messages, Agent Markdown, safe links, unknown-message fallback, unread
  state, and live output use stable declarative presentation.
- Refresh is stale-while-revalidate: an existing projection remains mounted
  while a new main-owned projection is read, avoiding loading replacement
  flicker.
- Restart reads the same canonical Workbench projection from SQLite.

## Verification Evidence

- TypeScript and Vite production build: passed.
- ESLint: passed.
- Focused Workbench and application renderer tests: 227 passed.
- Builder page regression tests: 106 passed.
- Workbench contract/store/recording/IPC tests: passed.
- Generation runtime restart projection test: passed.
- Architecture, Electron security, and packaged-launch gates: 13 passed.
- Repository boundary suite: 1797 passed, 1 skipped; its only failure was the
  old preload invocation count and passed after correction from 53 to 55.
- Windows installer and unpacked application build: passed.
- ASAR/package verification: passed with 993 entries and network-denied CSP.
- Packaged zero-input launch: passed with `builder-preload.v32`.
- Packaged local-provider canary observed the projectless Workbench answer and
  continued into Project generation. It later stopped in the pre-existing
  review-diff convergence path while side-workspace content remained loading;
  that failure is outside this Workbench message slice.

Existing React test `act(...)` warnings remain in a few older BuilderApp tests;
they do not fail the suite and were not introduced as Workbench authority.

## Next Major Slice

Build Task incubation and delegation on top of the Message Fabric:

1. Add typed task proposal, permission request, task status, task result, and
   collaboration invitation messages.
2. Add an action broker that converts explicit owner approval into existing
   main-owned Project and Task commands.
3. Project active and completed parallel Tasks into a right-side task surface
   while keeping the Workbench relationship stream coherent.
4. Add thread focus and inbox navigation without turning each message source
   into an execution authority.

Long-term memory admission and autonomous scheduling remain separate later
slices. Neither should be smuggled into Message Fabric delivery state.
