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

Generated JavaScript is stored and displayed but is not executed in the first release. Tool-enabled work now has a pre-dispatch record contract: a Run may bind a tool call only to a current allowed permission admission receipt and a matching main-only tool session policy receipt. That policy receipt fixes the Run-bound step, tool-call, retry, timeout, summary-output, raw-output, and chargeable-dispatch envelope, and the tool-call record digest covers it before the request can enter Conversation replay and the renderer-safe Task Stream as a non-executed fact. The tool-call record enforces the policy request-time window, the result record enforces the policy result-time and public-summary window, and the main-only session state gate enforces serial pending calls, one policy digest per Run, step/tool-call limits, retry exhaustion, and append/replay state before those facts are accepted. A separate main-only result record contract can verify a fixed terminal result code from that pre-dispatch call record; that fixed-code result can also enter replay and the renderer-safe Task Stream while excluding record digests, free-form output text, raw output, provider facts, renderer authority, policy receipts, and revision changes. The Conversation main service can append those verified request/result facts only for a trusted active work Run context, with no IPC/preload command and no dispatch or execution. The policy digest detects drift but is not issuer proof, so any future executor must still bind issuance to a trusted main-side Run context before dispatch. Tool dispatch, arbitrary execution, workflow promotion, collaboration, and publishing require later independent gates.

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
