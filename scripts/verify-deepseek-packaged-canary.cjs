'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderPackagedCanaryError,
  CANARY_INPUT_VERSION,
  ensureCredentialOnlyFromStdin,
  readStdin,
  runPackagedCanary,
  sanitizeInput,
} = require('./verify-packaged-canary.cjs');

const DEEPSEEK_CANARY_INPUT_VERSION = 'builder-deepseek-packaged-canary-input.v1';
const DEEPSEEK_V4_BASE_URL = 'https://api.deepseek.com/v1';
const DEEPSEEK_V4_MODELS = Object.freeze(['deepseek-v4-flash', 'deepseek-v4-pro']);
const DEEPSEEK_CANARY_IDEA = [
  'Build a compact local project dashboard with a task list, priority filters,',
  'a progress summary, and a polished responsive static preview.',
].join(' ');
const DEEPSEEK_PROVIDER_SETTINGS = Object.freeze({
  max_tokens: 8192,
  temperature: 0.2,
  timeout_ms: 120000,
});
const DEEPSEEK_INPUT_KEYS = Object.freeze([
  'credential',
  'executable_path',
  'model',
  'schema_version',
]);
const RUN_OPTION_KEYS = Object.freeze([
  'argv',
  'electron',
  'env',
  'fs',
  'os',
  'run',
  'userDataPath',
]);
const PACKAGED_RUN_OPTION_KEYS = Object.freeze([
  'argv',
  'electron',
  'env',
  'fs',
  'os',
  'userDataPath',
]);
const ERROR_STAGES = Object.freeze({
  canary_cleanup_failed: 'cleanup',
  canary_evidence_failed: 'deepseek_packaged_canary',
  canary_input_invalid: 'input',
  canary_launch_failed: 'launch',
  canary_secret_source_invalid: 'secret_source',
});

function fail(code = 'canary_input_invalid') {
  throw new BuilderPackagedCanaryError(code);
}

function isObjectProxy(value) {
  return value !== null && typeof value === 'object' && utilTypes.isProxy(value);
}

function text(value, maxBytes = 64 * 1024) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    fail('canary_input_invalid');
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) fail('canary_input_invalid');
  return value;
}

function exactObject(value, expectedKeys, code = 'canary_input_invalid') {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) {
    fail(code);
  }
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code);
  }
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail(code);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
      fail(code);
    }
  }
  return descriptors;
}

function exactOptionalObject(value, allowedKeys, code = 'canary_input_invalid') {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) {
    fail(code);
  }
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code);
  }
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) fail(code);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
      fail(code);
    }
  }
  return descriptors;
}

function digestText(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function sanitizeDeepSeekCanaryInput(value) {
  const descriptors = exactObject(value, DEEPSEEK_INPUT_KEYS);
  if (descriptors.schema_version.value !== DEEPSEEK_CANARY_INPUT_VERSION) {
    fail('canary_input_invalid');
  }
  const model = text(descriptors.model.value, 200);
  if (!DEEPSEEK_V4_MODELS.includes(model)) fail('canary_input_invalid');
  const executablePath = descriptors.executable_path.value === null
    ? null
    : text(descriptors.executable_path.value, 2_048);
  return Object.freeze({
    credential: text(descriptors.credential.value),
    executable_path: executablePath,
    model,
    schema_version: DEEPSEEK_CANARY_INPUT_VERSION,
  });
}

function parseDeepSeekCanaryInput(source) {
  try {
    return sanitizeDeepSeekCanaryInput(JSON.parse(source));
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_input_invalid');
  }
}

function toPackagedCanaryInput(input) {
  const sanitized = sanitizeDeepSeekCanaryInput(input);
  return sanitizeInput({
    executable_path: sanitized.executable_path,
    idea: DEEPSEEK_CANARY_IDEA,
    provider: {
      base_url: DEEPSEEK_V4_BASE_URL,
      credential: sanitized.credential,
      max_tokens: DEEPSEEK_PROVIDER_SETTINGS.max_tokens,
      model: sanitized.model,
      temperature: DEEPSEEK_PROVIDER_SETTINGS.temperature,
      timeout_ms: DEEPSEEK_PROVIDER_SETTINGS.timeout_ms,
    },
    schema_version: CANARY_INPUT_VERSION,
  });
}

function sanitizeRunOptions(value) {
  if (value === undefined) return Object.freeze({});
  const descriptors = exactOptionalObject(value, RUN_OPTION_KEYS, 'canary_launch_failed');
  const output = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    output[key] = descriptors[key].value;
  }
  if (output.run !== undefined && typeof output.run !== 'function') fail('canary_launch_failed');
  return Object.freeze(output);
}

function packagedRunOptions(options) {
  const output = {};
  for (const key of PACKAGED_RUN_OPTION_KEYS) {
    if (options[key] !== undefined) output[key] = options[key];
  }
  return Object.freeze(output);
}

function redactDeepSeekCanaryInput(input) {
  return Object.freeze({
    endpoint_digest: digestText(DEEPSEEK_V4_BASE_URL),
    model_digest: digestText(input.model),
    provider_family: 'deepseek_v4_openai_compatible',
    schema_version: input.schema_version,
  });
}

function decorateResult(result, input) {
  const descriptors = exactObject(result, Reflect.ownKeys(result), 'canary_evidence_failed');
  const output = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') fail('canary_evidence_failed');
    output[key] = descriptors[key].value;
  }
  output.deepseek_v4 = redactDeepSeekCanaryInput(input);
  return Object.freeze(output);
}

async function runDeepSeekPackagedCanary(rawInput, options = undefined) {
  const input = sanitizeDeepSeekCanaryInput(rawInput);
  const runOptions = sanitizeRunOptions(options);
  const argv = runOptions.argv ?? process.argv.slice(2);
  const env = runOptions.env ?? process.env;
  ensureCredentialOnlyFromStdin(input.credential, argv, env);
  const run = runOptions.run ?? runPackagedCanary;
  const result = await run(toPackagedCanaryInput(input), packagedRunOptions({ ...runOptions, argv, env }));
  return decorateResult(result, input);
}

async function runCli({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  run = runDeepSeekPackagedCanary,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== '--execute') {
    fail('canary_input_invalid');
  }
  const result = await run(parseDeepSeekCanaryInput(await readStdin(stdin)), { argv });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  await runCli();
}

module.exports = {
  DEEPSEEK_CANARY_IDEA,
  DEEPSEEK_CANARY_INPUT_VERSION,
  DEEPSEEK_V4_BASE_URL,
  DEEPSEEK_V4_MODELS,
  parseDeepSeekCanaryInput,
  runCli,
  runDeepSeekPackagedCanary,
  sanitizeDeepSeekCanaryInput,
  toPackagedCanaryInput,
};

if (require.main === module) {
  main().catch((error) => {
    const fixed = error instanceof BuilderPackagedCanaryError
      ? error
      : new BuilderPackagedCanaryError('canary_evidence_failed');
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: fixed.code,
      message: fixed.message,
      stage: Object.hasOwn(ERROR_STAGES, fixed.code)
        ? ERROR_STAGES[fixed.code]
        : 'deepseek_packaged_canary',
    })}\n`);
    process.exitCode = 1;
  });
}
