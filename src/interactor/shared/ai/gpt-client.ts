import OpenAI from "openai";

import {
    GptInteractionSource,
    saveGptInteraction,
} from "../../../api/controllers/gpt-interactions";
import {
    UserProfile,
    UserProfileCompensation,
    UserProfileLinkedinSnapshot,
    UserProfileStackExperience
} from "../user-profile";
import { FormPromptField } from "../utils/element-handle";

export type GptConfig = {
    enabled?: boolean
    apiKey?: string
    model?: string
    baseUrl?: string
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

export class GptClient {
    private readonly _config: Required<Omit<GptConfig, "apiKey" | "baseUrl">> & Pick<GptConfig, "apiKey" | "baseUrl">
    private _client?: OpenAI
    private _clientKey?: string
    private _disabledLogged = false
    private _missingKeyLogged = false

    constructor(config: GptConfig = {}) {
        this._config = {
            enabled: config.enabled ?? Boolean(config.apiKey),
            apiKey: config.apiKey,
            model: config.model ?? "gpt-4o-mini",
            baseUrl: config.baseUrl,
            requestTimeoutMs: config.requestTimeoutMs ?? 20_000,
            temperature: config.temperature ?? 0.1,
            maxTokens: config.maxTokens ?? 64
        }
    }

    async testClient(prompt: string) {
        const openai = this._getClient()
        if (!openai) return null

        const response = await openai.responses.create({
            model: this._config.model,
            input: prompt,
            store: true,
        })

        console.log(response)
        return response
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
        const openai = this._getClient()
        if (!openai) return null

        const prompt = this._buildPrompt(field, profile, historyAnswers)
        if (!prompt) return null

        const systemPrompt =
            "You fill job application fields. Reply with only the value, no extra text. If the answer is numeric, reply with a rounded integer only."

        let responsesError: unknown = null
        const responsesStartedAt = Date.now()

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this._config.requestTimeoutMs)
        try {
            const data = await openai.responses.create({
                model: this._config.model,
                temperature: this._config.temperature,
                max_output_tokens: this._config.maxTokens,
                input: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    { role: "user", content: prompt }
                ]
            }, {
                signal: controller.signal
            })

            const content = this._extractResponseText(data)
            const trimmed = typeof content === "string" ? content.trim() : ""
            if (trimmed) {
                void this._saveInteraction({
                    field,
                    prompt,
                    answer: trimmed,
                    source: "responses",
                    success: true,
                    step: context?.step,
                    durationMs: Date.now() - responsesStartedAt
                })
                return trimmed
            }

            responsesError = new Error("empty-response")
        } catch (error) {
            responsesError = error
            this._logError("responses", error)
        } finally {
            clearTimeout(timeout)
        }

        const completionStartedAt = Date.now()
        try {
            const completion = await openai.chat.completions.create({
                model: this._config.model,
                temperature: this._config.temperature,
                max_tokens: this._config.maxTokens,
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    { role: "user", content: prompt }
                ]
            })

            const content = completion.choices?.[0]?.message?.content
            if (typeof content !== "string") {
                void this._saveInteraction({
                    field,
                    prompt,
                    source: "chat.completions",
                    success: false,
                    error: this._mergeErrors(responsesError, "empty-response"),
                    step: context?.step,
                    durationMs: Date.now() - completionStartedAt
                })
                return null
            }

            const trimmed = content.trim()
            if (!trimmed) {
                void this._saveInteraction({
                    field,
                    prompt,
                    source: "chat.completions",
                    success: false,
                    error: this._mergeErrors(responsesError, "empty-response"),
                    step: context?.step,
                    durationMs: Date.now() - completionStartedAt
                })
                return null
            }

            void this._saveInteraction({
                field,
                prompt,
                answer: trimmed,
                source: "chat.completions",
                success: true,
                step: context?.step,
                durationMs: Date.now() - completionStartedAt
            })

            return trimmed
        } catch (error) {
            this._logError("chat.completions", error)
            void this._saveInteraction({
                field,
                prompt,
                source: "chat.completions",
                success: false,
                error: this._mergeErrors(responsesError, error),
                step: context?.step,
                durationMs: Date.now() - completionStartedAt
            })
            return null
        }
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

        const openai = this._getClient()
        if (!openai) return null

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

        let responsesError: unknown = null
        const responsesStartedAt = Date.now()

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this._config.requestTimeoutMs)
        try {
            const data = await openai.responses.create({
                model: this._config.model,
                temperature: this._config.temperature,
                max_output_tokens: maxTokens,
                input: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            }, {
                signal: controller.signal
            })

            const review = this._parseProfileReview(this._extractResponseText(data))
            if (review) {
                void this._saveInteraction({
                    field,
                    prompt,
                    answer: review.raw,
                    source: "responses",
                    success: true,
                    durationMs: Date.now() - responsesStartedAt
                })
                return review
            }

            responsesError = new Error("invalid-json-response")
        } catch (error) {
            responsesError = error
            this._logError("responses", error)
        } finally {
            clearTimeout(timeout)
        }

        const completionStartedAt = Date.now()
        try {
            const completion = await openai.chat.completions.create({
                model: this._config.model,
                temperature: this._config.temperature,
                max_tokens: maxTokens,
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            })

            const content = completion.choices?.[0]?.message?.content
            const review = this._parseProfileReview(typeof content === "string" ? content : null)
            if (!review) {
                void this._saveInteraction({
                    field,
                    prompt,
                    source: "chat.completions",
                    success: false,
                    error: this._mergeErrors(responsesError, "invalid-json-response"),
                    durationMs: Date.now() - completionStartedAt
                })
                return null
            }

            void this._saveInteraction({
                field,
                prompt,
                answer: review.raw,
                source: "chat.completions",
                success: true,
                durationMs: Date.now() - completionStartedAt
            })

            return review
        } catch (error) {
            this._logError("chat.completions", error)
            void this._saveInteraction({
                field,
                prompt,
                source: "chat.completions",
                success: false,
                error: this._mergeErrors(responsesError, error),
                durationMs: Date.now() - completionStartedAt
            })
            return null
        }
    }

    private _getClient() {
        if (!this._config.apiKey) {
            if (!this._missingKeyLogged) {
                this._missingKeyLogged = true
                console.warn("GPT enabled but OPENAI_API_KEY is missing.")
            }
            return null
        }
        if (this._client && this._clientKey === this._config.apiKey) {
            return this._client
        }

        this._clientKey = this._config.apiKey
        this._client = new OpenAI({
            apiKey: this._config.apiKey,
            timeout: this._config.requestTimeoutMs,
            ...(this._config.baseUrl
                ? { baseURL: this._config.baseUrl.replace(/\/+$/, "") }
                : {})
        })
        return this._client
    }

    private _logDisabledOnce() {
        if (this._disabledLogged) return
        this._disabledLogged = true
        console.warn("GPT is disabled. Set GPT_ENABLED=true and OPENAI_API_KEY.")
    }

    private _logError(source: string, error: unknown) {
        if (error && typeof error === "object") {
            const record = error as Record<string, unknown>
            const status = record.status
            const message = record.message
            const code = record.code
            console.warn("GPT request failed", {
                source,
                status: typeof status === "number" ? status : undefined,
                code: typeof code === "string" ? code : undefined,
                message: typeof message === "string" ? message : String(error)
            })
            return
        }
        console.warn("GPT request failed", { source, message: String(error) })
    }

    private _extractResponseText(response: unknown) {
        if (!response || typeof response !== "object") return null
        const asRecord = response as Record<string, unknown>

        const directOutput = asRecord.output_text
        if (typeof directOutput === "string" && directOutput.trim()) {
            return directOutput.trim()
        }

        const output = asRecord.output
        if (!Array.isArray(output)) return null

        for (const item of output) {
            if (!item || typeof item !== "object") continue
            const itemRecord = item as Record<string, unknown>
            const content = itemRecord.content
            if (!Array.isArray(content)) continue

            for (const part of content) {
                if (!part || typeof part !== "object") continue
                const partRecord = part as Record<string, unknown>
                const text = partRecord.text
                if (typeof text === "string" && text.trim()) {
                    return text.trim()
                }
            }
        }

        return null
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

    private _mergeErrors(first: unknown, second: unknown) {
        const pieces = [first, second]
            .map((value) => this._errorToString(value))
            .filter(Boolean)

        if (pieces.length === 0) return undefined
        return pieces.join(" | ")
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
            console.warn("Failed to save GPT interaction", {
                message: this._errorToString(error)
            })
        }
    }
}
