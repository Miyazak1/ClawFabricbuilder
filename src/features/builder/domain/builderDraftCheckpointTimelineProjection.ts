export type BuilderDraftCheckpointTimelineEntryWire = Readonly<{
  checkpoint_sequence: number;
  created_at_ms: number;
  label: 'Automatic checkpoint';
  changed_file_count: number;
  verification_status: 'candidate_verified' | 'candidate_verified_with_warnings';
  is_current: boolean;
}>;

export type BuilderDraftCheckpointTimelineProjectionWire = Readonly<{
  projection_version: 'builder-draft-checkpoint-timeline-projection.v1';
  status: 'absent' | 'ready';
  entries: readonly BuilderDraftCheckpointTimelineEntryWire[];
  truncated: boolean;
  authority: Readonly<{
    projection_authority: 'main_owned_draft_checkpoint_timeline_projection_v1';
    checkpoint_store_read: 'verified_absent_task_checkpoint_list' | 'verified_task_checkpoint_list';
    checkpoint_facts: 'none' | 'bounded_safe_projection';
    renderer_authority: 'not_present';
    ipc_authority: 'not_present';
    provider_dispatch: false;
    tool_dispatch: false;
    source_read: 'not_present';
    source_write: 'not_present';
    git_read: 'not_present';
    git_write: false;
    sqlite_write: false;
    restore_authority: false;
    revision_admission: 'not_created';
    save_authority: false;
    publication: false;
  }>;
}>;

const PROJECTION_KEYS = Object.freeze([
  'projection_version', 'status', 'entries', 'truncated', 'authority',
]);
const ENTRY_KEYS = Object.freeze([
  'checkpoint_sequence', 'created_at_ms', 'label', 'changed_file_count',
  'verification_status', 'is_current',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority', 'checkpoint_store_read', 'checkpoint_facts',
  'renderer_authority', 'ipc_authority', 'provider_dispatch', 'tool_dispatch',
  'source_read', 'source_write', 'git_read', 'git_write', 'sqlite_write',
  'restore_authority', 'revision_admission', 'save_authority', 'publication',
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

function validEntry(value: unknown): value is BuilderDraftCheckpointTimelineEntryWire {
  if (!exactRecord(value, ENTRY_KEYS)) return false;
  return Number.isSafeInteger(value.checkpoint_sequence)
    && (value.checkpoint_sequence as number) >= 1
    && (value.checkpoint_sequence as number) <= 1_000_000
    && Number.isSafeInteger(value.created_at_ms)
    && (value.created_at_ms as number) >= 0
    && (value.created_at_ms as number) <= 8_640_000_000_000_000
    && value.label === 'Automatic checkpoint'
    && Number.isSafeInteger(value.changed_file_count)
    && (value.changed_file_count as number) >= 0
    && (value.changed_file_count as number) <= 50_000
    && ['candidate_verified', 'candidate_verified_with_warnings'].includes(
      value.verification_status as string,
    )
    && typeof value.is_current === 'boolean';
}

export function sanitizeBuilderDraftCheckpointTimelineProjectionWire(
  value: unknown,
): BuilderDraftCheckpointTimelineProjectionWire | null {
  try {
    if (
      !exactRecord(value, PROJECTION_KEYS)
      || !exactRecord(value.authority, AUTHORITY_KEYS)
      || value.projection_version !== 'builder-draft-checkpoint-timeline-projection.v1'
      || (value.status !== 'absent' && value.status !== 'ready')
      || !Array.isArray(value.entries)
      || value.entries.length > 12
      || !value.entries.every(validEntry)
      || typeof value.truncated !== 'boolean'
    ) return null;
    const entries = value.entries as BuilderDraftCheckpointTimelineEntryWire[];
    if ((value.status === 'absent') !== (entries.length === 0)) return null;
    if (value.status === 'ready' && entries.filter((entry) => entry.is_current).length !== 1) {
      return null;
    }
    for (let index = 1; index < entries.length; index += 1) {
      if (entries[index - 1].checkpoint_sequence <= entries[index].checkpoint_sequence) return null;
    }
    const authority = value.authority;
    const ready = value.status === 'ready';
    if (
      authority.projection_authority !== 'main_owned_draft_checkpoint_timeline_projection_v1'
      || authority.checkpoint_store_read !== (ready
        ? 'verified_task_checkpoint_list'
        : 'verified_absent_task_checkpoint_list')
      || authority.checkpoint_facts !== (ready ? 'bounded_safe_projection' : 'none')
      || authority.renderer_authority !== 'not_present'
      || authority.ipc_authority !== 'not_present'
      || authority.provider_dispatch !== false
      || authority.tool_dispatch !== false
      || authority.source_read !== 'not_present'
      || authority.source_write !== 'not_present'
      || authority.git_read !== 'not_present'
      || authority.git_write !== false
      || authority.sqlite_write !== false
      || authority.restore_authority !== false
      || authority.revision_admission !== 'not_created'
      || authority.save_authority !== false
      || authority.publication !== false
    ) return null;
    return value as BuilderDraftCheckpointTimelineProjectionWire;
  } catch {
    return null;
  }
}
