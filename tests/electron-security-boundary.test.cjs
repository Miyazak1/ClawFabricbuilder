'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('Electron shell exposes only sender-bound Builder project authorities', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  assert.match(main, /contextIsolation:\s*true/u);
  assert.match(main, /nodeIntegration:\s*false/u);
  assert.match(main, /sandbox:\s*true/u);
  assert.match(main, /setWindowOpenHandler/u);
  assert.match(main, /app\.isPackaged/u);
  assert.match(main, /setPermissionRequestHandler/u);
  assert.match(main, /setPermissionCheckHandler/u);
  assert.match(main, /createBuilderProjectIpcRuntime/u);
  assert.match(main, /app\.getPath\(['"]userData['"]\)/u);
  assert.match(main, /requestSingleInstanceLock/u);
  assert.match(main, /app\.on\(['"]second-instance['"]/u);
  assert.match(main, /\.catch\(\(\) => \{[\s\S]*projectIpcRuntime\?\.dispose\(\)[\s\S]*app\.quit\(\)/u);
  assert.doesNotMatch(main, /webSecurity:\s*false|enableRemoteModule|clawfabricDesktop/u);
  assert.match(preload, /builder-preload\.v1/u);
  assert.match(preload, /projectRevisions/u);
  assert.match(preload, /projectCatalog/u);
  assert.equal((preload.match(/ipcRenderer\.invoke/g) || []).length, 3);
  assert.doesNotMatch(preload, /ipcRenderer\.(?:send|on|once)|require\(['"]node:|clawfabricDesktop|desktop:builder/u);
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
});
