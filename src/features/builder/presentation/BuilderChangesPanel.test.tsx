// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  BuilderSourceTreeChange,
  BuilderSourceTreeChanges,
} from '../domain/builderSourceTreeChanges';
import { BuilderChangesPanel } from './BuilderChangesPanel';

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
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  act(() => button?.click());
}

function change(overrides: Partial<BuilderSourceTreeChange> = {}): BuilderSourceTreeChange {
  return Object.freeze({
    after_line_count: 2,
    before_line_count: 1,
    change_kind: 'modified',
    diff_availability: 'shown',
    diff_lines: Object.freeze([
      Object.freeze({
        after_line: 1,
        before_line: 1,
        line_kind: 'context',
        text: 'const title = "Dashboard";',
        truncated: false,
      }),
      Object.freeze({
        after_line: 2,
        before_line: null,
        line_kind: 'added',
        text: 'render();',
        truncated: false,
      }),
    ]),
    omitted_line_count: 0,
    path: 'src/app.js',
    ...overrides,
  }) as BuilderSourceTreeChange;
}

function changes(overrides: Partial<BuilderSourceTreeChanges> = {}): BuilderSourceTreeChanges {
  return Object.freeze({
    added_count: 1,
    changes_version: 'builder-source-tree-changes.v1',
    comparison_kind: 'draft_update',
    deleted_count: 1,
    files: Object.freeze([
      change(),
      change({
        after_line_count: 0,
        before_line_count: 3,
        change_kind: 'deleted',
        diff_lines: Object.freeze([
          Object.freeze({
            after_line: null,
            before_line: 1,
            line_kind: 'removed',
            text: 'old file',
            truncated: false,
          }),
        ]),
        path: 'old.js',
      }),
    ]),
    modified_count: 1,
    total_count: 3,
    ...overrides,
  }) as BuilderSourceTreeChanges;
}

describe('BuilderChangesPanel', () => {
  it('renders the changes summary and opens non-deleted files from the inline diff', () => {
    const onOpenChange = vi.fn();
    const onOpenFile = vi.fn();
    const container = render(
      <BuilderChangesPanel
        changes={changes()}
        onOpenChange={onOpenChange}
        onOpenFile={onOpenFile}
        open
      />,
    );

    const panel = container.querySelector('[data-builder-changes-panel="true"]');
    const disclosure = container.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
    expect(panel?.getAttribute('aria-label')).toBe('Project changes');
    expect(panel?.getAttribute('id')).toBe('builder-tool-changes');
    expect(disclosure?.open).toBe(true);
    expect(container.querySelector('[data-builder-changes-summary="true"]')?.textContent)
      .toBe('3 file changes: 1 added, 1 changed, 1 removed.');
    expect(container.querySelector('[data-builder-change-card="Changed src/app.js"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-change-card="Removed old.js"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-change-diff="src/app.js"]')?.textContent)
      .toContain('render();');

    click(container, '.cf-builder-change-path-button');
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: 'src/app.js' }));
    expect(container.querySelector('[data-builder-change-card="Removed old.js"] button')).toBeNull();

    act(() => {
      if (disclosure) {
        disclosure.open = false;
        disclosure.dispatchEvent(new Event('toggle', { bubbles: true }));
      }
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('explains empty and too-large comparisons without exposing fake changes', () => {
    const empty = render(
      <BuilderChangesPanel
        changes={changes({
          added_count: 0,
          comparison_kind: 'no_draft',
          deleted_count: 0,
          files: Object.freeze([]),
          modified_count: 0,
          total_count: 0,
        })}
        onOpenChange={() => undefined}
        onOpenFile={() => undefined}
        open
      />,
    );

    expect(empty.textContent).toContain('Make a draft to compare it with the current version.');
    expect(empty.querySelector('[data-builder-change-card]')).toBeNull();

    const tooLarge = render(
      <BuilderChangesPanel
        changes={changes({
          files: Object.freeze([
            change({
              diff_availability: 'too_large',
              diff_lines: Object.freeze([]),
              omitted_line_count: 400,
              path: 'big-file.js',
            }),
          ]),
          total_count: 1,
        })}
        onOpenChange={() => undefined}
        onOpenFile={() => undefined}
        open
      />,
    );

    expect(tooLarge.querySelector('[data-builder-change-diff-note="big-file.js"]')?.textContent)
      .toContain('too large for the inline comparison');
  });

  it('keeps artifact placement open and avoids repeating the tab title', () => {
    const onOpenChange = vi.fn();
    const container = render(
      <BuilderChangesPanel
        changes={changes()}
        onOpenChange={onOpenChange}
        onOpenFile={() => undefined}
        open={false}
        placement="artifact"
      />,
    );

    const panel = container.querySelector('[data-builder-changes-panel="true"]');
    const disclosure = container.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
    const summary = container.querySelector<HTMLElement>('[data-builder-changes-summary-placement="artifact"]');
    expect(panel?.getAttribute('data-builder-changes-placement')).toBe('artifact');
    expect(disclosure?.open).toBe(true);
    expect(summary?.querySelector('.cf-builder-changes-title')).toBeNull();
    expect(summary?.textContent).toContain('3 file changes: 1 added, 1 changed, 1 removed.');

    act(() => {
      if (disclosure) {
        disclosure.open = false;
        disclosure.dispatchEvent(new Event('toggle', { bubbles: true }));
      }
    });
    expect(disclosure?.open).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
