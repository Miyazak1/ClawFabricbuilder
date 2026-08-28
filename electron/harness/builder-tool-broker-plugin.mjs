const BROKER_VERSION = 'builder-harness-tool-broker.v1'
const MAX_TOOL_TEXT_BYTES = 512 * 1024
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u
const BROWSER_METHODS = Object.freeze([
  'browser_open_local_app', 'browser_observe', 'browser_click', 'browser_type',
  'browser_select_option', 'browser_press_key', 'browser_scroll',
  'browser_reload_latest_source', 'browser_close',
])
const ALL_METHODS = Object.freeze([
  'read', 'search', 'edit', 'write', 'execute_command', 'ask_user_question', ...BROWSER_METHODS,
])
const DEFAULT_ALLOWED_METHODS = Object.freeze(['read', 'search', 'edit', 'write', 'ask_user_question'])

export const name = 'builder-tool-broker'
export const inject = ['tools', 'systemPrompt', 'userQuestions']

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactObject(value, required, optional = []) {
  if (!isPlainObject(value)) throw new Error('Builder tool arguments are invalid.')
  const keys = Object.keys(value)
  const allowed = [...required, ...optional]
  if (
    keys.some(key => !allowed.includes(key))
    || required.some(key => !Object.hasOwn(value, key))
  ) throw new Error('Builder tool arguments are invalid.')
  return value
}

function safeProjectPath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.normalize('NFC') !== value
    || value.includes('\\')
    || value.includes('\0')
    || /^[A-Za-z]:/u.test(value)
    || value.startsWith('/')
  ) throw new Error('Use a project-relative file path.')
  const candidate = value.startsWith('./') ? value.slice(2) : value
  const segments = candidate.split('/')
  if (
    candidate.length === 0
    || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')
  ) throw new Error('Use a project-relative file path.')
  return candidate
}

function safeText(value) {
  if (
    typeof value !== 'string'
    || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > MAX_TOOL_TEXT_BYTES
  ) throw new Error('The file content is invalid or too large.')
  return value
}

function safeQuery(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > 512
  ) throw new Error('The search query is invalid.')
  return value
}

function safeMaximum(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new Error('max_results must be an integer from 1 to 100.')
  }
  return value
}

function safeQuestionText(value, maximumBytes = 4 * 1024) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) throw new Error('The user question is invalid.')
  return value
}

function safeCommandText(value, maximumBytes = 512) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || /[\0\r\n\t]/u.test(value)
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) throw new Error('The project command is invalid.')
  return value
}

function safeBrowserElementRef(value) {
  if (typeof value !== 'string' || !/^browser-element:[0-9a-f]{64}$/u.test(value)) {
    throw new Error('The browser element reference is invalid.')
  }
  return value
}

function safeBrowserValue(value, maximumBytes = 16 * 1024) {
  if (
    typeof value !== 'string'
    || value.normalize('NFC') !== value
    || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) throw new Error('The browser input is invalid.')
  return value
}

function brokerQuestion(rawQuestion) {
  if (!isPlainObject(rawQuestion)) throw new Error('The user question is invalid.')
  const question = {
    id: safeQuestionText(rawQuestion.id, 256),
    question: safeQuestionText(rawQuestion.question),
    ...(rawQuestion.detail === undefined
      ? {}
      : { detail: safeQuestionText(rawQuestion.detail, 16 * 1024) }),
    ...(rawQuestion.header === undefined
      ? {}
      : { header: safeQuestionText(rawQuestion.header, 512) }),
    ...(rawQuestion.multiSelect === undefined
      ? {}
      : { multi_select: rawQuestion.multiSelect === true }),
  }
  if (rawQuestion.options !== undefined) {
    if (!Array.isArray(rawQuestion.options) || rawQuestion.options.length > 3) {
      throw new Error('The user question options are invalid.')
    }
    question.options = rawQuestion.options.map((rawOption) => {
      if (!isPlainObject(rawOption)) throw new Error('The user question option is invalid.')
      return {
        label: safeQuestionText(rawOption.label, 512),
        ...(rawOption.description === undefined
          ? {}
          : { description: safeQuestionText(rawOption.description, 2 * 1024) }),
      }
    })
  }
  if (rawQuestion.intent !== undefined) {
    if (
      !isPlainObject(rawQuestion.intent)
      || rawQuestion.intent.kind !== 'plan-review'
    ) throw new Error('The user question intent is invalid.')
    question.intent = {
      kind: 'plan-review',
      approve: safeQuestionText(rawQuestion.intent.approve, 512),
    }
  }
  return question
}

function brokerAccess() {
  const endpoint = process.env.BUILDER_TOOL_BROKER_URL
  const token = process.env.BUILDER_TOOL_BROKER_TOKEN
  let parsed
  try { parsed = new URL(endpoint) } catch { throw new Error('Builder tool access is unavailable.') }
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || parsed.pathname !== '/v1/tool'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.search !== ''
    || parsed.hash !== ''
    || typeof token !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/u.test(token)
  ) throw new Error('Builder tool access is unavailable.')
  return { endpoint: parsed.href, token }
}

function allowedMethodsFromEnvironment() {
  const raw = process.env.BUILDER_TOOL_BROKER_ALLOWED_METHODS
  if (raw === undefined) return new Set(DEFAULT_ALLOWED_METHODS)
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new Error('Builder tool access is unavailable.') }
  if (
    !Array.isArray(parsed)
    || parsed.length < 1
    || parsed.length > ALL_METHODS.length
    || parsed.some(method => typeof method !== 'string' || !ALL_METHODS.includes(method))
  ) throw new Error('Builder tool access is unavailable.')
  return new Set(parsed)
}

async function brokerCall(access, method, args, signal) {
  const response = await globalThis.fetch(access.endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${access.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ method, arguments: args }),
    signal,
  })
  let envelope
  try { envelope = await response.json() } catch { throw new Error('Builder returned an unreadable tool result.') }
  if (!isPlainObject(envelope) || envelope.broker_version !== BROKER_VERSION) {
    throw new Error('Builder returned an unverified tool result.')
  }
  if (response.ok && envelope.ok === true && Object.hasOwn(envelope, 'result')) return envelope.result
  const failure = envelope.ok === false && isPlainObject(envelope.error) ? envelope.error : null
  const message = failure && typeof failure.message === 'string'
    ? failure.message
    : 'Builder could not complete the tool request.'
  throw new Error(message)
}

const nullableStringSchema = Object.freeze({
  oneOf: [{ type: 'string' }, { type: 'null' }],
})

const readOutputSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string' },
    file_path: { type: 'string' },
    content: nullableStringSchema,
    content_bytes: { type: 'integer' },
    observed_version: nullableStringSchema,
    total_lines: { type: 'integer' },
  },
  required: ['status', 'file_path', 'content', 'content_bytes', 'observed_version', 'total_lines'],
})

const searchOutputSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string' },
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          line: { type: 'integer' },
          column: { type: 'integer' },
          preview: { type: 'string' },
        },
        required: ['path', 'line', 'column', 'preview'],
      },
    },
    truncated: { type: 'boolean' },
    total: { type: 'integer' },
  },
  required: ['query', 'matches', 'truncated', 'total'],
})

const mutationOutputSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string' },
    file_path: { type: 'string' },
    observed_version: { type: 'string' },
    added_lines: { type: 'integer' },
    deleted_lines: { type: 'integer' },
  },
  required: ['status', 'file_path', 'observed_version', 'added_lines', 'deleted_lines'],
})

const commandOutputSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string' },
    command_kind: { type: 'string' },
    command_display: { type: 'string' },
    exit_code: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    duration_ms: { type: 'integer' },
    stdout_preview: { type: 'string' },
    stderr_preview: { type: 'string' },
    output_truncated: { type: 'boolean' },
  },
  required: [
    'status', 'command_kind', 'command_display', 'exit_code', 'duration_ms',
    'stdout_preview', 'stderr_preview', 'output_truncated',
  ],
})

function textBlock(text) {
  return [{ type: 'text', text }]
}

function displayLines(content) {
  if (typeof content !== 'string') return []
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map((text, index) => ({ number: index + 1, text }))
}

function languageHint(filePath) {
  const extension = filePath.split('.').at(-1)?.toLocaleLowerCase('en-US')
  const hints = {
    cjs: 'js', css: 'css', html: 'html', js: 'js', json: 'json',
    jsx: 'jsx', md: 'md', mjs: 'js', py: 'py', ts: 'ts', tsx: 'tsx',
  }
  return extension === undefined ? undefined : hints[extension]
}

function safeResultMeta(result, kind) {
  if (result?.isError === true || !isPlainObject(result?.meta) || result.meta.kind !== kind) return null
  return result.meta
}

function readTool(access) {
  return {
    name: 'read',
    description: 'Read one UTF-8 project file. Returns its content and observed version for a later edit.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        file_path: { type: 'string', description: 'Project-relative file path.' },
      },
      required: ['file_path'],
    },
    output: {
      schema: readOutputSchema,
      render: (_args, value) => {
        if (value.status === 'absent') return textBlock(`File: ${value.file_path}\nStatus: absent`)
        if (value.status === 'too_large') {
          return textBlock(`File: ${value.file_path}\nStatus: too large to read\nBytes: ${value.content_bytes}`)
        }
        return textBlock(`File: ${value.file_path}\nObserved version: ${value.observed_version}\nContent:\n${value.content}`)
      },
      presentationMeta: (_args, value) => ({
        kind: 'read',
        path: value.file_path,
        offset: 1,
        lines: displayLines(value.content),
        totalLines: value.total_lines,
        ...(languageHint(value.file_path) === undefined ? {} : { lang: languageHint(value.file_path) }),
      }),
    },
    presentCall(args) {
      try {
        const filePath = safeProjectPath(exactObject(args, ['file_path']).file_path)
        return {
          card: 'generic',
          title: `Read ${filePath}`,
          kind: 'read',
          locations: [{ path: filePath, line: 1 }],
        }
      } catch { return undefined }
    },
    presentResult(_args, result) {
      const meta = safeResultMeta(result, 'read')
      if (meta === null || typeof meta.path !== 'string' || !Array.isArray(meta.lines)) return undefined
      return {
        card: 'read',
        title: `Read ${meta.path}`,
        path: meta.path,
        offset: meta.offset,
        lines: meta.lines,
        totalLines: meta.totalLines,
        ...(typeof meta.lang === 'string' ? { lang: meta.lang } : {}),
        content: result.content,
      }
    },
    isConcurrencySafe: () => true,
    async execute(rawArgs, execution) {
      const args = exactObject(rawArgs, ['file_path'])
      const filePath = safeProjectPath(args.file_path)
      const result = await brokerCall(access, 'read', {
        resource_id: `project:/${filePath}`,
      }, execution.signal)
      return {
        status: result.status,
        file_path: filePath,
        content: result.content,
        content_bytes: result.content_bytes,
        observed_version: result.observed_version,
        total_lines: typeof result.content === 'string' ? displayLines(result.content).length : 0,
      }
    },
  }
}

function grepTool(access) {
  return {
    name: 'grep',
    description: 'Search project file names and UTF-8 file contents for literal text.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Literal text to find.' },
        max_results: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum matches. Defaults to 50.' },
      },
      required: ['query'],
    },
    output: {
      schema: searchOutputSchema,
      render: (_args, value) => {
        if (value.matches.length === 0) return textBlock(`No project matches found for: ${value.query}`)
        const lines = value.matches.map(match => {
          const location = match.line > 0 ? `:${match.line}:${match.column}` : ''
          return `${match.path}${location} ${match.preview}`
        })
        if (value.truncated) lines.push('More matches were omitted.')
        return textBlock(lines.join('\n'))
      },
      presentationMeta: (_args, value) => ({
        kind: 'search',
        query: value.query,
        matches: value.matches,
        truncated: value.truncated,
        total: value.total,
      }),
    },
    presentCall(args) {
      try {
        const query = safeQuery(exactObject(args, ['query'], ['max_results']).query)
        return { card: 'generic', title: `Search for ${query}`, kind: 'search', rawInput: query }
      } catch { return undefined }
    },
    presentResult(_args, result) {
      const meta = safeResultMeta(result, 'search')
      if (meta === null || !Array.isArray(meta.matches)) return undefined
      const grouped = new Map()
      for (const match of meta.matches) {
        if (!isPlainObject(match) || typeof match.path !== 'string' || !Number.isInteger(match.line)) return undefined
        const matches = grouped.get(match.path) ?? []
        matches.push({ lineNumber: Math.max(1, match.line), line: match.preview })
        grouped.set(match.path, matches)
      }
      return {
        card: 'search',
        shape: 'matches',
        title: `Search for ${meta.query}`,
        files: [...grouped].map(([path, matches]) => ({ path, matches })),
        truncated: meta.truncated,
        total: meta.total,
      }
    },
    isConcurrencySafe: () => true,
    async execute(rawArgs, execution) {
      const args = exactObject(rawArgs, ['query'], ['max_results'])
      const query = safeQuery(args.query)
      const maximum = args.max_results === undefined ? 50 : safeMaximum(args.max_results)
      const result = await brokerCall(access, 'search', {
        query,
        max_results: maximum,
      }, execution.signal)
      return {
        query,
        matches: result.matches.map(match => ({
          path: match.resource_id.slice('project:/'.length),
          line: match.line,
          column: match.column,
          preview: match.preview,
        })),
        truncated: result.truncated,
        total: result.total_matches,
      }
    },
  }
}

function editTool(access) {
  return {
    name: 'edit',
    description: 'Replace the complete content of an existing UTF-8 project file after reading it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        file_path: { type: 'string', description: 'Project-relative file path.' },
        observed_version: { type: 'string', description: 'Observed version returned by the most recent read.' },
        content: { type: 'string', description: 'Complete replacement file content.' },
      },
      required: ['file_path', 'observed_version', 'content'],
    },
    output: {
      schema: mutationOutputSchema,
      render: (_args, value) => textBlock([
        `Edited: ${value.file_path}`,
        `Status: ${value.status}`,
        `Observed version: ${value.observed_version}`,
        `Lines: +${value.added_lines} -${value.deleted_lines}`,
      ].join('\n')),
      presentationMeta: (args, value) => ({
        kind: 'diff',
        path: value.file_path,
        oldText: null,
        newText: args.content,
        addedLines: value.added_lines,
        deletedLines: value.deleted_lines,
      }),
    },
    presentCall(args) {
      try {
        const checked = exactObject(args, ['file_path', 'observed_version', 'content'])
        const filePath = safeProjectPath(checked.file_path)
        return {
          card: 'diff', title: `Edit ${filePath}`,
          diffs: [{ path: filePath, oldText: null, newText: checked.content }],
          locations: [{ path: filePath }],
        }
      } catch { return undefined }
    },
    presentResult(_args, result) {
      const meta = safeResultMeta(result, 'diff')
      if (meta === null || typeof meta.path !== 'string' || typeof meta.newText !== 'string') return undefined
      return { card: 'diff', title: `Edited ${meta.path}`, diffs: [{ path: meta.path, oldText: null, newText: meta.newText }] }
    },
    async execute(rawArgs, execution) {
      const args = exactObject(rawArgs, ['file_path', 'observed_version', 'content'])
      const filePath = safeProjectPath(args.file_path)
      if (typeof args.observed_version !== 'string' || !DIGEST_PATTERN.test(args.observed_version)) {
        throw new Error('Read the file first and use its observed version.')
      }
      const result = await brokerCall(access, 'edit', {
        resource_id: `project:/${filePath}`,
        observed_version: args.observed_version,
        content: safeText(args.content),
      }, execution.signal)
      return {
        status: result.status,
        file_path: filePath,
        observed_version: result.observed_version,
        added_lines: result.added_lines,
        deleted_lines: result.deleted_lines,
      }
    },
  }
}

function writeTool(access) {
  return {
    name: 'write',
    description: 'Create one new UTF-8 project file. It fails if the path already exists.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        file_path: { type: 'string', description: 'Project-relative path for a new file.' },
        content: { type: 'string', description: 'Complete new file content.' },
      },
      required: ['file_path', 'content'],
    },
    output: {
      schema: mutationOutputSchema,
      render: (_args, value) => textBlock([
        `Created: ${value.file_path}`,
        `Observed version: ${value.observed_version}`,
        `Lines: +${value.added_lines} -0`,
      ].join('\n')),
      presentationMeta: (args, value) => ({
        kind: 'diff',
        path: value.file_path,
        oldText: null,
        newText: args.content,
        addedLines: value.added_lines,
        deletedLines: 0,
      }),
    },
    presentCall(args) {
      try {
        const checked = exactObject(args, ['file_path', 'content'])
        const filePath = safeProjectPath(checked.file_path)
        return {
          card: 'diff', title: `Write ${filePath}`,
          diffs: [{ path: filePath, oldText: null, newText: checked.content }],
          locations: [{ path: filePath }],
        }
      } catch { return undefined }
    },
    presentResult(_args, result) {
      const meta = safeResultMeta(result, 'diff')
      if (meta === null || typeof meta.path !== 'string' || typeof meta.newText !== 'string') return undefined
      return { card: 'diff', title: `Wrote ${meta.path}`, diffs: [{ path: meta.path, oldText: null, newText: meta.newText }] }
    },
    async execute(rawArgs, execution) {
      const args = exactObject(rawArgs, ['file_path', 'content'])
      const filePath = safeProjectPath(args.file_path)
      const result = await brokerCall(access, 'write', {
        resource_id: `project:/${filePath}`,
        expected_absent: true,
        content: safeText(args.content),
      }, execution.signal)
      return {
        status: result.status,
        file_path: filePath,
        observed_version: result.observed_version,
        added_lines: result.added_lines,
        deleted_lines: 0,
      }
    },
  }
}

function bashTool(access) {
  return {
    name: 'bash',
    description: 'Run one current project check command after Builder shows it to the user for one-time approval.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        command: { type: 'string', description: 'Exact current project command, such as npm test.' },
        description: { type: 'string', description: 'Short user-visible reason for running this command.' },
      },
      required: ['command', 'description'],
    },
    output: {
      schema: commandOutputSchema,
      render: (_args, value) => textBlock([
        `Command: ${value.command_display}`,
        `Status: ${value.status}`,
        `Exit code: ${value.exit_code ?? 'none'}`,
        `Duration: ${value.duration_ms} ms`,
        value.stdout_preview.length === 0 ? '' : `stdout:\n${value.stdout_preview}`,
        value.stderr_preview.length === 0 ? '' : `stderr:\n${value.stderr_preview}`,
        value.output_truncated ? 'Some command output was omitted.' : '',
      ].filter(Boolean).join('\n')),
      presentationMeta: (_args, value) => ({
        kind: 'command',
        status: value.status,
        command: value.command_display,
        exitCode: value.exit_code,
        durationMs: value.duration_ms,
        stdoutPreview: value.stdout_preview,
        stderrPreview: value.stderr_preview,
        truncated: value.output_truncated,
      }),
    },
    presentCall(args) {
      try {
        const checked = exactObject(args, ['command', 'description'])
        const command = safeCommandText(checked.command)
        return { card: 'generic', title: `Run ${command}`, kind: 'command', rawInput: command }
      } catch { return undefined }
    },
    async execute(rawArgs, execution) {
      const args = exactObject(rawArgs, ['command', 'description'])
      const result = await brokerCall(access, 'execute_command', {
        command: safeCommandText(args.command),
        description: safeCommandText(args.description, 1_024),
      }, execution.signal)
      return {
        status: result.status,
        command_kind: result.command_kind,
        command_display: result.command_display,
        exit_code: result.exit_code,
        duration_ms: result.duration_ms,
        stdout_preview: result.stdout_preview,
        stderr_preview: result.stderr_preview,
        output_truncated: result.output_truncated,
      }
    },
  }
}

const browserObservationOutputSchema = Object.freeze({
  type: 'object',
  additionalProperties: true,
})

function browserObservationText(value) {
  if (!isPlainObject(value)) return 'Browser observation unavailable.'
  const lines = [
    typeof value.title === 'string' && value.title.length > 0 ? `Title: ${value.title}` : null,
    typeof value.url === 'string' ? `URL: ${value.url}` : null,
    typeof value.visible_text === 'string' && value.visible_text.length > 0
      ? `Visible text:\n${value.visible_text}`
      : 'Visible text: none',
  ].filter(Boolean)
  if (Array.isArray(value.elements) && value.elements.length > 0) {
    lines.push('Interactive elements:')
    for (const element of value.elements) {
      if (!isPlainObject(element)) continue
      lines.push(`${element.element_ref} [${element.role}] ${element.name || '(unnamed)'}${element.disabled ? ' disabled' : ''}`)
    }
  }
  if (Array.isArray(value.accessibility) && value.accessibility.length > 0) {
    lines.push('Accessibility summary:')
    for (const node of value.accessibility) {
      if (!isPlainObject(node)) continue
      const states = [
        node.disabled ? 'disabled' : null,
        node.checked ? 'checked' : null,
        node.selected ? 'selected' : null,
        node.expanded ? 'expanded' : null,
      ].filter(Boolean).join(', ')
      lines.push(`[${node.role}] ${node.name || '(unnamed)'}${states ? ` (${states})` : ''}`)
    }
  }
  if (Array.isArray(value.console_reports) && value.console_reports.length > 0) {
    lines.push(`Console reports: ${JSON.stringify(value.console_reports)}`)
  }
  if (Array.isArray(value.network_reports) && value.network_reports.length > 0) {
    lines.push(`Network reports: ${JSON.stringify(value.network_reports)}`)
  }
  if (typeof value.screenshot_digest === 'string') lines.push(`Screenshot digest: ${value.screenshot_digest}`)
  if (typeof value.screenshot_capture_status === 'string') {
    lines.push(`Screenshot capture: ${value.screenshot_capture_status}`)
  }
  if (typeof value.screenshot_pixel_status === 'string') {
    lines.push(`Screenshot pixels: ${value.screenshot_pixel_status}`)
  }
  if (isPlainObject(value.action_receipt)) {
    lines.push(`Action evidence: ${value.action_receipt.action_kind} changed observation ${value.action_receipt.before_observation_digest} -> ${value.action_receipt.after_observation_digest}`)
  }
  if (Number.isSafeInteger(value.blocked_request_count) && value.blocked_request_count > 0) {
    lines.push(`Blocked browser requests: ${value.blocked_request_count}`)
  }
  return lines.join('\n')
}

function browserTool({
  access,
  name,
  method,
  description,
  properties = {},
  required = [],
  sanitize,
  concludesTurn = false,
}) {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties,
      required,
    },
    output: {
      schema: browserObservationOutputSchema,
      render: (_args, value) => textBlock(browserObservationText(value)),
    },
    presentCall() {
      return { card: 'generic', title: description, kind: 'browser' }
    },
    async execute(rawArgs, execution) {
      const args = sanitize(rawArgs)
      const result = await brokerCall(access, method, args, execution.signal)
      if (concludesTurn) execution.concludeTurn()
      return result
    },
  }
}

function browserTools(access, allowedMethods) {
  const definitions = [
    {
      name: 'browser_open_local_app', method: 'browser_open_local_app',
      description: 'Open the current run source in an isolated local Agent Test browser and observe it.',
      sanitize: (args) => exactObject(args, []),
      concludesTurn: true,
    },
    {
      name: 'browser_observe', method: 'browser_observe',
      description: 'Observe the current Agent Test page without changing it.',
      sanitize: (args) => exactObject(args, []),
    },
    {
      name: 'browser_click', method: 'browser_click',
      description: 'Click one element from the latest Agent Test observation.',
      properties: { element_ref: { type: 'string' } }, required: ['element_ref'],
      sanitize: (args) => ({ element_ref: safeBrowserElementRef(exactObject(args, ['element_ref']).element_ref) }),
    },
    {
      name: 'browser_type', method: 'browser_type',
      description: 'Replace the value of one input from the latest Agent Test observation.',
      properties: { element_ref: { type: 'string' }, value: { type: 'string' } }, required: ['element_ref', 'value'],
      sanitize: (args) => {
        const value = exactObject(args, ['element_ref', 'value'])
        return { element_ref: safeBrowserElementRef(value.element_ref), value: safeBrowserValue(value.value) }
      },
    },
    {
      name: 'browser_select_option', method: 'browser_select_option',
      description: 'Select an option in one select element from the latest Agent Test observation.',
      properties: { element_ref: { type: 'string' }, value: { type: 'string' } }, required: ['element_ref', 'value'],
      sanitize: (args) => {
        const value = exactObject(args, ['element_ref', 'value'])
        return { element_ref: safeBrowserElementRef(value.element_ref), value: safeBrowserValue(value.value, 512) }
      },
    },
    {
      name: 'browser_press_key', method: 'browser_press_key',
      description: 'Press one key in the current Agent Test page.',
      properties: { key: { type: 'string' } }, required: ['key'],
      sanitize: (args) => ({ key: safeBrowserValue(exactObject(args, ['key']).key, 64) }),
    },
    {
      name: 'browser_scroll', method: 'browser_scroll',
      description: 'Scroll the current Agent Test page by bounded pixel deltas.',
      properties: { delta_x: { type: 'integer' }, delta_y: { type: 'integer' } }, required: ['delta_x', 'delta_y'],
      sanitize: (args) => {
        const value = exactObject(args, ['delta_x', 'delta_y'])
        if (![value.delta_x, value.delta_y].every(item => Number.isSafeInteger(item) && Math.abs(item) <= 10000)) {
          throw new Error('The browser scroll request is invalid.')
        }
        return value
      },
    },
    {
      name: 'browser_reload_latest_source', method: 'browser_reload_latest_source',
      description: 'Rebuild the isolated Agent Test page from the latest current-run source and observe it.',
      sanitize: (args) => exactObject(args, []),
      concludesTurn: true,
    },
    {
      name: 'browser_close', method: 'browser_close',
      description: 'Close the current Agent Test browser and clear its ephemeral storage.',
      sanitize: (args) => exactObject(args, []),
    },
  ]
  return definitions
    .filter(definition => allowedMethods.has(definition.method))
    .map(definition => browserTool({ access, ...definition }))
}

export function apply(ctx) {
  const access = brokerAccess()
  const allowedMethods = allowedMethodsFromEnvironment()
  if (allowedMethods.has('ask_user_question')) {
    ctx.userQuestions.registerProvider({
      async ask(request) {
        if (!Array.isArray(request.questions) || request.questions.length !== 1) {
          throw new Error('Ask one user question at a time in Builder.')
        }
        return brokerCall(access, 'ask_user_question', {
          questions: request.questions.map(brokerQuestion),
        }, request.signal)
      },
    })
  }
  ctx.systemPrompt.section({
    name: 'builder:workspace-tools',
    order: 90,
    text: [
      'Use only the Builder read, grep, edit, and write tools for project files.',
      'Use project-relative paths. Read an existing file before editing and pass its exact observed_version.',
      'Create and edit only ordinary UTF-8 project files. Do not create binary paths such as .png, .jpg, or .webp; use .svg for text-based image placeholders.',
      'Prefer a coherent runnable implementation over placeholder-only scaffolding. Builder enforces source and operation-risk limits.',
      allowedMethods.has('execute_command')
        ? 'Use write only for a new path. In Build mode, use bash only for an exact current project test, lint, typecheck, or build command. Builder will ask the user to allow that command once; do not claim it ran before receiving the result.'
        : 'Use write only for a new path. Shell commands are not available in this run; Builder runs checks after the turn.',
      allowedMethods.has('browser_open_local_app')
        ? 'For a local HTML application, use browser_open_local_app after creating a coherent runnable state. A successful browser_open_local_app or browser_reload_latest_source is a verification checkpoint that ends the current Harness turn so Builder can run checks; do not promise more work in that same turn. After Builder reports a failed check, change the source in the repair turn, call browser_reload_latest_source, and verify the returned visible result. Browser tools cannot access external sites, cookies, downloads, commands, dependencies, or project files directly.'
        : 'Agent Test browser tools are not available in this run.',
      'If one missing decision or fact truly prevents safe progress, call ask_user_question with exactly one concise question. Continue the same task after the answer; do not end the run merely because you asked.',
    ].join(' '),
  })
  if (allowedMethods.has('read')) ctx.tools.register(readTool(access))
  if (allowedMethods.has('search')) ctx.tools.register(grepTool(access))
  if (allowedMethods.has('edit')) ctx.tools.register(editTool(access))
  if (allowedMethods.has('write')) ctx.tools.register(writeTool(access))
  if (allowedMethods.has('execute_command')) ctx.tools.register(bashTool(access))
  for (const tool of browserTools(access, allowedMethods)) ctx.tools.register(tool)
}
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { URL } from 'node:url'
