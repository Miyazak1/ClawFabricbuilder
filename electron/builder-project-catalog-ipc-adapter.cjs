'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderProjectRevisionRepositoryError,
} = require('./builder-project-revision-repository.cjs');

const LIST_CURRENT_CHANNEL = 'clawfabric-builder:project-catalog:list-current';
const OPTION_KEYS = Object.freeze(['listCurrent', 'mainWindowRef']);

const ERROR_MESSAGES = Object.freeze({
  builder_project_catalog_forbidden: 'Saved projects are unavailable.',
  builder_project_catalog_invalid: 'The saved project request could not be verified.',
  builder_project_catalog_resource_exceeded: 'The saved project collection is too large to verify safely.',
  builder_project_catalog_integrity_failed: 'The saved project collection could not be verified.',
  builder_project_catalog_unavailable: 'Saved projects are unavailable.',
});

const REPOSITORY_ERROR_CODES = Object.freeze({
  builder_project_repository_invalid: 'builder_project_catalog_invalid',
  builder_project_repository_resource_exceeded: 'builder_project_catalog_resource_exceeded',
  builder_project_repository_integrity_failed: 'builder_project_catalog_integrity_failed',
});

class BuilderProjectCatalogIpcError extends Error {
  constructor(code = 'builder_project_catalog_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_project_catalog_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProjectCatalogIpcError';
    this.code = selected;
    this.retryable = selected === 'builder_project_catalog_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function normalizeError(error) {
  if (error instanceof BuilderProjectCatalogIpcError) return error;
  if (error instanceof BuilderProjectRevisionRepositoryError) {
    return new BuilderProjectCatalogIpcError(
      REPOSITORY_ERROR_CODES[error.code] ?? 'builder_project_catalog_unavailable',
    );
  }
  return new BuilderProjectCatalogIpcError();
}

function safeOptions(value) {
  if (value === null
    || typeof value !== 'object'
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new BuilderProjectCatalogIpcError('builder_project_catalog_unavailable');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== OPTION_KEYS.length
    || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))) {
    throw new BuilderProjectCatalogIpcError('builder_project_catalog_unavailable');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of OPTION_KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor
      || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'function') {
      throw new BuilderProjectCatalogIpcError('builder_project_catalog_unavailable');
    }
  }
  return Object.freeze({
    listCurrent: descriptors.listCurrent.value,
    mainWindowRef: descriptors.mainWindowRef.value,
  });
}

function activeWebContents(mainWindowRef) {
  try {
    const windowRef = mainWindowRef();
    if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) {
      return null;
    }
    const webContents = windowRef.webContents;
    if (!webContents
      || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) {
      return null;
    }
    return webContents;
  } catch {
    return null;
  }
}

function assertActiveSender(event, mainWindowRef) {
  const webContents = activeWebContents(mainWindowRef);
  if (!webContents || !event || event.sender !== webContents) {
    throw new BuilderProjectCatalogIpcError('builder_project_catalog_forbidden');
  }
}

function createBuilderProjectCatalogIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);

  async function invoke(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 0) {
        throw new BuilderProjectCatalogIpcError('builder_project_catalog_invalid');
      }
      return await options.listCurrent();
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    adapter_id: 'builder_project_catalog.read_only_ipc_adapter.v1',
    namespace: 'builderProjectCatalog',
    preload_namespace: 'window.clawfabricBuilder.projectCatalog',
    channels: Object.freeze({
      listCurrent: Object.freeze({
        channel: LIST_CURRENT_CHANNEL,
        method: 'listCurrent',
        invoke(event, ...rawArguments) {
          return invoke(event, rawArguments);
        },
      }),
    }),
    exposed_methods: Object.freeze(['listCurrent']),
    authority: Object.freeze({
      main_owned_repository: true,
      repository_method: 'list_current',
      read_only: true,
      active_renderer_required: true,
      payload: 'none',
      secondary_sanitizer: false,
      direct_electron_registration: false,
      direct_preload_exposure: false,
    }),
  });
}

module.exports = Object.freeze({
  LIST_CURRENT_CHANNEL,
  BuilderProjectCatalogIpcError,
  createBuilderProjectCatalogIpcAdapter,
});
