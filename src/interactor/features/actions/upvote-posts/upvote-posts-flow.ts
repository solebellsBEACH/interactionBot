import { ElementHandle as PlaywrightElementHandle, Page } from "playwright";

import { env } from "../../../shared/env";
import { LINKEDIN_SELECTORS } from "../../../shared/constants/linkedin";
import { LinkedinCoreFeatures } from "../../linkedin-core";
import { logger } from "../../../shared/services/logger";
import { buildLinkedinContentSearchUrl, buildLinkedinPostUrlFromUrn, normalizeLinkedinUrl } from "../../../shared/utils/linkedin-url";

type UpvoteOptions = {
    maxLikes?: number
    tag?: string
}

export class LinkedinUpvotePostsFlow {
    private readonly _page: Page
    private readonly _navigator: LinkedinCoreFeatures
    private readonly _default = {
        maxLikes: 20,
    }

    constructor(page: Page, navigator: LinkedinCoreFeatures) {
        this._page = page
        this._navigator = navigator
    }

    async upvoteOnPosts(options?: UpvoteOptions): Promise<string[]> {
        const maxLikes = options?.maxLikes && options.maxLikes > 0 ? options.maxLikes : this._default.maxLikes
        const tag = options?.tag?.trim()
        const targetUrl = tag ? this._buildPostSearchUrl(tag) : env.linkedinURLs.postUrl
        await this._navigator.goToLinkedinURL(targetUrl)

        const likedUrls = new Set<string>()
        let likedCount = 0
        let idleRounds = 0

        while (likedCount < maxLikes) {
            if (this._page.isClosed()) break
            const buttons = await this._page.$$(LINKEDIN_SELECTORS.likeButtons)
            let likedThisRound = 0

            for (const button of buttons) {
                if (likedCount >= maxLikes) break

                const pressed = await button.getAttribute('aria-pressed')
                if (pressed === 'true') continue

                const postUrl = await this._extractPostUrl(button)
                try {
                    await button.scrollIntoViewIfNeeded()
                    await this._page.waitForTimeout(600)
                    await button.click({ delay: 50 })
                    likedCount++
                    likedThisRound++
                    if (postUrl) likedUrls.add(postUrl)
                    await this._page.waitForTimeout(1200)
                } catch (e) {
                    logger.warn('Falha ao curtir post', e)
                }
            }

            if (likedCount >= maxLikes) break
            if (likedThisRound === 0) {
                idleRounds++
                if (idleRounds >= 3) break
            } else {
                idleRounds = 0
            }

            await this._page.mouse.wheel(0, 1200)
            await this._page.waitForTimeout(2000)
        }

        return Array.from(likedUrls.values())
    }

    private _buildPostSearchUrl(tag: string) {
        return buildLinkedinContentSearchUrl(tag)
    }

    private async _extractPostUrl(button: PlaywrightElementHandle<Element>) {
        try {
            const result = await button.evaluate((el, selector) => {
                const container = el.closest(
                    'div[data-urn], div[data-entity-urn], div.feed-shared-update-v2, div.update-components-update-v2, div.feed-shared-update-v2__content-wrapper, article'
                )
                const link = container?.querySelector(selector) as HTMLAnchorElement | null
                const href = link?.href || null
                const dataUrn = container?.getAttribute('data-urn') || null
                const dataEntityUrn = container?.getAttribute('data-entity-urn') || null
                return { href, dataUrn, dataEntityUrn }
            }, LINKEDIN_SELECTORS.postLinks)
            if (result.href) return normalizeLinkedinUrl(result.href)

            const urn = this._extractUrn(result.dataUrn || '') || this._extractUrn(result.dataEntityUrn || '')
            if (!urn) return null
            return this._buildPostUrlFromUrn(urn)
        } catch {
            return null
        }
    }

    private _extractUrn(value: string) {
        if (!value) return null
        const match = value.match(/urn:li:(activity|ugcPost):\d+/i)
        return match ? match[0] : null
    }

    private _buildPostUrlFromUrn(urn: string) {
        return buildLinkedinPostUrlFromUrn(urn)
    }

}
