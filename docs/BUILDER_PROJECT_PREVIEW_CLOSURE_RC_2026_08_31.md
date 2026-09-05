# Project Preview Closure RC - 2026-08-31

## Scope

Make the project preview usable after generation, Save, a new task, and a
source update. A browser placeholder or a model claim of successful inspection
does not count as a rendered page. Agent Test remains temporary; the user's
project preview has its own lifecycle and explicit Run/Reload/Stop controls.

The user authorized real desktop RC and sending copies of saved test projects
and conversation history to the configured DeepSeek provider. Runs clone the
profile into guarded temporary directories, drive only the test application's
UI, and clean up those copies. No global mouse/keyboard takeover is used.

## Fixes

1. End the automatic Agent Test tab when its run ends, handing the active
   temporary tab to project Preview when available. Respect a user-selected or
   closed tab; do not implicitly launch a server or retain an Agent Test session.
2. Show live startup, failure and approval state in the artifact panel instead
   of leaving it on the static-only view. Keep failure status available on reads.
3. Reload resolves a fresh Main-admitted source. Changed content replaces the
   immutable snapshot server; unchanged content reloads the existing URL.
4. Saved/rejected drafts omit the review projection in the real task stream.
   Accept that normal shape and read the verified current saved revision.
   Do not fall back to an older revision when an unreviewed candidate loses its
   review projection or when draft verification fails.
5. Serialize lifecycle operations; reject stale renderer responses and hide a
   native view when its task is no longer the visible owner.
6. Full approved Agent plans could exceed the old 8,192-character runtime input
   limit before Harness admission. Bound the Main-composed request at 144 Ki
   characters / 576 KiB, and the host transport at 640 KiB. The public user-input
   limit is unchanged. Tests preserve long multilingual plan text exactly.
7. Replace the long blocked-request status in the preview toolbar with a fixed
   shield icon carrying its full accessible label and tooltip. Preserve space
   for the address and existing controls.
8. The packaged entry helper now clicks the proposal's actual New project
   button and observes automatic task startup, without submitting the same
   instruction a second time.

## Authority Boundaries

- Main owns source selection, Git/SQLite verification, local server admission,
  native view attachment, and cleanup. No renderer path/source shortcut exists.
- A changed development-server source needs a fresh one-time approval. Reload,
  Save and preview readiness do not authorize dependency installation.
- Prepared repository dependencies were detected and reused. No dependency
  installation was requested for the generated test project; it has none.
- Generated content uses a separate WebContents with no preload or Node access.

## Real Acceptance Procedure

`scripts/verify-deepseek-packaged-preview-closure.cjs` wraps the existing real
Agent-history canary. Each round:

1. Continues one existing copied task and verifies a grounded response.
2. Streams a full Agent plan, approves it, clicks New project, and verifies one
   dispatched task. DeepSeek generates HTML, a dependency-free check and package
   manifest; Builder runs the check.
3. Clicks Run and sends real mouse input to the generated Start button. Verifies
   idle-to-running state, nonblank and changing canvas pixels, correct native
   bounds, and no horizontal overflow at narrow/wide preview widths.
4. Clicks Save version, reloads the saved source and repeats interaction checks.
5. Starts a second task in that project. Verifies the original snapshot, then
   edits only the subtitle, reloads, and verifies the new content and a new URL.
6. Clicks Save version again, reloads and interacts with Version 2, then clicks
   Stop and verifies no remaining local preview WebContents.

The script waits for Reload to become enabled, not only the old `ready` label.
Native-page screenshots are separate from window screenshots. The latter use
the exact owner window's media-source ID, so the child WebContentsView is visible
and no other application's screenshot is retained.

## Results

Evidence root: `release/preview-closure-20260831/`.

- Rounds 1-2 exposed the long-plan runtime contract limit before any tool use.
- Round 3 generated and rendered the actual page but exposed Save's omitted
  review projection at the saved-source reload.
- Round 4 verified that source fix, then exposed a canary race: it read the old
  `running` state before Reload finished. The canary now awaits idle controls.
- Round 5 passed all seven page observations and both Saves in 82.113 seconds.
  It precedes the final compact-toolbar change.
- Final same-package rounds 6, 7 and 8 passed consecutively in 118.936, 96.035
  and 98.628 seconds. Their full approved plans were 8,308, 9,003 and 10,533
  characters respectively, all beyond the old runtime input limit.
- Each final round has seven verified native-page observations, including
  319px and 366px content widths, animation pixel changes, actual mouse input,
  Version 1/2 Saves and final Stop cleanup. This is 21 page observations and
  six UI Saves across the same RC.
- Packaged Agent Test cancellation passed: an actually opened browser was
  cancelled via UI, the composer recovered, its WebContents was released,
  and restart showed neither a leftover Test surface nor a loopback page.
- Packaged local-provider preview canary passed: JavaScript and WebGL pixels,
  reload with stable origin for unchanged content, external fetch/navigation/
  window-open blocking, native bounds at 319/366px and expanded 1,242px,
  stop disposal and restart without loopback WebContents. Its old visible-text
  check was updated to require the safety icon's matching accessible label,
  tooltip and nonzero blocked-request count. Its three unit tests also passed.

Final package: `release/win-unpacked/ClawFabric Builder.exe`.
ASAR SHA-256:
`ca4ce12d2d145da0a8b5ab9aaba261964bba635579d14769e02a2d664e42867b`.

Focused verification so far:

- Preview source/Main lifecycle and packaged entry helper: 118 tests passed.
- Source resolver/admission, IPC, dev/static servers and evidence validator:
  34 tests passed.
- Runtime contract/programming runtime: 24 tests passed; process host: 8 passed.
- Architecture and Electron security boundary: 9 tests passed.
- BuilderApp, BuilderPage and BuilderResultPanel: 287 tests passed. The final
  toolbar rerun with desktop layout tests passed 168 (overlapping) tests.
- TypeScript, Vite build, Windows packaging, package authority verification,
  focused preview lint and `git diff --check` passed.
- Four changed Main modules and both final renderer assets were compared
  byte-for-byte with the ASAR and match the workspace sources.

## Limits

This is focused preview acceptance, not the full repository release gate.
Existing unrelated BuilderApp ref/effect lint issues remain documented in the
preceding performance RC. Real rounds exercise dependency-free static pages;
development-server approval and detect-before-install behavior have focused
boundary tests, not a real dependency-install run in this slice.

## Entry Points

- Desktop RC: `release/win-unpacked/ClawFabric Builder.exe`.
- Visual evidence: `release/preview-closure-20260831/round-8/saved-second-desktop.png`.
- Reproduce one authorized real round:
  `node scripts/verify-deepseek-packaged-preview-closure.cjs <new-output-directory>`.
- Reproduce local isolation checks:
  `node scripts/verify-packaged-agent-browser-cancellation-canary.cjs` and
  `node scripts/verify-packaged-live-preview-canary.cjs`.

Real test windows were closed and temporary profile copies cleaned up after
acceptance. Saved user projects were not replaced or discarded. No Git commit
or push was performed in this slice.
