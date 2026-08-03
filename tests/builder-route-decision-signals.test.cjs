'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PUBLIC_BUILDER_ROUTE_DECISION_SIGNALS,
  isPublicBuilderRouteDecisionSignal,
} = require('../electron/builder-route-decision-signals.cjs');

test('defines the fixed public route-decision signal vocabulary', () => {
  assert.deepEqual(PUBLIC_BUILDER_ROUTE_DECISION_SIGNALS, [
    'capability_question',
    'chat_default',
    'clear_build',
    'contextual_build',
    'contextual_build_phrase',
    'current_artifact_defect',
    'empty_message',
    'explicit_brief',
    'explicit_plan',
    'exploratory_work',
    'goal_mode_request',
    'read_only',
    'vague_change',
    'work_discussion',
  ]);
  assert.equal(Object.isFrozen(PUBLIC_BUILDER_ROUTE_DECISION_SIGNALS), true);
  assert.equal(isPublicBuilderRouteDecisionSignal('clear_build'), true);
  assert.equal(isPublicBuilderRouteDecisionSignal('read_only'), true);
  assert.equal(isPublicBuilderRouteDecisionSignal('provider:deepseek'), false);
  assert.equal(isPublicBuilderRouteDecisionSignal('credential:secret'), false);
  assert.equal(isPublicBuilderRouteDecisionSignal('builder-route-decision:123'), false);
  assert.equal(isPublicBuilderRouteDecisionSignal('test_work_turn'), false);
  assert.equal(isPublicBuilderRouteDecisionSignal(''), false);
  assert.equal(isPublicBuilderRouteDecisionSignal(null), false);
});
