import { FormPromptField } from "../utils/element-handle";
import { UserProfile } from "../user-profile";

export type GptConfig = {
    enabled: boolean
    apiKey?: string
    model: string
    baseUrl?: string
    requestTimeoutMs: number
    temperature: number
    maxTokens: number
}

export class GptClient {
    constructor(private readonly _config: GptConfig) { }

    async answerField(
        field: FormPromptField,
        profile: UserProfile,
        historyAnswers?: Record<string, string>
    ): Promise<string | null> {
        if (!this._config.enabled || !this._config.apiKey) return null
        if (!profile.summary && Object.keys(profile.answers || {}).length === 0) return null

        const prompt = this._buildPrompt(field, profile, historyAnswers)
        if (!prompt) return null

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this._config.requestTimeoutMs)
        try {
            const response = await fetch(this._getEndpoint(), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this._config.apiKey}`
                },
                body: JSON.stringify({
                    model: this._config.model,
                    temperature: this._config.temperature,
                    max_tokens: this._config.maxTokens,
                    messages: [
                        {
                            role: "system",
                            content: "You fill job application fields. Reply with only the value, no extra text."
                        },
                        { role: "user", content: prompt }
                    ]
                }),
                signal: controller.signal
            })

            if (!response.ok) return null
            const data = await response.json().catch(() => null)
            const content = data?.choices?.[0]?.message?.content
            if (!content || typeof content !== "string") return null
            return content.trim()
        } catch {
            return null
        } finally {
            clearTimeout(timeout)
        }
    }

    private _getEndpoint() {
        const base = (this._config.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")
        if (base.endsWith("/v1")) return `${base}/chat/completions`
        return `${base}/v1/chat/completions`
    }

    private _buildPrompt(
        field: FormPromptField,
        profile: UserProfile,
        historyAnswers?: Record<string, string>
    ) {
        const label = field.label || field.key || "field"
        const key = field.key || ""
        const summary = profile.summary ? `Profile summary: ${profile.summary}` : "Profile summary: (none)"
        const answers = profile.answers && Object.keys(profile.answers).length > 0
            ? `Known answers:\n${this._formatAnswers(profile.answers)}`
            : "Known answers: (none)"
        const history = historyAnswers && Object.keys(historyAnswers).length > 0
            ? `History answers:\n${this._formatAnswers(historyAnswers)}`
            : "History answers: (none)"

        const lines = [
            summary,
            answers,
            history,
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
            lines.push("Reply with a short direct value.")
        }

        return lines.join("\n")
    }

    private _formatAnswers(answers: Record<string, string>) {
        return Object.entries(answers)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n")
    }
}
