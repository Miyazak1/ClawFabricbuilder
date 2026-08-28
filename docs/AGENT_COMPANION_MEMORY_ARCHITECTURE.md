# Agent Companion Memory Architecture

Date: 2026-08-18

Status: architecture proposal.

Related documents:

- [Persistent Agent Task Context Architecture](PERSISTENT_AGENT_TASK_CONTEXT_ARCHITECTURE.md)
- [Working Context State Architecture](WORKING_CONTEXT_STATE_ARCHITECTURE.md)
- [Trusted Work and Collaboration Architecture](TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md)
- [Builder Session and Task Address Architecture](BUILDER_SESSION_TASK_ADDRESS_ARCHITECTURE.md)
- [Storage Lifecycle Governance](STORAGE_LIFECYCLE_GOVERNANCE.md)
- [Streaming Activity UI Optimization Plan](STREAMING_ACTIVITY_UI_OPTIMIZATION_PLAN.md)

## Decision

ClawFabric should model an Agent as a long-lived companion, not as a prompt
preset and not as a single ever-growing chat transcript.

The user-facing product can feel like a persistent chat friend:

```text
Agent companion
-> remembers the relationship
-> manages projects and task capsules
-> can stay online when authorized
-> can watch, remind, plan, and work in scoped ways
```

The internal architecture must not be one large memory blob. It must be a
layered and multi-dimensional memory system:

```text
raw evidence is preserved
important experiences are summarized
stable facts, preferences, procedures, and values are consolidated
future intentions and watches remain active
each model turn assembles only relevant memory with provenance
every side effect records exactly which memory was used
```

The core rule is:

```text
Long-term memory is compressed durable understanding with traceable evidence.
It is not raw chat history, and raw chat history is not enough.
```

## Fit With Existing Builder Architecture

The current Builder architecture is already pointed in the right direction. The
existing documents separate several concepts that must remain separate:

- Agent is the long-lived actor;
- Task is the bounded work container;
- Conversation is the communication surface;
- Working Context State is the current operational snapshot;
- Work Capsule is the reviewed portable work package;
- Memory is a curated projection, not the raw transcript.

This proposal keeps that direction, but adds the missing memory machinery needed
to make the "Agent friend" model real:

- accepted memory fact contracts with scope, provenance, sensitivity, and
  supersession;
- episodic notes generated from task and conversation evidence;
- memory proposal and review flows;
- deterministic context assembly that records which memories were used;
- pre-compaction memory flush so useful knowledge is not lost;
- standing intents and autonomy levels for long-running online behavior;
- deletion, retention, and index-purge behavior;
- conflict handling between old memory, current instruction, project state, and
  user correction.

The important architectural inversion is:

```text
old model:
Project -> Task/Conversation -> Agent behavior

target model:
Agent companion -> Projects -> Tasks/Capsules -> Runs/Reviews
```

The UI may still show projects prominently, but the product identity should be
that the user is talking to a persistent Agent that can remember, organize, and
resume across projects.

## Product Goal

The Agent should gradually behave more like a reliable long-term collaborator:

- it remembers user preferences without being reminded every time;
- it remembers project conventions and past decisions;
- it knows which tasks are paused, active, blocked, or awaiting review;
- it can keep standing intentions such as "watch this project" or "remind me
  when tests fail";
- it can compress old conversations without losing the durable lessons;
- it can recall evidence when a memory is questioned;
- it can accept correction and supersede stale memories;
- it can explain which memories influenced a plan or build run;
- it never turns untrusted or stale content into execution authority.

## Reference Models

Builder should combine lessons from several mature systems without copying any
one storage layout.

### OpenClaw

OpenClaw's memory architecture is the closest product reference for the
companion model. It uses inspectable files plus an SQLite index, with separate
tiers for human instructions, curated core memory, episodic daily notes,
standing intents, and dreaming reports. The important ideas are:

- no hidden memory state;
- writing memory is harder than retrieving it;
- curation happens through a background "dreaming" pass;
- the write path is the security boundary;
- failures in memory recall should degrade quality, not block replies.

References:

- https://github.com/openclaw/openclaw/blob/main/docs/concepts/memory-architecture.md
- https://docs.openclaw.ai/concepts/main-session

### Claude Code

Claude Code separates fresh session context from durable memory. Conversations
and tool results are local JSONL session history, while durable project
instructions live in `CLAUDE.md` and auto memory lives in project-local memory
files. The important ideas are:

- session history is not the same as long-term memory;
- human-written rules and auto-generated memories are separate;
- auto memory is inspectable and editable;
- concise index files load at startup, while detailed topic files are read on
  demand.

References:

- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/how-claude-code-works

### Windsurf and Cursor

Windsurf and Cursor both distinguish memories from rules. Windsurf rules may be
always-on, glob-scoped, model-decision activated, or manually invoked. Cursor
uses a sidecar observation approach to propose memories from chat and requires
approval before saving generated memories. The important ideas are:

- stable instructions should be rules, not fragile inferred memories;
- automatic memories need user control;
- activation policy matters as much as storage;
- project-scoped memory avoids cross-project pollution.

References:

- https://docs.windsurf.com/zh/windsurf/cascade/memories
- https://docs.cursor.com/en/context/memories
- https://docs.cursor.com/en/guides/working-with-context

### LangGraph

LangGraph's conceptual memory model provides a clean taxonomy:

- short-term memory is thread scoped;
- long-term memory is namespace scoped;
- semantic memory stores facts;
- episodic memory stores experiences;
- procedural memory stores rules and ways of acting.

Reference:

- https://docs.langchain.com/oss/python/concepts/memory

### Zep and Graphiti

Zep's temporal graph direction is useful for future advanced recall. It models
entities, facts, relationships, episodes, time, and provenance. The important
ideas are:

- facts change over time;
- stale facts should be invalidated or superseded, not silently overwritten;
- context should be assembled from relevant facts, not from all history;
- graph/vector recall is a retrieval layer, not execution authority.

References:

- https://help.getzep.com/v2/memory
- https://help.getzep.com/v2/understanding-the-graph
- https://www.getzep.com/ai-agents/

## Memory Philosophy

Human-like long-term memory is compressed. People do not carry an exact replay
of every conversation in working memory. They retain durable patterns:

- preferences;
- habits;
- values;
- relationships;
- procedures;
- warnings;
- identities;
- recurring goals;
- stories and episodes that explain why a belief exists.

Builder should mimic that structure:

```text
Experience Log
  almost lossless evidence

Episodic Memory
  important things that happened

Semantic Memory
  stable facts and current truths

Procedural Memory
  how this Agent should work

Preference and Taste Memory
  what the user likes, dislikes, values, or avoids

Relationship Memory
  how the Agent and user collaborate

Prospective Memory
  things to watch, resume, remind, or do later

Dreaming / Consolidation
  background compression, dedupe, promotion, and cleanup
```

The system should preserve raw evidence as far as storage policy allows, but
the model should normally act from curated compressed memory. When a memory is
important, surprising, disputed, or risky, the Agent should be able to trace it
back to evidence.

## Layered Memory Model

### L0 Raw Evidence Log

Purpose:

- preserve conversation, tool, run, review, permission, and project events as
  source evidence.

Examples:

- user messages;
- assistant public messages;
- tool calls and results;
- file changes;
- check results;
- plan approvals;
- review decisions;
- permission grants;
- handoff packets;
- standing-intent events.

Storage:

- SQLite append-only event chain remains authoritative for product facts;
- redacted JSONL transcript sidecar may provide human-readable fallback and
  export;
- large raw tool outputs are stored behind bounded refs, not always injected.

Rules:

- raw evidence is never injected wholesale into long prompts;
- raw evidence can be searched or cited by refs;
- deletion/retention policy applies here first;
- raw evidence does not automatically become memory;
- untrusted evidence must carry provenance and cannot be promoted without
  gates.

### L1 Episodic Memory

Purpose:

- store compressed records of important experiences.

Examples:

- "On 2026-08-18, the user rejected generic composer readiness pills because
  they felt like internal state leakage.";
- "The Tool Evidence Row slice unified active and completed runtime tool row
  typography and passed focused frontend tests.";
- "A previous Plan-routing issue showed that '方案' should be treated like
  '计划' when the user asks for a non-mutating plan."

Storage:

- daily notes or task-local episodic files;
- SQLite index with source refs, task refs, and tags.

Injection:

- never always-on by default;
- retrieved by task, time, project, similarity, or explicit user request.

Rules:

- preserve date, project, task, and source refs;
- do not use episodic memory as current truth if contradicted by newer semantic
  memory or user correction;
- background tasks and low-trust sessions may write episodic evidence, but that
  evidence is not promotion-eligible unless provenance allows it.

### L2 Semantic Memory

Purpose:

- store stable facts, current user preferences, project principles, product
  decisions, and durable constraints.

Examples:

- "User prefers a quiet composer with no generic idle readiness label.";
- "Plan and 方案 are equivalent planning intents when no source mutation is
  requested.";
- "Builder should render complete Plan Markdown in chat, not only a summary.";
- "Project source authority is Git/SQLite, not chat text."

Storage:

- accepted memory facts in SQLite;
- optional human-readable `MEMORY.md` / `USER.md` style files for inspection;
- future graph index for relationships and temporal validity.

Injection:

- relevant accepted semantic memories may be included in context assembly;
- high-strength Agent-level memories may be always-on within a strict budget;
- project memories activate only for matching project scope.

Rules:

- every semantic memory needs source evidence;
- every semantic memory has validity and supersession metadata;
- user correction can supersede semantic memory;
- semantic memory cannot grant permission, approve a plan, or prove a run
  succeeded.

### L3 Procedural Memory

Purpose:

- store how the Agent should act.

Examples:

- "Before editing code, inspect current files and avoid reverting user changes.";
- "For frontend work, verify screenshots or focused UI tests when possible.";
- "When the user asks for a review, lead with findings."

Storage:

- human-authored rules;
- accepted auto-generated operating rules;
- skill/workflow references;
- project path-scoped rules.

Injection:

- always-on when human/system authored and concise;
- path/mode activated for specialized procedures;
- model-decision activated for less common workflows.

Rules:

- human/system rules outrank auto memory;
- procedural memory should be concise and directive;
- procedural memory should not store transient facts;
- auto-proposed procedures require review before becoming always-on.

### L4 Preference, Taste, and Value Memory

Purpose:

- store the user's durable preferences, taste, and decision principles.

Examples:

- "The user values Codex-like streaming, but wants a more companion-like
  product model.";
- "The user dislikes UI that exposes internal implementation state.";
- "The user prefers mature, restrained, ergonomic work UI over decorative
  marketing layout.";
- "The user wants long-term memory to behave like compressed human memory,
  retaining preferences, habits, and values."

Storage:

- accepted Agent-user relationship memories;
- type-tagged semantic memories;
- optional user-editable profile surface.

Injection:

- included when a design, product, or strategy decision is being made;
- omitted when irrelevant to a narrow mechanical task.

Rules:

- do not infer sensitive personal traits without explicit evidence;
- weak single-mention preferences remain candidates;
- repeated corrections upgrade strength;
- preferences can conflict by domain and must include scope.

### L5 Relationship Memory

Purpose:

- store the collaborative relationship between the user and the Agent.

Examples:

- "The user expects the Agent to question architecture assumptions and compare
  against mature products.";
- "The user often wants findings turned into docs and shared with the main
  task.";
- "The Agent should distinguish screenshot reference content from user
  instructions."

Storage:

- Agent-user scoped memories;
- not project-specific unless tied to a project.

Injection:

- included in companion session startup budget;
- included when task routing, communication tone, or delegation behavior is
  relevant.

Rules:

- relationship memory must not store secrets, credentials, or unnecessary
  personal data;
- relationship memory is editable and deletable by the user;
- relationship memory may inform communication, but cannot override explicit
  current user instructions.

### L6 Task Capsule Memory

Purpose:

- preserve the current objective, decisions, open questions, permissions, run
  evidence, and state for one durable task.

Examples:

- "Task: Streaming Activity UI Optimization";
- "Current decision: Plan results must render complete Markdown in chat.";
- "Open next slice: side workspace tabs drag reorder.";
- "Avoided files: packaged canary and runtime projection while main task owns
  them."

Storage:

- Task Capsule store;
- Session/Task Address binding;
- Working Context State;
- run snapshots and review facts.

Injection:

- current focused task capsule is high-priority context;
- sibling task summaries are included only when needed;
- background task capsules do not interleave long context into the focused
  task.

Rules:

- task memory is not global memory;
- closing a task may propose memories for promotion;
- task memory can include failed attempts and unresolved risks;
- task memory must bind to permissions and run evidence before side effects.

### L7 Project Memory

Purpose:

- store reusable project knowledge.

Examples:

- project structure;
- preferred build/test commands;
- release flow;
- architecture boundaries;
- local UI conventions;
- known fragile areas;
- path-scoped rules.

Storage:

- project memory facts;
- project instruction files;
- accepted auto memory files;
- source refs and revision refs.

Injection:

- included only for matching project/worktree;
- path-scoped project memory activates when relevant files are read or edited;
- large project memory is retrieved on demand.

Rules:

- project memory cannot override current source facts;
- project memory cannot override newer user correction;
- project memory from one project cannot silently apply to another project;
- project memory must not leak full source text to providers without context
  disclosure consent.

### L8 Prospective Memory

Purpose:

- store future-oriented intentions, watches, reminders, monitors, and standing
  work.

Examples:

- "Watch this project for loading/flicker regressions.";
- "Remind me after the main task finishes.";
- "Run a read-only check daily.";
- "Prepare a plan when a dependency changes."

Storage:

- standing-intent facts;
- watch/monitor definitions;
- schedule and trigger facts;
- notification policy;
- permission scope.

Injection:

- not injected every turn;
- activated by trigger, schedule, project event, or user request.

Rules:

- prospective memory requires explicit user permission;
- each standing intent has scope, expiration, cancellation, and notification
  policy;
- a watch can remind or prepare a proposal according to permission, but cannot
  mutate source without run-level approval;
- background work must be visible in the Agent's presence/task monitor.

### L9 Review and Dreaming Layer

Purpose:

- consolidate, dedupe, promote, archive, and supersede memory outside the hot
  reply path.

Inputs:

- raw evidence;
- episodic notes;
- task completion summaries;
- user corrections;
- repeated preferences;
- failed memory recalls;
- stale memories.

Outputs:

- proposed semantic memories;
- proposed procedural rules;
- supersession records;
- archived low-value memories;
- dreaming reports for user inspection.

Rules:

- dreaming never blocks the user's ordinary reply;
- deterministic gates decide eligibility, budget, provenance, and trust class;
- model judgment may summarize or classify only inside deterministic bounds;
- untrusted web/tool content cannot promote itself into curated memory;
- recalled memory must be marked so it is not re-extracted as a new memory;
- user can inspect, accept, reject, edit, or delete proposed memories.

## Multi-Dimensional Memory Metadata

Every durable memory should be more than text.

```ts
type AgentMemoryFact = Readonly<{
  memory_id: string;
  agent_id: string;
  owner_id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  text: string;
  source_refs: readonly MemorySourceRef[];
  provenance: MemoryProvenance;
  trust: MemoryTrustClass;
  sensitivity: MemorySensitivity;
  confidence: number;
  strength: "candidate" | "weak" | "medium" | "strong" | "core";
  stability: "temporary" | "recurring" | "durable";
  validity: MemoryValidityWindow;
  activation: MemoryActivationPolicy;
  conflicts_with: readonly string[];
  supersedes: readonly string[];
  superseded_by: string | null;
  review_state: "proposed" | "accepted" | "corrected" | "rejected" | "archived";
  created_at_ms: number;
  last_confirmed_at_ms: number | null;
  last_used_at_ms: number | null;
  usage_count: number;
  digest: string;
}>;
```

Suggested dimensions:

| Dimension | Purpose |
| --- | --- |
| Agent scope | Which companion owns the memory |
| User scope | Which user or relationship it applies to |
| Project scope | Which project/worktree it applies to |
| Task scope | Which task capsule produced or uses it |
| Memory kind | semantic, episodic, procedural, preference, relationship, prospective |
| Time | created, observed, valid from/until, last confirmed |
| Provenance | human, assistant, tool, imported handoff, web, system |
| Trust | human-authored, local agent, reviewed, untrusted, imported |
| Sensitivity | public, local, private, secret-adjacent, regulated |
| Strength | single mention vs repeated durable pattern |
| Confidence | model/system confidence with deterministic caps |
| Activation | always, project match, task match, model decision, manual, trigger |
| Status | proposed, accepted, corrected, rejected, archived |
| Supersession | what this replaces and what replaced it |
| Evidence | exact source refs and digest |

## Memory Write Path

Memory writing must be conservative. Bad memory is worse than missing memory
because it can repeatedly poison future context.

Pipeline:

```text
event appended
-> transcript / episodic capture
-> candidate extraction
-> provenance and sensitivity classification
-> eligibility gates
-> dedupe and conflict detection
-> user/owner review or auto-accept policy
-> accepted memory fact
-> index update
-> optional human-readable memory file update
```

### Hot Path Writes

Hot path writes occur during an active user turn.

Allowed:

- record raw events;
- write task capsule facts;
- write run context snapshots;
- write explicit "remember this" requests as proposed or accepted according to
  policy;
- append low-risk episodic notes.

Avoid:

- broad semantic promotion;
- rewriting core memory;
- expensive graph updates that could delay replies;
- model-generated operating rules without review.

### Background Writes

Background writes occur in dreaming/consolidation.

Allowed:

- summarize episodes;
- propose semantic memories;
- propose procedural rules;
- dedupe repeated preferences;
- supersede stale memory;
- update search indexes.

Rules:

- background writes must be bounded and cancellable;
- failures do not block the user turn;
- background jobs need visible status when they are part of a standing intent;
- memory promotion from background jobs must respect provenance gates.

## Memory Promotion Rules

Memory moves upward only when it earns promotion.

```text
raw evidence
-> episodic note
-> memory candidate
-> accepted semantic/procedural/preference memory
-> core memory if repeated, reviewed, concise, and broadly useful
```

Promotion signals:

- explicit user request: "remember this";
- repeated correction;
- repeated preference across tasks;
- accepted task completion summary;
- durable product decision;
- stable project rule;
- failed recall that the user corrected;
- high-value standing instruction.

Promotion blockers:

- untrusted web content;
- raw tool output without user/system confirmation;
- secrets or credentials;
- one-off transient detail;
- stale or rejected plan;
- speculation;
- conflicting newer correction;
- content recalled from memory itself;
- background task output without review.

## Memory Recall

Memory recall should be budgeted, source-aware, and task-centered.

Pipeline:

```text
latest user message
-> resolve Agent and focused task
-> resolve project and permissions
-> load always-on concise core memory
-> retrieve task/project/user relevant memories
-> retrieve recent task messages
-> retrieve episodic evidence only when needed
-> rank by relevance, authority, recency, strength, and conflict status
-> assemble provider-safe context
-> record Context Snapshot refs
```

Ranking factors:

- current task match;
- current project/worktree match;
- explicit user mention;
- memory kind;
- strength and review state;
- recency and last confirmation;
- source trust;
- conflict/supersession state;
- token cost;
- sensitivity and provider disclosure policy.

Recall output must include:

- memory ids;
- source refs;
- reason for inclusion;
- omitted memory refs when budget forces omission;
- digest of assembled context;
- provider disclosure status if the context leaves local process.

## Context Assembly

The model prompt should be built from memory layers in a strict order.

Default order:

1. system/developer safety and product rules;
2. Agent Definition version;
3. current permissions and workspace scope;
4. current focused Task Capsule / Working Context State;
5. approved plan or current result when relevant;
6. recent task-local messages;
7. relevant accepted core/semantic/procedural memories;
8. selected project facts and path-scoped rules;
9. relevant episodic summaries or transcript excerpts;
10. handoff/delegation summaries;
11. latest user message.

Rules:

- current user instruction outranks memory;
- current source/revision facts outrank project memory;
- accepted review facts outrank assistant claims;
- newer correction outranks older semantic memory;
- compaction summary cannot create readiness;
- memory cannot grant permission or approve side effects;
- if memory conflicts with current context, route to clarification or expose the
  conflict before building.

## Compaction and Memory Flush

Long-lived Agent conversations will compact. Compaction is expected and healthy.
The dangerous failure is compacting before durable facts are written.

Before compaction:

```text
identify unflushed decisions, corrections, preferences, open questions, and
task state
-> write them to episodic/task memory with source refs
-> record compaction source range
-> generate summary
-> mark summary as compression, not authority
```

Compaction summary must include:

- source message/event range;
- durable decisions;
- user corrections;
- unresolved questions;
- active task state;
- omitted large outputs;
- memory candidates created;
- source refs and digest.

Rules:

- compaction does not delete raw history;
- compaction cannot promote memory by itself;
- compaction cannot change Working Context State to ready;
- compaction cannot hide unresolved conflicts;
- compaction must be replayable or repairable from raw evidence.

## Conflict and Supersession

Memory needs an explicit conflict model.

Conflict examples:

- user once preferred compact UI, later asks for more readable text;
- old project command was `npm test`, new project command is `npm run verify`;
- old plan was approved, then rejected or replaced;
- imported handoff contradicts local conversation;
- memory says Plan is read-only, but current user asks to save the plan as a
  document.

Rules:

- never silently merge contradictory memories;
- newer explicit user correction usually wins within scope;
- accepted human-authored rule outranks auto memory;
- project-local memory outranks global memory for that project;
- memory with lower trust cannot supersede higher-trust memory without review;
- superseded memory remains archived with evidence for audit;
- unresolved conflict enters context as a question, not as a current fact.

Supersession record:

```ts
type MemorySupersession = Readonly<{
  supersession_id: string;
  old_memory_id: string;
  new_memory_id: string;
  reason: "user_correction" | "newer_project_fact" | "dedupe" | "scope_narrowed" | "manual_edit";
  source_refs: readonly MemorySourceRef[];
  created_at_ms: number;
}>;
```

## Trust, Security, and Poisoning Defense

Memory is a security boundary. A malicious page, document, dependency, tool
output, or imported handoff must not write durable instructions into the Agent.

Rules:

- classify source provenance at write time;
- mark recalled memory so it cannot be re-ingested as new memory;
- never promote untrusted content into core memory without review;
- never store credentials or secrets in memory;
- apply sensitivity labels before provider disclosure;
- separate human-authored instructions from model-generated memories;
- require explicit user approval for standing intents and autonomous actions;
- deny provider context egress unless disclosure consent is current;
- log which memories were used for side-effecting runs;
- fail closed on malformed memory facts, missing source refs, stale project
  scope, or cross-user/cross-agent leakage.

Sensitive memory policy:

| Sensitivity | Treatment |
| --- | --- |
| public | May be used normally if relevant |
| local | May be used locally; provider egress needs policy |
| private | Use only when necessary; disclose before provider egress |
| secret-adjacent | Do not write to ordinary memory; store only references |
| secret | Never store in memory; use secret manager refs only |
| regulated | Requires explicit policy and audit before use |

## Loophole Closure Matrix

The design is not acceptable if it leaves obvious paths for stale, untrusted, or
private information to become hidden authority. Each loophole needs an explicit
closure.

| Risk | Closure |
| --- | --- |
| Raw chat silently becomes long-term memory | Only accepted memory facts enter long-term recall; transcripts remain evidence |
| Tool output or web content injects durable instructions | Provenance labels and trust gates block untrusted promotion |
| Retrieved memory re-enters the write path and reinforces itself | Recalled memories are marked as recall inputs and cannot be re-ingested as new evidence |
| Old memory contradicts the current user | Current user instruction wins; conflict is recorded and stale memory is superseded or quarantined |
| Old project facts contradict current files | Current file state and reviewed versions win over project memory |
| A remembered preference becomes permission | Memory may suggest; permission state authorizes |
| A standing intent expands into broader autonomy | Standing intents are scoped, revocable, expiring contracts |
| Private memory leaks to a remote provider | Provider egress uses sensitivity labels, disclosure consent, and context snapshot logging |
| Cross-user, cross-agent, or cross-project leakage | Recall queries must include owner, agent, project, and task scopes |
| Vector search returns a plausible but wrong memory | Vector/graph results are pointers to authoritative memory facts, never authority themselves |
| Compaction drops important facts | Pre-compaction flush extracts decisions, corrections, preferences, and open task state before summarizing |
| User deletes a memory but derived indexes still recall it | Deletion creates a tombstone and purges/rebuilds derived indexes |
| Concurrent tasks write conflicting memories | Memory writes use revisions, source refs, conflict checks, and review state before acceptance |
| Background "dreaming" changes behavior invisibly | Dreaming outputs proposals or reviewed facts, never hidden instructions |
| Assistant claims become source truth | Assistant output can be evidence of a claim, but source truth comes from files, tools, user statements, or reviewed artifacts |
| Sensitive data is over-compressed into vague but still identifying memory | Sensitivity is evaluated before and after summarization |

## Retention, Forgetting, and Portability

Long-term memory needs a first-class forgetting model. Otherwise "memory" turns
into hidden retention.

Retention classes:

| Class | Default behavior |
| --- | --- |
| task-local | Retain while task is active; archive with the task capsule |
| project-local | Retain with the project until project archive/delete |
| agent-core | Retain until user edits, archives, or deletes |
| standing-intent | Retain until expiry, completion, pause, or cancellation |
| ephemeral | Use for the current run only; do not persist |
| sensitive-reference | Retain only a pointer to the secure source, not the value |

Forgetting behavior:

- user deletion creates a tombstone before physical cleanup;
- recall excludes tombstoned memory immediately;
- vector and graph indexes must purge deleted memory or be rebuilt;
- exported memory must include source refs and review state;
- imported memory starts as untrusted until reviewed or scope-validated;
- archived memory is searchable by explicit user action but not injected by
  default;
- deleting a project must remove or quarantine project-scoped memories;
- deleting an Agent must offer export, archive, or purge for its memory store.

## Permissions and Autonomy

Long-term Agent memory enables long-term presence, but autonomy must be scoped.

Autonomy levels:

| Level | Name | Allowed behavior |
| --- | --- | --- |
| 0 | Chat only | Respond when user messages |
| 1 | Remember | Propose or save approved memories |
| 2 | Organize | Maintain task capsules and summaries |
| 3 | Remind | Create reminders and standing watches |
| 4 | Read-only monitor | Run bounded read/search/check actions |
| 5 | Draft work | Prepare local drafts with review |
| 6 | Materialize | Save/commit/publish only with explicit gates |

Rules:

- autonomy level is per Agent and can be narrowed per project/task/run;
- standing intent cannot exceed the Agent's autonomy level;
- permissions are revocable;
- background work must show in presence/task monitor;
- side effects require run-level evidence and review gates;
- memory alone never authorizes action.

## Standing Intents and Watches

Standing intents are prospective memory. They are how an Agent becomes
"long-term online" instead of only reactive.

Examples:

- watch a repository for failed checks;
- remind user after another task completes;
- periodically summarize project progress;
- prepare a weekly report;
- follow up when a file changes;
- monitor a dependency version.

Contract:

```ts
type StandingIntent = Readonly<{
  intent_id: string;
  agent_id: string;
  owner_id: string;
  title: string;
  objective: string;
  trigger: "manual" | "schedule" | "project_event" | "task_event" | "external_event";
  scope_refs: readonly string[];
  allowed_actions: readonly string[];
  permission_refs: readonly string[];
  notification_policy: "silent" | "badge" | "notify" | "ask_before_work";
  status: "active" | "paused" | "expired" | "cancelled" | "completed";
  expires_at_ms: number | null;
  created_at_ms: number;
  last_triggered_at_ms: number | null;
}>;
```

Rules:

- every standing intent is inspectable and cancellable;
- long-running watches need expiration or renewal policy;
- triggers must be deterministic facts, not vague model desire;
- standing intent output is a proposal or task event until reviewed;
- a watch cannot silently expand its scope.

## UI Surfaces

Memory should be visible enough to trust, but not noisy.

### Agent List

Agent rows should show presence and memory/autonomy state:

```text
Builder
online · 2 running · 1 needs review

Design Partner
idle · remembers UI preferences

Research Partner
watching 3 topics
```

### Agent Home

Agent home should include:

- current focus task;
- projects;
- running work;
- watches;
- recent memories used;
- memory suggestions awaiting review;
- permissions and autonomy level.

### Memory Inspector

Users need a memory inspector with:

- search;
- filter by kind/scope/source;
- accepted/proposed/archived states;
- source evidence links;
- edit/correct/archive/delete actions;
- "why remembered" explanation;
- "where used" history.

### Context Preview

Before important Plan/Build runs, users should be able to inspect:

- which task context will be used;
- which project memories will be included;
- which user preferences are relevant;
- which handoffs or sibling task summaries are included;
- which memories were omitted due to budget;
- provider disclosure status.

### Memory Feedback

The Agent should expose lightweight controls:

- remember this;
- forget this;
- this is wrong;
- make this project-specific;
- make this global;
- do not use this for this project;
- show evidence.

## Storage Model

Recommended storage:

```text
SQLite
  authoritative memory facts, indexes, source refs, review state,
  standing intents, task bindings, context snapshots

JSONL transcripts
  read-only human-readable event fallback and import/export

Memory files
  optional inspectable curated files such as MEMORY.md, USER.md,
  project memory files, daily notes

Vector/graph indexes
  optional derived retrieval indexes, rebuildable from SQLite/files
```

Authority order:

```text
SQLite facts and source refs
-> human-authored memory/rule files when admitted
-> derived JSONL/file projections
-> vector/graph indexes
```

Vector or graph recall is never the source of truth. It can propose relevant
facts, but accepted memory facts and source refs decide what can be used.

## Data Contracts

### Memory Source Ref

```ts
type MemorySourceRef = Readonly<{
  ref_kind:
    | "conversation_message"
    | "conversation_event"
    | "task_capsule"
    | "run_snapshot"
    | "review_decision"
    | "project_revision"
    | "handoff_packet"
    | "standing_intent"
    | "user_memory_edit";
  ref_id: string;
  excerpt_digest?: string;
}>;
```

### Memory Scope

```ts
type MemoryScope = Readonly<{
  agent_id: string;
  owner_id: string;
  relationship_id?: string;
  project_id?: string;
  worktree_id?: string;
  task_address_id?: string;
  path_globs?: readonly string[];
}>;
```

### Memory Activation Policy

```ts
type MemoryActivationPolicy =
  | { kind: "always_on"; max_chars: number }
  | { kind: "project_match" }
  | { kind: "task_match" }
  | { kind: "path_glob"; globs: readonly string[] }
  | { kind: "model_decision"; description: string }
  | { kind: "manual"; handle: string }
  | { kind: "standing_intent_trigger"; trigger_ref: string };
```

### Memory Use Record

```ts
type MemoryUseRecord = Readonly<{
  use_id: string;
  memory_id: string;
  agent_id: string;
  task_address_id: string | null;
  run_id: string | null;
  purpose: "ask" | "plan" | "build" | "review" | "watch" | "notification";
  inclusion_reason: string;
  provider_disclosed: boolean;
  context_snapshot_ref: string;
  used_at_ms: number;
}>;
```

## Implementation Slices

### Slice 1: Architecture and Vocabulary

- add this document;
- align roadmap docs to "Agent Companion Memory";
- keep existing Task Capsule and Working Context State terms internal;
- do not expose memory as default composer chrome.

Exit criteria:

- docs define layer model, metadata, write path, recall path, and security
  invariants.

### Slice 2: Memory Fact Contract

- add pure main-side `agent-memory-fact.v1`;
- validate scope, source refs, trust, sensitivity, review state, activation,
  supersession, and digest;
- no provider dispatch, no tool dispatch, no source mutation.

Exit criteria:

- malformed, cross-agent, cross-project, secret-shaped, source-less, and
  accessor/proxy inputs fail closed.

### Slice 3: Episodic Capture

- record task completion summaries and selected user corrections as episodic
  memory candidates;
- bind to source refs and task address;
- write JSONL/file projection only after SQLite fact acceptance.

Exit criteria:

- task outcomes survive restart and can be searched by task/project/date.

### Slice 4: Memory Proposal and Review

- propose semantic/preference/procedural memories from task summaries and
  repeated corrections;
- add user review UI for accept/edit/reject/archive;
- accepted memory becomes eligible for context assembly.

Exit criteria:

- user can inspect source evidence before accepting memory;
- rejected memory is not used in prompts.

### Slice 5: Context Assembly Integration

- retrieve accepted relevant memories for Ask/Plan/Build;
- record memory use refs in Context Snapshot;
- enforce permission and provider disclosure gates.

Exit criteria:

- every side-effecting run can explain which memories were used;
- memory omission is recorded when budget excludes relevant candidates.

### Slice 6: Compaction Flush

- before compaction, flush unrecorded durable facts into episodic/task memory;
- record source range and memory candidates;
- keep compaction summary non-authoritative.

Exit criteria:

- long sessions can compact without losing decisions, corrections, open
  questions, or task status.

### Slice 7: Standing Intents

- add explicit standing-intent contract and inspector;
- support reminders and read-only watches first;
- connect to Agent presence/task monitor.

Exit criteria:

- Agent can stay "online" for authorized watches without gaining write
  authority.

### Slice 8: Derived Graph/Vector Index

- build optional rebuildable retrieval index from accepted memory and episodic
  facts;
- keep SQLite/source refs authoritative;
- expose recall diagnostics.

Exit criteria:

- index deletion can be rebuilt;
- graph/vector result cannot bypass memory review or permission gates.

## Acceptance Criteria

The memory architecture is ready for implementation only when:

- raw evidence and curated memory are separate;
- memory has scope, time, provenance, trust, sensitivity, validity, activation,
  and source refs;
- long-term memories can be compressed while remaining traceable;
- user corrections can supersede stale memories;
- untrusted content cannot promote itself;
- memory recall is task-centered and budgeted;
- context assembly records which memories were used;
- memory cannot grant permissions, approve plans, or prove source truth;
- standing intents are explicit, scoped, revocable, and visible;
- users can inspect, edit, archive, and delete memory;
- graph/vector recall is optional and non-authoritative;
- compaction flush prevents important facts from disappearing into summaries;
- failed memory subsystems degrade recall quality but do not block ordinary
  chat.

## Non-Goals

- No hidden uninspectable long-term memory.
- No single infinite chat log as memory.
- No automatic promotion of raw assistant text into core memory.
- No memory storage of secrets or credentials.
- No provider egress of private memory without disclosure consent.
- No autonomous action based only on memory.
- No graph/vector index as authority.
- No cross-user, cross-agent, or cross-project memory leakage.
- No default composer pill exposing internal memory state.

## Engineering Invariants

- Transcript is evidence, not memory.
- Memory is compressed understanding, not source truth.
- Current user instruction outranks memory.
- Current project revision outranks project memory.
- Review facts outrank assistant claims.
- Permission facts outrank remembered preferences.
- Standing intent is not permission.
- Compaction summary is not authority.
- Retrieved memory cannot re-write itself.
- Untrusted content cannot promote itself.
- Every memory used for a side-effecting run must be traceable through a
  Context Snapshot.

## Bottom Line

Agent companion memory should work like durable human memory: compressed,
layered, revisable, and shaped by repeated experience. It should preserve enough
evidence to recover detail, but the Agent should normally act from stable
preferences, habits, procedures, project knowledge, task state, and standing
intentions.

This is the architectural difference between a normal chat session and a
long-term Agent friend.
