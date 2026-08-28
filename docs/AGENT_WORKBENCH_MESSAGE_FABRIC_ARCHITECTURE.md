# Agent Workbench Message Fabric Architecture

Date: 2026-08-21

Status: target product architecture and implementation contract.

Implementation evidence:
[Agent Workbench Message Fabric v1 Implementation Gate](AGENT_WORKBENCH_MESSAGE_FABRIC_V1_IMPLEMENTATION_GATE_2026_08_21.md).

## Decision

The selected Agent surface is not a long-running Task Conversation and is not
merely another chat transcript. It is the Agent's persistent workbench:

```text
Agent friend
-> relationship home
-> conversation
-> inbox
-> coordination and task control
-> external communication
-> memory and context review
```

The product name for this surface is **Agent Workbench**. Its communication
kernel is the **Workbench Message Fabric**.

The Workbench accepts typed messages from users, Tasks, other Agents, channels,
forums, collaboration services, and future plugins. It presents those messages
as one coherent relationship stream plus focused inbox views. It may propose,
route, approve, and supervise work, but it does not execute Project work
directly.

Concrete source reads, source writes, commands, checks, previews, Git mutation,
and publication remain inside a Project-scoped Task execution plane.

## Why This Replaces An Agent Conversation Model

A conventional conversation model assumes:

- two participants;
- mostly text messages;
- one chronological transcript;
- reply as the primary action;
- one context window;
- no durable external delivery state;
- no typed action or permission lifecycle.

The Agent product needs more:

- one long-lived Agent relationship;
- many message producers and reply routes;
- task proposals and approval requests;
- Project and Task status reports;
- Agent-to-Agent communication;
- channel broadcasts and mentions;
- forum subscriptions and updates;
- shared Project and collaboration invitations;
- durable unread, acknowledgement, archive, and action state;
- plugin-defined message payloads;
- bounded context and memory extraction;
- safe routing into Project-scoped execution.

Calling this surface a conversation would make the transcript carry authority,
force every integration into chat text, and eventually create an unbounded
prompt. The Workbench instead treats chat as one message family within a typed
control-plane stream.

## Product Mental Model

The product has five distinct planes:

| Plane | User meaning | Product authority |
| --- | --- | --- |
| Relationship | The Agent friend, identity, personality, memory, presence | Agent definition and memory facts |
| Workbench | Chat, inbox, proposals, invitations, reports, coordination | Workbench message and action facts |
| Project | Durable source, collaboration, revision, and policy boundary | Project and workspace authorities |
| Task | One bounded objective and its visible conversation | Session/Task Address and conversation facts |
| Execution | Turns, runs, tools, checks, patches, checkpoints, Git | Programming runtime and main-owned action authorities |

The Workbench is the control plane. Task Conversations are the execution plane.
They share references and reviewed context, not authority.

```text
                        Agent friend
                             |
                     Agent Workbench
             +---------------+----------------+
             |               |                |
          Messages        Inbox/Actions     Memory
             |               |                |
       task proposal     invitation       reviewed facts
             |
       owner approval
             |
        Project scope
             |
       Task Conversation
             |
      DeepSeek Harness or
      another runtime adapter
```

## Terminology

### Agent Friend

A persisted Agent identity with versioned role, personality, capabilities,
memory policy, communication policy, and autonomy policy.

### Agent Workbench

The selected Agent's persistent home. It combines a relationship timeline,
inbox, coordination controls, task supervision, and context entry points.

### Workbench Message

An immutable, typed communication fact addressed to or produced by an Agent
Workbench. A message may contain text, structured content, references, and
proposed actions. A message does not itself execute an action.

### Workbench Thread

A lightweight grouping of related Workbench Messages. A thread may represent a
chat topic, invitation exchange, channel discussion, or task report chain. It is
not a Project Task and carries no execution authority.

### Workbench Action

A user-visible proposed operation associated with a message, such as approve a
task proposal, accept an invitation, open a Project, reply to another Agent, or
archive an update. An Action Broker validates and dispatches it.

### Message Source

The origin of a message: local user, local Agent, Project Task, another Agent,
channel, forum, collaboration service, or installed plugin.

### Message Connector

An adapter that receives external events or sends replies for one source. A
connector cannot write canonical Workbench records without normalization and
admission.

### Message Plugin

A versioned extension that declares message schemas, connector capabilities,
presentation descriptors, actions, context extraction policy, and retention
policy.

### Context Capsule

A bounded, provenance-preserving handoff assembled for a Task or reply. It may
include selected Workbench messages, accepted constraints, memory references,
and Project references. It is never the entire Workbench stream.

## User Experience Contract

### Starting With An Agent

The user selects an Agent friend and enters its Workbench. No Project is
required. The default composer accepts ordinary conversation immediately.

The Workbench may:

- answer or discuss directly;
- remember an explicit preference through the memory review path;
- propose a Project or Task;
- ask which existing Project should receive work;
- request approval to create or bind a Project;
- dispatch approved work to a Task Conversation;
- report progress or completion;
- receive and reply to external messages.

### Workbench Versus Task Conversation

| Workbench | Task Conversation |
| --- | --- |
| Long-lived Agent relationship | One bounded objective |
| May exist with zero Projects | Always belongs to a Project |
| Accepts many message types and sources | Primarily user, assistant, tool, and review events |
| Coordinates and delegates | Executes work |
| Broad reviewed memory access | Bounded Task and Project context |
| No direct source mutation | May mutate source after permission |
| Reports and links to Tasks | Produces detailed evidence |

### Information Architecture

Desktop layout:

```text
+----------+----------------+-------------------+--------------------------+
| App rail | Agent friends  | Projects/Tasks    | Main surface             |
|          |                | optional          |                          |
| Agents   | Builder        | Project A         | Agent Workbench          |
| Other    | Researcher     |   Task 1          | or focused Task          |
| areas    | Reviewer       |   Task 2          | Conversation             |
+----------+----------------+-------------------+--------------------------+
                                                   optional right panel
                                                   Tasks / details / context
```

Rules:

- the Agent list is the second navigation level after the global app rail;
- selecting an Agent opens its Workbench, not its latest Project;
- the Projects column is absent when the Agent has zero Projects;
- the Projects column appears when one or more Projects exist;
- the user may collapse and restore the Projects column;
- clicking a Task opens the Task Conversation;
- clicking the Agent row always returns to the Workbench;
- active and parallel Tasks may also appear in a right-side task monitor;
- Project metadata is not permanent composer chrome in the Workbench.

### Workbench Main Surface

The main surface contains:

1. A relationship header with Agent identity, presence, and a compact control
   menu.
2. A primary stream that mixes normal conversation with typed message cards.
3. Focus filters for action-required, Tasks, mentions, updates, and archived
   items.
4. A bottom composer for conversation and explicit attachments or commands.
5. Optional right-side details for one selected message, Task, invitation, or
   context capsule.

The stream must remain conversational. It must not become a dashboard made of
unrelated cards. Low-priority machine events are summarized or routed to a
focused view instead of flooding the main stream.

### Composer Contract

Default Workbench composer:

- does not require a Project;
- does not show a source folder chip by default;
- does not show Build write authority by default;
- accepts natural language, mentions, attachments, and explicit commands;
- may show a temporary context chip when replying to a message, invitation,
  Project, Task, channel, or forum thread;
- may present an explicit `Create task`, `Reply`, or `Broadcast` mode, but normal
  language remains the default;
- never turns a UI mode into permission authority.

When the user is viewing a Task Conversation, the existing Project-aware
composer contract applies instead.

### Message Presentation Families

The built-in presentation families are:

| Family | Examples | Primary interaction |
| --- | --- | --- |
| Conversation | user message, Agent reply | reply, react, quote |
| Proposal | create Project, create Task, delegate work | review, approve, reject |
| Request | permission, clarification, collaboration request | respond |
| Status | Task started, waiting, blocked, completed | open Task, cancel, inspect |
| Result | verified Task result, review outcome | review, accept, continue |
| Social | Agent message, mention, direct message | reply, mute |
| Feed | channel broadcast, forum update | open, follow, save |
| Collaboration | shared Project, invitation, review request | inspect, accept, decline |
| System | connector failure, plugin disabled, delivery failure | retry, configure |

Unknown but valid plugin content renders through a safe generic message card.
Malformed or untrusted content never reaches the normal renderer.

## Workbench Message Fabric

### Canonical Message Envelope

Every accepted message is normalized into one envelope:

```ts
type WorkbenchMessageEnvelope = Readonly<{
  envelope_version: "builder-workbench-message-envelope.v1";
  message_id: string;
  agent_id: string;
  owner_id: string;

  source: Readonly<{
    source_kind:
      | "owner"
      | "local_agent"
      | "project_task"
      | "remote_agent"
      | "channel"
      | "forum"
      | "collaboration"
      | "plugin";
    source_id: string;
    connector_id: string | null;
    actor_id: string | null;
    external_message_id: string | null;
  }>;

  address: Readonly<{
    workbench_id: string;
    thread_id: string | null;
    reply_route_id: string | null;
    project_id: string | null;
    task_address_id: string | null;
  }>;

  content: Readonly<{
    content_type: string;
    schema_ref: string;
    schema_version: number;
    payload: unknown;
    fallback_text: string;
  }>;

  delivery: Readonly<{
    attention: "normal" | "important" | "action_required";
    visibility: "main_stream" | "focused_only" | "silent";
    dedupe_key: string | null;
    source_sequence: string | null;
  }>;

  trust: Readonly<{
    provenance: "human" | "local_system" | "verified_remote" | "imported" | "untrusted";
    sensitivity: "public" | "local" | "private" | "secret_adjacent";
    prompt_admission: "excluded" | "candidate" | "review_required";
    memory_admission: "excluded" | "candidate" | "review_required";
  }>;

  attachment_refs: readonly WorkbenchAttachmentRef[];
  proposed_action_refs: readonly string[];
  created_at_ms: number;
  received_at_ms: number;
}>;
```

Envelope invariants:

- `message_id` is local, stable, and globally unique inside one owner profile;
- external identifiers never become local authority identifiers;
- `content_type` is namespaced, for example `builder.task.result.v1` or
  `forum.topic.updated.v1`;
- payloads are validated against the exact registered schema;
- fallback text is bounded plain text and cannot contain executable markup;
- attachments are references, not inline arbitrary bytes;
- proposed actions are references to separate Action records;
- trust and sensitivity are assigned during admission, not by the sender;
- message insertion does not grant permission or dispatch work.

### Core Content Types

The kernel ships with a small set of namespaced content types:

```text
builder.chat.user_message.v1
builder.chat.agent_message.v1
builder.task.proposal.v1
builder.task.status.v1
builder.task.result.v1
builder.project.proposal.v1
builder.project.shared.v1
builder.collaboration.invitation.v1
builder.agent.direct_message.v1
builder.channel.broadcast.v1
builder.forum.update.v1
builder.permission.request.v1
builder.system.notice.v1
```

The kernel does not grow a central enum for every future integration. Plugins
own additional namespaced content types and schemas.

### Immutable Content And Mutable User State

Canonical content is immutable. User interaction state is stored separately:

```ts
type WorkbenchMessageState = Readonly<{
  message_id: string;
  read_at_ms: number | null;
  acknowledged_at_ms: number | null;
  archived_at_ms: number | null;
  muted: boolean;
  saved: boolean;
  selected_reaction: string | null;
  updated_at_ms: number;
}>;
```

Editing a sent message creates a correction or supersession event. It does not
rewrite evidence in place.

### Threads

Workbench Threads provide navigation and reply continuity only. They do not
become execution Tasks.

Thread kinds:

```text
conversation
proposal_review
task_report
agent_direct_message
channel_topic
forum_topic
collaboration_invitation
system_incident
```

A Workbench Thread may link to zero or more Projects and Tasks. A Task has one
canonical Task Address and may report into one or more Workbench Threads.

### Delivery Semantics

Ingress is at-least-once. Canonical insertion is idempotent.

Required behavior:

- dedupe by connector, source, external id, and payload digest;
- preserve source order when a source supplies a monotonic sequence;
- never impose false global order across independent sources;
- record received time separately from source-created time;
- quarantine gaps, malformed sequences, and signature failures;
- allow replay from a connector cursor without duplicating messages;
- acknowledge external delivery only after local durable admission;
- preserve failed outbound replies for explicit retry.

## Plugin Architecture

### Extension Points

A Workbench Message Plugin may provide:

```text
IngressConnector       receives external events
OutboundConnector      sends replies and acknowledgements
MessageSchema          validates namespaced payloads
Normalizer             maps source events into canonical envelopes
PresentationDescriptor maps payload fields into safe UI primitives
ActionDescriptor       declares user-visible proposed operations
ActionHandler          handles an admitted action request
ContextExtractor       proposes bounded context candidates
MemoryExtractor        proposes memory candidates
RetentionPolicy        declares archive and deletion behavior
HealthProjection       reports connector/plugin state
```

These are capability boundaries, not arbitrary hooks into the application.

### Plugin Manifest

```ts
type WorkbenchMessagePluginManifest = Readonly<{
  manifest_version: "builder-workbench-message-plugin-manifest.v1";
  plugin_id: string;
  plugin_version: string;
  api_version: string;
  display_name: string;
  trust_level: "builtin" | "local_trusted" | "sandboxed_external";
  entrypoint: string;
  content_types: readonly WorkbenchContentTypeDeclaration[];
  ingress_capabilities: readonly string[];
  outbound_capabilities: readonly string[];
  action_capabilities: readonly string[];
  required_permissions: readonly string[];
  required_secrets: readonly string[];
  presentation_mode: "declarative" | "builtin_component";
  retention_policy_id: string;
}>;
```

Rules:

- manifest and implementation digests are verified before activation;
- content types are namespaced by plugin id or an approved built-in namespace;
- a plugin cannot replace another plugin's schema or action handler;
- capability registration is explicit and collision-checked;
- secret values are never included in the manifest or message payload;
- deactivation stops ingress/outbound work and releases resources;
- disposal is idempotent;
- plugin failure cannot block the Workbench kernel.

### Trust Levels

`builtin` plugins ship and are signed with Builder. They may register a reviewed
built-in component.

`local_trusted` plugins are installed and explicitly enabled by the owner. They
still use main-owned APIs and cannot bypass Action Broker or storage admission.

`sandboxed_external` plugins require an out-of-process sandbox, bounded IPC,
resource quotas, and no direct renderer or database access. They are not an
initial implementation requirement.

### Declarative Presentation

Plugins do not inject arbitrary React components into the Workbench renderer.
The default presentation contract maps validated payload fields into a bounded
set of primitives:

```text
header
body markdown or plain text
metadata rows
identity row
status badge
media/attachment references
quoted source
progress summary
action buttons
overflow menu
```

Presentation descriptors contain field paths, labels, formatting hints, and
action refs. They cannot contain script, HTML, CSS, network URLs requiring
automatic fetch, event handlers, or executable expressions.

Only reviewed built-in plugins may register code-native presentation
components. All components remain inside the product design system and error
boundary.

### Plugin Lifecycle

```text
discover
-> verify manifest and digest
-> register schemas and capabilities
-> request configuration/permissions
-> activate
-> start connector cursors
-> receive/send messages
-> suspend or degrade on failure
-> deactivate
-> dispose
```

No plugin lifecycle callback receives Project source authority, credentials,
raw memory databases, or arbitrary renderer access.

## Ingress Pipeline

```text
source event
-> connector authentication
-> size and rate admission
-> source identity resolution
-> schema selection
-> normalization
-> provenance/sensitivity classification
-> signature and replay checks
-> dedupe/order admission
-> attachment quarantine
-> canonical message append
-> user-state initialization
-> projection refresh hint
```

### Quarantine

The following never enter the normal Workbench stream directly:

- unknown schema versions;
- invalid signatures;
- oversized payloads or attachments;
- content type collisions;
- replayed messages with conflicting payloads;
- invalid Project or Task references;
- payloads containing secrets in prohibited fields;
- presentation descriptors with executable content;
- actions that request undeclared capabilities.

Quarantined input is visible only through a bounded diagnostics surface. Raw
malicious content is not rendered as Markdown or passed to a model.

### Attachments

Attachments are separate content-addressed records with:

- digest and byte size;
- media type;
- source and trust;
- local quarantine path or remote reference;
- scan status;
- retention status;
- disclosure eligibility.

Opening, downloading, indexing, sending to a provider, importing into a
Project, or executing an attachment are separate actions.

## Outbound Communication

A reply creates a local outbound intent before contacting a source:

```text
composer submit
-> resolve reply route
-> validate source identity and plugin state
-> show disclosure/identity confirmation when required
-> record outbound intent
-> connector send
-> record delivered or failed receipt
-> append local Workbench message
```

Outbound messages declare the sending identity. The Agent cannot impersonate
the owner or another Agent. Automatic replies require a standing intent with a
bounded source, audience, topic, rate, and expiry.

## Workbench Action Broker

### Separation Of Message And Action

A message may suggest an action but cannot execute it. Every actionable control
references a durable Workbench Action:

```ts
type WorkbenchAction = Readonly<{
  action_version: "builder-workbench-action.v1";
  action_id: string;
  message_id: string;
  agent_id: string;
  action_type: string;
  handler_capability: string;
  request_payload: unknown;
  state:
    | "proposed"
    | "awaiting_confirmation"
    | "admitted"
    | "running"
    | "succeeded"
    | "failed"
    | "rejected"
    | "expired";
  required_permission_refs: readonly string[];
  created_at_ms: number;
  expires_at_ms: number | null;
}>;
```

### Admission Pipeline

```text
message action selected
-> load canonical message and plugin manifest
-> verify action is still current
-> resolve owner/Agent/source identity
-> validate exact payload schema
-> evaluate capability and permission policy
-> request explicit confirmation if required
-> record admission decision
-> dispatch to one registered handler
-> record outcome and refresh message projection
```

Policies are monotonic. Plugins and messages may narrow behavior or require
more review. They cannot turn a kernel denial into an allow.

### Permission Non-Inheritance

The following never grant Project or execution permission:

- receiving a message;
- trusting a connector identity;
- accepting a social connection;
- joining a channel;
- following a forum;
- accepting a Project invitation;
- approving Task creation;
- Agent-to-Agent delegation;
- memory recall;
- a model recommendation.

Project binding, source read, source write, command, network, save, commit, and
publish remain separate authorities.

## Task Incubation And Delegation

Task incubation is the first built-in action flow on the Message Fabric. It is
not the Workbench's entire architecture.

### Lifecycle

```text
discussion in Workbench
-> model or explicit user intent identifies bounded work
-> durable task proposal message
-> Project scope unresolved | existing Project suggested
-> owner reviews objective and scope
-> owner rejects | chooses existing Project | creates/binds Project
-> main authority materializes Session/Task Address
-> Context Capsule assembled and recorded
-> focused Task Conversation opens
-> independent read/write/command permissions apply
-> Task executes through selected runtime
-> compact status/result messages return to Workbench
```

### Proposal Contract

A Task proposal contains:

- bounded objective;
- requested outcome: discuss, plan, build, review, research, or monitor;
- reason the work should become a Task;
- suggested existing Project or unresolved Project scope;
- relevant Workbench message refs;
- relevant accepted memory refs;
- expected side-effect categories;
- whether foreground or parallel execution is requested;
- expiry and supersession status.

The proposal is reviewable and durable. It creates no Project, Task, Run, or
permission until admitted.

### Project Creation

For a new local Project:

- the owner confirms the proposal;
- the owner chooses or creates the local folder through the OS dialog;
- main binds a new Project identity to that folder;
- cancellation creates no Project or Task;
- no default hidden folder is invented;
- selecting the folder does not grant write or command permission.

For an existing Project, main verifies the Project identity and current
workspace binding before materializing the Task.

### Context Capsule

The handoff includes only:

- accepted objective;
- latest relevant Workbench message refs;
- explicit constraints and decisions;
- selected accepted Agent memory refs;
- selected Project memory refs after Project binding;
- source trust and sensitivity labels;
- proposal and approval refs;
- provider disclosure status.

It excludes unrelated relationship chat, unreviewed external instructions,
credentials, hidden chain-of-thought, stale Project facts, and authority claims.

The capsule is stored as evidence and enters provider context only through the
existing context assembly and disclosure gate.

### Result Return

Task execution details stay in the Task Conversation. The Workbench receives a
compact typed result:

```text
Task completed: Fix loading flicker
Project: ClawFabric Builder
Status: verified
Changed: 3 files
Review: required
Open Task
```

The result links to the Task Address and evidence. It does not duplicate the
entire execution transcript.

## Agent-To-Agent Communication

Agent-to-Agent messages use the same fabric. They are not direct function calls
between model runtimes.

Required properties:

- sender and recipient Agent identities are explicit;
- every message has provenance and a local delivery receipt;
- cross-owner communication is external and untrusted until verified;
- an Agent may propose a Task for another Agent but cannot assign authority;
- delegation requires recipient policy and owner admission;
- replies preserve a thread and reply route;
- loops and broadcast storms are bounded by hop count, rate, and dedupe policy;
- automated replies identify themselves as Agent-authored;
- messages cannot carry credentials or permission grants.

An Agent may summarize another Agent's result into memory only through normal
memory candidate and review rules.

## Channels, Forums, Sharing, And Collaboration

### Channels

Channel plugins provide broadcasts, mentions, replies, membership events, and
moderation notices. Channel traffic is focused-view content by default; only
mentions, direct replies, and action-required items enter the main stream.

### Forums And Feeds

Forum/feed plugins provide subscribed topic updates, replies, mentions, saved
items, and digest messages. Posts remain external content. They cannot become
system instructions or durable memory without review.

### Shared Projects

A shared Project message contains metadata and a verifiable share reference.
Opening metadata is not the same as importing or binding source. Import,
checkout, local folder selection, credential use, and collaboration acceptance
are separate actions.

### Collaboration Invitations

Invitation flow:

```text
invitation received
-> identity/signature verified
-> safe metadata card displayed
-> user inspects scope and requested role
-> accept or decline
-> accepted collaboration membership recorded
-> optional Project import/bind flow
-> optional Task proposal
```

Accepting an invitation does not automatically run code, open network access,
write local files, or disclose Agent memory.

## Context And Memory

### Workbench Context Is Not One Infinite Prompt

The Workbench stores durable messages, but each Agent response uses bounded
context assembled from:

1. system/developer product and safety rules;
2. current Agent definition/version;
3. current relationship and communication policy;
4. selected Workbench thread and latest user message;
5. recent relevant conversation messages;
6. accepted Agent memories selected by policy;
7. selected Project/Task references when explicitly relevant;
8. reviewed external message excerpts;
9. pending action and invitation state.

Every context assembly records refs, reason for inclusion, omissions caused by
budget, sensitivity, and provider disclosure status.

### Message-To-Memory Path

```text
canonical message
-> episodic evidence
-> memory candidate extraction
-> provenance/sensitivity classification
-> dedupe/conflict detection
-> owner review or bounded auto-accept policy
-> accepted memory fact
```

External messages, forum posts, channel content, plugin output, Task output, and
Agent-to-Agent messages do not enter durable semantic memory automatically.

### Compaction

Compaction produces provenance-bound summaries, not rewritten truth.

- raw canonical messages remain evidence according to retention policy;
- summaries carry source refs and digest;
- newer corrections supersede older summaries;
- compaction cannot grant permission or Task readiness;
- selected summaries may become provider-context candidates only through the
  disclosure gate;
- long-term memory promotion remains a separate process.

## Storage Architecture

The Workbench uses main-owned SQLite stores. Initial logical tables are:

```text
workbench_messages
workbench_message_states
workbench_threads
workbench_thread_members
workbench_actions
workbench_action_decisions
workbench_deliveries
workbench_source_identities
workbench_plugin_registrations
workbench_connector_cursors
workbench_context_capsules
workbench_attachment_refs
workbench_quarantine_records
```

Storage rules:

- canonical message rows are append-only;
- message state uses optimistic versioning;
- action transitions are append-only decisions projected into current state;
- connector cursors advance only after durable message admission;
- payload JSON is bounded and schema-verified before storage;
- large bodies and attachments use content-addressed external storage;
- secrets use secret manager references, never message payloads;
- foreign source identifiers are namespaced by connector;
- all cross-record references are validated during reads;
- malformed rows fail closed and do not partially render the Workbench.

Because the product is still in development, the first implementation may use
a clean v1 cutover rather than compatibility projection over older Agent chat
rows. Existing data must not be silently rewritten or merged into a new
authority model.

## Read Projections

### AgentWorkbenchProjection

```ts
type AgentWorkbenchProjection = Readonly<{
  projection_version: "builder-agent-workbench-projection.v1";
  agent: AgentFriendSummary;
  stream: WorkbenchTimelineWindow;
  inbox: Readonly<{
    unread_count: number;
    action_required_count: number;
    mention_count: number;
    active_task_count: number;
  }>;
  connection_health: readonly WorkbenchConnectorHealth[];
  cursor: string;
  authority: ProjectionAuthority;
}>;
```

### WorkbenchTimelineItemProjection

```ts
type WorkbenchTimelineItemProjection = Readonly<{
  message_id: string;
  thread_id: string | null;
  presentation_family: string;
  content_type: string;
  source_label: string;
  source_avatar_ref: string | null;
  fallback_text: string;
  presentation: DeclarativeMessagePresentation;
  attention: "normal" | "important" | "action_required";
  trust_label: "local" | "verified" | "external" | "untrusted";
  state: Readonly<{
    unread: boolean;
    acknowledged: boolean;
    archived: boolean;
  }>;
  actions: readonly WorkbenchActionProjection[];
  created_at_ms: number;
}>;
```

### WorkbenchTaskMonitorProjection

This projection joins Task Address, activity, permission wait, review state,
and the latest Workbench report. It provides open, cancel, pause, and inspect
commands only through existing main authorities.

### Projection Authority

Renderer projections may:

- select an Agent;
- choose a filter;
- request another page;
- mark read/archive through bounded IPC;
- submit a message;
- request one advertised action;
- open referenced Project or Task surfaces.

They may not:

- insert canonical external messages;
- register plugins or schemas;
- grant permission;
- create a Task Address directly;
- dispatch model/tool work;
- read connector credentials;
- mutate Project source;
- decide trust or sensitivity labels.

## IPC Contract

Initial renderer-safe operations:

```text
readAgentWorkbench(agent_id, cursor?, filter?)
subscribeAgentWorkbench(agent_id)
postAgentMessage(agent_id, text, reply_to_message_id?)
markWorkbenchMessageRead(agent_id, message_id)
archiveWorkbenchMessage(agent_id, message_id)
requestWorkbenchAction(agent_id, message_id, action_id)
confirmWorkbenchAction(action_id, decision)
readWorkbenchMessageDetail(agent_id, message_id)
readWorkbenchTaskMonitor(agent_id)
```

Renderer requests contain identifiers and user input only. Main reloads the
canonical message, plugin registration, action schema, Project scope, and
current permissions before making a decision.

Change notifications carry only Agent id and a bounded cursor hint. They do not
carry full payloads or authority-bearing state.

## DeepSeek Harness Boundary

DeepSeek Harness is an execution runtime behind a Task. It is not the Workbench
message database, plugin manager, permission authority, Project authority, or
external connector host.

Integration rules:

- Task lifecycle events are normalized by the existing runtime adapter;
- a main-owned projector may emit compact Task status/result messages into the
  Workbench;
- Workbench proposals become Tasks before Harness dispatch;
- Context Capsules enter Harness provider context only through context assembly
  and disclosure gates;
- Harness tool calls still pass through Builder's Tool Action Admission;
- Harness cannot insert arbitrary plugin content or actions;
- Harness failure does not corrupt Workbench canonical messages;
- Workbench connector failure does not cancel an unrelated Harness run.

This preserves Harness's turn/step/tool lifecycle while keeping Builder's
product, authority, and communication policies main-owned.

## Loading, Recovery, And Flicker Contract

Workbench loading must preserve stable shell geometry and last trusted data.

Rules:

- render a cached trusted projection immediately when available;
- refresh by cursor without replacing the entire shell with a loading panel;
- keep Agent header, navigation widths, composer bounds, and selected filter
  stable during refresh;
- apply pages incrementally by message id;
- ignore stale responses using request epoch/cursor checks;
- persist unread/action state before acknowledging UI completion;
- recover connector cursors and pending outbound intents after restart;
- show source-specific failure without blanking unrelated messages;
- retry projections independently from connector delivery;
- no timer-driven whole-page remounts.

## Privacy, Retention, And Audit

Each message source declares retention and disclosure policy. The owner can:

- inspect source and connector provenance;
- see whether content was sent to a provider;
- archive or delete eligible local projections;
- disconnect a connector;
- revoke reply capability;
- clear connector credentials;
- export selected Workbench threads;
- review memory candidates derived from messages;
- see which messages seeded a Task Context Capsule.

Audit records include:

- connector admission and dedupe decisions;
- trust/sensitivity classification;
- action approval/rejection;
- Project/Task materialization refs;
- provider disclosure decisions;
- outbound delivery receipts;
- memory candidate and promotion refs;
- plugin activation, failure, and deactivation.

Audit records contain identifiers and bounded summaries, not secrets or raw
private payloads unless an explicit secure diagnostic policy allows it.

## Failure Isolation

| Failure | Required behavior |
| --- | --- |
| One connector offline | Other Workbench sources remain usable |
| Plugin schema invalid | Quarantine source item; do not crash stream |
| Presentation descriptor invalid | Render bounded generic fallback |
| Outbound send fails | Preserve failed intent and offer retry |
| Action handler unavailable | Keep action pending/failed; no partial authority |
| Project binding cancelled | Proposal remains reviewable; no Project or Task |
| Task materialization fails | No execution dispatch; proposal shows fixed failure |
| Harness fails | Task reports failure; Workbench remains usable |
| Memory extraction fails | Message persists; no memory candidate |
| Projection refresh fails | Keep last trusted projection and localized status |
| Corrupt canonical row | Fail closed for affected item and surface diagnostics |

## Current Implementation Evidence

Implemented foundation in the current worktree:

- persisted default Builder Agent and version;
- durable projectless Agent-scoped conversation;
- Agent Answer turns that create no Project or Task Address;
- main-owned Agent -> Project -> Task projection;
- conditional and collapsible Projects column;
- exact Session/Task Address identity for Project Task Conversations;
- semantic Ask/Plan/Build routing and workspace-required outcome;
- temporary renderer continuation after a user chooses a Project folder;
- context compaction summary store and disclosure-gated context candidates;
- DeepSeek Harness runtime adapter and canonical Task execution events;
- main-owned Project, permission, tool, checkpoint, Git, and review authorities.

Not implemented yet:

- canonical Workbench Message store and state store;
- Workbench Thread and Inbox projections;
- Message Plugin manifest/schema registry;
- ingress/outbound connector host;
- declarative presentation registry;
- Workbench Action Broker;
- durable Task proposal and approval messages;
- main-owned proposal-to-Task materialization;
- Context Capsule handoff from Workbench to Task;
- Task status/result return into Workbench;
- Agent-to-Agent message delivery;
- channel, forum, sharing, and collaboration plugins;
- right-side parallel Task monitor;
- Workbench-specific loading/recovery canary.

The current projectless Agent conversation is a useful storage foundation, but
it is not the final Workbench data model.

## Implementation Roadmap

### Slice 0: Contract And Cutover Boundary

- adopt this document as the Agent Home authority;
- reserve canonical ids and content namespaces;
- define exact message, state, thread, action, and plugin manifest contracts;
- decide clean Workbench storage path and old Agent chat preservation policy;
- add architecture boundary tests.

Exit evidence:

- contracts reject proxies, unknown keys, malformed ids, oversized content, and
  unregistered schemas;
- no contract grants Project or runtime authority.

### Slice 1: Built-In Message Fabric

- create main-owned message/thread/state stores;
- normalize existing Agent user/assistant chat into built-in message envelopes;
- build Workbench timeline/inbox projections;
- add cursor paging and change hints;
- render conversation, system notice, and generic fallback families;
- cut the selected Agent home over to Workbench projection.

Exit evidence:

- projectless chat persists and recovers after restart;
- stable shell does not flicker during refresh;
- unknown valid content uses generic fallback;
- malformed content is quarantined.

### Slice 2: Action Broker And Task Proposal

- create durable Workbench Action records;
- add explicit and semantic Task proposal creation;
- render proposal review block;
- support reject, existing Project selection, and new folder binding;
- materialize one Session/Task Address in main;
- record one Context Capsule;
- open the Task Conversation;
- preserve independent write/command/network permissions.

Exit evidence:

- cancellation creates no Project or Task;
- repeated approval is idempotent;
- restart preserves proposed/approved/materialized state;
- exact proposal and capsule refs appear on the created Task;
- no renderer-selected authority is trusted without main verification.

### Slice 3: Task Supervision And Result Return

- emit compact status/result messages from canonical Task facts;
- add right-side active/parallel Task monitor;
- open, pause, cancel, and inspect through existing authorities;
- serialize or conflict-gate overlapping mutating Tasks;
- report review and permission waits.

### Slice 4: Built-In Agent Communication

- local Agent direct messages;
- recipient inbox and delivery receipts;
- bounded delegation proposal;
- loop/rate/hop protection;
- result handoff and memory review.

### Slice 5: Connector And Feed Plugins

- built-in channel and forum test plugins;
- connector cursor and outbound intent stores;
- source identity and trust mapping;
- mentions, broadcasts, topic updates, and reply routes;
- attachment quarantine.

### Slice 6: Sharing And Collaboration

- shared Project metadata messages;
- collaboration invitation workflow;
- import/bind and role review;
- collaboration notification and review request types;
- no automatic Project source or credential disclosure.

### Slice 7: Trusted Plugin SDK

- signed local trusted plugin packaging;
- schema and capability registration APIs;
- declarative presentation authoring tools;
- connector health and diagnostics;
- install/enable/disable/uninstall lifecycle;
- compatibility and API version policy.

### Slice 8: Standing Intents And Long-Running Work

- bounded watches and subscriptions;
- governed automatic replies;
- policy-approved automatic Task proposals;
- explicit budget, schedule, source, audience, and expiry;
- visible activity, pause, revoke, and audit controls.

## Acceptance Matrix

| Scenario | Required result |
| --- | --- |
| Zero Projects | Agent Workbench chat is immediately usable |
| Existing Projects | Workbench remains reachable by clicking Agent |
| Build intent without Project | Durable proposal, not silent failure or hidden execution |
| New Project approval | OS folder selection before Project bind |
| Task creation | Main creates exact Task Address and Context Capsule |
| Task write | Separate write approval still required |
| Task completes | Compact result message links to Task evidence |
| Duplicate connector event | One canonical message |
| Unknown plugin type | Safe generic rendering |
| Malicious forum post | No prompt, memory, action, or permission injection |
| Plugin crash | Workbench and other plugins remain usable |
| Restart | Messages, unread state, proposals, actions, and cursors recover |
| Refresh | No sidebar/header/composer remount or geometry flash |
| Agent-to-Agent task request | Visible proposal; no inherited authority |
| Collaboration invitation | Inspect/accept/decline without source mutation |
| Provider disclosure | Selected refs and consent are recorded |
| Message deletion | Retention and external-source limits are explicit |

## Architectural Invariants

- Agent is the relationship and long-term identity.
- Workbench is the communication and coordination control plane.
- Project is the source, collaboration, and permission boundary.
- Task is the bounded objective and execution conversation.
- Run is one execution attempt.
- Chat is one Workbench message family, not the Workbench data model.
- A message can propose an action but cannot execute it.
- A plugin can extend message types but cannot extend authority implicitly.
- External content is untrusted data, never system instruction.
- Memory personalizes and recalls but never authorizes.
- Context Capsule preserves provenance and excludes unrelated history.
- Renderer projection is never canonical authority.
- Harness executes Tasks but does not own Workbench product policy.
- Canonical content and mutable user state are stored separately.
- Connector delivery is idempotent and restart-safe.
- Unknown valid content degrades safely; malformed content fails closed.
- One failing source never blanks the entire Workbench.

## Non-Goals

The first Workbench implementation does not require:

- arbitrary third-party React components;
- in-process untrusted plugins;
- end-to-end encrypted federation between independent Builder installations;
- automatic trust of remote Agent identities;
- one infinite model context containing the full Workbench;
- hidden Project creation;
- automatic acceptance of collaboration invitations;
- permission transfer through messages or memory;
- replacing DeepSeek Harness execution semantics;
- converting every runtime event into a visible message;
- a social-network feed as the primary product experience.

## Relationship To Existing Documents

This document is the authority for the selected Agent's Workbench, message
fabric, plugin communication, and action routing.

- [Agent Companion Product Architecture Index](AGENT_COMPANION_PRODUCT_ARCHITECTURE_INDEX.md)
  remains the document map.
- [Agent-First Projection and Data Contract](AGENT_FIRST_PROJECTION_AND_DATA_CONTRACT.md)
  defines existing Agent/Project/Task projections; its `AgentHomeProjection`
  should evolve into the Workbench projections defined here.
- [Agent Home Control Plane and Task Delegation Architecture](AGENT_HOME_CONTROL_PLANE_AND_TASK_DELEGATION_ARCHITECTURE.md)
  becomes the detailed built-in Task proposal flow under this architecture.
- [Task Conversation Management Architecture](TASK_CONVERSATION_MANAGEMENT_ARCHITECTURE.md)
  remains authoritative after a Task Address is materialized.
- [Agent Companion Memory Architecture](AGENT_COMPANION_MEMORY_ARCHITECTURE.md)
  remains authoritative for memory promotion, recall, compaction, and poisoning
  defense.
- [Agent Companion Settings and Context Architecture](AGENT_COMPANION_SETTINGS_AND_CONTEXT_ARCHITECTURE.md)
  remains authoritative for identity, autonomy, communication, and privacy
  settings.
- [Foundational Coding Loop And Plugin Runtime Roadmap](FOUNDATIONAL_CODING_LOOP_PLUGIN_RUNTIME_ROADMAP.md)
  remains authoritative for execution/runtime/tool plugins. Workbench Message
  Plugins are a separate communication-plane category that uses the same trust
  philosophy.
- [DeepSeek Harness Adoption Audit](DEEPSEEK_HARNESS_ADOPTION_AUDIT.md)
  remains authoritative for Harness execution integration.

## Bottom Line

The Agent surface is not one endless chat and not a Project shell. It is a
persistent personal workbench built on a typed, plugin-extensible Message
Fabric:

```text
many trusted and untrusted message sources
-> one admitted Workbench stream and inbox
-> explicit user-visible actions
-> Project- and Task-scoped execution
-> compact results returned to the Agent relationship
```

This lets Builder grow from a coding chat into a long-lived Agent companion
without weakening Project boundaries, permission gates, durable evidence, or
DeepSeek Harness runtime discipline.
