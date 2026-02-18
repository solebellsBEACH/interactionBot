import { Locator, Page } from "playwright";
import { SCRAP_SELECTORS } from "../constants/scrap";
import { logger } from "../services/logger";
import type { EasyApplyJobResult, SearchJobTagOptions } from "../interface/scrap/jobs.types";
import { buildLinkedinJobSearchUrl, normalizeLinkedinUrl } from "../utils/linkedin-url";
import { normalizeTextAlphaNum } from "../utils/normalize";
import { parseApplicantsCount, parsePostedAgeMinutes } from "../utils/parse-jobs";


export class LinkedinJobsScrap {

    private readonly _page: Page
    private readonly _enableTimingLogs = true

    constructor( page: Page, ) {
            this._page = page
    }

    
        buildSearchJobUrl(
            tag: string,
            location?: string,
            start = 0,
            geoId?: string | number,
            easyApplyOnly = true,
            postedWithinDays?: number
        ) {
            return buildLinkedinJobSearchUrl({
                tag,
                location,
                start,
                geoId,
                easyApplyOnly,
                postedWithinDays
            })
        }
    
         async waitForJobResults(): Promise<boolean> {
            const resultsSelector = SCRAP_SELECTORS.jobResults.join(', ')
            const emptySelector = SCRAP_SELECTORS.jobResultsEmpty.join(', ')
    
            try {
                await this._page.waitForSelector(resultsSelector, { state: 'attached', timeout: 6_000 })
                return true
            } catch {
                const emptyVisible = await this._page.locator(emptySelector).first().isVisible().catch(() => false)
                if (emptyVisible) return false
                return false
            }
        }
    
        async scrollResultsList() {
            const list = this._page.locator(SCRAP_SELECTORS.jobResultsList)
            if ((await list.count()) === 0) {
                await this._page.mouse.wheel(0, 1600)
                await this._page.waitForTimeout(200)
                return
            }
    
            const container = list.first()
            let previousHeight = 0
            for (let i = 0; i < 5; i++) {
                const height = await container.evaluate((el) => el.scrollHeight)
                if (height === previousHeight) break
                previousHeight = height
                await container.evaluate((el) => {
                    el.scrollTop = el.scrollHeight
                })
                await this._page.waitForTimeout(200)
            }
        }
    
        async collectEasyApplyFromPage(includeDetails: boolean, easyApplyOnly: boolean): Promise<EasyApplyJobResult[]> {
            if (this._page.isClosed()) return []
            const cards = this._page.locator(SCRAP_SELECTORS.jobCard)
            const count = await cards.count().catch(() => 0)
            const results: EasyApplyJobResult[] = []
            const batchStart = Date.now()
            this._logTiming('cards:start', { total: count })
    
            for (let i = 0; i < count; i++) {
                const cardStart = Date.now()
                this._logTiming('card:start', { index: i + 1, total: count })
                const card = cards.nth(i)
                const link = card.locator(SCRAP_SELECTORS.jobLink)
                let href = await link.first().getAttribute('href').catch(() => null)
                const title = await this._safeInnerText(link.first())
                const company = await this._safeInnerText(card.locator(SCRAP_SELECTORS.jobCompany))
                const location = await this._safeInnerText(card.locator(SCRAP_SELECTORS.jobLocation))
                const cardText = await this._safeInnerText(card)
                const clicked = await this._clickJobCard(card)
                if (!clicked) continue
                await this._page.waitForTimeout(40)
                const detail = this._page.locator(SCRAP_SELECTORS.jobDetailContainer).first()
                const expectedUrl = href ? normalizeLinkedinUrl(href) : ''
                if (expectedUrl) {
                    for (let attempt = 0; attempt < 3; attempt++) {
                        const detailUrl = await this._getDetailUrl(detail)
                        if (detailUrl && detailUrl === expectedUrl) break
                        await this._page.waitForTimeout(60)
                    }
                }
                if (!href) {
                    const detailUrl = await this._getDetailUrl(detail)
                    if (detailUrl) {
                        href = detailUrl
                    }
                }
                if (!href) continue

                const url = normalizeLinkedinUrl(href)
                let promoted = this._hasPromotedLabel(cardText)
                let applicants = parseApplicantsCount(cardText)
                let postedAt = await this._getPostedAtFromCard(card, cardText)
                let easyApply = easyApplyOnly || this._hasEasyApplyLabel(cardText)
                if (includeDetails && (applicants === null || !promoted || !easyApply || !postedAt)) {
                    const detailTextSelectors = SCRAP_SELECTORS.jobDetailText.join(', ')
                    let detailText = await this._safeInnerText(detail)
                    if (!detailText) {
                        detailText = await this._safeInnerText(this._page.locator(detailTextSelectors))
                    }
                    if (detailText) {
                        if (applicants === null) {
                            applicants = parseApplicantsCount(detailText)
                            if (applicants === null) {
                                applicants = await this._getApplicantsFromDetail()
                            }
                        }
                        if (!promoted) {
                            promoted = this._hasPromotedLabel(detailText)
                        }
                        if (!easyApply) {
                            easyApply = this._hasEasyApplyLabel(detailText)
                        }
                        if (!postedAt) {
                            postedAt = (await this._getPostedAtFromDetail()) || this._extractPostedAtFromText(detailText)
                        }
                    } else if (applicants === null) {
                        applicants = await this._getApplicantsFromDetail()
                    }
                }
                this._logTiming('card:parsed', { index: i + 1, ms: Date.now() - cardStart })

                results.push({
                    title,
                    company,
                    location,
                    url,
                    promoted,
                    easyApply,
                    applicants,
                    postedAt
                })
                this._logTiming('card:done', { index: i + 1, ms: Date.now() - cardStart })
            }
            this._logTiming('cards:done', { total: results.length, ms: Date.now() - batchStart })
    
            return results
        }
    
        private _logTiming(action: string, data?: Record<string, unknown>) {
            if (!this._enableTimingLogs) return
            const now = new Date()
            const timestamp = now
                .toTimeString()
                .split(' ')[0]
                .concat(`.${String(now.getMilliseconds()).padStart(3, '0')}`)
            const payload = data ? ` | ${JSON.stringify(data)}` : ''
            logger.info(`[jobs ${timestamp}] ${action}${payload}`)
        }
    
        private async _safeInnerText(locator: Locator) {
            try {
                const target = locator.first()
                const text = (await target.innerText({ timeout: 500 }).catch(() => ''))?.trim()
                return text || ''
            } catch {
                return ''
            }
        }

        private async _safeText(locator: Locator) {
            try {
                const target = locator.first()
                const text = (await target.innerText({ timeout: 500 }).catch(() => ''))?.trim()
                if (text) return text
                const aria = (await target.getAttribute('aria-label', { timeout: 500 }).catch(() => ''))?.trim()
                if (aria) return aria
                const content = (await target.textContent({ timeout: 500 }).catch(() => ''))?.trim()
                return content || ''
            } catch {
                return ''
            }
        }

        private async _clickJobCard(card: Locator) {
            const link = card.locator(SCRAP_SELECTORS.jobLink).first()
            try {
                if ((await link.count().catch(() => 0)) > 0) {
                    await link.click({ timeout: 250, force: true })
                    return true
                }
            } catch {
                // fallback to card click below
            }
            try {
                await card.click({ timeout: 250, force: true })
                return true
            } catch {
                try {
                    await card.scrollIntoViewIfNeeded()
                    await card.click({ timeout: 500, force: true })
                    return true
                } catch {
                    return false
                }
                return false
            }
        }

        private async _getDetailTextFromCard(card: Locator, expectedTitle?: string, expectedUrl?: string, skipClick = false) {
            const detail = this._page.locator(SCRAP_SELECTORS.jobDetailContainer).first()
            if ((await detail.count().catch(() => 0)) === 0) return ''
            const expected = expectedTitle ? normalizeTextAlphaNum(expectedTitle) : ''
            const before = await this._safeInnerText(detail)
            const beforeUrl = expectedUrl ? await this._getDetailUrl(detail) : ''
            const clicked = skipClick ? true : await this._clickJobCard(card)
            if (!clicked) return ''
            await detail.waitFor({ state: 'visible', timeout: 400 }).catch(() => undefined)
            let parts = ''
            const startedAt = Date.now()
            while (Date.now() - startedAt < 1_000) {
                await this._page.waitForTimeout(80)
                if (expectedUrl) {
                    const detailUrl = await this._getDetailUrl(detail)
                    if (detailUrl && detailUrl === expectedUrl) {
                        parts = await this._safeInnerText(detail)
                        if (parts) break
                    }
                    if (detailUrl && beforeUrl && detailUrl !== beforeUrl) {
                        parts = await this._safeInnerText(detail)
                        if (parts) break
                    }
                }
                parts = await this._safeInnerText(detail)
                if (!parts) continue
                if (!expected) break
                const normalized = normalizeTextAlphaNum(parts)
                if (normalized.includes(expected) || parts !== before) break
            }
            if (!parts) {
                parts = await this._safeInnerText(detail)
            }
            if (parts) return parts
            const detailTextSelectors = SCRAP_SELECTORS.jobDetailText.join(', ')
            const detailText = await this._safeInnerText(this._page.locator(detailTextSelectors))
            return detailText
        }

        private async _getDetailUrl(detail: Locator) {
            const selectors = SCRAP_SELECTORS.jobDetailLink.join(', ')
            const href = await detail.locator(selectors).first().getAttribute('href', { timeout: 500 }).catch(() => null)
            if (!href) return ''
            return normalizeLinkedinUrl(href)
        }

        private async _getPostedAtFromCard(card: Locator, fallbackText?: string) {
            const selectors = SCRAP_SELECTORS.jobPostedTime.join(', ')
            const text = await this._safeText(card.locator(selectors))
            if (text) {
                const match = this._extractPostedAtFromText(text)
                if (match) return match
            }
            if (fallbackText) {
                return this._extractPostedAtFromText(fallbackText)
            }
            return null
        }

        private async _getPostedAtFromDetail() {
            const selectors = SCRAP_SELECTORS.jobDetailPostedTime.join(', ')
            const text = await this._safeText(this._page.locator(selectors))
            if (text) {
                const match = this._extractPostedAtFromText(text)
                if (match) return match
            }
            return null
        }

        private async _getApplicantsFromDetail() {
            const selectors = SCRAP_SELECTORS.jobDetailApplicants.join(', ')
            const locator = this._page.locator(selectors)
            const count = await locator.count().catch(() => 0)
            if (count === 0) return null
            for (let i = 0; i < count; i++) {
                const text = await this._safeText(locator.nth(i))
                if (!text) continue
                const parsed = parseApplicantsCount(text)
                if (parsed !== null) return parsed
            }
            const combined = await locator.allTextContents().catch(() => [])
            const merged = combined.map((item) => item.trim()).filter(Boolean).join(' ')
            if (!merged) return null
            return parseApplicantsCount(merged)
        }
    
        filterResults(
            jobs: EasyApplyJobResult[],
            options: {
                onlyNonPromoted: boolean
                maxApplicants?: number
                easyApplyOnly: boolean
                includeUnknownApplicants?: boolean
                postedWithinDays?: number
            }
        ) {
            return jobs.filter((job) => {
                if (options.onlyNonPromoted && job.promoted) return false
                if (options.easyApplyOnly && !job.easyApply) return false
                if (options.maxApplicants !== undefined) {
                    if (job.applicants === null) {
                        return options.includeUnknownApplicants === true
                    }
                    if (job.applicants > options.maxApplicants) return false
                }
                if (options.postedWithinDays !== undefined) {
                    if (!this.isPostedWithinDays(job.postedAt, options.postedWithinDays)) return false
                }
                return true
            })
        }

        isPostedWithinDays(postedAt: string | null | undefined, maxDays: number) {
            if (!postedAt) return false
            const ageMinutes = parsePostedAgeMinutes(postedAt)
            if (ageMinutes === null) return false
            return ageMinutes <= maxDays * 24 * 60
        }
        private _extractPostedAtFromText(text: string) {
            if (!text) return null
            const parts = text
                .split(/[\n•·|]/g)
                .map((part) => part.trim())
                .filter(Boolean)
            const patterns = [
                /\b(?:ha|há)\s*\d+\s*(?:minutos?|horas?|dias?|semanas?|meses?|m[eê]s|anos?)\b/i,
                /\b\d+\s*(?:minutes?|hours?|days?|weeks?|months?|years?)\s*ago\b/i,
                /\brepostad[oa]\b.*$/i,
                /\breposted\b.*$/i,
                /\bpublicad[oa]\b.*$/i
            ]
            for (const part of parts) {
                for (const pattern of patterns) {
                    if (pattern.test(part)) return part
                }
            }
            return null
        }
    
        private _hasPromotedLabel(text: string) {
            const normalized = normalizeTextAlphaNum(text)
            if (!normalized) return false
            return /(promoted|promovida|promovido|patrocinada|patrocinado|sponsored)/.test(normalized)
        }
    
        private _hasEasyApplyLabel(text: string) {
            const normalized = normalizeTextAlphaNum(text)
            if (!normalized) return false
            return /(easy apply|candidatura simplificada|candidatar[- ]se facilmente|candidatura facil|aplicar facilmente)/.test(normalized)
        }
    
}
