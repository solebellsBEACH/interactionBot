import { Page } from "playwright";

import { LinkedinCoreFeatures } from "./linkedin-core";
import { EasyApplyFlow, EasyApplyStepValues } from "./easy-apply-flow";
import { ElementHandle } from "../shared/utils/element-handle";

import { env } from "../shared/env";
import { DiscordClient } from "../shared/discord/discord-client";
import { HandleActions } from "../shared/interfaces/element-handle.types";
import { LINKEDIN_ACTION_LABELS, LINKEDIN_PLACEHOLDERS, LINKEDIN_SELECTORS } from "../shared/constants/linkedin";
import { EasyApplyJobResult, ScrapFeatures, SearchJobTagOptions } from "./scraps";

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

        this._linkedinCoreFeatures.goToLinkedinURL(profileURL)

        await this._elementHandle.handleByRole(HandleActions.click, 'button', {
            name: env.linkedinURLs.message
        })

        if (inMailOptions) {
            this._sendInMail(inMailOptions.message)
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

    async upvoteOnPosts() {
        await this._page.goto(env.linkedinURLs.postUrl, { waitUntil: 'networkidle' })

        let likedCount = 0
        const maxLikes = this._default.maxLikes

        while (likedCount < maxLikes) {
            const buttons = await this._page.$$(LINKEDIN_SELECTORS.likeButtons)
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
            name: LINKEDIN_ACTION_LABELS.addNote
        })

        this._elementHandle.handleByPlaceholder(HandleActions.fill, LINKEDIN_PLACEHOLDERS.noteMessage, message)

        await this._elementHandle.handleByRole(HandleActions.click, 'button', {
            name: LINKEDIN_ACTION_LABELS.send
        })
    }

}
