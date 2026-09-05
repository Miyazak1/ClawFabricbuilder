# Agent Plugin Composable Capabilities Direction

Date: 2026-08-28

Status: product direction addendum for Agent settings, plugin-composed
capabilities, and Builder implementation alignment.

## Decision

The product direction is supported and should be made explicit:

```text
Agent friend
-> versioned identity, role, style, memory, permissions, autonomy
-> user-selected capability packs and plugins
-> projects and task conversations
-> audited execution through existing Builder authorities
```

An Agent should not be modeled as a single prompt or as a renamed Project. The
Agent is the user's durable collaborator. Plugins and capability packs describe
what that collaborator is good at and which tools it may request. Project and
Task execution still remain behind the existing Builder permission, source, and
runtime boundaries.

## Product Model

When creating or editing an Agent, the user should be able to choose:

- identity: name, avatar, role, short description;
- personality and work style;
- capability packs, such as coding, research, office documents, images, audio,
  animation, release operations, monitoring, or review;
- plugin connections that provide concrete tools or message types;
- model/provider preferences when relevant;
- memory scope and project bindings;
- autonomy level and notification behavior;
- permission boundaries and review requirements.

The first product version can ship this as an Agent Settings skeleton with a
small built-in catalog of capability groups. Full plugin marketplace behavior
can remain a later phase.

## Current Support

The existing architecture already supports this direction in pieces:

- Agent definition/version/lifecycle storage exists in
  `electron/builder-agent-definition-store.cjs`.
- The default Builder Agent is bootstrapped by
  `electron/builder-default-agent-bootstrap.cjs`.
- Agent-first navigation projection exists through
  `src/features/builder/domain/builderAgentProjectTreeProjection.ts`,
  `BuilderAgentRoster`, and `BuilderAgentSidebar`.
- Agent Workbench messages are durable typed envelopes in
  `electron/builder-workbench-message-contract.cjs` and
  `electron/builder-workbench-message-store.cjs`.
- Workbench projection already separates conversation, proposal, status, result,
  system, and generic message families.
- Workbench task incubation already supports projectless discussion becoming a
  reviewed Task proposal before Project binding or execution.
- Workbench capability policy already includes plugin-message and plugin-action
  boundaries while preventing direct provider dispatch, source reads/writes,
  permission grants, command execution, and Git mutation from the Workbench
  control plane.
- Session/Task Address records already bind Tasks to `agent_id`, `project_id`,
  and `conversation_id`.
- The broader Agent backend already includes assignment, supervision lease,
  budget audit, delegation, step progress, private source context, and result
  review facts.

This means the next work is not a rewrite. It is a schema, policy, and settings
layer on top of existing main-owned facts.

## Gaps

The current implementation does not yet provide the full user-facing capability
composition feature:

- no multi-Agent roster management beyond the default Builder Agent;
- no Add/Edit Agent settings UI;
- no persisted `avatar_ref`, structured `role`, style contract, memory policy,
  autonomy policy, or context policy in the Agent definition version;
- no `capability_pack` or `agent_plugin_binding` store;
- no per-Agent plugin selection and permission summary;
- no capability resolver that turns selected packs/plugins into allowed modes,
  tools, message types, and required permissions;
- no conflict handling for incompatible plugins or overlapping tool authority;
- no non-coding runtime adapters for office documents, image, audio, animation,
  or other specialized Agents;
- no durable memory store and inspector yet.

## Recommended Implementation Slices

### Slice 1: Agent Capability Contract

Add a main-owned contract for capability packs and Agent plugin bindings.

Suggested records:

```ts
type BuilderAgentCapabilityPack = Readonly<{
  pack_id: string;
  display_name: string;
  description: string;
  capability_groups: readonly string[];
  allowed_modes: readonly ("ask" | "plan" | "build" | "review" | "research" | "monitor")[];
  required_permissions: readonly string[];
  runtime_adapter_refs: readonly string[];
}>;

type BuilderAgentPluginBinding = Readonly<{
  binding_id: string;
  agent_id: string;
  agent_version_id: string;
  plugin_id: string;
  plugin_version: string;
  enabled: boolean;
  granted_permission_refs: readonly string[];
  created_at_ms: number;
}>;
```

Acceptance:

- bindings are versioned with the Agent;
- plugin selection cannot grant file, command, network, provider, or memory
  authority by itself;
- disabled or missing plugins degrade to visible configuration status, not
  silent execution.

### Slice 2: Agent Settings Skeleton

Expose Add/Edit Agent with identity, role, style, capability groups, plugin
selection, project bindings, memory defaults, and autonomy level.

Acceptance:

- adding an Agent creates definition, version, lifecycle, and capability-binding
  records;
- editing behavior-affecting settings creates a new Agent version;
- old Tasks remain bound to the Agent version that created or last materially
  changed them;
- personality/style cannot grant tools or permissions.

### Slice 3: Capability Resolver And Policy Projection

Create a resolver that composes Agent definition, selected packs, plugin
manifests, project scope, memory policy, and autonomy policy into a bounded
runtime capability projection.

Acceptance:

- the renderer sees only declarative capability summaries;
- execution services receive a reviewed capability projection, not raw plugin
  state;
- a Task cannot request a tool outside the Agent's selected capabilities and the
  current Project/Task permissions;
- Workbench remains a control plane and does not execute Project work directly.

### Slice 4: Built-In Agent Templates

Ship a small set of built-in templates backed by capability packs:

- Builder: coding, planning, review, checks;
- Office: documents, spreadsheets, presentations, email/calendar connectors when
  available;
- Researcher: web/source synthesis and citations;
- Media: images, audio, animation, asset preparation;
- Operator: reminders, monitoring, task organization;
- Blank: user-defined capabilities.

Templates provide defaults only. They do not carry hidden authority.

### Slice 5: Memory And Autonomy

Add memory fact store, review UI, context inspector, standing intents, and
revocable background work only after Agent settings and capability policy are
stable.

## Safety Rules

- Capabilities are not permissions. A capability says the Agent knows how to do
  something; permission says it may do it now in the current scope.
- Plugins cannot inject arbitrary React, bypass the Action Broker, write
  SQLite directly, or become provider/source/Git authority.
- Workbench messages may propose actions but must not execute them.
- Memory cannot grant tool access or trigger background work by itself.
- Agent settings must show permission impact before creation or update.
- Project folders remain the source and write boundary.

## Bottom Line

The current Builder codebase already has the hard parts needed for this
direction: Agent identity, Workbench message fabric, Task addresses, task
incubation, supervision, permissions, and main-owned policy. The missing product
layer is explicit Agent settings plus plugin-composed capability binding.

The recommended next step is to implement capability-pack and plugin-binding
contracts first, then expose them through Add/Edit Agent settings.
