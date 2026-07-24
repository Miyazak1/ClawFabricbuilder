import { describe, expect, it } from 'vitest';

import {
  BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_LINES,
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
      expect.objectContaining({
        path: 'README.md',
        change_kind: 'modified',
        before_line_count: 1,
        after_line_count: 2,
      }),
      expect.objectContaining({
        path: 'src/add.ts',
        change_kind: 'added',
        before_line_count: 0,
        after_line_count: 1,
      }),
      expect.objectContaining({
        path: 'src/remove.ts',
        change_kind: 'deleted',
        before_line_count: 1,
        after_line_count: 0,
      }),
    ]);
    expect(changes.files[0].diff_lines).toEqual([
      expect.objectContaining({ line_kind: 'removed', before_line: 1, after_line: null, text: 'old readme' }),
      expect.objectContaining({ line_kind: 'added', before_line: null, after_line: 1, text: 'new readme' }),
      expect.objectContaining({ line_kind: 'added', before_line: null, after_line: 2, text: 'with detail' }),
    ]);
    expect(changes.files[1].diff_lines).toEqual([
      expect.objectContaining({ line_kind: 'added', before_line: null, after_line: 1, text: 'added' }),
    ]);
    expect(changes.files[2].diff_lines).toEqual([
      expect.objectContaining({ line_kind: 'removed', before_line: 1, after_line: null, text: 'gone' }),
    ]);
    expect(changes.files.every((file) => file.diff_availability === 'shown')).toBe(true);
    expect(changes.files.every((file) => Object.isFrozen(file.diff_lines))).toBe(true);
    expect(isTrustedBuilderSourceTreeChanges(changes)).toBe(true);
    expect(Object.isFrozen(changes)).toBe(true);
    expect(Object.isFrozen(changes.files)).toBe(true);
    expect(JSON.stringify(changes)).not.toMatch(/sha256:/u);
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

  it('keeps modified line context, CRLF line counts, and long-line truncation bounded', () => {
    const longLine = 'x'.repeat(260);
    const changes = createBuilderSourceTreeChanges(
      tree([
        { path: 'src/app.ts', content: `same\r\n${longLine}\r\nold\r\n`, seed: '8' },
      ]),
      tree([
        { path: 'src/app.ts', content: `same\r\n${longLine} changed\r\nnew\r\n`, seed: '9' },
      ]),
    );

    const [file] = changes.files;
    expect(file.before_line_count).toBe(3);
    expect(file.after_line_count).toBe(3);
    expect(file.diff_lines).toEqual([
      expect.objectContaining({ line_kind: 'context', before_line: 1, after_line: 1, text: 'same' }),
      expect.objectContaining({ line_kind: 'removed', before_line: 2, after_line: null, truncated: true }),
      expect.objectContaining({ line_kind: 'removed', before_line: 3, after_line: null, text: 'old' }),
      expect.objectContaining({ line_kind: 'added', before_line: null, after_line: 2, truncated: true }),
      expect.objectContaining({ line_kind: 'added', before_line: null, after_line: 3, text: 'new' }),
    ]);
    expect(file.diff_lines[1].text.endsWith('...')).toBe(true);
    expect(file.diff_lines[3].text.endsWith('...')).toBe(true);
  });

  it('omits unsafe large modified comparisons instead of computing an unbounded diff', () => {
    const oldContent = Array.from({ length: 321 }, (_, index) => `old ${index}`).join('\n');
    const newContent = Array.from({ length: 321 }, (_, index) => `new ${index}`).join('\n');
    const changes = createBuilderSourceTreeChanges(
      tree([{ path: 'large.txt', content: oldContent, seed: 'a' }]),
      tree([{ path: 'large.txt', content: newContent, seed: 'b' }]),
    );

    expect(changes.files[0]).toMatchObject({
      diff_availability: 'too_large',
      diff_lines: [],
      omitted_line_count: 642,
    });
  });

  it('caps whole-file comparisons to a fixed public window', () => {
    const content = Array.from(
      { length: BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_LINES + 3 },
      (_, index) => `line ${index}`,
    ).join('\n');

    const changes = createBuilderSourceTreeChanges(null, tree([
      { path: 'notes.txt', content, seed: 'c' },
    ]));

    expect(changes.files[0].diff_lines).toHaveLength(BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_LINES);
    expect(changes.files[0].omitted_line_count).toBe(3);
    expect(changes.files[0].diff_lines[0]).toMatchObject({
      line_kind: 'added',
      before_line: null,
      after_line: 1,
      text: 'line 0',
    });
  });
});
