import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopProjectCatalogPortError,
  createBuilderDesktopProjectCatalogPort,
} from './builderDesktopProjectCatalogPort';

function result() {
  return {
    result_version: 'builder-project-catalog-result.v1',
    projects: [],
    catalog_evidence: {
      source_authority: 'verified_project_head_and_revision_chain',
      ordering: 'project_id_ascending',
      recency: 'not_available',
      global_atomic_snapshot: 'not_proven',
      headless_orphans: 'excluded',
      write_activity: 'none',
      resource_bounds: { max_project_directories: 256, max_file_reads: 1024, max_bytes: 33554432 },
    },
  };
}

describe('Builder desktop project catalog port', () => {
  it('calls the exact listCurrent bridge with zero arguments and returns a fresh frozen graph', async () => {
    const raw = result();
    const listCurrent = vi.fn(async function (this: object, ...args: unknown[]) {
      expect(Object.isFrozen(this)).toBe(true);
      expect(args).toEqual([]);
      return raw;
    });
    const port = createBuilderDesktopProjectCatalogPort({ listCurrent });

    const safe = await port.listCurrent();
    expect(listCurrent).toHaveBeenCalledTimes(1);
    expect(safe).toEqual(raw);
    expect(safe).not.toBe(raw);
    expect(Object.isFrozen(safe)).toBe(true);
    expect(Object.isFrozen((safe as typeof raw).catalog_evidence)).toBe(true);
  });

  it.each([
    ['missing method', {}],
    ['extra method', { listCurrent: vi.fn(), clear: vi.fn() }],
    ['non-function', { listCurrent: true }],
  ])('rejects a %s bridge', (_label, value) => {
    expect(() => createBuilderDesktopProjectCatalogPort(value)).toThrow(
      BuilderDesktopProjectCatalogPortError,
    );
  });

  it('rejects hidden, symbolic, and accessor bridge authority without invoking getters', () => {
    const hidden = { listCurrent: vi.fn() } as Record<PropertyKey, unknown>;
    Object.defineProperty(hidden, 'clear', { value: vi.fn(), enumerable: false });
    const symbolic = { listCurrent: vi.fn() } as Record<PropertyKey, unknown>;
    symbolic[Symbol('clear')] = vi.fn();
    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, 'listCurrent', {
      enumerable: true,
      get() { reads += 1; return vi.fn(); },
    });

    expect(() => createBuilderDesktopProjectCatalogPort(hidden)).toThrow();
    expect(() => createBuilderDesktopProjectCatalogPort(symbolic)).toThrow();
    expect(() => createBuilderDesktopProjectCatalogPort(accessor)).toThrow();
    expect(reads).toBe(0);
  });

  it('redacts bridge failures and rejects accessor responses without reading them', async () => {
    const marker = 'private-path-secret-marker';
    const failed = createBuilderDesktopProjectCatalogPort({
      listCurrent: vi.fn(async () => { throw new Error(marker); }),
    });
    await expect(failed.listCurrent()).rejects.toMatchObject({
      code: 'builder_project_catalog_unavailable',
      message: 'Saved projects are unavailable.',
    });
    await expect(failed.listCurrent()).rejects.not.toThrow(marker);

    let reads = 0;
    const response = {};
    Object.defineProperty(response, 'secret', {
      enumerable: true,
      get() { reads += 1; return marker; },
    });
    const accessor = createBuilderDesktopProjectCatalogPort({
      listCurrent: vi.fn(async () => response),
    });
    await expect(accessor.listCurrent()).rejects.toBeInstanceOf(BuilderDesktopProjectCatalogPortError);
    expect(reads).toBe(0);
  });

  it('bounds response graphs before cloning them', async () => {
    const wide = createBuilderDesktopProjectCatalogPort({
      listCurrent: vi.fn(async () => ({ values: new Array(4097).fill(0) })),
    });
    const large = createBuilderDesktopProjectCatalogPort({
      listCurrent: vi.fn(async () => ({ value: 'x'.repeat(512 * 1024 + 1) })),
    });
    await expect(wide.listCurrent()).rejects.toBeInstanceOf(BuilderDesktopProjectCatalogPortError);
    await expect(large.listCurrent()).rejects.toBeInstanceOf(BuilderDesktopProjectCatalogPortError);
  });

  it('snapshots the bridge method instead of trusting later mutation', async () => {
    const original = vi.fn(async () => result());
    const source: { listCurrent: () => Promise<unknown> } = { listCurrent: original };
    const port = createBuilderDesktopProjectCatalogPort(source);
    source.listCurrent = vi.fn(async () => ({ secret: true }));

    await expect(port.listCurrent()).resolves.toEqual(result());
    expect(original).toHaveBeenCalledTimes(1);
    expect(source.listCurrent).not.toHaveBeenCalled();
  });

  it('contains no global bridge, storage, network, router, or legacy authority', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'features', 'builder', 'infrastructure', 'builderDesktopProjectCatalogPort.ts'),
      'utf8',
    );
    const sourceFile = ts.createSourceFile(
      'builderDesktopProjectCatalogPort.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const imports = sourceFile.statements.flatMap((statement) => (
      ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
        ? [statement.moduleSpecifier.text]
        : []
    ));
    expect(imports).toEqual(['../application/builderProjectCatalogController']);
    expect(source).not.toMatch(
      /\bwindow\b|clawfabricDesktop|ipcRenderer|electron|fetch\(|localStorage|sessionStorage|indexedDB|ChatCreatePage|chat_planner|Canvas|\bJob\b|router/i,
    );
  });
});
