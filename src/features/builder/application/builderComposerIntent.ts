export type BuilderComposerIntentRoute = 'answer' | 'build';

export type BuilderComposerIntentContext = Readonly<{
  hasPriorBuildContext?: boolean;
}>;

const READ_ONLY_PATTERNS = Object.freeze([
  /^(?:hi|hello|hey|你好|您好|在吗|你在吗|在不在)[.!?。！？]*$/u,
  /^(?:你现在在做什么|现在在做什么|你在做什么)[?？。!！]*$/u,
  /(?:是什么|为什么|为何|怎么|如何|怎么回事|什么原因|解释一下|说明一下|介绍一下|当前状态|现在在做什么)/u,
  /^(?:what|why|how|when|where|who|which)\b/u,
  /\b(?:explain|describe|tell me|status|what's|whats)\b/u,
]);

const VAGUE_CHANGE_PATTERNS = Object.freeze([
  /^(?:(?:你能|可以|能不能)?(?:帮我|请|麻烦)?\s*)?(?:优化|调整|修改|改进|完善|美化|重构)(?:一下|下|点|一点|看看)?[?？。.!！]*$/u,
  /^(?:make|improve)\s+(?:it|this|that)\s+(?:better|nicer|cleaner|prettier|more polished)[.?!]*$/u,
]);

const CONTEXTUAL_BUILD_PATTERNS = Object.freeze([
  /^(?:就这样(?:做|实现|执行|开始)?|就按(?:这个(?:方案|计划)?|刚才(?:的)?(?:方案|计划)?|上面(?:的)?(?:方案|计划)?|前面(?:的)?(?:方案|计划)?)(?:做|实现|执行)?|按(?:这个(?:方案|计划)?|刚才(?:的)?(?:方案|计划)?|上面(?:的)?(?:方案|计划)?|前面(?:的)?(?:方案|计划)?)(?:做|实现|执行)|开始(?:做|实现|执行)|可以开始了)[。.!！]*$/u,
  /^(?:do it|go ahead|start|let'?s do it|implement that|build that|make that)[.?!]*$/u,
]);

const CLEAR_BUILD_PATTERNS = Object.freeze([
  /(?:帮我|请|麻烦).*(?:做|创建|生成|实现|修改|更改|改成|改为|换成|换为|替换|设为|设置|新增|添加|加个|加一个|删除|删掉|去掉|移除|修复|调整|调成|调为|放大|缩小|移动|移到|优化|重构|开发|搭建|写)/u,
  /(?:把|将).*(?:改|换|替换|设为|设置|新增|添加|加个|加一个|删除|删掉|去掉|移除|修复|调整|调成|调为|放大|缩小|移动|移到)/u,
  /(?:做一个|做个|创建|生成|实现|修改|更改|改成|改为|换成|换为|替换|设为|设置|新增|添加|加个|加一个|删除|删掉|去掉|移除|修复|调整|调成|调为|放大|缩小|移动|移到|优化|重构|开发|搭建|写一个|写个|完成)/u,
  /\bimprove\s+(?:this|that|the|my|our)\s+(?:app|button|component|dashboard|form|layout|page|project|screen|site|tool|view|website)\b/u,
  /\b(?:build|create|generate|implement|modify|update|add|remove|delete|fix|refactor|redesign)\b/u,
  /\bchange\b/u,
  /\bmake\s+(?:me\s+)?(?:a|an|the)\s+[\w-]+/u,
  /\bmake\s+(?:this|it|the)\s+(?:button|page|site|app|layout|screen|form|dashboard|preview)\b/u,
  /\bmake\s+(?:this|it)\s+responsive\b/u,
]);

function normalizeComposerInstruction(instruction: string): string {
  return instruction
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ');
}

export function isBuilderComposerContextualBuildIntent(instruction: string): boolean {
  const normalized = normalizeComposerInstruction(instruction);
  if (normalized.length === 0) return false;
  return CONTEXTUAL_BUILD_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function routeBuilderComposerIntent(
  instruction: string,
  context: BuilderComposerIntentContext = {},
): BuilderComposerIntentRoute {
  const normalized = normalizeComposerInstruction(instruction);
  if (normalized.length === 0) return 'answer';
  if (READ_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) return 'answer';
  if (VAGUE_CHANGE_PATTERNS.some((pattern) => pattern.test(normalized))) return 'answer';
  if (isBuilderComposerContextualBuildIntent(normalized)) {
    return context.hasPriorBuildContext === true ? 'build' : 'answer';
  }
  if (CLEAR_BUILD_PATTERNS.some((pattern) => pattern.test(normalized))) return 'build';
  return 'answer';
}
