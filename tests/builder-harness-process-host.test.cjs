'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  createBuilderHarnessProcessAdapter,
} = require('../electron/builder-harness-process-adapter.cjs');
const {
  BuilderHarnessProcessHostError,
  createBuilderHarnessProcessHost,
} = require('../electron/builder-harness-process-host.cjs');

function runtimeChild() {
  const child = new EventEmitter();
  child.pid = process.pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalls = 0;
  child.kill = () => {
    child.killCalls += 1;
    return true;
  };
  return child;
}

function respond(stream, id, result) {
  stream.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function serve(child, handler) {
  let buffered = '';
  child.stdin.on('data', (chunk) => {
    buffered += chunk.toString('utf8');
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      handler(JSON.parse(line));
      newline = buffered.indexOf('\n');
    }
  });
}

function harness(overrides = {}) {
  const child = overrides.child ?? runtimeChild();
  const spawnCalls = [];
  const adapter = createBuilderHarnessProcessAdapter({
    spawn_process(file, args, options) {
      spawnCalls.push({ file, args, options });
      return child;
    },
    platform: 'linux',
    windows_root: null,
  });
  const notifications = [];
  const cwd = path.resolve('harness-workspace');
  const host = createBuilderHarnessProcessHost({
    process_adapter: adapter,
    launch: {
      executable: path.resolve(process.execPath),
      args: [path.resolve('harness', 'lib', 'bin.js'), path.resolve('harness', 'cordis.yml')],
      cwd,
      env: {
        PATH: path.dirname(process.execPath),
        DSH_CWD: cwd,
        DSH_SESSION_ROOT: path.resolve('harness-sessions'),
      },
    },
    initialize: {
      cwd,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      max_tokens: 4096,
    },
    on_notification(notification) {
      notifications.push(notification);
    },
    request_timeouts: {
      initialize_ms: 200,
      session_prompt_ms: null,
      shutdown_ms: 200,
    },
    shutdown_grace_ms: 100,
    eof_grace_ms: 100,
    set_timeout: setTimeout,
    clear_timeout: clearTimeout,
  });
  return { child, host, notifications, spawnCalls };
}

function hasCode(code) {
  return (error) => error instanceof BuilderHarnessProcessHostError && error.code === code;
}

test('handshakes, prompts, forwards notifications, and shuts down gracefully', async () => {
  const { child, host, notifications, spawnCalls } = harness();
  serve(child, (frame) => {
    if (frame.method === 'initialize') {
      assert.equal(frame.params.cwd, path.resolve('harness-workspace'));
      assert.equal(frame.params.provider, 'deepseek-official');
      assert.equal(frame.params.model, 'deepseek-v4-flash');
      assert.equal(frame.params.maxTokens, 4096);
      respond(child.stdout, frame.id, {
        serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0-rc.5' },
      });
      return;
    }
    if (frame.method === 'session/prompt') {
      assert.deepEqual(frame.params, {
        sessionId: 'builder-session:one',
        contentBlocks: [{ type: 'text', text: 'Update the timer.' }],
      });
      respond(child.stdout, frame.id, { messageId: 'message-1' });
      return;
    }
    if (frame.method === 'shutdown') {
      assert.equal(Object.hasOwn(frame, 'params'), false);
      respond(child.stdout, frame.id, {});
      queueMicrotask(() => child.emit('close', 0));
    }
  });

  const handshake = await host.start();
  assert.deepEqual(handshake, {
    host_version: 'builder-harness-process-host.v1',
    runtime_name: 'deepseek-harness-sdk-runtime',
    runtime_version: '0.1.0-rc.5',
    protocol: 'newline_jsonrpc_2.0',
  });
  assert.equal(spawnCalls.length, 1);

  child.stdout.write(`${JSON.stringify({
    jsonrpc: '2.0',
    method: 'session.status',
    params: { sessionId: 'builder-session:one', status: 'running' },
  })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);

  assert.deepEqual(await host.prompt({
    session_id: 'builder-session:one',
    text: 'Update the timer.',
  }), {
    session_id: 'builder-session:one',
    message_id: 'message-1',
  });
  assert.equal(await host.shutdown(), true);
  assert.deepEqual(host.diagnostics(), {
    host_version: 'builder-harness-process-host.v1',
    state: 'closed',
    exited: true,
    exit_code: 0,
    stderr_bytes: 0,
    stderr_truncated: false,
    stderr_content: 'redacted',
  });
  assert.equal(child.killCalls, 0);
});

test('routes empty-output recovery without admitting arbitrary model settings', async () => {
  const { child, host } = harness();
  serve(child, (frame) => {
    if (frame.method === 'initialize') {
      respond(child.stdout, frame.id, { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0' } });
    } else if (frame.method === 'session/recover-empty-output') {
      assert.deepEqual(frame.params, { sessionId: 'builder-session:one',
        contentBlocks: [{ type: 'text', text: 'Continue the approved implementation.' }] });
      respond(child.stdout, frame.id, { messageId: 'recovery-1' });
    } else if (frame.method === 'shutdown') {
      respond(child.stdout, frame.id, {});
      queueMicrotask(() => child.emit('close', 0));
    } else assert.fail(`Unexpected method: ${frame.method}`);
  });
  await host.start();
  assert.equal((await host.recover_empty_output({ session_id: 'builder-session:one',
    text: 'Continue the approved implementation.' })).message_id, 'recovery-1');
  await assert.rejects(host.recover_empty_output({ session_id: 'builder-session:one',
    text: 'Continue.', max_tokens: 100000 }), hasCode('builder_harness_process_host_failed'));
  await host.shutdown();
});

test('routes manual compaction with only the admitted source command id', async () => {
  const { child, host } = harness();
  const sourceCommandId = `builder-context-compaction-admission:${'a'.repeat(64)}`;
  serve(child, (frame) => {
    if (frame.method === 'initialize') {
      respond(child.stdout, frame.id, { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0' } });
    } else if (frame.method === 'session/compact') {
      assert.deepEqual(frame.params, {
        sessionId: 'builder-harness-11111111-1111-4111-8111-111111111111',
        sourceCommandId,
      });
      respond(child.stdout, frame.id, {
        compactionId: 'compaction:manual-1',
        sourceCommandId,
        startSeq: 10,
        summarySeq: 11,
        endSeq: 13,
        shadowedTokenCount: 48_000,
      });
    } else if (frame.method === 'shutdown') {
      respond(child.stdout, frame.id, {});
      queueMicrotask(() => child.emit('close', 0));
    } else assert.fail(`Unexpected method: ${frame.method}`);
  });

  await host.start();
  assert.deepEqual(await host.manual_compact({
    session_id: 'builder-harness-11111111-1111-4111-8111-111111111111',
    source_command_id: sourceCommandId,
  }), {
    compactionId: 'compaction:manual-1',
    sourceCommandId,
    startSeq: 10,
    summarySeq: 11,
    endSeq: 13,
    shadowedTokenCount: 48_000,
  });
  await host.shutdown();
});

test('manual compaction accepts Harness no-op and rejects forged parameters or results', async () => {
  const sourceCommandId = `builder-context-compaction-admission:${'b'.repeat(64)}`;
  {
    const { child, host } = harness();
    serve(child, (frame) => {
      if (frame.method === 'initialize') {
        respond(child.stdout, frame.id, { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0' } });
      } else if (frame.method === 'session/compact') {
        respond(child.stdout, frame.id, null);
      }
    });
    await host.start();
    assert.equal(await host.manual_compact({
      session_id: 'builder-harness-11111111-1111-4111-8111-111111111111',
      source_command_id: sourceCommandId,
    }), null);
    await assert.rejects(host.manual_compact({
      session_id: 'builder-harness-11111111-1111-4111-8111-111111111111',
      source_command_id: sourceCommandId,
      prompt: '/compact',
    }), hasCode('builder_harness_process_host_failed'));
    await assert.rejects(host.manual_compact({
      session_id: 'builder-harness-11111111-1111-4111-8111-111111111111',
      source_command_id: 'builder-command:forged',
    }), hasCode('builder_harness_process_host_failed'));
    await host.cancel();
  }
  {
    const { child, host } = harness();
    serve(child, (frame) => {
      if (frame.method === 'initialize') {
        respond(child.stdout, frame.id, { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0' } });
      } else if (frame.method === 'session/compact') {
        respond(child.stdout, frame.id, {
          compactionId: 'compaction:manual-2',
          sourceCommandId: `builder-context-compaction-admission:${'c'.repeat(64)}`,
          startSeq: 20,
          summarySeq: 21,
          endSeq: 22,
          shadowedTokenCount: 5,
        });
      }
    });
    await host.start();
    await assert.rejects(host.manual_compact({
      session_id: 'builder-harness-11111111-1111-4111-8111-111111111111',
      source_command_id: sourceCommandId,
    }), hasCode('builder_harness_process_host_failed'));
    await host.cancel();
  }
});

test('normalizes manual compaction remote failures without exposing runtime details', async () => {
  const { child, host } = harness();
  const sourceCommandId = `builder-context-compaction-admission:${'d'.repeat(64)}`;
  serve(child, (frame) => {
    if (frame.method === 'initialize') {
      respond(child.stdout, frame.id, { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0' } });
    } else if (frame.method === 'session/compact') {
      child.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: frame.id,
        error: { code: -32603, message: 'secret provider diagnostic' },
      })}\n`);
    }
  });

  await host.start();
  await assert.rejects(
    host.manual_compact({
      session_id: 'builder-harness-11111111-1111-4111-8111-111111111111',
      source_command_id: sourceCommandId,
    }),
    (error) => {
      assert.ok(hasCode('builder_harness_process_host_runtime_failed')(error));
      assert.doesNotMatch(`${error.name}:${error.message}:${error.stack}`, /secret provider/iu);
      return true;
    },
  );
  await host.cancel();
});

test('rejects a forged handshake and force-closes the child without leaking stderr', async () => {
  const { child, host } = harness();
  serve(child, (frame) => {
    if (frame.method === 'initialize') {
      child.stderr.write('secret provider diagnostic');
      respond(child.stdout, frame.id, {
        serverInfo: { name: 'different-runtime', version: '9.9.9' },
      });
    }
  });

  await assert.rejects(
    host.start(),
    hasCode('builder_harness_process_host_handshake_failed'),
  );
  assert.equal(child.killCalls, 1);
  const diagnostics = host.diagnostics();
  assert.equal(diagnostics.stderr_bytes, Buffer.byteLength('secret provider diagnostic'));
  assert.equal(diagnostics.stderr_content, 'redacted');
  assert.equal(JSON.stringify(diagnostics).includes('secret provider'), false);
});

test('forwards a full multilingual plan beyond 256 KiB without truncation', async () => {
  const { child, host } = harness();
  const text = '完整计划。'.repeat(24000);
  let received = null;
  serve(child, (frame) => {
    if (frame.method === 'initialize') respond(child.stdout, frame.id, {
      serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0' },
    });
    if (frame.method === 'session/prompt') {
      received = frame.params.contentBlocks[0].text;
      respond(child.stdout, frame.id, { messageId: 'long-plan' });
    }
  });
  try {
    await host.start();
    await host.prompt({ session_id: 'builder-session:one', text });
    assert.equal(received, text);
    await assert.rejects(host.prompt({ session_id: 'builder-session:one', text: 'x'.repeat(640 * 1024 + 1) }));
  } finally { await host.cancel(); }
});

test('treats protocol corruption during a prompt as runtime failure and reaps the process', async () => {
  const { child, host } = harness();
  serve(child, (frame) => {
    if (frame.method === 'initialize') {
      respond(child.stdout, frame.id, {
        serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0' },
      });
    } else if (frame.method === 'session/prompt') {
      child.stdout.write('not-json\n');
    }
  });
  await host.start();
  await assert.rejects(
    host.prompt({ session_id: 'builder-session:one', text: 'Read the project.' }),
    hasCode('builder_harness_process_host_runtime_failed'),
  );
  assert.equal(child.killCalls, 1);
  assert.equal(host.diagnostics().state, 'closed');
});

test('rejects a pending prompt when the child exits before its stdio closes', async () => {
  const { child, host } = harness();
  serve(child, (frame) => {
    if (frame.method === 'initialize') {
      respond(child.stdout, frame.id, {
        serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0' },
      });
    } else if (frame.method === 'session/prompt') {
      queueMicrotask(() => child.emit('exit', 1));
    }
  });

  await host.start();
  await assert.rejects(
    host.prompt({ session_id: 'builder-session:one', text: 'Read the project.' }),
    hasCode('builder_harness_process_host_runtime_failed'),
  );
  assert.equal(child.stdout.destroyed, false);
  assert.deepEqual(host.diagnostics(), {
    host_version: 'builder-harness-process-host.v1',
    state: 'closed',
    exited: true,
    exit_code: 1,
    stderr_bytes: 0,
    stderr_truncated: false,
    stderr_content: 'redacted',
  });
});

test('detects a dead runtime process when Windows does not deliver a child event', async () => {
  const child = runtimeChild();
  const { host } = harness({ child });
  serve(child, (frame) => {
    if (frame.method === 'initialize') {
      respond(child.stdout, frame.id, {
        serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0' },
      });
    } else if (frame.method === 'session/prompt') {
      child.pid = 2_147_483_647;
    }
  });

  await host.start();
  await assert.rejects(
    host.prompt({ session_id: 'builder-session:one', text: 'Read the project.' }),
    hasCode('builder_harness_process_host_runtime_failed'),
  );
  assert.equal(host.diagnostics().state, 'closed');
});

test('keeps detecting process death after the prompt acknowledgement', async () => {
  const child = runtimeChild();
  const { host } = harness({ child });
  serve(child, (frame) => {
    if (frame.method === 'initialize') {
      respond(child.stdout, frame.id, {
        serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0' },
      });
    } else if (frame.method === 'session/prompt') {
      respond(child.stdout, frame.id, { messageId: 'message-acknowledged' });
      child.pid = 2_147_483_647;
    }
  });

  await host.start();
  assert.deepEqual(await host.prompt({
    session_id: 'builder-session:one',
    text: 'Continue after the prompt acknowledgement.',
  }), {
    session_id: 'builder-session:one',
    message_id: 'message-acknowledged',
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(host.diagnostics().state, 'closed');
  assert.deepEqual(await host.when_terminated(), {
    reason: 'process_exit',
    exit_code: null,
  });
  await assert.rejects(
    host.prompt({ session_id: 'builder-session:one', text: 'This must not hang.' }),
    hasCode('builder_harness_process_host_closed'),
  );
});

test('cancels by terminating the dedicated process and refuses later prompts', async () => {
  const { child, host } = harness();
  serve(child, (frame) => {
    if (frame.method === 'initialize') {
      respond(child.stdout, frame.id, {
        serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.1.0' },
      });
    }
  });
  await host.start();
  assert.equal(await host.cancel(), true);
  assert.equal(child.killCalls, 1);
  await assert.rejects(
    host.prompt({ session_id: 'builder-session:one', text: 'Continue.' }),
    hasCode('builder_harness_process_host_closed'),
  );
});
