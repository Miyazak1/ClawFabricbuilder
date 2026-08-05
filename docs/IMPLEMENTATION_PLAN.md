# ClawFabric Implementation Plan

## Purpose

This plan turns the product roadmap into independently verifiable engineering
gates. A projection or UI state must never stand in for a missing fact
authority.

The current strategic priority is the trusted coding loop:

```text
read project -> explain current state -> propose plan -> user approves ->
change code -> run approved checks -> repair -> show diff -> save version
```

Community, social, Agent personality, and playful surfaces are later
projections over trusted work facts. They must not consume implementation
priority ahead of the Codex-like personal workbench, and they must not be
described as shipped until their own gates have package, provider, restart,
permission, and review evidence.

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
- the product-level Builder Session/Task Address layer is distinct from raw
  `conversation_id`, `task_id`, and `run_id`, and becomes the scope for future
  fork, clone, handoff, archive, delete, subagent, and cross-session reference
  operations;
- each attempt is a distinct Run with pending, completed, failed, cancelled, or
  interrupted terminal state;
- retries link to prior attempts and never rewrite them;
- no Message, Task, or Run can grant tools, save source, publish, or impersonate
  a Git commit or Project Revision receipt.

The exact interaction contract is defined in
[Builder Conversation and Task Stream MVP](BUILDER_CONVERSATION_TASK_STREAM_MVP.md).
The product address model is defined in
[Builder Session and Task Address Architecture](BUILDER_SESSION_TASK_ADDRESS_ARCHITECTURE.md).
Current address checkpoint: `builder-session-address.v1` and
`builder-task-address.v1` exist as pure main-side contracts only. They validate
future Session/Task product address facts without SQLite persistence, IPC,
preload exposure, migration, fork, archive, delete, provider dispatch, source
mutation, Git mutation, permission grants, or export materialization. The
current address-store checkpoint adds a separate main-only
`builder-session-task-address-store.v1` SQLite store for those already-validated
facts, with idempotent record/replay, restart recovery, schema fingerprint
validation, project-scoped reads, and a foreign-key requirement that Task
Address facts attach to an existing Session Address. It still creates no
renderer/preload IPC, no automatic migration from existing Conversation rows,
no fork/archive/delete/export materialization, no provider/tool dispatch, no
source/Git mutation, and no permission grant. The current runtime composition
checkpoint creates and closes this local store under
`builder-session-task-addresses-v1/session-task-addresses.sqlite` in the desktop
generation runtime, including registration-failure cleanup and dispose cleanup,
but still does not pass address facts into run admission or expose a renderer
lookup channel. The current address-recording checkpoint adds a main-only
`builder-session-task-address-recording-service.v1` bridge that accepts a real
verified `begin_work` Conversation run context and records a product Session
Address plus Task Address into that store. It preserves the low-level
`builder-task:*` as an execution fact only, and still creates no renderer/preload
IPC, provider/tool dispatch, source/Git mutation, permission grant, migration,
archive/delete/fork/export materialization, or renderer lookup. The current
generation-main integration now composes this bridge before provider dispatch
for fresh work and plan contexts. Read-only answers, queued follow-up work,
retry, draft continuation, and approved-plan continuation do not create a new
Session/Task Address; they remain later binding work because they must attach to
an existing product Task Address rather than silently fork a new one.

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
  main-only SQLite, exposes only a sanitized evaluate IPC/renderer port, adds a
  main-only explicit grant primitive for a future approval flow, and keeps
  permission facts, revocation authority, source content, provider state, Git
  evidence, grant commands, and Save authority out of the renderer;
- visible approval must be bound to a selected local project folder/workspace
  before build, plan-source-context, or later tool use can consume the grant;
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
  Revision. If that continuation generation fails with a retryable provider or
  preparation diagnostic after the Review decision was recorded, the visible
  workspace keeps the approved-plan context, explains that the plan was approved
  but no draft was created, and exposes an explicit Retry that re-enters only
  this approved-plan generation path. It does not fall back to generic submit,
  generic draft retry, hidden plan text, source authority, Save authority, or
  Project Revision creation;
- the current main-only plan-proposal generation checkpoint lets the Generation
  main service propose a plan for an existing project without creating a code
  candidate. Main first re-reads the current Git/SQLite project state, starts a
  trusted Conversation work Run, collects bounded private source context through
  the main source-context collector, and then asks the configured provider for
  the plan-only JSON contract. Before that provider work starts, the visible
  desktop workspace asks main to prepare the current Project's source-read
  approval state. The renderer sends only the Project ID; main re-reads the
  selected Project, derives bounded source resource IDs, evaluates
  deny-by-default filesystem-read permission, and returns only `ready` or
  `approval_required` with a file count. If approval is required, the chat flow
  shows one explicit approval card; approving again sends only the Project ID
  and main records the bounded filesystem-read grants through its main-only
  explicit approval primitive. Conversation admits the terminal `plan` result
  only after the source-context result and plan proposal record cross-check.
  The public Generation result exposes bounded plan text and a Conversation
  head, not private source content, plan record bodies/digests, resource IDs,
  permission receipts, provider config, credential, Git candidate evidence,
  Save authority, source mutation, Project Revision authority, or
  renderer-owned authority. The visible desktop workspace can request this
  through controlled active-renderer-bound code-generator IPC/preload/desktop
  port methods, but the renderer sends only bounded user instruction text or the
  selected Project ID. Main derives the selected Project, re-reads the current
  source tree, chooses bounded resource IDs, and returns only the public plan
  result before the renderer re-reads the existing read-only Task Stream;
- the current visible conversation workspace checkpoint makes the main Builder
  surface a continuous conversation workspace with the composer anchored at the
  main content bottom. The composer owns a single primary action: idle turns send
  with Enter or the send button, and active AI work replaces that same action
  with Stop instead of adding a second command in the chat flow. Assistant
  activity, draft review summary, and compact result/artifact summaries remain
  in the chat flow. Full Preview, Changes, Source, Versions, and Logs render in
  a separate right artifact panel that can be opened, closed, switched by tab,
  and resized by the user while preserving a minimum usable chat width. Plan-first
  work is exposed as a secondary composer tool for saved projects, not as a
  second send button. For an unsaved draft, the Review/Save action strip appears
  before the compact result summary and becomes the generation-complete landing
  target, so the next user decision is visible before any large artifact surface.
  Preview and Changes actions open the corresponding artifact tab instead of
  placing large panes inside the conversation scroll. The preview surface
  explicitly marks the first-release static-only runtime boundary, so
  JavaScript, Three.js, canvas, server, network, or backend-dependent drafts can
  explain a blank preview without claiming the generated files failed. Restoring
  a pending draft from project activity uses its own visible restoring state
  before Review appears, without implying a Save. This adds no fake edit command,
  does not add a dedicated code workbench, and still uses only the existing
  read-only task stream, plan review, generation, draft reject, cancel, and
  explicit Save bridges;
- the current build-workspace binding checkpoint keeps logical New project
  conversation available for ordinary chat while requiring an explicit local
  project folder before any build/draft work. The visible composer now includes
  a current project/workspace chip. If no saved/opened project or working local
  project is selected, clear build intent opens that picker, preserves the
  user's text, and calls no generator or folder dialog. Choosing New project
  from the picker is the explicit entry into the main-owned folder-selection
  path. Cancellation fails closed with a fixed project-workspace-required
  diagnostic when the controller path is invoked: it calls no generator, creates
  no draft, grants no permission, saves no Version, and writes no substitute
  project. Successful selection records a main-owned workspace binding in
  SQLite, creates or reuses the local Git project under that folder, and exposes
  only the resulting Project identity plus bounded public title/source-folder
  summary to the renderer as a working project. Renderer code still cannot send
  a path, write a project receipt, grant
  permission, create Git evidence, or make the project saved. Explicit Save is
  still the only path from a candidate to a verified Git/SQLite Project
  Revision;
- the current live activity notification checkpoint emits a project-id-only
  Task Stream change hint from main after a Conversation append has been
  durably recorded and replay-verified. The renderer can subscribe through the
  exact preload task-stream namespace and then re-read the existing read-only
  Task Stream. The desktop conversation controller owns that subscription for
  the visible project, retains the existing chat flow while refreshing, and
  queues a follow-up refresh when another hint arrives during an active read.
  The notification carries no source, receipt, provider, credential, tool
  output, save, Git, or revision authority and cannot create or accept work;
- the current generation-started live-binding checkpoint emits a main-owned
  started hint after a generation request has been durably bound to a Project
  Conversation. The renderer may match that request digest to its own active
  composer turn and use the included Project ID only to refresh the existing
  read-only Task Stream for active saved-project work; the hint carries no
  source, receipt, provider, credential, tool output, save, Git, revision, or
  project-save authority and does not mark the project saved;
- the current conversation-grounded prompt checkpoint upgrades the bounded
  prompt conversation brief to `builder-conversation-brief.v3`. Main-owned
  generation prompt construction still receives only replayed Conversation
  events and excludes the current request turn, but it now derives both a
  structured `latest_plan` object with `proposed`, `approved`, or `rejected`
  state and a bounded `working_brief` object from durable task briefs or
  approved plans.
  Code generation prompts may use an approved latest plan and may use
  `working_brief` when the user gives a contextual approval such as "按刚才说的做",
  but must not treat merely proposed or rejected plans as write approval. A
  contextual implementation target now comes only from a durable task capsule
  brief or an approved plan; ordinary chat transcript, assistant proposal
  wording, or preview-blank diagnosis remain available as recent chat entries
  but are not promoted into an implementation target. This adds no renderer authority, IPC/preload surface, provider/credential
  exposure, source mutation, Git evidence, Save authority, or Project Revision
  fact; it only makes the existing main-owned prompt context more faithful to
  the conversation;
- the current task-brief checkpoint adds a durable `task_brief_updated`
  Conversation fact for `update_brief` turns after the assistant explanation has
  completed. This stores a bounded `builder-task-capsule.v1` with
  `builder-working-brief.v1` context that can survive restart and be used by
  later contextual execution phrases. The fact is still not execution, not Save,
  not Git evidence, not a Project Revision, and not provider/source authority;
  the renderer receives only a compact task-brief projection and cannot forge or
  promote route decisions;
- the current task-capsule contract checkpoint extracts those bounded brief
  shapes into a shared main-side verifier and adds a pure
  `builder-task-capsule-update.v1` evidence record. This keeps Conversation,
  future SQLite stores, route decisions, and Agent context snapshots aligned
  without creating a new IPC/preload surface, Conversation append command,
  SQLite write, provider dispatch, source/Git mutation, permission grant,
  Review, Revision, or renderer authority;
- the current task-capsule store checkpoint persists
  `builder-task-capsule-update.v1` records in a main-only
  `builder-task-capsule-store.v1` SQLite store. It supports idempotent
  record/replay, read-by-update, latest Project capsule, task-scoped history,
  schema fingerprint validation, and restart recovery, while still creating no
  IPC/preload surface, renderer authority, Conversation append command, build
  admission, provider/tool dispatch, source/Git mutation, permission grant,
  Review, Revision, Artifact, command execution, or network authority;
- the current task-capsule recording-service checkpoint composes replayed
  Conversation events with the main-only Task Capsule store. It accepts an
  already-existing event window, verifies the target `task_brief_updated`
  sequence, derives a `builder-task-capsule-update.v1`, records it
  idempotently, and reads it back after restart. This is still context
  durability only: it adds no IPC/preload surface, renderer authority,
  Conversation append command, build admission, provider/model/tool dispatch,
  source/Git mutation, permission grant, Review, Revision, Artifact, command
  execution, network access, credential handling, or community/social surface;
- the current generation-main recording integration wires that recording service
  as an optional main-owned dependency. After an answer turn completes, it
  records only a newly appended `task_brief_updated` event into the Task Capsule
  store; ordinary read-only answers and older historical brief events do not
  create new records. The integration still adds no renderer/preload IPC,
  provider/model/tool dispatch, build admission, source/Git mutation,
  permission grant, Review, Revision, Artifact, command execution, network
  access, credential handling, or community/social surface;
- the current generation IPC runtime checkpoint creates the local
  `builder-task-capsules-v1/task-capsules.sqlite` store under app user data,
  composes the recording service, passes it into generation main, and closes the
  store on registration failure or runtime dispose. This makes real desktop
  answer turns use the same main-owned Task Capsule durability path without
  adding a renderer channel, preload surface, provider/tool dispatch,
  source/Git mutation, permission grant, Review, Revision, Artifact, command
  execution, network access, credential handling, or community/social surface;
- the current Task Capsule route fallback checkpoint lets generation main use
  the latest ready Task Capsule store record as supplementary main-owned route
  evidence when task-stream projection is unavailable or not enough to prove a
  contextual build phrase. It does not put store text directly into the prompt:
  build prompt context still comes from replayed Conversation events and the
  generated build-context snapshot remains prompt context only, not permission,
  source, Git, Review, Revision, or renderer authority;
- the current build-context snapshot checkpoint adds a prompt-safe derived
  `builder-build-context-snapshot.v1` to code-generation prompts. It is
  recomputed only from the already-bound Conversation event window and current
  request digest, and records public routing shape such as route, dispatch,
  fixed public allowlisted matched signal names, execution basis, workspace
  basis, working-brief availability, latest-plan state, and unavailable
  command/network capabilities.
  It deliberately excludes route-decision ids, message/run ids, event digests,
  provider details, credentials, Git receipts, source-tree digests, Save facts,
  and Project Revision evidence. The snapshot lets prompt construction preserve
  why a build is allowed to use a working brief, task brief, approved plan,
  current artifact defect, or explicit instruction without becoming permission
  admission, tool execution, Git mutation, Save, renderer authority, or a new
  Conversation fact;
- the current build-context snapshot contract checkpoint extracts that prompt
  snapshot into a main-side pure contract module with independent sanitization
  and tests. Generation still recomputes this prompt snapshot from the current
  Conversation event window at prompt construction time; it remains prompt
  context only and cannot grant read/write/command/network permissions;
- the current run-context snapshot checkpoint records a durable
  `builder-run-context-snapshot.v1` Conversation fact immediately after a Run
  starts and before provider progress, tool facts, interruption, cancellation, or
  terminal outcome. The fact is main-only, digest-bound, replay-validated, and
  stores only the public route shape, included current message id, optional task
  capsule source message id, task-brief reference, base-revision reference,
  permission result, and unavailable command/network capabilities. The renderer
  receives only a compact
  `run_context_snapshot_recorded` Task Stream projection and never sees the
  snapshot id, context digest, route decision id, provider, credential, source
  tree, Git receipt, Save authority, raw prompt, or Project Revision evidence.
  This creates the first durable "why this run had context" receipt while still
  granting no read/write/command/network permission and exposing no snapshot read
  IPC/preload surface. The current route-identity checkpoint also makes the
  snapshot contract fail closed when the embedded RouteDecision belongs to a
  different Project, user message, or low-level run task. Prior Task Capsule
  brief references may still carry a different low-level `task_id` because the
  current Builder uses those ids as execution facts, not the final product-level
  Session/Task Address boundary. Product-level unrelated-task exclusion remains
  tied to the Session/Task Address rollout instead of overloading the current
  conversation `task_id`;
- the current route-signal contract checkpoint moves `matched_signals` from a
  broad formatted string into the fixed public Builder route-signal vocabulary.
  Conversation records, main-owned route hints, and prompt snapshots all share
  that allowlist, so renderer-provided hints, test fixtures, provider labels,
  credentials, route-decision ids, receipts, or other internal evidence cannot
  become durable route signal facts or provider prompt context. Existing public
  routing meaning such as `read_only`, `clear_build`, `exploratory_work`,
  `contextual_build`, `current_artifact_defect`,
  `current_artifact_direct_change`, `pending_build_confirmation`,
  `composer_mode_plan`, and `goal_mode_request` remains available for tests,
  debugging, task capsules, and later "why this built" diagnostics without
  becoming provider, Git, source, Save, IPC, or permission authority. The
  current parity guard also scans renderer and main classifier source for
  hard-coded route signals and fails if any classifier signal is not in that
  public vocabulary, so UI modes and main fallback evidence cannot silently
  drift apart. The semantic parity guard adds a shared route-decision fixture
  consumed by both renderer and main-service tests, proving representative chat,
  clarify, brief, plan fallback, future Goal-boundary, build, Markdown artifact,
  current-artifact direct change, standalone confirmation, and missing-context
  downgrade cases through their real boundaries instead of relying on parallel
  keyword tests;
- the current composer contextual-execution checkpoint aligns renderer routing
  with that plan-state contract. Contextual phrases such as "do it",
  "好，开始吧", "就照这个来", or "按刚才说的做" may enter build only when
  the visible conversation has live build context that is not blocked by a
  newer proposed or rejected plan. A proposed plan result must still go through
  the plan review authority, either via the visible approve/reject action or an
  explicit contextual composer approval phrase. It cannot become an ordinary
  build submit, and a rejected plan cannot be revived by a short execution
  phrase. The visible renderer guard is backed
  by a main-owned submit guard: for contextual execution phrases, main re-reads
  the renderer-safe Task Stream projection and permits build only when that
  projection contains an approved plan, a durable task-brief update, or a
  current proposed candidate/result context. Missing, malformed,
  transcript-only, or explanatory-only context falls
  closed to ordinary answer. Capability or discussion questions such as
  "Can you build a login page?", "Should we create a dashboard first?", or
  "可以帮我做一个登录页吗？" also remain chat turns even when a source folder is
  already bound; a bound workspace is only a build prerequisite, not an intent
  amplifier. The main-owned prompt brief keeps natural exploration goals
  such as "我想先聊一下这个作品集首页怎么做，目标是..." as conversation entries,
  but a later contextual execution phrase can use them only after an
  `update_brief` turn records the durable task capsule or a plan is approved.
  Read-only exploratory diagnosis such as
  "我想知道这个网站为什么预览空白。" remains explanation context even if the
  assistant answer begins with "可以先查看..."; a later "开始吧" after that
  diagnosis still falls closed to answer. This creates no renderer-owned draft, provider
  call, Git evidence, Save fact, Project Revision, IPC/preload surface, or
  compatibility path;
- the current internal working-brief checkpoint projects that same conversation
  grounding into contextual-build readiness without creating a new authority.
  Renderer derives approved-plan, current-result, and task-brief availability
  from the already-sanitized Task Stream window, but does not render a default
  `Current brief` block or clear button in the desktop composer. The composer
  must not expose internal IDs, digests, provider, credential, source tree, Git,
  or receipt evidence as memory UI. A short phrase such as "按刚才方案做" can use
  the internal brief only when the sanitized conversation facts support it. This
  keeps ordinary chat natural while preserving the main-owned submit guard above;
- the current explicit brief-entry checkpoint makes `Brief` in the
  composer `+` menu a real user-visible path into that same task capsule flow.
  Selecting it never sends a message, creates a draft, saves a revision, grants
  write permission, or adds a second submit button. It only scaffolds the current
  composer text into an explicit brief-update phrase such as
  "保存这个方向，后面按这个来：...". Renderer routing and the main-owned submit
  fallback both recognize the fixed public `explicit_brief` signal and route it
  to `update_brief` / `brief_update`, so the durable task capsule remains
  main-owned and no hidden renderer-only route truth is introduced. This is not
  Goal mode: a Goal is a future persistent-agent commitment to continue working,
  verify, and report progress until done or blocked, not a working brief or
  one-shot build request;
- the current natural plan request checkpoint routes explicit plan-first wording
  such as "帮我先做下方案", "先给我一个方案", or "Plan this first" through the
  renderer plan proposal path instead of the automatic build path. This works
  for either a saved project or a bound local workspace before its first saved
  version; Save Version is not a planning prerequisite. The main-owned
  `submit` fallback recognizes the same public `explicit_plan` signal but fails
  closed to a read-only `clarify` route, because `submit` is not the authority
  for plan proposal evidence and must not create a draft, Git candidate, Save
  fact, Project Revision, or compatibility path from a plan request;
- the current durable run-progress checkpoint records fixed main-owned Run
  progress stages (`context_ready`, `provider_request_started`,
  `provider_response_received`, `result_preparing`) before terminal generation,
  explanation, or plan-first proposal results. These stages advance the trusted
  Conversation context head and appear in the read-only Task Stream as
  lightweight status rows, but they carry no provider envelope, prompt, token
  delta, credential, source, Git, Save, or Project Revision authority. Real
  plan-first source context can now proceed only through the visible,
  selected-Project-bound source-read approval path above; generation must not
  silently create those grants from renderer selection or a composer submit, and
  this approval does not grant arbitrary tool, network/process, write, Save, or
  Project Revision authority;
- the current main-only steering fact checkpoint records a bounded user
  steering message against the currently trusted active Run context, advances the
  SQLite Conversation event head, and exposes only the renderer-safe
  `turn_steered` projection through the existing read-only Task Stream. It does
  not mutate an already-issued provider request, dispatch a tool, read source,
  create a Git candidate, create or accept a Review, save a Project Revision, or
  grant provider, Git, source, or Save authority;
- the current controlled steering bridge checkpoint exposes that steering fact
  through one active-renderer-bound code-generator IPC/preload/desktop port
  method. The renderer may send only `request_id` plus bounded user text; main
  rebinds the request digest to the trusted active Run context before appending
  any event. A missing active request returns an inert `steered: false` result,
  malformed payloads fail with fixed redacted errors, and final candidate or
  explanation recording uses the latest steered Conversation head. This still
  does not mutate an already-issued provider request or consume the steering
  text inside the provider/tool loop. The current desktop composer calls it only
  after live work has been bound to a Project Conversation and presents the
  action as adding context, not as changing the already-issued provider request;
- the current main-only queued-follow-up fact checkpoint records a bounded user
  follow-up message against the same trusted active Run context and exposes only
  the renderer-safe `turn_followup_queued` / `message_kind: queued_followup`
  projection through the read-only Task Stream. It is a durable conversation
  fact for "run this after the current work", not an executor: the renderer can
  record it only through a controlled request-id-only IPC/preload
  `queueFollowup` command, and it starts no second Run, mutates no issued
  provider/tool request, reads or writes no source, creates no Git candidate,
  grants no permission, and creates no Save, Review, Project Revision, branch, or
  compaction fact;
- the current queued-follow-up consumption checkpoint adds a durable
  `turn_followup_consumed` receipt to records, canonical replay, Task Stream
  projection, renderer sanitization, and compact UI. It proves that a queued
  message was handed to a later submitted turn before that turn started a Run,
  but it still does not choose a route, bypass workspace/write admission, invoke
  a provider/tool, or auto-dispatch after restart;
- the current queued-follow-up begin checkpoint adds a Conversation main-service
  path that can start a normal work/question Run from a queued follow-up only by
  appending `turn_submitted`, `turn_followup_consumed`, and `run_started` in a
  single replay-verified event chain. This gate is main-only, has no IPC/preload
  command, grants no permission, reads or writes no source, dispatches no
  provider/tool, and does not run queued follow-ups automatically after restart;
- the current queued-follow-up dispatch receipt checkpoint makes successful
  `queueFollowup` return only a bounded main-recorded reference
  (`turn_id`/`run_id`/`message_id`). When the renderer later re-enters the normal
  submit/answer path after active work becomes terminal, that reference can be
  carried through workspace and write-permission admission and consumed by main
  before the new provider request starts. Main still reclassifies the user text,
  enforces selected-project/write gates, and lets Conversation replay verify the
  queued message; draft-to-draft continuation consumption remains a separate
  future gate rather than being disguised as a normal work turn;
- the current active-answer admission checkpoint keeps explicit build/change
  commands out of the steering path while a read-only answer is running. The
  renderer prefers queued follow-up route evidence for non-cancel input during
  active work; when the active status is `answering` and the intent router
  classifies the new message as `build`, the composer records local route
  evidence, clears the accepted input, shows a queued-build notice, and
  dispatches it only after the read-only answer has terminally left the active
  path. The queued dispatch then
  re-enters the normal route, workspace, and current-project write permission
  checks before any `submit`, provider, Git, SQLite, Save, Review, command, or
  permission authority can run;
- the current provider-output streaming checkpoint lets the main-only
  OpenAI-compatible transport request bounded `text/event-stream` responses only
  when the Generation host supplies an internal observer. The transport assembles
  the same terminal generated text contract while emitting advisory bounded raw
  delta text to main-side observers; Generation main service now reduces that
  main-only raw output to top-level display text from the approved generation
  result shape and exposes only a renderer-safe live output event through exact
  IPC/preload. Once main has durably bound the generation start to the active
  Project Conversation, the desktop chat flow shows a single assistant waiting
  reply before the first display-safe delta arrives; later safe deltas replace
  that waiting text in the same assistant row. The same visible waiting path is
  covered for approved-plan continuation after the user approves a proposed
  plan, so plan review does not fall back to an invisible background step. The
  same output path now covers plan-first proposal text after source-context
  collection has bound the trusted work Run, without adding durable provider
  progress events to the plan admission contract. This live output is ephemeral
  conversation UI, not durable Task Stream fact, and carries no raw provider
  envelope, prompt, credential, source, plan record evidence, Git, Save, or
  Project Revision authority. The desktop chat flow now keeps the durable
  `run_started` / `run_progress_recorded` status row visible beside this
  ephemeral live provider output, so provider text does not hide fact-backed
  progress. Empty live-output waiting rows are suppressed once a Task Stream
  status row is visible, so the UI does not duplicate "working" copy before the
  provider has emitted display-safe text. Tool streaming and arbitrary execution
  remain later independent protocols;
- the current renderer-safe tool activity projection turns admitted Task Stream
  tool request/result facts into ordinary conversation status language. Pending
  requests remain visible as project steps; once the matching fixed-code result
  is recorded, the request row folds into one final result row. This is a
  read-only projection only: it adds no tool dispatch, raw-output exposure,
  provider call, source mutation, Git evidence, Save authority, or Project
  Revision authority;
- the current draft-continuation checkpoint lets the visible single composer
  keep modifying an unsaved draft without saving or discarding it first. The
  renderer can request this only with a pending `draft_id` and new instruction;
  main revalidates the selected project, pending draft/candidate identity,
  resulting tree digest, current Conversation head, and pending Review state
  before replacement generation. Preparing the admission starts no replacement
  Run, releases no prior candidate, dispatches no provider or tool, exposes no
  source tree or source text, mutates no Git or SQLite Project Revision fact,
  and accepts no Review. Generation main service can also
  prepare a separate pending-candidate base from verified Git candidate
  evidence: it can read the verified source tree and parent candidate
  commit/tree OIDs for future draft-to-draft generation, while explicitly
  marking that base as not a Project Revision, not a Save receipt, and not a
  renderer-safe payload. Preparing that base still starts no replacement Run,
  dispatches no provider/tool, mutates no source, and creates no new Git
  candidate. Conversation main service now consumes the admission only after it
  revalidates the current Conversation head, the unreviewed pending candidate,
  and the matching candidate digest/tree evidence, then appends a new work
  Turn/Run for the requested replacement. That start gate still dispatches no
  provider/tool, reads no source, mutates no Git, creates no candidate, accepts
  no Review, creates no Save/Project Revision, and opens no IPC/preload/renderer
  command. The current draft-to-draft generation checkpoint consumes that
  admission plus the verified pending candidate source tree through a main-only
  host path. Provider prompting is based on the pending candidate source, while
  the final unsaved candidate is squashed back onto the current product base
  revision or empty bound project base before Git evidence is persisted. This
  preserves Save/History/SQLite semantics by not treating a pending candidate as
  a saved Project Revision. The path records a fresh Conversation work Run,
  fixed progress stages, a new unsaved Git candidate, and a candidate result,
  but still exposes no renderer source, receipt, provider envelope, credential,
  Save authority, Project Revision authority, or `main` projection. The IPC and
  preload affordance accepts only `{ draft_id, instruction }`; the renderer does
  not provide project id, request digest, source tree, Save receipt, actor, time,
  or authority;
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

Current checkpoint:

- the local Agent definition contract introduces pure main-side records for
  owner-bound Agent identity, Agent version, and lifecycle status decisions. It
  deterministically binds the owner, Agent id, version instructions, explicit
  permission-required boundary, and archive/revoke/reactivate-style lifecycle
  facts through canonical digests;
- the current Agent definition store persists those records in a strict
  main-only SQLite store with restart restore, idempotent replay,
  owner-scoped reads, version ordering, lifecycle finality after revocation,
  schema fingerprint verification, and fixed redacted failures. It exposes no
  IPC/preload, shows no Agents UI, supervises no Tasks/Runs, dispatches no
  providers or tools, reads no credentials or source, mutates no Git or Project
  Revision facts, grants no permissions, and creates no Review/Artifact
  authority. A visible Agent or Agent assignment must build on this store
  instead of introducing an incompatible identity shape.
- the current Agent Goal contract adds pure main-side records for a bounded
  continuous objective. It binds one Agent version, owner, Project/
  Conversation/Task identity, explicit permission-required boundary, owner
  supervision, `continuous_until_done_or_blocked` execution semantics,
  owner-review-required completion, bounded steps/runs/tool/runtime/private-
  source budget, and owner-made Goal status decisions such as active, blocked,
  completed, paused, or cancelled. It exposes no IPC/preload, persists no rows,
  creates no Agent assignment or Run, dispatches no providers or tools, grants
  no permissions, reads no credentials or source, writes no files, mutates no
  Git or Project Revision facts, and creates no Review/Artifact authority.
- the current Agent Goal store persists those Goal and status records in a
  strict main-only SQLite store with restart restore, idempotent replay,
  owner-scoped reads, task-scoped listing, one Goal per owner/Project/Task/
  Agent identity, ordered proposed/active/paused/blocked/completed/cancelled
  status transitions, terminal finality after completion or cancellation,
  schema fingerprint verification, and fixed redacted failures. It opens no
  IPC/preload path, shows no visible Goal UI, creates no Agent assignment or
  Run, dispatches no provider/model or tool, grants no permissions, reads no
  credentials or source, writes no files, mutates no Git or Project Revision
  facts, and creates no Review/Artifact authority.
- the current Agent Goal-to-Assignment admission contract adds a pure main-side
  receipt that can bind one active Goal status to one owner-supervised
  Assignment candidate. It requires the Assignment objective to match the Goal
  objective, narrows Assignment budgets under the Goal budget, preserves Project/
  Conversation/Task/Run identity, and records that Assignment storage is still
  required before execution. It opens no IPC/preload path, shows no Goal UI,
  persists no rows, creates no Assignment or Run by itself, dispatches no
  provider/model or tool, grants no permissions, reads no credentials or source,
  writes no files, mutates no Git or Project Revision facts, and creates no
  Review/Artifact authority.
- the current Agent Goal-to-Assignment admission store persists those admission
  receipts in a strict main-only SQLite store with restart restore, idempotent
  replay, owner-scoped reads, read-by-Assignment lookup, task-scoped listing,
  one admission per Assignment candidate, schema fingerprint verification, and
  fixed redacted failures. It stores only canonical Goal, Goal status,
  Assignment, and admission receipts; opens no IPC/preload path; shows no Goal
  UI; records no Assignment row; starts no Run or execution; dispatches no
  provider/model or tool; grants no permissions; reads no credentials or
  source; writes no files; mutates no Git or Project Revision facts; and
  creates no Review/Artifact authority.
- the current Agent Goal-to-Assignment materialization contract adds a pure
  main-side receipt that proves an admitted Assignment candidate has been
  recorded in the Agent Assignment store with exactly its initial `queued`
  owner-supervised status. It binds the Goal admission receipt to Assignment
  store read evidence and fails closed if the assignment is absent, already
  progressed, not store-backed, owner-mismatched, or timestamp-mismatched. It
  opens no IPC/preload path, shows no Goal UI, starts no Run or execution,
  dispatches no provider/model or tool, grants no permissions, reads no
  credentials or source, writes no files, mutates no Git or Project Revision
  facts, and creates no Review/Artifact authority.
- the current Agent Goal-to-Assignment materialization store persists those
  materialization receipts in a strict main-only SQLite store with restart
  restore, idempotent replay, owner-scoped reads, read-by-Assignment lookup,
  read-by-admission lookup, task-scoped listing, one materialization per
  admission and Assignment, schema fingerprint verification, and fixed
  redacted failures. It stores only canonical Goal, Goal status, admission,
  Assignment store read, and materialization receipts; opens no IPC/preload
  path; shows no Goal UI; starts no Run or execution; dispatches no providers,
  models, or tools; grants no permissions; reads no credentials or source;
  writes no files; mutates no Git or Project Revision facts; and creates no
  Review or Artifact authority.
- the current Agent Goal-to-Assignment materialization service composes the
  admission store, Assignment store, and materialization store as a main-only
  gate. It records or replays the active-Goal admission, records or replays the
  Assignment and its initial `queued` status, re-reads the store-backed queued
  Assignment, creates the materialization receipt, and records or replays that
  receipt for restart recovery. It opens no IPC/preload path, shows no Goal UI,
  starts no Run or execution, dispatches no providers, models, or tools, grants
  no permissions, reads no credentials or source, writes no files, mutates no
  Git or Project Revision facts, and creates no Review or Artifact authority.
- the current Agent assignment contract adds pure main-side records for binding
  one owner-approved Agent version to one Project/Conversation/Task/Run with an
  explicit permission-required boundary, owner supervision, review-before-save
  result contract, bounded steps/tool/runtime/private-source budget, and
  owner-made assignment status decisions. It exposes no IPC/preload, persists no
  rows, dispatches no providers or tools, grants no permissions, reads no
  credentials or source, and mutates no Git, Project Revision, Review, or
  Artifact authority.
- the current Agent assignment store persists those assignment and status
  records in a strict main-only SQLite store with restart restore, idempotent
  replay, owner-scoped reads, task-scoped listing, duplicate Agent/Run
  protection, ordered queued/active/paused/cancelled/completed status
  transitions, schema fingerprint verification, and fixed redacted failures. It
  exposes no IPC/preload, shows no Agents UI, dispatches no providers or tools,
  grants no permissions, reads no credentials or source, mutates no Git or
  Project Revision facts, and creates no Review/Artifact authority.
- the current Agent assignment supervision service composes the Assignment
  store and Agent supervision lease store as a main-only activation evidence
  gate. It reads the store-backed queued Assignment, preflights the active
  supervision lease and current time window before changing Assignment state,
  records or replays the Assignment's `active` status, records or replays the
  active lease, and recovers through idempotent store replay. It opens no
  IPC/preload path, shows no Agents UI, starts no Run or execution, dispatches
  no providers, models, or tools, grants no permissions, reads no credentials
  or source, writes no files, mutates no Git or Project Revision facts, and
  creates no Review or Artifact authority.
- the current Agent supervision lease store persists those lease and release
  records in a strict main-only SQLite store with restart restore, idempotent
  replay, owner-scoped reads, one unreleased and unexpired lease per assignment,
  monotonic lease epochs, schema fingerprint verification, and fixed redacted
  failures. It opens no IPC/preload path, shows no Agents UI, starts no
  provider/tool execution, reads no credentials or source, grants no permissions,
  and mutates no Git, Project Revision, Review, or Artifact authority.
- the current Agent project work result contract adds a pure main-side receipt
  for a supervised active assignment lease returning either a project edit
  candidate or project test/check plan to owner review. It binds the result to
  the Agent version, Assignment, active status, lease, Project/Conversation/
  Task/Run identity, and lease time window; records only fixed review summaries;
  and keeps materialization behind explicit owner review. It opens no IPC/preload
  path, shows no Agents UI, dispatches no provider or model call, reads no
  credentials or source, writes no files, runs no process or tests, mutates no
  Git or Project Revision facts, and creates no Review/Artifact authority.
- the current Agent project work result store persists those receipts in a
  strict main-only SQLite store with restart restore, idempotent replay,
  owner-scoped result reads, task-scoped result listing, one result per
  supervision lease, schema fingerprint verification, and fixed redacted
  failures. It stores only indexed identity plus canonical contract receipts,
  opens no IPC/preload path, shows no Agents UI, dispatches no provider/model or
  tool, reads no credentials or source, writes no files, runs no process or
  tests, mutates no Git or Project Revision facts, and creates no
  Review/Artifact authority.
- the current Agent budget audit contract adds a pure main-side receipt for
  checking an active assignment's budget before the next supervised Agent
  action. It binds the assignment budget snapshot, active status, supervision
  lease, Project/Conversation/Task/Run identity, current usage counters, and
  requested next action; emits only fixed allowed/denied outcomes and redacted
  summaries; and performs no next action. It opens no IPC/preload path, shows no
  Agents UI, dispatches no provider/model or tool, reads no credentials or
  source, writes no files, runs no process or tests, mutates no Git or Project
  Revision facts, and creates no Review/Artifact authority.
- the current Agent budget audit store persists those receipts in a strict
  main-only SQLite store with restart restore, idempotent replay, owner-scoped
  audit reads, task-scoped and lease-scoped audit listing, schema fingerprint
  verification, and fixed redacted failures. It stores only indexed identity,
  bounded usage counters, and canonical contract receipts; opens no IPC/preload
  path; shows no Agents UI; dispatches no provider/model or tool; reads no
  credentials or source; writes no files; runs no process or tests; mutates no
  Git or Project Revision facts; and creates no Review/Artifact authority.
- the current Agent budget audit service composes the active supervision lease
  read and Budget Audit store as a main-only pre-action evidence gate. It
  creates an allowed or denied budget audit only when the supplied active
  Assignment status, supervision lease, and requested usage/outcome contract
  match a currently active store-backed lease at the observed time, records or
  replays that audit, and verifies it through read-by-audit and lease-scoped
  listing. It opens no IPC/preload path, shows no Agents UI, dispatches no
  provider/model or tool, performs no requested next action, grants no
  permissions, reads no credentials or source, writes no files, runs no process
  or tests, mutates no Git or Project Revision facts, and creates no Review or
  Artifact authority.
- the current Agent project work result service composes the active supervision
  lease read, Supervised Action Admission store, allowed Budget Audit read, and
  Project Work Result store as a main-only owner-review result gate. It creates
  project-edit or project-test result receipts only when a store-backed
  supervised action admission requested `finish_for_review`, points to the
  later Project Work Result gate, belongs to the same Project/Conversation/Task/
  Run and active lease, and its referenced budget audit also allowed
  `finish_for_review` before the result time. The service records or replays
  that fixed-summary result and verifies it through action admission reads,
  budget audit reads, read-by-result, and task-scoped listing. It opens no
  IPC/preload path, shows no Agents UI, dispatches no provider/model or tool,
  grants no permissions, reads no credentials or source, writes no files, runs
  no process or tests, mutates no Git or Project Revision facts, creates no
  generic Review row, and creates no Artifact or materialized source authority.
- the current Agent project work result review contract adds a pure main-side
  owner decision receipt over one recorded project work result. It can approve
  a proposed project-edit or project-test result for a later materialization
  gate, reject it, or acknowledge a blocked/failed result without
  materialization. It binds the decision to the Agent version, Assignment,
  active status, supervision lease, result receipt, Project/Conversation/Task/
  Run identity, owner, decision time, fixed result summary, and fixed decision
  summary; it creates no generic Review row, Artifact, source materialization,
  check run, Git fact, Project Revision, provider/tool dispatch, permission
  grant, IPC/preload path, or visible Agents UI.
- the current Agent project work result review store persists those owner
  decision receipts in a strict main-only SQLite store with restart restore,
  idempotent replay, owner-scoped reads, read-by-result lookup, task-scoped
  review listing, one review per work result, schema fingerprint verification,
  and fixed redacted failures. It stores only indexed identity plus canonical
  result/review receipts; it creates no generic Review row, Artifact, source
  materialization, check run, Git fact, Project Revision, provider/tool
  dispatch, permission grant, IPC/preload path, or visible Agents UI.
- the current Agent project work result review service composes the Project
  Work Result store and Project Work Result review store as a main-only
  owner-decision gate. It accepts only an owner id, work result id, review
  input, and decision time; reads the store-backed project work result; verifies
  task-scoped result listing; creates and records or replays the owner decision
  receipt; and verifies read-by-review, read-by-result, and task-scoped review
  listing. It creates no generic Review row, Artifact, source materialization,
  check run, Git fact, Project Revision, provider/tool dispatch, permission
  grant, IPC/preload path, or visible Agents UI.
- the current Agent project work result review release service composes the
  Project Work Result review store and Agent Supervision Lease store as a
  main-only lease-close gate. It accepts only an owner id, work result review
  id, and close time; reads the store-backed owner review decision; verifies
  task-scoped review listing; records or replays a completed supervision lease
  release for the reviewed result; and verifies the lease read and assignment
  lease projection no longer expose an active lease at the close time. It
  creates no generic Review row, Artifact, source materialization, check run,
  Git fact, Project Revision, provider/tool dispatch, permission grant,
  Assignment status change, IPC/preload path, or visible Agents UI.
- the current Agent project work result review assignment close service
  composes the Assignment store, Project Work Result review store, and Agent
  Supervision Lease store as a main-only assignment-close gate. It accepts only
  an owner id, work result review id, completed Assignment status input, and
  close time; reads the store-backed owner review decision; requires the
  reviewed supervision lease to have a completed release; verifies no active
  assignment lease remains at the close time; records or replays the
  Assignment's `completed` status; and verifies assignment/task listing. It
  creates no Goal status, generic Review row, Artifact, source materialization,
  check run, Git fact, Project Revision, provider/tool dispatch, permission
  grant, IPC/preload path, or visible Agents UI.

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

Current checkpoint:

- the current Agent Delegation contract adds a pure main-side receipt for
  scoped Agent-to-Agent delegation. It binds the active parent assignment,
  parent assignment status, parent supervision lease, target Agent definition
  and version, parent/child Conversation/Task/Run identity, the owner, project,
  permission intersection, child budget intersection, cancellation propagation,
  and review-before-parent-materialization result boundary. It creates no child
  assignment store row, opens no IPC/preload path, shows no Agents UI, grants no
  permission, dispatches no provider/model or tool, reads no credentials or
  source, writes no files, runs no process or tests, mutates no Git or Project
  Revision facts, and creates no Review/Artifact authority.
- the current Agent Delegation store persists those receipts in a strict
  main-only SQLite store with restart restore, idempotent replay, owner-scoped
  reads, parent-task and child-task listing, child Task/Run duplicate
  protection, schema fingerprint verification, and fixed redacted failures. It
  stores only indexed identity plus canonical contract receipts; creates no
  child assignment store row; opens no IPC/preload path; shows no Agents UI;
  grants no permission; dispatches no provider/model or tool; reads no
  credentials or source; writes no files; runs no process or tests; mutates no
  Git or Project Revision facts; and creates no Review/Artifact authority.
- the current Agent Delegation service composes the Agent Definition store,
  Assignment store, Supervision Lease store, and Delegation store as a
  main-only delegation-recording gate. It reads the store-backed active parent
  Assignment, verifies task assignment listing, requires a currently active
  supervision lease for the parent Assignment, reads the active target Agent
  and current version, records or replays the Delegation receipt, and verifies
  parent-task and child-task Delegation listings. It creates no child
  Assignment or child Run, opens no IPC/preload path, shows no Agents UI,
  grants no permission, dispatches no provider/model or tool, reads no
  credentials or source, writes no files, runs no process or tests, mutates no
  Git or Project Revision facts, and creates no Review/Artifact authority.
- the current Agent Delegation result contract adds a pure main-side receipt
  for returning a delegated child Task result to the parent Task review
  boundary. It binds the Delegation receipt, parent/child Conversation/Task/Run
  identity, owner, project, result status, fixed display summary, and
  no-direct-parent-mutation materialization boundary. It carries no raw child
  output, patch, source tree, provider output, credential, permission grant,
  child assignment, Review, Artifact, Git, or Project Revision authority.
- the current Agent Delegation result store persists those return receipts in a
  strict main-only SQLite store with restart restore, idempotent replay,
  owner-scoped reads, parent-task and child-task result listing, one result per
  Delegation receipt, schema fingerprint verification, and fixed redacted
  failures. It stores only indexed identity plus canonical Delegation/result
  receipts; opens no IPC/preload path; shows no Agents UI; grants no
  permission; dispatches no provider/model or tool; reads no credentials or
  source; writes no files; runs no process or tests; mutates no Git or Project
  Revision facts; and creates no Review/Artifact authority.
- the current Agent Delegation result service composes the Delegation store and
  Delegation result store as a main-only result-return gate. It accepts only an
  owner id, Delegation id, result input, and observation time; reads the
  store-backed Delegation receipt; verifies parent-task and child-task
  Delegation listings; records or replays the child result-return receipt; and
  verifies read-by-result plus parent-task and child-task result listings. It
  creates no child Assignment, child Run, parent materialization, generic
  Review row, Artifact, source materialization, check run, Project Revision, Git
  mutation, provider/model dispatch, tool call, permission grant, IPC/preload
  command, or visible Agents UI.
- the current Agent Delegation result admission contract adds the local
  Contribution-like admission receipt for a returned child result. It binds the
  Delegation result receipt, parent/child Conversation/Task/Run identity,
  owner, project, fixed result summary, and owner-review-before-parent-
  materialization boundary. It admits only to the parent review boundary; it
  creates no Review row, Artifact, child assignment, provider/tool dispatch,
  permission grant, source materialization, Git mutation, Project Revision, or
  parent Task mutation authority.
- the current Agent Delegation result admission store persists those local
  admission receipts in a strict main-only SQLite store with restart restore,
  idempotent replay, owner-scoped reads, parent-task and child-task admission
  listing, read-by-result lookup, one admission per Delegation result, schema
  fingerprint verification, and fixed redacted failures. It stores only indexed
  identity plus canonical Delegation/result/admission receipts; opens no
  IPC/preload path; shows no Agents UI; grants no permission; dispatches no
  provider/model or tool; reads no credentials or source; writes no files; runs
  no process or tests; mutates no Git or Project Revision facts; and creates no
  Review/Artifact authority. Real Review/Artifact materialization remains a
  separate gate.
- the current Agent Delegation result admission service composes the Delegation
  result store and Delegation result admission store as a main-only local
  admission gate. It accepts only an owner id, Delegation result id, admission
  input, and admission time; reads the store-backed Delegation result; verifies
  parent-task and child-task result listings; records or replays the local
  admission receipt; and verifies read-by-admission, read-by-result,
  parent-task admission listing, and child-task admission listing. It creates no
  generic Review row, Artifact, child Assignment, child Run, parent
  materialization, source materialization, check run, Project Revision, Git
  mutation, provider/model dispatch, tool call, permission grant, IPC/preload
  command, or visible Agents UI.
- the current Agent Delegation result review contract adds a pure main-side
  owner decision receipt over an admitted child result. It can approve a
  proposed child result for a later parent materialization gate, reject it, or
  acknowledge a blocked/failed child result without materialization. It binds the
  Delegation, returned result, local admission receipt, parent/child
  Conversation/Task/Run identity, owner, project, fixed result summary, and
  owner decision. It creates no generic Review row, Artifact, child assignment,
  provider/tool dispatch, permission grant, source materialization, Git
  mutation, Project Revision, or parent Task mutation authority.
- the current Agent Delegation result review store persists those owner decision
  receipts in a strict main-only SQLite store with restart restore, idempotent
  replay, owner-scoped reads, parent-task and child-task review listing,
  read-by-admission lookup, one review per admitted child result, schema
  fingerprint verification, and fixed redacted failures. It stores only indexed
  identity plus canonical Delegation/result/admission/review receipts; opens no
  IPC/preload path; shows no Agents UI; grants no permission; dispatches no
  provider/model or tool; reads no credentials or source; writes no files; runs
  no process or tests; mutates no Git or Project Revision facts; and creates no
  generic Review row, Artifact, or parent materialization authority. Real
  parent materialization remains a separate gate.
- the current Agent Delegation result review service composes the Delegation
  result admission store and Delegation result review store as a main-only owner
  decision gate. It accepts only an owner id, Delegation result admission id,
  review input, and review time; reads the store-backed admitted child result;
  verifies parent-task and child-task admission listings; records or replays the
  owner review receipt; and verifies read-by-review, read-by-admission,
  parent-task review listing, and child-task review listing. It creates no
  generic Review row, Artifact, child Assignment, child Run, parent
  materialization, source materialization, check run, Project Revision, Git
  mutation, provider/model dispatch, tool call, permission grant, IPC/preload
  command, or visible Agents UI.
- the current Agent Delegation result parent materialization eligibility
  contract adds a pure main-side receipt over an approved owner review decision.
  It accepts only a proposed child result review that was approved for the later
  parent materialization gate, binds the Delegation/result/admission/review
  chain, parent/child Conversation/Task/Run identity, owner, project, fixed
  result summary, and eligibility timestamp, and records only that the reviewed
  child result is eligible for a future parent materialization gate. It rejects
  rejected reviews and blocked/failed acknowledgements, creates no store/service
  row, generic Review row, Artifact, child Assignment, child Run, parent
  materialization, source materialization, check run, Project Revision, Git
  mutation, provider/model dispatch, tool call, permission grant, IPC/preload
  command, or visible Agents UI.
- the current Agent Delegation result parent materialization eligibility store
  persists those eligibility receipts in a strict main-only SQLite store with
  restart restore, idempotent replay, owner-scoped reads, parent-task and
  child-task eligibility listing, read-by-review lookup, one eligibility per
  reviewed child result, schema fingerprint verification, and fixed redacted
  failures. It stores only indexed identity plus canonical
  Delegation/result/admission/review/eligibility receipts; opens no IPC/preload
  path; shows no Agents UI; grants no permission; dispatches no provider/model
  or tool; reads no credentials or source; writes no files; runs no process or
  tests; mutates no Git or Project Revision facts; and creates no generic
  Review row, Artifact, child Assignment, child Run, or parent materialization
  authority. Real parent materialization remains a separate gate.
- the current Agent Delegation result parent materialization eligibility service
  composes the Delegation result review store and eligibility store. It reads
  the store-backed owner review, verifies parent-task and child-task review
  listings, records or replays the eligibility receipt, and verifies
  read-by-eligibility, read-by-review, parent-task eligibility listing, and
  child-task eligibility listing. It accepts only owner-approved proposed child
  result reviews; rejects rejected reviews and blocked/failed acknowledgements;
  and still creates no child Assignment, child Run, generic Review row,
  Artifact, parent materialization, source materialization, check run, Project
  Revision, Git mutation, provider/model dispatch, tool call, permission grant,
  IPC/preload command, or visible Agents UI.
- the current Agent Delegation result parent materialization contract adds a
  pure main-side receipt over one eligibility receipt. It binds the
  Delegation/result/admission/review/eligibility chain, parent/child
  Conversation/Task/Run identity, owner, project, fixed result summary, and a
  parent task context receipt status. It records only that the approved child
  result has been materialized as a parent task context receipt for later
  owner-supervised use; it creates no generic Review row, Artifact, child
  Assignment, child Run, source materialization, check run, Project Revision,
  Git mutation, provider/model dispatch, tool call, permission grant,
  IPC/preload command, or visible Agents UI. Store-backed parent context
  materialization and any future user-visible Agent context projection remain
  separate later gates.
- the current Agent Delegation result parent materialization store persists
  those parent task context receipts in a strict main-only SQLite store with
  restart restore, idempotent replay, owner-scoped reads, read-by-eligibility
  lookup, parent-task and child-task listing, one materialization per
  eligibility/review/admission/result chain, schema fingerprint verification,
  and fixed redacted failures. It stores only indexed identity plus canonical
  Delegation/result/admission/review/eligibility/materialization receipts; it
  creates no generic Review row, Artifact, child Assignment, child Run, source
  materialization, check run, Project Revision, Git mutation, provider/model
  dispatch, tool call, permission grant, IPC/preload command, or visible Agents
  UI. The service gate that composes the eligibility store and materialization
  store remains a separate later checkpoint.
- the current Agent Delegation result parent materialization service composes
  the eligibility store and parent materialization store as a main-only
  materialization-recording gate. It accepts only an owner id, eligibility id,
  materialization input, and observation time; reads the store-backed
  eligibility receipt; verifies parent-task and child-task eligibility
  listings; records or replays the parent task context receipt; and verifies
  read-by-materialization, read-by-eligibility, parent-task materialization
  listing, and child-task materialization listing. It creates no generic Review
  row, Artifact, child Assignment, child Run, source materialization, check run,
  Project Revision, Git mutation, provider/model dispatch, tool call,
  permission grant, IPC/preload command, or visible Agents UI.
- the current Agent parent task context projection checkpoint derives a
  digest-bound main-side context projection from reviewed child result
  materialization receipts. It accepts parent Task identity plus materialized
  child result receipts, verifies each Delegation/result/admission/review/
  eligibility/materialization chain, emits only fixed child-result reference
  ids, task/run ids, Agent ids, summary codes, decision/status codes, and
  materialization times, and truncates the projection to a bounded window for
  future TaskContextSnapshot assembly. It records no raw child output, patch,
  source tree, display summary text, provider/model facts, permission grant,
  generic Review row, Artifact, source materialization, check run, Git fact,
  Project Revision, IPC/preload path, or visible Agents UI.
- the current Agent Task Context Snapshot contract checkpoint adds a pure
  main-side digest-bound snapshot receipt for one owner-supervised Agent action
  context. It verifies Agent Definition/Version, active Assignment status,
  active supervision lease, allowed Budget Audit, bounded task-local memory/
  message/artifact/run-event/permission references, optional base revision
  receipt digest, token budget, and the optional parent task context projection
  from reviewed child results. It records only references, fixed action
  admission facts, counts, budget values, and digest identity; it stores no
  prompt, raw transcript, current brief text, child output, source tree, file
  content, provider/model envelope, credential, generic Review row, Artifact
  payload, source materialization, check run output, Git fact, Project Revision
  row, IPC/preload path, or visible Agents UI. Store-backed context snapshot
  persistence and using the snapshot before real provider/tool dispatch remain
  later gates.
- the current Agent Task Context Snapshot store checkpoint persists those
  snapshot receipts in a strict main-only SQLite store with restart restore,
  idempotent replay, owner-scoped reads, read-by-Budget-Audit lookup,
  task-scoped listing, run-scoped listing, one snapshot per Budget Audit,
  schema fingerprint verification, guarded absolute database paths, and fixed
  redacted failures. It stores only indexed identity plus canonical snapshot
  receipts; it opens no IPC/preload path, shows no Agents UI, dispatches no
  provider/model or tool, grants no permissions, reads no credentials or
  source, writes no files, runs no process or tests, mutates no Git or Project
  Revision facts, and creates no Review or Artifact authority. Composing this
  store before actual supervised Agent execution remains a separate service
  checkpoint.
- the current Agent Task Context Snapshot service checkpoint composes the
  active supervision lease store, Budget Audit store, context snapshot contract,
  and context snapshot store as a main-only pre-dispatch context gate. It reads
  the store-backed active lease, requires a same-lease allowed Budget Audit for
  the requested next action, creates the bounded context snapshot receipt,
  records or replays that receipt, and verifies read-by-snapshot,
  read-by-Budget-Audit, task-scoped listing, and run-scoped listing. It still
  performs no requested next action, opens no IPC/preload path, shows no Agents
  UI, dispatches no provider/model or tool, grants no permissions, reads no
  credentials or source, writes no files, runs no process or tests, mutates no
  Git or Project Revision facts, stores no raw context, and creates no Review
  or Artifact authority. Actual supervised Agent execution after this receipt
  remains a later checkpoint.
- the current Agent Supervised Action Admission checkpoint adds a pure main-side
  digest-bound admission receipt over one store-backed Task Context Snapshot
  receipt. It accepts only a running, non-interrupted, non-cancelled Run state;
  requires the requested next action to match the snapshot's Budget Audit
  admission; binds snapshot id, context digest, Assignment/Status/Lease/Budget
  Audit/Agent/Project/Conversation/Task/Run identity, bounded context counts,
  token budget, fixed lifecycle, and fixed authority; and routes the action only
  to the next required gate (`start_step` -> later Agent Step Start service,
  `call_tool` -> later Tool Call Record service, `read_private_source` ->
  later Agent Private Source Context service, `finish_for_review` -> later
  Project Work Result service).
  It opens no IPC/preload path, shows no Agents UI, dispatches no provider/model
  or tool, creates no tool call, reads no source, records no result, grants no
  permission, stores no raw context, mutates no Git or Project Revision facts,
  and creates no Review or Artifact authority. Actual supervised Agent
  execution after this admission remains a later checkpoint.
- the current Agent Supervised Action Admission store checkpoint persists those
  admission receipts as restart-replayable SQLite facts. The store verifies the
  admission contract, enforces one admission per Task Context Snapshot and
  action request, exposes owner-scoped reads by admission id and snapshot id,
  lists admissions by Task or Run, and reports only
  `main_owned_agent_supervised_action_admission_store` evidence. It still opens
  no IPC/preload path, shows no Agents UI, dispatches no provider/model or tool,
  creates no tool call, reads no source, records no Project Work Result, grants
  no permission, stores no raw context, mutates no Git or Project Revision
  facts, and creates no Review or Artifact authority. Actual supervised Agent
  execution, tool dispatch/execution, private source context collection, and
  result-for-review creation remain later checkpoints.
- the current Agent Supervised Action Admission service checkpoint composes the
  store-backed Task Context Snapshot store and Supervised Action Admission
  store. It admits a requested next action only after reading the snapshot from
  the snapshot store, verifying owner/Task/Run listings, creating the admission
  receipt, recording it in the admission store, and reading it back by admission
  id, snapshot id, Task, and Run. It reports only
  `main_owned_agent_supervised_action_admission_service` evidence and still
  opens no IPC/preload path, shows no Agents UI, dispatches no provider/model or
  tool, creates no tool call, reads no source, records no Project Work Result,
  grants no permission, stores no raw context, mutates no Git or Project
  Revision facts, and creates no Review or Artifact authority. Actual
  supervised Agent execution, tool dispatch/execution, private source context
  collection, and result-for-review creation remain later checkpoints.
- the current Agent Step Start receipt contract checkpoint extracts the
  deterministic step-start receipt into a reusable main-only contract. It binds
  a `start_step` supervised action admission, the referenced allowed Budget
  Audit, Run step id, step index, and started time; requires
  `requested_next_action=start_step`,
  `next_gate=agent_step_runner_required_later`, the Budget Audit's prior
  `step_count + 1`, and fixed no-execution authority; and produces a
  digest-bound receipt that can later be persisted and replayed by a store. It
  opens no IPC/preload path, shows no Agents UI, dispatches no provider/model or
  tool, executes no step, grants no permission, reads or writes no source, runs
  no process, stores no raw context, mutates no Git or Project Revision facts,
  and creates no generic Review row or Artifact authority.
- the current Agent Step Start service checkpoint connects the `start_step`
  supervised action admission to that receipt contract and the Step Start
  store. The service accepts owner id, supervised action admission id, run step
  id, step index, and started time; reads the admission from the admission
  store; verifies Task/Run admission listings; requires
  `requested_next_action=start_step` and
  `next_gate=agent_step_runner_required_later`; reads the referenced Budget
  Audit from the budget audit store; verifies lease audit listings; and
  requires the requested step index to equal the budget audit's prior
  `step_count + 1`; it then records the receipt in the Step Start store and
  verifies replay by step id, admission id, Task, and Run. It opens no
  IPC/preload path, shows no Agents UI, dispatches no provider/model or tool,
  executes no step, grants no permission, reads or writes no source, runs no
  process, stores no raw context, mutates no Git or Project Revision facts, and
  creates no generic Review row or Artifact authority. Actual step execution,
  model/tool dispatch, and result recording remain later gates.
- the current Agent Step Start store checkpoint persists those digest-bound
  step-start receipts as restart-replayable SQLite facts. The store verifies
  the Step Start receipt contract, enforces one start per Run step id and
  supervised action admission, exposes owner-scoped reads by step id and
  admission id, lists starts by Task or Run, verifies canonical receipt JSON,
  schema fingerprint, runtime pragmas, and row/receipt consistency, and reports
  only `main_owned_agent_step_start_store` evidence. It still opens no
  IPC/preload path, shows no Agents UI, dispatches no provider/model or tool,
  executes no step, grants no permission, reads or writes no source, runs no
  process, stores no raw context, mutates no Git or Project Revision facts, and
  creates no generic Review row or Artifact authority. Actual step runner
  orchestration and execution remain later checkpoints.
- the current Agent Step Result receipt contract checkpoint adds a pure
  main-side fixed-summary receipt over one Step Start receipt. It records only
  that a started Agent step reached `succeeded`, `blocked`, `failed`, or
  `cancelled` with a fixed display summary and digest; it stores no raw output,
  prompt, source context, file content, provider/model envelope, command output,
  tool result payload, Git fact, Project Revision, generic Review row, Artifact,
  IPC/preload command, or visible Agents UI authority. The contract itself does
  not execute the step, dispatch a provider/model/tool, read or write source,
  run a process, grant permission, create a result-for-review, or materialize
  source.
- the current Agent Step Result store checkpoint persists those fixed-summary
  step result receipts as restart-replayable SQLite facts. The store verifies
  the Step Result receipt contract before writing, enforces one result per Step
  Start receipt, supervised action admission, and Run step id, exposes
  owner-scoped reads by result digest, Step Start digest, and admission id,
  lists results by Task or Run, verifies canonical receipt JSON, schema
  fingerprint, runtime pragmas, and row/receipt consistency, and reports only
  `main_owned_agent_step_result_store` evidence. It still opens no IPC/preload
  path, shows no Agents UI, dispatches no provider/model or tool, executes no
  step, grants no permission, reads or writes no source, runs no process, stores
  no raw output or raw context, mutates no Git or Project Revision facts, and
  creates no generic Review row or Artifact authority. Step Result service
  composition remains a separate checkpoint.
- the current Agent Step Result service checkpoint composes the recorded Step
  Start store and Step Result store into a main-only admission service. It reads
  the Step Start receipt by owner and Run step id, requires the caller's
  expected Step Start digest to match, verifies Step Start admission, Task, and
  Run listings, creates the fixed-summary Step Result receipt, stores or replays
  it, and cross-checks result reads by result digest, Step Start digest,
  admission id, Task, and Run. The service records only
  `main_owned_agent_step_result_service`, Step Start store, Step Result store,
  and receipt-contract evidence. It still does not run a step, choose or call a
  tool, dispatch a provider/model, read/write source, grant permission, store raw
  output/context, mutate Git or Project Revision, create a generic Review row or
  Artifact, open IPC/preload, or show visible Agents UI. Step runner
  orchestration and using step result receipts in later Agent progress projection
  remain separate checkpoints.
- the current Agent Step Progress projection checkpoint converts already
  recorded Step Start store and Step Result store list results into a bounded,
  renderer-safe progress window. It verifies all Step Start and Step Result
  receipts, owner/Project/Task/Run identity, Step Start digest binding,
  duplicate/orphan result absence, fixed result summaries, and the latest
  128-step public window before exposing only step id, step index, recorded
  state, and fixed public summaries. It does not expose Step Start/Result
  receipt digests, supervised action admission, Budget Audit, assignment/lease,
  provider/model/tool facts, source, raw output, Git, Review, Artifact, IPC, or
  renderer authority. It still does not start or run steps, store progress,
  subscribe to Task Stream changes, or show visible Agents UI; Conversation
  admission and visible Task Stream projection are separate checkpoints.
- the current Agent Step Progress read-service checkpoint composes the Step
  Start store, Step Result store, and renderer-safe projection behind one
  main-only read entrypoint. It accepts only owner, Project, Task, and Run ids,
  reads Run-scoped Step Start/Result store facts, projects the bounded public
  progress window, and returns only projection plus fixed read counts/statuses
  and `main_owned_agent_step_progress_read_service` evidence. It returns no
  receipt objects, digests, supervised action admission, Budget Audit,
  assignment/lease, provider/model/tool facts, source, raw output, Git, Review,
  Artifact, IPC, preload, or renderer authority. It still does not append
  Conversation events, subscribe to Task Stream changes, start or run steps, or
  show visible Agents UI.
- the current Agent Step Progress Conversation-admission checkpoint converts
  one public item from that read-service result into a digest-bound
  main-side admission record for trusted Conversation event recording. It requires
  the caller's trusted active Project/Conversation/Turn/Task/Run context to be
  running and not cancelled/interrupted, verifies the read-service result,
  projection authority, read counts/statuses, selected step id/index/state, and
  fixed public summary, then records only public step progress, source version
  stamps, lifecycle, authority, and an admission digest. It exposes no
  Step Start/Result receipt objects or digests, supervised action admission,
  Budget Audit, assignment/lease, owner/agent ids, provider/model/tool facts,
  source, raw output, Git, Review, Artifact, IPC, preload, or renderer
  authority. It still does not append Conversation events, subscribe to Task
  Stream changes, start or run Agent steps, or show visible Agents UI.
- the current Agent Step Progress Conversation/Task Stream checkpoint accepts
  only those already-created admission records as
  `agent_step_progress_recorded` Conversation events. The Conversation main
  service now has a trusted-context-only `record_agent_step_progress` method
  that sanitizes the admission record, cross-checks Project/Conversation/Turn/
  Task/Run identity, rejects future admission times, appends the event, and
  advances the trusted Run head. Replay verifies that the matching work
  Turn/Task/Run is active, running, not cancelled/interrupted, and that step
  results cannot appear before starts except for a renderer-safe truncated-window
  prefix case. The Task Stream exposes only public step id, step index, recorded
  state, fixed summary/result, and lifecycle values; the renderer sanitizer
  re-validates the same ordering and hides internal event names, admission
  digests, read-service evidence, receipts, provider/model/tool facts, source,
  raw output, Git, Review, Artifact, Revision, IPC, preload, and renderer append
  authority. This checkpoint still does not create the events directly from
  stores, subscribe to step progress, start/run Agent steps, dispatch tools or
  providers, read/write source, or enable autonomous Agents UI.
- the current Agent Step Progress Conversation-recording service checkpoint
  composes the main-owned Step Progress read service, the Conversation
  admission contract, and the trusted Conversation main service into one
  fail-closed internal recording entrypoint. It accepts owner, Project,
  Conversation, Turn, Task, Run, step id/index/state, the trusted Run context,
  and admitted time; re-reads the store-backed public progress window; creates
  the selected admission record; and records it through
  `record_agent_step_progress`. It returns only the advanced trusted context and
  fixed service evidence. It exposes no Step Start/Result receipts or digests,
  supervised action admission, Budget Audit, assignment/lease, owner/agent ids
  beyond request scoping, provider/model/tool facts, source, raw output, Git,
  Review, Artifact, Revision, IPC, preload, renderer append authority, or
  subscription. It still does not start/run Agent steps, poll or subscribe to
  stores, dispatch tools/providers, read/write source, or show autonomous
  Agents UI.
- the current Agent Tool Call Record service checkpoint connects the
  `call_tool` supervised action admission to the existing main-only Tool Call
  Record contract. The service accepts a supervised action admission id, reads
  that admission from the admission store, verifies Task/Run admission listings,
  requires `requested_next_action=call_tool` and
  `next_gate=tool_call_record_required_later`, and creates a deterministic
  pre-dispatch Tool Call Record from a main-issued Tool Session Policy plus an
  allowed Tool Permission Admission for the same Agent, Project, Conversation,
  Task, and Run. The current Agent Tool Call Record store checkpoint persists
  those pre-dispatch Tool Call Records as restart-replayable SQLite facts. The
  store verifies the existing Tool Call Record contract, records the external
  owner and supervised action admission id beside the record, adds a
  store-entry digest binding those external facts to the record digest, enforces
  one row per tool call id, supervised action admission id, record digest, and
  entry digest, exposes owner-scoped reads by tool call id and admission id plus
  Task/Run listings, and verifies canonical record JSON, schema fingerprint,
  runtime pragmas, and row/entry consistency. The service now records or
  replays the generated record through that store and verifies read-by-tool-call,
  read-by-admission, Task listing, and Run listing before returning. It still
  opens no IPC/preload path, shows no Agents UI, dispatches no provider/model or
  tool, executes no tool, reads or writes no source, grants no permission,
  stores no raw output or raw context, mutates no Git or Project Revision facts,
  and creates no generic Review row or Artifact authority. Actual step running,
  tool dispatch/execution, tool result recording, private source context
  collection, and materialization remain separate later gates.
- the current Agent Private Source Context service checkpoint connects the
  `read_private_source` supervised action admission to the existing main-only
  Source Context Collector. The service accepts an owner id, supervised action
  admission id, trusted Conversation work Run context, and bounded project
  resource ids; reads the admission from the admission store; verifies Task/Run
  admission listings; requires `requested_next_action=read_private_source` and
  `next_gate=source_context_collector_required_later`; cross-checks the
  supplied work Run context against the admitted Project, Conversation, Task,
  and Run; rejects an already-recorded receipt for the same admission before
  invoking the collector; and then invokes the collector. The service now
  converts the collector result into a digest-only Private Source Context
  record, records that receipt through the Private Source Context Record store,
  and verifies read-by-digest, read-by-admission, Task listing, and Run listing
  before returning. The returned private source context remains main-only and
  not durable public UI state, while Conversation receives only the collector's
  already-sanitized tool request and fixed result facts. Restart recovery
  restores the digest receipt, not raw source content, and the service does not
  silently re-read source to fake raw-context replay. It still opens no
  IPC/preload path, shows no Agents UI, dispatches no provider/model, grants no
  permission, writes no source, runs no process, mutates no Git or Project
  Revision facts, and creates no generic Review row or Artifact authority.
  Actual Agent step running, arbitrary tool dispatch, materialization, and
  user-visible Agents workflow remain separate later gates.
- the current Agent Private Source Context record checkpoint adds a pure
  main-side digest-only receipt for one `read_private_source` supervised action
  admission plus one Source Context Collector result. It revalidates the
  bounded private source files through the source-tree sanitizer, but the record
  shape keeps only resource/content digests, file and byte counts, read
  statuses, tool-call ids, context/head/request binding, lifecycle, authority,
  and a canonical record digest. It stores no raw file paths or file content,
  source-context result body, provider/model envelope, credential, Git fact,
  Project Revision, generic Review row, Artifact payload, IPC/preload command,
  or visible Agents UI authority.
- the current Agent Private Source Context record store checkpoint persists
  those digest-only receipts as restart-replayable SQLite facts. The store
  verifies the record contract, enforces one row per record digest and
  supervised action admission id, exposes owner-scoped reads by digest and
  admission id plus Task/Run listings, and verifies canonical record JSON,
  schema fingerprint, runtime pragmas, and row/receipt consistency. It still
  opens no IPC/preload path, shows no Agents UI, dispatches no provider/model or
  tool, executes no tool, grants no permission, reads or writes no source, stores
  no raw source content, mutates no Git or Project Revision facts, and creates
  no generic Review row or Artifact authority. The Private Source Context
  service now uses this store only for digest receipt durability; the store
  itself still performs no source read and cannot rehydrate raw private source.
- the current Agent Project Work Result service admission checkpoint connects
  the `finish_for_review` supervised action admission to the existing Project
  Work Result service. The result service now accepts a supervised action
  admission id instead of raw budget audit id, reads that admission from the
  admission store, verifies Task/Run admission listings, requires
  `requested_next_action=finish_for_review` and
  `next_gate=project_work_result_required_later`, and then verifies the
  referenced allowed Budget Audit before recording the result. It still opens no
  IPC/preload path, shows no Agents UI, dispatches no provider/model or tool,
  creates no tool call, reads no source, grants no permission, stores no raw
  context, mutates no Git or Project Revision facts, and creates no generic
  Review row or Artifact authority. Actual result review, materialization, tool
  execution, and source access remain separate later gates.

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
- the first public/reusable object is a Work Capsule bound to a verified
  version, template, artifact, or Agent workflow package;
- private source and credentials cannot enter public metadata;
- import/remix creates new identity and preserved lineage;
- compatibility and availability are explicit;
- comments, reactions, ranking, profiles, and attention-feed items are not work
  authority and cannot replace Work Capsule provenance;
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

Playful or experimental destinations activate only after the underlying project
work they display is already safe. They may project Agent personality, history
maps, challenges, experimental branches, or demos, but they do not grant source,
command, publish, delete, permission, save, or external-network authority.

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
