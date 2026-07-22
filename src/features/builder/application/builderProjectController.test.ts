import { describe, expect, it, vi } from 'vitest';

import {
  digestBuilderProjectProposal,
  type BuilderProjectRevision,
} from '../domain/builderProject';
import { isTrustedBuilderStaticPreviewProjection } from '../preview/builderStaticPreview';
import {
  prepareBuilderGeneration,
  projectBuilderGeneration,
  type BuilderGenerationRequest,
} from './builderGeneration';
import type { BuilderProjectRepositoryPort } from './builderPorts';
import { createBuilderProjectController } from './builderProjectController';

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';

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

async function resultFor(request: BuilderGenerationRequest, title?: string) {
  const generated = proposal(title);
  const proposalDigest = await digestBuilderProjectProposal(generated);
  return {
    version: 'builder-generation-result.v1',
    request_id: request.request_digest,
    proposal: generated,
    evidence: {
      authority: 'builder_code_project_generator',
      prompt_version: 'builder-code-project.v2',
      request_version: request.version,
      result_version: 'builder-generation-result.v1',
      request_digest: request.request_digest,
      proposal_digest: proposalDigest,
      project_id: request.project_id,
      target_revision: request.target_revision,
      parent_revision: request.parent_revision === null ? null : { ...request.parent_revision },
    },
    admissions: { execution: 'not_evaluated', preview_script: 'not_authorized' },
  };
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

function persistence(operation: 'committed' | 'replayed' | 'current_loaded') {
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

async function commitReceipt(record: BuilderProjectRevision, replay = false) {
  return {
    result_version: 'builder-project-repository-result.v1',
    record,
    head: await headFor(record),
    idempotent_replay: replay,
    persistence_evidence: persistence(replay ? 'replayed' : 'committed'),
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

function repositoryHarness(order: string[]) {
  let current: BuilderProjectRevision | null = null;
  let failNextCommit = false;
  let loadOverride: BuilderProjectRevision | null | undefined;
  const repository: BuilderProjectRepositoryPort = {
    async commit(request) {
      order.push(`commit:${request.revision.revision}`);
      if (failNextCommit) {
        failNextCommit = false;
        throw new Error('private commit detail');
      }
      current = request.revision;
      return commitReceipt(request.revision);
    },
    async loadCurrent() {
      order.push('loadCurrent');
      const selected = loadOverride === undefined ? current : loadOverride;
      if (selected === null) throw new Error('private load detail');
      return currentReceipt(selected);
    },
  };
  return {
    repository,
    current: () => current,
    setCurrent: (value: BuilderProjectRevision | null) => { current = value; },
    setLoadOverride: (value: BuilderProjectRevision | null | undefined) => {
      loadOverride = value;
    },
    failCommit: () => { failNextCommit = true; },
  };
}

function generatorHarness(order: string[]) {
  const generate = vi.fn(async (request: BuilderGenerationRequest) => {
    order.push(`generate:${request.target_revision}`);
    return resultFor(request, request.target_revision === 1 ? 'First draft' : 'Updated draft');
  });
  return { generate };
}

describe('Builder project controller', () => {
  it('publishes a project only after generation, commit evidence, reopen, and preview', async () => {
    const order: string[] = [];
    const repository = repositoryHarness(order);
    const generator = generatorHarness(order);
    const controller = createBuilderProjectController({
      generator,
      repository: repository.repository,
      createProjectId: () => PROJECT_ID,
    });
    const statuses: string[] = [];
    controller.subscribe(() => statuses.push(controller.getSnapshot().status));

    const final = await controller.generate('Make a timer');

    expect(order).toEqual(['generate:1', 'commit:1', 'loadCurrent']);
    expect(statuses).toEqual(['generating', 'committing', 'reopening', 'ready']);
    expect(final.status).toBe('ready');
    expect(final.savedRevision?.revision).toBe(1);
    expect(final.savedRevision).toEqual(repository.current());
    expect(isTrustedBuilderStaticPreviewProjection(final.preview)).toBe(true);
    expect(final.preview?.src_doc).not.toContain('const timer');
  });

  it('opens a restart-restored project and advances from its exact parent', async () => {
    const firstOrder: string[] = [];
    const firstRepository = repositoryHarness(firstOrder);
    const first = createBuilderProjectController({
      generator: generatorHarness(firstOrder),
      repository: firstRepository.repository,
      createProjectId: () => PROJECT_ID,
    });
    const revisionOne = (await first.generate('Make a timer')).savedRevision as BuilderProjectRevision;

    const order: string[] = [];
    const repository = repositoryHarness(order);
    repository.setCurrent(revisionOne);
    const generator = generatorHarness(order);
    const controller = createBuilderProjectController({ generator, repository: repository.repository });
    expect((await controller.open(PROJECT_ID)).savedRevision?.revision).toBe(1);
    const updated = await controller.generate('Make the timer calmer');

    expect(updated.status).toBe('ready');
    expect(order).toEqual(['loadCurrent', 'generate:2', 'commit:2', 'loadCurrent']);
    expect(updated.savedRevision?.parent_revision).toEqual({
      revision: 1,
      revision_digest: revisionOne.revision_digest,
    });
  });

  it('reconciles an uncertain commit from current authority without regenerating', async () => {
    const order: string[] = [];
    const repository = repositoryHarness(order);
    const generator = generatorHarness(order);
    const controller = createBuilderProjectController({
      generator,
      repository: {
        ...repository.repository,
        async commit(request) {
          order.push(`commit:${request.revision.revision}`);
          repository.setCurrent(request.revision);
          throw new Error('response lost');
        },
      },
      createProjectId: () => PROJECT_ID,
    });

    const final = await controller.generate('Make a timer');
    expect(final.status).toBe('ready');
    expect(final.savedRevision?.revision).toBe(1);
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['generate:1', 'commit:1', 'loadCurrent']);
  });

  it('keeps an unverified candidate private and retries the same save without regenerating', async () => {
    const order: string[] = [];
    const repository = repositoryHarness(order);
    repository.failCommit();
    const generator = generatorHarness(order);
    const controller = createBuilderProjectController({
      generator,
      repository: repository.repository,
      createProjectId: () => PROJECT_ID,
    });

    const uncertain = await controller.generate('Make a timer');
    expect(uncertain.status).toBe('save_unverified');
    expect(uncertain.savedRevision).toBeNull();
    expect(uncertain.preview).toBeNull();

    expect(await controller.generate('Do not start a second attempt')).toBe(uncertain);
    expect(generator.generate).toHaveBeenCalledTimes(1);

    const recovered = await controller.retrySave();
    expect(recovered.status).toBe('ready');
    expect(recovered.savedRevision?.revision).toBe(1);
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      'generate:1',
      'commit:1',
      'loadCurrent',
      'commit:1',
      'loadCurrent',
    ]);
  });

  it('retries the same r2 candidate when an unknown commit leaves the exact parent current', async () => {
    const baseOrder: string[] = [];
    const baseRepository = repositoryHarness(baseOrder);
    const base = createBuilderProjectController({
      generator: generatorHarness(baseOrder),
      repository: baseRepository.repository,
      createProjectId: () => PROJECT_ID,
    });
    const revisionOne = (await base.generate('Make a timer')).savedRevision as BuilderProjectRevision;

    const order: string[] = [];
    const repository = repositoryHarness(order);
    repository.setCurrent(revisionOne);
    const generator = generatorHarness(order);
    const controller = createBuilderProjectController({
      generator,
      repository: repository.repository,
    });
    await controller.open(PROJECT_ID);
    repository.failCommit();

    const uncertain = await controller.generate('Make it calmer');
    expect(uncertain).toMatchObject({
      status: 'save_unverified',
      savedRevision: revisionOne,
      error: 'save_unverified',
    });
    expect(uncertain.savedRevision?.revision).toBe(1);
    expect(generator.generate).toHaveBeenCalledTimes(1);

    const recovered = await controller.retrySave();
    expect(recovered.status).toBe('ready');
    expect(recovered.savedRevision?.revision).toBe(2);
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      'loadCurrent',
      'generate:2',
      'commit:2',
      'loadCurrent',
      'commit:2',
      'loadCurrent',
    ]);
  });

  it('fails closed on a competing current head and never exposes the candidate', async () => {
    const baseOrder: string[] = [];
    const baseRepository = repositoryHarness(baseOrder);
    const base = createBuilderProjectController({
      generator: generatorHarness(baseOrder),
      repository: baseRepository.repository,
      createProjectId: () => PROJECT_ID,
    });
    const revisionOne = (await base.generate('Make a timer')).savedRevision as BuilderProjectRevision;

    const order: string[] = [];
    const repository = repositoryHarness(order);
    repository.setCurrent(revisionOne);
    const controller = createBuilderProjectController({
      generator: generatorHarness(order),
      repository: repository.repository,
    });
    await controller.open(PROJECT_ID);
    repository.failCommit();
    const competingRequest = await prepareBuilderGeneration({
      idea: 'Make a competing version',
      currentProject: revisionOne,
    });
    const competing = await projectBuilderGeneration({
      request: competingRequest,
      result: await resultFor(competingRequest, 'Competing version'),
      currentProject: revisionOne,
    });
    repository.setLoadOverride(competing);

    const result = await controller.generate('Make it blue');
    expect(result.status).toBe('conflict');
    expect(result.savedRevision).toEqual(revisionOne);
    expect(result.error).toBe('conflict');
  });

  it('classifies a competing current head after a verified commit as conflict', async () => {
    const baseOrder: string[] = [];
    const baseRepository = repositoryHarness(baseOrder);
    const base = createBuilderProjectController({
      generator: generatorHarness(baseOrder),
      repository: baseRepository.repository,
      createProjectId: () => PROJECT_ID,
    });
    const revisionOne = (await base.generate('Make a timer')).savedRevision as BuilderProjectRevision;
    const competingRequest = await prepareBuilderGeneration({
      idea: 'Make a competing version',
      currentProject: revisionOne,
    });
    const competing = await projectBuilderGeneration({
      request: competingRequest,
      result: await resultFor(competingRequest, 'Competing version'),
      currentProject: revisionOne,
    });

    const order: string[] = [];
    const repository = repositoryHarness(order);
    repository.setCurrent(revisionOne);
    const controller = createBuilderProjectController({
      generator: generatorHarness(order),
      repository: repository.repository,
    });
    await controller.open(PROJECT_ID);
    repository.setLoadOverride(competing);

    const result = await controller.generate('Make it blue');
    expect(result).toMatchObject({ status: 'conflict', error: 'conflict' });
    expect(result.savedRevision).toEqual(revisionOne);
    expect(await controller.retrySave()).toBe(result);
  });

  it('classifies an exact parent head after a verified commit as conflict', async () => {
    const baseOrder: string[] = [];
    const baseRepository = repositoryHarness(baseOrder);
    const base = createBuilderProjectController({
      generator: generatorHarness(baseOrder),
      repository: baseRepository.repository,
      createProjectId: () => PROJECT_ID,
    });
    const revisionOne = (await base.generate('Make a timer')).savedRevision as BuilderProjectRevision;

    const order: string[] = [];
    const repository = repositoryHarness(order);
    repository.setCurrent(revisionOne);
    const controller = createBuilderProjectController({
      generator: generatorHarness(order),
      repository: repository.repository,
    });
    await controller.open(PROJECT_ID);
    repository.setLoadOverride(revisionOne);

    const result = await controller.generate('Make it blue');
    expect(result).toMatchObject({ status: 'conflict', error: 'conflict' });
    expect(result.savedRevision).toEqual(revisionOne);
    expect(await controller.retrySave()).toBe(result);
  });

  it('keeps a verified saved revision when preview construction fails', async () => {
    const order: string[] = [];
    const repository = repositoryHarness(order);
    const controller = createBuilderProjectController({
      generator: generatorHarness(order),
      repository: repository.repository,
      createProjectId: () => PROJECT_ID,
      createPreview: vi.fn().mockRejectedValue(new Error('private preview detail')),
    });

    const result = await controller.generate('Make a timer');
    expect(result).toMatchObject({
      status: 'preview_unavailable',
      error: 'preview_unavailable',
      preview: null,
    });
    expect(result.savedRevision).toEqual(repository.current());
    expect(await controller.retrySave()).toBe(result);
    expect(order).toEqual(['generate:1', 'commit:1', 'loadCurrent']);
    expect(JSON.stringify(result)).not.toContain('private preview detail');
  });

  it('rejects an injected preview that was not created by the trusted projection authority', async () => {
    const order: string[] = [];
    const repository = repositoryHarness(order);
    const controller = createBuilderProjectController({
      generator: generatorHarness(order),
      repository: repository.repository,
      createProjectId: () => PROJECT_ID,
      createPreview: vi.fn().mockResolvedValue({
        version: 'builder-static-preview.v1',
        preview_script_admission: 'not_authorized',
      }),
    });

    const result = await controller.generate('Make a timer');
    expect(result).toMatchObject({
      status: 'preview_unavailable',
      error: 'preview_unavailable',
      preview: null,
    });
    expect(result.savedRevision).toEqual(repository.current());
  });

  it('preserves the last verified snapshot on generation failure', async () => {
    const order: string[] = [];
    const repository = repositoryHarness(order);
    const workingGenerator = generatorHarness(order);
    const controller = createBuilderProjectController({
      generator: workingGenerator,
      repository: repository.repository,
      createProjectId: () => PROJECT_ID,
    });
    const ready = await controller.generate('Make a timer');
    workingGenerator.generate.mockRejectedValueOnce(new Error('private provider detail'));

    const failed = await controller.generate('Break privately');
    expect(failed.status).toBe('generation_failed');
    expect(failed.savedRevision).toBe(ready.savedRevision);
    expect(failed.preview).toBe(ready.preview);
    expect(JSON.stringify(failed)).not.toContain('private provider detail');
  });

  it('deduplicates concurrent generation and rejects invalid open identity before repository access', async () => {
    const order: string[] = [];
    const repository = repositoryHarness(order);
    let release: ((value: unknown) => void) | undefined;
    const generate = vi.fn((request: BuilderGenerationRequest) => new Promise((resolve) => {
      release = async () => resolve(await resultFor(request));
    }));
    const controller = createBuilderProjectController({
      generator: { generate },
      repository: repository.repository,
      createProjectId: () => PROJECT_ID,
    });

    const first = controller.generate('Make a timer');
    const second = controller.generate('Make another timer');
    expect(first).toBe(second);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await release?.(undefined);
    await first;

    order.splice(0);
    expect((await controller.open('not-a-project')).status).toBe('unavailable');
    expect(order).toEqual([]);
  });

  it('invalidates stale generation completion when project authority changes', async () => {
    const order: string[] = [];
    const repository = repositoryHarness(order);
    let release: ((value: unknown) => void) | undefined;
    const controller = createBuilderProjectController({
      generator: {
        generate(request) {
          return new Promise((resolve) => {
            release = async () => resolve(await resultFor(request));
          });
        },
      },
      repository: repository.repository,
      createProjectId: () => PROJECT_ID,
    });

    const pending = controller.generate('Make a timer');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await controller.open();
    await release?.(undefined);
    await pending;

    expect(controller.getSnapshot()).toMatchObject({
      status: 'new',
      savedRevision: null,
      preview: null,
    });
    expect(order).toEqual([]);
  });

  it('isolates project authority from subscriber failures and runtime identity coercion', async () => {
    const order: string[] = [];
    const repository = repositoryHarness(order);
    const controller = createBuilderProjectController({
      generator: generatorHarness(order),
      repository: repository.repository,
      createProjectId: () => PROJECT_ID,
    });
    controller.subscribe(() => { throw new Error('private observer detail'); });

    expect((await controller.generate('Make a timer')).status).toBe('ready');
    const coercingIdentity = { toString: () => { throw new Error('private coercion'); } };
    expect((await controller.open(coercingIdentity as never)).status).toBe('unavailable');
  });

  it('does not call the generator after a generating subscriber changes authority', async () => {
    const order: string[] = [];
    const generator = generatorHarness(order);
    const controller = createBuilderProjectController({
      generator,
      repository: repositoryHarness(order).repository,
      createProjectId: () => PROJECT_ID,
    });
    let invalidated = false;
    controller.subscribe(() => {
      if (!invalidated && controller.getSnapshot().status === 'generating') {
        invalidated = true;
        void controller.open();
      }
    });

    await controller.generate('Make a timer');
    expect(generator.generate).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    expect(controller.getSnapshot().status).toBe('new');
  });

  it('does not commit after a committing subscriber changes authority', async () => {
    const order: string[] = [];
    const repository = repositoryHarness(order);
    const generator = generatorHarness(order);
    const controller = createBuilderProjectController({
      generator,
      repository: repository.repository,
      createProjectId: () => PROJECT_ID,
    });
    let invalidated = false;
    controller.subscribe(() => {
      if (!invalidated && controller.getSnapshot().status === 'committing') {
        invalidated = true;
        void controller.open();
      }
    });

    await controller.generate('Make a timer');
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['generate:1']);
    expect(controller.getSnapshot().status).toBe('new');
  });
});
