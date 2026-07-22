// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, StrictMode, useEffect, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  digestBuilderProjectProposal,
  type BuilderProjectRevision,
} from '../domain/builderProject';
import {
  prepareBuilderGeneration,
  projectBuilderGeneration,
  type BuilderGenerationRequest,
} from '../application/builderGeneration';
import type {
  BuilderCodeGeneratorPort,
  BuilderProjectRepositoryPort,
} from '../application/builderPorts';
import {
  useBuilderProjectController,
  type UseBuilderProjectControllerOptions,
} from './useBuilderProjectController';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ONE = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const PROJECT_TWO = 'builder-project:123e4567-e89b-42d3-a456-426614174001';
const roots: Array<{ root: Root; container: HTMLDivElement }> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function proposal(title = 'Tiny timer') {
  return {
    kind: 'builder_code_project' as const,
    title,
    summary: 'A small focus timer.',
    files: {
      'index.html': `<main>${title}</main>`,
      'styles.css': 'main { color: red; }',
      'app.js': 'const timer = 1;',
    },
  };
}

async function resultFor(request: BuilderGenerationRequest, title = 'Tiny timer') {
  const generated = proposal(title);
  return {
    version: 'builder-generation-result.v1',
    request_id: request.request_digest,
    proposal: generated,
    evidence: {
      authority: 'builder_code_project_generator',
      prompt_version: 'builder-code-project.v1',
      request_version: request.version,
      result_version: 'builder-generation-result.v1',
      request_digest: request.request_digest,
      proposal_digest: await digestBuilderProjectProposal(generated),
      project_id: request.project_id,
      target_revision: request.target_revision,
      parent_revision: request.parent_revision === null ? null : { ...request.parent_revision },
    },
    admissions: { execution: 'not_evaluated', preview_script: 'not_authorized' },
  };
}

async function revision(projectId: string, title: string): Promise<BuilderProjectRevision> {
  const request = await prepareBuilderGeneration(
    { idea: `Make ${title}` },
    { createProjectId: () => projectId },
  );
  return projectBuilderGeneration({ request, result: await resultFor(request, title) });
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

async function currentReceipt(record: BuilderProjectRevision) {
  return {
    result_version: 'builder-project-repository-result.v1',
    record,
    head: await headFor(record),
    restart_restore: true,
    persistence_evidence: persistence('current_loaded'),
  };
}

async function commitReceipt(record: BuilderProjectRevision) {
  return {
    result_version: 'builder-project-repository-result.v1',
    record,
    head: await headFor(record),
    idempotent_replay: false,
    persistence_evidence: persistence('committed'),
  };
}

function repositoryHarness(initial: readonly BuilderProjectRevision[] = []) {
  const records = new Map(initial.map((record) => [record.project_id, record]));
  const commit = vi.fn<BuilderProjectRepositoryPort['commit']>(async ({ revision: candidate }) => {
    records.set(candidate.project_id, candidate);
    return commitReceipt(candidate);
  });
  const loadCurrent = vi.fn<BuilderProjectRepositoryPort['loadCurrent']>(async ({ project_id }) => {
    const record = records.get(project_id);
    if (!record) throw new Error('private missing record');
    return currentReceipt(record);
  });
  return { repository: { commit, loadCurrent }, commit, loadCurrent };
}

function mountController(initialOptions: UseBuilderProjectControllerOptions, strictMode = false) {
  let current!: ReturnType<typeof useBuilderProjectController>;
  let options = initialOptions;
  function Harness() {
    const value = useBuilderProjectController(options);
    useEffect(() => { current = value; }, [value]);
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container });
  const render = () => root.render(strictMode ? <StrictMode><Harness /></StrictMode> : <Harness />);
  act(render);
  return {
    get current() { return current; },
    rerender(nextOptions: UseBuilderProjectControllerOptions) {
      options = nextOptions;
      act(render);
    },
    unmount() {
      const index = roots.findIndex((entry) => entry.root === root);
      if (index >= 0) roots.splice(index, 1);
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForSnapshot(
  hook: { current: ReturnType<typeof useBuilderProjectController> },
  status: ReturnType<typeof useBuilderProjectController>['snapshot']['status'],
  projectId?: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (
      hook.current.snapshot.status === status
      && (projectId === undefined || hook.current.snapshot.savedRevision?.project_id === projectId)
    ) return;
    await act(async () => {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
  }
  throw new Error(`Builder snapshot did not reach ${status}`);
}

async function waitForCalls(mock: { mock: { calls: unknown[][] } }, count: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (mock.mock.calls.length >= count) return;
    await act(async () => {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
  }
  throw new Error(`Mock did not reach ${count} calls`);
}

afterEach(() => {
  for (const item of roots.splice(0)) {
    act(() => item.root.unmount());
    item.container.remove();
  }
});

describe('useBuilderProjectController', () => {
  it('keeps one controller and stable commands across options object churn', async () => {
    const repository = repositoryHarness();
    const generator: BuilderCodeGeneratorPort = { generate: vi.fn() };
    const options = { generator, repository: repository.repository };
    const hook = mountController(options);
    await flushEffects();
    const generate = hook.current.generate;
    const retrySave = hook.current.retrySave;

    hook.rerender({ ...options });
    await flushEffects();

    expect(hook.current.generate).toBe(generate);
    expect(hook.current.retrySave).toBe(retrySave);
    expect(hook.current.snapshot.status).toBe('new');
    expect(repository.loadCurrent).not.toHaveBeenCalled();
  });

  it('opens exact project identities and retires commands from the prior authority', async () => {
    const first = await revision(PROJECT_ONE, 'First');
    const second = await revision(PROJECT_TWO, 'Second');
    const repository = repositoryHarness([first, second]);
    const generator: BuilderCodeGeneratorPort = { generate: vi.fn() };
    const hook = mountController({ generator, repository: repository.repository, projectId: PROJECT_ONE });
    await waitForSnapshot(hook, 'ready', PROJECT_ONE);
    const generate = hook.current.generate;

    expect(hook.current.snapshot.savedRevision?.project_id).toBe(PROJECT_ONE);
    hook.rerender({ generator, repository: repository.repository, projectId: PROJECT_TWO });
    expect(hook.current.snapshot.savedRevision?.project_id).not.toBe(PROJECT_ONE);
    await expect(generate('stale command')).resolves.toMatchObject({
      status: 'unavailable',
      savedRevision: null,
    });
    await waitForSnapshot(hook, 'ready', PROJECT_TWO);

    expect(hook.current.generate).not.toBe(generate);
    expect(hook.current.snapshot.savedRevision?.project_id).toBe(PROJECT_TWO);
    expect(generator.generate).not.toHaveBeenCalled();
    expect(repository.loadCurrent.mock.calls.map(([request]) => request.project_id)).toEqual([
      PROJECT_ONE,
      PROJECT_TWO,
    ]);
  });

  it('blocks old commands invoked by descendant layout cleanup during an authority change', async () => {
    const first = await revision(PROJECT_ONE, 'First');
    const second = await revision(PROJECT_TWO, 'Second');
    const repository = repositoryHarness([first, second]);
    const generate = vi.fn<BuilderCodeGeneratorPort['generate']>();
    const generator = { generate };
    let projectId = PROJECT_ONE;
    let current!: ReturnType<typeof useBuilderProjectController>;
    let cleanupResult: Promise<unknown> | null = null;

    function CleanupChild({ command }: { command: ReturnType<typeof useBuilderProjectController>['generate'] }) {
      useLayoutEffect(() => () => {
        cleanupResult = command('stale layout cleanup command');
      }, [command]);
      return null;
    }
    function Harness() {
      const value = useBuilderProjectController({ generator, repository: repository.repository, projectId });
      useEffect(() => { current = value; }, [value]);
      return <CleanupChild command={value.generate} />;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ root, container });
    const render = () => root.render(<Harness />);
    act(render);
    await waitForSnapshot({ get current() { return current; } }, 'ready', PROJECT_ONE);

    projectId = PROJECT_TWO;
    act(render);
    await waitForSnapshot({ get current() { return current; } }, 'ready', PROJECT_TWO);
    expect(cleanupResult).not.toBeNull();
    await expect(cleanupResult).resolves.toMatchObject({ status: 'unavailable' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('fails closed for invalid project identities without repository reads', async () => {
    const repository = repositoryHarness();
    const hook = mountController({
      generator: { generate: vi.fn() },
      repository: repository.repository,
      projectId: 'not-a-builder-project',
    });
    await flushEffects();
    expect(hook.current.snapshot).toMatchObject({ status: 'unavailable', error: 'unavailable' });
    expect(repository.loadCurrent).not.toHaveBeenCalled();
  });

  it('invalidates a pending generation when project authority changes', async () => {
    const existing = await revision(PROJECT_TWO, 'Existing');
    const repository = repositoryHarness([existing]);
    const pending = deferred<unknown>();
    const generate = vi.fn<BuilderCodeGeneratorPort['generate']>(() => pending.promise);
    const generator = { generate };
    const createProjectId = () => PROJECT_ONE;
    const hook = mountController({
      generator,
      repository: repository.repository,
      createProjectId,
    });
    await flushEffects();

    let operation!: Promise<unknown>;
    await act(async () => {
      operation = hook.current.generate('Make a timer');
      await Promise.resolve();
    });
    const request = generate.mock.calls[0][0];
    hook.rerender({
      generator,
      repository: repository.repository,
      createProjectId,
      projectId: PROJECT_TWO,
    });
    await waitForSnapshot(hook, 'ready', PROJECT_TWO);
    await act(async () => {
      pending.resolve(await resultFor(request));
      await operation;
    });

    expect(repository.commit).not.toHaveBeenCalled();
    expect(hook.current.snapshot.savedRevision?.project_id).toBe(PROJECT_TWO);
    expect(hook.current.snapshot.status).toBe('ready');
  });

  it('rebuilds on dependency identity changes and isolates the old controller', async () => {
    const firstRepository = repositoryHarness();
    const secondRepository = repositoryHarness();
    const pending = deferred<unknown>();
    const firstGenerate = vi.fn<BuilderCodeGeneratorPort['generate']>(() => pending.promise);
    const firstGenerator = { generate: firstGenerate };
    const secondGenerator = { generate: vi.fn() };
    const createProjectId = () => PROJECT_ONE;
    const hook = mountController({
      generator: firstGenerator,
      repository: firstRepository.repository,
      createProjectId,
    });
    await flushEffects();
    const oldCommand = hook.current.generate;

    let operation!: Promise<unknown>;
    await act(async () => {
      operation = hook.current.generate('Make a timer');
      await Promise.resolve();
    });
    const request = firstGenerate.mock.calls[0][0];
    hook.rerender({
      generator: secondGenerator,
      repository: secondRepository.repository,
      createProjectId,
    });
    await flushEffects();
    expect(hook.current.generate).not.toBe(oldCommand);
    await expect(oldCommand('stale dependency command')).resolves.toMatchObject({
      status: 'unavailable',
      savedRevision: null,
    });

    await act(async () => {
      pending.resolve(await resultFor(request));
      await operation;
    });
    expect(firstRepository.commit).not.toHaveBeenCalled();
    expect(secondRepository.commit).not.toHaveBeenCalled();
    expect(hook.current.snapshot.status).toBe('new');
  });

  it('preserves controller single-flight Promise identity', async () => {
    const repository = repositoryHarness();
    const pending = deferred<unknown>();
    const generate = vi.fn<BuilderCodeGeneratorPort['generate']>(() => pending.promise);
    const hook = mountController({
      generator: { generate },
      repository: repository.repository,
      createProjectId: () => PROJECT_ONE,
    });
    await flushEffects();

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = hook.current.generate('Make a timer');
      second = hook.current.generate('Ignore this concurrent idea');
    });
    await waitForCalls(generate, 1);
    expect(second).toBe(first);
    expect(generate).toHaveBeenCalledTimes(1);

    const request = generate.mock.calls[0][0];
    await act(async () => {
      pending.resolve(await resultFor(request));
      await first;
    });
    expect(repository.commit).toHaveBeenCalledTimes(1);
    expect(hook.current.snapshot.status).toBe('ready');
  });

  it('does not let an inapplicable retry suppress generation', async () => {
    const repository = repositoryHarness();
    const generate = vi.fn<BuilderCodeGeneratorPort['generate']>(async (request) => resultFor(request));
    const hook = mountController({
      generator: { generate },
      repository: repository.repository,
      createProjectId: () => PROJECT_ONE,
    });
    await flushEffects();

    let retry!: Promise<unknown>;
    let generation!: Promise<unknown>;
    act(() => {
      retry = hook.current.retrySave();
      generation = hook.current.generate('Make a timer');
    });
    expect(generation).not.toBe(retry);
    await act(async () => { await Promise.all([retry, generation]); });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(repository.commit).toHaveBeenCalledTimes(1);
    expect(hook.current.snapshot.status).toBe('ready');
  });

  it('shares one retrySave flight and one persistence retry', async () => {
    let current: BuilderProjectRevision | null = null;
    let candidate: BuilderProjectRevision | null = null;
    let commitCalls = 0;
    const retryCommit = deferred<void>();
    const repository: BuilderProjectRepositoryPort = {
      async commit({ revision: next }) {
        commitCalls += 1;
        candidate = next;
        if (commitCalls === 1) throw new Error('private uncertain commit');
        await retryCommit.promise;
        current = next;
        return commitReceipt(next);
      },
      async loadCurrent() {
        if (current === null) throw new Error('private unavailable head');
        return currentReceipt(current);
      },
    };
    const generator: BuilderCodeGeneratorPort = {
      async generate(request) { return resultFor(request); },
    };
    const hook = mountController({
      generator,
      repository,
      createProjectId: () => PROJECT_ONE,
    });
    await flushEffects();
    await act(async () => { await hook.current.generate('Make a timer'); });
    expect(hook.current.snapshot.status).toBe('save_unverified');
    expect(candidate).not.toBeNull();

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = hook.current.retrySave();
      second = hook.current.retrySave();
      await Promise.resolve();
    });
    expect(second).toBe(first);
    expect(commitCalls).toBe(2);

    await act(async () => {
      retryCommit.resolve();
      await first;
    });
    expect(commitCalls).toBe(2);
    expect(hook.current.snapshot.status).toBe('ready');
  });

  it('invalidates pending work on unmount without committing late results', async () => {
    const repository = repositoryHarness();
    const pending = deferred<unknown>();
    const generate = vi.fn<BuilderCodeGeneratorPort['generate']>(() => pending.promise);
    const hook = mountController({
      generator: { generate },
      repository: repository.repository,
      createProjectId: () => PROJECT_ONE,
    });
    await flushEffects();
    let operation!: Promise<unknown>;
    await act(async () => {
      operation = hook.current.generate('Make a timer');
    });
    await waitForCalls(generate, 1);
    const request = generate.mock.calls[0][0];
    const staleCommand = hook.current.generate;

    hook.unmount();
    await expect(staleCommand('after unmount')).resolves.toMatchObject({ status: 'unavailable' });
    pending.resolve(await resultFor(request));
    await operation;

    expect(repository.commit).not.toHaveBeenCalled();
  });

  it('survives StrictMode effect replay without leaking private promise failures', async () => {
    const repository = repositoryHarness();
    const hook = mountController({
      generator: { generate: vi.fn() },
      repository: repository.repository,
      projectId: PROJECT_ONE,
    }, true);
    await flushEffects();
    expect(hook.current.snapshot.status).toBe('unavailable');
  });

  it('does not revive a command queued before StrictMode authority replay', async () => {
    const repository = repositoryHarness();
    const generate = vi.fn<BuilderCodeGeneratorPort['generate']>();
    const generator = { generate };
    const createProjectId = () => PROJECT_ONE;
    let queued!: Promise<unknown>;
    let layoutSetups = 0;
    function Harness() {
      const controller = useBuilderProjectController({
        generator,
        repository: repository.repository,
        createProjectId,
      });
      const command = controller.generate;
      useLayoutEffect(() => {
        layoutSetups += 1;
        if (layoutSetups === 1) queued = command('queued before replay');
      }, [command]);
      return null;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ root, container });

    act(() => root.render(<StrictMode><Harness /></StrictMode>));
    await expect(queued).resolves.toMatchObject({ status: 'unavailable' });
    expect(layoutSetups).toBe(2);
    expect(generate).not.toHaveBeenCalled();
  });

  it('keeps React composition free of desktop, routing, and legacy authorities', () => {
    const source = readFileSync(
      resolve('src/features/builder/hooks/useBuilderProjectController.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /clawfabricDesktop|ipcRenderer|\bwindow\b|localStorage|sessionStorage|fetch\(|axios|router|ChatCreatePage|chat_planner|Canvas|\bJob\b/i,
    );
    expect(source).toContain('createBuilderProjectController');
    expect(source).toContain('useSyncExternalStore');
  });
});
