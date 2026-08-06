'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_CONTEXT_COMPACTION_SUMMARY_VERSION,
  CONTEXT_COMPACTION_SUMMARY_AUTHORITY,
  BuilderContextCompactionSummaryError,
  createBuilderContextCompactionSummary,
  sanitizeBuilderContextCompactionSummary,
} = require('../electron/builder-context-compaction-summary.cjs');

const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174400';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174401';
const START_EVENT_ID = `builder-conversation-event:${'1'.repeat(64)}`;
const END_EVENT_ID = `builder-conversation-event:${'2'.repeat(64)}`;

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function input(overrides = {}) {
  return {
    conversation_id: CONVERSATION_ID,
    task_address_id: TASK_ADDRESS_ID,
    source_event_start_id: START_EVENT_ID,
    source_event_end_id: END_EVENT_ID,
    source_event_count: 18,
    token_budget_before: 96_000,
    token_budget_after: 18_000,
    summary: 'The user wants a reliable portfolio homepage. The current direction is gallery first, concise copy, and explicit review before saving.',
    durable_decisions: [
      'Use a gallery-first homepage structure.',
      'Keep implementation gated behind review.',
    ],
    unresolved_questions: ['Confirm whether pricing should appear on the homepage.'],
    omitted_large_outputs: [{
      source_kind: 'tool_output',
      source_digest: digest('a'),
      reason: 'Large source listing omitted; digest and source ref preserved.',
    }],
    source_refs: [
      { source_kind: 'user_message', source_digest: digest('b') },
      { source_kind: 'assistant_message', source_digest: digest('c') },
      { source_kind: 'task_capsule_update', source_digest: digest('d') },
    ],
    created_at_ms: 1_500,
    ...overrides,
  };
}

function assertSummaryError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderContextCompactionSummaryError);
    assert.equal(error.code, 'builder_context_compaction_summary_invalid');
    assert.doesNotMatch(
      `${error.name}:${error.message}:${error.stack}`,
      /secret-value|credential|Authorization|Bearer|provider|source_tree|file_content|C:\\Users|api[_-]?key/iu,
    );
    return true;
  });
}

test('creates a deterministic bounded Context Compaction Summary', () => {
  const first = createBuilderContextCompactionSummary(input());
  const second = createBuilderContextCompactionSummary(structuredClone(input()));

  assert.deepEqual(second, first);
  assert.equal(first.summary_version, BUILDER_CONTEXT_COMPACTION_SUMMARY_VERSION);
  assert.match(first.summary_id, /^builder-context-compaction-summary:[0-9a-f]{64}$/u);
  assert.match(first.source_range_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(first.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(first.conversation_id, CONVERSATION_ID);
  assert.equal(first.task_address_id, TASK_ADDRESS_ID);
  assert.equal(first.source_event_start_id, START_EVENT_ID);
  assert.equal(first.source_event_end_id, END_EVENT_ID);
  assert.equal(first.source_event_count, 18);
  assert.equal(first.token_budget_before, 96_000);
  assert.equal(first.token_budget_after, 18_000);
  assert.equal(first.authority.compaction_authority, 'main_context_compaction_summary_contract_v1');
  assert.equal(first.authority.readiness_authority, 'not_authoritative_for_readiness');
  assert.equal(first.authority.sqlite_write, 'not_performed');
  assert.equal(first.authority.conversation_delete, 'not_performed');
  assert.equal(first.authority.provider_dispatch, 'not_performed');
  assert.equal(first.authority.tool_dispatch, 'not_performed');
  assert.equal(first.authority.source_mutation, 'not_performed');
  assert.equal(first.authority.git_mutation, 'not_performed');
  assert.equal(first.authority.permission_grant, 'not_performed');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.source_refs), true);
  assert.deepEqual(sanitizeBuilderContextCompactionSummary(structuredClone(first)), first);
  assert.deepEqual(first.authority, CONTEXT_COMPACTION_SUMMARY_AUTHORITY);
});

test('keeps omitted outputs as digest-only references without raw payloads', () => {
  const summary = createBuilderContextCompactionSummary(input({
    omitted_large_outputs: [{
      source_kind: 'provider_output',
      source_digest: digest('e'),
      reason: 'Large provider output omitted from compacted context.',
    }, {
      source_kind: 'diff_excerpt',
      source_digest: digest('f'),
      reason: 'Large diff excerpt omitted from compacted context.',
    }],
  }));

  assert.deepEqual(summary.omitted_large_outputs, [{
    source_kind: 'provider_output',
    source_digest: digest('e'),
    reason: 'Large provider output omitted from compacted context.',
  }, {
    source_kind: 'diff_excerpt',
    source_digest: digest('f'),
    reason: 'Large diff excerpt omitted from compacted context.',
  }]);
  assert.doesNotMatch(
    JSON.stringify(summary),
    /raw_prompt|source_tree|file_content|commit_oid|tree_oid|secret-value|Authorization/iu,
  );
});

test('fails closed for malformed budgets, stale refs, secrets, accessors, and forged output', () => {
  assertSummaryError(() => createBuilderContextCompactionSummary(input({
    token_budget_after: 96_000,
  })));
  assertSummaryError(() => createBuilderContextCompactionSummary(input({
    source_event_count: 0,
  })));
  assertSummaryError(() => createBuilderContextCompactionSummary(input({
    summary: 'Read C:\\Users\\Admin\\secret.txt',
  })));
  assertSummaryError(() => createBuilderContextCompactionSummary(input({
    durable_decisions: ['api_key: secret-value'],
  })));
  assertSummaryError(() => createBuilderContextCompactionSummary(input({
    omitted_large_outputs: [{
      source_kind: 'provider_output',
      source_digest: digest('e'),
      reason: 'Authorization: Bearer secret-value',
    }],
  })));
  assertSummaryError(() => createBuilderContextCompactionSummary(input({
    source_refs: [
      { source_kind: 'user_message', source_digest: digest('b') },
      { source_kind: 'user_message', source_digest: digest('b') },
    ],
  })));
  assertSummaryError(() => createBuilderContextCompactionSummary(new Proxy(input(), {})));

  const accessor = input();
  Object.defineProperty(accessor, 'summary', {
    enumerable: true,
    get() { throw new Error('secret-value'); },
  });
  assertSummaryError(() => createBuilderContextCompactionSummary(accessor));

  const valid = createBuilderContextCompactionSummary(input());
  assertSummaryError(() => sanitizeBuilderContextCompactionSummary({
    ...structuredClone(valid),
    source_range_digest: digest('9'),
  }));
  assertSummaryError(() => sanitizeBuilderContextCompactionSummary({
    ...structuredClone(valid),
    digest: digest('8'),
  }));
  assertSummaryError(() => sanitizeBuilderContextCompactionSummary({
    ...structuredClone(valid),
    authority: {
      ...valid.authority,
      permission_grant: 'performed',
    },
  }));
});

test('source remains a pure main-side contract without runtime authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'builder-context-compaction-summary.cjs'), 'utf8');

  assert.doesNotMatch(source, /ipcMain|contextBridge|BrowserWindow|shell\.|child_process|fetch\(|XMLHttpRequest/iu);
  assert.doesNotMatch(source, /safeStorage|provider_secret|apiKey|process\.env|git\s+(?:commit|add|push)/iu);
});
