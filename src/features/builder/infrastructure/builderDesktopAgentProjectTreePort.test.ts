import { describe, expect, it, vi } from 'vitest';
import { createBuilderDesktopAgentProjectTreePort } from './builderDesktopAgentProjectTreePort';

describe('Builder desktop Agent project tree port', () => {
  it('forwards only the Agent id through the isolated bridge', async () => {
    const read = vi.fn(async (request) => ({ request }));
    const renameProject = vi.fn(async (request) => ({ request }));
    const archiveProject = vi.fn(async (request) => ({ request }));
    const renameTask = vi.fn(async (request) => ({ request }));
    const archiveTask = vi.fn(async (request) => ({ request }));
    const port = createBuilderDesktopAgentProjectTreePort({
      read,
      renameProject,
      archiveProject,
      renameTask,
      archiveTask,
    });
    const agentId = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
    const projectId = 'builder-project:123e4567-e89b-42d3-a456-426614174200';
    const taskAddressId = 'builder-task-address:123e4567-e89b-42d3-a456-426614174203';
    expect(await port.read({ agent_id: agentId })).toEqual({ request: { agent_id: agentId } });
    expect(await port.renameProject({
      agent_id: agentId,
      project_id: projectId,
      title: 'Renamed project',
    })).toEqual({ request: { agent_id: agentId, project_id: projectId, title: 'Renamed project' } });
    expect(await port.archiveProject({
      agent_id: agentId,
      project_id: projectId,
    })).toEqual({ request: { agent_id: agentId, project_id: projectId } });
    expect(await port.renameTask({
      agent_id: agentId,
      project_id: projectId,
      task_address_id: taskAddressId,
      title: 'Renamed task',
    })).toEqual({
      request: {
        agent_id: agentId,
        project_id: projectId,
        task_address_id: taskAddressId,
        title: 'Renamed task',
      },
    });
    expect(await port.archiveTask({
      agent_id: agentId,
      project_id: projectId,
      task_address_id: taskAddressId,
    })).toEqual({ request: { agent_id: agentId, project_id: projectId, task_address_id: taskAddressId } });
    expect(read).toHaveBeenCalledOnce();
    expect(renameProject).toHaveBeenCalledOnce();
    expect(archiveProject).toHaveBeenCalledOnce();
    expect(renameTask).toHaveBeenCalledOnce();
    expect(archiveTask).toHaveBeenCalledOnce();
  });
});
