'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBuilderBrowserSession,
} = require('../electron/builder-browser-session.cjs');
const {
  BuilderBrowserSessionRegistryError,
  createBuilderBrowserSessionRegistry,
} = require('../electron/builder-browser-session-registry.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const RUN_ID = 'builder-run:22222222-2222-4222-8222-222222222222';
const PROFILE_ID = 'builder-browser-profile:33333333-3333-4333-8333-333333333333';

function browserSession(sessionClass, overrides = {}) {
  const common = {
    session_class: sessionClass,
    project_id: null,
    owner_run_id: null,
    profile_id: null,
    admitted_origins: [],
    persistence: 'ephemeral',
    created_at_ms: 100,
    expires_at_ms: 10_000,
  };
  if (sessionClass === 'project_preview') {
    Object.assign(common, { project_id: PROJECT_ID, admitted_origins: ['http://127.0.0.1:3100'] });
  } else if (sessionClass === 'agent_test') {
    Object.assign(common, {
      project_id: PROJECT_ID,
      owner_run_id: RUN_ID,
      admitted_origins: ['http://127.0.0.1:3200'],
    });
  } else {
    Object.assign(common, {
      profile_id: PROFILE_ID,
      admitted_origins: ['https://example.com'],
      persistence: 'local_persistent',
      expires_at_ms: null,
    });
  }
  return createBuilderBrowserSession({ ...common, ...overrides });
}

function fixture({ cleanupTimeoutMs = 50, stuck = false } = {}) {
  const sessions = [];
  let now = 1_000;
  const registry = createBuilderBrowserSessionRegistry({
    session: {
      fromPartition(partition) {
        const item = {
          partition,
          clear_calls: 0,
          async clearStorageData() {
            item.clear_calls += 1;
            if (stuck) return new Promise(() => {});
          },
        };
        sessions.push(item);
        return item;
      },
    },
    now_ms: () => now++,
    cleanup_timeout_ms: cleanupTimeoutMs,
  });
  return { registry, sessions };
}

test('owns isolated private partitions for all three public session classes', async () => {
  const value = fixture();
  const project = await value.registry.open({ browser_session: browserSession('project_preview') });
  const agent = await value.registry.open({ browser_session: browserSession('agent_test') });
  const user = await value.registry.open({ browser_session: browserSession('user_web') });

  assert.equal(project.readMainOnlyPartition().startsWith('builder-live-preview-'), true);
  assert.equal(agent.readMainOnlyPartition().startsWith('builder-agent-test-'), true);
  assert.equal(user.readMainOnlyPartition().startsWith('persist:builder-user-web-'), true);
  assert.equal(new Set(value.sessions.map((item) => item.partition)).size, 3);
  assert.equal(Object.hasOwn(project.readPublicStatus(), 'partition'), false);
  assert.deepEqual(value.registry.diagnostics().active_by_class, {
    project_preview: 1, agent_test: 1, user_web: 1,
  });

  await project.close({ reason: 'completed' });
  await agent.close({ reason: 'cancelled' });
  await user.close({ reason: 'user_closed' });
  assert.equal(value.sessions[0].clear_calls, 1);
  assert.equal(value.sessions[1].clear_calls, 1);
  assert.equal(value.sessions[2].clear_calls, 0);
  assert.equal(value.registry.diagnostics().active_count, 0);
});

test('rejects duplicate, expired, and post-dispose session admission', async () => {
  const value = fixture();
  const session = browserSession('agent_test');
  await value.registry.open({ browser_session: session });
  await assert.rejects(
    value.registry.open({ browser_session: session }),
    (error) => error.code === 'builder_browser_session_registry_conflict',
  );
  await assert.rejects(
    value.registry.open({ browser_session: browserSession('project_preview', {
      created_at_ms: 100,
      expires_at_ms: 500,
    }) }),
    (error) => error.code === 'builder_browser_session_registry_expired',
  );
  await value.registry.dispose();
  await assert.rejects(
    value.registry.open({ browser_session: browserSession('user_web') }),
    (error) => error.code === 'builder_browser_session_registry_closed',
  );
});

test('reuses one private partition for a persistent User Web profile without concurrent handlers', async () => {
  const value = fixture();
  const first = await value.registry.open({ browser_session: browserSession('user_web') });
  const firstPartition = first.readMainOnlyPartition();
  await assert.rejects(
    value.registry.open({ browser_session: browserSession('user_web', {
      admitted_origins: ['https://openai.com'],
      created_at_ms: 101,
    }) }),
    (error) => error.code === 'builder_browser_session_registry_conflict',
  );
  await first.close({ reason: 'user_closed' });
  const reopened = await value.registry.open({ browser_session: browserSession('user_web', {
    admitted_origins: ['https://openai.com'],
    created_at_ms: 101,
  }) });
  assert.equal(reopened.readMainOnlyPartition(), firstPartition);
  assert.equal(value.sessions[0].clear_calls, 0);
  await reopened.close({ reason: 'user_closed' });
  assert.equal(value.sessions[1].clear_calls, 0);
});

test('starts a new process registry without inheriting ephemeral session authority', async () => {
  const firstProcess = fixture();
  const firstHandle = await firstProcess.registry.open({
    browser_session: browserSession('agent_test'),
  });
  const firstPartition = firstHandle.readMainOnlyPartition();
  assert.equal(firstProcess.registry.diagnostics().active_count, 1);

  const restartedProcess = fixture();
  assert.deepEqual(restartedProcess.registry.diagnostics(), {
    registry_version: 'builder-browser-session-registry.v1',
    active_count: 0,
    cleanup_required_count: 0,
    active_by_class: { project_preview: 0, agent_test: 0, user_web: 0 },
    disposed: false,
  });
  assert.equal(restartedProcess.registry.readPublicStatus(firstHandle.session_id), null);

  const restartedHandle = await restartedProcess.registry.open({
    browser_session: browserSession('agent_test', { created_at_ms: 101 }),
  });
  assert.notEqual(restartedHandle.session_id, firstHandle.session_id);
  assert.notEqual(restartedHandle.readMainOnlyPartition(), firstPartition);
  await restartedHandle.close({ reason: 'shutdown' });
  await firstHandle.close({ reason: 'shutdown' });
});

test('surfaces bounded ephemeral cleanup failure and removes the active authority', async () => {
  const value = fixture({ cleanupTimeoutMs: 5, stuck: true });
  const handle = await value.registry.open({ browser_session: browserSession('agent_test') });
  await assert.rejects(
    handle.close({ reason: 'cancelled' }),
    (error) => error instanceof BuilderBrowserSessionRegistryError
      && error.code === 'builder_browser_session_registry_cleanup_required',
  );
  assert.equal(value.registry.diagnostics().active_count, 0);
  assert.equal(value.registry.diagnostics().cleanup_required_count, 1);
  assert.equal(
    value.registry.readPublicStatus(handle.session_id).lifecycle_state,
    'cleanup_required',
  );
  await assert.rejects(
    value.registry.open({ browser_session: browserSession('agent_test') }),
    (error) => error.code === 'builder_browser_session_registry_conflict',
  );
  assert.throws(
    () => handle.readMainOnlyElectronSession(),
    (error) => error.code === 'builder_browser_session_registry_closed',
  );
});
