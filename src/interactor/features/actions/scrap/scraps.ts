import { Locator, Page } from "playwright";

import { LinkedinCoreFeatures } from "../../linkedin-core";
import { SCRAP_SELECTORS } from "../../../shared/constants/scrap";

export type EasyApplyJobResult = {
    title: string
    company: string
    location: string
    url: string
    promoted: boolean
    easyApply: boolean
    applicants: number | null
}

export type SearchJobTagOptions = {
    location?: string
    geoId?: string | number
    maxPages?: number
    maxResults?: number
    easyApplyOnly?: boolean
    onlyNonPromoted?: boolean
    maxApplicants?: number
    includeDetails?: boolean
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
        const easyApplyOnly = options?.easyApplyOnly !== false
        const onlyNonPromoted = options?.onlyNonPromoted === true
        const maxApplicants = options?.maxApplicants
        const includeDetails = options?.includeDetails ?? maxApplicants !== undefined
        const results = new Map<string, EasyApplyJobResult>()

        for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
            if (this._page.isClosed()) break
            console.log(`Buscando jobs: pagina ${pageIndex + 1}/${maxPages}`)
            const searchUrl = this._buildSearchJobUrl(tag, options?.location, pageIndex * 25, options?.geoId, easyApplyOnly)
            await this._navigator.goToLinkedinURL(searchUrl)

            const ready = await this._waitForJobResults()
            let pageResults: EasyApplyJobResult[] = []
            if (!ready) {
                pageResults = await this._collectEasyApplyFromPage(includeDetails, easyApplyOnly)
                if (pageResults.length === 0) break
            } else {
                await this._scrollResultsList()
                pageResults = await this._collectEasyApplyFromPage(includeDetails, easyApplyOnly)
            }

            const beforeCount = results.size
            for (const job of this._filterResults(pageResults, {
                onlyNonPromoted,
                maxApplicants,
                easyApplyOnly
            })) {
                if (results.size >= maxResults) break
                results.set(job.url, job)
            }

            if (results.size >= maxResults) break
            if (pageResults.length === 0) break
            if (results.size === beforeCount) break
        }

        return Array.from(results.values())
    }

    private _buildSearchJobUrl(
        tag: string,
        location?: string,
        start = 0,
        geoId?: string | number,
        easyApplyOnly = true
    ) {
        const params = new URLSearchParams()
        params.set('keywords', tag)
        if (easyApplyOnly) {
            params.set('f_AL', 'true')
        }
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

    private async _collectEasyApplyFromPage(includeDetails: boolean, easyApplyOnly: boolean): Promise<EasyApplyJobResult[]> {
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
            const cardText = await this._safeInnerText(card)
            let promoted = this._hasPromotedLabel(cardText)
            let applicants = this._parseApplicantsCount(cardText)
            let easyApply = easyApplyOnly || this._hasEasyApplyLabel(cardText)
            if (includeDetails && (applicants === null || !promoted || !easyApply)) {
                const detailText = await this._getDetailTextFromCard(card)
                if (detailText) {
                    if (applicants === null) {
                        applicants = this._parseApplicantsCount(detailText)
                    }
                    if (!promoted) {
                        promoted = this._hasPromotedLabel(detailText)
                    }
                    if (!easyApply) {
                        easyApply = this._hasEasyApplyLabel(detailText)
                    }
                }
            }

            results.push({
                title,
                company,
                location,
                url,
                promoted,
                easyApply,
                applicants
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

    private async _getDetailTextFromCard(card: Locator) {
        const detail = this._page.locator(SCRAP_SELECTORS.jobDetailContainer).first()
        if ((await detail.count().catch(() => 0)) === 0) return ''
        try {
            await card.click({ timeout: 3_000 })
        } catch {
            return ''
        }
        await detail.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined)
        await this._page.waitForTimeout(250)
        const parts = await this._safeInnerText(detail)
        if (parts) return parts
        const detailTextSelectors = SCRAP_SELECTORS.jobDetailText.join(', ')
        const detailText = await this._safeInnerText(this._page.locator(detailTextSelectors))
        return detailText
    }

    private _filterResults(
        jobs: EasyApplyJobResult[],
        options: { onlyNonPromoted: boolean; maxApplicants?: number; easyApplyOnly: boolean }
    ) {
        return jobs.filter((job) => {
            if (options.onlyNonPromoted && job.promoted) return false
            if (options.easyApplyOnly && !job.easyApply) return false
            if (options.maxApplicants !== undefined) {
                if (job.applicants === null) return false
                if (job.applicants > options.maxApplicants) return false
            }
            return true
        })
    }

    private _parseApplicantsCount(text: string) {
        const normalized = this._normalizeText(text)
        if (!normalized) return null
        const patterns = [
            /(?:over|more than|mais de)\s*([\d.,]+)\s*(?:applicants?|applications?|candidatos?|candidaturas?)/,
            /([\d.,]+)\s*(?:applicants?|applications?|candidatos?|candidaturas?)/,
            /be among the first\s*([\d.,]+)/,
            /seja um dos primeiros\s*([\d.,]+)/
        ]
        for (const pattern of patterns) {
            const match = normalized.match(pattern)
            if (match) {
                const raw = match[1].replace(/[^\d]/g, '')
                if (!raw) continue
                const value = Number(raw)
                return Number.isNaN(value) ? null : value
            }
        }
        return null
    }

    private _hasPromotedLabel(text: string) {
        const normalized = this._normalizeText(text)
        if (!normalized) return false
        return /(promoted|promovida|promovido|patrocinada|patrocinado|sponsored)/.test(normalized)
    }

    private _hasEasyApplyLabel(text: string) {
        const normalized = this._normalizeText(text)
        if (!normalized) return false
        return /(easy apply|candidatura simplificada|candidatar[- ]se facilmente|candidatura facil|aplicar facilmente)/.test(normalized)
    }

    private _normalizeText(text: string) {
        return text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()
    }
}
