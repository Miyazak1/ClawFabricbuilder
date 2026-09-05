'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PACKAGED_CANARY_PROJECT_ROOT_PATH,
  PACKAGED_CANARY_SENTINEL,
  PACKAGED_CANARY_USER_DATA_PATH,
} = require('../scripts/verify-packaged-canary.cjs');
const {
  FAULT_SENTINEL,
  MAIN_RESULT_FILE,
  MAIN_RESULT_VERSION,
  RESULT_VERSION,
  runCli,
  runPackagedEpipeFaultCanary,
  sanitizeLaunchEnvironment,
} = require('../scripts/verify-packaged-epipe-fault-canary.cjs');

const root = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(root, 'scripts', 'verify-packaged-epipe-fault-canary.cjs');
const PACKAGE_PATH = path.join(root, 'package.json');

function makeFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-epipe-fault-test-'));
  const executablePath = path.join(directory, process.platform === 'win32' ? 'fake.exe' : 'fake-bin');
  const resourcesPath = path.join(directory, 'resources');
  const sidecarDirectory = path.join(resourcesPath, 'app.asar.unpacked', 'electron', 'harness');
  fs.mkdirSync(sidecarDirectory, { recursive: true });
  fs.writeFileSync(executablePath, '');
  fs.copyFileSync(
    path.join(root, 'electron', 'harness', 'builder-session-resume-server.mjs'),
    path.join(sidecarDirectory, 'builder-session-resume-server.mjs'),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, executablePath, resourcesPath };
}

function fakeElectron() {
  const launches = [];
  const electron = {
    launches,
    async launch(options) {
      launches.push(options);
      const resultPath = path.join(options.env[PACKAGED_CANARY_USER_DATA_PATH], MAIN_RESULT_FILE);
      fs.writeFileSync(resultPath, `${JSON.stringify({
        result_version: MAIN_RESULT_VERSION,
        main_stdio_boundary_version: 'builder-main-stdio-boundary.v1',
        injected_stream: 'stderr',
        epipe_error_event_contained: true,
        post_close_write_returned_false: true,
        post_close_callback_code: 'builder_main_stdio_write_closed',
        uncaught_exception_observed: false,
        uncaught_exception_count: 0,
      })}\n`);
      return {
        process() {
          return { once(_event, callback) { callback(0); } };
        },
        async firstWindow() {
          return {};
        },
        async waitForEvent(event) {
          assert.equal(event, 'close');
        },
        async close() {
          throw new Error('canary should not need forced close');
        },
      };
    },
  };
  return electron;
}

test('launches packaged EPIPE fault injection with guarded env and packaged sidecar adapter', async (t) => {
  const { executablePath, resourcesPath } = makeFixture(t);
  const electron = fakeElectron();
  const result = await runPackagedEpipeFaultCanary({
    electron,
    env: {
      PATH: 'safe-path',
      SECRET_TOKEN: 'must-not-leak',
      SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
    },
    executablePath,
    resourcesPath,
  });

  assert.equal(result.result_version, RESULT_VERSION);
  assert.equal(result.main_result_version, MAIN_RESULT_VERSION);
  assert.equal(result.main_epipe_contained, true);
  assert.equal(result.main_uncaught_exception_observed, false);
  assert.equal(result.sidecar_epipe_contained, true);
  assert.equal(result.sidecar_business_error_frame_preserved, true);
  assert.equal(result.root_conversation_compatibility_added, false);
  assert.equal(electron.launches.length, 1);
  const launch = electron.launches[0];
  assert.equal(launch.env[PACKAGED_CANARY_SENTINEL], '1');
  assert.equal(launch.env[FAULT_SENTINEL], '1');
  assert.equal(Object.hasOwn(launch.env, 'SECRET_TOKEN'), false);
  assert.equal(fs.existsSync(launch.env[PACKAGED_CANARY_USER_DATA_PATH]), false);
});

test('keeps EPIPE fault launch environment small', () => {
  const userDataPath = path.join(os.tmpdir(), 'clawfabric-builder-packaged-canary-env');
  const projectRootPath = path.join(userDataPath, 'project-root');
  const env = sanitizeLaunchEnvironment({
    PATH: 'safe-path',
    API_KEY: 'private-marker',
    USERPROFILE: 'safe-profile',
  }, userDataPath, projectRootPath);

  assert.deepEqual(Object.keys(env).sort(), [
    FAULT_SENTINEL,
    PACKAGED_CANARY_PROJECT_ROOT_PATH,
    PACKAGED_CANARY_SENTINEL,
    PACKAGED_CANARY_USER_DATA_PATH,
    'PATH',
    'USERPROFILE',
  ].sort());
  assert.equal(JSON.stringify(env).includes('private-marker'), false);
});

test('wires packaged EPIPE fault gate into release verification without provider authority', async () => {
  let packet = '';
  const result = await runCli({
    argv: [],
    run: async () => ({ result_version: RESULT_VERSION }),
    stdout: { write(chunk) { packet += chunk; } },
  });
  assert.equal(result.result_version, RESULT_VERSION);
  assert.equal(JSON.parse(packet).result_version, RESULT_VERSION);
  await assert.rejects(
    runCli({
      argv: ['--execute'],
      run: async () => ({ result_version: RESULT_VERSION }),
      stdout: { write() {} },
    }),
    /unsupported arguments/u,
  );

  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  assert.equal(
    packageJson.scripts['verify:packaged-epipe-fault'],
    'node scripts/verify-packaged-epipe-fault-canary.cjs',
  );
  assert.match(packageJson.scripts['verify:release'], /verify:packaged-epipe-fault/u);
  assert.doesNotMatch(
    source,
    /providerSettings\.replaceCurrent|codeGenerator\.(?:submit|generate|continueDraft|generateApprovedPlan|proposePlan|answer|answerDraft|retry|steer|queueFollowup)|Authorization|Bearer|api[_-]?key/iu,
  );
});
