// Flat config ESLint 9 — configuration Next 16 (native en flat config)
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = [
  ...nextVitals,
  { ignores: ['.next/**', 'node_modules/**', 'public/sw.js', 'next-env.d.ts', 'scripts/**'] },
  {
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      // Règle introduite par Next 16 (React Compiler) : 19 cas existants à revoir
      // un par un (indicateurs d'hydratation, synchronisation avec le navigateur).
      'react-hooks/set-state-in-effect': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
]

export default eslintConfig
