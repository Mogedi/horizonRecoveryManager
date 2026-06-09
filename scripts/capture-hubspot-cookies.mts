#!/usr/bin/env npx tsx
//
// One-time script to capture HubSpot session cookies via a real browser login.
// Run this whenever cookies expire (~30 days).
//
// Usage:
//   npx tsx scripts/capture-hubspot-cookies.mts
//
// What happens:
//   1. Opens a Chrome window with a fresh isolated profile (won't conflict with open Chrome)
//   2. Navigates to the HubSpot login page
//   3. Waits for you to log in manually (up to 3 minutes)
//   4. Once the dashboard loads, captures ALL cookies (including httpOnly)
//   5. Prints the line to add to .env.local

import { chromium } from 'playwright-core'

const HUBSPOT_DASHBOARD_URL = 'https://app.hubspot.com'
const LOGIN_URL = 'https://app.hubspot.com/login'
const WAIT_FOR_LOGIN_MS = 3 * 60 * 1000  // 3 minutes

async function main() {
  console.log('Opening Chrome — log into HubSpot when the window appears...\n')

  // launchPersistentContext with a temp profile launches Chrome in isolation
  // without conflicting with any already-open Chrome windows.
  const tmpProfile = `/tmp/playwright-hubspot-capture-${Date.now()}`
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

  const ctx = await chromium.launchPersistentContext(tmpProfile, {
    headless: false,
    executablePath,
    args: ['--no-first-run', '--no-default-browser-check'],
  })

  const page = await ctx.newPage()
  await page.goto(LOGIN_URL)

  console.log('Waiting for you to log in (up to 3 minutes)...')
  console.log('The script continues automatically once you reach the HubSpot dashboard.\n')

  // Poll until the URL moves past /login
  const deadline = Date.now() + WAIT_FOR_LOGIN_MS
  while (Date.now() < deadline) {
    const url = page.url()
    if (url.startsWith(HUBSPOT_DASHBOARD_URL) && !url.includes('/login')) {
      await page.waitForTimeout(2000)  // let post-login cookies settle
      break
    }
    await page.waitForTimeout(1000)
  }

  if (page.url().includes('/login')) {
    console.error('Timed out waiting for login. Run again and log in within 3 minutes.')
    await ctx.close()
    process.exit(1)
  }

  const cookies = await ctx.cookies()
  await ctx.close()

  if (cookies.length === 0) {
    console.error('No cookies captured. Try again.')
    process.exit(1)
  }

  const json = JSON.stringify(cookies)

  console.log(`\n✓ Captured ${cookies.length} cookies\n`)
  console.log('Add this to .env.local:\n')
  console.log(`HUBSPOT_SESSION_COOKIES='${json}'`)
  console.log('\n(Single quotes prevent the shell from interpreting the JSON braces)')
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
