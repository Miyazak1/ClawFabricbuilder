'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder: NodeTextDecoder, types: utilTypes } = require('node:util');

const {
  BUILDER_PROVIDER_SECRET_REF_VERSION,
  BUILDER_PROVIDER_ID,
  BUILDER_PROVIDER_SECRET_ID,
} = require('./builder-provider-config.cjs');

const BUILDER_PROVIDER_SECRET_STORE_VERSION = 'builder-provider-secret-store.v1';
const BUILDER_PROVIDER_ENCRYPTED_SECRET_VERSION = 'builder-provider-encrypted-secret.v1';
const BUILDER_PROVIDER_SECRET_BINDING_VERSION = 'builder-provider-secret-binding.v1';
const BUILDER_PROVIDER_SECRET_RESOLUTION_VERSION = 'builder-provider-secret-resolution.v1';
const SECRET_DIRECTORY_NAME = 'builder-provider-secrets-v1';
const MAX_SECRET_BYTES = 16 * 1024;
const MAX_SECRET_BLOB_BYTES = 64 * 1024;
const NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UTF8_DECODER = new NodeTextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const SECRET_REF_KEYS = Object.freeze(['ref_version', 'provider_id', 'secret_id']);
const SECRET_WRITE_KEYS = Object.freeze(['secret_ref', 'credential']);
const SECRET_RESOLVE_KEYS = Object.freeze(['secret_ref', 'encrypted_secret_digest']);
const SECRET_BLOB_BODY_KEYS = Object.freeze([
  'encrypted_secret_version', 'secret_ref', 'ciphertext_encoding',
  'encrypted_credential', 'safe_storage_backend',
]);
const SECRET_BLOB_KEYS = Object.freeze([...SECRET_BLOB_BODY_KEYS, 'encrypted_secret_digest']);
const SECRET_BINDING_KEYS = Object.freeze([
  'binding_version', 'secret_ref', 'encrypted_secret_digest', 'secret_store_version',
]);

const ERROR_MESSAGES = Object.freeze({
  builder_provider_secret_store_invalid: 'AI provider secret storage could not verify the request.',
  builder_provider_secret_store_unavailable: 'AI provider secret storage is unavailable.',
  builder_provider_secret_store_integrity_failed: 'AI provider secret storage could not be verified.',
  builder_provider_secret_store_persistence_failed: 'AI provider secret could not be saved.',
  builder_provider_secret_store_cleanup_failed: 'AI provider secret storage could not be cleaned up safely.',
});

class BuilderProviderSecretStoreError extends Error {
  constructor(code = 'builder_provider_secret_store_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'builder_provider_secret_store_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProviderSecretStoreError';
    this.code = selected;
    this.retryable = [
      'builder_provider_secret_store_unavailable',
      'builder_provider_secret_store_persistence_failed',
      'builder_provider_secret_store_cleanup_failed',
    ].includes(selected);
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderProviderSecretStoreError(code);
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
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
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

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function hasDisallowedControl(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function safeCredential(value, code = 'builder_provider_secret_store_invalid') {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > MAX_SECRET_BYTES
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value)
    || Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES
  ) fail(code);
  return value;
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
  ) fail('builder_provider_secret_store_invalid');
  return value;
}

function safeDigest(value, code = 'builder_provider_secret_store_invalid') {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail(code);
  return value;
}

function sanitizeSecretRef(value, code = 'builder_provider_secret_store_invalid') {
  exactObject(value, SECRET_REF_KEYS, code);
  if (
    ownValue(value, 'ref_version', code) !== BUILDER_PROVIDER_SECRET_REF_VERSION
    || ownValue(value, 'provider_id', code) !== BUILDER_PROVIDER_ID
    || ownValue(value, 'secret_id', code) !== BUILDER_PROVIDER_SECRET_ID
  ) fail(code);
  return freezeDeep({
    ref_version: BUILDER_PROVIDER_SECRET_REF_VERSION,
    provider_id: BUILDER_PROVIDER_ID,
    secret_id: BUILDER_PROVIDER_SECRET_ID,
  });
}

function sanitizeBinding(value, code = 'builder_provider_secret_store_integrity_failed') {
  exactObject(value, SECRET_BINDING_KEYS, code);
  if (
    ownValue(value, 'binding_version', code) !== BUILDER_PROVIDER_SECRET_BINDING_VERSION
    || ownValue(value, 'secret_store_version', code) !== BUILDER_PROVIDER_SECRET_STORE_VERSION
  ) fail(code);
  return freezeDeep({
    binding_version: BUILDER_PROVIDER_SECRET_BINDING_VERSION,
    secret_ref: sanitizeSecretRef(ownValue(value, 'secret_ref', code), code),
    encrypted_secret_digest: safeDigest(ownValue(value, 'encrypted_secret_digest', code), code),
    secret_store_version: BUILDER_PROVIDER_SECRET_STORE_VERSION,
  });
}

function blobBody(source, code) {
  exactObject(source, SECRET_BLOB_BODY_KEYS, code);
  return blobBodyFields(source, code);
}

function blobBodyFields(source, code) {
  const encryptedCredential = ownValue(source, 'encrypted_credential', code);
  if (
    ownValue(source, 'encrypted_secret_version', code) !== BUILDER_PROVIDER_ENCRYPTED_SECRET_VERSION
    || ownValue(source, 'ciphertext_encoding', code) !== 'base64'
    || ownValue(source, 'safe_storage_backend', code) !== 'electron.safeStorage'
    || typeof encryptedCredential !== 'string'
    || encryptedCredential.length === 0
    || encryptedCredential.length > MAX_SECRET_BLOB_BYTES
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encryptedCredential)
  ) fail(code);
  return freezeDeep({
    encrypted_secret_version: BUILDER_PROVIDER_ENCRYPTED_SECRET_VERSION,
    secret_ref: sanitizeSecretRef(ownValue(source, 'secret_ref', code), code),
    ciphertext_encoding: 'base64',
    encrypted_credential: encryptedCredential,
    safe_storage_backend: 'electron.safeStorage',
  });
}

function createSecretBlob(value) {
  const body = blobBody(value, 'builder_provider_secret_store_invalid');
  return freezeDeep({
    ...body,
    encrypted_secret_digest: sha256Canonical(body, 'builder_provider_secret_store_invalid'),
  });
}

function sanitizeSecretBlob(value) {
  exactObject(value, SECRET_BLOB_KEYS, 'builder_provider_secret_store_integrity_failed');
  const body = blobBodyFields(value, 'builder_provider_secret_store_integrity_failed');
  const encryptedSecretDigest = safeDigest(
    ownValue(value, 'encrypted_secret_digest', 'builder_provider_secret_store_integrity_failed'),
    'builder_provider_secret_store_integrity_failed',
  );
  if (sha256Canonical(body, 'builder_provider_secret_store_integrity_failed') !== encryptedSecretDigest) {
    fail('builder_provider_secret_store_integrity_failed');
  }
  return freezeDeep({ ...body, encrypted_secret_digest: encryptedSecretDigest });
}

function serializeBlob(value) {
  return `${canonicalJson(sanitizeSecretBlob(value), 'builder_provider_secret_store_integrity_failed')}\n`;
}

function decodeStrictUtf8(bytes, code) {
  try {
    const text = UTF8_DECODER.decode(bytes);
    if (!Buffer.from(text, 'utf8').equals(bytes)) fail(code);
    return text;
  } catch (error) {
    if (error instanceof BuilderProviderSecretStoreError) throw error;
    fail(code);
  }
}

function assertDirectory(directory, allowCreate) {
  if (!fs.existsSync(directory)) {
    if (!allowCreate) fail('builder_provider_secret_store_invalid');
    try { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); } catch (error) {
      if (!error || error.code !== 'EEXIST') fail('builder_provider_secret_store_persistence_failed');
    }
  }
  let info;
  try { info = fs.lstatSync(directory); } catch { fail('builder_provider_secret_store_persistence_failed'); }
  if (!info.isDirectory() || info.isSymbolicLink()) fail('builder_provider_secret_store_integrity_failed');
}

function captureDirectoryIdentity(directory) {
  let info;
  let realPath;
  try {
    info = fs.lstatSync(directory, { bigint: true });
    realPath = fs.realpathSync.native(directory);
  } catch {
    fail('builder_provider_secret_store_integrity_failed');
  }
  if (!info.isDirectory() || info.isSymbolicLink() || realPath !== directory) {
    fail('builder_provider_secret_store_integrity_failed');
  }
  return freezeDeep({ path: directory, dev: info.dev, ino: info.ino });
}

function assertDirectoryIdentity(identity) {
  const current = captureDirectoryIdentity(identity.path);
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    fail('builder_provider_secret_store_integrity_failed');
  }
}

function readBoundedFile(filePath, notFoundCode) {
  let descriptor = null;
  try {
    const pathInfo = fs.lstatSync(filePath, { bigint: true });
    if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) fail('builder_provider_secret_store_integrity_failed');
    descriptor = fs.openSync(filePath, 'r');
    const descriptorInfo = fs.fstatSync(descriptor, { bigint: true });
    if (
      !descriptorInfo.isFile()
      || descriptorInfo.dev !== pathInfo.dev
      || descriptorInfo.ino !== pathInfo.ino
      || descriptorInfo.size < 1n
      || descriptorInfo.size > BigInt(MAX_SECRET_BLOB_BYTES)
    ) fail('builder_provider_secret_store_integrity_failed');
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
    ) fail('builder_provider_secret_store_integrity_failed');
    fs.closeSync(descriptor);
    descriptor = null;
    return boundedBytes.subarray(0, expectedBytes);
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* stable bounded error below */ }
    }
    if (error instanceof BuilderProviderSecretStoreError) throw error;
    if (error && typeof error === 'object' && error.code === 'ENOENT') fail(notFoundCode);
    fail('builder_provider_secret_store_integrity_failed');
  }
}

function readBlob(filePath, notFoundCode = 'builder_provider_secret_store_unavailable') {
  const text = decodeStrictUtf8(readBoundedFile(filePath, notFoundCode), 'builder_provider_secret_store_integrity_failed');
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('builder_provider_secret_store_integrity_failed'); }
  const blob = sanitizeSecretBlob(parsed);
  if (serializeBlob(blob) !== text) fail('builder_provider_secret_store_integrity_failed');
  return blob;
}

function safeNonce() {
  const nonce = nodeCrypto.randomUUID();
  if (!NONCE_PATTERN.test(nonce)) fail('builder_provider_secret_store_persistence_failed');
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

function encryptedSecretPath(context, encryptedSecretDigest) {
  return path.join(context.secrets_directory, `${safeDigest(
    encryptedSecretDigest,
    'builder_provider_secret_store_integrity_failed',
  ).slice(7)}.json`);
}

function sanitizeSafeStorage(value) {
  if (
    value === null
    || typeof value !== 'object'
    || utilTypes.isProxy(value)
    || typeof value.isEncryptionAvailable !== 'function'
    || typeof value.encryptString !== 'function'
    || typeof value.decryptString !== 'function'
  ) fail('builder_provider_secret_store_unavailable');
  let available;
  try { available = Reflect.apply(value.isEncryptionAvailable, value, []); } catch {
    fail('builder_provider_secret_store_unavailable');
  }
  if (available !== true) fail('builder_provider_secret_store_unavailable');
  return value;
}

function defaultSafeStorage() {
  try {
    return sanitizeSafeStorage(require('electron').safeStorage);
  } catch (error) {
    if (error instanceof BuilderProviderSecretStoreError) throw error;
    fail('builder_provider_secret_store_unavailable');
  }
}

function encryptCredential(safeStorage, credential) {
  let encrypted;
  try { encrypted = Reflect.apply(safeStorage.encryptString, safeStorage, [credential]); } catch {
    fail('builder_provider_secret_store_unavailable');
  }
  if (!Buffer.isBuffer(encrypted) || encrypted.length === 0 || encrypted.length > MAX_SECRET_BLOB_BYTES) {
    fail('builder_provider_secret_store_unavailable');
  }
  return encrypted;
}

function decryptCredential(safeStorage, blob) {
  let credential;
  try {
    credential = Reflect.apply(
      safeStorage.decryptString,
      safeStorage,
      [Buffer.from(blob.encrypted_credential, 'base64')],
    );
  } catch {
    fail('builder_provider_secret_store_integrity_failed');
  }
  return safeCredential(credential, 'builder_provider_secret_store_integrity_failed');
}

function publishBlob(context, blob) {
  assertDirectoryIdentity(context.root_identity);
  assertDirectoryIdentity(context.secrets_identity);
  const targetPath = encryptedSecretPath(context, blob.encrypted_secret_digest);
  const tempPath = path.join(context.secrets_directory, `.${blob.encrypted_secret_digest.slice(7)}-${safeNonce()}.pending`);
  const text = serializeBlob(blob);
  let descriptor = null;
  let tempExists = false;
  try {
    descriptor = fs.openSync(tempPath, 'wx');
    tempExists = true;
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, targetPath);
    tempExists = false;
    const parentDirectoryFsync = tryFsyncDirectory(context.secrets_directory);
    const reopened = readBlob(targetPath, 'builder_provider_secret_store_integrity_failed');
    if (reopened.encrypted_secret_digest !== blob.encrypted_secret_digest || serializeBlob(reopened) !== text) {
      fail('builder_provider_secret_store_integrity_failed');
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
      try { fs.unlinkSync(tempPath); } catch { fail('builder_provider_secret_store_cleanup_failed'); }
    }
    if (error instanceof BuilderProviderSecretStoreError) throw error;
    fail('builder_provider_secret_store_persistence_failed');
  }
}

function createBinding(blob) {
  return freezeDeep({
    binding_version: BUILDER_PROVIDER_SECRET_BINDING_VERSION,
    secret_ref: blob.secret_ref,
    encrypted_secret_digest: blob.encrypted_secret_digest,
    secret_store_version: BUILDER_PROVIDER_SECRET_STORE_VERSION,
  });
}

function normalizeError(error) {
  let code = 'builder_provider_secret_store_unavailable';
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
    code = 'builder_provider_secret_store_unavailable';
  }
  return new BuilderProviderSecretStoreError(code);
}

function createBuilderProviderSecretStore(rootPath, options = {}) {
  const requestedRoot = safeRootPath(rootPath);
  assertDirectory(requestedRoot, false);
  let root;
  try { root = safeRootPath(fs.realpathSync.native(requestedRoot)); } catch {
    fail('builder_provider_secret_store_invalid');
  }
  const safeStorage = sanitizeSafeStorage(options.safeStorage === undefined ? defaultSafeStorage() : options.safeStorage);
  const secretsDirectory = path.join(root, SECRET_DIRECTORY_NAME);
  assertDirectory(secretsDirectory, true);
  const context = freezeDeep({
    root,
    secrets_directory: secretsDirectory,
    root_identity: captureDirectoryIdentity(root),
    secrets_identity: captureDirectoryIdentity(secretsDirectory),
  });

  return freezeDeep({
    store_version: BUILDER_PROVIDER_SECRET_STORE_VERSION,

    publish(rawRequest) {
      try {
        exactObject(rawRequest, SECRET_WRITE_KEYS, 'builder_provider_secret_store_invalid');
        const secretRef = sanitizeSecretRef(ownValue(rawRequest, 'secret_ref', 'builder_provider_secret_store_invalid'));
        const credential = safeCredential(ownValue(rawRequest, 'credential', 'builder_provider_secret_store_invalid'));
        const blob = createSecretBlob({
          encrypted_secret_version: BUILDER_PROVIDER_ENCRYPTED_SECRET_VERSION,
          secret_ref: secretRef,
          ciphertext_encoding: 'base64',
          encrypted_credential: encryptCredential(safeStorage, credential).toString('base64'),
          safe_storage_backend: 'electron.safeStorage',
        });
        const published = publishBlob(context, blob);
        const reopenedCredential = decryptCredential(safeStorage, published.reopened);
        if (reopenedCredential !== credential) fail('builder_provider_secret_store_integrity_failed');
        return freezeDeep({
          result_version: BUILDER_PROVIDER_SECRET_STORE_VERSION,
          secret_binding: createBinding(published.reopened),
          persistence_evidence: {
            evidence_version: BUILDER_PROVIDER_SECRET_STORE_VERSION,
            operation: 'secret_published',
            authority_scope: 'single_main_process_serialized_provider_settings',
            cross_process_cas: 'not_proven',
            sudden_power_loss_durability: 'not_proven',
            secret_file_fsync: published.file_fsync,
            secret_publish: published.publish,
            secret_parent_directory_fsync: published.parent_directory_fsync,
            reopened_hash_verified: true,
            decryption_verified: true,
          },
        });
      } catch (error) {
        throw normalizeError(error);
      }
    },

    resolve(rawRequest) {
      try {
        exactObject(rawRequest, SECRET_RESOLVE_KEYS, 'builder_provider_secret_store_invalid');
        const secretRef = sanitizeSecretRef(ownValue(rawRequest, 'secret_ref', 'builder_provider_secret_store_invalid'));
        const encryptedSecretDigest = safeDigest(
          ownValue(rawRequest, 'encrypted_secret_digest', 'builder_provider_secret_store_invalid'),
        );
        assertDirectoryIdentity(context.root_identity);
        assertDirectoryIdentity(context.secrets_identity);
        const blob = readBlob(encryptedSecretPath(context, encryptedSecretDigest));
        if (
          blob.secret_ref.ref_version !== secretRef.ref_version
          || blob.secret_ref.provider_id !== secretRef.provider_id
          || blob.secret_ref.secret_id !== secretRef.secret_id
        ) fail('builder_provider_secret_store_integrity_failed');
        return freezeDeep({
          resolution_version: BUILDER_PROVIDER_SECRET_RESOLUTION_VERSION,
          secret_ref: secretRef,
          credential: decryptCredential(safeStorage, blob),
        });
      } catch (error) {
        throw normalizeError(error);
      }
    },

    verify_binding(rawBinding) {
      try {
        const binding = sanitizeBinding(rawBinding);
        const resolution = this.resolve({
          secret_ref: binding.secret_ref,
          encrypted_secret_digest: binding.encrypted_secret_digest,
        });
        if (
          resolution.secret_ref.ref_version !== binding.secret_ref.ref_version
          || resolution.secret_ref.provider_id !== binding.secret_ref.provider_id
          || resolution.secret_ref.secret_id !== binding.secret_ref.secret_id
        ) fail('builder_provider_secret_store_integrity_failed');
        return binding;
      } catch (error) {
        throw normalizeError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_PROVIDER_SECRET_STORE_VERSION,
  BUILDER_PROVIDER_ENCRYPTED_SECRET_VERSION,
  BUILDER_PROVIDER_SECRET_BINDING_VERSION,
  BUILDER_PROVIDER_SECRET_RESOLUTION_VERSION,
  SECRET_DIRECTORY_NAME,
  BuilderProviderSecretStoreError,
  createBuilderProviderSecretStore,
  sanitizeBuilderProviderSecretBinding: sanitizeBinding,
});
