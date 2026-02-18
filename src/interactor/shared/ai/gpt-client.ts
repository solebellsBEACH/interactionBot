import { FormPromptField } from "../interface/forms/form.types";
import type { UserProfile } from "../interface/user/user-profile.types";
import { env } from "../env";
import { logger } from "../services/logger";
export type { GptConfig } from "../interface/ai/gpt.types";

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
        logger.info('gpt response', data)
        } catch (error) {
            logger.error('gpt error', error)
        }
    }
}
