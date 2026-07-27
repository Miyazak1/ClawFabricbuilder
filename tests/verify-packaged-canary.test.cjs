'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { PNG } = require('pngjs');

const {
  BuilderPackagedCanaryError,
  CANARY_INPUT_VERSION,
  CANARY_QUESTION,
  CANARY_RESULT_VERSION,
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  assertCustomChromeControls,
  assertExactRevision,
  assertRevisionAdvance,
  assertReadEvidence,
  assertTaskStreamCandidateFacts,
  assertTaskStreamExplanationFacts,
  assertTaskStreamPendingCandidateFacts,
  askProjectQuestionViaUi,
  captureSavedActivityEvidence,
  capturePreviewEvidence,
  captureGuardedUserDataRoot,
  copySavedProviderProfile,
  createUpdateDraftViaUi,
  createArtifactGate,
  ensureCredentialOnlyFromStdin,
  fillProviderSettingsViaUi,
  generateProjectViaUi,
  inspectDraftReviewDiffViaUi,
  inspectHistoryVersionViaUi,
  networkRecorder,
  openProjectFromCatalogById,
  parseCanaryInput,
  readStdin,
  readOnlyBridgeEvidence,
  readSanitizedBridgeEvidence,
  retryFailedDraftViaUi,
  runCli,
  runPackagedCanary,
  sanitizeLaunchEnvironment,
  saveUpdateDraftViaUi,
  summarizePng,
  updateProjectViaUi,
} = require('../scripts/verify-packaged-canary.cjs');

const SOURCE_PATH = path.join(__dirname, '..', 'scripts', 'verify-packaged-canary.cjs');
const PRELOAD_SOURCE_PATH = path.join(__dirname, '..', 'electron', 'preload.cjs');

function reviewDiffEvidence() {
  return {
    changes_panel_visible: true,
    inline_diff_visible: true,
    internal_evidence_hidden: true,
    review_checkpoint_visible: true,
  };
}

function input(overrides = {}) {
  return JSON.stringify({
    executable_path: path.join(process.cwd(), 'release', 'win-unpacked', 'ClawFabric Builder.exe'),
    idea: 'Make a small focus timer.',
    provider: {
      base_url: 'https://provider.example/v1',
      credential: 'real-key-value-secret',
      max_tokens: 8192,
      model: 'builder-model',
      temperature: 0.2,
      timeout_ms: 30000,
    },
    schema_version: CANARY_INPUT_VERSION,
    ...overrides,
  });
}

function savedProfileInput(overrides = {}) {
  return JSON.stringify({
    executable_path: path.join(process.cwd(), 'release', 'win-unpacked', 'ClawFabric Builder.exe'),
    idea: 'Make a small focus timer.',
    mode: 'saved_profile',
    schema_version: CANARY_INPUT_VERSION,
    source_user_data_path: path.join(process.cwd(), 'source-profile'),
    ...overrides,
  });
}

class FakeLocator {
  constructor(page, selector, filterText = null) {
    this.page = page;
    this.selector = selector;
    this.filterText = filterText;
  }

  async click() {
    this.page.events.push(['click', this.selector]);
    if (this.page.failClicks.has(this.selector)) throw new Error('secret-marker');
    if (this.selector === SELECTORS.reviewOpenChanges) {
      this.page.changesPanelVisible = true;
    }
    const historyMatch = /\[data-builder-view-version="Version ([1-9][0-9]*)"\]/u.exec(this.selector);
    if (historyMatch !== null) {
      this.page.historyViewingRevision = Number(historyMatch[1]);
      this.page.versionLabel = `Version ${this.page.savedRevision}`;
    }
  }

  async fill(value) {
    this.page.events.push(['fill', this.selector, value]);
    if (this.page.failFills.has(this.selector)) throw new Error('secret-marker');
    this.page.values.set(this.selector, value);
  }

  contentFrame() {
    this.page.events.push(['contentFrame', this.selector]);
    return {
      locator: (selector) => ({
        innerText: async () => {
          this.page.events.push(['frameInnerText', selector]);
          return 'Focus timer preview';
        },
      }),
    };
  }

  async getAttribute(name) {
    this.page.events.push(['getAttribute', this.selector, name]);
    if (this.selector === SELECTORS.projectPage && name === 'data-builder-project-status') {
      return this.page.projectStatus;
    }
    if (this.selector === SELECTORS.previewFrame && name === 'sandbox') return '';
    if (this.page.failPreviewAttributes) return 'unsafe';
    if (this.selector === SELECTORS.previewFrame && name === 'srcdoc') {
      const previewRevision = this.page.historyViewingRevision
        ?? Math.max(this.page.savedRevision, this.page.candidateTurns);
      return `<!doctype html><meta http-equiv="Content-Security-Policy" content="script-src 'none'"><body><main>Focus timer preview ${previewRevision}</main></body>`;
    }
    return null;
  }

  getByRole(role, options) {
    this.page.events.push(['scopedRole', this.selector, role, options]);
    return new FakeRole(this.page, role, options?.name ?? null);
  }

  getByText(text, options) {
    this.page.events.push(['scopedText', this.selector, text, options]);
    return new FakeText(this.page, text);
  }

  filter(options) {
    const hasText = options?.hasText ?? null;
    this.page.events.push(['filter', this.selector, hasText]);
    return new FakeLocator(this.page, this.selector, hasText);
  }

  first() {
    this.page.events.push(['first', this.selector]);
    return new FakeLocator(this.page, this.selector, this.filterText);
  }

  async inputValue() {
    if (this.page.keepPasswordValue && this.selector === SELECTORS.apiKey) return 'secret-marker';
    return this.page.values.get(this.selector) ?? '';
  }

  async textContent() {
    this.page.events.push(['textContent', this.selector]);
    if (this.selector === SELECTORS.currentVersion) {
      return this.page.forcedVersionLabel ?? this.page.versionLabel;
    }
    if (this.selector === SELECTORS.versionSavedActivity) {
      if (this.page.savedActivityTextOverride !== null) return this.page.savedActivityTextOverride;
      if (this.page.savedActivityRevision <= 0) return '';
      if (
        this.filterText !== null
        && this.filterText !== `This draft was saved as Version ${this.page.savedActivityRevision}.`
      ) return '';
      return `Version saved This draft was saved as Version ${this.page.savedActivityRevision}.`;
    }
    if (this.selector === SELECTORS.reviewCheckpoint) {
      if (this.page.reviewTextOverride !== null) return this.page.reviewTextOverride;
      return 'Review before saving 1 file change: 1 added. Preview and changes are ready.';
    }
    if (this.selector === SELECTORS.changesSummary) {
      return '1 file change: 1 added.';
    }
    if (this.selector === SELECTORS.changesPanel) {
      if (this.page.changesTextOverride !== null) return this.page.changesTextOverride;
      return 'Changes 1 file change: 1 added. 1 line added + Focus timer preview';
    }
    return null;
  }

  async screenshot() {
    if (!this.page.artifactsAllowed) throw new Error('artifact before password cleared');
    return pngFixture();
  }

  async waitFor(options) {
    this.page.events.push(['waitFor', this.selector, options?.state ?? null]);
    if (this.page.failWaitFor.has(this.selector)) throw new Error('secret-marker');
    if (this.selector === SELECTORS.retryDraft) {
      this.page.assertSelectorVisibility(this.selector, this.page.retryDraftVisible, options?.state ?? 'visible');
      return;
    }
    if (this.selector === SELECTORS.unsavedDraft || this.selector === SELECTORS.saveVersion) {
      this.page.assertSelectorVisibility(this.selector, this.page.unsavedDraftVisible, options?.state ?? 'visible');
      return;
    }
    if (this.selector === SELECTORS.historyPreview) {
      this.page.assertSelectorVisibility(this.selector, this.page.historyViewingRevision !== null, options?.state ?? 'visible');
      return;
    }
    if (this.selector === SELECTORS.reviewCheckpoint || this.selector === SELECTORS.reviewOpenChanges) {
      this.page.assertSelectorVisibility(this.selector, this.page.unsavedDraftVisible, options?.state ?? 'visible');
      return;
    }
    if (
      this.selector === SELECTORS.changesPanel
      || this.selector === SELECTORS.changesSummary
      || this.selector === SELECTORS.changeCard
      || this.selector === SELECTORS.changeDiff
      || this.selector === SELECTORS.changeDiffLine
    ) {
      this.page.assertSelectorVisibility(
        this.selector,
        this.page.unsavedDraftVisible && this.page.changesPanelVisible,
        options?.state ?? 'visible',
      );
      return;
    }
    if (this.selector === SELECTORS.preview && this.page.previewVisible === false) {
      return new Promise(() => {});
    }
  }

  locator(selector) {
    this.page.events.push(['scopedLocator', this.selector, selector]);
    return new FakeLocator(this.page, `${this.selector} ${selector}`);
  }
}

class FakeRole {
  constructor(page, role, name) {
    this.page = page;
    this.role = role;
    this.name = name;
  }

  async click() {
    this.page.events.push(['roleClick', this.role, this.name]);
    if (this.page.failRoleClicks.has(`${this.role}:${this.name}`)) throw new Error('secret-marker');
    if (this.name === 'Save provider') this.page.values.set(SELECTORS.apiKey, '');
    if (this.name === 'Make draft') this.page.recordCandidateAttempt(1);
    if (this.name === 'Make change') this.page.recordCandidateAttempt(this.page.savedRevision + 1);
    if (this.name === 'Retry') this.page.retryCandidateAttempt();
    if (this.name === 'Ask') this.page.recordQuestion();
    if (this.name === 'Back to current') {
      this.page.historyViewingRevision = null;
      this.page.versionLabel = `Version ${Math.max(1, this.page.savedRevision)}`;
    }
    if (this.name === 'Save version' && this.page.persistSave) {
      const revision = await this.page.commitSave();
      this.page.draftSaved = revision > 0;
      this.page.savedRevision = revision;
      this.page.savedActivityRevision = revision;
      this.page.versionLabel = `Version ${revision}`;
    }
  }

  async waitFor(options) {
    this.page.events.push(['roleWaitFor', this.role, this.name, options?.state ?? null]);
    if (this.role === 'alert' && this.page.alertVisible === true) return;
    if (this.role === 'alert' && this.page.failAlertWait === true) throw new Error('secret-marker');
    if (this.role !== 'alert') {
      if (this.page.failRoleWaits.has(`${this.role}:${this.name}`)) throw new Error('secret-marker');
      return;
    }
    return new Promise(() => {});
  }

  first() {
    this.page.events.push(['roleFirst', this.role, this.name]);
    return this;
  }

  async isEnabled() {
    this.page.events.push(['roleEnabled', this.role, this.name]);
    return !this.page.disabledRoles.has(`${this.role}:${this.name}`);
  }
}

class FakeText {
  constructor(page, text) {
    this.page = page;
    this.text = text;
  }

  async waitFor(options) {
    this.page.events.push(['textWaitFor', this.text, options?.state ?? null]);
    if (this.page.failTextWaitFor.has(this.text)) throw new Error('secret-marker');
  }
}

class FakePage {
  constructor() {
    this.artifactsAllowed = false;
    this.alertVisible = false;
    this.candidateTurns = 0;
    this.changesPanelVisible = false;
    this.changesTextOverride = null;
    this.draftSaved = false;
    this.persistSave = true;
    this.events = [];
    this.failAlertWait = false;
    this.failClicks = new Set();
    this.failFills = new Set();
    this.failPreviewAttributes = false;
    this.failRoleClicks = new Set();
    this.failRoleWaits = new Set();
    this.failTextWaitFor = new Set();
    this.failWaitFor = new Set();
    this.forcedVersionLabel = null;
    this.historyViewingRevision = null;
    this.disabledRoles = new Set();
    this.draftFailuresRemaining = 0;
    this.keepPasswordValue = false;
    this.lastFailedDraftTarget = null;
    this.previewVisible = true;
    this.projectStatus = 'ready';
    this.questionTurns = 0;
    this.retryDraftVisible = false;
    this.reviewTextOverride = null;
    this.savedActivityRevision = 0;
    this.savedActivityTextOverride = null;
    this.savedRevision = 0;
    this.unsavedDraftVisible = false;
    this.versionLabel = 'Version 1';
    this.values = new Map();
    this.listeners = new Map();
    this.assertSelectorVisibility = (_selector, visible, state) => {
      const expectedVisible = state !== 'hidden';
      if (visible !== expectedVisible) throw new Error('selector visibility mismatch');
    };
    this.commitSave = async () => {
      const revision = Math.max(this.savedRevision + 1, this.candidateTurns);
      this.retryDraftVisible = false;
      this.unsavedDraftVisible = false;
      return revision;
    };
    this.recordCandidateAttempt = (candidateTurns) => {
      if (this.draftFailuresRemaining > 0) {
        this.draftFailuresRemaining -= 1;
        this.alertVisible = true;
        this.lastFailedDraftTarget = candidateTurns;
        this.retryDraftVisible = true;
        this.unsavedDraftVisible = false;
        return;
      }
      if (this.alertVisible === true) {
        this.lastFailedDraftTarget = candidateTurns;
        this.retryDraftVisible = true;
        this.unsavedDraftVisible = false;
        return;
      }
      this.alertVisible = false;
      this.recordCandidateDraft(candidateTurns);
    };
    this.recordCandidateDraft = (candidateTurns) => {
      this.candidateTurns = Math.max(this.candidateTurns, candidateTurns);
      this.changesPanelVisible = false;
      this.retryDraftVisible = false;
      this.unsavedDraftVisible = true;
    };
    this.retryCandidateAttempt = () => {
      this.alertVisible = false;
      this.recordCandidateDraft(this.lastFailedDraftTarget ?? Math.max(this.savedRevision + 1, 1));
      this.lastFailedDraftTarget = null;
    };
    this.recordQuestion = () => {
      this.questionTurns += 1;
    };
  }

  emitRequest(url) {
    for (const listener of this.listeners.get('request') ?? []) listener({ url: () => url });
  }

  getByRole(role, options) {
    return new FakeRole(this, role, options?.name ?? null);
  }

  getByText(text) {
    return new FakeText(this, text);
  }

  locator(selector) {
    return new FakeLocator(this, selector);
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  async evaluate(callback, argument) {
    this.events.push(['evaluate', callback.toString(), argument]);
    return callback({
      projectId: argument.projectId,
    });
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
}

function digestCanonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function sourceEntry(pathValue, content) {
  const body = {
    content,
    entry_kind: 'text_file',
    path: pathValue,
  };
  return { ...body, content_digest: digestCanonical(body) };
}

function revisionEvidence(selectedProjectId, revisionNumber) {
  const previous = revisionNumber > 1 ? revisionEvidence(selectedProjectId, revisionNumber - 1) : null;
  const second = revisionNumber === 2;
  const third = revisionNumber === 3;
  const conversationId = 'builder-conversation:11111111-1111-4111-8111-111111111111';
  const turnId = third
    ? 'builder-turn:cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    : second
      ? 'builder-turn:77777777-7777-4777-8777-777777777777'
      : 'builder-turn:22222222-2222-4222-8222-222222222222';
  const taskId = third
    ? 'builder-task:dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    : second
      ? 'builder-task:88888888-8888-4888-8888-888888888888'
      : 'builder-task:33333333-3333-4333-8333-333333333333';
  const runId = third
    ? 'builder-run:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    : second
      ? 'builder-run:99999999-9999-4999-8999-999999999999'
      : 'builder-run:44444444-4444-4444-8444-444444444444';
  const requestId = third
    ? 'builder-git-request:ffffffff-ffff-4fff-8fff-ffffffffffff'
    : second
      ? 'builder-git-request:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      : 'builder-git-request:55555555-5555-4555-8555-555555555555';
  const reviewId = third
    ? 'builder-review:12121212-1212-4212-8212-121212121212'
    : second
      ? 'builder-review:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      : 'builder-review:66666666-6666-4666-8666-666666666666';
  const candidateId = `builder-code-change-candidate:${(third ? '3' : second ? 'e' : '7').repeat(64)}`;
  const candidateDigest = `sha256:${(third ? '4' : second ? 'f' : '8').repeat(64)}`;
  const semanticIdentityDigest = `sha256:${(third ? '5' : second ? '1' : '9').repeat(64)}`;
  const commitOid = (third ? '4' : second ? 'c' : 'a').repeat(40);
  const treeOid = (third ? '5' : second ? 'd' : 'b').repeat(40);
  const parentOid = previous?.receipt.commit_oid ?? null;
  const files = [
    sourceEntry('app.js', ''),
    sourceEntry('index.html', third
      ? '<main><h1>Focus timer</h1><p>Stay on track.</p><small>Completed sessions appear here.</small></main>'
      : second
        ? '<main><h1>Focus timer</h1><p>Stay on track.</p></main>'
        : '<main>Focus timer</main>'),
    sourceEntry('styles.css', 'main { color: black; }'),
  ];
  const sourceTreeBody = {
    files,
    source_tree_version: 'builder-project-source-tree.v1',
  };
  const sourceTree = {
    ...sourceTreeBody,
    source_tree_digest: digestCanonical(sourceTreeBody),
  };
  const verification = {
    candidate_digest: candidateDigest,
    candidate_id: candidateId,
    candidate_tree_oid: treeOid,
    commit_object_admission: 'verified',
    commit_oid: commitOid,
    commit_ref_admission: 'verified',
    conversation_id: conversationId,
    expected_base_oid: parentOid,
    object_format: 'sha1',
    project_id: selectedProjectId,
    receipt_version: 'builder-git-candidate-verification-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    request_id: requestId,
    request_ref_admission: 'verified',
    resulting_tree_digest: sourceTree.source_tree_digest,
    run_id: runId,
    semantic_identity_digest: semanticIdentityDigest,
    task_id: taskId,
    turn_id: turnId,
    verification_admission: 'accepted',
  };
  const verificationReceiptDigest = digestCanonical(verification);
  const candidate = {
    candidate_digest: candidateDigest,
    candidate_id: candidateId,
    code_authority: 'git_commit_candidate',
    commit_oid: commitOid,
    conversation_id: conversationId,
    expected_base_oid: parentOid,
    object_format: 'sha1',
    parent_oid: parentOid,
    product_revision_admission: 'not_recorded',
    project_id: selectedProjectId,
    receipt_version: 'builder-git-candidate-receipt.v1',
    replay: false,
    repository_version: 'builder-git-project-repository.v1',
    request_id: requestId,
    resulting_tree_digest: sourceTree.source_tree_digest,
    run_id: runId,
    semantic_identity_digest: semanticIdentityDigest,
    task_id: taskId,
    tree_oid: treeOid,
    turn_id: turnId,
    verification_receipt_digest: verificationReceiptDigest,
  };
  const receiptBody = {
    candidate_digest: candidateDigest,
    candidate_id: candidateId,
    commit_oid: commitOid,
    conversation_id: conversationId,
    object_format: 'sha1',
    parent_oid: parentOid,
    previous_revision_receipt_digest: previous?.receipt.revision_receipt_digest ?? null,
    project_id: selectedProjectId,
    request_id: requestId,
    resulting_tree_digest: sourceTree.source_tree_digest,
    review_id: reviewId,
    revision_number: revisionNumber,
    run_id: runId,
    selected_at_ms: revisionNumber * 1000,
    semantic_identity_digest: semanticIdentityDigest,
    summary: 'A timer.',
    task_id: taskId,
    title: 'Focus timer',
    tree_oid: treeOid,
    turn_id: turnId,
    verification_receipt_digest: verificationReceiptDigest,
  };
  const receipt = {
    ...receiptBody,
    revision_receipt_digest: digestCanonical(receiptBody),
  };
  const current = {
    commit_oid: commitOid,
    object_format: 'sha1',
    parent_oid: parentOid,
    project_id: selectedProjectId,
    revision_number: revisionNumber,
    revision_receipt_digest: receipt.revision_receipt_digest,
    summary: receipt.summary,
    title: receipt.title,
    tree_oid: treeOid,
  };
  return { candidate, current, receipt, sourceTree, verification };
}

function taskStreamConversation(selectedProjectId, savedRevision, candidateTurns, questionTurns = 0) {
  const items = [];
  const userMessageIds = [
    'builder-message:10101010-1010-4010-8010-101010101010',
    'builder-message:13131313-1313-4313-8313-131313131313',
    'builder-message:19191919-1919-4919-8919-191919191919',
  ];
  const assistantMessageIds = [
    'builder-message:12121212-1212-4212-8212-121212121212',
    'builder-message:14141414-1414-4414-8414-141414141414',
    'builder-message:20202020-2020-4020-8020-202020202020',
  ];
  const questionUserMessageIds = [
    'builder-message:15151515-1515-4515-8515-151515151515',
  ];
  const questionAssistantMessageIds = [
    'builder-message:16161616-1616-4616-8616-161616161616',
  ];
  const questionTurnIds = [
    'builder-turn:17171717-1717-4717-8717-171717171717',
  ];
  const questionRunIds = [
    'builder-run:18181818-1818-4818-8818-181818181818',
  ];
  let sequence = 0;
  function takeSequence() {
    sequence += 1;
    return sequence;
  }
  function pushCandidateTurn(revision) {
    const evidence = revisionEvidence(selectedProjectId, revision);
    const draftId = `builder-generation-draft:${String(revision).repeat(64)}`;
    items.push(
      {
        item_kind: 'user_message',
        sequence: takeSequence(),
        turn_id: evidence.receipt.turn_id,
        message: {
          message_id: userMessageIds[revision - 1],
          text: revision === 1
            ? 'Make a focus timer.'
            : revision === 2
              ? 'Change the heading.'
              : 'Add a completed-state summary.',
        },
        message_kind: 'submitted',
        mode: 'work',
        task: {
          task_id: evidence.receipt.task_id,
          title: revision === 1
            ? 'Make a focus timer'
            : revision === 2
              ? 'Change the heading'
              : 'Add completed-state summary',
        },
      },
      {
        item_kind: 'run_started',
        sequence: takeSequence(),
        turn_id: evidence.receipt.turn_id,
        run_id: evidence.receipt.run_id,
        task_id: evidence.receipt.task_id,
        attempt_number: 1,
        retry_of_run_id: null,
        recorded_state: 'started',
      },
      {
        item_kind: 'run_completed',
        sequence: takeSequence(),
        turn_id: evidence.receipt.turn_id,
        run_id: evidence.receipt.run_id,
        terminal_status: 'succeeded',
        result_kind: 'candidate',
        assistant_message: {
          message_id: assistantMessageIds[revision - 1],
          text: 'I prepared a draft for review.',
        },
        candidate: {
          draft_id: draftId,
          title: evidence.receipt.title,
          summary: evidence.receipt.summary,
          candidate_state: 'proposed',
          source_availability: 'not_loaded',
        },
      },
      {
        item_kind: 'turn_completed',
        sequence: takeSequence(),
        turn_id: evidence.receipt.turn_id,
        run_id: evidence.receipt.run_id,
        outcome: 'candidate_ready',
      },
    );
    if (revision <= savedRevision) {
      items.push({
        item_kind: 'candidate_reviewed',
        sequence: takeSequence(),
        turn_id: evidence.receipt.turn_id,
        run_id: evidence.receipt.run_id,
        draft_id: draftId,
        decision: 'accepted',
        candidate_state: 'saved',
        saved_revision: { revision_number: revision },
      });
    }
  }
  function pushQuestionTurn(index) {
    const turnId = questionTurnIds[index - 1];
    const runId = questionRunIds[index - 1];
    items.push(
      {
        item_kind: 'user_message',
        sequence: takeSequence(),
        turn_id: turnId,
        message: {
          message_id: questionUserMessageIds[index - 1],
          text: CANARY_QUESTION,
        },
        message_kind: 'submitted',
        mode: 'question',
        task: null,
      },
      {
        item_kind: 'run_started',
        sequence: takeSequence(),
        turn_id: turnId,
        run_id: runId,
        task_id: null,
        attempt_number: 1,
        retry_of_run_id: null,
        recorded_state: 'started',
      },
      {
        item_kind: 'run_completed',
        sequence: takeSequence(),
        turn_id: turnId,
        run_id: runId,
        terminal_status: 'succeeded',
        result_kind: 'explanation',
        assistant_message: {
          message_id: questionAssistantMessageIds[index - 1],
          text: 'It is a focus timer. Review the timer duration before changing it.',
        },
        candidate: null,
      },
      {
        item_kind: 'turn_completed',
        sequence: takeSequence(),
        turn_id: turnId,
        run_id: runId,
        outcome: 'answered',
      },
    );
  }
  if (candidateTurns >= 1) pushCandidateTurn(1);
  for (let question = 1; question <= questionTurns; question += 1) {
    pushQuestionTurn(question);
  }
  for (let revision = 2; revision <= candidateTurns; revision += 1) {
    pushCandidateTurn(revision);
  }
  return {
    conversation_id: revisionEvidence(selectedProjectId, 1).receipt.conversation_id,
    created_at_ms: 1000,
    head_sequence: items.length,
    items,
    recorded_active_turn_id: null,
    window: {
      first_sequence: 1,
      has_earlier: false,
      last_sequence: items.length,
    },
  };
}

function bridgeEvidence(
  projectId = null,
  saved = true,
  revisionNumber = 1,
  candidateTurns = revisionNumber,
  questionTurns = 0,
) {
  const canonicalProjectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const selectedProjectId = projectId ?? canonicalProjectId;
  const revision = revisionEvidence(selectedProjectId, revisionNumber);
  const project = {
    commit_oid: revision.receipt.commit_oid,
    project_id: canonicalProjectId,
    revision_number: revisionNumber,
    revision_receipt_digest: revision.receipt.revision_receipt_digest,
    selected_at_ms: revision.receipt.selected_at_ms,
    summary: revision.receipt.summary,
    title: revision.receipt.title,
    tree_oid: revision.receipt.tree_oid,
  };
  const taskStream = projectId === null
    ? null
    : {
      stream_version: 'builder-task-stream-read-result.v1',
      project_id: projectId,
      conversation: saved
        ? taskStreamConversation(selectedProjectId, revisionNumber, candidateTurns, questionTurns)
        : null,
      authority: {
        conversation: 'sqlite_canonical_event_replay_or_absent',
        project_source: 'not_included',
        candidate_source: 'not_loaded',
        project_revision: 'not_inferred',
      },
    };
  return {
    bridge_contract: {
      bridge_version: 'builder-preload.v5',
      legacy_namespaces_absent: true,
      plan_review_namespace: 'review_method_only',
    },
    catalog: {
      authority_evidence: {
        code_authority: 'not_read_for_catalog',
        current_selection: 'sqlite_current_project_revision',
        product_authority: 'sqlite_product_revision_receipt',
        source_read_admission: 'not_requested',
      },
      operation: 'current_listed',
      result_version: 'builder-project-read-result.v1',
      projects: saved ? [project] : [],
    },
    current: projectId === null || !saved ? null : {
      authority_evidence: {
        code_authority: 'git_commit_tree',
        current_selection: 'sqlite_current_project_revision',
        product_authority: 'sqlite_product_revision_receipt',
        source_read_admission: 'verified',
      },
      current: revision.current,
      git_candidate_receipt: revision.candidate,
      git_verification_receipt: revision.verification,
      operation: 'current_loaded',
      product_revision_receipt: revision.receipt,
      result_version: 'builder-project-read-result.v1',
      source_tree: revision.sourceTree,
    },
    task_stream: taskStream,
    status: {
      status_version: 'builder-provider-settings-status.v1',
      configured: true,
      config_digest: `sha256:${'b'.repeat(64)}`,
      credential_status: 'stored',
    },
  };
}

function installBridge(page) {
  globalThis.clawfabricBuilder = {
    bridgeVersion: 'builder-preload.v5',
    codeGenerator: {
      generate() { throw new Error('must not write through bridge'); },
      retry() { throw new Error('must not write through bridge'); },
      answer() { throw new Error('must not write through bridge'); },
      restoreDraft() { throw new Error('must not write through bridge'); },
      rejectDraft() { throw new Error('must not write through bridge'); },
      cancel() { throw new Error('must not write through bridge'); },
      availability() { throw new Error('must not write through bridge'); },
    },
    projectWorkspace: {
      async open(request) {
        if (request.project_id === null) {
          return {
            result_version: 'builder-project-selection-result.v1',
            operation: 'new_selected',
            project_id: null,
          };
        }
        return bridgeEvidence(
          request.project_id,
          page.draftSaved,
          Math.max(1, page.savedRevision),
          Math.max(1, page.savedRevision, page.candidateTurns),
          page.questionTurns,
        ).current;
      },
      async listCurrent() {
        return bridgeEvidence(
          null,
          page.draftSaved,
          Math.max(1, page.savedRevision),
          Math.max(1, page.savedRevision, page.candidateTurns),
          page.questionTurns,
        ).catalog;
      },
      async loadCurrent(request) {
        return bridgeEvidence(
          request.project_id,
          page.draftSaved,
          Math.max(1, page.savedRevision),
          Math.max(1, page.savedRevision, page.candidateTurns),
          page.questionTurns,
        ).current;
      },
      async loadRevision(request) {
        return {
          ...bridgeEvidence(
            request.project_id,
            page.draftSaved,
            Math.max(1, page.savedRevision),
            Math.max(1, page.savedRevision, page.candidateTurns),
            page.questionTurns,
          ).current,
          operation: 'revision_loaded',
        };
      },
      async listHistory(request) {
        const evidence = bridgeEvidence(
          request.project_id,
          page.draftSaved,
          Math.max(1, page.savedRevision),
          Math.max(1, page.savedRevision, page.candidateTurns),
          page.questionTurns,
        );
        const current = evidence.current?.current ?? null;
        const receipt = evidence.current?.product_revision_receipt ?? null;
        return {
          result_version: 'builder-project-read-result.v1',
          operation: 'history_listed',
          project_id: request.project_id,
          current,
          revisions: receipt === null ? [] : [{
            project_id: receipt.project_id,
            title: receipt.title,
            summary: receipt.summary,
            revision_number: receipt.revision_number,
            revision_receipt_digest: receipt.revision_receipt_digest,
            previous_revision_receipt_digest: receipt.previous_revision_receipt_digest,
            commit_oid: receipt.commit_oid,
            tree_oid: receipt.tree_oid,
            parent_oid: receipt.parent_oid,
            selected_at_ms: receipt.selected_at_ms,
            is_current: true,
          }],
          authority_evidence: {
            product_authority: 'sqlite_product_revision_receipt',
            code_authority: 'git_commit_tree',
            source_read_admission: 'verified',
            current_selection: 'sqlite_current_project_revision',
            history_selection: 'sqlite_project_revision_receipts',
          },
        };
      },
      async saveDraft() { throw new Error('must not write through bridge'); },
    },
    providerSettings: {
      async replaceCurrent() { throw new Error('must not write through bridge'); },
      async status() { return bridgeEvidence().status; },
    },
    permissions: {
      async evaluate() { throw new Error('must not ask permissions through bridge'); },
    },
    taskStream: {
      async read(request) {
        return bridgeEvidence(
          request.project_id,
          page.draftSaved,
          Math.max(1, page.savedRevision),
          Math.max(1, page.savedRevision, page.candidateTurns),
          page.questionTurns,
        )
          .task_stream;
      },
    },
    planReview: {
      async review() { throw new Error('must not review plans through read canary bridge'); },
    },
  };
}

function fakeElectron(page) {
  const durableStore = { candidateTurns: 0, questionTurns: 0, revision: 0 };
  const fake = {
    appEvents: [],
    launches: [],
    pages: [],
    async launch(options) {
      fake.launches.push(options);
      const activePage = fake.launches.length === 1 ? page : new FakePage();
      activePage.candidateTurns = durableStore.candidateTurns;
      activePage.changesPanelVisible = false;
      activePage.questionTurns = durableStore.questionTurns;
      activePage.savedRevision = durableStore.revision;
      activePage.savedActivityRevision = durableStore.revision;
      activePage.draftSaved = durableStore.revision > 0;
      activePage.retryDraftVisible = false;
      activePage.unsavedDraftVisible = durableStore.candidateTurns > durableStore.revision;
      activePage.versionLabel = `Version ${Math.max(1, durableStore.revision)}`;
      activePage.historyViewingRevision = null;
      activePage.commitSave = async () => {
        durableStore.revision = Math.max(durableStore.revision + 1, durableStore.candidateTurns);
        durableStore.candidateTurns = Math.max(durableStore.candidateTurns, durableStore.revision);
        activePage.retryDraftVisible = false;
        activePage.unsavedDraftVisible = false;
        return durableStore.revision;
      };
      activePage.recordCandidateDraft = (candidateTurns) => {
        durableStore.candidateTurns = Math.max(durableStore.candidateTurns, candidateTurns);
        activePage.candidateTurns = durableStore.candidateTurns;
        activePage.changesPanelVisible = false;
        activePage.retryDraftVisible = false;
        activePage.unsavedDraftVisible = true;
      };
      activePage.recordQuestion = () => {
        durableStore.questionTurns += 1;
        activePage.questionTurns = durableStore.questionTurns;
      };
      fake.pages.push(activePage);
      const requestListeners = [];
      return {
        context: () => {
          fake.appEvents.push(['context']);
          return {
            on: (event, listener) => {
              fake.appEvents.push(['contextOn', event]);
              if (event === 'request') requestListeners.push(listener);
            },
          };
        },
        async close() {},
        emitRequest(url) {
          for (const listener of requestListeners) listener({ url: () => url });
        },
        async firstWindow() {
          fake.appEvents.push(['firstWindow']);
          activePage.evaluate = async (callback, argument) => {
            activePage.events.push(['evaluate', callback.toString(), argument]);
            return bridgeEvidence(
              argument.projectId,
              durableStore.revision > 0,
              Math.max(1, durableStore.revision),
              Math.max(1, durableStore.revision, durableStore.candidateTurns),
              durableStore.questionTurns,
            );
          };
          activePage.artifactsAllowed = true;
          return activePage;
        },
      };
    },
  };
  return fake;
}

function pngFixture() {
  const png = new PNG({ width: 5, height: 5 });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = offset % 8 === 0 ? 10 : 40;
    png.data[offset + 1] = offset % 8 === 0 ? 40 : 80;
    png.data[offset + 2] = offset % 8 === 0 ? 80 : 120;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

function fakeStat(dev, ino, {
  directory = true,
  mtimeMs = 1,
  size = 64n,
  symbolic = false,
} = {}) {
  return {
    dev,
    ino,
    mtimeMs,
    size,
    isDirectory() { return directory; },
    isFile() { return !directory; },
    isSymbolicLink() { return symbolic; },
  };
}

function fakeDirectoryStat(dev, ino, symbolic = false) {
  return fakeStat(dev, ino, { directory: true, symbolic });
}

function fakeFileStat(dev, ino, size = 64n, symbolic = false, mtimeMs = 1) {
  return fakeStat(dev, ino, { directory: false, mtimeMs, size, symbolic });
}

function fakeDirent(name, file = true) {
  return {
    name,
    isFile() { return file; },
  };
}

function guardedFixture() {
  const tempRoot = path.join(process.cwd(), 'canary-temp');
  const userDataPath = path.join(tempRoot, `${PACKAGED_CANARY_USER_DATA_PREFIX}unit`);
  const state = {
    directories: new Map(),
    files: new Map(),
    realpath: new Map([
      [tempRoot, tempRoot],
      [userDataPath, userDataPath],
    ]),
    stats: new Map([
      [tempRoot, fakeDirectoryStat(1n, 10n)],
      [userDataPath, fakeDirectoryStat(1n, 11n)],
    ]),
  };
  const removed = [];
  const copied = [];
  const descriptors = new Map();
  let nextFd = 100;
  function statForFile(target, buffer) {
    const existing = state.stats.get(target);
    if (existing) return fakeFileStat(existing.dev, existing.ino, BigInt(buffer.length), false, existing.mtimeMs);
    return fakeFileStat(1n, BigInt(200 + state.stats.size), BigInt(buffer.length));
  }
  const fsModule = {
    existsSync(target) { return target.endsWith('fake.exe'); },
    lstatSync(target) {
      const stat = state.stats.get(target);
      if (!stat) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return stat;
    },
    closeSync(fd) {
      const descriptor = descriptors.get(fd);
      if (!descriptor) throw new Error('bad fd');
      if (descriptor.flags === 'wx') {
        const body = Buffer.concat(descriptor.chunks);
        state.files.set(descriptor.path, body);
        state.stats.set(descriptor.path, statForFile(descriptor.path, body));
        state.realpath.set(descriptor.path, descriptor.path);
        const source = Array.from(state.files.entries())
          .find(([candidate, candidateBody]) => candidate !== descriptor.path && candidateBody.equals(body))?.[0]
          ?? descriptor.path;
        copied.push([source, descriptor.path]);
      }
      descriptors.delete(fd);
    },
    fstatSync(fd) {
      const descriptor = descriptors.get(fd);
      if (!descriptor) throw new Error('bad fd');
      if (descriptor.flags === 'wx') {
        const body = Buffer.concat(descriptor.chunks);
        return statForFile(descriptor.path, body);
      }
      return fsModule.lstatSync(descriptor.path);
    },
    fsyncSync(fd) {
      if (!descriptors.has(fd)) throw new Error('bad fd');
    },
    mkdtempSync(prefix) {
      assert.equal(prefix, path.join(tempRoot, PACKAGED_CANARY_USER_DATA_PREFIX));
      return userDataPath;
    },
    mkdirSync(target) {
      if (state.stats.has(target)) throw new Error('exists');
      state.stats.set(target, fakeDirectoryStat(1n, BigInt(20 + state.stats.size)));
      state.realpath.set(target, target);
      state.directories.set(target, []);
    },
    openSync(target, flags) {
      if (flags === 'r') {
        if (!state.stats.has(target) || !state.files.has(target)) throw new Error('missing file');
        const fd = nextFd;
        nextFd += 1;
        descriptors.set(fd, { flags, path: target, position: 0 });
        return fd;
      }
      if (flags === 'wx') {
        if (state.stats.has(target) || state.files.has(target)) throw new Error('exists');
        const fd = nextFd;
        nextFd += 1;
        descriptors.set(fd, { chunks: [], flags, path: target });
        return fd;
      }
      throw new Error('bad flags');
    },
    readSync(fd, buffer, offset, length, position) {
      const descriptor = descriptors.get(fd);
      if (!descriptor || descriptor.flags !== 'r') throw new Error('bad fd');
      const body = state.files.get(descriptor.path);
      const start = position === null ? descriptor.position : position;
      const slice = body.subarray(start, start + length);
      slice.copy(buffer, offset);
      if (position === null) descriptor.position += slice.length;
      return slice.length;
    },
    readdirSync(target) {
      const entries = state.directories.get(target);
      if (!entries) throw new Error('missing directory');
      return entries;
    },
    realpathSync: {
      native(target) {
        const real = state.realpath.get(target);
        if (!real) throw new Error('realpath failed');
        return real;
      },
    },
    rmSync(target) { removed.push(target); },
    writeSync(fd, buffer, offset, length) {
      const descriptor = descriptors.get(fd);
      if (!descriptor || descriptor.flags !== 'wx') throw new Error('bad fd');
      descriptor.chunks.push(Buffer.from(buffer.subarray(offset, offset + length)));
      return length;
    },
  };
  return {
    fsModule,
    osModule: { tmpdir: () => tempRoot },
    copied,
    removed,
    state,
    tempRoot,
    userDataPath,
  };
}

function savedProfileFixture() {
  const fixture = guardedFixture();
  const sourceRoot = path.join(process.cwd(), 'source-profile');
  const configDir = path.join(sourceRoot, 'builder-provider-config-v1');
  const secretsDir = path.join(sourceRoot, 'builder-provider-secrets-v1');
  const localState = path.join(sourceRoot, 'Local State');
  const current = path.join(configDir, 'current.json');
  const secretName = `${'a'.repeat(64)}.json`;
  const secret = path.join(secretsDir, secretName);
  fixture.state.realpath.set(sourceRoot, sourceRoot);
  fixture.state.realpath.set(configDir, configDir);
  fixture.state.realpath.set(secretsDir, secretsDir);
  fixture.state.realpath.set(localState, localState);
  fixture.state.realpath.set(current, current);
  fixture.state.realpath.set(secret, secret);
  fixture.state.stats.set(sourceRoot, fakeDirectoryStat(2n, 100n));
  fixture.state.stats.set(configDir, fakeDirectoryStat(2n, 101n));
  fixture.state.stats.set(secretsDir, fakeDirectoryStat(2n, 102n));
  fixture.state.stats.set(localState, fakeFileStat(2n, 103n, 512n));
  fixture.state.stats.set(current, fakeFileStat(2n, 104n, 256n));
  fixture.state.stats.set(secret, fakeFileStat(2n, 105n, 512n));
  fixture.state.files.set(localState, Buffer.alloc(512, 'l'));
  fixture.state.files.set(current, Buffer.alloc(256, 'c'));
  fixture.state.files.set(secret, Buffer.alloc(512, 's'));
  fixture.state.directories.set(configDir, [fakeDirent('current.json')]);
  fixture.state.directories.set(secretsDir, [fakeDirent(secretName)]);
  return {
    ...fixture,
    current,
    localState,
    secret,
    secretName,
    secretsDir,
    sourceRoot,
  };
}

function assertFixedCanaryError(error, code, stage) {
  assert.equal(error instanceof BuilderPackagedCanaryError, true);
  assert.equal(error.code, code);
  assert.equal(error.stage, stage);
  assert.equal(error.stack, `BuilderPackagedCanaryError: ${error.message}`);
  assert.equal(error.message.includes('secret-marker'), false);
  assert.equal(error.message.includes('provider.example'), false);
  assert.equal(error.message.includes('builder-model'), false);
  assert.equal(error.message.includes('real-key-value-secret'), false);
}

test('parses exact stdin input and rejects credential in argv or env', () => {
  const parsed = parseCanaryInput(input());
  assert.equal(parsed.schema_version, CANARY_INPUT_VERSION);
  assert.equal(Object.hasOwn(parsed, 'mode'), false);
  assert.equal(parsed.provider.credential, 'real-key-value-secret');
  assert.throws(
    () => parseCanaryInput(input({ executable_path: 'relative.exe' })),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.throws(
    () => ensureCredentialOnlyFromStdin(parsed.provider.credential, ['--key=real-key-value-secret'], {}),
    (error) => error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_secret_source_invalid',
  );
  assert.throws(
    () => ensureCredentialOnlyFromStdin(parsed.provider.credential, [], { TOKEN: 'real-key-value-secret' }),
    (error) => error.code === 'canary_secret_source_invalid',
  );
  assert.throws(
    () => parseCanaryInput(input({ extra: true })),
    (error) => error.code === 'canary_input_invalid',
  );
});

test('parses exact saved-profile input without accepting provider material', () => {
  const parsed = parseCanaryInput(savedProfileInput());
  assert.equal(parsed.mode, 'saved_profile');
  assert.equal(parsed.schema_version, CANARY_INPUT_VERSION);
  assert.equal(Object.hasOwn(parsed, 'provider'), false);
  assert.equal(path.isAbsolute(parsed.source_user_data_path), true);
  assert.throws(
    () => parseCanaryInput(savedProfileInput({ provider: { credential: 'secret' } })),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.throws(
    () => parseCanaryInput(savedProfileInput({ source_user_data_path: 'relative-profile' })),
    (error) => error.code === 'canary_input_invalid',
  );
  for (const blockedPath of [
    '\\\\server\\share\\profile',
    '\\\\?\\C:\\Users\\Example\\Profile',
    '\\\\.\\C:\\Users\\Example\\Profile',
  ]) {
    assert.throws(
      () => parseCanaryInput(savedProfileInput({ source_user_data_path: blockedPath })),
      (error) => error.code === 'canary_input_invalid',
    );
  }
  assert.throws(
    () => parseCanaryInput(input({ mode: 'first_config' })),
    (error) => error.code === 'canary_input_invalid',
  );
});

test('fills Settings UI and permits artifacts only after password field clears', async () => {
  const page = new FakePage();
  const gate = createArtifactGate();
  await assert.rejects(
    page.locator(SELECTORS.apiKey).screenshot(),
    /artifact before password cleared/u,
  );
  await fillProviderSettingsViaUi(page, parseCanaryInput(input()).provider, gate);
  page.artifactsAllowed = gate.allowed;
  assert.equal(gate.allowed, true);
  assert.equal(await page.locator(SELECTORS.apiKey).inputValue(), '');
  assert.deepEqual(page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]), [
    'Settings',
    'Save provider',
  ]);
  assert.equal(page.events.some((event) => event[0] === 'fill' && event[1] === SELECTORS.apiKey), true);
  assert.ok(await page.locator(SELECTORS.apiKey).screenshot());
});

test('observes custom chrome controls without clicking window actions', async () => {
  const page = new FakePage();
  const evidence = await assertCustomChromeControls(page);
  assert.deepEqual(evidence, {
    close_enabled: true,
    maximize_or_restore_enabled: true,
    minimize_enabled: true,
    window_controls_enabled: true,
  });
  assert.deepEqual(page.events.filter((event) => event[0] === 'roleWaitFor').map((event) => event[2]), [
    'Minimize window',
    /^(?:Maximize|Restore) window$/u,
    'Close window',
  ]);
  assert.deepEqual(page.events.filter((event) => event[0] === 'roleClick'), []);
  assert.deepEqual(page.events.filter((event) => event[0] === 'roleEnabled').map((event) => event[2]), [
    'Minimize window',
    /^(?:Maximize|Restore) window$/u,
    'Close window',
  ]);
  page.disabledRoles.add('button:Close window');
  await assert.rejects(
    assertCustomChromeControls(page),
    (error) => error.code === 'canary_custom_chrome_failed',
  );
});

test('observes an unsaved draft before saving Version 1 through the real UI', async (t) => {
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });

  const draftEvidence = await generateProjectViaUi(page, 'Make a focus timer.');
  assert.deepEqual(draftEvidence, {
    pre_save_catalog_empty: true,
    review_diff: reviewDiffEvidence(),
    saved_via_ui: true,
    unsaved_draft_observed: true,
  });
  const roleClicks = page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]);
  assert.deepEqual(roleClicks, ['New project', 'Make draft', 'Save version']);
  assert.equal(page.events.some((event) => event[0] === 'roleFirst'), false);

  const evidence = await readOnlyBridgeEvidence(page, 'builder-project:11111111-1111-4111-8111-111111111111');
  assert.equal(evidence.status.configured, true);
  assert.equal(evidence.bridge_contract.bridge_version, 'builder-preload.v5');
  const evaluateEvents = page.events.filter((event) => event[0] === 'evaluate');
  const source = evaluateEvents[0][1];
  assert.match(source, /providerSettings\.status/u);
  assert.match(source, /projectWorkspace\.listCurrent/u);
  assert.match(source, /projectWorkspace\.loadCurrent/u);
  assert.match(source, /taskStream\.read/u);
  assert.doesNotMatch(source, /replaceCurrent|codeGenerator\.(?:generate|retry|answer|rejectDraft)|projectWorkspace\.saveDraft|cancel/u);
  const unsavedWait = page.events.findIndex(
    (event) => event[0] === 'scopedText' && event[2] === 'Unsaved draft',
  );
  const preSaveRead = page.events.findIndex((event) => event[0] === 'evaluate');
  const saveClick = page.events.findIndex(
    (event) => event[0] === 'roleClick' && event[2] === 'Save version',
  );
  const versionWait = page.events.findIndex(
    (event) => event[0] === 'textContent' && event[1] === SELECTORS.currentVersion,
  );
  assert.ok(unsavedWait >= 0 && unsavedWait < preSaveRead);
  assert.ok(preSaveRead < saveClick);
  assert.ok(saveClick < versionWait);
});

test('observes draft review diff before Save without leaking internal evidence', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;

  const evidence = await inspectDraftReviewDiffViaUi(page);

  assert.deepEqual(evidence, reviewDiffEvidence());
  assert.equal(page.events.some((event) => (
    event[0] === 'click'
    && event[1] === SELECTORS.reviewOpenChanges
  )), true);
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'first').map((event) => event[1]),
    [SELECTORS.changeCard, SELECTORS.changeDiff, SELECTORS.changeDiffLine],
  );
  page.reviewTextOverride = 'Review before saving sha256:secret';
  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_failed',
  );
});

test('retries a failed draft through visible UI without saving or leaking write authority', async (t) => {
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });
  page.draftFailuresRemaining = 1;

  assert.deepEqual(
    await retryFailedDraftViaUi(
      page,
      'Make a focus timer.',
      'Change this text after the first failure.',
    ),
    {
      review_diff: reviewDiffEvidence(),
      retry_button_observed: true,
      retry_recovered_draft: true,
      save_remained_explicit: true,
    },
  );

  assert.equal(page.savedRevision, 0);
  assert.equal(page.candidateTurns, 1);
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['New project', 'Make draft', 'Retry'],
  );
  assert.equal(
    page.events.some((event) => event[0] === 'roleClick' && event[2] === 'Save version'),
    false,
  );
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'fill').map((event) => event[2]),
    ['Make a focus timer.', 'Change this text after the first failure.'],
  );
  const evaluateEvents = page.events.filter((event) => event[0] === 'evaluate');
  assert.equal(evaluateEvents.length, 1);
  assert.doesNotMatch(
    evaluateEvents[0][1],
    /codeGenerator\.(?:generate|retry|answer|rejectDraft)|projectWorkspace\.saveDraft|providerSettings\.replaceCurrent/u,
  );
});

test('captures saved activity without exposing internal evidence', async () => {
  const page = new FakePage();
  page.savedActivityRevision = 1;

  assert.deepEqual(await captureSavedActivityEvidence(page, 1), {
    internal_evidence_hidden: true,
    public_revision_number: 1,
    version_saved_visible: true,
  });

  const leaked = new FakePage();
  leaked.savedActivityRevision = 1;
  leaked.savedActivityTextOverride = 'Version saved This draft was saved as Version 1. sha256:secret';
  await assert.rejects(
    captureSavedActivityEvidence(leaked, 1),
    (error) => error.code === 'canary_save_activity_failed'
      && error.stage === 'save_activity',
  );
});

test('answers a saved-project question without creating a draft or revision', async (t) => {
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await generateProjectViaUi(page, 'Make a focus timer.');
  const firstRevision = bridgeEvidence(
    'builder-project:11111111-1111-4111-8111-111111111111',
    true,
    1,
    1,
    0,
  ).current.product_revision_receipt;
  const answer = await askProjectQuestionViaUi(page, firstRevision);
  const evidence = await readSanitizedBridgeEvidence(page, firstRevision.project_id);

  assert.equal(page.savedRevision, 1);
  assert.equal(page.candidateTurns, 1);
  assert.equal(page.questionTurns, 1);
  assert.deepEqual(answer, {
    saved_revision_unchanged: true,
    task_stream: {
      answer_count: 1,
      accepted_review_count: 1,
      candidate_ready_count: 1,
      candidate_reviewed_count: 1,
      candidate_result_count: 1,
      explanation_result_count: 1,
      head_sequence: 9,
      item_count: 9,
      latest_candidate_review: 'accepted',
      revision_unchanged: true,
      source_availability: 'not_loaded',
    },
    ui_answer_observed: true,
  });
  assert.deepEqual(
    assertTaskStreamExplanationFacts(evidence, firstRevision, 1, 1),
    answer.task_stream,
  );
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['New project', 'Make draft', 'Save version', 'Ask'],
  );
});

test('rejects explanations that are not bound to a taskless question turn', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const expectedRevision = bridgeEvidence(projectId, true, 1, 1, 1).current.product_revision_receipt;

  const workExplanation = bridgeEvidence(projectId, true, 1, 1, 1);
  workExplanation.task_stream.conversation.items[5].mode = 'work';
  workExplanation.task_stream.conversation.items[5].task = {
    task_id: expectedRevision.task_id,
    title: 'Not a question',
  };
  assert.throws(
    () => assertTaskStreamExplanationFacts(workExplanation, expectedRevision, 1, 1),
    (error) => error.code === 'canary_question_evidence_failed',
  );

  const taskedExplanation = bridgeEvidence(projectId, true, 1, 1, 1);
  taskedExplanation.task_stream.conversation.items[6].task_id = expectedRevision.task_id;
  assert.throws(
    () => assertTaskStreamExplanationFacts(taskedExplanation, expectedRevision, 1, 1),
    (error) => error.code === 'canary_question_evidence_failed',
  );
});

test('keeps an update candidate pending before the explicit Version 2 save', async (t) => {
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await generateProjectViaUi(page, 'Make a focus timer.');
  const firstRevision = bridgeEvidence(
    'builder-project:11111111-1111-4111-8111-111111111111',
    true,
    1,
  ).current.product_revision_receipt;
  const pending = await createUpdateDraftViaUi(page, firstRevision);
  const pendingEvidence = await readSanitizedBridgeEvidence(page, firstRevision.project_id);
  const pendingFacts = assertTaskStreamPendingCandidateFacts(pendingEvidence, firstRevision, 2);

  assert.deepEqual(pending, {
    previous_revision_verified_before_save: true,
    review_diff: reviewDiffEvidence(),
    unsaved_draft_observed: true,
  });
  assert.equal(page.savedRevision, 1);
  assert.equal(page.versionLabel, 'Version 1');
  assert.deepEqual(pendingFacts, {
    answer_count: 0,
    accepted_review_count: 1,
    candidate_ready_count: 2,
    candidate_reviewed_count: 1,
    candidate_result_count: 2,
    explanation_result_count: 0,
    head_sequence: 9,
    item_count: 9,
    latest_candidate_review: 'pending',
    latest_candidate_distinct_from_saved_revision: true,
    saved_revision_number: 1,
    source_availability: 'not_loaded',
  });
  assert.deepEqual(await saveUpdateDraftViaUi(page, firstRevision), {
    saved_via_ui: true,
  });
  assert.equal(page.savedRevision, 2);
  assert.equal(page.versionLabel, 'Version 2');
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['New project', 'Make draft', 'Save version', 'Make change', 'Save version'],
  );
});

test('verifies Version 1 before saving a second unsaved draft as Version 2', async (t) => {
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await generateProjectViaUi(page, 'Make a focus timer.');
  const firstRevision = bridgeEvidence(
    'builder-project:11111111-1111-4111-8111-111111111111',
    true,
    1,
  ).current.product_revision_receipt;
  const update = await updateProjectViaUi(page, firstRevision);

  assert.deepEqual(update, {
    previous_revision_verified_before_save: true,
    review_diff: reviewDiffEvidence(),
    saved_via_ui: true,
    unsaved_draft_observed: true,
  });
  assert.equal(page.savedRevision, 2);
  assert.equal(page.versionLabel, 'Version 2');
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['New project', 'Make draft', 'Save version', 'Make change', 'Save version'],
  );
});

test('inspects saved history without mutating the current revision or task stream', async (t) => {
  const page = new FakePage();
  const gate = createArtifactGate();
  installBridge(page);
  gate.allow();
  page.artifactsAllowed = true;
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await generateProjectViaUi(page, 'Make a focus timer.');
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const initialRevision = bridgeEvidence(projectId, true, 1, 1, 0).current.product_revision_receipt;
  const initialPreview = await capturePreviewEvidence(page, gate);
  await askProjectQuestionViaUi(page, initialRevision, CANARY_QUESTION, 1, 1);
  await createUpdateDraftViaUi(page, initialRevision, undefined, 1);
  await saveUpdateDraftViaUi(page, initialRevision);
  const updatedEvidence = await readSanitizedBridgeEvidence(page, projectId);
  const updatedRevision = bridgeEvidence(projectId, true, 2, 2, 1).current.product_revision_receipt;
  const updatedTaskStream = assertTaskStreamCandidateFacts(updatedEvidence, updatedRevision, 2, 1);
  const updatedPreview = await capturePreviewEvidence(page, gate);

  const history = await inspectHistoryVersionViaUi(
    page,
    initialRevision,
    updatedRevision,
    initialPreview,
    updatedPreview,
    updatedTaskStream,
    gate,
  );

  assert.deepEqual(history, {
    current_preview_restored: true,
    current_revision_unchanged: true,
    historical_preview_matches_saved_version: true,
    returned_to_current: true,
    task_stream_unchanged: true,
    viewed_revision_number: 1,
  });
  assert.equal(page.historyViewingRevision, null);
  assert.equal(page.versionLabel, 'Version 2');
  assert.equal(page.events.some((event) => (
    event[0] === 'click'
    && event[1] === '[data-builder-view-version="Version 1"]'
  )), true);
  assert.equal(page.events.some((event) => (
    event[0] === 'roleClick'
    && event[2] === 'Back to current'
  )), true);
});

test('reports fixed redacted UI stages without raw provider, prompt, or DOM details', async () => {
  const provider = parseCanaryInput(input()).provider;
  const stages = [
    {
      code: 'canary_settings_navigation_failed',
      run: async () => {
        const page = new FakePage();
        page.failRoleClicks.add('button:Settings');
        await fillProviderSettingsViaUi(page, provider, createArtifactGate());
      },
      stage: 'settings_navigation',
    },
    {
      code: 'canary_settings_panel_failed',
      run: async () => {
        const page = new FakePage();
        page.failWaitFor.add(SELECTORS.providerPanel);
        await fillProviderSettingsViaUi(page, provider, createArtifactGate());
      },
      stage: 'settings_panel',
    },
    {
      code: 'canary_settings_save_failed',
      run: async () => {
        const page = new FakePage();
        page.keepPasswordValue = true;
        await fillProviderSettingsViaUi(page, provider, createArtifactGate());
      },
      stage: 'settings_save',
    },
    {
      code: 'canary_new_project_failed',
      run: async () => {
        const page = new FakePage();
        page.failWaitFor.add(SELECTORS.projectPage);
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'new_project',
    },
    {
      code: 'canary_generation_terminal_failed',
      run: async () => {
        const page = new FakePage();
        page.alertVisible = true;
        page.previewVisible = false;
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'generation_terminal',
    },
    {
      code: 'canary_preview_failed',
      run: async () => {
        const page = new FakePage();
        page.failAlertWait = true;
        page.failWaitFor.add(SELECTORS.preview);
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'preview',
    },
    {
      code: 'canary_draft_failed',
      run: async () => {
        const page = new FakePage();
        page.failTextWaitFor.add('Unsaved draft');
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'draft',
    },
    {
      code: 'canary_draft_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.draftSaved = true;
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'draft',
    },
    {
      code: 'canary_retry_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.draftFailuresRemaining = 1;
        page.failRoleClicks.add('button:Retry');
        await retryFailedDraftViaUi(page, 'Make a focus timer.');
      },
      stage: 'retry',
    },
    {
      code: 'canary_retry_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.draftFailuresRemaining = 1;
        page.failAlertWait = true;
        page.failWaitFor.add(SELECTORS.preview);
        await retryFailedDraftViaUi(page, 'Make a focus timer.');
      },
      stage: 'retry',
    },
    {
      code: 'canary_save_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.failRoleClicks.add('button:Save version');
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'save',
    },
    {
      code: 'canary_save_persistence_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.persistSave = false;
        page.failWaitFor.add(SELECTORS.unsavedDraft);
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'save_persistence',
    },
    {
      code: 'canary_save_confirmation_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.failWaitFor.add(SELECTORS.unsavedDraft);
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'save_confirmation',
    },
    {
      code: 'canary_version_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.forcedVersionLabel = 'Version 2';
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'version',
    },
    {
      code: 'canary_save_activity_failed',
      run: async () => {
        const page = new FakePage();
        page.savedActivityRevision = 1;
        page.savedActivityTextOverride = 'Version saved This draft was saved as Version 1. review_id sha256:secret';
        await captureSavedActivityEvidence(page, 1);
      },
      stage: 'save_activity',
    },
    {
      code: 'canary_review_diff_failed',
      run: async () => {
        const page = new FakePage();
        page.unsavedDraftVisible = true;
        page.failWaitFor.add(SELECTORS.changeDiffLine);
        await inspectDraftReviewDiffViaUi(page);
      },
      stage: 'review_diff',
    },
    {
      code: 'canary_question_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.failRoleClicks.add('button:Ask');
        const first = bridgeEvidence(
          'builder-project:11111111-1111-4111-8111-111111111111',
          true,
          1,
        ).current.product_revision_receipt;
        await askProjectQuestionViaUi(page, first);
      },
      stage: 'question',
    },
    {
      code: 'canary_question_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.failWaitFor.add(SELECTORS.questionAnswer);
        const first = bridgeEvidence(
          'builder-project:11111111-1111-4111-8111-111111111111',
          true,
          1,
        ).current.product_revision_receipt;
        await askProjectQuestionViaUi(page, first);
      },
      stage: 'question',
    },
    {
      code: 'canary_question_evidence_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.draftSaved = true;
        page.savedRevision = 1;
        page.candidateTurns = 1;
        const first = bridgeEvidence(
          'builder-project:11111111-1111-4111-8111-111111111111',
          true,
          1,
        ).current.product_revision_receipt;
        await askProjectQuestionViaUi(page, first, CANARY_QUESTION, 1, 2);
      },
      stage: 'question_evidence',
    },
    {
      code: 'canary_update_generation_terminal_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.draftSaved = true;
        page.savedRevision = 1;
        page.alertVisible = true;
        page.previewVisible = false;
        const first = bridgeEvidence(
          'builder-project:11111111-1111-4111-8111-111111111111',
          true,
          1,
        ).current.product_revision_receipt;
        await updateProjectViaUi(page, first);
      },
      stage: 'update_generation_terminal',
    },
    {
      code: 'canary_update_draft_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.draftSaved = true;
        page.savedRevision = 1;
        page.failTextWaitFor.add('Unsaved draft');
        const first = bridgeEvidence(
          'builder-project:11111111-1111-4111-8111-111111111111',
          true,
          1,
        ).current.product_revision_receipt;
        await updateProjectViaUi(page, first);
      },
      stage: 'update_draft',
    },
    {
      code: 'canary_update_save_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.draftSaved = true;
        page.savedRevision = 1;
        page.failRoleClicks.add('button:Save version');
        const first = bridgeEvidence(
          'builder-project:11111111-1111-4111-8111-111111111111',
          true,
          1,
        ).current.product_revision_receipt;
        await updateProjectViaUi(page, first);
      },
      stage: 'update_save',
    },
    {
      code: 'canary_update_save_confirmation_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.draftSaved = true;
        page.savedRevision = 1;
        page.failWaitFor.add(SELECTORS.unsavedDraft);
        const first = bridgeEvidence(
          'builder-project:11111111-1111-4111-8111-111111111111',
          true,
          1,
        ).current.product_revision_receipt;
        await updateProjectViaUi(page, first);
      },
      stage: 'update_save_confirmation',
    },
    {
      code: 'canary_preview_failed',
      run: async () => {
        const page = new FakePage();
        page.failPreviewAttributes = true;
        const gate = createArtifactGate();
        gate.allow();
        await capturePreviewEvidence(page, gate);
      },
      stage: 'preview',
    },
    {
      code: 'canary_read_evidence_failed',
      run: async () => {
        const page = new FakePage();
        page.evaluate = async () => { throw new Error('secret-marker'); };
        await readSanitizedBridgeEvidence(page);
      },
      stage: 'read_evidence',
    },
    {
      code: 'canary_restart_open_failed',
      run: async () => {
        const page = new FakePage();
        page.failWaitFor.add(SELECTORS.projectCatalog);
        await openProjectFromCatalogById(page, {
          commit_oid: 'a'.repeat(40),
          project_id: 'builder-project:11111111-1111-4111-8111-111111111111',
          revision_number: 1,
          revision_receipt_digest: `sha256:${'a'.repeat(64)}`,
          summary: 'A timer.',
          title: 'Focus timer',
          tree_oid: 'b'.repeat(40),
        }, 'canary_restart_open_failed');
      },
      stage: 'restart_open',
    },
  ];

  for (const item of stages) {
    try {
      await assert.rejects(item.run(), (error) => {
        assertFixedCanaryError(error, item.code, item.stage);
        return true;
      });
    } finally {
      delete globalThis.clawfabricBuilder;
    }
  }
});

test('sanitizes read evidence before dereferencing renderer-returned shapes', () => {
  let getterCalls = 0;
  const accessor = bridgeEvidence('builder-project:11111111-1111-4111-8111-111111111111');
  Object.defineProperty(accessor.status, 'configured', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('secret-marker');
    },
  });
  assert.throws(
    () => assertReadEvidence(accessor),
    (error) => error.code === 'canary_evidence_failed'
      && !error.message.includes('secret-marker'),
  );
  assert.equal(getterCalls, 0);

  const extra = bridgeEvidence('builder-project:11111111-1111-4111-8111-111111111111');
  extra.catalog.projects[0].extra = true;
  assert.throws(
    () => assertReadEvidence(extra),
    (error) => error.code === 'canary_evidence_failed',
  );

  const symbol = bridgeEvidence('builder-project:11111111-1111-4111-8111-111111111111');
  symbol.catalog.projects[Symbol('secret')] = {};
  assert.throws(
    () => assertReadEvidence(symbol),
    (error) => error.code === 'canary_evidence_failed',
  );

  let trapCalls = 0;
  const proxy = new Proxy(bridgeEvidence('builder-project:11111111-1111-4111-8111-111111111111'), {
    getOwnPropertyDescriptor() {
      trapCalls += 1;
      throw new Error('secret-marker');
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error('secret-marker');
    },
  });
  assert.throws(
    () => assertReadEvidence(proxy),
    (error) => error.code === 'canary_evidence_failed'
      && !error.message.includes('secret-marker'),
  );
  assert.equal(trapCalls, 0);

  const staleTaskStream = bridgeEvidence('builder-project:11111111-1111-4111-8111-111111111111');
  staleTaskStream.task_stream.project_id = 'builder-project:22222222-2222-4222-8222-222222222222';
  assert.throws(
    () => assertReadEvidence(staleTaskStream),
    (error) => error.code === 'canary_evidence_failed',
  );
});

test('rejects legacy JSON authority and Git or SQLite evidence drift', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';

  const legacyCatalog = bridgeEvidence(projectId);
  legacyCatalog.catalog.result_version = 'builder-project-catalog-result.v1';
  assert.throws(
    () => assertReadEvidence(legacyCatalog),
    (error) => error.code === 'canary_evidence_failed',
  );

  const legacyCurrent = bridgeEvidence(projectId);
  legacyCurrent.current.result_version = 'builder-project-repository-result.v1';
  assert.throws(
    () => assertReadEvidence(legacyCurrent),
    (error) => error.code === 'canary_evidence_failed',
  );

  const commitDrift = bridgeEvidence(projectId);
  commitDrift.current.current.commit_oid = 'c'.repeat(40);
  assert.throws(
    () => assertReadEvidence(commitDrift),
    (error) => error.code === 'canary_evidence_failed',
  );

  const treeDrift = bridgeEvidence(projectId);
  treeDrift.current.git_verification_receipt.candidate_tree_oid = 'c'.repeat(40);
  assert.throws(
    () => assertReadEvidence(treeDrift),
    (error) => error.code === 'canary_evidence_failed',
  );

  const receiptDrift = bridgeEvidence(projectId);
  receiptDrift.catalog.projects[0].revision_receipt_digest = `sha256:${'f'.repeat(64)}`;
  const sanitized = assertReadEvidence(receiptDrift);
  assert.throws(
    () => assertExactRevision(sanitized, sanitized.catalog.projects[0]),
    (error) => error.code === 'canary_evidence_failed',
  );

  const sourceDrift = bridgeEvidence(projectId);
  sourceDrift.current.source_tree.files[0].content = 'changed';
  assert.throws(
    () => assertReadEvidence(sourceDrift),
    (error) => error.code === 'canary_evidence_failed',
  );

  const oldNamespace = bridgeEvidence(projectId);
  oldNamespace.bridge_contract.legacy_namespaces_absent = false;
  assert.throws(
    () => assertReadEvidence(oldNamespace),
    (error) => error.code === 'canary_evidence_failed',
  );

  const missingPlanReview = bridgeEvidence(projectId);
  missingPlanReview.bridge_contract.plan_review_namespace = 'unavailable';
  assert.throws(
    () => assertReadEvidence(missingPlanReview),
    (error) => error.code === 'canary_evidence_failed',
  );
});

test('rejects every forged Version 2 parent-chain facet', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const first = revisionEvidence(projectId, 1).receipt;
  const second = revisionEvidence(projectId, 2).receipt;
  const forgeries = [
    { ...second, revision_number: 3 },
    { ...second, project_id: 'builder-project:22222222-2222-4222-8222-222222222222' },
    { ...second, parent_oid: 'f'.repeat(40) },
    { ...second, previous_revision_receipt_digest: `sha256:${'f'.repeat(64)}` },
    { ...second, commit_oid: first.commit_oid },
    { ...second, tree_oid: first.tree_oid },
    { ...second, revision_receipt_digest: first.revision_receipt_digest },
  ];

  for (const forged of forgeries) {
    assert.throws(
      () => assertRevisionAdvance(first, forged),
      (error) => error.code === 'canary_evidence_failed',
    );
  }
});

test('summarizes nonblank preview pixels and tracks unexpected renderer network', () => {
  const summary = summarizePng(pngFixture());
  assert.equal(summary.width, 5);
  assert.equal(summary.height, 5);
  assert.match(summary.pixel_digest, /^sha256:[0-9a-f]{64}$/u);
  const page = new FakePage();
  const recorder = networkRecorder();
  const app = {
    context() {
      return {
        on(event, listener) {
          page.on(event, listener);
        },
      };
    },
  };
  assert.equal(recorder.attachApplication(app), true);
  page.emitRequest('file:///app/index.html');
  page.emitRequest('https://provider.example/v1/chat/completions');
  page.emitRequest('https://unexpected.example/script.js');
  assert.deepEqual(recorder.snapshot(), {
    renderer_context_observer_count: 1,
    renderer_unexpected_network_count: 2,
  });
  const fallback = networkRecorder();
  fallback.attachPage(page);
  page.emitRequest('wss://unexpected.example/socket');
  assert.deepEqual(fallback.snapshot(), {
    renderer_context_observer_count: 0,
    renderer_unexpected_network_count: 1,
  });
});

test('selects the preview tab before capturing isolated preview evidence', async () => {
  const page = new FakePage();
  const gate = createArtifactGate();
  gate.allow();
  page.artifactsAllowed = true;

  const evidence = await capturePreviewEvidence(page, gate);

  assert.equal(evidence.sandbox, 'empty');
  assert.equal(evidence.script_src, 'none');
  assert.equal(evidence.frame_body_nonempty, true);
  const previewTabClick = page.events.findIndex((event) => (
    event[0] === 'click' && event[1] === SELECTORS.previewTab
  ));
  const previewWait = page.events.findIndex((event) => (
    event[0] === 'waitFor' && event[1] === SELECTORS.preview
  ));
  assert.equal(previewTabClick >= 0, true);
  assert.equal(previewWait > previewTabClick, true);
});

test('sanitizes launch environment and canary root identity without following drift', () => {
  const { fsModule, osModule, userDataPath, tempRoot, state } = guardedFixture();
  let getterCalls = 0;
  const env = {
    PATH: 'C:\\Windows\\System32',
    JWT_SECRET: 'jwt-secret',
    SystemRoot: 'C:\\Windows',
  };
  Object.defineProperty(env, 'LOCALAPPDATA', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'C:\\Users\\Example\\AppData\\Local';
    },
  });
  env[Symbol('SECRET')] = 'symbol-secret';

  const launchEnv = sanitizeLaunchEnvironment(env, userDataPath);
  assert.deepEqual(Object.keys(launchEnv).sort(), [
    'BUILDER_PACKAGED_CANARY',
    'BUILDER_PACKAGED_CANARY_USER_DATA_PATH',
    'PATH',
    'SystemRoot',
  ]);
  assert.equal(getterCalls, 0);
  assert.equal(Object.hasOwn(launchEnv, 'JWT_SECRET'), false);

  const identity = captureGuardedUserDataRoot(userDataPath, fsModule, osModule);
  assert.equal(identity.path, userDataPath);
  assert.throws(
    () => captureGuardedUserDataRoot(path.join(tempRoot, 'nested', `${PACKAGED_CANARY_USER_DATA_PREFIX}unit`), fsModule, osModule),
    (error) => error.code === 'canary_cleanup_failed',
  );
  assert.throws(
    () => captureGuardedUserDataRoot(path.join(tempRoot, 'wrong-prefix'), fsModule, osModule),
    (error) => error.code === 'canary_cleanup_failed',
  );
  state.stats.set(userDataPath, fakeDirectoryStat(1n, 11n, true));
  assert.throws(
    () => captureGuardedUserDataRoot(userDataPath, fsModule, osModule),
    (error) => error.code === 'canary_cleanup_failed',
  );
});

test('uses playwright-core injection, canary env, cleanup, and redacted output', async (t) => {
  const parsed = parseCanaryInput(input({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const page = new FakePage();
  const electron = fakeElectron(page);
  const { fsModule, osModule, removed, userDataPath } = guardedFixture();
  t.after(() => {
    delete globalThis.clawfabricBuilder;
  });

  const result = await runPackagedCanary(parsed, {
    argv: [],
    electron,
    env: {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      JWT_SECRET: 'do-not-inherit',
      PATH: 'C:\\Windows\\System32',
      PROVIDER_API_KEY: 'unrelated-provider-secret',
      SystemRoot: 'C:\\Windows',
    },
    fs: fsModule,
    os: osModule,
    userDataPath,
  });

  assert.equal(result.result_version, CANARY_RESULT_VERSION);
  assert.equal(result.safe_storage.credential_status, 'stored');
  assert.deepEqual(result.activity, {
    initial_save: {
      internal_evidence_hidden: true,
      public_revision_number: 1,
      version_saved_visible: true,
    },
    update_save: {
      internal_evidence_hidden: true,
      public_revision_number: 2,
      version_saved_visible: true,
    },
  });
  assert.deepEqual(result.draft, {
    initial: {
      pre_save_catalog_empty: true,
      review_diff: reviewDiffEvidence(),
      saved_via_ui: true,
      unsaved_draft_observed: true,
    },
    restart_continuation: {
      previous_revision_verified_before_save: true,
      review_diff: reviewDiffEvidence(),
      unsaved_draft_observed: true,
    },
    pending_update_restart: {
      review_diff: reviewDiffEvidence(),
      save_remained_explicit: true,
      saved_revision_visible: true,
      unsaved_draft_restored: true,
    },
    update: {
      previous_revision_verified_before_save: true,
      review_diff: reviewDiffEvidence(),
      saved_via_ui: true,
      unsaved_draft_observed: true,
    },
  });
  assert.equal(result.project.initial_revision_number, 1);
  assert.equal(result.project.revision_number, 2);
  assert.equal(result.project.parent_oid, result.project.initial_commit_oid);
  assert.equal(
    result.project.previous_revision_receipt_digest,
    result.project.initial_revision_receipt_digest,
  );
  assert.notEqual(result.project.commit_oid, result.project.initial_commit_oid);
  assert.notEqual(result.project.tree_oid, result.project.initial_tree_oid);
  assert.match(result.project.revision_receipt_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(result.project.commit_oid, /^[0-9a-f]{40}$/u);
  assert.match(result.project.tree_oid, /^[0-9a-f]{40}$/u);
  assert.equal(result.project.restart_revision_unchanged, true);
  assert.equal(result.project.restart_new_revision_observed, true);
  assert.equal(result.project.pending_update_revision_unchanged, true);
  assert.equal(result.project.pending_update_restart_revision_unchanged, true);
  assert.equal(result.project.restart_continuation_revision_unchanged, true);
  assert.deepEqual(result.history, {
    current_preview_restored: true,
    current_revision_unchanged: true,
    historical_preview_matches_saved_version: true,
    returned_to_current: true,
    task_stream_unchanged: true,
    viewed_revision_number: 1,
  });
  assert.equal(result.preview.restart_srcdoc_unchanged, true);
  assert.equal(result.preview.pending_update_restart_srcdoc_unchanged, true);
  assert.equal(result.preview.restart_continuation_changed_srcdoc, true);
  assert.equal(result.preview.update_changed_srcdoc, true);
  assert.equal(result.preview.initial.sandbox, 'empty');
  assert.equal(result.preview.initial.script_src, 'none');
  assert.equal(result.preview.pending_update.sandbox, 'empty');
  assert.equal(result.preview.pending_update.script_src, 'none');
  assert.equal(result.preview.pending_update_restart.sandbox, 'empty');
  assert.equal(result.preview.pending_update_restart.script_src, 'none');
  assert.equal(result.preview.updated.sandbox, 'empty');
  assert.equal(result.preview.updated.script_src, 'none');
  assert.equal(result.preview.restart_continuation.sandbox, 'empty');
  assert.equal(result.preview.restart_continuation.script_src, 'none');
  assert.deepEqual(result.question, {
    after_initial_save: {
      saved_revision_unchanged: true,
      task_stream: {
        answer_count: 1,
        accepted_review_count: 1,
        candidate_ready_count: 1,
        candidate_reviewed_count: 1,
        candidate_result_count: 1,
        explanation_result_count: 1,
        head_sequence: 9,
        item_count: 9,
        latest_candidate_review: 'accepted',
        revision_unchanged: true,
        source_availability: 'not_loaded',
      },
      ui_answer_observed: true,
    },
  });
  assert.deepEqual(result.task_stream, {
    initial: {
      answer_count: 0,
      accepted_review_count: 1,
      candidate_ready_count: 1,
      candidate_reviewed_count: 1,
      candidate_result_count: 1,
      explanation_result_count: 0,
      head_sequence: 5,
      item_count: 5,
      latest_candidate_bound_to_revision: true,
      latest_candidate_review: 'accepted',
      latest_saved_revision_number: 1,
      source_availability: 'not_loaded',
    },
    question: {
      answer_count: 1,
      accepted_review_count: 1,
      candidate_ready_count: 1,
      candidate_reviewed_count: 1,
      candidate_result_count: 1,
      explanation_result_count: 1,
      head_sequence: 9,
      item_count: 9,
      latest_candidate_review: 'accepted',
      revision_unchanged: true,
      source_availability: 'not_loaded',
    },
    pending_update: {
      answer_count: 1,
      accepted_review_count: 1,
      candidate_ready_count: 2,
      candidate_reviewed_count: 1,
      candidate_result_count: 2,
      explanation_result_count: 1,
      head_sequence: 13,
      item_count: 13,
      latest_candidate_review: 'pending',
      latest_candidate_distinct_from_saved_revision: true,
      saved_revision_number: 1,
      source_availability: 'not_loaded',
    },
    pending_update_restart: {
      answer_count: 1,
      accepted_review_count: 1,
      candidate_ready_count: 2,
      candidate_reviewed_count: 1,
      candidate_result_count: 2,
      explanation_result_count: 1,
      head_sequence: 13,
      item_count: 13,
      latest_candidate_review: 'pending',
      latest_candidate_distinct_from_saved_revision: true,
      saved_revision_number: 1,
      source_availability: 'not_loaded',
    },
    updated: {
      answer_count: 1,
      accepted_review_count: 2,
      candidate_ready_count: 2,
      candidate_reviewed_count: 2,
      candidate_result_count: 2,
      explanation_result_count: 1,
      head_sequence: 14,
      item_count: 14,
      latest_candidate_bound_to_revision: true,
      latest_candidate_review: 'accepted',
      latest_saved_revision_number: 2,
      source_availability: 'not_loaded',
    },
    restart: {
      answer_count: 1,
      accepted_review_count: 2,
      candidate_ready_count: 2,
      candidate_reviewed_count: 2,
      candidate_result_count: 2,
      explanation_result_count: 1,
      head_sequence: 14,
      item_count: 14,
      latest_candidate_bound_to_revision: true,
      latest_candidate_review: 'accepted',
      latest_saved_revision_number: 2,
      source_availability: 'not_loaded',
    },
    restart_continuation: {
      answer_count: 1,
      accepted_review_count: 2,
      candidate_ready_count: 3,
      candidate_reviewed_count: 2,
      candidate_result_count: 3,
      explanation_result_count: 1,
      head_sequence: 18,
      item_count: 18,
      latest_candidate_review: 'pending',
      latest_candidate_distinct_from_saved_revision: true,
      saved_revision_number: 2,
      source_availability: 'not_loaded',
    },
    pending_update_advanced_candidate_count: true,
    question_did_not_advance_candidate_count: true,
    pending_update_restart_unchanged: true,
    restart_continuation_advanced_candidate_count: true,
    restart_unchanged: true,
    update_advanced_candidate_count: true,
  });
  assert.equal(JSON.stringify(result).includes(parsed.provider.credential), false);
  assert.equal(JSON.stringify(result).includes(parsed.provider.model), false);
  assert.equal(JSON.stringify(result).includes(parsed.provider.base_url), false);
  assert.equal(JSON.stringify(result).includes(parsed.executable_path), false);
  assert.equal(JSON.stringify(result).includes(CANARY_QUESTION), false);
  const resultPacket = JSON.stringify(result);
  for (const forbidden of [
    '"head_digest"',
    '"record_kind":"builder_project_head"',
    '"record_kind":"builder_project_revision"',
    '"revision_digest"',
    '"builder-project-catalog-result.v1"',
    '"builder-project-repository-result.v1"',
  ]) {
    assert.equal(resultPacket.includes(forbidden), false);
  }
  assert.deepEqual(Object.keys(result.input).sort(), [
    'credential_source',
    'idea_digest',
    'question_digest',
    'restart_continuation_instruction_digest',
    'schema_version',
    'update_instruction_digest',
  ]);
  assert.equal(electron.launches.length, 3);
  assert.deepEqual(electron.appEvents, [
    ['context'],
    ['contextOn', 'request'],
    ['firstWindow'],
    ['context'],
    ['contextOn', 'request'],
    ['firstWindow'],
    ['context'],
    ['contextOn', 'request'],
    ['firstWindow'],
  ]);
  for (const launch of electron.launches) {
    assert.equal(launch.env.BUILDER_PACKAGED_CANARY, '1');
    assert.equal(launch.env.BUILDER_PACKAGED_CANARY_USER_DATA_PATH, userDataPath);
    assert.equal(Object.hasOwn(launch.env, 'JWT_SECRET'), false);
    assert.equal(Object.hasOwn(launch.env, 'PROVIDER_API_KEY'), false);
    assert.equal(Object.hasOwn(launch.env, 'PATH'), true);
  }
  const allPageEvents = electron.pages.flatMap((candidate) => candidate.events);
  const scopedLocators = allPageEvents.filter((event) => event[0] === 'scopedLocator');
  assert.equal(scopedLocators.length, 2);
  assert.equal(scopedLocators[0][1], SELECTORS.projectCatalog);
  assert.equal(
    scopedLocators[0][2],
    'button[data-builder-project-id="builder-project:11111111-1111-4111-8111-111111111111"]',
  );
  assert.equal(scopedLocators[1][1], SELECTORS.projectCatalog);
  assert.equal(
    scopedLocators[1][2],
    'button[data-builder-project-id="builder-project:11111111-1111-4111-8111-111111111111"]',
  );
  const scopedTexts = allPageEvents.filter((event) => event[0] === 'scopedText');
  assert.deepEqual(scopedTexts.map((event) => [event[2], event[3]]), [
    ['Unsaved draft', { exact: true }],
    ['Review before saving', { exact: true }],
    ['This draft was saved as Version 1.', { exact: true }],
    ['Unsaved draft', { exact: true }],
    ['Review before saving', { exact: true }],
    ['Focus timer', { exact: true }],
    ['A timer.', { exact: true }],
    ['Version 1', { exact: true }],
    ['Unsaved draft', { exact: true }],
    ['Review before saving', { exact: true }],
    ['This draft was saved as Version 2.', { exact: true }],
    ['Focus timer', { exact: true }],
    ['A timer.', { exact: true }],
    ['Version 2', { exact: true }],
    ['Version 1', { exact: true }],
    ['Viewing Version 1', { exact: true }],
    ['Unsaved draft', { exact: true }],
    ['Review before saving', { exact: true }],
  ]);
  assert.deepEqual(removed, [userDataPath]);
});

test('copies only saved provider profile files and runs without provider input or settings writes', async (t) => {
  const parsed = parseCanaryInput(savedProfileInput({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const page = new FakePage();
  const electron = fakeElectron(page);
  const {
    copied,
    current,
    fsModule,
    localState,
    osModule,
    removed,
    secret,
    secretName,
    userDataPath,
  } = savedProfileFixture();
  fsModule.copyFileSync = () => {
    throw new Error('copyFileSync must not be used');
  };
  t.after(() => {
    delete globalThis.clawfabricBuilder;
  });

  const result = await runPackagedCanary(parsed, {
    argv: [],
    electron,
    env: {
      JWT_SECRET: 'do-not-inherit',
      PATH: 'C:\\Windows\\System32',
      PROVIDER_API_KEY: 'unrelated-provider-secret',
      SystemRoot: 'C:\\Windows',
    },
    fs: fsModule,
    os: osModule,
    userDataPath,
  });

  assert.equal(result.result_version, CANARY_RESULT_VERSION);
  assert.deepEqual(result.input, {
    credential_source: 'saved_profile',
    idea_digest: result.input.idea_digest,
    question_digest: result.input.question_digest,
    restart_continuation_instruction_digest: result.input.restart_continuation_instruction_digest,
    schema_version: CANARY_INPUT_VERSION,
    update_instruction_digest: result.input.update_instruction_digest,
  });
  assert.equal(result.user_data.temporary, true);
  assert.equal(result.user_data.source_profile_unchanged, true);
  assert.equal(result.custom_chrome.window_controls_enabled, true);
  assert.equal(result.safe_storage.configured, true);
  assert.equal(result.safe_storage.credential_status, 'stored');
  assert.equal(result.activity.initial_save.version_saved_visible, true);
  assert.equal(result.activity.initial_save.public_revision_number, 1);
  assert.equal(result.activity.initial_save.internal_evidence_hidden, true);
  assert.equal(result.activity.update_save.version_saved_visible, true);
  assert.equal(result.activity.update_save.public_revision_number, 2);
  assert.equal(result.activity.update_save.internal_evidence_hidden, true);
  assert.deepEqual(result.draft.initial.review_diff, reviewDiffEvidence());
  assert.deepEqual(result.draft.update.review_diff, reviewDiffEvidence());
  assert.deepEqual(result.draft.pending_update_restart.review_diff, reviewDiffEvidence());
  assert.deepEqual(result.draft.restart_continuation.review_diff, reviewDiffEvidence());
  assert.equal(result.project.revision_number, 2);
  assert.equal(result.project.parent_oid, result.project.initial_commit_oid);
  assert.equal(result.project.restart_revision_unchanged, true);
  assert.equal(result.project.restart_new_revision_observed, true);
  assert.equal(result.project.pending_update_restart_revision_unchanged, true);
  assert.equal(result.project.restart_continuation_revision_unchanged, true);
  assert.equal(result.draft.pending_update_restart.unsaved_draft_restored, true);
  assert.equal(result.draft.restart_continuation.unsaved_draft_observed, true);
  assert.equal(result.history.current_revision_unchanged, true);
  assert.equal(result.history.returned_to_current, true);
  assert.equal(result.preview.restart_srcdoc_unchanged, true);
  assert.equal(result.preview.pending_update_restart_srcdoc_unchanged, true);
  assert.equal(result.preview.restart_continuation_changed_srcdoc, true);
  assert.equal(result.preview.update_changed_srcdoc, true);
  assert.equal(result.question.after_initial_save.saved_revision_unchanged, true);
  assert.equal(result.question.after_initial_save.ui_answer_observed, true);
  assert.equal(result.task_stream.question_did_not_advance_candidate_count, true);
  assert.equal(result.task_stream.pending_update_restart_unchanged, true);
  assert.equal(result.task_stream.updated.candidate_ready_count, 2);
  assert.equal(result.task_stream.updated.answer_count, 1);
  assert.equal(result.task_stream.restart_continuation.candidate_ready_count, 3);
  assert.equal(result.task_stream.restart_continuation.accepted_review_count, 2);
  assert.equal(result.task_stream.restart_continuation_advanced_candidate_count, true);
  assert.equal(result.task_stream.restart_unchanged, true);
  assert.deepEqual(copied.map(([source, target]) => [
    path.relative(parsed.source_user_data_path, source),
    path.relative(userDataPath, target),
  ]), [
    ['Local State', 'Local State'],
    ['Local State', path.join('session-data', 'Local State')],
    [path.join('builder-provider-config-v1', 'current.json'), path.join('builder-provider-config-v1', 'current.json')],
    [path.join('builder-provider-secrets-v1', secretName), path.join('builder-provider-secrets-v1', secretName)],
  ]);
  assert.deepEqual(copied.map(([source]) => source), [localState, localState, current, secret]);
  const roleClicks = electron.pages
    .flatMap((candidate) => candidate.events)
    .filter((event) => event[0] === 'roleClick')
    .map((event) => event[2]);
  assert.deepEqual(roleClicks, [
    'New project',
    'Make draft',
    'Save version',
    'Ask',
    'Make change',
    'Save version',
    'Back to current',
    'Make change',
  ]);
  assert.equal(roleClicks.includes('Settings'), false);
  assert.equal(roleClicks.includes('Save provider'), false);
  assert.equal(page.events.some((event) => event[0] === 'fill' && event[1] === SELECTORS.apiKey), false);
  assert.equal(electron.launches.length, 3);
  assert.deepEqual(electron.appEvents, [
    ['context'],
    ['contextOn', 'request'],
    ['firstWindow'],
    ['context'],
    ['contextOn', 'request'],
    ['firstWindow'],
    ['context'],
    ['contextOn', 'request'],
    ['firstWindow'],
  ]);
  assert.deepEqual(removed, [userDataPath]);
  const packet = JSON.stringify(result);
  for (const forbidden of [
    parsed.source_user_data_path,
    userDataPath,
    'provider.example',
    'builder-model',
    'real-key-value-secret',
    'Local State',
    'builder-provider-config-v1',
    'builder-provider-secrets-v1',
    secretName,
  ]) {
    assert.equal(packet.includes(forbidden), false, forbidden);
  }
});

test('copies saved provider files through the guarded canonical target path', () => {
  const parsed = parseCanaryInput(savedProfileInput({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const fixture = savedProfileFixture();
  const canonicalTempRoot = `${fixture.tempRoot}-canonical`;
  const canonicalUserDataPath = path.join(canonicalTempRoot, path.basename(fixture.userDataPath));
  fixture.state.realpath.set(fixture.tempRoot, canonicalTempRoot);
  fixture.state.realpath.set(fixture.userDataPath, canonicalUserDataPath);
  fixture.state.realpath.set(canonicalUserDataPath, canonicalUserDataPath);
  fixture.state.stats.set(canonicalUserDataPath, fixture.state.stats.get(fixture.userDataPath));

  const guardedRoot = captureGuardedUserDataRoot(fixture.userDataPath, fixture.fsModule, fixture.osModule);
  const savedProfile = copySavedProviderProfile(parsed, guardedRoot, fixture.fsModule);

  assert.equal(savedProfile.sourceRoot.path, parsed.source_user_data_path);
  assert.deepEqual(fixture.copied.map(([, target]) => path.relative(canonicalUserDataPath, target)), [
    'Local State',
    path.join('session-data', 'Local State'),
    path.join('builder-provider-config-v1', 'current.json'),
    path.join('builder-provider-secrets-v1', fixture.secretName),
  ]);
});

test('rejects saved profile target directory replacement before descriptor writes', async (t) => {
  const parsed = parseCanaryInput(savedProfileInput({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const cases = [
    {
      name: 'target root identity drift',
      pathFor(fixture) { return fixture.userDataPath; },
      driftAt: 3,
      drift(stat) {
        return fakeDirectoryStat(stat.dev, 999n);
      },
      forbiddenTargets(fixture) {
        return [
          path.join(fixture.userDataPath, 'Local State'),
          path.join(fixture.userDataPath, 'builder-provider-config-v1', 'current.json'),
          path.join(fixture.userDataPath, 'builder-provider-secrets-v1', fixture.secretName),
        ];
      },
    },
    {
      name: 'target config symlink',
      pathFor(fixture) {
        return path.join(fixture.userDataPath, 'builder-provider-config-v1');
      },
      driftAt: 2,
      drift(stat) {
        return fakeDirectoryStat(stat.dev, stat.ino, true);
      },
      forbiddenTargets(fixture) {
        return [
          path.join(fixture.userDataPath, 'builder-provider-config-v1', 'current.json'),
          path.join(fixture.userDataPath, 'builder-provider-secrets-v1', fixture.secretName),
        ];
      },
    },
    {
      name: 'target session data symlink',
      pathFor(fixture) {
        return path.join(fixture.userDataPath, 'session-data');
      },
      driftAt: 2,
      drift(stat) {
        return fakeDirectoryStat(stat.dev, stat.ino, true);
      },
      forbiddenTargets(fixture) {
        return [path.join(fixture.userDataPath, 'session-data', 'Local State')];
      },
    },
    {
      name: 'target secrets realpath drift',
      pathFor(fixture) {
        return path.join(fixture.userDataPath, 'builder-provider-secrets-v1');
      },
      driftAt: 2,
      drift(stat, fixture, target) {
        fixture.state.realpath.set(target, path.join(fixture.tempRoot, 'replacement'));
        return stat;
      },
      forbiddenTargets(fixture) {
        return [path.join(fixture.userDataPath, 'builder-provider-secrets-v1', fixture.secretName)];
      },
    },
  ];

  for (const item of cases) {
    const page = new FakePage();
    const electron = fakeElectron(page);
    const fixture = savedProfileFixture();
    const target = item.pathFor(fixture);
    const originalLstat = fixture.fsModule.lstatSync;
    let seen = 0;
    fixture.fsModule.lstatSync = (candidate) => {
      const stat = originalLstat(candidate);
      if (candidate === target) {
        seen += 1;
        if (seen === item.driftAt) return item.drift(stat, fixture, target);
      }
      return stat;
    };
    t.after(() => {
      delete globalThis.clawfabricBuilder;
    });

    await assert.rejects(
      runPackagedCanary(parsed, {
        argv: [],
        electron,
        env: {},
        fs: fixture.fsModule,
        os: fixture.osModule,
        userDataPath: fixture.userDataPath,
      }),
      (error) => error instanceof BuilderPackagedCanaryError
        && error.code === 'canary_saved_profile_failed'
        && error.stage === 'saved_profile'
        && !error.message.includes(item.name),
    );
    assert.equal(electron.launches.length, 0);
    for (const forbiddenTarget of item.forbiddenTargets(fixture)) {
      assert.equal(fixture.state.files.has(forbiddenTarget), false, forbiddenTarget);
    }
    assert.deepEqual(fixture.removed, [fixture.userDataPath]);
  }
});

test('rechecks saved profile target directory immediately before exclusive file create', async (t) => {
  const parsed = parseCanaryInput(savedProfileInput({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const page = new FakePage();
  const electron = fakeElectron(page);
  const fixture = savedProfileFixture();
  const targetConfigDirectory = path.join(fixture.userDataPath, 'builder-provider-config-v1');
  const targetCurrent = path.join(targetConfigDirectory, 'current.json');
  const originalOpen = fixture.fsModule.openSync;
  fixture.fsModule.openSync = (target, flags) => {
    const fd = originalOpen(target, flags);
    if (target === fixture.current && flags === 'r') {
      fixture.state.stats.set(targetConfigDirectory, fakeDirectoryStat(1n, 999n, true));
    }
    return fd;
  };
  t.after(() => {
    delete globalThis.clawfabricBuilder;
  });

  await assert.rejects(
    runPackagedCanary(parsed, {
      argv: [],
      electron,
      env: {},
      fs: fixture.fsModule,
      os: fixture.osModule,
      userDataPath: fixture.userDataPath,
    }),
    (error) => error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_saved_profile_failed'
      && error.stage === 'saved_profile',
  );
  assert.equal(electron.launches.length, 0);
  assert.equal(fixture.state.files.has(targetCurrent), false);
  assert.deepEqual(fixture.removed, [fixture.userDataPath]);
});

test('opens restart project only for canonical project id selectors and visible catalog facts', async () => {
  const page = new FakePage();
  await openProjectFromCatalogById(page, {
    commit_oid: 'a'.repeat(40),
    project_id: 'builder-project:11111111-1111-4111-8111-111111111111',
    revision_number: 1,
    revision_receipt_digest: `sha256:${'a'.repeat(64)}`,
    summary: 'A timer.',
    title: 'Focus timer',
    tree_oid: 'b'.repeat(40),
  });

  const scopedLocators = page.events.filter((event) => event[0] === 'scopedLocator');
  assert.equal(scopedLocators.length, 1);
  assert.equal(
    scopedLocators[0][2],
    'button[data-builder-project-id="builder-project:11111111-1111-4111-8111-111111111111"]',
  );
  const scopedTexts = page.events.filter((event) => event[0] === 'scopedText');
  assert.deepEqual(scopedTexts.map((event) => [event[2], event[3]]), [
    ['Focus timer', { exact: true }],
    ['A timer.', { exact: true }],
    ['Version 1', { exact: true }],
  ]);
  assert.deepEqual(page.events.filter((event) => event[0] === 'click').map((event) => event[1]), [
    `${SELECTORS.projectCatalog} button[data-builder-project-id="builder-project:11111111-1111-4111-8111-111111111111"]`,
  ]);

  const forged = bridgeEvidence('builder-project:11111111-1111-4111-8111-111111111111');
  forged.catalog.projects[0].project_id = 'builder-project:quote"slash\\line\nid';
  assert.throws(
    () => assertReadEvidence(forged),
    (error) => error.code === 'canary_evidence_failed',
  );
});

test('rejects malformed saved profile file sets before launch and still cleans temp profile', async (t) => {
  const cases = [
    {
      name: 'missing Local State',
      mutate(fixture) {
        fixture.state.stats.delete(fixture.localState);
      },
    },
    {
      name: 'extra config file',
      mutate(fixture) {
        const configDir = path.join(fixture.sourceRoot, 'builder-provider-config-v1');
        fixture.state.directories.set(configDir, [fakeDirent('current.json'), fakeDirent('extra.json')]);
      },
    },
    {
      name: 'non-json secret',
      mutate(fixture) {
        fixture.state.directories.set(fixture.secretsDir, [fakeDirent('not-json.txt')]);
      },
    },
    {
      name: 'secret bound exceeded',
      mutate(fixture) {
        fixture.state.stats.set(fixture.secret, fakeFileStat(2n, 105n, 65n * 1024n));
      },
    },
    {
      name: 'source symlink',
      mutate(fixture) {
        fixture.state.stats.set(fixture.sourceRoot, fakeDirectoryStat(2n, 100n, true));
      },
    },
  ];
  for (const item of cases) {
    const parsed = parseCanaryInput(savedProfileInput({ executable_path: path.join(process.cwd(), 'fake.exe') }));
    const page = new FakePage();
    const electron = fakeElectron(page);
    const fixture = savedProfileFixture();
    item.mutate(fixture);
    t.after(() => {
      delete globalThis.clawfabricBuilder;
    });
    await assert.rejects(
      runPackagedCanary(parsed, {
        argv: [],
        electron,
        env: {},
        fs: fixture.fsModule,
        os: fixture.osModule,
        userDataPath: fixture.userDataPath,
      }),
      (error) => error instanceof BuilderPackagedCanaryError
        && error.code === 'canary_saved_profile_failed'
        && error.stage === 'saved_profile'
        && !error.message.includes(item.name),
    );
    assert.equal(electron.launches.length, 0);
    assert.deepEqual(fixture.removed, [fixture.userDataPath]);
  }
});

test('detects saved profile mutation without leaking source details and still removes temp profile', async (t) => {
  const parsed = parseCanaryInput(savedProfileInput({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const cases = [
    {
      name: 'size change',
      mutate(fixture) {
        fixture.state.stats.set(fixture.current, fakeFileStat(2n, 104n, 257n));
        fixture.state.files.set(fixture.current, Buffer.alloc(257, 'c'));
      },
    },
    {
      name: 'same-size content change',
      mutate(fixture) {
        fixture.state.files.set(fixture.current, Buffer.alloc(256, 'x'));
      },
    },
    {
      name: 'directory identity change',
      mutate(fixture) {
        fixture.state.stats.set(fixture.secretsDir, fakeDirectoryStat(2n, 999n));
      },
    },
  ];
  for (const item of cases) {
    const page = new FakePage();
    const electron = fakeElectron(page);
    const fixture = savedProfileFixture();
    const originalLaunch = electron.launch;
    electron.launch = async function launch(options) {
      const app = await originalLaunch.call(this, options);
      return {
        context: app.context,
        async close() {
          item.mutate(fixture);
          await app.close();
        },
        emitRequest: app.emitRequest,
        firstWindow: app.firstWindow,
      };
    };
    t.after(() => {
      delete globalThis.clawfabricBuilder;
    });

    await assert.rejects(
      runPackagedCanary(parsed, {
        argv: [],
        electron,
        env: {},
        fs: fixture.fsModule,
        os: fixture.osModule,
        userDataPath: fixture.userDataPath,
      }),
      (error) => error instanceof BuilderPackagedCanaryError
        && error.code === 'canary_saved_profile_failed'
        && error.stack === 'BuilderPackagedCanaryError: Packaged canary saved profile setup failed.'
        && !error.message.includes(fixture.sourceRoot)
        && !error.message.includes(item.name),
    );
    assert.deepEqual(fixture.removed, [fixture.userDataPath]);
  }
});

test('normalizes setup failures before launch without leaking raw markers or proxy traps', async () => {
  const parsed = parseCanaryInput(input({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  let trapCalls = 0;
  const rawInput = new Proxy(parsed, {
    getOwnPropertyDescriptor() {
      trapCalls += 1;
      throw new Error('secret-marker');
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error('secret-marker');
    },
  });
  await assert.rejects(
    runPackagedCanary(rawInput, {}),
    (error) => error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_input_invalid'
      && error.stack === 'BuilderPackagedCanaryError: Packaged canary input is invalid.'
      && !error.message.includes('secret-marker'),
  );
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  const options = {};
  Object.defineProperty(options, 'fs', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('secret-marker');
    },
  });
  await assert.rejects(
    runPackagedCanary(parsed, options),
    (error) => error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_launch_failed'
      && error.stack === 'BuilderPackagedCanaryError: Packaged canary could not launch.'
      && !error.message.includes('secret-marker'),
  );
  assert.equal(getterCalls, 0);
});

test('normalizes injected fs setup failures while preserving guarded cleanup', async (t) => {
  const parsed = parseCanaryInput(input({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const page = new FakePage();
  const electron = fakeElectron(page);
  const { fsModule, osModule, removed, userDataPath } = guardedFixture();
  fsModule.existsSync = () => { throw new Error('secret-marker'); };
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await assert.rejects(
    runPackagedCanary(parsed, {
      argv: [],
      electron,
      env: {},
      fs: fsModule,
      os: osModule,
      userDataPath,
    }),
    (error) => error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_launch_failed'
      && error.stack === 'BuilderPackagedCanaryError: Packaged canary could not launch.'
      && !error.message.includes('secret-marker'),
  );
  assert.equal(electron.launches.length, 0);
  assert.deepEqual(removed, [userDataPath]);
});

test('cleans direct mkdtemp path when guarded root capture fails before identity exists', async () => {
  const parsed = parseCanaryInput(input({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const { fsModule, osModule, removed, userDataPath } = guardedFixture();
  let realpathCalls = 0;
  fsModule.realpathSync.native = (target) => {
    realpathCalls += 1;
    if (target === userDataPath) throw new Error('secret-marker');
    return target;
  };

  await assert.rejects(
    runPackagedCanary(parsed, {
      argv: [],
      electron: fakeElectron(new FakePage()),
      env: {},
      fs: fsModule,
      os: osModule,
    }),
    (error) => error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_cleanup_failed'
      && !error.message.includes('secret-marker'),
  );
  assert.equal(realpathCalls >= 1, true);
  assert.deepEqual(removed, [userDataPath]);
});

test('cleanup attempts guarded remove when app close fails', async (t) => {
  const parsed = parseCanaryInput(input({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const page = new FakePage();
  const { fsModule, osModule, removed, userDataPath } = guardedFixture();
  const electron = {
    launches: [],
    async launch(options) {
      this.launches.push(options);
      return {
        async close() { throw new Error('close failed'); },
        async firstWindow() {
          page.evaluate = async (callback, argument) => bridgeEvidence(
            argument.projectId,
            page.draftSaved,
            Math.max(1, page.savedRevision),
            Math.max(1, page.savedRevision, page.candidateTurns),
            page.questionTurns,
          );
          page.artifactsAllowed = true;
          return page;
        },
      };
    },
  };
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await assert.rejects(
    runPackagedCanary(parsed, {
      argv: [],
      electron,
      env: {},
      fs: fsModule,
      os: osModule,
      userDataPath,
    }),
    (error) => error.code === 'canary_cleanup_failed',
  );
  assert.deepEqual(removed, [userDataPath]);
});

test('cleanup refuses user data replacement before recursive remove', async (t) => {
  const parsed = parseCanaryInput(input({ executable_path: path.join(process.cwd(), 'fake.exe') }));
  const page = new FakePage();
  const { fsModule, osModule, removed, state, userDataPath } = guardedFixture();
  let closeCount = 0;
  const electron = {
    launches: [],
    async launch(options) {
      this.launches.push(options);
      return {
        async close() {
          closeCount += 1;
          if (closeCount === 2) state.stats.set(userDataPath, fakeDirectoryStat(1n, 12n));
        },
        async firstWindow() {
          page.evaluate = async (callback, argument) => bridgeEvidence(
            argument.projectId,
            page.draftSaved,
            Math.max(1, page.savedRevision),
            Math.max(1, page.savedRevision, page.candidateTurns),
            page.questionTurns,
          );
          page.artifactsAllowed = true;
          return page;
        },
      };
    },
  };
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await assert.rejects(
    runPackagedCanary(parsed, {
      argv: [],
      electron,
      env: {},
      fs: fsModule,
      os: osModule,
      userDataPath,
    }),
    (error) => error.code === 'canary_cleanup_failed',
  );
  assert.deepEqual(removed, []);
});

test('bounds stdin and requires explicit CLI execute before launch', async () => {
  const overflowing = new PassThrough();
  const overflow = readStdin(overflowing, 4);
  overflowing.end('12345');
  await assert.rejects(
    overflow,
    (error) => error.code === 'canary_input_invalid',
  );

  let launches = 0;
  const stdout = { write() {} };
  await assert.rejects(
    runCli({
      argv: [],
      run() {
        launches += 1;
        return Promise.resolve({});
      },
      stdin: new PassThrough(),
      stdout,
    }),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.equal(launches, 0);
});

test('script source keeps credential out of argv/env/output and cannot enter ASAR authority', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const preloadSource = fs.readFileSync(PRELOAD_SOURCE_PATH, 'utf8');
  assert.match(source, /require\(['"]playwright-core['"]\)/u);
  assert.doesNotMatch(source, /require\(['"]playwright['"]\)/u);
  assert.doesNotMatch(source, /permissions\.evaluate|providerSettings\.replaceCurrent|codeGenerator\.(?:generate|retry|answer|rejectDraft)|projectWorkspace\.saveDraft/u);
  assert.doesNotMatch(source, /bridge\.projectCatalog|bridge\.projectRevisions/u);
  assert.doesNotMatch(source, /builder-project-catalog-result\.v1|builder-project-repository-result\.v1/u);
  assert.match(source, /clickByRole\(page,\s*['"]button['"],\s*['"]Save provider['"]\)/u);
  assert.match(source, /clickByRole\(page,\s*['"]button['"],\s*['"]Make draft['"]\)/u);
  assert.match(source, /clickByRole\(page,\s*['"]button['"],\s*['"]Ask['"]\)/u);
  assert.match(source, /clickByRole\(page,\s*['"]button['"],\s*['"]Save version['"]\)/u);
  assert.match(source, /clickByRole\(page,\s*['"]button['"],\s*['"]Back to current['"]\)/u);
  assert.match(source, /getByRole\(role,\s*\{\s*exact:\s*true,\s*name\s*\}\)/u);
  assert.match(source, /versionSavedActivity\)\.filter\(\{\s*hasText:\s*expectedBody\s*\}\)/u);
  assert.match(source, /builder-packaged-canary-result\.v8/u);
  assert.match(source, /inspectDraftReviewDiffViaUi/u);
  assert.match(source, /data-builder-change-diff-line-kind/u);
  assert.match(source, /canary_review_diff_failed/u);
  assert.match(source, /restart_continuation_instruction_digest/u);
  assert.match(source, /restart_continuation_advanced_candidate_count/u);
  assert.match(source, /historical_preview_matches_saved_version/u);
  assert.match(source, /artifacts_after_password_clear/u);
  assert.match(preloadSource, /bridgeVersion:\s*['"]builder-preload\.v5['"]/u);
  assert.match(preloadSource, /projectWorkspace:\s*Object\.freeze/u);
  assert.match(preloadSource, /planReview:\s*Object\.freeze/u);
  assert.match(source, /plan_review_namespace/u);
  assert.match(source, /review_method_only/u);
  assert.doesNotMatch(preloadSource, /projectRevisions|projectCatalog/u);
});
