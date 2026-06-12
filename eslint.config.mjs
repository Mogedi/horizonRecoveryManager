import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'
import nextPlugin from '@next/eslint-plugin-next'

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'hermes/**', // Hermes is a separate plain-JS service with its own conventions
      'src/generated/**',
      'prisma/**',
      '*.config.*',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    // Adoption ratchet: this codebase had no linting, so its ~30 pre-existing violations start as
    // WARNINGS (baseline stays green, `npm run lint` exits 0) while every issue is still surfaced.
    // New code is held to the same rules. Burn the backlog down, then promote rules back to 'error'.
    plugins: { next: nextPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      'react/no-unescaped-entities': 'warn',
      'next/no-img-element': 'warn',
    },
  },
]

export default config
