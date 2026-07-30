// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BuilderWorkingProject } from '../application/builderProjectController';
import { decideBuilderComposerIntent } from '../application/builderComposerIntent';
import type {
  BuilderProjectCatalogItem,
  BuilderProjectWorkspaceCatalogItem,
} from '../domain/builderProjectCatalog';
import { BuilderComposer, type BuilderComposerProps } from './BuilderComposer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const WORKSPACE_PROJECT_ID = 'builder-project:223e4567-e89b-42d3-a456-426614174000';
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

function keyDown(container: HTMLElement, selector: string, init: KeyboardEventInit): KeyboardEvent {
  const target = container.querySelector<HTMLElement>(selector);
  expect(target).not.toBeNull();
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => target?.dispatchEvent(event));
  return event;
}

function changeInput(container: HTMLElement, selector: string, value: string): void {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  expect(input).not.toBeNull();
  act(() => {
    if (input === null) return;
    const descriptor = Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function savedProject(): BuilderProjectCatalogItem {
  return Object.freeze({
    commit_oid: OID,
    project_id: PROJECT_ID,
    revision_number: 2,
    revision_receipt_digest: DIGEST,
    selected_at_ms: 10,
    summary: 'A saved dashboard.',
    title: 'Saved dashboard',
    tree_oid: OID,
  });
}

function boundWorkspace(): BuilderProjectWorkspaceCatalogItem {
  return Object.freeze({
    bound_at_ms: 20,
    current_revision_number: 0,
    has_current_revision: false,
    project_id: WORKSPACE_PROJECT_ID,
    source_folders: Object.freeze([Object.freeze({ name: 'site-source', status: 'selected' })]),
    title: 'Unsaved dashboard',
  });
}

function workingProject(): BuilderWorkingProject {
  return Object.freeze({
    project_id: WORKSPACE_PROJECT_ID,
    source_folders: Object.freeze([Object.freeze({ name: 'site-source', status: 'selected' })]),
    title: 'Unsaved dashboard',
  });
}

function props(overrides: Partial<BuilderComposerProps> = {}): BuilderComposerProps {
  return {
    busy: false,
    canAddContext: false,
    canCancel: false,
    canEditInstruction: true,
    canProposePlan: false,
    canSubmit: true,
    canSubmitComposer: true,
    catalogBusy: false,
    catalogProjects: Object.freeze([]),
    catalogWorkspaceProjects: Object.freeze([]),
    hasUnsavedDraft: false,
    instruction: 'Make a timer.',
    savedProject: null,
    status: 'new',
    viewingHistory: false,
    workingProject: null,
    ...overrides,
  };
}

describe('BuilderComposer', () => {
  it('keeps one send command for chat and build turns, including Enter submit', () => {
    const onSubmitInstruction = vi.fn();
    const onInstructionChange = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          onInstructionChange,
          onSubmitInstruction,
        })}
      />,
    );

    const composer = container.querySelector('[data-builder-composer="true"]');
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(composer).not.toBeNull();
    expect(textarea?.getAttribute('aria-label')).toBe('Ask a question, or describe what to build or change');
    expect(textarea?.placeholder).toBe('Ask a question, or describe what to build or change...');
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-builder-ask-question="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-make-draft="true"]')).toBeNull();

    const enter = keyDown(container, '#builder-idea', { key: 'Enter' });
    expect(enter.defaultPrevented).toBe(true);
    expect(onSubmitInstruction).toHaveBeenCalledOnce();

    changeInput(container, '#builder-idea', 'What does this project do?');
    expect(onInstructionChange).toHaveBeenCalledWith('What does this project do?');
  });

  it('keeps project picking inside the composer without creating hidden build work', () => {
    const onCreateProject = vi.fn();
    const onOpenProject = vi.fn();
    const onDismissWorkspacePicker = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          catalogProjects: Object.freeze([savedProject()]),
          catalogWorkspaceProjects: Object.freeze([boundWorkspace()]),
          onCreateProject,
          onDismissWorkspacePicker,
          onOpenProject,
          workspacePickerRequest: 1,
        })}
      />,
    );

    const picker = container.querySelector('[data-builder-workspace-picker="true"]');
    expect(picker?.textContent).toContain('Choose or create a project before I build.');
    expect(picker?.textContent).toContain('Saved projects');
    expect(picker?.textContent).toContain('Saved dashboard');
    expect(picker?.textContent).toContain('In progress');
    expect(picker?.textContent).toContain('Draft workspace - Source folder: site-source');

    click(container, '[data-builder-workspace-chip="true"]');
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-dismissed-build-note="true"]')?.textContent)
      .toContain("Choose a project folder when you're ready to build.");
    expect(onDismissWorkspacePicker).toHaveBeenCalledOnce();
    expect(onCreateProject).not.toHaveBeenCalled();
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('shows the current unsaved workspace and source-folder creation path', () => {
    const onCreateProject = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          canSubmit: false,
          canSubmitComposer: false,
          catalogWorkspaceProjects: Object.freeze([boundWorkspace()]),
          instruction: '',
          onCreateProject,
          workingProject: workingProject(),
          workspaceNewProjectRequest: 1,
        })}
      />,
    );

    expect(container.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
      .toContain('Unsaved dashboard');
    expect(container.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
      .toContain('Source folder: site-source');
    expect(container.querySelector('[data-builder-new-project-panel="true"]')?.textContent)
      .toContain('Source folders');

    changeInput(container, '[data-builder-new-project-title="true"]', 'Dashboard v2');
    click(container, '[data-builder-add-source-folder="true"]');
    expect(onCreateProject).toHaveBeenCalledExactlyOnceWith('Dashboard v2');
  });

  it('shows ready-to-build only for confirmed conversation context', () => {
    const ready = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'ready_to_build',
          instruction: '',
        })}
      />,
    );

    expect(ready.querySelector('[data-builder-composer-status="true"]')?.textContent)
      .toBe('Ready to build');

    const draft = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'ready_to_build',
          hasUnsavedDraft: true,
          instruction: '',
        })}
      />,
    );

    expect(draft.querySelector('[data-builder-composer-status="true"]')?.textContent)
      .toBe('Continue this draft');
  });

  it('projects the latest route decision without showing internal routing copy', () => {
    const container = render(
      <BuilderComposer
        {...props({
          composerRouteDecision: decideBuilderComposerIntent('创建登录页'),
          instruction: '创建登录页',
        })}
      />,
    );

    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('ask_workspace');
    expect(composer?.getAttribute('data-builder-route-confidence')).toBe('high');
    expect(composer?.getAttribute('data-builder-route-downgrade')).toBe('workspace_required');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('ask');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('clear_build');
    expect(container.textContent).not.toMatch(/workspace_required|write_project|clear_build|ask_workspace/iu);
  });

  it('shows and clears a compact current brief without adding another send path', () => {
    const onClearComposerWorkingBrief = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'ready_to_build',
          composerWorkingBrief: {
            key: 'builder-project:current-brief:1:3',
            label: 'Current brief',
            summary: 'Build a static portfolio homepage with a starfield hero and project cards.',
          },
          instruction: '',
          onClearComposerWorkingBrief,
        })}
      />,
    );

    const brief = container.querySelector('[data-builder-composer-brief="true"]');
    expect(brief?.textContent).toContain('Current brief');
    expect(brief?.textContent).toContain('starfield hero');
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);

    click(container, '[data-builder-clear-composer-brief="true"]');
    expect(onClearComposerWorkingBrief).toHaveBeenCalledExactlyOnceWith('builder-project:current-brief:1:3');
  });
});
