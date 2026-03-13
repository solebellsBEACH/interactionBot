import { CommandName, DiscordClient } from "../../../shared/discord/discord-client";
import { parseQuantityAndTag } from "./command-utils";
import { SearchJobsCommand } from "./search-jobs";
import type { LinkedinCommandActions } from "./types";

export class LinkedinDiscordCommands {
    private readonly _actions: LinkedinCommandActions
    private readonly _globalGeoId = "92000000"
    private readonly _searchJobs: SearchJobsCommand

    constructor(actions: LinkedinCommandActions) {
        this._actions = actions
        this._searchJobs = new SearchJobsCommand(actions, this._globalGeoId)
    }

    register(discord: DiscordClient) {
        discord.setCommandHandlers({
            [CommandName.EasyApply]: async ({ args }) => {
                await this._searchJobs.run(discord, args, true)
            },
            [CommandName.CatchJobs]: async ({ args }) => {
                await discord.sendMessage("Comando renomeado para !easy-apply.")
                await this._searchJobs.run(discord, args, true)
            },
            [CommandName.SearchJobs]: async ({ args }) => {
                await this._searchJobs.run(discord, args, false)
            },
            [CommandName.Connect]: async ({ args }) => {
                await this._handleConnect(discord, args)
            },
            [CommandName.UpvotePosts]: async () => {
                await this._handleUpvotePosts(discord)
            },
            [CommandName.ReviewProfile]: async () => {
                await this._handleReviewProfile(discord)
            },
            [CommandName.ResetSession]: async () => {
                await this._handleResetSession(discord)
            }
        })
    }

    private async _handleConnect(discord: DiscordClient, args: string[]) {
        const profileUrl = args[0]
        if (!profileUrl) {
            await discord.sendMessage("Informe a URL do perfil. Ex: !connect https://...")
            return
        }

        const message = args.slice(1).join(" ").trim()
        await discord.sendMessage(`Enviando convite para ${profileUrl}...`)
        await this._actions.sendConnection(profileUrl, message ? { message } : undefined)
        await discord.sendMessage("Convite enviado.")
    }

    private async _handleUpvotePosts(discord: DiscordClient) {
        const quantityAnswer = await discord.ask("Quantos posts voce quer curtir? (ex: 10)")
        if (!quantityAnswer) {
            await discord.sendMessage("Sem resposta. Operacao cancelada.")
            return
        }

        const parsed = parseQuantityAndTag(quantityAnswer)
        if (!parsed.count || parsed.count <= 0) {
            await discord.sendMessage("Quantidade invalida.")
            return
        }

        let tag = parsed.tag
        if (!tag) {
            const tagAnswer = await discord.ask("Qual tag/tema? (ex: react+next)")
            if (!tagAnswer) {
                await discord.sendMessage("Sem resposta. Operacao cancelada.")
                return
            }
            tag = tagAnswer.trim()
        }

        if (!tag) {
            await discord.sendMessage("Tag vazia. Operacao cancelada.")
            return
        }

        await discord.sendMessage(`Curtindo ${parsed.count} posts de "${tag}"...`)
        const links = await this._actions.upvoteOnPosts({ maxLikes: parsed.count, tag })
        await discord.sendMessage("Curtidas finalizadas.")

        if (links.length === 0) {
            await discord.sendMessage("Nao foi possivel capturar links dos posts.")
            return
        }

        await discord.sendMessage(`Links dos posts curtidos:\n${links.join("\n")}`)
    }

    private async _handleReviewProfile(discord: DiscordClient) {
        if (!this._actions.reviewOwnProfile) {
            await discord.sendMessage("Comando indisponivel nesta instancia.")
            return
        }

        await discord.sendMessage("Analisando o perfil e atualizando o JSON salvo...")
        const profile = await this._actions.reviewOwnProfile()
        const parsed = profile.profileReview?.parsed
        const overallScore = typeof parsed?.overall_score === "number" ? parsed.overall_score : null
        const name = profile.linkedinProfile?.name || "Perfil"
        const totalExperience = profile.linkedinProfile?.totalExperienceLabel || "0 meses"
        const stacks = Object.keys(profile.stackExperience).length

        const lines = [
            `${name} revisado com sucesso.`,
            overallScore !== null ? `Score geral: ${overallScore}` : undefined,
            `Experiencia total: ${totalExperience}`,
            `Stacks mapeadas: ${stacks}`
        ].filter(Boolean)

        await discord.sendMessage(lines.join("\n"))
    }

    private async _handleResetSession(discord: DiscordClient) {
        if (!this._actions.resetSession) {
            await discord.sendMessage("Comando indisponivel nesta instancia.")
            return
        }

        const confirmation = await discord.ask("Confirmar reset completo da sessao? (sim/nao)")
        if (!confirmation || !/^(s|sim|y|yes)\b/i.test(confirmation.trim())) {
            await discord.sendMessage("Reset cancelado.")
            return
        }

        await discord.sendMessage("Deslogando e limpando os dados locais...")
        const result = await this._actions.resetSession()
        await discord.sendMessage(
            [
                "Reset concluido.",
                `applications: ${result.cleared.applications}`,
                `easyApplyResponses: ${result.cleared.easyApplyResponses}`,
                `fieldAnswers: ${result.cleared.fieldAnswers}`,
                `gptInteractions: ${result.cleared.gptInteractions}`
            ].join("\n")
        )
    }
}
