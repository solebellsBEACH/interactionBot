import { Page } from "playwright";

import { LinkedinCoreFeatures } from "./linkedin-core";
import { ElementHandle } from "../shared/utils/element-handle";
import { env } from "../shared/env";

import { EasyApplyFlow } from "./actions/easy-apply/easy-apply-flow";
import type { EasyApplyStepValues } from "../shared/interface/easy-apply/step-values.types";

import { LinkedinConnectFlow } from "./actions/connect/connect-flow";
import { LinkedinUpvotePostsFlow } from "./actions/upvote-posts/upvote-posts-flow";
import { LinkedinJobsFlow } from "./actions/jobs";
import type { EasyApplyJobResult, SearchJobTagOptions } from "../shared/interface/scrap/jobs.types";

import { DashboardFlow } from "./actions/dashboard/dashboard-flow";
import { MyNetworkScrap } from "../shared/scrap/my-network";
import type { VisitConnectionsOptions } from "../shared/interface/scrap/network.types";


type UpvoteOptions = {
    maxLikes?: number
    tag?: string
}

export class LinkedinFeatures {

    private _elementHandle: ElementHandle
    private _linkedinCoreFeatures: LinkedinCoreFeatures
    private _easyApplyFlow: EasyApplyFlow
    private _jobFlow: LinkedinJobsFlow
    private _connectFlow: LinkedinConnectFlow
    private _upvoteFlow: LinkedinUpvotePostsFlow
    private _dashboardFlow: DashboardFlow
    private _networkScrap: MyNetworkScrap

    constructor(page: Page) {
        this._elementHandle = new ElementHandle(page)
        this._linkedinCoreFeatures = new LinkedinCoreFeatures(page)
        this._jobFlow = new LinkedinJobsFlow(page, this._linkedinCoreFeatures)
        this._easyApplyFlow = new EasyApplyFlow(
            page,
            this._elementHandle,
            this._linkedinCoreFeatures
        )
        this._connectFlow = new LinkedinConnectFlow(page, this._elementHandle, this._linkedinCoreFeatures)
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

    async accountSummary() {
        return this._linkedinCoreFeatures.getOwnProfileSummary()
    }

    async easyApply(jobURL?: string): Promise<EasyApplyStepValues[]> {
        return this._easyApplyFlow.execute(jobURL || env.linkedinURLs.jobURL)
    }

    async searchJobTag(searchJobTag: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
        return this._jobFlow.searchJobTag(searchJobTag, options)
    }

    async upvoteOnPosts(options?: UpvoteOptions): Promise<string[]> {
        return this._upvoteFlow.upvoteOnPosts(options)
    }


    async dashboard(profileUrl?: string) {
        return await this._dashboardFlow.main(profileUrl)
    }

    async dashboardProfile(profileUrl?: string) {
        return await this._dashboardFlow.profileOnly(profileUrl)
    }

    async dashboardNetwork() {
        return await this._dashboardFlow.networkOnly()
    }

    async visitConnections(options?: VisitConnectionsOptions) {
        return await this._networkScrap.visitConnectionProfiles(options)
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
