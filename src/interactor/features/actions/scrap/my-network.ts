import { Locator, Page } from "playwright"
import { LinkedinCoreFeatures } from "../../linkedin-core"
import { rankWordsFromLines, type WordRanking } from "../../../shared/utils/word-ranking"

export type MyNetworkScrapResult = {
    subtitles: string[]
    ranking: WordRanking[]
    connectionsCount?: number
}

export type VisitConnectionsOptions = {
    maxToVisit?: number
    delayMs?: number
    maxScrollRounds?: number
    maxIdleRounds?: number
}

export class MyNetworkScrap {
    private readonly _page: Page
    private readonly _navigator: LinkedinCoreFeatures

    constructor(page: Page, navigator: LinkedinCoreFeatures) {
        this._page = page
        this._navigator = navigator
    }

    async myConnections(): Promise<MyNetworkScrapResult> {
        const url = 'https://www.linkedin.com/mynetwork/invite-connect/connections/'
        await this._navigator.goToLinkedinURL(url)
        await this._page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
        await this._page.waitForTimeout(1200)

        await this._ensureConnectionsView()
        await this._waitForConnections()
        const api = await this._fetchConnectionsFromApi().catch(() => null)
        if (api && api.subtitles.length) {
            const ranking = rankWordsFromLines(api.subtitles)
            if (!ranking.length) {
                console.log('[network] api: sem keywords detectadas')
            }
            console.log(`[network] api: conexões=${api.total ?? api.subtitles.length}, subtitulos=${api.subtitles.length}`)
            return { subtitles: api.subtitles, ranking, connectionsCount: api.total }
        }

        const connectionsCount = await this._extractConnectionsCount()
        if (typeof connectionsCount === 'number') {
            console.log(`[network] conexões totais detectadas: ${connectionsCount}`)
        }
        const cardsCount = await this._connectionCardLocator().count().catch(() => 0)
        console.log(`[network] cards detectados: ${cardsCount}`)
        const { subtitles } = await this._collectSubtitlesAcrossPages({
            maxRounds: 60,
            maxIdleRounds: 4,
            targetCount: connectionsCount
        })

        let ranking = rankWordsFromLines(subtitles)

        if (!ranking.length) {
            const fallbackLines = await this._extractLines(this._page.locator('main'))
            const filtered = fallbackLines.filter((line) => !this._isNoiseLine(line))
            if (filtered.length) {
                subtitles.splice(0, subtitles.length, ...filtered)
                ranking = rankWordsFromLines(filtered)
                console.log(`[network] fallback usado (main text): ${filtered.length} linhas`)
            }
        }

        if (!subtitles.length) {
            console.log('[network] nenhum subtitulo encontrado na rede')
        } else if (!ranking.length) {
            console.log(`[network] subtitulos coletados: ${subtitles.length}, ranking vazio`)
        } else {
            const preview = ranking.slice(0, 5).map((item) => `${item.word}(${item.count})`).join(', ')
            console.log(`[network] ranking preview: ${preview}`)
        }

        return { subtitles, ranking, connectionsCount }
    }

    async visitConnectionProfiles(options: VisitConnectionsOptions = {}): Promise<string[]> {
        const url = 'https://www.linkedin.com/mynetwork/invite-connect/connections/'
        const delayMs = options.delayMs ?? 900
        const maxScrollRounds = options.maxScrollRounds ?? 40
        const maxIdleRounds = options.maxIdleRounds ?? 3

        await this._navigator.goToLinkedinURL(url)
        await this._page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
        await this._page.waitForTimeout(1200)

        await this._ensureConnectionsView()
        await this._waitForConnections()

        const maxToVisit = options.maxToVisit ?? Number.MAX_SAFE_INTEGER
        const seen = new Set<string>()
        let idleRounds = 0

        for (let round = 0; round < maxScrollRounds; round++) {
            const roundUrls = await this._collectConnectionProfileUrls()
            const before = seen.size
            for (const url of roundUrls) seen.add(url)
            const after = seen.size

            console.log(`[network] rodada ${round + 1}: ${after} perfis únicos`)

            if (after >= maxToVisit) break
            if (after === before) {
                idleRounds++
            } else {
                idleRounds = 0
            }

            const clickedNext = await this._maybeClickNextPage()
            if (clickedNext) {
                console.log('[network] paginação: avançando para próxima página')
                await this._page.waitForTimeout(1200)
                continue
            }

            const container = await this._getScrollContainer()
            if (container) {
                await this._scrollContainer(container)
            } else {
                await this._page.mouse.wheel(0, 1600)
            }
            await this._maybeClickShowMore()
            await this._page.waitForTimeout(900)

            if (idleRounds >= maxIdleRounds) break
        }

        const urls = Array.from(seen)
        if (!urls.length) {
            console.log('[network] nenhum perfil encontrado para visitar')
            return []
        }

        const toVisit = urls.slice(0, Math.max(0, maxToVisit))
        console.log(`[network] perfis para visitar: ${toVisit.length}`)

        for (const [index, profileUrl] of toVisit.entries()) {
            console.log(`[network] visitando ${index + 1}/${toVisit.length}: ${profileUrl}`)
            await this._navigator.goToLinkedinURL(profileUrl).catch((error) => {
                console.warn(`[network] falha ao abrir perfil: ${profileUrl}`, error)
            })
            if (delayMs > 0) {
                await this._page.waitForTimeout(delayMs)
            }
        }

        return toVisit
    }

    private _connectionCardLocator() {
        const selectors = this._connectionSelectors()
        return this._page.locator(selectors.join(', '))
    }

    private _connectionSelectors() {
        return [
            'li.mn-connection-card',
            'li.mn-connection-card__item',
            'li.mn-connection-card__list-item',
            'li.mn-connection-card__details',
            'li.reusable-search__result-container',
            'li.reusable-search__result-container[data-chameleon-result-urn]',
            'li.reusable-search__result-container[data-urn]',
            'li.entity-result',
            'li.artdeco-list__item',
            'li.mynetwork-contacts__card',
            'div.mn-connection-card',
            'div.reusable-search__result-container',
            'div.entity-result',
            'div.scaffold-finite-scroll__content li',
            'div.scaffold-finite-scroll__content > div',
            'main li:has(a[href*="/in/"])'
        ]
    }

    private async _ensureConnectionsView() {
        const cards = this._connectionCardLocator()
        if ((await cards.count().catch(() => 0)) > 0) return

        const connectionsLink = this._page
            .locator('a[href*="mynetwork/invite-connect/connections"]')
            .first()
        if ((await connectionsLink.count().catch(() => 0)) > 0) {
            await connectionsLink.click().catch(() => undefined)
            await this._page.waitForTimeout(800)
            return
        }

        const fallback = this._page
            .locator('a:has-text("Connections"), a:has-text("Conexões")')
            .first()
        if ((await fallback.count().catch(() => 0)) > 0) {
            await fallback.click().catch(() => undefined)
            await this._page.waitForTimeout(800)
        }

        if ((await cards.count().catch(() => 0)) > 0) return

        const fallbackUrls = [
            'https://www.linkedin.com/mynetwork/network-manager/people/',
            'https://www.linkedin.com/mynetwork/invite-connect/connections/'
        ]
        for (const url of fallbackUrls) {
            await this._navigator.goToLinkedinURL(url).catch(() => undefined)
            await this._page.waitForTimeout(1200)
            if ((await cards.count().catch(() => 0)) > 0) return
        }
    }

    private async _waitForConnections() {
        const selector = this._connectionSelectors().join(', ')
        await this._page.waitForSelector(selector, { state: 'attached', timeout: 20_000 }).catch(() => undefined)
    }

    private async _scrollConnectionsList(maxRounds = 8) {
        let previousCount = 0
        for (let round = 0; round < maxRounds; round++) {
            const count = await this._connectionCardLocator().count().catch(() => 0)
            if (round > 0 && count <= previousCount) break
            previousCount = count

            const container = await this._getScrollContainer()
            if (container) {
                await this._scrollContainer(container)
            } else {
                await this._page.mouse.wheel(0, 1600)
            }
            await this._page.waitForTimeout(900)
        }
    }

    private async _getScrollContainer() {
        const selectors = [
            'div.scaffold-layout__main',
            'div.scaffold-layout__content',
            'div.scaffold-layout__list',
            'div.scaffold-layout__list-container',
            'div.scaffold-layout__list-detail',
            'div.scaffold-finite-scroll__content',
            'div.mn-connection-list',
            'div.mynetwork-contacts',
            'main'
        ]
        for (const selector of selectors) {
            const node = this._page.locator(selector).first()
            if (!node || (await node.count().catch(() => 0)) === 0) continue
            const hasConnections = await node
                .evaluate((el) => {
                    return Boolean(
                        el.querySelector(
                            'a[href*="/in/"], li.mn-connection-card, li.entity-result, li.reusable-search__result-container'
                        )
                    )
                })
                .catch(() => false)
            if (!hasConnections) continue
            const isScrollable = await node
                .evaluate((el) => {
                    const scrollable = el.scrollHeight > el.clientHeight + 10
                    return scrollable
                })
                .catch(() => false)
            if (isScrollable) return node
        }
        return null
    }

    private async _scrollContainer(container: Locator) {
        try {
            const scrolled = await container.evaluate((el) => {
                const before = el.scrollTop
                const max = el.scrollHeight - el.clientHeight
                if (max <= 0) return false
                el.scrollTop = Math.min(el.scrollTop + el.clientHeight * 0.9, el.scrollHeight)
                return el.scrollTop !== before
            })
            if (!scrolled) {
                await this._page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9)).catch(() => undefined)
                await this._page.mouse.wheel(0, 1600)
            }
        } catch {
            await this._page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9)).catch(() => undefined)
            await this._page.mouse.wheel(0, 1600)
        }
    }

    private async _maybeClickShowMore() {
        const button = this._page
            .locator(
                [
                    'button:has-text("Mostrar mais")',
                    'button:has-text("Mostrar mais resultados")',
                    'button:has-text("Show more")',
                    'button:has-text("Show more results")',
                    'button:has-text("Carregar mais")',
                    'a:has-text("Mostrar mais")',
                    'a:has-text("Show more")'
                ].join(',')
            )
            .first()
        if ((await button.count().catch(() => 0)) === 0) return false
        try {
            await button.click()
            return true
        } catch {
            return false
        }
    }

    private async _maybeClickNextPage(beforeKey?: string | null) {
        await this._page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined)
        await this._page.waitForTimeout(300)

        const pagination = this._page
            .locator(
                [
                    'nav[aria-label*="Pagination"]',
                    'nav[aria-label*="Paginação"]',
                    '.artdeco-pagination',
                    '.artdeco-pagination__pages',
                    'nav[role="navigation"]'
                ].join(', ')
            )
            .first()

        let next = pagination
            .locator(
                [
                    'button.artdeco-pagination__button--next',
                    'a.artdeco-pagination__button--next',
                    'button[aria-label*="Next"]',
                    'button[aria-label*="Próxima"]',
                    'button[aria-label*="Proxima"]',
                    'a[aria-label*="Next"]',
                    'a[aria-label*="Próxima"]',
                    'a[aria-label*="Proxima"]',
                    'button:has-text("Next")',
                    'button:has-text("Próxima")',
                    'button:has-text("Proxima")',
                    'a:has-text("Next")',
                    'a:has-text("Próxima")',
                    'a:has-text("Proxima")'
                ].join(', ')
            )
            .first()

        if ((await next.count().catch(() => 0)) === 0) {
            const active = pagination.locator('li.artdeco-pagination__indicator--active').first()
            if ((await active.count().catch(() => 0)) > 0) {
                next = active.locator('xpath=following-sibling::li[1]//button | following-sibling::li[1]//a').first()
            }
        }

        if ((await next.count().catch(() => 0)) === 0) {
            next = this._page
                .locator(
                    [
                        'button.artdeco-pagination__button--next',
                        'a.artdeco-pagination__button--next',
                        'button[aria-label*="Next"]',
                        'button[aria-label*="Próxima"]',
                        'button[aria-label*="Proxima"]',
                        'a[aria-label*="Next"]',
                        'a[aria-label*="Próxima"]',
                        'a[aria-label*="Proxima"]'
                    ].join(', ')
                )
                .first()
        }

        if ((await next.count().catch(() => 0)) === 0) return false

        const isDisabled = await next
            .evaluate((el) => {
                const aria = el.getAttribute('aria-disabled')
                const disabledAttr = (el as HTMLButtonElement).disabled
                const classList = el.className || ''
                return aria === 'true' || disabledAttr || /disabled/.test(classList)
            })
            .catch(() => true)
        if (isDisabled) return false

        try {
            await next.scrollIntoViewIfNeeded().catch(() => undefined)
            await next.click()
            if (beforeKey) {
                await this._waitForFirstConnectionChange(beforeKey)
            }
            return true
        } catch {
            return false
        }
    }

    private async _getFirstConnectionKey() {
        const cards = this._connectionCardLocator()
        const first = cards.first()
        if ((await first.count().catch(() => 0)) === 0) return null
        const url = await this._extractProfileUrl(first)
        if (url) return url
        const subtitle = await this._extractSubtitle(first)
        return subtitle || null
    }

    private async _waitForFirstConnectionChange(beforeKey: string) {
        try {
            await this._page.waitForFunction(
                (key) => {
                    const firstLink = document.querySelector('main a[href*="/in/"]')
                    if (firstLink && (firstLink as HTMLAnchorElement).href) {
                        return (firstLink as HTMLAnchorElement).href !== key
                    }
                    const firstCard = document.querySelector('main li, main div')
                    const text = firstCard ? (firstCard.textContent || '').trim() : ''
                    return text && text !== key
                },
                beforeKey,
                { timeout: 8000 }
            )
        } catch {
            // ignore
        }
    }

    private async _getLastConnectionKey() {
        const cards = this._connectionCardLocator()
        const count = await cards.count().catch(() => 0)
        if (count === 0) return null
        const last = cards.nth(Math.max(0, count - 1))
        const url = await this._extractProfileUrl(last)
        if (url) return url
        const subtitle = await this._extractSubtitle(last)
        return subtitle || null
    }

    private async _waitForConnectionListChange(beforeKey: string) {
        try {
            await this._page.waitForFunction(
                (key) => {
                    const links = document.querySelectorAll('main a[href*="/in/"]')
                    if (links.length > 0) {
                        const lastLink = links[links.length - 1] as HTMLAnchorElement
                        if (lastLink?.href) return lastLink.href !== key
                    }
                    const cards = document.querySelectorAll('main li, main div')
                    if (cards.length === 0) return false
                    const last = cards[cards.length - 1]
                    const text = (last.textContent || '').trim()
                    return text && text !== key
                },
                beforeKey,
                { timeout: 8000 }
            )
        } catch {
            // ignore
        }
    }

    private async _maybeGoToNextPageUrl(beforeKey?: string | null) {
        try {
            const current = this._page.url()
            const url = new URL(current)
            const params = url.searchParams
            const cardsCount = await this._connectionCardLocator().count().catch(() => 0)
            const pageSize = cardsCount > 0 ? cardsCount : 20

            const pageParam = params.get('page')
            const pageNumParam = params.get('pageNum')
            const startParam = params.get('start')

            if (pageParam && !Number.isNaN(Number(pageParam))) {
                params.set('page', String(Number(pageParam) + 1))
            } else if (pageNumParam && !Number.isNaN(Number(pageNumParam))) {
                params.set('pageNum', String(Number(pageNumParam) + 1))
            } else if (startParam && !Number.isNaN(Number(startParam))) {
                params.set('start', String(Number(startParam) + pageSize))
            } else {
                params.set('start', String(pageSize))
                params.set('count', String(pageSize))
            }

            url.search = params.toString()
            await this._navigator.goToLinkedinURL(url.toString())
            if (beforeKey) {
                await this._waitForFirstConnectionChange(beforeKey)
            }
            return true
        } catch {
            return false
        }
    }

    private async _collectSubtitles() {
        const cards = this._connectionCardLocator()
        const count = await cards.count().catch(() => 0)
        const subtitles: string[] = []

        for (let i = 0; i < count; i++) {
            const card = cards.nth(i)
            const subtitle = await this._extractSubtitle(card)
            if (subtitle) subtitles.push(subtitle)
        }

        return subtitles
    }

    private async _collectSubtitlesAcrossPages(options: {
        maxRounds: number
        maxIdleRounds: number
        targetCount?: number
    }) {
        const { maxRounds, maxIdleRounds, targetCount } = options
        const subtitles: string[] = []
        const seenProfiles = new Set<string>()
        const seenFallback = new Set<string>()
        let idleRounds = 0

        for (let round = 0; round < maxRounds; round++) {
            const lastKey = await this._getLastConnectionKey()
            const items = await this._collectConnectionItems()
            const before = seenProfiles.size
            let added = 0

            for (const item of items) {
                if (item.url) {
                    if (seenProfiles.has(item.url)) continue
                    seenProfiles.add(item.url)
                    if (item.subtitle) subtitles.push(item.subtitle)
                    added++
                } else if (item.subtitle) {
                    const key = item.subtitle.toLowerCase()
                    if (seenFallback.has(key)) continue
                    seenFallback.add(key)
                    subtitles.push(item.subtitle)
                    added++
                }
            }

            const after = seenProfiles.size
            console.log(`[network] rodada ${round + 1}: ${after} perfis únicos`)

            if (typeof targetCount === 'number' && after >= targetCount) break
            if (added === 0) {
                idleRounds++
            } else {
                idleRounds = 0
            }

            if (idleRounds >= maxIdleRounds) {
                const beforeKey = await this._getFirstConnectionKey()
                const clickedNext = await this._maybeClickNextPage(beforeKey)
                if (clickedNext) {
                    console.log('[network] paginação: avançando para próxima página')
                    await this._page.waitForTimeout(1200)
                    idleRounds = 0
                    continue
                }
                const advancedByUrl = await this._maybeGoToNextPageUrl(beforeKey)
                if (advancedByUrl) {
                    console.log('[network] paginação: avançando via URL')
                    await this._page.waitForTimeout(1200)
                    idleRounds = 0
                    continue
                }
                break
            }

            const container = await this._getScrollContainer()
            if (container) {
                await this._scrollContainer(container)
            } else {
                await this._page.mouse.wheel(0, 1600)
            }
            await this._maybeClickShowMore()
            if (lastKey) {
                await this._waitForConnectionListChange(lastKey)
            }
            await this._page.waitForTimeout(900)
        }

        return { subtitles, totalProfiles: seenProfiles.size }
    }

    private async _collectConnectionItems() {
        const cards = this._connectionCardLocator()
        const count = await cards.count().catch(() => 0)
        const items: Array<{ url: string | null; subtitle: string | null }> = []

        for (let i = 0; i < count; i++) {
            const card = cards.nth(i)
            const url = await this._extractProfileUrl(card)
            const subtitle = await this._extractSubtitle(card)
            if (url || subtitle) items.push({ url, subtitle })
        }

        return items
    }

    private async _collectConnectionProfileUrls() {
        const cards = this._connectionCardLocator()
        const count = await cards.count().catch(() => 0)
        const urls: string[] = []

        for (let i = 0; i < count; i++) {
            const card = cards.nth(i)
            const url = await this._extractProfileUrl(card)
            if (url) urls.push(url)
        }

        if (urls.length > 0) return Array.from(new Set(urls))

        const fallbackUrls: string[] = []
        const fallbackLinks = this._page.locator('main a[href*="/in/"]')
        const fallbackCount = await fallbackLinks.count().catch(() => 0)
        for (let i = 0; i < fallbackCount; i++) {
            const link = fallbackLinks.nth(i)
            const href = await link.getAttribute('href')
            const normalized = this._normalizeProfileUrl(href || '')
            if (normalized) fallbackUrls.push(normalized)
        }

        return Array.from(new Set(fallbackUrls))
    }

    private async _extractProfileUrl(card: Locator) {
        const link = card
            .locator('a[href*="/in/"][data-control-name*="view"], a[href*="/in/"]')
            .first()
        if ((await link.count().catch(() => 0)) === 0) return null
        const href = await link.getAttribute('href')
        return this._normalizeProfileUrl(href || '')
    }

    private async _extractSubtitle(card: Locator) {
        const selectors = [
            '.mn-connection-card__occupation',
            'span.mn-connection-card__occupation',
            '.mn-connection-card__details',
            '.mn-connection-card__details span',
            '.reusable-search__entity-result__primary-subtitle',
            '.reusable-search__entity-result__primary-subtitle span',
            '.entity-result__primary-subtitle',
            '.entity-result__primary-subtitle span',
            '.artdeco-entity-lockup__subtitle',
            '.artdeco-entity-lockup__subtitle span',
            '.t-14.t-black.t-normal',
            'p.t-14.t-black.t-normal',
            'span.t-14.t-black.t-normal',
            'p[dir="ltr"]',
            'span[dir="ltr"]'
        ]

        for (const selector of selectors) {
            const node = card.locator(selector).first()
            if ((await node.count().catch(() => 0)) === 0) continue
            const text = await node.innerText().catch(() => '')
            const cleaned = text.replace(/\s+/g, ' ').trim()
            if (cleaned && !this._isNoiseLine(cleaned)) return cleaned
        }

        const lines = await this._extractLines(card)
        if (lines.length === 0) return ''

        const filtered = lines.filter((line) => !this._isNoiseLine(line))
        if (filtered.length >= 2) return filtered[1]
        return filtered[0] || ''
    }

    private async _extractLines(scope: Locator): Promise<string[]> {
        try {
            const spans = scope.locator('span[aria-hidden="true"]')
            const count = await spans.count()
            if (count > 0) {
                const lines: string[] = []
                for (let i = 0; i < count; i++) {
                    const text = await spans.nth(i).innerText().catch(() => '')
                    if (text) lines.push(text)
                }
                return this._cleanLines(lines)
            }

            const text = await scope.innerText()
            return this._cleanLines(text.split('\n'))
        } catch {
            return []
        }
    }

    private async _fetchConnectionsFromApi(): Promise<{ subtitles: string[]; total?: number } | null> {
        const csrfToken = await this._getCsrfToken()
        if (!csrfToken) return null

        const endpoints = [
            'https://www.linkedin.com/voyager/api/relationships/dash/connections',
            'https://www.linkedin.com/voyager/api/relationships/connections'
        ]

        for (const endpoint of endpoints) {
            const subtitles: string[] = []
            const seen = new Set<string>()
            let start = 0
            const count = 100
            let total: number | undefined

            for (let round = 0; round < 30; round++) {
                const url = `${endpoint}?count=${count}&start=${start}`
                const response = await this._page.request.get(url, {
                    headers: {
                        'csrf-token': csrfToken,
                        'x-restli-protocol-version': '2.0.0',
                        accept: 'application/json'
                    }
                })
                if (!response.ok()) break
                const data = (await response.json().catch(() => null)) as any
                if (!data) break

                const elements = (data.elements || data.data?.elements || data.data || []) as any[]
                if (!Array.isArray(elements) || elements.length === 0) break

                for (const element of elements) {
                    const subtitle = this._extractSubtitleFromApiElement(element)
                    if (!subtitle) continue
                    const key = subtitle.toLowerCase()
                    if (seen.has(key)) continue
                    if (this._isNoiseLine(subtitle)) continue
                    seen.add(key)
                    subtitles.push(subtitle)
                }

                const paging = data.paging || data.data?.paging
                if (paging && typeof paging.total === 'number') {
                    total = paging.total
                }

                start += count
                if (total !== undefined && start >= total) break
            }

            if (subtitles.length) {
                return { subtitles, total }
            }
        }

        return null
    }

    private async _getCsrfToken() {
        const cookies = await this._page.context().cookies()
        const jsession = cookies.find((cookie) => cookie.name === 'JSESSIONID')
        if (!jsession?.value) return null
        return jsession.value.replace(/"/g, '')
    }

    private _extractSubtitleFromApiElement(element: any): string | null {
        if (!element) return null
        const direct =
            element.occupation ||
            element.headline ||
            element.title ||
            element.subtitle ||
            element.text
        if (typeof direct === 'string' && direct.trim()) return direct.trim()

        const mini = element.miniProfile || element.profile || element.entity
        if (mini) {
            const fallback =
                mini.occupation || mini.headline || mini.title || mini.subtitle || mini.text
            if (typeof fallback === 'string' && fallback.trim()) return fallback.trim()
        }

        return null
    }

    private async _extractConnectionsCount(): Promise<number | undefined> {
        const selectors = [
            '[data-test-connection-count]',
            '[data-test-connections-count]',
            '.mn-connections__header',
            'h1',
            'h2',
            'header',
            'main'
        ]

        const patterns = [
            /([0-9][0-9\.\,\s]*)\s*(connections|connection)\b/i,
            /([0-9][0-9\.\,\s]*)\s*(conexoes|conexões|conexao|conexão)\b/i,
            /(connections|connection)\s*\(?([0-9][0-9\.\,\s]*)\)?/i,
            /(conexoes|conexões|conexao|conexão)\s*\(?([0-9][0-9\.\,\s]*)\)?/i
        ]

        for (const selector of selectors) {
            const node = this._page.locator(selector).first()
            if ((await node.count().catch(() => 0)) === 0) continue
            const text = await node.innerText().catch(() => '')
            if (!text) continue
            const count = this._parseConnectionsCount(text, patterns)
            if (typeof count === 'number') return count
        }

        const textMatch = this._page.locator(
            'text=/[0-9][0-9\\.,\\s]*\\s*(connections|connection|conexoes|conexões|conexao|conexão)/i'
        ).first()
        if ((await textMatch.count().catch(() => 0)) > 0) {
            const text = await textMatch.innerText().catch(() => '')
            const count = this._parseConnectionsCount(text, patterns)
            if (typeof count === 'number') return count
        }

        return undefined
    }

    private _parseConnectionsCount(text: string, patterns: RegExp[]) {
        for (const pattern of patterns) {
            const match = text.match(pattern)
            if (!match) continue
            const raw = match[1] || match[2] || ''
            const digits = raw.replace(/[^\d]/g, '')
            if (!digits) continue
            const parsed = Number(digits)
            if (!Number.isNaN(parsed) && parsed > 0) return parsed
        }
        return undefined
    }

    private _cleanLines(lines: string[]) {
        const seen = new Set<string>()
        const cleaned: string[] = []
        for (const line of lines) {
            const trimmed = line.replace(/\s+/g, ' ').trim()
            if (!trimmed) continue
            const normalized = trimmed.toLowerCase()
            if (seen.has(normalized)) continue
            seen.add(normalized)
            cleaned.push(trimmed)
        }
        return cleaned
    }

    private _isNoiseLine(line: string) {
        const normalized = this._normalizeText(line)
        if (!normalized) return true

        const degreePatterns = /^(1st|2nd|3rd|1|2|3)$/
        if (degreePatterns.test(normalized)) return true

        if (/(conexao|conexoes|connection|connected|connect)/.test(normalized)) return true
        if (/(mensagem|message|follow|seguir|perfil|profile|remover|remove|visitar|visit)/.test(normalized)) return true
        if (/(linkedin member|membro do linkedin)/.test(normalized)) return true

        return false
    }

    private _normalizeText(text: string) {
        return text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()
    }

    private _normalizeProfileUrl(raw: string) {
        if (!raw) return null
        try {
            const url = new URL(raw, 'https://www.linkedin.com')
            if (!url.pathname.includes('/in/')) return null
            url.search = ''
            url.hash = ''
            return url.toString()
        } catch {
            if (!raw.includes('/in/')) return null
            return raw.split('#')[0].split('?')[0]
        }
    }
}
