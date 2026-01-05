import { Locator, Page } from "playwright";
import { LinkedinCoreFeatures } from "./linkedin-core";

import { saveEasyApplyResponses } from "../../api/controllers/easy-apply-responses";
import { ElementHandle, FormFieldValue } from "../shared/utils/element-handle";

export type EasyApplyStepValues = {
    step: number
    inputValues?: FormFieldValue[]
    selectValues?: FormFieldValue[]
}

type ButtonGroups = {
    nextButtons: Locator[]
    submitButtons: Locator[]
}

export class EasyApplyFlow {
    private readonly _page: Page
    private readonly _elementHandle: ElementHandle
    private readonly _navigator: LinkedinCoreFeatures
    private readonly _maxSteps = 15

    constructor(page: Page, elementHandle: ElementHandle, navigator: LinkedinCoreFeatures) {
        this._page = page
        this._elementHandle = elementHandle
        this._navigator = navigator
    }

    async execute(jobURL: string): Promise<EasyApplyStepValues[]> {
        const stepsValues: EasyApplyStepValues[] = []

        await this._navigator.goToLinkedinURL(jobURL)
        await this._openEasyApplyModal()
        await this._waitForForm()

        let step = 1
        while (step <= this._maxSteps) {
            const values = await this._collectStepValues(step)
            if (values) stepsValues.push(values)

            const { nextButtons, submitButtons } = this._getButtonLocators()
            const next = await this._firstEnabled(nextButtons)
            const submit = await this._firstEnabled(submitButtons)

            if (next) {
                await this._clickAndWait(next)
                await this._waitForForm()
                step++
                continue
            }

            if (submit) {
                await this._persistSteps(jobURL, stepsValues)
                // await submit.click({ force: true }) // Descomente para finalizar automaticamente
                break
            }

            const modalOpen = await this._page.locator('.jobs-easy-apply-modal, .artdeco-modal').count() > 0
            if (!modalOpen) break

            console.warn('Easy Apply: no next/submit button found, stopping at step', step)
            break
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

    private async _collectStepValues(step: number) {
        try {
            const formValues = await this._elementHandle.handleForm()
            if (!formValues) return null
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
                this._page.getByRole('button', { name: /próximo|continuar|next|review|revisar|avançar|seguinte|revisar candidatura/i }),
                this._page.locator('button[data-control-name*="continue"], button[data-test-id*="continue"], button[data-easy-apply-next-step]'),
                this._page.locator('button:has-text("Próximo"), button:has-text("Continuar"), button:has-text("Next"), button:has-text("Review"), button:has-text("Review application"), button:has-text("Revisar candidatura"), button:has-text("Avançar"), button:has-text("Seguinte")'),
                this._page.locator('[role="button"][aria-label*="continuar" i], [role="button"][aria-label*="next" i], [role="button"][aria-label*="review" i], [role="button"][aria-label*="revisar" i], [role="button"]:has-text("Continuar"), [role="button"]:has-text("Next")'),
                this._page.locator('footer button:has-text("Continuar"), footer button:has-text("Próximo"), footer button:has-text("Next"), footer button:has-text("Avançar"), footer button:has-text("Revisar"), footer button:has-text("Review")')
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
