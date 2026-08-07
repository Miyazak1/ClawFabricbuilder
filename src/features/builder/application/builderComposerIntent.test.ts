import { describe, expect, it } from 'vitest';

import routeDecisionCases from '../../../test/builderRouteDecisionCases.json';
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
    '等等，先不要按这个做，我要重新整理方向。',
    '先别按这个方案做，方向我要再确认一下',
    'Scratch that, do not implement that plan yet.',
  ])('routes brief correction %s to update_brief without build admission', (instruction) => {
    expect(decideBuilderComposerIntent(instruction, {
      hasPriorBuildContext: true,
      hasWorkspace: true,
      hasWritePermission: true,
    })).toMatchObject({
      route: 'update_brief',
      confidence: 'high',
      matchedSignals: ['brief_correction'],
      downgradedFrom: null,
      downgradeReason: null,
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'brief_update',
    });
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
    '先帮我梳理一下实现步骤',
    '请先整理这个页面方案',
    '拆解下项目思路',
    '先分析一下实现方案',
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
    '新建一个 README.md，写项目说明',
    '创建一个 md 文档保存到本地，内容是会议纪要',
    'Write a Markdown notes file for this project.',
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
    expect(decideBuilderComposerIntent('先帮我梳理一下实现步骤', {
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

  it('routes active-run cancel requests without write admission', () => {
    expect(decideBuilderComposerIntent('停止', {
      activeRunCanQueueFollowup: true,
      activeRunStatus: 'working',
      hasPriorBuildContext: true,
      hasWorkspace: true,
      hasWritePermission: true,
    })).toMatchObject({
      route: 'cancel',
      confidence: 'high',
      matchedSignals: ['active_run_cancel'],
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'cancel',
      activeRunInput: 'cancel_requested',
    });
  });

  it('queues active-run input by default instead of steering or building immediately', () => {
    expect(decideBuilderComposerIntent('Change the main heading to My Notes.', {
      activeRunCanQueueFollowup: true,
      activeRunStatus: 'answering',
      hasPriorBuildContext: true,
      hasWorkspace: true,
      hasWritePermission: true,
    })).toMatchObject({
      route: 'queue_followup',
      confidence: 'medium',
      matchedSignals: ['active_run_followup'],
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'queue_followup',
      activeRunInput: 'queued_followup',
    });
  });

  it('admits active-run steering only when an explicit steering gate allows it', () => {
    expect(decideBuilderComposerIntent('Actually use the compact header instead.', {
      activeRunCanQueueFollowup: true,
      activeRunCanSteer: true,
      activeRunStatus: 'working',
      hasWorkspace: true,
    })).toMatchObject({
      route: 'steer',
      confidence: 'medium',
      matchedSignals: ['active_run_steer'],
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'steer',
      activeRunInput: 'steer_admitted',
    });
  });

  it('downgrades active-run input when follow-up queueing is unavailable', () => {
    expect(decideBuilderComposerIntent('那就写', {
      activeRunCanQueueFollowup: false,
      activeRunStatus: 'answering',
      hasPriorBuildContext: true,
      hasWorkspace: true,
    })).toMatchObject({
      route: 'clarify',
      confidence: 'medium',
      matchedSignals: ['active_run_unsupported'],
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'reply',
      activeRunInput: 'unsupported',
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

  it.each(routeDecisionCases.cases)('matches the shared route fixture: $name', (routeCase) => {
    expect(routeDecisionCases.caseVersion).toBe('builder-route-decision-cases.v1');

    const decision = decideBuilderComposerIntent(routeCase.instruction, routeCase.context);

    expect(decision).toMatchObject({
      route: routeCase.renderer.route,
      dispatch: routeCase.renderer.dispatch,
      matchedSignals: routeCase.renderer.matchedSignals,
      requiredPermissions: routeCase.renderer.requiredPermissions,
      permissionResult: routeCase.renderer.permissionResult,
    });
    expect(decision.downgradedFrom).toBe(routeCase.renderer.downgradedFrom ?? null);
    expect(decision.downgradeReason).toBe(routeCase.renderer.downgradeReason ?? null);
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

  it('uses short confirmations only when an assistant execution proposal is pending', () => {
    expect(decideBuilderComposerIntent('要', {
      hasPriorBuildContext: true,
      hasWorkspace: true,
      hasWritePermission: true,
    })).toMatchObject({
      route: 'answer',
      matchedSignals: ['chat_default'],
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'reply',
    });
    expect(decideBuilderComposerIntent('要', {
      hasPendingBuildConfirmation: true,
      hasPriorBuildContext: true,
      hasWorkspace: true,
      hasWritePermission: false,
    })).toMatchObject({
      route: 'build',
      confidence: 'high',
      matchedSignals: ['pending_build_confirmation'],
      requiredPermissions: ['write_project'],
      permissionResult: 'ask',
      dispatch: 'ask_permission',
    });
  });

  it('admits concise current-artifact direct changes only with prior build context', () => {
    expect(decideBuilderComposerIntent('改下颜色', { hasWorkspace: true })).toMatchObject({
      route: 'clarify',
      confidence: 'medium',
      matchedSignals: ['current_artifact_direct_change'],
      downgradedFrom: 'build',
      downgradeReason: 'missing_prior_build_context',
      requiredPermissions: [],
      permissionResult: 'not_required',
      dispatch: 'reply',
    });
    expect(decideBuilderComposerIntent('改下颜色', {
      hasPriorBuildContext: true,
      hasWorkspace: true,
      hasWritePermission: true,
    })).toMatchObject({
      route: 'build',
      confidence: 'high',
      matchedSignals: ['current_artifact_direct_change'],
      downgradedFrom: null,
      downgradeReason: null,
      requiredPermissions: ['write_project'],
      permissionResult: 'allowed',
      dispatch: 'build',
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

  it('routes local Markdown artifact writes through project-bound build admission', () => {
    expect(decideBuilderComposerIntent('新建一个 README.md，写项目说明')).toMatchObject({
      route: 'build',
      confidence: 'high',
      matchedSignals: ['local_file_artifact'],
      downgradeReason: 'workspace_required',
      requiredPermissions: ['write_project'],
      permissionResult: 'ask',
      dispatch: 'ask_workspace',
    });
    expect(decideBuilderComposerIntent('创建一个 md 文档保存到本地，内容是会议纪要', {
      hasWorkspace: true,
      hasWritePermission: false,
    })).toMatchObject({
      route: 'build',
      confidence: 'high',
      matchedSignals: ['local_file_artifact'],
      downgradeReason: null,
      requiredPermissions: ['write_project'],
      permissionResult: 'ask',
      dispatch: 'ask_permission',
    });
    expect(decideBuilderComposerIntent('Write a Markdown notes file for this project.', {
      hasWorkspace: true,
      hasWritePermission: true,
    })).toMatchObject({
      route: 'build',
      confidence: 'high',
      matchedSignals: ['local_file_artifact'],
      downgradeReason: null,
      requiredPermissions: ['write_project'],
      permissionResult: 'allowed',
      dispatch: 'build',
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
