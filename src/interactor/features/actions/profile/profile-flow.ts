import { Page } from "playwright"
import { env } from "../../../shared/env"
import { LinkedinCoreFeatures } from "../../linkedin-core"
import { ProfileScraps } from "../scrap/profile"
import { MyNetworkScrap } from "../scrap/my-network"

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
            const targetUrl = (profileUrl || env.linkedinURLs.recruiterURL || '').trim()
            if (!targetUrl) {
                throw new Error('missing-profile-url')
            }

            await this._navigator.auth()
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

            const normalized = combined
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ')

            const stopwords = new Set([
                'a','as','o','os','um','uma','uns','umas','de','da','do','das','dos','e','ou','em','no','na','nos','nas',
                'por','para','com','sem','sob','sobre','entre','ate','até','ao','aos','à','às','que','se','sua','seu','suas','seus',
                'como','mais','menos','muito','muitos','muita','muitas','foi','era','sao','são','ser','estar','tem','tendo',
                'the','and','or','in','on','at','to','for','of','with','from','by','is','are','was','were','be','been','being','as'
            ])

            const counts = new Map<string, number>()
            for (const word of normalized.split(/\s+/g)) {
                if (!word || word.length < 2) continue
                if (stopwords.has(word)) continue
                counts.set(word, (counts.get(word) ?? 0) + 1)
            }

            const ranking = Array.from(counts.entries())
                .sort((a, b) => {
                    if (b[1] !== a[1]) return b[1] - a[1]
                    return a[0].localeCompare(b[0])
                })
                .slice(0, top)

            console.log(`[profile] ranking palavras (top ${top}):`)
            for (const [idx, [word, count]] of ranking.entries()) {
                console.log(`${idx + 1}. ${word} (${count})`)
            }
        }
}
