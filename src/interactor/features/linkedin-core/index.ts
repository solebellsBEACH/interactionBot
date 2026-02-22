import { Page } from "playwright";
import { env } from "../../shared/env";
import { LINKEDIN_URLS } from "../../shared/constants/linkedin-urls";
import { normalizeLinkedinProfileUrl } from "../../shared/utils/linkedin-url";
import {
  clickSignOut,
  collectProfileSummary,
  extractProfileUrlFromPage,
  findProfileUrlFromNav,
  isLoggedIn,
  maybeAutoLogin,
  openMeMenu,
  solveOtpChallenge,
  waitForCaptchaSolve,
  waitForLogin,
  waitForLoginOrChallenge,
  waitForLogout,
  waitForProfileRedirect
} from "./private-utils";

export class LinkedinCoreFeatures {

  private _page: Page

  constructor(page: Page) {
    this._page = page
  }

  async auth() {
    const isLoggedInNow = await isLoggedIn(this._page, 3000)
    if (isLoggedInNow) return

    await this._page
      .goto(env.linkedinURLs.feedURL, {
        waitUntil: 'domcontentloaded'
      })
      .catch(() => undefined)
    await this._page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)

    const loggedAfterFeed = await isLoggedIn(this._page, 3000)
    if (loggedAfterFeed) return

    const loginUrl = LINKEDIN_URLS.checkpointLogin
    await this._page
      .goto(loginUrl, { waitUntil: 'domcontentloaded' })
      .catch(async () => {
        await this._page.goto(LINKEDIN_URLS.login, {
          waitUntil: 'domcontentloaded'
        })
      })

    await maybeAutoLogin(this._page)

    const outcome = await waitForLoginOrChallenge(this._page)
    if (outcome.status === 'logged-in') return

    if (outcome.status === 'otp') {
      const solved = await solveOtpChallenge(this._page)
      if (solved) {
        const loggedIn = await waitForLogin(this._page)
        if (loggedIn) return
      }
      throw new Error('LinkedIn auth failed: otp not accepted')
    }

    if (outcome.status === 'error') {
      throw new Error(`LinkedIn login error: ${outcome.message}`)
    }

    if (outcome.status === 'captcha') {
      const solved = await waitForCaptchaSolve(this._page)
      if (solved) {
        const loggedIn = await waitForLogin(this._page)
        if (loggedIn) return
      }
      throw new Error('LinkedIn login blocked by captcha')
    }

    throw new Error('LinkedIn auth timeout: user not logged in')
  }

  async login() {
    await this.auth()
  }

  async relogin() {
    await this.logout()
    await this._page
      .goto(LINKEDIN_URLS.login, {
        waitUntil: 'domcontentloaded'
      })
      .catch(() => undefined)

    const loggedIn = await waitForLogin(this._page)
    if (!loggedIn) {
      throw new Error('LinkedIn auth timeout: user not logged in')
    }
  }

  async logout() {
    await this._page
      .goto(env.linkedinURLs.feedURL, {
        waitUntil: 'domcontentloaded'
      })
      .catch(() => undefined)

    const isLoggedInNow = await isLoggedIn(this._page)
    if (!isLoggedInNow) {
      await this._page
        .goto(LINKEDIN_URLS.login, {
          waitUntil: 'domcontentloaded'
        })
        .catch(() => undefined)
      return
    }

    const openedMenu = await openMeMenu(this._page)
    if (openedMenu) {
      const clicked = await clickSignOut(this._page)
      if (clicked) {
        const loggedOut = await waitForLogout(this._page, 30_000)
        if (loggedOut) return
      }
    }

    const logoutUrls = [
      LINKEDIN_URLS.logoutMobile,
      LINKEDIN_URLS.logoutUas
    ]

    for (const url of logoutUrls) {
      try {
        await this._page.goto(url, {
          waitUntil: 'domcontentloaded'
        })
      } catch {
        // ignore
      }
      const loggedOut = await waitForLogout(this._page, 20_000)
      if (loggedOut) return
    }

    await this._page
      .goto(LINKEDIN_URLS.login, {
        waitUntil: 'domcontentloaded'
      })
      .catch(() => undefined)

    const stillLoggedIn = await isLoggedIn(this._page)
    if (stillLoggedIn) {
      throw new Error('LinkedIn logout failed')
    }
  }

  async goToLinkedinURL(linkedinUrl: string) {
    await this.auth()
    await this._page.goto(linkedinUrl, {
      waitUntil: 'domcontentloaded'
    });
  }

  async getOwnProfileUrl(): Promise<string | null> {
    await this.auth()

    const current = normalizeLinkedinProfileUrl(this._page.url())
    if (current) return current

    await this._page.goto(env.linkedinURLs.feedURL, {
      waitUntil: 'domcontentloaded'
    }).catch(() => undefined)

    const fromFeed = await extractProfileUrlFromPage(this._page)
    if (fromFeed) return fromFeed

    const fromNav = await findProfileUrlFromNav(this._page)
    if (fromNav) return fromNav

    await this._page.goto(LINKEDIN_URLS.profileMe, {
      waitUntil: 'domcontentloaded'
    }).catch(() => undefined)

    const redirected = await waitForProfileRedirect(this._page)
    if (redirected) return redirected

    const fromMe = await extractProfileUrlFromPage(this._page)
    if (fromMe) return fromMe

    return null
  }

  async getOwnProfileSummary() {
    await this.auth()

    const profileUrl = await this.getOwnProfileUrl()
    if (!profileUrl) return null

    return collectProfileSummary(this._page, profileUrl)
  }

}
