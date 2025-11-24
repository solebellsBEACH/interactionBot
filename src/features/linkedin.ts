import { Locator, Page } from "playwright";
import { ElementHandle } from "../shared/utils/element-handle";
import { HandleActions } from "../shared/interfaces/element-handle";
import { env } from "../shared/env";
import { LinkedinCoreFeatures } from "./linkedin-core";

export class LinkedinFeatures {

    private _elementHandle: ElementHandle
    private _linkedinCoreFeatures: LinkedinCoreFeatures

    constructor(page:Page){
        this._elementHandle = new ElementHandle(page),
        this._linkedinCoreFeatures= new LinkedinCoreFeatures(page)
    }

    async sendConnection(profileURL:string, inMailOptions?:{message:string}){

        this._linkedinCoreFeatures.goToLinkedinURL(profileURL)

        await this._elementHandle.handleByRole(HandleActions.click,'button', {
            name: env.linkedinURLs.message
        })

        if(inMailOptions){
            this._sendInMail(inMailOptions.message)
        }else{
            await this._elementHandle.handleByRole(HandleActions.click,'button', {
                name: 'Enviar sem nota'
            })
        }
        
    }

    async easyApply(){
        this._linkedinCoreFeatures.goToLinkedinURL(env.linkedinURLs.jobURL)
        
        await this._elementHandle.handleByRole(HandleActions.click,'button', {
            name: 'Candidatura simplificada à vaga de'
        })
        await this._findNextStepButton('Avançar para próxima etapa')
        // this._findNextStepButton('Revise sua candidatura')
    }

    private async _findNextStepButton(name:string){
        
        const nextStepButton = await this._elementHandle.handleByRole(HandleActions.get,'button', {name})
        console.log(await this._elementHandle.handleForm())
        if(!!nextStepButton ){

            await nextStepButton.click()
            this._findNextStepButton(name)
        }
    }

    private async _sendInMail(message:string){
        await this._elementHandle.handleByRole(HandleActions.click,'button', {
                name: 'Adicionar nota'
            })
            
            this._elementHandle.handleByPlaceholder(HandleActions.fill,'Ex.: Nos conhecemos em…', message)
            
            await this._elementHandle.handleByRole(HandleActions.click,'button', {
                name: 'Enviar'
            })
    }
    
}