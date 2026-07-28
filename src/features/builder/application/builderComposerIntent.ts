export type BuilderComposerIntentRoute = 'answer' | 'build';

const READ_ONLY_PATTERNS = Object.freeze([
  /^(?:hi|hello|hey|你好|您好|在吗|你在吗|在不在)[.!?。！？]*$/u,
  /^(?:你现在在做什么|现在在做什么|你在做什么)[?？。!！]*$/u,
  /(?:是什么|为什么|为何|怎么回事|什么原因|解释一下|说明一下|介绍一下|当前状态|现在在做什么)/u,
  /^(?:what|why|how|when|where|who|which)\b/u,
  /\b(?:explain|describe|tell me|status|what's|whats)\b/u,
]);

const CLEAR_BUILD_PATTERNS = Object.freeze([
  /(?:帮我|请|麻烦).*(?:做|创建|生成|实现|修改|更改|改成|改为|新增|添加|删除|移除|修复|调整|优化|重构|开发|搭建|写)/u,
  /(?:做一个|做个|创建|生成|实现|修改|更改|改成|改为|新增|添加|删除|移除|修复|调整|优化|重构|开发|搭建|写一个|写个|完成)/u,
  /\b(?:build|create|generate|implement|modify|update|add|remove|delete|fix|refactor|redesign)\b/u,
  /\bchange\b/u,
  /\bmake\s+(?:me\s+)?(?:a|an|the)\s+[\w-]+/u,
  /\bmake\s+(?:this|it|the)\s+(?:button|page|site|app|layout|screen|form|dashboard|preview)\b/u,
]);

function normalizeComposerInstruction(instruction: string): string {
  return instruction
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ');
}

export function routeBuilderComposerIntent(instruction: string): BuilderComposerIntentRoute {
  const normalized = normalizeComposerInstruction(instruction);
  if (normalized.length === 0) return 'answer';
  if (READ_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) return 'answer';
  if (CLEAR_BUILD_PATTERNS.some((pattern) => pattern.test(normalized))) return 'build';
  return 'answer';
}
