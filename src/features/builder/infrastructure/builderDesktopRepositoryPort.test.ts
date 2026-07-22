import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import type { BuilderProjectRevision } from '../domain/builderProject';
import {
  BuilderDesktopRepositoryPortError,
  createBuilderDesktopRepositoryPort,
} from './builderDesktopRepositoryPort';

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';

function revision(): BuilderProjectRevision {
  return {
    schema_version: 1,
    record_kind: 'builder_project_revision',
    project_id: PROJECT_ID,
    revision: 1,
    revision_digest: `sha256:${'a'.repeat(64)}`,
    parent_revision: null,
    title: 'Tiny timer',
    summary: 'A small timer.',
    files: {
      'index.html': '<main>Timer</main>',
      'styles.css': 'main { color: red; }',
      'app.js': 'const timer = 1;',
    },
    proposal_evidence: {
      authority: 'builder_code_project_generator',
      prompt_version: 'builder-code-project.v1',
      request_version: 'builder-generation-request.v1',
      result_version: 'builder-generation-result.v1',
      request_digest: `sha256:${'b'.repeat(64)}`,
      proposal_digest: `sha256:${'c'.repeat(64)}`,
      project_id: PROJECT_ID,
      target_revision: 1,
      parent_revision: null,
    },
    execution_admission: 'not_evaluated',
    preview_script_admission: 'not_authorized',
  };
}

function childRevision(parentRevision = revision()): BuilderProjectRevision {
  const parent = {
    revision: parentRevision.revision,
    revision_digest: parentRevision.revision_digest,
  };
  return {
    ...revision(),
    revision: 2,
    revision_digest: `sha256:${'d'.repeat(64)}`,
    parent_revision: parent,
    proposal_evidence: {
      ...revision().proposal_evidence,
      target_revision: 2,
      parent_revision: { ...parent },
    },
  };
}

function expectPortError(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({
    code: 'builder_repository_unavailable',
    message: 'Local project storage is unavailable.',
  });
}

describe('Builder desktop repository port', () => {
  it('maps commit and loadCurrent to exact fresh bridge requests', async () => {
    const commitResult = { result_version: 'commit-result' };
    const currentResult = { result_version: 'current-result' };
    const commit = vi.fn(async (request: unknown) => {
      void request;
      return commitResult;
    });
    const loadCurrent = vi.fn(async (request: unknown) => {
      void request;
      return currentResult;
    });
    const port = createBuilderDesktopRepositoryPort({ commit, loadCurrent });
    const candidate = revision();
    const commitRequest = { revision: candidate, expected_previous: null };
    const loadRequest = { project_id: PROJECT_ID };

    const safeCommit = await port.commit(commitRequest);
    const safeCurrent = await port.loadCurrent(loadRequest);
    expect(safeCommit).toEqual({ result_version: 'commit-result' });
    expect(safeCurrent).toEqual({ result_version: 'current-result' });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0]).toEqual(commitRequest);
    expect(commit.mock.calls[0][0]).not.toBe(commitRequest);
    expect(loadCurrent.mock.calls[0][0]).toEqual(loadRequest);
    expect(loadCurrent.mock.calls[0][0]).not.toBe(loadRequest);
    expect(safeCommit).not.toBe(commitResult);
    expect(safeCurrent).not.toBe(currentResult);
    expect(Object.isFrozen(safeCommit)).toBe(true);
    commitResult.result_version = 'mutated';
    expect(safeCommit).toEqual({ result_version: 'commit-result' });
    expect(Object.isFrozen(port)).toBe(true);
  });

  it.each([
    ['missing method', { commit: vi.fn() }],
    ['extra method', { commit: vi.fn(), loadCurrent: vi.fn(), deleteAll: vi.fn() }],
    ['non-function', { commit: vi.fn(), loadCurrent: true }],
  ])('rejects %s before creating a port', (_label, value) => {
    expect(() => createBuilderDesktopRepositoryPort(value)).toThrow(BuilderDesktopRepositoryPortError);
  });

  it('rejects hidden, symbol, and accessor bridge authority without invoking accessors', () => {
    const hidden = { commit: vi.fn(), loadCurrent: vi.fn() };
    Object.defineProperty(hidden, 'deleteAll', { value: vi.fn(), enumerable: false });
    const symbolic = { commit: vi.fn(), loadCurrent: vi.fn() } as Record<PropertyKey, unknown>;
    symbolic[Symbol('deleteAll')] = vi.fn();
    let accessorReads = 0;
    const accessor = { commit: vi.fn() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'loadCurrent', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return vi.fn();
      },
    });

    expect(() => createBuilderDesktopRepositoryPort(hidden)).toThrow(BuilderDesktopRepositoryPortError);
    expect(() => createBuilderDesktopRepositoryPort(symbolic)).toThrow(BuilderDesktopRepositoryPortError);
    expect(() => createBuilderDesktopRepositoryPort(accessor)).toThrow(BuilderDesktopRepositoryPortError);
    expect(accessorReads).toBe(0);
  });

  it('redacts bridge failures and rejects requests that cannot cross structured clone', async () => {
    const privateMarker = 'private-provider-path-marker';
    const commit = vi.fn(async () => { throw new Error(privateMarker); });
    const loadCurrent = vi.fn(async () => null);
    const port = createBuilderDesktopRepositoryPort({ commit, loadCurrent });

    await expectPortError(port.commit({ revision: revision(), expected_previous: null }));
    await expectPortError(port.loadCurrent({ project_id: PROJECT_ID, callback: () => privateMarker } as never));
    expect(loadCurrent).not.toHaveBeenCalled();
    await expect(port.commit({ revision: revision(), expected_previous: null })).rejects.not.toThrow(privateMarker);
  });

  it('sends legal typed commit aliases as independent wire objects', async () => {
    const commit = vi.fn(async (request: unknown) => {
      void request;
      return {};
    });
    const port = createBuilderDesktopRepositoryPort({
      commit,
      loadCurrent: vi.fn(async () => ({})),
    });
    const candidate = childRevision();
    const commitRequest = {
      revision: candidate,
      expected_previous: candidate.parent_revision,
    };

    await port.commit(commitRequest);

    expect(commit).toHaveBeenCalledTimes(1);
    const wireRequest = commit.mock.calls[0][0] as typeof commitRequest;
    expect(wireRequest).toEqual(commitRequest);
    expect(wireRequest).not.toBe(commitRequest);
    expect(wireRequest.revision).not.toBe(candidate);
    expect(wireRequest.expected_previous).not.toBe(candidate.parent_revision);
    expect(wireRequest.revision.parent_revision).not.toBe(candidate.parent_revision);
    expect(wireRequest.expected_previous).not.toBe(wireRequest.revision.parent_revision);
    expect(Object.isFrozen(wireRequest)).toBe(true);
    expect(Object.isFrozen(wireRequest.revision)).toBe(true);
    expect(Object.isFrozen(wireRequest.expected_previous)).toBe(true);
  });

  it('rejects malformed commit requests before calling the bridge', async () => {
    const commit = vi.fn(async () => ({}));
    const port = createBuilderDesktopRepositoryPort({
      commit,
      loadCurrent: vi.fn(async () => ({})),
    });
    const candidate = childRevision();
    const extra = { revision: candidate, expected_previous: candidate.parent_revision, extra: true };
    const symbolic = { revision: candidate, expected_previous: candidate.parent_revision } as Record<PropertyKey, unknown>;
    symbolic[Symbol('private')] = true;
    let accessorReads = 0;
    const accessor = { revision: candidate } as Record<string, unknown>;
    Object.defineProperty(accessor, 'expected_previous', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return candidate.parent_revision;
      },
    });
    const aliasedParent = { revision: 1, revision_digest: `sha256:${'a'.repeat(64)}` };
    const internallyAliased = {
      ...candidate,
      parent_revision: aliasedParent,
      proposal_evidence: {
        ...candidate.proposal_evidence,
        parent_revision: aliasedParent,
      },
    };

    await expectPortError(port.commit(extra as never));
    await expectPortError(port.commit(symbolic as never));
    await expectPortError(port.commit(accessor as never));
    await expectPortError(port.commit({
      revision: internallyAliased,
      expected_previous: internallyAliased.parent_revision,
    } as never));

    expect(accessorReads).toBe(0);
    expect(commit).not.toHaveBeenCalled();
  });

  it('applies the commit request graph budget to the assembled wire object', async () => {
    const commit = vi.fn(async (request: unknown) => {
      void request;
      return {};
    });
    const port = createBuilderDesktopRepositoryPort({
      commit,
      loadCurrent: vi.fn(async () => ({})),
    });

    await expectPortError(port.commit({
      revision: { values: new Array(10_000).fill(0) },
      expected_previous: { values: new Array(10_000).fill(0) },
    } as never));

    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects accessor requests and responses without invoking their getters', async () => {
    let requestReads = 0;
    let responseReads = 0;
    const request = { project_id: PROJECT_ID } as Record<string, unknown>;
    Object.defineProperty(request, 'secret', {
      enumerable: true,
      get() {
        requestReads += 1;
        return 'private-marker';
      },
    });
    const response = {} as Record<string, unknown>;
    Object.defineProperty(response, 'record', {
      enumerable: true,
      get() {
        responseReads += 1;
        return revision();
      },
    });
    const loadCurrent = vi.fn(async (bridgeRequest: unknown) => {
      void bridgeRequest;
      return response;
    });
    const port = createBuilderDesktopRepositoryPort({
      commit: vi.fn(async (bridgeRequest: unknown) => {
        void bridgeRequest;
        return {};
      }),
      loadCurrent,
    });

    await expectPortError(port.loadCurrent(request as never));
    expect(requestReads).toBe(0);
    expect(loadCurrent).not.toHaveBeenCalled();

    await expectPortError(port.loadCurrent({ project_id: PROJECT_ID }));
    expect(responseReads).toBe(0);
  });

  it('rejects aliased bridge responses', async () => {
    const shared = { value: 'alias' };
    const port = createBuilderDesktopRepositoryPort({
      commit: vi.fn(async () => ({ left: shared, right: shared })),
      loadCurrent: vi.fn(async () => ({ left: shared, right: shared })),
    });

    await expectPortError(port.commit({ revision: revision(), expected_previous: null }));
    await expectPortError(port.loadCurrent({ project_id: PROJECT_ID }));
  });

  it('bounds wide and oversized data before calling the bridge', async () => {
    const loadCurrent = vi.fn(async () => ({}));
    const port = createBuilderDesktopRepositoryPort({
      commit: vi.fn(async () => ({})),
      loadCurrent,
    });

    await expectPortError(port.loadCurrent({ values: new Array(20_001).fill(0) } as never));
    await expectPortError(port.loadCurrent({ value: 'x'.repeat(1024 * 1024 + 1) } as never));
    await expectPortError(port.loadCurrent({ ['x'.repeat(1024 * 1024 + 1)]: true } as never));
    await expectPortError(port.loadCurrent({ value: new SharedArrayBuffer(8) } as never));
    expect(loadCurrent).not.toHaveBeenCalled();
  });

  it('freezes a fresh request graph before the bridge receives it', async () => {
    const original = { project_id: PROJECT_ID, nested: { revision: 1 } };
    const loadCurrent = vi.fn(async (request: unknown) => {
      const received = request as typeof original;
      expect(Object.isFrozen(received)).toBe(true);
      expect(Object.isFrozen(received.nested)).toBe(true);
      expect(Reflect.set(received.nested, 'revision', 2)).toBe(false);
      return {};
    });
    const port = createBuilderDesktopRepositoryPort({
      commit: vi.fn(async () => ({})),
      loadCurrent,
    });

    await port.loadCurrent(original);
    expect(original.nested.revision).toBe(1);
    expect(loadCurrent.mock.calls[0][0]).not.toBe(original);
  });

  it('preserves the bridge receiver and redacts throwing Proxy traps', async () => {
    const bridge = {
      marker: 'receiver',
      async commit(this: { marker: string }) {
        return { marker: this.marker };
      },
      async loadCurrent(this: { marker: string }) {
        return { marker: this.marker };
      },
    };
    Object.defineProperty(bridge, 'marker', { value: 'receiver', enumerable: false });
    expect(() => createBuilderDesktopRepositoryPort(bridge)).toThrow(BuilderDesktopRepositoryPortError);

    const receiver = {
      async commit(this: { commit: unknown }) {
        return { receiver_preserved: typeof this.commit === 'function' };
      },
      async loadCurrent(this: { loadCurrent: unknown }) {
        return { receiver_preserved: typeof this.loadCurrent === 'function' };
      },
    };
    const port = createBuilderDesktopRepositoryPort(receiver);
    await expect(port.loadCurrent({ project_id: PROJECT_ID })).resolves.toEqual({
      receiver_preserved: true,
    });

    const privateMarker = 'private-proxy-marker';
    const throwingProxy = new Proxy({}, {
      getPrototypeOf() { throw new Error(privateMarker); },
    });
    expect(() => createBuilderDesktopRepositoryPort(throwingProxy)).toThrowError(
      'Local project storage is unavailable.',
    );
    expect(() => createBuilderDesktopRepositoryPort(throwingProxy)).not.toThrowError(privateMarker);
  });

  it('snapshots bridge methods and never reuses the injected object as receiver', async () => {
    const originalLoad = vi.fn(async function (this: { loadCurrent: unknown }) {
      return { snapshotted_receiver: Object.isFrozen(this) && this !== proxy };
    });
    const target = {
      commit: vi.fn(async () => ({})),
      loadCurrent: originalLoad,
    };
    const proxy = new Proxy(target, {});
    const port = createBuilderDesktopRepositoryPort(proxy);
    target.loadCurrent = vi.fn(async () => ({ snapshotted_receiver: false }));

    await expect(port.loadCurrent({ project_id: PROJECT_ID })).resolves.toEqual({
      snapshotted_receiver: true,
    });
    expect(originalLoad).toHaveBeenCalledTimes(1);
    expect(target.loadCurrent).not.toHaveBeenCalled();
  });

  it('has no global runtime, legacy product, generic provider, or storage authority', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'features', 'builder', 'infrastructure', 'builderDesktopRepositoryPort.ts'),
      'utf8',
    );
    const sourceFile = ts.createSourceFile(
      'builderDesktopRepositoryPort.ts',
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
    const forbiddenNodes: string[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isIdentifier(node)
        && ['window', 'globalThis', 'document', 'localStorage', 'sessionStorage', 'indexedDB']
          .includes(node.text)
      ) {
        forbiddenNodes.push(node.text);
      }
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) forbiddenNodes.push('import');
        if (ts.isIdentifier(node.expression) && ['eval', 'fetch', 'require'].includes(node.expression.text)) {
          forbiddenNodes.push(node.expression.text);
        }
      }
      if (
        ts.isNewExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'Function'
      ) {
        forbiddenNodes.push('Function');
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    expect(imports).toEqual(['../application/builderPorts']);
    expect(forbiddenNodes).toEqual([]);
    expect(source).not.toMatch(
      /\bwindow\b|clawfabricDesktop|electron|ipcRenderer|fetch\(|localStorage|sessionStorage|indexedDB|ChatCreatePage|chat_planner|Canvas|\bJob\b|provider|router/i,
    );
    expect(source).toContain('BuilderProjectRepositoryPort');
    expect(source).toContain('assertPlainDataGraph(value');
  });
});
