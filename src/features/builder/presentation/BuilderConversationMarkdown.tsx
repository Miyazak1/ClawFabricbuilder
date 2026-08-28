import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MAX_MARKDOWN_LENGTH = 16_000;
const MAX_MARKDOWN_LINES = 600;
const MAX_LIST_ITEMS = 200;
const MAX_TABLE_CELLS = 400;

const ALLOWED_ELEMENTS = Object.freeze([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]);

function isMarkdownWithinDisplayBounds(source: string): boolean {
  if (source.length > MAX_MARKDOWN_LENGTH) return false;
  const lines = source.split(/\r?\n/u);
  if (lines.length > MAX_MARKDOWN_LINES) return false;
  const listItems = lines.filter((line) => /^\s*(?:[-+*]|\d+[.)])\s+/u.test(line)).length;
  if (listItems > MAX_LIST_ITEMS) return false;
  const tableCells = lines.reduce((count, line) => count + (line.match(/\|/gu)?.length ?? 0), 0);
  return tableCells <= MAX_TABLE_CELLS;
}

function safeUrlTransform(url: string): string {
  if (/^(?:https?:|mailto:)/iu.test(url)) return defaultUrlTransform(url);
  return '';
}

function SafeLink({ children, href, ...props }: ComponentPropsWithoutRef<'a'>): ReactNode {
  if (typeof href !== 'string' || href.length === 0) return <span>{children}</span>;
  return (
    <a
      {...props}
      href={href}
      rel="noreferrer noopener"
      target="_blank"
    >
      {children}
    </a>
  );
}

function ReadOnlyTaskInput(props: ComponentPropsWithoutRef<'input'>): ReactNode {
  return <input {...props} checked={props.checked === true} disabled readOnly type="checkbox" />;
}

export function BuilderConversationMarkdown({
  source,
  variant = 'response',
}: Readonly<{
  source: string;
  variant?: 'plan' | 'response';
}>) {
  const withinBounds = isMarkdownWithinDisplayBounds(source);
  if (!withinBounds) {
    return (
      <p
        className="cf-builder-markdown-fallback"
        data-builder-conversation-markdown="true"
        data-builder-markdown-state="fallback"
        data-builder-markdown-variant={variant}
      >
        {source.slice(0, MAX_MARKDOWN_LENGTH)}
      </p>
    );
  }
  return (
    <div
      className="cf-builder-markdown"
      data-builder-conversation-markdown="true"
      data-builder-markdown-state="rendered"
      data-builder-markdown-variant={variant}
    >
      <Markdown
        allowedElements={ALLOWED_ELEMENTS}
        components={{ a: SafeLink, input: ReadOnlyTaskInput }}
        remarkPlugins={[remarkGfm]}
        skipHtml
        unwrapDisallowed
        urlTransform={safeUrlTransform}
      >
        {source}
      </Markdown>
    </div>
  );
}
