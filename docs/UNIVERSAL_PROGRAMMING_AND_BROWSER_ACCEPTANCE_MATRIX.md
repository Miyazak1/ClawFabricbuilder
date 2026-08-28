# Universal Programming And Browser Acceptance Matrix

Date: 2026-08-25

Status: active acceptance authority for prerequisite Gate A0 and Gates G1-G7.

## Purpose

This matrix turns the universal programming and Browser roadmap into repeatable
evidence. A source-level unit test is necessary but does not by itself qualify
a packaged desktop capability.

Each accepted gate must link exact test names, artifact/receipt identities,
platform, Builder version, Harness version, and pass time. Missing evidence
means `Not accepted`; a convincing screenshot or manual demonstration is not a
substitute for durable facts.

## Result Vocabulary

- `PASS`: required behavior and negative boundaries were observed.
- `FAIL`: the implementation produced an incorrect or unsafe result.
- `BLOCKED_ENVIRONMENT`: a declared external toolchain is unavailable; the UI
  showed a truthful readiness state and no install was attempted.
- `NOT_APPLICABLE`: the provider does not advertise the optional capability.
- `FLAKY`: any non-deterministic pass; treated as failure for gate acceptance.

`BLOCKED_ENVIRONMENT` is acceptable only for optional local qualification. The
release fixture set must have at least one controlled environment where every
required provider passes.

## Evidence Record

```text
builder-acceptance-evidence.v1
  evidence_id
  gate_id
  case_id
  builder_version
  packaged_artifact_digest?
  harness_runtime_id?
  fixture_id
  fixture_revision
  platform
  architecture
  provider_versions{}
  started_at_ms
  ended_at_ms
  result
  receipt_refs[]
  redacted_summary
  authority
```

Evidence must not contain provider tokens, cookies, credentials, private browser
storage, full environment blocks, or unredacted user paths.

## Gate Coverage

| Gate | Required suites | Packaged evidence |
| --- | --- | --- |
| `A0` event/projection foundation | `ARCH-*`, `PERF-*`, `REC-*` | dual-read, stream, restart, long-history, and Browser-stability canaries |
| `G1` Harness lifecycle | `HUP-*` | activation and rollback drill |
| `G2` foreground Process | `ENV-*`, `PROC-*`, `OUT-*`, `SEC-*` | one repair per available provider class |
| `G3` Terminal/Jobs | `TERM-*`, `JOB-*`, `REC-*` | interactive input, cancel, restart cleanup |
| `G4` toolchains/diagnostics/LSP | `LANG-*`, `DIAG-*`, `LSP-*` | required provider fixture set |
| `G5` Browser | `BROW-*`, `BSEC-*` | local app action loop and cleanup |
| `G6` integrated closure | `FLOW-*`, `PERF-*` | complete user journeys |
| `G7` RC | all required suites | installer/package, rollback, residual risk |

## Harness Update Cases

| ID | Case | Required result |
| --- | --- | --- |
| `HUP-001` | Discover a newer official release | metadata receipt only; active runtime unchanged |
| `HUP-002` | Candidate tag resolves to unexpected repository/commit | candidate rejected |
| `HUP-003` | Archive or lock digest mismatch | candidate quarantined; no execution |
| `HUP-004` | Candidate requests unsupported protocol | qualification fails closed |
| `HUP-005` | Candidate tool call attempts broker bypass | no effect; authority violation recorded |
| `HUP-006` | Candidate migration against copied corpus | projections remain canonical; production data untouched |
| `HUP-007` | Activate while work is active | activation blocked |
| `HUP-008` | Qualified activation on restart | active pointer changes atomically; handshake passes |
| `HUP-009` | Forced post-activation handshake failure | previous qualified runtime restored |
| `HUP-010` | Candidate process/files locked on Windows | no partial overwrite; deterministic retry/rollback |
| `HUP-011` | Irreversible migration declared | ordinary rollback disabled; explicit migration plan required |
| `HUP-012` | Update diagnostics export | secrets/content redacted |

## Environment And Toolchain Cases

| ID | Case | Required result |
| --- | --- | --- |
| `ENV-001` | Scan a mixed-language repository | deterministic descriptors; no executable run during passive scan |
| `ENV-002` | Probe an allowlisted executable | bounded version result with executable identity |
| `ENV-003` | Required toolchain missing | structured readiness state; no automatic install |
| `ENV-004` | Manifest and lockfile disagree | conflict shown; no guessed package manager |
| `ENV-005` | User declares a custom task | explicit risk and argv/cwd/env preview before admission |
| `ENV-006` | Project path contains spaces/Unicode | structured invocation remains correct |
| `ENV-007` | Executable resolves outside admitted policy | blocked before process start |
| `ENV-008` | Environment contains credentials | only allowlisted names reach process; projections are redacted |

## Process And Output Cases

| ID | Case | Required result |
| --- | --- | --- |
| `PROC-001` | Run executable plus argv without shell | exact argv and cwd receipt |
| `PROC-002` | Unknown/user-defined task | approval required before start |
| `PROC-003` | Mutating/install/networked task | classified and admitted separately |
| `PROC-004` | Process exits zero | terminal result recorded once |
| `PROC-005` | Process exits nonzero | diagnostics/output returned to same Harness turn |
| `PROC-006` | Process times out | process tree stopped; timeout distinct from provider timeout |
| `PROC-007` | User cancels | cancellation reaches child tree and public state once |
| `PROC-008` | Child survives parent | cleanup catches/blocks release qualification |
| `PROC-009` | Concurrent projects run tasks | no cwd, output, or authority crossover |
| `PROC-010` | App closes during process | owned tree stops and interruption is recoverable |
| `OUT-001` | High-frequency stdout/stderr | bounded UI updates; ordered complete private log |
| `OUT-002` | Output exceeds inline limit | stable spill ref and digest; no giant conversation payload |
| `OUT-003` | Partial UTF-8/Unicode chunks | no corruption or duplicated text |
| `OUT-004` | Same chunk receives incremental text | live row updates without durable full-stream replay per delta |
| `OUT-005` | Renderer reconnects | projected latest state resumes without duplicate terminal result |

## Terminal And Job Cases

| ID | Case | Required result |
| --- | --- | --- |
| `TERM-001` | Open terminal for admitted project | owner/project/generation identity recorded |
| `TERM-002` | Send input to prompt-ready terminal | ordered input receipt; wrong owner blocked |
| `TERM-003` | Read output by offset | bounded chunks and explicit truncation/generation identity |
| `TERM-004` | Resize terminal | dimensions change without renderer process authority |
| `TERM-005` | Interrupt then terminate | escalating signal policy and terminal result |
| `TERM-006` | Manual takeover | agent input pauses while user owns interaction |
| `JOB-001` | Start managed development server | readiness bound to owned process and loopback origin |
| `JOB-002` | Stop/restart job | old process and browser binding cleaned before replacement |
| `JOB-003` | Job crashes | durable failure plus bounded output; no fake running state |
| `REC-001` | Main process restarts | old PIDs not adopted by identity alone; task marked interrupted |
| `REC-002` | Renderer reloads | main-owned state reconnects without duplicate process |
| `REC-003` | App shutdown with terminal/job | all owned children and listeners removed |

## Language Provider Fixtures

Every fixture is tiny, deterministic, offline after dependencies are prepared,
and contains one seeded compile/test/lint/runtime defect that Builder can repair
without changing the intended behavior.

| ID | Provider fixture | Minimum tasks and evidence |
| --- | --- | --- |
| `LANG-JS-001` | JavaScript/TypeScript | package-manager selection, typecheck/test, one repair |
| `LANG-PY-001` | Python | interpreter/venv identity, test, traceback diagnostic, one repair |
| `LANG-GO-001` | Go | module identity, test/build, compiler diagnostic, one repair |
| `LANG-RS-001` | Rust | toolchain/cargo identity, check/test, compiler diagnostic, one repair |
| `LANG-JVM-001` | Java | JDK and Maven/Gradle identity, test/compile, one repair |
| `LANG-CC-001` | C/C++ | compiler/build-system identity, compile/test, one repair |
| `LANG-CS-001` | C# | dotnet SDK/project identity, build/test, one repair |
| `LANG-GEN-001` | user-declared language | generic structured task runs without a language-specific branch |

Provider acceptance rules:

- discovery is deterministic for identical project/toolchain state;
- task selection is explainable and does not guess between conflicting locks;
- missing tools produce `BLOCKED_ENVIRONMENT`, not a package install;
- command/process authority is identical across languages;
- paths in diagnostics resolve only inside admitted roots;
- failed task output is available to the same repair turn;
- successful rerun is recorded before checkpoint claims success.

## Diagnostics And LSP Cases

| ID | Case | Required result |
| --- | --- | --- |
| `DIAG-001` | Parse compiler/test output | path/range/severity/code/source/message projection |
| `DIAG-002` | Diagnostic points outside project | path redacted/blocked; no file authority created |
| `DIAG-003` | Duplicate diagnostics across rerun | stable replacement/deduplication semantics |
| `DIAG-004` | Unsupported output | bounded raw summary, not fabricated structured range |
| `LSP-001` | Start qualified server | project/toolchain/session identity and cleanup receipt |
| `LSP-002` | Definition/references/hover/symbols | bounded results inside admitted roots |
| `LSP-003` | Code action available | discovery is read-only; applying action requires edit authority |
| `LSP-004` | Server hangs/crashes | bounded timeout/restart; programming run remains recoverable |
| `LSP-005` | Language server missing | readiness result; no automatic install |

## Browser Cases

| ID | Case | Required result |
| --- | --- | --- |
| `BROW-001` | Open owned loopback app in Agent Test | run/process/origin/session binding recorded |
| `BROW-002` | Capture first frame | load success and nonblank pixel evidence |
| `BROW-003` | Observe page | bounded screenshot, accessibility/DOM, console, network summaries |
| `BROW-004` | Click/type/key/scroll/select/wait | stable target refs and before/after digests |
| `BROW-005` | Find console error | structured failure returned to same programming run |
| `BROW-006` | Find failed network request | URL/data redacted according to policy; repair can rerun |
| `BROW-007` | Visual/DOM repair | second observation proves expected result |
| `BROW-008` | Viewport and tab actions | stable dimensions; session identity preserved |
| `BROW-009` | Cancel owning run | pages, debugging channel, listeners, and partition cleaned |
| `BROW-010` | Browser crashes | durable failure; no fabricated success or orphan session |
| `BSEC-001` | Agent Test requests external origin | blocked or explicit new approval |
| `BSEC-002` | Project page opens window/download/permission | denied by default and recorded |
| `BSEC-003` | Attempt raw CDP/arbitrary JS | unavailable in v1 |
| `BSEC-004` | Open same site in User Web and Agent Test | no cookie/storage/history crossover |
| `BSEC-005` | User Web observation without consent | no page content/provider egress |
| `BSEC-006` | Credential/payment/destructive action | visible pause and explicit user decision |
| `BSEC-007` | Page attempts app IPC/file URL | blocked before authority crossing |
| `BSEC-008` | Upload/download | only admitted file ref/destination; bounded filesystem authority |

## Integrated Journeys

| ID | Journey | Required result |
| --- | --- | --- |
| `FLOW-001` | Python test failure to repair | inspect, edit, rerun, checkpoint, Undo all truthful |
| `FLOW-002` | Compiled project failure to repair | compiler diagnostic feeds same turn; rerun passes |
| `FLOW-003` | Long-running app | start, readiness, output, stop, restart, cleanup |
| `FLOW-004` | Web defect | server start, Browser observe/action, repair, verification |
| `FLOW-005` | User redirects while running | queued steering reaches next safe boundary; no duplicate task |
| `FLOW-006` | Restart after accepted checkpoint | session/project/version facts reconcile without duplicate activity |
| `FLOW-007` | Save or discard draft | decision card resolves exactly once and disappears when authority changes |
| `FLOW-008` | Undo after save/checkpoint | correct recoverable state restored; stale Save card cannot remain actionable |
| `FLOW-009` | Side workspace expanded/collapsed | conversation/composer remains usable and Browser lifecycle unchanged |
| `FLOW-010` | Failure at every boundary | provider/runtime/tool/process/browser failures are distinguishable and retryable |

## Performance And Responsiveness Gates

Before optimization, add duration/count/byte instrumentation for Main handlers,
SQLite load/append, event replay/projection, renderer clone/freeze, Browser
observation, and React commit scope. Thresholds below are release budgets on the
reference Windows qualification machine; the evidence record stores hardware
and dataset descriptors.

| ID | Budget | Required result |
| --- | --- | --- |
| `PERF-001` | live text delta delivery | p95 renderer-visible latency <= 100 ms during normal streaming |
| `PERF-002` | durable event writes during text streaming | no full conversation/task-stream replay per text delta |
| `PERF-003` | subscription burst | changed notifications coalesced; at most one durable refresh per animation frame and no unbounded queue |
| `PERF-004` | conversation projection | cost proportional to appended window/cursor after warm load, not total history |
| `PERF-005` | IPC payload | routine chat delta/state payload excludes source tree, full draft, preview pixels, and full logs |
| `PERF-006` | renderer processing | clone/freeze bytes and duration instrumented; no repeated 4 MB graph clone for a text delta |
| `PERF-007` | React isolation | Browser/side-workspace updates do not recommit the full conversation tree; live delta does not recommit unrelated project/catalog panels |
| `PERF-008` | long conversation | 10,000 historical facts across segments/checkpoints remain interactive while streaming and opening Browser |
| `PERF-009` | output burst | 10 MB command output remains bounded in UI with complete private spill evidence |
| `PERF-010` | browser observation | screenshot/DOM/network collection is cancellable and does not block composer input/main event loop |
| `PERF-011` | synchronous Main work | slow SQLite, Git, file, or projection spans are measured and moved/batched when they exceed UI budget |
| `PERF-012` | layout stability | composer is never covered; latest output remains reachable; side panel resize causes no text collapse or overlap |

### Architecture Foundation Cases

| ID | Case | Required result |
| --- | --- | --- |
| `ARCH-001` | assistant text delta | visible live update does not wait for semantic-ledger append |
| `ARCH-002` | 100 ordered live deltas | zero complete Conversation/task projection reads |
| `ARCH-003` | completion/reconnect/restart | semantic completion is durable and exactly once |
| `ARCH-004` | warm append and projection | work is proportional to appended suffix/cursor distance |
| `ARCH-005` | incremental versus cold rebuild | projection digests and public items are equivalent |
| `ARCH-006` | long history | 10,000 historical facts across segments/checkpoints remain interactive |
| `ARCH-007` | routine Activity read | excludes source bodies, diffs, full logs, screenshots, and Browser evidence |
| `ARCH-008` | live stream React trace | no unrelated project, workspace, or Browser subtree commit |
| `ARCH-009` | stream plus workspace resize | Browser session/tab identity and navigation survive unchanged |
| `ARCH-010` | known historical schemas | load through a versioned reader or fail with an explicit migration code |

Performance acceptance also requires:

- live `assistant_text_delta` uses the live stream plane, with optional batched
  recovery spool and a durable completion at semantic/terminal boundaries;
- task-stream change events identify change kind/cursor so consumers avoid an
  unconditional full `read`;
- conversation/task projections support cached or incremental materialization;
- source trees, diffs, logs, screenshots, and file bodies are lazy-loaded by
  reference;
- ActivityPanel and Browser subscribe to the smallest state surface they need;
- performance instrumentation is off or sampled in normal use and never logs
  content by default.

## Security Negative Matrix

All gates rerun these cross-cutting negatives:

| ID | Negative case | Required result |
| --- | --- | --- |
| `SEC-001` | path traversal, symlink escape, or cross-project file ref | blocked without leaking target content |
| `SEC-002` | shell metacharacters inside structured argv | treated as argument data; no implicit shell expansion |
| `SEC-003` | environment or credential exfiltration | secret absent from process/provider/public evidence |
| `SEC-004` | renderer forges process, terminal, browser, checkpoint, or update fact | rejected before durable commit |
| `SEC-005` | provider claims success without Main evidence | no success/checkpoint projection |
| `SEC-006` | stale request, run, project, revision, terminal, or browser id | rejected with no effect |
| `SEC-007` | replayed/duplicated tool result or terminal event | exactly-once public settlement |
| `SEC-008` | oversized output, DOM, screenshot, task stream, or IPC graph | bounded/truncated/refused without UI or Main failure |
| `SEC-009` | page requests IPC, file URL, external navigation, popup, download, permission, or debugging | denied unless its separate authority is explicitly admitted |
| `SEC-010` | update candidate accesses production database, project, credential, or active runtime files | isolated and qualification fails |

## Packaged Qualification Matrix

Minimum release axes:

- clean install and upgrade install;
- Windows supported architectures;
- bundled Harness and one newer qualified candidate;
- active runtime rollback to last-known-good;
- paths with spaces and non-ASCII characters;
- online provider flow and deterministic local/provider-stub flow;
- short active logs and 10,000 historical facts across segments/checkpoints;
- single and mixed-language fixture repositories;
- Project Preview, Agent Test Browser, and User Web isolation;
- normal exit, forced renderer reload, Main restart, runtime crash, process
  crash, and Browser crash.

## Acceptance Procedure

For each gate:

1. freeze fixture revisions and expected negative boundaries;
2. run pure contract/unit suites;
3. run Main integration suites with real SQLite/process/session lifecycles;
4. run deterministic packaged canaries;
5. run required real-provider journeys;
6. collect redacted evidence records and artifact digests;
7. inspect performance and cleanup budgets;
8. record failures and rerun the full affected suite after correction;
9. update the roadmap gate only when every required case is non-flaky.

No release gate may waive a security, data-integrity, rollback, cleanup, or
authority-crossover failure. A temporary performance waiver requires a dated
owner, measured baseline, user impact, and removal gate; it cannot cover UI
input stalls, unbounded memory, or full replay on every live delta.
