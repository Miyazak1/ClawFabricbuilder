// @vitest-environment jsdom
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BuilderResultPanel } from './BuilderResultPanel';

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

describe('BuilderResultPanel', () => {
  it('preserves the chat-flow result shell around the static preview', () => {
    const panelRef = createRef<HTMLElement>();
    const container = render(<BuilderResultPanel panelRef={panelRef} projection={null} />);

    const panel = container.querySelector('[data-builder-result-flow="true"]');
    expect(panel).toBe(panelRef.current);
    expect(panel?.getAttribute('aria-label')).toBe('Project result');
    expect(panel?.getAttribute('id')).toBe('builder-tool-preview');
    expect(panel?.className).toContain('cf-builder-result-card');
    expect(container.querySelector('[data-builder-preview-flow="true"]')).toBe(panel);
    expect(container.querySelector('.cf-builder-result-toolbar')?.textContent).toContain('Result');
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('Preview unavailable');
  });

  it('renders expanded preview placement without the chat-flow surface', () => {
    const container = render(<BuilderResultPanel placement="expanded" projection={null} />);

    const panel = container.querySelector('[data-builder-result-placement="expanded"]');
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('cf-builder-expanded-preview-card');
    expect(panel?.className).not.toContain('cf-builder-chat-flow-surface');
    expect(panel?.className).not.toContain('cf-builder-flow-card');
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('Preview unavailable');
  });

  it('keeps artifact preview expansion in the result toolbar', () => {
    const onExpandPreview = vi.fn();
    const container = render(
      <BuilderResultPanel
        onExpandPreview={onExpandPreview}
        placement="artifact"
        projection={null}
      />,
    );

    const expand = container.querySelector<HTMLButtonElement>('[data-builder-expand-preview="true"]');
    expect(expand).not.toBeNull();
    expect(expand?.closest('.cf-builder-result-toolbar')).not.toBeNull();
    expect(expand?.closest('[data-builder-result-placement="artifact"]')).not.toBeNull();
    act(() => expand?.click());
    expect(onExpandPreview).toHaveBeenCalledOnce();
  });

  it('keeps unavailable live preview secondary and disabled without replacing static preview', () => {
    const onRequestLivePreview = vi.fn();
    const container = render(
      <BuilderResultPanel
        livePreviewStatus={{
          status_version: 'builder-live-preview-status-projection.v1',
          project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
          conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
          preview_kind: 'live_static_web',
          status: 'unavailable',
          can_start: false,
          can_reload: false,
          can_stop: false,
          message: 'Live preview is unavailable until a main-owned preview source resolver is connected.',
          unavailable_reason: 'preview_source_resolver_not_connected',
          updated_at_ms: 10,
          authority: {
            live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1',
            renderer_authority: 'current_project_conversation_only',
            active_renderer_required: true,
            source_tree_from_renderer: 'not_accepted',
            source_read: 'main_owned_preview_source_resolver_or_not_performed',
            source_write: 'not_performed',
            provider_dispatch: false,
            tool_dispatch: false,
            command_execution: false,
            git_mutation: false,
            sqlite_write: false,
            permission_grant: false,
            revision_admission: false,
            save_admission: false,
            electron_view_attachment: 'main_only_not_exposed_to_renderer',
            preview_content_ipc: false,
            node_integration: false,
            preload: false,
          },
        }}
        onRequestLivePreview={onRequestLivePreview}
        placement="artifact"
        projection={null}
      />,
    );

    expect(container.querySelector('[data-builder-preview-unavailable="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-live-preview-panel="true"]')).toBeNull();
    const liveMode = container.querySelector<HTMLButtonElement>('[data-builder-preview-mode="live"]');
    expect(liveMode?.disabled).toBe(true);
    expect(liveMode?.getAttribute('aria-label')).toBe('Browser preview unavailable');
    expect(liveMode?.getAttribute('aria-pressed')).toBe('false');
    act(() => liveMode?.click());
    expect(container.querySelector('[data-builder-live-preview-panel="true"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-builder-live-preview-start="true"]')?.disabled)
      .toBeUndefined();
    expect(onRequestLivePreview).not.toHaveBeenCalled();
  });

  it('enables live mode only after main reports usable preview controls', () => {
    const onRequestLivePreview = vi.fn();
    const container = render(
      <BuilderResultPanel
        livePreviewStatus={{
          status_version: 'builder-live-preview-status-projection.v1',
          project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
          conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
          preview_kind: 'live_static_web',
          status: 'idle',
          can_start: true,
          can_reload: false,
          can_stop: false,
          message: 'Browser preview is ready to start.',
          unavailable_reason: null,
          updated_at_ms: 20,
          authority: {
            live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1',
            renderer_authority: 'current_project_conversation_only',
            active_renderer_required: true,
            source_tree_from_renderer: 'not_accepted',
            source_read: 'main_owned_preview_source_resolver_or_not_performed',
            source_write: 'not_performed',
            provider_dispatch: false,
            tool_dispatch: false,
            command_execution: false,
            git_mutation: false,
            sqlite_write: false,
            permission_grant: false,
            revision_admission: false,
            save_admission: false,
            electron_view_attachment: 'main_only_not_exposed_to_renderer',
            preview_content_ipc: false,
            node_integration: false,
            preload: false,
          },
        }}
        onRequestLivePreview={onRequestLivePreview}
        projection={null}
      />,
    );

    const liveMode = container.querySelector<HTMLButtonElement>('[data-builder-preview-mode="live"]');
    expect(liveMode?.disabled).toBe(false);
    act(() => liveMode?.click());
    expect(container.querySelector('[data-builder-live-preview-panel="true"]')?.textContent)
      .toContain('Browser preview is ready to start.');
    const start = container.querySelector<HTMLButtonElement>('[data-builder-live-preview-start="true"]');
    expect(start?.disabled).toBe(false);
    act(() => start?.click());
    expect(onRequestLivePreview).toHaveBeenCalledOnce();
  });
});
