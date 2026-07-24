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

## Evidence Inheritance Rule

Later changes to generation, provider storage, project persistence, preview,
Electron shell, packaging, installer configuration, or canary logic must rerun
the affected evidence. Documentation alone does not extend this checkpoint.
