import { Locator, Page } from "playwright";

import { LinkedinCoreFeatures } from "./linkedin-core";
import { EasyApplyFlow, EasyApplyStepValues } from "./easy-apply-flow";
import { ElementHandle } from "../shared/utils/element-handle";

import { env } from "../shared/env";
import { DiscordClient } from "../shared/discord/discord-client";
import { HandleActions } from "../shared/interfaces/element-handle.types";

export type EasyApplyJobResult = {
    title: string
    company: string
    location: string
    url: string
}

export type SearchJobTagOptions = {
    location?: string
    maxPages?: number
    maxResults?: number
}

export class LinkedinFeatures {

    private _elementHandle: ElementHandle
    private _linkedinCoreFeatures: LinkedinCoreFeatures
    private _page: Page
    private _easyApplyFlow: EasyApplyFlow
    private _discord?: DiscordClient
    private _default = {
        maxLikes: 20,
    }

    constructor(page: Page, discord?: DiscordClient) {
        this._page = page
        this._elementHandle = new ElementHandle(page)
        this._linkedinCoreFeatures = new LinkedinCoreFeatures(page)
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

        const results = await this.searchJobTag(tag, options)

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
                name: 'Enviar sem nota'
            })
        }

    }

    async easyApply(jobURL?: string): Promise<EasyApplyStepValues[]> {
        return this._easyApplyFlow.execute(jobURL || env.linkedinURLs.jobURL)
    }

    async searchJobTag(searchJobTag: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
        const tag = searchJobTag.trim()
        if (!tag) return []

        const maxPages = options?.maxPages ?? 10
        const maxResults = options?.maxResults ?? Number.POSITIVE_INFINITY
        const results = new Map<string, EasyApplyJobResult>()

        for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
            const searchUrl = this._buildSearchJobUrl(tag, options?.location, pageIndex * 25)
            await this._linkedinCoreFeatures.goToLinkedinURL(searchUrl)
            const ready = await this._waitForJobResults()
            let pageResults: EasyApplyJobResult[] = []
            if (!ready) {
                pageResults = await this._collectEasyApplyFromPage()
                if (pageResults.length === 0) {
                    await this._discord?.log(`Jobs search not ready or empty for "${tag}".`)
                    break
                }
            } else {
                await this._scrollResultsList()
                pageResults = await this._collectEasyApplyFromPage()
            }
            const beforeCount = results.size
            for (const job of pageResults) {
                if (results.size >= maxResults) break
                results.set(job.url, job)
            }

            if (results.size >= maxResults) break
            if (pageResults.length === 0) break
            if (results.size === beforeCount) break
        }

        return Array.from(results.values())
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

    private _buildSearchJobUrl(tag: string, location?: string, start = 0) {
        const params = new URLSearchParams()
        params.set('keywords', tag)
        params.set('f_AL', 'true')
        if (location && location.trim()) {
            params.set('location', location.trim())
        }
        if (start > 0) {
            params.set('start', start.toString())
        }
        return `https://www.linkedin.com/jobs/search/?${params.toString()}`
    }

    private async _waitForJobResults(): Promise<boolean> {
        const resultsSelector = [
            'a.job-card-list__title',
            'a.job-card-container__link',
            'a[data-control-name*="job_card"]',
            'li.jobs-search-results__list-item',
            'li[data-job-id]',
            'div.jobs-search-results-list',
            'div.scaffold-layout__list-container'
        ].join(', ')
        const emptySelector = [
            '.jobs-search-no-results',
            '.jobs-search-no-results__container',
            '.artdeco-empty-state'
        ].join(', ')

        try {
            await this._page.waitForSelector(resultsSelector, { state: 'attached', timeout: 20_000 })
            return true
        } catch {
            const emptyVisible = await this._page.locator(emptySelector).first().isVisible().catch(() => false)
            if (emptyVisible) return false
            return false
        }
    }

    private async _scrollResultsList() {
        const list = this._page.locator('div.jobs-search-results-list, div.scaffold-layout__list-container')
        if ((await list.count()) === 0) {
            await this._page.mouse.wheel(0, 1600)
            await this._page.waitForTimeout(800)
            return
        }

        const container = list.first()
        let previousHeight = 0
        for (let i = 0; i < 8; i++) {
            const height = await container.evaluate((el) => el.scrollHeight)
            if (height === previousHeight) break
            previousHeight = height
            await container.evaluate((el) => {
                el.scrollTop = el.scrollHeight
            })
            await this._page.waitForTimeout(800)
        }
    }

    private async _collectEasyApplyFromPage(): Promise<EasyApplyJobResult[]> {
        const cards = this._page.locator('li.jobs-search-results__list-item, .jobs-search-results__list-item, li[data-job-id], div.job-card-container')
        const count = await cards.count()
        const results: EasyApplyJobResult[] = []

        for (let i = 0; i < count; i++) {
            const card = cards.nth(i)
            const link = card.locator('a.job-card-list__title, a.job-card-container__link, a[data-control-name*="job_card"]')
            const href = await link.first().getAttribute('href').catch(() => null)
            if (!href) continue

            const url = this._normalizeJobUrl(href)
            const title = await this._safeInnerText(link.first())
            const company = await this._safeInnerText(
                card.locator('.job-card-container__company-name, .job-card-container__primary-description')
            )
            const location = await this._safeInnerText(
                card.locator('.job-card-container__metadata-item, .job-card-container__metadata-item--location')
            )

            results.push({
                title,
                company,
                location,
                url
            })
        }

        return results
    }

    private _normalizeJobUrl(href: string) {
        try {
            const url = new URL(href, 'https://www.linkedin.com')
            url.search = ''
            url.hash = ''
            return url.toString()
        } catch {
            return href
        }
    }

    private async _safeInnerText(locator: Locator) {
        try {
            if ((await locator.count()) === 0) return ''
            return (await locator.first().innerText()).trim()
        } catch {
            return ''
        }
    }

}
