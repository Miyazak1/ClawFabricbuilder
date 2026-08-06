'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderContextAssemblerError,
  createBuilderContextAssembly,
  sanitizeBuilderContextAssembly,
} = require('../electron/builder-context-assembler.cjs');
const {
  createBuilderWorkingContextState,
} = require('../electron/builder-working-context-state.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = 'builder-conversation:11111111-1111-4111-8111-111111111111';
const SESSION_ID = 'builder-session:22222222-2222-4222-8222-222222222222';
const TASK_ADDRESS_ID = 'builder-task-address:33333333-3333-4333-8333-333333333333';
const APPROVED_PLAN_REF = Object.freeze({
  plan_result_digest: `sha256:${'a'.repeat(64)}`,
  conversation_head_digest: `sha256:${'b'.repeat(64)}`,
  approved_at_ms: 9,
});
const CURRENT_RESULT_REF = Object.freeze({
  result_kind: 'draft',
  result_digest: `sha256:${'c'.repeat(64)}`,
  recorded_at_ms: 10,
});
const COMPACTION_REF = Object.freeze({
  summary_digest: `sha256:${'d'.repeat(64)}`,
  source_range_digest: `sha256:${'e'.repeat(64)}`,
  compacted_at_ms: 8,
});
const HANDOFF_REF = Object.freeze({
  packet_digest: `sha256:${'f'.repeat(64)}`,
  inserted_at_ms: 6,
  adopted_at_ms: 7,
});

function workingContextState(overrides = {}) {
  return createBuilderWorkingContextState({
    project_id: PROJECT_ID,
    session_id: SESSION_ID,
    task_address_id: TASK_ADDRESS_ID,
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build a calm portfolio homepage with project cards.',
    confirmed_constraints: ['Use the current local project folder.'],
    rejected_constraints: ['Do not publish anything.'],
    open_questions: [],
    latest_user_intent: 'Apply the approved plan.',
    source_refs: [{
      source_kind: 'user_message',
      source_digest: `sha256:${'1'.repeat(64)}`,
    }],
    compaction_refs: [COMPACTION_REF],
    handoff_refs: [HANDOFF_REF],
    latest_task_capsule: null,
    approved_plan_ref: APPROVED_PLAN_REF,
    base_revision_ref: null,
    invalidated_by: null,
    updated_at_ms: 10,
    ...overrides,
  });
}

function request(overrides = {}) {
  return {
    assembly_purpose: 'contextual_build',
    project_id: PROJECT_ID,
    latest_user_message: '按批准的方案做。',
    working_context_state: workingContextState(),
    approved_plan_ref: APPROVED_PLAN_REF,
    current_result_ref: CURRENT_RESULT_REF,
    selected_source_summaries: [{
      source_kind: 'project_summary',
      source_digest: `sha256:${'2'.repeat(64)}`,
      summary: 'The project currently contains a simple static homepage shell.',
      priority: 20,
    }],
    compaction_summaries: [{
      summary_digest: COMPACTION_REF.summary_digest,
      source_range_digest: COMPACTION_REF.source_range_digest,
      summary: 'Earlier discussion selected a restrained portfolio direction.',
      compacted_at_ms: COMPACTION_REF.compacted_at_ms,
    }],
    adopted_handoff_packets: [{
      packet_digest: HANDOFF_REF.packet_digest,
      summary: 'A prior task confirmed no publication should happen yet.',
      adopted_at_ms: HANDOFF_REF.adopted_at_ms,
    }],
    permission_state: {
      workspace_state: 'bound',
      write_permission: 'ask',
    },
    context_budget: {
      max_segments: 8,
      max_prompt_bytes: 4_096,
      reserved_response_bytes: 1_024,
    },
    assembled_at_ms: 11,
    ...overrides,
  };
}

test('assembles ready Working Context into deterministic model segments and snapshot refs', () => {
  const assembly = createBuilderContextAssembly(request());

  assert.equal(assembly.assembly_version, 'builder-context-assembly.v1');
  assert.match(assembly.assembly_id, /^builder-context-assembly:[0-9a-f]{64}$/u);
  assert.equal(assembly.working_context_state_status, 'approved_plan_ready');
  assert.equal(assembly.permission_gate.side_effect_ready, true);
  assert.deepEqual(
    assembly.model_context_segments.map((segment) => segment.segment_kind),
    [
      'latest_user_message',
      'working_context_objective',
      'working_context_constraints',
      'approved_plan',
      'current_result',
      'selected_source_summary',
      'compaction_summary',
      'handoff_summary',
    ],
  );
  assert.deepEqual(assembly.run_snapshot_refs, {
    working_context_state_id: assembly.working_context_state_id,
    working_context_state_updated_at_ms: 10,
    compaction_refs: [COMPACTION_REF],
    handoff_refs: [HANDOFF_REF],
  });
  assert.deepEqual(sanitizeBuilderContextAssembly(structuredClone(assembly)), assembly);
  assert.doesNotMatch(
    JSON.stringify(assembly),
    /api[_-]?key|credential|provider_config|source_tree|git_candidate_receipt|commit_oid|tree_oid/iu,
  );
});

test('keeps context digest bound to selected summaries and rejects tampering', () => {
  const first = createBuilderContextAssembly(request());
  const second = createBuilderContextAssembly(request({
    selected_source_summaries: [{
      source_kind: 'project_summary',
      source_digest: `sha256:${'2'.repeat(64)}`,
      summary: 'The project currently contains a static homepage plus a gallery shell.',
      priority: 20,
    }],
  }));
  assert.notEqual(second.context_digest, first.context_digest);

  const tampered = structuredClone(first);
  tampered.model_context_segments[0].text = 'Do something else.';
  assert.throws(
    () => sanitizeBuilderContextAssembly(tampered),
    BuilderContextAssemblerError,
  );
});

test('omits lower-authority segments when budget or segment count is exhausted', () => {
  const segmentLimited = createBuilderContextAssembly(request({
    context_budget: {
      max_segments: 3,
      max_prompt_bytes: 4_096,
      reserved_response_bytes: 1_024,
    },
  }));
  assert.equal(segmentLimited.model_context_segments.length, 3);
  assert.equal(segmentLimited.omitted_refs[0].reason, 'segment_limit');

  const largeSummary = 'A'.repeat(600);
  const budgetLimited = createBuilderContextAssembly(request({
    selected_source_summaries: [{
      source_kind: 'project_summary',
      source_digest: `sha256:${'2'.repeat(64)}`,
      summary: largeSummary,
      priority: 20,
    }],
    context_budget: {
      max_segments: 16,
      max_prompt_bytes: 512,
      reserved_response_bytes: 1_024,
    },
  }));
  assert.equal(
    budgetLimited.omitted_refs.some((ref) => ref.reason === 'budget_exceeded'),
    true,
  );
});

test('fails closed for side-effecting stale or unclear context but allows read-only assembly', () => {
  const stale = workingContextState({
    approved_plan_ref: null,
    invalidated_by: {
      source: 'user_correction',
      route_decision_id: 'builder-route-decision:44444444-4444-4444-8444-444444444444',
      invalidated_at_ms: 10,
    },
  });
  assert.equal(stale.state, 'stale');
  assert.throws(
    () => createBuilderContextAssembly(request({
      working_context_state: stale,
      approved_plan_ref: null,
    })),
    BuilderContextAssemblerError,
  );

  const needsClarification = workingContextState({
    approved_plan_ref: null,
    open_questions: ['Which sections should be kept?'],
  });
  assert.equal(needsClarification.state, 'needs_clarification');
  assert.throws(
    () => createBuilderContextAssembly(request({
      working_context_state: needsClarification,
      approved_plan_ref: null,
    })),
    BuilderContextAssemblerError,
  );

  const answerAssembly = createBuilderContextAssembly(request({
    assembly_purpose: 'answer',
    working_context_state: needsClarification,
    approved_plan_ref: null,
    permission_state: {
      workspace_state: 'missing',
      write_permission: 'not_required',
    },
  }));
  assert.equal(answerAssembly.permission_gate.side_effect_ready, false);
  assert.equal(answerAssembly.working_context_state_status, 'needs_clarification');
});

test('rejects forged refs, private material, extras, accessors, and proxies', () => {
  assert.throws(
    () => createBuilderContextAssembly(request({
      project_id: 'builder-project:99999999-9999-4999-8999-999999999999',
    })),
    BuilderContextAssemblerError,
  );
  assert.throws(
    () => createBuilderContextAssembly(request({
      compaction_summaries: [{
        summary_digest: `sha256:${'9'.repeat(64)}`,
        source_range_digest: COMPACTION_REF.source_range_digest,
        summary: 'Unrelated summary.',
        compacted_at_ms: 8,
      }],
    })),
    BuilderContextAssemblerError,
  );
  assert.throws(
    () => createBuilderContextAssembly(request({
      latest_user_message: 'Use api_key=super-secret-value',
    })),
    BuilderContextAssemblerError,
  );
  assert.throws(
    () => createBuilderContextAssembly({
      ...request(),
      extra: true,
    }),
    BuilderContextAssemblerError,
  );
  const accessor = request();
  Object.defineProperty(accessor, 'latest_user_message', {
    enumerable: true,
    get() {
      throw new Error('getter should not run');
    },
  });
  assert.throws(
    () => createBuilderContextAssembly(accessor),
    BuilderContextAssemblerError,
  );
  assert.throws(
    () => createBuilderContextAssembly(new Proxy(request(), {})),
    BuilderContextAssemblerError,
  );
});

test('source remains a pure main-side context contract without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-context-assembler.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /require\(['"](?:node:fs|fs|node:child_process|child_process|electron|dugite|node:sqlite)['"]\)|ipcMain|ipcRenderer|fetch\(|openai-compatible|provider-config|secret-store|git-current|git-project/u,
  );
});
