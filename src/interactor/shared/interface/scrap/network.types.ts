import type { WordRanking } from "../ranking/word-ranking.types"

export type MyNetworkScrapResult = {
  subtitles: string[]
  ranking: WordRanking[]
  connectionsCount?: number
}

export type VisitConnectionsOptions = {
  maxToVisit?: number
  delayMs?: number
  maxScrollRounds?: number
  maxIdleRounds?: number
}
