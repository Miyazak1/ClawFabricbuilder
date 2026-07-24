'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  createBuilderGenerationHostAdapter,
} = require('./builder-generation-host-adapter.cjs');
const {
  sanitizeBuilderGitCandidateReceipt,
  sanitizeBuilderGitCandidateReceiptPair,
} = require('./builder-git-receipt-contract.cjs');
const {
  BUILDER_GENERATION_RESULT_PROTOCOL,
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
const BUILDER_GENERATION_PENDING_DRAFT_VERSION = 'builder-generation-pending-draft.v2';
const GENERATE_OPERATION_PREFIX = 'generate:';
const ANSWER_OPERATION_PREFIX = 'answer:';
const OPTION_KEYS = Object.freeze([
  'providerConfigRepository',
  'projectReadAuthority',
  'conversationService',
  'gitAuthority',
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
  builder_generation_draft_conflict: 'The generated project draft could not be verified.',
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

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
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
    keys.length < 3
    || keys.length > OPTION_KEYS.length
    || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    || !keys.includes('providerConfigRepository')
    || !keys.includes('projectReadAuthority')
    || !keys.includes('conversationService')
    || !keys.includes('gitAuthority')
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
    conversationService: descriptors.conversationService.value,
    gitAuthority: descriptors.gitAuthority.value,
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

function newId(createUuid, prefix) {
  return `${prefix}:${safeUuid(Reflect.apply(createUuid, undefined, []))}`;
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

function candidateProofFromCandidate(candidate) {
  const baseRevision = candidate.run_binding.base_revision;
  return freezeDeep({
    proof_version: 'builder-generation-pending-candidate-proof.v1',
    project_id: candidate.project_id,
    conversation_id: candidate.conversation_id,
    turn_id: candidate.turn_id,
    task_id: candidate.task_id,
    run_id: candidate.run_id,
    request_digest: candidate.request_digest,
    git_request_id: null,
    candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest,
    resulting_tree_digest: candidate.resulting_tree_digest,
    expected_base_oid: candidate.base_revision_evidence === null
      ? null
      : candidate.base_revision_evidence.commit_oid,
    base_revision: baseRevision === null ? null : { ...baseRevision },
  });
}

function sanitizeConversationDraft(value, expectedDraftId) {
  exactObject(value, [
    'result_version',
    'draft_id',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    'candidate_digest',
    'base_revision',
    'conversation_head',
    'candidate_result',
    'verification_admission',
  ]);
  const candidateResult = exactObject(valueAt(value, 'candidate_result'), [
    'draft_id', 'title', 'summary', 'git_candidate_receipt',
  ]);
  const receipt = sanitizeBuilderGitCandidateReceipt(
    valueAt(candidateResult, 'git_candidate_receipt'),
  );
  const conversationHead = valueAt(value, 'conversation_head');
  exactObject(conversationHead, ['sequence', 'event_id', 'event_digest']);
  const sequence = valueAt(conversationHead, 'sequence');
  if (
    valueAt(value, 'result_version') !== 'builder-conversation-candidate-draft-read-result.v1'
    || valueAt(value, 'draft_id') !== expectedDraftId
    || valueAt(candidateResult, 'draft_id') !== expectedDraftId
    || valueAt(value, 'verification_admission') !== 'sqlite_replay_verified'
    || valueAt(value, 'project_id') !== receipt.project_id
    || valueAt(value, 'conversation_id') !== receipt.conversation_id
    || valueAt(value, 'turn_id') !== receipt.turn_id
    || valueAt(value, 'task_id') !== receipt.task_id
    || valueAt(value, 'run_id') !== receipt.run_id
    || valueAt(value, 'candidate_digest') !== receipt.candidate_digest
    || !Number.isSafeInteger(sequence)
    || sequence < 1
    || sequence > 1_024
  ) fail();
  const baseRevision = valueAt(value, 'base_revision');
  if (baseRevision !== null) {
    exactObject(baseRevision, ['revision_receipt_digest', 'commit_oid']);
  }
  return freezeDeep({
    draft_id: expectedDraftId,
    title: valueAt(candidateResult, 'title'),
    summary: valueAt(candidateResult, 'summary'),
    conversation_head: {
      sequence,
      event_id: safePattern(valueAt(conversationHead, 'event_id'), /^builder-conversation-event:[0-9a-f]{64}$/u, 96),
      event_digest: safeDigest(valueAt(conversationHead, 'event_digest')),
    },
    git_candidate_receipt: receipt,
    candidate_proof: {
      proof_version: 'builder-generation-pending-candidate-proof.v1',
      project_id: receipt.project_id,
      conversation_id: receipt.conversation_id,
      turn_id: receipt.turn_id,
      task_id: receipt.task_id,
      run_id: receipt.run_id,
      request_digest: null,
      git_request_id: receipt.request_id,
      candidate_id: receipt.candidate_id,
      candidate_digest: receipt.candidate_digest,
      resulting_tree_digest: receipt.resulting_tree_digest,
      expected_base_oid: receipt.expected_base_oid,
      base_revision: baseRevision === null
        ? null
        : {
          revision_receipt_digest: safeDigest(valueAt(baseRevision, 'revision_receipt_digest')),
          commit_oid: safeOid(valueAt(baseRevision, 'commit_oid')),
        },
    },
  });
}

function sanitizeVerifiedCandidateRead(value, expectedReceipt) {
  exactObject(value, [
    'result_version',
    'candidate_receipt',
    'verification_receipt',
    'source_tree',
    'code_authority',
    'read_admission',
  ]);
  const pair = sanitizeBuilderGitCandidateReceiptPair(
    valueAt(value, 'candidate_receipt'),
    valueAt(value, 'verification_receipt'),
  );
  const receipt = pair.candidate_receipt;
  if (
    valueAt(value, 'result_version') !== 'builder-git-verified-candidate-read-result.v1'
    || valueAt(value, 'code_authority') !== 'git_commit_tree'
    || valueAt(value, 'read_admission') !== 'verified'
    || canonicalJson(receipt) !== canonicalJson(expectedReceipt)
  ) fail();
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree'));
  if (sourceTree.source_tree_digest !== receipt.resulting_tree_digest) fail();
  return freezeDeep({ receipt, source_tree: sourceTree });
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

function publicRestoredDraftResult(draft, baseRevisionEvidence) {
  const proof = draft.candidate_proof;
  return freezeDeep({
    version: BUILDER_GENERATION_RESULT_PROTOCOL,
    request_id: proof.request_digest,
    draft_id: draft.draft_id,
    title: draft.title,
    summary: draft.summary,
    project_id: proof.project_id,
    existing_project_id: proof.base_revision === null ? null : proof.project_id,
    candidate: {
      candidate_version: 'builder-code-change-candidate.v2',
      candidate_id: proof.candidate_id,
      candidate_digest: proof.candidate_digest,
      resulting_tree_digest: proof.resulting_tree_digest,
    },
    base_revision_evidence: baseRevisionEvidence,
    source_tree: publicSourceTree(draft.source_tree),
    admissions: {
      conversation: 'sqlite_recorded',
      draft: 'candidate_not_saved',
      save: 'not_performed',
      preview: 'not_evaluated',
      execution: 'not_evaluated',
    },
    restart_restore: draft.restart_restore,
  });
}

function pendingDraftResult(draft) {
  return freezeDeep({
    result_version: BUILDER_GENERATION_PENDING_DRAFT_VERSION,
    draft_id: draft.draft_id,
    restart_restore: draft.restart_restore,
    conversation_event_admission: 'sqlite_recorded',
    git_request_id: draft.git_request_id,
    title: draft.title,
    summary: draft.summary,
    conversation_head: draft.conversation_head,
    candidate_proof: draft.candidate_proof,
  });
}

function createBuilderGenerationMainService(rawOptions) {
  const options = sanitizeOptions(rawOptions);
  const bindCurrentAuthority = ownMethod(options.providerConfigRepository, 'bind_current_authority');
  const loadCurrentProject = ownMethod(options.projectReadAuthority, 'load_current');
  const beginConversationQuestion = ownMethod(options.conversationService, 'begin_question');
  const beginConversationWork = ownMethod(options.conversationService, 'begin_work');
  const completeConversationCandidate = ownMethod(options.conversationService, 'complete_candidate');
  const completeConversationExplanation = ownMethod(options.conversationService, 'complete_explanation');
  const completeConversationFailure = ownMethod(options.conversationService, 'complete_failure');
  const requestConversationCancel = ownMethod(options.conversationService, 'request_cancel');
  const readConversationCandidateDraft = ownMethod(options.conversationService, 'read_candidate_draft');
  const persistCandidateCommit = ownMethod(options.gitAuthority, 'persist_candidate_commit');
  const verifyCandidateReceipt = ownMethod(options.gitAuthority, 'verify_candidate_receipt');
  const readVerifiedCandidate = ownMethod(options.gitAuthority, 'read_verified_candidate');
  const pendingDrafts = new Map();
  const inFlight = new Map();
  const activeContexts = new Map();
  const generationContexts = new WeakMap();
  const explanationContexts = new WeakMap();
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

  function operationKey(prefix, requestDigest) {
    return `${prefix}${requestDigest}`;
  }

  function rejectIfOtherRouteInFlight(prefix, requestDigest) {
    const otherPrefix = prefix === GENERATE_OPERATION_PREFIX
      ? ANSWER_OPERATION_PREFIX
      : GENERATE_OPERATION_PREFIX;
    if (inFlight.has(operationKey(otherPrefix, requestDigest))) {
      return Promise.reject(new BuilderGenerationMainServiceError());
    }
    return null;
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
      const conversationContext = Reflect.apply(
        beginConversationWork,
        options.conversationService,
        [{
          project_id: projectId,
          instruction: request.instruction,
          request_digest: request.request_digest,
          base_revision: base.base_revision,
        }],
      );
      activeContexts.set(
        operationKey(GENERATE_OPERATION_PREFIX, request.request_digest),
        conversationContext,
      );
      const generationContext = freezeDeep({
        project_id: projectId,
        base_revision_evidence: base.base_revision_evidence,
        base_source_tree: base.source_tree,
        conversation_events: conversationContext.events,
        turn_id: conversationContext.ids.turn_id,
        task_id: conversationContext.ids.task_id,
        run_id: conversationContext.ids.run_id,
        git_request_id: newId(options.createUuid, 'builder-git-request'),
      });
      generationContexts.set(generationContext, conversationContext);
      return generationContext;
    } catch {
      fail();
    }
  }

  async function buildExplanationContext(request) {
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
      const conversationContext = Reflect.apply(
        beginConversationQuestion,
        options.conversationService,
        [{
          project_id: projectId,
          question: request.instruction,
          request_digest: request.request_digest,
          base_revision: base.base_revision,
        }],
      );
      activeContexts.set(
        operationKey(ANSWER_OPERATION_PREFIX, request.request_digest),
        conversationContext,
      );
      const explanationContext = freezeDeep({
        project_id: projectId,
        base_revision_evidence: base.base_revision_evidence,
        base_source_tree: base.source_tree,
        conversation_events: conversationContext.events,
        turn_id: conversationContext.ids.turn_id,
        task_id: conversationContext.ids.task_id,
        run_id: conversationContext.ids.run_id,
      });
      explanationContexts.set(explanationContext, conversationContext);
      return explanationContext;
    } catch {
      fail();
    }
  }

  const host = createBuilderGenerationHostAdapter({
    readProviderConfig,
    resolveSecret,
    buildGenerationContext,
    buildExplanationContext,
    ...(Object.hasOwn(options, 'transport') ? { transport: options.transport } : {}),
  });

  function publicExplanationResult(answer, request) {
    const context = valueAt(answer, 'context');
    return freezeDeep({
      version: answer.version,
      result_kind: 'explanation',
      request_id: answer.request_id,
      project_id: valueAt(context, 'project_id'),
      existing_project_id: request.existing_project_id,
      title: answer.title,
      summary: answer.summary,
      explanation: answer.explanation,
      admissions: {
        conversation: 'sqlite_recorded',
        draft: 'not_created',
        save: 'not_performed',
        preview: 'not_applicable',
        execution: 'not_evaluated',
      },
    });
  }

  function failureCodeFrom(error) {
    if (error && typeof error === 'object' && !utilTypes.isProxy(error)) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
        if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') {
          return descriptor.value;
        }
      } catch {
        return 'builder_generation_failed';
      }
    }
    return 'builder_generation_failed';
  }

  function recordFailure(key, error) {
    const conversationContext = activeContexts.get(key);
    if (conversationContext === undefined) return;
    try {
      Reflect.apply(
        completeConversationFailure,
        options.conversationService,
        [{ context: conversationContext, failure_code: failureCodeFrom(error) }],
      );
    } catch {
      throw new BuilderGenerationMainServiceError();
    }
  }

  async function generate(rawRequest) {
    let request;
    try { request = sanitizeBuilderGenerationRequest(rawRequest); } catch {
      return Promise.reject(new BuilderGenerationMainServiceError('builder_generation_request_invalid'));
    }
    const key = operationKey(GENERATE_OPERATION_PREFIX, request.request_digest);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const routeConflict = rejectIfOtherRouteInFlight(GENERATE_OPERATION_PREFIX, request.request_digest);
    if (routeConflict) return routeConflict;
    const operation = Promise.resolve(host.generate(request)).then(async (internal) => {
      const context = valueAt(internal, 'context');
      const conversationContext = generationContexts.get(context);
      if (conversationContext === undefined) fail();
      const draftId = `builder-generation-draft:${sha256Canonical({
        draft_version: BUILDER_GENERATION_PENDING_DRAFT_VERSION,
        request_id: internal.request_id,
        candidate_id: internal.candidate.candidate_id,
        candidate_digest: internal.candidate.candidate_digest,
        run_id: internal.candidate.run_id,
      }).slice('sha256:'.length)}`;
      const gitCandidateReceipt = await Reflect.apply(
        persistCandidateCommit,
        options.gitAuthority,
        [{
          request_id: valueAt(context, 'git_request_id'),
          expected_base_oid: internal.candidate.base_revision_evidence === null
            ? null
            : internal.candidate.base_revision_evidence.commit_oid,
          candidate: internal.candidate,
        }],
      );
      const gitVerificationReceipt = await Reflect.apply(
        verifyCandidateReceipt,
        options.gitAuthority,
        [gitCandidateReceipt],
      );
      const receiptPair = sanitizeBuilderGitCandidateReceiptPair(
        gitCandidateReceipt,
        gitVerificationReceipt,
      );
      const recorded = Reflect.apply(
        completeConversationCandidate,
        options.conversationService,
        [{
          context: conversationContext,
          candidate_result: {
            draft_id: draftId,
            title: internal.title,
            summary: internal.summary,
            git_candidate_receipt: receiptPair.candidate_receipt,
          },
          assistant_text: internal.summary,
        }],
      );
      const stored = freezeDeep({
        version: internal.version,
        request_id: internal.request_id,
        title: internal.title,
        summary: internal.summary,
        admissions: {
          ...internal.admissions,
          conversation: 'sqlite_recorded',
        },
        candidate: internal.candidate,
        candidate_proof: {
          ...candidateProofFromCandidate(internal.candidate),
          git_request_id: valueAt(context, 'git_request_id'),
        },
        draft_id: draftId,
        request,
        git_request_id: valueAt(context, 'git_request_id'),
        conversation_head: recorded.head,
        restart_restore: 'not_persisted',
      });
      pendingDrafts.set(draftId, stored);
      return publicDraftResult(stored);
    }).catch((error) => {
      recordFailure(key, error);
      throw error;
    }).finally(() => {
      activeContexts.delete(key);
      if (inFlight.get(key) === operation) inFlight.delete(key);
    });
    inFlight.set(key, operation);
    return operation;
  }

  async function answer(rawRequest) {
    let request;
    try { request = sanitizeBuilderGenerationRequest(rawRequest); } catch {
      return Promise.reject(new BuilderGenerationMainServiceError('builder_generation_request_invalid'));
    }
    const key = operationKey(ANSWER_OPERATION_PREFIX, request.request_digest);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const routeConflict = rejectIfOtherRouteInFlight(ANSWER_OPERATION_PREFIX, request.request_digest);
    if (routeConflict) return routeConflict;
    const operation = Promise.resolve(host.explain(request)).then((internal) => {
      const context = valueAt(internal, 'context');
      const conversationContext = explanationContexts.get(context);
      if (conversationContext === undefined) fail();
      Reflect.apply(
        completeConversationExplanation,
        options.conversationService,
        [{
          context: conversationContext,
          assistant_text: internal.explanation,
        }],
      );
      return publicExplanationResult(internal, request);
    }).catch((error) => {
      recordFailure(key, error);
      throw error;
    }).finally(() => {
      activeContexts.delete(key);
      if (inFlight.get(key) === operation) inFlight.delete(key);
    });
    inFlight.set(key, operation);
    return operation;
  }

  function cancel(rawRequest) {
    let requestId;
    try {
      exactObject(rawRequest, ['request_id']);
      requestId = safeDigest(valueAt(rawRequest, 'request_id'));
    } catch {
      return host.cancel(rawRequest);
    }
    const keys = [
      operationKey(GENERATE_OPERATION_PREFIX, requestId),
      operationKey(ANSWER_OPERATION_PREFIX, requestId),
    ];
    let cancelled = false;
    for (const key of keys) {
      const context = activeContexts.get(key);
      if (context === undefined) continue;
      let cancelledContext;
      try {
        cancelledContext = Reflect.apply(
          requestConversationCancel,
          options.conversationService,
          [{ context }],
        );
      } catch {
        throw new BuilderGenerationMainServiceError();
      }
      activeContexts.set(key, cancelledContext);
      cancelled = true;
    }
    if (!cancelled) {
      return Object.freeze({ request_id: requestId, cancelled: false });
    }
    host.cancel({ request_id: requestId });
    return Object.freeze({ request_id: requestId, cancelled: true });
  }

  async function baseRevisionEvidenceForRestoredDraft(proof) {
    if (proof.base_revision === null) return null;
    const base = sanitizeReadResult(
      await Reflect.apply(loadCurrentProject, options.projectReadAuthority, [{
        project_id: proof.project_id,
      }]),
      proof.project_id,
    );
    if (
      base.base_revision === null
      || base.base_revision.revision_receipt_digest !== proof.base_revision.revision_receipt_digest
      || base.base_revision.commit_oid !== proof.base_revision.commit_oid
    ) {
      throw new BuilderGenerationMainServiceError('builder_generation_parent_unavailable');
    }
    return base.base_revision_evidence;
  }

  async function loadPendingDraftById(draftId) {
    const draft = pendingDrafts.get(draftId);
    if (draft) return draft;
    const restoredConversation = sanitizeConversationDraft(
      Reflect.apply(
        readConversationCandidateDraft,
        options.conversationService,
        [{ draft_id: draftId }],
      ),
      draftId,
    );
    const verified = sanitizeVerifiedCandidateRead(
      await Reflect.apply(
        readVerifiedCandidate,
        options.gitAuthority,
        [restoredConversation.git_candidate_receipt],
      ),
      restoredConversation.git_candidate_receipt,
    );
    const restored = freezeDeep({
      title: restoredConversation.title,
      summary: restoredConversation.summary,
      draft_id: draftId,
      git_request_id: restoredConversation.git_candidate_receipt.request_id,
      conversation_head: restoredConversation.conversation_head,
      candidate_proof: restoredConversation.candidate_proof,
      source_tree: verified.source_tree,
      restart_restore: 'git_sqlite_verified',
    });
    pendingDrafts.set(draftId, restored);
    return restored;
  }

  async function readPendingDraft(rawRequest) {
    try {
      exactObject(rawRequest, ['draft_id']);
      const draftId = safeDraftId(valueAt(rawRequest, 'draft_id'));
      return pendingDraftResult(await loadPendingDraftById(draftId));
    } catch {
      fail();
    }
  }

  async function restoreDraft(rawRequest) {
    try {
      exactObject(rawRequest, ['draft_id']);
      const draftId = safeDraftId(valueAt(rawRequest, 'draft_id'));
      const draft = await loadPendingDraftById(draftId);
      if (Object.hasOwn(draft, 'candidate')) return publicDraftResult(draft);
      return publicRestoredDraftResult(
        draft,
        await baseRevisionEvidenceForRestoredDraft(draft.candidate_proof),
      );
    } catch (error) {
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail();
    }
  }

  function releasePendingDraft(rawRequest) {
    try {
      exactObject(rawRequest, ['draft_id', 'candidate_digest']);
      const draftId = safeDraftId(valueAt(rawRequest, 'draft_id'));
      const candidateDigest = safeDigest(valueAt(rawRequest, 'candidate_digest'));
      const draft = pendingDrafts.get(draftId);
      if (!draft || draft.candidate_proof.candidate_digest !== candidateDigest) {
        throw new BuilderGenerationMainServiceError('builder_generation_draft_conflict');
      }
      pendingDrafts.delete(draftId);
      return freezeDeep({
        result_version: BUILDER_GENERATION_PENDING_DRAFT_VERSION,
        draft_id: draftId,
        released: true,
        pending_draft_restart_restore: draft.restart_restore,
        conversation_event_admission: 'sqlite_recorded',
      });
    } catch (error) {
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail();
    }
  }

  return Object.freeze({
    service_version: BUILDER_GENERATION_MAIN_SERVICE_VERSION,
    answer,
    generate,
    cancel,
    availability: host.availability,
    restore_draft: restoreDraft,
    read_pending_draft: readPendingDraft,
    release_pending_draft: releasePendingDraft,
    authority: Object.freeze({
      provider_config_snapshot_bound: true,
      project_read_authority_verified_source: true,
      pending_draft_restart_restore: 'git_sqlite_verified',
      conversation_event_admission: 'sqlite_recorded',
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
