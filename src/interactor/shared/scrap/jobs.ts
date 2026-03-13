import { Frame, Locator, Page } from "playwright";
import { SCRAP_SELECTORS } from "../constants/scrap";
import { logger } from "../services/logger";
import type { EasyApplyJobResult, SearchJobTagOptions } from "../interface/scrap/jobs.types";
import { buildLinkedinJobSearchUrl, normalizeLinkedinUrl } from "../utils/linkedin-url";
import { normalizeTextAlphaNum, normalizeWhitespace } from "../utils/normalize";
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
            postedWithinDays?: number,
            workplaceTypes?: string[]
        ) {
            return buildLinkedinJobSearchUrl({
                tag,
                location,
                start,
                geoId,
                easyApplyOnly,
                postedWithinDays,
                workplaceTypes
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
                let title = this._cleanValue(await this._safeText(link.first()))
                let company = this._cleanValue(await this._safeInnerText(card.locator(SCRAP_SELECTORS.jobCompany)))
                let location = this._cleanValue(await this._safeInnerText(card.locator(SCRAP_SELECTORS.jobLocation)))
                const cardText = await this._safeInnerText(card)
                if (title && company && this._isSimilarValue(company, title)) {
                    company = ''
                }
                if (location && (this._isSimilarValue(location, title) || (company && this._isSimilarValue(location, company)))) {
                    location = ''
                }
                if ((!title || !company || !location) && cardText) {
                    const cardMeta = this._extractMetaCandidates(cardText, title ? [title] : [])
                    let metaIndex = 0
                    if (!title && cardMeta[metaIndex]) {
                        title = cardMeta[metaIndex]
                        metaIndex += 1
                    }
                    if (!company && cardMeta[metaIndex]) {
                        company = cardMeta[metaIndex]
                        metaIndex += 1
                    }
                    if (!location && cardMeta[metaIndex]) {
                        location = cardMeta[metaIndex]
                    }
                }
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
                if (includeDetails && (applicants === null || !promoted || !easyApply || !postedAt || !company || !location)) {
                    const detailTextSelectors = SCRAP_SELECTORS.jobDetailText.join(', ')
                    let detailText = await this._safeInnerText(detail)
                    if (!detailText) {
                        detailText = await this._safeInnerText(this._page.locator(detailTextSelectors))
                    }

                    if (!company || !location) {
                        const detailCompany = this._cleanValue(await this._safeText(
                            detail.locator(SCRAP_SELECTORS.jobDetailCompany.join(', '))
                        ))
                        if (
                            !company &&
                            detailCompany &&
                            !this._isMetaLine(detailCompany) &&
                            !this._isSimilarValue(detailCompany, title)
                        ) {
                            company = detailCompany
                        }
                        const detailLocation = this._cleanValue(await this._safeText(
                            detail.locator(SCRAP_SELECTORS.jobDetailLocation.join(', '))
                        ))
                        if (
                            !location &&
                            detailLocation &&
                            !this._isMetaLine(detailLocation) &&
                            !this._isSimilarValue(detailLocation, title) &&
                            (!company || !this._isSimilarValue(detailLocation, company))
                        ) {
                            location = detailLocation
                        }
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
                        if (!company || !location) {
                            const detailMeta = this._extractMetaCandidates(
                                detailText,
                                [title, company, location].filter(Boolean) as string[]
                            )
                            let metaIndex = 0
                            if (!company && detailMeta[metaIndex]) {
                                company = detailMeta[metaIndex]
                                metaIndex += 1
                            }
                            if (!location && detailMeta[metaIndex]) {
                                location = detailMeta[metaIndex]
                            }
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
            if (count > 0) {
                for (let i = 0; i < count; i++) {
                    const text = await this._safeText(locator.nth(i))
                    if (!text) continue
                    const parsed = parseApplicantsCount(text)
                    if (parsed !== null) return parsed
                }
                const combined = await locator.allTextContents().catch(() => [])
                const merged = combined.map((item) => item.trim()).filter(Boolean).join(' ')
                if (merged) {
                    const parsed = parseApplicantsCount(merged)
                    if (parsed !== null) return parsed
                }
            }

            const insights = await this._getApplicantsFromInsightPanel()
            if (insights !== null) return insights
            return null
        }

        private async _getApplicantsFromInsightPanel() {
            const extractFromFrame = async (frame: Frame) => {
                try {
                    const value = await frame.evaluate(() => {
                        const normalize = (input: string) =>
                            input
                                .normalize('NFD')
                                .replace(/[\u0300-\u036f]/g, '')
                                .toLowerCase()

                        const headingMatchers = [
                            'applicants for this job',
                            'see how you compare to other applicants',
                            'candidatos para esta vaga',
                            'candidaturas para esta vaga',
                            'candidatos para este cargo',
                            'candidaturas para este cargo',
                            'veja como voce se compara a outros candidatos',
                            'veja como voce se compara a outros aplicantes'
                        ]

                        const isExactLabel = (text: string) => {
                            const normalized = normalize(text)
                            return (
                                normalized === 'applicants' ||
                                normalized === 'candidatos' ||
                                normalized === 'candidaturas' ||
                                normalized === 'aplicantes'
                            )
                        }

                        const extractDigits = (raw: string) => {
                            if (!raw) return ''
                            if (raw.includes('%')) return ''
                            const digits = raw.replace(/[^\d]/g, '')
                            return digits
                        }

                        const nodes = Array.from(
                            document.querySelectorAll('h1, h2, h3, h4, h5, p, span, strong, div')
                        )

                        const findInScope = (scope: Element) => {
                            const labels = Array.from(scope.querySelectorAll('p, span, strong, div'))
                            for (const label of labels) {
                                const text = label.textContent || ''
                                if (!isExactLabel(text)) continue

                                const prev = label.previousElementSibling
                                if (prev) {
                                    const digits = extractDigits(prev.textContent || '')
                                    if (digits) return digits
                                }

                                const parent = label.parentElement
                                if (parent) {
                                    const siblings = Array.from(parent.children)
                                    for (const sibling of siblings) {
                                        if (sibling === label) continue
                                        const digits = extractDigits(sibling.textContent || '')
                                        if (digits) return digits
                                    }
                                }
                            }
                            return ''
                        }

                        for (const node of nodes) {
                            const raw = node.textContent || ''
                            if (!raw) continue
                            const normalized = normalize(raw)
                            if (!headingMatchers.some((match) => normalized.includes(match))) continue

                            const scope =
                                node.closest('section, article, div, tbody') ||
                                node.parentElement
                            if (!scope) continue

                            const digits = findInScope(scope)
                            if (digits) return digits
                        }

                        return ''
                    })

                    if (!value) return null
                    const digits = value.replace(/[^\d]/g, '')
                    if (!digits) return null
                    const parsed = Number(digits)
                    return Number.isNaN(parsed) ? null : parsed
                } catch {
                    return null
                }
            }

            const mainValue = await extractFromFrame(this._page.mainFrame())
            if (mainValue !== null) return mainValue

            for (const frame of this._page.frames()) {
                if (frame === this._page.mainFrame()) continue
                const value = await extractFromFrame(frame)
                if (value !== null) return value
            }

            return null
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

        private _extractMetaCandidates(text: string, ignore: string[] = []) {
            if (!text) return []
            const ignored = new Set(
                ignore
                    .map((value) => normalizeTextAlphaNum(value))
                    .filter((value) => value)
            )
            const parts = text
                .split(/[\n•·|]/g)
                .map((part) => part.trim())
                .filter(Boolean)
            const results: string[] = []
            for (const part of parts) {
                const cleaned = this._cleanValue(part)
                if (!cleaned) continue
                const normalized = normalizeTextAlphaNum(cleaned)
                if (!normalized) continue
                if (this._matchesIgnored(normalized, ignored)) continue
                if (this._isMetaLine(cleaned)) continue
                if (results.some((existing) => normalizeTextAlphaNum(existing) === normalized)) continue
                results.push(cleaned)
            }
            return results
        }

        private _isMetaLine(text: string) {
            if (!text) return false
            if (this._extractPostedAtFromText(text)) return true
            if (parseApplicantsCount(text) !== null) return true
            if (this._hasEasyApplyLabel(text)) return true
            if (this._hasPromotedLabel(text)) return true
            return false
        }

        private _matchesIgnored(normalized: string, ignored: Set<string>) {
            if (!normalized || ignored.size === 0) return false
            for (const value of ignored) {
                if (!value) continue
                if (normalized === value) return true
                if (normalized.includes(value) || value.includes(normalized)) return true
            }
            return false
        }

        private _isSimilarValue(a: string, b: string) {
            if (!a || !b) return false
            const na = normalizeTextAlphaNum(a)
            const nb = normalizeTextAlphaNum(b)
            if (!na || !nb) return false
            if (na === nb) return true
            if (na.includes(nb) || nb.includes(na)) return true
            return false
        }

        private _cleanValue(value: string) {
            if (!value) return ''
            const cleaned = normalizeWhitespace(value)
            if (!cleaned) return ''
            const stripped = cleaned
                .replace(/\b(with verification|com verificação|verified|verificado)\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim()
            return this._dedupeRepeatedPhrase(stripped)
        }

        private _dedupeRepeatedPhrase(value: string) {
            if (!value) return ''
            const words = value.split(' ').filter(Boolean)
            if (words.length < 2 || words.length % 2 !== 0) return value
            const mid = words.length / 2
            const first = words.slice(0, mid).join(' ')
            const second = words.slice(mid).join(' ')
            if (normalizeTextAlphaNum(first) === normalizeTextAlphaNum(second)) {
                return first
            }
            return value
        }

}
