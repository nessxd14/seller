import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: [...configDefaults.exclude, '**/*.local/**'],
    // Las pruebas nunca deben alcanzar el Supabase de producción.
    env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'test-anon-key' },
    setupFiles: ['./src/test/sinProduccion.ts'],
  },
})
