'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('Electron shell is isolated and exposes no product authority in N0', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  assert.match(main, /contextIsolation:\s*true/u);
  assert.match(main, /nodeIntegration:\s*false/u);
  assert.match(main, /sandbox:\s*true/u);
  assert.match(main, /setWindowOpenHandler/u);
  assert.match(main, /app\.isPackaged/u);
  assert.match(main, /setPermissionRequestHandler/u);
  assert.match(main, /setPermissionCheckHandler/u);
  assert.doesNotMatch(main, /ipcMain|webSecurity:\s*false|enableRemoteModule/u);
  assert.match(preload, /builder-preload\.v1/u);
  assert.doesNotMatch(preload, /ipcRenderer|require\(['"]node:/u);
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
});
