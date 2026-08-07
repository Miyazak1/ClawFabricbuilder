import { describe, expect, it, vi } from 'vitest';

import {
  createBuilderProjectController,
  isTrustedBuilderProjectControllerSnapshot,
} from './builderProjectController';
import { createBuilderGenerationRequest } from './builderGeneration';
import type {
  BuilderCodeGeneratorPort,
  BuilderProjectWorkspacePort,
} from './builderPorts';
import { BuilderGenerationDiagnosticError } from './builderPorts';
import {
  CONVERSATION_ID,
  DRAFT_ID,
  PROJECT_ID,
  RUN_ID,
  TURN_ID,
  createGenerationAnswer,
  createGenerationDraft,
  createReadWire,
  createRestoredGenerationDraft,
  createSaveResult,
  createSourceTree,
  digest,
} from '../../../test/builderV2Fixtures';

const PLAN_SOURCE_READ_READY = Object.freeze({
  result_version: 'builder-plan-source-read-approval-status.v1',
  project_id: PROJECT_ID,
  state: 'ready',
  file_count: 1,
  approval_scope: 'current_project_plan_source_read',
  authority: 'main_selected_project_bounded_filesystem_read_v1',
} as const);

const PLAN_SOURCE_READ_APPROVED = Object.freeze({
  result_version: 'builder-plan-source-read-approval-result.v1',
  project_id: PROJECT_ID,
  operation: 'approval_recorded',
  file_count: 1,
  approval_scope: 'current_project_plan_source_read',
  authority: 'main_selected_project_bounded_filesystem_read_v1',
} as const);

function createLocalProjectSelection({
  projectId = PROJECT_ID,
  title = 'Focus timer',
  sourceFolderName = 'focus-timer',
} = {}) {
  return Object.freeze({
    result_version: 'builder-project-selection-result.v1',
    operation: 'local_project_bound',
    project_id: projectId,
    project_title: title,
    source_folders: Object.freeze([
      Object.freeze({
        name: sourceFolderName,
        status: 'selected',
      }),
    ]),
  });
}

function setup(options: {
  submit?: BuilderCodeGeneratorPort['submit'];
  generate?: BuilderCodeGeneratorPort['generate'];
  continueDraft?: BuilderCodeGeneratorPort['continueDraft'];
  generateApprovedPlan?: BuilderCodeGeneratorPort['generateApprovedPlan'];
  proposePlan?: BuilderCodeGeneratorPort['proposePlan'];
  preparePlanSourceReadApproval?: BuilderCodeGeneratorPort['preparePlanSourceReadApproval'];
  approvePlanSourceRead?: BuilderCodeGeneratorPort['approvePlanSourceRead'];
  prepareCurrentProjectWriteApproval?: BuilderCodeGeneratorPort['prepareCurrentProjectWriteApproval'];
  approveCurrentProjectWrite?: BuilderCodeGeneratorPort['approveCurrentProjectWrite'];
  retry?: BuilderCodeGeneratorPort['retry'];
  answer?: BuilderCodeGeneratorPort['answer'];
  answerDraft?: BuilderCodeGeneratorPort['answerDraft'];
  restoreDraft?: BuilderCodeGeneratorPort['restoreDraft'];
  restoreRevisionAsDraft?: BuilderCodeGeneratorPort['restoreRevisionAsDraft'];
  rejectDraft?: BuilderCodeGeneratorPort['rejectDraft'];
  cancel?: BuilderCodeGeneratorPort['cancel'];
  steer?: BuilderCodeGeneratorPort['steer'];
  queueFollowup?: BuilderCodeGeneratorPort['queueFollowup'];
  subscribeStarted?: NonNullable<BuilderCodeGeneratorPort['subscribeStarted']>;
  open?: BuilderProjectWorkspacePort['open'];
  createLocalProject?: BuilderProjectWorkspacePort['createLocalProject'];
  saveDraft?: BuilderProjectWorkspacePort['saveDraft'];
  loadCurrent?: BuilderProjectWorkspacePort['loadCurrent'];
  loadRevision?: BuilderProjectWorkspacePort['loadRevision'];
} = {}) {
  const submit = vi.fn(options.submit ?? (async (request) => createGenerationDraft(request)));
  const generate = vi.fn(options.generate ?? (async (request) => createGenerationDraft(request)));
  const continueDraft = vi.fn(options.continueDraft ?? (async (request) => {
    const hostRequest = await createBuilderGenerationRequest(request.instruction, PROJECT_ID);
    return createGenerationDraft(hostRequest);
  }));
  const generateApprovedPlan = vi.fn(options.generateApprovedPlan ?? (async () => (
    createGenerationDraft(await createBuilderGenerationRequest('Review the approved plan.', PROJECT_ID))
  )));
  const proposePlan = vi.fn(options.proposePlan ?? (async (request) => ({
    version: 'builder-generation-result.v2',
    result_kind: 'plan',
    request_id: request.request_digest,
    project_id: request.existing_project_id ?? PROJECT_ID,
    existing_project_id: request.existing_project_id,
    title: 'Project update plan',
    summary: 'Review the current project before editing.',
    steps: [
      {
        title: 'Review current files',
        purpose: 'Understand the saved project before editing.',
        expected_change: 'No files change in this step.',
        status: 'proposed',
      },
    ],
    admissions: {
      conversation: 'sqlite_recorded',
      draft: 'not_created',
      save: 'not_performed',
      preview: 'not_applicable',
      execution: 'not_evaluated',
      revision: 'not_created',
      review: 'not_recorded',
    },
    conversation_head: {
      sequence: 3,
      event_id: `builder-conversation-event:${'1'.repeat(64)}`,
      event_digest: `sha256:${'2'.repeat(64)}`,
    },
  })));
  const preparePlanSourceReadApproval = vi.fn(options.preparePlanSourceReadApproval ?? (async () => (
    PLAN_SOURCE_READ_READY
  )));
  const approvePlanSourceRead = vi.fn(options.approvePlanSourceRead ?? (async () => (
    PLAN_SOURCE_READ_APPROVED
  )));
  const prepareCurrentProjectWriteApproval = vi.fn(options.prepareCurrentProjectWriteApproval ?? (async () => ({
    result_version: 'builder-current-project-write-approval-status.v1',
    project_id: PROJECT_ID,
    state: 'ready',
    approval_scope: 'current_project_write',
    authority: 'main_selected_project_project_edit_v1',
  } as const)));
  const approveCurrentProjectWrite = vi.fn(options.approveCurrentProjectWrite ?? (async () => ({
    result_version: 'builder-current-project-write-approval-result.v1',
    project_id: PROJECT_ID,
    operation: 'already_approved',
    approval_scope: 'current_project_write',
    authority: 'main_selected_project_project_edit_v1',
  } as const)));
  const retry = vi.fn(options.retry ?? (async (request) => createGenerationDraft(request)));
  const answer = vi.fn(options.answer ?? (async (request) => createGenerationAnswer(request)));
  const answerDraft = vi.fn(options.answerDraft ?? (async (request) => {
    const hostRequest = await createBuilderGenerationRequest(request.instruction, PROJECT_ID);
    return createGenerationAnswer(hostRequest);
  }));
  const restoreDraft = vi.fn(options.restoreDraft ?? (async () => createRestoredGenerationDraft()));
  const restoreRevisionAsDraft = vi.fn(options.restoreRevisionAsDraft ?? (async () => (
    createGenerationDraft(await createBuilderGenerationRequest('Restore a saved version.', PROJECT_ID))
  )));
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
  const steer = vi.fn(options.steer ?? (async (request) => ({
    request_id: request.request_id,
    steered: true,
  })));
  const queueFollowup = vi.fn(options.queueFollowup ?? (async (request) => ({
    request_id: request.request_id,
    queued: true,
    queued_followup: {
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174002',
      message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
    },
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
  const openLocation = vi.fn(async (request: Readonly<{ project_id: string }>) => ({
    result_version: 'builder-project-location-open-result.v1',
    project_id: request.project_id,
    opened: true,
  }));
  const createLocalProject = vi.fn(options.createLocalProject ?? (async () => ({
    result_version: 'builder-project-selection-result.v1',
    operation: 'new_selected',
    project_id: null,
  })));
  const workspace: BuilderProjectWorkspacePort = {
    open,
    openLocation,
    createLocalProject,
    saveDraft,
    loadCurrent,
    loadRevision,
    listCurrent: async () => ({ projects: [] }),
    listWorkspaces: async () => ({ workspaces: [] }),
    listHistory: async () => ({ revisions: [] }),
  };
  const controller = createBuilderProjectController({
    generator: {
      submit,
      generate,
      continueDraft,
      generateApprovedPlan,
      proposePlan,
      preparePlanSourceReadApproval,
      approvePlanSourceRead,
      prepareCurrentProjectWriteApproval,
      approveCurrentProjectWrite,
      retry,
      answer,
      answerDraft,
      restoreDraft,
      restoreRevisionAsDraft,
      rejectDraft,
      cancel,
      steer,
      queueFollowup,
      ...(options.subscribeStarted === undefined
        ? {}
        : { subscribeStarted: options.subscribeStarted }),
    },
    workspace,
  });
  return {
    answer,
    answerDraft,
    cancel,
    continueDraft,
    controller,
    generate,
    generateApprovedPlan,
    prepareCurrentProjectWriteApproval,
    approveCurrentProjectWrite,
    proposePlan,
    submit,
    retry,
    steer,
    queueFollowup,
    loadCurrent,
    loadRevision,
    open,
    createLocalProject,
    rejectDraft,
    restoreDraft,
    restoreRevisionAsDraft,
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
    expect(result.preview?.version).toBe('builder-source-tree-static-preview.v3');
    expect(result.preview?.preview_runtime_limitations).toEqual([]);
    expect(isTrustedBuilderProjectControllerSnapshot(result)).toBe(true);
  });

  it('opens a restart-restored bound workspace before the first saved version', async () => {
    const { controller, open } = setup({
      open: async () => createLocalProjectSelection({
        projectId: PROJECT_ID,
        title: 'Unsaved dashboard',
        sourceFolderName: 'site-source',
      }),
    });

    const result = await controller.open(PROJECT_ID);

    expect(open).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(result.status).toBe('ready');
    expect(result.savedProject).toBeNull();
    expect(result.draft).toBeNull();
    expect(result.workingProjectId).toBe(PROJECT_ID);
    expect(result.workingProject).toEqual({
      project_id: PROJECT_ID,
      title: 'Unsaved dashboard',
      source_folders: [{
        name: 'site-source',
        status: 'selected',
      }],
    });
  });

  it('keeps generation blocked when no local project folder is bound', async () => {
    const { controller, createLocalProject, generate, loadCurrent, saveDraft } = setup();
    const result = await controller.generate('Make a timer.');

    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(loadCurrent).not.toHaveBeenCalled();
    expect(result.status).toBe('generation_failed');
    expect(result.error).toBe('builder_generation_project_workspace_required');
    expect(result.retryableGeneration).toBe(false);
    expect(result.savedProject).toBeNull();
    expect(result.draft).toBeNull();
  });

  it('keeps submit blocked when no local project folder is bound', async () => {
    const { controller, createLocalProject, saveDraft, submit } = setup();
    const result = await controller.submit('Make a timer.');

    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('submit_failed');
    expect(result.error).toBe('builder_generation_project_workspace_required');
    expect(result.retryableGeneration).toBe(false);
    expect(result.savedProject).toBeNull();
    expect(result.draft).toBeNull();
  });

  it('keeps chat project identity when a build turn is blocked before source folder binding', async () => {
    const { controller, createLocalProject, submit } = setup({
      createLocalProject: async (request) => createLocalProjectSelection({
        projectId: request.project_id ?? PROJECT_ID,
        title: request.project_title,
      }),
    });
    const answered = await controller.answer('hi');
    expect(answered.answer?.project_id).toBe(PROJECT_ID);

    const blocked = await controller.submit('Make a timer.');
    expect(submit).not.toHaveBeenCalled();
    expect(blocked.error).toBe('builder_generation_project_workspace_required');
    expect(blocked.answer?.project_id).toBe(PROJECT_ID);

    const result = await controller.createLocalProject('Focus timer');

    expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      project_title: 'Focus timer',
    });
    expect(result.workingProjectId).toBe(PROJECT_ID);
    expect(result.savedProject).toBeNull();
  });

  it('uses an explicitly bound local project folder for the first build turn', async () => {
    const sourceTree = await createSourceTree();
    const { controller, createLocalProject, submit } = setup({
      createLocalProject: async () => createLocalProjectSelection(),
      submit: async (request) => ({
        ...await createGenerationDraft(request, sourceTree),
        base_revision_evidence: null,
      }),
    });

    const bound = await controller.createLocalProject('Focus timer');
    expect(bound.workingProjectId).toBe(PROJECT_ID);

    const result = await controller.submit('Make a timer.');

    expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
      project_id: null,
      project_title: 'Focus timer',
    });
    expect(submit.mock.calls[0][0]).toMatchObject({
      instruction: 'Make a timer.',
      existing_project_id: PROJECT_ID,
    });
    expect(result).toMatchObject({
      status: 'draft_ready',
      savedProject: null,
      workingProjectId: PROJECT_ID,
      workingProject: {
        project_id: PROJECT_ID,
        title: 'Focus timer',
        source_folders: [
          {
            name: 'focus-timer',
            status: 'selected',
          },
        ],
      },
      draft: {
        project_id: PROJECT_ID,
        base_revision_evidence: null,
      },
    });
  });

  it('continues an approved plan into an unsaved draft through the approved-plan generator', async () => {
    const { controller, generate, generateApprovedPlan, saveDraft } = setup();
    await controller.open(PROJECT_ID);

    const result = await controller.generateApprovedPlan({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
    });

    expect(result.status).toBe('draft_ready');
    expect(result.draft?.project_id).toBe(PROJECT_ID);
    expect(result.draft?.existing_project_id).toBe(PROJECT_ID);
    expect(result.savedProject?.target.project_id).toBe(PROJECT_ID);
    expect(generateApprovedPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('continues an approved plan for a bound local project before the first saved version', async () => {
    const sourceTree = await createSourceTree();
    const { controller, createLocalProject, generate, generateApprovedPlan, saveDraft } = setup({
      createLocalProject: async () => createLocalProjectSelection(),
      generateApprovedPlan: async () => ({
        ...await createGenerationDraft(
          await createBuilderGenerationRequest('Review the approved plan.', PROJECT_ID),
          sourceTree,
        ),
        base_revision_evidence: null,
      }),
    });

    const bound = await controller.createLocalProject('Focus timer');
    expect(bound.workingProjectId).toBe(PROJECT_ID);

    const result = await controller.generateApprovedPlan({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
    });

    expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
      project_id: null,
      project_title: 'Focus timer',
    });
    expect(result).toMatchObject({
      status: 'draft_ready',
      savedProject: null,
      workingProjectId: PROJECT_ID,
      draft: {
        project_id: PROJECT_ID,
        existing_project_id: PROJECT_ID,
        base_revision_evidence: null,
      },
    });
    expect(generateApprovedPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('retries approved-plan continuation through the approved-plan generator only', async () => {
    let attempts = 0;
    const { controller, generate, generateApprovedPlan, retry, saveDraft } = setup({
      generateApprovedPlan: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
        }
        return createGenerationDraft(
          await createBuilderGenerationRequest('Review the approved plan.', PROJECT_ID),
        );
      },
    });
    await controller.open(PROJECT_ID);

    const failed = await controller.generateApprovedPlan({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
    });
    expect(failed).toMatchObject({
      status: 'generation_failed',
      error: 'builder_generation_provider_http_error',
      retryableGeneration: true,
      draft: null,
      savedProject: { target: { project_id: PROJECT_ID } },
    });

    const result = await controller.retryGenerate();

    expect(generateApprovedPlan).toHaveBeenCalledTimes(2);
    expect(generateApprovedPlan).toHaveBeenNthCalledWith(2, {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
    });
    expect(result.status).toBe('draft_ready');
    expect(result.retryableGeneration).toBe(false);
    expect(result.draft?.existing_project_id).toBe(PROJECT_ID);
    expect(generate).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('proposes a plan for a saved project without creating a draft or saving', async () => {
    const { controller, generate, proposePlan, saveDraft } = setup();
    const saved = await controller.open(PROJECT_ID);

    const result = await controller.proposePlan('Plan the next saved-project change.');

    expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      version: 'builder-generation-request.v2',
      instruction: 'Plan the next saved-project change.',
      existing_project_id: PROJECT_ID,
    }));
    expect(proposePlan.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('ready');
    expect(result.savedProject).toBe(saved.savedProject);
    expect(result.preview).toBe(saved.preview);
    expect(result.draft).toBeNull();
    expect(result.answer).toBeNull();
  });

  it('proposes a plan for a bound local project before the first saved version', async () => {
    const { controller, generate, proposePlan, saveDraft, submit } = setup({
      createLocalProject: async () => createLocalProjectSelection({
        projectId: PROJECT_ID,
        title: 'Unsaved dashboard',
        sourceFolderName: 'site-source',
      }),
    });
    const bound = await controller.createLocalProject('Unsaved dashboard');

    const result = await controller.proposePlan('帮我先做下方案');

    expect(bound.savedProject).toBeNull();
    expect(bound.workingProjectId).toBe(PROJECT_ID);
    expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      version: 'builder-generation-request.v2',
      instruction: '帮我先做下方案',
      existing_project_id: PROJECT_ID,
    }));
    expect(proposePlan.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('ready');
    expect(result.savedProject).toBeNull();
    expect(result.workingProjectId).toBe(PROJECT_ID);
    expect(result.workingProject).toEqual({
      project_id: PROJECT_ID,
      title: 'Unsaved dashboard',
      source_folders: [{
        name: 'site-source',
        status: 'selected',
      }],
    });
    expect(result.draft).toBeNull();
    expect(result.answer).toBeNull();
  });

  it('proposes a plan after a non-mutating answer failure on a bound local project', async () => {
    const { answer, controller, generate, proposePlan, saveDraft, submit } = setup({
      answer: async () => {
        throw new BuilderGenerationDiagnosticError('builder_generation_structured_response_invalid');
      },
      createLocalProject: async () => createLocalProjectSelection({
        projectId: PROJECT_ID,
        title: 'Unsaved dashboard',
        sourceFolderName: 'site-source',
      }),
    });
    await controller.createLocalProject('Unsaved dashboard');
    const failed = await controller.answer('我想先聊一下这个作品集首页怎么做，目标是星空背景和项目列表。');

    const result = await controller.proposePlan('帮我做成计划');

    expect(failed.status).toBe('answer_failed');
    expect(failed.workingProjectId).toBe(PROJECT_ID);
    expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      version: 'builder-generation-request.v2',
      instruction: '帮我做成计划',
      existing_project_id: PROJECT_ID,
    }));
    expect(answer).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('ready');
    expect(result.workingProjectId).toBe(PROJECT_ID);
    expect(result.draft).toBeNull();
  });

  it('discards an unsaved draft by draft_id without saving it', async () => {
    const { controller, rejectDraft, saveDraft } = setup();
    await controller.open(PROJECT_ID);
    await controller.generate('Make a timer.');
    const result = await controller.rejectDraft();

    expect(rejectDraft).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'ready',
      draft: null,
      savedProject: { target: { project_id: PROJECT_ID } },
    });
  });

  it('keeps a draft visible when discard cannot be durably recorded', async () => {
    const { controller, rejectDraft } = setup({
      rejectDraft: async () => {
        throw new Error('private reject failure');
      },
    });
    await controller.open(PROJECT_ID);
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

  it('keeps consecutive read-only chat turns on the same logical project before a folder is selected', async () => {
    const { answer, controller } = setup();
    const first = await controller.answer('hi');
    const second = await controller.answer('What did I just ask?');

    expect(answer).toHaveBeenCalledTimes(2);
    expect(answer.mock.calls[0][0]).toMatchObject({
      instruction: 'hi',
      existing_project_id: null,
    });
    expect(answer.mock.calls[1][0]).toMatchObject({
      instruction: 'What did I just ask?',
      existing_project_id: PROJECT_ID,
    });
    expect(first.answer?.project_id).toBe(PROJECT_ID);
    expect(second.answer?.project_id).toBe(PROJECT_ID);
    expect(second.status).toBe('new');
    expect(second.workingProjectId).toBeNull();
    expect(second.workingProject).toBeNull();
    expect(second.savedProject).toBeNull();
    expect(second.draft).toBeNull();
  });

  it('keeps the logical chat project visible while a later read-only answer is running', async () => {
    let answerAttempts = 0;
    let resolveSecondAnswer!: (value: unknown) => void;
    const secondAnswer = new Promise<unknown>((resolve) => {
      resolveSecondAnswer = resolve;
    });
    const { answer, controller } = setup({
      answer: async (request) => {
        answerAttempts += 1;
        if (answerAttempts === 1) return createGenerationAnswer(request);
        return secondAnswer;
      },
    });
    const first = await controller.answer('hi');
    expect(first.answer?.project_id).toBe(PROJECT_ID);

    const running = controller.answer('What did I just ask?');
    for (let attempt = 0; attempt < 20 && answer.mock.calls.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const inFlight = controller.getSnapshot();
    expect(answer).toHaveBeenCalledTimes(2);
    expect(answer.mock.calls[1][0]).toMatchObject({
      instruction: 'What did I just ask?',
      existing_project_id: PROJECT_ID,
    });
    expect(inFlight.status).toBe('answering');
    expect(inFlight.answer?.project_id).toBe(PROJECT_ID);
    expect(inFlight.workingProjectId).toBeNull();
    expect(inFlight.savedProject).toBeNull();
    expect(inFlight.draft).toBeNull();

    resolveSecondAnswer(await createGenerationAnswer(answer.mock.calls[1][0]));
    const result = await running;
    expect(result.status).toBe('new');
    expect(result.answer?.project_id).toBe(PROJECT_ID);
  });

  it('keeps prior read-only chat identity visible when a later answer fails', async () => {
    let answerAttempts = 0;
    const { answer, controller } = setup({
      answer: async (request) => {
        answerAttempts += 1;
        if (answerAttempts === 1) return createGenerationAnswer(request);
        throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
      },
    });
    const first = await controller.answer('hi');
    expect(first.answer?.project_id).toBe(PROJECT_ID);

    const failed = await controller.answer('What model are you?');

    expect(answer).toHaveBeenCalledTimes(2);
    expect(answer.mock.calls[1][0]).toMatchObject({
      instruction: 'What model are you?',
      existing_project_id: PROJECT_ID,
    });
    expect(failed.status).toBe('answer_failed');
    expect(failed.error).toBe('builder_generation_provider_http_error');
    expect(failed.answer?.project_id).toBe(PROJECT_ID);
    expect(failed.workingProjectId).toBeNull();
    expect(failed.savedProject).toBeNull();
    expect(failed.draft).toBeNull();
  });

  it('keeps recorded chat project identity when the first public answer result fails', async () => {
    let startedListener: ((event: { request_id: string; project_id: string }) => void) | null = null;
    const { answer, controller } = setup({
      subscribeStarted(listener) {
        startedListener = listener as (event: { request_id: string; project_id: string }) => void;
        return () => undefined;
      },
      answer: async (request) => {
        startedListener?.({
          request_id: request.request_digest,
          project_id: PROJECT_ID,
        });
        if (request.existing_project_id === null) {
          throw new BuilderGenerationDiagnosticError('builder_generation_structured_response_invalid');
        }
        return createGenerationAnswer(request);
      },
    });

    const first = await controller.answer('What can you help me with before I choose a project folder?');
    const second = await controller.answer('Can we keep discussing before I choose a project folder?');

    expect(answer).toHaveBeenCalledTimes(2);
    expect(answer.mock.calls[0][0]).toMatchObject({
      existing_project_id: null,
    });
    expect(answer.mock.calls[1][0]).toMatchObject({
      existing_project_id: PROJECT_ID,
    });
    expect(first.status).toBe('answer_failed');
    expect(first.conversationProjectId).toBe(PROJECT_ID);
    expect(first.workingProjectId).toBeNull();
    expect(second.status).toBe('new');
    expect(second.answer?.project_id).toBe(PROJECT_ID);
    expect(second.conversationProjectId).toBe(PROJECT_ID);
    expect(second.workingProjectId).toBeNull();
    expect(second.savedProject).toBeNull();
    expect(second.draft).toBeNull();
  });

  it('binds a selected source folder to the answered logical project instead of forking it', async () => {
    const { controller, createLocalProject } = setup({
      createLocalProject: async (request) => createLocalProjectSelection({
        projectId: request.project_id ?? PROJECT_ID,
        title: request.project_title,
      }),
    });
    const answered = await controller.answer('hi');
    expect(answered.answer?.project_id).toBe(PROJECT_ID);

    const result = await controller.createLocalProject('Focus timer');

    expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      project_title: 'Focus timer',
    });
    expect(result.status).toBe('ready');
    expect(result.workingProjectId).toBe(PROJECT_ID);
    expect(result.workingProject?.project_id).toBe(PROJECT_ID);
    expect(result.savedProject).toBeNull();
    expect(result.draft).toBeNull();
  });

  it('clears the selected workspace without deleting the visible conversation identity', async () => {
    const { answer, controller, submit } = setup();
    await controller.open(PROJECT_ID);

    const cleared = controller.clearWorkspaceSelection();

    expect(cleared.status).toBe('new');
    expect(cleared.savedProject).toBeNull();
    expect(cleared.workingProjectId).toBeNull();
    expect(cleared.workingProject).toBeNull();
    expect(cleared.conversationProjectId).toBe(PROJECT_ID);

    await controller.answer('Can we keep chatting?');

    expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      existing_project_id: PROJECT_ID,
      instruction: 'Can we keep chatting?',
      request_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      version: 'builder-generation-request.v2',
    }));

    const blocked = await controller.submit('Build the discussed page.');

    expect(submit).not.toHaveBeenCalled();
    expect(blocked.status).toBe('submit_failed');
    expect(blocked.error).toBe('builder_generation_project_workspace_required');
    expect(blocked.conversationProjectId).toBe(PROJECT_ID);
  });

  it('submits one composer turn that can produce an unsaved draft', async () => {
    const { controller, generate, saveDraft, submit } = setup();
    await controller.open(PROJECT_ID);
    const result = await controller.submit('Make a timer.');

    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0][0]).toMatchObject({
      version: 'builder-generation-request.v2',
      instruction: 'Make a timer.',
      existing_project_id: PROJECT_ID,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
    expect(result.draft?.draft_id).toBe(DRAFT_ID);
    expect(result.answer).toBeNull();
  });

  it('continues an unsaved draft through draft-id-only generation', async () => {
    const { continueDraft, controller, generate, saveDraft, submit } = setup();
    await controller.open(PROJECT_ID);
    await controller.submit('Make a timer.');
    submit.mockClear();

    const result = await controller.submit('Make it responsive.');

    expect(continueDraft).toHaveBeenCalledExactlyOnceWith({
      draft_id: DRAFT_ID,
      instruction: 'Make it responsive.',
    });
    expect(continueDraft.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(continueDraft.mock.calls[0][0]).not.toHaveProperty('existing_project_id');
    expect(continueDraft.mock.calls[0][0]).not.toHaveProperty('request_digest');
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
    expect(result.draft?.project_id).toBe(PROJECT_ID);
  });

  it('answers while keeping the current unsaved draft review available', async () => {
    const { answer, answerDraft, continueDraft, controller, saveDraft } = setup();
    await controller.open(PROJECT_ID);
    await controller.submit('Make a timer.');

    const result = await controller.answer('Why is the preview blank?');

    expect(answerDraft).toHaveBeenCalledExactlyOnceWith({
      draft_id: DRAFT_ID,
      instruction: 'Why is the preview blank?',
    });
    expect(answerDraft.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(answerDraft.mock.calls[0][0]).not.toHaveProperty('existing_project_id');
    expect(answerDraft.mock.calls[0][0]).not.toHaveProperty('request_digest');
    expect(answer).not.toHaveBeenCalled();
    expect(continueDraft).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
    expect(result.draft?.draft_id).toBe(DRAFT_ID);
    expect(result.answer?.result_kind).toBe('explanation');
  });

  it('submits one composer turn that can produce an answer without saving', async () => {
    const { answer, controller, generate, saveDraft, submit } = setup({
      submit: async (request) => createGenerationAnswer(request),
    });
    await controller.open(PROJECT_ID);
    const result = await controller.submit('What does this project do?');

    expect(submit).toHaveBeenCalledOnce();
    expect(answer).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('ready');
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
    await controller.open(PROJECT_ID);

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

  it('binds a matching started event to a working project id without making it saved', async () => {
    let listener!: Parameters<NonNullable<BuilderCodeGeneratorPort['subscribeStarted']>>[0];
    let resolveSubmit!: (value: unknown) => void;
    const unsubscribe = vi.fn();
    const { controller, submit } = setup({
      subscribeStarted(next) {
        listener = next;
        return unsubscribe;
      },
      submit: async (request) => new Promise((resolve) => {
        resolveSubmit = resolve;
      }).then(() => createGenerationDraft(request)),
    });
    await controller.open(PROJECT_ID);

    const operation = controller.submit('Make a timer.');
    for (let attempt = 0; attempt < 20 && controller.getSnapshot().status !== 'submitting'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    for (let attempt = 0; attempt < 20 && submit.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const request = await createBuilderGenerationRequest('Make a timer.', PROJECT_ID);

    listener({
      event_version: 'builder-generation-started.v1',
      request_id: `sha256:${'9'.repeat(64)}`,
      project_id: PROJECT_ID,
    });
    expect(controller.getSnapshot().workingProjectId).toBeNull();

    listener({
      event_version: 'builder-generation-started.v1',
      request_id: request.request_digest,
      project_id: PROJECT_ID,
    });
    expect(controller.getSnapshot()).toMatchObject({
      status: 'submitting',
      busy: true,
      savedProject: { target: { project_id: PROJECT_ID } },
      draft: null,
      workingProjectId: PROJECT_ID,
    });

    resolveSubmit(null);
    const result = await operation;
    expect(result.status).toBe('draft_ready');
    expect(result.workingProjectId).toBeNull();
    controller.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps retryable submit failures recoverable without using draft retry authority', async () => {
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
    await controller.open(PROJECT_ID);

    const failed = await controller.submit('What should happen?');
    expect(failed).toMatchObject({
      status: 'submit_failed',
      error: 'builder_generation_provider_http_error',
      retryableGeneration: true,
    });
    const retryResult = await controller.retryGenerate();

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      instruction: 'What should happen?',
      existing_project_id: PROJECT_ID,
    }));
    expect(retry).not.toHaveBeenCalled();
    expect(retryResult.status).toBe('draft_ready');
    expect(retryResult.retryableGeneration).toBe(false);
  });

  it('starts distinct new submit work after a submit failure without using retry authority', async () => {
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
    await controller.open(PROJECT_ID);

    const failed = await controller.submit('What should happen?');
    expect(failed.retryableGeneration).toBe(true);
    const result = await controller.submit('Make a timer.');

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      instruction: 'Make a timer.',
      existing_project_id: PROJECT_ID,
    }));
    expect(retry).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
    expect(result.retryableGeneration).toBe(false);
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
    await controller.open(PROJECT_ID);
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
    await controller.open(PROJECT_ID);
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
    expect(cancelled.status).toBe('ready');
    expect(cancelled.draft).toBeNull();
    expect(cancelled.savedProject?.target.project_id).toBe(PROJECT_ID);
    expect(saveDraft).not.toHaveBeenCalled();

    resolveGenerate(await createGenerationDraft());
    await generation;
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      draft: null,
      savedProject: { target: { project_id: PROJECT_ID } },
    });
  });

  it('steers an active generation by request id and bounded message only', async () => {
    let resolveGenerate!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      resolveGenerate = resolve;
    });
    const { controller, generate, saveDraft, steer } = setup({
      generate: async () => pending,
    });
    await controller.open(PROJECT_ID);
    const generation = controller.generate('Make a timer.');
    expect(controller.getSnapshot().status).toBe('generating');
    for (let attempt = 0; attempt < 20 && generate.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(generate).toHaveBeenCalledOnce();

    const steered = await controller.steer('  Make it blue.  ');

    expect(steered).toBe(true);
    expect(steer).toHaveBeenCalledExactlyOnceWith({
      request_id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      message: 'Make it blue.',
    });
    expect(steer.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(steer.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(steer.mock.calls[0][0]).not.toHaveProperty('project_id');
    expect(controller.getSnapshot().status).toBe('generating');
    expect(saveDraft).not.toHaveBeenCalled();

    resolveGenerate(await createGenerationDraft(generate.mock.calls[0][0]));
    await generation;
  });

  it('does not steer when there is no active generation request', async () => {
    const { controller, steer } = setup();

    await expect(controller.steer('Make it blue.')).resolves.toBe(false);

    expect(steer).not.toHaveBeenCalled();
  });

  it('queues an active follow-up by request id and bounded message only', async () => {
    let resolveGenerate!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      resolveGenerate = resolve;
    });
    const { controller, generate, queueFollowup, saveDraft } = setup({
      generate: async () => pending,
    });
    await controller.open(PROJECT_ID);
    const generation = controller.generate('Make a timer.');
    expect(controller.getSnapshot().status).toBe('generating');
    for (let attempt = 0; attempt < 20 && generate.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(generate).toHaveBeenCalledOnce();

    const queued = await controller.queueFollowup('  Make it responsive next.  ');

    expect(queued?.queued).toBe(true);
    expect(queued?.queued_followup).toEqual({
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174002',
      message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
    });
    expect(queueFollowup).toHaveBeenCalledExactlyOnceWith({
      request_id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      message: 'Make it responsive next.',
    });
    expect(queueFollowup.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(queueFollowup.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(queueFollowup.mock.calls[0][0]).not.toHaveProperty('project_id');
    expect(controller.getSnapshot().status).toBe('generating');
    expect(saveDraft).not.toHaveBeenCalled();

    resolveGenerate(await createGenerationDraft(generate.mock.calls[0][0]));
    await generation;
  });

  it('does not queue follow-ups when there is no active generation request', async () => {
    const { controller, queueFollowup } = setup();

    await expect(controller.queueFollowup('Make it blue.')).resolves.toBeNull();

    expect(queueFollowup).not.toHaveBeenCalled();
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
    await controller.open(PROJECT_ID);

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
      existing_project_id: PROJECT_ID,
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
    await controller.open(PROJECT_ID);

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
    await controller.open(PROJECT_ID);

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
    await controller.open(PROJECT_ID);

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
    await controller.open(PROJECT_ID);

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
    await controller.open(PROJECT_ID);
    await controller.generate('Make a timer.');
    const result = await controller.save();

    expect(saveDraft).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(loadCurrent).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(result.status).toBe('ready');
    expect(result.draft).toBeNull();
    expect(result.savedProject?.target.revision_number).toBe(1);
  });

  it('keeps an unsaved draft visible when the Save outcome cannot be verified', async () => {
    const readWire = await createReadWire();
    let initialOpen = true;
    const { controller } = setup({
      saveDraft: async () => {
        throw new Error('private disk detail');
      },
      open: async (request) => {
        if (request.project_id === PROJECT_ID && initialOpen) {
          initialOpen = false;
          return readWire;
        }
        if (request.project_id !== null) throw new Error('not found');
        return {
          result_version: 'builder-project-selection-result.v1',
          operation: 'new_selected',
          project_id: null,
        };
      },
    });
    await controller.open(PROJECT_ID);
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
    await controller.open(PROJECT_ID);
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

  it('shows a distinct restoring state while recovering a pending draft without saving it', async () => {
    const readWire = await createReadWire();
    const restored = await createRestoredGenerationDraft(readWire.source_tree);
    let resolveRestore: (value: unknown) => void = () => {
      throw new Error('restore promise was not initialized');
    };
    const { controller, restoreDraft, saveDraft } = setup({
      open: async () => readWire,
      restoreDraft: async () => new Promise((resolve) => {
        resolveRestore = resolve;
      }),
    });
    await controller.open(PROJECT_ID);

    const restoring = controller.restoreDraft(DRAFT_ID);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'restoring',
      busy: true,
      savedProject: { target: { project_id: PROJECT_ID } },
      draft: null,
    });
    expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(saveDraft).not.toHaveBeenCalled();

    resolveRestore(restored);
    const result = await restoring;
    expect(result.status).toBe('draft_ready');
    expect(result.draft?.restart_restore).toBe('git_sqlite_verified');
    expect(saveDraft).not.toHaveBeenCalled();
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

  it('restores a historical revision as an unsaved draft against the current saved base', async () => {
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
    const restoredHostRequest = await createBuilderGenerationRequest('Restore an earlier saved version.', PROJECT_ID);
    const restoredDraft = {
      ...await createGenerationDraft(restoredHostRequest, historicalTree),
      base_revision_evidence: {
        evidence_version: 'builder-project-base-revision-evidence.v2' as const,
        project_id: PROJECT_ID,
        revision_receipt_digest: currentWire.product_revision_receipt.revision_receipt_digest,
        commit_oid: currentWire.product_revision_receipt.commit_oid,
        source_tree_digest: currentWire.source_tree.source_tree_digest,
        verification_admission: 'git_sqlite_read_authority_verified' as const,
      },
    };
    const { controller, restoreRevisionAsDraft, saveDraft } = setup({
      open: async () => currentWire,
      restoreRevisionAsDraft: async (request) => {
        expect(request).toEqual({
          project_id: PROJECT_ID,
          revision_receipt_digest: historicalWire.product_revision_receipt.revision_receipt_digest,
        });
        return restoredDraft;
      },
    });
    await controller.open(PROJECT_ID);
    await controller.inspectRevision(
      PROJECT_ID,
      historicalWire.product_revision_receipt.revision_receipt_digest,
    );

    const result = await controller.restoreRevisionAsDraft(
      PROJECT_ID,
      historicalWire.product_revision_receipt.revision_receipt_digest,
    );

    expect(restoreRevisionAsDraft).toHaveBeenCalledOnce();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.status).toBe('draft_ready');
    expect(result.savedProject?.target.revision_receipt_digest)
      .toBe(currentWire.product_revision_receipt.revision_receipt_digest);
    expect(result.inspectedRevision).toBeNull();
    expect(result.draft?.source_tree.source_tree_digest).toBe(historicalTree.source_tree_digest);
    expect(result.draft?.base_revision_evidence?.revision_receipt_digest)
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
    await controller.open(PROJECT_ID);
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
    await controller.open(PROJECT_ID);
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
    await controller.open(PROJECT_ID);
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
