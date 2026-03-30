import {
    GptInteractionSource,
    saveGptInteraction,
} from "../../../api/controllers/gpt-interactions";
import type { FormPromptField } from "../interface/forms/form.types";
import type {
    UserProfile,
    UserProfileCompensation,
    UserProfileLinkedinSnapshot,
    UserProfileStackExperience
} from "../interface/user/user-profile.types";
import { logger } from "../services/logger";

export type GptConfig = {
    enabled?: boolean
    baseUrl?: string
    model?: string
    requestTimeoutMs?: number
    temperature?: number
    maxTokens?: number
}

export type GptAnswerContext = {
    step?: number
}

export type GptProfileReview = {
    raw: string
    parsed: Record<string, unknown> | null
}

type OllamaMessage = { role: string; content: string }

interface OllamaResponse {
    message?: { content?: string }
}

export class GptClient {
    private readonly _config: Required<GptConfig>
    private _disabledLogged = false

    constructor(config: GptConfig = {}) {
        this._config = {
            enabled: config.enabled ?? true,
            baseUrl: config.baseUrl ?? "http://localhost:11434",
            model: config.model ?? "llama3.2",
            requestTimeoutMs: config.requestTimeoutMs ?? 30_000,
            temperature: config.temperature ?? 0.1,
            maxTokens: config.maxTokens ?? 64,
        }
    }

    async answerField(
        field: FormPromptField,
        profile: UserProfile,
        historyAnswers?: Record<string, string>,
        context?: GptAnswerContext
    ): Promise<string | null> {
        if (!this._config.enabled) {
            this._logDisabledOnce()
            return null
        }
        const prompt = this._buildPrompt(field, profile, historyAnswers)
        if (!prompt) return null

        const systemPrompt =
            "You fill job application fields. Reply with only the value, no extra text. If the answer is numeric, reply with a rounded integer only."

        const startedAt = Date.now()
        try {
            const content = await this._callOllama([
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
            ])
            const trimmed = typeof content === "string" ? content.trim() : ""
            if (trimmed) {
                void this._saveInteraction({
                    field, prompt, answer: trimmed, source: "llama",
                    success: true, step: context?.step, durationMs: Date.now() - startedAt
                })
                return trimmed
            }
            void this._saveInteraction({
                field, prompt, source: "llama", success: false,
                error: "empty-response", step: context?.step, durationMs: Date.now() - startedAt
            })
        } catch (error) {
            this._logError(error)
            void this._saveInteraction({
                field, prompt, source: "llama", success: false,
                error: this._errorToString(error), step: context?.step, durationMs: Date.now() - startedAt
            })
        }

        return null
    }

    async reviewLinkedinProfile(
        profile: UserProfileLinkedinSnapshot,
        compensation?: UserProfileCompensation,
        stackExperience?: Record<string, UserProfileStackExperience>,
        birthDate?: string
    ): Promise<GptProfileReview | null> {
        if (!this._config.enabled) {
            this._logDisabledOnce()
            return null
        }

        const prompt = this._buildProfileReviewPrompt(profile, compensation, stackExperience, birthDate)
        const field: FormPromptField = {
            type: "input",
            key: "profile-review",
            label: "Profile review",
            value: ""
        }

        const systemPrompt =
            "You are a senior recruiter and LinkedIn profile reviewer for software engineers. Reply with valid JSON only."
        const maxTokens = Math.max(this._config.maxTokens, 1_200)

        const startedAt = Date.now()
        try {
            const content = await this._callOllama(
                [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: prompt }
                ],
                maxTokens
            )
            const review = this._parseProfileReview(typeof content === "string" ? content : null)
            if (review) {
                void this._saveInteraction({
                    field, prompt, answer: review.raw, source: "llama",
                    success: true, durationMs: Date.now() - startedAt
                })
                return review
            }
            void this._saveInteraction({
                field, prompt, source: "llama", success: false,
                error: "invalid-json-response", durationMs: Date.now() - startedAt
            })
        } catch (error) {
            this._logError(error)
            void this._saveInteraction({
                field, prompt, source: "llama", success: false,
                error: this._errorToString(error), durationMs: Date.now() - startedAt
            })
        }

        return null
    }

    private async _callOllama(messages: OllamaMessage[], maxTokens?: number): Promise<string | null> {
        const baseUrl = this._config.baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "")
        const response = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: this._config.model,
                messages,
                stream: false,
                options: {
                    temperature: this._config.temperature,
                    num_predict: maxTokens ?? this._config.maxTokens,
                },
            }),
            signal: AbortSignal.timeout(this._config.requestTimeoutMs),
        })
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        const data = await response.json() as OllamaResponse
        return data.message?.content?.trim() ?? null
    }

    private _logDisabledOnce() {
        if (this._disabledLogged) return
        this._disabledLogged = true
        logger.warn("AI is disabled. Set GPT_ENABLED=true or configure LLAMA_BASE_URL.")
    }

    private _logError(error: unknown) {
        if (error && typeof error === "object") {
            const record = error as Record<string, unknown>
            logger.warn("Llama request failed", {
                status: typeof record.status === "number" ? record.status : undefined,
                code: typeof record.code === "string" ? record.code : undefined,
                message: typeof record.message === "string" ? record.message : String(error)
            })
            return
        }
        logger.warn("Llama request failed", { message: String(error) })
    }

    private _parseProfileReview(content: string | null): GptProfileReview | null {
        const trimmed = typeof content === "string" ? content.trim() : ""
        if (!trimmed) return null

        const parsed = this._extractJsonObject(trimmed)
        if (!parsed) return null

        return {
            raw: JSON.stringify(parsed, null, 2),
            parsed
        }
    }

    private _extractJsonObject(content: string) {
        try {
            const parsed = JSON.parse(content)
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>
            }
        } catch {
            // Ignore direct parse failure and try extracting the first JSON object.
        }

        const firstBrace = content.indexOf("{")
        const lastBrace = content.lastIndexOf("}")
        if (firstBrace === -1 || lastBrace <= firstBrace) return null

        try {
            const parsed = JSON.parse(content.slice(firstBrace, lastBrace + 1))
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>
            }
        } catch {
            return null
        }

        return null
    }

    private _buildPrompt(
        field: FormPromptField,
        profile: UserProfile,
        historyAnswers?: Record<string, string>
    ) {
        const label = field.label || field.key || "field"
        const key = field.key || ""
        const summary = profile.summary ? `Profile summary: ${profile.summary}` : "Profile summary: (none)"
        const personal = profile.birthDate ? `Saved profile data:\nBirth date: ${profile.birthDate}` : "Saved profile data: (none)"
        const review = this._formatProfileReviewContext(profile)
        const answers = profile.answers && Object.keys(profile.answers).length > 0
            ? `Known answers:\n${this._formatAnswers(profile.answers)}`
            : "Known answers: (none)"
        const history = historyAnswers && Object.keys(historyAnswers).length > 0
            ? `History answers:\n${this._formatAnswers(historyAnswers)}`
            : "History answers: (none)"

        const lines = [
            summary,
            personal,
            review,
            answers,
            history,
            "Use the saved profile data and profile review JSON as additional context when they help. Prefer their normalized experience, compensation and birth date values over guesses.",
            `Field: ${label}`,
            key ? `Key: ${key}` : "",
            `Type: ${field.type}`
        ].filter(Boolean)

        if (field.type === "select") {
            const options = (field.options || []).map((option) => option.trim()).filter(Boolean)
            if (options.length === 0) return null
            lines.push(`Options: ${options.join(" | ")}`)
            lines.push("Reply with exactly one option from the list.")
        } else {
            lines.push(this._buildInputReplyInstruction(field))
        }

        return lines.join("\n")
    }

    private _formatProfileReviewContext(profile: UserProfile) {
        const raw =
            profile.profileReview?.raw ||
            (profile.profileReview?.parsed ? JSON.stringify(profile.profileReview.parsed, null, 2) : "")

        const trimmed = typeof raw === "string" ? raw.trim() : ""
        if (!trimmed) return "Profile review JSON: (none)"

        const maxLength = 6_000
        if (trimmed.length <= maxLength) {
            return `Profile review JSON:\n${trimmed}`
        }

        return `Profile review JSON (truncated):\n${trimmed.slice(0, maxLength)}`
    }

    private _buildProfileReviewPrompt(
        profile: UserProfileLinkedinSnapshot,
        compensation?: UserProfileCompensation,
        stackExperience?: Record<string, UserProfileStackExperience>,
        birthDate?: string
    ) {
        const payload = {
            basics: {
                name: profile.name,
                headline: profile.headline,
                location: profile.location,
                website: profile.website,
                currentCompany: profile.currentCompany,
                totalExperienceLabel: profile.totalExperienceLabel,
                connections: profile.connections
            },
            about: profile.about,
            topSkills: profile.topSkills.slice(0, 20),
            languages: profile.languages,
            experiences: profile.experiences.slice(0, 10).map((item) => ({
                title: item.title,
                company: item.company,
                employmentType: item.employmentType,
                dateRangeLabel: item.dateRangeLabel,
                location: item.location,
                stacks: item.stacks,
                description: item.description
            })),
            education: profile.education.slice(0, 5),
            projects: profile.projects.slice(0, 5),
            stackExperience: Object.entries(stackExperience || {}).map(([stack, item]) => ({
                stack,
                firstSeenAt: item.firstSeenAt,
                months: item.months,
                years: item.years,
                durationLabel: item.durationLabel,
                sourceCompanies: item.sourceCompanies,
                sourceTitles: item.sourceTitles
            })),
            savedPersonal: {
                birthDate: birthDate || undefined
            },
            compensation: compensation || undefined
        }

        return [
            "Review this LinkedIn profile for senior software engineering roles and return valid JSON only.",
            "Required JSON shape:",
            JSON.stringify({
                overall_score: 0,
                positioning: {
                    seniority: "",
                    best_fit_roles: [""],
                    strongest_markets: [""]
                },
                strengths: [""],
                gaps: [""],
                headline_review: {
                    verdict: "",
                    suggested_headline: ""
                },
                about_review: {
                    verdict: "",
                    suggested_about: ""
                },
                keyword_gaps: [""],
                compensation_feedback: {
                    verdict: "",
                    notes: [""]
                },
                stack_experience: [
                    {
                        stack: "",
                        first_seen_at: "",
                        experience_months: 0,
                        experience_years: "",
                        experience_label: "",
                        source_companies: [""],
                        source_titles: [""]
                    }
                ],
                saved_compensation: {
                    hourly_usd: "",
                    hourly_brl: "",
                    pretensao_clt: "",
                    pretensao_pj: ""
                },
                saved_personal: {
                    birth_date: ""
                },
                calculated_total_experience: {
                    months: 0,
                    label: ""
                },
                action_plan: [""]
            }, null, 2),
            "Profile data:",
            JSON.stringify(payload, null, 2)
        ].join("\n\n")
    }

    private _buildInputReplyInstruction(field: FormPromptField) {
        if (this._isDateField(field)) {
            return "Reply with a valid date in MM/DD/YYYY format only. Example: 12/14/2002"
        }
        if (this._isExperienceYearsField(field)) {
            return "Reply with digits only, rounded to an integer, no units or words. Example: 3"
        }
        if (this._isCompensationField(field)) {
            return "Reply with numeric amount only, rounded to an integer, with no currency symbol or thousand separators. Example: 10000"
        }
        return "Reply with a short direct value."
    }

    private _formatAnswers(answers: Record<string, string>) {
        return Object.entries(answers)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n")
    }

    private _isExperienceYearsField(field: FormPromptField) {
        const text = this._normalizeFieldText(field)
        const hasExperience = text.includes("experience") || text.includes("experiencia")
        const hasYears =
            text.includes("year") ||
            text.includes("years") ||
            text.includes("ano") ||
            text.includes("anos")

        return hasExperience && hasYears
    }

    private _isCompensationField(field: FormPromptField) {
        const text = this._normalizeFieldText(field)
        const compensationKeywords = [
            "salary",
            "salario",
            "compensation",
            "compensacao",
            "remuneration",
            "remuneracao",
            "pretensao salarial",
            "pretensao",
            "wage",
            "pay",
            "rate",
            "hourly rate",
            "annual salary",
            "monthly salary",
            "income",
            "earning",
            "valor"
        ]

        return compensationKeywords.some((keyword) => text.includes(keyword))
    }

    private _isDateField(field: FormPromptField) {
        const text = this._normalizeFieldText(field)
        return (
            text.includes("date") ||
            text.includes("birth") ||
            text.includes("nascimento") ||
            /\bdob\b/.test(text) ||
            text.includes("mm/dd/yyyy")
        )
    }

    private _normalizeFieldText(field: FormPromptField) {
        return `${field.label || ""} ${field.key || ""}`
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
    }

    private _errorToString(error: unknown) {
        if (!error) return ""
        if (error instanceof Error) return error.message || error.name
        if (typeof error === "string") return error
        if (error && typeof error === "object") {
            const record = error as Record<string, unknown>
            const message = record.message
            if (typeof message === "string") return message
        }
        return String(error)
    }

    private async _saveInteraction(payload: {
        field: FormPromptField
        prompt: string
        answer?: string
        source: GptInteractionSource
        success: boolean
        error?: string
        step?: number
        durationMs: number
    }) {
        try {
            await saveGptInteraction({
                fieldType: payload.field.type,
                fieldKey: payload.field.key,
                fieldLabel: payload.field.label,
                step: payload.step,
                prompt: payload.prompt.slice(0, 8_000),
                answer: payload.answer,
                model: this._config.model,
                source: payload.source,
                success: payload.success,
                error: payload.error,
                durationMs: payload.durationMs
            })
        } catch (error) {
            logger.warn("Failed to save AI interaction", {
                message: this._errorToString(error)
            })
        }
    }
}
