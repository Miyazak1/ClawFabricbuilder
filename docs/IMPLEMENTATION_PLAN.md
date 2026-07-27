# ClawFabric Implementation Plan

## Purpose

This plan turns the product roadmap into independently verifiable engineering
gates. A projection or UI state must never stand in for a missing fact
authority.

## Verified Starting Point

The standalone Builder has a dedicated desktop shell, encrypted provider
settings, bounded generation transport, saved project discovery, restart
restore, and static preview. The dated package and real-provider evidence is recorded in
[Release Evidence - 2026-07-22](RELEASE_EVIDENCE_2026_07_22.md).

That checkpoint proved the first creation loop, but the storage authority has
now been superseded. The long-term architecture is Git-backed code facts plus
SQLite product receipts. The old JSON revision repository, IPC, and catalog
chain are not compatibility surfaces and may be deleted directly.

## Common Foundation Gates

These gates support every later product branch.

### Gate F0 - Git Kernel and SQLite Metadata

Replace the self-managed JSON source revision chain with a mature storage
split:

- every Builder project is a plain directory with a standard Git repository;
- packaged builds carry canonical Git, currently located through `dugite`;
- the Git runner builds a minimal fixed environment and invokes embedded Git
  directly instead of inheriting `process.env` through `dugite.exec`;
- AI changes first materialize as working tree edits and a reviewable diff;
- explicit acceptance persists an immutable Git candidate commit and candidate
  ref without updating `main` or claiming current product state;
- one SQLite transaction records and selects a Project Revision receipt bound
  to Task, Run, Review, commit, tree, and parent evidence;
- a separate projection uses expected-old compare-and-swap to update `main`
  and the selected working tree;
- commit, tree, and parent OIDs are the code version facts;
- SQLite records Project, Project Revision receipts, Conversation, Task, Run,
  Review, Artifact references, idempotency, and provider-independent metadata;
- Project Revision binds product facts to Git OIDs and never copies source into
  a second revision chain;
- `.clawfabric/` stores only project identity and project-local configuration.

Evidence requirements:

- no old v1 project repository, IPC, catalog, renderer contract, or migration
  path is read;
- Git operations use the packaged canonical Git with a minimal runner
  environment;
- candidate persistence does not update `main`, claim current status, or bypass
  a persisted Task, Run, and Review verification receipt;
- SQLite selection atomically records the Project Revision receipt, commit OID,
  tree OID, parent OIDs, Task, Run, and Review decision;
- `main` and the working tree are rebuildable projections of SQLite current
  selection and cannot become reverse authority;
- SQLite writes are atomic, restart-safe, corruption-safe, and idempotent;
- a Git candidate without a SQLite receipt remains an invisible orphan;
- a selected SQLite receipt with missing or invalid Git objects is an integrity
  failure;
- branch or working-tree drift is repaired from SQLite with expected-old
  compare-and-swap and cannot rewrite SQLite truth;
- `.clawfabric/` cannot become a second VCS or credential store.

### Gate F1 - Provider Compatibility

Keep one vendor-neutral OpenAI-compatible contract while adding tested presets
or setup guidance for mainstream providers. Provider name, model, endpoint, and
credential remain configuration, not Project or Agent identity.

Evidence requirements:

- each preset resolves to an explicit editable configuration;
- no credential is bundled, logged, echoed, or inferred;
- availability and generation are tested per supported provider shape;
- unsupported provider behavior fails safely without silent fallback.

### Gate F2 - Generation, IPC, and Frontend Cutover

Move generation, project IPC, catalog, and frontend flows onto Gate F0 facts.

Evidence requirements:

- renderer never submits finished Project Revision records;
- generation returns a code-change candidate, not a saved version;
- candidate application changes only the working tree under Git authority;
- persistence creates only an immutable Git candidate commit/ref until SQLite
  records and selects the Project Revision receipt;
- `main` and the materialized working tree are updated only by the independent
  expected-old projection after SQLite selection;
- catalog and History read SQLite receipts bound to Git OIDs;
- preview reads the selected worktree/commit through a bounded adapter;
- old v1 repository, IPC, and catalog modules have no production consumers.

### Gate F3 - Delete v1 Repository, IPC, and Catalog

Delete the old JSON Project Revision repository, legacy project IPC, and legacy
catalog chain directly. Development-stage builds do not need compatibility,
migration, mixed-mode reads, or old-project restore.

Evidence requirements:

- no production import remains;
- no package verifier entry requires old v1 files;
- boundary tests forbid old repository, IPC, and catalog authority;
- no fallback path recreates JSON revision-chain storage.

### Gate F4 - Conversation, Message, Task, and Run Contracts

Define the project-local continuing-work model before adding more product
surfaces. Conversation and Message are communication context. Task and Run bind
requested work and attempts. None of them is code source authority.

Evidence requirements:

- one Conversation is bound to one Project identity;
- Messages are append-only, actor-bound, ordered, bounded, and restart-safe;
- questions can produce explanations without creating source-change Tasks;
- requested work creates an explicit Task bound to the base Git commit and user
  Message;
- each attempt is a distinct Run with pending, completed, failed, cancelled, or
  interrupted terminal state;
- retries link to prior attempts and never rewrite them;
- no Message, Task, or Run can grant tools, save source, publish, or impersonate
  a Git commit or Project Revision receipt.

The exact interaction contract is defined in
[Builder Conversation and Task Stream MVP](BUILDER_CONVERSATION_TASK_STREAM_MVP.md).

### Gate F5 - Main-Owned Conversation and Run Repository

Persist project-local Messages, Tasks, Runs, and safe assistant results in a
main-owned append-only repository.

Evidence requirements:

- request, project, parent Git commit, Message, Task, and terminal result are
  bound without exposing credentials or raw private data;
- pending, completed, failed, cancelled, and interrupted are distinct;
- retries are new attempts linked to the prior attempt;
- restart restores facts without redispatch;
- corruption and conflicting append evidence fail closed;
- reads and replay do not call the provider or mutate Project source;
- a completed Run does not imply a saved Project Revision receipt or Artifact.

### Gate F6 - Provider Projection and Candidate Results

Extend the dedicated Builder provider authority from one-shot generation to
bounded question, explanation, plan, and code-candidate outcomes.

Evidence requirements:

- only selected bounded Project context and Messages enter the provider
  request;
- provider/model/endpoint differences remain behind the dedicated main-only
  adapter;
- DeepSeek and each later supported provider shape have explicit compatibility
  tests rather than silent fallback;
- assistant text, progress, failures, and candidate code are independently
  sanitized and linked to their Run;
- a candidate can be previewed or compared but is never committed by provider
  completion alone;
- cancellation, timeout, empty structured output, schema mismatch, and provider
  rejection produce fixed safe terminal evidence.

### Gate F7 - Explicit Save, Versions, Review, History, and Artifacts

Bind an accepted candidate to an explicit Save decision through Git candidate
persistence, SQLite Project Revision selection, and a separate `main`/working
tree projection. Then add version comparison, duplicate,
restore-as-new-version, read-only History, export, explicit Review, and
preview/export Artifact records. History is derived from verified facts; it is
not a second activity database.

Evidence requirements:

- duplicate creates new Project identity and preserved lineage;
- restore never rewrites history;
- Review decisions are durable and actor-bound;
- Save binds the accepted candidate, Task, Run, Review decision, base commit,
  candidate commit/tree/parent evidence, and selected Project Revision receipt;
- candidate persistence alone never updates `main` or makes a Revision current;
- SQLite selection is the product fact; `main` and working tree are
  expected-old projections that can be rebuilt after drift or interruption;
- orphan Git candidates remain invisible, selected receipts with missing Git
  evidence fail integrity checks, and branch drift cannot rewrite SQLite;
- only receipts bound to verified Git commits appear in History;
- orphaned metadata, missing commits, or competing receipts do not appear and
  corruption fails closed;
- Artifact identity binds the producing Project Revision receipt or Run;
- missing or unavailable bytes remain explicit;
- sharing and publishing remain disabled unless separately authorized.

### Gate F8 - Permission Authority

Create deny-by-default, durable Permission facts before AI is allowed to inspect
additional context or use tools.

Evidence requirements:

- actor, scope, action, resource, issuer, expiry/revocation, and policy version
  are bound;
- UI selection cannot substitute for a persisted grant;
- the first implementation checkpoint owns durable grant/revocation facts in
  main-only SQLite, exposes only an evaluate-only permission decision IPC, and
  sanitizes that decision through a renderer-side port before any future UI/tool use;
- the second checkpoint emits a main-side tool admission receipt only after a
  current permission decision allows the action, without executing the tool;
- secret access, filesystem, network, process, publication, and destructive
  actions are independently scoped;
- revocation affects future actions and is visible in audit history;
- every tool call proves the current permission intersection.

### Gate F9 - Tool-Enabled Human-AI Work Session

Move from one-shot generation to a bounded, inspectable work session: gather
approved context, propose a plan, edit, verify, repair, and request Review.
F2-F5 must already provide a useful continuing conversation without requiring
tool access.

Evidence requirements:

- explicit Goal and Task identity;
- context and tools authorized by Gate F6 Permission facts;
- the first F9 checkpoint records a run-bound tool call fact only from an
  allowed main-side permission admission receipt plus a matching main-only
  tool session policy receipt, with dispatch, execution, result, and revision
  explicitly not performed;
- the next checkpoint admits that pre-dispatch tool call fact into the
  Conversation event replay and renderer-safe Task Stream projection without
  exposing permission receipts, resource details, provider facts, or execution
  results;
- the earlier result-admission checkpoint defined a main-only fixed-code tool
  result record contract from a verified pre-dispatch call record and admits
  that fixed-code result into Conversation replay plus the renderer-safe Task
  Stream without exposing record digests, raw output, provider facts, renderer
  state, or revision authority; it still does not dispatch tools, accept
  free-form output text, store raw output, or create a revision;
- the current main-service checkpoint adds internal-only Conversation append
  methods for verified tool call request records and fixed-code result records,
  bound to a trusted active work Run context and replayed through SQLite; these
  methods are not IPC/preload commands and still do not perform dispatch,
  execution, provider calls, source mutation, or Save;
- the current bounded policy checkpoint binds the main-only tool session
  policy receipt into the tool-call record contract and therefore into the
  internal Conversation append path through existing record sanitizers; the
  receipt fixes Run-bound step, tool-call, retry, timeout, summary-output,
  raw-output, and chargeable-dispatch limits, while still providing no
  IPC/preload command, tool dispatch, provider call, source mutation,
  raw-output storage, or revision creation; the tool-call record enforces the
  policy request-time window, and the result record enforces the policy
  result-time and public-summary window;
- the current session-state checkpoint adds a pure main-only state gate before
  Conversation append and during Conversation replay; it enforces serial
  pending tool calls, one policy digest per Run, step/tool-call limits, retry
  exhaustion, run cancellation/interruption state, and record timestamp ordering
  without IPC/preload command, tool dispatch, provider call, raw-output
  storage, source mutation, or revision creation; the digest is integrity
  evidence, not issuer proof, and any future executor must still bind issuance
  to a trusted main-side Run context before dispatch;
- the current dispatch-admission checkpoint adds a pure main-only admission
  receipt for the currently open tool call from the Conversation main service's
  trusted active Run state; it binds the pending call record, policy digest,
  retry/count envelope, step and total timeout windows, and a dispatch request
  id while selecting no adapter, performing no tool dispatch, starting no
  execution, reading no provider or credential, storing no raw output, mutating
  no source, and creating no revision;
- the current adapter-selection checkpoint binds that dispatch admission and
  verified tool-call record to one static main-side filesystem-read adapter
  identity, with a distinct adapter selection id and time window; it still does
  not register IPC/preload, perform tool dispatch, start runtime execution, read
  file content, store raw output, mutate source, call a provider, or create a
  revision;
- the current runtime-invocation checkpoint binds the explicit
  adapter-selection receipt to a static no-execution filesystem-read runtime
  envelope, with denied network, process, secret, filesystem-read, raw-output,
  and chargeable-dispatch authority; it still does not register IPC/preload,
  read file content, run code, store output, mutate source, call a provider, or
  create a revision;
- the current runtime-bound result checkpoint upgrades the fixed-code result
  record so it must consume and verify an explicit runtime-invocation receipt
  plus the matching pre-dispatch call record before Conversation append; it
  keeps only the fixed public terminal summary in the renderer-safe Task Stream
  and redacts dispatch, adapter, runtime, policy, digest, raw-output, provider,
  source, and revision evidence;
- the current bounded filesystem-read output checkpoint keeps the default
  raw-output budget at zero but permits a trusted main-side Run policy to grant
  a bounded private budget; a main-only output record can verify caller-supplied
  adapter content against the matching runtime-invocation receipt, tool-call
  record, project-resource path, byte limit, and source-tree sanitizer, while
  remaining outside IPC/preload, Conversation replay, renderer-safe Task
  Stream, provider dispatch, source mutation, Save, and revision authority; it
  still does not perform the filesystem read itself;
- the current filesystem-read adapter checkpoint performs the first actual
  tool read, but only inside a main-only adapter that consumes a branded
  Project-main workspace admission plus the prior runtime-invocation receipt
  and tool-call record, verifies the explicit private raw-output budget, rejects
  unsafe project paths and symlinks, rechecks the opened handle identity and
  bounds before/after reading, reads at most the bounded UTF-8 bytes from the
  admitted project root, and returns only the private filesystem-read output
  record; it still has no IPC/preload command, Conversation replay admission,
  renderer-safe Task Stream projection, provider dispatch, source mutation,
  Save, or revision authority;
- the current filesystem-read execution-service checkpoint composes an already
  requested tool call with the trusted Conversation main-service methods,
  workspace admission, bounded read adapter, private read-output record, and
  fixed result record; it returns the private file content only to the main
  caller and records only a fixed public result summary in Conversation/Task
  Stream, with no IPC/preload command, provider dispatch, source mutation,
  raw-output durability, Save, or revision authority;
- the current source-context collector checkpoint gives a future main-side
  agent loop a bounded internal way to gather project file context: it validates
  project resource ids, issues a zero-retry bounded tool session policy,
  preflights all main permission admissions before any tool fact is appended,
  records each tool-call request, executes the filesystem-read service, returns
  private source content only to the main caller, and records only fixed public
  request/result facts in the Task Stream, with no IPC/preload command,
  provider dispatch, Git mutation, Save, raw-output durability, or revision
  authority;
- the current plan-proposal record checkpoint consumes that private
  source-context result only inside main-side code, verifies the bounded file
  facts through the source-tree sanitizer, stores only a context digest, file
  count, byte count, and bounded plan text, and marks the outcome as proposed
  but not approved; it does not append a Conversation event, expose
  IPC/preload, dispatch a provider or tool, mutate source, run generated code,
  create Git evidence, or create a Project Revision;
- the current plan-terminal checkpoint admits a proposed plan into
  Conversation only through an internal main-service method after the transient
  source-context result, plan proposal record, and recorded filesystem-read
  request/result facts bind to the same trusted active work Run, request
  digest, head digest, file count, resource ids, tool-call ids, and successful
  result-record digests, with no pending, failed, or unrelated tool calls and no
  future proposed time; replay permits successful `plan` completion only when
  that compact plan-admission evidence re-verifies against the event chain and
  tool facts, and Task Stream receives only the plan terminal item plus bounded
  assistant message, without private source context, plan body persistence,
  admission or record digest projection, provider facts, renderer authority,
  source mutation, Git evidence, Save, or Project Revision;
- the current plan-review checkpoint records an approved or rejected Review
  fact only after a completed work turn has produced a successful
  `plan_proposed` Run bound to the matching plan digest; the fact authority
  remains main-owned, while the renderer has only one active-renderer-bound
  approve/reject request path through exact preload, IPC, infrastructure port,
  and controller boundaries. It records no edit authority, tool/provider
  dispatch, source mutation, Git evidence, Save, or Project Revision, and the
  renderer-safe Task Stream exposes only the `plan_reviewed` decision/plan
  state, never the plan digest, reviewer identity, timestamps, or private
  plan/source evidence;
- the current approved-plan read checkpoint gives a future main-side agent loop
  a narrow way to consume that approval: Conversation main service returns a
  compact approved-plan fact only when canonical replay proves the matching
  approved plan review is the current conversation head. It may include only
  the already-public assistant plan text that was stored as the Run result
  message, not the plan record body or private source context. It exposes no
  IPC/preload command, renderer projection, review identity, timestamp,
  provider credential/config, tool dispatch, source mutation, Git evidence,
  Save, or Project Revision authority, and rejects stale or rejected plan
  facts;
- the current approved-plan continuation-admission checkpoint lets the
  Conversation main service perform a fresh approved-plan read and then turn
  that current-head fact into a bounded receipt for a later agent/edit loop. It
  binds Project/Conversation/Turn/Task/Run IDs, the plan result digest, the
  Conversation head, a head digest, and a continuation ID, but starts no Run,
  appends no Conversation event, exposes no IPC/preload or renderer projection,
  reads no credential/source, dispatches no provider or tool, mutates no
  source/Git state, and creates no Save or Project Revision. Future executors
  must use this main-service gate instead of caching older approved-plan facts;
- the current approved-plan edit-context checkpoint lets the Generation main
  service bind that fresh continuation admission to the current saved project
  source through Git/SQLite project read authority. It prepares private
  main-side executor input with the approved plan public text, verified base
  revision evidence, and the current source tree, but reads no provider
  config/credential, dispatches no
  provider/tool work, mutates no source, creates no Git candidate, appends no
  Conversation event, creates no Save or Project Revision, and exposes no
  IPC/preload or renderer projection;
- the current approved-plan generation checkpoint lets the Generation main
  service turn that private edit context into an internal generation request.
  Conversation main service first re-reads the current-head approved plan and
  appends a new main-only work Turn/Run whose message is exactly the
  already-public approved plan text; only after that does provider generation
  produce an unsaved candidate from the verified base revision evidence and
  source tree. The visible desktop workspace can request this continuation
  through one controlled preload/IPC command, but the renderer sends only
  Project/Conversation/Turn/Run IDs and cannot send plan text, provider config,
  source content, source receipt authority, Save authority, or Project
  Revision;
- the current visible conversation workspace checkpoint makes the main Builder
  surface a continuous conversation workspace with the composer anchored at the
  main content bottom. Assistant activity, draft review summary, preview, and
  source-file cards appear in that same flow. Draft changes stay summarized in
  the review card and open an on-demand right sidebar only when the user asks
  to inspect them, so an unsaved result does not squeeze the primary preview
  and Save actions. The preview surface explicitly marks the first-release
  static-only runtime boundary, so JavaScript, Three.js, canvas, server, network,
  or backend-dependent drafts can explain a blank preview without claiming the
  generated files failed. Saved Versions can remain in the secondary right review
  sidebar outside the unsaved-draft landing state. This adds no fake edit
  command, does not add a dedicated code workbench, and still uses only the
  existing read-only task stream, plan review, generation, draft reject, cancel,
  and explicit Save bridges;
- the current live activity notification checkpoint emits a project-id-only
  Task Stream change hint from main after a Conversation append has been
  durably recorded and replay-verified. The renderer can subscribe through the
  exact preload task-stream namespace and then re-read the existing read-only
  Task Stream; the notification carries no source, receipt, provider,
  credential, tool output, save, Git, or revision authority and cannot create or
  accept work;
- the current generation-started live-binding checkpoint emits a main-owned
  started hint after a generation request has been durably bound to a Project
  Conversation. The renderer may match that request digest to its own active
  composer turn and use the included Project ID only to re-read the existing
  read-only Task Stream for first-turn unsaved projects; the hint carries no
  source, receipt, provider, credential, tool output, save, Git, revision, or
  project-save authority and does not mark the project saved;
- the current durable run-progress checkpoint records fixed main-owned Run
  progress stages (`context_ready`, `provider_request_started`,
  `provider_response_received`, `result_preparing`) before terminal generation
  or explanation results. These stages advance the trusted Conversation context
  head and appear in the read-only Task Stream as lightweight status rows, but
  they carry no provider envelope, prompt, token delta, credential, source,
  Git, Save, or Project Revision authority;
- the current provider-output streaming checkpoint lets the main-only
  OpenAI-compatible transport request bounded `text/event-stream` responses only
  when the Generation host supplies an internal observer. The transport assembles
  the same terminal generated text contract while emitting advisory bounded raw
  delta text to main-side observers; Generation main service now reduces that
  main-only raw output to top-level display text from the approved generation
  result shape and exposes only a renderer-safe live output event through exact
  IPC/preload. This live output is ephemeral conversation UI, not durable Task
  Stream fact, and carries no raw provider envelope, prompt, credential, source,
  Git, Save, or Project Revision authority. Tool streaming and arbitrary
  execution remain later independent protocols;
- the current renderer-safe tool activity projection turns admitted Task Stream
  tool request/result facts into ordinary conversation status language. Pending
  requests remain visible as project steps; once the matching fixed-code result
  is recorded, the request row folds into one final result row. This is a
  read-only projection only: it adds no tool dispatch, raw-output exposure,
  provider call, source mutation, Git evidence, Save authority, or Project
  Revision authority;
- cancellation and restart semantics;
- no arbitrary generated-code execution through the renderer;
- only a reviewed Git commit plus Project Revision receipt changes project
  truth.

The continuing Builder collaboration checkpoint is complete after F0-F7. The
tool-enabled Personal Workbench checkpoint is complete only after F0-F9.
Provider compatibility, conversation, explicit Save, and version UI may ship
earlier behind their own completed gates.

## Now and Next

1. Git kernel and SQLite metadata foundation.
2. Generation, IPC, catalog, and frontend cutover to Git-backed facts.
3. Direct deletion of old v1 JSON revision repository, IPC, and catalog.
4. Continuing conversation, diff, Review, History, and explicit Save.
5. Agents, collaboration, Spaces, Capability, Workflow, and Community tracks.

## Parallel Product Tracks

After the common foundation, work may proceed in parallel. Publication does not
wait for Agent-to-Agent delegation, and local Agent delegation does not require
server Spaces.

### Track A - Governed Agents

#### Gate A1 - Persistent Local Agent

Introduce a canonical Agent Definition/Version repository, assigned work,
permissions, supervision, and durable progress.

Required before visible activation:

- owner-bound Agent identity, version, status, archive/revoke, and restart
  restore;
- Task and Run supervision with leases and zero duplicate redispatch;
- tool contracts for project read/edit/test operations;
- filesystem, network, process, and secret boundaries;
- pause, resume, cancel, budget, and audit evidence;
- human confirmation for publication, permission changes, destructive actions,
  and external side effects.

#### Gate A2 - Agent-to-Agent Delegation

Add scoped delegation only after A1 is reliable.

Evidence requirements:

- parent/child Task and Agent identity;
- permission and budget intersection;
- bounded result contract and cancellation propagation;
- durable Delegation and result evidence;
- result returns through Review or a local Contribution-like admission object,
  never direct mutation;
- no server, Space, or public identity is implied by local delegation.

### Track B - People and Spaces

#### Gate B1 - Identity, Contacts, and Conversation

Introduce human Identity, Contact Relationship, Conversation Thread, Message,
delivery, privacy/block, and retention authorities.

Communication facts remain separate from work facts. A message can create a
proposed Task, Delegation, or Contribution only through an explicit action.

#### Gate B2 - Spaces, Membership, Inbox, and Contributions

Add local Spaces first, then authenticated synchronization.

Evidence requirements:

- Space and Membership/Role grants are canonical and separate from code source
  authority;
- external work enters through a Contribution;
- acceptance is explicit, idempotent, and reviewable;
- Inbox is a projection of invitations, reviews, failures, delegations, and
  contributions;
- sync has authenticated identity, conflict, audit, privacy, and deletion
  semantics.

### Track C - Publish and Community

#### Gate C1 - Local Share Candidate and Export

Create a user-confirmed, content-addressed share candidate or export package
bound to an immutable Revision/Artifact. It is not a publication and has no
public URL.

#### Gate C2 - Publication, Explore, and Reuse

Add authenticated Publication and a work-native community.

Evidence requirements:

- Publication binds an immutable Version or Artifact;
- private source and credentials cannot enter public metadata;
- import/remix creates new identity and preserved lineage;
- compatibility and availability are explicit;
- comments, reactions, ranking, and profiles are not work authority;
- moderation, privacy, account, sync, and deletion semantics are proven before
  a public network claim.

## Workflow and Runtime Track

This track proceeds in parallel and does not block code creation, saving, or
static preview.

### Gate R1 - Supported Project Adapters

Add explicit preview/test adapters for named project types. A language or
project type is runnable only when its adapter and verification gate exist.

### Gate R2 - Generated-Code Sandbox

Prove termination, CPU/memory/output bounds, minimal environment,
filesystem/network/process deny-by-default, secret isolation, and sanitized
results in a standalone execution boundary.

### Gate R3 - Workflow Version and Composition

Introduce immutable Workflow Version authority binding ordered Tasks, typed
inputs/outputs, dependency plan, Permission requirements, retry/cancellation,
and Artifact flow.

Each workflow execution produces a parent Run and step Runs. Restart must
restore durable state without repeating completed effects. Workflow publish and
reuse depend on the same Review and Publication gates as projects.

### Gate R4 - Multi-Language Execution

Add languages only with real runtime availability, adapter identity, package
evidence, sandbox compatibility, and deterministic verification. Stored code is
never described as safely runnable merely because AI generated it.

## Information Architecture Activation

Navigation follows real evidence:

1. `Projects` and `Settings` - active now.
2. `History/Review` and personal `Activity` - after F4-F7.
3. `Agents` and `Tasks` - after F8-F9 and A1.
4. `Contacts` and `Chat` - after B1.
5. `Spaces` and `Inbox` - after B2.
6. `Share` - after C1.
7. `Explore` - after C2.
8. `Workflows` - after R3.

Future destinations may exist in internal descriptors, but empty or disabled
areas should not be presented as shipped capabilities.

## Release Evidence

Every product-visible gate must include:

- focused unit and boundary tests;
- full repository tests and type checking;
- production renderer build;
- package content verification;
- desktop package canary when Electron authority changes;
- real-provider canary when generation behavior changes;
- restart and corruption tests for durable facts;
- screenshots at desktop, narrow desktop, and mobile-width layouts for visible
  frontend changes;
- exact changed-file review, UTF-8 validation, and a clean git checkpoint.

Server sync, public sharing, arbitrary execution, and background Agents require
additional threat-model, kill-switch, and recovery evidence before release.
