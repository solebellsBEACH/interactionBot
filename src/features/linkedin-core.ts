import { Page } from "playwright";

export class LinkedinCoreFeatures {

    private _page: Page

    constructor(page:Page){
      this._page = page
    }
    
    async goToLinkedinURL(linkedinUrl:string){
        await this._page.goto(linkedinUrl, {
          waitUntil: 'domcontentloaded'
        });
    }
}
