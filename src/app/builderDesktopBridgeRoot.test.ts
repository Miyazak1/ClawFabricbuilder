import { describe, expect, it, vi } from 'vitest';

import {
  BUILDER_DESKTOP_BRIDGE_VERSION,
  BuilderDesktopBridgeRootError,
  readBuilderDesktopBridgeRoot,
  sanitizeBuilderDesktopBridgeRoot,
} from './builderDesktopBridgeRoot';

function bridgeRoot(overrides = {}) {
  return {
    bridgeVersion: BUILDER_DESKTOP_BRIDGE_VERSION,
    codeGenerator: Object.freeze({}),
    projectCatalog: Object.freeze({}),
    projectRevisions: Object.freeze({}),
    providerSettings: Object.freeze({}),
    windowControls: Object.freeze({}),
    ...overrides,
  };
}

describe('builderDesktopBridgeRoot', () => {
  it('accepts only the exact Builder preload root surface', () => {
    const root = bridgeRoot();
    const safe = sanitizeBuilderDesktopBridgeRoot(root);

    expect(safe).toEqual(root);
    expect(safe).not.toBe(root);
    expect(Object.isFrozen(safe)).toBe(true);
    expect(safe.windowControls).toBe(root.windowControls);
  });

  it.each([
    ['missing namespace', { bridgeVersion: BUILDER_DESKTOP_BRIDGE_VERSION }],
    ['extra namespace', bridgeRoot({ chat: {} })],
    ['v2 version', bridgeRoot({ bridgeVersion: 'builder-preload.v2' })],
    ['legacy version', bridgeRoot({ bridgeVersion: 'legacy.v1' })],
    ['blank version', bridgeRoot({ bridgeVersion: '' })],
  ])('rejects %s', (_label, value) => {
    expect(() => sanitizeBuilderDesktopBridgeRoot(value)).toThrow(BuilderDesktopBridgeRootError);
  });

  it('rejects accessors without reading them', () => {
    let reads = 0;
    const root = bridgeRoot();
    Object.defineProperty(root, 'windowControls', {
      enumerable: true,
      get() {
        reads += 1;
        return {};
      },
    });

    expect(() => sanitizeBuilderDesktopBridgeRoot(root)).toThrow(BuilderDesktopBridgeRootError);
    expect(reads).toBe(0);
  });

  it('reads only the global clawfabricBuilder data property and fails closed otherwise', () => {
    const host = { clawfabricBuilder: bridgeRoot() };
    expect(readBuilderDesktopBridgeRoot(host).bridgeVersion).toBe(BUILDER_DESKTOP_BRIDGE_VERSION);

    let reads = 0;
    const accessorHost = {};
    Object.defineProperty(accessorHost, 'clawfabricBuilder', {
      get() {
        reads += 1;
        return bridgeRoot();
      },
    });
    expect(() => readBuilderDesktopBridgeRoot(accessorHost)).toThrow(BuilderDesktopBridgeRootError);
    expect(reads).toBe(0);
  });

  it('contains no Electron, legacy product, storage, route, or network authority', () => {
    const source = sanitizeBuilderDesktopBridgeRoot.toString()
      + readBuilderDesktopBridgeRoot.toString();
    expect(source).not.toMatch(
      /electron|ipcRenderer|ChatCreatePage|chat_planner|AppLayout|Canvas|\bJob\b|localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|react-router|local-provider-executor/i,
    );
    expect(vi.isMockFunction(readBuilderDesktopBridgeRoot)).toBe(false);
  });
});
