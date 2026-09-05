import { describe, expect, it, vi } from 'vitest';
import { agentTreeWire } from '../../../test/builderAgentFixtures';
import { createBuilderAgentProjectTreeController } from './builderAgentProjectTreeController';

describe('Builder Agent project tree controller', () => {
  it('retains the last verified tree when refresh fails', async () => {
    const read = vi.fn().mockResolvedValueOnce(agentTreeWire()).mockRejectedValueOnce(new Error('offline'));
    const controller = createBuilderAgentProjectTreeController({
      read,
      renameProject: vi.fn(),
      archiveProject: vi.fn(),
      renameTask: vi.fn(),
      archiveTask: vi.fn(),
      exportTaskTranscript: vi.fn(),
    }, agentTreeWire().agent_id);
    expect((await controller.load()).status).toBe('ready');
    const stale = await controller.refresh();
    expect(stale.status).toBe('stale');
    expect(stale.tree?.projects[0].title).toBe('Focus timer');
  });
});
