'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_EVALUATOR_VERSION,
  BUILDER_PERMISSION_FACTS_READ_RESULT_VERSION,
  BUILDER_PERMISSION_GRANT_RECORD_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
  BUILDER_PERMISSION_REVOCATION_RECORD_VERSION,
  BuilderPermissionAuthorityContractError,
  createBuilderPermissionEvaluator,
  createBuilderPermissionGrantRecord,
  createBuilderPermissionRevocationRecord,
  sanitizeBuilderPermissionGrantRecord,
  sanitizeBuilderPermissionRevocationRecord,
} = require('../electron/builder-permission-authority-contract.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const OTHER_PROJECT_ID = 'builder-project:223e4567-e89b-42d3-a456-426614174000';
const ACTOR_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174001';
const OTHER_ACTOR_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const ISSUER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174003';
const REVOKER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174004';

function resource(overrides = {}) {
  return {
    resource_kind: 'project',
    project_id: PROJECT_ID,
    resource_id: 'project:self',
    ...overrides,
  };
}

function grantInput(overrides = {}) {
  return {
    record_version: BUILDER_PERMISSION_GRANT_RECORD_VERSION,
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    project_id: PROJECT_ID,
    actor_id: ACTOR_ID,
    issuer_id: ISSUER_ID,
    scope_kind: 'project',
    action: 'project.edit',
    resource: resource(),
    issued_at_ms: 10,
    expires_at_ms: 100,
    ...overrides,
  };
}

function grant(overrides = {}) {
  return createBuilderPermissionGrantRecord(grantInput(overrides));
}

function revocationInput(permission, overrides = {}) {
  return {
    record_version: BUILDER_PERMISSION_REVOCATION_RECORD_VERSION,
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    permission_id: permission.permission_id,
    project_id: permission.project_id,
    revoker_id: REVOKER_ID,
    revoked_at_ms: 15,
    ...overrides,
  };
}

function revocation(permission, overrides = {}) {
  return createBuilderPermissionRevocationRecord(revocationInput(permission, overrides));
}

function request(overrides = {}) {
  return {
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    actor_id: ACTOR_ID,
    action: 'project.edit',
    resource: resource(),
    now_ms: 20,
    ...overrides,
  };
}

function factsFor(sourceRequest, grants = [], revocations = [], overrides = {}) {
  return {
    result_version: BUILDER_PERMISSION_FACTS_READ_RESULT_VERSION,
    permission_authority: 'main_owned_permission_fact_store',
    policy_version: sourceRequest.policy_version,
    actor_id: sourceRequest.actor_id,
    action: sourceRequest.action,
    resource: sourceRequest.resource,
    grants,
    revocations,
    ...overrides,
  };
}

function evaluatorWith(readPermissionFacts) {
  return createBuilderPermissionEvaluator({
    read_permission_facts: readPermissionFacts,
  });
}

function assertPermissionError(fn) {
  return assert.rejects(
    Promise.resolve().then(fn),
    (error) => {
      assert.ok(error instanceof BuilderPermissionAuthorityContractError);
      assert.equal(error.code, 'builder_permission_authority_contract_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value/iu);
      return true;
    },
  );
}

test('creates canonical durable grant and revocation facts with verified identities', () => {
  const first = grant();
  const second = grant();
  assert.deepEqual(first, second);
  assert.match(first.permission_id, /^builder-permission:[0-9a-f]{64}$/u);
  assert.equal(first.record_version, BUILDER_PERMISSION_GRANT_RECORD_VERSION);
  assert.equal(first.policy_version, BUILDER_PERMISSION_POLICY_VERSION);
  assert.equal(first.scope_kind, 'project');
  assert.equal(first.project_id, PROJECT_ID);
  assert.equal(first.actor_id, ACTOR_ID);
  assert.equal(first.issuer_id, ISSUER_ID);
  assert.deepEqual(first.resource, resource());
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.resource), true);
  assert.deepEqual(sanitizeBuilderPermissionGrantRecord(structuredClone(first)), first);

  const revoked = revocation(first);
  assert.match(revoked.revocation_id, /^builder-permission-revocation:[0-9a-f]{64}$/u);
  assert.equal(revoked.record_version, BUILDER_PERMISSION_REVOCATION_RECORD_VERSION);
  assert.equal(revoked.permission_id, first.permission_id);
  assert.equal(revoked.revoker_id, REVOKER_ID);
  assert.equal(Object.isFrozen(revoked), true);
  assert.deepEqual(sanitizeBuilderPermissionRevocationRecord(structuredClone(revoked)), revoked);

  assert.throws(
    () => sanitizeBuilderPermissionGrantRecord({ ...first, permission_id: `builder-permission:${'f'.repeat(64)}` }),
    BuilderPermissionAuthorityContractError,
  );
  assert.throws(
    () => sanitizeBuilderPermissionRevocationRecord({
      ...revoked,
      revocation_id: `builder-permission-revocation:${'f'.repeat(64)}`,
    }),
    BuilderPermissionAuthorityContractError,
  );
  assert.throws(
    () => createBuilderPermissionGrantRecord({
      ...grantInput(),
      resource: resource({ project_id: OTHER_PROJECT_ID }),
    }),
    BuilderPermissionAuthorityContractError,
  );
  assert.throws(
    () => createBuilderPermissionGrantRecord({
      ...grantInput(),
      action: 'secret.read',
      resource: resource(),
    }),
    BuilderPermissionAuthorityContractError,
  );
});

test('denies by default and rejects request-supplied facts or UI selection', async () => {
  const calls = [];
  const evaluator = evaluatorWith(async (sourceRequest) => {
    calls.push(sourceRequest);
    return factsFor(sourceRequest);
  });
  assert.equal(evaluator.evaluator_version, BUILDER_PERMISSION_EVALUATOR_VERSION);
  assert.equal(evaluator.authority.deny_by_default, true);
  assert.equal(evaluator.authority.fact_authority, 'main_owned_permission_fact_store');
  assert.equal(evaluator.authority.ui_selection_authority, 'not_permission');

  const denied = await evaluator.evaluate(request());
  assert.deepEqual(calls, [request()]);
  assert.deepEqual(denied, {
    decision_version: BUILDER_PERMISSION_DECISION_VERSION,
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    actor_id: ACTOR_ID,
    action: 'project.edit',
    resource: resource(),
    evaluated_at_ms: 20,
    decision: 'denied',
    reason: 'no_matching_active_grant',
    permission_id: null,
    permission_authority: 'builder_permission_facts_deny_by_default_v1',
    ui_selection_authority: 'not_permission',
  });
  assert.equal(Object.isFrozen(denied), true);
  assert.equal(Object.isFrozen(denied.resource), true);

  await assertPermissionError(() => evaluator.evaluate({ ...request(), grants: [grant()] }));
  await assertPermissionError(() => evaluator.evaluate({ ...request(), ui_selected: true }));
});

test('allows only exact active facts read from the main-owned fact authority', async () => {
  const active = grant();
  const staleActor = grant({ actor_id: OTHER_ACTOR_ID });
  const staleAction = grant({ action: 'project.read', resource: resource({ resource_kind: 'project' }) });
  const staleResource = grant({ resource: resource({ resource_id: 'project:other' }) });
  const calls = [];
  const evaluator = evaluatorWith(async (sourceRequest) => {
    calls.push(sourceRequest);
    return factsFor(sourceRequest, [staleActor, staleAction, staleResource, active]);
  });
  const decision = await evaluator.evaluate(request());
  assert.deepEqual(calls, [request()]);
  assert.equal(decision.decision, 'allowed');
  assert.equal(decision.reason, 'matching_active_grant');
  assert.equal(decision.permission_id, active.permission_id);
  assert.equal(decision.permission_authority, 'builder_permission_facts_deny_by_default_v1');
});

test('revocation replays over older active grants without deleting history', async () => {
  const active = grant();
  const revoked = revocation(active);
  const evaluator = evaluatorWith(async (sourceRequest) => factsFor(sourceRequest, [active], [revoked]));
  const denied = await evaluator.evaluate(request());
  assert.equal(denied.decision, 'denied');
  assert.equal(denied.permission_id, null);

  const futureRevocation = revocation(active, { revoked_at_ms: 30 });
  const futureEvaluator = evaluatorWith(async (sourceRequest) => (
    factsFor(sourceRequest, [active], [futureRevocation])
  ));
  const allowed = await futureEvaluator.evaluate(request());
  assert.equal(allowed.decision, 'allowed');
  assert.equal(allowed.permission_id, active.permission_id);
});

test('expired and future grants remain denied without deleting history', async () => {
  for (const candidate of [
    grant({ expires_at_ms: 20 }),
    grant({ issued_at_ms: 21, expires_at_ms: 100 }),
  ]) {
    const evaluator = evaluatorWith(async (sourceRequest) => factsFor(sourceRequest, [candidate]));
    const decision = await evaluator.evaluate(request());
    assert.equal(decision.decision, 'denied');
    assert.equal(decision.permission_id, null);
  }
  assert.throws(() => createBuilderPermissionGrantRecord(grantInput({
    expires_at_ms: 10,
  })), BuilderPermissionAuthorityContractError);
});

test('rejects malformed fact authority output, hostile values, and forged fact sources', async () => {
  const active = grant();
  const evaluator = evaluatorWith(async (sourceRequest) => factsFor(sourceRequest, [active], [], {
    permission_authority: 'renderer_supplied_facts',
  }));
  await assertPermissionError(() => evaluator.evaluate(request()));

  const drift = evaluatorWith(async (sourceRequest) => factsFor(sourceRequest, [active], [], {
    actor_id: OTHER_ACTOR_ID,
  }));
  await assertPermissionError(() => drift.evaluate(request()));

  const tooMany = evaluatorWith(async (sourceRequest) => (
    factsFor(sourceRequest, new Array(257).fill(active))
  ));
  await assertPermissionError(() => tooMany.evaluate(request()));

  await assertPermissionError(() => createBuilderPermissionEvaluator({
    read_permission_facts: async () => factsFor(request()),
    extra: true,
  }).evaluate(request()));

  let getterCalls = 0;
  const grants = [active];
  Object.defineProperty(grants, '0', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private credential getter');
    },
  });
  const accessor = evaluatorWith(async (sourceRequest) => factsFor(sourceRequest, grants));
  await assertPermissionError(() => accessor.evaluate(request()));
  assert.equal(getterCalls, 0);

  assert.throws(() => sanitizeBuilderPermissionGrantRecord(new Proxy(active, {
    ownKeys() {
      throw new Error('private proxy marker');
    },
  })), BuilderPermissionAuthorityContractError);
});

test('source contract has no renderer, provider, storage, Git, network, or execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-permission-authority-contract.cjs'),
    'utf8',
  );
  assert.match(source, /builder_permission_facts_deny_by_default_v1/u);
  assert.match(source, /ui_selection_authority:\s*'not_permission'/u);
  assert.match(source, /fact_authority:\s*'main_owned_permission_fact_store'/u);
  assert.match(source, /EVALUATE_REQUEST_KEYS = Object\.freeze\(\[/u);
  const evaluateKeysBlock = source.slice(
    source.indexOf('const EVALUATE_REQUEST_KEYS'),
    source.indexOf('const FACTS_READ_RESULT_KEYS'),
  );
  assert.doesNotMatch(evaluateKeysBlock, /grants/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|node:fs|node:sqlite|better-sqlite|builder-provider|builder-git|fetch\s*\(|https?:|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu,
  );
});
