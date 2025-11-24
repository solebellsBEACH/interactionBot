import { Locator, Page, } from "playwright";
import { HandleActions, Role } from "../interfaces/element-handle";

export class ElementHandle {
    private _page: Page
    private DEFAULT_TIMEOUT:number

    constructor(page: Page, timeout?:number){
        this._page = page
        this.DEFAULT_TIMEOUT=timeout||10_000
    }

    async handleByRole(handle:HandleActions, role:Role, options:{name:string}, contentText?:string){
        try {
            const element = this._page.getByRole(role, options);
            await element.waitFor({ state: 'visible', timeout:this.DEFAULT_TIMEOUT });
            this._runHandleActions(handle, element, contentText)
        } catch (error) {
            console.error({
                label:options.name,
                error
            })
        }
    }

    async handleByPlaceholder(handle:HandleActions, placeholder:string, contentText:string){
        try {
            const element = this._page.getByPlaceholder(placeholder); 
            await element.waitFor({ state: 'visible', timeout:this.DEFAULT_TIMEOUT });
        this._runHandleActions(handle, element, contentText)
        } catch (error) {
             console.error({
            label:placeholder,
            error
        })
        }
    }

    private async _runHandleActions(handle: HandleActions, element: Locator, contentText?:string){
        switch (handle) {
            case HandleActions.click:
                await element.click()
                break;
            
            case HandleActions.fill:
                await element.fill(contentText || "")
                break;
        }
    }
}
