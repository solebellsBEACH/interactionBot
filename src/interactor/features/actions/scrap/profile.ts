import { DiscordClient } from "../../../shared/discord/discord-client"

export class ProfileScraps {
        private readonly _discord?: DiscordClient
    
        constructor( discord?: DiscordClient) {
            this._discord = discord
        }
}