// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { agentTreeWire } from '../../../test/builderAgentFixtures';
import { sanitizeBuilderAgentProjectTreeProjection } from '../domain/builderAgentProjectTreeProjection';
import { BuilderAgentSidebar } from './BuilderAgentSidebar';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function changeInput(container: HTMLElement, selector: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  act(() => {
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        ?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

function click(container: HTMLElement, selector: string): void {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  act(() => button?.click());
}

function submit(container: HTMLElement, selector: string): void {
  const form = container.querySelector<HTMLFormElement>(selector);
  expect(form).not.toBeNull();
  act(() => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

describe('Builder Agent sidebar', () => {
  it('renders Agent to Project to Task and routes durable identities', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onOpenProject = vi.fn();
    const onOpenTask = vi.fn();
    const onCreateTask = vi.fn();
    const onCollapse = vi.fn();
    const tree = sanitizeBuilderAgentProjectTreeProjection(agentTreeWire());
    act(() => root.render(<BuilderAgentSidebar snapshot={{ status: 'ready', tree, busy: false }} selectedProjectId={tree.projects[0].project_id} selectedTaskAddressId={tree.projects[0].tasks[0].task_address_id} onCollapse={onCollapse} onCreateProject={vi.fn()} onCreateTask={onCreateTask} onOpenProject={onOpenProject} onOpenTask={onOpenTask} onRefresh={vi.fn()} />));
    expect(container.textContent).toContain('Builder');
    expect(container.textContent).toContain('Focus timer');
    expect(container.textContent).toContain('Improve timer');
    const projectButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Focus timer'));
    const taskButton = container.querySelector<HTMLButtonElement>('[data-builder-task-address-id]');
    act(() => projectButton?.click());
    act(() => taskButton?.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label^="New task in"]')?.click());
    expect(onOpenProject).toHaveBeenCalledWith(tree.projects[0].project_id);
    expect(onOpenTask).toHaveBeenCalledWith(tree.projects[0].project_id, tree.projects[0].tasks[0].task_address_id);
    expect(onCreateTask).toHaveBeenCalledWith(tree.projects[0].project_id);
    expect(taskButton?.dataset.selected).toBe('true');
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Hide projects"]')?.click());
    expect(onCollapse).toHaveBeenCalledOnce();
    const toggleButton = container.querySelector<HTMLButtonElement>('[aria-expanded="true"]');
    act(() => toggleButton?.click());
    expect(toggleButton?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-builder-task-address-id]')).toBeNull();
    act(() => root.unmount());
  });

  it('uses the Main-owned task monitor state instead of treating an open task as always working', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const tree = sanitizeBuilderAgentProjectTreeProjection(agentTreeWire());
    const task = tree.projects[0].tasks[0];
    act(() => root.render(
      <BuilderAgentSidebar
        onCollapse={vi.fn()}
        onCreateProject={vi.fn()}
        onCreateTask={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenTask={vi.fn()}
        onRefresh={vi.fn()}
        selectedProjectId={tree.projects[0].project_id}
        selectedTaskAddressId={task.task_address_id}
        snapshot={{ status: 'ready', tree, busy: false }}
        taskMonitor={[{
          task_address_id: task.task_address_id,
          project_id: task.project_id,
          conversation_id: task.conversation_id,
          title: task.title,
          goal: task.goal,
          group: 'attention',
          state: 'interrupted',
          status_label: 'Continue task',
          latest_activity_at_ms: task.latest_activity_at_ms ?? 0,
          latest_result: null,
          attention: null,
          operations: ['open_task'],
        }]}
      />,
    ));

    const status = container.querySelector('[data-builder-task-address-id] small');
    expect(status?.textContent).toBe('Continue task');
    expect(status?.getAttribute('data-status')).toBe('interrupted');
    act(() => root.unmount());
  });

  it('offers new task and new project from the blank-area context menu', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onCreateProject = vi.fn();
    const onCreateTask = vi.fn();
    const tree = sanitizeBuilderAgentProjectTreeProjection(agentTreeWire());
    act(() => root.render(<BuilderAgentSidebar snapshot={{ status: 'ready', tree, busy: false }} selectedProjectId={tree.projects[0].project_id} selectedTaskAddressId={null} onCollapse={vi.fn()} onCreateProject={onCreateProject} onCreateTask={onCreateTask} onOpenProject={vi.fn()} onOpenTask={vi.fn()} onRefresh={vi.fn()} />));

    const emptyArea = container.querySelector<HTMLElement>('.cf-builder-agent-sidebar-empty-hit-area');
    act(() => emptyArea?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 60 })));
    expect(container.querySelector('[role="menu"]')?.textContent).toContain('New task');
    const newTask = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((button) => button.textContent?.includes('New task'));
    act(() => newTask?.click());
    expect(onCreateTask).toHaveBeenCalledWith(tree.projects[0].project_id);

    act(() => emptyArea?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    const newProject = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((button) => button.textContent?.includes('New project'));
    act(() => newProject?.click());
    expect(onCreateProject).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it('keeps project and task lifecycle actions behind explicit callbacks', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onArchiveProject = vi.fn();
    const onArchiveTask = vi.fn();
    const onExportTaskTranscript = vi.fn();
    const onRenameProject = vi.fn();
    const onRenameTask = vi.fn();
    const tree = sanitizeBuilderAgentProjectTreeProjection(agentTreeWire());
    const project = tree.projects[0];
    const task = project.tasks[0];
    act(() => root.render(
      <BuilderAgentSidebar
        onArchiveProject={onArchiveProject}
        onArchiveTask={onArchiveTask}
        onCollapse={vi.fn()}
        onCreateProject={vi.fn()}
        onCreateTask={vi.fn()}
        onExportTaskTranscript={onExportTaskTranscript}
        onOpenProject={vi.fn()}
        onOpenTask={vi.fn()}
        onRefresh={vi.fn()}
        onRenameProject={onRenameProject}
        onRenameTask={onRenameTask}
        selectedProjectId={project.project_id}
        selectedTaskAddressId={task.task_address_id}
        snapshot={{ status: 'ready', tree, busy: false }}
      />,
    ));

    const openProjectMenu = () => {
      const projectButton = container.querySelector<HTMLElement>(`[data-builder-project-id="${project.project_id}"]`);
      expect(projectButton).not.toBeNull();
      act(() => projectButton?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 40 })));
    };
    const openTaskMenu = () => {
      const taskButton = container.querySelector<HTMLElement>(`[data-builder-task-address-id="${task.task_address_id}"]`);
      expect(taskButton).not.toBeNull();
      act(() => taskButton?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 36, clientY: 72 })));
    };

    openProjectMenu();
    click(container, `[data-builder-agent-context-rename-project="${project.project_id}"]`);
    changeInput(container, `[data-builder-agent-project-rename-input="${project.project_id}"]`, 'Renamed focus timer');
    submit(container, `[data-builder-agent-project-rename-form="${project.project_id}"]`);
    expect(onRenameProject).toHaveBeenCalledExactlyOnceWith(project.project_id, 'Renamed focus timer');

    openProjectMenu();
    click(container, `[data-builder-agent-context-archive-project="${project.project_id}"]`);
    expect(onArchiveProject).toHaveBeenCalledExactlyOnceWith(project.project_id);

    openTaskMenu();
    click(container, `[data-builder-agent-context-rename-task="${task.task_address_id}"]`);
    changeInput(container, `[data-builder-agent-task-rename-input="${task.task_address_id}"]`, 'Renamed timer task');
    submit(container, `[data-builder-agent-task-rename-form="${task.task_address_id}"]`);
    expect(onRenameTask).toHaveBeenCalledExactlyOnceWith(project.project_id, task.task_address_id, 'Renamed timer task');

    openTaskMenu();
    click(container, `[data-builder-agent-context-archive-task="${task.task_address_id}"]`);
    expect(onArchiveTask).toHaveBeenCalledExactlyOnceWith(project.project_id, task.task_address_id);

    openTaskMenu();
    click(container, `[data-builder-agent-context-export-task-transcript="${task.task_address_id}"]`);
    expect(onExportTaskTranscript).toHaveBeenCalledExactlyOnceWith(
      project.project_id,
      task.task_address_id,
    );

    act(() => root.unmount());
  });

  it('shows task transcript export feedback from the app shell', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const tree = sanitizeBuilderAgentProjectTreeProjection(agentTreeWire());
    const task = tree.projects[0].tasks[0];

    act(() => root.render(
      <BuilderAgentSidebar
        exportTranscriptFeedback={{
          message: 'Downloaded clawfabric-focus-timer-transcript.md.',
          state: 'ready',
          taskAddressId: task.task_address_id,
        }}
        onCollapse={vi.fn()}
        onCreateProject={vi.fn()}
        onCreateTask={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenTask={vi.fn()}
        onRefresh={vi.fn()}
        selectedProjectId={tree.projects[0].project_id}
        selectedTaskAddressId={task.task_address_id}
        snapshot={{ status: 'ready', tree, busy: false }}
      />,
    ));

    const status = container.querySelector('[data-builder-task-transcript-export-status="ready"]');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toContain('Downloaded clawfabric-focus-timer-transcript.md.');

    act(() => root.render(
      <BuilderAgentSidebar
        exportTranscriptFeedback={{
          message: 'Transcript export failed.',
          state: 'failed',
          taskAddressId: task.task_address_id,
        }}
        onCollapse={vi.fn()}
        onCreateProject={vi.fn()}
        onCreateTask={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenTask={vi.fn()}
        onRefresh={vi.fn()}
        selectedProjectId={tree.projects[0].project_id}
        selectedTaskAddressId={task.task_address_id}
        snapshot={{ status: 'ready', tree, busy: false }}
      />,
    ));

    const failure = container.querySelector('[data-builder-task-transcript-export-status="failed"]');
    expect(failure?.getAttribute('role')).toBe('alert');
    expect(failure?.textContent).toContain('Transcript export failed.');
    act(() => root.unmount());
  });
});
