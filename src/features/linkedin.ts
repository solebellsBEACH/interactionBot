import { Page } from "playwright";
import { ElementHandle } from "../shared/utils/element-handle";
import { HandleActions } from "../shared/interfaces/element-handle";
import { env } from "../shared/env";

export class LinkedinFeatures {

    private _elementHandle: ElementHandle

    constructor(page:Page){
        this._elementHandle = new ElementHandle(page)
    }

    async sendConnection(inMailOptions?:{message:string}){

        await this._elementHandle.handleByRole(HandleActions.click,'button', {
            name: env.linkedinURLs.message
        })

        if(inMailOptions){
            await this._elementHandle.handleByRole(HandleActions.click,'button', {
                name: 'Adicionar nota'
            })
            
            this._elementHandle.handleByPlaceholder(HandleActions.fill,'Ex.: Nos conhecemos em…', inMailOptions.message)
            
            await this._elementHandle.handleByRole(HandleActions.click,'button', {
                name: 'Enviar'
            })
        }else{

            await this._elementHandle.handleByRole(HandleActions.click,'button', {
                name: 'Enviar sem nota'
            })
        }
        
    }

    
}