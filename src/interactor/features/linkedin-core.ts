import { Page } from "playwright";
import { env } from "../shared/env";

export class LinkedinCoreFeatures {

  private _page: Page

  constructor(page: Page) {
    this._page = page
  }

  async auth() {
    const isLoggedIn = await this._isLoggedIn()
    if (isLoggedIn) return

    await this._page.goto('https://www.linkedin.com/login', {
      waitUntil: 'domcontentloaded'
    })

    await this._maybeAutoLogin()

    const loggedIn = await this._waitForLogin()
    if (!loggedIn) {
      throw new Error('LinkedIn auth timeout: user not logged in')
    }
  }

  async goToLinkedinURL(linkedinUrl: string) {
    await this.auth()
    await this._page.goto(linkedinUrl, {
      waitUntil: 'domcontentloaded'
    });
  }

  private async _isLoggedIn() {
    const selectors = [
      '#global-nav',
      '[data-test-global-nav-link="feed"]',
      'a[href*="/feed/"]'
    ]

    for (const selector of selectors) {
      if (await this._page.locator(selector)?.first()?.count() > 0) return true
    }

    return false
  }

  private async _waitForLogin() {
    try {
      await this._page.waitForSelector(
        '#global-nav, [data-test-global-nav-link="feed"], a[href*="/feed/"]',
        { timeout: 120_000 }
      )
      return true
    } catch {
      return false
    }
  }

  private async _maybeAutoLogin() {
    const { email, password } = env.linkedinAuth
    if (!email || !password) return

    const usernameInput = this._page.locator('input#username, input[name="session_key"]')
    const passwordInput = this._page.locator('input#password, input[name="session_password"]')
    if ((await usernameInput.count()) === 0 || (await passwordInput.count()) === 0) return

    await usernameInput.first().fill(email)
    await passwordInput.first().fill(password)

    const submitButton = this._page.locator('button[type="submit"]')
    if ((await submitButton.count()) > 0) {
      await submitButton.first().click()
      return
    }

    await this._page.keyboard.press('Enter')
  }

}
