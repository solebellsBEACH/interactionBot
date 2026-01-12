import readline from "readline";
import { Locator, Page } from "playwright";
import { LinkedinCoreFeatures } from "./linkedin-core";

import { saveEasyApplyResponses } from "../../api/controllers/easy-apply-responses";
import { getFieldAnswer } from "../../api/controllers/field-answers";
import { ElementHandle, FormFieldValue, FormPromptField } from "../shared/utils/element-handle";
import { DiscordClient } from "../shared/discord/discord-client";
import { env } from "../shared/env";
import { GptClient } from "../shared/ai/gpt-client";
import { userProfile } from "../shared/user-profile";

export type EasyApplyStepValues = {
    step: number
    inputValues?: FormFieldValue[]
    selectValues?: FormFieldValue[]
}

type ButtonGroups = {
    nextButtons: Locator[]
    submitButtons: Locator[]
    reviewButtons: Locator[]
}

type EasyApplyOutcome = {
    status: 'submitted' | 'stopped' | 'no-form' | 'modal-closed'
    reason?: string
}

class EasyApplyAbortError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'EasyApplyAbortError'
    }
}

const EASY_APPLY_SELECTORS = {
    modal: '.jobs-easy-apply-modal, .artdeco-modal',
    form: '.jobs-easy-apply-content form, .jobs-easy-apply-modal form, form'
}

const EASY_APPLY_TIMEOUTS = {
    formVisible: 10_000,
    formChange: 8_000,
    formPoll: 400
}

const EASY_APPLY_LABELS = {
    easyApplyButton: /candidatura simplificada|easy apply/i,
    submit: /enviar candidatura|submit application/i,
    next: /proximo|próximo|continuar|next|avancar|avançar|seguinte/i,
    review: /revisar candidatura|review application|revisar|review/i
}

const EASY_APPLY_BUTTON_SELECTORS = {
    submit: [
        'button:has-text("Enviar candidatura"), button:has-text("Submit application")',
        'button[aria-label*="Submit application" i], button[aria-label*="Enviar candidatura" i]',
        'button[data-easy-apply-submit-button]',
        'footer button.artdeco-button--primary'
    ],
    next: [
        'button[data-control-name*="continue"], button[data-test-id*="continue"], button[data-easy-apply-next-step]',
        'button:has-text("Próximo"), button:has-text("Proximo"), button:has-text("Continuar"), button:has-text("Next"), button:has-text("Avançar"), button:has-text("Avancar"), button:has-text("Seguinte")',
        '[role="button"][aria-label*="continuar" i], [role="button"][aria-label*="next" i], [role="button"]:has-text("Continuar"), [role="button"]:has-text("Next")',
        'footer button:has-text("Continuar"), footer button:has-text("Próximo"), footer button:has-text("Proximo"), footer button:has-text("Next"), footer button:has-text("Avançar"), footer button:has-text("Avancar")'
    ],
    review: [
        'button:has-text("Revisar candidatura"), button:has-text("Review application"), button:has-text("Revisar"), button:has-text("Review")',
        'button[data-control-name*="review" i], button[data-test-id*="review" i]',
        'footer button:has-text("Revisar"), footer button:has-text("Review")'
    ]
}

export class EasyApplyFlow {
    private readonly _page: Page
    private readonly _elementHandle: ElementHandle
    private readonly _navigator: LinkedinCoreFeatures
    private readonly _discord?: DiscordClient
    private readonly _gpt?: GptClient
    private readonly _profile = userProfile
    private readonly _answerCache = new Map<string, string>()
    private readonly _historyCache = new Map<string, string>()
    private _historyAvailable = true
    private readonly _isStandalone = env.easyApply.isStandalone
    private readonly _maxSteps = 15
    private readonly _maxStagnantSteps = 2

    constructor(page: Page, elementHandle: ElementHandle, navigator: LinkedinCoreFeatures, discord?: DiscordClient) {
        this._page = page
        this._elementHandle = elementHandle
        this._navigator = navigator
        this._discord = discord
        this._gpt = env.gpt.enabled ? new GptClient(env.gpt) : undefined
    }

    async execute(jobURL: string): Promise<EasyApplyStepValues[]> {
        const stepsValues: EasyApplyStepValues[] = []
        const outcome: EasyApplyOutcome = { status: 'stopped', reason: 'unknown' }

        try {
            await this._navigator.goToLinkedinURL(jobURL)
            await this._openEasyApplyModal()
            let lastFingerprint = await this._waitForFormAndFingerprint()
            if (!lastFingerprint) {
                console.warn('Easy Apply: form not found after opening modal')
                outcome.status = 'no-form'
                outcome.reason = 'form-not-found'
                return stepsValues
            }

            let step = 1
            let stagnantCount = 0
            while (step <= this._maxSteps) {
                let values: EasyApplyStepValues | null = null
                try {
                    values = await this._collectStepValues(step)
                } catch (error) {
                    if (error instanceof EasyApplyAbortError) {
                        outcome.status = 'stopped'
                        outcome.reason = error.message || 'standalone-missing'
                        await this._closeModalIfOpen()
                        break
                    }
                    throw error
                }
                if (values) stepsValues.push(values)

                const { nextButtons, reviewButtons, submitButtons } = this._getButtonLocators()
                const submit = await this._firstEnabled(submitButtons)
                const review = await this._firstEnabled(reviewButtons)
                const next = await this._firstEnabled(nextButtons)

                let clicked = false
                if (review) {
                    await this._clickAndWait(review)
                    clicked = true
                } else if (next) {
                    await this._clickAndWait(next)
                    clicked = true
                }

                if (!clicked) {
                    if (submit) {
                        await this._finalizeSubmit(jobURL, stepsValues, submit)
                        outcome.status = 'submitted'
                        outcome.reason = 'submit'
                        break
                    }

                    if (!(await this._isModalOpen())) {
                        outcome.status = 'modal-closed'
                        break
                    }

                    console.warn('Easy Apply: no next/review/submit button found, stopping at step', step)
                    outcome.reason = 'no-action'
                    break
                }

                const nextFingerprint = await this._waitForFormChange(lastFingerprint)
                if (!nextFingerprint || nextFingerprint === lastFingerprint) {
                    const submitAfter = await this._firstEnabled(submitButtons)
                    if (submitAfter) {
                        await this._finalizeSubmit(jobURL, stepsValues, submitAfter)
                        outcome.status = 'submitted'
                        outcome.reason = 'submit-after'
                        break
                    }

                    if (!(await this._isModalOpen())) {
                        outcome.status = 'modal-closed'
                        break
                    }

                    stagnantCount++
                    if (stagnantCount >= this._maxStagnantSteps) {
                        console.warn('Easy Apply: form did not change after click, stopping at step', step)
                        outcome.reason = 'stagnant'
                        break
                    }
                    continue
                }

                lastFingerprint = nextFingerprint
                stagnantCount = 0
                step++
            }

            if (step > this._maxSteps && outcome.status !== 'submitted') {
                outcome.reason = 'max-steps'
            }
        } finally {
            await this._logResult(jobURL, stepsValues, outcome)
        }

        return stepsValues
    }

    private async _openEasyApplyModal() {
        const easyApplyButton = this._page.getByRole('button', { name: EASY_APPLY_LABELS.easyApplyButton })
        if (await easyApplyButton.count() === 0) {
            throw new Error('Easy Apply button not found on job page')
        }
        await easyApplyButton.first().click()
    }

    private async _waitForForm() {
        await this._page.waitForSelector(EASY_APPLY_SELECTORS.form, {
            state: 'visible',
            timeout: EASY_APPLY_TIMEOUTS.formVisible
        })
    }

    private async _waitForFormAndFingerprint() {
        await this._waitForForm()
        return this._getFormFingerprint()
    }

    private async _waitForFormChange(previousFingerprint: string) {
        const timeoutMs = EASY_APPLY_TIMEOUTS.formChange
        const start = Date.now()

        while (Date.now() - start < timeoutMs) {
            const fingerprint = await this._getFormFingerprint()
            if (fingerprint && fingerprint !== previousFingerprint) {
                return fingerprint
            }
            await this._page.waitForTimeout(EASY_APPLY_TIMEOUTS.formPoll)
        }

        return previousFingerprint
    }

    private async _getFormFingerprint(): Promise<string | null> {
        const form = this._page.locator(EASY_APPLY_SELECTORS.form).first()
        if ((await form.count()) === 0) return null

        try {
            const text = await form.innerText()
            return text.replace(/\s+/g, ' ').trim()
        } catch {
            return null
        }
    }

    private async _collectStepValues(step: number) {
        try {
            const formValues = await this._elementHandle.handleForm(
                async (field) => this._resolveFieldAnswer(field, step)
            )
            if (!formValues) return null
            if (formValues.inputValues.length === 0 && formValues.selectValues.length === 0) {
                return null
            }
            const stepValues: EasyApplyStepValues = {
                step,
                ...formValues
            }
            console.log(`Easy Apply step ${step} values`, formValues)
            return stepValues
        } catch (error) {
            if (error instanceof EasyApplyAbortError) {
                throw error
            }
            console.error('Unable to read Easy Apply form', error)
            return null
        }
    }

    private async _resolveFieldAnswer(field: FormPromptField, step: number) {
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

        const historyContext = await this._historyContext(field)
        const gptAnswer = this._coerceSelectAnswer(field, await this._askWithGpt(field, historyContext))
        if (gptAnswer) {
            this._storeCachedAnswer(field, gptAnswer)
            return gptAnswer
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

    private async _askWithGpt(field: FormPromptField, historyAnswers?: Record<string, string>) {
        if (!this._gpt) return null
        return this._gpt.answerField(field, this._profile, historyAnswers)
    }

    private async _askForField(field: FormPromptField, step: number, forcePrompt = false) {
        const label = field.label || field.key || 'field'
        if (field.type === 'select') {
            const options = field.options || []
            const optionsText = options.map((option, idx) => `${idx + 1}) ${option}`).join('\n')
            const prompt = `[Easy Apply] Step ${step} - choose for "${label}":\n${optionsText}\nReply with number or text.`
            if (forcePrompt) return this._promptCli(prompt)
            if (!this._discord) return null
            return this._discord.ask(prompt)
        }

        const prompt = `[Easy Apply] Step ${step} - fill "${label}":`
        if (forcePrompt) return this._promptCli(prompt)
        if (!this._discord) return null
        return this._discord.ask(prompt)
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

    private async _promptCli(prompt: string, timeoutMs = env.discord.requestTimeoutMs): Promise<string | null> {
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
            setTimeout(() => resolve(null), timeoutMs)
        })

        const result = await Promise.race([question(), timeout])
        rl.close()
        if (!result) return null
        const trimmed = result.trim()
        return trimmed ? trimmed : null
    }

    private _getButtonLocators(): ButtonGroups {
        return {
            submitButtons: [
                this._page.getByRole('button', { name: EASY_APPLY_LABELS.submit }),
                ...EASY_APPLY_BUTTON_SELECTORS.submit.map((selector) => this._page.locator(selector))
            ],
            nextButtons: [
                this._page.getByRole('button', { name: EASY_APPLY_LABELS.next }),
                ...EASY_APPLY_BUTTON_SELECTORS.next.map((selector) => this._page.locator(selector))
            ],
            reviewButtons: [
                this._page.getByRole('button', { name: EASY_APPLY_LABELS.review }),
                ...EASY_APPLY_BUTTON_SELECTORS.review.map((selector) => this._page.locator(selector))
            ]
        }
    }

    private async _finalizeSubmit(jobURL: string, stepsValues: EasyApplyStepValues[], submitButton: Locator) {
        await this._persistSteps(jobURL, stepsValues)
        await submitButton.click({ force: true })
    }

    private async _isModalOpen() {
        return (await this._page.locator(EASY_APPLY_SELECTORS.modal).count()) > 0
    }

    private async _closeModalIfOpen() {
        if (!(await this._isModalOpen())) return
        const closeButton = this._page.locator(
            'button[aria-label*="Fechar" i], button[aria-label*="Close" i], button[data-test-modal-close-btn], button.artdeco-modal__dismiss'
        )
        if (await closeButton.count()) {
            await closeButton.first().click().catch(() => undefined)
        }
    }

    private async _logResult(jobURL: string, stepsValues: EasyApplyStepValues[], outcome: EasyApplyOutcome) {
        if (!this._discord) return
        const inputCount = stepsValues.reduce((sum, step) => sum + (step.inputValues?.length || 0), 0)
        const selectCount = stepsValues.reduce((sum, step) => sum + (step.selectValues?.length || 0), 0)
        const totalFields = inputCount + selectCount
        const reason = outcome.reason ? ` | ${outcome.reason}` : ''
        const message = `Easy Apply result: ${outcome.status}${reason} | steps: ${stepsValues.length} | fields: ${totalFields} | ${jobURL}`
        await this._discord.log(message)
    }

    private async _firstEnabled(locators: Locator[]) {
        for (const locator of locators) {
            const count = await locator.count()
            for (let i = 0; i < count; i++) {
                const candidate = locator.nth(i)
                if (!(await candidate.isVisible())) continue
                if (await candidate.isDisabled()) continue
                if (await this._isForbiddenAction(candidate)) continue
                return candidate
            }
        }
        return null
    }

    private async _clickAndWait(button: Locator) {
        await button.scrollIntoViewIfNeeded()
        await button.click({ force: true })
        await this._page.waitForTimeout(700)
    }

    private async _persistSteps(jobURL: string, stepsValues: EasyApplyStepValues[]) {
        try {
            await saveEasyApplyResponses(jobURL, stepsValues)
        } catch (error) {
            console.error("Erro ao salvar respostas Easy Apply", error)
        }
    }

    private async _isForbiddenAction(button: Locator) {
        const text = await button.innerText().catch(() => '')
        const ariaLabel = await button.getAttribute('aria-label').catch(() => '')
        const dataControl = await button.getAttribute('data-control-name').catch(() => '')
        const combined = `${text} ${ariaLabel} ${dataControl}`.toLowerCase()
        return /(remover|remove|excluir|delete|descartar|cancelar|fechar|close|dismiss)/i.test(combined)
    }
}
