import { AlertCircle, CheckCircle2, KeyRound, Loader2, Save } from 'lucide-react';

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

export type BuilderProviderSettingsPanelProps = Readonly<{
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

function updateValue(
  values: BuilderProviderSettingsPanelValues,
  key: keyof BuilderProviderSettingsPanelValues,
  value: string,
): BuilderProviderSettingsPanelValues {
  return Object.freeze({ ...values, [key]: value });
}

function numberInRange(value: string, minimum: number, maximum: number, allowBlank: boolean): boolean {
  if (allowBlank && value.trim() === '') return true;
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value.trim())) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum;
}

function integerInRange(value: string, minimum: number, maximum: number, allowBlank: boolean): boolean {
  if (allowBlank && value.trim() === '') return true;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value.trim())) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum;
}

function canSave(values: BuilderProviderSettingsPanelValues, status: BuilderProviderSettingsPanelStatus): boolean {
  if (status === 'saving' || status === 'unavailable') return false;
  const baseUrl = values.baseUrl.trim();
  const model = values.model.trim();
  const apiKey = values.apiKey.trim();
  return /^https:\/\/[^\s/$.?#].[^\s]*$/i.test(baseUrl)
    && model.length > 0
    && apiKey.length > 0
    && integerInRange(values.timeoutMs, 1_000, 120_000, false)
    && numberInRange(values.temperature, 0, 2, true)
    && integerInRange(values.maxTokens, 256, 65_536, true);
}

export function BuilderProviderSettingsPanel({
  status,
  values,
  onValuesChange,
  onSave,
}: BuilderProviderSettingsPanelProps) {
  const normalizedStatus = Object.hasOwn(STATUS_MESSAGES, status) ? status : 'unavailable';
  const saving = normalizedStatus === 'saving';
  const disabled = saving || normalizedStatus === 'unavailable';
  const saveEnabled = typeof onSave === 'function' && canSave(values, normalizedStatus);
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
          <label className="grid gap-1 text-sm font-medium" htmlFor="builder-provider-base-url">
            Base URL
            <input
              autoComplete="off"
              className="cf-builder-input min-h-10 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              id="builder-provider-base-url"
              inputMode="url"
              onChange={(event) => change('baseUrl', event.currentTarget.value)}
              placeholder="https://api.openai.com/v1"
              value={values.baseUrl}
            />
          </label>

          <div className="cf-builder-form-grid">
            <label className="grid gap-1 text-sm font-medium" htmlFor="builder-provider-model">
              Model
              <input
                autoComplete="off"
                className="cf-builder-input min-h-10 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                id="builder-provider-model"
                onChange={(event) => change('model', event.currentTarget.value)}
                placeholder="gpt-5.4"
                value={values.model}
              />
            </label>

            <label className="grid gap-1 text-sm font-medium" htmlFor="builder-provider-api-key">
              API key
              <input
                autoComplete="new-password"
                className="cf-builder-input min-h-10 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                id="builder-provider-api-key"
                onChange={(event) => change('apiKey', event.currentTarget.value)}
                placeholder="Enter a new key"
                type="password"
                value={values.apiKey}
              />
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
              className="cf-builder-input min-h-10 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              id="builder-provider-timeout"
              inputMode="numeric"
              onChange={(event) => change('timeoutMs', event.currentTarget.value)}
              value={values.timeoutMs}
            />
          </label>

          <label className="grid gap-1 text-sm font-medium" htmlFor="builder-provider-temperature">
            Temperature
            <input
              className="cf-builder-input min-h-10 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              id="builder-provider-temperature"
              inputMode="decimal"
              onChange={(event) => change('temperature', event.currentTarget.value)}
              placeholder="Optional"
              value={values.temperature}
            />
          </label>

          <label className="grid gap-1 text-sm font-medium" htmlFor="builder-provider-max-tokens">
            Max tokens
            <input
              className="cf-builder-input min-h-10 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              id="builder-provider-max-tokens"
              inputMode="numeric"
              onChange={(event) => change('maxTokens', event.currentTarget.value)}
              placeholder="Optional"
              value={values.maxTokens}
            />
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
