import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getCookie } from 'hono/cookie'
import type { AppEnv } from '../types'
import { hashToken } from './crypto'

const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310_000 }, key, 256)
  return `pbkdf2$310000$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, iterationText, saltText, expectedText] = stored.split('$')
  const iterations = Number(iterationText)
  if (algorithm !== 'pbkdf2' || !Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(saltText), iterations }, key, 256))
    const expected = fromBase64(expectedText)
    if (bits.length !== expected.length) return false
    let difference = 0
    for (let index = 0; index < bits.length; index++) difference |= bits[index] ^ expected[index]
    return difference === 0
  } catch {
    return false
  }
}

export async function enforceRateLimit(db: D1Database, scope: string, bucketKey: string, limit: number, windowSeconds: number) {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds
  await db.prepare(
    'INSERT INTO rate_limits (scope, bucket_key, window_start, request_count) VALUES (?, ?, ?, 1) ON CONFLICT(scope, bucket_key) DO UPDATE SET request_count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.request_count + 1 ELSE 1 END, window_start = excluded.window_start',
  ).bind(scope, bucketKey, windowStart).run()
  const result = await db.prepare('SELECT request_count AS requestCount FROM rate_limits WHERE scope = ? AND bucket_key = ?')
    .bind(scope, bucketKey).first<{ requestCount: number }>()
  if ((result?.requestCount ?? 0) > limit) throw new HTTPException(429, { message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.' })
}

export async function enforceSameOrigin(context: Context<AppEnv>) {
  const origin = context.req.header('origin')
  if (!origin) throw new HTTPException(403, { message: 'Yêu cầu không hợp lệ.' })
  const received = new URL(origin)
  const configuredOrigin = context.env.PUBLIC_ORIGIN
  if (configuredOrigin ? received.origin !== configuredOrigin : !['localhost', '127.0.0.1'].includes(received.hostname)) {
    throw new HTTPException(403, { message: 'Nguồn yêu cầu không hợp lệ.' })
  }
}

export async function requireAdmin(context: Context<AppEnv>) {
  const sessionToken = getCookie(context, 'food_session')
  if (!sessionToken || !/^[a-f0-9]{64}$/.test(sessionToken)) throw new HTTPException(401, { message: 'Vui lòng đăng nhập.' })
  const sessionHash = await hashToken(sessionToken)
  const session = await context.env.DB.prepare(
    'SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1',
  ).bind(sessionHash, new Date().toISOString()).first<{ id: string; username: string; role: 'admin' | 'staff' }>()
  if (!session) throw new HTTPException(401, { message: 'Phiên đăng nhập đã hết hạn.' })
  context.set('adminUser', session)
  return session
}

export async function requireRole(context: Context<AppEnv>, role: 'admin') {
  const user = await requireAdmin(context)
  if (user.role !== role) throw new HTTPException(403, { message: 'Tài khoản không có quyền thực hiện thao tác này.' })
  return user
}

export async function requestKey(context: Context<AppEnv>) {
  const address = context.req.header('cf-connecting-ip') ?? context.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  return hashToken(address)
}