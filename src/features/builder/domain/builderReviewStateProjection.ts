export type BuilderReviewStateProjectionWire = Readonly<{
  projection_version: 'builder-review-state-projection.v1';
  draft_id: string;
  status: 'ready' | 'blocked';
  label: 'Ready to review' | 'Review not ready';
  summary:
    | 'A recoverable draft is ready to inspect and save.'
    | 'Waiting for a verified draft checkpoint before saving.';
  checkpoint_status: 'ready' | 'missing';
  preview_status: 'not_recorded';
  check_status: 'not_run';
  changed_file_count: number | null;
  can_save: boolean;
  can_discard: true;
  blocking_reasons: readonly ('checkpoint_missing')[];
  authority: Readonly<{
    projection_authority: 'main_owned_review_state_projection_v1';
    candidate_evidence: 'sqlite_conversation_replay_current_unreviewed_candidate';
    checkpoint_evidence: 'verified_latest_candidate_checkpoint' | 'missing_or_unverified';
    renderer_authority: 'not_present';
    ipc_authority: 'projection_only';
    provider_dispatch: false;
    tool_dispatch: false;
    source_read: 'not_present';
    source_write: 'not_present';
    git_write: false;
    sqlite_write: false;
    permission_grant: false;
    revision_admission: 'not_created';
    save_authority: false;
    publication: false;
  }>;
}>;

const PROJECTION_KEYS = Object.freeze([
  'projection_version', 'draft_id', 'status', 'label', 'summary', 'checkpoint_status',
  'preview_status', 'check_status', 'changed_file_count', 'can_save',
  'can_discard', 'blocking_reasons', 'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority', 'candidate_evidence', 'checkpoint_evidence',
  'renderer_authority', 'ipc_authority', 'provider_dispatch', 'tool_dispatch',
  'source_read', 'source_write', 'git_write', 'sqlite_write', 'permission_grant',
  'revision_admission', 'save_authority', 'publication',
]);

type PlainRecord = Record<string, unknown>;
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;

function exactRecord(value: unknown, keys: readonly string[]): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function safeBlockingReasons(value: unknown, ready: boolean): boolean {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => typeof key === 'symbol')) {
    return false;
  }
  return ready ? value.length === 0 : value.length === 1 && value[0] === 'checkpoint_missing';
}

export function sanitizeBuilderReviewStateProjectionWire(
  value: unknown,
): BuilderReviewStateProjectionWire | null {
  try {
    if (!exactRecord(value, PROJECTION_KEYS) || !exactRecord(value.authority, AUTHORITY_KEYS)) {
      return null;
    }
    const ready = value.status === 'ready';
    const authority = value.authority;
    if (
      (!ready && value.status !== 'blocked')
      || value.projection_version !== 'builder-review-state-projection.v1'
      || typeof value.draft_id !== 'string'
      || !DRAFT_ID_PATTERN.test(value.draft_id)
      || value.label !== (ready ? 'Ready to review' : 'Review not ready')
      || value.summary !== (
        ready
          ? 'A recoverable draft is ready to inspect and save.'
          : 'Waiting for a verified draft checkpoint before saving.'
      )
      || value.checkpoint_status !== (ready ? 'ready' : 'missing')
      || value.preview_status !== 'not_recorded'
      || value.check_status !== 'not_run'
      || value.can_save !== ready
      || value.can_discard !== true
      || !safeBlockingReasons(value.blocking_reasons, ready)
      || (
        ready
          ? !Number.isSafeInteger(value.changed_file_count)
            || Number(value.changed_file_count) < 1
            || Number(value.changed_file_count) > 50_000
          : value.changed_file_count !== null
      )
      || authority.projection_authority !== 'main_owned_review_state_projection_v1'
      || authority.candidate_evidence !== 'sqlite_conversation_replay_current_unreviewed_candidate'
      || authority.checkpoint_evidence !== (
        ready ? 'verified_latest_candidate_checkpoint' : 'missing_or_unverified'
      )
      || authority.renderer_authority !== 'not_present'
      || authority.ipc_authority !== 'projection_only'
      || authority.provider_dispatch !== false
      || authority.tool_dispatch !== false
      || authority.source_read !== 'not_present'
      || authority.source_write !== 'not_present'
      || authority.git_write !== false
      || authority.sqlite_write !== false
      || authority.permission_grant !== false
      || authority.revision_admission !== 'not_created'
      || authority.save_authority !== false
      || authority.publication !== false
    ) return null;
    return value as BuilderReviewStateProjectionWire;
  } catch {
    return null;
  }
}
