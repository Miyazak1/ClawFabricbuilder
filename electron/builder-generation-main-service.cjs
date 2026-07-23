'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  createBuilderConversationEvent,
} = require('./builder-conversation-records.cjs');
const {
  createBuilderGenerationHostAdapter,
} = require('./builder-generation-host-adapter.cjs');
const {
  sanitizeBuilderGenerationRequest,
} = require('./builder-generation-kernel.cjs');
const {
  createBuilderProjectSourceTree,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  sanitizeBuilderProviderConfig,
} = require('./builder-provider-config.cjs');

const BUILDER_GENERATION_MAIN_SERVICE_VERSION = 'builder-generation-main-service.v2';
const BUILDER_GENERATION_PENDING_DRAFT_VERSION = 'builder-generation-pending-draft.v1';
const OPTION_KEYS = Object.freeze([
  'providerConfigRepository',
  'projectReadAuthority',
  'transport',
  'createUuid',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const ERROR_MESSAGES = Object.freeze({
  builder_generation_request_invalid: 'This project request could not be verified.',
  builder_generation_service_unavailable: 'AI project generation is unavailable.',
});

class BuilderGenerationMainServiceError extends Error {
  constructor(code = 'builder_generation_service_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_generation_service_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderGenerationMainServiceError';
    this.code = selected;
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

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
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

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safeUuid(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeOid(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !OID_PATTERN.test(value)) fail();
  return value;
}

function safeDraftId(value) {
  if (typeof value !== 'string' || !DRAFT_ID_PATTERN.test(value)) fail();
  return value;
}

function sanitizeOptions(value) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length < 2
    || keys.length > OPTION_KEYS.length
    || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    || !keys.includes('providerConfigRepository')
    || !keys.includes('projectReadAuthority')
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  if (keys.includes('transport') && typeof descriptors.transport.value !== 'function') fail();
  if (keys.includes('createUuid') && typeof descriptors.createUuid.value !== 'function') fail();
  return Object.freeze({
    providerConfigRepository: descriptors.providerConfigRepository.value,
    projectReadAuthority: descriptors.projectReadAuthority.value,
    ...(keys.includes('transport') ? { transport: descriptors.transport.value } : {}),
    createUuid: keys.includes('createUuid') ? descriptors.createUuid.value : nodeCrypto.randomUUID,
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

function projectUuid(projectId) {
  const match = PROJECT_ID_PATTERN.exec(projectId);
  if (!match) fail();
  return match[1];
}

function newId(createUuid, prefix) {
  return `${prefix}:${safeUuid(Reflect.apply(createUuid, undefined, []))}`;
}

function previousEvent(record) {
  return {
    sequence: record.sequence,
    event_id: record.event_id,
    event_digest: record.event_digest,
  };
}

function createConversationEvents({ projectId, instruction, requestDigest, baseRevision, ids }) {
  const conversationId = `builder-conversation:${projectUuid(projectId)}`;
  const taskTitle = baseRevision === null ? 'Create Builder project' : 'Update Builder project';
  const first = createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: projectId,
    conversation_id: conversationId,
    sequence: 1,
    command_id: ids.turnCommandId,
    event_type: 'turn_submitted',
    previous_event: null,
    payload: {
      message: { message_id: ids.messageId, text: instruction },
      turn_id: ids.turnId,
      mode: 'work',
      task: { task_id: ids.taskId, title: taskTitle },
      base_revision: baseRevision,
    },
    authority: {
      context_authority: 'project_local_conversation',
      permission_admission: 'not_granted',
      execution_admission: 'not_granted',
      revision_admission: 'not_created',
    },
  });
  const second = createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: projectId,
    conversation_id: conversationId,
    sequence: 2,
    command_id: ids.runCommandId,
    event_type: 'run_started',
    previous_event: previousEvent(first),
    payload: {
      turn_id: ids.turnId,
      run_id: ids.runId,
      task_id: ids.taskId,
      attempt_number: 1,
      retry_of_run_id: null,
      input_digest: requestDigest,
    },
    authority: {
      context_authority: 'project_local_conversation',
      permission_admission: 'not_granted',
      execution_admission: 'not_granted',
      revision_admission: 'not_created',
    },
  });
  return Object.freeze([first, second]);
}

function sanitizeReadResult(value, expectedProjectId) {
  exactObject(value, [
    'result_version',
    'operation',
    'product_revision_receipt',
    'current',
    'source_tree',
    'git_candidate_receipt',
    'git_verification_receipt',
    'authority_evidence',
  ]);
  if (
    valueAt(value, 'result_version') !== 'builder-project-read-result.v1'
    || valueAt(value, 'operation') !== 'current_loaded'
  ) fail();
  const receipt = valueAt(value, 'product_revision_receipt');
  if (!isPlainObject(receipt)) fail();
  const projectId = safeProjectId(valueAt(receipt, 'project_id'));
  if (projectId !== expectedProjectId) fail();
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree'));
  const resultingTreeDigest = safeDigest(valueAt(receipt, 'resulting_tree_digest'));
  if (sourceTree.source_tree_digest !== resultingTreeDigest) fail();
  return freezeDeep({
    base_revision: {
      revision_receipt_digest: safeDigest(valueAt(receipt, 'revision_receipt_digest')),
      commit_oid: safeOid(valueAt(receipt, 'commit_oid')),
    },
    base_revision_evidence: {
      evidence_version: 'builder-project-base-revision-evidence.v2',
      project_id: expectedProjectId,
      revision_receipt_digest: safeDigest(valueAt(receipt, 'revision_receipt_digest')),
      commit_oid: safeOid(valueAt(receipt, 'commit_oid')),
      source_tree_digest: sourceTree.source_tree_digest,
      verification_admission: 'git_sqlite_read_authority_verified',
    },
    source_tree: sourceTree,
  });
}

function publicSourceTree(sourceTree) {
  return freezeDeep({
    source_tree_version: sourceTree.source_tree_version,
    source_tree_digest: sourceTree.source_tree_digest,
    files: sourceTree.files.map((file) => ({
      path: file.path,
      entry_kind: file.entry_kind,
      content: file.content,
      content_digest: file.content_digest,
    })),
  });
}

function publicDraftResult(draft) {
  const candidate = draft.candidate;
  return freezeDeep({
    version: draft.version,
    request_id: draft.request_id,
    draft_id: draft.draft_id,
    title: draft.title,
    summary: draft.summary,
    project_id: candidate.project_id,
    existing_project_id: draft.request.existing_project_id,
    candidate: {
      candidate_version: candidate.candidate_version,
      candidate_id: candidate.candidate_id,
      candidate_digest: candidate.candidate_digest,
      resulting_tree_digest: candidate.resulting_tree_digest,
    },
    base_revision_evidence: candidate.base_revision_evidence === null
      ? null
      : { ...candidate.base_revision_evidence },
    source_tree: publicSourceTree(candidate.resulting_source_tree),
    admissions: { ...draft.admissions },
    restart_restore: 'not_persisted',
  });
}

function pendingDraftResult(draft) {
  return freezeDeep({
    result_version: BUILDER_GENERATION_PENDING_DRAFT_VERSION,
    draft_id: draft.draft_id,
    restart_restore: 'not_persisted',
    conversation_event_admission: 'candidate_local_not_recorded',
    request: draft.request,
    git_request_id: draft.git_request_id,
    title: draft.title,
    summary: draft.summary,
    conversation_events: draft.conversation_events,
    candidate: draft.candidate,
  });
}

function createBuilderGenerationMainService(rawOptions) {
  const options = sanitizeOptions(rawOptions);
  const bindCurrentAuthority = ownMethod(options.providerConfigRepository, 'bind_current_authority');
  const loadCurrentProject = ownMethod(options.projectReadAuthority, 'load_current');
  const pendingDrafts = new Map();
  const inFlight = new Map();
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

  async function buildGenerationContext(request) {
    try {
      const existingProjectId = request.existing_project_id;
      const projectId = existingProjectId === null
        ? `builder-project:${safeUuid(Reflect.apply(options.createUuid, undefined, []))}`
        : existingProjectId;
      const base = existingProjectId === null
        ? {
          base_revision: null,
          base_revision_evidence: null,
          source_tree: createBuilderProjectSourceTree({ files: [] }),
        }
        : sanitizeReadResult(
          await Reflect.apply(loadCurrentProject, options.projectReadAuthority, [{ project_id: existingProjectId }]),
          existingProjectId,
        );
      const ids = {
        turnCommandId: newId(options.createUuid, 'builder-command'),
        runCommandId: newId(options.createUuid, 'builder-command'),
        messageId: newId(options.createUuid, 'builder-message'),
        turnId: newId(options.createUuid, 'builder-turn'),
        taskId: newId(options.createUuid, 'builder-task'),
        runId: newId(options.createUuid, 'builder-run'),
      };
      const conversationEvents = createConversationEvents({
        projectId,
        instruction: request.instruction,
        requestDigest: request.request_digest,
        baseRevision: base.base_revision,
        ids,
      });
      return freezeDeep({
        project_id: projectId,
        base_revision_evidence: base.base_revision_evidence,
        base_source_tree: base.source_tree,
        conversation_events: conversationEvents,
        turn_id: ids.turnId,
        task_id: ids.taskId,
        run_id: ids.runId,
        git_request_id: newId(options.createUuid, 'builder-git-request'),
      });
    } catch {
      fail();
    }
  }

  const host = createBuilderGenerationHostAdapter({
    readProviderConfig,
    resolveSecret,
    buildGenerationContext,
    ...(Object.hasOwn(options, 'transport') ? { transport: options.transport } : {}),
  });

  async function generate(rawRequest) {
    let request;
    try { request = sanitizeBuilderGenerationRequest(rawRequest); } catch {
      return Promise.reject(new BuilderGenerationMainServiceError('builder_generation_request_invalid'));
    }
    const existing = inFlight.get(request.request_digest);
    if (existing) return existing;
    const operation = Promise.resolve(host.generate(request)).then((internal) => {
      const context = valueAt(internal, 'context');
      const draftId = `builder-generation-draft:${sha256Canonical({
        draft_version: BUILDER_GENERATION_PENDING_DRAFT_VERSION,
        request_id: internal.request_id,
        candidate_id: internal.candidate.candidate_id,
        candidate_digest: internal.candidate.candidate_digest,
        run_id: internal.candidate.run_id,
      }).slice('sha256:'.length)}`;
      const stored = freezeDeep({
        version: internal.version,
        request_id: internal.request_id,
        title: internal.title,
        summary: internal.summary,
        admissions: internal.admissions,
        candidate: internal.candidate,
        draft_id: draftId,
        request,
        git_request_id: valueAt(context, 'git_request_id'),
        conversation_events: valueAt(context, 'conversation_events'),
      });
      pendingDrafts.set(draftId, stored);
      return publicDraftResult(stored);
    }).finally(() => {
      if (inFlight.get(request.request_digest) === operation) inFlight.delete(request.request_digest);
    });
    inFlight.set(request.request_digest, operation);
    return operation;
  }

  function readPendingDraft(rawRequest) {
    try {
      exactObject(rawRequest, ['draft_id']);
      const draftId = safeDraftId(valueAt(rawRequest, 'draft_id'));
      const draft = pendingDrafts.get(draftId);
      if (!draft) fail();
      return pendingDraftResult(draft);
    } catch {
      fail();
    }
  }

  return Object.freeze({
    service_version: BUILDER_GENERATION_MAIN_SERVICE_VERSION,
    generate,
    cancel: host.cancel,
    availability: host.availability,
    read_pending_draft: readPendingDraft,
    authority: Object.freeze({
      provider_config_snapshot_bound: true,
      project_read_authority_verified_source: true,
      pending_draft_restart_restore: 'not_persisted',
      conversation_event_admission: 'candidate_local_not_recorded',
      credential_exposed_to_renderer: false,
      electron_registration: false,
      preload_exposure: false,
    }),
  });
}

module.exports = Object.freeze({
  BUILDER_GENERATION_MAIN_SERVICE_VERSION,
  BUILDER_GENERATION_PENDING_DRAFT_VERSION,
  BuilderGenerationMainServiceError,
  createBuilderGenerationMainService,
});
