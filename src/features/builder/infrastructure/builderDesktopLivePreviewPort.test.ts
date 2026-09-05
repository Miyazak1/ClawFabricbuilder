import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopLivePreviewPortError,
  createBuilderDesktopLivePreviewPort,
} from './builderDesktopLivePreviewPort';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID =
  `builder-conversation:${UUID}:223e4567-e89b-42d3-a456-426614174000`;

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

function runtimeLaunchProjection() {
  return {
    projection_version: 'builder-project-runtime-launch-projection.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    preview_kind: 'live_static_web',
    source_status: 'not_requested',
    command_profile: 'none',
    user_approval: 'not_required',
    command_execution: 'not_applicable',
    dependency_preparation: 'not_allowed',
    package_install: 'not_allowed',
    sandbox_policy: 'static_preview_no_command_execution',
    provider_dispatch: false,
    tool_dispatch: false,
    project_workspace_write: 'not_granted_by_preview',
    authority: {
      projection_authority: 'main_owned_project_runtime_launch_projection_v1',
      renderer_authority: 'status_projection_only',
      path_disclosure: 'not_serialized',
    },
  };
}

function status() {
  return {
    status_version: 'builder-live-preview-status-projection.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    preview_kind: 'live_static_web',
    entry_url: null,
    status: 'unavailable',
    can_start: false,
    can_reload: false,
    can_stop: false,
    blocked_request_count: 0,
    navigation_block_count: 0,
    network_block_count: 0,
    permission_block_count: 0,
    download_block_count: 0,
    window_open_block_count: 0,
    message: 'Live preview is unavailable until a main-owned preview source resolver is connected.',
    dev_server_approval: null,
    runtime_launch_projection: runtimeLaunchProjection(),
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
    updateCurrentPreviewLayout: vi.fn(async (value: unknown) => {
      void value;
      return { ...status(), status: 'ready', unavailable_reason: null };
    }),
    decideDevServerApproval: vi.fn(async (value: unknown) => {
      void value;
      return { ...status(), status: 'stopped', unavailable_reason: null };
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

  it('keeps renderer-safe blocked request counts from the live preview runtime', async () => {
    const source = bridge({
      requestCurrentDraftPreview: vi.fn(async () => ({
        ...status(),
        status: 'ready',
        can_reload: true,
        blocked_request_count: 3,
        navigation_block_count: 1,
        network_block_count: 1,
        permission_block_count: 0,
        download_block_count: 0,
        window_open_block_count: 1,
        message: 'Live preview is ready.',
        unavailable_reason: null,
      })),
    });
    const port = createBuilderDesktopLivePreviewPort(source);

    await expect(port.requestCurrentDraftPreview(request())).resolves.toMatchObject({
      status: 'ready',
      blocked_request_count: 3,
      navigation_block_count: 1,
      network_block_count: 1,
      window_open_block_count: 1,
    });
  });

  it('forwards bounded Browser panel geometry and supports hiding the native view', async () => {
    const source = bridge();
    const port = createBuilderDesktopLivePreviewPort(source);
    const layout = { ...request(), view_bounds: { x: 820, y: 180, width: 420, height: 520 } };

    await expect(port.updateCurrentPreviewLayout(layout)).resolves.toMatchObject({ status: 'ready' });
    await expect(port.updateCurrentPreviewLayout({ ...request(), view_bounds: null }))
      .resolves.toMatchObject({ status: 'ready' });
    expect(source.updateCurrentPreviewLayout).toHaveBeenNthCalledWith(1, layout);
    expect(source.updateCurrentPreviewLayout).toHaveBeenNthCalledWith(2, {
      ...request(),
      view_bounds: null,
    });
  });

  it('forwards only an exact one-time development-server decision', async () => {
    const source = bridge();
    const port = createBuilderDesktopLivePreviewPort(source);
    const decision = {
      ...request(),
      approval_request_id:
        'builder-live-preview-dev-server-approval-request:223e4567-e89b-42d3-a456-426614174000',
      decision: 'allow_once' as const,
    };

    await expect(port.decideDevServerApproval(decision)).resolves.toMatchObject({
      status: 'stopped',
    });
    expect(source.decideDevServerApproval).toHaveBeenCalledExactlyOnceWith(decision);
    await expect(port.decideDevServerApproval({
      ...decision,
      decision: 'allow_always' as 'allow_once',
    })).rejects.toBeInstanceOf(BuilderDesktopLivePreviewPortError);
    expect(source.decideDevServerApproval).toHaveBeenCalledOnce();
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
      { ...status(), entry_url: 'https://example.com/index.html' },
      {
        ...status(),
        authority: {
          ...authority(),
          source_tree_from_renderer: 'accepted',
        },
      },
      {
        ...status(),
        runtime_launch_projection: {
          ...runtimeLaunchProjection(),
          package_install: 'allowed',
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
