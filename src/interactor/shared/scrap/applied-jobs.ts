import { Page } from "playwright";

import { LINKEDIN_URLS } from "../constants/linkedin-urls";
import type {
  AppliedJobResult,
  AppliedJobsRangePreset,
  AppliedJobsScanResult,
  ScanAppliedJobsOptions,
} from "../interface/scrap/jobs.types";
import { logger } from "../services/logger";
import { normalizeLinkedinUrl } from "../utils/linkedin-url";
import { normalizeWhitespace } from "../utils/normalize";

const SELECTORS = {
  cards: 'div[data-chameleon-result-urn*="jobPosting"]',
  firstJobLink: 'div[data-chameleon-result-urn*="jobPosting"] a[href*="/jobs/view/"]',
  pageState: ".artdeco-pagination__page-state, .artdeco-pagination__state--a11y",
  nextButton: ".artdeco-pagination__button--next",
} as const;

type RawAppliedJobCard = {
  urn: string
  title: string
  company: string
  location: string
  url: string
  appliedAt: string
};

type AppliedJobsFilter = {
  preset: AppliedJobsRangePreset
  days: number
  label: string
};

const FILTER_PRESETS: Record<Exclude<AppliedJobsRangePreset, "custom">, { days: number; label: string }> = {
  week: {
    days: 7,
    label: "1 semana",
  },
  month: {
    days: 30,
    label: "1 mês",
  },
  quarter: {
    days: 90,
    label: "3 meses",
  },
}

export class LinkedinAppliedJobsScrap {
  private readonly _page: Page

  constructor(page: Page) {
    this._page = page
  }

  getAppliedJobsUrl() {
    return `${LINKEDIN_URLS.base}/my-items/saved-jobs/?cardType=APPLIED`
  }

  async scan(options?: ScanAppliedJobsOptions): Promise<AppliedJobsScanResult> {
    const filter = this._resolveFilter(options)
    await this._waitForPage()

    const jobsByUrl = new Map<string, AppliedJobResult>()
    const seenPages = new Set<string>()
    let scannedPages = 0
    let totalPages: number | null = null
    let stoppedEarly = false

    while (true) {
      const pageState = await this._getPaginationState()
      const pageKey = pageState.label || `page-${scannedPages + 1}`
      if (seenPages.has(pageKey)) break
      seenPages.add(pageKey)

      const currentPage = pageState.current ?? scannedPages + 1
      totalPages = pageState.total ?? totalPages

      const items = await this._readCurrentPage(currentPage)
      const pageMatches = items.filter((item) => this._matchesFilter(item.appliedAgeDays, filter.days))
      const pageHasKnownOlderItems = items.some(
        (item) => item.appliedAgeDays !== null && item.appliedAgeDays > filter.days
      )
      const pageHasUnknownAge = items.some((item) => item.appliedAgeDays === null)

      for (const item of items) {
        if (!item.url || !this._matchesFilter(item.appliedAgeDays, filter.days)) continue
        jobsByUrl.set(item.url, {
          ...item,
          page: currentPage,
        })
      }

      scannedPages++
      logger.info(
        `[applied-jobs] filtro=${filter.label} | página ${currentPage}${totalPages ? `/${totalPages}` : ""} | acumulado=${jobsByUrl.size}`
      )

      if (pageMatches.length === 0 && pageHasKnownOlderItems && !pageHasUnknownAge) {
        stoppedEarly = true
        break
      }

      if (!(await this._hasNextPage())) break

      const advanced = await this._goToNextPage(pageState.label, items[0]?.url || "")
      if (!advanced) break
    }

    return {
      total: jobsByUrl.size,
      scannedPages,
      totalPages,
      filterPreset: filter.preset,
      filterDays: filter.days,
      filterLabel: filter.label,
      stoppedEarly,
      jobs: Array.from(jobsByUrl.values()),
    }
  }

  private async _waitForPage() {
    await this._page.waitForSelector(SELECTORS.cards, {
      state: "attached",
      timeout: 15_000,
    }).catch(async () => {
      await this._page.waitForSelector("h1", {
        state: "visible",
        timeout: 5_000,
      })
    })
  }

  private async _readCurrentPage(pageNumber: number): Promise<AppliedJobResult[]> {
    const rawItems = await this._page.evaluate(
      ({ cardsSelector }) => {
        const normalize = (value: string | null | undefined) =>
          (value || "").replace(/\s+/g, " ").trim()

        const cards = Array.from(document.querySelectorAll(cardsSelector))
        return cards.map((card) => {
          const element = card as HTMLElement
          const jobLink = element.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement | null
          const titleLink =
            (element.querySelector('.t-16 a[href*="/jobs/view/"]') as HTMLAnchorElement | null) ||
            jobLink
          const companyNode = element.querySelector(".t-14.t-black.t-normal")
          const locationNodes = Array.from(element.querySelectorAll(".t-14.t-normal"))
          const appliedAtNode = element.querySelector(
            ".workflow-posted-jobs__jobs-insight .reusable-search-simple-insight__text--small"
          )

          return {
            urn: normalize(element.getAttribute("data-chameleon-result-urn")),
            title: normalize(titleLink?.textContent),
            company: normalize(companyNode?.textContent),
            location: normalize(locationNodes[0]?.textContent),
            url: normalize(jobLink?.href),
            appliedAt: normalize(appliedAtNode?.textContent),
          }
        })
      },
      { cardsSelector: SELECTORS.cards }
    )

    return rawItems
      .map((item): AppliedJobResult | null => {
        const url = item.url ? normalizeLinkedinUrl(item.url) : ""
        if (!url) return null
        return {
          urn: item.urn,
          title: normalizeWhitespace(item.title || ""),
          company: normalizeWhitespace(item.company || ""),
          location: normalizeWhitespace(item.location || ""),
          url,
          appliedAt: normalizeWhitespace(item.appliedAt || ""),
          appliedAgeDays: this._parseAppliedAgeDays(item.appliedAt || ""),
          page: pageNumber,
        }
      })
      .filter((item): item is AppliedJobResult => Boolean(item))
  }

  private async _getPaginationState() {
    const label = await this._page
      .locator(SELECTORS.pageState)
      .first()
      .textContent()
      .then((value) => normalizeWhitespace(value || ""))
      .catch(() => "")

    if (!label) {
      return {
        label: "",
        current: null as number | null,
        total: null as number | null,
      }
    }

    const match = label.match(/page\s+(\d+)\s+of\s+(\d+)/i)
    if (!match) {
      return {
        label,
        current: null,
        total: null,
      }
    }

    return {
      label,
      current: Number(match[1]),
      total: Number(match[2]),
    }
  }

  private async _hasNextPage() {
    const button = this._page.locator(SELECTORS.nextButton).first()
    if ((await button.count().catch(() => 0)) === 0) return false
    return !(await button.isDisabled().catch(() => true))
  }

  private async _goToNextPage(previousLabel: string, previousFirstUrl: string) {
    const nextButton = this._page.locator(SELECTORS.nextButton).first()
    if ((await nextButton.count().catch(() => 0)) === 0) return false

    await nextButton.scrollIntoViewIfNeeded().catch(() => undefined)

    await Promise.all([
      this._page
        .waitForFunction(
          ({ pageSelector, linkSelector, lastLabel, lastUrl }) => {
            const label = document.querySelector(pageSelector)?.textContent?.replace(/\s+/g, " ").trim() || ""
            const href =
              (document.querySelector(linkSelector) as HTMLAnchorElement | null)?.href?.replace(/[?#].*$/, "") || ""
            return (label && label !== lastLabel) || (href && href !== lastUrl)
          },
          {
            pageSelector: SELECTORS.pageState,
            linkSelector: SELECTORS.firstJobLink,
            lastLabel: previousLabel,
            lastUrl: previousFirstUrl,
          },
          { timeout: 15_000 }
        )
        .catch(() => undefined),
      nextButton.click({ force: true }),
    ])

    await this._page.waitForTimeout(600)
    return true
  }

  private _resolveFilter(options?: ScanAppliedJobsOptions): AppliedJobsFilter {
    const preset = this._normalizePreset(options?.periodPreset)
    if (preset === "custom") {
      const customDays = this._normalizeCustomDays(options?.customDays)
      return {
        preset,
        days: customDays,
        label: `${customDays} dia(s)`,
      }
    }

    const filter = FILTER_PRESETS[preset]
    return {
      preset,
      days: filter.days,
      label: filter.label,
    }
  }

  private _normalizePreset(value?: AppliedJobsRangePreset): AppliedJobsRangePreset {
    if (value === "week" || value === "month" || value === "quarter" || value === "custom") {
      return value
    }
    return "month"
  }

  private _normalizeCustomDays(value?: number) {
    if (!Number.isFinite(value)) return 30
    const normalized = Math.trunc(value ?? 0)
    if (normalized <= 0) return 30
    return Math.min(normalized, 3650)
  }

  private _matchesFilter(appliedAgeDays: number | null, filterDays: number) {
    if (appliedAgeDays === null) return true
    return appliedAgeDays <= filterDays
  }

  private _parseAppliedAgeDays(value: string) {
    const raw = normalizeWhitespace(value || "")
    if (!raw) return null

    const normalized = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()

    if (
      normalized.includes("just now") ||
      normalized.includes("agora mesmo") ||
      normalized.includes("today") ||
      normalized.includes("hoje")
    ) {
      return 0
    }

    if (normalized.includes("yesterday") || normalized.includes("ontem")) {
      return 1
    }

    const unitMatchers: Array<{ regex: RegExp; factor: number }> = [
      { regex: /(\d+)\s*(months?|mo|mes|meses)\b/, factor: 30 },
      { regex: /(\d+)\s*(weeks?|wk|w|semana|semanas)\b/, factor: 7 },
      { regex: /(\d+)\s*(days?|d|dia|dias)\b/, factor: 1 },
      { regex: /(\d+)\s*(hours?|hrs?|hr|h|hora|horas)\b/, factor: 1 / 24 },
      { regex: /(\d+)\s*(minutes?|mins?|min|m(?!o)\b|minuto|minutos)\b/, factor: 1 / (24 * 60) },
      { regex: /(\d+)\s*(years?|yrs?|yr|y|ano|anos)\b/, factor: 365 },
    ]

    for (const matcher of unitMatchers) {
      const match = normalized.match(matcher.regex)
      if (match) {
        return Number(match[1]) * matcher.factor
      }
    }

    const absoluteDateValue = normalized
      .replace(/^applied\s+on\s+/, "")
      .replace(/^applied\s+/, "")
      .replace(/^aplicado\s+em\s+/, "")
      .replace(/^candidatou[-\s]*se\s+em\s+/, "")
      .trim()

    const parsedDate = Date.parse(absoluteDateValue)
    if (Number.isNaN(parsedDate)) return null

    return Math.max(0, (Date.now() - parsedDate) / (24 * 60 * 60 * 1000))
  }
}
