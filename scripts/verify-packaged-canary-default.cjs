'use strict';

const http = require('node:http');
const { Readable } = require('node:stream');

const {
  BuilderPackagedCanaryError,
  CANARY_INPUT_VERSION,
  runCli,
} = require('./verify-packaged-canary.cjs');

const DEFAULT_CANARY_INPUT = Object.freeze({
  executable_path: null,
  idea: 'Make a small focus timer.',
  provider: Object.freeze({
    base_url: null,
    credential: 'local-canary-provider-secret',
    max_tokens: 8192,
    model: 'local-canary-model',
    temperature: 0.2,
    timeout_ms: 30000,
  }),
  schema_version: CANARY_INPUT_VERSION,
});

function providerMessage(content) {
  return JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content },
    }],
  });
}

function providerStream(content) {
  return [
    'data: {"choices":[{"finish_reason":null,"delta":{"role":"assistant"}}]}',
    '',
    `data: ${JSON.stringify({ choices: [{ finish_reason: null, delta: { content } }] })}`,
    '',
    'data: {"choices":[{"finish_reason":"stop","delta":{}}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
}

function explanationOutput() {
  return JSON.stringify({
    kind: 'builder_conversation_explanation',
    title: 'Local canary answer',
    summary: 'Answers without changing files.',
    explanation: 'This local canary answer verifies chat flow without changing project files.',
  });
}

function semanticRouteOutput(instruction) {
  const planArtifact = /(?:计划管理|计划表|方案展示)(?:页面|页|应用|系统)?/u.test(instruction);
  const asksForPlan = !planArtifact
    && /(?:实施计划|实现计划|改版方案|优化方案|重构方案|制定.{0,12}计划|做成计划)/u.test(instruction);
  const asksQuestion = /^(?:what|why|how|can you explain|什么|为什么|怎么|如何)/iu.test(instruction)
    || /[?？]$/u.test(instruction);
  const route = asksForPlan ? 'plan' : asksQuestion ? 'answer' : 'build';
  return JSON.stringify({
    kind: 'builder_semantic_route_classification',
    route,
    confidence: 'high',
    reason_code: route === 'plan'
      ? 'requests_plan_or_proposal'
      : route === 'answer'
        ? 'asks_for_information'
        : 'requests_source_change',
  });
}

function planOutput() {
  return JSON.stringify({
    kind: 'builder_project_plan_proposal',
    title: 'Review the canary plan',
    summary: 'Prepare a bounded local canary edit before changing files.',
    steps: [
      {
        title: 'Check the saved project',
        purpose: 'Use the current project context before editing.',
        expected_change: 'No source files change during planning.',
      },
      {
        title: 'Apply the approved canary edit',
        purpose: 'Create a visible and reviewable update.',
        expected_change: 'A later approved step can update the static preview.',
      },
    ],
  });
}

function codeChangeOutput(index) {
  const heading = index <= 1 ? 'Focus Timer' : index === 2 ? 'Focus Timer Updated' : 'Focus Timer Complete';
  const subtitle = index <= 1
    ? 'A compact local canary project.'
    : index === 2
      ? 'A reviewed update from the packaged canary.'
      : 'A compact completed-state summary for the packaged canary.';
  return JSON.stringify({
    kind: 'builder_code_change_operations',
    title: 'Focus timer',
    summary: 'A timer.',
    operations: [
      {
        operation: 'upsert',
        path: 'index.html',
        content: [
          '<!doctype html>',
          '<html lang="en">',
          '<head>',
          '  <meta charset="utf-8">',
          '  <meta name="viewport" content="width=device-width, initial-scale=1">',
          '  <title>Focus timer</title>',
          '  <style>',
          '    body { margin: 0; font-family: Arial, sans-serif; background: #f6f7f2; color: #1f2a24; }',
          '    main { min-height: 100vh; display: grid; place-items: center; padding: 32px; }',
          '    section { width: min(520px, 100%); border: 1px solid #d7dbc9; border-radius: 8px; padding: 28px; background: #ffffff; }',
          '    h1 { margin: 0 0 12px; font-size: 32px; }',
          '    p { margin: 0; font-size: 16px; line-height: 1.5; }',
          '  </style>',
          '</head>',
          '<body>',
          '  <main>',
          '    <section>',
          `      <h1>${heading}</h1>`,
          `      <p>${subtitle}</p>`,
          '    </section>',
          '  </main>',
          '</body>',
          '</html>',
          '',
        ].join('\n'),
      },
      {
        operation: 'upsert',
        path: 'package.json',
        content: `${JSON.stringify({
          name: 'clawfabric-packaged-canary',
          private: true,
          scripts: { test: 'node --check check.js' },
        }, null, 2)}\n`,
      },
      {
        operation: 'upsert',
        path: 'check.js',
        content: "const canary = 'packaged-check-ready';\nvoid canary;\n",
      },
    ],
  });
}

function outputForRequest(body, state) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let outputKind = null;
  const messageContents = messages
    .map((message) => (typeof message?.content === 'string' ? message.content : ''))
    .filter((content) => content.length > 0);
  const semanticRouteRequested = messageContents.some((content) => (
    content.includes('builder_semantic_route_classification')
  ));
  if (semanticRouteRequested) {
    let instruction = '';
    for (const content of messageContents) {
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed?.instruction === 'string') instruction = parsed.instruction;
      } catch {
        // The system message is plain text.
      }
    }
    return semanticRouteOutput(instruction);
  }
  for (const content of messageContents) {
    try {
      const parsed = JSON.parse(content);
      outputKind = parsed?.output_contract?.kind ?? null;
      if (typeof outputKind === 'string') break;
    } catch {
      // Prompt repair messages are plain text; fall through to marker matching below.
    }
  }
  if (outputKind === 'builder_project_plan_proposal') return planOutput();
  if (outputKind === 'builder_conversation_explanation') return explanationOutput();
  if (outputKind === 'builder_code_change_operations') {
    state.codeChangeCount += 1;
    return codeChangeOutput(state.codeChangeCount);
  }
  const promptText = messageContents.join('\n');
  const explicitKind = promptText.match(
    /Set kind to (builder_(?:conversation_explanation|project_plan_proposal|code_change_operations))/u,
  )?.[1] ?? null;
  if (explicitKind === 'builder_project_plan_proposal') return planOutput();
  if (explicitKind === 'builder_conversation_explanation') return explanationOutput();
  if (explicitKind === 'builder_code_change_operations') {
    state.codeChangeCount += 1;
    return codeChangeOutput(state.codeChangeCount);
  }
  if (promptText.includes('builder_project_plan_proposal')) return planOutput();
  if (promptText.includes('builder_conversation_explanation')) return explanationOutput();
  state.codeChangeCount += 1;
  return codeChangeOutput(state.codeChangeCount);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error('canary request too large'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function createLocalCanaryProviderServer(options = {}) {
  const deferredCodeChangeResponses = Number.isSafeInteger(options.deferCodeChangeResponses)
    && options.deferCodeChangeResponses > 0
    ? options.deferCodeChangeResponses
    : 0;
  const deferCodeChangeResponsesAfter = Number.isSafeInteger(options.deferCodeChangeResponsesAfter)
    && options.deferCodeChangeResponsesAfter > 0
    ? options.deferCodeChangeResponsesAfter
    : 0;
  const state = {
    codeChangeCount: 0,
    deferredCodeChangeResponses,
    pendingResponseReleases: [],
    requests: [],
  };
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      const rawBody = await readRequestBody(request);
      const body = JSON.parse(rawBody);
      const content = outputForRequest(body, state);
      let responseKind = null;
      try {
        responseKind = JSON.parse(content)?.kind ?? null;
      } catch {
        responseKind = null;
      }
      state.requests.push(Object.freeze({
        message_count: Array.isArray(body.messages) ? body.messages.length : null,
        response_kind: typeof responseKind === 'string' ? responseKind : null,
        stream: body.stream === true,
      }));
      if (state.requests.length > 20) state.requests.shift();
      if (
        responseKind === 'builder_code_change_operations'
        && state.codeChangeCount > deferCodeChangeResponsesAfter
        && state.deferredCodeChangeResponses > 0
      ) {
        state.deferredCodeChangeResponses -= 1;
        await new Promise((resolve) => {
          state.pendingResponseReleases.push(resolve);
        });
      }
      if (body.stream === true) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(providerStream(content));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(providerMessage(content));
    } catch {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'local canary provider failed' }));
    }
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address !== 'object' || !Number.isSafeInteger(address.port)) {
    await closeServer(server);
    throw new BuilderPackagedCanaryError('canary_launch_failed');
  }
  const releaseNext = () => {
    const release = state.pendingResponseReleases.shift();
    if (release === undefined) return false;
    release();
    return true;
  };
  const releaseAll = () => {
    while (releaseNext()) {
      // Drain every response before app or server cleanup.
    }
  };
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => {
      releaseAll();
      return closeServer(server);
    },
    pendingResponseCount: () => state.pendingResponseReleases.length,
    releaseAll,
    releaseNext,
    snapshot: () => Object.freeze(state.requests.map((item) => ({ ...item }))),
  });
}

async function main() {
  const providerServer = await createLocalCanaryProviderServer();
  try {
    const stdin = Readable.from([JSON.stringify({
      ...DEFAULT_CANARY_INPUT,
      provider: {
        ...DEFAULT_CANARY_INPUT.provider,
        base_url: providerServer.baseUrl,
      },
    })]);
    const result = await runCli({
      argv: ['--execute'],
      stdin,
    });
    const checkRun = result?.draft?.initial?.check_run;
    if (
      checkRun?.status !== 'passed'
      || checkRun.packaged_runtime_executed !== true
      || checkRun.command_profile_selected_by_main !== true
    ) {
      throw new BuilderPackagedCanaryError('canary_check_run_failed');
    }
    return result;
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      error.diagnostic = Object.freeze({
        ...(error.diagnostic ?? {}),
        local_provider_requests: providerServer.snapshot(),
      });
    }
    throw error;
  } finally {
    await providerServer.close();
  }
}

module.exports = Object.freeze({
  createLocalCanaryProviderServer,
  main,
});

if (require.main === module) {
  main().catch((error) => {
    const code = error instanceof BuilderPackagedCanaryError
      ? error.code
      : 'canary_evidence_failed';
    const payload = {
      ok: false,
      code,
      message: error instanceof Error ? error.message : 'Packaged canary failed.',
      stage: error instanceof BuilderPackagedCanaryError ? error.stage : 'evidence',
    };
    if (
      error instanceof BuilderPackagedCanaryError
      && error.diagnostic !== undefined
    ) {
      payload.diagnostic = error.diagnostic;
    }
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 1;
  });
}
