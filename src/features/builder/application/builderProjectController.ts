import {
  createBuilderStaticPreview,
  isTrustedBuilderStaticPreviewProjection,
  type BuilderStaticPreviewProjection,
} from '../preview/builderStaticPreview';
import type { BuilderProjectRevision } from '../domain/builderProject';
import {
  prepareBuilderGeneration,
  projectBuilderGeneration,
} from './builderGeneration';
import type {
  BuilderCodeGeneratorPort,
  BuilderProjectRepositoryPort,
} from './builderPorts';
import {
  sanitizeBuilderRepositoryCommitEvidence,
  sanitizeBuilderRepositoryCurrentEvidence,
} from './builderRepositoryEvidence';

export type BuilderProjectControllerStatus =
  | 'new'
  | 'opening'
  | 'ready'
  | 'generating'
  | 'committing'
  | 'reopening'
  | 'generation_failed'
  | 'save_unverified'
  | 'preview_unavailable'
  | 'conflict'
  | 'unavailable';

export type BuilderProjectControllerError =
  | 'generation_failed'
  | 'save_unverified'
  | 'preview_unavailable'
  | 'conflict'
  | 'unavailable'
  | null;

export type BuilderProjectControllerSnapshot = Readonly<{
  status: BuilderProjectControllerStatus;
  busy: boolean;
  savedRevision: BuilderProjectRevision | null;
  preview: BuilderStaticPreviewProjection | null;
  error: BuilderProjectControllerError;
}>;

export type BuilderProjectControllerDependencies = {
  generator: BuilderCodeGeneratorPort;
  repository: BuilderProjectRepositoryPort;
  createProjectId?: () => unknown;
  createPreview?: (revision: unknown) => Promise<unknown>;
};

export type BuilderProjectController = {
  getSnapshot(): BuilderProjectControllerSnapshot;
  subscribe(listener: () => void): () => void;
  open(projectId?: string): Promise<BuilderProjectControllerSnapshot>;
  generate(idea: unknown): Promise<BuilderProjectControllerSnapshot>;
  retrySave(): Promise<BuilderProjectControllerSnapshot>;
};

const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BUSY_STATUSES = new Set<BuilderProjectControllerStatus>([
  'opening',
  'generating',
  'committing',
  'reopening',
]);

function freezeSnapshot(
  status: BuilderProjectControllerStatus,
  savedRevision: BuilderProjectRevision | null,
  preview: BuilderStaticPreviewProjection | null,
  error: BuilderProjectControllerError,
): BuilderProjectControllerSnapshot {
  return Object.freeze({
    status,
    busy: BUSY_STATUSES.has(status),
    savedRevision,
    preview,
    error,
  });
}

function sameRevision(left: BuilderProjectRevision, right: BuilderProjectRevision): boolean {
  return left.project_id === right.project_id
    && left.revision === right.revision
    && left.revision_digest === right.revision_digest;
}

function isParentOf(
  current: BuilderProjectRevision,
  candidate: BuilderProjectRevision,
): boolean {
  return candidate.parent_revision !== null
    && current.project_id === candidate.project_id
    && current.revision === candidate.parent_revision.revision
    && current.revision_digest === candidate.parent_revision.revision_digest;
}

export function createBuilderProjectController(
  dependencies: BuilderProjectControllerDependencies,
): BuilderProjectController {
  let snapshot = freezeSnapshot('new', null, null, null);
  let authorityGeneration = 0;
  let activeOperation: Promise<BuilderProjectControllerSnapshot> | null = null;
  let pendingCandidate: BuilderProjectRevision | null = null;
  const createPreview = dependencies.createPreview ?? createBuilderStaticPreview;
  const listeners = new Set<() => void>();

  function publish(
    status: BuilderProjectControllerStatus,
    savedRevision: BuilderProjectRevision | null = snapshot.savedRevision,
    preview: BuilderStaticPreviewProjection | null = snapshot.preview,
    error: BuilderProjectControllerError = null,
  ): BuilderProjectControllerSnapshot {
    snapshot = freezeSnapshot(status, savedRevision, preview, error);
    for (const listener of Array.from(listeners)) {
      try { listener(); } catch { /* observation cannot interrupt project authority */ }
    }
    return snapshot;
  }

  function isCurrent(generation: number): boolean {
    return generation === authorityGeneration;
  }

  async function publishDurableRevision(
    revision: BuilderProjectRevision,
    generation: number,
  ): Promise<BuilderProjectControllerSnapshot> {
    if (!isCurrent(generation)) return snapshot;
    pendingCandidate = null;
    let preview: BuilderStaticPreviewProjection;
    try {
      const projected = await createPreview(revision);
      if (!isTrustedBuilderStaticPreviewProjection(projected)) throw new Error('untrusted preview');
      preview = projected;
    } catch {
      if (!isCurrent(generation)) return snapshot;
      return publish('preview_unavailable', revision, null, 'preview_unavailable');
    }
    if (!isCurrent(generation)) return snapshot;
    return publish('ready', revision, preview, null);
  }

  async function reconcileCandidate(
    candidate: BuilderProjectRevision,
    generation: number,
  ): Promise<BuilderProjectControllerSnapshot> {
    if (!isCurrent(generation)) return snapshot;
    publish('reopening');
    if (!isCurrent(generation)) return snapshot;
    try {
      const rawCurrent = await dependencies.repository.loadCurrent({
        project_id: candidate.project_id,
      });
      const current = await sanitizeBuilderRepositoryCurrentEvidence(rawCurrent);
      if (!isCurrent(generation)) return snapshot;
      if (sameRevision(current.record, candidate)) {
        return publishDurableRevision(current.record, generation);
      }
      if (isParentOf(current.record, candidate)) {
        pendingCandidate = candidate;
        return publish('save_unverified', undefined, undefined, 'save_unverified');
      }
      pendingCandidate = null;
      return publish('conflict', undefined, undefined, 'conflict');
    } catch {
      if (!isCurrent(generation)) return snapshot;
      pendingCandidate = candidate;
      return publish('save_unverified', undefined, undefined, 'save_unverified');
    }
  }

  async function persistCandidate(
    candidate: BuilderProjectRevision,
    generation: number,
  ): Promise<BuilderProjectControllerSnapshot> {
    if (!isCurrent(generation)) return snapshot;
    publish('committing');
    if (!isCurrent(generation)) return snapshot;
    try {
      const rawCommit = await dependencies.repository.commit({
        revision: candidate,
        expected_previous: candidate.parent_revision,
      });
      await sanitizeBuilderRepositoryCommitEvidence(rawCommit, candidate);
    } catch {
      return reconcileCandidate(candidate, generation);
    }
    if (!isCurrent(generation)) return snapshot;
    publish('reopening');
    if (!isCurrent(generation)) return snapshot;
    try {
      const rawCurrent = await dependencies.repository.loadCurrent({
        project_id: candidate.project_id,
      });
      const current = await sanitizeBuilderRepositoryCurrentEvidence(rawCurrent);
      if (!isCurrent(generation)) return snapshot;
      if (sameRevision(current.record, candidate)) {
        return publishDurableRevision(current.record, generation);
      }
      pendingCandidate = null;
      return publish('conflict', undefined, undefined, 'conflict');
    } catch {
      if (!isCurrent(generation)) return snapshot;
      pendingCandidate = candidate;
      return publish('save_unverified', undefined, undefined, 'save_unverified');
    }
  }

  function runExclusive(
    operation: () => Promise<BuilderProjectControllerSnapshot>,
  ): Promise<BuilderProjectControllerSnapshot> {
    if (activeOperation) return activeOperation;
    const running = operation();
    activeOperation = running;
    void running.finally(() => {
      if (activeOperation === running) activeOperation = null;
    }).catch(() => undefined);
    return running;
  }

  return Object.freeze({
    getSnapshot() {
      return snapshot;
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    open(projectId?: string) {
      authorityGeneration += 1;
      const generation = authorityGeneration;
      pendingCandidate = null;
      activeOperation = null;
      if (projectId === undefined) {
        return Promise.resolve(publish('new', null, null, null));
      }
      if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
        return Promise.resolve(publish('unavailable', null, null, 'unavailable'));
      }
      return runExclusive(async () => {
        publish('opening', null, null, null);
        if (!isCurrent(generation)) return snapshot;
        try {
          const rawCurrent = await dependencies.repository.loadCurrent({ project_id: projectId });
          const current = await sanitizeBuilderRepositoryCurrentEvidence(rawCurrent);
          if (current.record.project_id !== projectId) throw new Error('identity drift');
          return publishDurableRevision(current.record, generation);
        } catch {
          if (!isCurrent(generation)) return snapshot;
          return publish('unavailable', null, null, 'unavailable');
        }
      });
    },

    generate(idea: unknown) {
      if (activeOperation) return activeOperation;
      if (!['new', 'ready', 'generation_failed'].includes(snapshot.status)) {
        return Promise.resolve(snapshot);
      }
      return runExclusive(async () => {
        const generation = ++authorityGeneration;
        const baseRevision = snapshot.savedRevision;
        pendingCandidate = null;
        publish('generating');
        if (!isCurrent(generation)) return snapshot;
        let candidate: BuilderProjectRevision;
        try {
          const request = await prepareBuilderGeneration(
            {
              idea,
              ...(baseRevision === null ? {} : { currentProject: baseRevision }),
            },
            dependencies.createProjectId === undefined
              ? {}
              : { createProjectId: dependencies.createProjectId },
          );
          if (!isCurrent(generation)) return snapshot;
          const result = await dependencies.generator.generate(request);
          if (!isCurrent(generation)) return snapshot;
          candidate = await projectBuilderGeneration({
            request,
            result,
            ...(baseRevision === null ? {} : { currentProject: baseRevision }),
          });
        } catch {
          if (!isCurrent(generation)) return snapshot;
          return publish('generation_failed', undefined, undefined, 'generation_failed');
        }
        return persistCandidate(candidate, generation);
      });
    },

    retrySave() {
      if (snapshot.status !== 'save_unverified' || pendingCandidate === null) {
        return Promise.resolve(snapshot);
      }
      const candidate = pendingCandidate;
      return runExclusive(async () => {
        const generation = ++authorityGeneration;
        return persistCandidate(candidate, generation);
      });
    },
  });
}
