'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PROJECT_SOURCE_ENTRY_KIND,
  BUILDER_PROJECT_SOURCE_TREE_VERSION,
  MAX_SOURCE_FILE_UTF8_BYTES,
  BuilderProjectSourceTreeError,
  createBuilderProjectSourceTree,
  digestBuilderProjectSourceTree,
  sanitizeBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

function expectInvalid(fn, forbidden = []) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderProjectSourceTreeError);
    assert.equal(error.code, 'builder_project_source_tree_invalid');
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

test('creates a canonical sorted multi-language UTF-8 source tree with layered digests', () => {
  const raw = {
    files: [
      { path: 'src/main.py', content: 'print("你好")\n' },
      { path: 'README.md', content: '# 工具\n' },
      {
        path: 'src/app.ts',
        content: 'const password = form.password.value;\nexport const emoji = "😀";\n',
      },
    ],
  };
  const tree = createBuilderProjectSourceTree(raw);

  assert.equal(tree.source_tree_version, BUILDER_PROJECT_SOURCE_TREE_VERSION);
  assert.deepEqual(tree.files.map((entry) => entry.path), [
    'README.md',
    'src/app.ts',
    'src/main.py',
  ]);
  assert.ok(tree.files.every((entry) => entry.entry_kind === BUILDER_PROJECT_SOURCE_ENTRY_KIND));
  assert.ok(tree.files.every((entry) => /^sha256:[0-9a-f]{64}$/u.test(entry.content_digest)));
  assert.equal(digestBuilderProjectSourceTree(tree), tree.source_tree_digest);
  assert.ok(Object.isFrozen(tree));
  assert.ok(Object.isFrozen(tree.files));
  assert.ok(tree.files.every(Object.isFrozen));
  raw.files[0].content = 'changed';
  assert.equal(tree.files[2].content, 'print("你好")\n');
});

test('sanitizes a source tree as a fresh all-or-nothing value and rejects digest drift', () => {
  const tree = createBuilderProjectSourceTree({
    files: [{ path: 'src/index.js', content: 'export function add(a, b) { return a + b; }\n' }],
  });
  const safe = sanitizeBuilderProjectSourceTree(structuredClone(tree));

  assert.deepEqual(safe, tree);
  assert.notEqual(safe, tree);
  assert.notEqual(safe.files, tree.files);
  assert.notEqual(safe.files[0], tree.files[0]);

  const badContent = structuredClone(tree);
  badContent.files[0].content += '// drift';
  expectInvalid(() => sanitizeBuilderProjectSourceTree(badContent));

  const badTreeDigest = structuredClone(tree);
  badTreeDigest.source_tree_digest = `sha256:${'0'.repeat(64)}`;
  expectInvalid(() => sanitizeBuilderProjectSourceTree(badTreeDigest));
});

test('rejects unsafe or non-portable project paths and folded duplicates', () => {
  const invalidPaths = [
    '',
    '/root.txt',
    'C:/root.txt',
    '\\\\server\\share.txt',
    'src\\main.js',
    './main.js',
    '../main.js',
    'src/../main.js',
    'src//main.js',
    'src/main.js/',
    'src/trailing. ',
    'src/foo:bar.ts',
    'src/foo?.ts',
    'src/foo*.ts',
    'src/foo|bar.ts',
    'CON',
    'aux.txt',
    'COM¹',
    'com².txt',
    'CoM³.log',
    'LPT¹',
    'lpt².txt',
    'LpT³.log',
    'src/\u202esecret.txt',
    `src/${'a'.repeat(121)}.js`,
  ];
  for (const unsafePath of invalidPaths) {
    expectInvalid(
      () => createBuilderProjectSourceTree({ files: [{ path: unsafePath, content: '' }] }),
      ['secret'],
    );
  }
  expectInvalid(() => createBuilderProjectSourceTree({
    files: [
      { path: 'src/App.js', content: 'one' },
      { path: 'src/app.js', content: 'two' },
    ],
  }));
  expectInvalid(() => createBuilderProjectSourceTree({
    files: [
      { path: 'src/Kelvin.js', content: 'one' },
      { path: 'src/Ｋelvin.js', content: 'two' },
    ],
  }));
  expectInvalid(() => createBuilderProjectSourceTree({
    files: [
      { path: 'src/straße.js', content: 'one' },
      { path: 'src/STRASSE.js', content: 'two' },
    ],
  }));
});

test('rejects sparse, proxy, accessor, symbol, and extra-key forgeries without invoking traps', () => {
  const sparse = new Array(1);
  expectInvalid(() => createBuilderProjectSourceTree({ files: sparse }));

  let trapCalls = 0;
  const proxy = new Proxy([{ path: 'a.txt', content: 'a' }], {
    ownKeys() {
      trapCalls += 1;
      return ['0', 'length'];
    },
  });
  expectInvalid(() => createBuilderProjectSourceTree({ files: proxy }));
  assert.equal(trapCalls, 0);

  const accessor = {};
  Object.defineProperty(accessor, 'path', { enumerable: true, get: () => 'a.txt' });
  Object.defineProperty(accessor, 'content', { enumerable: true, value: 'a' });
  expectInvalid(() => createBuilderProjectSourceTree({ files: [accessor] }));

  const symbolEntry = { path: 'a.txt', content: 'a' };
  symbolEntry[Symbol('hidden')] = 'hidden';
  expectInvalid(() => createBuilderProjectSourceTree({ files: [symbolEntry] }));

  expectInvalid(() => createBuilderProjectSourceTree({
    files: [{ path: 'a.txt', content: 'a', mode: 'executable' }],
  }));
});

test('rejects invalid Unicode, binary controls, resource excess, and high-confidence secrets', () => {
  const invalidContents = [
    '\ud800',
    'before\u0000after',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
    'const api_key = "abcdefghijklmnopqrstuvwx";',
    'API_KEY=abcdefghijklmnopqrstuvwx',
    'API_KEY="abcdefghijklmnopqrstuvwx"',
    'config.apiKey=abcdefghijklmnopqrstuvwx',
    'config.apiKey="abcdefghijklmnopqrstuvwx"',
    'process.env.API_KEY=abcdefghijklmnopqrstuvwx',
    'process.env.API_KEY="abcdefghijklmnopqrstuvwx"',
    'settings["api_key"]=abcdefghijklmnopqrstuvwx',
    'settings["api_key"]="abcdefghijklmnopqrstuvwx"',
    '-----BEGIN PRIVATE KEY-----\nmaterial',
    'const token = "sk-abcdefghijklmnopqrstuv";',
  ];
  for (const content of invalidContents) {
    expectInvalid(
      () => createBuilderProjectSourceTree({ files: [{ path: 'safe.txt', content }] }),
      ['abcdefghijkl', 'PRIVATE KEY'],
    );
  }
  expectInvalid(() => createBuilderProjectSourceTree({
    files: [{ path: 'large.txt', content: 'a'.repeat(MAX_SOURCE_FILE_UTF8_BYTES + 1) }],
  }));
  expectInvalid(() => createBuilderProjectSourceTree({
    files: Array.from({ length: 513 }, (_, index) => ({
      path: `files/${String(index).padStart(3, '0')}.txt`,
      content: '',
    })),
  }));
  expectInvalid(() => createBuilderProjectSourceTree({
    files: Array.from({ length: 9 }, (_, index) => ({
      path: `files/${index}.txt`,
      content: 'a'.repeat(MAX_SOURCE_FILE_UTF8_BYTES),
    })),
  }));
});

test('allows explicit placeholder credentials while preserving ordinary password field code', () => {
  const tree = createBuilderProjectSourceTree({
    files: [
      {
        path: '.env.example',
        content: 'API_KEY=replace-me-please\nACCESS_TOKEN="your-api-key-here"\n',
      },
      {
        path: 'src/form.ts',
        content: [
          'const password = form.password.value;',
          'const apiKey = "example-api-key";',
          'config.apiKey=replace-me-please;',
          'process.env.API_KEY="your-api-key-here";',
          'settings["api_key"]=placeholder;',
          '',
        ].join('\n'),
      },
    ],
  });
  assert.equal(tree.files.length, 2);
});

test('stays isolated from Electron, IPC, repository, provider, and legacy product authorities', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-project-source-tree.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /electron|ipcMain|ipcRenderer|preload|repository|provider|ChatCreatePage|Canvas|JobMeta|local-provider-executor/iu,
  );
  assert.match(source, /MAX_SOURCE_FILES/u);
  assert.match(source, /source_tree_digest/u);
  assert.ok(
    source.indexOf('totalBytes += Buffer.byteLength') < source.indexOf('files.push(file)'),
  );
});
