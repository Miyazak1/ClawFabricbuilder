# Post-MVP Product Expansion Plan

This document preserves the product ideas that should come after the MVP
Programming Loop. It exists so the team can keep the long-term ClawFabric shape
without letting future features displace the first reliable Codex-like coding
loop.

## Current Focus

The current implementation priority is only the MVP Programming Loop:

```text
select project
-> understand project
-> read-only plan
-> approved bounded edits
-> automatic draft checkpoint
-> diff, preview, and basic check evidence
-> explicit save version
-> packaged restart recovery
```

Everything below is future work unless it directly supports this loop.

## Expansion Rule

Future features must grow from Builder's trusted work facts:

- Git source facts;
- SQLite Project Revision receipts;
- Review decisions;
- Permission decisions;
- Draft Checkpoints;
- Working Context State;
- ProgrammingRun, ToolAction, CheckRun, PreviewRun, and ChangeExplanation facts.

No future feature may bypass project selection, permission, review, checkpoint,
save version, restart recovery, or provenance boundaries.

## Future Tracks

### Track A: Work Capsule

Purpose: turn reviewed local work into a reusable result package.

Path:

```text
Local Work Capsule Manifest
-> exportable capsule
-> shareable capsule
-> community remix object
```

Start only after:

- Save Version is restart-safe;
- Review Workspace can show diff, preview, check evidence, and change
  explanation;
- local Artifact and Revision references are stable.

Near-term scope:

- local manifest only;
- no public publishing;
- no feed;
- no source zip as authority;
- no autonomous experiment branch.

### Track B: Interactive Preview And Runtime Evidence

Purpose: make web and interactive projects verifiable, not merely generated.

Path:

```text
static preview
-> isolated live preview
-> console and screenshot evidence
-> canvas/WebGL nonblank evidence
-> mobile and desktop viewport checks
```

Start only after:

- static preview and Review Workspace are stable;
- PreviewRun facts exist;
- command and network permissions are clear.

Live JavaScript, Three.js, and WebGL support should not block the first MVP, but
it is required before Builder claims strong support for interactive web apps or
3D projects.

### Track C: Hooks And Extensions

Purpose: let advanced users customize the lifecycle after the built-in runtime
is safe.

Path:

```text
internal lifecycle events
-> read-only hook ledger
-> built-in command hooks
-> user-configured command hooks
-> restricted plugin/extension model
```

Start only after:

- ProgrammingRun and ToolAction facts exist;
- hook events are recorded as evidence;
- permission and workspace guard behavior is mature;
- hook failure behavior is fail-closed.

Builder should learn from Codex, Claude Code, Pi, OpenCode, and DotCraft, but
not expose arbitrary full-permission extension code in the ordinary desktop
product before trust, review, and hook ledgers are mature.

### Track D: Persistent Agents

Purpose: allow a named AI actor to continue bounded work across time.

Path:

```text
single supervised task
-> persistent goal
-> pause/resume/cancel
-> budgeted steps
-> owner-reviewed result
```

Start only after:

- the personal workbench can reliably complete one approved programming run;
- permissions, budgets, interruption, and restart recovery are stable;
- user-visible Task/Run status is understandable.

Persistent Agent work must not become hidden autonomous execution. It remains
owner-supervised and review-bound.

### Track E: Agent-To-Agent Delegation

Purpose: let one supervised Agent ask another Agent for scoped help.

Start only after:

- single Agent execution is real and user-visible;
- delegated permission intersection is enforced;
- child results return as reviewable contributions;
- cancellation and failure propagation are deterministic.

Delegation cannot grant broader permission than the parent task already has.

### Track F: Memory, Handoff, And Context Retrieval

Purpose: help long-running work survive context limits and task boundaries.

Path:

```text
Working Context State
-> automatic compaction
-> handoff packet reconciliation
-> project memory candidates
-> optional vector retrieval candidates
```

Start only after:

- Run Context Snapshot is in the provider path with explicit disclosure gates;
- stale context and active-run interruptions have deterministic behavior;
- users can inspect and correct the current context surface.

Vector retrieval is a candidate input to Context Assembly, not permission,
readiness, or plan authority.

### Track G: Collaboration, Spaces, And Inbox

Purpose: allow people to organize, review, and contribute work together.

Path:

```text
local Space organization
-> Inbox for review requests and decisions
-> contribution admission
-> authenticated collaboration
-> sync and conflict handling
```

Start only after:

- local Review and Save Version are stable;
- external input can enter as Contribution without direct mutation;
- identity, roles, and lifecycle rules are defined.

Chat, comments, reactions, and presence are interaction surfaces. They do not
become source, revision, permission, or review authority.

### Track H: Community, Explore, And Remix

Purpose: make verified work discoverable and reusable.

Path:

```text
local capsule
-> export package
-> shareable result
-> Explore
-> remix lineage
```

Start only after:

- Work Capsule is local and stable;
- publishing is explicit;
- provenance, compatibility, moderation, and privacy gates are defined.

Community is a work network, not a generic attention feed. Public sharing must
never silently expose raw chats, secrets, private source context, or unreviewed
Agent output.

### Track I: Playful Product Surfaces

Purpose: make the product feel alive without weakening the workbench.

Allowed shape:

- projections over safe work facts;
- waiting-time interactions that do not spend provider tokens by default;
- local project history maps;
- harmless challenges or demos;
- expressive but low-permission UI.

Not allowed:

- creating source changes;
- running commands;
- granting permissions;
- publishing;
- deleting;
- saving versions;
- spending tokens in the background without explicit user intent.

### Track J: Provider And Protocol Expansion

Purpose: support stronger model protocols without destabilizing the release
path.

Path:

```text
stable Chat Completions adapter
-> provider capability manifests
-> Responses-style adapter
-> Anthropic Messages-style adapter
-> provider-native tool/event streams
```

Start only after:

- current provider path has packaged canary evidence;
- each new protocol has shadow canaries;
- provider events are normalized before affecting local facts.

No provider protocol should directly own Builder Run, ToolAction, Review,
Artifact, Git, SQLite, or Permission authority.

## Priority After MVP

Recommended order:

1. Work Capsule local manifest, because it turns saved work into reusable
   product memory without network risk.
2. Live preview evidence, because web apps need real interaction and runtime
   checks.
3. Failure triage and bounded repair, because it upgrades basic generation into
   reliable programming.
4. Hook ledger and restricted command hooks, because advanced customization
   should start from observable events.
5. Persistent Agents, because autonomy should only start once the single-run
   workbench is trusted.
6. Collaboration and Work Capsule sharing, because external input and public
   output require stable local provenance first.
7. Community and remix, because discovery is only valuable after capsules are
   trustworthy.

## Parking Lot

These ideas remain valid but should not drive the MVP:

- social community feed;
- public profiles;
- agent personalities;
- multi-agent teams;
- autonomous experiment branches;
- plugin marketplace;
- vector memory;
- live 3D/WebGL preview;
- full Terminal surface;
- server sync;
- contribution inbox;
- project templates and capability catalogs;
- games or waiting-time toys.

Each item needs a later standalone gate before implementation.
