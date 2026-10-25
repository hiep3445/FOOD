declare module 'cloudflare:workers' {
  interface ProvidedEnv {
    DB: D1Database
    TOKEN_SECRET: string
    ADMIN_BOOTSTRAP_SECRET: string
    PUBLIC_ORIGIN: string
    DELIVERY_FEE: string
    TEST_MIGRATIONS: unknown
  }
}