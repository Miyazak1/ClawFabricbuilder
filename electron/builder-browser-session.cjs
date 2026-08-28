'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_BROWSER_SESSION_VERSION = 'builder-browser-session.v1';
const SESSION_CLASSES = Object.freeze(['project_preview', 'agent_test', 'user_web']);
const INPUT_KEYS = Object.freeze([
  'session_class',
  'project_id',
  'owner_run_id',
  'profile_id',
  'admitted_origins',
  'persistence',
  'created_at_ms',
  'expires_at_ms',
]);
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f-]{36}$/u;
const RUN_ID_PATTERN = /^builder-run:[0-9a-f-]{36}$/u;
const PROFILE_ID_PATTERN = /^builder-browser-profile:[0-9a-f-]{36}$/u;

class BuilderBrowserSessionError extends Error {
  constructor() {
    super('Builder browser session admission is unavailable.');
    this.name = 'BuilderBrowserSessionError';
    this.code = 'builder_browser_session_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderBrowserSessionError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function safeNullableId(value, pattern) {
  if (value === null) return null;
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function normalizeOrigin(value, sessionClass) {
  if (typeof value !== 'string' || value.length > 2_048 || value.trim() !== value) fail();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail();
  }
  if (parsed.origin !== value || parsed.username !== '' || parsed.password !== '') fail();
  if (sessionClass !== 'user_web') {
    const port = Number(parsed.port);
    if (
      parsed.protocol !== 'http:'
      || parsed.hostname !== '127.0.0.1'
      || !Number.isSafeInteger(port)
      || port < 1
      || port > 65_535
    ) fail();
  } else if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail();
  }
  return parsed.origin;
}

function safeOrigins(value, sessionClass) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 16) fail();
  const origins = value.map((origin) => normalizeOrigin(origin, sessionClass));
  if (new Set(origins).size !== origins.length) fail();
  if (sessionClass !== 'user_web' && origins.length < 1) fail();
  return Object.freeze(origins);
}

function authorityFor(sessionClass) {
  return freezeDeep({
    browser_session_authority: 'builder_main_browser_session_registry_v1',
    session_class: sessionClass,
    partition_visibility: 'main_private',
    renderer_authority: 'projection_only',
    provider_authority: sessionClass === 'agent_test'
      ? 'bounded_observation_and_action_tools_only'
      : sessionClass === 'project_preview'
        ? 'preview_evidence_only'
        : 'none_without_separate_consent',
    command_execution: 'separate_authority',
    dependency_installation: 'separate_authority',
    project_write: 'separate_authority',
    downloads: sessionClass === 'user_web' ? 'separate_download_admission' : 'blocked',
  });
}

function bodyFor(input) {
  return JSON.stringify({
    session_class: input.session_class,
    project_id: input.project_id,
    owner_run_id: input.owner_run_id,
    profile_id: input.profile_id,
    admitted_origins: input.admitted_origins,
    persistence: input.persistence,
    created_at_ms: input.created_at_ms,
    expires_at_ms: input.expires_at_ms,
  });
}

function createBuilderBrowserSession(rawInput) {
  exactObject(rawInput, INPUT_KEYS);
  const sessionClass = rawInput.session_class;
  if (!SESSION_CLASSES.includes(sessionClass)) fail();
  const projectId = safeNullableId(rawInput.project_id, PROJECT_ID_PATTERN);
  const ownerRunId = safeNullableId(rawInput.owner_run_id, RUN_ID_PATTERN);
  const profileId = safeNullableId(rawInput.profile_id, PROFILE_ID_PATTERN);
  const admittedOrigins = safeOrigins(rawInput.admitted_origins, sessionClass);
  const persistence = rawInput.persistence;
  const createdAtMs = safeTimestamp(rawInput.created_at_ms);
  const expiresAtMs = rawInput.expires_at_ms === null ? null : safeTimestamp(rawInput.expires_at_ms);
  if (expiresAtMs !== null && expiresAtMs <= createdAtMs) fail();

  if (sessionClass === 'project_preview') {
    if (projectId === null || ownerRunId !== null || profileId !== null) fail();
    if (persistence !== 'ephemeral' || expiresAtMs === null) fail();
  } else if (sessionClass === 'agent_test') {
    if (projectId === null || ownerRunId === null || profileId !== null) fail();
    if (persistence !== 'ephemeral' || expiresAtMs === null) fail();
  } else {
    if (projectId !== null || ownerRunId !== null || profileId === null) fail();
    if (!['ephemeral', 'local_persistent'].includes(persistence)) fail();
    if ((persistence === 'ephemeral') !== (expiresAtMs !== null)) fail();
  }

  const canonical = {
    session_class: sessionClass,
    project_id: projectId,
    owner_run_id: ownerRunId,
    profile_id: profileId,
    admitted_origins: admittedOrigins,
    persistence,
    created_at_ms: createdAtMs,
    expires_at_ms: expiresAtMs,
  };
  const digest = nodeCrypto.createHash('sha256').update(bodyFor(canonical), 'utf8').digest('hex');
  return freezeDeep({
    session_version: BUILDER_BROWSER_SESSION_VERSION,
    session_id: `builder-browser-session:${digest}`,
    ...canonical,
    lifecycle_state: 'admitted',
    authority: authorityFor(sessionClass),
  });
}

function sanitizeBuilderBrowserSession(rawSession) {
  if (!isPlainObject(rawSession)) fail();
  const expected = [
    'session_version', 'session_id', ...INPUT_KEYS, 'lifecycle_state', 'authority',
  ];
  exactObject(rawSession, expected);
  if (rawSession.session_version !== BUILDER_BROWSER_SESSION_VERSION) fail();
  const recreated = createBuilderBrowserSession(Object.fromEntries(
    INPUT_KEYS.map((key) => [key, rawSession[key]]),
  ));
  if (
    rawSession.session_id !== recreated.session_id
    || rawSession.lifecycle_state !== 'admitted'
    || JSON.stringify(rawSession.authority) !== JSON.stringify(recreated.authority)
  ) fail();
  return recreated;
}

module.exports = freezeDeep({
  BUILDER_BROWSER_SESSION_VERSION,
  BuilderBrowserSessionError,
  createBuilderBrowserSession,
  sanitizeBuilderBrowserSession,
});
