import { describe, expect, it } from 'vitest';

import {
  BuilderProjectCatalogError,
  sanitizeBuilderProjectCatalogResult,
} from './builderProjectCatalog';

const PROJECT_ONE = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const PROJECT_TWO = 'builder-project:123e4567-e89b-42d3-a456-426614174001';

function item(projectId = PROJECT_ONE, overrides: Record<string, unknown> = {}) {
  return {
    project_id: projectId,
    title: 'Tiny timer',
    summary: 'A small focus timer.',
    revision: 1,
    revision_digest: `sha256:${'a'.repeat(64)}`,
    ...overrides,
  };
}

function result(projects: unknown[] = [item()]) {
  return {
    result_version: 'builder-project-catalog-result.v1',
    projects,
    catalog_evidence: {
      source_authority: 'verified_project_head_and_revision_chain',
      ordering: 'project_id_ascending',
      recency: 'not_available',
      global_atomic_snapshot: 'not_proven',
      headless_orphans: 'excluded',
      write_activity: 'none',
      resource_bounds: {
        max_project_directories: 256,
        max_file_reads: 1024,
        max_bytes: 33554432,
      },
    },
  };
}

function expectInvalid(value: unknown) {
  expect(() => sanitizeBuilderProjectCatalogResult(value)).toThrow(BuilderProjectCatalogError);
  expect(() => sanitizeBuilderProjectCatalogResult(value)).toThrow('Saved projects are unavailable.');
}

describe('Builder project catalog domain', () => {
  it('projects the exact D1 wire envelope into fresh frozen facts', () => {
    const raw = result([item(PROJECT_ONE), item(PROJECT_TWO, { title: 'Focus board', revision: 2 })]);
    const safe = sanitizeBuilderProjectCatalogResult(raw);

    expect(safe).toEqual(raw);
    expect(safe).not.toBe(raw);
    expect(safe.projects).not.toBe(raw.projects);
    expect(safe.projects[0]).not.toBe(raw.projects[0]);
    expect(Object.isFrozen(safe)).toBe(true);
    expect(Object.isFrozen(safe.projects)).toBe(true);
    expect(Object.isFrozen(safe.projects[0])).toBe(true);
    expect(Object.isFrozen(safe.catalog_evidence.resource_bounds)).toBe(true);
  });

  it('accepts an empty verified catalog', () => {
    expect(sanitizeBuilderProjectCatalogResult(result([])).projects).toEqual([]);
  });

  it.each([
    ['wrong version', { ...result(), result_version: 'builder-project-catalog-result.v0' }],
    ['extra result key', { ...result(), path: 'private-marker' }],
    ['missing projects', { result_version: 'builder-project-catalog-result.v1', catalog_evidence: result().catalog_evidence }],
    ['bad project id', result([item('builder-project:invalid')])],
    ['bad revision', result([item(PROJECT_ONE, { revision: 0 })])],
    ['bad digest', result([item(PROJECT_ONE, { revision_digest: 'sha256:nope' })])],
    ['extra project key', result([item(PROJECT_ONE, { files: { secret: true } })])],
    ['wrong evidence', { ...result(), catalog_evidence: { ...result().catalog_evidence, recency: 'recent' } }],
    ['wrong bounds', { ...result(), catalog_evidence: { ...result().catalog_evidence, resource_bounds: { ...result().catalog_evidence.resource_bounds, max_bytes: 1 } } }],
  ])('rejects %s without retaining wire data', (_label, value) => {
    expectInvalid(value);
  });

  it('requires unique, strictly project-id-sorted entries', () => {
    expectInvalid(result([item(PROJECT_TWO), item(PROJECT_ONE)]));
    expectInvalid(result([item(PROJECT_ONE), item(PROJECT_ONE)]));
  });

  it('bounds project count, display text, Unicode, and own-data structure', () => {
    expectInvalid(result(new Array(257).fill(null).map((_, index) => item(
      `builder-project:123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
    ))));
    expectInvalid(result([item(PROJECT_ONE, { title: 'x'.repeat(81) })]));
    expectInvalid(result([item(PROJECT_ONE, { summary: String.fromCharCode(0xd800) })]));
    expectInvalid(result([item(PROJECT_ONE, { title: ' padded ' })]));
  });

  it('rejects hidden, symbolic, sparse, and accessor facts without invoking getters', () => {
    const hidden = result();
    Object.defineProperty(hidden.projects[0], 'path', { enumerable: false, value: 'private-marker' });
    expectInvalid(hidden);

    const symbolic = result() as Record<PropertyKey, unknown>;
    symbolic[Symbol('secret')] = true;
    expectInvalid(symbolic);

    const sparse = result([]);
    sparse.projects = new Array(1);
    expectInvalid(sparse);

    let reads = 0;
    const accessorProjects: unknown[] = [];
    Object.defineProperty(accessorProjects, '0', {
      enumerable: true,
      get() { reads += 1; return item(); },
    });
    Object.defineProperty(accessorProjects, 'length', { value: 1 });
    expectInvalid(result(accessorProjects));
    expect(reads).toBe(0);
  });

  it('uses one descriptor snapshot and never falls through to Proxy get authority', () => {
    let gets = 0;
    const target = item();
    const proxied = new Proxy(target, {
      get(_target, key, receiver) {
        gets += 1;
        if (key === 'title') return 'Drifted title';
        return Reflect.get(target, key, receiver);
      },
    });

    const safe = sanitizeBuilderProjectCatalogResult(result([proxied]));
    expect(safe.projects[0].title).toBe('Tiny timer');
    expect(gets).toBe(0);
  });

  it('uses the projects length descriptor without invoking a Proxy length getter', () => {
    let gets = 0;
    const projects = new Proxy([item()], {
      get(target, key, receiver) {
        gets += 1;
        if (key === 'length') return 256;
        return Reflect.get(target, key, receiver);
      },
    });

    const safe = sanitizeBuilderProjectCatalogResult(result(projects));
    expect(safe.projects).toHaveLength(1);
    expect(gets).toBe(0);
  });

  it('drops no-authority extras by rejecting them instead of exposing files or paths', () => {
    const safe = sanitizeBuilderProjectCatalogResult(result());
    expect(JSON.stringify(safe)).not.toMatch(/files|path|mtime|parent_revision|proposal_evidence/i);
  });
});
