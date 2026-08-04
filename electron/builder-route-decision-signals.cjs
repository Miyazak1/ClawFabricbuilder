'use strict';

const PUBLIC_BUILDER_ROUTE_DECISION_SIGNALS = Object.freeze([
  'active_run_cancel',
  'active_run_followup',
  'active_run_steer',
  'active_run_unsupported',
  'capability_question',
  'chat_default',
  'clear_build',
  'composer_mode_plan',
  'contextual_build',
  'contextual_build_phrase',
  'current_artifact_defect',
  'empty_message',
  'explicit_brief',
  'explicit_plan',
  'exploratory_work',
  'goal_mode_request',
  'local_file_artifact',
  'read_only',
  'vague_change',
  'work_discussion',
]);
const PUBLIC_BUILDER_ROUTE_DECISION_SIGNAL_SET = new Set(PUBLIC_BUILDER_ROUTE_DECISION_SIGNALS);

function isPublicBuilderRouteDecisionSignal(value) {
  return typeof value === 'string' && PUBLIC_BUILDER_ROUTE_DECISION_SIGNAL_SET.has(value);
}

module.exports = Object.freeze({
  PUBLIC_BUILDER_ROUTE_DECISION_SIGNALS,
  isPublicBuilderRouteDecisionSignal,
});
