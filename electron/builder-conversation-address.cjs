'use strict';

const ADDRESS_VERSION = 'builder-conversation-address.v2';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(
  `^builder-conversation:(${UUID_SOURCE})(?::(${UUID_SOURCE}))?$`,
  'u',
);

class BuilderConversationAddressError extends Error {
  constructor() {
    super('Builder conversation address could not be verified.');
    this.name = 'BuilderConversationAddressError';
    this.code = 'builder_conversation_address_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderConversationAddressError();
}

function projectUuid(projectId) {
  if (typeof projectId !== 'string') fail();
  const match = PROJECT_ID_PATTERN.exec(projectId);
  if (match === null) fail();
  return match[1];
}

function parseBuilderConversationAddress(conversationId) {
  if (typeof conversationId !== 'string') fail();
  const match = CONVERSATION_ID_PATTERN.exec(conversationId);
  if (match === null) fail();
  return Object.freeze({
    address_version: ADDRESS_VERSION,
    conversation_id: conversationId,
    project_uuid: match[1],
    conversation_uuid: match[2] ?? match[1],
    format: match[2] === undefined ? 'project_root' : 'task_conversation',
  });
}

function sanitizeBuilderConversationAddress(projectId, conversationId) {
  const expectedProjectUuid = projectUuid(projectId);
  const address = parseBuilderConversationAddress(conversationId);
  if (address.project_uuid !== expectedProjectUuid) fail();
  return conversationId;
}

function sanitizeBuilderTaskConversationAddress(projectId, conversationId) {
  const sanitized = sanitizeBuilderConversationAddress(projectId, conversationId);
  if (parseBuilderConversationAddress(sanitized).format !== 'task_conversation') fail();
  return sanitized;
}

function createBuilderConversationAddress(projectId, conversationUuid) {
  const ownerProjectUuid = projectUuid(projectId);
  if (typeof conversationUuid !== 'string' || !UUID_PATTERN.test(conversationUuid)) fail();
  return `builder-conversation:${ownerProjectUuid}:${conversationUuid}`;
}

module.exports = Object.freeze({
  ADDRESS_VERSION,
  BuilderConversationAddressError,
  CONVERSATION_ID_PATTERN,
  createBuilderConversationAddress,
  parseBuilderConversationAddress,
  sanitizeBuilderConversationAddress,
  sanitizeBuilderTaskConversationAddress,
});
