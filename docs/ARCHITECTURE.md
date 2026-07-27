# Builder Architecture

This document defines the implemented standalone Builder boundary. For the
future product stages and cross-feature fact model, read
[Product Vision and Roadmap](PRODUCT_VISION_AND_ROADMAP.md) and
[Trusted Work and Collaboration Architecture](TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md).
The delivery order and release evidence are defined in
[Implementation Plan](IMPLEMENTATION_PLAN.md).

## Product Boundary

The first product loop is: describe an idea, generate a code draft, review the
working tree diff, save a Git-backed revision receipt, reopen it, revise it,
and inspect a static preview.

The desktop application owns five narrow authorities:

1. Builder provider settings and encrypted credentials.
2. Bounded code-generation transport.
3. Git-backed project worktrees and SQLite product metadata.
4. Main-owned, deny-by-default Permission facts with an evaluate-only IPC
   surface, renderer-side decision sanitizer, and main-side tool admission
   receipt before future tool dispatch.
5. A controlled renderer bridge exposing only Builder operations.

Generated JavaScript is stored and displayed but is not executed in the first release. Tool-enabled work now has a pre-dispatch record contract: a Run may bind a tool call only to a current allowed permission admission receipt and a matching main-only tool session policy receipt. That policy receipt fixes the Run-bound step, tool-call, retry, timeout, summary-output, raw-output, and chargeable-dispatch envelope, and the tool-call record digest covers it before the request can enter Conversation replay and the renderer-safe Task Stream as a non-executed fact. The default raw-output budget remains zero, but a trusted main-side Run policy may explicitly grant a bounded private raw-output budget for later tool contracts. The tool-call record enforces the policy request-time window, the result record enforces the policy result-time and public-summary window, and the main-only session state gate enforces serial pending calls, one policy digest per Run, step/tool-call limits, retry exhaustion, and append/replay state before those facts are accepted. A separate dispatch-admission contract lets the Conversation main service verify that the current trusted active Run has the requested open tool call before a later adapter gate receives a bounded admission; it still selects no adapter, performs no dispatch, starts no execution, stores no raw output, and creates no revision. A separate adapter-selection contract can bind that dispatch admission and tool-call record to the first static main-side filesystem-read adapter identity, but it still does not run the adapter, read file content, store output, call a provider, mutate source, or create a revision. A separate runtime-invocation contract can bind the explicit adapter-selection receipt to a static no-execution runtime envelope with denied network, process, secret, filesystem-read, raw-output, and chargeable-dispatch authority; it still does not read files, execute code, store output, mutate source, call a provider, or create a revision. The Project main authority now owns a main-only workspace admission facade that derives a branded project root admission from the canonical projects root and Project ID; it performs no read and is not renderer-serializable authority. A separate main-only filesystem-read adapter can now perform the actual bounded project-file read only after the workspace admission, runtime, tool-call, policy, path, symlink, opened-handle identity, UTF-8, and byte-limit checks pass, then hand the content to a private filesystem-read output record. A separate main-only filesystem-read execution service can compose the trusted Conversation service methods, workspace admission, adapter, private output record, and fixed result record for one already-requested tool call; it returns private read output only to the main caller and appends only the fixed public result summary through Conversation. A separate main-only source-context collector can issue a zero-retry bounded policy, preflight all main permission admissions before any tool fact is appended, record each requested filesystem-read tool call, execute the read service, and return private source context only to the main caller while Conversation receives only fixed request/result facts. A separate main-only plan proposal record can consume that private source context, verify it through the source-tree sanitizer, carry only a context digest plus bounded plan text, and remain proposed, unapproved, non-executing, non-mutating, non-IPC, non-provider, non-Git, and non-revision evidence. The Conversation main service can now admit that proposed plan as a terminal Run fact only after the transient source-context result, the plan proposal record, and the recorded filesystem-read request/result facts cross-check against the same trusted active work Run, request digest, head digest, file count, resource ids, tool-call ids, and successful result-record digests; Conversation stores a compact plan admission evidence object, the plan digest, and the assistant message projection, not private source content or the plan record body, and replay re-verifies that admission before reconstructing `plan_proposed`. That output record verifies adapter output against the matching runtime-invocation receipt, tool-call record, explicit raw-output budget, project-resource path, and source-tree sanitizer; it is private contract evidence only, is not an IPC/preload command, does not enter Conversation replay or the renderer-safe Task Stream, and does not create a revision. A separate main-only result record contract now verifies a fixed terminal result code only when it is bound to that explicit runtime-invocation receipt and matching pre-dispatch call record; that fixed-code result can also enter replay and the renderer-safe Task Stream while excluding dispatch, adapter, runtime, policy, record digest, free-form output text, raw output, provider facts, renderer authority, and revision changes. The Conversation main service can append those verified request/result/plan facts only for a trusted active work Run context, with no IPC/preload command and no provider dispatch or source execution. The policy digest detects drift but is not issuer proof, so any future executor must still bind issuance to a trusted main-side Run context before dispatch. Arbitrary execution, workflow promotion, collaboration, and publishing require later independent gates.

A separate main-owned plan review fact can now record that a completed proposed
plan was approved or rejected by a reviewer. It is admitted only after replayed
Conversation state proves a completed work turn, a successful `plan` Run, a
matching plan digest, and no prior plan review. The renderer can request only
that approve/reject fact through one active-renderer-bound preload namespace and
one exact IPC adapter, backed solely by the Conversation main service. That
request path cannot generate code, edit source, save a Version, create Git
evidence, read provider configuration or credentials, or create a Project
Revision. The renderer-safe Task Stream receives only the public
`plan_reviewed` decision/plan state; review ids, reviewer ids, timestamps, plan
digests, source context, provider facts, Git evidence, Save authority, and
Project Revision facts remain outside the projection.

The Conversation main service can also read a compact approved-plan fact for a
future main-side agent loop, but only when replay proves that the matching
approved plan review is the current conversation head. This read has no
IPC/preload surface, no renderer projection, no review identity or timestamp,
and no source mutation, provider dispatch, Git evidence, Save authority, or
Project Revision authority. Stale or rejected plan facts fail closed.

The Conversation main service can also create a main-only approved-plan
continuation admission by first performing that fresh approved-plan read. The
receipt binds Project, Conversation, Turn, Task, Run, plan digest,
Conversation head, head digest, and continuation ID while starting no Run,
appending no Conversation event, exposing no IPC/preload or renderer
projection, reading no credential/source, dispatching no provider or tool,
mutating no source/Git state, and creating no Save or Project Revision. A
future executor must use this main-service gate instead of caching an older
approved-plan fact.

The Generation main service can prepare a main-only approved-plan edit context
by binding a fresh continuation admission to the current saved project source
through the Git/SQLite project read authority. The context is private main-side
input for a later executor: it includes verified base revision evidence and the
current source tree, but it does not read provider config or credentials,
dispatch provider/tool work, mutate source, create Git candidate evidence,
append Conversation events, create Save/Project Revision facts, or expose any
IPC/preload/renderer projection.

The Generation main service can also record fixed Run progress stages through
the Conversation main service while a provider generation or explanation is in
flight. The only current stages are `context_ready`,
`provider_request_started`, `provider_response_received`, and
`result_preparing`. Each stage advances the trusted Conversation head and is
replayed before the renderer-safe Task Stream exposes it as a status item. The
projection contains no provider envelope, prompt, token delta, credential,
source content, Git evidence, Save authority, or Project Revision authority.
This is durable work visibility, not a token-streaming or tool-execution
protocol.

The OpenAI-compatible provider transport also has a main-only streaming observer
path. When the Generation host supplies an internal observer, the request uses a
bounded `text/event-stream` response, assembles the same terminal generated-text
result, and forwards only advisory delta text through a redacted
Project/Conversation/Run envelope inside main. This path has no renderer
IPC/preload exposure and does not project raw provider deltas into the Task
Stream; user-visible token output and tool-output streaming still require
separate projection and UI gates.

The code authority is a normal project directory with a standard Git
repository. Git commit, tree, and parent object IDs are the durable code facts.
Builder Project Revision is a SQLite product receipt that binds a Project,
Run, Review decision, and Artifact evidence to Git object IDs. It must not copy
source files into a second JSON revision chain.

Future Goal, Task, Run, Artifact, Review, Permission grant UI/tool enforcement,
Contribution, Agent Definition/Version, Delegation, Workflow Version, Space/Membership,
Identity/Contact/Conversation, and Publication authorities must be added
independently and must not be inferred from chat, community, model identity,
renderer state, or Git metadata alone.

## Project Storage Model

Each Builder project is a plain directory. The directory contains user-visible
source files, a standard `.git/` repository, and a small `.clawfabric/`
directory for project-local identity and configuration.

The packaged application carries a canonical Git implementation. The current
choice is `dugite` for locating embedded Git. The runner must construct a
minimal fixed environment and invoke the embedded Git binary directly; it must
not use `dugite.exec` in a way that inherits arbitrary `process.env`.

The intended save flow is:

1. AI produces a bounded code-change candidate.
2. Builder applies the candidate to a project working tree and presents its
   diff for review.
3. Explicit acceptance persists an immutable Git candidate commit and
   candidate ref. This does not update `main` and does not make the candidate
   current.
4. One SQLite transaction records and selects a Project Revision receipt bound
   to the accepted candidate commit, tree, and parent OIDs, plus the producing
   Task, Run, Review decision, and Artifact references.
5. A separate projection step uses expected-old compare-and-swap to update
   `main` and materialize the selected working tree.

SQLite owns product semantics: Project registry, Conversation, Task, Run,
Review, Artifact references, idempotency, provider-independent metadata, and
the current product selection. It does not duplicate the full source history.
It may keep bounded indexes from durable Conversation events, such as a draft
id to candidate-result event mapping, so main-only authorities can restore
candidate proof after restart without storing source bytes or provider payloads.
The SQLite current selection is the product fact. `main` and the materialized
working tree are rebuildable projections and cannot change that selection in
reverse.

Crash and integrity semantics are explicit:

- a Git candidate without a selected SQLite Project Revision receipt is an
  orphan candidate and is never visible as current;
- a selected SQLite receipt whose commit, tree, or parent evidence is missing
  or invalid is an integrity failure;
- a missing or drifted `main` or working tree is repaired by projecting the
  SQLite selection again with expected-old compare-and-swap;
- branch or working-tree drift must never be used to rewrite SQLite product
  truth.

`.clawfabric/` owns only project identity and project-local configuration. It is
not a database of source revisions, not a second VCS, and not a credential
store.

## Isolation Rules

- No runtime import, symlink, workspace dependency, or relative path may point to `ClawFabric v5`.
- Legacy Chat, Canvas, Job, server collaboration, Current State, Auto Edit, and Python backend code are not product dependencies.
- Extraction copies are pinned in `provenance/extraction-manifest.json` and become independently maintained after import.
- The new application uses a distinct app id, profile, protocol, and project workspace model.
- Development-stage builds do not read old projects, v1 JSON revisions, old IPC/catalog APIs, or old renderer contracts.
- Backward compatibility and migration are not product requirements unless a future user-data migration is explicitly authorized.
- The old JSON revision repository, IPC, and catalog chain may be deleted directly; replacement work must not depend on mixed-mode reads.

## Repository Documentation Authority

- `docs/` is authoritative for the standalone product.
- `D:\CODE\ClawFabric v5` is a reference and compatibility repository only.
- The [Legacy Migration Map](LEGACY_MIGRATION_MAP.md) records which old ideas
  were rewritten and which old systems remain excluded.
