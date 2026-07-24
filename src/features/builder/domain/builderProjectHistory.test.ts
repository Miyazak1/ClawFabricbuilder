import { describe, expect, it } from 'vitest';

import {
  BuilderProjectHistoryError,
  sanitizeBuilderProjectHistoryResult,
} from './builderProjectHistory';
import { PROJECT_ID, createHistoryWire } from '../../../test/builderV2Fixtures';

function expectUnavailable(value: unknown): void {
  expect(() => sanitizeBuilderProjectHistoryResult(value)).toThrow(BuilderProjectHistoryError);
}

describe('sanitizeBuilderProjectHistoryResult', () => {
  it('projects verified History into renderer-safe version summaries', async () => {
    const wire = await createHistoryWire();
    const result = sanitizeBuilderProjectHistoryResult(structuredClone(wire));

    expect(result).toEqual({
      result_version: 'builder-project-read-result.v1',
      operation: 'history_listed',
      project_id: PROJECT_ID,
      current: {
        project_id: PROJECT_ID,
        title: wire.current.title,
        summary: wire.current.summary,
        revision_number: wire.current.revision_number,
        revision_receipt_digest: wire.current.revision_receipt_digest,
      },
      revisions: wire.revisions.map((revision) => ({
        project_id: revision.project_id,
        title: revision.title,
        summary: revision.summary,
        revision_number: revision.revision_number,
        revision_receipt_digest: revision.revision_receipt_digest,
        previous_revision_receipt_digest: revision.previous_revision_receipt_digest,
        selected_at_ms: revision.selected_at_ms,
        is_current: revision.is_current,
      })),
      authority_evidence: {
        product_authority: 'sqlite_product_revision_receipt',
        code_authority: 'git_commit_tree',
        source_read_admission: 'verified',
        current_selection: 'sqlite_current_project_revision',
        history_selection: 'sqlite_project_revision_receipts',
      },
    });
    expect(result.revisions[0]).toMatchObject({
      is_current: true,
      revision_number: 2,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /commit_oid|tree_oid|parent_oid|source_tree|candidate_digest|provider|credential/iu,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.revisions)).toBe(true);
    expect(Object.isFrozen(result.revisions[0])).toBe(true);
  });

  it('fails closed on old operations, extras, and authority drift', async () => {
    const wire = await createHistoryWire();

    expectUnavailable({
      ...wire,
      operation: 'project_revisions_listed',
    });
    expectUnavailable({
      ...wire,
      revisions: [{
        ...wire.revisions[0],
        candidate_digest: `sha256:${'f'.repeat(64)}`,
      }, wire.revisions[1]],
    });
    expectUnavailable({
      ...wire,
      authority_evidence: {
        ...wire.authority_evidence,
        code_authority: 'renderer_claim',
      },
    });
  });

  it('rejects current, Git identity, and receipt-chain drift', async () => {
    const wire = await createHistoryWire();

    expectUnavailable({
      ...wire,
      current: {
        ...wire.current,
        commit_oid: 'e'.repeat(40),
      },
    });
    expectUnavailable({
      ...wire,
      revisions: [{
        ...wire.revisions[0],
        previous_revision_receipt_digest: `sha256:${'f'.repeat(64)}`,
      }, wire.revisions[1]],
    });
    expectUnavailable({
      ...wire,
      revisions: [{
        ...wire.revisions[0],
        is_current: false,
      }, wire.revisions[1]],
    });
    expectUnavailable({
      ...wire,
      revisions: [wire.revisions[1], wire.revisions[0]],
    });
  });

  it('accepts truncated high-revision windows but requires both parent links', async () => {
    const wire = await createHistoryWire();
    const highRevision = {
      ...wire.revisions[0],
      revision_number: 2048,
      revision_receipt_digest: `sha256:${'8'.repeat(64)}`,
      previous_revision_receipt_digest: `sha256:${'7'.repeat(64)}`,
      parent_oid: '7'.repeat(40),
    };
    const truncated = {
      ...wire,
      current: {
        ...wire.current,
        revision_number: highRevision.revision_number,
        revision_receipt_digest: highRevision.revision_receipt_digest,
        parent_oid: highRevision.parent_oid,
      },
      revisions: [highRevision],
    };

    expect(sanitizeBuilderProjectHistoryResult(truncated).current.revision_number)
      .toBe(2048);
    expectUnavailable({
      ...truncated,
      revisions: [{
        ...highRevision,
        previous_revision_receipt_digest: null,
      }],
    });
    expectUnavailable({
      ...truncated,
      current: {
        ...truncated.current,
        parent_oid: null,
      },
      revisions: [{
        ...highRevision,
        parent_oid: null,
      }],
    });
  });

  it('rejects sparse arrays and accessor-backed data without evaluating getters', async () => {
    const wire = await createHistoryWire();
    const sparse = [...wire.revisions] as unknown[];
    delete sparse[1];
    expectUnavailable({ ...wire, revisions: sparse });

    let getterCalls = 0;
    const hostile = { ...wire.current };
    Object.defineProperty(hostile, 'title', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'Never read';
      },
    });

    expectUnavailable({ ...wire, current: hostile });
    expect(getterCalls).toBe(0);
  });
});
