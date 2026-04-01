import type { FormPromptField } from "../interface/forms/form.types"
import { logger } from "../services/logger"

export type LlamaConfig = {
    enabled?: boolean
    baseUrl?: string
    timeoutMs?: number
}

export class LlamaClient {
    private readonly _enabled: boolean
    private readonly _baseUrl: string
    private readonly _timeoutMs: number
    private _disabledLogged = false

    constructor(config: LlamaConfig = {}) {
        this._enabled = config.enabled ?? true
        this._baseUrl = (config.baseUrl || 'http://localhost:3000').replace(/\/+$/, '')
        this._timeoutMs = config.timeoutMs ?? 30_000
    }

    async answerField(field: FormPromptField, context?: { step?: number }): Promise<string | null> {
        if (!this._enabled) {
            if (!this._disabledLogged) {
                this._disabledLogged = true
                logger.warn('Llama está desabilitado. Defina LLAMA_ENABLED=true.')
            }
            return null
        }

        const question = this._buildQuestion(field)
        if (!question) return null

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this._timeoutMs)
        try {
            const body = JSON.stringify({ message: question,  "sessionId": `minha-sessao-${Math.floor(Math.random() * 100000)}`})
            const response = await fetch(`${this._baseUrl}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: controller.signal
            })

       logger.info(`Llama request`, { step: context?.step, body })

            if (!response.ok) {
                const body = await response.text().catch(() => '')
                logger.warn(`Llama request failed: HTTP ${response.status}`, { step: context?.step, body: body.slice(0, 200) })
                return null
            }

            const data = await response.json() as { response?: string }
            const answer = typeof data.response === 'string' ? data.response.trim() : null
            return answer || null
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            logger.warn('Llama request failed', { message: msg, step: context?.step })
            return null
        } finally {
            clearTimeout(timeout)
        }
    }

    private _buildQuestion(field: FormPromptField): string | null {
        const label = field.label || field.key || ''
        if (!label) return null

        if (field.type === 'select') {
            const options = (field.options || []).map((o) => o.trim()).filter(Boolean)
            if (options.length === 0) return null
            return `For job application field "${label}", choose the best option for Lucas. Options: ${options.join(' | ')}. Reply with exactly one option from the list.`
        }

        return `For job application field "${label}", what is the correct value for Lucas? Reply with just the value, no explanation.`
    }
}
