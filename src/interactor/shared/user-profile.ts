import fs from "fs";
import path from "path";
import { clearRemoteUserProfile, fetchRemoteUserProfile, saveRemoteUserProfile } from "../../api/controllers/user-profile";
import { getProfile as getPgProfile, saveProfile as savePgProfile, createSchema as createPgSchema } from "../../admin/db/profile-store";
import type { UserProfile } from "./interface/user/user-profile.types";
import type {
    UserProfileCompensation,
    UserProfileLinkedinEducation,
    UserProfileLinkedinExperience,
    UserProfileLinkedinProject,
    UserProfileLinkedinSnapshot,
    UserProfileReview,
    UserProfileStackExperience
} from "./interface/user/user-profile.types";
import { logger } from "./services/logger";
import { getBotScopeId, hasBotControlPlaneContext } from "./utils/user-data-dir";

export type {
    UserProfile,
    UserProfileCompensation,
    UserProfileLinkedinEducation,
    UserProfileLinkedinExperience,
    UserProfileLinkedinProject,
    UserProfileLinkedinSnapshot,
    UserProfileReview,
    UserProfileStackExperience
} from "./interface/user/user-profile.types";

const defaultProfile: UserProfile = {
    summary: "",
    answers: {},
    birthDate: "",
    compensation: {
        hourlyUsd: "",
        hourlyBrl: "",
        clt: "",
        pj: ""
    },
    stackExperience: {},
    linkedinProfile: null,
    profileReview: null,
    updatedAt: ""
}

let profileHydrated = false
let profilePersistQueue = Promise.resolve()
let activeProfileScope = ""

const getProfileStorageMode = () => {
    const value = (process.env.USER_PROFILE_STORAGE || "auto").trim().toLowerCase()
    if (value === "api" || value === "local" || value === "auto" || value === "postgres") return value
    return "auto"
}

const shouldUseApiProfile = () => {
    const mode = getProfileStorageMode()
    if (mode === "postgres") return false
    if (mode === "api") return true
    if (mode === "local") return false
    return hasBotControlPlaneContext()
}

const shouldUsePostgresProfile = () => getProfileStorageMode() === "postgres"

const getProfileStorageKey = () => {
    const scopeId = getBotScopeId()
    if (!scopeId) return "default"
    return scopeId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "default"
}

const getProfilePath = () => path.resolve(process.cwd(), "data", "profiles", `${getProfileStorageKey()}.json`)

const normalizeText = (value: unknown) =>
    typeof value === "string"
        ? value.replace(/\u00a0/g, " ").trim()
        : ""

const formatDurationLabel = (months: number) => {
    if (!Number.isFinite(months) || months <= 0) return "0 meses"

    const wholeMonths = Math.trunc(months)
    const years = Math.floor(wholeMonths / 12)
    const remainder = wholeMonths % 12
    const parts: string[] = []

    if (years > 0) {
        parts.push(`${years} ${years === 1 ? "ano" : "anos"}`)
    }
    if (remainder > 0) {
        parts.push(`${remainder} ${remainder === 1 ? "mês" : "meses"}`)
    }

    return parts.join(" e ") || "0 meses"
}

const normalizeStringRecord = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}

    return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, item]) => {
        const normalizedKey = normalizeKey(key)
        const normalizedValue = normalizeText(item)
        if (!normalizedKey || !normalizedValue) return acc
        acc[normalizedKey] = normalizedValue
        return acc
    }, {})
}

const normalizeStringArray = (value: unknown) => {
    if (!Array.isArray(value)) return []
    return Array.from(new Set(value.map((item) => normalizeText(item)).filter(Boolean)))
}

const normalizeCompensation = (value: unknown): UserProfileCompensation => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ...defaultProfile.compensation }
    }

    const data = value as Record<string, unknown>
    return {
        hourlyUsd: sanitizeCompensationValue(data.hourlyUsd),
        hourlyBrl: sanitizeCompensationValue(data.hourlyBrl),
        clt: sanitizeCompensationValue(data.clt),
        pj: sanitizeCompensationValue(data.pj)
    }
}

const normalizeStackExperience = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}

    return Object.entries(value as Record<string, unknown>).reduce<Record<string, UserProfileStackExperience>>(
        (acc, [key, item]) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return acc

            const record = item as Record<string, unknown>
            const normalizedKey = normalizeText(key)
            const monthsRaw = Number(record.months)
            const years = normalizeText(record.years)
            const firstSeenAt = normalizeText(record.firstSeenAt)
            const durationLabel = normalizeText(record.durationLabel)

            if (!normalizedKey || !firstSeenAt || !Number.isFinite(monthsRaw) || monthsRaw <= 0 || !years) {
                return acc
            }

            acc[normalizedKey] = {
                firstSeenAt,
                months: Math.trunc(monthsRaw),
                years,
                durationLabel: durationLabel || formatDurationLabel(monthsRaw),
                sourceCompanies: normalizeStringArray(record.sourceCompanies),
                sourceTitles: normalizeStringArray(record.sourceTitles)
            }
            return acc
        },
        {}
    )
}

const normalizeLinkedinExperience = (value: unknown): UserProfileLinkedinExperience | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const record = value as Record<string, unknown>

    return {
        title: normalizeText(record.title),
        company: normalizeText(record.company),
        employmentType: normalizeText(record.employmentType),
        location: normalizeText(record.location),
        dateRangeLabel: normalizeText(record.dateRangeLabel),
        description: normalizeText(record.description),
        startDate: normalizeNullableText(record.startDate),
        endDate: normalizeNullableText(record.endDate),
        isCurrent: Boolean(record.isCurrent),
        stacks: normalizeStringArray(record.stacks)
    }
}

const normalizeLinkedinEducation = (value: unknown): UserProfileLinkedinEducation | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    const school = normalizeText(record.school)
    if (!school) return null

    return {
        school,
        degree: normalizeText(record.degree),
        period: normalizeText(record.period)
    }
}

const normalizeLinkedinProject = (value: unknown): UserProfileLinkedinProject | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    const title = normalizeText(record.title)
    if (!title) return null

    return {
        title,
        description: normalizeText(record.description)
    }
}

const normalizeLinkedinProfile = (value: unknown): UserProfileLinkedinSnapshot | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    const capturedAt = normalizeText(record.capturedAt)
    const name = normalizeText(record.name)
    if (!capturedAt && !name) return null

    const experiences = Array.isArray(record.experiences)
        ? record.experiences
            .map((item) => normalizeLinkedinExperience(item))
            .filter((item): item is UserProfileLinkedinExperience => Boolean(item))
        : []

    const education = Array.isArray(record.education)
        ? record.education
            .map((item) => normalizeLinkedinEducation(item))
            .filter((item): item is UserProfileLinkedinEducation => Boolean(item))
        : []

    const projects = Array.isArray(record.projects)
        ? record.projects
            .map((item) => normalizeLinkedinProject(item))
            .filter((item): item is UserProfileLinkedinProject => Boolean(item))
        : []

    const totalExperienceMonths = Number(record.totalExperienceMonths)

    return {
        capturedAt,
        name,
        headline: normalizeText(record.headline),
        location: normalizeText(record.location),
        website: normalizeText(record.website),
        connections: normalizeText(record.connections),
        currentCompany: normalizeText(record.currentCompany),
        topEducation: normalizeText(record.topEducation),
        about: normalizeText(record.about),
        avatarUrl: normalizeText(record.avatarUrl),
        backgroundImageUrl: normalizeText(record.backgroundImageUrl),
        topSkills: normalizeStringArray(record.topSkills),
        languages: normalizeStringArray(record.languages),
        experiences,
        education,
        projects,
        totalExperienceMonths:
            Number.isFinite(totalExperienceMonths) && totalExperienceMonths > 0
                ? Math.trunc(totalExperienceMonths)
                : 0,
        totalExperienceLabel: normalizeText(record.totalExperienceLabel)
    }
}

const normalizeProfileReview = (value: unknown): UserProfileReview | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null

    const record = value as Record<string, unknown>
    const createdAt = normalizeText(record.createdAt)
    const raw = normalizeText(record.raw)
    if (!createdAt && !raw) return null

    let parsed: Record<string, unknown> | null = null
    if (record.parsed && typeof record.parsed === "object" && !Array.isArray(record.parsed)) {
        parsed = record.parsed as Record<string, unknown>
    }

    return {
        createdAt,
        raw,
        parsed
    }
}

const normalizeNullableText = (value: unknown) => {
    const normalized = normalizeText(value)
    return normalized || null
}

const getEnvSummary = () => process.env.USER_PROFILE?.trim() || ""

const normalizeKey = (value: string) =>
    value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")

const parseNumericToken = (token: string) => {
    const cleaned = token.replace(/[^\d.,-]/g, "")
    if (!cleaned || !/\d/.test(cleaned)) return null

    const lastComma = cleaned.lastIndexOf(",")
    const lastDot = cleaned.lastIndexOf(".")

    if (lastComma !== -1 && lastDot !== -1) {
        const decimalIndex = Math.max(lastComma, lastDot)
        const integerPart = cleaned.slice(0, decimalIndex).replace(/[^\d-]/g, "")
        const fractionalPart = cleaned.slice(decimalIndex + 1).replace(/[^\d]/g, "")
        const normalized = fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart
        const parsed = Number(normalized)
        return Number.isFinite(parsed) ? parsed : null
    }

    const separator = lastComma !== -1 ? "," : lastDot !== -1 ? "." : ""
    if (!separator) {
        const parsed = Number(cleaned.replace(/[^\d-]/g, ""))
        return Number.isFinite(parsed) ? parsed : null
    }

    const parts = cleaned.split(separator)
    if (parts.length === 2) {
        const integerPart = parts[0].replace(/[^\d-]/g, "")
        const fractionalPart = parts[1].replace(/[^\d]/g, "")
        if (!fractionalPart) {
            const parsed = Number(integerPart)
            return Number.isFinite(parsed) ? parsed : null
        }

        if (fractionalPart.length === 3 && integerPart) {
            const parsed = Number(`${integerPart}${fractionalPart}`)
            return Number.isFinite(parsed) ? parsed : null
        }

        const parsed = Number(`${integerPart}.${fractionalPart}`)
        return Number.isFinite(parsed) ? parsed : null
    }

    const parsed = Number(cleaned.replace(/[^\d-]/g, ""))
    return Number.isFinite(parsed) ? parsed : null
}

const formatNumericValue = (value: number) => {
    if (!Number.isFinite(value)) return ""
    if (Math.abs(value - Math.trunc(value)) < 1e-9) {
        return String(Math.trunc(value))
    }
    return value.toFixed(2).replace(/\.?0+$/, "")
}

export const sanitizeCompensationValue = (value: unknown) => {
    if (value === undefined || value === null) return ""

    const raw = normalizeText(value)
    if (!raw) return ""

    const normalizedRaw = raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()

    let multiplier = 1
    if (/\b\d+(?:[.,]\d+)?\s*k\b/i.test(raw) || /\b\d+(?:[.,]\d+)?\s*mil\b/i.test(normalizedRaw)) {
        multiplier = 1_000
    } else if (
        /\b\d+(?:[.,]\d+)?\s*m\b/i.test(raw) ||
        /\b\d+(?:[.,]\d+)?\s*(mi|milhao|milhoes|million|millions)\b/i.test(normalizedRaw)
    ) {
        multiplier = 1_000_000
    }

    const token = raw.match(/-?\d[\d.,]*/)
    if (!token) return ""

    const parsed = parseNumericToken(token[0])
    if (parsed === null || !Number.isFinite(parsed) || parsed < 0) return ""
    return formatNumericValue(parsed * multiplier)
}

export const normalizeUserProfile = (value: unknown): UserProfile => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {
            ...defaultProfile,
            compensation: { ...defaultProfile.compensation }
        }
    }

    const record = value as Record<string, unknown>
    const summary = normalizeText(record.summary)
    const updatedAt = normalizeText(record.updatedAt)

    return {
        summary,
        answers: normalizeStringRecord(record.answers),
        birthDate: normalizeText(record.birthDate),
        compensation: normalizeCompensation(record.compensation),
        stackExperience: normalizeStackExperience(record.stackExperience),
        linkedinProfile: normalizeLinkedinProfile(record.linkedinProfile),
        profileReview: normalizeProfileReview(record.profileReview),
        updatedAt
    }
}

const loadProfileFromFile = () => {
    const profilePath = getProfilePath()
    if (!fs.existsSync(profilePath)) return null

    try {
        const raw = fs.readFileSync(profilePath, "utf-8")
        const data = JSON.parse(raw)
        return normalizeUserProfile(data)
    } catch {
        return null
    }
}

export const userProfile: UserProfile = normalizeUserProfile({
    ...defaultProfile,
    summary: getEnvSummary() || defaultProfile.summary
})

const getProfileScope = () => `${shouldUseApiProfile() ? "api" : "local"}:${getProfileStorageKey()}`

const applyCachedProfile = (value: Partial<UserProfile>) => {
    const summary =
        value.summary !== undefined
            ? value.summary
            : userProfile.summary || getEnvSummary() || defaultProfile.summary

    const normalized = normalizeUserProfile({
        ...defaultProfile,
        ...userProfile,
        ...value,
        summary
    })

    Object.assign(userProfile, normalized)
    return userProfile
}

const ensureProfileScope = () => {
    const nextScope = getProfileScope()
    if (!activeProfileScope) {
        activeProfileScope = nextScope
        return nextScope
    }

    if (activeProfileScope !== nextScope) {
        activeProfileScope = nextScope
        profileHydrated = false
        applyCachedProfile({
            ...defaultProfile,
            summary: getEnvSummary() || defaultProfile.summary
        })
        return nextScope
    }

    return nextScope
}

const saveProfileToFile = (profile: UserProfile) => {
    const profilePath = getProfilePath()
    fs.mkdirSync(path.dirname(profilePath), { recursive: true })
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2))
}

const queueRemoteProfileSave = (profile: UserProfile) => {
    if (!shouldUseApiProfile()) return profilePersistQueue

    profilePersistQueue = profilePersistQueue
        .catch(() => undefined)
        .then(async () => {
            try {
                const remote = await saveRemoteUserProfile(profile)
                if (remote) {
                    applyCachedProfile(remote)
                }
            } catch (error) {
                logger.warn("Falha ao persistir user profile na API. Mantendo fallback local.", error)
            }
        })

    return profilePersistQueue
}

const queueRemoteProfileReset = () => {
    if (!shouldUseApiProfile()) return profilePersistQueue

    profilePersistQueue = profilePersistQueue
        .catch(() => undefined)
        .then(async () => {
            try {
                await clearRemoteUserProfile()
            } catch (error) {
                logger.warn("Falha ao limpar user profile na API. Mantendo fallback local.", error)
            }
        })

    return profilePersistQueue
}

export const hydrateUserProfile = async (force = false) => {
    ensureProfileScope()
    if (profileHydrated && !force) return userProfile

    let nextProfile: UserProfile | null = null

    if (shouldUsePostgresProfile()) {
        try {
            await createPgSchema()
            const pgProfile = await getPgProfile(getProfileStorageKey())
            if (pgProfile) {
                nextProfile = normalizeUserProfile(pgProfile)
            }
        } catch (error) {
            logger.warn("Falha ao carregar user profile do PostgreSQL. Usando fallback local.", error)
        }
    } else if (shouldUseApiProfile()) {
        try {
            const remote = await fetchRemoteUserProfile()
            if (remote) {
                nextProfile = normalizeUserProfile(remote)
            }
        } catch (error) {
            logger.warn("Falha ao carregar user profile da API. Usando fallback local.", error)
        }
    }

    if (!nextProfile) {
        nextProfile = loadProfileFromFile()
    }

    if (nextProfile) {
        applyCachedProfile(nextProfile)
    } else {
        applyCachedProfile({
            ...defaultProfile,
            summary: getEnvSummary() || defaultProfile.summary
        })
    }

    profileHydrated = true
    return userProfile
}

export const flushUserProfile = async () => {
    await profilePersistQueue.catch(() => undefined)
    return userProfile
}

export const readUserProfile = () => {
    ensureProfileScope()
    if (shouldUseApiProfile()) {
        profileHydrated = true
        return userProfile
    }

    const latest = loadProfileFromFile()
    if (latest) {
        applyCachedProfile(latest)
    } else if (!profileHydrated) {
        applyCachedProfile({
            ...defaultProfile,
            summary: getEnvSummary() || defaultProfile.summary
        })
    }
    profileHydrated = true
    return userProfile
}

export const saveUserProfile = (value: Partial<UserProfile>) => {
    ensureProfileScope()
    const current = readUserProfile()
    const merged = normalizeUserProfile({
        ...current,
        ...value,
        answers: {
            ...current.answers,
            ...(value.answers || {})
        },
        compensation: {
            ...current.compensation,
            ...(value.compensation || {})
        },
        stackExperience: value.stackExperience ?? current.stackExperience,
        linkedinProfile:
            value.linkedinProfile === undefined ? current.linkedinProfile : value.linkedinProfile,
        profileReview: value.profileReview === undefined ? current.profileReview : value.profileReview,
        updatedAt: new Date().toISOString()
    })

    applyCachedProfile(merged)
    saveProfileToFile(userProfile)
    if (shouldUsePostgresProfile()) {
        void savePgProfile(getProfileStorageKey(), userProfile).catch((error) => {
            logger.warn("Falha ao salvar user profile no PostgreSQL.", error)
        })
    }
    void queueRemoteProfileSave(userProfile)
    profileHydrated = true
    return userProfile
}

export const saveUserProfileAsync = async (value: Partial<UserProfile>) => {
    const profile = saveUserProfile(value)
    await flushUserProfile()
    return profile
}

export const resetUserProfile = () => {
    ensureProfileScope()
    const profilePath = getProfilePath()
    if (fs.existsSync(profilePath)) {
        fs.rmSync(profilePath, { force: true })
    }

    const reset = normalizeUserProfile({
        ...defaultProfile
    })

    Object.assign(userProfile, reset)
    void queueRemoteProfileReset()
    profileHydrated = true
    return userProfile
}

export const resetUserProfileAsync = async () => {
    const profile = resetUserProfile()
    await flushUserProfile()
    return profile
}
