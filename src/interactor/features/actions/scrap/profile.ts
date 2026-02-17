import { Locator, Page } from "playwright"
import { LinkedinCoreFeatures } from "../../linkedin-core"

type Experience = {
  label: string
  title: string
  company: string
  dates: string
  location: string
  description: string
}

export class ProfileScraps {
  private page: Page
  private profileUrl?: string
  private  _navigator: LinkedinCoreFeatures

  constructor(page: Page, navigator:LinkedinCoreFeatures) {
    this.page = page
    this._navigator = navigator
  }

  async scrapeProfile(url:string){
    await this._prepareToScrap(url)

    const header = await this._catchHeaderContent()
    const about = await this._catchAboutContent()
    const experiences = await this._catchExperienceContent()

    const mergedAbout = [header, about].filter(Boolean).join('\n').trim()
    return { about: mergedAbout, experiences }
  }



   private async _prepareToScrap(url:string){
    this.profileUrl = url
    await this._navigator.goToLinkedinURL(url)
    await this._waitForProfileHeader()
    await this._expandAllSeeMore()
    await this._scrollToBottom()
    await this._expandAllSeeMore()
  }

  private async _waitForProfileHeader() {
    try {
      await this.page.waitForSelector(
        'main h1, main [data-test-profile-headline], .scaffold-layout__main h1, .scaffold-layout__main [data-test-profile-headline]',
        {
        timeout: 15000
        }
      )
    } catch {
      // ignore: some profiles load slowly or hide header
    }
  }

  private async _catchHeaderContent() {
    const main = this.page.locator('main, .scaffold-layout__main').first()
    if ((await main.count()) === 0) return ''

    const name = await main.locator('h1').first().innerText().catch(() => '')

    const headlineCandidates = [
      '[data-test-profile-headline]',
      '.text-body-medium',
      '.pv-text-details__left-panel .text-body-medium'
    ]
    let headline = ''
    for (const selector of headlineCandidates) {
      const node = main.locator(selector).first()
      if ((await node.count()) > 0) {
        headline = (await node.innerText().catch(() => '')).trim()
        if (headline) break
      }
    }

    const locationCandidates = [
      '.text-body-small.inline',
      '.pv-text-details__left-panel .text-body-small',
      '.text-body-small'
    ]
    let location = ''
    for (const selector of locationCandidates) {
      const node = main.locator(selector).first()
      if ((await node.count()) > 0) {
        location = (await node.innerText().catch(() => '')).trim()
        if (location) break
      }
    }

    return [name, headline, location].filter(Boolean).join('\n').trim()
  }

  private async _expandAllSeeMore() {
    const scope = this.page.locator('main, .scaffold-layout__main')
    const selectors = [
      'button:has-text("See more")',
      'button:has-text("Show more")',
      'button:has-text("Mostrar mais")',
      'button:has-text("Ver mais")',
      'button:has-text("Exibir mais")',
      'a:has-text("See more")',
      'a:has-text("Show more")',
      'a:has-text("Mostrar mais")',
      'a:has-text("Ver mais")',
      'a:has-text("Exibir mais")'
    ]

    const target = scope.locator(selectors.join(','))
    const maxRounds = 10

    for (let round = 0; round < maxRounds; round++) {
      const count = await target.count()
      if (count === 0) return

      let clicked = 0
      for (let i = 0; i < count; i++) {
        const node = target.nth(i)
        if (!(await node.isVisible())) continue

        const rawLabel =
          (await node.getAttribute('aria-label')) ||
          (await node.textContent()) ||
          ''
        const label = rawLabel.trim().toLowerCase()

        if (!label) continue
        if (
          label.includes('see less') ||
          label.includes('show less') ||
          label.includes('mostrar menos') ||
          label.includes('ver menos') ||
          label.includes('see all') ||
          label.includes('show all') ||
          label.includes('ver tudo') ||
          label.includes('mostrar tudo') ||
          label.includes('exibir tudo')
        ) {
          continue
        }
        try {
          await node.scrollIntoViewIfNeeded()
          await node.click({ timeout: 2000 })
          clicked += 1
          await this.page.waitForTimeout(120)
        } catch {
          // Ignore clicks on detached/covered elements
        }
      }

      if (clicked === 0) return
    }
  }

  private async _scrollToBottom() {
  await this.page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const candidates = [
        document.scrollingElement,
        document.body,
        document.querySelector('main'),
        document.querySelector('.scaffold-layout__main')
      ].filter(Boolean) as HTMLElement[]

      const target =
        candidates.find((el) => el.scrollHeight > el.clientHeight) ||
        document.scrollingElement ||
        document.body

      let totalHeight = 0
      const distance = 600

      const timer = setInterval(() => {
        const scrollHeight = target.scrollHeight
        target.scrollBy({ top: distance, behavior: 'auto' })
        totalHeight += distance

        if (totalHeight >= scrollHeight - (target.clientHeight || window.innerHeight)) {
          clearInterval(timer)
          resolve()
        }
      }, 200)
    })
  })
}

  private async _catchAboutContent() {
    const section = this.page
      .locator(
        [
          'section#about',
          'section:has(#about)',
          'section.pv-about-section',
          'section:has(h2:has-text("About"))',
          'section:has(h2:has-text("Sobre"))'
        ].join(',')
      )
      .first()

    if ((await section.count()) === 0) return ''

    const lines = await this._extractLines(section)
    const cleaned = this._cleanLines(lines, ['about', 'sobre'])
    return cleaned.join('\n').trim()
  }

  private async _catchExperienceContent(): Promise<Experience[]> {
    const section = this.page
      .locator(
        [
          'section#experience',
          'section:has(#experience)',
          'section.pv-profile-section.experience-section',
          'section:has(h2:has-text("Experience"))',
          'section:has(h2:has-text("Experiência"))'
        ].join(',')
      )
      .first()

    if ((await section.count()) === 0) return []

    const list = section.locator('ul.pvs-list').first()
    let items = list.locator('> li')
    if ((await items.count().catch(() => 0)) === 0) {
      items = section.locator('li.pvs-list__item, li.artdeco-list__item')
    }

    const results: Experience[] = []
    const count = await items.count().catch(() => 0)
    for (let i = 0; i < count; i++) {
      const item = items.nth(i)

      const nestedRoles = item.locator('ul.pvs-list > li.pvs-list__item, ul.pvs-list > li.artdeco-list__item')
      const nestedCount = await nestedRoles.count().catch(() => 0)
      if (nestedCount > 0) {
        const headerLines = await this._extractLines(item)
        const company = this._extractCompanyName(headerLines[0] || '')
        for (let j = 0; j < nestedCount; j++) {
          const roleLines = await this._extractLines(nestedRoles.nth(j))
          const parsed = this._parseExperienceLines(roleLines, company)
          results.push(...parsed)
        }
        continue
      }

      const lines = await this._extractLines(item)
      const parsed = this._parseExperienceLines(lines)
      results.push(...parsed)
    }

    return results
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

  private _cleanLines(lines: string[], extraIgnore: string[] = []) {
    const ignore = new Set(
      [
        'see more',
        'show more',
        'see less',
        'show less',
        'mostrar mais',
        'ver mais',
        'mostrar menos',
        'ver menos',
        'experience',
        'experiência',
        ...extraIgnore
      ].map((item) => item.toLowerCase())
    )

    const seen = new Set<string>()
    const cleaned: string[] = []
    for (const line of lines) {
      const trimmed = line.replace(/\s+/g, ' ').trim()
      if (!trimmed) continue
      const normalized = trimmed.toLowerCase()
      if (ignore.has(normalized)) continue
      if (seen.has(normalized)) continue
      seen.add(normalized)
      cleaned.push(trimmed)
    }
    return cleaned
  }

  private _parseExperienceLines(lines: string[], companyOverride?: string): Experience[] {
    const cleaned = this._cleanLines(lines)
    if (cleaned.length === 0) return []

    if (companyOverride) {
      return [this._buildExperience(cleaned, companyOverride)]
    }

    const dateIndices = cleaned
      .map((line, idx) => (this._isDateLine(line) ? idx : -1))
      .filter((idx) => idx >= 0)

    if (dateIndices.length > 1) {
      const company = this._extractCompanyName(cleaned[0] || '')
      const entries: Experience[] = []
      for (let i = 0; i < dateIndices.length; i++) {
        const dateIndex = dateIndices[i]
        const nextIndex = dateIndices[i + 1] ?? cleaned.length

        let titleIndex = dateIndex - 1
        while (titleIndex > 0 && this._isEmploymentTypeLine(cleaned[titleIndex])) {
          titleIndex -= 1
        }
        let title = cleaned[titleIndex] || ''
        if (title === company && titleIndex > 0) {
          title = cleaned[titleIndex - 1] || title
        }

        let location = ''
        if (dateIndex + 1 < nextIndex) {
          const candidate = cleaned[dateIndex + 1]
          if (this._looksLikeLocation(candidate)) {
            location = candidate
          }
        }

        const descriptionStart = dateIndex + (location ? 2 : 1)
        const description = cleaned
          .slice(descriptionStart, nextIndex)
          .filter((line) => !this._isEmploymentTypeLine(line))
          .join(' ')

        entries.push({
          label: [title, company].filter(Boolean).join(' | '),
          title,
          company,
          dates: cleaned[dateIndex] || '',
          location,
          description
        })
      }
      return entries
    }

    return [this._buildExperience(cleaned)]
  }

  private _buildExperience(lines: string[], companyOverride?: string): Experience {
    const title = lines[0] || ''
    let company = companyOverride || ''

    if (!company) {
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]
        if (this._isDateLine(line)) break
        if (this._isEmploymentTypeLine(line)) continue
        company = this._extractCompanyName(line)
        break
      }
    }

    const dateIndex = lines.findIndex((line) => this._isDateLine(line))
    const dates = dateIndex >= 0 ? lines[dateIndex] : ''

    let location = ''
    if (dateIndex >= 0 && dateIndex + 1 < lines.length) {
      const candidate = lines[dateIndex + 1]
      if (this._looksLikeLocation(candidate)) {
        location = candidate
      }
    }

    const descriptionStart = dateIndex >= 0 ? dateIndex + (location ? 2 : 1) : 1
    const description = lines
      .slice(descriptionStart)
      .filter((line) => !this._isEmploymentTypeLine(line))
      .join(' ')

    return {
      label: [title, company].filter(Boolean).join(' | '),
      title,
      company,
      dates,
      location,
      description
    }
  }

  private _extractCompanyName(line: string) {
    if (!line) return ''
    const parts = line.split(/[·•|]/).map((part) => part.trim()).filter(Boolean)
    return parts[0] || line.trim()
  }

  private _looksLikeLocation(line: string) {
    if (!line) return false
    if (this._isDateLine(line) || this._isEmploymentTypeLine(line)) return false
    const normalized = this._normalizeText(line)
    if (
      normalized === 'remote' ||
      normalized === 'remoto' ||
      normalized === 'hibrido' ||
      normalized === 'hybrid' ||
      normalized === 'on-site' ||
      normalized === 'onsite' ||
      normalized === 'presencial'
    ) {
      return true
    }
    return line.includes(',') || line.length <= 60
  }

  private _isEmploymentTypeLine(line: string) {
    const normalized = this._normalizeText(line)
    return /(full[- ]time|part[- ]time|intern|internship|contract|freelance|temporary|self[- ]employed|tempo integral|meio periodo|estagio|contrato|autonomo)/.test(
      normalized
    )
  }

  private _isDateLine(line: string) {
    const normalized = this._normalizeText(line)
    if (!normalized) return false
    if (/\b(19|20)\d{2}\b/.test(normalized)) return true
    if (/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/.test(normalized)) return true
    if (/(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/.test(normalized)) return true
    if (/(present|atual|current)/.test(normalized)) return true
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
