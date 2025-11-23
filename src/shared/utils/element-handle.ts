import { Page, } from "playwright";

type Role = Parameters<Page['getByRole']>[0];
enum HandleActions {
    click = 'click',
    fill = "fill"
}

export class ElementHandle {
    private _page: Page
    private DEFAULT_TIMEOUT:number

    constructor(page: Page, timeout?:number){
        this._page = page
        this.DEFAULT_TIMEOUT=timeout||10_000
    }

    async handleByRole(handle:HandleActions, role:Role, options:any, contentText?:string){
       const element = this._page.getByRole(role, options);

        await element.waitFor({ state: 'visible', timeout:this.DEFAULT_TIMEOUT });

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
