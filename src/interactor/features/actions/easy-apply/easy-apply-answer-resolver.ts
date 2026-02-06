import readline from "readline";

import { getFieldAnswer } from "../../../../api/controllers/field-answers";
import { createPrompt, waitForPromptAnswer } from "../../../../api/controllers/prompt-queue";
import { DiscordClient } from "../../../shared/discord/discord-client";
import { GptClient } from "../../../shared/ai/gpt-client";
import { FormPromptField } from "../../../shared/utils/element-handle";
import { UserProfile } from "../../../shared/user-profile";

export class EasyApplyAbortError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'EasyApplyAbortError'
    }
}

type AnswerResolverOptions = {
    discord?: DiscordClient
    gpt?: GptClient
    profile: UserProfile
    isStandalone: boolean
    promptTimeoutMs: number
}

export class EasyApplyAnswerResolver {
    private readonly _answerCache = new Map<string, string>()
    private readonly _historyCache = new Map<string, string>()
    private _historyAvailable = true
    private readonly _profile: UserProfile
    private readonly _discord?: DiscordClient
    private readonly _isStandalone: boolean
    private readonly _promptTimeoutMs: number

    constructor(options: AnswerResolverOptions) {
        this._profile = options.profile
        this._discord = options.discord
        this._isStandalone = options.isStandalone
        this._promptTimeoutMs = options.promptTimeoutMs
    }

    async resolve(field: FormPromptField, step: number) {
        const cached = this._getCachedAnswer(field)
        if (cached) return cached

        const profileAnswer = this._coerceSelectAnswer(field, this._answerFromProfile(field))
        if (profileAnswer) {
            this._storeCachedAnswer(field, profileAnswer)
            return profileAnswer
        }

        const historyAnswer = this._coerceSelectAnswer(field, await this._answerFromHistory(field))
        if (historyAnswer) {
            this._storeCachedAnswer(field, historyAnswer)
            return historyAnswer
        }
        if (this._isStandalone) {
            const label = field.label || field.key || 'field'
            throw new EasyApplyAbortError(`standalone-missing:${label}`)
        }

        const manualAnswer = this._coerceSelectAnswer(field, await this._askForField(field, step, true))
        if (manualAnswer) {
            this._storeCachedAnswer(field, manualAnswer)
        }
        return manualAnswer
    }

    private _answerFromProfile(field: FormPromptField) {
        const answers = this._profile.answers || {}
        const candidates = new Set(this._buildAnswerCandidates(field))

        for (const candidate of candidates) {
            const direct = answers[candidate]
            if (direct) return direct
        }

        const candidateList = Array.from(candidates)
        for (const [key, value] of Object.entries(answers)) {
            const normalizedKey = this._normalizeKey(key)
            if (candidateList.some((candidate) => candidate.includes(normalizedKey) || normalizedKey.includes(candidate))) {
                return value
            }
        }

        return null
    }

    private async _answerFromHistory(field: FormPromptField) {
        if (!this._historyAvailable) return null
        for (const candidate of this._buildAnswerCandidates(field)) {
            const cached = this._historyCache.get(candidate)
            if (cached) return cached

            try {
                const record = await getFieldAnswer(candidate, field.label)
                if (record?.value) {
                    this._historyCache.set(candidate, record.value)
                    return record.value
                }
            } catch {
                this._historyAvailable = false
                return null
            }
        }

        return null
    }
    private async _askForField(field: FormPromptField, step: number, forcePrompt = false) {
        const label = field.label || field.key || 'field'
        if (field.type === 'select') {
            const options = field.options || []
            const optionsText = options.map((option, idx) => `${idx + 1}) ${option}`).join('\n')
            const prompt = `[Easy Apply] Step ${step} - choose for "${label}":\n${optionsText}\nReply with number or text.`
            const webAnswer = await this._promptWeb(prompt, options)
            if (webAnswer) return webAnswer
            if (this._discord) {
                return this._discord.ask(prompt)
            }
            if (forcePrompt) return this._promptCli(prompt)
            return null
        }

        const prompt = `[Easy Apply] Step ${step} - fill "${label}":`
        const webAnswer = await this._promptWeb(prompt)
        if (webAnswer) return webAnswer
        if (this._discord) {
            return this._discord.ask(prompt)
        }
        if (forcePrompt) return this._promptCli(prompt)
        return null
    }

    private _buildAnswerCacheKey(field: FormPromptField, key: string, includeOptions = false) {
        const options = includeOptions && field.type === 'select' ? (field.options || []).join('|') : ''
        return `${field.type}:${key || 'field'}:${options}`
    }

    private _buildAnswerCandidates(field: FormPromptField) {
        const candidates = new Set<string>()
        if (field.key) candidates.add(field.key)
        const label = field.label || ''
        if (label) {
            candidates.add(this._normalizeKey(label))
            const deduped = this._dedupeLabel(label)
            if (deduped && deduped !== label) {
                candidates.add(this._normalizeKey(deduped))
            }
        }
        return Array.from(candidates).filter(Boolean)
    }

    private _coerceSelectAnswer(field: FormPromptField, answer: string | null) {
        if (!answer || field.type !== 'select') return answer
        const options = (field.options || []).map((option) => option.trim()).filter(Boolean)
        if (options.length === 0) return answer

        const trimmed = answer.trim()
        const numericMatch = trimmed.match(/^(\d+)/)
        if (numericMatch) {
            const asNumber = Number(numericMatch[1])
            if (!Number.isNaN(asNumber) && asNumber >= 1 && asNumber <= options.length) {
                return options[asNumber - 1]
            }
        }

        const lowered = trimmed.toLowerCase()
        const direct = options.find((option) => option.toLowerCase() === lowered)
        if (direct) return direct

        const contained = options.find((option) =>
            lowered.includes(option.toLowerCase()) || option.toLowerCase().includes(lowered)
        )
        return contained || null
    }

    private _getCachedAnswer(field: FormPromptField) {
        const candidates = this._buildAnswerCandidates(field)
        if (candidates.length === 0) return null

        const primaryKey = this._buildAnswerCacheKey(field, candidates[0], true)
        const primary = this._answerCache.get(primaryKey)
        if (primary) return primary

        for (const candidate of candidates) {
            const key = this._buildAnswerCacheKey(field, candidate, false)
            const cached = this._answerCache.get(key)
            if (cached) return cached
        }

        return null
    }

    private _storeCachedAnswer(field: FormPromptField, value: string) {
        const candidates = this._buildAnswerCandidates(field)
        if (candidates.length === 0) return
        for (const candidate of candidates) {
            this._answerCache.set(this._buildAnswerCacheKey(field, candidate, false), value)
        }
        this._answerCache.set(this._buildAnswerCacheKey(field, candidates[0], true), value)
    }

    private _dedupeLabel(label: string) {
        const trimmed = label.trim()
        const compact = trimmed.replace(/\s+/g, '').toLowerCase()
        if (compact.length % 2 !== 0) return trimmed
        const half = compact.length / 2
        if (compact.slice(0, half) !== compact.slice(half)) return trimmed

        let seen = 0
        let cutIndex = trimmed.length
        for (let i = 0; i < trimmed.length; i++) {
            if (trimmed[i].trim()) {
                seen++
            }
            if (seen >= half) {
                cutIndex = i + 1
                break
            }
        }

        return trimmed.slice(0, cutIndex).trim()
    }

    private _normalizeKey(value?: string | null) {
        if (!value) return ''
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
    }

    private async _promptCli(prompt: string): Promise<string | null> {
        if (!process.stdin.isTTY) return null

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        })

        const question = () =>
            new Promise<string>((resolve) => {
                rl.question(`${prompt}\n> `, (answer) => resolve(answer))
            })

        const timeout = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), this._promptTimeoutMs)
        })

        const result = await Promise.race([question(), timeout])
        rl.close()
        if (!result) return null
        const trimmed = result.trim()
        return trimmed ? trimmed : null
    }

    private async _promptWeb(prompt: string, options?: string[]) {
        const jobId = (process.env.BOT_JOB_ID || '').trim()
        if (!jobId) return null
        try {
            const record = await createPrompt(jobId, prompt, options)
            const answer = await waitForPromptAnswer(record._id.toString(), this._promptTimeoutMs)
            return answer
        } catch {
            return null
        }
    }
}
