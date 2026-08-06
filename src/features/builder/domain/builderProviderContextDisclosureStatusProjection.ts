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
  authority: Readonly<{
    projection_authority: 'main_owned_provider_context_disclosure_status_projection_v1';
    disclosure_request_preparation: 'verified_not_exposed';
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
  disclosure_request_preparation: 'verified_not_exposed',
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

function matchesProjection(value: ProjectionRecord, expected: ExpectedProjection): boolean {
  return valueAt(value, 'projection_version') === PROJECTION_VERSION
    && valueAt(value, 'label') === expected.label
    && valueAt(value, 'tone') === expected.tone
    && valueAt(value, 'next_action_hint') === expected.nextActionHint
    && valueAt(value, 'needs_user_approval') === expected.needsUserApproval
    && valueAt(value, 'can_use_provider_context') === expected.canUseProviderContext
    && valueAt(value, 'blocked_reason') === expected.blockedReason
    && valueAt(value, 'request_available') === expected.requestAvailable
    && hasExpectedAuthority(valueAt(value, 'authority'));
}

export function sanitizeBuilderProviderContextDisclosureStatusProjectionWire(
  value: unknown,
): BuilderProviderContextDisclosureStatusProjectionWire | null {
  if (!hasExactDataKeys(value, PROJECTION_KEYS)) return null;
  const matched = EXPECTED_PROJECTIONS.find((expected) => matchesProjection(value, expected));
  if (matched === undefined) return null;
  const authority = valueAt(value, 'authority') as ProjectionRecord;
  return {
    projection_version: PROJECTION_VERSION,
    label: matched.label,
    tone: matched.tone,
    next_action_hint: matched.nextActionHint,
    needs_user_approval: matched.needsUserApproval,
    can_use_provider_context: matched.canUseProviderContext,
    blocked_reason: matched.blockedReason,
    request_available: matched.requestAvailable,
    authority: {
      projection_authority: valueAt(authority, 'projection_authority') as 'main_owned_provider_context_disclosure_status_projection_v1',
      disclosure_request_preparation: valueAt(authority, 'disclosure_request_preparation') as 'verified_not_exposed',
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
