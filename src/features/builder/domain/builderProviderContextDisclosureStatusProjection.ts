export type BuilderProviderContextDisclosureStatusProjectionWire = Readonly<{
  projection_version: 'builder-provider-context-disclosure-status-projection.v1';
  label:
    | 'AI context allowed'
    | 'AI context not allowed'
    | 'Allow AI to use current context';
  tone: 'neutral' | 'success' | 'warning';
  next_action_hint:
    | 'Builder can use the approved task context for this AI request.'
    | 'Builder will continue without sharing the current task context.'
    | 'Review this before Builder shares the current task context.';
  needs_user_approval: boolean;
  can_use_provider_context: boolean;
  blocked_reason:
    | 'context_disclosure_denied'
    | 'context_disclosure_not_approved'
    | null;
  request_available: boolean;
  inspection: BuilderProviderContextDisclosureInspectionWire | null;
  authority: Readonly<{
    projection_authority: 'main_owned_provider_context_disclosure_status_projection_v1';
    disclosure_request_preparation: 'verified_safe_inspection_only';
    renderer_authority: 'not_present';
    provider_context_body: 'not_present';
    provider_dispatch: false;
    tool_dispatch: false;
    source_read: 'not_present';
    source_write: 'not_present';
    git_mutation: false;
    sqlite_write: false;
    permission_grant: false;
    revision_admission: 'not_created';
    secret_access: 'not_present';
  }>;
}>;

export type BuilderProviderContextDisclosureInspectionWire = Readonly<{
  title: string;
  summary: string;
  details: string;
  purpose: 'answer' | 'plan' | 'contextual_build';
  provider_scope: 'configured_provider';
  context_surface: Readonly<{
    working_context_state_status:
      | 'approved_plan_ready'
      | 'discussing'
      | 'empty'
      | 'needs_clarification'
      | 'ready'
      | 'stale';
    segment_count: number;
    segment_kinds: readonly (
      | 'approved_plan'
      | 'compaction_summary'
      | 'current_result'
      | 'handoff_summary'
      | 'latest_user_message'
      | 'selected_source_summary'
      | 'working_context_constraints'
      | 'working_context_objective'
    )[];
    omitted_ref_count: number;
    budget: Readonly<{
      used_prompt_bytes: number;
      max_prompt_bytes: number;
      reserved_response_bytes: number;
    }>;
    permission_gate: Readonly<{
      workspace_state: 'bound' | 'missing';
      write_permission: 'allowed' | 'ask' | 'denied' | 'not_required';
      side_effect_ready: boolean;
    }>;
  }>;
}>;

const PROJECTION_VERSION = 'builder-provider-context-disclosure-status-projection.v1';
const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'label',
  'tone',
  'next_action_hint',
  'needs_user_approval',
  'can_use_provider_context',
  'blocked_reason',
  'request_available',
  'inspection',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'disclosure_request_preparation',
  'renderer_authority',
  'provider_context_body',
  'provider_dispatch',
  'tool_dispatch',
  'source_read',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
  'secret_access',
]);

type ProjectionRecord = Readonly<Record<string, unknown>>;
type ExpectedProjection = Readonly<{
  blockedReason: BuilderProviderContextDisclosureStatusProjectionWire['blocked_reason'];
  canUseProviderContext: boolean;
  label: BuilderProviderContextDisclosureStatusProjectionWire['label'];
  needsUserApproval: boolean;
  nextActionHint: BuilderProviderContextDisclosureStatusProjectionWire['next_action_hint'];
  requestAvailable: boolean;
  tone: BuilderProviderContextDisclosureStatusProjectionWire['tone'];
}>;

const EXPECTED_PROJECTIONS = Object.freeze([
  Object.freeze({
    blockedReason: 'context_disclosure_not_approved',
    canUseProviderContext: false,
    label: 'Allow AI to use current context',
    needsUserApproval: true,
    nextActionHint: 'Review this before Builder shares the current task context.',
    requestAvailable: true,
    tone: 'warning',
  }),
  Object.freeze({
    blockedReason: 'context_disclosure_denied',
    canUseProviderContext: false,
    label: 'AI context not allowed',
    needsUserApproval: false,
    nextActionHint: 'Builder will continue without sharing the current task context.',
    requestAvailable: true,
    tone: 'neutral',
  }),
  Object.freeze({
    blockedReason: null,
    canUseProviderContext: true,
    label: 'AI context allowed',
    needsUserApproval: false,
    nextActionHint: 'Builder can use the approved task context for this AI request.',
    requestAvailable: false,
    tone: 'success',
  }),
] satisfies readonly ExpectedProjection[]);

const BASE_AUTHORITY = Object.freeze({
  disclosure_request_preparation: 'verified_safe_inspection_only',
  git_mutation: false,
  permission_grant: false,
  projection_authority: 'main_owned_provider_context_disclosure_status_projection_v1',
  provider_context_body: 'not_present',
  provider_dispatch: false,
  renderer_authority: 'not_present',
  revision_admission: 'not_created',
  secret_access: 'not_present',
  source_read: 'not_present',
  source_write: 'not_present',
  sqlite_write: false,
  tool_dispatch: false,
});
const INSPECTION_KEYS = Object.freeze([
  'title',
  'summary',
  'details',
  'purpose',
  'provider_scope',
  'context_surface',
]);
const CONTEXT_SURFACE_KEYS = Object.freeze([
  'working_context_state_status',
  'segment_count',
  'segment_kinds',
  'omitted_ref_count',
  'budget',
  'permission_gate',
]);
const BUDGET_KEYS = Object.freeze(['used_prompt_bytes', 'max_prompt_bytes', 'reserved_response_bytes']);
const PERMISSION_GATE_KEYS = Object.freeze(['workspace_state', 'write_permission', 'side_effect_ready']);
const PURPOSES = Object.freeze(['answer', 'plan', 'contextual_build'] as const);
const SEGMENT_KINDS = Object.freeze([
  'approved_plan',
  'compaction_summary',
  'current_result',
  'handoff_summary',
  'latest_user_message',
  'selected_source_summary',
  'working_context_constraints',
  'working_context_objective',
] as const);
const WORKING_CONTEXT_STATES = Object.freeze([
  'approved_plan_ready',
  'discussing',
  'empty',
  'needs_clarification',
  'ready',
  'stale',
] as const);
const WORKSPACE_STATES = Object.freeze(['bound', 'missing'] as const);
const WRITE_PERMISSIONS = Object.freeze(['allowed', 'ask', 'denied', 'not_required'] as const);
const SAFE_COPY_PATTERN = /^[A-Za-z0-9 .,;:/()_-]{1,240}$/u;
const FORBIDDEN_SAFE_COPY_PATTERN =
  /\b(?:sha256|digest|request_id|preparation_id|assembly_id|projection_id):/iu;

function isPlainRecord(value: unknown): value is ProjectionRecord {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasExactDataKeys(value: unknown, keys: readonly string[]): value is ProjectionRecord {
  if (!isPlainRecord(value)) return false;
  try {
    const actualKeys = Reflect.ownKeys(value);
    if (
      actualKeys.length !== keys.length
      || actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) return false;
    return keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    });
  } catch {
    return false;
  }
}

function valueAt(value: ProjectionRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.value;
}

function hasExpectedAuthority(value: unknown): boolean {
  if (!hasExactDataKeys(value, AUTHORITY_KEYS)) return false;
  return AUTHORITY_KEYS.every((key) => valueAt(value, key) === valueAt(BASE_AUTHORITY, key));
}

function safeStringEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;
}

function safeCount(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function safeCopy(value: unknown): string | null {
  return typeof value === 'string'
    && SAFE_COPY_PATTERN.test(value)
    && !FORBIDDEN_SAFE_COPY_PATTERN.test(value)
    ? value
    : null;
}

function sanitizeSegmentKinds(value: unknown): BuilderProviderContextDisclosureInspectionWire['context_surface']['segment_kinds'] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) return null;
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    const kind = descriptor?.enumerable === true
      && Object.hasOwn(descriptor, 'value')
      ? safeStringEnum(descriptor.value, SEGMENT_KINDS)
      : null;
    if (kind === null) return null;
    result.push(kind);
  }
  return Object.freeze([...result]) as BuilderProviderContextDisclosureInspectionWire['context_surface']['segment_kinds'];
}

function sanitizeBudget(value: unknown): BuilderProviderContextDisclosureInspectionWire['context_surface']['budget'] | null {
  if (!hasExactDataKeys(value, BUDGET_KEYS)) return null;
  const maxPromptBytes = safeCount(valueAt(value, 'max_prompt_bytes'), 512, 65_536);
  if (maxPromptBytes === null) return null;
  const usedPromptBytes = safeCount(valueAt(value, 'used_prompt_bytes'), 0, maxPromptBytes);
  const reservedResponseBytes = safeCount(valueAt(value, 'reserved_response_bytes'), 0, 65_536);
  if (usedPromptBytes === null || reservedResponseBytes === null) return null;
  return Object.freeze({
    used_prompt_bytes: usedPromptBytes,
    max_prompt_bytes: maxPromptBytes,
    reserved_response_bytes: reservedResponseBytes,
  });
}

function sanitizePermissionGate(
  value: unknown,
): BuilderProviderContextDisclosureInspectionWire['context_surface']['permission_gate'] | null {
  if (!hasExactDataKeys(value, PERMISSION_GATE_KEYS)) return null;
  const workspaceState = safeStringEnum(valueAt(value, 'workspace_state'), WORKSPACE_STATES);
  const writePermission = safeStringEnum(valueAt(value, 'write_permission'), WRITE_PERMISSIONS);
  const sideEffectReady = valueAt(value, 'side_effect_ready');
  if (workspaceState === null || writePermission === null || typeof sideEffectReady !== 'boolean') return null;
  return Object.freeze({
    workspace_state: workspaceState,
    write_permission: writePermission,
    side_effect_ready: sideEffectReady,
  });
}

function sanitizeContextSurface(
  value: unknown,
): BuilderProviderContextDisclosureInspectionWire['context_surface'] | null {
  if (!hasExactDataKeys(value, CONTEXT_SURFACE_KEYS)) return null;
  const workingContextStateStatus =
    safeStringEnum(valueAt(value, 'working_context_state_status'), WORKING_CONTEXT_STATES);
  const segmentKinds = sanitizeSegmentKinds(valueAt(value, 'segment_kinds'));
  const segmentCount = safeCount(valueAt(value, 'segment_count'), 0, 16);
  const omittedRefCount = safeCount(valueAt(value, 'omitted_ref_count'), 0, 16);
  const budget = sanitizeBudget(valueAt(value, 'budget'));
  const permissionGate = sanitizePermissionGate(valueAt(value, 'permission_gate'));
  if (
    workingContextStateStatus === null
    || segmentKinds === null
    || segmentCount === null
    || segmentCount !== segmentKinds.length
    || omittedRefCount === null
    || budget === null
    || permissionGate === null
  ) return null;
  return Object.freeze({
    working_context_state_status: workingContextStateStatus,
    segment_count: segmentCount,
    segment_kinds: segmentKinds,
    omitted_ref_count: omittedRefCount,
    budget,
    permission_gate: permissionGate,
  });
}

function sanitizeInspection(value: unknown): BuilderProviderContextDisclosureInspectionWire | null {
  if (!hasExactDataKeys(value, INSPECTION_KEYS)) return null;
  const title = safeCopy(valueAt(value, 'title'));
  const summary = safeCopy(valueAt(value, 'summary'));
  const details = safeCopy(valueAt(value, 'details'));
  const purpose = safeStringEnum(valueAt(value, 'purpose'), PURPOSES);
  const providerScope = valueAt(value, 'provider_scope') === 'configured_provider'
    ? 'configured_provider'
    : null;
  const contextSurface = sanitizeContextSurface(valueAt(value, 'context_surface'));
  if (
    title === null
    || summary === null
    || details === null
    || purpose === null
    || providerScope === null
    || contextSurface === null
  ) return null;
  return Object.freeze({
    title,
    summary,
    details,
    purpose,
    provider_scope: providerScope,
    context_surface: contextSurface,
  });
}

function matchesProjection(value: ProjectionRecord, expected: ExpectedProjection): boolean {
  return valueAt(value, 'projection_version') === PROJECTION_VERSION
    && valueAt(value, 'label') === expected.label
    && valueAt(value, 'tone') === expected.tone
    && valueAt(value, 'next_action_hint') === expected.nextActionHint
    && valueAt(value, 'needs_user_approval') === expected.needsUserApproval
    && valueAt(value, 'can_use_provider_context') === expected.canUseProviderContext
    && valueAt(value, 'blocked_reason') === expected.blockedReason
    && valueAt(value, 'request_available') === expected.requestAvailable
    && (
      expected.canUseProviderContext
        ? valueAt(value, 'inspection') === null
        : sanitizeInspection(valueAt(value, 'inspection')) !== null
    )
    && hasExpectedAuthority(valueAt(value, 'authority'));
}

export function sanitizeBuilderProviderContextDisclosureStatusProjectionWire(
  value: unknown,
): BuilderProviderContextDisclosureStatusProjectionWire | null {
  if (!hasExactDataKeys(value, PROJECTION_KEYS)) return null;
  const matched = EXPECTED_PROJECTIONS.find((expected) => matchesProjection(value, expected));
  if (matched === undefined) return null;
  const authority = valueAt(value, 'authority') as ProjectionRecord;
  const inspection = valueAt(value, 'inspection');
  return {
    projection_version: PROJECTION_VERSION,
    label: matched.label,
    tone: matched.tone,
    next_action_hint: matched.nextActionHint,
    needs_user_approval: matched.needsUserApproval,
    can_use_provider_context: matched.canUseProviderContext,
    blocked_reason: matched.blockedReason,
    request_available: matched.requestAvailable,
    inspection: matched.canUseProviderContext ? null : sanitizeInspection(inspection),
    authority: {
      projection_authority: valueAt(authority, 'projection_authority') as 'main_owned_provider_context_disclosure_status_projection_v1',
      disclosure_request_preparation: valueAt(authority, 'disclosure_request_preparation') as 'verified_safe_inspection_only',
      renderer_authority: valueAt(authority, 'renderer_authority') as 'not_present',
      provider_context_body: valueAt(authority, 'provider_context_body') as 'not_present',
      provider_dispatch: false,
      tool_dispatch: false,
      source_read: valueAt(authority, 'source_read') as 'not_present',
      source_write: valueAt(authority, 'source_write') as 'not_present',
      git_mutation: false,
      sqlite_write: false,
      permission_grant: false,
      revision_admission: valueAt(authority, 'revision_admission') as 'not_created',
      secret_access: valueAt(authority, 'secret_access') as 'not_present',
    },
  };
}
