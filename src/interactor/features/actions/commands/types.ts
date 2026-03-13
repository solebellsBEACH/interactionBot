import type { EasyApplyStepValues } from "../../../shared/interface/easy-apply/step-values.types";
import type { EasyApplyJobResult, SearchJobTagOptions } from "../../../shared/interface/scrap/jobs.types";
import type { UserProfile } from "../../../shared/interface/user/user-profile.types";

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
    resetSession?: () => Promise<{
        cleared: {
            applications: number
            easyApplyResponses: number
            fieldAnswers: number
            gptInteractions: number
        }
    }>
}
