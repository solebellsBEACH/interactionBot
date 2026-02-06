import { Locator, Page } from "playwright"
import { LinkedinCoreFeatures } from "../../linkedin-core"

export type MyNetworkScrapResult = {
    subtitles: string[]
    ranking: Array<{ word: string; count: number }>
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
        const cardsCount = await this._connectionCardLocator().count().catch(() => 0)
        console.log(`[network] cards detectados: ${cardsCount}`)
        await this._scrollConnectionsList()

        let subtitles = await this._collectSubtitles()
        let ranking = this._rankWords(subtitles)

        if (!ranking.length) {
            const fallbackLines = await this._extractLines(this._page.locator('main'))
            const filtered = fallbackLines.filter((line) => !this._isNoiseLine(line))
            if (filtered.length) {
                subtitles = filtered
                ranking = this._rankWords(filtered)
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

        return { subtitles, ranking }
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
        const container = await this._getScrollContainer()
        for (let round = 0; round < maxRounds; round++) {
            const count = await this._connectionCardLocator().count().catch(() => 0)
            if (round > 0 && count <= previousCount) break
            previousCount = count

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
            'div.scaffold-layout__list',
            'div.scaffold-layout__list-container',
            'div.scaffold-layout__list-detail',
            'div.mn-connection-list',
            'main'
        ]
        for (const selector of selectors) {
            const node = this._page.locator(selector).first()
            if (node && (await node.count().catch(() => 0)) > 0) return node
        }
        return null
    }

    private async _scrollContainer(container: Locator) {
        try {
            const scrolled = await container.evaluate((el) => {
                const before = el.scrollTop
                const max = el.scrollHeight - el.clientHeight
                if (max <= 0) return false
                el.scrollTop = el.scrollHeight
                return el.scrollTop !== before
            })
            if (!scrolled) {
                await this._page.mouse.wheel(0, 1600)
            }
        } catch {
            await this._page.mouse.wheel(0, 1600)
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

    private _rankWords(subtitles: string[], top = 20) {
        const combined = subtitles.filter(Boolean).join('\n')
        if (!combined.trim()) return []

        const normalized = combined
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')

        const stopwords = new Set([
            'a','as','o','os','um','uma','uns','umas','de','da','do','das','dos','e','ou','em','no','na','nos','nas',
            'por','para','com','sem','sob','sobre','entre','ate','até','ao','aos','à','às','que','se','sua','seu','suas','seus',
            'como','mais','menos','muito','muitos','muita','muitas','foi','era','sao','são','ser','estar','tem','tendo',
            'the','and','or','in','on','at','to','for','of','with','from','by','is','are','was','were','be','been','being','as'
        ])

        const counts = new Map<string, number>()
        for (const word of normalized.split(/\s+/g)) {
            if (!word || word.length < 2) continue
            if (stopwords.has(word)) continue
            counts.set(word, (counts.get(word) ?? 0) + 1)
        }

        return Array.from(counts.entries())
            .sort((a, b) => {
                if (b[1] !== a[1]) return b[1] - a[1]
                return a[0].localeCompare(b[0])
            })
            .slice(0, top)
            .map(([word, count]) => ({ word, count }))
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
}
