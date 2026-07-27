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
  CONVERSATION_ID,
  DRAFT_ID,
  PROJECT_ID,
  RUN_ID,
  TASK_ID,
  TURN_ID,
  createAcceptedTaskStreamWire,
  createAnswerTaskStreamWire,
  createGenerationAnswer,
  createGenerationDraft,
  createHistoryWire,
  createPlanTaskStreamWire,
  createPlanReviewTaskStreamWire,
  createProgressTaskStreamWire,
  createReadWire,
  createRejectedTaskStreamWire,
  createRestoredGenerationDraft,
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
      async submit(request) {
        draft = await createGenerationDraft(request, readWire.source_tree);
        return draft;
      },
      async generate(request) {
        draft = await createGenerationDraft(request, readWire.source_tree);
        return draft;
      },
      async generateApprovedPlan() {
        return draft;
      },
      async proposePlan() {
        return null;
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
      async steer(request) {
        return { request_id: request.request_id, steered: true };
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

function taskStreamPort(read: Parameters<typeof createBuilderConversationController>[0]['read']) {
  return {
    read,
    subscribeChanged: () => () => undefined,
  };
}

async function candidateActivity(rejected = false) {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => (rejected ? createRejectedTaskStreamWire() : createTaskStreamWire()),
  ));
  return controller.load(PROJECT_ID);
}

async function absentActivity() {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => ({
      stream_version: 'builder-task-stream-read-result.v1',
      project_id: PROJECT_ID,
      conversation: null,
      authority: {
        conversation: 'sqlite_canonical_event_replay_or_absent',
        project_source: 'not_included',
        candidate_source: 'not_loaded',
        project_revision: 'not_inferred',
      },
    }),
  ));
  return controller.load(PROJECT_ID);
}

function loadingActivity() {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => new Promise(() => undefined),
  ));
  void controller.load(PROJECT_ID);
  return controller.getSnapshot();
}

async function unavailableActivity() {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => {
      throw new Error('private');
    },
  ));
  return controller.load(PROJECT_ID);
}

async function staleActivity() {
  let fail = false;
  const controller = createBuilderConversationController(taskStreamPort(
    async () => {
      if (fail) throw new Error('private');
      return {
        stream_version: 'builder-task-stream-read-result.v1',
        project_id: PROJECT_ID,
        conversation: null,
        authority: {
          conversation: 'sqlite_canonical_event_replay_or_absent',
          project_source: 'not_included',
          candidate_source: 'not_loaded',
          project_revision: 'not_inferred',
        },
      };
    },
  ));
  await controller.load(PROJECT_ID);
  fail = true;
  return controller.refresh();
}

async function answerActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => createAnswerTaskStreamWire()));
  return controller.load(PROJECT_ID);
}

async function progressActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => createProgressTaskStreamWire()));
  return controller.load(PROJECT_ID);
}

async function refreshingActivityWithVisibleEntries() {
  let resolveRefresh!: (value: unknown) => void;
  let reads = 0;
  const controller = createBuilderConversationController(taskStreamPort(async () => {
    reads += 1;
    if (reads === 1) return createTaskStreamWire();
    return new Promise<unknown>((resolve) => {
      resolveRefresh = resolve;
    });
  }));
  await controller.load(PROJECT_ID);
  void controller.refresh();
  await Promise.resolve();
  const snapshot = controller.getSnapshot();
  resolveRefresh(createTaskStreamWire());
  return snapshot;
}

async function toolActivity(
  result: Readonly<{
    status: 'succeeded' | 'failed' | 'cancelled';
    summary_code: string;
    display_summary: string;
  }> = {
    status: 'succeeded',
    summary_code: 'completed_without_raw_output',
    display_summary: 'This step completed. Details were not kept.',
  },
) {
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1234,
      head_sequence: 6,
      recorded_active_turn_id: null,
      window: {
        first_sequence: 1,
        last_sequence: 6,
        has_earlier: false,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:323e4567-e89b-42d3-a456-426614174000',
            text: 'Read the current project before planning a change.',
          },
          message_kind: 'submitted',
          mode: 'work',
          task: {
            task_id: TASK_ID,
            title: 'Read project context',
          },
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'tool_call_requested',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          step_id: 'builder-run-step:123e4567-e89b-42d3-a456-426614174000',
          tool_call_id: 'builder-tool-call:123e4567-e89b-42d3-a456-426614174000',
          tool_label: 'Read project context',
          action: 'project.read',
          resource: {
            resource_kind: 'project',
          },
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
          sequence: 4,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          step_id: 'builder-run-step:123e4567-e89b-42d3-a456-426614174000',
          tool_call_id: 'builder-tool-call:123e4567-e89b-42d3-a456-426614174000',
          tool_label: 'Read project context',
          action: 'project.read',
          resource: {
            resource_kind: 'project',
          },
          result: {
            status: result.status,
            summary_code: result.summary_code,
            display_summary: result.display_summary,
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
          sequence: 5,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          terminal_status: 'succeeded',
          result_kind: 'candidate',
          assistant_message: {
            message_id: 'builder-message:423e4567-e89b-42d3-a456-426614174000',
            text: 'I prepared a draft after reading the project context.',
          },
          candidate: {
            draft_id: DRAFT_ID,
            title: 'Context-aware draft',
            summary: 'The draft uses the current project context.',
            candidate_state: 'proposed',
            source_availability: 'not_loaded',
          },
        },
        {
          item_kind: 'turn_completed',
          sequence: 6,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          outcome: 'candidate_ready',
        },
      ],
    },
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  })));
  return controller.load(PROJECT_ID);
}

async function pendingToolActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1234,
      head_sequence: 3,
      recorded_active_turn_id: TURN_ID,
      window: {
        first_sequence: 1,
        last_sequence: 3,
        has_earlier: false,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:323e4567-e89b-42d3-a456-426614174000',
            text: 'Read the current project before planning a change.',
          },
          message_kind: 'submitted',
          mode: 'work',
          task: {
            task_id: TASK_ID,
            title: 'Read project context',
          },
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'tool_call_requested',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          step_id: 'builder-run-step:123e4567-e89b-42d3-a456-426614174000',
          tool_call_id: 'builder-tool-call:123e4567-e89b-42d3-a456-426614174000',
          tool_label: 'Read project context',
          action: 'project.read',
          resource: {
            resource_kind: 'project',
          },
          lifecycle: {
            permission_admission: 'verified_allowed',
            dispatch_admission: 'not_started',
            execution_admission: 'not_performed',
            result_admission: 'not_recorded',
          },
          recorded_state: 'requested',
        },
      ],
    },
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  })));
  return controller.load(PROJECT_ID);
}

async function acceptedCandidateActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => createAcceptedTaskStreamWire(1)));
  return controller.load(PROJECT_ID);
}

async function planReviewActivity(decision: 'approved' | 'rejected' = 'approved') {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => createPlanReviewTaskStreamWire(decision),
  ));
  return controller.load(PROJECT_ID);
}

async function pendingPlanActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => createPlanTaskStreamWire()));
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
      async submit() {
        return draft;
      },
      async generate() {
        return draft;
      },
      async generateApprovedPlan() {
        return draft;
      },
      async proposePlan() {
        return null;
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
      async steer(steerRequest) {
        return { request_id: steerRequest.request_id, steered: true };
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
      async submit(request) {
        return createGenerationDraft(request, currentTree);
      },
      async generate(request) {
        return createGenerationDraft(request, currentTree);
      },
      async generateApprovedPlan() {
        return createGenerationDraft(
          await createBuilderGenerationRequest('Continue approved plan.', PROJECT_ID),
          currentTree,
        );
      },
      async proposePlan() {
        return null;
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
      async steer(request) {
        return { request_id: request.request_id, steered: true };
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
    const activity = await absentActivity();
    const onSubmitInstruction = vi.fn();
    const onInstructionChange = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Make a timer."
        onInstructionChange={onInstructionChange}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={fresh}
      />,
    );

    expect(container.querySelector('[data-builder-composer="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-starter-card="true"]')?.textContent)
      .toContain('What are we building today?');
    expect(container.querySelector('[data-builder-starter-card="true"] [data-builder-activity-role]')).toBeNull();
    expect(container.querySelector('[data-builder-starter-card="true"] [data-builder-activity-card]')).toBeNull();
    expect(
      container.querySelector('[data-builder-starter-card="true"] [data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('plain');
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-page="true"]')?.getAttribute('data-builder-project-status'))
      .toBe('new');
    const workspace = container.querySelector('[data-builder-chat-workspace="true"]');
    expect(workspace?.getAttribute('data-builder-review-sidebar-visible'))
      .toBe('false');
    expect(workspace?.classList.contains('border')).toBe(false);
    expect(container.querySelector('[data-builder-review-sidebar="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-changes-panel="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-version-history="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-result-flow="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Select a project to see activity.');
    expect(container.textContent).not.toContain('No activity yet.');
    expect(container.textContent).not.toContain('Your result will appear here.');
    expect(container.textContent).not.toContain('Preview is isolated');
    expect(container.textContent).not.toContain('No unsaved changes to review.');
    expect(container.textContent).not.toContain('Make a draft to compare it with the current version.');
    expect(container.textContent).not.toContain('Save a version to see history.');
    expect(container.querySelector('[data-builder-ask-question="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-make-draft="true"]')).toBeNull();
    click(container, '[data-builder-submit-turn="true"]');
    expect(onSubmitInstruction).toHaveBeenCalledOnce();
  });

  it('keeps explicit activity loading and failure states visible without empty placeholders', async () => {
    const { fresh } = await snapshots();
    const loading = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={loadingActivity()}
        instruction="Make a timer."
        snapshot={fresh}
      />,
    );
    expect(loading.querySelector('[data-builder-activity="true"]')).not.toBeNull();
    expect(loading.textContent).toContain('Loading activity...');
    expect(loading.textContent).not.toContain('No activity yet.');

    const unavailable = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={await unavailableActivity()}
        instruction="Make a timer."
        snapshot={fresh}
      />,
    );
    expect(unavailable.querySelector('[data-builder-activity="true"]')).not.toBeNull();
    expect(unavailable.textContent).toContain('Activity is unavailable.');
    expect(unavailable.textContent).not.toContain('No activity yet.');

    const stale = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={await staleActivity()}
        instruction="Make a timer."
        snapshot={fresh}
      />,
    );
    expect(stale.querySelector('[data-builder-activity="true"]')).not.toBeNull();
    expect(stale.textContent).toContain('Activity could not be refreshed.');
    expect(stale.textContent).not.toContain('No activity yet.');
  });

  it('submits the primary composer command with Enter through the single submit action', async () => {
    const { fresh } = await snapshots();
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onSubmitInstruction={onSubmitInstruction}
        snapshot={fresh}
      />,
    );

    const event = keyDown(container, '#builder-idea', { key: 'Enter' });

    expect(event.defaultPrevented).toBe(true);
    expect(container.querySelector('#builder-idea')?.getAttribute('aria-keyshortcuts'))
      .toBe('Enter');
    expect(onSubmitInstruction).toHaveBeenCalledOnce();
  });

  it('keeps Shift+Enter available for multiline composer input', async () => {
    const { fresh } = await snapshots();
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onSubmitInstruction={onSubmitInstruction}
        snapshot={fresh}
      />,
    );

    const event = keyDown(container, '#builder-idea', { key: 'Enter', shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onSubmitInstruction).not.toHaveBeenCalled();
  });

  it('does not submit while IME composition is active', async () => {
    const { fresh } = await snapshots();
    const onSubmitInstruction = vi.fn();
    const onRejectDraft = vi.fn();
    const onSave = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="做一个计时器。"
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={fresh}
      />,
    );

    const event = keyDown(container, '#builder-idea', { key: 'Enter', isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onSubmitInstruction).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(onRejectDraft).not.toHaveBeenCalled();
  });

  it('offers desktop plan-first as a composer tool without adding a second send button', async () => {
    const { draftReady, saved } = await snapshots();
    const onProposePlan = vi.fn();
    const onSubmitInstruction = vi.fn();
    const savedContainer = render(
      <BuilderPage
        activeFile={null}
        instruction="Plan the next project update."
        onProposePlan={onProposePlan}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={saved}
      />,
    );

    expect(savedContainer.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);
    const planButton = savedContainer.querySelector<HTMLButtonElement>('[data-builder-propose-plan="true"]');
    expect(planButton).not.toBeNull();
    expect(planButton?.closest('[data-builder-composer="true"]')).not.toBeNull();
    click(savedContainer, '[data-builder-propose-plan="true"]');
    expect(onProposePlan).toHaveBeenCalledOnce();
    expect(onSubmitInstruction).not.toHaveBeenCalled();

    const draftContainer = render(
      <BuilderPage
        activeFile={null}
        instruction="Plan while draft exists."
        onProposePlan={onProposePlan}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={draftReady}
      />,
    );
    expect(draftContainer.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
  });

  it('offers one submit command for questions and project changes', async () => {
    const { fresh } = await snapshots();
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="What does this project do?"
        onSubmitInstruction={onSubmitInstruction}
        snapshot={fresh}
      />,
    );

    expect(container.querySelector('[data-builder-ask-question="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-make-draft="true"]')).toBeNull();
    click(container, '[data-builder-submit-turn="true"]');

    expect(onSubmitInstruction).toHaveBeenCalledOnce();
  });

  it('offers Retry for a retryable draft failure without submitting a new turn', async () => {
    const controller = createBuilderProjectController({
      generator: {
        submit: async () => {
          throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
        },
        generate: async () => {
          throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
        },
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        retry: async (request) => createGenerationDraft(request),
        answer: async () => null,
        restoreDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async () => null,
        steer: async () => null,
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
    const onSubmitInstruction = vi.fn();
    const onRetryGenerate = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a different timer."
        onRetryGenerate={onRetryGenerate}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={failed}
      />,
    );

    const notice = container.querySelector('[data-builder-conversation-notice="generation_failed"]');
    expect(notice).not.toBeNull();
    expect(notice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(notice?.closest('[data-builder-composer="true"]')).toBeNull();
    click(container, '[data-builder-retry-draft="true"]');

    expect(onRetryGenerate).toHaveBeenCalledOnce();
    expect(onSubmitInstruction).not.toHaveBeenCalled();
  });

  it('shows Stop only while AI work is active', async () => {
    const { fresh } = await snapshots();
    const controller = createBuilderProjectController({
      generator: {
        submit: async () => null,
        generate: async () => new Promise(() => undefined),
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        retry: async () => null,
        answer: async () => null,
        restoreDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async (request) => ({ request_id: request.request_id, cancelled: true }),
        steer: async () => null,
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
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(notice?.textContent).toContain('Making your draft...');
    expect(notice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(notice?.closest('[data-builder-composer="true"]')).toBeNull();
    expect(notice?.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    expect(composer?.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    expect(composer?.querySelector('[data-builder-submit-turn="true"]')).toBeNull();
    expect(composer?.querySelector('[data-builder-ask-question="true"]')).toBeNull();
    expect(composer?.querySelector('[data-builder-make-draft="true"]')).toBeNull();
    expect(composer?.textContent).toContain('Making your draft');
    click(container, '[data-builder-cancel-work="true"]');
    expect(onCancel).toHaveBeenCalledOnce();

    const answerController = createBuilderProjectController({
      generator: {
        submit: async () => null,
        generate: async () => null,
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        retry: async () => null,
        answer: async () => new Promise(() => undefined),
        restoreDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async (request) => ({ request_id: request.request_id, cancelled: true }),
        steer: async () => null,
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
    void answerController.answer('What does this project do?');
    const onCancelAnswer = vi.fn();
    const answering = render(
      <BuilderPage
        activeFile={null}
        instruction="What does this project do?"
        onCancel={onCancelAnswer}
        snapshot={answerController.getSnapshot()}
      />,
    );
    const answeringNotice = answering.querySelector('[data-builder-conversation-notice="answering"]');
    const answeringComposer = answering.querySelector('[data-builder-composer="true"]');
    expect(answeringNotice?.textContent).toContain('Answering...');
    expect(answeringNotice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(answeringNotice?.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    expect(answeringComposer?.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    expect(answeringComposer?.querySelector('[data-builder-submit-turn="true"]')).toBeNull();
    expect(answeringComposer?.querySelector('[data-builder-ask-question="true"]')).toBeNull();
    expect(answeringComposer?.querySelector('[data-builder-make-draft="true"]')).toBeNull();
    expect(answeringComposer?.textContent).toContain('Answering');
    click(answering, '[data-builder-cancel-work="true"]');
    expect(onCancelAnswer).toHaveBeenCalledOnce();

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

  it('lets the live assistant output replace the desktop busy notice', async () => {
    const controller = createBuilderProjectController({
      generator: {
        submit: async () => null,
        generate: async () => new Promise(() => undefined),
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        retry: async () => null,
        answer: async () => null,
        restoreDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async () => null,
        steer: async () => null,
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
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: 'Planning the draft.',
          chunk_count: 1,
        }}
        snapshot={controller.getSnapshot()}
      />,
    );

    expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
      .toContain('Planning the draft.');
    expect(container.querySelector('[data-builder-conversation-notice="generating"]')).toBeNull();
    expect(container.textContent).not.toContain('Making your draft...');
  });

  it('uses the same desktop composer send command to add context while work is active', async () => {
    const controller = createBuilderProjectController({
      generator: {
        submit: async () => null,
        generate: async () => new Promise(() => undefined),
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        retry: async () => null,
        answer: async () => null,
        restoreDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async (request) => ({ request_id: request.request_id, cancelled: true }),
        steer: async (request) => ({ request_id: request.request_id, steered: true }),
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
    const onSteerInstruction = vi.fn();
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make it blue."
        onCancel={onCancel}
        onInstructionChange={vi.fn()}
        onSteerInstruction={onSteerInstruction}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={controller.getSnapshot()}
      />,
    );

    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea?.disabled).toBe(false);
    expect(textarea?.readOnly).toBe(false);
    expect(textarea?.getAttribute('aria-keyshortcuts')).toBe('Enter');
    expect(container.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-builder-submit-turn="true"]')?.getAttribute('aria-label'))
      .toBe('Add context');
    expect(container.querySelector('[data-builder-composer="true"]')?.textContent)
      .toContain('Add context');

    const event = keyDown(container, '#builder-idea', { key: 'Enter' });
    expect(event.defaultPrevented).toBe(true);
    expect(onSteerInstruction).toHaveBeenCalledOnce();
    expect(onSubmitInstruction).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows draft recovery as a visible restoring state without save or stop actions', async () => {
    const readWire = await createReadWire();
    const restored = await createRestoredGenerationDraft(readWire.source_tree);
    let resolveRestore: (value: unknown) => void = () => {
      throw new Error('restore promise was not initialized');
    };
    const controller = createBuilderProjectController({
      generator: {
        submit: async (request) => createGenerationDraft(request),
        generate: async (request) => createGenerationDraft(request),
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        retry: async (request) => createGenerationDraft(request),
        answer: async () => null,
        restoreDraft: async () => new Promise((resolve) => {
          resolveRestore = resolve;
        }),
        rejectDraft: async () => null,
        cancel: async () => null,
        steer: async () => null,
      },
      workspace: {
        open: async () => readWire,
        saveDraft: async () => null,
        loadCurrent: async () => null,
        loadRevision: async () => null,
        listCurrent: async () => ({ projects: [] }),
        listHistory: async () => ({ revisions: [] }),
      },
    });
    await controller.open(PROJECT_ID);
    const restoring = controller.restoreDraft(DRAFT_ID);
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        onSubmitInstruction={vi.fn()}
        snapshot={controller.getSnapshot()}
      />,
    );

    const notice = container.querySelector('[data-builder-conversation-notice="restoring"]');
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(notice?.textContent).toContain('Restoring draft for review...');
    expect(notice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(notice?.closest('[data-builder-composer="true"]')).toBeNull();
    expect(composer?.textContent).toContain('Restoring draft');
    expect(composer?.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-discard-draft="true"]')).toBeNull();

    resolveRestore(restored);
    await restoring;
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
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')?.textContent)
      .toContain('Static preview is ready');
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')?.textContent)
      .toContain('HTML and CSS are shown here');
    expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
      .toBeUndefined();
    expect(container.querySelector('[data-builder-save-version="true"]')?.closest('[data-builder-review-checkpoint="true"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-builder-discard-draft="true"]')?.closest('[data-builder-review-checkpoint="true"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')?.closest('[data-builder-composer="true"]'))
      .toBeNull();
    expect(container.querySelector('[data-builder-discard-draft="true"]')?.closest('[data-builder-composer="true"]'))
      .toBeNull();
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
    const onSubmitInstruction = vi.fn();
    const onSave = vi.fn();
    const onRejectDraft = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Add a timer."
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={draftReady}
      />,
    );

    const event = keyDown(container, '#builder-idea', { key: 'Enter' });

    expect(event.defaultPrevented).toBe(false);
    expect(container.querySelector('#builder-idea')?.getAttribute('aria-keyshortcuts'))
      .toBeNull();
    expect(onSubmitInstruction).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(onRejectDraft).not.toHaveBeenCalled();
  });

  it('keeps the composer, result, and review in the main conversation while opening changes on demand', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const history = await savedHistory();
    const onSubmitInstruction = vi.fn();
    const onRefreshConversation = vi.fn();
    const onRejectDraft = vi.fn();
    const onSave = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        historySnapshot={history}
        instruction="Add a timer."
        onRefreshConversation={onRefreshConversation}
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={draftReady}
      />,
    );

    const chatMain = container.querySelector('[data-builder-chat-main="true"]');
    const workspace = container.querySelector('[data-builder-chat-workspace="true"]');
    const conversation = container.querySelector('[data-builder-conversation-workspace="true"]');
    const review = container.querySelector('[data-builder-review-checkpoint="true"]');
    const composer = container.querySelector('[data-builder-composer="true"]');
    const preview = container.querySelector('[data-builder-preview-flow="true"]');
    const code = container.querySelector('[data-builder-code-flow="true"]');
    const source = container.querySelector('[data-builder-source-flow="true"]');
    const draftActions = container.querySelector('[data-builder-draft-review-actions="true"]');
    expect(chatMain).not.toBeNull();
    expect(workspace?.getAttribute('data-builder-review-sidebar-visible')).toBe('false');
    expect(workspace?.getAttribute('data-builder-review-sidebar-mode')).toBe('hidden');
    expect(container.querySelector('[data-builder-review-sidebar="true"]')).toBeNull();
    expect(conversation).not.toBeNull();
    expect(review).not.toBeNull();
    expect(review?.getAttribute('data-builder-review-layout')).toBe('desktop-stacked-actions');
    expect(composer).not.toBeNull();
    expect(preview).not.toBeNull();
    expect(code).toBeNull();
    expect(source).toBeNull();
    expect(draftActions).not.toBeNull();
    expect(conversation?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(review?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(preview?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(conversation?.classList.contains('cf-builder-chat-flow-surface')).toBe(true);
    expect(review?.classList.contains('cf-builder-chat-flow-surface')).toBe(true);
    expect(preview?.classList.contains('cf-builder-chat-flow-surface')).toBe(true);
    expect(preview?.getAttribute('aria-label')).toBe('Project result');
    expect(preview?.textContent).toContain('Result');
    expect(preview?.textContent).not.toContain('Preview is isolated');
    expect(composer?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(composer?.closest('[data-builder-review-sidebar="true"]')).toBeNull();
    expect(composer?.querySelector('.cf-builder-alert')).toBeNull();
    expect(container.querySelector('[data-builder-changes-panel="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-changes-disclosure="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-version-history="true"]')).toBeNull();
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
    expect(composer?.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(composer?.querySelector('[data-builder-discard-draft="true"]')).toBeNull();
    expect(draftActions?.closest('[data-builder-review-checkpoint="true"]')).toBe(review);
    expect(draftActions?.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    expect(draftActions?.querySelector('[data-builder-discard-draft="true"]')).not.toBeNull();
    click(container, '[data-builder-review-open-changes="true"]');
    const reviewSidebar = container.querySelector('[data-builder-review-sidebar="true"]');
    const changesFlow = container.querySelector('[data-builder-changes-flow="true"]');
    const changes = container.querySelector('[data-builder-changes-panel="true"]');
    const changesDisclosure = container.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
    const versions = container.querySelector('[data-builder-version-history="true"]');
    expect(reviewSidebar).toBeNull();
    expect(changesFlow).not.toBeNull();
    expect(changes).not.toBeNull();
    expect(changes?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(changes?.closest('[data-builder-review-sidebar="true"]')).toBeNull();
    expect(changes?.closest('[data-builder-changes-flow="true"]')).toBe(changesFlow);
    expect(changesDisclosure).not.toBeNull();
    expect(changesDisclosure?.open).toBe(true);
    expect(changesDisclosure?.textContent).toContain('Changes');
    expect(changesDisclosure?.querySelector('[data-builder-changes-summary="true"]')?.textContent)
      .toContain('file');
    expect(versions).toBeNull();
    expect(workspace?.getAttribute('data-builder-review-sidebar-mode')).toBe('hidden');
    expect(workspace?.getAttribute('data-builder-review-sidebar-visible')).toBe('false');
    expect(document.activeElement).toBe(changesDisclosure);
    expect(Boolean(review!.compareDocumentPosition(changes!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(changes!.compareDocumentPosition(preview!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(container.querySelectorAll('[data-builder-save-version="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-builder-discard-draft="true"]')).toHaveLength(1);
    expect(container.querySelector('#builder-tool-tab-preview')).toBeNull();
    expect(container.querySelector('#builder-tool-tab-code')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="You"]')?.getAttribute('data-builder-activity-role'))
      .toBe('user');
    expect(container.querySelector('[data-builder-activity-card="Started"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Assistant working"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Draft ready"]')?.getAttribute('data-builder-activity-role'))
      .toBe('status');
    expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.getAttribute('data-builder-activity-role'))
      .toBe('assistant');
    expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.textContent)
      .toContain('Review the draft preview, files, and changes before saving this version.');
    click(container, '[data-builder-refresh-activity="true"]');
    expect(onRefreshConversation).toHaveBeenCalledOnce();
    expect(onSubmitInstruction).not.toHaveBeenCalled();
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

  it('keeps background activity refresh out of the visible chat when entries remain', async () => {
    const { saved } = await snapshots();
    const activity = await refreshingActivityWithVisibleEntries();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-activity="true"]')?.getAttribute('data-builder-activity-status'))
      .toBe('refreshing');
    expect(container.querySelector('[data-builder-activity-card="You"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Refreshing activity...');
    expect(container.textContent).not.toMatch(
      /builder-generation-draft:|request_id|provider|credential|source_tree|commit_oid|tree_oid|receipt/iu,
    );
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

  it('lands on the draft review actions when generation finishes', async () => {
    const { saved } = await snapshots();
    const draftReady = await changedDraftSnapshot();
    const activity = await candidateActivity();
    const { restore, spy } = installScrollIntoViewSpy();
    let setSnapshot!: (value: typeof saved) => void;

    function DraftLandingBuilderPage() {
      const [snapshot, updateSnapshot] = useState(saved);
      setSnapshot = updateSnapshot;
      return (
        <BuilderPage
          activeFile={null}
          conversationSnapshot={activity}
          instruction=""
          snapshot={snapshot}
        />
      );
    }

    try {
      const container = render(<DraftLandingBuilderPage />);
      spy.mockClear();
      act(() => setSnapshot(draftReady));

      const result = container.querySelector('[data-builder-result-flow="true"]');
      const review = container.querySelector('[data-builder-review-checkpoint="true"]');
      expect(result).not.toBeNull();
      expect(review).not.toBeNull();
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.contexts.at(-1)).toBe(review);
      expect(spy).toHaveBeenLastCalledWith({ block: 'start' });
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
      expect(Boolean(review!.compareDocumentPosition(result!) & Node.DOCUMENT_POSITION_FOLLOWING))
        .toBe(true);
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
    const working = container.querySelector('[data-builder-activity-card="Assistant working"]');
    const assistant = container.querySelector('[data-builder-activity-card="Assistant"]');
    const answered = container.querySelector('[data-builder-activity-card="Answered"]');
    expect(userMessage?.getAttribute('data-builder-activity-role')).toBe('user');
    expect(
      userMessage?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('bubble');
    expect(userMessage?.textContent).toContain('What does this project do?');
    expect(assistant?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(
      assistant?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('plain');
    expect(assistant?.textContent).toContain('This answer does not change files.');
    expect(started).toBeNull();
    expect(working).toBeNull();
    expect(answered?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(
      answered?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('status');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /builder-generation-draft:|review_id|reviewer_id|reviewed_at_ms|sha256:|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('renders durable AI work progress as lightweight status rows in the chat flow', async () => {
    const { saved } = await snapshots();
    const activity = await progressActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const workStatus = container.querySelector('[data-builder-work-status="true"]');
    const contextReady = container.querySelector('[data-builder-activity-card="Context ready"]');
    const responseStarted = container.querySelector('[data-builder-activity-card="AI response started"]');
    const started = container.querySelector('[data-builder-activity-card="Started"]');
    expect(container.querySelectorAll('[data-builder-work-status="true"]')).toHaveLength(1);
    expect(workStatus?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(workStatus?.getAttribute('data-builder-work-status-stage')).toBe('provider_request_started');
    expect(
      workStatus?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('status');
    expect(workStatus?.textContent).toContain('Assistant is working');
    expect(workStatus?.textContent).toContain('Writing the response.');
    expect(started).toBeNull();
    expect(contextReady).toBeNull();
    expect(responseStarted).toBeNull();
    expect(container.textContent).not.toMatch(
      /provider_request_started|context_ready|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('folds active work status into the streaming assistant reply when live output is visible', async () => {
    const { saved } = await snapshots();
    const activity = await progressActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: 'Planning a quiet timer UI.',
          chunk_count: 1,
        }}
        snapshot={saved}
      />,
    );

    const liveOutput = container.querySelector('[data-builder-live-output="true"]');
    expect(liveOutput).not.toBeNull();
    expect(liveOutput?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(
      liveOutput?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('plain');
    expect(liveOutput?.textContent).toContain('Planning a quiet timer UI.');
    expect(container.querySelector('[data-builder-work-status="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Assistant working"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Context ready"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="AI response started"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /provider_request_started|context_ready|request_id|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('shows a waiting assistant reply after live work starts but before display-safe text arrives', async () => {
    const { saved } = await snapshots();
    const activity = await progressActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: '',
          chunk_count: 0,
        }}
        snapshot={saved}
      />,
    );

    const liveOutput = container.querySelector('[data-builder-live-output="true"]');
    expect(liveOutput).not.toBeNull();
    expect(liveOutput?.getAttribute('data-builder-live-output-state')).toBe('waiting');
    expect(liveOutput?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(
      liveOutput?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('plain');
    expect(liveOutput?.textContent).toContain("I'm working on this...");
    expect(container.querySelector('[data-builder-work-status="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Assistant working"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Context ready"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="AI response started"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /provider_request_started|context_ready|request_id|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('can label approved-plan continuation waiting output without changing the message surface', async () => {
    const { saved } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: '',
          chunk_count: 0,
          waiting_text: 'Applying the approved plan...',
        }}
        snapshot={saved}
      />,
    );

    const liveOutput = container.querySelector('[data-builder-live-output="true"]');
    expect(liveOutput).not.toBeNull();
    expect(liveOutput?.getAttribute('data-builder-live-output-state')).toBe('waiting');
    expect(liveOutput?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(
      liveOutput?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('plain');
    expect(liveOutput?.textContent).toContain('Applying the approved plan...');
    expect(liveOutput?.textContent).not.toContain("I'm working on this...");
    expect(container.textContent).not.toMatch(
      /request_id|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('keeps pending tool requests visible without exposing internal evidence', async () => {
    const { saved } = await snapshots();
    const activity = await pendingToolActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const requested = container.querySelector('[data-builder-tool-activity="requested"]');
    expect(requested).not.toBeNull();
    expect(requested?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(requested?.textContent).toContain('Looking over the project');
    expect(requested?.textContent).toContain('checking the current project context');
    expect(requested?.textContent).not.toContain('Read project context');
    expect(container.textContent).not.toMatch(
      /builder-tool-call:|builder-run-step:|builder-run:|permission_admission|dispatch_admission|execution_admission|result_admission|raw_output_admission|revision_admission|summary_code|tool_call_id|step_id|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('folds completed tool requests into one visible project step without exposing internal evidence', async () => {
    const { saved } = await snapshots();
    const activity = await toolActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const requested = container.querySelector('[data-builder-tool-activity="requested"]');
    const completed = container.querySelector('[data-builder-tool-activity="succeeded"]');
    expect(requested).toBeNull();
    expect(completed).not.toBeNull();
    expect(completed?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(completed?.textContent).toContain('Project check finished');
    expect(completed?.textContent).toContain('This project step finished.');
    expect(completed?.textContent).not.toContain('Read project context');
    expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.textContent)
      .toContain('I prepared a draft after reading the project context.');
    expect(container.textContent).not.toMatch(
      /builder-tool-call:|builder-run-step:|builder-run:|permission_admission|dispatch_admission|execution_admission|result_admission|raw_output_admission|revision_admission|summary_code|tool_call_id|step_id|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('maps tool result failures to ordinary status text', async () => {
    const { saved } = await snapshots();
    const activity = await toolActivity({
      status: 'failed',
      summary_code: 'output_rejected',
      display_summary: 'The tool output was not accepted.',
    });
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const completed = container.querySelector('[data-builder-tool-activity="failed"]');
    expect(completed).not.toBeNull();
    expect(completed?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(completed?.textContent).toContain('Project check needs attention');
    expect(completed?.textContent).toContain('could not safely use the information from this step');
    expect(completed?.textContent).not.toMatch(/tool|adapter|output|admission|summary_code|resource_kind|builder-tool-call:/iu);
  });

  it('maps unavailable tool results without exposing adapter language', async () => {
    const { saved } = await snapshots();
    const activity = await toolActivity({
      status: 'failed',
      summary_code: 'adapter_unavailable',
      display_summary: 'The tool was unavailable.',
    });
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const completed = container.querySelector('[data-builder-tool-activity="failed"]');
    expect(completed).not.toBeNull();
    expect(completed?.textContent).toContain('Project check needs attention');
    expect(completed?.textContent).toContain('This project step is not available yet.');
    expect(completed?.textContent).not.toMatch(/tool|adapter|output|admission|summary_code|resource_kind|builder-tool-call:/iu);
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
    expect(reviewStrip?.getAttribute('data-builder-review-layout')).toBe('desktop-stacked-actions');
    expect(reviewStrip?.textContent).toContain('Review before saving');
    expect(reviewStrip?.textContent).toContain('3 file changes: 1 added, 1 changed, 1 removed.');
    expect(reviewStrip?.textContent).toContain('Preview may be incomplete');
    expect(reviewStrip?.textContent).toContain('JavaScript');
    expect(reviewStrip?.textContent).not.toMatch(
      /<main>Old|<main>New|const added|const removed|review_id|sha256:|commit_oid|tree_oid|receipt/iu,
    );
    expect(container.querySelector('[data-builder-review-sidebar="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-changes-panel="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-changes-disclosure="true"]')).toBeNull();
    click(container, '[data-builder-review-open-changes="true"]');
    const changesPanel = container.querySelector('[data-builder-changes-panel="true"]');
    const changesFlow = container.querySelector('[data-builder-changes-flow="true"]');
    const changesDisclosure = container.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
    expect(changesPanel).not.toBeNull();
    expect(changesFlow).not.toBeNull();
    expect(changesPanel?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(changesPanel?.closest('[data-builder-review-sidebar="true"]')).toBeNull();
    expect(changesPanel?.closest('[data-builder-changes-flow="true"]')).toBe(changesFlow);
    expect(changesDisclosure).not.toBeNull();
    expect(changesDisclosure?.open).toBe(true);
    expect(document.activeElement).toBe(changesDisclosure);
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

  it('explains runtime-only 3D drafts when the static preview may look blank', async () => {
    const baseTree = await createSourceTree([
      { path: 'index.html', content: '<main>Old scene</main>\n' },
      { path: 'styles.css', content: 'main { color: black; }\n' },
    ]);
    const draftTree = await createSourceTree([
      { path: 'index.html', content: '<main><canvas id="stage"></canvas><script type="module" src="./src/scene.js"></script></main>\n' },
      { path: 'styles.css', content: 'canvas { inline-size: 100%; block-size: 420px; }\n' },
      { path: 'src/scene.js', content: 'import * as THREE from "three";\nfetch("https://example.com/model.glb");\nrequestAnimationFrame(() => undefined);\n' },
    ]);
    const draftReady = await draftSnapshotFromSourceTrees(baseTree, draftTree);
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a 3D page."
        snapshot={draftReady}
      />,
    );

    const review = container.querySelector('[data-builder-review-checkpoint="true"]');
    const limitation = container.querySelector('[data-builder-preview-limitation="true"]');
    expect(review?.textContent).toContain('If it looks blank');
    expect(review?.textContent).toContain('Three.js/WebGL');
    expect(review?.textContent).toContain('canvas animation');
    expect(limitation?.textContent).toContain('JavaScript modules');
    expect(limitation?.textContent).toContain('Three.js or WebGL');
    expect(limitation?.textContent).toContain('canvas or animation');
    expect(limitation?.textContent).toContain('external assets or requests');
    expect(container.textContent).not.toContain('model.glb');
    expect(container.textContent).not.toContain('src/scene.js');
    expect(container.textContent).not.toMatch(/sha256:|commit_oid|tree_oid|receipt/iu);
  });

  it('keeps draft review actions on a separate desktop row so summary text is not squeezed', async () => {
    const draftReady = await changedDraftSnapshot();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Update the saved project."
        snapshot={draftReady}
      />,
    );

    const review = container.querySelector('[data-builder-review-checkpoint="true"]');
    const copy = review?.querySelector('.cf-builder-review-copy');
    const actions = review?.querySelector('[data-builder-draft-review-actions="true"]');
    expect(review?.getAttribute('data-builder-review-layout')).toBe('desktop-stacked-actions');
    expect(copy).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(actions?.previousElementSibling).toBe(copy);
    expect(copy?.textContent).toContain('Review before saving');
    expect(copy?.textContent).toContain('file changes');
    expect(actions?.textContent).toContain('Changes');
    expect(actions?.textContent).toContain('Discard draft');
    expect(actions?.textContent).toContain('Save version');
    expect(review?.textContent).not.toMatch(
      /sha256:|commit_oid|tree_oid|receipt|review_id|provider|credential|ipc|schema/iu,
    );
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

    click(container, '[data-builder-review-open-changes="true"]');
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

    click(container, '[data-builder-review-open-changes="true"]');
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
    expect(container.querySelector('[data-builder-version-card="Version 1"] button'))
      .toBeNull();
    expect(container.querySelector('[data-builder-version-card="Version 1"] [data-builder-show-current-version="true"]'))
      .toBeNull();
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
        onInspectRevision={onInspectRevision}
        onSubmitInstruction={vi.fn()}
        onShowCurrentRevision={onShowCurrentRevision}
        snapshot={inspected}
      />,
    );
    expect(inspectedContainer.querySelector('[data-builder-history-preview="true"]')?.textContent)
      .toContain('Viewing Version 1');
    expect(inspectedContainer.textContent).toContain('Viewing a saved version');
    expect(inspectedContainer.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
      .toBe(true);
    expect(inspected.preview?.src_doc).toContain('<main>Earlier</main>');
    const previewFrame = inspectedContainer.querySelector('iframe');
    expect(previewFrame).not.toBeNull();
    expect(previewFrame?.getAttribute('srcdoc')).toContain('<main>Earlier</main>');
    expect(inspectedContainer.querySelector('[data-builder-version-card="Version 2"]')?.textContent)
      .toContain('Current');
    expect(inspectedContainer.querySelector('[data-builder-version-card="Version 2"] [data-builder-show-current-version="true"]'))
      .toBeNull();
    expect(inspectedContainer.querySelectorAll('[data-builder-show-current-version="true"]'))
      .toHaveLength(1);
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
      .toContain('Activity shows this draft summary only. Review appears only after Builder verifies and restores the files.');
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

    const planCard = container.querySelector('[data-builder-activity-card="Plan proposed"]');
    const planReady = container.querySelector('[data-builder-activity-card="Plan ready"]');
    const planActions = container.querySelector('[data-builder-plan-review-actions="true"]');
    expect(planCard?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(
      planCard?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('plain');
    expect(planCard?.textContent).toContain('Review the proposed plan before files change.');
    expect(planCard?.textContent).toContain('Approve this plan to let the assistant continue.');
    expect(planReady?.textContent).toContain('Plan ready.');
    expect(planActions).not.toBeNull();
    expect(planActions?.closest('[data-builder-activity-card="Plan proposed"]')).toBe(planCard);
    expect(planActions?.closest('[data-builder-activity-card="Plan ready"]')).toBeNull();
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

  it('keeps plan review actions single-shot while the decision is recording', async () => {
    const { saved } = await snapshots();
    const activity = await pendingPlanActivity();
    const onReviewPlan = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onReviewPlan={onReviewPlan}
        planReviewInFlight={{
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          turn_id: TURN_ID,
          run_id: RUN_ID,
        }}
        snapshot={saved}
      />,
    );

    const actions = container.querySelector('[data-builder-plan-review-actions="true"]');
    const approve = container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]');
    const reject = container.querySelector<HTMLButtonElement>('[data-builder-reject-plan="true"]');
    expect(actions?.getAttribute('data-builder-plan-review-state')).toBe('recording');
    expect(actions?.textContent).toContain('Recording your decision...');
    expect(approve?.disabled).toBe(true);
    expect(reject?.disabled).toBe(true);
    click(container, '[data-builder-approve-plan="true"]');
    click(container, '[data-builder-reject-plan="true"]');
    expect(onReviewPlan).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('keeps plan review retry visible after a decision could not be recorded', async () => {
    const { saved } = await snapshots();
    const activity = await pendingPlanActivity();
    const onReviewPlan = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onReviewPlan={onReviewPlan}
        planReviewFailure={{
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          turn_id: TURN_ID,
          run_id: RUN_ID,
        }}
        snapshot={saved}
      />,
    );

    const actions = container.querySelector('[data-builder-plan-review-actions="true"]');
    expect(actions?.getAttribute('data-builder-plan-review-state')).toBe('failed');
    expect(actions?.querySelector('[role="alert"]')?.textContent)
      .toContain('That decision could not be recorded. Try again.');
    expect(container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]')?.disabled)
      .toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[data-builder-reject-plan="true"]')?.disabled)
      .toBe(false);
    click(container, '[data-builder-approve-plan="true"]');
    expect(onReviewPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
      decision: 'approved',
    });
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential|ipc|schema|receipt/iu,
    );
  });

  it('keeps plan review actions locked after a decision was recorded locally', async () => {
    const { saved } = await snapshots();
    const activity = await pendingPlanActivity();
    const onReviewPlan = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onReviewPlan={onReviewPlan}
        planReviewRecorded={{
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          turn_id: TURN_ID,
          run_id: RUN_ID,
        }}
        snapshot={saved}
      />,
    );

    const actions = container.querySelector('[data-builder-plan-review-actions="true"]');
    expect(actions?.getAttribute('data-builder-plan-review-state')).toBe('recorded');
    expect(actions?.textContent).toContain('Decision recorded. Updating the conversation...');
    expect(container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]')?.disabled)
      .toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-builder-reject-plan="true"]')?.disabled)
      .toBe(true);
    click(container, '[data-builder-approve-plan="true"]');
    click(container, '[data-builder-reject-plan="true"]');
    expect(onReviewPlan).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential|ipc|schema|receipt/iu,
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
    expect(container.querySelector('[data-builder-source-flow="true"]')?.classList.contains('cf-builder-chat-flow-surface'))
      .toBe(true);
    expect(container.querySelector('details[data-builder-source-flow="true"]')?.getAttribute('open'))
      .toBe('');
    expect(container.querySelector('[data-builder-source-file="src/tool.py"]')?.getAttribute('data-active'))
      .toBe('true');
    expect(container.querySelector('[data-builder-source-code="src/tool.py"] code')?.textContent)
      .toContain('print("hello")');
    expect(container.textContent).not.toContain('app.js');
  });

  it('keeps source files accessible but collapsed when a project has no static preview', async () => {
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
    expect(container.querySelector('[data-builder-result-flow="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('Preview unavailable');
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('files were generated');
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('live preview support');
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')?.textContent)
      .toContain('Preview unavailable');
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')?.textContent)
      .toContain('need live preview support');
    const source = container.querySelector<HTMLDetailsElement>('details[data-builder-source-flow="true"]');
    expect(source).not.toBeNull();
    expect(source?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(source?.getAttribute('open')).toBeNull();
    expect(source?.querySelector('[data-builder-source-summary="true"]')?.textContent)
      .toContain('1 file - src/tool.py');
    expect(container.querySelector('[data-builder-source-code="src/tool.py"]')).toBeNull();
    expect(container.textContent).not.toContain('print("new")');
    expect(container.textContent).toContain('this preview cannot run this kind of project yet');
    expect(container.textContent).toContain('3D/WebGL');
    expect(container.textContent).not.toContain('This project has files, but no visual preview.');

    click(container, '[data-builder-source-summary="true"]');
    expect(source?.open).toBe(true);
    expect(container.querySelector('[data-builder-source-code="src/tool.py"] code')?.textContent)
      .toContain('print("new")');
  });

  it('keeps the provider-settings recovery action limited to configuration failures', async () => {
    const { fresh } = await snapshots();
    const controller = createBuilderProjectController({
      generator: {
        submit: async () => {
          const error = Object.assign(new Error(), {
            code: 'builder_generation_provider_unavailable',
          });
          throw error;
        },
        generate: async () => {
          const error = Object.assign(new Error(), {
            code: 'builder_generation_provider_unavailable',
          });
          throw error;
        },
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        retry: async () => null,
        answer: async () => null,
        restoreDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async () => null,
        steer: async () => null,
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
        submit: async (request) => createGenerationDraft(request),
        generate: async (request) => createGenerationDraft(request),
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        retry: async (request) => createGenerationDraft(request),
        answer: async () => null,
        restoreDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async () => null,
        steer: async () => null,
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
