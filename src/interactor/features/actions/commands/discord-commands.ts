import { CommandName, DiscordClient } from "../../../shared/discord/discord-client";
import { parseQuantityAndTag } from "./command-utils";
import { SearchJobsCommand } from "./search-jobs";
import type { LinkedinCommandActions } from "./types";

export class LinkedinDiscordCommands {
    private readonly _actions: LinkedinCommandActions
    private readonly _globalGeoId = '92000000'
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
                await discord.sendMessage('Comando renomeado para !easy-apply.')
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
            }
        })
    }

    private async _handleConnect(discord: DiscordClient, args: string[]) {
        const profileUrl = args[0]
        if (!profileUrl) {
            await discord.sendMessage('Informe a URL do perfil. Ex: !connect https://...')
            return
        }
        const message = args.slice(1).join(' ').trim()
        await discord.sendMessage(`Enviando convite para ${profileUrl}...`)
        await this._actions.sendConnection(profileUrl, message ? { message } : undefined)
        await discord.sendMessage('Convite enviado.')
    }

    private async _handleUpvotePosts(discord: DiscordClient) {
        const quantityAnswer = await discord.ask('Quantos posts voce quer curtir? (ex: 10)')
        if (!quantityAnswer) {
            await discord.sendMessage('Sem resposta. Operacao cancelada.')
            return
        }

        const parsed = parseQuantityAndTag(quantityAnswer)
        if (!parsed.count || parsed.count <= 0) {
            await discord.sendMessage('Quantidade invalida.')
            return
        }

        let tag = parsed.tag
        if (!tag) {
            const tagAnswer = await discord.ask('Qual tag/tema? (ex: react+next)')
            if (!tagAnswer) {
                await discord.sendMessage('Sem resposta. Operacao cancelada.')
                return
            }
            tag = tagAnswer.trim()
        }

        if (!tag) {
            await discord.sendMessage('Tag vazia. Operacao cancelada.')
            return
        }

        await discord.sendMessage(`Curtindo ${parsed.count} posts de "${tag}"...`)
        const links = await this._actions.upvoteOnPosts({ maxLikes: parsed.count, tag })
        await discord.sendMessage('Curtidas finalizadas.')
        if (links.length === 0) {
            await discord.sendMessage('Nao foi possivel capturar links dos posts.')
            return
        }
        await discord.sendMessage(`Links dos posts curtidos:\n${links.join('\n')}`)
    }
}
