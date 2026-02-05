import { Page } from "playwright"
import { ProfileScraps } from "../scrap/profile"

export class ProfileFlow{

        private readonly _page: Page
        private readonly _profileScrap: ProfileScraps
        constructor(page: Page){
            this._page = page
            this._profileScrap = new ProfileScraps(page)
        }
        

        async main(){
            // const green = "\x1b[32m"
            // const reset = "\x1b[0m"
            // console.log(`${green}[profile-flow]${reset} iniciando scrape do perfil`)
            // const result = await this._profileScrap.scrapeProfile('https://www.linkedin.com/in/xavierlucas/')
            // console.log(`${green}[profile-flow]${reset} scrape concluido`, { experiences: result.experiences.length })
            // console.log(result)
        }
}
