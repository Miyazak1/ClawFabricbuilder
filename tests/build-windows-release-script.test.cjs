'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('dist uses the guarded Windows release builder and keeps package verification', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts.dist,
    'npm run build && node scripts/build-windows-release.cjs && npm run verify:package',
  );
  assert.match(packageJson.scripts['verify:release'], /npm run dist/u);
  assert.match(packageJson.scripts.dist, /verify:package/u);
});

test('guarded Windows release builder packages in ignored work output before copying release artifacts', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'build-windows-release.cjs'), 'utf8');
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

  assert.match(gitignore, /^\.release-work\/$/mu);
  assert.match(source, /electron-builder[\s\S]*cli\.js/u);
  assert.match(source, /process\.execPath/u);
  assert.match(source, /--win/u);
  assert.match(source, /nsis/u);
  assert.match(source, /\.release-work/u);
  assert.match(source, /--config\.directories\.output=/u);
  assert.match(source, /win-unpacked/u);
  assert.match(source, /productName = 'ClawFabric Builder'/u);
  assert.match(source, /setupName = `\$\{productName\} Setup 0\.1\.0\.exe`/u);
  assert.match(source, /transientWindowsLock/u);
  assert.match(source, /EBUSY/u);
  assert.match(source, /EPERM/u);
  assert.match(source, /UNKNOWN/u);
  assert.doesNotMatch(source, /git\s+(?:add|commit|push)|rmSync\(releaseDirectory/u);
});
