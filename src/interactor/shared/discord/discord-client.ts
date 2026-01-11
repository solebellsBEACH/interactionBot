import readline from "readline";

export type DiscordConfig = {
    enabled: boolean
    webhookUrl?: string
    requestTimeoutMs: number
    interactive: boolean
    consoleOnly: boolean
}

export class DiscordClient {
    private readonly _maxContentLength = 1900

    constructor(private readonly _config: DiscordConfig) { }

    async init(): Promise<void> {
        if (!this._config.enabled) return
        if (this._config.consoleOnly) return
        if (!this._config.webhookUrl) {
            console.warn("Discord enabled but DISCORD_WEBHOOK_URL is missing.")
        }
    }

    async log(message: string): Promise<void> {
        if (!this._config.enabled || this._config.consoleOnly) {
            console.log(message)
            return
        }

        if (!this._config.webhookUrl) {
            console.log(message)
            return
        }

        for (const chunk of this._splitMessage(message)) {
            await this._postMessage(chunk)
        }
    }

    async ask(prompt: string, timeoutMs?: number): Promise<string | null> {
        await this.log(prompt)

        if (!this._config.interactive) return null
        if (!process.stdin.isTTY) return null

        const answer = await this._promptCli(prompt, timeoutMs || this._config.requestTimeoutMs)
        return answer?.trim() ? answer.trim() : null
    }

    private _splitMessage(message: string) {
        if (message.length <= this._maxContentLength) return [message]

        const chunks: string[] = []
        let current = ""

        for (const line of message.split("\n")) {
            const next = current ? `${current}\n${line}` : line
            if (next.length > this._maxContentLength) {
                if (current) chunks.push(current)
                if (line.length > this._maxContentLength) {
                    for (let i = 0; i < line.length; i += this._maxContentLength) {
                        chunks.push(line.slice(i, i + this._maxContentLength))
                    }
                    current = ""
                } else {
                    current = line
                }
            } else {
                current = next
            }
        }

        if (current) chunks.push(current)
        return chunks
    }

    private async _postMessage(content: string): Promise<void> {
        if (!this._config.webhookUrl) return

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this._config.requestTimeoutMs)
        try {
            const response = await fetch(this._config.webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ content }),
                signal: controller.signal
            })
            if (!response.ok) {
                console.warn("Discord webhook failed.", response.status, response.statusText)
            }
        } catch (error) {
            console.warn("Discord webhook error.", error)
        } finally {
            clearTimeout(timeout)
        }
    }

    private async _promptCli(prompt: string, timeoutMs: number): Promise<string | null> {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        })

        const question = () =>
            new Promise<string>((resolve) => {
                rl.question(`${prompt}\n> `, (answer) => resolve(answer))
            })

        const timeout = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), timeoutMs)
        })

        const result = await Promise.race([question(), timeout])
        rl.close()
        return result
    }
}
