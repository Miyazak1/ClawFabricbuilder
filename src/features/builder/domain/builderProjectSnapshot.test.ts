import { describe, expect, it } from 'vitest';

import {
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION,
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_PROJECT_READ_RESULT_VERSION,
  BUILDER_PROJECT_SOURCE_ENTRY_KIND,
  BUILDER_PROJECT_SOURCE_TREE_VERSION,
  BuilderProjectSnapshotError,
  sanitizeBuilderProjectReadSnapshot,
} from './builderProjectSnapshot';

const ENCODER = new TextEncoder();
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174000';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174000';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174000';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174000';
const REQUEST_ID = 'builder-git-request:123e4567-e89b-42d3-a456-426614174000';
const REVIEW_ID = 'builder-review:123e4567-e89b-42d3-a456-426614174000';
const CANDIDATE_ID = `builder-code-change-candidate:${'1'.repeat(64)}`;
const COMMIT_OID = 'a'.repeat(40);
const TREE_OID = 'b'.repeat(40);
const PARENT_OID = 'c'.repeat(40);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
    )).join(',')}}`;
  }
  throw new Error('invalid fixture');
}

async function digest(value: unknown): Promise<string> {
  const raw = await globalThis.crypto.subtle.digest('SHA-256', ENCODER.encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(raw), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function sourceTree() {
  const first = {
    path: 'README.md',
    entry_kind: BUILDER_PROJECT_SOURCE_ENTRY_KIND,
    content: '# Hello\n',
  };
  const second = {
    path: 'src/index.html',
    entry_kind: BUILDER_PROJECT_SOURCE_ENTRY_KIND,
    content: '<main>Hello</main>\n',
  };
  const files = [
    { ...first, content_digest: await digest(first) },
    { ...second, content_digest: await digest(second) },
  ];
  const unsigned = {
    files,
    source_tree_version: BUILDER_PROJECT_SOURCE_TREE_VERSION,
  };
  return {
    ...unsigned,
    source_tree_digest: await digest(unsigned),
  };
}

async function verificationReceipt(sourceDigest: string, commitOid = COMMIT_OID, treeOid = TREE_OID, parentOid: string | null = null) {
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
    expected_base_oid: parentOid,
    commit_oid: commitOid,
    candidate_tree_oid: treeOid,
    resulting_tree_digest: sourceDigest,
    semantic_identity_digest: await digest({ semantic: 'fixture', treeOid }),
    object_format: 'sha1',
    commit_ref_admission: 'verified',
    request_ref_admission: 'verified',
    commit_object_admission: 'verified',
    verification_admission: 'accepted',
  };
}

async function candidateReceipt(verification: Awaited<ReturnType<typeof verificationReceipt>>, replay = false) {
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
    replay,
  };
}

async function productReceipt(
  candidate: Awaited<ReturnType<typeof candidateReceipt>>,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const body = {
    candidate_digest: candidate.candidate_digest,
    candidate_id: candidate.candidate_id,
    commit_oid: candidate.commit_oid,
    conversation_id: candidate.conversation_id,
    object_format: 'sha1',
    parent_oid: candidate.parent_oid,
    previous_revision_receipt_digest: candidate.parent_oid === null ? null : await digest({ previous: 'revision' }),
    project_id: candidate.project_id,
    request_id: candidate.request_id,
    resulting_tree_digest: candidate.resulting_tree_digest,
    review_id: REVIEW_ID,
    revision_number: candidate.parent_oid === null ? 1 : 2,
    run_id: candidate.run_id,
    selected_at_ms: 1234,
    semantic_identity_digest: candidate.semantic_identity_digest,
    summary: 'A small project.',
    task_id: candidate.task_id,
    title: 'Hello project',
    tree_oid: candidate.tree_oid,
    turn_id: candidate.turn_id,
    verification_receipt_digest: candidate.verification_receipt_digest,
    ...overrides,
  };
  return {
    project_id: body.project_id,
    revision_receipt_digest: await digest(body),
    revision_number: body.revision_number,
    previous_revision_receipt_digest: body.previous_revision_receipt_digest,
    title: body.title,
    summary: body.summary,
    conversation_id: body.conversation_id,
    turn_id: body.turn_id,
    request_id: body.request_id,
    object_format: body.object_format,
    commit_oid: body.commit_oid,
    tree_oid: body.tree_oid,
    parent_oid: body.parent_oid,
    candidate_id: body.candidate_id,
    candidate_digest: body.candidate_digest,
    resulting_tree_digest: body.resulting_tree_digest,
    semantic_identity_digest: body.semantic_identity_digest,
    verification_receipt_digest: body.verification_receipt_digest,
    task_id: body.task_id,
    run_id: body.run_id,
    review_id: body.review_id,
    selected_at_ms: body.selected_at_ms,
  };
}

async function readWire(operation: 'current_loaded' | 'revision_loaded' = 'current_loaded') {
  const tree = await sourceTree();
  const verification = await verificationReceipt(tree.source_tree_digest);
  const candidate = await candidateReceipt(verification);
  const target = await productReceipt(candidate);
  const current = operation === 'current_loaded'
    ? target
    : await productReceipt(await candidateReceipt(await verificationReceipt(
      tree.source_tree_digest,
      'd'.repeat(40),
      TREE_OID,
      PARENT_OID,
    )), { title: 'Current project', summary: 'Latest version.' });
  return {
    result_version: BUILDER_PROJECT_READ_RESULT_VERSION,
    product_revision_receipt: target,
    current: {
      project_id: current.project_id,
      title: current.title,
      summary: current.summary,
      revision_receipt_digest: current.revision_receipt_digest,
      revision_number: current.revision_number,
      object_format: 'sha1',
      commit_oid: current.commit_oid,
      tree_oid: current.tree_oid,
      parent_oid: current.parent_oid,
    },
    source_tree: tree,
    git_candidate_receipt: candidate,
    git_verification_receipt: verification,
    authority_evidence: {
      product_authority: 'sqlite_product_revision_receipt',
      code_authority: 'git_commit_tree',
      source_read_admission: 'verified',
      current_selection: 'sqlite_current_project_revision',
    },
    operation,
  };
}

async function expectInvalid(value: unknown): Promise<void> {
  await expect(sanitizeBuilderProjectReadSnapshot(value)).rejects.toBeInstanceOf(BuilderProjectSnapshotError);
}

describe('sanitizeBuilderProjectReadSnapshot', () => {
  it('projects current_loaded into a fresh frozen target/current/source tree snapshot', async () => {
    const wire = await readWire('current_loaded');
    const snapshot = await sanitizeBuilderProjectReadSnapshot(wire);

    expect(snapshot.operation).toBe('current_loaded');
    expect(snapshot.target.revision_receipt_digest).toBe(wire.product_revision_receipt.revision_receipt_digest);
    expect(snapshot.latestCurrent.revision_receipt_digest).toBe(snapshot.target.revision_receipt_digest);
    expect(snapshot.source_tree.files.map((file) => file.path)).toEqual(['README.md', 'src/index.html']);
    expect(snapshot.source_tree).not.toBe(wire.source_tree);
    expect(snapshot.target).not.toBe(wire.product_revision_receipt);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.source_tree.files[0])).toBe(true);
  });

  it('keeps revision_loaded target separate from latest current', async () => {
    const wire = await readWire('revision_loaded');
    const snapshot = await sanitizeBuilderProjectReadSnapshot(wire);

    expect(snapshot.operation).toBe('revision_loaded');
    expect(snapshot.target.revision_receipt_digest).toBe(wire.product_revision_receipt.revision_receipt_digest);
    expect(snapshot.latestCurrent.revision_receipt_digest).toBe(wire.current.revision_receipt_digest);
    expect(snapshot.latestCurrent.revision_receipt_digest).not.toBe(snapshot.target.revision_receipt_digest);
    expect(snapshot.target.title).toBe('Hello project');
    expect(snapshot.latestCurrent.title).toBe('Current project');
  });

  it('accepts real metadata revision numbers beyond 1024 and rejects invalid revision numbers', async () => {
    const tree = await sourceTree();
    const verification = await verificationReceipt(tree.source_tree_digest, COMMIT_OID, TREE_OID, PARENT_OID);
    const candidate = await candidateReceipt(verification);
    const target = await productReceipt(candidate, { revision_number: 1025 });
    const wire = {
      result_version: BUILDER_PROJECT_READ_RESULT_VERSION,
      product_revision_receipt: target,
      current: {
        project_id: target.project_id,
        title: target.title,
        summary: target.summary,
        revision_receipt_digest: target.revision_receipt_digest,
        revision_number: target.revision_number,
        object_format: 'sha1',
        commit_oid: target.commit_oid,
        tree_oid: target.tree_oid,
        parent_oid: target.parent_oid,
      },
      source_tree: tree,
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

    await expect(sanitizeBuilderProjectReadSnapshot(wire)).resolves.toMatchObject({
      target: { revision_number: 1025 },
      latestCurrent: { revision_number: 1025 },
    });
    await expectInvalid({
      ...wire,
      current: { ...wire.current, revision_number: 0 },
    });
    await expectInvalid({
      ...wire,
      current: { ...wire.current, revision_number: Number.MAX_SAFE_INTEGER + 1 },
    });
    await expectInvalid({
      ...wire,
      product_revision_receipt: { ...wire.product_revision_receipt, revision_number: 0 },
    });
  });

  it('rejects extra keys, accessors, sparse arrays, symbols, and malformed operations', async () => {
    const wire = await readWire();
    await expectInvalid({ ...wire, extra: true });
    await expectInvalid({ ...wire, operation: 'current_listed' });
    await expectInvalid({ ...wire, [Symbol('x')]: true });

    const accessor = { ...wire };
    Object.defineProperty(accessor, 'operation', { enumerable: true, get: () => 'current_loaded' });
    await expectInvalid(accessor);

    const sparse = { ...wire, source_tree: { ...wire.source_tree, files: [] as unknown[] } };
    sparse.source_tree.files.length = 2;
    await expectInvalid(sparse);
  });

  it('rejects cross-binding drift across metadata, source tree, Git receipts, and authority evidence', async () => {
    const wire = await readWire();
    await expectInvalid({
      ...wire,
      product_revision_receipt: { ...wire.product_revision_receipt, title: 'Changed title' },
    });
    await expectInvalid({
      ...wire,
      source_tree: { ...wire.source_tree, source_tree_digest: `sha256:${'0'.repeat(64)}` },
    });
    await expectInvalid({
      ...wire,
      git_candidate_receipt: { ...wire.git_candidate_receipt, tree_oid: 'e'.repeat(40) },
    });
    await expectInvalid({
      ...wire,
      git_verification_receipt: { ...wire.git_verification_receipt, resulting_tree_digest: `sha256:${'2'.repeat(64)}` },
    });
    await expectInvalid({
      ...wire,
      authority_evidence: { ...wire.authority_evidence, code_authority: 'git_commit_candidate' },
    });
  });

  it('rejects fixed-three-file assumptions and unsafe source bounds', async () => {
    const wire = await readWire();
    await expect(sanitizeBuilderProjectReadSnapshot(wire)).resolves.toMatchObject({
      source_tree: {
        files: [
          { path: 'README.md' },
          { path: 'src/index.html' },
        ],
      },
    });

    const oversized = await readWire();
    oversized.source_tree.files[0] = {
      ...oversized.source_tree.files[0],
      path: 'x'.repeat(241),
    };
    oversized.source_tree.files[0].content_digest = await digest({
      path: oversized.source_tree.files[0].path,
      entry_kind: BUILDER_PROJECT_SOURCE_ENTRY_KIND,
      content: oversized.source_tree.files[0].content,
    });
    oversized.source_tree.source_tree_digest = await digest({
      files: oversized.source_tree.files,
      source_tree_version: BUILDER_PROJECT_SOURCE_TREE_VERSION,
    });
    await expectInvalid(oversized);
  });
});
