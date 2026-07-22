'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { PNG } = require('pngjs');

const {
  BuilderPackagedCanaryError,
  CANARY_INPUT_VERSION,
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  assertReadEvidence,
  captureGuardedUserDataRoot,
  createArtifactGate,
  ensureCredentialOnlyFromStdin,
  fillProviderSettingsViaUi,
  generateProjectViaUi,
  networkRecorder,
  openProjectFromCatalogById,
  parseCanaryInput,
  readStdin,
  readOnlyBridgeEvidence,
  runCli,
  runPackagedCanary,
  sanitizeLaunchEnvironment,
  summarizePng,
} = require('../scripts/verify-packaged-canary.cjs');

const SOURCE_PATH = path.join(__dirname, '..', 'scripts', 'verify-packaged-canary.cjs');

function input(overrides = {}) {
  return JSON.stringify({
    executable_path: path.join(process.cwd(), 'release', 'win-unpacked', 'ClawFabric Builder.exe'),
    idea: 'Make a small focus timer.',
    provider: {
      base_url: 'https://provider.example/v1',
      credential: 'real-key-value-secret',
      max_tokens: 8192,
      model: 'builder-model',
      temperature: 0.2,
      timeout_ms: 30000,
    },
    schema_version: CANARY_INPUT_VERSION,
    ...overrides,
  });
}

class FakeLocator {
  constructor(page, selector) {
    this.page = page;
    this.selector = selector;
  }

  async click() {
    this.page.events.push(['click', this.selector]);
  }

  async fill(value) {
    this.page.events.push(['fill', this.selector, value]);
    this.page.values.set(this.selector, value);
  }

  contentFrame() {
    this.page.events.push(['contentFrame', this.selector]);
    return {
      locator: (selector) => ({
        innerText: async () => {
          this.page.events.push(['frameInnerText', selector]);
          return 'Focus timer preview';
        },
      }),
    };
  }

  async getAttribute(name) {
    this.page.events.push(['getAttribute', this.selector, name]);
    if (this.selector === SELECTORS.previewFrame && name === 'sandbox') return '';
    if (this.selector === SELECTORS.previewFrame && name === 'srcdoc') {
      return '<!doctype html><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><body><main>Focus timer preview</main></body>';
    }
    return null;
  }

  getByRole(role, options) {
    this.page.events.push(['scopedRole', this.selector, role, options]);
    return new FakeRole(this.page, role, options.name);
  }

  getByText(text, options) {
    this.page.events.push(['scopedText', this.selector, text, options]);
    return new FakeText(this.page, text);
  }

  async inputValue() {
    return this.page.values.get(this.selector) ?? '';
  }

  async screenshot() {
    if (!this.page.artifactsAllowed) throw new Error('artifact before password cleared');
    return pngFixture();
  }

  async waitFor(options) {
    this.page.events.push(['waitFor', this.selector, options?.state ?? null]);
  }

  locator(selector) {
    this.page.events.push(['scopedLocator', this.selector, selector]);
    return new FakeLocator(this.page, `${this.selector} ${selector}`);
  }
}

class FakeRole {
  constructor(page, role, name) {
    this.page = page;
    this.role = role;
    this.name = name;
  }

  async click() {
    this.page.events.push(['roleClick', this.role, this.name]);
    if (this.name === 'Save provider') this.page.values.set(SELECTORS.apiKey, '');
  }

  first() {
    this.page.events.push(['roleFirst', this.role, this.name]);
    return this;
  }
}

class FakeText {
  constructor(page, text) {
    this.page = page;
    this.text = text;
  }

  async waitFor(options) {
    this.page.events.push(['textWaitFor', this.text, options?.state ?? null]);
  }
}

class FakePage {
  constructor() {
    this.artifactsAllowed = false;
    this.events = [];
    this.values = new Map();
    this.listeners = new Map();
  }

  emitRequest(url) {
    for (const listener of this.listeners.get('request') ?? []) listener({ url: () => url });
  }

  getByRole(role, options) {
    return new FakeRole(this, role, options.name);
  }

  getByText(text) {
    return new FakeText(this, text);
  }

  locator(selector) {
    return new FakeLocator(this, selector);
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  async evaluate(callback, argument) {
    this.events.push(['evaluate', callback.toString(), argument]);
    return callback({
      projectId: argument.projectId,
    });
  }
}

function bridgeEvidence(projectId = null) {
  const project = {
    project_id: 'builder-project:11111111-1111-4111-8111-111111111111',
    revision: 1,
    revision_digest: `sha256:${'a'.repeat(64)}`,
    summary: 'A timer.',
    title: 'Focus timer',
  };
  return {
    catalog: {
      catalog_evidence: {
        ordering: 'project_id_ascending',
      },
      result_version: 'builder-project-catalog-result.v1',
      projects: [project],
    },
    current: projectId === null ? null : {
      head: {
        head_digest: `sha256:${'c'.repeat(64)}`,
        project_id: projectId,
        record_kind: 'builder_project_head',
        revision: 1,
        revision_digest: project.revision_digest,
        schema_version: 1,
      },
      persistence_evidence: {
        operation: 'current_loaded',
      },
      result_version: 'builder-project-repository-result.v1',
      restart_restore: true,
      record: {
        execution_admission: 'not_evaluated',
        files: {
          'app.js': '',
          'index.html': '<main>Focus timer</main>',
          'styles.css': 'main { color: black; }',
        },
        parent_revision: null,
        preview_script_admission: 'not_authorized',
        project_id: projectId,
        proposal_evidence: {
          authority: 'builder_code_project_generator',
        },
        record_kind: 'builder_project_revision',
        revision: 1,
        revision_digest: project.revision_digest,
        schema_version: 1,
        summary: project.summary,
        title: 'Focus timer',
      },
    },
    status: {
      status_version: 'builder-provider-settings-status.v1',
      configured: true,
      config_digest: `sha256:${'b'.repeat(64)}`,
      credential_status: 'stored',
    },
  };
}

function fakeElectron(page) {
  return {
    launches: [],
    async launch(options) {
      this.launches.push(options);
      return {
        async close() {},
        async firstWindow() {
          page.evaluate = async (callback, argument) => {
            page.events.push(['evaluate', callback.toString(), argument]);
            return bridgeEvidence(argument.projectId);
          };
          page.artifactsAllowed = true;
          return page;
        },
      };
    },
  };
}

function pngFixture() {
  const png = new PNG({ width: 5, height: 5 });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = offset % 8 === 0 ? 10 : 40;
    png.data[offset + 1] = offset % 8 === 0 ? 40 : 80;
    png.data[offset + 2] = offset % 8 === 0 ? 80 : 120;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

function fakeDirectoryStat(dev, ino, symbolic = false) {
  return {
    dev,
    ino,
    isDirectory() { return true; },
    isSymbolicLink() { return symbolic; },
  };
}

function guardedFixture() {
  const tempRoot = path.join(process.cwd(), 'canary-temp');
  const userDataPath = path.join(tempRoot, `${PACKAGED_CANARY_USER_DATA_PREFIX}unit`);
  const state = {
    realpath: new Map([
      [tempRoot, tempRoot],
      [userDataPath, userDataPath],
    ]),
    stats: new Map([
      [tempRoot, fakeDirectoryStat(1n, 10n)],
      [userDataPath, fakeDirectoryStat(1n, 11n)],
    ]),
  };
  const removed = [];
  const fsModule = {
    existsSync(target) { return target.endsWith('fake.exe'); },
    lstatSync(target) {
      const stat = state.stats.get(target);
      if (!stat) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return stat;
    },
    mkdtempSync(prefix) {
      assert.equal(prefix, path.join(tempRoot, PACKAGED_CANARY_USER_DATA_PREFIX));
      return userDataPath;
    },
    realpathSync: {
      native(target) {
        const real = state.realpath.get(target);
        if (!real) throw new Error('realpath failed');
        return real;
      },
    },
    rmSync(target) { removed.push(target); },
  };
  return {
    fsModule,
    osModule: { tmpdir: () => tempRoot },
    removed,
    state,
    tempRoot,
    userDataPath,
  };
}

test('parses exact stdin input and rejects credential in argv or env', () => {
  const parsed = parseCanaryInput(input());
  assert.equal(parsed.schema_version, CANARY_INPUT_VERSION);
  assert.equal(parsed.provider.credential, 'real-key-value-secret');
  assert.throws(
    () => parseCanaryInput(input({ executable_path: 'relative.exe' })),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.throws(
    () => ensureCredentialOnlyFromStdin(parsed.provider.credential, ['--key=real-key-value-secret'], {}),
    (error) => error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_secret_source_invalid',
  );
  assert.throws(
    () => ensureCredentialOnlyFromStdin(parsed.provider.credential, [], { TOKEN: 'real-key-value-secret' }),
    (error) => error.code === 'canary_secret_source_invalid',
  );
  assert.throws(
    () => parseCanaryInput(input({ extra: true })),
    (error) => error.code === 'canary_input_invalid',
  );
});

test('fills Settings UI and permits artifacts only after password field clears', async () => {
  const page = new FakePage();
  const gate = createArtifactGate();
  await assert.rejects(
    page.locator(SELECTORS.apiKey).screenshot(),
    /artifact before password cleared/u,
  );
  await fillProviderSettingsViaUi(page, parseCanaryInput(input()).provider, gate);
  page.artifactsAllowed = gate.allowed;
  assert.equal(gate.allowed, true);
  assert.equal(await page.locator(SELECTORS.apiKey).inputValue(), '');
  assert.deepEqual(page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]), [
    'Settings',
    'Save provider',
  ]);
  assert.equal(page.events.some((event) => event[0] === 'fill' && event[1] === SELECTORS.apiKey), true);
  assert.ok(await page.locator(SELECTORS.apiKey).screenshot());
});

test('generates only through real Make UI and reads bridge evidence without write commands', async () => {
  const page = new FakePage();
  await generateProjectViaUi(page, 'Make a focus timer.');
  const roleClicks = page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]);
  assert.deepEqual(roleClicks, ['New project', 'Make it']);
  assert.equal(page.events.some((event) => event[0] === 'roleFirst'), false);

  globalThis.clawfabricBuilder = {
    codeGenerator: {
      generate() { throw new Error('must not write through bridge'); },
    },
    projectCatalog: {
      async listCurrent() { return bridgeEvidence().catalog; },
    },
    projectRevisions: {
      async loadCurrent(request) { return bridgeEvidence(request.project_id).current; },
    },
    providerSettings: {
      async replaceCurrent() { throw new Error('must not write through bridge'); },
      async status() { return bridgeEvidence().status; },
    },
  };
  const evidence = await readOnlyBridgeEvidence(page, 'builder-project:11111111-1111-4111-8111-111111111111');
  assert.equal(evidence.status.configured, true);
  const source = page.events.find((event) => event[0] === 'evaluate')[1];
  assert.match(source, /providerSettings\.status/u);
  assert.match(source, /projectCatalog\.listCurrent/u);
  assert.match(source, /projectRevisions\.loadCurrent/u);
  assert.doesNotMatch(source, /replaceCurrent|codeGenerator\.generate|projectRevisions\.commit|cancel/u);
  delete globalThis.clawfabricBuilder;
});

test('sanitizes read evidence before dereferencing renderer-returned shapes', () => {
  let getterCalls = 0;
  const accessor = bridgeEvidence('builder-project:11111111-1111-4111-8111-111111111111');
  Object.defineProperty(accessor.status, 'configured', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('secret-marker');
    },
  });
  assert.throws(
    () => assertReadEvidence(accessor),
    (error) => error.code === 'canary_evidence_failed'
      && !error.message.includes('secret-marker'),
  );
  assert.equal(getterCalls, 0);

  const extra = bridgeEvidence('builder-project:11111111-1111-4111-8111-111111111111');
  extra.catalog.projects[0].extra = true;
  assert.throws(
    () => assertReadEvidence(extra),
    (error) => error.code === 'canary_evidence_failed',
  );

  const symbol = bridgeEvidence('builder-project:11111111-1111-4111-8111-111111111111');
  symbol.catalog.projects[Symbol('secret')] = {};
  assert.throws(
    () => assertReadEvidence(symbol),
    (error) => error.code === 'canary_evidence_failed',
  );

  let trapCalls = 0;
  const proxy = new Proxy(bridgeEvidence('builder-project:11111111-1111-4111-8111-111111111111'), {
    getOwnPropertyDescriptor() {
      trapCalls += 1;
      throw new Error('secret-marker');
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error('secret-marker');
    },
  });
  assert.throws(
    () => assertReadEvidence(proxy),
    (error) => error.code === 'canary_evidence_failed'
      && !error.message.includes('secret-marker'),
  );
  assert.equal(trapCalls, 0);
});

test('summarizes nonblank preview pixels and tracks unexpected renderer network', () => {
  const summary = summarizePng(pngFixture());
  assert.equal(summary.width, 5);
  assert.equal(summary.height, 5);
  assert.match(summary.pixel_digest, /^sha256:[0-9a-f]{64}$/u);
  const page = new FakePage();
  const recorder = networkRecorder();
  recorder.attach(page);
  page.emitRequest('file:///app/index.html');
  page.emitRequest('https://provider.example/v1/chat/completions');
  page.emitRequest('https://unexpected.example/script.js');
  assert.deepEqual(recorder.snapshot(), {
    unexpected_network_count: 2,
  });
});

test('sanitizes launch environment and canary root identity without following drift', () => {
  const { fsModule, osModule, userDataPath, tempRoot, state } = guardedFixture();
  let getterCalls = 0;
  const env = {
    PATH: 'C:\\Windows\\System32',
    JWT_SECRET: 'jwt-secret',
    SystemRoot: 'C:\\Windows',
  };
  Object.defineProperty(env, 'LOCALAPPDATA', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'C:\\Users\\Example\\AppData\\Local';
    },
  });
  env[Symbol('SECRET')] = 'symbol-secret';

  const launchEnv = sanitizeLaunchEnvironment(env, userDataPath);
  assert.deepEqual(Object.keys(launchEnv).sort(), [
    'BUILDER_PACKAGED_CANARY',
    'BUILDER_PACKAGED_CANARY_USER_DATA_PATH',
    'PATH',
    'SystemRoot',
  ]);
  assert.equal(getterCalls, 0);
  assert.equal(Object.hasOwn(launchEnv, 'JWT_SECRET'), false);

  const identity = captureGuardedUserDataRoot(userDataPath, fsModule, osModule);
  assert.equal(identity.path, userDataPath);
  assert.throws(
    () => captureGuardedUserDataRoot(path.join(tempRoot, 'nested', `${PACKAGED_CANARY_USER_DATA_PREFIX}unit`), fsModule, osModule),
    (error) => error.code === 'canary_cleanup_failed',
  );
  assert.throws(
    () => captureGuardedUserDataRoot(path.join(tempRoot, 'wrong-prefix'), fsModule, osModule),
    (error) => error.code === 'canary_cleanup_failed',
  );
  state.stats.set(userDataPath, fakeDirectoryStat(1n, 11n, true));
  assert.throws(
    () => captureGuardedUserDataRoot(userDataPath, fsModule, osModule),
    (error) => error.code === 'canary_cleanup_failed',
  );
});

test('uses playwright-core injection, canary env, cleanup, and redacted output', async (t) => {
  const parsed = parseCanaryInput(input({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const page = new FakePage();
  const electron = fakeElectron(page);
  const { fsModule, osModule, removed, userDataPath } = guardedFixture();
  t.after(() => {
    delete globalThis.clawfabricBuilder;
  });

  const result = await runPackagedCanary(parsed, {
    argv: [],
    electron,
    env: {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      JWT_SECRET: 'do-not-inherit',
      PATH: 'C:\\Windows\\System32',
      PROVIDER_API_KEY: 'unrelated-provider-secret',
      SystemRoot: 'C:\\Windows',
    },
    fs: fsModule,
    os: osModule,
    userDataPath,
  });

  assert.equal(result.result_version, 'builder-packaged-canary-result.v1');
  assert.equal(result.safe_storage.credential_status, 'stored');
  assert.equal(result.project.revision, 1);
  assert.equal(result.project.restart_revision_unchanged, true);
  assert.equal(result.project.restart_generation_command_issued, false);
  assert.equal(result.preview.restart_srcdoc_unchanged, true);
  assert.equal(result.preview.first.sandbox, 'empty');
  assert.equal(result.preview.first.script_src, 'none');
  assert.equal(JSON.stringify(result).includes(parsed.provider.credential), false);
  assert.equal(JSON.stringify(result).includes(parsed.provider.model), false);
  assert.equal(JSON.stringify(result).includes(parsed.provider.base_url), false);
  assert.equal(JSON.stringify(result).includes(parsed.executable_path), false);
  assert.deepEqual(Object.keys(result.input).sort(), ['credential_source', 'idea_digest', 'schema_version']);
  assert.equal(electron.launches.length, 2);
  for (const launch of electron.launches) {
    assert.equal(launch.env.BUILDER_PACKAGED_CANARY, '1');
    assert.equal(launch.env.BUILDER_PACKAGED_CANARY_USER_DATA_PATH, userDataPath);
    assert.equal(Object.hasOwn(launch.env, 'JWT_SECRET'), false);
    assert.equal(Object.hasOwn(launch.env, 'PROVIDER_API_KEY'), false);
    assert.equal(Object.hasOwn(launch.env, 'PATH'), true);
  }
  const scopedLocators = page.events.filter((event) => event[0] === 'scopedLocator');
  assert.equal(scopedLocators.length, 1);
  assert.equal(scopedLocators[0][1], SELECTORS.projectCatalog);
  assert.equal(
    scopedLocators[0][2],
    'button[data-builder-project-id="builder-project:11111111-1111-4111-8111-111111111111"]',
  );
  const scopedTexts = page.events.filter((event) => event[0] === 'scopedText');
  assert.deepEqual(scopedTexts.map((event) => [event[2], event[3]]), [
    ['Focus timer', { exact: true }],
    ['A timer.', { exact: true }],
    ['Version 1', { exact: true }],
  ]);
  assert.deepEqual(removed, [userDataPath]);
});

test('opens restart project with escaped project id selector and visible catalog facts', async () => {
  const page = new FakePage();
  await openProjectFromCatalogById(page, {
    project_id: 'builder-project:quote"slash\\line\nid',
    revision: 3,
    summary: 'Escaped selector summary.',
    title: 'Escaped selector title',
  });

  const scopedLocators = page.events.filter((event) => event[0] === 'scopedLocator');
  assert.equal(scopedLocators.length, 1);
  assert.equal(
    scopedLocators[0][2],
    'button[data-builder-project-id="builder-project:quote\\"slash\\\\line\\a id"]',
  );
  const scopedTexts = page.events.filter((event) => event[0] === 'scopedText');
  assert.deepEqual(scopedTexts.map((event) => [event[2], event[3]]), [
    ['Escaped selector title', { exact: true }],
    ['Escaped selector summary.', { exact: true }],
    ['Version 3', { exact: true }],
  ]);
  assert.deepEqual(page.events.filter((event) => event[0] === 'click').map((event) => event[1]), [
    `${SELECTORS.projectCatalog} button[data-builder-project-id="builder-project:quote\\"slash\\\\line\\a id"]`,
  ]);
});

test('normalizes setup failures before launch without leaking raw markers or proxy traps', async () => {
  const parsed = parseCanaryInput(input({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  let trapCalls = 0;
  const rawInput = new Proxy(parsed, {
    getOwnPropertyDescriptor() {
      trapCalls += 1;
      throw new Error('secret-marker');
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error('secret-marker');
    },
  });
  await assert.rejects(
    runPackagedCanary(rawInput, {}),
    (error) => error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_input_invalid'
      && error.stack === 'BuilderPackagedCanaryError: Packaged canary input is invalid.'
      && !error.message.includes('secret-marker'),
  );
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  const options = {};
  Object.defineProperty(options, 'fs', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('secret-marker');
    },
  });
  await assert.rejects(
    runPackagedCanary(parsed, options),
    (error) => error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_launch_failed'
      && error.stack === 'BuilderPackagedCanaryError: Packaged canary could not launch.'
      && !error.message.includes('secret-marker'),
  );
  assert.equal(getterCalls, 0);
});

test('normalizes injected fs setup failures while preserving guarded cleanup', async (t) => {
  const parsed = parseCanaryInput(input({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const page = new FakePage();
  const electron = fakeElectron(page);
  const { fsModule, osModule, removed, userDataPath } = guardedFixture();
  fsModule.existsSync = () => { throw new Error('secret-marker'); };
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await assert.rejects(
    runPackagedCanary(parsed, {
      argv: [],
      electron,
      env: {},
      fs: fsModule,
      os: osModule,
      userDataPath,
    }),
    (error) => error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_launch_failed'
      && error.stack === 'BuilderPackagedCanaryError: Packaged canary could not launch.'
      && !error.message.includes('secret-marker'),
  );
  assert.equal(electron.launches.length, 0);
  assert.deepEqual(removed, [userDataPath]);
});

test('cleanup attempts guarded remove when app close fails', async (t) => {
  const parsed = parseCanaryInput(input({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const page = new FakePage();
  const { fsModule, osModule, removed, userDataPath } = guardedFixture();
  const electron = {
    launches: [],
    async launch(options) {
      this.launches.push(options);
      return {
        async close() { throw new Error('close failed'); },
        async firstWindow() {
          page.evaluate = async (callback, argument) => bridgeEvidence(argument.projectId);
          page.artifactsAllowed = true;
          return page;
        },
      };
    },
  };
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await assert.rejects(
    runPackagedCanary(parsed, {
      argv: [],
      electron,
      env: {},
      fs: fsModule,
      os: osModule,
      userDataPath,
    }),
    (error) => error.code === 'canary_cleanup_failed',
  );
  assert.deepEqual(removed, [userDataPath]);
});

test('cleanup refuses user data replacement before recursive remove', async (t) => {
  const parsed = parseCanaryInput(input({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const page = new FakePage();
  const { fsModule, osModule, removed, state, userDataPath } = guardedFixture();
  let closeCount = 0;
  const electron = {
    launches: [],
    async launch(options) {
      this.launches.push(options);
      return {
        async close() {
          closeCount += 1;
          if (closeCount === 2) state.stats.set(userDataPath, fakeDirectoryStat(1n, 12n));
        },
        async firstWindow() {
          page.evaluate = async (callback, argument) => bridgeEvidence(argument.projectId);
          page.artifactsAllowed = true;
          return page;
        },
      };
    },
  };
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await assert.rejects(
    runPackagedCanary(parsed, {
      argv: [],
      electron,
      env: {},
      fs: fsModule,
      os: osModule,
      userDataPath,
    }),
    (error) => error.code === 'canary_cleanup_failed',
  );
  assert.deepEqual(removed, []);
});

test('bounds stdin and requires explicit CLI execute before launch', async () => {
  const overflowing = new PassThrough();
  const overflow = readStdin(overflowing, 4);
  overflowing.end('12345');
  await assert.rejects(
    overflow,
    (error) => error.code === 'canary_input_invalid',
  );

  let launches = 0;
  const stdout = { write() {} };
  await assert.rejects(
    runCli({
      argv: [],
      run() {
        launches += 1;
        return Promise.resolve({});
      },
      stdin: new PassThrough(),
      stdout,
    }),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.equal(launches, 0);
});

test('script source keeps credential out of argv/env/output and cannot enter ASAR authority', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  assert.match(source, /require\(['"]playwright-core['"]\)/u);
  assert.doesNotMatch(source, /require\(['"]playwright['"]\)/u);
  assert.doesNotMatch(source, /providerSettings\.replaceCurrent|codeGenerator\.generate|projectRevisions\.commit/u);
  assert.match(source, /clickByRole\(page,\s*['"]button['"],\s*['"]Save provider['"]\)/u);
  assert.match(source, /clickByRole\(page,\s*['"]button['"],\s*['"]Make it['"]\)/u);
  assert.match(source, /artifacts_after_password_clear/u);
});
