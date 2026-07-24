import type { BuilderProjectSourceFile, BuilderProjectSourceTree } from './builderProjectSnapshot';

export const BUILDER_SOURCE_TREE_CHANGES_VERSION = 'builder-source-tree-changes.v1' as const;

export type BuilderSourceTreeChangeKind = 'added' | 'modified' | 'deleted';

export type BuilderSourceTreeChange = Readonly<{
  path: string;
  change_kind: BuilderSourceTreeChangeKind;
  before_line_count: number;
  after_line_count: number;
}>;

export type BuilderSourceTreeChanges = Readonly<{
  changes_version: typeof BUILDER_SOURCE_TREE_CHANGES_VERSION;
  comparison_kind: 'no_draft' | 'new_project' | 'draft_update';
  added_count: number;
  modified_count: number;
  deleted_count: number;
  total_count: number;
  files: readonly BuilderSourceTreeChange[];
}>;

const TRUSTED_CHANGES = new WeakSet<object>();

function lineCount(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split(/\r\n|\r|\n/u);
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

function byPath(tree: BuilderProjectSourceTree | null): Map<string, BuilderProjectSourceFile> {
  const files = new Map<string, BuilderProjectSourceFile>();
  for (const file of tree?.files ?? []) files.set(file.path, file);
  return files;
}

function change(
  path: string,
  changeKind: BuilderSourceTreeChangeKind,
  before: BuilderProjectSourceFile | null,
  after: BuilderProjectSourceFile | null,
): BuilderSourceTreeChange {
  return Object.freeze({
    path,
    change_kind: changeKind,
    before_line_count: before === null ? 0 : lineCount(before.content),
    after_line_count: after === null ? 0 : lineCount(after.content),
  });
}

export function isTrustedBuilderSourceTreeChanges(
  value: unknown,
): value is BuilderSourceTreeChanges {
  return value !== null && typeof value === 'object' && TRUSTED_CHANGES.has(value);
}

export function createBuilderSourceTreeChanges(
  savedTree: BuilderProjectSourceTree | null,
  draftTree: BuilderProjectSourceTree | null,
): BuilderSourceTreeChanges {
  if (draftTree === null) {
    const result = Object.freeze({
      changes_version: BUILDER_SOURCE_TREE_CHANGES_VERSION,
      comparison_kind: 'no_draft' as const,
      added_count: 0,
      modified_count: 0,
      deleted_count: 0,
      total_count: 0,
      files: Object.freeze([]),
    });
    TRUSTED_CHANGES.add(result);
    return result;
  }

  const before = byPath(savedTree);
  const after = byPath(draftTree);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort((left, right) => (
    left.localeCompare(right, 'en')
  ));
  const files = paths.flatMap((path) => {
    const previous = before.get(path) ?? null;
    const next = after.get(path) ?? null;
    if (previous === null && next !== null) return [change(path, 'added', null, next)];
    if (previous !== null && next === null) return [change(path, 'deleted', previous, null)];
    if (previous !== null && next !== null && previous.content_digest !== next.content_digest) {
      return [change(path, 'modified', previous, next)];
    }
    return [];
  });
  const addedCount = files.filter((file) => file.change_kind === 'added').length;
  const modifiedCount = files.filter((file) => file.change_kind === 'modified').length;
  const deletedCount = files.filter((file) => file.change_kind === 'deleted').length;
  const result = Object.freeze({
    changes_version: BUILDER_SOURCE_TREE_CHANGES_VERSION,
    comparison_kind: savedTree === null ? 'new_project' as const : 'draft_update' as const,
    added_count: addedCount,
    modified_count: modifiedCount,
    deleted_count: deletedCount,
    total_count: files.length,
    files: Object.freeze(files),
  });
  TRUSTED_CHANGES.add(result);
  return result;
}
