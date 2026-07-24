'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  CANARY_INPUT_VERSION,
} = require('../scripts/verify-packaged-canary.cjs');
const {
  DEEPSEEK_CANARY_IDEA,
  DEEPSEEK_CANARY_INPUT_VERSION,
  DEEPSEEK_V4_BASE_URL,
  DEEPSEEK_V4_MODELS,
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
    model: 'deepseek-v4-flash',
    schema_version: DEEPSEEK_CANARY_INPUT_VERSION,
    ...overrides,
  });
}

function passThroughWith(value) {
  const stream = new PassThrough();
  stream.end(value);
  return stream;
}

test('builds a first-config packaged canary input for official DeepSeek V4 only', () => {
  const parsed = parseDeepSeekCanaryInput(input());
  const packaged = toPackagedCanaryInput(parsed);

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

test('rejects non-v4 models, endpoint overrides, extras, accessors, and proxy input', () => {
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
          schema_version: CANARY_INPUT_VERSION,
          update_instruction_digest: 'sha256:'.concat('2'.repeat(64)),
        }),
        result_version: 'builder-packaged-canary-result.v4',
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
  assert.equal(result.result_version, 'builder-packaged-canary-result.v4');
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
      result_version: 'builder-packaged-canary-result.v4',
    }),
  });

  assert.equal(result.result_version, 'builder-packaged-canary-result.v4');
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
  assert.match(source, /deepseek-v4-flash/u);
  assert.match(source, /deepseek-v4-pro/u);
  assert.doesNotMatch(
    source,
    /safeStorage|ipcMain|ipcRenderer|BrowserWindow|fetch\s*\(|Authorization|Bearer|providerSettings\.replaceCurrent|codeGenerator\.(?:generate|answer)/iu,
  );
});
