'use strict';

const RUNTIME_TARGET_VERSION = 'builder-renderer-target.v1';
const TRUSTED_DEVELOPMENT_URL = 'http://127.0.0.1:5173';

function resolveBuilderRendererTarget({ isPackaged, rendererUrl } = {}) {
  if (isPackaged === false && rendererUrl === TRUSTED_DEVELOPMENT_URL) {
    return Object.freeze({
      version: RUNTIME_TARGET_VERSION,
      kind: 'development_url',
      url: TRUSTED_DEVELOPMENT_URL,
    });
  }
  return Object.freeze({
    version: RUNTIME_TARGET_VERSION,
    kind: 'packaged_file',
  });
}

module.exports = Object.freeze({
  RUNTIME_TARGET_VERSION,
  TRUSTED_DEVELOPMENT_URL,
  resolveBuilderRendererTarget,
});
