import { describe, expect, it } from 'vitest';

import {
  createBuilderComposerRouteDecisionEvidence,
  decideBuilderComposerIntent,
  isBuilderComposerContextualBuildIntent,
  isBuilderComposerExplicitBriefIntent,
  routeBuilderComposerIntent,
} from './builderComposerIntent';

describe('routeBuilderComposerIntent', () => {
  it.each([
    'hi',
    '你好',
    '在吗',
    '你现在在做什么',
    '这个项目是什么',
    '为什么预览空白',
    '为什么这里字重叠了',
    '怎么把按钮改红？',
    '解释一下为什么标题变大了',
    'What does this project do?',
    '',
  ])('routes %s to answer by default', (instruction) => {
    expect(routeBuilderComposerIntent(instruction)).toBe('answer');
  });

  it.each([
    'Can this look better?',
    '能不能更好看一点',
    '帮我优化一下',
    '优化一下',
    '请调整一下',
    '重构一下',
    'Make it better',
    '我想先聊一下这个页面怎么做',
    '我们先确定风格',
    '我想创建一个登录页，你觉得怎么设计',
    '这个方案如何？',
    '可以帮我做一个登录页吗？',
    '你能不能创建一个登录页？',
    'Can you build a login page?',
    'Should we create a dashboard first?',
    'Let us discuss the dashboard layout first.',
    'What do you think about building a compact dashboard?',
    '这里字都重叠了',
    '右侧内容挤坏了',
    'The title is overlapping the preview.',
    '就这样做',
    '按刚才方案实现',
    '按这个做',
    '按这个方案写',
    '开始执行',
    '好，开始吧',
    '就照这个来',
    '按刚才说的做',
    '那就写',
    '就按这个写',
    '重新写',
    '我需要你重新写方案',
    '重做方案',
    '直接做',
    '直接写',
    '改一下',
    'sounds good, go ahead',
    'Go ahead',
  ])('routes %s to clarify when it is not an explicit execution command', (instruction) => {
    expect(routeBuilderComposerIntent(instruction)).toBe('clarify');
  });

  it.each([
    '我想做一个登录页',
    '我想创建一个带任务列表的项目看板',
    '我要做一个登录页',
    '我们要做一个 3D 网页',
    '我们希望做一个 3D 网页',
    '我需要一个仪表盘页面',
    'I want to create a login page.',
    'We would like to build a dashboard.',
    'I am thinking about building a portfolio site.',
  ])('routes %s to update_brief instead of starting a build', (instruction) => {
    expect(routeBuilderComposerIntent(instruction)).toBe('update_brief');
  });

  it.each([
    '保存这个方向，后面按这个来：目标用户是小团队',
    '记住这个需求：先做桌面端',
    '把这个方案作为当前 brief',
    '后面按这个方向来',
    'Save this as the current brief.',
    'Use this as the requirements.',
  ])('routes explicit brief request %s to update_brief', (instruction) => {
    expect(routeBuilderComposerIntent(instruction)).toBe('update_brief');
    expect(isBuilderComposerExplicitBriefIntent(instruction)).toBe(true);
  });

  it.each([
    '进入目标模式，一直帮我改到完成为止',
    '给你一个目标：持续完善这个项目直到完成或阻塞',
    '设定一个长期目标，自己执行验证直到 done',
    'Keep working on this goal until it is done or blocked.',
    'Set a goal and continue working until completed.',
  ])('keeps future Goal mode request %s on a read-only clarification route', (instruction) => {
    expect(decideBuilderComposerIntent(instruction, {
      hasPriorBuildContext: true,
      hasWorkspace: true,
      hasWritePermission: true,
    })).toMatchObject({
      route: 'clarify',
      confidence: 'high',
      matchedSignals: ['goal_mode_request'],
      downgradedFrom: null,
      downgradeReason: null,
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'reply',
    });
  });

  it.each([
    '先规划一下这个项目',
    '先做个方案',
    '帮我先做下方案',
    '请先不要写代码，列步骤',
    '先给我一个方案',
    '制定方案',
    'Plan this first.',
    'Give me a plan for this page.',
    'Plan first',
    'Make a plan for this page',
  ])('routes %s to plan intent without using the automatic build path', (instruction) => {
    expect(routeBuilderComposerIntent(instruction)).toBe('plan');
  });

  it.each([
    '帮我做一个网页3D',
    '创建登录页',
    '修改按钮颜色',
    '把按钮颜色改红',
    '标题换成欢迎回来',
    '加个保存按钮',
    '删掉页脚',
    '把背景设为浅色',
    '把按钮放大一点',
    '把导航移到右边',
    '优化这个页面',
    '帮我优化一下这个页面',
    '重构这个设置页',
    '实现功能',
    'Make a timer.',
    'Improve this dashboard.',
    'Make it responsive.',
    'Build a compact local project dashboard.',
    'Add a pause button.',
    'Fix the preview layout.',
  ])('routes %s to build when the edit intent is clear', (instruction) => {
    expect(routeBuilderComposerIntent(instruction)).toBe('build');
  });

  it.each([
    '就这样做',
    '按刚才方案实现',
    '按这个做',
    '按这个方案写',
    '开始执行',
    '好，开始吧',
    '就照这个来',
    '按刚才说的做',
    '那就写',
    '就按这个写',
    '重新写',
    '我需要你重新写方案',
    '重做方案',
    '直接做',
    '直接写',
    '改一下',
    'sounds good, go ahead',
    'yes, implement it',
    'Go ahead',
    "Let's do it",
    '这里字都重叠了',
    '右侧内容挤坏了',
    'The title is overlapping the preview.',
  ])('routes %s to build only when prior build context exists', (instruction) => {
    expect(routeBuilderComposerIntent(instruction, { hasPriorBuildContext: true })).toBe('build');
  });

  it('keeps casual greetings in chat even when prior build context exists', () => {
    expect(routeBuilderComposerIntent('hi', { hasPriorBuildContext: true })).toBe('answer');
  });

  it('keeps explicit plan selection outside the automatic chat/build route', () => {
    expect(routeBuilderComposerIntent('先规划一下这个项目')).toBe('plan');
  });

  it('routes natural-language plan requests to plan without write admission', () => {
    expect(decideBuilderComposerIntent('帮我先做下方案', {
      hasWorkspace: true,
      hasWritePermission: true,
    })).toMatchObject({
      route: 'plan',
      confidence: 'high',
      matchedSignals: ['explicit_plan'],
      downgradedFrom: null,
      downgradeReason: null,
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'plan',
    });
  });

  it('lets active Plan mode force the next non-empty message into the plan route', () => {
    expect(decideBuilderComposerIntent('创建登录页', {
      composerMode: 'plan',
      hasWorkspace: true,
      hasWritePermission: true,
    })).toMatchObject({
      route: 'plan',
      confidence: 'high',
      matchedSignals: ['composer_mode_plan'],
      downgradeReason: null,
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'plan',
    });
  });

  it('records explicit brief requests without write admission', () => {
    expect(decideBuilderComposerIntent('保存这个方向，后面按这个来：目标用户是小团队', {
      hasWorkspace: true,
      hasWritePermission: true,
    })).toMatchObject({
      route: 'update_brief',
      confidence: 'high',
      matchedSignals: ['explicit_brief'],
      downgradedFrom: null,
      downgradeReason: null,
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'brief_update',
    });
  });

  it('detects only contextual execution phrases for pending-plan approval shortcuts', () => {
    expect(isBuilderComposerContextualBuildIntent('按这个做')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('就按刚才方案实现')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('按这个方案写')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('好，开始吧')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('按刚才说的做')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('那就写')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('我需要你重新写方案')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('直接做')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('改一下')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('sounds good, go ahead')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('Go ahead')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('这个方案是什么')).toBe(false);
    expect(isBuilderComposerContextualBuildIntent('帮我做一个网页3D')).toBe(false);
    expect(isBuilderComposerContextualBuildIntent('')).toBe(false);
  });

  it('emits read-only route decisions for greetings even in a ready workspace', () => {
    expect(decideBuilderComposerIntent('hi', {
      hasPriorBuildContext: true,
      hasWorkspace: true,
    })).toMatchObject({
      decisionVersion: 'builder-composer-route-decision.v1',
      route: 'answer',
      confidence: 'high',
      matchedSignals: ['read_only'],
      downgradedFrom: null,
      downgradeReason: null,
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'reply',
    });
  });

  it('creates inspectable route decision evidence without changing route classification', () => {
    const decision = decideBuilderComposerIntent('创建登录页', { hasWorkspace: true });
    const evidence = createBuilderComposerRouteDecisionEvidence(decision, {
      decisionId: 'builder-composer-route-decision:local:1',
      messageId: 'builder-composer-message:local:1',
      projectId: 'builder-project:123e4567-e89b-42d3-a456-426614174001',
      taskId: null,
      createdAt: '2026-07-31T02:30:00.000Z',
    });

    expect(evidence).toEqual({
      ...decision,
      decisionId: 'builder-composer-route-decision:local:1',
      messageId: 'builder-composer-message:local:1',
      projectId: 'builder-project:123e4567-e89b-42d3-a456-426614174001',
      taskId: null,
      createdAt: '2026-07-31T02:30:00.000Z',
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(evidence.matchedSignals).toEqual(['clear_build']);
    expect(evidence.dispatch).toBe('build');
  });

  it('records contextual execution downgrades before a brief or plan exists', () => {
    expect(decideBuilderComposerIntent('按刚才方案做', { hasWorkspace: true })).toMatchObject({
      route: 'clarify',
      confidence: 'medium',
      matchedSignals: ['contextual_build_phrase'],
      downgradedFrom: 'build',
      downgradeReason: 'missing_prior_build_context',
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'reply',
    });
  });

  it('separates build intent from workspace admission', () => {
    expect(decideBuilderComposerIntent('创建登录页')).toMatchObject({
      route: 'build',
      confidence: 'high',
      matchedSignals: ['clear_build'],
      downgradeReason: 'workspace_required',
      requiredPermissions: ['write_project'],
      permissionResult: 'ask',
      dispatch: 'ask_workspace',
    });
    expect(decideBuilderComposerIntent('创建登录页', { hasWorkspace: true })).toMatchObject({
      route: 'build',
      confidence: 'high',
      downgradeReason: null,
      requiredPermissions: ['write_project'],
      permissionResult: 'allowed',
      dispatch: 'build',
    });
    expect(decideBuilderComposerIntent('创建登录页', {
      hasWorkspace: true,
      hasWritePermission: false,
    })).toMatchObject({
      route: 'build',
      confidence: 'high',
      downgradeReason: null,
      requiredPermissions: ['write_project'],
      permissionResult: 'ask',
      dispatch: 'ask_permission',
    });
  });

  it('lets approval mode block build side effects without changing the user intent', () => {
    expect(decideBuilderComposerIntent('创建登录页', {
      approvalMode: 'read_only_chat',
      hasWorkspace: true,
      hasWritePermission: true,
    })).toMatchObject({
      route: 'build',
      confidence: 'high',
      matchedSignals: ['clear_build'],
      downgradeReason: null,
      requiredPermissions: ['write_project'],
      permissionResult: 'denied',
      dispatch: 'blocked',
    });
  });

  it('admits contextual execution only when prior build context and workspace are both present', () => {
    expect(decideBuilderComposerIntent('好，开始吧', {
      hasPriorBuildContext: true,
      hasWorkspace: false,
    })).toMatchObject({
      route: 'build',
      matchedSignals: ['contextual_build_phrase'],
      downgradeReason: 'workspace_required',
      permissionResult: 'ask',
      dispatch: 'ask_workspace',
    });
    expect(decideBuilderComposerIntent('好，开始吧', {
      hasPriorBuildContext: true,
      hasWorkspace: true,
    })).toMatchObject({
      route: 'build',
      matchedSignals: ['contextual_build_phrase'],
      downgradeReason: null,
      permissionResult: 'allowed',
      dispatch: 'build',
    });
  });

  it('routes current-result Chinese writing follow-ups into contextual build execution', () => {
    expect(decideBuilderComposerIntent('我需要你重新写方案', {
      hasPriorBuildContext: true,
      hasWorkspace: true,
      hasWritePermission: true,
    })).toMatchObject({
      route: 'build',
      confidence: 'high',
      matchedSignals: ['contextual_build_phrase'],
      downgradeReason: null,
      permissionResult: 'allowed',
      dispatch: 'build',
    });
    expect(decideBuilderComposerIntent('那就写', {
      hasPriorBuildContext: true,
      hasWorkspace: true,
      hasWritePermission: false,
    })).toMatchObject({
      route: 'build',
      confidence: 'high',
      matchedSignals: ['contextual_build_phrase'],
      downgradeReason: null,
      permissionResult: 'ask',
      dispatch: 'ask_permission',
    });
    expect(decideBuilderComposerIntent('按这个方案写', {
      hasPriorBuildContext: true,
      hasWorkspace: true,
    })).toMatchObject({
      route: 'build',
      confidence: 'high',
      matchedSignals: ['contextual_build_phrase'],
      downgradeReason: null,
      permissionResult: 'allowed',
      dispatch: 'build',
    });
  });
});
