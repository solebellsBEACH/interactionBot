export const normalizeAnswer = (value: string) => {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
}

export const isAffirmative = (value: string) => {
    const normalized = normalizeAnswer(value)
    if (!normalized) return false
    return /^(s|sim|y|yes|ok|1|aplicar|aplica|apply)\b/.test(normalized)
}

export const isNegative = (value: string) => {
    const normalized = normalizeAnswer(value)
    if (!normalized) return false
    return /^(n|nao|no)\b/.test(normalized)
}

export const isStop = (value: string) => {
    const normalized = normalizeAnswer(value)
    if (!normalized) return false
    return /^(parar|stop|sair|cancelar)\b/.test(normalized)
}

export const isSkip = (value: string) => {
    const normalized = normalizeAnswer(value)
    if (!normalized) return false
    return /^(skip|pular|nao|n)\b/.test(normalized)
}

export const parseQuantityAndTag = (value: string) => {
    const trimmed = value.trim()
    const match = trimmed.match(/(\d+)/)
    const count = match ? Number(match[1]) : 0
    const remainder = match ? trimmed.replace(match[1], '').trim() : ''
    let tag = remainder.replace(/^posts?\s+de\s+/i, '').replace(/^posts?\s+/i, '').trim()
    if (!tag) {
        tag = remainder.replace(/^de\s+/i, '').trim()
    }
    return {
        count: Number.isNaN(count) ? 0 : count,
        tag: tag || undefined
    }
}

export const normalizeArgValue = (value?: string) => {
    if (!value) return undefined
    return value.replace(/[+_]/g, ' ').trim()
}

export const parseArgNumber = (value?: string) => {
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed
}

export const parseMaxResultsAnswer = (value: string | null) => {
    if (!value) return undefined
    const normalized = normalizeAnswer(value)
    if (!normalized) return undefined
    if (/^(todas|todos|all|tudo)$/.test(normalized)) return undefined
    const match = normalized.match(/(\d+)/)
    if (!match) return undefined
    const parsed = Number(match[1])
    return parsed > 0 ? parsed : undefined
}

export const parseApplicantsAnswer = (value: string | null) => {
    if (!value) return undefined
    const normalized = normalizeAnswer(value)
    if (!normalized) return undefined
    if (/^(skip|pular|nao|n|tudo|todas|todos|all)$/.test(normalized)) return undefined
    const match = normalized.match(/(\d+)/)
    if (!match) return undefined
    const parsed = Number(match[1])
    return parsed > 0 ? parsed : undefined
}

export const parseLocationAnswer = (value: string | null) => {
    if (!value) return undefined
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const normalized = normalizeAnswer(trimmed)
    if (/^(skip|pular|nao|n)$/.test(normalized)) return undefined
    return trimmed
}

export const parseMaxPagesAnswer = (value: string | null) => {
    if (!value) return undefined
    const normalized = normalizeAnswer(value)
    if (!normalized) return undefined
    if (/^(pular|skip|padrao|default|nao|n)$/.test(normalized)) return undefined
    const match = normalized.match(/(\d+)/)
    if (!match) return undefined
    const parsed = Number(match[1])
    return parsed > 0 ? parsed : undefined
}
