
import {  Page } from "playwright";

import { EasyApplyJobResult, LinkedinJobsScrap, SearchJobTagOptions } from "../scrap/jobs";
import { LinkedinCoreFeatures } from "../../linkedin-core";
import { DiscordClient } from "../../../shared/discord/discord-client";
import { env } from "../../../shared/env";

export class LinkedinJobsFlow {

    private readonly _discord?: DiscordClient
        private readonly _page: Page
        private readonly _navigator: LinkedinCoreFeatures
        private readonly _linkedinJobsScrap :LinkedinJobsScrap

    constructor( page: Page, navigator: LinkedinCoreFeatures, discord?: DiscordClient, ) {
            this._discord = discord
            this._page = page
            this._navigator = navigator
            this._linkedinJobsScrap = new LinkedinJobsScrap(page)
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

        const results = await this.searchJobTag(tag, searchOptions)

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


    
    async searchJobTag(searchJobTag: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
            const tag = searchJobTag.trim()
            if (!tag) return []
    
            const maxPages = options?.maxPages ?? 10
            const maxResults = options?.maxResults ?? Number.POSITIVE_INFINITY
            const easyApplyOnly = options?.easyApplyOnly !== false
            const onlyNonPromoted = options?.onlyNonPromoted === true
            const maxApplicants = options?.maxApplicants
            const includeDetails = options?.includeDetails ?? maxApplicants !== undefined
            const results = new Map<string, EasyApplyJobResult>()
    
            for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
                if (this._page.isClosed()) break
                console.log(`Buscando jobs: pagina ${pageIndex + 1}/${maxPages}`)
                const searchUrl = this._linkedinJobsScrap.buildSearchJobUrl(tag, options?.location, pageIndex * 25, options?.geoId, easyApplyOnly)
                await this._navigator.goToLinkedinURL(searchUrl)
    
                const ready = await this._linkedinJobsScrap.waitForJobResults()
                let pageResults: EasyApplyJobResult[] = []
                if (!ready) {
                    pageResults = await this._linkedinJobsScrap.collectEasyApplyFromPage(includeDetails, easyApplyOnly)
                    if (pageResults.length === 0) break
                } else {
                    await this._linkedinJobsScrap.scrollResultsList()
                    pageResults = await this._linkedinJobsScrap.collectEasyApplyFromPage(includeDetails, easyApplyOnly)
                }
    
                const beforeCount = results.size
                for (const job of this._linkedinJobsScrap.filterResults(pageResults, {
                    onlyNonPromoted,
                    maxApplicants,
                    easyApplyOnly
                })) {
                    if (results.size >= maxResults) break
                    results.set(job.url, job)
                }
    
                if (results.size >= maxResults) break
                if (pageResults.length === 0) break
                if (results.size === beforeCount) break
            }
    
            return Array.from(results.values())
        }
    
}
