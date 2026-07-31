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

function styleBlockContaining(source: string, selector: string, expected: string): string {
  let start = source.indexOf(`${selector} {`);
  while (start >= 0) {
    const end = source.indexOf('\n}', start);
    const block = end < 0 ? source.slice(start) : source.slice(start, end + 2);
    if (block.includes(expected)) return block;
    start = source.indexOf(`${selector} {`, end < 0 ? source.length : end + 2);
  }
  return '';
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
    expect(workbenchFrame).toContain('border: 1px solid var(--cf-border);');
    expect(workbenchFrame).not.toContain('border-left: 0;');
    expect(workbenchFrame).toContain('border-radius: 8px 0 0 0;');
    expect(source).not.toContain('.cf-builder-workbench-frame::before');
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

  it('keeps the desktop artifact sidebar resizable without taking over the chat shell', () => {
    const source = styles();
    const sidebar = styleBlock(source, '.cf-builder-artifact-sidebar');
    const handle = styleBlock(source, '.cf-builder-artifact-resize-handle');

    expect(source).toContain('.cf-builder-chat-shell {');
    expect(source).toContain('grid-template-columns: minmax(0, 1fr) minmax(360px, var(--cf-builder-artifact-width, 480px));');
    expect(source).toContain('.cf-builder-chat-shell[data-builder-artifact-sidebar-visible="false"]');
    expect(sidebar).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(sidebar).toContain('overflow: hidden;');
    expect(sidebar).toContain('border-left: 1px solid var(--cf-border);');
    expect(handle).toContain('cursor: col-resize;');
    expect(handle).toContain('left: -5px;');
    expect(source).not.toContain(
      '.cf-builder-chat-shell[data-builder-review-sidebar-mode="expanded"]',
    );
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
      /@media \(min-width: 721px\) and \(max-width: 1160px\)[\s\S]*?\.cf-builder-chat-shell\[data-builder-artifact-sidebar-visible="false"\] \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\)/u,
    );
    expect(source).toMatch(
      /@media \(min-width: 721px\) and \(max-width: 1160px\)[\s\S]*?\.cf-builder-chat-main \{[\s\S]*?min-height: 0/u,
    );
    expect(source).toMatch(
      /@media \(min-width: 721px\) and \(max-width: 1160px\)[\s\S]*?\.cf-builder-artifact-sidebar \{[\s\S]*?border-top: 1px solid var\(--cf-border\)/u,
    );
    expect(source).not.toMatch(
      /@media \(max-width: 1160px\)[\s\S]*?\.cf-builder-chat-shell \{[\s\S]*?height: auto/u,
    );
    expect(source).not.toMatch(
      /@media \(max-width: 1160px\)[\s\S]*?\.cf-builder-chat-shell \{[\s\S]*?min-height: 680px/u,
    );
  });

  it('keeps chat artifact summaries compact while changes expand in the artifact drawer', () => {
    const source = styles();
    const draftLanding = styleBlock(source, '.cf-builder-draft-landing');
    const draftLandingSurfaces = styleBlock(source, '.cf-builder-draft-landing > .cf-builder-chat-flow-surface');
    const artifactSummary = styleBlock(source, '.cf-builder-artifact-summary');
    const artifactSummaryActions = styleBlock(source, '.cf-builder-artifact-summary-actions');
    const summaryRow = styleBlock(source, '.cf-builder-changes-summary-row');
    const summaryMain = styleBlock(source, '.cf-builder-changes-summary-main');
    const summaryText = styleBlock(source, '.cf-builder-changes-summary');
    const changesFlow = styleBlock(source, '.cf-builder-artifact-changes');
    const changesPanel = styleBlock(source, '.cf-builder-artifact-changes .cf-builder-changes-panel');
    const changesDisclosure = styleBlock(source, '.cf-builder-artifact-changes .cf-builder-changes-disclosure[open]');
    const artifactLogs = styleBlock(source, '.cf-builder-artifact-logs');
    const artifactLogsIntro = styleBlock(source, '.cf-builder-artifact-logs-intro');
    const artifactLogsList = styleBlock(source, '.cf-builder-artifact-logs-list');
    const artifactLogsContent = styleBlock(source, '.cf-builder-artifact-logs .cf-builder-activity-content');
    const summaryRowOverride = styleBlock(source, '.cf-builder-panel-toolbar.cf-builder-changes-summary-row');
    const changesBody = styleBlock(source, '.cf-builder-changes-body');
    const changesList = styleBlock(source, '.cf-builder-changes-list');
    const changeItem = styleBlock(source, '.cf-builder-change-item');
    const firstChangeItem = styleBlock(source, '.cf-builder-change-item:first-child');
    const changeDiff = styleBlock(source, '.cf-builder-change-diff');

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
    expect(artifactSummary).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(artifactSummary).toContain('align-items: start;');
    expect(artifactSummary).toContain('border-top: 1px solid var(--cf-border);');
    expect(artifactSummary).toContain('border-bottom: 1px solid var(--cf-border);');
    expect(artifactSummary).not.toContain('border-radius');
    expect(artifactSummaryActions).toContain('flex-wrap: wrap;');
    expect(artifactSummaryActions).toContain('justify-content: flex-start;');
    expect(artifactSummaryActions).toContain('padding-left: 38px;');
    expect(changesFlow).toContain('display: grid;');
    expect(changesFlow).toContain('overflow: hidden;');
    expect(changesPanel).toContain('height: 100%;');
    expect(changesPanel).toContain('border: 0;');
    expect(changesDisclosure).toContain('height: 100%;');
    expect(changesDisclosure).toContain('max-height: none;');
    expect(changesPanel).not.toContain('border-radius: 8px;');
    expect(changesPanel).not.toContain('box-shadow: var(--cf-shadow-sm);');
    expect(artifactLogs).toContain('height: 100%;');
    expect(artifactLogs).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(artifactLogs).toContain('overflow: hidden;');
    expect(artifactLogsIntro).toContain('border-bottom: 1px solid var(--cf-border);');
    expect(artifactLogsList).toContain('overflow: auto;');
    expect(artifactLogsContent).toContain('max-width: 100%;');
    expect(summaryRow).toContain('grid-template-columns: 20px minmax(0, 1fr);');
    expect(summaryRowOverride).toContain('display: grid;');
    expect(summaryRowOverride).toContain('grid-template-columns: 20px minmax(0, 1fr);');
    expect(summaryRowOverride).toContain('background: transparent;');
    expect(summaryRowOverride).toContain('padding: 0 0 8px;');
    expect(summaryMain).toContain('display: grid;');
    expect(summaryText).toContain('overflow: hidden;');
    expect(summaryText).toContain('text-overflow: ellipsis;');
    expect(summaryText).toContain('white-space: nowrap;');
    expect(summaryText).not.toContain('overflow-wrap: anywhere;');
    expect(changesBody).toContain('gap: 0;');
    expect(changesBody).toContain('padding: 12px 0 2px;');
    expect(changesList).toContain('gap: 0;');
    expect(changeItem).toContain('grid-template-columns: 72px minmax(0, 1fr);');
    expect(changeItem).toContain('border-top: 1px solid color-mix(in srgb, var(--cf-border) 72%, transparent);');
    expect(changeItem).toContain('border-radius: 0;');
    expect(changeItem).toContain('background: transparent;');
    expect(changeItem).not.toContain('border: 1px solid var(--cf-border);');
    expect(changeItem).not.toContain('background: var(--cf-surface-muted);');
    expect(firstChangeItem).toContain('border-top: 0;');
    expect(changeDiff).toContain('border-top: 1px solid color-mix(in srgb, var(--cf-border) 72%, transparent);');
    expect(changeDiff).toContain('border-bottom: 1px solid color-mix(in srgb, var(--cf-border) 72%, transparent);');
    expect(changeDiff).toContain('border-radius: 0;');
    expect(changeDiff).not.toContain('border: 1px solid var(--cf-border);');
    expect(changeDiff).not.toContain('border-radius: 7px;');
  });

  it('keeps restart-restored workspace catalog entries compact in the sidebar', () => {
    const source = styles();
    const workspaceCatalog = styleBlock(source, '.cf-builder-workspace-catalog');
    const sectionLabel = styleBlock(source, '.cf-builder-catalog-section-label');

    expect(workspaceCatalog).toContain('display: grid;');
    expect(workspaceCatalog).toContain('gap: 6px;');
    expect(workspaceCatalog).toContain('padding-top: 12px;');
    expect(sectionLabel).toContain('font-size: 11px;');
    expect(sectionLabel).toContain('text-transform: uppercase;');
    expect(sectionLabel).not.toContain('border:');
    expect(workspaceCatalog).not.toContain('border:');
  });

  it('keeps composer project picker groups as labels instead of extra framed panels', () => {
    const source = styles();
    const sectionLabel = styleBlock(source, '.cf-builder-workspace-picker-section-label');

    expect(sectionLabel).toContain('font-size: 10px;');
    expect(sectionLabel).toContain('letter-spacing: 0;');
    expect(sectionLabel).toContain('text-transform: uppercase;');
    expect(sectionLabel).not.toContain('border:');
    expect(sectionLabel).not.toContain('border-radius');
    expect(sectionLabel).not.toContain('box-shadow');
  });

  it('keeps draft review actions stable as a desktop conversation checkpoint', () => {
    const source = styles();
    const review = styleBlock(source, '.cf-builder-review-checkpoint');
    const copy = styleBlock(source, '.cf-builder-review-copy');
    const copyBody = styleBlock(source, '.cf-builder-review-copy-body');
    const actions = styleBlock(source, '.cf-builder-review-actions');
    const actionButtons = styleBlock(source, '.cf-builder-review-actions > button');
    const saveAction = styleBlock(source, '.cf-builder-review-actions > [data-builder-save-version="true"]');
    const versionAction = styleBlock(source, '.cf-builder-version-item > button');

    expect(review).toContain('position: relative;');
    expect(review).toContain('z-index: 2;');
    expect(review).toContain('box-sizing: border-box;');
    expect(review).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(review).toContain('align-items: start;');
    expect(review).toContain('align-content: start;');
    expect(review).toContain('row-gap: 12px;');
    expect(review).toContain('border-top: 1px solid var(--cf-border);');
    expect(review).toContain('border-bottom: 1px solid var(--cf-border);');
    expect(review).toContain('background: var(--cf-bg);');
    expect(review).toContain('isolation: isolate;');
    expect(review).toContain('margin-block: 6px 2px;');
    expect(review).toContain('overflow: hidden;');
    expect(review).toContain('padding: 14px;');
    expect(review).not.toContain('border-radius: 8px;');
    expect(review).not.toContain('minmax(320px, 360px)');
    expect(copy).toContain('align-items: start;');
    expect(copy).toContain('max-width: 100%;');
    expect(copyBody).toContain('display: grid;');
    expect(copyBody).toContain('min-width: 0;');
    expect(copyBody).toContain('gap: 2px;');
    expect(actions).toContain('display: flex;');
    expect(actions).toContain('flex-wrap: wrap;');
    expect(actions).toContain('width: 100%;');
    expect(actions).toContain('max-width: 100%;');
    expect(actions).toContain('align-self: stretch;');
    expect(actions).toContain('justify-self: stretch;');
    expect(actions).toContain('justify-content: flex-end;');
    expect(actions).toContain('border-top: 1px solid color-mix(in srgb, var(--cf-border) 72%, transparent);');
    expect(actions).toContain('padding-top: 10px;');
    expect(actions).toContain('padding-left: 0;');
    expect(actions).toContain('row-gap: 8px;');
    expect(actions).not.toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(actionButtons).toContain('flex: 0 1 auto;');
    expect(actionButtons).toContain('width: auto;');
    expect(actionButtons).toContain('min-height: 32px;');
    expect(actionButtons).toContain('min-width: 116px;');
    expect(actionButtons).toContain('white-space: nowrap;');
    expect(saveAction).toContain('min-width: 132px;');
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

  it('gives artifact preview an independent desktop viewing height', () => {
    const source = styles();
    const previewCard = styleBlock(source, '.cf-builder-artifact-preview-card');
    const previewBody = styleBlock(source, '.cf-builder-artifact-preview-card .cf-builder-flow-card-body');
    const previewFrame = styleBlock(source, '.cf-builder-artifact-preview-card .cf-builder-preview-frame');

    expect(previewCard).toContain('height: 100%;');
    expect(previewCard).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(previewBody).toContain('overflow: auto;');
    expect(previewFrame).toContain('min-height: clamp(420px, calc(100vh - 220px), 760px);');
    expect(source).not.toContain('.cf-builder-draft-landing .cf-builder-static-preview .cf-builder-preview-frame');
  });

  it('gives expanded preview a fixed desktop workspace outside chat and artifact columns', () => {
    const source = styles();
    const backdrop = styleBlock(source, '.cf-builder-preview-expanded-backdrop');
    const shell = styleBlock(source, '.cf-builder-preview-expanded-shell');
    const body = styleBlock(source, '.cf-builder-preview-expanded-body');
    const card = styleBlock(source, '.cf-builder-expanded-preview-card');
    const cardBody = styleBlock(source, '.cf-builder-expanded-preview-card .cf-builder-flow-card-body');
    const frame = styleBlock(source, '.cf-builder-expanded-preview-card .cf-builder-preview-frame');

    expect(backdrop).toContain('position: fixed;');
    expect(backdrop).toContain('z-index: 40;');
    expect(backdrop).toContain('inset: 44px 0 0;');
    expect(shell).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(shell).toContain('overflow: hidden;');
    expect(body).toContain('overflow: hidden;');
    expect(card).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(cardBody).toContain('overflow: auto;');
    expect(frame).toContain('min-height: calc(100vh - 190px);');
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

  it('keeps source code disclosure lightweight instead of a competing artifact card', () => {
    const source = styles();
    const disclosure = styleBlockContaining(source, '.cf-builder-source-disclosure', 'display: block;');
    const disclosureOpen = styleBlock(source, '.cf-builder-source-disclosure[open]');
    const summary = styleBlock(source, '.cf-builder-source-summary');
    const summaryControl = styleBlock(source, '.cf-builder-source-summary::after');
    const body = styleBlockContaining(source, '.cf-builder-source-body', 'border-top: 1px solid var(--cf-border);');
    const artifactDisclosure = styleBlock(source, '.cf-builder-artifact-source-disclosure');
    const artifactBody = styleBlock(source, '.cf-builder-artifact-source-disclosure .cf-builder-source-body');

    expect(disclosure).toContain('border-top: 1px solid var(--cf-border);');
    expect(disclosure).toContain('border-bottom: 1px solid var(--cf-border);');
    expect(disclosure).toContain('background: transparent;');
    expect(disclosure).not.toContain('border: 1px solid var(--cf-border);');
    expect(disclosure).not.toContain('border-radius');
    expect(disclosureOpen).toContain('background: transparent;');
    expect(summary).toContain('min-height: 36px;');
    expect(summary).toContain('padding: 0 2px;');
    expect(summaryControl).not.toContain('border:');
    expect(summaryControl).not.toContain('border-radius');
    expect(body).toContain('border-top: 1px solid var(--cf-border);');
    expect(body).toContain('padding: 10px 0 0;');
    expect(artifactDisclosure).toContain('height: 100%;');
    expect(artifactDisclosure).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(artifactBody).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(artifactBody).toContain('overflow: hidden;');
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
