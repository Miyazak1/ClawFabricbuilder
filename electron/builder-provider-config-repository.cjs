'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder: NodeTextDecoder, types: utilTypes } = require('node:util');

const {
  createBuilderProviderConfig,
  sanitizeBuilderProviderConfig,
} = require('./builder-provider-config.cjs');
const {
  BUILDER_PROVIDER_SECRET_STORE_VERSION,
  BUILDER_PROVIDER_SECRET_BINDING_VERSION,
  createBuilderProviderSecretStore,
  sanitizeBuilderProviderSecretBinding,
} = require('./builder-provider-secret-store.cjs');

const BUILDER_PROVIDER_CONFIG_REPOSITORY_VERSION = 'builder-provider-config-repository.v1';
const CONFIG_DIRECTORY_NAME = 'builder-provider-config-v1';
const CURRENT_FILE_NAME = 'current.json';
const MAX_CURRENT_BYTES = 128 * 1024;
const NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const WRITE_KEYS = Object.freeze(['config', 'credential']);
const CURRENT_BODY_KEYS = Object.freeze(['repository_version', 'config', 'secret_binding']);
const CURRENT_KEYS = Object.freeze([...CURRENT_BODY_KEYS, 'repository_digest']);
const UTF8_DECODER = new NodeTextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const ERROR_MESSAGES = Object.freeze({
  builder_provider_config_repository_invalid: 'AI provider settings could not verify the request.',
  builder_provider_config_repository_not_found: 'AI provider settings are not configured.',
  builder_provider_config_repository_unavailable: 'AI provider settings are unavailable.',
  builder_provider_config_repository_integrity_failed: 'AI provider settings could not be verified.',
  builder_provider_config_repository_persistence_failed: 'AI provider settings could not be saved.',
  builder_provider_config_repository_cleanup_failed: 'AI provider settings storage could not be cleaned up safely.',
});

class BuilderProviderConfigRepositoryError extends Error {
  constructor(code = 'builder_provider_config_repository_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'builder_provider_config_repository_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProviderConfigRepositoryError';
    this.code = selected;
    this.retryable = [
      'builder_provider_config_repository_unavailable',
      'builder_provider_config_repository_persistence_failed',
      'builder_provider_config_repository_cleanup_failed',
    ].includes(selected);
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderProviderConfigRepositoryError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys, code) {
  if (!isPlainObject(value)) fail(code);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) fail(code);
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  }
  return value;
}

function ownValue(value, key, code) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value, code) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, code)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(ownValue(value, key, code), code)}`
    )).join(',')}}`;
  }
  fail(code);
}

function sha256Canonical(value, code) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value, code), 'utf8').digest('hex')}`;
}

function safeRootPath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.trim() !== value
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail('builder_provider_config_repository_invalid');
  return value;
}

function assertDirectory(directory, allowCreate) {
  if (!fs.existsSync(directory)) {
    if (!allowCreate) fail('builder_provider_config_repository_invalid');
    try { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); } catch (error) {
      if (!error || error.code !== 'EEXIST') fail('builder_provider_config_repository_persistence_failed');
    }
  }
  let info;
  try { info = fs.lstatSync(directory); } catch { fail('builder_provider_config_repository_persistence_failed'); }
  if (!info.isDirectory() || info.isSymbolicLink()) fail('builder_provider_config_repository_integrity_failed');
}

function captureDirectoryIdentity(directory) {
  let info;
  let realPath;
  try {
    info = fs.lstatSync(directory, { bigint: true });
    realPath = fs.realpathSync.native(directory);
  } catch {
    fail('builder_provider_config_repository_integrity_failed');
  }
  if (!info.isDirectory() || info.isSymbolicLink() || realPath !== directory) {
    fail('builder_provider_config_repository_integrity_failed');
  }
  return freezeDeep({ path: directory, dev: info.dev, ino: info.ino });
}

function assertDirectoryIdentity(identity) {
  const current = captureDirectoryIdentity(identity.path);
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    fail('builder_provider_config_repository_integrity_failed');
  }
}

function currentBody(source, code) {
  exactObject(source, CURRENT_BODY_KEYS, code);
  return currentBodyFields(source, code);
}

function currentBodyFields(source, code) {
  if (ownValue(source, 'repository_version', code) !== BUILDER_PROVIDER_CONFIG_REPOSITORY_VERSION) fail(code);
  let config;
  let secretBinding;
  try {
    config = sanitizeBuilderProviderConfig(ownValue(source, 'config', code));
    secretBinding = sanitizeBuilderProviderSecretBinding(ownValue(source, 'secret_binding', code));
  } catch {
    fail(code);
  }
  if (
    secretBinding.binding_version !== BUILDER_PROVIDER_SECRET_BINDING_VERSION
    || secretBinding.secret_store_version !== BUILDER_PROVIDER_SECRET_STORE_VERSION
    || secretBinding.secret_ref.ref_version !== config.secret_ref.ref_version
    || secretBinding.secret_ref.provider_id !== config.secret_ref.provider_id
    || secretBinding.secret_ref.secret_id !== config.secret_ref.secret_id
  ) fail(code);
  return freezeDeep({
    repository_version: BUILDER_PROVIDER_CONFIG_REPOSITORY_VERSION,
    config,
    secret_binding: secretBinding,
  });
}

function createCurrentEnvelope(value) {
  const body = currentBody(value, 'builder_provider_config_repository_invalid');
  return freezeDeep({
    ...body,
    repository_digest: sha256Canonical(body, 'builder_provider_config_repository_invalid'),
  });
}

function sanitizeCurrentEnvelope(value) {
  exactObject(value, CURRENT_KEYS, 'builder_provider_config_repository_integrity_failed');
  const body = currentBodyFields(value, 'builder_provider_config_repository_integrity_failed');
  const repositoryDigest = ownValue(value, 'repository_digest', 'builder_provider_config_repository_integrity_failed');
  if (
    typeof repositoryDigest !== 'string'
    || !DIGEST_PATTERN.test(repositoryDigest)
    || sha256Canonical(body, 'builder_provider_config_repository_integrity_failed') !== repositoryDigest
  ) fail('builder_provider_config_repository_integrity_failed');
  return freezeDeep({ ...body, repository_digest: repositoryDigest });
}

function serializeCurrent(value) {
  return `${canonicalJson(sanitizeCurrentEnvelope(value), 'builder_provider_config_repository_integrity_failed')}\n`;
}

function decodeStrictUtf8(bytes, code) {
  try {
    const text = UTF8_DECODER.decode(bytes);
    if (!Buffer.from(text, 'utf8').equals(bytes)) fail(code);
    return text;
  } catch (error) {
    if (error instanceof BuilderProviderConfigRepositoryError) throw error;
    fail(code);
  }
}

function readBoundedFile(filePath, notFoundCode) {
  let descriptor = null;
  try {
    const pathInfo = fs.lstatSync(filePath, { bigint: true });
    if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) fail('builder_provider_config_repository_integrity_failed');
    descriptor = fs.openSync(filePath, 'r');
    const descriptorInfo = fs.fstatSync(descriptor, { bigint: true });
    if (
      !descriptorInfo.isFile()
      || descriptorInfo.dev !== pathInfo.dev
      || descriptorInfo.ino !== pathInfo.ino
      || descriptorInfo.size < 1n
      || descriptorInfo.size > BigInt(MAX_CURRENT_BYTES)
    ) fail('builder_provider_config_repository_integrity_failed');
    const expectedBytes = Number(descriptorInfo.size);
    const boundedBytes = Buffer.allocUnsafe(expectedBytes + 1);
    const bytesRead = fs.readSync(descriptor, boundedBytes, 0, boundedBytes.length, 0);
    const reopenedInfo = fs.fstatSync(descriptor, { bigint: true });
    if (
      bytesRead !== expectedBytes
      || !reopenedInfo.isFile()
      || reopenedInfo.dev !== descriptorInfo.dev
      || reopenedInfo.ino !== descriptorInfo.ino
      || reopenedInfo.size !== descriptorInfo.size
    ) fail('builder_provider_config_repository_integrity_failed');
    fs.closeSync(descriptor);
    descriptor = null;
    return boundedBytes.subarray(0, expectedBytes);
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* stable bounded error below */ }
    }
    if (error instanceof BuilderProviderConfigRepositoryError) throw error;
    if (error && typeof error === 'object' && error.code === 'ENOENT') fail(notFoundCode);
    fail('builder_provider_config_repository_integrity_failed');
  }
}

function readCurrentFile(filePath, notFoundCode = 'builder_provider_config_repository_unavailable') {
  const text = decodeStrictUtf8(readBoundedFile(filePath, notFoundCode), 'builder_provider_config_repository_integrity_failed');
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('builder_provider_config_repository_integrity_failed'); }
  const current = sanitizeCurrentEnvelope(parsed);
  if (serializeCurrent(current) !== text) fail('builder_provider_config_repository_integrity_failed');
  return current;
}

function safeNonce() {
  const nonce = nodeCrypto.randomUUID();
  if (!NONCE_PATTERN.test(nonce)) fail('builder_provider_config_repository_persistence_failed');
  return nonce;
}

function tryFsyncDirectory(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    return 'proven';
  } catch {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* remains not_proven */ }
    }
    return 'not_proven';
  }
}

function publishCurrent(context, envelope) {
  assertDirectoryIdentity(context.root_identity);
  assertDirectoryIdentity(context.config_identity);
  const text = serializeCurrent(envelope);
  const tempPath = path.join(context.config_directory, `.current-${safeNonce()}.pending`);
  let descriptor = null;
  let tempExists = false;
  try {
    descriptor = fs.openSync(tempPath, 'wx');
    tempExists = true;
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, context.current_path);
    tempExists = false;
    const parentDirectoryFsync = tryFsyncDirectory(context.config_directory);
    const reopened = readCurrentFile(context.current_path, 'builder_provider_config_repository_integrity_failed');
    if (reopened.repository_digest !== envelope.repository_digest || serializeCurrent(reopened) !== text) {
      fail('builder_provider_config_repository_integrity_failed');
    }
    return freezeDeep({
      file_fsync: 'proven',
      publish: 'same_directory_replace_reopened',
      parent_directory_fsync: parentDirectoryFsync,
      reopened,
    });
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* exact cleanup below */ }
    }
    if (tempExists) {
      try { fs.unlinkSync(tempPath); } catch { fail('builder_provider_config_repository_cleanup_failed'); }
    }
    if (error instanceof BuilderProviderConfigRepositoryError) throw error;
    fail('builder_provider_config_repository_persistence_failed');
  }
}

function readVerifiedCurrent(context, secretStore, notFoundCode = 'builder_provider_config_repository_unavailable') {
  assertDirectoryIdentity(context.root_identity);
  assertDirectoryIdentity(context.config_identity);
  const current = readCurrentFile(context.current_path, notFoundCode);
  secretStore.verify_binding(current.secret_binding);
  return current;
}

function resultEnvelope(operation, current, evidence) {
  return freezeDeep({
    result_version: BUILDER_PROVIDER_CONFIG_REPOSITORY_VERSION,
    config: current.config,
    secret_binding: current.secret_binding,
    restart_restore: operation === 'current_loaded',
    persistence_evidence: {
      evidence_version: BUILDER_PROVIDER_CONFIG_REPOSITORY_VERSION,
      operation,
      authority_scope: 'single_main_process_serialized_provider_settings',
      cross_process_cas: 'not_proven',
      sudden_power_loss_durability: 'not_proven',
      secret_file_fsync: evidence.secret_file_fsync,
      secret_publish: evidence.secret_publish,
      secret_parent_directory_fsync: evidence.secret_parent_directory_fsync,
      config_file_fsync: evidence.config_file_fsync,
      config_publish: evidence.config_publish,
      config_parent_directory_fsync: evidence.config_parent_directory_fsync,
      reopened_hash_verified: true,
      decryption_verified: true,
      orphan_secret_cleanup: 'not_performed',
    },
  });
}

function normalizeError(error) {
  let code = 'builder_provider_config_repository_unavailable';
  try {
    if (
      error !== null
      && (typeof error === 'object' || typeof error === 'function')
      && !utilTypes.isProxy(error)
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
      if (
        descriptor
        && Object.hasOwn(descriptor, 'value')
        && typeof descriptor.value === 'string'
        && Object.hasOwn(ERROR_MESSAGES, descriptor.value)
      ) code = descriptor.value;
    }
  } catch {
    code = 'builder_provider_config_repository_unavailable';
  }
  return new BuilderProviderConfigRepositoryError(code);
}

function createBuilderProviderConfigRepository(rootPath, options = {}) {
  const requestedRoot = safeRootPath(rootPath);
  assertDirectory(requestedRoot, false);
  let root;
  try { root = safeRootPath(fs.realpathSync.native(requestedRoot)); } catch {
    fail('builder_provider_config_repository_invalid');
  }
  const secretStore = options.secretStore === undefined
    ? createBuilderProviderSecretStore(root)
    : options.secretStore;
  if (
    secretStore === null
    || typeof secretStore !== 'object'
    || typeof secretStore.publish !== 'function'
    || typeof secretStore.resolve !== 'function'
    || typeof secretStore.verify_binding !== 'function'
  ) fail('builder_provider_config_repository_unavailable');
  const configDirectory = path.join(root, CONFIG_DIRECTORY_NAME);
  assertDirectory(configDirectory, true);
  const context = freezeDeep({
    root,
    config_directory: configDirectory,
    current_path: path.join(configDirectory, CURRENT_FILE_NAME),
    root_identity: captureDirectoryIdentity(root),
    config_identity: captureDirectoryIdentity(configDirectory),
  });

  return freezeDeep({
    repository_version: BUILDER_PROVIDER_CONFIG_REPOSITORY_VERSION,

    write_current(rawRequest) {
      try {
        exactObject(rawRequest, WRITE_KEYS, 'builder_provider_config_repository_invalid');
        let config;
        try {
          config = createBuilderProviderConfig(ownValue(rawRequest, 'config', 'builder_provider_config_repository_invalid'));
        } catch {
          fail('builder_provider_config_repository_invalid');
        }
        const secretResult = secretStore.publish({
          secret_ref: config.secret_ref,
          credential: ownValue(rawRequest, 'credential', 'builder_provider_config_repository_invalid'),
        });
        const current = createCurrentEnvelope({
          repository_version: BUILDER_PROVIDER_CONFIG_REPOSITORY_VERSION,
          config,
          secret_binding: secretResult.secret_binding,
        });
        const published = publishCurrent(context, current);
        secretStore.verify_binding(published.reopened.secret_binding);
        return resultEnvelope('current_written', published.reopened, {
          secret_file_fsync: secretResult.persistence_evidence.secret_file_fsync,
          secret_publish: secretResult.persistence_evidence.secret_publish,
          secret_parent_directory_fsync: secretResult.persistence_evidence.secret_parent_directory_fsync,
          config_file_fsync: published.file_fsync,
          config_publish: published.publish,
          config_parent_directory_fsync: published.parent_directory_fsync,
        });
      } catch (error) {
        throw normalizeError(error);
      }
    },

    read_current(...rawArguments) {
      try {
        if (rawArguments.length !== 0) fail('builder_provider_config_repository_invalid');
        const current = readVerifiedCurrent(
          context,
          secretStore,
          'builder_provider_config_repository_not_found',
        );
        return resultEnvelope('current_loaded', current, {
          secret_file_fsync: 'not_performed',
          secret_publish: 'not_performed',
          secret_parent_directory_fsync: 'not_performed',
          config_file_fsync: 'not_performed',
          config_publish: 'not_performed',
          config_parent_directory_fsync: 'not_performed',
        });
      } catch (error) {
        throw normalizeError(error);
      }
    },

    bind_current_authority(...rawArguments) {
      try {
        if (rawArguments.length !== 0) fail('builder_provider_config_repository_invalid');
        const current = readVerifiedCurrent(context, secretStore);
        return freezeDeep({
          readProviderConfig() {
            return current.config;
          },
          resolveSecret(rawSecretRef) {
            let requested;
            try {
              requested = sanitizeBuilderProviderSecretBinding({
                ...current.secret_binding,
                secret_ref: rawSecretRef,
              });
            } catch {
              fail('builder_provider_config_repository_integrity_failed');
            }
            if (
              requested.secret_ref.ref_version !== current.secret_binding.secret_ref.ref_version
              || requested.secret_ref.provider_id !== current.secret_binding.secret_ref.provider_id
              || requested.secret_ref.secret_id !== current.secret_binding.secret_ref.secret_id
            ) fail('builder_provider_config_repository_integrity_failed');
            return secretStore.resolve({
              secret_ref: current.secret_binding.secret_ref,
              encrypted_secret_digest: current.secret_binding.encrypted_secret_digest,
            });
          },
        });
      } catch (error) {
        throw normalizeError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_PROVIDER_CONFIG_REPOSITORY_VERSION,
  CONFIG_DIRECTORY_NAME,
  CURRENT_FILE_NAME,
  BuilderProviderConfigRepositoryError,
  createBuilderProviderConfigRepository,
});
