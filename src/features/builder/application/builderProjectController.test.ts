import { describe, expect, it, vi } from 'vitest';

import {
  createBuilderProjectController,
  isTrustedBuilderProjectControllerSnapshot,
} from './builderProjectController';
import type {
  BuilderCodeGeneratorPort,
  BuilderProjectWorkspacePort,
} from './builderPorts';
import { BuilderGenerationDiagnosticError } from './builderPorts';
import {
  DRAFT_ID,
  PROJECT_ID,
  createGenerationAnswer,
  createGenerationDraft,
  createReadWire,
  createRestoredGenerationDraft,
  createSaveResult,
  createSourceTree,
  digest,
} from '../../../test/builderV2Fixtures';

function setup(options: {
  submit?: BuilderCodeGeneratorPort['submit'];
  generate?: BuilderCodeGeneratorPort['generate'];
  retry?: BuilderCodeGeneratorPort['retry'];
  answer?: BuilderCodeGeneratorPort['answer'];
  restoreDraft?: BuilderCodeGeneratorPort['restoreDraft'];
  rejectDraft?: BuilderCodeGeneratorPort['rejectDraft'];
  cancel?: BuilderCodeGeneratorPort['cancel'];
  open?: BuilderProjectWorkspacePort['open'];
  saveDraft?: BuilderProjectWorkspacePort['saveDraft'];
  loadCurrent?: BuilderProjectWorkspacePort['loadCurrent'];
  loadRevision?: BuilderProjectWorkspacePort['loadRevision'];
} = {}) {
  const submit = vi.fn(options.submit ?? (async (request) => createGenerationDraft(request)));
  const generate = vi.fn(options.generate ?? (async (request) => createGenerationDraft(request)));
  const retry = vi.fn(options.retry ?? (async (request) => createGenerationDraft(request)));
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
  const loadRevision = vi.fn(options.loadRevision ?? (async () => ({
    ...await createReadWire(),
    operation: 'revision_loaded',
  })));
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
    loadRevision,
    listCurrent: async () => ({ projects: [] }),
    listHistory: async () => ({ revisions: [] }),
  };
  const controller = createBuilderProjectController({
    generator: { submit, generate, retry, answer, restoreDraft, rejectDraft, cancel },
    workspace,
  });
  return {
    answer,
    cancel,
    controller,
    generate,
    submit,
    retry,
    loadCurrent,
    loadRevision,
    open,
    rejectDraft,
    restoreDraft,
    saveDraft,
  };
}

type ReadWire = Awaited<ReturnType<typeof createReadWire>>;

async function readWireAsRevision(
  wire: ReadWire,
  revisionNumber: number,
  previousRevisionReceiptDigest: string | null,
): Promise<ReadWire> {
  const unsignedReceipt = {
    ...wire.product_revision_receipt,
    revision_number: revisionNumber,
    previous_revision_receipt_digest: previousRevisionReceiptDigest,
  };
  const receiptBody = { ...unsignedReceipt };
  delete (receiptBody as { revision_receipt_digest?: string }).revision_receipt_digest;
  const revisionReceiptDigest = await digest(receiptBody);
  return {
    ...wire,
    product_revision_receipt: {
      ...unsignedReceipt,
      revision_receipt_digest: revisionReceiptDigest,
    },
    current: {
      ...wire.current,
      revision_number: revisionNumber,
      revision_receipt_digest: revisionReceiptDigest,
    },
  } as unknown as ReadWire;
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

  it('submits one composer turn that can produce an unsaved draft', async () => {
    const { controller, generate, saveDraft, submit } = setup();
    const result = await controller.submit('Make a timer.');

    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0][0]).toMatchObject({
      version: 'builder-generation-request.v2',
      instruction: 'Make a timer.',
      existing_project_id: null,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
    expect(result.draft?.draft_id).toBe(DRAFT_ID);
    expect(result.answer).toBeNull();
  });

  it('submits one composer turn that can produce an answer without saving', async () => {
    const { answer, controller, generate, saveDraft, submit } = setup({
      submit: async (request) => createGenerationAnswer(request),
    });
    const result = await controller.submit('What does this project do?');

    expect(submit).toHaveBeenCalledOnce();
    expect(answer).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('new');
    expect(result.answer).toMatchObject({
      result_kind: 'explanation',
      admissions: {
        draft: 'not_created',
        save: 'not_performed',
      },
    });
    expect(result.draft).toBeNull();
  });

  it('uses neutral submit states before the main router decides answer or draft', async () => {
    let resolveSubmit!: (value: unknown) => void;
    let resolveSubmitStart!: () => void;
    const submitStarted = new Promise<void>((resolve) => {
      resolveSubmitStart = resolve;
    });
    const { controller, submit } = setup({
      submit: async (request) => {
        resolveSubmitStart();
        return new Promise((resolve) => {
          resolveSubmit = resolve;
        }).then(() => createGenerationDraft(request));
      },
    });

    const operation = controller.submit('Make a timer.');
    await submitStarted;
    expect(controller.getSnapshot()).toMatchObject({
      status: 'submitting',
      busy: true,
      retryableGeneration: false,
    });

    resolveSubmit(null);
    const result = await operation;

    expect(submit).toHaveBeenCalledOnce();
    expect(result.status).toBe('draft_ready');
  });

  it('keeps submit failures neutral and allows the next composer turn', async () => {
    let attempts = 0;
    const { controller, retry, submit } = setup({
      submit: async (request) => {
        attempts += 1;
        if (attempts === 1) {
          throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
        }
        return createGenerationDraft(request);
      },
    });

    const failed = await controller.submit('What should happen?');
    expect(failed).toMatchObject({
      status: 'submit_failed',
      error: 'builder_generation_provider_http_error',
      retryableGeneration: false,
    });
    expect(await controller.retryGenerate()).toBe(failed);
    const result = await controller.submit('Make a timer.');

    expect(submit).toHaveBeenCalledTimes(2);
    expect(retry).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
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
    const { controller, retry } = setup({
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
      retryableGeneration: false,
      draft: null,
      savedProject: {
        target: {
          project_id: PROJECT_ID,
          revision_receipt_digest: readWire.product_revision_receipt.revision_receipt_digest,
        },
      },
    });
    const retryResult = await controller.retryGenerate();
    expect(retryResult).toBe(result);
    expect(retry).not.toHaveBeenCalled();
  });

  it('retries a trusted generation failure through the retry authority only', async () => {
    const { controller, generate, retry, saveDraft } = setup({
      generate: async () => {
        throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
      },
      retry: async (request) => createGenerationDraft(request),
    });

    const failed = await controller.generate('Make a timer.');
    expect(failed).toMatchObject({
      status: 'generation_failed',
      error: 'builder_generation_provider_http_error',
      retryableGeneration: true,
    });

    const result = await controller.retryGenerate();

    expect(generate).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      instruction: 'Make a timer.',
      existing_project_id: null,
    }));
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
    expect(result.retryableGeneration).toBe(false);
    expect(result.draft?.request_id).toBe(retry.mock.calls[0][0].request_digest);
  });

  it('does not expose retry for trusted non-retryable generation failures', async () => {
    const { controller, retry } = setup({
      generate: async () => {
        throw new BuilderGenerationDiagnosticError('builder_generation_provider_unavailable');
      },
    });

    const result = await controller.generate('Make a timer.');

    expect(result).toMatchObject({
      status: 'generation_failed',
      error: 'builder_generation_provider_unavailable',
      retryableGeneration: false,
    });
    const retryResult = await controller.retryGenerate();
    expect(retryResult).toBe(result);
    expect(retry).not.toHaveBeenCalled();
  });

  it('starts distinct new work from a failed generation without using retry authority', async () => {
    let attempts = 0;
    const { controller, generate, retry } = setup({
      generate: async (request) => {
        attempts += 1;
        if (attempts === 1) {
          throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
        }
        return createGenerationDraft(request);
      },
    });

    await controller.generate('Make a timer.');
    const result = await controller.generate('Make a different timer.');

    expect(generate).toHaveBeenCalledTimes(2);
    expect(retry).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
    expect(result.retryableGeneration).toBe(false);
  });

  it('does not restore stale retry affordance when cancelling fresh generation after failure', async () => {
    let attempts = 0;
    let resolveSecondStart!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      resolveSecondStart = resolve;
    });
    const secondPending = new Promise<unknown>(() => undefined);
    const { cancel, controller, retry } = setup({
      generate: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
        }
        resolveSecondStart();
        return secondPending;
      },
    });

    const failed = await controller.generate('Make a timer.');
    expect(failed.retryableGeneration).toBe(true);
    void controller.generate('Make a different timer.').catch(() => undefined);
    await secondStarted;
    const cancelled = await controller.cancel();

    expect(cancel).toHaveBeenCalledExactlyOnceWith({
      request_id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    expect(cancelled).toMatchObject({
      status: 'generation_failed',
      error: 'builder_generation_provider_http_error',
      retryableGeneration: false,
      draft: null,
    });
    const retryResult = await controller.retryGenerate();
    expect(retryResult).toBe(cancelled);
    expect(retry).not.toHaveBeenCalled();
  });

  it('does not restore stale retry affordance when cancelling an answer after generation failure', async () => {
    let resolveAnswerStart!: () => void;
    const answerStarted = new Promise<void>((resolve) => {
      resolveAnswerStart = resolve;
    });
    const answerPending = new Promise<unknown>(() => undefined);
    const { answer, cancel, controller, retry } = setup({
      generate: async () => {
        throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
      },
      answer: async () => {
        resolveAnswerStart();
        return answerPending;
      },
    });

    const failed = await controller.generate('Make a timer.');
    expect(failed.retryableGeneration).toBe(true);
    void controller.answer('What went wrong?').catch(() => undefined);
    await answerStarted;
    const cancelled = await controller.cancel();

    expect(answer).toHaveBeenCalledOnce();
    expect(cancelled).toMatchObject({
      status: 'generation_failed',
      error: 'builder_generation_provider_http_error',
      retryableGeneration: false,
      draft: null,
    });
    const retryResult = await controller.retryGenerate();
    expect(retryResult).toBe(cancelled);
    expect(retry).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledExactlyOnceWith({
      request_id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
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

  it('inspects a historical revision without changing the current generation base', async () => {
    const currentTree = await createSourceTree([
      { path: 'index.html', content: '<main>Current</main>\n' },
    ]);
    const historicalTree = await createSourceTree([
      { path: 'index.html', content: '<main>Earlier</main>\n' },
    ]);
    const historicalWire = await createReadWire(historicalTree, 1);
    const currentWire = await readWireAsRevision(
      await createReadWire(currentTree, 1),
      2,
      historicalWire.product_revision_receipt.revision_receipt_digest,
    );
    const inspectedWire = {
      ...historicalWire,
      current: currentWire.current,
      operation: 'revision_loaded',
    };
    const { controller, generate, loadRevision } = setup({
      open: async () => currentWire,
      loadRevision: async () => inspectedWire,
    });
    await controller.open(PROJECT_ID);
    const currentDigest = currentWire.product_revision_receipt.revision_receipt_digest;
    const historicalDigest = historicalWire.product_revision_receipt.revision_receipt_digest;

    const inspected = await controller.inspectRevision(PROJECT_ID, historicalDigest);

    expect(loadRevision).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      revision_receipt_digest: historicalDigest,
    });
    expect(inspected.status).toBe('ready');
    expect(inspected.savedProject?.target.revision_receipt_digest).toBe(currentDigest);
    expect(inspected.inspectedRevision?.target.revision_receipt_digest).toBe(historicalDigest);
    expect(inspected.inspectedRevision?.source_tree.source_tree_digest).toBe(historicalTree.source_tree_digest);

    const blocked = await controller.generate('Should stay read-only.');
    expect(blocked).toBe(inspected);
    expect(generate).not.toHaveBeenCalled();

    const restoredCurrent = await controller.showCurrentRevision();
    expect(restoredCurrent.savedProject?.target.revision_receipt_digest).toBe(currentDigest);
    expect(restoredCurrent.inspectedRevision).toBeNull();
    await controller.generate('Change the current version.');
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0]).toMatchObject({ existing_project_id: PROJECT_ID });
  });

  it('ignores a historical revision whose latest current no longer matches the selected version', async () => {
    const historicalWire = await createReadWire(await createSourceTree([
      { path: 'index.html', content: '<main>Earlier</main>\n' },
    ]), 1);
    const currentWire = await readWireAsRevision(await createReadWire(await createSourceTree([
      { path: 'index.html', content: '<main>Current</main>\n' },
    ]), 1), 2, historicalWire.product_revision_receipt.revision_receipt_digest);
    const staleWire = {
      ...historicalWire,
      current: {
        ...currentWire.current,
        revision_receipt_digest: `sha256:${'f'.repeat(64)}`,
      },
      operation: 'revision_loaded',
    };
    const { controller, loadRevision } = setup({
      open: async () => currentWire,
      loadRevision: async () => staleWire,
    });
    const before = await controller.open(PROJECT_ID);

    const result = await controller.inspectRevision(
      PROJECT_ID,
      historicalWire.product_revision_receipt.revision_receipt_digest,
    );

    expect(loadRevision).toHaveBeenCalledOnce();
    expect(result).toBe(before);
    expect(result.inspectedRevision).toBeNull();
    expect(result.savedProject?.target.revision_receipt_digest)
      .toBe(currentWire.product_revision_receipt.revision_receipt_digest);
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
      retryableGeneration: false,
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
