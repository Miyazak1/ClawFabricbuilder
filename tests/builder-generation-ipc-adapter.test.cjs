'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  GENERATE_CHANNEL,
  CONTINUE_DRAFT_CHANNEL,
  GENERATE_APPROVED_PLAN_CHANNEL,
  PROPOSE_PLAN_CHANNEL,
  PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL,
  APPROVE_PLAN_SOURCE_READ_CHANNEL,
  PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL,
  APPROVE_CURRENT_PROJECT_WRITE_CHANNEL,
  SUBMIT_CHANNEL,
  RETRY_GENERATE_CHANNEL,
  ANSWER_CHANNEL,
  ANSWER_DRAFT_CHANNEL,
  CANCEL_CHANNEL,
  STEER_CHANNEL,
  QUEUE_FOLLOWUP_CHANNEL,
  AVAILABILITY_CHANNEL,
  RESTORE_DRAFT_CHANNEL,
  RESTORE_REVISION_AS_DRAFT_CHANNEL,
  REJECT_DRAFT_CHANNEL,
  GENERATE_RESULT_VERSION,
  BuilderGenerationIpcError,
  createBuilderGenerationIpcAdapter,
} = require('../electron/builder-generation-ipc-adapter.cjs');

function activeWindow() {
  const webContents = { isDestroyed: () => false };
  return { webContents, isDestroyed: () => false };
}

function adapter(overrides = {}) {
  const windowRef = activeWindow();
  const calls = [];
  const value = createBuilderGenerationIpcAdapter({
    generate: async (request) => {
      calls.push(['generate', request]);
      return { result: 'generated' };
    },
    continueDraft: async (request) => {
      calls.push(['continueDraft', request]);
      return { result: 'continued' };
    },
    generateApprovedPlan: async (request) => {
      calls.push(['generateApprovedPlan', request]);
      return { result: 'approved-plan-generated' };
    },
    proposePlan: async (request) => {
      calls.push(['proposePlan', request]);
      return { result: 'plan-proposed' };
    },
    preparePlanSourceReadApproval: async (request) => {
      calls.push(['preparePlanSourceReadApproval', request]);
      return { result: 'plan-source-read-status' };
    },
    approvePlanSourceRead: async (request) => {
      calls.push(['approvePlanSourceRead', request]);
      return { result: 'plan-source-read-approved' };
    },
    prepareCurrentProjectWriteApproval: async (request) => {
      calls.push(['prepareCurrentProjectWriteApproval', request]);
      return { result: 'current-project-write-status' };
    },
    approveCurrentProjectWrite: async (request) => {
      calls.push(['approveCurrentProjectWrite', request]);
      return { result: 'current-project-write-approved' };
    },
    submit: async (request) => {
      calls.push(['submit', request]);
      return { result: 'submitted' };
    },
    retry: async (request) => {
      calls.push(['retry', request]);
      return { result: 'retried' };
    },
    answer: async (request) => {
      calls.push(['answer', request]);
      return { result: 'answered' };
    },
    answerDraft: async (request) => {
      calls.push(['answerDraft', request]);
      return { result: 'draft-answered' };
    },
    restoreDraft: async (request) => {
      calls.push(['restoreDraft', request]);
      return { result: 'restored' };
    },
    restoreRevisionAsDraft: async (request) => {
      calls.push(['restoreRevisionAsDraft', request]);
      return { result: 'restored-revision' };
    },
    rejectDraft: async (request) => {
      calls.push(['rejectDraft', request]);
      return { result: 'rejected' };
    },
    cancel: (request) => {
      calls.push(['cancel', request]);
      return { cancelled: true };
    },
    steer: (request) => {
      calls.push(['steer', request]);
      return { steered: true };
    },
    queueFollowup: (request) => {
      calls.push(['queueFollowup', request]);
      return { queued: true };
    },
    availability: () => {
      calls.push(['availability']);
      return { available: true };
    },
    mainWindowRef: () => windowRef,
    ...overrides,
  });
  return { calls, value, windowRef };
}

test('exposes only the dedicated Builder generation channels and forwards exact calls', async () => {
  const { calls, value, windowRef } = adapter();
  const request = Object.freeze({ request_digest: `sha256:${'a'.repeat(64)}` });
  const cancellation = Object.freeze({ request_id: request.request_digest });
  const steering = Object.freeze({ request_id: request.request_digest, message: 'Keep going.' });
  const followup = Object.freeze({ request_id: request.request_digest, message: 'Run this next.' });

  assert.equal(value.adapter_id, 'builder_code_generation.controlled_ipc_adapter.v1');
  assert.equal(value.namespace, 'builderCodeGenerator');
  assert.equal(value.preload_namespace, 'window.clawfabricBuilder.codeGenerator');
  assert.deepEqual(value.exposed_methods, [
    'generate',
    'continueDraft',
    'generateApprovedPlan',
    'proposePlan',
    'preparePlanSourceReadApproval',
    'approvePlanSourceRead',
    'prepareCurrentProjectWriteApproval',
    'approveCurrentProjectWrite',
    'submit',
    'retry',
    'answer',
    'answerDraft',
    'restoreDraft',
    'restoreRevisionAsDraft',
    'rejectDraft',
    'cancel',
    'steer',
    'queueFollowup',
    'availability',
  ]);
  assert.deepEqual(
    Object.values(value.channels).map(({ channel }) => channel),
    [
      GENERATE_CHANNEL,
      CONTINUE_DRAFT_CHANNEL,
      GENERATE_APPROVED_PLAN_CHANNEL,
      PROPOSE_PLAN_CHANNEL,
      PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL,
      APPROVE_PLAN_SOURCE_READ_CHANNEL,
      PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL,
      APPROVE_CURRENT_PROJECT_WRITE_CHANNEL,
      SUBMIT_CHANNEL,
      RETRY_GENERATE_CHANNEL,
      ANSWER_CHANNEL,
      ANSWER_DRAFT_CHANNEL,
      RESTORE_DRAFT_CHANNEL,
      RESTORE_REVISION_AS_DRAFT_CHANNEL,
      REJECT_DRAFT_CHANNEL,
      CANCEL_CHANNEL,
      STEER_CHANNEL,
      QUEUE_FOLLOWUP_CHANNEL,
      AVAILABILITY_CHANNEL,
    ],
  );
  assert.deepEqual(
    await value.channels.generate.invoke({ sender: windowRef.webContents }, request),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'generated' },
    },
  );
  assert.deepEqual(
    await value.channels.continueDraft.invoke({ sender: windowRef.webContents }, {
      draft_id: `builder-generation-draft:${'e'.repeat(64)}`,
      instruction: 'Keep refining.',
    }),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'continued' },
    },
  );
  assert.deepEqual(
    await value.channels.generateApprovedPlan.invoke({ sender: windowRef.webContents }, request),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'approved-plan-generated' },
    },
  );
  assert.deepEqual(
    await value.channels.proposePlan.invoke({ sender: windowRef.webContents }, request),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'plan-proposed' },
    },
  );
  assert.deepEqual(
    await value.channels.preparePlanSourceReadApproval.invoke({ sender: windowRef.webContents }, request),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'plan-source-read-status' },
    },
  );
  assert.deepEqual(
    await value.channels.approvePlanSourceRead.invoke({ sender: windowRef.webContents }, request),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'plan-source-read-approved' },
    },
  );
  assert.deepEqual(
    await value.channels.prepareCurrentProjectWriteApproval.invoke({ sender: windowRef.webContents }, request),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'current-project-write-status' },
    },
  );
  assert.deepEqual(
    await value.channels.approveCurrentProjectWrite.invoke({ sender: windowRef.webContents }, request),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'current-project-write-approved' },
    },
  );
  assert.deepEqual(
    await value.channels.submit.invoke({ sender: windowRef.webContents }, request),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'submitted' },
    },
  );
  assert.deepEqual(
    await value.channels.retry.invoke({ sender: windowRef.webContents }, request),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'retried' },
    },
  );
  assert.deepEqual(
    await value.channels.answer.invoke({ sender: windowRef.webContents }, request),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'answered' },
    },
  );
  assert.deepEqual(
    await value.channels.answerDraft.invoke({ sender: windowRef.webContents }, {
      draft_id: `builder-generation-draft:${'f'.repeat(64)}`,
      instruction: 'Why is the preview blank?',
    }),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'draft-answered' },
    },
  );
  assert.deepEqual(
    await value.channels.restoreDraft.invoke({ sender: windowRef.webContents }, {
      draft_id: `builder-generation-draft:${'b'.repeat(64)}`,
    }),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'restored' },
    },
  );
  assert.deepEqual(
    await value.channels.restoreRevisionAsDraft.invoke({ sender: windowRef.webContents }, {
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
      revision_receipt_digest: `sha256:${'d'.repeat(64)}`,
    }),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'restored-revision' },
    },
  );
  assert.deepEqual(
    await value.channels.rejectDraft.invoke({ sender: windowRef.webContents }, {
      draft_id: `builder-generation-draft:${'c'.repeat(64)}`,
    }),
    {
      version: GENERATE_RESULT_VERSION,
      ok: true,
      result: { result: 'rejected' },
    },
  );
  assert.deepEqual(
    await value.channels.cancel.invoke({ sender: windowRef.webContents }, cancellation),
    { cancelled: true },
  );
  assert.deepEqual(
    await value.channels.steer.invoke({ sender: windowRef.webContents }, steering),
    { steered: true },
  );
  assert.deepEqual(
    await value.channels.queueFollowup.invoke({ sender: windowRef.webContents }, followup),
    { queued: true },
  );
  assert.deepEqual(
    await value.channels.availability.invoke({ sender: windowRef.webContents }),
    { available: true },
  );
  assert.deepEqual(calls, [
    ['generate', request],
    ['continueDraft', {
      draft_id: `builder-generation-draft:${'e'.repeat(64)}`,
      instruction: 'Keep refining.',
    }],
    ['generateApprovedPlan', request],
    ['proposePlan', request],
    ['preparePlanSourceReadApproval', request],
    ['approvePlanSourceRead', request],
    ['prepareCurrentProjectWriteApproval', request],
    ['approveCurrentProjectWrite', request],
    ['submit', request],
    ['retry', request],
    ['answer', request],
    ['answerDraft', {
      draft_id: `builder-generation-draft:${'f'.repeat(64)}`,
      instruction: 'Why is the preview blank?',
    }],
    ['restoreDraft', { draft_id: `builder-generation-draft:${'b'.repeat(64)}` }],
    ['restoreRevisionAsDraft', {
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
      revision_receipt_digest: `sha256:${'d'.repeat(64)}`,
    }],
    ['rejectDraft', { draft_id: `builder-generation-draft:${'c'.repeat(64)}` }],
    ['cancel', cancellation],
    ['steer', steering],
    ['queueFollowup', followup],
    ['availability'],
  ]);
  assert.deepEqual(value.authority, {
    host_adapter_injected: true,
    active_renderer_required: true,
    generic_provider_authority_reused: false,
    direct_electron_registration: false,
    direct_preload_exposure: false,
    provider_settings_exposed: false,
    credential_readback: false,
  });
});

test('rejects inactive renderers and argument-count drift before invoking host authority', async () => {
  const { calls, value, windowRef } = adapter();
  const marker = 'private-request-marker';

  await assert.rejects(
    value.channels.generate.invoke({ sender: {} }, { marker }),
    (error) => error instanceof BuilderGenerationIpcError
      && error.code === 'builder_generation_forbidden'
      && error.message === 'AI project generation is unavailable.'
      && !error.message.includes(marker),
  );
  await assert.rejects(
    value.channels.generate.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.continueDraft.invoke({ sender: {} }, { marker }),
    (error) => error.code === 'builder_generation_forbidden'
      && !error.message.includes(marker),
  );
  await assert.rejects(
    value.channels.continueDraft.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.retry.invoke({ sender: {} }, { marker }),
    (error) => error.code === 'builder_generation_forbidden'
      && !error.message.includes(marker),
  );
  await assert.rejects(
    value.channels.proposePlan.invoke({ sender: {} }, { marker }),
    (error) => error.code === 'builder_generation_forbidden'
      && !error.message.includes(marker),
  );
  await assert.rejects(
    value.channels.retry.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.proposePlan.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.answer.invoke({ sender: {} }, { marker }),
    (error) => error.code === 'builder_generation_forbidden'
      && !error.message.includes(marker),
  );
  await assert.rejects(
    value.channels.answer.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.answerDraft.invoke({ sender: {} }, { marker }),
    (error) => error.code === 'builder_generation_forbidden'
      && !error.message.includes(marker),
  );
  await assert.rejects(
    value.channels.answerDraft.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.restoreDraft.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.restoreRevisionAsDraft.invoke({ sender: {} }, { marker }),
    (error) => error.code === 'builder_generation_forbidden'
      && !error.message.includes(marker),
  );
  await assert.rejects(
    value.channels.restoreRevisionAsDraft.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.rejectDraft.invoke({ sender: {} }, { marker }),
    (error) => error.code === 'builder_generation_forbidden'
      && !error.message.includes(marker),
  );
  await assert.rejects(
    value.channels.rejectDraft.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.cancel.invoke(
      { sender: windowRef.webContents },
      { request_id: `sha256:${'a'.repeat(64)}` },
      { extra: true },
    ),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.steer.invoke({ sender: {} }, { marker }),
    (error) => error.code === 'builder_generation_forbidden'
      && !error.message.includes(marker),
  );
  await assert.rejects(
    value.channels.steer.invoke(
      { sender: windowRef.webContents },
      { request_id: `sha256:${'a'.repeat(64)}`, message: 'Continue.' },
      { extra: true },
    ),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    value.channels.availability.invoke({ sender: windowRef.webContents }, { extra: marker }),
    (error) => error.code === 'builder_generation_request_invalid'
      && !error.message.includes(marker),
  );
  assert.deepEqual(calls, []);
});

test('returns only fixed plain-data diagnostics for known and unknown generate failures', async () => {
  const windowRef = activeWindow();
  for (const [code, retryable] of [
    ['builder_generation_base_unavailable', true],
    ['builder_generation_parent_unavailable', true],
    ['builder_generation_provider_unavailable', false],
    ['builder_generation_project_write_permission_required', false],
    ['builder_generation_timeout', true],
    ['builder_generation_provider_http_error', true],
    ['builder_generation_provider_transport_error', true],
    ['builder_generation_structured_response_invalid', true],
    ['builder_generation_static_preview_contract_rejected', true],
    ['builder_generation_failed', true],
  ]) {
    const modified = new Error('modified-private-marker');
    modified.code = code;
    modified.stack = 'modified-private-stack';
    const known = createBuilderGenerationIpcAdapter({
      generate: () => { throw modified; },
      continueDraft: () => { throw modified; },
      generateApprovedPlan: () => { throw modified; },
      proposePlan: () => { throw modified; },
      preparePlanSourceReadApproval: () => { throw modified; },
      approvePlanSourceRead: () => { throw modified; },
      prepareCurrentProjectWriteApproval: () => { throw modified; },
      approveCurrentProjectWrite: () => { throw modified; },
      submit: () => { throw modified; },
      retry: () => { throw modified; },
      answer: () => { throw modified; },
      answerDraft: () => { throw modified; },
      restoreDraft: () => { throw modified; },
      restoreRevisionAsDraft: () => { throw modified; },
      rejectDraft: () => { throw modified; },
      cancel: () => ({}),
      steer: () => ({}),
      queueFollowup: () => ({}),
      availability: () => ({}),
      mainWindowRef: () => windowRef,
    });
    const result = await known.channels.generate.invoke({ sender: windowRef.webContents }, {});
    assert.deepEqual(result, {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code, retryable },
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.error), true);
    assert.doesNotMatch(JSON.stringify(result), /modified-private-marker|modified-private-stack/u);
    const retried = await known.channels.retry.invoke({ sender: windowRef.webContents }, {});
    assert.deepEqual(retried, {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code, retryable },
    });
    const continued = await known.channels.continueDraft.invoke({ sender: windowRef.webContents }, {});
    assert.deepEqual(continued, {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code, retryable },
    });
    const answered = await known.channels.answer.invoke({ sender: windowRef.webContents }, {});
    assert.deepEqual(answered, {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code, retryable },
    });
    const proposed = await known.channels.proposePlan.invoke({ sender: windowRef.webContents }, {});
    assert.deepEqual(proposed, {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code, retryable },
    });
    const restored = await known.channels.restoreDraft.invoke({ sender: windowRef.webContents }, {});
    assert.deepEqual(restored, {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code, retryable },
    });
    const restoredRevision = await known.channels.restoreRevisionAsDraft.invoke({ sender: windowRef.webContents }, {});
    assert.deepEqual(restoredRevision, {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code, retryable },
    });
    const rejected = await known.channels.rejectDraft.invoke({ sender: windowRef.webContents }, {});
    assert.deepEqual(rejected, {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code, retryable },
    });
  }

  const hostile = createBuilderGenerationIpcAdapter({
    generate: () => {
      const error = new Error('unknown-private-marker');
      error.code = 'unknown_private_code';
      error.raw_body = 'raw-private-body';
      throw error;
    },
    continueDraft: () => {
      const error = new Error('continue-draft-private-marker');
      error.code = 'builder_generation_timeout';
      throw error;
    },
    generateApprovedPlan: () => {
      const error = new Error('approved-plan-private-marker');
      error.code = 'builder_generation_timeout';
      throw error;
    },
    proposePlan: () => {
      const error = new Error('plan-private-marker');
      error.code = 'builder_generation_timeout';
      throw error;
    },
    preparePlanSourceReadApproval: () => {
      const error = new Error('plan-source-read-status-private-marker');
      error.code = 'builder_generation_timeout';
      throw error;
    },
    approvePlanSourceRead: () => {
      const error = new Error('plan-source-read-approve-private-marker');
      error.code = 'builder_generation_timeout';
      throw error;
    },
    prepareCurrentProjectWriteApproval: () => {
      const error = new Error('current-project-write-status-private-marker');
      error.code = 'builder_generation_project_write_permission_required';
      throw error;
    },
    approveCurrentProjectWrite: () => {
      const error = new Error('current-project-write-approve-private-marker');
      error.code = 'builder_generation_project_write_permission_required';
      throw error;
    },
    submit: () => {
      const error = new Error('submit-private-marker');
      error.code = 'builder_generation_timeout';
      throw error;
    },
    retry: () => {
      const error = new Error('retry-private-marker');
      error.code = 'builder_generation_timeout';
      throw error;
    },
    answer: () => {
      const error = new Error('answer-private-marker');
      error.code = 'builder_generation_timeout';
      throw error;
    },
    answerDraft: () => {
      const error = new Error('answer-draft-private-marker');
      error.code = 'builder_generation_timeout';
      throw error;
    },
    restoreDraft: () => {
      const error = new Error('restore-private-marker');
      error.code = 'builder_generation_parent_unavailable';
      throw error;
    },
    restoreRevisionAsDraft: () => {
      const error = new Error('restore-revision-private-marker');
      error.code = 'builder_generation_parent_unavailable';
      throw error;
    },
    rejectDraft: () => {
      const error = new Error('reject-private-marker');
      error.code = 'builder_generation_parent_unavailable';
      throw error;
    },
    cancel: () => {
      throw new Proxy(new Error('proxy-private-marker'), {
        getPrototypeOf() { throw new Error('proxy prototype trap marker'); },
      });
    },
    steer: () => {
      throw new Error('steer-private-marker');
    },
    queueFollowup: () => ({}),
    availability: () => {
      const error = new Error('getter-private-marker');
      Object.defineProperty(error, 'code', {
        get() { throw new Error('getter trap marker'); },
      });
      throw error;
    },
    mainWindowRef: () => windowRef,
  });
  await assert.rejects(
    hostile.channels.generate.invoke({ sender: windowRef.webContents }, {}),
    (error) => error.code === 'builder_generation_failed'
      && !error.message.includes('unknown-private-marker'),
  );
  assert.deepEqual(
    await hostile.channels.generateApprovedPlan.invoke({ sender: windowRef.webContents }, {}),
    {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code: 'builder_generation_timeout', retryable: true },
    },
  );
  assert.deepEqual(
    await hostile.channels.retry.invoke({ sender: windowRef.webContents }, {}),
    {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code: 'builder_generation_timeout', retryable: true },
    },
  );
  assert.deepEqual(
    await hostile.channels.continueDraft.invoke({ sender: windowRef.webContents }, {}),
    {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code: 'builder_generation_timeout', retryable: true },
    },
  );
  assert.deepEqual(
    await hostile.channels.answer.invoke({ sender: windowRef.webContents }, {}),
    {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code: 'builder_generation_timeout', retryable: true },
    },
  );
  assert.deepEqual(
    await hostile.channels.answerDraft.invoke({ sender: windowRef.webContents }, {}),
    {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code: 'builder_generation_timeout', retryable: true },
    },
  );
  assert.deepEqual(
    await hostile.channels.proposePlan.invoke({ sender: windowRef.webContents }, {}),
    {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code: 'builder_generation_timeout', retryable: true },
    },
  );
  assert.deepEqual(
    await hostile.channels.restoreDraft.invoke({ sender: windowRef.webContents }, {}),
    {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code: 'builder_generation_parent_unavailable', retryable: true },
    },
  );
  assert.deepEqual(
    await hostile.channels.restoreRevisionAsDraft.invoke({ sender: windowRef.webContents }, {}),
    {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code: 'builder_generation_parent_unavailable', retryable: true },
    },
  );
  assert.deepEqual(
    await hostile.channels.rejectDraft.invoke({ sender: windowRef.webContents }, {}),
    {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code: 'builder_generation_parent_unavailable', retryable: true },
    },
  );
  await assert.rejects(
    hostile.channels.cancel.invoke({ sender: windowRef.webContents }, {}),
    (error) => error.code === 'builder_generation_failed'
      && !error.message.includes('proxy-private-marker'),
  );
  await assert.rejects(
    hostile.channels.availability.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_failed'
      && !error.message.includes('getter-private-marker'),
  );

  const generateOnlyCode = createBuilderGenerationIpcAdapter({
    generate: async () => ({}),
    continueDraft: async () => ({}),
    generateApprovedPlan: async () => ({}),
    proposePlan: async () => ({}),
    preparePlanSourceReadApproval: async () => ({}),
    approvePlanSourceRead: async () => ({}),
    prepareCurrentProjectWriteApproval: async () => ({}),
    approveCurrentProjectWrite: async () => ({}),
    submit: async () => ({}),
    retry: async () => ({}),
    answer: async () => ({}),
    answerDraft: async () => ({}),
    restoreDraft: async () => ({}),
    restoreRevisionAsDraft: async () => ({}),
    rejectDraft: async () => ({}),
    cancel: () => {
      const error = new Error('control-private-marker');
      error.code = 'builder_generation_provider_http_error';
      throw error;
    },
    steer: () => {
      const error = new Error('control-private-marker');
      error.code = 'builder_generation_provider_http_error';
      throw error;
    },
    queueFollowup: () => ({}),
    availability: () => {
      const error = new Error('control-private-marker');
      error.code = 'builder_generation_static_preview_contract_rejected';
      throw error;
    },
    mainWindowRef: () => windowRef,
  });
  await assert.rejects(
    generateOnlyCode.channels.cancel.invoke({ sender: windowRef.webContents }, {}),
    (error) => error.code === 'builder_generation_failed',
  );
  await assert.rejects(
    generateOnlyCode.channels.availability.invoke({ sender: windowRef.webContents }),
    (error) => error.code === 'builder_generation_failed',
  );
});

test('keeps cancellation and other control failures as rejected generate invocations', async () => {
  const windowRef = activeWindow();
  let rejectGenerate;
  const pending = new Promise((_resolve, reject) => {
    rejectGenerate = reject;
  });
  const paired = createBuilderGenerationIpcAdapter({
    generate: () => pending,
    continueDraft: async () => ({}),
    generateApprovedPlan: async () => ({}),
    proposePlan: async () => ({}),
    preparePlanSourceReadApproval: async () => ({}),
    approvePlanSourceRead: async () => ({}),
    prepareCurrentProjectWriteApproval: async () => ({}),
    approveCurrentProjectWrite: async () => ({}),
    submit: async () => ({}),
    retry: async () => ({}),
    answer: async () => ({}),
    answerDraft: async () => ({}),
    restoreDraft: async () => ({}),
    restoreRevisionAsDraft: async () => ({}),
    rejectDraft: async () => ({}),
    cancel: () => {
      const error = new Error('cancel-private-marker');
      error.code = 'builder_generation_cancelled';
      rejectGenerate(error);
      return { cancelled: true };
    },
    steer: () => ({}),
    queueFollowup: () => ({}),
      availability: () => ({}),
    mainWindowRef: () => windowRef,
  });
  const generationRejection = assert.rejects(
    paired.channels.generate.invoke({ sender: windowRef.webContents }, {}),
    (error) => error.code === 'builder_generation_cancelled'
      && !error.message.includes('cancel-private-marker'),
  );
  assert.deepEqual(
    await paired.channels.cancel.invoke({ sender: windowRef.webContents }, {}),
    { cancelled: true },
  );
  await generationRejection;

  for (const code of [
    'builder_generation_request_invalid',
    'builder_generation_forbidden',
  ]) {
    const controlled = createBuilderGenerationIpcAdapter({
      generate: () => {
        const error = new Error('control-private-marker');
        error.code = code;
        throw error;
      },
      continueDraft: async () => ({}),
      generateApprovedPlan: async () => ({}),
      proposePlan: async () => ({}),
      preparePlanSourceReadApproval: async () => ({}),
      approvePlanSourceRead: async () => ({}),
      prepareCurrentProjectWriteApproval: async () => ({}),
      approveCurrentProjectWrite: async () => ({}),
      submit: async () => ({}),
      retry: async () => ({}),
      answer: async () => ({}),
      answerDraft: async () => ({}),
      restoreDraft: async () => ({}),
      restoreRevisionAsDraft: async () => ({}),
      rejectDraft: async () => ({}),
      cancel: () => ({}),
      steer: () => ({}),
      queueFollowup: () => ({}),
      availability: () => ({}),
      mainWindowRef: () => windowRef,
    });
    await assert.rejects(
      controlled.channels.generate.invoke({ sender: windowRef.webContents }, {}),
      (error) => error.code === code && !error.message.includes('control-private-marker'),
    );
  }
});

test('fails hostile generated result graphs into a generic plain-data envelope', async () => {
  const windowRef = activeWindow();
  const accessor = {};
  Object.defineProperty(accessor, 'result', {
    enumerable: true,
    get() { throw new Error('accessor-private-marker'); },
  });
  const polluted = { result: 'safe' };
  Object.defineProperty(polluted, '__proto__', {
    enumerable: true,
    value: { hidden: 'prototype-private-marker' },
  });
  const symbolic = { result: 'safe', [Symbol('hidden')]: 'symbol-private-marker' };
  for (const result of [new Proxy({ result: 'proxy-private-marker' }, {}), accessor, symbolic, polluted]) {
    const value = createBuilderGenerationIpcAdapter({
      generate: async () => result,
      continueDraft: async () => result,
      generateApprovedPlan: async () => result,
      proposePlan: async () => result,
      preparePlanSourceReadApproval: async () => result,
      approvePlanSourceRead: async () => result,
      prepareCurrentProjectWriteApproval: async () => result,
      approveCurrentProjectWrite: async () => result,
      submit: async () => result,
      retry: async () => result,
      answer: async () => result,
      answerDraft: async () => result,
      restoreDraft: async () => result,
      restoreRevisionAsDraft: async () => result,
      rejectDraft: async () => result,
      cancel: () => ({}),
      steer: () => ({}),
      queueFollowup: () => ({}),
      availability: () => ({}),
      mainWindowRef: () => windowRef,
    });
    const envelope = await value.channels.generate.invoke({ sender: windowRef.webContents }, {});
    assert.deepEqual(envelope, {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: { code: 'builder_generation_failed', retryable: true },
    });
    assert.deepEqual(
      await value.channels.answer.invoke({ sender: windowRef.webContents }, {}),
      envelope,
    );
    assert.deepEqual(
      await value.channels.rejectDraft.invoke({ sender: windowRef.webContents }, {}),
      envelope,
    );
    assert.deepEqual(
      await value.channels.restoreRevisionAsDraft.invoke({ sender: windowRef.webContents }, {}),
      envelope,
    );
    assert.doesNotMatch(JSON.stringify(envelope), /private-marker/u);
  }
});

test('bounds sparse, cyclic, deep, node-heavy, entry-heavy, and byte-heavy result graphs', async () => {
  const windowRef = activeWindow();
  const sparse = new Array(3);
  sparse[2] = 'safe';
  const cyclic = {};
  cyclic.self = cyclic;
  let deep = { leaf: true };
  for (let index = 0; index < 70; index += 1) deep = { nested: deep };
  const nodeHeavy = Array.from({ length: 20_000 }, () => ({}));
  const entryHeavy = {};
  for (let index = 0; index < 20_001; index += 1) entryHeavy[`key_${index}`] = true;
  const byteHeavy = { value: 'x'.repeat(1024 * 1024 + 1) };

  for (const result of [sparse, cyclic, deep, nodeHeavy, entryHeavy, byteHeavy]) {
    const value = createBuilderGenerationIpcAdapter({
      generate: async () => result,
      continueDraft: async () => result,
      generateApprovedPlan: async () => result,
      proposePlan: async () => result,
      preparePlanSourceReadApproval: async () => result,
      approvePlanSourceRead: async () => result,
      prepareCurrentProjectWriteApproval: async () => result,
      approveCurrentProjectWrite: async () => result,
      submit: async () => result,
      retry: async () => result,
      answer: async () => result,
      answerDraft: async () => result,
      restoreDraft: async () => result,
      restoreRevisionAsDraft: async () => result,
      rejectDraft: async () => result,
      cancel: () => ({}),
      steer: () => ({}),
      queueFollowup: () => ({}),
      availability: () => ({}),
      mainWindowRef: () => windowRef,
    });
    assert.deepEqual(
      await value.channels.generate.invoke({ sender: windowRef.webContents }, {}),
      {
        version: GENERATE_RESULT_VERSION,
        ok: false,
        error: { code: 'builder_generation_failed', retryable: true },
      },
    );
  }
});

test('rejects malformed dependency authority without invoking getters or proxy traps', () => {
  let trapCalls = 0;
  const valid = {
    generate: async () => ({}),
    continueDraft: async () => ({}),
    generateApprovedPlan: async () => ({}),
    proposePlan: async () => ({}),
    preparePlanSourceReadApproval: async () => ({}),
    approvePlanSourceRead: async () => ({}),
    prepareCurrentProjectWriteApproval: async () => ({}),
    approveCurrentProjectWrite: async () => ({}),
    submit: async () => ({}),
    retry: async () => ({}),
    answer: async () => ({}),
    answerDraft: async () => ({}),
    restoreDraft: async () => ({}),
    restoreRevisionAsDraft: async () => ({}),
    rejectDraft: async () => ({}),
    cancel: () => ({}),
    steer: () => ({}),
    queueFollowup: () => ({}),
      availability: () => ({}),
    mainWindowRef: activeWindow,
  };
  const accessor = { ...valid };
  Object.defineProperty(accessor, 'generate', {
    enumerable: true,
    get() {
      trapCalls += 1;
      return async () => ({});
    },
  });
  const proxy = new Proxy(valid, {
    ownKeys() {
      trapCalls += 1;
      return Reflect.ownKeys(valid);
    },
  });

  for (const invalid of [
    null,
    {},
    { ...valid, extra: true },
    { ...valid, generate: 'not-a-function' },
    accessor,
    proxy,
  ]) {
    assert.throws(
      () => createBuilderGenerationIpcAdapter(invalid),
      (error) => error instanceof BuilderGenerationIpcError
        && error.code === 'builder_generation_failed',
    );
  }
  assert.equal(trapCalls, 0);
});

test('contains no registration, preload, secret, transport, repository, or legacy authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-generation-ipc-adapter.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|\bipcMain\b|\bipcRenderer\b|contextBridge|safeStorage|\bcredential\b|Authorization|fetch\s*\(|https?:|builder-provider-config|builder-provider-secret|builder-project-revision|ChatCreatePage|chat_planner|local-provider-executor|Canvas|JobMeta|AppLayout/iu,
  );
  assert.match(source, /active_renderer_required:\s*true/u);
  assert.match(source, /generic_provider_authority_reused:\s*false/u);
  assert.match(source, /provider_settings_exposed:\s*false/u);
  assert.match(source, /credential_readback:\s*false/u);
});
