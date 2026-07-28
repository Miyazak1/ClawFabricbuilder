import { describe, expect, it } from 'vitest';

import {
  BuilderProjectCatalogError,
  sanitizeBuilderProjectCatalogResult,
  sanitizeBuilderProjectWorkspaceCatalogResult,
} from './builderProjectCatalog';
import { PROJECT_ID, createCatalogWire, createWorkspaceCatalogWire } from '../../../test/builderV2Fixtures';

describe('sanitizeBuilderProjectCatalogResult', () => {
  it('projects only SQLite-selected current revisions and Git identity evidence', async () => {
    const wire = await createCatalogWire();
    const result = sanitizeBuilderProjectCatalogResult(structuredClone(wire));

    expect(result).toEqual(wire);
    expect(result.projects[0]).toMatchObject({
      project_id: PROJECT_ID,
      revision_number: 1,
      revision_receipt_digest: expect.stringMatching(/^sha256:/u),
      commit_oid: expect.stringMatching(/^[0-9a-f]{40}$/u),
      tree_oid: expect.stringMatching(/^[0-9a-f]{40}$/u),
    });
    expect(result.authority_evidence).toEqual({
      product_authority: 'sqlite_product_revision_receipt',
      code_authority: 'not_read_for_catalog',
      source_read_admission: 'not_requested',
      current_selection: 'sqlite_current_project_revision',
    });
    expect(result.projects[0]).not.toHaveProperty('files');
    expect(result.projects[0]).not.toHaveProperty('path');
    expect(result.projects[0]).not.toHaveProperty('head');
    expect(Object.isFrozen(result.projects)).toBe(true);
  });

  it('requires strict project ordering and rejects old JSON catalog authority', async () => {
    const wire = await createCatalogWire();
    await expect(() => sanitizeBuilderProjectCatalogResult({
      ...wire,
      result_version: 'builder-project-catalog-result.v1',
    })).toThrow(BuilderProjectCatalogError);
    expect(() => sanitizeBuilderProjectCatalogResult({
      ...wire,
      projects: [wire.projects[0], wire.projects[0]],
    })).toThrow(BuilderProjectCatalogError);
  });

  it('fails closed on receipt, Git OID, or authority drift', async () => {
    const wire = await createCatalogWire();
    for (const forged of [
      {
        ...wire,
        projects: [{
          ...wire.projects[0],
          revision_receipt_digest: `sha256:${'0'.repeat(64)}`,
          extra: true,
        }],
      },
      {
        ...wire,
        projects: [{ ...wire.projects[0], commit_oid: 'bad' }],
      },
      {
        ...wire,
        authority_evidence: {
          ...wire.authority_evidence,
          code_authority: 'renderer_claim',
        },
      },
    ]) {
      expect(() => sanitizeBuilderProjectCatalogResult(forged)).toThrow(
        BuilderProjectCatalogError,
      );
    }
  });
});

describe('sanitizeBuilderProjectWorkspaceCatalogResult', () => {
  it('projects bound workspaces without leaking local paths', () => {
    const wire = createWorkspaceCatalogWire([{
      project_id: PROJECT_ID,
      title: 'Unsaved dashboard',
      source_folders: [{ name: 'site-source', status: 'selected' }],
      bound_at_ms: 20,
      has_current_revision: false,
      current_revision_number: 0,
    }]) as {
      workspaces: readonly Record<string, unknown>[];
      metadata_evidence: Record<string, unknown>;
    };
    const result = sanitizeBuilderProjectWorkspaceCatalogResult(structuredClone(wire));

    expect(result).toEqual(wire);
    expect(result.workspaces[0]).toMatchObject({
      project_id: PROJECT_ID,
      title: 'Unsaved dashboard',
      source_folders: [{ name: 'site-source', status: 'selected' }],
      has_current_revision: false,
      current_revision_number: 0,
    });
    expect(JSON.stringify(result)).not.toMatch(/[A-Z]:\\\\|project_root_path|commit_oid|tree_oid|sha256/iu);
    expect(Object.isFrozen(result.workspaces)).toBe(true);
  });

  it('fails closed on workspace path disclosure or authority drift', () => {
    const wire = createWorkspaceCatalogWire([{
      project_id: PROJECT_ID,
      title: 'Unsaved dashboard',
      source_folders: [{ name: 'site-source', status: 'selected' }],
      bound_at_ms: 20,
      has_current_revision: false,
      current_revision_number: 0,
    }]) as {
      workspaces: readonly Record<string, unknown>[];
      metadata_evidence: Record<string, unknown>;
    };
    const workspaceItem = wire.workspaces[0] as Record<string, unknown>;
    for (const forged of [
      {
        ...wire,
        workspaces: [{ ...workspaceItem, project_root_path: 'D:\\\\secret' }],
      },
      {
        ...wire,
        metadata_evidence: {
          ...wire.metadata_evidence,
          path_disclosure: 'absolute_path',
        },
      },
      {
        ...wire,
        workspaces: [{ ...workspaceItem, source_folders: [] }],
      },
    ]) {
      expect(() => sanitizeBuilderProjectWorkspaceCatalogResult(forged)).toThrow(
        BuilderProjectCatalogError,
      );
    }
  });
});
