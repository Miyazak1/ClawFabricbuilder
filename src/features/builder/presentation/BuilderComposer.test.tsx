// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BuilderWorkingProject } from '../application/builderProjectController';
import {
  createBuilderComposerRouteDecisionEvidence,
  decideBuilderComposerIntent,
} from '../application/builderComposerIntent';
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

  it('keeps the composer focused after clicking send so follow-up typing can continue', async () => {
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          onSubmitInstruction,
        })}
      />,
    );

    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    const send = container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]');
    expect(textarea).not.toBeNull();
    expect(send).not.toBeNull();

    act(() => textarea?.focus());
    expect(document.activeElement).toBe(textarea);
    act(() => send?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    act(() => send?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(onSubmitInstruction).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(textarea);
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

  it('uses the add menu for Plan mode without adding another send command', () => {
    const onSelectPlanMode = vi.fn();
    const onSelectBriefMode = vi.fn();
    const onSelectApprovalMode = vi.fn();
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          canAllowCurrentProjectApproval: true,
          canProposePlan: true,
          onSelectApprovalMode,
          onSelectBriefMode,
          onSelectPlanMode,
          onSubmitInstruction,
          savedProject: {
            revisionNumber: 2,
            title: 'Saved dashboard',
          },
        })}
      />,
    );

    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Plan first');
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();

    click(container, '[data-builder-composer-add-menu-button="true"]');

    const menu = container.querySelector('[data-builder-composer-add-menu="true"]');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain('Files and folders');
    expect(menu?.textContent).toContain('Brief');
    expect(menu?.textContent).toContain('Plan mode');
    expect(menu?.textContent).toContain('Approval mode');
    expect(menu?.textContent).toContain('Read-only chat');
    expect(menu?.textContent).toContain('Ask before write');
    expect(menu?.textContent).toContain('Allow current project');

    click(container, '[data-builder-composer-add-brief="true"]');
    expect(onSelectBriefMode).toHaveBeenCalledOnce();
    expect(onSelectPlanMode).not.toHaveBeenCalled();
    expect(onSelectApprovalMode).not.toHaveBeenCalled();
    expect(onSubmitInstruction).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();

    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-plan-mode="true"]');

    expect(onSelectPlanMode).toHaveBeenCalledOnce();
    expect(onSelectBriefMode).toHaveBeenCalledOnce();
    expect(onSelectApprovalMode).not.toHaveBeenCalled();
    expect(onSubmitInstruction).not.toHaveBeenCalled();
  });

  it('selects approval mode from the add menu without adding another send command', () => {
    const onSelectApprovalMode = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          approvalMode: 'ask_before_write',
          canAllowCurrentProjectApproval: true,
          onSelectApprovalMode,
          savedProject: {
            revisionNumber: 2,
            title: 'Saved dashboard',
          },
        })}
      />,
    );

    expect(container.querySelector('[data-builder-approval-mode-chip="true"]')?.textContent)
      .toContain('Ask before write');
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);

    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-approval-mode-option="read_only_chat"]');

    expect(onSelectApprovalMode).toHaveBeenCalledExactlyOnceWith('read_only_chat');
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();
  });

  it('closes composer popovers when clicking outside them', () => {
    const container = render(
      <BuilderComposer
        {...props({
          catalogProjects: Object.freeze([savedProject()]),
          catalogWorkspaceProjects: Object.freeze([boundWorkspace()]),
          onOpenProject: vi.fn(),
        })}
      />,
    );

    click(container, '[data-builder-composer-add-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();

    click(container, '[data-builder-workspace-chip="true"]');
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
  });

  it('keeps allow-current-project disabled until a project is selected', () => {
    const onSelectApprovalMode = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          approvalMode: 'ask_before_write',
          canAllowCurrentProjectApproval: false,
          onSelectApprovalMode,
        })}
      />,
    );

    click(container, '[data-builder-composer-add-menu-button="true"]');

    const allowCurrent = container.querySelector<HTMLButtonElement>(
      '[data-builder-composer-approval-mode-option="allow_current_project"]',
    );
    expect(allowCurrent?.disabled).toBe(true);
    click(container, '[data-builder-composer-approval-mode-option="allow_current_project"]');
    expect(onSelectApprovalMode).not.toHaveBeenCalled();
  });

  it('shows a removable Plan mode chip as mode state rather than a second send button', () => {
    const onClearComposerMode = vi.fn();
    const onSelectPlanMode = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          canProposePlan: true,
          composerMode: 'plan',
          onClearComposerMode,
          onSelectPlanMode,
          savedProject: {
            revisionNumber: 2,
            title: 'Saved dashboard',
          },
        })}
      />,
    );

    const chip = container.querySelector('[data-builder-composer-mode-chip="plan"]');
    expect(chip?.textContent).toContain('Plan mode');
    expect(container.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);

    click(container, '[data-builder-clear-composer-mode="true"]');

    expect(onClearComposerMode).toHaveBeenCalledOnce();
    expect(onSelectPlanMode).not.toHaveBeenCalled();
  });

  it('projects the latest route decision without showing internal routing copy', () => {
    const decision = decideBuilderComposerIntent('创建登录页');
    const container = render(
      <BuilderComposer
        {...props({
          composerRouteDecision: createBuilderComposerRouteDecisionEvidence(decision, {
            decisionId: 'builder-composer-route-decision:local:1',
            messageId: 'builder-composer-message:local:1',
            projectId: PROJECT_ID,
            taskId: null,
            createdAt: '2026-07-31T02:30:00.000Z',
          }),
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
    expect(composer?.getAttribute('data-builder-route-decision-id')).
      toBe('builder-composer-route-decision:local:1');
    expect(composer?.getAttribute('data-builder-route-message-id')).
      toBe('builder-composer-message:local:1');
    expect(composer?.getAttribute('data-builder-route-project-id')).toBe(PROJECT_ID);
    expect(composer?.getAttribute('data-builder-route-task-id')).toBeNull();
    expect(composer?.getAttribute('data-builder-route-created-at')).toBe('2026-07-31T02:30:00.000Z');
    expect(container.textContent).not.toMatch(
      /workspace_required|write_project|clear_build|ask_workspace|route-decision|composer-message/iu,
    );
  });

  it('keeps current brief memory out of the default composer UI', () => {
    const container = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'ready_to_build',
          instruction: '',
        })}
      />,
    );

    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-clear-composer-brief="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Current brief');
    expect(container.textContent).not.toContain('starfield hero');
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);
  });
});
