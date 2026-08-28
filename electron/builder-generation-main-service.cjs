'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  createBuilderGenerationHostAdapter,
} = require('./builder-generation-host-adapter.cjs');
const {
  sanitizeBuilderPlanProposalSourceContextResult,
} = require('./builder-plan-proposal-records.cjs');
const {
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
  CODE_AUTHORITY,
  PRODUCT_REVISION_ADMISSION,
  sanitizeBuilderGitCandidateReceipt,
  sanitizeBuilderGitCandidateReceiptPair,
} = require('./builder-git-receipt-contract.cjs');
const {
  BUILDER_GENERATED_EXPLANATION_KIND,
  BUILDER_GENERATION_RESULT_PROTOCOL,
  createBuilderGenerationRequest,
  projectBuilderExplanationResult,
  sanitizeBuilderGenerationRequest,
} = require('./builder-generation-kernel.cjs');
const {
  createBuilderCodeChangeCandidate,
} = require('./builder-code-change-kernel.cjs');
const {
  createBuilderEditIntentPlan,
  evaluateBuilderWorkspaceGuard,
} = require('./builder-edit-intent-workspace-guard.cjs');
const {
  createBuilderEditAttempt,
  projectBuilderEditAttemptRef,
} = require('./builder-edit-attempt.cjs');
const {
  createBuilderProjectSourceTree,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  builderProjectUnderstandingSnapshotDigest,
  sanitizeBuilderProjectUnderstandingSnapshot,
} = require('./builder-project-understanding.cjs');
const {
  sanitizeBuilderProviderConfig,
} = require('./builder-provider-config.cjs');
const {
  createBuilderExecutionApproval,
} = require('./builder-execution-approval.cjs');
const {
  createBuilderProgrammingRunAdmission,
} = require('./builder-programming-run-admission.cjs');
const {
  sanitizeBuilderRunContextSnapshot,
} = require('./builder-run-context-snapshot.cjs');
const {
  sanitizeBuilderApprovedPlanContinuationAdmission,
} = require('./builder-approved-plan-continuation-admission.cjs');
const {
  APPROVED_PLAN_EXECUTION_INSTRUCTION,
} = require('./builder-approved-plan-execution.cjs');
const {
  createBuilderDraftContinuationAdmission,
  sanitizeBuilderDraftContinuationAdmission,
} = require('./builder-draft-continuation-admission.cjs');
const {
  createBuilderDraftContinuationBase,
  sanitizeBuilderDraftContinuationBase,
} = require('./builder-draft-continuation-base.cjs');
const {
  createBuilderContextAssembly,
} = require('./builder-context-assembler.cjs');
const {
  createBuilderProviderContextProjection,
} = require('./builder-provider-context-projection.cjs');
const {
  assessBuilderProviderContextPromptEgress,
} = require('./builder-provider-context-prompt-egress-gate.cjs');
const {
  sanitizeBuilderProviderContextDisclosureDecision,
} = require('./builder-provider-context-disclosure-decision.cjs');
const {
  createBuilderSemanticRouteRequest,
} = require('./builder-semantic-route-classifier.cjs');
const {
  createBuilderProgrammingRuntimeRunContract,
} = require('./builder-programming-runtime-contract.cjs');
const {
  createBuilderProgrammingRuntimeEventJournal,
} = require('./builder-programming-runtime-events.cjs');
const {
  createBuilderStructuredProgrammingRuntimeBridge,
} = require('./builder-structured-programming-runtime-bridge.cjs');
const {
  createBuilderHarnessGenerationRunner,
} = require('./builder-harness-generation-runner.cjs');
const {
  selectBuilderProgrammingRuntime,
} = require('./builder-programming-runtime-selection.cjs');
const {
  createBuilderProgrammingRuntimeMainFactRecorder,
} = require('./builder-programming-runtime-main-fact-recorder.cjs');
const {
  BUILDER_PROGRAMMING_RUNTIME_SUPERVISION_DEFAULTS,
} = require('./builder-programming-runtime-supervision-policy.cjs');
const {
  CONVERSATION_ID_PATTERN,
  createBuilderConversationAddress,
  sanitizeBuilderConversationAddress,
} = require('./builder-conversation-address.cjs');
const {
  MAX_APPEND_EVENTS,
} = require('./builder-conversation-authority-contract.cjs');
const { builderPerformanceTrace } = require('./builder-performance-trace.cjs');

const BUILDER_GENERATION_MAIN_SERVICE_VERSION = 'builder-generation-main-service.v2';
const PACKAGED_CANARY_SENTINEL = 'BUILDER_PACKAGED_CANARY';
const MAX_PENDING_SEMANTIC_ROUTE_CLASSIFICATIONS = 64;
const PACKAGED_CANARY_USER_DATA_PATH = 'BUILDER_PACKAGED_CANARY_USER_DATA_PATH';
const PACKAGED_CANARY_USER_DATA_PREFIX = 'clawfabric-builder-packaged-canary-';
const PACKAGED_CANARY_GENERATION_DEBUG_FILE = 'builder-canary-generation-debug.jsonl';
const PACKAGED_CANARY_MAX_TOOL_OUTPUT_BYTES = 'BUILDER_PACKAGED_CANARY_MAX_TOOL_OUTPUT_BYTES';
const DEFAULT_RUNTIME_MAX_TOOL_OUTPUT_BYTES = 256 * 1_024;
const BUILDER_GENERATION_PENDING_DRAFT_VERSION = 'builder-generation-pending-draft.v2';
const MAX_RUNTIME_EVENT_BATCH_SIZE = MAX_APPEND_EVENTS;
const GENERATE_OPERATION_PREFIX = 'generate:';
const ANSWER_OPERATION_PREFIX = 'answer:';
const PLAN_OPERATION_PREFIX = 'plan:';
const RESTORE_REVISION_OPERATION_PREFIX = 'restore-revision:';
const RESTORE_CHECKPOINT_OPERATION_PREFIX = 'restore-checkpoint:';
const DRAFT_CONTINUATION_OPERATION_PREFIX = 'draft-continuation:';
const PROVIDER_OUTPUT_EVENT_VERSION = 'builder-generation-output.v1';
const PROVIDER_ACTIVITY_EVENT_VERSION = 'builder-generation-activity.v1';
const PROVIDER_OUTPUT_RESET_EVENT_VERSION = 'builder-generation-output-reset.v1';
const MAX_LIVE_OUTPUT_BUFFER_BYTES = 512 * 1024;
const MAX_LIVE_DISPLAY_TEXT_BYTES = 16 * 1024;
const MAX_HARNESS_CHECK_REPAIR_ATTEMPTS = 3;
const RESTORE_REVISION_REQUEST_KEYS = Object.freeze([
  'project_id',
  'revision_receipt_digest',
]);
const PROJECT_UNDERSTANDING_REFRESH_RESULT_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'status',
  'project_id',
  'project_understanding',
  'latest_project_understanding_read',
  'evidence',
]);
const PROJECT_UNDERSTANDING_RECORD_KEYS = Object.freeze([
  'snapshot_digest',
  'project_understanding_snapshot',
]);
const OPTION_KEYS = Object.freeze([
  'providerConfigRepository',
  'projectReadAuthority',
  'workspaceReadAuthority',
  'projectUnderstandingService',
  'projectIdentityAuthority',
  'conversationService',
  'agentConversationService',
  'gitAuthority',
  'currentProjection',
  'transport',
  'onGenerationStarted',
  'onProviderOutputDelta',
  'createUuid',
  'sourceContextCollector',
  'taskCapsuleStore',
  'taskCapsuleRecordingService',
  'sessionTaskTargetService',
  'sessionTaskAddressRecordingService',
  'sessionTaskAddressBindingService',
  'automaticDraftCheckpointService',
  'codingLoopCheckCoordinator',
  'workingContextStateService',
  'providerContextDisclosureDecisionService',
  'providerContextDisclosureStatusService',
  'runtimeWorkspaceSnapshotService',
  'harnessRuntimeComposition',
  'programmingRuntimeFeatureFlag',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const MESSAGE_ID_PATTERN = new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u');
const EVENT_ID_PATTERN = /^builder-conversation-event:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const PROJECT_UNDERSTANDING_SNAPSHOT_DIGEST_PATTERN =
  /^builder-project-understanding-snapshot:[0-9a-f]{64}$/u;
const CREDENTIAL_PATTERN =
  /(?:["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S|\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/:@]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b)/iu;
const LOCAL_PATH_PATTERN =
  /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const SOURCE_PATH_PATTERN =
  /(?:^|[\s"'`(,:])(?:[A-Za-z0-9._-]+\/){1,}[A-Za-z0-9._-]+\.[A-Za-z0-9._-]{1,12}(?=$|[\s"'`),.;:])/u;
const PROJECT_RESOURCE_PATTERN = /\bproject:\/[a-z0-9._/@-]+/iu;
const MAX_APPROVED_PLAN_PUBLIC_TEXT_CODE_POINTS = 4_000;
const MAX_APPROVED_PLAN_PUBLIC_TEXT_BYTES = 16_000;
const APPROVED_PLAN_READ_KEYS = Object.freeze([
  'result_version',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'decision',
  'plan_result_digest',
  'approved_plan_public_text',
  'conversation_head',
  'authority',
]);
const APPROVED_PLAN_READ_AUTHORITY_KEYS = Object.freeze([
  'conversation',
  'plan_review',
  'renderer_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_authority',
  'revision_admission',
]);
const RESOURCE_ID_PATTERN = /^project:\/[a-z0-9._/@-]{1,120}$/u;
const ERROR_MESSAGES = Object.freeze({
  builder_generation_request_invalid: 'This project request could not be verified.',
  builder_generation_draft_conflict: 'The generated project draft could not be verified.',
  builder_generation_project_workspace_required: 'Choose or open a project folder before building.',
  builder_generation_workspace_changed: 'The project changed while AI was working. Review it and try again.',
  builder_generation_workspace_guard_denied: 'The proposed file changes were blocked to protect this project.',
  builder_generation_workspace_guard_approval_required: 'The proposed file changes need additional approval.',
  builder_generation_checkpoint_undo_unavailable: 'The previous AI change could not be restored.',
  builder_generation_cancelled: 'This AI coding run was cancelled.',
  builder_generation_timeout: 'AI project generation timed out.',
  builder_generation_runtime_stalled: 'The coding runtime stopped making progress.',
  builder_generation_run_limit_reached: 'This coding run reached its safety limit.',
  builder_generation_service_unavailable: 'AI project generation is unavailable.',
});

class BuilderGenerationMainServiceError extends Error {
  constructor(code = 'builder_generation_service_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_generation_service_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderGenerationMainServiceError';
    this.code = selected;
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderGenerationMainServiceError(code);
}

function safeCanaryGenerationDebugCode(error) {
  try {
    if (
      error === null
      || (typeof error !== 'object' && typeof error !== 'function')
      || utilTypes.isProxy(error)
    ) return 'unknown';
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
      ? descriptor.value
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

function safeCanaryGenerationDebugProperty(error, key) {
  try {
    if (
      error === null
      || (typeof error !== 'object' && typeof error !== 'function')
      || utilTypes.isProxy(error)
    ) return 'unknown';
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
      && /^[a-z0-9_]{1,96}$/u.test(descriptor.value)
      ? descriptor.value
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

function recordCanaryGenerationDebug(phase, error = null) {
  try {
    if (process.env[PACKAGED_CANARY_SENTINEL] !== '1') return;
    const userDataPath = process.env[PACKAGED_CANARY_USER_DATA_PATH];
    if (
      typeof userDataPath !== 'string'
      || !path.isAbsolute(userDataPath)
      || !path.basename(userDataPath).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)
    ) return;
    fs.appendFileSync(
      path.join(userDataPath, PACKAGED_CANARY_GENERATION_DEBUG_FILE),
      `${JSON.stringify({
        result_version: 'builder-canary-generation-debug.v1',
        phase,
        code: safeCanaryGenerationDebugCode(error),
        runtime_code: safeCanaryGenerationDebugProperty(error, 'runtime_code'),
        runtime_cause_code: safeCanaryGenerationDebugProperty(error, 'runtime_cause_code'),
      })}\n`,
      { encoding: 'utf8' },
    );
  } catch {
    // Canary diagnostics must never alter generation behavior.
  }
}

function runtimeMaxToolOutputBytes() {
  if (process.env[PACKAGED_CANARY_SENTINEL] !== '1' || process.env.BUILDER_PERF_TRACE !== '1') {
    return DEFAULT_RUNTIME_MAX_TOOL_OUTPUT_BYTES;
  }
  const raw = process.env[PACKAGED_CANARY_MAX_TOOL_OUTPUT_BYTES];
  if (typeof raw !== 'string' || !/^\d{4,8}$/u.test(raw)) {
    return DEFAULT_RUNTIME_MAX_TOOL_OUTPUT_BYTES;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= DEFAULT_RUNTIME_MAX_TOOL_OUTPUT_BYTES
    && value <= 16 * 1_024 * 1_024
    ? value
    : DEFAULT_RUNTIME_MAX_TOOL_OUTPUT_BYTES;
}

const ENGLISH_WORK_INTENT_PATTERN =
  /\b(?:add|build|change|create|delete|design|fix|generate|implement|make|modify|remove|refactor|style|update|write)\b/u;
const ENGLISH_EXPLANATION_INTENT_PATTERN =
  /^(?:can you tell|compare|describe|explain|how|summarize|tell me|what|when|where|which|who|why)\b/u;
const CHINESE_WORK_INTENT_PATTERN =
  /(?:创建|生成|编写|实现|开发|搭建|添加|新增|修改|调整|优化|修复|删除|移除|重构|设计|做一个|做个|做出|加一个|加个|帮我.{0,16}(?:做|写|创建|生成|实现|开发|搭建|添加|新增|修改|调整|优化|修复|删除|移除|重构|设计)|(?:把|将).{0,32}(?:改|换|替换|设为|设置|添加|新增|加个|加一个|删除|删掉|去掉|移除|修复|调整|调成|调为|放大|缩小|移动|移到)|(?:登录页|页面|按钮|表单|网站|网页|应用|工具|组件|功能|样式|布局|代码|小游戏|仪表盘|看板|预览|界面|UI).{0,16}(?:做|创建|生成|写|编写|实现|开发|搭建|添加|新增|修改|改|调整|优化|修复|删除|移除|重构|设计))/iu;
const CHINESE_EXPLANATION_INTENT_PATTERN =
  /(?:是什么|为什么|怎么|如何|怎样|解释|说明|介绍|总结|对比|分析|原因|含义|意思|做什么|干什么|能做什么|会做什么)/u;
const CASUAL_CHAT_INTENT_PATTERN =
  /^(?:hi|hello|hey|你好|您好|在吗|你在吗|在不在)[.!?。！？]*$/iu;
const EXPLICIT_PLAN_INTENT_PATTERNS = Object.freeze([
  /^(?:(?:帮我|请|麻烦)\s*)?(?:先)?(?:规划|计划)(?:一下|下)?(?:(?:这个|当前|整体|本次|接下来|后续)?(?:项目|页面|网站|应用|功能|需求|方向|实现|开发|改版))?(?:[。.!！?？\s]|$)/u,
  /^(?:(?:帮我|请|麻烦)\s*)?(?:先)?(?:规划(?:一下|下)?|计划(?:一下|下)?|制定(?:一下)?方案|出(?:个|一个|下|一下)?方案|做(?:个|一个|下|一下)?方案|给(?:我|我们)?(?:出|做|写|列)?(?:个|一个)?方案|列(?:一下|下)?(?:步骤|计划|方案)|先不要写代码.{0,16}(?:方案|步骤|计划))(?=$|[吧。.!！?？，,\s])/u,
  /^(?:(?:帮我|请|麻烦)\s*)?(?:把|将)?(?:这个|当前|刚才(?:的)?|上面(?:的)?|前面(?:的)?|这段|这些|以上|上面的)?(?:内容|方案|想法|需求|方向|讨论)?(?:做成|整理成|转成|变成)(?:一个|个)?(?:计划|plan|方案|步骤)/iu,
  /(?:^|[，,。.!！?？\s])(?:(?:帮我|请|麻烦)\s*)?(?:把|将)?(?:这个|当前|刚才(?:的)?|上面(?:的)?|前面(?:的)?|这段|这些|以上|上面的)?(?:内容|方案|想法|需求|方向|讨论)?(?:做成|整理成|转成|变成)(?:一个|个)?(?:计划|plan|方案|步骤)(?:[。.!！?？\s]|$)/iu,
  /^(?:(?:我|我们)?(?:想要|要|需要|希望|想)(?:一个|个)?(?:计划|plan|方案|步骤)|(?:帮我|请|麻烦)?(?:做|写|列|出)(?:成)?(?:一个|个)?(?:计划|plan))(?:[。.!！?？\s]|$)/iu,
  /^(?:(?:先)?(?:帮我|请|麻烦)\s*)?(?:先)?(?:梳理|整理|拆解|分析)(?:一下|下)?(?:(?:这个|当前|整体|实现|开发|页面|项目)){0,3}(?:方案|计划|步骤|思路|路径|实现路径)/u,
  /^(?:plan first|plan this first|make a plan|propose a plan|draft a plan|give me a plan|outline the steps|don'?t write code yet|let'?s plan|let us plan)\b/u,
]);
const EXPLICIT_BRIEF_INTENT_PATTERNS = Object.freeze([
  /^(?:保存|记住|记录|保留|沉淀)(?:一下|下)?(?:这个|当前|刚才(?:的)?|上面(?:的)?|前面(?:的)?|这次)?(?:方向|目标|需求|约束|方案|计划|想法|brief|上下文)?(?:[：:，,\s]|$).*/u,
  /^(?:把|将)(?:这个|当前|刚才(?:的)?|上面(?:的)?|前面(?:的)?|这段|这些|以上|上面的)?(?:方向|目标|需求|约束|方案|计划|想法|内容|上下文|brief)?(?:保存|记录|记住|作为|设为).*/u,
  /(?:后面|接下来|之后)(?:就)?(?:按|照)(?:这个|这个方向|这个方案|刚才(?:的)?|上面(?:的)?)(?:来|做|写|实现)?/u,
  /^(?:save|remember|record|keep)\s+(?:this|that|the current).*(?:brief|goal|requirement|direction|plan|context)?/u,
  /^(?:use|treat)\s+this\s+as\s+(?:the\s+)?(?:brief|current brief|goal|plan|requirements)\b/u,
]);
const BRIEF_CORRECTION_INTENT_PATTERNS = Object.freeze([
  /^(?:等一下|等等|先等等|先别|先不要|不要|别).{0,64}(?:按|照|做|写|执行|实现|开始|这个|刚才|方案|计划|方向|目标|需求).*/u,
  /(?:撤回|推翻|作废|不要了|不算了|先不做|先别做|先不要做|别按|不要按|别照|不要照|重新整理|重新确认|换个方向|改方向)/u,
  /^(?:wait|hold on|actually|scratch that|not that|pause|do not|don'?t).{0,96}(?:brief|plan|direction|approach|that|it|execute|implement|build)/u,
]);
const GOAL_MODE_INTENT_PATTERNS = Object.freeze([
  /(?:目标模式|goal\s*mode|persistent\s+goal|持续目标|长期目标)/u,
  /(?:设定|设置|创建|建立|给你|交给你).{0,24}(?:目标|goal).{0,48}(?:持续|一直|自动|连续|自己|直到|完成为止|做完|阻塞|blocked|done)/u,
  /(?:持续|一直|连续|自动|自己).{0,32}(?:工作|推进|执行|修改|实现|验证|修复).{0,48}(?:直到|到)(?:真正)?(?:完成|做好|做完|done|blocked|阻塞)/u,
  /(?:keep|continue)\s+(?:working|going|iterating|building|fixing|verifying)\b.{0,80}\b(?:until|till)\b.{0,40}\b(?:done|complete|completed|blocked)\b/u,
  /\b(?:set|create|start|give\s+you)\s+(?:a\s+)?goal\b.{0,80}\b(?:until|done|complete|completed|blocked)\b/u,
]);
const VAGUE_CHANGE_INTENT_PATTERNS = Object.freeze([
  /^(?:(?:你能|可以|能不能)?(?:帮我|请|麻烦)?\s*)?(?:优化|调整|修改|改进|完善|美化|重构)(?:一下|下|点|一点|看看)?[?？。.!！]*$/u,
  /^(?:能不能|可以不可以|可不可以)(?:更|再)?好看(?:一点|点)?[?？。.!！]*$/u,
  /^(?:can|could)\s+(?:this|it|that)\s+look\s+better[.?!]*$/u,
  /^(?:make|improve)\s+(?:it|this|that)\s+(?:better|nicer|cleaner|prettier|more polished)[.?!]*$/u,
]);
const SHORT_BUILD_CONFIRMATION_INTENT_PATTERNS = Object.freeze([
  /^(?:要|需要|可以|好|好的|行|嗯|嗯嗯|对|是的|确认|同意|改吧|做吧|写吧|开始吧|直接改|直接做|就这样|按这个来)[。.!！]*$/u,
  /^(?:yes|yep|yeah|ok|okay|sure|please do|do it|go ahead|sounds good|that works)[.?!]*$/u,
]);
const CURRENT_ARTIFACT_DEFECT_INTENT_PATTERNS = Object.freeze([
  /(?:这里|这块|这个|当前|页面|界面|聊天框|预览|按钮|文字|字|内容|布局|右侧|左侧|顶部|底部|卡片|气泡).{0,24}(?:重叠|挡住|遮住|挤(?:在一起|成|坏|爆|压)?|溢出|错位|穿出|太窄|太宽|看不清|乱了|坏了|不对|不齐|不稳|出去了)/u,
  /(?:重叠|挡住|遮住|溢出|错位|穿出|挤坏|挤爆|看不清|布局乱了|版式坏了|样式坏了)/u,
  /\b(?:overlap|overlapping|overflow|misaligned|clipped|covered|covering|too narrow|too wide|layout is broken|looks broken|text is cut off)\b/u,
]);
const CURRENT_ARTIFACT_DIRECT_CHANGE_INTENT_PATTERNS = Object.freeze([
  /^(?:(?:帮我|请|麻烦)?\s*)?(?:改|修改|调整|换|更换|优化|统一|更新)(?:一下|下)?(?:这个|当前|页面|界面|结果|稿子|版本)?(?:的)?(?:颜色|配色|主题色|色彩|背景|字体|字号|标题|按钮|卡片|间距|圆角|布局|样式)[。.!！]*$/u,
  /^(?:change|update|adjust|tweak|switch|improve)\s+(?:the\s+)?(?:color|colors|palette|theme|background|font|heading|button|card|spacing|radius|layout|style)s?[.?!]*$/u,
]);
const CURRENT_DRAFT_CONTINUATION_INTENT_PATTERNS = Object.freeze([
  /^(?:继续|接着|再)(?:帮我)?(?:优化|完善|改进|修改|调整|更新|编辑|修复|完成|实现|写|做).*/u,
  /^(?:continue|keep)\s+(?:on\s+)?(?:improving|refining|polishing|updating|editing|changing|fixing|finishing|implementing|building)\b.*$/u,
  /^(?:continue|resume)\s+from\s+(?:this|the)\s+(?:restored\s+)?checkpoint\b.{0,120}\b(?:complete|finish|improve|refine|update|edit|change|fix|implement|build)\b.*$/u,
]);
const PENDING_BUILD_CONFIRMATION_INTENT_PATTERN =
  /(?:需要我|要我|要不要我|是否(?:需要|要)我|我可以|可以帮你|如果你想).{0,64}(?:直接|现在|马上)?(?:修改|调整|更改|改|应用|生成|创建|实现|写|做|开始)|(?:would you like|do you want me to|should i|i can).{0,96}(?:change|modify|apply|build|create|implement|update|make|write)/iu;
const WORK_DISCUSSION_INTENT_PATTERNS = Object.freeze([
  /(?:先聊|先讨论|先确定|讨论一下|聊一下|确认一下|想先聊|我们先确定|先看看|你觉得|你建议|怎么样|如何设计|怎么设计|怎么做|方案如何|风格怎么|需求怎么)/u,
  /\b(?:discuss|brainstorm|figure out|talk through|what do you think|how should|how would|should we|could we|can we|requirements|style direction)\b/u,
]);
const CAPABILITY_QUESTION_INTENT_PATTERNS = Object.freeze([
  /^(?:你)?(?:可以|能不能|能否|可不可以|可以不可以)(?:先)?(?:帮我|给我|为我)?[^?？。!！]*(?:做|创建|生成|实现|设计|开发|搭建|修改|优化|重构|写|编写|添加|新增|删除|修复)[^?？。!！]*[?？吗么]\s*$/u,
  /^(?:can|could|would)\s+you\s+(?:help\s+me\s+)?(?:build|create|make|implement|design|develop|add|change|modify|update|fix|write)\b.*\?\s*$/u,
]);
const EXPLORATORY_WORK_INTENT_PATTERNS = Object.freeze([
  /^(?:(?:我|我们)?(?:想|想要|要|希望|需要|打算|准备|计划|考虑))[^?？]*(?:做|创建|生成|实现|设计|开发|搭建|页面|网页|网站|应用|功能|布局|组件|登录页|仪表盘|看板|3d|ui)/u,
  /^(?:i|we)\s+(?:want|would like|need|hope|plan|intend)\s+to\s+(?:build|create|make|implement|design|develop|add|change|modify|update)\b/u,
  /^(?:i|we)\s+(?:am|are|'m|'re)\s+(?:thinking|considering|planning)\s+(?:about\s+)?(?:building|creating|making|implementing|designing)\b/u,
]);
const LOCAL_FILE_ARTIFACT_PATTERNS = Object.freeze([
  /(?:创建|新建|生成|写|编写|保存|添加|新增).{0,40}(?:\.md\b|markdown|md\s*(?:文档|文件)|readme|说明文档|文档|文件|笔记|notes?)/u,
  /(?:create|write|generate|add|save).{0,48}(?:\.md\b|markdown|readme|notes?\s+file|document|text\s+file)/u,
]);
const SEMANTIC_PLAN_BUILD_CONFLICT_INTENT_PATTERNS = Object.freeze([
  /(?:做|写|出|给|制定|规划|生成|创建|整理|梳理|设计).{0,36}(?:实施计划|实现计划|开发计划|执行计划|改版方案|优化方案|重构方案|实现方案|实施方案|开发方案|改造方案|调整方案)/u,
  /(?:当前|这个|项目|文件夹|网站|页面|应用|readme|README).{0,36}(?:实施计划|实现计划|开发计划|执行计划|改版方案|优化方案|重构方案|实现方案|实施方案|开发方案|改造方案|调整方案)/u,
  /\b(?:implementation|execution|migration|refactor|optimization|redesign)\s+(?:plan|proposal)\b/u,
]);
const CONTEXTUAL_WORK_INTENT_PATTERNS = Object.freeze([
  /^(?:就这样(?:写|做|改|实现|执行|开始)?|就按(?:这个(?:方案|计划)?|刚才(?:的)?(?:方案|计划)?|上面(?:的)?(?:方案|计划)?|前面(?:的)?(?:方案|计划)?)(?:写|做|改|实现|执行)?|按(?:这个(?:方案|计划)?|刚才(?:的)?(?:方案|计划)?|上面(?:的)?(?:方案|计划)?|前面(?:的)?(?:方案|计划)?)(?:写|做|改|实现|执行)|开始(?:写|做|改|实现|执行)|可以开始了)[。.!！]*$/u,
  /^(?:(?:好|好的|可以|行|嗯)[，,\s]*)?(?:(?:就)?(?:照|按)(?:这个|刚才(?:说的|聊的|讨论的|确认的)?|上面(?:说的)?|前面(?:说的)?|我们刚才(?:说的|聊的|讨论的|确认的)?)(?:方案|计划)?(?:写|做|改|实现|执行|来)|(?:开始|执行)(?:吧|了)?|可以开始(?:了|吧)?)[。.!！]*$/u,
  /^(?:(?:那|那就|就|好|好的|可以|行|嗯)[，,\s]*)?(?:直接)?(?:写|做|改)(?:一下|下|吧|了)?[。.!！]*$/u,
  /^(?:(?:我)?(?:需要|要)(?:你)?|请|麻烦|帮我)?\s*(?:重新|重)?(?:写|做|改)(?:一下|下)?(?:这个|当前|刚才(?:的)?|上面(?:的)?|前面(?:的)?|方案|计划|页面|网页|网站|应用|界面|结果|版本|稿子|草稿)?[。.!！]*$/u,
  /^(?:(?:我)?(?:需要|要)(?:你)?|请|麻烦|帮我)?\s*(?:重写|重做|重改|重新写|重新做|重新改)(?:一下|下)?(?:这个|当前|刚才(?:的)?|上面(?:的)?|前面(?:的)?|方案|计划|页面|网页|网站|应用|界面|结果|版本|稿子|草稿)?[。.!！]*$/u,
  /^(?:do it|go ahead|start|let'?s do it|implement that|build that|make that)[.?!]*$/u,
  /^(?:(?:ok|okay|yes|sounds good|great)[,\s]*)?(?:go ahead|start(?: building| implementing)?|implement (?:it|this|that|the plan)|build (?:it|this|that)|do it|let'?s do it|make that)[.?!]*$/u,
]);
const NO_PROJECT_STATUS_QUESTION_PATTERNS = Object.freeze([
  /^(?:你现在在做什么|现在在做什么|你在做什么|你能做什么|现在能做什么|当前状态|现在状态)[?？。!！]*$/u,
  /(?:这个项目|当前项目|项目|预览|preview).{0,24}(?:是什么|做什么|干什么|为什么|为何|怎么回事|空白|blank|状态|有没有)/iu,
  /^(?:what are you doing|what can you do)[?!.]*$/iu,
]);
const BUILDER_TASK_STREAM_READ_RESULT_VERSION = 'builder-task-stream-read-result.v1';

function normalizedIntentText(instruction) {
  return String(instruction).trim().normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}

function matchesAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function isContextualSubmitContextIntent(instruction) {
  const text = normalizedIntentText(instruction);
  if (text.length === 0) return false;
  return matchesAny(CONTEXTUAL_WORK_INTENT_PATTERNS, text)
    || matchesAny(CURRENT_ARTIFACT_DEFECT_INTENT_PATTERNS, text)
    || matchesAny(CURRENT_ARTIFACT_DIRECT_CHANGE_INTENT_PATTERNS, text)
    || matchesAny(CURRENT_DRAFT_CONTINUATION_INTENT_PATTERNS, text);
}

function routeDecisionHint({
  route,
  confidence,
  matchedSignals,
  downgradedFrom = null,
  downgradeReason = null,
  requiredPermissions = [],
  permissionResult = 'not_required',
  dispatch = 'reply',
}) {
  return freezeDeep({
    route,
    confidence,
    matched_signals: [...matchedSignals],
    downgraded_from: downgradedFrom,
    downgrade_reason: downgradeReason,
    required_permissions: [...requiredPermissions],
    permission_result: permissionResult,
    dispatch,
  });
}

function withRouteDecisionMatchedSignal(hint, signal) {
  if (hint.matched_signals.includes(signal)) return hint;
  return routeDecisionHint({
    route: hint.route,
    confidence: hint.confidence,
    matchedSignals: [signal, ...hint.matched_signals],
    downgradedFrom: hint.downgraded_from,
    downgradeReason: hint.downgrade_reason,
    requiredPermissions: hint.required_permissions,
    permissionResult: hint.permission_result,
    dispatch: hint.dispatch,
  });
}

function answerRouteDecisionHint(matchedSignals = ['read_only']) {
  return routeDecisionHint({
    route: 'answer',
    confidence: 'high',
    matchedSignals,
  });
}

function explicitPlanSubmitFallbackDecisionHint() {
  return routeDecisionHint({
    route: 'clarify',
    confidence: 'high',
    matchedSignals: ['explicit_plan'],
  });
}

function goalModeSubmitFallbackDecisionHint() {
  return routeDecisionHint({
    route: 'clarify',
    confidence: 'high',
    matchedSignals: ['goal_mode_request'],
  });
}

function planRouteDecisionHint() {
  return routeDecisionHint({
    route: 'plan',
    confidence: 'high',
    matchedSignals: ['explicit_plan'],
    requiredPermissions: ['project_read'],
    permissionResult: 'allowed',
    dispatch: 'plan',
  });
}

function clearPlanDeliverableRouteDecisionHint() {
  return routeDecisionHint({
    route: 'plan',
    confidence: 'high',
    matchedSignals: ['clear_plan_deliverable'],
    requiredPermissions: [],
    permissionResult: 'not_required',
    dispatch: 'plan',
  });
}

function buildRouteDecisionHint(matchedSignals = ['clear_build']) {
  return routeDecisionHint({
    route: 'build',
    confidence: 'high',
    matchedSignals,
    requiredPermissions: ['write_project'],
    permissionResult: 'allowed',
    dispatch: 'build',
  });
}

function semanticRouteDecisionHint(classification, allowedRoutes) {
  const route = valueAt(classification, 'route');
  const confidence = valueAt(classification, 'confidence');
  if (!allowedRoutes.includes(route) || !['low', 'medium', 'high'].includes(confidence)) fail();
  return routeDecisionHint({
    route,
    confidence,
    matchedSignals: ['semantic_route'],
    requiredPermissions: route === 'build'
      ? ['write_project']
      : route === 'plan'
        ? ['project_read']
        : [],
    permissionResult: route === 'build' || route === 'plan' ? 'allowed' : 'not_required',
    dispatch: route === 'build'
      ? 'build'
      : route === 'plan'
        ? 'plan'
        : route === 'update_brief'
          ? 'brief_update'
          : 'reply',
  });
}

function normalizeSubmitRouteContext(value) {
  if (value === true || value === false) {
    return Object.freeze({
      hasContextualBuildContext: value,
      hasPendingBuildConfirmation: false,
      hasWorkingContextStateEvidence: false,
    });
  }
  if (value !== null && typeof value === 'object') {
    return Object.freeze({
      hasContextualBuildContext: value.hasContextualBuildContext === true,
      hasPendingBuildConfirmation: value.hasPendingBuildConfirmation === true,
      hasWorkingContextStateEvidence: value.hasWorkingContextStateEvidence === true,
    });
  }
  return Object.freeze({
    hasContextualBuildContext: false,
    hasPendingBuildConfirmation: false,
    hasWorkingContextStateEvidence: false,
  });
}

function classifySubmitRouteDecision(instruction, routeContext = false) {
  const {
    hasContextualBuildContext,
    hasPendingBuildConfirmation,
    hasWorkingContextStateEvidence,
  } = normalizeSubmitRouteContext(routeContext);
  const text = normalizedIntentText(instruction);
  if (text.length === 0) return answerRouteDecisionHint(['empty_message']);
  const hasQuestionMark = /[?\uFF1F]\s*$/u.test(text);
  const hasExplanationIntent =
    ENGLISH_EXPLANATION_INTENT_PATTERN.test(text)
    || CHINESE_EXPLANATION_INTENT_PATTERN.test(text);
  if (CASUAL_CHAT_INTENT_PATTERN.test(text)) return answerRouteDecisionHint(['read_only']);
  if (matchesAny(GOAL_MODE_INTENT_PATTERNS, text)) return goalModeSubmitFallbackDecisionHint();
  if (matchesAny(EXPLICIT_PLAN_INTENT_PATTERNS, text)) return explicitPlanSubmitFallbackDecisionHint();
  if (matchesAny(BRIEF_CORRECTION_INTENT_PATTERNS, text)) {
    return routeDecisionHint({
      route: 'update_brief',
      confidence: 'high',
      matchedSignals: ['brief_correction'],
      dispatch: 'brief_update',
    });
  }
  if (matchesAny(EXPLICIT_BRIEF_INTENT_PATTERNS, text)) {
    return routeDecisionHint({
      route: 'update_brief',
      confidence: 'high',
      matchedSignals: ['explicit_brief'],
      dispatch: 'brief_update',
    });
  }
  if (matchesAny(WORK_DISCUSSION_INTENT_PATTERNS, text)) {
    return routeDecisionHint({
      route: 'clarify',
      confidence: 'high',
      matchedSignals: ['work_discussion'],
    });
  }
  if (matchesAny(CAPABILITY_QUESTION_INTENT_PATTERNS, text)) {
    return routeDecisionHint({
      route: 'clarify',
      confidence: 'high',
      matchedSignals: ['capability_question'],
    });
  }
  if (hasQuestionMark && hasExplanationIntent) return answerRouteDecisionHint(['read_only']);
  if (matchesAny(SEMANTIC_PLAN_BUILD_CONFLICT_INTENT_PATTERNS, text)) {
    return clearPlanDeliverableRouteDecisionHint();
  }
  if (matchesAny(LOCAL_FILE_ARTIFACT_PATTERNS, text)) return buildRouteDecisionHint(['local_file_artifact']);
  if (hasExplanationIntent) return answerRouteDecisionHint(['read_only']);
  if (matchesAny(VAGUE_CHANGE_INTENT_PATTERNS, text)) {
    return routeDecisionHint({
      route: 'clarify',
      confidence: 'medium',
      matchedSignals: ['vague_change'],
      downgradedFrom: 'build',
      downgradeReason: 'ambiguous_build_intent',
    });
  }
  if (matchesAny(EXPLORATORY_WORK_INTENT_PATTERNS, text)) {
    return routeDecisionHint({
      route: 'update_brief',
      confidence: 'medium',
      matchedSignals: ['exploratory_work'],
      dispatch: 'brief_update',
    });
  }
  if (matchesAny(SHORT_BUILD_CONFIRMATION_INTENT_PATTERNS, text)) {
    return hasPendingBuildConfirmation
      ? buildRouteDecisionHint(['pending_build_confirmation'])
      : answerRouteDecisionHint(['chat_default']);
  }
  if (matchesAny(CURRENT_ARTIFACT_DEFECT_INTENT_PATTERNS, text)) {
    return hasContextualBuildContext
      ? buildRouteDecisionHint(hasWorkingContextStateEvidence
        ? ['working_context_state', 'current_artifact_defect']
        : ['current_artifact_defect'])
      : routeDecisionHint({
        route: 'clarify',
        confidence: 'medium',
        matchedSignals: ['current_artifact_defect'],
        downgradedFrom: 'build',
        downgradeReason: 'missing_prior_build_context',
      });
  }
  if (matchesAny(CURRENT_ARTIFACT_DIRECT_CHANGE_INTENT_PATTERNS, text)) {
    return hasContextualBuildContext
      ? buildRouteDecisionHint(hasWorkingContextStateEvidence
        ? ['working_context_state', 'current_artifact_direct_change']
        : ['current_artifact_direct_change'])
      : routeDecisionHint({
        route: 'clarify',
        confidence: 'medium',
        matchedSignals: ['current_artifact_direct_change'],
        downgradedFrom: 'build',
        downgradeReason: 'missing_prior_build_context',
      });
  }
  if (matchesAny(CURRENT_DRAFT_CONTINUATION_INTENT_PATTERNS, text)) {
    return hasContextualBuildContext
      ? buildRouteDecisionHint(hasWorkingContextStateEvidence
        ? ['working_context_state', 'current_draft_continuation']
        : ['current_draft_continuation'])
      : routeDecisionHint({
        route: 'clarify',
        confidence: 'medium',
        matchedSignals: ['current_draft_continuation'],
        downgradedFrom: 'build',
        downgradeReason: 'missing_prior_build_context',
      });
  }
  if (matchesAny(CONTEXTUAL_WORK_INTENT_PATTERNS, text)) {
    return hasContextualBuildContext
      ? buildRouteDecisionHint(hasWorkingContextStateEvidence
        ? ['working_context_state', 'contextual_build']
        : ['contextual_build'])
      : routeDecisionHint({
        route: 'clarify',
        confidence: 'medium',
        matchedSignals: ['contextual_build'],
        downgradedFrom: 'build',
        downgradeReason: 'missing_prior_build_context',
      });
  }
  if (
    ENGLISH_WORK_INTENT_PATTERN.test(text)
    || CHINESE_WORK_INTENT_PATTERN.test(text)
  ) return buildRouteDecisionHint(['clear_build']);
  return answerRouteDecisionHint(['chat_default']);
}

function classifyReadOnlyAnswerRouteDecision(instruction, hasContextualBuildContext = false) {
  const decision = classifySubmitRouteDecision(instruction, hasContextualBuildContext);
  if (decision.route !== 'build') return decision;
  return routeDecisionHint({
    route: 'clarify',
    confidence: decision.confidence === 'high' ? 'medium' : decision.confidence,
    matchedSignals: decision.matched_signals,
    downgradedFrom: 'build',
    downgradeReason: decision.downgrade_reason ?? 'ambiguous_build_intent',
  });
}

function localCasualChatReply(instruction) {
  const text = normalizedIntentText(instruction);
  if (text.length === 0 || !CASUAL_CHAT_INTENT_PATTERN.test(text)) return null;
  if (/\p{Script=Han}/u.test(instruction)) {
    return Object.freeze({
      title: '你好',
      summary: '我在，可以先聊想法；要开始构建时再选择项目文件夹。',
      explanation: '你好，我在。你可以先随便聊想法，等确定要做的时候再让我开始实现；需要写入本地项目时，我会先让你选择项目文件夹。',
    });
  }
  return Object.freeze({
    title: 'Ready when you are',
    summary: 'We can talk first; building will ask for a project folder.',
    explanation: 'Hi, I am here. We can talk through the idea first. When you want me to build or change files, I will ask you to choose a project folder before making edits.',
  });
}

function localNoProjectQuestionReply(request) {
  if (request.existing_project_id !== null) return null;
  const text = normalizedIntentText(request.instruction);
  if (
    text.length === 0
    || !matchesAny(NO_PROJECT_STATUS_QUESTION_PATTERNS, text)
  ) return null;
  if (/\p{Script=Han}/u.test(request.instruction)) {
    return Object.freeze({
      title: '还没有选择项目',
      summary: '可以先聊天；要查看预览或修改文件时，再选择项目文件夹。',
      explanation: '现在还没有选中的项目或草稿，所以没有可查看的项目内容或预览。你可以先继续聊想法；等要构建、预览或修改文件时，我会让你选择项目文件夹。',
    });
  }
  return Object.freeze({
    title: 'No project selected yet',
    summary: 'We can keep talking; choose a project folder when you want preview or file changes.',
    explanation: 'There is no selected project or draft yet, so there is no project content or preview to inspect. We can keep talking through the idea first; when you want to build, preview, or change files, I will ask you to choose a project folder.',
  });
}

function failedCheckClosure(summary) {
  const localized = /\p{Script=Han}/u.test(summary);
  const note = localized
    ? '自动检查仍未通过，这份草稿已保留供继续修复，当前不能视为已完成。'
    : 'The automatic check still fails. This draft is preserved for another repair and must not be treated as complete.';
  const notePoints = Array.from(note);
  const summaryBudget = Math.max(0, 397 - notePoints.length);
  const summaryPoints = Array.from(summary.trim());
  const lead = summaryPoints.length <= summaryBudget
    ? summaryPoints.join('')
    : `${summaryPoints.slice(0, Math.max(0, summaryBudget - 3)).join('')}...`;
  return Object.freeze({
    title: localized ? '项目更新仍需修复' : 'Project update needs repair',
    summary: lead.length === 0 ? note : `${lead} ${note}`,
  });
}

function unavailableCheckClosure(summary) {
  const localized = /\p{Script=Han}/u.test(summary);
  const note = localized
    ? '自动检查环境尚未准备好，这份草稿已保留；这不是源码修复问题，也不代表你的电脑一定缺少依赖。'
    : 'The automatic check environment is not ready. This draft is preserved; this is not a source repair problem and does not prove your machine lacks dependencies.';
  const notePoints = Array.from(note);
  const summaryBudget = Math.max(0, 397 - notePoints.length);
  const summaryPoints = Array.from(summary.trim());
  const lead = summaryPoints.length <= summaryBudget
    ? summaryPoints.join('')
    : `${summaryPoints.slice(0, Math.max(0, summaryBudget - 3)).join('')}...`;
  return Object.freeze({
    title: localized ? '项目更新需准备检查环境' : 'Project update needs check environment',
    summary: lead.length === 0 ? note : `${lead} ${note}`,
  });
}

function chineseHarnessBuildClosure({
  modelSummary,
  candidate,
  automaticCheck,
  currentMaterialization,
}) {
  const changedPaths = [...new Set(candidate.operations.map((operation) => operation.path))];
  const visiblePaths = changedPaths.slice(0, 8).map((filePath) => `\`${filePath}\``).join('、');
  const remainingPathCount = Math.max(0, changedPaths.length - 8);
  const pathSummary = changedPaths.length === 0
    ? '没有检测到文件变更'
    : `已更新 ${visiblePaths}${remainingPathCount > 0 ? ` 等 ${changedPaths.length} 个文件` : ''}`;
  const projection = automaticCheck?.status === 'completed'
    ? automaticCheck.check_run_status_projection
    : null;
  const commandDisplay = automaticCheck?.status === 'completed'
    ? automaticCheck.profile?.command_display ?? null
    : null;
  let headline = '本轮编码已结束。';
  let checkLine = '自动检查：当前项目没有可执行的检查，或检查服务不可用。';
  if (projection?.status === 'passed') {
    headline = '编码任务已完成，并通过自动检查。';
    checkLine = `自动检查：${commandDisplay === null ? '' : `\`${commandDisplay}\` `}已通过。`;
  } else if (projection?.status === 'failed') {
    headline = '本轮修改已保留，但自动检查仍未通过，任务尚未闭环。';
    checkLine = `自动检查：${commandDisplay === null ? '' : `\`${commandDisplay}\` `}未通过，请继续修复后重试。`;
  } else if (projection?.status === 'incomplete') {
    headline = '本轮修改已保留，但自动检查环境未就绪。';
    checkLine = `自动检查：${commandDisplay === null ? '' : `\`${commandDisplay}\` `}未能运行；${projection.summary}`;
  }
  const materializationLine = currentMaterialization.status === 'materialized'
    ? '项目文件：最新草稿已写入当前项目文件夹。'
    : currentMaterialization.status === 'not_materialized'
      ? '项目文件：草稿已保留，但未能写入当前项目文件夹，请先检查工作区状态。'
      : '项目文件：草稿已保留；当前没有可写入的项目文件夹。';
  const normalizedSummary = modelSummary.trim();
  const detail = /\p{Script=Han}/u.test(normalizedSummary)
    ? Array.from(normalizedSummary).slice(0, 520).join('')
    : '已按本轮要求完成项目修改。';
  const nextLine = projection?.status === 'failed'
    ? '下一步：继续说明要修复的问题，Builder 会基于当前草稿接着处理。'
    : projection?.status === 'incomplete'
      ? '下一步：先准备依赖或授权 Builder 准备隔离检查环境，然后再运行检查。'
    : currentMaterialization.status === 'materialized'
      ? '使用方式：点击顶部「Run」运行项目；需要开发服务器时，确认本次命令后会打开本地地址。也可以点击「Open location」查看项目文件。'
      : '下一步：选择或恢复项目文件夹后，再运行和打开项目。';
  return [
    headline,
    '',
    `- 完成内容：${detail}`,
    `- 文件：${pathSummary}。`,
    `- ${checkLine}`,
    `- ${materializationLine}`,
    '',
    nextLine,
  ].join('\n');
}

function localReadOnlyReply(request) {
  return localCasualChatReply(request.instruction) ?? localNoProjectQuestionReply(request);
}

function denseTaskStreamItems(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > 128
  ) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) fail();
  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || !isPlainObject(descriptor.value)
    ) fail();
    items.push(descriptor.value);
  }
  return items;
}

function taskStreamConversationForSubmitContext(value, expectedProjectId) {
  exactObjectWithOptional(value, [
    'stream_version', 'project_id', 'conversation', 'authority',
  ], [
    'context_status_projection',
    'provider_context_disclosure_status_projection',
    'draft_checkpoint_status_projection',
    'review_state_projection',
    'check_run_outcome_projection',
    'agent_activity_projection',
  ]);
  if (
    valueAt(value, 'stream_version') !== BUILDER_TASK_STREAM_READ_RESULT_VERSION
    || valueAt(value, 'project_id') !== expectedProjectId
  ) fail();
  const conversation = valueAt(value, 'conversation');
  if (conversation === null) return null;
  exactObject(conversation, [
    'conversation_id',
    'created_at_ms',
    'head_sequence',
    'recorded_active_turn_id',
    'window',
    'items',
  ]);
  safeConversationId(valueAt(conversation, 'conversation_id'), expectedProjectId);
  return conversation;
}

function taskStreamItemsForSubmitContext(value, expectedProjectId) {
  const conversation = taskStreamConversationForSubmitContext(value, expectedProjectId);
  if (conversation === null) return [];
  return denseTaskStreamItems(valueAt(conversation, 'items'));
}

function conversationIdInTaskStream(value, expectedProjectId) {
  try {
    const conversation = taskStreamConversationForSubmitContext(value, expectedProjectId);
    return conversation === null
      ? null
      : safeConversationId(valueAt(conversation, 'conversation_id'), expectedProjectId);
  } catch {
    return null;
  }
}

function messageTextFromTaskStreamItem(item, key) {
  const message = optionalValueAt(item, key);
  const text = optionalValueAt(message, 'text');
  return typeof text === 'string' ? text : null;
}

function taskStreamRunKey(item) {
  const turnId = optionalValueAt(item, 'turn_id');
  const runId = optionalValueAt(item, 'run_id');
  return typeof turnId === 'string' && typeof runId === 'string' ? `${turnId}:${runId}` : null;
}

function contextualBuildContextStateInTaskStream(value, expectedProjectId) {
  try {
    const items = taskStreamItemsForSubmitContext(value, expectedProjectId);
    let latestBuildContext = 'unknown';
    const planTextsByRun = new Map();
    for (const item of items) {
      const itemKind = optionalValueAt(item, 'item_kind');
      if (itemKind === 'task_brief_updated') {
        const brief = optionalValueAt(item, 'brief');
        latestBuildContext = optionalValueAt(brief, 'contextual_build_ready') === true
          ? 'ready'
          : 'blocked';
        continue;
      }
      if (itemKind === 'run_completed') {
        const resultKind = optionalValueAt(item, 'result_kind');
        const text = messageTextFromTaskStreamItem(item, 'assistant_message');
        const runKey = taskStreamRunKey(item);
        if (resultKind === 'candidate' && optionalValueAt(item, 'candidate') !== null) {
          latestBuildContext = 'ready';
          continue;
        }
        if (resultKind === 'plan') {
          if (runKey !== null && text !== null) {
            planTextsByRun.set(runKey, text);
            latestBuildContext = 'blocked';
          }
          continue;
        }
        continue;
      }
      if (itemKind === 'plan_reviewed') {
        const runKey = taskStreamRunKey(item);
        const decision = optionalValueAt(item, 'decision');
        if (
          runKey !== null
          && planTextsByRun.has(runKey)
          && (decision === 'approved' || decision === 'rejected')
        ) {
          latestBuildContext = decision === 'approved' ? 'ready' : 'blocked';
        }
      }
    }
    return latestBuildContext;
  } catch {
    return 'blocked';
  }
}

function hasContextualBuildContextInTaskStream(value, expectedProjectId) {
  return contextualBuildContextStateInTaskStream(value, expectedProjectId) === 'ready';
}

function hasPendingBuildConfirmationInTaskStream(value, expectedProjectId) {
  try {
    const items = taskStreamItemsForSubmitContext(value, expectedProjectId);
    if (!hasContextualBuildContextInTaskStream(value, expectedProjectId)) return false;
    let latestUserSequence = 0;
    let latestProposalSequence = 0;
    for (const item of items) {
      const itemKind = optionalValueAt(item, 'item_kind');
      if (itemKind === 'user_message' && optionalValueAt(item, 'message_kind') === 'submitted') {
        const sequence = optionalValueAt(item, 'sequence');
        if (typeof sequence === 'number') latestUserSequence = sequence;
        latestProposalSequence = 0;
        continue;
      }
      if (itemKind !== 'run_completed') continue;
      if (
        optionalValueAt(item, 'terminal_status') !== 'succeeded'
        || optionalValueAt(item, 'result_kind') !== 'explanation'
      ) continue;
      const sequence = optionalValueAt(item, 'sequence');
      const text = messageTextFromTaskStreamItem(item, 'assistant_message');
      if (
        typeof sequence === 'number'
        && sequence > latestUserSequence
        && text !== null
        && PENDING_BUILD_CONFIRMATION_INTENT_PATTERN.test(normalizedIntentText(text))
      ) {
        latestProposalSequence = sequence;
      }
    }
    return latestProposalSequence > latestUserSequence;
  } catch {
    return false;
  }
}

function routeContextForSubmitInstruction(instruction) {
  const text = normalizedIntentText(instruction);
  return Object.freeze({
    has_contextual_build_context:
      isContextualSubmitContextIntent(instruction)
      || matchesAny(SHORT_BUILD_CONFIRMATION_INTENT_PATTERNS, text),
    has_pending_build_confirmation: matchesAny(SHORT_BUILD_CONFIRMATION_INTENT_PATTERNS, text),
  });
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function exactObjectWithOptional(value, requiredKeys, optionalKeys) {
  if (!isPlainObject(value)) fail();
  const allowedKeys = [...requiredKeys, ...optionalKeys];
  const actual = Reflect.ownKeys(value);
  if (
    actual.length < requiredKeys.length
    || actual.length > allowedKeys.length
    || requiredKeys.some((key) => !actual.includes(key))
    || actual.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
  ) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function ownMethod(value, key) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
  ) fail();
  return descriptor.value;
}

function optionalValueAt(value, key) {
  if (!isPlainObject(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    return undefined;
  }
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function hasForbiddenControl(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0x7f
      || (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d)
    ) return true;
  }
  return false;
}

function safeText(value, maximumCodePoints, maximumBytes) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > maximumCodePoints * 2
    || hasUnpairedSurrogate(value)
    || Array.from(value).length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || hasForbiddenControl(value)
  ) fail();
  return value;
}

function hasControlCharacters(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safeUuid(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) fail();
  return value;
}

function safeConversationId(value) {
  if (typeof value !== 'string' || !CONVERSATION_ID_PATTERN.test(value)) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) fail();
  return value;
}

function safeHead(value) {
  exactObject(value, ['sequence', 'event_id', 'event_digest']);
  const sequence = valueAt(value, 'sequence');
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 1_024) fail();
  return freezeDeep({
    sequence,
    event_id: safePattern(valueAt(value, 'event_id'), EVENT_ID_PATTERN, 96),
    event_digest: safeDigest(valueAt(value, 'event_digest')),
  });
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeMessageId(value) {
  return safePattern(value, MESSAGE_ID_PATTERN, 80);
}

function sanitizeQueuedFollowupReference(value) {
  exactObject(value, ['turn_id', 'run_id', 'message_id']);
  return freezeDeep({
    turn_id: safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN, 80),
    run_id: safePattern(valueAt(value, 'run_id'), RUN_ID_PATTERN, 80),
    message_id: safeMessageId(valueAt(value, 'message_id')),
  });
}

function queuedFollowupReferenceFromEvent(event) {
  if (event.event_type !== 'turn_followup_queued') fail();
  const payload = valueAt(event, 'payload');
  const message = valueAt(payload, 'message');
  return freezeDeep({
    turn_id: safePattern(valueAt(payload, 'turn_id'), TURN_ID_PATTERN, 80),
    run_id: safePattern(valueAt(payload, 'run_id'), RUN_ID_PATTERN, 80),
    message_id: safeMessageId(valueAt(message, 'message_id')),
  });
}

function sanitizeQueuedFollowupTurnRequest(value) {
  exactObject(value, ['request', 'queued_followup']);
  return freezeDeep({
    request: sanitizeBuilderGenerationRequest(valueAt(value, 'request')),
    queued_followup: sanitizeQueuedFollowupReference(valueAt(value, 'queued_followup')),
  });
}

function safeLiveDisplayText(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || hasUnpairedSurrogate(value)
    || Buffer.byteLength(value, 'utf8') > MAX_LIVE_DISPLAY_TEXT_BYTES
    || CREDENTIAL_PATTERN.test(value)
    || LOCAL_PATH_PATTERN.test(value)
  ) return null;
  return value;
}

function appendProviderOutputBuffer(state, deltaText) {
  if (
    typeof deltaText !== 'string'
    || deltaText.length === 0
    || hasUnpairedSurrogate(deltaText)
  ) return null;
  const nextBytes = Buffer.byteLength(deltaText, 'utf8');
  if (state.buffer_bytes + nextBytes > MAX_LIVE_OUTPUT_BUFFER_BYTES) return null;
  state.buffer_text += deltaText;
  state.buffer_bytes += nextBytes;
  return state.buffer_text;
}

function structuredProviderOutputLiveDisplayText(value) {
  const text = value.trim();
  if (!text.startsWith('{')) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isPlainObject(parsed)
    || typeof parsed.kind !== 'string'
    || !parsed.kind.startsWith('builder_')
  ) return undefined;
  if (
    parsed.kind === BUILDER_GENERATED_EXPLANATION_KIND
    && typeof parsed.explanation === 'string'
  ) return safeLiveDisplayText(parsed.explanation);
  return null;
}

function discardProviderOutputBuffer(state, textDigest, textBytes) {
  if (
    typeof textDigest !== 'string'
    || !DIGEST_PATTERN.test(textDigest)
    || !Number.isSafeInteger(textBytes)
    || textBytes <= 0
    || textBytes > state.buffer_bytes
  ) return null;
  const buffer = Buffer.from(state.buffer_text, 'utf8');
  const retainBytes = buffer.byteLength - textBytes;
  const discarded = buffer.subarray(retainBytes);
  const discardedDigest = `sha256:${nodeCrypto.createHash('sha256').update(discarded).digest('hex')}`;
  if (discardedDigest !== textDigest) return null;
  const retained = buffer.subarray(0, retainBytes).toString('utf8');
  if (Buffer.byteLength(retained, 'utf8') !== retainBytes) return null;
  state.buffer_text = retained;
  state.buffer_bytes = retainBytes;
  return retainBytes;
}

function safeOid(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !OID_PATTERN.test(value)) fail();
  return value;
}

function safeDraftId(value) {
  if (typeof value !== 'string' || !DRAFT_ID_PATTERN.test(value)) fail();
  return value;
}

function sanitizeApprovedPlanEditRequest(value) {
  exactObject(value, ['project_id', 'conversation_id', 'turn_id', 'run_id']);
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  return freezeDeep({
    project_id: projectId,
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    turn_id: safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN, 80),
    run_id: safePattern(valueAt(value, 'run_id'), RUN_ID_PATTERN, 80),
  });
}

function safeApprovedPlanPublicText(value) {
  const text = safeText(
    value,
    MAX_APPROVED_PLAN_PUBLIC_TEXT_CODE_POINTS,
    MAX_APPROVED_PLAN_PUBLIC_TEXT_BYTES,
  );
  const normalized = text.normalize('NFKC');
  if (
    LOCAL_PATH_PATTERN.test(normalized)
    || SOURCE_PATH_PATTERN.test(normalized)
    || PROJECT_RESOURCE_PATTERN.test(normalized)
    || CREDENTIAL_PATTERN.test(normalized)
  ) fail();
  return text;
}

function safeResourceIds(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 8) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const seen = new Set();
  const resourceIds = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const resourceId = safePattern(descriptor.value, RESOURCE_ID_PATTERN, 128);
    const segments = resourceId.slice('project:/'.length).split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) fail();
    if (seen.has(resourceId)) fail();
    seen.add(resourceId);
    resourceIds.push(resourceId);
  }
  return freezeDeep(resourceIds);
}

function sanitizeApprovedPlanReadAuthority(value) {
  exactObject(value, APPROVED_PLAN_READ_AUTHORITY_KEYS);
  if (
    valueAt(value, 'conversation') !== 'sqlite_replay_current_head_verified'
    || valueAt(value, 'plan_review') !== 'approved_current_head'
    || valueAt(value, 'renderer_authority') !== 'not_present'
    || valueAt(value, 'provider_dispatch') !== false
    || valueAt(value, 'tool_dispatch') !== 'not_performed'
    || valueAt(value, 'source_mutation') !== 'not_performed'
    || valueAt(value, 'git_authority') !== 'not_present'
    || valueAt(value, 'revision_admission') !== 'not_created'
  ) fail();
  return freezeDeep({
    conversation: 'sqlite_replay_current_head_verified',
    plan_review: 'approved_current_head',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: 'not_performed',
    source_mutation: 'not_performed',
    git_authority: 'not_present',
    revision_admission: 'not_created',
  });
}

function sanitizeApprovedPlanReadResult(value, expected) {
  exactObject(value, APPROVED_PLAN_READ_KEYS);
  if (
    valueAt(value, 'result_version') !== 'builder-conversation-approved-plan-read-result.v1'
    || valueAt(value, 'decision') !== 'approved'
  ) fail();
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const conversationId = safeConversationId(valueAt(value, 'conversation_id'), projectId);
  const turnId = safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN, 80);
  const runId = safePattern(valueAt(value, 'run_id'), RUN_ID_PATTERN, 80);
  if (
    projectId !== expected.project_id
    || conversationId !== expected.conversation_id
    || turnId !== expected.turn_id
    || runId !== expected.run_id
  ) fail();
  return freezeDeep({
    result_version: 'builder-conversation-approved-plan-read-result.v1',
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: turnId,
    task_id: safePattern(valueAt(value, 'task_id'), TASK_ID_PATTERN, 80),
    run_id: runId,
    decision: 'approved',
    plan_result_digest: safeDigest(valueAt(value, 'plan_result_digest')),
    approved_plan_public_text: safeApprovedPlanPublicText(valueAt(value, 'approved_plan_public_text')),
    conversation_head: safeHead(valueAt(value, 'conversation_head')),
    authority: sanitizeApprovedPlanReadAuthority(valueAt(value, 'authority')),
  });
}

function sanitizeOptions(value) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length < 3
    || keys.length > OPTION_KEYS.length
    || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    || !keys.includes('providerConfigRepository')
    || !keys.includes('projectReadAuthority')
    || !keys.includes('conversationService')
    || !keys.includes('gitAuthority')
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  if (keys.includes('transport') && typeof descriptors.transport.value !== 'function') fail();
  if (keys.includes('onGenerationStarted') && typeof descriptors.onGenerationStarted.value !== 'function') fail();
  if (keys.includes('onProviderOutputDelta') && typeof descriptors.onProviderOutputDelta.value !== 'function') fail();
  if (keys.includes('createUuid') && typeof descriptors.createUuid.value !== 'function') fail();
  if (keys.includes('sourceContextCollector') && !isPlainObject(descriptors.sourceContextCollector.value)) fail();
  if (
    keys.includes('agentConversationService')
    && !isPlainObject(descriptors.agentConversationService.value)
  ) fail();
  if (keys.includes('workspaceReadAuthority') && !isPlainObject(descriptors.workspaceReadAuthority.value)) fail();
  if (keys.includes('currentProjection') && !isPlainObject(descriptors.currentProjection.value)) fail();
  if (keys.includes('projectUnderstandingService') && !isPlainObject(descriptors.projectUnderstandingService.value)) {
    fail();
  }
  if (keys.includes('taskCapsuleStore') && !isPlainObject(descriptors.taskCapsuleStore.value)) {
    fail();
  }
  if (keys.includes('taskCapsuleRecordingService') && !isPlainObject(descriptors.taskCapsuleRecordingService.value)) {
    fail();
  }
  if (
    keys.includes('sessionTaskTargetService')
    && !isPlainObject(descriptors.sessionTaskTargetService.value)
  ) {
    fail();
  }
  if (
    keys.includes('sessionTaskAddressRecordingService')
    && !isPlainObject(descriptors.sessionTaskAddressRecordingService.value)
  ) {
    fail();
  }
  if (
    keys.includes('sessionTaskAddressBindingService')
    && !isPlainObject(descriptors.sessionTaskAddressBindingService.value)
  ) {
    fail();
  }
  if (
    keys.includes('automaticDraftCheckpointService')
    && !isPlainObject(descriptors.automaticDraftCheckpointService.value)
  ) {
    fail();
  }
  if (
    keys.includes('codingLoopCheckCoordinator')
    && !isPlainObject(descriptors.codingLoopCheckCoordinator.value)
  ) {
    fail();
  }
  if (
    keys.includes('workingContextStateService')
    && !isPlainObject(descriptors.workingContextStateService.value)
  ) {
    fail();
  }
  if (
    keys.includes('providerContextDisclosureDecisionService')
    && !isPlainObject(descriptors.providerContextDisclosureDecisionService.value)
  ) {
    fail();
  }
  if (
    keys.includes('providerContextDisclosureStatusService')
    && !isPlainObject(descriptors.providerContextDisclosureStatusService.value)
  ) {
    fail();
  }
  if (
    keys.includes('runtimeWorkspaceSnapshotService')
    && descriptors.runtimeWorkspaceSnapshotService.value !== null
    && !isPlainObject(descriptors.runtimeWorkspaceSnapshotService.value)
  ) fail();
  if (
    keys.includes('harnessRuntimeComposition')
    && descriptors.harnessRuntimeComposition.value !== null
    && !isPlainObject(descriptors.harnessRuntimeComposition.value)
  ) fail();
  if (
    keys.includes('programmingRuntimeFeatureFlag')
    && !['disabled', 'shadow', 'enabled'].includes(descriptors.programmingRuntimeFeatureFlag.value)
  ) fail();
  return Object.freeze({
    providerConfigRepository: descriptors.providerConfigRepository.value,
    projectReadAuthority: descriptors.projectReadAuthority.value,
    ...(keys.includes('workspaceReadAuthority')
      ? { workspaceReadAuthority: descriptors.workspaceReadAuthority.value }
      : {}),
    ...(keys.includes('projectUnderstandingService')
      ? { projectUnderstandingService: descriptors.projectUnderstandingService.value }
      : {}),
    projectIdentityAuthority: keys.includes('projectIdentityAuthority')
      ? descriptors.projectIdentityAuthority.value
      : null,
    conversationService: descriptors.conversationService.value,
    ...(keys.includes('agentConversationService')
      ? { agentConversationService: descriptors.agentConversationService.value }
      : {}),
    gitAuthority: descriptors.gitAuthority.value,
    ...(keys.includes('currentProjection')
      ? { currentProjection: descriptors.currentProjection.value }
      : {}),
    ...(keys.includes('transport') ? { transport: descriptors.transport.value } : {}),
    ...(keys.includes('onGenerationStarted') ? { onGenerationStarted: descriptors.onGenerationStarted.value } : {}),
    ...(keys.includes('onProviderOutputDelta') ? { onProviderOutputDelta: descriptors.onProviderOutputDelta.value } : {}),
    ...(keys.includes('sourceContextCollector') ? { sourceContextCollector: descriptors.sourceContextCollector.value } : {}),
    ...(keys.includes('taskCapsuleStore') ? { taskCapsuleStore: descriptors.taskCapsuleStore.value } : {}),
    ...(keys.includes('taskCapsuleRecordingService')
      ? { taskCapsuleRecordingService: descriptors.taskCapsuleRecordingService.value }
      : {}),
    ...(keys.includes('sessionTaskTargetService')
      ? { sessionTaskTargetService: descriptors.sessionTaskTargetService.value }
      : {}),
    ...(keys.includes('sessionTaskAddressRecordingService')
      ? { sessionTaskAddressRecordingService: descriptors.sessionTaskAddressRecordingService.value }
      : {}),
    ...(keys.includes('sessionTaskAddressBindingService')
      ? { sessionTaskAddressBindingService: descriptors.sessionTaskAddressBindingService.value }
      : {}),
    ...(keys.includes('automaticDraftCheckpointService')
      ? { automaticDraftCheckpointService: descriptors.automaticDraftCheckpointService.value }
      : {}),
    ...(keys.includes('codingLoopCheckCoordinator')
      ? { codingLoopCheckCoordinator: descriptors.codingLoopCheckCoordinator.value }
      : {}),
    ...(keys.includes('workingContextStateService')
      ? { workingContextStateService: descriptors.workingContextStateService.value }
      : {}),
    ...(keys.includes('providerContextDisclosureDecisionService')
      ? { providerContextDisclosureDecisionService: descriptors.providerContextDisclosureDecisionService.value }
      : {}),
    ...(keys.includes('providerContextDisclosureStatusService')
      ? { providerContextDisclosureStatusService: descriptors.providerContextDisclosureStatusService.value }
      : {}),
    runtimeWorkspaceSnapshotService: keys.includes('runtimeWorkspaceSnapshotService')
      ? descriptors.runtimeWorkspaceSnapshotService.value
      : null,
    harnessRuntimeComposition: keys.includes('harnessRuntimeComposition')
      ? descriptors.harnessRuntimeComposition.value
      : null,
    programmingRuntimeFeatureFlag: keys.includes('programmingRuntimeFeatureFlag')
      ? descriptors.programmingRuntimeFeatureFlag.value
      : 'disabled',
    createUuid: keys.includes('createUuid') ? descriptors.createUuid.value : nodeCrypto.randomUUID,
  });
}

function sanitizeBoundAuthority(value) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2
    || keys.some((key) => typeof key !== 'string' || !['readProviderConfig', 'resolveSecret'].includes(key))
  ) fail();
  return Object.freeze({
    receiver: value,
    readProviderConfig: ownMethod(value, 'readProviderConfig'),
    resolveSecret: ownMethod(value, 'resolveSecret'),
  });
}

function newId(createUuid, prefix) {
  return `${prefix}:${safeUuid(Reflect.apply(createUuid, undefined, []))}`;
}

function sanitizeReadResult(value, expectedProjectId, expectedOperation = 'current_loaded') {
  exactObject(value, [
    'result_version',
    'operation',
    'product_revision_receipt',
    'current',
    'source_tree',
    'git_candidate_receipt',
    'git_verification_receipt',
    'authority_evidence',
  ]);
  if (
    valueAt(value, 'result_version') !== 'builder-project-read-result.v1'
    || valueAt(value, 'operation') !== expectedOperation
  ) fail();
  const receipt = valueAt(value, 'product_revision_receipt');
  if (!isPlainObject(receipt)) fail();
  const projectId = safeProjectId(valueAt(receipt, 'project_id'));
  if (projectId !== expectedProjectId) fail();
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree'));
  const resultingTreeDigest = safeDigest(valueAt(receipt, 'resulting_tree_digest'));
  if (sourceTree.source_tree_digest !== resultingTreeDigest) fail();
  return freezeDeep({
    base_revision: {
      revision_receipt_digest: safeDigest(valueAt(receipt, 'revision_receipt_digest')),
      commit_oid: safeOid(valueAt(receipt, 'commit_oid')),
    },
    base_revision_evidence: {
      evidence_version: 'builder-project-base-revision-evidence.v2',
      project_id: expectedProjectId,
      revision_receipt_digest: safeDigest(valueAt(receipt, 'revision_receipt_digest')),
      commit_oid: safeOid(valueAt(receipt, 'commit_oid')),
      source_tree_digest: sourceTree.source_tree_digest,
      verification_admission: 'git_sqlite_read_authority_verified',
    },
    source_tree: sourceTree,
  });
}

function sanitizeLocalWorkspaceReadResult(value, expectedProjectId) {
  exactObject(value, [
    'result_version',
    'operation',
    'project_id',
    'source_tree',
    'authority_evidence',
  ]);
  if (
    valueAt(value, 'result_version') !== 'builder-project-local-workspace-read-result.v1'
    || valueAt(value, 'operation') !== 'local_workspace_loaded'
    || safeProjectId(valueAt(value, 'project_id')) !== expectedProjectId
  ) fail();
  return freezeDeep({
    base_revision: null,
    base_revision_evidence: null,
    source_tree: sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree')),
  });
}

function sanitizeCurrentOrLocalWorkspaceReadResult(value, expectedProjectId) {
  if (isPlainObject(value)) {
    const resultVersion = Object.getOwnPropertyDescriptor(value, 'result_version');
    if (
      resultVersion
      && Object.hasOwn(resultVersion, 'value')
      && resultVersion.value === 'builder-project-local-workspace-read-result.v1'
    ) {
      return sanitizeLocalWorkspaceReadResult(value, expectedProjectId);
    }
  }
  return sanitizeReadResult(value, expectedProjectId);
}

function sanitizeProjectUnderstandingRecord(value, expectedProjectId, expectedSourceTreeDigest) {
  exactObject(value, PROJECT_UNDERSTANDING_RECORD_KEYS);
  const snapshotDigest = safePattern(
    valueAt(value, 'snapshot_digest'),
    PROJECT_UNDERSTANDING_SNAPSHOT_DIGEST_PATTERN,
    103,
  );
  const snapshot = sanitizeBuilderProjectUnderstandingSnapshot(
    valueAt(value, 'project_understanding_snapshot'),
  );
  if (
    snapshot.project_id !== expectedProjectId
    || snapshot.source_tree_digest !== expectedSourceTreeDigest
    || builderProjectUnderstandingSnapshotDigest(snapshot) !== snapshotDigest
  ) fail();
  return freezeDeep({
    snapshot_digest: snapshotDigest,
    project_understanding_snapshot: snapshot,
  });
}

function sanitizeProjectUnderstandingRefreshResult(value, expectedProjectId, expectedSourceTreeDigest) {
  exactObject(value, PROJECT_UNDERSTANDING_REFRESH_RESULT_KEYS);
  if (
    valueAt(value, 'result_version') !== 'builder-project-understanding-service-result.v1'
    || valueAt(value, 'service_version') !== 'builder-project-understanding-service.v1'
    || !['project_understanding_refreshed', 'project_understanding_refresh_replayed']
      .includes(valueAt(value, 'operation'))
    || valueAt(value, 'status') !== 'ready'
    || safeProjectId(valueAt(value, 'project_id')) !== expectedProjectId
    || !isPlainObject(valueAt(value, 'evidence'))
  ) fail();
  const recorded = sanitizeProjectUnderstandingRecord(
    valueAt(value, 'project_understanding'),
    expectedProjectId,
    expectedSourceTreeDigest,
  );
  const latest = valueAt(value, 'latest_project_understanding_read');
  exactObject(latest, ['result_version', 'operation', 'project_understanding', 'store_evidence']);
  if (
    valueAt(latest, 'result_version') !== 'builder-project-understanding-store-read-result.v1'
    || valueAt(latest, 'operation') !== 'project_understanding_latest_ready_read'
    || !isPlainObject(valueAt(latest, 'store_evidence'))
  ) fail();
  const latestRecord = sanitizeProjectUnderstandingRecord(
    valueAt(latest, 'project_understanding'),
    expectedProjectId,
    expectedSourceTreeDigest,
  );
  if (latestRecord.snapshot_digest !== recorded.snapshot_digest) fail();
  return recorded;
}

function sanitizeRestoreRevisionRequest(value) {
  exactObject(value, RESTORE_REVISION_REQUEST_KEYS);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
  });
}

function sourceTreePathKey(value) {
  return value.normalize('NFKC').toUpperCase();
}

function operationsToReachSourceTree(baseSourceTree, targetSourceTree) {
  const targetFilesByKey = new Map(
    targetSourceTree.files.map((file) => [sourceTreePathKey(file.path), file]),
  );
  const baseFilesByKey = new Map(
    baseSourceTree.files.map((file) => [sourceTreePathKey(file.path), file]),
  );
  const operations = [];
  for (const file of baseSourceTree.files) {
    if (!targetFilesByKey.has(sourceTreePathKey(file.path))) {
      operations.push({ operation: 'delete', path: file.path, content: null });
    }
  }
  for (const file of targetSourceTree.files) {
    const base = baseFilesByKey.get(sourceTreePathKey(file.path));
    if (
      base === undefined
      || base.path !== file.path
      || base.content_digest !== file.content_digest
    ) {
      operations.push({ operation: 'upsert', path: file.path, content: file.content });
    }
  }
  operations.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (operations.length === 0) fail();
  return freezeDeep(operations);
}

function emptyBaseForBoundProject(value, expectedProjectId) {
  exactObject(value, ['result_version', 'operation', 'project', 'metadata_evidence']);
  if (
    valueAt(value, 'result_version') !== 'builder-product-metadata-result.v4'
    || valueAt(value, 'operation') !== 'project_identity_loaded'
  ) fail();
  const project = valueAt(value, 'project');
  exactObject(project, [
    'project_id',
    'created_at_ms',
    'current_revision_receipt_digest',
    'current_revision_number',
  ]);
  if (
    valueAt(project, 'project_id') !== expectedProjectId
    || valueAt(project, 'current_revision_receipt_digest') !== null
    || valueAt(project, 'current_revision_number') !== 0
  ) fail();
  return freezeDeep({
    base_revision: null,
    base_revision_evidence: null,
    source_tree: createBuilderProjectSourceTree({ files: [] }),
  });
}

async function loadBaseForExistingProject(
  projectId,
  loadCurrentProject,
  loadProjectIdentity,
  loadFreshWorkspace,
  projectReadAuthority,
  projectIdentityAuthority,
  workspaceReadAuthority,
) {
  try {
    return sanitizeCurrentOrLocalWorkspaceReadResult(
      await Reflect.apply(loadCurrentProject, projectReadAuthority, [{ project_id: projectId }]),
      projectId,
    );
  } catch {
    if (workspaceReadAuthority !== undefined && loadFreshWorkspace !== null) {
      try {
        return sanitizeLocalWorkspaceReadResult(
          await Reflect.apply(loadFreshWorkspace, workspaceReadAuthority, [{ project_id: projectId }]),
          projectId,
        );
      } catch {
        // Fall through to the bound empty-project identity path below.
      }
    }
    if (projectIdentityAuthority === null || loadProjectIdentity === null) fail();
    return emptyBaseForBoundProject(
      await Reflect.apply(loadProjectIdentity, projectIdentityAuthority, [{ project_id: projectId }]),
      projectId,
    );
  }
}

function publicSourceTree(sourceTree) {
  return freezeDeep({
    source_tree_version: sourceTree.source_tree_version,
    source_tree_digest: sourceTree.source_tree_digest,
    files: sourceTree.files.map((file) => ({
      path: file.path,
      entry_kind: file.entry_kind,
      content: file.content,
      content_digest: file.content_digest,
    })),
  });
}

function candidateProofFromCandidate(candidate) {
  const baseRevision = candidate.run_binding.base_revision;
  return freezeDeep({
    proof_version: 'builder-generation-pending-candidate-proof.v1',
    project_id: candidate.project_id,
    conversation_id: candidate.conversation_id,
    turn_id: candidate.turn_id,
    task_id: candidate.task_id,
    run_id: candidate.run_id,
    request_digest: candidate.request_digest,
    git_request_id: null,
    candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest,
    resulting_tree_digest: candidate.resulting_tree_digest,
    expected_base_oid: candidate.base_revision_evidence === null
      ? null
      : candidate.base_revision_evidence.commit_oid,
    base_revision: baseRevision === null ? null : { ...baseRevision },
  });
}

function baseRevisionRefFromCandidate(candidate) {
  const baseRevision = candidate.run_binding.base_revision;
  return baseRevision === null
    ? freezeDeep({ revision_receipt_digest: null, commit_oid: null })
    : freezeDeep({
      revision_receipt_digest: baseRevision.revision_receipt_digest,
      commit_oid: baseRevision.commit_oid,
    });
}

function sanitizeConversationDraft(value, expectedDraftId) {
  exactObject(value, [
    'result_version',
    'draft_id',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    'candidate_digest',
    'base_revision',
    'conversation_head',
    'candidate_result',
    'verification_admission',
  ]);
  const candidateResult = exactObjectWithOptional(valueAt(value, 'candidate_result'), [
    'draft_id', 'title', 'summary', 'git_candidate_receipt',
  ], ['current_materialization']);
  const receipt = sanitizeBuilderGitCandidateReceipt(
    valueAt(candidateResult, 'git_candidate_receipt'),
  );
  const currentMaterialization = Object.hasOwn(candidateResult, 'current_materialization')
    ? sanitizeDraftCurrentMaterialization(valueAt(candidateResult, 'current_materialization'))
    : freezeDeep({
      status: 'not_attempted',
      reason: 'legacy_pending_draft',
    });
  const conversationHead = valueAt(value, 'conversation_head');
  exactObject(conversationHead, ['sequence', 'event_id', 'event_digest']);
  const sequence = valueAt(conversationHead, 'sequence');
  if (
    valueAt(value, 'result_version') !== 'builder-conversation-candidate-draft-read-result.v1'
    || valueAt(value, 'draft_id') !== expectedDraftId
    || valueAt(candidateResult, 'draft_id') !== expectedDraftId
    || valueAt(value, 'verification_admission') !== 'sqlite_replay_verified'
    || valueAt(value, 'project_id') !== receipt.project_id
    || valueAt(value, 'conversation_id') !== receipt.conversation_id
    || valueAt(value, 'turn_id') !== receipt.turn_id
    || valueAt(value, 'task_id') !== receipt.task_id
    || valueAt(value, 'run_id') !== receipt.run_id
    || valueAt(value, 'candidate_digest') !== receipt.candidate_digest
    || !Number.isSafeInteger(sequence)
    || sequence < 1
    || sequence > 1_024
  ) fail();
  const baseRevision = valueAt(value, 'base_revision');
  if (baseRevision !== null) {
    exactObject(baseRevision, ['revision_receipt_digest', 'commit_oid']);
  }
  return freezeDeep({
    draft_id: expectedDraftId,
    title: valueAt(candidateResult, 'title'),
    summary: valueAt(candidateResult, 'summary'),
    conversation_head: {
      sequence,
      event_id: safePattern(valueAt(conversationHead, 'event_id'), /^builder-conversation-event:[0-9a-f]{64}$/u, 96),
      event_digest: safeDigest(valueAt(conversationHead, 'event_digest')),
    },
    git_candidate_receipt: receipt,
    current_materialization: currentMaterialization,
    candidate_proof: {
      proof_version: 'builder-generation-pending-candidate-proof.v1',
      project_id: receipt.project_id,
      conversation_id: receipt.conversation_id,
      turn_id: receipt.turn_id,
      task_id: receipt.task_id,
      run_id: receipt.run_id,
      request_digest: null,
      git_request_id: receipt.request_id,
      candidate_id: receipt.candidate_id,
      candidate_digest: receipt.candidate_digest,
      resulting_tree_digest: receipt.resulting_tree_digest,
      expected_base_oid: receipt.expected_base_oid,
      base_revision: baseRevision === null
        ? null
        : {
          revision_receipt_digest: safeDigest(valueAt(baseRevision, 'revision_receipt_digest')),
          commit_oid: safeOid(valueAt(baseRevision, 'commit_oid')),
        },
    },
  });
}

function sanitizeVerifiedCandidateRead(value, expectedReceipt) {
  exactObject(value, [
    'result_version',
    'candidate_receipt',
    'verification_receipt',
    'source_tree',
    'code_authority',
    'read_admission',
  ]);
  const pair = sanitizeBuilderGitCandidateReceiptPair(
    valueAt(value, 'candidate_receipt'),
    valueAt(value, 'verification_receipt'),
  );
  const receipt = pair.candidate_receipt;
  if (
    valueAt(value, 'result_version') !== 'builder-git-verified-candidate-read-result.v1'
    || valueAt(value, 'code_authority') !== 'git_commit_tree'
    || valueAt(value, 'read_admission') !== 'verified'
    || canonicalJson(receipt) !== canonicalJson(expectedReceipt)
  ) fail();
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree'));
  if (sourceTree.source_tree_digest !== receipt.resulting_tree_digest) fail();
  return freezeDeep({ receipt, source_tree: sourceTree });
}

function sanitizeVerifiedCandidateBaseRead(value, expectedReceipt) {
  exactObject(value, [
    'result_version',
    'candidate_receipt',
    'verification_receipt',
    'source_tree',
    'base_source_tree_digest',
    'code_authority',
    'read_admission',
  ]);
  const pair = sanitizeBuilderGitCandidateReceiptPair(
    valueAt(value, 'candidate_receipt'),
    valueAt(value, 'verification_receipt'),
  );
  const receipt = pair.candidate_receipt;
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree'));
  if (
    valueAt(value, 'result_version')
      !== 'builder-git-verified-candidate-base-read-result.v1'
    || valueAt(value, 'code_authority') !== 'git_candidate_base_tree'
    || valueAt(value, 'read_admission') !== 'verified'
    || canonicalJson(receipt) !== canonicalJson(expectedReceipt)
    || safeDigest(valueAt(value, 'base_source_tree_digest'))
      !== sourceTree.source_tree_digest
  ) fail();
  return freezeDeep({ receipt, source_tree: sourceTree });
}

function sanitizeCandidateWorkspaceBaseRead(value, expectedReceipt) {
  exactObject(value, [
    'result_version',
    'project_id',
    'candidate_id',
    'candidate_digest',
    'base_source_tree_digest',
    'read_admission',
  ]);
  const baseSourceTreeDigest = safeDigest(valueAt(value, 'base_source_tree_digest'));
  if (
    valueAt(value, 'result_version') !== 'builder-git-candidate-workspace-base.v1'
    || valueAt(value, 'project_id') !== expectedReceipt.project_id
    || valueAt(value, 'candidate_id') !== expectedReceipt.candidate_id
    || valueAt(value, 'candidate_digest') !== expectedReceipt.candidate_digest
    || valueAt(value, 'read_admission') !== 'verified_git_candidate_commit_trailer'
  ) fail();
  return freezeDeep({ base_source_tree_digest: baseSourceTreeDigest });
}

function sanitizeDraftCurrentMaterialization(value) {
  if (!isPlainObject(value)) fail();
  const status = valueAt(value, 'status');
  if (status === 'materialized') {
    exactObject(value, ['status']);
    return freezeDeep({ status });
  }
  if (status === 'not_materialized' || status === 'not_attempted') {
    exactObject(value, ['status', 'reason']);
    const reason = valueAt(value, 'reason');
    if (
      (status === 'not_materialized' && reason !== 'current_projection_unavailable')
      || (status === 'not_attempted' && reason !== 'current_projection_not_configured')
    ) fail();
    return freezeDeep({ status, reason });
  }
  fail();
}

function publicDraftResult(draft) {
  const candidate = draft.candidate;
  return freezeDeep({
    version: draft.version,
    request_id: draft.request_id,
    draft_id: draft.draft_id,
    title: draft.title,
    summary: draft.summary,
    project_id: candidate.project_id,
    existing_project_id: draft.request.existing_project_id,
    candidate: {
      candidate_version: candidate.candidate_version,
      candidate_id: candidate.candidate_id,
      candidate_digest: candidate.candidate_digest,
      resulting_tree_digest: candidate.resulting_tree_digest,
    },
    base_revision_evidence: candidate.base_revision_evidence === null
      ? null
      : { ...candidate.base_revision_evidence },
    source_tree: publicSourceTree(candidate.resulting_source_tree),
    admissions: { ...draft.admissions },
    restart_restore: 'not_persisted',
  });
}

function publicPlanResult(plan, request, conversationHead) {
  return freezeDeep({
    version: plan.version,
    result_kind: 'plan',
    request_id: request.request_digest,
    project_id: safeProjectId(plan.plan_proposal_record.project_id),
    existing_project_id: request.existing_project_id,
    title: plan.title,
    summary: plan.summary,
    steps: plan.steps.map((step) => ({
      title: safeText(step.title, 360, 1536),
      purpose: safeText(step.purpose, 360, 1536),
      expected_change: safeText(step.expected_change, 360, 1536),
      status: 'proposed',
    })),
    admissions: {
      conversation: 'sqlite_recorded',
      draft: 'not_created',
      save: 'not_performed',
      preview: 'not_applicable',
      execution: 'not_evaluated',
      revision: 'not_created',
      review: 'not_recorded',
    },
    conversation_head: safeHead(conversationHead),
  });
}

function publicRestoredDraftResult(draft, baseRevisionEvidence) {
  const proof = draft.candidate_proof;
  return freezeDeep({
    version: BUILDER_GENERATION_RESULT_PROTOCOL,
    request_id: proof.request_digest,
    draft_id: draft.draft_id,
    title: draft.title,
    summary: draft.summary,
    project_id: proof.project_id,
    existing_project_id: proof.base_revision === null ? null : proof.project_id,
    candidate: {
      candidate_version: 'builder-code-change-candidate.v2',
      candidate_id: proof.candidate_id,
      candidate_digest: proof.candidate_digest,
      resulting_tree_digest: proof.resulting_tree_digest,
    },
    base_revision_evidence: baseRevisionEvidence,
    source_tree: publicSourceTree(draft.source_tree),
    admissions: {
      conversation: 'sqlite_recorded',
      draft: 'candidate_not_saved',
      save: 'not_performed',
      preview: 'not_evaluated',
      execution: 'not_evaluated',
    },
    restart_restore: draft.restart_restore,
  });
}

function pendingDraftResult(draft) {
  return freezeDeep({
    result_version: BUILDER_GENERATION_PENDING_DRAFT_VERSION,
    draft_id: draft.draft_id,
    restart_restore: draft.restart_restore,
    conversation_event_admission: 'sqlite_recorded',
    git_request_id: draft.git_request_id,
    title: draft.title,
    summary: draft.summary,
    conversation_head: draft.conversation_head,
    candidate_proof: draft.candidate_proof,
  });
}

function sanitizeConversationCandidateReject(value, expectedDraftId) {
  exactObject(value, [
    'result_version',
    'draft_id',
    'project_id',
    'conversation_id',
    'rejection_admission',
  ]);
  if (
    valueAt(value, 'result_version') !== 'builder-conversation-candidate-reject-result.v1'
    || valueAt(value, 'draft_id') !== expectedDraftId
    || valueAt(value, 'rejection_admission') !== 'sqlite_recorded'
  ) fail();
  return freezeDeep({
    draft_id: expectedDraftId,
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safePattern(valueAt(value, 'conversation_id'), CONVERSATION_ID_PATTERN, 96),
    rejection_admission: 'sqlite_recorded',
  });
}

function createBuilderGenerationMainService(rawOptions) {
  const options = sanitizeOptions(rawOptions);
  const bindCurrentAuthority = ownMethod(options.providerConfigRepository, 'bind_current_authority');
  const loadCurrentProject = ownMethod(options.projectReadAuthority, 'load_current');
  const loadFreshWorkspace = options.workspaceReadAuthority === undefined
    ? null
    : ownMethod(options.workspaceReadAuthority, 'load_fresh_workspace');
  const loadProjectIdentity = options.projectIdentityAuthority === null
    ? null
    : ownMethod(options.projectIdentityAuthority, 'load_project_identity');
  const beginConversationQuestion = ownMethod(options.conversationService, 'begin_question');
  const beginConversationWork = ownMethod(options.conversationService, 'begin_work');
  const beginQueuedFollowupQuestion = ownMethod(options.conversationService, 'begin_queued_followup_question');
  const beginQueuedFollowupWork = ownMethod(options.conversationService, 'begin_queued_followup_work');
  const completeConversationCandidate = ownMethod(options.conversationService, 'complete_candidate');
  const completeConversationExplanation = ownMethod(options.conversationService, 'complete_explanation');
  const completeConversationWorkResponse = ownMethod(
    options.conversationService,
    'complete_work_response',
  );
  const completeConversationPlan = ownMethod(options.conversationService, 'complete_plan');
  const completeConversationFailure = ownMethod(options.conversationService, 'complete_failure');
  const recordConversationRetryableFailure = ownMethod(options.conversationService, 'record_retryable_failure');
  const recordConversationRunContextSnapshot = ownMethod(
    options.conversationService,
    'record_run_context_snapshot',
  );
  const recordProgrammingRunAdmission = ownMethod(
    options.conversationService,
    'record_programming_run_admission',
  );
  const recordConversationRunProgress = ownMethod(options.conversationService, 'record_run_progress');
  const recordConversationCheckpoint = ownMethod(
    options.conversationService,
    'record_checkpoint',
  );
  const recordConversationRecoveryAction = ownMethod(
    options.conversationService,
    'record_recovery_action',
  );
  const recordConversationProgrammingRuntimeEvent = ownMethod(
    options.conversationService,
    'record_programming_runtime_event',
  );
  const recordConversationProgrammingRuntimeEventsValue = optionalValueAt(
    options.conversationService,
    'record_programming_runtime_events',
  );
  if (
    recordConversationProgrammingRuntimeEventsValue !== undefined
    && typeof recordConversationProgrammingRuntimeEventsValue !== 'function'
  ) fail();
  const recordConversationProgrammingRuntimeEvents =
    recordConversationProgrammingRuntimeEventsValue ?? null;
  const retryConversationFailure = ownMethod(options.conversationService, 'retry_after_failure');
  const beginApprovedPlanWork = ownMethod(options.conversationService, 'begin_approved_plan_work');
  const requestConversationCancel = ownMethod(options.conversationService, 'request_cancel');
  const recordConversationSteering = ownMethod(options.conversationService, 'record_steering');
  const recordConversationQueuedFollowup = ownMethod(options.conversationService, 'record_queued_followup');
  const readConversationCandidateDraft = ownMethod(options.conversationService, 'read_candidate_draft');
  const rejectConversationCandidate = ownMethod(options.conversationService, 'reject_candidate');
  const readApprovedPlan = ownMethod(options.conversationService, 'read_approved_plan');
  const readConversationStream = ownMethod(options.conversationService, 'read_stream');
  const admitApprovedPlanContinuation = ownMethod(
    options.conversationService,
    'admit_approved_plan_continuation',
  );
  const beginDraftContinuationWork = ownMethod(
    options.conversationService,
    'begin_draft_continuation_work',
  );
  const beginAgentConversationQuestion = options.agentConversationService === undefined
    ? null
    : ownMethod(options.agentConversationService, 'begin_question');
  const completeAgentConversationExplanation = options.agentConversationService === undefined
    ? null
    : ownMethod(options.agentConversationService, 'complete_explanation');
  const recordAgentConversationRetryableFailure = options.agentConversationService === undefined
    ? null
    : ownMethod(options.agentConversationService, 'record_retryable_failure');
  const recordAgentConversationRunProgress = options.agentConversationService === undefined
    ? null
    : ownMethod(options.agentConversationService, 'record_run_progress');
  const requestAgentConversationCancel = options.agentConversationService === undefined
    ? null
    : ownMethod(options.agentConversationService, 'request_cancel');
  const recordAgentConversationSteering = options.agentConversationService === undefined
    ? null
    : ownMethod(options.agentConversationService, 'record_steering');
  const recordAgentConversationQueuedFollowup = options.agentConversationService === undefined
    ? null
    : ownMethod(options.agentConversationService, 'record_queued_followup');
  const persistCandidateCommit = ownMethod(options.gitAuthority, 'persist_candidate_commit');
  const verifyCandidateReceipt = ownMethod(options.gitAuthority, 'verify_candidate_receipt');
  const readVerifiedCandidate = ownMethod(options.gitAuthority, 'read_verified_candidate');
  const readVerifiedCandidateBase = ownMethod(
    options.gitAuthority,
    'read_verified_candidate_base',
  );
  const readCandidateWorkspaceBase = options.currentProjection === undefined
    ? null
    : ownMethod(options.gitAuthority, 'read_candidate_workspace_base');
  const projectCurrent = options.currentProjection === undefined
    ? null
    : ownMethod(options.currentProjection, 'project_current');
  const collectProjectSourceContext = options.sourceContextCollector === undefined
    ? null
    : ownMethod(options.sourceContextCollector, 'collect_project_source_context');
  const refreshProjectUnderstanding = options.projectUnderstandingService === undefined
    ? null
    : ownMethod(options.projectUnderstandingService, 'refresh_project_understanding');
  const readLatestTaskCapsule = options.taskCapsuleStore === undefined
    ? null
    : ownMethod(options.taskCapsuleStore, 'read_latest_task_capsule');
  const recordTaskCapsuleFromConversation = options.taskCapsuleRecordingService === undefined
    ? null
    : ownMethod(options.taskCapsuleRecordingService, 'record_task_capsule_from_conversation');
  const resolveSessionTaskTarget = options.sessionTaskTargetService === undefined
    ? null
    : ownMethod(options.sessionTaskTargetService, 'resolve_target');
  const recordSessionTaskAddressesFromConversation = options.sessionTaskAddressRecordingService === undefined
    ? null
    : ownMethod(options.sessionTaskAddressRecordingService, 'record_addresses_from_conversation_context');
  const bindQueuedFollowupWorkToCurrentTaskAddress = options.sessionTaskAddressBindingService === undefined
    ? null
    : ownMethod(options.sessionTaskAddressBindingService, 'bind_queued_followup_work_to_current_task_address');
  const bindApprovedPlanContinuationToCurrentTaskAddress = options.sessionTaskAddressBindingService === undefined
    ? null
    : ownMethod(
      options.sessionTaskAddressBindingService,
      'bind_approved_plan_continuation_to_current_task_address',
    );
  const bindDraftContinuationToCurrentTaskAddress = options.sessionTaskAddressBindingService === undefined
    ? null
    : ownMethod(
      options.sessionTaskAddressBindingService,
      'bind_draft_continuation_to_current_task_address',
    );
  const recordVerifiedCandidateCheckpoint = options.automaticDraftCheckpointService === undefined
    ? null
    : ownMethod(
      options.automaticDraftCheckpointService,
      'record_verified_candidate_checkpoint',
    );
  const preparePreviousCheckpointRestore = options.automaticDraftCheckpointService !== undefined
    && typeof options.automaticDraftCheckpointService.prepare_previous_checkpoint_restore === 'function'
    ? ownMethod(
      options.automaticDraftCheckpointService,
      'prepare_previous_checkpoint_restore',
    )
    : null;
  const runAutomaticCandidateCheck = options.codingLoopCheckCoordinator === undefined
    ? null
    : ownMethod(
      options.codingLoopCheckCoordinator,
      'run_automatic_candidate_check',
    );
  const readCurrentWorkingContextStateForConversation = options.workingContextStateService === undefined
    ? null
    : ownMethod(
      options.workingContextStateService,
      'read_current_working_context_state_for_conversation',
    );
  const decideProviderContextDisclosure = options.providerContextDisclosureDecisionService === undefined
    ? null
    : ownMethod(
      options.providerContextDisclosureDecisionService,
      'decide',
    );
  const recordProviderContextDisclosureStatus = options.providerContextDisclosureStatusService === undefined
    ? null
    : ownMethod(
      options.providerContextDisclosureStatusService,
      'record_current_provider_context_disclosure_status',
    );
  const clearProviderContextDisclosureStatus = options.providerContextDisclosureStatusService === undefined
    ? null
    : ownMethod(
      options.providerContextDisclosureStatusService,
      'clear_current_provider_context_disclosure_status_for_conversation',
    );
  const pendingDrafts = new Map();
  const inFlight = new Map();
  const activeContexts = new Map();
  const retryableContexts = new Map();
  const pendingRetryContexts = new Map();
  const pendingGenerateRouteDecisionHints = new Map();
  const pendingGenerateQueuedFollowups = new Map();

  function recordAutomaticDraftCheckpoint(
    operationKey,
    conversationContext,
    candidate,
    receiptPair,
    summary,
    editAttempt,
  ) {
    if (recordVerifiedCandidateCheckpoint === null) return conversationContext;
    const changedPaths = new Set(candidate.operations.map((operation) => operation.path));
    let checkpoint;
    try {
      checkpoint = Reflect.apply(
        recordVerifiedCandidateCheckpoint,
        options.automaticDraftCheckpointService,
        [{
          candidate_receipt: receiptPair.candidate_receipt,
          candidate_verification: receiptPair.verification_receipt,
          base_revision_ref: baseRevisionRefFromCandidate(candidate),
          summary,
          changed_file_count: changedPaths.size,
          edit_attempt_ref: projectBuilderEditAttemptRef(editAttempt),
        }],
      );
    } catch {
      try {
        const failedContext = Reflect.apply(
          recordConversationCheckpoint,
          options.conversationService,
          [{
            context: conversationContext,
            status: 'failed',
            changed_file_count: changedPaths.size,
            verification_status: 'candidate_verified',
          }],
        );
        activeContexts.set(operationKey, failedContext);
      } catch {
        // The checkpoint store remains authoritative when the derived chat fact cannot be appended.
      }
      fail('builder_generation_service_unavailable');
    }
    const checkpointSequence = valueAt(
      valueAt(valueAt(checkpoint, 'draft_checkpoint'), 'draft_checkpoint'),
      'checkpoint_sequence',
    );
    if (!Number.isSafeInteger(checkpointSequence) || checkpointSequence < 1) {
      fail('builder_generation_service_unavailable');
    }
    const recordedContext = Reflect.apply(
      recordConversationCheckpoint,
      options.conversationService,
      [{
        context: conversationContext,
        status: checkpointSequence === 1 ? 'created' : 'updated',
        changed_file_count: changedPaths.size,
        verification_status: 'candidate_verified',
      }],
    );
    activeContexts.set(operationKey, recordedContext);
    return recordedContext;
  }

  function candidateReceiptFromCheckpoint(checkpoint) {
    const candidateRef = valueAt(checkpoint, 'candidate_ref');
    return sanitizeBuilderGitCandidateReceipt({
      receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
      repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
      project_id: valueAt(checkpoint, 'project_id'),
      conversation_id: valueAt(checkpoint, 'conversation_id'),
      turn_id: valueAt(checkpoint, 'turn_id'),
      task_id: valueAt(checkpoint, 'task_id'),
      run_id: valueAt(checkpoint, 'run_id'),
      request_id: valueAt(checkpoint, 'request_id'),
      candidate_id: valueAt(candidateRef, 'candidate_id'),
      candidate_digest: valueAt(candidateRef, 'candidate_digest'),
      resulting_tree_digest: valueAt(candidateRef, 'resulting_tree_digest'),
      semantic_identity_digest: valueAt(candidateRef, 'semantic_identity_digest'),
      verification_receipt_digest: valueAt(candidateRef, 'verification_receipt_digest'),
      object_format: BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
      commit_oid: valueAt(candidateRef, 'commit_oid'),
      tree_oid: valueAt(candidateRef, 'tree_oid'),
      parent_oid: valueAt(candidateRef, 'parent_oid'),
      expected_base_oid: valueAt(candidateRef, 'parent_oid'),
      code_authority: CODE_AUTHORITY,
      product_revision_admission: PRODUCT_REVISION_ADMISSION,
      replay: false,
    });
  }

  async function coordinateAutomaticCandidateCheck(draftId, candidate, receiptPair) {
    if (runAutomaticCandidateCheck === null) return null;
    try {
      return await Reflect.apply(
        runAutomaticCandidateCheck,
        options.codingLoopCheckCoordinator,
        [{
          draft_id: draftId,
          candidate_receipt: receiptPair.candidate_receipt,
          candidate_verification: receiptPair.verification_receipt,
          source_tree: candidate.resulting_source_tree,
        }],
      );
    } catch (error) {
      recordCanaryGenerationDebug('automatic_candidate_check_unavailable', error);
      return null;
    }
  }

  async function materializeCandidateToCurrentWorkspace(receiptPair, workspaceExpectation = null) {
    if (projectCurrent === null || readCandidateWorkspaceBase === null) {
      return freezeDeep({
        status: 'not_attempted',
        reason: 'current_projection_not_configured',
      });
    }
    try {
      const base = sanitizeCandidateWorkspaceBaseRead(
        await Reflect.apply(
          readCandidateWorkspaceBase,
          options.gitAuthority,
          [receiptPair.candidate_receipt],
        ),
        receiptPair.candidate_receipt,
      );
      const expectedWorkspaceSourceTreeDigest = workspaceExpectation === null
        ? base.base_source_tree_digest
        : safeDigest(workspaceExpectation.expected_workspace_source_tree_digest);
      const projectionMode = workspaceExpectation === null
        ? 'base_cas'
        : workspaceExpectation.projection_mode;
      if (
        !['base_cas', 'sqlite_current_repair'].includes(projectionMode)
        || (
          projectionMode === 'base_cas'
          && expectedWorkspaceSourceTreeDigest !== base.base_source_tree_digest
        )
      ) fail();
      const projection = await Reflect.apply(
        projectCurrent,
        options.currentProjection,
        [{
          candidate_receipt: receiptPair.candidate_receipt,
          expected_workspace_source_tree_digest: expectedWorkspaceSourceTreeDigest,
          projection_mode: projectionMode,
        }],
      );
      return freezeDeep({
        status: 'materialized',
        result_version: valueAt(projection, 'result_version'),
        main_ref: valueAt(projection, 'main_ref'),
        worktree: valueAt(projection, 'worktree'),
        worktree_file_count: valueAt(projection, 'worktree_file_count'),
      });
    } catch (error) {
      recordCanaryGenerationDebug('candidate_current_projection_unavailable', error);
      return freezeDeep({
        status: 'not_materialized',
        reason: 'current_projection_unavailable',
      });
    }
  }

  function conversationCurrentMaterialization(value) {
    if (value.status === 'materialized') return freezeDeep({ status: 'materialized' });
    if (value.status === 'not_materialized') {
      return freezeDeep({
        status: 'not_materialized',
        reason: 'current_projection_unavailable',
      });
    }
    return freezeDeep({
      status: 'not_attempted',
      reason: 'current_projection_not_configured',
    });
  }

  function continuationWorkspaceExpectation(continuationContext, candidate) {
    if (
      continuationContext === null
      || continuationContext.conversation_draft.current_materialization.status !== 'materialized'
    ) {
      return freezeDeep({
        expected_workspace_source_tree_digest: candidate.base_source_tree.source_tree_digest,
        projection_mode: 'base_cas',
      });
    }
    return freezeDeep({
      expected_workspace_source_tree_digest: continuationContext.base.base_source_tree_digest,
      projection_mode: 'sqlite_current_repair',
    });
  }

  function pendingDraftWorkspaceExpectation(draft, candidate) {
    if (draft.current_materialization.status !== 'materialized') {
      return freezeDeep({
        expected_workspace_source_tree_digest: candidate.base_source_tree.source_tree_digest,
        projection_mode: 'base_cas',
      });
    }
    return freezeDeep({
      expected_workspace_source_tree_digest: draft.candidate_proof.resulting_tree_digest,
      projection_mode: 'sqlite_current_repair',
    });
  }

  const generationContexts = new WeakMap();
  const providerContextProjections = new WeakMap();
  const draftContinuationContexts = new WeakMap();
  const pendingDraftContinuationContexts = new Map();
  const explanationContexts = new WeakMap();
  const providerOutputStates = new WeakMap();
  const liveOutputContextsByRunId = new Map();
  const pendingDraftAnswerContexts = new Map();
  const pendingAnswerRouteDecisionHints = new Map();
  const pendingAnswerQueuedFollowups = new Map();
  const pendingApprovedPlanEditContexts = new Map();
  const executionAdmissionContexts = new WeakMap();
  const pendingPlanRequests = new Map();
  const planContexts = new WeakMap();
  const pendingSemanticRouteClassifications = new Map();
  const providerConfigDigestsByRunId = new Map();
  const harnessRunnersByOperationKey = new Map();
  const cancellationTerminalOperationKeys = new Set();
  let pendingAuthority = null;
  let bindingAuthority = false;

  function sourceLines(content) {
    if (content === '') return [];
    const lines = content.split(/\r\n|\r|\n/u);
    if (lines.at(-1) === '') lines.pop();
    return lines;
  }

  function lineEditCounts(beforeContent, afterContent) {
    const before = sourceLines(beforeContent);
    const after = sourceLines(afterContent);
    const maximum = before.length + after.length;
    if (maximum > 20_000) {
      let prefix = 0;
      while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
        prefix += 1;
      }
      let suffix = 0;
      while (
        suffix < before.length - prefix
        && suffix < after.length - prefix
        && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
      ) suffix += 1;
      return {
        added_lines: after.length - prefix - suffix,
        deleted_lines: before.length - prefix - suffix,
      };
    }
    const frontier = new Map([[1, 0]]);
    for (let distance = 0; distance <= maximum; distance += 1) {
      for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
        const left = frontier.get(diagonal - 1) ?? -1;
        const right = frontier.get(diagonal + 1) ?? -1;
        let x = diagonal === -distance || (diagonal !== distance && left < right)
          ? Math.max(0, right)
          : left + 1;
        let y = x - diagonal;
        while (x < before.length && y < after.length && before[x] === after[y]) {
          x += 1;
          y += 1;
        }
        frontier.set(diagonal, x);
        if (x >= before.length && y >= after.length) {
          return {
            added_lines: (distance + after.length - before.length) / 2,
            deleted_lines: (distance - after.length + before.length) / 2,
          };
        }
      }
    }
    fail();
  }

  function runtimeTimestamp(context) {
    const latest = context.events.at(-1) ?? null;
    const value = latest === null ? 0 : latest.recorded_at_ms;
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  async function measureTraceWindow(windowName, metricName, callback) {
    const windowStarted = builderPerformanceTrace.beginEventLoopWindow(windowName);
    try {
      return await builderPerformanceTrace.measureAsync(metricName, callback);
    } finally {
      if (windowStarted) builderPerformanceTrace.endEventLoopWindow(windowName);
    }
  }

  async function beginStructuredRuntimeTrace({
    context,
    operation_key: operationKeyValue,
    provider_context: providerContext,
    source_tree: sourceTree,
    instruction,
  }) {
    const providerConfigDigest = providerConfigDigestsByRunId.get(context.ids.run_id);
    if (providerConfigDigest === undefined) return null;
    const state = { context };
    const bridge = createBuilderStructuredProgrammingRuntimeBridge({
      clock: () => runtimeTimestamp(state.context),
    });
    const runContract = createBuilderProgrammingRuntimeRunContract({
      runtime_descriptor: bridge.descriptor,
      admission: {
        project_id: context.project.project_id,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        task_id: context.ids.task_id,
        run_id: context.ids.run_id,
        mode: 'build',
        workspace_ref: {
          ref_version: 'builder-programming-workspace-ref.v1',
          workspace_id: `builder-programming-workspace:${sourceTree.source_tree_digest.slice('sha256:'.length)}`,
          source_tree_digest: sourceTree.source_tree_digest,
          writable: true,
        },
        provider_config_digest: providerConfigDigest,
        allowed_tools: [],
        limits: {
          max_steps: 128,
          max_duration_ms: 300_000,
          max_model_tokens: 32_768,
          max_tool_output_bytes: 256 * 1_024,
        },
        admitted_at_ms: runtimeTimestamp(context),
      },
      input: {
        message_id: context.ids.message_id,
        text: instruction,
      },
    });
    const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract });
    if (typeof options.runtimeWorkspaceSnapshotService?.recordRuntimeSourceTree === 'function') {
      await options.runtimeWorkspaceSnapshotService.recordRuntimeSourceTree({
        project_id: runContract.admission.project_id,
        conversation_id: runContract.admission.conversation_id,
        run_id: runContract.admission.run_id,
        source_tree: sourceTree,
      });
    }
    async function persistRuntimeEvent(candidate, mainFact) {
      const normalizedAtMs = runtimeTimestamp(state.context);
      const runtimeEvent = mainFact
        ? journal.appendMainFact(candidate, normalizedAtMs)
        : journal.append(candidate, normalizedAtMs);
      state.context = Reflect.apply(
        recordConversationProgrammingRuntimeEvent,
        options.conversationService,
        [{ context: state.context, runtime_event: runtimeEvent }],
      );
      activeContexts.set(operationKeyValue, state.context);
      if (draftContinuationContexts.has(providerContext)) {
        draftContinuationContexts.set(providerContext, state.context);
      } else {
        generationContexts.set(providerContext, state.context);
      }
      if (
        runtimeEvent.event_type === 'tool_call_started'
        && ['edit', 'write'].includes(runtimeEvent.payload.tool_kind)
        && runtimeEvent.payload.target_label !== null
        && typeof options.runtimeWorkspaceSnapshotService?.bindToolFile === 'function'
      ) {
        try {
          await options.runtimeWorkspaceSnapshotService.bindToolFile({
            project_id: runContract.admission.project_id,
            conversation_id: runContract.admission.conversation_id,
            run_id: runtimeEvent.run_id,
            tool_call_id: runtimeEvent.tool_call_id,
            path: runtimeEvent.payload.target_label,
          });
        } catch (error) {
          recordCanaryGenerationDebug('structured_runtime_file_binding', error);
        }
      }
      return runtimeEvent;
    }
    const handle = await bridge.startRun({
      run_contract: runContract,
      event_sink: {
        emit(candidate) {
          return persistRuntimeEvent(candidate, false);
        },
        emit_main_fact(candidate) {
          return persistRuntimeEvent(candidate, true);
        },
      },
    });
    return {
      bridge,
      handle,
      context() {
        return state.context;
      },
    };
  }

  async function recordStructuredCandidateFacts(session, candidate, assistantText) {
    const context = session.context();
    if (typeof options.runtimeWorkspaceSnapshotService?.recordRuntimeSourceTree === 'function') {
      await options.runtimeWorkspaceSnapshotService.recordRuntimeSourceTree({
        project_id: context.project.project_id,
        conversation_id: context.conversation.conversation_id,
        run_id: context.ids.run_id,
        source_tree: candidate.resulting_source_tree,
      });
    }
    await session.bridge.recordAssistantResult(session.handle, {
      assistant_text: assistantText,
    });
    const beforeByPath = new Map(candidate.base_source_tree.files.map(
      (file) => [file.path, file.content],
    ));
    const afterByPath = new Map(candidate.resulting_source_tree.files.map(
      (file) => [file.path, file.content],
    ));
    for (const operation of candidate.operations) {
      const beforeContent = beforeByPath.get(operation.path) ?? '';
      const afterContent = afterByPath.get(operation.path) ?? '';
      const counts = lineEditCounts(beforeContent, afterContent);
      await session.bridge.recordFileChange(session.handle, {
        resource_id: `project:/${operation.path}`,
        change_kind: operation.operation === 'delete'
          ? 'deleted'
          : beforeByPath.has(operation.path) ? 'edited' : 'added',
        added_lines: counts.added_lines,
        deleted_lines: counts.deleted_lines,
        duration_ms: 0,
      });
    }
  }

  async function recordStructuredCheckFact(session, automaticCheck) {
    if (
      automaticCheck?.status !== 'completed'
      || automaticCheck.profile == null
      || automaticCheck.check_run_status_projection == null
    ) return;
    const projection = automaticCheck.check_run_status_projection;
    await session.bridge.recordCheckResult(session.handle, {
      command_display: automaticCheck.profile.command_display,
      status: projection.status === 'passed' ? 'passed' : 'failed',
      duration_ms: automaticCheck.duration_ms,
      summary: projection.summary,
    });
  }

  async function finishStructuredRuntimeTrace(session, checkpointStatus) {
    await session.bridge.completeRun(session.handle, {
      checkpoint_status: checkpointStatus,
    });
    await session.bridge.dispose();
    providerConfigDigestsByRunId.delete(session.context().ids.run_id);
    return session.context();
  }

  async function cancelStructuredRuntimeTrace(session) {
    try {
      await session.bridge.cancelRun(session.handle);
    } finally {
      await session.bridge.dispose();
      providerConfigDigestsByRunId.delete(session.context().ids.run_id);
    }
    return session.context();
  }

  function clearStructuredRuntimeDigestForOperation(operationKeyValue) {
    const context = activeContexts.get(operationKeyValue);
    if (context !== undefined) providerConfigDigestsByRunId.delete(context.ids.run_id);
  }

  function readProviderConfig() {
    if (bindingAuthority) fail();
    bindingAuthority = true;
    pendingAuthority = null;
    try {
      const authority = sanitizeBoundAuthority(Reflect.apply(
        bindCurrentAuthority,
        options.providerConfigRepository,
        [],
      ));
      const config = sanitizeBuilderProviderConfig(Reflect.apply(
        authority.readProviderConfig,
        authority.receiver,
        [],
      ));
      pendingAuthority = authority;
      return config;
    } finally {
      bindingAuthority = false;
    }
  }

  function submitRouteContextForRequest(request) {
    const requested = routeContextForSubmitInstruction(request.instruction);
    if (
      request.existing_project_id === null
      || request.task_address_id === null
      || (
        requested.has_contextual_build_context !== true
        && requested.has_pending_build_confirmation !== true
      )
    ) {
      return Object.freeze({
        hasContextualBuildContext: false,
        hasPendingBuildConfirmation: false,
        hasWorkingContextStateEvidence: false,
      });
    }
    try {
      const target = taskTargetForRequest(request, request.existing_project_id);
      const stream = Reflect.apply(readConversationStream, options.conversationService, [{
        project_id: request.existing_project_id,
        conversation_id: target.conversation_id,
      }]);
      const streamContextState = requested.has_contextual_build_context === true
        ? contextualBuildContextStateInTaskStream(stream, request.existing_project_id)
        : 'unknown';
      const conversationId = requested.has_contextual_build_context === true
        ? conversationIdInTaskStream(stream, request.existing_project_id)
        : null;
      const hasWorkingContextStateEvidence = requested.has_contextual_build_context === true
        && streamContextState === 'unknown'
        && hasContextualBuildContextInWorkingContextStateService(
          request.existing_project_id,
          conversationId,
          request.instruction,
        );
      return Object.freeze({
        hasContextualBuildContext: streamContextState === 'ready'
          || (
            requested.has_contextual_build_context === true
            && streamContextState === 'unknown'
            && (
              hasWorkingContextStateEvidence
              || hasContextualBuildContextInTaskCapsuleStore(request.existing_project_id)
            )
          ),
        hasPendingBuildConfirmation: requested.has_pending_build_confirmation === true
          ? hasPendingBuildConfirmationInTaskStream(stream, request.existing_project_id)
          : false,
        hasWorkingContextStateEvidence,
      });
    } catch {
      return Object.freeze({
        hasContextualBuildContext: false,
        hasPendingBuildConfirmation: false,
        hasWorkingContextStateEvidence: false,
      });
    }
  }

  function semanticRouteRequestFor(instruction, projectId, taskAddressId) {
    let routeContext = Object.freeze({
      hasContextualBuildContext: false,
      hasPendingBuildConfirmation: false,
      workingContextStatus: projectId === null ? 'unknown' : 'discussing',
    });
    if (projectId !== null && taskAddressId !== null) {
      try {
        const target = taskTargetForRequest({ task_address_id: taskAddressId }, projectId);
        const stream = Reflect.apply(readConversationStream, options.conversationService, [{
          project_id: projectId,
          conversation_id: target.conversation_id,
        }]);
        const streamContextState = contextualBuildContextStateInTaskStream(stream, projectId);
        const conversationId = conversationIdInTaskStream(stream, projectId);
        const hasWorkingContextStateEvidence = streamContextState === 'unknown'
          && hasContextualBuildContextInWorkingContextStateService(
            projectId,
            conversationId,
            instruction,
          );
        const hasContextualBuildContext = streamContextState === 'ready'
          || (
            streamContextState === 'unknown'
            && (
              hasWorkingContextStateEvidence
              || hasContextualBuildContextInTaskCapsuleStore(projectId)
            )
          );
        routeContext = Object.freeze({
          hasContextualBuildContext,
          hasPendingBuildConfirmation: hasPendingBuildConfirmationInTaskStream(stream, projectId),
          workingContextStatus: hasContextualBuildContext
            ? 'ready'
            : streamContextState === 'blocked'
              ? 'needs_clarification'
              : 'discussing',
        });
      } catch {
        routeContext = Object.freeze({
          hasContextualBuildContext: false,
          hasPendingBuildConfirmation: false,
          workingContextStatus: 'stale',
        });
      }
    }
    const hasUnsavedDraft = projectId !== null && [...pendingDrafts.values()].some((draft) => (
      valueAt(draft, 'project_id') === projectId
    ));
    return createBuilderSemanticRouteRequest({
      instruction,
      context: {
        has_workspace: projectId !== null,
        has_prior_build_context: routeContext.hasContextualBuildContext,
        has_pending_build_confirmation: routeContext.hasPendingBuildConfirmation,
        has_unsaved_draft: hasUnsavedDraft,
        working_context_status: routeContext.workingContextStatus,
      },
    });
  }

  function semanticRouteCacheKey(request) {
    return request.request_digest;
  }

  function rememberSemanticRouteClassification(request, classification) {
    const key = semanticRouteCacheKey(request);
    pendingSemanticRouteClassifications.delete(key);
    pendingSemanticRouteClassifications.set(key, freezeDeep({
      semantic_request_digest: classification.request_digest,
      classification,
    }));
    while (pendingSemanticRouteClassifications.size > MAX_PENDING_SEMANTIC_ROUTE_CLASSIFICATIONS) {
      const oldest = pendingSemanticRouteClassifications.keys().next().value;
      if (oldest === undefined) break;
      pendingSemanticRouteClassifications.delete(oldest);
    }
  }

  function consumeSemanticRouteClassification(request) {
    const key = semanticRouteCacheKey(request);
    const pending = pendingSemanticRouteClassifications.get(key);
    if (pending === undefined) return null;
    pendingSemanticRouteClassifications.delete(key);
    const semanticRequest = semanticRouteRequestFor(
      request.instruction,
      request.existing_project_id,
      request.task_address_id,
    );
    if (semanticRequest.request_digest !== pending.semantic_request_digest) fail();
    return pending.classification;
  }

  function hasContextualBuildContextInWorkingContextStateService(projectId, conversationId, instruction) {
    if (readCurrentWorkingContextStateForConversation === null || conversationId === null) return false;
    try {
      const result = Reflect.apply(
        readCurrentWorkingContextStateForConversation,
        options.workingContextStateService,
        [{
          project_id: projectId,
          conversation_id: conversationId,
          objective_summary: null,
          confirmed_constraints: [],
          rejected_constraints: [],
          open_questions: [],
          latest_user_intent: instruction,
          source_refs: [],
          compaction_refs: [],
          handoff_refs: [],
          approved_plan_ref: null,
          base_revision_ref: null,
          invalidated_by: null,
          updated_at_ms: Date.now(),
        }],
      );
      if (
        !isPlainObject(result)
        || valueAt(result, 'result_version') !== 'builder-working-context-state-service-result.v1'
        || valueAt(result, 'status') !== 'ready'
      ) return false;
      const state = valueAt(result, 'working_context_state');
      return isPlainObject(state)
        && valueAt(state, 'project_id') === projectId
        && valueAt(state, 'conversation_id') === conversationId
        && valueAt(state, 'state') === 'ready';
    } catch {
      return false;
    }
  }

  function hasContextualBuildContextInTaskCapsuleStore(projectId) {
    if (readLatestTaskCapsule === null) return false;
    try {
      const result = Reflect.apply(readLatestTaskCapsule, options.taskCapsuleStore, [{
        project_id: projectId,
      }]);
      if (
        !isPlainObject(result)
        || valueAt(result, 'result_version') !== 'builder-task-capsule-store-read-result.v1'
        || valueAt(result, 'task_capsule_authority') !== 'main_owned_task_capsule_store'
        || valueAt(result, 'status') !== 'ready'
      ) return false;
      const entry = valueAt(result, 'task_capsule_update');
      if (!isPlainObject(entry)) return false;
      const update = valueAt(entry, 'task_capsule_update');
      if (!isPlainObject(update) || valueAt(update, 'project_id') !== projectId) return false;
      const capsule = valueAt(update, 'task_capsule');
      if (!isPlainObject(capsule) || valueAt(capsule, 'status') !== 'ready') return false;
      const brief = valueAt(capsule, 'current_brief');
      return isPlainObject(brief)
        && valueAt(brief, 'source') === 'task_capsule_update'
        && valueAt(brief, 'use_when_instruction_is_contextual') === true;
    } catch {
      return false;
    }
  }

  function resolveSecret(secretRef) {
    const authority = pendingAuthority;
    pendingAuthority = null;
    if (authority === null) fail();
    return Reflect.apply(authority.resolveSecret, authority.receiver, [secretRef]);
  }

  function harnessCredentialFromResolution(rawResolution, providerConfig) {
    exactObject(rawResolution, ['resolution_version', 'secret_ref', 'credential']);
    const secretRef = valueAt(rawResolution, 'secret_ref');
    exactObject(secretRef, ['ref_version', 'provider_id', 'secret_id']);
    if (
      valueAt(rawResolution, 'resolution_version') !== 'builder-provider-secret-resolution.v1'
      || valueAt(secretRef, 'ref_version') !== providerConfig.secret_ref.ref_version
      || valueAt(secretRef, 'provider_id') !== providerConfig.secret_ref.provider_id
      || valueAt(secretRef, 'secret_id') !== providerConfig.secret_ref.secret_id
    ) fail();
    const credential = valueAt(rawResolution, 'credential');
    if (
      typeof credential !== 'string'
      || credential.length === 0
      || credential.trim() !== credential
      || credential.length > 16 * 1_024
      || Buffer.byteLength(credential, 'utf8') > 16 * 1_024
      || hasControlCharacters(credential)
    ) fail();
    return credential;
  }

  function harnessProviderCompatible(providerConfig) {
    try {
      const endpoint = new URL(providerConfig.base_url);
      const hostname = endpoint.hostname.toLowerCase();
      return (endpoint.protocol === 'https:' && hostname === 'api.deepseek.com')
        || ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
    } catch {
      return false;
    }
  }

  function operationKey(prefix, requestDigest) {
    return `${prefix}${requestDigest}`;
  }

  function latestConversationContext(context, fallback) {
    if (fallback === undefined) return undefined;
    const runId = typeof context.run_id === 'string' ? context.run_id : null;
    if (runId !== null) {
      const latest = liveOutputContextsByRunId.get(runId);
      if (latest !== undefined) return latest;
    }
    return fallback;
  }

  function observedConversationContext(context) {
    const planSourceContext = planContexts.get(context);
    const directConversationContext = generationContexts.get(context)
      ?? draftContinuationContexts.get(context)
      ?? explanationContexts.get(context)
      ?? (planSourceContext === undefined ? undefined : valueAt(planSourceContext, 'context'));
    const latest = latestConversationContext(context, directConversationContext);
    if (latest !== undefined) return latest;
    const runId = typeof context.run_id === 'string' ? context.run_id : null;
    return runId === null ? undefined : liveOutputContextsByRunId.get(runId);
  }

  function isAgentConversationContext(context) {
    if (context === null || typeof context !== 'object' || utilTypes.isProxy(context)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(context, 'scope_kind');
    return descriptor !== undefined
      && Object.hasOwn(descriptor, 'value')
      && descriptor.value === 'agent_conversation';
  }

  function applyConversationContextMethod(
    context,
    projectMethod,
    agentMethod,
    request,
  ) {
    if (!isAgentConversationContext(context)) {
      return Reflect.apply(projectMethod, options.conversationService, [request]);
    }
    if (options.agentConversationService === undefined || agentMethod === null) fail();
    return Reflect.apply(agentMethod, options.agentConversationService, [request]);
  }

  function rejectIfOtherRouteInFlight(prefix, requestDigest) {
    for (const otherPrefix of [
      GENERATE_OPERATION_PREFIX,
      DRAFT_CONTINUATION_OPERATION_PREFIX,
      ANSWER_OPERATION_PREFIX,
      PLAN_OPERATION_PREFIX,
      RESTORE_REVISION_OPERATION_PREFIX,
    ]) {
      if (otherPrefix !== prefix && inFlight.has(operationKey(otherPrefix, requestDigest))) {
        return Promise.reject(new BuilderGenerationMainServiceError());
      }
    }
    return null;
  }

  function notifyGenerationStarted(request, projectId) {
    if (!Object.hasOwn(options, 'onGenerationStarted')) return;
    try {
      Reflect.apply(options.onGenerationStarted, undefined, [freezeDeep({
        event_version: 'builder-generation-started.v1',
        request_id: request.request_digest,
        project_id: projectId,
      })]);
    } catch {
      // A UI notification cannot change durable Conversation or generation facts.
    }
  }

  function liveOutputState(context) {
    const existing = providerOutputStates.get(context);
    if (existing !== undefined) return existing;
    const created = {
      buffer_text: '',
      buffer_bytes: 0,
    };
    providerOutputStates.set(context, created);
    return created;
  }

  function inheritLiveOutputState(previousContext, nextContext) {
    const existing = providerOutputStates.get(previousContext);
    if (existing !== undefined) providerOutputStates.set(nextContext, existing);
  }

  function displayDeltaFromProjectedOutput(context, deltaText) {
    const state = liveOutputState(context);
    if (appendProviderOutputBuffer(state, deltaText) === null) return null;
    const structuredDisplayText = structuredProviderOutputLiveDisplayText(deltaText);
    if (structuredDisplayText !== undefined) return structuredDisplayText;
    return safeLiveDisplayText(deltaText);
  }

  function notifyProviderOutputDelta(context, rawDeltaText) {
    if (!Object.hasOwn(options, 'onProviderOutputDelta')) return;
    const conversationContext = observedConversationContext(context);
    if (conversationContext === undefined) return;
    builderPerformanceTrace.increment('main.provider_output.display_attempt_count');
    const displayDeltaText = displayDeltaFromProjectedOutput(context, rawDeltaText);
    if (displayDeltaText === null) {
      builderPerformanceTrace.increment('main.provider_output.suppressed_count');
      return;
    }
    try {
      Reflect.apply(options.onProviderOutputDelta, undefined, [freezeDeep({
        event_version: PROVIDER_OUTPUT_EVENT_VERSION,
        request_id: conversationContext.request_digest,
        project_id: conversationContext.project.project_id,
        conversation_id: conversationContext.conversation.conversation_id,
        turn_id: conversationContext.ids.turn_id,
        task_id: conversationContext.ids.task_id,
        run_id: conversationContext.ids.run_id,
        display_delta_text: displayDeltaText,
      })]);
      builderPerformanceTrace.increment('main.provider_output.sent_count');
    } catch {
      // Live output observation cannot alter durable Conversation, Git, or SQLite facts.
    }
  }

  function notifyProviderActivity(context, activityText) {
    if (!Object.hasOwn(options, 'onProviderOutputDelta')) return;
    const conversationContext = observedConversationContext(context);
    if (conversationContext === undefined) return;
    try {
      Reflect.apply(options.onProviderOutputDelta, undefined, [freezeDeep({
        event_version: PROVIDER_ACTIVITY_EVENT_VERSION,
        request_id: conversationContext.request_digest,
        project_id: conversationContext.project.project_id,
        conversation_id: conversationContext.conversation.conversation_id,
        turn_id: conversationContext.ids.turn_id,
        task_id: conversationContext.ids.task_id,
        run_id: conversationContext.ids.run_id,
        activity_text: activityText,
      })]);
    } catch {
      // Activity observation cannot alter durable Conversation, Git, or SQLite facts.
    }
  }

  function notifyProviderOutputReset(context, runtimeEvent) {
    if (!Object.hasOwn(options, 'onProviderOutputDelta')) return;
    const conversationContext = observedConversationContext(context);
    if (conversationContext === undefined) return;
    const state = liveOutputState(context);
    const retainTextBytes = discardProviderOutputBuffer(
      state,
      runtimeEvent.payload.text_digest,
      runtimeEvent.payload.text_bytes,
    );
    if (retainTextBytes === null) return;
    try {
      Reflect.apply(options.onProviderOutputDelta, undefined, [freezeDeep({
        event_version: PROVIDER_OUTPUT_RESET_EVENT_VERSION,
        request_id: conversationContext.request_digest,
        project_id: conversationContext.project.project_id,
        conversation_id: conversationContext.conversation.conversation_id,
        turn_id: conversationContext.ids.turn_id,
        task_id: conversationContext.ids.task_id,
        run_id: conversationContext.ids.run_id,
        retain_text_bytes: retainTextBytes,
      })]);
    } catch {
      // Live output observation cannot alter durable Conversation, Git, or SQLite facts.
    }
  }

  function baseRevisionFromConversationContext(context) {
    const submitted = context.events.find((event) => (
      event.event_type === 'turn_submitted'
      && event.payload.turn_id === context.ids.turn_id
    ));
    if (submitted === undefined) fail();
    const baseRevision = submitted.payload.base_revision;
    return baseRevision === null ? null : freezeDeep({
      revision_receipt_digest: safeDigest(baseRevision.revision_receipt_digest),
      commit_oid: safeOid(baseRevision.commit_oid),
    });
  }

  function sameBaseRevision(left, right) {
    if (left === null || right === null) return left === right;
    return left.revision_receipt_digest === right.revision_receipt_digest
      && left.commit_oid === right.commit_oid;
  }

  async function baseForGeneration(request, projectId, expectedBaseRevision) {
    if (expectedBaseRevision === null) {
      if (request.existing_project_id !== null) {
        if (request.existing_project_id !== projectId) fail();
        if (options.projectIdentityAuthority === null || loadProjectIdentity === null) fail();
        return emptyBaseForBoundProject(
          await Reflect.apply(loadProjectIdentity, options.projectIdentityAuthority, [{ project_id: projectId }]),
          projectId,
        );
      }
      return {
        base_revision: null,
        base_revision_evidence: null,
        source_tree: createBuilderProjectSourceTree({ files: [] }),
      };
    }
    if (request.existing_project_id !== projectId) fail();
    const base = sanitizeReadResult(
      await Reflect.apply(loadCurrentProject, options.projectReadAuthority, [{ project_id: projectId }]),
      projectId,
    );
    if (!sameBaseRevision(base.base_revision, expectedBaseRevision)) fail();
    return base;
  }

  function generationContextFromConversation(
    request,
    base,
    conversationContext,
    approvedPlanPublicText = null,
  ) {
    const generationContext = freezeDeep({
      project_id: conversationContext.project.project_id,
      base_revision_evidence: base.base_revision_evidence,
      base_source_tree: base.source_tree,
      conversation_events: conversationContext.events,
      turn_id: conversationContext.ids.turn_id,
      task_id: conversationContext.ids.task_id,
      run_id: conversationContext.ids.run_id,
      git_request_id: newId(options.createUuid, 'builder-git-request'),
      ...(approvedPlanPublicText === null
        ? {}
        : { approved_plan_public_text: approvedPlanPublicText }),
    });
    generationContexts.set(generationContext, conversationContext);
    const providerContextProjection = providerContextProjections.get(conversationContext);
    if (providerContextProjection !== undefined) {
      providerContextProjections.set(generationContext, providerContextProjection);
    }
    liveOutputContextsByRunId.set(conversationContext.ids.run_id, conversationContext);
    return generationContext;
  }

  function latestUserIntentFromConversationContext(conversationContext) {
    const submitted = conversationContext.events.find((event) => (
      valueAt(event, 'event_type') === 'turn_submitted'
      && valueAt(valueAt(event, 'payload'), 'turn_id') === conversationContext.ids.turn_id
    ));
    if (submitted === undefined) return null;
    const message = valueAt(valueAt(valueAt(submitted, 'payload'), 'message'), 'text');
    return typeof message === 'string' ? message : null;
  }

  function harnessRuntimeInputText(request, context) {
    if (!Object.hasOwn(context, 'approved_plan_public_text')) return request.instruction;
    const approvedPlanPublicText = valueAt(context, 'approved_plan_public_text');
    return [
      'Implement the approved plan below.',
      '',
      'This plan was approved in the current Builder conversation and is the implementation specification.',
      'If the current source tree is empty or lacks the files normally needed for the plan, treat that as a valid new-project starting point. Use write to create the required project files instead of ending the run because README, package.json, src, or other common files are absent.',
      'Do not use shell or list commands to discover the project tree. Use Builder read, grep, write, and edit tools; Builder runs checks after the turn.',
      '<approved_plan>',
      approvedPlanPublicText,
      '</approved_plan>',
    ].join('\n');
  }

  function workingContextSnapshotUpdatedAtMs(conversationContext) {
    const submitted = conversationContext.events.find((event) => (
      valueAt(event, 'event_type') === 'turn_submitted'
      && valueAt(valueAt(event, 'payload'), 'turn_id') === conversationContext.ids.turn_id
    ));
    if (submitted !== undefined) {
      const decidedAtMs = valueAt(
        valueAt(valueAt(submitted, 'payload'), 'route_decision'),
        'decided_at_ms',
      );
      if (Number.isSafeInteger(decidedAtMs)) return safeTimestamp(decidedAtMs);
    }
    return safeTimestamp(conversationContext.conversation.created_at_ms);
  }

  function compactionSummariesFromWorkingContextResult(result) {
    const latest = valueAt(result, 'latest_context_compaction_summary');
    if (!isPlainObject(latest) || utilTypes.isProxy(latest)) return [];
    if (valueAt(latest, 'status') !== 'ready') return [];
    return freezeDeep([{
      summary_digest: valueAt(latest, 'summary_digest'),
      source_range_digest: valueAt(latest, 'source_range_digest'),
      summary: valueAt(latest, 'summary'),
      compacted_at_ms: valueAt(latest, 'compacted_at_ms'),
    }]);
  }

  function workingContextForSnapshot(conversationContext) {
    if (readCurrentWorkingContextStateForConversation === null) return null;
    try {
      const baseRevision = baseRevisionFromConversationContext(conversationContext);
      const result = Reflect.apply(
        readCurrentWorkingContextStateForConversation,
        options.workingContextStateService,
        [{
          project_id: conversationContext.project.project_id,
          conversation_id: conversationContext.conversation.conversation_id,
          objective_summary: null,
          confirmed_constraints: [],
          rejected_constraints: [],
          open_questions: [],
          latest_user_intent: latestUserIntentFromConversationContext(conversationContext),
          source_refs: [],
          compaction_refs: [],
          handoff_refs: [],
          approved_plan_ref: null,
          base_revision_ref: baseRevision === null
            ? null
            : { revision_receipt_digest: baseRevision.revision_receipt_digest },
          invalidated_by: null,
          updated_at_ms: workingContextSnapshotUpdatedAtMs(conversationContext),
        }],
      );
      if (
        !isPlainObject(result)
        || valueAt(result, 'result_version') !== 'builder-working-context-state-service-result.v1'
      ) return null;
      return freezeDeep({
        working_context_state: valueAt(result, 'working_context_state'),
        compaction_summaries: compactionSummariesFromWorkingContextResult(result),
      });
    } catch {
      return null;
    }
  }

  function submittedRouteDecisionFromConversationContext(conversationContext) {
    const submitted = conversationContext.events.find((event) => (
      valueAt(event, 'event_type') === 'turn_submitted'
      && valueAt(valueAt(event, 'payload'), 'turn_id') === conversationContext.ids.turn_id
    ));
    return submitted === undefined ? null : valueAt(valueAt(submitted, 'payload'), 'route_decision');
  }

  function contextAssemblyPurposeFromRoute(routeDecision, workingContextState) {
    const matchedSignals = valueAt(routeDecision, 'matched_signals');
    if (
      Array.isArray(matchedSignals)
      && matchedSignals.includes('approved_plan_continuation')
    ) return null;
    const route = valueAt(routeDecision, 'route');
    if (route === 'plan') return 'plan';
    if (route !== 'build') return 'answer';
    const state = valueAt(workingContextState, 'state');
    return ['ready', 'approved_plan_ready'].includes(state) ? 'contextual_build' : null;
  }

  function contextAssemblyForSnapshot(conversationContext, workingContext) {
    if (workingContext === null) return null;
    const workingContextState = valueAt(workingContext, 'working_context_state');
    const routeDecision = submittedRouteDecisionFromConversationContext(conversationContext);
    if (routeDecision === null) return null;
    const assemblyPurpose = contextAssemblyPurposeFromRoute(routeDecision, workingContextState);
    if (assemblyPurpose === null) return null;
    const assembledAtMs = Math.max(
      workingContextSnapshotUpdatedAtMs(conversationContext),
      safeTimestamp(valueAt(workingContextState, 'updated_at_ms')),
    );
    try {
      return createBuilderContextAssembly({
        assembly_purpose: assemblyPurpose,
        project_id: conversationContext.project.project_id,
        latest_user_message: latestUserIntentFromConversationContext(conversationContext),
        working_context_state: workingContextState,
        approved_plan_ref: valueAt(workingContextState, 'approved_plan_ref'),
        current_result_ref: null,
        selected_source_summaries: [],
        compaction_summaries: valueAt(workingContext, 'compaction_summaries'),
        adopted_handoff_packets: [],
        permission_state: {
          workspace_state: 'bound',
          write_permission: valueAt(routeDecision, 'permission_result'),
        },
        context_budget: {
          max_segments: 8,
          max_prompt_bytes: 8_192,
          reserved_response_bytes: 4_096,
        },
        assembled_at_ms: assembledAtMs,
      });
    } catch (error) {
      if (assemblyPurpose === 'contextual_build') throw error;
      return null;
    }
  }

  async function providerContextProjectionForSnapshot(contextAssembly) {
    if (contextAssembly === null || decideProviderContextDisclosure === null) return null;
    const decisionResult = sanitizeBuilderProviderContextDisclosureDecision(
      await Reflect.apply(
        decideProviderContextDisclosure,
        options.providerContextDisclosureDecisionService,
        [{ context_assembly: contextAssembly }],
      ),
    );
    const disclosureDecision = valueAt(decisionResult, 'disclosure_decision');
    const approvedAtMs = valueAt(disclosureDecision, 'approved_at_ms');
    return createBuilderProviderContextProjection({
      context_assembly: contextAssembly,
      disclosure_decision: disclosureDecision,
      projected_at_ms: Math.max(
        valueAt(contextAssembly, 'assembled_at_ms'),
        approvedAtMs === null ? 0 : approvedAtMs,
      ),
    });
  }

  function providerContextPromptEgressGateForSnapshot(providerContextProjection) {
    if (providerContextProjection === null) return null;
    return assessBuilderProviderContextPromptEgress({
      provider_context_projection: providerContextProjection,
      assessed_at_ms: valueAt(providerContextProjection, 'projected_at_ms'),
    });
  }

  function conversationStatusScope(conversationContext) {
    return Object.freeze({
      project_id: conversationContext.project.project_id,
      conversation_id: conversationContext.conversation.conversation_id,
    });
  }

  function recordProviderContextDisclosureStatusForSnapshot(
    conversationContext,
    contextAssembly,
    providerContextProjection,
  ) {
    if (
      recordProviderContextDisclosureStatus === null
      || contextAssembly === null
      || providerContextProjection === null
    ) return;
    try {
      Reflect.apply(
        recordProviderContextDisclosureStatus,
        options.providerContextDisclosureStatusService,
        [{
          ...conversationStatusScope(conversationContext),
          context_assembly: contextAssembly,
          provider_context_projection: providerContextProjection,
          recorded_at_ms: Math.max(
            safeTimestamp(Date.now()),
            valueAt(providerContextProjection, 'projected_at_ms'),
          ),
        }],
      );
    } catch {
      // Provider context disclosure status is UI-only; Run Snapshot remains the authority.
    }
  }

  function clearProviderContextDisclosureStatusForContext(conversationContext) {
    if (clearProviderContextDisclosureStatus === null || conversationContext === undefined) return;
    try {
      Reflect.apply(
        clearProviderContextDisclosureStatus,
        options.providerContextDisclosureStatusService,
        [conversationStatusScope(conversationContext)],
      );
    } catch {
      // Stale status cleanup must not change generation completion semantics.
    }
  }

  function clearProviderContextDisclosureStatusForKey(key) {
    clearProviderContextDisclosureStatusForContext(activeContexts.get(key));
  }

  async function recordConversationContextSnapshot(conversationContext, projectUnderstanding = null) {
    const workingContext = workingContextForSnapshot(conversationContext);
    const workingContextState = workingContext === null
      ? null
      : valueAt(workingContext, 'working_context_state');
    const contextAssembly = contextAssemblyForSnapshot(conversationContext, workingContext);
    const providerContextProjection = await providerContextProjectionForSnapshot(contextAssembly);
    const providerContextPromptEgressGate = providerContextPromptEgressGateForSnapshot(providerContextProjection);
    const snapshottedContext = Reflect.apply(
      recordConversationRunContextSnapshot,
      options.conversationService,
      [{
        context: conversationContext,
        working_context_state: workingContextState,
        project_understanding: projectUnderstanding,
        context_assembly: contextAssembly,
        provider_context_projection: providerContextProjection,
        provider_context_prompt_egress_gate: providerContextPromptEgressGate,
      }],
    );
    if (providerContextProjection !== null) {
      providerContextProjections.set(snapshottedContext, providerContextProjection);
      recordProviderContextDisclosureStatusForSnapshot(
        snapshottedContext,
        contextAssembly,
        providerContextProjection,
      );
    }
    return snapshottedContext;
  }

  function currentRunContextSnapshot(conversationContext) {
    const recorded = [...conversationContext.events].reverse().find((event) => (
      valueAt(event, 'event_type') === 'run_context_snapshot_recorded'
      && valueAt(valueAt(event, 'payload'), 'turn_id') === conversationContext.ids.turn_id
      && valueAt(valueAt(event, 'payload'), 'run_id') === conversationContext.ids.run_id
    ));
    if (recorded === undefined) fail();
    return sanitizeBuilderRunContextSnapshot(valueAt(valueAt(recorded, 'payload'), 'snapshot'), {
      project_id: conversationContext.project.project_id,
      conversation_id: conversationContext.conversation.conversation_id,
      turn_id: conversationContext.ids.turn_id,
      run_id: conversationContext.ids.run_id,
      task_id: conversationContext.ids.task_id,
    });
  }

  function inheritExecutionAdmissionContext(source, target) {
    const admissionContext = executionAdmissionContexts.get(source);
    if (admissionContext !== undefined) executionAdmissionContexts.set(target, admissionContext);
  }

  function recordSessionTaskAddressesFromWorkContext(conversationContext) {
    if (recordSessionTaskAddressesFromConversation === null) return;
    Reflect.apply(
      recordSessionTaskAddressesFromConversation,
      options.sessionTaskAddressRecordingService,
      [{ context: conversationContext }],
    );
  }

  function taskTargetForRequest(request, projectId) {
    if (resolveSessionTaskTarget === null) {
      if (request.task_address_id !== null) fail();
      return freezeDeep({
        project_id: projectId,
        task_address_id: null,
        conversation_id: createBuilderConversationAddress(
          projectId,
          safeUuid(Reflect.apply(options.createUuid, undefined, [])),
        ),
        should_record_task_address: true,
      });
    }
    const result = Reflect.apply(
      resolveSessionTaskTarget,
      options.sessionTaskTargetService,
      [{ project_id: projectId, task_address_id: request.task_address_id }],
    );
    exactObject(result, [
      'result_version',
      'operation',
      'project_id',
      'task_address_id',
      'conversation_id',
      'agent_id',
      'should_record_task_address',
      'authority',
    ]);
    const taskAddressId = valueAt(result, 'task_address_id');
    const shouldRecord = valueAt(result, 'should_record_task_address');
    if (
      valueAt(result, 'result_version') !== 'builder-session-task-target-result.v1'
      || valueAt(result, 'project_id') !== projectId
      || valueAt(result, 'authority') !== 'main_owned_task_target_resolution'
      || (taskAddressId !== null && !TASK_ADDRESS_ID_PATTERN.test(taskAddressId))
      || taskAddressId !== request.task_address_id
      || typeof shouldRecord !== 'boolean'
      || shouldRecord !== (taskAddressId === null)
    ) fail();
    return freezeDeep({
      project_id: projectId,
      task_address_id: taskAddressId,
      conversation_id: sanitizeBuilderConversationAddress(
        projectId,
        safePattern(valueAt(result, 'conversation_id'), CONVERSATION_ID_PATTERN, 96),
      ),
      should_record_task_address: shouldRecord,
    });
  }

  function bindQueuedFollowupWorkContextToCurrentTaskAddress(conversationContext, queuedFollowup) {
    if (bindQueuedFollowupWorkToCurrentTaskAddress === null) return;
    Reflect.apply(
      bindQueuedFollowupWorkToCurrentTaskAddress,
      options.sessionTaskAddressBindingService,
      [{ context: conversationContext, queued_followup: queuedFollowup }],
    );
  }

  function bindApprovedPlanContinuationContextToCurrentTaskAddress(conversationContext, editContext) {
    if (bindApprovedPlanContinuationToCurrentTaskAddress === null) return;
    Reflect.apply(
      bindApprovedPlanContinuationToCurrentTaskAddress,
      options.sessionTaskAddressBindingService,
      [{
        context: conversationContext,
        approved_plan_continuation: {
          project_id: editContext.project_id,
          conversation_id: editContext.conversation_id,
          approved_plan_turn_id: editContext.turn_id,
          approved_plan_task_id: editContext.task_id,
          approved_plan_run_id: editContext.run_id,
          continuation_id: editContext.continuation_id,
          continuation_admission_digest: editContext.continuation_admission_digest,
        },
      }],
    );
  }

  function bindDraftContinuationContextToCurrentTaskAddress(conversationContext, continuation) {
    if (bindDraftContinuationToCurrentTaskAddress === null) return;
    Reflect.apply(
      bindDraftContinuationToCurrentTaskAddress,
      options.sessionTaskAddressBindingService,
      [{
        context: conversationContext,
        draft_continuation: {
          project_id: continuation.admission.project_id,
          conversation_id: continuation.admission.conversation_id,
          draft_id: continuation.admission.draft_id,
          previous_turn_id: continuation.admission.previous_turn_id,
          previous_task_id: continuation.admission.previous_task_id,
          previous_run_id: continuation.admission.previous_run_id,
          continuation_id: continuation.admission.continuation_id,
          admission_digest: continuation.admission.admission_digest,
          candidate_digest: continuation.admission.candidate_digest,
        },
      }],
    );
  }

  function generationRequestFromApprovedPlan(editContext) {
    const unsigned = freezeDeep({
      version: 'builder-generation-request.v3',
      instruction: APPROVED_PLAN_EXECUTION_INSTRUCTION,
      existing_project_id: editContext.project_id,
      task_address_id: null,
    });
    return freezeDeep({
      ...unsigned,
      request_digest: sha256Canonical(unsigned),
    });
  }

  function sanitizeDraftContinuationGenerationRequest(rawRequest) {
    const keys = Reflect.ownKeys(rawRequest);
    const hasQueuedFollowup = keys.includes('queued_followup');
    exactObject(rawRequest, hasQueuedFollowup
      ? ['draft_id', 'instruction', 'queued_followup']
      : ['draft_id', 'instruction']);
    return freezeDeep({
      draft_id: safeDraftId(valueAt(rawRequest, 'draft_id')),
      instruction: valueAt(rawRequest, 'instruction'),
      queued_followup: hasQueuedFollowup
        ? sanitizeQueuedFollowupReference(valueAt(rawRequest, 'queued_followup'))
        : null,
    });
  }

  function sanitizeDraftAnswerGenerationRequest(rawRequest) {
    exactObject(rawRequest, ['draft_id', 'instruction', 'project_id']);
    return freezeDeep({
      draft_id: safeDraftId(valueAt(rawRequest, 'draft_id')),
      instruction: valueAt(rawRequest, 'instruction'),
      project_id: safeProjectId(valueAt(rawRequest, 'project_id')),
    });
  }

  async function loadVerifiedPendingDraftForQuestion(draftId) {
    const existingDraft = pendingDrafts.get(draftId);
    let conversationDraft;
    try {
      conversationDraft = sanitizeConversationDraft(
        Reflect.apply(
          readConversationCandidateDraft,
          options.conversationService,
          [{ draft_id: draftId }],
        ),
        draftId,
      );
      if (existingDraft !== undefined) assertConversationDraftMatchesPending(conversationDraft, existingDraft);
    } catch (error) {
      if (existingDraft !== undefined) pendingDrafts.delete(draftId);
      throw error;
    }
    const verifiedRead = await Reflect.apply(
      readVerifiedCandidate,
      options.gitAuthority,
      [conversationDraft.git_candidate_receipt],
    );
    const verifiedCandidate = sanitizeVerifiedCandidateRead(verifiedRead, conversationDraft.git_candidate_receipt);
      const draft = existingDraft === undefined
      ? freezeDeep({
        title: conversationDraft.title,
        summary: conversationDraft.summary,
        draft_id: draftId,
        git_request_id: conversationDraft.git_candidate_receipt.request_id,
        conversation_head: conversationDraft.conversation_head,
        candidate_proof: conversationDraft.candidate_proof,
        source_tree: verifiedCandidate.source_tree,
        restart_restore: 'git_sqlite_verified',
        current_materialization: conversationDraft.current_materialization,
      })
      : refreshPendingDraftConversationHead(existingDraft, conversationDraft.conversation_head);
    pendingDrafts.set(draftId, draft);
    return freezeDeep({
      draft,
      conversation_draft: conversationDraft,
      verified_candidate: verifiedCandidate,
      verified_candidate_read: verifiedRead,
    });
  }

  async function prepareDraftContinuationBasePair(draftId) {
    const verified = await loadVerifiedPendingDraftForQuestion(draftId);
    const admission = sanitizeBuilderDraftContinuationAdmission(
      createBuilderDraftContinuationAdmission({
        pending_draft: pendingDraftResult(verified.draft),
        continuation_id: newId(options.createUuid, 'builder-draft-continuation'),
        admitted_at_ms: safeTimestamp(Date.now()),
      }),
    );
    const base = sanitizeBuilderDraftContinuationBase(
      createBuilderDraftContinuationBase({
        admission,
        verified_candidate: verified.verified_candidate_read,
      }),
    );
    return freezeDeep({
      draft: verified.draft,
      conversation_draft: verified.conversation_draft,
      admission,
      base,
    });
  }

  async function buildGenerationContext(request) {
    let setupPhase = 'start';
    try {
      const key = operationKey(GENERATE_OPERATION_PREFIX, request.request_digest);
      setupPhase = 'approved_plan_context_lookup';
      const approvedPlanEditContext = pendingApprovedPlanEditContexts.get(key);
      if (approvedPlanEditContext !== undefined) {
        pendingApprovedPlanEditContexts.delete(key);
        if (
          request.existing_project_id !== approvedPlanEditContext.project_id
          || request.instruction !== APPROVED_PLAN_EXECUTION_INSTRUCTION
        ) fail();
        let conversationContext = Reflect.apply(
          beginApprovedPlanWork,
          options.conversationService,
          [{
            project_id: approvedPlanEditContext.project_id,
            conversation_id: approvedPlanEditContext.conversation_id,
            turn_id: approvedPlanEditContext.turn_id,
            run_id: approvedPlanEditContext.run_id,
            instruction: request.instruction,
            request_digest: request.request_digest,
            base_revision: approvedPlanEditContext.base_revision,
          }],
        );
        bindApprovedPlanContinuationContextToCurrentTaskAddress(
          conversationContext,
          approvedPlanEditContext,
        );
        conversationContext = await recordConversationContextSnapshot(
          conversationContext,
          approvedPlanEditContext.project_understanding,
        );
        activeContexts.set(key, conversationContext);
        retryableContexts.delete(key);
        notifyGenerationStarted(request, approvedPlanEditContext.project_id);
        const generationContext = generationContextFromConversation(
          request,
          {
            base_revision: approvedPlanEditContext.base_revision,
            base_revision_evidence: approvedPlanEditContext.base_revision_evidence,
            source_tree: approvedPlanEditContext.base_source_tree,
          },
          conversationContext,
          approvedPlanEditContext.approved_plan_public_text,
        );
        executionAdmissionContexts.set(generationContext, freezeDeep({
          edit_context: approvedPlanEditContext,
          run_context_snapshot: currentRunContextSnapshot(conversationContext),
        }));
        return generationContext;
      }
      setupPhase = 'retry_context_lookup';
      const retryableContext = pendingRetryContexts.get(key);
      if (retryableContext !== undefined) {
        pendingRetryContexts.delete(key);
        const failureCode = retryableContext.run_terminal_failure_code;
        if (retryableContext.mode !== 'work' || typeof failureCode !== 'string') fail();
        let retriedContext = Reflect.apply(
          retryConversationFailure,
          options.conversationService,
          [{ context: retryableContext, failure_code: failureCode }],
        );
        retriedContext = await recordConversationContextSnapshot(retriedContext);
        const base = await baseForGeneration(
          request,
          retriedContext.project.project_id,
          baseRevisionFromConversationContext(retriedContext),
        );
        activeContexts.set(key, retriedContext);
        notifyGenerationStarted(request, retriedContext.project.project_id);
        return generationContextFromConversation(request, base, retriedContext);
      }
      const existingProjectId = request.existing_project_id;
      const routeDecisionHint = pendingGenerateRouteDecisionHints.get(key)
        ?? buildRouteDecisionHint(['clear_build']);
      const queuedFollowup = pendingGenerateQueuedFollowups.get(key) ?? null;
      if (existingProjectId === null) fail('builder_generation_project_workspace_required');
      const projectId = existingProjectId;
      const taskTarget = taskTargetForRequest(request, projectId);
      if (queuedFollowup !== null && taskTarget.should_record_task_address) fail();
      setupPhase = 'load_existing_base';
      const base = await loadBaseForExistingProject(
        existingProjectId,
        loadCurrentProject,
        loadProjectIdentity,
        loadFreshWorkspace,
        options.projectReadAuthority,
        options.projectIdentityAuthority,
        options.workspaceReadAuthority,
      );
      const beginRequest = {
        project_id: projectId,
        conversation_id: taskTarget.conversation_id,
        instruction: request.instruction,
        request_digest: request.request_digest,
        base_revision: base.base_revision,
        route_decision_hint: queuedFollowup === null
          ? routeDecisionHint
          : withRouteDecisionMatchedSignal(routeDecisionHint, 'active_run_followup'),
      };
      setupPhase = queuedFollowup === null ? 'begin_work' : 'begin_queued_followup_work';
      let conversationContext = queuedFollowup === null
        ? Reflect.apply(
          beginConversationWork,
          options.conversationService,
          [beginRequest],
        )
        : Reflect.apply(
          beginQueuedFollowupWork,
          options.conversationService,
          [{
            ...beginRequest,
            queued_followup: queuedFollowup,
          }],
        );
      if (queuedFollowup === null && taskTarget.should_record_task_address) {
        setupPhase = 'record_session_task_address';
        recordSessionTaskAddressesFromWorkContext(conversationContext);
      } else if (queuedFollowup !== null) {
        setupPhase = 'bind_queued_followup_task_address';
        bindQueuedFollowupWorkContextToCurrentTaskAddress(conversationContext, queuedFollowup);
      }
      setupPhase = 'record_context_snapshot';
      conversationContext = await recordConversationContextSnapshot(conversationContext);
      setupPhase = 'activate_context';
      activeContexts.set(
        operationKey(GENERATE_OPERATION_PREFIX, request.request_digest),
        conversationContext,
      );
      retryableContexts.delete(key);
      notifyGenerationStarted(request, projectId);
      return generationContextFromConversation(request, base, conversationContext);
    } catch (error) {
      recordCanaryGenerationDebug(setupPhase, error);
      fail();
    }
  }

  async function buildDraftContinuationContext(request) {
    let setupPhase = 'lookup_continuation';
    try {
      const key = operationKey(DRAFT_CONTINUATION_OPERATION_PREFIX, request.request_digest);
      const continuation = pendingDraftContinuationContexts.get(key);
      if (continuation === undefined) fail();
      pendingDraftContinuationContexts.delete(key);
      if (
        request.existing_project_id !== continuation.admission.project_id
        || request.instruction !== continuation.instruction
      ) fail();
      setupPhase = 'begin_conversation_work';
      let conversationContext = Reflect.apply(
        beginDraftContinuationWork,
        options.conversationService,
        [{
          admission: continuation.admission,
          instruction: request.instruction,
          request_digest: request.request_digest,
          ...(continuation.queued_followup === null
            ? {}
            : { queued_followup: continuation.queued_followup }),
          }],
      );
      setupPhase = 'bind_task_address';
      bindDraftContinuationContextToCurrentTaskAddress(conversationContext, continuation);
      setupPhase = 'record_context_snapshot';
      conversationContext = await recordConversationContextSnapshot(conversationContext);
      setupPhase = 'read_candidate_base';
      const candidateBase = await baseForGeneration(
        request,
        conversationContext.project.project_id,
        baseRevisionFromConversationContext(conversationContext),
      );
      const context = freezeDeep({
        project_id: conversationContext.project.project_id,
        prompt_base_source_tree: continuation.base.base_source_tree,
        candidate_base_revision_evidence: candidateBase.base_revision_evidence,
        candidate_base_source_tree: candidateBase.source_tree,
        conversation_events: conversationContext.events,
        turn_id: conversationContext.ids.turn_id,
        task_id: conversationContext.ids.task_id,
        run_id: conversationContext.ids.run_id,
        git_request_id: newId(options.createUuid, 'builder-git-request'),
      });
      draftContinuationContexts.set(context, conversationContext);
      liveOutputContextsByRunId.set(conversationContext.ids.run_id, conversationContext);
      activeContexts.set(key, conversationContext);
      retryableContexts.delete(key);
      notifyGenerationStarted(request, conversationContext.project.project_id);
      return context;
    } catch (error) {
      recordCanaryGenerationDebug(`draft_continuation_context_${setupPhase}`, error);
      fail();
    }
  }

  async function buildExplanationContext(request) {
    try {
      const key = operationKey(ANSWER_OPERATION_PREFIX, request.request_digest);
      const routeDecisionHint = pendingAnswerRouteDecisionHints.get(key)
        ?? answerRouteDecisionHint(['read_only']);
      const queuedFollowup = pendingAnswerQueuedFollowups.get(key) ?? null;
      const draftAnswerContext = pendingDraftAnswerContexts.get(key);
      if (draftAnswerContext !== undefined) {
        if (queuedFollowup !== null) fail();
        pendingDraftAnswerContexts.delete(key);
        if (
          request.existing_project_id !== draftAnswerContext.project_id
          || request.instruction !== draftAnswerContext.instruction
        ) fail();
        let conversationContext = Reflect.apply(
          beginConversationQuestion,
          options.conversationService,
          [{
            project_id: draftAnswerContext.project_id,
            conversation_id: draftAnswerContext.conversation_id,
            question: request.instruction,
            request_digest: request.request_digest,
            base_revision: draftAnswerContext.base_revision,
            route_decision_hint: routeDecisionHint,
          }],
        );
        conversationContext = await recordConversationContextSnapshot(conversationContext);
        activeContexts.set(key, conversationContext);
        notifyGenerationStarted(request, draftAnswerContext.project_id);
        const explanationContext = freezeDeep({
          project_id: draftAnswerContext.project_id,
          base_revision_evidence: draftAnswerContext.base_revision_evidence,
          base_source_tree: draftAnswerContext.source_tree,
          conversation_events: conversationContext.events,
          turn_id: conversationContext.ids.turn_id,
          task_id: conversationContext.ids.task_id,
          run_id: conversationContext.ids.run_id,
        });
        explanationContexts.set(explanationContext, conversationContext);
        liveOutputContextsByRunId.set(conversationContext.ids.run_id, conversationContext);
        return explanationContext;
      }
      const existingProjectId = request.existing_project_id;
      if (existingProjectId === null) {
        if (
          options.agentConversationService === undefined
          || beginAgentConversationQuestion === null
          || queuedFollowup !== null && request.task_address_id !== null
        ) fail();
        const conversationContext = Reflect.apply(
          beginAgentConversationQuestion,
          options.agentConversationService,
          [{
            agent_id: valueAt(options.agentConversationService, 'agent_id'),
            question: request.instruction,
            request_digest: request.request_digest,
            route_decision_hint: queuedFollowup === null
              ? routeDecisionHint
              : withRouteDecisionMatchedSignal(routeDecisionHint, 'active_run_followup'),
          }],
        );
        activeContexts.set(key, conversationContext);
        notifyGenerationStarted(request, null);
        const explanationContext = freezeDeep({
          project_id: null,
          base_revision_evidence: null,
          base_source_tree: createBuilderProjectSourceTree({ files: [] }),
          conversation_events: conversationContext.events,
          turn_id: conversationContext.ids.turn_id,
          task_id: null,
          run_id: conversationContext.ids.run_id,
        });
        explanationContexts.set(explanationContext, conversationContext);
        liveOutputContextsByRunId.set(conversationContext.ids.run_id, conversationContext);
        return explanationContext;
      }
      const projectId = existingProjectId;
      const taskTarget = taskTargetForRequest(request, projectId);
      if (queuedFollowup !== null && taskTarget.should_record_task_address) fail();
      const base = await loadBaseForExistingProject(
        existingProjectId,
        loadCurrentProject,
        loadProjectIdentity,
        loadFreshWorkspace,
        options.projectReadAuthority,
        options.projectIdentityAuthority,
        options.workspaceReadAuthority,
      );
      const beginRequest = {
        project_id: projectId,
        conversation_id: taskTarget.conversation_id,
        question: request.instruction,
        request_digest: request.request_digest,
        base_revision: base.base_revision,
        route_decision_hint: queuedFollowup === null
          ? routeDecisionHint
          : withRouteDecisionMatchedSignal(routeDecisionHint, 'active_run_followup'),
      };
      let conversationContext = queuedFollowup === null
        ? Reflect.apply(
          beginConversationQuestion,
          options.conversationService,
          [beginRequest],
        )
        : Reflect.apply(
          beginQueuedFollowupQuestion,
          options.conversationService,
          [{
            ...beginRequest,
            queued_followup: queuedFollowup,
          }],
        );
      if (queuedFollowup === null && taskTarget.should_record_task_address) {
        recordSessionTaskAddressesFromWorkContext(conversationContext);
      }
      conversationContext = await recordConversationContextSnapshot(conversationContext);
      activeContexts.set(
        operationKey(ANSWER_OPERATION_PREFIX, request.request_digest),
        conversationContext,
      );
      notifyGenerationStarted(request, projectId);
      const explanationContext = freezeDeep({
        project_id: projectId,
        base_revision_evidence: base.base_revision_evidence,
        base_source_tree: base.source_tree,
        conversation_events: conversationContext.events,
        turn_id: conversationContext.ids.turn_id,
        task_id: conversationContext.ids.task_id,
        run_id: conversationContext.ids.run_id,
      });
      explanationContexts.set(explanationContext, conversationContext);
      liveOutputContextsByRunId.set(conversationContext.ids.run_id, conversationContext);
      return explanationContext;
    } catch {
      fail();
    }
  }

  async function buildPlanContext(request) {
    let setupPhase = 'plan_start';
    try {
      if (collectProjectSourceContext === null || request.existing_project_id === null) fail();
      const key = operationKey(PLAN_OPERATION_PREFIX, request.request_digest);
      setupPhase = 'plan_pending_context_lookup';
      const pendingPlan = pendingPlanRequests.get(key);
      if (pendingPlan === undefined) fail();
      pendingPlanRequests.delete(key);
      const projectId = request.existing_project_id;
      const taskTarget = taskTargetForRequest(request, projectId);
      setupPhase = 'plan_load_existing_base';
      const base = await loadBaseForExistingProject(
        projectId,
        loadCurrentProject,
        loadProjectIdentity,
        loadFreshWorkspace,
        options.projectReadAuthority,
        options.projectIdentityAuthority,
        options.workspaceReadAuthority,
      );
      let projectUnderstanding = null;
      if (refreshProjectUnderstanding !== null) {
        setupPhase = 'plan_refresh_project_understanding';
        try {
          projectUnderstanding = sanitizeProjectUnderstandingRefreshResult(
            await Reflect.apply(refreshProjectUnderstanding, options.projectUnderstandingService, [{
              project_id: projectId,
            }]),
            projectId,
            base.source_tree.source_tree_digest,
          );
        } catch (error) {
          recordCanaryGenerationDebug('plan_project_understanding_unavailable', error);
        }
      }
      setupPhase = 'plan_begin_work';
      let conversationContext = Reflect.apply(
        beginConversationWork,
        options.conversationService,
        [{
          project_id: projectId,
          conversation_id: taskTarget.conversation_id,
          instruction: request.instruction,
          request_digest: request.request_digest,
          base_revision: base.base_revision,
          route_decision_hint: pendingPlan.route_decision_hint,
        }],
      );
      if (taskTarget.should_record_task_address) {
        setupPhase = 'plan_record_session_task_address';
        recordSessionTaskAddressesFromWorkContext(conversationContext);
      }
      setupPhase = 'plan_record_context_snapshot';
      conversationContext = await recordConversationContextSnapshot(
        conversationContext,
        projectUnderstanding,
      );
      setupPhase = 'plan_activate_context';
      activeContexts.set(key, conversationContext);
      retryableContexts.delete(key);
      notifyGenerationStarted(request, projectId);
      setupPhase = 'plan_collect_source_context';
      const sourceContextResult = await Reflect.apply(collectProjectSourceContext, options.sourceContextCollector, [{
        context: conversationContext,
        resource_ids: pendingPlan.resource_ids,
      }]);
      setupPhase = 'plan_sanitize_source_context';
      sanitizeBuilderPlanProposalSourceContextResult(sourceContextResult);
      const sourceContextConversation = valueAt(sourceContextResult, 'context');
      const sourceContextIds = valueAt(sourceContextConversation, 'ids');
      const context = freezeDeep({
        project_id: projectId,
        source_context_result: sourceContextResult,
        conversation_events: valueAt(sourceContextConversation, 'events'),
        turn_id: valueAt(sourceContextIds, 'turn_id'),
        task_id: valueAt(sourceContextIds, 'task_id'),
        run_id: valueAt(sourceContextIds, 'run_id'),
        proposed_at_ms: safeTimestamp(Date.now()),
      });
      planContexts.set(context, sourceContextResult);
      activeContexts.set(key, sourceContextConversation);
      liveOutputContextsByRunId.set(valueAt(sourceContextIds, 'run_id'), sourceContextConversation);
      return context;
    } catch (error) {
      recordCanaryGenerationDebug(setupPhase, error);
      fail();
    }
  }

  async function admitProviderDispatch({ context, provider_config_digest: providerConfigDigest }) {
      const admittedProviderConfigDigest = safeDigest(providerConfigDigest);
      const runtimeConversationContext = latestConversationContext(
        context,
        generationContexts.get(context) ?? draftContinuationContexts.get(context),
      );
      if (runtimeConversationContext !== undefined && runtimeConversationContext.mode === 'work') {
        providerConfigDigestsByRunId.set(
          runtimeConversationContext.ids.run_id,
          admittedProviderConfigDigest,
        );
      }
      const pending = executionAdmissionContexts.get(context);
      if (pending === undefined) return context;
      executionAdmissionContexts.delete(context);
      const admittedAtMs = safeTimestamp(Date.now());
      const executionApproval = createBuilderExecutionApproval({
        approved_plan_continuation: pending.edit_context.approved_plan_continuation,
        write_permission_decision: pending.edit_context.write_permission_decision,
        provider_config_digest: admittedProviderConfigDigest,
        source_tree_digest: pending.edit_context.base_source_tree.source_tree_digest,
        project_understanding: pending.edit_context.project_understanding,
        approved_at_ms: admittedAtMs,
        expires_at_ms: admittedAtMs + 30_000,
      });
      const programmingRunAdmission = createBuilderProgrammingRunAdmission({
        execution_approval: executionApproval,
        run_context_snapshot: pending.run_context_snapshot,
        admitted_at_ms: admittedAtMs,
      });
      const conversationContext = latestConversationContext(context, generationContexts.get(context));
      if (conversationContext === undefined) fail();
      const admittedConversationContext = Reflect.apply(
        recordProgrammingRunAdmission,
        options.conversationService,
        [{
          context: conversationContext,
          execution_approval: executionApproval,
          programming_run_admission: programmingRunAdmission,
        }],
      );
      const admittedContext = freezeDeep({
        ...context,
        conversation_events: admittedConversationContext.events,
      });
      inheritLiveOutputState(context, admittedContext);
      generationContexts.set(admittedContext, admittedConversationContext);
      liveOutputContextsByRunId.set(admittedConversationContext.ids.run_id, admittedConversationContext);
      activeContexts.set(
        operationKey(GENERATE_OPERATION_PREFIX, admittedConversationContext.request_digest),
        admittedConversationContext,
      );
      return admittedContext;
  }

  const host = createBuilderGenerationHostAdapter({
    readProviderConfig,
    resolveSecret,
    buildGenerationContext,
    buildDraftContinuationContext,
    buildExplanationContext,
    buildPlanContext,
    admitProviderDispatch,
    onProgress({ context, stage }) {
      const generationContext = latestConversationContext(context, generationContexts.get(context));
      if (generationContext !== undefined) {
        const progressed = Reflect.apply(
          recordConversationRunProgress,
          options.conversationService,
          [{ context: generationContext, stage }],
        );
        const updated = freezeDeep({
          ...context,
          conversation_events: progressed.events,
        });
        inheritLiveOutputState(context, updated);
        inheritExecutionAdmissionContext(context, updated);
        generationContexts.set(updated, progressed);
        liveOutputContextsByRunId.set(progressed.ids.run_id, progressed);
        activeContexts.set(
          operationKey(GENERATE_OPERATION_PREFIX, generationContext.request_digest),
          progressed,
        );
        return updated;
      }
      const draftContinuationContext = latestConversationContext(
        context,
        draftContinuationContexts.get(context),
      );
      if (draftContinuationContext !== undefined) {
        const progressed = Reflect.apply(
          recordConversationRunProgress,
          options.conversationService,
          [{ context: draftContinuationContext, stage }],
        );
        const updated = freezeDeep({
          ...context,
          conversation_events: progressed.events,
        });
        inheritLiveOutputState(context, updated);
        draftContinuationContexts.set(updated, progressed);
        liveOutputContextsByRunId.set(progressed.ids.run_id, progressed);
        activeContexts.set(
          operationKey(DRAFT_CONTINUATION_OPERATION_PREFIX, draftContinuationContext.request_digest),
          progressed,
        );
        return updated;
      }
      const explanationContext = latestConversationContext(context, explanationContexts.get(context));
      if (explanationContext !== undefined) {
        const progressed = applyConversationContextMethod(
          explanationContext,
          recordConversationRunProgress,
          recordAgentConversationRunProgress,
          { context: explanationContext, stage },
        );
        const updated = freezeDeep({
          ...context,
          conversation_events: progressed.events,
        });
        inheritLiveOutputState(context, updated);
        explanationContexts.set(updated, progressed);
        liveOutputContextsByRunId.set(progressed.ids.run_id, progressed);
        activeContexts.set(
          operationKey(ANSWER_OPERATION_PREFIX, explanationContext.request_digest),
          progressed,
        );
        return updated;
      }
      const planSourceContextResult = planContexts.get(context);
      if (planSourceContextResult !== undefined) {
        const planConversationContext = latestConversationContext(
          context,
          valueAt(planSourceContextResult, 'context'),
        );
        if (planConversationContext === undefined) fail();
        const progressed = Reflect.apply(
          recordConversationRunProgress,
          options.conversationService,
          [{ context: planConversationContext, stage }],
        );
        const updatedSourceContextResult = freezeDeep({
          ...planSourceContextResult,
          context: progressed,
        });
        const updated = freezeDeep({
          ...context,
          source_context_result: updatedSourceContextResult,
          conversation_events: progressed.events,
        });
        inheritLiveOutputState(context, updated);
        planContexts.set(updated, updatedSourceContextResult);
        liveOutputContextsByRunId.set(progressed.ids.run_id, progressed);
        activeContexts.set(
          operationKey(PLAN_OPERATION_PREFIX, planConversationContext.request_digest),
          progressed,
        );
        return updated;
      }
      fail();
    },
    ...(Object.hasOwn(options, 'onProviderOutputDelta')
      ? {
        onOutputDelta({ context, delta_text: deltaText }) {
          notifyProviderOutputDelta(context, deltaText);
        },
      }
      : {}),
    ...(Object.hasOwn(options, 'transport') ? { transport: options.transport } : {}),
  });

  function publicExplanationResult(answer, request) {
    const context = valueAt(answer, 'context');
    return freezeDeep({
      version: answer.version,
      result_kind: 'explanation',
      request_id: answer.request_id,
      project_id: valueAt(context, 'project_id'),
      existing_project_id: request.existing_project_id,
      title: answer.title,
      summary: answer.summary,
      explanation: answer.explanation,
      admissions: {
        conversation: 'sqlite_recorded',
        draft: 'not_created',
        save: 'not_performed',
        preview: 'not_applicable',
        execution: 'not_evaluated',
      },
    });
  }

  function publicHarnessWorkResponse(runnerResult, request, context) {
    return freezeDeep({
      version: BUILDER_GENERATION_RESULT_PROTOCOL,
      result_kind: 'explanation',
      request_id: request.request_digest,
      project_id: context.project_id,
      existing_project_id: request.existing_project_id,
      title: 'Request completed',
      summary: runnerResult.summary,
      explanation: runnerResult.assistant_text,
      admissions: {
        conversation: 'sqlite_recorded',
        draft: 'not_created',
        save: 'not_performed',
        preview: 'not_applicable',
        execution: 'not_evaluated',
      },
    });
  }

  function recordTaskCapsuleFromExplanationTerminal(conversationContext, terminal) {
    if (recordTaskCapsuleFromConversation === null || isAgentConversationContext(conversationContext)) return;
    const events = valueAt(terminal, 'events');
    if (!Array.isArray(events)) fail();
    const targets = events.filter((event) => (
      event
      && typeof event === 'object'
      && !utilTypes.isProxy(event)
      && valueAt(event, 'event_type') === 'task_brief_updated'
      && valueAt(event, 'sequence') > conversationContext.start_head.sequence
      && valueAt(valueAt(valueAt(event, 'payload'), 'task_capsule'), 'status') === 'ready'
    ));
    if (targets.length === 0) return;
    if (targets.length !== 1) fail();
    Reflect.apply(
      recordTaskCapsuleFromConversation,
      options.taskCapsuleRecordingService,
      [{
        events,
        target_sequence: valueAt(targets[0], 'sequence'),
      }],
    );
  }

  async function createLocalCasualChatExplanation(request, reply) {
    const context = await buildExplanationContext(request);
    const answer = projectBuilderExplanationResult({
      request,
      generated_text: JSON.stringify({
        kind: BUILDER_GENERATED_EXPLANATION_KIND,
        title: reply.title,
        summary: reply.summary,
        explanation: reply.explanation,
      }),
    });
    return freezeDeep({ ...answer, context });
  }

  function failureCodeFrom(error) {
    if (error && typeof error === 'object' && !utilTypes.isProxy(error)) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
        if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') {
          return descriptor.value;
        }
      } catch {
        return 'builder_generation_failed';
      }
    }
    return 'builder_generation_failed';
  }

  function publicHarnessFailure(error) {
    if (
      failureCodeFrom(error) === 'builder_harness_generation_runner_failed'
      && error
      && typeof error === 'object'
      && !utilTypes.isProxy(error)
    ) {
      try {
        const runtimeCode = Object.getOwnPropertyDescriptor(error, 'runtime_code');
        if (runtimeCode && Object.hasOwn(runtimeCode, 'value')) {
          if (runtimeCode.value === 'builder_harness_programming_runtime_timeout') {
            return new BuilderGenerationMainServiceError('builder_generation_timeout');
          }
          if (runtimeCode.value === 'builder_harness_programming_runtime_idle_timeout') {
            return new BuilderGenerationMainServiceError('builder_generation_runtime_stalled');
          }
          if (runtimeCode.value === 'builder_harness_programming_run_limit_reached') {
            return new BuilderGenerationMainServiceError('builder_generation_run_limit_reached');
          }
        }
      } catch {
        return error;
      }
    }
    return error;
  }

  function recordFailure(key, error) {
    const conversationContext = activeContexts.get(key);
    if (conversationContext === undefined) return;
    try {
      const failureCode = failureCodeFrom(error);
      if (
        failureCode === 'builder_generation_cancelled'
        && cancellationTerminalOperationKeys.has(key)
      ) return;
      if (
        failureCode === 'builder_generation_cancelled'
        && !isAgentConversationContext(conversationContext)
      ) {
        Reflect.apply(
          completeConversationFailure,
          options.conversationService,
          [{ context: conversationContext, failure_code: failureCode }],
        );
        retryableContexts.delete(key);
        clearProviderContextDisclosureStatusForContext(conversationContext);
        return;
      }
      const failedContext = applyConversationContextMethod(
        conversationContext,
        recordConversationRetryableFailure,
        recordAgentConversationRetryableFailure,
        { context: conversationContext, failure_code: failureCode },
      );
      retryableContexts.set(key, failedContext);
      clearProviderContextDisclosureStatusForContext(failedContext);
    } catch {
      throw new BuilderGenerationMainServiceError();
    }
  }

  function completeAcceptedCancellation(key, context) {
    if (cancellationTerminalOperationKeys.has(key)) return context;
    if (isAgentConversationContext(context)) {
      const completedContext = applyConversationContextMethod(
        context,
        recordConversationRetryableFailure,
        recordAgentConversationRetryableFailure,
        { context, failure_code: 'builder_generation_cancelled' },
      );
      cancellationTerminalOperationKeys.add(key);
      return completedContext;
    }
    Reflect.apply(
      completeConversationFailure,
      options.conversationService,
      [{ context, failure_code: 'builder_generation_cancelled' }],
    );
    cancellationTerminalOperationKeys.add(key);
    return context;
  }

  function recordRecoveryActionForOperation(key, action, phase) {
    const conversationContext = activeContexts.get(key);
    if (conversationContext === undefined) return false;
    try {
      const recordedContext = Reflect.apply(
        recordConversationRecoveryAction,
        options.conversationService,
        [{ context: conversationContext, action, phase }],
      );
      activeContexts.set(key, recordedContext);
      return true;
    } catch (error) {
      recordCanaryGenerationDebug('recovery_action_record_failed', error);
      return false;
    }
  }

  async function admitCandidateWorkspaceGuard(
    candidate,
    existingProjectId,
    expectedWorkspaceSourceTreeDigest = candidate.base_source_tree.source_tree_digest,
  ) {
    const editIntentPlan = createBuilderEditIntentPlan({
      candidate,
      created_at_ms: safeTimestamp(Date.now()),
    });
    let observed;
    if (existingProjectId === null) {
      observed = freezeDeep({ source_tree: candidate.base_source_tree });
    } else if (existingProjectId !== candidate.project_id) {
      fail('builder_generation_workspace_changed');
    } else if (loadFreshWorkspace !== null) {
      observed = sanitizeLocalWorkspaceReadResult(
        await Reflect.apply(loadFreshWorkspace, options.workspaceReadAuthority, [{
          project_id: candidate.project_id,
        }]),
        candidate.project_id,
      );
    } else {
      observed = freezeDeep({ source_tree: candidate.base_source_tree });
    }
    const report = evaluateBuilderWorkspaceGuard({
      candidate,
      edit_intent_plan: editIntentPlan,
      observed_workspace_source_tree: observed.source_tree,
      expected_workspace_source_tree_digest: expectedWorkspaceSourceTreeDigest,
      evaluated_at_ms: safeTimestamp(Date.now()),
    });
    if (report.status === 'allowed') {
      const editAttempt = createBuilderEditAttempt({
        candidate,
        edit_intent_plan: editIntentPlan,
        workspace_guard_report: report,
        attempted_at_ms: safeTimestamp(Date.now()),
      });
      return freezeDeep({ edit_intent_plan: editIntentPlan, report, edit_attempt: editAttempt });
    }
    if (report.summary.workspace_conflict_count > 0) fail('builder_generation_workspace_changed');
    if (report.status === 'approval_required') {
      fail('builder_generation_workspace_guard_approval_required');
    }
    fail('builder_generation_workspace_guard_denied');
  }

  async function prepareApprovedPlanEditContext(rawRequest) {
    let setupPhase = 'approved_plan_prepare_start';
    try {
      setupPhase = 'approved_plan_prepare_sanitize_request';
      const request = sanitizeApprovedPlanEditRequest(rawRequest);
      setupPhase = 'approved_plan_prepare_read_plan';
      const approvedPlan = sanitizeApprovedPlanReadResult(
        Reflect.apply(readApprovedPlan, options.conversationService, [request]),
        request,
      );
      setupPhase = 'approved_plan_prepare_admit_continuation';
      const continuationAdmission = sanitizeBuilderApprovedPlanContinuationAdmission(
        Reflect.apply(admitApprovedPlanContinuation, options.conversationService, [request]),
      );
      setupPhase = 'approved_plan_prepare_match_admission';
      if (
        continuationAdmission.project_id !== request.project_id
        || continuationAdmission.conversation_id !== request.conversation_id
        || continuationAdmission.turn_id !== request.turn_id
        || continuationAdmission.run_id !== request.run_id
        || continuationAdmission.task_id !== approvedPlan.task_id
        || continuationAdmission.plan_result_digest !== approvedPlan.plan_result_digest
        || continuationAdmission.conversation_head.sequence !== approvedPlan.conversation_head.sequence
        || continuationAdmission.conversation_head.event_id !== approvedPlan.conversation_head.event_id
        || continuationAdmission.conversation_head.event_digest !== approvedPlan.conversation_head.event_digest
      ) fail();
      setupPhase = 'approved_plan_prepare_load_current_project';
      const base = sanitizeCurrentOrLocalWorkspaceReadResult(
        await Reflect.apply(loadCurrentProject, options.projectReadAuthority, [{ project_id: request.project_id }]),
        request.project_id,
      );
      let projectUnderstanding = null;
      if (refreshProjectUnderstanding !== null) {
        setupPhase = 'approved_plan_prepare_refresh_project_understanding';
        projectUnderstanding = sanitizeProjectUnderstandingRefreshResult(
          await Reflect.apply(refreshProjectUnderstanding, options.projectUnderstandingService, [{
            project_id: request.project_id,
          }]),
          request.project_id,
          base.source_tree.source_tree_digest,
        );
      }
      setupPhase = 'approved_plan_prepare_return_context';
      return freezeDeep({
        context_version: 'builder-approved-plan-edit-context.v1',
        project_id: request.project_id,
        conversation_id: request.conversation_id,
        turn_id: request.turn_id,
        task_id: continuationAdmission.task_id,
        run_id: request.run_id,
        plan_result_digest: continuationAdmission.plan_result_digest,
        approved_plan_public_text: approvedPlan.approved_plan_public_text,
        conversation_head: { ...continuationAdmission.conversation_head },
        continuation_id: continuationAdmission.continuation_id,
        continuation_admission_digest: continuationAdmission.admission_digest,
        approved_plan_continuation: continuationAdmission,
        project_understanding: projectUnderstanding,
        base_revision: base.base_revision === null ? null : { ...base.base_revision },
        base_revision_evidence: base.base_revision_evidence === null ? null : { ...base.base_revision_evidence },
        base_source_tree: base.source_tree,
        lifecycle: {
          approved_plan_continuation: 'fresh_current_head_verified',
          approved_plan_public_text: 'sqlite_public_assistant_message_verified',
          source_read: base.base_revision === null
            ? 'selected_workspace_source_verified'
            : 'git_sqlite_current_verified',
          provider_dispatch: 'not_started',
          tool_dispatch: 'not_started',
          source_mutation: 'not_performed',
          git_candidate: 'not_created',
          revision_admission: 'not_created',
        },
        authority: {
          context_authority: 'main_generation_approved_plan_edit_context_v1',
          conversation_binding: 'fresh_approved_plan_continuation_required',
          approved_plan_text_authority: 'sqlite_replay_public_assistant_message',
          project_read_authority: base.base_revision === null
            ? 'main_selected_workspace_source_verified'
            : 'git_sqlite_current_source_verified',
          renderer_authority: 'not_present',
          provider_dispatch: false,
          credential_readback: false,
          tool_dispatch: 'not_performed',
          source_mutation: 'not_performed',
          git_authority: 'not_present',
          revision_authority: 'not_present',
        },
      });
    } catch (error) {
      recordCanaryGenerationDebug(setupPhase, error);
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail();
    }
  }

  function restoreRevisionRequestDigest(request, current, target) {
    return sha256Canonical({
      request_version: 'builder-generation-restore-revision-request.v1',
      project_id: request.project_id,
      current_revision: current.base_revision,
      target_revision: target.base_revision,
      target_source_tree_digest: target.source_tree.source_tree_digest,
    });
  }

  function restoreRevisionPublicRequest(request, requestDigest) {
    return freezeDeep({
      version: 'builder-generation-request.v3',
      instruction: 'Restore the selected saved version.',
      existing_project_id: request.project_id,
      task_address_id: null,
      request_digest: requestDigest,
    });
  }

  function restoreCheckpointPublicRequest(projectId, requestDigest) {
    return freezeDeep({
      version: 'builder-generation-request.v3',
      instruction: 'Undo the latest AI change.',
      existing_project_id: projectId,
      task_address_id: null,
      request_digest: requestDigest,
    });
  }

  async function restoreRevisionAsDraft(rawRequest) {
    let key = null;
    try {
      const request = sanitizeRestoreRevisionRequest(rawRequest);
      const loadRevisionProject = ownMethod(options.projectReadAuthority, 'load_revision');
      const current = sanitizeReadResult(
        await Reflect.apply(loadCurrentProject, options.projectReadAuthority, [{
          project_id: request.project_id,
        }]),
        request.project_id,
      );
      const target = sanitizeReadResult(
        await Reflect.apply(loadRevisionProject, options.projectReadAuthority, [{
          project_id: request.project_id,
          revision_receipt_digest: request.revision_receipt_digest,
        }]),
        request.project_id,
        'revision_loaded',
      );
      if (target.base_revision.revision_receipt_digest !== request.revision_receipt_digest) fail();
      const operations = operationsToReachSourceTree(current.source_tree, target.source_tree);
      const requestDigest = restoreRevisionRequestDigest(request, current, target);
      key = operationKey(RESTORE_REVISION_OPERATION_PREFIX, requestDigest);
      if (inFlight.has(key)) return inFlight.get(key);
      const routeConflict = rejectIfOtherRouteInFlight(
        RESTORE_REVISION_OPERATION_PREFIX,
        requestDigest,
      );
      if (routeConflict) return routeConflict;
      const publicRequest = restoreRevisionPublicRequest(request, requestDigest);
      const taskTarget = taskTargetForRequest({ task_address_id: null }, request.project_id);
      const operation = (async () => {
        let conversationContext = Reflect.apply(
          beginConversationWork,
          options.conversationService,
          [{
            project_id: request.project_id,
            conversation_id: taskTarget.conversation_id,
            instruction: publicRequest.instruction,
            request_digest: requestDigest,
            base_revision: current.base_revision,
          }],
        );
        recordSessionTaskAddressesFromWorkContext(conversationContext);
        activeContexts.set(key, conversationContext);
        conversationContext = await recordConversationContextSnapshot(conversationContext);
        activeContexts.set(key, conversationContext);
        conversationContext = Reflect.apply(
          recordConversationRecoveryAction,
          options.conversationService,
          [{ context: conversationContext, action: 'restore_revision', phase: 'requested' }],
        );
        activeContexts.set(key, conversationContext);
        conversationContext = Reflect.apply(
          recordConversationRunProgress,
          options.conversationService,
          [{ context: conversationContext, stage: 'context_ready' }],
        );
        activeContexts.set(key, conversationContext);
        liveOutputContextsByRunId.set(conversationContext.ids.run_id, conversationContext);

        const candidate = createBuilderCodeChangeCandidate({
          conversation_events: conversationContext.events,
          turn_id: conversationContext.ids.turn_id,
          run_id: conversationContext.ids.run_id,
          base_revision_evidence: current.base_revision_evidence,
          base_source_tree: current.source_tree,
          operations,
        });
        const gitRequestId = newId(options.createUuid, 'builder-git-request');
        const draftId = `builder-generation-draft:${sha256Canonical({
          draft_version: BUILDER_GENERATION_PENDING_DRAFT_VERSION,
          request_id: requestDigest,
          candidate_id: candidate.candidate_id,
          candidate_digest: candidate.candidate_digest,
          run_id: candidate.run_id,
          restore_revision_receipt_digest: request.revision_receipt_digest,
        }).slice('sha256:'.length)}`;
        const editEvidence = await admitCandidateWorkspaceGuard(candidate, request.project_id);
        const gitCandidateReceipt = await Reflect.apply(
          persistCandidateCommit,
          options.gitAuthority,
          [{
            request_id: gitRequestId,
            expected_base_oid: candidate.base_revision_evidence === null
              ? null
              : candidate.base_revision_evidence.commit_oid,
            candidate,
          }],
        );
        const gitVerificationReceipt = await Reflect.apply(
          verifyCandidateReceipt,
          options.gitAuthority,
          [gitCandidateReceipt],
        );
        const receiptPair = sanitizeBuilderGitCandidateReceiptPair(
          gitCandidateReceipt,
          gitVerificationReceipt,
        );
        const title = 'Restored saved version';
        const summary = 'Review this restored draft before saving it as a new version.';
        conversationContext = recordAutomaticDraftCheckpoint(
          key,
          conversationContext,
          candidate,
          receiptPair,
          summary,
          editEvidence.edit_attempt,
        );
        const currentMaterialization = await materializeCandidateToCurrentWorkspace(receiptPair);
        conversationContext = Reflect.apply(
          recordConversationRecoveryAction,
          options.conversationService,
          [{ context: conversationContext, action: 'restore_revision', phase: 'completed' }],
        );
        activeContexts.set(key, conversationContext);
        const recorded = Reflect.apply(
          completeConversationCandidate,
          options.conversationService,
          [{
            context: conversationContext,
            candidate_result: {
              draft_id: draftId,
              title,
              summary,
              git_candidate_receipt: receiptPair.candidate_receipt,
              current_materialization: conversationCurrentMaterialization(currentMaterialization),
            },
            assistant_text: summary,
          }],
        );
        const stored = freezeDeep({
          version: BUILDER_GENERATION_RESULT_PROTOCOL,
          request_id: requestDigest,
          title,
          summary,
          admissions: {
            conversation: 'sqlite_recorded',
            draft: 'candidate_not_saved',
            save: 'not_performed',
            preview: 'not_evaluated',
            execution: 'not_evaluated',
          },
          candidate,
          candidate_proof: {
            ...candidateProofFromCandidate(candidate),
            git_request_id: gitRequestId,
          },
          draft_id: draftId,
          request: publicRequest,
          git_request_id: gitRequestId,
          conversation_head: recorded.head,
          restart_restore: 'not_persisted',
          current_materialization: currentMaterialization,
        });
        pendingDrafts.set(draftId, stored);
        return publicDraftResult(stored);
      })().catch((error) => {
        if (key !== null) {
          recordRecoveryActionForOperation(key, 'restore_revision', 'failed');
          recordFailure(key, error);
        }
        if (error instanceof BuilderGenerationMainServiceError) throw error;
        throw new BuilderGenerationMainServiceError();
      }).finally(() => {
        clearProviderContextDisclosureStatusForKey(key);
        activeContexts.delete(key);
        cancellationTerminalOperationKeys.delete(key);
        if (inFlight.get(key) === operation) inFlight.delete(key);
      });
      inFlight.set(key, operation);
      return operation;
    } catch (error) {
      recordCanaryGenerationDebug('restore_candidate_prepare', error);
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail();
    }
  }

  async function restorePreviousCheckpointAsDraft(rawRequest) {
    let key = null;
    try {
      exactObject(rawRequest, ['draft_id', 'project_id']);
      const previousDraftId = safeDraftId(valueAt(rawRequest, 'draft_id'));
      const selectedProjectId = safeProjectId(valueAt(rawRequest, 'project_id'));
      if (preparePreviousCheckpointRestore === null) {
        fail('builder_generation_checkpoint_undo_unavailable');
      }
      const previousDraft = await loadPendingDraftById(previousDraftId);
      const proof = previousDraft.candidate_proof;
      if (proof.project_id !== selectedProjectId) {
        fail('builder_generation_project_workspace_required');
      }
      const previousDraftReceipt = sanitizeConversationDraft(
        Reflect.apply(
          readConversationCandidateDraft,
          options.conversationService,
          [{ draft_id: previousDraftId }],
        ),
        previousDraftId,
      ).git_candidate_receipt;
      if (
        previousDraftReceipt.candidate_id !== proof.candidate_id
        || previousDraftReceipt.candidate_digest !== proof.candidate_digest
      ) fail();
      const prepared = Reflect.apply(
        preparePreviousCheckpointRestore,
        options.automaticDraftCheckpointService,
        [{
          project_id: proof.project_id,
          conversation_id: proof.conversation_id,
          candidate_id: proof.candidate_id,
        }],
      );
      const preparedStatus = valueAt(prepared, 'status');
      if (preparedStatus === 'baseline') {
        const rejected = sanitizeConversationCandidateReject(
          Reflect.apply(
            rejectConversationCandidate,
            options.conversationService,
            [{ draft_id: previousDraftId }],
          ),
          previousDraftId,
        );
        pendingDrafts.delete(previousDraftId);
        return freezeDeep({
          result_version: 'builder-generation-draft-undo-result.v1',
          operation: 'draft_baseline_restored',
          draft_id: previousDraftId,
          project_id: rejected.project_id,
          pending_draft_released: true,
          conversation_event_admission: rejected.rejection_admission,
        });
      }
      if (preparedStatus !== 'ready') fail('builder_generation_checkpoint_undo_unavailable');
      const targetCheckpoint = valueAt(prepared, 'target_checkpoint');
      const targetReceipt = candidateReceiptFromCheckpoint(targetCheckpoint);
      const target = sanitizeVerifiedCandidateRead(
        await Reflect.apply(readVerifiedCandidate, options.gitAuthority, [targetReceipt]),
        targetReceipt,
      );
      const candidateBase = sanitizeVerifiedCandidateBaseRead(
        await Reflect.apply(
          readVerifiedCandidateBase,
          options.gitAuthority,
          [previousDraftReceipt],
        ),
        previousDraftReceipt,
      );
      const base = freezeDeep({
        source_tree: candidateBase.source_tree,
        base_revision: proof.base_revision,
        base_revision_evidence: await baseRevisionEvidenceForRestoredDraft(proof),
      });
      const operations = operationsToReachSourceTree(base.source_tree, target.source_tree);
      const requestDigest = sha256Canonical({
        request_version: 'builder-generation-restore-checkpoint-request.v1',
        project_id: proof.project_id,
        previous_draft_id: previousDraftId,
        previous_candidate_id: proof.candidate_id,
        target_checkpoint_id: valueAt(targetCheckpoint, 'checkpoint_id'),
        target_tree_digest: target.source_tree.source_tree_digest,
      });
      key = operationKey(RESTORE_CHECKPOINT_OPERATION_PREFIX, requestDigest);
      if (inFlight.has(key)) return inFlight.get(key);
      const routeConflict = rejectIfOtherRouteInFlight(
        RESTORE_CHECKPOINT_OPERATION_PREFIX,
        requestDigest,
      );
      if (routeConflict) return routeConflict;
      const publicRequest = restoreCheckpointPublicRequest(proof.project_id, requestDigest);
      const operation = (async () => {
        let conversationContext = Reflect.apply(
          beginConversationWork,
          options.conversationService,
          [{
            project_id: proof.project_id,
            conversation_id: proof.conversation_id,
            instruction: 'Undo the latest AI change.',
            request_digest: requestDigest,
            base_revision: base.base_revision,
          }],
        );
        activeContexts.set(key, conversationContext);
        conversationContext = await recordConversationContextSnapshot(conversationContext);
        activeContexts.set(key, conversationContext);
        conversationContext = Reflect.apply(
          recordConversationRecoveryAction,
          options.conversationService,
          [{ context: conversationContext, action: 'restore_checkpoint', phase: 'requested' }],
        );
        activeContexts.set(key, conversationContext);
        conversationContext = Reflect.apply(
          recordConversationRunProgress,
          options.conversationService,
          [{ context: conversationContext, stage: 'context_ready' }],
        );
        activeContexts.set(key, conversationContext);
        liveOutputContextsByRunId.set(conversationContext.ids.run_id, conversationContext);

        const candidate = createBuilderCodeChangeCandidate({
          conversation_events: conversationContext.events,
          turn_id: conversationContext.ids.turn_id,
          run_id: conversationContext.ids.run_id,
          base_revision_evidence: base.base_revision_evidence,
          base_source_tree: base.source_tree,
          operations,
        });
        const workspaceExpectation = pendingDraftWorkspaceExpectation(previousDraft, candidate);
        const gitRequestId = newId(options.createUuid, 'builder-git-request');
        const targetCheckpointId = valueAt(targetCheckpoint, 'checkpoint_id');
        const draftId = `builder-generation-draft:${sha256Canonical({
          draft_version: BUILDER_GENERATION_PENDING_DRAFT_VERSION,
          request_id: requestDigest,
          candidate_id: candidate.candidate_id,
          candidate_digest: candidate.candidate_digest,
          run_id: candidate.run_id,
          target_checkpoint_id: targetCheckpointId,
        }).slice('sha256:'.length)}`;
        const editEvidence = await admitCandidateWorkspaceGuard(
          candidate,
          proof.project_id,
          workspaceExpectation.expected_workspace_source_tree_digest,
        );
        const gitCandidateReceipt = await Reflect.apply(
          persistCandidateCommit,
          options.gitAuthority,
          [{
            request_id: gitRequestId,
            expected_base_oid: candidate.base_revision_evidence === null
              ? null
              : candidate.base_revision_evidence.commit_oid,
            candidate,
          }],
        );
        const gitVerificationReceipt = await Reflect.apply(
          verifyCandidateReceipt,
          options.gitAuthority,
          [gitCandidateReceipt],
        );
        const receiptPair = sanitizeBuilderGitCandidateReceiptPair(
          gitCandidateReceipt,
          gitVerificationReceipt,
        );
        const title = 'Previous AI change undone';
        const summary = 'Restored the previous recoverable AI work checkpoint.';
        conversationContext = recordAutomaticDraftCheckpoint(
          key,
          conversationContext,
          candidate,
          receiptPair,
          `Restored earlier draft checkpoint ${targetCheckpointId}.`,
          editEvidence.edit_attempt,
        );
        const automaticCheck = await coordinateAutomaticCandidateCheck(
          draftId,
          candidate,
          receiptPair,
        );
        const currentMaterialization = await materializeCandidateToCurrentWorkspace(
          receiptPair,
          workspaceExpectation,
        );
        conversationContext = Reflect.apply(
          recordConversationRecoveryAction,
          options.conversationService,
          [{ context: conversationContext, action: 'restore_checkpoint', phase: 'completed' }],
        );
        activeContexts.set(key, conversationContext);
        const recorded = Reflect.apply(
          completeConversationCandidate,
          options.conversationService,
          [{
            context: conversationContext,
            candidate_result: {
              draft_id: draftId,
              title,
              summary,
              git_candidate_receipt: receiptPair.candidate_receipt,
              current_materialization: conversationCurrentMaterialization(currentMaterialization),
            },
            assistant_text: summary,
          }],
        );
        const stored = freezeDeep({
          version: BUILDER_GENERATION_RESULT_PROTOCOL,
          request_id: requestDigest,
          title,
          summary,
          admissions: {
            conversation: 'sqlite_recorded',
            draft: 'candidate_not_saved',
            save: 'not_performed',
            preview: 'not_evaluated',
            execution: 'not_evaluated',
          },
          candidate,
          candidate_proof: {
            ...candidateProofFromCandidate(candidate),
            git_request_id: gitRequestId,
          },
          draft_id: draftId,
          request: publicRequest,
          git_request_id: gitRequestId,
          conversation_head: recorded.head,
          restart_restore: 'not_persisted',
          current_materialization: currentMaterialization,
          automatic_check: automaticCheck,
          checkpoint_undo: {
            previous_draft_id: previousDraftId,
            target_checkpoint_id: targetCheckpointId,
          },
        });
        pendingDrafts.set(draftId, stored);
        pendingDrafts.delete(previousDraftId);
        return publicDraftResult(stored);
      })().catch((error) => {
        if (key !== null) {
          recordRecoveryActionForOperation(key, 'restore_checkpoint', 'failed');
          recordFailure(key, error);
        }
        if (error instanceof BuilderGenerationMainServiceError) throw error;
        throw new BuilderGenerationMainServiceError('builder_generation_checkpoint_undo_unavailable');
      }).finally(() => {
        clearProviderContextDisclosureStatusForKey(key);
        activeContexts.delete(key);
        cancellationTerminalOperationKeys.delete(key);
        if (inFlight.get(key) === operation) inFlight.delete(key);
      });
      inFlight.set(key, operation);
      return operation;
    } catch (error) {
      recordCanaryGenerationDebug('restore_checkpoint_prepare', error);
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail('builder_generation_checkpoint_undo_unavailable');
    }
  }

  function startStructuredGenerate(
    request,
    retryableContext,
    routeDecisionHint = null,
    queuedFollowup = null,
  ) {
    const key = operationKey(GENERATE_OPERATION_PREFIX, request.request_digest);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const routeConflict = rejectIfOtherRouteInFlight(GENERATE_OPERATION_PREFIX, request.request_digest);
    if (routeConflict) return routeConflict;
    if (retryableContext !== null && queuedFollowup !== null) fail();
    if (retryableContext !== null) pendingRetryContexts.set(key, retryableContext);
    if (routeDecisionHint !== null) pendingGenerateRouteDecisionHints.set(key, routeDecisionHint);
    if (queuedFollowup !== null) pendingGenerateQueuedFollowups.set(key, queuedFollowup);
    const operation = Promise.resolve(host.generate(request)).then(async (internal) => {
      const context = valueAt(internal, 'context');
      let conversationContext = latestConversationContext(context, generationContexts.get(context));
      if (conversationContext === undefined) fail();
      const draftId = `builder-generation-draft:${sha256Canonical({
        draft_version: BUILDER_GENERATION_PENDING_DRAFT_VERSION,
        request_id: internal.request_id,
        candidate_id: internal.candidate.candidate_id,
        candidate_digest: internal.candidate.candidate_digest,
        run_id: internal.candidate.run_id,
      }).slice('sha256:'.length)}`;
      const editEvidence = await admitCandidateWorkspaceGuard(
        internal.candidate,
        request.existing_project_id,
      );
      const gitCandidateReceipt = await Reflect.apply(
        persistCandidateCommit,
        options.gitAuthority,
        [{
          request_id: valueAt(context, 'git_request_id'),
          expected_base_oid: internal.candidate.base_revision_evidence === null
            ? null
            : internal.candidate.base_revision_evidence.commit_oid,
          candidate: internal.candidate,
        }],
      );
      const gitVerificationReceipt = await Reflect.apply(
        verifyCandidateReceipt,
        options.gitAuthority,
        [gitCandidateReceipt],
      );
      const receiptPair = sanitizeBuilderGitCandidateReceiptPair(
        gitCandidateReceipt,
        gitVerificationReceipt,
      );
      conversationContext = recordAutomaticDraftCheckpoint(
        key,
        conversationContext,
        internal.candidate,
        receiptPair,
        internal.summary,
        editEvidence.edit_attempt,
      );
      const runtimeSession = await beginStructuredRuntimeTrace({
        context: conversationContext,
        operation_key: key,
        provider_context: context,
        source_tree: internal.candidate.base_source_tree,
        instruction: request.instruction,
      });
      if (runtimeSession === null) fail();
      let automaticCheck;
      try {
        await recordStructuredCandidateFacts(runtimeSession, internal.candidate, internal.summary);
        automaticCheck = await coordinateAutomaticCandidateCheck(
          draftId,
          internal.candidate,
          receiptPair,
        );
        await recordStructuredCheckFact(runtimeSession, automaticCheck);
        conversationContext = await finishStructuredRuntimeTrace(runtimeSession, 'created');
      } catch (error) {
        try {
          conversationContext = await cancelStructuredRuntimeTrace(runtimeSession);
          activeContexts.set(key, conversationContext);
        } catch (cancellationError) {
          recordCanaryGenerationDebug('structured_runtime_cancel_failed', cancellationError);
        }
        throw error;
      }
      const currentMaterialization = await materializeCandidateToCurrentWorkspace(receiptPair);
      const recorded = Reflect.apply(
        completeConversationCandidate,
        options.conversationService,
        [{
          context: conversationContext,
          candidate_result: {
            draft_id: draftId,
            title: internal.title,
            summary: internal.summary,
            git_candidate_receipt: receiptPair.candidate_receipt,
            current_materialization: conversationCurrentMaterialization(currentMaterialization),
          },
          assistant_text: internal.summary,
        }],
      );
      const stored = freezeDeep({
        version: internal.version,
        request_id: internal.request_id,
        title: internal.title,
        summary: internal.summary,
        admissions: {
          ...internal.admissions,
          conversation: 'sqlite_recorded',
        },
        candidate: internal.candidate,
        candidate_proof: {
          ...candidateProofFromCandidate(internal.candidate),
          git_request_id: valueAt(context, 'git_request_id'),
        },
        draft_id: draftId,
        request,
        git_request_id: valueAt(context, 'git_request_id'),
        conversation_head: recorded.head,
        restart_restore: 'not_persisted',
        current_materialization: currentMaterialization,
        automatic_check: automaticCheck,
      });
      pendingDrafts.set(draftId, stored);
      retryableContexts.delete(key);
      return publicDraftResult(stored);
    }).catch((error) => {
      recordCanaryGenerationDebug('generate_candidate_prepare', error);
      recordFailure(key, error);
      throw error;
    }).finally(() => {
      clearStructuredRuntimeDigestForOperation(key);
      pendingRetryContexts.delete(key);
      pendingGenerateRouteDecisionHints.delete(key);
      pendingGenerateQueuedFollowups.delete(key);
      clearProviderContextDisclosureStatusForKey(key);
      activeContexts.delete(key);
      cancellationTerminalOperationKeys.delete(key);
      if (inFlight.get(key) === operation) inFlight.delete(key);
    });
    inFlight.set(key, operation);
    return operation;
  }

  function startHarnessGenerate(
    request,
    retryableContext,
    routeDecisionHint = null,
    queuedFollowup = null,
    admittedProviderConfig = null,
    draftContinuationContext = null,
  ) {
    const operationPrefix = draftContinuationContext === null
      ? GENERATE_OPERATION_PREFIX
      : DRAFT_CONTINUATION_OPERATION_PREFIX;
    const key = operationKey(operationPrefix, request.request_digest);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const routeConflict = rejectIfOtherRouteInFlight(
      operationPrefix,
      request.request_digest,
    );
    if (routeConflict) return routeConflict;
    if (retryableContext !== null && queuedFollowup !== null) fail();
    if (retryableContext !== null) pendingRetryContexts.set(key, retryableContext);
    if (routeDecisionHint !== null) pendingGenerateRouteDecisionHints.set(key, routeDecisionHint);
    if (queuedFollowup !== null) pendingGenerateQueuedFollowups.set(key, queuedFollowup);
    if (draftContinuationContext !== null) {
      pendingDraftContinuationContexts.set(key, draftContinuationContext);
    }
    let runner = null;
    let runnerResult = null;
    let runLease = null;
    const operation = (async () => {
      let context = await measureTraceWindow(
        'harness_start_build_context',
        'main.harness_start.build_context.duration_ms',
        () => (draftContinuationContext === null
          ? buildGenerationContext(request)
          : buildDraftContinuationContext(request)),
      );
      const contextStore = draftContinuationContext === null
        ? generationContexts
        : draftContinuationContexts;
      let conversationContext = latestConversationContext(context, contextStore.get(context));
      if (conversationContext === undefined) fail();
      const providerConfig = await measureTraceWindow(
        'harness_start_provider_config',
        'main.harness_start.provider_config.duration_ms',
        async () => (admittedProviderConfig === null
          ? readProviderConfig()
          : sanitizeBuilderProviderConfig(admittedProviderConfig)),
      );
      if (!harnessProviderCompatible(providerConfig)) fail();
      let credential = builderPerformanceTrace.measureSync(
        'main.harness_start.resolve_secret.duration_ms',
        () => harnessCredentialFromResolution(
          resolveSecret(providerConfig.secret_ref),
          providerConfig,
        ),
      );
      context = await measureTraceWindow(
        'harness_start_provider_dispatch',
        'main.harness_start.provider_dispatch.duration_ms',
        () => admitProviderDispatch({
          context,
          provider_config_digest: providerConfig.config_digest,
        }),
      );
      conversationContext = latestConversationContext(context, contextStore.get(context));
      if (conversationContext === undefined) fail();
      const state = { context: conversationContext };
      const workingSourceTree = draftContinuationContext === null
        ? context.base_source_tree
        : context.prompt_base_source_tree;
      const candidateBaseSourceTree = draftContinuationContext === null
        ? context.base_source_tree
        : context.candidate_base_source_tree;
      const baseRevisionEvidence = draftContinuationContext === null
        ? context.base_revision_evidence
        : context.candidate_base_revision_evidence;
      const runContract = builderPerformanceTrace.measureSync(
        'main.harness_start.run_contract.duration_ms',
        () => createBuilderProgrammingRuntimeRunContract({
          runtime_descriptor: options.harnessRuntimeComposition.descriptor,
          admission: {
            project_id: context.project_id,
            conversation_id: conversationContext.conversation.conversation_id,
            turn_id: context.turn_id,
            task_id: context.task_id,
            run_id: context.run_id,
            mode: 'build',
            workspace_ref: {
              ref_version: 'builder-programming-workspace-ref.v1',
              workspace_id: `builder-programming-workspace:${workingSourceTree.source_tree_digest.slice('sha256:'.length)}`,
              source_tree_digest: workingSourceTree.source_tree_digest,
              writable: true,
            },
            provider_config_digest: providerConfig.config_digest,
            allowed_tools: ['read', 'search', 'edit', 'write', 'command', 'browser', 'question'],
            limits: {
              max_steps: 128,
              max_duration_ms:
                BUILDER_PROGRAMMING_RUNTIME_SUPERVISION_DEFAULTS.max_run_duration_ms,
              max_model_tokens: providerConfig.max_tokens ?? 32_768,
              max_tool_output_bytes: runtimeMaxToolOutputBytes(),
            },
            admitted_at_ms: runtimeTimestamp(state.context),
          },
          input: {
            message_id: conversationContext.ids.message_id,
            text: harnessRuntimeInputText(request, context),
          },
        }),
      );
      const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract });
      let pendingRuntimeEvents = [];
      function assertHarnessRunActive(candidateEvent = null) {
        if (runLease?.cancellation_requested !== true) return;
        const eventTypeDescriptor = candidateEvent === null
          ? null
          : Object.getOwnPropertyDescriptor(candidateEvent, 'event_type');
        if (eventTypeDescriptor?.value === 'run_cancelled') return;
        throw new BuilderGenerationMainServiceError('builder_generation_cancelled');
      }
      async function recordRuntimeEvents(runtimeEvents) {
        return await builderPerformanceTrace.measureAsync(
          'main.harness_runtime.record_events.duration_ms',
          async () => {
            if (runtimeEvents.length === 0) return;
            if (recordConversationProgrammingRuntimeEvents !== null) {
              state.context = Reflect.apply(
                recordConversationProgrammingRuntimeEvents,
                options.conversationService,
                [{ context: state.context, runtime_events: runtimeEvents }],
              );
              return;
            }
            for (const runtimeEvent of runtimeEvents) {
              state.context = Reflect.apply(
                recordConversationProgrammingRuntimeEvent,
                options.conversationService,
                [{ context: state.context, runtime_event: runtimeEvent }],
              );
            }
          },
        );
      }
      async function flushPendingRuntimeEvents() {
        if (pendingRuntimeEvents.length === 0) return;
        const batch = pendingRuntimeEvents;
        builderPerformanceTrace.observe('main.harness_runtime.pending_batch_size', batch.length);
        await builderPerformanceTrace.measureAsync(
          'main.harness_runtime.flush_pending_events.duration_ms',
          () => recordRuntimeEvents(batch),
        );
        pendingRuntimeEvents = [];
      }
      async function persistRuntimeEvent(candidate, mainFact) {
        return await builderPerformanceTrace.measureAsync(
          'main.harness_runtime.persist_event.duration_ms',
          async () => {
            assertHarnessRunActive(candidate);
            state.context = latestConversationContext(
              state.context,
              activeContexts.get(key),
            );
            const normalizedAtMs = Math.max(
              runtimeTimestamp(state.context),
              safeTimestamp(Date.now()),
            );
            let runtimeEvent;
            try {
              runtimeEvent = builderPerformanceTrace.measureSync(
                'main.harness_runtime.journal_append.duration_ms',
                () => (mainFact
                  ? journal.appendMainFact(candidate, normalizedAtMs)
                  : journal.append(candidate, normalizedAtMs)),
              );
            } catch (error) {
              recordCanaryGenerationDebug('harness_runtime_journal_append', error);
              throw error;
            }
            if (!mainFact && runtimeEvent.event_type === 'assistant_text_delta') {
              builderPerformanceTrace.increment('main.provider_output.delta_event_count');
              notifyProviderOutputDelta(context, runtimeEvent.payload.delta_text);
              pendingRuntimeEvents.push(runtimeEvent);
              if (pendingRuntimeEvents.length >= MAX_RUNTIME_EVENT_BATCH_SIZE) {
                try {
                  await flushPendingRuntimeEvents();
                } catch (error) {
                  recordCanaryGenerationDebug('harness_runtime_conversation_record_batch', error);
                  throw error;
                }
                activeContexts.set(key, state.context);
                contextStore.set(context, state.context);
                liveOutputContextsByRunId.set(state.context.ids.run_id, state.context);
              }
              return runtimeEvent;
            }
            try {
              if (pendingRuntimeEvents.length > 0) {
                const batch = [...pendingRuntimeEvents, runtimeEvent];
                builderPerformanceTrace.observe('main.harness_runtime.pending_batch_size', batch.length);
                await recordRuntimeEvents(batch);
                pendingRuntimeEvents = [];
              } else {
                await recordRuntimeEvents([runtimeEvent]);
              }
            } catch (error) {
              recordCanaryGenerationDebug('harness_runtime_conversation_record', error);
              throw error;
            }
            activeContexts.set(key, state.context);
            contextStore.set(context, state.context);
            liveOutputContextsByRunId.set(state.context.ids.run_id, state.context);
            if (!mainFact && [
              'assistant_reasoning_status',
              'runtime_activity_status',
            ].includes(runtimeEvent.event_type)) {
              notifyProviderActivity(context, runtimeEvent.payload.status);
            }
            if (!mainFact && runtimeEvent.event_type === 'assistant_text_discarded') {
              notifyProviderOutputReset(context, runtimeEvent);
            }
            if (
              !mainFact
              && runtimeEvent.event_type === 'tool_call_started'
              && ['read', 'edit', 'write'].includes(runtimeEvent.payload.tool_kind)
              && runtimeEvent.payload.target_label !== null
            ) {
              await builderPerformanceTrace.measureAsync(
                'main.harness_runtime.bind_tool_file.duration_ms',
                () => options.harnessRuntimeComposition.bindToolFile({
                  project_id: runContract.admission.project_id,
                  conversation_id: runContract.admission.conversation_id,
                  run_id: runtimeEvent.run_id,
                  tool_call_id: runtimeEvent.tool_call_id,
                  path: runtimeEvent.payload.target_label,
                }),
              );
            }
            return runtimeEvent;
          },
        );
      }
      runner = builderPerformanceTrace.measureSync(
        'main.harness_start.runner_create.duration_ms',
        () => createBuilderHarnessGenerationRunner({
          runtime_composition: options.harnessRuntimeComposition,
          read_conversation_events() { return state.context.events; },
        }),
      );
      runLease = {
        runner,
        run_id: runContract.admission.run_id,
        cancellation_requested: false,
        cancellation_promise: null,
      };
      harnessRunnersByOperationKey.set(key, runLease);
      try {
        runnerResult = await measureTraceWindow(
          'harness_start_runner_run',
          'main.harness_start.runner_run.duration_ms',
          () => runner.run({
            run_contract: runContract,
            source_tree: workingSourceTree,
            candidate_base_source_tree: candidateBaseSourceTree,
            base_revision_evidence: baseRevisionEvidence,
            provider_config: providerConfig,
            credential,
            event_sink: {
              emit(candidate) { return persistRuntimeEvent(candidate, false); },
            },
          }),
        );
      } finally {
        credential = null;
      }
      assertHarnessRunActive();
      if (runnerResult.status === 'response_ready') {
        await measureTraceWindow(
          'harness_response_reconcile',
          'main.harness_response.reconcile.duration_ms',
          () => runner.reconcile({
            run_handle: runnerResult.run_handle,
            checkpoint_status: 'not_applicable',
          }),
        );
        assertHarnessRunActive();
        conversationContext = state.context;
        await measureTraceWindow(
          'harness_response_complete_conversation',
          'main.harness_response.complete_conversation.duration_ms',
          async () => {
            Reflect.apply(
              completeConversationWorkResponse,
              options.conversationService,
              [{
                context: conversationContext,
                assistant_text: runnerResult.assistant_text,
              }],
            );
          },
        );
        retryableContexts.delete(key);
        return publicHarnessWorkResponse(runnerResult, request, context);
      }
      const interruptedCandidate = runnerResult.status === 'interrupted_candidate_ready';
      if (runnerResult.status !== 'candidate_ready' && !interruptedCandidate) fail();
      let title = interruptedCandidate ? 'Recoverable project update' : 'Project update ready';
      const factRecorder = createBuilderProgrammingRuntimeMainFactRecorder({
        run_contract: runContract,
        append_main_fact(candidateEvent) {
          return persistRuntimeEvent(candidateEvent, true);
        },
        clock: () => runtimeTimestamp(state.context),
      });
      let candidate;
      let draftId;
      let receiptPair;
      let automaticCheck;
      let summary;
      let gitRequestId;
      let repairAttempt = 0;
      let finalCheckProjection = null;
      for (;;) {
        assertHarnessRunActive();
        candidate = runnerResult.candidate;
        summary = runnerResult.summary;
        draftId = `builder-generation-draft:${sha256Canonical({
          draft_version: BUILDER_GENERATION_PENDING_DRAFT_VERSION,
          request_id: request.request_digest,
          candidate_id: candidate.candidate_id,
          candidate_digest: candidate.candidate_digest,
          run_id: candidate.run_id,
          runtime_kind: 'deepseek_harness.v1',
          ...(draftContinuationContext === null
            ? {}
            : {
                continuation_base_digest: draftContinuationContext.base.base_digest,
                previous_draft_id: draftContinuationContext.admission.draft_id,
              }),
        }).slice('sha256:'.length)}`;
        const workspaceExpectation = continuationWorkspaceExpectation(
          draftContinuationContext,
          candidate,
        );
        const editEvidence = await measureTraceWindow(
          'harness_candidate_workspace_guard',
          'main.harness_candidate.workspace_guard.duration_ms',
          () => admitCandidateWorkspaceGuard(
            candidate,
            request.existing_project_id,
            workspaceExpectation.expected_workspace_source_tree_digest,
          ),
        );
        assertHarnessRunActive();
        gitRequestId = repairAttempt === 0
          ? valueAt(context, 'git_request_id')
          : newId(options.createUuid, 'builder-git-request');
        const gitCandidateReceipt = await measureTraceWindow(
          'harness_candidate_git_persist',
          'main.harness_candidate.git_persist.duration_ms',
          () => Reflect.apply(
            persistCandidateCommit,
            options.gitAuthority,
            [{
              request_id: gitRequestId,
              expected_base_oid: candidate.base_revision_evidence === null
                ? null
                : candidate.base_revision_evidence.commit_oid,
              candidate,
            }],
          ),
        );
        assertHarnessRunActive();
        const gitVerificationReceipt = await measureTraceWindow(
          'harness_candidate_git_verify',
          'main.harness_candidate.git_verify.duration_ms',
          () => Reflect.apply(
            verifyCandidateReceipt,
            options.gitAuthority,
            [gitCandidateReceipt],
          ),
        );
        receiptPair = sanitizeBuilderGitCandidateReceiptPair(
          gitCandidateReceipt,
          gitVerificationReceipt,
        );
        assertHarnessRunActive();
        conversationContext = await measureTraceWindow(
          'harness_candidate_checkpoint',
          'main.harness_candidate.checkpoint.duration_ms',
          async () => recordAutomaticDraftCheckpoint(
            key,
            state.context,
            candidate,
            receiptPair,
            summary,
            editEvidence.edit_attempt,
          ),
        );
        state.context = conversationContext;
        assertHarnessRunActive();
        automaticCheck = interruptedCandidate
          ? null
          : await measureTraceWindow(
            'harness_candidate_automatic_check',
            'main.harness_candidate.automatic_check.duration_ms',
            () => coordinateAutomaticCandidateCheck(
              draftId,
              candidate,
              receiptPair,
            ),
          );
        assertHarnessRunActive();
        finalCheckProjection = automaticCheck?.status === 'completed'
          ? automaticCheck.check_run_status_projection
          : null;
        if (
          automaticCheck?.status === 'completed'
          && automaticCheck.profile !== null
          && finalCheckProjection !== null
          && ['passed', 'failed', 'incomplete'].includes(finalCheckProjection.status)
        ) {
          await measureTraceWindow(
            'harness_candidate_record_check_fact',
            'main.harness_candidate.record_check_fact.duration_ms',
            () => factRecorder.record_check({
              verification_step_id: runnerResult.verification_step_id,
              command_display: automaticCheck.profile.command_display,
              status: finalCheckProjection.status,
              duration_ms: automaticCheck.duration_ms,
              summary: finalCheckProjection.summary,
            }),
          );
          assertHarnessRunActive();
        }
        if (
          interruptedCandidate
          || finalCheckProjection?.status !== 'failed'
          || repairAttempt >= MAX_HARNESS_CHECK_REPAIR_ATTEMPTS
        ) break;
        repairAttempt += 1;
        assertHarnessRunActive();
        runnerResult = await measureTraceWindow(
          'harness_candidate_repair',
          'main.harness_candidate.repair.duration_ms',
          () => runner.repair({
            run_handle: runnerResult.run_handle,
            failure_summary: finalCheckProjection.summary,
          }),
        );
        assertHarnessRunActive();
      }
      if (!interruptedCandidate && finalCheckProjection?.status === 'failed') {
        const closure = failedCheckClosure(summary);
        title = closure.title;
        summary = closure.summary;
      } else if (!interruptedCandidate && finalCheckProjection?.status === 'incomplete') {
        const closure = unavailableCheckClosure(summary);
        title = closure.title;
        summary = closure.summary;
      }
      assertHarnessRunActive();
      if (!interruptedCandidate) {
        await measureTraceWindow(
          'harness_candidate_reconcile',
          'main.harness_candidate.reconcile.duration_ms',
          () => runner.reconcile({
            run_handle: runnerResult.run_handle,
            checkpoint_status: draftContinuationContext !== null || repairAttempt > 0
              ? 'updated'
              : 'created',
          }),
        );
      }
      assertHarnessRunActive();
      conversationContext = state.context;
      const currentMaterialization = await measureTraceWindow(
        'harness_candidate_materialize_current',
        'main.harness_candidate.materialize_current.duration_ms',
        () => materializeCandidateToCurrentWorkspace(
          receiptPair,
          continuationWorkspaceExpectation(draftContinuationContext, candidate),
        ),
      );
      const completionSummary = chineseHarnessBuildClosure({
        modelSummary: summary,
        candidate,
        automaticCheck,
        currentMaterialization,
      });
      const recorded = await measureTraceWindow(
        'harness_candidate_complete_conversation',
        'main.harness_candidate.complete_conversation.duration_ms',
        async () => Reflect.apply(
          completeConversationCandidate,
          options.conversationService,
          [{
            context: conversationContext,
            candidate_result: {
              draft_id: draftId,
              title,
              summary,
              git_candidate_receipt: receiptPair.candidate_receipt,
              current_materialization: conversationCurrentMaterialization(currentMaterialization),
            },
            assistant_text: completionSummary,
          }],
        ),
      );
      const stored = freezeDeep({
        version: BUILDER_GENERATION_RESULT_PROTOCOL,
        request_id: request.request_digest,
        title,
        summary,
        admissions: {
          conversation: 'sqlite_recorded',
          draft: 'candidate_not_saved',
          save: 'not_performed',
          preview: 'not_evaluated',
          execution: 'not_evaluated',
        },
        candidate,
        candidate_proof: {
          ...candidateProofFromCandidate(candidate),
          git_request_id: gitRequestId,
        },
        draft_id: draftId,
        request,
        git_request_id: gitRequestId,
        conversation_head: recorded.head,
        restart_restore: 'not_persisted',
        current_materialization: currentMaterialization,
        automatic_check: automaticCheck,
        programming_runtime: 'deepseek_harness.v1',
        ...(interruptedCandidate
          ? { programming_runtime_interruption: { ...runnerResult.interruption } }
          : {}),
        ...(draftContinuationContext === null
          ? {}
          : {
              draft_continuation: {
                previous_draft_id: draftContinuationContext.admission.draft_id,
                admission_digest: draftContinuationContext.admission.admission_digest,
                base_digest: draftContinuationContext.base.base_digest,
                squash_authority: 'pending_candidate_context_project_base_candidate_v1',
              },
            }),
      });
      assertHarnessRunActive();
      pendingDrafts.set(draftId, stored);
      if (draftContinuationContext !== null) {
        pendingDrafts.delete(draftContinuationContext.admission.draft_id);
      }
      retryableContexts.delete(key);
      return publicDraftResult(stored);
    })().catch(async (error) => {
      recordCanaryGenerationDebug('harness_generate_candidate_prepare', error);
      if (runLease !== null && runLease.cancellation_promise !== null) {
        await runLease.cancellation_promise;
      }
      const settledError = runLease?.cancellation_requested === true
        ? new BuilderGenerationMainServiceError('builder_generation_cancelled')
        : publicHarnessFailure(error);
      if (runner !== null && runnerResult !== null) {
        try { await runner.cancel(runnerResult.run_handle, 'superseded'); } catch { /* stable failure below */ }
      }
      recordFailure(key, settledError);
      throw settledError;
    }).finally(() => {
      clearStructuredRuntimeDigestForOperation(key);
      pendingRetryContexts.delete(key);
      pendingGenerateRouteDecisionHints.delete(key);
      pendingGenerateQueuedFollowups.delete(key);
      pendingDraftContinuationContexts.delete(key);
      clearProviderContextDisclosureStatusForKey(key);
      harnessRunnersByOperationKey.delete(key);
      activeContexts.delete(key);
      cancellationTerminalOperationKeys.delete(key);
      if (inFlight.get(key) === operation) inFlight.delete(key);
    });
    inFlight.set(key, operation);
    return operation;
  }

  function startGenerate(request, retryableContext, routeDecisionHint = null, queuedFollowup = null) {
    let providerConfig = null;
    let providerCompatible = true;
    if (
      options.programmingRuntimeFeatureFlag === 'enabled'
      && options.harnessRuntimeComposition !== null
    ) {
      providerConfig = readProviderConfig();
      providerCompatible = harnessProviderCompatible(providerConfig);
      if (!providerCompatible) pendingAuthority = null;
    }
    const selection = selectBuilderProgrammingRuntime({
      feature_flag: options.programmingRuntimeFeatureFlag,
      harness_available: options.harnessRuntimeComposition !== null,
      provider_compatible: providerCompatible,
    });
    return selection.selected_runtime === 'deepseek_harness.v1'
      ? startHarnessGenerate(
        request,
        retryableContext,
        routeDecisionHint,
        queuedFollowup,
        providerConfig,
      )
      : startStructuredGenerate(request, retryableContext, routeDecisionHint, queuedFollowup);
  }

  function startDraftContinuationGenerate(request, continuationContext) {
    let providerConfig = null;
    let providerCompatible = true;
    if (
      options.programmingRuntimeFeatureFlag === 'enabled'
      && options.harnessRuntimeComposition !== null
    ) {
      providerConfig = readProviderConfig();
      providerCompatible = harnessProviderCompatible(providerConfig);
      if (!providerCompatible) pendingAuthority = null;
    }
    const selection = selectBuilderProgrammingRuntime({
      feature_flag: options.programmingRuntimeFeatureFlag,
      harness_available: options.harnessRuntimeComposition !== null,
      provider_compatible: providerCompatible,
    });
    if (selection.selected_runtime === 'deepseek_harness.v1') {
      return startHarnessGenerate(
        request,
        null,
        null,
        null,
        providerConfig,
        continuationContext,
      );
    }
    const key = operationKey(DRAFT_CONTINUATION_OPERATION_PREFIX, request.request_digest);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const routeConflict = rejectIfOtherRouteInFlight(
      DRAFT_CONTINUATION_OPERATION_PREFIX,
      request.request_digest,
    );
    if (routeConflict) return routeConflict;
    pendingDraftContinuationContexts.set(key, continuationContext);
    const operation = Promise.resolve(host.generateDraftContinuation(request)).then(async (internal) => {
      const context = valueAt(internal, 'context');
      let conversationContext = latestConversationContext(
        context,
        draftContinuationContexts.get(context),
      );
      if (conversationContext === undefined) fail();
      const draftId = `builder-generation-draft:${sha256Canonical({
        draft_version: BUILDER_GENERATION_PENDING_DRAFT_VERSION,
        request_id: internal.request_id,
        candidate_id: internal.candidate.candidate_id,
        candidate_digest: internal.candidate.candidate_digest,
        run_id: internal.candidate.run_id,
        continuation_base_digest: continuationContext.base.base_digest,
        previous_draft_id: continuationContext.admission.draft_id,
      }).slice('sha256:'.length)}`;
      const workspaceExpectation = continuationWorkspaceExpectation(
        continuationContext,
        internal.candidate,
      );
      const editEvidence = await admitCandidateWorkspaceGuard(
        internal.candidate,
        request.existing_project_id,
        workspaceExpectation.expected_workspace_source_tree_digest,
      );
      const gitCandidateReceipt = await Reflect.apply(
        persistCandidateCommit,
        options.gitAuthority,
        [{
          request_id: valueAt(context, 'git_request_id'),
          expected_base_oid: internal.candidate.base_revision_evidence === null
            ? null
            : internal.candidate.base_revision_evidence.commit_oid,
          candidate: internal.candidate,
        }],
      );
      const gitVerificationReceipt = await Reflect.apply(
        verifyCandidateReceipt,
        options.gitAuthority,
        [gitCandidateReceipt],
      );
      const receiptPair = sanitizeBuilderGitCandidateReceiptPair(
        gitCandidateReceipt,
        gitVerificationReceipt,
      );
      conversationContext = recordAutomaticDraftCheckpoint(
        key,
        conversationContext,
        internal.candidate,
        receiptPair,
        internal.summary,
        editEvidence.edit_attempt,
      );
      const runtimeSession = await beginStructuredRuntimeTrace({
        context: conversationContext,
        operation_key: key,
        provider_context: context,
        source_tree: internal.candidate.base_source_tree,
        instruction: request.instruction,
      });
      if (runtimeSession === null) fail();
      let automaticCheck;
      try {
        await recordStructuredCandidateFacts(runtimeSession, internal.candidate, internal.summary);
        automaticCheck = await coordinateAutomaticCandidateCheck(
          draftId,
          internal.candidate,
          receiptPair,
        );
        await recordStructuredCheckFact(runtimeSession, automaticCheck);
        conversationContext = await finishStructuredRuntimeTrace(runtimeSession, 'updated');
      } catch (error) {
        try {
          conversationContext = await cancelStructuredRuntimeTrace(runtimeSession);
          activeContexts.set(key, conversationContext);
        } catch (cancellationError) {
          recordCanaryGenerationDebug('structured_runtime_cancel_failed', cancellationError);
        }
        throw error;
      }
      const currentMaterialization = await materializeCandidateToCurrentWorkspace(
        receiptPair,
        workspaceExpectation,
      );
      const recorded = Reflect.apply(
        completeConversationCandidate,
        options.conversationService,
        [{
          context: conversationContext,
          candidate_result: {
            draft_id: draftId,
            title: internal.title,
            summary: internal.summary,
            git_candidate_receipt: receiptPair.candidate_receipt,
            current_materialization: conversationCurrentMaterialization(currentMaterialization),
          },
          assistant_text: internal.summary,
        }],
      );
      const stored = freezeDeep({
        version: internal.version,
        request_id: internal.request_id,
        title: internal.title,
        summary: internal.summary,
        admissions: {
          ...internal.admissions,
          conversation: 'sqlite_recorded',
        },
        candidate: internal.candidate,
        candidate_proof: {
          ...candidateProofFromCandidate(internal.candidate),
          git_request_id: valueAt(context, 'git_request_id'),
        },
        draft_id: draftId,
        request,
        git_request_id: valueAt(context, 'git_request_id'),
        conversation_head: recorded.head,
        restart_restore: 'not_persisted',
        current_materialization: currentMaterialization,
        automatic_check: automaticCheck,
        draft_continuation: {
          previous_draft_id: continuationContext.admission.draft_id,
          admission_digest: continuationContext.admission.admission_digest,
          base_digest: continuationContext.base.base_digest,
          squash_authority: 'pending_candidate_context_project_base_candidate_v1',
        },
      });
      pendingDrafts.set(draftId, stored);
      pendingDrafts.delete(continuationContext.admission.draft_id);
      retryableContexts.delete(key);
      return publicDraftResult(stored);
    }).catch((error) => {
      recordCanaryGenerationDebug('draft_continuation_candidate_prepare', error);
      recordFailure(key, error);
      throw error;
    }).finally(() => {
      clearStructuredRuntimeDigestForOperation(key);
      pendingDraftContinuationContexts.delete(key);
      clearProviderContextDisclosureStatusForKey(key);
      activeContexts.delete(key);
      cancellationTerminalOperationKeys.delete(key);
      if (inFlight.get(key) === operation) inFlight.delete(key);
    });
    inFlight.set(key, operation);
    return operation;
  }

  async function generate(rawRequest) {
    let request;
    try { request = sanitizeBuilderGenerationRequest(rawRequest); } catch {
      return Promise.reject(new BuilderGenerationMainServiceError('builder_generation_request_invalid'));
    }
    return startGenerate(request, null);
  }

  async function generateDraftContinuation(rawRequest) {
    let request = null;
    try {
      const continuationRequest = sanitizeDraftContinuationGenerationRequest(rawRequest);
      const continuationContext = await prepareDraftContinuationBasePair(continuationRequest.draft_id);
      request = createBuilderGenerationRequest({
        instruction: continuationRequest.instruction,
        existing_project_id: continuationContext.admission.project_id,
        task_address_id: null,
      });
      return await startDraftContinuationGenerate(request, freezeDeep({
        ...continuationContext,
        instruction: request.instruction,
        queued_followup: continuationRequest.queued_followup,
      }));
    } catch (error) {
      if (request !== null) {
        pendingDraftContinuationContexts.delete(
          operationKey(DRAFT_CONTINUATION_OPERATION_PREFIX, request.request_digest),
        );
      }
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail();
    }
  }

  async function generateApprovedPlan(rawRequest) {
    let request = null;
    let setupPhase = 'approved_plan_generate_start';
    try {
      exactObject(rawRequest, ['request', 'write_permission_decision']);
      setupPhase = 'approved_plan_generate_prepare_context';
      const prepared = await prepareApprovedPlanEditContext(valueAt(rawRequest, 'request'));
      const editContext = freezeDeep({
        ...prepared,
        write_permission_decision: valueAt(rawRequest, 'write_permission_decision'),
      });
      setupPhase = 'approved_plan_generate_request_from_plan';
      request = generationRequestFromApprovedPlan(editContext);
      const key = operationKey(GENERATE_OPERATION_PREFIX, request.request_digest);
      setupPhase = 'approved_plan_generate_inflight_check';
      if (inFlight.has(key) || pendingApprovedPlanEditContexts.has(key)) fail();
      setupPhase = 'approved_plan_generate_set_pending_context';
      pendingApprovedPlanEditContexts.set(key, editContext);
      setupPhase = 'approved_plan_generate_start_generate';
      return await startGenerate(request, null);
    } catch (error) {
      recordCanaryGenerationDebug(setupPhase, error);
      if (request !== null) {
        pendingApprovedPlanEditContexts.delete(
          operationKey(GENERATE_OPERATION_PREFIX, request.request_digest),
        );
      }
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail();
    }
  }

  function startPlan(request, resourceIds, routeDecisionHint) {
    const key = operationKey(PLAN_OPERATION_PREFIX, request.request_digest);
    if (inFlight.has(key) || pendingPlanRequests.has(key) || collectProjectSourceContext === null) fail();
    const routeConflict = rejectIfOtherRouteInFlight(PLAN_OPERATION_PREFIX, request.request_digest);
    if (routeConflict) return routeConflict;
    pendingPlanRequests.set(key, freezeDeep({
      resource_ids: safeResourceIds(resourceIds),
      route_decision_hint: routeDecisionHint,
    }));
    const operation = Promise.resolve(host.plan(request)).then((internal) => {
      const context = valueAt(internal, 'context');
      const sourceContextResult = planContexts.get(context);
      if (sourceContextResult === undefined) fail();
      const completed = Reflect.apply(
        completeConversationPlan,
        options.conversationService,
        [{
          context: sourceContextResult.context,
          source_context_result: sourceContextResult,
          plan_proposal_record: internal.plan_proposal_record,
        }],
      );
      return publicPlanResult(internal, request, completed.head);
    }).catch((error) => {
      recordFailure(key, error);
      throw error;
    }).finally(() => {
      pendingPlanRequests.delete(key);
      clearProviderContextDisclosureStatusForKey(key);
      activeContexts.delete(key);
      cancellationTerminalOperationKeys.delete(key);
      if (inFlight.get(key) === operation) inFlight.delete(key);
    });
    inFlight.set(key, operation);
    return operation;
  }

  async function proposePlan(rawRequest) {
    let request;
    try {
      exactObject(rawRequest, ['request', 'resource_ids']);
      request = sanitizeBuilderGenerationRequest(valueAt(rawRequest, 'request'));
      if (request.existing_project_id === null) fail();
      const semanticClassification = consumeSemanticRouteClassification(request);
      return startPlan(
        request,
        valueAt(rawRequest, 'resource_ids'),
        semanticClassification === null
          ? planRouteDecisionHint()
          : semanticRouteDecisionHint(semanticClassification, ['plan']),
      );
    } catch (error) {
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      return Promise.reject(new BuilderGenerationMainServiceError('builder_generation_request_invalid'));
    }
  }

  async function submit(rawRequest) {
    let request;
    try { request = sanitizeBuilderGenerationRequest(rawRequest); } catch {
      return Promise.reject(new BuilderGenerationMainServiceError('builder_generation_request_invalid'));
    }
    const routeContext = submitRouteContextForRequest(request);
    const semanticClassification = consumeSemanticRouteClassification(request);
    const routeDecision = semanticClassification === null
      ? classifySubmitRouteDecision(request.instruction, routeContext)
      : semanticRouteDecisionHint(
        semanticClassification,
        ['answer', 'clarify', 'update_brief', 'build'],
      );
    if ((routeDecision.route === 'build' || routeDecision.route === 'plan') && request.existing_project_id === null) {
      return Promise.reject(new BuilderGenerationMainServiceError(
        'builder_generation_project_workspace_required',
      ));
    }
    if (routeDecision.route === 'plan') return startPlan(request, [], routeDecision);
    return routeDecision.route === 'build'
      ? startGenerate(request, null, routeDecision)
      : startAnswer(request, routeDecision);
  }

  async function classifyIntent(rawRequest) {
    let instruction;
    let projectId;
    let taskAddressId;
    try {
      exactObject(rawRequest, ['instruction', 'existing_project_id', 'task_address_id']);
      instruction = safeText(valueAt(rawRequest, 'instruction'), 12_000, 48_000);
      const rawProjectId = valueAt(rawRequest, 'existing_project_id');
      projectId = rawProjectId === null ? null : safeProjectId(rawProjectId);
      const rawTaskAddressId = valueAt(rawRequest, 'task_address_id');
      taskAddressId = rawTaskAddressId === null
        ? null
        : safePattern(rawTaskAddressId, TASK_ADDRESS_ID_PATTERN, 96);
      if (projectId === null && taskAddressId !== null) fail();
    } catch {
      throw new BuilderGenerationMainServiceError('builder_generation_request_invalid');
    }
    const semanticRequest = semanticRouteRequestFor(instruction, projectId, taskAddressId);
    const classification = await host.classifyIntent(semanticRequest);
    const generationRequest = createBuilderGenerationRequest({
      instruction,
      existing_project_id: projectId,
      task_address_id: taskAddressId,
    });
    rememberSemanticRouteClassification(generationRequest, classification);
    return classification;
  }

  async function submitQueuedFollowup(rawRequest) {
    let request;
    let queuedFollowup;
    try {
      const sanitized = sanitizeQueuedFollowupTurnRequest(rawRequest);
      request = sanitized.request;
      queuedFollowup = sanitized.queued_followup;
      if (request.existing_project_id === null) fail();
    } catch {
      return Promise.reject(new BuilderGenerationMainServiceError('builder_generation_request_invalid'));
    }
    const routeContext = submitRouteContextForRequest(request);
    const routeDecision = withRouteDecisionMatchedSignal(
      classifySubmitRouteDecision(
        request.instruction,
        routeContext,
      ),
      'active_run_followup',
    );
    const shouldAnswer = routeDecision.route !== 'build';
    return shouldAnswer
      ? startAnswer(request, routeDecision, queuedFollowup)
      : startGenerate(request, null, routeDecision, queuedFollowup);
  }

  async function retryGenerate(rawRequest) {
    let request;
    try { request = sanitizeBuilderGenerationRequest(rawRequest); } catch {
      return Promise.reject(new BuilderGenerationMainServiceError('builder_generation_request_invalid'));
    }
    const retryableContext = retryableContexts.get(
      operationKey(GENERATE_OPERATION_PREFIX, request.request_digest),
    );
    if (retryableContext === undefined) {
      return Promise.reject(new BuilderGenerationMainServiceError());
    }
    return startGenerate(request, retryableContext);
  }

  function startAnswer(request, routeDecisionHint = null, queuedFollowup = null) {
    const key = operationKey(ANSWER_OPERATION_PREFIX, request.request_digest);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const routeConflict = rejectIfOtherRouteInFlight(ANSWER_OPERATION_PREFIX, request.request_digest);
    if (routeConflict) return routeConflict;
    pendingAnswerRouteDecisionHints.set(
      key,
      routeDecisionHint ?? answerRouteDecisionHint(['read_only']),
    );
    if (queuedFollowup !== null) pendingAnswerQueuedFollowups.set(key, queuedFollowup);
    const localReply = localReadOnlyReply(request);
    const operation = Promise.resolve(localReply === null
      ? host.explain(request)
      : createLocalCasualChatExplanation(request, localReply)).then((internal) => {
      const context = valueAt(internal, 'context');
      const conversationContext = latestConversationContext(context, explanationContexts.get(context));
      if (conversationContext === undefined) fail();
      const publicResult = publicExplanationResult(internal, request);
      const terminal = applyConversationContextMethod(
        conversationContext,
        completeConversationExplanation,
        completeAgentConversationExplanation,
        {
          context: conversationContext,
          assistant_text: internal.explanation,
        },
      );
      recordTaskCapsuleFromExplanationTerminal(conversationContext, terminal);
      return publicResult;
    }).catch((error) => {
      recordFailure(key, error);
      throw error;
    }).finally(() => {
      pendingDraftAnswerContexts.delete(key);
      pendingAnswerRouteDecisionHints.delete(key);
      pendingAnswerQueuedFollowups.delete(key);
      clearProviderContextDisclosureStatusForKey(key);
      activeContexts.delete(key);
      cancellationTerminalOperationKeys.delete(key);
      if (inFlight.get(key) === operation) inFlight.delete(key);
    });
    inFlight.set(key, operation);
    return operation;
  }

  async function answer(rawRequest) {
    let request;
    try { request = sanitizeBuilderGenerationRequest(rawRequest); } catch {
      return Promise.reject(new BuilderGenerationMainServiceError('builder_generation_request_invalid'));
    }
    const semanticClassification = consumeSemanticRouteClassification(request);
    return startAnswer(request, semanticClassification === null
      ? classifyReadOnlyAnswerRouteDecision(
        request.instruction,
        submitRouteContextForRequest(request),
      )
      : semanticRouteDecisionHint(
        semanticClassification,
        ['answer', 'clarify', 'update_brief'],
      ));
  }

  async function answerPlan(rawRequest) {
    let request;
    try { request = sanitizeBuilderGenerationRequest(rawRequest); } catch {
      return Promise.reject(new BuilderGenerationMainServiceError('builder_generation_request_invalid'));
    }
    if (request.existing_project_id !== null || request.task_address_id !== null) {
      return Promise.reject(new BuilderGenerationMainServiceError('builder_generation_request_invalid'));
    }
    return startAnswer(request, planRouteDecisionHint());
  }

  async function answerQueuedFollowup(rawRequest) {
    let request;
    let queuedFollowup;
    try {
      const sanitized = sanitizeQueuedFollowupTurnRequest(rawRequest);
      request = sanitized.request;
      queuedFollowup = sanitized.queued_followup;
    } catch {
      return Promise.reject(new BuilderGenerationMainServiceError('builder_generation_request_invalid'));
    }
    return startAnswer(
      request,
      withRouteDecisionMatchedSignal(
        classifyReadOnlyAnswerRouteDecision(
          request.instruction,
          submitRouteContextForRequest(request),
        ),
        'active_run_followup',
      ),
      queuedFollowup,
    );
  }

  async function answerDraft(rawRequest) {
    let request = null;
    try {
      const draftRequest = sanitizeDraftAnswerGenerationRequest(rawRequest);
      const verified = await loadVerifiedPendingDraftForQuestion(draftRequest.draft_id);
      if (verified.conversation_draft.candidate_proof.project_id !== draftRequest.project_id) fail();
      request = createBuilderGenerationRequest({
        instruction: draftRequest.instruction,
        existing_project_id: draftRequest.project_id,
        task_address_id: null,
      });
      const key = operationKey(ANSWER_OPERATION_PREFIX, request.request_digest);
      if (inFlight.has(key) || pendingDraftAnswerContexts.has(key)) fail();
      const routeConflict = rejectIfOtherRouteInFlight(ANSWER_OPERATION_PREFIX, request.request_digest);
      if (routeConflict) return routeConflict;
      pendingDraftAnswerContexts.set(key, freezeDeep({
        draft_id: draftRequest.draft_id,
        instruction: request.instruction,
        project_id: draftRequest.project_id,
        conversation_id: verified.conversation_draft.candidate_proof.conversation_id,
        base_revision: verified.conversation_draft.candidate_proof.base_revision,
        base_revision_evidence: await baseRevisionEvidenceForRestoredDraft(
          verified.conversation_draft.candidate_proof,
        ),
        source_tree: verified.verified_candidate.source_tree,
      }));
      return await startAnswer(request);
    } catch (error) {
      if (request !== null) {
        pendingDraftAnswerContexts.delete(operationKey(ANSWER_OPERATION_PREFIX, request.request_digest));
      }
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail();
    }
  }

  function cancel(rawRequest) {
    let requestId;
    try {
      exactObject(rawRequest, ['request_id']);
      requestId = safeDigest(valueAt(rawRequest, 'request_id'));
    } catch {
      return host.cancel(rawRequest);
    }
    const keys = [
      operationKey(GENERATE_OPERATION_PREFIX, requestId),
      operationKey(DRAFT_CONTINUATION_OPERATION_PREFIX, requestId),
      operationKey(ANSWER_OPERATION_PREFIX, requestId),
      operationKey(PLAN_OPERATION_PREFIX, requestId),
    ];
    let cancelled = false;
    for (const key of keys) {
      const context = activeContexts.get(key);
      if (context === undefined) continue;
      const harnessRun = harnessRunnersByOperationKey.get(key);
      if (harnessRun !== undefined) {
        harnessRun.cancellation_requested = true;
      }
      let cancelledContext;
      try {
        cancelledContext = applyConversationContextMethod(
          context,
          requestConversationCancel,
          requestAgentConversationCancel,
          { context },
        );
      } catch {
        if (harnessRun !== undefined && harnessRun.cancellation_promise === null) {
          harnessRun.cancellation_promise = harnessRun.runner
            .cancel_run_id(harnessRun.run_id, 'user_requested')
            .catch(() => false);
        }
        throw new BuilderGenerationMainServiceError();
      }
      try {
        cancelledContext = completeAcceptedCancellation(key, cancelledContext);
      } catch {
        if (harnessRun !== undefined && harnessRun.cancellation_promise === null) {
          harnessRun.cancellation_promise = harnessRun.runner
            .cancel_run_id(harnessRun.run_id, 'user_requested')
            .catch(() => false);
        }
        throw new BuilderGenerationMainServiceError();
      }
      activeContexts.set(key, cancelledContext);
      clearProviderContextDisclosureStatusForContext(cancelledContext);
      if (harnessRun !== undefined && harnessRun.cancellation_promise === null) {
        harnessRun.cancellation_promise = harnessRun.runner
          .cancel_run_id(harnessRun.run_id, 'user_requested')
          .catch(() => false);
      }
      cancelled = true;
    }
    if (!cancelled) {
      return Object.freeze({ request_id: requestId, cancelled: false });
    }
    host.cancel({ request_id: requestId });
    return Object.freeze({ request_id: requestId, cancelled: true });
  }

  function steer(rawRequest) {
    let requestId;
    let message;
    try {
      exactObject(rawRequest, ['request_id', 'message']);
      requestId = safeDigest(valueAt(rawRequest, 'request_id'));
      message = safeText(valueAt(rawRequest, 'message'), 12_000, 48_000);
    } catch {
      throw new BuilderGenerationMainServiceError('builder_generation_request_invalid');
    }
    const keys = [
      operationKey(GENERATE_OPERATION_PREFIX, requestId),
      operationKey(DRAFT_CONTINUATION_OPERATION_PREFIX, requestId),
      operationKey(ANSWER_OPERATION_PREFIX, requestId),
      operationKey(PLAN_OPERATION_PREFIX, requestId),
    ];
    let steered = false;
    for (const key of keys) {
      const context = activeContexts.get(key);
      if (context === undefined) continue;
      const harnessRun = harnessRunnersByOperationKey.get(key);
      const pendingQuestion = harnessRun === undefined
        ? null
        : harnessRun.runner.pending_user_question(harnessRun.run_id);
      let steeredContext;
      try {
        steeredContext = applyConversationContextMethod(
          context,
          recordConversationSteering,
          recordAgentConversationSteering,
          { context, message },
        );
      } catch {
        throw new BuilderGenerationMainServiceError();
      }
      activeContexts.set(key, steeredContext);
      liveOutputContextsByRunId.set(steeredContext.ids.run_id, steeredContext);
      if (pendingQuestion !== null) {
        harnessRun.runner.answer_user_question(harnessRun.run_id, message);
      }
      steered = true;
    }
    return Object.freeze({ request_id: requestId, steered });
  }

  function queueFollowup(rawRequest) {
    let requestId;
    let message;
    try {
      exactObject(rawRequest, ['request_id', 'message']);
      requestId = safeDigest(valueAt(rawRequest, 'request_id'));
      message = safeText(valueAt(rawRequest, 'message'), 12_000, 48_000);
    } catch {
      throw new BuilderGenerationMainServiceError('builder_generation_request_invalid');
    }
    const keys = [
      operationKey(GENERATE_OPERATION_PREFIX, requestId),
      operationKey(DRAFT_CONTINUATION_OPERATION_PREFIX, requestId),
      operationKey(ANSWER_OPERATION_PREFIX, requestId),
      operationKey(PLAN_OPERATION_PREFIX, requestId),
    ];
    let queued = false;
    let queuedFollowup = null;
    for (const key of keys) {
      const context = activeContexts.get(key);
      if (context === undefined) continue;
      let queuedContext;
      try {
        queuedContext = applyConversationContextMethod(
          context,
          recordConversationQueuedFollowup,
          recordAgentConversationQueuedFollowup,
          { context, message },
        );
      } catch {
        throw new BuilderGenerationMainServiceError();
      }
      activeContexts.set(key, queuedContext);
      liveOutputContextsByRunId.set(queuedContext.ids.run_id, queuedContext);
      queuedFollowup = queuedFollowupReferenceFromEvent(queuedContext.events.at(-1));
      queued = true;
    }
    return Object.freeze({ request_id: requestId, queued, queued_followup: queuedFollowup });
  }

  async function baseRevisionEvidenceForRestoredDraft(proof) {
    if (proof.base_revision === null) return null;
    const base = sanitizeReadResult(
      await Reflect.apply(loadCurrentProject, options.projectReadAuthority, [{
        project_id: proof.project_id,
      }]),
      proof.project_id,
    );
    if (
      base.base_revision === null
      || base.base_revision.revision_receipt_digest !== proof.base_revision.revision_receipt_digest
      || base.base_revision.commit_oid !== proof.base_revision.commit_oid
    ) {
      throw new BuilderGenerationMainServiceError('builder_generation_parent_unavailable');
    }
    return base.base_revision_evidence;
  }

  async function loadPendingDraftById(draftId) {
    const draft = pendingDrafts.get(draftId);
    if (draft) {
      let restoredConversation;
      try {
        restoredConversation = sanitizeConversationDraft(
          Reflect.apply(
            readConversationCandidateDraft,
            options.conversationService,
            [{ draft_id: draftId }],
          ),
          draftId,
        );
        assertConversationDraftMatchesPending(restoredConversation, draft);
      } catch (error) {
        pendingDrafts.delete(draftId);
        throw error;
      }
      const refreshed = refreshPendingDraftConversationHead(
        draft,
        restoredConversation.conversation_head,
      );
      pendingDrafts.set(draftId, refreshed);
      return refreshed;
    }
    const restoredConversation = sanitizeConversationDraft(
      Reflect.apply(
        readConversationCandidateDraft,
        options.conversationService,
        [{ draft_id: draftId }],
      ),
      draftId,
    );
    const verified = sanitizeVerifiedCandidateRead(
      await Reflect.apply(
        readVerifiedCandidate,
        options.gitAuthority,
        [restoredConversation.git_candidate_receipt],
      ),
      restoredConversation.git_candidate_receipt,
    );
    const restored = freezeDeep({
      title: restoredConversation.title,
      summary: restoredConversation.summary,
      draft_id: draftId,
      git_request_id: restoredConversation.git_candidate_receipt.request_id,
      conversation_head: restoredConversation.conversation_head,
      candidate_proof: restoredConversation.candidate_proof,
      current_materialization: restoredConversation.current_materialization,
      source_tree: verified.source_tree,
      restart_restore: 'git_sqlite_verified',
    });
    pendingDrafts.set(draftId, restored);
    return restored;
  }

  async function readPendingDraft(rawRequest) {
    try {
      exactObject(rawRequest, ['draft_id']);
      const draftId = safeDraftId(valueAt(rawRequest, 'draft_id'));
      return pendingDraftResult(await loadPendingDraftById(draftId));
    } catch {
      fail();
    }
  }

  async function restoreDraft(rawRequest) {
    try {
      exactObject(rawRequest, ['draft_id']);
      const draftId = safeDraftId(valueAt(rawRequest, 'draft_id'));
      const draft = await loadPendingDraftById(draftId);
      if (Object.hasOwn(draft, 'candidate')) return publicDraftResult(draft);
      return publicRestoredDraftResult(
        draft,
        await baseRevisionEvidenceForRestoredDraft(draft.candidate_proof),
      );
    } catch (error) {
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail();
    }
  }

  async function prepareDraftContinuation(rawRequest) {
    try {
      exactObject(rawRequest, ['draft_id']);
      const draftId = safeDraftId(valueAt(rawRequest, 'draft_id'));
      const draft = await loadPendingDraftById(draftId);
      return sanitizeBuilderDraftContinuationAdmission(
        createBuilderDraftContinuationAdmission({
          pending_draft: pendingDraftResult(draft),
          continuation_id: newId(options.createUuid, 'builder-draft-continuation'),
          admitted_at_ms: safeTimestamp(Date.now()),
        }),
      );
    } catch (error) {
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail();
    }
  }

  function assertConversationDraftMatchesPending(conversationDraft, draft) {
    if (
      conversationDraft.title !== draft.title
      || conversationDraft.summary !== draft.summary
      || conversationDraft.conversation_head.sequence < draft.conversation_head.sequence
      || (
        conversationDraft.conversation_head.sequence === draft.conversation_head.sequence
        && (
          conversationDraft.conversation_head.event_id !== draft.conversation_head.event_id
          || conversationDraft.conversation_head.event_digest !== draft.conversation_head.event_digest
        )
      )
      || conversationDraft.git_candidate_receipt.request_id !== draft.git_request_id
      || conversationDraft.candidate_proof.git_request_id !== draft.git_request_id
      || conversationDraft.candidate_proof.project_id !== draft.candidate_proof.project_id
      || conversationDraft.candidate_proof.conversation_id !== draft.candidate_proof.conversation_id
      || conversationDraft.candidate_proof.turn_id !== draft.candidate_proof.turn_id
      || conversationDraft.candidate_proof.task_id !== draft.candidate_proof.task_id
      || conversationDraft.candidate_proof.run_id !== draft.candidate_proof.run_id
      || conversationDraft.candidate_proof.candidate_id !== draft.candidate_proof.candidate_id
      || conversationDraft.candidate_proof.candidate_digest !== draft.candidate_proof.candidate_digest
      || conversationDraft.candidate_proof.resulting_tree_digest !== draft.candidate_proof.resulting_tree_digest
      || conversationDraft.candidate_proof.expected_base_oid !== draft.candidate_proof.expected_base_oid
      || canonicalJson(conversationDraft.candidate_proof.base_revision)
        !== canonicalJson(draft.candidate_proof.base_revision)
    ) fail();
  }

  function refreshPendingDraftConversationHead(draft, conversationHead) {
    if (
      draft.conversation_head.sequence === conversationHead.sequence
      && draft.conversation_head.event_id === conversationHead.event_id
      && draft.conversation_head.event_digest === conversationHead.event_digest
    ) return draft;
    return freezeDeep({
      ...draft,
      conversation_head: { ...conversationHead },
    });
  }

  async function prepareDraftContinuationBase(rawRequest) {
    try {
      exactObject(rawRequest, ['draft_id']);
      const draftId = safeDraftId(valueAt(rawRequest, 'draft_id'));
      return (await prepareDraftContinuationBasePair(draftId)).base;
    } catch (error) {
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail();
    }
  }

  function releasePendingDraft(rawRequest) {
    try {
      exactObject(rawRequest, ['draft_id', 'candidate_digest']);
      const draftId = safeDraftId(valueAt(rawRequest, 'draft_id'));
      const candidateDigest = safeDigest(valueAt(rawRequest, 'candidate_digest'));
      const draft = pendingDrafts.get(draftId);
      if (!draft || draft.candidate_proof.candidate_digest !== candidateDigest) {
        throw new BuilderGenerationMainServiceError('builder_generation_draft_conflict');
      }
      pendingDrafts.delete(draftId);
      return freezeDeep({
        result_version: BUILDER_GENERATION_PENDING_DRAFT_VERSION,
        draft_id: draftId,
        released: true,
        pending_draft_restart_restore: draft.restart_restore,
        conversation_event_admission: 'sqlite_recorded',
      });
    } catch (error) {
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail();
    }
  }

  function rejectDraft(rawRequest) {
    try {
      exactObject(rawRequest, ['draft_id']);
      const draftId = safeDraftId(valueAt(rawRequest, 'draft_id'));
      const rejected = sanitizeConversationCandidateReject(
        Reflect.apply(
          rejectConversationCandidate,
          options.conversationService,
          [{ draft_id: draftId }],
        ),
        draftId,
      );
      pendingDrafts.delete(draftId);
      return freezeDeep({
        result_version: 'builder-generation-draft-rejection-result.v1',
        draft_id: draftId,
        project_id: rejected.project_id,
        rejected: true,
        pending_draft_released: true,
        conversation_event_admission: rejected.rejection_admission,
      });
    } catch (error) {
      if (error instanceof BuilderGenerationMainServiceError) throw error;
      fail();
    }
  }

  return Object.freeze({
    service_version: BUILDER_GENERATION_MAIN_SERVICE_VERSION,
    submit,
    classify_intent: classifyIntent,
    submit_queued_followup: submitQueuedFollowup,
    answer,
    answer_plan: answerPlan,
    answer_queued_followup: answerQueuedFollowup,
    answer_draft: answerDraft,
    propose_plan: proposePlan,
    generate,
    generate_draft_continuation: generateDraftContinuation,
    generate_approved_plan: generateApprovedPlan,
    retry_generate: retryGenerate,
    prepare_approved_plan_edit_context: prepareApprovedPlanEditContext,
    cancel,
    steer,
    queue_followup: queueFollowup,
    availability: host.availability,
    restore_revision_as_draft: restoreRevisionAsDraft,
    restore_previous_checkpoint_as_draft: restorePreviousCheckpointAsDraft,
    restore_draft: restoreDraft,
    read_pending_draft: readPendingDraft,
    prepare_draft_continuation: prepareDraftContinuation,
    prepare_draft_continuation_base: prepareDraftContinuationBase,
    release_pending_draft: releasePendingDraft,
    reject_draft: rejectDraft,
    authority: Object.freeze({
      provider_config_snapshot_bound: true,
      project_read_authority_verified_source: true,
      pending_draft_restart_restore: 'git_sqlite_verified',
      conversation_event_admission: 'sqlite_recorded',
      run_context_snapshot: 'main_only_recorded_before_provider_or_tool_progress',
      approved_plan_edit_context: 'main_only_fresh_continuation_current_source_no_dispatch',
      approved_plan_generation: 'main_only_approved_plan_starts_work_run_before_provider',
      plan_proposal_generation: 'main_only_source_context_plan_no_source_mutation',
      plan_project_understanding: 'main_only_refresh_before_plan_provider_no_prompt_egress',
      semantic_route_classification:
        'main_only_current_instruction_bounded_state_provider_request_no_source_or_mutation',
      draft_continuation_admission: 'main_only_pending_draft_identity_no_dispatch',
      draft_continuation_base: 'main_only_pending_candidate_git_base_no_dispatch',
      draft_continuation_generation: 'main_only_pending_candidate_context_squashed_to_project_base',
      draft_answer_generation: 'main_only_pending_candidate_source_explanation_no_mutation',
      history_restore_as_new_version: 'main_only_git_sqlite_candidate_no_current_rewrite',
      history_checkpoint_undo: 'main_only_verified_checkpoint_git_candidate_or_project_baseline',
      run_steering: 'request_id_only_main_conversation_fact',
      run_followup_queue: 'request_id_only_main_conversation_fact',
      run_followup_consumption: 'main_conversation_replay_verified',
      credential_exposed_to_renderer: false,
      electron_registration: false,
      preload_exposure: false,
    }),
  });
}

module.exports = Object.freeze({
  BUILDER_GENERATION_MAIN_SERVICE_VERSION,
  BUILDER_GENERATION_PENDING_DRAFT_VERSION,
  BuilderGenerationMainServiceError,
  createBuilderGenerationMainService,
});
