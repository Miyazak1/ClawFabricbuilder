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
  it('pins the desktop shell and lets only the conversation body scroll', () => {
    const source = styles();
    const root = styleBlock(source, 'html,\nbody,\n#root');
    const desktopShell = styleBlock(source, '.cf-builder-desktop-shell');
    const builderShell = styleBlock(source, '.cf-builder-shell');
    const workbenchFrame = styleBlock(source, '.cf-builder-workbench-frame');
    const surfaceBody = styleBlock(source, '.cf-builder-surface-body');
    const chatMain = styleBlock(source, '.cf-builder-chat-main');
    const chatScroll = styleBlock(source, '.cf-builder-chat-scroll');

    expect(root).toContain('height: 100%;');
    expect(root).toContain('overflow: hidden;');
    expect(desktopShell).toContain('height: 100vh;');
    expect(desktopShell).toContain('overflow: hidden;');
    expect(builderShell).toContain('height: 100%;');
    expect(builderShell).toContain('overflow: hidden;');
    expect(workbenchFrame).toContain('height: 100%;');
    expect(workbenchFrame).toContain('overflow: hidden;');
    expect(surfaceBody).toContain('overflow: hidden;');
    expect(surfaceBody).not.toContain('overflow: auto;');
    expect(chatMain).toContain('grid-template-rows: minmax(0, 1fr) auto;');
    expect(chatMain).toContain('overflow: hidden;');
    expect(chatScroll).toContain('display: flex;');
    expect(chatScroll).toContain('flex-direction: column;');
    expect(chatScroll).toContain('align-items: center;');
    expect(chatScroll).toContain('overflow: auto;');
    expect(chatScroll).not.toContain('display: grid;');
  });

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

  it('keeps narrow desktop inside the fixed chat scroll boundary', () => {
    const source = styles();

    expect(source).toContain('@media (min-width: 721px) and (max-width: 1160px)');
    expect(source).toMatch(
      /@media \(min-width: 721px\) and \(max-width: 1160px\)[\s\S]*?\.cf-builder-surface-body \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\)/u,
    );
    expect(source).toMatch(
      /@media \(min-width: 721px\) and \(max-width: 1160px\)[\s\S]*?\.cf-builder-chat-shell \{[\s\S]*?height: 100%;[\s\S]*?min-height: 0;[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?grid-template-rows: minmax\(0, 1fr\) auto/u,
    );
    expect(source).toMatch(
      /@media \(min-width: 721px\) and \(max-width: 1160px\)[\s\S]*?\.cf-builder-chat-shell\[data-builder-review-sidebar-visible="false"\] \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\)/u,
    );
    expect(source).toMatch(
      /@media \(min-width: 721px\) and \(max-width: 1160px\)[\s\S]*?\.cf-builder-chat-main \{[\s\S]*?min-height: 0/u,
    );
    expect(source).toMatch(
      /@media \(min-width: 721px\) and \(max-width: 1160px\)[\s\S]*?\.cf-builder-review-sidebar \{[\s\S]*?border-top: 1px solid var\(--cf-border\)/u,
    );
    expect(source).not.toMatch(
      /@media \(max-width: 1160px\)[\s\S]*?\.cf-builder-chat-shell \{[\s\S]*?height: auto/u,
    );
    expect(source).not.toMatch(
      /@media \(max-width: 1160px\)[\s\S]*?\.cf-builder-chat-shell \{[\s\S]*?min-height: 680px/u,
    );
  });

  it('keeps on-demand change summaries compact inside the conversation flow', () => {
    const source = styles();
    const draftLanding = styleBlock(source, '.cf-builder-draft-landing');
    const draftLandingSurfaces = styleBlock(source, '.cf-builder-draft-landing > .cf-builder-chat-flow-surface');
    const summaryRow = styleBlock(source, '.cf-builder-changes-summary-row');
    const summaryMain = styleBlock(source, '.cf-builder-changes-summary-main');
    const summaryText = styleBlock(source, '.cf-builder-changes-summary');
    const changesFlow = styleBlock(source, '.cf-builder-changes-flow');
    const changesPanel = styleBlock(source, '.cf-builder-changes-flow .cf-builder-changes-panel');

    expect(draftLanding).toContain('display: grid;');
    expect(draftLanding).toContain('position: relative;');
    expect(draftLanding).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(draftLanding).toContain('width: min(860px, 100%);');
    expect(draftLanding).toContain('gap: 14px;');
    expect(draftLanding).toContain('isolation: isolate;');
    expect(draftLanding).toContain('margin-top: 4px;');
    expect(draftLanding).toContain('scroll-margin-block-start: 12px;');
    expect(draftLanding).not.toContain('border:');
    expect(draftLanding).not.toContain('border-radius');
    expect(draftLandingSurfaces).toContain('width: 100%;');
    expect(changesFlow).toContain('position: relative;');
    expect(changesFlow).toContain('z-index: 1;');
    expect(changesFlow).toContain('margin-top: 2px;');
    expect(changesFlow).toContain('scroll-margin-block-start: 12px;');
    expect(changesFlow).not.toContain('position: absolute;');
    expect(changesFlow).not.toContain('margin-top: -');
    expect(changesPanel).toContain('border-radius: 8px;');
    expect(summaryRow).toContain('grid-template-columns: 20px minmax(0, 1fr);');
    expect(summaryMain).toContain('display: grid;');
    expect(summaryText).toContain('overflow: hidden;');
    expect(summaryText).toContain('text-overflow: ellipsis;');
    expect(summaryText).toContain('white-space: nowrap;');
    expect(summaryText).not.toContain('overflow-wrap: anywhere;');
  });

  it('keeps draft review actions stable as a desktop conversation checkpoint', () => {
    const source = styles();
    const review = styleBlock(source, '.cf-builder-review-checkpoint');
    const copy = styleBlock(source, '.cf-builder-review-copy');
    const copyBody = styleBlock(source, '.cf-builder-review-copy > .min-w-0');
    const actions = styleBlock(source, '.cf-builder-review-actions');
    const actionButtons = styleBlock(source, '.cf-builder-review-actions > button');
    const versionAction = styleBlock(source, '.cf-builder-version-item > button');

    expect(review).toContain('position: relative;');
    expect(review).toContain('z-index: 2;');
    expect(review).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(review).toContain('align-items: start;');
    expect(review).toContain('row-gap: 12px;');
    expect(review).toContain('border-top: 1px solid var(--cf-border);');
    expect(review).toContain('border-bottom: 1px solid var(--cf-border);');
    expect(review).toContain('background: var(--cf-bg);');
    expect(review).toContain('isolation: isolate;');
    expect(review).toContain('margin-block: 6px 2px;');
    expect(review).toContain('overflow: visible;');
    expect(review).not.toContain('border-radius: 8px;');
    expect(review).not.toContain('minmax(320px, 360px)');
    expect(copy).toContain('align-items: start;');
    expect(copyBody).toContain('display: grid;');
    expect(copyBody).toContain('gap: 2px;');
    expect(actions).toContain('display: flex;');
    expect(actions).toContain('flex-wrap: wrap;');
    expect(actions).toContain('align-self: start;');
    expect(actions).toContain('justify-self: start;');
    expect(actions).toContain('justify-content: flex-start;');
    expect(actions).toContain('padding-left: 0;');
    expect(actions).toContain('row-gap: 8px;');
    expect(actions).not.toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(actionButtons).toContain('flex: 0 1 auto;');
    expect(actionButtons).toContain('width: auto;');
    expect(actionButtons).toContain('min-width: 116px;');
    expect(actionButtons).toContain('white-space: nowrap;');
    expect(versionAction).toContain('grid-column: 2;');
    expect(source).not.toMatch(/\.cf-builder-review-actions \{[\s\S]*?padding-left: 38px/u);
  });

  it('keeps conversation activity in normal layout flow above review and changes', () => {
    const source = styles();
    const activityPanel = styleBlock(source, '.cf-builder-activity-panel');
    const activityToolbar = styleBlock(source, '.cf-builder-activity-toolbar');
    const activityBody = styleBlock(source, '.cf-builder-activity-body-wrap');
    const activityList = styleBlock(source, '.cf-builder-activity-list');
    const activityItem = styleBlock(source, '.cf-builder-activity-item');
    const activityContent = styleBlock(source, '.cf-builder-activity-content');

    expect(activityPanel).toContain('display: grid;');
    expect(activityPanel).toContain('position: relative;');
    expect(activityPanel).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(activityPanel).toContain('grid-template-rows: auto auto;');
    expect(activityPanel).toContain('isolation: isolate;');
    expect(activityToolbar).toContain('display: flex;');
    expect(activityToolbar).toContain('min-height: 0;');
    expect(activityToolbar).toContain('margin-bottom: 6px;');
    expect(activityToolbar).not.toContain('position: absolute;');
    expect(activityToolbar).not.toContain('min-height: 32px;');
    expect(activityBody).toContain('display: grid;');
    expect(activityBody).toContain('align-content: start;');
    expect(activityBody).toContain('gap: 8px;');
    expect(activityBody).toContain('overflow: visible;');
    expect(activityBody).toContain('padding: 0;');
    expect(activityList).toContain('display: flex;');
    expect(activityList).toContain('position: relative;');
    expect(activityList).toContain('flex-direction: column;');
    expect(activityList).toContain('margin: 0;');
    expect(activityList).toContain('padding: 0;');
    expect(activityList).toContain('list-style: none;');
    expect(activityItem).toContain('position: relative;');
    expect(activityContent).toContain('display: grid;');
    expect(activityContent).toContain('min-width: 0;');
  });

  it('keeps the result flow unframed so preview is not nested inside another card', () => {
    const source = styles();
    const result = styleBlock(source, '.cf-builder-result-card');
    const toolbar = styleBlock(source, '.cf-builder-result-toolbar');
    const body = styleBlock(source, '.cf-builder-result-card .cf-builder-flow-card-body');
    const previewFrame = styleBlock(source, '.cf-builder-static-preview .cf-builder-preview-frame');

    expect(result).toContain('border: 0;');
    expect(result).toContain('border-radius: 0;');
    expect(result).toContain('overflow: visible;');
    expect(toolbar).toContain('border-bottom: 0;');
    expect(toolbar).toContain('background: transparent;');
    expect(body).toContain('padding: 0;');
    expect(previewFrame).toContain('min-height: clamp(260px, 34vh, 420px);');
    expect(previewFrame).not.toContain('48vh');
  });

  it('uses lightweight preview explanation instead of another nested card', () => {
    const source = styles();
    const runtimeNotice = styleBlock(source, '.cf-builder-preview-runtime-notice');
    const unavailable = styleBlock(source, '.cf-builder-preview-unavailable');

    expect(runtimeNotice).toContain('border-left: 3px solid var(--cf-warning-border);');
    expect(runtimeNotice).not.toContain('border: 1px solid var(--cf-warning-border);');
    expect(runtimeNotice).not.toContain('border-radius: 7px;');
    expect(unavailable).toContain('border-top: 1px solid var(--cf-border);');
    expect(unavailable).toContain('border-bottom: 1px solid var(--cf-border);');
    expect(unavailable).not.toContain('border-radius');
  });

  it('keeps the draft-gated composer as a lightweight status row', () => {
    const source = styles();
    const reviewGate = styleBlock(source, '.cf-builder-composer-review-gate');
    const reviewLink = styleBlock(source, '.cf-builder-composer-review-link');

    expect(reviewGate).toContain('display: flex;');
    expect(reviewGate).toContain('justify-content: space-between;');
    expect(reviewGate).toContain('color: var(--cf-text-muted);');
    expect(reviewGate).not.toContain('border:');
    expect(reviewGate).not.toContain('border-radius');
    expect(reviewLink).toContain('border: 0;');
    expect(reviewLink).toContain('background: transparent;');
    expect(reviewLink).toContain('color: var(--cf-primary-text);');
  });

  it('keeps the composer workspace chip tall enough for its two-line label', () => {
    const source = styles();
    const workspaceChip = styleBlock(source, '.cf-builder-workspace-chip');
    const workspaceCopy = styleBlock(source, '.cf-builder-workspace-chip-copy');
    const workspaceLabel = styleBlock(source, '.cf-builder-workspace-chip-label');
    const workspaceDetail = styleBlock(source, '.cf-builder-workspace-chip-detail');

    expect(workspaceChip).toContain('min-height: 40px;');
    expect(workspaceChip).toContain('padding: 3px 9px;');
    expect(workspaceCopy).toContain('display: grid;');
    expect(workspaceCopy).toContain('gap: 1px;');
    expect(workspaceLabel).toContain('white-space: nowrap;');
    expect(workspaceDetail).toContain('white-space: nowrap;');
    expect(workspaceDetail).toContain('line-height: 1.15;');
  });
});
