import { Locator, Page } from "playwright"
import { LinkedinCoreFeatures } from "../../features/linkedin-core"
import { normalizeTextBasic } from "../utils/normalize"
import type { Experience } from "../interface/scrap/profile.types"
import { cleanProfileLines, extractCompanyName, parseExperienceLines } from "../utils/parse-profile"

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
        const label = normalizeTextBasic(rawLabel)

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
    const cleaned = cleanProfileLines(lines, ['about', 'sobre'])
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
        const company = extractCompanyName(headerLines[0] || '')
        for (let j = 0; j < nestedCount; j++) {
          const roleLines = await this._extractLines(nestedRoles.nth(j))
          const parsed = parseExperienceLines(roleLines, company)
          results.push(...parsed)
        }
        continue
      }

      const lines = await this._extractLines(item)
      const parsed = parseExperienceLines(lines)
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
        return cleanProfileLines(lines)
      }

      const text = await scope.innerText()
      return cleanProfileLines(text.split('\n'))
    } catch {
      return []
    }
  }

}
