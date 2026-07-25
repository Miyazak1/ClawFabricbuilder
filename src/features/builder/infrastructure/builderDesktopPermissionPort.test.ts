import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopPermissionPortError,
  createBuilderDesktopPermissionPort,
} from './builderDesktopPermissionPort';
import type { BuilderPermissionRequest } from '../application/builderPorts';

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const ACTOR_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;

function request(overrides: Record<string, unknown> = {}): BuilderPermissionRequest {
  return {
    project_id: PROJECT_ID,
    action: 'project.edit',
    resource_kind: 'project',
    resource_id: 'project:self',
    ...overrides,
  } as BuilderPermissionRequest;
}

function decision(overrides = {}) {
  return {
    decision_version: 'builder-permission-decision.v1',
    policy_version: 'builder-permission-policy.v1',
    actor_id: ACTOR_ID,
    action: 'project.edit',
    resource: {
      resource_kind: 'project',
      project_id: PROJECT_ID,
      resource_id: 'project:self',
    },
    evaluated_at_ms: 50,
    decision: 'denied',
    reason: 'no_matching_active_grant',
    permission_id: null,
    permission_authority: 'builder_permission_facts_deny_by_default_v1',
    ui_selection_authority: 'not_permission',
    ...overrides,
  };
}

describe('createBuilderDesktopPermissionPort', () => {
  it('forwards one evaluate request and exposes only a renderer-safe decision projection', async () => {
    const evaluate = vi.fn(async (requestValue: unknown) => {
      void requestValue;
      return decision({
        decision: 'allowed',
        reason: 'matching_active_grant',
        permission_id: PERMISSION_ID,
      });
    });
    const port = createBuilderDesktopPermissionPort({ evaluate });
    const rawRequest = request();
    const result = await port.evaluate(rawRequest);

    expect(evaluate).toHaveBeenCalledExactlyOnceWith(request());
    expect(evaluate.mock.calls[0][0]).not.toBe(rawRequest);
    expect(result).toEqual({
      action: 'project.edit',
      resource: {
        resource_kind: 'project',
        project_id: PROJECT_ID,
        resource_id: 'project:self',
      },
      evaluated_at_ms: 50,
      decision: 'allowed',
      reason: 'matching_active_grant',
      permission_id: PERMISSION_ID,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.resource)).toBe(true);
    expect(Object.hasOwn(result, 'actor_id')).toBe(false);
    expect(Object.hasOwn(result, 'grants')).toBe(false);
    expect(Object.hasOwn(result, 'revocations')).toBe(false);
  });

  it.each([
    null,
    {},
    { evaluate: async (): Promise<unknown> => null, grant: async (): Promise<unknown> => null },
    { read: async (): Promise<unknown> => null },
  ])('rejects malformed bridge %j', (bridge) => {
    expect(() => createBuilderDesktopPermissionPort(bridge)).toThrow(
      BuilderDesktopPermissionPortError,
    );
  });

  it('rejects malformed requests before invoking the bridge', async () => {
    const evaluate = vi.fn(async (requestValue: unknown) => {
      void requestValue;
      return decision();
    });
    const port = createBuilderDesktopPermissionPort({ evaluate });

    for (const value of [
      null,
      { ...request(), project_id: 'bad' },
      { ...request(), action: 'project.edit', resource_kind: 'revision' },
      { ...request(), action: 'secret.read', resource_kind: 'project' },
      { ...request(), resource_id: ' project ' },
      { ...request(), actor_id: ACTOR_ID },
    ]) {
      await expect(
        port.evaluate(value as Parameters<typeof port.evaluate>[0]),
      ).rejects.toBeInstanceOf(BuilderDesktopPermissionPortError);
    }
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('redacts hostile or forged bridge responses without exposing authority details', async () => {
    let getterCalls = 0;
    const accessor = createBuilderDesktopPermissionPort({
      evaluate: async () => Object.defineProperty(decision(), 'actor_id', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return ACTOR_ID;
        },
      }),
    });
    await expect(accessor.evaluate(request())).rejects.toBeInstanceOf(
      BuilderDesktopPermissionPortError,
    );
    expect(getterCalls).toBe(0);

    const drift = createBuilderDesktopPermissionPort({
      evaluate: async () => decision({
        resource: {
          resource_kind: 'project',
          project_id: PROJECT_ID,
          resource_id: 'project:other',
        },
      }),
    });
    await expect(drift.evaluate(request())).rejects.toBeInstanceOf(
      BuilderDesktopPermissionPortError,
    );
  });

  it('rejects output that smuggles grant facts, revocations, source, provider, or Git evidence', async () => {
    for (const extraKey of ['grants', 'revocations', 'source_tree', 'provider', 'commit_oid']) {
      const port = createBuilderDesktopPermissionPort({
        evaluate: async () => ({ ...decision(), [extraKey]: [] }),
      });
      await expect(port.evaluate(request())).rejects.toBeInstanceOf(
        BuilderDesktopPermissionPortError,
      );
    }
  });
});
