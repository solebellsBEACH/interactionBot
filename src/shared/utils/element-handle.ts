import { Locator, Page, } from "playwright";
import { HandleActions, Role } from "../interfaces/element-handle";

export class ElementHandle {
    private _page: Page
    private DEFAULT_TIMEOUT:number

    constructor(page: Page, timeout?:number){
        this._page = page
        this.DEFAULT_TIMEOUT=timeout||5_000
    }

    async handleByRole(handle:HandleActions, role:Role, options:{name?:string}, contentText?:string){
        try {
            const element = this._page.getByRole(role, options);
            await element.waitFor({ state: 'visible', timeout:this.DEFAULT_TIMEOUT });
            return this._runHandleActions(handle, element, contentText) || element
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
            return this._runHandleActions(handle, element, contentText)|| element
        } catch (error) {
             console.error({
            label:placeholder,
            error
        })
        }
    }

    async handleForm(){
        const element = await this._page.locator('form')
        await element.waitFor({ state: 'visible', timeout:this.DEFAULT_TIMEOUT });

        return this._getFormValues(element)
    }

    private async _getFormValues(element: Locator) {
        const selectValues = await this._getSelectValues(element)
        const inputValues = await this._getInputValues(element)
       
        return {
            selectValues,
            inputValues
        };
    }

    private async  _getInputValues(element:Locator){
        const inputs = await element.getByRole('textbox').all();
        return await Promise.all(
            inputs.map(async (item) => await item.inputValue())
        );
    }

    private async _getSelectValues(element:Locator){
        const formValues:string[] = []
        const values = await element.getByRole('option').allInnerTexts()

        values.map((item, index)=>{
            if(item.includes('Select an option')){
                formValues.push(values[index+1])
            }
        })

        return formValues
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

        return element
    }
    
}
