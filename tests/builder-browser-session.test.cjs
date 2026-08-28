'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BuilderBrowserSessionError,
  createBuilderBrowserSession,
  sanitizeBuilderBrowserSession,
} = require('../electron/builder-browser-session.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const RUN_ID = 'builder-run:22222222-2222-4222-8222-222222222222';
const PROFILE_ID = 'builder-browser-profile:33333333-3333-4333-8333-333333333333';

test('admits three browser session classes without exposing a partition', () => {
  const projectPreview = createBuilderBrowserSession({
    session_class: 'project_preview',
    project_id: PROJECT_ID,
    owner_run_id: null,
    profile_id: null,
    admitted_origins: ['http://127.0.0.1:3100'],
    persistence: 'ephemeral',
    created_at_ms: 100,
    expires_at_ms: 1_100,
  });
  const agentTest = createBuilderBrowserSession({
    session_class: 'agent_test',
    project_id: PROJECT_ID,
    owner_run_id: RUN_ID,
    profile_id: null,
    admitted_origins: ['http://127.0.0.1:3200'],
    persistence: 'ephemeral',
    created_at_ms: 100,
    expires_at_ms: 1_100,
  });
  const userWeb = createBuilderBrowserSession({
    session_class: 'user_web',
    project_id: null,
    owner_run_id: null,
    profile_id: PROFILE_ID,
    admitted_origins: ['https://example.com'],
    persistence: 'local_persistent',
    created_at_ms: 100,
    expires_at_ms: null,
  });

  assert.equal(projectPreview.authority.provider_authority, 'preview_evidence_only');
  assert.equal(agentTest.authority.provider_authority, 'bounded_observation_and_action_tools_only');
  assert.equal(userWeb.authority.provider_authority, 'none_without_separate_consent');
  assert.equal(Object.hasOwn(agentTest, 'partition'), false);
  assert.deepEqual(sanitizeBuilderBrowserSession(agentTest), agentTest);
});

test('agent test is run-bound, loopback-only, ephemeral, and expiring', () => {
  const base = {
    session_class: 'agent_test',
    project_id: PROJECT_ID,
    owner_run_id: RUN_ID,
    profile_id: null,
    admitted_origins: ['http://127.0.0.1:3200'],
    persistence: 'ephemeral',
    created_at_ms: 100,
    expires_at_ms: 1_100,
  };
  for (const invalid of [
    { ...base, owner_run_id: null },
    { ...base, profile_id: PROFILE_ID },
    { ...base, admitted_origins: ['https://example.com'] },
    { ...base, persistence: 'local_persistent' },
    { ...base, expires_at_ms: null },
  ]) {
    assert.throws(() => createBuilderBrowserSession(invalid), BuilderBrowserSessionError);
  }
});

test('session class authorities cannot be weakened by caller input', () => {
  const session = createBuilderBrowserSession({
    session_class: 'user_web',
    project_id: null,
    owner_run_id: null,
    profile_id: PROFILE_ID,
    admitted_origins: [],
    persistence: 'ephemeral',
    created_at_ms: 100,
    expires_at_ms: 1_100,
  });
  assert.throws(() => sanitizeBuilderBrowserSession({
    ...session,
    authority: { ...session.authority, provider_authority: 'full' },
  }), BuilderBrowserSessionError);
});
