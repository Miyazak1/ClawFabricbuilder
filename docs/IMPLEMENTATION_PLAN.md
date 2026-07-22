# ClawFabric Implementation Plan

## Purpose

This plan turns the product roadmap into independently verifiable engineering
gates. A projection or UI state must never stand in for a missing fact
authority.

## Verified Starting Point

The standalone Builder has a dedicated desktop shell, encrypted provider
settings, bounded generation transport, immutable Project Revisions, saved
project discovery, restart restore, and static preview. The dated package and
real-provider evidence is recorded in
[Release Evidence - 2026-07-22](RELEASE_EVIDENCE_2026_07_22.md).

## Common Foundation Gates

These gates support every later product branch.

### Gate F1 - Provider Compatibility

Keep one vendor-neutral OpenAI-compatible contract while adding tested presets
or setup guidance for mainstream providers. Provider name, model, endpoint, and
credential remain configuration, not Project or Agent identity.

Evidence requirements:

- each preset resolves to an explicit editable configuration;
- no credential is bundled, logged, echoed, or inferred;
- availability and generation are tested per supported provider shape;
- unsupported provider behavior fails safely without silent fallback.

### Gate F2 - Conversation, Message, Task, and Run Contracts

Define the project-local continuing-work model before adding more product
surfaces. Conversation and Message are communication context. Task and Run bind
requested work and attempts. None of them is Project source authority.

Evidence requirements:

- one Conversation is bound to one Project identity;
- Messages are append-only, actor-bound, ordered, bounded, and restart-safe;
- questions can produce explanations without creating source-change Tasks;
- requested work creates an explicit Task bound to the base Revision and user
  Message;
- each attempt is a distinct Run with pending, completed, failed, cancelled, or
  interrupted terminal state;
- retries link to prior attempts and never rewrite them;
- no Message, Task, or Run can grant tools, save source, publish, or impersonate
  a Revision.

The exact interaction contract is defined in
[Builder Conversation and Task Stream MVP](BUILDER_CONVERSATION_TASK_STREAM_MVP.md).

### Gate F3 - Main-Owned Conversation and Run Repository

Persist project-local Messages, Tasks, Runs, and safe assistant results in a
main-owned append-only repository.

Evidence requirements:

- request, project, parent revision, Message, Task, and terminal result are
  bound without exposing credentials or raw private data;
- pending, completed, failed, cancelled, and interrupted are distinct;
- retries are new attempts linked to the prior attempt;
- restart restores facts without redispatch;
- corruption and conflicting append evidence fail closed;
- reads and replay do not call the provider or mutate Project source;
- a completed Run does not imply a saved Revision or Artifact.

### Gate F4 - Provider Projection and Candidate Results

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
- a candidate can be previewed or compared but is never written to the Project
  repository by provider completion alone;
- cancellation, timeout, empty structured output, schema mismatch, and provider
  rejection produce fixed safe terminal evidence.

### Gate F5 - Explicit Save, Versions, Review, History, and Artifacts

Bind an accepted candidate to an explicit Save decision, then add version
comparison, duplicate, restore-as-new-version, read-only History, export,
explicit Review, and preview/export Artifact records. History is derived from
verified facts; it is not a second activity database.

Evidence requirements:

- duplicate creates new Project identity and preserved lineage;
- restore never rewrites history;
- Review decisions are durable and actor-bound;
- Save binds the accepted candidate, Task, Run, base Revision, and new Revision;
- only revisions reachable from a verified project head appear in History;
- orphaned or competing revisions do not appear and corruption fails closed;
- Artifact identity binds the producing Revision or Run;
- missing or unavailable bytes remain explicit;
- sharing and publishing remain disabled unless separately authorized.

### Gate F6 - Permission Authority

Create deny-by-default, durable Permission facts before AI is allowed to inspect
additional context or use tools.

Evidence requirements:

- actor, scope, action, resource, issuer, expiry/revocation, and policy version
  are bound;
- UI selection cannot substitute for a persisted grant;
- secret access, filesystem, network, process, publication, and destructive
  actions are independently scoped;
- revocation affects future actions and is visible in audit history;
- every tool call proves the current permission intersection.

### Gate F7 - Tool-Enabled Human-AI Work Session

Move from one-shot generation to a bounded, inspectable work session: gather
approved context, propose a plan, edit, verify, repair, and request Review.
F2-F5 must already provide a useful continuing conversation without requiring
tool access.

Evidence requirements:

- explicit Goal and Task identity;
- context and tools authorized by Gate F6 Permission facts;
- bounded step, cost, time, retry, and output policy;
- cancellation and restart semantics;
- no arbitrary generated-code execution through the renderer;
- only a saved Project Revision changes project truth.

The continuing Builder collaboration checkpoint is complete after F1-F5. The
tool-enabled Personal Workbench checkpoint is complete only after F1-F7.
Provider compatibility, conversation, explicit Save, and version UI may ship
earlier behind their own completed gates.

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

- Space and Membership/Role grants are canonical and separate from Project
  source authority;
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
2. `History/Review` and personal `Activity` - after F2-F4.
3. `Agents` and `Tasks` - after F6-F7 and A1.
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
