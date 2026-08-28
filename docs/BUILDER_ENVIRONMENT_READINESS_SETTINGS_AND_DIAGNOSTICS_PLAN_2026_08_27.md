# Builder Environment Readiness Settings And Diagnostics Plan - 2026-08-27

Date: 2026-08-27

Status: A1.3 productization plan and implementation guardrail. A1.3.8 keeps the
detect-before-install rule intact and lets Settings trigger the same one-shot
current-draft check dependency preparation path after diagnosis reports
`prepare_once`. Builder can diagnose selected-project manifest, lockfile,
package-manager, project dependency marker, and redacted local
`node`/`npm`/`pnpm`/`yarn`/`git` toolchain facts without installing, running a
check, saving, dispatching the provider, or granting Browser/Preview or Harness
authority. Dependency preparation still requires explicit user confirmation and
still installs only in the isolated check workspace. Broader policy settings
and reusable dependency caches are future work. This document turns the
readiness work from an internal check contract into a product diagnostic model.
It does not authorize broad host access, project-root dependency installation,
Browser command execution, or Workbench migration.

Related documents:

- [Builder Runtime Readiness And Agent Environment Research](BUILDER_RUNTIME_READINESS_AGENT_ENVIRONMENT_RESEARCH_2026_08_26.md)
- [Builder Sandbox Settings And Runtime Policy Plan](BUILDER_SANDBOX_SETTINGS_AND_RUNTIME_POLICY_PLAN_2026_08_26.md)
- [Builder Worktree And Workspace Lifecycle Policy](BUILDER_WORKTREE_AND_WORKSPACE_LIFECYCLE_POLICY_2026_08_26.md)
- [Controlled Bash V1 Architecture](CONTROLLED_BASH_V1_ARCHITECTURE.md)
- [General Browser Web Mode Architecture](GENERAL_BROWSER_WEB_MODE_ARCHITECTURE.md)

## Product Decision

Builder should behave like mature coding agents in one important way: detect
the local and project environment first, then ask for a narrowly scoped action
only when readiness facts show that action is needed.

The approved first-stage rule is:

```text
detect host toolchain and project/check workspace readiness
-> run the check when readiness is sufficient
-> show Prepare once only when the isolated check workspace is missing dependencies
-> install only after explicit one-shot user approval
-> install only in the isolated check workspace
-> rerun readiness and the selected check
```

`Prepare once` is not a general package-management command. It is not a Save
action, not project-root setup, not a persistent policy change, and not an
agent-visible authority grant.

## External Product Lessons

The useful pattern across current coding agents is separation of setup,
permission, sandbox, and execution:

- Codex-style local agents rely on local toolchains but expose command and
  network permissions separately.
- Claude Code separates tool permission modes from sandboxing and supports
  planning without execution.
- Cursor separates run modes, approvals, sandboxing, and command/network
  policy.
- GitHub Copilot coding agent uses explicit environment setup steps and
  recommends network allowlists for package registries in managed
  environments.
- Devin treats dependency installation as environment setup and reuses prepared
  environment state instead of blindly reinstalling on each task.
- Windsurf and Claude-style rule files show that project package-manager and
  verification conventions belong in durable project guidance, not only in
  model memory.

The Builder conclusion is conservative: productize diagnostics and setup
receipts, but keep Builder Main as the authority layer.

## Current Code Facts

The repository already has the core first-stage mechanism:

- `electron/builder-runtime-toolchain-probe.cjs` performs a bounded,
  Main-owned version probe for the selected package manager family. It records
  enum states and bounded version strings, not raw paths, environment
  variables, stdout, stderr, or shell configuration.
- `electron/builder-runtime-readiness-snapshot.cjs` creates a digest-bound
  readiness snapshot that distinguishes project-root dependency markers from
  candidate check workspace dependency markers.
- `electron/builder-check-run-main-service.cjs` reads readiness before command
  execution. It blocks environment-unavailable checks, records a terminal
  incomplete check, and only calls dependency preparation when the readiness
  strategy is `needs_prepared_dependency_workspace` and the user decision is
  `allow_once`.
- `electron/builder-check-dependency-preparer.cjs` runs the npm install path in
  the isolated check workspace, with project-root writes disabled by contract.
- Renderer tests and packaged canaries already cover visible `Prepare once`,
  preparing, success, failure, retry, Save gating, and no project-root
  `node_modules`.

The missing A1.3 product layer is not a new installer. It is a visible,
read-only diagnosis and settings model that explains why Builder is ready,
blocked, or asking for a one-shot preparation.

## User-Facing States

First-stage UI should expose only actionable states:

| State | Meaning | Primary action |
| --- | --- | --- |
| Ready | Required host toolchain and check workspace state are sufficient | Run or continue check |
| Host toolchain missing | Builder Main cannot see the required local command | Show missing tool and diagnostic entry |
| Dependencies not prepared | The draft declares dependencies but the isolated check workspace lacks them | Show `Prepare once` |
| Install approval required | Preparation is needed and no one-shot approval exists | Ask once, then install in check workspace |
| Install denied | The user declined preparation for this check | Keep draft recoverable, Save disabled |
| Install failed | The package manager ran but preparation failed or timed out | Keep retryable card and digest-only evidence |
| Unknown | Readiness facts are unavailable or inconsistent | Stop safely with diagnostic entry |

Do not show generic "draft failed to generate" when a recoverable draft and
environment-blocked check are already present.

## Settings Model

A1.3 should add or reserve a settings section for environment readiness without
pretending that the backend can enforce more than it currently does.

MVP controls:

- approval policy display for command/check actions;
- current project environment diagnosis;
- Builder runtime and Harness runtime status;
- selected project package manager and check command profile;
- host toolchain visibility for `node`, `npm`, `pnpm`, `yarn`, `git` as
  redacted enum/version facts where supported;
- isolated check workspace dependency status for the current draft/check;
- reset/retry current check dependency preparation, scoped to the isolated
  check workspace.

Future controls:

- package managers beyond the current npm preparation path;
- dependency cache keyed by OS, package manager, lockfile digest, and toolchain
  version;
- lifecycle hook policy;
- network/package registry allowlist;
- project-root setup assistant with explicit approval and receipt;
- multi-language toolchains such as Python, Rust, Go, Java, and .NET;
- managed policy overlay that local config cannot weaken.

## Browser And Preview Boundary

Browser/Preview settings must stay independent from command and dependency
settings.

Browser/Preview may show readiness as context, for example "preview cannot
start because the dependency workspace is not prepared." It must not:

- start package installation;
- grant command sandbox authority;
- reuse command sandbox providers;
- expose Electron partitions, cookies, downloads, credentials, or WebContents
  handles through readiness facts;
- turn preview server approval into dependency-install approval.

Project Preview remains loopback/source-bound. User Web and Agent Test browser
classes need separate policy and diagnostics.

## Implementation Slices

### A1.3.1: Detect-Before-Install Guardrails

- document detect-before-install as the only allowed dependency preparation
  order;
- add tests proving `allow_once` does not call the installer when readiness is
  already satisfied;
- keep `Prepare once` available only for dependency readiness reasons;
- preserve no project-root install and no Harness install authority.

### A1.3.2: Read-Only Project Diagnosis

Implementation status:

- `electron/builder-environment-readiness-diagnosis.cjs` projects a verified
  check-run admission plus runtime readiness snapshot into a redacted diagnosis
  result.
- `electron/builder-check-run-main-service.cjs` exposes
  `diagnose_check_environment`, which materializes a temporary check workspace
  only to read readiness facts, then cleans it up.
- `electron/builder-check-run-current-draft-service.cjs` exposes
  `diagnose_check_environment` for the selected current draft and command
  profile after re-reading conversation, Git, and checkpoint authority.
- The backend diagnosis path does not call dependency preparation, check
  runner, check-run store, status projection, activity notification, Save, IPC,
  provider dispatch, or Browser/Preview authority.

Remaining:

- expand settings-level host tool diagnosis beyond the selected check's
  package-manager family, including `git`;
- add a compact settings/project diagnostics surface;
- decide whether diagnosis should reuse a future prepared dependency cache
  receipt instead of materializing a fresh temporary check workspace.

Backend acceptance now requires the diagnosis result to include package
manager, lockfile, manifest dependency presence, project-root install marker,
host toolchain visibility, and current check workspace state without running
package installation.

### A1.3.3: IPC And Renderer Port

Implementation status:

- `electron/builder-check-run-approval-ipc-adapter.cjs` exposes a dedicated
  `diagnose-current-draft-check-environment` channel that accepts only the
  active main-frame `draft_id` and `command_profile_id`.
- `electron/builder-check-run-approval-ipc-runtime.cjs` registers, coalesces,
  drains, and rolls back the diagnosis channel alongside check-run channels.
- `electron/preload.cjs` exposes the diagnosis method inside the existing
  check-run bridge namespace.
- `src/features/builder/infrastructure/builderDesktopCheckRunPort.ts`
  sanitizes the diagnosis result for renderer consumers, strips the internal
  authority block, and rejects command, install, Browser/Preview, raw output,
  source tree, path, env, secret, network, or write authority drift.

Remaining:

- call this port from a compact settings/project diagnostic surface;
- decide whether failed check cards should link to this diagnosis result or
  keep using only stored check outcome projection;
- keep Browser/Preview as read-only consumers of readiness context.

### A1.3.4: Current Draft Diagnosis UI

Implementation status:

- `src/app/BuilderApp.tsx` keeps a transient current-draft check environment
  diagnosis state and calls `diagnoseCurrentDraftCheckEnvironment` only for the
  selected `draft_id` and `command_profile_id`.
- `src/features/builder/presentation/BuilderPage.tsx` adds a `Diagnose`
  action to the existing dependency preparation card and displays only
  renderer-safe facts: safe summary, host toolchain state, check workspace
  dependency state, and package manager.
- The UI does not install dependencies, run checks, write source, save drafts,
  or grant Browser/Preview authority. Installation remains behind the existing
  explicit `Prepare once` path.
- Tests cover the Page-level diagnosis display and the App-level bridge call,
  including that clicking `Diagnose` does not call dependency preparation.

Remaining:

- add a project diagnostics entry that can run before there is a dependency
  preparation card;
- decide whether failed check cards should link to diagnosis history or request
  a fresh read-only diagnosis.

### A1.3.5: Settings Surface MVP

Implementation status:

- `src/app/BuilderApp.tsx` renders an Environment/Dependencies settings card
  above AI provider settings.
- The settings card uses the current draft's selected check profile and calls
  the same read-only `diagnoseCurrentDraftCheckEnvironment` flow as the
  dependency preparation card.
- The settings card displays renderer-safe facts for readiness summary, host
  toolchain state, package manager, lockfile, dependency manifest, project
  dependency state, and isolated check workspace dependency state.
- The settings card does not install dependencies, run checks, write source,
  save drafts, or grant Browser/Preview authority. Installation remains behind
  `Prepare once`.
- Tests cover a dependency-blocked current draft opened from Settings and prove
  that `Diagnose` does not call dependency preparation.

Remaining:

- add explicit project-level dependency setup only behind user approval and a
  receipt contract;
- add explicit settings for approval policy, sandbox mode, network access, and
  dependency-install policy only after backend enforcement exists;
- add reusable dependency cache receipts, if accepted.

### A1.3.6: No Draft And Project-Level Diagnosis Boundary

Implementation status:

- The Settings Environment/Dependencies card now distinguishes these cases:
  no current draft, current draft check discovery loading, current draft check
  discovery failed, current draft with no approved check command, and current
  draft diagnosis ready.
- Disabled Settings diagnosis states are inert. Tests prove they do not call
  current-draft diagnosis, dependency preparation, check execution, Save, or
  Browser/Preview authority.
- A1.3.6 deliberately did not reuse the current-draft check diagnosis as a
  fake project diagnosis when no current draft/check profile existed.

Current boundary:

- Current-draft diagnosis requires a verified `draft_id` plus
  `command_profile_id`.
- It may materialize a temporary check workspace only to read readiness facts.
- It must not install dependencies, run the check, write source files, save a
  draft, dispatch the provider, or grant Browser/Preview authority.

The separate project-level backend contract is implemented in A1.3.7. A1.3.6
remains the boundary record for the current-draft-only Settings behavior.

Remaining:

- add installation or reset actions only after an explicit approval and receipt
  contract exists.

### A1.3.7: Project-Level Read-Only Diagnosis MVP

Implementation status:

- `electron/builder-project-environment-diagnosis.cjs` is the Main-owned
  project diagnosis service. It consumes only `project_id`, reads the current
  selected source tree through project read authority, resolves the bound
  project root through the workspace path service, and runs bounded version
  probes for `node`, `npm`, `pnpm`, `yarn`, and `git`.
- The result is a compact redacted projection:
  `package_manifest`, `dependency_manifest`, `lockfile`, `package_manager`,
  `project_dependency_state`, toolchain state/version facts,
  `readiness_state`, `primary_action`, digest, timestamp, and an authority block.
- `electron/builder-check-run-approval-ipc-adapter.cjs`,
  `electron/builder-check-run-approval-ipc-runtime.cjs`, `electron/preload.cjs`,
  and the renderer `BuilderCheckRunPort` expose a dedicated
  `diagnoseProjectEnvironment({ project_id })` path.
- `src/app/BuilderApp.tsx` uses that project-level path from Settings when no
  current draft/check profile exists. Current-draft diagnosis remains tied to
  `draft_id` and `command_profile_id`.
- `electron/builder-project-main-authority.cjs` now preserves
  `builder-project-read-authority.v1` on the read facade so downstream
  diagnosis services can verify the authority chain without receiving broader
  Main authority.

Boundary:

- Project-level diagnosis does not install dependencies, run checks, create a
  candidate check workspace, save drafts, write project files, call Git writes,
  dispatch the provider, or grant Browser/Preview/Harness authority.
- If Builder can see host toolchains but the project root lacks dependency
  markers, the diagnosis reports `project_dependencies_missing`. If the project
  root cannot be resolved, it reports `unknown` instead of guessing.
- Host toolchain absence remains distinct from project dependency absence:
  `host_toolchain_missing` is not reused for missing `node_modules`.

Next required slice:

- Add a Settings entry for current-draft check dependency setup. It may only
  call the existing check-workspace preparation path after diagnosis reports
  `primary_action: prepare_once`.
- Keep project-level no-draft diagnosis read-only until a separate
  project-root setup policy is designed and approved.

### A1.3.8: Settings One-Shot Check Dependency Preparation

Implementation status:

- Settings now shows `Prepare once` only for a current draft/check diagnosis
  whose redacted readiness result reports `primary_action: prepare_once`.
- The Settings action calls the same
  `decideCurrentDraftDependencyPreparation({ decision: "allow_once" })` path as
  the composer-adjacent dependency card. It does not introduce a second
  installer, project-root install, Browser/Preview path, or Harness authority.
- The renderer keeps `Preparing...` visible until the check result projection is
  refreshed, preventing the old incomplete status from flashing the button back
  to `Prepare once`.
- A per-draft renderer guard suppresses repeated clicks while dependency
  preparation is in flight. The backend active-run lock remains authoritative.
- After a preparation decision completes, the stale diagnosis is cleared so the
  UI must rely on the refreshed check projection before offering another
  action.

Boundary:

- This slice does not enable installation from project-level no-draft
  diagnosis. A selected project may report `project_dependencies_missing`, but
  Settings cannot install into the project root.
- The installer still runs only in the isolated candidate check workspace and
  still uses the existing dependency preparation receipt and timeout behavior.
- Detect-before-install remains enforced by the check main service: `allow_once`
  skips the installer when readiness already proves the check workspace is
  prepared.

### A1.3.9: Packaged Dependency Preparation Canary

Implementation status:

- The packaged Harness failure canary now treats dependency preparation
  in-flight UI as a release gate, not just a diagnostic log.
- After `Prepare once` is clicked, the canary must observe the approval button
  become disabled with `Preparing...` before waiting for the final check result.
  This covers the user-visible regression where the button briefly entered
  preparation and then flashed back to `Prepare once`.
- The same assertion is applied to both successful isolated dependency
  preparation and failed preparation. Failure must remain retryable; success
  must clear the card, rerun the selected check, recover the composer, clear live
  output, and enable Save.
- The existing isolation assertions remain required: dependency preparation must
  not create `node_modules` or `package-lock.json` in the project root.

Boundary:

- This canary does not add a new installer path. It verifies the existing
  Main-owned one-shot check-workspace preparation path.
- `Preparing...` is a renderer in-flight state, while the final authority still
  comes from Main receipts and refreshed check projections.
- Duplicate clicks are treated as suppressed only when the button is disabled
  during the in-flight window; the backend active-run lock remains the
  authoritative protection.

### A1.3.10: Settings Policy Surface MVP

Implementation status:

- The Settings Environment/Dependencies card now presents readiness as
  structured product state instead of a flat diagnostic list.
- Current-draft check diagnosis is grouped into `Readiness`, `Host toolchain`,
  `Project dependencies`, and `Check workspace`, so users can see whether the
  block is caused by host tools, project dependency markers, or isolated check
  workspace dependencies.
- Selected-project diagnosis, used when no current draft check exists, is
  grouped into `Readiness`, `Host toolchain`, and `Project dependencies`.
- Project-level missing dependencies remain read-only in Settings. The UI says
  explicitly that project dependency setup is diagnostic-only in this phase and
  does not expose `Prepare once`.
- `Prepare once` remains visible only for a current-draft check diagnosis whose
  Main-owned redacted projection reports `primary_action: prepare_once`.

Boundary:

- This slice does not add project-root installation, sandbox mode selection,
  network policy controls, Browser/Preview permission controls, or advanced
  config editing.
- The Settings UI exposes only enum/version facts already accepted by the
  renderer sanitizer and backed by current tests/canary evidence.
- Settings remains a policy surface over existing Main-owned capabilities; it
  does not create a second installer or a renderer-owned readiness path.

### A1.3.11: Project Guidance

Implementation status:

- The repository now has a root `AGENTS.md` for Builder contributors and future
  coding agents.
- The guide makes detect-before-install explicit: detect host toolchain,
  package manager, project dependency markers, and isolated current-draft check
  workspace dependencies before requesting any installation.
- The only first-phase install action documented is `Prepare once`, scoped to
  the current draft's isolated check workspace after explicit one-shot user
  approval.
- The guide forbids project-root install from Settings and forbids treating
  command approval, sandbox selection, network permission, Save,
  Browser/Preview approval, or dev-server approval as dependency-install
  approval.
- A source test keeps these guidance boundaries from drifting.

### A1.3.12: Full Settings Policy Surface

- add a compact Environment/Dependencies section in settings or project
  diagnostics;
- expose only states backed by tests and canaries;
- link failed check cards to diagnosis instead of showing noisy permanent
  readiness labels in the composer;
- keep advanced configuration read-only until parser and managed-policy
  precedence exist.

## Acceptance Criteria

1. A dependency-backed draft with a prepared isolated workspace runs the check
   directly, even when the renderer sends `allow_once`.
2. A dependency-backed draft with an unprepared isolated workspace shows
   `Prepare once` and does not run source repair.
3. Clicking `Prepare once` installs only in the isolated check workspace, then
   reruns readiness and the selected check.
4. Missing host toolchain and missing check workspace dependencies are distinct
   public states.
5. Failed or timed-out preparation remains retryable and does not enable Save.
6. Diagnosis never exposes raw host paths, env vars, stdout/stderr, registry
   tokens, process handles, or Electron session data.
7. Browser/Preview can consume readiness status but cannot initiate install or
   command sandbox admission.
8. Existing dependency installs are not blindly reinstalled.

## Biggest Risk

The biggest engineering risk is collapsing several scopes into one "make it
work" button: host toolchain visibility, project-root dependencies, isolated
check workspace dependencies, network access, lifecycle hooks, and Browser
preview all look related to the user, but they require different authorities.

The way to keep the architecture reliable is to make every transition receipt
based:

```text
diagnosis fact -> user action -> Main admission -> scoped effect -> receipt -> projection
```

That keeps performance predictable, preserves security boundaries, and gives
the UI enough truth to explain what happened without letting the agent guess.
