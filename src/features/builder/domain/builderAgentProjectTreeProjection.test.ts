import { describe, expect, it } from 'vitest';
import { sanitizeBuilderAgentProjectTreeProjection } from './builderAgentProjectTreeProjection';
import { agentTreeWire } from '../../../test/builderAgentFixtures';

describe('Builder Agent project tree projection', () => {
  it('accepts verified Agent, Project, and Task Address facts', () => {
    const result = sanitizeBuilderAgentProjectTreeProjection(agentTreeWire());
    expect(result.agent.display_name).toBe('Builder');
    expect(result.projects[0].tasks[0].title).toBe('Improve timer');
    expect(Object.isFrozen(result.projects)).toBe(true);
  });
  it('rejects permission authority and synthetic task counts', () => {
    expect(() => sanitizeBuilderAgentProjectTreeProjection({ ...agentTreeWire(), authority: { ...agentTreeWire().authority, permission_grant: true } })).toThrow();
    const wire = agentTreeWire();
    wire.projects[0].task_count = 2;
    expect(() => sanitizeBuilderAgentProjectTreeProjection(wire)).toThrow();
  });
  it('requires every Task node to carry its Task-scoped conversation identity', () => {
    const wire = agentTreeWire();
    wire.projects[0].tasks[0].conversation_id = 'builder-conversation:123e4567-e89b-42d3-a456-426614174205';
    expect(() => sanitizeBuilderAgentProjectTreeProjection(wire)).toThrow();
  });
});
