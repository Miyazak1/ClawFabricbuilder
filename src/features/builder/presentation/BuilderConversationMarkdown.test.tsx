import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BuilderConversationMarkdown } from './BuilderConversationMarkdown';

describe('BuilderConversationMarkdown', () => {
  it('renders structured markdown for plans and final responses', () => {
    const html = renderToStaticMarkup(
      <BuilderConversationMarkdown
        source={'## Update plan\n\n1. **Inspect files**\n   Read the current structure.\n\n- [x] Keep review read-only\n\n`npm test`'}
        variant="plan"
      />,
    );

    expect(html).toContain('<h2>Update plan</h2>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<strong>Inspect files</strong>');
    expect(html).toContain('disabled=""');
    expect(html).toContain('<code>npm test</code>');
    expect(html).toContain('data-builder-markdown-variant="plan"');
  });

  it('drops raw html and unsafe links without enabling active content', () => {
    const html = renderToStaticMarkup(
      <BuilderConversationMarkdown source={'<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![image](https://example.com/a.png)'} />,
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
    expect(html).toContain('unsafe');
  });

  it('uses a bounded plain-text fallback for oversized content', () => {
    const html = renderToStaticMarkup(
      <BuilderConversationMarkdown source={'a'.repeat(16_001)} />,
    );

    expect(html).toContain('data-builder-markdown-state="fallback"');
    expect(html).not.toContain('a'.repeat(16_001));
  });
});
