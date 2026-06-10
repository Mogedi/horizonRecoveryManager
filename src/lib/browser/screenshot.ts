// takeScreenshot — navigates to a URL and returns a base64 image.
//
// All calls are serialized through browserLimiter (maxConcurrent: 1) to
// prevent multiple Chromium launches fighting for memory in the same invocation.

import { openPage, humanizeBeforeScreenshot } from './client'
import { browserLimiter } from '@/lib/rate-limiters'
import { BrowserError } from '@/lib/errors'
import type { Cookie } from 'patchright'

export type ScreenshotOptions = {
  cookies?: Cookie[]
  viewport?: { width: number; height: number }
  // Selector to wait for before capturing — ensures dynamic content has loaded
  waitForSelector?: string
  // Output format — defaults to jpeg for storage efficiency; use png for higher fidelity
  type?: 'png' | 'jpeg'
  // JPEG quality 0-100 (ignored for png) — defaults to 80
  quality?: number
  // CSS selector whose innerText should be extracted alongside the screenshot.
  // Use 'body' for SPAs where specific selectors are unstable (e.g. HubSpot's obfuscated classes).
  // Skips elements inside cross-origin iframes — use 'body' to maximise coverage.
  extractText?: string
  // Wait until document.body.innerText contains this substring before extracting text.
  // More reliable than waitForSelector for SPAs with lazy-loaded third-party cards (HubSpot Drive card).
  waitForText?: string
  // Fires after text extraction but BEFORE humanize+screenshot.
  // Use this for two-phase UX: caller gets the DOM verdict fast while screenshot continues in background.
  onTextExtracted?: (text: string | null) => Promise<void>
}

export type ScreenshotResult = {
  base64: string
  width: number
  height: number
  mimeType: 'image/png' | 'image/jpeg'
  // innerText of extractText selector, or null if selector not found / not requested
  extractedText: string | null
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 }

export async function takeScreenshot(
  url: string,
  opts: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
  return browserLimiter.schedule(async () => {
    const viewport = opts.viewport ?? DEFAULT_VIEWPORT
    const type = opts.type ?? 'jpeg'
    const quality = type === 'jpeg' ? (opts.quality ?? 80) : undefined
    const page = await openPage(url, opts.cookies ?? [])

    try {
      await page.setViewportSize(viewport)

      if (opts.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: 20_000 }).catch(() => {
          // Non-fatal — proceed even if selector not found
        })
      }

      // waitForText: wait until specific text appears in document.body.innerText.
      // More reliable than waitForSelector for SPAs with lazy-loaded third-party cards,
      // because it waits for actual content rather than a container element.
      if (opts.waitForText) {
        await page.waitForFunction(
          (text: string) => document.body.innerText.includes(text),
          opts.waitForText,
          { timeout: 20_000 },
        ).catch(() => {
          // Non-fatal — proceed even if text never appears (Drive card may not be configured)
        })
      }

      // Extract text from the specified selector before humanize/screenshot.
      // Use 'body' for maximum coverage on SPAs where specific selectors are unstable.
      let extractedText: string | null = null
      if (opts.extractText) {
        extractedText = await page.locator(opts.extractText).innerText({ timeout: 5_000 }).catch(() => null)
      }

      // Phase 1 boundary: fires before humanize+screenshot, enabling two-phase UX.
      if (opts.onTextExtracted) {
        await opts.onTextExtracted(extractedText)
      }

      await humanizeBeforeScreenshot(page)

      const buffer = await page.screenshot({ type, quality, fullPage: false })
      const base64 = buffer.toString('base64')

      return {
        base64,
        width: viewport.width,
        height: viewport.height,
        mimeType: type === 'jpeg' ? 'image/jpeg' : 'image/png',
        extractedText,
      }
    } catch (err) {
      throw new BrowserError(
        `Screenshot failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    } finally {
      await page.context().close()
    }
  })
}
