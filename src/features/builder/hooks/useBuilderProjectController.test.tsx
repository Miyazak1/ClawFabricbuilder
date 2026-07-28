// @vitest-environment jsdom
import { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UseBuilderProjectControllerResult } from './useBuilderProjectController';
import { useBuilderProjectController } from './useBuilderProjectController';
import { createBuilderGenerationRequest } from '../application/builderGeneration';
import { BuilderGenerationDiagnosticError } from '../application/builderPorts';
import {
  CONVERSATION_ID,
  DRAFT_ID,
  PROJECT_ID,
  RUN_ID,
  TURN_ID,
  createGenerationAnswer,
  createGenerationDraft,
  createReadWire,
  createSaveResult,
} from '../../../test/builderV2Fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

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

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
  throw lastError;
}

async function renderHook(
  projectId?: string,
  strict = false,
  options: Readonly<{ deferGenerate?: boolean; failGenerate?: boolean }> = {},
) {
  const readWire = await createReadWire();
  let latest: UseBuilderProjectControllerResult | null = null;
  let draft = await createGenerationDraft();
  let resolveGenerate: (() => Promise<void>) | null = null;
  const submit = vi.fn(async (request) => {
    draft = await createGenerationDraft(request, readWire.source_tree);
    return draft;
  });
  const generate = vi.fn(async (request) => {
    if (options.failGenerate === true) {
      throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
    }
    if (options.deferGenerate === true) {
      return new Promise<unknown>((resolve) => {
        resolveGenerate = async () => {
          draft = await createGenerationDraft(request, readWire.source_tree);
          resolve(draft);
        };
      });
    }
    draft = await createGenerationDraft(request, readWire.source_tree);
    return draft;
  });
  const generateApprovedPlan = vi.fn(async () => {
    const request = await createBuilderGenerationRequest('Review the approved plan.', PROJECT_ID);
    draft = await createGenerationDraft(request, readWire.source_tree);
    return draft;
  });
  const proposePlan = vi.fn(async (request) => ({
    version: 'builder-generation-result.v2',
    result_kind: 'plan',
    request_id: request.request_digest,
    project_id: request.existing_project_id ?? PROJECT_ID,
    existing_project_id: request.existing_project_id,
    title: 'Project update plan',
    summary: 'Review the saved project before editing.',
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
  }));
  const retry = vi.fn(async (request) => {
    draft = await createGenerationDraft(request, readWire.source_tree);
    return draft;
  });
  const answer = vi.fn(async (request) => createGenerationAnswer(request));
  const restoreDraft = vi.fn(async () => draft);
  const rejectDraft = vi.fn(async (request: Readonly<{ draft_id: string }>) => ({
    result_version: 'builder-generation-draft-rejection-result.v1',
    draft_id: request.draft_id,
    project_id: PROJECT_ID,
    rejected: true,
    pending_draft_released: true,
    conversation_event_admission: 'sqlite_recorded',
  }));
  const cancel = vi.fn(async (request: Readonly<{ request_id: string }>) => ({
    request_id: request.request_id,
    cancelled: true,
  }));
  const saveDraft = vi.fn(async () => createSaveResult(draft, readWire));
  const loadCurrent = vi.fn(async () => readWire);
  const loadRevision = vi.fn(async () => ({ ...readWire, operation: 'revision_loaded' }));
  const open = vi.fn(async (request: { project_id: string | null }) => (
    request.project_id === null
      ? {
        result_version: 'builder-project-selection-result.v1',
        operation: 'new_selected',
        project_id: null,
      }
      : readWire
  ));
  const generator = {
    submit,
    generateApprovedPlan,
    proposePlan,
    preparePlanSourceReadApproval: async () => PLAN_SOURCE_READ_READY,
    approvePlanSourceRead: async () => PLAN_SOURCE_READ_APPROVED,
    generate,
    retry,
    answer,
    restoreDraft,
    rejectDraft,
    cancel,
    steer: async () => null,
  };
  const workspace = {
    open,
    createLocalProject: async () => ({
      result_version: 'builder-project-selection-result.v1',
      operation: 'new_selected',
      project_id: null,
    }),
    saveDraft,
    loadCurrent,
    loadRevision,
    listCurrent: async () => ({ projects: [] }),
    listHistory: async () => ({ revisions: [] }),
  };

  function Harness({ selectedProjectId }: { selectedProjectId?: string }) {
    const result = useBuilderProjectController({
      projectId: selectedProjectId,
      generator,
      workspace,
    });
    useEffect(() => {
      latest = result;
    }, [result]);
    return null;
  }

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(strict
      ? <StrictMode><Harness selectedProjectId={projectId} /></StrictMode>
      : <Harness selectedProjectId={projectId} />);
  });
  return {
    current: () => latest as UseBuilderProjectControllerResult,
    answer,
    cancel,
    generate,
    generateApprovedPlan,
    proposePlan,
    submit,
    retry,
    loadCurrent,
    open,
    rejectDraft,
    restoreDraft,
    async resolveGenerate() {
      await resolveGenerate?.();
    },
    async selectProject(selectedProjectId?: string) {
      await act(async () => {
        root.render(<Harness selectedProjectId={selectedProjectId} />);
      });
    },
    saveDraft,
  };
}

describe('useBuilderProjectController', () => {
  it('survives the StrictMode setup-cleanup-setup lifecycle replay', async () => {
    const hook = await renderHook(PROJECT_ID, true);
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });
    expect(hook.current().snapshot.savedProject?.target.project_id).toBe(PROJECT_ID);
  });

  it('opens a selected durable project', async () => {
    const hook = await renderHook(PROJECT_ID);
    expect(hook.open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(hook.loadCurrent).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });
    expect(hook.current().snapshot).toMatchObject({
      status: 'ready',
      draft: null,
    });
  });

  it('keeps generation unsaved until the explicit save command', async () => {
    const hook = await renderHook(PROJECT_ID);
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });
    await act(async () => {
      await hook.current().generate('Make a timer.');
    });
    expect(hook.current().snapshot).toMatchObject({
      status: 'draft_ready',
      draft: { draft_id: DRAFT_ID },
    });
    expect(hook.saveDraft).not.toHaveBeenCalled();

    await act(async () => {
      await hook.current().save();
    });
    expect(hook.saveDraft).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(hook.current().snapshot).toMatchObject({
      status: 'ready',
      draft: null,
      savedProject: {
        target: { project_id: PROJECT_ID, revision_number: 1 },
      },
    });
  });

  it('exposes one submit command for the composer without saving', async () => {
    const hook = await renderHook(PROJECT_ID);
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });
    await act(async () => {
      await hook.current().submit('Make a timer.');
    });

    expect(hook.submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      instruction: 'Make a timer.',
      existing_project_id: PROJECT_ID,
    }));
    expect(hook.generate).not.toHaveBeenCalled();
    expect(hook.saveDraft).not.toHaveBeenCalled();
    expect(hook.current().snapshot).toMatchObject({
      status: 'draft_ready',
      draft: { draft_id: DRAFT_ID },
    });
  });

  it('continues an approved plan into an unsaved draft without saving', async () => {
    const hook = await renderHook(PROJECT_ID);
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });

    await act(async () => {
      await hook.current().generateApprovedPlan({
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        turn_id: TURN_ID,
        run_id: RUN_ID,
      });
    });

    expect(hook.generateApprovedPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
    });
    expect(hook.saveDraft).not.toHaveBeenCalled();
    expect(hook.current().snapshot).toMatchObject({
      status: 'draft_ready',
      draft: { draft_id: DRAFT_ID },
    });
  });

  it('exposes plan proposal without creating a draft or save', async () => {
    const hook = await renderHook(PROJECT_ID);
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });

    await act(async () => {
      await hook.current().proposePlan('Plan the next saved-project change.');
    });

    expect(hook.proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      instruction: 'Plan the next saved-project change.',
      existing_project_id: PROJECT_ID,
    }));
    expect(hook.saveDraft).not.toHaveBeenCalled();
    expect(hook.current().snapshot).toMatchObject({
      status: 'ready',
      draft: null,
      savedProject: { target: { project_id: PROJECT_ID } },
    });
  });

  it('exposes draft discard without saving', async () => {
    const hook = await renderHook(PROJECT_ID);
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });
    await act(async () => {
      await hook.current().generate('Make a timer.');
      await hook.current().rejectDraft();
    });

    expect(hook.rejectDraft).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(hook.saveDraft).not.toHaveBeenCalled();
    expect(hook.current().snapshot).toMatchObject({
      status: 'ready',
      draft: null,
      savedProject: { target: { project_id: PROJECT_ID } },
    });
  });

  it('answers through the controller without creating a draft or saving', async () => {
    const hook = await renderHook();
    await act(async () => {
      await hook.current().answer('What does this project do?');
    });

    expect(hook.answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      instruction: 'What does this project do?',
      existing_project_id: null,
    }));
    expect(hook.saveDraft).not.toHaveBeenCalled();
    expect(hook.current().snapshot).toMatchObject({
      status: 'new',
      draft: null,
      savedProject: null,
      answer: {
        result_kind: 'explanation',
        project_id: PROJECT_ID,
      },
    });
  });

  it('exposes retry generation without creating a save', async () => {
    const hook = await renderHook(PROJECT_ID, false, { failGenerate: true });
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });
    await act(async () => {
      await hook.current().generate('Make a timer.');
    });
    expect(hook.current().snapshot).toMatchObject({
      status: 'generation_failed',
      retryableGeneration: true,
    });

    await act(async () => {
      await hook.current().retryGenerate();
    });

    expect(hook.generate).toHaveBeenCalledOnce();
    expect(hook.retry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      instruction: 'Make a timer.',
      existing_project_id: PROJECT_ID,
    }));
    expect(hook.saveDraft).not.toHaveBeenCalled();
    expect(hook.current().snapshot).toMatchObject({
      status: 'draft_ready',
      retryableGeneration: false,
      draft: { draft_id: DRAFT_ID },
    });
  });

  it('exposes cancellation for the active generation request only', async () => {
    const hook = await renderHook(PROJECT_ID, false, { deferGenerate: true });
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });
    let generation!: Promise<unknown>;
    await act(async () => {
      generation = hook.current().generate('Make a timer.');
    });
    await waitFor(() => {
      expect(hook.generate).toHaveBeenCalledOnce();
    });
    await act(async () => {
      await hook.current().cancel();
    });

    expect(hook.cancel).toHaveBeenCalledExactlyOnceWith({
      request_id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    expect(hook.cancel.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(hook.current().snapshot).toMatchObject({
      status: 'ready',
      draft: null,
      savedProject: { target: { project_id: PROJECT_ID } },
    });
    await act(async () => {
      await hook.resolveGenerate();
      await generation;
    });
    expect(hook.current().snapshot.draft).toBeNull();
  });

  it('keeps a new project read-only for build until a project is selected', async () => {
    const hook = await renderHook();
    await act(async () => {
      await hook.current().generate('Make a timer.');
    });
    expect(hook.generate).not.toHaveBeenCalled();
    expect(hook.saveDraft).not.toHaveBeenCalled();
    expect(hook.current().snapshot).toMatchObject({
      status: 'generation_failed',
      error: 'builder_generation_project_workspace_required',
      draft: null,
      savedProject: null,
    });

    await hook.selectProject(PROJECT_ID);
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });
    expect(hook.open).toHaveBeenCalledWith({ project_id: null });
    expect(hook.open).toHaveBeenLastCalledWith({ project_id: PROJECT_ID });

    await act(async () => {
      await hook.current().generate('Add a pause button.');
    });
    expect(hook.generate).toHaveBeenCalledTimes(1);
    expect(hook.current().snapshot).toMatchObject({
      status: 'draft_ready',
      savedProject: { target: { project_id: PROJECT_ID } },
    });
  });
});
