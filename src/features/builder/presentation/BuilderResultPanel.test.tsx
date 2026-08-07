// @vitest-environment jsdom
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BuilderResultPanel } from './BuilderResultPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

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

describe('BuilderResultPanel', () => {
  it('preserves the chat-flow result shell around the static preview', () => {
    const panelRef = createRef<HTMLElement>();
    const container = render(<BuilderResultPanel panelRef={panelRef} projection={null} />);

    const panel = container.querySelector('[data-builder-result-flow="true"]');
    expect(panel).toBe(panelRef.current);
    expect(panel?.getAttribute('aria-label')).toBe('Project result');
    expect(panel?.getAttribute('id')).toBe('builder-tool-preview');
    expect(panel?.className).toContain('cf-builder-result-card');
    expect(container.querySelector('[data-builder-preview-flow="true"]')).toBe(panel);
    expect(container.querySelector('.cf-builder-result-toolbar')?.textContent).toContain('Result');
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('Preview unavailable');
  });

  it('renders expanded preview placement without the chat-flow surface', () => {
    const container = render(<BuilderResultPanel placement="expanded" projection={null} />);

    const panel = container.querySelector('[data-builder-result-placement="expanded"]');
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('cf-builder-expanded-preview-card');
    expect(panel?.className).not.toContain('cf-builder-chat-flow-surface');
    expect(panel?.className).not.toContain('cf-builder-flow-card');
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('Preview unavailable');
  });

  it('keeps artifact preview expansion in the result toolbar', () => {
    const onExpandPreview = vi.fn();
    const container = render(
      <BuilderResultPanel
        onExpandPreview={onExpandPreview}
        placement="artifact"
        projection={null}
      />,
    );

    const expand = container.querySelector<HTMLButtonElement>('[data-builder-expand-preview="true"]');
    expect(expand).not.toBeNull();
    expect(expand?.closest('.cf-builder-result-toolbar')).not.toBeNull();
    expect(expand?.closest('[data-builder-result-placement="artifact"]')).not.toBeNull();
    act(() => expand?.click());
    expect(onExpandPreview).toHaveBeenCalledOnce();
  });
});
