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
  assertCustomChromeControls,
  assertReadEvidence,
  capturePreviewEvidence,
  captureGuardedUserDataRoot,
  copySavedProviderProfile,
  createArtifactGate,
  ensureCredentialOnlyFromStdin,
  fillProviderSettingsViaUi,
  generateProjectViaUi,
  networkRecorder,
  openProjectFromCatalogById,
  parseCanaryInput,
  readStdin,
  readOnlyBridgeEvidence,
  readSanitizedBridgeEvidence,
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

function savedProfileInput(overrides = {}) {
  return JSON.stringify({
    executable_path: path.join(process.cwd(), 'release', 'win-unpacked', 'ClawFabric Builder.exe'),
    idea: 'Make a small focus timer.',
    mode: 'saved_profile',
    schema_version: CANARY_INPUT_VERSION,
    source_user_data_path: path.join(process.cwd(), 'source-profile'),
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
    if (this.page.failClicks.has(this.selector)) throw new Error('secret-marker');
  }

  async fill(value) {
    this.page.events.push(['fill', this.selector, value]);
    if (this.page.failFills.has(this.selector)) throw new Error('secret-marker');
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
    if (this.page.failPreviewAttributes) return 'unsafe';
    if (this.selector === SELECTORS.previewFrame && name === 'srcdoc') {
      return '<!doctype html><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><body><main>Focus timer preview</main></body>';
    }
    return null;
  }

  getByRole(role, options) {
    this.page.events.push(['scopedRole', this.selector, role, options]);
    return new FakeRole(this.page, role, options?.name ?? null);
  }

  getByText(text, options) {
    this.page.events.push(['scopedText', this.selector, text, options]);
    return new FakeText(this.page, text);
  }

  async inputValue() {
    if (this.page.keepPasswordValue && this.selector === SELECTORS.apiKey) return 'secret-marker';
    return this.page.values.get(this.selector) ?? '';
  }

  async screenshot() {
    if (!this.page.artifactsAllowed) throw new Error('artifact before password cleared');
    return pngFixture();
  }

  async waitFor(options) {
    this.page.events.push(['waitFor', this.selector, options?.state ?? null]);
    if (this.page.failWaitFor.has(this.selector)) throw new Error('secret-marker');
    if (this.selector === SELECTORS.preview && this.page.previewVisible === false) {
      return new Promise(() => {});
    }
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
    if (this.page.failRoleClicks.has(`${this.role}:${this.name}`)) throw new Error('secret-marker');
    if (this.name === 'Save provider') this.page.values.set(SELECTORS.apiKey, '');
  }

  async waitFor(options) {
    this.page.events.push(['roleWaitFor', this.role, this.name, options?.state ?? null]);
    if (this.role === 'alert' && this.page.alertVisible === true) return;
    if (this.role === 'alert' && this.page.failAlertWait === true) throw new Error('secret-marker');
    if (this.role !== 'alert') {
      if (this.page.failRoleWaits.has(`${this.role}:${this.name}`)) throw new Error('secret-marker');
      return;
    }
    return new Promise(() => {});
  }

  first() {
    this.page.events.push(['roleFirst', this.role, this.name]);
    return this;
  }

  async isEnabled() {
    this.page.events.push(['roleEnabled', this.role, this.name]);
    return !this.page.disabledRoles.has(`${this.role}:${this.name}`);
  }
}

class FakeText {
  constructor(page, text) {
    this.page = page;
    this.text = text;
  }

  async waitFor(options) {
    this.page.events.push(['textWaitFor', this.text, options?.state ?? null]);
    if (this.page.failTextWaitFor.has(this.text)) throw new Error('secret-marker');
  }
}

class FakePage {
  constructor() {
    this.artifactsAllowed = false;
    this.alertVisible = false;
    this.events = [];
    this.failAlertWait = false;
    this.failClicks = new Set();
    this.failFills = new Set();
    this.failPreviewAttributes = false;
    this.failRoleClicks = new Set();
    this.failRoleWaits = new Set();
    this.failTextWaitFor = new Set();
    this.failWaitFor = new Set();
    this.disabledRoles = new Set();
    this.keepPasswordValue = false;
    this.previewVisible = true;
    this.values = new Map();
    this.listeners = new Map();
  }

  emitRequest(url) {
    for (const listener of this.listeners.get('request') ?? []) listener({ url: () => url });
  }

  getByRole(role, options) {
    return new FakeRole(this, role, options?.name ?? null);
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
  const fake = {
    appEvents: [],
    launches: [],
    async launch(options) {
      fake.launches.push(options);
      const requestListeners = [];
      return {
        context: () => {
          fake.appEvents.push(['context']);
          return {
            on: (event, listener) => {
              fake.appEvents.push(['contextOn', event]);
              if (event === 'request') requestListeners.push(listener);
            },
          };
        },
        async close() {},
        emitRequest(url) {
          for (const listener of requestListeners) listener({ url: () => url });
        },
        async firstWindow() {
          fake.appEvents.push(['firstWindow']);
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
  return fake;
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

function fakeStat(dev, ino, {
  directory = true,
  mtimeMs = 1,
  size = 64n,
  symbolic = false,
} = {}) {
  return {
    dev,
    ino,
    mtimeMs,
    size,
    isDirectory() { return directory; },
    isFile() { return !directory; },
    isSymbolicLink() { return symbolic; },
  };
}

function fakeDirectoryStat(dev, ino, symbolic = false) {
  return fakeStat(dev, ino, { directory: true, symbolic });
}

function fakeFileStat(dev, ino, size = 64n, symbolic = false, mtimeMs = 1) {
  return fakeStat(dev, ino, { directory: false, mtimeMs, size, symbolic });
}

function fakeDirent(name, file = true) {
  return {
    name,
    isFile() { return file; },
  };
}

function guardedFixture() {
  const tempRoot = path.join(process.cwd(), 'canary-temp');
  const userDataPath = path.join(tempRoot, `${PACKAGED_CANARY_USER_DATA_PREFIX}unit`);
  const state = {
    directories: new Map(),
    files: new Map(),
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
  const copied = [];
  const descriptors = new Map();
  let nextFd = 100;
  function statForFile(target, buffer) {
    const existing = state.stats.get(target);
    if (existing) return fakeFileStat(existing.dev, existing.ino, BigInt(buffer.length), false, existing.mtimeMs);
    return fakeFileStat(1n, BigInt(200 + state.stats.size), BigInt(buffer.length));
  }
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
    closeSync(fd) {
      const descriptor = descriptors.get(fd);
      if (!descriptor) throw new Error('bad fd');
      if (descriptor.flags === 'wx') {
        const body = Buffer.concat(descriptor.chunks);
        state.files.set(descriptor.path, body);
        state.stats.set(descriptor.path, statForFile(descriptor.path, body));
        state.realpath.set(descriptor.path, descriptor.path);
        const source = Array.from(state.files.entries())
          .find(([candidate, candidateBody]) => candidate !== descriptor.path && candidateBody.equals(body))?.[0]
          ?? descriptor.path;
        copied.push([source, descriptor.path]);
      }
      descriptors.delete(fd);
    },
    fstatSync(fd) {
      const descriptor = descriptors.get(fd);
      if (!descriptor) throw new Error('bad fd');
      if (descriptor.flags === 'wx') {
        const body = Buffer.concat(descriptor.chunks);
        return statForFile(descriptor.path, body);
      }
      return fsModule.lstatSync(descriptor.path);
    },
    fsyncSync(fd) {
      if (!descriptors.has(fd)) throw new Error('bad fd');
    },
    mkdtempSync(prefix) {
      assert.equal(prefix, path.join(tempRoot, PACKAGED_CANARY_USER_DATA_PREFIX));
      return userDataPath;
    },
    mkdirSync(target) {
      if (state.stats.has(target)) throw new Error('exists');
      state.stats.set(target, fakeDirectoryStat(1n, BigInt(20 + state.stats.size)));
      state.realpath.set(target, target);
      state.directories.set(target, []);
    },
    openSync(target, flags) {
      if (flags === 'r') {
        if (!state.stats.has(target) || !state.files.has(target)) throw new Error('missing file');
        const fd = nextFd;
        nextFd += 1;
        descriptors.set(fd, { flags, path: target, position: 0 });
        return fd;
      }
      if (flags === 'wx') {
        if (state.stats.has(target) || state.files.has(target)) throw new Error('exists');
        const fd = nextFd;
        nextFd += 1;
        descriptors.set(fd, { chunks: [], flags, path: target });
        return fd;
      }
      throw new Error('bad flags');
    },
    readSync(fd, buffer, offset, length, position) {
      const descriptor = descriptors.get(fd);
      if (!descriptor || descriptor.flags !== 'r') throw new Error('bad fd');
      const body = state.files.get(descriptor.path);
      const start = position === null ? descriptor.position : position;
      const slice = body.subarray(start, start + length);
      slice.copy(buffer, offset);
      if (position === null) descriptor.position += slice.length;
      return slice.length;
    },
    readdirSync(target) {
      const entries = state.directories.get(target);
      if (!entries) throw new Error('missing directory');
      return entries;
    },
    realpathSync: {
      native(target) {
        const real = state.realpath.get(target);
        if (!real) throw new Error('realpath failed');
        return real;
      },
    },
    rmSync(target) { removed.push(target); },
    writeSync(fd, buffer, offset, length) {
      const descriptor = descriptors.get(fd);
      if (!descriptor || descriptor.flags !== 'wx') throw new Error('bad fd');
      descriptor.chunks.push(Buffer.from(buffer.subarray(offset, offset + length)));
      return length;
    },
  };
  return {
    fsModule,
    osModule: { tmpdir: () => tempRoot },
    copied,
    removed,
    state,
    tempRoot,
    userDataPath,
  };
}

function savedProfileFixture() {
  const fixture = guardedFixture();
  const sourceRoot = path.join(process.cwd(), 'source-profile');
  const configDir = path.join(sourceRoot, 'builder-provider-config-v1');
  const secretsDir = path.join(sourceRoot, 'builder-provider-secrets-v1');
  const localState = path.join(sourceRoot, 'Local State');
  const current = path.join(configDir, 'current.json');
  const secretName = `${'a'.repeat(64)}.json`;
  const secret = path.join(secretsDir, secretName);
  fixture.state.realpath.set(sourceRoot, sourceRoot);
  fixture.state.realpath.set(configDir, configDir);
  fixture.state.realpath.set(secretsDir, secretsDir);
  fixture.state.realpath.set(localState, localState);
  fixture.state.realpath.set(current, current);
  fixture.state.realpath.set(secret, secret);
  fixture.state.stats.set(sourceRoot, fakeDirectoryStat(2n, 100n));
  fixture.state.stats.set(configDir, fakeDirectoryStat(2n, 101n));
  fixture.state.stats.set(secretsDir, fakeDirectoryStat(2n, 102n));
  fixture.state.stats.set(localState, fakeFileStat(2n, 103n, 512n));
  fixture.state.stats.set(current, fakeFileStat(2n, 104n, 256n));
  fixture.state.stats.set(secret, fakeFileStat(2n, 105n, 512n));
  fixture.state.files.set(localState, Buffer.alloc(512, 'l'));
  fixture.state.files.set(current, Buffer.alloc(256, 'c'));
  fixture.state.files.set(secret, Buffer.alloc(512, 's'));
  fixture.state.directories.set(configDir, [fakeDirent('current.json')]);
  fixture.state.directories.set(secretsDir, [fakeDirent(secretName)]);
  return {
    ...fixture,
    current,
    localState,
    secret,
    secretName,
    secretsDir,
    sourceRoot,
  };
}

function assertFixedCanaryError(error, code, stage) {
  assert.equal(error instanceof BuilderPackagedCanaryError, true);
  assert.equal(error.code, code);
  assert.equal(error.stage, stage);
  assert.equal(error.stack, `BuilderPackagedCanaryError: ${error.message}`);
  assert.equal(error.message.includes('secret-marker'), false);
  assert.equal(error.message.includes('provider.example'), false);
  assert.equal(error.message.includes('builder-model'), false);
  assert.equal(error.message.includes('real-key-value-secret'), false);
}

test('parses exact stdin input and rejects credential in argv or env', () => {
  const parsed = parseCanaryInput(input());
  assert.equal(parsed.schema_version, CANARY_INPUT_VERSION);
  assert.equal(Object.hasOwn(parsed, 'mode'), false);
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

test('parses exact saved-profile input without accepting provider material', () => {
  const parsed = parseCanaryInput(savedProfileInput());
  assert.equal(parsed.mode, 'saved_profile');
  assert.equal(parsed.schema_version, CANARY_INPUT_VERSION);
  assert.equal(Object.hasOwn(parsed, 'provider'), false);
  assert.equal(path.isAbsolute(parsed.source_user_data_path), true);
  assert.throws(
    () => parseCanaryInput(savedProfileInput({ provider: { credential: 'secret' } })),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.throws(
    () => parseCanaryInput(savedProfileInput({ source_user_data_path: 'relative-profile' })),
    (error) => error.code === 'canary_input_invalid',
  );
  for (const blockedPath of [
    '\\\\server\\share\\profile',
    '\\\\?\\C:\\Users\\Example\\Profile',
    '\\\\.\\C:\\Users\\Example\\Profile',
  ]) {
    assert.throws(
      () => parseCanaryInput(savedProfileInput({ source_user_data_path: blockedPath })),
      (error) => error.code === 'canary_input_invalid',
    );
  }
  assert.throws(
    () => parseCanaryInput(input({ mode: 'first_config' })),
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

test('observes custom chrome controls without clicking window actions', async () => {
  const page = new FakePage();
  const evidence = await assertCustomChromeControls(page);
  assert.deepEqual(evidence, {
    close_enabled: true,
    maximize_or_restore_enabled: true,
    minimize_enabled: true,
    window_controls_enabled: true,
  });
  assert.deepEqual(page.events.filter((event) => event[0] === 'roleWaitFor').map((event) => event[2]), [
    'Minimize window',
    /^(?:Maximize|Restore) window$/u,
    'Close window',
  ]);
  assert.deepEqual(page.events.filter((event) => event[0] === 'roleClick'), []);
  assert.deepEqual(page.events.filter((event) => event[0] === 'roleEnabled').map((event) => event[2]), [
    'Minimize window',
    /^(?:Maximize|Restore) window$/u,
    'Close window',
  ]);
  page.disabledRoles.add('button:Close window');
  await assert.rejects(
    assertCustomChromeControls(page),
    (error) => error.code === 'canary_custom_chrome_failed',
  );
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

test('reports fixed redacted UI stages without raw provider, prompt, or DOM details', async () => {
  const provider = parseCanaryInput(input()).provider;
  const stages = [
    {
      code: 'canary_settings_navigation_failed',
      run: async () => {
        const page = new FakePage();
        page.failRoleClicks.add('button:Settings');
        await fillProviderSettingsViaUi(page, provider, createArtifactGate());
      },
      stage: 'settings_navigation',
    },
    {
      code: 'canary_settings_panel_failed',
      run: async () => {
        const page = new FakePage();
        page.failWaitFor.add(SELECTORS.providerPanel);
        await fillProviderSettingsViaUi(page, provider, createArtifactGate());
      },
      stage: 'settings_panel',
    },
    {
      code: 'canary_settings_save_failed',
      run: async () => {
        const page = new FakePage();
        page.keepPasswordValue = true;
        await fillProviderSettingsViaUi(page, provider, createArtifactGate());
      },
      stage: 'settings_save',
    },
    {
      code: 'canary_new_project_failed',
      run: async () => {
        const page = new FakePage();
        page.failWaitFor.add(SELECTORS.projectPage);
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'new_project',
    },
    {
      code: 'canary_generation_terminal_failed',
      run: async () => {
        const page = new FakePage();
        page.alertVisible = true;
        page.previewVisible = false;
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'generation_terminal',
    },
    {
      code: 'canary_preview_failed',
      run: async () => {
        const page = new FakePage();
        page.failAlertWait = true;
        page.failWaitFor.add(SELECTORS.preview);
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'preview',
    },
    {
      code: 'canary_version_failed',
      run: async () => {
        const page = new FakePage();
        page.failTextWaitFor.add('Version 1');
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'version',
    },
    {
      code: 'canary_preview_failed',
      run: async () => {
        const page = new FakePage();
        page.failPreviewAttributes = true;
        const gate = createArtifactGate();
        gate.allow();
        await capturePreviewEvidence(page, gate);
      },
      stage: 'preview',
    },
    {
      code: 'canary_read_evidence_failed',
      run: async () => {
        const page = new FakePage();
        page.evaluate = async () => { throw new Error('secret-marker'); };
        await readSanitizedBridgeEvidence(page);
      },
      stage: 'read_evidence',
    },
    {
      code: 'canary_restart_failed',
      run: async () => {
        const page = new FakePage();
        page.failWaitFor.add(SELECTORS.projectCatalog);
        await openProjectFromCatalogById(page, {
          project_id: 'builder-project:11111111-1111-4111-8111-111111111111',
          revision: 1,
          summary: 'A timer.',
          title: 'Focus timer',
        });
      },
      stage: 'restart',
    },
  ];

  for (const item of stages) {
    await assert.rejects(item.run(), (error) => {
      assertFixedCanaryError(error, item.code, item.stage);
      return true;
    });
  }
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
  const app = {
    context() {
      return {
        on(event, listener) {
          page.on(event, listener);
        },
      };
    },
  };
  assert.equal(recorder.attachApplication(app), true);
  page.emitRequest('file:///app/index.html');
  page.emitRequest('https://provider.example/v1/chat/completions');
  page.emitRequest('https://unexpected.example/script.js');
  assert.deepEqual(recorder.snapshot(), {
    application_observer_count: 1,
    unexpected_network_count: 2,
  });
  const fallback = networkRecorder();
  fallback.attachPage(page);
  page.emitRequest('wss://unexpected.example/socket');
  assert.deepEqual(fallback.snapshot(), {
    application_observer_count: 0,
    unexpected_network_count: 1,
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
  assert.equal(result.project.restart_new_revision_observed, false);
  assert.equal(result.preview.restart_srcdoc_unchanged, true);
  assert.equal(result.preview.first.sandbox, 'empty');
  assert.equal(result.preview.first.script_src, 'none');
  assert.equal(JSON.stringify(result).includes(parsed.provider.credential), false);
  assert.equal(JSON.stringify(result).includes(parsed.provider.model), false);
  assert.equal(JSON.stringify(result).includes(parsed.provider.base_url), false);
  assert.equal(JSON.stringify(result).includes(parsed.executable_path), false);
  assert.deepEqual(Object.keys(result.input).sort(), ['credential_source', 'idea_digest', 'schema_version']);
  assert.equal(electron.launches.length, 2);
  assert.deepEqual(electron.appEvents, [
    ['context'],
    ['contextOn', 'request'],
    ['firstWindow'],
    ['context'],
    ['contextOn', 'request'],
    ['firstWindow'],
  ]);
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
    ['Version 1', { exact: true }],
    ['Focus timer', { exact: true }],
    ['A timer.', { exact: true }],
    ['Version 1', { exact: true }],
    ['Version 1', { exact: true }],
  ]);
  assert.deepEqual(removed, [userDataPath]);
});

test('copies only saved provider profile files and runs without provider input or settings writes', async (t) => {
  const parsed = parseCanaryInput(savedProfileInput({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const page = new FakePage();
  const electron = fakeElectron(page);
  const {
    copied,
    current,
    fsModule,
    localState,
    osModule,
    removed,
    secret,
    secretName,
    userDataPath,
  } = savedProfileFixture();
  fsModule.copyFileSync = () => {
    throw new Error('copyFileSync must not be used');
  };
  t.after(() => {
    delete globalThis.clawfabricBuilder;
  });

  const result = await runPackagedCanary(parsed, {
    argv: [],
    electron,
    env: {
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
  assert.deepEqual(result.input, {
    credential_source: 'saved_profile',
    idea_digest: result.input.idea_digest,
    schema_version: CANARY_INPUT_VERSION,
  });
  assert.equal(result.user_data.temporary, true);
  assert.equal(result.user_data.source_profile_unchanged, true);
  assert.equal(result.custom_chrome.window_controls_enabled, true);
  assert.equal(result.safe_storage.configured, true);
  assert.equal(result.safe_storage.credential_status, 'stored');
  assert.equal(result.project.restart_revision_unchanged, true);
  assert.equal(result.project.restart_new_revision_observed, false);
  assert.equal(result.preview.restart_srcdoc_unchanged, true);
  assert.deepEqual(copied.map(([source, target]) => [
    path.relative(parsed.source_user_data_path, source),
    path.relative(userDataPath, target),
  ]), [
    ['Local State', 'Local State'],
    ['Local State', path.join('session-data', 'Local State')],
    [path.join('builder-provider-config-v1', 'current.json'), path.join('builder-provider-config-v1', 'current.json')],
    [path.join('builder-provider-secrets-v1', secretName), path.join('builder-provider-secrets-v1', secretName)],
  ]);
  assert.deepEqual(copied.map(([source]) => source), [localState, localState, current, secret]);
  const roleClicks = page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]);
  assert.deepEqual(roleClicks, ['New project', 'Make it']);
  assert.equal(roleClicks.includes('Settings'), false);
  assert.equal(roleClicks.includes('Save provider'), false);
  assert.equal(page.events.some((event) => event[0] === 'fill' && event[1] === SELECTORS.apiKey), false);
  assert.equal(electron.launches.length, 2);
  assert.deepEqual(electron.appEvents, [
    ['context'],
    ['contextOn', 'request'],
    ['firstWindow'],
    ['context'],
    ['contextOn', 'request'],
    ['firstWindow'],
  ]);
  assert.deepEqual(removed, [userDataPath]);
  const packet = JSON.stringify(result);
  for (const forbidden of [
    parsed.source_user_data_path,
    userDataPath,
    'provider.example',
    'builder-model',
    'real-key-value-secret',
    'Local State',
    'builder-provider-config-v1',
    'builder-provider-secrets-v1',
    secretName,
  ]) {
    assert.equal(packet.includes(forbidden), false, forbidden);
  }
});

test('copies saved provider files through the guarded canonical target path', () => {
  const parsed = parseCanaryInput(savedProfileInput({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const fixture = savedProfileFixture();
  const canonicalTempRoot = `${fixture.tempRoot}-canonical`;
  const canonicalUserDataPath = path.join(canonicalTempRoot, path.basename(fixture.userDataPath));
  fixture.state.realpath.set(fixture.tempRoot, canonicalTempRoot);
  fixture.state.realpath.set(fixture.userDataPath, canonicalUserDataPath);
  fixture.state.realpath.set(canonicalUserDataPath, canonicalUserDataPath);
  fixture.state.stats.set(canonicalUserDataPath, fixture.state.stats.get(fixture.userDataPath));

  const guardedRoot = captureGuardedUserDataRoot(fixture.userDataPath, fixture.fsModule, fixture.osModule);
  const savedProfile = copySavedProviderProfile(parsed, guardedRoot, fixture.fsModule);

  assert.equal(savedProfile.sourceRoot.path, parsed.source_user_data_path);
  assert.deepEqual(fixture.copied.map(([, target]) => path.relative(canonicalUserDataPath, target)), [
    'Local State',
    path.join('session-data', 'Local State'),
    path.join('builder-provider-config-v1', 'current.json'),
    path.join('builder-provider-secrets-v1', fixture.secretName),
  ]);
});

test('rejects saved profile target directory replacement before descriptor writes', async (t) => {
  const parsed = parseCanaryInput(savedProfileInput({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const cases = [
    {
      name: 'target root identity drift',
      pathFor(fixture) { return fixture.userDataPath; },
      driftAt: 3,
      drift(stat) {
        return fakeDirectoryStat(stat.dev, 999n);
      },
      forbiddenTargets(fixture) {
        return [
          path.join(fixture.userDataPath, 'Local State'),
          path.join(fixture.userDataPath, 'builder-provider-config-v1', 'current.json'),
          path.join(fixture.userDataPath, 'builder-provider-secrets-v1', fixture.secretName),
        ];
      },
    },
    {
      name: 'target config symlink',
      pathFor(fixture) {
        return path.join(fixture.userDataPath, 'builder-provider-config-v1');
      },
      driftAt: 2,
      drift(stat) {
        return fakeDirectoryStat(stat.dev, stat.ino, true);
      },
      forbiddenTargets(fixture) {
        return [
          path.join(fixture.userDataPath, 'builder-provider-config-v1', 'current.json'),
          path.join(fixture.userDataPath, 'builder-provider-secrets-v1', fixture.secretName),
        ];
      },
    },
    {
      name: 'target session data symlink',
      pathFor(fixture) {
        return path.join(fixture.userDataPath, 'session-data');
      },
      driftAt: 2,
      drift(stat) {
        return fakeDirectoryStat(stat.dev, stat.ino, true);
      },
      forbiddenTargets(fixture) {
        return [path.join(fixture.userDataPath, 'session-data', 'Local State')];
      },
    },
    {
      name: 'target secrets realpath drift',
      pathFor(fixture) {
        return path.join(fixture.userDataPath, 'builder-provider-secrets-v1');
      },
      driftAt: 2,
      drift(stat, fixture, target) {
        fixture.state.realpath.set(target, path.join(fixture.tempRoot, 'replacement'));
        return stat;
      },
      forbiddenTargets(fixture) {
        return [path.join(fixture.userDataPath, 'builder-provider-secrets-v1', fixture.secretName)];
      },
    },
  ];

  for (const item of cases) {
    const page = new FakePage();
    const electron = fakeElectron(page);
    const fixture = savedProfileFixture();
    const target = item.pathFor(fixture);
    const originalLstat = fixture.fsModule.lstatSync;
    let seen = 0;
    fixture.fsModule.lstatSync = (candidate) => {
      const stat = originalLstat(candidate);
      if (candidate === target) {
        seen += 1;
        if (seen === item.driftAt) return item.drift(stat, fixture, target);
      }
      return stat;
    };
    t.after(() => {
      delete globalThis.clawfabricBuilder;
    });

    await assert.rejects(
      runPackagedCanary(parsed, {
        argv: [],
        electron,
        env: {},
        fs: fixture.fsModule,
        os: fixture.osModule,
        userDataPath: fixture.userDataPath,
      }),
      (error) => error instanceof BuilderPackagedCanaryError
        && error.code === 'canary_saved_profile_failed'
        && error.stage === 'saved_profile'
        && !error.message.includes(item.name),
    );
    assert.equal(electron.launches.length, 0);
    for (const forbiddenTarget of item.forbiddenTargets(fixture)) {
      assert.equal(fixture.state.files.has(forbiddenTarget), false, forbiddenTarget);
    }
    assert.deepEqual(fixture.removed, [fixture.userDataPath]);
  }
});

test('rechecks saved profile target directory immediately before exclusive file create', async (t) => {
  const parsed = parseCanaryInput(savedProfileInput({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const page = new FakePage();
  const electron = fakeElectron(page);
  const fixture = savedProfileFixture();
  const targetConfigDirectory = path.join(fixture.userDataPath, 'builder-provider-config-v1');
  const targetCurrent = path.join(targetConfigDirectory, 'current.json');
  const originalOpen = fixture.fsModule.openSync;
  fixture.fsModule.openSync = (target, flags) => {
    const fd = originalOpen(target, flags);
    if (target === fixture.current && flags === 'r') {
      fixture.state.stats.set(targetConfigDirectory, fakeDirectoryStat(1n, 999n, true));
    }
    return fd;
  };
  t.after(() => {
    delete globalThis.clawfabricBuilder;
  });

  await assert.rejects(
    runPackagedCanary(parsed, {
      argv: [],
      electron,
      env: {},
      fs: fixture.fsModule,
      os: fixture.osModule,
      userDataPath: fixture.userDataPath,
    }),
    (error) => error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_saved_profile_failed'
      && error.stage === 'saved_profile',
  );
  assert.equal(electron.launches.length, 0);
  assert.equal(fixture.state.files.has(targetCurrent), false);
  assert.deepEqual(fixture.removed, [fixture.userDataPath]);
});

test('opens restart project only for canonical project id selectors and visible catalog facts', async () => {
  const page = new FakePage();
  await openProjectFromCatalogById(page, {
    project_id: 'builder-project:11111111-1111-4111-8111-111111111111',
    revision: 1,
    summary: 'A timer.',
    title: 'Focus timer',
  });

  const scopedLocators = page.events.filter((event) => event[0] === 'scopedLocator');
  assert.equal(scopedLocators.length, 1);
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
  assert.deepEqual(page.events.filter((event) => event[0] === 'click').map((event) => event[1]), [
    `${SELECTORS.projectCatalog} button[data-builder-project-id="builder-project:11111111-1111-4111-8111-111111111111"]`,
  ]);

  const forged = bridgeEvidence('builder-project:11111111-1111-4111-8111-111111111111');
  forged.catalog.projects[0].project_id = 'builder-project:quote"slash\\line\nid';
  assert.throws(
    () => assertReadEvidence(forged),
    (error) => error.code === 'canary_evidence_failed',
  );
});

test('rejects malformed saved profile file sets before launch and still cleans temp profile', async (t) => {
  const cases = [
    {
      name: 'missing Local State',
      mutate(fixture) {
        fixture.state.stats.delete(fixture.localState);
      },
    },
    {
      name: 'extra config file',
      mutate(fixture) {
        const configDir = path.join(fixture.sourceRoot, 'builder-provider-config-v1');
        fixture.state.directories.set(configDir, [fakeDirent('current.json'), fakeDirent('extra.json')]);
      },
    },
    {
      name: 'non-json secret',
      mutate(fixture) {
        fixture.state.directories.set(fixture.secretsDir, [fakeDirent('not-json.txt')]);
      },
    },
    {
      name: 'secret bound exceeded',
      mutate(fixture) {
        fixture.state.stats.set(fixture.secret, fakeFileStat(2n, 105n, 65n * 1024n));
      },
    },
    {
      name: 'source symlink',
      mutate(fixture) {
        fixture.state.stats.set(fixture.sourceRoot, fakeDirectoryStat(2n, 100n, true));
      },
    },
  ];
  for (const item of cases) {
    const parsed = parseCanaryInput(savedProfileInput({ executable_path: path.join(process.cwd(), 'fake.exe') }));
    const page = new FakePage();
    const electron = fakeElectron(page);
    const fixture = savedProfileFixture();
    item.mutate(fixture);
    t.after(() => {
      delete globalThis.clawfabricBuilder;
    });
    await assert.rejects(
      runPackagedCanary(parsed, {
        argv: [],
        electron,
        env: {},
        fs: fixture.fsModule,
        os: fixture.osModule,
        userDataPath: fixture.userDataPath,
      }),
      (error) => error instanceof BuilderPackagedCanaryError
        && error.code === 'canary_saved_profile_failed'
        && error.stage === 'saved_profile'
        && !error.message.includes(item.name),
    );
    assert.equal(electron.launches.length, 0);
    assert.deepEqual(fixture.removed, [fixture.userDataPath]);
  }
});

test('detects saved profile mutation without leaking source details and still removes temp profile', async (t) => {
  const parsed = parseCanaryInput(savedProfileInput({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const cases = [
    {
      name: 'size change',
      mutate(fixture) {
        fixture.state.stats.set(fixture.current, fakeFileStat(2n, 104n, 257n));
        fixture.state.files.set(fixture.current, Buffer.alloc(257, 'c'));
      },
    },
    {
      name: 'same-size content change',
      mutate(fixture) {
        fixture.state.files.set(fixture.current, Buffer.alloc(256, 'x'));
      },
    },
    {
      name: 'directory identity change',
      mutate(fixture) {
        fixture.state.stats.set(fixture.secretsDir, fakeDirectoryStat(2n, 999n));
      },
    },
  ];
  for (const item of cases) {
    const page = new FakePage();
    const electron = fakeElectron(page);
    const fixture = savedProfileFixture();
    const originalLaunch = electron.launch;
    electron.launch = async function launch(options) {
      const app = await originalLaunch.call(this, options);
      return {
        context: app.context,
        async close() {
          item.mutate(fixture);
          await app.close();
        },
        emitRequest: app.emitRequest,
        firstWindow: app.firstWindow,
      };
    };
    t.after(() => {
      delete globalThis.clawfabricBuilder;
    });

    await assert.rejects(
      runPackagedCanary(parsed, {
        argv: [],
        electron,
        env: {},
        fs: fixture.fsModule,
        os: fixture.osModule,
        userDataPath: fixture.userDataPath,
      }),
      (error) => error instanceof BuilderPackagedCanaryError
        && error.code === 'canary_saved_profile_failed'
        && error.stack === 'BuilderPackagedCanaryError: Packaged canary saved profile setup failed.'
        && !error.message.includes(fixture.sourceRoot)
        && !error.message.includes(item.name),
    );
    assert.deepEqual(fixture.removed, [fixture.userDataPath]);
  }
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

test('cleans direct mkdtemp path when guarded root capture fails before identity exists', async () => {
  const parsed = parseCanaryInput(input({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const { fsModule, osModule, removed, userDataPath } = guardedFixture();
  let realpathCalls = 0;
  fsModule.realpathSync.native = (target) => {
    realpathCalls += 1;
    if (target === userDataPath) throw new Error('secret-marker');
    return target;
  };

  await assert.rejects(
    runPackagedCanary(parsed, {
      argv: [],
      electron: fakeElectron(new FakePage()),
      env: {},
      fs: fsModule,
      os: osModule,
    }),
    (error) => error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_cleanup_failed'
      && !error.message.includes('secret-marker'),
  );
  assert.equal(realpathCalls >= 1, true);
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
