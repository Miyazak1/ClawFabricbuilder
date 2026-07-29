// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBuilderProjectCatalogController } from '../application/builderProjectCatalogController';
import { BuilderProjectCatalog } from './BuilderProjectCatalog';
import { PROJECT_ID, createCatalogWire, createWorkspaceCatalogWire } from '../../../test/builderV2Fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

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
  mounted.push({ root, container });
  act(() => root.render(element));
  return container;
}

function click(container: HTMLElement, label: string): void {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.includes(label));
  expect(button).not.toBeUndefined();
  act(() => button?.click());
}

describe('BuilderProjectCatalog v2', () => {
  it('renders only safe project summaries and explicit commands', async () => {
    const controller = createBuilderProjectCatalogController({
      listCurrent: async () => createCatalogWire(),
      listWorkspaces: async () => createWorkspaceCatalogWire(),
    });
    const snapshot = await controller.load();
    const onCreateProject = vi.fn();
    const onOpenProject = vi.fn();
    const onRefresh = vi.fn();
    const container = render(
      <BuilderProjectCatalog
        onCreateProject={onCreateProject}
        onOpenProject={onOpenProject}
        onRefresh={onRefresh}
        snapshot={snapshot}
      />,
    );

    expect(container.textContent).toContain('Hello project');
    expect(container.textContent).toContain('Version 1');
    expect(container.textContent).not.toMatch(/sha256|commit_oid|tree_oid|SQLite|Git/u);
    click(container, 'New project');
    click(container, 'Hello project');
    expect(onCreateProject).toHaveBeenCalledOnce();
    expect(onOpenProject).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('renders the verified empty state', async () => {
    const wire = await createCatalogWire();
    const controller = createBuilderProjectCatalogController({
      listCurrent: async () => ({ ...wire, projects: [] }),
      listWorkspaces: async () => createWorkspaceCatalogWire(),
    });
    const container = render(
      <BuilderProjectCatalog snapshot={await controller.load()} />,
    );
    expect(container.textContent).toContain('No saved projects yet.');
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });

  it('renders restart-restored unsaved workspace projects in the sidebar', async () => {
    const wire = await createCatalogWire();
    const controller = createBuilderProjectCatalogController({
      listCurrent: async () => ({ ...wire, projects: [] }),
      listWorkspaces: async () => createWorkspaceCatalogWire([{
        project_id: PROJECT_ID,
        title: 'Unsaved dashboard',
        source_folders: [{ name: 'site-source', status: 'selected' }],
        bound_at_ms: 20,
        has_current_revision: false,
        current_revision_number: 0,
      }]),
    });
    const onOpenProject = vi.fn();
    const container = render(
      <BuilderProjectCatalog
        onOpenProject={onOpenProject}
        snapshot={await controller.load()}
      />,
    );

    expect(container.textContent).toContain('In progress');
    expect(container.textContent).toContain('Unsaved dashboard');
    expect(container.textContent).toContain('Source folder: site-source');
    expect(container.textContent).not.toContain('No saved projects yet.');
    expect(container.textContent).not.toMatch(/sha256|commit_oid|tree_oid|SQLite|Git|[A-Za-z]:\\/u);

    click(container, 'Unsaved dashboard');
    expect(onOpenProject).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
  });

  it('labels stale data without dropping the previous list', async () => {
    const listCurrent = vi.fn()
      .mockResolvedValueOnce(await createCatalogWire())
      .mockRejectedValueOnce(new Error('private'));
    const controller = createBuilderProjectCatalogController({
      listCurrent,
      listWorkspaces: async () => createWorkspaceCatalogWire(),
    });
    await controller.load();
    const stale = await controller.refresh();
    const container = render(<BuilderProjectCatalog snapshot={stale} />);
    expect(container.textContent).toContain('Showing the previous list.');
    expect(container.textContent).toContain('Hello project');
  });

  it('fails closed for typed forged snapshots', () => {
    const container = render(<BuilderProjectCatalog snapshot={{
      status: 'ready',
      projects: [{
        project_id: PROJECT_ID,
        title: 'Forged',
        summary: 'Forged',
        revision_number: 1,
        revision_receipt_digest: `sha256:${'0'.repeat(64)}`,
        commit_oid: 'a'.repeat(40),
        tree_oid: 'b'.repeat(40),
        selected_at_ms: 1,
      }],
      workspaceProjects: [],
      busy: false,
    }} />);
    expect(container.textContent).toContain('Saved projects are unavailable.');
    expect(container.textContent).not.toContain('Forged');
  });
});
