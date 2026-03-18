import { Page } from "playwright";

import { GptClient } from "../../../shared/ai/gpt-client";
import { env } from "../../../shared/env";
import { logger } from "../../../shared/services/logger";
import {
    readUserProfile,
    UserProfile,
    UserProfileCompensation,
    UserProfileLinkedinEducation,
    UserProfileLinkedinExperience,
    UserProfileLinkedinProject,
    UserProfileLinkedinSnapshot,
    UserProfileReview,
    UserProfileStackExperience,
    saveUserProfileAsync
} from "../../../shared/user-profile";
import { LinkedinCoreFeatures } from "../../linkedin-core";

type RawProfileData = {
    name: string
    headline: string
    location: string
    website: string
    connections: string
    currentCompany: string
    topEducation: string
    about: string
    avatarUrl: string
    backgroundImageUrl: string
    topSkills: string[]
    languages: string[]
    experiences: RawProfileExperience[]
    education: RawProfileEducation[]
    projects: RawProfileProject[]
}

type RawProfileExperience = {
    title: string
    companyLine: string
    dateLine: string
    locationLine: string
    description: string
}

type RawProfileEducation = {
    school: string
    degree: string
    period: string
}

type RawProfileProject = {
    title: string
    description: string
}

type StackPattern = {
    name: string
    patterns: RegExp[]
}

const STACK_PATTERNS: StackPattern[] = [
    { name: "React Native", patterns: [/\breact\s+native\b/i] },
    { name: "React", patterns: [/\breact(?:\.js|js)?\b/i] },
    { name: "Next.js", patterns: [/\bnext(?:\.js|js)?\b/i] },
    { name: "Angular", patterns: [/\bangular(?:js|\s*\d+\+?)?\b/i] },
    { name: "Node.js", patterns: [/\bnode(?:\.js|js)?\b/i] },
    { name: "NestJS", patterns: [/\bnest(?:\.js|js)?\b/i] },
    { name: "TypeScript", patterns: [/\btypescript\b/i] },
    { name: "JavaScript", patterns: [/\bjavascript\b/i] },
    { name: "Web3.js", patterns: [/\bweb3(?:\.js|js)?\b/i] },
    { name: "Micro Frontends", patterns: [/\bmicro[\s-]?frontends?\b/i] },
    { name: "Accessibility", patterns: [/\baccessibility\b/i, /\bacessibilidade\b/i] },
    { name: "WCAG", patterns: [/\bwcag\b/i] },
    { name: "Datadog", patterns: [/\bdatadog\b/i] },
    { name: "Amplitude", patterns: [/\bamplitude\b/i] },
    { name: "Docker", patterns: [/\bdocker\b/i] },
    { name: "PostgreSQL", patterns: [/\bpostgres(?:ql)?\b/i] },
    { name: "MongoDB", patterns: [/\bmongodb\b/i] },
    { name: "MySQL", patterns: [/\bmysql\b/i] },
    { name: "SQL", patterns: [/\bsql\b/i] },
    { name: "Cypress", patterns: [/\bcypress\b/i] },
    { name: "E2E Testing", patterns: [/\be2e\b/i, /end[\s-]?to[\s-]?end/i] },
    { name: "Redux Saga", patterns: [/\bredux[\s-]?saga\b/i] },
    { name: "Redux", patterns: [/\bredux\b/i] },
    { name: "Styled Components", patterns: [/styled[\s-]?components?/i] },
    { name: "Sass", patterns: [/\bsass\b/i] },
    { name: "Bootstrap", patterns: [/\bbootstrap\b/i] },
    { name: "Expo", patterns: [/\bexpo\b/i] },
    { name: "Firebase", patterns: [/\bfirebase\b/i] },
    { name: "Express", patterns: [/\bexpress(?:\.js|js)?\b/i] },
    { name: "Socket.IO", patterns: [/socket\.?io/i] },
    { name: "AdonisJS", patterns: [/\badonis(?:js)?\b/i] },
    { name: "Java", patterns: [/\bjava\b/i] },
    { name: "Spring Boot", patterns: [/\bspring\s*boot\b/i, /\bspringboot\b/i] },
    { name: "Plasmo", patterns: [/\bplasmo\b/i] },
    { name: "REST API", patterns: [/\bapi\s*rest\b/i, /\brest(?:ful)?\b/i] }
]

const MONTH_LOOKUP: Record<string, number> = {
    jan: 0,
    janeiro: 0,
    feb: 1,
    fev: 1,
    fevereiro: 1,
    mar: 2,
    marco: 2,
    march: 2,
    apr: 3,
    abr: 3,
    abril: 3,
    april: 3,
    may: 4,
    mai: 4,
    maio: 4,
    jun: 5,
    junho: 5,
    june: 5,
    jul: 6,
    julho: 6,
    july: 6,
    aug: 7,
    ago: 7,
    agosto: 7,
    august: 7,
    sep: 8,
    set: 8,
    setembro: 8,
    september: 8,
    oct: 9,
    out: 9,
    outubro: 9,
    october: 9,
    nov: 10,
    novembro: 10,
    november: 10,
    dec: 11,
    dez: 11,
    dezembro: 11,
    december: 11
}

const normalizeText = (value: unknown) =>
    typeof value === "string"
        ? value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
        : ""

const uniqueStrings = (values: string[]) => Array.from(new Set(values.map((item) => normalizeText(item)).filter(Boolean)))

const normalizeKey = (value: string) =>
    value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")

const formatMonthsAsYears = (months: number) => {
    if (!Number.isFinite(months) || months <= 0) return "0"
    const years = months / 12
    if (Math.abs(years - Math.trunc(years)) < 1e-9) {
        return String(Math.trunc(years))
    }
    return years.toFixed(1).replace(/\.0$/, "")
}

const formatMonthsLabel = (months: number) => {
    if (!Number.isFinite(months) || months <= 0) return "0 meses"
    const years = Math.floor(months / 12)
    const remainder = months % 12
    const parts: string[] = []
    if (years > 0) {
        parts.push(`${years} ${years === 1 ? "ano" : "anos"}`)
    }
    if (remainder > 0) {
        parts.push(`${remainder} ${remainder === 1 ? "mês" : "meses"}`)
    }
    return parts.join(" e ") || "0 meses"
}

const toIsoDate = (value: Date | null) => {
    if (!value) return null
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)).toISOString()
}

const monthsBetween = (start: Date, end: Date) => {
    const raw =
        (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        (end.getUTCMonth() - start.getUTCMonth()) +
        1

    return Math.max(raw, 1)
}

const parseDateToken = (value: string, isEnd: boolean) => {
    const normalized = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\./g, "")
        .toLowerCase()
        .trim()

    if (!normalized) return null
    if (/(present|momento|atual|current)/i.test(normalized)) {
        const now = new Date()
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    }

    const yearMatch = normalized.match(/\b(19|20)\d{2}\b/)
    if (!yearMatch) return null
    const year = Number(yearMatch[0])
    const monthEntry = Object.entries(MONTH_LOOKUP).find(([month]) => normalized.includes(month))
    const month = monthEntry ? monthEntry[1] : isEnd ? 11 : 0
    return new Date(Date.UTC(year, month, 1))
}

const parseDateRange = (value: string) => {
    const normalized = normalizeText(value)
    if (!normalized) {
        return {
            startDate: null,
            endDate: null,
            isCurrent: false,
            dateRangeLabel: ""
        }
    }

    const rangeText = normalized.split("·")[0].trim()
    const parts = rangeText.split(/\s+-\s+/)
    const startDate = parts[0] ? parseDateToken(parts[0], false) : null
    const endDate = parts[1] ? parseDateToken(parts[1], true) : null

    return {
        startDate,
        endDate,
        isCurrent: /present|momento|atual|current/i.test(parts[1] || ""),
        dateRangeLabel: rangeText
    }
}

const extractStacksFromText = (value: string) => {
    const source = normalizeText(value)
    if (!source) return []

    return STACK_PATTERNS
        .filter((item) => item.patterns.some((pattern) => pattern.test(source)))
        .map((item) => item.name)
}

const buildGeneratedAnswers = (
    compensation: UserProfileCompensation,
    stackExperience: Record<string, UserProfileStackExperience>
) => {
    const answers: Record<string, string> = {}

    const compensationAliases: Array<[string[], string]> = [
        [["valor hora dolar", "hourly rate usd", "hourly rate dollar", "valor hora usd"], compensation.hourlyUsd],
        [["valor hora reais", "valor hora brl", "hourly rate brl", "hourly rate reais"], compensation.hourlyBrl],
        [["pretensao clt", "pretensao salarial clt", "salary expectation clt"], compensation.clt],
        [["pretensao pj", "pretensao salarial pj", "salary expectation pj"], compensation.pj]
    ]

    for (const [aliases, value] of compensationAliases) {
        if (!value) continue
        for (const alias of aliases) {
            answers[normalizeKey(alias)] = value
        }
    }

    for (const [stack, experience] of Object.entries(stackExperience)) {
        const aliases = [
            `${stack} experience`,
            `${stack} years of experience`,
            `years of ${stack} experience`,
            `experience with ${stack}`,
            `${stack} experience years`
        ]

        for (const alias of aliases) {
            answers[normalizeKey(alias)] = experience.years
        }
    }

    return answers
}

const buildSummary = (
    snapshot: UserProfileLinkedinSnapshot,
    stackExperience: Record<string, UserProfileStackExperience>,
    compensation?: UserProfileCompensation,
    birthDate?: string
) => {
    const stackPreview = Object.entries(stackExperience)
        .sort((left, right) => right[1].months - left[1].months)
        .slice(0, 10)
        .map(([stack, experience]) => `${stack} (${experience.durationLabel || `${experience.years} anos`})`)
        .join(", ")

    const compensationPreview = [
        compensation?.hourlyUsd ? `USD/h: ${compensation.hourlyUsd}` : "",
        compensation?.hourlyBrl ? `BRL/h: ${compensation.hourlyBrl}` : "",
        compensation?.clt ? `Pretensão CLT: ${compensation.clt}` : "",
        compensation?.pj ? `Pretensão PJ: ${compensation.pj}` : ""
    ]
        .filter(Boolean)
        .join(" | ")

    return [
        [snapshot.name, snapshot.headline].filter(Boolean).join(" - "),
        snapshot.location ? `Location: ${snapshot.location}` : "",
        snapshot.currentCompany ? `Current company: ${snapshot.currentCompany}` : "",
        birthDate ? `Birth date: ${birthDate}` : "",
        compensationPreview ? `Compensation: ${compensationPreview}` : "",
        snapshot.about ? `About: ${snapshot.about}` : "",
        snapshot.topSkills.length > 0 ? `Top skills: ${snapshot.topSkills.join(", ")}` : "",
        snapshot.languages.length > 0 ? `Languages: ${snapshot.languages.join(", ")}` : "",
        stackPreview ? `Stack experience: ${stackPreview}` : ""
    ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 4_000)
}

const buildStackExperienceReview = (stackExperience: Record<string, UserProfileStackExperience>) =>
    Object.entries(stackExperience).map(([stack, experience]) => ({
        stack,
        first_seen_at: experience.firstSeenAt,
        experience_months: experience.months,
        experience_years: experience.years,
        experience_label: experience.durationLabel,
        source_companies: experience.sourceCompanies,
        source_titles: experience.sourceTitles
    }))

const buildSavedCompensationReview = (compensation: UserProfileCompensation) => ({
    hourly_usd: compensation.hourlyUsd || "",
    hourly_brl: compensation.hourlyBrl || "",
    pretensao_clt: compensation.clt || "",
    pretensao_pj: compensation.pj || ""
})

const buildSavedPersonalReview = (birthDate?: string) => ({
    birth_date: birthDate || ""
})

export class LinkedinProfileReviewFlow {
    private readonly _page: Page
    private readonly _navigator: LinkedinCoreFeatures
    private readonly _gpt: GptClient

    constructor(page: Page, navigator: LinkedinCoreFeatures) {
        this._page = page
        this._navigator = navigator
        this._gpt = new GptClient(env.gpt)
    }

    async reviewOwnProfile(): Promise<UserProfile> {
        await this._navigator.goToLinkedinURL("https://www.linkedin.com/in/me/")
        await this._page.waitForSelector("main h1", { timeout: 30_000 })
        await this._page.waitForTimeout(1_200)

        const rawProfile = await this._scrapeProfile()
        const snapshot = this._buildSnapshot(rawProfile)
        const currentProfile = readUserProfile()
        const birthDate = currentProfile.birthDate
        const compensation = currentProfile.compensation
        const review = await this._createReview(snapshot.linkedinProfile, compensation, snapshot.stackExperience, birthDate)
        const generatedAnswers = buildGeneratedAnswers(compensation, snapshot.stackExperience)

        return saveUserProfileAsync({
            summary: buildSummary(snapshot.linkedinProfile, snapshot.stackExperience, compensation, birthDate),
            answers: {
                ...generatedAnswers
            },
            stackExperience: snapshot.stackExperience,
            linkedinProfile: snapshot.linkedinProfile,
            ...(review ? { profileReview: review } : {})
        })
    }

    private async _scrapeProfile(): Promise<RawProfileData> {
        const baseProfile = await this._page.evaluate(() => {
            const normalizeText = (value: unknown) =>
                typeof value === "string"
                    ? value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
                    : ""

            const unique = (values: string[]) =>
                Array.from(new Set(values.map((item) => normalizeText(item)).filter(Boolean)))

            const toLines = (value: string) =>
                value
                    .split(/\n+/)
                    .map((item) => normalizeText(item))
                    .filter(Boolean)

            const cleanAriaLabel = (value: string) =>
                normalizeText(value)
                    .replace(/\.?\s*Click to skip to .*$/i, "")
                    .replace(/^Current company:\s*/i, "")
                    .replace(/^Education:\s*/i, "")
                    .trim()

            const getSection = (id: string) => document.getElementById(id)?.closest("section") || null

            const getFirstText = (root: ParentNode | null, selectors: string[]) => {
                if (!root) return ""
                for (const selector of selectors) {
                    const node = root.querySelector(selector)
                    const text = normalizeText(node?.textContent || "")
                    if (text) return text
                }
                return ""
            }

            const getLongestText = (root: ParentNode | null) => {
                if (!root) return ""
                const candidates = unique([
                    ...Array.from(root.querySelectorAll("span.visually-hidden")).map((node) =>
                        normalizeText(node.textContent || "")
                    ),
                    ...Array.from(root.querySelectorAll("span[aria-hidden='true']")).map((node) =>
                        normalizeText(node.textContent || "")
                    ),
                    normalizeText((root as HTMLElement).innerText || root.textContent || "")
                ])

                return candidates.sort((left, right) => right.length - left.length)[0] || ""
            }

            const topCard = document.querySelector("main section.artdeco-card")
            const aboutSection = getSection("about")
            const experienceSection = getSection("experience")
            const educationSection = getSection("education")
            const projectsSection = getSection("projects")
            const skillsSection = getSection("skills")
            const languagesSection = getSection("languages")

            const topSkillsFromAbout = unique(
                Array.from(aboutSection?.querySelectorAll("span[aria-hidden='true']") || [])
                    .map((node) => normalizeText(node.textContent || ""))
                    .filter((text) => text.includes("•"))
                    .flatMap((text) => text.split("•").map((item) => normalizeText(item)))
            )

            const skillItems = unique(
                Array.from(
                    skillsSection?.querySelectorAll(
                        "a[data-field='skill_card_skill_topic'], a[href*='PROFILE_PAGE_SKILL_NAVIGATION']"
                    ) || []
                ).map((node) => normalizeText(node.textContent || ""))
            )

            const languageItems = unique(
                Array.from(languagesSection?.querySelectorAll("[data-view-name='profile-component-entity']") || []).map(
                    (node) => {
                        const lines = toLines((node as HTMLElement).innerText || node.textContent || "")
                        if (lines.length === 0) return ""
                        return lines[1] ? `${lines[0]} (${lines[1]})` : lines[0]
                    }
                )
            )

            const educationNodes = Array.from(
                educationSection?.querySelectorAll("a[href*='/add-edit/EDUCATION/'][href*='entityUrn=']") || []
            )
            const seenEducationKeys = new Set<string>()
            const education = educationNodes
                .map((node) => {
                    const anchor = node as HTMLAnchorElement
                    const href = anchor.href || ""
                    const keyMatch = href.match(/entityUrn=([^&]+)/)
                    const key = keyMatch ? keyMatch[1] : href
                    if (seenEducationKeys.has(key)) return null
                    seenEducationKeys.add(key)

                    const lines = toLines(anchor.innerText || anchor.textContent || "")
                    if (lines.length === 0) return null
                    return {
                        school: lines[0] || "",
                        degree: lines[1] || "",
                        period: lines[2] || ""
                    }
                })
                .filter((item): item is RawProfileEducation => Boolean(item && item.school))

            const projectNodes = Array.from(
                projectsSection?.querySelectorAll("[data-view-name='profile-component-entity']") || []
            )
            const projects = projectNodes
                .map((node) => {
                    const lines = toLines((node as HTMLElement).innerText || node.textContent || "")
                    if (lines.length === 0) return null
                    return {
                        title: lines[0] || "",
                        description: lines.slice(1).join(" ")
                    }
                })
                .filter((item): item is RawProfileProject => Boolean(item && item.title))

            return {
                name: getFirstText(topCard, ["h1"]),
                headline: getFirstText(topCard, ["div.text-body-medium.break-words", "[data-generated-suggestion-target]"]),
                location: getFirstText(topCard, [
                    "span.text-body-small.inline.t-black--light.break-words",
                    ".text-body-small.inline.t-black--light.break-words"
                ]),
                website: normalizeText(
                    (topCard?.querySelector(".pv-top-card--website a[href]") as HTMLAnchorElement | null)?.href ||
                        ""
                ),
                connections:
                    toLines(
                        (
                            topCard?.querySelector("a[href*='/mynetwork/invite-connect/connections/']") as HTMLElement | null
                        )?.innerText || ""
                    )[0] || "",
                currentCompany: cleanAriaLabel(
                    (
                        topCard?.querySelector("button[aria-label^='Current company:']") as HTMLButtonElement | null
                    )?.getAttribute("aria-label") || ""
                ),
                topEducation: cleanAriaLabel(
                    (
                        topCard?.querySelector("button[aria-label^='Education:']") as HTMLButtonElement | null
                    )?.getAttribute("aria-label") || ""
                ),
                about: getLongestText(aboutSection?.querySelector("div[dir='ltr']") || aboutSection),
                avatarUrl: "",
                backgroundImageUrl: "",
                topSkills: unique([...topSkillsFromAbout, ...skillItems]).slice(0, 24),
                languages: languageItems,
                experiences: [],
                education,
                projects
            }
        })

        const { avatarSrc, backgroundSrc } = await this._page.evaluate(() => {
            const avatarImg = document.querySelector("img.profile-photo-edit__preview") as HTMLImageElement | null
            const bgImg =
                (document.querySelector("img#profile-background-image-target-image") as HTMLImageElement | null) ||
                (document.querySelector("img.profile-background-image__image") as HTMLImageElement | null)
            return {
                avatarSrc: avatarImg?.src || "",
                backgroundSrc: bgImg?.src || ""
            }
        })

        const [avatarUrl, backgroundImageUrl] = await Promise.all([
            this._downloadImageAsDataUrl(avatarSrc),
            this._downloadImageAsDataUrl(backgroundSrc)
        ])

        const fallbackExperiences = await this._scrapeExperienceEntriesFromCurrentPage()
        const experiences = await this._scrapeAllExperiences(fallbackExperiences)

        return {
            ...baseProfile,
            avatarUrl,
            backgroundImageUrl,
            experiences
        }
    }

    private async _downloadImageAsDataUrl(url: string): Promise<string> {
        if (!url) return ""
        try {
            const response = await this._page.context().request.get(url)
            if (!response.ok()) return ""
            const buffer = await response.body()
            const contentType = (response.headers()["content-type"] || "image/jpeg").split(";")[0].trim()
            return `data:${contentType};base64,${buffer.toString("base64")}`
        } catch {
            return ""
        }
    }

    private async _scrapeAllExperiences(fallback: RawProfileExperience[]) {
        const detailsUrl = await this._resolveExperienceDetailsUrl()
        if (!detailsUrl) return fallback

        try {
            await this._navigator.goToLinkedinURL(detailsUrl)
            await this._page.waitForLoadState("domcontentloaded")
            await this._page.waitForTimeout(1_000)
            await this._scrollToPageEnd()

            const experiences = await this._scrapeExperienceEntriesFromCurrentPage()
            if (experiences.length > 0) {
                return experiences
            }
        } catch (error) {
            logger.warn("Unable to scrape full experience details", error)
        }

        return fallback
    }

    private async _resolveExperienceDetailsUrl() {
        const detailLink = this._page
            .locator("a#navigation-index-edit-position, a[href*='/details/experience']")
            .first()

        const href = await detailLink.getAttribute("href").catch(() => null)
        if (href) {
            try {
                return new URL(href, this._page.url()).toString()
            } catch {
                return href
            }
        }

        try {
            const current = new URL(this._page.url())
            const match = current.pathname.match(/^\/in\/[^/]+\/?/)
            if (!match) return null
            return `${current.origin}${match[0].replace(/\/$/, "")}/details/experience/`
        } catch {
            return null
        }
    }

    private async _scrollToPageEnd() {
        let previousHeight = 0

        for (let i = 0; i < 16; i++) {
            const height = await this._page.evaluate(() => document.body.scrollHeight)
            if (height === previousHeight) break
            previousHeight = height

            await this._page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight)
            })
            await this._page.waitForTimeout(700)
        }
    }

    private async _scrapeExperienceEntriesFromCurrentPage(): Promise<RawProfileExperience[]> {
        return this._page.evaluate(() => {
            const normalizeText = (value: unknown) =>
                typeof value === "string"
                    ? value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
                    : ""

            const unique = (values: string[]) =>
                Array.from(new Set(values.map((item) => normalizeText(item)).filter(Boolean)))

            const toLines = (value: string) =>
                value
                    .split(/\n+/)
                    .map((item) => normalizeText(item))
                    .filter(Boolean)

            const looksLikeDateLine = (value: string) =>
                /\b(19|20)\d{2}\b/.test(value) || /(present|momento|atual|current)/i.test(value)

            const looksLikeDurationLine = (value: string) =>
                /\b\d+\s*(?:yr|yrs|year|years|ano|anos|mo|mos|mes|meses)\b/i.test(value)

            const isMetaLine = (value: string) =>
                /^(edit|editar|delete|excluir|save|salvar|cancel|cancelar)$/i.test(value)

            const experienceNodes = Array.from(
                document.querySelectorAll("a[href*='/add-edit/POSITION/'][href*='entityUrn=']")
            )
            const seenExperienceKeys = new Set<string>()

            return experienceNodes
                .map((node) => {
                    const anchor = node as HTMLAnchorElement
                    const href = anchor.href || ""
                    const keyMatch = href.match(/entityUrn=([^&]+)/)
                    const key = keyMatch ? keyMatch[1] : href
                    if (seenExperienceKeys.has(key)) return null
                    seenExperienceKeys.add(key)

                    const root =
                        anchor.closest("[data-view-name='profile-component-entity']") ||
                        anchor.closest("li") ||
                        anchor

                    const anchorLines = toLines(anchor.innerText || anchor.textContent || "")
                    const title = anchorLines[0] || ""
                    const rootLines = unique(toLines((root as HTMLElement).innerText || root.textContent || "")).filter(
                        (line) => line && !isMetaLine(line)
                    )
                    const detailsLines = rootLines.filter((line) => line !== title)
                    const dateLine = detailsLines.find((line) => looksLikeDateLine(line)) || ""
                    const dateIndex = dateLine ? detailsLines.indexOf(dateLine) : -1
                    const companyCandidates = dateIndex >= 0 ? detailsLines.slice(0, dateIndex) : detailsLines
                    const companyLine =
                        companyCandidates.find((line) => !looksLikeDurationLine(line)) ||
                        detailsLines.find((line) => !looksLikeDateLine(line) && !looksLikeDurationLine(line)) ||
                        ""
                    const locationCandidates =
                        dateIndex >= 0
                            ? detailsLines.slice(dateIndex + 1)
                            : detailsLines.slice(Math.max(detailsLines.indexOf(companyLine) + 1, 0))
                    const locationLine =
                        locationCandidates.find((line) => !looksLikeDurationLine(line) && line !== companyLine) || ""
                    const headerLines = [title, companyLine, dateLine, locationLine].filter(Boolean)
                    const fallbackDescriptionLines = detailsLines.filter(
                        (line) =>
                            ![companyLine, dateLine, locationLine].includes(line) &&
                            !looksLikeDurationLine(line)
                    )
                    const descriptionLines = unique(
                        [
                            ...Array.from(
                                root.querySelectorAll(
                                    "div[dir='ltr'] span.visually-hidden, div[dir='ltr'] span[aria-hidden='true']"
                                )
                            )
                                .map((item) => normalizeText(item.textContent || ""))
                                .filter((text) => text && !headerLines.includes(text)),
                            ...fallbackDescriptionLines
                        ]
                    )

                    return {
                        title: title || rootLines[0] || "",
                        companyLine,
                        dateLine,
                        locationLine,
                        description: descriptionLines.join("\n")
                    }
                })
                .filter((item): item is RawProfileExperience => Boolean(item && item.title))
        })
    }

    private _buildSnapshot(raw: RawProfileData) {
        const experiences = raw.experiences
            .map((item) => this._normalizeExperience(item))
            .filter((item): item is UserProfileLinkedinExperience => Boolean(item))

        const stackExperience = this._buildStackExperience(experiences)
        const totalExperienceMonths = this._calculateTotalExperienceMonths(experiences)

        const linkedinProfile: UserProfileLinkedinSnapshot = {
            capturedAt: new Date().toISOString(),
            name: raw.name,
            headline: raw.headline,
            location: raw.location,
            website: raw.website,
            connections: raw.connections,
            currentCompany: raw.currentCompany,
            topEducation: raw.topEducation,
            about: raw.about,
            avatarUrl: raw.avatarUrl,
            backgroundImageUrl: raw.backgroundImageUrl,
            topSkills: uniqueStrings(raw.topSkills),
            languages: uniqueStrings(raw.languages),
            experiences,
            education: raw.education
                .map((item) => this._normalizeEducation(item))
                .filter((item): item is UserProfileLinkedinEducation => Boolean(item)),
            projects: raw.projects
                .map((item) => this._normalizeProject(item))
                .filter((item): item is UserProfileLinkedinProject => Boolean(item)),
            totalExperienceMonths,
            totalExperienceLabel: formatMonthsLabel(totalExperienceMonths)
        }

        return {
            linkedinProfile,
            stackExperience
        }
    }

    private _normalizeExperience(raw: RawProfileExperience): UserProfileLinkedinExperience | null {
        const title = normalizeText(raw.title)
        if (!title) return null

        const companyLine = normalizeText(raw.companyLine)
        const [company, employmentType] = companyLine
            .split("·")
            .map((item) => normalizeText(item))
            .filter(Boolean)

        const dateRange = parseDateRange(raw.dateLine)
        const stacks = uniqueStrings(
            extractStacksFromText([raw.title, raw.companyLine, raw.description].filter(Boolean).join("\n"))
        )

        return {
            title,
            company: company || "",
            employmentType: employmentType || "",
            location: normalizeText(raw.locationLine),
            dateRangeLabel: dateRange.dateRangeLabel,
            description: normalizeText(raw.description),
            startDate: toIsoDate(dateRange.startDate),
            endDate: toIsoDate(dateRange.endDate),
            isCurrent: dateRange.isCurrent,
            stacks
        }
    }

    private _normalizeEducation(raw: RawProfileEducation): UserProfileLinkedinEducation | null {
        const school = normalizeText(raw.school)
        if (!school) return null

        return {
            school,
            degree: normalizeText(raw.degree),
            period: normalizeText(raw.period)
        }
    }

    private _normalizeProject(raw: RawProfileProject): UserProfileLinkedinProject | null {
        const title = normalizeText(raw.title)
        if (!title) return null

        return {
            title,
            description: normalizeText(raw.description)
        }
    }

    private _buildStackExperience(experiences: UserProfileLinkedinExperience[]) {
        const now = new Date()
        const stacks: Record<string, UserProfileStackExperience> = {}

        for (const experience of experiences) {
            if (!experience.startDate) continue
            const start = new Date(experience.startDate)
            if (Number.isNaN(start.getTime())) continue

            for (const stack of experience.stacks) {
                const current = stacks[stack]
                if (!current || new Date(current.firstSeenAt).getTime() > start.getTime()) {
                    const experienceMonths = monthsBetween(start, now)
                    stacks[stack] = {
                        firstSeenAt: experience.startDate,
                        months: experienceMonths,
                        years: formatMonthsAsYears(experienceMonths),
                        durationLabel: formatMonthsLabel(experienceMonths),
                        sourceCompanies: uniqueStrings([experience.company]),
                        sourceTitles: uniqueStrings([experience.title])
                    }
                    continue
                }

                stacks[stack] = {
                    ...current,
                    sourceCompanies: uniqueStrings([...current.sourceCompanies, experience.company]),
                    sourceTitles: uniqueStrings([...current.sourceTitles, experience.title])
                }
            }
        }

        return Object.entries(stacks)
            .sort((left, right) => right[1].months - left[1].months)
            .reduce<Record<string, UserProfileStackExperience>>((acc, [stack, value]) => {
                acc[stack] = value
                return acc
            }, {})
    }

    private _calculateTotalExperienceMonths(experiences: UserProfileLinkedinExperience[]) {
        const starts = experiences
            .map((item) => item.startDate)
            .filter((item): item is string => Boolean(item))
            .map((item) => new Date(item))
            .filter((item) => !Number.isNaN(item.getTime()))
            .sort((left, right) => left.getTime() - right.getTime())

        if (starts.length === 0) return 0
        return monthsBetween(starts[0], new Date())
    }

    private async _createReview(
        snapshot: UserProfileLinkedinSnapshot,
        compensation: UserProfileCompensation,
        stackExperience: Record<string, UserProfileStackExperience>,
        birthDate?: string
    ): Promise<UserProfileReview | null> {
        const review = await this._gpt.reviewLinkedinProfile(snapshot, compensation, stackExperience, birthDate)
        if (!review) return null

        const parsed = {
            ...(review.parsed || {}),
            stack_experience: buildStackExperienceReview(stackExperience),
            saved_compensation: buildSavedCompensationReview(compensation),
            saved_personal: buildSavedPersonalReview(birthDate),
            calculated_total_experience: {
                months: snapshot.totalExperienceMonths,
                label: snapshot.totalExperienceLabel
            }
        }

        return {
            createdAt: new Date().toISOString(),
            raw: JSON.stringify(parsed, null, 2),
            parsed
        }
    }
}
