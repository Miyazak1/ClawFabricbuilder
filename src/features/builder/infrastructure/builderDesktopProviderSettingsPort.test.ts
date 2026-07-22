import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopProviderSettingsPortError,
  createBuilderDesktopProviderSettingsPort,
  type BuilderProviderSettingsWriteRequest,
} from './builderDesktopProviderSettingsPort';

const CONFIG_DIGEST = `sha256:${'a'.repeat(64)}`;

function current(overrides = {}) {
  return {
    result_version: 'builder-provider-settings-ipc-adapter.v1',
    operation: 'current_loaded',
    configured: true,
    config: {
      provider_id: 'builder-default',
      base_url: 'https://provider.example/v1',
      model: 'builder-model',
      timeout_ms: 30000,
      temperature: 0.2,
      max_tokens: 8192,
      config_digest: CONFIG_DIGEST,
    },
    credential_status: 'stored',
    ...overrides,
  };
}

function status(overrides = {}) {
  return {
    status_version: 'builder-provider-settings-status.v1',
    configured: true,
    config_digest: CONFIG_DIGEST,
    credential_status: 'stored',
    ...overrides,
  };
}

function writeRequest(overrides = {}): BuilderProviderSettingsWriteRequest {
  return {
    config: {
      base_url: 'https://provider.example/v1',
      model: 'builder-model',
      timeout_ms: 30000,
      temperature: 0.2,
      max_tokens: 8192,
    },
    credential: 'real-key-value',
    ...overrides,
  } as BuilderProviderSettingsWriteRequest;
}

function expectPortError(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({
    code: 'builder_provider_settings_unavailable',
    message: 'AI provider settings are unavailable.',
  });
}

describe('Builder desktop provider settings port', () => {
  it('maps the dedicated providerSettings bridge into fresh redacted settings state', async () => {
    const readCurrent = vi.fn(async () => current());
    const replaceCurrent = vi.fn(async (request: unknown) => {
      void request;
      return current({ operation: 'current_replaced' });
    });
    const bridgeStatus = vi.fn(async () => status());
    const port = createBuilderDesktopProviderSettingsPort({
      readCurrent,
      replaceCurrent,
      status: bridgeStatus,
    });

    const loaded = await port.readCurrent();
    const saved = await port.replaceCurrent(writeRequest());
    const checked = await port.status();

    expect(loaded).toEqual({
      configured: true,
      config: {
        provider_id: 'builder-default',
        base_url: 'https://provider.example/v1',
        model: 'builder-model',
        timeout_ms: 30000,
        temperature: 0.2,
        max_tokens: 8192,
        config_digest: CONFIG_DIGEST,
      },
      credential_status: 'stored',
    });
    expect(saved).toEqual(loaded);
    expect(checked).toEqual({
      configured: true,
      config_digest: CONFIG_DIGEST,
      credential_status: 'stored',
    });
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.config)).toBe(true);
    expect(Object.isFrozen(port)).toBe(true);
    expect(JSON.stringify(loaded)).not.toMatch(/real-key-value|secret|encrypted/i);
    expect(JSON.stringify(checked)).not.toMatch(/real-key-value|secret|encrypted/i);
  });

  it('accepts canonical local provider endpoints from the bridge and write request', async () => {
    const readCurrent = vi.fn(async () => current({
      config: {
        provider_id: 'builder-default',
        base_url: 'http://127.0.0.1:11434/v1',
        model: 'builder-model',
        timeout_ms: 30000,
        temperature: 0.2,
        max_tokens: 8192,
        config_digest: CONFIG_DIGEST,
      },
    }));
    const replaceCurrent = vi.fn(async (request: unknown) => {
      void request;
      return current({ operation: 'current_replaced' });
    });
    const port = createBuilderDesktopProviderSettingsPort({
      readCurrent,
      replaceCurrent,
      status: vi.fn(async () => status()),
    });

    await expect(port.readCurrent()).resolves.toMatchObject({
      config: { base_url: 'http://127.0.0.1:11434/v1' },
    });
    await port.replaceCurrent(writeRequest({
      config: {
        base_url: 'http://localhost:8080/api/v1',
        model: 'builder-model',
        timeout_ms: 30000,
        temperature: 0.2,
        max_tokens: 8192,
      },
    }));

    expect(replaceCurrent.mock.calls[0][0]).toMatchObject({
      config: { base_url: 'http://localhost:8080/api/v1' },
    });
  });

  it('passes the credential only to replaceCurrent and never to read or status', async () => {
    const readCurrent = vi.fn(async () => current());
    const replaceCurrent = vi.fn(async (request: unknown) => {
      void request;
      return current({ operation: 'current_replaced' });
    });
    const bridgeStatus = vi.fn(async () => status());
    const port = createBuilderDesktopProviderSettingsPort({
      readCurrent,
      replaceCurrent,
      status: bridgeStatus,
    });

    const request = writeRequest();
    await port.readCurrent();
    await port.status();
    await port.replaceCurrent(request);

    expect(readCurrent).toHaveBeenCalledWith();
    expect(bridgeStatus).toHaveBeenCalledWith();
    expect(replaceCurrent).toHaveBeenCalledTimes(1);
    expect(replaceCurrent.mock.calls[0][0]).toEqual({
      config: {
        base_url: 'https://provider.example/v1',
        model: 'builder-model',
        timeout_ms: 30000,
        temperature: 0.2,
        max_tokens: 8192,
      },
      credential: 'real-key-value',
    });
    expect(replaceCurrent.mock.calls[0][0]).not.toBe(request);
  });

  it('reports unconfigured settings without inventing defaults', async () => {
    const port = createBuilderDesktopProviderSettingsPort({
      readCurrent: vi.fn(async () => current({
        configured: false,
        config: null,
        credential_status: 'missing',
      })),
      replaceCurrent: vi.fn(async () => current({ operation: 'current_replaced' })),
      status: vi.fn(async () => status({
        configured: false,
        config_digest: null,
        credential_status: 'missing',
      })),
    });

    await expect(port.readCurrent()).resolves.toEqual({
      configured: false,
      config: null,
      credential_status: 'missing',
    });
    await expect(port.status()).resolves.toEqual({
      configured: false,
      config_digest: null,
      credential_status: 'missing',
    });
  });

  it.each([
    ['missing method', { readCurrent: vi.fn(), replaceCurrent: vi.fn() }],
    ['extra method', { readCurrent: vi.fn(), replaceCurrent: vi.fn(), status: vi.fn(), deleteAll: vi.fn() }],
    ['non-function', { readCurrent: vi.fn(), replaceCurrent: true, status: vi.fn() }],
  ])('rejects %s before creating a port', (_label, value) => {
    expect(() => createBuilderDesktopProviderSettingsPort(value)).toThrow(
      BuilderDesktopProviderSettingsPortError,
    );
  });

  it('rejects accessor bridge authority without invoking getters', () => {
    let accessorReads = 0;
    const accessor = { readCurrent: vi.fn(), status: vi.fn() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'replaceCurrent', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return vi.fn();
      },
    });

    expect(() => createBuilderDesktopProviderSettingsPort(accessor)).toThrow(
      BuilderDesktopProviderSettingsPortError,
    );
    expect(accessorReads).toBe(0);
  });

  it('fails closed for malformed bridge results and redacts bridge failures', async () => {
    const privateMarker = 'real-key-value-private-provider-path';
    const port = createBuilderDesktopProviderSettingsPort({
      readCurrent: vi.fn(async () => { throw new Error(privateMarker); }),
      replaceCurrent: vi.fn(async () => current({ secret_binding: privateMarker })),
      status: vi.fn(async () => status({ credential_status: 'stored', secret: privateMarker })),
    });

    await expectPortError(port.readCurrent());
    await expect(port.readCurrent()).rejects.not.toThrow(privateMarker);
    await expectPortError(port.replaceCurrent(writeRequest()));
    await expectPortError(port.status());
  });

  it('rejects malformed write requests before sending credentials to the bridge', async () => {
    const replaceCurrent = vi.fn(async () => current({ operation: 'current_replaced' }));
    const port = createBuilderDesktopProviderSettingsPort({
      readCurrent: vi.fn(async () => current()),
      replaceCurrent,
      status: vi.fn(async () => status()),
    });

    await expectPortError(port.replaceCurrent(writeRequest({ credential: ' real-key-value' })));
    await expectPortError(port.replaceCurrent(writeRequest({
      config: {
        base_url: 'http://provider.example/v1',
        model: 'builder-model',
        timeout_ms: 30000,
        temperature: 0.2,
        max_tokens: 8192,
      },
    })));
    await expectPortError(port.replaceCurrent(writeRequest({
      config: {
        base_url: 'https://provider.example/v1/',
        model: 'builder-model',
        timeout_ms: 30000,
        temperature: 0.2,
        max_tokens: 8192,
      },
    })));
    await expectPortError(port.replaceCurrent(writeRequest({
      config: {
        base_url: 'https://provider.example/v1',
        model: 'm'.repeat(201),
        timeout_ms: 30000,
        temperature: 0.2,
        max_tokens: 8192,
      },
    })));
    await expectPortError(port.replaceCurrent(writeRequest({
      credential: 'k'.repeat((16 * 1024) + 1),
    })));
    await expectPortError(port.replaceCurrent(writeRequest({
      credential: '\u{1f600}'.repeat((16 * 1024 / 4) + 1),
    })));
    await expectPortError(port.replaceCurrent(writeRequest({
      credential: `key${String.fromCharCode(0xd800)}`,
    })));
    await expectPortError(port.replaceCurrent({
      ...writeRequest(),
      extra: true,
    } as never));
    expect(replaceCurrent).not.toHaveBeenCalled();
  });

  it('rejects noncanonical bridge config before exposing it to the renderer', async () => {
    const port = createBuilderDesktopProviderSettingsPort({
      readCurrent: vi.fn(async () => current({
        config: {
          provider_id: 'builder-default',
          base_url: 'https://provider.example/v1/',
          model: 'builder-model',
          timeout_ms: 30000,
          temperature: 0.2,
          max_tokens: 8192,
          config_digest: CONFIG_DIGEST,
        },
      })),
      replaceCurrent: vi.fn(async () => current({ operation: 'current_replaced' })),
      status: vi.fn(async () => status()),
    });

    await expectPortError(port.readCurrent());
  });

  it('rejects bridge config model drift before exposing it to the renderer', async () => {
    const port = createBuilderDesktopProviderSettingsPort({
      readCurrent: vi.fn(async () => current({
        config: {
          provider_id: 'builder-default',
          base_url: 'https://provider.example/v1',
          model: `model${String.fromCharCode(0xd800)}`,
          timeout_ms: 30000,
          temperature: 0.2,
          max_tokens: 8192,
          config_digest: CONFIG_DIGEST,
        },
      })),
      replaceCurrent: vi.fn(async () => current({ operation: 'current_replaced' })),
      status: vi.fn(async () => status()),
    });

    await expectPortError(port.readCurrent());
  });

  it('rejects accessor payloads without reading the API key getter', async () => {
    let credentialReads = 0;
    const request = { config: writeRequest().config } as Record<string, unknown>;
    Object.defineProperty(request, 'credential', {
      enumerable: true,
      get() {
        credentialReads += 1;
        return 'real-key-value';
      },
    });
    const replaceCurrent = vi.fn(async () => current({ operation: 'current_replaced' }));
    const port = createBuilderDesktopProviderSettingsPort({
      readCurrent: vi.fn(async () => current()),
      replaceCurrent,
      status: vi.fn(async () => status()),
    });

    await expectPortError(port.replaceCurrent(request as never));
    expect(credentialReads).toBe(0);
    expect(replaceCurrent).not.toHaveBeenCalled();
  });

  it('has no Electron, global provider, legacy product, or browser storage authority', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'features', 'builder', 'infrastructure', 'builderDesktopProviderSettingsPort.ts'),
      'utf8',
    );
    const sourceFile = ts.createSourceFile(
      'builderDesktopProviderSettingsPort.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const imports = sourceFile.statements.flatMap((statement) => (
      ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
        ? [statement.moduleSpecifier.text]
        : []
    ));
    const forbiddenNodes: string[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isIdentifier(node)
        && ['window', 'globalThis', 'document', 'localStorage', 'sessionStorage', 'indexedDB']
          .includes(node.text)
      ) forbiddenNodes.push(node.text);
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) forbiddenNodes.push('import');
        if (ts.isIdentifier(node.expression) && ['eval', 'fetch', 'require'].includes(node.expression.text)) {
          forbiddenNodes.push(node.expression.text);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    expect(imports).toEqual(['../domain/builderProviderSettings']);
    expect(forbiddenNodes).toEqual([]);
    expect(source).not.toMatch(
      /\bwindow\b|globalThis|electron|ipcRenderer|fetch\(|localStorage|sessionStorage|indexedDB|ChatCreatePage|chat_planner|Canvas|\bJob\b|local-provider-executor|generic.*provider/i,
    );
    expect(source).toContain('BuilderProviderSettingsBridge');
    expect(source).not.toContain('safeStorage');
  });
});
