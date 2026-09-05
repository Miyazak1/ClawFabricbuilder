'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ADDRESS_VERSION,
  BuilderConversationAddressError,
  createBuilderConversationAddress,
  parseBuilderConversationAddress,
  sanitizeBuilderConversationAddress,
  sanitizeBuilderTaskConversationAddress,
} = require('../electron/builder-conversation-address.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174200';
const OTHER_PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174201';
const CONVERSATION_UUID = '123e4567-e89b-42d3-a456-426614174300';

test('creates a project-bound address with an independent conversation identity', () => {
  const conversationId = createBuilderConversationAddress(PROJECT_ID, CONVERSATION_UUID);
  assert.equal(
    conversationId,
    'builder-conversation:123e4567-e89b-42d3-a456-426614174200:123e4567-e89b-42d3-a456-426614174300',
  );
  assert.deepEqual(parseBuilderConversationAddress(conversationId), {
    address_version: ADDRESS_VERSION,
    conversation_id: conversationId,
    project_uuid: '123e4567-e89b-42d3-a456-426614174200',
    conversation_uuid: CONVERSATION_UUID,
    format: 'task_conversation',
  });
  assert.equal(sanitizeBuilderConversationAddress(PROJECT_ID, conversationId), conversationId);
});

test('retains the project-root address only when it is bound to the same project', () => {
  const rootConversationId = 'builder-conversation:123e4567-e89b-42d3-a456-426614174200';
  assert.equal(sanitizeBuilderConversationAddress(PROJECT_ID, rootConversationId), rootConversationId);
  assert.equal(parseBuilderConversationAddress(rootConversationId).format, 'project_root');
  assert.throws(
    () => sanitizeBuilderConversationAddress(OTHER_PROJECT_ID, rootConversationId),
    BuilderConversationAddressError,
  );
});

test('admits task conversations separately from project-root history addresses', () => {
  const conversationId = createBuilderConversationAddress(PROJECT_ID, CONVERSATION_UUID);
  const rootConversationId = 'builder-conversation:123e4567-e89b-42d3-a456-426614174200';
  assert.equal(sanitizeBuilderTaskConversationAddress(PROJECT_ID, conversationId), conversationId);
  assert.throws(
    () => sanitizeBuilderTaskConversationAddress(PROJECT_ID, rootConversationId),
    BuilderConversationAddressError,
  );
});

test('rejects malformed, cross-project, and accessor-like input without leaking values', () => {
  const conversationId = createBuilderConversationAddress(PROJECT_ID, CONVERSATION_UUID);
  for (const invalid of [null, '', `${conversationId}:extra`, conversationId.toUpperCase()]) {
    assert.throws(() => parseBuilderConversationAddress(invalid), BuilderConversationAddressError);
  }
  assert.throws(
    () => sanitizeBuilderConversationAddress(OTHER_PROJECT_ID, conversationId),
    BuilderConversationAddressError,
  );
});
