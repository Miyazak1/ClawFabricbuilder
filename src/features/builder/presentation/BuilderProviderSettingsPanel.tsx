import { AlertCircle, CheckCircle2, KeyRound, Loader2, Save, Sparkles } from 'lucide-react';

export type BuilderProviderSettingsPanelStatus =
  | 'unconfigured'
  | 'unavailable'
  | 'saving'
  | 'saved'
  | 'error';

export type BuilderProviderSettingsPanelValues = Readonly<{
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: string;
  temperature: string;
  maxTokens: string;
}>;

export type BuilderProviderSettingsPanelFieldErrors = Readonly<{
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
  timeoutMs: string | null;
  temperature: string | null;
  maxTokens: string | null;
}>;

export type BuilderProviderSettingsPanelProps = Readonly<{
  canSave?: boolean;
  fieldErrors?: BuilderProviderSettingsPanelFieldErrors;
  status: BuilderProviderSettingsPanelStatus;
  values: BuilderProviderSettingsPanelValues;
  onValuesChange?: (values: BuilderProviderSettingsPanelValues) => void;
  onSave?: () => void;
}>;

const STATUS_MESSAGES: Record<BuilderProviderSettingsPanelStatus, string> = {
  unconfigured: 'Connect an AI provider before making projects.',
  unavailable: 'Provider settings are unavailable right now.',
  saving: 'Saving provider settings...',
  saved: 'Provider settings saved.',
  error: 'Provider settings could not be saved.',
};
const EMPTY_FIELD_ERRORS: BuilderProviderSettingsPanelFieldErrors = Object.freeze({
  baseUrl: null,
  model: null,
  apiKey: null,
  timeoutMs: null,
  temperature: null,
  maxTokens: null,
});
const DEEPSEEK_V4_PRESET = Object.freeze({
  baseUrl: 'https://api.deepseek.com/v1',
  maxTokens: '8192',
  temperature: '0.2',
  timeoutMs: '120000',
});
const DEEPSEEK_V4_MODELS = Object.freeze({
  flash: 'deepseek-v4-flash',
  pro: 'deepseek-v4-pro',
});

function updateValue(
  values: BuilderProviderSettingsPanelValues,
  key: keyof BuilderProviderSettingsPanelValues,
  value: string,
): BuilderProviderSettingsPanelValues {
  return Object.freeze({ ...values, [key]: value });
}

function canSave(
  fieldErrors: BuilderProviderSettingsPanelFieldErrors,
  status: BuilderProviderSettingsPanelStatus,
): boolean {
  if (status === 'saving' || status === 'unavailable') return false;
  return Object.values(fieldErrors).every((message) => message === null);
}

function errorId(id: string): string {
  return `${id}-error`;
}

function fieldError(
  id: string,
  message: string | null,
): { describedBy: string | undefined; invalid: boolean; message: string | null } {
  return {
    describedBy: message === null ? undefined : errorId(id),
    invalid: message !== null,
    message,
  };
}

export function BuilderProviderSettingsPanel({
  canSave: canSaveCommand = false,
  fieldErrors = EMPTY_FIELD_ERRORS,
  status,
  values,
  onValuesChange,
  onSave,
}: BuilderProviderSettingsPanelProps) {
  const normalizedStatus = Object.hasOwn(STATUS_MESSAGES, status) ? status : 'unavailable';
  const saving = normalizedStatus === 'saving';
  const disabled = saving || normalizedStatus === 'unavailable';
  const saveEnabled = typeof onSave === 'function'
    && canSave(fieldErrors, normalizedStatus)
    && canSaveCommand;
  const editable = typeof onValuesChange === 'function' && !disabled;
  const statusTone = normalizedStatus === 'saved'
    ? 'text-emerald-700'
    : normalizedStatus === 'error' || normalizedStatus === 'unavailable'
      ? 'text-destructive'
      : 'text-muted-foreground';

  function change(key: keyof BuilderProviderSettingsPanelValues, value: string): void {
    if (!editable) return;
    onValuesChange(updateValue(values, key, value));
  }

  function applyDeepSeekPreset(model: string): void {
    if (!editable) return;
    onValuesChange(Object.freeze({
      ...values,
      ...DEEPSEEK_V4_PRESET,
      model,
      apiKey: values.apiKey,
    }));
  }

  const baseUrlError = fieldError('builder-provider-base-url', fieldErrors.baseUrl);
  const modelError = fieldError('builder-provider-model', fieldErrors.model);
  const apiKeyError = fieldError('builder-provider-api-key', fieldErrors.apiKey);
  const timeoutError = fieldError('builder-provider-timeout', fieldErrors.timeoutMs);
  const temperatureError = fieldError('builder-provider-temperature', fieldErrors.temperature);
  const maxTokensError = fieldError('builder-provider-max-tokens', fieldErrors.maxTokens);

  return (
    <section
      aria-labelledby="builder-provider-settings-title"
      className="cf-builder-panel cf-builder-settings-card border"
      data-builder-provider-settings-panel="true"
    >
      <header className="cf-builder-card-header">
        <span className="cf-builder-brand-mark inline-flex size-9 shrink-0 items-center justify-center">
          <KeyRound aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" id="builder-provider-settings-title">AI provider</h2>
          <p
            className={`cf-builder-alert mt-2 text-sm ${
              normalizedStatus === 'saved'
                ? 'cf-builder-alert-success'
                : normalizedStatus === 'error' || normalizedStatus === 'unavailable'
                  ? 'cf-builder-alert-danger'
                  : 'cf-builder-alert-info'
            } ${statusTone}`}
            role={normalizedStatus === 'error' || normalizedStatus === 'unavailable' ? 'alert' : 'status'}
          >
            {normalizedStatus === 'saved' ? <CheckCircle2 aria-hidden="true" className="mr-1 inline size-4" /> : null}
            {normalizedStatus === 'saving' ? <Loader2 aria-hidden="true" className="mr-1 inline size-4 animate-spin" /> : null}
            {normalizedStatus === 'error' || normalizedStatus === 'unavailable' ? (
              <AlertCircle aria-hidden="true" className="mr-1 inline size-4" />
            ) : null}
            {STATUS_MESSAGES[normalizedStatus]}
          </p>
        </div>
      </header>

      <div className="cf-builder-settings-sections">
        <section className="cf-builder-form-section" aria-label="Connection">
          <header>
            <h3 className="text-sm font-semibold">Connection</h3>
            <p className="mt-1 text-xs text-muted-foreground">Use the provider endpoint and model for Builder projects.</p>
          </header>
          <div className="flex flex-wrap gap-2">
            <button
              className="cf-builder-secondary-button cf-builder-command-button inline-flex min-h-9 w-fit items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-builder-deepseek-preset="flash"
              disabled={!editable}
              onClick={() => applyDeepSeekPreset(DEEPSEEK_V4_MODELS.flash)}
              type="button"
            >
              <Sparkles aria-hidden="true" className="size-3.5" />
              Use V4 Flash
            </button>
            <button
              className="cf-builder-secondary-button cf-builder-command-button inline-flex min-h-9 w-fit items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-builder-deepseek-preset="pro"
              disabled={!editable}
              onClick={() => applyDeepSeekPreset(DEEPSEEK_V4_MODELS.pro)}
              type="button"
            >
              <Sparkles aria-hidden="true" className="size-3.5" />
              Use V4 Pro
            </button>
          </div>
          <label className="grid gap-1 text-sm font-medium" htmlFor="builder-provider-base-url">
            Base URL
            <input
              aria-describedby={baseUrlError.describedBy}
              aria-invalid={baseUrlError.invalid}
              autoComplete="off"
              className="cf-builder-input min-h-10 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              id="builder-provider-base-url"
              inputMode="url"
              onChange={(event) => change('baseUrl', event.currentTarget.value)}
              placeholder="https://api.example.com/v1"
              value={values.baseUrl}
            />
            {baseUrlError.message === null ? null : (
              <span className="text-xs text-destructive" id={errorId('builder-provider-base-url')}>
                {baseUrlError.message}
              </span>
            )}
          </label>

          <div className="cf-builder-form-grid">
            <label className="grid gap-1 text-sm font-medium" htmlFor="builder-provider-model">
              Model
              <input
                aria-describedby={modelError.describedBy}
                aria-invalid={modelError.invalid}
                autoComplete="off"
                className="cf-builder-input min-h-10 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                id="builder-provider-model"
                onChange={(event) => change('model', event.currentTarget.value)}
                placeholder="model-name"
                value={values.model}
              />
              {modelError.message === null ? null : (
                <span className="text-xs text-destructive" id={errorId('builder-provider-model')}>
                  {modelError.message}
                </span>
              )}
            </label>

            <label className="grid gap-1 text-sm font-medium" htmlFor="builder-provider-api-key">
              API key
              <input
                aria-describedby={apiKeyError.describedBy}
                aria-invalid={apiKeyError.invalid}
                autoComplete="new-password"
                className="cf-builder-input min-h-10 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                id="builder-provider-api-key"
                onChange={(event) => change('apiKey', event.currentTarget.value)}
                placeholder="Enter a new key"
                type="password"
                value={values.apiKey}
              />
              {apiKeyError.message === null ? null : (
                <span className="text-xs text-destructive" id={errorId('builder-provider-api-key')}>
                  {apiKeyError.message}
                </span>
              )}
            </label>
          </div>
        </section>

        <section className="cf-builder-form-section" aria-label="Generation limits">
          <header>
            <h3 className="text-sm font-semibold">Generation limits</h3>
            <p className="mt-1 text-xs text-muted-foreground">Tune response length and timing for project creation.</p>
          </header>
          <div className="cf-builder-form-grid cf-builder-form-grid-three">
          <label className="grid gap-1 text-sm font-medium" htmlFor="builder-provider-timeout">
            Timeout
            <input
              aria-describedby={timeoutError.describedBy}
              aria-invalid={timeoutError.invalid}
              className="cf-builder-input min-h-10 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              id="builder-provider-timeout"
              inputMode="numeric"
              onChange={(event) => change('timeoutMs', event.currentTarget.value)}
              value={values.timeoutMs}
            />
            {timeoutError.message === null ? null : (
              <span className="text-xs text-destructive" id={errorId('builder-provider-timeout')}>
                {timeoutError.message}
              </span>
            )}
          </label>

          <label className="grid gap-1 text-sm font-medium" htmlFor="builder-provider-temperature">
            Temperature
            <input
              aria-describedby={temperatureError.describedBy}
              aria-invalid={temperatureError.invalid}
              className="cf-builder-input min-h-10 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              id="builder-provider-temperature"
              inputMode="decimal"
              onChange={(event) => change('temperature', event.currentTarget.value)}
              placeholder="Optional"
              value={values.temperature}
            />
            {temperatureError.message === null ? null : (
              <span className="text-xs text-destructive" id={errorId('builder-provider-temperature')}>
                {temperatureError.message}
              </span>
            )}
          </label>

          <label className="grid gap-1 text-sm font-medium" htmlFor="builder-provider-max-tokens">
            Max tokens
            <input
              aria-describedby={maxTokensError.describedBy}
              aria-invalid={maxTokensError.invalid}
              className="cf-builder-input min-h-10 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              id="builder-provider-max-tokens"
              inputMode="numeric"
              onChange={(event) => change('maxTokens', event.currentTarget.value)}
              placeholder="Optional"
              value={values.maxTokens}
            />
            {maxTokensError.message === null ? null : (
              <span className="text-xs text-destructive" id={errorId('builder-provider-max-tokens')}>
                {maxTokensError.message}
              </span>
            )}
          </label>
          </div>
        </section>
      </div>

      <footer className="cf-builder-settings-actions">
        <button
          className="cf-builder-primary-button cf-builder-command-button inline-flex min-h-10 items-center justify-center gap-2 px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!saveEnabled}
          onClick={onSave}
          type="button"
        >
          {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
          {saving ? 'Saving...' : 'Save provider'}
        </button>
      </footer>
    </section>
  );
}
