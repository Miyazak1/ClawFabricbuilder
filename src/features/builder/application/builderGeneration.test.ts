import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { digestBuilderProjectProposal } from '../domain/builderProject';
import type { BuilderProjectProposal, BuilderProjectRevision } from '../domain/builderProject';
import {
  BuilderGenerationError,
  prepareBuilderGeneration,
  projectBuilderGeneration,
  type BuilderGenerationRequest,
  type BuilderGenerationResult,
} from './builderGeneration';

const FIRST_PROJECT_ID = 'builder-project:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_PROJECT_ID = 'builder-project:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function proposal(overrides: Partial<BuilderProjectProposal> = {}): BuilderProjectProposal {
  return {
    kind: 'builder_code_project',
    title: 'Lunch picker',
    summary: 'A playful picker for choosing a lunch idea.',
    files: {
      'index.html': '<main><h1>Lunch picker</h1><button id="pick">Pick</button></main>',
      'styles.css': 'main { max-width: 32rem; margin: 3rem auto; }',
      'app.js': 'document.querySelector("#pick")?.addEventListener("click", () => {});',
    },
    ...overrides,
  };
}

async function resultFor(
  request: BuilderGenerationRequest,
  value: BuilderProjectProposal = proposal(),
): Promise<BuilderGenerationResult> {
  return {
    version: 'builder-generation-result.v1',
    request_id: request.request_digest,
    proposal: value,
    evidence: {
      authority: 'builder_code_project_generator',
      prompt_version: 'builder-code-project.v2',
      request_version: request.version,
      result_version: 'builder-generation-result.v1',
      request_digest: request.request_digest,
      proposal_digest: await digestBuilderProjectProposal(value),
      project_id: request.project_id,
      target_revision: request.target_revision,
      parent_revision: request.parent_revision === null ? null : { ...request.parent_revision },
    },
    admissions: {
      execution: 'not_evaluated',
      preview_script: 'not_authorized',
    },
  };
}

async function createFirstRevision(): Promise<BuilderProjectRevision> {
  const request = await prepareBuilderGeneration(
    { idea: 'Make a playful lunch picker.' },
    { createProjectId: () => FIRST_PROJECT_ID },
  );
  return projectBuilderGeneration({ request, result: await resultFor(request) });
}

function authorityFacts(source: string, fileName: string) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports: string[] = [];
  const forbidden: string[] = [];
  const forbiddenIdentifiers = new Set([
    'BroadcastChannel',
    'EventSource',
    'FileSystemHandle',
    'Function',
    'SharedWorker',
    'WebAssembly',
    'WebSocket',
    'Worker',
    'XMLHttpRequest',
    'caches',
    'fetch',
    'indexedDB',
    'localStorage',
    'postMessage',
    'require',
    'sessionStorage',
  ]);
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      forbidden.push('dynamic-import-or-require');
    } else if (ts.isIdentifier(node) && forbiddenIdentifiers.has(node.text)) {
      forbidden.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { imports, forbidden };
}

describe('builderGeneration', () => {
  it('creates an exact canonical request without prompt or generator authority fields', async () => {
    const input = { idea: 'Make a playful lunch picker.' };
    const dependencies = { createProjectId: () => FIRST_PROJECT_ID };

    const first = await prepareBuilderGeneration(input, dependencies);
    const second = await prepareBuilderGeneration(input, dependencies);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.keys(first)).toEqual([
      'version',
      'idea',
      'project_id',
      'target_revision',
      'parent_revision',
      'request_digest',
    ]);
    expect(first.version).toBe('builder-generation-request.v1');
    expect(first.idea).toBe(input.idea);
    expect(first.project_id).toBe(FIRST_PROJECT_ID);
    expect(first.target_revision).toBe(1);
    expect(first.parent_revision).toBeNull();
    expect(first.request_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first).not.toHaveProperty('prompt');
    expect(first).not.toHaveProperty('prompt_version');
    expect(first).not.toHaveProperty('authority');
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('uses a host identity factory and rejects invalid or failing host identity generation', async () => {
    const identityFactory = vi.fn(() => FIRST_PROJECT_ID);
    const request = await prepareBuilderGeneration(
      { idea: 'Make a lunch picker.' },
      { createProjectId: identityFactory },
    );
    expect(identityFactory).toHaveBeenCalledOnce();
    expect(request.project_id).toBe(FIRST_PROJECT_ID);

    await expect(prepareBuilderGeneration(
      { idea: 'Make a lunch picker.' },
      { createProjectId: () => 'model-project-id' },
    )).rejects.toMatchObject({ code: 'identity_unavailable' });
    await expect(prepareBuilderGeneration(
      { idea: 'Make a lunch picker.' },
      { createProjectId: () => { throw new Error('identity-marker'); } },
    )).rejects.toMatchObject({ code: 'identity_unavailable' });
  });

  it('projects an exact structured result into revision one with host-owned identity', async () => {
    const request = await prepareBuilderGeneration(
      { idea: 'Make a playful lunch picker.' },
      { createProjectId: () => FIRST_PROJECT_ID },
    );
    const result = await resultFor(request);

    const revision = await projectBuilderGeneration({ request, result });

    expect(Object.keys(result)).toEqual(['version', 'request_id', 'proposal', 'evidence', 'admissions']);
    expect(result.proposal.kind).toBe('builder_code_project');
    expect(revision.project_id).toBe(FIRST_PROJECT_ID);
    expect(revision.revision).toBe(1);
    expect(revision.parent_revision).toBeNull();
    expect(revision.files['app.js']).toBe(result.proposal.files['app.js']);
    expect(revision.files['index.html']).not.toMatch(/<script/i);
    expect(revision.proposal_evidence).toEqual({
      authority: 'builder_code_project_generator',
      prompt_version: 'builder-code-project.v2',
      request_version: 'builder-generation-request.v1',
      result_version: 'builder-generation-result.v1',
      request_digest: request.request_digest,
      proposal_digest: result.evidence.proposal_digest,
      project_id: request.project_id,
      target_revision: 1,
      parent_revision: null,
    });
    expect(revision.execution_admission).toBe('not_evaluated');
    expect(revision.preview_script_admission).toBe('not_authorized');
    expect(Object.isFrozen(revision)).toBe(true);
    expect(Object.isFrozen(revision.files)).toBe(true);
  });

  it('binds a revision request and result to the exact current revision', async () => {
    const currentProject = await createFirstRevision();
    const request = await prepareBuilderGeneration({
      idea: 'Change the title and make the button label friendlier.',
      currentProject,
    });
    const revisedProposal = proposal({ title: 'Friendly lunch picker' });
    const revised = await projectBuilderGeneration({
      request,
      result: await resultFor(request, revisedProposal),
      currentProject,
    });

    expect(request.target_revision).toBe(2);
    expect(request.parent_revision).toEqual({
      revision: currentProject.revision,
      revision_digest: currentProject.revision_digest,
    });
    expect(revised.revision).toBe(2);
    expect(revised.parent_revision).toEqual(request.parent_revision);
  });

  it('does not call the project identity factory while revising an existing project', async () => {
    const currentProject = await createFirstRevision();
    const identityFactory = vi.fn(() => OTHER_PROJECT_ID);

    const request = await prepareBuilderGeneration(
      { idea: 'Use softer colors.', currentProject },
      { createProjectId: identityFactory },
    );

    expect(identityFactory).not.toHaveBeenCalled();
    expect(request.project_id).toBe(FIRST_PROJECT_ID);
  });

  it('fails closed when the current project changes before projection', async () => {
    const currentProject = await createFirstRevision();
    const request = await prepareBuilderGeneration({ idea: 'Use softer colors.', currentProject });
    const result = await resultFor(request);
    const changedProject = structuredClone(currentProject);
    changedProject.revision_digest = `sha256:${'f'.repeat(64)}`;

    await expect(projectBuilderGeneration({
      request,
      result,
      currentProject: changedProject,
    })).rejects.toMatchObject({ code: 'project_version_changed' });
    await expect(projectBuilderGeneration({ request, result }))
      .rejects.toMatchObject({ code: 'project_version_changed' });
  });

  it('rejects request drift and exact result envelope drift', async () => {
    const request = await prepareBuilderGeneration(
      { idea: 'Make a lunch picker.' },
      { createProjectId: () => FIRST_PROJECT_ID },
    );
    const result = await resultFor(request);
    const requestDrift = structuredClone(request);
    requestDrift.idea = 'A different canonical idea.';
    const wrongRequest = structuredClone(result);
    wrongRequest.request_id = `sha256:${'f'.repeat(64)}`;

    await expect(projectBuilderGeneration({ request: requestDrift, result }))
      .rejects.toMatchObject({ code: 'invalid_generation_request' });
    for (const invalid of [
      { ...result, extra: true },
      { ...result, version: 'builder-generation-request.v1' },
      wrongRequest,
      { ...result, proposal: { ...proposal(), project_id: OTHER_PROJECT_ID } },
      { ...result, evidence: { ...result.evidence, extra: true } },
      { ...result, admissions: { ...result.admissions, extra: true } },
    ]) {
      await expect(projectBuilderGeneration({ request, result: invalid }))
        .rejects.toMatchObject({ code: 'invalid_generated_project' });
    }
  });

  it('rejects unsafe ideas before creating identity', async () => {
    const identityFactory = vi.fn(() => FIRST_PROJECT_ID);
    for (const idea of [
      '',
      ' padded idea ',
      'use api_key = "raw-marker"',
      'send Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
      'read C:\\Users\\person\\notes.txt',
      'read /root/.ssh/id_rsa',
      'open https://name:pass@example.com',
      `bad\ud800`,
      'safe\u202eevil',
      'x'.repeat(4001),
    ]) {
      await expect(prepareBuilderGeneration({ idea }, { createProjectId: identityFactory }))
        .rejects.toMatchObject({ code: 'invalid_idea' });
    }
    expect(identityFactory).not.toHaveBeenCalled();
  });

  it('rejects hostile top-level prepare and project envelopes before reading any field', async () => {
    const identityFactory = vi.fn(() => FIRST_PROJECT_ID);
    let prepareGetterRead = false;
    const prepareAccessor = {} as Record<string, unknown>;
    Object.defineProperty(prepareAccessor, 'idea', {
      enumerable: true,
      get() {
        prepareGetterRead = true;
        return 'Make a lunch picker.';
      },
    });
    const prepareNonEnumerable = { idea: 'Make a lunch picker.' } as Record<string, unknown>;
    Object.defineProperty(prepareNonEnumerable, 'hidden', { value: true, enumerable: false });
    for (const invalid of [
      prepareAccessor,
      { idea: 'Make a lunch picker.', [Symbol('hidden')]: true },
      prepareNonEnumerable,
      { idea: 'Make a lunch picker.', extra: true },
      new Proxy({ idea: 'Make a lunch picker.' }, {}),
    ]) {
      await expect(prepareBuilderGeneration(
        invalid as { idea: unknown },
        { createProjectId: identityFactory },
      )).rejects.toMatchObject({ code: 'invalid_idea' });
    }
    expect(prepareGetterRead).toBe(false);
    expect(identityFactory).not.toHaveBeenCalled();

    const request = await prepareBuilderGeneration(
      { idea: 'Make a lunch picker.' },
      { createProjectId: () => FIRST_PROJECT_ID },
    );
    const result = await resultFor(request);
    let projectGetterRead = false;
    const projectAccessor = { request } as Record<string, unknown>;
    Object.defineProperty(projectAccessor, 'result', {
      enumerable: true,
      get() {
        projectGetterRead = true;
        return result;
      },
    });
    const projectNonEnumerable = { request, result } as Record<string, unknown>;
    Object.defineProperty(projectNonEnumerable, 'hidden', { value: true, enumerable: false });
    for (const invalid of [
      projectAccessor,
      { request, result, [Symbol('hidden')]: true },
      projectNonEnumerable,
      { request, result, extra: true },
      new Proxy({ request, result }, {}),
    ]) {
      await expect(projectBuilderGeneration(invalid as { request: unknown; result: unknown }))
        .rejects.toMatchObject({ code: 'invalid_generation_request' });
    }
    expect(projectGetterRead).toBe(false);
  });

  it('rejects proxy, accessor, and symbol result material during the top-level clone', async () => {
    const request = await prepareBuilderGeneration(
      { idea: 'Make a lunch picker.' },
      { createProjectId: () => FIRST_PROJECT_ID },
    );
    const result = await resultFor(request);
    let accessorRead = false;
    const accessor = { ...result } as Record<string, unknown>;
    Object.defineProperty(accessor, 'proposal', {
      enumerable: true,
      get() {
        accessorRead = true;
        return proposal();
      },
    });

    for (const invalid of [
      accessor,
      { ...result, [Symbol('hidden')]: 'marker' },
      new Proxy({ ...result }, {}),
    ]) {
      await expect(projectBuilderGeneration({ request, result: invalid }))
        .rejects.toMatchObject({ code: 'invalid_generation_request' });
    }
    expect(accessorRead).toBe(false);
  });

  it('rejects proposal, evidence, and admission drift before saving', async () => {
    const request = await prepareBuilderGeneration(
      { idea: 'Make a lunch picker.' },
      { createProjectId: () => FIRST_PROJECT_ID },
    );
    const result = await resultFor(request);
    const unsafeProposal = proposal({
      files: { ...proposal().files, 'app.js': 'const load = () => import("./other.js");' },
    });

    for (const invalid of [
      { ...result, proposal: unsafeProposal },
      { ...result, evidence: { ...result.evidence, authority: 'other' } },
      { ...result, evidence: { ...result.evidence, prompt_version: 'builder-code-project.v1' } },
      { ...result, evidence: { ...result.evidence, prompt_version: 'other.v1' } },
      { ...result, evidence: { ...result.evidence, request_version: 'other.v1' } },
      { ...result, evidence: { ...result.evidence, result_version: 'other.v1' } },
      { ...result, evidence: { ...result.evidence, request_digest: `sha256:${'d'.repeat(64)}` } },
      { ...result, evidence: { ...result.evidence, project_id: OTHER_PROJECT_ID } },
      { ...result, evidence: { ...result.evidence, target_revision: 2 } },
      { ...result, evidence: { ...result.evidence, parent_revision: { revision: 1, revision_digest: request.request_digest } } },
      { ...result, evidence: { ...result.evidence, proposal_digest: `sha256:${'e'.repeat(64)}` } },
      { ...result, admissions: { execution: 'evaluated', preview_script: 'not_authorized' } },
      { ...result, admissions: { execution: 'not_evaluated', preview_script: 'authorized' } },
    ]) {
      await expect(projectBuilderGeneration({ request, result: invalid }))
        .rejects.toMatchObject({ code: 'invalid_generated_project' });
    }
  });

  it('uses fixed ordinary errors without reflecting hostile result material', async () => {
    const request = await prepareBuilderGeneration(
      { idea: 'Make a lunch picker.' },
      { createProjectId: () => FIRST_PROJECT_ID },
    );
    const marker = 'raw-result-marker';

    try {
      await projectBuilderGeneration({ request, result: { marker } });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BuilderGenerationError);
      expect((error as BuilderGenerationError).code).toBe('invalid_generated_project');
      expect((error as Error).message).not.toContain(marker);
      expect(JSON.stringify(error)).not.toContain(marker);
    }
  });

  it('contains no prompt construction, raw output parsing, runtime dispatch, persistence, or UI authority', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/builder/application/builderGeneration.ts'),
      'utf8',
    );
    const domainSource = readFileSync(
      resolve(process.cwd(), 'src/features/builder/domain/builderProject.ts'),
      'utf8',
    );
    const productionSource = `${source}\n${domainSource}`;

    expect(source).not.toMatch(/system.?prompt|modelText|JSON\.parse|parseBuilderProjectProposalText/i);
    expect(source).not.toMatch(/\bprompt\s*:|request\.prompt|prompt_version:\s*typeof.*Request/i);
    expect(productionSource).not.toMatch(/\bfetch\s*\(|axios|localStorage|sessionStorage|indexedDB/i);
    expect(productionSource).not.toMatch(/react|router|preload|ipcRenderer|electron|dispatchEnvelope/i);
    expect(authorityFacts(domainSource, 'builderProject.ts')).toEqual({ imports: [], forbidden: [] });
    expect(authorityFacts(source, 'builderGeneration.ts')).toEqual({
      imports: ['../domain/builderProject'],
      forbidden: [],
    });
  });
});
