import type { EasyApplyStepValues } from "../easy-apply/easy-apply-flow";
import type { EasyApplyJobResult, SearchJobTagOptions } from "../scrap/scraps";
import type { UserProfile } from "../../../shared/user-profile";

export type UpvoteOptions = {
    maxLikes?: number
    tag?: string
}

export type SearchFilters = {
    tag: string
    maxResults?: number
    location?: string
    geoId?: string
    maxPages?: number
    onlyNonPromoted: boolean
    maxApplicants?: number
    easyApplyOnly: boolean
}

export type LinkedinCommandActions = {
    easyApply: (jobUrl?: string) => Promise<EasyApplyStepValues[]>
    searchJobTag: (searchJobTag: string, options?: SearchJobTagOptions) => Promise<EasyApplyJobResult[]>
    sendConnection: (profileUrl: string, inMailOptions?: { message: string }) => Promise<void>
    upvoteOnPosts: (options?: UpvoteOptions) => Promise<string[]>
    reviewOwnProfile?: () => Promise<UserProfile>
}
