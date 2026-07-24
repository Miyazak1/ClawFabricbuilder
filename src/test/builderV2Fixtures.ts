import {
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION,
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_PROJECT_READ_RESULT_VERSION,
  BUILDER_PROJECT_SOURCE_ENTRY_KIND,
  BUILDER_PROJECT_SOURCE_TREE_VERSION,
} from '../features/builder/domain/builderProjectSnapshot';
import {
  BUILDER_GENERATION_RESULT_PROTOCOL,
  createBuilderGenerationRequest,
  type BuilderGenerationDraft,
  type BuilderGenerationRequest,
} from '../features/builder/application/builderGeneration';
import { BUILDER_TASK_STREAM_READ_RESULT_VERSION } from '../features/builder/domain/builderConversationSnapshot';

export const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
export const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174000';
export const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174000';
export const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174000';
export const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174000';
export const REQUEST_ID = 'builder-git-request:123e4567-e89b-42d3-a456-426614174000';
export const REVIEW_ID = 'builder-review:123e4567-e89b-42d3-a456-426614174000';
export const CANDIDATE_ID = `builder-code-change-candidate:${'1'.repeat(64)}`;
export const DRAFT_ID = `builder-generation-draft:${'2'.repeat(64)}`;
export const COMMIT_OID = 'a'.repeat(40);
export const TREE_OID = 'b'.repeat(40);
const ASSISTANT_MESSAGE_ID = 'builder-message:223e4567-e89b-42d3-a456-426614174000';

const ENCODER = new TextEncoder();

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (
    value !== null
    && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
    )).join(',')}}`;
  }
  throw new Error('invalid fixture');
}

export async function digest(value: unknown): Promise<string> {
  const raw = await globalThis.crypto.subtle.digest('SHA-256', ENCODER.encode(canonicalJson(value)));
  return `sha256:${Array.from(
    new Uint8Array(raw),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')}`;
}

export async function createSourceTree(
  files: readonly Readonly<{ path: string; content: string }>[] = [
    { path: 'index.html', content: '<main><h1>Hello</h1></main>\n' },
    { path: 'styles.css', content: 'h1 { color: #242522; }\n' },
    { path: 'src/tool.py', content: 'print("hello")\n' },
  ],
) {
  const ordered = [...files].sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ));
  const entries = await Promise.all(ordered.map(async (file) => {
    const unsigned = {
      path: file.path,
      entry_kind: BUILDER_PROJECT_SOURCE_ENTRY_KIND,
      content: file.content,
    };
    return { ...unsigned, content_digest: await digest(unsigned) };
  }));
  const unsigned = {
    files: entries,
    source_tree_version: BUILDER_PROJECT_SOURCE_TREE_VERSION,
  };
  return { ...unsigned, source_tree_digest: await digest(unsigned) };
}

async function createVerificationReceipt(sourceTreeDigest: string) {
  return {
    receipt_version: BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    request_id: REQUEST_ID,
    candidate_id: CANDIDATE_ID,
    candidate_digest: await digest({ candidate: 'fixture' }),
    expected_base_oid: null,
    commit_oid: COMMIT_OID,
    candidate_tree_oid: TREE_OID,
    resulting_tree_digest: sourceTreeDigest,
    semantic_identity_digest: await digest({ semantic: 'fixture' }),
    object_format: 'sha1',
    commit_ref_admission: 'verified',
    request_ref_admission: 'verified',
    commit_object_admission: 'verified',
    verification_admission: 'accepted',
  };
}

async function createCandidateReceipt(
  verification: Awaited<ReturnType<typeof createVerificationReceipt>>,
) {
  return {
    receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: verification.project_id,
    conversation_id: verification.conversation_id,
    turn_id: verification.turn_id,
    task_id: verification.task_id,
    run_id: verification.run_id,
    request_id: verification.request_id,
    candidate_id: verification.candidate_id,
    candidate_digest: verification.candidate_digest,
    resulting_tree_digest: verification.resulting_tree_digest,
    semantic_identity_digest: verification.semantic_identity_digest,
    verification_receipt_digest: await digest(verification),
    object_format: 'sha1',
    commit_oid: verification.commit_oid,
    tree_oid: verification.candidate_tree_oid,
    parent_oid: verification.expected_base_oid,
    expected_base_oid: verification.expected_base_oid,
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: false,
  };
}

export async function createReadWire(
  sourceTreeValue?: Awaited<ReturnType<typeof createSourceTree>>,
  revisionNumber = 1,
) {
  const sourceTree = sourceTreeValue ?? await createSourceTree();
  const verification = await createVerificationReceipt(sourceTree.source_tree_digest);
  const candidate = await createCandidateReceipt(verification);
  const receiptBody = {
    candidate_digest: candidate.candidate_digest,
    candidate_id: candidate.candidate_id,
    commit_oid: candidate.commit_oid,
    conversation_id: candidate.conversation_id,
    object_format: 'sha1',
    parent_oid: candidate.parent_oid,
    previous_revision_receipt_digest: null,
    project_id: candidate.project_id,
    request_id: candidate.request_id,
    resulting_tree_digest: candidate.resulting_tree_digest,
    review_id: REVIEW_ID,
    revision_number: revisionNumber,
    run_id: candidate.run_id,
    selected_at_ms: 1234,
    semantic_identity_digest: candidate.semantic_identity_digest,
    summary: 'A small project.',
    task_id: candidate.task_id,
    title: 'Hello project',
    tree_oid: candidate.tree_oid,
    turn_id: candidate.turn_id,
    verification_receipt_digest: candidate.verification_receipt_digest,
  };
  const target = {
    project_id: PROJECT_ID,
    revision_receipt_digest: await digest(receiptBody),
    revision_number: revisionNumber,
    previous_revision_receipt_digest: null,
    title: receiptBody.title,
    summary: receiptBody.summary,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    request_id: REQUEST_ID,
    object_format: 'sha1',
    commit_oid: COMMIT_OID,
    tree_oid: TREE_OID,
    parent_oid: null,
    candidate_id: CANDIDATE_ID,
    candidate_digest: candidate.candidate_digest,
    resulting_tree_digest: sourceTree.source_tree_digest,
    semantic_identity_digest: candidate.semantic_identity_digest,
    verification_receipt_digest: candidate.verification_receipt_digest,
    task_id: TASK_ID,
    run_id: RUN_ID,
    review_id: REVIEW_ID,
    selected_at_ms: 1234,
  };
  return {
    result_version: BUILDER_PROJECT_READ_RESULT_VERSION,
    product_revision_receipt: target,
    current: {
      project_id: PROJECT_ID,
      title: target.title,
      summary: target.summary,
      revision_receipt_digest: target.revision_receipt_digest,
      revision_number: target.revision_number,
      object_format: 'sha1',
      commit_oid: COMMIT_OID,
      tree_oid: TREE_OID,
      parent_oid: null,
    },
    source_tree: sourceTree,
    git_candidate_receipt: candidate,
    git_verification_receipt: verification,
    authority_evidence: {
      product_authority: 'sqlite_product_revision_receipt',
      code_authority: 'git_commit_tree',
      source_read_admission: 'verified',
      current_selection: 'sqlite_current_project_revision',
    },
    operation: 'current_loaded',
  };
}

export async function createGenerationDraft(
  requestValue?: BuilderGenerationRequest,
  sourceTreeValue?: Awaited<ReturnType<typeof createSourceTree>>,
): Promise<BuilderGenerationDraft> {
  const request = requestValue ?? await createBuilderGenerationRequest('Make a small tool.');
  const sourceTree = sourceTreeValue ?? await createSourceTree();
  const baseRead = request.existing_project_id === null
    ? null
    : await createReadWire(sourceTree);
  return {
    version: BUILDER_GENERATION_RESULT_PROTOCOL,
    request_id: request.request_digest,
    draft_id: DRAFT_ID,
    title: 'Hello project',
    summary: 'A small project.',
    project_id: request.existing_project_id ?? PROJECT_ID,
    existing_project_id: request.existing_project_id,
    candidate: {
      candidate_version: 'builder-code-change-candidate.v2',
      candidate_id: CANDIDATE_ID,
      candidate_digest: await digest({ candidate: 'fixture' }),
      resulting_tree_digest: sourceTree.source_tree_digest,
    },
    base_revision_evidence: request.existing_project_id === null
      ? null
      : {
        evidence_version: 'builder-project-base-revision-evidence.v2',
        project_id: request.existing_project_id,
        revision_receipt_digest: baseRead!.product_revision_receipt.revision_receipt_digest,
        commit_oid: baseRead!.product_revision_receipt.commit_oid,
        source_tree_digest: sourceTree.source_tree_digest,
        verification_admission: 'git_sqlite_read_authority_verified',
      },
    source_tree: sourceTree,
    admissions: {
      conversation: 'sqlite_recorded',
      draft: 'candidate_not_saved',
      save: 'not_performed',
      preview: 'not_evaluated',
      execution: 'not_evaluated',
    },
    restart_restore: 'not_persisted',
  };
}

export async function createGenerationAnswer(
  requestValue?: BuilderGenerationRequest,
) {
  const request = requestValue ?? await createBuilderGenerationRequest('What does this project do?');
  return {
    version: BUILDER_GENERATION_RESULT_PROTOCOL,
    result_kind: 'explanation',
    request_id: request.request_digest,
    project_id: request.existing_project_id ?? PROJECT_ID,
    existing_project_id: request.existing_project_id,
    title: 'Current project',
    summary: 'Explains the current project.',
    explanation: 'This answer does not change files.',
    admissions: {
      conversation: 'sqlite_recorded',
      draft: 'not_created',
      save: 'not_performed',
      preview: 'not_applicable',
      execution: 'not_evaluated',
    },
  };
}

export async function createRestoredGenerationDraft(
  sourceTreeValue?: Awaited<ReturnType<typeof createSourceTree>>,
): Promise<BuilderGenerationDraft> {
  const request = await createBuilderGenerationRequest('Add a saved-project change.', PROJECT_ID);
  const draft = await createGenerationDraft(request, sourceTreeValue);
  return {
    ...draft,
    request_id: null,
    restart_restore: 'git_sqlite_verified',
  };
}

export function createSaveResult(
  draft: BuilderGenerationDraft,
  readWire: Awaited<ReturnType<typeof createReadWire>>,
) {
  return {
    result_version: 'builder-project-save-result.v1',
    operation: 'draft_saved',
    draft_id: draft.draft_id,
    project_id: draft.project_id,
    revision_receipt_digest: readWire.product_revision_receipt.revision_receipt_digest,
    commit_oid: readWire.product_revision_receipt.commit_oid,
    tree_oid: readWire.product_revision_receipt.tree_oid,
    pending_draft_released: true,
    save_evidence: {
      code_authority: 'git_commit_candidate',
      product_authority: 'sqlite_accepted_project_revision_receipt',
      conversation_event_admission: 'sqlite_recorded',
      renderer_authority: 'draft_id_only',
    },
  };
}

export async function createCatalogWire() {
  const read = await createReadWire();
  return {
    result_version: BUILDER_PROJECT_READ_RESULT_VERSION,
    operation: 'current_listed',
    projects: [{
      project_id: PROJECT_ID,
      title: read.product_revision_receipt.title,
      summary: read.product_revision_receipt.summary,
      revision_number: read.product_revision_receipt.revision_number,
      revision_receipt_digest: read.product_revision_receipt.revision_receipt_digest,
      commit_oid: COMMIT_OID,
      tree_oid: TREE_OID,
      selected_at_ms: read.product_revision_receipt.selected_at_ms,
    }],
    authority_evidence: {
      product_authority: 'sqlite_product_revision_receipt',
      code_authority: 'not_read_for_catalog',
      source_read_admission: 'not_requested',
      current_selection: 'sqlite_current_project_revision',
    },
  };
}

export async function createHistoryWire(projectId = PROJECT_ID, revisionCount: 1 | 2 = 2) {
  const firstReceiptDigest = await digest({ history: 'one', project_id: projectId });
  const secondReceiptDigest = await digest({
    history: 'two',
    previous_revision_receipt_digest: firstReceiptDigest,
    project_id: projectId,
  });
  const first = {
    project_id: projectId,
    title: 'Version one',
    summary: 'The first saved Builder version.',
    revision_number: 1,
    revision_receipt_digest: firstReceiptDigest,
    previous_revision_receipt_digest: null,
    commit_oid: COMMIT_OID,
    tree_oid: TREE_OID,
    parent_oid: null,
    selected_at_ms: 1234,
    is_current: revisionCount === 1,
  };
  if (revisionCount === 1) {
    return {
      result_version: BUILDER_PROJECT_READ_RESULT_VERSION,
      operation: 'history_listed',
      project_id: projectId,
      current: {
        project_id: projectId,
        title: first.title,
        summary: first.summary,
        revision_receipt_digest: first.revision_receipt_digest,
        revision_number: first.revision_number,
        object_format: 'sha1',
        commit_oid: first.commit_oid,
        tree_oid: first.tree_oid,
        parent_oid: first.parent_oid,
      },
      revisions: [first],
      authority_evidence: {
        product_authority: 'sqlite_product_revision_receipt',
        code_authority: 'git_commit_tree',
        source_read_admission: 'verified',
        current_selection: 'sqlite_current_project_revision',
        history_selection: 'sqlite_project_revision_receipts',
      },
    };
  }
  const second = {
    project_id: projectId,
    title: 'Version two',
    summary: 'The second saved Builder version.',
    revision_number: 2,
    revision_receipt_digest: secondReceiptDigest,
    previous_revision_receipt_digest: first.revision_receipt_digest,
    commit_oid: 'c'.repeat(40),
    tree_oid: 'd'.repeat(40),
    parent_oid: first.commit_oid,
    selected_at_ms: 2234,
    is_current: true,
  };
  return {
    result_version: BUILDER_PROJECT_READ_RESULT_VERSION,
    operation: 'history_listed',
    project_id: projectId,
    current: {
      project_id: projectId,
      title: second.title,
      summary: second.summary,
      revision_receipt_digest: second.revision_receipt_digest,
      revision_number: second.revision_number,
      object_format: 'sha1',
      commit_oid: second.commit_oid,
      tree_oid: second.tree_oid,
      parent_oid: second.parent_oid,
    },
    revisions: [second, first],
    authority_evidence: {
      product_authority: 'sqlite_product_revision_receipt',
      code_authority: 'git_commit_tree',
      source_read_admission: 'verified',
      current_selection: 'sqlite_current_project_revision',
      history_selection: 'sqlite_project_revision_receipts',
    },
  };
}

export function createTaskStreamWire() {
  return {
    stream_version: BUILDER_TASK_STREAM_READ_RESULT_VERSION,
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1234,
      head_sequence: 4,
      recorded_active_turn_id: null,
      window: {
        first_sequence: 1,
        last_sequence: 4,
        has_earlier: false,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174000',
            text: 'Make a timer.',
          },
          message_kind: 'submitted',
          mode: 'work',
          task: {
            task_id: TASK_ID,
            title: 'Make a timer',
          },
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'run_completed',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          terminal_status: 'succeeded',
          result_kind: 'candidate',
          assistant_message: {
            message_id: ASSISTANT_MESSAGE_ID,
            text: 'I prepared a draft for review.',
          },
          candidate: {
            draft_id: DRAFT_ID,
            title: 'Hello project',
            summary: 'A small project.',
            candidate_state: 'proposed',
            source_availability: 'not_loaded',
          },
        },
        {
          item_kind: 'turn_completed',
          sequence: 4,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          outcome: 'candidate_ready',
        },
      ],
    },
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  };
}

export function createRejectedTaskStreamWire() {
  const wire = createTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 5,
      window: {
        ...wire.conversation.window,
        last_sequence: 5,
      },
      items: [
        ...wire.conversation.items,
        {
          item_kind: 'candidate_reviewed',
          sequence: 5,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          draft_id: DRAFT_ID,
          decision: 'rejected',
          candidate_state: 'rejected',
          saved_revision: null,
        },
      ],
    },
  };
}

export function createAcceptedTaskStreamWire(revisionNumber = 1) {
  const wire = createTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 5,
      window: {
        ...wire.conversation.window,
        last_sequence: 5,
      },
      items: [
        ...wire.conversation.items,
        {
          item_kind: 'candidate_reviewed',
          sequence: 5,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          draft_id: DRAFT_ID,
          decision: 'accepted',
          candidate_state: 'saved',
          saved_revision: { revision_number: revisionNumber },
        },
      ],
    },
  };
}

export function createAnswerTaskStreamWire() {
  const wire = createTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174000',
            text: 'What does this project do?',
          },
          message_kind: 'submitted',
          mode: 'question',
          task: null,
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: null,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'run_completed',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          terminal_status: 'succeeded',
          result_kind: 'explanation',
          assistant_message: {
            message_id: ASSISTANT_MESSAGE_ID,
            text: 'This answer does not change files.',
          },
          candidate: null,
        },
        {
          item_kind: 'turn_completed',
          sequence: 4,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          outcome: 'answered',
        },
      ],
    },
  };
}
