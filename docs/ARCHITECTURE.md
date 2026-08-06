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

The desktop application owns six narrow authorities:

1. Builder provider settings and encrypted credentials.
2. Bounded code-generation transport.
3. Git-backed project worktrees and SQLite product metadata.
4. Main-owned, deny-by-default Permission facts with an evaluate-only renderer
   IPC surface, a main-only explicit grant primitive, renderer-side decision
   sanitizer, and main-side tool admission receipt before future tool dispatch.
5. Main-owned local Agent Definition/Version/lifecycle records without visible
   Agent activation, assignment, supervision, tool dispatch, or IPC/preload.
6. A controlled renderer bridge exposing only Builder operations.

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
Project Revision authority. It may include only the already-public assistant
plan text stored as the Run result message, not the plan record body or private
source context. Stale or rejected plan facts fail closed.

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
input for a later executor: it includes the approved plan public text, verified
base revision evidence, and the current source tree, but it does not read
provider config or credentials, dispatch provider/tool work, mutate source,
create Git candidate evidence, append Conversation events, create Save/Project
Revision facts, or expose any IPC/preload/renderer projection.

The Generation main service can also consume that approved-plan edit context as
an internal generation request. Before provider dispatch, Conversation main
service performs a fresh current-head approved-plan read and appends a new
main-only work Turn/Run whose user message is exactly the already-public
approved plan text. Generation then uses the verified base revision evidence and
source tree from the private edit context to produce an unsaved candidate. This
path now has one controlled preload/IPC entry so the visible desktop workspace
can continue immediately after the user approves a plan, but the renderer sends
only Project, Conversation, Turn, and Run IDs. Main still re-reads the current
approved-plan fact and prepares the private edit context; the renderer cannot
send plan text, provider config, source content, source receipt authority, Save
authority, or Project Revision authority.

The Generation main service can also create a main-only plan proposal for an
existing project by binding the user request to the current Git/SQLite project
read result, starting a trusted Conversation work Run, collecting bounded
private source context through the main source-context collector, and then
asking the configured provider for the plan-only JSON contract. Before the
visible workspace starts that plan request, it must ask main to prepare the
bounded source-read approval state for the currently selected Project. The
renderer sends only the Project ID; main re-reads the selected Project, derives
the bounded source resource IDs, evaluates deny-by-default filesystem-read
permission, and returns only `ready` or `approval_required` with a file count.
If approval is required, the chat flow shows one explicit approval card;
approval again sends only the Project ID, and main records the durable
filesystem-read grants through its main-only explicit approval primitive. The
renderer never receives resource IDs, permission IDs, source paths, source
content, grant receipts, provider config, credentials, Git evidence, Save
authority, or Project Revision authority. After approval is ready, main derives
the selected Project again, re-reads the Git/SQLite source-tree facts, chooses
bounded resource IDs, collects the private source context, and returns only the
public plan result; the UI re-reads the renderer-safe Task Stream for the
displayed plan. Conversation admits only the completed plan fact after
cross-checking the source-context result and plan proposal record; the public
Generation result contains bounded plan text and a Conversation head, not the
plan record body, record digests, source context, provider config, credential,
Git evidence, Save authority, Project Revision authority, or source mutation.

The Generation main service can also record fixed Run progress stages through
the Conversation main service while provider generation, explanation, or
plan-first proposal work is in flight. The only current stages are
`context_ready`, `provider_request_started`, `provider_response_received`, and
`result_preparing`. Each stage advances the trusted Conversation head and is
replayed before the renderer-safe Task Stream exposes it as a status item. The
projection contains no provider envelope, prompt, token delta, credential,
source content, Git evidence, Save authority, or Project Revision authority.
This is durable work visibility, not a token-streaming or tool-execution
protocol. A controlled main-only permission grant primitive can record durable
allowed filesystem-read facts, but it is not exposed as a generic preload or
renderer permission-grant port. The only current visible consumer is the
plan-first source-read approval flow above; it is bound to the current selected
Project and bounded main-selected source resources, and it cannot be reused for
arbitrary tools, external network/process access, source mutation, Save, or
Project Revision creation.

Provider Working Context disclosure now has its own main-owned permission
surface. The permission policy includes a narrow `context.disclose` action on a
`provider` resource, separate from `network.request`; this lets Builder require
an explicit local-user fact before any assembled Working Context can become
provider-sendable context. The current decision adapter and projection gate do
not dispatch a provider, grant permissions, expose IPC/preload commands, mutate
source/Git, write SQLite, or replace the existing prompt path. A separate
main-side disclosure approval service can admit a grant only from a verified
prepared disclosure request and returns no request ids, permission ids, provider
context, source refs, IPC/preload channel, UI control, provider dispatch, prompt
bridge, source/Git mutation, SQLite write, or Revision authority. A separate
current approval gate can read only the main-owned in-memory preparation for the
current Project/Conversation and pass it to that approval service; it fails
closed for missing, stale, ready, or wrong-reason preparations and still does not
open IPC/preload, prompt bridging, provider dispatch, storage, source, Git, or
Revision authority. A controlled IPC adapter can expose only an active-renderer
`approveCurrent` command shell around that gate, accepting current
Project/Conversation IDs and returning a sanitized approval result; the adapter
itself still performs no direct Electron registration, preload exposure, request
id exposure, permission fact readback, provider-context body exposure,
provider/tool dispatch, prompt bridge, source/Git mutation, or Revision
authority. A dedicated IPC runtime can register that one fixed channel by
composing the adapter with the current gate, approval service, supplied
main-only status service, and supplied explicit permission grant function. The
runtime owns no storage, provider dispatch, prompt bridge, preload exposure,
source/Git mutation, or Revision authority; connecting it to the generation
runtime's shared disclosure status service is a later desktop integration step.

The visible desktop Builder now distinguishes a logical New project from a
working local project. Chat answers may still run without a folder, but
`submit`, direct draft generation, and retry require either a verified saved
Project or a main-owned local workspace binding. The composer exposes the
current project/workspace as a visible chip backed by the read-only catalog
projection. If no binding exists, the visible app intercepts clear build intent
and opens the project picker while preserving the user's text; it does not call
the generator, silently create a target, or immediately open a system folder
dialog. Choosing New project is the explicit path into the controlled
folder-selection flow; cancellation surfaces only a fixed
project-folder-required diagnostic and performs no generation, hidden write,
permission grant, Git mutation, Save, or Revision creation. Successful
selection records the workspace binding in SQLite, creates or reuses the local
Git project under that folder, and returns only a public working-project summary
to the renderer: Project identity, bounded project title, and bounded source
folder display name/count. The renderer never sends or receives filesystem
paths, and it cannot send Project Revision receipts. A working project can
preview and review an unsaved candidate, but it does not become a saved Version
until explicit Save verifies the Git candidate and selects a SQLite Project
Revision receipt.

The desktop artifact surface is a renderer-safe projection over already public
project snapshots and Task Stream reads. It can show full Preview, Changes,
Source, Versions, and Logs in a resizable right panel, while the chat flow keeps
only conversation, status, review, and compact result-summary UI. Resizing,
opening, closing, and tab selection do not grant file access, dispatch tools,
expose paths, create Git evidence, accept Reviews, save Versions, or change
Project Revision authority. Preview remains a constrained projection of
generated files, not a runtime authority for executing arbitrary generated code.

The OpenAI-compatible provider transport also has a streaming observer path.
When the Generation host supplies an internal observer, the request uses a
bounded `text/event-stream` response and assembles the same terminal
generated-text result. Raw provider deltas stay main-only. The Generation main
service may extract top-level display text from the approved generation result
shape and send that through one renderer-safe live output event so the
conversation can show active AI text while the Run is in flight. This covers
code candidate generation, explanation, approved-plan continuation, and
plan-first proposal text after the source-context collection has bound a trusted
work Run. This event is ephemeral UI state, not a Task Stream fact, and it
carries no raw provider envelope, prompt, credential, source content, plan
record evidence, Git evidence, Save authority, or Project Revision authority.
Separately, already-admitted Task Stream tool request/result facts have a
renderer-safe activity projection: pending requests show as ordinary project
steps, and matching fixed-code results fold the request into one final status
row. That projection is read-only UI state and exposes no raw tool output,
dispatch evidence, provider envelope, source content, Git evidence, Save
authority, or Project Revision authority. The project-id-only Task Stream
changed hint is only a refresh trigger for the visible desktop conversation
controller; it preserves the current projection while re-reading, queues a
follow-up read for overlapping hints, and grants no renderer-side work,
review, Save, Git, provider, source, or revision authority. Tool-output
streaming and arbitrary execution still require separate protocols.

Continuing from an unsaved draft is a controlled visible composer behavior, but
the renderer can request it only with a pending `draft_id` and new instruction.
The Generation main service first prepares a draft-continuation admission from a
revalidated pending draft. It binds only a pending draft id, candidate
id/digest, resulting tree digest, and Conversation head digest. The service then
reverifies the current selected project, Conversation head, and pending Review
state before any replacement Run or provider dispatch. Preparing the admission
itself starts no Run, releases no prior candidate, dispatches no provider/tool,
exposes no source, creates no Git evidence, accepts no Review, and saves no
Project Revision.
After that admission, Generation main can prepare a separate main-only pending
candidate base from verified Git candidate evidence. That base may contain the
verified source tree and parent candidate commit/tree OIDs for the future
draft-to-draft generator, but it is explicitly not a Project Revision, Save
receipt, or renderer-safe payload. Preparing it still starts no Run, dispatches
no provider/tool, performs no source mutation, creates no new Git candidate, and
opens no IPC/preload/renderer command.
The Conversation main service can now consume the draft-continuation admission
only after replay proves the pending candidate is still unreviewed, the
Conversation head is still current, and the recorded candidate digest/tree
evidence matches the admission. It appends a new work Turn and Run to describe
the requested replacement work, but it still dispatches no provider/tool, reads
no source, mutates no Git state, creates no new candidate, accepts no Review,
saves no Project Revision, and exposes no renderer-safe source or receipt.

Generation main service can now use that private admission and verified pending
candidate base for a main-only draft-to-draft generation path. The provider
prompt is built from the verified pending candidate source tree so the model can
revise the unsaved draft the user is looking at. The resulting candidate is then
squashed back onto the current product base revision or empty bound project base
before Git evidence is persisted. This keeps `expected_base_oid`, Save, History,
and SQLite Project Revision semantics tied to product revision truth instead of
pretending a pending candidate is a saved Version. The path starts a fresh
Conversation work Run, records the same fixed progress stages, persists a new
unsaved Git candidate, and records the candidate result in Conversation, but it
does not save, accept Review, update `main`, create a Project Revision, expose
source/receipts/provider data to the renderer, or let the renderer provide a
project id, request digest, source tree, Save receipt, actor, time, or authority.

The code authority is a normal project directory with a standard Git
repository. Git commit, tree, and parent object IDs are the durable code facts.
Builder Project Revision is a SQLite product receipt that binds a Project,
Run, Review decision, and Artifact evidence to Git object IDs. It must not copy
source files into a second JSON revision chain.

Future Goal, Task, Run, Artifact, Review, Permission grant UI/tool enforcement,
Contribution, Agent supervision, Delegation, Workflow Version, Space/Membership,
Identity/Contact/Conversation, and Publication authorities must be added
independently and must not be inferred from chat, community, model identity,
renderer state, or Git metadata alone. The current Agent Definition store is
only an internal identity/version/lifecycle fact authority: it persists
owner-bound Agent records in main-owned SQLite. The current Agent Goal contract
is only a pure main-side continuous-objective receipt: it binds one Agent
version, owner, Project/Conversation/Task, explicit permission boundary,
bounded budget, and the `continuous_until_done_or_blocked` / owner-review
completion contract without creating an Assignment, Run, provider/tool dispatch,
source read/write, Git fact, Project Revision, Review, or Artifact. The current
Agent Goal store is only an internal continuous-objective/status fact
authority: it persists bounded Goal records and ordered Goal status decisions in
main-owned SQLite for restart-safe owner/task lookup while still creating no
Assignment, Run, provider/tool dispatch, permission grant, source read/write,
Git fact, Project Revision, Review, or Artifact. The current Agent
Goal-to-Assignment admission contract is only a pure main-side bridge receipt:
it proves one active Goal status may constrain one owner-supervised Assignment
candidate by objective, identity, and narrowed budget while still creating no
Assignment row, Run, execution, provider/tool dispatch, permission grant, source
access, Git fact, Project Revision, Review, or Artifact. The current Agent
Goal-to-Assignment admission store is only an internal bridge-receipt evidence
authority: it persists the Goal, active Goal status, Assignment candidate, and
admission receipt in main-owned SQLite for restart-safe owner/task and
read-by-Assignment lookup while still recording no Assignment row, starting no
Run or execution, and creating no provider/tool, permission, source, Git,
Project Revision, Review, or Artifact authority. The current Agent
Goal-to-Assignment materialization contract is only a pure main-side receipt
that an admitted Assignment has been recorded in the Assignment store with its
initial `queued` status. It binds the admission receipt to the Assignment store
read evidence and still starts no Run, dispatches no provider/tool, grants no
permission, reads or writes no source, mutates no Git or Project Revision, and
creates no Review or Artifact authority. The current Agent Goal-to-Assignment
materialization store is only an internal materialization-receipt evidence
authority: it persists the Goal, active Goal status, admission receipt,
Assignment store read receipt, and materialization receipt in main-owned SQLite
for restart-safe owner/task, read-by-Assignment, and read-by-admission lookup
while still starting no Run or execution and creating no provider/tool,
permission, source, Git, Project Revision, Review, Artifact, IPC/preload, or
visible Goal authority. The current Agent Goal-to-Assignment materialization
service is only a main-only composition gate over the admission, Assignment,
and materialization stores: it records or replays the admission, records or
replays the Assignment and its initial `queued` status, reads that store-backed
queued Assignment fact, creates and records the materialization receipt, and
recovers through idempotent store replay after restart. It still starts no Run
or execution, dispatches no provider/tool, grants no permission, reads or
writes no source, mutates no Git or Project Revision, creates no Review or
Artifact, and exposes no IPC/preload or visible Goal UI. The current Agent
Assignment store is only an internal owner-supervised assignment/status fact authority: it
persists one Agent version binding to a Project/Conversation/Task/Run and
ordered assignment status records in main-owned SQLite. The current
Agent Assignment supervision service is only a main-only composition gate over
the Assignment store and Agent Supervision Lease store: it records or replays a
queued Assignment's `active` status, preflights the supervision lease time
window before changing Assignment state, records or replays the active lease,
and recovers through idempotent store replay after restart. It still starts no
Run or execution, dispatches no provider/tool, grants no permission, reads or
writes no source, mutates no Git or Project Revision, creates no Review or
Artifact, and exposes no IPC/preload or visible Agents UI. The current
Agent Supervision Lease store is only an internal supervision evidence authority: it
persists one active-assignment lease/release chain in main-owned SQLite and
enforces one unreleased and unexpired lease per assignment with monotonic lease
epochs; it is not a Run executor. The current Agent Budget Audit service is
only a main-only composition gate over the active supervision lease read and
Budget Audit store: it records or replays allowed or denied budget audit facts
for a requested next Agent action, requires the matching lease to be active in
the lease store at the observed time, and still dispatches no next action. It
starts no Run or execution, dispatches no provider/tool, grants no permission,
reads or writes no source, mutates no Git or Project Revision, creates no
Review or Artifact, and exposes no IPC/preload or visible Agents UI. The
current Agent Project Work Result service is only a main-only composition gate
over the active supervision lease read, store-backed Supervised Action
Admission read, allowed Budget Audit read, and Project Work Result store: it
records or replays fixed project-edit or project-test result receipts for later
owner review only after a persisted `finish_for_review` supervised action
admission whose budget audit also allowed `finish_for_review` for the same
active lease before the result time. It still creates no generic Review row,
Artifact, source materialization, check run, Git fact, Project Revision,
provider/tool dispatch, permission grant, IPC/preload command, or visible
Agents UI. The current Agent Project Work Result review
contract and store are only a main-owned owner decision boundary over one
recorded project work result: they can approve a proposed result for a later
project materialization gate, reject it, or acknowledge a blocked/failed result
without materialization. They persist restart-safe owner-scoped decision
receipts with task lookup and one review per work result, but still create no
generic Review row, Artifact, source materialization, check run, Git fact,
Project Revision, provider/tool dispatch, permission grant, IPC/preload command,
or visible Agents UI. The current Agent Project Work Result review service is
only a main-only composition gate over the Project Work store and Project Work
Result review store: it reads the store-backed work result by owner and result
id, verifies task-scoped result listing, records or replays the owner decision
receipt, and verifies read-by-review, read-by-result, and task review listing.
It still creates no generic Review row, Artifact, source materialization, check
run, Git fact, Project Revision, provider/tool dispatch, permission grant,
IPC/preload command, or visible Agents UI. The current Agent Project Work Result
review release service is only a main-only composition gate over the Project
Work Result review store and Agent Supervision Lease store: it reads the
store-backed owner review decision, verifies task-scoped review listing, records
or replays a completed lease release for the reviewed result, and verifies the
assignment no longer has an active lease at the close time. It still creates no
generic Review row, Artifact, source materialization, check run, Git fact,
Project Revision, provider/tool dispatch, permission grant, Assignment status
change, IPC/preload command, or visible Agents UI. The current Agent Project
Work Result review assignment close service is only a main-only composition
gate over the Assignment store, Project Work Result review store, and Agent
Supervision Lease store: it reads the store-backed owner review, requires the
reviewed lease to already have a completed release, verifies no active
assignment lease remains at the close time, records or replays the Assignment's
`completed` status, and verifies assignment/task listing. It still creates no
Goal status, generic Review row, Artifact, source materialization, check run,
Git fact, Project Revision, provider/tool dispatch, permission grant,
IPC/preload command, or visible Agents UI. The current Agent Delegation
contract is only a pure main-side evidence contract: it binds an active parent
assignment and lease to a target Agent version, child Task/Run identity,
permission and budget intersection, cancellation propagation, and review-return
boundary, but creates no child assignment or execution. The current Agent
Delegation store is only an
internal durable delegation evidence authority: it persists those receipts in
main-owned SQLite with parent/child Task listing and child Task/Run duplicate
protection, but still creates no child assignment or execution. The current
Agent Delegation service is only a main-only composition gate over the Agent
Definition store, Assignment store, Supervision Lease store, and Delegation
store: it reads the active parent Assignment, active parent lease, and active
target Agent facts from stores, records or replays the Delegation receipt, and
verifies parent/child Task listing. It still creates no child Assignment, child
Run, provider/tool dispatch, permission grant, source read/write, Review,
Artifact, Project Revision, IPC/preload command, or visible Agents UI. The current
Agent Delegation result contract is only a pure parent-review return receipt:
it records that a delegated child Task result is ready, blocked, or failed for
parent review without raw output, Review creation, or parent materialization.
The current Agent Delegation result store persists those return receipts in
main-owned SQLite with parent/child Task result listing and one result per
Delegation receipt, but still creates no Review, Artifact, or parent
materialization. The current Agent Delegation result service is only a main-only
composition gate over the Delegation store and Delegation result store: it reads
the store-backed Delegation receipt, verifies parent/child Task Delegation
listings, records or replays the child result-return receipt, and verifies
parent/child Task result listings. It still creates no child Assignment, child
Run, parent materialization, generic Review row, Artifact, source
materialization, Project Revision, provider/tool dispatch, permission grant,
IPC/preload command, or visible Agents UI. The current Agent Delegation result
admission contract is only a local Contribution-like receipt: it can admit a
recorded delegated result to the parent review boundary while still creating no
Review row, Artifact, child assignment, source materialization, parent mutation,
Git fact, or Project Revision. The current Agent Delegation result admission
store persists those local admission receipts in main-owned SQLite with
parent/child Task admission listing, read-by-result lookup, and one admission
per Delegation result, but still creates no Review, Artifact, or parent
materialization. The current Agent Delegation result admission service is only a
main-only composition gate over the Delegation result store and Delegation
result admission store: it reads the store-backed Delegation result receipt,
verifies parent/child Task result listings, records or replays the local
admission receipt, and verifies parent/child Task admission listings plus
read-by-admission and read-by-result. It still creates no generic Review row,
Artifact, child Assignment, child Run, parent materialization, source
materialization, Project Revision, provider/tool dispatch, permission grant,
IPC/preload command, or visible Agents UI. The current Agent Delegation result
review decision contract is only a pure owner decision receipt
over an admitted child result: it can approve a proposed child result for later
parent materialization, reject it, or acknowledge a blocked/failed child result
without materialization. The current Agent Delegation result review store
persists those owner decision receipts in main-owned SQLite with owner-scoped
reads, parent/child Task review listing, read-by-admission lookup, one review
per admitted child result, and restart/idempotency/schema-fingerprint checks,
but still creates no generic Review row, Artifact, parent mutation, source
materialization, Git fact, Project Revision, provider/tool dispatch, permission
grant, or parent materialization. The current Agent Delegation result review
service is only a main-only composition gate over the Delegation result
admission store and Delegation result review store: it reads the store-backed
admitted child result receipt, verifies parent/child Task admission listings,
records or replays the owner review decision receipt, and verifies
parent/child Task review listings plus read-by-review and read-by-admission. It
still creates no generic Review row, Artifact, child Assignment, child Run,
parent materialization, source materialization, Project Revision,
provider/tool dispatch, permission grant, IPC/preload command, or visible Agents
UI. The current Agent Delegation result parent materialization eligibility
contract is only a pure receipt over an approved proposed child-result review:
it records that the reviewed child result is eligible for a later parent
materialization gate while still creating no store/service row, generic Review
row, Artifact, child Assignment, child Run, parent mutation, source
materialization, Project Revision, provider/tool dispatch, permission grant,
IPC/preload command, or visible Agents UI. The current Agent Delegation result
parent materialization eligibility store persists those receipts in main-owned
SQLite with owner-scoped reads, parent/child Task eligibility listing,
read-by-review lookup, one eligibility per reviewed child result, and
restart/idempotency/schema-fingerprint checks, but still creates no service row,
generic Review row, Artifact, parent mutation, source materialization, Git fact,
Project Revision, provider/tool dispatch, permission grant, or parent
materialization. The current Agent Delegation result parent materialization
eligibility service composes the review store and eligibility store: it reads
the store-backed owner review, verifies parent/child Task review listings,
records or replays the eligibility receipt, and verifies parent/child Task
eligibility listings plus read-by-eligibility and read-by-review while still
creating no generic Review row, Artifact, parent mutation, source
materialization, Git fact, Project Revision, provider/tool dispatch, permission
grant, or parent materialization. The current Agent parent task context
projection, Task Context Snapshot contract, Snapshot store, Snapshot service,
Supervised Action Admission contract, Supervised Action Admission store, and
Supervised Action Admission service together form only a bounded
pre-dispatch context chain: reviewed child-result materialization receipts can
be projected into parent Task refs, an active lease plus allowed Budget Audit can
produce one digest-bound Task Context Snapshot receipt, that receipt can be
persisted and replayed, a main-only supervised action admission can bind it to
the next required gate (`start_step`, `call_tool`, `read_private_source`, or
`finish_for_review`), and that admission can be persisted and replayed by
snapshot, Task, or Run identity. The service records an admission only from a
store-backed Task Context Snapshot and verifies admission-store replay before
returning a ready result. This chain stores refs, counts, budget facts, fixed
lifecycle/authority codes, and digests; it carries no raw transcript, prompt,
source content, provider/model envelope, tool output, permission grant, Review
row, Artifact payload, Git fact, Project Revision, IPC/preload command, or
visible Agents UI authority. The current Agent Step Start receipt contract is a
separate deterministic main-only contract: it binds a `start_step` supervised
action admission, the referenced allowed Budget Audit, the Run step id, step
index, and start time into one digest while preserving fixed no-execution,
no-provider, no-tool-dispatch, no-source, no-IPC, no-Revision, no-Review, and
no-Artifact authority. The current Agent Step Start service connects a
persisted `start_step` supervised action admission to that contract: it reads
the admission and the referenced Budget Audit from their stores, verifies
Task/Run and lease audit listings, accepts only
`next_gate=agent_step_runner_required_later`, requires the requested step index
to be exactly the budget's prior step count plus one, records the receipt in
the Step Start store, and verifies store replay by step id, admission id, Task,
and Run. The current Agent Step Start store persists those step-start receipts
as restart-replayable SQLite facts, keyed by Run step id, supervised action
admission id, and receipt digest, with owner-scoped Task/Run listings and
schema-fingerprint/tamper checks. Together they still start no step, dispatch no
provider/model/tool, read or write no source, and expose no IPC/preload or
visible Agents UI. The current Agent Step Result receipt contract is a
separate pure main-only fixed-summary receipt over one Step Start receipt: it
records only a `succeeded`, `blocked`, `failed`, or `cancelled` step outcome,
fixed display summary, and digest-bound Agent/Project/Conversation/Task/Run
identity. It stores no raw output, source context, prompt, provider/model
envelope, tool result payload, command output, Git fact, Project Revision,
Review row, Artifact payload, IPC/preload command, or visible Agents UI
authority. The contract itself still executes no step, dispatches no
provider/model/tool, reads or writes no source, runs no process, grants no
permission, creates no result-for-review, and materializes no source; store
replay and step-runner orchestration remain separate later gates. The current
Agent Step Result store persists those fixed-summary receipts as
restart-replayable SQLite facts, keyed by Step Result digest, Step Start digest,
supervised action admission id, and Run step id, with owner-scoped Task/Run
listings and schema-fingerprint/tamper checks. It still executes no step,
dispatches no provider/model/tool, reads or writes no source, stores no raw
output, mutates no Git or Project Revision, creates no Review or Artifact, and
exposes no IPC/preload or visible Agents UI. The current Agent Step Result
service composes that store with the recorded Step Start store: it reads a Step
Start receipt by owner and Run step id, requires the expected Step Start digest,
verifies Step Start admission/Task/Run listings, creates and stores or replays
the fixed-summary Step Result receipt, and cross-checks result reads by result
digest, Step Start digest, admission id, Task, and Run. It still performs no
step execution, provider/model/tool dispatch, source access, permission grant,
raw-output/context storage, Git/Project Revision mutation, Review/Artifact
creation, IPC/preload exposure, or visible Agents UI. Step-runner orchestration
and using Step Result receipts in Agent progress projection remain separate
later gates. A separate Agent Step Progress projection can now consume recorded
Step Start store and Step Result store list results and expose only a bounded,
renderer-safe progress window: step id, step index, recorded state, and fixed
public summaries. It verifies receipt binding and rejects orphan, duplicate, or
identity-drifted facts, but it exposes no receipt digest, supervised action
admission, Budget Audit, assignment/lease, provider/tool/model fact, source,
raw output, Git, Review, Artifact, IPC/preload, or renderer authority. It does
not start, run, store, subscribe, or render Agent steps; Conversation/Task
Stream admission remains a later gate. A separate Agent Step Progress read
service composes the Step Start store, Step Result store, and that projection
behind one main-only read entrypoint. It accepts only owner, Project, Task, and
Run ids, returns only the bounded projection plus fixed read counts/statuses and
`main_owned_agent_step_progress_read_service` evidence, and exposes no receipt
objects, digests, supervised action admission, Budget Audit, assignment/lease,
provider/tool/model fact, source, raw output, Git, Review, Artifact, IPC,
preload, renderer authority, execution, or UI subscription. The current Agent
Step Progress Conversation admission contract can then bind one selected public
step progress item from that read-service result to a trusted active
Project/Conversation/Turn/Task/Run context. It emits a digest-bound main-side
admission record for trusted Conversation event recording, carrying only the
public step id/index/state, fixed result summary, read/projection version
stamps, lifecycle, authority, and admission digest. It exposes no Step
Start/Result receipt object or digest, supervised action admission, Budget
Audit, assignment/lease, owner/agent id, provider/tool/model fact, source, raw
output, Git, Review, Artifact, IPC/preload, renderer authority, execution, or
Task Stream subscription. The Conversation main service can now append one such
admission through a trusted-context-only `record_agent_step_progress` method,
advancing the trusted Run head without accepting renderer authority. Conversation
replay accepts that verified admission only while the matching work Turn/Task/Run
is active and still running; duplicate admissions, result-before-start,
question-mode, cancelled, or interrupted contexts are rejected. The renderer-safe
Task Stream exposes
only a public `agent_step_progress_recorded` item with step id/index, recorded
state, fixed summaries, and fixed lifecycle flags. The renderer domain
sanitizer re-validates ordering and lifecycle rules before the visible
Workbench may render a compact fact-backed status row. This still does not
create the Agent progress event directly from the stores, add IPC/preload
subscription, start or run Agent steps, dispatch provider/model/tool, read or
write source, store raw output/context, create Revision/Review/Artifact
authority, or add autonomous Agents UI. The current Agent Step Progress
Conversation recording service now provides the first internal composition gate
over that chain: it re-reads the store-backed progress window, creates the
selected Conversation admission, and invokes the trusted Conversation main
service append method, while returning only the advanced trusted context and
fixed main-owned service evidence. It is not a poller or subscription, exposes
no renderer/IPC/preload command, and does not own step execution,
provider/model/tool dispatch, source access, raw output, Git, Revision, Review,
Artifact, or visible Agents authority. The current Agent
Tool Call Record service connects a persisted `call_tool` supervised action
admission to the existing
main-only Tool Call Record contract: it reads the admission by owner, verifies
Task/Run admission listings, accepts only
`next_gate=tool_call_record_required_later`, and creates a deterministic
pre-dispatch tool-call record from a main-issued Tool Session Policy plus an
allowed Tool Permission Admission. The current Agent Tool Call Record store
persists those pre-dispatch records as restart-replayable SQLite facts keyed by
tool call id, supervised action admission id, record digest, and a store-entry
digest that binds the external owner/admission fact to the Tool Call Record
digest. The service records or replays the generated record through that store,
then verifies read-by-tool-call, read-by-admission, Task listing, and Run
listing before returning. Together they still dispatch no provider/model/tool,
execute no tool, read or write no source, store no raw output, grant no
permission, mutate no Git or Project Revision, create no Review or Artifact,
and expose no IPC/preload or visible Agents UI. Actual Agent execution,
model/tool dispatch, tool-result recording, private source collection, and
further step-runner orchestration remain separate later gates. The current
Agent Private Source Context service connects
a persisted `read_private_source` supervised action admission to the existing
main-only Source Context Collector: it reads the admission by owner,
verifies Task/Run admission listings, accepts only
`next_gate=source_context_collector_required_later`, verifies the supplied
trusted Conversation work Run context against the admitted Project,
Conversation, Task, and Run, and then returns the collector's private bounded
source-context result only to the main caller. It now converts that result into
a digest-only Private Source Context record, records the receipt through the
Private Source Context Record store, and verifies read-by-digest,
read-by-admission, Task listing, and Run listing before returning. If a receipt
for the same admission already exists, the service fails closed before invoking
the collector; restart recovery restores the digest receipt, not raw source
content. It still exposes no IPC/preload command, visible Agents UI,
provider/model dispatch, source write, Git mutation, Project Revision, generic
Review row, or Artifact authority. These
Agent authorities expose no Agents UI, IPC/preload command, permission grant,
provider/model dispatch, arbitrary tool execution, source write, Git mutation,
Review, Revision, or Artifact authority. The current Agent Private Source
Context record contract can now turn a `read_private_source` supervised action
admission and one collector result into a deterministic digest-only receipt. It
revalidates the bounded source tree, keeps only resource/content digests, file
counts, byte counts, context/head/request binding, lifecycle, and authority, and
rejects raw file paths or content in the persisted shape. The current Agent
Private Source Context record store persists those digest-only receipts as
restart-replayable SQLite facts keyed by record digest and supervised action
admission id, with owner-scoped reads and Task/Run listings. The store verifies
canonical record JSON, schema fingerprint, runtime pragmas, and row/receipt
consistency. The Private Source Context service uses the store only for digest
receipt durability; the store itself performs no source read and cannot
rehydrate raw private source. Together they are still main-only contracts with no
IPC/preload command, no visible Agents UI, no provider/model/tool dispatch, no
permission grant, no source read by the store, no raw source storage, no source
write, no Git/Project Revision mutation, no Review row, and no Artifact
authority.

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
