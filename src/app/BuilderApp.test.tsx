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
  createAnswerTaskStreamWire,
  createCatalogWire,
  createGenerationAnswer,
  createGenerationDraft,
  createHistoryWire,
  createReadWire,
  createRestoredGenerationDraft,
  createSaveResult,
  createTaskStreamWire,
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
  initiallySaved?: boolean;
  pendingActivity?: boolean;
  restoreAvailable?: boolean;
}> = {}) {
  const readWire = await createReadWire();
  const catalogWire = await createCatalogWire();
  let saved = options.initiallySaved === true;
  let selectedProjectId: string | null = null;
  let latestDraft = await createGenerationDraft();
  let restoredDraft = await createRestoredGenerationDraft(readWire.source_tree);
  let resolveGenerate: (() => Promise<void>) | null = null;
  const generate = vi.fn(async (request: unknown) => {
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await createBuilderGenerationRequest(instruction, selectedProjectId);
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
    restoredDraft = await createRestoredGenerationDraft(readWire.source_tree);
    expect(request).toEqual({ draft_id: restoredDraft.draft_id });
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: restoredDraft,
    };
  });
  const cancel = vi.fn(async (request: unknown) => ({
    request_id: (request as { request_id: string }).request_id,
    cancelled: true,
  }));
  const loadCurrent = vi.fn(async () => readWire);
  const readTaskStream = vi.fn(async () => (
    options.answerActivity === true
      ? createAnswerTaskStreamWire()
      : options.pendingActivity === true
        ? pendingCandidateTaskStreamWire()
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
    createHistoryWire((request as { project_id: string }).project_id, 1)
  ));
  const bridge: BuilderDesktopBridgeRoot = {
    bridgeVersion: BUILDER_DESKTOP_BRIDGE_VERSION,
    codeGenerator: {
      generate,
      answer,
      restoreDraft,
      cancel,
      availability: async () => null,
    },
    projectWorkspace: {
      open,
      saveDraft,
      loadCurrent,
      listCurrent,
      listHistory,
    },
    providerSettings: {},
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
    listHistory,
    listCurrent,
    loadCurrent,
    open,
    readTaskStream,
    restoreDraft,
    async resolveGenerate() {
      await resolveGenerate?.();
    },
    saveDraft,
  };
}

function click(container: HTMLElement, label: string): void {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.includes(label));
  expect(button, label).not.toBeUndefined();
  act(() => button?.click());
}

function pendingCandidateTaskStreamWire() {
  const wire = createTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      items: wire.conversation.items.map((item) => {
        if (item.item_kind === 'user_message') {
          return {
            ...item,
            turn_id: PENDING_TURN_ID,
            task: item.task === null ? null : { ...item.task, task_id: PENDING_TASK_ID },
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
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
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
