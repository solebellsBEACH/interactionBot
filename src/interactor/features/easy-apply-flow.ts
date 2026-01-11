import { Locator, Page } from "playwright";
import { LinkedinCoreFeatures } from "./linkedin-core";

import { saveEasyApplyResponses } from "../../api/controllers/easy-apply-responses";
import { ElementHandle, FormFieldValue, FormPromptField } from "../shared/utils/element-handle";
import { WhatsAppClient } from "../shared/whatsapp/whatsapp-client";

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

export class EasyApplyFlow {
    private readonly _page: Page
    private readonly _elementHandle: ElementHandle
    private readonly _navigator: LinkedinCoreFeatures
    private readonly _whatsapp?: WhatsAppClient
    private readonly _maxSteps = 15
    private readonly _maxStagnantSteps = 2

    constructor(page: Page, elementHandle: ElementHandle, navigator: LinkedinCoreFeatures, whatsapp?: WhatsAppClient) {
        this._page = page
        this._elementHandle = elementHandle
        this._navigator = navigator
        this._whatsapp = whatsapp
    }

    async execute(jobURL: string): Promise<EasyApplyStepValues[]> {
        const stepsValues: EasyApplyStepValues[] = []

        await this._whatsapp?.log(`Easy Apply started: ${jobURL}`)
        await this._navigator.goToLinkedinURL(jobURL)
        await this._openEasyApplyModal()
        let lastFingerprint = await this._waitForFormAndFingerprint()
        if (!lastFingerprint) {
            console.warn('Easy Apply: form not found after opening modal')
            return stepsValues
        }

        let step = 1
        let stagnantCount = 0
        while (step <= this._maxSteps) {
            await this._whatsapp?.log(`Easy Apply step ${step}`)
            const values = await this._collectStepValues(step)
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
                    await this._whatsapp?.log("Easy Apply ready to submit")
                    await this._persistSteps(jobURL, stepsValues)
                    await submit.click({ force: true }) // Descomente para finalizar automaticamente
                    break
                }

                const modalOpen = await this._page.locator('.jobs-easy-apply-modal, .artdeco-modal').count() > 0
                if (!modalOpen) break

                console.warn('Easy Apply: no next/review/submit button found, stopping at step', step)
                break
            }

            const nextFingerprint = await this._waitForFormChange(lastFingerprint)
            if (!nextFingerprint || nextFingerprint === lastFingerprint) {
                const submitAfter = await this._firstEnabled(submitButtons)
                if (submitAfter) {
                    await this._whatsapp?.log("Easy Apply ready to submit")
                    await this._persistSteps(jobURL, stepsValues)
                    await submitAfter.click({ force: true })
                    break
                }

                const modalOpen = await this._page.locator('.jobs-easy-apply-modal, .artdeco-modal').count() > 0
                if (!modalOpen) break

                stagnantCount++
                if (stagnantCount >= this._maxStagnantSteps) {
                    console.warn('Easy Apply: form did not change after click, stopping at step', step)
                    await this._whatsapp?.log("Easy Apply stopped: form did not change after click.")
                    break
                }
                continue
            }

            lastFingerprint = nextFingerprint
            stagnantCount = 0
            step++
        }

        return stepsValues
    }

    private async _openEasyApplyModal() {
        const easyApplyButton = this._page.getByRole('button', { name: /candidatura simplificada|easy apply/i })
        if (await easyApplyButton.count() === 0) {
            throw new Error('Easy Apply button not found on job page')
        }
        await easyApplyButton.first().click()
    }

    private async _waitForForm() {
        await this._page.waitForSelector('.jobs-easy-apply-content form, form', {
            state: 'visible',
            timeout: 10_000
        })
    }

    private async _waitForFormAndFingerprint() {
        await this._waitForForm()
        return this._getFormFingerprint()
    }

    private async _waitForFormChange(previousFingerprint: string) {
        const timeoutMs = 8_000
        const start = Date.now()

        while (Date.now() - start < timeoutMs) {
            const fingerprint = await this._getFormFingerprint()
            if (fingerprint && fingerprint !== previousFingerprint) {
                return fingerprint
            }
            await this._page.waitForTimeout(400)
        }

        return previousFingerprint
    }

    private async _getFormFingerprint(): Promise<string | null> {
        const form = this._page.locator('.jobs-easy-apply-content form, form').first()
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
                this._whatsapp
                    ? async (field) => this._askForField(field, step)
                    : undefined
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
            console.error('Unable to read Easy Apply form', error)
            return null
        }
    }

    private async _askForField(field: FormPromptField, step: number) {
        if (!this._whatsapp) return null
        const label = field.label || field.key || 'campo'
        if (field.type === 'select') {
            const options = field.options || []
            const optionsText = options.map((option, idx) => `${idx + 1}) ${option}`).join('\n')
            const prompt = `[Easy Apply] Step ${step} - choose for "${label}":\n${optionsText}\nReply with number or text.`
            return this._whatsapp.ask(prompt)
        }

        const prompt = `[Easy Apply] Step ${step} - fill "${label}":`
        return this._whatsapp.ask(prompt)
    }

    private _getButtonLocators(): ButtonGroups {
        return {
            submitButtons: [
                this._page.getByRole('button', { name: /enviar candidatura|submit application/i }),
                this._page.locator('button:has-text("Enviar candidatura"), button:has-text("Submit application")'),
                this._page.locator('button[aria-label*="Submit application" i], button[aria-label*="Enviar candidatura" i]'),
                this._page.locator('button[data-easy-apply-submit-button]'),
                this._page.locator('footer button.artdeco-button--primary')
            ],
            nextButtons: [
                this._page.getByRole('button', { name: /próximo|proximo|continuar|next|avançar|avancar|seguinte/i }),
                this._page.locator('button[data-control-name*="continue"], button[data-test-id*="continue"], button[data-easy-apply-next-step]'),
                this._page.locator('button:has-text("Próximo"), button:has-text("Proximo"), button:has-text("Continuar"), button:has-text("Next"), button:has-text("Avançar"), button:has-text("Avancar"), button:has-text("Seguinte")'),
                this._page.locator('[role="button"][aria-label*="continuar" i], [role="button"][aria-label*="next" i], [role="button"]:has-text("Continuar"), [role="button"]:has-text("Next")'),
                this._page.locator('footer button:has-text("Continuar"), footer button:has-text("Próximo"), footer button:has-text("Proximo"), footer button:has-text("Next"), footer button:has-text("Avançar"), footer button:has-text("Avancar")')
            ],
            reviewButtons: [
                this._page.getByRole('button', { name: /revisar candidatura|review application|revisar|review/i }),
                this._page.locator('button:has-text("Revisar candidatura"), button:has-text("Review application"), button:has-text("Revisar"), button:has-text("Review")'),
                this._page.locator('button[data-control-name*="review" i], button[data-test-id*="review" i]'),
                this._page.locator('footer button:has-text("Revisar"), footer button:has-text("Review")')
            ]
        }
    }

    private async _firstEnabled(locators: Locator[]) {
        for (const locator of locators) {
            const count = await locator.count()
            for (let i = 0; i < count; i++) {
                const candidate = locator.nth(i)
                if (!(await candidate.isVisible())) continue
                if (await candidate.isDisabled()) continue
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
}
