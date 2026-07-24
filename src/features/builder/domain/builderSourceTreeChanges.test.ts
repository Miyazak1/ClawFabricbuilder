import { describe, expect, it } from 'vitest';

import {
  createBuilderSourceTreeChanges,
  isTrustedBuilderSourceTreeChanges,
} from './builderSourceTreeChanges';
import type { BuilderProjectSourceTree } from './builderProjectSnapshot';

function digest(seed: string): string {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

function tree(files: Array<Readonly<{ path: string; content: string; seed: string }>>): BuilderProjectSourceTree {
  return Object.freeze({
    source_tree_version: 'builder-project-source-tree.v1',
    source_tree_digest: digest('a'),
    files: Object.freeze(files.map((file) => Object.freeze({
      path: file.path,
      entry_kind: 'text_file',
      content: file.content,
      content_digest: digest(file.seed),
    }))),
  });
}

describe('createBuilderSourceTreeChanges', () => {
  it('projects added, modified, and deleted files without exposing content or digests', () => {
    const changes = createBuilderSourceTreeChanges(
      tree([
        { path: 'README.md', content: 'old readme', seed: '1' },
        { path: 'src/a.ts', content: 'one\ntwo', seed: '2' },
        { path: 'src/remove.ts', content: 'gone', seed: '3' },
      ]),
      tree([
        { path: 'README.md', content: 'new readme\nwith detail', seed: '4' },
        { path: 'src/a.ts', content: 'one\ntwo', seed: '2' },
        { path: 'src/add.ts', content: 'added', seed: '5' },
      ]),
    );

    expect(changes).toMatchObject({
      changes_version: 'builder-source-tree-changes.v1',
      comparison_kind: 'draft_update',
      added_count: 1,
      modified_count: 1,
      deleted_count: 1,
      total_count: 3,
    });
    expect(changes.files).toEqual([
      {
        path: 'README.md',
        change_kind: 'modified',
        before_line_count: 1,
        after_line_count: 2,
      },
      {
        path: 'src/add.ts',
        change_kind: 'added',
        before_line_count: 0,
        after_line_count: 1,
      },
      {
        path: 'src/remove.ts',
        change_kind: 'deleted',
        before_line_count: 1,
        after_line_count: 0,
      },
    ]);
    expect(isTrustedBuilderSourceTreeChanges(changes)).toBe(true);
    expect(Object.isFrozen(changes)).toBe(true);
    expect(Object.isFrozen(changes.files)).toBe(true);
    expect(JSON.stringify(changes)).not.toMatch(/old readme|new readme|sha256:/u);
  });

  it('treats a first draft as new project additions and no draft as no changes', () => {
    const firstDraft = createBuilderSourceTreeChanges(null, tree([
      { path: 'index.html', content: '<main>Hello</main>', seed: '6' },
      { path: 'src/tool.py', content: 'print("hello")\n', seed: '7' },
    ]));
    expect(firstDraft).toMatchObject({
      comparison_kind: 'new_project',
      added_count: 2,
      modified_count: 0,
      deleted_count: 0,
      total_count: 2,
    });
    expect(firstDraft.files.map((file) => file.change_kind)).toEqual(['added', 'added']);
    expect(firstDraft.files.find((file) => file.path === 'src/tool.py')?.after_line_count)
      .toBe(1);

    const noDraft = createBuilderSourceTreeChanges(tree([
      { path: 'index.html', content: '<main>Hello</main>', seed: '6' },
    ]), null);
    expect(noDraft).toMatchObject({
      comparison_kind: 'no_draft',
      total_count: 0,
      files: [],
    });
    expect(isTrustedBuilderSourceTreeChanges(noDraft)).toBe(true);
  });
});
