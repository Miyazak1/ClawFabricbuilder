'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  CANARY_INPUT_VERSION,
  CANARY_RESULT_VERSION,
} = require('../scripts/verify-packaged-canary.cjs');
const {
  DEEPSEEK_CANARY_IDEA,
  DEEPSEEK_CANARY_INPUT_VERSION,
  DEEPSEEK_V4_BASE_URL,
  DEEPSEEK_V4_MODELS,
  inspectSavedProfileDeepSeekConfig,
  parseDeepSeekCanaryInput,
  runCli,
  runDeepSeekPackagedCanary,
  sanitizeDeepSeekCanaryInput,
  toPackagedCanaryInput,
} = require('../scripts/verify-deepseek-packaged-canary.cjs');

const root = path.join(__dirname, '..');
const SOURCE_PATH = path.join(root, 'scripts', 'verify-deepseek-packaged-canary.cjs');
const PACKAGE_PATH = path.join(root, 'package.json');

function input(overrides = {}) {
  return JSON.stringify({
    credential: 'real-deepseek-v4-key',
    executable_path: path.join(process.cwd(), 'release', 'win-unpacked', 'ClawFabric Builder.exe'),
    mode: 'first_config',
    model: 'deepseek-v4-flash',
    schema_version: DEEPSEEK_CANARY_INPUT_VERSION,
    ...overrides,
  });
}

function savedProfileInput(overrides = {}) {
  return JSON.stringify({
    executable_path: path.join(process.cwd(), 'release', 'win-unpacked', 'ClawFabric Builder.exe'),
    mode: 'saved_profile',
    schema_version: DEEPSEEK_CANARY_INPUT_VERSION,
    source_user_data_path: path.join(process.cwd(), 'source-profile'),
    ...overrides,
  });
}

function passThroughWith(value) {
  const stream = new PassThrough();
  stream.end(value);
  return stream;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digestCanonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function secretRef() {
  return {
    ref_version: 'builder-provider-secret-ref.v1',
    provider_id: 'builder-default',
    secret_id: 'builder-provider-secret:default',
  };
}

function currentProfileEnvelope(overrides = {}) {
  const configBody = {
    config_version: 'builder-provider-config.v1',
    provider_id: 'builder-default',
    base_url: overrides.base_url ?? DEEPSEEK_V4_BASE_URL,
    model: overrides.model ?? 'deepseek-v4-flash',
    timeout_ms: 120000,
    temperature: 0.2,
    max_tokens: 8192,
    secret_ref: secretRef(),
  };
  const config = {
    ...configBody,
    config_digest: digestCanonical(configBody),
  };
  const secretBinding = {
    binding_version: 'builder-provider-secret-binding.v1',
    secret_ref: secretRef(),
    encrypted_secret_digest: `sha256:${'a'.repeat(64)}`,
    secret_store_version: 'builder-provider-secret-store.v1',
  };
  const body = {
    repository_version: 'builder-provider-config-repository.v1',
    config,
    secret_binding: secretBinding,
  };
  return {
    ...body,
    repository_digest: digestCanonical(body),
  };
}

function refreshRepositoryDigest(envelope) {
  envelope.repository_digest = digestCanonical({
    repository_version: envelope.repository_version,
    config: envelope.config,
    secret_binding: envelope.secret_binding,
  });
}

function savedProfileRoot(t, overrides = {}) {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-deepseek-profile-'));
  t.after(() => fs.rmSync(rootPath, { recursive: true, force: true }));
  const configDir = path.join(rootPath, 'builder-provider-config-v1');
  fs.mkdirSync(configDir, { recursive: true });
  const envelope = currentProfileEnvelope(overrides);
  if (typeof overrides.mutateEnvelope === 'function') overrides.mutateEnvelope(envelope);
  fs.writeFileSync(
    path.join(configDir, 'current.json'),
    overrides.currentJson ?? `${canonicalJson(envelope)}\n`,
    'utf8',
  );
  return rootPath;
}

function fakeDirectoryStat({ dev = 1n, ino = 1n, symbolicLink = false } = {}) {
  return Object.freeze({
    dev,
    ino,
    isDirectory: () => true,
    isSymbolicLink: () => symbolicLink,
  });
}

function assertSavedProfileFailure(fn, forbidden = []) {
  assert.throws(
    fn,
    (error) => error.code === 'canary_saved_profile_failed'
      && error.stage === 'saved_profile'
      && forbidden.every((value) => !error.message.includes(value)),
  );
}

test('builds a first-config packaged canary input for official DeepSeek V4 only', () => {
  const parsed = parseDeepSeekCanaryInput(input());
  const packaged = toPackagedCanaryInput(parsed);

  assert.equal(parsed.mode, 'first_config');
  assert.equal(parsed.schema_version, DEEPSEEK_CANARY_INPUT_VERSION);
  assert.equal(packaged.schema_version, CANARY_INPUT_VERSION);
  assert.equal(packaged.executable_path, parsed.executable_path);
  assert.equal(packaged.idea, DEEPSEEK_CANARY_IDEA);
  assert.deepEqual(packaged.provider, {
    base_url: DEEPSEEK_V4_BASE_URL,
    credential: 'real-deepseek-v4-key',
    max_tokens: 8192,
    model: 'deepseek-v4-flash',
    temperature: 0.2,
    timeout_ms: 120000,
  });
  assert.deepEqual(DEEPSEEK_V4_MODELS, ['deepseek-v4-flash', 'deepseek-v4-pro']);
});

test('builds a saved-profile packaged canary input after verifying stored DeepSeek V4 config', (t) => {
  const sourceRoot = savedProfileRoot(t, {
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
  });
  const parsed = parseDeepSeekCanaryInput(savedProfileInput({ source_user_data_path: sourceRoot }));
  const packaged = toPackagedCanaryInput(parsed);

  assert.equal(parsed.mode, 'saved_profile');
  assert.equal(Object.hasOwn(parsed, 'credential'), false);
  assert.deepEqual(inspectSavedProfileDeepSeekConfig(sourceRoot), {
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    profile_config_verified: true,
  });
  assert.deepEqual(packaged, {
    executable_path: parsed.executable_path,
    idea: DEEPSEEK_CANARY_IDEA,
    mode: 'saved_profile',
    schema_version: CANARY_INPUT_VERSION,
    source_user_data_path: sourceRoot,
  });
});

test('rejects non-v4 models, endpoint overrides, extras, accessors, and proxy input', (t) => {
  assert.throws(
    () => parseDeepSeekCanaryInput(input({ model: 'deepseek-chat' })),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.throws(
    () => parseDeepSeekCanaryInput(input({ base_url: 'https://proxy.example/v1' })),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.throws(
    () => parseDeepSeekCanaryInput(input({ credential: ' key' })),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.throws(
    () => parseDeepSeekCanaryInput(savedProfileInput({ credential: 'secret' })),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.throws(
    () => parseDeepSeekCanaryInput(savedProfileInput({ model: 'deepseek-v4-flash' })),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.throws(
    () => parseDeepSeekCanaryInput(savedProfileInput({ source_user_data_path: 'relative-profile' })),
    (error) => error.code === 'canary_input_invalid',
  );

  const accessor = JSON.parse(input());
  Object.defineProperty(accessor, 'credential', {
    enumerable: true,
    get() {
      throw new Error('private-marker');
    },
  });
  assert.throws(
    () => sanitizeDeepSeekCanaryInput(accessor),
    (error) => error.code === 'canary_input_invalid'
      && !error.message.includes('private-marker'),
  );
  assert.throws(
    () => sanitizeDeepSeekCanaryInput(new Proxy(JSON.parse(input()), {})),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.throws(
    () => inspectSavedProfileDeepSeekConfig(savedProfileRoot(t, { model: 'deepseek-chat' })),
    (error) => error.code === 'canary_saved_profile_failed'
      && error.stage === 'saved_profile',
  );
});

test('rejects saved-profile integrity drift without leaking profile details', (t) => {
  const cases = [
    {
      name: 'config digest tamper',
      root: () => savedProfileRoot(t, {
        mutateEnvelope(envelope) {
          envelope.config.config_digest = `sha256:${'b'.repeat(64)}`;
        },
      }),
    },
    {
      name: 'repository digest tamper',
      root: () => savedProfileRoot(t, {
        mutateEnvelope(envelope) {
          envelope.repository_digest = `sha256:${'c'.repeat(64)}`;
        },
      }),
    },
    {
      name: 'secret ref mismatch',
      root: () => savedProfileRoot(t, {
        mutateEnvelope(envelope) {
          envelope.secret_binding.secret_ref.secret_id = 'builder-provider-secret:other';
          refreshRepositoryDigest(envelope);
        },
      }),
    },
    {
      name: 'encrypted secret digest invalid',
      root: () => savedProfileRoot(t, {
        mutateEnvelope(envelope) {
          envelope.secret_binding.encrypted_secret_digest = 'sha256:not-a-digest';
          refreshRepositoryDigest(envelope);
        },
      }),
    },
    {
      name: 'credential-like extra field',
      root: () => savedProfileRoot(t, {
        mutateEnvelope(envelope) {
          envelope.config.credential = 'real-deepseek-v4-key';
        },
      }),
      forbidden: ['real-deepseek-v4-key'],
    },
    {
      name: 'oversize current profile',
      root: () => savedProfileRoot(t, { currentJson: 'x'.repeat(128 * 1024 + 1) }),
    },
  ];

  for (const item of cases) {
    const sourceRoot = item.root();
    assertSavedProfileFailure(
      () => inspectSavedProfileDeepSeekConfig(sourceRoot),
      [item.name, sourceRoot, ...(item.forbidden ?? [])],
    );
  }
});

test('rejects saved-profile source directory symlinks before reading current profile', (t) => {
  const sourceRoot = savedProfileRoot(t);
  const configDir = path.join(fs.realpathSync.native(sourceRoot), 'builder-provider-config-v1');
  const cases = [
    {
      name: 'source root symlink',
      target: sourceRoot,
    },
    {
      name: 'config directory symlink',
      target: configDir,
    },
  ];

  for (const item of cases) {
    let opened = false;
    const fsModule = {
      ...fs,
      lstatSync(target, options) {
        if (target === item.target) return fakeDirectoryStat({ symbolicLink: true });
        return fs.lstatSync(target, options);
      },
      openSync(...args) {
        opened = true;
        return fs.openSync(...args);
      },
    };
    assertSavedProfileFailure(
      () => inspectSavedProfileDeepSeekConfig(sourceRoot, fsModule),
      [item.name, sourceRoot],
    );
    assert.equal(opened, false);
  }
});

test('runs the packaged canary without accepting credential material from argv or env', async () => {
  const parsed = parseDeepSeekCanaryInput(input());
  let launched = false;
  await assert.rejects(
    runDeepSeekPackagedCanary(parsed, {
      argv: ['--execute', 'real-deepseek-v4-key'],
      env: {},
      run: async () => {
        launched = true;
      },
    }),
    (error) => error.code === 'canary_secret_source_invalid',
  );
  assert.equal(launched, false);

  await assert.rejects(
    runDeepSeekPackagedCanary(parsed, {
      argv: ['--execute'],
      env: { TOKEN: 'prefix-real-deepseek-v4-key-suffix' },
      run: async () => {
        launched = true;
      },
    }),
    (error) => error.code === 'canary_secret_source_invalid',
  );
  assert.equal(launched, false);
});

test('decorates real canary output with redacted DeepSeek V4 evidence only', async () => {
  const parsed = parseDeepSeekCanaryInput(input());
  let receivedInput = null;
  let receivedOptions = null;
  const result = await runDeepSeekPackagedCanary(parsed, {
    argv: ['--execute'],
    env: { PATH: 'C:\\Windows\\System32' },
    run: async (packagedInput, options) => {
      receivedInput = packagedInput;
      receivedOptions = options;
      return Object.freeze({
        input: Object.freeze({
          credential_source: 'stdin',
          idea_digest: 'sha256:'.concat('1'.repeat(64)),
          question_digest: 'sha256:'.concat('3'.repeat(64)),
          schema_version: CANARY_INPUT_VERSION,
          update_instruction_digest: 'sha256:'.concat('2'.repeat(64)),
        }),
        result_version: CANARY_RESULT_VERSION,
      });
    },
  });

  assert.equal(receivedInput.provider.base_url, DEEPSEEK_V4_BASE_URL);
  assert.equal(receivedInput.provider.credential, 'real-deepseek-v4-key');
  assert.equal(receivedInput.provider.model, 'deepseek-v4-flash');
  assert.deepEqual(receivedOptions, {
    argv: ['--execute'],
    env: { PATH: 'C:\\Windows\\System32' },
  });
  assert.equal(result.result_version, CANARY_RESULT_VERSION);
  assert.equal(result.deepseek_v4.provider_family, 'deepseek_v4_openai_compatible');
  assert.equal(result.deepseek_v4.schema_version, DEEPSEEK_CANARY_INPUT_VERSION);
  assert.match(result.deepseek_v4.endpoint_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(result.deepseek_v4.model_digest, /^sha256:[0-9a-f]{64}$/u);

  const packet = JSON.stringify(result);
  for (const forbidden of [
    'real-deepseek-v4-key',
    'deepseek-v4-flash',
    'api.deepseek.com',
    parsed.executable_path,
    DEEPSEEK_CANARY_IDEA,
  ]) {
    assert.equal(packet.includes(forbidden), false, forbidden);
  }
});

test('runs a saved-profile canary without accepting provider material from input', async (t) => {
  const sourceRoot = savedProfileRoot(t);
  const parsed = parseDeepSeekCanaryInput(savedProfileInput({ source_user_data_path: sourceRoot }));
  let receivedInput = null;
  const result = await runDeepSeekPackagedCanary(parsed, {
    argv: ['--execute'],
    env: { TOKEN: 'prefix-real-deepseek-v4-key-suffix' },
    run: async (packagedInput) => {
      receivedInput = packagedInput;
      return Object.freeze({
        input: Object.freeze({
          credential_source: 'saved_profile',
          idea_digest: 'sha256:'.concat('1'.repeat(64)),
          question_digest: 'sha256:'.concat('3'.repeat(64)),
          schema_version: CANARY_INPUT_VERSION,
          update_instruction_digest: 'sha256:'.concat('2'.repeat(64)),
        }),
        result_version: CANARY_RESULT_VERSION,
        source_profile_unchanged: true,
      });
    },
  });

  assert.equal(receivedInput.mode, 'saved_profile');
  assert.equal(Object.hasOwn(receivedInput, 'provider'), false);
  assert.equal(result.deepseek_v4.profile_config_verified, true);
  assert.equal(result.result_version, CANARY_RESULT_VERSION);
  const packet = JSON.stringify(result);
  for (const forbidden of [
    sourceRoot,
    'real-deepseek-v4-key',
    'deepseek-v4-flash',
    'api.deepseek.com',
    DEEPSEEK_CANARY_IDEA,
  ]) {
    assert.equal(packet.includes(forbidden), false, forbidden);
  }
});

test('CLI requires explicit execute and writes only redacted result JSON', async () => {
  const stdout = new PassThrough();
  let packet = '';
  stdout.on('data', (chunk) => {
    packet += chunk.toString('utf8');
  });
  await assert.rejects(
    runCli({
      argv: [],
      stdin: passThroughWith(input()),
      stdout,
    }),
    (error) => error.code === 'canary_input_invalid',
  );

  const result = await runCli({
    argv: ['--execute'],
    stdin: passThroughWith(input()),
    stdout,
    run: async () => Object.freeze({
      deepseek_v4: Object.freeze({
        endpoint_digest: 'sha256:'.concat('3'.repeat(64)),
        model_digest: 'sha256:'.concat('4'.repeat(64)),
        provider_family: 'deepseek_v4_openai_compatible',
        schema_version: DEEPSEEK_CANARY_INPUT_VERSION,
      }),
      result_version: CANARY_RESULT_VERSION,
    }),
  });

  assert.equal(result.result_version, CANARY_RESULT_VERSION);
  assert.equal(packet.includes('real-deepseek-v4-key'), false);
  assert.equal(packet.includes('deepseek-v4-flash'), false);
  assert.equal(packet.includes('api.deepseek.com'), false);
});

test('source remains a thin wrapper over the packaged canary authority', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));

  assert.equal(
    packageJson.scripts['verify:packaged-canary:deepseek'],
    'node scripts/verify-deepseek-packaged-canary.cjs',
  );
  assert.match(source, /runPackagedCanary/u);
  assert.match(source, /ensureCredentialOnlyFromStdin/u);
  assert.match(source, /inspectSavedProfileDeepSeekConfig/u);
  assert.match(source, /saved_profile/u);
  assert.match(source, /builder-deepseek-packaged-canary-input\.v2/u);
  assert.match(source, /deepseek-v4-flash/u);
  assert.match(source, /deepseek-v4-pro/u);
  assert.doesNotMatch(
    source,
    /safeStorage|ipcMain|ipcRenderer|BrowserWindow|fetch\s*\(|Authorization|Bearer|providerSettings\.replaceCurrent|codeGenerator\.(?:generate|proposePlan|retry|answer|rejectDraft|steer)/iu,
  );
});
