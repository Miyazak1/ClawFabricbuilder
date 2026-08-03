# Trusted Work and Collaboration Architecture

## Core Rule

Every user-visible claim must come from one canonical fact authority. Read
models, cards, activity streams, chat, and community views may project those
facts, but may not replace or mutate them implicitly.

## Fact Authorities

| Fact | Canonical authority | Non-authoritative surfaces |
| --- | --- | --- |
| Project source | Immutable Project Revision and verified project head | editor buffer, chat, preview |
| Composed work | Immutable Workflow Version and validated dependency plan | graph layout, plan explanation |
| Requested work | Goal and Task | prompt text, notification |
| Attempted work | Run and durable events | spinner, status copy, transcript |
| Deliverable | Artifact Version and availability | preview card, chat link |
| Human decision | Review | reaction, informal approval message |
| Allowed action | Permission grant/policy | disabled button, role label |
| AI coworker | Agent Definition/Version, owner, status, and policy binding | model name, avatar, prompt preset |
| External input | Contribution until accepted | comment, message, Agent proposal |
| Agent assignment | Delegation | Agent chat message |
| Collaboration scope | Space and Membership/Role grant | sidebar grouping, room title |
| Human identity and relationship | Identity and Contact Relationship | display name, presence badge |
| Communication | Conversation Thread, Message, delivery and privacy facts | unread badge, chat summary |
| Published work | Publication bound to a Project/Artifact Version | feed card, profile page |

The current implementation has a real local Project Revision authority, a
main-only local Agent Definition/Version/lifecycle record store, a main-only
pure Agent Goal contract for bounded continuous objectives that must continue
until done or blocked, a main-only local Agent Goal/status record store for
restart-safe owner/task lookup, a pure main-side Agent Goal-to-Assignment
admission contract, a main-only local Goal-to-Assignment admission receipt
store, a pure main-side Goal-to-Assignment materialization receipt contract that
can prove an admitted Assignment is recorded as queued, a main-only local
Goal-to-Assignment materialization receipt store for restart-safe lookup, a
main-only Goal-to-Assignment materialization service that composes the
admission, Assignment, and materialization stores through idempotent replay, a
main-only local Agent Assignment/status record store, a main-only Agent
Assignment supervision service that records or replays active Assignment status
and an active supervision lease only after lease-window preflight, and a
main-only local Agent Supervision Lease/release record store. It also has a
main-only Agent Budget Audit service that records or replays allowed/denied
pre-action budget audit facts only for a currently active store-backed lease.
It also has a main-only Agent Project Work Result service that records or
replays fixed project-edit or project-test result receipts for later owner
review only after an allowed finish-for-review budget audit for the same active
lease. It also has a pure main-side Agent Project Work Result review decision
contract and main-only store that record owner approval, rejection, or
acknowledgement of one recorded project work result without creating a generic
Review row, Artifact, source materialization, check run, or Project Revision.
These Goal, Assignment, materialization, supervision, budget, result, and
result-review facts currently start no run or execution. It also has a pure
main-side Agent
Delegation contract for scoped parent/child Agent, Task, permission, budget, and
review-return evidence, plus a main-only Agent Delegation receipt store for
restart-safe parent/child Task lookup. It now has a pure main-side Agent
Delegation result-return contract that can bind a child Task result summary back
to parent review without raw output or materialization, plus a main-only
Delegation result store for restart-safe parent/child result lookup. It also has
a pure main-side local Contribution-like admission contract that can admit a
recorded child result to the parent review boundary without creating a Review,
Artifact, or parent materialization, plus a main-only Delegation result
admission store for restart-safe parent/child admission lookup. It also has a
pure main-side Delegation result review decision contract that records owner
approval, rejection, or acknowledgement of an admitted child result without
creating a generic Review row, Artifact, parent mutation, or materialized source
change, plus a main-only Delegation result review store for restart-safe parent/
child review lookup. The Agent stores and Delegation contracts are not visible
activation: they create no provider/tool dispatch, permission grant, child
assignment execution, Revision, Artifact, generic Review row, or parent
materialization authority. The lease and Delegation stores are local evidence
only, not Agent execution or Run dispatch. The remaining authorities are roadmap
contracts and must be introduced through independent implementation gates.

## Actor Model

Actors are explicit and never interchangeable:

- `human` - a person who owns or collaborates on work;
- `agent` - a governed AI actor with role, scope, permissions, and run history;
- `system` - narrow host services such as persistence, encryption, and
  supervision.

Provider models are execution dependencies, not product actors by themselves.
An Agent identity must not be inferred from a model name or API credential.

## Human-AI Work Boundary

AI may read only approved context and use only approved tools. It produces a
proposal, patch, run result, artifact, or contribution. Consequential actions
such as replacing a verified version, publishing, sharing private data,
granting access, or external side effects require an explicit policy and, when
appropriate, human confirmation.

Approved context and tools must come from current, durable, actor-bound,
deny-by-default Permission facts. A checkbox, prompt instruction, or transient
session object is not permission authority.

The minimum reliable loop is:

```text
Goal -> Plan -> Bounded attempt -> Verification -> Review -> Version/Artifact
```

Each retry is a new attempt. History is appended, not rewritten.

## Agent-to-Agent Boundary

Agent delegation is an authority intersection, not authority inheritance:

```text
child authority = parent allowed scope
                  AND delegation scope
                  AND child capability policy
                  AND current host policy
```

A delegation must bind identities, task, expected result, budget, cancellation,
and permission subset. Results return to the parent or user as evidence-backed
work requiring the same admission and review rules as human contributions. A
local owner review decision can make a delegated result eligible for a later
materialization gate, but it still does not mutate the parent task or project by
itself.

## Collaboration Boundary

Spaces organize work and participants. They do not own project source or run
truth.

Chat, contacts, comments, reactions, and presence are communication tools. They
may create a proposed delegation or contribution only after an explicit user
action. They cannot silently create a Task, Revision, Run, Artifact, Review, or
Permission.

External input enters another person's scope through a Contribution:

```text
message, share, or Agent result
-> Contribution
-> inspect and review
-> accept, revise, reject, or archive
-> explicit materialization into trusted work
```

## Community Boundary

Explore and Community display publications derived from immutable work. A
publication should preserve creator, source version, artifact, verification,
compatibility, and remix lineage.

Community metadata such as title, description, tags, comments, reactions, and
follow state may evolve independently, but it cannot alter the referenced work
facts. Remix creates a new project lineage; it never overwrites the source.

## Local and Server Authority

The desktop product remains local-first:

- local Project Revisions and encrypted provider settings are usable without a
  server;
- local Activity can be derived from verified local facts;
- export and import can precede cloud publication;
- a server may synchronize or publish only through explicit, authenticated,
  idempotent operations;
- server projections do not rewrite local source authority without an explicit
  merge or import decision.

## Workflow Boundary

A Workflow is an immutable composition of typed Tasks and dependencies. Its
Version binds the plan, required permissions, retry/cancellation policy, and
expected Artifact flow. A workflow execution creates a parent Run and step
Runs; a graph or Agent explanation is only a projection. Workflow publication,
remix, and execution use the same Review, Permission, Runtime, and Publication
boundaries as projects.

## Runtime and Tool Safety

Generated code is not trusted because an AI produced it. Execution requires a
separate governed runtime with termination, resource bounds, minimal
environment, filesystem/network/process deny-by-default, secret isolation, and
sanitized results.

Until those gates are proven, the product may store and display multi-language
code but may only claim preview, run, verify, or repair for explicitly supported
project types and adapters.

## User-Facing Language

Prefer:

- Project, Version, History, Preview
- Ask AI, Plan, Task, Agent
- Review, Accept, Try again
- Space, Inbox, Share, Remix

Keep implementation vocabulary in diagnostics or advanced inspection:

- digest, receipt, schema, adapter
- IPC, runtime, sandbox, ledger
- canonicalization, admission, projection
