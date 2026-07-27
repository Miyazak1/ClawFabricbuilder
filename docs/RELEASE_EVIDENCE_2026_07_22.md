# Release Evidence - 2026-07-22

## Scope

This record binds the first Builder Coding MVP trial evidence to repository HEAD
`a7e0fc2` and the locally built Windows package. It is a dated checkpoint, not a
claim that later commits automatically inherit the same evidence.

## Repository Evidence

- `npm test`: 23 Vitest files / 252 tests and 174 Node boundary tests passed.
- `npm run pack`: renderer typecheck/build passed; 1,796 modules transformed;
  `win-unpacked` and package verification passed.
- Package verification reported production network-denying CSP and 27 ASAR
  entries.

## Real Provider and Restart Evidence

The packaged app was exercised with a saved OpenAI-compatible DeepSeek profile:

- encrypted provider configuration restored through Electron safe storage;
- generation was initiated through the visible Builder UI;
- one immutable Project Revision was saved;
- static preview was nonblank and retained script-denying policy;
- restart reopened the same revision and preview digest;
- restart did not create a new revision or redispatch generation;
- the source provider profile remained unchanged;
- no unexpected renderer network request was observed during the canary scope.

Credentials, provider identifiers, prompts, generated source, filesystem paths,
and encrypted blobs were not placed in the evidence packet.

## Installer Evidence

- `npm run dist` produced `ClawFabric Builder Setup 0.1.0.exe`.
- The installer was exercised in a guarded one-time install directory.
- The installed tree contained every `win-unpacked` source file with matching
  content; the only additional file was the uninstaller.
- The installed executable passed the same saved-profile generation, revision,
  preview, and restart canary.
- The official uninstaller removed the guarded install and shortcuts.
- The real Builder profile snapshot remained byte-for-byte unchanged across
  uninstall for the observed Local State, provider config, and encrypted secret
  files.

The installer is not code signed. Windows may display SmartScreen warnings. This
checkpoint is suitable for controlled trial distribution, not a claim of public
release readiness.

## 2026-07-25 Packaged Canary Refresh

This addendum records a fresh packaged-app canary after the Builder saved-profile
DeepSeek path was extended to cover explicit unsaved draft restore, review
diff/preview evidence, saved-history return, and restart continuation. It is
canary evidence only; it does not extend installer evidence, code-signing status,
or public release readiness.

- `npm run pack` passed on the refreshed source tree; package verification
  reported 720 ASAR entries.
- The packaged app was exercised with the saved DeepSeek profile through the
  visible Builder UI, without moving provider credentials into argv, env, logs,
  or renderer-readable evidence.
- The canary saved revision 1, produced an unsaved update draft, restored that
  pending draft after restart with Save still explicit, saved revision 2, returned
  from historical preview to current, and continued generation after restart.
- Draft review evidence was visible before Save for the initial draft, update
  draft, pending update after restart, and restart-continuation draft.
- Static preview evidence stayed nonblank with script-denying preview policy, and
  no unexpected renderer network request was observed during the canary scope.

## 2026-07-27 Controlled Plan Review Action Checkpoint

This addendum records verification for code checkpoint `42a1859`, which exposed
the main-owned plan review fact through one controlled renderer request path.
It is not a real-provider canary and does not claim code execution, source
mutation, Save, Project Revision, publication, or arbitrary tool authority.

- Targeted Node tests for the plan-review IPC adapter and generation IPC
  runtime passed: 22 tests.
- Targeted Vitest for the renderer bridge root, plan-review port,
  BuilderPage, BuilderApp, and Builder architecture boundary passed: 49 tests.
- `node --test tests\verify-packaged-canary.test.cjs` passed: 35 tests, after
  extending canary evidence to prove the `planReview` namespace is exactly the
  review method.
- `npm run typecheck`, `npm run lint`, and `npm run test` passed. The full test
  run reported 31 Vitest files / 279 tests; `test:boundaries` reported 487
  Node-test subtests passed.
- `npm run pack` passed; package verification reported production
  network-denying CSP and 740 ASAR entries.
- Local Chromium visual QA against the Vite renderer with an injected
  renderer-safe bridge fixture passed at 1440x950, 900x800, and 390x844. The
  run verified visible plan Approve/Reject controls, no Save Version control for
  plan-only output, no visible internal authority/receipt/provider/credential
  text, no button text overflow, nonblank screenshots, and no bottom-composer
  cover after scrolling the plan action controls into view. Screenshots were
  captured under the system temp evidence directory and were not committed.
- An independent read-only review found no edit, generate, save, revision,
  source, provider, or credential authority leak in the plan-review path. Its
  only finding was the packaged canary namespace evidence gap, which was fixed
  before the final full test and package verification reruns.

## 2026-07-28 Desktop Conversation Workspace Package

This addendum records the desktop-visible conversation workspace package at code
checkpoint `acda864`. It is not a new real-provider canary and does not extend
the earlier saved DeepSeek evidence. It verifies the renderer-visible
conversation, review, static-preview explanation, live-output projection, and
package content for the current desktop trial build.

- The latest local package is
  `release\acda864\win-unpacked\ClawFabric Builder.exe`.
- Focused renderer tests for the Builder page passed: 39 tests.
- Full unit tests passed: 333 Vitest tests.
- `npm run lint` and `npm run build` passed.
- Package verification reported `builder_package_verified`, production
  network-denying CSP, app id `com.clawfabric.builder`, product name
  `ClawFabric Builder`, and 741 ASAR entries.
- The desktop UI now keeps the composer in the main conversation bottom with one
  primary action: Enter or the send button submits an idle turn, and active work
  replaces that action with Stop. Submitted text is cleared on success and
  restored only after a submit failure.
- Assistant replies and live provider-output projection render as plain
  conversation messages, while user-submitted messages render as the only bubble
  surface. Durable Run progress rows are folded into one ordinary assistant work
  status when no display-safe live text is available.
- Generated draft review actions now appear in the main conversation flow before
  the result preview. Draft Changes remain summarized until opened on demand, so
  the right versions sidebar does not squeeze unsaved-draft review.
- Static preview now explains when JavaScript, modules, Three.js/WebGL, canvas,
  network assets, or backend/server requirements can make a safe preview look
  blank. The explanation does not claim that generated files failed or that
  generated runtime code was executed.
- A screenshot was captured under the local temp evidence directory for the
  desktop package view. It is local evidence only and was not committed.

## 2026-07-28 Active Composer Steering Package

This addendum records the current desktop trial package after the active
composer steering checkpoint. It is not a new real-provider canary and does not
extend the earlier saved DeepSeek evidence. The packaged application content is
the desktop package produced at checkpoint `df373e2`, with verifier/canary
evidence refreshed at checkpoint `125c438`.

- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`.
- Focused renderer and controller tests for active composer steering passed:
  102 tests.
- Full renderer unit tests passed: 339 Vitest tests.
- Node boundary tests passed after the steering bridge: 518 subtests.
- The packaged canary verifier tests passed after accepting legal active-run
  steering facts: 39 tests.
- Node boundary tests passed after the canary refresh: 519 subtests.
- `npm run typecheck`, `npm run lint`, `npm run build`, package verification,
  and the local package verifier passed during the desktop steering package
  checkpoint.
- The desktop composer remains one input surface. Idle work submits with Enter
  or the single send button; active bound work reuses the same composer to add
  bounded context and keeps Stop as the separate cancel control.
- Successful submitted or steering text is cleared from the composer and remains
  visible only as conversation activity. Failed steering restores the typed
  text instead of silently losing it.
- The active steering fact is recorded through the main-owned run context and
  appears only as renderer-safe task-stream activity. It does not claim to
  mutate an already-issued provider request, dispatch tools, read source, create
  Git evidence, save a Project Revision, or expose provider/credential/source
  authority.
- The packaged canary evidence now accepts legal steering messages only while a
  run is active, requires them after `run_started` and before `run_completed`,
  and rejects terminal-after steering. Candidate, Review, Save, and revision
  counts remain independently verified.
- A desktop screenshot was captured at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-packaged-desktop-steering.png`.
  It is local evidence only and was not committed.

## 2026-07-28 Saved DeepSeek Desktop Canary

This addendum records a real saved-profile DeepSeek desktop canary for code
checkpoint `419b16f`. It is desktop package evidence only; it does not extend
installer evidence, code-signing status, public release readiness, or mobile
visual evidence.

- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`.
- Focused desktop renderer tests for BuilderPage and BuilderApp passed:
  60 tests.
- Full tests passed: 342 Vitest tests and 525 Node-test boundary subtests.
- `npm run lint` passed.
- The packaged canary verifier tests passed: 39 tests.
- `npm run pack` passed for the same source tree before the checkpoint commit;
  package verification reported `builder_package_verified`, production
  network-denying CSP, app id `com.clawfabric.builder`, product name
  `ClawFabric Builder`, and 741 ASAR entries.
- The packaged app was exercised with the saved DeepSeek profile through the
  visible desktop Builder UI. Provider credentials were not accepted through
  stdin, argv, env, logs, or renderer-readable evidence, and the source profile
  remained unchanged.
- The canary saved Version 1, answered a saved-project question without creating
  a draft or revision, produced an unsaved update draft, restored that pending
  draft after restart with Save still explicit, saved Version 2, inspected saved
  history, returned to the current preview through the single header return
  action, restored the project after restart, and continued generation after
  restart into a pending candidate.
- Static preview evidence stayed nonblank with script-denying preview policy and
  the current user-facing blank-preview explanation. The canary now verifies the
  `Preview may look blank` wording, including JavaScript modules, Three.js, and
  the instruction to review Changes or Source before saving.
- No unexpected renderer network request was observed during the canary scope.

## Evidence Inheritance Rule

Later changes to generation, provider storage, project persistence, preview,
Electron shell, packaging, installer configuration, or canary logic must rerun
the affected evidence. Documentation alone does not extend this checkpoint.
