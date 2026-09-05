// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBuilderComposerRouteDecisionEvidence,
  decideBuilderComposerIntent,
} from '../application/builderComposerIntent';
import type { BuilderContextUsageProjectionWire } from '../domain/builderContextUsageProjection';
import { BuilderComposer, type BuilderComposerProps } from './BuilderComposer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION_ID =
  'builder-conversation:123e4567-e89b-42d3-a456-426614174000:323e4567-e89b-42d3-a456-426614174000';
const RUN_ID = 'builder-run:423e4567-e89b-42d3-a456-426614174000';

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

function click(container: HTMLElement, selector: string): void {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  act(() => button?.click());
}

function keyDown(container: HTMLElement, selector: string, init: KeyboardEventInit): KeyboardEvent {
  const target = container.querySelector<HTMLElement>(selector);
  expect(target).not.toBeNull();
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => target?.dispatchEvent(event));
  return event;
}

function documentKeyDown(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => document.dispatchEvent(event));
  return event;
}

function changeInput(container: HTMLElement, selector: string, value: string): void {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  expect(input).not.toBeNull();
  act(() => {
    if (input === null) return;
    const descriptor = Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function providerContextDisclosureStatus(
  overrides: Record<string, unknown> = {},
) {
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
    },
    ...overrides,
  } as const;
}

function contextUsageProjection(
  overrides: Partial<BuilderContextUsageProjectionWire> = {},
): BuilderContextUsageProjectionWire {
  return {
    projection_version: 'builder-context-usage-projection.v2',
    authority: 'main_owned_context_usage_projection',
    source: 'deepseek_harness_session_projection',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    run_id: RUN_ID,
    harness_projection_seq: 42,
    measurement_state: 'ready',
    uncached_input_tokens: 20_000,
    output_tokens: 5_000,
    cache_read_tokens: 180_000,
    cache_write_tokens: 0,
    pressure_tokens: 200_000,
    projected_tokens: 205_000,
    context_window_tokens: 258_000,
    usage_percent: 79,
    cache_hit_percent: 90,
    compaction_state: 'compacted',
    last_compacted_at_ms: 1_000,
    updated_at_ms: 1_100,
    ...overrides,
  } as BuilderContextUsageProjectionWire;
}

function expectSinglePrimaryAction(container: HTMLElement): HTMLButtonElement {
  const actions = container.querySelectorAll<HTMLButtonElement>(
    '.cf-builder-composer-actions [data-builder-composer-primary-action="true"]',
  );
  expect(actions).toHaveLength(1);
  return actions[0]!;
}

function props(overrides: Partial<BuilderComposerProps> = {}): BuilderComposerProps {
  return {
    busy: false,
    canAddContext: false,
    canCancel: false,
    canEditInstruction: true,
    canProposePlan: false,
    canSubmitComposer: true,
    hasUnsavedDraft: false,
    instruction: 'Make a timer.',
    status: 'new',
    viewingHistory: false,
    ...overrides,
  };
}

describe('BuilderComposer', () => {
  it('offers one icon-only Pause button without invoking Stop', () => {
    const onPauseTask = vi.fn();
    const onCancel = vi.fn();
    const container = render(<BuilderComposer {...props({ busy: true, status: 'generating', instruction: '',
      canSubmitComposer: false, canCancel: true, onPauseTask, onCancel })} />);
    const button = container.querySelector('[data-builder-pause-task="true"]');
    expect(button?.getAttribute('aria-label')).toBe('Pause task');
    expect(button?.textContent).toBe('');
    click(container, '[data-builder-pause-task="true"]');
    expect(onPauseTask).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows a paused composer and resumes explicitly by click or Enter', () => {
    const onResumeInterruptedRun = vi.fn();
    const onSubmitInstruction = vi.fn();
    const container = render(<BuilderComposer {...props({ paused: true, instruction: '',
      canSubmitComposer: false, onResumeInterruptedRun, onSubmitInstruction })} />);
    expect(container.querySelector('[data-builder-composer-state="paused"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-task-paused="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-resume-interrupted-run="true"]')?.getAttribute('title')).toBe('继续任务');
    expect(onResumeInterruptedRun).not.toHaveBeenCalled();
    click(container, '[data-builder-resume-interrupted-run="true"]');
    keyDown(container, 'textarea', { key: 'Enter' });
    expect(onResumeInterruptedRun).toHaveBeenCalledTimes(2);
    expect(onSubmitInstruction).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
  });

  it('sends edited instructions normally and never resumes while busy', () => {
    const onResumeInterruptedRun = vi.fn();
    const onSubmitInstruction = vi.fn();
    const container = render(<BuilderComposer {...props({ paused: true, instruction: 'Change the goal',
      canSubmitComposer: true, onResumeInterruptedRun, onSubmitInstruction })} />);
    expect(container.querySelector('[data-builder-resume-interrupted-run="true"]')).toBeNull();
    click(container, '[data-builder-submit-turn="true"]');
    expect(onSubmitInstruction).toHaveBeenCalledOnce();
    expect(onResumeInterruptedRun).not.toHaveBeenCalled();
    const busy = render(<BuilderComposer {...props({ paused: true, busy: true, instruction: '',
      canSubmitComposer: false, canCancel: true, onResumeInterruptedRun })} />);
    expect(busy.querySelector('[data-builder-resume-interrupted-run="true"]')).toBeNull();
  });
  it('keeps one send command for chat and build turns, including Enter submit', () => {
    const onSubmitInstruction = vi.fn();
    const onInstructionChange = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          onInstructionChange,
          onSubmitInstruction,
        })}
      />,
    );

    const composer = container.querySelector('[data-builder-composer="true"]');
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(composer).not.toBeNull();
    expect(textarea?.getAttribute('aria-label')).toBe('Ask a question, or describe what to build or change');
    expect(textarea?.placeholder).toBe('Ask a question, or describe what to build or change...');
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-builder-ask-question="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-make-draft="true"]')).toBeNull();

    const enter = keyDown(container, '#builder-idea', { key: 'Enter' });
    expect(enter.defaultPrevented).toBe(true);
    expect(onSubmitInstruction).toHaveBeenCalledOnce();

    changeInput(container, '#builder-idea', 'What does this project do?');
    expect(onInstructionChange).toHaveBeenCalledWith('What does this project do?');
  });

  it('keeps one primary composer action across idle and busy states', () => {
    const idleEmpty = render(
      <BuilderComposer
        {...props({
          canSubmitComposer: false,
          instruction: '',
        })}
      />,
    );

    const idleEmptyAction = expectSinglePrimaryAction(idleEmpty);
    expect(idleEmptyAction.getAttribute('data-builder-submit-turn')).toBe('true');
    expect(idleEmptyAction.getAttribute('aria-label')).toBe('Send');
    expect(idleEmptyAction.disabled).toBe(true);
    expect(idleEmpty.querySelector('[data-builder-cancel-work="true"]')).toBeNull();

    const busyEmpty = render(
      <BuilderComposer
        {...props({
          busy: true,
          canAddContext: true,
          canCancel: true,
          canSubmitComposer: false,
          instruction: '',
          status: 'answering',
        })}
      />,
    );

    const busyEmptyAction = expectSinglePrimaryAction(busyEmpty);
    expect(busyEmptyAction.getAttribute('data-builder-cancel-work')).toBe('true');
    expect(busyEmptyAction.getAttribute('aria-label')).toBe('Stop');
    expect(busyEmpty.querySelector('[data-builder-submit-turn="true"]')).toBeNull();

    const busyWithInput = render(
      <BuilderComposer
        {...props({
          busy: true,
          canAddContext: true,
          canCancel: true,
          canSubmitComposer: true,
          instruction: 'Also make the header smaller.',
          status: 'generating',
        })}
      />,
    );

    const busyWithInputAction = expectSinglePrimaryAction(busyWithInput);
    expect(busyWithInputAction.getAttribute('data-builder-submit-turn')).toBe('true');
    expect(busyWithInputAction.getAttribute('aria-label')).toBe('Add context');
    expect(busyWithInput.querySelector('[data-builder-cancel-work="true"]')).toBeNull();

    const busyLocked = render(
      <BuilderComposer
        {...props({
          busy: true,
          canAddContext: false,
          canCancel: false,
          canEditInstruction: false,
          canSubmitComposer: false,
          instruction: '',
          status: 'saving',
        })}
      />,
    );

    const busyLockedAction = expectSinglePrimaryAction(busyLocked);
    expect(busyLockedAction.getAttribute('data-builder-busy-work')).toBe('true');
    expect(busyLockedAction.getAttribute('aria-label')).toBe('Saving...');
    expect(busyLockedAction.disabled).toBe(true);
    expect(busyLocked.querySelector('[data-builder-submit-turn="true"]')).toBeNull();
    expect(busyLocked.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
  });

  it('keeps the composer focused after clicking send so follow-up typing can continue', async () => {
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          onSubmitInstruction,
        })}
      />,
    );

    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    const send = container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]');
    expect(textarea).not.toBeNull();
    expect(send).not.toBeNull();

    act(() => textarea?.focus());
    expect(document.activeElement).toBe(textarea);
    act(() => send?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    act(() => send?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(onSubmitInstruction).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(textarea);
  });

  it('restores composer focus after a locked busy submit cycle finishes', async () => {
    function FocusHarness() {
      const [busy, setBusy] = useState(false);
      const [instruction, setInstruction] = useState('Ask a question.');
      return (
        <BuilderComposer
          {...props({
            busy,
            canEditInstruction: !busy,
            canSubmitComposer: instruction.trim().length > 0 && !busy,
            instruction,
            onInstructionChange: setInstruction,
            onSubmitInstruction: () => {
              setInstruction('');
              setBusy(true);
              window.setTimeout(() => setBusy(false), 0);
            },
            status: busy ? 'answering' : 'new',
          })}
        />
      );
    }
    const container = render(<FocusHarness />);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    const send = container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]');
    expect(textarea).not.toBeNull();
    expect(send).not.toBeNull();

    act(() => textarea?.focus());
    expect(document.activeElement).toBe(textarea);
    act(() => send?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    act(() => send?.click());

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.disabled).toBe(false);
    expect(document.activeElement).toBe(container.querySelector<HTMLTextAreaElement>('#builder-idea'));
  });

  it('does not expose project or folder picking from the composer surface', () => {
    const container = render(<BuilderComposer {...props()} />);

    expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-clear-workspace-selection="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-context-bar="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Choose or create a project before I build.');
    expect(container.textContent).not.toContain('Source folder: site-source');
  });

  it('keeps the add menu focused on composer modes instead of folder selection', () => {
    const container = render(
      <BuilderComposer
        {...props({
          canProposePlan: true,
          canSubmitComposer: false,
          instruction: '',
        })}
      />,
    );

    click(container, '[data-builder-composer-add-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-add-files="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-add-ask-mode="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-composer-add-plan-mode="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-composer-add-build-mode="true"]')).not.toBeNull();
  });

  it('projects safe working context status chips in the composer footer', () => {
    const ready = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'ready_to_execute',
          instruction: '',
        })}
      />,
    );

    const readyStatus = ready.querySelector('[data-builder-composer-status="true"]');
    expect(readyStatus).toBeNull();
    expect(ready.textContent).not.toContain('Ready to execute current direction');
    const readyContext = ready.querySelector('[data-builder-composer-context-button="true"]');
    expect(readyContext?.getAttribute('aria-label'))
      .toBe('Context: Ready to execute current direction');
    expect(readyContext?.getAttribute('data-builder-composer-context-budget-state'))
      .toBe('not_measured');
    const readyTooltip = ready.querySelector('[data-builder-composer-context-tooltip="true"]');
    expect(readyTooltip?.textContent).toContain('Context window');
    expect(readyTooltip?.textContent).toContain('Not measured');
    expect(readyTooltip?.textContent).toContain('Token usage unavailable');
    click(ready, '[data-builder-composer-context-button="true"]');
    const readyPopover = ready.querySelector('[data-builder-composer-context-popover="true"]');
    expect(readyPopover?.textContent).toContain('State');
    expect(readyPopover?.textContent).toContain('Ready to execute current direction');
    expect(ready.querySelector('[data-builder-approval-mode-chip="true"]')).toBeNull();
    expect(ready.querySelector('[data-builder-composer-context-bar="true"]')).toBeNull();
    expect(ready.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    expect(ready.querySelector('[data-builder-composer-context-pills="true"]')).toBeNull();
    expect(ready.querySelector('[data-builder-submit-turn="true"]')).not.toBeNull();

    const approved = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'using_approved_plan',
          instruction: '',
        })}
      />,
    );

    expect(approved.querySelector('[data-builder-composer-status="true"]')?.textContent)
      .toContain('Using approved plan');
    expect(approved.querySelector('[data-builder-composer-status="true"]')?.closest('.cf-builder-composer-footer'))
      .not.toBeNull();
    expect(approved.textContent).not.toMatch(/Brief|WorkingContext|Task Capsule|receipt|provider|credential/iu);

    const changed = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'direction_changed',
          instruction: '',
        })}
      />,
    );
    expect(changed.querySelector('[data-builder-composer-status="true"]')?.textContent)
      .toContain('Direction changed');

    const confirmation = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'needs_confirmation',
          instruction: '',
        })}
      />,
    );
    expect(confirmation.querySelector('[data-builder-composer-status="true"]')?.textContent)
      .toContain('Needs confirmation');

    const handoff = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'handoff_received',
          instruction: '',
        })}
      />,
    );
    const handoffStatus = handoff.querySelector('[data-builder-composer-status="true"]');
    expect(handoffStatus?.textContent).toContain('Handoff received');
    expect(handoffStatus?.getAttribute('data-builder-composer-context-status')).toBe('handoff_received');
    expect(handoff.textContent).not.toMatch(/builder-handoff-packet|WorkingContext|sha256:|provider|credential/iu);
  });

  it('shows provider context disclosure status as the current safe composer status', () => {
    const container = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'ready_to_execute',
          contextUsageProjection: contextUsageProjection(),
          instruction: '',
          providerContextDisclosureStatus: providerContextDisclosureStatus(),
        })}
      />,
    );

    const status = container.querySelector('[data-builder-composer-status="true"]');
    expect(status?.textContent).toContain('Allow AI to use current context');
    expect(status?.getAttribute('data-builder-composer-provider-context-status')).toBe('needs_approval');
    expect(status?.getAttribute('data-builder-composer-context-status')).toBeNull();
    expect(status?.getAttribute('title')).toBe('Allow AI to use current context');
    expect(container.textContent).not.toContain('Ready to execute current direction');
    expect(container.textContent)
      .not.toMatch(/builder-provider-context|builder-context-assembly|sha256:|provider_secret|credential|permission_id/iu);

    const meter = container.querySelector('[data-builder-composer-context-button="true"]');
    expect(meter?.getAttribute('data-builder-composer-context-budget-state')).toBe('available');
    expect(meter?.getAttribute('data-builder-composer-context-pressure')).toBe('200000');
    expect(meter?.getAttribute('data-builder-composer-context-projected')).toBe('205000');
    expect(meter?.getAttribute('data-builder-composer-context-limit')).toBe('258000');
    expect(meter?.getAttribute('data-builder-composer-context-compaction')).toBe('compacted');
    expect(meter?.getAttribute('data-builder-composer-context-measurement')).toBe('ready');
    const tooltip = container.querySelector('[data-builder-composer-context-tooltip="true"]');
    expect(tooltip?.textContent).toContain('79% used');
    expect(tooltip?.textContent).toContain('205k / 258k tokens');
    expect(tooltip?.textContent).toContain('Provider prompt 200k · Projected 205k');
    expect(tooltip?.textContent).toContain('Uncached 20k · Output 5k');
    expect(tooltip?.textContent).toContain('Cache hit 90% · Read 180k · Write 0');
    expect(tooltip?.textContent).toContain('Last compacted');

    click(container, '[data-builder-composer-status="true"]');
    const popover = container.querySelector('[data-builder-composer-context-popover="true"]');
    expect(popover?.textContent).toContain('Allow Builder to build with current context');
    expect(popover?.textContent).toContain('Segments');
    expect(popover?.textContent).toContain('3');
    expect(popover?.textContent).toContain('Budget');
    expect(popover?.textContent).toContain('512/4096 bytes');
    expect(popover?.textContent).toContain('Workspace gate');
    expect(popover?.textContent).toContain('Bound');
    expect(popover?.textContent).toContain('Write gate');
    expect(popover?.textContent).toContain('Ask');
    expect(popover?.textContent)
      .not.toMatch(/configured AI provider|provider_scope|provider_secret|credential|sha256:|permission_id/iu);
  });

  it('shows live compaction state and the post-compaction token drop', () => {
    const compacting = render(
      <BuilderComposer
        {...props({
          contextUsageProjection: contextUsageProjection({ compaction_state: 'compacting' }),
          instruction: '',
        })}
      />,
    );
    const compactingMeter = compacting.querySelector('[data-builder-composer-context-button="true"]');
    expect(compactingMeter?.getAttribute('data-builder-composer-context-compaction'))
      .toBe('compacting');
    expect(compacting.textContent).toContain('79% used · Compacting');

    const refreshing = render(
      <BuilderComposer
        {...props({
          contextUsageProjection: contextUsageProjection({
            measurement_state: 'awaiting_post_compaction_projection',
          }),
          instruction: '',
        })}
      />,
    );
    expect(refreshing.textContent).toContain('79% last measured · Refreshing');

    const compacted = render(
      <BuilderComposer
        {...props({
          contextUsageProjection: contextUsageProjection({
            measurement_state: 'ready',
            harness_projection_seq: 52,
            uncached_input_tokens: 22_000,
            output_tokens: 1_000,
            cache_read_tokens: 190_000,
            pressure_tokens: 30_000,
            projected_tokens: 31_000,
            usage_percent: 12,
          }),
          instruction: '',
        })}
      />,
    );
    const compactedMeter = compacted.querySelector('[data-builder-composer-context-button="true"]');
    expect(compactedMeter?.getAttribute('data-builder-composer-context-pressure')).toBe('30000');
    expect(compactedMeter?.getAttribute('data-builder-composer-context-projected')).toBe('31000');
    expect(compactedMeter?.getAttribute('data-builder-composer-context-measurement')).toBe('ready');
    expect(compacted.textContent).toContain('12% used');
    expect(compacted.textContent).toContain('31k / 258k tokens');
  });

  it('requests manual context compaction from the task context popover only while idle', () => {
    const onManualCompactContext = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          canManualCompactContext: true,
          contextUsageProjection: contextUsageProjection(),
          instruction: '',
          onManualCompactContext,
        })}
      />,
    );

    click(container, '[data-builder-composer-context-button="true"]');
    const action = container.querySelector<HTMLButtonElement>(
      '[data-builder-composer-manual-compact-context="true"]',
    );
    expect(action).not.toBeNull();
    expect(action?.disabled).toBe(false);
    expect(action?.textContent).toContain('Compact now');

    click(container, '[data-builder-composer-manual-compact-context="true"]');
    expect(onManualCompactContext).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-builder-composer-context-popover="true"]')).toBeNull();

    const compacting = render(
      <BuilderComposer
        {...props({
          canManualCompactContext: true,
          contextUsageProjection: contextUsageProjection({ compaction_state: 'compacting' }),
          instruction: '',
          onManualCompactContext,
        })}
      />,
    );
    click(compacting, '[data-builder-composer-context-button="true"]');
    expect(compacting.querySelector<HTMLButtonElement>(
      '[data-builder-composer-manual-compact-context="true"]',
    )?.disabled).toBe(true);

    const localCompacting = render(
      <BuilderComposer
        {...props({
          canManualCompactContext: true,
          contextUsageProjection: contextUsageProjection(),
          instruction: '',
          manualContextCompactionFeedback: 'compacting',
          onManualCompactContext,
        })}
      />,
    );
    click(localCompacting, '[data-builder-composer-context-button="true"]');
    const localCompactingAction = localCompacting.querySelector<HTMLButtonElement>(
      '[data-builder-composer-manual-compact-context="true"]',
    );
    expect(localCompactingAction?.disabled).toBe(true);
    expect(localCompactingAction?.getAttribute('data-builder-composer-manual-compact-state')).
      toBe('compacting');
    expect(localCompactingAction?.textContent).toContain('Compacting...');
    expect(localCompacting.querySelector(
      '[data-builder-composer-manual-compact-feedback="compacting"]',
    )?.textContent).toContain('Manual compaction is running.');

    const notNeeded = render(
      <BuilderComposer
        {...props({
          canManualCompactContext: true,
          contextUsageProjection: contextUsageProjection(),
          instruction: '',
          manualContextCompactionFeedback: 'not_needed',
          onManualCompactContext,
        })}
      />,
    );
    click(notNeeded, '[data-builder-composer-context-button="true"]');
    expect(notNeeded.querySelector(
      '[data-builder-composer-manual-compact-feedback="not_needed"]',
    )?.textContent).toContain('No new compaction was needed.');

    const failed = render(
      <BuilderComposer
        {...props({
          canManualCompactContext: true,
          contextUsageProjection: contextUsageProjection(),
          instruction: '',
          manualContextCompactionFeedback: 'failed',
          onManualCompactContext,
        })}
      />,
    );
    click(failed, '[data-builder-composer-context-button="true"]');
    expect(failed.querySelector(
      '[data-builder-composer-manual-compact-feedback="failed"]',
    )?.textContent).toContain('Manual compaction failed.');

    const workbench = render(
      <BuilderComposer
        {...props({
          canManualCompactContext: true,
          contextUsageProjection: contextUsageProjection(),
          instruction: '',
          onManualCompactContext,
          surfaceKind: 'workbench',
        })}
      />,
    );
    click(workbench, '[data-builder-composer-context-button="true"]');
    expect(workbench.querySelector('[data-builder-composer-manual-compact-context="true"]')).
      toBeNull();
  });

  it('switches configured composer models through a digest-bound model request', () => {
    const onSelectModel = vi.fn();
    const digest = `sha256:${'a'.repeat(64)}`;
    const container = render(<BuilderComposer {...props({
      modelSelection: { configDigest: digest, model: 'deepseek-v4-flash', status: 'ready' },
      onSelectModel,
    })} />);

    expect(container.querySelector('[data-builder-composer-model-menu-button="true"]')?.textContent)
      .toContain('V4 Flash');
    click(container, '[data-builder-composer-model-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-model-menu="true"]')?.textContent).toContain('V4 Pro');
    click(container, '[data-builder-composer-model-option="deepseek-v4-pro"]');
    expect(onSelectModel).toHaveBeenCalledExactlyOnceWith('deepseek-v4-pro', digest);
    expect(JSON.stringify(onSelectModel.mock.calls[0])).not.toMatch(/credential|secret/i);
  });

  it('keeps model switching unavailable until provider settings are configured', () => {
    const onOpenSettings = vi.fn();
    const onSelectModel = vi.fn();
    const container = render(<BuilderComposer {...props({
      modelSelection: { configDigest: null, model: null, status: 'unconfigured' },
      onOpenSettings,
      onSelectModel,
    })} />);

    click(container, '[data-builder-composer-model-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-model-menu="true"]')?.textContent)
      .toContain('Configure the AI provider in Settings');
    expect(container.querySelector<HTMLButtonElement>('[data-builder-composer-model-option="deepseek-v4-pro"]')?.disabled)
      .toBe(true);
    click(container, '.cf-builder-composer-model-settings');
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it('keeps selected workspace clearing out of the composer', () => {
    const container = render(<BuilderComposer {...props()} />);

    const clear = container.querySelector<HTMLButtonElement>('[data-builder-clear-workspace-selection="true"]');
    const workspaceOrigin = container.querySelector('[data-builder-workspace-origin="true"]');
    expect(clear).toBeNull();
    expect(workspaceOrigin).toBeNull();
    expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
  });

  it('does not offer workspace clearing while an unsaved draft is awaiting review', () => {
    const container = render(
      <BuilderComposer
        {...props({
          hasUnsavedDraft: true,
        })}
      />,
    );

    expect(container.querySelector('[data-builder-clear-workspace-selection="true"]')).toBeNull();
  });

  it('uses the add menu for Plan mode without adding another send command', () => {
    const onSelectPlanMode = vi.fn();
    const onSelectApprovalMode = vi.fn();
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          canAllowCurrentProjectApproval: true,
          canProposePlan: true,
          onSelectApprovalMode,
          onSelectPlanMode,
          onSubmitInstruction,
        })}
      />,
    );

    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Plan first');
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();

    click(container, '[data-builder-composer-add-menu-button="true"]');

    const menu = container.querySelector('[data-builder-composer-add-menu="true"]');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).not.toContain('Files and folders');
    expect(menu?.textContent).not.toContain('Brief');
    expect(menu?.textContent).toContain('Plan mode');
    expect(menu?.textContent).not.toContain('Approval mode');
    expect(menu?.textContent).not.toContain('Read-only chat');
    expect(menu?.textContent).not.toContain('Ask before write');
    expect(menu?.textContent).not.toContain('Allow current project');

    expect(container.querySelector('[data-builder-composer-add-brief="true"]')).toBeNull();
    expect(onSelectPlanMode).not.toHaveBeenCalled();
    expect(onSelectApprovalMode).not.toHaveBeenCalled();
    expect(onSubmitInstruction).not.toHaveBeenCalled();

    click(container, '[data-builder-composer-add-plan-mode="true"]');

    expect(onSelectPlanMode).toHaveBeenCalledOnce();
    expect(onSelectApprovalMode).not.toHaveBeenCalled();
    expect(onSubmitInstruction).not.toHaveBeenCalled();
  });

  it('selects approval mode from its own menu without adding another send command', () => {
    const onSelectApprovalMode = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          approvalMode: 'ask_before_write',
          canAllowCurrentProjectApproval: true,
          onSelectApprovalMode,
        })}
      />,
    );

    expect(container.querySelector('[data-builder-approval-mode-chip="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-approval-menu-button="true"]')?.textContent)
      .toContain('Ask before write');
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);

    click(container, '[data-builder-composer-approval-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-approval-menu="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-composer-approval-mode-option="ask_before_write"]')
      ?.getAttribute('aria-checked')).toBe('true');
    click(container, '[data-builder-composer-approval-mode-option="read_only_chat"]');

    expect(onSelectApprovalMode).toHaveBeenCalledExactlyOnceWith('read_only_chat');
    expect(container.querySelector('[data-builder-composer-approval-menu="true"]')).toBeNull();
  });

  it('closes composer popovers when clicking outside them', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const container = render(
      <BuilderComposer
        {...props({
          modelSelection: { configDigest: digest, model: 'deepseek-v4-flash', status: 'ready' },
          providerContextDisclosureStatus: providerContextDisclosureStatus(),
        })}
      />,
    );

    click(container, '[data-builder-composer-add-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).not.toBeNull();
    click(container, '[data-builder-composer-approval-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-approval-menu="true"]')).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-approval-menu="true"]')).toBeNull();

    click(container, '[data-builder-composer-status="true"]');
    expect(container.querySelector('[data-builder-composer-context-popover="true"]')).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('[data-builder-composer-context-popover="true"]')).toBeNull();

    click(container, '[data-builder-composer-model-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-model-menu="true"]')).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('[data-builder-composer-model-menu="true"]')).toBeNull();
  });

  it('closes composer popovers with Escape and returns focus to the composer', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const container = render(
      <BuilderComposer
        {...props({
          modelSelection: { configDigest: digest, model: 'deepseek-v4-flash', status: 'ready' },
          providerContextDisclosureStatus: providerContextDisclosureStatus(),
        })}
      />,
    );
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();

    click(container, '[data-builder-composer-status="true"]');
    expect(container.querySelector('[data-builder-composer-context-popover="true"]')).not.toBeNull();
    const contextEscape = documentKeyDown({ key: 'Escape' });
    expect(contextEscape.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-builder-composer-context-popover="true"]')).toBeNull();
    expect(document.activeElement).toBe(textarea);

    click(container, '[data-builder-composer-add-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).not.toBeNull();
    const addMenuEscape = documentKeyDown({ key: 'Escape' });
    expect(addMenuEscape.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-builder-composer-add-menu="true"]')).toBeNull();
    expect(document.activeElement).toBe(textarea);

    click(container, '[data-builder-composer-approval-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-approval-menu="true"]')).not.toBeNull();
    const approvalMenuEscape = documentKeyDown({ key: 'Escape' });
    expect(approvalMenuEscape.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-builder-composer-approval-menu="true"]')).toBeNull();
    expect(document.activeElement).toBe(textarea);

    click(container, '[data-builder-composer-model-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-model-menu="true"]')).not.toBeNull();
    const modelMenuEscape = documentKeyDown({ key: 'Escape' });
    expect(modelMenuEscape.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-builder-composer-model-menu="true"]')).toBeNull();
    expect(document.activeElement).toBe(textarea);
  });

  it('keeps allow-current-project disabled until a project is selected', () => {
    const onSelectApprovalMode = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          approvalMode: 'ask_before_write',
          canAllowCurrentProjectApproval: false,
          onSelectApprovalMode,
        })}
      />,
    );

    click(container, '[data-builder-composer-approval-menu-button="true"]');

    const allowCurrent = container.querySelector<HTMLButtonElement>(
      '[data-builder-composer-approval-mode-option="allow_current_project"]',
    );
    expect(allowCurrent?.disabled).toBe(true);
    click(container, '[data-builder-composer-approval-mode-option="allow_current_project"]');
    expect(onSelectApprovalMode).not.toHaveBeenCalled();
  });

  it('shows a removable Plan mode chip as mode state rather than a second send button', () => {
    const onClearComposerMode = vi.fn();
    const onSelectPlanMode = vi.fn();
    const container = render(
      <BuilderComposer
        {...props({
          canProposePlan: true,
          composerMode: 'plan',
          onClearComposerMode,
          onSelectPlanMode,
        })}
      />,
    );

    const chip = container.querySelector('[data-builder-composer-mode-chip="plan"]');
    expect(chip?.textContent).toContain('Plan mode');
    expect(container.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);

    click(container, '[data-builder-clear-composer-mode="true"]');

    expect(onClearComposerMode).toHaveBeenCalledOnce();
    expect(onSelectPlanMode).not.toHaveBeenCalled();
  });

  it('projects the latest route decision without showing internal routing copy', () => {
    const decision = decideBuilderComposerIntent('创建登录页');
    const container = render(
      <BuilderComposer
        {...props({
          composerRouteDecision: createBuilderComposerRouteDecisionEvidence(decision, {
            decisionId: 'builder-composer-route-decision:local:1',
            messageId: 'builder-composer-message:local:1',
            projectId: PROJECT_ID,
            taskId: null,
            createdAt: '2026-07-31T02:30:00.000Z',
          }),
          instruction: '创建登录页',
        })}
      />,
    );

    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('ask_workspace');
    expect(composer?.getAttribute('data-builder-route-confidence')).toBe('high');
    expect(composer?.getAttribute('data-builder-route-downgrade')).toBe('workspace_required');
    expect(composer?.getAttribute('data-builder-route-active-run-input')).toBe('not_active');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('ask');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('clear_build');
    expect(composer?.getAttribute('data-builder-route-decision-id')).
      toBe('builder-composer-route-decision:local:1');
    expect(composer?.getAttribute('data-builder-route-message-id')).
      toBe('builder-composer-message:local:1');
    expect(composer?.getAttribute('data-builder-route-project-id')).toBe(PROJECT_ID);
    expect(composer?.getAttribute('data-builder-route-task-id')).toBeNull();
    expect(composer?.getAttribute('data-builder-route-created-at')).toBe('2026-07-31T02:30:00.000Z');
    expect(container.textContent).not.toMatch(
      /workspace_required|write_project|clear_build|ask_workspace|route-decision|composer-message/iu,
    );
  });

  it('keeps current brief memory out of the default composer UI', () => {
    const container = render(
      <BuilderComposer
        {...props({
          composerContextStatus: 'ready_to_execute',
          instruction: '',
        })}
      />,
    );

    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-clear-composer-brief="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Current brief');
    expect(container.textContent).not.toContain('starfield hero');
    expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Ready to execute current direction');
    expect(container.querySelector('[data-builder-composer-context-button="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);
  });
});
