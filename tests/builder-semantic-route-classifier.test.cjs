'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBuilderSemanticRoutePromptDescriptor,
  createBuilderSemanticRouteRequest,
  projectBuilderSemanticRouteClassification,
  sanitizeBuilderSemanticRouteRequest,
} = require('../electron/builder-semantic-route-classifier.cjs');

function context(overrides = {}) {
  return {
    has_workspace: true,
    has_prior_build_context: false,
    has_pending_build_confirmation: false,
    has_unsaved_draft: false,
    working_context_status: 'discussing',
    ...overrides,
  };
}

test('creates a bounded semantic route request and prompt without source or conversation text', () => {
  const request = createBuilderSemanticRouteRequest({
    instruction: '帮我做一个静态技术博客实施计划',
    context: context(),
  });
  assert.deepEqual(sanitizeBuilderSemanticRouteRequest(request), request);
  const descriptor = createBuilderSemanticRoutePromptDescriptor(request);
  assert.equal(descriptor.prompt_version, 'builder-semantic-route-prompt.v1');
  assert.match(descriptor.system_instruction, /complete sentence as a whole/u);
  assert.match(descriptor.system_instruction, /做一个静态技术博客实施计划/u);
  assert.match(descriptor.system_instruction, /给当前文件夹做一个优化方案/u);
  assert.match(descriptor.system_instruction, /帮我出一个 README 重构方案/u);
  assert.match(descriptor.system_instruction, /做一个计划管理页面/u);
  assert.match(descriptor.system_instruction, /做一个学习计划表应用/u);
  assert.match(descriptor.system_instruction, /做一个方案展示页/u);
  assert.deepEqual(JSON.parse(descriptor.user_instruction), {
    instruction: '帮我做一个静态技术博客实施计划',
    product_state: context(),
  });
  assert.doesNotMatch(JSON.stringify(descriptor), /source_tree|api[_-]?key|credential|conversation_events/u);
});

test('projects plan and build meanings from the whole provider classification', () => {
  const planRequest = createBuilderSemanticRouteRequest({
    instruction: '帮我做一个静态技术博客实施计划',
    context: context(),
  });
  const plan = projectBuilderSemanticRouteClassification({
    request: planRequest,
    generated_text: JSON.stringify({
      kind: 'builder_semantic_route_classification',
      route: 'plan',
      confidence: 'high',
      reason_code: 'requests_plan_or_proposal',
    }),
  });
  assert.equal(plan.route, 'plan');
  assert.equal(plan.needs_confirmation, false);

  const buildRequest = createBuilderSemanticRouteRequest({
    instruction: '做一个计划管理页面',
    context: context(),
  });
  const build = projectBuilderSemanticRouteClassification({
    request: buildRequest,
    generated_text: JSON.stringify({
      kind: 'builder_semantic_route_classification',
      route: 'build',
      confidence: 'high',
      reason_code: 'requests_source_change',
    }),
  });
  assert.equal(build.route, 'build');
  assert.equal(build.needs_confirmation, false);
});

test('fails closed to clarification for low confidence or ambiguous meaning', () => {
  const request = createBuilderSemanticRouteRequest({
    instruction: '按那个弄一下',
    context: context({ working_context_status: 'needs_clarification' }),
  });
  const result = projectBuilderSemanticRouteClassification({
    request,
    generated_text: JSON.stringify({
      kind: 'builder_semantic_route_classification',
      route: 'clarify',
      confidence: 'low',
      reason_code: 'ambiguous_between_plan_and_build',
    }),
  });
  assert.equal(result.route, 'clarify');
  assert.equal(result.needs_confirmation, true);
  assert.equal(result.authority.source_write, 'not_performed');
  assert.equal(result.authority.permission_grant, false);
});

test('rejects extra request, context, and provider response fields', () => {
  assert.throws(() => createBuilderSemanticRouteRequest({
    instruction: 'Plan this',
    context: { ...context(), source_tree: {} },
  }), { code: 'builder_semantic_route_invalid' });
  const request = createBuilderSemanticRouteRequest({ instruction: 'Plan this', context: context() });
  assert.throws(() => projectBuilderSemanticRouteClassification({
    request,
    generated_text: JSON.stringify({
      kind: 'builder_semantic_route_classification',
      route: 'plan',
      confidence: 'high',
      reason_code: 'requests_plan_or_proposal',
      rationale: 'private chain of thought',
    }),
  }), { code: 'builder_semantic_route_response_invalid' });
  assert.throws(() => projectBuilderSemanticRouteClassification({
    request,
    generated_text: JSON.stringify({
      kind: 'builder_semantic_route_classification',
      route: 'build',
      confidence: 'high',
      reason_code: 'requests_plan_or_proposal',
    }),
  }), { code: 'builder_semantic_route_response_invalid' });
});
