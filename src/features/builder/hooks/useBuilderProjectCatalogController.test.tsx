// @vitest-environment jsdom
import { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BuilderProjectCatalogPort } from '../application/builderProjectCatalogController';
import { useBuilderProjectCatalogController } from './useBuilderProjectCatalogController';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function catalog(title = 'Tiny timer') {
  return {
    result_version: 'builder-project-catalog-result.v1',
    projects: [{
      project_id: PROJECT_ID,
      title,
      summary: 'A small focus timer.',
      revision: 1,
      revision_digest: `sha256:${'a'.repeat(64)}`,
    }],
    catalog_evidence: {
      source_authority: 'verified_project_head_and_revision_chain',
      ordering: 'project_id_ascending',
      recency: 'not_available',
      global_atomic_snapshot: 'not_proven',
      headless_orphans: 'excluded',
      write_activity: 'none',
      resource_bounds: { max_project_directories: 256, max_file_reads: 1024, max_bytes: 33554432 },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function mount(initialPort: BuilderProjectCatalogPort, strict = false) {
  let port = initialPort;
  let current!: ReturnType<typeof useBuilderProjectCatalogController>;
  function Harness() {
    const value = useBuilderProjectCatalogController(port);
    useEffect(() => { current = value; }, [value]);
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const render = () => root.render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />);
  act(render);
  return {
    get current() { return current; },
    rerender(nextPort: BuilderProjectCatalogPort) { port = nextPort; act(render); },
    unmount() { act(() => root.unmount()); },
  };
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  });
}

afterEach(() => {
  for (const item of mounted.splice(0)) {
    try { act(() => item.root.unmount()); } catch { /* already unmounted */ }
    item.container.remove();
  }
});

describe('useBuilderProjectCatalogController', () => {
  it('loads once on mount, including React StrictMode', async () => {
    const listCurrent = vi.fn(async () => catalog());
    const hook = mount({ listCurrent }, true);
    await settle();

    expect(listCurrent).toHaveBeenCalledTimes(1);
    expect(hook.current.snapshot.status).toBe('ready');
  });

  it('exposes explicit refresh and retains stale data on failure', async () => {
    const listCurrent = vi.fn()
      .mockResolvedValueOnce(catalog())
      .mockRejectedValueOnce(new Error('private marker'));
    const hook = mount({ listCurrent });
    await settle();
    await act(async () => { await hook.current.refresh(); });

    expect(hook.current.snapshot.status).toBe('stale');
    expect(hook.current.snapshot.projects[0].title).toBe('Tiny timer');
    expect(listCurrent).toHaveBeenCalledTimes(2);
  });

  it('does not reload when only the port object identity changes', async () => {
    const listCurrent = vi.fn(async () => catalog());
    const hook = mount({ listCurrent });
    await settle();
    hook.rerender({ listCurrent });
    await settle();

    expect(listCurrent).toHaveBeenCalledTimes(1);
  });

  it('invalidates the old controller when list authority changes', async () => {
    const pending = deferred<unknown>();
    const first = vi.fn(() => pending.promise);
    const second = vi.fn(async () => catalog('Focus board'));
    const hook = mount({ listCurrent: first });
    await settle();
    hook.rerender({ listCurrent: second });
    await settle();
    pending.resolve(catalog('Stale timer'));
    await settle();

    expect(second).toHaveBeenCalledTimes(1);
    expect(hook.current.snapshot.projects[0].title).toBe('Focus board');
  });

  it('does not publish a pending result after unmount', async () => {
    const pending = deferred<unknown>();
    const hook = mount({ listCurrent: () => pending.promise });
    await settle();
    let reads = 0;
    const retiredResult = { result_version: 'builder-project-catalog-result.v1' };
    Object.defineProperty(retiredResult, 'projects', {
      enumerable: true,
      get() { reads += 1; return []; },
    });
    pending.resolve(retiredResult);
    hook.unmount();
    await settle();
    expect(reads).toBe(0);
  });
});
