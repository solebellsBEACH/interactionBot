import { STOPWORDS } from "../constants/stopwords"

import type { WordRanking } from "../interface/ranking/word-ranking.types"

const normalizeForRanking = (text: string) => {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
}

const buildRanking = (normalized: string, top: number): WordRanking[] => {
  const counts = new Map<string, number>()
  for (const word of normalized.split(/\s+/g)) {
    if (!word || word.length < 2) continue
    if (STOPWORDS.has(word)) continue
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

export const rankWordsFromText = (text: string, top = 20): WordRanking[] => {
  if (!text.trim()) return []
  return buildRanking(normalizeForRanking(text), top)
}

export const rankWordsFromLines = (lines: string[], top = 20): WordRanking[] => {
  const combined = lines.filter(Boolean).join('\n')
  return rankWordsFromText(combined, top)
}
