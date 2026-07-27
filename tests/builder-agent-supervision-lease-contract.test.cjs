'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_AGENT_DEFINITION_RECORD_VERSION,
  BUILDER_AGENT_VERSION_RECORD_VERSION,
  createBuilderAgentDefinitionRecord,
  createBuilderAgentVersionRecord,
} = require('../electron/builder-agent-definition-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
  createBuilderAgentAssignmentRecord,
  createBuilderAgentAssignmentStatusRecord,
} = require('../electron/builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
  BuilderAgentSupervisionLeaseContractError,
  createBuilderAgentSupervisionLeaseRecord,
  createBuilderAgentSupervisionLeaseReleaseRecord,
  sanitizeBuilderAgentSupervisionLeaseRecord,
  sanitizeBuilderAgentSupervisionLeaseReleaseRecord,
} = require('../electron/builder-agent-supervision-lease-contract.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';
const OTHER_SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174009';

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Assistant',
    purpose: 'Help the owner plan and review local Builder work.',
    created_at_ms: 10,
    ...overrides,
  };
}

function definition(overrides = {}) {
  return createBuilderAgentDefinitionRecord(definitionInput(overrides));
}

function versionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Ask before changing files. Summarize proposed work before review.',
    created_at_ms: 20,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function version(definitionRecord, overrides = {}) {
  return createBuilderAgentVersionRecord(versionInput(overrides), definitionRecord);
}

function assignmentInput(agentVersionRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: agentVersionRecord.agent_version_id,
    owner_id: OWNER_ID,
    assigned_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    goal: 'Review the current Builder task and propose the next small change.',
    created_at_ms: 30,
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    result_contract: 'review_required_before_materialization',
    budget: {
      max_steps: 12,
      max_tool_calls: 4,
      max_runtime_ms: 120_000,
      max_private_source_bytes: 32_768,
    },
    ...overrides,
  };
}

function assignment(agentDefinition, agentVersion, overrides = {}) {
  return createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion, overrides),
    agentVersion,
    agentDefinition,
  );
}

function statusInput(assignmentRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignmentRecord.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 40,
    ...overrides,
  };
}

function status(assignmentRecord, overrides = {}) {
  return createBuilderAgentAssignmentStatusRecord(statusInput(assignmentRecord, overrides), assignmentRecord);
}

function fixture() {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const assignmentRecord = assignment(agentDefinition, agentVersion);
  const activeStatus = status(assignmentRecord);
  return { activeStatus, agentDefinition, agentVersion, assignmentRecord };
}

function leaseInput(assignmentRecord, activeStatus, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignmentRecord.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    lease_epoch: 1,
    acquired_at_ms: 50,
    expires_at_ms: 120,
    purpose: 'Supervise one active local assignment attempt.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
    ...overrides,
  };
}

function releaseInput(leaseRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
    lease_id: leaseRecord.lease_id,
    assignment_id: leaseRecord.assignment_id,
    owner_id: OWNER_ID,
    lease_holder_id: SUPERVISOR_ID,
    released_by: SUPERVISOR_ID,
    released_at_ms: 90,
    release_outcome: 'completed',
    reason: 'The supervised attempt returned for review.',
    ...overrides,
  };
}

function assertLeaseError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentSupervisionLeaseContractError);
      assert.equal(error.code, 'builder_agent_supervision_lease_contract_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|credential|api\.deepseek|private marker|source text/iu);
      return true;
    },
  );
}

test('creates deterministic active-assignment supervision lease and release records', () => {
  const { activeStatus, assignmentRecord } = fixture();
  const lease = createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus),
    assignmentRecord,
    activeStatus,
  );
  const sameLease = createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus),
    assignmentRecord,
    activeStatus,
  );

  assert.deepEqual(lease, sameLease);
  assert.match(lease.lease_id, /^builder-agent-supervision-lease:[0-9a-f]{64}$/u);
  assert.equal(lease.definition_digest, assignmentRecord.definition_digest);
  assert.equal(lease.assignment_id, assignmentRecord.assignment_id);
  assert.equal(lease.assignment_status_id, activeStatus.assignment_status_id);
  assert.equal(lease.lease_holder_id, SUPERVISOR_ID);
  assert.equal(lease.redispatch_policy, 'lease_required_no_duplicate_dispatch');
  assert.equal(lease.supervision_state, 'active_assignment_only');
  assert.equal(lease.authority_boundary, 'main_supervision_lease_only');
  assert.equal(Object.hasOwn(lease, 'provider'), false);
  assert.equal(Object.hasOwn(lease, 'credential'), false);
  assert.equal(Object.hasOwn(lease, 'source_tree'), false);
  assert.equal(Object.hasOwn(lease, 'commit'), false);
  assert.equal(Object.hasOwn(lease, 'permission_id'), false);
  assert.equal(Object.isFrozen(lease), true);

  const release = createBuilderAgentSupervisionLeaseReleaseRecord(releaseInput(lease), lease);
  const sameRelease = createBuilderAgentSupervisionLeaseReleaseRecord(releaseInput(lease), lease);
  assert.deepEqual(release, sameRelease);
  assert.match(release.lease_release_id, /^builder-agent-supervision-lease-release:[0-9a-f]{64}$/u);
  assert.equal(release.definition_digest, assignmentRecord.definition_digest);
  assert.equal(release.lease_id, lease.lease_id);
  assert.equal(release.released_by, SUPERVISOR_ID);
  assert.equal(release.release_outcome, 'completed');
  assert.equal(Object.isFrozen(release), true);

  assert.deepEqual(
    sanitizeBuilderAgentSupervisionLeaseRecord(structuredClone(lease), assignmentRecord, activeStatus),
    lease,
  );
  assert.deepEqual(sanitizeBuilderAgentSupervisionLeaseReleaseRecord(structuredClone(release), lease), release);
});

test('rejects inactive status, identity drift, unsafe lease timing, and forged releases', () => {
  const { activeStatus, assignmentRecord } = fixture();
  const lease = createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus),
    assignmentRecord,
    activeStatus,
  );
  const release = createBuilderAgentSupervisionLeaseReleaseRecord(releaseInput(lease), lease);
  const queuedStatus = status(assignmentRecord, {
    next_status: 'queued',
    reason: 'Not active yet.',
    decided_at_ms: 35,
  });

  assertLeaseError(() => createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, queuedStatus, { assignment_status_id: queuedStatus.assignment_status_id }),
    assignmentRecord,
    queuedStatus,
  ));
  assertLeaseError(() => createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus, { owner_id: OTHER_OWNER_ID }),
    assignmentRecord,
    activeStatus,
  ));
  assertLeaseError(() => createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus, { lease_epoch: 0 }),
    assignmentRecord,
    activeStatus,
  ));
  assertLeaseError(() => createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus, { acquired_at_ms: 39 }),
    assignmentRecord,
    activeStatus,
  ));
  assertLeaseError(() => createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus, { expires_at_ms: 50 }),
    assignmentRecord,
    activeStatus,
  ));
  assertLeaseError(() => createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus, { expires_at_ms: 50 + (10 * 60 * 1_000) + 1 }),
    assignmentRecord,
    activeStatus,
  ));
  assertLeaseError(() => createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus, { redispatch_policy: 'allow_duplicate_dispatch' }),
    assignmentRecord,
    activeStatus,
  ));
  assertLeaseError(() => sanitizeBuilderAgentSupervisionLeaseRecord({
    ...lease,
    purpose: `${lease.purpose} changed`,
  }, assignmentRecord, activeStatus));
  assertLeaseError(() => createBuilderAgentSupervisionLeaseReleaseRecord(releaseInput(lease, {
    released_by: OTHER_SUPERVISOR_ID,
  }), lease));
  assertLeaseError(() => createBuilderAgentSupervisionLeaseReleaseRecord(releaseInput(lease, {
    released_at_ms: 121,
  }), lease));
  assertLeaseError(() => createBuilderAgentSupervisionLeaseReleaseRecord(releaseInput(lease, {
    release_outcome: 'expired',
    released_at_ms: 119,
  }), lease));
  assertLeaseError(() => sanitizeBuilderAgentSupervisionLeaseReleaseRecord({
    ...release,
    reason: `${release.reason} changed`,
  }, lease));
});

test('fails closed on extras, accessors, and proxies without leaking raw input', () => {
  const { activeStatus, assignmentRecord } = fixture();

  assertLeaseError(() => createBuilderAgentSupervisionLeaseRecord({
    ...leaseInput(assignmentRecord, activeStatus),
    extra: true,
  }, assignmentRecord, activeStatus));
  assertLeaseError(() => createBuilderAgentSupervisionLeaseRecord({
    ...leaseInput(assignmentRecord, activeStatus),
    purpose: 'Use credential secret-value.\n',
  }, assignmentRecord, activeStatus));

  let getterCalls = 0;
  assertLeaseError(() => createBuilderAgentSupervisionLeaseRecord(Object.defineProperty(
    leaseInput(assignmentRecord, activeStatus),
    'purpose',
    {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'private marker';
      },
    },
  ), assignmentRecord, activeStatus));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private marker');
  };
  assertLeaseError(() => createBuilderAgentSupervisionLeaseRecord(new Proxy(
    leaseInput(assignmentRecord, activeStatus),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  ), assignmentRecord, activeStatus));
  assert.equal(proxyTrapInvoked, false);
});

test('source remains a pure local supervision lease contract with no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'electron', 'builder-agent-supervision-lease-contract.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /node:fs|node:sqlite|ipc|preload|safeStorage|credential|provider|dugite|builder-git|child_process|spawn|exec|fetch|localStorage|sessionStorage/iu);
  assert.match(source, /lease_required_no_duplicate_dispatch/u);
  assert.match(source, /active_assignment_only/u);
  assert.match(source, /main_supervision_lease_only/u);
  assert.match(source, /builder-agent-supervision-lease-contract\.v1/u);
});
