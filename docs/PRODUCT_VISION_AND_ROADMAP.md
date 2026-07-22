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

The trusted foundation is shared across all six experiences: Project Version,
Workflow Version, Goal, Task, Run, Artifact, Review, Permission, Agent,
Contribution, Delegation, Space/Membership, Identity/Conversation, and
Publication facts.
Conversation, reactions, presence, and UI state are interaction surfaces, not
durable work authority.

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

## Current Checkpoint: Builder Coding MVP

As of repository HEAD `a7e0fc2` on 2026-07-22, the standalone desktop Builder
demonstrated:

- a dedicated Electron and React product shell;
- OpenAI-compatible provider configuration, including a real DeepSeek check;
- encrypted local credential storage;
- natural-language project generation and revision;
- immutable local Project Revisions and restart recovery;
- static preview that does not execute generated JavaScript;
- saved project discovery and reopen;
- packaged Windows verification, installed parity, and uninstall data safety.

The exact dated evidence and inheritance rule are recorded in
[Release Evidence - 2026-07-22](RELEASE_EVIDENCE_2026_07_22.md).

This checkpoint proves the first creation loop. It does not yet prove a
persistent AI Agent, arbitrary generated-code execution, cloud collaboration,
public publishing, or Agent-to-Agent delegation.

It also does not yet prove the intended continuing human-AI work experience.
The current one-shot Make/Update interaction must evolve through the
[Builder Conversation and Task Stream MVP](BUILDER_CONVERSATION_TASK_STREAM_MVP.md),
where conversation guides work but saved Revisions and Runs remain authoritative.

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

- Project Revision remains source authority;
- each generation or modification becomes a local Run fact;
- preview and export become Artifact facts derived from a revision or run;
- Activity is a read model derived from those facts, not a second source of
  truth.

This stage spans common foundation Gates F1-F5 in the implementation plan;
individual conversation, History, Version, and provider improvements may ship
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

Required facts:

- Goal and Task identify requested work;
- Run records an attempt and its terminal result;
- Review records an explicit decision;
- Permission records what tools and data the AI may use;
- all source changes still end in an immutable Project Revision.

The AI may propose work, but it cannot silently publish, share, delete, grant
permissions, or mutate a verified version.

This stage adds Gates F6-F7: durable Permission authority followed by the
tool-enabled work session. Tool access is an upgrade to the continuing Builder
conversation, not a prerequisite for asking questions or iterating on a code
candidate.

### Stage 3 - Persistent AI Agents

User experience:

- create named Agents for roles such as Builder, Researcher, Reviewer, or
  Publisher;
- assign a goal, inspect a plan, observe progress, pause, resume, cancel, and
  review the result;
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
