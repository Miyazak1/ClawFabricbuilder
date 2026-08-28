import type {
  BuilderUserWebPort,
  BuilderUserWebStatusProjection,
} from '../application/builderPorts';

const BRIDGE_KEYS = new Set([
  'navigate', 'goBack', 'goForward', 'reload', 'stop', 'readStatus', 'updateLayout',
]);
const STATUS_KEYS = new Set([
  'status_version', 'status', 'current_url', 'can_go_back', 'can_go_forward',
  'can_reload', 'can_stop', 'navigation_block_count', 'permission_block_count',
  'download_block_count', 'window_open_block_count', 'message', 'updated_at_ms', 'authority',
]);
const AUTHORITY_KEYS = new Set([
  'user_web_authority', 'renderer_authority', 'provider_authority', 'provider_observation',
  'command_execution', 'dependency_installation', 'project_write', 'downloads',
  'permissions', 'popup_windows', 'partition_visibility',
]);

type UserWebBridge = Readonly<{
  navigate(request: Readonly<{ url: string }>): Promise<unknown>;
  goBack(): Promise<unknown>;
  goForward(): Promise<unknown>;
  reload(): Promise<unknown>;
  stop(): Promise<unknown>;
  readStatus(): Promise<unknown>;
  updateLayout(request: Readonly<{ view_bounds: unknown }>): Promise<unknown>;
}>;

export class BuilderDesktopUserWebPortError extends Error {
  readonly code = 'builder_user_web_unavailable';

  constructor() {
    super('User Web is unavailable.');
    this.name = 'BuilderDesktopUserWebPortError';
  }
}

function unavailable(): BuilderDesktopUserWebPortError {
  return new BuilderDesktopUserWebPortError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactDescriptors(value: unknown, keys: Set<string>): PropertyDescriptorMap {
  if (!isPlainObject(value)) throw unavailable();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.size || own.some((key) => typeof key !== 'string' || !keys.has(key))) {
    throw unavailable();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
      throw unavailable();
    }
  }
  return descriptors;
}

function safeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw unavailable();
  return value as number;
}

function sanitizeStatus(value: unknown): BuilderUserWebStatusProjection {
  const descriptors = exactDescriptors(value, STATUS_KEYS);
  const authority = exactDescriptors(descriptors.authority.value, AUTHORITY_KEYS);
  const status = descriptors.status.value;
  const currentUrl = descriptors.current_url.value;
  if (
    descriptors.status_version.value !== 'builder-user-web-status.v1'
    || !['idle', 'loading', 'ready', 'failed', 'stopped'].includes(String(status))
    || (currentUrl !== null && (typeof currentUrl !== 'string' || currentUrl.length > 2_048))
    || typeof descriptors.message.value !== 'string'
    || descriptors.message.value.length > 240
  ) throw unavailable();
  for (const key of ['can_go_back', 'can_go_forward', 'can_reload', 'can_stop']) {
    if (typeof descriptors[key].value !== 'boolean') throw unavailable();
  }
  if (
    authority.user_web_authority.value !== 'builder_main_user_web_v1'
    || authority.renderer_authority.value !== 'explicit_navigation_and_layout_only'
    || authority.provider_authority.value !== 'none'
    || authority.provider_observation.value !== false
    || authority.command_execution.value !== false
    || authority.dependency_installation.value !== false
    || authority.project_write.value !== false
    || authority.downloads.value !== 'blocked_pending_separate_admission'
    || authority.permissions.value !== 'denied'
    || authority.popup_windows.value !== 'blocked'
    || authority.partition_visibility.value !== 'main_private'
  ) throw unavailable();
  return Object.freeze({
    status_version: 'builder-user-web-status.v1',
    status: status as BuilderUserWebStatusProjection['status'],
    current_url: currentUrl as string | null,
    can_go_back: descriptors.can_go_back.value as boolean,
    can_go_forward: descriptors.can_go_forward.value as boolean,
    can_reload: descriptors.can_reload.value as boolean,
    can_stop: descriptors.can_stop.value as boolean,
    navigation_block_count: safeInteger(descriptors.navigation_block_count.value),
    permission_block_count: safeInteger(descriptors.permission_block_count.value),
    download_block_count: safeInteger(descriptors.download_block_count.value),
    window_open_block_count: safeInteger(descriptors.window_open_block_count.value),
    message: descriptors.message.value as string,
    updated_at_ms: safeInteger(descriptors.updated_at_ms.value),
    authority: Object.freeze({
      user_web_authority: 'builder_main_user_web_v1',
      renderer_authority: 'explicit_navigation_and_layout_only',
      provider_authority: 'none',
      provider_observation: false,
      command_execution: false,
      dependency_installation: false,
      project_write: false,
      downloads: 'blocked_pending_separate_admission',
      permissions: 'denied',
      popup_windows: 'blocked',
      partition_visibility: 'main_private',
    }),
  });
}

function safeBridge(value: unknown): UserWebBridge {
  const descriptors = exactDescriptors(value, BRIDGE_KEYS);
  for (const key of BRIDGE_KEYS) {
    if (typeof descriptors[key].value !== 'function') throw unavailable();
  }
  return Object.freeze({
    navigate: descriptors.navigate.value as UserWebBridge['navigate'],
    goBack: descriptors.goBack.value as UserWebBridge['goBack'],
    goForward: descriptors.goForward.value as UserWebBridge['goForward'],
    reload: descriptors.reload.value as UserWebBridge['reload'],
    stop: descriptors.stop.value as UserWebBridge['stop'],
    readStatus: descriptors.readStatus.value as UserWebBridge['readStatus'],
    updateLayout: descriptors.updateLayout.value as UserWebBridge['updateLayout'],
  });
}

export function createBuilderDesktopUserWebPort(value: unknown): BuilderUserWebPort {
  const bridge = safeBridge(value);
  return Object.freeze({
    async navigate(request: Parameters<BuilderUserWebPort['navigate']>[0]) {
      return sanitizeStatus(await bridge.navigate(request));
    },
    async goBack() { return sanitizeStatus(await bridge.goBack()); },
    async goForward() { return sanitizeStatus(await bridge.goForward()); },
    async reload() { return sanitizeStatus(await bridge.reload()); },
    async stop() { return sanitizeStatus(await bridge.stop()); },
    async readStatus() { return sanitizeStatus(await bridge.readStatus()); },
    async updateLayout(request: Parameters<BuilderUserWebPort['updateLayout']>[0]) {
      return sanitizeStatus(await bridge.updateLayout(request));
    },
  });
}
