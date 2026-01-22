import { Locator, Page } from "playwright";

import { LinkedinCoreFeatures } from "../../linkedin-core";
import { SCRAP_SELECTORS } from "../../../shared/constants/scrap";

export type EasyApplyJobResult = {
    title: string
    company: string
    location: string
    url: string
}

export type SearchJobTagOptions = {
    location?: string
    geoId?: string | number
    maxPages?: number
    maxResults?: number
}

export class ScrapFeatures {
    private readonly _page: Page
    private readonly _navigator: LinkedinCoreFeatures

    constructor(page: Page, navigator: LinkedinCoreFeatures) {
        this._page = page
        this._navigator = navigator
    }

    async searchJobTag(searchJobTag: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
        const tag = searchJobTag.trim()
        if (!tag) return []

        const maxPages = options?.maxPages ?? 10
        const maxResults = options?.maxResults ?? Number.POSITIVE_INFINITY
        const results = new Map<string, EasyApplyJobResult>()

        for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
            if (this._page.isClosed()) break
            console.log(`Buscando jobs (Easy Apply): pagina ${pageIndex + 1}/${maxPages}`)
            const searchUrl = this._buildSearchJobUrl(tag, options?.location, pageIndex * 25, options?.geoId)
            await this._navigator.goToLinkedinURL(searchUrl)

            const ready = await this._waitForJobResults()
            let pageResults: EasyApplyJobResult[] = []
            if (!ready) {
                pageResults = await this._collectEasyApplyFromPage()
                if (pageResults.length === 0) break
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

    private _buildSearchJobUrl(tag: string, location?: string, start = 0, geoId?: string | number) {
        const params = new URLSearchParams()
        params.set('keywords', tag)
        params.set('f_AL', 'true')
        if (geoId !== undefined && geoId !== null) {
            const normalized = String(geoId).trim()
            if (normalized) {
                params.set('geoId', normalized)
            }
        }
        if (location && location.trim()) {
            params.set('location', location.trim())
        }
        if (start > 0) {
            params.set('start', start.toString())
        }
        return `https://www.linkedin.com/jobs/search/?${params.toString()}`
    }

    private async _waitForJobResults(): Promise<boolean> {
        const resultsSelector = SCRAP_SELECTORS.jobResults.join(', ')
        const emptySelector = SCRAP_SELECTORS.jobResultsEmpty.join(', ')

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
        const list = this._page.locator(SCRAP_SELECTORS.jobResultsList)
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
        if (this._page.isClosed()) return []
        const cards = this._page.locator(SCRAP_SELECTORS.jobCard)
        const count = await cards.count().catch(() => 0)
        const results: EasyApplyJobResult[] = []

        for (let i = 0; i < count; i++) {
            const card = cards.nth(i)
            const link = card.locator(SCRAP_SELECTORS.jobLink)
            const href = await link.first().getAttribute('href').catch(() => null)
            if (!href) continue

            const url = this._normalizeJobUrl(href)
            const title = await this._safeInnerText(link.first())
            const company = await this._safeInnerText(card.locator(SCRAP_SELECTORS.jobCompany))
            const location = await this._safeInnerText(card.locator(SCRAP_SELECTORS.jobLocation))

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
