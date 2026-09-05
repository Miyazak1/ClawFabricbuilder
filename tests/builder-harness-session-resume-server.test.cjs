'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const sessionId = 'builder-harness-11111111-1111-4111-8111-111111111111';

test('contains broken JSON-RPC output writes at the sidecar transport boundary', async () => {
  const {
    installBuilderJsonRpcTransportWriteBoundary,
    isBuilderBrokenTransportWrite,
  } = await import('../electron/harness/builder-session-resume-server.mjs');
  const listeners = new Map();
  const reports = [];
  let closed = 0;
  const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE', syscall: 'write' });
  const output = {
    write() { throw epipe; },
    on(event, listener) { listeners.set(event, listener); },
    off(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
  };
  const transport = installBuilderJsonRpcTransportWriteBoundary({
    output,
    notify(method, params) { this.write({ jsonrpc: '2.0', method, params }); },
    async flush() { throw epipe; },
    close() { closed += 1; },
  }, {
    onTransportError(report) { reports.push(report); },
  });

  assert.equal(isBuilderBrokenTransportWrite(epipe), true);
  assert.doesNotThrow(() => transport.notify('session.status', { sessionId, status: 'idle' }));
  await assert.doesNotReject(() => transport.flush());
  assert.equal(closed, 1);
  assert.deepEqual(reports, [{
    code: 'builder_harness_jsonrpc_transport_closed',
    cause_code: 'EPIPE',
    syscall: 'write',
  }]);
  assert.equal(listeners.has('error'), true);
  assert.doesNotThrow(() => listeners.get('error')(epipe));
  transport.close();
  assert.equal(listeners.has('error'), false);
});

test('does not hide non-transport JSON-RPC write failures', async () => {
  const {
    installBuilderJsonRpcTransportWriteBoundary,
    isBuilderBrokenTransportWrite,
  } = await import('../electron/harness/builder-session-resume-server.mjs');
  const error = Object.assign(new Error('serializer bug'), { code: 'BUG' });
  const transport = installBuilderJsonRpcTransportWriteBoundary({
    output: {
      write() { throw error; },
      on() {},
      off() {},
    },
    async flush() {},
    close() {},
  });

  assert.equal(isBuilderBrokenTransportWrite(error), false);
  assert.throws(() => transport.write({ jsonrpc: '2.0', method: 'session.status' }), /serializer bug/u);

  const listeners = new Map();
  installBuilderJsonRpcTransportWriteBoundary({
    output: {
      write() { return true; },
      on(event, listener) { listeners.set(event, listener); },
      off() {},
    },
    async flush() {},
    close() {},
  });
  assert.throws(() => listeners.get('error')(error), /serializer bug/u);
});

test('keeps structured JSON-RPC business errors when the sidecar output is writable', async () => {
  const {
    installBuilderJsonRpcTransportWriteBoundary,
  } = await import('../electron/harness/builder-session-resume-server.mjs');
  const frames = [];
  const transport = installBuilderJsonRpcTransportWriteBoundary({
    output: {
      write(frame) { frames.push(JSON.parse(frame.trim())); return true; },
      on() {},
      off() {},
    },
    writeError(id, code, message) {
      this.write({ jsonrpc: '2.0', id, error: { code, message } });
    },
    async flush() {},
    close() {},
  });

  transport.writeError('request-1', -32603, 'business failure');
  assert.deepEqual(frames, [{
    jsonrpc: '2.0',
    id: 'request-1',
    error: { code: -32603, message: 'business failure' },
  }]);
});

test('publishes a deduplicated whole native context snapshot for only the bound session', async () => {
  const {
    createBuilderContextUsageProjectionBridge,
    sanitizeBuilderContextUsageSnapshot,
  } = await import('../electron/harness/builder-session-resume-server.mjs');
  const session = { id: sessionId };
  let listener = null;
  let snapshot = {
    asOfSeq: 42,
    values: {
      tokenUsage: {
        uncachedInputTokens: 20_000,
        outputTokens: 5_000,
        cacheReadTokens: 180_000,
        cacheWriteTokens: 0,
      },
      contextPressure: {
        pressureTokens: 200_000,
        projectedTokens: 205_000,
        contextWindow: 258_000,
      },
    },
  };
  const notifications = [];
  let disposed = false;
  const bridge = createBuilderContextUsageProjectionBridge({
    sessionProjections: {
      snapshot() { return snapshot; },
      onChanged(next) { listener = next; return () => { disposed = true; }; },
    },
    notify(method, params) { notifications.push({ method, params }); },
    getSelectedSessionId: () => sessionId,
  });
  assert.deepEqual(sanitizeBuilderContextUsageSnapshot(sessionId, snapshot), {
    sessionId,
    projectionSeq: 42,
    uncachedInputTokens: 20_000,
    outputTokens: 5_000,
    cacheReadTokens: 180_000,
    cacheWriteTokens: 0,
    pressureTokens: 200_000,
    projectedTokens: 205_000,
    contextWindowTokens: 258_000,
  });
  assert.equal(bridge.publish({ id: sessionId.replace('11111111', '22222222') }), false);
  assert.equal(bridge.publish(session), true);
  assert.equal(bridge.publish(session), false);
  snapshot = {
    ...snapshot,
    asOfSeq: 43,
    values: {
      ...snapshot.values,
      contextPressure: { ...snapshot.values.contextPressure, projectedTokens: 206_000 },
    },
  };
  listener(session, 'contextPressure');
  listener(session, 'todos');
  assert.equal(notifications.length, 2);
  assert.deepEqual(notifications.map(({ method }) => method), [
    'session.context-usage',
    'session.context-usage',
  ]);
  assert.equal(notifications[1].params.projectedTokens, 206_000);
  bridge.dispose();
  assert.equal(disposed, true);
});
async function fixture(resumeError = null, compactResult = null, overrides = {}) {
  const { createResumeDispatcher } = await import('../electron/harness/builder-session-resume-server.mjs');
  const calls = [];
  const session = { id: sessionId };
  const agent = {
    id: sessionId,
    session,
    followup(message) { calls.push(['followup', message]); },
    async whenIdle() { calls.push(['whenIdle']); },
  };
  const dispatcher = createResumeDispatcher({
    ctx: { agents: {
      async resume(options) { calls.push(['resume', options]); if (resumeError) throw resumeError; return {
        agent, async dispose() { calls.push(['dispose']); },
      }; },
      get() { return Object.hasOwn(overrides, 'getAgent') ? overrides.getAgent : agent; },
      async withInitiator(initiatorAgent, operation) {
        calls.push(['withInitiator', initiatorAgent]);
        return operation();
      },
    }, compaction: {
      async compactNow(compactAgent, signal, sourceCommandId) {
        calls.push(['compactNow', compactAgent, signal.aborted, sourceCommandId]);
        return typeof compactResult === 'function'
          ? compactResult(sourceCommandId)
          : compactResult;
      },
    } },
    server: {
      async handleRequest(method, params) { calls.push([method, params]); return {}; },
      async shutdown() { calls.push(['shutdown']); },
    },
    createUserMessage(message) { return { ...message, id: 'message-next' }; },
    SessionId: id => id,
    setRestoring(value) { calls.push(['restoring', value]); },
    setSelectedSessionId(value) { calls.push(['selected', value]); },
    publishProjection(value) { calls.push(['projection', value]); },
  });
  await dispatcher.handleRequest('initialize', { cwd: '/workspace', provider: 'deepseek-official', model: 'model', maxTokens: 2000 });
  return { dispatcher, calls };
}

test('restores the retained session through the public factory once, then follows up without creating another session', async () => {
  const { dispatcher, calls } = await fixture();
  assert.deepEqual(await dispatcher.handleRequest('session/resume', { sessionId }), { sessionId, restored: true });
  await dispatcher.handleRequest('session/resume', { sessionId });
  assert.deepEqual(await dispatcher.handleRequest('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text: 'Continue remaining work.' }] }), { messageId: 'message-next' });
  assert.equal(calls.filter(([kind]) => kind === 'resume').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'session/prompt').length, 0);
  assert.deepEqual(calls.find(([kind]) => kind === 'resume')[1], {
    resumeSessionId: sessionId, agentOptions: { provider: 'deepseek-official', model: 'model', maxTokens: 2000 },
  });
  assert.deepEqual(calls.filter(([kind]) => kind === 'restoring'), [['restoring', true], ['restoring', false]]);
  assert.deepEqual(calls.filter(([kind]) => kind === 'projection'), [['projection', { id: sessionId }]]);
  assert.ok(
    calls.findIndex(([kind]) => kind === 'projection') < calls.findIndex(([kind]) => kind === 'followup'),
  );
  await dispatcher.shutdown();
  await dispatcher.shutdown();
  assert.equal(calls.filter(([kind]) => kind === 'dispose').length, 1);
});

test('missing or corrupt persisted history never falls back to a fresh session', async () => {
  const { dispatcher, calls } = await fixture(new Error('Missing session'));
  await assert.rejects(dispatcher.handleRequest('session/resume', { sessionId }), /Missing session/);
  await assert.rejects(dispatcher.handleRequest('session/prompt', { sessionId, contentBlocks: [] }), /Missing session/);
  assert.equal(calls.some(([kind]) => kind === 'session/prompt' || kind === 'followup'), false);
  await dispatcher.shutdown();
});

test('compacts the restored selected session through Harness compactNow only after admission identity', async () => {
  const sourceCommandId = `builder-context-compaction-admission:${'a'.repeat(64)}`;
  const { dispatcher, calls } = await fixture(null, commandId => ({
    compactionId: 'compaction:manual-1',
    sourceCommandId: commandId,
    startSeq: 2,
    summarySeq: 3,
    endSeq: 4,
    shadowedTokenCount: 1200,
    summary: 'private summary text not returned by the sidecar bridge',
    shadowedRange: { startSeq: 2, endSeq: 4 },
    shadowedSeqs: [2],
  }));
  await dispatcher.handleRequest('session/resume', { sessionId });
  assert.deepEqual(
    await dispatcher.handleRequest('session/compact', { sessionId, sourceCommandId }),
    {
      compactionId: 'compaction:manual-1',
      sourceCommandId,
      startSeq: 2,
      summarySeq: 3,
      endSeq: 4,
      shadowedTokenCount: 1200,
    },
  );
  assert.equal(calls.filter(([kind]) => kind === 'compactNow').length, 1);
  assert.equal(
    calls.findIndex(([kind]) => kind === 'whenIdle') < calls.findIndex(([kind]) => kind === 'compactNow'),
    true,
  );
  assert.equal(
    calls.findIndex(([kind]) => kind === 'whenIdle') < calls.findIndex(([kind]) => kind === 'withInitiator'),
    true,
  );
  assert.equal(
    calls.findIndex(([kind]) => kind === 'withInitiator') < calls.findIndex(([kind]) => kind === 'compactNow'),
    true,
  );
  assert.deepEqual(calls.filter(([kind]) => kind === 'projection'), [
    ['projection', { id: sessionId }],
  ]);
  assert.equal(JSON.stringify(calls).includes('private summary text'), false);
  await dispatcher.shutdown();
});

test('restores an idle selected session before manual compact when the prompt agent is no longer retained', async () => {
  const sourceCommandId = `builder-context-compaction-admission:${'f'.repeat(64)}`;
  const { dispatcher, calls } = await fixture(null, commandId => ({
    compactionId: 'compaction:manual-restored-1',
    sourceCommandId: commandId,
    startSeq: 5,
    summarySeq: 6,
    endSeq: 7,
    shadowedTokenCount: 2400,
  }), { getAgent: null });
  await dispatcher.handleRequest('session/prompt', {
    sessionId,
    contentBlocks: [{ type: 'text', text: 'Create history before manual compact.' }],
  });

  assert.deepEqual(
    await dispatcher.handleRequest('session/compact', { sessionId, sourceCommandId }),
    {
      compactionId: 'compaction:manual-restored-1',
      sourceCommandId,
      startSeq: 5,
      summarySeq: 6,
      endSeq: 7,
      shadowedTokenCount: 2400,
    },
  );
  assert.equal(calls.filter(([kind]) => kind === 'resume').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'compactNow').length, 1);
  assert.deepEqual(calls.filter(([kind]) => kind === 'restoring'), [
    ['restoring', true],
    ['restoring', false],
  ]);
  assert.equal(
    calls.findIndex(([kind]) => kind === 'resume') < calls.findIndex(([kind]) => kind === 'compactNow'),
    true,
  );
  assert.equal(
    calls.findIndex(([kind]) => kind === 'whenIdle') < calls.findIndex(([kind]) => kind === 'compactNow'),
    true,
  );
  assert.equal(
    calls.findIndex(([kind]) => kind === 'withInitiator') < calls.findIndex(([kind]) => kind === 'compactNow'),
    true,
  );
  await dispatcher.shutdown();
});

test('projects manual compact no-op and rejects forged compact requests', async () => {
  const sourceCommandId = `builder-context-compaction-admission:${'b'.repeat(64)}`;
  const { dispatcher, calls } = await fixture(null, null);
  await dispatcher.handleRequest('session/resume', { sessionId });
  assert.equal(await dispatcher.handleRequest('session/compact', { sessionId, sourceCommandId }), null);
  await assert.rejects(
    dispatcher.handleRequest('session/compact', { sessionId, sourceCommandId: 'forged' }),
    /admission identity/u,
  );
  await assert.rejects(
    dispatcher.handleRequest('session/compact', { sessionId, sourceCommandId, prompt: '/compact' }),
    /Invalid compact request/u,
  );
  assert.equal(calls.filter(([kind]) => kind === 'compactNow').length, 1);
  await dispatcher.shutdown();
});

test('rejects cross-session switching and resume after creating a new session', async () => {
  const { dispatcher } = await fixture();
  await dispatcher.handleRequest('session/prompt', { sessionId, contentBlocks: [] });
  await assert.rejects(dispatcher.handleRequest('session/resume', { sessionId }), /already running/);
  await assert.rejects(dispatcher.handleRequest('session/resume', { sessionId: sessionId.replace('11111111', '22222222') }), /another Builder session/);
  await dispatcher.shutdown();
  await assert.rejects(dispatcher.handleRequest('session/prompt', { sessionId }), /shutting down/);
});

for (const restore of [false, true]) {
  test(`one-shot empty-output recovery changes only effort on the selected ${restore ? 'restored' : 'new'} task`, async () => {
    const { dispatcher } = await fixture();
    const prompt = { sessionId, contentBlocks: [{ type: 'text', text: 'Continue the bound plan.' }] };
    const config = { provider: 'deepseek-official', model: 'model', maxTokens: 2000, reasoningEffort: 'high' };
    const request = (id = sessionId) => dispatcher.resolveRequest({ agent: { session: { id } } }, async () => config);
    await assert.rejects(dispatcher.handleRequest('session/recover-empty-output', prompt), /existing task/);
    if (restore) await dispatcher.handleRequest('session/resume', { sessionId });
    else await dispatcher.handleRequest('session/prompt', prompt);
    assert.strictEqual(await request(), config);
    await dispatcher.handleRequest('session/recover-empty-output', prompt);
    assert.deepEqual(await request(), { ...config, reasoningEffort: 'off' });
    assert.deepEqual(await request(), { ...config, reasoningEffort: 'off' });
    assert.strictEqual(await request('another-session'), config);
    await assert.rejects(dispatcher.handleRequest('session/recover-empty-output', prompt), /one-shot/);
    await dispatcher.handleRequest('session/prompt', prompt);
    assert.strictEqual(await request(), config);
    await assert.rejects(dispatcher.handleRequest('session/recover-empty-output', prompt), /one-shot/);
    await dispatcher.shutdown();
    assert.strictEqual(await request(), config);
  });
}
