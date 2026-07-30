export type BuilderComposerIntentRoute = 'answer' | 'clarify' | 'update_brief' | 'plan' | 'build';

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
  /^(?:能不能|可以不可以|可不可以)(?:更|再)?好看(?:一点|点)?[?？。.!！]*$/u,
  /^(?:can|could)\s+(?:this|it|that)\s+look\s+better[.?!]*$/u,
  /^(?:make|improve)\s+(?:it|this|that)\s+(?:better|nicer|cleaner|prettier|more polished)[.?!]*$/u,
]);

const EXPLICIT_PLAN_PATTERNS = Object.freeze([
  /^(?:先)?(?:规划|计划|制定方案|出个方案|做个方案|做一个方案|先规划一下|先计划一下|先做方案|先出方案)/u,
  /^(?:plan first|make a plan|propose a plan|draft a plan|let'?s plan|let us plan)\b/u,
]);

const WORK_DISCUSSION_PATTERNS = Object.freeze([
  /(?:先聊|先讨论|先确定|讨论一下|聊一下|确认一下|想先聊|我们先确定|先看看|你觉得|你建议|怎么样|如何设计|怎么设计|怎么做|方案如何|风格怎么|需求怎么)/u,
  /\b(?:discuss|brainstorm|figure out|talk through|what do you think|how should|how would|should we|could we|can we|requirements|style direction)\b/u,
]);

const CAPABILITY_QUESTION_PATTERNS = Object.freeze([
  /^(?:你)?(?:可以|能不能|能否|可不可以|可以不可以)(?:先)?(?:帮我|给我|为我)?[^?？。!！]*(?:做|创建|生成|实现|设计|开发|搭建|修改|优化|重构|写|编写|添加|新增|删除|修复)[^?？。!！]*[?？吗么]\s*$/u,
  /^(?:can|could|would)\s+you\s+(?:help\s+me\s+)?(?:build|create|make|implement|design|develop|add|change|modify|update|fix|write)\b.*\?\s*$/u,
]);

const EXPLORATORY_WORK_PATTERNS = Object.freeze([
  /^(?:(?:我|我们)?(?:想|想要|要|希望|需要|打算|准备|计划|考虑))[^?？]*(?:做|创建|生成|实现|设计|开发|搭建|页面|网页|网站|应用|功能|布局|组件|登录页|仪表盘|看板|3d|ui)/u,
  /^(?:i|we)\s+(?:want|would like|need|hope|plan|intend)\s+to\s+(?:build|create|make|implement|design|develop|add|change|modify|update)\b/u,
  /^(?:i|we)\s+(?:am|are|'m|'re)\s+(?:thinking|considering|planning)\s+(?:about\s+)?(?:building|creating|making|implementing|designing)\b/u,
]);

const CONTEXTUAL_BUILD_PATTERNS = Object.freeze([
  /^(?:就这样(?:做|实现|执行|开始)?|就按(?:这个(?:方案|计划)?|刚才(?:的)?(?:方案|计划)?|上面(?:的)?(?:方案|计划)?|前面(?:的)?(?:方案|计划)?)(?:做|实现|执行)?|按(?:这个(?:方案|计划)?|刚才(?:的)?(?:方案|计划)?|上面(?:的)?(?:方案|计划)?|前面(?:的)?(?:方案|计划)?)(?:做|实现|执行)|开始(?:做|实现|执行)|可以开始了)[。.!！]*$/u,
  /^(?:(?:好|好的|可以|行|嗯)[，,\s]*)?(?:(?:就)?(?:照|按)(?:这个|刚才(?:说的|聊的|讨论的|确认的)?|上面(?:说的)?|前面(?:说的)?|我们刚才(?:说的|聊的|讨论的|确认的)?)(?:方案|计划)?(?:做|实现|执行|来)|(?:开始|执行)(?:吧|了)?|可以开始(?:了|吧)?)[。.!！]*$/u,
  /^(?:do it|go ahead|start|let'?s do it|implement that|build that|make that)[.?!]*$/u,
  /^(?:(?:ok|okay|yes|sounds good|great)[,\s]*)?(?:go ahead|start(?: building| implementing)?|implement (?:it|this|that|the plan)|build (?:it|this|that)|do it|let'?s do it|make that)[.?!]*$/u,
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
  if (WORK_DISCUSSION_PATTERNS.some((pattern) => pattern.test(normalized))) return 'clarify';
  if (CAPABILITY_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))) return 'clarify';
  if (READ_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) return 'answer';
  if (EXPLICIT_PLAN_PATTERNS.some((pattern) => pattern.test(normalized))) return 'plan';
  if (VAGUE_CHANGE_PATTERNS.some((pattern) => pattern.test(normalized))) return 'clarify';
  if (isBuilderComposerContextualBuildIntent(normalized)) {
    return context.hasPriorBuildContext === true ? 'build' : 'clarify';
  }
  if (EXPLORATORY_WORK_PATTERNS.some((pattern) => pattern.test(normalized))) return 'update_brief';
  if (CLEAR_BUILD_PATTERNS.some((pattern) => pattern.test(normalized))) return 'build';
  return 'answer';
}
