# Work Capsule Architecture

This document defines Work Capsule as the bridge between the trusted personal
Builder workbench and later sharing, reuse, and community surfaces.

## Decision Status

Work Capsule is a durable product and architecture concept. It should be kept as
an independent decision record instead of being folded into conversation export,
share UI, community feed, source packaging, or Agent experimentation work.

The stable product terms are:

- `Work Capsule`;
- `Local Work Capsule Manifest`;
- `Exportable Capsule`;
- `Shareable Capsule`;
- `Community Remix`.

Implementation checkpoints should preserve these boundaries. The architecture
decision may land before any code contract. The first manifest contract is a
separate main-side slice, and publishing or community work should remain
separate again.

## Definition

A Work Capsule is a reviewed, portable work package. It summarizes a useful
result that can be inspected by a person, resumed by an AI agent, exported, and
eventually remixed.

It is not:

- a social feed post;
- a raw chat transcript;
- a source zip by itself;
- an autonomous experiment branch;
- unreviewed Agent output;
- a hidden publish action.

The first useful form is local and private. Public sharing is a later projection
over the same trusted facts.

## Authority Model

Work Capsule does not become a second database or a replacement for Git and
SQLite authority.

- Git Project Revision remains the source-code fact.
- SQLite Review, Revision, Artifact, Run, Permission, Session, and Task facts
  remain the product authority.
- Artifact Preview is a derived view of a revision or run result.
- Verification evidence is a bounded summary of approved checks, not an
  unrestricted command log.
- Conversation export is optional background context. It can explain how the
  work happened, but it is not the capsule authority.
- Session and Task Addresses define the user-visible work line and subtask
  lineage that the capsule belongs to.

If a capsule manifest conflicts with Git or SQLite facts, Git and SQLite win and
the manifest must be regenerated or marked stale.

## Capsule Shape

The manifest is exact, bounded, and reference-first:

```text
WorkCapsule
- capsule_id
- project_id
- session_id
- task_address_id
- revision_receipt_digest
- artifact_refs[]
- review_decision_ref
- verification_summary
- public_summary
- remix_metadata
- provenance
```

`public_summary` is for people. It should answer what this work is, what changed,
whether it was reviewed, what can be previewed, and how to continue.

`remix_metadata` is for later reuse. Early local manifests may only reserve this
shape with placeholders such as source capsule id, parent revision, compatibility
notes, and intended license/share state. It must not imply publication.

## Product Stages

Work Capsule should arrive before full community:

```text
Local Work Capsule Manifest
-> Exportable Capsule
-> Shareable Capsule
-> Community Remix
```

Local Work Capsule Manifest is the bridge after the personal workbench can save
and review versions, and before authenticated publication, feeds, profiles,
ranking, or server sync.

## Minimum Safe Slice

The first checkpoint is this documentation decision. The current implementation
slice adds `builder-work-capsule-manifest.v1`, a pure main-side Local Work
Capsule Manifest contract.

The contract should:

- accept only existing main-owned Revision, Artifact, Review, verification, and
  Session/Task Address references;
- produce an in-memory manifest or deterministic derived record;
- fail closed for missing, stale, private, or cross-project references;
- copy no credentials, provider envelopes, raw prompts, private source trees, or
  unredacted internal logs;
- create no IPC/preload surface, network request, publish action, community UI,
  autonomous run, source mutation, Git mutation, Save authority, or delete
  authority.

Only after this contract is stable should Builder materialize local capsule
files, then export packages, then explicit share candidates.

Current checkpoint: Builder now has a pure main-side
`builder-work-capsule-manifest.v1` contract. It accepts already existing
Project Revision, Artifact reference, accepted Review Decision, verification
summary, public summary, remix metadata placeholder, and Session/Task Address
facts. It produces a deterministic in-memory Local Work Capsule Manifest and
fails closed on rejected, stale, cross-project, unclosed, malformed, accessor,
proxy, duplicate-artifact, or publication-shaped inputs. It creates no file,
SQLite write, Git mutation, IPC/preload surface, provider dispatch, source
mutation, permission grant, network access, publication, community UI, or
autonomous experiment work.

## Relationship To Existing Architecture

Read-only conversation export helps make human-readable history available, but a
Work Capsule is result-centered: it starts from the saved reviewed work, not from
the transcript.

Storage lifecycle governance controls how capsules are regenerated, exported,
archived, or removed. A local manifest is derived data; an exported capsule is a
user-owned artifact and must have explicit path and overwrite rules.

Session/Task Address gives a capsule its durable work scope. It avoids exposing
raw `conversation_id`, `task_id`, `run_id`, or receipt digests as the whole
product concept, while still keeping those facts available for internal
verification.

## Non-Goals

- No autonomous experiment branch button in the near-term path.
- No token-running background exploration.
- No public community, account, profile, feed, ranking, or moderation surface.
- No hidden upload, public link, publish, or remix.
- No capsule generated from unreviewed work as if it were trusted.
