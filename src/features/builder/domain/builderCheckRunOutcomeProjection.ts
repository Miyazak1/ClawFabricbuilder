export type BuilderCheckRunOutcomeProjectionWire = Readonly<{
  projection_version: 'builder-check-run-outcome-projection.v1';
  state: 'not_run' | 'skipped' | 'running' | 'completed' | 'unavailable';
  command_kind: 'lint' | 'typecheck' | 'test' | 'build' | null;
  command_label: 'Lint' | 'Type check' | 'Tests' | 'Build' | null;
  status: 'not_run' | 'skipped' | 'running' | 'passed' | 'failed' | 'incomplete' | 'unavailable';
  label: string;
  summary: string;
  completed_at_ms: number | null;
  authority: Readonly<{
    projection_authority: 'main_owned_check_run_outcome_projection_v1';
    fact_source:
      | 'verified_current_candidate_check_run'
      | 'verified_absence'
      | 'verified_explicit_skip_decision'
      | 'activity_registry'
      | 'status_unavailable';
    raw_output: 'not_present';
    runtime_paths: 'not_present';
    renderer_authority: 'read_only_projection';
    save_authority: false;
  }>;
}>;

type PlainRecord = Record<string, unknown>;

const KEYS = Object.freeze([
  'projection_version', 'state', 'command_kind', 'command_label', 'status',
  'label', 'summary', 'completed_at_ms', 'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority', 'fact_source', 'raw_output', 'runtime_paths',
  'renderer_authority', 'save_authority',
]);
const COMMAND_LABELS = Object.freeze({
  lint: 'Lint',
  typecheck: 'Type check',
  test: 'Tests',
  build: 'Build',
});
const SPECIAL = Object.freeze({
  not_run: ['not_run', 'Not checked', 'No project check has been recorded for this draft.', 'verified_absence'],
  skipped: ['skipped', 'Check skipped', 'You chose to save this draft without running a project check.', 'verified_explicit_skip_decision'],
  running: ['running', 'Running checks', 'Checking the current draft before it is saved.', 'activity_registry'],
  unavailable: ['unavailable', 'Check status unavailable', 'Builder could not verify the check status for this draft.', 'status_unavailable'],
} as const);
const COMPLETED_COPY = new Set([
  ['passed', 'Checked', 'The project check completed successfully.'],
  ['failed', 'Check failed', 'The project check found a problem that needs review.'],
  ['failed', 'Check failed', 'The project check produced too much output to review safely.'],
  ['incomplete', 'Check incomplete', 'The project check reached its time limit.'],
  ['incomplete', 'Check incomplete', 'The project check was cancelled.'],
  ['incomplete', 'Check unavailable', 'The required local check environment is unavailable.'],
  ['incomplete', 'Check unavailable', 'The project check could not be started.'],
  ['incomplete', 'Check needs attention', 'Builder could not confirm that the project check stopped.'],
].map((tuple) => JSON.stringify(tuple)));

function exactRecord(value: unknown, keys: readonly string[]): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length
    && ownKeys.every((key) => typeof key === 'string' && keys.includes(key))
    && keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    });
}

export function sanitizeBuilderCheckRunOutcomeProjectionWire(
  value: unknown,
): BuilderCheckRunOutcomeProjectionWire | null {
  try {
    if (!exactRecord(value, KEYS) || !exactRecord(value.authority, AUTHORITY_KEYS)) return null;
    const authority = value.authority;
    if (
      value.projection_version !== 'builder-check-run-outcome-projection.v1'
      || authority.projection_authority !== 'main_owned_check_run_outcome_projection_v1'
      || authority.raw_output !== 'not_present'
      || authority.runtime_paths !== 'not_present'
      || authority.renderer_authority !== 'read_only_projection'
      || authority.save_authority !== false
    ) return null;
    if (value.state === 'completed') {
      const commandKind = value.command_kind;
      if (
        typeof commandKind !== 'string'
        || !Object.hasOwn(COMMAND_LABELS, commandKind)
        || value.command_label !== COMMAND_LABELS[commandKind as keyof typeof COMMAND_LABELS]
        || !COMPLETED_COPY.has(JSON.stringify([value.status, value.label, value.summary]))
        || !Number.isSafeInteger(value.completed_at_ms)
        || (value.completed_at_ms as number) < 0
        || authority.fact_source !== 'verified_current_candidate_check_run'
      ) return null;
      return value as BuilderCheckRunOutcomeProjectionWire;
    }
    if (!Object.hasOwn(SPECIAL, String(value.state))) return null;
    const special = SPECIAL[value.state as keyof typeof SPECIAL];
    if (
      value.command_kind !== null
      || value.command_label !== null
      || value.status !== special[0]
      || value.label !== special[1]
      || value.summary !== special[2]
      || value.completed_at_ms !== null
      || authority.fact_source !== special[3]
    ) return null;
    return value as BuilderCheckRunOutcomeProjectionWire;
  } catch {
    return null;
  }
}
