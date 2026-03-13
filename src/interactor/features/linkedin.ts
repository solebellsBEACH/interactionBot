import { Page } from "playwright";

import type { AdminPromptBroker } from "../../admin/prompt-broker";
import { LinkedinCoreFeatures } from "./linkedin-core";
import { ElementHandle } from "../shared/utils/element-handle";
import { DiscordClient } from "../shared/discord/discord-client";
import { env } from "../shared/env";

import { EasyApplyFlow, EasyApplyStepValues } from "./actions/easy-apply/easy-apply-flow";
import { EasyApplyJobResult, ScrapFeatures, SearchJobTagOptions } from "./actions/scrap/scraps";
import { LinkedinJobsFlow } from "./actions/scrap/jobs-flow";
import { LinkedinConnectFlow } from "./actions/connect/connect-flow";
import { LinkedinProfileReviewFlow } from "./actions/profile/profile-review-flow";
import { LinkedinUpvotePostsFlow } from "./actions/upvote-posts/upvote-posts-flow";
import { LinkedinDiscordCommands } from "./actions/commands/discord-commands";
import { resetUserProfile, UserProfile } from "../shared/user-profile";
import { clearApplications } from "../../api/controllers/applications";
import { clearEasyApplyResponses } from "../../api/controllers/easy-apply-responses";
import { clearFieldAnswers } from "../../api/controllers/field-answers";
import { clearGptInteractions } from "../../api/controllers/gpt-interactions";

type UpvoteOptions = {
    maxLikes?: number
    tag?: string
}

type LinkedinFeaturesOptions = {
    discord?: DiscordClient
    adminPromptBroker?: AdminPromptBroker
}

export class LinkedinFeatures {

    private _elementHandle: ElementHandle
    private _linkedinCoreFeatures: LinkedinCoreFeatures
    private _easyApplyFlow: EasyApplyFlow
    private _scrapFeatures: ScrapFeatures
    private _jobsFlow: LinkedinJobsFlow
    private _connectFlow: LinkedinConnectFlow
    private _profileReviewFlow: LinkedinProfileReviewFlow
    private _upvoteFlow: LinkedinUpvotePostsFlow
    private _discord?: DiscordClient
    private _commands: LinkedinDiscordCommands

    constructor(page: Page, options?: LinkedinFeaturesOptions) {
        const discord = options?.discord
        this._elementHandle = new ElementHandle(page)
        this._linkedinCoreFeatures = new LinkedinCoreFeatures(page)
        this._scrapFeatures = new ScrapFeatures(page, this._linkedinCoreFeatures)
        this._easyApplyFlow = new EasyApplyFlow(
            page,
            this._elementHandle,
            this._linkedinCoreFeatures,
            discord,
            options?.adminPromptBroker
        )
        this._jobsFlow = new LinkedinJobsFlow(this._scrapFeatures, discord)
        this._connectFlow = new LinkedinConnectFlow(this._elementHandle, this._linkedinCoreFeatures)
        this._profileReviewFlow = new LinkedinProfileReviewFlow(page, this._linkedinCoreFeatures)
        this._upvoteFlow = new LinkedinUpvotePostsFlow(page, this._linkedinCoreFeatures)
        this._discord = discord
        this._commands = new LinkedinDiscordCommands({
            easyApply: this.easyApply.bind(this),
            searchJobTag: this.searchJobTag.bind(this),
            sendConnection: this.sendConnection.bind(this),
            upvoteOnPosts: this.upvoteOnPosts.bind(this)
        })
    }

    registerDiscordCommands(discord?: DiscordClient) {
        const client = discord || this._discord
        if (!client) return
        this._commands.register(client)
    }

    async catchJobs(searchJobTag?: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
        return this._jobsFlow.catchJobs(searchJobTag, options)
    }

    async sendConnection(profileURL: string, inMailOptions?: { message: string }) {
        return this._connectFlow.sendConnection(profileURL, inMailOptions)
    }

    async reviewOwnProfile(): Promise<UserProfile> {
        return this._profileReviewFlow.reviewOwnProfile()
    }

    async resetSession() {
        await this._linkedinCoreFeatures.logoutAndClearSession()

        const [applications, easyApplyResponses, fieldAnswers, gptInteractions] = await Promise.all([
            clearApplications(),
            clearEasyApplyResponses(),
            clearFieldAnswers(),
            clearGptInteractions()
        ])

        resetUserProfile()

        return {
            cleared: {
                applications,
                easyApplyResponses,
                fieldAnswers,
                gptInteractions
            }
        }
    }

    async easyApply(jobURL?: string): Promise<EasyApplyStepValues[]> {
        return this._easyApplyFlow.execute(jobURL || env.linkedinURLs.jobURL)
    }

    async searchJobTag(searchJobTag: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
        return this._scrapFeatures.searchJobTag(searchJobTag, options)
    }

    async upvoteOnPosts(options?: UpvoteOptions): Promise<string[]> {
        return this._upvoteFlow.upvoteOnPosts(options)
    }

}
