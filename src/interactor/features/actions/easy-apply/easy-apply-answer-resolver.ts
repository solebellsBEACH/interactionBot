import readline from "readline";
import { Page } from "playwright";

import type {
    AdminPromptBroker,
    AdminPromptRequest,
    AdminPromptResponse
} from "../../../../admin/prompt-broker";
import { getFieldAnswer } from "../../../../api/controllers/field-answers";
import { createPrompt, waitForPromptAnswer } from "../../../../api/controllers/prompt-queue";
import { GptClient } from "../../../shared/ai/gpt-client";
import { FormPromptField } from "../../../shared/interface/forms/form.types";
import type { UserProfile } from "../../../shared/interface/user/user-profile.types";
import { logger } from "../../../shared/services/logger";
import { normalizeKey } from "../../../shared/utils/normalize";

export class EasyApplyAbortError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'EasyApplyAbortError'
    }
}

const SKIP_FIELD = "__interactionbot_skip_field__" as const

type AnswerResolverOptions = {
    adminPromptBroker?: AdminPromptBroker
    page?: Page
    gpt?: GptClient
    profile: UserProfile
    isStandalone: boolean
    promptTimeoutMs: number
}

export class EasyApplyAnswerResolver {
    private readonly _answerCache = new Map<string, string>()
    private readonly _historyCache = new Map<string, string>()
    private _historyAvailable = true
    private readonly _adminPromptBroker?: AdminPromptBroker
    private readonly _profile: UserProfile
    private readonly _page?: Page
    private readonly _gpt?: GptClient
    private readonly _isStandalone: boolean
    private readonly _promptTimeoutMs: number

    constructor(options: AnswerResolverOptions) {
        this._adminPromptBroker = options.adminPromptBroker
        this._profile = options.profile
        this._page = options.page
        this._gpt = options.gpt
        this._isStandalone = options.isStandalone
        this._promptTimeoutMs = options.promptTimeoutMs
    }

    async resolve(field: FormPromptField, step: number) {
        const label = field.label || field.key || 'field'
        const cached = this._getCachedAnswer(field)
        if (cached) {
            logger.info(`[easy-apply] etapa ${step}: usando cache para "${label}"`)
            return cached
        }

        const historyContext = await this._historyContext(field)
        const gptAnswer = this._coerceAnswer(field, await this._askWithGpt(field, step, historyContext))
        if (gptAnswer) {
            const gptDecision = await this._confirmGptAnswer(field, step, gptAnswer)
            if (gptDecision === SKIP_FIELD) {
                logger.info(`[easy-apply] etapa ${step}: campo pulado no admin para "${label}"`)
                return null
            }
            const confirmed = this._coerceAnswer(field, gptDecision)
            if (confirmed) {
                this._storeCachedAnswer(field, confirmed)
                logger.info(`[easy-apply] etapa ${step}: usando GPT confirmado para "${label}"`)
                return confirmed
            }
        }

        const profileAnswer = this._coerceAnswer(field, this._answerFromProfile(field))
        if (profileAnswer) {
            this._storeCachedAnswer(field, profileAnswer)
            logger.info(`[easy-apply] etapa ${step}: usando perfil salvo para "${label}"`)
            return profileAnswer
        }

        const historyAnswer = this._coerceAnswer(field, await this._answerFromHistory(field))
        if (historyAnswer) {
            this._storeCachedAnswer(field, historyAnswer)
            logger.info(`[easy-apply] etapa ${step}: usando histórico salvo para "${label}"`)
            return historyAnswer
        }
        if (this._isStandalone) {
            throw new EasyApplyAbortError(`standalone-missing:${label}`)
        }

        const manualDecision = await this._askForField(field, step, true)
        if (manualDecision === SKIP_FIELD) {
            logger.info(`[easy-apply] etapa ${step}: campo pulado manualmente para "${label}"`)
            return null
        }
        const manualAnswer = this._coerceAnswer(field, manualDecision)
        if (manualAnswer) {
            this._storeCachedAnswer(field, manualAnswer)
            logger.info(`[easy-apply] etapa ${step}: usando resposta manual para "${label}"`)
        }
        return manualAnswer
    }

    private _coerceAnswer(field: FormPromptField, answer: string | null) {
        if (!answer) return null
        if (field.type === 'select') {
            return this._coerceSelectAnswer(field, answer)
        }
        return this._coerceInputAnswer(field, answer)
    }

    private _answerFromProfile(field: FormPromptField) {
        const personalAnswer = this._answerFromProfilePersonal(field)
        if (personalAnswer) return personalAnswer

        const compensationAnswer = this._answerFromProfileCompensation(field)
        if (compensationAnswer) return compensationAnswer

        const stackExperienceAnswer = this._answerFromProfileStackExperience(field)
        if (stackExperienceAnswer) return stackExperienceAnswer

        const answers = this._profile.answers || {}
        const candidates = new Set(this._buildAnswerCandidates(field))

        for (const candidate of candidates) {
            const direct = answers[candidate]
            if (direct) return direct
        }

        const candidateList = Array.from(candidates)
        for (const [key, value] of Object.entries(answers)) {
            const normalizedKey = normalizeKey(key)
            if (candidateList.some((candidate) => candidate.includes(normalizedKey) || normalizedKey.includes(candidate))) {
                return value
            }
        }

        return null
    }

    private _answerFromProfilePersonal(field: FormPromptField) {
        const birthDate = this._profile.birthDate
        if (!birthDate) return null

        const text = this._normalizeFieldText(field)
        const asksBirthDate =
            text.includes("birth") ||
            text.includes("nascimento") ||
            /\bdob\b/.test(text)

        return asksBirthDate ? birthDate : null
    }

    private _answerFromProfileCompensation(field: FormPromptField) {
        const compensation = this._profile.compensation
        if (!compensation) return null

        const text = this._normalizeFieldText(field)
        const asksHourly = text.includes("hour") || text.includes("hora") || text.includes("rate")
        const asksUsd =
            text.includes("usd") ||
            text.includes("dollar") ||
            text.includes("dolar")
        const asksBrl =
            text.includes("brl") ||
            text.includes("real") ||
            text.includes("reais") ||
            text.includes("r$")
        const asksClt = text.includes("clt")
        const asksPj = text.includes("pj") || text.includes("contractor")

        if (asksHourly && asksUsd && compensation.hourlyUsd) {
            return compensation.hourlyUsd
        }
        if (asksHourly && asksBrl && compensation.hourlyBrl) {
            return compensation.hourlyBrl
        }
        if (asksClt && compensation.clt) {
            return compensation.clt
        }
        if (asksPj && compensation.pj) {
            return compensation.pj
        }

        return null
    }

    private _answerFromProfileStackExperience(field: FormPromptField) {
        if (!this._isExperienceYearsField(field)) return null

        const stackExperience = this._profile.stackExperience || {}
        const text = this._normalizeFieldText(field)

        for (const [stack, value] of Object.entries(stackExperience)) {
            const aliases = this._buildStackAliases(stack)
            if (aliases.some((alias) => text.includes(alias))) {
                return value.years || null
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
    private async _historyContext(field: FormPromptField): Promise<Record<string, string>> {
        const context: Record<string, string> = {}
        if (!this._historyAvailable) return context

        for (const candidate of this._buildAnswerCandidates(field)) {
            const cached = this._historyCache.get(candidate)
            if (cached) {
                context[candidate] = cached
                continue
            }
            try {
                const record = await getFieldAnswer(candidate, field.label)
                if (record?.value) {
                    this._historyCache.set(candidate, record.value)
                    context[candidate] = record.value
                }
            } catch {
                this._historyAvailable = false
                break
            }
        }

        return context
    }

    private async _askWithGpt(field: FormPromptField, step: number, historyAnswers?: Record<string, string>) {
        if (!this._gpt) return null
        return this._gpt.answerField(field, this._profile, historyAnswers, { step })
    }

    private async _confirmGptAnswer(field: FormPromptField, step: number, gptAnswer: string): Promise<string | null | typeof SKIP_FIELD> {
        const label = field.label || field.key || 'field'
        const options = field.type === 'select'
            ? (field.options || []).map((option) => option.trim()).filter(Boolean)
            : []

        const adminResult = await this._requestAdminPrompt({
            kind: 'confirm-gpt',
            step,
            fieldLabel: label,
            fieldKey: field.key,
            fieldType: field.type,
            prompt: `Confirme ou ajuste a resposta para "${label}".`,
            suggestedAnswer: gptAnswer,
            options
        })
        if (adminResult) {
            return this._resolveAdminPromptResult(adminResult, gptAnswer)
        }

        if (!this._page || this._page.isClosed()) return gptAnswer

        try {
            const result = await this._page.evaluate(
                ({ fieldLabel, suggested, stepNumber, fieldType, selectOptions, timeoutMs }) => {
                    type PopupResult = {
                        action: 'confirm' | 'manual' | 'timeout'
                        value?: string | null
                    }

                    return new Promise<PopupResult>((resolve) => {
                        const existing = document.getElementById('interactionbot-gpt-confirm-popup')
                        if (existing) existing.remove()

                        const overlay = document.createElement('div')
                        overlay.id = 'interactionbot-gpt-confirm-popup'
                        overlay.setAttribute(
                            'style',
                            [
                                'position:fixed',
                                'inset:0',
                                'z-index:2147483647',
                                'background:rgba(15,15,15,0.55)',
                                'display:flex',
                                'align-items:center',
                                'justify-content:center',
                                'padding:16px'
                            ].join(';')
                        )

                        const card = document.createElement('div')
                        card.setAttribute(
                            'style',
                            [
                                'width:min(640px,95vw)',
                                'max-height:90vh',
                                'overflow:auto',
                                'background:#ffffff',
                                'border-radius:12px',
                                'box-shadow:0 20px 60px rgba(0,0,0,0.35)',
                                'padding:16px',
                                'font-family:Arial,sans-serif',
                                'color:#111827'
                            ].join(';')
                        )

                        const title = document.createElement('div')
                        title.textContent = `Easy Apply step ${stepNumber}`
                        title.setAttribute('style', 'font-size:16px;font-weight:700;margin-bottom:6px')

                        const subtitle = document.createElement('div')
                        subtitle.textContent = `Field: ${fieldLabel}`
                        subtitle.setAttribute('style', 'font-size:13px;color:#374151;margin-bottom:10px')

                        const gptLabel = document.createElement('div')
                        gptLabel.textContent = 'GPT suggestion'
                        gptLabel.setAttribute('style', 'font-size:12px;font-weight:700;margin-bottom:4px')

                        const gptValue = document.createElement('div')
                        gptValue.textContent = suggested
                        gptValue.setAttribute(
                            'style',
                            'border:1px solid #d1d5db;border-radius:8px;padding:8px;background:#f9fafb;font-size:13px;white-space:pre-wrap;word-break:break-word'
                        )

                        const manualLabel = document.createElement('div')
                        manualLabel.textContent = 'Manual answer (used when you click "Use manual answer")'
                        manualLabel.setAttribute('style', 'font-size:12px;font-weight:700;margin:12px 0 4px')

                        let manualControl: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
                        if (fieldType === 'select' && Array.isArray(selectOptions) && selectOptions.length > 0) {
                            const select = document.createElement('select')
                            select.setAttribute(
                                'style',
                                'width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px'
                            )
                            for (const option of selectOptions) {
                                const item = document.createElement('option')
                                item.value = option
                                item.textContent = option
                                if (option === suggested) {
                                    item.selected = true
                                }
                                select.appendChild(item)
                            }
                            manualControl = select
                        } else {
                            const input = document.createElement('textarea')
                            input.value = suggested
                            input.setAttribute(
                                'style',
                                'width:100%;min-height:82px;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;resize:vertical'
                            )
                            manualControl = input
                        }

                        const error = document.createElement('div')
                        error.setAttribute('style', 'min-height:18px;margin-top:8px;color:#b91c1c;font-size:12px')

                        const actions = document.createElement('div')
                        actions.setAttribute('style', 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px')

                        const confirmButton = document.createElement('button')
                        confirmButton.type = 'button'
                        confirmButton.textContent = 'Confirm GPT'
                        confirmButton.setAttribute(
                            'style',
                            'background:#0f766e;color:#fff;border:0;border-radius:8px;padding:8px 10px;font-size:13px;cursor:pointer'
                        )

                        const manualButton = document.createElement('button')
                        manualButton.type = 'button'
                        manualButton.textContent = 'Use manual answer'
                        manualButton.setAttribute(
                            'style',
                            'background:#b45309;color:#fff;border:0;border-radius:8px;padding:8px 10px;font-size:13px;cursor:pointer'
                        )

                        let timeoutHandle = 0
                        const finish = (action: PopupResult['action'], value?: string | null) => {
                            if (timeoutHandle) {
                                window.clearTimeout(timeoutHandle)
                            }
                            overlay.remove()
                            resolve({ action, value })
                        }

                        confirmButton.addEventListener('click', () => {
                            finish('confirm', suggested)
                        })

                        manualButton.addEventListener('click', () => {
                            const manualValue = manualControl.value.trim()
                            if (!manualValue) {
                                error.textContent = 'Type a manual answer before confirming.'
                                return
                            }
                            finish('manual', manualValue)
                        })

                        actions.appendChild(confirmButton)
                        actions.appendChild(manualButton)

                        card.appendChild(title)
                        card.appendChild(subtitle)
                        card.appendChild(gptLabel)
                        card.appendChild(gptValue)
                        card.appendChild(manualLabel)
                        card.appendChild(manualControl)
                        card.appendChild(error)
                        card.appendChild(actions)
                        overlay.appendChild(card)
                        document.body.appendChild(overlay)

                        timeoutHandle = window.setTimeout(() => {
                            finish('timeout', null)
                        }, timeoutMs)
                    })
                },
                {
                    fieldLabel: label,
                    suggested: gptAnswer,
                    stepNumber: step,
                    fieldType: field.type,
                    selectOptions: options,
                    timeoutMs: this._promptTimeoutMs
                }
            )

            if (!result) return null
            if (result.action === 'confirm') return gptAnswer
            if (result.action === 'manual') {
                const value = typeof result.value === 'string' ? result.value.trim() : ''
                return value || null
            }
            return null
        } catch (error) {
            logger.warn('Unable to show GPT confirmation popup', error)
            return gptAnswer
        }
    }
    private async _askForField(field: FormPromptField, step: number, forcePrompt = false): Promise<string | null | typeof SKIP_FIELD> {
        const label = field.label || field.key || 'field'
        const adminResult = await this._requestAdminPrompt({
            kind: 'answer-field',
            step,
            fieldLabel: label,
            fieldKey: field.key,
            fieldType: field.type,
            prompt:
                field.type === 'select'
                    ? `Escolha uma opção para "${label}".`
                    : `Informe um valor para "${label}".`,
            suggestedAnswer: field.type === 'input' ? field.value || '' : undefined,
            options: field.type === 'select' ? (field.options || []) : []
        })
        if (adminResult) {
            return this._resolveAdminPromptResult(adminResult, null)
        }

        if (field.type === 'select') {
            const options = field.options || []
            const optionsText = options.map((option, idx) => `${idx + 1}) ${option}`).join('\n')
            const prompt = `[Easy Apply] Step ${step} - choose for "${label}":\n${optionsText}\nReply with number or text.`
            const webAnswer = await this._promptWeb(prompt, options)
            if (webAnswer) return webAnswer
            if (forcePrompt) return this._promptCli(prompt)
            return null
        }

        const prompt = `[Easy Apply] Step ${step} - fill "${label}":`
        const webAnswer = await this._promptWeb(prompt)
        if (webAnswer) return webAnswer
        if (forcePrompt) return this._promptCli(prompt)
        return null
    }

    private async _requestAdminPrompt(
        request: Omit<AdminPromptRequest, 'id' | 'createdAt'>
    ): Promise<AdminPromptResponse | null> {
        if (!this._adminPromptBroker) return null

        try {
            return await this._adminPromptBroker.requestPrompt(request, this._promptTimeoutMs)
        } catch (error) {
            logger.warn('Unable to request admin prompt', error)
            return null
        }
    }

    private _resolveAdminPromptResult(
        result: AdminPromptResponse,
        confirmedValue: string | null
    ): string | null | typeof SKIP_FIELD {
        if (result.action === 'confirm') {
            return confirmedValue
        }
        if (result.action === 'manual') {
            const value = typeof result.value === 'string' ? result.value.trim() : ''
            return value || null
        }
        if (result.action === 'skip') {
            return SKIP_FIELD
        }
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
            candidates.add(normalizeKey(label))
            const deduped = this._dedupeLabel(label)
            if (deduped && deduped !== label) {
                candidates.add(normalizeKey(deduped))
            }
        }
        return Array.from(candidates).filter(Boolean)
    }

    private _coerceSelectAnswer(field: FormPromptField, answer: string | null) {
        if (!answer || field.type !== 'select') return answer
        const options = (field.options || []).map((option) => option.trim()).filter(Boolean)
        if (options.length === 0) return answer

        const trimmed = answer.trim().replace(/^['"`]+|['"`]+$/g, '')
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

        const normalize = (value: string) =>
            value
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ')
                .trim()

        const normalizedAnswer = normalize(trimmed)
        const normalizedDirect = options.find((option) => normalize(option) === normalizedAnswer)
        if (normalizedDirect) return normalizedDirect

        const contained = options.find((option) =>
            lowered.includes(option.toLowerCase()) || option.toLowerCase().includes(lowered)
        )
        if (contained) return contained

        const normalizedContained = options.find((option) => {
            const normalizedOption = normalize(option)
            return normalizedAnswer.includes(normalizedOption) || normalizedOption.includes(normalizedAnswer)
        })

        return normalizedContained || null
    }

    private _coerceInputAnswer(field: FormPromptField, answer: string | null) {
        if (!answer || field.type !== 'input') return answer

        const trimmed = answer.trim().replace(/^['"`]+|['"`]+$/g, '')
        if (!trimmed) return null
        if (this._isDateField(field)) {
            return this._extractDateValue(trimmed) || trimmed
        }
        if (this._isExperienceYearsField(field)) {
            return this._extractSimpleNumericValue(trimmed) || trimmed
        }
        if (this._isCompensationField(field)) {
            return this._extractCompensationAmount(trimmed) || trimmed
        }
        return trimmed
    }

    private _isExperienceYearsField(field: FormPromptField) {
        const text = this._normalizeFieldText(field)

        const hasExperience =
            text.includes('experience') ||
            text.includes('experiencia')

        const hasYears =
            text.includes('year') ||
            text.includes('years') ||
            text.includes('ano') ||
            text.includes('anos')

        return hasExperience && hasYears
    }

    private _isCompensationField(field: FormPromptField) {
        const text = this._normalizeFieldText(field)
        const compensationKeywords = [
            'salary',
            'salario',
            'compensation',
            'compensacao',
            'remuneration',
            'remuneracao',
            'pretensao salarial',
            'pretensao',
            'wage',
            'pay',
            'rate',
            'hourly rate',
            'annual salary',
            'monthly salary',
            'income',
            'earning',
            'valor'
        ]

        return compensationKeywords.some((keyword) => text.includes(keyword))
    }

    private _isDateField(field: FormPromptField) {
        const text = this._normalizeFieldText(field)
        return (
            text.includes('date') ||
            text.includes('birth') ||
            text.includes('nascimento') ||
            /\bdob\b/.test(text) ||
            text.includes('mm/dd/yyyy')
        )
    }

    private _extractDateValue(answer: string) {
        const isoMatch = answer.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
        if (isoMatch) {
            const [, year, month, day] = isoMatch
            return `${month}/${day}/${year}`
        }

        const slashIsoMatch = answer.match(/\b(\d{4})\/(\d{2})\/(\d{2})\b/)
        if (slashIsoMatch) {
            const [, year, month, day] = slashIsoMatch
            return `${month}/${day}/${year}`
        }

        const usMatch = answer.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
        if (usMatch) {
            const [, month, day, year] = usMatch
            return `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`
        }

        return null
    }

    private _extractSimpleNumericValue(answer: string) {
        const numeric = answer.match(/-?\d+(?:[.,]\d+)?/)
        if (!numeric) return null

        const parsed = Number(numeric[0].replace(',', '.'))
        if (!Number.isFinite(parsed) || parsed < 0) return null
        return this._formatNumericValue(parsed)
    }

    private _extractCompensationAmount(answer: string) {
        const normalizedAnswer = answer
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()

        let multiplier = 1
        if (/\b\d+(?:[.,]\d+)?\s*k\b/i.test(answer) || /\b\d+(?:[.,]\d+)?\s*mil\b/i.test(normalizedAnswer)) {
            multiplier = 1_000
        } else if (
            /\b\d+(?:[.,]\d+)?\s*m\b/i.test(answer) ||
            /\b\d+(?:[.,]\d+)?\s*(mi|milhao|milhoes|million|millions)\b/i.test(normalizedAnswer)
        ) {
            multiplier = 1_000_000
        }

        const token = answer.match(/-?\d[\d.,]*/)
        if (!token) return null

        const parsed = this._parseNumericToken(token[0])
        if (parsed === null || !Number.isFinite(parsed) || parsed < 0) return null
        return this._formatNumericValue(parsed * multiplier)
    }

    private _parseNumericToken(token: string) {
        const cleaned = token.replace(/[^\d.,-]/g, '')
        if (!cleaned || !/\d/.test(cleaned)) return null

        const lastComma = cleaned.lastIndexOf(',')
        const lastDot = cleaned.lastIndexOf('.')

        if (lastComma !== -1 && lastDot !== -1) {
            const decimalIndex = Math.max(lastComma, lastDot)
            const integerPart = cleaned.slice(0, decimalIndex).replace(/[^\d-]/g, '')
            const fractionalPart = cleaned.slice(decimalIndex + 1).replace(/[^\d]/g, '')
            const normalized = fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart
            const parsed = Number(normalized)
            return Number.isFinite(parsed) ? parsed : null
        }

        const separator = lastComma !== -1 ? ',' : lastDot !== -1 ? '.' : ''
        if (!separator) {
            const parsed = Number(cleaned.replace(/[^\d-]/g, ''))
            return Number.isFinite(parsed) ? parsed : null
        }

        const parts = cleaned.split(separator)
        if (parts.length === 2) {
            const integerPart = parts[0].replace(/[^\d-]/g, '')
            const fractionalPart = parts[1].replace(/[^\d]/g, '')
            if (!fractionalPart) {
                const parsed = Number(integerPart)
                return Number.isFinite(parsed) ? parsed : null
            }

            if (fractionalPart.length === 3 && integerPart) {
                const parsed = Number(`${integerPart}${fractionalPart}`)
                return Number.isFinite(parsed) ? parsed : null
            }

            const parsed = Number(`${integerPart}.${fractionalPart}`)
            return Number.isFinite(parsed) ? parsed : null
        }

        const lastPart = parts[parts.length - 1].replace(/[^\d]/g, '')
        const initialPart = parts.slice(0, -1).join('').replace(/[^\d-]/g, '')
        if (!lastPart) {
            const parsed = Number(initialPart)
            return Number.isFinite(parsed) ? parsed : null
        }

        if (lastPart.length <= 2) {
            const parsed = Number(`${initialPart}.${lastPart}`)
            return Number.isFinite(parsed) ? parsed : null
        }

        const parsed = Number(`${initialPart}${lastPart}`)
        return Number.isFinite(parsed) ? parsed : null
    }

    private _formatNumericValue(value: number) {
        if (!Number.isFinite(value)) return null
        return `${Math.round(value)}`
    }

    private _normalizeFieldText(field: FormPromptField) {
        return `${field.label || ''} ${field.key || ''}`
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
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

    private _buildStackAliases(stack: string) {
        const normalized = this._normalizeKey(stack)
        const compact = normalized.replace(/-/g, '')
        const aliases = [normalized, compact]

        if (normalized === 'node-js') {
            aliases.push('node', 'nodejs')
        }
        if (normalized === 'next-js') {
            aliases.push('nextjs')
        }
        if (normalized === 'react-native') {
            aliases.push('reactnative')
        }
        if (normalized === 'web3-js') {
            aliases.push('web3js')
        }
        if (normalized === 'socket-io') {
            aliases.push('socketio')
        }
        if (normalized === 'micro-frontends') {
            aliases.push('microfrontend', 'microfrontends')
        }

        return aliases
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
            const answer = await waitForPromptAnswer(record?._id||''.toString(), this._promptTimeoutMs)
            return answer
        } catch {
            return null
        }
    }
}
