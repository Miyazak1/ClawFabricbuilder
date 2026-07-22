export type BuilderDesktopBridgeRoot = Readonly<{
  bridgeVersion: string;
  codeGenerator: unknown;
  projectCatalog: unknown;
  projectRevisions: unknown;
  providerSettings: unknown;
}>;

export const BUILDER_DESKTOP_BRIDGE_VERSION = 'builder-preload.v1';

const ROOT_KEYS = new Set([
  'bridgeVersion',
  'codeGenerator',
  'projectCatalog',
  'projectRevisions',
  'providerSettings',
]);

export class BuilderDesktopBridgeRootError extends Error {
  readonly code = 'builder_desktop_bridge_unavailable';

  constructor() {
    super('Builder desktop bridge is unavailable.');
    this.name = 'BuilderDesktopBridgeRootError';
  }
}

function unavailable(): BuilderDesktopBridgeRootError {
  return new BuilderDesktopBridgeRootError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function sanitizeBuilderDesktopBridgeRoot(value: unknown): BuilderDesktopBridgeRoot {
  try {
    if (!isPlainObject(value)) throw unavailable();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== ROOT_KEYS.size
      || keys.some((key) => typeof key !== 'string' || !ROOT_KEYS.has(key))
    ) throw unavailable();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of ROOT_KEYS) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || !descriptor.enumerable
        || 'get' in descriptor
        || 'set' in descriptor
      ) throw unavailable();
    }
    const bridgeVersion = descriptors.bridgeVersion.value;
    if (bridgeVersion !== BUILDER_DESKTOP_BRIDGE_VERSION) {
      throw unavailable();
    }
    return Object.freeze({
      bridgeVersion,
      codeGenerator: descriptors.codeGenerator.value,
      projectCatalog: descriptors.projectCatalog.value,
      projectRevisions: descriptors.projectRevisions.value,
      providerSettings: descriptors.providerSettings.value,
    });
  } catch {
    throw unavailable();
  }
}

export function readBuilderDesktopBridgeRoot(host: unknown = globalThis): BuilderDesktopBridgeRoot {
  try {
    if (host === null || (typeof host !== 'object' && typeof host !== 'function')) {
      throw unavailable();
    }
    const descriptor = Object.getOwnPropertyDescriptor(host, 'clawfabricBuilder');
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw unavailable();
    return sanitizeBuilderDesktopBridgeRoot(descriptor.value);
  } catch {
    throw unavailable();
  }
}
