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
const unpackedArchive = path.join(unpacked, 'resources', 'app.asar.unpacked');
const builtIndex = path.join(root, 'dist', 'index.html');
const workspacePackageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const forbidden = /ChatCreatePage|chat_planner|CanvasPage|JobMeta|CurrentState|ResultRail|AppLayout|AuthProvider|clawfabricDesktop|desktop:builder|ClawFabric v5/iu;
const secretMaterial = /(?:real-key-value|private-settings-marker|private-secret-marker|Authorization:\s*Bearer|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|\bsk-[A-Za-z0-9_-]{16,})/iu;
const apiKeyLiteralAssignment = /["'`]?api(?:[_-]?key|Key)["'`]?\s*[:=]\s*(["'])(?=[^"'`\r\n]{16,}\1)[^"'`\r\n]+\1/iu;

assert.equal(secretMaterial.test('builder-task-stream-projection.cjs'), false);
assert.equal(secretMaterial.test(`sk-${'a'.repeat(24)}`), true);
assert.equal(apiKeyLiteralAssignment.test('apiKey:'), false);
assert.equal(apiKeyLiteralAssignment.test('apiKey: value'), false);
assert.equal(apiKeyLiteralAssignment.test("apiKey: 'abcdefghijklmnopqrstuvwx'"), true);
assert.equal(apiKeyLiteralAssignment.test('api_key="abcdefghijklmnopqrstuvwx"'), true);

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
  '/electron/builder-git-command-runner.cjs',
  '/electron/builder-git-receipt-contract.cjs',
  '/electron/builder-git-project-repository.cjs',
  '/electron/builder-git-current-projection.cjs',
  '/electron/builder-conversation-authority-contract.cjs',
  '/electron/builder-conversation-records.cjs',
  '/electron/builder-conversation-replay.cjs',
  '/electron/builder-conversation-main-service.cjs',
  '/electron/builder-task-stream-projection.cjs',
  '/electron/builder-task-stream-ipc-adapter.cjs',
  '/electron/builder-product-metadata-schema.cjs',
  '/electron/builder-product-metadata-database.cjs',
  '/electron/builder-project-source-tree.cjs',
  '/electron/builder-project-read-authority.cjs',
  '/electron/builder-project-main-authority.cjs',
  '/electron/builder-project-save-authority.cjs',
  '/electron/builder-permission-authority-contract.cjs',
  '/electron/builder-project-workspace-ipc-adapter.cjs',
  '/electron/builder-provider-config.cjs',
  '/electron/builder-provider-config-repository.cjs',
  '/electron/builder-provider-secret-store.cjs',
  '/electron/builder-provider-settings-ipc-adapter.cjs',
  '/electron/builder-provider-settings-ipc-runtime.cjs',
  '/electron/builder-openai-compatible-transport.cjs',
  '/electron/builder-generation-kernel.cjs',
  '/electron/builder-generation-host-adapter.cjs',
  '/electron/builder-generation-ipc-adapter.cjs',
  '/electron/builder-generation-ipc-runtime.cjs',
  '/electron/builder-generation-main-service.cjs',
  '/electron/builder-window-controls-ipc-runtime.cjs',
]) {
  assert.equal(packagedFiles.includes(expected), true, expected);
}
for (const retired of [
  '/electron/builder-project-revision-record.cjs',
  '/electron/builder-project-revision-repository.cjs',
  '/electron/builder-project-revision-ipc-adapter.cjs',
  '/electron/builder-project-catalog-ipc-adapter.cjs',
  '/electron/builder-project-ipc-runtime.cjs',
  '/electron/builder-conversation-repository.cjs',
]) {
  assert.equal(packagedFiles.includes(retired), false, retired);
}
assert.equal(packagedFiles.some((entry) => forbidden.test(entry)), false);
assert.equal(packagedFiles.some((entry) => /\.test\.(?:cjs|js|ts|tsx)$/u.test(entry)), false);
for (const forbiddenTest of [
  '/tests/builder-generation-ipc-adapter.test.cjs',
  '/tests/builder-generation-ipc-runtime.test.cjs',
  '/tests/builder-generation-main-service.test.cjs',
  '/tests/builder-conversation-main-service.test.cjs',
  '/tests/builder-project-workspace-ipc-adapter.test.cjs',
  '/tests/builder-task-stream-ipc-adapter.test.cjs',
  '/tests/builder-provider-settings-ipc-adapter.test.cjs',
  '/tests/builder-provider-settings-ipc-runtime.test.cjs',
  '/tests/builder-window-controls-ipc-runtime.test.cjs',
]) {
  assert.equal(packagedFiles.includes(forbiddenTest), false, forbiddenTest);
}
assert.equal(packagedFiles.includes('/scripts/verify-packaged-canary.cjs'), false);
const allowedPackagedNodeModuleRoots = Object.freeze([
  '/node_modules/b4a/',
  '/node_modules/bare-events/',
  '/node_modules/bare-fs/',
  '/node_modules/bare-path/',
  '/node_modules/bare-stream/',
  '/node_modules/bare-url/',
  '/node_modules/dugite/',
  '/node_modules/events-universal/',
  '/node_modules/fast-fifo/',
  '/node_modules/progress/',
  '/node_modules/streamx/',
  '/node_modules/tar-stream/',
  '/node_modules/teex/',
  '/node_modules/text-decoder/',
]);
const packagedNodeModuleFiles = packagedFiles.filter((entry) => entry.startsWith('/node_modules/'));
assert.equal(packagedNodeModuleFiles.length > 0, true);
function isAllowedPackagedNodeModule(entry) {
  return allowedPackagedNodeModuleRoots.some((rootPath) => (
    entry === rootPath.slice(0, -1) || entry.startsWith(rootPath)
  ));
}
for (const entry of packagedNodeModuleFiles) {
  assert.equal(
    isAllowedPackagedNodeModule(entry),
    true,
    entry,
  );
}
for (const expectedDugiteLoaderFile of [
  '/node_modules/dugite/package.json',
  '/node_modules/dugite/build/lib/index.js',
  '/node_modules/dugite/build/lib/git-environment.js',
]) {
  assert.equal(packagedFiles.includes(expectedDugiteLoaderFile), true, expectedDugiteLoaderFile);
}
assert.deepEqual(workspacePackageJson.build.asarUnpack, [
  'node_modules/dugite/git/**/*',
  'node_modules/dugite/LICENSE',
  'node_modules/dugite/git/LICENSE.txt',
]);
assert.equal(Object.hasOwn(workspacePackageJson.devDependencies, 'playwright-core'), true);
assert.equal(Object.hasOwn(workspacePackageJson.devDependencies, 'pngjs'), true);
assert.equal(Object.hasOwn(workspacePackageJson.dependencies ?? {}, 'playwright-core'), false);
assert.equal(Object.hasOwn(workspacePackageJson.dependencies ?? {}, 'pngjs'), false);
assert.equal(workspacePackageJson.dependencies?.dugite, '3.2.2');
assert.equal(workspacePackageJson.devDependencies?.dugite, undefined);
assert.equal(workspacePackageJson.scripts['verify:packaged-canary'], 'node scripts/verify-packaged-canary.cjs');
assert.equal(workspacePackageJson.build.nsis.deleteAppDataOnUninstall, false);
const unpackedDugiteRoot = path.join(unpackedArchive, 'node_modules', 'dugite');
const unpackedGitRoot = path.join(unpackedDugiteRoot, 'git');
assert.equal(fs.statSync(path.join(unpackedDugiteRoot, 'LICENSE')).isFile(), true);
assert.equal(fs.statSync(path.join(unpackedGitRoot, 'LICENSE.txt')).isFile(), true);
assert.equal(fs.statSync(path.join(unpackedGitRoot, 'cmd', 'git.exe')).isFile(), true);
assert.equal(fs.statSync(path.join(unpackedGitRoot, 'mingw64', 'libexec', 'git-core')).isDirectory(), true);
const packagedGitVersion = execFileSync(path.join(unpackedGitRoot, 'cmd', 'git.exe'), ['--version'], {
  encoding: 'utf8',
  env: {
    PATH: '',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
  },
  windowsHide: true,
}).trim();
assert.match(packagedGitVersion, /^git version \d+\.\d+\.\d+/u);
for (const entry of packagedEntries.filter(
  (value) => /\.(?:cjs|css|html|js|json)$/u.test(value.normalizedPath),
)) {
  const source = asar.extractFile(archive, entry.archivePath.slice(1)).toString('utf8');
  assert.doesNotMatch(source, forbidden, entry.normalizedPath);
  assert.doesNotMatch(source, secretMaterial, entry.normalizedPath);
  assert.doesNotMatch(source, apiKeyLiteralAssignment, entry.normalizedPath);
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
const packagedGitRunner = packagedSource('electron/builder-git-command-runner.cjs');
const packagedGitReceiptContract = packagedSource('electron/builder-git-receipt-contract.cjs');
const packagedGitRepository = packagedSource('electron/builder-git-project-repository.cjs');
const packagedGitCurrentProjection = packagedSource('electron/builder-git-current-projection.cjs');
const packagedPermissionAuthorityContract = packagedSource('electron/builder-permission-authority-contract.cjs');
const packagedWorkspaceAdapter = packagedSource('electron/builder-project-workspace-ipc-adapter.cjs');
const packagedProviderConfigRepository = packagedSource('electron/builder-provider-config-repository.cjs');
const packagedProviderSecretStore = packagedSource('electron/builder-provider-secret-store.cjs');
const packagedProviderSettingsIpcAdapter = packagedSource('electron/builder-provider-settings-ipc-adapter.cjs');
const packagedProviderSettingsIpcRuntime = packagedSource('electron/builder-provider-settings-ipc-runtime.cjs');
const packagedGenerationHost = packagedSource('electron/builder-generation-host-adapter.cjs');
const packagedGenerationIpcAdapter = packagedSource('electron/builder-generation-ipc-adapter.cjs');
const packagedGenerationIpcRuntime = packagedSource('electron/builder-generation-ipc-runtime.cjs');
const packagedGenerationMainService = packagedSource('electron/builder-generation-main-service.cjs');
const packagedConversationMainService = packagedSource('electron/builder-conversation-main-service.cjs');
const packagedTaskStreamProjection = packagedSource('electron/builder-task-stream-projection.cjs');
const packagedTaskStreamIpcAdapter = packagedSource('electron/builder-task-stream-ipc-adapter.cjs');
const packagedWindowControlsIpcRuntime = packagedSource('electron/builder-window-controls-ipc-runtime.cjs');
const channels = [
  'clawfabric-builder:project-workspace:open',
  'clawfabric-builder:project-workspace:save-draft',
  'clawfabric-builder:project-workspace:load-current',
  'clawfabric-builder:project-workspace:load-revision',
  'clawfabric-builder:project-workspace:list-current',
  'clawfabric-builder:project-workspace:list-history',
];
const generationChannels = [
  'clawfabric-builder:code-generator:generate',
  'clawfabric-builder:code-generator:retry',
  'clawfabric-builder:code-generator:answer',
  'clawfabric-builder:code-generator:restore-draft',
  'clawfabric-builder:code-generator:reject-draft',
  'clawfabric-builder:code-generator:cancel',
  'clawfabric-builder:code-generator:availability',
];
const providerSettingsChannels = [
  'clawfabric-builder:provider-settings:read-current',
  'clawfabric-builder:provider-settings:replace-current',
  'clawfabric-builder:provider-settings:status',
];
const taskStreamChannels = [
  'clawfabric-builder:task-stream:read',
];
const windowControlsChannels = [
  'clawfabric-builder:window-controls:minimize',
  'clawfabric-builder:window-controls:toggle-maximize',
  'clawfabric-builder:window-controls:close',
  'clawfabric-builder:window-controls:read-state',
];
const preloadChannels = [
  ...channels,
  ...generationChannels,
  ...providerSettingsChannels,
  ...taskStreamChannels,
  ...windowControlsChannels,
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
exactObjectKeys(preloadRoot, [
  'bridgeVersion',
  'projectWorkspace',
  'codeGenerator',
  'providerSettings',
  'taskStream',
  'windowControls',
]);
const bridgeVersionProperty = preloadRoot.properties.find((property) => property.name.text === 'bridgeVersion');
const workspaceProperty = preloadRoot.properties.find((property) => property.name.text === 'projectWorkspace');
const generationProperty = preloadRoot.properties.find((property) => property.name.text === 'codeGenerator');
const providerSettingsProperty = preloadRoot.properties.find((property) => property.name.text === 'providerSettings');
const taskStreamProperty = preloadRoot.properties.find((property) => property.name.text === 'taskStream');
const windowControlsProperty = preloadRoot.properties.find((property) => property.name.text === 'windowControls');
assert.equal(ts.isPropertyAssignment(bridgeVersionProperty), true);
assert.equal(ts.isPropertyAssignment(workspaceProperty), true);
assert.equal(ts.isPropertyAssignment(generationProperty), true);
assert.equal(ts.isPropertyAssignment(providerSettingsProperty), true);
assert.equal(ts.isPropertyAssignment(taskStreamProperty), true);
assert.equal(ts.isPropertyAssignment(windowControlsProperty), true);
assert.equal(ts.isStringLiteral(bridgeVersionProperty.initializer), true);
assert.equal(bridgeVersionProperty.initializer.text, 'builder-preload.v3');
const workspaceBridge = frozenObjectLiteral(workspaceProperty.initializer);
const generationBridge = frozenObjectLiteral(generationProperty.initializer);
const providerSettingsBridge = frozenObjectLiteral(providerSettingsProperty.initializer);
const taskStreamBridge = frozenObjectLiteral(taskStreamProperty.initializer);
const windowControlsBridge = frozenObjectLiteral(windowControlsProperty.initializer);
exactObjectKeys(workspaceBridge, ['open', 'saveDraft', 'loadCurrent', 'loadRevision', 'listCurrent', 'listHistory']);
exactObjectKeys(generationBridge, ['generate', 'retry', 'answer', 'restoreDraft', 'rejectDraft', 'cancel', 'availability']);
exactObjectKeys(providerSettingsBridge, ['readCurrent', 'replaceCurrent', 'status']);
exactObjectKeys(taskStreamBridge, ['read']);
exactObjectKeys(windowControlsBridge, ['minimize', 'toggleMaximize', 'close', 'readState']);
assert.deepEqual(rendererPropertyAccesses, [
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
  'invoke',
]);
assert.deepEqual(forbiddenRendererReferences, []);
assert.doesNotMatch(packagedPreload, /secret|safeStorage|credential|encrypted|binding|Authorization|Bearer/iu);

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

assert.equal(preloadConstants.get('OPEN_PROJECT_CHANNEL'), channels[0]);
assert.equal(preloadConstants.get('SAVE_DRAFT_CHANNEL'), channels[1]);
assert.equal(preloadConstants.get('LOAD_CURRENT_CHANNEL'), channels[2]);
assert.equal(preloadConstants.get('LOAD_REVISION_CHANNEL'), channels[3]);
assert.equal(preloadConstants.get('LIST_CURRENT_CHANNEL'), channels[4]);
assert.equal(preloadConstants.get('LIST_HISTORY_CHANNEL'), channels[5]);
assert.equal(preloadConstants.get('GENERATE_CHANNEL'), generationChannels[0]);
assert.equal(preloadConstants.get('RETRY_GENERATE_CHANNEL'), generationChannels[1]);
assert.equal(preloadConstants.get('ANSWER_CHANNEL'), generationChannels[2]);
assert.equal(preloadConstants.get('RESTORE_DRAFT_CHANNEL'), generationChannels[3]);
assert.equal(preloadConstants.get('REJECT_DRAFT_CHANNEL'), generationChannels[4]);
assert.equal(preloadConstants.get('CANCEL_CHANNEL'), generationChannels[5]);
assert.equal(preloadConstants.get('AVAILABILITY_CHANNEL'), generationChannels[6]);
assert.equal(preloadConstants.get('READ_PROVIDER_SETTINGS_CHANNEL'), providerSettingsChannels[0]);
assert.equal(preloadConstants.get('REPLACE_PROVIDER_SETTINGS_CHANNEL'), providerSettingsChannels[1]);
assert.equal(preloadConstants.get('PROVIDER_SETTINGS_STATUS_CHANNEL'), providerSettingsChannels[2]);
assert.equal(preloadConstants.get('READ_TASK_STREAM_CHANNEL'), taskStreamChannels[0]);
assert.equal(preloadConstants.get('MINIMIZE_WINDOW_CHANNEL'), windowControlsChannels[0]);
assert.equal(preloadConstants.get('TOGGLE_MAXIMIZE_WINDOW_CHANNEL'), windowControlsChannels[1]);
assert.equal(preloadConstants.get('CLOSE_WINDOW_CHANNEL'), windowControlsChannels[2]);
assert.equal(preloadConstants.get('READ_WINDOW_STATE_CHANNEL'), windowControlsChannels[3]);
exactInvokeMethod(workspaceBridge, 'open', 'OPEN_PROJECT_CHANNEL', ['request']);
exactInvokeMethod(workspaceBridge, 'saveDraft', 'SAVE_DRAFT_CHANNEL', ['request']);
exactInvokeMethod(workspaceBridge, 'loadCurrent', 'LOAD_CURRENT_CHANNEL', ['request']);
exactInvokeMethod(workspaceBridge, 'loadRevision', 'LOAD_REVISION_CHANNEL', ['request']);
exactInvokeMethod(workspaceBridge, 'listCurrent', 'LIST_CURRENT_CHANNEL', []);
exactInvokeMethod(workspaceBridge, 'listHistory', 'LIST_HISTORY_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'generate', 'GENERATE_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'retry', 'RETRY_GENERATE_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'answer', 'ANSWER_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'restoreDraft', 'RESTORE_DRAFT_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'rejectDraft', 'REJECT_DRAFT_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'cancel', 'CANCEL_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'availability', 'AVAILABILITY_CHANNEL', []);
exactInvokeMethod(providerSettingsBridge, 'readCurrent', 'READ_PROVIDER_SETTINGS_CHANNEL', []);
exactInvokeMethod(providerSettingsBridge, 'replaceCurrent', 'REPLACE_PROVIDER_SETTINGS_CHANNEL', ['request']);
exactInvokeMethod(providerSettingsBridge, 'status', 'PROVIDER_SETTINGS_STATUS_CHANNEL', []);
exactInvokeMethod(taskStreamBridge, 'read', 'READ_TASK_STREAM_CHANNEL', ['request']);
exactInvokeMethod(windowControlsBridge, 'minimize', 'MINIMIZE_WINDOW_CHANNEL', []);
exactInvokeMethod(windowControlsBridge, 'toggleMaximize', 'TOGGLE_MAXIMIZE_WINDOW_CHANNEL', []);
exactInvokeMethod(windowControlsBridge, 'close', 'CLOSE_WINDOW_CHANNEL', []);
exactInvokeMethod(windowControlsBridge, 'readState', 'READ_WINDOW_STATE_CHANNEL', []);

assert.match(packagedMain, /require\(['"]\.\/builder-provider-settings-ipc-runtime\.cjs['"]\)/u);
assert.match(packagedMain, /require\(['"]\.\/builder-generation-ipc-runtime\.cjs['"]\)/u);
assert.match(packagedMain, /require\(['"]\.\/builder-window-controls-ipc-runtime\.cjs['"]\)/u);
assert.match(packagedMain, /createBuilderProviderSettingsIpcRuntime/u);
assert.match(packagedMain, /createBuilderGenerationIpcRuntime/u);
assert.match(packagedMain, /createBuilderWindowControlsIpcRuntime/u);
assert.match(packagedMain, /frame:\s*false/u);
assert.doesNotMatch(packagedMain, /titleBarStyle|titleBarOverlay/u);
assert.match(packagedMain, /BUILDER_PACKAGED_CANARY/u);
assert.match(packagedMain, /BUILDER_PACKAGED_CANARY_USER_DATA_PATH/u);
assert.match(packagedMain, /clawfabric-builder-packaged-canary-/u);
assert.match(packagedMain, /app\.isPackaged/u);
assert.match(packagedMain, /fs\.lstatSync/u);
assert.match(packagedMain, /fs\.realpathSync\.native/u);
assert.match(packagedMain, /app\.setPath\(['"]userData['"]/u);
assert.match(packagedMain, /app\.setPath\(['"]sessionData['"]/u);
assert.match(packagedMain, /path\.dirname\(resolved\) !== tempRoot/u);
assert.match(packagedMain, /path\.basename\(realPath\) !== expectedBasename/u);
assert.match(packagedMain, /stat\.isSymbolicLink\(\)/u);
assert.match(packagedMain, /const userDataPath = app\.getPath\(['"]userData['"]\)/u);
assert.match(packagedMain, /const runtimes = createIpcRuntimes\(userDataPath\)/u);
assert.match(packagedMain, /registerIpcRuntimes\(runtimes\)/u);
assert.match(packagedMain, /ipcRuntimes = runtimes/u);
assert.match(packagedMain, /disposeIpcRuntimes/u);
assert.match(packagedMain, /requestSingleInstanceLock/u);
assert.doesNotMatch(packagedMain, /clawfabric-builder:provider-settings:|clawfabric-builder:code-generator:|credential|safeStorage|local-provider-executor/iu);
assert.match(packagedWorkspaceAdapter, /createBuilderProjectWorkspaceIpcAdapter/u);
assert.match(packagedWorkspaceAdapter, /renderer_authority:\s*'project_selection_or_draft_id_only'/u);
assert.doesNotMatch(packagedWorkspaceAdapter, /provider|secret|safeStorage/iu);
assert.match(packagedGitRunner, /resolveGitBinary\(['"]['"]\)/u);
assert.match(packagedGitRunner, /GIT_NO_REPLACE_OBJECTS:\s*['"]1['"]/u);
assert.match(packagedGitRunner, /--no-replace-objects/u);
assert.match(packagedGitRunner, /shell:\s*false/u);
assert.doesNotMatch(
  packagedGitRunner,
  /dugite\.(?:exec|spawn)|setupEnvironment|shell:\s*true|fetch\s*\(|https?:|Authorization|Bearer|safeStorage|ipcMain|ipcRenderer|require\(['"][^'"]*preload[^'"]*['"]\)|sqlite|better-sqlite/iu,
);
assert.match(packagedGitReceiptContract, /BUILDER_GIT_CANDIDATE_RECEIPT_VERSION/u);
assert.match(packagedGitReceiptContract, /CANDIDATE_RECEIPT_KEYS/u);
assert.match(packagedGitReceiptContract, /sanitizeBuilderGitCandidateVerificationReceipt/u);
assert.match(packagedGitReceiptContract, /sanitizeBuilderGitCandidateReceiptPair/u);
assert.doesNotMatch(
  packagedGitReceiptContract,
  /node:fs|require\(['"][^'"]*(?:builder-git-project-repository|builder-git-command-runner|dugite)[^'"]*['"]\)|ipcMain|ipcRenderer|BrowserWindow|sqlite|better-sqlite|fetch\s*\(|https?:|safeStorage/iu,
);
assert.match(packagedGitRepository, /persist_candidate_commit/u);
assert.match(packagedGitRepository, /code_authority:\s*CODE_AUTHORITY/u);
assert.match(packagedGitRepository, /product_revision_admission:\s*PRODUCT_REVISION_ADMISSION/u);
assert.doesNotMatch(
  packagedGitRepository,
  /builder-project-revision-repository|head\.json|read_current|load_current|refs\/heads\/main|ipcMain|ipcRenderer|preload|BrowserWindow|sqlite|better-sqlite|fetch\s*\(|https?:|child_process|execFile|shell/iu,
);
assert.match(packagedGitCurrentProjection, /project_current/u);
assert.match(packagedGitCurrentProjection, /git_main_ref_and_materialized_worktree/u);
assert.match(packagedGitCurrentProjection, /sqlite_current_repair/u);
assert.match(packagedGitCurrentProjection, /foldedName/u);
assert.doesNotMatch(
  packagedGitCurrentProjection,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|https?:|Authorization|Bearer|provider|credential|node:sqlite|better-sqlite|shell:\s*true/iu,
);
assert.match(packagedPermissionAuthorityContract, /builder_permission_facts_deny_by_default_v1/u);
assert.match(packagedPermissionAuthorityContract, /ui_selection_authority:\s*'not_permission'/u);
assert.match(packagedPermissionAuthorityContract, /fact_authority:\s*'main_owned_permission_fact_store'/u);
assert.match(packagedPermissionAuthorityContract, /const EVALUATE_REQUEST_KEYS = Object\.freeze\(\[/u);
assert.match(packagedPermissionAuthorityContract, /const FACTS_READ_RESULT_KEYS = Object\.freeze\(\[/u);
assert.doesNotMatch(
  packagedPermissionAuthorityContract.slice(
    packagedPermissionAuthorityContract.indexOf('const EVALUATE_REQUEST_KEYS'),
    packagedPermissionAuthorityContract.indexOf('const FACTS_READ_RESULT_KEYS'),
  ),
  /grants/u,
);
assert.match(packagedPermissionAuthorityContract, /createBuilderPermissionGrantRecord/u);
assert.match(packagedPermissionAuthorityContract, /createBuilderPermissionRevocationRecord/u);
assert.match(packagedPermissionAuthorityContract, /createBuilderPermissionEvaluator/u);
assert.match(packagedPermissionAuthorityContract, /read_permission_facts/u);
assert.match(packagedPermissionAuthorityContract, /revokedPermissionIds/u);
assert.match(packagedPermissionAuthorityContract, /credential_readback:\s*false/u);
assert.doesNotMatch(
  packagedPermissionAuthorityContract,
  /require\(['"]electron['"]\)|require\(['"]fs['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|node:fs|node:sqlite|better-sqlite|builder-provider|builder-git|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|eval\s*\(|new Function|shell:\s*true|localStorage|sessionStorage|indexedDB/iu,
);
assert.match(packagedGenerationIpcRuntime, /channel:\s*OPEN_PROJECT_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*RETRY_GENERATE_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*RESTORE_DRAFT_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*SAVE_DRAFT_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*LOAD_CURRENT_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*LOAD_REVISION_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*LIST_CURRENT_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*LIST_HISTORY_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*READ_TASK_STREAM_CHANNEL/u);
assert.match(packagedPreload, /exposeInMainWorld\(['"]clawfabricBuilder['"]/u);
assert.match(packagedPreload, /projectWorkspace/u);
assert.match(packagedPreload, /loadRevision/u);
assert.doesNotMatch(packagedPreload, /projectRevisions|projectCatalog/u);
assert.match(packagedPreload, /codeGenerator/u);
assert.match(packagedPreload, /\bretry\b/u);
assert.match(packagedPreload, /\banswer\b/u);
assert.match(packagedPreload, /restoreDraft/u);
assert.match(packagedPreload, /rejectDraft/u);
assert.match(packagedPreload, /providerSettings/u);
assert.match(packagedPreload, /taskStream/u);
assert.match(packagedPreload, /windowControls/u);
assert.equal((packagedPreload.match(/ipcRenderer\.invoke/g) || []).length, 21);
assert.doesNotMatch(packagedPreload, /credential|secret_ref|secret_binding|encrypted_secret_digest|safeStorage|Authorization|Bearer/iu);
assert.match(packagedProviderConfigRepository, /bind_current_authority/u);
assert.match(packagedProviderConfigRepository, /builder-provider-secret-store\.cjs/u);
assert.doesNotMatch(packagedProviderConfigRepository, /safeStorage|ipcMain|ipcRenderer|contextBridge|fetch\s*\(/u);
assert.match(packagedProviderSecretStore, /safeStorage/u);
assert.doesNotMatch(packagedProviderSecretStore, /ipcMain|ipcRenderer|contextBridge|fetch\s*\(/u);
assert.match(packagedProviderSettingsIpcAdapter, /createBuilderProviderSettingsIpcAdapter/u);
assert.match(packagedProviderSettingsIpcAdapter, /active_renderer_required:\s*true/u);
assert.match(packagedProviderSettingsIpcAdapter, /direct_electron_registration:\s*false/u);
assert.match(packagedProviderSettingsIpcAdapter, /direct_preload_exposure:\s*false/u);
assert.match(packagedProviderSettingsIpcAdapter, /credential_readback:\s*false/u);
assert.match(packagedProviderSettingsIpcAdapter, /secret_binding_readback:\s*false/u);
assert.doesNotMatch(
  packagedProviderSettingsIpcAdapter,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|safeStorage|builder-provider-secret-store|builder-provider-config-repository|local-provider-executor/iu,
);
assert.match(packagedProviderSettingsIpcRuntime, /createBuilderProviderSettingsIpcAdapter/u);
assert.match(packagedProviderSettingsIpcRuntime, /createBuilderProviderConfigRepository/u);
assert.match(packagedProviderSettingsIpcRuntime, /READ_CURRENT_CHANNEL/u);
assert.match(packagedProviderSettingsIpcRuntime, /REPLACE_CURRENT_CHANNEL/u);
assert.match(packagedProviderSettingsIpcRuntime, /STATUS_CHANNEL/u);
assert.doesNotMatch(
  packagedProviderSettingsIpcRuntime,
  /require\(['"]electron['"]\)|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta|generic.*(?:config|secret)/iu,
);
assert.match(packagedGenerationIpcRuntime, /createBuilderGenerationIpcAdapter/u);
assert.match(packagedGenerationIpcRuntime, /createBuilderGenerationMainService/u);
assert.match(packagedGenerationIpcRuntime, /createBuilderConversationMainService/u);
assert.match(packagedGenerationIpcRuntime, /createBuilderTaskStreamIpcAdapter/u);
assert.match(packagedGenerationIpcRuntime, /bind_current_authority/u);
assert.doesNotMatch(
  packagedGenerationIpcRuntime,
  /require\(['"]electron['"]\)|ipcRenderer|contextBridge|BrowserWindow|safeStorage|providerSettings|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta|generic.*(?:config|secret)/iu,
);
assert.doesNotMatch(packagedGenerationHost, /safeStorage|builder-provider-secret-store|builder-provider-config-repository/u);
assert.match(packagedGenerationIpcAdapter, /createBuilderGenerationIpcAdapter/u);
assert.match(packagedGenerationIpcAdapter, /active_renderer_required:\s*true/u);
assert.match(packagedGenerationIpcAdapter, /direct_electron_registration:\s*false/u);
assert.match(packagedGenerationIpcAdapter, /direct_preload_exposure:\s*false/u);
assert.match(packagedGenerationIpcAdapter, /provider_settings_exposed:\s*false/u);
assert.match(packagedGenerationIpcAdapter, /credential_readback:\s*false/u);
assert.doesNotMatch(
  packagedGenerationIpcAdapter,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|safeStorage|builder-provider|local-provider-executor/iu,
);
assert.match(packagedGenerationMainService, /createBuilderGenerationHostAdapter/u);
assert.match(packagedGenerationMainService, /bind_current_authority/u);
assert.match(packagedGenerationMainService, /conversation_event_admission:\s*'sqlite_recorded'/u);
assert.match(packagedGenerationMainService, /credential_exposed_to_renderer:\s*false/u);
assert.match(packagedGenerationMainService, /electron_registration:\s*false/u);
assert.match(packagedGenerationMainService, /preload_exposure:\s*false/u);
assert.doesNotMatch(
  packagedGenerationMainService,
  /ipcMain|ipcRenderer|contextBridge|safeStorage|builder-provider-secret-store|builder-provider-config-repository|local-provider-executor/iu,
);
assert.match(packagedConversationMainService, /sqlite_conversation_event_chain/u);
assert.match(packagedConversationMainService, /begin_work:\s*beginWork/u);
assert.match(packagedConversationMainService, /verify_candidate:\s*verifyCandidate/u);
assert.match(packagedConversationMainService, /read_stream:\s*readStream/u);
assert.match(packagedConversationMainService, /interrupted_without_provider_redispatch/u);
assert.match(packagedConversationMainService, /builder-git-receipt-contract\.cjs/u);
assert.doesNotMatch(
  packagedConversationMainService,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git-(?:command-runner|project-repository)|persist_candidate_commit|fetch\s*\(|https?:|local-provider-executor/iu,
);
assert.match(packagedTaskStreamProjection, /builder-task-stream-read-result\.v1/u);
assert.match(packagedTaskStreamProjection, /MAX_PUBLIC_ITEMS = 128/u);
assert.match(packagedTaskStreamProjection, /MAX_PUBLIC_BYTES = 4 \* 1_024 \* 1_024/u);
assert.match(packagedTaskStreamProjection, /replayBuilderConversation/u);
assert.match(packagedTaskStreamProjection, /Object\.getPrototypeOf\(value\) !== Array\.prototype/u);
assert.doesNotMatch(packagedTaskStreamProjection, /events\.map\(itemFromEvent\)/u);
assert.match(packagedTaskStreamProjection, /recorded_state:\s*'started'/u);
assert.match(packagedTaskStreamProjection, /candidate_state:\s*'proposed'/u);
assert.match(packagedTaskStreamProjection, /source_availability:\s*'not_loaded'/u);
assert.doesNotMatch(
  packagedTaskStreamProjection,
  /node:sqlite|node:fs|builder-product-metadata|builder-git|ipcMain|ipcRenderer|BrowserWindow|preload|fetch\s*\(|provider|credential|source_tree/iu,
);
assert.match(packagedTaskStreamIpcAdapter, /builder_task_stream\.controlled_ipc_adapter\.v1/u);
assert.match(packagedTaskStreamIpcAdapter, /READ_TASK_STREAM_CHANNEL/u);
assert.match(packagedTaskStreamIpcAdapter, /renderer_authority:\s*'project_id_only'/u);
assert.match(packagedTaskStreamIpcAdapter, /read_only:\s*true/u);
assert.match(packagedTaskStreamIpcAdapter, /active_renderer_required:\s*true/u);
assert.match(packagedTaskStreamIpcAdapter, /direct_electron_registration:\s*false/u);
assert.match(packagedTaskStreamIpcAdapter, /direct_preload_exposure:\s*false/u);
assert.doesNotMatch(
  packagedTaskStreamIpcAdapter,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git-|node:sqlite|fetch\s*\(|https?:|saveDraft|generate|persist_candidate_commit|write_current|local-provider-executor/iu,
);
assert.match(packagedWindowControlsIpcRuntime, /builder-window-controls-ipc-runtime\.v1/u);
assert.match(packagedWindowControlsIpcRuntime, /activeWindow/u);
assert.match(packagedWindowControlsIpcRuntime, /event\.sender !== webContents/u);
assert.doesNotMatch(
  packagedWindowControlsIpcRuntime,
  /ipcRenderer|contextBridge|preload|safeStorage|providerSettings|Authorization|Bearer|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
for (const channel of preloadChannels) {
  assert.equal(packagedPreload.includes(channel), true, channel);
}
for (const channel of channels) {
  assert.equal(packagedWorkspaceAdapter.includes(channel), true, channel);
}
for (const channel of generationChannels) {
  assert.equal(
    packagedGenerationIpcAdapter.includes(channel) || packagedGenerationIpcRuntime.includes(channel),
    true,
    channel,
  );
}
for (const channel of taskStreamChannels) {
  assert.equal(
    packagedTaskStreamIpcAdapter.includes(channel) || packagedGenerationIpcRuntime.includes(channel),
    true,
    channel,
  );
}
for (const channel of providerSettingsChannels) {
  assert.equal(
    packagedProviderSettingsIpcAdapter.includes(channel) || packagedProviderSettingsIpcRuntime.includes(channel),
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
