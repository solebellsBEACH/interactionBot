import { env } from "../../../shared/env";
import { DiscordClient } from "../../../shared/discord/discord-client";
import { EasyApplyJobResult, ScrapFeatures, SearchJobTagOptions } from "./scraps";

export class LinkedinJobsFlow {
    private readonly _scrapFeatures: ScrapFeatures
    private readonly _discord?: DiscordClient

    constructor(scrapFeatures: ScrapFeatures, discord?: DiscordClient) {
        this._scrapFeatures = scrapFeatures
        this._discord = discord
    }

    async catchJobs(searchJobTag?: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
        const tag = (searchJobTag || env.linkedinURLs.searchJobTag || '').trim()
        if (!tag) return []

        const defaultLimit = env.linkedinURLs.defaultJobsApplyLength || 0
        const requestedLimit = options?.maxResults
        const effectiveMaxResults = requestedLimit !== undefined
            ? requestedLimit
            : (defaultLimit > 0 ? defaultLimit : undefined)

        const searchOptions: SearchJobTagOptions = {
            ...options,
            ...(effectiveMaxResults && effectiveMaxResults > 0 ? { maxResults: effectiveMaxResults } : {})
        }

        const results = await this._scrapFeatures.searchJobTag(tag, searchOptions)

        if (this._discord) {
            await this._discord.log(`Easy Apply results for "${tag}": ${results.length}`)
            if (results.length > 0) {
                const lines = results.map((job, idx) =>
                    `${idx + 1}. ${job.title} | ${job.company} | ${job.location} | ${job.url}`
                )
                await this._discord.log(lines.join('\n'))
            }
        }

        return results
    }
}
