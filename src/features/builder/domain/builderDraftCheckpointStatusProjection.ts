export type BuilderDraftCheckpointStatusProjectionWire = Readonly<{
  projection_version: 'builder-draft-checkpoint-status-projection.v1';
  status: 'ready';
  label: 'Checkpoint saved';
  tone: 'success';
  next_action_hint: 'You can compare, restore, continue, or save a version.';
  can_compare: true;
  can_restore: true;
  can_save_version: true;
  changed_file_count: number;
  verification_status: 'candidate_verified' | 'candidate_verified_with_warnings';
  authority: Readonly<{
    projection_authority: 'main_owned_draft_checkpoint_status_projection_v1';
    checkpoint_store_read: 'verified_latest_read_result';
    checkpoint_fact: 'verified_not_exposed';
    renderer_authority: 'not_present';
    ipc_authority: 'not_present';
    provider_dispatch: false;
    tool_dispatch: false;
    source_read: 'not_present';
    source_write: 'not_present';
    git_read: 'not_present';
    git_write: false;
    sqlite_write: false;
    permission_grant: false;
    revision_admission: 'not_created';
    save_authority: false;
    publication: false;
  }>;
}>;

const PROJECTION_KEYS = Object.freeze([
  'projection_version', 'status', 'label', 'tone', 'next_action_hint',
  'can_compare', 'can_restore', 'can_save_version', 'changed_file_count',
  'verification_status', 'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority', 'checkpoint_store_read', 'checkpoint_fact',
  'renderer_authority', 'ipc_authority', 'provider_dispatch', 'tool_dispatch',
  'source_read', 'source_write', 'git_read', 'git_write', 'sqlite_write',
  'permission_grant', 'revision_admission', 'save_authority', 'publication',
]);

type PlainRecord = Record<string, unknown>;

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

export function sanitizeBuilderDraftCheckpointStatusProjectionWire(
  value: unknown,
): BuilderDraftCheckpointStatusProjectionWire | null {
  try {
    if (!exactRecord(value, PROJECTION_KEYS) || !exactRecord(value.authority, AUTHORITY_KEYS)) {
      return null;
    }
    const authority = value.authority;
    if (
      value.projection_version !== 'builder-draft-checkpoint-status-projection.v1'
      || value.status !== 'ready'
      || value.label !== 'Checkpoint saved'
      || value.tone !== 'success'
      || value.next_action_hint !== 'You can compare, restore, continue, or save a version.'
      || value.can_compare !== true
      || value.can_restore !== true
      || value.can_save_version !== true
      || !Number.isSafeInteger(value.changed_file_count)
      || (value.changed_file_count as number) < 1
      || (value.changed_file_count as number) > 50_000
      || !['candidate_verified', 'candidate_verified_with_warnings'].includes(
        value.verification_status as string,
      )
      || authority.projection_authority !== 'main_owned_draft_checkpoint_status_projection_v1'
      || authority.checkpoint_store_read !== 'verified_latest_read_result'
      || authority.checkpoint_fact !== 'verified_not_exposed'
      || authority.renderer_authority !== 'not_present'
      || authority.ipc_authority !== 'not_present'
      || authority.provider_dispatch !== false
      || authority.tool_dispatch !== false
      || authority.source_read !== 'not_present'
      || authority.source_write !== 'not_present'
      || authority.git_read !== 'not_present'
      || authority.git_write !== false
      || authority.sqlite_write !== false
      || authority.permission_grant !== false
      || authority.revision_admission !== 'not_created'
      || authority.save_authority !== false
      || authority.publication !== false
    ) return null;
    return value as BuilderDraftCheckpointStatusProjectionWire;
  } catch {
    return null;
  }
}
