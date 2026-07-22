// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBuilderProjectCatalogController,
  type BuilderProjectCatalogSnapshot,
} from '../application/builderProjectCatalogController';
import { BuilderProjectCatalog } from './BuilderProjectCatalog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function result(projects: unknown[] = [{
  project_id: PROJECT_ID,
  title: 'Tiny timer',
  summary: 'A small focus timer.',
  revision: 2,
  revision_digest: `sha256:${'a'.repeat(64)}`,
}]) {
  return {
    result_version: 'builder-project-catalog-result.v1',
    projects,
    catalog_evidence: {
      source_authority: 'verified_project_head_and_revision_chain',
      ordering: 'project_id_ascending',
      recency: 'not_available',
      global_atomic_snapshot: 'not_proven',
      headless_orphans: 'excluded',
      write_activity: 'none',
      resource_bounds: { max_project_directories: 256, max_file_reads: 1024, max_bytes: 33554432 },
    },
  };
}

async function snapshot(raw = result()): Promise<BuilderProjectCatalogSnapshot> {
  return createBuilderProjectCatalogController({ listCurrent: async () => raw }).load();
}

function render(element: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => root.render(element));
  return container;
}

function button(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.includes(text));
}

afterEach(() => {
  for (const item of mounted.splice(0)) {
    act(() => item.root.unmount());
    item.container.remove();
  }
});

describe('BuilderProjectCatalog', () => {
  it('renders verified project summaries without exposing digests or storage evidence', async () => {
    const current = await snapshot();
    const onOpenProject = vi.fn();
    const container = render(
      <BuilderProjectCatalog snapshot={current} onOpenProject={onOpenProject} />,
    );
    act(() => button(container, 'Tiny timer')?.click());

    expect(container.textContent).toContain('Your projects');
    expect(container.querySelector('[data-builder-project-catalog="true"]')?.className).toContain(
      'text-[var(--cf-text-soft)]',
    );
    expect(container.textContent).toContain('Tiny timer');
    expect(container.textContent).toContain('A small focus timer.');
    expect(container.textContent).toContain('Version 2');
    expect(container.textContent).not.toContain('sha256:');
    expect(container.textContent).not.toContain('verified_project_head');
    expect(onOpenProject).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('renders the verified empty state and its two explicit commands', async () => {
    const onCreateProject = vi.fn();
    const onRefresh = vi.fn();
    const container = render(
      <BuilderProjectCatalog
        onCreateProject={onCreateProject}
        onRefresh={onRefresh}
        snapshot={await snapshot(result([]))}
      />,
    );
    act(() => button(container, 'New project')?.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Refresh projects"]')?.click());

    expect(container.textContent).toContain('No saved projects yet.');
    expect(button(container, 'New project')?.className).toContain('cf-builder-primary-button');
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Refresh projects"]')?.className).toContain(
      'cf-builder-secondary-button',
    );
    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('labels loading, refreshing, stale, and unavailable states accurately', async () => {
    const controller = createBuilderProjectCatalogController({ listCurrent: async () => result() });
    const loading = controller.getSnapshot();
    const loaded = await controller.load();
    const failedController = createBuilderProjectCatalogController({
      listCurrent: async () => { throw new Error('private marker'); },
    });
    const unavailable = await failedController.load();
    const staleController = createBuilderProjectCatalogController({
      listCurrent: vi.fn().mockResolvedValueOnce(result()).mockRejectedValueOnce(new Error('private')),
    });
    await staleController.load();
    const stale = await staleController.refresh();

    expect(render(<BuilderProjectCatalog snapshot={loading} />).textContent)
      .toContain('Loading saved projects...');
    expect(render(<BuilderProjectCatalog snapshot={unavailable} />).textContent)
      .toContain('Saved projects are unavailable.');
    expect(render(<BuilderProjectCatalog snapshot={stale} />).textContent)
      .toContain('Showing the previous list.');
    expect(loaded.status).toBe('ready');
  });

  it('disables commands while busy or when callbacks are absent', () => {
    const controller = createBuilderProjectCatalogController({ listCurrent: async () => result() });
    const container = render(<BuilderProjectCatalog snapshot={controller.getSnapshot()} />);
    expect(Array.from(container.querySelectorAll('button')).every((candidate) => candidate.disabled)).toBe(true);
  });

  it('fails closed for a typed forged snapshot', async () => {
    const current = await snapshot();
    const forged = Object.freeze({ ...current, status: 'ready' }) as BuilderProjectCatalogSnapshot;
    const container = render(<BuilderProjectCatalog snapshot={forged} />);

    expect(container.textContent).toContain('Saved projects are unavailable.');
    expect(container.textContent).not.toContain('Tiny timer');
  });

  it('contains no legacy facts, editing, publishing, runtime, or permission commands', async () => {
    const container = render(<BuilderProjectCatalog snapshot={await snapshot()} />);
    expect(container.textContent).not.toMatch(
      /Chat|Canvas|Job|Workspace|artifact|permission|runtime|schema|adapter|publish|delete|recent/i,
    );
  });
});
