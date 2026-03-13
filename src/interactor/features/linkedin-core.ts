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

  async logoutAndClearSession() {
    const context = this._page.context()

    const clearStorageOnPage = async () => {
      await this._page.evaluate(async () => {
        try {
          localStorage.clear()
        } catch {}

        try {
          sessionStorage.clear()
        } catch {}

        try {
          if ("caches" in globalThis) {
            const keys = await caches.keys()
            await Promise.all(keys.map((key) => caches.delete(key)))
          }
        } catch {}

        try {
          if ("indexedDB" in globalThis && typeof indexedDB.databases === "function") {
            const databases = await indexedDB.databases()
            await Promise.all(
              databases
                .map((item) => item?.name)
                .filter((name): name is string => Boolean(name))
                .map(
                  (name) =>
                    new Promise<void>((resolve) => {
                      const request = indexedDB.deleteDatabase(name)
                      request.onsuccess = () => resolve()
                      request.onerror = () => resolve()
                      request.onblocked = () => resolve()
                    })
                )
            )
          }
        } catch {}
      })
    }

    const logoutUrls = [
      'https://www.linkedin.com/m/logout/',
      'https://www.linkedin.com/uas/logout'
    ]

    for (const logoutUrl of logoutUrls) {
      try {
        await this._page.goto(logoutUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        break
      } catch {
        // try next logout route
      }
    }

    try {
      await this._page.goto('https://www.linkedin.com', {
        waitUntil: 'domcontentloaded',
        timeout: 15_000
      })
    } catch {
      // ignore
    }

    await clearStorageOnPage().catch(() => undefined)
    await context.clearCookies().catch(() => undefined)

    for (const page of context.pages()) {
      if (page === this._page) continue
      await page.close().catch(() => undefined)
    }

    await this._page.goto('https://www.linkedin.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 15_000
    }).catch(() => undefined)
  }

  private async _isLoggedIn() {
    const selectors = [
      '#global-nav',
      '[data-test-global-nav-link="feed"]',
      'a[href*="/feed/"]'
    ]

    for (const selector of selectors) {
      if (await this._page.locator(selector).first().count() > 0) return true
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
