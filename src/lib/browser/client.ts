// Playwright browser singleton for server-side screenshot capture.
//
// Uses playwright-extra (wraps playwright-core) with the stealth plugin to avoid
// Cloudflare/HubSpot bot detection. @sparticuz/chromium-min provides the Chromium binary
// sized for Vercel Pro serverless functions (~45MB compressed).
//
// On AWS/multi-instance: this module is fine as-is. Each invocation gets its
// own browser process; Playwright manages the subprocess lifecycle.
//
// Auth: inject cookies via openPage() before navigating to authenticated URLs.
// Parse HUBSPOT_SESSION_COOKIES from env via loadHubSpotCookies().

// playwright-extra uses the same API as playwright-core but adds a plugin system.
// The stealth plugin patches ~20 bot-detection fingerprints (navigator.webdriver,
// window.chrome, plugins list, etc.) — the ones Cloudflare bot management checks.
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import chromiumBin from '@sparticuz/chromium-min'
import type { Browser, Page, Cookie } from 'playwright-core'
import { BrowserError } from '@/lib/errors'
import { log } from '@/lib/logger'

chromium.use(StealthPlugin())

let _browser: Browser | null = null

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ?? await chromiumBin.executablePath()

  _browser = await chromium.launch({
    args: chromiumBin.args,
    executablePath,
    headless: true,
  }) as unknown as Browser

  _browser.on('disconnected', () => { _browser = null })
  return _browser
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close()
    _browser = null
  }
}

// Opens a new browser context and navigates to the URL.
// Cookies are injected before navigation so authenticated pages load correctly.
// Caller is responsible for closing the page's context when done.
export async function openPage(url: string, cookies: Cookie[] = []): Promise<Page> {
  try {
    const browser = await getBrowser()
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    if (cookies.length > 0) {
      await ctx.addCookies(cookies)
    }

    const page = await ctx.newPage()
    const start = Date.now()
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
    log.info('browser navigation', { url, ms: Date.now() - start })

    return page
  } catch (err) {
    throw new BrowserError(
      `Failed to open ${url}: ${err instanceof Error ? err.message : String(err)}`,
      err,
    )
  }
}

// Performs brief human-like behaviour before a screenshot to avoid bot-pattern detection.
// Random mouse movement + small scroll + short pause — keeps timing non-mechanical.
export async function humanizeBeforeScreenshot(page: Page): Promise<void> {
  const x = 400 + Math.floor(Math.random() * 400)
  const y = 300 + Math.floor(Math.random() * 200)
  await page.mouse.move(x, y, { steps: 5 })
  await page.evaluate(() => window.scrollBy(0, 120 + Math.random() * 80))
  await page.waitForTimeout(800 + Math.floor(Math.random() * 700))
}

// Parses the HUBSPOT_SESSION_COOKIES env var (JSON array of Playwright Cookie objects).
// Returns empty array if not set — screenshot will show the login page,
// which the vision verifier detects and flags as "session expired".
export function loadHubSpotCookies(): Cookie[] {
  const raw = process.env.HUBSPOT_SESSION_COOKIES
  if (!raw) return []
  try {
    return JSON.parse(raw) as Cookie[]
  } catch {
    log.warn('HUBSPOT_SESSION_COOKIES is set but not valid JSON — ignoring')
    return []
  }
}
