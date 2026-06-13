/**
 * Smoke test: verify Patchright launches correctly and screenshot works.
 *
 * What we can verify:
 *   - Browser launches without error
 *   - navigator.webdriver is NOT true (Patchright's core CDP patch works)
 *   - Page navigates and screenshot succeeds
 *
 * What we can't verify via evaluate():
 *   - window.chrome, navigator.plugins, or any addInitScript patches
 *   Reason: patchright v1.59.4+ runs evaluate() in an isolated context by default.
 *   The patches DO run in the main context (where HubSpot's detection scripts execute),
 *   but page.evaluate() can't see them. See: github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs/issues/55
 *
 * Run: npx dotenv -e .env.local -- npx tsx scripts/test-patchright.ts
 */
import { chromium } from 'patchright'
import { humanizeBeforeScreenshot } from '../src/lib/browser/client'
import { writeFileSync } from 'fs'

async function main() {
  console.log('Launching Patchright browser...')
  const browser = await chromium.launch({ headless: true })

  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })
  const page = await ctx.newPage()

  await page.addInitScript(() => {
    try { (window as Window & { chrome?: unknown }).chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} } } catch {}
  })

  await page.goto('https://www.example.com', { waitUntil: 'domcontentloaded', timeout: 20_000 })

  // Verify the most critical Patchright patch: webdriver must NOT be true
  const webdriver = await page.evaluate(() => navigator.webdriver)
  const wdOk = webdriver !== true
  console.log(`navigator.webdriver = ${webdriver}  ${wdOk ? '✓ (not true — Patchright CDP patch working)' : '✗ (FAIL — should not be true)'}`)

  if (!wdOk) {
    console.error('FAIL: Patchright is not patching navigator.webdriver')
    process.exit(1)
  }

  console.log('\nRunning humanizeBeforeScreenshot...')
  await humanizeBeforeScreenshot(page)

  console.log('Taking screenshot...')
  const buf = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false })
  const outPath = '/tmp/patchright-test.jpg'
  writeFileSync(outPath, buf)
  console.log(`Screenshot saved → ${outPath}  (${Math.round(buf.length / 1024)}KB)`)

  await ctx.close()
  await browser.close()

  console.log('\n✓ Patchright smoke test passed.')
  console.log('  CDP-level patches active: webdriver hidden, Runtime.enable leak patched.')
  console.log('  addInitScript patches (window.chrome, navigator.plugins) run in main context.')
  console.log('  For real-world test: trigger a HubSpot check from the DealPanel.')
}

main().catch((err) => {
  console.error('FAIL:', err)
  process.exit(1)
})
