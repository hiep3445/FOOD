import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { hashToken, randomId } from '../lib/crypto'
import { enforceRateLimit, enforceSameOrigin, hashPassword, requestKey, requireAdmin, requireRole, verifyPassword } from '../lib/security'
import type { AppEnv } from '../types'

const admin = new Hono<AppEnv>()

admin.use('*', async (context, next) => {
  if (context.req.method !== 'GET') await enforceSameOrigin(context)
  await next()
})

const loginSchema = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(200) }).strict()

admin.post('/auth/bootstrap', async (context) => {
  const address = await requestKey(context)
  await enforceRateLimit(context.env.DB, 'bootstrap', address, 5, 3600)
  const bootstrapSecret = context.req.header('x-bootstrap-secret')
  if (!bootstrapSecret || !context.env.ADMIN_BOOTSTRAP_SECRET || bootstrapSecret !== context.env.ADMIN_BOOTSTRAP_SECRET) {
    throw new HTTPException(403, { message: 'Không thể khởi tạo tài khoản quản trị.' })
  }
  const parsed = loginSchema.safeParse(await context.req.json().catch(() => null))
  if (!parsed.success || parsed.data.password.length < 12) throw new HTTPException(400, { message: 'Tên đăng nhập hoặc mật khẩu không hợp lệ. Mật khẩu cần ít nhất 12 ký tự.' })
  const now = new Date().toISOString()
  const result = await context.env.DB.prepare('INSERT INTO users (id, username, password_hash, role, is_active, created_at, updated_at) SELECT ?, ?, ?, \'admin\', 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)')
    .bind(randomId(), parsed.data.username, await hashPassword(parsed.data.password), now, now).run()
  if (!result.meta.changes) throw new HTTPException(409, { message: 'Tài khoản quản trị đã được khởi tạo.' })
  return context.json({ message: 'Đã tạo tài khoản quản trị.' }, 201)
})

admin.post('/auth/login', async (context) => {
  const address = await requestKey(context)
  await enforceRateLimit(context.env.DB, 'login', address, 8, 900)
  const parsed = loginSchema.safeParse(await context.req.json().catch(() => null))
  if (!parsed.success) throw new HTTPException(400, { message: 'Vui lòng nhập tên đăng nhập và mật khẩu.' })
  const user = await context.env.DB.prepare('SELECT id, username, password_hash AS passwordHash, role FROM users WHERE username = ? AND is_active = 1')
    .bind(parsed.data.username).first<{ id: string; username: string; passwordHash: string; role: 'admin' | 'staff' }>()
  if (!user || !await verifyPassword(parsed.data.password, user.passwordHash)) throw new HTTPException(401, { message: 'Tên đăng nhập hoặc mật khẩu không đúng.' })
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  const tokenHash = await hashToken(token)
  const ttl = Math.min(Math.max(Number(context.env.SESSION_TTL_HOURS) || 72, 1), 168)
  const expiresAt = new Date(Date.now() + ttl * 3600_000).toISOString()
  await context.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, user.id, expiresAt, new Date().toISOString()).run()
  setCookie(context, 'food_session', token, {
    httpOnly: true,
    secure: new URL(context.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/api/admin',
    maxAge: ttl * 3600,
  })
  return context.json({ user: { id: user.id, username: user.username, role: user.role }, expiresAt })
})

admin.post('/auth/logout', async (context) => {
  const sessionToken = context.req.header('cookie')?.match(/(?:^|;\s*)food_session=([^;]+)/)?.[1]
  if (sessionToken) await context.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await hashToken(decodeURIComponent(sessionToken))).run()
  deleteCookie(context, 'food_session', { path: '/api/admin' })
  return context.json({ message: 'Đã đăng xuất.' })
})

admin.get('/auth/me', async (context) => {
  const user = await requireAdmin(context)
  return context.json({ user })
})

admin.use('*', async (context, next) => {
  if (context.req.path.endsWith('/auth/bootstrap') || context.req.path.endsWith('/auth/login') || context.req.path.endsWith('/auth/logout')) return next()
  await requireAdmin(context)
  return next()
})

const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  description: z.string().max(500).default(''),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true),
}).strict()

admin.get('/categories', async (context) => {
  const result = await context.env.DB.prepare('SELECT id, name, slug, description, sort_order AS sortOrder, is_active AS isActive FROM categories ORDER BY sort_order, name').all()
  return context.json({ categories: result.results })
})

admin.post('/categories', async (context) => {
  await requireRole(context, 'admin')
  const body = categorySchema.safeParse(await context.req.json().catch(() => null))
  if (!body.success) throw new HTTPException(400, { message: 'Thông tin danh mục chưa hợp lệ.' })
  const now = new Date().toISOString()
  await context.env.DB.prepare('INSERT INTO categories (id, name, slug, description, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(randomId(), body.data.name, body.data.slug, body.data.description, body.data.sortOrder, Number(body.data.isActive), now, now).run()
  return context.json({ message: 'Đã tạo danh mục.' }, 201)
})

admin.put('/categories/:id', async (context) => {
  await requireRole(context, 'admin')
  const body = categorySchema.safeParse(await context.req.json().catch(() => null))
  if (!body.success) throw new HTTPException(400, { message: 'Thông tin danh mục chưa hợp lệ.' })
  const result = await context.env.DB.prepare('UPDATE categories SET name = ?, slug = ?, description = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?')
    .bind(body.data.name, body.data.slug, body.data.description, body.data.sortOrder, Number(body.data.isActive), new Date().toISOString(), context.req.param('id')).run()
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Không tìm thấy danh mục.' })
  return context.json({ message: 'Đã cập nhật danh mục.' })
})

admin.delete('/categories/:id', async (context) => {
  await requireRole(context, 'admin')
  const result = await context.env.DB.prepare('UPDATE categories SET is_active = 0, updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), context.req.param('id')).run()
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Không tìm thấy danh mục.' })
  return context.json({ message: 'Đã ẩn danh mục.' })
})

const productSchema = z.object({
  categoryId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(160),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),
  description: z.string().max(2000).default(''),
  price: z.number().int().min(0).max(1_000_000_000),
  imageKey: z.string().regex(/^[a-f0-9-]{36}\.(?:jpg|png|webp)$/).nullable().default(null),
  isAvailable: z.boolean().default(true),
}).strict()

admin.get('/products', async (context) => {
  const result = await context.env.DB.prepare('SELECT id, category_id AS categoryId, name, slug, description, price, image_key AS imageKey, is_available AS isAvailable FROM products ORDER BY name').all()
  return context.json({ products: result.results })
})

admin.post('/products', async (context) => {
  await requireRole(context, 'admin')
  const body = productSchema.safeParse(await context.req.json().catch(() => null))
  if (!body.success) throw new HTTPException(400, { message: 'Thông tin món ăn chưa hợp lệ.' })
  const now = new Date().toISOString()
  await context.env.DB.prepare('INSERT INTO products (id, category_id, name, slug, description, price, image_key, is_available, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(randomId(), body.data.categoryId, body.data.name, body.data.slug, body.data.description, body.data.price, body.data.imageKey, Number(body.data.isAvailable), now, now).run()
  return context.json({ message: 'Đã tạo món ăn.' }, 201)
})

admin.put('/products/:id', async (context) => {
  await requireRole(context, 'admin')
  const body = productSchema.safeParse(await context.req.json().catch(() => null))
  if (!body.success) throw new HTTPException(400, { message: 'Thông tin món ăn chưa hợp lệ.' })
  const result = await context.env.DB.prepare('UPDATE products SET category_id = ?, name = ?, slug = ?, description = ?, price = ?, image_key = ?, is_available = ?, updated_at = ? WHERE id = ?')
    .bind(body.data.categoryId, body.data.name, body.data.slug, body.data.description, body.data.price, body.data.imageKey, Number(body.data.isAvailable), new Date().toISOString(), context.req.param('id')).run()
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Không tìm thấy món ăn.' })
  return context.json({ message: 'Đã cập nhật món ăn.' })
})

admin.delete('/products/:id', async (context) => {
  await requireRole(context, 'admin')
  const result = await context.env.DB.prepare('UPDATE products SET is_available = 0, updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), context.req.param('id')).run()
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Không tìm thấy món ăn.' })
  return context.json({ message: 'Đã lưu trữ món ăn.' })
})

admin.get('/orders', async (context) => {
  const status = context.req.query('status')
  const query = context.req.query('q')?.trim().slice(0, 32)
  const from = context.req.query('from')
  const to = context.req.query('to')
  const conditions: string[] = []
  const values: string[] = []
  if (status) {
    if (!['pending', 'confirmed', 'preparing', 'delivering', 'completed', 'cancelled'].includes(status)) throw new HTTPException(400, { message: 'Trạng thái không hợp lệ.' })
    conditions.push('status = ?')
    values.push(status)
  }
  if (query) {
    conditions.push('order_code LIKE ?')
    values.push(`%${query.replace(/[\\%_]/g, '\\$&')}%`)
  }
  for (const [value, label] of [[from, 'Từ ngày'], [to, 'Đến ngày']] as const) {
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00+07:00`)))) {
      throw new HTTPException(400, { message: `${label} không hợp lệ.` })
    }
  }
  if (from) { conditions.push('created_at >= ?'); values.push(new Date(`${from}T00:00:00+07:00`).toISOString()) }
  if (to) {
    const end = new Date(`${to}T00:00:00+07:00`)
    end.setUTCDate(end.getUTCDate() + 1)
    conditions.push('created_at < ?')
    values.push(end.toISOString())
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const orders = await context.env.DB.prepare(`SELECT id, order_code AS orderCode, customer_name AS customerName, customer_phone AS customerPhone, total, payment_status AS paymentStatus, status, created_at AS createdAt FROM orders ${where} ORDER BY created_at DESC LIMIT 100`).bind(...values).all()
  return context.json({ orders: orders.results })
})

admin.get('/orders/:id', async (context) => {
  const order = await context.env.DB.prepare('SELECT id, order_code AS orderCode, customer_name AS customerName, customer_phone AS customerPhone, delivery_address AS deliveryAddress, customer_note AS customerNote, subtotal, delivery_fee AS deliveryFee, total, payment_method AS paymentMethod, payment_status AS paymentStatus, status, created_at AS createdAt, updated_at AS updatedAt FROM orders WHERE id = ?')
    .bind(context.req.param('id')).first<{ id: string }>()
  if (!order) throw new HTTPException(404, { message: 'Không tìm thấy đơn hàng.' })
  const items = await context.env.DB.prepare('SELECT product_name AS productName, unit_price AS unitPrice, quantity, line_total AS lineTotal FROM order_items WHERE order_id = ?').bind(order.id).all()
  return context.json({ order: { ...order, items: items.results } })
})

const nextStates: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['delivering', 'cancelled'],
  delivering: ['completed'],
  completed: [],
  cancelled: [],
}

admin.patch('/orders/:id/status', async (context) => {
  const body = z.object({ status: z.enum(['pending', 'confirmed', 'preparing', 'delivering', 'completed', 'cancelled']) }).strict().safeParse(await context.req.json().catch(() => null))
  if (!body.success) throw new HTTPException(400, { message: 'Trạng thái không hợp lệ.' })
  const current = await context.env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(context.req.param('id')).first<{ status: string }>()
  if (!current) throw new HTTPException(404, { message: 'Không tìm thấy đơn hàng.' })
  if (!nextStates[current.status]?.includes(body.data.status)) throw new HTTPException(409, { message: 'Không thể chuyển đơn sang trạng thái này.' })
  const result = await context.env.DB.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
    .bind(body.data.status, new Date().toISOString(), context.req.param('id'), current.status).run()
  if (!result.meta.changes) throw new HTTPException(409, { message: 'Đơn hàng vừa được cập nhật. Vui lòng tải lại.' })
  return context.json({ message: 'Đã cập nhật trạng thái đơn.' })
})

admin.patch('/orders/:id/payment-status', async (context) => {
  await requireRole(context, 'admin')
  const body = z.object({ paymentStatus: z.enum(['paid']) }).strict().safeParse(await context.req.json().catch(() => null))
  if (!body.success) throw new HTTPException(400, { message: 'Trạng thái thanh toán không hợp lệ.' })
  const result = await context.env.DB.prepare("UPDATE orders SET payment_status = 'paid', updated_at = ? WHERE id = ? AND status = 'completed' AND payment_status = 'unpaid'")
    .bind(new Date().toISOString(), context.req.param('id')).run()
  if (!result.meta.changes) throw new HTTPException(409, { message: 'Chỉ có thể xác nhận COD cho đơn đã hoàn tất.' })
  return context.json({ message: 'Đã xác nhận thu tiền COD.' })
})

const MAX_IMAGE_SIZE = 5 * 1024 * 1024

function imageMime(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: 'image/png', extension: 'png' }
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return { mime: 'image/webp', extension: 'webp' }
  return null
}

admin.post('/uploads', async (context) => {
  await requireRole(context, 'admin')
  const maxRequestBytes = MAX_IMAGE_SIZE + 65_536
  if (Number(context.req.header('content-length') ?? 0) > maxRequestBytes) throw new HTTPException(413, { message: 'Ảnh không được lớn hơn 5 MB.' })
  const reader = context.req.raw.body?.getReader()
  if (!reader) throw new HTTPException(400, { message: 'Vui lòng chọn ảnh để tải lên.' })
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxRequestBytes) {
      await reader.cancel()
      throw new HTTPException(413, { message: 'Ảnh không được lớn hơn 5 MB.' })
    }
    chunks.push(value)
  }
  const request = new Request(context.req.url, { method: 'POST', headers: context.req.raw.headers, body: new Blob(chunks) })
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) || file.size > MAX_IMAGE_SIZE) throw new HTTPException(400, { message: 'Ảnh không hợp lệ hoặc vượt quá 5 MB.' })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const verified = imageMime(bytes)
  if (!verified || verified.mime !== file.type) throw new HTTPException(400, { message: 'Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP hợp lệ.' })
  const key = `${randomId()}.${verified.extension}`
  await context.env.IMAGES.put(key, bytes, { httpMetadata: { contentType: verified.mime }, customMetadata: { verifiedMime: verified.mime } })
  return context.json({ key, url: `/api/images/${key}` }, 201)
})

admin.delete('/uploads/:key', async (context) => {
  await requireRole(context, 'admin')
  const key = context.req.param('key')
  if (!/^[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(key)) throw new HTTPException(400, { message: 'Đường dẫn ảnh không hợp lệ.' })
  const inUse = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM products WHERE image_key = ?').bind(key).first<{ count: number }>()
  if ((inUse?.count ?? 0) > 0) throw new HTTPException(409, { message: 'Ảnh đang được sử dụng bởi món ăn.' })
  await context.env.IMAGES.delete(key)
  return context.json({ message: 'Đã xóa ảnh.' })
})

export default admin