import { Page } from "playwright"
import { env } from "../../../shared/env"
import { LinkedinCoreFeatures } from "../../linkedin-core"
import { MyNetworkScrap } from "../scrap/my-network"
import { ProfileScraps } from "../scrap/profile"
import { saveDashboardAnalysis } from "../../../../api/controllers/dashboard-analyses"

type WordRanking = { word: string; count: number }

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
    let targetUrl = (profileUrl || env.linkedinURLs.recruiterURL || '').trim()

    if (mode !== 'network') {
      if (!targetUrl) {
        targetUrl = (await this._navigator.getOwnProfileUrl()) || ''
      }
      if (!targetUrl) {
        throw new Error('missing-profile-url')
      }
    }

    await this._navigator.auth()

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
      connectionsCount = network.subtitles.length
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
    const combined = parts.filter(Boolean).join('\n')
    return this._rankWords(combined)
  }

  private _rankWords(text: string, top = 20): WordRanking[] {
    if (!text.trim()) return []

    const normalized = text
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

    return Array.from(counts.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]
        return a[0].localeCompare(b[0])
      })
      .slice(0, top)
      .map(([word, count]) => ({ word, count }))
  }
}
