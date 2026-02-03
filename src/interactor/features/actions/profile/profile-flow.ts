import { Page } from "playwright"
import { ElementHandle } from "../../../shared/utils/element-handle"
import { LinkedinCoreFeatures } from "../../linkedin-core"
import { ProfileScraps } from "../scrap/profile"

export class ProfileFlow{

        private readonly _page: Page
        private readonly _profileScrap: ProfileScraps
        constructor(page: Page){
            this._page = page
            this._profileScrap = new ProfileScraps(page)
        }
        

        main(){
            this._profileScrap.getProfileInformations()
        }
}