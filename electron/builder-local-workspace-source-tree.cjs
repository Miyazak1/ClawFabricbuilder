'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_SOURCE_FILE_UTF8_BYTES,
  MAX_SOURCE_FILES,
  MAX_SOURCE_TREE_UTF8_BYTES,
  createBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const MAX_WORKSPACE_SCAN_ENTRIES = 2_048;
const SKIPPED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.clawfabric',
  'coverage',
  'dist',
  'node_modules',
]);
const CASE_SENSITIVE_PROTECTED_DIRECTORY_NAMES = new Set(['.git', '.clawfabric']);
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

class BuilderLocalWorkspaceSourceTreeError extends Error {
  constructor() {
    super('The local project files could not be read safely.');
    this.name = 'BuilderLocalWorkspaceSourceTreeError';
    this.code = 'builder_local_workspace_source_tree_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderLocalWorkspaceSourceTreeError();
}

function inspectBuilderLocalWorkspaceSourceTree(workspaceRootPath) {
  let rootRealPath;
  try {
    const rootStat = fs.lstatSync(workspaceRootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail();
    rootRealPath = path.resolve(fs.realpathSync.native(workspaceRootPath));
  } catch (error) {
    if (error instanceof BuilderLocalWorkspaceSourceTreeError) throw error;
    fail();
  }

  const pending = [{ absolutePath: rootRealPath, relativePath: '' }];
  const files = [];
  const incompleteReasons = new Set();
  let inspected = 0;
  let totalBytes = 0;
  while (
    pending.length > 0
    && inspected < MAX_WORKSPACE_SCAN_ENTRIES
    && files.length < MAX_SOURCE_FILES
    && totalBytes <= MAX_SOURCE_TREE_UTF8_BYTES
  ) {
    const current = pending.shift();
    let entries;
    try {
      entries = fs.readdirSync(current.absolutePath, { withFileTypes: true });
    } catch {
      incompleteReasons.add('unreadable_directory');
      inspected += 1;
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      inspected += 1;
      if (inspected > MAX_WORKSPACE_SCAN_ENTRIES) {
        incompleteReasons.add('entry_limit');
        break;
      }
      if (files.length >= MAX_SOURCE_FILES) {
        incompleteReasons.add('file_limit');
        break;
      }
      if (totalBytes > MAX_SOURCE_TREE_UTF8_BYTES) {
        incompleteReasons.add('byte_limit');
        break;
      }
      if (entry.isSymbolicLink()) {
        incompleteReasons.add('symbolic_link');
        continue;
      }
      const relativePath = current.relativePath === ''
        ? entry.name
        : `${current.relativePath}/${entry.name}`;
      if (entry.isDirectory()) {
        const foldedName = entry.name.toLowerCase();
        if (
          CASE_SENSITIVE_PROTECTED_DIRECTORY_NAMES.has(foldedName)
          && entry.name !== foldedName
        ) {
          incompleteReasons.add('unsupported_file');
        } else if (!SKIPPED_DIRECTORY_NAMES.has(foldedName)) {
          pending.push({
            absolutePath: path.join(current.absolutePath, entry.name),
            relativePath,
          });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const absolutePath = path.join(current.absolutePath, entry.name);
      let stat;
      try {
        stat = fs.lstatSync(absolutePath);
      } catch {
        incompleteReasons.add('unreadable_file');
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        incompleteReasons.add('unsupported_file');
        continue;
      }
      if (stat.size > MAX_SOURCE_FILE_UTF8_BYTES) {
        incompleteReasons.add('oversized_file');
        continue;
      }
      let content;
      try {
        content = UTF8_DECODER.decode(fs.readFileSync(absolutePath));
      } catch {
        incompleteReasons.add('unsupported_file');
        continue;
      }
      totalBytes += Buffer.byteLength(content, 'utf8');
      if (totalBytes > MAX_SOURCE_TREE_UTF8_BYTES) {
        incompleteReasons.add('byte_limit');
        break;
      }
      try {
        createBuilderProjectSourceTree({ files: [{ path: relativePath, content }] });
      } catch {
        incompleteReasons.add('unsupported_file');
        continue;
      }
      files.push({ path: relativePath, content });
    }
  }
  if (pending.length > 0 && inspected >= MAX_WORKSPACE_SCAN_ENTRIES) {
    incompleteReasons.add('entry_limit');
  }
  const sourceTree = createBuilderProjectSourceTree({ files });
  const incomplete_reasons = Object.freeze([...incompleteReasons].sort());
  return Object.freeze({
    source_tree: sourceTree,
    scan_status: incomplete_reasons.length === 0 ? 'complete' : 'incomplete',
    incomplete_reasons,
  });
}

function readBuilderLocalWorkspaceSourceTree(workspaceRootPath) {
  return inspectBuilderLocalWorkspaceSourceTree(workspaceRootPath).source_tree;
}

module.exports = Object.freeze({
  BuilderLocalWorkspaceSourceTreeError,
  inspectBuilderLocalWorkspaceSourceTree,
  readBuilderLocalWorkspaceSourceTree,
});
