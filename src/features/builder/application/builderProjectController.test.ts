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
  createGenerationDraft,
  createReadWire,
  createSaveResult,
} from '../../../test/builderV2Fixtures';

function setup(options: {
  generate?: BuilderCodeGeneratorPort['generate'];
  open?: BuilderProjectWorkspacePort['open'];
  saveDraft?: BuilderProjectWorkspacePort['saveDraft'];
  loadCurrent?: BuilderProjectWorkspacePort['loadCurrent'];
} = {}) {
  const generate = vi.fn(options.generate ?? (async (request) => createGenerationDraft(request)));
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
  };
  const controller = createBuilderProjectController({
    generator: { generate },
    workspace,
  });
  return { controller, generate, loadCurrent, open, saveDraft };
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
