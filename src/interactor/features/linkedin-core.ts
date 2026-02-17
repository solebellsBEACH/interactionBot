import { Page } from "playwright";
import { createPrompt, waitForPromptAnswer } from "../../api/controllers/prompt-queue";
import { env } from "../shared/env";
import { LINKEDIN_BASE_URL, LINKEDIN_URLS } from "../shared/constants/linkedin-urls";

export class LinkedinCoreFeatures {

  private _page: Page

  constructor(page: Page) {
    this._page = page
  }

  async auth() {
    const isLoggedIn = await this._isLoggedIn(3000)
    if (isLoggedIn) return

    await this._page
      .goto(env.linkedinURLs.feedURL, {
        waitUntil: 'domcontentloaded'
      })
      .catch(() => undefined)
    await this._page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)

    const loggedAfterFeed = await this._isLoggedIn(3000)
    if (loggedAfterFeed) return

    const loginUrl = LINKEDIN_URLS.checkpointLogin
    await this._page
      .goto(loginUrl, { waitUntil: 'domcontentloaded' })
      .catch(async () => {
        await this._page.goto(LINKEDIN_URLS.login, {
          waitUntil: 'domcontentloaded'
        })
      })

    await this._maybeAutoLogin()

    const outcome = await this._waitForLoginOrChallenge()
    if (outcome.status === 'logged-in') return

    if (outcome.status === 'otp') {
      const solved = await this._solveOtpChallenge()
      if (solved) {
        const loggedIn = await this._waitForLogin()
        if (loggedIn) return
      }
      throw new Error('LinkedIn auth failed: otp not accepted')
    }

    if (outcome.status === 'error') {
      throw new Error(`LinkedIn login error: ${outcome.message}`)
    }

    if (outcome.status === 'captcha') {
      const solved = await this._waitForCaptchaSolve()
      if (solved) {
        const loggedIn = await this._waitForLogin()
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

    const loggedIn = await this._waitForLogin()
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

    const isLoggedIn = await this._isLoggedIn()
    if (!isLoggedIn) {
      await this._page
        .goto(LINKEDIN_URLS.login, {
          waitUntil: 'domcontentloaded'
        })
        .catch(() => undefined)
      return
    }

    const openedMenu = await this._openMeMenu()
    if (openedMenu) {
      const clicked = await this._clickSignOut()
      if (clicked) {
        const loggedOut = await this._waitForLogout(30_000)
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
      const loggedOut = await this._waitForLogout(20_000)
      if (loggedOut) return
    }

    await this._page
      .goto(LINKEDIN_URLS.login, {
        waitUntil: 'domcontentloaded'
      })
      .catch(() => undefined)

    const stillLoggedIn = await this._isLoggedIn()
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

    const current = this._normalizeProfileUrl(this._page.url())
    if (current) return current

    await this._page.goto(env.linkedinURLs.feedURL, {
      waitUntil: 'domcontentloaded'
    }).catch(() => undefined)

    const fromFeed = await this._extractProfileUrlFromPage()
    if (fromFeed) return fromFeed

    const fromNav = await this._findProfileUrlFromNav()
    if (fromNav) return fromNav

    await this._page.goto(LINKEDIN_URLS.profileMe, {
      waitUntil: 'domcontentloaded'
    }).catch(() => undefined)

    const redirected = await this._waitForProfileRedirect()
    if (redirected) return redirected

    const fromMe = await this._extractProfileUrlFromPage()
    if (fromMe) return fromMe

    return null
  }

  private async _isLoggedIn(waitMs = 0) {
    if (this._isLoginUrl(this._page.url())) return false

    const selectors = [
      '#global-nav',
      'nav[aria-label="Global Navigation"]',
      'header.global-nav__content',
      '[data-test-global-nav-link="feed"]',
      'a[href*="/feed/"]',
      'a.global-nav__primary-link',
      'button.global-nav__primary-link-me-menu-trigger',
      'a.global-nav__primary-link-me-menu-trigger'
    ]

    if (waitMs > 0) {
      await this._page
        .waitForSelector(selectors.join(','), { timeout: waitMs })
        .catch(() => undefined)
    }

    for (const selector of selectors) {
      if (await this._page.locator(selector)?.first()?.count() > 0) return true
    }

    return false
  }

  private _isLoginUrl(url: string) {
    if (!url) return false
    return (
      url.includes('/login') ||
      url.includes('/checkpoint') ||
      url.includes('/uas/')
    )
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

  private async _waitForLoginOrChallenge(timeoutMs = 120_000) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (await this._isLoggedIn()) return { status: 'logged-in' as const }

      const errorMessage = await this._detectLoginError()
      if (errorMessage) return { status: 'error' as const, message: errorMessage }

      if (await this._hasCaptchaChallenge()) {
        return { status: 'captcha' as const }
      }

      if (await this._hasOtpChallenge()) {
        return { status: 'otp' as const }
      }

      await this._page.waitForTimeout(800)
    }
    return { status: 'timeout' as const }
  }

  private async _waitForLogout(timeoutMs = 30_000) {
    try {
      await this._page.waitForSelector('input#username, input[name="session_key"]', {
        timeout: timeoutMs
      })
      return true
    } catch {
      return false
    }
  }

  private async _openMeMenu() {
    try {
      const byRole = this._page.getByRole('button', { name: /me|eu/i }).first()
      if ((await byRole.count()) > 0) {
        await byRole.click({ timeout: 3000 })
        await this._page.waitForTimeout(300)
        return true
      }
    } catch {
      // ignore and try selectors
    }

    const triggers = [
      'button[aria-label*="Me"]',
      'button[aria-label*="Eu"]',
      'button.global-nav__primary-link-me-menu-trigger',
      'a.global-nav__primary-link-me-menu-trigger',
      '#global-nav .global-nav__primary-link-me-menu-trigger',
      'button[data-control-name="nav.settings"]',
      'button[data-control-name="nav.settings_menu"]'
    ]

    for (const selector of triggers) {
      const trigger = this._page.locator(selector).first()
      if ((await trigger.count()) > 0) {
        try {
          await trigger.click({ timeout: 3000 })
          await this._page.waitForTimeout(300)
          return true
        } catch {
          // ignore and try next selector
        }
      }
    }

    return false
  }

  private async _clickSignOut() {
    const roleMatches = [
      { role: 'link', name: /sign out|sair|encerrar/i },
      { role: 'button', name: /sign out|sair|encerrar/i }
    ] as const

    for (const entry of roleMatches) {
      try {
        const candidate = this._page.getByRole(entry.role, { name: entry.name }).first()
        if ((await candidate.count()) > 0) {
          await candidate.click({ timeout: 3000 })
          return true
        }
      } catch {
        // ignore and try next
      }
    }

    const selectors = [
      'a[data-control-name="nav.settings_signout"]',
      'button[data-control-name="nav.settings_signout"]',
      'a[href*="/m/logout"]',
      'a[href*="/uas/logout"]',
      'a[href*="logout"]',
      'button:has-text("Sair")',
      'a:has-text("Sair")',
      'button:has-text("Sign out")',
      'a:has-text("Sign out")'
    ]

    for (const selector of selectors) {
      const element = this._page.locator(selector).first()
      if ((await element.count()) > 0) {
        try {
          await element.click({ timeout: 3000 })
          return true
        } catch {
          // ignore and try next selector
        }
      }
    }

    return false
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
    } else {
      await this._page.keyboard.press('Enter')
    }
    await this._page.waitForTimeout(500)
  }

  private async _hasOtpChallenge() {
    const selectors = [
      'input[name="pin"]',
      'input[name="verificationCode"]',
      'input#input__email_verification_pin',
      'input#input__phone_verification_pin',
      'input[autocomplete="one-time-code"]',
      'input[id*="verification" i]',
      'input[name*="otp" i]',
      'input[id*="otp" i]'
    ]

    for (const selector of selectors) {
      if ((await this._page.locator(selector).first().count()) > 0) return true
    }

    const url = this._page.url()
    if (url.includes('/checkpoint/')) return true
    return false
  }

  private async _solveOtpChallenge() {
    const input = await this._findOtpInput()
    if (!input) return false

    const answer = await this._promptWeb('Digite o codigo de verificacao do LinkedIn')
    if (!answer) {
      throw new Error('LinkedIn otp timeout: no answer')
    }

    await input.fill(answer.trim())

    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Verificar")',
      'button:has-text("Confirmar")',
      'button:has-text("Continuar")',
      'button:has-text("Verify")',
      'button:has-text("Confirm")',
      'button:has-text("Continue")'
    ]

    for (const selector of submitSelectors) {
      const button = this._page.locator(selector).first()
      if ((await button.count()) > 0) {
        await button.click().catch(() => undefined)
        return true
      }
    }

    await this._page.keyboard.press('Enter')
    return true
  }

  private async _findOtpInput() {
    const selectors = [
      'input[name="pin"]',
      'input[name="verificationCode"]',
      'input#input__email_verification_pin',
      'input#input__phone_verification_pin',
      'input[autocomplete="one-time-code"]',
      'input[id*="verification" i]',
      'input[name*="otp" i]',
      'input[id*="otp" i]'
    ]

    for (const selector of selectors) {
      const locator = this._page.locator(selector).first()
      if ((await locator.count()) > 0) return locator
    }
    return null
  }

  private async _detectLoginError() {
    const selectors = [
      '#error-for-username',
      '#error-for-password',
      'p[data-test-form-error]',
      'div.alert.error',
      '.alert--error',
      '.alert--warning',
      '.form__error',
      'div[role="alert"]'
    ]

    for (const selector of selectors) {
      const node = this._page.locator(selector).first()
      if ((await node.count()) > 0) {
        const text = (await node.innerText().catch(() => ''))?.trim()
        return text || 'login-error'
      }
    }

    return null
  }

  private async _hasCaptchaChallenge() {
    const selectors = [
      'iframe[src*="captcha"]',
      'div[id*="captcha" i]',
      'input[name*="captcha" i]'
    ]
    for (const selector of selectors) {
      if ((await this._page.locator(selector).first().count()) > 0) return true
    }
    return false
  }

  private async _waitForCaptchaSolve(timeoutMs = 180_000) {
    const prompt =
      'Captcha do LinkedIn detectado. Resolva no navegador aberto e confirme aqui quando terminar.'
    const answer = await this._promptWeb(prompt, timeoutMs)
    if (!answer) return false
    // Espera sair da tela de login ou captcha
    return this._waitForLogin()
  }

  private async _promptWeb(prompt: string, timeoutMs = 180_000) {
    const jobId = (process.env.BOT_JOB_ID || '').trim()
    if (!jobId) return null
    try {
      const record = await createPrompt(jobId, prompt)
      return await waitForPromptAnswer(record._id.toString(), timeoutMs)
    } catch {
      return null
    }
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

  private async _extractProfileUrlFromPage() {
    const candidate = await this._page.evaluate(() => {
      const pick = (value?: string | null) => (value || '').trim()
      const canonical = pick(document.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      if (canonical) return canonical
      const og = pick(document.querySelector('meta[property="og:url"]')?.getAttribute('content'))
      if (og) return og
      return ''
    }).catch(() => '')

    const normalized = this._normalizeProfileUrl(candidate)
    if (normalized) return normalized

    const fallbackHref = await this._page.evaluate(() => {
      const selectors = [
        'a[data-control-name="nav.settings_view_profile"]',
        'a[href*="/in/"][data-control-name*="view_profile"]',
        'a[href*="/in/"][data-test-global-nav-link*="profile"]',
        'a[href*="/in/"][data-test-global-nav-link*="me"]'
      ]
      for (const selector of selectors) {
        const link = document.querySelector(selector) as HTMLAnchorElement | null
        if (link?.href) return link.href
      }
      return ''
    }).catch(() => '')

    return this._normalizeProfileUrl(fallbackHref)
  }

  private _normalizeProfileUrl(raw: string) {
    if (!raw) return null
    try {
      const url = new URL(raw, LINKEDIN_BASE_URL)
      if (!url.pathname.includes('/in/')) return null
      if (url.pathname.includes('/in/me')) return null
      url.search = ''
      url.hash = ''
      return url.toString()
    } catch {
      if (!raw.includes('/in/') || raw.includes('/in/me')) return null
      return raw.split('#')[0].split('?')[0]
    }
  }

  private async _waitForProfileRedirect(timeoutMs = 15000) {
    const current = this._normalizeProfileUrl(this._page.url())
    if (current) return current
    try {
      await this._page.waitForURL(
        (url) => url.pathname.includes('/in/') && !url.pathname.includes('/in/me'),
        { timeout: timeoutMs }
      )
    } catch {
      // ignore
    }
    return this._normalizeProfileUrl(this._page.url())
  }

  async getOwnProfileSummary() {
    await this.auth()

    let profileUrl = await this.getOwnProfileUrl()
    if (!profileUrl) return null

    await this._page
      .goto(profileUrl, {
        waitUntil: 'domcontentloaded'
      })
      .catch(() => undefined)

    await this._page
      .waitForSelector('main h1, img[alt][src*="media.licdn.com"]', { timeout: 15_000 })
      .catch(() => undefined)
    await this._page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined)
    await this._page.waitForTimeout(800)

    const titleText = await this._page.title().catch(() => '')
    const titleName = this._parseMetaTitle(titleText || '')
    const topCard = await this._getTopCardSnapshot()
    const jsonLd = await this._getJsonLdPerson()
    const nameFromMeta = this._parseMetaTitle(
      await this._getMetaContent(['meta[property="og:title"]', 'meta[name="og:title"]'])
    )
    const nameFromUrl = this._guessNameFromProfileUrl(profileUrl)

    const name =
      (await this._getTextFromSelectors([
        'section.pv-top-card h1',
        '.pv-top-card h1',
        '.pv-text-details__left-panel h1',
        'main h1',
        'h1'
      ])) ||
      topCard.name ||
      (await this._getImageAltFromSelectors([
        'img.pv-top-card-profile-picture__image',
        'img.profile-photo-edit__preview',
        'img.pv-top-card__photo',
        'img[alt][src*="media.licdn.com"]'
      ])) ||
      jsonLd.name ||
      nameFromMeta ||
      titleName ||
      nameFromUrl

    const metaDescription = await this._getMetaContent([
      'meta[name="description"]',
      'meta[property="og:description"]'
    ])

    const headline =
      (await this._getTextFromSelectors([
        'section.pv-top-card [data-test-profile-headline]',
        'section.pv-top-card .text-body-medium.break-words',
        'section.pv-top-card .text-body-medium',
        '.pv-top-card [data-test-profile-headline]',
        '.pv-top-card .text-body-medium.break-words',
        '.pv-top-card .text-body-medium',
        '[data-test-profile-headline]',
        'main .text-body-medium.break-words',
        'main .text-body-medium',
        '.pv-text-details__left-panel .text-body-medium',
        '.text-body-medium'
      ])) ||
      topCard.headline ||
      jsonLd.headline ||
      this._parseMetaHeadline(metaDescription)

    const location =
      (await this._getTextFromSelectors([
        'section.pv-top-card .text-body-small.inline.t-black--light.break-words',
        'section.pv-top-card .text-body-small.inline',
        'section.pv-top-card .text-body-small',
        '.pv-top-card .text-body-small.inline.t-black--light.break-words',
        '.pv-top-card .text-body-small.inline',
        '.pv-top-card .text-body-small',
        '.pv-text-details__left-panel .text-body-small',
        '.pv-text-details__left-panel .text-body-small.inline',
        'main .text-body-small.inline.t-black--light.break-words',
        'main .text-body-small.inline',
        'main .text-body-small',
        '.text-body-small.inline',
        '.text-body-small'
      ])) ||
      topCard.location ||
      jsonLd.location ||
      this._parseMetaLocation(metaDescription)

    const photoUrl =
      (await this._getImageFromSelectors([
        'img.pv-top-card-profile-picture__image',
        'img.profile-photo-edit__preview',
        'img.pv-top-card__photo',
        'img.pv-top-card-profile-picture__image',
        'img[alt][src*="media.licdn.com"]'
      ])) ||
      jsonLd.photoUrl ||
      (await this._getMetaContent(['meta[property="og:image"]', 'meta[name="twitter:image"]']))

    profileUrl = profileUrl || jsonLd.profileUrl || null

    return {
      name: name || undefined,
      headline: headline || undefined,
      location: location || undefined,
      photoUrl: photoUrl || undefined,
      profileUrl
    }
  }

  private async _getTextFromSelectors(selectors: string[]) {
    for (const selector of selectors) {
      const node = this._page.locator(selector).first()
      if ((await node.count().catch(() => 0)) > 0) {
        const raw = (await node.innerText().catch(() => '')).trim()
        const text = raw.replace(/\s+/g, ' ').trim()
        if (text) return text
      }
    }
    return ''
  }

  private async _getImageFromSelectors(selectors: string[]) {
    for (const selector of selectors) {
      const node = this._page.locator(selector).first()
      if ((await node.count().catch(() => 0)) > 0) {
        const src = (await node.getAttribute('src').catch(() => '')) || ''
        if (src) return src
        const dataSrc =
          (await node.getAttribute('data-delayed-url').catch(() => '')) ||
          (await node.getAttribute('data-src').catch(() => '')) ||
          ''
        if (dataSrc) return dataSrc
      }
    }
    return ''
  }

  private async _getImageAltFromSelectors(selectors: string[]) {
    for (const selector of selectors) {
      const node = this._page.locator(selector).first()
      if ((await node.count().catch(() => 0)) > 0) {
        const alt = (await node.getAttribute('alt').catch(() => '')) || ''
        const text = alt.replace(/\s+/g, ' ').trim()
        if (text) return text
      }
    }
    return ''
  }

  private async _getMetaContent(selectors: string[]) {
    for (const selector of selectors) {
      const node = this._page.locator(selector).first()
      if ((await node.count().catch(() => 0)) > 0) {
        const content = (await node.getAttribute('content').catch(() => '')) || ''
        const text = content.replace(/\s+/g, ' ').trim()
        if (text) return text
      }
    }
    return ''
  }

  private async _getJsonLdPerson(): Promise<{
    name?: string
    headline?: string
    location?: string
    photoUrl?: string
    profileUrl?: string
  }> {
    type JsonLdPerson = {
      name?: string
      headline?: string
      location?: string
      photoUrl?: string
      profileUrl?: string
    }

    const data = await this._page
      .evaluate<Partial<JsonLdPerson>>(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      const asText = (value: unknown) => (typeof value === 'string' ? value : '')
      const findPerson = (value: unknown): any => {
        if (!value) return null
        if (Array.isArray(value)) {
          for (const item of value) {
            const found = findPerson(item)
            if (found) return found
          }
          return null
        }
        if (typeof value === 'object') {
          const record = value as Record<string, unknown>
          const type = record['@type']
          if (type === 'Person' || (Array.isArray(type) && type.includes('Person'))) {
            return record
          }
          if (record['@graph']) {
            const found = findPerson(record['@graph'])
            if (found) return found
          }
          for (const key of Object.keys(record)) {
            const found = findPerson(record[key])
            if (found) return found
          }
        }
        return null
      }

      for (const script of scripts) {
        const text = script.textContent?.trim()
        if (!text) continue
        try {
          const parsed = JSON.parse(text)
          const person = findPerson(parsed)
          if (!person) continue

          const address = person.address || person.homeLocation
          const addressString = (() => {
            if (!address) return ''
            if (typeof address === 'string') return address
            if (Array.isArray(address)) {
              const first = address.find((item) => typeof item === 'string' || item?.addressLocality)
              if (typeof first === 'string') return first
              if (first && typeof first === 'object') {
                const locality = asText((first as any).addressLocality)
                const region = asText((first as any).addressRegion)
                const country = asText((first as any).addressCountry)
                return [locality, region, country].filter(Boolean).join(', ')
              }
              return ''
            }
            if (typeof address === 'object') {
              const locality = asText((address as any).addressLocality)
              const region = asText((address as any).addressRegion)
              const country = asText((address as any).addressCountry)
              return [locality, region, country].filter(Boolean).join(', ')
            }
            return ''
          })()

          const image = person.image
          const imageUrl =
            typeof image === 'string'
              ? image
              : typeof image === 'object' && image
                ? asText((image as any).url)
                : ''

          return {
            name: asText(person.name),
            headline: asText(person.jobTitle) || asText(person.description),
            location: addressString,
            photoUrl: imageUrl,
            profileUrl: asText(person.url)
          }
        } catch {
          // ignore invalid JSON
        }
      }
      return {}
    })
      .catch(() => ({} as Partial<JsonLdPerson>))

    const sanitize = (value?: string) => (value ? value.replace(/\s+/g, ' ').trim() : '')
    return {
      name: sanitize(data?.name),
      headline: sanitize(data?.headline),
      location: sanitize(data?.location),
      photoUrl: sanitize(data?.photoUrl),
      profileUrl: sanitize(data?.profileUrl)
    }
  }

  private async _getTopCardSnapshot(): Promise<{
    name?: string
    headline?: string
    location?: string
  }> {
    const data = await this._page
      .evaluate(() => {
        const clean = (value?: string | null) =>
          (value || '').replace(/\s+/g, ' ').trim()
        const isNoise = (value: string) => {
          const lowered = value.toLowerCase()
          return (
            !value ||
            value.length < 2 ||
            lowered.includes('seguidores') ||
            lowered.includes('followers') ||
            lowered.includes('conex') ||
            lowered.includes('connections') ||
            lowered.includes('contato') ||
            lowered.includes('contact info') ||
            lowered.includes('ver contato') ||
            lowered.includes('ver perfil') ||
            lowered.includes('ver perfil completo') ||
            lowered.includes('message') ||
            lowered.includes('mensagem')
          )
        }

        const container =
          document.querySelector('[data-view-name="profile-top-card"]') ||
          document.querySelector('section.pv-top-card') ||
          document.querySelector('main section') ||
          document.querySelector('main')

        const name =
          clean(container?.querySelector('h1')?.textContent) ||
          clean(document.querySelector('main h1')?.textContent) ||
          ''

        const candidates = Array.from(container?.querySelectorAll('div, span') || [])
          .map((node) => clean(node.textContent))
          .filter(Boolean)
          .filter((value, index, self) => self.indexOf(value) === index)
          .filter((value) => !isNoise(value))

        const headline = candidates.find((value) => value !== name) || ''
        const location =
          candidates.find((value) => value !== name && value !== headline) || ''

        return { name, headline, location }
      })
      .catch(() => ({ name: '', headline: '', location: '' }))

    const sanitize = (value?: string) => (value ? value.replace(/\s+/g, ' ').trim() : '')
    return {
      name: sanitize(data.name),
      headline: sanitize(data.headline),
      location: sanitize(data.location)
    }
  }

  private _guessNameFromProfileUrl(profileUrl?: string | null) {
    if (!profileUrl) return ''
    try {
      const url = new URL(profileUrl)
      const slug = url.pathname.split('/').filter(Boolean).pop() || ''
      if (!slug) return ''
      const cleaned = slug
        .replace(/[^a-zA-Z0-9-]/g, '')
        .replace(/\d+/g, '')
        .replace(/-+/g, ' ')
        .trim()
      if (!cleaned) return ''
      return cleaned
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    } catch {
      return ''
    }
  }

  private _parseMetaTitle(raw: string) {
    if (!raw) return ''
    const cleaned = raw.replace(/\s+/g, ' ').trim()
    if (!cleaned) return ''
    const parts = cleaned.split(' | ').map((part) => part.trim()).filter(Boolean)
    if (!parts.length) return ''
    return parts[0]
  }

  private _parseMetaHeadline(raw: string) {
    if (!raw) return ''
    const cleaned = raw.replace(/\s+/g, ' ').trim()
    if (!cleaned) return ''
    const parts = cleaned.split(' | ').map((part) => part.trim()).filter(Boolean)
    if (!parts.length) return ''
    if (parts.length === 1) return parts[0]
    const headline = parts[0]
    if (headline.toLowerCase().includes('linkedin')) return ''
    return headline
  }

  private _parseMetaLocation(raw: string) {
    if (!raw) return ''
    const cleaned = raw.replace(/\s+/g, ' ').trim()
    if (!cleaned) return ''
    const parts = cleaned.split(' | ').map((part) => part.trim()).filter(Boolean)
    if (parts.length < 2) return ''
    const candidate = parts[1]
    if (candidate.toLowerCase().includes('linkedin')) return ''
    return candidate
  }

}
