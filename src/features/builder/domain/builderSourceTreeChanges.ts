import type { BuilderProjectSourceFile, BuilderProjectSourceTree } from './builderProjectSnapshot';

export const BUILDER_SOURCE_TREE_CHANGES_VERSION = 'builder-source-tree-changes.v1' as const;
export const BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_LINES = 160 as const;
const BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_COMPARABLE_LINES = 320;
const BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_LINE_PRODUCT = 64_000;
const BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_LINE_CODE_POINTS = 240;

export type BuilderSourceTreeChangeKind = 'added' | 'modified' | 'deleted';
export type BuilderSourceTreeChangeDiffAvailability = 'shown' | 'too_large';
export type BuilderSourceTreeChangeDiffLineKind = 'context' | 'added' | 'removed';

export type BuilderSourceTreeChangeDiffLine = Readonly<{
  line_kind: BuilderSourceTreeChangeDiffLineKind;
  before_line: number | null;
  after_line: number | null;
  text: string;
  truncated: boolean;
}>;

export type BuilderSourceTreeChange = Readonly<{
  path: string;
  change_kind: BuilderSourceTreeChangeKind;
  before_line_count: number;
  after_line_count: number;
  diff_availability: BuilderSourceTreeChangeDiffAvailability;
  diff_lines: readonly BuilderSourceTreeChangeDiffLine[];
  omitted_line_count: number;
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
  return contentLines(content).length;
}

function contentLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split(/\r\n|\r|\n/u);
  return lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
}

function byPath(tree: BuilderProjectSourceTree | null): Map<string, BuilderProjectSourceFile> {
  const files = new Map<string, BuilderProjectSourceFile>();
  for (const file of tree?.files ?? []) files.set(file.path, file);
  return files;
}

function truncateLine(value: string): Readonly<{ text: string; truncated: boolean }> {
  const codePoints = Array.from(value);
  if (codePoints.length <= BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_LINE_CODE_POINTS) {
    return Object.freeze({ text: value, truncated: false });
  }
  return Object.freeze({
    text: `${codePoints.slice(0, BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_LINE_CODE_POINTS).join('')}...`,
    truncated: true,
  });
}

function diffLine(
  lineKind: BuilderSourceTreeChangeDiffLineKind,
  beforeLine: number | null,
  afterLine: number | null,
  text: string,
): BuilderSourceTreeChangeDiffLine {
  const truncated = truncateLine(text);
  return Object.freeze({
    line_kind: lineKind,
    before_line: beforeLine,
    after_line: afterLine,
    text: truncated.text,
    truncated: truncated.truncated,
  });
}

function cappedDiffLines(
  lines: readonly BuilderSourceTreeChangeDiffLine[],
): Readonly<{
  diff_lines: readonly BuilderSourceTreeChangeDiffLine[];
  omitted_line_count: number;
}> {
  if (lines.length <= BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_LINES) {
    return Object.freeze({
      diff_lines: Object.freeze([...lines]),
      omitted_line_count: 0,
    });
  }
  return Object.freeze({
    diff_lines: Object.freeze([...lines.slice(0, BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_LINES)]),
    omitted_line_count: lines.length - BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_LINES,
  });
}

function wholeFileDiff(
  lineKind: 'added' | 'removed',
  lines: readonly string[],
): Readonly<{
  diff_availability: BuilderSourceTreeChangeDiffAvailability;
  diff_lines: readonly BuilderSourceTreeChangeDiffLine[];
  omitted_line_count: number;
}> {
  const allLines = lines.map((line, index) => diffLine(
    lineKind,
    lineKind === 'removed' ? index + 1 : null,
    lineKind === 'added' ? index + 1 : null,
    line,
  ));
  return Object.freeze({
    diff_availability: 'shown',
    ...cappedDiffLines(allLines),
  });
}

function lineDiff(
  beforeLines: readonly string[],
  afterLines: readonly string[],
): readonly BuilderSourceTreeChangeDiffLine[] | null {
  if (
    beforeLines.length + afterLines.length > BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_COMPARABLE_LINES
    || beforeLines.length * afterLines.length > BUILDER_SOURCE_TREE_CHANGE_DIFF_MAX_LINE_PRODUCT
  ) return null;

  const columnCount = afterLines.length + 1;
  const table = Array.from(
    { length: beforeLines.length + 1 },
    () => new Uint16Array(columnCount),
  );
  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      table[beforeIndex][afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? table[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(table[beforeIndex + 1][afterIndex], table[beforeIndex][afterIndex + 1]);
    }
  }

  const lines: BuilderSourceTreeChangeDiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      lines.push(diffLine('context', beforeIndex + 1, afterIndex + 1, beforeLines[beforeIndex]));
      beforeIndex += 1;
      afterIndex += 1;
    } else if (table[beforeIndex + 1][afterIndex] >= table[beforeIndex][afterIndex + 1]) {
      lines.push(diffLine('removed', beforeIndex + 1, null, beforeLines[beforeIndex]));
      beforeIndex += 1;
    } else {
      lines.push(diffLine('added', null, afterIndex + 1, afterLines[afterIndex]));
      afterIndex += 1;
    }
  }
  while (beforeIndex < beforeLines.length) {
    lines.push(diffLine('removed', beforeIndex + 1, null, beforeLines[beforeIndex]));
    beforeIndex += 1;
  }
  while (afterIndex < afterLines.length) {
    lines.push(diffLine('added', null, afterIndex + 1, afterLines[afterIndex]));
    afterIndex += 1;
  }
  return Object.freeze(lines);
}

function changeDiff(
  changeKind: BuilderSourceTreeChangeKind,
  before: BuilderProjectSourceFile | null,
  after: BuilderProjectSourceFile | null,
): Readonly<{
  diff_availability: BuilderSourceTreeChangeDiffAvailability;
  diff_lines: readonly BuilderSourceTreeChangeDiffLine[];
  omitted_line_count: number;
}> {
  const beforeLines = before === null ? [] : contentLines(before.content);
  const afterLines = after === null ? [] : contentLines(after.content);
  if (changeKind === 'added') return wholeFileDiff('added', afterLines);
  if (changeKind === 'deleted') return wholeFileDiff('removed', beforeLines);

  const lines = lineDiff(beforeLines, afterLines);
  if (lines === null) {
    return Object.freeze({
      diff_availability: 'too_large',
      diff_lines: Object.freeze([]),
      omitted_line_count: beforeLines.length + afterLines.length,
    });
  }
  return Object.freeze({
    diff_availability: 'shown',
    ...cappedDiffLines(lines),
  });
}

function change(
  path: string,
  changeKind: BuilderSourceTreeChangeKind,
  before: BuilderProjectSourceFile | null,
  after: BuilderProjectSourceFile | null,
): BuilderSourceTreeChange {
  const diff = changeDiff(changeKind, before, after);
  return Object.freeze({
    path,
    change_kind: changeKind,
    before_line_count: before === null ? 0 : lineCount(before.content),
    after_line_count: after === null ? 0 : lineCount(after.content),
    diff_availability: diff.diff_availability,
    diff_lines: diff.diff_lines,
    omitted_line_count: diff.omitted_line_count,
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
