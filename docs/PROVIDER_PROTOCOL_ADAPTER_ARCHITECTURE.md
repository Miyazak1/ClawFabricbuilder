# Provider Protocol Adapter Architecture

## Purpose

Builder must support multiple model providers without letting provider-specific
HTTP shapes become product authority. The product authority remains local:
Project, Session, Task, Turn, Run, Review, Revision, Artifact, Permission,
Working Context, and Draft Checkpoint facts owned by Electron main and SQLite/Git.

Provider protocols are transport adapters. They may produce model output, token
usage, streaming deltas, tool-call proposals, or provider errors, but they do
not decide permission, source authority, Review, Save, Revision selection,
handoff, or memory readiness.

## Current Decision

The near-term release path stays on the existing OpenAI-compatible Chat
Completions shape. This matches the current transport and host adapter:

```text
messages -> /chat/completions -> choices / stream deltas -> normalized output
```

Responses-style APIs, Anthropic Messages, and other protocol families should be
added as independent protocol adapters after the current provider canary and
save/restart loop are stable. They must not be mixed into the current chat
transport with conditionals that blur protocol semantics.

The practical rule is:

```text
ship current chat path -> name and normalize it -> shadow-test Responses ->
promote only after package and real-provider canaries prove the full Builder loop
```

Codex and other mature coding agents can move faster at the protocol layer
because their current provider/runtime contracts are already built around that
shape. Builder should not copy that endpoint choice before its own Chat
Completions release loop, Review, Save, restart recovery, and provider canary
are stable under release canaries.

## Non-Goals

- no near-term provider main-path rewrite;
- no automatic migration from Chat Completions to Responses;
- no renderer-owned provider envelope construction;
- no provider-managed conversation state as Builder authority;
- no silent Working Context egress to any provider;
- no direct provider tool call to local file write, shell, Git, Save, publish,
  or preview authority;
- no claim that all OpenAI-compatible, Responses-compatible, or Claude-like
  providers support the same tool, reasoning, cache, stream, or hosted-state
  behavior.

## External Protocol Facts

Builder should treat these as adapter inputs, not product commitments:

| Protocol family | Stable observation | Builder implication |
| --- | --- | --- |
| OpenAI-compatible Chat Completions | Request shape is message-list oriented and commonly returns `choices`; streaming is usually text/tool delta oriented. DeepSeek documents `/chat/completions` as stateless, so callers provide conversation history each request. | Good current default. Builder owns history assembly, compaction, task state, and permission gates. |
| DeepSeek Context Caching | Cache behavior is provider-side optimization for repeated prefixes and exposes cache hit/miss usage fields. | Use as usage/cost evidence only. It never decides Working Context readiness, permission, plan approval, or durable memory. |
| OpenAI Responses-style APIs | Response objects and streaming events can express richer output items, tool calls, previous response references, prompt refs, and cache hints. | Add as a separate adapter with explicit capability gates. Hosted response state can optimize provider interaction but cannot replace Builder Session/Task/Run facts. |
| Anthropic Messages | Messages use content blocks, SSE event names, tool-use blocks, thinking/text deltas, and provider-specific stop/error semantics. | Add as a separate adapter and normalizer. Do not force it through an OpenAI-compatible request/response model. |
| Codex, Claude Code, DotCraft, Pi, OpenCode style agents | Mature products separate internal run semantics from provider-specific transports. | Builder should normalize provider output into local Run/Review/Tool/Artifact facts before it affects work. |

### DeepSeek API Interpretation

DeepSeek currently exposes more than one useful surface, and Builder should not
treat them as interchangeable:

| DeepSeek surface | What it is for | Builder posture |
| --- | --- | --- |
| `/chat/completions` | The existing OpenAI-compatible message-list API. It supports ordinary chat generation, streaming chunks, JSON output, function/tool-call style output, reasoning/thinking controls, and provider-side cache usage reporting. | Keep this as the near-term default. Builder sends assembled messages and owns all durable state. |
| `/responses` | A Responses-style API intended to fit newer agent/Codex-like event flows. Its event and parameter semantics are not identical to every OpenAI Responses feature, and model/tool support may differ by provider release. | Add only through `openai_responses.v1` with a capability manifest and shadow canary. Do not retrofit it into the chat adapter. |
| Anthropic-compatible base URL | DeepSeek documents Anthropic-format access for compatible clients. This is an API shape, not Claude itself. | Treat as `anthropic_messages.v1` only after a separate adapter exists. |
| FIM `/completions` | Fill-in-the-middle code completion. | Not part of the current agent build loop. Consider later for editor-style inline completion, not project generation. |

This means DeepSeek Responses does not remove the need for Builder's own
Conversation, Working Context, compaction, handoff, Permission, Review, Git, or
SQLite state. Even when a provider offers hosted response state or cache hints,
those are transport optimizations and diagnostics, not product authority.

### Competitor Protocol Pattern

The mature pattern across current coding-agent tools is a provider abstraction
with explicit protocol and model capability metadata:

| Product / project | Provider handling pattern | Builder decision |
| --- | --- | --- |
| Codex | Current open-source Codex provider metadata is Responses-centered; provider config records the wire protocol and rejects the old chat wire path in current source. | Useful long-term signal: Responses is the right shape for agentic event streams. Not a reason to rewrite Builder's near-term release path. |
| Claude / Claude Code | Claude's public Messages API is native and stateless: callers send prior turns in `messages`; system prompt is top-level; tool/thinking events use Anthropic-specific content blocks and SSE semantics. | Use a native Anthropic Messages adapter. Do not squeeze Claude through OpenAI Chat Completions. |
| DotCraft | Configuration makes `Protocol` explicit: `anthropic`, `openai-chat-completions`, or `openai-responses`; model capability catalog and provider preferences sit above protocol details. | Copy the shape, not the implementation: explicit protocol field plus capability manifest. |
| Pi | Provider/model config has an `api` type such as `anthropic-messages`, `openai-completions`, `openai-responses`, or `google-generative-ai`; custom providers normalize streams into an internal assistant-message event vocabulary and use compaction on context overflow. | Strong reference for a Runtime Event Normalizer and capability/compat flags. |
| OpenCode | Uses provider packages and model capability metadata. For custom providers, OpenAI-compatible chat and OpenAI Responses use different runtime packages. | Confirms that chat-compatible and responses-compatible are separate adapters, even when both are "OpenAI-like". |

## Layer Model

Provider support must be split into four layers:

```text
Provider Registry / Capability Manifest
-> Protocol Adapter
-> Runtime Event Normalizer
-> Context / Permission / Tool Gates
```

### 1. Provider Registry / Capability Manifest

The registry describes what a configured provider can do. It is not a project,
agent, or task identity.

Minimum manifest fields:

```text
provider_config_digest
display_name
protocol_family
base_url_policy
model_id
streaming
json_output
tool_calling
reasoning_output
prompt_cache_reporting
hosted_conversation_state
max_input_tokens
max_output_tokens
timeout_ms
retry_policy
known_limitations
```

Recommended protocol identifiers:

```text
openai_chat_completions.v1
openai_responses.v1
anthropic_messages.v1
deepseek_chat_completions.v1 preset over openai_chat_completions.v1
deepseek_responses.v1 preset over openai_responses.v1
```

The `deepseek_*` names are presets/capability profiles, not separate product
authorities. They let Builder model provider-specific quirks such as thinking
fields, model availability, cache reporting, stream endings, unsupported
parameters, and tool support while reusing the protocol adapter where the wire
shape is compatible.

Rules:

- the manifest is derived from main-owned provider settings and verified
  presets or explicit user configuration;
- credentials remain in the main-only safeStorage secret store;
- renderer receives only redacted setup/status projection;
- unsupported capability requests fail closed before dispatch;
- provider switches invalidate prompt-egress consent tied to the previous
  provider digest.

### 2. Protocol Adapter

A protocol adapter converts a main-owned prompt descriptor into a concrete
provider request and parses the provider's response envelope.

Required adapter contracts:

- exact input and output shapes;
- fixed protocol family, for example `openai_chat_completions.v1`,
  `openai_responses.v1`, or `anthropic_messages.v1`;
- redacted error surface;
- bounded timeout and retry policy;
- streaming and non-streaming behavior tested separately;
- no renderer-supplied provider URL, credential, model override, tool schema, or
  prompt body;
- no Git, SQLite product mutation, source mutation, IPC/preload registration,
  shell execution, publish, or Save authority.

Current default:

```text
openai_chat_completions.v1
```

Future adapters:

```text
openai_responses.v1
anthropic_messages.v1
```

Each future adapter must enter behind a disabled-by-default or canary-only
capability gate until it passes package and real-provider evidence.

### 3. Runtime Event Normalizer

Provider events must be normalized before they reach Builder facts or UI.

Suggested normalized event vocabulary:

```text
provider_request_started
provider_text_delta
provider_reasoning_summary_delta
provider_tool_call_proposed
provider_usage_reported
provider_response_completed
provider_response_failed
provider_response_interrupted
```

Rules:

- Task Stream may project user-safe progress and final summaries only;
- raw provider envelopes, prompts, credentials, request bodies, and hidden
  context remain main-only and redacted from renderer replay;
- token usage may be recorded as bounded evidence, including cache hit/miss
  fields when the adapter supports them;
- unknown provider stream events are recorded as adapter diagnostics and do not
  become product actions;
- provider tool-call proposals are not tool execution. They must enter Builder's
  tool-call, permission, policy, and Review pipeline before anything local
  happens.

### 4. Context / Permission / Tool Gates

Adapters can dispatch only after all required gates have admitted the request:

- provider settings and secret status;
- project/workspace boundary;
- intent route decision;
- Working Context State freshness;
- provider-context egress consent and prompt-bridge admission when assembled
  Working Context is used;
- source-read admission for private source context;
- current project write approval for mutating work;
- tool policy and dispatch admission for any proposed tool;
- run lifecycle and active-run queue/steer/cancel state.

No provider feature may bypass these gates. A provider's hosted conversation
state, response id, cache key, prompt template id, or tool-call id is evidence
inside that adapter only; it is not a Builder Session, Task, Run, Permission, or
Revision authority.

## Prompt Context Boundary

Working Context State stays local until the prompt-bridge maturity gate is
complete. A provider protocol adapter may consume approved Working Context only
through an explicit main-only prompt descriptor that binds:

```text
Project
Conversation / Session
Run Context Snapshot
context_digest
provider_config_digest
purpose
freshness window
revocation state
```

The adapter must fail closed when the prompt descriptor is missing, stale,
wrong-project, wrong-conversation, wrong-provider, expired, revoked, or produced
from a different context digest.

## Provider Tools Boundary

Provider-native tool semantics differ by protocol. Builder should normalize
them as proposed tool calls, not actions.

Examples:

- a Chat Completions `tool_calls` delta proposes a tool call;
- a Responses output item can propose a tool call or hosted tool use;
- an Anthropic `tool_use` content block proposes a tool call.

All three must enter the same Builder-owned gate:

```text
provider_tool_call_proposed
-> Builder tool-call record
-> permission/policy/session gate
-> adapter selection
-> runtime invocation
-> bounded result record
-> Review / Artifact / Revision path if applicable
```

Direct local `apply_patch`, shell, filesystem write, network, browser, preview,
publish, or Save from a provider event is forbidden.

## Release Sequence

### P0 - Stabilize Current Chat Completions Path

- keep current packaged provider canary on the existing default protocol;
- preserve settings, credential, generation, Plan, Review, Save, restart, and
  Git/SQLite evidence;
- do not add Responses or Claude adapters to the default release path.

### P1 - Add Provider Capability Manifest Contract

- pure main-side contract;
- no network, no IPC/preload, no provider dispatch, no credential readback;
- tests for unsupported capabilities, provider digest drift, and redaction.

Current checkpoint:

- `builder-provider-capability-manifest.v1` derives a redacted manifest from an
  already-verified Builder provider config and the explicit
  `openai_chat_completions.v1` protocol family.
- The manifest records the current adapter's bounded capabilities:
  streaming and JSON output are available; tool calling, reasoning output,
  prompt-cache reporting, and hosted conversation state are not admitted.
- `builder-provider-capability-admission.v1` verifies requested capabilities
  against that manifest and the expected provider config digest. Unsupported
  capability requests, provider switch/digest drift, duplicate capability
  claims, and stale assessment fail closed.
- This checkpoint performs no network request, IPC/preload registration,
  provider dispatch, credential readback, prompt bridge, source/Git/SQLite
  mutation, permission grant, Review, Save, or Revision selection.

### P2 - Name the Current Adapter

- mark current transport as `openai_chat_completions.v1`;
- add fixtures for non-streaming, streaming, error, tool proposal, and usage
  normalization;
- keep behavior-compatible with the current release canary.

Current checkpoint:

- `builder-provider-protocol-adapter-descriptor.v1` names the current adapter
  as `builder-provider-protocol-adapter:openai-chat-completions-v1`, binds it
  to `openai_chat_completions.v1`, and records the current
  `builder-openai-compatible-transport.v1` transport version.
- The descriptor requires a verified capability manifest and capability
  admission for the same provider config digest before it can describe the
  adapter. Manifest/admission drift, provider switch, unsupported adapter
  family, stale assessment, forged response/stream/tool shapes, and attempted
  executable tool claims fail closed.
- The descriptor records current request/response/stream shapes
  (`messages_json_object`, `choices_message_content`, and optional
  `sse_choices_delta`) while keeping provider tool calls blocked and usage
  metrics not normalized at this checkpoint.
- This checkpoint performs no network request, provider dispatch,
  credential readback, IPC/preload registration, prompt bridge, source/Git/
  SQLite mutation, permission grant, Review, Save, or Revision selection.

### P3 - Add Runtime Event Normalizer

- normalize Chat Completions events before UI/task projection;
- prove unknown event and malformed chunk handling;
- keep raw provider body out of renderer replay.

### P4 - Add Responses Adapter Shadow Canary

- disabled by default;
- no tool execution;
- no hosted provider state as Builder authority;
- compare output quality, stream stability, usage, and failure semantics against
  the Chat Completions path.
- first targets: OpenAI Responses-compatible fixture, then DeepSeek Responses
  canary if credentials/model support are explicitly available.

### P5 - Add Anthropic Messages Adapter Shadow Canary

- independent protocol adapter;
- content-block and SSE event normalization;
- tool-use blocks remain proposed calls only.

### P6 - Tool / Patch / Live Preview Integration

- only after Builder's permission, tool-call, runtime, patch, review, and
  preview gates are already mature;
- provider-native tools remain proposals until admitted by Builder.

## Test Matrix

Every protocol adapter must prove:

- exact request construction from main-owned descriptors;
- credential never appears in renderer, argv, env, logs, package source, or
  errors;
- malformed provider responses fail closed;
- streaming partial chunks cannot create local actions;
- unsupported capability requests fail before network dispatch;
- provider switch invalidates context-egress consent;
- prompt-bridge descriptor mismatch fails closed;
- retry/cancel/interruption does not duplicate side effects;
- package canary covers the default adapter before release;
- real-provider canary covers any adapter promoted out of shadow mode.

## User-Facing Language

Ordinary UI should avoid protocol terms. Prefer:

```text
AI provider
Model
Connection
AI can use current context
AI needs permission to use project context
AI is preparing a plan
AI ran into a provider connection problem
```

Do not expose protocol names, response ids, adapter ids, cache keys, prompt
digests, or provider envelopes unless an advanced diagnostics surface is
explicitly opened.

## References

- [DeepSeek Chat Completions](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion)
  and [DeepSeek Responses](https://api-docs.deepseek.com/zh-cn/api/create-response)
  are separate API surfaces.
- [DeepSeek model/API guide](https://api-docs.deepseek.com/zh-cn/guides/reasoning_model)
  documents OpenAI-format and Anthropic-format base URLs plus thinking controls.
- [OpenAI Codex provider source](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs)
  shows provider metadata and current Responses wire preference.
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)
  documents response objects, streaming events, previous response references,
  and provider-managed response state.
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
  documents `/v1/messages` and stateless multi-turn requests.
- [DotCraft configuration](https://www.dotcraft.net/developing/configuration)
  documents explicit provider `Protocol` values.
- [Pi providers](https://pi.dev/docs/latest/providers) and
  [Pi custom providers](https://pi.dev/docs/latest/custom-provider) document
  multi-protocol provider configuration and stream normalization.
- [OpenCode providers](https://dev.opencode.ai/docs/providers) document separate
  provider packages for OpenAI-compatible chat and Responses-style models.
