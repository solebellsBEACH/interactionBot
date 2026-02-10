import { Page } from "playwright";

import { LinkedinCoreFeatures } from "./linkedin-core";
import { ElementHandle } from "../shared/utils/element-handle";
import { DiscordClient } from "../shared/discord/discord-client";
import { env } from "../shared/env";

import { EasyApplyFlow, EasyApplyStepValues } from "./actions/easy-apply/easy-apply-flow";

import { LinkedinConnectFlow } from "./actions/connect/connect-flow";
import { LinkedinUpvotePostsFlow } from "./actions/upvote-posts/upvote-posts-flow";
import { LinkedinDiscordCommands } from "./actions/commands/discord-commands";
import { LinkedinJobsFlow } from "./actions/jobs";
import { EasyApplyJobResult, SearchJobTagOptions } from "./actions/scrap/jobs";
import { ProfileFlow } from "./actions/profile/profile-flow";
import { DashboardFlow } from "./actions/dashboard/dashboard-flow";
import { MyNetworkScrap, VisitConnectionsOptions } from "./actions/scrap/my-network";


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
    private _discord?: DiscordClient
    private _commands: LinkedinDiscordCommands
    private _profileFlow: ProfileFlow
    private _dashboardFlow: DashboardFlow
    private _networkScrap: MyNetworkScrap

    constructor(page: Page, discord?: DiscordClient) {
        this._elementHandle = new ElementHandle(page)
        this._linkedinCoreFeatures = new LinkedinCoreFeatures(page)
        this._jobFlow = new LinkedinJobsFlow(page, this._linkedinCoreFeatures, discord)
        this._easyApplyFlow = new EasyApplyFlow(
            page,
            this._elementHandle,
            this._linkedinCoreFeatures,
            discord
        )
        this._connectFlow = new LinkedinConnectFlow(page, this._elementHandle, this._linkedinCoreFeatures)
        this._upvoteFlow = new LinkedinUpvotePostsFlow(page, this._linkedinCoreFeatures)
        this._discord = discord

        this._profileFlow= new  ProfileFlow(page)
        this._dashboardFlow = new DashboardFlow(page, this._linkedinCoreFeatures)
        this._networkScrap = new MyNetworkScrap(page, this._linkedinCoreFeatures)
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
        return this._jobFlow.catchJobs(searchJobTag, options)
    }

    async sendConnection(profileURL: string, inMailOptions?: { message: string }) {
        return this._connectFlow.sendConnection(profileURL, inMailOptions)
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

    async profile(profileUrl?: string){
        return await this._profileFlow.main(profileUrl)
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

}
