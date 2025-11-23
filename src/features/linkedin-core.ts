import { BrowserContext } from "playwright";
import { env } from "../shared/env";

export class LinkedinCoreFeatures {
    constructor(){
        
    }

    async openLinkedin(browser: BrowserContext){
      try {
        const page = await browser.newPage();
        await page.goto(env.linkedinURLs.recruiterURL, {
        waitUntil: 'domcontentloaded'
        });
        return page;
      } catch (error) {
        throw(error)
      }
    }   
}
