'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PROJECT_ADAPTER_ADMISSION_VERSION,
  STATIC_WEB_PREVIEW_ADAPTER_ID,
  BuilderProjectAdapterAdmissionError,
  evaluateBuilderProjectAdapterAdmission,
  sanitizeBuilderProjectAdapterAdmission,
} = require('../electron/builder-project-adapter-admission.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

function expectInvalid(fn, forbidden = []) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderProjectAdapterAdmissionError);
    assert.equal(error.code, 'builder_project_adapter_admission_invalid');
    const serialized = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    return true;
  });
}

function staticTree(overrides = {}) {
  return createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content: '<main><h1>Timer</h1><button id="start">Start</button></main>' },
      { path: 'styles.css', content: 'main { max-width: 32rem; margin: 2rem auto; }\n' },
      { path: 'app.js', content: 'fetch("/future-api");\n' },
    ],
    ...overrides,
  });
}

function evidenceDigest(value) {
  const body = {
    adapter_id: value.adapter_id,
    admission_version: value.admission_version,
    compatibility: value.compatibility,
    execution_admission: value.execution_admission,
    preview_admission: value.preview_admission,
    reason: value.reason,
    source_tree_digest: value.source_tree_digest,
  };
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  return `sha256:${nodeCrypto.createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

test('keeps an unselected adapter separate from the ability to save a general source tree', () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [
      { path: 'package.json', content: '{"scripts":{"start":"node src/server.js"}}\n' },
      { path: 'src/server.js', content: 'export function start() { return "ready"; }\n' },
      { path: 'src/tool.py', content: 'print("saved")\n' },
    ],
  });
  const admission = evaluateBuilderProjectAdapterAdmission({
    source_tree: sourceTree,
    adapter_id: null,
  });

  assert.deepEqual(admission, {
    admission_version: BUILDER_PROJECT_ADAPTER_ADMISSION_VERSION,
    source_tree_digest: sourceTree.source_tree_digest,
    adapter_id: null,
    compatibility: 'unsupported',
    preview_admission: 'not_eligible',
    execution_admission: 'not_evaluated',
    reason: 'adapter_not_selected',
    evidence_digest: admission.evidence_digest,
  });
  assert.match(admission.evidence_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(Object.isFrozen(admission));
  assert.equal(sourceTree.files.length, 3);
});

test('admits a bounded static web preview without authorizing JavaScript execution', () => {
  const sourceTree = staticTree();
  const admission = evaluateBuilderProjectAdapterAdmission({
    source_tree: sourceTree,
    adapter_id: STATIC_WEB_PREVIEW_ADAPTER_ID,
  });

  assert.equal(admission.adapter_id, STATIC_WEB_PREVIEW_ADAPTER_ID);
  assert.equal(admission.compatibility, 'supported');
  assert.equal(admission.preview_admission, 'eligible');
  assert.equal(admission.execution_admission, 'not_evaluated');
  assert.equal(admission.reason, 'static_web_source_supported');
  assert.equal(admission.source_tree_digest, sourceTree.source_tree_digest);
});

test('marks unsupported source shapes as not eligible while preserving the source fact', () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [
      { path: 'src/App.tsx', content: 'export function App() { return null; }\n' },
      { path: 'vite.config.ts', content: 'export default {};\n' },
    ],
  });
  const admission = evaluateBuilderProjectAdapterAdmission({
    source_tree: sourceTree,
    adapter_id: STATIC_WEB_PREVIEW_ADAPTER_ID,
  });

  assert.equal(admission.compatibility, 'unsupported');
  assert.equal(admission.preview_admission, 'not_eligible');
  assert.equal(admission.execution_admission, 'not_evaluated');
  assert.equal(admission.reason, 'source_shape_not_supported');
  assert.equal(admission.source_tree_digest, sourceTree.source_tree_digest);
});

test('rejects active HTML and external CSS from static preview eligibility only', () => {
  const unsafeFiles = [
    [{ path: 'index.html', content: '<script>alert(1)</script>' }],
    [{ path: 'index.html', content: '<button onclick="run()">Run</button>' }],
    [{ path: 'index.html', content: '<a href="https://example.com">Open</a>' }],
    [{ path: 'index.html', content: '<main style="color:red">Unsafe</main>' }],
    [{ path: 'index.html', content: '<style>@import url(https://example.com/a.css)</style>' }],
    [
      { path: 'index.html', content: '<main>Safe</main>' },
      { path: 'styles.css', content: 'main { background: url("https://example.com/a.png"); }' },
    ],
    [
      { path: 'index.html', content: '<main>Safe</main>' },
      { path: 'styles.css', content: '@import "https://example.com/a.css";' },
    ],
    [
      { path: 'index.html', content: '<main>Safe</main>' },
      { path: 'styles.css', content: 'main { background: u\\72l(https://example.com/a.png); }' },
    ],
    [
      { path: 'index.html', content: '<main>Safe</main>' },
      { path: 'styles.css', content: 'main { color: red; /* u */ }' },
    ],
  ];
  for (const files of unsafeFiles) {
    const sourceTree = createBuilderProjectSourceTree({ files });
    const admission = evaluateBuilderProjectAdapterAdmission({
      source_tree: sourceTree,
      adapter_id: STATIC_WEB_PREVIEW_ADAPTER_ID,
    });
    assert.equal(admission.compatibility, 'unsupported');
    assert.equal(admission.preview_admission, 'not_eligible');
    assert.equal(admission.execution_admission, 'not_evaluated');
    assert.equal(admission.reason, 'preview_contract_rejected');
  }
});

test('sanitizes admission evidence and fails closed on forged facts or unknown adapters', () => {
  const sourceTree = staticTree();
  const admission = evaluateBuilderProjectAdapterAdmission({
    source_tree: sourceTree,
    adapter_id: STATIC_WEB_PREVIEW_ADAPTER_ID,
  });
  const safe = sanitizeBuilderProjectAdapterAdmission({
    source_tree: structuredClone(sourceTree),
    admission: structuredClone(admission),
  });
  assert.deepEqual(safe, admission);
  assert.notEqual(safe, admission);

  const executionForgery = { ...admission, execution_admission: 'authorized' };
  expectInvalid(() => sanitizeBuilderProjectAdapterAdmission({
    source_tree: sourceTree,
    admission: executionForgery,
  }));

  const digestForgery = { ...admission, evidence_digest: `sha256:${'0'.repeat(64)}` };
  expectInvalid(() => sanitizeBuilderProjectAdapterAdmission({
    source_tree: sourceTree,
    admission: digestForgery,
  }));

  const pythonTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/main.py', content: 'print("hello")\n' }],
  });
  const selfSignedForgery = {
    ...admission,
    source_tree_digest: pythonTree.source_tree_digest,
  };
  selfSignedForgery.evidence_digest = evidenceDigest(selfSignedForgery);
  expectInvalid(() => sanitizeBuilderProjectAdapterAdmission({
    source_tree: pythonTree,
    admission: selfSignedForgery,
  }));

  expectInvalid(() => sanitizeBuilderProjectAdapterAdmission({
    source_tree: pythonTree,
    admission,
  }));

  expectInvalid(() => evaluateBuilderProjectAdapterAdmission({
    source_tree: sourceTree,
    adapter_id: 'python_runtime.v1',
  }));

  const proxy = new Proxy({
    source_tree: sourceTree,
    adapter_id: null,
  }, {
    ownKeys() {
      throw new Error('trap must not execute');
    },
  });
  expectInvalid(() => evaluateBuilderProjectAdapterAdmission(proxy), ['trap must not execute']);
});

test('stays pure and does not import execution, IPC, repository, provider, or legacy authorities', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-project-adapter-admission.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|preload|repository|provider|fetch\s*\(|spawn\s*\(|exec\s*\(|ChatCreatePage|Canvas|JobMeta|local-provider-executor/iu,
  );
  assert.match(source, /execution_admission: 'not_evaluated'/u);
  assert.match(source, /preview_admission/u);
  assert.match(source, /INLINE_STYLE_ATTRIBUTE_PATTERN/u);
  assert.match(source, /canonicalJson\(supplied\) !== canonicalJson\(evaluated\)/u);
});
