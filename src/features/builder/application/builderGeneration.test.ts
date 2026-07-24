import { describe, expect, it } from 'vitest';

import {
  BUILDER_GENERATION_REQUEST_PROTOCOL,
  BuilderGenerationError,
  createBuilderGenerationRequest,
  sanitizeBuilderGenerationAnswer,
  sanitizeBuilderGenerationDraft,
  sanitizeBuilderGenerationRequest,
  sanitizeRestoredBuilderGenerationDraft,
} from './builderGeneration';
import {
  DRAFT_ID,
  PROJECT_ID,
  createGenerationAnswer,
  createGenerationDraft,
  createRestoredGenerationDraft,
  createSourceTree,
} from '../../../test/builderV2Fixtures';

describe('Builder generation v2', () => {
  it('creates a deterministic request for a new project without renderer-owned revision facts', async () => {
    const first = await createBuilderGenerationRequest('Make a timer.');
    const second = await createBuilderGenerationRequest('Make a timer.');

    expect(first).toEqual(second);
    expect(first).toEqual({
      version: BUILDER_GENERATION_REQUEST_PROTOCOL,
      instruction: 'Make a timer.',
      existing_project_id: null,
      request_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).not.toHaveProperty('source_tree');
    expect(first).not.toHaveProperty('revision');
    expect(first).not.toHaveProperty('commit_oid');
  });

  it('binds an update request to the selected durable project identity', async () => {
    const request = await createBuilderGenerationRequest('Add a pause button.', PROJECT_ID);
    expect(await sanitizeBuilderGenerationRequest(structuredClone(request))).toEqual(request);
    expect(request.existing_project_id).toBe(PROJECT_ID);
  });

  it.each([
    '',
    ' padded ',
    `bad\u0000instruction`,
    `bad\uD800instruction`,
  ])('rejects unsafe instruction %j', async (instruction) => {
    await expect(createBuilderGenerationRequest(instruction)).rejects.toMatchObject({
      code: 'invalid_instruction',
    });
  });

  it('fails closed on request digest drift and extra authority fields', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    await expect(sanitizeBuilderGenerationRequest({
      ...request,
      request_digest: `sha256:${'0'.repeat(64)}`,
    })).rejects.toBeInstanceOf(BuilderGenerationError);
    await expect(sanitizeBuilderGenerationRequest({
      ...request,
      provider_id: 'renderer-owned',
    })).rejects.toBeInstanceOf(BuilderGenerationError);
  });

  it('accepts a fresh unsaved multi-language source-tree draft', async () => {
    const request = await createBuilderGenerationRequest('Make a command line helper.');
    const tree = await createSourceTree([
      { path: 'src/main.py', content: 'print("ready")\n' },
      { path: 'Cargo.toml', content: '[package]\nname = "helper"\n' },
      { path: 'README.md', content: '# Helper\n' },
    ]);
    const wire = await createGenerationDraft(request, tree);
    const result = await sanitizeBuilderGenerationDraft(structuredClone(wire), request);

    expect(result.source_tree.files.map(({ path }) => path)).toEqual([
      'Cargo.toml',
      'README.md',
      'src/main.py',
    ]);
    expect(result.admissions).toEqual({
      conversation: 'sqlite_recorded',
      draft: 'candidate_not_saved',
      save: 'not_performed',
      preview: 'not_evaluated',
      execution: 'not_evaluated',
    });
    expect(result.restart_restore).toBe('not_persisted');
    expect(Object.isFrozen(result.source_tree.files)).toBe(true);
  });

  it('rejects draft identity drift, source digest drift, and hidden fields', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const draft = await createGenerationDraft(request);
    for (const forged of [
      { ...draft, request_id: `sha256:${'f'.repeat(64)}` },
      {
        ...draft,
        candidate: { ...draft.candidate, resulting_tree_digest: `sha256:${'e'.repeat(64)}` },
      },
      { ...draft, saved: true },
    ]) {
      await expect(sanitizeBuilderGenerationDraft(forged, request)).rejects.toMatchObject({
        code: 'invalid_generated_draft',
      });
    }
  });

  it('accepts an explanation answer without draft, source, or save authority', async () => {
    const request = await createBuilderGenerationRequest('What does this project do?');
    const result = await sanitizeBuilderGenerationAnswer(
      structuredClone(await createGenerationAnswer(request)),
      request,
    );

    expect(result).toEqual({
      version: 'builder-generation-result.v2',
      result_kind: 'explanation',
      title: 'Current project',
      summary: 'Explains the current project.',
      explanation: 'This answer does not change files.',
      project_id: PROJECT_ID,
      existing_project_id: null,
      admissions: {
        conversation: 'sqlite_recorded',
        draft: 'not_created',
        save: 'not_performed',
        preview: 'not_applicable',
        execution: 'not_evaluated',
      },
    });
    expect(result).not.toHaveProperty('request_id');
    expect(result).not.toHaveProperty('draft_id');
    expect(result).not.toHaveProperty('source_tree');
    expect(result).not.toHaveProperty('candidate');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects explanation route drift, source fields, and saved admissions', async () => {
    const request = await createBuilderGenerationRequest('What does this project do?');
    const answer = await createGenerationAnswer(request);
    for (const forged of [
      { ...answer, result_kind: 'candidate' },
      { ...answer, request_id: `sha256:${'f'.repeat(64)}` },
      { ...answer, source_tree: await createSourceTree() },
      { ...answer, admissions: { ...answer.admissions, draft: 'candidate_not_saved' } },
    ]) {
      await expect(sanitizeBuilderGenerationAnswer(forged, request)).rejects.toMatchObject({
        code: 'invalid_generated_answer',
      });
    }
  });

  it('accepts a Git/SQLite restored unsaved draft without request authority', async () => {
    const restored = await createRestoredGenerationDraft();
    const result = await sanitizeRestoredBuilderGenerationDraft(structuredClone(restored), DRAFT_ID);

    expect(result.request_id).toBeNull();
    expect(result.restart_restore).toBe('git_sqlite_verified');
    expect(result.existing_project_id).toBe(PROJECT_ID);
    expect(result.base_revision_evidence?.project_id).toBe(PROJECT_ID);
    expect(result.admissions.save).toBe('not_performed');
  });

  it('rejects restored draft id drift and fabricated restored request authority', async () => {
    const restored = await createRestoredGenerationDraft();
    for (const forged of [
      { ...restored, draft_id: `builder-generation-draft:${'9'.repeat(64)}` },
      { ...restored, request_id: `sha256:${'9'.repeat(64)}` },
      { ...restored, saved: true },
    ]) {
      await expect(sanitizeRestoredBuilderGenerationDraft(forged, DRAFT_ID)).rejects.toMatchObject({
        code: 'invalid_generated_draft',
      });
    }
  });
});
