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
  CANARY_INITIAL_CHAT_QUESTION,
  CANARY_INPUT_VERSION,
  CANARY_QUESTION,
  CANARY_RESULT_VERSION,
  PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY,
  PACKAGED_CANARY_PROJECT_ROOT_PATH,
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  assertCustomChromeControls,
  assertExactRevision,
  assertRevisionAdvance,
  assertReadEvidence,
  assertTaskStreamCandidateFacts,
  assertTaskStreamExplanationFacts,
  assertTaskStreamPendingCandidateFacts,
  assertTaskStreamPlanFacts,
  approveCurrentProjectWriteIfRequested,
  approvePlanSourceReadIfRequested,
  approvePlanViaUi,
  askInitialChatQuestionViaUi,
  askProjectQuestionViaUi,
  askRejectedPlanContextualSubmitViaUi,
  captureSavedActivityEvidence,
  capturePreviewEvidence,
  captureGuardedUserDataRoot,
  copySavedProviderProfile,
  createCanaryProjectRoot,
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
  proposePlanViaUi,
  readStdin,
  readOnlyBridgeEvidence,
  readSanitizedBridgeEvidence,
  retryFailedDraftViaUi,
  rejectPlanViaUi,
  runCli,
  runPackagedCanary,
  sanitizeLaunchEnvironment,
  saveUpdateDraftViaUi,
  summarizePng,
  updateProjectViaUi,
} = require('../scripts/verify-packaged-canary.cjs');
const {
  createLocalCanaryProviderServer,
} = require('../scripts/verify-packaged-canary-default.cjs');

const SOURCE_PATH = path.join(__dirname, '..', 'scripts', 'verify-packaged-canary.cjs');
const DEFAULT_SOURCE_PATH = path.join(__dirname, '..', 'scripts', 'verify-packaged-canary-default.cjs');
const PLAN_MODE_SOURCE_PATH = path.join(__dirname, '..', 'scripts', 'verify-packaged-plan-mode-canary.cjs');
const PRELOAD_SOURCE_PATH = path.join(__dirname, '..', 'electron', 'preload.cjs');

const FAKE_CANARY_BRIEF_CORRECTION_PATTERNS = Object.freeze([
  /^(?:等一下|等等|先等等|先别|先不要|不要|别).{0,64}(?:按|照|做|写|执行|实现|开始|这个|刚才|方案|计划|方向|目标|需求).*/u,
  /(?:撤回|推翻|作废|不要了|不算了|先不做|先别做|先不要做|别按|不要按|别照|不要照|重新整理|重新确认|换个方向|改方向)/u,
  /^(?:wait|hold on|actually|scratch that|not that|pause|do not|don'?t).{0,96}(?:brief|plan|direction|approach|that|it|execute|implement|build)/u,
]);
const FAKE_CANARY_WORK_DISCUSSION_PATTERNS = Object.freeze([
  /(?:先聊|先讨论|先确定|讨论一下|聊一下|确认一下|想先聊|我们先确定|先看看|你觉得|你建议|怎么样|如何设计|怎么设计|怎么做|方案如何|风格怎么|需求怎么)/u,
  /\b(?:discuss|brainstorm|figure out|talk through|what do you think|how should|how would|should we|could we|can we|requirements|style direction)\b/u,
]);
const FAKE_CANARY_PLAN_PATTERNS = Object.freeze([
  /^(?:(?:帮我|请|麻烦)\s*)?(?:先)?(?:规划|计划|制定(?:一下)?方案|出(?:个|一个|下|一下)?方案|做(?:个|一个|下|一下)?方案|给(?:我|我们)?(?:出|做|写|列)?(?:个|一个)?方案|列(?:一下|下)?(?:步骤|计划|方案)|先不要写代码.{0,16}(?:方案|步骤|计划))/u,
  /^(?:(?:先)?(?:帮我|请|麻烦)\s*)?(?:先)?(?:梳理|整理|拆解|分析)(?:一下|下)?(?:(?:这个|当前|整体|实现|开发|页面|项目)){0,3}(?:方案|计划|步骤|思路|路径|实现路径)/u,
  /^(?:plan first|plan this first|make a plan|propose a plan|draft a plan|give me a plan|outline the steps|don'?t write code yet|let'?s plan|let us plan)\b/u,
]);
const FAKE_CANARY_CONTEXTUAL_BUILD_PATTERNS = Object.freeze([
  /^(?:就这样(?:写|做|改|实现|执行|开始)?|就按(?:这个(?:方案|计划)?|刚才(?:的)?(?:方案|计划)?|上面(?:的)?(?:方案|计划)?|前面(?:的)?(?:方案|计划)?)(?:写|做|改|实现|执行)?|按(?:这个(?:方案|计划)?|刚才(?:的)?(?:方案|计划)?|上面(?:的)?(?:方案|计划)?|前面(?:的)?(?:方案|计划)?)(?:写|做|改|实现|执行)|开始(?:写|做|改|实现|执行)|可以开始了)[。.!！]*$/u,
  /^(?:(?:好|好的|可以|行|嗯)[，,\s]*)?(?:(?:就)?(?:照|按)(?:这个|刚才(?:说的|聊的|讨论的|确认的)?|上面(?:说的)?|前面(?:说的)?|我们刚才(?:说的|聊的|讨论的|确认的)?)(?:方案|计划)?(?:写|做|改|实现|执行|来)|(?:开始|执行)(?:吧|了)?|可以开始(?:了|吧)?)[。.!！]*$/u,
]);

function normalizeFakeCanaryInstruction(instruction) {
  return instruction
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ');
}

function routeFakeCanarySendInstruction(instruction) {
  const normalized = normalizeFakeCanaryInstruction(instruction);
  if (normalized.length === 0) return 'question';
  if (FAKE_CANARY_BRIEF_CORRECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'brief_correction';
  }
  if (FAKE_CANARY_PLAN_PATTERNS.some((pattern) => pattern.test(normalized))) return 'plan';
  if (FAKE_CANARY_WORK_DISCUSSION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'question';
  }
  if (FAKE_CANARY_CONTEXTUAL_BUILD_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'contextual_build';
  }
  if (/[?\uFF1F]\s*$/u.test(normalized)) return 'question';
  return 'build';
}

function submitFakeCanaryInstruction(page) {
  const instruction = page.values.get(SELECTORS.idea) ?? '';
  const route = routeFakeCanarySendInstruction(instruction);
  if (page.planModeActive === true) {
    page.planModeActive = false;
    if (page.requirePlanSourceReadApproval === true) page.planSourceReadApprovalVisible = true;
    else page.recordPlanAttempt();
  } else if (route === 'question' || route === 'brief_correction') {
    page.recordQuestion();
  } else if (
    route === 'contextual_build'
    && (
      page.briefCorrectionActive === true
      || page.rejectedPlanReviews > 0
    )
  ) {
    page.recordQuestion();
  } else if (route === 'plan') {
    page.recordPlanAttempt();
  } else if (
    !page.workspaceBound
    && (
      page.forceWorkspaceGateForNextBuild
      || (!page.draftSaved && page.savedRevision <= 0)
    )
  ) {
    page.workspacePickerVisible = true;
    page.pendingWorkspaceGateInstruction = instruction;
  } else if (
    page.requireCurrentProjectWriteApproval === true
    && page.currentProjectWriteApproved !== true
  ) {
    page.currentProjectWriteApprovalVisible = true;
    page.pendingCurrentProjectWriteInstruction = instruction;
  } else {
    page.recordCandidateAttempt(Math.max(page.savedRevision + 1, 1));
  }
}

function reviewDiffEvidence() {
  return {
    activity_review_do_not_overlap: true,
    artifact_preview_default_visible: true,
    artifact_resize_handle_visible: true,
    artifact_sidebar_visible: true,
    chat_summary_compact_visible: true,
    changes_diff_nested_in_panel: true,
    changes_panel_in_artifact_sidebar: true,
    changes_panel_visible: true,
    completion_landing_review_and_artifact_preview_visible: true,
    inline_diff_visible: true,
    internal_evidence_hidden: true,
    review_actions_layout_stable: true,
    review_changes_do_not_overlap: true,
    review_checkpoint_visible: true,
    review_internal_layout_stable: true,
  };
}

function workspaceGateEvidence() {
  return {
    build_without_workspace_blocked: true,
    build_continued_after_workspace_bound: true,
    composer_text_preserved_until_workspace_bound: true,
    source_folder_required: true,
    workspace_picker_visible: true,
  };
}

function liveOutputEvidence() {
  return {
    internal_evidence_hidden: true,
    live_output_visible: true,
    user_facing_work_status_visible: true,
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
    if (this.selector === SELECTORS.submitTurn) {
      submitFakeCanaryInstruction(this.page);
    }
    if (this.selector === SELECTORS.runCheck) {
      if (this.page.checkRunAvailable !== true) throw new Error('project check unavailable');
      this.page.checkRunStatus = 'passed';
    }
    if (this.selector === SELECTORS.skipCheck) {
      if (!this.page.unsavedDraftVisible || this.page.checkRunStatus !== 'not_run') {
        throw new Error('skip check unavailable');
      }
      this.page.checkRunStatus = 'skipped';
    }
    if (this.selector === SELECTORS.workspaceChip) {
      this.page.workspacePickerVisible = true;
      this.page.newProjectPanelVisible = false;
    }
    if (this.selector === SELECTORS.workspaceNewProject) {
      this.page.workspacePickerVisible = true;
      this.page.newProjectPanelVisible = true;
    }
    if (this.selector === SELECTORS.composerAddMenuButton) {
      this.page.composerAddMenuVisible = true;
    }
    if (this.selector === SELECTORS.composerAddPlanMode) {
      if (this.page.composerAddMenuVisible !== true) throw new Error('composer add menu unavailable');
      this.page.planModeActive = true;
      this.page.composerAddMenuVisible = false;
    }
    if (this.selector === SELECTORS.addSourceFolder) {
      this.page.workspaceBound = true;
      this.page.forceWorkspaceGateForNextBuild = false;
      this.page.workspacePickerVisible = false;
      this.page.newProjectPanelVisible = false;
      if (this.page.pendingWorkspaceGateInstruction !== null) {
        if (
          this.page.requireCurrentProjectWriteApproval === true
          && this.page.currentProjectWriteApproved !== true
        ) {
          this.page.currentProjectWriteApprovalVisible = true;
          this.page.pendingCurrentProjectWriteInstruction = this.page.pendingWorkspaceGateInstruction;
        } else {
          this.page.recordCandidateAttempt(Math.max(this.page.savedRevision + 1, 1));
          this.page.values.set(SELECTORS.idea, '');
        }
        this.page.pendingWorkspaceGateInstruction = null;
      }
    }
    if (this.selector === SELECTORS.approveCurrentProjectWrite) {
      if (this.page.currentProjectWriteApprovalVisible !== true) {
        throw new Error('current project write approval unavailable');
      }
      this.page.currentProjectWriteApproved = true;
      this.page.currentProjectWriteApprovalVisible = false;
      this.page.recordCandidateAttempt(
        this.page.pendingCurrentProjectWriteCandidateTurns ?? Math.max(this.page.savedRevision + 1, 1),
      );
      this.page.values.set(SELECTORS.idea, '');
      this.page.pendingCurrentProjectWriteInstruction = null;
      this.page.pendingCurrentProjectWriteCandidateTurns = null;
    }
    if (this.selector === SELECTORS.approvePlanSourceRead) {
      if (this.page.planSourceReadApprovalVisible !== true) throw new Error('plan source read approval unavailable');
      this.page.planSourceReadApprovalVisible = false;
      this.page.requirePlanSourceReadApproval = false;
      this.page.recordPlanAttempt();
    }
    if (this.selector === SELECTORS.reviewOpenChanges) {
      this.page.changesPanelVisible = true;
      this.page.changesDisclosureOpen = true;
    }
    if (
      this.selector === SELECTORS.artifactTabPreview
      || this.selector === SELECTORS.previewOpenArtifact
      || this.selector === SELECTORS.workspaceControlPreview
    ) {
      this.page.previewVisible = true;
      this.page.versionHistoryVisible = false;
      this.page.workspaceMenuVisible = false;
    }
    if (
      this.selector === SELECTORS.artifactTabVersions
      || this.selector === SELECTORS.workspaceControlVersions
    ) {
      this.page.versionHistoryVisible = true;
      this.page.previewVisible = false;
      this.page.workspaceMenuVisible = false;
    }
    if (this.selector === SELECTORS.workspaceMenuButton) {
      this.page.workspaceMenuVisible = true;
    }
    if (this.selector === SELECTORS.changesSummaryToggle) {
      this.page.changesDisclosureOpen = false;
    }
    if (this.selector === SELECTORS.saveVersion && this.page.persistSave) {
      const revision = await this.page.commitSave();
      this.page.draftSaved = revision > 0;
      this.page.savedRevision = revision;
      this.page.savedActivityRevision = revision;
      this.page.versionLabel = `Version ${revision}`;
    }
    const historyMatch = /\[data-builder-view-version="Version ([1-9][0-9]*)"\]/u.exec(this.selector);
    if (historyMatch !== null) {
      this.page.historyViewingRevision = Number(historyMatch[1]);
      this.page.versionLabel = `Version ${this.page.savedRevision}`;
    }
  }

  async evaluate(fn) {
    this.page.events.push(['locatorEvaluate', this.selector, String(fn)]);
    const node = {
      open: this.selector === SELECTORS.changesDisclosure
        ? this.page.changesDisclosureOpen
        : undefined,
      scrollIntoView: (options) => {
        this.page.events.push(['scrollIntoView', this.selector, options]);
      },
    };
    return fn(node);
  }

  async fill(value) {
    this.page.events.push(['fill', this.selector, value]);
    if (this.page.failFills.has(this.selector)) throw new Error('secret-marker');
    this.page.values.set(this.selector, value);
  }

  async press(key) {
    this.page.events.push(['press', this.selector, key]);
    if (this.selector === SELECTORS.idea && key === 'Enter') {
      submitFakeCanaryInstruction(this.page);
    }
  }

  contentFrame() {
    this.page.events.push(['contentFrame', this.selector]);
    return {
      locator: (selector) => ({
        innerText: async () => {
          this.page.events.push(['frameInnerText', selector]);
          if (this.page.previewFrameBodyFailuresRemaining > 0) {
            this.page.previewFrameBodyFailuresRemaining -= 1;
            throw new Error('preview frame body not ready');
          }
          return this.page.previewFrameBodyTextOverride ?? 'Focus timer preview';
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

  last() {
    this.page.events.push(['last', this.selector]);
    return new FakeLocator(this.page, this.selector, this.filterText);
  }

  async inputValue() {
    if (this.page.keepPasswordValue && this.selector === SELECTORS.apiKey) return 'secret-marker';
    return this.page.values.get(this.selector) ?? '';
  }

  async isVisible() {
    this.page.events.push(['isVisible', this.selector]);
    if (this.selector === SELECTORS.questionAnswerFailedNotice) {
      return this.page.questionAnswerFailedNoticeVisible;
    }
    if (this.selector === SELECTORS.composerStatus) {
      return this.page.composerStatusText() !== null;
    }
    if (this.selector === SELECTORS.workspacePicker) return this.page.workspacePickerVisible;
    if (this.selector === SELECTORS.newProjectPanel) return this.page.newProjectPanelVisible;
    if (this.selector === SELECTORS.runCheck) return this.page.checkRunAvailable;
    if (this.selector === SELECTORS.skipCheck) {
      return this.page.unsavedDraftVisible && this.page.checkRunStatus === 'not_run';
    }
    if (this.selector === SELECTORS.unsavedDraft || this.selector === SELECTORS.saveVersion) {
      return this.page.unsavedDraftVisible;
    }
    return true;
  }

  async textContent() {
    this.page.events.push(['textContent', this.selector]);
    if (this.selector === SELECTORS.currentVersion) {
      return this.page.forcedVersionLabel ?? this.page.versionLabel;
    }
    if (this.selector === SELECTORS.runCheck) return 'Run npm test';
    if (this.selector === SELECTORS.versionSavedActivity) {
      if (this.page.savedActivityTextOverride !== null) return this.page.savedActivityTextOverride;
      if (this.page.savedActivityRevision <= 0) return '';
      if (
        this.filterText !== null
        && this.filterText !== `This draft was saved as Version ${this.page.savedActivityRevision}.`
      ) return '';
      return `Version saved This draft was saved as Version ${this.page.savedActivityRevision}.`;
    }
    if (this.selector === SELECTORS.liveOutput) {
      if (this.page.liveOutputTextOverride !== null) return this.page.liveOutputTextOverride;
      return 'Assistant Building the first project draft.';
    }
    if (this.selector === SELECTORS.composerStatus) {
      return this.page.composerStatusText();
    }
    if (this.selector === SELECTORS.reviewCheckpoint) {
      if (this.page.reviewTextOverride !== null) return this.page.reviewTextOverride;
      return 'Review before saving 1 file change: 1 added. Preview and changes are ready.';
    }
    if (this.selector === SELECTORS.previewLimitation) {
      if (this.page.previewLimitationTextOverride !== null) return this.page.previewLimitationTextOverride;
      return 'Static preview HTML and CSS are shown here. JavaScript is disabled, so controls or animations may need live preview support before saving.';
    }
    if (this.selector === SELECTORS.preview) {
      if (this.page.previewTextOverride !== null) return this.page.previewTextOverride;
      return 'Focus timer Static preview';
    }
    if (this.selector === SELECTORS.previewUnavailable) {
      if (this.page.previewUnavailableTextOverride !== null) return this.page.previewUnavailableTextOverride;
      return 'Preview unavailable The files were generated, but this preview cannot run this kind of project yet. Review the source files and changes before saving. 3D/WebGL, JavaScript modules, canvas animation, network assets, local servers, and backend code need live preview support.';
    }
    if (this.selector === SELECTORS.changesSummary) {
      return '1 file change: 1 added.';
    }
    if (this.selector === SELECTORS.changesPanel) {
      if (this.page.changesTextOverride !== null) return this.page.changesTextOverride;
      return 'Changes 1 file change: 1 added. 1 line added + Focus timer preview';
    }
    if (this.selector === SELECTORS.workspacePicker) {
      return 'Choose or create a project before I build. Add a source folder so Builder knows where it can work. Search projects No saved projects yet. New project';
    }
    if (this.selector === SELECTORS.newProjectPanel) {
      return 'New project Project name Source folders No source folder selected. Choose an empty local folder that Builder can read and edit for this project. Add source folder';
    }
    return null;
  }

  async screenshot() {
    if (!this.page.artifactsAllowed) throw new Error('artifact before password cleared');
    return this.page.screenshotBufferOverride ?? pngFixture();
  }

  async count() {
    this.page.events.push(['count', this.selector]);
    if (this.selector === SELECTORS.previewUnavailable) {
      return this.page.previewUnavailable ? 1 : 0;
    }
    if (this.selector === SELECTORS.previewRuntimeBlocked) {
      return this.page.previewRuntimeBlocked ? 1 : 0;
    }
    if (this.selector === SELECTORS.previewLimitation) {
      return this.page.previewLimitationVisible ? 1 : 0;
    }
    if (this.selector === SELECTORS.questionAnswer) {
      return this.page.questionTurns;
    }
    return 1;
  }

  async boundingBox() {
    this.page.events.push(['boundingBox', this.selector]);
    if (this.page.reviewLayoutBoxes.has(this.selector)) {
      return this.page.reviewLayoutBoxes.get(this.selector);
    }
    return { x: 0, y: 0, width: 120, height: 32 };
  }

  async waitFor(options) {
    this.page.events.push(['waitFor', this.selector, options?.state ?? null]);
    const state = options?.state ?? 'visible';
    const initialWorkspaceGateDraftAbsenceCheck = this.selector === SELECTORS.unsavedDraft
      && state === 'hidden'
      && this.page.workspacePickerVisible
      && this.page.forceWorkspaceGateForNextBuild;
    if (this.page.failWaitFor.has(this.selector) && !initialWorkspaceGateDraftAbsenceCheck) {
      throw new Error('secret-marker');
    }
    if (this.selector === SELECTORS.retryDraft) {
      this.page.assertSelectorVisibility(this.selector, this.page.retryDraftVisible, state);
      return;
    }
    if (this.selector === `${SELECTORS.checkRunStatus}[data-builder-check-run-status="passed"]`) {
      this.page.assertSelectorVisibility(this.selector, this.page.checkRunStatus === 'passed', state);
      return;
    }
    if (this.selector === `${SELECTORS.checkRunStatus}[data-builder-check-run-status="skipped"]`) {
      this.page.assertSelectorVisibility(this.selector, this.page.checkRunStatus === 'skipped', state);
      return;
    }
    if (this.selector === SELECTORS.unsavedDraft || this.selector === SELECTORS.saveVersion) {
      this.page.assertSelectorVisibility(this.selector, this.page.unsavedDraftVisible, state);
      return;
    }
    if (this.selector === SELECTORS.historyPreview) {
      this.page.assertSelectorVisibility(this.selector, this.page.historyViewingRevision !== null, state);
      return;
    }
    if (this.selector === SELECTORS.versionHistory) {
      this.page.assertSelectorVisibility(this.selector, this.page.versionHistoryVisible, state);
      return;
    }
    if (this.selector === SELECTORS.liveOutput) {
      this.page.assertSelectorVisibility(this.selector, this.page.liveOutputVisible, state);
      return;
    }
    if (this.selector === SELECTORS.reviewCheckpoint || this.selector === SELECTORS.reviewOpenChanges) {
      this.page.assertSelectorVisibility(this.selector, this.page.unsavedDraftVisible, state);
      return;
    }
    if (
      this.selector === SELECTORS.planProposed
      || this.selector === SELECTORS.planReviewActions
      || this.selector === SELECTORS.approvePlan
      || this.selector === SELECTORS.rejectPlan
    ) {
      this.page.assertSelectorVisibility(
        this.selector,
        this.page.planTurns > this.page.approvedPlanReviews + this.page.rejectedPlanReviews,
        state,
      );
      return;
    }
    if (this.selector === SELECTORS.composerStatus) {
      this.page.assertSelectorVisibility(this.selector, this.page.composerStatusText() !== null, state);
      return;
    }
    if (this.selector === SELECTORS.planSourceReadApproval) {
      this.page.assertSelectorVisibility(this.selector, this.page.planSourceReadApprovalVisible, state);
      return;
    }
    if (this.selector === SELECTORS.currentProjectWriteApproval) {
      this.page.assertSelectorVisibility(this.selector, this.page.currentProjectWriteApprovalVisible, state);
      return;
    }
    if (this.selector === SELECTORS.questionAnswerFailedNotice) {
      this.page.assertSelectorVisibility(this.selector, this.page.questionAnswerFailedNoticeVisible, state);
      return;
    }
    if (this.selector === SELECTORS.generationFailedNotice) {
      this.page.assertSelectorVisibility(this.selector, this.page.alertVisible, state);
      return;
    }
    if (this.selector === SELECTORS.planApproved) {
      this.page.assertSelectorVisibility(
        this.selector,
        this.page.approvedPlanReviews > 0,
        state,
      );
      return;
    }
    if (this.selector === SELECTORS.planRejected) {
      this.page.assertSelectorVisibility(
        this.selector,
        this.page.rejectedPlanReviews > 0,
        state,
      );
      return;
    }
    if (
      this.selector === SELECTORS.toolActivityRequested
      || this.selector === SELECTORS.toolActivitySucceeded
    ) {
      this.page.assertSelectorVisibility(this.selector, this.page.planTurns > 0, state);
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
        state,
      );
      return;
    }
    if (this.selector === SELECTORS.workspacePicker) {
      this.page.assertSelectorVisibility(this.selector, this.page.workspacePickerVisible, state);
      return;
    }
    if (this.selector === SELECTORS.newProjectPanel) {
      this.page.assertSelectorVisibility(this.selector, this.page.newProjectPanelVisible, state);
      return;
    }
    if (this.selector === SELECTORS.preview) {
      this.page.assertSelectorVisibility(
        this.selector,
        this.page.previewVisible && !this.page.previewUnavailable,
        state,
      );
      return;
    }
    if (this.selector === SELECTORS.previewUnavailable) {
      this.page.assertSelectorVisibility(
        this.selector,
        this.page.previewUnavailable,
        state,
      );
      return;
    }
    if (this.selector === SELECTORS.previewFrame) {
      this.page.assertSelectorVisibility(
        this.selector,
        this.page.previewVisible && !this.page.previewUnavailable && !this.page.previewRuntimeBlocked,
        state,
      );
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
    if (this.name === 'New project') {
      this.page.forceWorkspaceGateForNextBuild = true;
      this.page.workspaceBound = false;
      this.page.workspacePickerVisible = false;
      this.page.newProjectPanelVisible = false;
      this.page.resetNewProjectConversation();
    }
    if (this.name === 'Send') {
      submitFakeCanaryInstruction(this.page);
    }
    if (this.name === 'Approve plan') this.page.recordPlanApproval();
    if (this.name === 'Reject') this.page.recordPlanRejection();
    if (this.name === 'Retry') this.page.retryCandidateAttempt();
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
    if (
      this.role === 'alert'
      && (this.page.alertVisible === true || this.page.unrelatedAlertVisible === true)
    ) return;
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
    this.changesDisclosureOpen = false;
    this.changesTextOverride = null;
    this.checkRunAvailable = false;
    this.checkRunStatus = 'not_run';
    this.composerAddMenuVisible = false;
    this.briefCorrectionActive = false;
    this.currentProjectWriteApprovalVisible = false;
    this.currentProjectWriteApproved = false;
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
    this.forceWorkspaceGateForNextBuild = false;
    this.forcedVersionLabel = null;
    this.historyViewingRevision = null;
    this.disabledRoles = new Set();
    this.draftFailuresRemaining = 0;
    this.keepPasswordValue = false;
    this.lastFailedDraftTarget = null;
    this.latestPlanReviewDecision = null;
    this.planReviewDecisions = [];
    this.liveOutputTextOverride = null;
    this.liveOutputVisible = false;
    this.approvedPlanReviews = 0;
    this.rejectedPlanReviews = 0;
    this.planTurns = 0;
    this.pendingWorkspaceGateInstruction = null;
    this.pendingCurrentProjectWriteInstruction = null;
    this.pendingCurrentProjectWriteCandidateTurns = null;
    this.planSourceReadApprovalVisible = false;
    this.planModeActive = false;
    this.previewVisible = true;
    this.previewRuntimeBlocked = false;
    this.previewLimitationVisible = true;
    this.previewUnavailable = false;
    this.previewUnavailableTextOverride = null;
    this.versionHistoryVisible = true;
    this.previewFrameBodyFailuresRemaining = 0;
    this.previewFrameBodyTextOverride = null;
    this.projectStatus = 'ready';
    this.questionAnswerFailedNoticeVisible = false;
    this.questionTurns = 0;
    this.newProjectPanelVisible = false;
    this.retryDraftVisible = false;
    this.requirePlanSourceReadApproval = false;
    this.requireCurrentProjectWriteApproval = false;
    this.reviewTextOverride = null;
    this.screenshotBufferOverride = null;
    this.previewLimitationTextOverride = null;
    this.previewTextOverride = null;
    this.reviewLayoutBoxes = new Map([
      [SELECTORS.chatScroll, { x: 300, y: 44, width: 620, height: 620 }],
      [SELECTORS.artifactSidebar, { x: 936, y: 44, width: 360, height: 620 }],
      [SELECTORS.artifactResizeHandle, { x: 931, y: 44, width: 10, height: 620 }],
      [SELECTORS.conversationActivity, { x: 312, y: 96, width: 596, height: 112 }],
      [SELECTORS.userMessage, { x: 628, y: 104, width: 280, height: 64 }],
      [SELECTORS.reviewCheckpoint, { x: 312, y: 220, width: 596, height: 136 }],
      [SELECTORS.reviewCopy, { x: 326, y: 234, width: 568, height: 62 }],
      [SELECTORS.reviewTitle, { x: 364, y: 234, width: 200, height: 18 }],
      [SELECTORS.reviewSummary, { x: 364, y: 254, width: 420, height: 17 }],
      [SELECTORS.reviewNote, { x: 364, y: 274, width: 500, height: 22 }],
      [SELECTORS.reviewActions, { x: 326, y: 308, width: 500, height: 32 }],
      [SELECTORS.reviewOpenPreview, { x: 326, y: 308, width: 96, height: 32 }],
      [SELECTORS.reviewOpenChanges, { x: 430, y: 308, width: 104, height: 32 }],
      [SELECTORS.discardDraft, { x: 542, y: 308, width: 128, height: 32 }],
      [SELECTORS.saveVersion, { x: 678, y: 308, width: 120, height: 32 }],
      [SELECTORS.artifactSummary, { x: 312, y: 362, width: 596, height: 88 }],
      [SELECTORS.resultFlow, { x: 948, y: 96, width: 324, height: 520 }],
      [SELECTORS.changesFlow, { x: 948, y: 96, width: 324, height: 520 }],
      [SELECTORS.changesPanel, { x: 948, y: 96, width: 324, height: 520 }],
      [SELECTORS.changeCard, { x: 960, y: 146, width: 300, height: 260 }],
      [SELECTORS.changeDiff, { x: 970, y: 196, width: 280, height: 170 }],
    ]);
    this.savedActivityRevision = 0;
    this.savedActivityTextOverride = null;
    this.savedRevision = 0;
    this.unsavedDraftVisible = false;
    this.unrelatedAlertVisible = false;
    this.versionLabel = 'Version 1';
    this.values = new Map();
    this.workspaceBound = false;
    this.workspacePickerVisible = false;
    this.listeners = new Map();
    this.assertSelectorVisibility = (_selector, visible, state) => {
      const expectedVisible = state !== 'hidden';
      if (visible !== expectedVisible) throw new Error('selector visibility mismatch');
    };
    this.commitSave = async () => {
      const revision = Math.max(this.savedRevision + 1, this.candidateTurns);
      this.retryDraftVisible = false;
      this.unsavedDraftVisible = false;
      this.liveOutputVisible = false;
      return revision;
    };
    this.resetNewProjectConversation = () => {
      this.questionTurns = 0;
      this.planTurns = 0;
      this.approvedPlanReviews = 0;
      this.rejectedPlanReviews = 0;
      this.latestPlanReviewDecision = null;
      this.planReviewDecisions = [];
      this.briefCorrectionActive = false;
    };
    this.recordCandidateAttempt = (candidateTurns) => {
      this.liveOutputVisible = true;
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
      this.checkRunStatus = 'not_run';
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
      const instruction = this.values.get(SELECTORS.idea) ?? '';
      if (routeFakeCanarySendInstruction(instruction) === 'brief_correction') {
        this.briefCorrectionActive = true;
      }
    };
    this.recordPlanAttempt = () => {
      this.planTurns += 1;
    };
    this.recordPlanApproval = () => {
      if (this.planTurns <= this.approvedPlanReviews + this.rejectedPlanReviews) {
        throw new Error('plan unavailable');
      }
      this.approvedPlanReviews += 1;
      this.latestPlanReviewDecision = 'approved';
      this.planReviewDecisions.push('approved');
      const candidateTurns = Math.max(this.savedRevision + 1, this.candidateTurns + 1, 1);
      if (
        this.requireCurrentProjectWriteApproval === true
        && this.currentProjectWriteApproved !== true
      ) {
        this.currentProjectWriteApprovalVisible = true;
        this.pendingCurrentProjectWriteInstruction = 'approved-plan';
        this.pendingCurrentProjectWriteCandidateTurns = candidateTurns;
        return;
      }
      this.recordCandidateAttempt(candidateTurns);
    };
    this.recordPlanRejection = () => {
      if (this.planTurns <= this.approvedPlanReviews + this.rejectedPlanReviews) {
        throw new Error('plan unavailable');
      }
      this.rejectedPlanReviews += 1;
      this.latestPlanReviewDecision = 'rejected';
      this.planReviewDecisions.push('rejected');
    };
    this.composerStatusText = () => {
      if (this.unsavedDraftVisible === true) return 'Ready to execute current direction';
      if (this.planTurns > this.approvedPlanReviews + this.rejectedPlanReviews) return 'Needs confirmation';
      if (this.latestPlanReviewDecision === 'rejected') return 'Direction changed';
      if (this.latestPlanReviewDecision === 'approved') return 'Using approved plan';
      if (this.briefCorrectionActive === true) return 'Direction changed';
      if (this.candidateTurns > 0) return 'Ready to execute current direction';
      return null;
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

  async waitForTimeout(ms) {
    this.events.push(['waitForTimeout', ms]);
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

function taskStreamConversation(
  selectedProjectId,
  savedRevision,
  candidateTurns,
  questionTurns = 0,
  planTurns = 0,
  approvedPlanReviews = 0,
  rejectedPlanReviews = 0,
  planReviewDecisions = null,
) {
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
    'builder-message:33333333-3333-4333-8333-333333333333',
    'builder-message:37373737-3737-4737-8737-373737373737',
    'builder-message:41414141-4141-4141-8141-414141414141',
  ];
  const questionAssistantMessageIds = [
    'builder-message:16161616-1616-4616-8616-161616161616',
    'builder-message:34343434-3434-4434-8434-343434343434',
    'builder-message:38383838-3838-4838-8838-383838383838',
    'builder-message:42424242-4242-4242-8242-424242424242',
  ];
  const questionTurnIds = [
    'builder-turn:17171717-1717-4717-8717-171717171717',
    'builder-turn:35353535-3535-4535-8535-353535353535',
    'builder-turn:39393939-3939-4939-8939-393939393939',
    'builder-turn:43434343-4343-4343-8343-434343434343',
  ];
  const questionRunIds = [
    'builder-run:18181818-1818-4818-8818-181818181818',
    'builder-run:36363636-3636-4636-8636-363636363636',
    'builder-run:40404040-4040-4040-8040-404040404040',
    'builder-run:45454545-4545-4545-8545-454545454545',
  ];
  const planUserMessageIds = [
    'builder-message:24242424-2424-4242-8424-242424242424',
    'builder-message:46464646-4646-4646-8646-464646464646',
    'builder-message:50505050-5050-4050-8050-505050505050',
  ];
  const planAssistantMessageIds = [
    'builder-message:25252525-2525-4252-8525-252525252525',
    'builder-message:47474747-4747-4747-8747-474747474747',
    'builder-message:51515151-5151-4151-8151-515151515151',
  ];
  const planTurnIds = [
    'builder-turn:26262626-2626-4262-8626-262626262626',
    'builder-turn:48484848-4848-4848-8848-484848484848',
    'builder-turn:52525252-5252-4252-8252-525252525252',
  ];
  const planTaskIds = [
    'builder-task:27272727-2727-4272-8727-272727272727',
    'builder-task:49494949-4949-4949-8949-494949494949',
    'builder-task:53535353-5353-4353-8353-535353535353',
  ];
  const planRunIds = [
    'builder-run:28282828-2828-4282-8828-282828282828',
    'builder-run:54545454-5454-4454-8454-545454545454',
    'builder-run:58585858-5858-4858-8858-585858585858',
  ];
  const planStepIds = [
    'builder-run-step:29292929-2929-4292-8929-292929292929',
    'builder-run-step:55555555-5555-4555-8555-555555555555',
    'builder-run-step:59595959-5959-4959-8959-595959595959',
  ];
  const planToolCallIds = [
    'builder-tool-call:30303030-3030-4030-8030-303030303030',
    'builder-tool-call:56565656-5656-4656-8656-565656565656',
    'builder-tool-call:60606060-6060-4060-8060-606060606060',
  ];
  const planDecisions = Array.isArray(planReviewDecisions) ? planReviewDecisions : null;
  let sequence = 0;
  function takeSequence() {
    sequence += 1;
    return sequence;
  }
  function pushCandidateTurn(revision, approvedPlanExecution = false) {
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
    );
    if (approvedPlanExecution) {
      items.push(
        {
          item_kind: 'run_context_snapshot_recorded',
          sequence: takeSequence(),
          turn_id: evidence.receipt.turn_id,
          run_id: evidence.receipt.run_id,
          task_id: evidence.receipt.task_id,
          context: {
            recorded_state: 'recorded',
            route: 'build',
            dispatch: 'build',
            downgraded_from: null,
            downgrade_reason: null,
            brief: 'available',
            base: 'project_revision',
            permission_result: 'allowed',
            command_execution: 'not_included',
            network_access: 'not_included',
          },
        },
        {
          item_kind: 'programming_run_admitted',
          sequence: takeSequence(),
          turn_id: evidence.receipt.turn_id,
          run_id: evidence.receipt.run_id,
          task_id: evidence.receipt.task_id,
          recorded_state: 'admitted',
        },
      );
    }
    items.push(
      {
        item_kind: 'run_completed',
        sequence: takeSequence(),
        turn_id: evidence.receipt.turn_id,
        run_id: evidence.receipt.run_id,
        terminal_status: 'succeeded',
        result_kind: 'candidate',
        failure_phase: 'not_applicable',
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
        failure_phase: 'not_applicable',
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
  function pushPlanTurn(index) {
    const turnId = planTurnIds[index - 1];
    const taskId = planTaskIds[index - 1];
    const runId = planRunIds[index - 1];
    const stepId = planStepIds[index - 1];
    const toolCallId = planToolCallIds[index - 1];
    items.push(
      {
        item_kind: 'user_message',
        sequence: takeSequence(),
        turn_id: turnId,
        message: {
          message_id: planUserMessageIds[index - 1],
          text: 'After reopening, add a compact completed-state summary below the timer.',
        },
        message_kind: 'submitted',
        mode: 'work',
        task: {
          task_id: taskId,
          title: 'Add completed-state summary',
        },
      },
      {
        item_kind: 'run_started',
        sequence: takeSequence(),
        turn_id: turnId,
        run_id: runId,
        task_id: taskId,
        attempt_number: 1,
        retry_of_run_id: null,
        recorded_state: 'started',
      },
      {
        item_kind: 'tool_call_requested',
        sequence: takeSequence(),
        turn_id: turnId,
        run_id: runId,
        step_id: stepId,
        tool_call_id: toolCallId,
        tool_label: 'Read project file',
        action: 'filesystem.read',
        resource: { resource_kind: 'filesystem' },
        lifecycle: {
          permission_admission: 'verified_allowed',
          dispatch_admission: 'not_started',
          execution_admission: 'not_performed',
          result_admission: 'not_recorded',
        },
        recorded_state: 'requested',
      },
      {
        item_kind: 'tool_call_result_recorded',
        sequence: takeSequence(),
        turn_id: turnId,
        run_id: runId,
        step_id: stepId,
        tool_call_id: toolCallId,
        tool_label: 'Read project file',
        action: 'filesystem.read',
        resource: { resource_kind: 'filesystem' },
        result: {
          status: 'succeeded',
          summary_code: 'completed_without_raw_output',
          display_summary: 'This step completed. Details were not kept.',
        },
        lifecycle: {
          result_admission: 'fixed_summary_code_recorded',
          raw_output_admission: 'not_included',
          revision_admission: 'not_created',
        },
        recorded_state: 'recorded',
      },
      {
        item_kind: 'run_completed',
        sequence: takeSequence(),
        turn_id: turnId,
        run_id: runId,
        terminal_status: 'succeeded',
        result_kind: 'plan',
        failure_phase: 'not_applicable',
        assistant_message: {
          message_id: planAssistantMessageIds[index - 1],
          text: 'I will add a small completed-state section and keep the current timer intact.',
        },
        candidate: null,
      },
      {
        item_kind: 'turn_completed',
        sequence: takeSequence(),
        turn_id: turnId,
        run_id: runId,
        outcome: 'plan_proposed',
      },
    );
    const decision = planDecisions === null
      ? (index <= approvedPlanReviews
        ? 'approved'
        : index <= approvedPlanReviews + rejectedPlanReviews
          ? 'rejected'
          : null)
      : (planDecisions[index - 1] ?? null);
    if (decision === 'approved') {
      items.push({
        item_kind: 'plan_reviewed',
        sequence: takeSequence(),
        turn_id: turnId,
        run_id: runId,
        decision: 'approved',
        plan_state: 'approved',
      });
    } else if (decision === 'rejected') {
      items.push({
        item_kind: 'plan_reviewed',
        sequence: takeSequence(),
        turn_id: turnId,
        run_id: runId,
        decision: 'rejected',
        plan_state: 'rejected',
      });
    }
  }
  if (candidateTurns >= 1) pushCandidateTurn(1);
  for (let question = 1; question <= questionTurns; question += 1) {
    pushQuestionTurn(question);
  }
  for (let revision = 2; revision <= Math.min(candidateTurns, 2); revision += 1) {
    pushCandidateTurn(revision);
  }
  for (let plan = 1; plan <= planTurns; plan += 1) {
    pushPlanTurn(plan);
  }
  for (let revision = 3; revision <= candidateTurns; revision += 1) {
    pushCandidateTurn(revision, revision - 2 <= approvedPlanReviews);
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
  planTurns = 0,
  approvedPlanReviews = 0,
  rejectedPlanReviews = 0,
  planReviewDecisions = null,
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
        ? taskStreamConversation(
          selectedProjectId,
          revisionNumber,
          candidateTurns,
          questionTurns,
          planTurns,
          approvedPlanReviews,
          rejectedPlanReviews,
          planReviewDecisions,
        )
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
      bridge_version: 'builder-preload.v26',
      legacy_namespaces_absent: true,
      check_run_namespace: 'current_draft_identity_methods_only',
      live_preview_namespace: 'current_preview_control_methods_only',
      plan_review_namespace: 'review_method_only',
      provider_context_disclosure_approval_namespace: 'approve_current_method_only',
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

function contextStatusProjection(overrides = {}) {
  const { authority: authorityOverrides = {}, ...projectionOverrides } = overrides;
  return {
    projection_version: 'builder-context-status-projection.v1',
    label: 'Ready to execute current direction',
    tone: 'success',
    next_action_hint: 'You can ask me to make the change.',
    has_pending_handoff: false,
    pending_handoff_count: 0,
    needs_confirmation: false,
    can_contextual_execute: true,
    authority: {
      projection_authority: 'main_owned_context_status_projection_v1',
      working_context_state: 'verified_not_exposed',
      pending_handoff_packets: 'none',
      renderer_authority: 'not_present',
      ipc_authority: 'not_present',
      provider_dispatch: false,
      tool_dispatch: false,
      source_read: 'not_present',
      source_write: 'not_present',
      git_mutation: false,
      permission_grant: false,
      revision_admission: 'not_created',
      secret_access: 'not_present',
      ...authorityOverrides,
    },
    ...projectionOverrides,
  };
}

function providerContextDisclosureStatusProjection(overrides = {}) {
  const { authority: authorityOverrides = {}, ...projectionOverrides } = overrides;
  return {
    projection_version: 'builder-provider-context-disclosure-status-projection.v1',
    label: 'Allow AI to use current context',
    tone: 'warning',
    next_action_hint: 'Review this before Builder shares the current task context.',
    needs_user_approval: true,
    can_use_provider_context: false,
    blocked_reason: 'context_disclosure_not_approved',
    request_available: true,
    inspection: {
      title: 'Share current task context with the configured AI provider',
      summary: 'Allow Builder to build with current context using a bounded local context summary.',
      details: 'This request does not include source files, secrets, ids, digests, or raw context text.',
      purpose: 'contextual_build',
      provider_scope: 'configured_provider',
      context_surface: {
        working_context_state_status: 'approved_plan_ready',
        segment_count: 3,
        segment_kinds: ['latest_user_message', 'working_context_objective', 'approved_plan'],
        omitted_ref_count: 0,
        budget: {
          used_prompt_bytes: 512,
          max_prompt_bytes: 4096,
          reserved_response_bytes: 1024,
        },
        permission_gate: {
          workspace_state: 'bound',
          write_permission: 'ask',
          side_effect_ready: false,
        },
      },
    },
    authority: {
      projection_authority: 'main_owned_provider_context_disclosure_status_projection_v1',
      disclosure_request_preparation: 'verified_safe_inspection_only',
      renderer_authority: 'not_present',
      provider_context_body: 'not_present',
      provider_dispatch: false,
      tool_dispatch: false,
      source_read: 'not_present',
      source_write: 'not_present',
      git_mutation: false,
      sqlite_write: false,
      permission_grant: false,
      revision_admission: 'not_created',
      secret_access: 'not_present',
      ...authorityOverrides,
    },
    ...projectionOverrides,
  };
}

function replaceTaskStreamItems(evidence, items) {
  const conversation = evidence.task_stream.conversation;
  conversation.items = items.map((item, index) => ({ ...item, sequence: index + 1 }));
  conversation.head_sequence = conversation.items.length;
  conversation.window.last_sequence = conversation.items.length;
  return evidence;
}

function addProgressAndToolFacts(evidence) {
  const conversation = evidence.task_stream.conversation;
  const items = [];
  let inserted = false;
  for (const item of conversation.items) {
    items.push(item);
    if (!inserted && item.item_kind === 'run_started' && item.task_id !== null) {
      inserted = true;
      items.push(
        {
          item_kind: 'run_progress_recorded',
          sequence: 0,
          turn_id: item.turn_id,
          run_id: item.run_id,
          stage: 'context_ready',
          recorded_state: 'recorded',
        },
        {
          item_kind: 'run_progress_recorded',
          sequence: 0,
          turn_id: item.turn_id,
          run_id: item.run_id,
          stage: 'provider_request_started',
          recorded_state: 'recorded',
        },
        {
          item_kind: 'tool_call_requested',
          sequence: 0,
          turn_id: item.turn_id,
          run_id: item.run_id,
          step_id: 'builder-run-step:123e4567-e89b-42d3-a456-426614174000',
          tool_call_id: 'builder-tool-call:123e4567-e89b-42d3-a456-426614174000',
          tool_label: 'Read project file',
          action: 'filesystem.read',
          resource: { resource_kind: 'filesystem' },
          lifecycle: {
            permission_admission: 'verified_allowed',
            dispatch_admission: 'not_started',
            execution_admission: 'not_performed',
            result_admission: 'not_recorded',
          },
          recorded_state: 'requested',
        },
        {
          item_kind: 'tool_call_result_recorded',
          sequence: 0,
          turn_id: item.turn_id,
          run_id: item.run_id,
          step_id: 'builder-run-step:123e4567-e89b-42d3-a456-426614174000',
          tool_call_id: 'builder-tool-call:123e4567-e89b-42d3-a456-426614174000',
          tool_label: 'Read project file',
          action: 'filesystem.read',
          resource: { resource_kind: 'filesystem' },
          result: {
            status: 'succeeded',
            summary_code: 'completed_without_raw_output',
            display_summary: 'This step completed. Details were not kept.',
          },
          lifecycle: {
            result_admission: 'fixed_summary_code_recorded',
            raw_output_admission: 'not_included',
            revision_admission: 'not_created',
          },
          recorded_state: 'recorded',
        },
      );
    }
  }
  return replaceTaskStreamItems(evidence, items);
}

function addContextSnapshotAndBriefFacts(evidence) {
  const conversation = evidence.task_stream.conversation;
  const items = [];
  let inserted = false;
  for (const item of conversation.items) {
    items.push(item);
    if (!inserted && item.item_kind === 'run_started' && item.task_id !== null) {
      inserted = true;
      items.push(
        {
          item_kind: 'run_context_snapshot_recorded',
          sequence: 0,
          turn_id: item.turn_id,
          run_id: item.run_id,
          task_id: item.task_id,
          context: {
            recorded_state: 'recorded',
            route: 'build',
            dispatch: 'build',
            downgraded_from: null,
            downgrade_reason: null,
            brief: 'available',
            base: 'new_project_or_unsaved',
            permission_result: 'allowed',
            command_execution: 'not_included',
            network_access: 'not_included',
          },
        },
        {
          item_kind: 'task_brief_updated',
          sequence: 0,
          turn_id: item.turn_id,
          run_id: item.run_id,
          task: {
            task_id: item.task_id,
            title: 'Make a focus timer',
          },
          brief: {
            status: 'ready',
            summary: 'Build a compact focus timer with a saved result.',
            contextual_build_ready: true,
          },
          recorded_state: 'updated',
        },
      );
    }
  }
  return replaceTaskStreamItems(evidence, items);
}

function addSteeringMessage(evidence) {
  const items = [...evidence.task_stream.conversation.items];
  let runStartedIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].item_kind === 'run_started' && items[index].task_id !== null) {
      runStartedIndex = index;
      break;
    }
  }
  if (runStartedIndex < 0) throw new Error('missing candidate run');
  const started = items[runStartedIndex];
  items.splice(runStartedIndex + 1, 0, {
    item_kind: 'user_message',
    sequence: 0,
    turn_id: started.turn_id,
    message: {
      message_id: 'builder-message:21212121-2121-4121-8121-212121212121',
      text: 'Make the active draft calmer.',
    },
    message_kind: 'steering',
    mode: null,
    task: null,
  });
  return replaceTaskStreamItems(evidence, items);
}

function addQueuedFollowupMessage(evidence) {
  const items = [...evidence.task_stream.conversation.items];
  let runStartedIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].item_kind === 'run_started' && items[index].task_id !== null) {
      runStartedIndex = index;
      break;
    }
  }
  if (runStartedIndex < 0) throw new Error('missing candidate run');
  const started = items[runStartedIndex];
  items.splice(runStartedIndex + 1, 0, {
    item_kind: 'user_message',
    sequence: 0,
    turn_id: started.turn_id,
    message: {
      message_id: 'builder-message:31313131-3131-4131-8131-313131313131',
      text: 'After this finishes, make the summary shorter.',
    },
    message_kind: 'queued_followup',
    mode: null,
    task: null,
  });
  return replaceTaskStreamItems(evidence, items);
}

function installBridge(page) {
  globalThis.clawfabricBuilder = {
    bridgeVersion: 'builder-preload.v26',
    codeGenerator: {
      classifyIntent() { throw new Error('must not route through bridge'); },
      submit() { throw new Error('must not write through bridge'); },
      generate() { throw new Error('must not write through bridge'); },
      continueDraft() { throw new Error('must not write through bridge'); },
      generateApprovedPlan() { throw new Error('must not write through bridge'); },
      proposePlan() { throw new Error('must not write through bridge'); },
      preparePlanSourceReadApproval() { throw new Error('must not write through bridge'); },
      approvePlanSourceRead() { throw new Error('must not write through bridge'); },
      prepareCurrentProjectWriteApproval() { throw new Error('must not write through bridge'); },
      approveCurrentProjectWrite() { throw new Error('must not write through bridge'); },
      retry() { throw new Error('must not write through bridge'); },
      answer() { throw new Error('must not write through bridge'); },
      answerDraft() { throw new Error('must not write through bridge'); },
      restoreDraft() { throw new Error('must not write through bridge'); },
      restoreRevisionAsDraft() { throw new Error('must not write through bridge'); },
      rejectDraft() { throw new Error('must not write through bridge'); },
      cancel() { throw new Error('must not write through bridge'); },
      steer() { throw new Error('must not write through bridge'); },
      queueFollowup() { throw new Error('must not write through bridge'); },
      availability() { throw new Error('must not write through bridge'); },
      subscribeStarted() { return () => undefined; },
      subscribeOutput() { return () => undefined; },
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
          page.planTurns,
          page.approvedPlanReviews,
          page.rejectedPlanReviews,
          page.planReviewDecisions,
        ).current;
      },
      openLocation() { throw new Error('must not open locations through bridge canary fixture'); },
      async listCurrent() {
        return bridgeEvidence(
          null,
          page.draftSaved,
          Math.max(1, page.savedRevision),
          Math.max(1, page.savedRevision, page.candidateTurns),
          page.questionTurns,
          page.planTurns,
          page.approvedPlanReviews,
          page.rejectedPlanReviews,
          page.planReviewDecisions,
        ).catalog;
      },
      async listWorkspaces() {
        return {
          result_version: 'builder-product-metadata-result.v4',
          operation: 'project_workspaces_listed',
          workspaces: [],
          metadata_evidence: {
            product_authority: 'sqlite_project_workspace_binding',
            code_authority: 'not_read_for_workspace_list',
            source_read_admission: 'not_requested',
            path_disclosure: 'folder_name_only',
          },
        };
      },
      async loadCurrent(request) {
        return bridgeEvidence(
          request.project_id,
          page.draftSaved,
          Math.max(1, page.savedRevision),
          Math.max(1, page.savedRevision, page.candidateTurns),
          page.questionTurns,
          page.planTurns,
          page.approvedPlanReviews,
          page.rejectedPlanReviews,
          page.planReviewDecisions,
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
            page.planTurns,
            page.approvedPlanReviews,
            page.rejectedPlanReviews,
            page.planReviewDecisions,
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
          page.planTurns,
          page.approvedPlanReviews,
          page.rejectedPlanReviews,
          page.planReviewDecisions,
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
    providerContextDisclosureApproval: {
      async approveCurrent() { throw new Error('must not approve provider context through bridge'); },
    },
    checkRun: {
      async readCurrentDraftAvailableChecks() { throw new Error('must not read checks through bridge'); },
      async approveAndRunCurrentDraftCheck() { throw new Error('must not run checks through bridge'); },
    },
    livePreview: {
      async requestCurrentDraftPreview() { throw new Error('must not start live preview through bridge'); },
      async reloadCurrentPreview() { throw new Error('must not reload live preview through bridge'); },
      async stopCurrentPreview() { throw new Error('must not stop live preview through bridge'); },
      async readCurrentPreviewStatus() { throw new Error('must not read live preview through bridge'); },
    },
    taskStream: {
      async read(request) {
        return bridgeEvidence(
          request.project_id,
          page.draftSaved,
          Math.max(1, page.savedRevision),
          Math.max(1, page.savedRevision, page.candidateTurns),
          page.questionTurns,
          page.planTurns,
          page.approvedPlanReviews,
          page.rejectedPlanReviews,
          page.planReviewDecisions,
        )
          .task_stream;
      },
      subscribeChanged() {
        return () => undefined;
      },
    },
    planReview: {
      async review() { throw new Error('must not review plans through read canary bridge'); },
    },
  };
}

function fakeElectron(page) {
  const durableStore = {
    approvedPlanReviews: 0,
    briefCorrectionActive: false,
    candidateTurns: 0,
    latestPlanReviewDecision: null,
    planReviewDecisions: [],
    planTurns: 0,
    questionTurns: 0,
    rejectedPlanReviews: 0,
    revision: 0,
  };
  const fake = {
    appEvents: [],
    launches: [],
    pages: [],
    async launch(options) {
      fake.launches.push(options);
      const activePage = fake.launches.length === 1 ? page : new FakePage();
      activePage.candidateTurns = durableStore.candidateTurns;
      activePage.briefCorrectionActive = durableStore.briefCorrectionActive;
      activePage.changesPanelVisible = false;
      activePage.approvedPlanReviews = durableStore.approvedPlanReviews;
      activePage.latestPlanReviewDecision = durableStore.latestPlanReviewDecision;
      activePage.planReviewDecisions = [...durableStore.planReviewDecisions];
      activePage.planTurns = durableStore.planTurns;
      activePage.questionTurns = durableStore.questionTurns;
      activePage.rejectedPlanReviews = durableStore.rejectedPlanReviews;
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
        const instruction = activePage.values.get(SELECTORS.idea) ?? '';
        if (routeFakeCanarySendInstruction(instruction) === 'brief_correction') {
          durableStore.briefCorrectionActive = true;
          activePage.briefCorrectionActive = true;
        }
        activePage.questionTurns = durableStore.questionTurns;
      };
      activePage.resetNewProjectConversation = () => {
        durableStore.questionTurns = 0;
        durableStore.planTurns = 0;
        durableStore.approvedPlanReviews = 0;
        durableStore.rejectedPlanReviews = 0;
        durableStore.latestPlanReviewDecision = null;
        durableStore.planReviewDecisions = [];
        durableStore.briefCorrectionActive = false;
        activePage.questionTurns = 0;
        activePage.planTurns = 0;
        activePage.approvedPlanReviews = 0;
        activePage.rejectedPlanReviews = 0;
        activePage.latestPlanReviewDecision = null;
        activePage.planReviewDecisions = [];
        activePage.briefCorrectionActive = false;
      };
      activePage.recordPlanAttempt = () => {
        durableStore.planTurns += 1;
        activePage.planTurns = durableStore.planTurns;
      };
      activePage.recordPlanApproval = () => {
        if (durableStore.planTurns <= durableStore.approvedPlanReviews + durableStore.rejectedPlanReviews) {
          throw new Error('plan unavailable');
        }
        durableStore.approvedPlanReviews += 1;
        durableStore.latestPlanReviewDecision = 'approved';
        durableStore.planReviewDecisions.push('approved');
        activePage.approvedPlanReviews = durableStore.approvedPlanReviews;
        activePage.latestPlanReviewDecision = durableStore.latestPlanReviewDecision;
        activePage.planReviewDecisions = [...durableStore.planReviewDecisions];
        activePage.recordCandidateAttempt(Math.max(durableStore.revision + 1, durableStore.candidateTurns + 1, 1));
      };
      activePage.recordPlanRejection = () => {
        if (durableStore.planTurns <= durableStore.approvedPlanReviews + durableStore.rejectedPlanReviews) {
          throw new Error('plan unavailable');
        }
        durableStore.rejectedPlanReviews += 1;
        durableStore.latestPlanReviewDecision = 'rejected';
        durableStore.planReviewDecisions.push('rejected');
        activePage.rejectedPlanReviews = durableStore.rejectedPlanReviews;
        activePage.latestPlanReviewDecision = durableStore.latestPlanReviewDecision;
        activePage.planReviewDecisions = [...durableStore.planReviewDecisions];
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
              durableStore.planTurns,
              durableStore.approvedPlanReviews,
              durableStore.rejectedPlanReviews,
              durableStore.planReviewDecisions,
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

function blankPngFixture() {
  const png = new PNG({ width: 5, height: 5 });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = 255;
    png.data[offset + 1] = 255;
    png.data[offset + 2] = 255;
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
  assert.equal(
    parseCanaryInput(input({ provider: { ...parsed.provider, base_url: 'http://127.0.0.1:4317/v1' } }))
      .provider.base_url,
    'http://127.0.0.1:4317/v1',
  );
  assert.throws(
    () => parseCanaryInput(input({ executable_path: 'relative.exe' })),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.throws(
    () => parseCanaryInput(input({ provider: { ...parsed.provider, base_url: 'http://provider.example/v1' } })),
    (error) => error.code === 'canary_input_invalid',
  );
  assert.throws(
    () => parseCanaryInput(input({ provider: { ...parsed.provider, base_url: 'http://127.0.0.1:4317/v1/' } })),
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
    'Back to project',
  ]);
  assert.equal(page.events.some((event) => (
    event[0] === 'waitFor'
    && event[1] === SELECTORS.projectPage
    && event[2] === 'visible'
  )), true);
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
    live_output: liveOutputEvidence(),
    pre_save_catalog_empty: true,
    review_diff: reviewDiffEvidence(),
    saved_via_ui: true,
    unsaved_draft_observed: true,
    workspace_gate: workspaceGateEvidence(),
  });
  const roleClicks = page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]);
  assert.deepEqual(roleClicks, ['New project', 'Send']);
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'click').map((event) => event[1]).slice(0, 2),
    [SELECTORS.workspaceNewProject, SELECTORS.addSourceFolder],
  );
  const firstSend = page.events.findIndex((event) => event[0] === 'roleClick' && event[2] === 'Send');
  const pickerVisible = page.events.findIndex((event) => (
    event[0] === 'waitFor'
    && event[1] === SELECTORS.workspacePicker
    && event[2] === 'visible'
  ));
  const sourceFolderClick = page.events.findIndex((event) => (
    event[0] === 'click'
    && event[1] === SELECTORS.addSourceFolder
  ));
  assert.ok(firstSend >= 0 && firstSend < pickerVisible);
  assert.ok(pickerVisible < sourceFolderClick);
  const liveOutputVisible = page.events.findIndex((event) => (
    event[0] === 'waitFor'
    && event[1] === SELECTORS.liveOutput
    && event[2] === 'visible'
  ));
  const liveOutputText = page.events.findIndex((event) => (
    event[0] === 'textContent'
    && event[1] === SELECTORS.liveOutput
  ));
  const terminalPreview = page.events.findIndex((event) => (
    event[0] === 'waitFor'
    && event[1] === SELECTORS.preview
    && event[2] === 'visible'
  ));
  assert.ok(sourceFolderClick < liveOutputVisible);
  assert.ok(liveOutputVisible < liveOutputText);
  assert.ok(liveOutputText < terminalPreview);
  const saveScroll = page.events.findIndex(
    (event) => event[0] === 'scrollIntoView' && event[1] === SELECTORS.saveVersion,
  );
  const changesCollapse = page.events.findIndex(
    (event) => event[0] === 'click' && event[1] === SELECTORS.changesSummaryToggle,
  );
  const saveClickBySelector = page.events.findIndex(
    (event) => event[0] === 'click' && event[1] === SELECTORS.saveVersion,
  );
  assert.ok(changesCollapse >= 0 && changesCollapse < saveScroll);
  assert.ok(saveScroll >= 0 && saveScroll < saveClickBySelector);
  assert.equal(page.events.some((event) => event[0] === 'roleFirst'), false);

  const evidence = await readOnlyBridgeEvidence(page, 'builder-project:11111111-1111-4111-8111-111111111111');
  assert.equal(evidence.status.configured, true);
  assert.equal(evidence.bridge_contract.bridge_version, 'builder-preload.v26');
  const evaluateEvents = page.events.filter((event) => event[0] === 'evaluate');
  const source = evaluateEvents[0][1];
  assert.match(source, /providerSettings\.status/u);
  assert.match(source, /projectWorkspace\.listCurrent/u);
  assert.match(source, /projectWorkspace\.loadCurrent/u);
  assert.match(source, /taskStream\.read/u);
  assert.doesNotMatch(source, /replaceCurrent|codeGenerator\.(?:submit|generate|continueDraft|generateApprovedPlan|proposePlan|preparePlanSourceReadApproval|approvePlanSourceRead|prepareCurrentProjectWriteApproval|approveCurrentProjectWrite|retry|answer|answerDraft|restoreRevisionAsDraft|rejectDraft|steer|queueFollowup)|projectWorkspace\.saveDraft|cancel/u);
  const unsavedWait = page.events.findIndex(
    (event) => event[0] === 'scopedText' && event[2] === 'Unsaved draft',
  );
  const preSaveRead = page.events.findIndex((event) => event[0] === 'evaluate');
  const saveClick = page.events.findIndex(
    (event) => event[0] === 'click' && event[1] === SELECTORS.saveVersion,
  );
  const versionWait = page.events.findIndex(
    (event) => event[0] === 'textContent' && event[1] === SELECTORS.currentVersion,
  );
  assert.ok(unsavedWait >= 0 && unsavedWait < preSaveRead);
  assert.ok(preSaveRead < changesCollapse);
  assert.ok(changesCollapse < saveClick);
  assert.ok(saveClick < versionWait);
});

test('runs the main-selected project check before saving Version 1', async (t) => {
  const page = new FakePage();
  page.checkRunAvailable = true;
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });

  const draftEvidence = await generateProjectViaUi(page, 'Make a focus timer.');

  assert.deepEqual(draftEvidence.check_run, {
    approval_action: 'Run npm test',
    command_profile_selected_by_main: true,
    packaged_runtime_executed: true,
    status: 'passed',
  });
  const checkClick = page.events.findIndex(
    (event) => event[0] === 'click' && event[1] === SELECTORS.runCheck,
  );
  const saveClick = page.events.findIndex(
    (event) => event[0] === 'click' && event[1] === SELECTORS.saveVersion,
  );
  assert.ok(checkClick >= 0 && checkClick < saveClick);
});

test('approves current project write gate before waiting for draft output', async (t) => {
  const page = new FakePage();
  installBridge(page);
  page.requireCurrentProjectWriteApproval = true;
  t.after(() => { delete globalThis.clawfabricBuilder; });

  assert.equal(await approveCurrentProjectWriteIfRequested(page), false);
  const draftEvidence = await generateProjectViaUi(page, 'Make a focus timer.');

  assert.deepEqual(draftEvidence, {
    live_output: liveOutputEvidence(),
    pre_save_catalog_empty: true,
    review_diff: reviewDiffEvidence(),
    saved_via_ui: true,
    unsaved_draft_observed: true,
    workspace_gate: workspaceGateEvidence(),
  });
  assert.equal(page.currentProjectWriteApproved, true);
  const sourceFolderClick = page.events.findIndex((event) => (
    event[0] === 'click'
    && event[1] === SELECTORS.addSourceFolder
  ));
  const approvalVisible = page.events.findIndex((event, index) => (
    index > sourceFolderClick &&
    event[0] === 'waitFor'
    && event[1] === SELECTORS.currentProjectWriteApproval
    && event[2] === 'visible'
  ));
  const approvalClick = page.events.findIndex((event, index) => (
    index > approvalVisible &&
    event[0] === 'click'
    && event[1] === SELECTORS.approveCurrentProjectWrite
  ));
  const liveOutputVisible = page.events.findIndex((event, index) => (
    index > approvalClick &&
    event[0] === 'waitFor'
    && event[1] === SELECTORS.liveOutput
    && event[2] === 'visible'
  ));
  assert.ok(sourceFolderClick >= 0 && sourceFolderClick < approvalVisible);
  assert.ok(approvalVisible < approvalClick);
  assert.ok(approvalClick < liveOutputVisible);
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
    [
      SELECTORS.changeCard,
      SELECTORS.changeDiff,
      SELECTORS.changeDiffLine,
      SELECTORS.changeCard,
      SELECTORS.changeDiff,
    ],
  );
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'boundingBox').map((event) => event[1]),
    [
      SELECTORS.reviewCheckpoint,
      SELECTORS.reviewCopy,
      SELECTORS.reviewTitle,
      SELECTORS.reviewSummary,
      SELECTORS.reviewNote,
      SELECTORS.reviewActions,
      SELECTORS.reviewOpenPreview,
      SELECTORS.reviewOpenChanges,
      SELECTORS.discardDraft,
      SELECTORS.saveVersion,
      SELECTORS.conversationActivity,
      SELECTORS.userMessage,
      SELECTORS.chatScroll,
      SELECTORS.artifactSummary,
      SELECTORS.artifactSidebar,
      SELECTORS.artifactResizeHandle,
      SELECTORS.resultFlow,
      SELECTORS.saveVersion,
      SELECTORS.chatScroll,
      SELECTORS.changesFlow,
      SELECTORS.changesPanel,
      SELECTORS.changeCard,
      SELECTORS.changeDiff,
    ],
  );
  page.reviewTextOverride = 'Review before saving sha256:secret';
  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_text_failed',
  );
});

test('rejects conversation activity that overlaps the draft review checkpoint', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;
  page.reviewLayoutBoxes.set(SELECTORS.conversationActivity, { x: 360, y: 168, width: 860, height: 96 });
  page.reviewLayoutBoxes.set(SELECTORS.userMessage, { x: 760, y: 184, width: 460, height: 64 });

  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_activity_failed',
  );
  assert.equal(page.events.some((event) => (
    event[0] === 'click'
    && event[1] === SELECTORS.reviewOpenChanges
  )), false);
});

test('rejects draft review actions that leave the checkpoint before Save', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;
  page.reviewLayoutBoxes.set(SELECTORS.saveVersion, { x: 1016, y: 286, width: 24, height: 96 });

  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_checkpoint_child_bounds_failed',
  );
  assert.equal(page.events.some((event) => (
    event[0] === 'click'
    && event[1] === SELECTORS.reviewOpenChanges
  )), false);
});

test('retries transient draft review child bounds while preserving strict geometry checks', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;
  page.reviewLayoutBoxes.set(SELECTORS.saveVersion, { x: 1016, y: 286, width: 24, height: 96 });
  page.waitForTimeout = async (ms) => {
    page.events.push(['waitForTimeout', ms]);
    page.reviewLayoutBoxes.set(SELECTORS.saveVersion, { x: 678, y: 308, width: 120, height: 32 });
  };

  assert.deepEqual(await inspectDraftReviewDiffViaUi(page), reviewDiffEvidence());
  assert.equal(
    page.events.some((event) => event[0] === 'waitForTimeout' && event[1] === 100),
    true,
  );
});

test('retries transient draft review text stack before rejecting layout overlap', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;
  page.reviewLayoutBoxes.set(SELECTORS.reviewActions, { x: 326, y: 288, width: 500, height: 32 });
  page.waitForTimeout = async (ms) => {
    page.events.push(['waitForTimeout', ms]);
    page.reviewLayoutBoxes.set(SELECTORS.reviewActions, { x: 326, y: 308, width: 500, height: 32 });
  };

  assert.deepEqual(await inspectDraftReviewDiffViaUi(page), reviewDiffEvidence());
  assert.equal(
    page.events.some((event) => event[0] === 'waitForTimeout' && event[1] === 100),
    true,
  );
});

test('rejects draft review checkpoint bounds that cannot support review actions', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;
  page.reviewLayoutBoxes.set(SELECTORS.reviewCheckpoint, { x: 312, y: 220, width: 300, height: 136 });

  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_checkpoint_width_failed',
  );

  page.reviewLayoutBoxes.set(SELECTORS.reviewCheckpoint, { x: 312, y: 220, width: 596, height: 84 });
  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_checkpoint_height_failed',
  );

  page.reviewLayoutBoxes.set(SELECTORS.reviewCheckpoint, { x: 312, y: 220, width: 596, height: 421 });
  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_checkpoint_height_failed',
  );

  page.reviewLayoutBoxes.set(SELECTORS.reviewCheckpoint, { x: 312, y: 220, width: 596, height: 136 });
  page.reviewLayoutBoxes.set(SELECTORS.reviewCopy, { x: 326, y: 234, width: 300, height: 62 });
  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_checkpoint_copy_width_failed',
  );
});

test('rejects squeezed draft review action geometry before Save', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;
  page.reviewLayoutBoxes.set(SELECTORS.saveVersion, { x: 678, y: 308, width: 24, height: 32 });

  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_checkpoint_action_geometry_failed',
  );
  assert.equal(page.events.some((event) => (
    event[0] === 'click'
    && event[1] === SELECTORS.reviewOpenChanges
  )), false);
});

test('rejects draft review copy that visually overlaps itself', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;
  page.reviewLayoutBoxes.set(SELECTORS.reviewSummary, { x: 412, y: 246, width: 420, height: 17 });

  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_checkpoint_text_stack_failed',
  );
  assert.equal(page.events.some((event) => (
    event[0] === 'click'
    && event[1] === SELECTORS.reviewOpenChanges
  )), false);
});

test('rejects draft review actions that overlap the preview explanation', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;
  page.reviewLayoutBoxes.set(SELECTORS.reviewActions, { x: 374, y: 288, width: 392, height: 32 });
  page.reviewLayoutBoxes.set(SELECTORS.reviewOpenChanges, { x: 374, y: 288, width: 112, height: 32 });
  page.reviewLayoutBoxes.set(SELECTORS.discardDraft, { x: 494, y: 288, width: 128, height: 32 });
  page.reviewLayoutBoxes.set(SELECTORS.saveVersion, { x: 630, y: 288, width: 120, height: 32 });

  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_checkpoint_text_stack_failed',
  );
  assert.equal(page.events.some((event) => (
    event[0] === 'click'
    && event[1] === SELECTORS.reviewOpenChanges
  )), false);
});

test('rejects draft artifact preview rendered inside the chat area', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;
  page.reviewLayoutBoxes.set(SELECTORS.resultFlow, { x: 360, y: 620, width: 860, height: 286 });

  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_artifact_result_geometry_failed',
  );
  assert.equal(page.events.some((event) => (
    event[0] === 'click'
    && event[1] === SELECTORS.reviewOpenChanges
  )), false);
});

test('rejects draft artifact summaries that are too narrow or before review actions', async () => {
  const narrow = new FakePage();
  narrow.unsavedDraftVisible = true;
  narrow.reviewLayoutBoxes.set(SELECTORS.artifactSummary, { x: 312, y: 372, width: 320, height: 72 });
  await assert.rejects(
    inspectDraftReviewDiffViaUi(narrow),
    (error) => error.code === 'canary_review_diff_artifact_summary_width_failed'
      && error.stage === 'review_diff_artifact_summary_width',
  );

  const beforeReview = new FakePage();
  beforeReview.unsavedDraftVisible = true;
  beforeReview.reviewLayoutBoxes.set(SELECTORS.artifactSummary, { x: 312, y: 188, width: 596, height: 72 });
  await assert.rejects(
    inspectDraftReviewDiffViaUi(beforeReview),
    (error) => error.code === 'canary_review_diff_artifact_summary_order_failed'
      && error.stage === 'review_diff_artifact_summary_order',
  );

  const transientOrder = new FakePage();
  transientOrder.unsavedDraftVisible = true;
  transientOrder.reviewLayoutBoxes.set(SELECTORS.artifactSummary, { x: 312, y: 188, width: 596, height: 72 });
  transientOrder.waitForTimeout = async (ms) => {
    transientOrder.events.push(['waitForTimeout', ms]);
    transientOrder.reviewLayoutBoxes.set(SELECTORS.artifactSummary, { x: 312, y: 362, width: 596, height: 88 });
  };
  assert.deepEqual(await inspectDraftReviewDiffViaUi(transientOrder), reviewDiffEvidence());
  assert.equal(
    transientOrder.events.some((event) => event[0] === 'waitForTimeout' && event[1] === 100),
    true,
  );

  const horizontal = new FakePage();
  horizontal.unsavedDraftVisible = true;
  horizontal.reviewLayoutBoxes.set(SELECTORS.artifactSummary, { x: 260, y: 372, width: 596, height: 72 });
  await assert.rejects(
    inspectDraftReviewDiffViaUi(horizontal),
    (error) => error.code === 'canary_review_diff_artifact_summary_horizontal_failed'
      && error.stage === 'review_diff_artifact_summary_horizontal',
  );

  const vertical = new FakePage();
  vertical.unsavedDraftVisible = true;
  vertical.reviewLayoutBoxes.set(SELECTORS.artifactSummary, { x: 312, y: 616, width: 596, height: 621 });
  await assert.rejects(
    inspectDraftReviewDiffViaUi(vertical),
    (error) => error.code === 'canary_review_diff_artifact_summary_vertical_failed'
      && error.stage === 'review_diff_artifact_summary_vertical',
  );
});

test('rejects draft changes panels that overlap the review checkpoint', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;
  page.reviewLayoutBoxes.set(SELECTORS.changesFlow, { x: 360, y: 300, width: 860, height: 320 });
  page.reviewLayoutBoxes.set(SELECTORS.changesPanel, { x: 360, y: 300, width: 860, height: 320 });

  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_changes_layout_failed',
  );
  assert.equal(page.events.some((event) => (
    event[0] === 'click'
    && event[1] === SELECTORS.reviewOpenChanges
  )), true);
});

test('rejects draft artifact sidebar without a draggable resize handle', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;
  page.reviewLayoutBoxes.set(SELECTORS.artifactResizeHandle, { x: 936, y: 44, width: 2, height: 620 });

  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_artifact_resize_geometry_failed',
  );
  assert.equal(page.events.some((event) => (
    event[0] === 'click'
    && event[1] === SELECTORS.reviewOpenChanges
  )), false);
});

test('rejects draft diffs rendered outside the changes panel', async () => {
  const page = new FakePage();
  page.unsavedDraftVisible = true;
  page.reviewLayoutBoxes.set(SELECTORS.changeDiff, { x: 1224, y: 440, width: 200, height: 160 });

  await assert.rejects(
    inspectDraftReviewDiffViaUi(page),
    (error) => error.code === 'canary_review_diff_changes_layout_failed',
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
    ['New project', 'Send', 'Retry'],
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
    /codeGenerator\.(?:submit|generate|continueDraft|generateApprovedPlan|proposePlan|preparePlanSourceReadApproval|approvePlanSourceRead|prepareCurrentProjectWriteApproval|approveCurrentProjectWrite|retry|answer|answerDraft|restoreRevisionAsDraft|rejectDraft|steer|queueFollowup)|projectWorkspace\.saveDraft|providerSettings\.replaceCurrent|providerContextDisclosureApproval\.approveCurrent|livePreview\.(?:requestCurrentDraftPreview|reloadCurrentPreview|stopCurrentPreview)|source_tree/u,
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
    answer_failure_notice_absent: true,
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
      run_progress_count: 0,
      source_availability: 'not_loaded',
      tool_request_count: 0,
      tool_result_count: 0,
    },
    ui_answer_observed: true,
    visible_answer_count: 1,
  });
  assert.deepEqual(
    assertTaskStreamExplanationFacts(evidence, firstRevision, 1, 1),
    answer.task_stream,
  );
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['New project', 'Send', 'Send'],
  );
  assert.equal(page.events.some((event) => (
    event[0] === 'isVisible'
    && event[1] === SELECTORS.questionAnswerFailedNotice
  )), true);
});

test('answers an initial no-folder chat question without opening workspace or draft UI', async (t) => {
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });

  const answer = await askInitialChatQuestionViaUi(page);

  assert.deepEqual(answer, {
    answer_failure_notice_absent: true,
    catalog_remained_empty: true,
    no_draft_created: true,
    no_workspace_required: true,
    ui_answer_observed: true,
    visible_answer_count: 1,
  });
  assert.equal(page.questionTurns, 1);
  assert.equal(page.candidateTurns, 0);
  assert.equal(page.savedRevision, 0);
  assert.equal(page.workspacePickerVisible, false);
  assert.equal(page.unsavedDraftVisible, false);
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['Send'],
  );
  assert.equal(page.events.some((event) => (
    event[0] === 'waitFor'
    && event[1] === SELECTORS.workspacePicker
    && event[2] === 'hidden'
  )), true);
  assert.equal(page.events.some((event) => (
    event[0] === 'isVisible'
    && event[1] === SELECTORS.questionAnswerFailedNotice
  )), true);
});

test('keeps consecutive initial no-folder chat answers visible', async (t) => {
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await askInitialChatQuestionViaUi(page);
  const followup = await askInitialChatQuestionViaUi(
    page,
    'Can we keep discussing before I choose a project folder?',
    2,
  );

  assert.deepEqual(followup, {
    answer_failure_notice_absent: true,
    catalog_remained_empty: true,
    no_draft_created: true,
    no_workspace_required: true,
    ui_answer_observed: true,
    visible_answer_count: 2,
  });
  assert.equal(page.questionTurns, 2);
  assert.equal(page.candidateTurns, 0);
  assert.equal(page.savedRevision, 0);
  assert.equal(page.workspacePickerVisible, false);
  assert.equal(page.unsavedDraftVisible, false);
});

test('rejects an initial no-folder chat question when answer_failed remains visible', async (t) => {
  const page = new FakePage();
  installBridge(page);
  page.questionAnswerFailedNoticeVisible = true;
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await assert.rejects(
    askInitialChatQuestionViaUi(page),
    (error) => error.code === 'canary_question_failed'
      && error.stage === 'question'
      && error.diagnostic?.answer_failed_notice_visible === true
      && error.diagnostic?.expected_visible_answers === 1,
  );
  assert.equal(page.questionTurns, 1);
  assert.equal(page.candidateTurns, 0);
  assert.equal(page.savedRevision, 0);
  assert.equal(page.workspacePickerVisible, false);
  assert.equal(page.unsavedDraftVisible, false);
});

test('rejects a saved-project question when answer_failed remains visible after the answer', async (t) => {
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });

  await generateProjectViaUi(page, 'Make a focus timer.');
  page.questionAnswerFailedNoticeVisible = true;
  const firstRevision = bridgeEvidence(
    'builder-project:11111111-1111-4111-8111-111111111111',
    true,
    1,
    1,
    0,
  ).current.product_revision_receipt;

  await assert.rejects(
    askProjectQuestionViaUi(page, firstRevision),
    (error) => error.code === 'canary_question_failed'
      && error.stage === 'question'
      && error.diagnostic?.answer_failed_notice_visible === true
      && error.diagnostic?.expected_visible_answers === 1,
  );
  assert.equal(page.questionTurns, 1);
  assert.equal(page.events.some((event) => (
    event[0] === 'isVisible'
    && event[1] === SELECTORS.questionAnswerFailedNotice
  )), true);
});

test('keeps consecutive saved-project chat answers visible without creating a draft', async (t) => {
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

  const first = await askProjectQuestionViaUi(page, firstRevision, CANARY_QUESTION, 1, 1);
  const second = await askProjectQuestionViaUi(
    page,
    firstRevision,
    'Can we keep discussing the audience before changing files?',
    1,
    2,
  );

  assert.equal(first.visible_answer_count, 1);
  assert.equal(second.visible_answer_count, 2);
  assert.equal(second.task_stream.answer_count, 2);
  assert.equal(second.task_stream.explanation_result_count, 2);
  assert.equal(page.questionTurns, 2);
  assert.equal(page.candidateTurns, 1);
  assert.equal(page.savedRevision, 1);
  assert.equal(page.unsavedDraftVisible, false);
});

test('keeps saved-project brief corrections read-only without creating a draft', async (t) => {
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

  const correction = await askProjectQuestionViaUi(
    page,
    firstRevision,
    '等等，先不要按这个做，我要重新整理方向。',
    1,
    1,
  );
  const evidence = await readSanitizedBridgeEvidence(page, firstRevision.project_id);

  assert.equal(correction.visible_answer_count, 1);
  assert.equal(correction.task_stream.answer_count, 1);
  assert.equal(correction.task_stream.explanation_result_count, 1);
  assert.equal(page.questionTurns, 1);
  assert.equal(page.candidateTurns, 1);
  assert.equal(page.savedRevision, 1);
  assert.equal(page.unsavedDraftVisible, false);
  assert.deepEqual(
    assertTaskStreamExplanationFacts(evidence, firstRevision, 1, 1),
    correction.task_stream,
  );
  assert.equal(
    page.events.some((event) => event[0] === 'roleClick' && event[2] === 'Save version'),
    false,
  );
});

test('keeps stale contextual build requests read-only after brief correction', async (t) => {
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

  await askProjectQuestionViaUi(
    page,
    firstRevision,
    '等等，先不要按这个做，我要重新整理方向。',
    1,
    1,
  );
  const stale = await askProjectQuestionViaUi(
    page,
    firstRevision,
    '按刚才方案做',
    1,
    2,
  );

  assert.equal(page.briefCorrectionActive, true);
  assert.equal(stale.visible_answer_count, 2);
  assert.equal(stale.task_stream.answer_count, 2);
  assert.equal(page.questionTurns, 2);
  assert.equal(page.candidateTurns, 1);
  assert.equal(page.savedRevision, 1);
  assert.equal(page.unsavedDraftVisible, false);
  assert.equal(
    page.events.some((event) => event[0] === 'roleClick' && event[2] === 'Save version'),
    false,
  );
});

test('keeps saved-project discussion correction and stale contextual turns in one read-only stream', async (t) => {
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

  await askProjectQuestionViaUi(page, firstRevision, CANARY_QUESTION, 1, 1);
  await askProjectQuestionViaUi(
    page,
    firstRevision,
    'Can we keep discussing the audience before changing files?',
    1,
    2,
  );
  await askProjectQuestionViaUi(
    page,
    firstRevision,
    '等等，先不要按这个做，我要重新整理方向。',
    1,
    3,
  );
  const stale = await askProjectQuestionViaUi(
    page,
    firstRevision,
    '按刚才方案做',
    1,
    4,
  );

  assert.equal(stale.task_stream.answer_count, 4);
  assert.equal(stale.task_stream.candidate_ready_count, 1);
  assert.equal(page.candidateTurns, 1);
  assert.equal(page.unsavedDraftVisible, false);
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

test('preserves fixed read-evidence substages without exposing bridge details', async () => {
  const page = new FakePage();
  page.evaluate = async () => { throw new Error('secret-marker'); };

  await assert.rejects(
    readSanitizedBridgeEvidence(page, null, 'canary_read_evidence_initial_saved_failed'),
    (error) => error.code === 'canary_read_evidence_initial_saved_failed'
      && error.stage === 'read_evidence_initial_saved'
      && !String(error.message).includes('secret-marker'),
  );
});

test('accepts current check outcome and agent activity task stream projections', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const evidence = bridgeEvidence(projectId, true, 1, 1, 0);
  const conversation = evidence.task_stream.conversation;
  const revision = evidence.current.product_revision_receipt;
  evidence.task_stream.check_run_outcome_projection = {
    projection_version: 'builder-check-run-outcome-projection.v1',
    state: 'not_run',
    command_kind: null,
    command_label: null,
    status: 'not_run',
    label: 'Not checked',
    summary: 'No project check has been recorded for this draft.',
    completed_at_ms: null,
    authority: {
      projection_authority: 'main_owned_check_run_outcome_projection_v1',
      fact_source: 'verified_absence',
      raw_output: 'not_present',
      runtime_paths: 'not_present',
      renderer_authority: 'read_only_projection',
      save_authority: false,
    },
  };
  evidence.task_stream.agent_activity_projection = {
    projection_version: 'builder-agent-activity-projection.v1',
    project_id: projectId,
    conversation_id: conversation.conversation_id,
    head_sequence: conversation.head_sequence,
    current: {
      phase: 'finished',
      status: 'complete',
      label: 'Finished',
      summary: 'This work is complete.',
      turn_id: revision.turn_id,
      run_id: revision.run_id,
    },
    authority: {
      projection_authority: 'main_owned_agent_activity_projection_v1',
      fact_source: 'recorded_activity',
      consumer_role: 'read_only',
      side_effect_authority: 'none',
    },
  };

  const sanitized = assertReadEvidence(evidence, 'canary_read_evidence_initial_current_failed');
  assert.equal(sanitized.task_stream.check_run_outcome_projection.state, 'not_run');
  assert.equal(sanitized.task_stream.agent_activity_projection.current.phase, 'finished');

  const tampered = bridgeEvidence(projectId, true, 1, 1, 0);
  tampered.task_stream.agent_activity_projection = {
    ...evidence.task_stream.agent_activity_projection,
    head_sequence: conversation.head_sequence + 1,
  };
  assert.throws(
    () => assertReadEvidence(tampered, 'canary_read_evidence_initial_current_failed'),
    (error) => error.code === 'canary_read_evidence_initial_current_task_stream_failed',
  );
});

test('preserves initial-current read-evidence component substages', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const currentFailure = bridgeEvidence(projectId, true, 1, 1, 0);
  currentFailure.current.operation = 'current_missing';
  assert.throws(
    () => assertReadEvidence(currentFailure, 'canary_read_evidence_initial_current_failed'),
    (error) => error.code === 'canary_read_evidence_initial_current_current_failed'
      && error.stage === 'read_evidence_initial_current_current',
  );

  const taskStreamFailure = bridgeEvidence(projectId, true, 1, 1, 0);
  taskStreamFailure.task_stream.stream_version = 'builder-task-stream-read-result.v0';
  assert.throws(
    () => assertReadEvidence(taskStreamFailure, 'canary_read_evidence_initial_current_failed'),
    (error) => error.code === 'canary_read_evidence_initial_current_task_stream_failed'
      && error.stage === 'read_evidence_initial_current_task_stream',
  );
});

test('skips plan source-read approval when no prompt is visible', async () => {
  const page = new FakePage();

  assert.equal(await approvePlanSourceReadIfRequested(page), false);
  assert.equal(page.planTurns, 0);
  assert.equal(page.planSourceReadApprovalVisible, false);
});

test('approves visible plan source-read prompt before waiting for a plan', async (t) => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });
  page.draftSaved = true;
  page.savedRevision = 2;
  page.candidateTurns = 2;
  page.questionTurns = 1;
  page.requirePlanSourceReadApproval = true;
  page.versionLabel = 'Version 2';

  const currentRevision = bridgeEvidence(projectId, true, 2, 2, 1).current.product_revision_receipt;
  const plan = await proposePlanViaUi(page, currentRevision, 'Add a completed summary.', 2, 1, 1);

  assert.equal(page.planSourceReadApprovalVisible, false);
  assert.equal(page.planTurns, 1);
  assert.equal(page.approvedPlanReviews, 0);
  assert.equal(page.candidateTurns, 2);
  assert.equal(page.unsavedDraftVisible, false);
  assert.equal(plan.composer_status_text, 'Needs confirmation');
  assert.deepEqual(
    assertTaskStreamPlanFacts(bridgeEvidence(projectId, true, 2, 2, 1, 1, 0), currentRevision, 2, 1, 1),
    plan.task_stream,
  );
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['Send'],
  );
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'click').map((event) => event[1]),
    [SELECTORS.composerAddMenuButton, SELECTORS.composerAddPlanMode, SELECTORS.approvePlanSourceRead],
  );
});

test('proposes and approves a saved-project plan before creating a draft', async (t) => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });
  page.draftSaved = true;
  page.savedRevision = 2;
  page.candidateTurns = 2;
  page.questionTurns = 1;
  page.versionLabel = 'Version 2';

  const currentRevision = bridgeEvidence(projectId, true, 2, 2, 1).current.product_revision_receipt;
  const plan = await proposePlanViaUi(page, currentRevision, 'Add a completed summary.', 2, 1, 1);

  assert.equal(page.planTurns, 1);
  assert.equal(page.approvedPlanReviews, 0);
  assert.equal(page.candidateTurns, 2);
  assert.equal(page.unsavedDraftVisible, false);
  assert.equal(plan.composer_status_text, 'Needs confirmation');
  assert.deepEqual(
    assertTaskStreamPlanFacts(bridgeEvidence(projectId, true, 2, 2, 1, 1, 0), currentRevision, 2, 1, 1),
    plan.task_stream,
  );

  const draft = await approvePlanViaUi(page, currentRevision, 3, 1, 1);

  assert.equal(page.approvedPlanReviews, 1);
  assert.equal(page.candidateTurns, 3);
  assert.equal(page.unsavedDraftVisible, true);
  assert.deepEqual(draft, {
    approved_plan_continued: true,
    approved_plan_task_stream_verified: true,
    composer_status_text: 'Ready to execute current direction',
    previous_revision_verified_before_save: true,
    review_diff: reviewDiffEvidence(),
    unsaved_draft_observed: true,
  });
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['Send', 'Approve plan'],
  );
  const selectorClicks = page.events.filter((event) => event[0] === 'click').map((event) => event[1]);
  assert.deepEqual(selectorClicks.slice(0, 2), [
    SELECTORS.composerAddMenuButton,
    SELECTORS.composerAddPlanMode,
  ]);
});

test('ignores unrelated visible alerts while waiting for approved-plan draft continuation', async (t) => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });
  page.draftSaved = true;
  page.savedRevision = 2;
  page.candidateTurns = 2;
  page.questionTurns = 1;
  page.unrelatedAlertVisible = true;
  page.versionLabel = 'Version 2';

  const currentRevision = bridgeEvidence(projectId, true, 2, 2, 1).current.product_revision_receipt;
  await proposePlanViaUi(page, currentRevision, 'Add a completed summary.', 2, 1, 1);

  const draft = await approvePlanViaUi(page, currentRevision, 3, 1, 1);

  assert.equal(page.approvedPlanReviews, 1);
  assert.equal(page.candidateTurns, 3);
  assert.equal(page.unsavedDraftVisible, true);
  assert.equal(draft.approved_plan_continued, true);
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleWaitFor' && event[1] === 'alert'),
    [],
  );
});

test('rejects a saved-project plan without creating a draft', async (t) => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });
  page.draftSaved = true;
  page.savedRevision = 2;
  page.candidateTurns = 2;
  page.questionTurns = 1;
  page.versionLabel = 'Version 2';

  const currentRevision = bridgeEvidence(projectId, true, 2, 2, 1).current.product_revision_receipt;
  const plan = await proposePlanViaUi(page, currentRevision, 'Add a completed summary.', 2, 1, 1);
  assert.equal(plan.composer_status_text, 'Needs confirmation');

  const rejected = await rejectPlanViaUi(page, currentRevision, 2, 1, 1);

  assert.equal(page.approvedPlanReviews, 0);
  assert.equal(page.rejectedPlanReviews, 1);
  assert.equal(page.candidateTurns, 2);
  assert.equal(page.unsavedDraftVisible, false);
  assert.equal(rejected.composer_status_text, 'Direction changed');
  assert.equal(rejected.plan_rejected, true);
  assert.equal(rejected.saved_revision_unchanged, true);
  assert.equal(rejected.unsaved_draft_visible, false);
  assert.equal(rejected.task_stream.latest_plan_review, 'rejected');
  assert.equal(rejected.task_stream.plan_reviewed_count, 1);
  assert.equal(rejected.task_stream.plan_approved_count, 0);
  assert.equal(rejected.task_stream.plan_rejected_count, 1);
  assert.equal(rejected.task_stream.candidate_ready_count, 2);
  assert.equal(rejected.task_stream.revision_unchanged, true);

  const afterRejectedContextual = await askRejectedPlanContextualSubmitViaUi(
    page,
    currentRevision,
    '按这个做',
    2,
    2,
    1,
    2,
  );

  assert.equal(page.questionTurns, 2);
  assert.equal(page.candidateTurns, 2);
  assert.equal(page.unsavedDraftVisible, false);
  assert.equal(afterRejectedContextual.contextual_submit_answered, true);
  assert.equal(afterRejectedContextual.composer_status_text, 'Direction changed');
  assert.equal(afterRejectedContextual.task_stream.latest_plan_review, 'rejected');
  assert.equal(afterRejectedContextual.task_stream.plan_rejected_count, 1);
  assert.equal(afterRejectedContextual.task_stream.candidate_ready_count, 2);
  assert.equal(afterRejectedContextual.task_stream.answer_count, 2);
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['Send', 'Reject', 'Send'],
  );
});

test('tracks the latest fake plan review decision for composer status', () => {
  const page = new FakePage();
  page.draftSaved = true;
  page.savedRevision = 1;
  page.candidateTurns = 1;

  page.recordPlanAttempt();
  page.recordPlanRejection();
  assert.equal(page.composerStatusText(), 'Direction changed');

  page.requireCurrentProjectWriteApproval = true;
  page.recordPlanAttempt();
  page.recordPlanApproval();

  assert.equal(page.approvedPlanReviews, 1);
  assert.equal(page.rejectedPlanReviews, 1);
  assert.equal(page.currentProjectWriteApprovalVisible, true);
  assert.equal(page.unsavedDraftVisible, false);
  assert.equal(page.composerStatusText(), 'Using approved plan');
});

test('keeps task stream latest plan review aligned to review order', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const evidence = assertReadEvidence(bridgeEvidence(
    projectId,
    true,
    2,
    3,
    0,
    2,
    1,
    1,
    ['rejected', 'approved'],
  ));
  const facts = evidence.task_stream.conversation.item_facts;

  assert.equal(facts.latestPlanReview.decision, 'approved');
  assert.equal(facts.latestPlanReview.plan_state, 'approved');
  assert.equal(facts.counts.plan_reviewed_count, 2);
  assert.equal(facts.counts.plan_approved_count, 1);
  assert.equal(facts.counts.plan_rejected_count, 1);
});

test('sanitizes optional task stream status projections without exposing private context', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const raw = bridgeEvidence(projectId, true, 1, 1, 0);
  raw.task_stream.context_status_projection = contextStatusProjection();
  raw.task_stream.provider_context_disclosure_status_projection =
    providerContextDisclosureStatusProjection();

  const evidence = assertReadEvidence(raw);

  assert.deepEqual(evidence.task_stream.context_status_projection, {
    can_contextual_execute: true,
    has_pending_handoff: false,
    label: 'Ready to execute current direction',
    needs_confirmation: false,
    pending_handoff_count: 0,
    tone: 'success',
  });
  assert.deepEqual(evidence.task_stream.provider_context_disclosure_status_projection, {
    blocked_reason: 'context_disclosure_not_approved',
    can_use_provider_context: false,
    inspection: {
      title: 'Share current task context with the configured AI provider',
      summary: 'Allow Builder to build with current context using a bounded local context summary.',
      details: 'This request does not include source files, secrets, ids, digests, or raw context text.',
      purpose: 'contextual_build',
      provider_scope: 'configured_provider',
      context_surface: {
        working_context_state_status: 'approved_plan_ready',
        segment_count: 3,
        segment_kinds: ['latest_user_message', 'working_context_objective', 'approved_plan'],
        omitted_ref_count: 0,
        budget: {
          used_prompt_bytes: 512,
          max_prompt_bytes: 4096,
          reserved_response_bytes: 1024,
        },
        permission_gate: {
          workspace_state: 'bound',
          write_permission: 'ask',
          side_effect_ready: false,
        },
      },
    },
    label: 'Allow AI to use current context',
    needs_user_approval: true,
    request_available: true,
    tone: 'warning',
  });
  assert.doesNotMatch(
    JSON.stringify({
      context_status_projection: evidence.task_stream.context_status_projection,
      provider_context_disclosure_status_projection:
        evidence.task_stream.provider_context_disclosure_status_projection,
    }),
    /builder-context-assembly|builder-provider-context-disclosure-request|builder-task-address:|builder-conversation:|sha256:|"provider_context":|provider_prompt_context|api[_-]?key|credential|source_tree|permission_id/iu,
  );
});

test('rejects forged optional task stream status projections before canary evidence is trusted', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const forgedContext = bridgeEvidence(projectId, true, 1, 1, 0);
  forgedContext.task_stream.context_status_projection = contextStatusProjection({
    authority: { source_read: 'allowed' },
  });
  assert.throws(
    () => assertReadEvidence(forgedContext),
    (error) => error.code === 'canary_evidence_failed',
  );

  const forgedProvider = bridgeEvidence(projectId, true, 1, 1, 0);
  forgedProvider.task_stream.provider_context_disclosure_status_projection =
    providerContextDisclosureStatusProjection({
      provider_prompt_context: 'Private task context.',
    });
  assert.throws(
    () => assertReadEvidence(forgedProvider),
    (error) => error.code === 'canary_evidence_failed',
  );
});

test('approves current-project write prompt after approving a plan', async (t) => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });
  page.draftSaved = true;
  page.savedRevision = 2;
  page.candidateTurns = 2;
  page.questionTurns = 1;
  page.requireCurrentProjectWriteApproval = true;
  page.versionLabel = 'Version 2';

  const currentRevision = bridgeEvidence(projectId, true, 2, 2, 1).current.product_revision_receipt;
  await proposePlanViaUi(page, currentRevision, 'Add a completed summary.', 2, 1, 1);

  assert.equal(page.approvedPlanReviews, 0);
  assert.equal(page.currentProjectWriteApprovalVisible, false);
  assert.equal(page.unsavedDraftVisible, false);

  const draft = await approvePlanViaUi(page, currentRevision, 3, 1, 1);

  assert.equal(page.approvedPlanReviews, 1);
  assert.equal(page.currentProjectWriteApproved, true);
  assert.equal(page.currentProjectWriteApprovalVisible, false);
  assert.equal(page.pendingCurrentProjectWriteCandidateTurns, null);
  assert.equal(page.candidateTurns, 3);
  assert.equal(page.unsavedDraftVisible, true);
  assert.deepEqual(draft, {
    approved_plan_continued: true,
    approved_plan_task_stream_verified: true,
    composer_status_text: 'Ready to execute current direction',
    previous_revision_verified_before_save: true,
    review_diff: reviewDiffEvidence(),
    unsaved_draft_observed: true,
  });
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['Send', 'Approve plan'],
  );
  assert.equal(
    page.events.some((event) => event[0] === 'click' && event[1] === SELECTORS.approveCurrentProjectWrite),
    true,
  );
});

test('reports safe plan stream diagnostics when context was read before plan failure', async (t) => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const page = new FakePage();
  installBridge(page);
  page.approvedPlanReviews = 1;
  page.projectStatus = 'submit_failed';
  page.evaluate = async () => ({
    diagnostic: 'stream_summary',
    failed_run: true,
    tool_requested_count: 1,
    tool_succeeded_count: 1,
    tool_failed_count: 0,
  });
  t.after(() => { delete globalThis.clawfabricBuilder; });

  const currentRevision = bridgeEvidence(projectId, true, 2, 2, 1).current.product_revision_receipt;

  await assert.rejects(
    proposePlanViaUi(page, currentRevision, 'Add a completed summary.', 2, 1, 1),
    (error) => error.code === 'canary_plan_after_context_failed'
      && error.stage === 'plan_after_context'
      && error.diagnostic?.diagnostic === 'stream_summary'
      && error.diagnostic?.failed_run === true
      && error.diagnostic?.tool_requested_count === 1
      && error.diagnostic?.tool_succeeded_count === 1
      && error.diagnostic?.tool_failed_count === 0
      && error.message === 'Packaged canary plan failed after reading project context.'
      && error.stack === `BuilderPackagedCanaryError: ${error.message}`,
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
    live_output: liveOutputEvidence(),
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
    run_progress_count: 0,
    saved_revision_number: 1,
    source_availability: 'not_loaded',
    tool_request_count: 0,
    tool_result_count: 0,
  });
  assert.deepEqual(await saveUpdateDraftViaUi(page, firstRevision), {
    saved_via_ui: true,
  });
  assert.equal(page.savedRevision, 2);
  assert.equal(page.versionLabel, 'Version 2');
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['New project', 'Send'],
  );
  assert.equal(
    page.events.filter((event) => event[0] === 'click' && event[1] === SELECTORS.submitTurn).length,
    1,
  );
  assert.equal(
    page.events.filter((event) => event[0] === 'click' && event[1] === SELECTORS.saveVersion).length,
    2,
  );
});

test('accepts active-run steering messages without changing candidate or revision authority', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const firstRevision = bridgeEvidence(projectId, true, 1).current.product_revision_receipt;
  const steered = addSteeringMessage(bridgeEvidence(projectId, true, 1, 2, 0));
  const facts = assertTaskStreamPendingCandidateFacts(steered, firstRevision, 2);

  assert.deepEqual(facts, {
    answer_count: 0,
    accepted_review_count: 1,
    candidate_ready_count: 2,
    candidate_reviewed_count: 1,
    candidate_result_count: 2,
    explanation_result_count: 0,
    head_sequence: 10,
    item_count: 10,
    latest_candidate_review: 'pending',
    latest_candidate_distinct_from_saved_revision: true,
    run_progress_count: 0,
    saved_revision_number: 1,
    source_availability: 'not_loaded',
    tool_request_count: 0,
    tool_result_count: 0,
  });
  assert.doesNotMatch(
    JSON.stringify(assertReadEvidence(steered).task_stream),
    /request_digest|provider|credential|source_tree|commit_oid|tree_oid|save_evidence/iu,
  );
});

test('accepts active-run queued follow-ups without changing candidate or revision authority', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const firstRevision = bridgeEvidence(projectId, true, 1).current.product_revision_receipt;
  const queued = addQueuedFollowupMessage(bridgeEvidence(projectId, true, 1, 2, 0));
  const facts = assertTaskStreamPendingCandidateFacts(queued, firstRevision, 2);

  assert.deepEqual(facts, {
    answer_count: 0,
    accepted_review_count: 1,
    candidate_ready_count: 2,
    candidate_reviewed_count: 1,
    candidate_result_count: 2,
    explanation_result_count: 0,
    head_sequence: 10,
    item_count: 10,
    latest_candidate_review: 'pending',
    latest_candidate_distinct_from_saved_revision: true,
    run_progress_count: 0,
    saved_revision_number: 1,
    source_availability: 'not_loaded',
    tool_request_count: 0,
    tool_result_count: 0,
  });
  assert.doesNotMatch(
    JSON.stringify(assertReadEvidence(queued).task_stream),
    /request_digest|provider|credential|source_tree|commit_oid|tree_oid|save_evidence/iu,
  );
});

test('observes a local Markdown artifact draft through workspace and review gates', async (t) => {
  const page = new FakePage();
  installBridge(page);
  t.after(() => { delete globalThis.clawfabricBuilder; });

  const draft = await generateProjectViaUi(page, 'Create a README.md with concise project notes.');
  const firstRevision = bridgeEvidence(
    'builder-project:11111111-1111-4111-8111-111111111111',
    true,
    1,
  ).current.product_revision_receipt;
  const evidence = await readSanitizedBridgeEvidence(page, firstRevision.project_id);

  assert.deepEqual(draft, {
    live_output: liveOutputEvidence(),
    pre_save_catalog_empty: true,
    review_diff: reviewDiffEvidence(),
    saved_via_ui: true,
    unsaved_draft_observed: true,
    workspace_gate: workspaceGateEvidence(),
  });
  assert.deepEqual(
    assertTaskStreamCandidateFacts(evidence, firstRevision, 1),
    {
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
      run_progress_count: 0,
      source_availability: 'not_loaded',
      tool_request_count: 0,
      tool_result_count: 0,
    },
  );
  assert.equal(page.questionTurns, 0);
  assert.equal(page.candidateTurns, 1);
  assert.equal(page.savedRevision, 1);
  assert.equal(page.unsavedDraftVisible, false);
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['New project', 'Send'],
  );
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'fill').map((event) => event[2]),
    ['Create a README.md with concise project notes.'],
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
    live_output: liveOutputEvidence(),
    previous_revision_verified_before_save: true,
    review_diff: reviewDiffEvidence(),
    saved_via_ui: true,
    unsaved_draft_observed: true,
  });
  assert.equal(page.savedRevision, 2);
  assert.equal(page.versionLabel, 'Version 2');
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'roleClick').map((event) => event[2]),
    ['New project', 'Send'],
  );
  assert.equal(
    page.events.filter((event) => event[0] === 'click' && event[1] === SELECTORS.submitTurn).length,
    1,
  );
  assert.equal(
    page.events.filter((event) => event[0] === 'click' && event[1] === SELECTORS.saveVersion).length,
    2,
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
  page.versionHistoryVisible = false;

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
    && event[1] === SELECTORS.artifactTabVersions
  )), true);
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
      code: 'canary_settings_return_failed',
      run: async () => {
        const page = new FakePage();
        page.failRoleClicks.add('button:Back to project');
        await fillProviderSettingsViaUi(page, provider, createArtifactGate());
      },
      stage: 'settings_return',
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
      code: 'canary_build_workspace_required_failed',
      run: async () => {
        const page = new FakePage();
        page.failWaitFor.add(SELECTORS.workspacePicker);
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'build_workspace_required',
    },
    {
      code: 'canary_generation_terminal_failed',
      run: async () => {
        const page = new FakePage();
        page.failWaitFor.add(SELECTORS.liveOutput);
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'generation_terminal',
    },
    {
      code: 'canary_current_project_write_approval_failed',
      run: async () => {
        const page = new FakePage();
        page.requireCurrentProjectWriteApproval = true;
        page.failClicks.add(SELECTORS.approveCurrentProjectWrite);
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'current_project_write_approval',
    },
    {
      code: 'canary_generation_terminal_failed',
      run: async () => {
        const page = new FakePage();
        page.liveOutputTextOverride = 'Assistant request_id provider credential source_tree sha256:secret';
        await generateProjectViaUi(page, 'Make a focus timer.');
      },
      stage: 'generation_terminal',
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
        page.failClicks.add(SELECTORS.saveVersion);
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
        page.failRoleClicks.add('button:Send');
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
        page.failWaitFor.add(SELECTORS.questionAnswer);
        const first = bridgeEvidence(
          'builder-project:11111111-1111-4111-8111-111111111111',
          true,
          1,
        ).current.product_revision_receipt;
        await askProjectQuestionViaUi(page, first);
      },
      stage: 'question_evidence',
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
        await askProjectQuestionViaUi(page, first, CANARY_QUESTION, 1, 2, 1);
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
        page.failWaitFor.add(SELECTORS.liveOutput);
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
      code: 'canary_update_generation_terminal_failed',
      run: async () => {
        const page = new FakePage();
        installBridge(page);
        page.draftSaved = true;
        page.savedRevision = 1;
        page.liveOutputTextOverride = 'Assistant builder-run:11111111-1111-4111-8111-111111111111 provider credential';
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
        page.failClicks.add(SELECTORS.saveVersion);
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
      code: 'canary_preview_frame_contract_failed',
      run: async () => {
        const page = new FakePage();
        page.failPreviewAttributes = true;
        const gate = createArtifactGate();
        gate.allow();
        await capturePreviewEvidence(page, gate);
      },
      stage: 'preview_frame_contract',
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

test('accepts renderer-safe run progress and tool activity in task stream evidence', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const evidence = addProgressAndToolFacts(bridgeEvidence(projectId, true, 1, 1, 0));
  const revision = evidence.current.product_revision_receipt;
  const facts = assertTaskStreamCandidateFacts(evidence, revision, 1, 0);

  assert.deepEqual(facts, {
    answer_count: 0,
    accepted_review_count: 1,
    candidate_ready_count: 1,
    candidate_reviewed_count: 1,
    candidate_result_count: 1,
    explanation_result_count: 0,
    head_sequence: 9,
    item_count: 9,
    latest_candidate_bound_to_revision: true,
    latest_candidate_review: 'accepted',
    latest_saved_revision_number: 1,
    run_progress_count: 2,
    source_availability: 'not_loaded',
    tool_request_count: 1,
    tool_result_count: 1,
  });
  assert.doesNotMatch(
    JSON.stringify(assertReadEvidence(evidence).task_stream),
    /permission_admission_receipt|record_digest|resource_id|raw_output|stdout|stderr|provider|credential|source_tree|commit_oid|tree_oid/iu,
  );
});

test('accepts renderer-safe route context and task brief task stream evidence', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';
  const evidence = addContextSnapshotAndBriefFacts(bridgeEvidence(projectId, true, 1, 1, 0));
  const revision = evidence.current.product_revision_receipt;
  const facts = assertTaskStreamCandidateFacts(evidence, revision, 1, 0);

  assert.deepEqual(facts, {
    answer_count: 0,
    accepted_review_count: 1,
    candidate_ready_count: 1,
    candidate_reviewed_count: 1,
    candidate_result_count: 1,
    explanation_result_count: 0,
    head_sequence: 7,
    item_count: 7,
    latest_candidate_bound_to_revision: true,
    latest_candidate_review: 'accepted',
    latest_saved_revision_number: 1,
    run_progress_count: 0,
    source_availability: 'not_loaded',
    tool_request_count: 0,
    tool_result_count: 0,
  });
  assert.doesNotMatch(
    JSON.stringify(assertReadEvidence(evidence).task_stream),
    /matchedSignals|rawRouteContext|provider|credential|source_tree|commit_oid|tree_oid|permission_admission_receipt/iu,
  );
});

test('rejects forged run progress and tool activity task stream facts', () => {
  const projectId = 'builder-project:11111111-1111-4111-8111-111111111111';

  const outOfOrderProgress = addProgressAndToolFacts(bridgeEvidence(projectId, true, 1, 1, 0));
  outOfOrderProgress.task_stream.conversation.items[2].stage = 'provider_request_started';
  assert.throws(
    () => assertReadEvidence(outOfOrderProgress),
    (error) => error.code === 'canary_evidence_failed',
  );

  const postTerminalProgress = addProgressAndToolFacts(bridgeEvidence(projectId, true, 1, 1, 0));
  const startedRun = postTerminalProgress.task_stream.conversation.items.find(
    (item) => item.item_kind === 'run_started',
  );
  const runCompletedIndex = postTerminalProgress.task_stream.conversation.items.findIndex(
    (item) => item.item_kind === 'run_completed',
  );
  replaceTaskStreamItems(postTerminalProgress, [
    ...postTerminalProgress.task_stream.conversation.items.slice(0, runCompletedIndex + 1),
    {
      item_kind: 'run_progress_recorded',
      sequence: 0,
      turn_id: startedRun.turn_id,
      run_id: startedRun.run_id,
      stage: 'provider_response_received',
      recorded_state: 'recorded',
    },
    ...postTerminalProgress.task_stream.conversation.items.slice(runCompletedIndex + 1),
  ]);
  assert.throws(
    () => assertReadEvidence(postTerminalProgress),
    (error) => error.code === 'canary_evidence_failed',
  );

  const orphanToolResult = addProgressAndToolFacts(bridgeEvidence(projectId, true, 1, 1, 0));
  replaceTaskStreamItems(
    orphanToolResult,
    orphanToolResult.task_stream.conversation.items.filter(
      (item) => item.item_kind !== 'tool_call_requested',
    ),
  );
  assert.throws(
    () => assertReadEvidence(orphanToolResult),
    (error) => error.code === 'canary_evidence_failed',
  );

  const forgedSummary = addProgressAndToolFacts(bridgeEvidence(projectId, true, 1, 1, 0));
  const toolResult = forgedSummary.task_stream.conversation.items.find(
    (item) => item.item_kind === 'tool_call_result_recorded',
  );
  toolResult.result.display_summary = 'Loaded project file contents: secret-marker';
  assert.throws(
    () => assertReadEvidence(forgedSummary),
    (error) => error.code === 'canary_evidence_failed',
  );

  const postTerminalSteering = bridgeEvidence(projectId, true, 1, 1, 0);
  const completedIndex = postTerminalSteering.task_stream.conversation.items.findIndex(
    (item) => item.item_kind === 'run_completed',
  );
  const completed = postTerminalSteering.task_stream.conversation.items[completedIndex];
  replaceTaskStreamItems(postTerminalSteering, [
    ...postTerminalSteering.task_stream.conversation.items.slice(0, completedIndex + 1),
    {
      item_kind: 'user_message',
      sequence: 0,
      turn_id: completed.turn_id,
      message: {
        message_id: 'builder-message:21212121-2121-4121-8121-212121212121',
        text: 'This should not steer finished work.',
      },
      message_kind: 'steering',
      mode: null,
      task: null,
    },
    ...postTerminalSteering.task_stream.conversation.items.slice(completedIndex + 1),
  ]);
  assert.throws(
    () => assertReadEvidence(postTerminalSteering),
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

  const forgedCheckRun = bridgeEvidence(projectId);
  forgedCheckRun.bridge_contract.check_run_namespace = 'script_and_output_methods';
  assert.throws(
    () => assertReadEvidence(forgedCheckRun),
    (error) => error.code === 'canary_evidence_failed',
  );

  const forgedLivePreview = bridgeEvidence(projectId);
  forgedLivePreview.bridge_contract.live_preview_namespace = 'source_tree_and_control_methods';
  assert.throws(
    () => assertReadEvidence(forgedLivePreview),
    (error) => error.code === 'canary_evidence_failed',
  );

  const forgedProviderContextDisclosureApproval = bridgeEvidence(projectId);
  forgedProviderContextDisclosureApproval
    .bridge_contract.provider_context_disclosure_approval_namespace = 'approve_and_read_request';
  assert.throws(
    () => assertReadEvidence(forgedProviderContextDisclosureApproval),
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

test('captures chat-flow preview evidence without relying on the retired preview tab', async () => {
  const page = new FakePage();
  const gate = createArtifactGate();
  gate.allow();
  page.artifactsAllowed = true;

  const evidence = await capturePreviewEvidence(page, gate);

  assert.equal(evidence.preview_mode, 'static_frame');
  assert.equal(evidence.sandbox, 'empty');
  assert.equal(evidence.script_src, 'none');
  assert.equal(evidence.frame_body_nonempty, true);
  assert.equal(evidence.static_preview_limitation_visible, true);
  assert.equal(evidence.runtime_preview_limit_explained, true);
  const previewWait = page.events.findIndex((event) => (
    event[0] === 'waitFor' && event[1] === SELECTORS.preview
  ));
  const limitationWait = page.events.findIndex((event) => (
    event[0] === 'waitFor' && event[1] === SELECTORS.previewLimitation
  ));
  const limitationText = page.events.findIndex((event) => (
    event[0] === 'textContent' && event[1] === SELECTORS.previewLimitation
  ));
  const frameWait = page.events.findIndex((event) => (
    event[0] === 'waitFor' && event[1] === SELECTORS.previewFrame
  ));
  assert.equal(previewWait >= 0, true);
  assert.equal(limitationWait > previewWait, true);
  assert.equal(limitationText > limitationWait, true);
  assert.equal(frameWait > limitationText, true);
  assert.equal(page.events.some((event) => event[0] === 'click'), false);

  page.previewLimitationTextOverride = 'Static preview only';
  await assert.rejects(
    capturePreviewEvidence(page, gate),
    (error) => error.code === 'canary_preview_limitation_text_failed'
      && error.stage === 'preview_limitation_text',
  );
});

test('captures artifact static preview evidence when the repeated limitation notice is omitted', async () => {
  const page = new FakePage();
  const gate = createArtifactGate();
  gate.allow();
  page.artifactsAllowed = true;
  page.previewLimitationVisible = false;

  const evidence = await capturePreviewEvidence(page, gate);

  assert.equal(evidence.preview_mode, 'static_frame');
  assert.equal(evidence.static_preview_mode_visible, true);
  assert.equal(evidence.static_preview_limitation_visible, false);
  assert.equal(evidence.runtime_preview_limit_explained, false);
  assert.equal(
    page.events.some((event) => event[0] === 'textContent' && event[1] === SELECTORS.preview),
    true,
  );
  assert.equal(
    page.events.some((event) => event[0] === 'waitFor' && event[1] === SELECTORS.previewLimitation),
    false,
  );

  page.previewTextOverride = 'Focus timer';
  await assert.rejects(
    capturePreviewEvidence(page, gate),
    (error) => error.code === 'canary_preview_limitation_text_failed'
      && error.stage === 'preview_limitation_text',
  );
});

test('retries preview iframe body capture when the srcdoc frame is not ready yet', async () => {
  const page = new FakePage();
  const gate = createArtifactGate();
  gate.allow();
  page.artifactsAllowed = true;
  page.previewFrameBodyFailuresRemaining = 1;

  const evidence = await capturePreviewEvidence(page, gate);

  assert.equal(evidence.preview_mode, 'static_frame');
  assert.equal(evidence.frame_body_nonempty, true);
  assert.equal(
    page.events.some((event) => event[0] === 'waitForTimeout' && event[1] === 100),
    true,
  );
  assert.equal(
    page.events.filter((event) => event[0] === 'frameInnerText' && event[1] === 'body').length,
    2,
  );
});

test('opens preview through public artifact workspace controls before capture', async () => {
  const page = new FakePage();
  const gate = createArtifactGate();
  gate.allow();
  page.artifactsAllowed = true;
  page.previewVisible = false;
  page.failClicks.add(SELECTORS.artifactTabPreview);
  page.failClicks.add(SELECTORS.previewOpenArtifact);

  const evidence = await capturePreviewEvidence(page, gate);

  assert.equal(evidence.preview_mode, 'static_frame');
  assert.deepEqual(
    page.events.filter((event) => event[0] === 'click').map((event) => event[1]),
    [
      SELECTORS.previewOpenArtifact,
      SELECTORS.artifactViewButton,
      SELECTORS.artifactTabPreview,
      SELECTORS.workspaceMenuButton,
      SELECTORS.workspaceControlPreview,
    ],
  );
});

test('reports fixed preview substages without exposing preview text', async () => {
  const gate = createArtifactGate();
  gate.allow();

  const missingSurface = new FakePage();
  missingSurface.artifactsAllowed = true;
  missingSurface.failWaitFor.add(SELECTORS.preview);
  await assert.rejects(
    capturePreviewEvidence(missingSurface, gate),
    (error) => error.code === 'canary_preview_surface_failed'
      && error.stage === 'preview_surface'
      && error.diagnostic?.diagnostic_version === 'builder-canary-preview-surface-diagnostic.v1'
      && error.diagnostic.selectors.preview_surface.visible === false
      && error.diagnostic.selectors.preview_unavailable.count === 0
      && !String(error.message).includes('secret-marker')
      && !JSON.stringify(error.diagnostic).includes('secret-marker'),
  );

  const runtimeText = new FakePage();
  runtimeText.artifactsAllowed = true;
  runtimeText.previewRuntimeBlocked = true;
  runtimeText.previewLimitationTextOverride = 'Preview unavailable here secret-marker';
  await assert.rejects(
    capturePreviewEvidence(runtimeText, gate),
    (error) => error.code === 'canary_preview_runtime_text_failed'
      && error.stage === 'preview_runtime_text'
      && !String(error.message).includes('secret-marker'),
  );

  const frameContract = new FakePage();
  frameContract.artifactsAllowed = true;
  frameContract.failPreviewAttributes = true;
  await assert.rejects(
    capturePreviewEvidence(frameContract, gate),
    (error) => error.code === 'canary_preview_frame_contract_failed'
      && error.stage === 'preview_frame_contract',
  );

  const emptyFrame = new FakePage();
  emptyFrame.artifactsAllowed = true;
  emptyFrame.previewFrameBodyTextOverride = '   ';
  await assert.rejects(
    capturePreviewEvidence(emptyFrame, gate),
    (error) => error.code === 'canary_preview_frame_body_failed'
      && error.stage === 'preview_frame_body',
  );

  const blankPreview = new FakePage();
  blankPreview.artifactsAllowed = true;
  blankPreview.screenshotBufferOverride = blankPngFixture();
  await assert.rejects(
    capturePreviewEvidence(blankPreview, gate),
    (error) => error.code === 'canary_preview_pixels_failed'
      && error.stage === 'preview_pixels',
  );

  const unavailableText = new FakePage();
  unavailableText.artifactsAllowed = true;
  unavailableText.previewUnavailable = true;
  unavailableText.previewUnavailableTextOverride = 'Preview unavailable secret-marker';
  await assert.rejects(
    capturePreviewEvidence(unavailableText, gate),
    (error) => error.code === 'canary_preview_unavailable_text_failed'
      && error.stage === 'preview_unavailable_text'
      && !String(error.message).includes('secret-marker'),
  );

  const unavailablePixels = new FakePage();
  unavailablePixels.artifactsAllowed = true;
  unavailablePixels.previewUnavailable = true;
  unavailablePixels.screenshotBufferOverride = blankPngFixture();
  await assert.rejects(
    capturePreviewEvidence(unavailablePixels, gate),
    (error) => error.code === 'canary_preview_unavailable_pixels_failed'
      && error.stage === 'preview_unavailable_pixels',
  );
});

test('captures runtime-unavailable preview evidence without claiming a rendered iframe', async () => {
  const page = new FakePage();
  const gate = createArtifactGate();
  gate.allow();
  page.artifactsAllowed = true;
  page.previewRuntimeBlocked = true;
  page.previewLimitationTextOverride = [
    'Preview unavailable here',
    'The files were generated, but this draft needs live preview support before it can be shown here.',
    'Review Changes or Source before saving.',
    'It uses JavaScript modules, so the visible result may be incomplete here.',
  ].join(' ');

  const evidence = await capturePreviewEvidence(page, gate);

  assert.equal(evidence.preview_mode, 'runtime_unavailable');
  assert.equal(evidence.sandbox, 'not_mounted');
  assert.equal(evidence.script_src, 'none');
  assert.equal(evidence.frame_body_nonempty, false);
  assert.equal(evidence.static_preview_limitation_visible, true);
  assert.equal(evidence.runtime_preview_limit_explained, true);
  assert.equal(
    page.events.some((event) => event[0] === 'waitFor' && event[1] === SELECTORS.previewFrame),
    false,
  );
});

test('captures preview-unavailable evidence as a terminal explained preview state', async () => {
  const page = new FakePage();
  const gate = createArtifactGate();
  gate.allow();
  page.artifactsAllowed = true;
  page.previewUnavailable = true;

  const evidence = await capturePreviewEvidence(page, gate);

  assert.equal(evidence.preview_mode, 'preview_unavailable');
  assert.equal(evidence.sandbox, 'not_mounted');
  assert.equal(evidence.script_src, 'none');
  assert.equal(evidence.frame_body_nonempty, false);
  assert.equal(evidence.static_preview_limitation_visible, true);
  assert.equal(evidence.runtime_preview_limit_explained, true);
  assert.equal(
    page.events.some((event) => event[0] === 'waitFor' && event[1] === SELECTORS.previewFrame),
    false,
  );
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

  const projectRootPath = path.join(userDataPath, PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY);
  const launchEnv = sanitizeLaunchEnvironment(env, userDataPath, projectRootPath);
  assert.deepEqual(Object.keys(launchEnv).sort(), [
    'BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH',
    'BUILDER_PACKAGED_CANARY',
    'BUILDER_PACKAGED_CANARY_USER_DATA_PATH',
    'PATH',
    'SystemRoot',
  ].sort());
  assert.equal(getterCalls, 0);
  assert.equal(Object.hasOwn(launchEnv, 'JWT_SECRET'), false);
  assert.equal(launchEnv[PACKAGED_CANARY_PROJECT_ROOT_PATH], projectRootPath);

  const identity = captureGuardedUserDataRoot(userDataPath, fsModule, osModule);
  assert.equal(identity.path, userDataPath);
  assert.equal(createCanaryProjectRoot(identity, fsModule, osModule), projectRootPath);
  assert.equal(state.stats.has(projectRootPath), true);
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
      live_output: liveOutputEvidence(),
      pre_save_catalog_empty: true,
      review_diff: reviewDiffEvidence(),
      saved_via_ui: true,
      unsaved_draft_observed: true,
      workspace_gate: workspaceGateEvidence(),
    },
    restart_continuation: {
      approved_plan_continued: true,
      approved_plan_task_stream_verified: true,
      composer_status_text: 'Ready to execute current direction',
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
      live_output: liveOutputEvidence(),
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
  assert.deepEqual(result.plan, {
    restart_continuation: {
      approve_plan_visible: true,
      composer_status_text: 'Needs confirmation',
      plan_review_actions_visible: true,
      saved_revision_unchanged: true,
      task_stream: {
        answer_count: 0,
        accepted_review_count: 2,
        candidate_ready_count: 2,
        candidate_reviewed_count: 2,
        candidate_result_count: 2,
        explanation_result_count: 0,
        head_sequence: 16,
        item_count: 16,
        latest_plan_review: 'pending',
        plan_approved_count: 0,
        plan_ready_count: 1,
        plan_rejected_count: 0,
        plan_result_count: 1,
        plan_reviewed_count: 0,
        revision_unchanged: true,
        run_progress_count: 0,
        tool_request_count: 1,
        tool_result_count: 1,
        tool_result_succeeded_count: 1,
      },
      tool_activity_visible: true,
    },
  });
  assert.deepEqual(result.question, {
    initial_chat: {
      answer_failure_notice_absent: true,
      catalog_remained_empty: true,
      no_draft_created: true,
      no_workspace_required: true,
      ui_answer_observed: true,
      visible_answer_count: 1,
    },
    initial_chat_followup: {
      answer_failure_notice_absent: true,
      catalog_remained_empty: true,
      no_draft_created: true,
      no_workspace_required: true,
      ui_answer_observed: true,
      visible_answer_count: 2,
    },
    saved_project_context_chat: 'skipped_until_provider_context_prompt_bridge',
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
      run_progress_count: 0,
      source_availability: 'not_loaded',
      tool_request_count: 0,
      tool_result_count: 0,
    },
    pending_update: {
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
      run_progress_count: 0,
      saved_revision_number: 1,
      source_availability: 'not_loaded',
      tool_request_count: 0,
      tool_result_count: 0,
    },
    pending_update_restart: {
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
      run_progress_count: 0,
      saved_revision_number: 1,
      source_availability: 'not_loaded',
      tool_request_count: 0,
      tool_result_count: 0,
    },
    updated: {
      answer_count: 0,
      accepted_review_count: 2,
      candidate_ready_count: 2,
      candidate_reviewed_count: 2,
      candidate_result_count: 2,
      explanation_result_count: 0,
      head_sequence: 10,
      item_count: 10,
      latest_candidate_bound_to_revision: true,
      latest_candidate_review: 'accepted',
      latest_saved_revision_number: 2,
      run_progress_count: 0,
      source_availability: 'not_loaded',
      tool_request_count: 0,
      tool_result_count: 0,
    },
    restart: {
      answer_count: 0,
      accepted_review_count: 2,
      candidate_ready_count: 2,
      candidate_reviewed_count: 2,
      candidate_result_count: 2,
      explanation_result_count: 0,
      head_sequence: 10,
      item_count: 10,
      latest_candidate_bound_to_revision: true,
      latest_candidate_review: 'accepted',
      latest_saved_revision_number: 2,
      run_progress_count: 0,
      source_availability: 'not_loaded',
      tool_request_count: 0,
      tool_result_count: 0,
    },
    restart_continuation: {
      answer_count: 0,
      accepted_review_count: 2,
      candidate_ready_count: 3,
      candidate_reviewed_count: 2,
      candidate_result_count: 3,
      explanation_result_count: 0,
      head_sequence: 23,
      item_count: 23,
      latest_candidate_review: 'pending',
      latest_candidate_distinct_from_saved_revision: true,
      latest_plan_review: 'approved',
      plan_approved_count: 1,
      plan_ready_count: 1,
      plan_rejected_count: 0,
      plan_result_count: 1,
      plan_reviewed_count: 1,
      programming_run_admitted_count: 1,
      run_progress_count: 0,
      saved_revision_number: 2,
      source_availability: 'not_loaded',
      tool_request_count: 1,
      tool_result_count: 1,
      tool_result_succeeded_count: 1,
    },
    saved_project_context_chat_deferred_until_prompt_bridge: true,
    pending_update_advanced_candidate_count: true,
    pending_update_restart_unchanged: true,
    restart_continuation_advanced_candidate_count: true,
    restart_unchanged: true,
    update_advanced_candidate_count: true,
  });
  assert.equal(JSON.stringify(result).includes(parsed.provider.credential), false);
  assert.equal(JSON.stringify(result).includes(parsed.provider.model), false);
  assert.equal(JSON.stringify(result).includes(parsed.provider.base_url), false);
  assert.equal(JSON.stringify(result).includes(parsed.executable_path), false);
  assert.equal(JSON.stringify(result).includes(CANARY_INITIAL_CHAT_QUESTION), false);
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
    'initial_chat_question_digest',
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
    assert.equal(
      launch.env.BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH,
      path.join(userDataPath, PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY),
    );
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
    initial_chat_question_digest: result.input.initial_chat_question_digest,
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
  assert.equal(result.plan.restart_continuation.plan_review_actions_visible, true);
  assert.equal(result.plan.restart_continuation.tool_activity_visible, true);
  assert.equal(result.plan.restart_continuation.task_stream.plan_ready_count, 1);
  assert.equal(result.question.initial_chat.no_draft_created, true);
  assert.equal(result.question.initial_chat.no_workspace_required, true);
  assert.equal(result.question.initial_chat_followup.visible_answer_count, 2);
  assert.equal(result.question.saved_project_context_chat, 'skipped_until_provider_context_prompt_bridge');
  assert.equal(result.task_stream.saved_project_context_chat_deferred_until_prompt_bridge, true);
  assert.equal(result.task_stream.pending_update_restart_unchanged, true);
  assert.equal(result.task_stream.updated.candidate_ready_count, 2);
  assert.equal(result.task_stream.updated.answer_count, 0);
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
    'Send',
    'Send',
    'New project',
    'Send',
    'Back to current',
    'Send',
    'Approve plan',
  ]);
  const selectorClicks = electron.pages
    .flatMap((candidate) => candidate.events)
    .filter((event) => event[0] === 'click')
    .map((event) => event[1]);
  assert.ok(selectorClicks.includes(SELECTORS.composerAddMenuButton));
  assert.ok(selectorClicks.includes(SELECTORS.composerAddPlanMode));
  assert.equal(
    electron.pages
      .flatMap((candidate) => candidate.events)
      .filter((event) => event[0] === 'click' && event[1] === SELECTORS.saveVersion).length,
    2,
  );
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
  for (const launch of electron.launches) {
    assert.equal(
      launch.env.BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH,
      path.join(userDataPath, PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY),
    );
  }
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

test('default packaged canary uses a local OpenAI-compatible provider mock', async (t) => {
  const server = await createLocalCanaryProviderServer();
  t.after(async () => {
    await server.close();
  });
  async function request(system, stream = false) {
    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Canary request.' },
        ],
        model: 'local-canary-model',
        stream,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(response.status, 200);
    return response.text();
  }
  async function outputContractRequest(kind) {
    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Return JSON.' },
          {
            role: 'user',
            content: JSON.stringify({
              instruction: 'Canary request.',
              output_contract: { kind },
            }),
          },
        ],
        model: 'local-canary-model',
        stream: false,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(response.status, 200);
    return JSON.parse(JSON.parse(await response.text()).choices[0].message.content);
  }
  async function repairRequest(kind) {
    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Return JSON.' },
          { role: 'user', content: 'Canary request.' },
          { role: 'user', content: `The previous response was invalid. Set kind to ${kind}.` },
        ],
        model: 'local-canary-model',
        stream: false,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(response.status, 200);
    return JSON.parse(JSON.parse(await response.text()).choices[0].message.content);
  }
  async function semanticRouteRequest(instruction) {
    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Return builder_semantic_route_classification.' },
          {
            role: 'user',
            content: JSON.stringify({ instruction, product_state: { has_workspace: true } }),
          },
        ],
        model: 'local-canary-model',
        stream: false,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(response.status, 200);
    return JSON.parse(JSON.parse(await response.text()).choices[0].message.content);
  }
  const explanation = JSON.parse(JSON.parse(await request('builder_conversation_explanation')).choices[0].message.content);
  assert.equal(explanation.kind, 'builder_conversation_explanation');
  const plan = JSON.parse(JSON.parse(await request('builder_project_plan_proposal')).choices[0].message.content);
  assert.equal(plan.kind, 'builder_project_plan_proposal');
  assert.equal(
    (await outputContractRequest('builder_conversation_explanation')).kind,
    'builder_conversation_explanation',
  );
  assert.equal(
    (await outputContractRequest('builder_project_plan_proposal')).kind,
    'builder_project_plan_proposal',
  );
  assert.equal(
    (await outputContractRequest('builder_code_change_operations')).kind,
    'builder_code_change_operations',
  );
  assert.equal(
    (await repairRequest('builder_conversation_explanation')).kind,
    'builder_conversation_explanation',
  );
  assert.equal(
    (await semanticRouteRequest('帮我做一个静态技术博客实施计划')).route,
    'plan',
  );
  assert.equal(
    (await semanticRouteRequest('做一个计划管理页面')).route,
    'build',
  );
  const firstCode = JSON.parse(JSON.parse(await request('builder_code_change_operations')).choices[0].message.content);
  const secondCodeStream = await request('builder_code_change_operations', true);
  assert.equal(firstCode.kind, 'builder_code_change_operations');
  assert.match(secondCodeStream, /text-event-stream|data:/u);
  assert.match(secondCodeStream, /Focus Timer Complete/u);
});

test('script source keeps credential out of argv/env/output and cannot enter ASAR authority', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const defaultSource = fs.readFileSync(DEFAULT_SOURCE_PATH, 'utf8');
  const planModeSource = fs.readFileSync(PLAN_MODE_SOURCE_PATH, 'utf8');
  const preloadSource = fs.readFileSync(PRELOAD_SOURCE_PATH, 'utf8');
  assert.match(source, /require\(['"]playwright-core['"]\)/u);
  assert.doesNotMatch(source, /require\(['"]playwright['"]\)/u);
  assert.doesNotMatch(source, /permissions\.evaluate|providerSettings\.replaceCurrent|codeGenerator\.(?:submit|generate|continueDraft|generateApprovedPlan|proposePlan|preparePlanSourceReadApproval|approvePlanSourceRead|prepareCurrentProjectWriteApproval|approveCurrentProjectWrite|retry|answer|answerDraft|restoreRevisionAsDraft|rejectDraft|steer|queueFollowup)|projectWorkspace\.(?:saveDraft|createLocalProject)/u);
  assert.doesNotMatch(source, /generator\.proposePlan/u);
  assert.doesNotMatch(source, /bridge\.projectCatalog|bridge\.projectRevisions/u);
  assert.doesNotMatch(source, /builder-project-catalog-result\.v1|builder-project-repository-result\.v1/u);
  assert.match(source, /clickByRole\(page,\s*['"]button['"],\s*['"]Save provider['"]\)/u);
  assert.match(source, /clickByRole\(page,\s*['"]button['"],\s*['"]Back to project['"]\)/u);
  assert.match(source, /clickByRole\(page,\s*['"]button['"],\s*['"]Send['"]\)/u);
  assert.match(source, /node\.scrollIntoView\(\{\s*block:\s*['"]center['"],\s*inline:\s*['"]nearest['"]\s*\}\)/u);
  assert.match(source, /page\.locator\(SELECTORS\.saveVersion\)/u);
  assert.match(source, /clickByRole\(page,\s*['"]button['"],\s*['"]Back to current['"]\)/u);
  assert.match(source, /getByRole\(role,\s*\{\s*exact:\s*true,\s*name\s*\}\)/u);
  assert.match(source, /versionSavedActivity\)\.filter\(\{\s*hasText:\s*expectedBody\s*\}\)/u);
  assert.match(source, new RegExp(CANARY_RESULT_VERSION.replaceAll('.', String.raw`\.`), 'u'));
  assert.match(source, /run_progress_recorded/u);
  assert.match(source, /tool_call_requested/u);
  assert.match(source, /tool_call_result_recorded/u);
  assert.match(source, /inspectDraftReviewDiffViaUi/u);
  assert.match(source, /data-builder-preview-limitation/u);
  assert.doesNotMatch(source, /previewTab|builder-tool-tab-preview/u);
  assert.match(source, /data-builder-change-diff-line-kind/u);
  assert.match(source, /canary_review_diff_failed/u);
  assert.match(source, /restart_continuation_instruction_digest/u);
  assert.match(source, /restart_continuation_advanced_candidate_count/u);
  assert.match(source, /historical_preview_matches_saved_version/u);
  assert.match(source, /artifacts_after_password_clear/u);
  assert.match(defaultSource, /createLocalCanaryProviderServer/u);
  assert.match(defaultSource, /127\.0\.0\.1/u);
  assert.doesNotMatch(defaultSource, /provider\.example|real-key-value-secret/u);
  assert.match(planModeSource, /approvePlanAndWaitForDraft/u);
  assert.match(planModeSource, /verifyNaturalLanguagePlanAndReject/u);
  assert.match(planModeSource, /builder_semantic_route_classification/u);
  assert.match(planModeSource, /semantic_plan_rejected:\s*true/u);
  assert.match(planModeSource, /clickByRole\(page,\s*['"]button['"],\s*['"]Approve plan['"]\)/u);
  assert.match(planModeSource, /approveCurrentProjectWriteIfRequested/u);
  assert.match(planModeSource, /SELECTORS\.unsavedDraft/u);
  assert.match(planModeSource, /SELECTORS\.saveVersion/u);
  assert.match(planModeSource, /approved_plan_executed:\s*true/u);
  assert.match(planModeSource, /provider_code_change_request_observed:\s*true/u);
  assert.doesNotMatch(planModeSource, /page\.locator\(SELECTORS\.saveVersion\)\.click/u);
  assert.match(preloadSource, /bridgeVersion:\s*['"]builder-preload\.v26['"]/u);
  assert.match(preloadSource, /projectWorkspace:\s*Object\.freeze/u);
  assert.match(preloadSource, /openLocation/u);
  assert.match(preloadSource, /project-workspace:open-location/u);
  assert.match(preloadSource, /preparePlanSourceReadApproval/u);
  assert.match(preloadSource, /approvePlanSourceRead/u);
  assert.match(preloadSource, /providerContextDisclosureApproval/u);
  assert.match(preloadSource, /provider-context-disclosure:approve-current/u);
  assert.match(preloadSource, /checkRun:\s*Object\.freeze/u);
  assert.match(preloadSource, /readCurrentDraftAvailableChecks\(request\)/u);
  assert.match(preloadSource, /approveAndRunCurrentDraftCheck\(request\)/u);
  assert.match(preloadSource, /skipCurrentDraftCheck\(request\)/u);
  assert.match(preloadSource, /check-run:read-current-draft-available/u);
  assert.match(preloadSource, /check-run:approve-current-draft-check/u);
  assert.match(preloadSource, /check-run:skip-current-draft-check/u);
  assert.match(preloadSource, /livePreview:\s*Object\.freeze/u);
  assert.match(preloadSource, /requestCurrentDraftPreview\(request\)/u);
  assert.match(preloadSource, /live-preview:request-current-draft/u);
  assert.match(preloadSource, /reloadCurrentPreview\(request\)/u);
  assert.match(preloadSource, /live-preview:reload-current/u);
  assert.match(preloadSource, /stopCurrentPreview\(request\)/u);
  assert.match(preloadSource, /live-preview:stop-current/u);
  assert.match(preloadSource, /readCurrentPreviewStatus\(request\)/u);
  assert.match(preloadSource, /live-preview:read-current-status/u);
  assert.doesNotMatch(preloadSource, /source_tree|sourceTree|entry_url|preview_origin/u);
  assert.match(preloadSource, /prepareCurrentProjectWriteApproval/u);
  assert.match(preloadSource, /approveCurrentProjectWrite/u);
  assert.match(preloadSource, /code-generator:prepare-plan-source-read-approval/u);
  assert.match(preloadSource, /code-generator:approve-plan-source-read/u);
  assert.match(preloadSource, /code-generator:prepare-current-project-write-approval/u);
  assert.match(preloadSource, /code-generator:approve-current-project-write/u);
  assert.match(preloadSource, /answerDraft/u);
  assert.match(preloadSource, /code-generator:answer-draft/u);
  assert.match(preloadSource, /planReview:\s*Object\.freeze/u);
  assert.match(source, /plan_review_namespace/u);
  assert.match(source, /review_method_only/u);
  assert.match(source, /check_run_namespace/u);
  assert.match(source, /current_draft_identity_methods_only/u);
  assert.match(source, /live_preview_namespace/u);
  assert.match(source, /current_preview_control_methods_only/u);
  assert.doesNotMatch(preloadSource, /projectRevisions|projectCatalog/u);
});
