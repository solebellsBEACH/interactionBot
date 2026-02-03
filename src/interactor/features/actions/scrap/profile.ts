import { Page } from "playwright"
import { DiscordClient } from "../../../shared/discord/discord-client"
import { LinkedinCoreFeatures } from "../../linkedin-core"

export class ProfileScraps {
        private readonly _discord?: DiscordClient
        private readonly _page: Page
        private readonly _navigator: LinkedinCoreFeatures
        constructor( page :Page, discord?: DiscordClient) {
            this._discord = discord
             this._page = page
             this._navigator = new LinkedinCoreFeatures(page)
        }

        getProfileInformations(){
            this._navigator.goToLinkedinURL('https://www.linkedin.com/in/xavierlucas/')
        }

        private async _goToProfilePage(){
            
        }
}