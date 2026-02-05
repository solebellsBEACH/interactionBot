import { FormPromptField } from "../utils/element-handle";
import { UserProfile } from "../user-profile";
import { env } from "../env";

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


    constructor() {
    }

    async answerField(field: string) {
        // if (env.gpt.enabled) return null
        this.callGPT()
    }

    async callGPT() {
        try {
            const res = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.gpt.apiKey}`
            },
            body: JSON.stringify({
            model: "gpt-5.2",
            input: "Explique em 1 frase o que é TypeScript."
            })
        })

        const data = await res.json()
        console.log(data)
        } catch (error) {
            console.log(error)
        }
    }
}
