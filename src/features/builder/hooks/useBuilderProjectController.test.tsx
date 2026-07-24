// @vitest-environment jsdom
import { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UseBuilderProjectControllerResult } from './useBuilderProjectController';
import { useBuilderProjectController } from './useBuilderProjectController';
import {
  DRAFT_ID,
  PROJECT_ID,
  createGenerationDraft,
  createReadWire,
  createSaveResult,
} from '../../../test/builderV2Fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

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

async function renderHook(projectId?: string, strict = false) {
  const readWire = await createReadWire();
  let latest: UseBuilderProjectControllerResult | null = null;
  let draft = await createGenerationDraft();
  const generate = vi.fn(async (request) => {
    draft = await createGenerationDraft(request, readWire.source_tree);
    return draft;
  });
  const answer = vi.fn(async () => null);
  const restoreDraft = vi.fn(async () => draft);
  const saveDraft = vi.fn(async () => createSaveResult(draft, readWire));
  const loadCurrent = vi.fn(async () => readWire);
  const open = vi.fn(async (request: { project_id: string | null }) => (
    request.project_id === null
      ? {
        result_version: 'builder-project-selection-result.v1',
        operation: 'new_selected',
        project_id: null,
      }
      : readWire
  ));
  const generator = { generate, answer, restoreDraft };
  const workspace = {
    open,
    saveDraft,
    loadCurrent,
    listCurrent: async () => ({ projects: [] }),
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
    generate,
    loadCurrent,
    open,
    restoreDraft,
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
    const hook = await renderHook();
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

  it('keeps the controller alive when the first save selects its durable project', async () => {
    const hook = await renderHook();
    await act(async () => {
      await hook.current().generate('Make a timer.');
      await hook.current().save();
    });
    await hook.selectProject(PROJECT_ID);
    await waitFor(() => {
      expect(hook.current().snapshot.status).toBe('ready');
    });
    expect(hook.open).toHaveBeenCalledTimes(1);
    expect(hook.open).toHaveBeenLastCalledWith({ project_id: null });

    await act(async () => {
      await hook.current().generate('Add a pause button.');
    });
    expect(hook.generate).toHaveBeenCalledTimes(2);
    expect(hook.current().snapshot).toMatchObject({
      status: 'draft_ready',
      savedProject: { target: { project_id: PROJECT_ID } },
    });
  });
});
