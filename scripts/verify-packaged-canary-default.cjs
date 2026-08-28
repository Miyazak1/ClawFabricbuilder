'use strict';

const http = require('node:http');
const { Readable } = require('node:stream');

const {
  BuilderPackagedCanaryError,
  CANARY_INPUT_VERSION,
  CANARY_QUESTION,
  CANARY_SAVED_PROJECT_CONTEXT_ANSWER,
  runCli,
  runPackagedCanary,
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

function providerStreamChunks(content) {
  const characters = Array.from(content);
  const chunks = [];
  for (let index = 0; index < characters.length; index += 2) {
    chunks.push(characters.slice(index, index + 2).join(''));
  }
  return chunks;
}

function writeSse(response, payload) {
  response.write(`data: ${payload}\n\n`);
}

async function writeProviderStream(response, content, chunkDelayMs = 3) {
  writeSse(response, '{"choices":[{"finish_reason":null,"delta":{"role":"assistant"}}]}');
  for (const chunk of providerStreamChunks(content)) {
    writeSse(response, JSON.stringify({ choices: [{ finish_reason: null, delta: { content: chunk } }] }));
    await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
  }
  writeSse(response, '{"choices":[{"finish_reason":"stop","delta":{}}]}');
  writeSse(response, '[DONE]');
  response.end();
}

function harnessToolEvents(callId, name, args, narration = null) {
  return [
    { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] },
    ...(narration === null ? [] : [{ choices: [{ delta: { content: narration } }] }]),
    {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: callId,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          }],
        },
      }],
    },
    {
      choices: [{ delta: { content: '' }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 32, completion_tokens: 8 },
    },
  ];
}

function harnessToolBatchEvents(calls, narration = null) {
  return [
    { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] },
    ...(narration === null ? [] : [{ choices: [{ delta: { content: narration } }] }]),
    {
      choices: [{
        delta: {
          tool_calls: calls.map((call, index) => ({
            index,
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        },
      }],
    },
    {
      choices: [{ delta: { content: '' }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 32, completion_tokens: 16 },
    },
  ];
}

function harnessTextEvents(content) {
  return [
    { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] },
    { choices: [{ delta: { content } }] },
    {
      choices: [{ delta: { content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 32, completion_tokens: 8 },
    },
  ];
}

function harnessLongStreamEvents() {
  const events = [
    { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] },
  ];
  for (let index = 0; index < 600; index += 1) {
    events.push({ choices: [{ delta: { content: `stream ${String(index + 1).padStart(3, '0')}. ` } }] });
  }
  events.push({
    choices: [{ delta: { content: '' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 32, completion_tokens: 1_800 },
  });
  return events;
}

async function writeHarnessStream(response, events, eventDelayMs = 0) {
  for (let index = 0; index < events.length; index += 1) {
    writeSse(response, JSON.stringify(events[index]));
    if (eventDelayMs > 0 && index < events.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, eventDelayMs));
    }
  }
  writeSse(response, '[DONE]');
  response.end();
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
}

function isHarnessRequest(body) {
  if (!Array.isArray(body.tools)) return false;
  const names = body.tools.map((tool) => tool?.function?.name).filter((name) => typeof name === 'string');
  return ['read', 'grep', 'edit', 'write'].every((name) => names.includes(name));
}

function harnessFiles(
  runIndex,
  initialCheckFails = false,
  includeOutputBurst = false,
  includeMissingDependency = false,
  includeLocalDependency = false,
  includeBrokenLocalDependency = false,
) {
  const variants = [
    ['Focus Timer', 'A compact local canary project.'],
    ['Focus Timer Updated', 'A reviewed update from the packaged Harness canary.'],
    ['Focus Timer Complete', 'A completed state produced through the packaged Harness runtime.'],
    ['Focus Timer Refined', 'A first unsaved Harness refinement.'],
    ['Focus Timer Polished', 'A second unsaved Harness refinement.'],
    ['Focus Timer Continued', 'A continuation produced through the packaged Harness runtime.'],
  ];
  const [heading, subtitle] = variants[Math.min(Math.max(runIndex, 1), variants.length) - 1];
  const files = new Map([
    ['README.md', '# Focus Timer\n\nPackaged Harness canary project.\n'],
    ['check.js', initialCheckFails
      ? "const canary = ;\nvoid canary;\n"
      : "const canary = 'packaged-harness-check-ready';\nvoid canary;\n"],
    ['package.json', `${JSON.stringify({
      name: 'clawfabric-packaged-harness-canary',
      private: true,
      scripts: {
        test: includeMissingDependency
          ? 'clawfabric-missing-check-tool --version'
          : includeLocalDependency || includeBrokenLocalDependency
            ? 'clawfabric-local-check-tool --version'
          : 'node --check check.js',
        ...(includeOutputBurst ? { build: 'node burst.js' } : {}),
      },
      ...(includeMissingDependency
        ? { devDependencies: { 'clawfabric-missing-check-tool': '0.0.0-canary' } }
        : includeBrokenLocalDependency
          ? { devDependencies: { 'ClawFabric Broken Local Check Tool': '1.0.0' } }
        : includeLocalDependency
          ? {
            devDependencies: {
              'clawfabric-local-check-tool': 'file:./tools/clawfabric-local-check-tool',
            },
          }
        : {}),
    }, null, 2)}\n`],
    ['index.html', [
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
    ].join('\n')],
  ]);
  if (includeOutputBurst) {
    files.set('burst.js', [
      "'use strict';",
      "const stdoutChunk = `${'O'.repeat(65_535)}\\n`;",
      "const stderrChunk = `${'E'.repeat(65_535)}\\n`;",
      'for (let index = 0; index < 80; index += 1) {',
      '  process.stdout.write(stdoutChunk);',
      '  process.stderr.write(stderrChunk);',
      '}',
      '',
    ].join('\n'));
  }
  if (includeLocalDependency) {
    files.set('tools/clawfabric-local-check-tool/package.json', `${JSON.stringify({
      name: 'clawfabric-local-check-tool',
      version: '1.0.0',
      bin: {
        'clawfabric-local-check-tool': 'bin/check-tool.js',
      },
    }, null, 2)}\n`);
    files.set('tools/clawfabric-local-check-tool/bin/check-tool.js', [
      '#!/usr/bin/env node',
      "'use strict';",
      "console.log('clawfabric-local-check-tool 1.0.0');",
      '',
    ].join('\n'));
  }
  return files;
}

function boundaryIndex(heading) {
  return harnessFiles(4).get('index.html').replace(
    /<h1>[^<]+<\/h1>/u,
    `<h1>${heading}</h1>`,
  );
}

function harnessAdversarialBoundaryOutput(toolResults) {
  const allResults = toolResults.join('\n');
  const readCount = (allResults.match(/File: index\.html/gu) ?? []).length;
  const editedCount = (allResults.match(/Edited: index\.html/gu) ?? []).length;
  if (toolResults.length === 0) {
    return {
      kind: 'harness_adversarial_escape_read',
      events: harnessToolEvents('boundary-escape-read', 'read', {
        file_path: '../outside.txt',
      }, 'I will inspect the requested project context before making any changes.'),
    };
  }
  if (allResults.includes('Use a project-relative file path.') && readCount === 0) {
    return {
      kind: 'harness_adversarial_valid_read',
      events: harnessToolEvents('boundary-valid-read', 'read', {
        file_path: 'index.html',
      }, 'That path is outside the project, so I will retry with the project file.'),
    };
  }
  if (readCount === 1 && editedCount === 0) {
    const observedVersion = [...allResults.matchAll(
      /Observed version:\s*(sha256:[0-9a-f]{64})/gu,
    )].at(-1)?.[1];
    if (observedVersion === undefined) {
      throw new Error('Harness boundary canary did not receive the file version.');
    }
    return {
      kind: 'harness_adversarial_stale_edit_batch',
      events: harnessToolBatchEvents([
        {
          id: 'boundary-edit-first',
          name: 'edit',
          arguments: {
            file_path: 'index.html',
            observed_version: observedVersion,
            content: boundaryIndex('Boundary Intermediate'),
          },
        },
        {
          id: 'boundary-edit-stale',
          name: 'edit',
          arguments: {
            file_path: 'index.html',
            observed_version: observedVersion,
            content: boundaryIndex('Boundary Stale Should Not Win'),
          },
        },
      ], 'I found the current page and will apply the requested heading update.'),
    };
  }
  if (
    editedCount === 1
    && allResults.includes('The file changed after it was read. Read it again before editing.')
    && !allResults.includes('unknown tool "delete"')
  ) {
    return {
      kind: 'harness_adversarial_unsupported_tool',
      events: harnessToolEvents('boundary-unsupported-delete', 'delete', {
        file_path: 'index.html',
      }, 'One edit used a stale file version, so I will recover without overwriting newer work.'),
    };
  }
  if (allResults.includes('unknown tool "delete"') && readCount === 1) {
    return {
      kind: 'harness_adversarial_reread',
      events: harnessToolEvents('boundary-reread', 'read', {
        file_path: 'index.html',
      }, 'The unsupported action was rejected. I will re-read the file before retrying safely.'),
    };
  }
  if (allResults.includes('unknown tool "delete"') && readCount >= 2 && editedCount === 1) {
    const observedVersion = [...allResults.matchAll(
      /Observed version:\s*(sha256:[0-9a-f]{64})/gu,
    )].at(-1)?.[1];
    if (observedVersion === undefined) {
      throw new Error('Harness boundary retry did not receive the current file version.');
    }
    return {
      kind: 'harness_adversarial_repaired_edit',
      events: harnessToolEvents('boundary-edit-repaired', 'edit', {
        file_path: 'index.html',
        observed_version: observedVersion,
        content: boundaryIndex('Boundary Safe'),
      }, 'I now have the current file version and will apply the safe edit.'),
    };
  }
  if (editedCount >= 2) {
    return {
      kind: 'harness_adversarial_completed',
      events: harnessTextEvents(
        'Recovered from denied and stale tool requests, then completed the safe project edit.',
      ),
    };
  }
  throw new Error('Harness boundary canary reached an unexpected tool-result state.');
}

function harnessOutputForRequest(body, state) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const toolResults = messages
    .filter((message) => message?.role === 'tool')
    .map(messageText);
  const promptText = messages.map(messageText).join('\n');
  if (
    state.harnessAgentBrowserCancellation
    && promptText.includes('PACKAGED_AGENT_BROWSER_CANCEL')
  ) {
    if (toolResults.length === 0) {
      return {
        kind: 'harness_agent_browser_open_for_cancel',
        events: harnessToolEvents(
          'agent-browser-open-for-cancel',
          'browser_open_local_app',
          {},
          'I will open the isolated local app before the cancellation checkpoint.',
        ),
      };
    }
    return {
      kind: 'harness_agent_browser_cancel_hold',
      events: harnessTextEvents('The isolated browser observation completed.'),
    };
  }
  const pb03InstructionIndex = promptText.lastIndexOf('PB-03 controlled 60-second stream');
  const pb06InstructionIndex = promptText.lastIndexOf('PB-06 controlled 10 MB output burst');
  const pb07InstructionIndex = promptText.lastIndexOf('PB-07 controlled broker read search pressure');
  if (
    state.harnessStressScenarios
    && pb03InstructionIndex >= 0
    && pb03InstructionIndex > pb06InstructionIndex
    && pb03InstructionIndex > pb07InstructionIndex
  ) {
    return {
      kind: 'harness_pb03_long_stream',
      events: harnessLongStreamEvents(),
      event_delay_ms: 100,
    };
  }
  if (
    state.harnessStressScenarios
    && pb06InstructionIndex >= 0
    && pb06InstructionIndex > pb03InstructionIndex
    && pb06InstructionIndex > pb07InstructionIndex
  ) {
    if (toolResults.length === 0) {
      return {
        kind: 'harness_pb06_command',
        events: harnessToolEvents(
          'pb06-output-burst',
          'bash',
          {
            command: 'npm run build',
            description: 'Run the controlled 10 MB stdout and stderr stress fixture.',
          },
          'I will run the declared project build command and keep its complete output in Builder.',
        ),
      };
    }
    return {
      kind: 'harness_pb06_completed',
      events: harnessTextEvents('The controlled output burst completed and its bounded result is available.'),
    };
  }
  if (
    state.harnessStressScenarios
    && pb07InstructionIndex >= 0
    && pb07InstructionIndex > pb03InstructionIndex
    && pb07InstructionIndex > pb06InstructionIndex
  ) {
    if (toolResults.length === 0) {
      return {
        kind: 'harness_pb07_tool_pressure',
        events: harnessToolBatchEvents([
          { id: 'pb07-read-index-1', name: 'read', arguments: { file_path: 'index.html' } },
          { id: 'pb07-read-package-1', name: 'read', arguments: { file_path: 'package.json' } },
          { id: 'pb07-read-readme-1', name: 'read', arguments: { file_path: 'README.md' } },
          { id: 'pb07-read-check-1', name: 'read', arguments: { file_path: 'check.js' } },
          { id: 'pb07-grep-focus-1', name: 'grep', arguments: { query: 'Focus', max_results: 20 } },
          { id: 'pb07-grep-canary-1', name: 'grep', arguments: { query: 'canary', max_results: 20 } },
          { id: 'pb07-grep-package-1', name: 'grep', arguments: { query: 'package', max_results: 20 } },
          { id: 'pb07-grep-timer-1', name: 'grep', arguments: { query: 'timer', max_results: 20 } },
        ], 'I will inspect the project with concurrent read and search calls without changing files.'),
      };
    }
    return {
      kind: 'harness_pb07_completed',
      events: harnessTextEvents('The broker read and search pressure pass completed without changing project files.'),
    };
  }
  if (promptText.includes('Inspect the current project and explain what detail is still needed. Do not change files.')) {
    const allResults = toolResults.join('\n');
    if (toolResults.length === 0) {
      return {
        kind: 'harness_no_change_search',
        events: harnessToolEvents(
          'no-change-search-project',
          'grep',
          { query: 'Boundary Safe', max_results: 10 },
          'I will search the current project for the relevant page before reading it.',
        ),
      };
    }
    if (!allResults.includes('File: index.html')) {
      return {
        kind: 'harness_no_change_read',
        events: harnessToolEvents(
          'no-change-read-index',
          'read',
          { file_path: 'index.html' },
          'I will inspect the current page before explaining what detail is still needed.',
        ),
      };
    }
    return {
      kind: 'harness_no_change_completed',
      events: harnessTextEvents(
        'I inspected index.html, but I need the exact replacement text before changing files.',
      ),
    };
  }
  if (
    state.harnessAdversarialBoundaries
    && promptText.includes('Exercise Builder workspace boundaries and recover safely.')
  ) {
    return harnessAdversarialBoundaryOutput(toolResults);
  }
  if (
    state.harnessFailedCheckRepair
    && !state.harnessRepairCompleted
    && (state.harnessRepairStarted || promptText.includes('The Builder project check failed.'))
  ) {
    state.harnessRepairStarted = true;
    const allResults = toolResults.join('\n');
    if (!allResults.includes('File: check.js')) {
      return {
        kind: 'harness_tool_read_repair',
        events: harnessToolEvents(
          'read-repair-check',
          'read',
          { file_path: 'check.js' },
          'The project check failed, so I will inspect the failing check file before repairing it.',
        ),
      };
    }
    if (!allResults.includes('Edited: check.js')) {
      const observedVersion = [...allResults.matchAll(
        /Observed version:\s*(sha256:[0-9a-f]{64})/gu,
      )].at(-1)?.[1];
      if (observedVersion === undefined) {
        throw new Error('Harness repair canary did not receive the file version.');
      }
      return {
        kind: 'harness_tool_edit_check.js',
        events: harnessToolEvents('edit-repair-check', 'edit', {
          file_path: 'check.js',
          observed_version: observedVersion,
          content: "const canary = 'packaged-harness-check-repaired';\nvoid canary;\n",
        }, 'I found the failing fixture and will correct it, then let Builder run the check again.'),
      };
    }
    state.harnessRepairStarted = false;
    state.harnessRepairCompleted = true;
    return {
      kind: 'harness_text_repaired',
      events: harnessTextEvents('Repaired check.js after the failed Builder check.'),
    };
  }
  if (toolResults.length === 0) {
    if (
      state.harnessFailedCheckRepair
      && state.harnessRepairCompleted
      && !state.harnessRepairContinuationConsumed
    ) {
      state.harnessRepairContinuationConsumed = true;
    } else {
      state.harnessRunCount += 1;
    }
    return {
      kind: 'harness_tool_read',
      events: harnessToolEvents(`read-index-${state.harnessRunCount}`, 'read', {
        file_path: 'index.html',
      }, 'I will inspect the current project before deciding which files need to change.'),
    };
  }
  const files = harnessFiles(
    state.harnessRunCount,
    state.harnessFailedCheckRepair && state.harnessRunCount === 1,
    state.harnessStressScenarios,
    state.harnessDependencyWorkspaceMissing,
    state.harnessDependencyLocalInstall,
    state.harnessDependencyInstallFails,
  );
  const allResults = toolResults.join('\n');
  const readAbsent = /File: index\.html\s+Status: absent/u.test(allResults);
  if (readAbsent) {
    for (const [filePath, content] of files) {
      if (!allResults.includes(`Created: ${filePath}`)) {
        return {
          kind: `harness_tool_write_${filePath}`,
          events: harnessToolEvents(
            `write-${state.harnessRunCount}-${filePath}`,
            'write',
            { file_path: filePath, content },
            `The project is missing ${filePath}, so I will create it as part of the requested change.`,
          ),
        };
      }
    }
    return {
      kind: 'harness_text_completed',
      events: harnessTextEvents('Created the focus timer files and left them ready for Builder checks.'),
    };
  }
  if (!allResults.includes('Edited: index.html')) {
    const observedVersion = [...allResults.matchAll(/Observed version:\s*(sha256:[0-9a-f]{64})/gu)].at(-1)?.[1];
    if (observedVersion === undefined) throw new Error('Harness canary did not receive the file version.');
    return {
      kind: 'harness_tool_edit_index.html',
      events: harnessToolEvents(`edit-index-${state.harnessRunCount}`, 'edit', {
        file_path: 'index.html',
        observed_version: observedVersion,
        content: files.get('index.html'),
      }, 'I found the existing page and will update index.html while preserving the current file version.'),
    };
  }
  return {
    kind: 'harness_text_completed',
    events: harnessTextEvents('Updated index.html and left the project ready for Builder checks.'),
  };
}

function savedProjectContextVerified(messageContents) {
  for (const content of messageContents) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      continue;
    }
    if (parsed?.instruction !== CANARY_QUESTION) continue;
    const files = parsed?.current_source_tree?.files;
    if (!Array.isArray(files)) {
      throw new Error('Saved project question did not include current source files.');
    }
    const indexFile = files.find((file) => file?.path === 'index.html');
    const packageFile = files.find((file) => file?.path === 'package.json');
    if (
      typeof indexFile?.content !== 'string'
      || !indexFile.content.includes('Focus Timer Continued')
      || !indexFile.content.includes('A fresh continuation from the restored checkpoint.')
      || typeof packageFile?.content !== 'string'
      || !packageFile.content.includes('clawfabric-packaged-canary')
    ) {
      throw new Error('Saved project question did not include the current admitted source.');
    }
    return true;
  }
  return false;
}

function explanationOutput(messageContents = []) {
  const projectContextVerified = savedProjectContextVerified(messageContents);
  const usageQuestionVerified = messageContents.some((content) => {
    try {
      const parsed = JSON.parse(content);
      if (parsed?.instruction !== '这个项目应该怎么运行和使用？') return false;
      const files = parsed?.current_source_tree?.files;
      if (!Array.isArray(files)) {
        throw new Error('Project usage question did not include current source files.');
      }
      const packageFile = files.find((file) => file?.path === 'package.json');
      const indexFile = files.find((file) => file?.path === 'index.html');
      if (
        typeof packageFile?.content !== 'string'
        || !packageFile.content.includes('"test"')
        || typeof indexFile?.content !== 'string'
      ) {
        throw new Error('Project usage question did not include the runnable draft source.');
      }
      return true;
    } catch (error) {
      if (error instanceof SyntaxError) return false;
      throw error;
    }
  });
  return JSON.stringify({
    kind: 'builder_conversation_explanation',
    title: usageQuestionVerified
      ? '项目使用说明'
      : projectContextVerified ? 'Current project answer' : 'Local canary answer',
    summary: usageQuestionVerified
      ? '根据当前草稿说明运行和检查方式。'
      : projectContextVerified
      ? 'Answers from the current project source.'
      : 'Answers without changing files.',
    explanation: usageQuestionVerified
      ? '直接在浏览器中打开 `index.html` 即可使用；在项目目录运行 `npm test` 可以检查项目。'
      : projectContextVerified
      ? CANARY_SAVED_PROJECT_CONTEXT_ANSWER
      : 'This local canary answer verifies chat flow without changing project files.',
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
  const variants = [
    ['Focus Timer', 'A compact local canary project.'],
    ['Focus Timer Updated', 'A reviewed update from the packaged canary.'],
    ['Focus Timer Complete', 'A compact completed-state summary for the packaged canary.'],
    ['Focus Timer Refined', 'A first unsaved refinement for checkpoint recovery.'],
    ['Focus Timer Polished', 'A second unsaved refinement for checkpoint recovery.'],
    ['Focus Timer Continued', 'A fresh continuation from the restored checkpoint.'],
  ];
  const [heading, subtitle] = variants[Math.min(Math.max(index, 1), variants.length) - 1];
  return JSON.stringify({
    kind: 'builder_code_change_operations',
    title: 'Focus timer',
    summary: 'A timer.',
    operations: [
      {
        operation: 'upsert',
        path: 'README.md',
        content: '# Focus Timer\n\nPackaged canary project.\n',
      },
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
  if (outputKind === 'builder_conversation_explanation') return explanationOutput(messageContents);
  if (outputKind === 'builder_code_change_operations') {
    state.codeChangeCount += 1;
    return codeChangeOutput(state.codeChangeCount);
  }
  const promptText = messageContents.join('\n');
  const explicitKind = promptText.match(
    /Set kind to (builder_(?:conversation_explanation|project_plan_proposal|code_change_operations))/u,
  )?.[1] ?? null;
  if (explicitKind === 'builder_project_plan_proposal') return planOutput();
  if (explicitKind === 'builder_conversation_explanation') return explanationOutput(messageContents);
  if (explicitKind === 'builder_code_change_operations') {
    state.codeChangeCount += 1;
    return codeChangeOutput(state.codeChangeCount);
  }
  if (promptText.includes('builder_project_plan_proposal')) return planOutput();
  if (promptText.includes('builder_conversation_explanation')) return explanationOutput(messageContents);
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
  const deferredHarnessResponses = Number.isSafeInteger(options.deferHarnessResponses)
    && options.deferHarnessResponses > 0
    ? options.deferHarnessResponses
    : 0;
  const deferHarnessResponsesAfter = Number.isSafeInteger(options.deferHarnessResponsesAfter)
    && options.deferHarnessResponsesAfter > 0
    ? options.deferHarnessResponsesAfter
    : 0;
  const delayedHarnessStreamResponses = Number.isSafeInteger(options.delayedHarnessStreamResponses)
    && options.delayedHarnessStreamResponses > 0
    ? options.delayedHarnessStreamResponses
    : 0;
  const harnessStreamEventDelayMs = Number.isSafeInteger(options.harnessStreamEventDelayMs)
    && options.harnessStreamEventDelayMs > 0
    && options.harnessStreamEventDelayMs <= 10_000
    ? options.harnessStreamEventDelayMs
    : 0;
  const state = {
    codeChangeCount: 0,
    deferredHarnessResponses,
    deferHarnessResponsesAfter,
    delayedHarnessStreamResponses,
    harnessStreamEventDelayMs,
    harnessRunCount: 0,
    harnessResponseCount: 0,
    harnessFailedCheckRepair: options.harnessFailedCheckRepair === true,
    harnessAdversarialBoundaries: options.harnessAdversarialBoundaries === true,
    harnessAgentBrowserCancellation: options.harnessAgentBrowserCancellation === true,
    harnessStressScenarios: options.harnessStressScenarios === true,
    harnessDependencyWorkspaceMissing: options.harnessDependencyWorkspaceMissing === true,
    harnessDependencyLocalInstall: options.harnessDependencyLocalInstall === true,
    harnessDependencyInstallFails: options.harnessDependencyInstallFails === true,
    forbiddenHarnessText: typeof options.forbiddenHarnessText === 'string'
      ? options.forbiddenHarnessText
      : null,
    harnessRepairCompleted: false,
    harnessRepairContinuationConsumed: false,
    harnessRepairStarted: false,
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
      if (isHarnessRequest(body)) {
        const harnessPromptText = Array.isArray(body.messages)
          ? body.messages.map((message) => (
              typeof message?.content === 'string' ? message.content : ''
            )).join('\n')
          : '';
        if (
          state.forbiddenHarnessText !== null
          && JSON.stringify(body).includes(state.forbiddenHarnessText)
        ) {
          throw new Error('Harness canary received text from outside the admitted workspace.');
        }
        const harnessOutput = harnessOutputForRequest(body, state);
        state.harnessResponseCount += 1;
        const streamEventDelayMs = Number.isSafeInteger(harnessOutput.event_delay_ms)
          && harnessOutput.event_delay_ms >= 0
          && harnessOutput.event_delay_ms <= 10_000
          ? harnessOutput.event_delay_ms
          : state.harnessResponseCount <= state.delayedHarnessStreamResponses
            ? state.harnessStreamEventDelayMs
            : 0;
        const requestRecord = {
          approved_plan_canary_step_present:
            harnessPromptText.includes('Apply the approved canary edit'),
          approved_plan_context_present:
            harnessPromptText.includes('<approved_plan>')
            && harnessPromptText.includes('</approved_plan>'),
          completed: false,
          message_count: Array.isArray(body.messages) ? body.messages.length : null,
          response_kind: harnessOutput.kind,
          stream: body.stream === true,
          stream_event_count: harnessOutput.events.length,
          stream_event_delay_ms: streamEventDelayMs,
        };
        state.requests.push(requestRecord);
        if (typeof options.onRequest === 'function') options.onRequest(Object.freeze({ ...requestRecord }));
        if (state.requests.length > 40) state.requests.shift();
        if (body.stream !== true) throw new Error('Harness canary requires streaming.');
        if (
          state.harnessResponseCount > state.deferHarnessResponsesAfter
          && state.deferredHarnessResponses > 0
        ) {
          state.deferredHarnessResponses -= 1;
          await new Promise((resolve) => {
            state.pendingResponseReleases.push(resolve);
          });
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        await writeHarnessStream(response, harnessOutput.events, streamEventDelayMs);
        requestRecord.completed = true;
        return;
      }
      const content = outputForRequest(body, state);
      let responseKind = null;
      try {
        responseKind = JSON.parse(content)?.kind ?? null;
      } catch {
        responseKind = null;
      }
      state.requests.push(Object.freeze({
        code_change_ordinal: responseKind === 'builder_code_change_operations'
          ? state.codeChangeCount
          : null,
        message_count: Array.isArray(body.messages) ? body.messages.length : null,
        response_kind: typeof responseKind === 'string' ? responseKind : null,
        stream: body.stream === true,
      }));
      if (typeof options.onRequest === 'function') options.onRequest(state.requests.at(-1));
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
        await writeProviderStream(
          response,
          content,
          responseKind === 'builder_conversation_explanation' ? 20 : 3,
        );
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
      run: (input) => runPackagedCanary(input, {
        env: { ...process.env, BUILDER_PROGRAMMING_RUNTIME: 'disabled' },
      }),
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
  harnessFiles,
  harnessLongStreamEvents,
  harnessOutputForRequest,
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
