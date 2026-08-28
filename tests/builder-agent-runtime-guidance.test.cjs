'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');

test('agent guide preserves detect-before-install dependency readiness policy', () => {
  const guide = fs.readFileSync(path.join(repositoryRoot, 'AGENTS.md'), 'utf8');

  assert.match(guide, /detect existing tools and dependencies before/u);
  assert.match(guide, /Detect the host toolchain state/u);
  assert.match(guide, /Detect the project package manager/u);
  assert.match(guide, /isolated current-draft check workspace/u);
  assert.match(guide, /explicitly approves the scoped action/u);
  assert.match(guide, /Existing prepared dependencies must not be reinstalled blindly/u);
});

test('agent guide keeps dependency preparation separate from Settings, Browser, Preview, and sandbox approval', () => {
  const guide = fs.readFileSync(path.join(repositoryRoot, 'AGENTS.md'), 'utf8');

  assert.match(guide, /Prepare once/u);
  assert.match(guide, /only for the current draft's isolated\s+check workspace/u);
  assert.match(guide, /Do not install into the project root from Settings/u);
  assert.match(guide, /Do not treat command approval, sandbox selection, network permission, Save,\s+Browser\/Preview approval, or dev-server approval as dependency-install\s+approval/u);
  assert.match(guide, /Harness consumes redacted readiness facts/u);
  assert.match(guide, /Browser\/Preview must not\s+start dependency installation/u);
});
