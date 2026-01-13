import { ElementHandle as PlaywrightElementHandle, Page } from "playwright";

import { LinkedinCoreFeatures } from "./linkedin-core";
import { EasyApplyFlow, EasyApplyStepValues } from "./easy-apply-flow";
import { ElementHandle } from "../shared/utils/element-handle";

import { env } from "../shared/env";
import { DiscordClient } from "../shared/discord/discord-client";
import { HandleActions } from "../shared/interfaces/element-handle.types";
import { LINKEDIN_ACTION_LABELS, LINKEDIN_PLACEHOLDERS, LINKEDIN_SELECTORS } from "../shared/constants/linkedin";
import { EasyApplyJobResult, ScrapFeatures, SearchJobTagOptions } from "./scraps";

type UpvoteOptions = {
    maxLikes?: number
    tag?: string
}

export class LinkedinFeatures {

    private _elementHandle: ElementHandle
    private _linkedinCoreFeatures: LinkedinCoreFeatures
    private _page: Page
    private _easyApplyFlow: EasyApplyFlow
    private _scrapFeatures: ScrapFeatures
    private _discord?: DiscordClient
    private _default = {
        maxLikes: 20,
    }

    constructor(page: Page, discord?: DiscordClient) {
        this._page = page
        this._elementHandle = new ElementHandle(page)
        this._linkedinCoreFeatures = new LinkedinCoreFeatures(page)
        this._scrapFeatures = new ScrapFeatures(page, this._linkedinCoreFeatures)
        this._discord = discord
        this._easyApplyFlow = new EasyApplyFlow(
            page,
            this._elementHandle,
            this._linkedinCoreFeatures,
            discord
        )
    }

    async catchJobs(searchJobTag?: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
        const tag = (searchJobTag || env.linkedinURLs.searchJobTag || '').trim()
        if (!tag) return []

        const defaultLimit = env.linkedinURLs.defaultJobsApplyLength || 0
        const requestedLimit = options?.maxResults
        const effectiveMaxResults = requestedLimit !== undefined
            ? requestedLimit
            : (defaultLimit > 0 ? defaultLimit : undefined)

        const searchOptions: SearchJobTagOptions = {
            ...options,
            ...(effectiveMaxResults && effectiveMaxResults > 0 ? { maxResults: effectiveMaxResults } : {})
        }

        const results = await this._scrapFeatures.searchJobTag(tag, searchOptions)

        if (this._discord) {
            await this._discord.log(`Easy Apply results for "${tag}": ${results.length}`)
            if (results.length > 0) {
                const lines = results.map((job, idx) =>
                    `${idx + 1}. ${job.title} | ${job.company} | ${job.location} | ${job.url}`
                )
                await this._discord.log(lines.join('\n'))
            }
        }

        return results
    }

    async sendConnection(profileURL: string, inMailOptions?: { message: string }) {
        await this._linkedinCoreFeatures.goToLinkedinURL(profileURL)

        await this._elementHandle.handleByRole(HandleActions.click, 'button', {
            name: env.linkedinURLs.message
        })

        if (inMailOptions) {
            await this._sendInMail(inMailOptions.message)
        } else {
            await this._elementHandle.handleByRole(HandleActions.click, 'button', {
                name: LINKEDIN_ACTION_LABELS.sendWithoutNote
            })
        }

    }

    async easyApply(jobURL?: string): Promise<EasyApplyStepValues[]> {
        return this._easyApplyFlow.execute(jobURL || env.linkedinURLs.jobURL)
    }

    async searchJobTag(searchJobTag: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
        return this._scrapFeatures.searchJobTag(searchJobTag, options)
    }

    async upvoteOnPosts(options?: UpvoteOptions): Promise<string[]> {
        const maxLikes = options?.maxLikes && options.maxLikes > 0 ? options.maxLikes : this._default.maxLikes
        const tag = options?.tag?.trim()
        const targetUrl = tag ? this._buildPostSearchUrl(tag) : env.linkedinURLs.postUrl
        await this._linkedinCoreFeatures.goToLinkedinURL(targetUrl)

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
                } catch (e) { console.log(e) }
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
        const normalized = tag.replace(/\+/g, ' ').trim()
        if (!normalized) return env.linkedinURLs.postUrl

        const params = new URLSearchParams()
        params.set('keywords', normalized)
        return `https://www.linkedin.com/search/results/content/?${params.toString()}`
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
            if (result.href) return this._normalizePostUrl(result.href)

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
        return `https://www.linkedin.com/feed/update/${urn}`
    }

    private _normalizePostUrl(href: string) {
        try {
            const url = new URL(href, 'https://www.linkedin.com')
            url.search = ''
            url.hash = ''
            return url.toString()
        } catch {
            return href
        }
    }

    private async _sendInMail(message: string) {
        await this._elementHandle.handleByRole(HandleActions.click, 'button', {
            name: LINKEDIN_ACTION_LABELS.addNote
        })

        await this._elementHandle.handleByPlaceholder(HandleActions.fill, LINKEDIN_PLACEHOLDERS.noteMessage, message)

        await this._elementHandle.handleByRole(HandleActions.click, 'button', {
            name: LINKEDIN_ACTION_LABELS.send
        })
    }

}
