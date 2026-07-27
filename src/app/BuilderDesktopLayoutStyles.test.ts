import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const STYLES_PATH = join(process.cwd(), 'src', 'styles.css');

function styles(): string {
  return readFileSync(STYLES_PATH, 'utf8');
}

describe('Builder desktop layout styles', () => {
  it('keeps the review sidebar beside the conversation on desktop widths', () => {
    const source = styles();

    expect(source).toContain('.cf-builder-chat-shell {');
    expect(source).toContain('grid-template-columns: minmax(0, 1fr) minmax(210px, 236px);');
    expect(source).toContain(
      '.cf-builder-chat-shell[data-builder-review-sidebar-mode="expanded"]',
    );
    expect(source).toContain('grid-template-columns: minmax(0, 1fr) minmax(360px, 42vw);');
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
});
