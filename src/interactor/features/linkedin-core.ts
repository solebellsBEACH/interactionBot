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

  async getOwnProfileUrl(): Promise<string | null> {
    await this.auth()

    const current = this._normalizeProfileUrl(this._page.url())
    if (current) return current

    await this._page.goto(env.linkedinURLs.feedURL, {
      waitUntil: 'domcontentloaded'
    }).catch(() => undefined)

    const fromNav = await this._findProfileUrlFromNav()
    if (fromNav) return fromNav

    await this._page.goto('https://www.linkedin.com/in/me/', {
      waitUntil: 'domcontentloaded'
    }).catch(() => undefined)

    const redirected = this._normalizeProfileUrl(this._page.url())
    if (redirected) return redirected

    return null
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

  private async _findProfileUrlFromNav() {
    const nav = this._page.locator('#global-nav, nav.global-nav').first()

    const meTrigger = this._page
      .locator(
        [
          'button[aria-label*="Me"]',
          'button[aria-label*="Eu"]',
          'button.global-nav__primary-link-me-menu-trigger',
          'a.global-nav__primary-link-me-menu-trigger',
          '#global-nav .global-nav__primary-link-me-menu-trigger'
        ].join(',')
      )
      .first()

    if ((await meTrigger.count()) > 0) {
      await meTrigger.click().catch(() => undefined)
      await this._page.waitForTimeout(300)
    }

    const directSelectors = [
      'a[data-control-name="nav.settings_view_profile"]',
      'a[href*="/in/"][data-control-name*="view_profile"]',
      'a[href*="/in/"][data-control-name*="view"]'
    ]

    for (const selector of directSelectors) {
      const link = this._page.locator(selector).first()
      if ((await link.count()) > 0) {
        const href = await link.getAttribute('href')
        const normalized = this._normalizeProfileUrl(href || '')
        if (normalized) return normalized
      }
    }

    if ((await nav.count()) > 0) {
      const fallback = nav.locator('a[href*="/in/"]').first()
      if ((await fallback.count()) > 0) {
        const href = await fallback.getAttribute('href')
        const normalized = this._normalizeProfileUrl(href || '')
        if (normalized) return normalized
      }
    }

    return null
  }

  private _normalizeProfileUrl(raw: string) {
    if (!raw) return null
    try {
      const url = new URL(raw, 'https://www.linkedin.com')
      if (!url.pathname.includes('/in/')) return null
      url.search = ''
      url.hash = ''
      return url.toString()
    } catch {
      if (!raw.includes('/in/')) return null
      return raw.split('#')[0].split('?')[0]
    }
  }

}
