// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
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

function documentKeyDown(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => document.dispatchEvent(event));
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

function expectSinglePrimaryAction(container: HTMLElement): HTMLButtonElement {
  const actions = container.querySelectorAll<HTMLButtonElement>(
    '.cf-builder-composer-actions [data-builder-composer-primary-action="true"]',
  );
  expect(actions).toHaveLength(1);
  return actions[0]!;
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

  it('keeps one primary composer action across idle and busy states', () => {
    const idleEmpty = render(
      <BuilderComposer
        {...props({
          canSubmitComposer: false,
          instruction: '',
        })}
      />,
    );

    const idleEmptyAction = expectSinglePrimaryAction(idleEmpty);
    expect(idleEmptyAction.getAttribute('data-builder-submit-turn')).toBe('true');
    expect(idleEmptyAction.getAttribute('aria-label')).toBe('Send');
    expect(idleEmptyAction.disabled).toBe(true);
    expect(idleEmpty.querySelector('[data-builder-cancel-work="true"]')).toBeNull();

    const busyEmpty = render(
      <BuilderComposer
        {...props({
          busy: true,
          canAddContext: true,
          canCancel: true,
          canSubmitComposer: false,
          instruction: '',
          status: 'answering',
        })}
      />,
    );

    const busyEmptyAction = expectSinglePrimaryAction(busyEmpty);
    expect(busyEmptyAction.getAttribute('data-builder-cancel-work')).toBe('true');
    expect(busyEmptyAction.getAttribute('aria-label')).toBe('Stop');
    expect(busyEmpty.querySelector('[data-builder-submit-turn="true"]')).toBeNull();

    const busyWithInput = render(
      <BuilderComposer
        {...props({
          busy: true,
          canAddContext: true,
          canCancel: true,
          canSubmitComposer: true,
          instruction: 'Also make the header smaller.',
          status: 'generating',
        })}
      />,
    );

    const busyWithInputAction = expectSinglePrimaryAction(busyWithInput);
    expect(busyWithInputAction.getAttribute('data-builder-submit-turn')).toBe('true');
    expect(busyWithInputAction.getAttribute('aria-label')).toBe('Add context');
    expect(busyWithInput.querySelector('[data-builder-cancel-work="true"]')).toBeNull();

    const busyLocked = render(
      <BuilderComposer
        {...props({
          busy: true,
          canAddContext: false,
          canCancel: false,
          canEditInstruction: false,
          canSubmitComposer: false,
          instruction: '',
          status: 'saving',
        })}
      />,
    );

    const busyLockedAction = expectSinglePrimaryAction(busyLocked);
    expect(busyLockedAction.getAttribute('data-builder-busy-work')).toBe('true');
    expect(busyLockedAction.getAttribute('aria-label')).toBe('Saving...');
    expect(busyLockedAction.disabled).toBe(true);
    expect(busyLocked.querySelector('[data-builder-submit-turn="true"]')).toBeNull();
    expect(busyLocked.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
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

  it('restores composer focus after a locked busy submit cycle finishes', async () => {
    function FocusHarness() {
      const [busy, setBusy] = useState(false);
      const [instruction, setInstruction] = useState('Ask a question.');
      return (
        <BuilderComposer
          {...props({
            busy,
            canEditInstruction: !busy,
            canSubmitComposer: instruction.trim().length > 0 && !busy,
            instruction,
            onInstructionChange: setInstruction,
            onSubmitInstruction: () => {
              setInstruction('');
              setBusy(true);
              window.setTimeout(() => setBusy(false), 0);
            },
            status: busy ? 'answering' : 'new',
          })}
        />
      );
    }
    const container = render(<FocusHarness />);
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
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.disabled).toBe(false);
    expect(document.activeElement).toBe(container.querySelector<HTMLTextAreaElement>('#builder-idea'));
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

  it('projects safe working context status chips in the composer context bar', () => {
    const ready = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'ready_to_execute',
          instruction: '',
        })}
      />,
    );

    const readyStatus = ready.querySelector('[data-builder-composer-status="true"]');
    expect(readyStatus?.textContent).toContain('Ready to execute current direction');
    expect(readyStatus?.getAttribute('data-builder-composer-context-status')).toBe('ready_to_execute');
    expect(ready.querySelector('[data-builder-approval-mode-chip="true"]')).toBeNull();
    const contextBar = ready.querySelector('[data-builder-composer-context-bar="true"]');
    const workspaceChip = ready.querySelector('[data-builder-workspace-chip="true"]');
    const footer = ready.querySelector('.cf-builder-composer-footer');
    expect(contextBar).not.toBeNull();
    expect(workspaceChip?.closest('[data-builder-composer-context-bar="true"]')).toBe(contextBar);
    expect(workspaceChip?.closest('.cf-builder-composer-footer')).not.toBe(footer);
    expect(readyStatus?.closest('[data-builder-composer-context-bar="true"]')).toBe(contextBar);
    expect(readyStatus?.closest('.cf-builder-composer-footer')).not.toBe(footer);
    expect(ready.querySelector('[data-builder-submit-turn="true"]')).not.toBeNull();

    const approved = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'using_approved_plan',
          instruction: '',
        })}
      />,
    );

    expect(approved.querySelector('[data-builder-composer-status="true"]')?.textContent)
      .toContain('Using approved plan');
    expect(approved.textContent).not.toMatch(/Brief|WorkingContext|Task Capsule|receipt|provider|credential/iu);

    const changed = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'direction_changed',
          instruction: '',
        })}
      />,
    );
    expect(changed.querySelector('[data-builder-composer-status="true"]')?.textContent)
      .toContain('Direction changed');

    const confirmation = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'needs_confirmation',
          instruction: '',
        })}
      />,
    );
    expect(confirmation.querySelector('[data-builder-composer-status="true"]')?.textContent)
      .toContain('Needs confirmation');
  });

  it('clears the selected workspace from the context bar without touching the footer', () => {
    const onClearWorkspaceSelection = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          onClearWorkspaceSelection,
          savedProject: {
            revisionNumber: 2,
            title: 'Saved dashboard',
          },
        })}
      />,
    );

    const clear = container.querySelector<HTMLButtonElement>('[data-builder-clear-workspace-selection="true"]');
    const contextBar = container.querySelector('[data-builder-composer-context-bar="true"]');
    const footer = container.querySelector('.cf-builder-composer-footer');
    expect(clear).not.toBeNull();
    expect(clear?.closest('[data-builder-composer-context-bar="true"]')).toBe(contextBar);
    expect(clear?.closest('.cf-builder-composer-footer')).not.toBe(footer);

    click(container, '[data-builder-clear-workspace-selection="true"]');

    expect(onClearWorkspaceSelection).toHaveBeenCalledOnce();
  });

  it('does not offer workspace clearing while an unsaved draft is awaiting review', () => {
    const container = render(
      <BuilderComposer
        {...props({
          hasUnsavedDraft: true,
          onClearWorkspaceSelection: vi.fn(),
          savedProject: {
            revisionNumber: 2,
            title: 'Saved dashboard',
          },
        })}
      />,
    );

    expect(container.querySelector('[data-builder-clear-workspace-selection="true"]')).toBeNull();
  });

  it('uses the add menu for Plan mode without adding another send command', () => {
    const onSelectPlanMode = vi.fn();
    const onSelectApprovalMode = vi.fn();
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          canAllowCurrentProjectApproval: true,
          canProposePlan: true,
          onSelectApprovalMode,
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
    expect(menu?.textContent).not.toContain('Brief');
    expect(menu?.textContent).toContain('Plan mode');
    expect(menu?.textContent).not.toContain('Approval mode');
    expect(menu?.textContent).not.toContain('Read-only chat');
    expect(menu?.textContent).not.toContain('Ask before write');
    expect(menu?.textContent).not.toContain('Allow current project');

    expect(container.querySelector('[data-builder-composer-add-brief="true"]')).toBeNull();
    expect(onSelectPlanMode).not.toHaveBeenCalled();
    expect(onSelectApprovalMode).not.toHaveBeenCalled();
    expect(onSubmitInstruction).not.toHaveBeenCalled();

    click(container, '[data-builder-composer-add-plan-mode="true"]');

    expect(onSelectPlanMode).toHaveBeenCalledOnce();
    expect(onSelectApprovalMode).not.toHaveBeenCalled();
    expect(onSubmitInstruction).not.toHaveBeenCalled();
  });

  it('selects approval mode from its own menu without adding another send command', () => {
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

    expect(container.querySelector('[data-builder-approval-mode-chip="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-approval-menu-button="true"]')?.textContent)
      .toContain('Ask before write');
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);

    click(container, '[data-builder-composer-approval-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-approval-menu="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-composer-approval-mode-option="ask_before_write"]')
      ?.getAttribute('aria-checked')).toBe('true');
    click(container, '[data-builder-composer-approval-mode-option="read_only_chat"]');

    expect(onSelectApprovalMode).toHaveBeenCalledExactlyOnceWith('read_only_chat');
    expect(container.querySelector('[data-builder-composer-approval-menu="true"]')).toBeNull();
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
    click(container, '[data-builder-composer-approval-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-approval-menu="true"]')).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-approval-menu="true"]')).toBeNull();

    click(container, '[data-builder-workspace-chip="true"]');
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
  });

  it('closes composer popovers with Escape and returns focus to the composer', () => {
    const onDismissWorkspacePicker = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          catalogProjects: Object.freeze([savedProject()]),
          catalogWorkspaceProjects: Object.freeze([boundWorkspace()]),
          onDismissWorkspacePicker,
          onOpenProject: vi.fn(),
          workspacePickerRequest: 1,
        })}
      />,
    );
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();

    expect(container.querySelector('[data-builder-workspace-picker="true"]')).not.toBeNull();
    const workspaceEscape = documentKeyDown({ key: 'Escape' });
    expect(workspaceEscape.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-dismissed-build-note="true"]')?.textContent)
      .toContain("Choose a project folder when you're ready to build.");
    expect(onDismissWorkspacePicker).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(textarea);

    click(container, '[data-builder-composer-add-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).not.toBeNull();
    const addMenuEscape = documentKeyDown({ key: 'Escape' });
    expect(addMenuEscape.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();
    expect(document.activeElement).toBe(textarea);

    click(container, '[data-builder-composer-approval-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-approval-menu="true"]')).not.toBeNull();
    const approvalMenuEscape = documentKeyDown({ key: 'Escape' });
    expect(approvalMenuEscape.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-builder-composer-approval-menu="true"]')).toBeNull();
    expect(document.activeElement).toBe(textarea);
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

    click(container, '[data-builder-composer-approval-menu-button="true"]');

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
    expect(composer?.getAttribute('data-builder-route-active-run-input')).toBe('not_active');
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
          composerContextStatus: 'ready_to_execute',
          instruction: '',
        })}
      />,
    );

    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-clear-composer-brief="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Current brief');
    expect(container.textContent).not.toContain('starfield hero');
    expect(container.querySelector('[data-builder-composer-status="true"]')?.textContent)
      .toContain('Ready to execute current direction');
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);
  });
});
