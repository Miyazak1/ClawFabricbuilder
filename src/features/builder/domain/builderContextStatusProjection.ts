export type BuilderComposerContextStatus =
  | 'direction_changed'
  | 'handoff_received'
  | 'needs_confirmation'
  | 'ready_to_execute'
  | 'using_approved_plan'
  | null;

const PROJECTION_VERSION = 'builder-context-status-projection.v1';
const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'label',
  'tone',
  'next_action_hint',
  'has_pending_handoff',
  'pending_handoff_count',
  'needs_confirmation',
  'can_contextual_execute',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'working_context_state',
  'pending_handoff_packets',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_read',
  'source_write',
  'git_mutation',
  'permission_grant',
  'revision_admission',
  'secret_access',
]);

type ProjectionRecord = Readonly<Record<string, unknown>>;
type ExpectedProjection = Readonly<{
  canContextualExecute: boolean;
  hasPendingHandoff: boolean;
  label: string;
  needsConfirmation: boolean;
  nextActionHint: string;
  pendingHandoffCount: number | 'positive';
  status: BuilderComposerContextStatus;
  tone: string;
}>;

const EXPECTED_PROJECTIONS = Object.freeze([
  Object.freeze({
    canContextualExecute: false,
    hasPendingHandoff: false,
    label: 'No direction yet',
    needsConfirmation: false,
    nextActionHint: 'Describe what you want to make or change.',
    pendingHandoffCount: 0,
    status: null,
    tone: 'neutral',
  }),
  Object.freeze({
    canContextualExecute: false,
    hasPendingHandoff: false,
    label: 'Direction updated',
    needsConfirmation: false,
    nextActionHint: 'Ask me to make the change when the direction is ready.',
    pendingHandoffCount: 0,
    status: null,
    tone: 'info',
  }),
  Object.freeze({
    canContextualExecute: true,
    hasPendingHandoff: false,
    label: 'Ready to execute current direction',
    needsConfirmation: false,
    nextActionHint: 'You can ask me to make the change.',
    pendingHandoffCount: 0,
    status: 'ready_to_execute',
    tone: 'success',
  }),
  Object.freeze({
    canContextualExecute: false,
    hasPendingHandoff: false,
    label: 'Direction changed',
    needsConfirmation: true,
    nextActionHint: 'Confirm the new direction before I change files.',
    pendingHandoffCount: 0,
    status: 'direction_changed',
    tone: 'warning',
  }),
  Object.freeze({
    canContextualExecute: true,
    hasPendingHandoff: false,
    label: 'Using approved plan',
    needsConfirmation: false,
    nextActionHint: 'You can ask me to apply the approved plan.',
    pendingHandoffCount: 0,
    status: 'using_approved_plan',
    tone: 'success',
  }),
  Object.freeze({
    canContextualExecute: false,
    hasPendingHandoff: false,
    label: 'Needs confirmation',
    needsConfirmation: true,
    nextActionHint: 'Answer the open question before I change files.',
    pendingHandoffCount: 0,
    status: 'needs_confirmation',
    tone: 'warning',
  }),
  Object.freeze({
    canContextualExecute: false,
    hasPendingHandoff: true,
    label: 'Handoff received',
    needsConfirmation: true,
    nextActionHint: 'Review the handoff before the next change.',
    pendingHandoffCount: 'positive',
    status: 'handoff_received',
    tone: 'warning',
  }),
] satisfies readonly ExpectedProjection[]);

const BASE_AUTHORITY = Object.freeze({
  git_mutation: false,
  ipc_authority: 'not_present',
  permission_grant: false,
  projection_authority: 'main_owned_context_status_projection_v1',
  provider_dispatch: false,
  renderer_authority: 'not_present',
  revision_admission: 'not_created',
  secret_access: 'not_present',
  source_read: 'not_present',
  source_write: 'not_present',
  tool_dispatch: false,
  working_context_state: 'verified_not_exposed',
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

function isSafePendingCount(value: unknown, expected: number | 'positive'): boolean {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return false;
  if (expected === 'positive') return value >= 1 && value <= 128;
  return value === expected;
}

function hasExpectedAuthority(value: unknown, hasPendingHandoff: boolean): boolean {
  if (!hasExactDataKeys(value, AUTHORITY_KEYS)) return false;
  const expectedPendingHandoff = hasPendingHandoff ? 'pending_count_only' : 'none';
  return AUTHORITY_KEYS.every((key) => {
    if (key === 'pending_handoff_packets') {
      return valueAt(value, key) === expectedPendingHandoff;
    }
    return valueAt(value, key) === valueAt(BASE_AUTHORITY, key);
  });
}

function matchesProjection(value: ProjectionRecord, expected: ExpectedProjection): boolean {
  return valueAt(value, 'projection_version') === PROJECTION_VERSION
    && valueAt(value, 'label') === expected.label
    && valueAt(value, 'tone') === expected.tone
    && valueAt(value, 'next_action_hint') === expected.nextActionHint
    && valueAt(value, 'has_pending_handoff') === expected.hasPendingHandoff
    && isSafePendingCount(valueAt(value, 'pending_handoff_count'), expected.pendingHandoffCount)
    && valueAt(value, 'needs_confirmation') === expected.needsConfirmation
    && valueAt(value, 'can_contextual_execute') === expected.canContextualExecute
    && hasExpectedAuthority(valueAt(value, 'authority'), expected.hasPendingHandoff);
}

export function composerStatusFromContextProjection(value: unknown): BuilderComposerContextStatus {
  if (!hasExactDataKeys(value, PROJECTION_KEYS)) return null;
  const matched = EXPECTED_PROJECTIONS.find((expected) => matchesProjection(value, expected));
  return matched?.status ?? null;
}
