# Builder Runtime Readiness And Agent Environment Research - 2026-08-26

Date: 2026-08-26

Status: A0.7 design input plus A0.7.2 implementation anchor. Do not implement
dependency installation, Browser runtime work, or broad Workbench migration
until this boundary is accepted.

Related documents:

- [Builder Dependency Readiness Closure Gate](BUILDER_DEPENDENCY_READINESS_CLOSURE_GATE_2026_08_25.md)
- [Builder A0.7 Behavioral Performance Gate](BUILDER_A07_BEHAVIORAL_PERFORMANCE_GATE_2026_08_26.md)
- [Controlled Bash V1 Architecture](CONTROLLED_BASH_V1_ARCHITECTURE.md)
- [Builder Chat And Generation Performance Plan](BUILDER_CHAT_GENERATION_PERFORMANCE_PLAN.md)
- [Builder Environment Readiness Settings And Diagnostics Plan](BUILDER_ENVIRONMENT_READINESS_SETTINGS_AND_DIAGNOSTICS_PLAN_2026_08_27.md)

## Question

User feedback clarified the real product problem:

The user's computer may already have dependencies and tools installed. Codex can
often inspect and use a local repository directly. Builder's DeepSeek Harness
integration, however, may only see Builder-admitted project files and a
materialized candidate check workspace.

Therefore, a failed automatic check must not simply say "dependencies are not
installed" when the narrower truth is "the admitted check workspace does not
currently have dependency access."

The design question is where dependency and local environment readiness should
live:

- inside DeepSeek Harness;
- inside the model-visible tool runtime;
- inside Builder Main as an authority and evidence layer;
- inside a future install/cache capability.

## DeepSeek Harness Integration Facts

Builder intentionally uses DeepSeek Harness as a replaceable agent loop, not as
the owner of local machine authority.

`electron/harness/builder-coding-loop.cordis.yml` states that Builder owns
workspace state, checks, checkpoints, and file authority, while Harness reaches
project files through an authenticated loopback broker. The same composition
sets:

- `includeHarnessIdentity: false`;
- `includeRuntimeContext: false`;
- `workspaceContext: false`;
- `skills.enabled: false`;
- `toolBash: false`;
- `toolJobs: false`;
- `goals: false`.

`electron/harness/builder-tool-broker-plugin.mjs` exposes the model-facing
Builder tools. File paths must be project-relative. Command text is bounded,
single-line, normalized, and brokered through the `execute_command` method. The
`bash` tool description says it can run one current project check command only
after Builder shows it for one-time approval.

Current check understanding is also intentionally narrow:

- `electron/builder-project-understanding.cjs` detects package manager and
  check command profiles from source-tree files such as `package.json` and
  lockfiles.
- Its authority is `source_read: provided_snapshot_only` with no command,
  network, Git, secret, renderer, or provider authority.
- `electron/builder-check-workspace-materializer.cjs` materializes generated
  source files into a guarded temporary workspace. It does not copy
  `node_modules` and does not install dependencies.
- `electron/builder-check-run-runner.cjs` can classify common missing package
  or missing binary diagnostics as `environment_unavailable`, but today this is
  inferred from check output and workspace-local `node_modules` presence.

Conclusion: in the current architecture, Harness cannot be the component that
discovers arbitrary host dependencies. The readiness decision must be
Builder-owned and must distinguish project-local state, host-local toolchain
visibility, and candidate-workspace dependency access.

## External Product Survey

This survey is used for boundary model guidance, not for copying
implementation.

OpenAI Codex local environment:

- Official Codex docs describe the local tool as working against a local repo,
  able to inspect files, make edits, and run tools installed on the machine,
  with user-controlled command/network permissions.
- Lesson for Builder: local environment access can be powerful, but it must be
  surfaced as a permissioned capability. It is not just "the model knows what is
  on the machine."

Claude Code SDK permissions:

- Claude Code documents permission modes such as default, accept edits, bypass
  permissions, plan, and model-classified auto behavior.
- Lesson for Builder: tool use should have explicit permission modes and a
  `canUseTool`-style policy decision, with read-only planning distinct from
  executing or modifying state.

Cursor agent run modes:

- Cursor separates approval policy from sandbox policy. Auto-review uses an
  allowlist, shell sandboxing where possible, and classifier fallback.
- Lesson for Builder: "allowed command" and "where the command may see/write"
  are separate contracts. Builder should not let a command profile imply broad
  host access.

Cursor cloud agent environments:

- Cursor cloud agents run on isolated Ubuntu machines. Cursor emphasizes that
  agents need configured repositories, tools, dependencies, secrets, and network
  access to close the loop. Install scripts run while creating reusable Builds,
  and future agents start from the active Build.
- Lesson for Builder: dependency preparation is a separate environment lifecycle
  step. Expensive or risky install work belongs outside the hot generation turn
  and should produce a reusable readiness receipt.

GitHub Copilot sandboxes:

- GitHub distinguishes local restricted sandboxes and cloud isolated ephemeral
  Linux environments. Local sandbox configuration can control filesystem,
  network, credentials, subprocesses, and per-command rules.
- Lesson for Builder: local execution must be governed by a host policy, not by
  implicit access to the user's shell. Cloud-style execution requires a separate
  prepared environment model.

Gemini CLI trusted folders:

- Gemini CLI prompts before loading project-specific configuration and uses a
  restricted mode for untrusted folders.
- Lesson for Builder: project trust and environment readiness should be
  separate. A project can be readable while its scripts, env files, extensions,
  or dependency hooks are not admitted.

References:

- OpenAI Codex local docs: https://learn.chatgpt.com/docs/codex/cli
- Claude Code SDK permissions: https://code.claude.com/docs/en/agent-sdk/permissions
- Cursor run modes: https://prod.cursor.com/docs/agent/security/run-modes
- Cursor cloud environment setup: https://prod.cursor.com/docs/cloud-agent/setup
- GitHub Copilot cloud/local sandboxes: https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes
- GitHub Copilot cloud agent: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- Gemini CLI trusted folders: https://google-gemini.github.io/gemini-cli/docs/cli/trusted-folders.html

## Design Position

Runtime readiness belongs in Builder Main.

DeepSeek Harness should continue to receive only admitted project files,
bounded tool results, and reconciliation signals. It should not receive raw
host paths, `PATH`, environment variables, package registry tokens, shell
configuration, or arbitrary filesystem probes.

The user-facing truth should be precise:

- "Project dependencies are present in the current project folder."
- "Project dependencies are not present in the current project folder."
- "The host toolchain is visible to Builder Main."
- "The admitted candidate check workspace has no dependency install."
- "This check needs a prepared dependency workspace before it can run."
- "Installing or binding dependencies requires your approval."

This keeps authority and messaging aligned. It also prevents two bad outcomes:

- the model repeatedly editing source to fix an environment problem;
- Builder blaming the user's machine when the limitation is Builder's admitted
  workspace.

## Proposed Readiness Contract

Add a Main-owned, versioned readiness snapshot. It should be redacted and safe
to pass through renderer boundaries.

Suggested shape:

```ts
interface BuilderRuntimeReadinessSnapshotV1 {
  snapshot_version: "builder-runtime-readiness-snapshot.v1";
  project_id: string;
  source_tree_digest: string;
  package_manager: "npm" | "pnpm" | "yarn" | "bun" | "none";
  package_manifest_state:
    | "absent"
    | "present_readable"
    | "present_unreadable";
  lockfile_state:
    | "absent"
    | "present";
  project_dependency_state:
    | "not_applicable"
    | "install_present"
    | "install_missing"
    | "unknown";
  host_toolchain_state:
    | "not_checked"
    | "visible"
    | "missing"
    | "not_admitted";
  check_workspace_dependency_state:
    | "not_materialized"
    | "install_present"
    | "install_missing"
    | "not_admitted";
  execution_scope:
    | "source_snapshot"
    | "candidate_check_workspace"
    | "project_workspace"
    | "host_toolchain_probe";
  dependency_strategy:
    | "no_execution_needed"
    | "can_run_without_install"
    | "needs_prepared_dependency_workspace"
    | "needs_host_toolchain_admission"
    | "needs_install_approval";
  install_permission:
    | "not_requested"
    | "required"
    | "denied"
    | "approved_once";
  updated_at_ms: number;
  authority: {
    owner: "builder_main";
    host_paths_exposed: false;
    environment_variables_exposed: false;
    network_access_granted: false;
    installation_performed: false;
  };
}
```

The first version can stay Node-oriented because current controlled checks are
package-script based. The contract should leave room for Python, Rust, Go,
Java, .NET, and arbitrary static projects later by making package manager,
toolchain, and dependency strategy explicit rather than baking in `node_modules`
as the only readiness concept.

## Host And Project Probing Rules

Project-local probing:

- may check whether manifest and lockfiles exist in the current source tree;
- may check whether the selected project root has a dependency install marker,
  such as `node_modules` for Node projects;
- must not read dependency contents by default;
- must not copy dependency directories into candidate workspaces by default.

Host-local toolchain probing:

- must be Main-owned and redacted;
- may check package manager availability and version through bounded commands
  such as `node --version` or `npm --version`, only when that probe is admitted
  by Builder policy;
- must not expose raw `PATH`, usernames, home directories, env vars, registry
  tokens, or shell rc files to Harness or the renderer;
- should record only normalized facts like `npm visible` and a bounded version
  string.

Candidate workspace checks:

- should keep using isolated materialized source for unsaved drafts;
- should not silently assume the project root's dependency install is available;
- should classify missing candidate dependencies as
  `environment_unavailable/dependency_workspace_missing`;
- should not enter source repair for that result.

Dependency preparation:

- should be a separate user-approved capability;
- may run install commands in an isolated check workspace or cache keyed by
  platform, package manager, lockfile digest, and package manager version;
- must treat package-manager lifecycle hooks and network access as risky;
- should produce a reusable readiness receipt before the next generation turn.

## Recommended Implementation Order

### A0.7.1: Readiness Taxonomy And Terminal Closure

Goal: stop stale "thinking" and repair loops caused by environment readiness
failures.

Implement:

- add `environment_unavailable` detail fields internally, starting with
  `dependency_workspace_missing`, `package_manager_missing`,
  `project_dependencies_missing`, and `host_toolchain_not_admitted`;
- teach automatic candidate check coordination to treat these as terminal
  environment facts, not source-code repair targets;
- reconcile with a clear conversation item and clear busy/live output;
- ensure the message does not claim the user's computer lacks dependencies when
  only the candidate workspace is missing them.

Acceptance:

- a dependency-backed script in a dependency-empty candidate workspace closes
  within a bounded time;
- no repair attempt is made for dependency readiness failures;
- the final chat message says a prepared dependency workspace or approval is
  needed;
- Save/Discard state is not left in a disabled or stale state;
- no install, network, broad host probing, or Harness authority is added.

### A0.7.2: Main-Owned Readiness Snapshot

Goal: make readiness a stable fact instead of an output-regex guess.

Implementation status:

- `electron/builder-runtime-readiness-snapshot.cjs` defines the first
  digest-bound readiness snapshot contract.
- `electron/builder-check-workspace-materializer.cjs` can now produce a
  redacted readiness snapshot for its private candidate workspace.
- `electron/builder-check-run-runner.cjs` reads the materializer-provided
  snapshot when available, after runtime admission and before command launch.
- The snapshot is not yet projected to the renderer, persisted in a store, or
  used to request dependency installation.

Implement:

- add `builder-runtime-readiness-snapshot.v1`;
- compute project-local dependency markers from the selected project root when
  the project root is admitted;
- compute package manager intent from existing project understanding;
- keep host toolchain state as `not_checked` unless an admitted probe exists;
- persist or attach the snapshot to check/candidate evidence.

Acceptance:

- source-only projects report `no_execution_needed`;
- package projects without dependency install report `needs_install_approval`
  or `needs_prepared_dependency_workspace`;
- projects with local dependencies do not automatically grant candidate
  workspace dependency access;
- renderer and Harness receive only redacted readiness fields.

Current v1 field names differ slightly from the sketch above to match the
existing CJS contract style:

- `package_manifest`: `absent`, `present`, or `unreadable`;
- `lockfile`: `none`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
  `bun.lock`, or `bun.lockb`;
- `project_dependency_state`: `not_applicable`, `not_admitted`, `unknown`,
  `install_present`, `install_missing`, or `unavailable`;
- `check_workspace_dependency_state`: `not_applicable`, `not_materialized`,
  `install_present`, `install_missing`, or `unavailable`;
- `dependency_strategy`: `no_execution_needed`, `can_run_without_install`,
  `needs_host_toolchain_admission`, `needs_install_approval`,
  `needs_prepared_dependency_workspace`, `blocked_by_install_denial`, or
  `unknown`.

The important product point is preserved: a user's project folder can have
dependencies installed while the candidate check workspace still reports
`install_missing`. That distinction is what prevents Builder from wrongly
claiming the user's machine is broken or entering source repair for an
environment-scoping problem.

### A0.7.3: Optional Toolchain Probe

Goal: distinguish "Node/npm unavailable" from "not admitted" without exposing
host details.

Implementation status:

- `electron/builder-runtime-toolchain-probe.cjs` defines a bounded,
  main-owned toolchain probe service.
- The service only supports the selected package manager family:
  `node --version` for npm/pnpm/yarn-backed checks and
  `<manager> --version` for npm/pnpm/yarn/bun.
- Probe output is reduced to enum state plus bounded version strings. Raw
  stdout/stderr, paths, environment variables, registry config, and shell
  output are not serialized.
- `electron/builder-runtime-readiness-snapshot.cjs` can consume a sanitized
  probe result and project `host_toolchain_state`,
  `host_node_version`, and `host_package_manager_version`.
- The probe is wired into the production check main service by A0.7.4, but it
  still does not grant install/network authority or expose a public renderer
  readiness panel.

Implement:

- add a small allowlisted probe for package manager versions;
- record bounded version strings and failure class;
- never send raw command output to Harness;
- make probe policy explicit in tests and docs.

Acceptance:

- missing package manager becomes a terminal environment result;
- visible package manager is a readiness fact, not permission to run installs;
- raw env/path data is not logged or serialized.

### A0.7.4: Production Wiring And Preflight Gate

Goal: use the readiness facts in the real check orchestration path without
granting install, network, renderer, or Harness authority.

Implementation status:

- `electron/builder-check-run-runtime-composition.cjs` creates the bounded
  toolchain probe service from the existing check process adapter and clock.
- `electron/builder-check-run-main-service.cjs` now probes the selected package
  manager, asks the materializer for a sanitized workspace readiness snapshot,
  and evaluates a preflight gate before command execution.
- If the candidate source declares external dependencies and the materialized
  check workspace has no dependency install, Main records an
  `environment_unavailable` check run and returns the existing incomplete
  check projection instead of starting the runner.
- The packaged npm runtime is not blocked solely because a host npm probe is
  unavailable when the candidate does not declare external dependencies.

Non-goals:

- no dependency installation;
- no dependency directory copy/bind from the project root;
- no raw host PATH/env/stdout/stderr serialization;
- no public renderer readiness panel yet;
- no Harness authority expansion.

Acceptance:

- declared dependency + empty candidate workspace closes as
  `Check unavailable` without dispatching the check runner;
- package scripts without declared external dependencies can still run through
  the packaged runtime;
- readiness snapshots crossing internal service boundaries are sanitized before
  they affect control flow;
- failed or unavailable toolchain probes remain redacted facts, not raw output.

### A0.8: Runtime Readiness UI Projection

Goal: make environment-blocked checks understandable in the chat flow and
Save-card-adjacent check UI without adding install authority.

Implementation status:

- `builder-check-run-status-projection.v1` now carries a redacted
  `environment_reason` enum.
- The check main service uses the current sanitized readiness snapshot when a
  preflight gate records `environment_unavailable`, so the immediate renderer
  result can say whether the candidate needs a prepared dependency workspace,
  install approval, has an install denial, or cannot see the required host
  toolchain.
- `builder-check-run-outcome-projection.v1`, the renderer IPC port, and
  conversation sanitizers preserve that enum and the fixed public summary.
- Older stored check runs without a readiness snapshot still project to
  `environment_unknown` and the previous generic unavailable summary.

Non-goals:

- no dependency installation;
- no dependency directory copy/bind from the project root;
- no path, env, raw output, or tool stdout/stderr disclosure;
- no long-lived dependency preparation receipt yet.

Acceptance:

- dependency-backed drafts with an unprepared isolated workspace show
  `dependency_workspace_missing`;
- Save/Discard remains a review decision, while the check status explains why
  automatic verification did not run;
- renderer receives only enum/copy projection data, never host paths or
  install authority.

### A1.2.2: Dependency Preparation Failure Closure

Goal: close the loop for dependency-backed projects without weakening the
candidate isolation model, while making failed preparation attempts visible and
retryable instead of looking like a missed click.

Implemented boundary:

- the approval card is separate from Save/Discard and remains scoped to a
  single check;
- Builder Main owns dependency preparation and writes only to the isolated
  candidate check workspace;
- dependency preparation receipts keep raw output and paths redacted, while
  preserving status, exit code, command display, and output digest;
- a failed action is recorded on the check run as one of:
  `dependency_preparation_failed`, `dependency_preparation_timed_out`, or
  `package_manager_unavailable`;
- the renderer keeps the dependency preparation card visible in a stable
  retryable failure state and does not enable Save;
- DeepSeek Harness receives no broader host authority and no install authority.

Still later:

- lockfile-digest cache;
- lifecycle hook warning;
- explicit network and file-write policy controls;
- cleanup and cache invalidation beyond the per-check workspace;
- package managers beyond the current npm path.

### A1.2.3: Decision Entry and Detect-Before-Install Policy

Goal: make the user confirmation path predictable without turning dependency
preparation into blind installation.

Policy:

- Builder checks local toolchain and isolated workspace readiness before showing
  the dependency preparation action;
- `Prepare once` is a one-shot approval to install in the isolated check
  workspace and rerun the selected check, not a project-root install and not a
  save action;
- if readiness already proves the check workspace is prepared, Builder should
  run the check instead of reinstalling;
- if readiness is missing or incomplete, the renderer shows a bounded action
  card and Main performs the install only after the user confirms;
- decision failures preserve only fixed public reasons such as busy, stale
  draft/profile, invalid request, forbidden active window, or unavailable check
  service;
- Browser/Preview settings consume readiness results but do not initiate
  dependency installation.

Acceptance:

- clicking `Prepare once` enters a visible preparing state, installs
  dependencies in the isolated workspace, and automatically reruns the check;
- failed dependency preparation remains a retryable card above the composer;
- generation failure notices are suppressed when a recoverable draft is already
  present;
- no install is attempted without readiness need plus explicit one-shot user
  approval;
- no project root `node_modules` or package lock is created by check
  preparation.

### A1.3: Environment Readiness Productization

Goal: turn readiness facts into a product-facing diagnosis model while keeping
installation scoped and explicitly approved.

Implementation anchor:

- [Builder Environment Readiness Settings And Diagnostics Plan](BUILDER_ENVIRONMENT_READINESS_SETTINGS_AND_DIAGNOSTICS_PLAN_2026_08_27.md)
  records the current external-product survey, settings model, Browser/Preview
  boundary, and first implementation slices;
- `builder-check-run-main-service` now has a detect-before-install regression
  test proving that `allow_once` does not invoke dependency preparation when
  the isolated check workspace is already ready;
- `builder-environment-readiness-diagnosis.v1` now provides a redacted,
  Main-owned backend diagnosis projection, and current draft checks can call it
  without dispatching the runner or dependency preparer;
- check-run IPC, preload, and the renderer infrastructure port now expose the
  diagnosis as a read-only redacted projection, with renderer-side sanitizers
  rejecting install, command, Browser/Preview, raw output, source tree, path,
  env, secret, network, or write authority drift;
- the current dependency preparation card now has a read-only `Diagnose`
  action that shows redacted readiness facts without preparing dependencies or
  running the selected check;
- Settings now has a compact Environment/Dependencies card for current-draft
  read-only diagnosis and, when no current draft/check exists, a separate
  project-level read-only diagnosis action;
- Settings can trigger the existing one-shot current-draft check dependency
  preparation path only after current-draft diagnosis reports
  `primary_action: prepare_once`; this keeps the installer scoped to the
  isolated check workspace and avoids project-root installs;
- the packaged Harness failure canary now gates the one-shot preparation path
  on the actual in-flight UI: after `Prepare once`, the approval button must be
  disabled with `Preparing...` before the final check projection is accepted;
  the same release gate covers the success and failure paths and keeps
  project-root `node_modules`/`package-lock.json` absent;
- `builder-project-environment-diagnosis.v1` is now the Main-owned
  project-level contract. It detects selected-project manifest, lockfile,
  package-manager, project dependency marker, and redacted
  `node`/`npm`/`pnpm`/`yarn`/`git` toolchain facts without involving DeepSeek
  Harness, command execution, dependency preparation, Browser/Preview, Save, or
  provider dispatch;
- Settings diagnosis distinguishes no current draft, check-discovery loading,
  check-discovery failed, no-approved-check, current-draft diagnosis, and
  project-level diagnosis states without reusing a current-draft check contract
  as a fake project diagnosis. Broader policy settings, explicit project-root
  dependency setup, and reusable dependency caches remain future work.
- Settings now renders readiness as grouped product state. Current-draft checks
  show Readiness, Host toolchain, Project dependencies, and Check workspace;
  selected-project diagnosis shows Readiness, Host toolchain, and Project
  dependencies. Project-root setup remains diagnostic-only and does not expose
  `Prepare once`.

Acceptance:

- existing dependency installs are not blindly reinstalled;
- missing isolated check dependencies continue to show a one-shot preparation
  card;
- Browser/Preview may consume readiness status but cannot initiate dependency
  installation;
- diagnosis and settings expose only redacted enum/version facts backed by
  tests and packaged evidence.

## Performance Implications

Readiness should reduce performance risk by terminating environment-blocked
turns early. It must not add a new hot path.

Rules:

- readiness snapshots are computed at task/check boundaries, not per streaming
  delta;
- host probes are bounded and opt-in/admitted;
- install preparation is outside the generation hot path;
- dependency cache lookup uses small digests and metadata, not directory scans
  during streaming;
- readiness facts are small enough to cross IPC without carrying source trees,
  dependency files, logs, or env.

## Risks

Host privacy:

- probing local tools can accidentally reveal usernames, home paths, registry
  settings, or secrets.
- control: redact to enum states and bounded versions only.

False readiness:

- `node_modules` may exist but be stale, platform-incompatible, or mismatched
  with the lockfile.
- control: use lockfile/package-manager digests before considering reuse or
  cache.

Candidate mismatch:

- project-root dependencies may not work when candidate files are in a temp
  workspace.
- control: do not bind host/project dependencies to unsaved candidates without
  an explicit prepared dependency strategy.

Install risk:

- package installs can run lifecycle scripts, write many files, and use the
  network.
- control: separate approval, no auto-install, cache receipt, explicit
  revocation/cleanup.

Schema churn:

- renderer contracts currently understand coarse `environment_unavailable`.
- control: start with internal detail fields and widen public schema only when
  UI and persistence tests are ready.

## Decision

Do not make DeepSeek Harness responsible for local dependency discovery.

Do not give the agent unrestricted access to the host environment just because
Codex-like products can operate locally. Builder can eventually offer a similar
closed loop, but its authority must remain explicit:

```text
Builder Main readiness facts
-> admitted check/runtime scope
-> DeepSeek Harness bounded tool result
-> terminal reconcile or source repair decision
-> chat-flow user action when approval is needed
```

The next implementation should be A0.7.1: readiness taxonomy and terminal
closure. That directly addresses the current stuck-state bug and creates the
right foundation for later performance work, Browser Node, and multi-language
programming support.
