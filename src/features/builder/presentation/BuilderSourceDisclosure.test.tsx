// @vitest-environment jsdom
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BuilderProjectSourceFile } from '../domain/builderProjectSnapshot';
import { BuilderSourceDisclosure } from './BuilderSourceDisclosure';

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

function click(container: HTMLElement, selector: string): void {
  const element = container.querySelector<HTMLElement>(selector);
  expect(element).not.toBeNull();
  act(() => element?.click());
}

function file(path: string, content: string): BuilderProjectSourceFile {
  return Object.freeze({
    content,
    content_digest: `sha256:${'a'.repeat(64)}`,
    entry_kind: 'text_file',
    path,
  });
}

describe('BuilderSourceDisclosure', () => {
  it('keeps project source collapsed until the chat flow asks to open it', () => {
    const onOpenChange = vi.fn();
    const sourceFile = file('src/app.js', 'render();\n');
    const disclosureRef = createRef<HTMLDetailsElement>();
    const container = render(
      <BuilderSourceDisclosure
        canToggle
        disclosureRef={disclosureRef}
        files={[sourceFile]}
        onOpenChange={onOpenChange}
        open={false}
        sourceFile={sourceFile}
      />,
    );

    const disclosure = container.querySelector('[data-builder-source-flow="true"]');
    expect(disclosure).toBe(disclosureRef.current);
    expect(disclosure?.getAttribute('aria-label')).toBe('Project source');
    expect(disclosure?.classList.contains('cf-builder-chat-flow-surface')).toBe(true);
    expect(container.querySelector('[data-builder-source-summary="true"]')?.textContent)
      .toContain('1 file - src/app.js');
    expect(container.querySelector('[data-builder-source-code="src/app.js"]')).toBeNull();

    click(container, '[data-builder-source-summary="true"]');
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('shows source files and opens another file without exposing a second authority', () => {
    const onOpenChange = vi.fn();
    const onSelectFile = vi.fn();
    const app = file('src/app.js', 'render();\n');
    const styles = file('styles.css', 'body { color: black; }\n');
    const container = render(
      <BuilderSourceDisclosure
        canToggle
        files={[app, styles]}
        onOpenChange={onOpenChange}
        onSelectFile={onSelectFile}
        open
        sourceFile={app}
      />,
    );

    expect(container.querySelector('[data-builder-source-code="src/app.js"]')?.textContent)
      .toContain('render();');
    expect(container.querySelector('[data-builder-source-file="src/app.js"]')?.getAttribute('data-active'))
      .toBe('true');
    expect(container.querySelector<HTMLButtonElement>('[data-builder-source-file="src/app.js"]')?.disabled)
      .toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-builder-source-file="styles.css"]')?.disabled)
      .toBe(false);

    click(container, '[data-builder-source-file="styles.css"]');
    expect(onSelectFile).toHaveBeenCalledExactlyOnceWith('styles.css');

    click(container, '[data-builder-source-summary="true"]');
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('does not collapse when a specific source file is selected by the surrounding page', () => {
    const onOpenChange = vi.fn();
    const sourceFile = file('src/app.js', 'render();\n');
    const container = render(
      <BuilderSourceDisclosure
        canToggle={false}
        files={[sourceFile]}
        onOpenChange={onOpenChange}
        open
        sourceFile={sourceFile}
      />,
    );

    click(container, '[data-builder-source-summary="true"]');
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
