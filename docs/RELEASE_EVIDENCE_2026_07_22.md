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

## 2026-07-28 Desktop Source Disclosure Package

This addendum records the desktop package refresh for code checkpoint `4b27f23`.
It is not a new real-provider canary and does not extend installer evidence,
code-signing status, public release readiness, or mobile visual evidence.

- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`.
- Focused BuilderPage tests passed after the source disclosure change:
  41 tests.
- `npm exec tsc -b --pretty false`, `npm run lint`, and `git diff --check`
  passed before this package refresh.
- `npm run pack` passed for checkpoint `4b27f23`; package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 741 ASAR
  entries.
- Project source remains available in the desktop conversation flow, but a
  collapsed source disclosure now renders only the file summary. Source text is
  rendered only after the user opens the disclosure or selects a changed file.

## 2026-07-28 Desktop Conversation Flow Package

This addendum records the desktop package refresh for code checkpoint `f92188b`.
It is not a new real-provider canary and does not extend installer evidence,
code-signing status, public release readiness, or mobile visual evidence.

- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`.
- Focused BuilderPage tests passed after keeping activity refresh out of the
  chat flow: 43 tests.
- Full renderer unit tests passed: 353 Vitest tests.
- Node boundary tests passed: 552 subtests.
- `npm run lint`, `npm run build`, and `git diff --check` passed before this
  package refresh.
- `npm run pack` passed for checkpoint `f92188b`; package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 747 ASAR
  entries.
- The desktop package opens to the conversation-first workspace with the
  composer in the main content bottom and no empty Changes/Versions rail
  occupying the blank-project main stage.
- A desktop screenshot was captured at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-packaged-f92188b-window.png`.
  It is local evidence only and was not committed.

## 2026-07-28 Desktop Review DeepSeek Canary

This addendum records a real saved-profile DeepSeek desktop canary for code
checkpoint `0d92f92`, after stabilizing the desktop draft Review actions. It is
desktop package evidence only; it does not extend installer evidence,
code-signing status, public release readiness, or mobile visual evidence.

- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`.
- Focused desktop UI and layout tests passed: 49 tests.
- Full renderer unit tests passed: 353 Vitest tests.
- Node boundary tests passed: 552 subtests.
- `npm run lint`, `npm run build`, `git diff --check`, and `npm run pack`
  passed; package verification reported `builder_package_verified`, production
  network-denying CSP, app id `com.clawfabric.builder`, product name
  `ClawFabric Builder`, and 747 ASAR entries.
- The saved profile was verified as DeepSeek V4 OpenAI-compatible
  `deepseek-v4-flash`; the canary used the saved-profile path, did not accept
  credentials through stdin, argv, env, logs, or renderer-readable evidence, and
  left the source profile unchanged.
- The packaged app was exercised through the visible desktop Builder UI. The
  canary saved Version 1, answered a saved-project question without creating a
  new draft or revision, produced an unsaved update draft, restored that pending
  draft after restart with Save still explicit, saved Version 2, inspected saved
  history, returned to the current preview, restored the project after restart,
  and continued generation after restart into a new pending candidate.
- Draft Review evidence was visible before every Save and reported stable
  Review action layout for the initial draft, update draft, pending update after
  restart, and restart-continuation draft.
- Static preview evidence stayed nonblank with script-denying preview policy,
  visible first-release runtime-limit explanation, and no unexpected renderer
  network requests during the canary scope.

## 2026-07-28 Desktop Plan Review Flow Package

This addendum records the desktop package refresh for code checkpoint `1a050f0`,
after clarifying approved-plan continuation output and making Plan Review
actions single-shot while a decision is being recorded. It is not a new
real-provider canary and does not extend installer evidence, code-signing
status, public release readiness, or mobile visual evidence.

- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`.
- Focused desktop renderer tests for BuilderPage and BuilderApp passed:
  66 tests.
- Full renderer unit tests passed: 356 Vitest tests.
- `npm exec tsc -b --pretty false`, `npm run lint`, `git diff --check`,
  and `npm run build` passed during this desktop flow checkpoint.
- `npm run pack` passed for checkpoint `1a050f0`; package verification
  reported `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 747 ASAR
  entries.
- Approved-plan continuation now shows a specific assistant waiting state in
  the desktop conversation flow before display-safe live output arrives, instead
  of falling back to a generic working message.
- Plan Approve/Reject actions now enter a visible recording state and are
  single-shot while the main-owned Review fact is being recorded. Repeated user
  clicks do not create duplicate renderer calls or duplicate continuation
  generation attempts; the main Plan Review bridge remains the Review fact
  authority.

## 2026-07-28 Desktop Plan Review Failure Package

This addendum records the desktop package refresh for code checkpoint `cb31533`,
after making Plan Review bridge failures visible and retryable in the desktop
conversation flow. It is not a new real-provider canary and does not extend
installer evidence, code-signing status, public release readiness, or mobile
visual evidence.

- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`.
- Focused desktop renderer tests for BuilderPage and BuilderApp passed:
  68 tests.
- Full renderer unit tests passed: 358 Vitest tests.
- `npm exec tsc -b --pretty false`, `npm run lint`, `git diff --check`,
  and `npm run build` passed during this desktop failure-state checkpoint.
- `npm run pack` passed for checkpoint `cb31533`; package verification
  reported `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 747 ASAR
  entries.
- If the main-owned Plan Review bridge cannot record a decision, the same Plan
  card now shows a retryable user-facing failure state. It does not claim that
  the plan was approved or rejected, does not continue generation, and does not
  expose provider, credential, source, Git, receipt, or internal bridge
  evidence.

## 2026-07-28 Desktop Plan Review Recorded-State Package

This addendum records the desktop package refresh for code checkpoint `ecc2337`,
after keeping Plan Review actions locked when the main-owned Review bridge has
recorded a decision but the public activity refresh is stale or unavailable. It
is not a new real-provider canary and does not extend installer evidence,
code-signing status, public release readiness, or mobile visual evidence.

- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`.
- Focused desktop renderer tests for BuilderPage and BuilderApp passed:
  70 tests.
- Full renderer unit tests passed: 360 Vitest tests.
- `npm exec tsc -b --pretty false`, `npm run lint`, `git diff --check`,
  and `npm run build` passed during this desktop recorded-state checkpoint.
- `npm run pack` passed for checkpoint `ecc2337`; package verification
  reported `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 747 ASAR
  entries.
- After the main Plan Review bridge returns successfully, a stale pending Plan
  card now stays locked with "Decision recorded. Updating the conversation..."
  instead of re-exposing Approve/Reject as if no decision happened. The public
  Task Stream still owns the durable Plan approved/rejected activity, and the
  temporary desktop projection does not expose provider, credential, source,
  Git, receipt, or internal bridge evidence.

## 2026-07-28 Desktop Draft Review Surface Package

This addendum records the desktop package refresh for code checkpoint `456a7f5`,
after stabilizing the generated-draft Review surface and making preview
limitations clearer in the conversation-first workspace. It is not a new
real-provider canary and does not extend installer evidence, code-signing
status, public release readiness, or mobile visual evidence.

- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`.
- Focused desktop UI tests for BuilderPage, BuilderStaticPreview, and desktop
  layout styles passed: 58 tests.
- Full renderer unit tests passed: 362 Vitest tests.
- `npm exec tsc -b --pretty false`, `npm run lint`, `git diff --check`,
  and `npm run build` passed during this desktop Review surface checkpoint.
- `npm run pack` passed for checkpoint `456a7f5`; package verification
  reported `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 747 ASAR
  entries.
- Generated-draft Review actions now sit on their own desktop row and can wrap
  without squeezing "Review before saving" or the file-change summary into a
  narrow column.
- Preview limitation copy now tells users that the files were generated but
  this preview cannot run 3D/WebGL, JavaScript modules, canvas animation,
  network assets, local servers, or backend code yet. The warning is rendered
  as a lightweight explanation, not as another nested card.
- A desktop fixture screenshot of the generated-draft Review/Preview state was
  captured at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-draft-review-456a7f5.png`.
  It renders real React/CSS with test fixtures and is local evidence only; it
  is not a real-provider canary artifact and was not committed.

## 2026-07-28 Desktop Draft Review DeepSeek Canary

This addendum records a real saved-profile DeepSeek desktop canary for
checkpoint `39393df`, after updating the packaged canary preview-copy evidence
to match the current generated-draft Review/Preview UI. It is desktop package
evidence only; it does not extend installer evidence, code-signing status,
public release readiness, or mobile visual evidence.

- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`.
- The package was rebuilt at checkpoint `39393df`; package verification
  reported `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 747 ASAR
  entries.
- Canary contract validation passed: the full Node boundary suite passed
  552 subtests, the targeted packaged/deepseek canary tests passed 49 subtests,
  `npm run lint` passed, and `git diff --check` passed before evidence commit.
- The saved profile was verified as DeepSeek V4 OpenAI-compatible
  `deepseek-v4-flash`; the canary used the saved-profile path, did not accept
  provider material through stdin, argv, env, logs, or renderer-readable
  evidence, and left the source profile unchanged.
- The packaged app was exercised through the visible desktop Builder UI. The
  canary saved Version 1, answered a saved-project question without creating a
  new draft or revision, produced an unsaved update draft, restored that pending
  draft after restart with Save still explicit, saved Version 2, inspected
  saved history, returned to the current preview, restored the project after
  restart, and continued generation after restart into a new pending candidate.
- Draft Review evidence was visible before every Save and reported stable
  Review action layout for the initial draft, update draft, pending update after
  restart, and restart-continuation draft.
- Static preview evidence stayed nonblank with script-denying preview policy,
  visible first-release runtime-limit explanation, unchanged restart previews
  where expected, changed previews after update/continuation, and zero
  unexpected renderer network requests during the canary scope.

## 2026-07-28 Runtime-Only Preview DeepSeek Canary

This addendum records a real saved-profile DeepSeek desktop canary for
checkpoint `4f1e8ec`, after replacing runtime-only blank preview surfaces with
an explicit "Preview unavailable here" explanation in the desktop conversation
flow. It is desktop package evidence only; it does not extend installer
evidence, code-signing status, public release readiness, or mobile visual
evidence.

- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`.
- Focused runtime-preview and BuilderPage validation passed through
  `npm run test -- BuilderStaticPreview BuilderPage`; the command reported the
  full renderer suite passing 362 Vitest tests and the Node boundary suite
  passing 552 subtests.
- `npm exec tsc -b --pretty false`, `npm run lint`, `npm run build`, and
  `git diff --check` passed before commit.
- `npm run pack` passed for checkpoint `4f1e8ec`; package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 747 ASAR
  entries.
- A desktop visual fixture screenshot of the runtime-only generated-draft state
  was captured at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-runtime-preview-focused-desktop.png`.
  It shows user messages as bubbles, assistant replies as plain chat text, stable
  Review actions, and no large blank iframe for a Three.js/WebGL-style draft.
  It is local visual evidence only and was not committed.
- The saved profile was verified as DeepSeek V4 OpenAI-compatible; the canary
  used the saved-profile path, did not accept provider material through stdin,
  argv, env, logs, or renderer-readable evidence, and left the source profile
  unchanged.
- The packaged app was exercised through the visible desktop Builder UI. The
  canary saved Version 1, answered a saved-project question without creating a
  new draft or revision, produced an unsaved update draft, restored that pending
  draft after restart with Save still explicit, saved Version 2, inspected saved
  history, returned to the current preview, restored the project after restart,
  and continued generation after restart into a new pending candidate.
- Draft Review evidence was visible before every Save and reported stable
  Review action layout for the initial draft, update draft, pending update after
  restart, and restart-continuation draft.
- Static preview evidence for the DeepSeek canary stayed nonblank with
  script-denying preview policy, visible first-release runtime-limit
  explanation, unchanged restart previews where expected, changed previews after
  update/continuation, and zero unexpected renderer network requests during the
  canary scope.

## 2026-07-28 Plan Source-Context Runtime Wiring Check

This addendum records the source-context/plan-progress runtime wiring checkpoint
after the desktop conversation layout fixes. It is not release-ready evidence:
the real DeepSeek packaged canary still fails closed before plan source-context
tool activity because there is no visible, local-project-folder-bound approval
flow for bounded filesystem-read permission.

- The current local package was rebuilt at
  `release\win-unpacked\ClawFabric Builder.exe`; package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 747 ASAR
  entries.
- Focused Node validation passed with 65 subtests covering generation IPC
  runtime wiring, Generation main service plan completion, Generation host
  adapter plan progress, and the main-only source-context collector.
- The Generation IPC runtime now constructs a main-owned source-context
  collector backed by the project workspace authority, Conversation service,
  and deny-by-default Permission facts evaluator. Renderer still sends only
  bounded instruction text and cannot send source content, resource ids,
  permission grants through generation requests, provider config, credentials,
  Git evidence, or Save authority.
- Plan-first proposal work now records the same fixed progress stages as
  generation/explanation and carries the advanced Conversation head through the
  source-context result before terminal plan admission.
- A real saved-profile DeepSeek V4 packaged canary was run against the rebuilt
  app. It failed at `plan_before_context` with
  `canary_plan_before_context_failed`, confirming the remaining blocker is the
  missing visible folder-bound approval flow rather than a renderer grant
  fallback. The app must not be presented as fully usable for continuous
  chat-style project work until that approval path is implemented and the
  packaged canary passes.

## 2026-07-28 Visible Plan Source-Read Approval Package Check

This addendum records the desktop package checkpoint after adding the visible
Plan first source-read approval flow. It is desktop package evidence only; it
does not extend installer evidence, code-signing status, public release
readiness, mobile evidence, or real-provider DeepSeek canary evidence.

- Plan-first source reading now has a visible chat-flow approval prompt before
  continuing. Renderer sends only the current Project ID; main re-reads the
  selected project, derives bounded project-file resources, evaluates
  deny-by-default `filesystem.read`, and records explicit grants through the
  main-only permission runtime.
- The bridge exposes only public approval status/result fields:
  `ready`/`approval_required`, current Project ID, bounded file count, fixed
  scope, and fixed authority label. Renderer cannot supply resource IDs,
  permission IDs, grants, source content, provider material, Git evidence, Save
  authority, or revision receipts through this flow.
- Focused Electron validation passed 50 subtests covering the generation IPC
  adapter/runtime, Electron main startup, security boundaries, and architecture
  boundary.
- Focused frontend validation passed 106 Vitest tests covering the desktop code
  generator port, Builder app flow, Builder page approval card, bridge root, and
  Builder architecture boundary.
- `npm exec tsc -b --pretty false`, `npm run lint`, `npm run build`, and
  `npm run test` passed. The full test command reported 390 Vitest tests and
  564 Node boundary subtests passing.
- `npm run pack` passed. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 747 ASAR
  entries.
- A packaged desktop screenshot of the fresh project conversation surface was
  captured at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-current-packaged.png`.
  It is local visual evidence only and was not committed. The screenshot does
  not claim the generated-draft Review/Changes overlap issue is fixed.

## 2026-07-28 Bound Local Draft And Preview Copy Package Check

This addendum records focused evidence for code checkpoint `36cb195`, after the
first-draft path for a bound local project was fixed and the static preview copy
was clarified. It is not a new real-provider canary and does not extend
installer evidence, code-signing status, public release readiness, mobile
evidence, or arbitrary runtime/tool-execution readiness.

- Bound local projects with no saved Project Revision can now begin their first
  draft from the selected local workspace identity instead of failing before the
  provider call.
- Static preview copy now distinguishes rendered HTML/CSS previews from
  runtime-only drafts. Rendered static previews no longer imply that the preview
  may look blank; runtime-only drafts still use the explicit
  "Preview unavailable here" explanation.
- Focused Node validation passed through
  `node --test tests\builder-conversation-main-service.test.cjs tests\builder-generation-main-service.test.cjs tests\verify-packaged-canary.test.cjs`;
  the command reported 96 passing subtests.
- Focused frontend validation passed through
  `npm run test:unit -- BuilderStaticPreview BuilderPage`; the command reported
  54 passing Vitest tests.
- The current local package directory at
  `release\win-unpacked\ClawFabric Builder.exe` passed `npm run verify:package`.
  Package verification reported `builder_package_verified`, production
  network-denying CSP, app id `com.clawfabric.builder`, product name
  `ClawFabric Builder`, and 747 ASAR entries.

## Evidence Inheritance Rule

Later changes to generation, provider storage, project persistence, preview,
Electron shell, packaging, installer configuration, or canary logic must rerun
the affected evidence. Documentation alone does not extend this checkpoint.
