import { describe, expect, it } from 'vitest';

import {
  isBuilderComposerContextualBuildIntent,
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
    '怎么把按钮改红？',
    '解释一下为什么标题变大了',
    'What does this project do?',
    'Can this look better?',
    '能不能更好看一点',
    '帮我优化一下',
    '优化一下',
    '请调整一下',
    '重构一下',
    'Make it better',
    '就这样做',
    '按刚才方案实现',
    '按这个做',
    '开始执行',
    '好，开始吧',
    '就照这个来',
    '按刚才说的做',
    'sounds good, go ahead',
    'Go ahead',
    '',
  ])('routes %s to answer by default', (instruction) => {
    expect(routeBuilderComposerIntent(instruction)).toBe('answer');
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
    '开始执行',
    '好，开始吧',
    '就照这个来',
    '按刚才说的做',
    'sounds good, go ahead',
    'yes, implement it',
    'Go ahead',
    "Let's do it",
  ])('routes %s to build only when prior build context exists', (instruction) => {
    expect(routeBuilderComposerIntent(instruction, { hasPriorBuildContext: true })).toBe('build');
  });

  it('keeps casual greetings in chat even when prior build context exists', () => {
    expect(routeBuilderComposerIntent('hi', { hasPriorBuildContext: true })).toBe('answer');
  });

  it('keeps explicit plan selection outside the automatic chat/build route', () => {
    expect(routeBuilderComposerIntent('先规划一下这个项目')).toBe('answer');
  });

  it('detects only contextual execution phrases for pending-plan approval shortcuts', () => {
    expect(isBuilderComposerContextualBuildIntent('按这个做')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('就按刚才方案实现')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('好，开始吧')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('按刚才说的做')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('sounds good, go ahead')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('Go ahead')).toBe(true);
    expect(isBuilderComposerContextualBuildIntent('这个方案是什么')).toBe(false);
    expect(isBuilderComposerContextualBuildIntent('帮我做一个网页3D')).toBe(false);
    expect(isBuilderComposerContextualBuildIntent('')).toBe(false);
  });
});
