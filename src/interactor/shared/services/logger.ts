export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogPayload = {
  message: string
  data?: unknown
}

export type LogEntry = {
  id: string
  createdAt: string
  level: LogLevel
  scope?: string
  message: string
  data?: unknown
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

const colorize = (level: LogLevel, text: string) => `${COLORS[level]}${text}${RESET}`

const formatLevel = (level: LogLevel) => colorize(level, `[${level.toUpperCase()}]`)

export const subscribeLogs = (listener: LogListener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export class Logger {
  private readonly _scope?: string

  constructor(scope?: string) {
    this._scope = scope
  }

  child(scope: string) {
    return new Logger(scope)
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
    const entry: LogEntry = {
      id: `${Date.now().toString(36)}-${(logSequence++).toString(36)}`,
      createdAt: new Date().toISOString(),
      level,
      scope: this._scope,
      message: payload.message,
      ...(payload.data === undefined ? {} : { data: payload.data })
    }

    for (const listener of listeners) {
      try {
        listener(entry)
      } catch {
        // Log listeners must not interfere with runtime logging.
      }
    }

    const prefix = entry.scope ? `[${entry.scope}] ` : ''
    const message = `${formatLevel(level)} ${prefix}${entry.message}`

    if (entry.data === undefined) {
      this._output(level, message)
      return
    }

    this._output(level, message, entry.data)
  }

  private _output(level: LogLevel, message: string, data?: unknown) {
    switch (level) {
      case 'warn':
        data === undefined ? console.warn(message) : console.warn(message, data)
        return
      case 'error':
        data === undefined ? console.error(message) : console.error(message, data)
        return
      case 'debug':
        data === undefined ? console.debug(message) : console.debug(message, data)
        return
      default:
        data === undefined ? console.log(message) : console.log(message, data)
    }
  }
}

export const logger = new Logger()
