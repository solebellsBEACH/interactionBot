export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogPayload = {
  message: string
  data?: unknown
  context?: Record<string, unknown>
}

export type LogEntry = {
  id: string
  createdAt: string
  level: LogLevel
  scope?: string
  message: string
  data?: unknown
  context?: Record<string, unknown>
}

export type LogListener = (entry: LogEntry) => void

const COLORS = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m'
} as const

const RESET = '\x1b[0m'
const listeners = new Set<LogListener>()
let logSequence = 0
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

const LOG_FORMAT = ((process.env.LOG_FORMAT || '').trim().toLowerCase() === 'json' ? 'json' : 'pretty') as
  | 'json'
  | 'pretty'

const LOG_LEVEL = (((process.env.LOG_LEVEL || 'info').trim().toLowerCase() in LEVEL_WEIGHT
  ? (process.env.LOG_LEVEL || 'info').trim().toLowerCase()
  : 'info') as LogLevel)

const colorize = (level: LogLevel, text: string) => `${COLORS[level]}${text}${RESET}`

const formatLevel = (level: LogLevel) => colorize(level, `[${level.toUpperCase()}]`)

const normalizeValue = (value: unknown): unknown => {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeValue(item)])
    )
  }

  return value
}

const compactContext = (...parts: Array<Record<string, unknown> | undefined>) => {
  const merged = Object.assign({}, ...parts.filter(Boolean))
  const entries = Object.entries(merged).filter(([, value]) => value !== undefined && value !== null && value !== '')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

const getRuntimeContext = () =>
  compactContext({
    runId: (process.env.BOT_RUN_ID || '').trim() || undefined,
    tenantId: (process.env.BOT_TENANT_ID || '').trim() || undefined,
    workspaceId: (process.env.BOT_WORKSPACE_ID || '').trim() || undefined,
    linkedinAccountId: (process.env.BOT_LINKEDIN_ACCOUNT_ID || '').trim() || undefined,
    userId: (process.env.BOT_USER_ID || '').trim() || undefined
  })

export const subscribeLogs = (listener: LogListener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export class Logger {
  private readonly _scope?: string
  private readonly _context?: Record<string, unknown>

  constructor(scope?: string, context?: Record<string, unknown>) {
    this._scope = scope
    this._context = context
  }

  child(scope: string, context?: Record<string, unknown>) {
    const nextScope = this._scope ? `${this._scope}:${scope}` : scope
    return new Logger(nextScope, compactContext(this._context, context))
  }

  debug(message: string, data?: unknown) {
    this._emit('debug', { message, data })
  }

  info(message: string, data?: unknown) {
    this._emit('info', { message, data })
  }

  warn(message: string, data?: unknown) {
    this._emit('warn', { message, data })
  }

  error(message: string, data?: unknown) {
    this._emit('error', { message, data })
  }

  private _emit(level: LogLevel, payload: LogPayload) {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[LOG_LEVEL]) {
      return
    }

    const context = compactContext(getRuntimeContext(), this._context, payload.context)
    const entry: LogEntry = {
      id: `${Date.now().toString(36)}-${(logSequence++).toString(36)}`,
      createdAt: new Date().toISOString(),
      level,
      scope: this._scope,
      message: payload.message,
      ...(payload.data === undefined ? {} : { data: normalizeValue(payload.data) }),
      ...(context ? { context } : {})
    }

    for (const listener of listeners) {
      try {
        listener(entry)
      } catch {
        // Log listeners must not interfere with runtime logging.
      }
    }

    this._output(level, entry)
  }

  private _output(level: LogLevel, entry: LogEntry) {
    if (LOG_FORMAT === 'json') {
      const line = JSON.stringify({
        timestamp: entry.createdAt,
        service: 'interaction-bot',
        level: entry.level,
        ...(entry.scope ? { scope: entry.scope } : {}),
        message: entry.message,
        ...(entry.context ? { context: entry.context } : {}),
        ...(entry.data === undefined ? {} : { data: entry.data })
      })

      switch (level) {
        case 'warn':
          console.warn(line)
          return
        case 'error':
          console.error(line)
          return
        case 'debug':
          console.debug(line)
          return
        default:
          console.log(line)
      }
    }

    const prefix = entry.scope ? `[${entry.scope}] ` : ''
    const context = entry.context ? ` ${JSON.stringify(entry.context)}` : ''
    const message = `${formatLevel(level)} ${prefix}${entry.message}${context}`

    switch (level) {
      case 'warn':
        entry.data === undefined ? console.warn(message) : console.warn(message, entry.data)
        return
      case 'error':
        entry.data === undefined ? console.error(message) : console.error(message, entry.data)
        return
      case 'debug':
        entry.data === undefined ? console.debug(message) : console.debug(message, entry.data)
        return
      default:
        entry.data === undefined ? console.log(message) : console.log(message, entry.data)
    }
  }
}

export const logger = new Logger()
