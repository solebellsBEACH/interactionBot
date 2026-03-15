import { ChannelType, Client, GatewayIntentBits, Message, PartialGroupDMChannel, TextBasedChannel } from "discord.js";
import { logger } from "../services/logger";

export type DiscordConfig = {
    enabled: boolean
    webhookUrl?: string
    botToken?: string
    channelId?: string
    requestTimeoutMs: number
    interactive: boolean
    consoleOnly: boolean
    commandPrefix?: string
    commandsEnabled?: boolean
}

type PromptChannel = Exclude<TextBasedChannel, PartialGroupDMChannel>;

export enum CommandName {
    Help = "help",
    EasyApply = "easy-apply",
    CatchJobs = "catch-jobs",
    SearchJobs = "search-jobs",
    Connect = "connect",
    UpvotePosts = "upvote-posts",
    ReviewProfile = "review-profile",
    ResetSession = "reset-session",
    Unknown = "unknown"
}

export type Command = {
    name: CommandName
    args: string[]
}

export type CommandHandler = (command: Command) => Promise<void>

type CommandHandlers = Partial<Record<CommandName, CommandHandler>>

type PendingPrompt = {
    resolve: (value: string | null) => void
    timeoutId: NodeJS.Timeout
    resolved: boolean
}

export class DiscordClient {
    private readonly _maxContentLength = 1900
    private _botClient?: Client
    private _botReady?: Promise<void>
    private _listenerAttached = false
    private readonly _pendingPrompts: PendingPrompt[] = []
    private _startupNotified = false
    private _commandHandlers: CommandHandlers = {}
    private _commandQueue = Promise.resolve()

    constructor(private readonly _config: DiscordConfig) {}

    async init(): Promise<void> {
        if (!this._config.enabled && !this._config.interactive) return
        if (this._config.consoleOnly) return

        if (this._config.enabled && !this._config.webhookUrl) {
            logger.warn("Discord enabled but DISCORD_WEBHOOK_URL is missing.")
        }

        if (!this._config.interactive) return
        if (!this._config.botToken) {
            logger.warn("Discord interactive enabled but DISCORD_BOT_TOKEN is missing.")
            return
        }
        if (!this._config.channelId) {
            logger.warn("Discord interactive enabled but DISCORD_CHANNEL_ID is missing.")
            return
        }

        try {
            await this._initBot()
            this._bindMessageListener()
            await this._sendStartupMessage()
        } catch (error) {
            logger.warn("Discord bot login failed.", error)
        }
    }

    setCommandHandlers(handlers: CommandHandlers) {
        this._commandHandlers = handlers
    }

    async sendMessage(message: string): Promise<void> {
        if (this._canUseDiscordPrompt()) {
            for (const chunk of this._splitMessage(message)) {
                await this._sendToPromptChannel(chunk)
            }
            return
        }

        await this.log(message)
    }

    async log(message: string): Promise<void> {
        if (!this._config.enabled || this._config.consoleOnly) {
            logger.info(message)
            return
        }

        if (!this._config.webhookUrl) {
            logger.info(message)
            return
        }

        for (const chunk of this._splitMessage(message)) {
            await this._postMessage(chunk)
        }
    }

    async ask(prompt: string, timeoutMs?: number): Promise<string | null> {
        if (!this._config.interactive) return null

        const effectiveTimeout = timeoutMs ?? this._config.requestTimeoutMs
        if (!this._canUseDiscordPrompt()) return null
        return this._promptDiscord(prompt, effectiveTimeout)
    }

    private _canUseDiscordPrompt() {
        return !this._config.consoleOnly && Boolean(this._config.botToken) && Boolean(this._config.channelId)
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
                    for (let index = 0; index < line.length; index += this._maxContentLength) {
                        chunks.push(line.slice(index, index + this._maxContentLength))
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
                logger.warn("Discord webhook failed.", {
                    status: response.status,
                    statusText: response.statusText
                })
            }
        } catch (error) {
            logger.warn("Discord webhook error.", error)
        } finally {
            clearTimeout(timeout)
        }
    }

    private async _promptDiscord(prompt: string, timeoutMs: number): Promise<string | null> {
        if (!this._config.botToken || !this._config.channelId) return null

        try {
            await this._initBot()
            this._bindMessageListener()
        } catch (error) {
            logger.warn("Discord bot login failed.", error)
            return null
        }

        const { pending, promise } = this._enqueuePrompt(timeoutMs)
        const sent = await this._sendToPromptChannel(prompt)
        if (!sent) {
            this._resolvePending(pending, null)
        }

        return promise
    }

    private _bindMessageListener() {
        if (!this._botClient || this._listenerAttached) return

        this._botClient.on("messageCreate", (message) => {
            void this._handleMessage(message)
        })

        this._listenerAttached = true
    }

    private async _handleMessage(message: Message) {
        if (!this._isPromptChannelMessage(message)) return
        if (message.author.bot) return

        const content = message.content.trim()
        if (!content) return

        if (this._commandsEnabled()) {
            const command = this._parseCommand(content)
            if (command) {
                await this._handleCommand(command)
                return
            }
        }

        if (this._hasPendingPrompt()) {
            this._resolveNextPrompt(content)
            return
        }

        await this._sendHelpMessage()
    }

    private _isPromptChannelMessage(message: Message) {
        if (!this._config.channelId) return false
        return message.channelId === this._config.channelId
    }

    private _commandsEnabled() {
        return this._config.commandsEnabled !== false
    }

    private _commandPrefix() {
        const prefix = this._config.commandPrefix?.trim()
        return prefix ? prefix : "!"
    }

    private _parseCommand(content: string): Command | null {
        const prefix = this._commandPrefix()
        if (!content.startsWith(prefix)) return null

        const parts = content.slice(prefix.length).trim().split(/\s+/).filter(Boolean)
        if (parts.length === 0) {
            return { name: CommandName.Help, args: [] }
        }

        const normalized = parts[0].toLowerCase()
        if (!this._isCommandName(normalized)) {
            return { name: CommandName.Unknown, args: parts.slice(1) }
        }

        return {
            name: normalized,
            args: parts.slice(1)
        }
    }

    private _isCommandName(value: string): value is CommandName {
        return Object.values(CommandName).includes(value as CommandName) && value !== CommandName.Unknown
    }

    private async _handleCommand(command: Command) {
        if (command.name === CommandName.Help) {
            await this._sendHelpMessage()
            return
        }

        if (command.name === CommandName.Unknown) {
            await this._sendUnknownCommand()
            return
        }

        const handler = this._commandHandlers[command.name]
        if (!handler) {
            await this._sendUnknownCommand()
            return
        }

        await this._runCommand(handler, command)
    }

    private _buildHelpMessage(prefix: string) {
        return [
            "Comandos disponiveis:",
            `${prefix}help - mostra esta mensagem`,
            `${prefix}easy-apply [tag] [max] --loc <local> --pages <n> - busca vagas e aplica`,
            `${prefix}search-jobs [tag] [max] --loc <local> --pages <n> - busca vagas com filtros`,
            `${prefix}connect <profileUrl> [mensagem] - envia convite`,
            `${prefix}upvote-posts - curte posts por tema`,
            `${prefix}review-profile - analisa e salva o seu perfil`,
            `${prefix}reset-session - desloga e limpa os dados locais`,
            "Se houver pergunta pendente, responda sem prefixo."
        ].join("\n")
    }

    private async _sendHelpMessage() {
        if (!this._commandsEnabled()) return

        const prefix = this._commandPrefix()
        await this.sendMessage(this._buildHelpMessage(prefix))
    }

    private async _sendUnknownCommand() {
        const prefix = this._commandPrefix()
        await this.sendMessage(`Comando desconhecido. Use ${prefix}help.`)
        await this._sendHelpMessage()
    }

    private async _runCommand(handler: CommandHandler, command: Command) {
        this._commandQueue = this._commandQueue
            .then(() => handler(command))
            .catch((error) => {
                logger.error("Discord command failed", error)
                return this.sendMessage("Falha ao executar o comando.")
            })

        return this._commandQueue
    }

    private _hasPendingPrompt() {
        return this._pendingPrompts.length > 0
    }

    private async _sendStartupMessage() {
        if (this._startupNotified) return

        await this.sendMessage("Bot iniciado")
        this._startupNotified = true
    }

    private async _sendToPromptChannel(content: string): Promise<boolean> {
        const channel = await this._getPromptChannel()
        if (!channel) {
            logger.warn("Discord channel not found or not text-based.")
            return false
        }

        try {
            await channel.send(content)
            return true
        } catch (error) {
            logger.warn("Discord message send failed.", error)
            return false
        }
    }

    private _enqueuePrompt(timeoutMs: number) {
        let resolveFn: (value: string | null) => void = () => undefined
        const pending: PendingPrompt = {
            resolve: (value) => resolveFn(value),
            resolved: false,
            timeoutId: setTimeout(() => this._resolvePending(pending, null), timeoutMs)
        }

        const promise = new Promise<string | null>((resolve) => {
            resolveFn = resolve
        })

        this._pendingPrompts.push(pending)
        return { pending, promise }
    }

    private _resolveNextPrompt(content: string) {
        const pending = this._pendingPrompts[0]
        if (!pending) return
        this._resolvePending(pending, content)
    }

    private _resolvePending(pending: PendingPrompt, value: string | null) {
        if (pending.resolved) return

        pending.resolved = true
        clearTimeout(pending.timeoutId)

        const index = this._pendingPrompts.indexOf(pending)
        if (index >= 0) {
            this._pendingPrompts.splice(index, 1)
        }

        pending.resolve(value)
    }

    private async _initBot(): Promise<void> {
        if (this._botReady) return this._botReady
        if (!this._config.botToken) return

        this._botClient = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        })

        this._botReady = this._botClient
            .login(this._config.botToken)
            .then(() => undefined)
            .catch((error) => {
                this._botReady = undefined
                throw error
            })

        return this._botReady
    }

    private async _getPromptChannel(): Promise<PromptChannel | null> {
        if (!this._botClient || !this._config.channelId) return null

        const channel = await this._botClient.channels.fetch(this._config.channelId).catch(() => null)
        if (!channel || !channel.isTextBased()) return null
        if (channel.type === ChannelType.GroupDM) return null

        return channel as PromptChannel
    }
}
