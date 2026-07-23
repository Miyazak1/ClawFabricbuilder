import { describe, expect, it } from 'vitest';

import {
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION,
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_PROJECT_READ_RESULT_VERSION,
  BUILDER_PROJECT_SOURCE_ENTRY_KIND,
  BUILDER_PROJECT_SOURCE_TREE_VERSION,
} from '../domain/builderProjectSnapshot';
import {
  BuilderSourceTreePreviewError,
  createBuilderSourceTreePreview,
  isTrustedBuilderSourceTreePreviewProjection,
} from './builderSourceTreePreview';

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

type FixtureFile = Readonly<{
  path: string;
  content: string;
}>;

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

async function sourceTree(files: readonly FixtureFile[]) {
  const signedFiles = await Promise.all([...files].sort((first, second) => {
    if (first.path < second.path) return -1;
    if (first.path > second.path) return 1;
    return 0;
  }).map(
    async (file) => {
      const entry = {
        path: file.path,
        entry_kind: BUILDER_PROJECT_SOURCE_ENTRY_KIND,
        content: file.content,
      };
      return { ...entry, content_digest: await digest(entry) };
    },
  ));
  const unsigned = {
    files: signedFiles,
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
    candidate_digest: await digest({ candidate: 'fixture', commitOid }),
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

async function candidateReceipt(verification: Awaited<ReturnType<typeof verificationReceipt>>) {
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

async function readWire(
  files: readonly FixtureFile[],
  operation: 'current_loaded' | 'revision_loaded' = 'current_loaded',
) {
  const tree = await sourceTree(files);
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

async function expectUnavailable(value: unknown): Promise<void> {
  await expect(createBuilderSourceTreePreview(value)).rejects.toEqual(new BuilderSourceTreePreviewError());
}

describe('Builder source tree static preview projection', () => {
  it('projects a generic multi-file source tree using root index.html first', async () => {
    const wire = await readWire([
      { path: 'readme.md', content: '# Notes\n' },
      { path: 'assets/theme.css', content: '.card { color: #123; }' },
      { path: 'index.html', content: '<main class="card">Root page</main>' },
      { path: 'src/alternate.html', content: '<main>Alternate page</main>' },
      { path: 'src/app.ts', content: 'globalThis.__builder_preview_script_marker__ = true;' },
    ]);

    const projection = await createBuilderSourceTreePreview(wire);

    expect(projection).toMatchObject({
      version: 'builder-source-tree-static-preview.v1',
      project_id: PROJECT_ID,
      title: 'Hello project',
      selected_html_path: 'index.html',
      source_tree_digest: wire.source_tree.source_tree_digest,
      target_current_admission: 'target_is_current',
      preview_script_admission: 'not_authorized',
      preview_style_admission: 'inline_best_effort',
    });
    expect(projection.src_doc).toContain('Root page');
    expect(projection.src_doc).not.toContain('Alternate page');
    expect(projection.src_doc).toContain('data-builder-source-tree-style="assets/theme.css"');
    expect(projection.src_doc).toContain('.card { color: #123; }');
    expect(projection.src_doc).not.toContain('__builder_preview_script_marker__');
    expect(Object.isFrozen(projection)).toBe(true);
    expect(isTrustedBuilderSourceTreePreviewProjection(projection)).toBe(true);
  });

  it('uses the lexicographic first HTML file when root index.html is absent', async () => {
    const wire = await readWire([
      { path: 'pages/z.html', content: '<main>Z page</main>' },
      { path: 'pages/a.html', content: '<main>A page</main>' },
      { path: 'program.py', content: 'print("still part of the source tree")' },
    ]);

    const projection = await createBuilderSourceTreePreview(wire);

    expect(projection.selected_html_path).toBe('pages/a.html');
    expect(projection.src_doc).toContain('A page');
    expect(projection.src_doc).not.toContain('Z page');
  });

  it('returns preview_unavailable for source trees without HTML without rejecting project capability', async () => {
    const wire = await readWire([
      { path: 'README.md', content: '# Notes\n' },
      { path: 'src/main.rs', content: 'fn main() {}' },
    ]);

    await expectUnavailable(wire);
  });

  it('keeps historical targets distinct from latest current', async () => {
    const wire = await readWire([
      { path: 'index.html', content: '<main>Historical</main>' },
    ], 'revision_loaded');

    const projection = await createBuilderSourceTreePreview(wire);

    expect(projection.operation).toBe('revision_loaded');
    expect(projection.target_revision_receipt_digest).toBe(wire.product_revision_receipt.revision_receipt_digest);
    expect(projection.latest_current_revision_receipt_digest).toBe(wire.current.revision_receipt_digest);
    expect(projection.latest_current_revision_receipt_digest).not.toBe(projection.target_revision_receipt_digest);
    expect(projection.target_current_admission).toBe('target_is_historical');
  });

  it('removes active HTML entry points and injects restrictive preview CSP', async () => {
    const wire = await readWire([
      {
        path: 'index.html',
        content: [
          '<meta http-equiv="refresh" content="0; url=https://example.com">',
          '<meta http-equiv="Content-Security-Policy" content="script-src https://example.com">',
          '<main onclick="globalThis.bad = true">',
          '<a href="https://example.com" ping="//example.com/p">Link</a>',
          '<img src="https://example.com/image.png" srcset="//example.com/2x.png 2x">',
          '<script>globalThis.__builder_preview_script_marker__ = true;</script>',
          '<iframe src="https://example.com"></iframe>',
          '</main>',
        ].join(''),
      },
    ]);

    const projection = await createBuilderSourceTreePreview(wire);

    expect(projection.src_doc).toContain("default-src 'none'");
    expect(projection.src_doc).toContain("script-src 'none'");
    expect(projection.src_doc).not.toContain('onclick=');
    expect(projection.src_doc).not.toContain('http-equiv="refresh"');
    expect(projection.src_doc).not.toContain('script-src https://example.com');
    expect(projection.src_doc).not.toContain('https://example.com');
    expect(projection.src_doc).not.toContain('<script');
    expect(projection.src_doc).not.toContain('<iframe');
    expect(projection.src_doc).not.toContain('__builder_preview_script_marker__');
  });

  it('keeps closing style text inside the CSS preview style', async () => {
    const wire = await readWire([
      { path: 'index.html', content: '<main>Styled</main>' },
      { path: 'style.css', content: 'body::before { content: "</style><script>bad()</script>"; }' },
    ]);

    const projection = await createBuilderSourceTreePreview(wire);

    expect(projection.src_doc).toContain('\\3C /style>\\3C script>bad()\\3C /script>');
    expect(projection.src_doc.match(/<script/gu)).toBeNull();
    expect(projection.src_doc.match(/<style/gu)).toHaveLength(1);
  });

  it('fails closed for oversized preview output, typed forgery, and untrusted projections', async () => {
    const oversized = await readWire([
      { path: 'index.html', content: `<main>${'x'.repeat(530 * 1024)}</main>` },
    ]);
    await expectUnavailable(oversized);

    const valid = await readWire([{ path: 'index.html', content: '<main>Valid</main>' }]);
    await expectUnavailable({
      ...valid,
      source_tree: {
        ...valid.source_tree,
        files: [
          {
            ...valid.source_tree.files[0],
            content: '<main>Forged after digest</main>',
          },
        ],
      },
    });

    const projection = await createBuilderSourceTreePreview(valid);
    expect(isTrustedBuilderSourceTreePreviewProjection({ ...projection })).toBe(false);
    expect(isTrustedBuilderSourceTreePreviewProjection(null)).toBe(false);
  });
});
