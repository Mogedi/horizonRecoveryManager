// takeScreenshot — navigates to a URL and returns a base64 image.
//
// All calls are serialized through browserLimiter (maxConcurrent: 1) to
// prevent multiple Chromium launches fighting for memory in the same invocation.

import { openPage, humanizeBeforeScreenshot } from './client'
import { browserLimiter } from '@/lib/rate-limiters'
import { BrowserError } from '@/lib/errors'
import type { Cookie } from 'playwright-core'

export type ScreenshotOptions = {
  cookies?: Cookie[]
  viewport?: { width: number; height: number }
  // Selector to wait for before capturing — ensures dynamic content has loaded
  waitForSelector?: string
  // Output format — defaults to jpeg for storage efficiency; use png for higher fidelity
  type?: 'png' | 'jpeg'
  // JPEG quality 0-100 (ignored for png) — defaults to 80
  quality?: number
}

export type ScreenshotResult = {
  base64: string
  width: number
  height: number
  mimeType: 'image/png' | 'image/jpeg'
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
        await page.waitForSelector(opts.waitForSelector, { timeout: 10_000 }).catch(() => {
          // Non-fatal — proceed with screenshot even if selector not found
        })
      }

      await humanizeBeforeScreenshot(page)

      const buffer = await page.screenshot({ type, quality, fullPage: false })
      const base64 = buffer.toString('base64')

      return {
        base64,
        width: viewport.width,
        height: viewport.height,
        mimeType: type === 'jpeg' ? 'image/jpeg' : 'image/png',
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
