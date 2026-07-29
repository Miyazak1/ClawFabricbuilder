// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BuilderWorkingProject } from '../application/builderProjectController';
import type {
  BuilderProjectCatalogItem,
  BuilderProjectWorkspaceCatalogItem,
} from '../domain/builderProjectCatalog';
import { BuilderWorkspacePicker, type BuilderWorkspacePickerProps } from './BuilderWorkspacePicker';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

const SAVED_PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const WORKSPACE_PROJECT_ID = 'builder-project:223e4567-e89b-42d3-a456-426614174000';
const OTHER_WORKSPACE_PROJECT_ID = 'builder-project:323e4567-e89b-42d3-a456-426614174000';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const OID = 'b'.repeat(40);

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

function click(container: HTMLElement, selector: string): void {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  act(() => button?.click());
}

function changeInput(container: HTMLElement, selector: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  act(() => {
    if (input === null) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function savedProject(): BuilderProjectCatalogItem {
  return Object.freeze({
    commit_oid: OID,
    project_id: SAVED_PROJECT_ID,
    revision_number: 2,
    revision_receipt_digest: DIGEST,
    selected_at_ms: 10,
    summary: 'A saved dashboard.',
    title: 'Saved dashboard',
    tree_oid: OID,
  });
}

function boundWorkspace(
  projectId = WORKSPACE_PROJECT_ID,
  title = 'Unsaved dashboard',
): BuilderProjectWorkspaceCatalogItem {
  return Object.freeze({
    bound_at_ms: 20,
    current_revision_number: 0,
    has_current_revision: false,
    project_id: projectId,
    source_folders: Object.freeze([Object.freeze({ name: 'site-source', status: 'selected' })]),
    title,
  });
}

function workingProject(): BuilderWorkingProject {
  return Object.freeze({
    project_id: WORKSPACE_PROJECT_ID,
    source_folders: Object.freeze([Object.freeze({ name: 'site-source', status: 'selected' })]),
    title: 'Unsaved dashboard',
  });
}

function props(overrides: Partial<BuilderWorkspacePickerProps> = {}): BuilderWorkspacePickerProps {
  return {
    buildPrompt: false,
    canCreateProject: true,
    canOpenProject: true,
    canStartNewProject: true,
    catalogBusy: false,
    catalogProjects: Object.freeze([]),
    catalogWorkspaceProjects: Object.freeze([]),
    creating: false,
    hasSavedProject: false,
    newProjectTitle: 'New project',
    onCreateProject: vi.fn(),
    onHideNewProjectPanel: vi.fn(),
    onNewProjectTitleChange: vi.fn(),
    onOpenProject: vi.fn(),
    onSearchChange: vi.fn(),
    onShowNewProjectPanel: vi.fn(),
    search: '',
    workingProject: null,
    ...overrides,
  };
}

describe('BuilderWorkspacePicker', () => {
  it('shows current, saved, and in-progress project groups without duplicating the current workspace', () => {
    const onOpenProject = vi.fn();
    const container = render(
      <BuilderWorkspacePicker
        {...props({
          buildPrompt: true,
          catalogProjects: Object.freeze([savedProject()]),
          catalogWorkspaceProjects: Object.freeze([
            boundWorkspace(),
            boundWorkspace(OTHER_WORKSPACE_PROJECT_ID, 'Other draft'),
          ]),
          onOpenProject,
          workingProject: workingProject(),
        })}
      />,
    );

    expect(container.querySelector('[data-builder-workspace-picker="true"]')?.textContent)
      .toContain('Choose or create a project before I build.');
    expect(container.querySelector('[data-builder-workspace-section="current"]')?.textContent)
      .toContain('Current project');
    expect(container.querySelector('[data-builder-workspace-current-project="true"]')?.textContent)
      .toContain('Draft workspace - Source folder: site-source');
    expect(container.querySelector('[data-builder-workspace-section="saved"]')?.textContent)
      .toContain('Saved projects');
    expect(container.querySelector('[data-builder-workspace-section="in-progress"]')?.textContent)
      .toContain('In progress');
    expect(container.querySelectorAll('[data-builder-workspace-bound-project]')).toHaveLength(1);

    click(container, `[data-builder-workspace-project="${SAVED_PROJECT_ID}"]`);
    click(container, `[data-builder-workspace-bound-project="${OTHER_WORKSPACE_PROJECT_ID}"]`);
    expect(onOpenProject).toHaveBeenCalledWith(SAVED_PROJECT_ID);
    expect(onOpenProject).toHaveBeenCalledWith(OTHER_WORKSPACE_PROJECT_ID);
  });

  it('keeps search as a controlled project filter without hiding New project', () => {
    const onSearchChange = vi.fn();
    const container = render(
      <BuilderWorkspacePicker
        {...props({
          catalogProjects: Object.freeze([savedProject()]),
          onSearchChange,
          search: 'missing',
        })}
      />,
    );

    expect(container.textContent).toContain('No matching projects.');
    expect(container.textContent).toContain('New project');
    expect(container.textContent).not.toContain('Saved dashboard');

    changeInput(container, '[data-builder-workspace-search="true"]', 'saved');
    expect(onSearchChange).toHaveBeenCalledExactlyOnceWith('saved');
  });

  it('keeps source-folder creation as an explicit action from the new project panel', () => {
    const onCreateProject = vi.fn();
    const onHideNewProjectPanel = vi.fn();
    const onNewProjectTitleChange = vi.fn();
    const container = render(
      <BuilderWorkspacePicker
        {...props({
          creating: true,
          newProjectTitle: 'Dashboard v2',
          onCreateProject,
          onHideNewProjectPanel,
          onNewProjectTitleChange,
        })}
      />,
    );

    expect(container.querySelector('[data-builder-new-project-panel="true"]')?.textContent)
      .toContain('Source folders');
    changeInput(container, '[data-builder-new-project-title="true"]', 'Dashboard v3');
    click(container, '[data-builder-add-source-folder="true"]');
    click(container, '.cf-builder-workspace-link-button');

    expect(onNewProjectTitleChange).toHaveBeenCalledExactlyOnceWith('Dashboard v3');
    expect(onCreateProject).toHaveBeenCalledOnce();
    expect(onHideNewProjectPanel).toHaveBeenCalledOnce();
  });
});
