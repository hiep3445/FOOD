export type Bindings = {
  DB: D1Database
  IMAGES: R2Bucket
  ASSETS: Fetcher
  TOKEN_SECRET: string
  ADMIN_BOOTSTRAP_SECRET: string
  PUBLIC_ORIGIN: string
  STORE_NAME: string
  DELIVERY_FEE: string
  SESSION_TTL_HOURS: string
}

export type AdminUser = { id: string; username: string; role: 'admin' | 'staff' }
export type AppEnv = { Bindings: Bindings; Variables: { adminUser: AdminUser } }