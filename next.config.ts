import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'patchright',
    'patchright-core',
    'playwright-core',
    '@sparticuz/chromium-min',
  ],
}

export default nextConfig
