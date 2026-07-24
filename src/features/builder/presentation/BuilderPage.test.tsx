// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBuilderProjectController } from '../application/builderProjectController';
import { BuilderPage } from './BuilderPage';
import {
  DRAFT_ID,
  PROJECT_ID,
  createGenerationDraft,
  createReadWire,
  createSaveResult,
} from '../../../test/builderV2Fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function render(element: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  act(() => root.render(element));
  return container;
}

async function snapshots() {
  const readWire = await createReadWire();
  let draft = await createGenerationDraft();
  const controller = createBuilderProjectController({
    generator: {
      async generate(request) {
        draft = await createGenerationDraft(request, readWire.source_tree);
        return draft;
      },
    },
    workspace: {
      async open(request) {
        return request.project_id === null
          ? {
            result_version: 'builder-project-selection-result.v1',
            operation: 'new_selected',
            project_id: null,
          }
          : readWire;
      },
      async saveDraft() {
        return createSaveResult(draft, readWire);
      },
      async loadCurrent() {
        return readWire;
      },
      async listCurrent() {
        return { projects: [] };
      },
    },
  });
  const fresh = controller.getSnapshot();
  const saved = await controller.open(PROJECT_ID);
  const draftReady = await controller.generate('Add a timer.');
  return { draftReady, fresh, saved };
}

function click(container: HTMLElement, selector: string): void {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  act(() => button?.click());
}

describe('BuilderPage v2', () => {
  it('renders a continuous composer without pretending a new project is saved', async () => {
    const { fresh } = await snapshots();
    const onGenerate = vi.fn();
    const onInstructionChange = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onGenerate={onGenerate}
        onInstructionChange={onInstructionChange}
        snapshot={fresh}
      />,
    );

    expect(container.querySelector('[data-builder-composer="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-page="true"]')?.getAttribute('data-builder-project-status'))
      .toBe('new');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.textContent).toContain('Your preview will appear here.');
    click(container, 'button.cf-builder-command-button');
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it('shows an unsaved draft and requires the explicit Save version command', async () => {
    const { draftReady } = await snapshots();
    const onSave = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Add a timer."
        onSave={onSave}
        snapshot={draftReady}
      />,
    );

    expect(container.querySelector('[data-builder-unsaved-draft="true"]')?.textContent)
      .toContain('Unsaved draft');
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.textContent).toContain('Save this draft before asking for another change');
    click(container, '[data-builder-save-version="true"]');
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('shows Git/SQLite revision number only for a verified saved snapshot', async () => {
    const { saved } = await snapshots();
    const container = render(
      <BuilderPage activeFile={null} instruction="" snapshot={saved} />,
    );
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
  });

  it('lists arbitrary source-tree paths and reveals their code without assuming three web files', async () => {
    const { draftReady } = await snapshots();
    const onSelectFile = vi.fn();
    const container = render(
      <BuilderPage
        activeFile="src/tool.py"
        instruction=""
        onSelectFile={onSelectFile}
        snapshot={draftReady}
      />,
    );
    click(container, '#builder-tool-tab-code');
    expect(container.textContent).toContain('src/tool.py');
    expect(container.querySelector('#builder-code-panel code')?.textContent)
      .toContain('print("hello")');
    expect(container.textContent).not.toContain('app.js');
  });

  it('keeps the provider-settings recovery action limited to configuration failures', async () => {
    const { fresh } = await snapshots();
    const controller = createBuilderProjectController({
      generator: { generate: async () => {
        const error = Object.assign(new Error(), {
          code: 'builder_generation_provider_unavailable',
        });
        throw error;
      } },
      workspace: {
        open: async () => null,
        saveDraft: async () => null,
        loadCurrent: async () => null,
        listCurrent: async () => null,
      },
    });
    void fresh;
    const failed = await controller.generate('Make a timer.');
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onOpenSettings={vi.fn()}
        snapshot={failed}
      />,
    );
    expect(container.textContent).not.toContain('Check AI settings');
    expect(JSON.stringify(failed)).not.toContain(DRAFT_ID);
  });

  it('labels an unknown Save outcome without claiming the draft is lost', async () => {
    const controller = createBuilderProjectController({
      generator: { generate: async (request) => createGenerationDraft(request) },
      workspace: {
        open: async () => null,
        saveDraft: async () => {
          throw new Error('response lost');
        },
        loadCurrent: async () => {
          throw new Error('unavailable');
        },
        listCurrent: async () => ({ projects: [] }),
      },
    });
    await controller.generate('Make a timer.');
    const unknown = await controller.save();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        onSave={vi.fn()}
        snapshot={unknown}
      />,
    );
    expect(container.textContent).toContain('The save result could not be confirmed.');
    expect(container.textContent).toContain('Try Save again');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
  });
});
