import type {
  BuilderCheckRunAvailableResult,
  BuilderCheckRunApproveRequest,
  BuilderCheckRunCommandKind,
  BuilderCheckRunCompletedResult,
  BuilderCheckRunPort,
  BuilderCheckRunProfile,
  BuilderCheckRunReadRequest,
  BuilderCheckRunStatusProjection,
} from '../application/builderPorts';

type BuilderCheckRunBridge = Readonly<{
  readCurrentDraftAvailableChecks(request: unknown): Promise<unknown>;
  approveAndRunCurrentDraftCheck(request: unknown): Promise<unknown>;
}>;

const BRIDGE_KEYS = Object.freeze([
  'readCurrentDraftAvailableChecks',
  'approveAndRunCurrentDraftCheck',
]);
const READ_REQUEST_KEYS = Object.freeze(['draft_id']);
const RUN_REQUEST_KEYS = Object.freeze(['draft_id', 'command_profile_id']);
const READ_RESULT_KEYS = Object.freeze([
  'result_version', 'service_version', 'operation', 'status', 'draft_id',
  'project_id', 'candidate_id', 'available_checks',
]);
const RUN_RESULT_KEYS = Object.freeze([
  'result_version', 'service_version', 'operation', 'draft_id', 'project_id',
  'candidate_id', 'check_run_status_projection',
]);
const PROFILE_KEYS = Object.freeze([
  'command_profile_id', 'command_kind', 'command_display', 'requires_user_approval',
]);
const PROJECTION_KEYS = Object.freeze([
  'projection_version', 'project_id', 'candidate_id', 'check_run_id', 'command_kind',
  'command_label', 'status', 'label', 'summary', 'completed_at_ms', 'result_digest', 'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority', 'check_run_authority', 'renderer_authority', 'ipc_authority',
  'raw_output', 'runtime_paths', 'provider_dispatch', 'command_execution', 'source_write',
  'git_write', 'sqlite_write', 'save_authority',
]);
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const PROFILE_ID_PATTERN = /^builder-command-profile:[0-9a-f]{32}$/u;
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const CHECK_RUN_ID_PATTERN = /^builder-check-run:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMANDS = Object.freeze({
  lint: { displays: ['npm run lint', 'pnpm run lint', 'yarn lint', 'bun run lint'], label: 'Lint' },
  typecheck: {
    displays: ['npm run typecheck', 'pnpm run typecheck', 'yarn typecheck', 'bun run typecheck'],
    label: 'Type check',
  },
  test: { displays: ['npm test', 'pnpm test', 'yarn test', 'bun run test'], label: 'Tests' },
  build: { displays: ['npm run build', 'pnpm run build', 'yarn build', 'bun run build'], label: 'Build' },
});
const STATUS_TUPLES = new Set([
  JSON.stringify(['passed', 'Checked', 'The project check completed successfully.']),
  JSON.stringify(['failed', 'Check failed', 'The project check found a problem that needs review.']),
  JSON.stringify(['failed', 'Check failed', 'The project check produced too much output to review safely.']),
  JSON.stringify(['incomplete', 'Check incomplete', 'The project check reached its time limit.']),
  JSON.stringify(['incomplete', 'Check incomplete', 'The project check was cancelled.']),
  JSON.stringify(['incomplete', 'Check unavailable', 'The required local check environment is unavailable.']),
  JSON.stringify(['incomplete', 'Check unavailable', 'The project check could not be started.']),
  JSON.stringify(['incomplete', 'Check needs attention', 'Builder could not confirm that the project check stopped.']),
]);

export class BuilderDesktopCheckRunPortError extends Error {
  readonly code = 'builder_check_run_unavailable';

  constructor() {
    super('Project checks are unavailable.');
    this.name = 'BuilderDesktopCheckRunPortError';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function unavailable(): BuilderDesktopCheckRunPortError {
  return new BuilderDesktopCheckRunPortError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) throw unavailable();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(
    (key) => typeof key !== 'string' || !keys.includes(key),
  )) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw unavailable();
    }
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, descriptors[key].value])));
}

function sanitizeBridge(value: unknown): BuilderCheckRunBridge {
  const source = exactRecord(value, BRIDGE_KEYS);
  if (
    typeof source.readCurrentDraftAvailableChecks !== 'function'
    || typeof source.approveAndRunCurrentDraftCheck !== 'function'
  ) throw unavailable();
  return Object.freeze({
    readCurrentDraftAvailableChecks: source.readCurrentDraftAvailableChecks as (request: unknown) => Promise<unknown>,
    approveAndRunCurrentDraftCheck: source.approveAndRunCurrentDraftCheck as (request: unknown) => Promise<unknown>,
  });
}

function readRequest(value: unknown) {
  const source = exactRecord(value, READ_REQUEST_KEYS);
  if (typeof source.draft_id !== 'string' || !DRAFT_ID_PATTERN.test(source.draft_id)) {
    throw unavailable();
  }
  return Object.freeze({ draft_id: source.draft_id });
}

function runRequest(value: unknown) {
  const source = exactRecord(value, RUN_REQUEST_KEYS);
  if (
    typeof source.draft_id !== 'string'
    || !DRAFT_ID_PATTERN.test(source.draft_id)
    || typeof source.command_profile_id !== 'string'
    || !PROFILE_ID_PATTERN.test(source.command_profile_id)
  ) throw unavailable();
  return Object.freeze({
    draft_id: source.draft_id,
    command_profile_id: source.command_profile_id,
  });
}

function commandKind(value: unknown): BuilderCheckRunCommandKind {
  if (typeof value !== 'string' || !Object.hasOwn(COMMANDS, value)) throw unavailable();
  return value as BuilderCheckRunCommandKind;
}

function profile(value: unknown): BuilderCheckRunProfile {
  const source = exactRecord(value, PROFILE_KEYS);
  const kind = commandKind(source.command_kind);
  if (
    typeof source.command_profile_id !== 'string'
    || !PROFILE_ID_PATTERN.test(source.command_profile_id)
    || typeof source.command_display !== 'string'
    || !COMMANDS[kind].displays.includes(source.command_display)
    || source.requires_user_approval !== true
  ) throw unavailable();
  return Object.freeze({
    command_profile_id: source.command_profile_id,
    command_kind: kind,
    command_display: source.command_display,
    requires_user_approval: true,
  });
}

function authority(value: unknown): void {
  const source = exactRecord(value, AUTHORITY_KEYS);
  if (
    source.projection_authority !== 'main_owned_check_run_status_projection_v1'
    || source.check_run_authority !== 'verified_check_run_contract'
    || source.renderer_authority !== 'read_only_projection'
    || source.ipc_authority !== 'projection_only'
    || source.raw_output !== 'not_present'
    || source.runtime_paths !== 'not_present'
    || source.provider_dispatch !== false
    || source.command_execution !== false
    || source.source_write !== 'not_present'
    || source.git_write !== false
    || source.sqlite_write !== false
    || source.save_authority !== false
  ) throw unavailable();
}

function projection(value: unknown, projectId: string, candidateId: string): BuilderCheckRunStatusProjection {
  const source = exactRecord(value, PROJECTION_KEYS);
  const kind = commandKind(source.command_kind);
  if (
    source.projection_version !== 'builder-check-run-status-projection.v1'
    || source.project_id !== projectId
    || source.candidate_id !== candidateId
    || typeof source.check_run_id !== 'string'
    || !CHECK_RUN_ID_PATTERN.test(source.check_run_id)
    || source.command_label !== COMMANDS[kind].label
    || typeof source.status !== 'string'
    || typeof source.label !== 'string'
    || typeof source.summary !== 'string'
    || !STATUS_TUPLES.has(JSON.stringify([source.status, source.label, source.summary]))
    || typeof source.completed_at_ms !== 'number'
    || !Number.isSafeInteger(source.completed_at_ms)
    || source.completed_at_ms < 0
    || typeof source.result_digest !== 'string'
    || !DIGEST_PATTERN.test(source.result_digest)
  ) throw unavailable();
  authority(source.authority);
  return Object.freeze({
    projection_version: 'builder-check-run-status-projection.v1',
    project_id: projectId,
    candidate_id: candidateId,
    check_run_id: source.check_run_id,
    command_kind: kind,
    command_label: source.command_label as BuilderCheckRunStatusProjection['command_label'],
    status: source.status as BuilderCheckRunStatusProjection['status'],
    label: source.label as BuilderCheckRunStatusProjection['label'],
    summary: source.summary,
    completed_at_ms: source.completed_at_ms,
    result_digest: source.result_digest,
  });
}

function availableResult(value: unknown, draftId: string): BuilderCheckRunAvailableResult {
  const source = exactRecord(value, READ_RESULT_KEYS);
  if (
    source.result_version !== 'builder-check-run-current-draft-read-result.v1'
    || source.service_version !== 'builder-check-run-current-draft-service.v1'
    || source.operation !== 'current_draft_available_checks_read'
    || !['ready', 'no_checks'].includes(source.status as string)
    || source.draft_id !== draftId
    || typeof source.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(source.project_id)
    || typeof source.candidate_id !== 'string'
    || !CANDIDATE_ID_PATTERN.test(source.candidate_id)
    || !Array.isArray(source.available_checks)
    || source.available_checks.length > 4
  ) throw unavailable();
  const profiles = Object.freeze(source.available_checks.map(profile));
  if (
    (source.status === 'ready') !== (profiles.length > 0)
    || new Set(profiles.map((entry) => entry.command_profile_id)).size !== profiles.length
  ) throw unavailable();
  return Object.freeze({
    result_version: 'builder-check-run-current-draft-read-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_available_checks_read',
    status: source.status as BuilderCheckRunAvailableResult['status'],
    draft_id: draftId,
    project_id: source.project_id,
    candidate_id: source.candidate_id,
    available_checks: profiles,
  });
}

function completedResult(value: unknown, draftId: string): BuilderCheckRunCompletedResult {
  const source = exactRecord(value, RUN_RESULT_KEYS);
  if (
    source.result_version !== 'builder-check-run-current-draft-run-result.v1'
    || source.service_version !== 'builder-check-run-current-draft-service.v1'
    || source.operation !== 'current_draft_approved_check_completed'
    || source.draft_id !== draftId
    || typeof source.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(source.project_id)
    || typeof source.candidate_id !== 'string'
    || !CANDIDATE_ID_PATTERN.test(source.candidate_id)
  ) throw unavailable();
  return Object.freeze({
    result_version: 'builder-check-run-current-draft-run-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_approved_check_completed',
    draft_id: draftId,
    project_id: source.project_id,
    candidate_id: source.candidate_id,
    check_run_status_projection: projection(
      source.check_run_status_projection,
      source.project_id,
      source.candidate_id,
    ),
  });
}

export function createBuilderDesktopCheckRunPort(value: unknown): BuilderCheckRunPort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    async readCurrentDraftAvailableChecks(request: BuilderCheckRunReadRequest) {
      try {
        const safe = readRequest(request);
        return availableResult(await Reflect.apply(
          bridge.readCurrentDraftAvailableChecks,
          bridge,
          [safe],
        ), safe.draft_id);
      } catch {
        throw unavailable();
      }
    },
    async approveAndRunCurrentDraftCheck(request: BuilderCheckRunApproveRequest) {
      try {
        const safe = runRequest(request);
        return completedResult(await Reflect.apply(
          bridge.approveAndRunCurrentDraftCheck,
          bridge,
          [safe],
        ), safe.draft_id);
      } catch {
        throw unavailable();
      }
    },
  });
}
