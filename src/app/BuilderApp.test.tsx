// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BuilderApp } from './BuilderApp';
import {
  BUILDER_DESKTOP_BRIDGE_VERSION,
  type BuilderDesktopBridgeRoot,
} from './builderDesktopBridgeRoot';
import {
  PROJECT_ID,
  createAcceptedTaskStreamWire,
  createAnswerTaskStreamWire,
  createCatalogWire,
  createGenerationAnswer,
  createGenerationDraft,
  createHistoryWire,
  createPlanTaskStreamWire,
  createPlanReviewTaskStreamWire,
  createReadWire,
  createRejectedTaskStreamWire,
  createRestoredGenerationDraft,
  createSaveResult,
  createSourceTree,
  createTaskStreamWire,
  digest,
} from '../test/builderV2Fixtures';
import { createBuilderGenerationRequest } from '../features/builder/application/builderGeneration';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
const PENDING_TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174001';
const PENDING_TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174001';
const PENDING_RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174001';

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
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

async function setup(options: Readonly<{
  answerActivity?: boolean;
  deferredGenerate?: boolean;
  failGenerate?: boolean;
  initiallySaved?: boolean;
  pendingActivity?: boolean;
  pendingPlanActivity?: boolean;
  pendingAfterRevisionView?: boolean;
  acceptedPendingActivity?: boolean;
  rejectActivityAfterDiscard?: boolean;
  rejectedPendingActivity?: boolean;
  restoreAvailable?: boolean;
  validHistoryPreview?: boolean;
}> = {}) {
  const historicalWire = options.validHistoryPreview === true
    ? await createReadWire(await createSourceTree([
      { path: 'index.html', content: '<main>Earlier</main>\n' },
    ]))
    : null;
  const readWire = options.validHistoryPreview === true && historicalWire !== null
    ? await readWireAsRevision(
      await createReadWire(await createSourceTree([
        { path: 'index.html', content: '<main>Current</main>\n' },
      ])),
      2,
      historicalWire.product_revision_receipt.revision_receipt_digest,
    )
    : await createReadWire();
  const catalogWire = await createCatalogWire();
  let saved = options.initiallySaved === true;
  let selectedProjectId: string | null = null;
  let latestDraft = await createGenerationDraft();
  let restoredDraft = await createRestoredDraftForReadWire(readWire);
  let resolveGenerate: (() => Promise<void>) | null = null;
  const generate = vi.fn(async (request: unknown) => {
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await createBuilderGenerationRequest(instruction, selectedProjectId);
    if (options.failGenerate === true) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_provider_http_error',
          retryable: true,
        },
      };
    }
    if (options.deferredGenerate === true) {
      return new Promise<unknown>((resolve) => {
        resolveGenerate = async () => {
          latestDraft = await createGenerationDraft(hostRequest, readWire.source_tree);
          resolve({
            version: 'builder-generation-ipc-result.v1',
            ok: true,
            result: latestDraft,
          });
        };
      });
    }
    latestDraft = await createGenerationDraft(hostRequest, readWire.source_tree);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const retry = vi.fn(async (request: unknown) => {
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await createBuilderGenerationRequest(instruction, selectedProjectId);
    latestDraft = await createGenerationDraft(hostRequest, readWire.source_tree);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const answer = vi.fn(async (request: unknown) => {
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await createBuilderGenerationRequest(instruction, selectedProjectId);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: await createGenerationAnswer(hostRequest),
    };
  });
  const saveDraft = vi.fn(async (request: unknown) => {
    expect(request).toEqual({ draft_id: latestDraft.draft_id });
    saved = true;
    return createSaveResult(latestDraft, readWire);
  });
  const restoreDraft = vi.fn(async (request: unknown) => {
    if (options.restoreAvailable !== true) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_parent_unavailable',
          retryable: true,
        },
      };
    }
    restoredDraft = await createRestoredDraftForReadWire(readWire);
    expect(request).toEqual({ draft_id: restoredDraft.draft_id });
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: restoredDraft,
    };
  });
  const rejectDraft = vi.fn(async (request: unknown) => {
    expect(request).toEqual({ draft_id: latestDraft.draft_id });
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-generation-draft-rejection-result.v1',
        draft_id: latestDraft.draft_id,
        project_id: PROJECT_ID,
        rejected: true,
        pending_draft_released: true,
        conversation_event_admission: 'sqlite_recorded',
      },
    };
  });
  const cancel = vi.fn(async (request: unknown) => ({
    request_id: (request as { request_id: string }).request_id,
    cancelled: true,
  }));
  const reviewPlan = vi.fn(async (request: unknown) => ({
    result_version: 'builder-conversation-plan-review-result.v1',
    ...(request as object),
    review_admission: 'sqlite_recorded_no_execution',
  }));
  const loadCurrent = vi.fn(async () => readWire);
  let loadRevisionCalls = 0;
  const readTaskStream = vi.fn(async () => (
    options.pendingPlanActivity === true && reviewPlan.mock.calls.length > 0
      ? createPlanReviewTaskStreamWire('approved')
    : options.pendingPlanActivity === true
      ? createPlanTaskStreamWire()
    : options.rejectActivityAfterDiscard === true && rejectDraft.mock.calls.length > 0
      ? createRejectedTaskStreamWire()
      : options.answerActivity === true
      ? createAnswerTaskStreamWire()
    : options.acceptedPendingActivity === true
      ? pendingCandidateTaskStreamWire('accepted')
    : options.rejectedPendingActivity === true
      ? pendingCandidateTaskStreamWire('rejected')
    : options.pendingAfterRevisionView === true && loadRevisionCalls > 0
        ? pendingCandidateTaskStreamWire('proposed')
        : options.pendingActivity === true
          ? pendingCandidateTaskStreamWire('proposed')
        : createTaskStreamWire()
  ));
  const open = vi.fn(async (request: { project_id: string | null }) => {
    selectedProjectId = request.project_id;
    return request.project_id === null
      ? {
        result_version: 'builder-project-selection-result.v1',
        operation: 'new_selected',
        project_id: null,
      }
      : readWire;
  });
  const listCurrent = vi.fn(async () => (
    saved ? catalogWire : { ...catalogWire, projects: [] }
  ));
  const listHistory = vi.fn(async (request: unknown) => (
    options.validHistoryPreview === true && historicalWire !== null
      ? createValidHistoryWire((request as { project_id: string }).project_id, readWire, historicalWire)
      : createHistoryWire((request as { project_id: string }).project_id, 1)
  ));
  const loadRevision = vi.fn(async (request: unknown) => {
    loadRevisionCalls += 1;
    if (options.validHistoryPreview === true && historicalWire !== null) {
      const revisionReceiptDigest = (request as { revision_receipt_digest: string }).revision_receipt_digest;
      if (revisionReceiptDigest === historicalWire.product_revision_receipt.revision_receipt_digest) {
        return {
          ...historicalWire,
          operation: 'revision_loaded',
          current: readWire.current,
        };
      }
    }
    return {
      ...readWire,
      operation: 'revision_loaded',
      current: readWire.current,
    };
  });
  const bridge: BuilderDesktopBridgeRoot = {
    bridgeVersion: BUILDER_DESKTOP_BRIDGE_VERSION,
    codeGenerator: {
      generate,
      retry,
      answer,
      restoreDraft,
      rejectDraft,
      cancel,
      availability: async () => null,
    },
    projectWorkspace: {
      open,
      saveDraft,
      loadCurrent,
      loadRevision,
      listCurrent,
      listHistory,
    },
    providerSettings: {},
    permissions: {},
    planReview: {
      review: reviewPlan,
    },
    taskStream: {
      read: readTaskStream,
    },
    windowControls: {
      close: async () => ({ result_version: 'builder-window-control-result.v1', ok: true }),
      minimize: async () => ({ result_version: 'builder-window-control-result.v1', ok: true }),
      readState: async () => ({ state_version: 'builder-window-state.v1', maximized: false }),
      toggleMaximize: async () => ({
        result_version: 'builder-window-control-result.v1',
        ok: true,
      }),
    },
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(<BuilderApp bridgeRoot={bridge} />);
  });
  return {
    container,
    answer,
    cancel,
    generate,
    retry,
    listHistory,
    loadRevision,
    listCurrent,
    loadCurrent,
    open,
    readTaskStream,
    reviewPlan,
    rejectDraft,
    restoreDraft,
    async resolveGenerate() {
      await resolveGenerate?.();
    },
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

function historyRevision(wire: ReadWire, isCurrent: boolean, parentOid: string | null = wire.product_revision_receipt.parent_oid) {
  return {
    project_id: wire.product_revision_receipt.project_id,
    title: wire.product_revision_receipt.title,
    summary: wire.product_revision_receipt.summary,
    revision_number: wire.product_revision_receipt.revision_number,
    revision_receipt_digest: wire.product_revision_receipt.revision_receipt_digest,
    previous_revision_receipt_digest: wire.product_revision_receipt.previous_revision_receipt_digest,
    commit_oid: wire.product_revision_receipt.commit_oid,
    tree_oid: wire.product_revision_receipt.tree_oid,
    parent_oid: parentOid,
    selected_at_ms: wire.product_revision_receipt.selected_at_ms,
    is_current: isCurrent,
  };
}

function createValidHistoryWire(projectId: string, currentWire: ReadWire, historicalWire: ReadWire) {
  const currentParentOid = historicalWire.product_revision_receipt.commit_oid;
  return {
    result_version: 'builder-project-read-result.v1',
    operation: 'history_listed',
    project_id: projectId,
    current: {
      ...currentWire.current,
      parent_oid: currentParentOid,
    },
    revisions: [
      historyRevision(currentWire, true, currentParentOid),
      historyRevision(historicalWire, false),
    ],
    authority_evidence: {
      product_authority: 'sqlite_product_revision_receipt',
      code_authority: 'git_commit_tree',
      source_read_admission: 'verified',
      current_selection: 'sqlite_current_project_revision',
      history_selection: 'sqlite_project_revision_receipts',
    },
  };
}

function click(container: HTMLElement, label: string): void {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.includes(label));
  expect(button, label).not.toBeUndefined();
  act(() => button?.click());
}

async function createRestoredDraftForReadWire(
  readWire: Awaited<ReturnType<typeof createReadWire>>,
) {
  const draft = await createRestoredGenerationDraft(readWire.source_tree);
  if (draft.base_revision_evidence === null) return draft;
  return {
    ...draft,
    base_revision_evidence: {
      ...draft.base_revision_evidence,
      project_id: readWire.product_revision_receipt.project_id,
      revision_receipt_digest: readWire.product_revision_receipt.revision_receipt_digest,
      commit_oid: readWire.product_revision_receipt.commit_oid,
      source_tree_digest: readWire.source_tree.source_tree_digest,
    },
  };
}

function pendingCandidateTaskStreamWire(state: 'accepted' | 'proposed' | 'rejected') {
  const wire = state === 'accepted'
    ? createAcceptedTaskStreamWire(1)
    : state === 'rejected'
      ? createRejectedTaskStreamWire()
      : createTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      items: wire.conversation.items.map((item) => {
        if (item.item_kind === 'user_message') {
          return {
            ...item,
            turn_id: PENDING_TURN_ID,
            task: 'task' in item && item.task !== null
              ? { ...item.task, task_id: PENDING_TASK_ID }
              : null,
          };
        }
        if (item.item_kind === 'run_started') {
          return {
            ...item,
            turn_id: PENDING_TURN_ID,
            run_id: PENDING_RUN_ID,
            task_id: PENDING_TASK_ID,
          };
        }
        if (item.item_kind === 'run_completed') {
          return {
            ...item,
            turn_id: PENDING_TURN_ID,
            run_id: PENDING_RUN_ID,
          };
        }
        return {
          ...item,
          turn_id: PENDING_TURN_ID,
          run_id: PENDING_RUN_ID,
        };
      }),
    },
  };
}

describe('BuilderApp v2', () => {
  it('renders one integrated desktop workbench with Projects and Settings only', async () => {
    const { container } = await setup();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('[data-builder-workbench="true"]')).not.toBeNull();
    expect(container.textContent).toContain('Projects');
    expect(container.textContent).toContain('Settings');
    expect(container.textContent).not.toContain('Canvas');
    expect(container.textContent).not.toContain('Chat');
  });

  it('generates an unsaved draft without touching the workspace save authority', async () => {
    const { container, generate, listCurrent, saveDraft } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        setter?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, 'Make draft');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(listCurrent.mock.results.at(-1)?.value).toBeInstanceOf(Promise);
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
  });

  it('retries a failed draft through the retry bridge and refreshes activity', async () => {
    const { container, generate, readTaskStream, retry, saveDraft } = await setup({
      failGenerate: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, 'Make draft');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-retry-draft="true"]')).not.toBeNull();
    });
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a different timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, 'Retry');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(generate).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
    expect(retry).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(container.textContent).not.toMatch(/request_digest|existing_project_id|provider|credential/iu);
  });

  it('cancels active draft generation through request-id-only control', async () => {
    const { cancel, container, generate, resolveGenerate, saveDraft } = await setup({
      deferredGenerate: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, 'Make draft');

    await waitFor(() => {
      expect(generate).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    });
    const expected = await createBuilderGenerationRequest('Make a timer.', null);
    click(container, 'Stop');

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledExactlyOnceWith({ request_id: expected.request_digest });
      expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    });
    expect(cancel.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(cancel.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(saveDraft).not.toHaveBeenCalled();

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('loads the visible project activity through the read-only task stream bridge', async () => {
    const { container, readTaskStream } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, 'Make draft');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.textContent)
        .toContain('I prepared a draft for review.');
    });
    expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(container.textContent).not.toContain('builder-generation-draft:');
    expect(container.textContent).not.toContain('sqlite');
  });

  it('records plan approval through the plan-review bridge and only refreshes activity', async () => {
    const {
      container,
      generate,
      readTaskStream,
      reviewPlan,
      saveDraft,
    } = await setup({ initiallySaved: true, pendingPlanActivity: true });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();
    click(container, 'Approve plan');

    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-activity-card="Plan approved"]')?.textContent)
        .toContain('The plan was approved. The project has not changed yet.');
    });
    expect(reviewPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
      decision: 'approved',
    });
    expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('discards an unsaved draft through draft-id-only control and refreshes activity', async () => {
    const {
      cancel,
      container,
      loadCurrent,
      readTaskStream,
      rejectDraft,
      restoreDraft,
      saveDraft,
    } = await setup({ rejectActivityAfterDiscard: true });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, 'Make draft');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-discard-draft="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();
    click(container, 'Discard draft');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-activity-card="Draft rejected"]')?.textContent)
        .toContain('The draft was discarded and is no longer available for review.');
    });
    expect(rejectDraft).toHaveBeenCalledExactlyOnceWith({
      draft_id: expect.stringMatching(/^builder-generation-draft:/u),
    });
    expect(rejectDraft.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(rejectDraft.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(saveDraft).not.toHaveBeenCalled();
    expect(loadCurrent).not.toHaveBeenCalled();
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(container.textContent).not.toMatch(/builder-generation-draft:|sha256:|provider|credential/iu);
  });

  it('asks a question through the answer bridge without draft, save, or revision UI', async () => {
    const { answer, container, generate, readTaskStream, saveDraft } = await setup({
      answerActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'What does this project do?');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, 'Ask');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Assistant"]')?.textContent)
        .toContain('This answer does not change files.');
    });

    expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: 'What does this project do?' });
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.textContent).not.toContain('builder-generation-draft:');
    expect(container.textContent).not.toContain('request_id');
  });

  it('restores a pending draft from project activity after opening a saved project', async () => {
    const { container, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      pendingActivity: true,
      restoreAvailable: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });

    expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({
      draft_id: expect.stringMatching(/^builder-generation-draft:/u),
    });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
    expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
  });

  it('does not restore a pending draft after project activity records rejection', async () => {
    const { container, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      rejectedPendingActivity: true,
      restoreAvailable: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Draft rejected"]')?.textContent)
        .toContain('The draft was discarded and is no longer available for review.');
    });

    expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
  });

  it('does not restore a pending draft after project activity records acceptance', async () => {
    const { container, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      acceptedPendingActivity: true,
      restoreAvailable: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Version saved"]')?.textContent)
        .toContain('This draft was saved as Version 1.');
    });

    expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
  });

  it('does not consume pending draft restore while viewing saved history', async () => {
    const { container, readTaskStream, restoreDraft } = await setup({
      initiallySaved: true,
      pendingAfterRevisionView: true,
      restoreAvailable: true,
      validHistoryPreview: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-view-version="Version 1"]')).not.toBeNull();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-builder-view-version="Version 1"]')?.click();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-history-preview="true"]')?.textContent)
        .toContain('Viewing Version 1');
    });
    readTaskStream.mockClear();
    const refreshActivity = container.querySelector<HTMLButtonElement>(
      '[data-builder-activity="true"] button[aria-label="Refresh activity"]',
    );
    expect(refreshActivity).not.toBeNull();
    expect(refreshActivity?.disabled).toBe(false);
    act(() => {
      refreshActivity?.click();
    });
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')).not.toBeNull();
    });
    expect(restoreDraft).not.toHaveBeenCalled();

    click(container, 'Back to current');
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
      });
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
  });

  it('saves only after the explicit command, then shows the verified Git/SQLite version', async () => {
    const {
      container,
      listHistory,
      loadCurrent,
      readTaskStream,
      restoreDraft,
      saveDraft,
    } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, 'Make draft');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();
    click(container, 'Save version');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
        .toContain('Version 1');
    });

    expect(saveDraft).toHaveBeenCalledOnce();
    expect(saveDraft.mock.calls[0][0]).toEqual({
      draft_id: expect.stringMatching(/^builder-generation-draft:/u),
    });
    expect(loadCurrent).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(listHistory).toHaveBeenCalledWith({
      project_id: PROJECT_ID,
      limit: 128,
    });
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-version-card="Version 1"]')?.textContent)
        .toContain('Current');
    });
    expect(container.textContent).not.toMatch(/sha256:|commit_oid|tree_oid|parent_oid|credential|provider/iu);
  });

  it('keeps project instruction state when visiting Settings and returning', async () => {
    const { container } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Keep this instruction.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, 'Settings');
    expect(container.textContent).toContain('AI provider settings');
    click(container, 'Back to project');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value)
      .toBe('Keep this instruction.');
  });
});
