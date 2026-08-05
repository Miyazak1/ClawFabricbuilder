export type BuilderComposerIntentRoute =
  | 'answer'
  | 'clarify'
  | 'update_brief'
  | 'plan'
  | 'steer'
  | 'queue_followup'
  | 'cancel'
  | 'build';

export type BuilderComposerIntentConfidence = 'low' | 'medium' | 'high';

export type BuilderComposerIntentDispatch =
  | 'reply'
  | 'brief_update'
  | 'plan'
  | 'steer'
  | 'queue_followup'
  | 'cancel'
  | 'build'
  | 'ask_workspace'
  | 'ask_permission'
  | 'blocked';

export type BuilderComposerIntentPermissionResult =
  | 'not_required'
  | 'allowed'
  | 'ask'
  | 'denied';

export type BuilderComposerIntentDowngradeReason =
  | 'ambiguous_build_intent'
  | 'missing_prior_build_context'
  | 'workspace_required'
  | null;

export type BuilderComposerApprovalMode =
  | 'read_only_chat'
  | 'ask_before_write'
  | 'allow_current_project';

export type BuilderComposerActiveRunInput =
  | 'not_active'
  | 'cancel_requested'
  | 'steer_admitted'
  | 'queued_followup'
  | 'unsupported';

export type BuilderComposerIntentContext = Readonly<{
  activeRunCanQueueFollowup?: boolean;
  activeRunCanSteer?: boolean;
  activeRunStatus?: 'not_active' | 'answering' | 'working';
  approvalMode?: BuilderComposerApprovalMode;
  composerMode?: 'plan' | null;
  hasPendingBuildConfirmation?: boolean;
  hasPriorBuildContext?: boolean;
  hasWorkspace?: boolean;
  hasWritePermission?: boolean;
}>;

export type BuilderComposerRouteDecision = Readonly<{
  decisionVersion: 'builder-composer-route-decision.v1';
  route: BuilderComposerIntentRoute;
  confidence: BuilderComposerIntentConfidence;
  matchedSignals: readonly string[];
  downgradedFrom: BuilderComposerIntentRoute | null;
  downgradeReason: BuilderComposerIntentDowngradeReason;
  requiredPermissions: readonly string[];
  permissionResult: BuilderComposerIntentPermissionResult;
  dispatch: BuilderComposerIntentDispatch;
  activeRunInput: BuilderComposerActiveRunInput;
}>;

export type BuilderComposerRouteDecisionEvidence = Readonly<BuilderComposerRouteDecision & {
  decisionId: string;
  messageId: string;
  projectId: string | null;
  taskId: string | null;
  createdAt: string;
}>;

export type BuilderComposerRouteDecisionEvidenceInput = Readonly<{
  decisionId: string;
  messageId: string;
  projectId: string | null;
  taskId: string | null;
  createdAt: string;
}>;

const READ_ONLY_PATTERNS = Object.freeze([
  /^(?:hi|hello|hey|你好|您好|在吗|你在吗|在不在)[.!?。！？]*$/u,
  /^(?:你现在在做什么|现在在做什么|你在做什么)[?？。!！]*$/u,
  /(?:是什么|为什么|为何|怎么|如何|怎么回事|什么原因|解释一下|说明一下|介绍一下|当前状态|现在在做什么)/u,
  /^(?:what|why|how|when|where|who|which)\b/u,
  /\b(?:explain|describe|tell me|status|what's|whats)\b/u,
]);

const ACTIVE_RUN_CANCEL_PATTERNS = Object.freeze([
  /^(?:停止|取消|别做了|不要做了|先停|停一下|停下|暂停|中止|打断)[。.!！]*$/u,
  /^(?:stop|cancel|abort|interrupt|pause)[.?!]*$/u,
]);

const ACTIVE_RUN_STEER_PATTERNS = Object.freeze([
  /^(?:等一下|等等|补充一下|改成|改为|这里|这个|当前|别用|不要用|换成|加上|去掉|删掉|记得).*/u,
  /^(?:wait|hold on|actually|instead|use|don'?t use|make it|change it|add|remove)\b/u,
]);

const VAGUE_CHANGE_PATTERNS = Object.freeze([
  /^(?:(?:你能|可以|能不能)?(?:帮我|请|麻烦)?\s*)?(?:优化|调整|修改|改进|完善|美化|重构)(?:一下|下|点|一点|看看)?[?？。.!！]*$/u,
  /^(?:能不能|可以不可以|可不可以)(?:更|再)?好看(?:一点|点)?[?？。.!！]*$/u,
  /^(?:can|could)\s+(?:this|it|that)\s+look\s+better[.?!]*$/u,
  /^(?:make|improve)\s+(?:it|this|that)\s+(?:better|nicer|cleaner|prettier|more polished)[.?!]*$/u,
]);

const SHORT_BUILD_CONFIRMATION_PATTERNS = Object.freeze([
  /^(?:要|需要|可以|好|好的|行|嗯|嗯嗯|对|是的|确认|同意|改吧|做吧|写吧|开始吧|直接改|直接做|就这样|按这个来)[。.!！]*$/u,
  /^(?:yes|yep|yeah|ok|okay|sure|please do|do it|go ahead|sounds good|that works)[.?!]*$/u,
]);

const CURRENT_ARTIFACT_DEFECT_PATTERNS = Object.freeze([
  /(?:这里|这块|这个|当前|页面|界面|聊天框|预览|按钮|文字|字|内容|布局|右侧|左侧|顶部|底部|卡片|气泡).{0,24}(?:重叠|挡住|遮住|挤(?:在一起|成|坏|爆|压)?|溢出|错位|穿出|太窄|太宽|看不清|乱了|坏了|不对|不齐|不稳|出去了)/u,
  /(?:重叠|挡住|遮住|溢出|错位|穿出|挤坏|挤爆|看不清|布局乱了|版式坏了|样式坏了)/u,
  /\b(?:overlap|overlapping|overflow|misaligned|clipped|covered|covering|too narrow|too wide|layout is broken|looks broken|text is cut off)\b/u,
]);

const CURRENT_ARTIFACT_DIRECT_CHANGE_PATTERNS = Object.freeze([
  /^(?:(?:帮我|请|麻烦)?\s*)?(?:改|修改|调整|换|更换|优化|统一|更新)(?:一下|下)?(?:这个|当前|页面|界面|结果|稿子|版本)?(?:的)?(?:颜色|配色|主题色|色彩|背景|字体|字号|标题|按钮|卡片|间距|圆角|布局|样式)[。.!！]*$/u,
  /^(?:change|update|adjust|tweak|switch|improve)\s+(?:the\s+)?(?:color|colors|palette|theme|background|font|heading|button|card|spacing|radius|layout|style)s?[.?!]*$/u,
]);

const EXPLICIT_PLAN_PATTERNS = Object.freeze([
  /^(?:(?:帮我|请|麻烦)\s*)?(?:先)?(?:规划|计划|制定(?:一下)?方案|出(?:个|一个|下|一下)?方案|做(?:个|一个|下|一下)?方案|给(?:我|我们)?(?:出|做|写|列)?(?:个|一个)?方案|列(?:一下|下)?(?:步骤|计划|方案)|先不要写代码.{0,16}(?:方案|步骤|计划))/u,
  /^(?:plan first|plan this first|make a plan|propose a plan|draft a plan|give me a plan|outline the steps|don'?t write code yet|let'?s plan|let us plan)\b/u,
]);

const EXPLICIT_BRIEF_PATTERNS = Object.freeze([
  /^(?:保存|记住|记录|保留|沉淀)(?:一下|下)?(?:这个|当前|刚才(?:的)?|上面(?:的)?|前面(?:的)?|这次)?(?:方向|目标|需求|约束|方案|计划|想法|brief|上下文)?(?:[：:，,\s]|$).*/u,
  /^(?:把|将)(?:这个|当前|刚才(?:的)?|上面(?:的)?|前面(?:的)?|这段|这些|以上|上面的)?(?:方向|目标|需求|约束|方案|计划|想法|内容|上下文|brief)?(?:保存|记录|记住|作为|设为).*/u,
  /(?:后面|接下来|之后)(?:就)?(?:按|照)(?:这个|这个方向|这个方案|刚才(?:的)?|上面(?:的)?)(?:来|做|写|实现)?/u,
  /^(?:save|remember|record|keep)\s+(?:this|that|the current).*(?:brief|goal|requirement|direction|plan|context)?/u,
  /^(?:use|treat)\s+this\s+as\s+(?:the\s+)?(?:brief|current brief|goal|plan|requirements)\b/u,
]);

const BRIEF_CORRECTION_PATTERNS = Object.freeze([
  /^(?:等一下|等等|先等等|先别|先不要|不要|别).{0,64}(?:按|照|做|写|执行|实现|开始|这个|刚才|方案|计划|方向|目标|需求).*/u,
  /(?:撤回|推翻|作废|不要了|不算了|先不做|先别做|先不要做|别按|不要按|别照|不要照|重新整理|重新确认|换个方向|改方向)/u,
  /^(?:wait|hold on|actually|scratch that|not that|pause|do not|don'?t).{0,96}(?:brief|plan|direction|approach|that|it|execute|implement|build)/u,
]);

const GOAL_MODE_PATTERNS = Object.freeze([
  /(?:目标模式|goal\s*mode|persistent\s+goal|持续目标|长期目标)/u,
  /(?:设定|设置|创建|建立|给你|交给你).{0,24}(?:目标|goal).{0,48}(?:持续|一直|自动|连续|自己|直到|完成为止|做完|阻塞|blocked|done)/u,
  /(?:持续|一直|连续|自动|自己).{0,32}(?:工作|推进|执行|修改|实现|验证|修复).{0,48}(?:直到|到)(?:真正)?(?:完成|做好|做完|done|blocked|阻塞)/u,
  /(?:keep|continue)\s+(?:working|going|iterating|building|fixing|verifying)\b.{0,80}\b(?:until|till)\b.{0,40}\b(?:done|complete|completed|blocked)\b/u,
  /\b(?:set|create|start|give\s+you)\s+(?:a\s+)?goal\b.{0,80}\b(?:until|done|complete|completed|blocked)\b/u,
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

const LOCAL_FILE_ARTIFACT_PATTERNS = Object.freeze([
  /(?:创建|新建|生成|写|编写|保存|添加|新增).{0,40}(?:\.md\b|markdown|md\s*(?:文档|文件)|readme|说明文档|文档|文件|笔记|notes?)/u,
  /(?:create|write|generate|add|save).{0,48}(?:\.md\b|markdown|readme|notes?\s+file|document|text\s+file)/u,
]);

const CONTEXTUAL_BUILD_PATTERNS = Object.freeze([
  /^(?:就这样(?:写|做|改|实现|执行|开始)?|就按(?:这个(?:方案|计划)?|刚才(?:的)?(?:方案|计划)?|上面(?:的)?(?:方案|计划)?|前面(?:的)?(?:方案|计划)?)(?:写|做|改|实现|执行)?|按(?:这个(?:方案|计划)?|刚才(?:的)?(?:方案|计划)?|上面(?:的)?(?:方案|计划)?|前面(?:的)?(?:方案|计划)?)(?:写|做|改|实现|执行)|开始(?:写|做|改|实现|执行)|可以开始了)[。.!！]*$/u,
  /^(?:(?:好|好的|可以|行|嗯)[，,\s]*)?(?:(?:就)?(?:照|按)(?:这个|刚才(?:说的|聊的|讨论的|确认的)?|上面(?:说的)?|前面(?:说的)?|我们刚才(?:说的|聊的|讨论的|确认的)?)(?:方案|计划)?(?:写|做|改|实现|执行|来)|(?:开始|执行)(?:吧|了)?|可以开始(?:了|吧)?)[。.!！]*$/u,
  /^(?:(?:那|那就|就|好|好的|可以|行|嗯)[，,\s]*)?(?:直接)?(?:写|做|改)(?:一下|下|吧|了)?[。.!！]*$/u,
  /^(?:(?:我)?(?:需要|要)(?:你)?|请|麻烦|帮我)?\s*(?:重新|重)?(?:写|做|改)(?:一下|下)?(?:这个|当前|刚才(?:的)?|上面(?:的)?|前面(?:的)?|方案|计划|页面|网页|网站|应用|界面|结果|版本|稿子|草稿)?[。.!！]*$/u,
  /^(?:(?:我)?(?:需要|要)(?:你)?|请|麻烦|帮我)?\s*(?:重写|重做|重改|重新写|重新做|重新改)(?:一下|下)?(?:这个|当前|刚才(?:的)?|上面(?:的)?|前面(?:的)?|方案|计划|页面|网页|网站|应用|界面|结果|版本|稿子|草稿)?[。.!！]*$/u,
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

export function isBuilderComposerExplicitBriefIntent(instruction: string): boolean {
  const normalized = normalizeComposerInstruction(instruction);
  if (normalized.length === 0) return false;
  return EXPLICIT_BRIEF_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function routeBuilderComposerIntent(
  instruction: string,
  context: BuilderComposerIntentContext = {},
): BuilderComposerIntentRoute {
  return decideBuilderComposerIntent(instruction, context).route;
}

export function createBuilderComposerRouteDecisionEvidence(
  decision: BuilderComposerRouteDecision,
  evidence: BuilderComposerRouteDecisionEvidenceInput,
): BuilderComposerRouteDecisionEvidence {
  return Object.freeze({
    ...decision,
    decisionId: evidence.decisionId,
    messageId: evidence.messageId,
    projectId: evidence.projectId,
    taskId: evidence.taskId,
    createdAt: evidence.createdAt,
  });
}

function createDecision(
  route: BuilderComposerIntentRoute,
  context: BuilderComposerIntentContext,
  options: Readonly<{
    activeRunInput?: BuilderComposerActiveRunInput;
    confidence: BuilderComposerIntentConfidence;
    downgradedFrom?: BuilderComposerIntentRoute | null;
    downgradeReason?: BuilderComposerIntentDowngradeReason;
    matchedSignals: readonly string[];
  }>,
): BuilderComposerRouteDecision {
  const requiresWrite = route === 'build';
  const missingWorkspace = requiresWrite && context.hasWorkspace !== true;
  const deniedByApprovalMode = requiresWrite && context.approvalMode === 'read_only_chat';
  const permissionResult: BuilderComposerIntentPermissionResult = requiresWrite
    ? deniedByApprovalMode
      ? 'denied'
      : missingWorkspace || context.hasWritePermission === false
      ? 'ask'
      : 'allowed'
    : 'not_required';
  const dispatch: BuilderComposerIntentDispatch = (() => {
    if (requiresWrite && permissionResult === 'denied') return 'blocked';
    if (missingWorkspace) return 'ask_workspace';
    if (requiresWrite && permissionResult === 'ask') return 'ask_permission';
    if (route === 'build') return 'build';
    if (route === 'plan') return 'plan';
    if (route === 'steer') return 'steer';
    if (route === 'queue_followup') return 'queue_followup';
    if (route === 'cancel') return 'cancel';
    if (route === 'update_brief') return 'brief_update';
    return 'reply';
  })();
  return Object.freeze({
    decisionVersion: 'builder-composer-route-decision.v1',
    route,
    confidence: options.confidence,
    matchedSignals: Object.freeze([...options.matchedSignals]),
    downgradedFrom: options.downgradedFrom ?? null,
    downgradeReason: missingWorkspace
      ? 'workspace_required'
      : options.downgradeReason ?? null,
    requiredPermissions: Object.freeze(requiresWrite ? ['write_project'] : []),
    permissionResult,
    dispatch,
    activeRunInput: options.activeRunInput ?? 'not_active',
  });
}

export function decideBuilderComposerIntent(
  instruction: string,
  context: BuilderComposerIntentContext = {},
): BuilderComposerRouteDecision {
  const normalized = normalizeComposerInstruction(instruction);
  if (normalized.length === 0) {
    return createDecision('answer', context, {
      confidence: 'high',
      matchedSignals: ['empty_message'],
    });
  }
  if (context.activeRunStatus !== undefined && context.activeRunStatus !== 'not_active') {
    if (ACTIVE_RUN_CANCEL_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return createDecision('cancel', context, {
        activeRunInput: 'cancel_requested',
        confidence: 'high',
        matchedSignals: ['active_run_cancel'],
      });
    }
    if (
      context.activeRunCanSteer === true
      && ACTIVE_RUN_STEER_PATTERNS.some((pattern) => pattern.test(normalized))
    ) {
      return createDecision('steer', context, {
        activeRunInput: 'steer_admitted',
        confidence: 'medium',
        matchedSignals: ['active_run_steer'],
      });
    }
    if (context.activeRunCanQueueFollowup === false) {
      return createDecision('clarify', context, {
        activeRunInput: 'unsupported',
        confidence: 'medium',
        matchedSignals: ['active_run_unsupported'],
      });
    }
    return createDecision('queue_followup', context, {
      activeRunInput: 'queued_followup',
      confidence: 'medium',
      matchedSignals: ['active_run_followup'],
    });
  }
  if (context.composerMode === 'plan') {
    return createDecision('plan', context, {
      confidence: 'high',
      matchedSignals: ['composer_mode_plan'],
    });
  }
  if (GOAL_MODE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return createDecision('clarify', context, {
      confidence: 'high',
      matchedSignals: ['goal_mode_request'],
    });
  }
  if (BRIEF_CORRECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return createDecision('update_brief', context, {
      confidence: 'high',
      matchedSignals: ['brief_correction'],
    });
  }
  if (isBuilderComposerExplicitBriefIntent(normalized)) {
    return createDecision('update_brief', context, {
      confidence: 'high',
      matchedSignals: ['explicit_brief'],
    });
  }
  if (WORK_DISCUSSION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return createDecision('clarify', context, {
      confidence: 'high',
      matchedSignals: ['work_discussion'],
    });
  }
  if (CAPABILITY_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return createDecision('clarify', context, {
      confidence: 'high',
      matchedSignals: ['capability_question'],
    });
  }
  if (READ_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return createDecision('answer', context, {
      confidence: 'high',
      matchedSignals: ['read_only'],
    });
  }
  if (
    context.hasPendingBuildConfirmation === true
    && SHORT_BUILD_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return createDecision('build', context, {
      confidence: 'high',
      matchedSignals: ['pending_build_confirmation'],
    });
  }
  if (EXPLICIT_PLAN_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return createDecision('plan', context, {
      confidence: 'high',
      matchedSignals: ['explicit_plan'],
    });
  }
  if (VAGUE_CHANGE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return createDecision('clarify', context, {
      confidence: 'medium',
      downgradedFrom: 'build',
      downgradeReason: 'ambiguous_build_intent',
      matchedSignals: ['vague_change'],
    });
  }
  if (CURRENT_ARTIFACT_DEFECT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return createDecision(context.hasPriorBuildContext === true ? 'build' : 'clarify', context, {
      confidence: 'medium',
      downgradedFrom: context.hasPriorBuildContext === true ? null : 'build',
      downgradeReason: context.hasPriorBuildContext === true ? null : 'missing_prior_build_context',
      matchedSignals: ['current_artifact_defect'],
    });
  }
  if (CURRENT_ARTIFACT_DIRECT_CHANGE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return createDecision(context.hasPriorBuildContext === true ? 'build' : 'clarify', context, {
      confidence: context.hasPriorBuildContext === true ? 'high' : 'medium',
      downgradedFrom: context.hasPriorBuildContext === true ? null : 'build',
      downgradeReason: context.hasPriorBuildContext === true ? null : 'missing_prior_build_context',
      matchedSignals: ['current_artifact_direct_change'],
    });
  }
  if (isBuilderComposerContextualBuildIntent(normalized)) {
    return createDecision(context.hasPriorBuildContext === true ? 'build' : 'clarify', context, {
      confidence: context.hasPriorBuildContext === true ? 'high' : 'medium',
      downgradedFrom: context.hasPriorBuildContext === true ? null : 'build',
      downgradeReason: context.hasPriorBuildContext === true ? null : 'missing_prior_build_context',
      matchedSignals: ['contextual_build_phrase'],
    });
  }
  if (LOCAL_FILE_ARTIFACT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return createDecision('build', context, {
      confidence: 'high',
      matchedSignals: ['local_file_artifact'],
    });
  }
  if (EXPLORATORY_WORK_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return createDecision('update_brief', context, {
      confidence: 'medium',
      matchedSignals: ['exploratory_work'],
    });
  }
  if (CLEAR_BUILD_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return createDecision('build', context, {
      confidence: 'high',
      matchedSignals: ['clear_build'],
    });
  }
  return createDecision('answer', context, {
    confidence: 'low',
    matchedSignals: ['chat_default'],
  });
}
