import { describe, expect, it } from 'vitest';

import {
  BUILDER_CODE_PROJECT_PROMPT_VERSION,
  BUILDER_CODE_PROJECT_PROMPT_VERSION_V1,
  BUILDER_PROJECT_CSS_MAX_UTF8_BYTES,
  BUILDER_PROJECT_HTML_MAX_UTF8_BYTES,
  BUILDER_PROJECT_JS_MAX_UTF8_BYTES,
  BuilderProjectError,
  createBuilderProjectRevision,
  digestBuilderProjectProposal,
  isTrustedBuilderProjectRevision,
  sanitizeBuilderProjectProposal,
  verifyBuilderProjectRevision,
  type BuilderCodeProjectPromptVersion,
  type BuilderProjectProposal,
} from './builderProject';

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const REQUEST_DIGEST = `sha256:${'2'.repeat(64)}`;

function proposal(overrides: Partial<BuilderProjectProposal> = {}): BuilderProjectProposal {
  return {
    kind: 'builder_code_project',
    title: 'Tiny focus timer',
    summary: 'A small focus timer with one clear action.',
    files: {
      'index.html': '<main><h1>Focus</h1><button id="start">Start</button></main>',
      'styles.css': 'main { max-width: 32rem; margin: 2rem auto; }',
      'app.js': 'document.querySelector("#start")?.addEventListener("click", () => {});',
    },
    ...overrides,
  };
}

async function evidenceFor(
  value: BuilderProjectProposal = proposal(),
  requestDigest = REQUEST_DIGEST,
  targetRevision = 1,
  parentRevision: { revision: number; revision_digest: string } | null = null,
  projectId = PROJECT_ID,
  promptVersion: BuilderCodeProjectPromptVersion = BUILDER_CODE_PROJECT_PROMPT_VERSION_V1,
) {
  return {
    authority: 'builder_code_project_generator' as const,
    prompt_version: promptVersion,
    request_version: 'builder-generation-request.v1' as const,
    result_version: 'builder-generation-result.v1' as const,
    request_digest: requestDigest,
    proposal_digest: await digestBuilderProjectProposal(value),
    project_id: projectId,
    target_revision: targetRevision,
    parent_revision: parentRevision,
  };
}

describe('builderProject', () => {
  it('sanitizes the exact three-file proposal into a fresh deeply frozen value', () => {
    const source = proposal({
      files: {
        'index.html': '<main>Hello</main>',
        'styles.css': 'main { color: teal; }',
        'app.js': '',
      },
    });

    const safe = sanitizeBuilderProjectProposal(source);

    expect(safe).toEqual(source);
    expect(safe).not.toBe(source);
    expect(safe.files).not.toBe(source.files);
    expect(Object.isFrozen(safe)).toBe(true);
    expect(Object.isFrozen(safe.files)).toBe(true);
  });

  it('keeps proposal content kind independent from generation wire protocols', () => {
    expect(sanitizeBuilderProjectProposal(proposal()).kind).toBe('builder_code_project');
    expect(() => sanitizeBuilderProjectProposal({
      ...proposal(),
      kind: 'builder-generation-result.v1',
    })).toThrow(BuilderProjectError);
  });

  it('rejects missing, extra, symbol, accessor, proxy, and sparse proposal surfaces', () => {
    const withExtra = { ...proposal(), project_id: PROJECT_ID };
    const withFileExtra = {
      ...proposal(),
      files: { ...proposal().files, 'notes.txt': 'hidden' },
    };
    const withSymbol = proposal() as BuilderProjectProposal & { [key: symbol]: string };
    withSymbol[Symbol('hidden')] = 'hidden-marker';
    let accessorRead = false;
    const withAccessor = proposal() as Record<string, unknown>;
    Object.defineProperty(withAccessor, 'hidden', {
      enumerable: true,
      get() {
        accessorRead = true;
        return 'hidden-marker';
      },
    });
    const hiddenSymbol = Symbol('hidden');
    const proxyTarget = { ...proposal(), [hiddenSymbol]: 'proxy-marker' };
    const proxy = new Proxy(proxyTarget, {
      ownKeys(target) {
        return Reflect.ownKeys(target).filter((key) => key !== hiddenSymbol);
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === hiddenSymbol) return undefined;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const sparseFiles: unknown[] = [];
    sparseFiles.length = 2;

    for (const invalid of [
      { kind: 'builder_code_project', title: 'Title', summary: 'Summary' },
      withExtra,
      withFileExtra,
      withSymbol,
      withAccessor,
      proxy,
      sparseFiles,
    ]) {
      expect(() => sanitizeBuilderProjectProposal(invalid)).toThrow(BuilderProjectError);
    }
    expect(accessorRead).toBe(false);
  });

  it('rejects unsafe modules, credentials, local paths, URL credentials, controls, and lone surrogates', () => {
    const invalidFiles = [
      { ...proposal().files, 'app.js': 'import value from "./other.js";' },
      { ...proposal().files, 'app.js': 'export const value = 1;' },
      { ...proposal().files, 'app.js': 'const load = () => import("./other.js");' },
      { ...proposal().files, 'app.js': 'const api_key = "1234567890abcdef";' },
      { ...proposal().files, 'app.js': 'const config = {"apiKey":"1234567890abcdef"};' },
      { ...proposal().files, 'app.js': 'const headers = {"Authorization": "Bearer abcdefghijklmnopqrstuvwxyz"};' },
      { ...proposal().files, 'app.js': 'const password = "p@ssword123";' },
      { ...proposal().files, 'app.js': 'const headers = {"Authorization": "Basic YWxhZGRpbjpvcGVuc2VzYW1l"};' },
      { ...proposal().files, 'app.js': 'const AWS_SECRET_ACCESS_KEY = "abcdefghijklmnopqrstuvwxyz";' },
      { ...proposal().files, 'styles.css': '/* C:\\Users\\person\\secret.css */' },
      { ...proposal().files, 'styles.css': '/* /root/.ssh/id_rsa */' },
      { ...proposal().files, 'styles.css': '/* /run/secrets/provider-key */' },
      { ...proposal().files, 'index.html': '<a href="https://name:pass@example.com">open</a>' },
      { ...proposal().files, 'index.html': '<script type="module">import("./other.js")</script>' },
      { ...proposal().files, 'index.html': '<button onclick="alert(1)">Open</button>' },
      { ...proposal().files, 'index.html': '<iframe src="./frame.html"></iframe>' },
      { ...proposal().files, 'index.html': '<img src="https://example.com/image.png">' },
      { ...proposal().files, 'index.html': '<img src="./image.png">' },
      { ...proposal().files, 'index.html': '<img srcset="https://example.com/image.png 1x">' },
      { ...proposal().files, 'index.html': '<source srcset="./movie.mp4">' },
      { ...proposal().files, 'index.html': '<video src="./movie.mp4"></video>' },
      { ...proposal().files, 'index.html': '<audio src="./sound.mp3"></audio>' },
      { ...proposal().files, 'index.html': '<a href="#section" target="_blank">Open</a>' },
      { ...proposal().files, 'index.html': '<a ping="./track">Open</a>' },
      { ...proposal().files, 'index.html': '<form><button>Send</button></form>' },
      { ...proposal().files, 'index.html': '<template><script>alert(1)</script></template>' },
      { ...proposal().files, 'index.html': '<template><button onclick="alert(1)">Open</button></template>' },
      { ...proposal().files, 'index.html': '<template><img src="https://example.com/x.png"></template>' },
      { ...proposal().files, 'styles.css': '@import "theme.css";' },
      { ...proposal().files, 'styles.css': 'main { background: url("https://example.com/x.png"); }' },
      { ...proposal().files, 'styles.css': 'main { background: image-set("https://example.com/x.png" 1x); }' },
      { ...proposal().files, 'styles.css': '@font-face { font-family: remote; src: local(test); }' },
      { ...proposal().files, 'styles.css': 'main { background: u\\72 l(https://example.com/x.png); }' },
      { ...proposal().files, 'styles.css': '@im\\70 ort "theme.css";' },
      { ...proposal().files, 'styles.css': 'main { color: red; }</style><script>alert(1)</script>' },
      { ...proposal().files, 'index.html': '<main>bad\u0000value</main>' },
      { ...proposal().files, 'index.html': '<main>\ud800</main>' },
    ];

    for (const files of invalidFiles) {
      expect(() => sanitizeBuilderProjectProposal(proposal({ files }))).toThrow(BuilderProjectError);
    }
  });

  it('locks title, summary, per-file, and combined UTF-8 bounds', () => {
    expect(() => sanitizeBuilderProjectProposal(proposal({ title: 'x'.repeat(81) }))).toThrow();
    expect(() => sanitizeBuilderProjectProposal(proposal({ summary: 'x'.repeat(401) }))).toThrow();
    expect(() => sanitizeBuilderProjectProposal(proposal({
      files: { ...proposal().files, 'index.html': 'x'.repeat(BUILDER_PROJECT_HTML_MAX_UTF8_BYTES + 1) },
    }))).toThrow();
    expect(() => sanitizeBuilderProjectProposal(proposal({
      files: { ...proposal().files, 'styles.css': 'x'.repeat(BUILDER_PROJECT_CSS_MAX_UTF8_BYTES + 1) },
    }))).toThrow();
    expect(() => sanitizeBuilderProjectProposal(proposal({
      files: { ...proposal().files, 'app.js': 'x'.repeat(BUILDER_PROJECT_JS_MAX_UTF8_BYTES + 1) },
    }))).toThrow();
    expect(() => sanitizeBuilderProjectProposal(proposal({
      title: 'x'.repeat(80),
      summary: 'y'.repeat(400),
      files: {
        'index.html': 'h'.repeat(BUILDER_PROJECT_HTML_MAX_UTF8_BYTES),
        'styles.css': 'c'.repeat(BUILDER_PROJECT_CSS_MAX_UTF8_BYTES),
        'app.js': 'j'.repeat(BUILDER_PROJECT_JS_MAX_UTF8_BYTES),
      },
    }))).toThrow();
  });

  it('counts Unicode by code point while enforcing byte limits and rejecting unpaired surrogates', () => {
    const safe = sanitizeBuilderProjectProposal(proposal({ title: '😀'.repeat(80) }));
    expect(Array.from(safe.title)).toHaveLength(80);
    expect(() => sanitizeBuilderProjectProposal(proposal({ title: '😀'.repeat(81) }))).toThrow();
    expect(() => sanitizeBuilderProjectProposal(proposal({ summary: `bad\udfff` }))).toThrow();
    expect(() => sanitizeBuilderProjectProposal(proposal({ title: 'safe\u202eevil' }))).toThrow();
    expect(() => sanitizeBuilderProjectProposal(proposal({ summary: 'safe\u2066evil\u2069' }))).toThrow();
  });

  it('creates deterministic revision one evidence without trusting model identity', async () => {
    const value = proposal();
    const input = {
      projectId: PROJECT_ID,
      proposal: value,
      proposalEvidence: await evidenceFor(value),
      requestDigest: REQUEST_DIGEST,
    };

    const first = await createBuilderProjectRevision(input);
    const second = await createBuilderProjectRevision(input);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.project_id).toBe(PROJECT_ID);
    expect(first.revision).toBe(1);
    expect(first.parent_revision).toBeNull();
    expect(first.revision_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.execution_admission).toBe('not_evaluated');
    expect(first.preview_script_admission).toBe('not_authorized');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.files)).toBe(true);
    expect(Object.isFrozen(first.proposal_evidence)).toBe(true);
    expect(isTrustedBuilderProjectRevision(first)).toBe(true);
    expect(isTrustedBuilderProjectRevision({ ...first })).toBe(false);
  });

  it('preserves legacy v1 revisions while accepting current v2 evidence', async () => {
    const value = proposal();
    const legacy = await createBuilderProjectRevision({
      projectId: PROJECT_ID,
      proposal: value,
      proposalEvidence: await evidenceFor(value),
      requestDigest: REQUEST_DIGEST,
    });
    const reopenedLegacy = await verifyBuilderProjectRevision(structuredClone(legacy));
    expect(reopenedLegacy.proposal_evidence.prompt_version).toBe(BUILDER_CODE_PROJECT_PROMPT_VERSION_V1);
    expect(reopenedLegacy.revision_digest).toBe(legacy.revision_digest);

    const currentEvidence = await evidenceFor(
      value,
      REQUEST_DIGEST,
      1,
      null,
      PROJECT_ID,
      BUILDER_CODE_PROJECT_PROMPT_VERSION,
    );
    const current = await createBuilderProjectRevision({
      projectId: PROJECT_ID,
      proposal: value,
      proposalEvidence: currentEvidence,
      requestDigest: REQUEST_DIGEST,
    });
    expect(current.proposal_evidence.prompt_version).toBe(BUILDER_CODE_PROJECT_PROMPT_VERSION);

    const relabeledLegacy = structuredClone(legacy);
    relabeledLegacy.proposal_evidence.prompt_version = BUILDER_CODE_PROJECT_PROMPT_VERSION;
    await expect(verifyBuilderProjectRevision(relabeledLegacy)).rejects.toMatchObject({
      code: 'invalid_project_version',
    });
  });

  it('creates revision two only from an exact verified parent', async () => {
    const firstProposal = proposal();
    const first = await createBuilderProjectRevision({
      projectId: PROJECT_ID,
      proposal: firstProposal,
      proposalEvidence: await evidenceFor(firstProposal),
      requestDigest: REQUEST_DIGEST,
    });
    const secondProposal = proposal({
      title: 'Tiny break timer',
      summary: 'A revised timer with a visible break action.',
    });
    const second = await createBuilderProjectRevision({
      projectId: PROJECT_ID,
      proposal: secondProposal,
      proposalEvidence: await evidenceFor(
        secondProposal,
        REQUEST_DIGEST,
        2,
        { revision: first.revision, revision_digest: first.revision_digest },
        PROJECT_ID,
        BUILDER_CODE_PROJECT_PROMPT_VERSION,
      ),
      requestDigest: REQUEST_DIGEST,
      parent: first,
    });

    expect(second.revision).toBe(2);
    expect(second.parent_revision).toEqual({
      revision: first.revision,
      revision_digest: first.revision_digest,
    });
    expect(first.proposal_evidence.prompt_version).toBe(BUILDER_CODE_PROJECT_PROMPT_VERSION_V1);
    expect(second.proposal_evidence.prompt_version).toBe(BUILDER_CODE_PROJECT_PROMPT_VERSION);
    expect(second.revision_digest).not.toBe(first.revision_digest);
    const verified = await verifyBuilderProjectRevision(second);
    expect(verified).toEqual(second);
    expect(isTrustedBuilderProjectRevision(verified)).toBe(true);
    await expect(createBuilderProjectRevision({
      projectId: 'builder-project:22222222-2222-4222-8222-222222222222',
      proposal: secondProposal,
      proposalEvidence: await evidenceFor(
        secondProposal,
        REQUEST_DIGEST,
        2,
        { revision: first.revision, revision_digest: first.revision_digest },
        'builder-project:22222222-2222-4222-8222-222222222222',
      ),
      requestDigest: REQUEST_DIGEST,
      parent: first,
    })).rejects.toMatchObject({ code: 'invalid_project_version' });
  });

  it('requires evidence to cross-bind request, project, target revision, and parent revision', async () => {
    const value = proposal();
    const evidence = await evidenceFor(value);
    for (const [proposalEvidence, requestDigest] of [
      [evidence, `sha256:${'3'.repeat(64)}`],
      [{ ...evidence, request_version: 'other.v1' }, REQUEST_DIGEST],
      [{ ...evidence, result_version: 'other.v1' }, REQUEST_DIGEST],
      [{ ...evidence, prompt_version: 'builder-code-project.v3' }, REQUEST_DIGEST],
      [{ ...evidence, project_id: 'builder-project:22222222-2222-4222-8222-222222222222' }, REQUEST_DIGEST],
      [{ ...evidence, target_revision: 2 }, REQUEST_DIGEST],
      [{ ...evidence, parent_revision: { revision: 1, revision_digest: REQUEST_DIGEST } }, REQUEST_DIGEST],
    ] as const) {
      await expect(createBuilderProjectRevision({
        projectId: PROJECT_ID,
        proposal: value,
        proposalEvidence,
        requestDigest,
      })).rejects.toMatchObject({ code: 'invalid_generated_project' });
    }
  });

  it('rejects oversized primitive property surfaces before cloning them', () => {
    const wideFiles = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [`extra-${index}`, 'value']),
    );
    expect(() => sanitizeBuilderProjectProposal({ ...proposal(), files: wideFiles })).toThrow(
      BuilderProjectError,
    );
  });

  it('fails closed on parent, evidence, content, and digest drift', async () => {
    const value = proposal();
    const revision = await createBuilderProjectRevision({
      projectId: PROJECT_ID,
      proposal: value,
      proposalEvidence: await evidenceFor(value),
      requestDigest: REQUEST_DIGEST,
    });
    const tampered = structuredClone(revision);
    tampered.files['index.html'] = '<main>Tampered</main>';
    const evidenceDrift = structuredClone(revision);
    evidenceDrift.proposal_evidence.project_id = 'builder-project:22222222-2222-4222-8222-222222222222';
    const digestDrift = structuredClone(revision);
    digestDrift.revision_digest = `sha256:${'3'.repeat(64)}`;

    await expect(verifyBuilderProjectRevision(tampered)).rejects.toMatchObject({ code: 'invalid_project_version' });
    await expect(verifyBuilderProjectRevision(evidenceDrift)).rejects.toMatchObject({ code: 'invalid_project_version' });
    await expect(verifyBuilderProjectRevision(digestDrift)).rejects.toMatchObject({ code: 'invalid_project_version' });
  });

  it('returns fixed safe errors without reflecting unsafe input', () => {
    const marker = 'raw-provider-secret-marker';
    try {
      sanitizeBuilderProjectProposal({ ...proposal(), extra: marker });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BuilderProjectError);
      expect(JSON.stringify(error)).not.toContain(marker);
      expect((error as Error).message).not.toContain(marker);
      expect((error as Error).message).not.toMatch(/schema|runtime|provider|secret|path/i);
    }
  });
});
