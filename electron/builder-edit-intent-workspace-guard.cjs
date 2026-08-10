'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderCodeChangeKernelError,
  sanitizeBuilderCodeChangeCandidate,
} = require('./builder-code-change-kernel.cjs');
const {
  createBuilderProjectSourceTree,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_EDIT_INTENT_PLAN_VERSION = 'builder-edit-intent-plan.v1';
const BUILDER_WORKSPACE_GUARD_REPORT_VERSION = 'builder-workspace-guard-report.v1';
const MAX_GUARDED_OPERATIONS = 256;
const LARGE_CHANGE_THRESHOLD = 12;

const CREATE_PLAN_KEYS = Object.freeze(['candidate', 'created_at_ms']);
const EVALUATE_GUARD_KEYS = Object.freeze([
  'candidate',
  'edit_intent_plan',
  'observed_workspace_source_tree',
  'evaluated_at_ms',
]);
const PLAN_KEYS = Object.freeze([
  'plan_version',
  'edit_intent_plan_id',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'candidate_id',
  'candidate_digest',
  'base_source_tree_digest',
  'target_paths',
  'file_operations',
  'reason',
  'risk_class',
  'status',
  'created_at_ms',
  'authority',
  'plan_digest',
]);
const FILE_OPERATION_KEYS = Object.freeze([
  'path',
  'operation',
  'expected_old_content_digest',
  'proposed_content_digest',
]);
const PLAN_AUTHORITY_KEYS = Object.freeze([
  'intent_authority',
  'candidate_authority',
  'renderer_authority',
  'provider_authority',
  'source_read',
  'source_write',
  'git_mutation',
  'permission_grant_authority',
  'revision_admission',
]);
const GUARD_REPORT_KEYS = Object.freeze([
  'report_version',
  'guard_report_id',
  'edit_intent_plan_id',
  'plan_digest',
  'project_id',
  'run_id',
  'candidate_id',
  'candidate_digest',
  'observed_workspace_source_tree_digest',
  'status',
  'decisions',
  'summary',
  'evaluated_at_ms',
  'authority',
  'report_digest',
]);
const GUARD_DECISION_KEYS = Object.freeze([
  'guard_decision_id',
  'run_id',
  'path',
  'operation',
  'decision',
  'reason',
  'user_visible',
]);
const GUARD_SUMMARY_KEYS = Object.freeze([
  'allowed_count',
  'approval_required_count',
  'denied_count',
  'changed_path_count',
  'workspace_conflict_count',
  'external_workspace_conflict_check',
]);
const GUARD_AUTHORITY_KEYS = Object.freeze([
  'guard_authority',
  'intent_authority',
  'candidate_authority',
  'renderer_authority',
  'provider_authority',
  'source_read',
  'source_write',
  'git_mutation',
  'permission_grant_authority',
  'revision_admission',
  'external_workspace_conflict_authority',
]);

const PLAN_AUTHORITY = Object.freeze({
  intent_authority: 'deterministic_candidate_projection_v1',
  candidate_authority: 'sanitized_builder_code_change_candidate_v2',
  renderer_authority: 'not_present',
  provider_authority: 'not_present',
  source_read: 'candidate_snapshot_only',
  source_write: 'not_performed',
  git_mutation: false,
  permission_grant_authority: false,
  revision_admission: 'not_created',
});
const GUARD_AUTHORITY = Object.freeze({
  guard_authority: 'main_owned_deterministic_workspace_guard_v1',
  intent_authority: 'verified_edit_intent_plan_v1',
  candidate_authority: 'sanitized_builder_code_change_candidate_v2',
  renderer_authority: 'not_present',
  provider_authority: 'not_present',
  source_read: 'candidate_and_fresh_workspace_snapshots',
  source_write: 'not_performed',
  git_mutation: false,
  permission_grant_authority: false,
  revision_admission: 'not_created',
  external_workspace_conflict_authority: 'fresh_observed_workspace_source_tree_v1',
});

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PLAN_ID_PATTERN = /^builder-edit-intent-plan:[0-9a-f]{64}$/u;
const REPORT_ID_PATTERN = /^builder-workspace-guard-report:[0-9a-f]{64}$/u;
const DECISION_ID_PATTERN = /^builder-workspace-guard-decision:[0-9a-f]{64}$/u;
const RISK_CLASSES = Object.freeze(['normal', 'approval_required', 'destructive', 'sensitive']);
const PLAN_OPERATIONS = Object.freeze(['create', 'update', 'delete']);
const GUARD_DECISIONS = Object.freeze(['allowed', 'approval_required', 'denied']);
const GUARD_REASONS = Object.freeze([
  'ordinary_project_file',
  'user_changed_file_conflict',
  'file_delete_requires_approval',
  'lockfile_change_requires_approval',
  'large_multi_file_change_requires_approval',
  'protected_git_internal',
  'protected_builder_internal',
  'protected_secret_file',
  'protected_binary_file',
  'protected_generated_output',
]);
const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']);
const GENERATED_ROOTS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', 'out']);
const BINARY_EXTENSIONS = new Set([
  '.7z', '.avi', '.bmp', '.class', '.dll', '.eot', '.exe', '.gif', '.gz', '.ico',
  '.jar', '.jpeg', '.jpg', '.mov', '.mp3', '.mp4', '.pdf', '.png', '.so', '.tar',
  '.ttf', '.wasm', '.webp', '.woff', '.woff2', '.zip',
]);
const SECRET_BASENAMES = new Set([
  '.env', 'credentials.json', 'id_dsa', 'id_ed25519', 'id_rsa', 'secrets.json',
]);
const SECRET_EXTENSIONS = new Set(['.key', '.p12', '.pem', '.pfx']);

class BuilderEditIntentWorkspaceGuardError extends Error {
  constructor() {
    super('The proposed file changes could not be admitted.');
    this.name = 'BuilderEditIntentWorkspaceGuardError';
    this.code = 'builder_edit_intent_workspace_guard_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderEditIntentWorkspaceGuardError();
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
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

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || value.length !== 71 || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeId(value, pattern, maximum = 160) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

const BUILDER_ID_PATTERNS = Object.freeze({
  project: /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  conversation: /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  turn: /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  task: /^builder-task:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  run: /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  candidate: /^builder-code-change-candidate:[0-9a-f]{64}$/u,
});

function safeBuilderId(value, kind) {
  return safeId(value, BUILDER_ID_PATTERNS[kind]);
}

function safeEnum(value, allowed) {
  if (!allowed.includes(value)) fail();
  return value;
}

function safeDenseArray(value, maximum, itemFn) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximum) fail();
  const own = Reflect.ownKeys(value);
  if (own.some((key) => typeof key === 'symbol') || own.length !== value.length + 1) fail();
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    result.push(itemFn(descriptor.value));
  }
  return result;
}

function pathKey(value) {
  return value.normalize('NFKC').toUpperCase();
}

function planAuthority(value) {
  exactObject(value, PLAN_AUTHORITY_KEYS);
  for (const [key, expected] of Object.entries(PLAN_AUTHORITY)) {
    if (valueAt(value, key) !== expected) fail();
  }
  return { ...PLAN_AUTHORITY };
}

function guardAuthority(value) {
  exactObject(value, GUARD_AUTHORITY_KEYS);
  for (const [key, expected] of Object.entries(GUARD_AUTHORITY)) {
    if (valueAt(value, key) !== expected) fail();
  }
  return { ...GUARD_AUTHORITY };
}

function fileOperations(candidate) {
  const baseByPath = new Map(candidate.base_source_tree.files.map((file) => [pathKey(file.path), file]));
  return candidate.operations.map((operation) => {
    const existing = baseByPath.get(pathKey(operation.path)) ?? null;
    const operationKind = operation.operation === 'delete'
      ? 'delete'
      : existing === null ? 'create' : 'update';
    return freezeDeep({
      path: operation.path,
      operation: operationKind,
      expected_old_content_digest: existing === null ? null : existing.content_digest,
      proposed_content_digest: operation.content_digest,
    });
  });
}

function riskClass(operations) {
  if (operations.some((operation) => protectedPathReason(operation.path) !== null)) return 'sensitive';
  if (operations.some((operation) => operation.operation === 'delete')) return 'destructive';
  if (operations.length > LARGE_CHANGE_THRESHOLD || operations.some((operation) => isLockfile(operation.path))) {
    return 'approval_required';
  }
  return 'normal';
}

function planDigestBody(plan) {
  return {
    authority: plan.authority,
    base_source_tree_digest: plan.base_source_tree_digest,
    candidate_digest: plan.candidate_digest,
    candidate_id: plan.candidate_id,
    conversation_id: plan.conversation_id,
    created_at_ms: plan.created_at_ms,
    file_operations: plan.file_operations,
    plan_version: plan.plan_version,
    project_id: plan.project_id,
    reason: plan.reason,
    risk_class: plan.risk_class,
    run_id: plan.run_id,
    status: plan.status,
    target_paths: plan.target_paths,
    task_id: plan.task_id,
    turn_id: plan.turn_id,
  };
}

function createBuilderEditIntentPlan(rawInput) {
  exactObject(rawInput, CREATE_PLAN_KEYS);
  let candidate;
  try {
    candidate = sanitizeBuilderCodeChangeCandidate(valueAt(rawInput, 'candidate'));
  } catch (error) {
    if (error instanceof BuilderCodeChangeKernelError) fail();
    fail();
  }
  const operations = fileOperations(candidate);
  if (operations.length < 1 || operations.length > MAX_GUARDED_OPERATIONS) fail();
  const unsigned = {
    plan_version: BUILDER_EDIT_INTENT_PLAN_VERSION,
    project_id: candidate.project_id,
    conversation_id: candidate.conversation_id,
    turn_id: candidate.turn_id,
    task_id: candidate.task_id,
    run_id: candidate.run_id,
    candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest,
    base_source_tree_digest: candidate.base_source_tree.source_tree_digest,
    target_paths: operations.map((operation) => operation.path),
    file_operations: operations,
    reason: 'provider_proposed_code_change',
    risk_class: riskClass(operations),
    status: 'proposed',
    created_at_ms: safeTimestamp(valueAt(rawInput, 'created_at_ms')),
    authority: { ...PLAN_AUTHORITY },
  };
  const planDigest = sha256Canonical(planDigestBody(unsigned));
  return freezeDeep({
    ...unsigned,
    edit_intent_plan_id: `builder-edit-intent-plan:${planDigest.slice('sha256:'.length)}`,
    plan_digest: planDigest,
  });
}

function sanitizeFileOperation(value) {
  exactObject(value, FILE_OPERATION_KEYS);
  const expectedOld = valueAt(value, 'expected_old_content_digest');
  const proposed = valueAt(value, 'proposed_content_digest');
  const operation = safeEnum(valueAt(value, 'operation'), PLAN_OPERATIONS);
  if (
    (expectedOld !== null && safeDigest(expectedOld) !== expectedOld)
    || (proposed !== null && safeDigest(proposed) !== proposed)
    || (operation === 'create' && expectedOld !== null)
    || (operation === 'update' && (expectedOld === null || proposed === null))
    || (operation === 'delete' && (expectedOld === null || proposed !== null))
  ) fail();
  const sourcePath = createBuilderProjectSourceTree({
    files: [{ path: valueAt(value, 'path'), content: 'path validation\n' }],
  }).files[0].path;
  return {
    path: sourcePath,
    operation,
    expected_old_content_digest: expectedOld,
    proposed_content_digest: proposed,
  };
}

function sanitizeBuilderEditIntentPlan(value) {
  exactObject(value, PLAN_KEYS);
  if (valueAt(value, 'plan_version') !== BUILDER_EDIT_INTENT_PLAN_VERSION) fail();
  const operations = safeDenseArray(
    valueAt(value, 'file_operations'),
    MAX_GUARDED_OPERATIONS,
    sanitizeFileOperation,
  );
  if (operations.length < 1) fail();
  const targetPaths = safeDenseArray(
    valueAt(value, 'target_paths'),
    MAX_GUARDED_OPERATIONS,
    (path) => {
      if (typeof path !== 'string' || path.length < 1 || path.length > 512) fail();
      return path;
    },
  );
  if (
    targetPaths.length !== operations.length
    || targetPaths.some((path, index) => path !== operations[index].path)
    || new Set(targetPaths.map(pathKey)).size !== targetPaths.length
  ) fail();
  const unsigned = {
    plan_version: BUILDER_EDIT_INTENT_PLAN_VERSION,
    project_id: safeBuilderId(valueAt(value, 'project_id'), 'project'),
    conversation_id: safeBuilderId(valueAt(value, 'conversation_id'), 'conversation'),
    turn_id: safeBuilderId(valueAt(value, 'turn_id'), 'turn'),
    task_id: safeBuilderId(valueAt(value, 'task_id'), 'task'),
    run_id: safeBuilderId(valueAt(value, 'run_id'), 'run'),
    candidate_id: safeBuilderId(valueAt(value, 'candidate_id'), 'candidate'),
    candidate_digest: safeDigest(valueAt(value, 'candidate_digest')),
    base_source_tree_digest: safeDigest(valueAt(value, 'base_source_tree_digest')),
    target_paths: targetPaths,
    file_operations: operations,
    reason: valueAt(value, 'reason'),
    risk_class: safeEnum(valueAt(value, 'risk_class'), RISK_CLASSES),
    status: valueAt(value, 'status'),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
    authority: planAuthority(valueAt(value, 'authority')),
  };
  if (unsigned.reason !== 'provider_proposed_code_change' || unsigned.status !== 'proposed') fail();
  if (unsigned.risk_class !== riskClass(operations)) fail();
  const planDigest = safeDigest(valueAt(value, 'plan_digest'));
  const planId = safeId(valueAt(value, 'edit_intent_plan_id'), PLAN_ID_PATTERN);
  if (
    sha256Canonical(planDigestBody(unsigned)) !== planDigest
    || planId !== `builder-edit-intent-plan:${planDigest.slice('sha256:'.length)}`
  ) fail();
  return freezeDeep({ ...unsigned, edit_intent_plan_id: planId, plan_digest: planDigest });
}

function extension(path) {
  const basename = path.split('/').at(-1).toLowerCase();
  const index = basename.lastIndexOf('.');
  return index <= 0 ? '' : basename.slice(index);
}

function isLockfile(path) {
  return LOCKFILES.has(path.split('/').at(-1).toLowerCase());
}

function protectedPathReason(path) {
  const segments = path.split('/');
  const normalizedSegments = segments.map((segment) => segment.normalize('NFKC').toLowerCase());
  const basename = normalizedSegments.at(-1);
  if (normalizedSegments.includes('.git')) return 'protected_git_internal';
  if (normalizedSegments.includes('.clawfabric')) return 'protected_builder_internal';
  if (
    SECRET_BASENAMES.has(basename)
    || basename.startsWith('.env.')
    || SECRET_EXTENSIONS.has(extension(path))
  ) return 'protected_secret_file';
  if (BINARY_EXTENSIONS.has(extension(path))) return 'protected_binary_file';
  if (GENERATED_ROOTS.has(normalizedSegments[0])) return 'protected_generated_output';
  return null;
}

function guardDecision(plan, operation, workspaceChangedDuringRun) {
  const protectedReason = protectedPathReason(operation.path);
  let decision = 'allowed';
  let reason = 'ordinary_project_file';
  if (protectedReason !== null) {
    decision = 'denied';
    reason = protectedReason;
  } else if (workspaceChangedDuringRun) {
    decision = 'denied';
    reason = 'user_changed_file_conflict';
  } else if (operation.operation === 'delete') {
    decision = 'approval_required';
    reason = 'file_delete_requires_approval';
  } else if (isLockfile(operation.path)) {
    decision = 'approval_required';
    reason = 'lockfile_change_requires_approval';
  } else if (plan.file_operations.length > LARGE_CHANGE_THRESHOLD) {
    decision = 'approval_required';
    reason = 'large_multi_file_change_requires_approval';
  }
  const body = {
    run_id: plan.run_id,
    path: operation.path,
    operation: operation.operation,
    decision,
    reason,
    user_visible: true,
  };
  const digest = sha256Canonical({ edit_intent_plan_id: plan.edit_intent_plan_id, ...body });
  return freezeDeep({
    guard_decision_id: `builder-workspace-guard-decision:${digest.slice('sha256:'.length)}`,
    ...body,
  });
}

function reportDigestBody(report) {
  return {
    authority: report.authority,
    candidate_digest: report.candidate_digest,
    candidate_id: report.candidate_id,
    decisions: report.decisions,
    edit_intent_plan_id: report.edit_intent_plan_id,
    evaluated_at_ms: report.evaluated_at_ms,
    plan_digest: report.plan_digest,
    project_id: report.project_id,
    observed_workspace_source_tree_digest: report.observed_workspace_source_tree_digest,
    report_version: report.report_version,
    run_id: report.run_id,
    status: report.status,
    summary: report.summary,
  };
}

function evaluateBuilderWorkspaceGuard(rawInput) {
  exactObject(rawInput, EVALUATE_GUARD_KEYS);
  let candidate;
  try {
    candidate = sanitizeBuilderCodeChangeCandidate(valueAt(rawInput, 'candidate'));
  } catch (error) {
    if (error instanceof BuilderCodeChangeKernelError) fail();
    fail();
  }
  const plan = sanitizeBuilderEditIntentPlan(valueAt(rawInput, 'edit_intent_plan'));
  const observedWorkspaceSourceTree = sanitizeBuilderProjectSourceTree(
    valueAt(rawInput, 'observed_workspace_source_tree'),
  );
  const rebuiltPlan = createBuilderEditIntentPlan({
    candidate,
    created_at_ms: plan.created_at_ms,
  });
  if (rebuiltPlan.plan_digest !== plan.plan_digest || rebuiltPlan.edit_intent_plan_id !== plan.edit_intent_plan_id) {
    fail();
  }
  const workspaceChangedDuringRun = observedWorkspaceSourceTree.source_tree_digest
    !== candidate.base_source_tree.source_tree_digest;
  const decisions = plan.file_operations.map(
    (operation) => guardDecision(plan, operation, workspaceChangedDuringRun),
  );
  const deniedCount = decisions.filter((decision) => decision.decision === 'denied').length;
  const approvalRequiredCount = decisions.filter(
    (decision) => decision.decision === 'approval_required',
  ).length;
  const workspaceConflictCount = decisions.filter(
    (decision) => decision.reason === 'user_changed_file_conflict',
  ).length;
  const status = deniedCount > 0
    ? 'denied'
    : approvalRequiredCount > 0 ? 'approval_required' : 'allowed';
  const unsigned = {
    report_version: BUILDER_WORKSPACE_GUARD_REPORT_VERSION,
    edit_intent_plan_id: plan.edit_intent_plan_id,
    plan_digest: plan.plan_digest,
    project_id: plan.project_id,
    run_id: plan.run_id,
    candidate_id: plan.candidate_id,
    candidate_digest: plan.candidate_digest,
    observed_workspace_source_tree_digest: observedWorkspaceSourceTree.source_tree_digest,
    status,
    decisions,
    summary: {
      allowed_count: decisions.length - deniedCount - approvalRequiredCount,
      approval_required_count: approvalRequiredCount,
      denied_count: deniedCount,
      changed_path_count: decisions.length,
      workspace_conflict_count: workspaceConflictCount,
      external_workspace_conflict_check: workspaceConflictCount === 0
        ? 'verified_no_workspace_drift'
        : 'workspace_drift_detected',
    },
    evaluated_at_ms: safeTimestamp(valueAt(rawInput, 'evaluated_at_ms')),
    authority: { ...GUARD_AUTHORITY },
  };
  const reportDigest = sha256Canonical(reportDigestBody(unsigned));
  return freezeDeep({
    ...unsigned,
    guard_report_id: `builder-workspace-guard-report:${reportDigest.slice('sha256:'.length)}`,
    report_digest: reportDigest,
  });
}

function sanitizeGuardDecision(value) {
  exactObject(value, GUARD_DECISION_KEYS);
  const decision = safeEnum(valueAt(value, 'decision'), GUARD_DECISIONS);
  const reason = safeEnum(valueAt(value, 'reason'), GUARD_REASONS);
  const operation = safeEnum(valueAt(value, 'operation'), PLAN_OPERATIONS);
  if (valueAt(value, 'user_visible') !== true) fail();
  const sourcePath = createBuilderProjectSourceTree({
    files: [{ path: valueAt(value, 'path'), content: 'path validation\n' }],
  }).files[0].path;
  const allowedReasons = decision === 'allowed'
    ? ['ordinary_project_file']
    : decision === 'approval_required'
      ? [
        'file_delete_requires_approval',
        'lockfile_change_requires_approval',
        'large_multi_file_change_requires_approval',
      ]
      : [
        'user_changed_file_conflict',
        'protected_git_internal',
        'protected_builder_internal',
        'protected_secret_file',
        'protected_binary_file',
        'protected_generated_output',
      ];
  if (!allowedReasons.includes(reason)) fail();
  return {
    guard_decision_id: safeId(valueAt(value, 'guard_decision_id'), DECISION_ID_PATTERN),
    run_id: valueAt(value, 'run_id'),
    path: sourcePath,
    operation,
    decision,
    reason,
    user_visible: true,
  };
}

function sanitizeSummary(value, decisionCount) {
  exactObject(value, GUARD_SUMMARY_KEYS);
  const summary = {};
  for (const key of [
    'allowed_count',
    'approval_required_count',
    'denied_count',
    'changed_path_count',
    'workspace_conflict_count',
  ]) {
    const count = valueAt(value, key);
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_GUARDED_OPERATIONS) fail();
    summary[key] = count;
  }
  summary.external_workspace_conflict_check = valueAt(value, 'external_workspace_conflict_check');
  if (
    summary.changed_path_count !== decisionCount
    || summary.allowed_count + summary.approval_required_count + summary.denied_count !== decisionCount
    || !['verified_no_workspace_drift', 'workspace_drift_detected']
      .includes(summary.external_workspace_conflict_check)
    || (summary.workspace_conflict_count === 0)
      !== (summary.external_workspace_conflict_check === 'verified_no_workspace_drift')
    || summary.workspace_conflict_count > summary.denied_count
  ) fail();
  return summary;
}

function sanitizeBuilderWorkspaceGuardReport(value) {
  exactObject(value, GUARD_REPORT_KEYS);
  if (valueAt(value, 'report_version') !== BUILDER_WORKSPACE_GUARD_REPORT_VERSION) fail();
  const decisions = safeDenseArray(
    valueAt(value, 'decisions'),
    MAX_GUARDED_OPERATIONS,
    sanitizeGuardDecision,
  );
  if (decisions.length < 1) fail();
  const summary = sanitizeSummary(valueAt(value, 'summary'), decisions.length);
  const status = safeEnum(valueAt(value, 'status'), GUARD_DECISIONS);
  if (
    (status === 'allowed' && (summary.denied_count !== 0 || summary.approval_required_count !== 0))
    || (status === 'approval_required' && (summary.denied_count !== 0 || summary.approval_required_count === 0))
    || (status === 'denied' && summary.denied_count === 0)
  ) fail();
  const unsigned = {
    report_version: BUILDER_WORKSPACE_GUARD_REPORT_VERSION,
    edit_intent_plan_id: safeId(valueAt(value, 'edit_intent_plan_id'), PLAN_ID_PATTERN),
    plan_digest: safeDigest(valueAt(value, 'plan_digest')),
    project_id: safeBuilderId(valueAt(value, 'project_id'), 'project'),
    run_id: safeBuilderId(valueAt(value, 'run_id'), 'run'),
    candidate_id: safeBuilderId(valueAt(value, 'candidate_id'), 'candidate'),
    candidate_digest: safeDigest(valueAt(value, 'candidate_digest')),
    observed_workspace_source_tree_digest: safeDigest(
      valueAt(value, 'observed_workspace_source_tree_digest'),
    ),
    status,
    decisions,
    summary,
    evaluated_at_ms: safeTimestamp(valueAt(value, 'evaluated_at_ms')),
    authority: guardAuthority(valueAt(value, 'authority')),
  };
  if (decisions.some((decision) => decision.run_id !== unsigned.run_id)) fail();
  if (decisions.filter((decision) => decision.reason === 'user_changed_file_conflict').length
    !== summary.workspace_conflict_count) fail();
  for (const decision of decisions) {
    const decisionDigest = sha256Canonical({
      edit_intent_plan_id: unsigned.edit_intent_plan_id,
      run_id: decision.run_id,
      path: decision.path,
      operation: decision.operation,
      decision: decision.decision,
      reason: decision.reason,
      user_visible: decision.user_visible,
    });
    if (decision.guard_decision_id
      !== `builder-workspace-guard-decision:${decisionDigest.slice('sha256:'.length)}`) fail();
  }
  const reportDigest = safeDigest(valueAt(value, 'report_digest'));
  const reportId = safeId(valueAt(value, 'guard_report_id'), REPORT_ID_PATTERN);
  if (
    sha256Canonical(reportDigestBody(unsigned)) !== reportDigest
    || reportId !== `builder-workspace-guard-report:${reportDigest.slice('sha256:'.length)}`
  ) fail();
  return freezeDeep({ ...unsigned, guard_report_id: reportId, report_digest: reportDigest });
}

function safeBoundary(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof BuilderEditIntentWorkspaceGuardError) throw error;
      fail();
    }
  };
}

module.exports = Object.freeze({
  BUILDER_EDIT_INTENT_PLAN_VERSION,
  BUILDER_WORKSPACE_GUARD_REPORT_VERSION,
  LARGE_CHANGE_THRESHOLD,
  BuilderEditIntentWorkspaceGuardError,
  createBuilderEditIntentPlan: safeBoundary(createBuilderEditIntentPlan),
  evaluateBuilderWorkspaceGuard: safeBoundary(evaluateBuilderWorkspaceGuard),
  sanitizeBuilderEditIntentPlan: safeBoundary(sanitizeBuilderEditIntentPlan),
  sanitizeBuilderWorkspaceGuardReport: safeBoundary(sanitizeBuilderWorkspaceGuardReport),
});
