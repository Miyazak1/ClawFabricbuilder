import type {
  BuilderProjectParentRevision,
  BuilderProjectRevision,
} from '../domain/builderProject';
import type { BuilderGenerationRequest } from './builderGeneration';

export interface BuilderCodeGeneratorPort {
  generate(request: BuilderGenerationRequest): Promise<unknown>;
}

export interface BuilderProjectRepositoryPort {
  commit(request: {
    revision: BuilderProjectRevision;
    expected_previous: BuilderProjectParentRevision | null;
  }): Promise<unknown>;
  loadCurrent(request: { project_id: string }): Promise<unknown>;
}
