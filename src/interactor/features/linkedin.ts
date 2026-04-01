import { Page } from "playwright";

import type { AdminPromptBroker } from "../../admin/prompt-broker";
import type { DiscordClient } from "../shared/discord/discord-client";
import type { EasyApplyStepValues } from "../shared/interface/easy-apply/step-values.types";
import type { EasyApplyJobResult, SearchJobTagOptions } from "../shared/interface/scrap/jobs.types";
import { ElementHandle } from "../shared/utils/element-handle";
import { env } from "../shared/env";
import { LinkedinDiscordCommands } from "./actions/commands/discord-commands";
import { EasyApplyFlow } from "./actions/easy-apply/easy-apply-flow";
import { LinkedinJobsFlow } from "./actions/jobs";
import { LinkedinCoreFeatures } from "./linkedin-core";

export class LinkedinFeatures {
    private readonly _linkedinCoreFeatures: LinkedinCoreFeatures
    private readonly _easyApplyFlow: EasyApplyFlow
    private readonly _jobFlow: LinkedinJobsFlow

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
    }

    async catchJobs(searchJobTag?: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
        return this._jobFlow.catchJobs(searchJobTag, options)
    }

    async searchJobTag(searchJobTag: string, options?: SearchJobTagOptions): Promise<EasyApplyJobResult[]> {
        return this._jobFlow.searchJobTag(searchJobTag, options)
    }

    async easyApply(jobURL?: string): Promise<EasyApplyStepValues[]> {
        return this._easyApplyFlow.execute(jobURL || env.linkedinURLs.jobURL)
    }

    registerDiscordCommands(discord: DiscordClient) {
        const commands = new LinkedinDiscordCommands({
            easyApply: this.easyApply.bind(this),
            searchJobTag: this.searchJobTag.bind(this)
        })
        commands.register(discord)
    }

    async ensureSession() {
        return this._linkedinCoreFeatures.auth()
    }

    async login() {
        return this._linkedinCoreFeatures.login()
    }

    async logout() {
        return this._linkedinCoreFeatures.logout()
    }
}
