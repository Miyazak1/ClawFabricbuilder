import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const STYLES_PATH = join(process.cwd(), 'src', 'styles.css');

function styles(): string {
  return readFileSync(STYLES_PATH, 'utf8');
}

function styleBlock(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) {
    return '';
  }

  const end = source.indexOf('\n}', start);
  if (end < 0) {
    return source.slice(start);
  }

  return source.slice(start, end + 2);
}

describe('Builder desktop layout styles', () => {
  it('keeps the desktop review sidebar compact and out of unsaved draft changes', () => {
    const source = styles();

    expect(source).toContain('.cf-builder-chat-shell {');
    expect(source).toContain('grid-template-columns: minmax(0, 1fr) minmax(176px, 196px);');
    expect(source).toContain('.cf-builder-chat-shell[data-builder-review-sidebar-visible="false"]');
    expect(source).not.toContain(
      '.cf-builder-chat-shell[data-builder-review-sidebar-mode="expanded"]',
    );
    expect(source).not.toContain('grid-template-columns: minmax(0, 1fr) minmax(360px, min(42vw, 520px));');
    expect(source).not.toMatch(
      /@media \(max-width: 1280px\)[\s\S]*?\.cf-builder-chat-shell[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/u,
    );
  });

  it('stacks the review sidebar only after the narrow desktop breakpoint', () => {
    const source = styles();

    expect(source).toMatch(
      /@media \(max-width: 1160px\)[\s\S]*?\.cf-builder-chat-shell \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/u,
    );
    expect(source).toMatch(
      /@media \(max-width: 1160px\)[\s\S]*?\.cf-builder-review-sidebar \{[\s\S]*?border-top: 1px solid var\(--cf-border\)/u,
    );
  });

  it('keeps on-demand change summaries compact inside the conversation flow', () => {
    const source = styles();
    const summaryRow = styleBlock(source, '.cf-builder-changes-summary-row');
    const summaryMain = styleBlock(source, '.cf-builder-changes-summary-main');
    const summaryText = styleBlock(source, '.cf-builder-changes-summary');
    const changesFlow = styleBlock(source, '.cf-builder-changes-flow .cf-builder-changes-panel');

    expect(changesFlow).toContain('border-radius: 8px;');
    expect(summaryRow).toContain('grid-template-columns: 20px minmax(0, 1fr);');
    expect(summaryMain).toContain('display: grid;');
    expect(summaryText).toContain('overflow: hidden;');
    expect(summaryText).toContain('text-overflow: ellipsis;');
    expect(summaryText).toContain('white-space: nowrap;');
    expect(summaryText).not.toContain('overflow-wrap: anywhere;');
  });

  it('keeps draft review actions stable in a desktop two-column checkpoint', () => {
    const source = styles();
    const review = styleBlock(source, '.cf-builder-review-checkpoint');
    const actions = styleBlock(source, '.cf-builder-review-actions');
    const actionButtons = styleBlock(source, '.cf-builder-review-actions > button');
    const versionAction = styleBlock(source, '.cf-builder-version-item > button');

    expect(review).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(review).toContain('align-items: center;');
    expect(review).not.toContain('minmax(320px, 360px)');
    expect(actions).toContain('display: flex;');
    expect(actions).toContain('flex-wrap: wrap;');
    expect(actions).toContain('justify-content: flex-end;');
    expect(actions).not.toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(actionButtons).toContain('width: auto;');
    expect(actionButtons).toContain('min-width: 112px;');
    expect(versionAction).toContain('grid-column: 2;');
    expect(source).toMatch(
      /@media \(max-width: 1160px\)[\s\S]*?\.cf-builder-review-checkpoint \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/u,
    );
  });

  it('keeps the conversation refresh control from taking a full toolbar row', () => {
    const source = styles();
    const activityPanel = styleBlock(source, '.cf-builder-activity-panel');
    const activityToolbar = styleBlock(source, '.cf-builder-activity-toolbar');

    expect(activityPanel).toContain('position: relative;');
    expect(activityToolbar).toContain('position: absolute;');
    expect(activityToolbar).toContain('inset-inline-end: 0;');
    expect(activityToolbar).toContain('min-height: 0;');
    expect(activityToolbar).not.toContain('min-height: 32px;');
    expect(source).toMatch(
      /(?:^|\n)\.cf-builder-activity-body-wrap \{[\s\S]*?padding: 0 40px 0 0;/u,
    );
  });
});
