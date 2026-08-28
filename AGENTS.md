# ClawFabric Builder Agent Guide

This repository is the standalone ClawFabric Builder desktop app. Keep changes
small, evidence-backed, and aligned with the existing Main-owned authority
model.

## Dependency And Toolchain Readiness

Agents and contributors must detect existing tools and dependencies before
requesting or running any dependency installation.

Required order:

1. Detect the host toolchain state through Builder Main-owned readiness or
   diagnosis facts when working on Builder runtime behavior.
2. Detect the project package manager from existing manifests and lockfiles.
3. Detect whether the project root already has dependency markers such as
   `node_modules`.
4. Detect whether the isolated current-draft check workspace has prepared
   dependencies.
5. Request installation only when readiness proves it is needed and the user
   explicitly approves the scoped action.

Allowed first-phase installation path:

- `Prepare once` may install dependencies only for the current draft's isolated
  check workspace.
- `Prepare once` must rerun readiness and the selected check after preparation.
- Existing prepared dependencies must not be reinstalled blindly.

Forbidden shortcuts:

- Do not run `npm install`, `pnpm install`, `yarn install`, or `bun install`
  before checking whether dependencies are already present.
- Do not install into the project root from Settings.
- Do not treat command approval, sandbox selection, network permission, Save,
  Browser/Preview approval, or dev-server approval as dependency-install
  approval.
- Do not let DeepSeek Harness infer broader host access from dependency
  readiness. Harness consumes redacted readiness facts; Builder Main owns
  probing, preparation admission, receipts, and projection.

## Browser And Preview Boundary

Browser/Preview may show readiness as context, such as explaining that a preview
cannot start because dependencies are not prepared. Browser/Preview must not
start dependency installation, grant command execution, weaken command sandbox
policy, or convert dev-server approval into dependency-install approval.

## Verification Expectations

Use the existing focused verification scripts whenever a change touches Builder
runtime behavior:

- `npm exec tsc -b --pretty false`
- `npm exec vitest run <focused test file>`
- `node --test <focused test file>`
- packaged canaries when behavior depends on the packaged desktop runtime

For dependency readiness changes, include tests or canaries that prove:

- detect-before-install is preserved;
- dependency preparation is explicit and one-shot;
- project-root dependencies are not written by current-draft check preparation;
- composer/live output recovers after incomplete, failed, and prepared checks;
- Browser/Preview remains independent from command sandbox and dependency
  preparation authority.
