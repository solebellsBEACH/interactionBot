import { env } from "../../../shared/env";
import { LINKEDIN_ACTION_LABELS, LINKEDIN_PLACEHOLDERS } from "../../../shared/constants/linkedin";
import { HandleActions } from "../../../shared/interfaces/element-handle.types";
import { ElementHandle } from "../../../shared/utils/element-handle";
import { LinkedinCoreFeatures } from "../../linkedin-core";

export class LinkedinConnectFlow {
    private readonly _elementHandle: ElementHandle
    private readonly _navigator: LinkedinCoreFeatures

    constructor(elementHandle: ElementHandle, navigator: LinkedinCoreFeatures) {
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

        await this._elementHandle.handleByRole(HandleActions.click, 'button', {
            name: LINKEDIN_ACTION_LABELS.connect
        })
        if (inMailOptions) {
            await this._sendInMail(inMailOptions.message)
        } else {
            await this._elementHandle.handleByRole(HandleActions.click, 'button', {
                name: LINKEDIN_ACTION_LABELS.sendWithoutNote
            })
        }
    }

    private async _sendInMail(message: string) {
        await this._elementHandle.handleByRole(HandleActions.click, 'button', {
            name: LINKEDIN_ACTION_LABELS.addNote
        })

        await this._elementHandle.handleByPlaceholder(HandleActions.fill, LINKEDIN_PLACEHOLDERS.noteMessage, message)

        await this._elementHandle.handleByRole(HandleActions.click, 'button', {
            name: LINKEDIN_ACTION_LABELS.send
        })
    }
}
