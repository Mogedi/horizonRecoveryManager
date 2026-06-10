// Playwright browser singleton for server-side screenshot capture.
// Patchright is a drop-in Playwright fork that fixes CDP-level bot-detection leaks:
// it executes init scripts in isolated contexts and avoids the Runtime.enable CDP timing
// signature that Cloudflare Bot Management detects before any JS fingerprint is evaluated.
// @sparticuz/chromium-min provides the Chromium binary for Vercel Pro (~45MB compressed).
import { chromium } from 'patchright'
import type { Browser, Page, Cookie } from 'patchright'
import chromiumBin from '@sparticuz/chromium-min'
import { BrowserError } from '@/lib/errors'
import { log } from '@/lib/logger'

let _browser: Browser | null = null

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser

  // On Vercel (serverless): use @sparticuz/chromium-min — the binary is sized for Lambda/Vercel
  // and requires its custom args. Locally: let Patchright use its own bundled Chromium so the
  // serverless args don't crash the full desktop binary.
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME
  const launchArgs = isServerless ? {
    args: chromiumBin.args,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ?? await chromiumBin.executablePath(),
  } : {}

  _browser = await chromium.launch({ headless: true, ...launchArgs })
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

    // Manually patch the fingerprints Cloudflare bot management checks most often.
    // navigator.webdriver is the primary headless-browser signal; window.chrome and
    // plugins presence are secondary checks that distinguish Chrome from automation.
    // Patchright handles navigator.webdriver at the protocol level (sets it to undefined/false).
    // The manual patches below cover window.chrome and navigator.plugins — secondary signals
    // that Cloudflare checks. Each is wrapped in try-catch because Patchright may have already
    // defined some properties as non-configurable, which would throw and kill the rest of the script.
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true })
      } catch { /* Patchright already patched this at protocol level — fine */ }
      try {
        Object.defineProperty(navigator, 'plugins', {
          get: () => Object.assign(
            [
              { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
              { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
            ],
            { namedItem: () => null, refresh: () => undefined, item: () => null },
          ),
          configurable: true,
        })
      } catch { /* ignore */ }
      try {
        // @ts-ignore
        window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} }
      } catch { /* ignore */ }
    })

    if (cookies.length > 0) {
      await ctx.addCookies(cookies)
    }

    const page = await ctx.newPage()
    const start = Date.now()
    // 'load' fires once HTML + sync scripts are done. 'networkidle' never fires on SPAs like
    // HubSpot that poll continuously — callers use waitForSelector for actual content readiness.
    await page.goto(url, { waitUntil: 'load', timeout: 45_000 })
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
