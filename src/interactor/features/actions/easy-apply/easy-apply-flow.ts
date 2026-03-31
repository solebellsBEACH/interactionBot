import { Locator, Page } from "playwright";
import { LinkedinCoreFeatures } from "../../linkedin-core";

import type { AdminPromptBroker } from "../../../../admin/prompt-broker";
import { adminRuntimeStore } from "../../../../admin/admin-runtime-store";
import { saveEasyApplyResponses } from "../../../../api/controllers/easy-apply-responses";
import { GptClient } from "../../../shared/ai/gpt-client";
import type { DiscordClient } from "../../../shared/discord/discord-client";
import { ElementHandle } from "../../../shared/utils/element-handle";
import { env } from "../../../shared/env";
import { userProfile } from "../../../shared/user-profile";
import { EasyApplyAnswerResolver, EasyApplyAbortError } from "./easy-apply-answer-resolver";
import type { EasyApplyStepValues } from "../../../shared/interface/easy-apply/step-values.types";
import { logger } from "../../../shared/services/logger";
import { normalizeWhitespace } from "../../../shared/utils/normalize";
import {
    EASY_APPLY_BUTTON_SELECTORS,
    EASY_APPLY_FORBIDDEN_REGEX,
    EASY_APPLY_LABELS,
    EASY_APPLY_SELECTORS,
    EASY_APPLY_TIMEOUTS
} from "../../../shared/constants/easy-apply";

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
    private readonly _answerResolver: EasyApplyAnswerResolver
    private readonly _discord?: DiscordClient
    private readonly _maxSteps = 15
    private readonly _maxStagnantSteps = 2
    private _lastOpenButtonInfo = ''

    constructor(
        page: Page,
        elementHandle: ElementHandle,
        navigator: LinkedinCoreFeatures,
        discord?: DiscordClient,
        adminPromptBroker?: AdminPromptBroker
    ) {
        this._page = page
        this._elementHandle = elementHandle
        this._navigator = navigator
        this._discord = discord
        this._answerResolver = new EasyApplyAnswerResolver({
            adminPromptBroker,
            page,
            gpt: new GptClient(env.gpt),
            profile: userProfile,
            isStandalone: env.easyApply.isStandalone,
            promptTimeoutMs: env.easyApply.promptTimeoutMs
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
            this._recordRuntimeStep('easy-apply:lifecycle', 'Easy Apply iniciado', normalizeWhitespace(jobURL), 'running')
            pushTrace('start')
            this._recordRuntimeStep('easy-apply:modal', 'Abrindo modal Easy Apply', undefined, 'running')
            await this._navigator.goToLinkedinURL(jobURL)
            pushTrace('open-modal')
            await this._openEasyApplyModal()
            pushTrace('modal-opened')
            this._recordRuntimeStep('easy-apply:modal', 'Modal Easy Apply aberto', undefined, 'done')
            let lastFingerprint = await this._waitForFormAndFingerprint()
            if (!lastFingerprint) {
                pushTrace('form-missing-retry')
                this._recordRuntimeStep('easy-apply:form', 'Formulário Easy Apply ainda não visível', 'Tentando reabrir o modal.', 'running')
                await this._closeModalIfOpen()
                await this._openEasyApplyModal()
                lastFingerprint = await this._waitForFormAndFingerprint()
                if (!lastFingerprint) {
                    logger.warn('Easy Apply: form not found after opening modal')
                    await this._logModalDiagnostics()
                    outcome.status = 'no-form'
                    outcome.reason = 'form-not-found'
                    pushTrace('no-form')
                    this._recordRuntimeStep('easy-apply:form', 'Formulário Easy Apply não encontrado', 'O modal abriu sem formulário utilizável.', 'error')
                    throw new Error('easy-apply-form-not-found')
                }
            }
            pushTrace('form-visible')
            this._recordRuntimeStep('easy-apply:form', 'Formulário Easy Apply visível', undefined, 'done')

            let step = 1
            let stagnantCount = 0
            while (step <= this._maxSteps) {
                this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step} em andamento`, 'Coletando campos do formulário.', 'running')
                let values: EasyApplyStepValues | null = null
                const isResumeStep = await this._isResumeStep()
                if (isResumeStep) {
                    await this._elementHandle.handleForm()
                    this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step}: seleção de currículo`, 'Pulando coleta de campos.', 'running')
                } else {
                    try {
                        values = await this._collectStepValues(step)
                    } catch (error) {
                        if (error instanceof EasyApplyAbortError) {
                            outcome.status = 'stopped'
                            outcome.reason = (error as any)?.message || 'standalone-missing'
                            this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step} interrompida`, outcome.reason, 'error')
                            await this._closeModalIfOpen()
                            break
                        }
                        logger.warn(`Easy Apply: erro ao coletar campos na etapa ${step}, tentando avançar mesmo assim`, error)
                        this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step} com erro na coleta`, this._formatErrorReason(error), 'running')
                    }
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
                    this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step}`, 'Próxima ação: revisar candidatura.', 'running')
                    await this._clickAndWait(review)
                    clicked = true
                } else if (next) {
                    action = 'next'
                    this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step}`, 'Próxima ação: avançar para a próxima etapa.', 'running')
                    await this._clickAndWait(next)
                    clicked = true
                }
                if (!clicked && submit) {
                    action = 'submit'
                    this._recordRuntimeStep('easy-apply:submit', 'Candidatura pronta para envio', 'Botão de submissão detectado.', 'pending')
                }
                pushTrace(`${stepSummary}:${action}`)

                if (!clicked) {
                    if (submit) {
                        this._recordRuntimeStep('easy-apply:submit', 'Enviando candidatura', undefined, 'running')
                        await this._finalizeSubmit(jobURL, stepsValues, submit)
                        outcome.status = 'submitted'
                        outcome.reason = 'submit'
                        pushTrace('submitted')
                        this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step} concluída`, 'Fluxo finalizado com submit.', 'done')
                        break
                    }

                    if (!(await this._isModalOpen())) {
                        outcome.status = 'modal-closed'
                        pushTrace('modal-closed')
                        this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step} interrompida`, 'Modal fechado antes do próximo passo.', 'error')
                        break
                    }

                    logger.warn('Easy Apply: no next/review/submit button found, stopping at step', step)
                    outcome.reason = 'no-action'
                    pushTrace('no-action')
                    this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step} sem ação disponível`, 'Nenhum botão next/review/submit foi encontrado.', 'error')
                    break
                }

                const nextFingerprint = await this._waitForFormChange(lastFingerprint)
                if (!nextFingerprint || nextFingerprint === lastFingerprint) {
                    pushTrace('form-unchanged')
                    this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step} sem mudança detectada`, 'O formulário não mudou após o clique.', 'error')
                    const submitAfter = await this._firstEnabled(submitButtons)
                    if (submitAfter) {
                        this._recordRuntimeStep('easy-apply:submit', 'Enviando candidatura', 'Submit detectado após clique sem troca de formulário.', 'running')
                        await this._finalizeSubmit(jobURL, stepsValues, submitAfter)
                        outcome.status = 'submitted'
                        outcome.reason = 'submit-after'
                        pushTrace('submitted')
                        this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step} concluída`, 'Fluxo finalizado com submit após clique.', 'done')
                        break
                    }

                    if (!(await this._isModalOpen())) {
                        outcome.status = 'modal-closed'
                        pushTrace('modal-closed')
                        this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step} interrompida`, 'Modal fechado após o clique.', 'error')
                        break
                    }

                    stagnantCount++
                    if (stagnantCount >= this._maxStagnantSteps) {
                        logger.warn('Easy Apply: form did not change after click, stopping at step', step)
                        outcome.reason = 'stagnant'
                        pushTrace('stagnant')
                        this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step} estagnada`, 'O formulário não mudou após múltiplas tentativas.', 'error')
                        break
                    }
                    continue
                }

                lastFingerprint = nextFingerprint
                pushTrace('form-changed')
                stagnantCount = 0
                this._recordRuntimeStep(`easy-apply:step:${step}`, `Etapa ${step} concluída`, `Próxima etapa: ${step + 1}.`, 'done')
                step++
            }

            if (step > this._maxSteps && outcome.status !== 'submitted') {
                outcome.reason = 'max-steps'
                pushTrace('max-steps')
                this._recordRuntimeStep('easy-apply:lifecycle', 'Easy Apply interrompido', 'Limite máximo de etapas atingido.', 'error')
            }
        } catch (error) {
            if (outcome.status !== 'no-form') {
                outcome.status = 'stopped'
                outcome.reason = this._formatErrorReason(error)
            }
            pushTrace('error')
            this._recordRuntimeStep('easy-apply:lifecycle', 'Easy Apply falhou', this._formatErrorReason(error), 'error')
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

        const buttonMeta = await this._describeOpenButton(easyApplyButton)
        this._lastOpenButtonInfo = this._formatOpenButtonInfo(buttonMeta)
        if (!this._looksLikeEasyApplyButton(buttonMeta)) {
            const message = `Easy Apply debug: selected button does not look like Easy Apply -> ${this._lastOpenButtonInfo}`
            logger.warn(message)
            await this._discord?.log(message)
            throw new Error('easy-apply-not-available')
        }

        const applyLink = this._resolveApplyLink(buttonMeta.href)
        if (applyLink) {
            await this._navigator.goToLinkedinURL(applyLink)
            await this._page.waitForTimeout(700)
            return
        }

        await this._clickAndWait(easyApplyButton)
    }

    private async _waitForForm() {
        const startedAt = Date.now()
        while (Date.now() - startedAt < EASY_APPLY_TIMEOUTS.formVisible) {
            const ready = await this._page.evaluate((selectors) => {
                const isVisible = (element: Element | null) => {
                    if (!element) return false
                    const html = element as HTMLElement
                    const style = window.getComputedStyle(html)
                    if (style.visibility === 'hidden' || style.display === 'none') return false
                    return html.offsetWidth > 0 || html.offsetHeight > 0 || html.getClientRects().length > 0
                }

                const visibleForm = Array.from(document.querySelectorAll(selectors.form))
                    .find((element) => isVisible(element))
                if (visibleForm) return true

                const visibleContent = Array.from(document.querySelectorAll(selectors.content))
                    .find((element) => isVisible(element))
                if (!visibleContent) return false

                const controls = visibleContent.querySelectorAll('input, textarea, select, button')
                if (controls.length > 0) return true

                const text = (visibleContent.textContent || '').trim().toLowerCase()
                if (!text) return false
                return /(easy apply|candidatura|application|review|submit|continuar|next|próximo|proximo)/i.test(text)
            }, {
                form: EASY_APPLY_SELECTORS.form,
                content: EASY_APPLY_SELECTORS.content
            })

            if (ready) return
            await this._page.waitForTimeout(EASY_APPLY_TIMEOUTS.formPoll)
        }

        throw new Error('easy-apply-form-timeout')
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
        const visibleForm = await this._firstVisible(this._page.locator(EASY_APPLY_SELECTORS.form))
        const target = visibleForm || await this._firstVisible(this._page.locator(EASY_APPLY_SELECTORS.content))
        if (!target) return null

        try {
            const text = await target.innerText()
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
            this._recordRuntimeStep(
                `easy-apply:step:${step}`,
                `Etapa ${step} preenchida`,
                `${formValues.inputValues.length} input(s) e ${formValues.selectValues.length} select(s).`,
                'running'
            )
            logger.info(`Easy Apply step ${step} values`, formValues)
            return stepValues
        } catch (error) {
            if (error instanceof EasyApplyAbortError) {
                throw error
            }
            this._recordRuntimeStep(`easy-apply:step:${step}`, `Erro ao ler etapa ${step}`, this._formatErrorReason(error), 'error')
            logger.error('Unable to read Easy Apply form', error)
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

        const lines = candidates.map((candidate, index) => {
            const text = normalizeWhitespace(candidate.text).slice(0, 120)
            const aria = normalizeWhitespace(candidate.aria).slice(0, 120)
            const data = normalizeWhitespace(candidate.data).slice(0, 120)
            const testId = normalizeWhitespace(candidate.testId).slice(0, 120)
            return `${index + 1}. text="${text}" aria="${aria}" data="${data}" testId="${testId}"`
        })

        const message = `Easy Apply debug: apply-like buttons found:\n${lines.join('\n')}`
        logger.warn(message)
    }

    private async _finalizeSubmit(jobURL: string, stepsValues: EasyApplyStepValues[], submitButton: Locator) {
        await this._persistSteps(jobURL, stepsValues)
        await submitButton.click({ force: true })
        this._recordRuntimeStep('easy-apply:submit', 'Candidatura enviada', normalizeWhitespace(jobURL), 'done')
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

    private async _logModalDiagnostics() {
        const info = await this._page.evaluate((selectors) => {
            const isVisible = (element: Element | null) => {
                if (!element) return false
                const html = element as HTMLElement
                const style = window.getComputedStyle(html)
                if (style.visibility === 'hidden' || style.display === 'none') return false
                return html.offsetWidth > 0 || html.offsetHeight > 0 || html.getClientRects().length > 0
            }

            const visibleModal = Array.from(document.querySelectorAll(selectors.modal)).find((element) => isVisible(element))
            const visibleContent = Array.from(document.querySelectorAll(selectors.content)).find((element) => isVisible(element))
            const visibleForm = Array.from(document.querySelectorAll(selectors.form)).find((element) => isVisible(element))
            const source = visibleForm || visibleContent || visibleModal
            const snippet = source?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 280) || ''
            return {
                hasModal: Boolean(visibleModal),
                hasContent: Boolean(visibleContent),
                hasForm: Boolean(visibleForm),
                snippet
            }
        }, {
            modal: EASY_APPLY_SELECTORS.modal,
            content: EASY_APPLY_SELECTORS.content,
            form: EASY_APPLY_SELECTORS.form
        }).catch(() => null)

        if (!info) return
        const buttonInfo = this._lastOpenButtonInfo ? ` | button=${this._lastOpenButtonInfo}` : ''
        const message = `Easy Apply debug: modal=${info.hasModal} content=${info.hasContent} form=${info.hasForm} snippet="${info.snippet}"${buttonInfo}`
        logger.warn(message)
        await this._discord?.log(message)
    }

    private async _describeOpenButton(button: Locator) {
        return button.evaluate((element) => {
            const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
            const ariaLabel = element.getAttribute('aria-label') || ''
            const dataControlName = element.getAttribute('data-control-name') || ''
            const testId = element.getAttribute('data-test-id') || ''
            const className = element.getAttribute('class') || ''
            const href = element.getAttribute('href') || ''
            const tagName = element.tagName || ''
            return {
                text,
                ariaLabel,
                dataControlName,
                testId,
                className,
                href,
                tagName
            }
        }).catch(() => ({
            text: '',
            ariaLabel: '',
            dataControlName: '',
            testId: '',
            className: '',
            href: '',
            tagName: ''
        }))
    }

    private _looksLikeEasyApplyButton(meta: { text: string; ariaLabel: string; dataControlName: string; testId: string; className: string; href: string; tagName: string }) {
        const combined = `${meta.text} ${meta.ariaLabel} ${meta.dataControlName} ${meta.testId} ${meta.className} ${meta.href} ${meta.tagName}`
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim()

        if (!combined) return false

        const easySignals = /(inapply|easy apply|candidatura simplificada|candidatar-se facilmente|candidatura facil|apply easily)/i
        const externalSignals = /(jobdetails_topcard_apply|company website|site da empresa|website da empresa|externa|externo)/i

        if (meta.tagName.toLowerCase() === 'a' && meta.href) {
            return Boolean(this._resolveApplyLink(meta.href))
        }

        if (externalSignals.test(combined) && !easySignals.test(combined)) return false
        return easySignals.test(combined)
    }

    private _formatOpenButtonInfo(meta: { text: string; ariaLabel: string; dataControlName: string; testId: string; className: string; href: string; tagName: string }) {
        const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 120)
        return `tag="${normalize(meta.tagName)}" text="${normalize(meta.text)}" aria="${normalize(meta.ariaLabel)}" data="${normalize(meta.dataControlName)}" testId="${normalize(meta.testId)}" href="${normalize(meta.href)}"`
    }

    private _resolveApplyLink(href?: string) {
        if (!href) return null

        try {
            const url = new URL(href, this._page.url()).toString()
            if (/linkedin\.com\/jobs\/view\/.+\/apply\//i.test(url)) return url
            if (/openSDUIApplyFlow=true/i.test(url)) return url
            return null
        } catch {
            return null
        }
    }

    private async _logResult(
        jobURL: string,
        stepsValues: EasyApplyStepValues[],
        outcome: EasyApplyOutcome,
        trace?: string[]
    ) {
        const inputCount = stepsValues.reduce((sum, step) => sum + (step.inputValues?.length || 0), 0)
        const selectCount = stepsValues.reduce((sum, step) => sum + (step.selectValues?.length || 0), 0)
        const totalFields = inputCount + selectCount
        const reason = outcome.reason ? ` | ${outcome.reason}` : ''
        const traceInfo = trace && trace.length > 0 ? ` | trace: ${trace.join(' > ')}` : ''
        const message = `Easy Apply result: ${outcome.status}${reason} | steps: ${stepsValues.length} | fields: ${totalFields} | ${jobURL}${traceInfo}`
        const detail = `${stepsValues.length} etapa(s), ${totalFields} campo(s) | ${normalizeWhitespace(jobURL)}`
        const status =
            outcome.status === 'submitted'
                ? 'done'
                : outcome.status === 'stopped' || outcome.status === 'no-form' || outcome.status === 'modal-closed'
                    ? 'error'
                    : 'done'
        this._recordRuntimeStep('easy-apply:lifecycle', `Easy Apply ${outcome.status}`, detail, status)
        logger.info(message)
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

    private async _firstVisible(locator: Locator) {
        const count = await locator.count()
        for (let i = 0; i < count; i++) {
            const candidate = locator.nth(i)
            if (await candidate.isVisible().catch(() => false)) {
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
            logger.error("Erro ao salvar respostas Easy Apply", error)
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

    private async _isResumeStep(): Promise<boolean> {
        return this._page.evaluate(() => {
            const modal =
                document.querySelector('.jobs-easy-apply-modal, [data-test-modal], .artdeco-modal') ||
                document.body
            return Boolean(
                modal.querySelector('[aria-label*="select resume" i], [aria-label*="deselect resume" i], [aria-label*="selecionar curriculo" i], [aria-label*="desmarcar" i]')
            )
        }).catch(() => false)
    }

    private _recordRuntimeStep(key: string, label: string, detail?: string, status: 'pending' | 'running' | 'waiting' | 'done' | 'skipped' | 'error' = 'running') {
        adminRuntimeStore.recordStep({
            key,
            source: 'easy-apply',
            label,
            detail,
            status
        })
    }
}
