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
    const limitation = container.querySelector('[data-builder-preview-limitation="true"]');
    expect(limitation?.getAttribute('role')).toBe('status');
    expect(limitation?.textContent).toContain('Static preview');
    expect(limitation?.textContent).toContain('HTML and CSS are shown here');
    expect(limitation?.textContent).toContain('JavaScript is disabled');
    expect(limitation?.textContent)
      .toContain('live preview support');
    expect(limitation?.textContent)
      .not.toContain('Preview may look blank');
    expect(limitation?.textContent)
      .toContain('This draft includes JavaScript that the safe preview does not run.');
    expect(container.textContent).not.toContain('Safe preview');
    expect(container.textContent).not.toContain('runtime preview is ready');
    const frame = container.querySelector<HTMLIFrameElement>('iframe');
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame?.getAttribute('srcdoc')).toContain("script-src 'none'");
    expect(frame?.getAttribute('srcdoc')).not.toContain('must not run');
    expect(frame?.getAttribute('srcdoc')).not.toContain('<script>bad()');
  });

  it('replaces runtime-only blank previews with an unavailable explanation', async () => {
    const projection = await createBuilderSourceTreePreview({
      project_id: PROJECT_ID,
      title: '3D scene',
      source_tree: await createSourceTree([
        { path: 'index.html', content: '<main><canvas id="scene"></canvas><script type="module" src="./src/app.js"></script></main>\n' },
        { path: 'src/app.js', content: 'import * as THREE from "three";\nfetch("https://example.com/model.glb");\nrequestAnimationFrame(() => undefined);\n' },
        { path: 'server/app.js', content: 'import express from "express";\nexpress().listen(3000);\n' },
      ]),
    });
    const container = render(<BuilderStaticPreview projection={projection} />);
    const limitation = container.querySelector('[data-builder-preview-limitation="true"]');
    const blocked = container.querySelector('[data-builder-preview-runtime-blocked="true"]');

    expect(blocked).not.toBeNull();
    expect(limitation?.textContent).toContain('Preview unavailable here');
    expect(limitation?.textContent).toContain('needs live preview support');
    expect(limitation?.textContent).toContain('JavaScript modules');
    expect(limitation?.textContent).toContain('Three.js or WebGL');
    expect(limitation?.textContent).toContain('canvas or animation');
    expect(limitation?.textContent).toContain('external assets or requests');
    expect(limitation?.textContent).toContain('local live preview');
    expect(limitation?.textContent).not.toContain('model.glb');
    expect(limitation?.textContent).not.toContain('express().listen');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('fails closed for typed projection forgeries', () => {
    const container = render(<BuilderStaticPreview projection={{
      version: 'builder-source-tree-static-preview.v3',
      title: 'Forged',
      src_doc: '<script>alert(1)</script>',
    }} />);
    const unavailable = container.querySelector('[data-builder-preview-unavailable="true"]');
    expect(unavailable?.getAttribute('role')).toBe('status');
    expect(unavailable?.textContent).toContain('Preview unavailable');
    expect(unavailable?.textContent).toContain('files were generated');
    expect(unavailable?.textContent).toContain('source files and changes');
    expect(unavailable?.textContent).toContain('live preview support');
    expect(unavailable?.textContent).toContain('3D/WebGL');
    expect(container.querySelector('iframe')).toBeNull();
  });
});
