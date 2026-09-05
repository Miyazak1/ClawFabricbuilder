'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright-core');
const {
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  captureGuardedUserDataRoot,
  createArtifactGate,
  createCanaryProjectRoot,
  fillProviderSettingsViaUi,
  sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');
const { createLocalCanaryProviderServer } = require('./verify-packaged-canary-default.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const INSTRUCTION = 'Plan a complete interactive 3D football blog. Do not change files.';
const FAILED_INSTRUCTION = 'Revise the football blog plan with accessible keyboard navigation.';
const SHORT_PLAN = '# Incomplete plan\n\n- Use React and Three.js.';
const FULL_PLAN = `## 1. Goals and non-goals

## Product boundaries
- Deliver a football-field navigation surface linked to readable blog articles, categories, and an about page.
- Keep authentication, comments, payments, and remote content editing outside the first release; no account is required.

## Reader workflows
- Readers can open an article from a stadium hotspot or the equivalent keyboard-accessible article list.
- Article detail preserves the selected category and provides predictable navigation back to the previous stadium position.

## Architecture and files
- Use React and Three.js, separating the scene in src/scene from article routes in src/articles and shared controls in src/ui.
- Keep article metadata and hotspot mappings in validated content records; reject duplicate identifiers before building.

## Content contracts
- Each article has a stable id, title, summary, category, publication date, and Markdown body with validated local assets.
- Each hotspot references an existing article id and a bounded scene position; missing content displays an accessible fallback.

## Interaction and layout
- Support mouse picking, touch selection, orbit limits, visible focus indicators, and reduced-motion preferences.
- Use responsive full-viewport scene framing with a separate readable article surface; prevent overlapping controls at narrow widths.

## Failure and loading states
- Display loading progress and an actionable retry for asset failures; never leave the navigation in an indefinite spinner.
- When WebGL is unavailable, retain all content and navigation in a semantic HTML list instead of blocking the reader.

## Implementation sequence
- First implement content validation and article routes, then add the scene and hotspot mapping against those stable contracts.
- Complete accessible controls before visual refinement, and keep each stage independently testable with explicit acceptance criteria.

## Tests and acceptance
- Unit-test missing articles, duplicate identifiers, malformed dates, and hotspot bounds; verify stable URLs and keyboard order.
- Use browser tests at desktop and mobile widths to open every article and confirm a nonblank canvas with all local assets loaded.

## Delivery and rollback
- Run the project checks and production build before approval, record the outputs, and package only verified local source changes.
- Preserve the previous approved version; roll back the scene independently if performance or accessibility acceptance checks fail.

## Remaining decisions
- Use local Markdown content and a small static stadium for the initial release, documenting these defaults for later revision.
- No file changes or execution are authorized by this plan; wait for explicit approval before creating an implementation task.`;

async function createProvider(execute, exhaust, resumeWaiting, readOnlyLimit) {
  const requests = [];
  const fallback = execute ? await createLocalCanaryProviderServer() : null;
  let harnessRequests = 0;
  let heldResponse = null;
  function emit(response, delta, finishReason = null) {
    response.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason }] })}\n\n`);
  }
  function finishRead(response, id, narration, filePath = 'package.json') {
    emit(response, { content: narration });
    emit(response, { tool_calls: [{ index: 0, id, type: 'function',
      function: { name: 'read', arguments: JSON.stringify({ file_path: filePath }) } }] });
    emit(response, {}, 'tool_calls');
    response.end('data: [DONE]\n\n');
  }
  function finishWrite(response, id, filePath, content) {
    emit(response, { role: 'assistant', content: null, reasoning_content: '' });
    emit(response, { content: `The approved implementation requires ${filePath}, so I will create it now.` });
    emit(response, { tool_calls: [{ index: 0, id, type: 'function',
      function: { name: 'write', arguments: JSON.stringify({
        file_path: filePath,
        content,
      }) } }] });
    emit(response, {}, 'tool_calls');
    response.end('data: [DONE]\n\n');
  }
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/v1/chat/completions');
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        assert.ok(bytes <= 2 * 1024 * 1024);
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (execute && Array.isArray(body.tools) && body.tools.length > 0) {
        harnessRequests += 1;
        requests.push({ harness: true, approved_plan_present: body.messages.some(message =>
          typeof message.content === 'string' && message.content.includes(`<approved_plan>\n${FULL_PLAN}\n</approved_plan>`)),
          thinking: body.thinking?.type, reasoning_effort: body.reasoning_effort ?? null, max_tokens: body.max_tokens });
        if (resumeWaiting && harnessRequests <= 4) {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          emit(response, { role: 'assistant', content: null, reasoning_content: '' });
          emit(response, { reasoning_content: 'Synthetic private reasoning must not be displayed.' });
          if (harnessRequests % 2 === 1) {
            finishRead(response, `resume-read-${harnessRequests}`, harnessRequests === 1
              ? 'I will inspect the workspace before implementation.'
              : 'I will inspect the workspace after resuming.');
          } else {
            heldResponse = response;
          }
        } else if (readOnlyLimit && harnessRequests === 1) {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          emit(response, { role: 'assistant', content: null, reasoning_content: '' });
          finishRead(
            response,
            'read-only-limit-read',
            'I will inspect the workspace before implementing the approved plan.',
            'README.md',
          );
        } else if ((readOnlyLimit && harnessRequests === 2) || (!readOnlyLimit && harnessRequests === 1) || exhaust) {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', reasoning_content: 'Synthetic reasoning-only response.' }, finish_reason: null }] })}\n\n`);
          response.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 32, completion_tokens: 8192, completion_tokens_details: { reasoning_tokens: 8192 } } })}\n\ndata: [DONE]\n\n`);
        } else if (readOnlyLimit && harnessRequests >= 3 && harnessRequests <= 5) {
          const recoveryFiles = [
            ['index.html', '<!doctype html>\n<html><body><main><h1>Football Blog</h1></main></body></html>\n'],
            ['package.json', `${JSON.stringify({
              name: 'clawfabric-agent-plan-recovery-canary', private: true,
              scripts: { test: 'node --check check.js' },
            }, null, 2)}\n`],
            ['check.js', "const canary = 'approved-plan-recovery-ready';\nvoid canary;\n"],
          ];
          const [filePath, content] = recoveryFiles[harnessRequests - 3];
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          finishWrite(response, `read-only-limit-write-${harnessRequests}`, filePath, content);
        } else if (readOnlyLimit && harnessRequests === 6) {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          emit(response, { role: 'assistant', content: null, reasoning_content: '' });
          emit(response, { content: 'Implemented the approved plan and left the project ready for Builder checks.' });
          emit(response, {}, 'stop');
          response.end('data: [DONE]\n\n');
        } else {
          const upstream = await fetch(`${fallback.baseUrl}/chat/completions`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
          });
          response.writeHead(upstream.status, { 'content-type': 'text/event-stream' });
          for await (const chunk of upstream.body) response.write(chunk);
          response.end();
        }
        return;
      }
      const reminder = JSON.parse(body.messages.at(-1).content);
      assert.equal(reminder.response_mode, 'plan');
      const repair = body.messages.some((message) => /previous answer response could not be verified/iu.test(message.content));
      assert.equal(repair, false, 'Agent Plan must not issue an automatic rewrite request');
      const expectedCount = 2;
      assert.equal(body.messages.length, expectedCount);
      assert.deepEqual(body.messages.map((message) => message.role), ['system', ...Array(expectedCount - 1).fill('user')]);
      assert.match(body.messages[0].content, /raw Markdown only/iu);
      assert.equal(body.response_format, undefined, 'Markdown Plan must not be forced through JSON response mode');
      assert.equal(body.stream, true);
      requests.push({ message_count: expectedCount, repair, failure_case: reminder.instruction === FAILED_INSTRUCTION });
      const content = reminder.instruction === FAILED_INSTRUCTION ? SHORT_PLAN : FULL_PLAN;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      // Slow streaming makes the live Markdown state observable before durable review.
      for (let start = 0; start < content.length; start += 120) {
        response.write(`data: ${JSON.stringify({ choices: [{ finish_reason: null, delta: { content: content.slice(start, start + 120) } }] })}\n\n`);
        await delay(40);
      }
      response.end(`data: ${JSON.stringify({ choices: [{ finish_reason: 'stop', delta: {} }] })}\n\ndata: [DONE]\n\n`);
    } catch {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests,
    release: () => {
      assert.ok(heldResponse !== null && !heldResponse.destroyed);
      finishRead(heldResponse, 'resume-read-final', 'The inspection is complete; I will implement the project now.', 'index.html');
      heldResponse = null;
    },
    close: async () => {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      if (fallback !== null) await fallback.close();
    },
  };
}

async function readPlan(page) {
  return page.evaluate(async (agentId) => {
    const workbench = await globalThis.window.clawfabricBuilder.agentWorkbench.read({
      agent_id: agentId, after_cursor: null, limit: 80,
    });
    return workbench.agent_plan;
  }, AGENT_ID);
}

async function waitForIdle(page) {
  await page.locator('[data-builder-submit-in-flight="true"]').waitFor({ state: 'hidden', timeout: 15_000 });
  await page.locator(SELECTORS.cancelWork).waitFor({ state: 'hidden', timeout: 15_000 });
}

async function run() {
  const executablePath = process.argv.slice(2).find(argument => !argument.startsWith('--'))
    ?? path.join(__dirname, '..', 'release', 'win-unpacked', 'ClawFabric Builder.exe');
  const execute = process.argv.includes('--execute');
  const exhaust = process.argv.includes('--exhaust');
  const resumeWaiting = process.argv.includes('--resume-waiting');
  const readOnlyLimit = process.argv.includes('--read-only-limit');
  const restartWhilePaused = process.argv.includes('--restart-while-paused');
  assert.ok(!restartWhilePaused || resumeWaiting, '--restart-while-paused requires --resume-waiting');
  assert.ok(!readOnlyLimit || execute, '--read-only-limit requires --execute');
  assert.ok(!readOnlyLimit || (!exhaust && !resumeWaiting), '--read-only-limit is a distinct execution scenario');
  const outputDirectory = path.join(__dirname, '..', 'release', execute
    ? `agent-plan-execute-${restartWhilePaused ? 'restart-paused' : resumeWaiting ? 'resume-waiting' : exhaust ? 'exhaust' : readOnlyLimit ? 'read-only-limit' : 'recover'}-20260901` : 'agent-plan-single-pass-20260901');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
  const userDataRoot = captureGuardedUserDataRoot(userDataPath);
  const projectRoot = createCanaryProjectRoot(userDataRoot);
  const gate = createArtifactGate();
  let provider = null;
  let app = null;
  let page = null;
  try {
    provider = await createProvider(execute, exhaust, resumeWaiting, readOnlyLimit);
    app = await electron.launch({
      executablePath, args: [], env: sanitizeLaunchEnvironment(process.env, userDataPath, projectRoot),
    });
    page = await app.firstWindow();
    await fillProviderSettingsViaUi(page, {
      base_url: provider.baseUrl, model: 'local-plan-repair-canary', credential: 'local-canary-only',
      timeout_ms: 30000, temperature: 0, max_tokens: 8192,
    }, gate);
    await page.locator(SELECTORS.agentRosterItem).first().click();
    await page.locator('[data-builder-agent-workbench-stream="true"]').waitFor({ state: 'visible' });
    await page.locator(SELECTORS.composerAddMenuButton).click();
    await page.locator(SELECTORS.composerAddPlanMode).click();
    await page.locator(SELECTORS.idea).fill(INSTRUCTION);
    await page.locator(SELECTORS.submitTurn).click();
    await page.locator('[data-builder-live-output="true"] [data-builder-conversation-markdown="true"]')
      .waitFor({ state: 'visible', timeout: 30_000 });
    const review = page.locator('[data-builder-agent-plan-decision="true"]');
    await review.waitFor({ state: 'visible', timeout: 30_000 });
    await waitForIdle(page);
    const plan = await readPlan(page);
    assert.equal(plan.artifact.markdown, FULL_PLAN);
    assert.equal(plan.decision, null);
    assert.equal(await review.getByRole('button', { name: 'Approve plan', exact: true }).isEnabled(), true);
    assert.deepEqual(provider.requests.map((request) => request.message_count), [2]);
    assert.equal(await page.locator('[data-builder-workbench-content-type="builder.chat.user_message.v1"]').count(), 1);
    const markdown = page.locator(`[data-builder-workbench-message="${plan.artifact.source_message_id}"] [data-builder-conversation-markdown="true"]`);
    assert.ok((await markdown.innerText()).length > 1200);
    await review.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outputDirectory, 'plan-ready.png') });

    if (execute) {
      await review.getByRole('button', { name: 'Approve plan', exact: true }).click();
      await page.locator(SELECTORS.agentTaskProposalNewProject).click();
      if (resumeWaiting) {
        for (const requestCount of [2, 4]) {
          const deadline = Date.now() + 30_000;
          while (provider.requests.filter((request) => request.harness).length < requestCount) {
            assert.ok(Date.now() < deadline, 'Harness did not reach the waiting step');
            if (await page.locator(SELECTORS.approveCurrentProjectWrite).isVisible()) {
              await page.locator(SELECTORS.approveCurrentProjectWrite).click();
            }
            await delay(100);
          }
          const waiting = page.locator('[data-builder-live-output="true"]');
          await waiting.waitFor({ state: 'visible', timeout: 10_000 });
          // The provider can receive the next step before React commits the
          // previous narration. Wait for that transition before asserting it.
          await page.waitForFunction(() => {
            const live = globalThis.document.querySelector('[data-builder-live-output="true"]');
            return live !== null && live.querySelector('.cf-builder-live-output-text')?.textContent?.trim() === ''
              && /Thinking|\u6b63\u5728\u601d\u8003/u.test(live.textContent ?? '');
          }, null, { timeout: 10_000 });
          assert.match(await waiting.innerText(), /Thinking|正在思考/u);
          assert.equal((await waiting.locator('.cf-builder-live-output-text').innerText()).trim(), '');
          assert.equal(await page.getByText(requestCount === 2
            ? 'I will inspect the workspace before implementation.'
            : 'I will inspect the workspace after resuming.', { exact: true }).count(), 1);
          assert.equal(await page.getByText('Synthetic private reasoning must not be displayed.', { exact: false }).count(), 0);
          await page.screenshot({ path: path.join(outputDirectory, `waiting-${requestCount}.png`) });
          if (requestCount === 2) {
            await page.getByRole('button', { name: 'Pause task', exact: true }).click();
            await page.locator('[data-builder-composer-state="paused"]').waitFor({ state: 'visible', timeout: 15_000 });
            if (restartWhilePaused) {
              const pausedAddress = await page.evaluate(async (agentId) => {
                const tree = await globalThis.window.clawfabricBuilder.agentProjectTree.read({
                  agent_id: agentId,
                });
                const addresses = [];
                for (const project of tree.projects ?? []) {
                  for (const task of project.tasks ?? []) {
                    addresses.push({
                      project_id: project.project_id,
                      task_address_id: task.task_address_id,
                    });
                    if (task.status === 'paused') {
                      return {
                        project_id: project.project_id,
                        task_address_id: task.task_address_id,
                      };
                    }
                  }
                }
                return addresses.length === 1 ? addresses[0] : null;
              }, AGENT_ID);
              assert.ok(pausedAddress, 'Paused task must remain addressable before restart');
              await app.close();
              app = await electron.launch({
                executablePath,
                args: [],
                env: sanitizeLaunchEnvironment(process.env, userDataPath, projectRoot),
              });
              page = await app.firstWindow();
              await page.locator(SELECTORS.agentRosterItem).first().click();
              const projectButton = page.locator(
                `button[data-builder-project-id="${pausedAddress.project_id}"]`,
              );
              await projectButton.waitFor({ state: 'attached' });
              await projectButton.scrollIntoViewIfNeeded();
              const projectItem = projectButton.locator('xpath=ancestor::li[1]');
              const taskButton = projectItem.locator(
                `button[data-builder-task-address-id="${pausedAddress.task_address_id}"]`,
              );
              if (!await taskButton.isVisible()) {
                await projectItem.locator('.cf-builder-agent-project-toggle').click();
              }
              await taskButton.click();
              await page.locator('[data-builder-composer-state="paused"]')
                .waitFor({ state: 'visible', timeout: 15_000 });
            }
            await page.locator('[data-builder-resume-interrupted-run="true"]').click();
          }
        }
        provider.release();
      }
      await page.locator(exhaust ? SELECTORS.generationFailedNotice : SELECTORS.saveVersion)
        .waitFor({ state: 'visible', timeout: 60_000 });
      await waitForIdle(page);
      const harnessRequests = provider.requests.filter((request) => request.harness);
      assert.ok(
        harnessRequests.length >= (readOnlyLimit ? 3 : 2),
        readOnlyLimit
          ? 'read-only token exhaustion must continue once in the same session'
          : 'empty output must continue once in the same session',
      );
      assert.ok(harnessRequests.every((request) => request.approved_plan_present));
      assert.ok(harnessRequests.every((request) => request.max_tokens === 8192));
      assert.equal(harnessRequests[0].thinking, 'enabled');
      assert.equal(harnessRequests[0].reasoning_effort, 'high');
      if (readOnlyLimit) {
        assert.equal(harnessRequests[1].thinking, 'enabled');
        assert.equal(harnessRequests[1].reasoning_effort, 'high');
      }
      if (!resumeWaiting) {
        const recoveryStart = readOnlyLimit ? 2 : 1;
        assert.ok(harnessRequests.slice(recoveryStart)
          .every((request) => request.thinking === 'disabled' && request.reasoning_effort === null));
      } else {
        assert.ok(harnessRequests.every((request) => request.thinking === 'enabled' && request.reasoning_effort === 'high'));
      }
      assert.equal(await page.locator(SELECTORS.userMessage).count(), 1, 'automatic continuation must not duplicate the user turn');
      assert.match(await page.locator(SELECTORS.userMessage).innerText(), /^Implement approved Agent Plan v1\. Read the bound full plan/u);
      if (exhaust) {
        assert.equal(harnessRequests.length, 2);
        assert.deepEqual(fs.readdirSync(projectRoot), []);
        assert.equal(await page.locator('[data-builder-runtime-status] .cf-builder-activity-spinner').count(), 0);
        assert.equal(await page.locator(SELECTORS.retryDraft).isEnabled(), true);
      } else {
        assert.ok(fs.existsSync(path.join(projectRoot, 'index.html')));
        await page.locator(SELECTORS.saveVersion).click();
        await page.locator(SELECTORS.versionSavedActivity).waitFor({ state: 'visible' });
      }
      await page.screenshot({ path: path.join(outputDirectory, 'execution-result.png') });
      const result = { ok: true, scenario: resumeWaiting ? 'resume_waiting_feedback' : exhaust ? 'bounded_failure' : readOnlyLimit ? 'read_only_token_limit_recovery' : 'empty_output_recovery',
        harness_requests: harnessRequests.length, approved_plan_preserved: true, duplicate_user_turn: false,
        paused_and_resumed_via_ui: resumeWaiting,
        restarted_while_paused: restartWhilePaused,
        read_only_completion_rejected: readOnlyLimit,
        recovery_thinking_disabled: !resumeWaiting, unchanged_output_cap: 8192,
        saved_via_ui: !exhaust, original_profile_untouched: true, provider: 'loopback_test_only' };
      fs.writeFileSync(path.join(outputDirectory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    await page.locator(SELECTORS.idea).fill(FAILED_INSTRUCTION);
    await page.locator(SELECTORS.submitTurn).click();
    await page.getByRole('alert').waitFor({ state: 'visible', timeout: 30_000 });
    await waitForIdle(page);
    assert.deepEqual(provider.requests.map((request) => request.message_count), [2, 2]);
    assert.deepEqual(await readPlan(page), plan, 'failed repair must preserve the previous complete plan');
    const preserved = page.locator('[data-builder-workbench-content-type="builder.chat.agent_message.v1"]')
      .filter({ hasText: 'Incomplete plan: this run failed validation' });
    assert.equal(await preserved.count(), 1);
    assert.match(await preserved.innerText(), /Use React and Three.js/u);
    assert.equal(await preserved.getByRole('button', { name: 'Approve plan', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Check AI settings', exact: true }).count(), 0);
    assert.equal(await page.locator(SELECTORS.idea).inputValue(), FAILED_INSTRUCTION);
    assert.equal(await page.locator(SELECTORS.submitTurn).isEnabled(), true);
    assert.deepEqual(fs.readdirSync(projectRoot), [], 'planning must not modify project source');
    await page.getByRole('alert').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outputDirectory, 'incomplete-plan-error.png') });
    await app.close();
    app = await electron.launch({
      executablePath, args: [], env: sanitizeLaunchEnvironment(process.env, userDataPath, projectRoot),
    });
    page = await app.firstWindow();
    await page.locator(SELECTORS.agentRosterItem).click();
    await page.getByText('Incomplete plan: this run failed validation', { exact: false }).waitFor({ state: 'visible' });
    assert.deepEqual(await readPlan(page), plan);
    await page.screenshot({ path: path.join(outputDirectory, 'retained-after-restart.png') });
    const result = {
      ok: true, executable_path: executablePath, provider: 'loopback_test_only',
      request_message_counts: provider.requests.map((request) => request.message_count),
      live_markdown_observed: true, full_plan_persisted: true, review_enabled: true,
      composer_recovered_after_success_and_failure: true, previous_plan_preserved_after_failure: true,
      incomplete_plan_retained_after_restart: true, automatic_rewrite: false,
      no_false_configuration_error: true, original_profile_untouched: true, project_source_unchanged: true,
    };
    fs.writeFileSync(path.join(outputDirectory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const debugPath = path.join(userDataPath, 'builder-canary-generation-debug.jsonl');
    if (fs.existsSync(debugPath)) fs.copyFileSync(debugPath, path.join(outputDirectory, 'generation-debug.jsonl'));
    fs.writeFileSync(path.join(outputDirectory, 'requests.json'), JSON.stringify(provider?.requests ?? [], null, 2));
    if (page !== null && gate.allowed) {
      await page.screenshot({ path: path.join(outputDirectory, 'failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    try { if (app !== null) await app.close(); } finally {
      if (provider !== null) await provider.close();
      const currentRoot = captureGuardedUserDataRoot(userDataRoot.path);
      assert.deepEqual(currentRoot, userDataRoot);
      fs.rmSync(currentRoot.path, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
