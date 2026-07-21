'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveBuilderRendererTarget,
} = require('../electron/runtime-options.cjs');

test('packaged mode always ignores development URL input', () => {
  for (const rendererUrl of [
    '',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'https://example.invalid',
  ]) {
    assert.deepEqual(resolveBuilderRendererTarget({
      isPackaged: true,
      rendererUrl,
    }), {
      version: 'builder-renderer-target.v1',
      kind: 'packaged_file',
    });
  }
});

test('development mode accepts only the exact loopback Vite URL', () => {
  assert.deepEqual(resolveBuilderRendererTarget({
    isPackaged: false,
    rendererUrl: 'http://127.0.0.1:5173',
  }), {
    version: 'builder-renderer-target.v1',
    kind: 'development_url',
    url: 'http://127.0.0.1:5173',
  });
  for (const rendererUrl of ['http://localhost:5173', 'http://127.0.0.1:5174', null]) {
    assert.equal(resolveBuilderRendererTarget({
      isPackaged: false,
      rendererUrl,
    }).kind, 'packaged_file');
  }
});
