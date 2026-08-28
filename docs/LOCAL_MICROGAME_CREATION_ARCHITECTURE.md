# Local Microgame Creation Architecture

## Decision Status

Local Microgame Creation is a future product slice for ClawFabric Builder. It
should be treated as a governed extension of the trusted Builder workbench, not
as a separate game marketplace, public feed, or unrestricted runtime.

The stable product terms are:

- `Local Microgame Studio`;
- `Microgame Project`;
- `Game Manifest`;
- `Game Capsule`;
- `Local Gallery`;
- `Community Remix`.

The first useful form is local and private. Public publishing, Steam-like
discovery, ratings, subscriptions, and networked community features require
later Publication, identity, moderation, and privacy gates.

## Product Definition

A Microgame Project is a small playable web project that a user can create with
AI, inspect, revise, preview, save as a version, and later package for reuse.
The ordinary loop is:

```text
Describe a small game
-> AI drafts a project
-> Preview it locally
-> Revise with AI
-> Review changes and evidence
-> Save a version
-> Create a local Game Capsule
-> Remix locally or publish later
```

The target experience is office-native and lightweight:

- short sessions, usually 3 to 10 minutes;
- pause-friendly and low-friction;
- browser-based;
- local-first;
- reviewable and remixable;
- safe by default.

This is not a promise that arbitrary generated games can run, install
dependencies, reach the network, start servers, access secrets, or publish
without review.

## Relationship To Existing Builder Concepts

Local Microgame Creation should grow from existing Builder facts:

- Project source remains a Git-backed Project Revision.
- Drafts remain unsaved candidates until explicit Review and Save.
- Preview evidence comes from the Live Preview and PreviewRun chain.
- Reusable packaging grows from Work Capsule.
- Agent collaboration remains bounded by Task, Run, Permission, Budget, and
  Review facts.
- Community Remix is a later projection over reviewed capsules, not a source
  authority.

The product shape is:

```text
Microgame Project
-> reviewed Project Revision
-> Live Preview evidence
-> Local Work Capsule Manifest
-> Game Capsule metadata
-> Local Gallery
-> Exportable or Shareable Capsule
-> Community Remix
```

If Game Manifest or Game Capsule metadata conflicts with Git, SQLite, Review,
Artifact, Permission, or Publication facts, the trusted Builder facts win.

## Non-Goals

Local Microgame Creation must not introduce:

- public publishing before explicit Publication authority exists;
- a social feed optimized for attention;
- hidden uploads or public links;
- silent source mutation;
- silent Save or Version creation;
- background token spend;
- unrestricted JavaScript execution in the desktop renderer;
- Node.js, Electron, IPC, filesystem, Git, SQLite, provider, credential, shell,
  or secret authority inside previewed game code;
- automatic package installation;
- backend or full-stack runtime support;
- external network access by default;
- ratings, subscriptions, or comments as source, revision, review, permission,
  or publication authority.

## Game Manifest v0

`Game Manifest v0` is the minimal metadata shape for a local Microgame Project.
It is not a publication record and is not a replacement for Work Capsule.

```text
GameManifestV0
- manifest_version
- game_id
- project_id
- revision_receipt_digest?
- title
- summary
- entry
- viewport
- controls[]
- tags[]
- screenshots[]
- compatibility
- requested_capabilities
- remix
- license
- safety
```

Field intent:

- `manifest_version`: fixed schema marker, such as
  `builder-game-manifest.v0`.
- `game_id`: deterministic local identifier derived from project/revision
  evidence when a reviewed revision exists.
- `project_id`: Builder Project identity.
- `revision_receipt_digest`: present only when bound to a saved reviewed
  version.
- `title`: user-facing game title.
- `summary`: short public description.
- `entry`: project-relative HTML entry path, initially one file such as
  `index.html`.
- `viewport`: preferred width, height, aspect ratio, and orientation.
- `controls`: keyboard, pointer, touch, or gamepad hints, with labels only.
- `tags`: bounded discovery tags such as `puzzle`, `arcade`, `focus-break`,
  or `team-challenge`.
- `screenshots`: local Artifact references or digest-bound preview evidence,
  not arbitrary file paths.
- `compatibility`: local browser/runtime requirements and feature flags such
  as canvas or WebGL.
- `requested_capabilities`: declared runtime needs, defaulting to local static
  web only.
- `remix`: optional source capsule, source project, and lineage notes.
- `license`: local intended license/share state. It must not imply public
  publication.
- `safety`: fixed proof that no publish, network, shell, secret, filesystem
  write, Git mutation, or permission grant is created by the manifest.

The v0 capability set should be deliberately small:

```text
requested_capabilities
- local_static_web: allowed
- javascript: requires Live Preview admission
- canvas: requires PreviewRun evidence
- webgl: requires PreviewRun evidence
- external_network: denied
- shell: denied
- filesystem_write: denied
- backend_process: denied
```

## Game Capsule

A Game Capsule is a Microgame-specific projection over Work Capsule. It adds
game metadata and preview evidence to a reviewed local result.

It should reference:

- a Local Work Capsule Manifest;
- the Game Manifest;
- the reviewed Project Revision;
- PreviewRun evidence;
- screenshot or visual evidence digests;
- compatibility notes;
- remix lineage;
- intended license/share state.

It must not contain:

- credentials;
- provider envelopes;
- raw prompts;
- private source context;
- unredacted logs;
- hidden publication state;
- unreviewed Agent output as trusted work;
- source zips as authority.

## Local Gallery

Local Gallery is the first browsing surface. It is a private local projection
over saved Microgame Projects and Game Capsules.

Allowed actions:

- browse local Microgame Projects;
- open a project;
- preview a reviewed version or current draft through existing preview gates;
- duplicate or remix into a new local project;
- inspect lineage and compatibility;
- export a capsule after explicit user action.

Not allowed:

- public upload;
- follow, like, rate, comment, or subscribe as if community exists;
- remote dependency fetching;
- hidden publish;
- cross-project mutation without an explicit import/remix action.

## Local Microgame Preview Evidence v1

The first implementation slice should prove that a local game can be safely
previewed. It should not introduce Gallery or public Community.

Scope:

```text
current Project
-> one admitted HTML entry
-> isolated Live Preview
-> bounded evidence summary
-> renderer-safe status projection
```

Evidence requirements:

- load reached a terminal status;
- first frame was visually nonblank;
- canvas evidence is `nonblank`, `blank`, `not_applicable`, or `not_checked`;
- WebGL evidence is `available`, `unavailable`, `not_applicable`, or
  `not_checked`;
- console error count is recorded as a bounded count;
- blocked external network count is recorded;
- blocked navigation/new-window/download requests are recorded;
- Stop or app shutdown disposes the preview server, session, and
  WebContentsView;
- renderer receives only a status projection, not URLs, source content,
  screenshots, console text, paths, WebContents ids, or session ids.

Suggested proof object:

```text
MicrogamePreviewEvidenceV1
- evidence_version
- project_id
- conversation_id
- preview_run_id
- source_tree_digest
- entry_path
- loaded
- first_frame_pixel_status
- canvas_pixel_status
- webgl_status
- console_error_count
- blocked_network_count
- blocked_navigation_count
- cleanup_status
- evidence_digest
- authority
```

Authority rules:

- consume only existing Live Preview admission and PreviewRun evidence;
- do not start a server by itself;
- do not create IPC or preload authority by itself;
- do not mutate source, Git, SQLite Project Revision, Review, Permission, or
  Publication facts;
- do not publish or export.

## AI Member Collaboration

AI members can help create and improve Microgame Projects only through existing
Builder control surfaces:

- propose a game concept;
- draft or revise code as a project candidate;
- explain gameplay and controls;
- inspect PreviewRun evidence;
- suggest fixes;
- create a local Game Manifest proposal;
- prepare a Game Capsule proposal after a reviewed version exists.

AI members must not:

- publish;
- grant permissions;
- run background token work;
- access external network;
- install dependencies;
- create hidden versions;
- accept their own review;
- turn unreviewed output into a trusted capsule.

## Community Path

Community and Steam-like discovery arrive only after the local path is safe.

Recommended sequence:

1. Local Microgame Preview Evidence v1.
2. Game Manifest v0 pure main-side contract.
3. Local Game Capsule projection over Work Capsule.
4. Local Gallery and local Remix.
5. Exportable Game Capsule.
6. Shareable Game Capsule with explicit user action.
7. Authenticated Publication.
8. Explore and Community Remix.
9. Ratings, subscriptions, and creator profiles as non-authoritative metadata.

GitHub-like collaboration can enter before Steam-like discovery if it remains
source- and review-centered: fork, branch, contribution, review, and accepted
materialization must preserve Builder's existing authority model.

## Implementation Notes

The near-term implementation should avoid touching public community or publish
paths. The lowest-risk code path is:

- keep current Agent Workbench work as the control plane;
- extend Live Preview evidence after its current runtime gates are stable;
- add pure main-side Game Manifest and Game Capsule contracts before adding UI;
- add Local Gallery as a read model after manifest/capsule facts exist.

Likely future files:

- `electron/builder-game-manifest.cjs`;
- `electron/builder-game-capsule-manifest.cjs`;
- `electron/builder-microgame-preview-evidence.cjs`;
- `electron/builder-microgame-preview-evidence-store.cjs`;
- `electron/builder-microgame-gallery-projection.cjs`;
- renderer domain/application/port slices only after main contracts are stable.

Packaged canary work should extend the existing Live Preview canary with a
small local game fixture that proves JavaScript execution, nonblank canvas or
WebGL output, blocked external network, no new windows/downloads, reload, Stop,
and restart cleanup.

## Acceptance Checklist

Local Microgame Creation is ready to become visible when:

- a generated static web game can be previewed through Live Preview;
- preview evidence is stored or projected without leaking private data;
- Review Workspace can show the evidence clearly;
- Save still requires explicit user action;
- a Game Manifest can be created from trusted local facts;
- a Game Capsule can reference a reviewed Work Capsule;
- local remix creates a new project lineage instead of overwriting the source;
- public publishing remains unavailable until Publication authority exists.
