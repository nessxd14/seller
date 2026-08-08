import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'supabase/**', '**/database.types.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off'
    }
  },
  // Brief S6: Bolivia es UTC−4 — toISOString().slice(0,10) devuelve la fecha en UTC, que
  // después de las 20:00 hora local ya es "mañana". Los __tests__ quedan afuera porque
  // fijan fechas arbitrarias con vi.setSystemTime, donde el patrón no importa.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString']",
          message: 'Usá hoyLocal() de domain/common/fechas — toISOString().slice(0,10) devuelve la fecha UTC, que en Bolivia es mañana después de las 20:00.',
        },
      ],
    },
  },
)
