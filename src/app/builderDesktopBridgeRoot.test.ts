import { describe, expect, it } from 'vitest';

import {
  BUILDER_DESKTOP_BRIDGE_VERSION,
  BuilderDesktopBridgeRootError,
  readBuilderDesktopBridgeRoot,
  sanitizeBuilderDesktopBridgeRoot,
} from './builderDesktopBridgeRoot';

function bridge() {
  return {
    bridgeVersion: BUILDER_DESKTOP_BRIDGE_VERSION,
    codeGenerator: Object.freeze({}),
    projectWorkspace: Object.freeze({}),
    providerSettings: Object.freeze({}),
    permissions: Object.freeze({}),
    planReview: Object.freeze({}),
    providerContextDisclosureApproval: Object.freeze({}),
    checkRun: Object.freeze({}),
    livePreview: Object.freeze({}),
    taskStream: Object.freeze({}),
    windowControls: Object.freeze({}),
  };
}

describe('Builder desktop bridge root v26', () => {
  it('accepts the exact v26 namespaces and returns a fresh frozen root', () => {
    const input = bridge();
    const result = sanitizeBuilderDesktopBridgeRoot(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty('projectRevisions');
    expect(result).not.toHaveProperty('projectCatalog');
  });

  it.each([
    null,
    { ...bridge(), bridgeVersion: 'builder-preload.v2' },
    { ...bridge(), projectRevisions: {} },
    (() => {
      const value = bridge();
      Object.defineProperty(value, 'projectWorkspace', {
        enumerable: true,
        get: () => ({}),
      });
      return value;
    })(),
  ])('rejects malformed or legacy root', (value) => {
    expect(() => sanitizeBuilderDesktopBridgeRoot(value)).toThrow(
      BuilderDesktopBridgeRootError,
    );
  });

  it('reads only the own clawfabricBuilder data property', () => {
    const value = bridge();
    expect(readBuilderDesktopBridgeRoot({ clawfabricBuilder: value })).toEqual(value);
    expect(() => readBuilderDesktopBridgeRoot(Object.create({
      clawfabricBuilder: value,
    }))).toThrow(BuilderDesktopBridgeRootError);
  });
});
