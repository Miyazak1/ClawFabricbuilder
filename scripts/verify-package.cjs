'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const unpacked = path.join(root, 'release', 'win-unpacked');
const executable = path.join(unpacked, 'ClawFabric Builder.exe');
const archive = path.join(unpacked, 'resources', 'app.asar');
const builtIndex = path.join(root, 'dist', 'index.html');
const forbidden = /ChatCreatePage|chat_planner|CanvasPage|JobMeta|CurrentState|ResultRail|AppLayout|AuthProvider|clawfabricDesktop|desktop:builder|ClawFabric v5/iu;
const secretMaterial = /(?:real-key-value|private-settings-marker|private-secret-marker|Authorization:\s*Bearer|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|sk-[A-Za-z0-9_-]{16,}|api[_-]?key\s*[:=])/iu;

function readWindowsIdentity(executablePath) {
  const script = [
    '$info=(Get-Item -LiteralPath $env:BUILDER_VERIFY_EXE).VersionInfo',
    '$result=[ordered]@{CompanyName=$info.CompanyName;ProductName=$info.ProductName;FileDescription=$info.FileDescription}',
    '[Console]::Out.Write(($result | ConvertTo-Json -Compress))',
  ].join(';');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '',
      SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      BUILDER_VERIFY_EXE: executablePath,
    },
    windowsHide: true,
  });
  return JSON.parse(output);
}

assert.equal(process.platform, 'win32', 'Builder package verification currently targets Windows.');
for (const target of [executable, archive, builtIndex]) assert.equal(fs.existsSync(target), true, target);

const packagedEntries = asar.listPackage(archive).map((archivePath) => ({
  archivePath,
  normalizedPath: archivePath.replaceAll('\\', '/'),
}));
const packagedFiles = packagedEntries.map((entry) => entry.normalizedPath);
for (const expected of [
  '/electron/main.cjs',
  '/electron/preload.cjs',
  '/electron/runtime-options.cjs',
  '/electron/builder-project-revision-record.cjs',
  '/electron/builder-project-revision-repository.cjs',
  '/electron/builder-project-revision-ipc-adapter.cjs',
  '/electron/builder-project-catalog-ipc-adapter.cjs',
  '/electron/builder-project-ipc-runtime.cjs',
  '/electron/builder-provider-config.cjs',
  '/electron/builder-provider-config-repository.cjs',
  '/electron/builder-provider-secret-store.cjs',
  '/electron/builder-openai-compatible-transport.cjs',
  '/electron/builder-generation-kernel.cjs',
  '/electron/builder-generation-host-adapter.cjs',
]) {
  assert.equal(packagedFiles.includes(expected), true, expected);
}
assert.equal(packagedFiles.some((entry) => forbidden.test(entry)), false);
assert.equal(packagedFiles.some((entry) => /\.test\.(?:cjs|js|ts|tsx)$/u.test(entry)), false);
assert.equal(packagedFiles.some((entry) => entry.startsWith('/node_modules/')), false);
for (const entry of packagedEntries.filter(
  (value) => /\.(?:cjs|css|html|js|json)$/u.test(value.normalizedPath),
)) {
  const source = asar.extractFile(archive, entry.archivePath.slice(1)).toString('utf8');
  assert.doesNotMatch(source, forbidden, entry.normalizedPath);
  assert.doesNotMatch(source, secretMaterial, entry.normalizedPath);
  if (source.includes('safeStorage')) {
    assert.equal(entry.normalizedPath, '/electron/builder-provider-secret-store.cjs');
  }
}

function packagedSource(archivePath) {
  return asar.extractFile(archive, archivePath).toString('utf8');
}

const workspaceHtml = fs.readFileSync(builtIndex, 'utf8');
const packagedHtml = packagedSource('dist/index.html');
assert.equal(packagedHtml, workspaceHtml);
assert.match(packagedHtml, /connect-src 'none'/u);
assert.doesNotMatch(packagedHtml, /127\.0\.0\.1|localhost|ws:\/\//u);
assert.doesNotMatch(packagedHtml, /__BUILDER_CONNECT_SRC__/u);

const packagedMain = packagedSource('electron/main.cjs');
const packagedPreload = packagedSource('electron/preload.cjs');
const packagedRuntime = packagedSource('electron/builder-project-ipc-runtime.cjs');
const packagedRevisionAdapter = packagedSource('electron/builder-project-revision-ipc-adapter.cjs');
const packagedCatalogAdapter = packagedSource('electron/builder-project-catalog-ipc-adapter.cjs');
const packagedProviderConfigRepository = packagedSource('electron/builder-provider-config-repository.cjs');
const packagedProviderSecretStore = packagedSource('electron/builder-provider-secret-store.cjs');
const packagedGenerationHost = packagedSource('electron/builder-generation-host-adapter.cjs');
const channels = [
  'clawfabric-builder:project-revisions:commit',
  'clawfabric-builder:project-revisions:load-current',
  'clawfabric-builder:project-catalog:list-current',
];

function frozenObjectLiteral(node) {
  assert.equal(ts.isCallExpression(node), true);
  assert.equal(ts.isPropertyAccessExpression(node.expression), true);
  assert.equal(node.expression.expression.getText(), 'Object');
  assert.equal(node.expression.name.text, 'freeze');
  assert.equal(node.arguments.length, 1);
  assert.equal(ts.isObjectLiteralExpression(node.arguments[0]), true);
  return node.arguments[0];
}

function exactObjectKeys(object, expected) {
  const keys = object.properties.map((property) => {
    assert.equal(property.name !== undefined, true);
    assert.equal(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name), true);
    return property.name.text;
  });
  assert.deepEqual(keys, expected);
}

const preloadAst = ts.createSourceFile(
  'preload.cjs',
  packagedPreload,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const exposeCalls = [];
const rendererPropertyAccesses = [];
const forbiddenRendererReferences = [];
const preloadConstants = new Map();
function inspectPreload(node) {
  if (
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText(preloadAst) === 'contextBridge'
    && node.expression.name.text === 'exposeInMainWorld'
  ) exposeCalls.push(node);
  if (
    ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'ipcRenderer'
  ) rendererPropertyAccesses.push(node.name.text);
  if (ts.isElementAccessExpression(node) && node.expression.getText(preloadAst) === 'ipcRenderer') {
    forbiddenRendererReferences.push('element_access');
  }
  if (ts.isIdentifier(node) && node.text === 'ipcRenderer') {
    const parent = node.parent;
    const declaration = ts.isBindingElement(parent) && parent.name === node;
    const receiver = ts.isPropertyAccessExpression(parent) && parent.expression === node;
    if (!declaration && !receiver) forbiddenRendererReferences.push(parent.kind);
  }
  if (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.initializer
    && ts.isStringLiteral(node.initializer)
  ) preloadConstants.set(node.name.text, node.initializer.text);
  ts.forEachChild(node, inspectPreload);
}
inspectPreload(preloadAst);
assert.equal(exposeCalls.length, 1);
assert.equal(exposeCalls[0].arguments.length, 2);
assert.equal(exposeCalls[0].arguments[0].text, 'clawfabricBuilder');
const preloadRoot = frozenObjectLiteral(exposeCalls[0].arguments[1]);
exactObjectKeys(preloadRoot, ['bridgeVersion', 'projectRevisions', 'projectCatalog']);
const revisionProperty = preloadRoot.properties.find((property) => property.name.text === 'projectRevisions');
const catalogProperty = preloadRoot.properties.find((property) => property.name.text === 'projectCatalog');
assert.equal(ts.isPropertyAssignment(revisionProperty), true);
assert.equal(ts.isPropertyAssignment(catalogProperty), true);
const revisionBridge = frozenObjectLiteral(revisionProperty.initializer);
const catalogBridge = frozenObjectLiteral(catalogProperty.initializer);
exactObjectKeys(revisionBridge, ['commit', 'loadCurrent']);
exactObjectKeys(catalogBridge, ['listCurrent']);
assert.deepEqual(rendererPropertyAccesses, ['invoke', 'invoke', 'invoke']);
assert.deepEqual(forbiddenRendererReferences, []);
assert.doesNotMatch(packagedPreload, /provider|secret|settings|safeStorage/iu);

function exactInvokeMethod(object, methodName, channelName, expectedParameters) {
  const method = object.properties.find((property) => property.name.text === methodName);
  assert.equal(ts.isMethodDeclaration(method), true);
  assert.equal(method.parameters.length, expectedParameters.length);
  assert.deepEqual(method.parameters.map((parameter) => parameter.name.text), expectedParameters);
  assert.equal(method.body.statements.length, 1);
  const statement = method.body.statements[0];
  assert.equal(ts.isReturnStatement(statement), true);
  assert.equal(ts.isCallExpression(statement.expression), true);
  const call = statement.expression;
  assert.equal(ts.isPropertyAccessExpression(call.expression), true);
  assert.equal(call.expression.expression.getText(preloadAst), 'ipcRenderer');
  assert.equal(call.expression.name.text, 'invoke');
  assert.equal(call.arguments.length, expectedParameters.length + 1);
  assert.equal(call.arguments[0].getText(preloadAst), channelName);
  assert.deepEqual(
    call.arguments.slice(1).map((argument) => argument.getText(preloadAst)),
    expectedParameters,
  );
}

assert.equal(preloadConstants.get('COMMIT_CHANNEL'), channels[0]);
assert.equal(preloadConstants.get('LOAD_CURRENT_CHANNEL'), channels[1]);
assert.equal(preloadConstants.get('LIST_CURRENT_CHANNEL'), channels[2]);
exactInvokeMethod(revisionBridge, 'commit', 'COMMIT_CHANNEL', ['request']);
exactInvokeMethod(revisionBridge, 'loadCurrent', 'LOAD_CURRENT_CHANNEL', ['request']);
exactInvokeMethod(catalogBridge, 'listCurrent', 'LIST_CURRENT_CHANNEL', []);

assert.match(packagedMain, /require\(['"]\.\/builder-project-ipc-runtime\.cjs['"]\)/u);
assert.match(packagedMain, /projectIpcRuntime\.register\(\)/u);
assert.match(packagedMain, /requestSingleInstanceLock/u);
assert.match(packagedRuntime, /createBuilderProjectRevisionIpcAdapter/u);
assert.match(packagedRuntime, /createBuilderProjectCatalogIpcAdapter/u);
assert.doesNotMatch(packagedRuntime, /provider|secret|safeStorage/iu);
assert.match(packagedRuntime, /Object\.freeze\(\{\s*channel:\s*COMMIT_CHANNEL,\s*invoke:\s*revisionAdapter\.channels\.commit\.invoke,?\s*\}\)/u);
assert.match(packagedRuntime, /Object\.freeze\(\{\s*channel:\s*LOAD_CURRENT_CHANNEL,\s*invoke:\s*revisionAdapter\.channels\.loadCurrent\.invoke,?\s*\}\)/u);
assert.match(packagedRuntime, /Object\.freeze\(\{\s*channel:\s*LIST_CURRENT_CHANNEL,\s*invoke:\s*catalogAdapter\.channels\.listCurrent\.invoke,?\s*\}\)/u);
assert.match(packagedPreload, /exposeInMainWorld\(['"]clawfabricBuilder['"]/u);
assert.match(packagedPreload, /projectRevisions/u);
assert.match(packagedPreload, /projectCatalog/u);
assert.equal((packagedPreload.match(/ipcRenderer\.invoke/g) || []).length, 3);
assert.match(packagedProviderConfigRepository, /bind_current_authority/u);
assert.match(packagedProviderConfigRepository, /builder-provider-secret-store\.cjs/u);
assert.doesNotMatch(packagedProviderConfigRepository, /safeStorage|ipcMain|ipcRenderer|contextBridge|fetch\s*\(/u);
assert.match(packagedProviderSecretStore, /safeStorage/u);
assert.doesNotMatch(packagedProviderSecretStore, /ipcMain|ipcRenderer|contextBridge|fetch\s*\(/u);
assert.doesNotMatch(packagedGenerationHost, /safeStorage|builder-provider-secret-store|builder-provider-config-repository/u);
for (const channel of channels) {
  assert.equal(packagedPreload.includes(channel), true, channel);
  assert.equal(
    packagedRevisionAdapter.includes(channel) || packagedCatalogAdapter.includes(channel),
    true,
    channel,
  );
}

const packageJson = asar.extractFile(archive, 'package.json').toString('utf8');
assert.doesNotMatch(packageJson, forbidden);
const identity = readWindowsIdentity(executable);
assert.deepEqual(identity, {
  CompanyName: 'ClawFabric',
  ProductName: 'ClawFabric Builder',
  FileDescription: 'ClawFabric Builder',
});

process.stdout.write(`${JSON.stringify({
  ok: true,
  result_status: 'builder_package_verified',
  app_id: 'com.clawfabric.builder',
  product_name: identity.ProductName,
  company_name: identity.CompanyName,
  production_csp: 'network_denied',
  asar_entry_count: packagedFiles.length,
}, null, 2)}\n`);
