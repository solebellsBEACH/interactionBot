import { Page } from "playwright";

import { LinkedinJobsScrap } from "../../../shared/scrap/jobs";
import type {
    EasyApplyJobResult,
    SearchJobTagOptions
} from "../../../shared/interface/scrap/jobs.types";
import { LinkedinCoreFeatures } from "../../linkedin-core";
import { env } from "../../../shared/env";
import { logger } from "../../../shared/services/logger";

export class LinkedinJobsFlow {

        private readonly _page: Page
        private readonly _navigator: LinkedinCoreFeatures
        private readonly _linkedinJobsScrap: LinkedinJobsScrap

    constructor(page: Page, navigator: LinkedinCoreFeatures) {
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

        return this.searchJobTag(tag, searchOptions)
    }

    async searchJobTag(searchJobTag: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
            const tag = searchJobTag.trim()
            if (!tag) return []

            const maxPages = options?.maxPages ?? (options?.maxApplicants !== undefined ? 30 : 10)
            const maxResults = options?.maxResults ?? Number.POSITIVE_INFINITY
            const easyApplyOnly = options?.easyApplyOnly !== false
            const onlyNonPromoted = options?.onlyNonPromoted === true
            const maxApplicants = options?.maxApplicants
            const includeUnknownApplicants = maxApplicants === undefined
                ? (options?.includeUnknownApplicants ?? false)
                : false
            const includeDetails = options?.includeDetails ?? true
            const postedWithinDays = options?.postedWithinDays
            const workplaceTypes = options?.workplaceTypes
            const results = new Map<string, EasyApplyJobResult>()

            for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
                if (this._page.isClosed()) break
                logger.info(`Buscando jobs: pagina ${pageIndex + 1}/${maxPages}`)
                const searchUrl = this._linkedinJobsScrap.buildSearchJobUrl(
                    tag,
                    options?.location,
                    pageIndex * 25,
                    options?.geoId,
                    easyApplyOnly,
                    postedWithinDays,
                    workplaceTypes
                )
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
                let aboveMax = 0
                let unknownApplicants = 0
                let notEasyApply = 0
                let promotedBlocked = 0
                let outOfDate = 0
                for (const job of this._linkedinJobsScrap.filterResults(pageResults, {
                    onlyNonPromoted,
                    maxApplicants,
                    easyApplyOnly,
                    includeUnknownApplicants,
                    postedWithinDays
                })) {
                    if (results.size >= maxResults) break
                    results.set(job.url, job)
                }
                if (maxApplicants !== undefined || postedWithinDays !== undefined) {
                    for (const job of pageResults) {
                        if (onlyNonPromoted && job.promoted) {
                            promotedBlocked++
                            continue
                        }
                        if (easyApplyOnly && !job.easyApply) {
                            notEasyApply++
                            continue
                        }
                        if (maxApplicants !== undefined) {
                            if (job.applicants === null) {
                                unknownApplicants++
                                continue
                            }
                            if (job.applicants > maxApplicants) {
                                aboveMax++
                                continue
                            }
                        }
                        if (postedWithinDays !== undefined) {
                            if (!this._linkedinJobsScrap.isPostedWithinDays(job.postedAt, postedWithinDays)) {
                                outOfDate++
                            }
                        }
                    }
                    const kept = results.size - beforeCount
                    logger.info(
                        `[bot] Filtro candidaturas: pagina ${pageIndex + 1} | total=${pageResults.length} | mantidas=${kept} | acimaMax=${aboveMax} | semNumero=${unknownApplicants} | naoEasy=${notEasyApply} | promovidas=${promotedBlocked} | foraData=${outOfDate}`
                    )
                }

                if (results.size >= maxResults) break
                if (pageResults.length === 0) break
                if (results.size === beforeCount && maxApplicants === undefined) break
            }

            return Array.from(results.values())
        }
}
