import { Locator, Page } from "playwright";
import { createPrompt, waitForPromptAnswer } from "../../../api/controllers/prompt-queue";
import { env } from "../../shared/env";
import { guessNameFromLinkedinProfileUrl, normalizeLinkedinProfileUrl } from "../../shared/utils/linkedin-url";
import { parseMetaHeadline, parseMetaLocation, parseMetaTitle } from "../../shared/utils/parse-meta";
import { normalizeWhitespace } from "../../shared/utils/normalize";

export type LoginOutcome =
  | { status: 'logged-in' }
  | { status: 'error'; message: string }
  | { status: 'captcha' }
  | { status: 'otp' }
  | { status: 'timeout' }

export const isLoginUrl = (url: string) => {
  if (!url) return false
  return (
    url.includes('/login') ||
    url.includes('/checkpoint') ||
    url.includes('/uas/')
  )
}

export const isLoggedIn = async (page: Page, waitMs = 0) => {
  if (isLoginUrl(page.url())) return false

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
    await page
      .waitForSelector(selectors.join(','), { timeout: waitMs })
      .catch(() => undefined)
  }

  for (const selector of selectors) {
    if (await page.locator(selector)?.first()?.count() > 0) return true
  }

  return false
}

export const waitForLogin = async (page: Page) => {
  try {
    await page.waitForSelector(
      '#global-nav, [data-test-global-nav-link="feed"], a[href*="/feed/"]',
      { timeout: 120_000 }
    )
    return true
  } catch {
    return false
  }
}

export const waitForLoginOrChallenge = async (
  page: Page,
  timeoutMs = 120_000
): Promise<LoginOutcome> => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await isLoggedIn(page)) return { status: 'logged-in' }

    const errorMessage = await detectLoginError(page)
    if (errorMessage) return { status: 'error', message: errorMessage }

    if (await hasCaptchaChallenge(page)) {
      return { status: 'captcha' }
    }

    if (await hasOtpChallenge(page)) {
      return { status: 'otp' }
    }

    await page.waitForTimeout(800)
  }
  return { status: 'timeout' }
}

export const waitForLogout = async (page: Page, timeoutMs = 30_000) => {
  try {
    await page.waitForSelector('input#username, input[name="session_key"]', {
      timeout: timeoutMs
    })
    return true
  } catch {
    return false
  }
}

export const openMeMenu = async (page: Page) => {
  try {
    const byRole = page.getByRole('button', { name: /me|eu/i }).first()
    if ((await byRole.count()) > 0) {
      await byRole.click({ timeout: 3000 })
      await page.waitForTimeout(300)
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
    const trigger = page.locator(selector).first()
    if ((await trigger.count()) > 0) {
      try {
        await trigger.click({ timeout: 3000 })
        await page.waitForTimeout(300)
        return true
      } catch {
        // ignore and try next selector
      }
    }
  }

  return false
}

export const clickSignOut = async (page: Page) => {
  const roleMatches = [
    { role: 'link', name: /sign out|sair|encerrar/i },
    { role: 'button', name: /sign out|sair|encerrar/i }
  ] as const

  for (const entry of roleMatches) {
    try {
      const candidate = page.getByRole(entry.role, { name: entry.name }).first()
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
    const element = page.locator(selector).first()
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

export const maybeAutoLogin = async (page: Page) => {
  const { email, password } = env.linkedinAuth
  if (!email || !password) return

  const usernameInput = page.locator('input#username, input[name="session_key"]')
  const passwordInput = page.locator('input#password, input[name="session_password"]')
  if ((await usernameInput.count()) === 0 || (await passwordInput.count()) === 0) return

  await usernameInput.first().fill(email)
  await passwordInput.first().fill(password)

  const submitButton = page.locator('button[type="submit"]')
  if ((await submitButton.count()) > 0) {
    await submitButton.first().click()
  } else {
    await page.keyboard.press('Enter')
  }
  await page.waitForTimeout(500)
}

export const hasOtpChallenge = async (page: Page) => {
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
    if ((await page.locator(selector).first().count()) > 0) return true
  }

  const url = page.url()
  if (url.includes('/checkpoint/')) return true
  return false
}

export const findOtpInput = async (page: Page): Promise<Locator | null> => {
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
    const locator = page.locator(selector).first()
    if ((await locator.count()) > 0) return locator
  }
  return null
}

export const promptWeb = async (prompt: string, timeoutMs = 180_000) => {
  const jobId = (process.env.BOT_JOB_ID || '').trim()
  if (!jobId) return null
  try {
    const record = await createPrompt(jobId, prompt)
    return await waitForPromptAnswer(record._id||''.toString(), timeoutMs)
  } catch {
    return null
  }
}

export const solveOtpChallenge = async (page: Page) => {
  const input = await findOtpInput(page)
  if (!input) return false

  const answer = await promptWeb('Digite o codigo de verificacao do LinkedIn')
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
    const button = page.locator(selector).first()
    if ((await button.count()) > 0) {
      await button.click().catch(() => undefined)
      return true
    }
  }

  await page.keyboard.press('Enter')
  return true
}

export const detectLoginError = async (page: Page) => {
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
    const node = page.locator(selector).first()
    if ((await node.count()) > 0) {
      const text = (await node.innerText().catch(() => ''))?.trim()
      return text || 'login-error'
    }
  }

  return null
}

export const hasCaptchaChallenge = async (page: Page) => {
  const selectors = [
    'iframe[src*="captcha"]',
    'div[id*="captcha" i]',
    'input[name*="captcha" i]'
  ]
  for (const selector of selectors) {
    if ((await page.locator(selector).first().count()) > 0) return true
  }
  return false
}

export const waitForCaptchaSolve = async (page: Page, timeoutMs = 180_000) => {
  const prompt =
    'Captcha do LinkedIn detectado. Resolva no navegador aberto e confirme aqui quando terminar.'
  const answer = await promptWeb(prompt, timeoutMs)
  if (!answer) return false
  // Espera sair da tela de login ou captcha
  return waitForLogin(page)
}

export const findProfileUrlFromNav = async (page: Page) => {
  const nav = page.locator('#global-nav, nav.global-nav').first()

  const meTrigger = page
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
    await page.waitForTimeout(300)
  }

  const directSelectors = [
    'a[data-control-name="nav.settings_view_profile"]',
    'a[href*="/in/"][data-control-name*="view_profile"]',
    'a[href*="/in/"][data-control-name*="view"]'
  ]

  for (const selector of directSelectors) {
    const link = page.locator(selector).first()
    if ((await link.count()) > 0) {
      const href = await link.getAttribute('href')
      const normalized = normalizeLinkedinProfileUrl(href || '')
      if (normalized) return normalized
    }
  }

  if ((await nav.count()) > 0) {
    const fallback = nav.locator('a[href*="/in/"]').first()
    if ((await fallback.count()) > 0) {
      const href = await fallback.getAttribute('href')
      const normalized = normalizeLinkedinProfileUrl(href || '')
      if (normalized) return normalized
    }
  }

  return null
}

export const extractProfileUrlFromPage = async (page: Page) => {
  const candidate = await page
    .evaluate(() => {
      const pick = (value?: string | null) => (value || '').trim()
      const canonical = pick(document.querySelector('link[rel="canonical"]')?.getAttribute('href'))
      if (canonical) return canonical
      const og = pick(document.querySelector('meta[property="og:url"]')?.getAttribute('content'))
      if (og) return og
      return ''
    })
    .catch(() => '')

  const normalized = normalizeLinkedinProfileUrl(candidate)
  if (normalized) return normalized

  const fallbackHref = await page
    .evaluate(() => {
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
    })
    .catch(() => '')

  return normalizeLinkedinProfileUrl(fallbackHref)
}

export const waitForProfileRedirect = async (page: Page, timeoutMs = 15000) => {
  const current = normalizeLinkedinProfileUrl(page.url())
  if (current) return current
  try {
    await page.waitForURL(
      (url) => url.pathname.includes('/in/') && !url.pathname.includes('/in/me'),
      { timeout: timeoutMs }
    )
  } catch {
    // ignore
  }
  return normalizeLinkedinProfileUrl(page.url())
}

export const collectProfileSummary = async (page: Page, profileUrl: string) => {
  await page
    .goto(profileUrl, {
      waitUntil: 'domcontentloaded'
    })
    .catch(() => undefined)

  await page
    .waitForSelector('main h1, img[alt][src*="media.licdn.com"]', { timeout: 15_000 })
    .catch(() => undefined)
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined)
  await page.waitForTimeout(800)

  const titleText = await page.title().catch(() => '')
  const titleName = parseMetaTitle(titleText || '')
  const topCard = await getTopCardSnapshot(page)
  const jsonLd = await getJsonLdPerson(page)
  const nameFromMeta = parseMetaTitle(
    await getMetaContent(page, ['meta[property="og:title"]', 'meta[name="og:title"]'])
  )
  const nameFromUrl = guessNameFromLinkedinProfileUrl(profileUrl)

  const name =
    (await getTextFromSelectors(page, [
      'section.pv-top-card h1',
      '.pv-top-card h1',
      '.pv-text-details__left-panel h1',
      'main h1',
      'h1'
    ])) ||
    topCard.name ||
    (await getImageAltFromSelectors(page, [
      'img.pv-top-card-profile-picture__image',
      'img.profile-photo-edit__preview',
      'img.pv-top-card__photo',
      'img[alt][src*="media.licdn.com"]'
    ])) ||
    jsonLd.name ||
    nameFromMeta ||
    titleName ||
    nameFromUrl

  const metaDescription = await getMetaContent(page, [
    'meta[name="description"]',
    'meta[property="og:description"]'
  ])

  const headline =
    (await getTextFromSelectors(page, [
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
    parseMetaHeadline(metaDescription)

  const location =
    (await getTextFromSelectors(page, [
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
    parseMetaLocation(metaDescription)

  const photoUrl =
    (await getImageFromSelectors(page, [
      'img.pv-top-card-profile-picture__image',
      'img.profile-photo-edit__preview',
      'img.pv-top-card__photo',
      'img.pv-top-card-profile-picture__image',
      'img[alt][src*="media.licdn.com"]'
    ])) ||
    jsonLd.photoUrl ||
    (await getMetaContent(page, ['meta[property="og:image"]', 'meta[name="twitter:image"]']))

  const resolvedProfileUrl = profileUrl || jsonLd.profileUrl || null

  return {
    name: name || undefined,
    headline: headline || undefined,
    location: location || undefined,
    photoUrl: photoUrl || undefined,
    profileUrl: resolvedProfileUrl
  }
}

export const getTextFromSelectors = async (page: Page, selectors: string[]) => {
  for (const selector of selectors) {
    const node = page.locator(selector).first()
    if ((await node.count().catch(() => 0)) > 0) {
      const raw = await node.innerText().catch(() => '')
      const text = normalizeWhitespace(raw)
      if (text) return text
    }
  }
  return ''
}

export const getImageFromSelectors = async (page: Page, selectors: string[]) => {
  for (const selector of selectors) {
    const node = page.locator(selector).first()
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

export const getImageAltFromSelectors = async (page: Page, selectors: string[]) => {
  for (const selector of selectors) {
    const node = page.locator(selector).first()
    if ((await node.count().catch(() => 0)) > 0) {
      const alt = (await node.getAttribute('alt').catch(() => '')) || ''
      const text = normalizeWhitespace(alt)
      if (text) return text
    }
  }
  return ''
}

export const getMetaContent = async (page: Page, selectors: string[]) => {
  for (const selector of selectors) {
    const node = page.locator(selector).first()
    if ((await node.count().catch(() => 0)) > 0) {
      const content = (await node.getAttribute('content').catch(() => '')) || ''
      const text = normalizeWhitespace(content)
      if (text) return text
    }
  }
  return ''
}

export const getJsonLdPerson = async (page: Page): Promise<{
  name?: string
  headline?: string
  location?: string
  photoUrl?: string
  profileUrl?: string
}> => {
  type JsonLdPerson = {
    name?: string
    headline?: string
    location?: string
    photoUrl?: string
    profileUrl?: string
  }

  const data = await page
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

  const sanitize = (value?: string) => (value ? normalizeWhitespace(value) : '')
  return {
    name: sanitize(data?.name),
    headline: sanitize(data?.headline),
    location: sanitize(data?.location),
    photoUrl: sanitize(data?.photoUrl),
    profileUrl: sanitize(data?.profileUrl)
  }
}

export const getTopCardSnapshot = async (page: Page): Promise<{
  name?: string
  headline?: string
  location?: string
}> => {
  const data = await page
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

  const sanitize = (value?: string) => (value ? normalizeWhitespace(value) : '')
  return {
    name: sanitize(data.name),
    headline: sanitize(data.headline),
    location: sanitize(data.location)
  }
}
