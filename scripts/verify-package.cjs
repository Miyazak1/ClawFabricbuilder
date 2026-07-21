'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const unpacked = path.join(root, 'release', 'win-unpacked');
const executable = path.join(unpacked, 'ClawFabric Builder.exe');
const archive = path.join(unpacked, 'resources', 'app.asar');
const builtIndex = path.join(root, 'dist', 'index.html');
const forbidden = /ChatCreatePage|chat_planner|CanvasPage|JobMeta|CurrentState|ResultRail|AppLayout|AuthProvider|ClawFabric v5/iu;

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

const html = fs.readFileSync(builtIndex, 'utf8');
assert.match(html, /connect-src 'none'/u);
assert.doesNotMatch(html, /127\.0\.0\.1|localhost|ws:\/\//u);
assert.doesNotMatch(html, /__BUILDER_CONNECT_SRC__/u);

const packagedEntries = asar.listPackage(archive).map((archivePath) => ({
  archivePath,
  normalizedPath: archivePath.replaceAll('\\', '/'),
}));
const packagedFiles = packagedEntries.map((entry) => entry.normalizedPath);
for (const expected of ['/electron/main.cjs', '/electron/preload.cjs', '/electron/runtime-options.cjs']) {
  assert.equal(packagedFiles.includes(expected), true, expected);
}
assert.equal(packagedFiles.some((entry) => forbidden.test(entry)), false);
assert.equal(packagedFiles.some((entry) => entry.startsWith('/node_modules/')), false);
for (const entry of packagedEntries.filter(
  (value) => /\.(?:cjs|css|html|js|json)$/u.test(value.normalizedPath),
)) {
  const source = asar.extractFile(archive, entry.archivePath.slice(1)).toString('utf8');
  assert.doesNotMatch(source, forbidden, entry.normalizedPath);
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
