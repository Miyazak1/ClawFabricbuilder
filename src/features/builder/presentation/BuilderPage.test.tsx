import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  BuilderProjectControllerSnapshot,
  BuilderProjectControllerStatus,
} from '../application/builderProjectController';
import {
  BUILDER_CODE_GENERATOR_AUTHORITY,
  BUILDER_CODE_PROJECT_PROMPT_VERSION,
  BUILDER_GENERATION_REQUEST_PROTOCOL,
  BUILDER_GENERATION_RESULT_PROTOCOL,
  createBuilderProjectRevision,
  digestBuilderProjectProposal,
  type BuilderProjectProposal,
  type BuilderProjectRevision,
} from '../domain/builderProject';
import {
  createBuilderStaticPreview,
  type BuilderStaticPreviewProjection,
} from '../preview/builderStaticPreview';
import { BuilderPage, type BuilderPageProps } from './BuilderPage';

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;
const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];
const BUSY_STATUSES = new Set<BuilderProjectControllerStatus>([
  'opening',
  'generating',
  'committing',
  'reopening',
]);

let savedRevision!: BuilderProjectRevision;
let savedPreview!: BuilderStaticPreviewProjection;
let alternatePreview!: BuilderStaticPreviewProjection;

function proposal(): BuilderProjectProposal {
  return {
    kind: 'builder_code_project',
    title: 'Focus timer',
    summary: 'A small focus timer.',
    files: {
      'index.html': '<main>Timer</main>',
      'styles.css': 'main { color: red; }',
      'app.js': 'const timer = 1;',
    },
  };
}

beforeAll(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const candidate = proposal();
  savedRevision = await createBuilderProjectRevision({
    projectId: PROJECT_ID,
    proposal: candidate,
    requestDigest: REQUEST_DIGEST,
    proposalEvidence: {
      authority: BUILDER_CODE_GENERATOR_AUTHORITY,
      prompt_version: BUILDER_CODE_PROJECT_PROMPT_VERSION,
      request_version: BUILDER_GENERATION_REQUEST_PROTOCOL,
      result_version: BUILDER_GENERATION_RESULT_PROTOCOL,
      request_digest: REQUEST_DIGEST,
      proposal_digest: await digestBuilderProjectProposal(candidate),
      project_id: PROJECT_ID,
      target_revision: 1,
      parent_revision: null,
    },
  });
  savedPreview = await createBuilderStaticPreview(savedRevision);
  const alternate = proposal();
  alternate.title = 'Different timer';
  const alternateRevision = await createBuilderProjectRevision({
    projectId: PROJECT_ID,
    proposal: alternate,
    requestDigest: REQUEST_DIGEST,
    proposalEvidence: {
      authority: BUILDER_CODE_GENERATOR_AUTHORITY,
      prompt_version: BUILDER_CODE_PROJECT_PROMPT_VERSION,
      request_version: BUILDER_GENERATION_REQUEST_PROTOCOL,
      result_version: BUILDER_GENERATION_RESULT_PROTOCOL,
      request_digest: REQUEST_DIGEST,
      proposal_digest: await digestBuilderProjectProposal(alternate),
      project_id: PROJECT_ID,
      target_revision: 1,
      parent_revision: null,
    },
  });
  alternatePreview = await createBuilderStaticPreview(alternateRevision);
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function render(element: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  act(() => root.render(element));
  return container;
}

function snapshot(
  status: BuilderProjectControllerStatus,
  overrides: Partial<BuilderProjectControllerSnapshot> = {},
): BuilderProjectControllerSnapshot {
  const error = status === 'generation_failed'
    || status === 'save_unverified'
    || status === 'preview_unavailable'
    || status === 'conflict'
    || status === 'unavailable'
    ? status
    : null;
  return Object.freeze({
    status,
    busy: BUSY_STATUSES.has(status),
    savedRevision: null,
    preview: null,
    error,
    ...overrides,
  });
}

function props(overrides: Partial<BuilderPageProps> = {}): BuilderPageProps {
  return {
    idea: '',
    onIdeaChange: vi.fn(),
    onGenerate: vi.fn(),
    snapshot: snapshot('new'),
    activeFile: 'index.html',
    onSelectFile: vi.fn(),
    ...overrides,
  };
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.includes(text));
}

function previewSafetyNotes(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-builder-preview-safety-note="true"]'));
}

describe('BuilderPage', () => {
  it('renders the standalone Builder workspace without pretending a draft exists', () => {
    const container = render(<BuilderPage {...props()} />);

    expect(container.querySelector('[data-builder-page="true"]')).not.toBeNull();
    expect(container.querySelector('.cf-builder-surface-toolbar')).not.toBeNull();
    expect(container.querySelector('.cf-builder-surface-body')).not.toBeNull();
    expect(container.querySelector('.cf-builder-composer-card')).not.toBeNull();
    expect(container.querySelector('[data-builder-composer="true"]')).not.toBeNull();
    expect(container.querySelector('.cf-builder-output-panel')).not.toBeNull();
    expect(container.querySelector('.cf-builder-output-toolbar')).not.toBeNull();
    expect(container.querySelector('.cf-builder-stage-grid')).not.toBeNull();
    expect(container.querySelector('.cf-builder-tab-strip')).not.toBeNull();
    expect(container.querySelector('.cf-builder-code-panel')).not.toBeNull();
    expect(container.querySelector('.cf-builder-preview-panel')).not.toBeNull();
    expect(container.querySelector('.cf-builder-preview-panel')?.compareDocumentPosition(
      container.querySelector('.cf-builder-code-panel') as Element,
    )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(container.querySelector('.cf-builder-output-panel')?.compareDocumentPosition(
      container.querySelector('.cf-builder-composer-card') as Element,
    )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(container.querySelector('h1')?.textContent).toBe('New project');
    expect(buttonWithText(container, 'Make it')?.disabled).toBe(true);
    expect(container.textContent).toContain('Your preview will appear here.');
    expect(previewSafetyNotes(container)).toHaveLength(1);
    expect(previewSafetyNotes(container)[0].textContent).toBe('Preview is isolated for safety.');
    expect(previewSafetyNotes(container)[0].textContent).not.toMatch(/HTML|CSS|app\.js|does not run|runtime|schema|IPC/i);
    expect(container.textContent).not.toContain('Version 1');
  });

  it('derives the saved project, code, and preview from one controller snapshot', () => {
    const onIdeaChange = vi.fn();
    const onGenerate = vi.fn();
    const onSelectFile = vi.fn();
    const container = render(<BuilderPage {...props({
      idea: 'Make a timer',
      onIdeaChange,
      onGenerate,
      onSelectFile,
      snapshot: snapshot('ready', { savedRevision, preview: savedPreview }),
    })} />);

    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea?.className).toContain('cf-builder-input');
    act(() => {
      if (!textarea) throw new Error('Missing idea field');
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      if (!valueSetter) throw new Error('Missing textarea value setter');
      valueSetter.call(textarea, 'Make a calmer timer');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => buttonWithText(container, 'Update it')?.click());
    const cssTab = buttonWithText(container, 'CSS');
    act(() => cssTab?.click());

    expect(onIdeaChange).toHaveBeenCalledWith('Make a calmer timer');
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onSelectFile).toHaveBeenCalledWith('styles.css');
    expect(container.querySelector('h1')?.textContent).toBe('Focus timer');
    expect(container.textContent).toContain('Version 1');
    const currentVersions = container.querySelectorAll('[data-builder-current-version="true"]');
    expect(currentVersions).toHaveLength(1);
    expect(currentVersions[0].textContent?.trim()).toBe('Version 1');
    expect(container.querySelector('code')?.textContent).toBe('<main>Timer</main>');
    expect(container.querySelector('[data-builder-static-preview="true"]')).not.toBeNull();
    expect(container.querySelector('[role="tab"]')?.className).toContain('cf-builder-tab');
    expect(previewSafetyNotes(container)).toHaveLength(1);
    expect(previewSafetyNotes(container)[0].textContent).toBe('Preview is isolated for safety.');
  });

  it.each([
    ['opening', 'Opening...', 'Opening your project...'],
    ['generating', 'Making...', 'Making your draft...'],
    ['committing', 'Saving...', 'Saving your project...'],
    ['reopening', 'Saving...', 'Checking the saved version...'],
  ] as const)('renders %s as a disabled, accurately labelled busy state', (status, button, message) => {
    const onGenerate = vi.fn();
    const container = render(<BuilderPage {...props({
      idea: 'Make a clock',
      onGenerate,
      snapshot: snapshot(status),
    })} />);

    expect(buttonWithText(container, button)?.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(message);
    expect(buttonWithText(container, 'Check AI settings')).toBeUndefined();
    act(() => buttonWithText(container, button)?.click());
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('allows an explicit generation retry only after generation failure without inventing settings', () => {
    const onGenerate = vi.fn();
    const container = render(<BuilderPage {...props({
      idea: 'Make a clock',
      onGenerate,
      snapshot: snapshot('generation_failed'),
    })} />);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'The draft could not be made. Try again.',
    );
    expect(buttonWithText(container, 'Check AI settings')).toBeUndefined();
    expect(buttonWithText(container, 'Make it')?.disabled).toBe(false);
    act(() => buttonWithText(container, 'Make it')?.click());
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('offers an explicit settings command after generation failure when wired', () => {
    const onOpenSettings = vi.fn();
    const container = render(<BuilderPage {...props({
      idea: 'Make a clock',
      onOpenSettings,
      snapshot: snapshot('generation_failed'),
    })} />);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'The draft could not be made. Try again.',
    );
    act(() => buttonWithText(container, 'Check AI settings')?.click());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('offers only the safe save retry for an unverified save', () => {
    const onGenerate = vi.fn();
    const onRetrySave = vi.fn();
    const container = render(<BuilderPage {...props({
      idea: 'Change the timer',
      onGenerate,
      onRetrySave,
      snapshot: snapshot('save_unverified', { savedRevision, preview: savedPreview }),
    })} />);

    expect(buttonWithText(container, 'Update it')?.disabled).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.readOnly).toBe(true);
    expect(buttonWithText(container, 'Retry save')?.disabled).toBe(false);
    act(() => buttonWithText(container, 'Update it')?.click());
    act(() => buttonWithText(container, 'Retry save')?.click());
    expect(onGenerate).not.toHaveBeenCalled();
    expect(onRetrySave).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Version 1');
  });

  it('keeps saved code visible when only the preview is unavailable', () => {
    const container = render(<BuilderPage {...props({
      idea: 'Change the timer',
      snapshot: snapshot('preview_unavailable', { savedRevision }),
    })} />);

    expect(container.querySelector('code')?.textContent).toBe('<main>Timer</main>');
    expect(container.textContent).toContain('Version 1');
    expect(container.textContent).toContain('Your project was saved, but its preview is unavailable.');
    expect(container.textContent).toContain('Your preview will appear here.');
    expect(buttonWithText(container, 'Update it')?.disabled).toBe(true);
  });

  it.each([
    ['conflict', 'This project changed elsewhere. Reopen it before making more changes.'],
    ['unavailable', 'This project is unavailable.'],
  ] as const)('fails closed for %s without inventing recovery commands', (status, message) => {
    const onGenerate = vi.fn();
    const container = render(<BuilderPage {...props({
      idea: 'Change it',
      onGenerate,
      snapshot: snapshot(status, status === 'conflict' ? { savedRevision, preview: savedPreview } : {}),
    })} />);

    expect(container.textContent).toContain(message);
    expect(buttonWithText(container, status === 'conflict' ? 'Update it' : 'Make it')?.disabled).toBe(true);
    expect(buttonWithText(container, 'Retry save')).toBeUndefined();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('fails closed when callbacks or snapshot status are unavailable', () => {
    const noCallbacks = render(<BuilderPage {...props({
      idea: 'Make a clock',
      onIdeaChange: undefined,
      onGenerate: undefined,
      onSelectFile: undefined,
    })} />);
    expect(noCallbacks.querySelector<HTMLTextAreaElement>('#builder-idea')?.readOnly).toBe(true);
    expect(buttonWithText(noCallbacks, 'Make it')?.disabled).toBe(true);
    expect(buttonWithText(noCallbacks, 'Check AI settings')).toBeUndefined();
    expect(Array.from(noCallbacks.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .every((tab) => tab.disabled)).toBe(true);

    const forged = render(<BuilderPage {...props({
      snapshot: { ...snapshot('ready', { savedRevision, preview: savedPreview }), status: 'forged' } as never,
    })} />);
    expect(forged.querySelector('h1')?.textContent).toBe('New project');
    expect(forged.textContent).toContain('This project is unavailable.');
    expect(forged.textContent).not.toContain('Version 1');
    expect(forged.querySelector('code')?.textContent).toBe('');

    const inconsistent = render(<BuilderPage {...props({
      snapshot: Object.freeze({
        ...snapshot('ready', { savedRevision, preview: savedPreview }),
        busy: true,
      }),
    })} />);
    expect(inconsistent.textContent).toContain('This project is unavailable.');
    expect(inconsistent.textContent).not.toContain('Version 1');

    const mismatchedPreview = render(<BuilderPage {...props({
      snapshot: snapshot('ready', { savedRevision, preview: alternatePreview }),
    })} />);
    expect(mismatchedPreview.textContent).toContain('This project is unavailable.');
    expect(mismatchedPreview.textContent).not.toContain('Version 1');

    const impossiblePair = render(<BuilderPage {...props({
      snapshot: snapshot('generating', { savedRevision, preview: null }),
    })} />);
    expect(impossiblePair.textContent).toContain('This project is unavailable.');
    expect(impossiblePair.textContent).not.toContain('Version 1');
  });

  it('exposes a linked tabpanel and delegates keyboard file selection', () => {
    const onSelectFile = vi.fn();
    const container = render(<BuilderPage {...props({ onSelectFile })} />);
    const htmlTab = container.querySelector<HTMLButtonElement>('#builder-file-tab-html');
    const cssTab = container.querySelector<HTMLButtonElement>('#builder-file-tab-css');
    const panel = container.querySelector<HTMLElement>('#builder-code-panel');

    expect(htmlTab?.tabIndex).toBe(0);
    expect(cssTab?.tabIndex).toBe(-1);
    expect(htmlTab?.getAttribute('aria-controls')).toBe('builder-code-panel');
    expect(panel?.getAttribute('aria-labelledby')).toBe('builder-file-tab-html');
    act(() => htmlTab?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'ArrowRight',
    })));
    expect(onSelectFile).toHaveBeenCalledWith('styles.css');
    expect(document.activeElement).toBe(cssTab);
  });
});
