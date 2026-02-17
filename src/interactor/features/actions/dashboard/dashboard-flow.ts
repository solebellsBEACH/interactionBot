import { Page } from "playwright"
import { env } from "../../../shared/env"
import { rankWordsFromLines, type WordRanking } from "../../../shared/utils/word-ranking"
import { LinkedinCoreFeatures } from "../../linkedin-core"
import { MyNetworkScrap } from "../scrap/my-network"
import { ProfileScraps } from "../scrap/profile"
import { saveDashboardAnalysis } from "../../../../api/controllers/dashboard-analyses"

type DashboardMode = 'full' | 'profile' | 'network'

type DashboardPayload = {
  profileWords: WordRanking[]
  networkWords: WordRanking[]
  meta: {
    profileUrl?: string
    connectionsCount?: number
    scrapedAt: string
    mode: DashboardMode
  }
}

export class DashboardFlow {
  private readonly _navigator: LinkedinCoreFeatures
  private readonly _profileScrap: ProfileScraps
  private readonly _networkScrap: MyNetworkScrap

  constructor(page: Page, navigator: LinkedinCoreFeatures) {
    this._navigator = navigator
    this._profileScrap = new ProfileScraps(page, navigator)
    this._networkScrap = new MyNetworkScrap(page, navigator)
  }

  async main(profileUrl?: string) {
    return this._run('full', profileUrl)
  }

  async profileOnly(profileUrl?: string) {
    return this._run('profile', profileUrl)
  }

  async networkOnly() {
    return this._run('network')
  }

  private async _run(mode: DashboardMode, profileUrl?: string) {
    await this._navigator.auth()

    let targetUrl = (profileUrl || env.linkedinURLs.recruiterURL || '').trim()
    if (targetUrl.includes('/in/me')) {
      targetUrl = ''
    }

    if (mode !== 'network') {
      if (!targetUrl) {
        targetUrl = (await this._navigator.getOwnProfileUrl()) || ''
      }
      if (!targetUrl) {
        throw new Error('missing-profile-url')
      }
    }

    let profileWords: WordRanking[] = []
    let networkWords: WordRanking[] = []
    let connectionsCount: number | undefined

    if (mode === 'full' || mode === 'profile') {
      const profile = await this._profileScrap.scrapeProfile(targetUrl)
      profileWords = this._rankProfileWords(profile)
    }

    if (mode === 'full' || mode === 'network') {
      const network = await this._networkScrap.myConnections()
      networkWords = network.ranking
      connectionsCount = network.connectionsCount ?? network.subtitles.length
      if (!networkWords.length) {
        console.log('[dashboard] network: sem keywords detectadas')
      }
    }

    const payload: DashboardPayload = {
      profileWords,
      networkWords,
      meta: {
        profileUrl: targetUrl || undefined,
        connectionsCount,
        scrapedAt: new Date().toISOString(),
        mode
      }
    }

    try {
      await saveDashboardAnalysis({
        type: mode,
        profileWords: profileWords.length ? profileWords : undefined,
        networkWords: networkWords.length ? networkWords : undefined,
        profileUrl: targetUrl || undefined,
        connectionsCount
      })
    } catch (error) {
      console.warn('[dashboard] falha ao salvar no banco:', error)
    }

    console.log(`[dashboard] data: ${JSON.stringify(payload)}`)
    return payload
  }

  private _rankProfileWords(profile: {
    about: string
    experiences: Array<{ title: string; company: string; dates: string; location: string; description: string }>
  }) {
    const parts: string[] = []
    if (profile.about) parts.push(profile.about)
    for (const exp of profile.experiences || []) {
      parts.push(exp.title, exp.company, exp.dates, exp.location, exp.description)
    }
    return rankWordsFromLines(parts)
  }
}
