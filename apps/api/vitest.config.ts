import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

const migrations = await readD1Migrations('migrations')

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: '../../wrangler.jsonc' },
    miniflare: {
      bindings: {
        TOKEN_SECRET: 'test-token-secret-that-is-not-used-in-production',
        ADMIN_BOOTSTRAP_SECRET: 'test-bootstrap-secret-that-is-not-used-in-production',
        PUBLIC_ORIGIN: 'http://localhost:5173',
        TEST_MIGRATIONS: migrations,
      },
    },
  })],
  test: { include: ['src/**/*.test.ts'], setupFiles: ['./src/test-setup.ts'] },
})