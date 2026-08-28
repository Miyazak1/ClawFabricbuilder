'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderBrowserSession,
} = require('./builder-browser-session.cjs');
const { builderPerformanceTrace } = require('./builder-performance-trace.cjs');

const BUILDER_BROWSER_SESSION_REGISTRY_VERSION = 'builder-browser-session-registry.v1';
const HANDLE_VERSION = 'builder-browser-session-handle.v1';
const STATUS_VERSION = 'builder-browser-session-status.v1';
const OPTION_KEYS = Object.freeze(['session', 'now_ms']);
const OPTIONAL_OPTION_KEYS = Object.freeze(['cleanup_timeout_ms']);
const OPEN_KEYS = Object.freeze(['browser_session']);
const CLOSE_KEYS = Object.freeze(['reason']);
const CLOSE_REASONS = Object.freeze([
  'completed', 'cancelled', 'replaced', 'shutdown', 'interrupted', 'user_closed',
]);
const DEFAULT_CLEANUP_TIMEOUT_MS = 1_000;

class BuilderBrowserSessionRegistryError extends Error {
  constructor(code = 'builder_browser_session_registry_invalid') {
    const selected = [
      'builder_browser_session_registry_invalid',
      'builder_browser_session_registry_conflict',
      'builder_browser_session_registry_expired',
      'builder_browser_session_registry_closed',
      'builder_browser_session_registry_cleanup_required',
    ].includes(code) ? code : 'builder_browser_session_registry_invalid';
    super('Builder browser session registry is unavailable.');
    this.name = 'BuilderBrowserSessionRegistryError';
    this.code = selected;
    this.retryable = selected === 'builder_browser_session_registry_cleanup_required';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderBrowserSessionRegistryError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObjectWithOptional(value, required, optional = []) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (
    required.some((key) => !keys.includes(key))
    || keys.some((key) => typeof key !== 'string' || ![...required, ...optional].includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function stableMethod(value, key) {
  let cursor = value;
  while (cursor !== null) {
    if (utilTypes.isProxy(cursor)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function partitionFor(browserSession) {
  const digest = browserSession.session_id.slice('builder-browser-session:'.length);
  if (browserSession.session_class === 'project_preview') return `builder-live-preview-${digest}`;
  if (browserSession.session_class === 'agent_test') return `builder-agent-test-${digest}`;
  if (browserSession.persistence === 'local_persistent') {
    const profileId = browserSession.profile_id.slice('builder-browser-profile:'.length);
    return `persist:builder-user-web-${profileId}`;
  }
  const base = `builder-user-web-${digest}`;
  return base;
}

function publicStatus(entry) {
  return Object.freeze({
    status_version: STATUS_VERSION,
    session_id: entry.browser_session.session_id,
    session_class: entry.browser_session.session_class,
    project_id: entry.browser_session.project_id,
    owner_run_id: entry.browser_session.owner_run_id,
    profile_id: entry.browser_session.profile_id,
    persistence: entry.browser_session.persistence,
    lifecycle_state: entry.lifecycle_state,
    opened_at_ms: entry.opened_at_ms,
    closed_at_ms: entry.closed_at_ms,
    close_reason: entry.close_reason,
    authority: entry.browser_session.authority,
  });
}

async function boundedCleanup(operation, timeoutMs) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function createBuilderBrowserSessionRegistry(rawOptions) {
  exactObjectWithOptional(rawOptions, OPTION_KEYS, OPTIONAL_OPTION_KEYS);
  const sessionModule = rawOptions.session;
  const nowMs = rawOptions.now_ms;
  const cleanupTimeoutMs = rawOptions.cleanup_timeout_ms ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  if (
    sessionModule === null
    || typeof sessionModule !== 'object'
    || utilTypes.isProxy(sessionModule)
    || typeof nowMs !== 'function'
    || utilTypes.isProxy(nowMs)
    || !Number.isSafeInteger(cleanupTimeoutMs)
    || cleanupTimeoutMs < 1
    || cleanupTimeoutMs > 60_000
  ) fail();
  const fromPartition = stableMethod(sessionModule, 'fromPartition');
  const entries = new Map();
  let disposed = false;

  async function closeEntry(entry, reason) {
    return builderPerformanceTrace.measureAsync('main.browser_session.cleanup.duration_ms', async () => {
      if (entry.lifecycle_state === 'closed') return publicStatus(entry);
      if (entry.closed_at_ms === null) {
        entry.closed_at_ms = safeTimestamp(nowMs());
        entry.close_reason = reason;
      }
      entry.lifecycle_state = 'closing';
      if (entry.browser_session.persistence === 'ephemeral') {
        const cleared = await boundedCleanup(
          () => Reflect.apply(entry.clear_storage_data, entry.electron_session, [{}]),
          cleanupTimeoutMs,
        );
        if (cleared === false) {
          entry.lifecycle_state = 'cleanup_required';
          fail('builder_browser_session_registry_cleanup_required');
        }
      }
      entry.lifecycle_state = 'closed';
      entries.delete(entry.browser_session.session_id);
      return publicStatus(entry);
    });
  }

  async function open(rawInput) {
    return builderPerformanceTrace.measureAsync('main.browser_session.open.duration_ms', async () => {
      if (disposed) fail('builder_browser_session_registry_closed');
      exactObjectWithOptional(rawInput, OPEN_KEYS);
      const browserSession = sanitizeBuilderBrowserSession(rawInput.browser_session);
      const now = safeTimestamp(nowMs());
      if (browserSession.expires_at_ms !== null && now >= browserSession.expires_at_ms) {
        fail('builder_browser_session_registry_expired');
      }
      if (entries.has(browserSession.session_id)) fail('builder_browser_session_registry_conflict');
      const partition = partitionFor(browserSession);
      if ([...entries.values()].some((entry) => entry.partition === partition)) {
        fail('builder_browser_session_registry_conflict');
      }
      const electronSession = Reflect.apply(fromPartition, sessionModule, [partition]);
      if (electronSession === null || typeof electronSession !== 'object' || utilTypes.isProxy(electronSession)) fail();
      const clearStorageData = stableMethod(electronSession, 'clearStorageData');
      const entry = {
        browser_session: browserSession,
        partition,
        electron_session: electronSession,
        clear_storage_data: clearStorageData,
        lifecycle_state: 'active',
        opened_at_ms: now,
        closed_at_ms: null,
        close_reason: null,
      };
      entries.set(browserSession.session_id, entry);
      return Object.freeze({
        handle_version: HANDLE_VERSION,
        session_id: browserSession.session_id,
        session_class: browserSession.session_class,
        readPublicSession() { return browserSession; },
        readPublicStatus() { return publicStatus(entry); },
        readMainOnlyElectronSession() {
          if (entry.lifecycle_state !== 'active') fail('builder_browser_session_registry_closed');
          return entry.electron_session;
        },
        readMainOnlyPartition() {
          if (entry.lifecycle_state !== 'active') fail('builder_browser_session_registry_closed');
          return entry.partition;
        },
        async close(rawClose) {
          exactObjectWithOptional(rawClose, CLOSE_KEYS);
          const reason = rawClose.reason;
          if (!CLOSE_REASONS.includes(reason)) fail();
          return closeEntry(entry, reason);
        },
      });
    });
  }

  return Object.freeze({
    registry_version: BUILDER_BROWSER_SESSION_REGISTRY_VERSION,
    open,
    readPublicStatus(sessionId) {
      if (typeof sessionId !== 'string') fail();
      const entry = entries.get(sessionId);
      return entry === undefined ? null : publicStatus(entry);
    },
    diagnostics() {
      const byClass = { project_preview: 0, agent_test: 0, user_web: 0 };
      let activeCount = 0;
      let cleanupRequiredCount = 0;
      for (const entry of entries.values()) {
        if (entry.lifecycle_state === 'active') {
          activeCount += 1;
          byClass[entry.browser_session.session_class] += 1;
        } else if (entry.lifecycle_state === 'cleanup_required') {
          cleanupRequiredCount += 1;
        }
      }
      return Object.freeze({
        registry_version: BUILDER_BROWSER_SESSION_REGISTRY_VERSION,
        active_count: activeCount,
        cleanup_required_count: cleanupRequiredCount,
        active_by_class: Object.freeze(byClass),
        disposed,
      });
    },
    async dispose() {
      if (disposed) return Object.freeze({ disposed: true });
      disposed = true;
      const pendingEntries = [...entries.values()];
      const settlements = await Promise.allSettled(
        pendingEntries.map((entry) => closeEntry(entry, 'shutdown')),
      );
      if (settlements.some((settlement) => settlement.status === 'rejected')) {
        fail('builder_browser_session_registry_cleanup_required');
      }
      return Object.freeze({ disposed: true });
    },
  });
}

module.exports = Object.freeze({
  BUILDER_BROWSER_SESSION_REGISTRY_VERSION,
  BuilderBrowserSessionRegistryError,
  createBuilderBrowserSessionRegistry,
});
