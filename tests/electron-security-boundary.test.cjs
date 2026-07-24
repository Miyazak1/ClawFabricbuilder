'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('Electron shell exposes only sender-bound Builder authorities', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  assert.match(main, /contextIsolation:\s*true/u);
  assert.match(main, /nodeIntegration:\s*false/u);
  assert.match(main, /sandbox:\s*true/u);
  assert.match(main, /setWindowOpenHandler/u);
  assert.match(main, /Menu\.setApplicationMenu\(null\)/u);
  assert.match(main, /autoHideMenuBar:\s*true/u);
  assert.match(main, /frame:\s*false/u);
  assert.doesNotMatch(main, /titleBarStyle|titleBarOverlay/u);
  assert.match(main, /app\.isPackaged/u);
  assert.match(main, /setPermissionRequestHandler/u);
  assert.match(main, /setPermissionCheckHandler/u);
  assert.match(main, /app\.getPath\(['"]userData['"]\)/u);
  assert.match(main, /BUILDER_PACKAGED_CANARY/u);
  assert.match(main, /BUILDER_PACKAGED_CANARY_USER_DATA_PATH/u);
  assert.match(main, /clawfabric-builder-packaged-canary-/u);
  assert.match(main, /fs\.lstatSync/u);
  assert.match(main, /fs\.realpathSync\.native/u);
  assert.match(main, /app\.setPath\(['"]userData['"]/u);
  assert.match(main, /app\.setPath\(['"]sessionData['"]/u);
  assert.match(main, /app\.isPackaged/u);
  assert.match(main, /stat\.isSymbolicLink\(\)/u);
  assert.match(main, /requestSingleInstanceLock/u);
  assert.match(main, /app\.on\(['"]second-instance['"]/u);
  assert.match(main, /createBuilderProviderSettingsIpcRuntime/u);
  assert.match(main, /createBuilderGenerationIpcRuntime/u);
  assert.match(main, /createBuilderWindowControlsIpcRuntime/u);
  assert.match(main, /mainWindowRef:\s*\(\)\s*=>\s*mainWindow/u);
  assert.match(main, /const userDataPath = app\.getPath\(['"]userData['"]\)/u);
  assert.match(main, /const runtimes = createIpcRuntimes\(userDataPath\)/u);
  assert.match(main, /registerIpcRuntimes\(runtimes\)/u);
  assert.match(main, /ipcRuntimes = runtimes/u);
  assert.match(main, /\.catch\(\(\) => \{[\s\S]*disposeIpcRuntimes\(\)[\s\S]*app\.quit\(\)/u);
  assert.doesNotMatch(main, /webSecurity:\s*false|enableRemoteModule|clawfabricDesktop/u);
  assert.match(preload, /builder-preload\.v3/u);
  assert.match(preload, /projectWorkspace/u);
  assert.match(preload, /\bopen\b/u);
  assert.match(preload, /saveDraft/u);
  assert.match(preload, /listCurrent/u);
  assert.match(preload, /codeGenerator/u);
  assert.match(preload, /\banswer\b/u);
  assert.match(preload, /clawfabric-builder:code-generator:answer/u);
  assert.match(preload, /restoreDraft/u);
  assert.match(preload, /clawfabric-builder:code-generator:restore-draft/u);
  assert.match(preload, /providerSettings/u);
  assert.match(preload, /taskStream/u);
  assert.match(preload, /clawfabric-builder:task-stream:read/u);
  assert.match(preload, /windowControls/u);
  assert.match(preload, /clawfabric-builder:window-controls:minimize/u);
  assert.match(preload, /clawfabric-builder:window-controls:toggle-maximize/u);
  assert.match(preload, /clawfabric-builder:window-controls:close/u);
  assert.match(preload, /clawfabric-builder:window-controls:read-state/u);
  assert.equal((preload.match(/ipcRenderer\.invoke/g) || []).length, 17);
  assert.doesNotMatch(preload, /conversationStream|projectActivity|readStream/u);
  assert.doesNotMatch(
    preload,
    /ipcRenderer\.(?:send|on|once)|require\(['"]node:|clawfabricDesktop|desktop:builder|closeWindow|safeStorage|Authorization|Bearer/iu,
  );
});

test('build and package scripts require production artifact verification', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.pack, /verify:package/u);
  assert.match(packageJson.scripts.dist, /verify:package/u);
  const verifier = fs.readFileSync(path.join(root, 'scripts', 'verify-package.cjs'), 'utf8');
  assert.match(verifier, /connect-src 'none'/u);
  assert.match(verifier, /CompanyName:\s*'ClawFabric'/u);
  assert.match(verifier, /asar\.listPackage/u);
  assert.match(verifier, /asar\.extractFile/u);
  assert.match(verifier, /ts\.createSourceFile/u);
  assert.match(verifier, /exactObjectKeys/u);
  assert.match(verifier, /forbiddenRendererReferences/u);
  assert.match(verifier, /verify-packaged-canary\.cjs/u);
  assert.match(verifier, /playwright-core/u);
});
