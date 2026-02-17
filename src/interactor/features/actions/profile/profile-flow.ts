import { Page } from "playwright"
import { env } from "../../../shared/env"
import { LinkedinCoreFeatures } from "../../linkedin-core"
import { ProfileScraps } from "../../../shared/scrap/profile"
import { MyNetworkScrap } from "../../../shared/scrap/my-network"
import { rankWordsFromText } from "../../../shared/utils/word-ranking"
import type { WordRanking } from "../../../shared/interface/ranking/word-ranking.types"
import { ERROR_CODES } from "../../../shared/constants/errors"

export class ProfileFlow{

        private readonly _page: Page
        private readonly _navigator: LinkedinCoreFeatures
        private readonly _profileScrap: ProfileScraps
        private readonly _myNetworkScrap: MyNetworkScrap
        constructor(page: Page){
            this._page = page
            this._navigator = new LinkedinCoreFeatures(page)
            this._profileScrap = new ProfileScraps(page, this._navigator)
            this._myNetworkScrap = new MyNetworkScrap(page, this._navigator)
        }
        

        async main(profileUrl?: string){
            let targetUrl = (profileUrl || env.linkedinURLs.recruiterURL || '').trim()

            await this._navigator.auth()

            if (!targetUrl) {
                targetUrl = (await this._navigator.getOwnProfileUrl()) || ''
            }

            if (!targetUrl) {
                throw new Error(ERROR_CODES.missingProfileUrl)
            }

            console.log(`[profile] iniciando scrape: ${targetUrl}`)
            // const result = await this._profileScrap.scrapeProfile(targetUrl)
            // console.log(result)
            // this._logWordRanking(result)

            
            // console.log(`[profile] about chars: ${result.about.length}`)
            // if (result.about) {
            //     const normalized = result.about.replace(/\s+/g, ' ').trim()
            //     console.log(`[profile] about: ${normalized}`)
            // }
            // console.log(`[profile] experiences: ${result.experiences.length}`)

            // if (result.experiences.length > 0) {
            //     console.log('[profile] experiencias (primeiras 5):')
            //     for (const [idx, exp] of result.experiences.slice(0, 5).entries()) {
            //         const summary = [exp.title, exp.company, exp.location].filter(Boolean).join(' | ')
            //         console.log(`${idx + 1}. ${summary}`)
            //     }
            // }
        }



        private _logWordRanking(result: { about: string; experiences: Array<{ title: string; company: string; dates: string; location: string; description: string }> }, top = 20) {
            const parts: string[] = []
            if (result.about) parts.push(result.about)
            for (const exp of result.experiences || []) {
                parts.push(exp.title, exp.company, exp.dates, exp.location, exp.description)
            }

            const combined = parts.filter(Boolean).join('\n')
            if (!combined.trim()) {
                console.log('[profile] ranking palavras: sem conteúdo')
                return
            }
            const ranking: WordRanking[] = rankWordsFromText(combined, top)
            console.log(`[profile] ranking palavras (top ${top}):`)
            for (const [idx, { word, count }] of ranking.entries()) {
                console.log(`${idx + 1}. ${word} (${count})`)
            }
        }
}
