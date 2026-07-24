import { describe, expect, it, vi } from 'vitest';

import {
  createBuilderProjectController,
  isTrustedBuilderProjectControllerSnapshot,
} from './builderProjectController';
import type {
  BuilderCodeGeneratorPort,
  BuilderProjectWorkspacePort,
} from './builderPorts';
import {
  DRAFT_ID,
  PROJECT_ID,
  createGenerationAnswer,
  createGenerationDraft,
  createReadWire,
  createRestoredGenerationDraft,
  createSaveResult,
} from '../../../test/builderV2Fixtures';

function setup(options: {
  generate?: BuilderCodeGeneratorPort['generate'];
  answer?: BuilderCodeGeneratorPort['answer'];
  restoreDraft?: BuilderCodeGeneratorPort['restoreDraft'];
  rejectDraft?: BuilderCodeGeneratorPort['rejectDraft'];
  cancel?: BuilderCodeGeneratorPort['cancel'];
  open?: BuilderProjectWorkspacePort['open'];
  saveDraft?: BuilderProjectWorkspacePort['saveDraft'];
  loadCurrent?: BuilderProjectWorkspacePort['loadCurrent'];
} = {}) {
  const generate = vi.fn(options.generate ?? (async (request) => createGenerationDraft(request)));
  const answer = vi.fn(options.answer ?? (async (request) => createGenerationAnswer(request)));
  const restoreDraft = vi.fn(options.restoreDraft ?? (async () => createRestoredGenerationDraft()));
  const rejectDraft = vi.fn(options.rejectDraft ?? (async (request) => ({
    result_version: 'builder-generation-draft-rejection-result.v1',
    draft_id: request.draft_id,
    project_id: PROJECT_ID,
    rejected: true,
    pending_draft_released: true,
    conversation_event_admission: 'sqlite_recorded',
  })));
  const cancel = vi.fn(options.cancel ?? (async (request) => ({
    request_id: request.request_id,
    cancelled: true,
  })));
  const saveDraft = vi.fn(options.saveDraft ?? (async () => {
    throw new Error('save not configured');
  }));
  const loadCurrent = vi.fn(options.loadCurrent ?? (async () => createReadWire()));
  const open = vi.fn(options.open ?? (async (request) => (
    request.project_id === null
      ? {
        result_version: 'builder-project-selection-result.v1',
        operation: 'new_selected',
        project_id: null,
      }
      : createReadWire()
  )));
  const workspace: BuilderProjectWorkspacePort = {
    open,
    saveDraft,
    loadCurrent,
    listCurrent: async () => ({ projects: [] }),
    listHistory: async () => ({ revisions: [] }),
  };
  const controller = createBuilderProjectController({
    generator: { generate, answer, restoreDraft, rejectDraft, cancel },
    workspace,
  });
  return { answer, cancel, controller, generate, loadCurrent, open, rejectDraft, restoreDraft, saveDraft };
}

describe('Builder project controller v2', () => {
  it('opens a Git/SQLite verified project and previews its source tree', async () => {
    const { controller, loadCurrent, open } = setup();
    const result = await controller.open(PROJECT_ID);

    expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(loadCurrent).not.toHaveBeenCalled();
    expect(result.status).toBe('ready');
    expect(result.savedProject?.target.project_id).toBe(PROJECT_ID);
    expect(result.savedProject?.authority_evidence).toEqual({
      product_authority: 'sqlite_product_revision_receipt',
      code_authority: 'git_commit_tree',
      source_read_admission: 'verified',
      current_selection: 'sqlite_current_project_revision',
    });
    expect(result.preview?.version).toBe('builder-source-tree-static-preview.v2');
    expect(isTrustedBuilderProjectControllerSnapshot(result)).toBe(true);
  });

  it('generates an unsaved draft without calling save or durable reads', async () => {
    const { controller, generate, loadCurrent, saveDraft } = setup();
    const result = await controller.generate('Make a timer.');

    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0]).toMatchObject({
      version: 'builder-generation-request.v2',
      instruction: 'Make a timer.',
      existing_project_id: null,
    });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(loadCurrent).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
    expect(result.draft?.draft_id).toBe(DRAFT_ID);
    expect(result.savedProject).toBeNull();
    expect(result.draft?.admissions.save).toBe('not_performed');
  });

  it('discards an unsaved draft by draft_id without saving it', async () => {
    const { controller, rejectDraft, saveDraft } = setup();
    await controller.generate('Make a timer.');
    const result = await controller.rejectDraft();

    expect(rejectDraft).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'new',
      draft: null,
      savedProject: null,
    });
  });

  it('keeps a draft visible when discard cannot be durably recorded', async () => {
    const { controller, rejectDraft } = setup({
      rejectDraft: async () => {
        throw new Error('private reject failure');
      },
    });
    await controller.generate('Make a timer.');
    const result = await controller.rejectDraft();

    expect(rejectDraft).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(result.status).toBe('reject_failed');
    expect(result.error).toBe('reject_failed');
    expect(result.draft?.draft_id).toBe(DRAFT_ID);
  });

  it('answers a question without generating a draft or creating a version', async () => {
    const { answer, controller, generate, loadCurrent, saveDraft } = setup();
    const result = await controller.answer('What does this project do?');

    expect(answer).toHaveBeenCalledOnce();
    expect(answer.mock.calls[0][0]).toMatchObject({
      version: 'builder-generation-request.v2',
      instruction: 'What does this project do?',
      existing_project_id: null,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(loadCurrent).not.toHaveBeenCalled();
    expect(result.status).toBe('new');
    expect(result.answer).toMatchObject({
      result_kind: 'explanation',
      project_id: PROJECT_ID,
      admissions: {
        draft: 'not_created',
        save: 'not_performed',
        preview: 'not_applicable',
      },
    });
    expect(result.draft).toBeNull();
    expect(result.savedProject).toBeNull();
    expect(JSON.stringify(result)).not.toContain('request_id');
  });

  it('answers against the selected saved project without saving or replacing the preview', async () => {
    const { answer, controller, generate, saveDraft } = setup();
    await controller.open(PROJECT_ID);
    const before = controller.getSnapshot();
    const result = await controller.answer('What changed in this project?');

    expect(answer.mock.calls[0][0]).toMatchObject({
      instruction: 'What changed in this project?',
      existing_project_id: PROJECT_ID,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('ready');
    expect(result.savedProject?.target.project_id).toBe(PROJECT_ID);
    expect(result.preview).toBe(before.preview);
    expect(result.draft).toBeNull();
    expect(result.answer?.project_id).toBe(PROJECT_ID);
  });

  it('can recover from a failed answer by generating a draft from the same composer', async () => {
    const { answer, controller, generate, saveDraft } = setup({
      answer: async () => {
        throw new Error('private answer failure');
      },
    });
    const failed = await controller.answer('What does this project do?');
    expect(failed.status).toBe('answer_failed');

    const result = await controller.generate('Make a timer.');

    expect(answer).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledOnce();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
    expect(result.draft?.draft_id).toBe(DRAFT_ID);
  });

  it('updates from the selected saved project but still does not auto-save', async () => {
    const { controller, generate, saveDraft } = setup();
    await controller.open(PROJECT_ID);
    const result = await controller.generate('Add a pause button.');

    expect(generate.mock.calls[0][0]).toMatchObject({
      instruction: 'Add a pause button.',
      existing_project_id: PROJECT_ID,
    });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
    expect(result.savedProject?.target.project_id).toBe(PROJECT_ID);
  });

  it('cancels an active generation by request id without saving or accepting late drafts', async () => {
    let resolveGenerate!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      resolveGenerate = resolve;
    });
    const { cancel, controller, generate, saveDraft } = setup({
      generate: async () => pending,
    });
    const generation = controller.generate('Make a timer.');
    expect(controller.getSnapshot().status).toBe('generating');
    for (let attempt = 0; attempt < 20 && generate.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(generate).toHaveBeenCalledOnce();

    const cancelled = await controller.cancel();

    expect(cancel).toHaveBeenCalledExactlyOnceWith({
      request_id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    expect(cancel.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(cancel.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(cancelled.status).toBe('new');
    expect(cancelled.draft).toBeNull();
    expect(saveDraft).not.toHaveBeenCalled();

    resolveGenerate(await createGenerationDraft());
    await generation;
    expect(controller.getSnapshot()).toMatchObject({
      status: 'new',
      draft: null,
    });
  });

  it('rejects a generated draft that is based on stale project revision evidence', async () => {
    const readWire = await createReadWire();
    const { controller } = setup({
      generate: async (request) => {
        const draft = await createGenerationDraft(request, readWire.source_tree);
        return {
          ...draft,
          base_revision_evidence: {
            ...draft.base_revision_evidence!,
            revision_receipt_digest: `sha256:${'f'.repeat(64)}`,
          },
        };
      },
      open: async () => readWire,
    });
    await controller.open(PROJECT_ID);
    const result = await controller.generate('Add a pause button.');

    expect(result).toMatchObject({
      status: 'generation_failed',
      error: 'builder_generation_failed',
      draft: null,
      savedProject: {
        target: {
          project_id: PROJECT_ID,
          revision_receipt_digest: readWire.product_revision_receipt.revision_receipt_digest,
        },
      },
    });
  });

  it('saves by draft_id only and accepts the verified reopen as current', async () => {
    const readWire = await createReadWire();
    let draft = await createGenerationDraft();
    const { controller, saveDraft, loadCurrent } = setup({
      generate: async (request) => {
        draft = await createGenerationDraft(request, readWire.source_tree);
        return draft;
      },
      saveDraft: async (request) => {
        expect(request).toEqual({ draft_id: DRAFT_ID });
        return createSaveResult(draft, readWire);
      },
      loadCurrent: async () => readWire,
    });
    await controller.generate('Make a timer.');
    const result = await controller.save();

    expect(saveDraft).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(loadCurrent).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(result.status).toBe('ready');
    expect(result.draft).toBeNull();
    expect(result.savedProject?.target.revision_number).toBe(1);
  });

  it('keeps an unsaved draft visible when the Save outcome cannot be verified', async () => {
    const { controller } = setup({
      saveDraft: async () => {
        throw new Error('private disk detail');
      },
      open: async (request) => {
        if (request.project_id !== null) throw new Error('not found');
        return {
          result_version: 'builder-project-selection-result.v1',
          operation: 'new_selected',
          project_id: null,
        };
      },
    });
    await controller.generate('Make a timer.');
    const result = await controller.save();

    expect(result.status).toBe('save_unknown');
    expect(result.error).toBe('save_unknown');
    expect(result.draft?.draft_id).toBe(DRAFT_ID);
  });

  it('recovers a lost Save response by reading the matching Git/SQLite current revision', async () => {
    const readWire = await createReadWire();
    let draft = await createGenerationDraft();
    const { controller, saveDraft, loadCurrent, open } = setup({
      generate: async (request) => {
        draft = await createGenerationDraft(request, readWire.source_tree);
        return draft;
      },
      saveDraft: async () => {
        throw new Error('response lost after commit');
      },
      open: async (request) => (
        request.project_id === null
          ? {
            result_version: 'builder-project-selection-result.v1',
            operation: 'new_selected',
            project_id: null,
          }
          : readWire
      ),
    });
    await controller.generate('Make a timer.');
    const result = await controller.save();
    expect(saveDraft).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(loadCurrent).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'ready',
      draft: null,
      savedProject: { target: { project_id: PROJECT_ID } },
    });
  });

  it('restores a Git/SQLite verified pending draft by draft id without saving it', async () => {
    const readWire = await createReadWire();
    const restored = await createRestoredGenerationDraft(readWire.source_tree);
    const { controller, restoreDraft, saveDraft } = setup({
      open: async () => readWire,
      restoreDraft: async (request) => {
        expect(request).toEqual({ draft_id: DRAFT_ID });
        return restored;
      },
    });
    await controller.open(PROJECT_ID);
    const result = await controller.restoreDraft(DRAFT_ID);

    expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
    expect(result.draft).toMatchObject({
      draft_id: DRAFT_ID,
      request_id: null,
      restart_restore: 'git_sqlite_verified',
      admissions: { save: 'not_performed' },
    });
    expect(result.savedProject?.target.project_id).toBe(PROJECT_ID);
  });

  it('keeps the saved project visible when restored draft base evidence is stale', async () => {
    const readWire = await createReadWire();
    const restored = await createRestoredGenerationDraft(readWire.source_tree);
    const { controller, restoreDraft } = setup({
      open: async () => readWire,
      restoreDraft: async () => ({
        ...restored,
        base_revision_evidence: {
          ...restored.base_revision_evidence!,
          revision_receipt_digest: `sha256:${'f'.repeat(64)}`,
        },
      }),
    });
    await controller.open(PROJECT_ID);
    const result = await controller.restoreDraft(DRAFT_ID);

    expect(restoreDraft).toHaveBeenCalledOnce();
    expect(result.status).toBe('ready');
    expect(result.draft).toBeNull();
    expect(result.savedProject?.target.project_id).toBe(PROJECT_ID);
  });

  it('fails closed when Save receipt and reopened Git/SQLite facts disagree', async () => {
    const readWire = await createReadWire();
    let draftWire = await createGenerationDraft();
    const { controller } = setup({
      generate: async (request) => {
        draftWire = await createGenerationDraft(request, readWire.source_tree);
        return draftWire;
      },
      saveDraft: async () => createSaveResult(draftWire, readWire),
      loadCurrent: async () => ({
        ...readWire,
        product_revision_receipt: {
          ...readWire.product_revision_receipt,
          candidate_id: `builder-code-change-candidate:${'9'.repeat(64)}`,
        },
      }),
    });
    await controller.generate('Make a timer.');
    const result = await controller.save();
    expect(result.status).toBe('save_unknown');
    expect(result.draft).toEqual(draftWire);
  });

  it('maps untrusted generation failures to one fixed diagnostic', async () => {
    const { controller } = setup({
      generate: async () => {
        throw new Error('https://provider.invalid private token');
      },
    });
    const result = await controller.generate('Make a timer.');
    expect(result).toMatchObject({
      status: 'generation_failed',
      error: 'builder_generation_failed',
    });
    expect(JSON.stringify(result)).not.toContain('provider.invalid');
  });

  it('ignores stale async completion after switching to a new project', async () => {
    let resolveGenerate!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      resolveGenerate = resolve;
    });
    const { controller } = setup({ generate: async () => pending });
    const generation = controller.generate('Make a timer.');
    await controller.open();
    resolveGenerate(await createGenerationDraft());
    await generation;
    expect(controller.getSnapshot()).toMatchObject({
      status: 'new',
      draft: null,
      savedProject: null,
    });
  });
});
