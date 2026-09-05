'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

test('new task targets cannot use project-root conversation compatibility', () => {
  const conversationAddress = read('electron', 'builder-conversation-address.cjs');
  const taskAddress = read('electron', 'builder-session-task-address.cjs');
  const taskTargetService = read('electron', 'builder-session-task-target-service.cjs');
  const generationMainService = read('electron', 'builder-generation-main-service.cjs');

  assert.match(
    conversationAddress,
    /function sanitizeBuilderTaskConversationAddress\(projectId, conversationId\)/,
  );
  assert.match(conversationAddress, /format !== 'task_conversation'/);

  assert.match(taskAddress, /function safeProjectConversationId\(projectId, value\)/);
  assert.match(taskAddress, /function safeTaskConversationId\(projectId, value\)/);
  assert.match(taskAddress, /root_conversation_id: safeProjectConversationId/);
  assert.match(taskAddress, /conversation_id: safeTaskConversationId/);

  assert.match(taskTargetService, /\bsanitizeBuilderTaskConversationAddress\b/);
  assert.doesNotMatch(taskTargetService, /\bsanitizeBuilderConversationAddress\b/);

  assert.match(generationMainService, /\bsanitizeBuilderTaskConversationAddress\b/);
  assert.doesNotMatch(generationMainService, /\bparseBuilderConversationAddress\b/);
});

test('audit document records official-source comparison and no-compatibility decision', () => {
  const audit = read(
    'docs',
    'BUILDER_DEEPSEEK_HARNESS_AGENT_PRODUCT_CLEAN_ARCHITECTURE_AUDIT_2026_09_02.md',
  );

  assert.match(audit, /DeepSeek Harness And Agent Product Clean Architecture Audit/);
  assert.match(audit, /https:\/\/www\.deepseek\.com\/harness\/en\//);
  assert.match(audit, /https:\/\/github\.com\/deepseek-ai\/deepseek-harness\/blob\/master\/docs\/architecture\.md/);
  assert.match(audit, /https:\/\/help\.openai\.com\/en\/articles\/11390924/);
  assert.match(audit, /https:\/\/docs\.anthropic\.com\/en\/docs\/claude-code\/cli-usage/);
  assert.match(audit, /https:\/\/docs\.cursor\.com\/en\/agent\/chat\/checkpoints/);
  assert.match(audit, /https:\/\/docs\.github\.com\/en\/copilot\/using-github-copilot\/using-copilot-coding-agent-to-work-on-tasks\/best-practices-for-using-copilot-to-work-on-tasks/);
  assert.match(audit, /https:\/\/docs\.windsurf\.com\/zh\/windsurf\/cascade\/memories/);
  assert.match(audit, /No root conversation compatibility for new task targets/);
  assert.match(audit, /No migration shim for old Task Address records/);
  assert.match(audit, /Generation admission uses the task-scoped conversation sanitizer/);
});
