import { Locator, Page } from "playwright";
import { ElementHandle } from "../shared/utils/element-handle";
import { HandleActions } from "../shared/interfaces/element-handle";
import { env } from "../shared/env";
import { LinkedinCoreFeatures } from "./linkedin-core";

export class LinkedinFeatures {

    private _elementHandle: ElementHandle
    private _linkedinCoreFeatures: LinkedinCoreFeatures
    private _page: Page
    private _default = {
        maxLikes: 20,
    }

    constructor(page: Page) {
        this._page = page
        this._elementHandle = new ElementHandle(page)
        this._linkedinCoreFeatures = new LinkedinCoreFeatures(page)
    }

    async sendConnection(profileURL: string, inMailOptions?: { message: string }) {

        this._linkedinCoreFeatures.goToLinkedinURL(profileURL)

        await this._elementHandle.handleByRole(HandleActions.click, 'button', {
            name: env.linkedinURLs.message
        })

        if (inMailOptions) {
            this._sendInMail(inMailOptions.message)
        } else {
            await this._elementHandle.handleByRole(HandleActions.click, 'button', {
                name: 'Enviar sem nota'
            })
        }

    }

    async easyApply(jobURL?: string) {
        const stepsValues: {
            step: number
            inputValues?: string[]
            selectValues?: string[]
        }[] = []

        await this._linkedinCoreFeatures.goToLinkedinURL(jobURL || env.linkedinURLs.jobURL)

        const easyApplyButton = this._page.getByRole('button', { name: /candidatura simplificada|easy apply/i })
        if (await easyApplyButton.count() === 0) {
            console.warn('Easy Apply button not found on job page')
            return stepsValues
        }

        await easyApplyButton.first().click()

        const waitForForm = async () => {
            try {
                await this._page.waitForSelector('.jobs-easy-apply-content form, form', {
                    state: 'visible',
                    timeout: 10_000
                })
            } catch (error) {
                console.error('Easy Apply form not visible', error)
            }
        }

        await waitForForm()
        let step = 1
        const maxSteps = 15

        const firstEnabled = async (locators: Locator[]) => {
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

        while (step <= maxSteps) {
            await this._page.waitForTimeout(600)

            try {
                const formValues = await this._elementHandle.handleForm()
                if (formValues) {
                    stepsValues.push({
                        step,
                        ...formValues
                    })
                    console.log(`Easy Apply step ${step} values`, formValues)
                }
            } catch (error) {
                console.error('Unable to read Easy Apply form', error)
            }

            const submitButton = [
                this._page.getByRole('button', { name: /enviar candidatura|submit application/i }),
                this._page.locator('button:has-text("Enviar candidatura"), button:has-text("Submit application")'),
                this._page.locator('button[aria-label*="Submit application" i], button[aria-label*="Enviar candidatura" i]'),
                this._page.locator('button[data-easy-apply-submit-button]'),
                this._page.locator('footer button.artdeco-button--primary')
            ]

            const nextButtons = [
                this._page.getByRole('button', { name: /próximo|continuar|next|review|revisar|avançar|seguinte|revisar candidatura/i }),
                this._page.locator('button[data-control-name*="continue"], button[data-test-id*="continue"], button[data-easy-apply-next-step]'),
                this._page.locator('button:has-text("Próximo"), button:has-text("Continuar"), button:has-text("Next"), button:has-text("Review"), button:has-text("Review application"), button:has-text("Revisar candidatura"), button:has-text("Avançar"), button:has-text("Seguinte")'),
                this._page.locator('[role="button"][aria-label*="continuar" i], [role="button"][aria-label*="next" i], [role="button"][aria-label*="review" i], [role="button"][aria-label*="revisar" i], [role="button"]:has-text("Continuar"), [role="button"]:has-text("Next")'),
                this._page.locator('footer button:has-text("Continuar"), footer button:has-text("Próximo"), footer button:has-text("Next"), footer button:has-text("Avançar"), footer button:has-text("Revisar"), footer button:has-text("Review")')
            ]

            const next = await firstEnabled(nextButtons)
            const submit = await firstEnabled(submitButton)

            if (next) {
                await next.scrollIntoViewIfNeeded()
                await next.click({ force: true })
                await this._page.waitForTimeout(700)
                await waitForForm()
                step++
                continue
            }

            if (submit) {
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

    async upvoteOnPosts() {
        await this._page.goto(env.linkedinURLs.postUrl, { waitUntil: 'networkidle' })

        let likedCount = 0
        const maxLikes = this._default.maxLikes

        while (likedCount < maxLikes) {
            const buttons = await this._page.$$(
                'button[aria-label*="Reagir com gostei"], button[aria-label*="Like"]'
            )
            for (const button of buttons) {

                if (likedCount >= maxLikes) break

                const pressed = await button.getAttribute('aria-pressed')
                if (pressed === 'true') continue

                try {
                    await button.scrollIntoViewIfNeeded()
                    await this._page.waitForTimeout(600)
                    await button.click({ delay: 50 })
                    likedCount++
                    await this._page.waitForTimeout(1200)
                } catch (e) { console.log(e) }
            }

            await this._page.mouse.wheel(0, 1200)
            await this._page.waitForTimeout(2000)
        }
    }

    private async _sendInMail(message: string) {
        await this._elementHandle.handleByRole(HandleActions.click, 'button', {
            name: 'Adicionar nota'
        })

        this._elementHandle.handleByPlaceholder(HandleActions.fill, 'Ex.: Nos conhecemos em…', message)

        await this._elementHandle.handleByRole(HandleActions.click, 'button', {
            name: 'Enviar'
        })
    }

}
