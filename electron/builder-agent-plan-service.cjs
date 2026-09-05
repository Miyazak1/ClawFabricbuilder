'use strict';

const {
  createBuilderAgentPlanArtifact,
  createBuilderAgentPlanDecision,
} = require('./builder-agent-plan-contract.cjs');

const SERVICE_VERSION = 'builder-agent-plan-service.v1';
const RUN_ID = /^builder-run:([0-9a-f-]{36})$/u;

class BuilderAgentPlanServiceError extends Error {
  constructor(code = 'builder_agent_plan_service_invalid') {
    super('Builder Agent plan operation could not be completed.');
    this.name = 'BuilderAgentPlanServiceError';
    this.code = code;
    this.stack = `${this.name}: ${this.message}`;
  }
}
function fail(code) { throw new BuilderAgentPlanServiceError(code); }
function completeEvent(context) {
  if (!Array.isArray(context?.events)) fail();
  for (let index = context.events.length - 1; index >= 0; index -= 1) {
    const event = context.events[index];
    if (event?.event_type === 'run_completed' && event?.payload?.run_id === context.ids?.run_id) return event;
  }
  fail('builder_agent_plan_not_complete');
}

function createBuilderAgentPlanTaskObjective({ artifact, conversation }) {
  // The source request is context, not the implementation specification. Never
  // promote a Markdown section heading to an executable task instruction.
  const submitted = conversation?.conversation_id === artifact.source_conversation_id
    ? conversation.items?.find((item) => item.turn_id === artifact.source_turn_id
      && item.role === 'user' && item.message_kind === 'submitted')
    : null;
  const source = typeof submitted?.message?.text === 'string' ? submitted.message.text.replace(/\s+/gu, ' ').trim() : '';
  const chinese = /\p{Script=Han}/u.test(source || artifact.markdown);
  const instruction = chinese
    ? `\u5b9e\u65bd\u5df2\u6279\u51c6\u7684 Agent \u8ba1\u5212 v${artifact.version}\u3002\u5148\u8bfb\u53d6\u7ed1\u5b9a\u7684\u8ba1\u5212\u5168\u6587\uff0c\u4ee5\u5168\u6587\u4e3a\u51c6\u5b8c\u6210\u5b9e\u73b0\u548c\u9a8c\u8bc1\u3002`
    : `Implement approved Agent Plan v${artifact.version}. Read the bound full plan and use it as the specification for implementation and verification.`;
  if (source === '') return instruction;
  const label = chinese ? '\u9700\u6c42\u80cc\u666f\uff08\u8282\u9009\uff09\uff1a' : 'Request context (excerpt): ';
  const prefix = `${instruction} ${label}`;
  const available = 240 - prefix.length;
  const excerpt = source.length <= available ? source : `${source.slice(0, available - 3).trimEnd()}...`;
  return `${prefix}${excerpt}`;
}

function createBuilderAgentPlanService({ store, agent_id: agentId, owner_id: ownerId, now = Date.now }) {
  if (!store || typeof store.record_artifact !== 'function' || typeof store.record_decision !== 'function') fail();
  function recordCompletedPlan({ context }) {
    if (context?.agent?.agent_id !== agentId || context?.project?.project_id !== null) fail();
    const completed = completeEvent(context);
    if (completed.payload?.terminal_status !== 'succeeded' || completed.payload?.result_kind !== 'explanation') {
      fail('builder_agent_plan_not_complete');
    }
    const runMatch = RUN_ID.exec(context.ids?.run_id ?? '');
    if (!runMatch || completed.payload?.assistant_message === null) fail();
    const agentPlanId = `builder-agent-plan:${runMatch[1]}`;
    const existing = store.read({ agent_plan_id: agentPlanId });
    if (existing.status === 'ready') {
      return Object.freeze({ operation: 'artifact_replayed', artifact: existing.artifact });
    }
    const latest = store.read_latest({ agent_id: agentId, source_conversation_id: context.conversation.conversation_id });
    const artifact = createBuilderAgentPlanArtifact({
      agent_plan_id: agentPlanId,
      agent_id: agentId,
      source_conversation_id: context.conversation.conversation_id,
      source_turn_id: context.ids.turn_id,
      source_run_id: context.ids.run_id,
      source_message_id: completed.payload.assistant_message.message_id,
      version: latest.status === 'ready' ? latest.artifact.version + 1 : 1,
      markdown: completed.payload.assistant_message.text.trim(),
      created_at_ms: now(),
    });
    return store.record_artifact({ artifact });
  }
  function decide({ agent_plan_id: planId, content_digest: contentDigest, decision }) {
    const selected = store.read({ agent_plan_id: planId });
    if (selected.status !== 'ready' || selected.artifact.agent_id !== agentId) {
      fail('builder_agent_plan_decision_stale');
    }
    const latest = store.read_latest({
      agent_id: agentId,
      source_conversation_id: selected.artifact.source_conversation_id,
    });
    if (latest.status !== 'ready' || latest.artifact.agent_plan_id !== planId) {
      fail('builder_agent_plan_decision_stale');
    }
    return store.record_decision({ decision: createBuilderAgentPlanDecision({
      agent_plan_id: planId,
      content_digest: contentDigest,
      decision,
      decided_by: ownerId,
      decided_at_ms: now(),
    }) });
  }
  return Object.freeze({
    service_version: SERVICE_VERSION,
    record_completed_plan: recordCompletedPlan,
    decide,
    read: (request) => store.read(request),
    read_latest: (request) => store.read_latest(request),
    record_dispatch: (request) => store.record_dispatch(request),
    bind_dispatch_task: (request) => store.bind_dispatch_task(request),
    read_approved_for_task(request) {
      const selected = store.read_by_task(request);
      return selected.status === 'ready' && selected.decision?.decision === 'approved'
        ? selected
        : Object.freeze({ status: 'absent', artifact: null, decision: null });
    },
  });
}

module.exports = Object.freeze({ SERVICE_VERSION, BuilderAgentPlanServiceError, createBuilderAgentPlanService, createBuilderAgentPlanTaskObjective });
