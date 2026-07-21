import { describe, expect, it } from 'vitest';

import {
  BUILDER_CODE_GENERATOR_AUTHORITY,
  BUILDER_CODE_PROJECT_PROMPT_VERSION,
  BUILDER_GENERATION_REQUEST_PROTOCOL,
  BUILDER_GENERATION_RESULT_PROTOCOL,
  createBuilderProjectRevision,
  digestBuilderProjectProposal,
  type BuilderProjectProposal,
} from '../domain/builderProject';
import {
  BuilderStaticPreviewError,
  createBuilderStaticPreview,
  isTrustedBuilderStaticPreviewProjection,
} from './builderStaticPreview';

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;

function proposal(): BuilderProjectProposal {
  return {
    kind: 'builder_code_project',
    title: 'Tiny counter',
    summary: 'A small counter interface.',
    files: {
      'index.html': '<main><h1>Counter</h1><button>Count</button></main>',
      'styles.css': 'body { color: #123; }',
      'app.js': 'globalThis.__builder_preview_script_marker__ = true;',
    },
  };
}

async function revision() {
  const candidate = proposal();
  return createBuilderProjectRevision({
    projectId: PROJECT_ID,
    proposal: candidate,
    requestDigest: REQUEST_DIGEST,
    proposalEvidence: {
      authority: BUILDER_CODE_GENERATOR_AUTHORITY,
      prompt_version: BUILDER_CODE_PROJECT_PROMPT_VERSION,
      request_version: BUILDER_GENERATION_REQUEST_PROTOCOL,
      result_version: BUILDER_GENERATION_RESULT_PROTOCOL,
      request_digest: REQUEST_DIGEST,
      proposal_digest: await digestBuilderProjectProposal(candidate),
      project_id: PROJECT_ID,
      target_revision: 1,
      parent_revision: null,
    },
  });
}

describe('Builder static preview projection', () => {
  it('builds a trusted frozen HTML and CSS preview without project JavaScript', async () => {
    const projection = await createBuilderStaticPreview(await revision());

    expect(projection).toMatchObject({
      version: 'builder-static-preview.v1',
      project_id: PROJECT_ID,
      revision: 1,
      title: 'Tiny counter',
      preview_script_admission: 'not_authorized',
    });
    expect(projection.src_doc).toContain('Content-Security-Policy');
    expect(projection.src_doc).toContain("script-src 'none'");
    expect(projection.src_doc).toContain('data-builder-project-styles="true"');
    expect(projection.src_doc).toContain('body { color: #123; }');
    expect(projection.src_doc).not.toContain('__builder_preview_script_marker__');
    expect(Object.isFrozen(projection)).toBe(true);
    expect(isTrustedBuilderStaticPreviewProjection(projection)).toBe(true);
  });

  it('rejects forged or changed revisions with a fixed error', async () => {
    const valid = await revision();
    const changed = { ...valid, title: 'Changed without a digest update' };

    await expect(createBuilderStaticPreview(changed)).rejects.toEqual(
      new BuilderStaticPreviewError(),
    );
    await expect(createBuilderStaticPreview({})).rejects.toMatchObject({
      code: 'preview_unavailable',
      message: 'The project preview is unavailable.',
    });
  });

  it('does not trust structurally similar projection objects', async () => {
    const projection = await createBuilderStaticPreview(await revision());
    expect(isTrustedBuilderStaticPreviewProjection({ ...projection })).toBe(false);
    expect(isTrustedBuilderStaticPreviewProjection(null)).toBe(false);
  });
});
