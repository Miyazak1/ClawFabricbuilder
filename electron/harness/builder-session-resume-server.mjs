import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import process from 'node:process'
import { setImmediate } from 'node:timers'

export const name = 'builder-session-resume-server'
export const inject = ['agents', 'sessionPersistence', 'compaction']

const SESSION_ID = /^builder-harness-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SOURCE_COMMAND_ID = /^builder-context-compaction-admission:[0-9a-f]{64}$/u
const COMPACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/u
const CONTEXT_PROJECTION_KEYS = new Set(['tokenUsage', 'contextPressure'])
const MAX_TOKEN_COUNT = 1_000_000_000
const BROKEN_TRANSPORT_WRITE_CODES = new Set([
  'EPIPE',
  'ECONNRESET',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_WRITE_AFTER_END',
])

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? value : null
}

function count(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum && value <= MAX_TOKEN_COUNT
    ? value
    : null
}

function optionalCount(source, key, minimum = 0) {
  if (!Object.hasOwn(source, key)) return null
  return count(source[key], minimum)
}

function seq(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 10_000_000
    ? value
    : null
}

function sourceCommandId(params) {
  if (!params || typeof params.sourceCommandId !== 'string' || !SOURCE_COMMAND_ID.test(params.sourceCommandId)) {
    throw new Error('Invalid Builder compaction admission identity.')
  }
  return params.sourceCommandId
}

function compactResult(result, expectedSourceCommandId) {
  if (result === null) return null
  const source = plainObject(result)
  if (source === null) throw new Error('Invalid Harness compaction result.')
  const compactionId = source.compactionId
  const startSeq = seq(source.startSeq)
  const summarySeq = seq(source.summarySeq)
  const endSeq = seq(source.endSeq)
  const shadowedTokenCount = count(source.shadowedTokenCount, 1)
  if (
    typeof compactionId !== 'string'
    || !COMPACTION_ID.test(compactionId)
    || source.sourceCommandId !== expectedSourceCommandId
    || startSeq === null
    || summarySeq === null
    || endSeq === null
    || shadowedTokenCount === null
    || !(startSeq < summarySeq && summarySeq < endSeq)
  ) throw new Error('Invalid Harness compaction result.')
  return Object.freeze({
    compactionId,
    sourceCommandId: expectedSourceCommandId,
    startSeq,
    summarySeq,
    endSeq,
    shadowedTokenCount,
  })
}

export function isBuilderBrokenTransportWrite(error) {
  return error instanceof Error
    && typeof error.code === 'string'
    && BROKEN_TRANSPORT_WRITE_CODES.has(error.code)
}

function sanitizedTransportWriteFailure(error) {
  return Object.freeze({
    code: 'builder_harness_jsonrpc_transport_closed',
    cause_code: typeof error?.code === 'string' ? error.code : 'unknown',
    syscall: typeof error?.syscall === 'string' ? error.syscall : null,
  })
}

export function installBuilderJsonRpcTransportWriteBoundary(transport, {
  onTransportError = () => {},
} = {}) {
  const output = transport?.output
  const originalClose = typeof transport?.close === 'function' ? transport.close.bind(transport) : null
  const originalFlush = typeof transport?.flush === 'function' ? transport.flush.bind(transport) : null
  if (
    transport === null
    || typeof transport !== 'object'
    || output === null
    || typeof output !== 'object'
    || typeof output.write !== 'function'
    || originalClose === null
    || originalFlush === null
  ) throw new Error('Invalid Builder JSON-RPC transport boundary.')

  let closedByWriteFailure = false
  let outputErrorListener = null

  function report(error) {
    if (!isBuilderBrokenTransportWrite(error)) return false
    if (!closedByWriteFailure) {
      closedByWriteFailure = true
      try { onTransportError(sanitizedTransportWriteFailure(error)) } catch {
        // Reporting transport failure must not throw back into the JSON-RPC write path.
      }
      try { originalClose() } catch {
        // The transport is already broken; close failures are observed through the stored failure.
      }
    }
    return true
  }

  transport.write = (message) => {
    if (closedByWriteFailure) return false
    const frame = `${JSON.stringify(message)}\n`
    try {
      return output.write(frame, (error) => {
        if (error !== null && error !== undefined) report(error)
      })
    } catch (error) {
      if (report(error)) return false
      throw error
    }
  }

  transport.flush = async () => {
    if (closedByWriteFailure) return
    try {
      await originalFlush()
    } catch (error) {
      if (report(error)) return
      throw error
    }
  }

  transport.close = () => {
    if (outputErrorListener !== null && typeof output.off === 'function') {
      output.off('error', outputErrorListener)
      outputErrorListener = null
    }
    return originalClose()
  }

  if (typeof output.on === 'function') {
    outputErrorListener = (error) => {
      if (!report(error)) throw error
    }
    output.on('error', outputErrorListener)
  }

  return transport
}

export function sanitizeBuilderContextUsageSnapshot(sessionId, snapshot) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null
  const source = plainObject(snapshot)
  const values = plainObject(source?.values)
  const tokenUsage = plainObject(values?.tokenUsage)
  const contextPressure = plainObject(values?.contextPressure)
  const projectionSeq = source === null ? null : count(source.asOfSeq, -1)
  if (projectionSeq === null || tokenUsage === null || contextPressure === null) return null
  const uncachedInputTokens = count(tokenUsage.uncachedInputTokens)
  const outputTokens = count(tokenUsage.outputTokens)
  const cacheReadTokens = count(tokenUsage.cacheReadTokens)
  const cacheWriteTokens = count(tokenUsage.cacheWriteTokens)
  if (
    uncachedInputTokens === null
    || outputTokens === null
    || cacheReadTokens === null
    || cacheWriteTokens === null
  ) return null
  return Object.freeze({
    sessionId,
    projectionSeq,
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    pressureTokens: optionalCount(contextPressure, 'pressureTokens'),
    projectedTokens: optionalCount(contextPressure, 'projectedTokens'),
    contextWindowTokens: optionalCount(contextPressure, 'contextWindow', 1),
  })
}

export function createBuilderContextUsageProjectionBridge({
  sessionProjections,
  notify,
  getSelectedSessionId,
}) {
  let lastPublication = null

  function publish(session) {
    const selectedSessionId = getSelectedSessionId()
    if (selectedSessionId === null || String(session?.id) !== selectedSessionId) return false
    const params = sanitizeBuilderContextUsageSnapshot(
      selectedSessionId,
      sessionProjections.snapshot(session),
    )
    if (params === null) return false
    const publication = JSON.stringify(params)
    if (publication === lastPublication) return false
    lastPublication = publication
    notify('session.context-usage', params)
    return true
  }

  const dispose = sessionProjections.onChanged((session, key) => {
    if (CONTEXT_PROJECTION_KEYS.has(key)) publish(session)
  })
  return Object.freeze({ publish, dispose })
}

// This adapter uses only public Harness APIs. The entry point resolves the
// pinned runtime packages, including when they live in harness-runtime.asar.
export async function apply(ctx, config = {}) {
  const requireRuntime = createRequire(process.argv[1])
  const load = id => import(pathToFileURL(requireRuntime.resolve(id)).href)
  const { HarnessSdkJsonRpcServer } = await load('@deepseek-ai/dsh-sdk-jsonrpc-server')
  const { JsonRpcLineTransport } = await load('@deepseek-ai/dsh-sdk-protocol')
  const { createUserMessage } = await load('@deepseek-ai/dsh-llm')
  const { SessionId } = await load('@deepseek-ai/dsh-session')
  const transport = installBuilderJsonRpcTransportWriteBoundary(
    new JsonRpcLineTransport(config.input ?? process.stdin, config.output ?? process.stdout),
  )
  let restoring = false
  const notify = (method, params) => {
    if (!restoring) transport.notify(method, params)
  }
  const server = new HarnessSdkJsonRpcServer(ctx, {
    // Cold-load repair belongs to retained history, not the newly admitted run.
    notify,
  }, { maxTokensAsSuccess: config.maxTokensAsSuccess === true })
  let selectedSessionId = null
  let publishProjection = () => false
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    const bridge = createBuilderContextUsageProjectionBridge({
      sessionProjections: projectionCtx.sessionProjections,
      notify,
      getSelectedSessionId: () => selectedSessionId,
    })
    publishProjection = bridge.publish
    projectionCtx.effect(() => () => {
      publishProjection = () => false
      bridge.dispose()
    }, 'builder.context-usage-projection')
  })
  const resume = createResumeDispatcher({ ctx, server, createUserMessage, SessionId,
    setRestoring(value) { restoring = value },
    setSelectedSessionId(value) { selectedSessionId = value },
    publishProjection(session) { return publishProjection(session) },
  })
  ctx.on('agent/request', (payload, next) => resume.resolveRequest(payload, next))
  let exitTask
  transport.onRequest(async (method, params) => {
    const result = await resume.handleRequest(method, params)
    if (method === 'shutdown') {
      setImmediate(() => {
        exitTask ??= (async () => {
          await transport.flush()
          await ctx.root.fiber.dispose()
          ;(config.exit ?? (code => process.exit(code)))(0)
        })()
        void exitTask
      })
    }
    return result
  })
  ctx.effect(() => {
    transport.start()
    return async () => {
      await resume.shutdown()
      transport.close()
    }
  }, 'builder.jsonrpc.serve')
}

export function createResumeDispatcher({
  ctx,
  server,
  createUserMessage,
  SessionId,
  setRestoring,
  setSelectedSessionId = () => {},
  publishProjection = () => false,
}) {
  let initialized = null
  let selectedSession = null
  let restored = null
  let resumeTask = null
  let shuttingDown = false
  let shutdownTask = null
  let recoveringEmptyOutput = false
  let emptyOutputRecoveryUsed = false

  function agentOptions() {
    return {
      provider: initialized.provider,
      model: initialized.model,
      ...(initialized.maxTokens === undefined ? {} : { maxTokens: initialized.maxTokens }),
    }
  }

  async function restoreSelectedSession(id) {
    setRestoring(true)
    try {
      restored = await ctx.agents.resume({
        resumeSessionId: SessionId(id),
        agentOptions: agentOptions(),
      })
      return restored.agent
    } finally { setRestoring(false) }
  }

  async function waitForIdleAgent(agent) {
    if (typeof agent?.whenIdle === 'function') await agent.whenIdle()
  }

  async function withAgentInitiator(agent, operation) {
    return typeof ctx.agents?.withInitiator === 'function'
      ? await ctx.agents.withInitiator(agent, operation)
      : await operation()
  }

  function sessionId(params) {
    if (!params || typeof params.sessionId !== 'string' || !SESSION_ID.test(params.sessionId)) {
      throw new Error('Invalid Builder Harness session identity.')
    }
    if (selectedSession !== null && selectedSession !== params.sessionId) {
      throw new Error('The runtime is already bound to another Builder session.')
    }
    if (selectedSession === null) setSelectedSessionId(params.sessionId)
    return params.sessionId
  }

  async function shutdown() {
    shuttingDown = true
    recoveringEmptyOutput = false
    shutdownTask ??= (async () => {
      await resumeTask?.catch(() => {})
      try { await restored?.dispose() } finally { await server.shutdown() }
    })()
    return shutdownTask
  }

  return {
    shutdown,
    async resolveRequest({ agent }, next) {
      const request = await next()
      // Only Main can select this recovery route. Keep it on the selected task;
      // regular followups and other agents retain the composition's effort.
      return !shuttingDown && recoveringEmptyOutput && String(agent.session.id) === selectedSession
        ? { ...request, reasoningEffort: 'off' }
        : request
    },
    async handleRequest(method, params) {
      if (method === 'shutdown') return shutdown().then(() => ({}))
      if (shuttingDown) throw new Error('The runtime is shutting down.')
      if (method === 'initialize') {
        if (initialized !== null) throw new Error('The runtime is already initialized.')
        const result = await server.handleRequest(method, params)
        initialized = { ...params }
        return result
      }
      if (initialized === null) throw new Error('Initialize the runtime first.')
      if (method === 'session/resume') {
        const id = sessionId(params)
        if (Object.keys(params).length !== 1) throw new Error('Invalid resume request.')
        if (selectedSession !== null && resumeTask === null) throw new Error('The session is already running.')
        selectedSession = id
        resumeTask ??= (async () => {
          await restoreSelectedSession(id)
          return { sessionId: id, restored: true }
        })()
        return resumeTask
      }
      if (method === 'session/compact') {
        const id = sessionId(params)
        const commandId = sourceCommandId(params)
        if (Object.keys(params).length !== 2) throw new Error('Invalid compact request.')
        if (resumeTask !== null) await resumeTask
        if (shuttingDown) throw new Error('The runtime is shutting down.')
        selectedSession = id
        let agent = restored?.agent ?? ctx.agents.get(id)
        if (
          agent === null
          || agent === undefined
          || String(agent.session?.id) !== id
        ) {
          agent = await restoreSelectedSession(id)
        }
        if (
          agent === null
          || agent === undefined
          || String(agent.session?.id) !== id
          || typeof ctx.compaction?.compactNow !== 'function'
        ) throw new Error('The selected Harness session is not compactable.')
        await waitForIdleAgent(agent)
        const controller = new globalThis.AbortController()
        const result = await withAgentInitiator(
          agent,
          () => ctx.compaction.compactNow(agent, controller.signal, commandId),
        )
        publishProjection(agent.session)
        return compactResult(result, commandId)
      }
      if (method === 'session/prompt' || method === 'session/recover-empty-output') {
        const id = sessionId(params)
        const recovering = method === 'session/recover-empty-output'
        if (recovering && (selectedSession === null || emptyOutputRecoveryUsed)) {
          throw new Error('Empty-output recovery requires an existing task and is one-shot.')
        }
        if (Object.keys(params).length !== 2 || !Array.isArray(params.contentBlocks)) {
          throw new Error('Invalid task prompt.')
        }
        if (resumeTask !== null) await resumeTask
        if (shuttingDown) throw new Error('The runtime is shutting down.')
        selectedSession = id
        recoveringEmptyOutput = recovering
        if (recovering) emptyOutputRecoveryUsed = true
        if (restored !== null) {
          if (ctx.agents.get(restored.agent.id) !== restored.agent) throw new Error('The restored agent is closed.')
          publishProjection(restored.agent.session)
          const message = createUserMessage({ content: params.contentBlocks, source: { kind: 'user' } })
          restored.agent.followup(message)
          return { messageId: message.id }
        }
        return server.handleRequest('session/prompt', params)
      }
      throw new Error('Unknown Builder Harness method.')
    },
  }
}
