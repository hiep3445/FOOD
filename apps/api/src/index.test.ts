import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { hashToken } from './lib/crypto'
import type { Bindings } from './types'
import worker from './index'

const categoryId = 'category-test'
const availableProductId = 'product-available'
const unavailableProductId = 'product-unavailable'
const testEnv = env as unknown as Bindings
const adminToken = 'a'.repeat(64)
const staffToken = 'b'.repeat(64)

async function request(path: string, init?: RequestInit) {
  return worker.fetch(new Request(`http://localhost${path}`, init), testEnv, {} as ExecutionContext)
}

async function createOrder(productId = availableProductId, quantity: unknown = 2, extra: Record<string, unknown> = {}) {
  return request('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID().replaceAll('-', '') },
    body: JSON.stringify({
      customerName: 'Nguyễn An',
      customerPhone: '0912345678',
      deliveryAddress: '12 Đường Hoa, Quận 1',
      customerNote: '',
      items: [{ productId, quantity }],
      ...extra,
    }),
  })
}

beforeEach(async () => {
  await testEnv.DB.prepare('DELETE FROM order_items').run()
  await testEnv.DB.prepare('DELETE FROM orders').run()
  await testEnv.DB.prepare('DELETE FROM products').run()
  await testEnv.DB.prepare('DELETE FROM categories').run()
  await testEnv.DB.prepare('INSERT INTO categories (id, name, slug, description, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)')
    .bind(categoryId, 'Món nhà', 'mon-nha', '', new Date().toISOString(), new Date().toISOString()).run()
  await testEnv.DB.prepare('INSERT INTO products (id, category_id, name, slug, description, price, image_key, is_available, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)')
    .bind(availableProductId, categoryId, 'Cơm gà', 'com-ga', 'Gà nướng thơm', 45000, new Date().toISOString(), new Date().toISOString()).run()
  await testEnv.DB.prepare('INSERT INTO products (id, category_id, name, slug, description, price, image_key, is_available, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)')
    .bind(unavailableProductId, categoryId, 'Canh rau', 'canh-rau', 'Rau theo mùa', 20000, new Date().toISOString(), new Date().toISOString()).run()
  const now = new Date().toISOString()
  await testEnv.DB.prepare("INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, created_at, updated_at) VALUES ('test-admin', 'test-admin', 'unused', 'admin', 1, ?, ?)").bind(now, now).run()
  await testEnv.DB.prepare("INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, created_at, updated_at) VALUES ('test-staff', 'test-staff', 'unused', 'staff', 1, ?, ?)").bind(now, now).run()
  await testEnv.DB.prepare('INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await hashToken(adminToken), 'test-admin', new Date(Date.now() + 60_000).toISOString(), now).run()
  await testEnv.DB.prepare('INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await hashToken(staffToken), 'test-staff', new Date(Date.now() + 60_000).toISOString(), now).run()
})

describe('public menu API', () => {
  it('returns active categories and filters products by category and search', async () => {
    const categoriesResponse = await request('/api/categories')
    expect((await categoriesResponse.json() as { categories: unknown[] }).categories).toHaveLength(1)

    const response = await request(`/api/products?categoryId=${categoryId}&q=gà`)
    const data = await response.json() as { products: { id: string; price: number }[] }
    expect(data.products).toHaveLength(1)
    expect(data.products[0]).toMatchObject({ id: availableProductId, price: 45000 })
  })

  it('returns a healthy response', async () => {
    const response = await request('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})

describe('COD order API', () => {
  it('creates an order using database prices and stores item snapshots', async () => {
    const response = await createOrder()
    const created = await response.json() as { orderCode: string; trackingToken: string }
    expect(response.status).toBe(201)
    expect(created.orderCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    const order = await testEnv.DB.prepare('SELECT subtotal, delivery_fee, total FROM orders WHERE order_code = ?').bind(created.orderCode).first()
    expect(order).toMatchObject({ subtotal: 90000, delivery_fee: 20000, total: 110000 })
    const item = await testEnv.DB.prepare('SELECT product_name, unit_price, quantity, line_total FROM order_items WHERE order_id = (SELECT id FROM orders WHERE order_code = ?)')
      .bind(created.orderCode).first()
    expect(item).toMatchObject({ product_name: 'Cơm gà', unit_price: 45000, quantity: 2, line_total: 90000 })
    expect(created.trackingToken).toMatch(/^[a-f0-9]{64}$/)
    const stored = await testEnv.DB.prepare('SELECT tracking_token_hash AS tokenHash, tracking_token_ciphertext AS tokenCiphertext FROM orders WHERE order_code = ?')
      .bind(created.orderCode).first<{ tokenHash: string; tokenCiphertext: string }>()
    expect(stored?.tokenHash).toBe(await hashToken(created.trackingToken))
    expect(stored?.tokenCiphertext).not.toContain(created.trackingToken)
  })

  it('rejects fabricated client prices and invalid quantities', async () => {
    const fabricated = await createOrder(availableProductId, 1, { price: 1, total: 1 })
    expect(fabricated.status).toBe(400)
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS total FROM orders').first()).toMatchObject({ total: 0 })
    expect((await createOrder(availableProductId, 0)).status).toBe(400)
  })

  it('rejects unknown and unavailable products', async () => {
    expect((await createOrder('does-not-exist')).status).toBe(400)
    expect((await createOrder(unavailableProductId)).status).toBe(409)
  })

  it('rejects totals above the configured safety limit', async () => {
    await testEnv.DB.prepare('UPDATE products SET price = 1000000000 WHERE id = ?').bind(availableProductId).run()
    expect((await createOrder(availableProductId, 20)).status).toBe(400)
  })

  it('rejects oversized JSON even without a Content-Length header', async () => {
    const response = await request('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID().replaceAll('-', '') },
      body: JSON.stringify({ note: 'x'.repeat(20_000) }),
    })
    expect(response.status).toBe(413)
  })

  it('returns the original order on an idempotent retry', async () => {
    const key = crypto.randomUUID().replaceAll('-', '')
    const payload = { customerName: 'Nguyễn An', customerPhone: '0912345678', deliveryAddress: '12 Đường Hoa, Quận 1', items: [{ productId: availableProductId, quantity: 1 }] }
    const init = { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(payload) }
    const first = await request('/api/orders', init)
    const retry = await request('/api/orders', init)
    expect(first.status).toBe(201)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual(await first.json())
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS total FROM orders').first()).toMatchObject({ total: 1 })
  })

  it('tracks using a secret token, never the order code alone', async () => {
    const response = await createOrder()
    const order = await response.json() as { trackingToken: string; orderCode: string }
    const invalid = await request('/api/orders/track')
    expect(invalid.status).toBe(401)
    const tracked = await request('/api/orders/track', { headers: { authorization: `Bearer ${order.trackingToken}` } })
    expect(tracked.status).toBe(200)
    expect((await tracked.json() as { order: { orderCode: string; total: number } }).order).toMatchObject({ orderCode: order.orderCode, total: 110000 })
  })
})

describe('admin access control', () => {
  it('rejects product management without an admin session', async () => {
    const response = await request('/api/admin/products')
    expect(response.status).toBe(401)
  })

  it('allows staff to read products but rejects catalog changes', async () => {
    const headers = { cookie: `food_session=${staffToken}`, origin: 'http://localhost:5173', 'content-type': 'application/json' }
    expect((await request('/api/admin/products', { headers })).status).toBe(200)
    const response = await request('/api/admin/products', { method: 'POST', headers, body: JSON.stringify({}) })
    expect(response.status).toBe(403)
  })

  it('enforces valid order state transitions', async () => {
    const created = await createOrder()
    const { orderCode } = await created.json() as { orderCode: string }
    const row = await testEnv.DB.prepare('SELECT id FROM orders WHERE order_code = ?').bind(orderCode).first<{ id: string }>()
    const headers = { cookie: `food_session=${adminToken}`, origin: 'http://localhost:5173', 'content-type': 'application/json' }
    const accepted = await request(`/api/admin/orders/${row!.id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'confirmed' }) })
    expect(accepted.status).toBe(200)
    const rejected = await request(`/api/admin/orders/${row!.id}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'pending' }) })
    expect(rejected.status).toBe(409)
  })

  it('rejects expired admin sessions', async () => {
    await testEnv.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 60_000).toISOString(), await hashToken(adminToken)).run()
    const response = await request('/api/admin/orders', { headers: { cookie: `food_session=${adminToken}` } })
    expect(response.status).toBe(401)
  })

  it('bootstraps once and establishes an HttpOnly session on login', async () => {
    await testEnv.DB.prepare('DELETE FROM sessions').run()
    await testEnv.DB.prepare('DELETE FROM users').run()
    const origin = 'http://localhost:5173'
    const bootstrap = await request('/api/admin/auth/bootstrap', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-bootstrap-secret': 'test-bootstrap-secret-that-is-not-used-in-production' },
      body: JSON.stringify({ username: 'owner', password: 'a-long-test-password' }),
    })
    expect(bootstrap.status).toBe(201)
    expect((await request('/api/admin/auth/bootstrap', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-bootstrap-secret': 'test-bootstrap-secret-that-is-not-used-in-production' },
      body: JSON.stringify({ username: 'owner', password: 'a-long-test-password' }),
    })).status).toBe(409)
    const login = await request('/api/admin/auth/login', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'a-long-test-password' }),
    })
    expect(login.status).toBe(200)
    expect(login.headers.get('set-cookie')).toContain('HttpOnly')
  })

  it('allows only one concurrent first-admin bootstrap', async () => {
    await testEnv.DB.prepare('DELETE FROM sessions').run()
    await testEnv.DB.prepare('DELETE FROM users').run()
    const headers = { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-bootstrap-secret': 'test-bootstrap-secret-that-is-not-used-in-production' }
    const create = (username: string) => request('/api/admin/auth/bootstrap', {
      method: 'POST',
      headers,
      body: JSON.stringify({ username, password: 'another-long-test-password' }),
    })
    const results = await Promise.all([create('owner-one'), create('owner-two')])
    expect(results.map((response) => response.status).sort()).toEqual([201, 409])
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS total FROM users').first()).toMatchObject({ total: 1 })
  })

  it('rejects oversized and spoofed upload files', async () => {
    const headers = { cookie: `food_session=${adminToken}`, origin: 'http://localhost:5173' }
    const invalidForm = new FormData()
    invalidForm.set('file', new File(['not an image'], 'dish.png', { type: 'image/png' }))
    expect((await request('/api/admin/uploads', { method: 'POST', headers, body: invalidForm })).status).toBe(400)

    const oversizedForm = new FormData()
    oversizedForm.set('file', new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))
    expect((await request('/api/admin/uploads', { method: 'POST', headers, body: oversizedForm })).status).toBe(400)
  })

  it('uploads verified images to R2 and serves them through the Worker', async () => {
    const headers = { cookie: `food_session=${adminToken}`, origin: 'http://localhost:5173' }
    const form = new FormData()
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nWkAAAAASUVORK5CYII='), (character) => character.charCodeAt(0))
    form.set('file', new File([png], 'dish.png', { type: 'image/png' }))
    const upload = await request('/api/admin/uploads', { method: 'POST', headers, body: form })
    expect(upload.status).toBe(201)
    const { key } = await upload.json() as { key: string }
    const image = await request(`/api/images/${key}`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png)
  })
})