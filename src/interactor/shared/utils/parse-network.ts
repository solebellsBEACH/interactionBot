export const parseConnectionsCount = (text: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const raw = match[1] || match[2] || ''
    const digits = raw.replace(/[^\d]/g, '')
    if (!digits) continue
    const parsed = Number(digits)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }
  return undefined
}
