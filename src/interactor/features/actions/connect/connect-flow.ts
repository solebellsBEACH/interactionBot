import { Page } from "playwright";
import { LINKEDIN_ACTION_LABELS } from "../../../shared/constants/linkedin";
import { LINKEDIN_BASE_URL, LINKEDIN_URLS } from "../../../shared/constants/linkedin-urls";
import { ElementHandle } from "../../../shared/utils/element-handle";
import { LinkedinCoreFeatures } from "../../linkedin-core";

type ConnectionSearchResult = {
    name?: string
    headline?: string
    location?: string
    url: string
}

export class LinkedinConnectFlow {
    private readonly _page: Page
    private readonly _elementHandle: ElementHandle
    private readonly _navigator: LinkedinCoreFeatures

    constructor(page: Page, elementHandle: ElementHandle, navigator: LinkedinCoreFeatures) {
        this._page = page
        this._elementHandle = elementHandle
        this._navigator = navigator
    }

    async sendConnection(profileURL: string, inMailOptions?: { message: string }) {
        await this._handleConnection(profileURL, inMailOptions)
    }

    async searchConnectionsByKeyword(
        keyword: string,
        options: { maxResults?: number; maxPages?: number } = {}
    ): Promise<ConnectionSearchResult[]> {
        const normalizedKeyword = keyword.trim()
        if (!normalizedKeyword) {
            throw new Error('missing-keyword')
        }

        const maxResults = options.maxResults ?? 6
        const maxRounds = options.maxPages ?? 3

        const searchUrl = `${LINKEDIN_URLS.peopleSearch}?keywords=${encodeURIComponent(
            normalizedKeyword
        )}`

        await this._navigator.goToLinkedinURL(searchUrl)
        await this._page.waitForTimeout(600)
        await this._waitForSearchResults()

        let results = await this._collectSearchResults(maxResults, maxRounds)
        if (!results.length) {
            await this._page.waitForTimeout(1500)
            results = await this._collectSearchResults(maxResults, maxRounds)
        }

        if (!results.length) {
            console.log('[connect] nenhuma conexao encontrada para a keyword')
        } else {
            console.log(`[connect] perfis encontrados: ${results.length}`)
        }
        return results
    }

    private async _searchConnections(){

    }

    private async  _handleConnection(profileURL:string, inMailOptions?: { message: string }){
        await this._navigator.goToLinkedinURL(profileURL)
        await this._page.waitForTimeout(800)

        const connected = await this._clickConnectButton()
        if (!connected) {
            const state = await this._detectConnectionState()
            if (state) {
                console.log(`[connect] convite nao enviado: ${state}`)
                return
            }
            console.log('[connect] botao conectar nao encontrado')
            return
        }
        if (inMailOptions) {
            await this._sendInMail(inMailOptions.message)
            return
        }
        await this._sendWithoutNote()
    }

    private async _sendInMail(message: string) {
        const modal = await this._waitForInviteModal()
        if (!modal) {
            const toast = await this._detectInviteToast()
            if (toast) {
                console.log(`[connect] ${toast}`)
                return
            }
            const state = await this._detectConnectionState()
            if (state) {
                console.log(`[connect] convite: ${state}`)
                return
            }
            console.log('[connect] modal de convite nao apareceu (inmail)')
            return
        }
        const addNote = modal.getByRole('button', { name: LINKEDIN_ACTION_LABELS.addNote }).first()
        if (await addNote.count()) {
            await addNote.click()
        }

        const textarea = modal.locator('textarea').first()
        await textarea.waitFor({ state: 'visible', timeout: 5_000 })
        await textarea.fill(message)

        const sendButton = modal.getByRole('button', { name: LINKEDIN_ACTION_LABELS.send }).first()
        await sendButton.waitFor({ state: 'visible', timeout: 5_000 })
        await sendButton.click()
    }

    private async _sendWithoutNote() {
        const modal = await this._waitForInviteModal()
        if (!modal) {
            await this._page.waitForTimeout(800)
            const sendFallback = this._page.getByRole('button', { name: LINKEDIN_ACTION_LABELS.sendWithoutNote }).first()
            if (await sendFallback.count()) {
                await sendFallback.click().catch(() => undefined)
                console.log('[connect] convite enviado (fallback)')
                return
            }
            const genericSend = this._page.getByRole('button', { name: /Enviar|Send|Done|Feito/i }).first()
            if (await genericSend.count()) {
                await genericSend.click().catch(() => undefined)
                console.log('[connect] convite enviado (generico)')
                return
            }
            const toast = await this._detectInviteToast()
            if (toast) {
                console.log(`[connect] ${toast}`)
                return
            }
            const state = await this._detectConnectionState()
            if (state) {
                console.log(`[connect] convite: ${state}`)
                return
            }
            console.log('[connect] convite nao enviado: nenhum modal/botao encontrado')
            return
        }
        const sendButton = modal.getByRole('button', { name: LINKEDIN_ACTION_LABELS.sendWithoutNote }).first()
        await sendButton.waitFor({ state: 'visible', timeout: 5_000 })
        await sendButton.click()
    }

    private async _clickConnectButton() {
        const scope = this._page.locator('main')
        const topCard = scope
            .locator(
                'section.pv-top-card, section.pv-top-card-v2-ctas, div.pv-top-card, div.pv-top-card-v2-ctas, section.artdeco-card'
            )
            .first()

        const connect = await this._findConnectButton(topCard)
        if (connect) {
            await connect.click()
            console.log('[connect] clicou em conectar (top card)')
            return true
        }

        const more = await this._findMoreButton(topCard)
        if (more) {
            const clicked = await this._clickConnectFromMenu(more)
            if (clicked) return true
        }

        const fallback = await this._findConnectButton(scope)
        if (fallback) {
            await fallback.click()
            console.log('[connect] clicou em conectar (main)')
            return true
        }

        const fallbackMore = await this._findMoreButton(scope)
        if (fallbackMore) {
            const clicked = await this._clickConnectFromMenu(fallbackMore)
            if (clicked) return true
        }

        const clickedByText = await this._clickConnectByTextFallback()
        if (clickedByText) return true

        const clickedBySpan = await this._clickConnectBySpanFallback()
        if (clickedBySpan) return true

        return false
    }

    private async _findConnectButton(scope: import("playwright").Locator) {
        const direct = scope.getByRole('button', { name: LINKEDIN_ACTION_LABELS.connect }).first()
        if (await direct.count()) return direct

        const ariaButtons = scope.locator(
            [
                'button[aria-label*="conectar" i]',
                'button[aria-label*="connect" i]',
                'button[aria-label*="invite" i]',
                'button[aria-label*="convidar" i]',
                'button[data-control-name*="connect" i]'
            ].join(', ')
        ).first()
        if (await ariaButtons.count()) return ariaButtons

        const textButtons = scope.locator(
            [
                'button:has-text("Conectar")',
                'button:has-text("Connect")',
                'button:has-text("Invite")',
                'button:has-text("Convidar")',
                'div[role="button"]:has-text("Conectar")',
                'div[role="button"]:has-text("Connect")',
                'a[role="button"]:has-text("Conectar")',
                'a[role="button"]:has-text("Connect")'
            ].join(', ')
        ).first()
        if (await textButtons.count()) return textButtons

        return null
    }

    private async _findMoreButton(scope: import("playwright").Locator) {
        const more = scope.getByRole('button', { name: LINKEDIN_ACTION_LABELS.more }).first()
        if (await more.count()) return more
        const ariaMore = scope.locator(
            [
                'button[aria-label*="more" i]',
                'button[aria-label*="mais" i]',
                'button[aria-label*="acoes" i]',
                'button[aria-label*="actions" i]',
                'button[data-control-name*="more" i]'
            ].join(', ')
        ).first()
        if (await ariaMore.count()) return ariaMore
        return null
    }

    private async _waitForInviteModal() {
        const modal = this._page
            .locator(
                [
                    'div[role="dialog"]',
                    'div[role="alertdialog"]',
                    'div.artdeco-modal',
                    'div[aria-label*="Invite" i]',
                    'div[aria-label*="Convidar" i]'
                ].join(', ')
            )
            .first()
        try {
            await modal.waitFor({ state: 'visible', timeout: 6_000 })
        } catch {
            console.log('[connect] modal de convite nao apareceu')
            return null
        }
        return modal
    }

    private async _clickConnectFromMenu(moreButton: import("playwright").Locator) {
        await moreButton.click().catch(() => undefined)
        const menu = this._page.locator('div[role="menu"]').first()
        await menu.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)

        const menuConnect = menu.getByRole('menuitem', { name: LINKEDIN_ACTION_LABELS.connect }).first()
        if (await menuConnect.count()) {
            await menuConnect.click()
            console.log('[connect] clicou em conectar (menu)')
            return true
        }

        const fallback = menu.locator(
            [
                'div[role="menuitem"]:has-text("Conectar")',
                'div[role="menuitem"]:has-text("Connect")',
                'button[role="menuitem"]:has-text("Conectar")',
                'button[role="menuitem"]:has-text("Connect")',
                'a[role="menuitem"]:has-text("Conectar")',
                'a[role="menuitem"]:has-text("Connect")'
            ].join(', ')
        ).first()
        if (await fallback.count()) {
            await fallback.click()
            console.log('[connect] clicou em conectar (menu fallback)')
            return true
        }

        return false
    }

    private async _clickConnectByTextFallback() {
        const clicked = await this._page
            .evaluate(() => {
                const textMatches = (value: string) => /conectar|connect|invite|convidar/i.test(value)
                const noiseMatches = (value: string) => /mensagem|message|seguir|follow|recrutador|recruiter/i.test(value)
                const candidates = Array.from(
                    document.querySelectorAll('button, a[role="button"], div[role="button"]')
                ) as HTMLElement[]
                const target = candidates.find((el) => {
                    const label = (el.getAttribute('aria-label') || el.textContent || '').trim()
                    if (!label) return false
                    if (!textMatches(label) || noiseMatches(label)) return false
                    const rect = el.getBoundingClientRect()
                    return rect.width > 0 && rect.height > 0
                })
                if (target) {
                    target.click()
                    return true
                }
                return false
            })
            .catch(() => false)

        if (clicked) {
            console.log('[connect] clicou em conectar (fallback texto)')
        }
        return clicked
    }

    private async _clickConnectBySpanFallback() {
        const clicked = await this._page
            .evaluate(() => {
                const main = document.querySelector('main') || document.body
                const textMatches = (value: string) => /^(conectar|connect|invite|convidar)$/i.test(value)
                const noiseMatches = (value: string) =>
                    /mensagem|message|seguir|follow|recrutador|recruiter|conectado|connected|pendente|pending/i.test(value)
                const isVisible = (el: Element | null) => {
                    if (!el) return false
                    const rect = (el as HTMLElement).getBoundingClientRect()
                    return rect.width > 0 && rect.height > 0
                }
                const findClickable = (el: Element | null) =>
                    el?.closest('button, a[role="button"], div[role="button"], span[role="button"], a') as HTMLElement | null

                const spans = Array.from(main.querySelectorAll('span'))
                for (const span of spans) {
                    const text = (span.textContent || '').trim()
                    if (!text || !textMatches(text) || noiseMatches(text)) continue
                    const target = findClickable(span)
                    if (target && isVisible(target)) {
                        target.click()
                        return true
                    }
                }

                const svg = main.querySelector('svg#connect-small, svg[id*="connect" i]')
                if (svg) {
                    const target = findClickable(svg)
                    if (target && isVisible(target)) {
                        target.click()
                        return true
                    }
                }

                return false
            })
            .catch(() => false)

        if (clicked) {
            console.log('[connect] clicou em conectar (fallback span)')
        }
        return clicked
    }

    private async _detectConnectionState() {
        const checks: Array<{ label: string; pattern: RegExp }> = [
            { label: 'ja conectado', pattern: /Conectado|Connected/i },
            { label: 'convite pendente', pattern: /Pendente|Pending|Convite enviado|Invitation sent|Solicita(c|ç)(a|ã)o enviada|Request sent/i },
            { label: 'convite cancelavel', pattern: /Retirar convite|Cancelar convite|Withdraw|Cancel request|Cancel invitation/i },
            { label: 'mensagem disponivel', pattern: /Mensagem|Message/i },
            { label: 'apenas seguir', pattern: /Seguir|Follow|Seguindo|Following/i }
        ]

        for (const entry of checks) {
            const button = this._page.getByRole('button', { name: entry.pattern }).first()
            if (await button.count().catch(() => 0)) return entry.label
        }

        const badges = await this._page.locator('main span, main button, main a').allInnerTexts().catch(() => [])
        const normalized = badges.join(' ').toLowerCase()
        if (normalized.includes('pendente') || normalized.includes('pending')) return 'convite pendente'
        if (normalized.includes('conectado') || normalized.includes('connected')) return 'ja conectado'
        if (normalized.includes('convite enviado') || normalized.includes('invitation sent')) return 'convite pendente'
        if (normalized.includes('solicitacao enviada') || normalized.includes('request sent')) return 'convite pendente'
        if (normalized.includes('retirar convite') || normalized.includes('withdraw')) return 'convite pendente'
        return null
    }

    private async _detectInviteToast() {
        const toast = this._page
            .locator(
                [
                    'div[role="alert"]',
                    'div[role="status"]',
                    'div[data-test-toaster]',
                    'div.artdeco-toast-item',
                    'div.artdeco-toast-item__content'
                ].join(', ')
            )
            .first()
        if ((await toast.count().catch(() => 0)) === 0) return null
        const text = (await toast.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        if (!text) return null
        const lowered = text.toLowerCase()
        if (
            lowered.includes('convite enviado') ||
            lowered.includes('invitation sent') ||
            lowered.includes('request sent') ||
            lowered.includes('solicita') ||
            lowered.includes('pending')
        ) {
            return `toast: ${text}`
        }
        return null
    }

    private async _waitForSearchResults() {
        const selectors = [
            'li.reusable-search__result-container',
            'li.entity-result',
            'div.reusable-search__result-container',
            'div.entity-result',
            'div[data-chameleon-result-urn]',
            'li[data-chameleon-result-urn]',
            '[data-view-name="search-entity-result-universal-template"]',
            'main a[href*="/in/"]'
        ]
        await this._page.waitForSelector(selectors.join(', '), {
            state: 'attached',
            timeout: 20_000
        }).catch(() => undefined)
    }

    private async _collectSearchResults(maxResults: number, maxRounds: number) {
        const seen = new Map<string, ConnectionSearchResult>()
        let idleRounds = 0

        for (let round = 0; round < maxRounds; round++) {
            const results = await this._extractSearchResultsFromPage()
            const before = seen.size
            for (const result of results) {
                if (seen.size >= maxResults) break
                if (!seen.has(result.url)) {
                    seen.set(result.url, result)
                }
            }
            const after = seen.size

            if (after >= maxResults) break
            if (after === before) {
                idleRounds += 1
            } else {
                idleRounds = 0
            }
            if (idleRounds >= 2) break

            await this._scrollResultsPage()
            await this._page.waitForTimeout(1000)
        }

        return Array.from(seen.values()).slice(0, maxResults)
    }

    private async _extractSearchResultsFromPage() {
        const selectors = [
            'li.reusable-search__result-container',
            'li.entity-result',
            'div.reusable-search__result-container',
            'div.entity-result',
            'div[data-chameleon-result-urn]',
            'li[data-chameleon-result-urn]',
            '[data-view-name="search-entity-result-universal-template"]'
        ]

        const cards = this._page.locator(selectors.join(', '))
        const count = await cards.count().catch(() => 0)
        if (!count) {
            return this._extractProfileLinksFromMain()
        }

        const results: ConnectionSearchResult[] = []
        for (let i = 0; i < count; i++) {
            const card = cards.nth(i)
            const link = card.locator('a[href*="/in/"]').first()
            const href = await link.getAttribute('href').catch(() => null)
            const normalized = this._normalizeProfileUrl(href || '')
            if (!normalized) continue
            const lines = await this._extractCardLines(card)
            const picked = this._pickCardFields(lines)
            let name = picked.name
            let headline = picked.headline
            let location = picked.location
            const slug = this._extractSlugFromUrl(normalized)

            const linkTextRaw = (await link.innerText().catch(() => '')).trim()
            const linkText = linkTextRaw.split('\n')[0]?.trim() || ''
            if (linkText && !name) {
                const normalizedLink = linkText.replace(/\s+/g, ' ').trim().toLowerCase()
                const normalizedSlug = slug.replace(/\s+/g, ' ').trim().toLowerCase()
                const looksLikeSlug = normalizedSlug && normalizedLink === normalizedSlug
                if (
                    !linkText.includes('/in/') &&
                    !linkText.includes('linkedin.com') &&
                    !looksLikeSlug &&
                    !this._isNoiseLine(normalizedLink)
                ) {
                    name = linkText
                }
            }

            const ariaLabel = (await link.getAttribute('aria-label').catch(() => null)) || ''
            const titleAttr = (await link.getAttribute('title').catch(() => null)) || ''
            const label = ariaLabel.trim() || titleAttr.trim()
            if (label) {
                const parsed = this._parseLabelFields(label)
                if (parsed.name && !name) name = parsed.name
                if (parsed.headline && !headline) headline = parsed.headline
                if (parsed.location && !location) location = parsed.location
            }

            results.push({
                name: name || undefined,
                headline: headline || undefined,
                location: location || undefined,
                url: normalized
            })
        }

        return results
    }

    private async _extractProfileLinksFromMain() {
        const anchors = this._page.locator('main a[href*="/in/"]')
        const count = await anchors.count().catch(() => 0)
        if (!count) return []

        const results: ConnectionSearchResult[] = []
        for (let i = 0; i < count; i++) {
            const anchor = anchors.nth(i)
            const href = await anchor.getAttribute('href').catch(() => null)
            const normalized = this._normalizeProfileUrl(href || '')
            if (!normalized) continue
            const slug = this._extractSlugFromUrl(normalized)
            const raw = (await anchor.innerText().catch(() => '')).trim()
            let name = raw
            if (raw) {
                const normalizedLink = raw.replace(/\s+/g, ' ').trim().toLowerCase()
                const normalizedSlug = slug.replace(/\s+/g, ' ').trim().toLowerCase()
                const looksLikeSlug = normalizedSlug && normalizedLink === normalizedSlug
                if (raw.includes('/in/') || raw.includes('linkedin.com') || looksLikeSlug) {
                    name = ''
                }
            }
            results.push({
                name: name || undefined,
                url: normalized
            })
        }
        return results
    }

    private async _readCardText(scope: import("playwright").Locator, selectors: string[]) {
        for (const selector of selectors) {
            const node = scope.locator(selector).first()
            if ((await node.count().catch(() => 0)) > 0) {
                const text = (await node.innerText().catch(() => '')).trim()
                if (text) return text
            }
        }
        return ''
    }

    private async _extractCardLines(scope: import("playwright").Locator) {
        const lines: string[] = []

        const altName = await scope.locator('img[alt]').first().getAttribute('alt').catch(() => '')
        if (altName) {
            const cleanedAlt = altName.replace(/\s+/g, ' ').trim()
            if (cleanedAlt && !this._isNoiseLine(cleanedAlt.toLowerCase())) {
                lines.push(cleanedAlt)
            }
        }

        const nameCandidate = await this._readCardText(scope, [
            'a[href*="/in/"] span[aria-hidden="true"]',
            '.entity-result__title-text span[aria-hidden="true"]',
            '.entity-result__title-text',
            'a.app-aware-link span[aria-hidden="true"]',
            'a.app-aware-link'
        ])
        if (nameCandidate) {
            lines.push(nameCandidate)
        }

        const ariaLines = await scope.locator('span[aria-hidden="true"]').allInnerTexts().catch(() => [])
        for (const entry of ariaLines) {
            if (entry) lines.push(entry)
        }

        if (!lines.length) {
            const title = await this._readCardText(scope, [
                '.entity-result__title-text span[aria-hidden="true"]',
                '.entity-result__title-text',
                'a.app-aware-link span[aria-hidden="true"]',
                'a.app-aware-link'
            ])
            if (title) lines.push(title)
        }

        const raw = await scope.innerText().catch(() => '')
        if (raw) {
            lines.push(...raw.split('\n'))
        }

        const cleaned: string[] = []
        const seen = new Set<string>()
        for (const line of lines) {
            const normalized = line.replace(/\s+/g, ' ').trim()
            if (!normalized) continue
            const key = normalized.toLowerCase()
            if (seen.has(key)) continue
            if (this._isNoiseLine(key)) continue
            seen.add(key)
            cleaned.push(normalized)
        }

        return cleaned
    }

    private _pickCardFields(lines: string[]) {
        if (!lines.length) return { name: '', headline: '', location: '' }

        const name = lines[0] || ''
        let headline = ''
        let location = ''

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i]
            if (!headline && !this._looksLikeLocation(line)) {
                headline = line
                continue
            }
            if (!location && this._looksLikeLocation(line)) {
                location = line
            }
            if (headline && location) break
        }

        return { name, headline, location }
    }

    private _parseLabelFields(label: string) {
        const cleaned = label.replace(/\s+/g, ' ').trim()
        if (!cleaned) return { name: '', headline: '', location: '' }
        const lowered = cleaned.toLowerCase()
        if (lowered.includes('profile') || lowered.includes('perfil')) {
            return { name: '', headline: '', location: '' }
        }
        let parts: string[] = []
        if (cleaned.includes(' - ')) {
            parts = cleaned.split(' - ')
        } else if (cleaned.includes(' | ')) {
            parts = cleaned.split(' | ')
        } else if (cleaned.includes(' · ')) {
            parts = cleaned.split(' · ')
        } else {
            parts = [cleaned]
        }
        const filtered = parts.map((part) => part.trim()).filter(Boolean)
        const [name, headline, location] = filtered
        return {
            name: name || '',
            headline: headline || '',
            location: location || ''
        }
    }

    private _looksLikeLocation(line: string) {
        if (!line) return false
        const normalized = line.toLowerCase()
        if (/[·•]/.test(line)) return false
        if (normalized.includes('conectar') || normalized.includes('connect')) return false
        if (normalized.includes('seguir') || normalized.includes('follow')) return false
        if (normalized.includes('mensagem') || normalized.includes('message')) return false
        if (normalized.includes('recrutador') || normalized.includes('recruiter')) return false
        if (normalized.includes('1º') || normalized.includes('2º') || normalized.includes('3º')) return false
        if (/\b(1st|2nd|3rd|4th)\b/.test(normalized)) return false
        if (normalized.includes('degree')) return false
        if (normalized.includes('mutual') || normalized.includes('conex')) return false
        if (normalized.includes('premium')) return false
        return line.includes(',') || line.length <= 60
    }

    private _isNoiseLine(normalized: string) {
        if (!normalized) return true
        if (normalized.startsWith('•')) return true
        if (normalized.startsWith('-')) return true
        if (normalized.startsWith('view ') && normalized.includes('profile')) return true
        if (normalized.includes('view ') && normalized.includes('profile')) return true
        if (normalized.includes('ver ') && normalized.includes('perfil')) return true
        if (normalized.includes('conectar') || normalized.includes('connect')) return true
        if (normalized.includes('mensagem') || normalized.includes('message')) return true
        if (normalized.includes('seguir') || normalized.includes('follow')) return true
        if (normalized.includes('recrutador') || normalized.includes('recruiter')) return true
        if (normalized.includes('1º') || normalized.includes('2º') || normalized.includes('3º')) return true
        if (/\b(1st|2nd|3rd|4th)\b/.test(normalized)) return true
        if (normalized.includes('degree')) return true
        if (normalized.includes('mutual') || normalized.includes('conex')) return true
        if (normalized.includes('premium')) return true
        if (normalized === 'ver mais' || normalized === 'see more') return true
        return false
    }

    private _normalizeProfileUrl(raw: string) {
        if (!raw) return null
        try {
            const url = new URL(raw, LINKEDIN_BASE_URL)
            if (!url.pathname.includes('/in/')) return null
            if (url.pathname.includes('/in/me')) return null
            url.search = ''
            url.hash = ''
            return url.toString()
        } catch {
            if (!raw.includes('/in/') || raw.includes('/in/me')) return null
            return raw.split('#')[0].split('?')[0]
        }
    }

    private _extractSlugFromUrl(url: string) {
        const match = url.match(/\/in\/([^/?#]+)/i)
        if (!match) return ''
        return decodeURIComponent(match[1]).replace(/[-_]+/g, ' ').trim()
    }

    private async _scrollResultsPage() {
        try {
            await this._page.mouse.wheel(0, 1800)
        } catch {
            // ignore
        }
    }
}
