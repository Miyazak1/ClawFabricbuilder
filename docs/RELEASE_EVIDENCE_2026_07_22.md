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

## 2026-07-28 DeepSeek Source-Read Packaged Canary

This addendum records the real saved-profile DeepSeek V4 packaged canary after
the packaged canary verifier was updated to follow the visible Plan first
source-read approval prompt and to assert the folded tool result row rather
than a transient request row. It extends desktop packaged canary evidence only;
it does not extend installer evidence, code-signing status, mobile evidence, or
arbitrary runtime/tool-execution readiness.

- Focused verifier validation passed through
  `node --test tests\verify-packaged-canary.test.cjs`; the command reported 46
  passing subtests, including the new no-prompt and visible source-read approval
  paths.
- `npm run pack` passed after the verifier update. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 751 ASAR
  entries.
- The real canary launched
  `release\win-unpacked\ClawFabric Builder.exe` with the saved DeepSeek profile
  path, copied only guarded provider config/secret files into temporary
  user-data, did not accept provider material through stdin, argv, env, logs, or
  renderer-readable evidence, and left the source profile unchanged.
- The canary exercised the desktop Builder UI through the source-folder
  workspace gate, initial draft generation, explicit Version 1 Save, saved
  project question answer without creating a draft or revision, unsaved update
  draft, pending-draft restart restore with Save still explicit, explicit
  Version 2 Save, saved history inspection, restart restore, Plan first after
  restart, visible project-read approval, approved-plan continuation, and a new
  pending restart-continuation draft.
- The Plan first task-stream evidence included three bounded tool requests,
  three tool results, and three succeeded tool results; the UI assertion now
  matches the conversation surface by requiring the visible succeeded tool
  activity result instead of the folded request row.
- Static preview evidence stayed nonblank with a script-denying preview policy,
  visible runtime-limit explanation, zero unexpected renderer network requests,
  and changed/unchanged preview digests where expected across save, restart, and
  continuation.

## 2026-07-28 Chinese Composer Routing Package Check

This addendum records focused desktop evidence for checkpoint `a63f519`, after
the single composer route was tightened for natural Chinese edit turns and then
proved at the full `BuilderApp` layer. It is desktop package evidence only; it
does not extend installer evidence, code-signing status, mobile evidence,
arbitrary runtime/tool-execution readiness, or the prior real-provider DeepSeek
canary scope.

- The composer intent router keeps ordinary chat and how-to questions on the
  answer path while routing clear edit/build requests to the build gate.
  `hi`, status/how-to questions, and `怎么把按钮改红？` do not create a draft,
  Save action, or Project Revision. Clear edit turns such as `把按钮颜色改红`
  are treated as build intent.
- The desktop app-level evidence now proves that a clear Chinese edit turn with
  no bound local project opens the composer project picker first, preserves the
  user's text, and calls no answer bridge, generator, draft save, or local
  project creation. The same test proves that a Chinese how-to question answers
  in chat without opening the project picker.
- Focused validation passed through
  `npm.cmd exec vitest run src\app\BuilderApp.test.tsx src\features\builder\application\builderComposerIntent.test.ts`;
  the command reported 56 passing Vitest tests.
- `npm.cmd exec tsc -b --pretty false`, `npm.cmd run lint`, and
  `npm.cmd run pack` passed for the same source tree. Package verification
  reported `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 751 ASAR
  entries.
- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`. A packaged desktop screenshot
  of the fresh conversation surface was captured at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-current-1785249868603.png`
  as local visual evidence only.

## 2026-07-28 Main-Owned Chinese Submit Routing Check

This addendum records focused Electron main-service evidence for checkpoint
`89092ce`. It closes the gap between the renderer composer router and the
main-owned `submit` route. It is desktop package evidence only; it does not
extend installer evidence, code-signing status, mobile evidence, arbitrary
runtime/tool-execution readiness, or the prior real-provider DeepSeek canary
scope.

- Main-owned submit routing now treats how-to/explanation phrasing as chat even
  when the text mentions editing words. A request such as `怎么把按钮改红？` goes
  through the explanation path, creates no Git candidate, no draft, no Save, and
  no Project Revision, even without an existing project.
- Clear Chinese edit phrasing such as `把按钮颜色改红` is recognized as work
  intent by main-owned routing. The product controller and desktop app still
  enforce the local project/source-folder gate before ordinary users can reach
  build work from the UI.
- Focused Electron validation passed through
  `node --test tests\builder-generation-main-service.test.cjs`; the command
  reported 28 passing subtests.
- Adjacent generation IPC validation passed through
  `node --test tests\builder-generation-ipc-runtime.test.cjs tests\builder-generation-ipc-adapter.test.cjs`;
  the command reported 31 passing subtests.
- `npm.cmd run lint` and `npm.cmd run pack` passed for the same source tree.
  Package verification reported `builder_package_verified`, production
  network-denying CSP, app id `com.clawfabric.builder`, product name
  `ClawFabric Builder`, and 751 ASAR entries.

## 2026-07-28 Main-Owned No-Project Build Gate Check

This addendum records desktop runtime evidence for checkpoint `42ecc48`. It
closes the remaining public main/IPC path where a build-like composer turn could
enter draft generation without a bound local project workspace. It is desktop
package evidence only; it does not extend installer evidence, code-signing
status, mobile evidence, arbitrary runtime/tool-execution readiness, or the
prior real-provider DeepSeek canary scope.

- Main-owned `submit` still allows casual chat and explanation turns without a
  local project. Greetings such as `hi` and how-to questions continue through
  the answer path without creating a Git candidate, draft, Save action, or
  Project Revision.
- Build-like submit turns now fail closed before draft generation when no local
  project is bound. Direct public generate and retry IPC calls also require the
  selected project identity in main, so renderer drift cannot silently build
  into a hidden logical project.
- Focused Electron validation passed through
  `node --test tests\builder-generation-main-service.test.cjs tests\builder-generation-ipc-runtime.test.cjs tests\builder-generation-ipc-adapter.test.cjs`;
  the command reported 59 passing subtests.
- Full Node boundary validation passed through `npm.cmd run test:boundaries`;
  the command reported 594 passing tests. Full frontend validation passed
  through `npm.cmd run test:unit`; the command reported 406 passing Vitest
  tests.
- `npm.cmd run lint` and `npm.cmd run pack` passed for the same source tree.
  Package verification reported `builder_package_verified`, production
  network-denying CSP, app id `com.clawfabric.builder`, product name
  `ClawFabric Builder`, and 751 ASAR entries.

## 2026-07-28 Real DeepSeek V4 Packaged Canary Check

This addendum records a real packaged desktop DeepSeek V4 canary collected while
the repository HEAD was `93cb03b`. The packaged runtime under
`release\win-unpacked\ClawFabric Builder.exe` was launched through the
saved-profile canary path, using the already saved local provider profile as the
credential source. This is desktop package evidence only; it does not extend
installer evidence, code-signing status, mobile evidence, arbitrary generated
runtime execution, external-network permissions inside generated projects, or
general-purpose coding-agent tool execution readiness.

- The saved provider profile was verified as DeepSeek V4 OpenAI-compatible
  configuration before launch. The canary accepted no provider material through
  stdin, argv, env, logs, or renderer-readable evidence, and the source profile
  remained unchanged after the run.
- The real packaged UI completed the first local project flow: build intent
  without a workspace was blocked, the composer text stayed editable until a
  source folder was bound, an unsaved draft was observed, review changes were
  visible before Save, and Version 1 was saved through explicit UI action.
- A saved-project question produced a visible assistant answer without advancing
  the candidate count or changing the saved revision.
- A follow-up update produced a pending unsaved draft, survived packaged app
  restart with Save still explicit, then saved as Version 2 after verifying the
  previous Git/SQLite revision evidence.
- Restart recovery restored the saved project catalog and Version 2, preserved
  current revision identity, allowed inspection of Version 1 history without
  mutating the current revision, and returned to the current version.
- The Plan first continuation path after restart showed project-read tool
  activity, three succeeded tool results, a visible plan review, explicit plan
  approval, and a new pending unsaved continuation draft without saving a third
  version.
- Review/Changes layout evidence reported stable review actions, inline diff
  visible, changes nested inside the panel, no review/changes overlap, and no
  internal Git, receipt, provider, credential, or source evidence in public UI.
- Static preview evidence remained nonblank across initial, update, restart,
  and continuation states. The preview stayed sandboxed with no script source,
  runtime limitations explained, and zero unexpected renderer network requests.
- The canary result reported credential status `stored`, source profile
  unchanged, two accepted saved revisions, pending continuation draft distinct
  from Version 2, and redacted DeepSeek endpoint/model digests only.

## 2026-07-28 Current Installer Refresh Check

This addendum records installer evidence after refreshing the Windows NSIS
installer from current HEAD `29cbb91`. It extends local desktop installer
evidence only; it does not extend code-signing status, mobile evidence,
arbitrary runtime/tool-execution readiness, generated-code execution, or
external-network permissions inside generated projects.

- `npm.cmd run dist` passed. The command rebuilt the production renderer,
  packaged `release\win-unpacked`, built
  `release\ClawFabric Builder Setup 0.1.0.exe`, built its blockmap, and ran
  `verify:package`.
- Package verification reported `builder_package_verified`, production
  network-denying CSP, app id `com.clawfabric.builder`, product name
  `ClawFabric Builder`, and 751 ASAR entries.
- The installer was exercised in a guarded temporary install directory. The
  installed tree contained all 487 files from `release\win-unpacked` with
  matching byte sizes and SHA-256 digests.
- The only installer-added file in the guarded install directory was
  `Uninstall ClawFabric Builder.exe`.
- The official uninstaller was run in silent mode and removed the installed
  executable; the guarded install directory was empty afterward.

## 2026-07-29 Bound Workspace Picker Package Check

This addendum records focused desktop package evidence for checkpoint `51d2832`,
after bound-but-unsaved local project workspaces became visible in the composer
project picker. It extends desktop package evidence only; it does not extend
installer evidence, code-signing status, mobile evidence, arbitrary runtime/tool
execution readiness, generated-code execution, or external-network permissions
inside generated projects.

- The current local package is
  `release\win-unpacked\ClawFabric Builder.exe`.
- The composer project picker now lists saved Project Versions separately from
  bound local workspaces that do not yet have a saved Version. Saved projects
  suppress duplicate workspace rows, while unsaved bound workspaces display only
  the public project title and source-folder display name.
- Reopening a bound unsaved workspace from the picker restores the working
  Project identity for further build turns without making it a saved Project
  Revision. Explicit Save remains the only path from a candidate to a verified
  Git/SQLite Version.
- The main-owned workspace list path reads SQLite project-workspace bindings and
  exposes a renderer-safe catalog projection with `folder_name_only` path
  disclosure. Renderer code still cannot receive a source path, submit a path,
  create Git evidence, grant permission, save a Version, expose provider or
  credential material, or read source through the workspace list.
- Focused desktop validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderPage.test.tsx src\app\BuilderApp.test.tsx src\app\BuilderDesktopLayoutStyles.test.ts src\features\builder\application\builderComposerIntent.test.ts`;
  the command reported 120 passing Vitest tests.
- `npm.cmd run pack` passed for the same source tree before the checkpoint was
  handed to the user. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 751 ASAR
  entries.
- A packaged desktop screenshot of the fresh conversation surface was captured
  at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-packaged-current.png`
  as local visual evidence only.

## 2026-07-29 Source Folder Build Continuation Check

This addendum records focused desktop package evidence for checkpoint
`2311cdd`, after the composer project picker was tightened so a gated build can
continue smoothly only through the same explicit user-sent instruction. It
extends desktop package evidence only; it does not extend installer evidence,
code-signing status, mobile evidence, arbitrary runtime/tool execution
readiness, generated-code execution, or external-network permissions inside
generated projects.

- Build-like composer turns without a bound local workspace still open the
  project picker before any submit, generation, draft save, Git candidate, or
  Project Revision work.
- Choosing New project and adding a source folder continues the same frozen
  instruction that the user already sent, then clears the composer after the
  accepted submit path. The source-folder action itself cannot submit newly
  edited composer text that the user has not sent.
- Closing the project picker clears the pending build continuation. Reopening
  the picker and creating a project later binds the workspace only; it does not
  auto-send stale text.
- Selecting an existing bound-but-unsaved workspace from the gated build picker
  opens that workspace and preserves the composer text for explicit user
  confirmation instead of auto-submitting into the selected folder.
- Focused desktop validation passed through
  `npm.cmd exec vitest run src\app\BuilderApp.test.tsx src\features\builder\presentation\BuilderPage.test.tsx src\features\builder\application\builderComposerIntent.test.ts`;
  the command reported 115 passing Vitest tests.
- `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run test` passed for
  the same source tree. The full test command reported 419 passing Vitest tests
  and 597 passing Node boundary tests.
- `npm.cmd run pack` passed for the same source tree. Package verification
  reported `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 751 ASAR
  entries. The current local package remains
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-29 Draft Review Composer Gate Package Check

This addendum records focused desktop package evidence for checkpoint
`757b512`, after the composer was gated while an unsaved draft is waiting for
Review. It extends desktop package evidence only; it does not extend real
DeepSeek evidence, installer evidence, code-signing status, mobile evidence,
arbitrary runtime/tool execution readiness, generated-code execution, or
external-network permissions inside generated projects.

- When a generated draft is pending Review, the composer no longer shows the
  previously submitted instruction as editable text and does not expose a new
  Send action for another request. It instead shows a clear Save-or-discard
  message plus a lightweight Review draft action that returns focus to the
  Review checkpoint.
- The Review checkpoint remains the only visible place for Save version and
  Discard draft actions in this state. The composer Review draft action does
  not save, discard, submit, steer, grant permission, create Git evidence, or
  create a Project Revision.
- Focused desktop validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderPage.test.tsx src\app\BuilderDesktopLayoutStyles.test.ts`;
  the command reported 66 passing Vitest tests.
- `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run pack` passed for
  checkpoint `757b512`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 751 ASAR
  entries. The current local package remains
  `release\win-unpacked\ClawFabric Builder.exe`.
- A packaged desktop screenshot using a temporary local OpenAI-compatible
  provider was captured at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-draft-review-gated-1785266679860.png`
  as local visual evidence only. This screenshot is not a real-provider or
  DeepSeek canary.

## 2026-07-29 Safe Unsaved Draft Continuation Check

This addendum records the current desktop contract after the earlier gated
draft-composer checkpoint evolved into controlled draft-to-draft continuation.
It supersedes the `757b512` user-facing composer behavior while preserving its
core authority boundary: Save version and Discard draft remain explicit Review
actions, and continuing a draft does not save, accept, or create a Project
Revision. It extends desktop evidence only; it does not extend real-provider
DeepSeek evidence, installer evidence, code-signing status, mobile evidence,
generated-code execution, arbitrary runtime/tool execution, or external-network
permissions inside generated projects.

- When an unsaved draft is pending Review, the single composer can accept a new
  follow-up instruction and sends with Enter or the single Send button. The
  desktop app routes that turn through the draft-continuation port with only the
  pending `draft_id` and new instruction; it does not call first-draft submit,
  direct generate, saveDraft, Save version, or Discard draft.
- The Review checkpoint remains the only visible place for Save version and
  Discard draft. Continuing the draft replaces the pending candidate for
  review, keeps the composer text clear after the accepted continuation, and
  leaves explicit Save as the only path to a verified Git/SQLite Version.
- Focused desktop validation passed through
  `npm.cmd exec vitest run src\app\BuilderApp.test.tsx src\features\builder\presentation\BuilderPage.test.tsx`;
  the command reported 92 passing Vitest tests. Covered cases include
  `continues an unsaved draft from the same composer without saving first`,
  Enter-bound continuation without Save/Discard, explicit Save after review,
  and draft-id-only discard.
- The latest generated-draft packaged screenshot remains
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-generated-review-1785278051044.png`.
  It shows the current composer status `Continue this draft`, stable Review
  actions, non-overlapping Changes, and no window-level scroll. This screenshot
  is local visual evidence only and is not a real-provider or DeepSeek canary.

## 2026-07-29 DeepSeek Preset Package Refresh Check

This addendum records package and desktop visual evidence for checkpoint
`4f4412f`, after the provider settings surface gained a DeepSeek V4 preset
button. It extends local desktop package evidence only; it does not extend the
prior real-provider DeepSeek canary, installer evidence, code-signing status,
mobile evidence, generated-code execution, arbitrary runtime/tool execution,
or external-network permissions inside generated projects.

- The provider settings UI now offers `Use DeepSeek V4`, which fills the
  OpenAI-compatible DeepSeek endpoint, model, timeout, temperature, and token
  budget fields while preserving the existing API key field. The preset does
  not save settings by itself, does not change the provider bridge, and does
  not move credentials into renderer-readable evidence.
- Focused provider settings validation passed for
  `src\features\builder\presentation\BuilderProviderSettingsPanel.test.tsx`
  and
  `src\features\builder\presentation\BuilderProviderSettingsRouteAdapter.test.tsx`.
  Full renderer validation passed through typecheck, lint, build, and
  `npm.cmd run test:unit`; the command reported 430 passing Vitest tests.
- `npm.cmd run pack` passed for the same source tree. Package verification
  reported `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 753 ASAR
  entries. The current local package remains
  `release\win-unpacked\ClawFabric Builder.exe`.
- A packaged fresh-workspace screenshot using an isolated canary profile was
  captured at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-latest-ui-1785277812768.png`.
  The observed page scroll height equaled the viewport height, the composer
  remained in the main chat workspace, and only the chat scroll region owned
  overflow.
- A packaged generated-draft review screenshot using a temporary local
  OpenAI-compatible provider was captured at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-generated-review-1785278051044.png`.
  The generated Review checkpoint, Changes panel, and Review buttons had
  non-overlapping boxes; the page still had no window-level scroll, and the
  chat region remained the only overflowing workspace area. This screenshot is
  local visual evidence only and is not a real-provider or DeepSeek canary.
- A new real DeepSeek V4 canary was not rerun for this checkpoint because the
  default app profile locations on this machine did not contain a saved
  provider profile/key during the refresh.

## 2026-07-29 DeepSeek V4 Model Preset Choice Check

This addendum records focused desktop evidence after the provider settings
surface made the DeepSeek V4 model choice explicit. It extends local desktop
UI evidence only; it does not extend the prior real-provider DeepSeek canary,
installer evidence, code-signing status, mobile evidence, generated-code
execution, arbitrary runtime/tool execution, or external-network permissions
inside generated projects.

- The provider settings UI now offers separate `Use V4 Flash` and `Use V4 Pro`
  preset buttons. Both fill the same official OpenAI-compatible DeepSeek base
  URL, timeout, temperature, and token budget fields while selecting either
  `deepseek-v4-flash` or `deepseek-v4-pro`. The API key field is preserved.
- The preset buttons remain form-only convenience controls: they do not save
  settings, do not read credentials, do not call the provider bridge, and do
  not move provider or credential material into renderer-readable evidence.
- Focused validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderProviderSettingsPanel.test.tsx src\features\builder\presentation\BuilderProviderSettingsRouteAdapter.test.tsx`;
  the command reported 22 passing Vitest tests.
- `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run test:unit`,
  `npm.cmd run build`, and `npm.cmd run pack` passed for the same source tree.
  Package verification reported `builder_package_verified`, production
  network-denying CSP, app id `com.clawfabric.builder`, product name
  `ClawFabric Builder`, and 753 ASAR entries.
- A packaged Settings screenshot using an isolated canary profile was captured
  at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-deepseek-presets-1785278708829.png`.
  The two DeepSeek preset buttons rendered side by side without text overflow.

## 2026-07-29 Provider Settings Pristine Validation Check

This addendum records focused desktop evidence after the provider settings
surface stopped showing required-field errors before the user edits the form.
It extends local desktop UI evidence only; it does not change provider
validation, credential storage, provider bridge authority, real-provider
canary coverage, generated-code execution, or external-network permissions
inside generated projects.

- The provider settings panel now separates raw validation from visible field
  errors. The raw validation result still controls whether `Save provider` is
  enabled, while the route adapter hides required-field messages until the user
  edits the form or the controller reports an error state.
- Focused validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderProviderSettingsPanel.test.tsx src\features\builder\presentation\BuilderProviderSettingsRouteAdapter.test.tsx`;
  the command reported 24 passing Vitest tests.
- `npm.cmd exec tsc -b --pretty false`, `npm.cmd run lint`,
  `npm.cmd run test:unit`, `npm.cmd run build`, and `npm.cmd run pack` passed
  for the same source tree. Full unit reported 433 passing Vitest tests.
  Package verification reported `builder_package_verified`, production
  network-denying CSP, app id `com.clawfabric.builder`, product name
  `ClawFabric Builder`, and 753 ASAR entries.
- A packaged Settings screenshot using an isolated canary profile was captured
  at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-settings-pristine-1785279208706.png`.
  The screenshot check reported zero visible required-field errors and a
  disabled `Save provider` command in the pristine unconfigured form.

## 2026-07-29 Narrow Desktop Scroll Boundary Check

This addendum records focused desktop layout evidence after the narrow desktop
breakpoint stopped opting the conversation workspace back into page-level
scrolling. It extends local UI/package evidence only; it does not change
provider, generation, Git, SQLite, Save, permission, or preview authority.

- The 721px-to-1160px desktop breakpoint now keeps the Builder surface and chat
  shell on the fixed viewport height chain, keeps the composer in the chat main
  row, and lets only the conversation scroll area overflow. The review sidebar
  may stack at this breakpoint, but it no longer makes the whole window the
  scroll container.
- Focused layout validation passed through
  `npm.cmd exec vitest run src\app\BuilderDesktopLayoutStyles.test.ts`; the
  command reported 10 passing Vitest tests.
- `npm.cmd exec tsc -b --pretty false`, `npm.cmd run lint`,
  `npm.cmd run test:unit`, `npm.cmd run build`, and `npm.cmd run pack` passed
  for the same source tree. Full unit reported 434 passing Vitest tests.
  Package verification reported `builder_package_verified`, production
  network-denying CSP, app id `com.clawfabric.builder`, product name
  `ClawFabric Builder`, and 753 ASAR entries.
- A packaged 1000px-wide desktop smoke screenshot using an isolated canary
  profile was captured at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-narrow-desktop-scroll-1785279939684.png`.
  Runtime metrics reported `documentScrollHeight` equal to
  `documentClientHeight`, `rootOverflow` and `bodyOverflow` as `hidden`,
  `chatScrollOverflow` as `auto`, and a 40px composer project chip.

## 2026-07-29 DeepSeek V4 Packaged Canary Pass

This addendum records a real-provider packaged canary after the canary harness
was aligned with the current conversation-first project binding flow. It
extends packaged multi-turn DeepSeek evidence only; it does not extend
installer evidence, code-signing status, mobile evidence, arbitrary
generated-code execution, or external-network permissions inside generated
projects.

- The packaged canary now verifies the current workspace gate contract:
  a build intent without a source folder is blocked, the composer text is
  preserved until the user explicitly adds a source folder, and that same build
  continues after the workspace boundary is bound. It no longer expects a
  second manual Send after the explicit source-folder selection.
- The Review/Changes canary now checks the latest user message in a continuous
  conversation instead of assuming there is only one `You` card. This keeps
  multi-turn Review layout evidence strict without failing on legitimate saved
  question and update turns.
- The approved-plan continuation canary now waits for the new unsaved draft
  after approval instead of treating the already-visible saved preview as a new
  generation terminal state.
- Focused Node validation passed through
  `node --test tests\verify-packaged-canary.test.cjs`; the command reported 47
  passing Node tests.
- Repository validation also passed through `npm.cmd run lint` and
  `npm.cmd run test:boundaries`; the boundary suite reported 615 passing Node
  tests when rerun with Temp-directory write access.
- `npm.cmd run pack` passed after this checkpoint and refreshed
  `release\win-unpacked\ClawFabric Builder.exe`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 753 ASAR
  entries.
- A real packaged DeepSeek V4 saved-profile canary passed through
  `npm.cmd run verify:packaged-canary:deepseek -- --execute` using the saved
  main-only profile at `C:\Users\Administrator\AppData\Roaming\clawfabric-builder`.
  The canary verified the saved profile as `deepseek-v4-flash` with an official
  DeepSeek endpoint and did not expose the credential.
- One immediate post-pack canary attempt returned `canary_plan_review_failed`
  at the approved-plan continuation stage; a subsequent rerun against the same
  freshly packaged executable passed. This records a real-provider stability
  wrinkle to improve with better retry/failure diagnostics, not a passed
  canary substitute.
- The canary reported `builder-packaged-canary-result.v13` and covered:
  custom desktop chrome, source-folder workspace gate, live user-facing output,
  initial draft Review/Changes, explicit Save Version 1, saved-project question
  without advancing candidate count, update draft, pending draft restart
  restore, explicit Save Version 2, restart reopen, history view/return,
  plan proposal with three successful project-context tool results, approved
  plan continuation draft, Git/SQLite revision continuity, static preview
  evidence, credential stored status, source profile unchanged, and zero
  unexpected renderer network requests.

## 2026-07-29 Approved Plan Retry Package Check

This addendum records checkpoint `b8fb5fc`, after approved-plan continuation
failures became user-visible and retryable without falling back to generic
draft retry or submit. It extends the packaged desktop MVP evidence only; it
does not extend installer evidence, code-signing status, mobile evidence,
generated-code execution, arbitrary tool execution, or external-network
permissions inside generated projects.

- If the Review decision is recorded but the approved-plan continuation draft
  is not created because of a retryable generation diagnostic, the desktop
  conversation now says that the plan was approved but no draft was created and
  shows one explicit Retry action.
- The controller stores that retry as an approved-plan continuation request and
  reruns only `generateApprovedPlan` with the same Project/Conversation/Turn/Run
  IDs. It does not call ordinary `submit`, ordinary draft `retry`, `generate`,
  or Save, and it does not ask the renderer for plan text, source content,
  provider config, credential, Git evidence, or revision authority.
- Focused validation passed through
  `npm.cmd exec vitest run src\features\builder\application\builderProjectController.test.ts`
  and `npm.cmd exec vitest run src\app\BuilderApp.test.tsx`; the focused suites
  reported 44 and 36 passing tests respectively. `npm.cmd exec tsc -b --pretty
  false` also passed.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd run test:unit`, and `npm.cmd run test:boundaries`; the suites
  reported 436 passing Vitest tests and 615 passing Node boundary tests.
- `npm.cmd run pack` passed and refreshed
  `release\win-unpacked\ClawFabric Builder.exe`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 753 ASAR
  entries. The packaged executable timestamp was `2026-07-29 07:50:06` local
  time.
- A real packaged DeepSeek V4 saved-profile canary passed by invoking
  `scripts\verify-deepseek-packaged-canary.cjs --execute` with the saved
  main-only profile at
  `C:\Users\Administrator\AppData\Roaming\clawfabric-builder`. The result was
  `builder-packaged-canary-result.v13`, verified the official DeepSeek V4
  profile through redacted endpoint/model digests only, kept the source profile
  unchanged, and reported zero unexpected renderer network requests.
- That canary covered the source-folder workspace gate, live output, initial
  draft Review/Changes, explicit Save Version 1, saved-project question without
  advancing candidate count, update draft, pending draft restart restore,
  explicit Save Version 2, restart reopen, history view/return, plan proposal
  with three successful project-context tool results, approved plan continuation
  into a new pending draft, Git/SQLite revision continuity, and static preview
  evidence with the current first-release runtime-limit explanation.

## 2026-07-30 Resizable Artifact Drawer Package Check

This addendum records checkpoint `fb317e0`, after the desktop conversation
workspace moved large generated artifacts out of the chat flow and into a
resizable right artifact panel. It extends local desktop UI/package evidence
only; it does not extend installer evidence, real-provider DeepSeek canary
coverage, arbitrary generated-code execution, external-network permissions, or
general-purpose tool execution readiness.

- The chat flow now keeps conversation, status, Review actions, and a compact
  result summary. Full Preview, Changes, Source, and Versions render in the
  right artifact panel instead of being embedded as large chat cards.
- The artifact panel supports Preview/Changes/Source/Versions tabs, can be
  closed, and has a desktop resize handle. The resize clamp preserves a minimum
  usable chat/review width so the Review actions do not collapse while the panel
  is widened.
- Draft-ready and history-preview states open the Preview artifact tab by
  default when a preview exists. Review actions and compact Preview/Changes
  buttons switch the artifact tab rather than creating nested chat panels.
- Focused validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderPage.test.tsx src\app\BuilderApp.test.tsx src\app\BuilderDesktopLayoutStyles.test.ts`;
  the command reported 121 passing Vitest tests.
- Repository validation also passed through `npm.cmd exec tsc -b --pretty
  false`, `npm.cmd run lint`, `npm.cmd run test:unit`, `npm.cmd run
  test:boundaries`, and targeted canary Node tests through `node --test
  tests\verify-packaged-canary.test.cjs tests\verify-deepseek-packaged-canary.test.cjs`.
  The suites reported 501 passing Vitest unit tests, 626 passing boundary
  tests, and 61 passing targeted canary Node tests.
- `npm.cmd run build` and `npm.cmd run pack` passed. Package verification
  reported `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 753 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.
- A packaged desktop screenshot using a temporary local OpenAI-compatible mock
  provider was captured at
  `C:\Users\ADMINI~1\AppData\Local\Temp\clawfabric-builder-artifact-drawer-current.png`.
  This screenshot is local visual evidence only and is not a real-provider or
  DeepSeek canary.

## 2026-07-30 Artifact Logs Tab Check

This addendum records the desktop artifact Logs tab checkpoint after the
right-side artifact panel gained a read-only work-log view. It extends local
desktop UI evidence only; it does not extend installer evidence, real-provider
DeepSeek canary coverage, arbitrary generated-code execution, external-network
permissions, or general-purpose tool execution readiness.

- The artifact panel now includes a Logs tab when the current conversation has
  safe work details or live output. Logs reuse the existing renderer-safe Task
  Stream/activity projection and do not introduce a new IPC, preload namespace,
  log store, raw provider stream, tool dispatcher, or source reader.
- The Logs tab filters out ordinary user messages and pure chat answers, then
  shows only readable work status, tool request/result summaries, candidate or
  plan outcomes, review decisions, failures, and live display-safe output.
- Logs render inside the right artifact panel with independent scrolling. The
  conversation flow remains the place for chat, lightweight status, Review
  actions, and compact result summaries.
- Focused validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderPage.test.tsx src\app\BuilderDesktopLayoutStyles.test.ts`;
  the command reported 75 passing Vitest tests.
- Repository validation passed through `npm.cmd exec tsc -b --pretty false`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and `npm.cmd run
  test:boundaries`. The full unit suite reported 502 passing Vitest tests, and
  the boundary suite reported 626 passing Node tests.
- `npm.cmd run build` and `npm.cmd run pack` passed. Package verification
  reported `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 753 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-30 Composer Intent Guard Package Check

This addendum records the desktop composer intent guard checkpoint after the
chat/build router was tightened for source-folder-bound projects. It extends
local routing, main-service, and package evidence only; it does not extend
installer evidence, real-provider DeepSeek canary coverage, arbitrary
generated-code execution, external-network permissions, or general-purpose tool
execution readiness.

- A bound source folder remains only a build prerequisite. It does not make
  ordinary discussion or capability questions more likely to generate code.
- Capability or discussion turns such as "Can you build a login page?",
  "Should we create a dashboard first?", and
  "可以帮我做一个登录页吗？" now route through answer/explanation instead of
  creating a draft. Declarative requirements such as "我要做一个登录页" also stay
  in conversation context. Direct execution turns such as "帮我做一个登录页",
  "创建登录页", and "把按钮颜色改红" still enter build when the workspace gate is
  satisfied.
- The renderer router and the main-owned `submit` fallback were updated
  together so a renderer mistake cannot promote those question-shaped turns into
  Git candidate, draft, Review, Save, or Project Revision facts.
- Focused validation passed through
  `npm.cmd exec vitest run src\features\builder\application\builderComposerIntent.test.ts src\app\BuilderApp.test.tsx`
  and `node --test tests\builder-generation-main-service.test.cjs`; the suites
  reported 133 passing Vitest tests and 36 passing Node tests.
- Repository validation passed through `npm.cmd run typecheck`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and
  `npm.cmd run test:boundaries`. The full unit suite reported 529 passing
  Vitest tests, and the boundary suite reported 628 passing Node tests.
- `npm.cmd run pack` passed. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 753 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-30 Natural Discussion Working Brief Check

This addendum records the conversation-grounded working brief checkpoint after
the main-owned prompt context and submit guard were extended from explicit
"confirmed" phrasing to natural exploratory goal discussion. It extends local
generation routing, prompt-context, and package evidence only; it does not
extend installer, real-provider DeepSeek canary, arbitrary generated-code
execution, external-network permission, or general-purpose tool execution
evidence.

- Prior user discussion such as
  "我想先聊一下这个作品集首页怎么做，目标是星空背景、鼠标视差和三维项目卡片。"
  can now become the bounded `working_brief.latest_user_goal` only when paired
  with an assistant proposal and a later contextual execution phrase such as
  "好，开始吧". The earlier chat remains non-mutating discussion until that
  explicit execution phrase.
- The renderer-visible contextual build route, the main-owned submit guard, and
  the generation prompt brief now exercise the same natural-discussion path.
  Main still rejects explanatory-only questions such as preview-blank diagnosis
  as implementation targets.
- Focused validation passed through
  `node --test tests\builder-generation-kernel.test.cjs tests\builder-generation-main-service.test.cjs`
  and
  `npm.cmd exec vitest run src\app\BuilderApp.test.tsx src\features\builder\application\builderComposerIntent.test.ts`;
  the suites reported 59 passing Node tests and 133 passing Vitest tests.
- Repository validation passed through `npm.cmd run typecheck`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and
  `npm.cmd run test:boundaries`. The full unit suite reported 529 passing
  Vitest tests, and the boundary suite reported 628 passing Node tests.
- `npm.cmd run pack` passed. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 753 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-30 Read-Only Exploration Brief Guard Check

This addendum records the guard checkpoint after the natural discussion working
brief was narrowed so explanatory exploration is not promoted into an
implementation target. It extends local generation routing, prompt-context, and
desktop package evidence only; it does not extend installer, real-provider
DeepSeek canary, arbitrary generated-code execution, external-network
permission, or general-purpose tool execution evidence.

- Read-only diagnosis such as
  "我想知道这个网站为什么预览空白。" followed by an assistant answer like
  "可以先查看这个网站的脚本和静态预览限制..." remains explanation context.
  A later contextual phrase such as "开始吧" after that diagnosis still routes
  to answer rather than creating a Git candidate, draft, Review, Save, or
  Project Revision fact.
- The positive natural-discussion path from the previous checkpoint is still
  preserved for goal exploration that is paired with an assistant proposal and
  a later contextual execution phrase.
- Focused validation passed through
  `node --test tests\builder-generation-kernel.test.cjs tests\builder-generation-main-service.test.cjs`;
  the suite reported 61 passing Node tests.
- Repository validation passed through `npm.cmd run typecheck`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and
  `npm.cmd run test:boundaries`. Unit coverage reported 529 passing Vitest
  tests; boundary coverage reported 630 passing Node tests.
- `npm.cmd run pack` passed on the refreshed source tree. Package verification
  reported `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 753 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-31 Natural Plan Request Guard Package Check

This addendum records the natural-language plan request checkpoint after the
desktop composer and main-owned submit fallback were aligned for explicit plan
requests. It extends local routing, main-service, and package evidence only; it
does not extend installer evidence, real-provider DeepSeek canary coverage,
arbitrary generated-code execution, external-network permissions, or
general-purpose command/tool execution readiness.

- Requests such as "帮我先做下方案", "请先不要写代码，列步骤",
  "先给我一个方案", "Plan this first", and "Give me a plan for this page"
  route through the plan path instead of the automatic build path.
- The renderer calls the plan proposal flow for saved projects, so plan review
  evidence can be recorded without creating a draft, Git candidate, Save fact,
  or Project Revision.
- The main-owned `submit` fallback also recognizes explicit plan wording and
  fails closed to a read-only clarification route with the public
  `explicit_plan` signal. This prevents a renderer mistake or stale caller from
  promoting a plan request into build work.
- Focused validation passed through
  `npm.cmd exec vitest run src/features/builder/application/builderComposerIntent.test.ts src/app/BuilderApp.test.tsx`
  and `node --test tests\builder-generation-main-service.test.cjs`; the suites
  reported 165 passing Vitest tests and 42 passing Node tests.
- Repository validation passed through `npm.cmd exec tsc -b --pretty false`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and
  `npm.cmd run test:boundaries`. The full unit suite reported 572 passing
  Vitest tests, and the boundary suite reported 660 passing Node tests.
- `npm.cmd run pack` passed after removing a stale locked
  `release\win-unpacked` output directory. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 757 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-31 Bound Workspace Plan Package Check

This addendum records the bound-local-workspace plan checkpoint after Plan mode
was detached from the saved-version prerequisite. It extends controller,
desktop composer, and package evidence only; it does not extend installer
evidence, real-provider DeepSeek canary coverage, arbitrary generated-code
execution, external-network permissions, or general-purpose command/tool
execution readiness.

- A bound local workspace before Version 1 can now propose a plan from explicit
  plan wording such as "帮我先做下方案". Save Version remains the later
  acceptance step, not a prerequisite for planning.
- The controller preserves `workingProjectId` and the bound source-folder
  display state before, during, and after plan proposal. The plan request still
  sends only the bounded generation request with `existing_project_id`; renderer
  code does not pass source trees, Git receipts, Save facts, or Project Revision
  evidence.
- The desktop composer prepares current-project source-read approval for the
  selected workspace, calls the plan proposal path, and does not call submit,
  generate, or Save. Plan proposal remains read-only until the user approves a
  plan and later grants any required write authority.
- Focused validation passed through
  `npm.cmd exec vitest run src/features/builder/application/builderProjectController.test.ts src/app/BuilderApp.test.tsx`;
  the suite reported 108 passing Vitest tests.
- Repository validation passed through `npm.cmd exec tsc -b --pretty false`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and
  `npm.cmd run test:boundaries`. The full unit suite reported 574 passing
  Vitest tests, and the boundary suite reported 660 passing Node tests.
- `npm.cmd run pack` passed. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 757 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-31 Provider-Started Failure Explanation Package Check

This addendum records a narrow desktop failure-explanation checkpoint after a
real local conversation showed `context_ready` and `provider_request_started`
before a generic draft or answer failure. It extends main-only Conversation
summary text and package evidence only; it does not extend installer evidence,
real-provider DeepSeek canary coverage, arbitrary generated-code execution,
external-network permissions, or general-purpose command/tool execution
readiness.

- When the durable run has already recorded `provider_request_started`, an
  otherwise generic terminal failure now tells the user that the AI request
  ended before it returned a usable draft or answer. This avoids the older
  "draft could not be made" fallback for provider-started runs while still
  exposing no provider endpoint, credential, prompt, source tree, Git receipt,
  or internal failure object.
- The local event audit found that the failed draft and follow-up answer both
  reached `context_ready` and `provider_request_started`, so the observed
  failure was not a build-context snapshot admission failure before provider
  dispatch. A later answer and candidate on the same project succeeded and the
  candidate was accepted, so this checkpoint does not classify the package as
  globally unable to generate.
- Focused validation passed through
  `node --test tests\builder-conversation-main-service.test.cjs` and
  `node --test tests\builder-generation-main-service.test.cjs tests\builder-task-stream-projection.test.cjs`;
  the suites reported 34 and 57 passing Node tests.
- Repository validation passed through `npm.cmd run lint` and
  `npm.cmd run test:boundaries`; the boundary suite reported 660 passing Node
  tests.
- `npm.cmd run pack` passed. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 757 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-31 Task Stream Failure Phase Package Check

This addendum records the renderer-safe Task Stream failure-phase checkpoint
after provider-started failures became visible in the chat flow. It extends the
public task-stream projection, renderer sanitizer, completion-summary UI, and
packaged-canary evidence only; it does not extend installer evidence,
real-provider DeepSeek canary coverage, arbitrary generated-code execution,
external-network permissions, or general-purpose command/tool execution
readiness.

- `run_completed` items now include a fixed public `failure_phase`.
  Non-failed terminal outcomes must use `not_applicable`. Failed outcomes use
  either `not_recorded` or the latest fixed progress stage such as
  `context_ready`, `provider_request_started`, `provider_response_received`, or
  `result_preparing`.
- The Electron projection computes `failure_phase` from the full canonical
  event replay before applying the 128-item public window. The renderer
  sanitizer rejects missing, forged, mismatched, or phase-leaking shapes and
  validates the phase against visible progress whenever the suffix has enough
  evidence.
- Builder chat completion summaries now distinguish provider-started failures
  from earlier failures without exposing provider endpoints, credentials,
  prompts, source trees, Git receipts, failure codes, or internal exceptions.
- Focused validation passed through
  `node --test tests\builder-task-stream-projection.test.cjs` and
  `npm.cmd exec vitest run src\features\builder\domain\builderConversationSnapshot.test.ts src\features\builder\presentation\BuilderPage.test.tsx`;
  the suites reported 16 passing Node tests and 91 passing Vitest tests.
- Adjacent validation passed through
  `npm.cmd exec tsc -b --pretty false` and
  `node --test tests\builder-conversation-main-service.test.cjs tests\builder-generation-main-service.test.cjs`;
  the suites reported a clean typecheck and 76 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd run test:unit`, and `npm.cmd run test:boundaries`. The full unit
  suite reported 575 passing Vitest tests, and the boundary suite reported 661
  passing Node tests.
- `npm.cmd run pack` passed. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-31 Composer Plan Mode Menu Package Check

This addendum records the desktop composer checkpoint after the standalone
`Plan first` button was retired. It extends renderer composer UI, desktop UI
tests, packaged canary navigation, and roadmap text only; it does not extend
main generation authority, provider configuration, Git/SQLite authority,
command execution, terminal tools, or real-provider canary coverage.

- Explicit Plan mode is now entered from the composer `+` menu. The composer
  still has one Send command; choosing Plan mode creates the removable `Plan
  mode` chip, and the next Send routes through plan proposal instead of draft
  generation.
- Natural-language plan requests such as "Plan first" or "先给我方案" remain
  router inputs. They are not the visible extra button path.
- Saved-project and bound-workspace plan flows, project-read approval, dismissed
  approval restoration, plan review, and approved-plan continuation still use
  the same plan authority and do not create draft, Save, or Project Revision
  facts before explicit approval.
- Focused validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderComposer.test.tsx src\features\builder\presentation\BuilderPage.test.tsx src\app\BuilderApp.test.tsx`
  and `node --test tests\verify-packaged-canary.test.cjs`; the suites reported
  133 passing Vitest tests and 51 passing Node tests.
- Repository validation passed through `npm.cmd exec tsc -b --pretty false`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and
  `npm.cmd run test:boundaries`. The full unit suite reported 575 passing
  Vitest tests, and the boundary suite reported 661 passing Node tests.
- `npm.cmd run pack` passed. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 757 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-31 Chinese Contextual Execution Package Check

This addendum records the composer intent checkpoint after saved-result Chinese
follow-up phrases were admitted as contextual build commands. It extends the
renderer route decision surface, the main-owned submit fallback, integration
tests, and packaged evidence only; it does not extend arbitrary command
execution, external workspace access, terminal tools, provider configuration, or
real-provider DeepSeek canary coverage.

- Current-result follow-ups such as "那就写", "我需要你重新写方案",
  "按这个方案写", "直接写", and "改一下" now route to contextual build
  execution only when prior build context exists. If current-project write
  permission is missing, the route asks for that permission before dispatching.
- The same phrases remain read-only without prior main-owned build context:
  they are downgraded to clarify/answer, do not create a draft, and do not
  create Save or Project Revision facts.
- Renderer and Electron main classification are aligned. The renderer may
  project the composer state, but the main-owned generation service repeats the
  contextual-admission check before any draft work begins.
- Focused validation passed through
  `npm.cmd exec vitest run src\features\builder\application\builderComposerIntent.test.ts src\app\BuilderApp.test.tsx --runInBand`
  and `node --test tests\builder-generation-main-service.test.cjs`; the suites
  reported 186 passing Vitest tests and 43 passing Node tests.
- Repository validation passed through `npm.cmd exec tsc -b --pretty false`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and
  `npm.cmd run test:boundaries`. The full unit suite reported 595 passing
  Vitest tests, and the boundary suite reported 662 passing Node tests.
- `npm.cmd run pack` passed. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 757 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-31 Composer Brief Entry Package Check

This addendum records the composer checkpoint after the `+` menu gained an
explicit Brief entry. It extends renderer composer UI, renderer and main route
classification, route signal projection, tests, and roadmap text only; it does
not implement persistent Goal mode, arbitrary command execution, terminal
tools, provider configuration, external workspace access, or real-provider
DeepSeek canary coverage.

- The composer `+` menu now offers `Brief`. Choosing it does not send a
  message, add a second Send command, create a draft, ask for write permission,
  create Save/Revision facts, or claim a persistent Goal is running.
- The Brief entry turns the current visible composer text into an explicit
  brief-update scaffold. Renderer routing and the Electron main fallback both
  classify the explicit scaffold as `update_brief` / `brief_update` with the
  public route signal `explicit_brief`.
- Goal mode remains a separate future agent workflow: a user goal means the
  agent keeps working across steps until done or blocked. It is not equivalent
  to a plan, one-shot build, title, to-do, current result, or Brief update.
- Focused validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderComposer.test.tsx src\app\BuilderApp.test.tsx --runInBand`
  and
  `node --test tests\builder-generation-main-service.test.cjs tests\builder-route-decision-signals.test.cjs`;
  the suites reported 74 passing Vitest tests and 44 passing Node tests.
- Repository validation passed through `npm.cmd exec tsc -b --pretty false`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and
  `npm.cmd run test:boundaries`. The full unit suite reported 603 passing
  Vitest tests, and the boundary suite reported 662 passing Node tests.
- `npm.cmd run pack` passed. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 757 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-31 Packaged Canary Current Project Write Approval Check

This addendum records the packaged canary checkpoint after the Builder gained a
visible `Allow current project changes?` write-approval gate. It updates the
canary script and canary tests only; it does not change renderer UI, provider
configuration, Git/SQLite authority, application write permission semantics,
terminal tools, arbitrary command execution, or the packaged app payload.

- The packaged canary now treats the current-project write approval as an
  expected permission checkpoint. After source-folder binding, it clicks
  `Allow and continue` only when the exact current-project write approval card
  is visible, then continues waiting for live output and terminal preview
  evidence.
- The generation terminal stage remains fail-closed. App alerts, missing live
  output, preview timeouts, and approval-click failures still produce fixed
  redacted canary failures instead of being treated as success.
- Focused validation passed through
  `node --test tests\verify-packaged-canary.test.cjs` and
  `node --test tests\verify-deepseek-packaged-canary.test.cjs`; the suites
  reported 52 passing packaged-canary tests and 10 passing DeepSeek wrapper
  tests.
- `npm.cmd run verify:package` passed against the current unpacked release.
  Package verification reported `builder_package_verified`, production
  network-denying CSP, app id `com.clawfabric.builder`, product name
  `ClawFabric Builder`, and 757 ASAR entries.

## 2026-07-31 Composer Active Answer Admission And Focus Check

This addendum records the desktop composer checkpoint after active-answer
commands and post-send focus were tightened. It extends renderer composer UI,
renderer route admission, desktop UI tests, and roadmap text only; it does not
change main provider configuration, Git/SQLite authority, current-project
permission facts, terminal tools, arbitrary command execution, or real-provider
DeepSeek canary coverage.

- While a read-only answer is active, a clear build/change message such as
  "Change the main heading to My Notes." is no longer silently recorded as
  steering context. The composer records local route evidence, keeps the message
  editable, shows a fixed "not changed files yet" notice, and does not call
  `steer`, `submit`, Save, Review, Git, SQLite, provider, command, or permission
  authority.
- Existing active work steering remains available for live build/submission
  context. This checkpoint only blocks build-intent messages during active
  `answering` until a future queue or stop-and-build-next gate exists.
- After Enter submit or clicking the single Send/Add context button, focus is
  restored to the composer textarea when editing remains allowed, so follow-up
  typing can continue without manually clicking the composer again.
- Focused validation passed through
  `npm.cmd exec vitest run src\app\BuilderApp.test.tsx src\features\builder\presentation\BuilderComposer.test.tsx --runInBand`;
  the suites reported 76 passing Vitest tests.
- Repository validation passed through `npm.cmd exec tsc -b --pretty false`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and
  `npm.cmd run test:boundaries`. The full unit suite reported 605 passing
  Vitest tests, and the boundary suite reported 663 passing Node tests.
- `npm.cmd run pack` passed. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 757 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-31 Composer Active Answer Queued Build Check

This addendum records the follow-up desktop composer checkpoint that turns the
active-answer build guard into an explicit queue. It extends renderer route
admission and desktop UI tests only; it does not change main provider
configuration, Git/SQLite authority, durable permission facts, terminal tools,
arbitrary command execution, or real-provider DeepSeek canary coverage.

- While a read-only answer is active, a clear build/change message such as
  "Change the main heading to My Notes." is no longer left for the user to
  resend. The composer records local route evidence, clears the accepted input,
  shows a queued notice while the answer remains active, and never calls the
  active-run steering path for that message.
- When the answer finishes, the queued message re-enters the normal composer
  submit path. It still has to satisfy the selected workspace and current
  project write approval checks before `project.submit` can run.
- A focused regression covers the queued success path, and another covers the
  current-project write approval path to ensure queued builds cannot bypass the
  permission prompt.
- Focused validation passed through
  `npm.cmd exec vitest run src\app\BuilderApp.test.tsx src\features\builder\presentation\BuilderComposer.test.tsx --runInBand`;
  the suites reported 78 passing Vitest tests.
- Repository validation passed through `npm.cmd exec tsc -b --pretty false`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and
  `npm.cmd run test:boundaries`. The full unit suite reported 608 passing
  Vitest tests, and the boundary suite reported 663 passing Node tests.
- `npm.cmd run pack` passed. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 757 ASAR
  entries. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-31 Live Progress Beside Streaming Output Check

This addendum records the desktop chat-flow checkpoint that keeps fact-backed
work progress visible while provider live output is streaming. It changes only
renderer projection/display and tests; it does not add provider, tool,
terminal, command, Git, SQLite, permission, Save, Review, or Project Revision
authority.

- The chat flow no longer hides durable `run_started` /
  `run_progress_recorded` status rows when ephemeral live provider output is
  visible. Users can see both the assistant's display-safe streaming text and
  the current recorded work step.
- The displayed status text is still derived only from sanitized Task Stream
  facts such as `started` and `provider_request_started`; provider deltas remain
  assistant-message text and do not invent tool or execution steps.
- Focused validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderPage.test.tsx src\app\BuilderApp.test.tsx --runInBand`;
  the suites reported 127 passing Vitest tests.
- Full validation passed through `npm.cmd exec tsc -b --pretty false`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and
  `npm.cmd run test:boundaries`. Unit validation reported 39 passing Vitest
  files and 608 passing tests. Node boundary validation reported 663 passing
  tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `result_status: builder_package_verified`, `production_csp: network_denied`,
  and `asar_entry_count: 757`. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-07-31 Fact-Backed Waiting State Check

This addendum records a renderer-only follow-up to the live progress checkpoint.
It removes duplicate empty waiting copy while preserving the same provider live
output and Task Stream authorities.

- When provider live output is active but has not emitted display-safe text, the
  chat flow now uses visible `run_started` / `run_progress_recorded` rows as the
  waiting state instead of rendering a second empty assistant reply.
- A waiting live-output row remains available before any work-status item is
  visible and for explicit waiting copy, so approved-plan and generation startup
  states still have a display-safe fallback.
- Focused validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderPage.test.tsx --runInBand`;
  the suite reported 61 passing Vitest tests.
- Adjacent focused validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderPage.test.tsx src\app\BuilderApp.test.tsx --runInBand`;
  the suites reported 127 passing Vitest tests.
- Full validation passed through `npm.cmd exec tsc -b --pretty false`,
  `npm.cmd run lint`, `npm.cmd run test:unit`, and
  `npm.cmd run test:boundaries`. Unit validation reported 39 passing Vitest
  files and 608 passing tests. Node boundary validation reported 663 passing
  tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `result_status: builder_package_verified`, `production_csp: network_denied`,
  and `asar_entry_count: 757`. The refreshed executable is
  `release\win-unpacked\ClawFabric Builder.exe`.

## 2026-08-03 Current Package Smoke And Contract Check

This addendum records the current local package and contract evidence after the
August 3 chat-first, composer, Artifact workspace, Markdown artifact routing,
and Agent Delegation result review checkpoints. It is not a real-provider
DeepSeek canary pass, does not extend installer evidence, code-signing status,
mobile evidence, arbitrary generated-code execution, terminal tools, network
permission, publication, or persistent Agent autonomy.

- The current desktop package remains the unpacked executable at
  `release\win-unpacked\ClawFabric Builder.exe`. The executable timestamp was
  `2026/8/3 22:05:47` local time. The later architecture documentation-only
  checkpoint does not change the packaged payload because packaging includes
  `electron/**/*`, `dist/**/*`, and `package.json`, not the docs tree.
- Package verification passed through `npm.cmd run verify:package`. It reported
  `builder_package_verified`, app id `com.clawfabric.builder`, product name
  `ClawFabric Builder`, production network-denying CSP, and 765 ASAR entries.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, the expected executable path, isolated
  user-data launch, and `provider_configured: false` for the isolated smoke
  profile.
- Focused frontend validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderComposer.test.tsx src\features\builder\presentation\BuilderPage.test.tsx src\app\BuilderApp.test.tsx src\features\builder\application\builderComposerIntent.test.ts src\features\builder\application\builderProjectController.test.ts --runInBand`;
  the suites reported 5 passing files and 362 passing Vitest tests. This covers
  the single composer action while busy, independent Approval mode menu,
  composer context bar, consecutive no-folder and saved-project chat history,
  selected-workspace chat routing, contextual build admission, plan review, and
  Artifact workspace projection.
- Focused Node contract validation passed through
  `node --test tests\verify-packaged-canary.test.cjs tests\builder-generation-ipc-runtime.test.cjs tests\builder-generation-main-service.test.cjs tests\builder-route-decision-signals.test.cjs tests\builder-agent-delegation-result-review-store.test.cjs`;
  the command reported 148 passing Node tests. This covers packaged canary
  geometry/evidence contracts, generation IPC runtime boundaries, main route
  fallback parity, local Markdown artifact build admission, chat/plan/build
  dispatch contracts, route-decision signal vocabulary, and the main-only Agent
  Delegation result review store.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Real-provider generation, network stability, saved-profile
  credential handling, multi-turn provider behavior, and preview evidence must
  still be proven by an explicit `verify:packaged-canary:deepseek -- --execute`
  run before claiming full real-provider desktop readiness for this checkpoint.

## 2026-08-03 Agent Goal Contract Package Check

This addendum records the package checkpoint after adding a pure main-side Agent
Goal contract. It extends local Agent fact-contract and package evidence only;
it does not enable visible Goal mode, Agent
assignment execution, background work, model/tool dispatch, source writes,
terminal tools, network access, publication, installer evidence, or a real
saved-profile DeepSeek canary pass.

- The Agent Goal contract records a bounded objective with
  `continuous_until_done_or_blocked` execution semantics, owner-reviewed
  completion, explicit permission-required boundary, owner supervision, and
  bounded steps/runs/tool/runtime/private-source budget. It creates no Agent
  Assignment, Run, provider/model dispatch, permission grant, source read/write,
  Git fact, Project Revision, Review, Artifact, or visible Goal UI.
- The Goal status record supports owner decisions such as active, paused,
  blocked, completed, and cancelled. A completed or blocked status is still only
  a status fact: it does not materialize source, create an Artifact, or save a
  Project Revision.
- Focused validation passed through
  `node --test tests\builder-agent-goal-contract.test.cjs`; the suite reported
  5 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-goal-contract.test.cjs tests\builder-agent-definition-contract.test.cjs tests\builder-agent-assignment-contract.test.cjs tests\builder-agent-assignment-store.test.cjs tests\builder-agent-supervision-lease-contract.test.cjs tests\builder-agent-budget-audit-contract.test.cjs`;
  the command reported 26 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 739 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 766 ASAR
  entries. The refreshed executable timestamp was `2026/8/3 22:24:20` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, and
  `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-03 Agent Goal Store Package Check

This addendum records the package checkpoint after adding a main-only Agent
Goal store. It extends local Agent persistence evidence only; it does not
enable visible Goal mode, autonomous Agent execution, model/tool dispatch,
source reads or writes, terminal tools, network access, publication, installer
evidence, or a real saved-profile DeepSeek canary pass.

- The Agent Goal store persists the pure Agent Goal and Goal status records in
  strict main-only SQLite. It provides restart restore, idempotent replay,
  owner-scoped reads, task-scoped listing, one Goal per owner/Project/Task/
  Agent identity, ordered proposed/active/paused/blocked/completed/cancelled
  status transitions, schema fingerprint verification, and fixed redacted
  failures.
- The store keeps Goal status facts separate from execution. A completed,
  blocked, paused, or cancelled status still does not create an Agent
  Assignment, Run, provider/model dispatch, permission grant, source read/write,
  Git fact, Project Revision, Review, Artifact, or visible Goal UI.
- Focused validation passed through
  `node --test tests\builder-agent-goal-contract.test.cjs tests\builder-agent-goal-store.test.cjs`;
  the command reported 10 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-goal-contract.test.cjs tests\builder-agent-goal-store.test.cjs tests\builder-agent-definition-contract.test.cjs tests\builder-agent-definition-store.test.cjs tests\builder-agent-assignment-contract.test.cjs tests\builder-agent-assignment-store.test.cjs tests\builder-agent-supervision-lease-contract.test.cjs tests\builder-agent-supervision-lease-store.test.cjs tests\builder-agent-budget-audit-contract.test.cjs tests\builder-agent-budget-audit-store.test.cjs`;
  the command reported 46 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 744 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 767 ASAR
  entries. The refreshed executable timestamp was `2026/8/3 22:38:35` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, and
  `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-03 Agent Goal Assignment Admission Package Check

This addendum records the package checkpoint after adding a pure main-side
Agent Goal-to-Assignment admission contract. It extends local Agent fact-chain
evidence only; it does not enable visible Goal mode, autonomous Agent
execution, model/tool dispatch, source reads or writes, terminal tools, network
access, publication, installer evidence, or a real saved-profile DeepSeek
canary pass.

- The admission contract binds one active Goal status to one owner-supervised
  Assignment candidate. It requires matching owner, Agent version, Project,
  Conversation, Task, Run, objective text, and a narrowed Assignment budget
  within the Goal budget. It records that Assignment storage remains required
  before execution.
- The admission receipt keeps the bridge from Goal to Assignment separate from
  execution. It creates no Assignment row, Run, provider/model dispatch,
  permission grant, source read/write, Git fact, Project Revision, Review,
  Artifact, or visible Goal UI.
- Focused validation passed through
  `node --test tests\builder-agent-goal-assignment-admission.test.cjs tests\builder-agent-goal-contract.test.cjs tests\builder-agent-goal-store.test.cjs tests\builder-agent-assignment-contract.test.cjs tests\builder-agent-assignment-store.test.cjs`;
  the command reported 23 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 748 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 768 ASAR
  entries. The refreshed executable timestamp was `2026/8/3 22:49:39` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, and
  `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-03 Agent Goal Assignment Admission Store Package Check

This addendum records the package checkpoint after adding a main-only Agent
Goal-to-Assignment admission receipt store. It extends local Agent fact-chain
persistence evidence only; it does not enable visible Goal mode, autonomous
Agent execution, model/tool dispatch, source reads or writes, terminal tools,
network access, publication, installer evidence, or a real saved-profile
DeepSeek canary pass.

- The admission store persists Goal-to-Assignment admission receipts in strict
  main-only SQLite. It provides restart restore, idempotent replay,
  owner-scoped reads, read-by-Assignment lookup, task-scoped listing, one
  admission per Assignment candidate, schema fingerprint verification, and
  fixed redacted failures.
- The store keeps the admission receipt separate from execution. It stores the
  canonical Goal, active Goal status, Assignment candidate, and admission
  receipt, and re-verifies those contracts on read. It creates no Assignment
  row, Run, provider/model dispatch, permission grant, source read/write, Git
  fact, Project Revision, Review, Artifact, or visible Goal UI.
- Focused validation passed through
  `node --test tests\builder-agent-goal-assignment-admission.test.cjs tests\builder-agent-goal-assignment-admission-store.test.cjs`;
  the command reported 9 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-goal-assignment-admission.test.cjs tests\builder-agent-goal-assignment-admission-store.test.cjs tests\builder-agent-goal-contract.test.cjs tests\builder-agent-goal-store.test.cjs tests\builder-agent-assignment-contract.test.cjs tests\builder-agent-assignment-store.test.cjs`;
  the command reported 28 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 753 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 769 ASAR
  entries. The refreshed executable timestamp was `2026/8/3 23:00:39` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, and
  `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-03 Agent Goal Assignment Materialization Package Check

This addendum records the package checkpoint after adding a pure main-side Agent
Goal-to-Assignment materialization receipt contract. It extends local Agent
fact-chain evidence only; it does not enable visible Goal mode, autonomous Agent
execution, model/tool dispatch, source reads or writes, terminal tools, network
access, publication, installer evidence, or a real saved-profile DeepSeek
canary pass.

- The materialization contract proves that one admitted Goal Assignment
  candidate has been recorded in the Agent Assignment store with exactly its
  initial `queued` owner-supervised status. It binds the Goal admission receipt
  to Assignment store read evidence and rejects absent, progressed, forged,
  owner-mismatched, or timestamp-mismatched Assignment facts.
- The receipt keeps queued Assignment materialization separate from execution.
  It starts no Run, dispatches no provider/model or tool, grants no permission,
  reads or writes no source, mutates no Git fact or Project Revision, and
  creates no Review/Artifact authority or visible Goal UI.
- Focused validation passed through
  `node --test tests\builder-agent-goal-assignment-materialization.test.cjs`;
  the command reported 6 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-goal-assignment-admission.test.cjs tests\builder-agent-goal-assignment-admission-store.test.cjs tests\builder-agent-goal-assignment-materialization.test.cjs tests\builder-agent-goal-contract.test.cjs tests\builder-agent-goal-store.test.cjs tests\builder-agent-assignment-contract.test.cjs tests\builder-agent-assignment-store.test.cjs`;
  the command reported 34 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 759 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 770 ASAR
  entries. The refreshed executable timestamp was `2026/8/3 23:21:04` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, and
  `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-03 Agent Goal Assignment Materialization Store Package Check

This addendum records the package checkpoint after adding a main-only Agent
Goal-to-Assignment materialization receipt store. It extends local Agent
fact-chain persistence evidence only; it does not enable visible Goal mode,
autonomous Agent execution, model/tool dispatch, source reads or writes,
terminal tools, network access, publication, installer evidence, or a real
saved-profile DeepSeek canary pass.

- The materialization store persists Goal-to-Assignment materialization receipts
  in strict main-only SQLite. It provides restart restore, idempotent replay,
  owner-scoped reads, read-by-Assignment lookup, read-by-admission lookup,
  task-scoped listing, one materialization per admission and Assignment, schema
  fingerprint verification, and fixed redacted failures.
- The store keeps the materialization receipt separate from execution. It
  stores the canonical Goal, active Goal status, admission receipt, Assignment
  store read receipt, and materialization receipt, and re-verifies those
  contracts on read. It starts no Run, dispatches no provider/model or tool,
  grants no permission, reads or writes no source, mutates no Git fact or
  Project Revision, and creates no Review/Artifact authority or visible Goal
  UI.
- Focused validation passed through
  `node --test tests\builder-agent-goal-assignment-materialization-store.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-goal-assignment-materialization-store.test.cjs tests\builder-agent-goal-assignment-materialization.test.cjs tests\builder-agent-goal-assignment-admission.test.cjs tests\builder-agent-goal-assignment-admission-store.test.cjs tests\builder-agent-goal-contract.test.cjs tests\builder-agent-goal-store.test.cjs tests\builder-agent-assignment-contract.test.cjs tests\builder-agent-assignment-store.test.cjs`;
  the command reported 39 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 764 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 771 ASAR
  entries. The refreshed executable timestamp was `2026/8/3 23:39:58` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, and
  `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-03 Agent Goal Assignment Materialization Service Package Check

This addendum records the package checkpoint after adding a main-only Agent
Goal-to-Assignment materialization service. It extends local Agent fact-chain
composition evidence only; it does not enable visible Goal mode, autonomous
Agent execution, model/tool dispatch, source reads or writes, terminal tools,
network access, publication, installer evidence, or a real saved-profile
DeepSeek canary pass.

- The materialization service composes the existing admission store, Assignment
  store, and materialization store. It records or replays the active-Goal
  admission, records or replays the Assignment and its initial `queued` status,
  re-reads the store-backed queued Assignment, creates the materialization
  receipt, and records or replays that receipt for restart recovery.
- The service keeps queued Assignment materialization separate from execution.
  It starts no Run, dispatches no provider/model or tool, grants no permission,
  reads or writes no source, mutates no Git fact or Project Revision, and
  creates no Review/Artifact authority or visible Goal UI.
- Focused validation passed through
  `node --test tests\builder-agent-goal-assignment-materialization-service.test.cjs`;
  the command reported 4 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-goal-assignment-materialization-service.test.cjs tests\builder-agent-goal-assignment-materialization-store.test.cjs tests\builder-agent-goal-assignment-materialization.test.cjs tests\builder-agent-goal-assignment-admission.test.cjs tests\builder-agent-goal-assignment-admission-store.test.cjs tests\builder-agent-goal-contract.test.cjs tests\builder-agent-goal-store.test.cjs tests\builder-agent-assignment-contract.test.cjs tests\builder-agent-assignment-store.test.cjs`;
  the command reported 43 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 768 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 772 ASAR
  entries. The refreshed executable timestamp was `2026/8/3 23:54:04` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, and
  `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Assignment Supervision Service Package Check

This addendum records the package checkpoint after adding a main-only Agent
Assignment supervision service. It extends local Agent fact-chain supervision
evidence only; it does not enable visible Agents UI, autonomous Agent
execution, model/tool dispatch, source reads or writes, terminal tools, network
access, publication, installer evidence, or a real saved-profile DeepSeek
canary pass.

- The supervision service composes the existing Agent Assignment store and
  Agent Supervision Lease store. It reads the store-backed queued Assignment,
  preflights the active supervision lease and current time window before
  changing Assignment state, records or replays the Assignment's `active`
  status, records or replays the active lease, and recovers through idempotent
  store replay after restart.
- The service keeps active Assignment supervision separate from execution. It
  starts no Run, dispatches no provider/model or tool, grants no permission,
  reads or writes no source, mutates no Git fact or Project Revision, and
  creates no Review/Artifact authority or visible Agents UI.
- Focused validation passed through
  `node --test tests\builder-agent-assignment-supervision-service.test.cjs`;
  the command reported 4 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-assignment-supervision-service.test.cjs tests\builder-agent-supervision-lease-contract.test.cjs tests\builder-agent-supervision-lease-store.test.cjs tests\builder-agent-assignment-contract.test.cjs tests\builder-agent-assignment-store.test.cjs tests\builder-agent-project-work-result.test.cjs tests\builder-agent-project-work-result-store.test.cjs tests\builder-agent-budget-audit.test.cjs tests\builder-agent-budget-audit-store.test.cjs tests\builder-agent-delegation.test.cjs tests\builder-agent-delegation-store.test.cjs`;
  the command reported 32 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 772 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 773 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 00:09:06` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, and
  `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Budget Audit Service Package Check

This addendum records the package checkpoint after adding a main-only Agent
Budget Audit service. It extends local Agent pre-action budget evidence only;
it does not enable visible Agents UI, autonomous Agent execution, model/tool
dispatch, source reads or writes, terminal tools, network access, publication,
installer evidence, or a real saved-profile DeepSeek canary pass.

- The budget audit service composes the active Agent Supervision Lease store
  read with the Budget Audit store. It creates an allowed or denied budget
  audit only when the supplied active Assignment status, supervision lease,
  requested usage/outcome contract, and observed time match a currently active
  store-backed lease, then records or replays the audit and verifies it through
  read-by-audit and lease-scoped listing.
- The service keeps pre-action budget checks separate from execution. It
  dispatches no requested next action, starts no Run, dispatches no
  provider/model or tool, grants no permission, reads or writes no source,
  mutates no Git fact or Project Revision, and creates no Review/Artifact
  authority or visible Agents UI.
- Focused validation passed through
  `node --test tests\builder-agent-budget-audit-service.test.cjs`; the command
  reported 5 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-budget-audit-service.test.cjs tests\builder-agent-budget-audit-contract.test.cjs tests\builder-agent-budget-audit-store.test.cjs tests\builder-agent-assignment-supervision-service.test.cjs tests\builder-agent-supervision-lease-contract.test.cjs tests\builder-agent-supervision-lease-store.test.cjs tests\builder-agent-assignment-contract.test.cjs tests\builder-agent-assignment-store.test.cjs tests\builder-agent-project-work-contract.test.cjs tests\builder-agent-project-work-store.test.cjs`;
  the command reported 45 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 777 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 774 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 00:20:39` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, and
  `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Project Work Result Service Package Check

This addendum records the package checkpoint after adding a main-only Agent
Project Work Result service. It extends local Agent post-work result evidence
only; it does not enable visible Agents UI, autonomous Agent execution,
model/tool dispatch, source reads or writes, terminal tools, network access,
publication, installer evidence, or a real saved-profile DeepSeek canary pass.

- The project work result service composes the active Agent Supervision Lease
  store, Budget Audit store, and Project Work store. It creates a project-edit
  or project-test work result only when the supplied active Assignment status,
  supervision lease, allowed `finish_for_review` budget audit, and observed
  time match a currently active store-backed lease, then records or replays the
  result and verifies it through read-by-result and task-scoped listing.
- The service keeps post-work result receipts separate from review and
  materialization. It creates no Review, Artifact, Project Revision, candidate
  materialization, source write, Git mutation, provider/model dispatch, tool
  call, permission grant, IPC surface, or visible Agents UI.
- Focused validation passed through
  `node --test tests\builder-agent-project-work-result-service.test.cjs`; the
  command reported 5 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-project-work-result-service.test.cjs tests\builder-agent-project-work-contract.test.cjs tests\builder-agent-project-work-store.test.cjs tests\builder-agent-budget-audit-service.test.cjs tests\builder-agent-budget-audit-contract.test.cjs tests\builder-agent-budget-audit-store.test.cjs tests\builder-agent-assignment-supervision-service.test.cjs tests\builder-agent-supervision-lease-contract.test.cjs tests\builder-agent-supervision-lease-store.test.cjs tests\builder-agent-assignment-contract.test.cjs tests\builder-agent-assignment-store.test.cjs tests\builder-agent-delegation-result.test.cjs tests\builder-agent-delegation-result-store.test.cjs`;
  the command reported 55 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 782 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 775 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 00:33:42` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, and
  `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Project Work Result Review Store Package Check

This addendum records the package checkpoint after adding a main-only Agent
Project Work Result review contract and store. It extends local Agent owner
decision evidence only; it does not enable visible Agents UI, autonomous Agent
execution, model/tool dispatch, source reads or writes, terminal tools, network
access, publication, installer evidence, or a real saved-profile DeepSeek
canary pass.

- The review contract records a local owner decision over one recorded project
  work result. It can approve a proposed project-edit or project-test result
  for a later materialization gate, reject it, or acknowledge a blocked/failed
  result without materialization.
- The review store persists those owner decision receipts in main-owned SQLite
  with restart restore, idempotent replay, owner-scoped reads, read-by-result
  lookup, task-scoped review listing, one review per work result, schema
  fingerprint verification, and fixed redacted failures.
- This checkpoint keeps owner decisions separate from materialization. It
  creates no generic Review row, Artifact, source materialization, check run,
  Project Revision, Git mutation, provider/model dispatch, tool call,
  permission grant, IPC/preload command, or visible Agents UI.
- Focused validation passed through
  `node --test tests\builder-agent-project-work-result-review-contract.test.cjs tests\builder-agent-project-work-result-review-store.test.cjs`;
  the command reported 10 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-project-work-result-review-contract.test.cjs tests\builder-agent-project-work-result-review-store.test.cjs tests\builder-agent-project-work-result-service.test.cjs tests\builder-agent-project-work-contract.test.cjs tests\builder-agent-project-work-store.test.cjs tests\builder-agent-budget-audit-service.test.cjs tests\builder-agent-assignment-supervision-service.test.cjs tests\builder-agent-supervision-lease-store.test.cjs tests\builder-agent-assignment-store.test.cjs`;
  the command reported 43 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 792 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 777 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 00:49:17` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, and
  `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Project Work Result Review Service Package Check

This addendum records the package checkpoint after adding a main-only Agent
Project Work Result review service. It extends local Agent owner decision
evidence only; it does not enable visible Agents UI, autonomous Agent
execution, model/tool dispatch, source reads or writes, terminal tools, network
access, publication, installer evidence, or a real saved-profile DeepSeek
canary pass.

- The review service composes the Project Work Result store and Project Work
  Result review store. It accepts only an owner id, work result id, review
  input, and decision time; reads the store-backed project work result; verifies
  task-scoped result listing; records or replays the owner decision receipt; and
  verifies read-by-review, read-by-result, and task-scoped review listing.
- The service keeps owner decisions separate from materialization. It creates
  no generic Review row, Artifact, source materialization, check run, Project
  Revision, Git mutation, provider/model dispatch, tool call, permission grant,
  IPC/preload command, or visible Agents UI.
- Focused validation passed through
  `node --test tests\builder-agent-project-work-result-review-service.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-project-work-result-review-service.test.cjs tests\builder-agent-project-work-result-review-contract.test.cjs tests\builder-agent-project-work-result-review-store.test.cjs tests\builder-agent-project-work-result-service.test.cjs tests\builder-agent-project-work-contract.test.cjs tests\builder-agent-project-work-store.test.cjs tests\builder-agent-budget-audit-service.test.cjs tests\builder-agent-budget-audit-store.test.cjs tests\builder-agent-assignment-supervision-service.test.cjs tests\builder-agent-supervision-lease-store.test.cjs tests\builder-agent-assignment-store.test.cjs`;
  the command reported 53 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 797 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 778 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 00:57:48` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, and
  `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Project Work Result Review Release Service Package Check

This addendum records the package checkpoint after adding a main-only Agent
Project Work Result review release service. It closes the active supervision
lease only after a store-backed owner review decision; it does not enable
visible Agents UI, autonomous Agent execution, model/tool dispatch, source
reads or writes, terminal tools, network access, publication, installer
evidence, or a real saved-profile DeepSeek canary pass.

- The release service composes the Project Work Result review store and Agent
  Supervision Lease store. It accepts only an owner id, work result review id,
  and close time; reads the store-backed owner review; verifies task-scoped
  review listing; records or replays a completed lease release; and verifies
  the lease read plus assignment lease projection no longer show an active
  lease at the close time.
- The service keeps reviewed Agent work separate from materialization and from
  Assignment/Goal terminal status. It creates no generic Review row, Artifact,
  source materialization, check run, Project Revision, Git mutation,
  provider/model dispatch, tool call, permission grant, Assignment status
  change, IPC/preload command, or visible Agents UI.
- Focused validation passed through
  `node --test tests\builder-agent-project-work-result-review-release-service.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-project-work-result-review-release-service.test.cjs tests\builder-agent-project-work-result-review-service.test.cjs tests\builder-agent-project-work-result-review-contract.test.cjs tests\builder-agent-project-work-result-review-store.test.cjs tests\builder-agent-project-work-result-service.test.cjs tests\builder-agent-project-work-contract.test.cjs tests\builder-agent-project-work-store.test.cjs tests\builder-agent-budget-audit-service.test.cjs tests\builder-agent-budget-audit-store.test.cjs tests\builder-agent-assignment-supervision-service.test.cjs tests\builder-agent-supervision-lease-contract.test.cjs tests\builder-agent-supervision-lease-store.test.cjs tests\builder-agent-assignment-store.test.cjs`;
  the command reported 62 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 802 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 779 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 01:10:58` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Project Work Result Review Assignment Close Service Package Check

This addendum records the package checkpoint after adding a main-only Agent
Project Work Result review assignment close service. It closes the reviewed
Assignment attempt only after a store-backed owner review decision and a
completed supervision lease release; it does not enable visible Agents UI,
autonomous Agent execution, model/tool dispatch, source reads or writes,
terminal tools, network access, publication, installer evidence, or a real
saved-profile DeepSeek canary pass.

- The assignment close service composes the Assignment store, Project Work
  Result review store, and Agent Supervision Lease store. It accepts only an
  owner id, work result review id, completed Assignment status input, and close
  time; reads the store-backed owner review; requires the reviewed supervision
  lease to have a completed release; verifies no active assignment lease
  remains at the close time; records or replays the Assignment's `completed`
  status; and verifies assignment/task listing.
- The service keeps reviewed Agent work separate from Goal completion and from
  source materialization. It creates no generic Review row, Artifact, source
  materialization, check run, Project Revision, Git mutation, provider/model
  dispatch, tool call, permission grant, Goal status, IPC/preload command, or
  visible Agents UI.
- Focused validation passed through
  `node --test tests\builder-agent-project-work-result-review-assignment-close-service.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-project-work-result-review-assignment-close-service.test.cjs tests\builder-agent-project-work-result-review-release-service.test.cjs tests\builder-agent-project-work-result-review-service.test.cjs tests\builder-agent-project-work-result-review-contract.test.cjs tests\builder-agent-project-work-result-review-store.test.cjs tests\builder-agent-project-work-result-service.test.cjs tests\builder-agent-project-work-contract.test.cjs tests\builder-agent-project-work-store.test.cjs tests\builder-agent-budget-audit-service.test.cjs tests\builder-agent-budget-audit-store.test.cjs tests\builder-agent-assignment-supervision-service.test.cjs tests\builder-agent-supervision-lease-contract.test.cjs tests\builder-agent-supervision-lease-store.test.cjs tests\builder-agent-assignment-store.test.cjs`;
  the command reported 67 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 807 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 780 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 01:25:51` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Delegation Service Package Check

This addendum records the package checkpoint after adding a main-only Agent
Delegation service. It records a scoped Delegation only after reading
store-backed active parent Assignment, active supervision lease, and active
target Agent facts; it does not enable visible Agents UI, autonomous child
Agent execution, model/tool dispatch, source reads or writes, terminal tools,
network access, publication, installer evidence, or a real saved-profile
DeepSeek canary pass.

- The Delegation service composes the Agent Definition store, Assignment store,
  Agent Supervision Lease store, and Delegation store. It accepts only an owner
  id, parent Assignment id, target Agent id, Delegation input, and delegation
  time; reads the store-backed active parent Assignment and task assignment
  listing; requires an active parent supervision lease at the delegation time;
  reads the active target Agent/current version; records or replays the
  Delegation receipt; and verifies read-by-delegation plus parent-task and
  child-task Delegation listings.
- The service keeps Delegation separate from child execution. It creates no
  child Assignment, child Run, generic Review row, Artifact, source
  materialization, check run, Project Revision, Git mutation, provider/model
  dispatch, tool call, permission grant, IPC/preload command, or visible Agents
  UI.
- Focused validation passed through
  `node --test tests\builder-agent-delegation-service.test.cjs`; the command
  reported 4 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-delegation-service.test.cjs tests\builder-agent-delegation-contract.test.cjs tests\builder-agent-delegation-store.test.cjs tests\builder-agent-delegation-result-contract.test.cjs tests\builder-agent-delegation-result-store.test.cjs tests\builder-agent-delegation-result-admission-contract.test.cjs tests\builder-agent-delegation-result-admission-store.test.cjs tests\builder-agent-delegation-result-review-contract.test.cjs tests\builder-agent-delegation-result-review-store.test.cjs tests\builder-agent-definition-store.test.cjs tests\builder-agent-assignment-store.test.cjs tests\builder-agent-supervision-lease-store.test.cjs`;
  the command reported 52 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 811 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 781 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 01:39:25` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Delegation Result Service Package Check

This addendum records the package checkpoint after adding a main-only Agent
Delegation result service. It records a delegated child result-return receipt
only after reading a store-backed Delegation receipt and verifying parent/child
Task Delegation and result listings; it does not enable visible Agents UI,
autonomous child Agent execution, model/tool dispatch, source reads or writes,
terminal tools, network access, publication, installer evidence, or a real
saved-profile DeepSeek canary pass.

- The Delegation result service composes the Agent Delegation store and Agent
  Delegation result store. It accepts only an owner id, Delegation id, result
  input, and observation time; reads the store-backed Delegation; verifies
  parent-task and child-task Delegation listings; records or replays the child
  result-return receipt; and verifies read-by-result plus parent-task and
  child-task result listings.
- The service keeps child result return separate from parent review and
  materialization. It creates no child Assignment, child Run, generic Review
  row, Artifact, source materialization, check run, Project Revision, Git
  mutation, provider/model dispatch, tool call, permission grant, IPC/preload
  command, or visible Agents UI.
- Focused validation passed through.
  `node --test tests\builder-agent-delegation-result-service.test.cjs`; the
  command reported 5 passing Node tests.
- Adjacent Agent validation passed through.
  `node --test tests\builder-agent-delegation-service.test.cjs tests\builder-agent-delegation-result-service.test.cjs tests\builder-agent-delegation-contract.test.cjs tests\builder-agent-delegation-store.test.cjs tests\builder-agent-delegation-result-contract.test.cjs tests\builder-agent-delegation-result-store.test.cjs tests\builder-agent-delegation-result-admission-contract.test.cjs tests\builder-agent-delegation-result-admission-store.test.cjs tests\builder-agent-delegation-result-review-contract.test.cjs tests\builder-agent-delegation-result-review-store.test.cjs tests\builder-agent-definition-store.test.cjs tests\builder-agent-assignment-store.test.cjs tests\builder-agent-supervision-lease-store.test.cjs`;
  the command reported 61 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 816 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 782 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 01:54:03` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Delegation Result Admission Service Package Check

This addendum records the package checkpoint after adding a main-only Agent
Delegation result admission service. It records a local admission receipt for a
store-backed delegated child result only after reading the recorded result fact
and verifying parent/child Task result listings; it does not enable visible
Agents UI, autonomous child Agent execution, owner review, parent
materialization, model/tool dispatch, source reads or writes, terminal tools,
network access, publication, installer evidence, or a real saved-profile
DeepSeek canary pass.

- The Delegation result admission service composes the Agent Delegation result
  store and Agent Delegation result admission store. It accepts only an owner
  id, Delegation result id, admission input, and observation time; reads the
  store-backed result; verifies parent-task and child-task result listings;
  records or replays the admission receipt; and verifies read-by-admission,
  read-by-result, parent-task admission listing, and child-task admission
  listing.
- The service keeps delegated child result admission separate from owner review
  and parent materialization. It creates no child Assignment, child Run, generic
  Review row, Artifact, source materialization, check run, Project Revision, Git
  mutation, provider/model dispatch, tool call, permission grant, IPC/preload
  command, or visible Agents UI.
- Focused validation passed through
  `node --test tests\builder-agent-delegation-result-admission-service.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-delegation-service.test.cjs tests\builder-agent-delegation-result-service.test.cjs tests\builder-agent-delegation-result-admission-service.test.cjs tests\builder-agent-delegation-contract.test.cjs tests\builder-agent-delegation-store.test.cjs tests\builder-agent-delegation-result-contract.test.cjs tests\builder-agent-delegation-result-store.test.cjs tests\builder-agent-delegation-result-admission-contract.test.cjs tests\builder-agent-delegation-result-admission-store.test.cjs tests\builder-agent-delegation-result-review-contract.test.cjs tests\builder-agent-delegation-result-review-store.test.cjs tests\builder-agent-definition-store.test.cjs tests\builder-agent-assignment-store.test.cjs tests\builder-agent-supervision-lease-store.test.cjs`;
  the command reported 66 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 821 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 783 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 02:09:26` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Delegation Result Review Service Package Check

This addendum records the package checkpoint after adding a main-only Agent
Delegation result review service. It records an owner review decision receipt
for a store-backed admitted child result only after reading the recorded
admission fact and verifying parent/child Task admission listings; it does not
enable visible Agents UI, autonomous child Agent execution, generic Review row
creation, parent materialization, model/tool dispatch, source reads or writes,
terminal tools, network access, publication, installer evidence, or a real
saved-profile DeepSeek canary pass.

- The Delegation result review service composes the Agent Delegation result
  admission store and Agent Delegation result review store. It accepts only an
  owner id, Delegation result admission id, review input, and review time; reads
  the store-backed admitted child result; verifies parent-task and child-task
  admission listings; records or replays the review receipt; and verifies
  read-by-review, read-by-admission, parent-task review listing, and child-task
  review listing.
- The service keeps delegated child result review separate from generic Review
  rows and parent materialization. It creates no child Assignment, child Run,
  generic Review row, Artifact, source materialization, check run, Project
  Revision, Git mutation, provider/model dispatch, tool call, permission grant,
  IPC/preload command, or visible Agents UI.
- Focused validation passed through
  `node --test tests\builder-agent-delegation-result-review-service.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent validation passed through
  `node --test tests\builder-agent-delegation-service.test.cjs tests\builder-agent-delegation-result-service.test.cjs tests\builder-agent-delegation-result-admission-service.test.cjs tests\builder-agent-delegation-result-review-service.test.cjs tests\builder-agent-delegation-contract.test.cjs tests\builder-agent-delegation-store.test.cjs tests\builder-agent-delegation-result-contract.test.cjs tests\builder-agent-delegation-result-store.test.cjs tests\builder-agent-delegation-result-admission-contract.test.cjs tests\builder-agent-delegation-result-admission-store.test.cjs tests\builder-agent-delegation-result-review-contract.test.cjs tests\builder-agent-delegation-result-review-store.test.cjs tests\builder-agent-definition-store.test.cjs tests\builder-agent-assignment-store.test.cjs tests\builder-agent-supervision-lease-store.test.cjs`;
  the command reported 71 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 826 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 784 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 02:21:44` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Delegation Result Parent Materialization Eligibility Package Check

This addendum records the package checkpoint after adding a pure main-side Agent
Delegation result parent materialization eligibility contract. It records only
that an approved proposed child result review is eligible for a later parent
materialization gate; it does not enable visible Agents UI, autonomous child
Agent execution, generic Review row creation, parent materialization,
model/tool dispatch, source reads or writes, terminal tools, network access,
publication, installer evidence, or a real saved-profile DeepSeek canary pass.

- The Delegation result parent materialization eligibility contract verifies
  the Delegation/result/admission/review chain and accepts only owner-approved
  proposed child-result reviews. Rejected reviews and blocked/failed
  acknowledgements fail closed before any eligibility receipt is created.
- The contract keeps parent materialization behind a later independent gate. It
  creates no store/service row, child Assignment, child Run, generic Review row,
  Artifact, source materialization, check run, Project Revision, Git mutation,
  provider/model dispatch, tool call, permission grant, IPC/preload command, or
  visible Agents UI.
- Focused validation passed through
  `node --test tests\builder-agent-delegation-result-parent-materialization-eligibility.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent Delegation validation passed through
  `node --test tests\builder-agent-delegation-contract.test.cjs tests\builder-agent-delegation-result-contract.test.cjs tests\builder-agent-delegation-result-admission-contract.test.cjs tests\builder-agent-delegation-result-review-contract.test.cjs tests\builder-agent-delegation-result-parent-materialization-eligibility.test.cjs tests\builder-agent-delegation-store.test.cjs tests\builder-agent-delegation-service.test.cjs tests\builder-agent-delegation-result-store.test.cjs tests\builder-agent-delegation-result-service.test.cjs tests\builder-agent-delegation-result-admission-store.test.cjs tests\builder-agent-delegation-result-admission-service.test.cjs tests\builder-agent-delegation-result-review-store.test.cjs tests\builder-agent-delegation-result-review-service.test.cjs`;
  the command reported 61 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 831 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 785 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 02:35:50` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Delegation Result Parent Materialization Eligibility Store Package Check

This addendum records the package checkpoint after adding a main-only Agent
Delegation result parent materialization eligibility store. It persists only
the receipt that an approved proposed child result review is eligible for a
later parent materialization gate; it does not enable visible Agents UI,
autonomous child Agent execution, generic Review row creation, parent
materialization, model/tool dispatch, source reads or writes, terminal tools,
network access, publication, installer evidence, or a real saved-profile
DeepSeek canary pass.

- The Delegation result parent materialization eligibility store verifies the
  Delegation/result/admission/review/eligibility chain for owner-approved
  proposed child results, persists canonical eligibility receipts in a
  main-owned SQLite table, restores them after restart, replays idempotent
  records, enforces owner-scoped reads, supports parent-task and child-task
  eligibility listing, supports read-by-review lookup, enforces one eligibility
  per reviewed child result, and validates schema fingerprint drift.
- The store keeps parent materialization behind a later independent gate. It
  creates no service row, child Assignment, child Run, generic Review row,
  Artifact, source materialization, check run, Project Revision, Git mutation,
  provider/model dispatch, tool call, permission grant, IPC/preload command, or
  visible Agents UI.
- Focused validation passed through
  `node --test tests\builder-agent-delegation-result-parent-materialization-eligibility-store.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent Delegation validation passed through
  `node --test tests\builder-agent-delegation-contract.test.cjs tests\builder-agent-delegation-result-contract.test.cjs tests\builder-agent-delegation-result-admission-contract.test.cjs tests\builder-agent-delegation-result-review-contract.test.cjs tests\builder-agent-delegation-result-parent-materialization-eligibility.test.cjs tests\builder-agent-delegation-result-parent-materialization-eligibility-store.test.cjs tests\builder-agent-delegation-store.test.cjs tests\builder-agent-delegation-service.test.cjs tests\builder-agent-delegation-result-store.test.cjs tests\builder-agent-delegation-result-service.test.cjs tests\builder-agent-delegation-result-admission-store.test.cjs tests\builder-agent-delegation-result-admission-service.test.cjs tests\builder-agent-delegation-result-review-store.test.cjs tests\builder-agent-delegation-result-review-service.test.cjs`;
  the command reported 66 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 836 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 786 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 02:52:51` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Delegation Result Parent Materialization Eligibility Service Package Check

This addendum records the package checkpoint after adding a main-only Agent
Delegation result parent materialization eligibility service. It records or
replays only the receipt that an approved proposed child result review is
eligible for a later parent materialization gate; it does not enable visible
Agents UI, autonomous child Agent execution, generic Review row creation,
parent materialization, model/tool dispatch, source reads or writes, terminal
tools, network access, publication, installer evidence, or a real saved-profile
DeepSeek canary pass.

- The Delegation result parent materialization eligibility service composes the
  Delegation result review store and eligibility store. It accepts only owner
  id, Delegation result review id, eligibility input, and an observed time;
  reads the store-backed owner review; verifies parent-task and child-task
  review listings; records or replays the eligibility receipt; and verifies
  read-by-eligibility, read-by-review, parent-task eligibility listing, and
  child-task eligibility listing.
- The service accepts only owner-approved proposed child-result reviews and
  rejects rejected reviews and blocked/failed acknowledgements before recording
  eligibility. It creates no child Assignment, child Run, generic Review row,
  Artifact, source materialization, check run, Project Revision, Git mutation,
  provider/model dispatch, tool call, permission grant, IPC/preload command, or
  visible Agents UI. Parent materialization remains a separate later gate.
- Focused validation passed through
  `node --test tests\builder-agent-delegation-result-parent-materialization-eligibility-service.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent Delegation validation passed through
  `node --test tests\builder-agent-delegation-contract.test.cjs tests\builder-agent-delegation-result-contract.test.cjs tests\builder-agent-delegation-result-admission-contract.test.cjs tests\builder-agent-delegation-result-review-contract.test.cjs tests\builder-agent-delegation-result-parent-materialization-eligibility.test.cjs tests\builder-agent-delegation-result-parent-materialization-eligibility-store.test.cjs tests\builder-agent-delegation-result-parent-materialization-eligibility-service.test.cjs tests\builder-agent-delegation-store.test.cjs tests\builder-agent-delegation-service.test.cjs tests\builder-agent-delegation-result-store.test.cjs tests\builder-agent-delegation-result-service.test.cjs tests\builder-agent-delegation-result-admission-store.test.cjs tests\builder-agent-delegation-result-admission-service.test.cjs tests\builder-agent-delegation-result-review-store.test.cjs tests\builder-agent-delegation-result-review-service.test.cjs`;
  the command reported 71 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 841 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 787 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 03:04:25` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Composer Escape Floating Panels Package Check

This addendum records the package checkpoint after adding keyboard Escape
close behavior for the Builder composer floating panels. It improves only the
renderer interaction for the composer add menu, approval menu, and workspace
picker; it does not change route classification, approval authority,
workspace binding, task stream facts, main IPC, provider dispatch, Git/SQLite
authority, generation lifecycle, packaging policy, installer evidence, or real
saved-profile DeepSeek canary coverage.

- The composer now closes its add menu, approval menu, and workspace picker
  when Escape is pressed, and returns focus to the composer textarea without
  scrolling the page. Dismissing a build-triggered workspace picker through
  Escape uses the same public dismissal note as the pointer-dismiss path.
- Focused validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderComposer.test.tsx --runInBand`;
  the command reported 16 passing frontend tests.
- Adjacent renderer validation passed through
  `npm.cmd exec vitest run src\features\builder\presentation\BuilderComposer.test.tsx src\features\builder\presentation\BuilderPage.test.tsx src\app\BuilderApp.test.tsx src\app\BuilderDesktopLayoutStyles.test.ts --runInBand`;
  the command reported 179 passing frontend tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 841 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 787 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 03:21:52` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Delegation Result Parent Materialization Contract Package Check

This addendum records the package checkpoint after adding a pure main-side
Agent Delegation result parent materialization contract. It records only a
receipt that an owner-approved delegated child result has been materialized as
a parent task context receipt for later owner-supervised use; it does not
enable visible Agents UI, autonomous child Agent execution, generic Review row
creation, Artifact creation, source materialization, check runs, Project
Revision creation, Git mutation, model/tool dispatch, permission grants,
IPC/preload commands, installer evidence, or a real saved-profile DeepSeek
canary pass.

- The parent materialization contract verifies the
  Delegation/result/admission/review/eligibility chain, parent and child
  Conversation/Task/Run identity, owner, project, fixed result summary, owner
  review decision, eligibility status, and parent context receipt status before
  creating a deterministic receipt. It fails closed on timing, owner, identity,
  eligibility, result, lifecycle, and parent-mutation drift.
- The receipt records only `local_parent_task_context_receipt_only` authority.
  It carries no raw child output, patch, source tree, generic Review id,
  Artifact id, Project Revision fact, provider/model envelope, credential,
  permission grant, IPC/preload path, or visible Agents UI authority.
- Focused validation passed through
  `node --test tests\builder-agent-delegation-result-parent-materialization.test.cjs`;
  the command reported 4 passing Node tests.
- Adjacent Agent Delegation contract validation passed through
  `node --test tests\builder-agent-delegation-contract.test.cjs tests\builder-agent-delegation-result-contract.test.cjs tests\builder-agent-delegation-result-admission-contract.test.cjs tests\builder-agent-delegation-result-review-contract.test.cjs tests\builder-agent-delegation-result-parent-materialization-eligibility.test.cjs tests\builder-agent-delegation-result-parent-materialization.test.cjs`;
  the command reported 26 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 845 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 788 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 03:33:31` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Delegation Result Parent Materialization Store Package Check

This addendum records the package checkpoint after adding the strict main-only
SQLite store for Agent Delegation result parent materialization receipts. It
persists the already approved parent task context receipt chain for restart and
owner-scoped reads; it does not enable visible Agents UI, autonomous child Agent
execution, generic Review row creation, Artifact creation, source
materialization, check runs, Project Revision creation, Git mutation,
provider/model dispatch, tool calls, permission grants, IPC/preload commands,
installer evidence, or a real saved-profile DeepSeek canary pass.

- The store verifies and persists the
  Delegation/result/admission/review/eligibility/materialization receipt chain,
  owner scope, idempotent replay, read-by-materialization lookup,
  read-by-eligibility lookup, parent task listing, child task listing, restart
  restore, and schema fingerprint before returning public main-side receipts.
  It fails closed on hostile inputs, malformed reads, tampered rows, schema
  drift, unsafe database paths, and duplicate materialization for the same
  eligibility/review/admission/result chain.
- The persisted receipt records only
  `main_owned_agent_delegation_result_parent_materialization_store` evidence
  authority. It carries no raw child output, patch, source tree, generic Review
  id, Artifact id, Project Revision fact, provider/model envelope, credential,
  permission grant, IPC/preload path, or visible Agents UI authority.
- Focused validation passed through
  `node --test tests\builder-agent-delegation-result-parent-materialization-store.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent Delegation A2 validation passed through the Delegation,
  result, admission, review, eligibility, materialization, store, and service
  Node contract set; the command reported 80 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 850 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 789 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 03:47:07` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Delegation Result Parent Materialization Service Package Check

This addendum records the package checkpoint after adding the strict main-only
service that composes the parent materialization eligibility store and parent
materialization store. It records or replays an already eligible delegated
child result as a parent task context receipt for later owner-supervised use;
it does not enable visible Agents UI, autonomous child Agent execution, generic
Review row creation, Artifact creation, source materialization, check runs,
Project Revision creation, Git mutation, provider/model dispatch, tool calls,
permission grants, IPC/preload commands, installer evidence, or a real
saved-profile DeepSeek canary pass.

- The service reads the store-backed eligibility receipt, verifies parent-task
  and child-task eligibility listings, creates the parent materialization
  receipt, records or replays it through the materialization store, and verifies
  read-by-materialization, read-by-eligibility, parent-task materialization
  listing, and child-task materialization listing before returning a main-side
  result. It fails closed on missing eligibility, owner drift, time drift,
  malformed materialization input, replay conflicts, malformed stores, hostile
  inputs, and redacted internal failures.
- The service records only
  `main_owned_agent_delegation_result_parent_materialization_service` evidence
  authority over `local_parent_task_context_receipt_only` materialization. It
  carries no raw child output, patch, source tree, generic Review id, Artifact
  id, Project Revision fact, provider/model envelope, credential, permission
  grant, IPC/preload path, or visible Agents UI authority.
- Focused validation passed through
  `node --test tests\builder-agent-delegation-result-parent-materialization-service.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent Delegation A2 validation passed through the Delegation,
  result, admission, review, eligibility, materialization, store, and service
  Node contract set; the command reported 85 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 855 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 790 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 03:58:24` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Parent Task Context Projection Package Check

This addendum records the package checkpoint after adding the strict main-side
Agent parent task context projection from reviewed delegated child result
materialization receipts. It derives bounded child-result reference facts for
future TaskContextSnapshot assembly; it does not enable visible Agents UI,
autonomous child Agent execution, generic Review row creation, Artifact
creation, source materialization, check runs, Project Revision creation, Git
mutation, provider/model dispatch, tool calls, permission grants,
IPC/preload commands, installer evidence, or a real saved-profile DeepSeek
canary pass.

- The projection verifies the
  Delegation/result/admission/review/eligibility/materialization chain and the
  parent Task identity before deriving parent-context refs. It emits only fixed
  materialization, eligibility, review, admission, result, delegation,
  child-conversation, child-task, child-run, Agent, status, summary-code,
  decision, and materialization-time fields. It sorts and deduplicates refs,
  caps input materializations at 128, includes at most 32 refs, records
  truncation explicitly, and binds the projection id to a canonical digest.
- The projection carries only
  `main_agent_parent_task_context_projection_v1` evidence authority over
  `local_parent_task_context_projection_only`. It carries no raw child output,
  patch, source tree, display summary text, provider/model envelope,
  credential, permission grant, generic Review row, Artifact id, Project
  Revision fact, Git fact, IPC/preload path, or visible Agents UI authority.
- Focused validation passed through
  `node --test tests\builder-agent-parent-task-context-projection.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent Delegation A2 validation passed through the Delegation,
  result, admission, review, eligibility, materialization, parent
  materialization stores/services, and parent task context projection Node
  contract set; the command reported 34 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 860 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 791 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 04:14:43` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Task Context Snapshot Contract Package Check

This addendum records the package checkpoint after adding the strict main-side
Agent Task Context Snapshot contract. It creates a digest-bound receipt for the
bounded context references used before one owner-supervised Agent action; it
does not enable visible Agents UI, autonomous Agent execution, provider/model
dispatch, tool calls, command execution, source reads or writes, generic
Review row creation, Artifact creation, source materialization, check runs,
Project Revision creation, Git mutation, permission grants, IPC/preload
commands, installer evidence, or a real saved-profile DeepSeek canary pass.

- The snapshot verifies Agent Definition/Version identity, active Assignment
  status, active supervision lease window, allowed Budget Audit admission,
  task/run identity, token budget, base revision reference shape, bounded
  task-local memory/message/artifact/run-event/permission id arrays, and the
  optional parent task context projection. It rejects denied budget audits,
  stale or future context evidence, duplicate refs, mismatched parent Task
  context projections, extras, accessors, proxies, raw prompt attempts, and
  digest/id drift.
- The snapshot records only refs, fixed action-admission facts, safe budget
  values, optional parent-context projection id/digest/count, optional base
  revision digest/commit reference, and canonical digest identity. It carries
  no prompt, raw transcript, current brief text, child output, patch, source
  tree, file content, display child summary text, provider/model envelope,
  credential, permission grant, generic Review row, Artifact payload, source
  materialization, check run output, Git mutation, Project Revision row,
  IPC/preload path, or visible Agents UI authority.
- Focused validation passed through
  `node --test tests\builder-agent-task-context-snapshot.test.cjs`; the command
  reported 5 passing Node tests.
- Adjacent Agent context validation passed through the Agent Definition,
  Assignment, Supervision Lease, Budget Audit, parent task context projection,
  and Agent Task Context Snapshot contract set; the command reported 26
  passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 865 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 792 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 04:27:01` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Task Context Snapshot Store Package Check

This addendum records the package checkpoint after adding the strict main-only
SQLite store for Agent Task Context Snapshot receipts. It persists the
digest-bound context snapshot facts for restart recovery and owner-scoped
reads; it does not enable visible Agents UI, autonomous Agent execution,
provider/model dispatch, tool calls, command execution, source reads or writes,
generic Review row creation, Artifact creation, source materialization, check
runs, Project Revision creation, Git mutation, permission grants,
IPC/preload commands, installer evidence, or a real saved-profile DeepSeek
canary pass.

- The store records or replays only sanitized
  `builder-agent-task-context-snapshot.v1` receipts. It verifies canonical
  snapshot JSON against indexed identity, owner/project/conversation/task/run,
  Assignment, active status, lease, Budget Audit, context digest, requested
  action, and created/observed times before returning stored facts. It supports
  read-by-snapshot, read-by-Budget-Audit, task-scoped listing, run-scoped
  listing, restart restore, one snapshot per Budget Audit, schema fingerprint
  verification, guarded absolute database paths, and fixed redacted failures.
- The store records only
  `main_owned_agent_task_context_snapshot_store` evidence authority over
  canonical snapshot receipts. It carries no prompt, raw transcript, current
  brief text, child output, patch, source tree, file content, display child
  summary text, provider/model envelope, credential, permission grant, generic
  Review row, Artifact payload, source materialization, check run output, Git
  mutation, Project Revision row, IPC/preload path, or visible Agents UI
  authority.
- Focused validation passed through
  `node --test tests\builder-agent-task-context-snapshot-store.test.cjs`; the
  command reported 5 passing Node tests.
- Adjacent Agent context validation passed through the Agent Definition,
  Assignment, Supervision Lease, Budget Audit, parent task context projection,
  Agent Task Context Snapshot contract, and Agent Task Context Snapshot store
  set; the command reported 31 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 870 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 793 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 04:39:38` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Task Context Snapshot Service Package Check

This addendum records the package checkpoint after adding the strict main-only
service gate that records Agent Task Context Snapshot receipts before any later
supervised Agent action. It composes already-recorded active lease evidence,
allowed Budget Audit evidence, the context snapshot contract, and the context
snapshot store; it does not enable visible Agents UI, autonomous Agent
execution, provider/model dispatch, tool calls, command execution, source reads
or writes, generic Review row creation, Artifact creation, source
materialization, check runs, Project Revision creation, Git mutation,
permission grants, IPC/preload commands, installer evidence, or a real
saved-profile DeepSeek canary pass.

- The service records or replays a bounded
  `builder-agent-task-context-snapshot.v1` receipt only after reading a
  store-backed active supervision lease and a same-lease allowed Budget Audit
  for the requested next action. It verifies read-by-snapshot,
  read-by-Budget-Audit, task-scoped snapshot listing, run-scoped snapshot
  listing, restart replay, denied/missing/stale failure paths, and fixed
  redacted failures.
- The service records only
  `main_owned_agent_task_context_snapshot_service` evidence authority over the
  pre-dispatch context snapshot receipt. It carries no prompt, raw transcript,
  current brief text, child output, patch, source tree, file content, display
  child summary text, provider/model envelope, credential, permission grant,
  generic Review row, Artifact payload, source materialization, check run
  output, Git mutation, Project Revision row, IPC/preload path, visible Agents
  UI authority, or next-action dispatch authority.
- Focused validation passed through
  `node --test tests\builder-agent-task-context-snapshot-service.test.cjs`; the
  command reported 5 passing Node tests.
- Adjacent Agent context validation passed through Assignment, Supervision
  Lease, Budget Audit, parent task context projection, Agent Task Context
  Snapshot contract, Snapshot store, and Snapshot service tests; the command
  reported 47 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 875 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 794 ASAR
  entries. The refreshed executable timestamp was `2026/8/4 04:50:35` local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Supervised Action Admission Package Check

This addendum records the package checkpoint after adding the pure main-side
Supervised Action Admission contract over one Agent Task Context Snapshot
receipt. It binds a running, non-interrupted, non-cancelled Run state to the
snapshot's requested next action and routes that action only to the next
required later gate; it does not enable visible Agents UI, autonomous Agent
execution, provider/model dispatch, tool calls, command execution, source reads
or writes, generic Review row creation, Artifact creation, source
materialization, check runs, Project Revision creation, Git mutation,
permission grants, IPC/preload commands, installer evidence, or a real
saved-profile DeepSeek canary pass.

- The contract records only a digest-bound
  `builder-agent-supervised-action-admission.v1` receipt. It verifies the Task
  Context Snapshot receipt, requested action equality, running/cancel/interrupt
  state, action request id, admission time, bounded context counts, token
  budget, fixed lifecycle, fixed authority, and admission digest/id. It routes
  `start_step`, `call_tool`, `read_private_source`, and `finish_for_review` to
  later dedicated gates without performing any of them.
- The contract records only
  `main_agent_supervised_action_admission_contract_v1` authority. It carries no
  prompt, raw transcript, current brief text, child output, patch, source tree,
  file content, provider/model envelope, credential, permission grant, tool
  call, tool result, generic Review row, Artifact payload, source
  materialization, check run output, Git mutation, Project Revision row,
  IPC/preload path, visible Agents UI authority, or next-action dispatch
  authority.
- Focused validation passed through
  `node --test tests\builder-agent-supervised-action-admission.test.cjs`; the
  command reported 5 passing Node tests.
- Adjacent Agent admission validation passed through Assignment, Supervision
  Lease, Budget Audit, Agent Task Context Snapshot contract, Snapshot service,
  and Supervised Action Admission tests; the command reported 27 passing Node
  tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 880 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 795 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 05:02:55 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Supervised Action Admission Store Package Check

This addendum records the package checkpoint after adding the pure main-side
Supervised Action Admission store. It persists
`builder-agent-supervised-action-admission.v1` receipts as restart-replayable
SQLite facts, enforces one admission per Task Context Snapshot and action
request, and supports owner-scoped reads by admission id, snapshot id, Task,
and Run. It does not enable visible Agents UI, autonomous Agent execution,
provider/model dispatch, tool calls, command execution, source reads or writes,
generic Review row creation, Artifact creation, source materialization, check
runs, Project Revision creation, Git mutation, permission grants, IPC/preload
commands, installer evidence, or a real saved-profile DeepSeek canary pass.

- The store records only canonical supervised action admission receipts and
  indexed public identity needed for replay: admission id, action request id,
  snapshot id, context/definition digests, owner/project/task/run identity,
  requested next action, next gate, budget/snapshot/admission times, admission
  digest, and canonical admission JSON. It stores no prompt, raw transcript,
  current brief text, child output, patch, source tree, file content,
  provider/model envelope, credential, permission grant, tool call, tool result,
  generic Review row, Artifact payload, source materialization, check run
  output, Git mutation, Project Revision row, IPC/preload path, visible Agents
  UI authority, or next-action dispatch authority.
- The store records only
  `main_owned_agent_supervised_action_admission_store` authority. Its evidence
  reports fixed no-authority fields for renderer, IPC, provider/model dispatch,
  tool dispatch, permission grants, credential storage, source access/read/write,
  process run, network access, Revision, Review, Artifact, raw context storage,
  and next-action dispatch.
- Focused validation passed through
  `node --test tests\builder-agent-supervised-action-admission-store.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent admission validation passed through Assignment, Supervision
  Lease, Budget Audit, Agent Task Context Snapshot contract/store/service,
  Supervised Action Admission contract, and Supervised Action Admission store
  tests; the command reported 37 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 885 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 796 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 05:13:58 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Supervised Action Admission Service Package Check

This addendum records the package checkpoint after adding the pure main-side
Supervised Action Admission service. The service composes the store-backed Task
Context Snapshot store and Supervised Action Admission store: it reads a Task
Context Snapshot from storage, verifies Task and Run snapshot listings, creates
one supervised action admission receipt, records it in the admission store, and
verifies admission replay by admission id, snapshot id, Task, and Run. It does
not enable visible Agents UI, autonomous Agent execution, provider/model
dispatch, tool calls, command execution, source reads or writes, generic Review
row creation, Artifact creation, source materialization, check runs, Project
Revision creation, Git mutation, permission grants, IPC/preload commands,
installer evidence, or a real saved-profile DeepSeek canary pass.

- The service accepts only store-backed Task Context Snapshot identity and
  request metadata: owner id, snapshot id, action request id, requested next
  action, run status, interrupt/cancel flags, and admission time. It does not
  accept raw prompt, raw transcript, current brief text, child output, patch,
  source tree, file content, provider/model envelope, credential, permission
  grant, tool call, tool result, generic Review row, Artifact payload, source
  materialization, check run output, Git mutation, Project Revision row,
  IPC/preload path, visible Agents UI authority, or next-action dispatch
  authority.
- The service records only
  `main_owned_agent_supervised_action_admission_service` authority. Its evidence
  reports fixed no-authority fields for renderer, IPC, provider/model dispatch,
  tool dispatch, next-action dispatch, permission grants, credential storage,
  source access/read/write, process run, network access, Revision, Review,
  Artifact, and raw context storage.
- Focused validation passed through
  `node --test tests\builder-agent-supervised-action-admission-service.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent admission validation passed through Assignment, Supervision
  Lease, Budget Audit, Agent Task Context Snapshot contract/store/service,
  Supervised Action Admission contract/store/service tests; the command
  reported 42 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 890 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 797 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 05:22:13 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Project Work Result Admission Gate Package Check

This addendum records the package checkpoint after connecting the existing
Agent Project Work Result service to the store-backed Supervised Action
Admission chain. A Project Work Result now requires a persisted
`finish_for_review` supervised action admission before it can record a
reviewable project-edit or project-test result. The checkpoint does not enable
visible Agents UI, autonomous Agent execution, provider/model dispatch, tool
calls, command execution, source reads or writes, generic Review row creation,
Artifact creation, source materialization, check runs, Project Revision
creation, Git mutation, permission grants, IPC/preload commands, installer
evidence, or a real saved-profile DeepSeek canary pass.

- The result service now accepts a supervised action admission id, reads that
  admission from the main-owned admission store, verifies Task and Run admission
  listings, requires `requested_next_action=finish_for_review` and
  `next_gate=project_work_result_required_later`, and only then verifies the
  referenced allowed Budget Audit before recording or replaying the Project
  Work Result.
- The service evidence now includes
  `main_owned_agent_supervised_action_admission_store` and
  `main_agent_supervised_action_admission_contract_v1` authority while
  preserving fixed no-authority fields for renderer, IPC, provider/model
  dispatch, tool dispatch, permission grants, credential storage, source
  access/read/write, process run, Revision, generic Review row creation,
  Artifact creation, and materialization.
- Focused validation passed through
  `node --test tests\builder-agent-project-work-result-service.test.cjs`; the
  command reported 5 passing Node tests.
- Adjacent Agent chain validation passed through Assignment, Supervision Lease,
  Budget Audit, Agent Task Context Snapshot contract/store/service, Supervised
  Action Admission contract/store/service, and Project Work contract/store/
  service tests; the command reported 76 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 890 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. The first attempt hit a transient
  Windows `EBUSY` lock while writing
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`; an
  immediate retry succeeded. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 797 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 05:34:00 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Tool Call Record Service Package Check

This addendum records the package checkpoint after connecting the
`call_tool` supervised action admission to a main-only Agent Tool Call Record
service. The service creates only a deterministic pre-dispatch Tool Call Record
from a store-backed `call_tool` supervised action admission, a main-issued Tool
Session Policy, and an allowed Tool Permission Admission for the same Agent,
Project, Conversation, Task, and Run. The checkpoint does not enable visible
Agents UI, autonomous Agent execution, provider/model dispatch, tool dispatch,
tool execution, command execution, source reads or writes, generic Review row
creation, Artifact creation, source materialization, check runs, Project
Revision creation, Git mutation, permission grants, IPC/preload commands,
installer evidence, or a real saved-profile DeepSeek canary pass.

- The service accepts only owner id, supervised action admission id, Turn id,
  Step id, Tool Session Policy receipt, Tool Permission Admission receipt, and
  request time. It reads the admission from the main-owned admission store,
  verifies Task and Run admission listings, requires
  `requested_next_action=call_tool` and
  `next_gate=tool_call_record_required_later`, and then creates a Tool Call
  Record through the existing `main_tool_call_record_contract_v1` contract.
- The service evidence records
  `main_owned_agent_tool_call_record_service`,
  `main_owned_agent_supervised_action_admission_store`,
  `main_agent_supervised_action_admission_contract_v1`,
  `main_tool_call_record_contract_v1`,
  `main_tool_session_policy_contract_v1`, and
  `main_permission_decision_before_tool_dispatch_v1` authority while preserving
  fixed no-authority fields for renderer, IPC, provider/model dispatch, tool
  dispatch, execution, permission grants, credential storage, source
  access/read/write, process run, network access, Revision, Review, Artifact,
  and raw output storage.
- Focused validation passed through
  `node --test tests\builder-agent-tool-call-record-service.test.cjs`; the
  command reported 4 passing Node tests.
- Adjacent Agent/tool validation passed through Supervised Action Admission
  contract/store, Agent Task Context Snapshot contract, Tool Call Record
  contract, Tool Session Policy contract, Tool Permission Admission contract,
  and Agent Tool Call Record service tests; the command reported 38 passing
  Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 894 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 798 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 05:45:19 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Private Source Context Service Package Check

This addendum records the package checkpoint after connecting the
`read_private_source` supervised action admission to a main-only Agent Private
Source Context service. The service invokes only the existing main Source
Context Collector after verifying a store-backed `read_private_source`
admission and the supplied trusted Conversation work Run context. The returned
private source context remains a main-only, non-durable service result; the
public Conversation/Task Stream receives only the collector's sanitized tool
request and fixed result facts. The checkpoint does not enable visible Agents
UI, autonomous Agent step running, provider/model dispatch, arbitrary tool
dispatch, command execution, source writes, generic Review row creation,
Artifact creation, materialization, check runs, Project Revision creation, Git
mutation, permission grants, IPC/preload commands, installer evidence, or a
real saved-profile DeepSeek canary pass.

- The service accepts only owner id, supervised action admission id, trusted
  Conversation work Run context, and bounded project resource ids. It reads the
  admission from the main-owned admission store, verifies Task and Run
  admission listings, requires `requested_next_action=read_private_source` and
  `next_gate=source_context_collector_required_later`, cross-checks Project,
  Conversation, Task, and Run identity against the supplied work Run context,
  and then calls `main_tool_source_context_collector_v1`.
- The service evidence records
  `main_owned_agent_private_source_context_service`,
  `main_owned_agent_supervised_action_admission_store`,
  `main_agent_supervised_action_admission_contract_v1`, and
  `main_tool_source_context_collector_v1` authority while preserving fixed
  no-authority fields for renderer, IPC, provider/model dispatch, permission
  grants, credential storage, source writes, process run, network access,
  Revision, Review, Artifact, and durable raw context storage.
- Focused validation passed through
  `node --test tests\builder-agent-private-source-context-service.test.cjs`;
  the command reported 4 passing Node tests.
- Adjacent Agent/source validation passed through Supervised Action Admission
  contract/store, Tool Source Context Collector, Filesystem Read Execution
  service, Filesystem Read Output Record, Tool Call Record, Tool Session
  Policy, Tool Permission Admission, and Agent Private Source Context service
  tests; the command reported 47 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 898 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 799 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 05:57:47 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Step Start Service Package Check

This addendum records the package checkpoint after connecting the `start_step`
supervised action admission to a main-only Agent Step Start service. The
service creates only a deterministic step-start receipt after verifying a
store-backed `start_step` supervised action admission and the referenced
allowed Budget Audit. The checkpoint does not enable visible Agents UI,
autonomous Agent step execution, provider/model dispatch, arbitrary tool
dispatch, command execution, source reads or writes, generic Review row
creation, Artifact creation, materialization, check runs, Project Revision
creation, Git mutation, permission grants, IPC/preload commands, installer
evidence, or a real saved-profile DeepSeek canary pass.

- The service accepts only owner id, supervised action admission id, Run step
  id, step index, and started time. It reads the admission from the main-owned
  admission store, verifies Task and Run admission listings, requires
  `requested_next_action=start_step` and
  `next_gate=agent_step_runner_required_later`, reads the referenced Budget
  Audit from the main-owned budget audit store, verifies lease audit listings,
  and requires the step index to equal the budget audit's prior
  `step_count + 1`.
- The service evidence records `main_owned_agent_step_start_service`,
  `main_agent_step_start_receipt_contract_v1`,
  `main_owned_agent_supervised_action_admission_store`,
  `main_agent_supervised_action_admission_contract_v1`,
  `main_owned_agent_budget_audit_store`, and
  `main_agent_budget_audit_contract_v1` authority while preserving fixed
  no-authority fields for renderer, IPC, provider/model dispatch, tool
  dispatch, step execution, permission grants, credential storage, source
  access/read/write, process run, network access, Revision, Review, Artifact,
  and raw context storage.
- Focused validation passed through
  `node --test tests\builder-agent-step-start-service.test.cjs`; the command
  reported 4 passing Node tests.
- Adjacent Agent step/admission/budget validation passed through Budget Audit
  contract/store/service, Agent Task Context Snapshot contract/store/service,
  Supervised Action Admission contract/store/service, and Agent Step Start
  service tests; the command reported 48 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 902 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 800 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 06:06:46 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Step Start Receipt Contract Package Check

This addendum records the package checkpoint after extracting the Agent Step
Start receipt into a reusable deterministic main-only contract. The contract
binds a sanitized `start_step` supervised action admission, the referenced
allowed Budget Audit, Run step id, step index, and started time into a digest
receipt. The Step Start service now composes persisted admission and budget
facts with that contract instead of owning receipt construction internally. The
checkpoint does not enable visible Agents UI, autonomous Agent step execution,
provider/model dispatch, arbitrary tool dispatch, command execution, source
reads or writes, generic Review row creation, Artifact creation,
materialization, check runs, Project Revision creation, Git mutation,
permission grants, IPC/preload commands, installer evidence, or a real
saved-profile DeepSeek canary pass.

- The contract accepts only the supervised action admission, Budget Audit, Run
  step id, step index, and started time. It requires
  `requested_next_action=start_step`,
  `next_gate=agent_step_runner_required_later`, the Budget Audit's allowed
  start-step outcome, matching Agent/Project/Conversation/Task/Run identity,
  `step_index = prior step_count + 1`, and `started_at_ms` after admission. It
  also validates receipt identity field shapes before producing or accepting
  the canonical digest.
- The receipt authority records
  `main_agent_step_start_receipt_contract_v1`,
  `main_owned_agent_supervised_action_admission_store`, and
  `main_owned_agent_budget_audit_store` while preserving fixed no-authority
  fields for renderer, IPC, provider/model dispatch, tool dispatch, execution,
  permission grants, credential storage, source access/read/write, process run,
  network access, Revision, Review, Artifact, and raw context storage.
- Focused validation passed through
  `node --test tests\builder-agent-step-start-service.test.cjs`; the command
  reported 7 passing Node tests.
- Adjacent Agent step/admission/budget validation passed through Budget Audit
  contract/store/service, Agent Task Context Snapshot, Supervised Action
  Admission contract/store/service, and Agent Step Start service tests; the
  command reported 41 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 905 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 801 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 06:22:03 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Step Start Store Package Check

This addendum records the package checkpoint after adding a main-owned Agent
Step Start store for the digest-bound step-start receipts. The store persists
only already-created Step Start receipts as restart-replayable SQLite facts; it
does not start an Agent step, dispatch a provider/model/tool, run a command,
read or write source, create a Review row, create an Artifact, materialize a
candidate, mutate Git, create a Project Revision, grant permission, expose an
IPC/preload command, show visible Agents UI, produce installer evidence, or run
a real saved-profile DeepSeek canary.

- The store verifies the Step Start receipt contract before writing, enforces
  one receipt per Run step id and supervised action admission id, preserves the
  receipt digest as a unique fact, and exposes owner-scoped reads by step id and
  admission id plus Task and Run listings. All rows are checked back against the
  canonical receipt JSON, fixed schema fingerprint, and runtime SQLite
  pragmas.
- Store evidence records `main_owned_agent_step_start_store` and
  `main_agent_step_start_receipt_contract_v1` while preserving fixed
  no-authority fields for renderer, IPC, provider/model dispatch, tool
  dispatch, step execution, permission grants, credential storage, source
  access/read/write, process run, network access, Revision, Review, Artifact,
  and raw context storage.
- Focused validation passed through
  `node --test tests\builder-agent-step-start-store.test.cjs`; the command
  reported 5 passing Node tests.
- Adjacent Agent step/admission/budget validation passed through Step Start
  store/service, Budget Audit contract/store/service, and Supervised Action
  Admission contract/store/service tests; the command reported 41 passing Node
  tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 910 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 802 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 06:33:12 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Step Start Service Store-Replay Package Check

This addendum records the package checkpoint after connecting the Agent Step
Start service to the main-owned Step Start store. The service still verifies
the store-backed `start_step` supervised action admission and referenced
allowed Budget Audit before creating the receipt, but it now records that
receipt in SQLite and verifies replay by Run step id, supervised action
admission id, Task, and Run before returning. The checkpoint does not enable
visible Agents UI, autonomous Agent step execution, provider/model dispatch,
arbitrary tool dispatch, command execution, source reads or writes, generic
Review row creation, Artifact creation, materialization, check runs, Project
Revision creation, Git mutation, permission grants, IPC/preload commands,
installer evidence, or a real saved-profile DeepSeek canary pass.

- The service now requires `main_owned_agent_step_start_store` alongside the
  Budget Audit and Supervised Action Admission stores. Replay of the same
  receipt returns the Step Start store's idempotent replay operation instead of
  creating a duplicate start fact.
- Service evidence records `main_owned_agent_step_start_service`,
  `main_owned_agent_step_start_store`,
  `main_agent_step_start_receipt_contract_v1`,
  `main_owned_agent_supervised_action_admission_store`, and
  `main_owned_agent_budget_audit_store` while preserving fixed no-authority
  fields for renderer, IPC, provider/model dispatch, tool dispatch, step
  execution, permission grants, credential storage, source access/read/write,
  process run, network access, Revision, Review, Artifact, and raw context
  storage.
- Focused validation passed through
  `node --test tests\builder-agent-step-start-service.test.cjs`; the command
  reported 7 passing Node tests.
- Adjacent Agent step/admission/budget validation passed through Step Start
  service/store, Budget Audit store/service, and Supervised Action Admission
  store/service tests; the command reported 32 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 910 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 802 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 06:39:12 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Tool Call Record Store Package Check

This addendum records the package checkpoint after adding a main-owned Agent
Tool Call Record store. The store persists only already-created pre-dispatch
Tool Call Records as restart-replayable SQLite facts; it does not connect the
Tool Call Record service to durable storage yet, dispatch a provider/model/tool,
execute a tool, read or write source, store raw output, create a Review row,
create an Artifact, materialize a candidate, mutate Git, create a Project
Revision, grant permission, expose an IPC/preload command, show visible Agents
UI, produce installer evidence, or run a real saved-profile DeepSeek canary.

- The store verifies the existing Tool Call Record contract before writing,
  records the external owner and supervised action admission id beside the
  record, and adds a store-entry digest that binds those external facts to the
  Tool Call Record digest. It enforces one row per tool call id, supervised
  action admission id, record digest, and entry digest, preserves owner-scoped
  reads by tool call id and admission id, and lists records by Task or Run. All
  rows are checked back against canonical record JSON, fixed schema
  fingerprint, runtime SQLite pragmas, and row/entry consistency.
- Store evidence records `main_owned_agent_tool_call_record_store` and
  `main_tool_call_record_contract_v1` while preserving fixed no-authority
  fields for renderer, IPC, provider/model dispatch, tool dispatch, execution,
  permission grants, credential storage, source access/read/write, raw output
  storage, process run, network access, Revision, Review, and Artifact.
- Focused validation passed through
  `node --test tests\builder-agent-tool-call-record-store.test.cjs`; the
  command reported 5 passing Node tests.
- Adjacent Agent tool/admission/session validation passed through Tool Call
  Record store/service, Tool Call Record contract, Tool Session Policy, Tool
  Permission Admission, and Supervised Action Admission store/service tests; the
  command reported 38 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 915 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 803 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 06:55:07 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Tool Call Record Service Store-Replay Package Check

This addendum records the package checkpoint after connecting the Agent Tool
Call Record service to the main-owned Tool Call Record store. The service still
verifies the store-backed `call_tool` supervised action admission and creates
only a pre-dispatch Tool Call Record from a main-issued Tool Session Policy and
allowed Tool Permission Admission, but it now records that record in SQLite and
verifies replay by tool call id, supervised action admission id, Task, and Run
before returning. The checkpoint does not enable visible Agents UI, autonomous
Agent step execution, provider/model dispatch, arbitrary tool dispatch, command
execution, source reads or writes, raw-output durability, generic Review row
creation, Artifact creation, materialization, check runs, Project Revision
creation, Git mutation, permission grants, IPC/preload commands, installer
evidence, or a real saved-profile DeepSeek canary pass.

- The service now requires `main_owned_agent_tool_call_record_store` alongside
  the Supervised Action Admission store. Replay of the same pre-dispatch Tool
  Call Record returns the Tool Call Record store's idempotent replay operation
  instead of creating a duplicate record fact.
- Service evidence records `main_owned_agent_tool_call_record_service`,
  `main_owned_agent_tool_call_record_store`,
  `main_tool_call_record_contract_v1`,
  `main_owned_agent_supervised_action_admission_store`,
  `main_tool_session_policy_contract_v1`, and
  `main_permission_decision_before_tool_dispatch_v1` while preserving fixed
  no-authority fields for renderer, IPC, provider/model dispatch, tool
  dispatch, execution, permission grants, credential storage, source
  access/read/write, process run, network access, Revision, Review, Artifact,
  and raw output storage.
- Focused validation passed through
  `node --test tests\builder-agent-tool-call-record-service.test.cjs`; the
  command reported 5 passing Node tests.
- Adjacent Agent tool/admission/session validation passed through Tool Call
  Record service/store, Tool Call Record contract, Tool Session Policy, Tool
  Permission Admission, and Supervised Action Admission store/service tests; the
  command reported 39 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 916 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 803 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 07:04:26 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Private Source Context Record Package Check

This addendum records the package checkpoint after adding the main-only Agent
Private Source Context record contract. The contract creates a deterministic
digest-only receipt from one `read_private_source` supervised action admission
and one Source Context Collector result. It revalidates bounded private source
files through the source-tree sanitizer, but the record keeps only resource and
content digests, read statuses, tool-call ids, counts, byte totals, context/head
binding, lifecycle, authority, and the canonical record digest. This checkpoint
does not persist/replay those receipts through a store, connect the Private
Source Context service to durable storage, enable visible Agents UI,
dispatch providers/models/tools, execute commands, grant permissions, write
source, create Review or Artifact authority, mutate Git, create Project
Revisions, expose IPC/preload commands, produce installer evidence, or run a
real saved-profile DeepSeek canary pass.

- Record evidence uses
  `main_agent_private_source_context_record_contract_v1` and
  `digest_only_private_source_context_receipt`; it explicitly keeps renderer,
  IPC, provider/model dispatch, permission grants, credential storage, source
  write, raw source storage, process run, network access, Revision, Review, and
  Artifact authority absent.
- Focused validation passed through
  `node --test tests\builder-agent-private-source-context-record.test.cjs`; the
  command reported 5 passing Node tests.
- Adjacent Agent source/admission/plan validation passed through Agent Private
  Source Context record/service, Source Context Collector, Plan Proposal Record,
  and Supervised Action Admission tests; the command reported 23 passing Node
  tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 921 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 804 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 07:19:05 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Private Source Context Record Store Package Check

This addendum records the package checkpoint after adding the main-owned Agent
Private Source Context Record store. The store persists and replays only the
digest-only private source context receipt keyed by canonical record digest and
supervised action admission id, with owner-scoped reads by digest/admission and
Task/Run listings. This checkpoint does not connect the Private Source Context
service to the store, enable visible Agents UI, expose IPC/preload commands,
dispatch providers/models/tools, execute commands, grant permissions, read or
write source, store raw source paths or content, mutate Git, create Project
Revisions, create Review or Artifact authority, produce installer evidence, or
run a real saved-profile DeepSeek canary pass.

- Store evidence uses `main_owned_agent_private_source_context_record_store`,
  `main_agent_private_source_context_record_contract_v1`, and
  `digest_only_private_source_context_receipt`; it records source reading as
  `not_performed_by_store`, raw source storage as absent, and recovery as an
  idempotent replay operation. Renderer, IPC, provider/model dispatch, tool
  dispatch, execution, permission grants, credential storage, source writes,
  process run, network access, Revision, Review, and Artifact authority remain
  absent.
- Focused validation passed through
  `node --test tests\builder-agent-private-source-context-record-store.test.cjs`;
  the command reported 5 passing Node tests.
- Adjacent Agent source/admission/plan validation passed through Agent Private
  Source Context record store/contract/service, Source Context Collector, Plan
  Proposal Record, and Supervised Action Admission store/service tests; the
  command reported 33 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 926 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 805 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 07:30:21 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Private Source Context Service Store-Replay Package Check

This addendum records the package checkpoint after connecting the Agent Private
Source Context service to the main-owned Private Source Context Record store.
The service still accepts only a store-backed `read_private_source` supervised
action admission for a trusted Conversation work Run, collects bounded private
source context through the main-only Source Context Collector, and returns that
private source context only to the main caller. It now also creates the
digest-only Private Source Context record, records that receipt in SQLite, and
verifies read-by-digest, read-by-admission, Task listing, and Run listing before
returning. If the same admission already has a stored receipt, the service fails
closed before invoking the collector; restart recovery restores the digest
receipt, not raw source content. This checkpoint does not enable visible Agents
UI, expose IPC/preload commands, dispatch providers/models/tools, execute
commands, grant permissions, write source, store raw source paths or content,
mutate Git, create Project Revisions, create Review or Artifact authority,
produce installer evidence, or run a real saved-profile DeepSeek canary pass.

- Service evidence now records
  `main_owned_agent_private_source_context_record_store`,
  `main_agent_private_source_context_record_contract_v1`, and
  `digest_only_receipt_store` alongside the existing Source Context Collector
  and Supervised Action Admission authorities. It preserves fixed no-authority
  fields for renderer, IPC, provider/model dispatch, permission grants,
  credentials, source writes, process run, network access, Revision, Review,
  Artifact, and raw-context durability.
- Focused validation passed through
  `node --test tests\builder-agent-private-source-context-service.test.cjs`;
  the command reported 4 passing Node tests, including duplicate-admission
  rejection before a second collector invocation and restart readback of the
  stored digest receipt.
- Adjacent Agent source/admission/plan validation passed through Agent Private
  Source Context service, record contract/store, Source Context Collector, Plan
  Proposal Record, and Supervised Action Admission store/service tests; the
  command reported 33 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 926 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 805 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 07:43:39 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Step Result Receipt Contract Package Check

This addendum records the package checkpoint after adding the pure main-owned
Agent Step Result receipt contract. The contract consumes one verified Agent
Step Start receipt and records only a digest-bound fixed outcome summary for
that step: `succeeded`, `blocked`, `failed`, or `cancelled`. This checkpoint
does not add a Step Result store or service, visible Agents UI, IPC/preload
command, provider/model/tool dispatch, step runner, command execution,
permission grant, source read/write, raw output storage, Project Revision,
generic Review row, Artifact authority, installer evidence, or real
saved-profile DeepSeek canary pass.

- Contract evidence records `main_agent_step_result_receipt_contract_v1` and
  binds the Step Start receipt digest, supervised action admission id, Budget
  Audit id, Agent/Project/Conversation/Task/Run/step identity, fixed result
  summary, lifecycle, authority, and canonical receipt digest. Renderer, IPC,
  provider/model dispatch, tool dispatch, execution, permission grants,
  credentials, source access, process run, network access, Revision, Review,
  Artifact, raw-output storage, and raw-context storage remain absent.
- Focused validation passed through
  `node --test tests\builder-agent-step-result-contract.test.cjs`; the command
  reported 4 passing Node tests.
- Adjacent Agent step/admission/budget validation passed through Agent Step
  Result contract, Step Start service/store, Supervised Action Admission
  service/store, and Budget Audit service tests; the command reported 31
  passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 930 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 806 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 07:58:19 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Step Result Store Package Check

This addendum records the package checkpoint after adding the main-owned Agent
Step Result store. The store persists and replays only fixed-summary Step
Result receipts keyed by result digest, Step Start digest, supervised action
admission id, and Run step id, with owner-scoped reads and Task/Run listings.
This checkpoint does not add a Step Result service, step runner, visible Agents
UI, IPC/preload command, provider/model/tool dispatch, command execution,
permission grant, source read/write, raw output storage, Project Revision,
generic Review row, Artifact authority, installer evidence, or real
saved-profile DeepSeek canary pass.

- Store evidence records `main_owned_agent_step_result_store` and
  `main_agent_step_result_receipt_contract_v1`, verifies canonical receipt JSON,
  schema fingerprint, runtime pragmas, row/receipt consistency, owner scoping,
  read-by-result, read-by-Step-Start, read-by-admission, Task listing, Run
  listing, and idempotent replay. Renderer, IPC, provider/model dispatch, tool
  dispatch, execution, permission grants, credentials, source access, process
  run, network access, Revision, Review, Artifact, raw-output storage, and
  raw-context storage remain absent.
- Focused validation passed through
  `node --test tests\builder-agent-step-result-store.test.cjs`; the command
  reported 5 passing Node tests.
- Adjacent Agent step/admission/budget validation passed through Agent Step
  Result contract/store, Step Start service/store, Supervised Action Admission
  service/store, and Budget Audit service tests; the command reported 36
  passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 935 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 807 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 08:11:43 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Step Result Service Package Check

This addendum records the package checkpoint after adding the main-owned Agent
Step Result service. The service composes the recorded Step Start store and
Step Result store: it reads a Step Start receipt by owner and Run step id,
requires the caller's expected Step Start digest to match, verifies Step Start
admission/Task/Run listings, creates the fixed-summary Step Result receipt,
stores or replays it, and cross-checks result reads by result digest, Step Start
digest, admission id, Task, and Run. This checkpoint does not add a step runner,
visible Agents UI, IPC/preload command, provider/model/tool dispatch, command
execution, permission grant, source read/write, raw output storage, Project
Revision, generic Review row, Artifact authority, installer evidence, or real
saved-profile DeepSeek canary pass.

- Service evidence records `main_owned_agent_step_result_service`,
  `main_owned_agent_step_result_store`,
  `main_agent_step_result_receipt_contract_v1`,
  `main_owned_agent_step_start_store`, and
  `main_agent_step_start_receipt_contract_v1`. Renderer, IPC, provider/model
  dispatch, tool dispatch, execution, permission grants, credentials, source
  access, process run, network access, Revision, Review, Artifact, raw-output
  storage, and raw-context storage remain absent.
- Focused validation passed through
  `node --test tests\builder-agent-step-result-service.test.cjs`; the command
  reported 5 passing Node tests.
- Adjacent Agent step/admission/budget validation passed through Agent Step
  Result contract/service/store, Step Start service/store, Supervised Action
  Admission service/store, and Budget Audit service tests; the command reported
  41 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 940 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 808 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 08:24:46 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Step Progress Projection Package Check

This addendum records the package checkpoint after adding the pure renderer-safe
Agent Step Progress projection. The projection consumes already-recorded Step
Start store and Step Result store list results, verifies the Step Start/Result
receipt contracts and bindings, rejects orphan or duplicate results, and exposes
only a bounded public progress window with step id, step index, recorded state,
and fixed summaries. This checkpoint does not admit Agent step progress into
Conversation replay or the visible Task Stream, add a step runner, visible
Agents UI, IPC/preload command, provider/model/tool dispatch, command execution,
permission grant, source read/write, raw output storage, Project Revision,
generic Review row, Artifact authority, installer evidence, or real
saved-profile DeepSeek canary pass.

- Projection authority records
  `main_owned_step_start_and_result_store_projection` and marks Step Start and
  Step Result receipts as verified but not exposed. Renderer, IPC,
  provider/model dispatch, tool dispatch, execution, permission grants,
  credentials, source access, process run, network access, Revision, Review,
  Artifact, raw-output storage, and raw-context storage remain absent.
- Focused validation passed through
  `node --test tests\builder-agent-step-progress-projection.test.cjs`; the
  command reported 7 passing Node tests.
- Adjacent Agent progress validation passed through Agent Step Progress
  projection, Agent Step Result contract/service/store, Agent Step Start
  service/store, and existing Task Stream projection tests; the command reported
  50 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 947 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 809 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 08:34:45 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## 2026-08-04 Agent Step Progress Read Service Package Check

This addendum records the package checkpoint after adding the main-only Agent
Step Progress read service. The read service composes the Step Start store,
Step Result store, and pure Agent Step Progress projection for one
owner/Project/Task/Run read. It returns only the bounded public progress
projection plus fixed read statuses/counts and
`main_owned_agent_step_progress_read_service` evidence. This checkpoint does
not admit Agent step progress into Conversation replay or the visible Task
Stream, add an IPC/preload command, start or run Agent steps, dispatch a
provider/model/tool, read or write source, run a process, grant permission,
store raw output/context, create a Project Revision, generic Review row, or
Artifact, add visible Agents UI, or prove a real saved-profile DeepSeek canary
pass.

- Read-service authority records
  `main_owned_agent_step_progress_read_service`, composes
  `main_owned_agent_step_start_store`, `main_owned_agent_step_result_store`,
  and `main_owned_step_start_and_result_store_projection`, and marks Step Start
  and Step Result receipts as verified but not exposed. Renderer, IPC,
  provider/model dispatch, tool dispatch, execution, permission grants,
  credentials, source access, process run, network access, Revision, Review,
  Artifact, raw-output storage, and raw-context storage remain absent.
- Focused validation passed through
  `node --test tests\builder-agent-step-progress-read-service.test.cjs`; the
  command reported 6 passing Node tests.
- Adjacent Agent progress validation passed through Agent Step Progress read
  service/projection, Agent Step Result contract/service/store, and Agent Step
  Start service/store; the command reported 39 passing Node tests.
- Repository validation passed through `npm.cmd run lint`,
  `npm.cmd exec tsc -b --pretty false`, and `npm.cmd run test:boundaries`. The
  full Node boundary suite reported 953 passing tests.
- Production package refresh passed through `npm.cmd run pack`, including the
  production Vite build and `verify:package`. Package verification reported
  `builder_package_verified`, production network-denying CSP, app id
  `com.clawfabric.builder`, product name `ClawFabric Builder`, and 810 ASAR
  entries. The refreshed executable timestamp was 2026-08-04 08:46:06 local
  time.
- Packaged launch smoke passed through `npm.cmd run verify:packaged-launch`.
  It reported `builder-preload.v20`, isolated user-data launch, executable path
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`,
  and `provider_configured: false` for the isolated smoke profile.
- A real saved-profile DeepSeek V4 packaged canary was not run for this
  checkpoint. Running it requires an explicit user-authorized provider call
  because it uses the locally saved DeepSeek profile and may consume provider
  quota.

## Evidence Inheritance Rule

Later changes to generation, provider storage, project persistence, preview,
Electron shell, packaging, installer configuration, or canary logic must rerun
the affected evidence. Documentation alone does not extend this checkpoint.
