import { useCallback, useMemo, useState } from 'react';

import {
  BuilderDesktopProviderSettingsPortError,
  createBuilderDesktopProviderSettingsPort,
  type BuilderProviderSettingsPort,
} from '../infrastructure/builderDesktopProviderSettingsPort';
import { useBuilderProviderSettingsController } from '../hooks/useBuilderProviderSettingsController';
import {
  BuilderProviderSettingsPanel,
  type BuilderProviderSettingsPanelValues,
} from './BuilderProviderSettingsPanel';

export type BuilderProviderSettingsRouteAdapterProps = Readonly<{
  providerSettingsBridge: unknown;
}>;

const UNAVAILABLE_PORT: BuilderProviderSettingsPort = Object.freeze({
  readCurrent() {
    return Promise.reject(new BuilderDesktopProviderSettingsPortError());
  },
  replaceCurrent() {
    return Promise.reject(new BuilderDesktopProviderSettingsPortError());
  },
  status() {
    return Promise.reject(new BuilderDesktopProviderSettingsPortError());
  },
});

function safePort(value: unknown): BuilderProviderSettingsPort {
  try {
    return createBuilderDesktopProviderSettingsPort(value);
  } catch {
    return UNAVAILABLE_PORT;
  }
}

export function BuilderProviderSettingsRouteAdapter({
  providerSettingsBridge,
}: BuilderProviderSettingsRouteAdapterProps) {
  const port = useMemo(
    () => safePort(providerSettingsBridge),
    [providerSettingsBridge],
  );
  const controller = useBuilderProviderSettingsController(port);
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const onValuesChange = useCallback((values: BuilderProviderSettingsPanelValues) => {
    setShowFieldErrors(true);
    controller.onValuesChange(values);
  }, [controller]);

  return (
    <BuilderProviderSettingsPanel
      canSave={controller.canSave}
      fieldErrors={controller.fieldErrors}
      onSave={controller.onSave}
      onValuesChange={onValuesChange}
      showFieldErrors={showFieldErrors || controller.status === 'error'}
      status={controller.status}
      values={controller.values}
    />
  );
}
