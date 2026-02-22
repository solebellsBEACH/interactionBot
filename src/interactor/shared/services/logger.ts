export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogPayload = {
  message: string
  data?: unknown
}

const COLORS = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m'
} as const

const RESET = '\x1b[0m'

const colorize = (level: LogLevel, text: string) => `${COLORS[level]}${text}${RESET}`

const formatLevel = (level: LogLevel) => colorize(level, `[${level.toUpperCase()}]`)

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
    const prefix = this._scope ? `[${this._scope}] ` : ''
    const message = `${formatLevel(level)} ${prefix}${payload.message}`

    if (payload.data === undefined) {
      this._output(level, message)
      return
    }

    this._output(level, message, payload.data)
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
