import { Locator, Page } from "playwright";
import { LinkedinCoreFeatures } from "../../linkedin-core";

import { saveEasyApplyResponses } from "../../../../api/controllers/easy-apply-responses";
import { ElementHandle, FormFieldValue } from "../../../shared/utils/element-handle";
import { DiscordClient } from "../../../shared/discord/discord-client";
import { env } from "../../../shared/env";
import { userProfile } from "../../../shared/user-profile";
import { EasyApplyAnswerResolver, EasyApplyAbortError } from "./easy-apply-answer-resolver";
import {
    EASY_APPLY_BUTTON_SELECTORS,
    EASY_APPLY_FORBIDDEN_REGEX,
    EASY_APPLY_LABELS,
    EASY_APPLY_SELECTORS,
    EASY_APPLY_TIMEOUTS
} from "./easy-apply.constants";

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

export class EasyApplyFlow {
    private readonly _page: Page
    private readonly _elementHandle: ElementHandle
    private readonly _navigator: LinkedinCoreFeatures
    private readonly _discord?: DiscordClient
    private readonly _answerResolver: EasyApplyAnswerResolver
    private readonly _maxSteps = 15
    private readonly _maxStagnantSteps = 2

    constructor(page: Page, elementHandle: ElementHandle, navigator: LinkedinCoreFeatures, discord?: DiscordClient) {
        this._page = page
        this._elementHandle = elementHandle
        this._navigator = navigator
        this._discord = discord
        this._answerResolver = new EasyApplyAnswerResolver({
            discord,
            profile: userProfile,
            isStandalone: env.easyApply.isStandalone,
            promptTimeoutMs: env.discord.requestTimeoutMs
        })
    }

    async execute(jobURL: string): Promise<EasyApplyStepValues[]> {
        const stepsValues: EasyApplyStepValues[] = []
        const outcome: EasyApplyOutcome = { status: 'stopped', reason: 'unknown' }
        const trace: string[] = []
        const pushTrace = (entry: string) => {
            if (trace.length >= 24) return
            trace.push(entry)
        }

        try {
            pushTrace('start')
            await this._navigator.goToLinkedinURL(jobURL)
            pushTrace('open-modal')
            await this._openEasyApplyModal()
            pushTrace('modal-opened')
            let lastFingerprint = await this._waitForFormAndFingerprint()
            if (!lastFingerprint) {
                console.warn('Easy Apply: form not found after opening modal')
                outcome.status = 'no-form'
                outcome.reason = 'form-not-found'
                pushTrace('no-form')
                return stepsValues
            }
            pushTrace('form-visible')

            let step = 1
            let stagnantCount = 0
            while (step <= this._maxSteps) {
                let values: EasyApplyStepValues | null = null
                try {
                    values = await this._collectStepValues(step)
                } catch (error) {
                    if (error instanceof EasyApplyAbortError) {
                        outcome.status = 'stopped'
                        outcome.reason = (error as any)?.message || 'standalone-missing'
                        await this._closeModalIfOpen()
                        break
                    }
                    throw error
                }
                if (values) stepsValues.push(values)

                const inputCount = values?.inputValues?.length ?? 0
                const selectCount = values?.selectValues?.length ?? 0
                const stepSummary = values ? `step${step}:${inputCount}/${selectCount}` : `step${step}:no-values`

                const { nextButtons, reviewButtons, submitButtons } = this._getButtonLocators()
                const submit = await this._firstEnabled(submitButtons)
                const review = await this._firstEnabled(reviewButtons)
                const next = await this._firstEnabled(nextButtons)

                let clicked = false
                let action = 'none'
                if (review) {
                    action = 'review'
                    await this._clickAndWait(review)
                    clicked = true
                } else if (next) {
                    action = 'next'
                    await this._clickAndWait(next)
                    clicked = true
                }
                if (!clicked && submit) {
                    action = 'submit'
                }
                pushTrace(`${stepSummary}:${action}`)

                if (!clicked) {
                    if (submit) {
                        await this._finalizeSubmit(jobURL, stepsValues, submit)
                        outcome.status = 'submitted'
                        outcome.reason = 'submit'
                        pushTrace('submitted')
                        break
                    }

                    if (!(await this._isModalOpen())) {
                        outcome.status = 'modal-closed'
                        pushTrace('modal-closed')
                        break
                    }

                    console.warn('Easy Apply: no next/review/submit button found, stopping at step', step)
                    outcome.reason = 'no-action'
                    pushTrace('no-action')
                    break
                }

                const nextFingerprint = await this._waitForFormChange(lastFingerprint)
                if (!nextFingerprint || nextFingerprint === lastFingerprint) {
                    pushTrace('form-unchanged')
                    const submitAfter = await this._firstEnabled(submitButtons)
                    if (submitAfter) {
                        await this._finalizeSubmit(jobURL, stepsValues, submitAfter)
                        outcome.status = 'submitted'
                        outcome.reason = 'submit-after'
                        pushTrace('submitted')
                        break
                    }

                    if (!(await this._isModalOpen())) {
                        outcome.status = 'modal-closed'
                        pushTrace('modal-closed')
                        break
                    }

                    stagnantCount++
                    if (stagnantCount >= this._maxStagnantSteps) {
                        console.warn('Easy Apply: form did not change after click, stopping at step', step)
                        outcome.reason = 'stagnant'
                        pushTrace('stagnant')
                        break
                    }
                    continue
                }

                lastFingerprint = nextFingerprint
                pushTrace('form-changed')
                stagnantCount = 0
                step++
            }

            if (step > this._maxSteps && outcome.status !== 'submitted') {
                outcome.reason = 'max-steps'
                pushTrace('max-steps')
            }
        } catch (error) {
            outcome.status = 'stopped'
            outcome.reason = this._formatErrorReason(error)
            pushTrace('error')
            throw error
        } finally {
            await this._logResult(jobURL, stepsValues, outcome, trace)
        }

        return stepsValues
    }

    private async _openEasyApplyModal() {
        const candidates = this._getOpenButtonLocators()
        const deadline = Date.now() + EASY_APPLY_TIMEOUTS.openButton
        let easyApplyButton = await this._firstEnabled(candidates)

        while (!easyApplyButton && Date.now() < deadline) {
            await this._page.waitForTimeout(EASY_APPLY_TIMEOUTS.openPoll)
            easyApplyButton = await this._firstEnabled(candidates)
        }

        if (!easyApplyButton) {
            await this._logOpenButtonDiagnostics()
            throw new Error('easy-apply-button-not-found')
        }
        await this._clickAndWait(easyApplyButton)
    }

    private async _waitForForm() {
        await this._page.waitForSelector(EASY_APPLY_SELECTORS.form, {
            state: 'visible',
            timeout: EASY_APPLY_TIMEOUTS.formVisible
        })
    }

    private async _waitForFormAndFingerprint() {
        try {
            await this._waitForForm()
        } catch {
            return null
        }
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
                async (field) => this._answerResolver.resolve(field, step)
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

    private _getOpenButtonLocators() {
        return [
            this._page.getByRole('button', { name: EASY_APPLY_LABELS.easyApplyButton }),
            this._page.getByRole('link', { name: EASY_APPLY_LABELS.easyApplyButton }),
            ...EASY_APPLY_BUTTON_SELECTORS.open.map((selector) => this._page.locator(selector))
        ]
    }

    private async _logOpenButtonDiagnostics() {
        let candidates: Array<{ text: string; aria: string; data: string; testId: string }> = []
        try {
            candidates = await this._page.evaluate(() => {
                const matcher = /(easy apply|candid|inscrever|solicitar|apply)/i
                const elements = Array.from(document.querySelectorAll('button, [role="button"], a'))
                const results: Array<{ text: string; aria: string; data: string; testId: string }> = []

                for (const el of elements) {
                    const text = (el.textContent || '').trim()
                    const aria = el.getAttribute('aria-label') || ''
                    const data = el.getAttribute('data-control-name') || ''
                    const testId = el.getAttribute('data-test-id') || ''
                    const combined = `${text} ${aria} ${data} ${testId}`.trim()
                    if (!combined || !matcher.test(combined)) continue
                    results.push({ text, aria, data, testId })
                    if (results.length >= 8) break
                }

                return results
            })
        } catch {
            return
        }

        if (candidates.length === 0) return

        const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 120)
        const lines = candidates.map((candidate, index) => {
            const text = normalize(candidate.text)
            const aria = normalize(candidate.aria)
            const data = normalize(candidate.data)
            const testId = normalize(candidate.testId)
            return `${index + 1}. text="${text}" aria="${aria}" data="${data}" testId="${testId}"`
        })

        const message = `Easy Apply debug: apply-like buttons found:\n${lines.join('\n')}`
        console.warn(message)
        if (this._discord) {
            await this._discord.log(message)
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

    private async _logResult(
        jobURL: string,
        stepsValues: EasyApplyStepValues[],
        outcome: EasyApplyOutcome,
        trace?: string[]
    ) {
        if (!this._discord) return
        const inputCount = stepsValues.reduce((sum, step) => sum + (step.inputValues?.length || 0), 0)
        const selectCount = stepsValues.reduce((sum, step) => sum + (step.selectValues?.length || 0), 0)
        const totalFields = inputCount + selectCount
        const reason = outcome.reason ? ` | ${outcome.reason}` : ''
        const traceInfo = trace && trace.length > 0 ? ` | trace: ${trace.join(' > ')}` : ''
        const message = `Easy Apply result: ${outcome.status}${reason} | steps: ${stepsValues.length} | fields: ${totalFields} | ${jobURL}${traceInfo}`
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
        return EASY_APPLY_FORBIDDEN_REGEX.test(combined)
    }

    private _formatErrorReason(error: unknown) {
        if (error instanceof Error) {
            const message = error.message || error.name || 'error'
            return message.replace(/\s+/g, ' ').trim().slice(0, 120)
        }
        if (typeof error === 'string') {
            return error.replace(/\s+/g, ' ').trim().slice(0, 120)
        }
        return 'error'
    }
}
