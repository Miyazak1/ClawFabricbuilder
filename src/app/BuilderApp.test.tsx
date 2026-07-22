import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { BuilderApp } from './BuilderApp';
import { BUILDER_DESKTOP_BRIDGE_VERSION } from './builderDesktopBridgeRoot';
import { digestBuilderProjectProposal, type BuilderProjectProposal, type BuilderProjectRevision } from '../features/builder/domain/builderProject';
import {
  prepareBuilderGeneration,
  projectBuilderGeneration,
  type BuilderGenerationRequest,
} from '../features/builder/application/builderGeneration';

const PROJECT_ONE = 'builder-project:11111111-1111-4111-8111-111111111111';
const PROJECT_TWO = 'builder-project:22222222-2222-4222-8222-222222222222';
const CONFIG_DIGEST = `sha256:${'d'.repeat(64)}`;
const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
}>;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function proposal(title = 'Focus timer'): BuilderProjectProposal {
  return {
    kind: 'builder_code_project',
    title,
    summary: 'A small focus timer.',
    files: {
      'index.html': `<main><h1>${title}</h1></main>`,
      'styles.css': 'main { color: teal; }',
      'app.js': 'document.querySelector("main");',
    },
  };
}

async function resultFor(
  request: BuilderGenerationRequest,
  value = proposal(),
) {
  return {
    version: 'builder-generation-result.v1',
    request_id: request.request_digest,
    proposal: value,
    evidence: {
      authority: 'builder_code_project_generator',
      prompt_version: 'builder-code-project.v1',
      request_version: request.version,
      result_version: 'builder-generation-result.v1',
      request_digest: request.request_digest,
      proposal_digest: await digestBuilderProjectProposal(value),
      project_id: request.project_id,
      target_revision: request.target_revision,
      parent_revision: request.parent_revision === null
        ? null
        : { ...request.parent_revision },
    },
    admissions: {
      execution: 'not_evaluated',
      preview_script: 'not_authorized',
    },
  };
}

async function revisionFor(projectId: string, title = 'Known timer') {
  const request = await prepareBuilderGeneration(
    { idea: `Make ${title}.` },
    { createProjectId: () => projectId },
  );
  return projectBuilderGeneration({ request, result: await resultFor(request, proposal(title)) });
}

async function headFor(record: BuilderProjectRevision) {
  const body = {
    schema_version: 1,
    record_kind: 'builder_project_head',
    project_id: record.project_id,
    revision: record.revision,
    revision_digest: record.revision_digest,
  };
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return {
    ...body,
    head_digest: `sha256:${Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')}`,
  };
}

function persistence(operation: 'committed' | 'current_loaded') {
  const committed = operation === 'committed';
  return {
    evidence_version: 'builder-project-repository-result.v1',
    operation,
    authority_scope: 'single_main_process_serialized_expected_head',
    cross_process_cas: 'not_proven',
    sudden_power_loss_durability: 'not_proven',
    revision_file_fsync: committed ? 'proven' : 'not_performed',
    immutable_revision_publish: committed ? 'no_clobber_completed' : 'not_performed',
    revision_parent_directory_fsync: committed ? 'proven' : 'not_performed',
    head_file_fsync: committed ? 'proven' : 'not_performed',
    head_publish: committed ? 'same_directory_replace_reopened' : 'not_performed',
    head_parent_directory_fsync: committed ? 'proven' : 'not_performed',
    reopened_hash_verified: true,
  };
}

async function repositoryReceipt(record: BuilderProjectRevision, operation: 'committed' | 'current_loaded') {
  return {
    result_version: 'builder-project-repository-result.v1',
    record,
    head: await headFor(record),
    ...(operation === 'committed' ? { idempotent_replay: false } : { restart_restore: true }),
    persistence_evidence: persistence(operation),
  };
}

function catalogResult(records: BuilderProjectRevision[]) {
  return {
    result_version: 'builder-project-catalog-result.v1',
    projects: records
      .map((record) => ({
        project_id: record.project_id,
        title: record.title,
        summary: record.summary,
        revision: record.revision,
        revision_digest: record.revision_digest,
      }))
      .sort((left, right) => left.project_id.localeCompare(right.project_id)),
    catalog_evidence: {
      source_authority: 'verified_project_head_and_revision_chain',
      ordering: 'project_id_ascending',
      recency: 'not_available',
      global_atomic_snapshot: 'not_proven',
      headless_orphans: 'excluded',
      write_activity: 'none',
      resource_bounds: {
        max_project_directories: 256,
        max_file_reads: 1024,
        max_bytes: 33554432,
      },
    },
  };
}

function providerSettingsCurrent(overrides = {}) {
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

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return Object.freeze({ promise, reject, resolve });
}

async function createBridge(initialRecords: BuilderProjectRevision[] = []) {
  const records = new Map(initialRecords.map((record) => [record.project_id, record]));
  const calls = {
    commit: vi.fn(async (request: { revision: BuilderProjectRevision }) => {
      records.set(request.revision.project_id, request.revision);
      return repositoryReceipt(request.revision, 'committed');
    }),
    generate: vi.fn(async (request: BuilderGenerationRequest) => resultFor(
      request,
      proposal(request.target_revision === 1 ? 'Focus timer' : 'Updated focus timer'),
    )),
    listCurrent: vi.fn(async () => catalogResult([...records.values()])),
    loadCurrent: vi.fn(async (request: { project_id: string }) => {
      const record = records.get(request.project_id);
      if (!record) throw new Error('missing record');
      return repositoryReceipt(record, 'current_loaded');
    }),
    replaceCurrent: vi.fn(async (request: unknown) => {
      void request;
      return providerSettingsCurrent({ operation: 'current_replaced' });
    }),
  };
  return {
    calls,
    root: {
      bridgeVersion: BUILDER_DESKTOP_BRIDGE_VERSION,
      codeGenerator: {
        generate: calls.generate,
        cancel: vi.fn(async () => ({ cancelled: true })),
        availability: vi.fn(async () => ({ available: true })),
      },
      projectCatalog: { listCurrent: calls.listCurrent },
      projectRevisions: {
        commit: calls.commit,
        loadCurrent: calls.loadCurrent,
      },
      providerSettings: {
        readCurrent: vi.fn(async () => providerSettingsCurrent()),
        replaceCurrent: calls.replaceCurrent,
        status: vi.fn(async () => ({
          status_version: 'builder-provider-settings-status.v1',
          configured: true,
          config_digest: CONFIG_DIGEST,
          credential_status: 'stored',
        })),
      },
    },
  };
}

function render(element: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  act(() => root.render(element));
  return container;
}

async function flush(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

async function waitFor(assertion: () => void, times = 20): Promise<void> {
  let lastError: unknown;
  for (let index = 0; index < times; index += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flush(1);
    }
  }
  throw lastError;
}

function textBox(container: HTMLElement): HTMLTextAreaElement {
  const element = container.querySelector<HTMLTextAreaElement>('#builder-idea');
  if (!element) throw new Error('Missing idea textarea');
  return element;
}

function input(container: HTMLElement, id: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!element) throw new Error(`Missing input: ${id}`);
  return element;
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.includes(text));
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

function buttons(container: HTMLElement, text: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .filter((candidate) => candidate.textContent?.includes(text));
}

function changeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
    if (!setter) throw new Error('Missing value setter');
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('BuilderApp', () => {
  it('fails closed when the bridge root is unavailable', async () => {
    const container = render(<BuilderApp bridgeRoot={{ bridgeVersion: 'legacy.v0' }} />);
    await flush();

    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('.cf-builder-workbench')).not.toBeNull();
    expect(container.querySelector('[data-builder-workbench="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-workbench-rail="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-workbench-context="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-workbench-frame="true"]')).not.toBeNull();
    expect(container.querySelector('.cf-builder-context-sidebar')).not.toBeNull();
    expect(container.querySelector('.cf-builder-workbench-frame')).not.toBeNull();
    expect(container.textContent).toContain('Saved projects are unavailable.');
    expect(container.textContent).toContain('New project');
    expect(buttons(container, 'New project')).toHaveLength(1);
    expect(container.textContent).not.toMatch(/chat|canvas|AppLayout|generic provider|localStorage/iu);
  });

  it('opens a known project from the catalog and reopens its current revision', async () => {
    const known = await revisionFor(PROJECT_ONE, 'Known timer');
    const { calls, root } = await createBridge([known]);
    const container = render(<BuilderApp bridgeRoot={root} />);
    await flush();

    act(() => button(container, 'Known timer').click());
    await waitFor(() => {
      expect(container.querySelector('h1')?.textContent).toBe('Known timer');
    });

    expect(calls.loadCurrent).toHaveBeenCalledWith({ project_id: PROJECT_ONE });
    expect(container.textContent).toContain('Version 1');
    expect(container.querySelector('code')?.textContent).toContain('Known timer');

    changeValue(textBox(container), 'Update the known timer.');
    act(() => button(container, 'CSS').click());
    act(() => button(container, 'Settings').click());
    await flush();
    expect(container.textContent).toContain('AI provider settings');
    expect(container.querySelector('.cf-builder-main-frame')).not.toBeNull();
    expect(container.querySelector('.cf-builder-settings-surface')).not.toBeNull();
    expect(container.querySelector('.cf-builder-settings-body')).not.toBeNull();
    act(() => button(container, 'Back to project').click());
    await waitFor(() => {
      expect(container.querySelector('h1')?.textContent).toBe('Known timer');
      expect(textBox(container).value).toBe('Update the known timer.');
      expect(container.querySelector<HTMLElement>('#builder-code-panel')?.getAttribute('aria-labelledby')).toBe(
        'builder-file-tab-css',
      );
    });
    expect(calls.loadCurrent).toHaveBeenCalledTimes(1);
  });

  it('makes a first project, selects it after durable save, and refreshes catalog', async () => {
    const { calls, root } = await createBridge();
    const container = render(<BuilderApp bridgeRoot={root} />);
    await flush();

    changeValue(textBox(container), 'Make a focus timer.');
    await waitFor(() => {
      expect(button(container, 'Make it').disabled).toBe(false);
    });
    await act(async () => {
      button(container, 'Make it').click();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(calls.generate).toHaveBeenCalledTimes(1);
      expect(calls.commit).toHaveBeenCalledTimes(1);
      expect(calls.listCurrent).toHaveBeenCalledTimes(2);
      expect(container.querySelector('h1')?.textContent).toBe('Focus timer');
    });

    expect(calls.loadCurrent).toHaveBeenCalled();
    expect(container.querySelector('h1')?.textContent).toBe('Focus timer');
    expect(container.textContent).toContain('Version 1');
    expect(button(container, 'Focus timer')).toBeInstanceOf(HTMLButtonElement);

    act(() => button(container, 'New project').click());
    await waitFor(() => {
      expect(container.querySelector('h1')?.textContent).toBe('New project');
      expect(button(container, 'Make it')).toBeInstanceOf(HTMLButtonElement);
    });

    changeValue(textBox(container), 'Make another focus timer.');
    await waitFor(() => {
      expect(button(container, 'Make it').disabled).toBe(false);
    });
    await act(async () => {
      button(container, 'Make it').click();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(calls.generate).toHaveBeenCalledTimes(2);
      expect(calls.commit).toHaveBeenCalledTimes(2);
      expect(calls.listCurrent).toHaveBeenCalledTimes(3);
      expect(container.querySelector('h1')?.textContent).toBe('Focus timer');
    });
    expect(calls.generate.mock.calls[1][0].project_id).not.toBe(
      calls.generate.mock.calls[0][0].project_id,
    );
  });

  it('updates the selected project using the current revision as parent', async () => {
    const known = await revisionFor(PROJECT_TWO, 'Existing timer');
    const { calls, root } = await createBridge([known]);
    const container = render(<BuilderApp bridgeRoot={root} />);
    await flush();
    act(() => button(container, 'Existing timer').click());
    await waitFor(() => {
      expect(button(container, 'Update it')).toBeInstanceOf(HTMLButtonElement);
    });

    changeValue(textBox(container), 'Update the focus timer.');
    await waitFor(() => {
      expect(button(container, 'Update it').disabled).toBe(false);
    });
    await act(async () => {
      button(container, 'Update it').click();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(calls.generate).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(calls.generate).toHaveBeenCalledTimes(1);
      expect(calls.commit).toHaveBeenCalledTimes(1);
      expect(calls.loadCurrent).toHaveBeenCalledTimes(2);
      expect(calls.listCurrent).toHaveBeenCalledTimes(2);
      expect(container.querySelector('h1')?.textContent).toBe('Updated focus timer');
    }, 60);

    expect(calls.generate).toHaveBeenCalledTimes(1);
    expect(calls.generate.mock.calls[0][0]).toMatchObject({
      project_id: PROJECT_TWO,
      target_revision: 2,
      parent_revision: {
        revision: 1,
        revision_digest: known.revision_digest,
      },
    });
    expect(container.querySelector('h1')?.textContent).toBe('Updated focus timer');
    expect(container.textContent).toContain('Version 2');
  });

  it('does not refresh the catalog or select a project after generation failure', async () => {
    const { calls, root } = await createBridge();
    calls.generate.mockRejectedValueOnce(new Error('generation failed'));
    const container = render(<BuilderApp bridgeRoot={root} />);
    await flush();

    changeValue(textBox(container), 'Make a focus timer.');
    await waitFor(() => {
      expect(button(container, 'Make it').disabled).toBe(false);
    });
    await act(async () => {
      button(container, 'Make it').click();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(calls.generate).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain('The draft could not be made. Try again.');
    });

    expect(calls.commit).not.toHaveBeenCalled();
    expect(calls.loadCurrent).not.toHaveBeenCalled();
    expect(calls.listCurrent).toHaveBeenCalledTimes(1);
    expect(container.querySelector('h1')?.textContent).toBe('New project');

    act(() => button(container, 'Check AI settings').click());
    await flush();
    expect(container.textContent).toContain('AI provider settings');
    act(() => button(container, 'Back to project').click());
    await waitFor(() => {
      expect(container.querySelector('h1')?.textContent).toBe('New project');
      expect(textBox(container).value).toBe('Make a focus timer.');
      expect(button(container, 'Make it').disabled).toBe(false);
    });
    await act(async () => {
      button(container, 'Make it').click();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(calls.generate).toHaveBeenCalledTimes(2);
      expect(calls.commit).toHaveBeenCalledTimes(1);
      expect(container.querySelector('h1')?.textContent).toBe('Focus timer');
    });
  });

  it('does not refresh the catalog or select a project after save verification failure', async () => {
    const { calls, root } = await createBridge();
    calls.commit.mockRejectedValueOnce(new Error('save failed'));
    const container = render(<BuilderApp bridgeRoot={root} />);
    await flush();

    changeValue(textBox(container), 'Make a focus timer.');
    await waitFor(() => {
      expect(button(container, 'Make it').disabled).toBe(false);
    });
    await act(async () => {
      button(container, 'Make it').click();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(calls.generate).toHaveBeenCalledTimes(1);
      expect(calls.commit).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain('We could not verify that your project was saved.');
    });

    expect(calls.listCurrent).toHaveBeenCalledTimes(1);
    expect(container.querySelector('h1')?.textContent).toBe('New project');
    expect(() => button(container, 'Focus timer')).toThrow('Missing button: Focus timer');
  });

  it('does not adopt a stale generation result after starting a new project', async () => {
    const { calls, root } = await createBridge();
    const pending = deferred<Awaited<ReturnType<typeof resultFor>>>();
    calls.generate.mockImplementationOnce((request) => {
      void request;
      return pending.promise;
    });
    const container = render(<BuilderApp bridgeRoot={root} />);
    await flush();

    changeValue(textBox(container), 'Make a focus timer.');
    await waitFor(() => {
      expect(button(container, 'Make it').disabled).toBe(false);
    });
    await act(async () => {
      button(container, 'Make it').click();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(calls.generate).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain('Making your draft...');
    });

    act(() => button(container, 'New project').click());
    await waitFor(() => {
      expect(container.querySelector('h1')?.textContent).toBe('New project');
      expect(button(container, 'Make it')).toBeInstanceOf(HTMLButtonElement);
    });

    pending.resolve(await resultFor(calls.generate.mock.calls[0][0]));
    await flush(10);

    expect(calls.commit).not.toHaveBeenCalled();
    expect(calls.listCurrent).toHaveBeenCalledTimes(1);
    expect(container.querySelector('h1')?.textContent).toBe('New project');
    expect(container.textContent).not.toContain('Focus timer');
  });

  it('opens settings and saves a credential without echoing it', async () => {
    const { calls, root } = await createBridge();
    const container = render(<BuilderApp bridgeRoot={root} />);
    await flush();

    act(() => button(container, 'Settings').click());
    await flush();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.textContent).toContain('Back to project');
    expect(container.textContent).toContain('AI provider');
    expect(input(container, 'builder-provider-api-key').value).toBe('');

    changeValue(input(container, 'builder-provider-api-key'), 'real-key-value');
    await act(async () => {
      button(container, 'Save provider').click();
      await Promise.resolve();
    });
    await flush();

    expect(calls.replaceCurrent).toHaveBeenCalledTimes(1);
    expect(calls.replaceCurrent.mock.calls[0][0]).toMatchObject({
      credential: 'real-key-value',
    });
    expect(input(container, 'builder-provider-api-key').value).toBe('');
    expect(container.textContent).not.toContain('real-key-value');
  });
});
