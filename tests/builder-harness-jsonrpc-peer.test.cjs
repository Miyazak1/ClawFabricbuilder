'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  MAX_FRAME_BYTES,
  BuilderHarnessJsonRpcPeerError,
  createBuilderHarnessJsonRpcPeer,
} = require('../electron/builder-harness-jsonrpc-peer.cjs');

function createPeer(overrides = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const notifications = [];
  const peer = createBuilderHarnessJsonRpcPeer({
    input,
    output,
    on_notification(notification) {
      notifications.push(notification);
    },
    request_timeouts: overrides.request_timeouts ?? {
      initialize_ms: 1_000,
      session_prompt_ms: null,
      shutdown_ms: 1_000,
    },
    set_timeout: setTimeout,
    clear_timeout: clearTimeout,
  });
  return { input, output, notifications, peer };
}

function nextFrame(stream) {
  return new Promise((resolve) => {
    stream.once('data', (chunk) => resolve(JSON.parse(chunk.toString('utf8').trim())));
  });
}

function writeFrame(stream, frame, ending = '\n') {
  stream.write(`${JSON.stringify(frame)}${ending}`);
}

function hasCode(code) {
  return (error) => error instanceof BuilderHarnessJsonRpcPeerError && error.code === code;
}

test('writes initialize requests and accepts split responses plus ordered notifications', async () => {
  const { input, output, notifications, peer } = createPeer();
  const outgoing = nextFrame(input);
  const response = peer.request({
    method: 'initialize',
    params: {
      cwd: 'C:\\project',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      maxTokens: 4096,
    },
  });
  const request = await outgoing;
  assert.deepEqual(request, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      cwd: 'C:\\project',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      maxTokens: 4096,
    },
  });

  output.write('{"jsonrpc":"2.0","method":"session.status","params":');
  output.write('{"sessionId":"session-1","status":"running"}}\n');
  output.write('{"jsonrpc":"2.0","id":1,"result":{"serverInfo":');
  output.write('{"name":"deepseek-harness-sdk-runtime","version":"0.1.0"}}}\n');

  assert.deepEqual(await response, {
    serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(notifications, [{
    method: 'session.status',
    params: { sessionId: 'session-1', status: 'running' },
  }]);
  assert.ok(Object.isFrozen(notifications[0]));
  assert.ok(Object.isFrozen(notifications[0].params));
  peer.close();
});

test('correlates concurrent responses by id and accepts CRLF framing', async () => {
  const { input, output, peer } = createPeer();
  const frames = [];
  input.on('data', (chunk) => frames.push(JSON.parse(chunk.toString('utf8').trim())));
  const first = peer.request({
    method: 'session/prompt',
    params: { sessionId: 'one', contentBlocks: [{ type: 'text', text: 'first' }] },
  });
  const second = peer.request({
    method: 'session/prompt',
    params: { sessionId: 'two', contentBlocks: [{ type: 'text', text: 'second' }] },
  });
  assert.deepEqual(frames.map((frame) => frame.id), [1, 2]);

  writeFrame(output, { jsonrpc: '2.0', id: 2, result: { messageId: 'message-2' } }, '\r\n');
  writeFrame(output, { jsonrpc: '2.0', id: 1, result: { messageId: 'message-1' } }, '\r\n');
  assert.deepEqual(await first, { messageId: 'message-1' });
  assert.deepEqual(await second, { messageId: 'message-2' });
  peer.close();
});

test('allows manual compaction requests through the bounded whitelist', async () => {
  const { input, output, peer } = createPeer();
  const sourceCommandId = `builder-context-compaction-admission:${'a'.repeat(64)}`;
  const outgoing = nextFrame(input);
  const compact = peer.request({
    method: 'session/compact',
    params: {
      sessionId: 'builder-harness-11111111-1111-4111-8111-111111111111',
      sourceCommandId,
    },
  });
  const request = await outgoing;
  assert.deepEqual(request, {
    jsonrpc: '2.0',
    id: 1,
    method: 'session/compact',
    params: {
      sessionId: 'builder-harness-11111111-1111-4111-8111-111111111111',
      sourceCommandId,
    },
  });
  writeFrame(output, {
    jsonrpc: '2.0',
    id: 1,
    result: {
      compactionId: 'compaction:manual-1',
      sourceCommandId,
      startSeq: 10,
      summarySeq: 11,
      endSeq: 13,
      shadowedTokenCount: 48_000,
    },
  });
  assert.deepEqual(await compact, {
    compactionId: 'compaction:manual-1',
    sourceCommandId,
    startSeq: 10,
    summarySeq: 11,
    endSeq: 13,
    shadowedTokenCount: 48_000,
  });
  peer.close();
});

test('accepts the bounded native context-usage notification as an ordered whole value', async () => {
  const { output, notifications, peer } = createPeer();
  writeFrame(output, {
    jsonrpc: '2.0',
    method: 'session.context-usage',
    params: {
      sessionId: 'builder-harness-11111111-1111-4111-8111-111111111111',
      projectionSeq: 42,
      uncachedInputTokens: 20_000,
      outputTokens: 5_000,
      cacheReadTokens: 180_000,
      cacheWriteTokens: 0,
      pressureTokens: 200_000,
      projectedTokens: 205_000,
      contextWindowTokens: 258_000,
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].method, 'session.context-usage');
  assert.equal(notifications[0].params.cacheReadTokens, 180_000);
  assert.ok(Object.isFrozen(notifications[0].params));
  peer.close();
});

test('sends shutdown without params and rejects requests after close', async () => {
  const { input, output, peer } = createPeer();
  const outgoing = nextFrame(input);
  const shutdown = peer.request({ method: 'shutdown', params: null });
  const request = await outgoing;
  assert.deepEqual(request, { jsonrpc: '2.0', id: 1, method: 'shutdown' });
  writeFrame(output, { jsonrpc: '2.0', id: 1, result: {} });
  assert.deepEqual(await shutdown, {});
  peer.close();
  await assert.rejects(
    peer.request({ method: 'shutdown', params: null }),
    hasCode('builder_harness_jsonrpc_closed'),
  );
});

test('returns fixed remote and timeout failures without exposing wire messages', async () => {
  const remote = createPeer();
  const remoteRequest = remote.peer.request({
    method: 'session/prompt',
    params: { sessionId: 'one', contentBlocks: [{ type: 'text', text: 'hello' }] },
  });
  writeFrame(remote.output, {
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32603, message: 'provider secret and internal detail' },
  });
  await assert.rejects(
    remoteRequest,
    (error) => hasCode('builder_harness_jsonrpc_remote_error')(error)
      && !error.message.includes('provider secret'),
  );
  remote.peer.close();

  const timed = createPeer({
    request_timeouts: {
      initialize_ms: 1_000,
      session_prompt_ms: 100,
      shutdown_ms: 1_000,
    },
  });
  await assert.rejects(
    timed.peer.request({
      method: 'session/prompt',
      params: { sessionId: 'one', contentBlocks: [{ type: 'text', text: 'hello' }] },
    }),
    hasCode('builder_harness_jsonrpc_timeout'),
  );
  assert.equal(timed.peer.is_closed(), false);
  timed.peer.close();
});

test('does not apply handshake timeout to a long-running session prompt', async () => {
  const { input, output, peer } = createPeer({
    request_timeouts: {
      initialize_ms: 100,
      session_prompt_ms: null,
      shutdown_ms: 100,
    },
  });
  const outgoing = nextFrame(input);
  const prompt = peer.request({
    method: 'session/prompt',
    params: { sessionId: 'one', contentBlocks: [{ type: 'text', text: 'continue' }] },
  });
  const frame = await outgoing;
  await new Promise((resolve) => setTimeout(resolve, 125));
  writeFrame(output, { jsonrpc: '2.0', id: frame.id, result: { messageId: 'message-late' } });
  assert.deepEqual(await prompt, { messageId: 'message-late' });
  peer.close();
});

test('fails closed on malformed, unknown, duplicate, oversized, and invalid UTF-8 frames', async () => {
  for (const writeInvalid of [
    (output) => output.write('not-json\n'),
    (output) => writeFrame(output, {
      jsonrpc: '2.0', method: 'unknown.notification', params: {},
    }),
    (output) => writeFrame(output, { jsonrpc: '2.0', id: 999, result: {} }),
    (output) => output.write(`${'x'.repeat(MAX_FRAME_BYTES + 1)}\n`),
    (output) => output.write(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d, 0x0a])),
  ]) {
    const { output, peer } = createPeer();
    const pending = peer.request({
      method: 'session/prompt',
      params: { sessionId: 'one', contentBlocks: [{ type: 'text', text: 'hello' }] },
    });
    writeInvalid(output);
    await assert.rejects(
      pending,
      hasCode('builder_harness_jsonrpc_protocol_error'),
    );
    assert.equal(peer.is_closed(), true);
  }
});

test('rejects unapproved methods, unsafe payload objects, and oversized requests', async () => {
  const { peer } = createPeer();
  await assert.rejects(
    peer.request({ method: 'workspace/delete', params: {} }),
    hasCode('builder_harness_jsonrpc_invalid'),
  );
  await assert.rejects(
    peer.request({
      method: 'initialize',
      params: new Proxy({ cwd: 'C:\\project' }, {}),
    }),
    hasCode('builder_harness_jsonrpc_invalid'),
  );
  await assert.rejects(
    peer.request({
      method: 'session/prompt',
      params: {
        sessionId: 'one',
        contentBlocks: [{ type: 'text', text: 'x'.repeat(MAX_FRAME_BYTES) }],
      },
    }),
    hasCode('builder_harness_jsonrpc_invalid'),
  );
  peer.close();
});

test('protocol peer owns no process, filesystem, renderer, provider, or credential authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-harness-jsonrpc-peer.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|DatabaseSync|node:sqlite)\b/u);
  assert.doesNotMatch(source, /\b(?:readFile|writeFile|absolute_path|workspace_path)\b/u);
  assert.doesNotMatch(source, /\b(?:ipcMain|ipcRenderer|contextBridge|BrowserWindow|fetch)\b/u);
  assert.doesNotMatch(source, /api[_-]?key|Bearer|credential_value|secret_store/u);
});
