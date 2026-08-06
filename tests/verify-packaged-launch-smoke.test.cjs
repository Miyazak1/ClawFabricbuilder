'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  PACKAGED_CANARY_PROJECT_ROOT_PATH,
  PACKAGED_CANARY_SENTINEL,
  PACKAGED_CANARY_USER_DATA_PATH,
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
} = require('../scripts/verify-packaged-canary.cjs');
const {
  BuilderPackagedLaunchSmokeError,
  RESULT_VERSION,
  REQUIRED_SELECTORS,
  runCli,
  runPackagedLaunchSmoke,
  sanitizeLaunchEnvironment,
} = require('../scripts/verify-packaged-launch-smoke.cjs');

const root = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(root, 'scripts', 'verify-packaged-launch-smoke.cjs');
const PACKAGE_PATH = path.join(root, 'package.json');

class FakeLocator {
  constructor(page, selector) {
    this.page = page;
    this.selector = selector;
  }

  async waitFor() {
    this.page.waitedSelectors.push(this.selector);
    if (this.page.missingSelectors.has(this.selector)) throw new Error('missing selector');
  }

  async textContent() {
    return this.page.textBySelector.get(this.selector) ?? '';
  }
}

class FakePage {
  constructor() {
    this.missingSelectors = new Set();
    this.waitedSelectors = [];
    this.textBySelector = new Map([
      [SELECTORS.workspaceChip, 'Choose project Chat only until you choose a folder'],
      ['[data-builder-rail-item="projects"]', 'Projects'],
      ['[data-builder-rail-item="settings"]', 'Settings'],
    ]);
  }

  locator(selector) {
    return new FakeLocator(this, selector);
  }

  async evaluate() {
    return {
      bridgeVersion: 'builder-preload.v22',
      codeGenerator: 'function',
      projectWorkspace: 'function',
      providerSettings: 'function',
      providerContextDisclosureApproval: 'function',
      taskStream: 'function',
      windowControls: 'function',
    };
  }
}

function fakeElectron(page) {
  const electron = {
    launches: [],
    closed: 0,
    async launch(options) {
      this.launches.push(options);
      return {
        async close() {
          electron.closed += 1;
        },
        async firstWindow() {
          return page;
        },
      };
    },
  };
  return electron;
}

function makeExistingExecutable(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-launch-smoke-test-'));
  const executablePath = path.join(directory, process.platform === 'win32' ? 'fake.exe' : 'fake-bin');
  fs.writeFileSync(executablePath, '');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return executablePath;
}

test('launches the packaged app with guarded canary paths and no provider input', async (t) => {
  const page = new FakePage();
  const electron = fakeElectron(page);
  const executablePath = makeExistingExecutable(t);
  const result = await runPackagedLaunchSmoke({
    electron,
    env: {
      PATH: 'safe-path',
      SECRET_TOKEN: 'do-not-copy',
      SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
    },
    executablePath,
  });

  assert.equal(result.result_version, RESULT_VERSION);
  assert.equal(result.provider_configured, false);
  assert.equal(electron.launches.length, 1);
  const launch = electron.launches[0];
  assert.equal(launch.executablePath, executablePath);
  assert.equal(launch.env[PACKAGED_CANARY_SENTINEL], '1');
  assert.equal(path.basename(launch.env[PACKAGED_CANARY_USER_DATA_PATH]).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX), true);
  assert.equal(
    launch.env[PACKAGED_CANARY_PROJECT_ROOT_PATH],
    path.join(launch.env[PACKAGED_CANARY_USER_DATA_PATH], 'project-root'),
  );
  assert.equal(Object.hasOwn(launch.env, 'SECRET_TOKEN'), false);
  assert.equal(fs.existsSync(launch.env[PACKAGED_CANARY_USER_DATA_PATH]), false);
  for (const selector of REQUIRED_SELECTORS) {
    assert.equal(page.waitedSelectors.includes(selector), true, selector);
  }
});

test('normalizes UI failures and still cleans the isolated user data directory', async (t) => {
  const page = new FakePage();
  page.missingSelectors.add(SELECTORS.workspaceChip);
  const electron = fakeElectron(page);
  const executablePath = makeExistingExecutable(t);
  await assert.rejects(
    runPackagedLaunchSmoke({ electron, env: {}, executablePath }),
    (error) => error instanceof BuilderPackagedLaunchSmokeError
      && error.code === 'launch_smoke_failed'
      && error.stack === 'BuilderPackagedLaunchSmokeError: Packaged launch smoke failed.',
  );
  assert.equal(electron.launches.length, 1);
  assert.equal(fs.existsSync(electron.launches[0].env[PACKAGED_CANARY_USER_DATA_PATH]), false);
});

test('keeps launch environment small and rejects unguarded user data paths', () => {
  const env = sanitizeLaunchEnvironment(
    {
      PATH: 'safe-path',
      API_KEY: 'private-marker',
      USERPROFILE: 'safe-profile',
    },
    path.join(os.tmpdir(), `${PACKAGED_CANARY_USER_DATA_PREFIX}abc`),
    path.join(os.tmpdir(), `${PACKAGED_CANARY_USER_DATA_PREFIX}abc`, 'project-root'),
  );
  assert.deepEqual(Object.keys(env).sort(), [
    PACKAGED_CANARY_PROJECT_ROOT_PATH,
    PACKAGED_CANARY_SENTINEL,
    PACKAGED_CANARY_USER_DATA_PATH,
    'PATH',
    'USERPROFILE',
  ].sort());
  assert.equal(JSON.stringify(env).includes('private-marker'), false);
});

test('CLI is zero-input and the source stays out of provider or generation authority', async () => {
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
    (error) => error.code === 'launch_smoke_input_invalid',
  );

  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  assert.equal(
    packageJson.scripts['verify:packaged-launch'],
    'node scripts/verify-packaged-launch-smoke.cjs',
  );
  assert.doesNotMatch(
    source,
    /providerSettings\.replaceCurrent|codeGenerator\.(?:submit|generate|continueDraft|generateApprovedPlan|proposePlan|answer|answerDraft|retry|steer|queueFollowup)|Authorization|Bearer|api[_-]?key/iu,
  );
});
