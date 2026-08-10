'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
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
  '/electron/builder-local-workspace-source-tree.cjs',
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
  '/electron/builder-permission-fact-store.cjs',
  '/electron/builder-permission-ipc-adapter.cjs',
  '/electron/builder-permission-ipc-runtime.cjs',
  '/electron/builder-tool-permission-admission.cjs',
  '/electron/builder-tool-session-policy.cjs',
  '/electron/builder-tool-session-state-gate.cjs',
  '/electron/builder-tool-dispatch-admission.cjs',
  '/electron/builder-tool-adapter-selection-admission.cjs',
  '/electron/builder-tool-runtime-invocation-admission.cjs',
  '/electron/builder-tool-project-workspace-admission.cjs',
  '/electron/builder-tool-filesystem-read-adapter.cjs',
  '/electron/builder-tool-filesystem-read-execution-service.cjs',
  '/electron/builder-tool-source-context-collector.cjs',
  '/electron/builder-plan-proposal-records.cjs',
  '/electron/builder-tool-filesystem-read-output-records.cjs',
  '/electron/builder-tool-call-records.cjs',
  '/electron/builder-tool-result-records.cjs',
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
  '/electron/builder-check-runtime-identity.cjs',
  '/electron/builder-check-run-admission.cjs',
  '/electron/builder-check-workspace-materializer.cjs',
  '/electron/builder-check-run-activity-registry.cjs',
  '/electron/builder-check-run-runner.cjs',
  '/electron/builder-check-run.cjs',
  '/electron/builder-check-run-store.cjs',
  '/electron/builder-check-run-status-service.cjs',
  '/electron/builder-check-run-status-projection.cjs',
  '/electron/builder-check-run-save-gate.cjs',
  '/electron/builder-check-run-main-service.cjs',
  '/electron/builder-packaged-check-runtime-contract.cjs',
  '/electron/builder-packaged-check-script-worker.cjs',
  '/electron/builder-packaged-check-runtime-resolver.cjs',
  '/electron/builder-live-preview-ipc-adapter.cjs',
  '/electron/builder-live-preview-ipc-runtime.cjs',
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
assert.equal(packagedFiles.includes('/scripts/verify-packaged-launch-smoke.cjs'), false);
const allowedPackagedNodeModuleRoots = Object.freeze([
  '/node_modules/@npmcli/promise-spawn/',
  '/node_modules/b4a/',
  '/node_modules/bare-events/',
  '/node_modules/bare-fs/',
  '/node_modules/bare-path/',
  '/node_modules/bare-stream/',
  '/node_modules/bare-url/',
  '/node_modules/dugite/',
  '/node_modules/events-universal/',
  '/node_modules/fast-fifo/',
  '/node_modules/isexe/',
  '/node_modules/progress/',
  '/node_modules/streamx/',
  '/node_modules/tar-stream/',
  '/node_modules/teex/',
  '/node_modules/text-decoder/',
  '/node_modules/which/',
]);
const allowedPackagedNodeModuleNamespaceEntries = Object.freeze([
  '/node_modules/@npmcli',
]);
const packagedNodeModuleFiles = packagedFiles.filter((entry) => entry.startsWith('/node_modules/'));
assert.equal(packagedNodeModuleFiles.length > 0, true);
function isAllowedPackagedNodeModule(entry) {
  return allowedPackagedNodeModuleNamespaceEntries.includes(entry)
    || allowedPackagedNodeModuleRoots.some((rootPath) => (
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
assert.equal(workspacePackageJson.dependencies?.['@npmcli/promise-spawn'], '9.0.1');
assert.equal(workspacePackageJson.dependencies?.['@npmcli/run-script'], undefined);
assert.equal(workspacePackageJson.devDependencies?.dugite, undefined);
assert.equal(
  workspacePackageJson.scripts['verify:packaged-launch'],
  'node scripts/verify-packaged-launch-smoke.cjs',
);
assert.equal(
  workspacePackageJson.scripts['verify:packaged-canary'],
  'node scripts/verify-packaged-canary-default.cjs',
);
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

const packagedCheckWorker = path.join(
  archive,
  'electron',
  'builder-packaged-check-script-worker.cjs',
);
const packagedCheckRoot = fs.mkdtempSync(path.join(root, 'release', 'packaged-check-canary-'));
try {
  const canaryScript = 'echo PACKAGED_CHECK_RUNTIME_OK';
  fs.writeFileSync(
    path.join(packagedCheckRoot, 'package.json'),
    `${JSON.stringify({ scripts: { test: canaryScript } })}\n`,
  );
  const scriptDigest = `sha256:${nodeCrypto.createHash('sha256').update(JSON.stringify({
    lifecycle_scripts: { main: canaryScript, post: null, pre: null },
    script_name: 'test',
  }), 'utf8').digest('hex')}`;
  const packagedCheckOutput = execFileSync(executable, [
    packagedCheckWorker,
    'run-script',
    'test',
    scriptDigest,
  ], {
    cwd: packagedCheckRoot,
    encoding: 'utf8',
    env: {
      CI: '1',
      ComSpec: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      ELECTRON_RUN_AS_NODE: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      PATH: process.env.PATH || '',
      SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      TEMP: packagedCheckRoot,
      TMP: packagedCheckRoot,
    },
    windowsHide: true,
  });
  assert.match(packagedCheckOutput, /PACKAGED_CHECK_RUNTIME_OK/u);
} finally {
  fs.rmSync(packagedCheckRoot, { recursive: true, force: true });
}
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
const packagedProjectMainAuthority = packagedSource('electron/builder-project-main-authority.cjs');
const packagedGitRunner = packagedSource('electron/builder-git-command-runner.cjs');
const packagedGitReceiptContract = packagedSource('electron/builder-git-receipt-contract.cjs');
const packagedGitRepository = packagedSource('electron/builder-git-project-repository.cjs');
const packagedGitCurrentProjection = packagedSource('electron/builder-git-current-projection.cjs');
const packagedPermissionAuthorityContract = packagedSource('electron/builder-permission-authority-contract.cjs');
const packagedPermissionFactStore = packagedSource('electron/builder-permission-fact-store.cjs');
const packagedPermissionIpcAdapter = packagedSource('electron/builder-permission-ipc-adapter.cjs');
const packagedPermissionIpcRuntime = packagedSource('electron/builder-permission-ipc-runtime.cjs');
const packagedToolPermissionAdmission = packagedSource('electron/builder-tool-permission-admission.cjs');
const packagedToolSessionPolicy = packagedSource('electron/builder-tool-session-policy.cjs');
const packagedToolSessionStateGate = packagedSource('electron/builder-tool-session-state-gate.cjs');
const packagedToolDispatchAdmission = packagedSource('electron/builder-tool-dispatch-admission.cjs');
const packagedToolAdapterSelectionAdmission = packagedSource('electron/builder-tool-adapter-selection-admission.cjs');
const packagedToolRuntimeInvocationAdmission = packagedSource('electron/builder-tool-runtime-invocation-admission.cjs');
const packagedToolProjectWorkspaceAdmission = packagedSource('electron/builder-tool-project-workspace-admission.cjs');
const packagedToolFilesystemReadAdapter = packagedSource('electron/builder-tool-filesystem-read-adapter.cjs');
const packagedToolFilesystemReadExecutionService = packagedSource('electron/builder-tool-filesystem-read-execution-service.cjs');
const packagedToolSourceContextCollector = packagedSource('electron/builder-tool-source-context-collector.cjs');
const packagedPlanProposalRecords = packagedSource('electron/builder-plan-proposal-records.cjs');
const packagedToolFilesystemReadOutputRecords = packagedSource('electron/builder-tool-filesystem-read-output-records.cjs');
const packagedToolCallRecords = packagedSource('electron/builder-tool-call-records.cjs');
const packagedToolResultRecords = packagedSource('electron/builder-tool-result-records.cjs');
const packagedWorkspaceAdapter = packagedSource('electron/builder-project-workspace-ipc-adapter.cjs');
const packagedProviderConfigRepository = packagedSource('electron/builder-provider-config-repository.cjs');
const packagedProviderSecretStore = packagedSource('electron/builder-provider-secret-store.cjs');
const packagedProviderSettingsIpcAdapter = packagedSource('electron/builder-provider-settings-ipc-adapter.cjs');
const packagedProviderSettingsIpcRuntime = packagedSource('electron/builder-provider-settings-ipc-runtime.cjs');
const packagedGenerationHost = packagedSource('electron/builder-generation-host-adapter.cjs');
const packagedGenerationIpcAdapter = packagedSource('electron/builder-generation-ipc-adapter.cjs');
const packagedGenerationIpcRuntime = packagedSource('electron/builder-generation-ipc-runtime.cjs');
const packagedGenerationMainService = packagedSource('electron/builder-generation-main-service.cjs');
const packagedLivePreviewIpcAdapter = packagedSource('electron/builder-live-preview-ipc-adapter.cjs');
const packagedLivePreviewIpcRuntime = packagedSource('electron/builder-live-preview-ipc-runtime.cjs');
const packagedConversationRecords = packagedSource('electron/builder-conversation-records.cjs');
const packagedConversationReplay = packagedSource('electron/builder-conversation-replay.cjs');
const packagedConversationMainService = packagedSource('electron/builder-conversation-main-service.cjs');
const packagedTaskStreamProjection = packagedSource('electron/builder-task-stream-projection.cjs');
const packagedTaskStreamIpcAdapter = packagedSource('electron/builder-task-stream-ipc-adapter.cjs');
const packagedPlanReviewIpcAdapter = packagedSource('electron/builder-plan-review-ipc-adapter.cjs');
const packagedWindowControlsIpcRuntime = packagedSource('electron/builder-window-controls-ipc-runtime.cjs');
const channels = [
  'clawfabric-builder:project-workspace:open',
  'clawfabric-builder:project-workspace:open-location',
  'clawfabric-builder:project-workspace:create-local',
  'clawfabric-builder:project-workspace:save-draft',
  'clawfabric-builder:project-workspace:load-current',
  'clawfabric-builder:project-workspace:load-revision',
  'clawfabric-builder:project-workspace:list-current',
  'clawfabric-builder:project-workspace:list-workspaces',
  'clawfabric-builder:project-workspace:list-history',
];
const generationChannels = [
  'clawfabric-builder:code-generator:generate',
  'clawfabric-builder:code-generator:continue-draft',
  'clawfabric-builder:code-generator:generate-approved-plan',
  'clawfabric-builder:code-generator:propose-plan',
  'clawfabric-builder:code-generator:prepare-plan-source-read-approval',
  'clawfabric-builder:code-generator:approve-plan-source-read',
  'clawfabric-builder:code-generator:prepare-current-project-write-approval',
  'clawfabric-builder:code-generator:approve-current-project-write',
  'clawfabric-builder:code-generator:submit',
  'clawfabric-builder:code-generator:started',
  'clawfabric-builder:code-generator:output',
  'clawfabric-builder:code-generator:retry',
  'clawfabric-builder:code-generator:answer',
  'clawfabric-builder:code-generator:answer-draft',
  'clawfabric-builder:code-generator:restore-draft',
  'clawfabric-builder:code-generator:reject-draft',
  'clawfabric-builder:code-generator:cancel',
  'clawfabric-builder:code-generator:steer',
  'clawfabric-builder:code-generator:queue-followup',
  'clawfabric-builder:code-generator:availability',
];
const providerSettingsChannels = [
  'clawfabric-builder:provider-settings:read-current',
  'clawfabric-builder:provider-settings:replace-current',
  'clawfabric-builder:provider-settings:status',
];
const taskStreamChannels = [
  'clawfabric-builder:task-stream:read',
  'clawfabric-builder:task-stream:changed',
];
const planReviewChannels = [
  'clawfabric-builder:plan-review:review',
];
const permissionChannels = [
  'clawfabric-builder:permissions:evaluate',
];
const providerContextDisclosureApprovalChannels = [
  'clawfabric-builder:provider-context-disclosure:approve-current',
];
const livePreviewChannels = [
  'clawfabric-builder:live-preview:request-current-draft',
  'clawfabric-builder:live-preview:reload-current',
  'clawfabric-builder:live-preview:stop-current',
  'clawfabric-builder:live-preview:read-current-status',
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
  ...planReviewChannels,
  ...permissionChannels,
  ...providerContextDisclosureApprovalChannels,
  ...livePreviewChannels,
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
  'planReview',
  'permissions',
  'providerContextDisclosureApproval',
  'livePreview',
  'windowControls',
]);
const bridgeVersionProperty = preloadRoot.properties.find((property) => property.name.text === 'bridgeVersion');
const workspaceProperty = preloadRoot.properties.find((property) => property.name.text === 'projectWorkspace');
const generationProperty = preloadRoot.properties.find((property) => property.name.text === 'codeGenerator');
const providerSettingsProperty = preloadRoot.properties.find((property) => property.name.text === 'providerSettings');
const taskStreamProperty = preloadRoot.properties.find((property) => property.name.text === 'taskStream');
const planReviewProperty = preloadRoot.properties.find((property) => property.name.text === 'planReview');
const permissionsProperty = preloadRoot.properties.find((property) => property.name.text === 'permissions');
const providerContextDisclosureApprovalProperty = preloadRoot.properties.find(
  (property) => property.name.text === 'providerContextDisclosureApproval',
);
const livePreviewProperty = preloadRoot.properties.find((property) => property.name.text === 'livePreview');
const windowControlsProperty = preloadRoot.properties.find((property) => property.name.text === 'windowControls');
assert.equal(ts.isPropertyAssignment(bridgeVersionProperty), true);
assert.equal(ts.isPropertyAssignment(workspaceProperty), true);
assert.equal(ts.isPropertyAssignment(generationProperty), true);
assert.equal(ts.isPropertyAssignment(providerSettingsProperty), true);
assert.equal(ts.isPropertyAssignment(taskStreamProperty), true);
assert.equal(ts.isPropertyAssignment(planReviewProperty), true);
assert.equal(ts.isPropertyAssignment(permissionsProperty), true);
assert.equal(ts.isPropertyAssignment(providerContextDisclosureApprovalProperty), true);
assert.equal(ts.isPropertyAssignment(livePreviewProperty), true);
assert.equal(ts.isPropertyAssignment(windowControlsProperty), true);
assert.equal(ts.isStringLiteral(bridgeVersionProperty.initializer), true);
assert.equal(bridgeVersionProperty.initializer.text, 'builder-preload.v23');
const workspaceBridge = frozenObjectLiteral(workspaceProperty.initializer);
const generationBridge = frozenObjectLiteral(generationProperty.initializer);
const providerSettingsBridge = frozenObjectLiteral(providerSettingsProperty.initializer);
const taskStreamBridge = frozenObjectLiteral(taskStreamProperty.initializer);
const planReviewBridge = frozenObjectLiteral(planReviewProperty.initializer);
const permissionsBridge = frozenObjectLiteral(permissionsProperty.initializer);
const providerContextDisclosureApprovalBridge = frozenObjectLiteral(
  providerContextDisclosureApprovalProperty.initializer,
);
const livePreviewBridge = frozenObjectLiteral(livePreviewProperty.initializer);
const windowControlsBridge = frozenObjectLiteral(windowControlsProperty.initializer);
exactObjectKeys(workspaceBridge, [
  'open',
  'openLocation',
  'createLocalProject',
  'saveDraft',
  'loadCurrent',
  'loadRevision',
  'listCurrent',
  'listWorkspaces',
  'listHistory',
]);
exactObjectKeys(generationBridge, [
  'submit',
  'generate',
  'continueDraft',
  'generateApprovedPlan',
  'proposePlan',
  'preparePlanSourceReadApproval',
  'approvePlanSourceRead',
  'prepareCurrentProjectWriteApproval',
  'approveCurrentProjectWrite',
  'retry',
  'answer',
  'answerDraft',
  'restoreDraft',
  'restoreRevisionAsDraft',
  'rejectDraft',
  'cancel',
  'steer',
  'queueFollowup',
  'availability',
  'subscribeStarted',
  'subscribeOutput',
]);
exactObjectKeys(providerSettingsBridge, ['readCurrent', 'replaceCurrent', 'status']);
exactObjectKeys(taskStreamBridge, ['read', 'subscribeChanged']);
exactObjectKeys(planReviewBridge, ['review']);
exactObjectKeys(permissionsBridge, ['evaluate']);
exactObjectKeys(providerContextDisclosureApprovalBridge, ['approveCurrent']);
exactObjectKeys(livePreviewBridge, [
  'requestCurrentDraftPreview',
  'reloadCurrentPreview',
  'stopCurrentPreview',
  'readCurrentPreviewStatus',
]);
exactObjectKeys(windowControlsBridge, ['minimize', 'toggleMaximize', 'close', 'readState']);
assert.deepEqual(rendererPropertyAccesses, [
  ...Array.from({ length: 28 }, () => 'invoke'),
  'on',
  'removeListener',
  'on',
  'removeListener',
  ...Array.from({ length: 4 }, () => 'invoke'),
  'on',
  'removeListener',
  ...Array.from({ length: 11 }, () => 'invoke'),
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

function exactSubscribeMethod(object, methodName, channelName) {
  const method = object.properties.find((property) => property.name.text === methodName);
  assert.equal(ts.isMethodDeclaration(method), true);
  assert.deepEqual(method.parameters.map((parameter) => parameter.name.text), ['listener']);
  const source = method.getText(preloadAst);
  assert.match(source, /typeof listener !== 'function'/u);
  assert.match(source, new RegExp(`ipcRenderer\\.on\\(${channelName},\\s*handler\\)`, 'u'));
  assert.match(source, new RegExp(`ipcRenderer\\.removeListener\\(${channelName},\\s*handler\\)`, 'u'));
}

assert.equal(preloadConstants.get('OPEN_PROJECT_CHANNEL'), channels[0]);
assert.equal(preloadConstants.get('OPEN_PROJECT_LOCATION_CHANNEL'), channels[1]);
assert.equal(preloadConstants.get('CREATE_LOCAL_PROJECT_CHANNEL'), channels[2]);
assert.equal(preloadConstants.get('SAVE_DRAFT_CHANNEL'), channels[3]);
assert.equal(preloadConstants.get('LOAD_CURRENT_CHANNEL'), channels[4]);
assert.equal(preloadConstants.get('LOAD_REVISION_CHANNEL'), channels[5]);
assert.equal(preloadConstants.get('LIST_CURRENT_CHANNEL'), channels[6]);
assert.equal(preloadConstants.get('LIST_WORKSPACES_CHANNEL'), channels[7]);
assert.equal(preloadConstants.get('LIST_HISTORY_CHANNEL'), channels[8]);
assert.equal(preloadConstants.get('GENERATE_CHANNEL'), generationChannels[0]);
assert.equal(preloadConstants.get('CONTINUE_DRAFT_CHANNEL'), generationChannels[1]);
assert.equal(preloadConstants.get('GENERATE_APPROVED_PLAN_CHANNEL'), generationChannels[2]);
assert.equal(preloadConstants.get('PROPOSE_PLAN_CHANNEL'), generationChannels[3]);
assert.equal(preloadConstants.get('PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL'), generationChannels[4]);
assert.equal(preloadConstants.get('APPROVE_PLAN_SOURCE_READ_CHANNEL'), generationChannels[5]);
assert.equal(preloadConstants.get('PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL'), generationChannels[6]);
assert.equal(preloadConstants.get('APPROVE_CURRENT_PROJECT_WRITE_CHANNEL'), generationChannels[7]);
assert.equal(preloadConstants.get('SUBMIT_CHANNEL'), generationChannels[8]);
assert.equal(preloadConstants.get('GENERATION_STARTED_CHANNEL'), generationChannels[9]);
assert.equal(preloadConstants.get('GENERATION_OUTPUT_CHANNEL'), generationChannels[10]);
assert.equal(preloadConstants.get('RETRY_GENERATE_CHANNEL'), generationChannels[11]);
assert.equal(preloadConstants.get('ANSWER_CHANNEL'), generationChannels[12]);
assert.equal(preloadConstants.get('ANSWER_DRAFT_CHANNEL'), generationChannels[13]);
assert.equal(preloadConstants.get('RESTORE_DRAFT_CHANNEL'), generationChannels[14]);
assert.equal(preloadConstants.get('REJECT_DRAFT_CHANNEL'), generationChannels[15]);
assert.equal(preloadConstants.get('CANCEL_CHANNEL'), generationChannels[16]);
assert.equal(preloadConstants.get('STEER_CHANNEL'), generationChannels[17]);
assert.equal(preloadConstants.get('QUEUE_FOLLOWUP_CHANNEL'), generationChannels[18]);
assert.equal(preloadConstants.get('AVAILABILITY_CHANNEL'), generationChannels[19]);
assert.equal(preloadConstants.get('READ_PROVIDER_SETTINGS_CHANNEL'), providerSettingsChannels[0]);
assert.equal(preloadConstants.get('REPLACE_PROVIDER_SETTINGS_CHANNEL'), providerSettingsChannels[1]);
assert.equal(preloadConstants.get('PROVIDER_SETTINGS_STATUS_CHANNEL'), providerSettingsChannels[2]);
assert.equal(preloadConstants.get('READ_TASK_STREAM_CHANNEL'), taskStreamChannels[0]);
assert.equal(preloadConstants.get('TASK_STREAM_CHANGED_CHANNEL'), taskStreamChannels[1]);
assert.equal(preloadConstants.get('REVIEW_PLAN_CHANNEL'), planReviewChannels[0]);
assert.equal(preloadConstants.get('EVALUATE_PERMISSION_CHANNEL'), permissionChannels[0]);
assert.equal(
  preloadConstants.get('APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL'),
  providerContextDisclosureApprovalChannels[0],
);
assert.equal(
  preloadConstants.get('REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL'),
  livePreviewChannels[0],
);
assert.equal(preloadConstants.get('RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL'), livePreviewChannels[1]);
assert.equal(preloadConstants.get('STOP_CURRENT_LIVE_PREVIEW_CHANNEL'), livePreviewChannels[2]);
assert.equal(
  preloadConstants.get('READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL'),
  livePreviewChannels[3],
);
assert.equal(preloadConstants.get('MINIMIZE_WINDOW_CHANNEL'), windowControlsChannels[0]);
assert.equal(preloadConstants.get('TOGGLE_MAXIMIZE_WINDOW_CHANNEL'), windowControlsChannels[1]);
assert.equal(preloadConstants.get('CLOSE_WINDOW_CHANNEL'), windowControlsChannels[2]);
assert.equal(preloadConstants.get('READ_WINDOW_STATE_CHANNEL'), windowControlsChannels[3]);
exactInvokeMethod(workspaceBridge, 'open', 'OPEN_PROJECT_CHANNEL', ['request']);
exactInvokeMethod(workspaceBridge, 'openLocation', 'OPEN_PROJECT_LOCATION_CHANNEL', ['request']);
exactInvokeMethod(workspaceBridge, 'createLocalProject', 'CREATE_LOCAL_PROJECT_CHANNEL', ['request']);
exactInvokeMethod(workspaceBridge, 'saveDraft', 'SAVE_DRAFT_CHANNEL', ['request']);
exactInvokeMethod(workspaceBridge, 'loadCurrent', 'LOAD_CURRENT_CHANNEL', ['request']);
exactInvokeMethod(workspaceBridge, 'loadRevision', 'LOAD_REVISION_CHANNEL', ['request']);
exactInvokeMethod(workspaceBridge, 'listCurrent', 'LIST_CURRENT_CHANNEL', []);
exactInvokeMethod(workspaceBridge, 'listWorkspaces', 'LIST_WORKSPACES_CHANNEL', []);
exactInvokeMethod(workspaceBridge, 'listHistory', 'LIST_HISTORY_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'submit', 'SUBMIT_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'generate', 'GENERATE_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'continueDraft', 'CONTINUE_DRAFT_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'generateApprovedPlan', 'GENERATE_APPROVED_PLAN_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'proposePlan', 'PROPOSE_PLAN_CHANNEL', ['request']);
exactInvokeMethod(
  generationBridge,
  'preparePlanSourceReadApproval',
  'PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL',
  ['request'],
);
exactInvokeMethod(generationBridge, 'approvePlanSourceRead', 'APPROVE_PLAN_SOURCE_READ_CHANNEL', ['request']);
exactInvokeMethod(
  generationBridge,
  'prepareCurrentProjectWriteApproval',
  'PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL',
  ['request'],
);
exactInvokeMethod(
  generationBridge,
  'approveCurrentProjectWrite',
  'APPROVE_CURRENT_PROJECT_WRITE_CHANNEL',
  ['request'],
);
exactInvokeMethod(generationBridge, 'retry', 'RETRY_GENERATE_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'answer', 'ANSWER_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'answerDraft', 'ANSWER_DRAFT_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'restoreDraft', 'RESTORE_DRAFT_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'restoreRevisionAsDraft', 'RESTORE_REVISION_AS_DRAFT_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'rejectDraft', 'REJECT_DRAFT_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'cancel', 'CANCEL_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'steer', 'STEER_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'queueFollowup', 'QUEUE_FOLLOWUP_CHANNEL', ['request']);
exactInvokeMethod(generationBridge, 'availability', 'AVAILABILITY_CHANNEL', []);
exactSubscribeMethod(generationBridge, 'subscribeStarted', 'GENERATION_STARTED_CHANNEL');
exactInvokeMethod(providerSettingsBridge, 'readCurrent', 'READ_PROVIDER_SETTINGS_CHANNEL', []);
exactInvokeMethod(providerSettingsBridge, 'replaceCurrent', 'REPLACE_PROVIDER_SETTINGS_CHANNEL', ['request']);
exactInvokeMethod(providerSettingsBridge, 'status', 'PROVIDER_SETTINGS_STATUS_CHANNEL', []);
exactInvokeMethod(taskStreamBridge, 'read', 'READ_TASK_STREAM_CHANNEL', ['request']);
exactSubscribeMethod(taskStreamBridge, 'subscribeChanged', 'TASK_STREAM_CHANGED_CHANNEL');
exactInvokeMethod(planReviewBridge, 'review', 'REVIEW_PLAN_CHANNEL', ['request']);
exactInvokeMethod(permissionsBridge, 'evaluate', 'EVALUATE_PERMISSION_CHANNEL', ['request']);
exactInvokeMethod(
  providerContextDisclosureApprovalBridge,
  'approveCurrent',
  'APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL',
  ['request'],
);
exactInvokeMethod(
  livePreviewBridge,
  'requestCurrentDraftPreview',
  'REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL',
  ['request'],
);
exactInvokeMethod(
  livePreviewBridge,
  'reloadCurrentPreview',
  'RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL',
  ['request'],
);
exactInvokeMethod(
  livePreviewBridge,
  'stopCurrentPreview',
  'STOP_CURRENT_LIVE_PREVIEW_CHANNEL',
  ['request'],
);
exactInvokeMethod(
  livePreviewBridge,
  'readCurrentPreviewStatus',
  'READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL',
  ['request'],
);
exactInvokeMethod(windowControlsBridge, 'minimize', 'MINIMIZE_WINDOW_CHANNEL', []);
exactInvokeMethod(windowControlsBridge, 'toggleMaximize', 'TOGGLE_MAXIMIZE_WINDOW_CHANNEL', []);
exactInvokeMethod(windowControlsBridge, 'close', 'CLOSE_WINDOW_CHANNEL', []);
exactInvokeMethod(windowControlsBridge, 'readState', 'READ_WINDOW_STATE_CHANNEL', []);

assert.match(packagedMain, /require\(['"]\.\/builder-provider-settings-ipc-runtime\.cjs['"]\)/u);
assert.match(packagedMain, /require\(['"]\.\/builder-permission-ipc-runtime\.cjs['"]\)/u);
assert.match(packagedMain, /require\(['"]\.\/builder-generation-ipc-runtime\.cjs['"]\)/u);
assert.match(packagedMain, /require\(['"]\.\/builder-live-preview-ipc-runtime\.cjs['"]\)/u);
assert.match(packagedMain, /require\(['"]\.\/builder-window-controls-ipc-runtime\.cjs['"]\)/u);
assert.match(packagedMain, /createBuilderProviderSettingsIpcRuntime/u);
assert.match(packagedMain, /createBuilderPermissionIpcRuntime/u);
assert.match(packagedMain, /createBuilderGenerationIpcRuntime/u);
assert.match(packagedMain, /createBuilderLivePreviewIpcRuntime/u);
assert.match(packagedMain, /createBuilderWindowControlsIpcRuntime/u);
assert.match(packagedMain, /frame:\s*false/u);
assert.doesNotMatch(packagedMain, /titleBarStyle|titleBarOverlay/u);
assert.match(packagedMain, /BUILDER_PACKAGED_CANARY/u);
assert.match(packagedMain, /BUILDER_PACKAGED_CANARY_USER_DATA_PATH/u);
assert.match(packagedMain, /BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH/u);
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
assert.match(packagedMain, /const runtimes = createIpcRuntimes\(userDataPath,\s*packagedCanaryProjectRootPath\)/u);
assert.match(packagedMain, /registerIpcRuntimes\(runtimes\)/u);
assert.match(packagedMain, /ipcRuntimes = runtimes/u);
assert.match(packagedMain, /disposeIpcRuntimes/u);
assert.match(packagedMain, /requestSingleInstanceLock/u);
assert.doesNotMatch(packagedMain, /clawfabric-builder:provider-settings:|clawfabric-builder:code-generator:|credential|safeStorage|local-provider-executor/iu);
assert.match(packagedWorkspaceAdapter, /createBuilderProjectWorkspaceIpcAdapter/u);
assert.match(packagedWorkspaceAdapter, /renderer_authority:\s*'project_selection_project_id_or_draft_id_only'/u);
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
assert.match(packagedPermissionFactStore, /main_owned_permission_fact_store/u);
assert.match(packagedPermissionFactStore, /record_grant/u);
assert.match(packagedPermissionFactStore, /record_revocation/u);
assert.match(packagedPermissionFactStore, /read_permission_facts/u);
assert.match(packagedPermissionFactStore, /createBuilderPermissionEvaluator/u);
assert.match(packagedPermissionFactStore, /node:sqlite/u);
assert.match(packagedPermissionFactStore, /node:util/u);
assert.match(packagedPermissionFactStore, /utilTypes\.isProxy/u);
assert.match(packagedPermissionFactStore, /PRAGMA trusted_schema = OFF/u);
assert.match(packagedPermissionFactStore, /PRAGMA journal_mode = WAL/u);
assert.match(packagedPermissionFactStore, /FOREIGN KEY \(project_id, permission_id\)/u);
assert.match(packagedPermissionFactStore, /schema_fingerprint_digest/u);
assert.match(packagedPermissionFactStore, /credential_storage:\s*'not_present'/u);
assert.doesNotMatch(
  packagedPermissionFactStore,
  /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|eval\s*\(|new Function|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite/iu,
);
assert.match(packagedPermissionIpcAdapter, /builder_permission\.controlled_ipc_adapter\.v1/u);
assert.match(packagedPermissionIpcAdapter, /EVALUATE_PERMISSION_CHANNEL/u);
assert.match(packagedPermissionIpcAdapter, /renderer_authority:\s*'project_action_resource_only'/u);
assert.match(packagedPermissionIpcAdapter, /actor_authority:\s*'main_bound_local_user'/u);
assert.match(packagedPermissionIpcAdapter, /read_only:\s*true/u);
assert.match(packagedPermissionIpcAdapter, /grant_command:\s*false/u);
assert.match(packagedPermissionIpcAdapter, /revoke_command:\s*false/u);
assert.match(packagedPermissionIpcAdapter, /grants_exposed:\s*false/u);
assert.match(packagedPermissionIpcAdapter, /revocations_exposed:\s*false/u);
assert.doesNotMatch(
  packagedPermissionIpcAdapter,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git-|builder-permission-fact-store|node:sqlite|better-sqlite|fetch\s*\(|https?:|saveDraft|generate|record_grant|record_revocation|persist_candidate_commit|write_current|local-provider-executor/iu,
);
assert.match(packagedPermissionIpcRuntime, /builder-permission-ipc-runtime\.v1/u);
assert.match(packagedPermissionIpcRuntime, /createBuilderPermissionIpcAdapter/u);
assert.match(packagedPermissionIpcRuntime, /createBuilderPermissionFactStore/u);
assert.match(packagedPermissionIpcRuntime, /createBuilderPermissionGrantRecord/u);
assert.match(packagedPermissionIpcRuntime, /grantForExplicitApproval/u);
assert.match(packagedPermissionIpcRuntime, /LOCAL_BUILDER_USER_ACTOR_ID/u);
assert.match(packagedPermissionIpcRuntime, /PERMISSION_DIRECTORY = 'builder-permissions-v1'/u);
assert.match(packagedPermissionIpcRuntime, /PERMISSION_DATABASE = 'permissions\.sqlite'/u);
assert.match(packagedPermissionIpcRuntime, /record_grant/u);
assert.doesNotMatch(packagedPermissionIpcRuntime, /GRANT_PERMISSION_CHANNEL|clawfabric-builder:permissions:grant/u);
assert.doesNotMatch(
  packagedPermissionIpcRuntime,
  /require\(['"]electron['"]\)|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta|record_revocation|revoke_command/iu,
);
assert.match(packagedProjectMainAuthority, /createBuilderToolProjectWorkspaceAuthority/u);
assert.match(packagedProjectMainAuthority, /project_workspace_authority/u);
assert.match(packagedProjectMainAuthority, /admit_project_workspace/u);
assert.match(packagedToolPermissionAdmission, /builder-tool-permission-admission\.v1/u);
assert.match(packagedToolPermissionAdmission, /main_permission_decision_before_tool_dispatch_v1/u);
assert.match(packagedToolPermissionAdmission, /tool_dispatch:\s*'not_performed'/u);
assert.match(packagedToolPermissionAdmission, /execution_admission:\s*'permission_allowed_dispatch_not_performed'/u);
assert.match(packagedToolPermissionAdmission, /renderer_authority:\s*'not_present'/u);
assert.match(packagedToolPermissionAdmission, /grant_command:\s*false/u);
assert.match(packagedToolPermissionAdmission, /revoke_command:\s*false/u);
assert.doesNotMatch(
  packagedToolPermissionAdmission,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|require\(['"][^'"]*preload[^'"]*['"]\)|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedToolSessionPolicy, /builder-tool-session-policy\.v1/u);
assert.match(packagedToolSessionPolicy, /builder_tool_session_policy/u);
assert.match(packagedToolSessionPolicy, /main_tool_session_policy_contract_v1/u);
assert.match(packagedToolSessionPolicy, /max_steps:\s*16/u);
assert.match(packagedToolSessionPolicy, /max_tool_calls:\s*16/u);
assert.match(packagedToolSessionPolicy, /max_retries:\s*2/u);
assert.match(packagedToolSessionPolicy, /max_step_timeout_ms:\s*120_000/u);
assert.match(packagedToolSessionPolicy, /max_total_timeout_ms:\s*300_000/u);
assert.match(packagedToolSessionPolicy, /max_public_summary_bytes:\s*160/u);
assert.match(packagedToolSessionPolicy, /max_raw_output_bytes:\s*0/u);
assert.match(packagedToolSessionPolicy, /max_chargeable_dispatches:\s*0/u);
assert.match(packagedToolSessionPolicy, /const MAX_TOOL_RAW_OUTPUT_BYTES = 64 \* 1_024/u);
assert.match(packagedToolSessionPolicy, /const HARD_LIMITS = Object\.freeze\(\{\s*max_steps:\s*32,/u);
assert.match(packagedToolSessionPolicy, /const HARD_LIMITS = Object\.freeze\(\{[\s\S]*max_tool_calls:\s*32,/u);
assert.match(packagedToolSessionPolicy, /const HARD_LIMITS = Object\.freeze\(\{[\s\S]*max_retries:\s*4,/u);
assert.match(packagedToolSessionPolicy, /const HARD_LIMITS = Object\.freeze\(\{[\s\S]*max_step_timeout_ms:\s*120_000,/u);
assert.match(packagedToolSessionPolicy, /const HARD_LIMITS = Object\.freeze\(\{[\s\S]*max_total_timeout_ms:\s*300_000,/u);
assert.match(packagedToolSessionPolicy, /const HARD_LIMITS = Object\.freeze\(\{[\s\S]*max_public_summary_bytes:\s*160,/u);
assert.match(packagedToolSessionPolicy, /const HARD_LIMITS = Object\.freeze\(\{[\s\S]*max_raw_output_bytes:\s*MAX_TOOL_RAW_OUTPUT_BYTES,/u);
assert.match(packagedToolSessionPolicy, /const HARD_LIMITS = Object\.freeze\(\{[\s\S]*max_chargeable_dispatches:\s*0,/u);
assert.match(packagedToolSessionPolicy, /dispatch_admission:\s*'not_performed_by_policy_contract'/u);
assert.match(packagedToolSessionPolicy, /execution_admission:\s*'not_performed_by_policy_contract'/u);
assert.match(packagedToolSessionPolicy, /retry_admission:\s*'bounded_not_started'/u);
assert.match(packagedToolSessionPolicy, /raw_output_admission:\s*'not_included'/u);
assert.match(packagedToolSessionPolicy, /revision_admission:\s*'not_created'/u);
assert.match(packagedToolSessionPolicy, /issuance_authority:\s*'trusted_main_run_context_required'/u);
assert.match(packagedToolSessionPolicy, /digest_authority:\s*'integrity_digest_not_issuer_proof_v1'/u);
assert.match(packagedToolSessionPolicy, /provider_dispatch:\s*false/u);
assert.match(packagedToolSessionPolicy, /renderer_authority:\s*'not_present'/u);
assert.match(packagedToolSessionPolicy, /raw_output_storage:\s*'not_present'/u);
assert.match(packagedToolSessionPolicy, /git_authority:\s*'not_present'/u);
assert.match(packagedToolSessionPolicy, /policy_digest/u);
assert.doesNotMatch(
  packagedToolSessionPolicy,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|require\(['"][^'"]*preload[^'"]*['"]\)|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|require\(['"](?:node:http|node:https|http|https)['"]\)|child_process|execFile|spawn\s*\(|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|stdout|stderr|output_digest|exit_code|result_bytes|file_content|source_tree|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedToolSessionStateGate, /builder-tool-session-state-gate\.v1/u);
assert.match(packagedToolSessionStateGate, /main_tool_session_state_gate_v1/u);
assert.match(packagedToolSessionStateGate, /bounded_main_session_state_verified/u);
assert.match(packagedToolSessionStateGate, /existing\.openToolCall !== null/u);
assert.match(packagedToolSessionStateGate, /existing\.items\.length \+ 1 > policy\.limits\.max_steps/u);
assert.match(packagedToolSessionStateGate, /existing\.items\.length \+ 1 > policy\.limits\.max_tool_calls/u);
assert.match(packagedToolSessionStateGate, /existing\.retryCount > policy\.limits\.max_retries/u);
assert.match(packagedToolSessionStateGate, /callRecord\.session_policy\.policy_digest !== policyDigest/u);
assert.match(packagedToolSessionStateGate, /tool_dispatch:\s*'not_performed'/u);
assert.match(packagedToolSessionStateGate, /provider_dispatch:\s*false/u);
assert.doesNotMatch(
  packagedToolSessionStateGate,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|require\(['"][^'"]*preload[^'"]*['"]\)|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|require\(['"](?:node:http|node:https|http|https)['"]\)|child_process|execFile|spawn\s*\(|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|stdout|stderr|output_digest|exit_code|result_bytes|file_content|source_tree|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedToolDispatchAdmission, /builder-tool-dispatch-admission\.v1/u);
assert.match(packagedToolDispatchAdmission, /main_tool_dispatch_admission_contract_v1/u);
assert.match(packagedToolDispatchAdmission, /trusted_open_tool_call_required/u);
assert.match(packagedToolDispatchAdmission, /adapter_selection:\s*'not_selected'/u);
assert.match(packagedToolDispatchAdmission, /tool_dispatch:\s*'not_performed'/u);
assert.match(packagedToolDispatchAdmission, /provider_dispatch:\s*false/u);
assert.match(packagedToolDispatchAdmission, /max_chargeable_dispatches !== 0/u);
assert.match(packagedToolDispatchAdmission, /admittedAtMs - toolCallRecord\.requested_at_ms > policy\.limits\.max_step_timeout_ms/u);
assert.match(packagedToolDispatchAdmission, /admission\.retry_count >= admission\.tool_call_count/u);
assert.match(packagedToolDispatchAdmission, /openToolCall\.record_digest !== expectedRecordDigest/u);
assert.match(packagedToolDispatchAdmission, /admission_digest/u);
assert.doesNotMatch(
  packagedToolDispatchAdmission,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|require\(['"][^'"]*preload[^'"]*['"]\)|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|require\(['"](?:node:http|node:https|http|https)['"]\)|child_process|execFile|spawn\s*\(|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|stdout|stderr|output_digest|exit_code|result_bytes|file_content|source_tree|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedToolAdapterSelectionAdmission, /builder-tool-adapter-selection-admission\.v1/u);
assert.match(packagedToolAdapterSelectionAdmission, /builder-tool-adapter\.filesystem-read\.v1/u);
assert.match(packagedToolAdapterSelectionAdmission, /main_tool_adapter_selection_contract_v1/u);
assert.match(packagedToolAdapterSelectionAdmission, /static_main_tool_adapter_registry_v1/u);
assert.match(packagedToolAdapterSelectionAdmission, /selected_without_execution/u);
assert.match(packagedToolAdapterSelectionAdmission, /runtime_execution:\s*'not_started'/u);
assert.match(packagedToolAdapterSelectionAdmission, /tool_dispatch:\s*'not_performed'/u);
assert.match(packagedToolAdapterSelectionAdmission, /provider_dispatch:\s*false/u);
assert.match(packagedToolAdapterSelectionAdmission, /selectedAtMs - record\.requested_at_ms > policy\.limits\.max_step_timeout_ms/u);
assert.match(packagedToolAdapterSelectionAdmission, /policy\.limits\.max_chargeable_dispatches !== 0/u);
assert.match(packagedToolAdapterSelectionAdmission, /dispatchAdmission\.record_digest !== record\.record_digest/u);
assert.match(packagedToolAdapterSelectionAdmission, /resourceId\.startsWith\(prefix\)/u);
assert.match(packagedToolAdapterSelectionAdmission, /suffix\.includes\(':'\)/u);
assert.match(packagedToolAdapterSelectionAdmission, /admission\.selected_at_ms < admission\.dispatch_admitted_at_ms/u);
assert.doesNotMatch(
  packagedToolAdapterSelectionAdmission,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|require\(['"][^'"]*preload[^'"]*['"]\)|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|require\(['"](?:node:http|node:https|http|https|node:fs|fs|fs\/promises|node:path|path)['"]\)|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|statSync|openSync|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|stdout|stderr|output_digest|exit_code|result_bytes|file_content|source_tree|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedToolRuntimeInvocationAdmission, /builder-tool-runtime-invocation-admission\.v1/u);
assert.match(packagedToolRuntimeInvocationAdmission, /builder-tool-runtime\.filesystem-read-envelope\.v1/u);
assert.match(packagedToolRuntimeInvocationAdmission, /main_tool_runtime_invocation_contract_v1/u);
assert.match(packagedToolRuntimeInvocationAdmission, /static_main_tool_runtime_registry_v1/u);
assert.match(packagedToolRuntimeInvocationAdmission, /bounded_envelope_admitted/u);
assert.match(packagedToolRuntimeInvocationAdmission, /admitted_without_execution/u);
assert.match(packagedToolRuntimeInvocationAdmission, /filesystem_read:\s*'not_performed'/u);
assert.match(packagedToolRuntimeInvocationAdmission, /runtime_execution:\s*'not_started'/u);
assert.match(packagedToolRuntimeInvocationAdmission, /network_access:\s*'denied'/u);
assert.match(packagedToolRuntimeInvocationAdmission, /process_access:\s*'denied'/u);
assert.match(packagedToolRuntimeInvocationAdmission, /secret_access:\s*'denied'/u);
assert.match(packagedToolRuntimeInvocationAdmission, /const MAX_TOOL_RAW_OUTPUT_BYTES = 64 \* 1_024/u);
assert.match(packagedToolRuntimeInvocationAdmission, /max_raw_output_bytes:\s*record\.session_policy\.limits\.max_raw_output_bytes/u);
assert.match(packagedToolRuntimeInvocationAdmission, /max_chargeable_dispatches:\s*0/u);
assert.match(packagedToolRuntimeInvocationAdmission, /runtimeAdmittedAtMs - record\.requested_at_ms > policy\.limits\.max_step_timeout_ms/u);
assert.doesNotMatch(packagedToolRuntimeInvocationAdmission, /policy\.limits\.max_raw_output_bytes !== 0/u);
assert.match(packagedToolRuntimeInvocationAdmission, /policy\.limits\.max_chargeable_dispatches !== 0/u);
assert.match(packagedToolRuntimeInvocationAdmission, /selection\.record_digest !== record\.record_digest/u);
assert.match(packagedToolRuntimeInvocationAdmission, /suffix\.includes\(':'\)/u);
assert.doesNotMatch(
  packagedToolRuntimeInvocationAdmission,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|require\(['"][^'"]*preload[^'"]*['"]\)|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|require\(['"](?:node:http|node:https|http|https|node:fs\/promises|node:fs|fs|fs\/promises|node:path|path)['"]\)|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|statSync|openSync|open\s*\(|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|stdout|stderr|output_digest|exit_code|result_bytes|file_content|source_tree|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedToolProjectWorkspaceAdmission, /builder-tool-project-workspace-admission\.v1/u);
assert.match(packagedToolProjectWorkspaceAdmission, /builder-tool-project-workspace-authority\.v1/u);
assert.match(packagedToolProjectWorkspaceAdmission, /main_project_workspace_root_contract_v1/u);
assert.match(packagedToolProjectWorkspaceAdmission, /projects_root_plus_project_id_uuid/u);
assert.match(packagedToolProjectWorkspaceAdmission, /TRUSTED_WORKSPACE_ADMISSIONS = new WeakSet/u);
assert.match(packagedToolProjectWorkspaceAdmission, /fs\.realpathSync\.native/u);
assert.match(packagedToolProjectWorkspaceAdmission, /isSymbolicLink\(\)/u);
assert.match(packagedToolProjectWorkspaceAdmission, /filesystem_read:\s*'not_performed'/u);
assert.doesNotMatch(
  packagedToolProjectWorkspaceAdmission,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-conversation|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|openSync|open\s*\(|writeFile|appendFile|createWriteStream|unlink|rmSync|rm\s*\(|mkdir|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|commit_oid|tree_oid|source_tree|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedToolFilesystemReadAdapter, /builder-tool-filesystem-read-adapter\.v1/u);
assert.match(packagedToolFilesystemReadAdapter, /node:fs\/promises/u);
assert.match(packagedToolFilesystemReadAdapter, /node:path/u);
assert.match(packagedToolFilesystemReadAdapter, /TextDecoder\('utf-8', \{ fatal: true \}\)/u);
assert.match(packagedToolFilesystemReadAdapter, /createBuilderToolFilesystemReadOutputRecord/u);
assert.match(packagedToolFilesystemReadAdapter, /builder-tool-filesystem-read-output-records\.cjs/u);
assert.match(packagedToolFilesystemReadAdapter, /sanitizeBuilderToolProjectWorkspaceAdmission/u);
assert.match(packagedToolFilesystemReadAdapter, /project_workspace_admission/u);
assert.match(packagedToolFilesystemReadAdapter, /isSymbolicLink\(\)/u);
assert.match(packagedToolFilesystemReadAdapter, /handle\.stat\(\)/u);
assert.match(packagedToolFilesystemReadAdapter, /afterStats\.dev !== beforeStats\.dev/u);
assert.match(packagedToolFilesystemReadAdapter, /finalStats\.mtimeMs !== beforeStats\.mtimeMs/u);
assert.match(packagedToolFilesystemReadAdapter, /Buffer\.alloc\(maxRawOutputBytes \+ 1\)/u);
assert.match(packagedToolFilesystemReadAdapter, /handle\.read\(buffer, 0, maxRawOutputBytes \+ 1, 0\)/u);
assert.doesNotMatch(
  packagedToolFilesystemReadAdapter,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-conversation|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|statSync|openSync|writeFile|appendFile|createWriteStream|unlink|rmSync|rm\s*\(|mkdir|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedToolFilesystemReadExecutionService, /builder-tool-filesystem-read-execution-service\.v1/u);
assert.match(packagedToolFilesystemReadExecutionService, /main_tool_filesystem_read_execution_service_v1/u);
assert.match(packagedToolFilesystemReadExecutionService, /readBuilderToolFilesystemReadAdapter/u);
assert.match(packagedToolFilesystemReadExecutionService, /createBuilderToolResultRecord/u);
assert.match(packagedToolFilesystemReadExecutionService, /select_tool_adapter/u);
assert.match(packagedToolFilesystemReadExecutionService, /admit_tool_runtime_invocation/u);
assert.match(packagedToolFilesystemReadExecutionService, /record_tool_result/u);
assert.match(packagedToolFilesystemReadExecutionService, /admit_project_workspace/u);
assert.match(packagedToolFilesystemReadExecutionService, /fixed_result_summary_only/u);
assert.match(packagedToolFilesystemReadExecutionService, /private_filesystem_read_output_record/u);
assert.doesNotMatch(
  packagedToolFilesystemReadExecutionService,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-conversation-main-service|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|statSync|openSync|writeFile|appendFile|createWriteStream|unlink|rmSync|rm\s*\(|mkdir|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|commit_oid|tree_oid|source_tree|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedToolSourceContextCollector, /builder-tool-source-context-collector\.v1/u);
assert.match(packagedToolSourceContextCollector, /main_tool_source_context_collector_v1/u);
assert.match(packagedToolSourceContextCollector, /createBuilderToolSessionPolicy/u);
assert.match(packagedToolSourceContextCollector, /createBuilderToolCallRecord/u);
assert.match(packagedToolSourceContextCollector, /createBuilderToolFilesystemReadExecutionService/u);
assert.match(packagedToolSourceContextCollector, /record_tool_call_request/u);
assert.match(packagedToolSourceContextCollector, /tool_request_and_fixed_result_only/u);
assert.match(packagedToolSourceContextCollector, /builder-private-source-context\.v1/u);
assert.match(packagedToolSourceContextCollector, /MAX_CONTEXT_FILES = 8/u);
assert.match(packagedToolSourceContextCollector, /MAX_CONTEXT_FILE_BYTES = 16 \* 1024/u);
assert.match(packagedToolSourceContextCollector, /max_retries: 0/u);
assert.match(packagedToolSourceContextCollector, /segment === '\.\.'/u);
assert.doesNotMatch(
  packagedToolSourceContextCollector,
  /require\(['"](?:electron|node:fs|node:fs\/promises|fs|fs\/promises|node:path|path|node:process|process)['"]\)|\bprocess\.|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-conversation-main-service|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|statSync|openSync|writeFile|appendFile|createWriteStream|unlink|rmSync|rm\s*\(|mkdir|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedPlanProposalRecords, /builder-plan-proposal-record\.v1/u);
assert.match(packagedPlanProposalRecords, /builder_plan_proposal_record/u);
assert.match(packagedPlanProposalRecords, /main_plan_proposal_record_contract_v1/u);
assert.match(packagedPlanProposalRecords, /builder-private-source-context\.v1/u);
assert.match(packagedPlanProposalRecords, /createBuilderProjectSourceTree/u);
assert.match(packagedPlanProposalRecords, /sanitizeBuilderPlanProposalSourceContextResult/u);
assert.match(packagedPlanProposalRecords, /context_binding:\s*\{[\s\S]*\},\s*reads/u);
assert.match(packagedPlanProposalRecords, /bounded_private_source_context_digest_only/u);
assert.match(packagedPlanProposalRecords, /proposed_not_approved/u);
assert.match(packagedPlanProposalRecords, /not_admitted_by_record_contract/u);
assert.doesNotMatch(
  packagedPlanProposalRecords,
  /require\(['"](?:electron|node:fs|node:fs\/promises|fs|fs\/promises|node:path|path|node:process|process|node:http|node:https|http|https)['"]\)|\bprocess\.|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-conversation-main-service|builder-project-main-authority|fetch\s*\(|child_process|execFile|spawn\s*\(|readFile|createReadStream|writeFile|appendFile|unlink|rm\(|mkdir|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedToolFilesystemReadOutputRecords, /builder-tool-filesystem-read-output-record\.v1/u);
assert.match(packagedToolFilesystemReadOutputRecords, /builder_tool_filesystem_read_output_record/u);
assert.match(packagedToolFilesystemReadOutputRecords, /main_tool_filesystem_read_output_record_contract_v1/u);
assert.match(packagedToolFilesystemReadOutputRecords, /createBuilderProjectSourceTree/u);
assert.match(packagedToolFilesystemReadOutputRecords, /builder-project-source-tree\.cjs/u);
assert.match(packagedToolFilesystemReadOutputRecords, /sanitizeBuilderToolRuntimeInvocationAdmission/u);
assert.match(packagedToolFilesystemReadOutputRecords, /builder-tool-runtime-invocation-admission\.cjs/u);
assert.match(packagedToolFilesystemReadOutputRecords, /bounded_private_file_content_recorded/u);
assert.match(packagedToolFilesystemReadOutputRecords, /private_bounded_not_projected/u);
assert.match(packagedToolFilesystemReadOutputRecords, /conversation_event:\s*'not_admitted'/u);
assert.match(packagedToolFilesystemReadOutputRecords, /raw_output_storage:\s*'not_durable_by_record_contract'/u);
assert.match(packagedToolFilesystemReadOutputRecords, /provider_admission:\s*'not_dispatched'/u);
assert.match(packagedToolFilesystemReadOutputRecords, /revision_admission:\s*'not_created'/u);
assert.match(packagedToolFilesystemReadOutputRecords, /maxRawOutputBytes !== toolCallRecord\.session_policy\.limits\.max_raw_output_bytes/u);
assert.match(packagedToolFilesystemReadOutputRecords, /Buffer\.byteLength\(content,\s*'utf8'\) > maxRawOutputBytes/u);
assert.doesNotMatch(
  packagedToolFilesystemReadOutputRecords,
  /require\(['"]electron['"]\)|require\(['"](?:node:fs\/promises|node:fs|fs|fs\/promises|node:path|path)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|statSync|openSync|open\s*\(|eval\s*\(|new Function|shell:\s*true|record_tool|append|persist_candidate_commit|write_current|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedToolCallRecords, /builder-tool-call-record\.v1/u);
assert.match(packagedToolCallRecords, /builder_tool_call_record/u);
assert.match(packagedToolCallRecords, /main_tool_call_record_contract_v1/u);
assert.match(packagedToolCallRecords, /builder-tool-session-policy\.cjs/u);
assert.match(packagedToolCallRecords, /sanitizeBuilderToolSessionPolicy/u);
assert.match(packagedToolCallRecords, /'session_policy'/u);
assert.match(packagedToolCallRecords, /permission_admission:\s*'verified_allowed'/u);
assert.match(packagedToolCallRecords, /session_policy_admission:\s*'verified_main_run_policy'/u);
assert.match(packagedToolCallRecords, /dispatch_admission:\s*'not_started'/u);
assert.match(packagedToolCallRecords, /execution_admission:\s*'not_performed'/u);
assert.match(packagedToolCallRecords, /result_admission:\s*'not_recorded'/u);
assert.match(packagedToolCallRecords, /revision_admission:\s*'not_created'/u);
assert.match(packagedToolCallRecords, /session_policy_authority:\s*'main_tool_session_policy_contract_v1'/u);
assert.match(packagedToolCallRecords, /policy\.authority\.issuance_authority !== 'trusted_main_run_context_required'/u);
assert.match(packagedToolCallRecords, /policy\.authority\.digest_authority !== 'integrity_digest_not_issuer_proof_v1'/u);
assert.doesNotMatch(packagedToolCallRecords, /policy\.limits\.max_raw_output_bytes !== 0/u);
assert.match(packagedToolCallRecords, /policy\.limits\.max_chargeable_dispatches !== 0/u);
assert.match(packagedToolCallRecords, /session_policy: value\.session_policy/u);
assert.match(packagedToolCallRecords, /requestedAtMs - admission\.evaluated_at_ms > sessionPolicy\.limits\.max_step_timeout_ms/u);
assert.match(packagedToolCallRecords, /requestedAtMs - sessionPolicy\.issued_at_ms > sessionPolicy\.limits\.max_total_timeout_ms/u);
assert.match(packagedToolCallRecords, /tool_dispatch:\s*'not_performed'/u);
assert.match(packagedToolCallRecords, /renderer_authority:\s*'not_present'/u);
assert.match(packagedToolCallRecords, /provider_dispatch:\s*false/u);
assert.match(packagedToolCallRecords, /credential_readback:\s*false/u);
assert.doesNotMatch(
  packagedToolCallRecords,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|require\(['"][^'"]*preload[^'"]*['"]\)|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.match(packagedToolResultRecords, /builder-tool-result-record\.v1/u);
assert.match(packagedToolResultRecords, /builder_tool_result_record/u);
assert.match(packagedToolResultRecords, /main_tool_result_record_contract_v1/u);
assert.match(packagedToolResultRecords, /sanitizeBuilderToolCallRecord/u);
assert.match(packagedToolResultRecords, /sanitizeRuntimeInvocationAdmission/u);
assert.match(packagedToolResultRecords, /RUNTIME_ADMISSION_KEYS/u);
assert.match(packagedToolResultRecords, /runtimeDigestBody/u);
assert.match(packagedToolResultRecords, /runtime_invocation_admission/u);
assert.match(packagedToolResultRecords, /runtime_invocation_digest/u);
assert.match(packagedToolResultRecords, /runtime_invocation_authority:\s*'main_tool_runtime_invocation_contract_v1'/u);
assert.match(packagedToolResultRecords, /tool_call_admission:\s*'verified_pre_dispatch_record'/u);
assert.match(packagedToolResultRecords, /session_policy_admission !== 'verified_main_run_policy'/u);
assert.match(packagedToolResultRecords, /max_public_summary_bytes/u);
assert.match(packagedToolResultRecords, /observedAtMs < runtimeAdmission\.runtime_admitted_at_ms/u);
assert.match(packagedToolResultRecords, /runtimeAdmission\.max_raw_output_bytes !== toolCallRecord\.session_policy\.limits\.max_raw_output_bytes/u);
assert.match(packagedToolResultRecords, /observedAtMs - toolCallRecord\.requested_at_ms > toolCallRecord\.session_policy\.limits\.max_step_timeout_ms/u);
assert.match(packagedToolResultRecords, /observedAtMs - toolCallRecord\.session_policy\.issued_at_ms > toolCallRecord\.session_policy\.limits\.max_total_timeout_ms/u);
assert.match(packagedToolResultRecords, /dispatch_admission:\s*'verified_by_runtime_invocation'/u);
assert.match(packagedToolResultRecords, /runtime_admission:\s*'verified_runtime_invocation'/u);
assert.match(packagedToolResultRecords, /execution_admission:\s*'not_performed_by_record_contract'/u);
assert.match(packagedToolResultRecords, /result_admission:\s*'fixed_summary_code_recorded'/u);
assert.match(packagedToolResultRecords, /raw_output_admission:\s*'not_included'/u);
assert.match(packagedToolResultRecords, /revision_admission:\s*'not_created'/u);
assert.match(packagedToolResultRecords, /summary_code/u);
assert.match(packagedToolResultRecords, /display_summary/u);
assert.match(packagedToolResultRecords, /summary_digest/u);
assert.match(packagedToolResultRecords, /renderer_authority:\s*'not_present'/u);
assert.match(packagedToolResultRecords, /provider_dispatch:\s*false/u);
assert.match(packagedToolResultRecords, /credential_readback:\s*false/u);
assert.doesNotMatch(
  packagedToolResultRecords,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|require\(['"][^'"]*preload[^'"]*['"]\)|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|require\(['"](?:node:http|node:https|http|https|node:fs|fs|fs\/promises|node:path|path)['"]\)|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|statSync|openSync|open\s*\(|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|stdout|stderr|output_digest|exit_code|result_bytes|file_content|source_tree|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
);
assert.doesNotMatch(packagedToolResultRecords, /builder-tool-runtime-invocation-admission\.cjs/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*OPEN_PROJECT_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*OPEN_PROJECT_LOCATION_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*CREATE_LOCAL_PROJECT_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*RETRY_GENERATE_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*GENERATE_APPROVED_PLAN_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*RESTORE_DRAFT_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*SAVE_DRAFT_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*LOAD_CURRENT_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*LOAD_REVISION_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*LIST_CURRENT_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*LIST_HISTORY_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*READ_TASK_STREAM_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*REVIEW_PLAN_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*STEER_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*QUEUE_FOLLOWUP_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*PROPOSE_PLAN_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*APPROVE_PLAN_SOURCE_READ_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL/u);
assert.match(packagedGenerationIpcRuntime, /channel:\s*APPROVE_CURRENT_PROJECT_WRITE_CHANNEL/u);
assert.match(packagedPreload, /exposeInMainWorld\(['"]clawfabricBuilder['"]/u);
assert.match(packagedPreload, /projectWorkspace/u);
assert.match(packagedPreload, /openLocation/u);
assert.match(packagedPreload, /clawfabric-builder:project-workspace:open-location/u);
assert.match(packagedPreload, /createLocalProject/u);
assert.match(packagedPreload, /clawfabric-builder:project-workspace:create-local/u);
assert.match(packagedPreload, /loadRevision/u);
assert.doesNotMatch(packagedPreload, /projectRevisions|projectCatalog/u);
assert.match(packagedPreload, /codeGenerator/u);
assert.match(packagedPreload, /continueDraft/u);
assert.match(packagedPreload, /clawfabric-builder:code-generator:continue-draft/u);
assert.match(packagedPreload, /generateApprovedPlan/u);
assert.match(packagedPreload, /clawfabric-builder:code-generator:generate-approved-plan/u);
assert.match(packagedPreload, /proposePlan/u);
assert.match(packagedPreload, /clawfabric-builder:code-generator:propose-plan/u);
assert.match(packagedPreload, /preparePlanSourceReadApproval/u);
assert.match(packagedPreload, /clawfabric-builder:code-generator:prepare-plan-source-read-approval/u);
assert.match(packagedPreload, /approvePlanSourceRead/u);
assert.match(packagedPreload, /clawfabric-builder:code-generator:approve-plan-source-read/u);
assert.match(packagedPreload, /prepareCurrentProjectWriteApproval/u);
assert.match(packagedPreload, /clawfabric-builder:code-generator:prepare-current-project-write-approval/u);
assert.match(packagedPreload, /approveCurrentProjectWrite/u);
assert.match(packagedPreload, /clawfabric-builder:code-generator:approve-current-project-write/u);
assert.match(packagedPreload, /\bretry\b/u);
assert.match(packagedPreload, /\banswer\b/u);
assert.match(packagedPreload, /answerDraft/u);
assert.match(packagedPreload, /clawfabric-builder:code-generator:answer-draft/u);
assert.match(packagedPreload, /restoreDraft/u);
assert.match(packagedPreload, /restoreRevisionAsDraft/u);
assert.match(packagedPreload, /clawfabric-builder:code-generator:restore-revision-as-draft/u);
assert.match(packagedPreload, /rejectDraft/u);
assert.match(packagedPreload, /\bsteer\b/u);
assert.match(packagedPreload, /clawfabric-builder:code-generator:steer/u);
assert.match(packagedPreload, /subscribeStarted/u);
assert.match(packagedPreload, /clawfabric-builder:code-generator:started/u);
assert.match(packagedPreload, /providerSettings/u);
assert.match(packagedPreload, /taskStream/u);
assert.match(packagedPreload, /planReview/u);
assert.match(packagedPreload, /permissions/u);
assert.match(packagedPreload, /providerContextDisclosureApproval/u);
assert.match(packagedPreload, /clawfabric-builder:provider-context-disclosure:approve-current/u);
assert.match(packagedPreload, /livePreview/u);
assert.match(packagedPreload, /clawfabric-builder:live-preview:request-current-draft/u);
assert.match(packagedPreload, /windowControls/u);
assert.match(packagedPreload, /listWorkspaces/u);
assert.match(packagedPreload, /clawfabric-builder:project-workspace:list-workspaces/u);
assert.equal((packagedPreload.match(/ipcRenderer\.invoke/g) || []).length, 43);
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
assert.match(packagedGenerationIpcRuntime, /createBuilderPlanReviewIpcAdapter/u);
assert.match(packagedGenerationIpcRuntime, /reviewPlan:\s*conversationService\.review_plan/u);
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
assert.match(packagedConversationRecords, /tool_call_requested/u);
assert.match(packagedConversationRecords, /sanitizeBuilderToolCallRecord/u);
assert.match(packagedConversationRecords, /builder-tool-call-records\.cjs/u);
assert.match(packagedConversationRecords, /tool_call_result_recorded/u);
assert.match(packagedConversationRecords, /sanitizeBuilderToolResultRecord/u);
assert.match(packagedConversationRecords, /builder-tool-result-records\.cjs/u);
assert.match(packagedConversationRecords, /builder-conversation-plan-admission\.v1/u);
assert.match(packagedConversationRecords, /createBuilderConversationPlanAdmission/u);
assert.match(packagedConversationRecords, /planAdmissionDigestBody/u);
assert.match(packagedConversationRecords, /payload\.plan_admission !== null/u);
assert.match(packagedConversationRecords, /plan_reviewed/u);
assert.match(packagedConversationRecords, /PLAN_REVIEW_KEYS/u);
assert.match(packagedConversationRecords, /decision !== 'approved' && decision !== 'rejected'/u);
assert.doesNotMatch(
  packagedConversationRecords,
  /ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git-(?:command-runner|project-repository)|fetch\s*\(|require\(['"](?:node:http|node:https|http|https)['"]\)|local-provider-executor/iu,
);
assert.match(packagedConversationReplay, /tool_call_requested/u);
assert.match(packagedConversationReplay, /applyToolCallRequested/u);
assert.match(packagedConversationReplay, /tool_call_result_recorded/u);
assert.match(packagedConversationReplay, /applyToolCallResultRecorded/u);
assert.match(packagedConversationReplay, /tool_result_record:\s*null/u);
assert.match(packagedConversationReplay, /toolResultRecordDigests/u);
assert.match(packagedConversationReplay, /tool_calls:\s*\[\]/u);
assert.match(packagedConversationReplay, /function verifyPlanAdmission/u);
assert.match(packagedConversationReplay, /run\.tool_calls\.length !== admission\.tool_reads\.length/u);
assert.match(packagedConversationReplay, /admission\.head_digest !== headDigest\(priorHead\)/u);
assert.match(packagedConversationReplay, /toolCall\.resource\.resource_id !== read\.resource_id/u);
assert.match(packagedConversationReplay, /resultRecord\.record_digest !== read\.tool_result_record_digest/u);
assert.match(packagedConversationReplay, /read\.result_status !== 'succeeded'/u);
assert.match(packagedConversationReplay, /builder-tool-session-state-gate\.cjs/u);
assert.match(packagedConversationReplay, /admitBuilderToolCallSessionState/u);
assert.match(packagedConversationReplay, /admitBuilderToolResultSessionState/u);
assert.match(packagedConversationReplay, /function applyPlanReviewed/u);
assert.match(packagedConversationReplay, /turn\.outcome !== 'plan_proposed'/u);
assert.match(packagedConversationReplay, /run\.result_kind !== 'plan'/u);
assert.match(packagedConversationReplay, /run\.result_digest !== payload\.plan_result_digest/u);
assert.match(packagedConversationReplay, /run\.plan_review !== null/u);
assert.doesNotMatch(
  packagedConversationReplay,
  /ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git-(?:command-runner|project-repository)|fetch\s*\(|require\(['"](?:node:http|node:https|http|https)['"]\)|local-provider-executor/iu,
);
assert.match(packagedConversationMainService, /sqlite_conversation_event_chain/u);
assert.match(packagedConversationMainService, /begin_work:\s*beginWork/u);
assert.match(packagedConversationMainService, /verify_candidate:\s*verifyCandidate/u);
assert.match(packagedConversationMainService, /read_stream:\s*readStream/u);
assert.match(packagedConversationMainService, /sanitizeBuilderToolCallRecord/u);
assert.match(packagedConversationMainService, /sanitizeBuilderToolResultRecord/u);
assert.match(packagedConversationMainService, /createBuilderConversationPlanAdmission/u);
assert.match(packagedConversationMainService, /sanitizeBuilderPlanProposalSourceContextResult/u);
assert.match(packagedConversationMainService, /sanitizeBuilderPlanProposalRecord/u);
assert.match(packagedConversationMainService, /sanitizeBuilderToolRuntimeInvocationAdmission/u);
assert.match(packagedConversationMainService, /createBuilderToolDispatchAdmission/u);
assert.match(packagedConversationMainService, /createBuilderToolAdapterSelectionAdmission/u);
assert.match(packagedConversationMainService, /sanitizeBuilderToolAdapterSelectionAdmission/u);
assert.match(packagedConversationMainService, /createBuilderToolRuntimeInvocationAdmission/u);
assert.match(packagedConversationMainService, /FILESYSTEM_READ_TOOL_ADAPTER_ID/u);
assert.match(packagedConversationMainService, /FILESYSTEM_READ_TOOL_RUNTIME_ID/u);
assert.match(packagedConversationMainService, /admitBuilderToolCallSessionState/u);
assert.match(packagedConversationMainService, /admitBuilderToolResultSessionState/u);
assert.match(packagedConversationMainService, /admitToolCallState\(context,\s*record,\s*record\.requested_at_ms\)/u);
assert.match(packagedConversationMainService, /admitToolResultState\(context,\s*record,\s*record\.observed_at_ms\)/u);
assert.match(packagedConversationMainService, /activeRunFromContext/u);
assert.match(packagedConversationMainService, /compactToolSessionCalls/u);
assert.match(packagedConversationMainService, /record_tool_call_request:\s*recordToolCallRequest/u);
assert.match(packagedConversationMainService, /record_tool_result:\s*recordToolResult/u);
assert.match(packagedConversationMainService, /complete_plan:\s*completePlan/u);
assert.match(packagedConversationMainService, /review_plan:\s*reviewPlan/u);
assert.match(packagedConversationMainService, /admit_tool_dispatch:\s*admitToolDispatch/u);
assert.match(packagedConversationMainService, /select_tool_adapter:\s*selectToolAdapter/u);
assert.match(packagedConversationMainService, /admit_tool_runtime_invocation:\s*admitToolRuntimeInvocation/u);
assert.match(packagedConversationMainService, /exactObject\(rawRequest,\s*\['context', 'runtime_invocation_admission', 'tool_result_record'\]\)/u);
assert.match(packagedConversationMainService, /exactObject\(rawRequest,\s*\['context', 'tool_call_id', 'adapter_selection_admission', 'runtime_id'\]\)/u);
assert.match(packagedConversationMainService, /exactObject\(rawRequest,\s*\['context', 'source_context_result', 'plan_proposal_record'\]\)/u);
assert.match(packagedConversationMainService, /record\.runtime_invocation_digest !== runtimeAdmission\.admission_digest/u);
assert.match(packagedConversationMainService, /JSON\.stringify\(record\.runtime_invocation_admission\) !== JSON\.stringify\(runtimeAdmission\)/u);
assert.match(packagedConversationMainService, /planRecord\.context_binding\.head_digest !== headDigest\(context\.start_head\)/u);
assert.match(packagedConversationMainService, /sourceContext\.reads\.length !== run\.tool_calls\.length/u);
assert.match(packagedConversationMainService, /toolCall\.resource\.resource_id !== read\.resource_id/u);
assert.match(packagedConversationMainService, /tool_result_record_digest:\s*resultRecord\.record_digest/u);
assert.match(packagedConversationMainService, /toolCall\.tool_result_record\.result\.status !== 'succeeded'/u);
assert.match(packagedConversationMainService, /tool_call_recording:\s*'main_only_pre_dispatch_event'/u);
assert.match(packagedConversationMainService, /tool_result_recording:\s*'main_only_fixed_code_event'/u);
assert.match(packagedConversationMainService, /tool_dispatch_admission:\s*'main_only_open_call_no_dispatch'/u);
assert.match(packagedConversationMainService, /tool_adapter_selection:\s*'main_only_static_adapter_no_dispatch'/u);
assert.match(packagedConversationMainService, /tool_runtime_invocation:\s*'main_only_runtime_envelope_no_execution'/u);
assert.match(packagedConversationMainService, /plan_proposal_recording:\s*'main_only_digest_terminal_event'/u);
assert.match(packagedConversationMainService, /plan_review_recording:\s*'main_only_review_fact_no_execution'/u);
assert.match(packagedConversationMainService, /review_admission:\s*'sqlite_recorded_no_execution'/u);
assert.match(packagedConversationMainService, /run\.plan_review !== null/u);
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
assert.match(packagedTaskStreamProjection, /tool_call_requested/u);
assert.match(packagedTaskStreamProjection, /recorded_state:\s*'requested'/u);
assert.match(packagedTaskStreamProjection, /dispatch_admission:\s*'not_started'/u);
assert.match(packagedTaskStreamProjection, /execution_admission:\s*'not_performed'/u);
assert.match(packagedTaskStreamProjection, /result_admission:\s*'not_recorded'/u);
assert.match(packagedTaskStreamProjection, /tool_label:\s*publicToolLabel\(record\.action\)/u);
assert.match(packagedTaskStreamProjection, /tool_call_result_recorded/u);
assert.match(packagedTaskStreamProjection, /summary_code:\s*record\.result\.summary_code/u);
assert.match(packagedTaskStreamProjection, /display_summary:\s*record\.result\.display_summary/u);
assert.match(packagedTaskStreamProjection, /result_admission:\s*'fixed_summary_code_recorded'/u);
assert.match(packagedTaskStreamProjection, /raw_output_admission:\s*'not_included'/u);
assert.match(packagedTaskStreamProjection, /revision_admission:\s*'not_created'/u);
assert.doesNotMatch(packagedTaskStreamProjection, /session_policy|tool_name|permission_admission_receipt|permission_id|record_digest|evidence_digest|policy_digest|dispatch_request_id|dispatch_admission_digest|adapter_selection_id|adapter_selection_digest|runtime_invocation_id|runtime_invocation_digest|runtime_invocation_admission|adapter_id|runtime_id|resource_id/u);
assert.match(packagedTaskStreamProjection, /candidate_state:\s*'proposed'/u);
assert.match(packagedTaskStreamProjection, /source_availability:\s*'not_loaded'/u);
assert.match(packagedTaskStreamProjection, /plan_reviewed/u);
assert.match(packagedTaskStreamProjection, /plan_state:\s*payload\.decision/u);
assert.doesNotMatch(packagedTaskStreamProjection, /plan_result_digest|review_id|reviewer_id|reviewed_at_ms/u);
assert.match(packagedTaskStreamProjection, /sanitizeBuilderProviderContextDisclosureStatusProjection/u);
assert.doesNotMatch(
  packagedTaskStreamProjection,
  /node:sqlite|node:fs|builder-product-metadata|builder-git|ipcMain|ipcRenderer|BrowserWindow|preload|fetch\s*\(|provider_(?:secret|config|envelope|dispatch|context_body)|credential|source_tree/iu,
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
assert.match(packagedPlanReviewIpcAdapter, /builder_plan_review\.controlled_ipc_adapter\.v1/u);
assert.match(packagedPlanReviewIpcAdapter, /REVIEW_PLAN_CHANNEL/u);
assert.match(packagedPlanReviewIpcAdapter, /renderer_authority:\s*'plan_review_request_only'/u);
assert.match(packagedPlanReviewIpcAdapter, /review_fact_recording:\s*true/u);
assert.match(packagedPlanReviewIpcAdapter, /source_mutation:\s*false/u);
assert.match(packagedPlanReviewIpcAdapter, /save_authority:\s*false/u);
assert.match(packagedPlanReviewIpcAdapter, /project_revision_authority:\s*false/u);
assert.match(packagedPlanReviewIpcAdapter, /provider_dispatch:\s*false/u);
assert.match(packagedPlanReviewIpcAdapter, /credential_readback:\s*false/u);
assert.match(packagedPlanReviewIpcAdapter, /direct_electron_registration:\s*false/u);
assert.match(packagedPlanReviewIpcAdapter, /direct_preload_exposure:\s*false/u);
assert.doesNotMatch(
  packagedPlanReviewIpcAdapter,
  /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git-|node:sqlite|fetch\s*\(|https?:|saveDraft|generate|persist_candidate_commit|write_current|source_tree|commit_oid|tree_oid|plan_result_digest|review_id|reviewer_id|reviewed_at_ms|local-provider-executor/iu,
);
assert.match(packagedLivePreviewIpcAdapter, /createBuilderLivePreviewIpcAdapter/u);
assert.match(packagedLivePreviewIpcAdapter, /active_renderer_required:\s*true/u);
assert.match(packagedLivePreviewIpcAdapter, /authority\.source_tree_from_renderer !== 'not_accepted'/u);
assert.doesNotMatch(
  packagedLivePreviewIpcAdapter,
  /safeStorage|Authorization|Bearer|persist_candidate_commit|saveDraft|provider_dispatch:\s*true|tool_dispatch:\s*true|source_write:\s*'performed'/iu,
);
assert.match(packagedLivePreviewIpcRuntime, /builder-live-preview-ipc-runtime\.v1/u);
assert.match(packagedLivePreviewIpcRuntime, /createUnavailableBuilderLivePreviewService/u);
assert.doesNotMatch(
  packagedLivePreviewIpcRuntime,
  /ipcRenderer|contextBridge|safeStorage|Authorization|Bearer|persist_candidate_commit|saveDraft/iu,
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
for (const channel of permissionChannels) {
  assert.equal(
    packagedPermissionIpcAdapter.includes(channel)
      || packagedPermissionIpcRuntime.includes(channel)
      || packagedPreload.includes(channel),
    true,
    channel,
  );
}
for (const channel of livePreviewChannels) {
  assert.equal(
    packagedLivePreviewIpcAdapter.includes(channel) || packagedLivePreviewIpcRuntime.includes(channel),
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
