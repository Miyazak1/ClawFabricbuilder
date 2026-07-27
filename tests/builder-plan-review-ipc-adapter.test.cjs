'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  REVIEW_PLAN_CHANNEL,
  BuilderPlanReviewIpcError,
  createBuilderPlanReviewIpcAdapter,
} = require('../electron/builder-plan-review-ipc-adapter.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174001';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174002';

function windowAuthority() {
  const webContents = Object.freeze({
    isDestroyed: () => false,
  });
  const window = Object.freeze({
    webContents,
    isDestroyed: () => false,
  });
  return { event: Object.freeze({ sender: webContents }), mainWindowRef: () => window };
}

function request(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    decision: 'approved',
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    result_version: 'builder-conversation-plan-review-result.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    decision: 'approved',
    review_admission: 'sqlite_recorded_no_execution',
    ...overrides,
  };
}

function adapter(overrides = {}) {
  const authority = windowAuthority();
  const calls = [];
  const value = createBuilderPlanReviewIpcAdapter({
    reviewPlan: overrides.reviewPlan ?? (async (body) => {
      calls.push(body);
      return result();
    }),
    mainWindowRef: authority.mainWindowRef,
  });
  return { authority, calls, value };
}

test('plan review adapter exposes only the review fact channel', async () => {
  const { authority, calls, value } = adapter();
  assert.equal(value.adapter_id, 'builder_plan_review.controlled_ipc_adapter.v1');
  assert.equal(value.namespace, 'builderPlanReview');
  assert.equal(value.preload_namespace, 'window.clawfabricBuilder.planReview');
  assert.deepEqual(value.exposed_methods, ['review']);
  assert.deepEqual(Object.keys(value.channels), ['review']);
  assert.equal(value.channels.review.channel, REVIEW_PLAN_CHANNEL);
  assert.equal(value.authority.active_renderer_required, true);
  assert.equal(value.authority.review_fact_recording, true);
  assert.equal(value.authority.source_mutation, false);
  assert.equal(value.authority.save_authority, false);
  assert.equal(value.authority.project_revision_authority, false);
  assert.equal(value.authority.provider_dispatch, false);
  assert.equal(value.authority.credential_readback, false);
  assert.equal(value.authority.direct_electron_registration, false);
  assert.equal(value.authority.direct_preload_exposure, false);

  const reviewed = await value.channels.review.invoke(authority.event, request());
  assert.deepEqual(calls, [request()]);
  assert.deepEqual(reviewed, result());
  assert.equal(Object.isFrozen(reviewed), true);
});

test('plan review adapter rejects inactive senders and malformed payloads before service authority', async () => {
  const { authority, calls, value } = adapter();
  await assert.rejects(
    value.channels.review.invoke(Object.freeze({ sender: Object.freeze({}) }), request()),
    (error) => error instanceof BuilderPlanReviewIpcError
      && error.code === 'builder_plan_review_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  for (const payload of [
    undefined,
    request({ project_id: 'bad' }),
    request({ decision: 'accepted' }),
    request({ conversation_id: 'builder-conversation:00000000-0000-4000-8000-000000000000' }),
    request({ plan_result_digest: `sha256:${'a'.repeat(64)}` }),
  ]) {
    await assert.rejects(
      value.channels.review.invoke(authority.event, payload),
      (error) => error instanceof BuilderPlanReviewIpcError
        && error.code === 'builder_plan_review_invalid',
    );
  }
  await assert.rejects(
    value.channels.review.invoke(authority.event, request(), { extra: true }),
    (error) => error instanceof BuilderPlanReviewIpcError
      && error.code === 'builder_plan_review_invalid',
  );
  assert.deepEqual(calls, []);
});

test('plan review adapter maps service failures to fixed public errors without private details', async () => {
  const source = new Error('private sqlite marker');
  source.code = 'builder_plan_review_unavailable';
  const { authority, value } = adapter({
    reviewPlan: async () => { throw source; },
  });
  await assert.rejects(
    value.channels.review.invoke(authority.event, request()),
    (error) => error instanceof BuilderPlanReviewIpcError
      && error.code === 'builder_plan_review_unavailable'
      && !`${error.message}:${error.stack}`.includes('private sqlite marker'),
  );

  const unknown = adapter({
    reviewPlan: async () => { throw new Error('private unknown marker'); },
  });
  await assert.rejects(
    unknown.value.channels.review.invoke(unknown.authority.event, request()),
    (error) => error instanceof BuilderPlanReviewIpcError
      && error.code === 'builder_plan_review_unavailable'
      && !`${error.message}:${error.stack}`.includes('private unknown marker'),
  );
});

test('plan review adapter fails closed on hostile or oversized output without invoking proxy traps', async () => {
  let traps = 0;
  const hostile = new Proxy({}, {
    ownKeys() {
      traps += 1;
      throw new Error('private output marker');
    },
  });
  const { authority, value } = adapter({
    reviewPlan: async () => hostile,
  });
  await assert.rejects(
    value.channels.review.invoke(authority.event, request()),
    (error) => error instanceof BuilderPlanReviewIpcError
      && error.code === 'builder_plan_review_unavailable',
  );
  assert.equal(traps, 0);

  const accessor = adapter({
    reviewPlan: async () => {
      const output = result();
      Object.defineProperty(output, 'decision', {
        enumerable: true,
        get() { return 'approved'; },
      });
      return output;
    },
  });
  await assert.rejects(
    accessor.value.channels.review.invoke(accessor.authority.event, request()),
    { code: 'builder_plan_review_unavailable' },
  );

  const oversized = adapter({
    reviewPlan: async () => result({
      marker: 'a'.repeat((64 * 1024) + 1),
    }),
  });
  await assert.rejects(
    oversized.value.channels.review.invoke(oversized.authority.event, request()),
    { code: 'builder_plan_review_unavailable' },
  );
});

test('plan review adapter rejects malformed options without invoking getters or proxy traps', () => {
  let getterCalls = 0;
  const authority = windowAuthority();
  const accessorOptions = { reviewPlan: async () => result() };
  Object.defineProperty(accessorOptions, 'mainWindowRef', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return authority.mainWindowRef;
    },
  });
  for (const invalid of [
    null,
    {},
    { reviewPlan: async () => result(), mainWindowRef: authority.mainWindowRef, extra: true },
    accessorOptions,
    new Proxy({}, { getPrototypeOf() { throw new Error('private proxy marker'); } }),
  ]) {
    assert.throws(
      () => createBuilderPlanReviewIpcAdapter(invalid),
      (error) => error instanceof BuilderPlanReviewIpcError
        && error.code === 'builder_plan_review_unavailable'
        && !`${error.message}:${error.stack}`.includes('private'),
    );
  }
  assert.equal(getterCalls, 0);
});

test('plan review adapter source has no edit, save, package, or legacy authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-plan-review-ipc-adapter.cjs'),
    'utf8',
  );
  assert.match(source, /active_renderer_required:\s*true/u);
  assert.match(source, /review_fact_recording:\s*true/u);
  assert.match(source, /source_mutation:\s*false/u);
  assert.match(source, /save_authority:\s*false/u);
  assert.match(source, /project_revision_authority:\s*false/u);
  assert.match(source, /provider_dispatch:\s*false/u);
  assert.match(source, /credential_readback:\s*false/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git-|node:sqlite|fetch\s*\(|https?:|saveDraft|generate|persist_candidate_commit|write_current|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
