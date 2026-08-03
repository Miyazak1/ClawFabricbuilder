# ClawFabric Product Vision and Roadmap

## Product Definition

ClawFabric is a work-native environment where people and AI turn an idea into a
usable project, improve it together, run governed work, and share reusable
results.

The product is not only a code generator and it is not only a community. Its
long-term system has six connected experiences:

1. **Create** - describe an idea, generate or edit a project, preview it, and
   save a version.
2. **Work with AI** - ask AI to inspect, plan, change, verify, explain, and
   repair work while the user remains in control.
3. **Use AI Agents** - give a bounded goal to a persistent agent that can use
   approved tools, report progress, pause, resume, and deliver evidence.
4. **Delegate between Agents** - let one agent assign a scoped subtask to
   another without transferring unrestricted authority.
5. **Collaborate with People** - organize projects in Spaces, request reviews,
   admit contributions, and communicate through contacts and chat.
6. **Discover and Reuse** - publish verified work to a work-native community,
   inspect its lineage, remix it, and improve it.

The trusted foundation is shared across all six experiences: Git-backed code
version facts, Project Revision receipts, Workflow Version, Goal, Task, Run,
Artifact, Review, Permission, Agent, Contribution, Delegation,
Space/Membership, Identity/Conversation, and Publication facts.
Conversation, reactions, presence, and UI state are interaction surfaces, not
durable work authority.

In this roadmap, a **Goal** is not a plan, todo title, working brief, or single
build instruction. It is the persistent-agent contract: the agent keeps moving
through planned steps, execution, verification, repair, and progress reporting
until the goal is actually done or explicitly blocked.

The staged engineering gates are defined in
[Implementation Plan](IMPLEMENTATION_PLAN.md).

## Product Promise

The ordinary user loop is:

```text
Say what you want
-> AI prepares a draft
-> Try and inspect it
-> Ask for changes
-> Save a version
-> Continue alone, with people, or with Agents
-> Review, share, and reuse verified results
```

The user should not need to understand compilers, schemas, adapters, receipts,
or sandbox protocols to complete this loop.

## Roadmap Operating Principle

Real-time user feedback is product evidence, not an automatic implementation
order. Each feedback item must be classified before it enters a code slice:

- current-stage blocker for the ordinary user loop;
- long-term architecture capability that needs roadmap placement first;
- interaction or visual polish that should wait for the relevant UI slice;
- future-stage request that should not displace the current Builder path;
- product-direction conflict that needs redesign instead of a local patch.

Only feedback that fits the current stage and active slice should be implemented
immediately. Feedback that supports the long-term direction but is not yet
admissible should update the roadmap or architecture docs. Feedback that
conflicts with the long-term product model should not receive a compatibility
patch; the product principle must be resolved first.

The current chat-first routing boundary is an example of a current-stage
blocker, not a cosmetic fix: selecting a folder enables work, but exploratory
chat and plan discussion must remain read-only until the user gives clear
execution intent.

## Current Architecture Direction: Git-Backed Builder

As of repository HEAD `a7e0fc2` on 2026-07-22, the standalone desktop Builder
demonstrated:

- a dedicated Electron and React product shell;
- OpenAI-compatible provider configuration, including a real DeepSeek check;
- encrypted local credential storage;
- natural-language project generation and revision;
- local Project Revisions and restart recovery;
- static preview that does not execute generated JavaScript;
- saved project discovery and reopen;
- packaged Windows verification, installed parity, and uninstall data safety.

The exact dated evidence and inheritance rule are recorded in
[Release Evidence - 2026-07-22](RELEASE_EVIDENCE_2026_07_22.md).

This checkpoint proves the first creation loop. It does not yet prove a
persistent AI Agent, arbitrary generated-code execution, cloud collaboration,
public publishing, or Agent-to-Agent delegation.

The long-term storage model is now clean architecture rather than compatibility
with that first storage prototype:

- each Builder project is a normal project directory and standard Git
  repository;
- the packaged app carries canonical Git, currently located through `dugite`;
- the Git runner invokes embedded Git with a minimal fixed environment and does
  not inherit arbitrary `process.env` through `dugite.exec`;
- AI changes first become working tree edits and a reviewable diff;
- explicit acceptance persists an immutable Git candidate commit/ref without
  updating `main` or claiming that the candidate is current;
- one SQLite transaction records and selects the Project Revision receipt bound
  to its Task, Run, Review decision, commit, tree, and parent OIDs;
- a separate expected-old projection updates `main` and the selected working
  tree after SQLite selection;
- Git commit, tree, and parent OIDs are the code facts;
- Builder Project Revision is a SQLite product receipt binding Project, Task,
  Run, Review, Artifact, and Git OIDs;
- SQLite manages Conversation, Task, Run, Review, Artifact references,
  idempotency, and provider-independent metadata;
- `.clawfabric/` stores project identity and local configuration only, not
  source history or credentials.

SQLite current selection is the product fact. `main` and the working tree are
rebuildable projections, not reverse authority. A Git candidate without a
selected SQLite receipt is an invisible orphan candidate. A selected receipt
whose Git commit evidence is missing is an integrity failure. Branch or
working-tree drift is repaired from SQLite and cannot rewrite SQLite truth.

Development-stage Builder does not read old projects, old v1 JSON revisions,
old APIs, or old renderer contracts. Compatibility and migration are not goals
unless a future real-user migration is explicitly authorized. The old JSON
revision repository, IPC, and catalog chain can be deleted directly; new work
must not rely on mixed-mode restore.

The current one-shot Make/Update interaction must evolve through the
[Builder Conversation and Task Stream MVP](BUILDER_CONVERSATION_TASK_STREAM_MVP.md),
where conversation guides work but Git commits, Project Revision receipts, and
Runs remain authoritative.

## Roadmap

### Stage 1 - Make the Builder a Complete Personal Workbench

User experience:

- a continuing project-local conversation and task stream rather than a series
  of isolated one-shot prompts;
- questions and explanations that do not create source changes;
- code candidates that are previewed before explicit Save;
- version history, comparison, restore, duplicate, and export;
- a clear Activity/History view for saved versions and generation outcomes;
- explicit review before replacing a saved version;
- stronger edit and repair loops across continued conversation;
- provider presets for mainstream OpenAI-compatible models without binding the
  product to one vendor.

Required facts:

- Git commit, tree, and parent OIDs are source authority;
- Project Revision is a product receipt bound to Git OIDs;
- an immutable candidate commit is not current until SQLite records and selects
  its Project Revision receipt;
- `main` and the working tree are projected from that selection with
  expected-old compare-and-swap and may be rebuilt after drift;
- each generation or modification becomes a local Run fact;
- preview and export become Artifact facts derived from a Project Revision
  receipt or Run;
- Activity is a read model derived from those facts, not a second source of
  truth.

This stage spans common foundation Gates F0-F7 in the implementation plan;
individual Git kernel, SQLite metadata, conversation, History, Version, and provider improvements may ship
earlier when their own gates pass.

Not promised yet:

- arbitrary shell, network, backend, or generated JavaScript execution;
- background autonomous work;
- public links or cloud sync.

### Stage 2 - Human and AI Collaboration

User experience:

- AI can inspect the current project, propose a plan, make bounded edits, run
  approved checks, explain changes, and request confirmation;
- the user can accept, reject, revise, pause, or retry;
- failed work can be resumed without losing the last verified version;
- Activity/Inbox shows decisions that need human attention.

Before broad tool access, the personal workbench should already show
fact-backed assistant progress and completion summaries in the chat flow. The
first version is limited to Run progress, live assistant output, safe tool-step
projections, and terminal result summaries. File-by-file edits, command runs,
test/repair loops, child Agent updates, and cross-task summaries require the
later Permission and Tool gates.

Required facts:

- Goal and Task identify requested work;
- Run records an attempt and its terminal result;
- Review records an explicit decision;
- Permission records what tools and data the AI may use;
- all source changes still end in a reviewed Git commit plus Project Revision
  receipt.

The AI may propose work, but it cannot silently publish, share, delete, grant
permissions, or commit a verified version.

This stage adds Gates F8-F9: durable Permission authority followed by the
tool-enabled work session. Tool access is an upgrade to the continuing Builder
conversation, not a prerequisite for asking questions or iterating on a code
candidate.

The first user-facing permission slice should arrive before general Terminal,
network, publishing, or persistent Agent autonomy. It should cover the selected
project boundary: chat and planning are read-only, build requires explicit
execution intent plus current-project write permission, and command/network/
external-directory access remains denied until later gates.

After that minimum project-bound permission exists, Builder can add a first
local document/file artifact writer. A request such as creating a Markdown
document should be treated as a selected-project-bound artifact write: it may
create or modify `.md` files only inside the chosen project folder, first as a
reviewable candidate diff/preview, then as a saved version after explicit user
acceptance. This capability should land before Terminal or arbitrary command
execution because it exercises file authority with lower runtime risk, but it
must not bypass project selection, write approval, review, or version facts.

Current checkpoint: Markdown/text artifact requests now enter the same
selected-project build admission and unsaved candidate review path as code
changes. The implementation treats Markdown, README, notes, `.md`, and plain
text documents as project files, not Terminal commands or hidden writes.

### Stage 3 - Persistent AI Agents

User experience:

- create named Agents for roles such as Builder, Researcher, Reviewer, or
  Publisher;
- assign a goal that the agent continues until done or blocked, inspect a plan,
  observe progress, pause, resume, cancel, and review the result;
- see budgets, allowed tools, working scope, and recent outcomes in ordinary
  language;
- agents can continue bounded work across app restarts.

Required gates:

- durable Goal, Task, Run, and Agent identity;
- explicit tool and data permissions;
- bounded time, cost, output, and retry policy;
- cancellable supervision and durable event history;
- safe workspace boundaries and secret handling;
- review before effects that cross a trust boundary.

An Agent is not a hidden prompt preset. It is a governed actor with identity,
scope, permissions, work history, and reviewable results.

Current checkpoint: Builder now has a pure main-side Agent Goal contract, a
main-only Agent Goal store, a pure Goal-to-Assignment admission receipt, a
main-only admission store, a pure materialization receipt that can prove an
admitted Assignment is recorded in the Assignment store with its initial
`queued` status, and a main-only materialization receipt store for restart-safe
owner/task, read-by-Assignment, and read-by-admission lookup. Builder also has
a main-only materialization service that composes those stores to record or
replay the admission, queued Assignment, and materialization receipt without
starting execution. Builder also has a main-only Assignment supervision service
that records or replays the queued Assignment's `active` status and active
supervision lease only after lease-window preflight, still without starting
execution. Builder also has a main-only Budget Audit service that records or
replays allowed or denied pre-action budget facts only when the matching active
lease is store-backed at the observed time, still without performing the
requested next action. Builder also has a main-only Project Work Result service
that records or replays fixed project-edit or project-test result receipts only
after an allowed `finish_for_review` budget audit for the same active lease,
still without creating Review, Artifact, source materialization, or Project
Revision authority. Builder also has a main-only Project Work Result review
contract and store that can record owner approval, rejection, or acknowledgement
of one recorded Agent work result without making that result a generic Review,
Artifact, source change, check run, or Project Revision; and a main-only review
service that records those decisions only after reading the store-backed work
result. Builder also has a main-only review release service that closes the
active supervision lease after a store-backed owner review decision, without
changing Assignment or Goal status and without materializing source. Builder
also has a main-only review assignment close service that records or replays
the reviewed Assignment attempt's `completed` status only after the reviewed
lease has a completed release, without marking the Goal complete and without
materializing source. They record and restore bounded objectives with
`continuous_until_done_or_blocked` semantics, owner-reviewed completion,
ordered owner status decisions, and an active-Goal bridge into a future
owner-supervised Assignment candidate. The materialization receipt, store,
supervision, budget, result, result-review, review-release, and
review-assignment-close facts still do not start a Run, dispatch a model or
tool, write source files, save a Project Revision, create a Review/Artifact,
or expose a visible Goal UI.

Current Agent-to-Agent checkpoint: Builder has pure main-side Delegation
contract/store facts, a main-only Delegation service, a main-only Delegation
result service, a main-only Delegation result admission service, and a main-only
Delegation result review service. The Delegation service can record or replay a
scoped Delegation only after reading a store-backed active parent Assignment,
active parent supervision lease, and active target Agent/current version. The
Delegation result service can record or replay a child result-return receipt
only after reading that store-backed Delegation receipt and verifying
parent/child Task Delegation and result listings. The Delegation result
admission service can record or replay a local admission receipt only after
reading a store-backed Delegation result and verifying parent/child Task result
and admission listings. The Delegation result review service can record or
replay an owner decision receipt only after reading a store-backed admitted child
result and verifying parent/child Task admission and review listings. The
Delegation result parent materialization eligibility contract can record only
that an approved proposed child result is eligible for a later parent
materialization gate, and the Delegation result parent materialization
eligibility store can persist those receipts for restart-safe owner and
parent/child Task lookup. This is still local evidence only: it creates no child
Assignment or Run, dispatches no model or tool, grants no permission, writes no
source files, saves no Project Revision, creates no Review/Artifact, performs no
parent materialization, and exposes no visible Agents UI.

Persistent Agent context must be task-centered rather than transcript-centered:
the Agent owns stable identity and curated memory, while durable work context,
decisions, permissions, run evidence, artifacts, and child delegations are
attached to Tasks. The executable context model is defined in
[Persistent Agent Task Context Architecture](PERSISTENT_AGENT_TASK_CONTEXT_ARCHITECTURE.md).

### Stage 4 - Spaces and Human Collaboration

User experience:

- organize projects, agents, runs, and artifacts in Spaces;
- invite people with explicit roles;
- request review and send contributions without directly changing another
  person's work;
- use contacts and chat to discuss, clarify, and explicitly delegate work;
- receive invitations, reviews, failures, and contribution requests in Inbox.

Required facts:

- Space organizes trusted objects but does not replace them;
- Contribution is the admission boundary for external input;
- Review and Permission control acceptance and access;
- chat messages can lead to work only through an explicit delegate, accept, or
  create action.
- Identity, Contact Relationship, Conversation, Space, Membership, and Role
  facts have independent authorities and privacy/lifecycle rules.

Local Spaces can arrive before server synchronization. Multi-user collaboration
requires authenticated identity, sync, conflict handling, audit evidence, and
privacy controls.

### Stage 5 - Agent-to-Agent Delegation

User experience:

- a primary Agent may ask a specialist Agent to complete a clearly described
  subtask;
- users can see who delegated what, which tools and budget were allowed, and
  what result came back;
- results return as reviewable contributions, not invisible mutations.

Required facts:

- Delegation binds parent task, child task, delegating actor, receiving actor,
  scope, budget, permission subset, deadline, and expected result type;
- delegated permissions can only be equal to or narrower than the parent's
  authority;
- the child cannot forward secrets or grant new authority;
- completion returns evidence and an Artifact or Contribution;
- cancellation and failure propagate predictably without rewriting history.

This stage follows reliable single-Agent work, but it does not require public
Community or server Spaces. Multiple agents must not be used to disguise an
ungoverned chain of model calls.

### Stage 6 - Community, Explore, and Reuse

User experience:

- publish selected versions, artifacts, templates, or tools;
- discover useful work through Explore;
- inspect provenance, compatibility, verification, and remix lineage;
- copy or remix work into a new local project;
- follow people, Spaces, and Agents whose work is useful.

Community is work-native. It is not an entertainment feed optimized for time
spent. Likes, comments, reactions, and chat do not alter a Project Version,
Run, Artifact, Permission, or Review.

Publishing is always explicit. The first local Share experience may only create
a safe proof or export package; public links, profiles, ranking, moderation,
and server sync require later independent gates.

Stages 3-6 share common facts but can advance as parallel product tracks after
the personal workbench foundation. Their numbering describes the product story,
not a mandatory serial implementation order.

## Product Information Architecture

Surfaces should appear only when they have real capability behind them:

| Stage | Visible areas |
| --- | --- |
| Current | Projects, Settings |
| Personal workbench | Projects, History/Review, Activity, Settings |
| Collaboration | Spaces, Inbox, Projects, History/Review, Settings |
| Agent work | Agents, Tasks, Activity, History/Review |
| Networked product | Explore, Contacts, Chat, Spaces, Agents, Projects |

The shell may be designed for these areas now, but empty future navigation
should not be shown as if the capability already exists.

## Success Measures

- a new user reaches a useful saved project quickly;
- AI changes reduce work while preserving user control;
- failed work is resumable and does not corrupt the last verified version;
- users can understand what an Agent did and approve consequential actions;
- shared work is reused or remixed with intact provenance;
- social interaction converts to explicit useful work without accidental
  materialization;
- no permission, secret, identity, or fact-authority boundary is bypassed.

## Explicit Non-Goals

- a generic social feed or attention marketplace;
- chat history as project memory or source authority;
- unsupervised autonomous delivery;
- unrestricted local command, filesystem, or network access;
- one universal Agent with implicit access to everything;
- silent promotion of comments or Agent output into verified work;
- claiming all languages or providers are runnable before their adapters and
  verification gates exist.
