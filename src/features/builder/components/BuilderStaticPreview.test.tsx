// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { createSourceTree, PROJECT_ID } from '../../../test/builderV2Fixtures';
import { createBuilderSourceTreePreview } from '../preview/builderSourceTreePreview';
import { BuilderStaticPreview } from './BuilderStaticPreview';

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

describe('BuilderStaticPreview', () => {
  it('renders only a trusted sandboxed source-tree preview', async () => {
    const projection = await createBuilderSourceTreePreview({
      project_id: PROJECT_ID,
      title: 'Color picker',
      source_tree: await createSourceTree([
        { path: 'index.html', content: '<main><h1>Pick a color</h1><script>bad()</script></main>\n' },
        { path: 'styles.css', content: 'h1 { color: rebeccapurple; }\n' },
        { path: 'app.js', content: 'throw new Error("must not run");\n' },
      ]),
    });
    const container = render(<BuilderStaticPreview projection={projection} />);

    expect(container.querySelector('h2')?.textContent).toBe('Color picker');
    expect(container.textContent).toContain('Static preview');
    expect(container.querySelector('[data-builder-preview-limitation="true"]')?.textContent)
      .toContain('static HTML and CSS only');
    expect(container.textContent).not.toContain('Safe preview');
    const frame = container.querySelector<HTMLIFrameElement>('iframe');
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame?.getAttribute('srcdoc')).toContain("script-src 'none'");
    expect(frame?.getAttribute('srcdoc')).not.toContain('must not run');
    expect(frame?.getAttribute('srcdoc')).not.toContain('<script>bad()');
  });

  it('fails closed for typed projection forgeries', () => {
    const container = render(<BuilderStaticPreview projection={{
      version: 'builder-source-tree-static-preview.v2',
      title: 'Forged',
      src_doc: '<script>alert(1)</script>',
    }} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Preview unavailable.');
    expect(container.querySelector('iframe')).toBeNull();
  });
});
