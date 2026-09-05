import {
  useEffect,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  MessageSquareText,
  PanelLeftClose,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import type { BuilderAgentProjectTreeSnapshot } from '../application/builderAgentProjectTreeController';
import type { BuilderAgentTaskMonitorItem } from '../domain/builderAgentTaskMonitorProjection';

export type BuilderAgentSidebarProps = Readonly<{
  exportTranscriptFeedback?: BuilderTaskTranscriptExportFeedback | null;
  snapshot: BuilderAgentProjectTreeSnapshot;
  taskMonitor?: readonly BuilderAgentTaskMonitorItem[];
  selectedProjectId: string | null;
  selectedTaskAddressId: string | null;
  onCreateProject(): void;
  onCreateTask(projectId: string): void;
  onArchiveProject?: (projectId: string) => Promise<unknown> | void;
  onArchiveTask?: (projectId: string, taskAddressId: string) => Promise<unknown> | void;
  onExportTaskTranscript?: (projectId: string, taskAddressId: string) => Promise<unknown> | void;
  onOpenProject(projectId: string): void;
  onOpenTask(projectId: string, taskAddressId: string): void;
  onRenameProject?: (projectId: string, title: string) => Promise<unknown> | void;
  onRenameTask?: (projectId: string, taskAddressId: string, title: string) => Promise<unknown> | void;
  onCollapse(): void;
  onRefresh(): void;
}>;

export type BuilderTaskTranscriptExportFeedback = Readonly<{
  message: string;
  state: 'exporting' | 'failed' | 'ready';
  taskAddressId: string;
}>;

function taskStatusLabel(status: string): string {
  return ({ active: 'Ready', blocked: 'Blocked', review_needed: 'Review', completed: 'Done', planned: 'Planned', discussing: 'Discussing', draft: 'Draft', archived: 'Archived' } as Record<string, string>)[status] ?? status;
}

export function BuilderAgentSidebar({
  exportTranscriptFeedback = null,
  snapshot,
  taskMonitor = [],
  selectedProjectId,
  selectedTaskAddressId,
  onCreateProject,
  onCreateTask,
  onArchiveProject,
  onArchiveTask,
  onExportTaskTranscript,
  onOpenProject,
  onOpenTask,
  onRenameProject,
  onRenameTask,
  onCollapse,
  onRefresh,
}: BuilderAgentSidebarProps) {
  const tree = snapshot.tree;
  const monitoredTasks = new Map(taskMonitor.map((task) => [task.task_address_id, task]));
  const [contextMenu, setContextMenu] = useState<Readonly<{
    projectId: string | null;
    taskAddressId: string | null;
    x: number;
    y: number;
  }> | null>(null);
  const [renameTarget, setRenameTarget] = useState<Readonly<{
    kind: 'project' | 'task';
    projectId: string;
    taskAddressId: string | null;
  }> | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleProject = (projectId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };
  useEffect(() => {
    if (contextMenu === null) return undefined;
    const dismiss = () => setContextMenu(null);
    const dismissOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('keydown', dismissOnKey);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('keydown', dismissOnKey);
    };
  }, [contextMenu]);
  const openContextMenu = (
    event: ReactMouseEvent,
    projectId: string | null,
    taskAddressId: string | null = null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      projectId,
      taskAddressId,
      x: event.clientX,
      y: event.clientY,
    });
  };
  const runContextAction = (action: () => void) => {
    setContextMenu(null);
    action();
  };
  const startRename = (
    kind: 'project' | 'task',
    projectId: string,
    taskAddressId: string | null,
    title: string,
  ) => {
    setContextMenu(null);
    setRenameTarget({ kind, projectId, taskAddressId });
    setRenameDraft(title);
  };
  const cancelRename = () => {
    setRenameTarget(null);
    setRenameDraft('');
  };
  const submitRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (renameTarget === null) return;
    const title = renameDraft.trim();
    if (title.length === 0) {
      cancelRename();
      return;
    }
    if (renameTarget.kind === 'project') {
      void onRenameProject?.(renameTarget.projectId, title);
    } else if (renameTarget.taskAddressId !== null) {
      void onRenameTask?.(renameTarget.projectId, renameTarget.taskAddressId, title);
    }
    cancelRename();
  };
  return (
    <section className="cf-builder-agent-sidebar" data-builder-agent-sidebar="true">
      {tree !== null ? (
        <header className="cf-builder-agent-sidebar-header">
          <span className="min-w-0"><strong>Projects</strong><small>{tree.agent.display_name}</small></span>
          <button
            aria-label="Hide projects"
            className="cf-builder-agent-sidebar-collapse"
            onClick={onCollapse}
            title="Hide projects"
            type="button"
          >
            <PanelLeftClose className="size-4" aria-hidden="true" />
          </button>
        </header>
      ) : null}
      <div className="cf-builder-agent-sidebar-actions">
        <button className="cf-builder-primary-button" data-builder-catalog-new-project="true" onClick={onCreateProject} type="button"><Plus className="size-4" aria-hidden="true" />New project</button>
        <button aria-label="Refresh Agent projects" className="cf-builder-icon-button" disabled={snapshot.busy} onClick={onRefresh} title="Refresh" type="button"><RefreshCw className="size-4" aria-hidden="true" /></button>
      </div>
      {snapshot.status === 'loading' ? <p className="cf-builder-agent-sidebar-state" role="status">Loading Builder...</p> : null}
      {snapshot.status === 'unavailable' ? <div className="cf-builder-agent-sidebar-state" role="alert"><strong>Builder setup is unavailable.</strong><span>Retry after checking the local Agent data.</span></div> : null}
      {snapshot.status === 'stale' ? <p className="cf-builder-agent-sidebar-state" role="status">Showing the last available project tree.</p> : null}
      {exportTranscriptFeedback !== null ? (
        <p
          className="cf-builder-agent-sidebar-state"
          data-builder-task-transcript-export-status={exportTranscriptFeedback.state}
          role={exportTranscriptFeedback.state === 'failed' ? 'alert' : 'status'}
        >
          {exportTranscriptFeedback.message}
        </p>
      ) : null}
      {tree !== null && tree.projects.length === 0 ? <p className="cf-builder-agent-sidebar-state">No projects yet.</p> : null}
      {tree !== null ? (
        <ul aria-label={`${tree.agent.display_name} projects`} className="cf-builder-agent-projects">
          {tree.projects.map((project) => (
            <li key={project.project_id} onContextMenu={(event) => openContextMenu(event, project.project_id)}>
              <div className="cf-builder-agent-project-heading" data-selected={project.project_id === selectedProjectId ? 'true' : 'false'}>
                <button
                  aria-expanded={!collapsedProjectIds.has(project.project_id)}
                  aria-label={`${collapsedProjectIds.has(project.project_id) ? 'Expand' : 'Collapse'} ${project.title}`}
                  className="cf-builder-agent-project-toggle"
                  onClick={() => toggleProject(project.project_id)}
                  title={collapsedProjectIds.has(project.project_id) ? 'Expand project' : 'Collapse project'}
                  type="button"
                >
                  {collapsedProjectIds.has(project.project_id)
                    ? <ChevronRight className="size-3.5" aria-hidden="true" />
                    : <ChevronDown className="size-3.5" aria-hidden="true" />}
                </button>
                {renameTarget?.kind === 'project' && renameTarget.projectId === project.project_id ? (
                  <form
                    className="cf-builder-agent-inline-rename-form"
                    data-builder-agent-project-rename-form={project.project_id}
                    onSubmit={submitRename}
                  >
                    <input
                      aria-label="Project name"
                      className="cf-builder-input"
                      data-builder-agent-project-rename-input={project.project_id}
                      onChange={(event) => setRenameDraft(event.currentTarget.value)}
                      value={renameDraft}
                    />
                    <button
                      aria-label="Cancel project rename"
                      data-builder-agent-project-rename-cancel={project.project_id}
                      onClick={cancelRename}
                      title="Cancel"
                      type="button"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                    <button
                      data-builder-agent-project-rename-save={project.project_id}
                      disabled={renameDraft.trim().length === 0}
                      type="submit"
                    >
                      Save
                    </button>
                  </form>
                ) : (
                  <button className="cf-builder-agent-project-link" data-builder-project-id={project.project_id} onClick={() => onOpenProject(project.project_id)} type="button">
                    <FolderOpen className="size-4" aria-hidden="true" />
                    <span><strong>{project.title}</strong><small>{project.source_boundary_label ?? project.summary}</small></span>
                  </button>
                )}
                <button
                  aria-label={`New task in ${project.title}`}
                  className="cf-builder-agent-project-new-task"
                  onClick={() => onCreateTask(project.project_id)}
                  title="New task"
                  type="button"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                </button>
                {project.active_task_count > 0 ? <span className="cf-builder-agent-count">{project.active_task_count}</span> : null}
              </div>
              {project.tasks.length > 0 && !collapsedProjectIds.has(project.project_id) ? (
                <ul aria-label={`${project.title} tasks`} className="cf-builder-agent-tasks">
                  {project.tasks.map((task) => {
                    const monitored = monitoredTasks.get(task.task_address_id) ?? null;
                    const displayedStatus = monitored?.state ?? task.status;
                    const displayedStatusLabel = monitored?.status_label ?? taskStatusLabel(task.status);
                    return (
                    <li key={task.task_address_id}>
                      {renameTarget?.kind === 'task'
                      && renameTarget.projectId === project.project_id
                      && renameTarget.taskAddressId === task.task_address_id ? (
                        <form
                          className="cf-builder-agent-inline-rename-form"
                          data-builder-agent-task-rename-form={task.task_address_id}
                          onSubmit={submitRename}
                        >
                          <input
                            aria-label="Task name"
                            className="cf-builder-input"
                            data-builder-agent-task-rename-input={task.task_address_id}
                            onChange={(event) => setRenameDraft(event.currentTarget.value)}
                            value={renameDraft}
                          />
                          <button
                            aria-label="Cancel task rename"
                            data-builder-agent-task-rename-cancel={task.task_address_id}
                            onClick={cancelRename}
                            title="Cancel"
                            type="button"
                          >
                            <X className="size-3.5" aria-hidden="true" />
                          </button>
                          <button
                            data-builder-agent-task-rename-save={task.task_address_id}
                            disabled={renameDraft.trim().length === 0}
                            type="submit"
                          >
                            Save
                          </button>
                        </form>
                      ) : (
                        <button
                          data-builder-task-address-id={task.task_address_id}
                          data-selected={task.task_address_id === selectedTaskAddressId ? 'true' : 'false'}
                          onClick={() => onOpenTask(project.project_id, task.task_address_id)}
                          onContextMenu={(event) => openContextMenu(event, project.project_id, task.task_address_id)}
                          type="button"
                        >
                          <MessageSquareText className="size-3.5" aria-hidden="true" />
                          <span>{task.title}</span><small data-status={displayedStatus}>{displayedStatusLabel}</small>
                        </button>
                      )}
                    </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        aria-hidden="true"
        className="cf-builder-agent-sidebar-empty-hit-area"
        onContextMenu={(event) => openContextMenu(event, selectedProjectId)}
      />
      {contextMenu !== null ? (
        <div
          aria-label="Project actions"
          className="cf-builder-agent-context-menu"
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.projectId !== null && contextMenu.taskAddressId === null ? (
            <button onClick={() => runContextAction(() => onCreateTask(contextMenu.projectId as string))} role="menuitem" type="button">
              <MessageSquareText className="size-4" aria-hidden="true" />
              New task
            </button>
          ) : null}
          {contextMenu.projectId !== null && contextMenu.taskAddressId === null && typeof onRenameProject === 'function' ? (
            <button
              data-builder-agent-context-rename-project={contextMenu.projectId}
              onClick={() => {
                const project = tree?.projects.find((item) => item.project_id === contextMenu.projectId);
                if (project) startRename('project', project.project_id, null, project.title);
              }}
              role="menuitem"
              type="button"
            >
              <Pencil className="size-4" aria-hidden="true" />
              Rename project
            </button>
          ) : null}
          {contextMenu.projectId !== null && contextMenu.taskAddressId === null && typeof onArchiveProject === 'function' ? (
            <button
              data-builder-agent-context-archive-project={contextMenu.projectId}
              onClick={() => runContextAction(() => onArchiveProject(contextMenu.projectId as string))}
              role="menuitem"
              type="button"
            >
              <Archive className="size-4" aria-hidden="true" />
              Archive project
            </button>
          ) : null}
          {contextMenu.projectId !== null && contextMenu.taskAddressId !== null && typeof onRenameTask === 'function' ? (
            <button
              data-builder-agent-context-rename-task={contextMenu.taskAddressId}
              onClick={() => {
                const project = tree?.projects.find((item) => item.project_id === contextMenu.projectId);
                const task = project?.tasks.find((item) => item.task_address_id === contextMenu.taskAddressId);
                if (project && task) startRename('task', project.project_id, task.task_address_id, task.title);
              }}
              role="menuitem"
              type="button"
            >
              <Pencil className="size-4" aria-hidden="true" />
              Rename task
            </button>
          ) : null}
          {contextMenu.projectId !== null && contextMenu.taskAddressId !== null && typeof onArchiveTask === 'function' ? (
            <button
              data-builder-agent-context-archive-task={contextMenu.taskAddressId}
              onClick={() => runContextAction(() => onArchiveTask(
                contextMenu.projectId as string,
                contextMenu.taskAddressId as string,
              ))}
              role="menuitem"
              type="button"
            >
              <Archive className="size-4" aria-hidden="true" />
              Archive task
            </button>
          ) : null}
          {contextMenu.projectId !== null
          && contextMenu.taskAddressId !== null
          && typeof onExportTaskTranscript === 'function' ? (
            <button
              data-builder-agent-context-export-task-transcript={contextMenu.taskAddressId}
              onClick={() => runContextAction(() => onExportTaskTranscript(
                contextMenu.projectId as string,
                contextMenu.taskAddressId as string,
              ))}
              role="menuitem"
              type="button"
            >
              <FileText className="size-4" aria-hidden="true" />
              Export transcript
            </button>
          ) : null}
          <button onClick={() => runContextAction(onCreateProject)} role="menuitem" type="button">
            <FolderOpen className="size-4" aria-hidden="true" />
            New project
          </button>
        </div>
      ) : null}
    </section>
  );
}
