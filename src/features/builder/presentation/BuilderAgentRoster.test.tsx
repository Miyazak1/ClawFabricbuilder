// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { agentTreeWire } from '../../../test/builderAgentFixtures';
import { sanitizeBuilderAgentProjectTreeProjection } from '../domain/builderAgentProjectTreeProjection';
import { BuilderAgentRoster } from './BuilderAgentRoster';

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

describe('Builder Agent roster', () => {
  it('renders the persisted Agent as a first-class selected object', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onOpenAgent = vi.fn();
    const onToggleProjects = vi.fn();
    const tree = sanitizeBuilderAgentProjectTreeProjection(agentTreeWire());
    act(() => root.render(
      <BuilderAgentRoster
        agentConversationSelected
        onCreateProject={vi.fn()}
        onOpenAgent={onOpenAgent}
        onToggleProjects={onToggleProjects}
        projectCount={tree.projects.length}
        projectsExpanded
        snapshot={{ status: 'ready', tree, busy: false }}
      />,
    ));

    const agent = container.querySelector<HTMLButtonElement>('[data-builder-agent-id]');
    expect(container.textContent).toContain('Agents');
    expect(agent?.textContent).toContain('Builder');
    expect(agent?.getAttribute('aria-current')).toBe('page');
    act(() => agent?.click());
    expect(onOpenAgent).toHaveBeenCalledOnce();
    const projectsToggle = container.querySelector<HTMLButtonElement>('[aria-label="Hide projects"]');
    expect(projectsToggle?.textContent).toBe(String(tree.projects.length));
    expect(projectsToggle?.getAttribute('aria-pressed')).toBe('true');
    act(() => projectsToggle?.click());
    expect(onToggleProjects).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it('does not offer a Projects toggle when the Agent has no projects', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const tree = sanitizeBuilderAgentProjectTreeProjection({
      ...agentTreeWire(),
      projects: [],
    });
    act(() => root.render(
      <BuilderAgentRoster
        agentConversationSelected={false}
        onCreateProject={vi.fn()}
        onOpenAgent={vi.fn()}
        onToggleProjects={vi.fn()}
        projectCount={0}
        projectsExpanded={false}
        snapshot={{ status: 'ready', tree, busy: false }}
      />,
    ));
    expect(container.querySelector('.cf-builder-agent-projects-toggle')).toBeNull();
    act(() => root.unmount());
  });
});
