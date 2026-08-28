# Controlled Bash V1 Architecture

Date: 2026-08-23

Status: implementation authority; the owner accepted the bounded package-script
risk on 2026-08-23. Process execution remains disabled until the structured
one-shot approval, executor, cancellation, cleanup, and packaged gates below
are implemented and verified.

## Objective

Controlled Bash V1 lets a Project Build run execute a small set of
Project-declared development commands without turning Builder into an
unrestricted terminal. It must preserve the DeepSeek Harness tool-loop
experience while keeping Project identity, permission, process, output,
cancellation, checkpoint, and public evidence authority in Builder Main.

The user journey is:

```text
user requests a Project change
-> Harness inspects and edits through Builder tools
-> Harness proposes a known Project command
-> Builder shows the exact command and risk
-> user allows this command once or denies it
-> Builder runs the digest-bound script in the admitted workspace
-> one command row updates from running to terminal
-> Harness sees the structured result and may repair
-> Builder records the final check and Chinese handoff
```

## Harness Alignment

The bundled Harness provides the correct interaction vocabulary:

- `dsh-tool-bash` exposes a model-facing command tool;
- `ctx.userQuestions` pauses a tool call until the human answers;
- foreground results distinguish stdout, stderr, timeout, signal, exit code,
  truncation, and infrastructure failure;
- background processes become Jobs and are controlled by `job_output`,
  `job_list`, and `job_kill`;
- tool presentations own the command card rather than adding command prose to
  the assistant message.

Builder must preserve these semantics, but it cannot directly compose
`dsh-bash-local` in the Windows desktop runtime. The pinned provider explicitly
states that it is POSIX-only, hardcodes `bash -c`, and relies on POSIX process
group behavior. Enabling `agent-spine.toolBash` on Windows would also execute
with Harness-process authority instead of Builder's Project, permission, and
checkpoint authority.

### Windows Runtime Root Identity

Builder Main must canonicalize its private Harness session root before it
constructs the controlled command runtime. Windows can supply the same user-data
directory through an 8.3 short path while `realpath` returns the expanded path.
Comparing those two spellings as raw strings incorrectly reports a directory
replacement and can make default Harness composition fall back to the legacy
structured runtime.

The root is therefore created first, rejected unless it is a real directory and
not a symbolic link, resolved through native `realpath`, and only then passed to
the executor. `builder-harness-runtime-composition.test.cjs` must initialize the
default controlled command runtime through this path; packaged Harness gates
must additionally report `deepseek_harness.v1`, so a silent fallback cannot pass.

V1 therefore uses a Builder-owned executor behind a Harness-native tool
definition and presentation. The public tool name remains `bash` so Harness
events normalize into Builder's existing `command` tool kind. Its V1 schema is
narrower than unrestricted Harness Bash:

```ts
interface ControlledBashCall {
  command: string;       // must exactly match a current CommandProfile display
  description: string;   // bounded user-visible active-voice label
}
```

`workdir`, arbitrary environment, stdin, shell selection,
`sandbox_permissions`, and `run_in_background` are not model-controlled in V1.

## Command Scope

V1 accepts only current `package.json` scripts discovered by Project
Understanding:

- `npm test` / equivalent package-manager test command;
- `npm run lint`;
- `npm run typecheck`;
- `npm run build`.

Each command is bound to:

```text
project_id
conversation_id
turn_id
run_id
source_tree_digest
command_profile_id
command_kind
command_display
script_digest
package_manager
cwd = "."
```

The executor rereads the current mutable source snapshot immediately before
admission. It recomputes Project Understanding and rejects a command when the
manifest, lifecycle script, source tree, command display, or script digest has
changed. The model cannot supply a script body, executable path, absolute cwd,
port, or environment.

The following remain denied:

- arbitrary shell text and command chaining outside a known profile;
- dependency installation;
- package-manager lifecycle scripts not included in the bound profile;
- delete, publish, Git push, credential access, and external-directory work;
- persistent or background execution;
- renderer-supplied command, path, URL, environment, or port.

## Risk And Approval

A known package script is not intrinsically safe. Its body can invoke another
program, mutate files, or access the network. Windows currently has no shipped
Builder sandbox that can prove filesystem and network containment.

Therefore every V1 call requires a fresh one-shot `process.spawn` approval.
The approval UI must show:

- exact safe `command_display`;
- Project name;
- purpose/description;
- source snapshot status;
- `This project script may modify files or use the network`;
- `Allow once` and `Deny` commands.

Typing ordinary chat text must not accidentally grant execution. Approval is a
structured main-owned command, not an LLM interpretation of words such as
`yes`, `continue`, or `可以`. The permission is bound to one command profile
and one source-tree digest, expires within five minutes, and is consumed at
most once.

The user may later grant a Project policy for a narrower repeatable class, but
that is outside V1. Renderer selection never creates a durable permission fact
without Main validation.

## Process Boundary

Main materializes the current source snapshot into a newly created guarded
command workspace. The process receives:

- a digest-verifying packaged script worker;
- no shell-selected executable from the model;
- `shell: false` at the outer spawn boundary;
- a minimal environment with colors and pagers disabled;
- no DeepSeek key, provider URL, application token, or inherited secret;
- a two-minute default foreground timeout;
- bounded stdout and stderr capture;
- process-tree termination on cancellation, timeout, output overflow, window
  close, runtime disposal, or application shutdown.

The packaged worker verifies the script digest again before invoking the
manifest script. A process result is not trusted merely because the child exits
zero; it must remain bound to the admitted command and source snapshot.

Candidate-workspace execution is deliberate. It prevents a check from
silently materializing partial Harness edits into the user's source folder.
Because dependencies are not installed automatically, a command that requires
missing `node_modules` fails with evidence and may lead to a separate future
install approval.

## Output Contract

Foreground execution produces one structured result:

```ts
interface ControlledCommandResult {
  status:
    | "passed"
    | "failed"
    | "denied"
    | "timed_out"
    | "cancelled"
    | "output_exceeded"
    | "spawn_failed"
    | "termination_failed";
  commandKind: "lint" | "typecheck" | "test" | "build";
  commandDisplay: string;
  sourceTreeDigest: string;
  exitCode: number | null;
  durationMs: number;
  stdoutDigest: string;
  stderrDigest: string;
  stdoutPreview: string;
  stderrPreview: string;
  outputTruncated: boolean;
}
```

Main keeps bounded raw capture only for the active result inspector. The public
Conversation stores digests, counts, status, command display, duration, exit
code, truncation, and a redacted bounded preview. It must remove ANSI control
sequences, replace the guarded workspace path with `<project>`, and redact
secret-like assignments. DeepSeek receives only the admitted bounded result.

Command output updates are coalesced to at most one public update per 100 ms.
The same command row reserves stable dimensions and changes state in place:

```text
Running npm test
-> Ran npm test       exit 0, 1.4 s
```

or:

```text
Running npm test
-> Could not finish npm test       exit 1, 1.4 s
```

The terminal inspector is read-only. It cannot submit commands or expose a
general PTY.

## Cancellation And Recovery

Cancellation is complete only after the process tree is terminated or a
bounded `termination_failed` fact is recorded. The sequence is:

```text
reject new command calls
-> abort pending approval
-> terminate active process tree
-> drain bounded output
-> remove guarded command workspace
-> settle the tool result
-> reconcile Harness source changes
-> append run_cancelled
```

Active command metadata is persisted before spawn. On application startup,
Builder marks every unclosed prior command as interrupted and performs guarded
cleanup. It never attempts to reconnect to or trust an unknown surviving PID;
Windows PID reuse makes PID-only recovery unsafe. Main may kill only a process
still held by the current in-memory process registry. Guarded stale workspace
cleanup requires the known root and directory-name prefix.

## Development Server Boundary

Development servers are not foreground Bash. They are the first Jobs slice and
reuse the existing `builder-live-preview-dev-server-*.v1` admission contracts.
The minimum lifecycle is:

```text
discover package.json scripts.dev
-> bind script digest and current preview source admission
-> explicit start approval
-> Main chooses 127.0.0.1 and an ephemeral port
-> spawn managed process
-> health-check the owned loopback origin
-> attach the existing isolated Preview WebContentsView
-> show running state and local address action
-> Stop terminates process tree and disposes the view
```

The model and renderer cannot choose a public bind host. The command must bind
to `127.0.0.1`; `0.0.0.0`, external navigation, downloads, popups, and private
network requests remain denied. Starting a dev server does not authorize
installing missing dependencies.

Only the owned loopback address is exposed as a clickable action. It is not
copied into durable provider context. App shutdown must stop every active dev
server before completion. Restart proves no process, loopback listener,
WebContents, or stale running projection is restored.

## Implementation Slices

### B1: Contract And Approval

- add controlled command profile, approval, admission, and result contracts;
- add a structured renderer approval command;
- bind `process.spawn` permission to one Project command and source digest;
- prove denial, expiry, replay, drift, and renderer-forgery failures.

### B2: Foreground Executor

- add guarded candidate materialization;
- run the existing digest-verifying packaged script worker;
- add bounded output, timeout, process-tree cancellation, and cleanup;
- prove environment credential removal and absolute-path redaction.

### B3: Harness Tool Bridge

- register Builder's constrained `bash` tool in the existing broker plugin;
- keep Harness `agent-spine.toolBash: false` on Windows;
- add command to the Build run's allowed tools;
- map native call/result presentations to one command row;
- preserve Ask and Plan as command-free modes.

### B4: Terminal Inspector And Streaming

- persist command lifecycle facts in SQLite;
- coalesce bounded output updates;
- add a read-only Terminal inspector tab;
- prove refresh/restart replay without duplicate or flickering rows.

### B5: Dev Server Job

- implement the existing dev-server admission runtime;
- choose loopback port in Main and inject it through a trusted worker contract;
- add start, health, address discovery, stop, and shutdown cleanup;
- integrate with the isolated Live Preview browser.

### B6: Packaged And Real DeepSeek Gates

- run a failed command, model repair, and passing rerun;
- deny an unapproved command without spawning;
- cancel a long foreground command and prove child cleanup;
- start and stop a dev server and prove owned loopback discovery;
- close and relaunch the application and prove cleanup;
- verify Chinese progress and one final post-command handoff;
- verify no credential, absolute path, raw approval token, or unrestricted
  command enters public canary evidence.

## Completion Gate

Controlled Bash V1 is complete only when all of these are true:

1. No command runs without a consumed one-shot Main approval.
2. The admitted command exactly matches a current digest-bound profile.
3. Ask and Plan cannot execute commands.
4. Output, exit code, timeout, cancellation, and process-tree settlement are
   visible and restart-safe.
5. A failed command can feed a bounded result back to Harness for repair.
6. A dev server can start only on an owned loopback address and can always be
   stopped from the Project UI.
7. App shutdown and restart leave no owned process, listener, view, or false
   running state.
8. A real saved-profile DeepSeek packaged journey reaches a Chinese final
   summary after command evidence and explains how to run the result.

Jobs and Goals remain disabled until this gate passes. Foreground command
settlement supplies the process ownership and result attribution that Jobs
needs; durable Goals then build on supervised Jobs rather than bypassing them.
