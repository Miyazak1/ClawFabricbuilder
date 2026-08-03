'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  BuilderPackagedCanaryError,
  CANARY_INPUT_VERSION,
  ensureCredentialOnlyFromStdin,
  readStdin,
  runPackagedCanary,
  sanitizeInput,
} = require('./verify-packaged-canary.cjs');

const DEEPSEEK_CANARY_INPUT_VERSION = 'builder-deepseek-packaged-canary-input.v2';
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
const DEEPSEEK_FIRST_CONFIG_INPUT_KEYS = Object.freeze([
  'credential',
  'executable_path',
  'mode',
  'model',
  'schema_version',
]);
const DEEPSEEK_SAVED_PROFILE_INPUT_KEYS = Object.freeze([
  'executable_path',
  'mode',
  'schema_version',
  'source_user_data_path',
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
const PROFILE_CONFIG_DIRECTORY_NAME = 'builder-provider-config-v1';
const PROFILE_CONFIG_CURRENT_FILE_NAME = 'current.json';
const PROFILE_CONFIG_MAX_BYTES = 128 * 1024;
const PROVIDER_CONFIG_REPOSITORY_VERSION = 'builder-provider-config-repository.v1';
const PROVIDER_CONFIG_VERSION = 'builder-provider-config.v1';
const PROVIDER_SECRET_REF_VERSION = 'builder-provider-secret-ref.v1';
const PROVIDER_ID = 'builder-default';
const PROVIDER_SECRET_ID = 'builder-provider-secret:default';
const PROVIDER_SECRET_BINDING_VERSION = 'builder-provider-secret-binding.v1';
const PROVIDER_SECRET_STORE_VERSION = 'builder-provider-secret-store.v1';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CURRENT_KEYS = Object.freeze(['repository_version', 'config', 'secret_binding', 'repository_digest']);
const CURRENT_BODY_KEYS = Object.freeze(['repository_version', 'config', 'secret_binding']);
const CONFIG_KEYS = Object.freeze([
  'config_version',
  'provider_id',
  'base_url',
  'model',
  'timeout_ms',
  'temperature',
  'max_tokens',
  'secret_ref',
  'config_digest',
]);
const SECRET_REF_KEYS = Object.freeze(['ref_version', 'provider_id', 'secret_id']);
const SECRET_BINDING_KEYS = Object.freeze([
  'binding_version',
  'secret_ref',
  'encrypted_secret_digest',
  'secret_store_version',
]);
const ERROR_STAGES = Object.freeze({
  canary_cleanup_failed: 'cleanup',
  canary_evidence_failed: 'deepseek_packaged_canary',
  canary_input_invalid: 'input',
  canary_launch_failed: 'launch',
  canary_preview_failed: 'preview',
  canary_preview_frame_body_failed: 'preview_frame_body',
  canary_preview_frame_contract_failed: 'preview_frame_contract',
  canary_preview_limitation_failed: 'preview_limitation',
  canary_preview_limitation_text_failed: 'preview_limitation_text',
  canary_preview_pixels_failed: 'preview_pixels',
  canary_preview_runtime_text_failed: 'preview_runtime_text',
  canary_preview_surface_failed: 'preview_surface',
  canary_preview_unavailable_pixels_failed: 'preview_unavailable_pixels',
  canary_preview_unavailable_text_failed: 'preview_unavailable_text',
  canary_review_diff_activity_failed: 'review_diff_activity',
  canary_review_diff_artifact_chat_geometry_failed: 'review_diff_artifact_chat_geometry',
  canary_review_diff_artifact_layout_failed: 'review_diff_artifact_layout',
  canary_review_diff_artifact_overlap_failed: 'review_diff_artifact_overlap',
  canary_review_diff_artifact_resize_geometry_failed: 'review_diff_artifact_resize_geometry',
  canary_review_diff_artifact_result_geometry_failed: 'review_diff_artifact_result_geometry',
  canary_review_diff_artifact_review_bounds_failed: 'review_diff_artifact_review_bounds',
  canary_review_diff_artifact_sidebar_geometry_failed: 'review_diff_artifact_sidebar_geometry',
  canary_review_diff_artifact_summary_geometry_failed: 'review_diff_artifact_summary_geometry',
  canary_review_diff_artifact_summary_horizontal_failed: 'review_diff_artifact_summary_horizontal',
  canary_review_diff_artifact_summary_order_failed: 'review_diff_artifact_summary_order',
  canary_review_diff_artifact_summary_vertical_failed: 'review_diff_artifact_summary_vertical',
  canary_review_diff_artifact_summary_width_failed: 'review_diff_artifact_summary_width',
  canary_review_diff_box_failed: 'review_diff_geometry',
  canary_review_diff_checkpoint_action_geometry_failed: 'review_diff_checkpoint_action_geometry',
  canary_review_diff_checkpoint_action_overlap_failed: 'review_diff_checkpoint_action_overlap',
  canary_review_diff_checkpoint_copy_width_failed: 'review_diff_checkpoint_copy_width',
  canary_review_diff_checkpoint_height_failed: 'review_diff_checkpoint_height',
  canary_review_diff_checkpoint_width_failed: 'review_diff_checkpoint_width',
  canary_review_diff_checkpoint_child_bounds_failed: 'review_diff_checkpoint_child_bounds',
  canary_review_diff_changes_layout_failed: 'review_diff_changes_layout',
  canary_review_diff_checkpoint_layout_failed: 'review_diff_checkpoint_layout',
  canary_review_diff_checkpoint_text_stack_failed: 'review_diff_checkpoint_text_stack',
  canary_review_diff_failed: 'review_diff',
  canary_review_diff_text_failed: 'review_diff_text',
  canary_read_evidence_failed: 'read_evidence',
  canary_read_evidence_initial_current_failed: 'read_evidence_initial_current',
  canary_read_evidence_initial_current_current_failed: 'read_evidence_initial_current_current',
  canary_read_evidence_initial_current_task_stream_failed: 'read_evidence_initial_current_task_stream',
  canary_read_evidence_initial_saved_failed: 'read_evidence_initial_saved',
  canary_read_evidence_pending_update_failed: 'read_evidence_pending_update',
  canary_read_evidence_plan_proposal_failed: 'read_evidence_plan_proposal',
  canary_read_evidence_restart_continuation_failed: 'read_evidence_restart_continuation',
  canary_read_evidence_saved_profile_boot_failed: 'read_evidence_saved_profile_boot',
  canary_read_evidence_updated_current_failed: 'read_evidence_updated_current',
  canary_read_evidence_updated_saved_failed: 'read_evidence_updated_saved',
  canary_saved_profile_failed: 'saved_profile',
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

function ownValue(value, key, code = 'canary_input_invalid') {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(code);
  return descriptor.value;
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

function canonicalJson(value, code = 'canary_evidence_failed') {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, code)).join(',')}]`;
  if (value !== null && typeof value === 'object' && !isObjectProxy(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(code);
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(ownValue(value, key, code), code)}`,
    ).join(',')}}`;
  }
  fail(code);
}

function digestCanonical(value, code = 'canary_evidence_failed') {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value, code), 'utf8').digest('hex')}`;
}

function safeDigest(value, code = 'canary_input_invalid') {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail(code);
  return value;
}

function safeLocalAbsolutePath(value) {
  const candidate = text(value, 2_048);
  if (
    !path.isAbsolute(candidate)
    || path.normalize(candidate) !== candidate
    || path.resolve(candidate) !== candidate
    || candidate.includes('\0')
  ) fail('canary_input_invalid');
  if (process.platform === 'win32') {
    if (/^\\\\/u.test(candidate) || !/^[A-Za-z]:\\/u.test(candidate)) fail('canary_input_invalid');
  }
  return candidate;
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function pathIdentity(stat) {
  return Object.freeze({
    dev: typeof stat.dev === 'bigint' || Number.isSafeInteger(stat.dev) ? stat.dev : null,
    ino: typeof stat.ino === 'bigint' || Number.isSafeInteger(stat.ino) ? stat.ino : null,
  });
}

function safeSavedProfileSourcePath(value) {
  try {
    return safeLocalAbsolutePath(value);
  } catch {
    fail('canary_saved_profile_failed');
  }
}

function assertLocalResolvedPath(realPath) {
  if (!path.isAbsolute(realPath) || path.normalize(realPath) !== realPath || path.resolve(realPath) !== realPath) {
    fail('canary_saved_profile_failed');
  }
  if (process.platform === 'win32') {
    if (/^\\\\/u.test(realPath) || !/^[A-Za-z]:\\/u.test(realPath)) fail('canary_saved_profile_failed');
  }
}

function captureSavedProfileDirectory(directoryPath, fsModule) {
  let stat;
  let realPath;
  try {
    stat = fsModule.lstatSync(directoryPath, { bigint: true });
    realPath = path.resolve(fsModule.realpathSync.native(directoryPath));
  } catch {
    fail('canary_saved_profile_failed');
  }
  assertLocalResolvedPath(realPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('canary_saved_profile_failed');
  return Object.freeze({
    identity: pathIdentity(stat),
    path: directoryPath,
    realPath,
  });
}

function assertDirectProfileChildDirectory(parent, child, expectedName) {
  if (!samePath(path.dirname(child.realPath), parent.realPath) || path.basename(child.realPath) !== expectedName) {
    fail('canary_saved_profile_failed');
  }
}

function assertSavedProfileDirectoryUnchanged(captured, fsModule) {
  const current = captureSavedProfileDirectory(captured.path, fsModule);
  if (!samePath(captured.realPath, current.realPath)) fail('canary_saved_profile_failed');
  for (const key of ['dev', 'ino']) {
    if (
      captured.identity[key] !== null
      && current.identity[key] !== null
      && captured.identity[key] !== current.identity[key]
    ) fail('canary_saved_profile_failed');
  }
}

function executablePath(value) {
  return value === null ? null : safeLocalAbsolutePath(value);
}

function inputDescriptors(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) {
    fail('canary_input_invalid');
  }
  let descriptors;
  let keys;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail('canary_input_invalid');
  }
  const modeDescriptor = descriptors.mode;
  if (!modeDescriptor || !modeDescriptor.enumerable || 'get' in modeDescriptor || 'set' in modeDescriptor) {
    fail('canary_input_invalid');
  }
  const mode = modeDescriptor.value;
  const expectedKeys = mode === 'first_config'
    ? DEEPSEEK_FIRST_CONFIG_INPUT_KEYS
    : mode === 'saved_profile'
      ? DEEPSEEK_SAVED_PROFILE_INPUT_KEYS
      : null;
  if (
    expectedKeys === null
    || keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail('canary_input_invalid');
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
      fail('canary_input_invalid');
    }
  }
  return Object.freeze({ descriptors, mode });
}

function sanitizeDeepSeekCanaryInput(value) {
  const { descriptors, mode } = inputDescriptors(value);
  if (descriptors.schema_version.value !== DEEPSEEK_CANARY_INPUT_VERSION) {
    fail('canary_input_invalid');
  }
  const selectedExecutablePath = executablePath(descriptors.executable_path.value);
  if (mode === 'saved_profile') {
    return Object.freeze({
      executable_path: selectedExecutablePath,
      mode: 'saved_profile',
      schema_version: DEEPSEEK_CANARY_INPUT_VERSION,
      source_user_data_path: safeLocalAbsolutePath(descriptors.source_user_data_path.value),
    });
  }
  const model = text(descriptors.model.value, 200);
  if (!DEEPSEEK_V4_MODELS.includes(model)) fail('canary_input_invalid');
  return Object.freeze({
    credential: text(descriptors.credential.value),
    executable_path: selectedExecutablePath,
    mode: 'first_config',
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
  if (sanitized.mode === 'saved_profile') {
    return sanitizeInput({
      executable_path: sanitized.executable_path,
      idea: DEEPSEEK_CANARY_IDEA,
      mode: 'saved_profile',
      schema_version: CANARY_INPUT_VERSION,
      source_user_data_path: sanitized.source_user_data_path,
    });
  }
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

function safeText(value, maximumBytes, code = 'canary_saved_profile_failed') {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) fail(code);
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) fail(code);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(code);
      index += 1;
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      fail(code);
    }
  }
  return value;
}

function officialDeepSeekBaseUrl(value) {
  const source = safeText(value, 2_048);
  try {
    const parsed = new URL(source);
    if (
      parsed.protocol !== 'https:'
      || parsed.hostname.toLowerCase() !== 'api.deepseek.com'
      || (parsed.port !== '' && parsed.port !== '443')
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) fail('canary_saved_profile_failed');
    return parsed.toString().replace(/\/$/u, '');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_saved_profile_failed');
  }
}

function sanitizeProfileSecretRef(value) {
  const descriptors = exactObject(value, SECRET_REF_KEYS, 'canary_saved_profile_failed');
  if (
    descriptors.ref_version.value !== PROVIDER_SECRET_REF_VERSION
    || descriptors.provider_id.value !== PROVIDER_ID
    || descriptors.secret_id.value !== PROVIDER_SECRET_ID
  ) fail('canary_saved_profile_failed');
  return Object.freeze({
    ref_version: PROVIDER_SECRET_REF_VERSION,
    provider_id: PROVIDER_ID,
    secret_id: PROVIDER_SECRET_ID,
  });
}

function sanitizeProfileSecretBinding(value) {
  const descriptors = exactObject(value, SECRET_BINDING_KEYS, 'canary_saved_profile_failed');
  return Object.freeze({
    binding_version: descriptors.binding_version.value === PROVIDER_SECRET_BINDING_VERSION
      ? PROVIDER_SECRET_BINDING_VERSION
      : fail('canary_saved_profile_failed'),
    secret_ref: sanitizeProfileSecretRef(descriptors.secret_ref.value),
    encrypted_secret_digest: safeDigest(descriptors.encrypted_secret_digest.value, 'canary_saved_profile_failed'),
    secret_store_version: descriptors.secret_store_version.value === PROVIDER_SECRET_STORE_VERSION
      ? PROVIDER_SECRET_STORE_VERSION
      : fail('canary_saved_profile_failed'),
  });
}

function sanitizeProfileConfig(value) {
  const descriptors = exactObject(value, CONFIG_KEYS, 'canary_saved_profile_failed');
  const model = safeText(descriptors.model.value, 200);
  if (!DEEPSEEK_V4_MODELS.includes(model)) fail('canary_saved_profile_failed');
  const timeoutMs = descriptors.timeout_ms.value;
  const temperature = descriptors.temperature.value;
  const maxTokens = descriptors.max_tokens.value;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    fail('canary_saved_profile_failed');
  }
  if (
    temperature !== null
    && (typeof temperature !== 'number' || !Number.isFinite(temperature) || Object.is(temperature, -0)
      || temperature < 0 || temperature > 2)
  ) fail('canary_saved_profile_failed');
  if (maxTokens !== null && (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 131_072)) {
    fail('canary_saved_profile_failed');
  }
  const body = Object.freeze({
    config_version: descriptors.config_version.value === PROVIDER_CONFIG_VERSION
      ? PROVIDER_CONFIG_VERSION
      : fail('canary_saved_profile_failed'),
    provider_id: descriptors.provider_id.value === PROVIDER_ID
      ? PROVIDER_ID
      : fail('canary_saved_profile_failed'),
    base_url: officialDeepSeekBaseUrl(descriptors.base_url.value),
    model,
    timeout_ms: timeoutMs,
    temperature,
    max_tokens: maxTokens,
    secret_ref: sanitizeProfileSecretRef(descriptors.secret_ref.value),
  });
  const configDigest = safeDigest(descriptors.config_digest.value, 'canary_saved_profile_failed');
  if (digestCanonical(body, 'canary_saved_profile_failed') !== configDigest) fail('canary_saved_profile_failed');
  return Object.freeze({ ...body, config_digest: configDigest });
}

function readBoundedProfileCurrent(currentPath, fsModule) {
  let descriptor = null;
  try {
    const pathInfo = fsModule.lstatSync(currentPath, { bigint: true });
    if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) fail('canary_saved_profile_failed');
    descriptor = fsModule.openSync(currentPath, 'r');
    const descriptorInfo = fsModule.fstatSync(descriptor, { bigint: true });
    if (
      !descriptorInfo.isFile()
      || descriptorInfo.dev !== pathInfo.dev
      || descriptorInfo.ino !== pathInfo.ino
      || descriptorInfo.size < 1n
      || descriptorInfo.size > BigInt(PROFILE_CONFIG_MAX_BYTES)
    ) fail('canary_saved_profile_failed');
    const expectedBytes = Number(descriptorInfo.size);
    const buffer = Buffer.allocUnsafe(expectedBytes + 1);
    const bytesRead = fsModule.readSync(descriptor, buffer, 0, buffer.length, 0);
    const reopenedInfo = fsModule.fstatSync(descriptor, { bigint: true });
    if (
      bytesRead !== expectedBytes
      || !reopenedInfo.isFile()
      || reopenedInfo.dev !== descriptorInfo.dev
      || reopenedInfo.ino !== descriptorInfo.ino
      || reopenedInfo.size !== descriptorInfo.size
    ) fail('canary_saved_profile_failed');
    fsModule.closeSync(descriptor);
    descriptor = null;
    return buffer.subarray(0, expectedBytes).toString('utf8');
  } catch (error) {
    if (descriptor !== null) {
      try { fsModule.closeSync(descriptor); } catch { /* fixed failure below */ }
    }
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_saved_profile_failed');
  }
}

function inspectSavedProfileDeepSeekConfig(sourceUserDataPath, fsModule = fs) {
  try {
    const sourceRoot = captureSavedProfileDirectory(safeSavedProfileSourcePath(sourceUserDataPath), fsModule);
    const configDirectory = captureSavedProfileDirectory(path.join(
      sourceRoot.realPath,
      PROFILE_CONFIG_DIRECTORY_NAME,
    ), fsModule);
    assertDirectProfileChildDirectory(sourceRoot, configDirectory, PROFILE_CONFIG_DIRECTORY_NAME);
    const currentPath = path.join(
      configDirectory.realPath,
      PROFILE_CONFIG_CURRENT_FILE_NAME,
    );
    const currentSource = readBoundedProfileCurrent(currentPath, fsModule);
    assertSavedProfileDirectoryUnchanged(configDirectory, fsModule);
    assertSavedProfileDirectoryUnchanged(sourceRoot, fsModule);
    const parsed = JSON.parse(currentSource);
    const descriptors = exactObject(parsed, CURRENT_KEYS, 'canary_saved_profile_failed');
    const config = sanitizeProfileConfig(descriptors.config.value);
    const secretBinding = sanitizeProfileSecretBinding(descriptors.secret_binding.value);
    const body = Object.freeze({
      repository_version: descriptors.repository_version.value === PROVIDER_CONFIG_REPOSITORY_VERSION
        ? PROVIDER_CONFIG_REPOSITORY_VERSION
        : fail('canary_saved_profile_failed'),
      config,
      secret_binding: secretBinding,
    });
    const repositoryDigest = safeDigest(descriptors.repository_digest.value, 'canary_saved_profile_failed');
    if (
      Reflect.ownKeys(body).length !== CURRENT_BODY_KEYS.length
      || digestCanonical(body, 'canary_saved_profile_failed') !== repositoryDigest
    ) fail('canary_saved_profile_failed');
    return Object.freeze({
      base_url: config.base_url,
      model: config.model,
      profile_config_verified: true,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_saved_profile_failed');
  }
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

function redactDeepSeekCanaryInput(input, savedProfileConfig = null) {
  const baseUrl = input.mode === 'saved_profile'
    ? savedProfileConfig?.base_url
    : DEEPSEEK_V4_BASE_URL;
  const model = input.mode === 'saved_profile'
    ? savedProfileConfig?.model
    : input.model;
  if (typeof baseUrl !== 'string' || typeof model !== 'string') fail('canary_evidence_failed');
  return Object.freeze({
    endpoint_digest: digestText(baseUrl),
    model_digest: digestText(model),
    provider_family: 'deepseek_v4_openai_compatible',
    ...(input.mode === 'saved_profile' ? { profile_config_verified: true } : {}),
    schema_version: input.schema_version,
  });
}

function decorateResult(result, input, savedProfileConfig = null) {
  const descriptors = exactObject(result, Reflect.ownKeys(result), 'canary_evidence_failed');
  const output = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') fail('canary_evidence_failed');
    output[key] = descriptors[key].value;
  }
  output.deepseek_v4 = redactDeepSeekCanaryInput(input, savedProfileConfig);
  return Object.freeze(output);
}

async function runDeepSeekPackagedCanary(rawInput, options = undefined) {
  const input = sanitizeDeepSeekCanaryInput(rawInput);
  const runOptions = sanitizeRunOptions(options);
  const argv = runOptions.argv ?? process.argv.slice(2);
  const env = runOptions.env ?? process.env;
  const savedProfileConfig = input.mode === 'saved_profile'
    ? inspectSavedProfileDeepSeekConfig(input.source_user_data_path, runOptions.fs ?? fs)
    : null;
  if (input.mode === 'first_config') ensureCredentialOnlyFromStdin(input.credential, argv, env);
  const run = runOptions.run ?? runPackagedCanary;
  const result = await run(toPackagedCanaryInput(input), packagedRunOptions({ ...runOptions, argv, env }));
  return decorateResult(result, input, savedProfileConfig);
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
  inspectSavedProfileDeepSeekConfig,
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
