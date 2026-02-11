
import { Locator, Page } from "playwright";
import { LinkedinCoreFeatures } from "../../linkedin-core";
import { DiscordClient } from "../../../shared/discord/discord-client";
import { SCRAP_SELECTORS } from "../../../shared/constants/scrap";


export type EasyApplyJobResult = {
    title: string
    company: string
    location: string
    url: string
    promoted: boolean
    easyApply: boolean
    applicants: number | null
    postedAt?: string | null
}

export type SearchJobTagOptions = {
    location?: string
    geoId?: string | number
    maxPages?: number
    maxResults?: number
    easyApplyOnly?: boolean
    onlyNonPromoted?: boolean
    maxApplicants?: number
    includeUnknownApplicants?: boolean
    includeDetails?: boolean
    postedWithinDays?: number
}


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
            const params = new URLSearchParams()
            params.set('keywords', tag)
            if (easyApplyOnly) {
                params.set('f_AL', 'true')
            }
            if (postedWithinDays !== undefined && postedWithinDays > 0) {
                const seconds = Math.round(postedWithinDays * 24 * 60 * 60)
                params.set('f_TPR', `r${seconds}`)
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
                const expectedUrl = href ? this._normalizeJobUrl(href) : ''
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

                const url = this._normalizeJobUrl(href)
                let promoted = this._hasPromotedLabel(cardText)
                let applicants = this._parseApplicantsCount(cardText)
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
                            applicants = this._parseApplicantsCount(detailText)
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

        private _logTiming(action: string, data?: Record<string, unknown>) {
            if (!this._enableTimingLogs) return
            const now = new Date()
            const timestamp = now
                .toTimeString()
                .split(' ')[0]
                .concat(`.${String(now.getMilliseconds()).padStart(3, '0')}`)
            const payload = data ? ` | ${JSON.stringify(data)}` : ''
            console.log(`[jobs ${timestamp}] ${action}${payload}`)
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
            const expected = expectedTitle ? this._normalizeText(expectedTitle) : ''
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
                const normalized = this._normalizeText(parts)
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
            return this._normalizeJobUrl(href)
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
                const parsed = this._parseApplicantsCount(text)
                if (parsed !== null) return parsed
            }
            const combined = await locator.allTextContents().catch(() => [])
            const merged = combined.map((item) => item.trim()).filter(Boolean).join(' ')
            if (!merged) return null
            return this._parseApplicantsCount(merged)
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
            const ageMinutes = this._parsePostedAgeMinutes(postedAt)
            if (ageMinutes === null) return false
            return ageMinutes <= maxDays * 24 * 60
        }
    
        private _parseApplicantsCount(text: string) {
            const normalized = this._normalizeText(text)
            if (!normalized) return null
            const keyword = '(?:applicants?|applications?|candidatos?|candidaturas?|aplicantes?)'
            const prefixWords =
                '(?:total|totais|received|recebidas?|recebido|ate|até|agora|no\\s*total|so\\s*far)'
            const patterns: Array<{ regex: RegExp; over?: boolean }> = [
                {
                    regex:
                        new RegExp(`(?:over|more than|mais de)\\s*([\\d.,]+)\\s*${keyword}`),
                    over: true
                },
                {
                    regex:
                        new RegExp(`([\\d.,]+)\\s*\\+\\s*${keyword}`),
                    over: true
                },
                {
                    regex: new RegExp(
                        `${keyword}\\s*(?:[:\\-]|\\s)*(?:${prefixWords}\\s*){0,3}([\\d.,]+)\\s*\\+`
                    ),
                    over: true
                },
                { regex: new RegExp(`([\\d.,]+)\\s*${keyword}`) },
                {
                    regex: new RegExp(
                        `${keyword}\\s*(?:[:\\-]|\\s)*(?:${prefixWords}\\s*){0,3}([\\d.,]+)`
                    )
                },
                { regex: /be among the first\s*([\d.,]+)/ },
                { regex: /seja um dos primeiros\s*([\d.,]+)/ }
            ]
            for (const pattern of patterns) {
                const match = normalized.match(pattern.regex)
                if (match) {
                    const raw = match[1].replace(/[^\d]/g, '')
                    if (!raw) continue
                    const value = Number(raw)
                    if (Number.isNaN(value)) return null
                    return pattern.over ? value + 1 : value
                }
            }
            return null
        }

        private _parsePostedAgeMinutes(text: string) {
            const normalized = this._normalizeText(text)
            if (!normalized) return null
            const cleaned = normalized
                .replace(/\b(reposted|repostado|repostada|publicado|publicada|publicado ha|publicada ha)\b/g, '')
                .trim()
            if (!cleaned) return null
            if (/(just now|agora mesmo|neste momento)/.test(cleaned)) return 0

            const numberMatch = cleaned.match(/(\d+)/)
            const wordOne = cleaned.match(/\b(um|uma|one|a)\b/)
            const amount = numberMatch ? Number(numberMatch[1]) : wordOne ? 1 : null
            if (!amount || Number.isNaN(amount)) return null

            const unit =
                cleaned.match(/\b(minuto|minutos|minute|minutes|min)\b/)?.[1] ||
                cleaned.match(/\b(hora|horas|hour|hours|hr|hrs)\b/)?.[1] ||
                cleaned.match(/\b(dia|dias|day|days)\b/)?.[1] ||
                cleaned.match(/\b(semana|semanas|week|weeks|sem)\b/)?.[1] ||
                cleaned.match(/\b(mes|meses|month|months)\b/)?.[1] ||
                cleaned.match(/\b(ano|anos|year|years)\b/)?.[1]

            if (!unit) return null
            if (/min/.test(unit)) return amount
            if (/hora|hour|hr/.test(unit)) return amount * 60
            if (/dia|day/.test(unit)) return amount * 60 * 24
            if (/semana|week|sem/.test(unit)) return amount * 60 * 24 * 7
            if (/mes|month/.test(unit)) return amount * 60 * 24 * 30
            if (/ano|year/.test(unit)) return amount * 60 * 24 * 365
            return null
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
