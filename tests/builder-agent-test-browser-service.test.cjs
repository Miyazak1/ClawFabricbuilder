'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderAgentTestBrowserService,
  BuilderAgentTestBrowserServiceError,
} = require('../electron/builder-agent-test-browser-service.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const RUN_ID = 'builder-run:22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID =
  'builder-conversation:11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333';

function fixture(files = [{ path: 'index.html', content: '<h1>Ready</h1>' }]) {
  let sourceTree = createBuilderProjectSourceTree({ files });
  const runtimeStarts = [];
  const stoppedServers = [];
  const closedHandles = [];
  const closeRequests = [];
  const observations = [];
  const browserRuntime = {
    runtime_version: 'builder-agent-test-browser-runtime.v1',
    async start(request) {
      runtimeStarts.push(request);
      const handle = {
        async observe() {
          const entry = sourceTree.files.find((file) => /\.html?$/iu.test(file.path));
          const value = {
            observation_version: 'builder-agent-test-browser-observation.v1',
            visible_text: entry?.content ?? '',
          };
          observations.push(value);
          return value;
        },
        click: async (requestValue) => ({ action: 'click', request: requestValue }),
        type: async (requestValue) => ({ action: 'type', request: requestValue }),
        select_option: async (requestValue) => ({ action: 'select', request: requestValue }),
        press_key: async (requestValue) => ({ action: 'key', request: requestValue }),
        scroll: async (requestValue) => ({ action: 'scroll', request: requestValue }),
        async close(request) {
          closedHandles.push(handle);
          closeRequests.push(request);
        },
      };
      return handle;
    },
  };
  let port = 41000;
  const service = createBuilderAgentTestBrowserService({
    browser_runtime: browserRuntime,
    run_contract: {
      admission: {
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        task_id: 'builder-task:44444444-4444-4444-8444-444444444444',
        run_id: RUN_ID,
      },
    },
    workspace_tools: {
      async snapshot() { return sourceTree; },
    },
    now_ms: () => 1_000,
    async start_static_server({ admission }) {
      port += 1;
      return {
        preview_origin: `http://127.0.0.1:${port}`,
        entry_url: `http://127.0.0.1:${port}/${admission.selected_entry_path}`,
        async stop() { stoppedServers.push(port); },
      };
    },
  });
  return {
    service,
    runtimeStarts,
    stoppedServers,
    closedHandles,
    closeRequests,
    observations,
    setSourceTree(filesValue) { sourceTree = createBuilderProjectSourceTree({ files: filesValue }); },
  };
}

test('opens current run source in a fresh Agent Test session', async () => {
  const value = fixture();
  const observation = await value.service.open_local_app();
  assert.equal(observation.observation_version, 'builder-agent-test-browser-observation.v1');
  assert.equal(value.runtimeStarts.length, 1);
  assert.equal(value.runtimeStarts[0].browser_session.session_class, 'agent_test');
  assert.equal(value.runtimeStarts[0].browser_session.owner_run_id, RUN_ID);
  assert.equal(value.runtimeStarts[0].browser_session.persistence, 'ephemeral');
  assert.equal(value.runtimeStarts[0].entry_url.endsWith('/index.html'), true);
});

test('reload latest source replaces the server and browser handle', async () => {
  const value = fixture();
  await value.service.open_local_app();
  value.setSourceTree([{ path: 'app.html', content: '<h1>Updated</h1>' }]);
  await value.service.reload_latest_source();
  assert.equal(value.runtimeStarts.length, 2);
  assert.equal(value.runtimeStarts[1].entry_url.endsWith('/app.html'), true);
  assert.equal(value.closedHandles.length, 1);
  assert.deepEqual(value.closeRequests[0], { reason: 'replaced' });
  assert.equal(value.stoppedServers.length, 1);
  await value.service.close();
  assert.equal(value.closedHandles.length, 2);
  assert.deepEqual(value.closeRequests[1], { reason: 'completed' });
  assert.equal(value.stoppedServers.length, 2);
});

test('reopens the latest repaired source for a second Browser verification', async () => {
  const value = fixture([{ path: 'index.html', content: '<button>Broken label</button>' }]);
  const before = await value.service.open_local_app();
  assert.match(before.visible_text, /Broken label/u);

  value.setSourceTree([{ path: 'index.html', content: '<button>Save changes</button>' }]);
  const after = await value.service.reload_latest_source();
  assert.match(after.visible_text, /Save changes/u);
  assert.doesNotMatch(after.visible_text, /Broken label/u);
  assert.equal(value.runtimeStarts.length, 2);
  assert.notEqual(
    value.runtimeStarts[0].browser_session.session_id,
    value.runtimeStarts[1].browser_session.session_id,
  );
  assert.equal(value.closedHandles.length, 1);
  assert.equal(value.stoppedServers.length, 1);
});

test('does not guess an application when the source has no HTML entry', async () => {
  const value = fixture([{ path: 'index.js', content: 'export {};' }]);
  await assert.rejects(
    value.service.open_local_app(),
    (error) => error instanceof BuilderAgentTestBrowserServiceError
      && error.code === 'builder_agent_test_browser_service_no_entry',
  );
});
