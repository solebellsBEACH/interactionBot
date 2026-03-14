import { Page } from "playwright";

import type { AdminPromptBroker } from "../../admin/prompt-broker";
import { clearApplications } from "../../api/controllers/applications";
import { clearEasyApplyResponses } from "../../api/controllers/easy-apply-responses";
import { clearFieldAnswers } from "../../api/controllers/field-answers";
import { clearGptInteractions } from "../../api/controllers/gpt-interactions";
import type { DiscordClient } from "../shared/discord/discord-client";
import type { EasyApplyStepValues } from "../shared/interface/easy-apply/step-values.types";
import type {
    AppliedJobsScanResult,
    EasyApplyJobResult,
    ScanAppliedJobsOptions,
    SearchJobTagOptions
} from "../shared/interface/scrap/jobs.types";
import type { VisitConnectionsOptions } from "../shared/interface/scrap/network.types";
import type { UserProfile } from "../shared/interface/user/user-profile.types";
import { ElementHandle } from "../shared/utils/element-handle";
import { env } from "../shared/env";
import { resetUserProfile } from "../shared/user-profile";
import { LinkedinDiscordCommands } from "./actions/commands/discord-commands";
import { LinkedinConnectFlow } from "./actions/connect/connect-flow";
import { DashboardFlow } from "./actions/dashboard/dashboard-flow";
import { EasyApplyFlow } from "./actions/easy-apply/easy-apply-flow";
import { LinkedinJobsFlow } from "./actions/jobs";
import { LinkedinProfileReviewFlow } from "./actions/profile/profile-review-flow";
import { LinkedinUpvotePostsFlow } from "./actions/upvote-posts/upvote-posts-flow";
import { LinkedinCoreFeatures } from "./linkedin-core";
import { MyNetworkScrap } from "../shared/scrap/my-network";

type UpvoteOptions = {
    maxLikes?: number
    tag?: string
}

export class LinkedinFeatures {
    private readonly _linkedinCoreFeatures: LinkedinCoreFeatures
    private readonly _easyApplyFlow: EasyApplyFlow
    private readonly _jobFlow: LinkedinJobsFlow
    private readonly _connectFlow: LinkedinConnectFlow
    private readonly _profileReviewFlow: LinkedinProfileReviewFlow
    private readonly _upvoteFlow: LinkedinUpvotePostsFlow
    private readonly _dashboardFlow: DashboardFlow
    private readonly _networkScrap: MyNetworkScrap

    constructor(page: Page, options?: { adminPromptBroker?: AdminPromptBroker; discord?: DiscordClient }) {
        const elementHandle = new ElementHandle(page)

        this._linkedinCoreFeatures = new LinkedinCoreFeatures(page)
        this._jobFlow = new LinkedinJobsFlow(page, this._linkedinCoreFeatures)
        this._easyApplyFlow = new EasyApplyFlow(
            page,
            elementHandle,
            this._linkedinCoreFeatures,
            options?.discord,
            options?.adminPromptBroker
        )
        this._connectFlow = new LinkedinConnectFlow(page, elementHandle, this._linkedinCoreFeatures)
        this._profileReviewFlow = new LinkedinProfileReviewFlow(page, this._linkedinCoreFeatures)
        this._upvoteFlow = new LinkedinUpvotePostsFlow(page, this._linkedinCoreFeatures)
        this._dashboardFlow = new DashboardFlow(page, this._linkedinCoreFeatures)
        this._networkScrap = new MyNetworkScrap(page, this._linkedinCoreFeatures)
    }

    async catchJobs(searchJobTag?: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
        return this._jobFlow.catchJobs(searchJobTag, options)
    }

    async sendConnection(profileURL: string, inMailOptions?: { message: string }) {
        return this._connectFlow.sendConnection(profileURL, inMailOptions)
    }

    async connectByKeyword(keyword: string, options?: { maxResults?: number; maxPages?: number }) {
        return this._connectFlow.searchConnectionsByKeyword(keyword, options)
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

    registerDiscordCommands(discord: DiscordClient) {
        const commands = new LinkedinDiscordCommands({
            easyApply: this.easyApply.bind(this),
            searchJobTag: this.searchJobTag.bind(this),
            sendConnection: this.sendConnection.bind(this),
            upvoteOnPosts: this.upvoteOnPosts.bind(this),
            reviewOwnProfile: this.reviewOwnProfile.bind(this),
            resetSession: this.resetSession.bind(this)
        })

        commands.register(discord)
    }

    async easyApply(jobURL?: string): Promise<EasyApplyStepValues[]> {
        return this._easyApplyFlow.execute(jobURL || env.linkedinURLs.jobURL)
    }

    async searchJobTag(searchJobTag: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
        return this._jobFlow.searchJobTag(searchJobTag, options)
    }

    async scanAppliedJobs(options?: ScanAppliedJobsOptions): Promise<AppliedJobsScanResult> {
        return this._jobFlow.scanAppliedJobs(options)
    }

    async upvoteOnPosts(options?: UpvoteOptions): Promise<string[]> {
        return this._upvoteFlow.upvoteOnPosts(options)
    }

    async dashboard(profileUrl?: string) {
        return this._dashboardFlow.main(profileUrl)
    }

    async dashboardProfile(profileUrl?: string) {
        return this._dashboardFlow.profileOnly(profileUrl)
    }

    async dashboardNetwork() {
        return this._dashboardFlow.networkOnly()
    }

    async visitConnections(options?: VisitConnectionsOptions) {
        return this._networkScrap.visitConnectionProfiles(options)
    }

    async accountSummary() {
        return this._linkedinCoreFeatures.getOwnProfileSummary()
    }

    async ensureSession() {
        return this._linkedinCoreFeatures.auth()
    }

    async login() {
        return this._linkedinCoreFeatures.login()
    }

    async relogin() {
        return this._linkedinCoreFeatures.relogin()
    }

    async logout() {
        return this._linkedinCoreFeatures.logout()
    }
}
