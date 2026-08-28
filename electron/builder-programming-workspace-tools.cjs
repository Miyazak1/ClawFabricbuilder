'use strict';

const { types: utilTypes } = require('node:util');

const {
  createBuilderProjectSourceTree,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  sanitizeBuilderProgrammingRuntimeRunContract,
} = require('./builder-programming-runtime-contract.cjs');
const {
  protectedBuilderWorkspacePathReason,
} = require('./builder-edit-intent-workspace-guard.cjs');

const BUILDER_PROGRAMMING_WORKSPACE_TOOLS_VERSION =
  'builder-programming-workspace-tools.v1';
const READ_KEYS = Object.freeze(['resource_id']);
const SEARCH_KEYS = Object.freeze(['query', 'max_results']);
const EDIT_KEYS = Object.freeze(['resource_id', 'observed_version', 'content']);
const WRITE_KEYS = Object.freeze(['resource_id', 'expected_absent', 'content']);
const OPTION_KEYS = Object.freeze(['run_contract', 'source_tree']);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_QUERY_BYTES = 512;
const MAX_SEARCH_RESULTS = 100;

const AUTHORITY = Object.freeze({
  workspace_authority: 'builder_programming_run_contract_v1',
  state_authority: 'verified_builder_source_tree_v1',
  run_lifecycle_policy: 'closed_run_rejects_all_new_and_queued_tools',
  stale_write_policy: 'observed_content_version_required',
  same_file_mutation_policy: 'serialized',
  path_authority: 'project_resource_id_only',
  renderer_authority: 'not_present',
  filesystem_authority: 'not_present',
  process_authority: 'not_present',
  provider_authority: 'not_present',
});

class BuilderProgrammingWorkspaceToolsError extends Error {
  constructor(code = 'builder_programming_workspace_tool_invalid') {
    const selected = [
      'builder_programming_workspace_tool_invalid',
      'builder_programming_workspace_tool_not_allowed',
      'builder_programming_workspace_stale_file',
      'builder_programming_workspace_file_exists',
      'builder_programming_workspace_file_missing',
      'builder_programming_workspace_path_denied',
      'builder_programming_workspace_closed',
    ].includes(code) ? code : 'builder_programming_workspace_tool_invalid';
    const messages = {
      builder_programming_workspace_tool_invalid:
        'The programming workspace tool request could not be verified.',
      builder_programming_workspace_tool_not_allowed:
        'This programming workspace tool is not allowed for the current run.',
      builder_programming_workspace_stale_file:
        'The file changed after it was read. Read it again before editing.',
      builder_programming_workspace_file_exists:
        'The file already exists and cannot be created by this request.',
      builder_programming_workspace_file_missing:
        'The file does not exist in the current working state.',
      builder_programming_workspace_path_denied:
        'This path is protected by Builder. Use an ordinary UTF-8 project file instead; use .svg for text image placeholders.',
      builder_programming_workspace_closed:
        'This programming workspace is no longer accepting tool requests.',
    };
    super(messages[selected]);
    this.name = 'BuilderProgrammingWorkspaceToolsError';
    this.code = selected;
    this.retryable = [
      'builder_programming_workspace_stale_file',
      'builder_programming_workspace_path_denied',
    ].includes(selected);
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderProgrammingWorkspaceToolsError(code);
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
  return descriptors;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeQuery(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > MAX_QUERY_BYTES
    || Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x08
        || codePoint === 0x0b
        || codePoint === 0x0c
        || (codePoint >= 0x0e && codePoint <= 0x1f)
        || (codePoint >= 0x7f && codePoint <= 0x9f);
    })
  ) fail();
  return value;
}

function safeMaximum(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SEARCH_RESULTS) fail();
  return value;
}

function resourcePath(value) {
  if (typeof value !== 'string' || !value.startsWith('project:/')) fail();
  const candidate = value.slice('project:/'.length);
  try {
    return createBuilderProjectSourceTree({
      files: [{ path: candidate, content: '' }],
    }).files[0].path;
  } catch {
    fail();
  }
}

function sourceLines(content) {
  if (content === '') return [];
  const lines = content.split(/\r\n|\r|\n/u);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function createSearchIndex(sourceTree) {
  return sourceTree.files.map((file) => Object.freeze({
    path: file.path,
    path_folded: file.path.toLocaleLowerCase('en-US'),
    resource_id: `project:/${file.path}`,
    lines: Object.freeze(sourceLines(file.content).map((line) => Object.freeze({
      text: line,
      folded: line.toLocaleLowerCase('en-US'),
    }))),
  }));
}

function lineEditCounts(beforeContent, afterContent) {
  const before = sourceLines(beforeContent);
  const after = sourceLines(afterContent);
  const maximum = before.length + after.length;
  if (maximum > 20_000) {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < before.length - prefix
      && suffix < after.length - prefix
      && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) suffix += 1;
    return {
      added_lines: after.length - prefix - suffix,
      deleted_lines: before.length - prefix - suffix,
    };
  }
  const frontier = new Map([[1, 0]]);
  for (let distance = 0; distance <= maximum; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const left = frontier.get(diagonal - 1) ?? -1;
      const right = frontier.get(diagonal + 1) ?? -1;
      let x = diagonal === -distance || (diagonal !== distance && left < right)
        ? Math.max(0, right)
        : left + 1;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      frontier.set(diagonal, x);
      if (x >= before.length && y >= after.length) {
        return {
          added_lines: (distance + after.length - before.length) / 2,
          deleted_lines: (distance - after.length + before.length) / 2,
        };
      }
    }
  }
  fail();
}

function verifiedSourceTree(value) {
  try {
    return sanitizeBuilderProjectSourceTree(value);
  } catch {
    fail();
  }
}

function verifiedContent(path, value) {
  try {
    return createBuilderProjectSourceTree({
      files: [{ path, content: value }],
    }).files[0].content;
  } catch {
    fail();
  }
}

function requireMutablePath(path) {
  if (protectedBuilderWorkspacePathReason(path) !== null) {
    fail('builder_programming_workspace_path_denied');
  }
}

function createBuilderProgrammingWorkspaceTools(rawOptions) {
  const optionDescriptors = exactObject(rawOptions, OPTION_KEYS);
  const runContract = sanitizeBuilderProgrammingRuntimeRunContract(
    optionDescriptors.run_contract.value,
  );
  const initialSourceTree = verifiedSourceTree(optionDescriptors.source_tree.value);
  if (
    runContract.admission.mode !== 'build'
    || !runContract.admission.workspace_ref.writable
    || runContract.admission.workspace_ref.source_tree_digest !== initialSourceTree.source_tree_digest
  ) fail();

  let currentSourceTree = initialSourceTree;
  let currentSearchIndex = createSearchIndex(initialSourceTree);
  let state = 'active';
  const mutationQueues = new Map();

  function requireActive() {
    if (state !== 'active') fail('builder_programming_workspace_closed');
  }

  function requireTool(tool) {
    requireActive();
    if (!runContract.admission.allowed_tools.includes(tool)) {
      fail('builder_programming_workspace_tool_not_allowed');
    }
  }

  function currentFile(path) {
    return currentSourceTree.files.find((file) => file.path === path) ?? null;
  }

  function replaceWorkingFile(path, content) {
    const files = currentSourceTree.files
      .filter((file) => file.path !== path)
      .map((file) => ({ path: file.path, content: file.content }));
    files.push({ path, content });
    try {
      currentSourceTree = createBuilderProjectSourceTree({ files });
      currentSearchIndex = createSearchIndex(currentSourceTree);
    } catch {
      fail();
    }
    return currentFile(path);
  }

  function enqueueMutation(path, mutate) {
    const previous = mutationQueues.get(path) ?? Promise.resolve();
    const guardedMutation = () => {
      requireActive();
      return mutate();
    };
    const operation = previous.then(guardedMutation, guardedMutation);
    const settled = operation.then(() => undefined, () => undefined);
    mutationQueues.set(path, settled);
    void settled.finally(() => {
      if (mutationQueues.get(path) === settled) mutationQueues.delete(path);
    });
    return operation;
  }

  async function read(rawRequest) {
    requireTool('read');
    const descriptors = exactObject(rawRequest, READ_KEYS);
    const path = resourcePath(descriptors.resource_id.value);
    const file = currentFile(path);
    if (file === null) {
      return freezeDeep({
        result_version: BUILDER_PROGRAMMING_WORKSPACE_TOOLS_VERSION,
        tool: 'read',
        status: 'absent',
        resource_id: `project:/${path}`,
        content: null,
        content_bytes: 0,
        observed_version: null,
      });
    }
    const contentBytes = Buffer.byteLength(file.content, 'utf8');
    const maximum = runContract.admission.limits.max_tool_output_bytes;
    return freezeDeep({
      result_version: BUILDER_PROGRAMMING_WORKSPACE_TOOLS_VERSION,
      tool: 'read',
      status: contentBytes > maximum ? 'too_large' : 'ready',
      resource_id: `project:/${path}`,
      content: contentBytes > maximum ? null : file.content,
      content_bytes: contentBytes,
      observed_version: file.content_digest,
    });
  }

  async function search(rawRequest) {
    requireTool('search');
    const descriptors = exactObject(rawRequest, SEARCH_KEYS);
    const query = safeQuery(descriptors.query.value);
    const maximum = safeMaximum(descriptors.max_results.value);
    const queryFolded = query.toLocaleLowerCase('en-US');
    const matches = [];
    let outputBytes = 0;
    let truncated = false;
    let totalMatches = 0;
    function addMatch(match) {
      totalMatches += 1;
      const bytes = Buffer.byteLength(JSON.stringify(match), 'utf8');
      if (
        matches.length >= maximum
        || outputBytes + bytes > runContract.admission.limits.max_tool_output_bytes
      ) {
        truncated = true;
        return;
      }
      outputBytes += bytes;
      matches.push(match);
    }
    for (const file of currentSearchIndex) {
      if (file.path_folded.includes(queryFolded)) {
        addMatch({ resource_id: file.resource_id, line: 0, column: 0, preview: file.path });
      }
      for (let index = 0; index < file.lines.length; index += 1) {
        const line = file.lines[index];
        const column = line.folded.indexOf(queryFolded);
        if (column < 0) continue;
        addMatch({
          resource_id: file.resource_id,
          line: index + 1,
          column: column + 1,
          preview: line.text.slice(0, 240),
        });
      }
    }
    return freezeDeep({
      result_version: BUILDER_PROGRAMMING_WORKSPACE_TOOLS_VERSION,
      tool: 'search',
      status: 'completed',
      query,
      matches,
      truncated,
      total_matches: totalMatches,
    });
  }

  async function edit(rawRequest) {
    requireTool('edit');
    const descriptors = exactObject(rawRequest, EDIT_KEYS);
    const path = resourcePath(descriptors.resource_id.value);
    requireMutablePath(path);
    const observedVersion = safeDigest(descriptors.observed_version.value);
    const content = verifiedContent(path, descriptors.content.value);
    return enqueueMutation(path, () => {
      const before = currentFile(path);
      if (before === null) fail('builder_programming_workspace_file_missing');
      if (before.content_digest !== observedVersion) {
        fail('builder_programming_workspace_stale_file');
      }
      const counts = lineEditCounts(before.content, content);
      const after = replaceWorkingFile(path, content);
      return freezeDeep({
        result_version: BUILDER_PROGRAMMING_WORKSPACE_TOOLS_VERSION,
        tool: 'edit',
        status: before.content === after.content ? 'unchanged' : 'changed',
        resource_id: `project:/${path}`,
        previous_version: before.content_digest,
        observed_version: after.content_digest,
        added_lines: counts.added_lines,
        deleted_lines: counts.deleted_lines,
        source_tree_digest: currentSourceTree.source_tree_digest,
      });
    });
  }

  async function write(rawRequest) {
    requireTool('write');
    const descriptors = exactObject(rawRequest, WRITE_KEYS);
    const path = resourcePath(descriptors.resource_id.value);
    requireMutablePath(path);
    if (descriptors.expected_absent.value !== true) fail();
    const content = verifiedContent(path, descriptors.content.value);
    return enqueueMutation(path, () => {
      if (currentFile(path) !== null) fail('builder_programming_workspace_file_exists');
      const after = replaceWorkingFile(path, content);
      return freezeDeep({
        result_version: BUILDER_PROGRAMMING_WORKSPACE_TOOLS_VERSION,
        tool: 'write',
        status: 'created',
        resource_id: `project:/${path}`,
        previous_version: null,
        observed_version: after.content_digest,
        added_lines: sourceLines(content).length,
        deleted_lines: 0,
        source_tree_digest: currentSourceTree.source_tree_digest,
      });
    });
  }

  async function snapshot() {
    await Promise.all([...mutationQueues.values()]);
    return currentSourceTree;
  }

  async function close() {
    if (state === 'active') state = 'closed';
    await Promise.all([...mutationQueues.values()]);
    return currentSourceTree;
  }

  return freezeDeep({
    service_version: BUILDER_PROGRAMMING_WORKSPACE_TOOLS_VERSION,
    workspace_ref: runContract.admission.workspace_ref,
    read,
    search,
    edit,
    write,
    snapshot,
    close,
    authority: { ...AUTHORITY },
  });
}

module.exports = freezeDeep({
  BUILDER_PROGRAMMING_WORKSPACE_TOOLS_VERSION,
  BuilderProgrammingWorkspaceToolsError,
  createBuilderProgrammingWorkspaceTools,
});
