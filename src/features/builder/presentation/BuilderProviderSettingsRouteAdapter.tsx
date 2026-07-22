import { useMemo } from 'react';

import {
  BuilderDesktopProviderSettingsPortError,
  createBuilderDesktopProviderSettingsPort,
  type BuilderProviderSettingsPort,
} from '../infrastructure/builderDesktopProviderSettingsPort';
import { useBuilderProviderSettingsController } from '../hooks/useBuilderProviderSettingsController';
import { BuilderProviderSettingsPanel } from './BuilderProviderSettingsPanel';

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

  return (
    <BuilderProviderSettingsPanel
      canSave={controller.canSave}
      fieldErrors={controller.fieldErrors}
      onSave={controller.onSave}
      onValuesChange={controller.onValuesChange}
      status={controller.status}
      values={controller.values}
    />
  );
}
