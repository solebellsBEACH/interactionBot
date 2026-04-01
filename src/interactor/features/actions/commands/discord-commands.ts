import { CommandName, DiscordClient } from "../../../shared/discord/discord-client";
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
            }
        })
    }
}
