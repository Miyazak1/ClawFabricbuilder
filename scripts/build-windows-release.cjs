'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const releaseDirectory = path.join(root, 'release');
const workDirectory = path.join(root, '.release-work');
const productName = 'ClawFabric Builder';
const setupName = `${productName} Setup 0.1.0.exe`;
const builderCli = path.join(
  root,
  'node_modules',
  'electron-builder',
  'cli.js',
);
const BUILDER_ATTEMPTS = 4;
const COPY_ATTEMPTS = 20;
const COPY_RETRY_MS = 500;

function transientWindowsLock(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  return ['EBUSY', 'EPERM', 'UNKNOWN'].includes(code)
    || /busy|locked|denied|used by another process/iu.test(message);
}

async function retryTransientWindowsLock(operation, label) {
  let lastError;
  for (let attempt = 1; attempt <= COPY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!transientWindowsLock(error) || attempt === COPY_ATTEMPTS) break;
      await delay(COPY_RETRY_MS);
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label} failed: ${detail}`);
}

function runElectronBuilder(outputDirectory) {
  const result = spawnSync(process.execPath, [
    builderCli,
    '--win',
    'nsis',
    `--config.directories.output=${outputDirectory}`,
  ], {
    cwd: root,
    env: process.env,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    process.stderr.write(`electron-builder attempt failed: status=${String(result.status)} signal=${String(result.signal)}`
      + `${result.error ? ` error=${result.error.message}` : ''}\n`);
  }
  return result.status === 0;
}

async function freshOutputDirectory(attempt) {
  await fs.mkdir(workDirectory, { recursive: true });
  const outputDirectory = path.join(
    workDirectory,
    `win-dist-${Date.now()}-${process.pid}-${attempt}`,
  );
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });
  return outputDirectory;
}

async function copyReleaseOutput(outputDirectory) {
  for (const entryName of [
    'win-unpacked',
    setupName,
    `${setupName}.blockmap`,
    'latest.yml',
    'builder-debug.yml',
  ]) {
    const source = path.join(outputDirectory, entryName);
    const target = path.join(releaseDirectory, entryName);
    await retryTransientWindowsLock(
      () => fs.cp(source, target, { recursive: true, force: true }),
      `copy ${entryName}`,
    );
  }
}

async function bestEffortCleanup(outputDirectory) {
  try {
    await fs.rm(outputDirectory, { recursive: true, force: true });
  } catch {
    // Windows security scanners can keep Electron artifacts locked briefly.
    // The ignored .release-work directory is safe to remove later.
  }
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('Windows release packaging must run on Windows.');
  }

  let lastOutputDirectory = null;
  for (let attempt = 1; attempt <= BUILDER_ATTEMPTS; attempt += 1) {
    const outputDirectory = await freshOutputDirectory(attempt);
    lastOutputDirectory = outputDirectory;
    if (!runElectronBuilder(outputDirectory)) {
      await bestEffortCleanup(outputDirectory);
      await delay(COPY_RETRY_MS * attempt);
      continue;
    }
    await fs.mkdir(releaseDirectory, { recursive: true });
    await copyReleaseOutput(outputDirectory);
    await bestEffortCleanup(outputDirectory);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      result_status: 'builder_windows_release_packaged',
      source_output_directory: outputDirectory,
      release_directory: releaseDirectory,
      executable_path: path.join(releaseDirectory, 'win-unpacked', `${productName}.exe`),
      installer_path: path.join(releaseDirectory, setupName),
    }, null, 2)}\n`);
    return;
  }
  throw new Error(`electron-builder failed after ${BUILDER_ATTEMPTS} attempts; latest output: ${lastOutputDirectory}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
