'use strict';

const { types: utilTypes } = require('node:util');

const {
  createBuilderGenerationHostAdapter,
} = require('./builder-generation-host-adapter.cjs');
const {
  sanitizeBuilderProviderConfig,
} = require('./builder-provider-config.cjs');

const BUILDER_GENERATION_MAIN_SERVICE_VERSION = 'builder-generation-main-service.v1';
const OPTION_KEYS = Object.freeze([
  'providerConfigRepository',
  'projectRevisionRepository',
  'transport',
]);
const ERROR_MESSAGE = 'AI project generation is unavailable.';

class BuilderGenerationMainServiceError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderGenerationMainServiceError';
    this.code = 'builder_generation_service_unavailable';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderGenerationMainServiceError();
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownMethod(value, key) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
  ) fail();
  return descriptor.value;
}

function sanitizeOptions(value) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length < 2
    || keys.length > OPTION_KEYS.length
    || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    || !keys.includes('providerConfigRepository')
    || !keys.includes('projectRevisionRepository')
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  if (keys.includes('transport') && typeof descriptors.transport.value !== 'function') fail();
  return Object.freeze({
    providerConfigRepository: descriptors.providerConfigRepository.value,
    projectRevisionRepository: descriptors.projectRevisionRepository.value,
    ...(keys.includes('transport') ? { transport: descriptors.transport.value } : {}),
  });
}

function sanitizeBoundAuthority(value) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2
    || keys.some((key) => typeof key !== 'string' || !['readProviderConfig', 'resolveSecret'].includes(key))
  ) fail();
  return Object.freeze({
    receiver: value,
    readProviderConfig: ownMethod(value, 'readProviderConfig'),
    resolveSecret: ownMethod(value, 'resolveSecret'),
  });
}

function createBuilderGenerationMainService(rawOptions) {
  const options = sanitizeOptions(rawOptions);
  const bindCurrentAuthority = ownMethod(options.providerConfigRepository, 'bind_current_authority');
  const loadRevision = ownMethod(options.projectRevisionRepository, 'load_revision');
  let pendingAuthority = null;
  let bindingAuthority = false;

  function readProviderConfig() {
    if (bindingAuthority) fail();
    bindingAuthority = true;
    pendingAuthority = null;
    try {
      const authority = sanitizeBoundAuthority(Reflect.apply(
        bindCurrentAuthority,
        options.providerConfigRepository,
        [],
      ));
      const config = sanitizeBuilderProviderConfig(Reflect.apply(
        authority.readProviderConfig,
        authority.receiver,
        [],
      ));
      pendingAuthority = authority;
      return config;
    } finally {
      bindingAuthority = false;
    }
  }

  function resolveSecret(secretRef) {
    const authority = pendingAuthority;
    pendingAuthority = null;
    if (authority === null) fail();
    return Reflect.apply(authority.resolveSecret, authority.receiver, [secretRef]);
  }

  function loadParentRevision(request) {
    return Reflect.apply(loadRevision, options.projectRevisionRepository, [request]);
  }

  const host = createBuilderGenerationHostAdapter({
    readProviderConfig,
    resolveSecret,
    loadParentRevision,
    ...(Object.hasOwn(options, 'transport') ? { transport: options.transport } : {}),
  });

  return Object.freeze({
    service_version: BUILDER_GENERATION_MAIN_SERVICE_VERSION,
    generate: host.generate,
    cancel: host.cancel,
    availability: host.availability,
    authority: Object.freeze({
      provider_config_snapshot_bound: true,
      parent_revision_main_repository: true,
      credential_exposed_to_renderer: false,
      electron_registration: false,
      preload_exposure: false,
    }),
  });
}

module.exports = Object.freeze({
  BUILDER_GENERATION_MAIN_SERVICE_VERSION,
  BuilderGenerationMainServiceError,
  createBuilderGenerationMainService,
});
