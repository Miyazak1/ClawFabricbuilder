import type { BuilderGenerationRequest } from './builderGeneration';

export type BuilderGenerationDiagnosticCode =
  | 'builder_generation_parent_unavailable'
  | 'builder_generation_provider_unavailable'
  | 'builder_generation_timeout'
  | 'builder_generation_provider_http_error'
  | 'builder_generation_structured_response_invalid'
  | 'builder_generation_failed';

export const BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY: Readonly<
  Record<BuilderGenerationDiagnosticCode, boolean>
> = Object.freeze({
  builder_generation_parent_unavailable: true,
  builder_generation_provider_unavailable: false,
  builder_generation_timeout: true,
  builder_generation_provider_http_error: true,
  builder_generation_structured_response_invalid: true,
  builder_generation_failed: true,
});

const DIAGNOSTIC_MESSAGES: Readonly<Record<BuilderGenerationDiagnosticCode, string>> = Object.freeze({
  builder_generation_parent_unavailable: 'The current project version is unavailable.',
  builder_generation_provider_unavailable: 'AI project generation is not configured.',
  builder_generation_timeout: 'AI project generation timed out.',
  builder_generation_provider_http_error: 'The AI service could not make this project.',
  builder_generation_structured_response_invalid: 'The generated project could not be prepared.',
  builder_generation_failed: 'The project draft could not be generated.',
});

const TRUSTED_DIAGNOSTICS = new WeakMap<object, BuilderGenerationDiagnosticCode>();

export class BuilderGenerationDiagnosticError extends Error {
  readonly code: BuilderGenerationDiagnosticCode;
  readonly retryable: boolean;

  constructor(code: BuilderGenerationDiagnosticCode = 'builder_generation_failed') {
    super(DIAGNOSTIC_MESSAGES[code]);
    this.name = 'BuilderDesktopCodeGeneratorPortError';
    this.code = code;
    this.retryable = BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY[code];
    this.stack = `${this.name}: ${this.message}`;
    TRUSTED_DIAGNOSTICS.set(this, code);
    Object.freeze(this);
  }
}

export function sanitizeTrustedBuilderGenerationDiagnostic(
  error: unknown,
): BuilderGenerationDiagnosticCode {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
    return 'builder_generation_failed';
  }
  return TRUSTED_DIAGNOSTICS.get(error) ?? 'builder_generation_failed';
}

export interface BuilderCodeGeneratorPort {
  generate(request: BuilderGenerationRequest): Promise<unknown>;
  answer(request: BuilderGenerationRequest): Promise<unknown>;
  restoreDraft(request: Readonly<{ draft_id: string }>): Promise<unknown>;
}

export interface BuilderProjectWorkspacePort {
  open(request: Readonly<{ project_id: string | null }>): Promise<unknown>;
  saveDraft(request: Readonly<{ draft_id: string }>): Promise<unknown>;
  loadCurrent(request: Readonly<{ project_id: string }>): Promise<unknown>;
  listCurrent(): Promise<unknown>;
}

export interface BuilderTaskStreamPort {
  read(request: Readonly<{ project_id: string }>): Promise<unknown>;
}
