'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BuilderRunContextSnapshotError,
  createBuilderRunContextSnapshot,
  sanitizeBuilderRunContextSnapshot,
} = require('../electron/builder-run-context-snapshot.cjs');
const {
  createBuilderWorkingContextState,
} = require('../electron/builder-working-context-state.cjs');
const {
  createBuilderContextAssembly,
} = require('../electron/builder-context-assembler.cjs');
const {
  createBuilderProviderContextProjection,
} = require('../electron/builder-provider-context-projection.cjs');

const UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TURN_ID = `builder-turn:${UUID}`;
const TASK_ID = `builder-task:${UUID}`;
const OTHER_TASK_ID = 'builder-task:33333333-3333-4333-8333-333333333333';
const RUN_ID = `builder-run:${UUID}`;
const MESSAGE_ID = `builder-message:${UUID}`;
const BRIEF_MESSAGE_ID = 'builder-message:22222222-2222-4222-8222-222222222222';
const ROUTE_DECISION_ID = `builder-route-decision:${UUID}`;
const BRIEF_ROUTE_DECISION_ID = 'builder-route-decision:22222222-2222-4222-8222-222222222222';
const BASE_REVISION = Object.freeze({
  revision_receipt_digest: `sha256:${'a'.repeat(64)}`,
  commit_oid: 'b'.repeat(40),
});
const COMPACTION_REF = Object.freeze({
  summary_digest: `sha256:${'c'.repeat(64)}`,
  source_range_digest: `sha256:${'d'.repeat(64)}`,
  compacted_at_ms: 8,
});
const HANDOFF_REF = Object.freeze({
  packet_digest: `sha256:${'e'.repeat(64)}`,
  inserted_at_ms: 6,
  adopted_at_ms: 9,
});
const APPROVED_PLAN_REF = Object.freeze({
  plan_result_digest: `sha256:${'6'.repeat(64)}`,
  conversation_head_digest: `sha256:${'7'.repeat(64)}`,
  approved_at_ms: 9,
});

function routeDecision(overrides = {}) {
  return {
    decision_id: ROUTE_DECISION_ID,
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: MESSAGE_ID,
    task_id: TASK_ID,
    route: 'build',
    confidence: 'high',
    matched_signals: ['clear_build'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: ['write_project'],
    permission_result: 'allowed',
    dispatch: 'build',
    decided_at_ms: 7,
    ...overrides,
  };
}

function snapshotInput(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    message_id: MESSAGE_ID,
    route_decision: routeDecision(),
    latest_task_capsule: null,
    working_context_state: null,
    context_assembly: null,
    provider_context_projection: null,
    base_revision: BASE_REVISION,
    created_at_ms: 10,
    ...overrides,
  };
}

function workingContextState(overrides = {}) {
  return createBuilderWorkingContextState({
    project_id: PROJECT_ID,
    session_id: 'builder-session:22222222-2222-4222-8222-222222222222',
    task_address_id: 'builder-task-address:33333333-3333-4333-8333-333333333333',
    conversation_id: CONVERSATION_ID,
    objective_summary: null,
    confirmed_constraints: [],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: null,
    source_refs: [],
    compaction_refs: [],
    handoff_refs: [],
    latest_task_capsule: null,
    approved_plan_ref: null,
    base_revision_ref: {
      revision_receipt_digest: BASE_REVISION.revision_receipt_digest,
    },
    invalidated_by: null,
    updated_at_ms: 9,
    ...overrides,
  });
}

function contextAssembly(working_context_state, overrides = {}) {
  return createBuilderContextAssembly({
    assembly_purpose: 'contextual_build',
    project_id: PROJECT_ID,
    latest_user_message: 'Build from the approved plan.',
    working_context_state,
    approved_plan_ref: working_context_state.approved_plan_ref,
    current_result_ref: null,
    selected_source_summaries: [],
    compaction_summaries: [],
    adopted_handoff_packets: [],
    permission_state: {
      workspace_state: 'bound',
      write_permission: 'allowed',
    },
    context_budget: {
      max_segments: 8,
      max_prompt_bytes: 4_096,
      reserved_response_bytes: 1_024,
    },
    assembled_at_ms: 9,
    ...overrides,
  });
}

function providerContextProjection(context_assembly, overrides = {}) {
  return createBuilderProviderContextProjection({
    context_assembly,
    disclosure_decision: {
      decision: 'denied',
      approved_by: null,
      approved_at_ms: null,
      provider_scope: null,
      purpose: null,
    },
    projected_at_ms: 9,
    ...overrides,
  });
}

function latestTaskCapsule() {
  return {
    message_id: BRIEF_MESSAGE_ID,
    task_capsule: {
      task_id: TASK_ID,
      status: 'ready',
      current_brief: {
        use_when_instruction_is_contextual: true,
      },
      last_route_decision_id: BRIEF_ROUTE_DECISION_ID,
    },
  };
}

function priorBriefTaskCapsule() {
  return {
    message_id: BRIEF_MESSAGE_ID,
    task_capsule: {
      task_id: OTHER_TASK_ID,
      status: 'ready',
      current_brief: {
        use_when_instruction_is_contextual: true,
      },
      last_route_decision_id: BRIEF_ROUTE_DECISION_ID,
    },
  };
}

test('creates a digest-bound run context snapshot without private source authority', () => {
  const snapshot = createBuilderRunContextSnapshot(snapshotInput());

  assert.equal(Object.isFrozen(snapshot), true);
  assert.match(snapshot.snapshot_id, /^builder-run-context-snapshot:[0-9a-f]{64}$/u);
  assert.match(snapshot.context_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(snapshot.project_id, PROJECT_ID);
  assert.equal(snapshot.conversation_id, CONVERSATION_ID);
  assert.deepEqual(snapshot.included_message_ids, [MESSAGE_ID]);
  assert.deepEqual(snapshot.route_decision, {
    decision_id: ROUTE_DECISION_ID,
    route: 'build',
    dispatch: 'build',
    matched_signals: ['clear_build'],
    downgraded_from: null,
    downgrade_reason: null,
  });
  assert.deepEqual(snapshot.permissions, {
    required_permissions: ['write_project'],
    permission_result: 'allowed',
    admission_source: 'route_decision',
  });
  assert.deepEqual(snapshot.context_refs, {
    working_context_state_id: null,
    working_context_state_updated_at_ms: null,
    compaction_refs: [],
    handoff_refs: [],
  });
  assert.deepEqual(snapshot.context_assembly_ref, {
    assembly_id: null,
    context_digest: null,
    assembled_at_ms: null,
  });
  assert.deepEqual(snapshot.provider_context_projection_ref, {
    projection_id: null,
    projection_status: null,
    blocked_reason: null,
    projected_at_ms: null,
  });
  assert.deepEqual(sanitizeBuilderRunContextSnapshot(structuredClone(snapshot), {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
  }), snapshot);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /"provider_context":|credential|source_tree|prompt|api[_-]?key|git_candidate_receipt|tree_oid|parent_oid/iu,
  );
});

test('records Context Assembly safe refs in the digest-bound snapshot', () => {
  const state = workingContextState({
    objective_summary: 'Build a dashboard from the approved plan.',
    approved_plan_ref: APPROVED_PLAN_REF,
    compaction_refs: [COMPACTION_REF],
    handoff_refs: [HANDOFF_REF],
  });
  const assembly = contextAssembly(state);
  const snapshot = createBuilderRunContextSnapshot(snapshotInput({
    working_context_state: state,
    context_assembly: assembly,
  }));

  assert.deepEqual(snapshot.context_assembly_ref, {
    assembly_id: assembly.assembly_id,
    context_digest: assembly.context_digest,
    assembled_at_ms: 9,
  });
  assert.deepEqual(sanitizeBuilderRunContextSnapshot(structuredClone(snapshot)), snapshot);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /"provider_context":|model_context_segments|latest_user_message|objective_summary|credential|source_tree|prompt/iu,
  );

  assert.throws(
    () => createBuilderRunContextSnapshot(snapshotInput({
      working_context_state: null,
      context_assembly: assembly,
    })),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => sanitizeBuilderRunContextSnapshot({
      ...snapshot,
      context_assembly_ref: {
        ...snapshot.context_assembly_ref,
        context_digest: `sha256:${'1'.repeat(64)}`,
      },
    }),
    BuilderRunContextSnapshotError,
  );
});

test('records Provider Context Projection safe refs without provider context body', () => {
  const state = workingContextState({
    objective_summary: 'Build a dashboard from the approved plan.',
    approved_plan_ref: APPROVED_PLAN_REF,
  });
  const assembly = contextAssembly(state);
  const projection = providerContextProjection(assembly);
  const snapshot = createBuilderRunContextSnapshot(snapshotInput({
    working_context_state: state,
    context_assembly: assembly,
    provider_context_projection: projection,
  }));

  assert.deepEqual(snapshot.provider_context_projection_ref, {
    projection_id: projection.projection_id,
    projection_status: 'blocked',
    blocked_reason: 'context_disclosure_denied',
    projected_at_ms: 9,
  });
  assert.deepEqual(sanitizeBuilderRunContextSnapshot(structuredClone(snapshot)), snapshot);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /"provider_context":|model_context_segments|latest_user_message|objective_summary|credential|source_tree|prompt/iu,
  );

  const otherAssembly = contextAssembly(state, {
    context_budget: {
      max_segments: 8,
      max_prompt_bytes: 8_192,
      reserved_response_bytes: 1_024,
    },
  });
  assert.throws(
    () => createBuilderRunContextSnapshot(snapshotInput({
      working_context_state: state,
      context_assembly: assembly,
      provider_context_projection: providerContextProjection(otherAssembly),
    })),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => createBuilderRunContextSnapshot(snapshotInput({
      working_context_state: null,
      context_assembly: null,
      provider_context_projection: projection,
    })),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => sanitizeBuilderRunContextSnapshot({
      ...snapshot,
      provider_context_projection_ref: {
        ...snapshot.provider_context_projection_ref,
        projection_status: 'ready',
      },
    }),
    BuilderRunContextSnapshotError,
  );
});

test('records Working Context safe refs in the digest-bound snapshot', () => {
  const snapshot = createBuilderRunContextSnapshot(snapshotInput({
    working_context_state: workingContextState({
      compaction_refs: [COMPACTION_REF],
      handoff_refs: [HANDOFF_REF],
    }),
  }));
  const digestBeforeTamper = snapshot.context_digest;

  assert.deepEqual(snapshot.context_refs, {
    working_context_state_id: snapshot.context_refs.working_context_state_id,
    working_context_state_updated_at_ms: 9,
    compaction_refs: [COMPACTION_REF],
    handoff_refs: [HANDOFF_REF],
  });
  assert.match(snapshot.context_refs.working_context_state_id, /^builder-working-context-state:[0-9a-f]{64}$/u);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /objective_summary|confirmed_constraints|handoff_id|requested_next_action|summary_text|"provider_context":|credential|source_tree/iu,
  );

  const tampered = structuredClone(snapshot);
  tampered.context_refs.compaction_refs[0].summary_digest = `sha256:${'1'.repeat(64)}`;
  const different = createBuilderRunContextSnapshot(snapshotInput({
    working_context_state: workingContextState({
      compaction_refs: [{
        ...COMPACTION_REF,
        summary_digest: `sha256:${'1'.repeat(64)}`,
      }],
      handoff_refs: [HANDOFF_REF],
    }),
  }));
  assert.notEqual(different.context_digest, digestBeforeTamper);
  assert.throws(
    () => sanitizeBuilderRunContextSnapshot(tampered),
    BuilderRunContextSnapshotError,
  );
});

test('keeps safe route downgrade facts in the digest-bound snapshot', () => {
  const snapshot = createBuilderRunContextSnapshot(snapshotInput({
    route_decision: routeDecision({
      route: 'clarify',
      dispatch: 'reply',
      matched_signals: ['clear_build'],
      downgraded_from: 'build',
      downgrade_reason: 'missing_prior_build_context',
      required_permissions: [],
      permission_result: 'not_required',
    }),
  }));

  assert.deepEqual(snapshot.route_decision, {
    decision_id: ROUTE_DECISION_ID,
    route: 'clarify',
    dispatch: 'reply',
    matched_signals: ['clear_build'],
    downgraded_from: 'build',
    downgrade_reason: 'missing_prior_build_context',
  });
  assert.doesNotMatch(JSON.stringify(snapshot.route_decision), /required_permissions|permission_result|confidence|decided_at_ms/iu);
});

test('binds a task capsule source message without including brief text', () => {
  const snapshot = createBuilderRunContextSnapshot(snapshotInput({
    latest_task_capsule: latestTaskCapsule(),
  }));

  assert.deepEqual(snapshot.included_message_ids, [MESSAGE_ID, BRIEF_MESSAGE_ID]);
  assert.deepEqual(snapshot.brief_reference, {
    status: 'task_capsule_update',
    task_id: TASK_ID,
    source_message_id: BRIEF_MESSAGE_ID,
    last_route_decision_id: BRIEF_ROUTE_DECISION_ID,
    contextual_build_ready: true,
  });
  assert.deepEqual(sanitizeBuilderRunContextSnapshot(structuredClone(snapshot), {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
  }), snapshot);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /assistant_proposal|latest_user_goal|current_brief|credential|"provider_context":|source_tree|prompt/iu,
  );
});

test('keeps prior brief task ids while rejecting mismatched route identities', () => {
  const snapshot = createBuilderRunContextSnapshot(snapshotInput({
    latest_task_capsule: priorBriefTaskCapsule(),
  }));

  assert.equal(snapshot.task_id, TASK_ID);
  assert.deepEqual(snapshot.included_message_ids, [MESSAGE_ID, BRIEF_MESSAGE_ID]);
  assert.equal(snapshot.brief_reference.task_id, OTHER_TASK_ID);
  assert.equal(snapshot.brief_reference.source_message_id, BRIEF_MESSAGE_ID);
  assert.equal(snapshot.brief_reference.contextual_build_ready, true);
  assert.throws(
    () => createBuilderRunContextSnapshot(snapshotInput({
      route_decision: routeDecision({ task_id: OTHER_TASK_ID }),
    })),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => createBuilderRunContextSnapshot(snapshotInput({
      route_decision: routeDecision({ message_id: BRIEF_MESSAGE_ID }),
    })),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => createBuilderRunContextSnapshot(snapshotInput({
      route_decision: routeDecision({
        project_id: 'builder-project:33333333-3333-4333-8333-333333333333',
      }),
    })),
    BuilderRunContextSnapshotError,
  );
});

test('rejects not-ready task capsule references before recording run context', () => {
  for (const latest_task_capsule of [
    {
      message_id: BRIEF_MESSAGE_ID,
      task_capsule: {
        task_id: TASK_ID,
        status: 'discussing',
        current_brief: {
          use_when_instruction_is_contextual: false,
        },
        last_route_decision_id: BRIEF_ROUTE_DECISION_ID,
      },
    },
    {
      message_id: BRIEF_MESSAGE_ID,
      task_capsule: {
        task_id: TASK_ID,
        status: 'ready',
        current_brief: {
          use_when_instruction_is_contextual: false,
        },
        last_route_decision_id: BRIEF_ROUTE_DECISION_ID,
      },
    },
  ]) {
    assert.throws(
      () => createBuilderRunContextSnapshot(snapshotInput({ latest_task_capsule })),
      BuilderRunContextSnapshotError,
    );
  }
});

test('binds snapshot id and digest to the canonical body', () => {
  const snapshot = structuredClone(createBuilderRunContextSnapshot(snapshotInput()));
  snapshot.route_decision.dispatch = 'blocked';

  assert.throws(
    () => sanitizeBuilderRunContextSnapshot(snapshot, {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
      task_id: TASK_ID,
    }),
    BuilderRunContextSnapshotError,
  );
});

test('rejects private route signals, extra fields, and mismatched identity', () => {
  assert.throws(
    () => createBuilderRunContextSnapshot(snapshotInput({
      route_decision: routeDecision({ matched_signals: ['provider:deepseek'] }),
    })),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => createBuilderRunContextSnapshot(snapshotInput({
      route_decision: routeDecision({ downgrade_reason: 'private_marker' }),
    })),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => createBuilderRunContextSnapshot({
      ...snapshotInput(),
      provider_secret: 'private',
    }),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => sanitizeBuilderRunContextSnapshot({
      ...createBuilderRunContextSnapshot(snapshotInput({ latest_task_capsule: latestTaskCapsule() })),
      included_message_ids: [MESSAGE_ID],
    }),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => sanitizeBuilderRunContextSnapshot(
      createBuilderRunContextSnapshot(snapshotInput()),
      {
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        turn_id: TURN_ID,
        run_id: RUN_ID,
        task_id: null,
      },
    ),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => createBuilderRunContextSnapshot(snapshotInput({
      working_context_state: {
        ...workingContextState({
          updated_at_ms: 11,
        }),
      },
    })),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => sanitizeBuilderRunContextSnapshot({
      ...createBuilderRunContextSnapshot(snapshotInput()),
      context_refs: {
        working_context_state_id: null,
        working_context_state_updated_at_ms: null,
        compaction_refs: [{
          ...COMPACTION_REF,
          summary_text: 'private summary',
        }],
        handoff_refs: [],
      },
    }),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => sanitizeBuilderRunContextSnapshot({
      ...createBuilderRunContextSnapshot(snapshotInput()),
      context_refs: {
        working_context_state_id: null,
        working_context_state_updated_at_ms: null,
        compaction_refs: [COMPACTION_REF],
        handoff_refs: [],
      },
    }),
    BuilderRunContextSnapshotError,
  );
});
