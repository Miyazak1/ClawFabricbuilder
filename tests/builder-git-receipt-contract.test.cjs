'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
  CODE_AUTHORITY,
  PRODUCT_REVISION_ADMISSION,
  CANDIDATE_RECEIPT_KEYS,
  VERIFICATION_RECEIPT_KEYS,
  BuilderGitReceiptContractError,
  canonicalJson,
  sha256Canonical,
  sanitizeBuilderGitCandidateReceipt,
  sanitizeBuilderGitCandidateVerificationReceipt,
  sanitizeBuilderGitCandidateReceiptPair,
  createBuilderGitCandidateVerificationReceipt,
} = require('../electron/builder-git-receipt-contract.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const DIGEST = `sha256:${'1'.repeat(64)}`;
const OTHER_DIGEST = `sha256:${'2'.repeat(64)}`;
const OID = '0123456789abcdef0123456789abcdef01234567';

function expectContractError(error) {
  assert.ok(error instanceof BuilderGitReceiptContractError);
  assert.equal(error.code, 'builder_git_receipt_contract_invalid');
  return true;
}

function candidateReceipt(overrides = {}) {
  const seed = {
    receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: `builder-project:${UUID}`,
    conversation_id: `builder-conversation:${UUID}`,
    turn_id: `builder-turn:${UUID}`,
    task_id: `builder-task:${UUID}`,
    run_id: `builder-run:${UUID}`,
    request_id: `builder-git-request:${UUID}`,
    candidate_id: `builder-code-change-candidate:${'a'.repeat(64)}`,
    candidate_digest: DIGEST,
    resulting_tree_digest: OTHER_DIGEST,
    semantic_identity_digest: `sha256:${'3'.repeat(64)}`,
    verification_receipt_digest: `sha256:${'4'.repeat(64)}`,
    object_format: BUILDER_GIT_RECEIPT_OBJECT_FORMAT,
    commit_oid: OID,
    tree_oid: OID,
    parent_oid: null,
    expected_base_oid: null,
    code_authority: CODE_AUTHORITY,
    product_revision_admission: PRODUCT_REVISION_ADMISSION,
    replay: false,
    ...overrides,
  };
  const verification = createBuilderGitCandidateVerificationReceipt(seed);
  return { ...seed, verification_receipt_digest: sha256Canonical(verification) };
}

test('candidate and verification receipt contracts expose exact wire keys and pair evidence', () => {
  assert.deepEqual(CANDIDATE_RECEIPT_KEYS, [
    'receipt_version',
    'repository_version',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    'request_id',
    'candidate_id',
    'candidate_digest',
    'resulting_tree_digest',
    'semantic_identity_digest',
    'verification_receipt_digest',
    'object_format',
    'commit_oid',
    'tree_oid',
    'parent_oid',
    'expected_base_oid',
    'code_authority',
    'product_revision_admission',
    'replay',
  ]);
  assert.deepEqual(VERIFICATION_RECEIPT_KEYS, [
    'receipt_version',
    'repository_version',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    'request_id',
    'candidate_id',
    'candidate_digest',
    'expected_base_oid',
    'commit_oid',
    'candidate_tree_oid',
    'resulting_tree_digest',
    'semantic_identity_digest',
    'object_format',
    'commit_ref_admission',
    'request_ref_admission',
    'commit_object_admission',
    'verification_admission',
  ]);
  const candidate = candidateReceipt();
  const verification = createBuilderGitCandidateVerificationReceipt(candidate);
  const pair = sanitizeBuilderGitCandidateReceiptPair(candidate, verification);
  assert.deepEqual(pair.candidate_receipt, sanitizeBuilderGitCandidateReceipt(candidate));
  assert.deepEqual(pair.verification_receipt, sanitizeBuilderGitCandidateVerificationReceipt(verification));
  assert.throws(
    () => sanitizeBuilderGitCandidateReceiptPair(
      candidate,
      { ...verification, resulting_tree_digest: DIGEST },
    ),
    expectContractError,
  );
  assert.throws(
    () => sanitizeBuilderGitCandidateReceiptPair(
      { ...candidate, commit_oid: 'f'.repeat(40) },
      { ...verification, commit_oid: 'f'.repeat(40) },
    ),
    expectContractError,
  );
  assert.throws(
    () => sanitizeBuilderGitCandidateReceiptPair(
      { ...candidate, semantic_identity_digest: `sha256:${'f'.repeat(64)}` },
      { ...verification, semantic_identity_digest: `sha256:${'f'.repeat(64)}` },
    ),
    expectContractError,
  );
  assert.throws(
    () => sanitizeBuilderGitCandidateReceipt({ ...candidate, extra: true }),
    expectContractError,
  );
  assert.throws(
    () => sanitizeBuilderGitCandidateVerificationReceipt({ ...verification, extra: true }),
    expectContractError,
  );
});

test('canonical helpers reject hostile structures without invoking accessors', () => {
  let touched = false;
  const arrayWithGetter = [];
  Object.defineProperty(arrayWithGetter, '0', {
    enumerable: true,
    get() {
      touched = true;
      return 'secret';
    },
  });
  assert.throws(() => canonicalJson(arrayWithGetter), expectContractError);
  assert.equal(touched, false);

  const sparseArray = [];
  sparseArray.length = 2;
  sparseArray[1] = 'sparse';
  assert.throws(() => canonicalJson(sparseArray), expectContractError);
  const arrayWithSymbol = ['safe'];
  arrayWithSymbol[Symbol('x')] = 'hidden';
  assert.throws(() => canonicalJson(arrayWithSymbol), expectContractError);
  const arrayProxy = new Proxy(['safe'], {
    get() {
      touched = true;
      return 'secret';
    },
  });
  assert.throws(() => canonicalJson(arrayProxy), expectContractError);

  const objectWithGetter = {};
  Object.defineProperty(objectWithGetter, 'value', {
    enumerable: true,
    get() {
      touched = true;
      return 'secret';
    },
  });
  assert.throws(() => canonicalJson(objectWithGetter), expectContractError);
  assert.equal(touched, false);

  const objectWithHidden = { value: 'safe' };
  Object.defineProperty(objectWithHidden, 'hidden', { enumerable: false, value: 'secret' });
  assert.throws(() => canonicalJson(objectWithHidden), expectContractError);
  const objectWithSymbol = { value: 'safe' };
  objectWithSymbol[Symbol('x')] = 'hidden';
  assert.throws(() => canonicalJson(objectWithSymbol), expectContractError);
  const objectProxy = new Proxy({ value: 'safe' }, {
    get() {
      touched = true;
      return 'secret';
    },
  });
  assert.throws(() => canonicalJson(objectProxy), expectContractError);
  assert.equal(touched, false);
});

test('receipt contract stays pure and independent from repository/runtime consumers', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-git-receipt-contract.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /node:fs|require\(['"][^'"]*(?:builder-git-project-repository|builder-git-command-runner|dugite)[^'"]*['"]\)|ipcMain|ipcRenderer|BrowserWindow|sqlite|better-sqlite|fetch\s*\(|https?:|safeStorage/iu,
  );
});
