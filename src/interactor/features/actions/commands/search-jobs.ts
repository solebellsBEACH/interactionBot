import type { DiscordClient } from "../../../shared/discord/discord-client";
import type { EasyApplyJobResult, SearchJobTagOptions } from "../../../shared/interface/scrap/jobs.types";
import type { LinkedinCommandActions, SearchFilters } from "./types";
import {
    isAffirmative,
    isNegative,
    isSkip,
    isStop,
    normalizeArgValue,
    parseApplicantsAnswer,
    parseArgNumber,
    parseLocationAnswer,
    parseMaxPagesAnswer,
    parseMaxResultsAnswer
} from "./command-utils";

type ParsedSearchArgs = {
    tag?: string
    maxResults?: number
    location?: string
    maxPages?: number
    onlyNonPromoted?: boolean
    maxApplicants?: number
    easyApplyOnly?: boolean
    useGlobalGeo?: boolean
    skipLocationPrompt?: boolean
    skipMaxPagesPrompt?: boolean
    skipApplicantsPrompt?: boolean
    autoApply?: boolean
    workplaceTypes?: string[]
    startOffset?: number
}

export class SearchJobsCommand {
    private readonly _actions: LinkedinCommandActions
    private readonly _globalGeoId: string

    constructor(actions: LinkedinCommandActions, globalGeoId: string) {
        this._actions = actions
        this._globalGeoId = globalGeoId
    }

    async run(discord: DiscordClient, args: string[], applyMode: boolean) {
        const parsed = this._parseSearchArgs(args)
        const filters = await this._resolveSearchFilters(discord, parsed)
        if (!filters) return

        const searchOptions = this._buildSearchOptions(filters)
        const summary = this._buildSearchSummary(filters)
        await discord.sendMessage(`Buscando vagas para "${filters.tag}"${summary ? ` (${summary})` : ""}...`)
        const results = await this._actions.searchJobTag(filters.tag, searchOptions)
        if (results.length === 0) {
            await discord.sendMessage("Nenhuma vaga encontrada.")
            return
        }

        await discord.sendMessage(`Encontradas ${results.length} vagas.`)
        await discord.sendMessage(this._formatJobs(results))

        if (!applyMode) return

        let applyJobs = results
        if (!filters.easyApplyOnly) {
            applyJobs = results.filter((job) => job.easyApply)
            await discord.sendMessage(`Vagas com Easy Apply: ${applyJobs.length}/${results.length}.`)
        }

        if (applyJobs.length === 0) {
            await discord.sendMessage("Nenhuma vaga com Easy Apply para aplicar.")
            return
        }

        let autoApply = parsed.autoApply
        if (autoApply === undefined) {
            const autoAnswer = await discord.ask("Quer candidatar automaticamente? (sim/nao)")
            if (!autoAnswer) {
                await discord.sendMessage("Sem resposta. Aplicacao cancelada.")
                return
            }
            autoApply = isAffirmative(autoAnswer)
        }

        if (!autoApply) {
            await discord.sendMessage("Modo manual: voce pode pular vagas.")
        }

        await discord.sendMessage(`Iniciando Easy Apply em ${applyJobs.length} vagas...`)
        for (let index = 0; index < applyJobs.length; index++) {
            const job = applyJobs[index]

            if (!autoApply) {
                await discord.sendMessage(
                    `Vaga ${index + 1}/${applyJobs.length}:\n${job.title} | ${job.company} | ${job.location}\n${job.url}`
                )
                const decision = await discord.ask("Aplicar esta vaga? (sim/skip/parar)")
                if (!decision) {
                    await discord.sendMessage("Sem resposta. Vaga pulada.")
                    continue
                }
                if (isStop(decision)) {
                    await discord.sendMessage("Aplicacao interrompida.")
                    break
                }
                if (!isAffirmative(decision) && isSkip(decision)) {
                    await discord.sendMessage("Vaga pulada.")
                    continue
                }
                if (!isAffirmative(decision)) {
                    await discord.sendMessage("Vaga pulada.")
                    continue
                }
            }

            try {
                await this._actions.easyApply(job.url)
            } catch {
                await discord.sendMessage(`Falha no Easy Apply: ${job.url}`)
            }

            if ((index + 1) % 5 === 0 || index === applyJobs.length - 1) {
                await discord.sendMessage(`Progresso: ${index + 1}/${applyJobs.length}`)
            }

            await this._wait(1500)
        }

        await discord.sendMessage("Easy Apply finalizado.")
    }

    private async _resolveSearchFilters(discord: DiscordClient, parsed: ParsedSearchArgs): Promise<SearchFilters | null> {
        let tag = parsed.tag
        let maxResults = parsed.maxResults
        let location = parsed.location
        let maxPages = parsed.maxPages
        let geoId: string | undefined = parsed.useGlobalGeo ? this._globalGeoId : undefined
        let onlyNonPromoted = parsed.onlyNonPromoted
        let maxApplicants = parsed.maxApplicants
        let easyApplyOnly = parsed.easyApplyOnly
        const workplaceTypes = parsed.workplaceTypes
        const startOffset = parsed.startOffset

        if (!tag) {
            const tagAnswer = await discord.ask("Qual tag de busca? (ex: react+next)")
            tag = tagAnswer?.trim() || undefined
        }

        if (!tag) {
            await discord.sendMessage("Sem tag. Operacao cancelada.")
            return null
        }

        if (/linkedin\.com\/jobs\/view/i.test(tag)) {
            await discord.sendMessage("Modo por URL removido. Informe uma tag ou use !search-jobs.")
            return null
        }

        if (!maxResults) {
            const quantityAnswer = await discord.ask('Quantas vagas deseja buscar? (ex: 20 ou "todas")')
            maxResults = parseMaxResultsAnswer(quantityAnswer)
        }

        if (!location && geoId === undefined && !parsed.skipLocationPrompt) {
            const wantsLocation = await discord.ask("Deseja filtrar por localizacao? (sim/nao ou informe a localizacao)")
            if (wantsLocation) {
                if (isAffirmative(wantsLocation)) {
                    const locationAnswer = await discord.ask("Localizacao (ex: Sao Paulo, Remote)")
                    location = parseLocationAnswer(locationAnswer)
                    if (location) {
                        geoId = undefined
                    }
                } else if (isNegative(wantsLocation)) {
                    geoId = this._globalGeoId
                } else if (!isSkip(wantsLocation)) {
                    location = parseLocationAnswer(wantsLocation)
                    if (location) {
                        geoId = undefined
                    }
                }
            }
        }

        if (maxPages === undefined && !parsed.skipMaxPagesPrompt) {
            const wantsPages = await discord.ask("Deseja limitar paginas? (sim/nao ou informe o numero)")
            if (wantsPages) {
                const directPages = parseMaxPagesAnswer(wantsPages)
                if (directPages) {
                    maxPages = directPages
                } else if (isAffirmative(wantsPages)) {
                    const pagesAnswer = await discord.ask("Quantas paginas deseja percorrer? (ex: 2)")
                    maxPages = parseMaxPagesAnswer(pagesAnswer)
                }
            }
        }

        if (onlyNonPromoted === undefined) {
            const promotedAnswer = await discord.ask("Incluir vagas promovidas? (sim/nao)")
            if (promotedAnswer) {
                if (isNegative(promotedAnswer)) {
                    onlyNonPromoted = true
                } else if (isAffirmative(promotedAnswer)) {
                    onlyNonPromoted = false
                }
            }
        }

        if (maxApplicants === undefined && !parsed.skipApplicantsPrompt) {
            const applicantsAnswer = await discord.ask("Limitar numero de candidaturas? (sim/nao ou informe o max)")
            const parsedApplicants = parseApplicantsAnswer(applicantsAnswer)
            if (parsedApplicants !== undefined) {
                maxApplicants = parsedApplicants
            } else if (applicantsAnswer && isAffirmative(applicantsAnswer)) {
                const limitAnswer = await discord.ask("Maximo de candidaturas? (ex: 50)")
                maxApplicants = parseApplicantsAnswer(limitAnswer)
            }
        }

        if (easyApplyOnly === undefined) {
            const easyApplyAnswer = await discord.ask("Somente Easy Apply? (sim/nao)")
            if (easyApplyAnswer) {
                easyApplyOnly = isAffirmative(easyApplyAnswer)
            }
        }

        return {
            tag,
            maxResults,
            location,
            geoId,
            maxPages,
            onlyNonPromoted: onlyNonPromoted ?? false,
            maxApplicants,
            easyApplyOnly: easyApplyOnly ?? true,
            workplaceTypes,
            startOffset
        }
    }

    private _buildSearchOptions(filters: SearchFilters): SearchJobTagOptions {
        return {
            ...(filters.maxResults ? { maxResults: filters.maxResults } : {}),
            ...(filters.location ? { location: filters.location } : {}),
            ...(filters.geoId ? { geoId: filters.geoId } : {}),
            ...(filters.maxPages ? { maxPages: filters.maxPages } : {}),
            ...(filters.workplaceTypes ? { workplaceTypes: filters.workplaceTypes } : {}),
            ...(filters.startOffset ? { startOffset: filters.startOffset } : {}),
            easyApplyOnly: filters.easyApplyOnly,
            onlyNonPromoted: filters.onlyNonPromoted,
            maxApplicants: filters.maxApplicants,
            includeDetails: true
        }
    }

    private _buildSearchSummary(filters: SearchFilters) {
        return [
            filters.maxResults ? `max: ${filters.maxResults}` : undefined,
            filters.location ? `local: ${filters.location}` : (filters.geoId ? `geoId: ${filters.geoId}` : undefined),
            filters.maxPages ? `paginas: ${filters.maxPages}` : undefined,
            `promovidas: ${filters.onlyNonPromoted ? "nao" : "sim"}`,
            filters.maxApplicants !== undefined ? `candidaturas <= ${filters.maxApplicants}` : undefined,
            `easy apply: ${filters.easyApplyOnly ? "sim" : "tudo"}`,
            filters.workplaceTypes?.includes("2") ? "remoto" : undefined,
            filters.startOffset ? `inicio: ${filters.startOffset}` : undefined
        ].filter(Boolean).join(" | ")
    }

    private _formatJobs(jobs: EasyApplyJobResult[]) {
        return jobs
            .map((job, index) => {
                const promotedLabel = job.promoted ? "sim" : "nao"
                const easyApplyLabel = job.easyApply ? "sim" : "nao"
                const applicantsLabel = job.applicants === null ? "-" : String(job.applicants)
                return `${index + 1}. ${job.title} | ${job.company} | ${job.location} | easy apply: ${easyApplyLabel} | promovida: ${promotedLabel} | candidaturas: ${applicantsLabel} | ${job.url}`
            })
            .join("\n")
    }

    private _parseSearchArgs(args: string[]): ParsedSearchArgs {
        const parts = [...args]
        const leftover: string[] = []
        let maxResults: number | undefined
        let maxPages: number | undefined
        let location: string | undefined
        let onlyNonPromoted: boolean | undefined
        let maxApplicants: number | undefined
        let easyApplyOnly: boolean | undefined
        let useGlobalGeo = false
        let skipLocationPrompt = false
        let skipMaxPagesPrompt = false
        let skipApplicantsPrompt = false
        let autoApply: boolean | undefined
        let workplaceTypes: string[] | undefined
        let startOffset: number | undefined

        const parseInline = (rawValue: string, normalizedValue: string, keys: string[]) => {
            for (const key of keys) {
                if (normalizedValue.startsWith(`${key}:`)) {
                    const separatorIndex = rawValue.indexOf(":")
                    return normalizeArgValue(rawValue.slice(separatorIndex + 1))
                }
                if (normalizedValue.startsWith(`${key}=`)) {
                    const separatorIndex = rawValue.indexOf("=")
                    return normalizeArgValue(rawValue.slice(separatorIndex + 1))
                }
            }
            return undefined
        }

        const isBoundaryToken = (value: string) => {
            if (!value) return true

            const lowered = value.toLowerCase()
            if (lowered.startsWith("--")) return true

            const match = lowered.match(/^([a-z0-9_-]+)[:=]/)
            if (!match) return false

            const key = match[1]
            return [
                "loc",
                "location",
                "local",
                "localizacao",
                "pages",
                "page",
                "paginas",
                "pagina",
                "max",
                "limit",
                "results",
                "vagas",
                "applicants",
                "candidaturas",
                "candidatos",
                "promoted",
                "promovidas",
                "easy",
                "easyapply",
                "auto",
                "automatico"
            ].includes(key)
        }

        const collectValue = (startIndex: number) => {
            const tokens: string[] = []
            let index = startIndex

            while (index < parts.length && !isBoundaryToken(parts[index])) {
                tokens.push(parts[index])
                index++
            }

            return {
                value: normalizeArgValue(tokens.join(" ")),
                endIndex: index - 1
            }
        }

        for (let index = 0; index < parts.length; index++) {
            const raw = parts[index]
            const normalized = raw.toLowerCase()

            if (
                normalized === "--only-non-promoted" ||
                normalized === "--non-promoted" ||
                normalized === "--no-promoted" ||
                normalized === "--nao-promovidas" ||
                normalized === "--sem-promocao"
            ) {
                onlyNonPromoted = true
                continue
            }

            if (
                normalized === "--include-promoted" ||
                normalized === "--promoted" ||
                normalized === "--com-promovidas"
            ) {
                onlyNonPromoted = false
                continue
            }

            if (normalized === "--all-jobs" || normalized === "--all" || normalized === "--tudo") {
                easyApplyOnly = false
                continue
            }

            if (normalized === "--easy-apply-only" || normalized === "--only-easy-apply" || normalized === "--easy-apply") {
                easyApplyOnly = true
                continue
            }

            if (
                normalized === "--no-location" ||
                normalized === "--without-location" ||
                normalized === "--sem-localizacao"
            ) {
                location = undefined
                useGlobalGeo = true
                skipLocationPrompt = true
                continue
            }

            if (normalized === "--skip-location" || normalized === "--pular-localizacao") {
                location = undefined
                useGlobalGeo = false
                skipLocationPrompt = true
                continue
            }

            if (normalized === "--no-pages" || normalized === "--sem-paginas" || normalized === "--unlimited-pages") {
                maxPages = undefined
                skipMaxPagesPrompt = true
                continue
            }

            if (
                normalized === "--no-applicants-limit" ||
                normalized === "--sem-limite-candidaturas" ||
                normalized === "--no-max-applicants"
            ) {
                maxApplicants = undefined
                skipApplicantsPrompt = true
                continue
            }

            if (normalized === "--auto" || normalized === "--auto-apply" || normalized === "--automatico") {
                autoApply = true
                continue
            }

            if (normalized === "--manual" || normalized === "--manual-apply") {
                autoApply = false
                continue
            }

            if (
                normalized === "--remote" ||
                normalized === "--remoto" ||
                normalized === "--remote-only" ||
                normalized === "--somente-remoto" ||
                normalized === "--only-remote"
            ) {
                workplaceTypes = ["2"]
                continue
            }

            if (normalized === "--start" || normalized === "--inicio" || normalized === "--skip") {
                const val = parseArgNumber(parts[index + 1])
                if (val !== undefined) {
                    startOffset = val
                    index++
                }
                continue
            }

            if (normalized === "--loc" || normalized === "--location" || normalized === "--local" || normalized === "--localizacao") {
                const collected = collectValue(index + 1)
                const parsedLocation = parseLocationAnswer(collected.value || null)
                if (parsedLocation) {
                    location = parsedLocation
                    useGlobalGeo = false
                } else if (collected.value && isNegative(collected.value)) {
                    location = undefined
                    useGlobalGeo = true
                    skipLocationPrompt = true
                }
                index = collected.endIndex
                continue
            }

            if (normalized === "--pages" || normalized === "--page" || normalized === "--paginas" || normalized === "--pagina" || normalized === "--max-pages") {
                maxPages = parseArgNumber(parts[index + 1])
                skipMaxPagesPrompt = true
                index++
                continue
            }

            if (normalized === "--max" || normalized === "--limit" || normalized === "--results" || normalized === "--max-results" || normalized === "--max-vagas") {
                maxResults = parseArgNumber(parts[index + 1])
                index++
                continue
            }

            if (normalized === "--max-applicants" || normalized === "--applicants" || normalized === "--max-candidaturas" || normalized === "--candidaturas") {
                maxApplicants = parseArgNumber(parts[index + 1])
                skipApplicantsPrompt = true
                index++
                continue
            }

            const inlineLocation = parseInline(raw, normalized, ["loc", "location", "local", "localizacao"])
            if (inlineLocation !== undefined) {
                const parsedLocation = parseLocationAnswer(inlineLocation)
                if (parsedLocation) {
                    location = parsedLocation
                    useGlobalGeo = false
                } else if (isNegative(inlineLocation)) {
                    location = undefined
                    useGlobalGeo = true
                    skipLocationPrompt = true
                }
                continue
            }

            const inlinePages = parseInline(raw, normalized, ["pages", "page", "paginas", "pagina"])
            if (inlinePages) {
                maxPages = parseArgNumber(inlinePages)
                skipMaxPagesPrompt = true
                continue
            }

            const inlineMax = parseInline(raw, normalized, ["max", "limit", "results", "vagas"])
            if (inlineMax) {
                maxResults = parseArgNumber(inlineMax)
                continue
            }

            const inlineApplicants = parseInline(raw, normalized, ["applicants", "candidaturas", "candidatos"])
            if (inlineApplicants) {
                maxApplicants = parseArgNumber(inlineApplicants)
                skipApplicantsPrompt = true
                continue
            }

            const inlinePromoted = parseInline(raw, normalized, ["promoted", "promovidas"])
            if (inlinePromoted) {
                if (isNegative(inlinePromoted)) {
                    onlyNonPromoted = true
                } else if (isAffirmative(inlinePromoted)) {
                    onlyNonPromoted = false
                }
                continue
            }

            const inlineEasyApply = parseInline(raw, normalized, ["easy", "easyapply", "easy-apply"])
            if (inlineEasyApply) {
                if (isNegative(inlineEasyApply)) {
                    easyApplyOnly = false
                } else if (isAffirmative(inlineEasyApply)) {
                    easyApplyOnly = true
                }
                continue
            }

            const inlineAuto = parseInline(raw, normalized, ["auto", "automatico"])
            if (inlineAuto) {
                if (isNegative(inlineAuto)) {
                    autoApply = false
                } else if (isAffirmative(inlineAuto)) {
                    autoApply = true
                }
                continue
            }

            const inlineStart = parseInline(raw, normalized, ["start", "inicio", "skip"])
            if (inlineStart) {
                const val = parseArgNumber(inlineStart)
                if (val !== undefined) startOffset = val
                continue
            }

            if (!maxResults && /^\d+$/.test(raw)) {
                maxResults = Number(raw)
                continue
            }

            leftover.push(raw)
        }

        const tag = leftover.join(" ").trim() || undefined
        return {
            tag,
            location,
            maxPages,
            maxResults,
            onlyNonPromoted,
            maxApplicants,
            easyApplyOnly,
            useGlobalGeo,
            skipLocationPrompt,
            skipMaxPagesPrompt,
            skipApplicantsPrompt,
            autoApply,
            workplaceTypes,
            startOffset
        }
    }

    private _wait(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }
}
