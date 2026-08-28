'use strict';

const assert = require('node:assert/strict');
const nodeHttp = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const TOKEN = 'a'.repeat(43);
const DIGEST = `sha256:${'b'.repeat(64)}`;

async function loadPlugin() {
  const url = pathToFileURL(path.resolve(
    __dirname,
    '../electron/harness/builder-tool-broker-plugin.mjs',
  ));
  return import(url.href);
}

async function fakeBroker(t) {
  const calls = [];
  const server = nodeHttp.createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk.toString('utf8');
    const body = JSON.parse(text);
    calls.push({
      authorization: request.headers.authorization,
      body,
    });
    let result;
    if (body.method === 'read') {
      result = {
        status: 'ready',
        resource_id: body.arguments.resource_id,
        content: 'export const seconds = 30;\n',
        content_bytes: 27,
        observed_version: DIGEST,
      };
    } else if (body.method === 'search') {
      result = {
        matches: [{
          resource_id: 'project:/src/timer.js',
          line: 1,
          column: 14,
          preview: 'export const seconds = 30;',
        }],
        truncated: false,
        total_matches: 1,
      };
    } else if (body.method === 'edit') {
      result = {
        status: 'changed',
        observed_version: `sha256:${'c'.repeat(64)}`,
        added_lines: 1,
        deleted_lines: 1,
      };
    } else if (body.method === 'write') {
      result = {
        status: 'created',
        observed_version: `sha256:${'d'.repeat(64)}`,
        added_lines: 1,
        deleted_lines: 0,
      };
    } else if (body.method === 'execute_command') {
      result = {
        status: 'passed',
        command_kind: 'test',
        command_display: 'npm test',
        exit_code: 0,
        duration_ms: 125,
        stdout_preview: '4 tests passed',
        stderr_preview: '',
        output_truncated: false,
      };
    } else if (body.method.startsWith('browser_')) {
      result = body.method === 'browser_close' ? { closed: true } : {
        observation_version: 'builder-agent-test-browser-observation.v1',
        observation_digest: DIGEST,
        url: 'http://127.0.0.1:43100/index.html',
        title: 'Agent test fixture',
        visible_text: 'Save changes',
        elements: [{
          element_ref: `browser-element:${'e'.repeat(64)}`,
          role: 'button',
          name: 'Save',
          disabled: false,
        }],
        accessibility: [{
          role: 'button', name: 'Save', disabled: false, checked: false, selected: false, expanded: false,
        }],
        console_reports: [{ level: 'error', message: 'Seeded defect' }],
        network_reports: [{
          method: 'GET', path: '/missing.js', status_code: 0, outcome: 'failed', error: 'net::ERR_FAILED',
        }],
        blocked_request_count: 0,
        screenshot_digest: DIGEST,
        screenshot_capture_status: 'captured',
        screenshot_pixel_status: 'nonblank',
        ...(body.method === 'browser_click' ? {
          action_receipt: {
            receipt_version: 'builder-agent-test-browser-action-receipt.v1',
            action_kind: 'click',
            before_observation_digest: `sha256:${'a'.repeat(64)}`,
            after_observation_digest: DIGEST,
          },
        } : {}),
      };
    } else {
      result = {
        answers: [{
          id: body.arguments.questions[0].id,
          selected: [],
          custom: 'Use React.',
        }],
      };
    }
    const payload = JSON.stringify({
      broker_version: 'builder-harness-tool-broker.v1',
      ok: true,
      result,
    });
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    });
    response.end(payload);
  });
  const address = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });
  return { endpoint: `http://127.0.0.1:${address.port}/v1/tool`, calls };
}

function fakeContext() {
  const tools = new Map();
  const sections = [];
  let userQuestionProvider = null;
  return {
    tools,
    sections,
    userQuestionProvider: () => userQuestionProvider,
    context: {
      tools: {
        register(definition) {
          assert.equal(tools.has(definition.name), false);
          tools.set(definition.name, definition);
        },
      },
      systemPrompt: {
        section(section) { sections.push(section); },
      },
      userQuestions: {
        registerProvider(provider) {
          assert.equal(userQuestionProvider, null);
          userQuestionProvider = provider;
        },
      },
    },
  };
}

test('registers Builder workspace tools and forwards versioned operations to loopback', async (t) => {
  const broker = await fakeBroker(t);
  const previousUrl = process.env.BUILDER_TOOL_BROKER_URL;
  const previousToken = process.env.BUILDER_TOOL_BROKER_TOKEN;
  const previousAllowedMethods = process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS;
  process.env.BUILDER_TOOL_BROKER_URL = broker.endpoint;
  process.env.BUILDER_TOOL_BROKER_TOKEN = TOKEN;
  process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS = JSON.stringify([
    'read', 'search', 'edit', 'write', 'execute_command', 'ask_user_question',
  ]);
  t.after(() => {
    if (previousUrl === undefined) delete process.env.BUILDER_TOOL_BROKER_URL;
    else process.env.BUILDER_TOOL_BROKER_URL = previousUrl;
    if (previousToken === undefined) delete process.env.BUILDER_TOOL_BROKER_TOKEN;
    else process.env.BUILDER_TOOL_BROKER_TOKEN = previousToken;
    if (previousAllowedMethods === undefined) delete process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS;
    else process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS = previousAllowedMethods;
  });

  const plugin = await loadPlugin();
  const fixture = fakeContext();
  plugin.apply(fixture.context);
  assert.deepEqual([...fixture.tools.keys()], ['read', 'grep', 'edit', 'write', 'bash']);
  assert.equal(fixture.sections.length, 1);
  assert.match(fixture.sections[0].text, /Builder will ask the user to allow that command once/u);
  assert.match(fixture.sections[0].text, /Do not create binary paths/u);
  assert.match(fixture.sections[0].text, /use \.svg for text-based image placeholders/u);
  assert.match(fixture.sections[0].text, /coherent runnable implementation/u);
  assert.match(fixture.sections[0].text, /exact current project test, lint, typecheck, or build command/u);
  assert.doesNotMatch(fixture.sections[0].text, /at most 12 changed files/u);

  const execution = { signal: new AbortController().signal };
  const readTool = fixture.tools.get('read');
  const readArgs = { file_path: './src/timer.js' };
  const read = await readTool.execute(readArgs, execution);
  assert.equal(read.observed_version, DIGEST);
  assert.match(read.content, /export const seconds/u);
  const readContent = readTool.output.render(readArgs, read);
  assert.match(readContent[0].text, new RegExp(DIGEST, 'u'));
  const readMeta = readTool.output.presentationMeta(readArgs, read);
  assert.equal(readMeta.lines[0].number, 1);
  assert.equal(readTool.presentCall(readArgs).card, 'generic');
  assert.deepEqual(
    readTool.presentResult(readArgs, { content: readContent, isError: false, meta: readMeta }),
    {
      card: 'read',
      title: 'Read src/timer.js',
      path: 'src/timer.js',
      offset: 1,
      lines: [{ number: 1, text: 'export const seconds = 30;' }],
      totalLines: 1,
      lang: 'js',
      content: readContent,
    },
  );

  const grepTool = fixture.tools.get('grep');
  const grepArgs = { query: 'seconds' };
  const grep = await grepTool.execute(grepArgs, execution);
  assert.equal(grep.matches[0].path, 'src/timer.js');
  const grepContent = grepTool.output.render(grepArgs, grep);
  assert.match(grepContent[0].text, /src\/timer\.js:1:14/u);
  const grepMeta = grepTool.output.presentationMeta(grepArgs, grep);
  assert.equal(grepTool.presentCall(grepArgs).kind, 'search');
  assert.equal(
    grepTool.presentResult(grepArgs, { content: grepContent, isError: false, meta: grepMeta }).card,
    'search',
  );

  const editTool = fixture.tools.get('edit');
  const editArgs = {
    file_path: 'src/timer.js',
    observed_version: DIGEST,
    content: 'export const seconds = 60;\n',
  };
  const edit = await editTool.execute(editArgs, execution);
  assert.equal(edit.status, 'changed');
  const editMeta = editTool.output.presentationMeta(editArgs, edit);
  assert.equal(editTool.presentCall(editArgs).card, 'diff');
  assert.equal(
    editTool.presentResult(editArgs, {
      content: editTool.output.render(editArgs, edit),
      isError: false,
      meta: editMeta,
    }).diffs[0].newText,
    editArgs.content,
  );

  const writeTool = fixture.tools.get('write');
  const writeArgs = {
    file_path: 'src/check.js',
    content: 'export const ready = true;\n',
  };
  const write = await writeTool.execute(writeArgs, execution);
  assert.equal(write.status, 'created');
  assert.equal(writeTool.presentCall(writeArgs).card, 'diff');
  assert.match(writeTool.output.render(writeArgs, write)[0].text, /Created: src\/check\.js/u);

  const bashTool = fixture.tools.get('bash');
  const bashArgs = { command: 'npm test', description: 'Verify the current project.' };
  const command = await bashTool.execute(bashArgs, execution);
  assert.equal(command.status, 'passed');
  assert.equal(command.exit_code, 0);
  assert.equal(bashTool.presentCall(bashArgs).kind, 'command');
  assert.match(bashTool.output.render(bashArgs, command)[0].text, /4 tests passed/u);
  assert.equal(bashTool.output.presentationMeta(bashArgs, command).command, 'npm test');

  const questionAnswer = await fixture.userQuestionProvider().ask({
    questions: [{
      id: 'framework',
      question: 'Which framework should I use?',
      options: [{ label: 'React', description: 'Use React.' }],
      multiSelect: false,
    }],
    signal: execution.signal,
  });
  assert.deepEqual(questionAnswer, {
    answers: [{ id: 'framework', selected: [], custom: 'Use React.' }],
  });

  assert.equal(broker.calls.length, 6);
  assert.ok(broker.calls.every(call => call.authorization === `Bearer ${TOKEN}`));
  assert.deepEqual(
    broker.calls.map(call => call.body.method),
    ['read', 'search', 'edit', 'write', 'execute_command', 'ask_user_question'],
  );
  assert.deepEqual(broker.calls[2].body.arguments, {
    resource_id: 'project:/src/timer.js',
    observed_version: DIGEST,
    content: 'export const seconds = 60;\n',
  });
  assert.equal(broker.calls[3].body.arguments.expected_absent, true);
  assert.deepEqual(broker.calls[5].body.arguments, {
    questions: [{
      id: 'framework',
      question: 'Which framework should I use?',
      options: [{ label: 'React', description: 'Use React.' }],
      multi_select: false,
    }],
  });
  assert.equal(readTool.presentCall({ file_path: '../outside.txt' }), undefined);
  assert.equal(grepTool.presentResult(grepArgs, { content: [], isError: false, meta: null }), undefined);
});

test('omits bash when Builder broker capabilities do not expose command execution', async (t) => {
  const broker = await fakeBroker(t);
  const previousUrl = process.env.BUILDER_TOOL_BROKER_URL;
  const previousToken = process.env.BUILDER_TOOL_BROKER_TOKEN;
  const previousAllowedMethods = process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS;
  process.env.BUILDER_TOOL_BROKER_URL = broker.endpoint;
  process.env.BUILDER_TOOL_BROKER_TOKEN = TOKEN;
  process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS = JSON.stringify([
    'read', 'search', 'edit', 'write', 'ask_user_question',
  ]);
  t.after(() => {
    if (previousUrl === undefined) delete process.env.BUILDER_TOOL_BROKER_URL;
    else process.env.BUILDER_TOOL_BROKER_URL = previousUrl;
    if (previousToken === undefined) delete process.env.BUILDER_TOOL_BROKER_TOKEN;
    else process.env.BUILDER_TOOL_BROKER_TOKEN = previousToken;
    if (previousAllowedMethods === undefined) delete process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS;
    else process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS = previousAllowedMethods;
  });

  const plugin = await loadPlugin();
  const fixture = fakeContext();
  plugin.apply(fixture.context);

  assert.deepEqual([...fixture.tools.keys()], ['read', 'grep', 'edit', 'write']);
  assert.equal(fixture.tools.has('bash'), false);
  assert.match(fixture.sections[0].text, /Shell commands are not available in this run/u);
  assert.doesNotMatch(fixture.sections[0].text, /Builder will ask the user to allow that command once/u);

  const execution = { signal: new AbortController().signal };
  await fixture.tools.get('write').execute({
    file_path: 'index.html',
    content: '<main>Created from an empty project.</main>\n',
  }, execution);
  assert.deepEqual(broker.calls.map(call => call.body.method), ['write']);
});

test('rejects paths and edits that did not carry a verified read version before network access', async (t) => {
  const broker = await fakeBroker(t);
  const previousUrl = process.env.BUILDER_TOOL_BROKER_URL;
  const previousToken = process.env.BUILDER_TOOL_BROKER_TOKEN;
  process.env.BUILDER_TOOL_BROKER_URL = broker.endpoint;
  process.env.BUILDER_TOOL_BROKER_TOKEN = TOKEN;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.BUILDER_TOOL_BROKER_URL;
    else process.env.BUILDER_TOOL_BROKER_URL = previousUrl;
    if (previousToken === undefined) delete process.env.BUILDER_TOOL_BROKER_TOKEN;
    else process.env.BUILDER_TOOL_BROKER_TOKEN = previousToken;
  });

  const plugin = await loadPlugin();
  const fixture = fakeContext();
  plugin.apply(fixture.context);
  const execution = { signal: new AbortController().signal };

  await assert.rejects(
    fixture.tools.get('read').execute({ file_path: '../outside.txt' }, execution),
    /project-relative/u,
  );
  await assert.rejects(
    fixture.tools.get('edit').execute({
      file_path: 'src/timer.js',
      observed_version: 'not-a-version',
      content: 'changed\n',
    }, execution),
    /Read the file first/u,
  );
  assert.equal(broker.calls.length, 0);
});

test('fails closed when the broker endpoint or token is not a verified loopback credential', async () => {
  const previousUrl = process.env.BUILDER_TOOL_BROKER_URL;
  const previousToken = process.env.BUILDER_TOOL_BROKER_TOKEN;
  try {
    process.env.BUILDER_TOOL_BROKER_URL = 'https://example.com/v1/tool';
    process.env.BUILDER_TOOL_BROKER_TOKEN = TOKEN;
    const plugin = await loadPlugin();
    assert.throws(() => plugin.apply(fakeContext().context), /access is unavailable/u);
  } finally {
    if (previousUrl === undefined) delete process.env.BUILDER_TOOL_BROKER_URL;
    else process.env.BUILDER_TOOL_BROKER_URL = previousUrl;
    if (previousToken === undefined) delete process.env.BUILDER_TOOL_BROKER_TOKEN;
    else process.env.BUILDER_TOOL_BROKER_TOKEN = previousToken;
  }
});

test('registers only admitted Agent Test browser capabilities and forwards opaque element refs', async (t) => {
  const broker = await fakeBroker(t);
  const previousUrl = process.env.BUILDER_TOOL_BROKER_URL;
  const previousToken = process.env.BUILDER_TOOL_BROKER_TOKEN;
  const previousAllowedMethods = process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS;
  process.env.BUILDER_TOOL_BROKER_URL = broker.endpoint;
  process.env.BUILDER_TOOL_BROKER_TOKEN = TOKEN;
  process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS = JSON.stringify([
    'read',
    'browser_open_local_app',
    'browser_observe',
    'browser_click',
    'browser_type',
    'browser_reload_latest_source',
    'browser_close',
  ]);
  t.after(() => {
    if (previousUrl === undefined) delete process.env.BUILDER_TOOL_BROKER_URL;
    else process.env.BUILDER_TOOL_BROKER_URL = previousUrl;
    if (previousToken === undefined) delete process.env.BUILDER_TOOL_BROKER_TOKEN;
    else process.env.BUILDER_TOOL_BROKER_TOKEN = previousToken;
    if (previousAllowedMethods === undefined) delete process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS;
    else process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS = previousAllowedMethods;
  });

  const plugin = await loadPlugin();
  const fixture = fakeContext();
  plugin.apply(fixture.context);
  assert.deepEqual([...fixture.tools.keys()], [
    'read',
    'browser_open_local_app',
    'browser_observe',
    'browser_click',
    'browser_type',
    'browser_reload_latest_source',
    'browser_close',
  ]);
  assert.match(
    fixture.sections[0].text,
    /cannot access external sites, cookies, downloads, commands, dependencies/u,
  );
  let concludedTurns = 0;
  const execution = {
    signal: new AbortController().signal,
    concludeTurn() { concludedTurns += 1; },
  };
  const opened = await fixture.tools.get('browser_open_local_app').execute({}, execution);
  assert.equal(opened.visible_text, 'Save changes');
  assert.equal(concludedTurns, 1);
  const elementRef = opened.elements[0].element_ref;
  const clicked = await fixture.tools.get('browser_click').execute({ element_ref: elementRef }, execution);
  assert.equal(clicked.title, 'Agent test fixture');
  const rendered = fixture.tools.get('browser_click').output.render({ element_ref: elementRef }, clicked)[0].text;
  assert.match(rendered, /Accessibility summary:/u);
  assert.match(rendered, /Console reports:.*Seeded defect/u);
  assert.match(rendered, /Network reports:.*missing\.js/u);
  assert.match(rendered, /Screenshot pixels: nonblank/u);
  assert.match(rendered, /Action evidence: click changed observation/u);
  assert.equal(concludedTurns, 1);
  await fixture.tools.get('browser_reload_latest_source').execute({}, execution);
  assert.equal(concludedTurns, 2);
  assert.deepEqual(broker.calls.slice(-2).map((call) => call.body), [
    { method: 'browser_click', arguments: { element_ref: elementRef } },
    { method: 'browser_reload_latest_source', arguments: {} },
  ]);
  await assert.rejects(
    fixture.tools.get('browser_click').execute({ element_ref: '#save' }, execution),
    /element reference is invalid/u,
  );
});
