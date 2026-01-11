import makeWASocket, { fetchLatestBaileysVersion, proto, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import path from "path";
const qrcode = require("qrcode-terminal") as { generate: (text: string, opts?: { small?: boolean }) => void };

export type WhatsAppConfig = {
    enabled: boolean
    to?: string
    authDir: string
    requestTimeoutMs: number
}

type PendingReply = {
    resolve: (value: string | null) => void
    timeout: NodeJS.Timeout
}

export class WhatsAppClient {
    private _sock?: ReturnType<typeof makeWASocket>
    private _ready = false
    private _to?: string
    private _pending?: PendingReply
    private _initPromise?: Promise<void>
    private _lastQr?: string
    private _reconnectAttempts = 0
    private _reconnecting = false

    constructor(private readonly _config: WhatsAppConfig) { }

    async init(): Promise<void> {
        if (!this._config.enabled) return
        if (this._initPromise) return this._initPromise

        this._initPromise = this._start()
        return this._initPromise
    }

    async log(message: string): Promise<void> {
        if (!this._config.enabled) {
            console.log(message)
            return
        }

        await this.init()
        if (!this._sock || !this._to) {
            console.log(message)
            return
        }

        const ready = await this._waitForReady(Math.min(5_000, this._config.requestTimeoutMs))
        if (!ready) {
            console.log(message)
            return
        }

        await this._sendMessage(message)
    }

    async ask(prompt: string, timeoutMs?: number): Promise<string | null> {
        if (!this._config.enabled) return null

        await this.init()
        if (!this._sock || !this._to) return null

        const ready = await this._waitForReady(this._config.requestTimeoutMs)
        if (!ready) return null

        if (this._pending) {
            await this._sendMessage("Waiting for the previous response first.")
            return null
        }

        return new Promise((resolve) => {
            const waitMs = timeoutMs || this._config.requestTimeoutMs
            const timeout = setTimeout(() => {
                this._pending = undefined
                resolve(null)
            }, waitMs)

            this._pending = { resolve, timeout }
            void this._sendMessage(prompt)
        })
    }

    private async _start(): Promise<void> {
        if (this._config.to) {
            this._to = this._normalizeTo(this._config.to)
        } else {
            console.warn("WhatsApp enabled but WHATSAPP_TO is missing. QR will show, but messages won't be sent.")
        }

        const authDir = path.resolve(process.cwd(), this._config.authDir)
        const { state, saveCreds } = await useMultiFileAuthState(authDir)
        const { version } = await fetchLatestBaileysVersion()

        this._sock = makeWASocket({
            auth: state,
            version,
            logger: pino({ level: "info" })
        })

        this._sock.ev.on("creds.update", saveCreds)
        this._sock.ev.on("connection.update", (update) => {
            if (update.qr && update.qr !== this._lastQr) {
                this._lastQr = update.qr
                console.log("Scan this QR with WhatsApp:")
                qrcode.generate(update.qr, { small: true })
            }
            if (update.connection === "open") {
                this._ready = true
                this._reconnectAttempts = 0
                console.log("WhatsApp connected.")
            }
            if (update.connection === "close") {
                this._ready = false
                const statusCode = (update as { lastDisconnect?: { error?: { output?: { statusCode?: number } } } })
                    .lastDisconnect?.error?.output?.statusCode
                console.warn("WhatsApp disconnected.", statusCode ? `code=${statusCode}` : "")
                if (statusCode === 515) {
                    this._scheduleReconnect()
                }
            }
        })
        this._sock.ev.on("messages.upsert", (event) => {
            if (!this._pending) return

            const message = event.messages?.[0]
            if (!message) return
            if (message.key.fromMe) return
            if (this._to && message.key.remoteJid !== this._to) return

            const text = this._getMessageText(message.message)
            if (!text) return

            clearTimeout(this._pending.timeout)
            const resolve = this._pending.resolve
            this._pending = undefined
            resolve(text.trim())
        })
    }

    private async _waitForReady(timeoutMs: number): Promise<boolean> {
        if (!this._sock) return false
        if (this._ready) return true

        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            if (this._ready) return true
            await new Promise((resolve) => setTimeout(resolve, 250))
        }

        return false
    }

    private _scheduleReconnect() {
        if (this._reconnecting) return
        this._reconnecting = true
        this._reconnectAttempts += 1

        const delay = Math.min(3_000 * this._reconnectAttempts, 15_000)
        setTimeout(() => {
            this._reconnecting = false
            this._initPromise = undefined
            try {
                const sock = this._sock as unknown as { end?: (err?: Error) => void }
                sock?.end?.(new Error("Restarting WhatsApp connection"))
            } catch { }
            this._sock = undefined
            void this.init().catch((error) => {
                console.warn("WhatsApp reconnect failed.", error)
            })
        }, delay)
    }

    private async _sendMessage(text: string): Promise<void> {
        if (!this._sock || !this._to) return
        try {
            await this._sock.sendMessage(this._to, { text })
        } catch (error) {
            console.warn("Failed to send WhatsApp message.", error)
        }
    }

    private _normalizeTo(to: string): string {
        return `${to.replace(/\D/g, "")}@s.whatsapp.net`
    }

    private _getMessageText(message?: proto.IMessage | null): string | null {
        if (!message) return null
        return (
            message.conversation ||
            message.extendedTextMessage?.text ||
            message.imageMessage?.caption ||
            message.videoMessage?.caption ||
            null
        )
    }
}
