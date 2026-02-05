import { Locator, Page } from "playwright"

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

  constructor(page: Page) {
    this.page = page
  }

  async scrapeProfile(url: string) {
    this.log(`Abrindo perfil: ${url}`)
    await this.page.goto(url, { waitUntil: "domcontentloaded" })
    this.log(`URL atual: ${this.page.url()}`)
    this.profileUrl = this.normalizeProfileUrl(this.page.url() || url)
    this.log(`Perfil normalizado: ${this.profileUrl}`)
    await this.ensureProfileLoaded()

    this.log("Lendo seção About")
    const aboutSection = await this.getSection("about")
    await this.expandInlineShowMore(aboutSection)
    const aboutText = await this.readAboutText(aboutSection)
    this.log(`About carregado (${aboutText.length} chars)`)

    this.log("Abrindo detalhes de Experience (se houver)")
    await this.openExperienceDetails()
    this.log(`URL após abrir Experience: ${this.page.url()}`)
    this.log("Lendo seção Experience")
    const experienceSection = await this.getSection("experience")
    const experiences = await this.getExperiences(experienceSection)
    this.log(`Experience final: ${experiences.length} itens`)

    return {
      about: aboutText,
      experiences
    }
  }

  private async getSection(anchorId: string) {
    this.log(`Buscando seção: ${anchorId}`)
    if (anchorId === "experience" && this.page.url().includes("/details/experience")) {
      this.log("Página de detalhes de Experience detectada.")
      const detailsSection =
        (await this.findSectionByHeading(["experience", "experiência", "experiencia"])) ||
        this.page.locator("main")
      await detailsSection.waitFor({ state: "visible", timeout: 5000 })
      await this.expandSeeMore(detailsSection)
      return detailsSection
    }

    const anchor = this.page.locator(`#${anchorId}`)
    const hasAnchor = await anchor
      .first()
      .waitFor({ state: "attached", timeout: 5000 })
      .then(() => true)
      .catch(() => false)

    if (hasAnchor) {
      this.log(`Seção encontrada por âncora: #${anchorId}`)
      await anchor.scrollIntoViewIfNeeded().catch(() => {})
      const section = anchor.locator("xpath=ancestor::section[1]")
      await section.waitFor({ state: "visible", timeout: 5000 })
      await this.expandSeeMore(section)
      return section
    }

    this.log(`Âncora #${anchorId} não encontrada, usando fallback por heading`)
    const fallbackLabels =
      anchorId === "experience"
        ? ["experience", "experiência", "experiencia"]
        : ["about", "sobre"]

    const fallbackSection = await this.findSectionByHeading(fallbackLabels)
    if (fallbackSection) {
      this.log(`Seção encontrada por heading: ${fallbackLabels.join(", ")}`)
      await this.expandSeeMore(fallbackSection)
      return fallbackSection
    }

    this.log(`Seção não encontrada. Usando <main> como fallback.`)
    const main = this.page.locator("main")
    await main.waitFor({ state: "visible", timeout: 5000 })
    await this.expandSeeMore(main)
    return main
  }

  private async expandSeeMore(section: Locator) {
    const btns = section.locator(
      [
        "button.inline-show-more-text__button",
        "button[aria-label*='see more' i]",
        "button[aria-label*='ver mais' i]",
        "button[aria-label*='mostrar mais' i]",
        "[role='button'].inline-show-more-text__button",
        "[role='button'][aria-label*='see more' i]",
        "[role='button'][aria-label*='ver mais' i]",
        "[role='button'][aria-label*='mostrar mais' i]"
      ].join(", ")
    )
    let attempts = 0
    while (attempts < 10) {
      const count = await btns.count()

      if (count === 0) {
        this.log(`See more: nenhum botão encontrado (tentativa ${attempts + 1}/10)`)
        if (attempts === 0) {
          await this.logSeeMoreCandidates(section, btns)
        }
        await this.page.mouse.wheel(0, 800)
        await this.page.waitForTimeout(200)
        attempts++
        continue
      }

      if (attempts === 0) {
        await this.logSeeMoreCandidates(section, btns)
      }

      let clicked = 0
      for (let i = 0; i < count; i++) {
        const b = btns.nth(i)
        const visible = await b.isVisible().catch(() => false)
        if (!visible) continue

        const label = await b
          .innerText()
          .then((text) => text.toLowerCase())
          .catch(() => "")
        const isSeeMore =
          label.includes("see more") ||
          label.includes("ver mais") ||
          label.includes("mostrar mais") ||
          label.includes("show more") ||
          label.includes("see all")
        const ariaLabel = await b.getAttribute("aria-label").catch(() => "")
        const ariaMatches =
          (ariaLabel || "").toLowerCase().includes("see more") ||
          (ariaLabel || "").toLowerCase().includes("ver mais") ||
          (ariaLabel || "").toLowerCase().includes("mostrar mais") ||
          (ariaLabel || "").toLowerCase().includes("show more") ||
          (ariaLabel || "").toLowerCase().includes("see all")
        const className = (await b.getAttribute("class").catch(() => "")) || ""
        const classMatches = className.includes("inline-show-more-text__button")
        const shouldClick = isSeeMore || ariaMatches || classMatches

        if (!shouldClick) continue
        await b.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {})
        await b.click({ timeout: 1500, force: true }).then(() => {
          clicked++
        }).catch(() => {})
      }

      this.log(`See more: ${clicked}/${count} clicados (tentativa ${attempts + 1}/10)`)
      if (clicked === 0) break
      await this.page.waitForTimeout(200)
      attempts++
    }
  }

  private async getExperiences(section: Locator): Promise<Experience[]> {
    await this.loadSectionItems(section)

    const items = section.locator("li.pvs-list__paged-list-item, li.artdeco-list__item")
    const count = await items.count()
    this.log(`Experiências: itens encontrados = ${count}`)

    const result: Experience[] = []

    for (let i = 0; i < count; i++) {
      const item = items.nth(i)

      const nestedItems = item.locator(
        ":scope li.pvs-list__paged-list-item, :scope .pvs-list__outer-container li.pvs-list__paged-list-item"
      )
      const nestedCount = await nestedItems.count()

      if (nestedCount > 0) {
        const company = await this.readText(
          item.locator("span.t-bold span[aria-hidden='true']")
        )
        this.log(`Experiência agrupada: ${company} (${nestedCount} posições)`)

        for (let j = 0; j < nestedCount; j++) {
          const nestedItem = nestedItems.nth(j)
          const exp = await this.parseExperienceItem(nestedItem, company)
          if (exp) result.push(exp)
        }
      } else {
        const exp = await this.parseExperienceItem(item)
        if (exp) result.push(exp)
      }
    }

    return this.dedupeExperiences(result)
  }

  private async openExperienceDetails(): Promise<void> {
    if (this.page.url().includes("/details/experience")) return

    if (this.profileUrl && this.profileUrl.includes("/in/")) {
      const detailsUrl = `${this.profileUrl.replace(/\/$/, "")}/details/experience/`
      this.log(`Tentando abrir Experience direto: ${detailsUrl}`)
      await this.page.goto(detailsUrl, { waitUntil: "domcontentloaded" }).catch(() => {})
      if (this.page.url().includes("/details/experience")) return
      this.log(`Falha ao abrir details direto. URL atual: ${this.page.url()}`)
    }

    const detailsLink = this.page.locator("a[href*='/details/experience/']").first()
    if (await detailsLink.isVisible().catch(() => false)) {
      this.log("Abrindo /details/experience via link direto")
      await Promise.all([
        this.page.waitForURL(/\/details\/experience\//, { timeout: 5000 }).catch(() => {}),
        detailsLink.click({ timeout: 1500 }).catch(() => {})
      ])
      await this.page.waitForLoadState("domcontentloaded").catch(() => {})
      return
    }

    const showAllLink = this.page
      .getByRole("link", { name: /show all experiences|see all experiences|show all/i })
      .first()
    if (await showAllLink.isVisible().catch(() => false)) {
      this.log("Abrindo experiences via 'show all'")
      await Promise.all([
        this.page.waitForURL(/\/details\/experience\//, { timeout: 5000 }).catch(() => {}),
        showAllLink.click({ timeout: 1500 }).catch(() => {})
      ])
      await this.page.waitForLoadState("domcontentloaded").catch(() => {})
      return
    }

    this.log("Nenhum link de details/experience encontrado")
  }

  private async ensureProfileLoaded(): Promise<void> {
    const url = this.page.url()
    if (url.includes("/login") || url.includes("/checkpoint/")) {
      this.log("Login exigido pelo LinkedIn.")
      throw new Error("LinkedIn requer login para acessar o perfil.")
    }

    const loginForm = this.page.locator("input[name='session_key'], input#username")
    if (await loginForm.first().isVisible().catch(() => false)) {
      this.log("Login exigido pelo LinkedIn (form detectado).")
      throw new Error("LinkedIn requer login para acessar o perfil.")
    }
  }

  private async findSectionByHeading(labels: string[]): Promise<Locator | null> {
    const main = this.page.locator("main")
    const pattern = new RegExp(labels.join("|"), "i")
    const heading = main.getByRole("heading", { name: pattern }).first()

    const visible = await heading
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false)
    if (!visible) return null

    let section = heading.locator("xpath=ancestor::section[1]")
    if (await section.count().catch(() => 0)) return section

    section = heading.locator("xpath=ancestor::div[1]")
    if (await section.count().catch(() => 0)) return section

    return null
  }

  private async loadSectionItems(section: Locator): Promise<void> {
    await this.waitForItems(section)
    let lastCount = -1
    for (let i = 0; i < 8; i++) {
      const items = section.locator("li.pvs-list__paged-list-item, li.artdeco-list__item")
      const count = await items.count()
      if (count === 0 && i < 3) {
        this.log(`Nenhum item ainda, aguardando... (passo ${i + 1}/8)`)
        await this.page.waitForTimeout(400)
        continue
      }
      if (count === lastCount) break
      lastCount = count

      this.log(`Carregando itens: ${count} (passo ${i + 1}/8)`)
      await this.expandSeeMore(section)
      await this.page.mouse.wheel(0, 1200)
      await this.page.waitForTimeout(200)
    }
  }

  private async waitForItems(section: Locator): Promise<void> {
    const items = section.locator("li.pvs-list__paged-list-item, li.artdeco-list__item")
    const found = await items
      .first()
      .waitFor({ state: "attached", timeout: 5000 })
      .then(() => true)
      .catch(() => false)
    this.log(`Itens iniciais ${found ? "detectados" : "não detectados"}`)
  }

  private async parseExperienceItem(
    item: Locator,
    fallbackCompany?: string
  ): Promise<Experience | null> {
    await this.expandInlineShowMore(item)
    let title = await this.readFirstMatchingText(item, [
      ".pvs-entity__summary-info span.t-16.t-black.t-bold",
      "span.t-16.t-black.t-bold",
      "span.t-bold span[aria-hidden='true']"
    ])

    let company =
      fallbackCompany ||
      (await this.readFirstMatchingText(item, [
        ".pvs-entity__summary-info span.t-14.t-normal span[aria-hidden='true']",
        ".pvs-entity__summary-info span.t-14.t-normal.t-black--light span[aria-hidden='true']",
        "span.t-14.t-normal span[aria-hidden='true']",
        "span.t-14.t-normal"
      ]))

    let dates =
      (await this.readText(item.locator(".pvs-entity__caption-wrapper"))) ||
      (await this.readText(item.locator("span.t-14.t-normal.t-black--light")))

    let location =
      (await this.readText(item.locator("span.t-black--light span[aria-hidden='true']").nth(1))) ||
      (await this.readText(item.locator("span.t-14.t-normal.t-black--light span[aria-hidden='true']").nth(1)))

    let description = await this.readInlineDescription(item)

    const inferred = await this.inferFromHiddenTexts(item)
    if (!dates && inferred.dates) dates = inferred.dates
    if (!location && inferred.location) location = inferred.location
    if (!company && inferred.company) company = inferred.company
    if (!title || title === company) {
      if (inferred.title && inferred.title !== company) title = inferred.title
    }

    if (!description) {
      description = await this.inferDescription(item, [title, company, dates, location])
    }

    if (!title && !company) return null

    return {
      label: title || company,
      title,
      company,
      dates,
      location,
      description
    }
  }

  private async readText(locator: Locator): Promise<string> {
    const text = await locator.first().innerText().catch(() => "")
    return this.normalizeText(text)
  }

  private async readFirstMatchingText(
    container: Locator,
    selectors: string[]
  ): Promise<string> {
    for (const selector of selectors) {
      const text = await container.locator(selector).first().innerText().catch(() => "")
      const cleaned = this.cleanInlineText(text)
      if (cleaned) return cleaned
    }
    return ""
  }

  private async readInlineDescription(container: Locator): Promise<string> {
    const selectors = [
      ".inline-show-more-text span.visually-hidden",
      ".inline-show-more-text span[aria-hidden='true']",
      ".inline-show-more-text span[aria-hidden='false']",
      ".inline-show-more-text__text",
      ".inline-show-more-text",
      ".pvs-entity__description span.visually-hidden",
      ".pvs-entity__description span[aria-hidden='true']",
      ".pvs-entity__description"
    ]

    for (const selector of selectors) {
      const text = await container.locator(selector).first().innerText().catch(() => "")
      const cleaned = this.cleanInlineText(text)
      if (cleaned) return cleaned
    }

    return ""
  }

  private async inferDescription(
    container: Locator,
    knownFields: Array<string | undefined>
  ): Promise<string> {
    const known = knownFields
      .filter(Boolean)
      .map((value) => this.normalizeForCompare(value as string))
    const candidates = new Set<string>()

    const selectors = [
      ".pvs-entity__description",
      ".inline-show-more-text",
      ".inline-show-more-text__text",
      "span[aria-hidden='true']",
      "span.visually-hidden"
    ]

    for (const selector of selectors) {
      const texts = await container.locator(selector).allInnerTexts().catch(() => [])
      for (const text of texts) {
        const cleaned = this.cleanInlineText(text)
        if (cleaned) candidates.add(cleaned)
      }
    }

    const raw = await container.innerText().catch(() => "")
    for (const line of raw.split(/\r?\n/)) {
      const cleaned = this.cleanInlineText(line)
      if (cleaned) candidates.add(cleaned)
    }

    const filtered = Array.from(candidates).filter((text) => {
      const normalized = this.normalizeForCompare(text)
      if (!normalized) return false
      if (known.includes(normalized)) return false
      if (this.isDateLike(text)) return false
      if (this.isLocationLike(text)) return false
      if (this.isEmploymentType(text)) return false
      return text.length >= 6
    })

    if (filtered.length === 0) return ""
    filtered.sort((a, b) => b.length - a.length)
    return filtered[0]
  }

  private isEmploymentType(text: string): boolean {
    return /full[- ]time|part[- ]time|internship|contract|freelance|self[- ]employed|temporary|apprenticeship/i.test(
      text
    )
  }

  private async readAboutText(container: Locator): Promise<string> {
    const inline = await this.readInlineDescription(container)
    if (inline) return inline

    const candidates = await container
      .locator("span[aria-hidden='true'], span.visually-hidden")
      .allInnerTexts()
      .catch(() => [])
    const cleaned = candidates.map((text) => this.cleanInlineText(text)).filter(Boolean)
    if (cleaned.length === 0) return ""
    cleaned.sort((a, b) => b.length - a.length)
    return cleaned[0]
  }

  private async inferFromHiddenTexts(
    container: Locator
  ): Promise<{ title?: string; company?: string; dates?: string; location?: string }> {
    const texts = await this.readAllHiddenTexts(container)
    if (texts.length === 0) return {}

    const dates = texts.find((text) => this.isDateLike(text))
    const location = texts.find((text) => this.isLocationLike(text))

    let company = texts.find(
      (text) => text.includes("·") && text !== dates && text !== location
    )
    if (!company) {
      company = texts.find(
        (text) => !this.isDateLike(text) && !this.isLocationLike(text)
      )
    }

    let title = texts.find(
      (text) =>
        text !== company &&
        text !== dates &&
        text !== location &&
        !text.includes("·")
    )
    if (!title) {
      title = texts.find((text) => text !== company && text !== dates && text !== location)
    }

    return { title, company, dates, location }
  }

  private isDateLike(text: string): boolean {
    const normalized = text.toLowerCase()
    if (/\b(19|20)\d{2}\b/.test(normalized) && /-/.test(normalized)) return true
    if (/\b(19|20)\d{2}\b/.test(normalized) && /present|atual|current/.test(normalized))
      return true
    return /(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|jan\.|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/i.test(
      text
    )
  }

  private isLocationLike(text: string): boolean {
    const normalized = text.toLowerCase()
    if (normalized.includes("remote") || normalized.includes("remoto")) return true
    if (normalized.includes("on-site") || normalized.includes("onsite")) return true
    if (normalized.includes("hybrid") || normalized.includes("híbrido")) return true
    return text.includes(",")
  }

  private async readAllHiddenTexts(container: Locator): Promise<string[]> {
    const texts = await container
      .locator("span[aria-hidden='true'], span.visually-hidden")
      .allInnerTexts()
      .catch(() => [])
    const cleaned = texts.map((text) => this.cleanInlineText(text)).filter(Boolean)
    const unique: string[] = []
    for (const text of cleaned) {
      if (!unique.includes(text)) unique.push(text)
    }
    return unique
  }

  private cleanInlineText(value: string): string {
    const normalized = this.normalizeText(value)
    if (!normalized) return ""

    return normalized
      .replace(/\s*…?\s*(see more|ver mais|mostrar mais|show more|see all)\s*$/i, "")
      .trim()
  }

  private normalizeText(value: string): string {
    return value.replace(/\s+/g, " ").trim()
  }

  private normalizeForCompare(value: string): string {
    return this.normalizeText(value).toLowerCase()
  }

  private normalizeProfileUrl(url: string): string {
    const clean = url.split("?")[0].split("#")[0]
    const match = clean.match(/https?:\/\/[^/]+\/in\/[^/]+/)
    return (match ? match[0] : clean).replace(/\/$/, "")
  }

  private dedupeExperiences(items: Experience[]): Experience[] {
    const seen = new Set<string>()
    const result: Experience[] = []

    for (const item of items) {
      const key = `${item.title}|${item.company}|${item.dates}|${item.location}`.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }

    return result
  }

  private log(message: string) {
    const color = "\x1b[36m"
    const reset = "\x1b[0m"
    console.log(`${color}[profile-scrap]${reset} ${message}`)
  }

  private async logSeeMoreCandidates(
    section: Locator,
    candidates: Locator
  ): Promise<void> {
    const globalButtons = this.page.locator("button.inline-show-more-text__button")
    const globalCount = await globalButtons.count()
    this.log(`See more candidatos globais (inline-show-more-text__button): ${globalCount}`)
    const globalSamples = await globalButtons.evaluateAll((nodes) =>
      nodes.slice(0, 6).map((node) => ({
        text: (node.textContent || "").trim(),
        aria: node.getAttribute("aria-label") || "",
        cls: (node as HTMLElement).className || ""
      }))
    )
    for (const sample of globalSamples) {
      this.log(
        `See more global: text="${sample.text}" aria="${sample.aria}" class="${sample.cls}"`
      )
    }

    const sectionButtons = section.locator("button, [role='button']")
    const sectionCount = await sectionButtons.count()
    this.log(`See more candidatos na seção (button/role=button): ${sectionCount}`)
    const sectionSamples = await sectionButtons.evaluateAll((nodes) =>
      nodes.slice(0, 6).map((node) => ({
        text: (node.textContent || "").trim(),
        aria: node.getAttribute("aria-label") || "",
        expanded: node.getAttribute("aria-expanded") || "",
        role: node.getAttribute("role") || "",
        tag: node.tagName || "",
        cls: (node as HTMLElement).className || ""
      }))
    )
    for (const sample of sectionSamples) {
      this.log(
        `See more seção: tag="${sample.tag}" role="${sample.role}" expanded="${sample.expanded}" text="${sample.text}" aria="${sample.aria}" class="${sample.cls}"`
      )
    }

    const candCount = await candidates.count()
    this.log(`See more candidatos filtrados: ${candCount}`)
    const candSamples = await candidates.evaluateAll((nodes) =>
      nodes.slice(0, 6).map((node) => ({
        text: (node.textContent || "").trim(),
        aria: node.getAttribute("aria-label") || "",
        expanded: node.getAttribute("aria-expanded") || "",
        role: node.getAttribute("role") || "",
        tag: node.tagName || "",
        cls: (node as HTMLElement).className || ""
      }))
    )
    for (const sample of candSamples) {
      this.log(
        `See more candidato: tag="${sample.tag}" role="${sample.role}" expanded="${sample.expanded}" text="${sample.text}" aria="${sample.aria}" class="${sample.cls}"`
      )
    }
  }

  private async expandInlineShowMore(container: Locator): Promise<void> {
    const buttons = container.locator(
      [
        "button.inline-show-more-text__button",
        "[role='button'].inline-show-more-text__button",
        "button[aria-label*='see more' i]",
        "button[aria-label*='ver mais' i]",
        "button[aria-label*='mostrar mais' i]",
        "[role='button'][aria-label*='see more' i]",
        "[role='button'][aria-label*='ver mais' i]",
        "[role='button'][aria-label*='mostrar mais' i]"
      ].join(", ")
    )
    const count = await buttons.count().catch(() => 0)
    if (count === 0) return

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i)
      const visible = await btn.isVisible().catch(() => false)
      if (!visible) continue
      const label = await btn
        .innerText()
        .then((text) => text.toLowerCase())
        .catch(() => "")
      const isSeeMore =
        label.includes("see more") ||
        label.includes("ver mais") ||
        label.includes("mostrar mais") ||
        label.includes("show more") ||
        label.includes("see all")
      const ariaLabel = await btn.getAttribute("aria-label").catch(() => "")
      const ariaMatches =
        (ariaLabel || "").toLowerCase().includes("see more") ||
        (ariaLabel || "").toLowerCase().includes("ver mais") ||
        (ariaLabel || "").toLowerCase().includes("mostrar mais") ||
        (ariaLabel || "").toLowerCase().includes("show more") ||
        (ariaLabel || "").toLowerCase().includes("see all")
      const className = (await btn.getAttribute("class").catch(() => "")) || ""
      const classMatches =
        className.includes("inline-show-more-text__button") ||
        className.includes("show-more") ||
        className.includes("see-more")
      const shouldClick = isSeeMore || ariaMatches || classMatches
      if (!shouldClick) continue
      await btn.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {})
      await btn.click({ timeout: 1500, force: true }).catch(() => {})
    }
  }
}
