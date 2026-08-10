import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopLivePreviewPortError,
  createBuilderDesktopLivePreviewPort,
} from './builderDesktopLivePreviewPort';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;

function request() {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  };
}

function authority() {
  return {
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
  };
}

function status() {
  return {
    status_version: 'builder-live-preview-status-projection.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    preview_kind: 'live_static_web',
    status: 'unavailable',
    can_start: false,
    can_reload: false,
    can_stop: false,
    message: 'Live preview is unavailable until a main-owned preview source resolver is connected.',
    unavailable_reason: 'preview_source_resolver_not_connected',
    updated_at_ms: 10,
    authority: authority(),
  };
}

function bridge(overrides = {}) {
  return {
    requestCurrentDraftPreview: vi.fn(async (value: unknown) => {
      void value;
      return status();
    }),
    reloadCurrentPreview: vi.fn(async (value: unknown) => {
      void value;
      return { ...status(), status: 'ready', unavailable_reason: null };
    }),
    stopCurrentPreview: vi.fn(async (value: unknown) => {
      void value;
      return { ...status(), status: 'stopped', unavailable_reason: null };
    }),
    readCurrentPreviewStatus: vi.fn(async (value: unknown) => {
      void value;
      return status();
    }),
    ...overrides,
  };
}

describe('createBuilderDesktopLivePreviewPort', () => {
  it('forwards live preview commands as exact project/conversation requests', async () => {
    const source = bridge();
    const port = createBuilderDesktopLivePreviewPort(source);
    const rawRequest = request();

    const projected = await port.requestCurrentDraftPreview(rawRequest);

    expect(source.requestCurrentDraftPreview).toHaveBeenCalledExactlyOnceWith(request());
    expect(source.requestCurrentDraftPreview.mock.calls[0][0]).not.toBe(rawRequest);
    expect(source.requestCurrentDraftPreview.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(source.requestCurrentDraftPreview.mock.calls[0][0]).not.toHaveProperty('entry_url');
    expect(projected).toEqual(status());
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.authority)).toBe(true);
  });

  it('supports read, reload, and stop without adding source or save authority', async () => {
    const source = bridge();
    const port = createBuilderDesktopLivePreviewPort(source);

    await expect(port.readCurrentPreviewStatus(request())).resolves.toMatchObject({
      status: 'unavailable',
      can_start: false,
    });
    await expect(port.reloadCurrentPreview(request())).resolves.toMatchObject({
      status: 'ready',
      unavailable_reason: null,
    });
    await expect(port.stopCurrentPreview(request())).resolves.toMatchObject({
      status: 'stopped',
      unavailable_reason: null,
    });
    expect(source.readCurrentPreviewStatus).toHaveBeenCalledOnce();
    expect(source.reloadCurrentPreview).toHaveBeenCalledOnce();
    expect(source.stopCurrentPreview).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    {},
    { requestCurrentDraftPreview: async (): Promise<unknown> => null },
    {
      ...bridge(),
      inspectCurrentPreview: async (): Promise<unknown> => null,
    },
  ])('rejects malformed bridge %j', (value) => {
    expect(() => createBuilderDesktopLivePreviewPort(value)).toThrow(
      BuilderDesktopLivePreviewPortError,
    );
  });

  it('rejects malformed requests before invoking the bridge', async () => {
    const source = bridge();
    const port = createBuilderDesktopLivePreviewPort(source);

    for (const value of [
      null,
      { ...request(), project_id: 'bad' },
      { ...request(), conversation_id: 'bad' },
      {
        project_id: PROJECT_ID,
        conversation_id: 'builder-conversation:00000000-0000-4000-8000-000000000000',
      },
      { ...request(), source_tree: { files: [] } },
    ]) {
      await expect(port.requestCurrentDraftPreview(value as ReturnType<typeof request>))
        .rejects.toBeInstanceOf(BuilderDesktopLivePreviewPortError);
    }
    expect(source.requestCurrentDraftPreview).not.toHaveBeenCalled();
  });

  it('rejects result drift and leaked preview evidence', async () => {
    for (const value of [
      { ...status(), project_id: 'builder-project:00000000-0000-4000-8000-000000000000' },
      { ...status(), source_tree: { files: [] } },
      { ...status(), entry_url: 'http://127.0.0.1:3000/index.html' },
      {
        ...status(),
        authority: {
          ...authority(),
          source_tree_from_renderer: 'accepted',
        },
      },
    ]) {
      const port = createBuilderDesktopLivePreviewPort(bridge({
        requestCurrentDraftPreview: async () => value,
      }));
      await expect(port.requestCurrentDraftPreview(request())).rejects.toBeInstanceOf(
        BuilderDesktopLivePreviewPortError,
      );
    }
  });

  it('redacts hostile bridge responses without invoking accessors', async () => {
    let getterCalls = 0;
    const port = createBuilderDesktopLivePreviewPort(bridge({
      requestCurrentDraftPreview: async () => Object.defineProperty({}, 'status_version', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 'never';
        },
      }),
    }));

    await expect(port.requestCurrentDraftPreview(request())).rejects.toBeInstanceOf(
      BuilderDesktopLivePreviewPortError,
    );
    expect(getterCalls).toBe(0);
  });
});
