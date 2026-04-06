import type { EasyApplyStepValues } from "../../../shared/interface/easy-apply/step-values.types";
import type { EasyApplyJobResult, SearchJobTagOptions } from "../../../shared/interface/scrap/jobs.types";

export type SearchFilters = {
    tag: string
    maxResults?: number
    location?: string
    geoId?: string
    maxPages?: number
    onlyNonPromoted: boolean
    maxApplicants?: number
    easyApplyOnly: boolean
    workplaceTypes?: string[]
    startOffset?: number
}

export type LinkedinCommandActions = {
    easyApply: (jobUrl?: string) => Promise<EasyApplyStepValues[]>
    searchJobTag: (searchJobTag: string, options?: SearchJobTagOptions) => Promise<EasyApplyJobResult[]>
}
