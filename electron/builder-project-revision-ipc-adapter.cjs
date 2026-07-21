'use strict';

const {
  BuilderProjectRevisionRepositoryError,
  createBuilderProjectRevisionRepository,
} = require('./builder-project-revision-repository.cjs');

const COMMIT_CHANNEL = 'clawfabric-builder:project-revisions:commit';
const LOAD_CURRENT_CHANNEL = 'clawfabric-builder:project-revisions:load-current';

const ERROR_MESSAGES = Object.freeze({
  builder_project_revisions_forbidden: 'Builder project storage is unavailable.',
  builder_project_revisions_invalid: 'The project request could not be verified.',
  builder_project_revisions_not_found: 'The saved project is unavailable.',
  builder_project_revisions_conflict: 'The project changed before it could be saved.',
  builder_project_revisions_integrity_failed: 'The saved project could not be verified.',
  builder_project_revisions_persistence_failed: 'The project could not be saved.',
  builder_project_revisions_unavailable: 'Builder project storage is unavailable.',
});

const REPOSITORY_ERROR_CODES = Object.freeze({
  builder_project_repository_invalid: 'builder_project_revisions_invalid',
  builder_project_repository_not_found: 'builder_project_revisions_not_found',
  builder_project_repository_conflict: 'builder_project_revisions_conflict',
  builder_project_repository_integrity_failed: 'builder_project_revisions_integrity_failed',
  builder_project_repository_persistence_failed: 'builder_project_revisions_persistence_failed',
  builder_project_repository_cleanup_failed: 'builder_project_revisions_persistence_failed',
});

class BuilderProjectRevisionIpcError extends Error {
  constructor(code = 'builder_project_revisions_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_project_revisions_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProjectRevisionIpcError';
    this.code = selected;
    this.retryable = selected === 'builder_project_revisions_persistence_failed'
      || selected === 'builder_project_revisions_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function normalizeError(error) {
  if (error instanceof BuilderProjectRevisionIpcError) return error;
  if (error instanceof BuilderProjectRevisionRepositoryError) {
    return new BuilderProjectRevisionIpcError(
      REPOSITORY_ERROR_CODES[error.code] ?? 'builder_project_revisions_unavailable',
    );
  }
  return new BuilderProjectRevisionIpcError();
}

function activeWebContents(mainWindowRef) {
  try {
    const windowRef = typeof mainWindowRef === 'function' ? mainWindowRef() : mainWindowRef;
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
    throw new BuilderProjectRevisionIpcError('builder_project_revisions_forbidden');
  }
}

function createBuilderProjectRevisionIpcAdapter(options = {}) {
  const mainWindowRef = options.mainWindowRef;
  let repository;
  try {
    repository = createBuilderProjectRevisionRepository(options.rootPath);
  } catch (error) {
    throw normalizeError(error);
  }

  async function invoke(event, operation) {
    try {
      assertActiveSender(event, mainWindowRef);
      return await operation();
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    adapter_id: 'builder_project_revisions.controlled_ipc_adapter.v1',
    namespace: 'builderProjectRevisions',
    preload_namespace: 'window.clawfabricBuilder.projectRevisions',
    channels: Object.freeze({
      commit: Object.freeze({
        channel: COMMIT_CHANNEL,
        method: 'commit',
        invoke(event, request) {
          return invoke(event, () => repository.commit(request));
        },
      }),
      loadCurrent: Object.freeze({
        channel: LOAD_CURRENT_CHANNEL,
        method: 'loadCurrent',
        invoke(event, request) {
          return invoke(event, () => repository.load_current(request));
        },
      }),
    }),
    exposed_methods: Object.freeze(['commit', 'loadCurrent']),
    authority: Object.freeze({
      host_constructed_repository: true,
      main_process_composition: 'not_evaluated',
      active_renderer_required: true,
      direct_electron_registration: false,
      direct_preload_exposure: false,
      generic_draft_authority_reused: false,
      generic_provider_authority_reused: false,
    }),
  });
}

module.exports = Object.freeze({
  COMMIT_CHANNEL,
  LOAD_CURRENT_CHANNEL,
  BuilderProjectRevisionIpcError,
  createBuilderProjectRevisionIpcAdapter,
});
