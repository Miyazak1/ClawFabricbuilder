# Builder Sandbox Settings And Runtime Policy Plan - 2026-08-26

Date: 2026-08-26

Status: product and runtime architecture proposal. This document is a design
decision record, not implementation evidence.

Related documents:

- [Builder Worktree And Workspace Lifecycle Policy](BUILDER_WORKTREE_AND_WORKSPACE_LIFECYCLE_POLICY_2026_08_26.md)
- [Builder Runtime Readiness And Agent Environment Research](BUILDER_RUNTIME_READINESS_AGENT_ENVIRONMENT_RESEARCH_2026_08_26.md)
- [Controlled Bash V1 Architecture](CONTROLLED_BASH_V1_ARCHITECTURE.md)
- [Universal Programming Runtime Contract](UNIVERSAL_PROGRAMMING_RUNTIME_CONTRACT.md)
- [General Browser Web Mode Architecture](GENERAL_BROWSER_WEB_MODE_ARCHITECTURE.md)
- [Agent Companion Settings and Context Architecture](AGENT_COMPANION_SETTINGS_AND_CONTEXT_ARCHITECTURE.md)
- [Lifecycle Hooks Architecture](LIFECYCLE_HOOKS_ARCHITECTURE.md)

## Decision

Builder should expose sandbox, approval, network, dependency readiness, and
browser capability settings as first-class product controls. These controls
must remain backed by Main-owned policy, admission, receipt, and enforcement
records.

The settings surface must not overstate the current sandbox. Until an
operating-system sandbox provider is connected and tested, command execution
that requires filesystem or network containment must fail closed or report
partial enforcement with an actionable reason.

## Product Reference

A Codex settings screen reviewed on 2026-08-26 groups these controls in one
configuration area:

- agent defaults: approval policy, sandbox setting, web search, output detail,
  and reasoning summary;
- model capabilities: available reasoning effort and advanced model visibility;
- workspace dependencies: managed Node.js and Python dependencies, diagnostics,
  reinstall/reset, and current dependency version;
- an advanced `config.toml` entry point.

The useful lesson is not the exact UI. The useful lesson is that users need a
visible way to understand and change the agent's operating boundary before a
run starts, and a diagnostic way to understand why a run cannot safely continue.

## User-Facing Settings Model

Builder should separate these settings in the UI:

| Setting group | User-facing purpose | Engineering authority |
| --- | --- | --- |
| Approval policy | When Builder asks before using tools or running commands | permission admission and one-shot approval receipts |
| Sandbox mode | What a command or tool can read or write | sandbox policy and provider enforcement report |
| Network access | Whether execution can access web or package registries | network policy and sandbox/provider admission |
| Dependency readiness | Whether the admitted workspace can run checks | runtime readiness snapshot and dependency receipt |
| Browser and Preview | How browser sessions, preview, downloads, and navigation are governed | Browser session policy and WebContents admission |
| Output and reasoning | How much detail is shown to the user | projection policy only; no authority grant |
| Advanced config | Text configuration for expert users | parsed policy that cannot weaken managed defaults |

Approval, sandbox, and network must be independent. Approving `npm test` once
does not grant dependency installation, external network access, host secret
access, or external-directory writes.

## Scope Layers

Settings should be interpreted through three layers:

1. Global defaults: the user's default posture for new projects and tasks.
2. Project policy: project-specific capability choices and readiness state.
3. Run admission: the concrete, immutable permission and sandbox receipts used
   by one task run.

The renderer may show global and project settings. A run may show public
receipt status and enforcement summaries. The renderer must not receive raw
process handles, sandbox runner arguments, provider credentials, Electron
partitions, host paths, permission identifiers, or sandbox tokens.

## Sandbox Policy Contract

Add a Builder-owned sandbox policy module before integrating a real OS
provider.

Suggested module:

```text
electron/builder-sandbox-policy.cjs
```

Suggested public shape:

```ts
type BuilderSandboxPolicyV1 = Readonly<{
  policy_version: "builder-sandbox-policy.v1";
  policy_id: string;
  subject_kind: "command" | "check" | "dev_server" | "file_tool" | "browser";
  project_id: string;
  task_id: string | null;
  run_id: string | null;
  filesystem: {
    mode: "read_only" | "workspace_write" | "danger_full_access";
    read_roots: readonly string[];
    write_roots: readonly string[];
    deny_patterns: readonly string[];
    symlink_policy: "deny_escape" | "deny_all";
  };
  network: {
    mode: "deny" | "loopback_only" | "allowlist" | "unrestricted";
    allowed_hosts: readonly string[];
  };
  process: {
    child_processes: "deny" | "allow_owned_tree";
    external_process_visibility: "deny" | "host_default";
  };
  environment: {
    inherited_env: "minimal" | "deny" | "host_default";
    secret_disclosure: "deny";
  };
  timeout_ms: number;
  enforcement_required: "full" | "partial_allowed" | "diagnostic_only";
}>;
```

This policy is not permission by itself. It is the input to a sandbox admission
and provider decision.

## Sandbox Provider Contract

Add a provider seam before changing process execution.

Suggested module:

```text
electron/builder-sandbox-provider.cjs
```

Provider result:

```ts
type BuilderSandboxAdmissionV1 = Readonly<{
  admission_version: "builder-sandbox-admission.v1";
  policy_id: string;
  provider_id: string;
  platform: "win32" | "darwin" | "linux";
  enforcement: "none" | "partial" | "full";
  spawn_strategy: "deny" | "direct" | "wrapped";
  safe_user_message: string;
  private_spawn: unknown;
}>;
```

Initial provider:

- `deny` provider for all non-diagnostic command execution;
- optional `diagnostic` provider for tests and settings status;
- no silent fallback from unavailable enforcement to direct host execution.

Later providers:

- Linux: bubblewrap or Landlock-backed wrapper;
- macOS: Seatbelt profile wrapper;
- Windows MVP: restricted token, ACL workspace, and Job Object;
- Windows later: AppContainer or ProcessContainer when file and network
  capability declarations are mature;
- enterprise or remote: cloud/container execution as a separate backend, not
  the local default.

Windows restricted token, ACL workspace, and Job Object should be reported as
partial unless network and filesystem containment are both proven by tests.

## Command And Check Integration

The first integration point should be command/check subprocess execution, not
Browser or Workbench.

Process launch sequence:

```text
command profile admission
-> one-shot user approval when required
-> sandbox policy creation
-> sandbox admission
-> fail closed if enforcement is unacceptable
-> process adapter spawn
-> bounded output, timeout, process-tree cleanup
-> result and enforcement summary
```

`builder-controlled-command-executor.cjs` already has useful safeguards:
temporary command workspace materialization, `shell: false`, minimal
environment, bounded output, timeout, and process-tree cleanup. The sandbox seam
should wrap or precede that existing path instead of replacing the programming
runtime.

If sandbox admission fails for an automatic check, the run should end in an
actionable environment state such as `sandbox_unavailable` or
`blocked_environment`. It must not enter the model repair loop.

## File Tools Integration

File tools require a separate policy preflight. They do not become safe merely
because subprocesses have a sandbox.

Rules:

- read, search, edit, and write continue through Builder-owned workspace tools;
- all file tool requests use project resource IDs, not host paths;
- protected workspace paths remain denied;
- stale-write checks remain required;
- symlink, junction, and path escape tests belong to the file tool layer and to
  subprocess materialization separately.

## Browser And Preview Separation

Browser sandbox and command sandbox must remain separate.

Command sandbox governs:

- subprocess filesystem effects;
- subprocess network access;
- process tree lifecycle;
- environment inheritance and secret disclosure.

Browser and Preview policy governs:

- Electron `WebContentsView` preferences;
- session class and persistence;
- navigation and origin admission;
- downloads and upload fixtures;
- permission requests;
- cookie, storage, history, and credential exposure;
- preview proxy and loopback dev-server attachment.

Shared concepts are allowed: policy language, approval status, public
enforcement summary, and redacted diagnostics. Shared execution providers are
not allowed.

Project Preview remains loopback-only and source-bound. Agent Test remains
run-bound and ephemeral. User Web may have durable profile state only through a
separate browser policy.

## Settings Surface Proposal

Builder settings should eventually include:

| Section | MVP controls | Later controls |
| --- | --- | --- |
| Agent defaults | approval policy, output detail, reasoning summary | model effort matrix, per-agent overrides |
| Runtime and sandbox | sandbox mode display, enforcement status, command policy | OS provider selection, enterprise managed policy |
| Network | disabled or cached/status-only | domain allowlist, package registry approval |
| Workspace dependencies | Builder runtime status, Harness status, Node/npm/Python diagnostics, reset/reinstall | dependency workspace cache and lockfile receipts |
| Browser and Preview | project preview isolation status, dev-server approval status | user web profile, downloads, cookies, agent browser control |
| Advanced config | open config file, validate config | managed policy overlay and schema migration |

MVP UI must not offer controls that the backend cannot enforce. For example,
if network deny is not enforced for a Windows command provider, the UI should
show partial or unavailable status rather than a working "network denied" mode.

## Configuration File

Builder may add a text configuration file after the policy schema stabilizes:

```toml
[agent]
approval_policy = "on_request"
output_detail = "model_default"
reasoning_summary = "auto"

[runtime]
sandbox_mode = "workspace_write"
sandbox_enforcement_required = "full"
network = "deny"

[dependencies]
auto_install = false
missing_behavior = "block"

[browser]
project_preview = "loopback_only"
downloads = "deny"
agent_control = "ask"
```

The parser must reject unknown keys by default, record schema versions, and
prevent local project config from weakening user-managed or enterprise-managed
policy.

## Implementation Slices

### S1: Settings And Policy Contract

- add `builder-sandbox-policy.cjs`;
- add redacted setting projection fields;
- add schema drift and strict parsing tests;
- document global, project, and run scope precedence.

### S2: Deny Provider And Admission Seam

- add `builder-sandbox-provider.cjs`;
- implement deny and diagnostic providers;
- require sandbox admission before selected command/check spawns;
- return `sandbox_unavailable` when enforcement is missing;
- prove automatic checks do not enter repair loops on sandbox failure.

### S3: File Tool Policy Preflight

- apply the same policy vocabulary to Builder workspace tools;
- keep project resource IDs as the only model-facing file address;
- add path escape, symlink, junction, protected path, and stale-write tests.

### S4: Windows Partial Provider

- add restricted token, ACL workspace, and Job Object provider;
- report `partial` until network containment is real;
- prove process-tree cleanup, outside-workspace write denial where supported,
  and honest public enforcement messaging.

### S5: Browser Settings

- expose Browser and Preview policy status separately from command sandbox;
- keep Project Preview, Agent Test, and User Web session classes separate;
- add user-facing diagnostics without exposing Electron partitions or tokens.

### S6: Strong Providers

- add Linux bubblewrap or Landlock provider;
- add macOS Seatbelt provider;
- evaluate AppContainer or cloud/container backend after the local policy seam
  is stable.

## Acceptance Criteria

1. Approval policy and sandbox policy are separate records.
2. No command or check requiring sandbox enforcement runs through a direct spawn
   fallback.
3. Windows partial enforcement is labeled partial and cannot satisfy a `full`
   requirement.
4. File tools enforce policy independently of subprocess sandboxing.
5. Browser settings cannot grant command execution authority.
6. Command sandbox providers cannot read or mutate browser session state.
7. Missing dependency workspace, missing sandbox, and failed source checks have
   distinct terminal states.
8. Renderer config cannot weaken managed policy or mint run admission receipts.
9. Diagnostics are actionable but redact host paths, credentials, tokens,
   process handles, and Electron partitions.
10. Settings UI text never promises a capability before implementation tests and
    packaged evidence exist.

## Collaboration Notes

This document incorporates the 2026-08-26 sandbox/runtime discussion and the
cross-task review from `codex://threads/01a032bb-d0dd-7a00-90c1-3b7429aeacb0`.

The cross-task feedback agreed with these boundaries:

- do not import DeepSeek Harness sandbox as the Builder authority model;
- reuse small, auditable ideas and code only behind Builder-owned contracts;
- keep Browser and command sandbox policy separate;
- make Windows first-stage enforcement honest and partial;
- avoid a broad runtime replacement that touches command, browser, Workbench,
  plugin, and approval layers at the same time.

The follow-up request for a dedicated Codex-settings-page review was sent to
that task while it was still in progress. This document uses its prior
Browser/Workbench boundary feedback and can be revised when that task emits
additional final guidance.
