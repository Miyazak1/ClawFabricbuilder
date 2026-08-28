'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const CONFIG_PATH = path.resolve(
  __dirname,
  '../electron/harness/builder-coding-loop.cordis.yml',
);
const COMPACTION_CONFIG_PATH = path.resolve(
  __dirname,
  '../electron/harness/builder-coding-loop-compaction-canary.cordis.yml',
);

test('pins a sliding Harness stream-idle boundary without a total request timeout', () => {
  const config = fs.readFileSync(CONFIG_PATH, 'utf8');

  assert.match(config, /^\s+streamIdleTimeoutMs:\s+300000\s*$/mu);
  assert.match(config, /^\s+maxParallelToolCalls:\s+4\s*$/mu);
  assert.match(config, /^\s+name:\s+'@deepseek-ai\/dsh-token-meter'\s*$/mu);
  assert.match(config, /^\s+name:\s+'@deepseek-ai\/dsh-compaction-tool-result-pruner'\s*$/mu);
  assert.match(config, /^\s+name:\s+'@deepseek-ai\/dsh-compaction-basic'\s*$/mu);
  assert.doesNotMatch(config, /^\s+(?:timeout_ms|requestTimeoutMs):/mu);
});

test('keeps DeepSeek reasoning enabled in production and compaction profiles', () => {
  for (const configPath of [CONFIG_PATH, COMPACTION_CONFIG_PATH]) {
    const config = fs.readFileSync(configPath, 'utf8');

    assert.match(config, /^\s+thinking:\s+enabled\s*$/mu);
    assert.match(config, /^\s+reasoningEffort:\s+high\s*$/mu);
    assert.match(config, /^\s+name:\s+'@deepseek-ai\/dsh-user-questions'\s*$/mu);
    assert.match(config, /^\s+name:\s+'@deepseek-ai\/dsh-tool-ask-user'\s*$/mu);
    assert.doesNotMatch(config, /^\s+thinking:\s+disabled\s*$/mu);
    assert.doesNotMatch(config, /^\s+reasoningEffort:\s+off\s*$/mu);
  }
});
