import { describe, expect, it } from 'vitest';

import { routeBuilderComposerIntent } from './builderComposerIntent';

describe('routeBuilderComposerIntent', () => {
  it.each([
    'hi',
    '你好',
    '在吗',
    '你现在在做什么',
    '这个项目是什么',
    '为什么预览空白',
    'What does this project do?',
    'Can this look better?',
    '能不能更好看一点',
    '',
  ])('routes %s to answer by default', (instruction) => {
    expect(routeBuilderComposerIntent(instruction)).toBe('answer');
  });

  it.each([
    '帮我做一个网页3D',
    '创建登录页',
    '修改按钮颜色',
    '实现功能',
    'Make a timer.',
    'Build a compact local project dashboard.',
    'Add a pause button.',
    'Fix the preview layout.',
  ])('routes %s to build when the edit intent is clear', (instruction) => {
    expect(routeBuilderComposerIntent(instruction)).toBe('build');
  });

  it('keeps explicit plan selection outside the automatic chat/build route', () => {
    expect(routeBuilderComposerIntent('先规划一下这个项目')).toBe('answer');
  });
});
