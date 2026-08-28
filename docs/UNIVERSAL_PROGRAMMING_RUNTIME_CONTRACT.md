# Universal Programming Runtime Contract

Date: 2026-08-25

Status: design authority for roadmap gates G2, G3, and G4

## Scope

This document extends Builder's shipped programming loop from bounded
JavaScript package scripts to language-independent project execution. It defines
the product-owned contracts for:

- project environment and toolchain discovery;
- project task profiles;
- foreground process execution;
- persistent terminal sessions;
- managed jobs and development servers;
- streamed and retained output;
- structured diagnostics;
- Language Server providers;
- repair, cancellation, checkpoint, and restart behavior.

It is subordinate to:

- [Universal Programming And Browser Loop Roadmap](UNIVERSAL_PROGRAMMING_AND_BROWSER_LOOP_ROADMAP.md);
- [Programming Runtime Adapter And Event Protocol](PROGRAMMING_RUNTIME_ADAPTER_EVENT_PROTOCOL.md);
- [Programming Runtime Timeout And Liveness Policy](PROGRAMMING_RUNTIME_TIMEOUT_AND_LIVENESS_POLICY.md).

[Controlled Bash V1 Architecture](CONTROLLED_BASH_V1_ARCHITECTURE.md) remains
the authority for the current package-script implementation. This contract
defines its successor. Existing V1 command admissions remain valid until their
replacement has passed migration and packaged gates.

This is not a public plugin API. Names and shapes below are semantic contracts;
implementation may use versioned CommonJS modules and SQLite records consistent
with the existing Electron Main architecture.

## Core Decision

Builder supports programming languages through capabilities, not through a
language switch in the agent loop.

```text
Programming Runtime
  asks for a capability
Builder Main
  verifies Project + Run + capability + permission
Provider
  performs the admitted operation
Builder Main
  commits one canonical result
Programming Runtime
  receives the bounded result and continues
```

The core capability vocabulary is:

```text
ProjectEnvironment
Toolchain
ProjectTask
Process
Terminal
Job
Diagnostics
LanguageServer
```

Adding a language should normally add discovery rules and providers, not change
Conversation, Harness, checkpoint, Browser, or renderer code.

## Meaning Of Language Support

Builder may claim that a project language is:

- `detected`: source or manifest evidence identifies the language;
- `toolchain_available`: a verified provider can execute that language;
- `tasks_available`: one or more current task profiles were discovered;
- `diagnostics_available`: structured diagnostic parsing or LSP is ready;
- `qualified`: the language has passed the current packaged acceptance matrix;
- `generic`: no specialized provider is qualified, but a user-approved
  structured task can run through the generic Process capability.

Builder must not claim a language is runnable merely because its extension is
recognized. It must not claim all toolchains are bundled. It must not silently
install an interpreter, compiler, package manager, SDK, language server, or
dependency.

The first qualification matrix covers JS/TS, Python, Go, Rust, Java, C/C++, and
C#. Other languages use the same generic contracts and can become qualified
without a protocol change.

## Authority Model

### Electron Main

Main owns:

- canonical Project and workspace root;
- current source-tree digest and mutable workspace guard;
- environment and toolchain probes;
- executable resolution;
- Project Task construction and identity;
- command risk classification and approval;
- cwd and environment construction;
- process spawn, stdio, signal, timeout, and process-tree cleanup;
- terminal and job ownership;
- output retention, truncation, redaction, and spill files;
- diagnostic normalization;
- LSP process and document lifecycle;
- tool-call/result commit;
- candidate reconciliation, checkpoint, Undo, and recovery.

### Programming Runtime

A runtime may:

- inspect safe environment and task projections;
- request a task or a bounded structured command;
- open and use an admitted terminal when the Run allows it;
- request diagnostic and LSP operations;
- receive bounded outputs and repair failures;
- steer its next model step from canonical tool results.

A runtime may not:

- choose an arbitrary host executable by path;
- inherit application or provider credentials;
- change the admitted Project root;
- mint Project Task, approval, process, terminal, or job identities;
- treat assistant prose as execution evidence;
- reconnect to an unknown PID after restart;
- turn a missing toolchain into an automatic installation.

### Renderer

The renderer may:

- select a Main-issued task profile;
- answer a structured approval request;
- stop an active process, terminal, job, or Run through a bounded command;
- open the Terminal or diagnostics inspector;
- send user terminal input only to a visible, active, user-controllable terminal
  whose Main-issued input admission is current.

The renderer may not send raw executable paths, environment maps, hidden shell
text, PIDs, output digests, source receipts, approval receipts, or provider
credentials.

## Project Environment Snapshot

Main derives one immutable snapshot from current project and host evidence:

```ts
interface ProjectEnvironmentSnapshotV1 {
  snapshot_version: "builder-project-environment-snapshot.v1";
  project_id: string;
  source_tree_digest: string;
  platform: "win32" | "darwin" | "linux";
  architecture: string;
  detected_languages: DetectedLanguage[];
  manifests: ProjectManifestEvidence[];
  toolchains: ToolchainDescriptorV1[];
  task_profiles: ProjectTaskProfileV1[];
  diagnostics_capabilities: DiagnosticsCapability[];
  discovered_at_ms: number;
  expires_at_ms: number;
  snapshot_digest: string;
  authority: "main_project_environment_discovery_v1";
}
```

The renderer and provider receive a bounded projection, not host paths, registry
data, complete environment variables, or probe stdout.

Environment discovery is stale when:

- the source-tree digest changes in a way that affects a manifest or task;
- a relevant manifest, lockfile, tool version, or executable identity changes;
- the snapshot expires;
- the project root changes;
- the selected execution provider changes.

Main revalidates the selected toolchain and task immediately before execution.

## Toolchain Descriptor

```ts
interface ToolchainDescriptorV1 {
  descriptor_version: "builder-toolchain-descriptor.v1";
  toolchain_id: string;
  provider_id: string;
  kind:
    | "node"
    | "python"
    | "go"
    | "rust"
    | "java"
    | "dotnet"
    | "c_compiler"
    | "cpp_compiler"
    | "ruby"
    | "php"
    | "swift"
    | "generic";
  display_name: string;
  executable_identity_digest: string;
  version: string | null;
  availability: "available" | "missing" | "unusable" | "approval_required";
  source: "bundled" | "system" | "version_manager" | "container" | "remote";
  capabilities: string[];
  probe_digest: string;
  observed_at_ms: number;
  authority: "main_toolchain_provider_v1";
}
```

Executable paths are Main-private. Public projections use display name,
version, source class, availability, and capability names.

Probes must be:

- allowlisted per provider;
- non-shell argv invocations;
- read-only by contract;
- bounded by a short timeout and output limit;
- run with credentials removed;
- cached only until their identity or environment expires.

Examples include `node --version`, `python --version`, `go version`, `cargo
--version`, `java -version`, `dotnet --info`, and compiler version probes. These
examples do not authorize renderer or model-selected probe text.

## Project Task Profile

A Project Task is a current, reproducible operation such as test, build, lint,
format, typecheck, run, debug, or dev server.

```ts
interface ProjectTaskProfileV1 {
  profile_version: "builder-project-task-profile.v1";
  task_profile_id: string;
  project_id: string;
  source_tree_digest: string;
  environment_snapshot_digest: string;
  toolchain_id: string;
  kind:
    | "test"
    | "build"
    | "lint"
    | "format"
    | "typecheck"
    | "run"
    | "debug"
    | "dev_server"
    | "custom";
  display: string;
  executable_ref: string;
  argv_digest: string;
  cwd_ref: string;
  discovery_source: string;
  risk_class: ProjectTaskRiskClass;
  interaction: "foreground" | "terminal" | "job" | "dev_server";
  timeout_policy_id: string;
  expected_outputs: string[];
  profile_digest: string;
  authority: "main_project_task_discovery_v1";
}
```

`executable_ref`, argv, cwd, and full discovery evidence remain Main-owned.
The provider sees a bounded task catalog and requests `task_profile_id`.

### Discovery Sources

Initial providers may derive profiles from:

- `package.json` scripts and package-manager lockfiles;
- `pyproject.toml`, `tox.ini`, `noxfile.py`, `pytest.ini`, and supported Python
  environment files;
- `go.mod` and Go package layout;
- `Cargo.toml` and Cargo metadata;
- Maven and Gradle project manifests;
- `*.sln`, `*.csproj`, and .NET SDK metadata;
- `CMakeLists.txt`, CMake presets, Meson files, and recognized compiler/build
  manifests;
- explicit user-declared Builder tasks.

Discovery should use structured parsers where available. It must not execute a
manifest to discover tasks. A project-local extension or script does not become
trusted merely because it appears in a conventional directory.

### Task Classes

Profiles are admitted from one of three classes:

1. `project_declared`: a current manifest or lock-backed task.
2. `provider_inferred`: a deterministic provider command derived from current
   manifest facts, such as a standard test command.
3. `user_declared`: a structured command the user explicitly saved for this
   Project.

The model may propose a one-time structured command only through a separate
high-risk admission. That proposal does not become a durable Project Task until
the user chooses to save it and Main revalidates it.

## Process Admission

```ts
interface ProcessAdmissionV1 {
  admission_version: "builder-process-admission.v1";
  process_admission_id: string;
  project_id: string;
  conversation_id: string;
  turn_id: string;
  run_id: string;
  tool_call_id: string;
  task_profile_id: string;
  source_tree_digest: string;
  environment_snapshot_digest: string;
  toolchain_id: string;
  executable_identity_digest: string;
  argv_digest: string;
  cwd_ref: string;
  environment_policy_id: string;
  timeout_policy_id: string;
  output_policy_id: string;
  risk_class: ProjectTaskRiskClass;
  approval_id: string | null;
  expires_at_ms: number;
  admission_digest: string;
  authority: "main_process_admission_v1";
}
```

The executor accepts the admission, not renderer or model command text. It
resolves the executable and argv from the current Main-owned task profile and
verifies all referenced digests again immediately before spawn.

Default execution uses `shell: false`. A provider that truly requires a shell
must declare `shell_required`, receive a stronger risk class, and pass an
independent approval and sandbox gate. Shell metacharacters in a display string
never authorize shell parsing.

## Risk And Approval

```ts
type ProjectTaskRiskClass =
  | "read_only_probe"
  | "project_check"
  | "project_execution"
  | "project_mutation"
  | "dependency_install"
  | "network_access"
  | "external_path_access"
  | "credential_access"
  | "unknown_execution";
```

Default policy:

| Risk class | Default |
| --- | --- |
| `read_only_probe` | Main allowlist only; no user prompt |
| `project_check` | Project policy or one-shot approval |
| `project_execution` | One-shot approval until a clear Project policy exists |
| `project_mutation` | One-shot approval and workspace guard |
| `dependency_install` | Denied in first universal runtime slice |
| `network_access` | Denied unless a separate network admission exists |
| `external_path_access` | Denied |
| `credential_access` | Denied |
| `unknown_execution` | Denied or explicit developer-mode one-shot approval |

An approval binds one exact task profile, source digest, toolchain identity,
purpose, and expiration. Text such as `yes`, `continue`, or `可以` is not an
approval command.

## Process Result

```ts
interface ProcessResultV1 {
  result_version: "builder-process-result.v1";
  process_id: string;
  process_admission_id: string;
  task_profile_id: string;
  status:
    | "succeeded"
    | "failed"
    | "denied"
    | "timed_out"
    | "cancelled"
    | "interrupted"
    | "output_exceeded"
    | "spawn_failed"
    | "termination_failed";
  exit_code: number | null;
  signal: string | null;
  started_at_ms: number;
  ended_at_ms: number;
  stdout_digest: string;
  stderr_digest: string;
  output_summary: string;
  output_truncated: boolean;
  complete_output_ref: string | null;
  diagnostic_set_id: string | null;
  resulting_workspace_digest: string;
  result_digest: string;
  authority: "main_process_result_v1";
}
```

`complete_output_ref` is a Main-private retained-output locator. The provider
may request bounded pages through a separate read tool. The renderer receives
only a safe inspector command, never an absolute spill path.

Exit code zero is evidence, not proof that the requested user outcome is
correct. Check kind, diagnostics, expected artifacts, Browser evidence, and
working-state reconciliation remain independent.

## Output Streaming And Retention

Borrow Pi's useful interaction pattern while preserving Builder authority:

- stdout and stderr are captured separately;
- validated output activity rearms tool liveness;
- visible updates are coalesced no more often than every 100 ms;
- one stable command row updates in place;
- the public row shows a bounded tail and terminal status;
- complete output may spill to a private file under a Main-owned output root;
- the spill record has a digest, byte count, line count, expiration, and owning
  process identity;
- later reads use offset/count and return a bounded page;
- ANSI control sequences and terminal escape attacks are removed from public
  projections;
- guarded workspace roots, user-home paths, tokens, credentials, and
  secret-like assignments are redacted;
- output limits do not silently convert a still-running process into success.

Required stream facts:

```text
process_started
process_output_updated
process_waiting_for_input | process_progressed
process_completed | process_failed | process_cancelled | process_interrupted
```

`process_output_updated` is replaceable activity, not append-only prose.

## Persistent Terminal

A Terminal is an owner-bound interactive process environment whose state may
survive across tool calls within the active application process.

```ts
interface TerminalSessionV1 {
  session_version: "builder-terminal-session.v1";
  terminal_session_id: string;
  project_id: string;
  owner_run_id: string;
  toolchain_id: string | null;
  cwd_ref: string;
  generation: number;
  state:
    | "starting"
    | "ready"
    | "running"
    | "waiting_for_input"
    | "stopping"
    | "stopped"
    | "failed"
    | "interrupted";
  retained_output_head: number;
  retained_output_tail: number;
  active_job_id: string | null;
  opened_at_ms: number;
  terminal_digest: string;
  authority: "main_terminal_runtime_v1";
}
```

Minimum operations:

```text
terminal_open
terminal_list
terminal_send
terminal_read
terminal_resize
terminal_signal
terminal_close
```

Rules:

- `terminal_send` is bound to a current terminal generation and input
  admission;
- model input and visible user input are distinguishable facts;
- control characters use an explicit key/signal vocabulary;
- hidden password prompts pause for user takeover and do not echo or enter
  provider context;
- terminal output uses bounded offset paging;
- a terminal cannot change Project root;
- one Agent cannot read or send to another Agent's terminal;
- app shutdown closes every owned terminal and process tree;
- restart marks unclosed sessions `interrupted`; it does not reconnect by PID;
- persistent PowerShell or REPL state is process-local unless a later durable
  terminal provider has a separately reviewed resume contract.

## Managed Jobs And Development Servers

A Job is a long-lived process whose output and stop authority remain available
after the initiating tool call returns.

```ts
interface ManagedJobV1 {
  job_version: "builder-managed-job.v1";
  job_id: string;
  project_id: string;
  owner_run_id: string;
  process_admission_id: string;
  kind: "background_command" | "dev_server" | "watcher" | "debug_adapter";
  state: "starting" | "running" | "stopping" | "stopped" | "failed" | "interrupted";
  endpoint_ref: string | null;
  output_head: number;
  output_tail: number;
  started_at_ms: number;
  job_digest: string;
  authority: "main_job_runtime_v1";
}
```

Minimum operations:

```text
job_list
job_read
job_stop
```

A `dev_server` additionally requires:

- an admitted `dev_server` task profile;
- Main-selected `127.0.0.1` and ephemeral port;
- a provider-specific trusted port injection mechanism;
- readiness probes owned by Main;
- no public bind host;
- endpoint exposure only as a bounded local origin action;
- Browser session binding;
- shutdown cleanup before application exit completes.

Jobs do not survive application restart in v1. Durable records explain the
interruption and prove cleanup; they do not imply a live process still exists.

## Structured Diagnostics

```ts
interface DiagnosticV1 {
  diagnostic_version: "builder-diagnostic.v1";
  diagnostic_id: string;
  project_id: string;
  source_kind: "process_parser" | "language_server" | "browser_console" | "browser_network";
  source_id: string;
  path: string | null;
  range: {
    start_line: number;
    start_character: number;
    end_line: number;
    end_character: number;
  } | null;
  severity: "error" | "warning" | "information" | "hint";
  code: string | null;
  source: string;
  message: string;
  related_count: number;
  diagnostic_digest: string;
  authority: "main_diagnostic_normalizer_v1";
}
```

Diagnostics are facts only when produced by an admitted process, LSP, or
Browser authority. The model saying that a line has an error creates no
diagnostic.

Normalization must:

- bind relative paths to the admitted Project;
- reject path traversal and external paths;
- cap message, related-location, and diagnostic counts;
- remove ANSI and control characters;
- retain the source parser/provider identity;
- distinguish parser confidence from LSP authority;
- deduplicate only identical source-bound diagnostics;
- preserve multiple tools disagreeing about the same line.

The UI should open a diagnostic at its file and range, while the Conversation
shows a compact count and the relevant failing command.

## Language Server Provider

The model-facing LSP schema remains stable while providers vary.

```ts
interface LanguageServerDescriptorV1 {
  descriptor_version: "builder-language-server-descriptor.v1";
  language_server_id: string;
  provider_id: string;
  languages: string[];
  availability: "available" | "missing" | "starting" | "ready" | "failed";
  capabilities: Array<
    | "definition"
    | "references"
    | "implementation"
    | "hover"
    | "document_symbols"
    | "diagnostics"
    | "code_actions"
  >;
  toolchain_id: string | null;
  authority: "main_language_server_provider_v1";
}
```

Model-facing operation:

```ts
interface LanguageQueryV1 {
  operation:
    | "definition"
    | "references"
    | "implementation"
    | "hover"
    | "document_symbols"
    | "diagnostics"
    | "code_actions";
  file_path: string;
  line?: number;
  character?: number;
}
```

Rules:

- coordinates are one-based UTF-16 unless the versioned contract states
  otherwise;
- Main owns server process, root, initialization options, document versions,
  cancellation, output, and shutdown;
- a query cannot open or mutate an external file;
- code actions are proposals, not direct writes;
- edits from a code action re-enter the normal read-before-edit and workspace
  guard pipeline;
- missing providers return `language_server_unavailable`, not an absent schema;
- language-server installation is outside the first G4 gate.

## Tool Broker Evolution

The Builder Harness broker should expose a stable, bounded vocabulary:

```text
read
grep
edit
write
project_environment
project_tasks
run_task
terminal_open / terminal_send / terminal_read / terminal_close
job_list / job_read / job_stop
diagnostics
lsp
```

The exact wire names may preserve compatibility with Harness-native names, but
every call re-enters Builder's tool-call, permission, execution, and result
pipeline.

Do not simply enable Harness `toolBash`, `toolJobs`, or an LSP provider in the
Cordis profile. That would grant the Harness process authority the current
Builder architecture intentionally withholds. Harness-native semantics may be
adapted behind Builder-owned tools after their product contracts exist.

## Repair Loop

A failed task result returns to the same admitted programming Turn with:

- task identity and display;
- terminal status, exit code, and duration;
- bounded stdout/stderr tail;
- structured diagnostics;
- complete-output page capability when needed;
- current workspace digest;
- explicit timeout, cancellation, denial, or infrastructure classification.

The runtime may read, edit, and rerun. Each rerun has a new process admission
and result but remains related to the same user objective. The UI should group a
coherent fail-repair-pass sequence without hiding the failed attempt.

The repair loop stops when:

- the relevant check passes and the requested outcome is otherwise verified;
- the user cancels;
- permission is denied;
- the runtime reaches its independent loop or token budget;
- the process or runtime is genuinely stalled;
- a missing dependency/toolchain requires user action;
- workspace drift invalidates the candidate and requires re-read/reconciliation.

## Checkpoint And Workspace Reconciliation

Process, Terminal, Job, LSP, and Browser capabilities never save a Version.

After every trusted mutating boundary:

1. Main records the current candidate workspace snapshot.
2. Main verifies source-tree and external-change guards.
3. A successful or interrupted mutating Run projects a recoverable candidate.
4. Builder records an automatic checkpoint with truthful check status.
5. Continue, Review, and Undo remain available without Save Version.

Commands may mutate the guarded candidate workspace. Such mutations are not
accepted merely because the process exits. Main must compare before/after trees,
reject external paths and unsupported file types, and reconcile accepted files
through the same candidate projector used for model edits.

An interrupted command may yield a recoverable unchecked checkpoint when Main
has a trusted changed snapshot. Builder must not claim checks passed after the
checking runtime was terminated.

## Cancellation And Cleanup

Cancellation order:

```text
reject new capability calls
-> cancel pending approvals and questions
-> stop Browser actions bound to the Run
-> signal active foreground work
-> stop owned jobs and terminals when policy requires
-> terminate process trees after the grace boundary
-> drain and finalize bounded output
-> close LSP documents and processes
-> reconcile trusted changed workspace
-> settle every open tool result exactly once
-> append run_cancelled or run_interrupted
```

Separate terminal/job ownership policies may allow a user-visible development
server to remain after one model Turn ends. It still cannot outlive Project
close or application shutdown unless a later durable service contract says so.

No completion is reported until owned process-tree cleanup succeeds or a
truthful `termination_failed` result is recorded.

## Restart Recovery

On application start, Main:

- marks unclosed foreground processes, terminals, jobs, LSP servers, and Browser
  actions interrupted;
- cleans only known guarded workspaces and partitions under verified roots;
- does not kill or reconnect to a PID from a prior process;
- restores durable output summaries and activity identity without presenting
  stale work as running;
- restores recoverable source checkpoints independently of runtime processes;
- permits continuation through a new runtime/session admission;
- preserves Undo and Version history.

Future true runtime resume must bind the Harness session log to Builder's Task
Address and reconcile it with SQLite. It is not implied by restoring the public
Conversation projection.

## Environment And Dependency Policy

Default child environment is an explicit allowlist containing only values
needed for the admitted toolchain and stable non-secret process behavior.

Remove by default:

- provider keys and base URLs;
- application bridge tokens;
- browser cookies and profile paths;
- Git credentials and credential-helper overrides;
- cloud credentials;
- secret-like custom environment variables;
- unrelated user-session variables.

Package installation is a separate capability because it can execute lifecycle
scripts, mutate lockfiles, access networks, and change future execution. G2-G4
may report missing dependencies and propose an installation plan, but they do
not authorize automatic install.

## Public Presentation

Conversation owns the readable work narrative. Side Workspace owns detailed
inspection.

Conversation:

- one row per process/task with stable identity;
- live status and bounded output preview;
- failed diagnostic count and relevant first errors;
- repair/rerun relationship;
- final human-readable outcome;
- no duplicate terminal transcript.

Terminal inspector:

- complete retained pages subject to output policy;
- stdout/stderr or PTY stream;
- task, cwd display, duration, exit/signal, and truncation;
- user input only when the active Terminal contract permits it;
- no arbitrary command field in a read-only result inspector.

Diagnostics inspector:

- grouped by file and severity;
- click-to-open source;
- source provider and command relationship;
- stale state when source generation changes.

## Initial Provider Qualification

| Ecosystem | Discovery baseline | Task baseline | Diagnostics baseline |
| --- | --- | --- | --- |
| JS/TS | `package.json`, lockfile | package scripts | TypeScript, ESLint, test output |
| Python | `pyproject.toml` and supported test config | user/project task, pytest when verified | Python traceback, pytest; LSP provider later |
| Go | `go.mod` | `go test`, `go build` profiles | Go compiler/test; gopls provider later |
| Rust | `Cargo.toml` | Cargo check/test/build | rustc/Cargo; rust-analyzer later |
| Java | Maven/Gradle manifests | wrapper or verified system task | compiler/test; Java LSP later |
| C/C++ | CMake/Meson/build manifest | configured build/test profile | compiler/CMake; clangd later |
| C# | solution/project manifests | dotnet build/test/run | compiler/test; C# LSP later |
| Other | explicit manifest evidence | user-declared structured task | generic process parser or unavailable |

This table is a qualification plan, not a guarantee that the listed toolchain
is installed on the user's computer.

## Non-Goals

G2-G4 do not authorize:

- shipping every compiler or SDK;
- automatic dependency, SDK, or language-server installation;
- unrestricted host shell access;
- process execution outside the admitted Project or managed runtime;
- inherited user credentials;
- arbitrary container or remote host access;
- kernel debugging;
- cross-Project terminal sharing;
- PID adoption after restart;
- public third-party execution providers;
- background autonomous work without an owning Task and stop authority.

## Acceptance Criteria

This contract is implemented only when:

1. No execution occurs from renderer/model command text without a current Main
   admission.
2. Project Environment, Toolchain, Project Task, Process, Terminal, Job,
   Diagnostics, and LSP identities are versioned and digest-bound.
3. JS/TS, Python, and at least two compiled-language packaged fixtures complete
   fail-repair-pass journeys.
4. A generic user-declared task works for an unqualified language without a new
   programming-runtime protocol.
5. Missing toolchains and dependencies are visible and non-mutating.
6. Output streams in one stable row, truncates safely, and can be inspected in
   bounded pages.
7. Cancellation and application shutdown terminate all owned process trees.
8. Restart restores no false running process, terminal, job, or LSP state.
9. Diagnostics open the correct admitted file/range and cannot escape the
   Project.
10. Code-action edits re-enter normal edit and checkpoint authority.
11. Checkpoint, Continue, Review, Undo, and optional Version behavior remain
    correct after command mutations and interruptions.
12. The packaged acceptance matrix records current evidence for every qualified
    provider.
