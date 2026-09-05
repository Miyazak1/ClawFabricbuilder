# Builder Programming Loop Handoff - 2026-09-05

## Current Repository State

- Latest pushed baseline before this handoff: `22a6554 Advance Builder programming loop`.
- Main branch remote: `https://github.com/Miyazak1/ClawFabricbuilder`, branch `main`.
- Local release folders such as `release-a0/`, `release-a03/`, and `release-plan-*` are intentionally untracked packaging artifacts and should not be committed unless a release artifact policy is added.
- Latest packaged executable produced locally:
  `D:\CODE\clawfabric-builder\release\win-unpacked\ClawFabric Builder.exe`.

## Product Direction

The Builder target is a real programming loop, not a demo artifact generator.

Core product behavior:

- Plan and implementation are task-addressed.
- The provider or Harness may produce candidate source trees.
- Builder Main owns filesystem admission, dependency readiness, checks, save authority, current-project projection, preview/runtime launch, and receipts.
- A candidate is not "done" until the authoritative check path proves it can run or the UI clearly presents it as a recoverable draft needing repair.
- No compatibility shim should hide failed generation. Prefer clean state and authority boundaries over permissive fallback behavior.

## Recent User-Facing Failure

The latest real user project inspected was `D:\CODE\test\test22`.

Observed facts:

- `package.json` declared a Next 14 project with `scripts.dev = "next dev"` and `scripts.build = "next build"`.
- No root dependency markers existed: no `node_modules`, no lockfile.
- `npm --prefix D:\CODE\test\test22 run build` failed with:
  `'next' is not recognized as an internal or external command, operable program or batch file.`
- The App Router entry files were missing:
  - `app/page.tsx`
  - `app/posts/page.tsx`
  - `app/posts/[slug]/page.tsx`
- `components/Navbar.tsx` was a client component and directly imported `getAllTags` from `lib/posts.ts`.
- `lib/posts.ts` imports Node `fs`, so that client/server boundary would fail after dependencies are installed.

Conclusion:

The issue was not only that Run or Preview failed. Builder had allowed an unfinished or unchecked candidate to be written into the real project folder, so the user saw a project that looked completed but could not run.

## Latest Fix

The newest fix changes Builder's project-folder projection rule for Harness candidates:

- Recoverable or interrupted Harness candidates are preserved as Builder drafts and checkpoints.
- Harness candidates whose automatic check status is `failed` or `incomplete` are not materialized into the real project folder.
- The conversation status now carries `current_materialization.status = "not_attempted"` with reason `automatic_check_not_passed`.
- The task stream projection surfaces this as "Project folder not updated" rather than generic workspace sync text.
- Existing save authority recognizes the new materialization reason without granting save by itself; check-run save gates remain authoritative.

Important files:

- `electron/builder-generation-main-service.cjs`
- `electron/builder-conversation-records.cjs`
- `electron/builder-conversation-main-service.cjs`
- `electron/builder-project-save-authority.cjs`
- `electron/builder-task-stream-projection.cjs`
- `tests/builder-generation-main-service.test.cjs`
- `tests/builder-task-stream-projection.test.cjs`

## Verification Already Run

Focused verification:

- `node --test --test-name-pattern "automatic-check-blocked|closes Harness candidate checks|preserves interrupted Harness edits" tests\builder-task-stream-projection.test.cjs tests\builder-generation-main-service.test.cjs`
- `node --test --test-name-pattern "save gate|conflict|current_materialization|materialized" tests\builder-project-save-authority.test.cjs`
- `npm exec tsc -b --pretty false`
- `npm run lint`
- `npm run dist`

Package verification:

- `npm run dist` completed.
- `scripts/verify-package.cjs` passed with `builder_package_verified`.

Known caveat:

- A full `node --test tests\builder-generation-main-service.test.cjs` run in the read-only sandbox hit Windows temp `EPERM` on tests that create temp directories. Focused tests for this change passed.

## Previously Completed Capabilities Included In Latest Push

The large `22a6554` commit also contains prior staged work across these areas:

- DeepSeek Harness programming runtime integration and event parity.
- Task address/session alignment and native task resume infrastructure.
- Context compaction admission and execution bridge.
- Main-owned context usage projection.
- Dependency readiness and project dependency preparation.
- Live Preview support for dev-server projects through `package.json` `scripts.dev`.
- Saved revision file viewer support in the side workspace.
- Browser/Preview boundary hardening: Preview can request dev-server launch approval, but cannot install dependencies or weaken sandbox policy.
- Packaged canaries for Harness, task resume, dependency preparation, preview closure, and live preview dev-server flows.

## Next Stage Goal

Run a real packaged E2E against the latest desktop executable using the user's DeepSeek key:

1. Create a fresh local project.
2. Ask DeepSeek Harness to build a small Next project.
3. Require Builder to detect dependency readiness before install.
4. Use `Prepare once` only after explicit approval.
5. Require automatic check to pass before materializing into the project folder.
6. Press Run and verify the built-in browser opens the dev server.
7. Confirm Files loads from the correct current source, not a stale draft.

Pass criteria:

- The user can watch the desktop app produce a project, prepare dependencies, run checks, and open the built-in preview.
- No failed or incomplete candidate is written into the real project folder.
- Any generation failure is shown as a recoverable draft with a clear next action.

## Suggested Immediate Work

Start with a focused packaged canary that proves the new `automatic_check_not_passed` materialization gate in the real desktop runtime:

- Fake provider returns a Next project missing `app/page.tsx` or with a deliberate check failure.
- Automatic check reports `failed` or `incomplete`.
- Canary asserts project folder files remain unchanged.
- Canary asserts conversation/task stream shows `automatic_check_not_passed`.
- Canary then follows up with a repair candidate that passes.
- Only the passing candidate is projected and runnable.

After that, repeat the same flow with real DeepSeek Harness.
