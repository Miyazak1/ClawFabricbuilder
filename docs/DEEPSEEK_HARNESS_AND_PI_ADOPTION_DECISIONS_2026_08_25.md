# DeepSeek Harness And Pi Adoption Decisions - 2026-08-25

Date: 2026-08-25

Status: accepted research and product decision record for Roadmap Gate G0.

## Question

Which DeepSeek Harness and Pi designs should Builder adopt for a
language-independent programming loop and an integrated Browser, while keeping
desktop permissions, project truth, recovery, and ordinary-user ergonomics?

## Baselines And Sources

Builder's bundled Harness remains pinned to:

```text
Repository: https://github.com/deepseek-ai/deepseek-harness
Version: 0.1.0-rc.5
Commit: 47f943859bef60e4160492346772ded9b24f765a
Manifest: .release-runtime/harness-runtime-manifest.json
```

The upstream release train observed on 2026-08-25 has advanced to
`0.1.1-rc.2` (`b150a55` is the tag commit reported by the upstream community
release references). The repository still describes the software as developer
preview, and current package metadata discussions show that unversioned npm
dist-tags can resolve mismatched plugin trains. This strengthens the decision
to qualify immutable commits and complete dependency closures rather than
following `latest`.

Primary Harness sources:

- [repository](https://github.com/deepseek-ai/deepseek-harness);
- [architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md);
- [agent lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/agent-lifecycle.md);
- [tool execution pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-execution-pipeline.md);
- [session subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md);
- [compaction subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md).

Pi was inspected as a design reference from the actively maintained
[earendil-works/pi repository](https://github.com/earendil-works/pi), including
its 0.84.x release line and commit `4e58f32`. Version numbers are research
coordinates, not an integration pin; Builder does not ship Pi.

Primary Pi sources:

- [repository and package map](https://github.com/earendil-works/pi);
- [releases](https://github.com/earendil-works/pi/releases);
- [coding agent package](https://github.com/earendil-works/pi/tree/main/packages/coding-agent);
- [agent core](https://github.com/earendil-works/pi/tree/main/packages/agent);
- [RPC documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md);
- [extensions documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).

The existing detailed Harness baseline and Builder integration evidence remain
in [DeepSeek Harness Adoption Audit](DEEPSEEK_HARNESS_ADOPTION_AUDIT.md).

## Executive Decision

Use DeepSeek Harness as the first replaceable programming-loop engine. Expand
Builder's capability adapter around it; do not let Harness become the desktop
kernel.

Use Pi as an architecture and interaction reference. Do not embed Pi as a
second agent kernel and do not import its permissive local security model.

The target relationship is:

```text
Builder product kernel and durable facts
-> Builder capability/admission adapters
-> qualified Harness agent runtime
-> provider
```

Pi informs the shape of the adapter, terminal/job streaming, steering, session
presentation, and embedding API. It does not sit in the production call chain.

## DeepSeek Harness Decisions

| Design | Decision | Builder interpretation |
| --- | --- | --- |
| Turn/Step multi-call agent loop | Adopt | Harness owns model/tool continuation inside one admitted Builder run |
| Append-only model-visible session surface | Adopt | Builder journal remains canonical; runtime history must be reproducible |
| Tool call before execution and one settled result | Adopt | every local effect has paired durable facts |
| Layered, monotonic tool pipeline | Adopt | later policy may deny/annotate but cannot widen authority |
| Read-before-edit and observed version guards | Adopt | protect user/external changes and require re-read after staleness |
| Ordered read/exclusive scheduling | Adapt | bounded parallel reads; serialize writes/processes and commit in model order |
| Capability-provider composition | Adopt | Process, Terminal, Job, Diagnostics, LSP, and Browser remain replaceable |
| Persistent Terminal and Jobs | Adapt next | expose only through Builder-owned lifecycle and project identity |
| LSP capability providers | Adapt next | stable Builder schema; server choice remains provider-specific |
| Session resume and compaction | Adapt | Harness private continuity plus Builder canonical recovery/checkpoints |
| Goals/subagents/workflows | Defer | not required for the next programming/browser closure |
| Native broad shell authority | Reject as product policy | structured executable/argv admission and explicit risk classes |
| Runtime persistence as project authority | Reject | project, checkpoint, Version, permission, and Browser facts remain Main-owned |
| Automatic upstream replacement | Reject | use staged qualification and atomic rollback policy |

### Important Upstream Delta

The newer Harness line includes more of the capabilities Builder needs:
persistent terminal/job services, language-server capability composition,
authorization/capability providers, richer session lifecycle, and continued
tool-pipeline work. That makes an upgrade worth qualifying; it does not make an
upgrade safe to activate directly.

Builder's adapter must negotiate advertised capabilities. It must not infer
support from a semantic version, documentation page, package name, or plugin
presence.

## Pi Decisions

| Design | Decision | Builder interpretation |
| --- | --- | --- |
| Small language-independent core | Adopt | capabilities and task profiles, not language branches |
| Generic shell/PowerShell execution | Adapt | structured process admission, with an optional explicit terminal shell |
| Fast streaming tool updates | Adopt | transient updates near 100 ms; durable facts at bounded boundaries |
| Large-output private spill | Adopt | conversation receives digest/summary and expandable bounded details |
| Steering and follow-up queues | Adopt | user redirects enter at safe step/tool boundaries without a second task |
| Interactive, print, JSON, RPC, SDK modes | Adapt | one Builder runtime port supporting UI, canary, and deterministic testing |
| Session tree and branching | Adapt later | preserve continuation/Undo ancestry without forcing terminal-oriented UI |
| Dynamic tools and presentation | Adapt | typed registry controlled by Builder; no arbitrary trusted project extension |
| Deterministic checksummed release archives | Adopt for updates | stage immutable artifacts and verify exact digests |
| Verified atomic managed updates | Adopt conceptually | apply to Harness runtime with last-known-good rollback |
| Full inherited process/network/credential authority | Reject | conflicts with ordinary-user desktop security |
| Trusted project-local extensions by default | Reject | project content cannot create execution authority |
| Terminal-first product UX | Reject | chat, activity, Browser, Changes, and composer remain primary |

## Browser Finding

Neither Harness nor Pi should own Builder's built-in Browser authority. Browser
automation commonly appears through extensions, CDP, or Playwright-style
integrations, but those mechanisms are too broad to expose directly to provider
or renderer code.

Builder should implement a main-owned Browser capability with three isolated
classes:

- Project Preview for source-bound preview evidence;
- Agent Test for run-bound loopback observation and actions;
- User Web for explicit user browsing and separately consented automation.

The model receives bounded observations and action results, never page handles,
raw CDP, profile paths, cookies, or unredacted storage.

## Interaction Decisions

### Keep Decisions In The Conversation Flow

Save/Discard, approval, retry, manual takeover, and interruption recovery are
task decisions and belong adjacent to the relevant chat activity. They are not
permanent toolbar state.

Decision cards must:

- have one current authority identity;
- settle once and disappear or become inert when authority changes;
- match the composer width and docking geometry;
- never block composer input;
- remain distinguishable from model-authored prose;
- survive renderer reload from durable facts;
- never remain actionable after Save, Discard, Undo, replacement, or project
  change.

### Keep The Latest Work Near The Composer

The latest user message aligns right. Agent narration and factual activity
align left. Live output remains reachable immediately above the composer. A
decision card may visually overlap older output as part of the dock, but the
composer itself must never cover the latest output or become inaccessible.

Side Workspace expansion should reserve a moderate default width and keep a
usable conversation column. Compact layouts switch modes rather than collapsing
activity text into one-character columns.

### Do Not Animate Authority

Checkpoint/save confirmation may use a short restrained transition. Animation
must not delay settlement, hide a stale card, imply success before Main commits
the fact, or make replay produce a different state.

## Performance Decision

The current performance audit found a three-layer amplification path:

1. synchronous Main SQLite/file/Git work;
2. durable task-stream `changed` notifications followed by full read, JSON
   validation, replay, projection, serialization, cloning, and freezing;
3. broad `BuilderApp`/`BuilderPage` subscriptions and repeated ActivityPanel
   source/diff work.

The live output path already batches deltas with `requestAnimationFrame`, but
runtime events can still enter the durable slow path. This architecture cannot
scale to terminal output, diagnostics, Browser observations, and long sessions
without correction.

Accepted direction:

- text/process/browser deltas use the dedicated live stream plane and narrow
  stores;
- durable events commit at meaningful bounded boundaries;
- changed notifications carry kind/cursor and coalesce bursts;
- conversation/task projections become cached or incremental;
- IPC sends small projections and lazy refs, not full source trees/logs/pixels;
- ActivityPanel, composer, Browser, project tree, and catalog subscribe
  independently;
- Main and renderer duration/count/byte instrumentation precedes optimization;
- the acceptance matrix owns responsiveness budgets and a fixture containing
  10,000 historical facts across segments/checkpoints.

The measured evidence and resulting three-plane architecture are authoritative
in [Builder Current Event And Projection Architecture Audit](BUILDER_CURRENT_EVENT_PROJECTION_ARCHITECTURE_AUDIT_2026_08_25.md),
[Mature Coding Desktop Architecture Research](MATURE_CODING_DESKTOP_ARCHITECTURE_RESEARCH_2026_08_25.md),
and [Builder Event And Projection Foundation Architecture](BUILDER_EVENT_PROJECTION_FOUNDATION_ARCHITECTURE_2026_08_25.md).

## Final Adopt / Adapt / Reject Summary

### Adopt

- Harness Turn/Step loop, paired tool facts, monotonic policy, guarded edits,
  capability seams, append-only recovery, terminal/jobs/LSP concepts;
- Pi's small language-independent core, streaming updates, output spill,
  steering queues, RPC testability, and verified release artifacts;
- Builder-owned checkpoints, Undo, Versions, permissions, Preview, and packaged
  evidence.

### Adapt

- shell into structured Process plus separately admitted Terminal;
- runtime sessions into Builder-canonical recovery;
- terminal/browser streams into transient UI plus bounded durable summaries;
- Browser automation into typed main-owned observation/action primitives;
- managed updates into staged Harness qualification and rollback.

### Reject Or Defer

- direct GitHub self-update of active executable code;
- provider/renderer access to raw shell, CDP, browser profile, credentials, or
  desktop APIs;
- a second embedded Pi kernel;
- broad project-local plugin trust;
- subagents, goals, workflow engines, community, and publication before the
  programming and Browser loop is accepted;
- language-specific execution branches as the meaning of universal support.

## Consequence For The Next Stage

Implementation follows the order in
[Universal Programming And Browser Loop Roadmap](UNIVERSAL_PROGRAMMING_AND_BROWSER_LOOP_ROADMAP.md):

```text
A0 event/projection foundation
-> qualified Harness lifecycle
-> universal foreground Process
-> Terminal and Jobs
-> toolchains, diagnostics, and LSP
-> Agent Test Browser
-> packaged multi-language and web closure
```

Community microgames, public Gallery, and publication remain later product
layers. They become credible only after Builder can run, observe, repair,
package, and recover user-created software through these same truthful facts.
