// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBuilderProjectController } from '../application/builderProjectController';
import { createBuilderConversationController } from '../application/builderConversationController';
import { createBuilderProjectHistoryController } from '../application/builderProjectHistoryController';
import { BuilderGenerationDiagnosticError } from '../application/builderPorts';
import { BuilderPage } from './BuilderPage';
import {
  DRAFT_ID,
  PROJECT_ID,
  createAcceptedTaskStreamWire,
  createAnswerTaskStreamWire,
  createGenerationAnswer,
  createGenerationDraft,
  createHistoryWire,
  createPlanTaskStreamWire,
  createPlanReviewTaskStreamWire,
  createReadWire,
  createRejectedTaskStreamWire,
  createSaveResult,
  createSourceTree,
  createTaskStreamWire,
  digest,
} from '../../../test/builderV2Fixtures';
import { createBuilderGenerationRequest } from '../application/builderGeneration';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function render(element: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  act(() => root.render(element));
  return container;
}

async function snapshots() {
  const readWire = await createReadWire();
  let draft = await createGenerationDraft();
  const controller = createBuilderProjectController({
    generator: {
      async generate(request) {
        draft = await createGenerationDraft(request, readWire.source_tree);
        return draft;
      },
      async retry(request) {
        draft = await createGenerationDraft(request, readWire.source_tree);
        return draft;
      },
      async answer(request) {
        return createGenerationAnswer(request);
      },
      async restoreDraft() {
        return draft;
      },
      async rejectDraft(request) {
        return {
          result_version: 'builder-generation-draft-rejection-result.v1',
          draft_id: request.draft_id,
          project_id: PROJECT_ID,
          rejected: true,
          pending_draft_released: true,
          conversation_event_admission: 'sqlite_recorded',
        };
      },
      async cancel(request) {
        return { request_id: request.request_id, cancelled: true };
      },
    },
    workspace: {
      async open(request) {
        return request.project_id === null
          ? {
            result_version: 'builder-project-selection-result.v1',
            operation: 'new_selected',
            project_id: null,
          }
          : readWire;
      },
      async saveDraft() {
        return createSaveResult(draft, readWire);
      },
      async loadCurrent() {
        return readWire;
      },
      async loadRevision() {
        return { ...readWire, operation: 'revision_loaded' };
      },
      async listCurrent() {
        return { projects: [] };
      },
      async listHistory() {
        return { revisions: [] };
      },
    },
  });
  const fresh = controller.getSnapshot();
  const saved = await controller.open(PROJECT_ID);
  const draftReady = await controller.generate('Add a timer.');
  return { draftReady, fresh, saved };
}

async function candidateActivity(rejected = false) {
  const controller = createBuilderConversationController({
    read: async () => (rejected ? createRejectedTaskStreamWire() : createTaskStreamWire()),
  });
  return controller.load(PROJECT_ID);
}

async function answerActivity() {
  const controller = createBuilderConversationController({
    read: async () => createAnswerTaskStreamWire(),
  });
  return controller.load(PROJECT_ID);
}

async function acceptedCandidateActivity() {
  const controller = createBuilderConversationController({
    read: async () => createAcceptedTaskStreamWire(1),
  });
  return controller.load(PROJECT_ID);
}

async function planReviewActivity(decision: 'approved' | 'rejected' = 'approved') {
  const controller = createBuilderConversationController({
    read: async () => createPlanReviewTaskStreamWire(decision),
  });
  return controller.load(PROJECT_ID);
}

async function pendingPlanActivity() {
  const controller = createBuilderConversationController({
    read: async () => createPlanTaskStreamWire(),
  });
  return controller.load(PROJECT_ID);
}

async function savedHistory() {
  const controller = createBuilderProjectHistoryController({
    listHistory: async () => createHistoryWire(PROJECT_ID, 1),
  });
  return controller.load(PROJECT_ID);
}

type ReadWire = Awaited<ReturnType<typeof createReadWire>>;
type SourceTree = Awaited<ReturnType<typeof createSourceTree>>;

async function readWireAsRevision(
  wire: ReadWire,
  revisionNumber: number,
  previousRevisionReceiptDigest: string | null,
): Promise<ReadWire> {
  const unsignedReceipt = {
    ...wire.product_revision_receipt,
    revision_number: revisionNumber,
    previous_revision_receipt_digest: previousRevisionReceiptDigest,
  };
  const receiptBody = { ...unsignedReceipt };
  delete (receiptBody as { revision_receipt_digest?: string }).revision_receipt_digest;
  const revisionReceiptDigest = await digest(receiptBody);
  return {
    ...wire,
    product_revision_receipt: {
      ...unsignedReceipt,
      revision_receipt_digest: revisionReceiptDigest,
    },
    current: {
      ...wire.current,
      revision_number: revisionNumber,
      revision_receipt_digest: revisionReceiptDigest,
    },
  } as unknown as ReadWire;
}

async function changedDraftSnapshot() {
  const baseTree = await createSourceTree([
    { path: 'index.html', content: '<main>Old</main>\n' },
    { path: 'styles.css', content: 'main { color: black; }\n' },
    { path: 'src/remove.ts', content: 'const removed = true;\n' },
  ]);
  const draftTree = await createSourceTree([
    { path: 'index.html', content: '<main>New</main>\n<section>Detail</section>\n' },
    { path: 'styles.css', content: 'main { color: black; }\n' },
    { path: 'src/add.ts', content: 'const added = true;\n' },
  ]);
  return draftSnapshotFromSourceTrees(baseTree, draftTree);
}

async function draftSnapshotFromSourceTrees(baseTree: SourceTree, draftTree: SourceTree) {
  const readWire = await createReadWire(baseTree);
  const request = await createBuilderGenerationRequest('Update the saved project.', PROJECT_ID);
  const rawDraft = await createGenerationDraft(request, draftTree);
  const draft = {
    ...rawDraft,
    base_revision_evidence: {
      ...rawDraft.base_revision_evidence!,
      revision_receipt_digest: readWire.product_revision_receipt.revision_receipt_digest,
      commit_oid: readWire.product_revision_receipt.commit_oid,
      source_tree_digest: baseTree.source_tree_digest,
    },
  };
  const controller = createBuilderProjectController({
    generator: {
      async generate() {
        return draft;
      },
      async retry() {
        return draft;
      },
      async answer() {
        return createGenerationAnswer(request);
      },
      async restoreDraft() {
        return draft;
      },
      async rejectDraft(request) {
        return {
          result_version: 'builder-generation-draft-rejection-result.v1',
          draft_id: request.draft_id,
          project_id: PROJECT_ID,
          rejected: true,
          pending_draft_released: true,
          conversation_event_admission: 'sqlite_recorded',
        };
      },
      async cancel(cancelRequest) {
        return { request_id: cancelRequest.request_id, cancelled: true };
      },
    },
    workspace: {
      async open() {
        return readWire;
      },
      async saveDraft() {
        return createSaveResult(draft, readWire);
      },
      async loadCurrent() {
        return readWire;
      },
      async loadRevision() {
        return { ...readWire, operation: 'revision_loaded' };
      },
      async listCurrent() {
        return { projects: [] };
      },
      async listHistory() {
        return { revisions: [] };
      },
    },
  });
  await controller.open(PROJECT_ID);
  return controller.generate('Update the saved project.');
}

async function inspectedHistorySnapshot() {
  const currentTree = await createSourceTree([
    { path: 'index.html', content: '<main>Current</main>\n' },
  ]);
  const historicalTree = await createSourceTree([
    { path: 'index.html', content: '<main>Earlier</main>\n' },
  ]);
  const historicalWire = await createReadWire(historicalTree, 1);
  const currentWire = await readWireAsRevision(
    await createReadWire(currentTree, 1),
    2,
    historicalWire.product_revision_receipt.revision_receipt_digest,
  );
  const controller = createBuilderProjectController({
    generator: {
      async generate(request) {
        return createGenerationDraft(request, currentTree);
      },
      async retry(request) {
        return createGenerationDraft(request, currentTree);
      },
      async answer(request) {
        return createGenerationAnswer(request);
      },
      async restoreDraft() {
        return createGenerationDraft(
          await createBuilderGenerationRequest('Restore.', PROJECT_ID),
          currentTree,
        );
      },
      async rejectDraft(request) {
        return {
          result_version: 'builder-generation-draft-rejection-result.v1',
          draft_id: request.draft_id,
          project_id: PROJECT_ID,
          rejected: true,
          pending_draft_released: true,
          conversation_event_admission: 'sqlite_recorded',
        };
      },
      async cancel(request) {
        return { request_id: request.request_id, cancelled: true };
      },
    },
    workspace: {
      async open() {
        return currentWire;
      },
      async saveDraft() {
        throw new Error('not used');
      },
      async loadCurrent() {
        return currentWire;
      },
      async loadRevision() {
        return {
          ...historicalWire,
          current: currentWire.current,
          operation: 'revision_loaded',
        };
      },
      async listCurrent() {
        return { projects: [] };
      },
      async listHistory() {
        return { revisions: [] };
      },
    },
  });
  await controller.open(PROJECT_ID);
  return controller.inspectRevision(
    PROJECT_ID,
    historicalWire.product_revision_receipt.revision_receipt_digest,
  );
}

function click(container: HTMLElement, selector: string): void {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  act(() => button?.click());
}

function keyDown(
  container: HTMLElement,
  selector: string,
  init: KeyboardEventInit,
): KeyboardEvent {
  const target = container.querySelector<HTMLElement>(selector);
  expect(target).not.toBeNull();
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target?.dispatchEvent(event);
  });
  return event;
}

function installScrollIntoViewSpy() {
  const prototype = HTMLElement.prototype as HTMLElement & {
    scrollIntoView?: HTMLElement['scrollIntoView'];
  };
  const hadOwnProperty = Object.hasOwn(prototype, 'scrollIntoView');
  const original = prototype.scrollIntoView;
  const spy = vi.fn();
  Object.defineProperty(prototype, 'scrollIntoView', {
    configurable: true,
    value: spy,
  });
  return {
    spy,
    restore() {
      if (hadOwnProperty) {
        Object.defineProperty(prototype, 'scrollIntoView', {
          configurable: true,
          value: original,
        });
        return;
      }
      Reflect.deleteProperty(prototype, 'scrollIntoView');
    },
  };
}

function setScrollMetrics(
  element: HTMLElement,
  metrics: Readonly<{ clientHeight: number; scrollHeight: number; scrollTop: number }>,
): void {
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    value: metrics.scrollTop,
    writable: true,
  });
}

describe('BuilderPage v2', () => {
  it('renders a continuous composer without pretending a new project is saved', async () => {
    const { fresh } = await snapshots();
    const onAnswer = vi.fn();
    const onGenerate = vi.fn();
    const onInstructionChange = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onAnswer={onAnswer}
        onGenerate={onGenerate}
        onInstructionChange={onInstructionChange}
        snapshot={fresh}
      />,
    );

    expect(container.querySelector('[data-builder-composer="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-page="true"]')?.getAttribute('data-builder-project-status'))
      .toBe('new');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.textContent).toContain('Your result will appear here.');
    expect(container.textContent).not.toContain('Preview is isolated');
    click(container, '[data-builder-make-draft="true"]');
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('submits the primary composer command with Enter without using Ask', async () => {
    const { fresh } = await snapshots();
    const onAnswer = vi.fn();
    const onGenerate = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onAnswer={onAnswer}
        onGenerate={onGenerate}
        snapshot={fresh}
      />,
    );

    const event = keyDown(container, '#builder-idea', { key: 'Enter' });

    expect(event.defaultPrevented).toBe(true);
    expect(container.querySelector('#builder-idea')?.getAttribute('aria-keyshortcuts'))
      .toBe('Enter');
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('keeps Shift+Enter available for multiline composer input', async () => {
    const { fresh } = await snapshots();
    const onAnswer = vi.fn();
    const onGenerate = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onAnswer={onAnswer}
        onGenerate={onGenerate}
        snapshot={fresh}
      />,
    );

    const event = keyDown(container, '#builder-idea', { key: 'Enter', shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onGenerate).not.toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('does not submit while IME composition is active', async () => {
    const { fresh } = await snapshots();
    const onAnswer = vi.fn();
    const onGenerate = vi.fn();
    const onRejectDraft = vi.fn();
    const onSave = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="做一个计时器。"
        onAnswer={onAnswer}
        onGenerate={onGenerate}
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        snapshot={fresh}
      />,
    );

    const event = keyDown(container, '#builder-idea', { key: 'Enter', isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onGenerate).not.toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(onRejectDraft).not.toHaveBeenCalled();
  });

  it('offers a separate Ask command without using the draft generator', async () => {
    const { fresh } = await snapshots();
    const onAnswer = vi.fn();
    const onGenerate = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="What does this project do?"
        onAnswer={onAnswer}
        onGenerate={onGenerate}
        snapshot={fresh}
      />,
    );

    click(container, '[data-builder-ask-question="true"]');

    expect(onAnswer).toHaveBeenCalledOnce();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('offers Retry for a retryable draft failure without using Make draft', async () => {
    const controller = createBuilderProjectController({
      generator: {
        generate: async () => {
          throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
        },
        retry: async (request) => createGenerationDraft(request),
        answer: async () => null,
        restoreDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async () => null,
      },
      workspace: {
        open: async () => null,
        saveDraft: async () => null,
        loadCurrent: async () => null,
        loadRevision: async () => null,
        listCurrent: async () => ({ projects: [] }),
        listHistory: async () => ({ revisions: [] }),
      },
    });
    const failed = await controller.generate('Make a timer.');
    const onGenerate = vi.fn();
    const onRetryGenerate = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a different timer."
        onGenerate={onGenerate}
        onRetryGenerate={onRetryGenerate}
        snapshot={failed}
      />,
    );

    const notice = container.querySelector('[data-builder-conversation-notice="generation_failed"]');
    expect(notice).not.toBeNull();
    expect(notice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(notice?.closest('[data-builder-composer="true"]')).toBeNull();
    click(container, '[data-builder-retry-draft="true"]');

    expect(onRetryGenerate).toHaveBeenCalledOnce();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('shows Stop only while AI work is active', async () => {
    const { fresh } = await snapshots();
    const controller = createBuilderProjectController({
      generator: {
        generate: async () => new Promise(() => undefined),
        retry: async () => null,
        answer: async () => null,
        restoreDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async (request) => ({ request_id: request.request_id, cancelled: true }),
      },
      workspace: {
        open: async () => null,
        saveDraft: async () => null,
        loadCurrent: async () => null,
        loadRevision: async () => null,
        listCurrent: async () => ({ projects: [] }),
        listHistory: async () => ({ revisions: [] }),
      },
    });
    void controller.generate('Make a timer.');
    const onCancel = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onCancel={onCancel}
        snapshot={controller.getSnapshot()}
      />,
    );

    const notice = container.querySelector('[data-builder-conversation-notice="generating"]');
    expect(notice?.textContent).toContain('Making your draft...');
    expect(notice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(notice?.closest('[data-builder-composer="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    click(container, '[data-builder-cancel-work="true"]');
    expect(onCancel).toHaveBeenCalledOnce();

    const idle = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onCancel={onCancel}
        snapshot={fresh}
      />,
    );
    expect(idle.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
  });

  it('shows an unsaved draft and requires the explicit Save version command', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const onSave = vi.fn();
    const onRejectDraft = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Add a timer."
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        snapshot={draftReady}
      />,
    );

    expect(container.querySelector('[data-builder-unsaved-draft="true"]')?.textContent)
      .toContain('Unsaved draft');
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
    expect(container.textContent).toContain('Review draft before continuing');
    expect(container.textContent).toContain('Review the draft preview, files, and changes before saving this version.');
    expect(container.querySelector<HTMLButtonElement>('[data-builder-ask-question="true"]')?.disabled)
      .toBeUndefined();
    expect(container.querySelector('[data-builder-discard-draft="true"]')?.textContent)
      .toContain('Discard draft');
    click(container, '[data-builder-discard-draft="true"]');
    expect(onRejectDraft).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    click(container, '[data-builder-save-version="true"]');
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('does not bind Enter to saving or discarding an unsaved draft', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const onGenerate = vi.fn();
    const onSave = vi.fn();
    const onRejectDraft = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Add a timer."
        onGenerate={onGenerate}
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        snapshot={draftReady}
      />,
    );

    const event = keyDown(container, '#builder-idea', { key: 'Enter' });

    expect(event.defaultPrevented).toBe(false);
    expect(container.querySelector('#builder-idea')?.getAttribute('aria-keyshortcuts'))
      .toBeNull();
    expect(onGenerate).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(onRejectDraft).not.toHaveBeenCalled();
  });

  it('keeps the composer in the main conversation and review details in the right sidebar', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const history = await savedHistory();
    const onAnswer = vi.fn();
    const onGenerate = vi.fn();
    const onRefreshConversation = vi.fn();
    const onRejectDraft = vi.fn();
    const onSave = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        historySnapshot={history}
        instruction="Add a timer."
        onAnswer={onAnswer}
        onGenerate={onGenerate}
        onRefreshConversation={onRefreshConversation}
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        snapshot={draftReady}
      />,
    );

    const chatMain = container.querySelector('[data-builder-chat-main="true"]');
    const reviewSidebar = container.querySelector('[data-builder-review-sidebar="true"]');
    const conversation = container.querySelector('[data-builder-conversation-workspace="true"]');
    const review = container.querySelector('[data-builder-review-checkpoint="true"]');
    const composer = container.querySelector('[data-builder-composer="true"]');
    const preview = container.querySelector('[data-builder-preview-flow="true"]');
    const code = container.querySelector('[data-builder-code-flow="true"]');
    const source = container.querySelector('[data-builder-source-flow="true"]');
    const changes = container.querySelector('[data-builder-changes-panel="true"]');
    const versions = container.querySelector('[data-builder-version-history="true"]');
    expect(chatMain).not.toBeNull();
    expect(reviewSidebar).not.toBeNull();
    expect(conversation).not.toBeNull();
    expect(review).not.toBeNull();
    expect(composer).not.toBeNull();
    expect(preview).not.toBeNull();
    expect(code).toBeNull();
    expect(source).toBeNull();
    expect(changes).not.toBeNull();
    expect(versions).not.toBeNull();
    expect(conversation?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(review?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(preview?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(preview?.getAttribute('aria-label')).toBe('Project result');
    expect(preview?.textContent).toContain('Result');
    expect(preview?.textContent).not.toContain('Preview is isolated');
    expect(composer?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(composer?.closest('[data-builder-review-sidebar="true"]')).toBeNull();
    expect(composer?.querySelector('.cf-builder-alert')).toBeNull();
    expect(changes?.closest('[data-builder-review-sidebar="true"]')).toBe(reviewSidebar);
    expect(versions?.closest('[data-builder-review-sidebar="true"]')).toBe(reviewSidebar);
    expect(conversation?.querySelector('.cf-builder-side-header')).toBeNull();
    expect(conversation?.textContent).not.toContain('Work stream');
    expect(conversation?.querySelector('[data-builder-activity-toolbar="true"]')).not.toBeNull();
    expect(conversation?.querySelector('[data-builder-refresh-activity="true"]')).not.toBeNull();
    expect(conversation?.querySelector('[data-builder-refresh-activity="true"]')?.closest('[data-builder-chat-main="true"]'))
      .toBe(chatMain);
    expect(conversation?.querySelector('[data-builder-refresh-activity="true"]')?.closest('[data-builder-review-sidebar="true"]'))
      .toBeNull();
    expect(Boolean(conversation!.compareDocumentPosition(review!) & Node.DOCUMENT_POSITION_FOLLOWING))
      .toBe(true);
    expect(Boolean(review!.compareDocumentPosition(preview!) & Node.DOCUMENT_POSITION_FOLLOWING))
      .toBe(true);
    expect(Boolean(preview!.compareDocumentPosition(composer!) & Node.DOCUMENT_POSITION_FOLLOWING))
      .toBe(true);
    expect(composer?.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    expect(composer?.querySelector('[data-builder-discard-draft="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-builder-save-version="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-builder-discard-draft="true"]')).toHaveLength(1);
    expect(container.querySelector('#builder-tool-tab-preview')).toBeNull();
    expect(container.querySelector('#builder-tool-tab-code')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="You"]')?.getAttribute('data-builder-activity-role'))
      .toBe('user');
    expect(container.querySelector('[data-builder-activity-card="Started"]')?.getAttribute('data-builder-activity-role'))
      .toBe('status');
    expect(container.querySelector('[data-builder-activity-card="Draft ready"]')?.getAttribute('data-builder-activity-role'))
      .toBe('status');
    expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.getAttribute('data-builder-activity-role'))
      .toBe('assistant');
    expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.textContent)
      .toContain('Review the draft preview, files, and changes before saving this version.');
    click(container, '[data-builder-refresh-activity="true"]');
    expect(onRefreshConversation).toHaveBeenCalledOnce();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(onGenerate).not.toHaveBeenCalled();
    expect(onRejectDraft).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(
      /builder-generation-draft:|review_id|reviewer_id|reviewed_at_ms|sha256:|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('keeps the latest conversation content visible while following the chat bottom', async () => {
    const { saved } = await snapshots();
    const initialActivity = await candidateActivity();
    const nextActivity = await answerActivity();
    const { restore, spy } = installScrollIntoViewSpy();
    let setActivity!: (value: typeof initialActivity) => void;

    function ChatFollowBuilderPage() {
      const [conversationSnapshot, updateActivity] = useState(initialActivity);
      setActivity = updateActivity;
      return (
        <BuilderPage
          activeFile={null}
          conversationSnapshot={conversationSnapshot}
          instruction=""
          snapshot={saved}
        />
      );
    }

    try {
      const container = render(<ChatFollowBuilderPage />);
      expect(container.querySelector('[data-builder-chat-scroll="true"]')).not.toBeNull();
      expect(container.querySelector('[data-builder-chat-tail="true"]')).not.toBeNull();
      expect(spy).toHaveBeenCalledExactlyOnceWith({ block: 'end' });

      act(() => setActivity(nextActivity));

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenLastCalledWith({ block: 'end' });
    } finally {
      restore();
    }
  });

  it('does not pull the chat back down while the user is reading older content', async () => {
    const { saved } = await snapshots();
    const initialActivity = await candidateActivity();
    const nextActivity = await answerActivity();
    const acceptedActivity = await acceptedCandidateActivity();
    const { restore, spy } = installScrollIntoViewSpy();
    let setActivity!: (value: typeof initialActivity) => void;

    function ChatFollowBuilderPage() {
      const [conversationSnapshot, updateActivity] = useState(initialActivity);
      setActivity = updateActivity;
      return (
        <BuilderPage
          activeFile={null}
          conversationSnapshot={conversationSnapshot}
          instruction=""
          snapshot={saved}
        />
      );
    }

    try {
      const container = render(<ChatFollowBuilderPage />);
      const scroll = container.querySelector<HTMLElement>('[data-builder-chat-scroll="true"]');
      expect(scroll).not.toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      const initialCallCount = spy.mock.calls.length;

      setScrollMetrics(scroll!, { clientHeight: 400, scrollHeight: 1200, scrollTop: 120 });
      act(() => {
        scroll?.dispatchEvent(new Event('scroll'));
      });
      act(() => setActivity(nextActivity));
      expect(spy).toHaveBeenCalledTimes(initialCallCount);

      setScrollMetrics(scroll!, { clientHeight: 400, scrollHeight: 1200, scrollTop: 720 });
      act(() => {
        scroll?.dispatchEvent(new Event('scroll'));
      });
      act(() => setActivity(acceptedActivity));
      expect(spy).toHaveBeenCalledTimes(initialCallCount + 1);
    } finally {
      restore();
    }
  });

  it('renders questions and AI answers as chat messages while keeping run events as status', async () => {
    const { saved } = await snapshots();
    const activity = await answerActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const userMessage = container.querySelector('[data-builder-activity-card="You"]');
    const started = container.querySelector('[data-builder-activity-card="Started"]');
    const assistant = container.querySelector('[data-builder-activity-card="Assistant"]');
    const answered = container.querySelector('[data-builder-activity-card="Answered"]');
    expect(userMessage?.getAttribute('data-builder-activity-role')).toBe('user');
    expect(userMessage?.textContent).toContain('What does this project do?');
    expect(assistant?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(assistant?.textContent).toContain('This answer does not change files.');
    expect(started?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(answered?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /builder-generation-draft:|review_id|reviewer_id|reviewed_at_ms|sha256:|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('shows draft file changes before Save without exposing source or Git evidence', async () => {
    const draftReady = await changedDraftSnapshot();
    const onSelectFile = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Update the saved project."
        onSelectFile={onSelectFile}
        snapshot={draftReady}
      />,
    );

    const reviewStrip = container.querySelector('[data-builder-review-checkpoint="true"]');
    expect(reviewStrip).not.toBeNull();
    expect(reviewStrip?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(reviewStrip?.textContent).toContain('Review before saving');
    expect(reviewStrip?.textContent).toContain('3 file changes: 1 added, 1 changed, 1 removed.');
    expect(reviewStrip?.textContent).toContain('Preview and changes are ready.');
    expect(reviewStrip?.textContent).not.toMatch(
      /<main>Old|<main>New|const added|const removed|review_id|sha256:|commit_oid|tree_oid|receipt/iu,
    );
    const changesPanel = container.querySelector('[data-builder-changes-panel="true"]');
    expect(changesPanel).not.toBeNull();
    expect(changesPanel?.closest('[data-builder-review-sidebar="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-changes-summary="true"]')?.textContent)
      .toContain('3 file changes: 1 added, 1 changed, 1 removed.');
    expect(container.querySelector('[data-builder-change-card="Changed index.html"]')?.textContent)
      .toContain('1 line to 2 lines');
    expect(container.querySelector('[data-builder-change-card="Added src/add.ts"]')?.textContent)
      .toContain('1 line added');
    expect(container.querySelector('[data-builder-change-card="Removed src/remove.ts"]')?.textContent)
      .toContain('1 line removed');
    expect(container.querySelector('[data-builder-change-diff="index.html"]')?.textContent)
      .toContain('<main>Old</main>');
    expect(container.querySelector('[data-builder-change-diff="index.html"]')?.textContent)
      .toContain('<main>New</main>');
    expect(container.querySelector('[data-builder-change-diff="src/add.ts"]')?.textContent)
      .toContain('const added = true;');
    expect(container.querySelector('[data-builder-change-diff="src/remove.ts"]')?.textContent)
      .toContain('const removed = true;');
    expect(container.querySelector('[data-builder-change-diff="index.html"] [data-builder-change-diff-line-kind="removed"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-builder-change-diff="index.html"] [data-builder-change-diff-line-kind="added"]'))
      .not.toBeNull();
    expect(changesPanel?.textContent).not.toMatch(
      /sha256:|commit_oid|tree_oid|receipt|review_id|provider|credential/iu,
    );

    onSelectFile.mockClear();
    click(container, '[data-builder-change-card="Added src/add.ts"] button');
    expect(onSelectFile).toHaveBeenCalledExactlyOnceWith('src/add.ts');
  });

  it('opens and focuses inline source after choosing a changed file from the sidebar', async () => {
    const draftReady = await changedDraftSnapshot();
    const onSelectFile = vi.fn();

    function ControlledBuilderPage() {
      const [activeFile, setActiveFile] = useState<string | null>(null);
      return (
        <BuilderPage
          activeFile={activeFile}
          instruction="Update the saved project."
          onSelectFile={(file) => {
            onSelectFile(file);
            setActiveFile(file);
          }}
          snapshot={draftReady}
        />
      );
    }

    const container = render(<ControlledBuilderPage />);
    expect(container.querySelector('[data-builder-source-flow="true"]')).toBeNull();

    click(container, '[data-builder-change-card="Added src/add.ts"] button');

    const source = container.querySelector('[data-builder-source-flow="true"]');
    expect(onSelectFile).toHaveBeenCalledExactlyOnceWith('src/add.ts');
    expect(source).not.toBeNull();
    expect(source?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(document.activeElement).toBe(source);
    expect(container.querySelector('[data-builder-source-code="src/add.ts"] code')?.textContent)
      .toContain('const added = true;');
  });

  it('shows truncated diff lines with a single omission marker', async () => {
    const longBefore = 'before-'.repeat(50);
    const longAfter = 'after-'.repeat(50);
    const draftReady = await draftSnapshotFromSourceTrees(
      await createSourceTree([{ path: 'index.html', content: `${longBefore}\n` }]),
      await createSourceTree([{ path: 'index.html', content: `${longAfter}\n` }]),
    );
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Update the saved project."
        snapshot={draftReady}
      />,
    );

    const diffTexts = [...container.querySelectorAll(
      '[data-builder-change-diff="index.html"] .cf-builder-change-diff-text',
    )].map((node) => node.textContent ?? '');
    expect(diffTexts).toEqual([
      `${longBefore.slice(0, 240)}...`,
      `${longAfter.slice(0, 240)}...`,
    ]);
    expect(diffTexts.join('\n')).not.toContain('... ...');
  });

  it('shows Git/SQLite revision number only for a verified saved snapshot', async () => {
    const { saved } = await snapshots();
    const container = render(
      <BuilderPage activeFile={null} instruction="" snapshot={saved} />,
    );
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
  });

  it('shows read-only saved version history without exposing receipt or Git evidence', async () => {
    const { saved } = await snapshots();
    const history = await savedHistory();
    const onRefreshHistory = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        historySnapshot={history}
        instruction=""
        onRefreshHistory={onRefreshHistory}
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-version-history="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-version-card="Version 1"]')?.textContent)
      .toContain('Current');
    expect(container.querySelector('[data-builder-version-card="Version 1"]')?.textContent)
      .toContain('Version one');
    click(container, 'button[aria-label="Refresh versions"]');
    expect(onRefreshHistory).toHaveBeenCalledOnce();
    expect(container.textContent).not.toMatch(
      /sha256:|commit_oid|tree_oid|parent_oid|sqlite|credential|provider/iu,
    );
  });

  it('opens a saved version as a read-only view and can return to current', async () => {
    const { saved } = await snapshots();
    const inspected = await inspectedHistorySnapshot();
    const historyController = createBuilderProjectHistoryController({
      listHistory: async () => createHistoryWire(PROJECT_ID, 2),
    });
    const history = await historyController.load(PROJECT_ID);
    const onInspectRevision = vi.fn();
    const onShowCurrentRevision = vi.fn();
    const savedContainer = render(
      <BuilderPage
        activeFile={null}
        historySnapshot={history}
        instruction=""
        onInspectRevision={onInspectRevision}
        onShowCurrentRevision={onShowCurrentRevision}
        snapshot={saved}
      />,
    );

    click(savedContainer, '[data-builder-view-version="Version 1"]');
    expect(onInspectRevision).toHaveBeenCalledExactlyOnceWith(
      PROJECT_ID,
      history.history?.revisions.find((revision) => revision.revision_number === 1)?.revision_receipt_digest,
    );
    expect(onShowCurrentRevision).not.toHaveBeenCalled();

    const inspectedContainer = render(
      <BuilderPage
        activeFile={null}
        historySnapshot={history}
        instruction="Change it."
        onGenerate={vi.fn()}
        onInspectRevision={onInspectRevision}
        onShowCurrentRevision={onShowCurrentRevision}
        snapshot={inspected}
      />,
    );
    expect(inspectedContainer.querySelector('[data-builder-history-preview="true"]')?.textContent)
      .toContain('Viewing Version 1');
    expect(inspectedContainer.textContent).toContain('Viewing a saved version');
    expect(inspectedContainer.querySelector<HTMLButtonElement>('[data-builder-make-draft="true"]')?.disabled)
      .toBe(true);
    expect(inspected.preview?.src_doc).toContain('<main>Earlier</main>');
    const previewFrame = inspectedContainer.querySelector('iframe');
    expect(previewFrame).not.toBeNull();
    expect(previewFrame?.getAttribute('srcdoc')).toContain('<main>Earlier</main>');
    click(inspectedContainer, 'header [data-builder-show-current-version="true"]');
    expect(onShowCurrentRevision).toHaveBeenCalledOnce();
    expect(inspectedContainer.textContent).not.toMatch(
      /sha256:|commit_oid|tree_oid|parent_oid|sqlite|credential|provider/iu,
    );
  });

  it('does not treat a restored activity candidate as an available unsaved draft', async () => {
    const { saved } = await snapshots();
    const activity = await candidateActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.textContent)
      .toContain('Activity keeps this draft summary only and cannot reopen unsaved files.');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
    expect(container.textContent).not.toContain(DRAFT_ID);
  });

  it('shows rejected draft activity without restoring or exposing internal review data', async () => {
    const { saved } = await snapshots();
    const activity = await candidateActivity(true);
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-activity-card="Draft rejected"]')?.textContent)
      .toContain('The draft was discarded and is no longer available for review.');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /builder-generation-draft:|review_id|reviewer_id|reviewed_at_ms|sha256:|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('shows saved version activity without restoring or exposing internal review data', async () => {
    const { saved } = await snapshots();
    const activity = await acceptedCandidateActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-activity-card="Version saved"]')?.textContent)
      .toContain('This draft was saved as Version 1.');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /builder-generation-draft:|review_id|reviewer_id|reviewed_at_ms|revision_receipt|sha256:|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('shows plan review activity without implying files changed', async () => {
    const { saved } = await snapshots();
    const activity = await planReviewActivity('approved');
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-activity-card="Plan approved"]')?.textContent)
      .toContain('The plan was approved. The project has not changed yet.');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|builder-generation-draft:|sha256:|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('offers plan approval without exposing edit, save, or internal evidence', async () => {
    const { saved } = await snapshots();
    const activity = await pendingPlanActivity();
    const onReviewPlan = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onReviewPlan={onReviewPlan}
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-activity-card="Plan ready"]')?.textContent)
      .toContain('Plan ready.');
    expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    click(container, '[data-builder-approve-plan="true"]');
    expect(onReviewPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
      decision: 'approved',
    });
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('shows a selected source file as an inline conversation disclosure', async () => {
    const { draftReady } = await snapshots();
    const onSelectFile = vi.fn();
    const container = render(
      <BuilderPage
        activeFile="src/tool.py"
        instruction=""
        onSelectFile={onSelectFile}
        snapshot={draftReady}
      />,
    );
    expect(container.textContent).toContain('src/tool.py');
    expect(container.querySelector('#builder-tool-tab-code')).toBeNull();
    expect(container.querySelector('[data-builder-code-flow="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-source-flow="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-source-flow="true"]')?.closest('[data-builder-chat-main="true"]'))
      .not.toBeNull();
    expect(container.querySelector('details[data-builder-source-flow="true"]')?.getAttribute('open'))
      .toBe('');
    expect(container.querySelector('[data-builder-source-file="src/tool.py"]')?.getAttribute('data-active'))
      .toBe('true');
    expect(container.querySelector('[data-builder-source-code="src/tool.py"] code')?.textContent)
      .toContain('print("hello")');
    expect(container.textContent).not.toContain('app.js');
  });

  it('opens source inline when a project has files but no static preview', async () => {
    const draftReady = await draftSnapshotFromSourceTrees(
      await createSourceTree([{ path: 'src/tool.py', content: 'print("old")\n' }]),
      await createSourceTree([{ path: 'src/tool.py', content: 'print("new")\n' }]),
    );
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Update the script."
        snapshot={draftReady}
      />,
    );

    expect(container.querySelector('[data-builder-code-flow="true"]')).toBeNull();
    expect(container.querySelector('details[data-builder-source-flow="true"]')?.getAttribute('open'))
      .toBe('');
    expect(container.querySelector('[data-builder-source-code="src/tool.py"] code')?.textContent)
      .toContain('print("new")');
    expect(container.textContent).toContain('This project has files, but no visual preview.');
    expect(container.textContent).not.toContain('static preview');
  });

  it('keeps the provider-settings recovery action limited to configuration failures', async () => {
    const { fresh } = await snapshots();
    const controller = createBuilderProjectController({
      generator: {
        generate: async () => {
          const error = Object.assign(new Error(), {
            code: 'builder_generation_provider_unavailable',
          });
          throw error;
        },
        retry: async () => null,
        answer: async () => null,
        restoreDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async () => null,
      },
      workspace: {
        open: async () => null,
        saveDraft: async () => null,
        loadCurrent: async () => null,
        loadRevision: async () => null,
        listCurrent: async () => null,
        listHistory: async () => null,
      },
    });
    void fresh;
    const failed = await controller.generate('Make a timer.');
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onOpenSettings={vi.fn()}
        snapshot={failed}
      />,
    );
    expect(container.textContent).not.toContain('Check AI settings');
    expect(JSON.stringify(failed)).not.toContain(DRAFT_ID);
  });

  it('labels an unknown Save outcome without claiming the draft is lost', async () => {
    const controller = createBuilderProjectController({
      generator: {
        generate: async (request) => createGenerationDraft(request),
        retry: async (request) => createGenerationDraft(request),
        answer: async () => null,
        restoreDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async () => null,
      },
      workspace: {
        open: async () => null,
        saveDraft: async () => {
          throw new Error('response lost');
        },
        loadCurrent: async () => {
          throw new Error('unavailable');
        },
        loadRevision: async () => null,
        listCurrent: async () => ({ projects: [] }),
        listHistory: async () => ({ revisions: [] }),
      },
    });
    await controller.generate('Make a timer.');
    const unknown = await controller.save();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        onSave={vi.fn()}
        snapshot={unknown}
      />,
    );
    expect(container.textContent).toContain('The save result could not be confirmed.');
    expect(container.textContent).toContain('Try Save again');
    const notice = container.querySelector('[data-builder-conversation-notice="save_unknown"]');
    expect(notice).not.toBeNull();
    expect(notice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(notice?.closest('[data-builder-composer="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
  });
});
