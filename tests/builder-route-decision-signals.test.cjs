'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PUBLIC_BUILDER_ROUTE_DECISION_SIGNALS,
  isPublicBuilderRouteDecisionSignal,
} = require('../electron/builder-route-decision-signals.cjs');

test('defines the fixed public route-decision signal vocabulary', () => {
  assert.deepEqual(PUBLIC_BUILDER_ROUTE_DECISION_SIGNALS, [
    'active_run_cancel',
    'active_run_followup',
    'active_run_steer',
    'active_run_unsupported',
    'brief_correction',
    'capability_question',
    'chat_default',
    'clear_build',
    'composer_mode_plan',
    'contextual_build',
    'contextual_build_phrase',
    'current_artifact_defect',
    'current_artifact_direct_change',
    'empty_message',
    'explicit_brief',
    'explicit_plan',
    'exploratory_work',
    'goal_mode_request',
    'local_file_artifact',
    'pending_build_confirmation',
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

test('keeps classifier route-decision signals inside the public vocabulary', () => {
  const root = path.join(__dirname, '..');
  const sources = [
    'electron/builder-generation-main-service.cjs',
    'src/features/builder/application/builderComposerIntent.ts',
  ];
  const patterns = [
    /matchedSignals:\s*\[\s*'([^']+)'\s*\]/gu,
    /(?:answerRouteDecisionHint|buildRouteDecisionHint)\(\[\s*'([^']+)'\s*\]\)/gu,
  ];
  const signals = [];
  for (const source of sources) {
    const body = fs.readFileSync(path.join(root, source), 'utf8');
    for (const pattern of patterns) {
      for (const match of body.matchAll(pattern)) {
        signals.push({ source, signal: match[1] });
      }
    }
  }
  assert.notEqual(signals.length, 0);
  assert.deepEqual(
    signals.filter(({ signal }) => !isPublicBuilderRouteDecisionSignal(signal)),
    [],
  );
});
