import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  BUILDER_CODE_GENERATOR_AUTHORITY,
  BUILDER_CODE_PROJECT_PROMPT_VERSION,
  BUILDER_GENERATION_REQUEST_PROTOCOL,
  BUILDER_GENERATION_RESULT_PROTOCOL,
  createBuilderProjectRevision,
  digestBuilderProjectProposal,
  type BuilderProjectProposal,
} from '../domain/builderProject';
import { createBuilderStaticPreview } from '../preview/builderStaticPreview';
import { BuilderStaticPreview } from './BuilderStaticPreview';

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const REQUEST_DIGEST = `sha256:${'2'.repeat(64)}`;
const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function render(element: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  act(() => root.render(element));
  return container;
}

async function projection() {
  const proposal: BuilderProjectProposal = {
    kind: 'builder_code_project',
    title: 'Color picker',
    summary: 'A small color picker.',
    files: {
      'index.html': '<main><h1>Pick a color</h1></main>',
      'styles.css': 'h1 { color: rebeccapurple; }',
      'app.js': 'throw new Error("must not run");',
    },
  };
  const revision = await createBuilderProjectRevision({
    projectId: PROJECT_ID,
    proposal,
    requestDigest: REQUEST_DIGEST,
    proposalEvidence: {
      authority: BUILDER_CODE_GENERATOR_AUTHORITY,
      prompt_version: BUILDER_CODE_PROJECT_PROMPT_VERSION,
      request_version: BUILDER_GENERATION_REQUEST_PROTOCOL,
      result_version: BUILDER_GENERATION_RESULT_PROTOCOL,
      request_digest: REQUEST_DIGEST,
      proposal_digest: await digestBuilderProjectProposal(proposal),
      project_id: PROJECT_ID,
      target_revision: 1,
      parent_revision: null,
    },
  });
  return createBuilderStaticPreview(revision);
}

describe('BuilderStaticPreview', () => {
  it('renders only a sandboxed static document from a trusted projection', async () => {
    const container = render(<BuilderStaticPreview projection={await projection()} />);

    expect(container.querySelector('h2')?.textContent).toBe('Color picker');
    expect(container.textContent).toContain('Version 1');
    const frame = container.querySelector<HTMLIFrameElement>('iframe[title="Color picker preview"]');
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.hasAttribute('allow')).toBe(false);
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame?.getAttribute('srcdoc')).toContain("script-src 'none'");
    expect(frame?.getAttribute('srcdoc')).not.toContain('must not run');
  });

  it('fails closed for typed projection forgeries', () => {
    const container = render(<BuilderStaticPreview projection={{
      version: 'builder-static-preview.v1',
      title: 'Forged',
      revision: 1,
      src_doc: '<script>alert(1)</script>',
    }} />);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Preview unavailable.');
    expect(container.querySelector('iframe')).toBeNull();
  });
});
