# Universal Programming And Browser Loop Roadmap

Date: 2026-08-25

Status: active next-stage implementation authority

## Authority And Relationship

This document owns the delivery order and progress state for Builder's next
product stage:

```text
language-independent programming
-> real process and terminal execution
-> diagnostics and repair
-> browser observation and interaction
-> packaged, recoverable user closure
```

It does not replace the completed foundational coding-loop contracts. The
following documents remain authoritative for their existing domains:

- [Foundational Coding Loop And Plugin Runtime Roadmap](FOUNDATIONAL_CODING_LOOP_PLUGIN_RUNTIME_ROADMAP.md)
  owns the established read, edit, check, checkpoint, continuation, and Undo
  product loop.
- [Programming Runtime Adapter And Event Protocol](PROGRAMMING_RUNTIME_ADAPTER_EVENT_PROTOCOL.md)
  owns the current `builder-programming-runtime.v1` event boundary.
- [Programming Runtime Timeout And Liveness Policy](PROGRAMMING_RUNTIME_TIMEOUT_AND_LIVENESS_POLICY.md)
  owns the separation of provider, runtime, tool, user-wait, and cancellation
  time boundaries.
- [Controlled Bash V1 Architecture](CONTROLLED_BASH_V1_ARCHITECTURE.md) owns
  the shipped package-script command boundary.
- [Live Preview Browser Architecture](LIVE_PREVIEW_BROWSER_ARCHITECTURE.md)
  owns source-bound Project Preview.
- [General Browser Web Mode Architecture](GENERAL_BROWSER_WEB_MODE_ARCHITECTURE.md)
  owns Browser session, observation, action, and browsing-data policy.

Where an older roadmap describes universal programming, interactive terminal,
or general Browser work as a future candidate, this roadmap owns the current
order and acceptance state. It does not retroactively change an implemented
fact or authorize a capability before its gate is accepted.

The detailed next-stage contracts are:

- [Universal Programming Runtime Contract](UNIVERSAL_PROGRAMMING_RUNTIME_CONTRACT.md);
- [Builder Event And Projection Foundation Architecture](BUILDER_EVENT_PROJECTION_FOUNDATION_ARCHITECTURE_2026_08_25.md);
- [Builder Current Event And Projection Architecture Audit](BUILDER_CURRENT_EVENT_PROJECTION_ARCHITECTURE_AUDIT_2026_08_25.md);
- [Mature Coding Desktop Architecture Research](MATURE_CODING_DESKTOP_ARCHITECTURE_RESEARCH_2026_08_25.md);
- [Harness Runtime Upgrade And Rollback Policy](HARNESS_RUNTIME_UPGRADE_AND_ROLLBACK_POLICY.md);
- [Universal Programming And Browser Acceptance Matrix](UNIVERSAL_PROGRAMMING_AND_BROWSER_ACCEPTANCE_MATRIX.md);
- [DeepSeek Harness And Pi Adoption Decisions - 2026-08-25](DEEPSEEK_HARNESS_AND_PI_ADOPTION_DECISIONS_2026_08_25.md);
- [Builder Chat And Generation Performance Plan](BUILDER_CHAT_GENERATION_PERFORMANCE_PLAN.md);
- [Builder A0.7 Behavioral Performance Gate - 2026-08-26](BUILDER_A07_BEHAVIORAL_PERFORMANCE_GATE_2026_08_26.md).

## Objective

An ordinary user should be able to open a local project in any language for
which an admitted toolchain is available, ask Builder to make a change, and see
one truthful loop:

```text
inspect project and installed toolchains
-> read and edit through guarded project tools
-> run the relevant command or persistent development process
-> stream bounded output into one stable activity row
-> map failures to files and diagnostics
-> repair and rerun
-> use an isolated browser when the work has a web surface
-> record a recoverable checkpoint
-> continue, inspect, Undo, or save a Version
```

"Any language" is a capability model, not a claim that every compiler ships in
the installer. Builder must be language-independent. A language is runnable
when its required local, remote, or managed toolchain provider proves it is
available for the admitted project. Missing toolchains produce a structured
readiness result rather than a fabricated failure or silent package install.

## Current Baseline

The following are implemented facts at the start of this roadmap:

- the packaged application selects the pinned DeepSeek Harness runtime for
  compatible Build work;
- Harness can perform multi-step read, search, edit, write, check, repair, and
  final-response loops through Builder-owned tools;
- Builder owns project identity, workspace admission, permissions, process
  execution, checks, candidate projection, checkpoints, Undo, Versions, and
  renderer-safe event projection;
- command execution is limited to digest-bound JavaScript package scripts;
- command output is a read-only Terminal inspector, not an interactive terminal;
- dynamic Preview can start an admitted JavaScript package `dev` script on an
  owned loopback port;
- Preview uses an isolated `WebContentsView`, blocks external navigation,
  network, permissions, downloads, and new windows, and destroys its partition
  on stop;
- Harness Jobs, Goals, native Bash, persistent session resume, and steering are
  disabled in the Builder profile;
- `playwright-core` is development-only packaged-canary infrastructure, not a
  product Browser automation runtime;
- the bundled Harness identity is pinned to `0.1.0-rc.5` and is not updated from
  GitHub at application runtime.

This baseline is useful but does not qualify universal programming or a built-in
Browser. It proves the control plane on which those capabilities can be added.

## Product Decisions

### 1. Builder Owns Capabilities; Harness Owns The Agent Loop

DeepSeek Harness remains the first programming-loop engine. It may request and
sequence capabilities, but it does not receive direct desktop authority.

Builder Main owns:

- workspace and source identity;
- toolchain discovery receipts;
- executable and process selection;
- command, terminal, job, and browser admission;
- environment and credential filtering;
- output capture and redaction;
- process-tree and Browser lifecycle;
- checkpoints, Undo, Review, and Versions;
- durable public facts and packaged evidence.

Harness owns:

- model request sequencing;
- Turn and Step continuation;
- model-visible tool planning;
- tool-result feedback and repair decisions;
- private provider state inside one admitted runtime session.

Pi is a design reference for a small language-independent loop, streaming tool
updates, queued steering, RPC embedding, and extensible presentation. Pi is not
the desktop permission authority and is not embedded as a second product
kernel.

### 2. Universal Support Comes From Providers, Not Language Branches

Do not add one execution service per language to the generation layer. Define
stable capabilities and register providers behind them:

```text
ProjectEnvironment
Toolchain
Process
Terminal
Job
Diagnostics
LanguageServer
BrowserSession
```

JavaScript, Python, Go, Rust, Java, C, C++, C#, Ruby, PHP, Swift, Kotlin, and
future languages use the same admission, execution, output, and recovery facts.
Language-specific code belongs in bounded discovery rules or replaceable
providers.

### 3. Browser Is Part Of The Programming Loop

Browser is not a decorative preview tab. For web work, it closes the same
programming loop:

```text
start an owned server
-> navigate an isolated Agent Test Browser
-> observe accessibility/DOM, console, network, and pixels
-> interact
-> feed structured failures back to the same programming run
-> repair and repeat
```

Project Preview, Agent Test Browser, and User Browser may share presentation
components. They must not share profile data, permissions, evidence identity,
or provider-context authority.

### 4. No Silent Runtime Self-Modification

The application may discover a newer Harness release. It may not download and
activate that release as unreviewed executable code in the active installation.
Every candidate is staged, identified, compatibility-tested, packaged-canary
qualified, and atomically activated with rollback evidence.

### 5. Progress Is Gate-Based

Progress is not a percentage. A gate is `Not started`, `In progress`, `Blocked`,
or `Accepted`.

A gate is `Accepted` only when:

1. its contract exists;
2. authority and negative boundaries have tests;
3. implementation facts exist in Main;
4. renderer projection is bounded and truthful;
5. required packaged canaries pass against the current package;
6. recovery and cleanup are proven;
7. the evidence is linked from the acceptance matrix.

## Delivery Gates

| Gate | Outcome | Status | Depends on |
| --- | --- | --- | --- |
| `G0` | Current-state audit, authority documents, adoption decisions, and acceptance matrix | `Accepted` | Foundational coding loop |
| `A0` | Live/semantic/projection plane separation, incremental append/read models, schema compatibility, renderer/Browser isolation foundation, and measured Main cold-path attribution | `In progress` (`A0.6c` packaged attribution accepted; `A0.7` behavioral performance in progress) | `G0` |
| `G1` | Staged Harness candidate discovery, compatibility qualification, atomic activation, and rollback | `Not started` | `A0` |
| `G2` | Language-independent foreground Process capability and structured command profiles | `Not started` | `A0`; current Controlled Bash |
| `G3` | Persistent Terminal and managed Job lifecycle with streaming, input, signals, stop, restart reconciliation, and cleanup | `Not started` | `G2` |
| `G4` | Toolchain and Project Task discovery plus diagnostics and Language Server providers | `Not started` | `G2` |
| `G5` | Browser shell and isolated Agent Test Browser observation/action runtime | `In progress` (`I1` focused implementation passed; packaged real-model RC pending) | `G2`; existing Preview runtime |
| `G6` | End-to-end multi-language repair and web interaction closure in the packaged app | `Not started` | `G3`, `G4`, `G5` |
| `G7` | Windows RC qualification, update rollback drill, residual-risk audit, and user-ready release | `Not started` | `G1`, `G6` |

`G0` is accepted by the documentation set dated 2026-08-25. Repository audit,
focused scaling probes, and mature-project research subsequently established
`A0` as a prerequisite implementation gate. Typed live/durable refresh
isolation, incremental replay/projection, cursor delivery, renderer isolation,
packaged long-stream/output-burst qualification, terminal-settle attribution,
Main cold-path attribution, and Harness runtime/JSON-RPC attribution are now
accepted. A0.7 behavioral performance work is in progress: dependency readiness
must distinguish project-local dependencies from host-machine availability,
command approval consume no longer rebuilds project understanding for an
already-approved profile, and a larger runtime-event batch experiment was
rejected because packaged stress showed worse flush spikes. Runtime/durable
settlement still needs a structural fix before Browser or broader Terminal
runtime expansion. No G1-G7 runtime capability is claimed by this decision.

## Gate Specifications

### A0: Event And Projection Foundation

Deliver the live stream, semantic ledger, and materialized projection planes
defined by the
[foundation architecture](BUILDER_EVENT_PROJECTION_FOUNDATION_ARCHITECTURE_2026_08_25.md).
Complete redacted baselines, historical schema fixtures, typed changes,
incremental cursor projection, lazy evidence, renderer store isolation, copied-
database dual-read verification, and rollback before capability growth.

Exit: all `ARCH-*` cases and the applicable `PERF-*` foundation cases pass in a
packaged build. Universal Process/Terminal and Browser implementation do not
start on the legacy full-replay-per-delta path.

### G1: Harness Runtime Lifecycle

Deliver:

- an upstream candidate descriptor separate from the active runtime manifest;
- explicit release channel and candidate-selection policy;
- source, commit, version, license, archive hash, entrypoint, and dependency
  receipts;
- JSON-RPC identity and protocol capability probes;
- migration tests against copied temporary session data;
- deterministic and real-provider compatibility canaries;
- versioned install directories, an atomic active pointer, and last-known-good
  rollback;
- Settings UI that reports current, candidate, testing, ready, failed, active,
  and rolled-back states without exposing internal paths or tokens.

Do not activate a candidate merely because its semantic version is newer.

### G2: Universal Foreground Process

Deliver:

- `ProjectEnvironmentSnapshot` and `ToolchainDescriptor` facts;
- structured executable plus argv invocation, with no implicit shell parsing;
- project task profiles for discovered and user-declared commands;
- exact cwd, environment policy, timeout, output, and risk classification;
- one-shot approval for mutating, networked, install, unknown, or user-defined
  execution classes;
- process-tree cancellation and cleanup;
- stable streaming command activity and complete-output spill evidence;
- automatic failed-check feedback to the same Harness Turn.

Do not broaden the current `bash` wire schema into arbitrary unreviewed shell
authority.

### G3: Persistent Terminal And Jobs

Deliver:

- owner-bound terminal open, list, send, read, resize, signal, and close facts;
- an explicit distinction between foreground command, interactive terminal,
  background job, and development server;
- bounded retained output with offsets and terminal generation identity;
- stdin-wait and prompt-ready states;
- application-close cleanup and restart interruption reconciliation;
- no PID-only adoption after restart;
- visible stop and manual takeover controls;
- no cross-Project or cross-Agent terminal sharing.

### G4: Toolchains, Tasks, Diagnostics, And LSP

Deliver:

- deterministic manifest and lockfile detectors;
- safe executable probes owned by Main;
- first qualification providers for JS/TS, Python, Go, Rust, Java, C/C++, and
  C#;
- a generic user-declared task fallback for other languages;
- structured diagnostics with path, range, severity, code, source, and message;
- Language Server provider selection behind one stable tool schema;
- definition, references, implementation, hover, document symbols,
  diagnostics, and code-action discovery;
- missing-toolchain and missing-LSP readiness states with no automatic install.

### G5: Browser Loop

Deliver:

- three separate session classes: Project Preview, Agent Test, and User Web;
- Agent Test navigation bound to an owned loopback origin by default;
- screenshot, nonblank pixels, accessibility tree, bounded DOM summary,
  console summary, network summary, and selected-element references;
- click, type, key, scroll, select, wait, reload, viewport, and tab actions;
- before/after observation digests for every action;
- explicit approval for external origins, uploads, downloads, credentials,
  account changes, payments, and destructive actions;
- no User Browser cookie or storage access from Agent Test;
- stop, crash, restart, and orphan cleanup canaries.

### G6: Integrated Product Closure

Run the acceptance matrix against real fixture projects. At minimum:

- a Python failure is diagnosed, repaired, and rerun;
- a compiled-language failure is diagnosed, repaired, and rerun;
- an interactive or long-running process is stopped cleanly;
- a web project starts on an owned loopback address;
- Browser finds a DOM, console, network, or visual defect;
- the same programming run repairs it and Browser verifies the result;
- checkpoint, Undo, continuation, restart, and optional Version remain correct;
- no duplicate activity, raw credential, absolute private path, or hidden
  browser data reaches the public Conversation.
- live provider/process/browser deltas do not trigger a complete task-stream
  read/replay/projection or unrelated BuilderPage/Side Workspace render;
- the measured `PERF-*` budgets pass for short active logs, 10,000 historical
  facts across segments/checkpoints, large command output, and Browser-open
  generation.

### G7: Release Qualification

Deliver:

- a current Windows package and installer;
- full release gate plus the universal acceptance matrix;
- a Harness candidate activation and forced rollback drill;
- process, terminal, server, Browser, and runtime cleanup evidence;
- current-version, last-known-good, and rollback support receipts;
- an explicit residual-risk report.

## Workstream Order

The default order is:

```text
A0 event/projection foundation
-> G1 runtime lifecycle
-> G2 foreground process
-> G3 terminal/jobs
-> G4 toolchains/diagnostics/LSP
-> G5 browser
-> G6 integrated journeys
-> G7 release
```

`G5` contract and pure Main tests may proceed after `G2` while `G3` and `G4`
continue, but Browser runtime activation must reuse the owned process and dev
server lifecycle rather than creating a second process authority.

## Progress Ledger Rules

Every implementation change updates this document in the same change set:

- move only the active gate to `In progress`;
- link its implementation-gate or evidence document;
- list the exact focused tests and packaged canaries that passed;
- record blockers as facts, not estimates;
- never mark a gate accepted from source tests alone when packaged evidence is
  required;
- never rewrite historical gate evidence after acceptance; add a dated
  requalification note;
- record scope changes under Decisions before implementation.

Only one gate should normally be `In progress`. A parallel contract-only slice
may be listed beneath the active gate without implying runtime acceptance.

## Risks And Controls

| Risk | Control |
| --- | --- |
| "All languages" becomes a growing hardcoded switch | Stable capability providers and generic task profiles |
| Arbitrary shell bypasses Project authority | Structured executable/argv admission and explicit risk approval |
| Terminal or dev server survives app shutdown | Main-owned process registry, process-tree stop, packaged cleanup canary |
| Harness update breaks JSON-RPC or event projection | Staged compatibility suite and atomic rollback |
| Upstream data migration corrupts user sessions | Candidate tests only copied temporary data before activation |
| Browser exposes user login state to the model | Separate Agent Test and User Web partitions with deny-by-default observation |
| Page content reaches app IPC | No preload/Node integration and strict navigation/session policy |
| Browser output overwhelms context | Bounded typed observations, digests, and explicit expansion |
| UI claims a command or page check that did not happen | Main-owned tool/action/result facts only |
| New capability breaks Checkpoint or Undo | Integrated candidate, recovery, restart, and Undo canaries in G6 |
| Live deltas amplify into full replay, IPC clones, and broad React commits | Typed/coalesced changes, transient stores, incremental projection, lazy payloads, and measured performance gates |

## Stage Completion

This roadmap is complete only when `A0` and `G1` through `G7` are accepted. The
resulting product must be able to truthfully claim:

1. Builder can work with any admitted project toolchain without a
   JavaScript-only product path.
2. Commands, terminals, jobs, diagnostics, and Browser actions are first-class
   supervised facts in one programming loop.
3. Web work can be started, observed, interacted with, repaired, and verified
   inside the packaged desktop application.
4. User browsing state remains separate from Agent testing state.
5. Harness can be upgraded and rolled back without silently replacing the
   active kernel or risking the only copy of user data.
6. Checkpoint, continuation, Undo, restart recovery, and optional Versions remain
   intact across every qualified language and Browser journey.
