import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'hermes/**',       // separate plain-JS service with its own conventions
      'docs/**',         // research/throwaway scripts (gitignored, hold real data) — not app code
      'src/generated/**',
      'prisma/**',
      '*.config.*',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    // Backlog burned down — rules enforced at error. (Leading-underscore names are the
    // convention for intentionally-unused vars/args/catch-bindings.)
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/ban-ts-comment': 'error',
      'react/no-unescaped-entities': 'error',
      '@next/next/no-img-element': 'error',
      'react-hooks/static-components': 'error',
      'react-hooks/purity': 'error',
      // OFF: the React-Compiler-era rule flags standard async data-fetching effects
      // (`setLoading(true)` then `fetch().then(setData)`) used across ~10 components. Those are
      // intentional and correct; turning it on would mean refactoring working, untested UI for no
      // real bug. Revisit if/when we move data fetching to a hook or Suspense.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]

export default config
