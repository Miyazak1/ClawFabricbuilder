// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  BUILDER_SOURCE_TREE_PREVIEW_VERSION,
  BuilderSourceTreePreviewError,
  createBuilderSourceTreePreview,
  isTrustedBuilderSourceTreePreviewProjection,
} from './builderSourceTreePreview';
import { PROJECT_ID, createSourceTree } from '../../../test/builderV2Fixtures';

describe('createBuilderSourceTreePreview', () => {
  it('projects a static HTML/CSS view while stripping active content', async () => {
    const tree = await createSourceTree([
      {
        path: 'index.html',
        content: '<main onclick="bad()"><a href="https://example.com">Hello</a><script>bad()</script></main>\n',
      },
      { path: 'styles.css', content: 'main { color: red; }\n' },
      { path: 'src/app.js', content: 'fetch("https://example.com")\n' },
    ]);
    const result = await createBuilderSourceTreePreview({
      project_id: PROJECT_ID,
      title: 'Safe preview',
      source_tree: tree,
    });

    expect(result.version).toBe(BUILDER_SOURCE_TREE_PREVIEW_VERSION);
    expect(result.source_tree_digest).toBe(tree.source_tree_digest);
    expect(result.selected_html_path).toBe('index.html');
    expect(result.src_doc).toContain("script-src 'none'");
    expect(result.src_doc).toContain('data-builder-source-tree-style="styles.css"');
    expect(result.src_doc).not.toContain('<script>bad()');
    expect(result.src_doc).not.toContain('onclick=');
    expect(result.src_doc).not.toContain('https://example.com');
    expect(result.preview_runtime_limitations).toEqual([
      'javascript_removed',
      'network_or_external_asset',
    ]);
    expect(Object.isFrozen(result.preview_runtime_limitations)).toBe(true);
    expect(isTrustedBuilderSourceTreePreviewProjection(result)).toBe(true);
  });

  it('selects another HTML file when index.html is absent', async () => {
    const result = await createBuilderSourceTreePreview({
      project_id: PROJECT_ID,
      title: 'Docs',
      source_tree: await createSourceTree([
        { path: 'docs/start.html', content: '<main>Docs</main>\n' },
        { path: 'main.py', content: 'print("docs")\n' },
      ]),
    });
    expect(result.selected_html_path).toBe('docs/start.html');
    expect(result.preview_runtime_limitations).toEqual([]);
  });

  it('summarizes runtime-only preview limits without exposing source text', async () => {
    const result = await createBuilderSourceTreePreview({
      project_id: PROJECT_ID,
      title: '3D canvas',
      source_tree: await createSourceTree([
        { path: 'index.html', content: '<main><canvas id="stage"></canvas><script type="module" src="./src/app.js"></script></main>\n' },
        { path: 'src/app.js', content: 'import { WebGLRenderer } from "three";\nfetch("https://example.com/asset.glb");\nrequestAnimationFrame(() => undefined);\n' },
        { path: 'server/app.ts', content: 'import express from "express";\nexpress().listen(3000);\n' },
      ]),
    });

    expect(result.preview_runtime_limitations).toEqual([
      'javascript_removed',
      'javascript_module',
      'three_js',
      'canvas_animation',
      'network_or_external_asset',
      'backend_or_local_server',
    ]);
    expect(JSON.stringify(result.preview_runtime_limitations)).not.toContain('asset.glb');
    expect(JSON.stringify(result.preview_runtime_limitations)).not.toContain('express');
  });

  it('honestly rejects source trees without a static HTML entry while preserving general code support', async () => {
    await expect(createBuilderSourceTreePreview({
      project_id: PROJECT_ID,
      title: 'Python tool',
      source_tree: await createSourceTree([
        { path: 'main.py', content: 'print("ready")\n' },
      ]),
    })).rejects.toBeInstanceOf(BuilderSourceTreePreviewError);
  });

  it('does not trust typed projection forgeries', async () => {
    const result = await createBuilderSourceTreePreview({
      project_id: PROJECT_ID,
      title: 'Safe preview',
      source_tree: await createSourceTree(),
    });
    expect(isTrustedBuilderSourceTreePreviewProjection(structuredClone(result))).toBe(false);
  });
});
