'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodeHttp = require('node:http');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderLivePreviewAdmission,
} = require('../electron/builder-live-preview-run.cjs');
const {
  BUILDER_LIVE_PREVIEW_STATIC_SERVER_VERSION,
  BuilderLivePreviewStaticServerError,
  startBuilderLivePreviewStaticServer,
} = require('../electron/builder-live-preview-static-server.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = 'builder-conversation:22222222-2222-4222-8222-222222222222';
const TASK_ID = 'builder-task:33333333-3333-4333-8333-333333333333';
const RUN_ID = 'builder-run:44444444-4444-4444-8444-444444444444';
const DRAFT_CHECKPOINT_ID = `builder-draft-checkpoint:${'a'.repeat(64)}`;

function sourceTree(files = [
  {
    path: 'index.html',
    content: '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><canvas id="scene"></canvas><script type="module" src="/app.js"></script></body></html>\n',
  },
  { path: 'style.css', content: 'body { color: black; }\n' },
  { path: 'app.js', content: 'document.body.dataset.preview = "ready";\n' },
]) {
  return createBuilderProjectSourceTree({ files });
}

function admissionFor(tree, overrides = {}) {
  return createBuilderLivePreviewAdmission({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    draft_checkpoint_id: DRAFT_CHECKPOINT_ID,
    source_tree_digest: tree.source_tree_digest,
    selected_entry_path: 'index.html',
    preview_kind: 'live_static_web',
    admitted_at_ms: 1_000,
    expires_at_ms: 61_000,
    ...overrides,
  });
}

async function withServer(t, tree = sourceTree(), overrides = {}) {
  const server = await startBuilderLivePreviewStaticServer({
    admission: admissionFor(tree, overrides),
    source_tree: tree,
  });
  t.after(async () => {
    await server.stop();
  });
  return server;
}

async function responseText(response) {
  return response.text();
}

function rawStatus(origin, requestPath, method = 'GET') {
  const parsed = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = nodeHttp.request({
      host: parsed.hostname,
      method,
      path: requestPath,
      port: Number(parsed.port),
    }, (response) => {
      response.resume();
      response.on('end', () => resolve({
        allow: response.headers.allow ?? null,
        status: response.statusCode,
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

function assertServerError(fn, forbidden = []) {
  assert.rejects(fn, (error) => {
    assert.ok(error instanceof BuilderLivePreviewStaticServerError);
    assert.equal(error.code, 'builder_live_preview_static_server_invalid');
    const serialized = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    assert.doesNotMatch(serialized, /secret-value|Authorization|Bearer|api[_-]?key|file_content|source_tree/iu);
    return true;
  });
}

test('serves admitted static web source from loopback only', async (t) => {
  const server = await withServer(t);

  assert.equal(server.server_version, BUILDER_LIVE_PREVIEW_STATIC_SERVER_VERSION);
  assert.equal(server.project_id, PROJECT_ID);
  assert.match(server.preview_origin, /^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/u);
  assert.equal(server.entry_url, `${server.preview_origin}/index.html`);

  const html = await fetch(server.entry_url);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type') ?? '', /^text\/html; charset=utf-8$/u);
  assert.match(html.headers.get('content-security-policy') ?? '', /connect-src 'none'/u);
  assert.match(html.headers.get('x-content-type-options') ?? '', /nosniff/u);
  assert.match(await responseText(html), /<canvas id="scene">/u);

  const script = await fetch(`${server.preview_origin}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') ?? '', /^text\/javascript; charset=utf-8$/u);
  assert.match(await responseText(script), /dataset\.preview/u);

  const root = await fetch(`${server.preview_origin}/`);
  assert.equal(root.status, 200);
  assert.match(await responseText(root), /type="module"/u);
});

test('blocks traversal, dot-Git internals, missing files, and unsupported methods', async (t) => {
  const server = await withServer(t);

  const traversal = await rawStatus(server.preview_origin, '/safe/%2e%2e/index.html');
  assert.equal(traversal.status, 403);
  const encodedTraversal = await rawStatus(server.preview_origin, '/%2e%2e%2findex.html');
  assert.equal(encodedTraversal.status, 403);
  const dotGit = await rawStatus(server.preview_origin, '/.git/config');
  assert.equal(dotGit.status, 403);
  const missing = await fetch(`${server.preview_origin}/missing.js`);
  assert.equal(missing.status, 404);
  const method = await rawStatus(server.preview_origin, '/index.html', 'POST');
  assert.equal(method.status, 405);
  assert.equal(method.allow, 'GET, HEAD');
});

test('supports HEAD and stop without exposing a directory listing', async (t) => {
  const server = await withServer(t);

  const head = await fetch(server.entry_url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await responseText(head), '');

  const firstStop = await server.stop();
  assert.deepEqual(firstStop, { stopped: true, reason: 'closed' });
  const secondStop = await server.stop();
  assert.deepEqual(secondStop, { stopped: false, reason: 'already_stopped' });
});

test('fails closed when admission and source snapshot drift', async () => {
  const tree = sourceTree();
  const otherTree = sourceTree([
    { path: 'index.html', content: '<main>Different</main>\n' },
  ]);
  await assertServerError(() => startBuilderLivePreviewStaticServer({
    admission: admissionFor(tree),
    source_tree: otherTree,
  }));
  await assertServerError(() => startBuilderLivePreviewStaticServer({
    admission: admissionFor(tree, { selected_entry_path: 'missing.html' }),
    source_tree: tree,
  }));
});

test('rejects malformed requests, proxies, and accessors without leaking hostile values', async () => {
  const tree = sourceTree();
  await assertServerError(() => startBuilderLivePreviewStaticServer({
    admission: admissionFor(tree),
    source_tree: tree,
    renderer_authority: true,
  }));
  await assertServerError(() => startBuilderLivePreviewStaticServer(new Proxy({
    admission: admissionFor(tree),
    source_tree: tree,
  }, {})));
  const accessor = {};
  Object.defineProperty(accessor, 'admission', {
    enumerable: true,
    get() {
      throw new Error('secret-value');
    },
  });
  Object.defineProperty(accessor, 'source_tree', { enumerable: true, value: tree });
  await assertServerError(() => startBuilderLivePreviewStaticServer(accessor), ['secret-value']);
});

test('source remains a server-only preview runtime without Electron, IPC, provider, command, or mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-live-preview-static-server.cjs'),
    'utf8',
  );

  assert.match(source, /127\.0\.0\.1/u);
  assert.match(source, /connect-src 'none'/u);
  assert.match(source, /sanitizeBuilderProjectSourceTree/u);
  assert.match(source, /sanitizeBuilderLivePreviewAdmission/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|BrowserView|WebContentsView|session\.fromPartition|node:fs|child_process|spawn|execFile|builder-provider|builder-git-|safeStorage|credential|secret_ref|writeFile|mkdir|rm\(/iu,
  );
});
