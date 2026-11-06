// ESLint (configuration « flat ») pour tout le monorepo : `corepack pnpm lint`.
// Règles recommandées JS + TypeScript (sans analyse typée, pour rester rapide), hooks React pour l'interface.
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'apps/api/data/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Un paramètre ou une variable volontairement inutilisé se préfixe par « _ ».
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Les blocs catch vides sont commentés là où l'échec est volontairement ignoré.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', 'scripts/**/*.mjs', '*.mjs', '**/*.config.{js,ts,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
)
