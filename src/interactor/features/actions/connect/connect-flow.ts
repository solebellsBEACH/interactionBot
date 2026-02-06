import { Page } from "playwright";
import { LINKEDIN_ACTION_LABELS } from "../../../shared/constants/linkedin";
import { ElementHandle } from "../../../shared/utils/element-handle";
import { LinkedinCoreFeatures } from "../../linkedin-core";

export class LinkedinConnectFlow {
    private readonly _page: Page
    private readonly _elementHandle: ElementHandle
    private readonly _navigator: LinkedinCoreFeatures

    constructor(page: Page, elementHandle: ElementHandle, navigator: LinkedinCoreFeatures) {
        this._page = page
        this._elementHandle = elementHandle
        this._navigator = navigator
    }

    async sendConnection(profileURL: string, inMailOptions?: { message: string }) {
        await this._handleConnection(profileURL)
    }

    private async _searchConnections(){

    }

    private async  _handleConnection(profileURL:string, inMailOptions?: { message: string }){
        await this._navigator.goToLinkedinURL(profileURL)

        const connected = await this._clickConnectButton()
        if (!connected) {
            throw new Error('connect-button-not-found')
        }
        if (inMailOptions) {
            await this._sendInMail(inMailOptions.message)
            return
        }
        await this._sendWithoutNote()
    }

    private async _sendInMail(message: string) {
        const modal = await this._waitForInviteModal()
        const addNote = modal.getByRole('button', { name: LINKEDIN_ACTION_LABELS.addNote }).first()
        if (await addNote.count()) {
            await addNote.click()
        }

        const textarea = modal.locator('textarea').first()
        await textarea.waitFor({ state: 'visible', timeout: 5_000 })
        await textarea.fill(message)

        const sendButton = modal.getByRole('button', { name: LINKEDIN_ACTION_LABELS.send }).first()
        await sendButton.waitFor({ state: 'visible', timeout: 5_000 })
        await sendButton.click()
    }

    private async _sendWithoutNote() {
        const modal = await this._waitForInviteModal()
        const sendButton = modal.getByRole('button', { name: LINKEDIN_ACTION_LABELS.sendWithoutNote }).first()
        await sendButton.waitFor({ state: 'visible', timeout: 5_000 })
        await sendButton.click()
    }

    private async _clickConnectButton() {
        const scope = this._page.locator('main')
        const topCard = scope
            .locator(
                'section.pv-top-card, section.pv-top-card-v2-ctas, div.pv-top-card, div.pv-top-card-v2-ctas, section.artdeco-card'
            )
            .first()

        const connect = await this._findConnectButton(topCard)
        if (connect) {
            await connect.click()
            return true
        }

        const more = await this._findMoreButton(topCard)
        if (more) {
            await more.click()
            const menu = this._page.locator('div[role="menu"]').first()
            const menuConnect = menu.getByRole('menuitem', { name: LINKEDIN_ACTION_LABELS.connect }).first()
            if (await menuConnect.count()) {
                await menuConnect.click()
                return true
            }
        }

        const fallback = await this._findConnectButton(scope)
        if (fallback) {
            await fallback.click()
            return true
        }

        return false
    }

    private async _findConnectButton(scope: import("playwright").Locator) {
        const direct = scope.getByRole('button', { name: LINKEDIN_ACTION_LABELS.connect }).first()
        if (await direct.count()) return direct

        const inviteButton = scope.locator('button[aria-label*="connect" i]').first()
        if (await inviteButton.count()) return inviteButton

        return null
    }

    private async _findMoreButton(scope: import("playwright").Locator) {
        const more = scope.getByRole('button', { name: LINKEDIN_ACTION_LABELS.more }).first()
        if (await more.count()) return more
        return null
    }

    private async _waitForInviteModal() {
        const modal = this._page.locator('div[role="dialog"]').first()
        await modal.waitFor({ state: 'visible', timeout: 8_000 })
        return modal
    }
}
