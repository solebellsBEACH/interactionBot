import { Page } from "playwright";

import { LinkedinCoreFeatures } from "./linkedin-core";
import { EasyApplyFlow, EasyApplyStepValues } from "./easy-apply-flow";
import { ElementHandle } from "../shared/utils/element-handle";
import { HandleActions } from "../shared/interfaces/element-handle";
import { env } from "../shared/env";

export class LinkedinFeatures {

    private _elementHandle: ElementHandle
    private _linkedinCoreFeatures: LinkedinCoreFeatures
    private _page: Page
    private _easyApplyFlow: EasyApplyFlow
    private _default = {
        maxLikes: 20,
    }

    constructor(page: Page) {
        this._page = page
        this._elementHandle = new ElementHandle(page)
        this._linkedinCoreFeatures = new LinkedinCoreFeatures(page)
        this._easyApplyFlow = new EasyApplyFlow(
            page,
            this._elementHandle,
            this._linkedinCoreFeatures
        )
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

    async easyApply(jobURL?: string): Promise<EasyApplyStepValues[]> {
        return this._easyApplyFlow.execute(jobURL || env.linkedinURLs.jobURL)
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
