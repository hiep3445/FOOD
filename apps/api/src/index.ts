import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { createOrderCode, createTrackingToken, decryptToken, encryptToken, hashToken, randomId } from './lib/crypto'
import { enforceRateLimit, requestKey } from './lib/security'
import adminRoutes from './routes/admin'
import type { AppEnv } from './types'
import { orderSchema } from './validators/order'

const app = new Hono<AppEnv>()
const MAX_ORDER_TOTAL = 100_000_000
const MAX_JSON_BODY_BYTES = 16_384
const MAX_UPLOAD_BODY_BYTES = 5 * 1024 * 1024 + 65_536

app.use('/api/*', async (context, next) => {
	if (context.req.method !== 'POST' && context.req.method !== 'PUT' && context.req.method !== 'PATCH') return next()
	const maxBytes = context.req.path === '/api/admin/uploads' ? MAX_UPLOAD_BODY_BYTES : MAX_JSON_BODY_BYTES
	const contentLength = Number(context.req.header('content-length') ?? 0)
	if (contentLength > maxBytes) throw new HTTPException(413, { message: 'Dữ liệu gửi lên quá lớn.' })
	const reader = context.req.raw.clone().body?.getReader()
	if (reader) {
		let totalBytes = 0
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			totalBytes += value.byteLength
			if (totalBytes > maxBytes) {
				await reader.cancel()
				throw new HTTPException(413, { message: 'Dữ liệu gửi lên quá lớn.' })
			}
		}
	}
	await next()
})

app.get('/api/health', (context) => context.json({ status: 'ok' }))

app.get('/api/store', (context) => {
	const deliveryFee = Number(context.env.DELIVERY_FEE)
	if (!Number.isSafeInteger(deliveryFee) || deliveryFee < 0) throw new HTTPException(500, { message: 'Cấu hình giao hàng không hợp lệ.' })
	return context.json({ name: context.env.STORE_NAME || 'Bếp Nhà Mình', deliveryFee, timezone: 'Asia/Ho_Chi_Minh', deliveryOnly: true, paymentMethod: 'cod' })
})

app.get('/api/categories', async (context) => {
	const result = await context.env.DB.prepare(
		'SELECT id, name, slug, description, sort_order FROM categories WHERE is_active = 1 ORDER BY sort_order, name',
	).all()
	return context.json({ categories: result.results })
})

app.get('/api/products', async (context) => {
	const categoryId = context.req.query('categoryId')
	const search = context.req.query('q')?.trim().slice(0, 80)
	const conditions = ['c.is_active = 1']
	const values: string[] = []
	if (categoryId) {
		conditions.push('p.category_id = ?')
		values.push(categoryId)
	}
	if (search) {
		conditions.push('(p.name LIKE ? ESCAPE \'\\\' OR p.description LIKE ? ESCAPE \'\\\')')
		const escaped = search.replace(/[\\%_]/g, '\\$&')
		values.push(`%${escaped}%`, `%${escaped}%`)
	}
	const result = await context.env.DB.prepare(
		`SELECT p.id, p.category_id AS categoryId, c.name AS categoryName, p.name, p.slug, p.description, p.price, p.image_key AS imageKey, p.is_available AS isAvailable FROM products p JOIN categories c ON c.id = p.category_id WHERE ${conditions.join(' AND ')} ORDER BY c.sort_order, p.name`,
	).bind(...values).all()
	return context.json({ products: result.results })
})

app.get('/api/products/:id', async (context) => {
	const product = await context.env.DB.prepare(
		'SELECT p.id, p.category_id AS categoryId, c.name AS categoryName, p.name, p.slug, p.description, p.price, p.image_key AS imageKey, p.is_available AS isAvailable FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND c.is_active = 1',
	).bind(context.req.param('id')).first()
	if (!product) throw new HTTPException(404, { message: 'Không tìm thấy món ăn.' })
	return context.json({ product })
})

app.get('/api/images/:key', async (context) => {
	const key = context.req.param('key')
	if (!/^[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(key)) throw new HTTPException(404, { message: 'Không tìm thấy ảnh.' })
	const image = await context.env.IMAGES.get(key)
	if (!image || !image.customMetadata?.verifiedMime) throw new HTTPException(404, { message: 'Không tìm thấy ảnh.' })
	const headers = new Headers()
	image.writeHttpMetadata(headers)
	headers.set('Cache-Control', 'public, max-age=86400, immutable')
	headers.set('X-Content-Type-Options', 'nosniff')
	headers.set('Content-Type', image.customMetadata.verifiedMime)
	if (image.httpEtag) headers.set('ETag', image.httpEtag)
	return new Response(image.body, { headers })
})

app.route('/api/admin', adminRoutes)

app.post('/api/orders', async (context) => {
	await enforceRateLimit(context.env.DB, 'orders', await requestKey(context), 12, 3600)
	if (!context.env.TOKEN_SECRET || context.env.TOKEN_SECRET.length < 32) {
		throw new HTTPException(503, { message: 'Hệ thống chưa sẵn sàng nhận đơn.' })
	}
	const idempotencyKey = context.req.header('idempotency-key')
	if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
		throw new HTTPException(400, { message: 'Thiếu mã yêu cầu đặt hàng hợp lệ.' })
	}
	const rawBody = await context.req.json().catch(() => null)
	const parsed = orderSchema.safeParse(rawBody)
	if (!parsed.success) {
		return context.json({ error: 'Thông tin đặt hàng chưa hợp lệ.', details: z.flattenError(parsed.error).fieldErrors }, 400)
	}
	const input = parsed.data
	const trackingToken = createTrackingToken()
	const tokenHash = await hashToken(trackingToken)
	const trackingTokenCiphertext = await encryptToken(trackingToken, context.env.TOKEN_SECRET)
	const previous = await context.env.DB.prepare(
		'SELECT order_code AS orderCode, tracking_token_ciphertext AS trackingTokenCiphertext FROM orders WHERE idempotency_key = ?',
	).bind(idempotencyKey).first<{ orderCode: string; trackingTokenCiphertext: string }>()
	if (previous) {
		const retryToken = await decryptToken(previous.trackingTokenCiphertext, context.env.TOKEN_SECRET)
		return context.json({ orderCode: previous.orderCode, trackingToken: retryToken }, 200)
	}

	const productIds = input.items.map((item) => item.productId)
	const placeholders = productIds.map(() => '?').join(', ')
	const products = await context.env.DB.prepare(
		`SELECT p.id, p.name, p.price, p.is_available AS isAvailable FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id IN (${placeholders}) AND c.is_active = 1`,
	).bind(...productIds).all<{ id: string; name: string; price: number; isAvailable: number }>()
	const productsById = new Map(products.results.map((product) => [product.id, product]))
	if (productsById.size !== input.items.length) throw new HTTPException(400, { message: 'Có món ăn không còn được phục vụ.' })
	for (const product of productsById.values()) {
		if (!product.isAvailable) throw new HTTPException(409, { message: 'Có món ăn vừa hết hàng.' })
		if (!Number.isSafeInteger(product.price) || product.price < 0) throw new HTTPException(500, { message: 'Không thể tính giá đơn hàng.' })
	}

	const subtotal = input.items.reduce((sum, item) => sum + productsById.get(item.productId)!.price * item.quantity, 0)
	const deliveryFee = Number(context.env.DELIVERY_FEE)
	if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(deliveryFee) || deliveryFee < 0 || subtotal + deliveryFee > MAX_ORDER_TOTAL) {
		throw new HTTPException(400, { message: 'Tổng đơn hàng vượt giới hạn cho phép.' })
	}

	const now = new Date().toISOString()
	const orderId = randomId()
	const orderCode = createOrderCode()
	const statements = [context.env.DB.prepare(
		'INSERT INTO orders (id, order_code, tracking_token_hash, tracking_token_ciphertext, idempotency_key, customer_name, customer_phone, delivery_address, customer_note, subtotal, delivery_fee, total, payment_method, payment_status, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'cod\', \'unpaid\', \'pending\', ?, ?)',
	).bind(orderId, orderCode, tokenHash, trackingTokenCiphertext, idempotencyKey, input.customerName, input.customerPhone, input.deliveryAddress, input.customerNote, subtotal, deliveryFee, subtotal + deliveryFee, now, now)]
	for (const item of input.items) {
		const product = productsById.get(item.productId)!
		statements.push(context.env.DB.prepare(
			'INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)',
		).bind(randomId(), orderId, product.id, product.name, product.price, item.quantity, product.price * item.quantity))
	}
	try {
		await context.env.DB.batch(statements)
	} catch {
		const duplicate = await context.env.DB.prepare(
			'SELECT order_code AS orderCode, tracking_token_ciphertext AS trackingTokenCiphertext FROM orders WHERE idempotency_key = ?',
		).bind(idempotencyKey).first<{ orderCode: string; trackingTokenCiphertext: string }>()
		if (duplicate) {
			const retryToken = await decryptToken(duplicate.trackingTokenCiphertext, context.env.TOKEN_SECRET)
			return context.json({ orderCode: duplicate.orderCode, trackingToken: retryToken }, 200)
		}
		throw new HTTPException(503, { message: 'Chưa thể lưu đơn hàng. Vui lòng thử lại.' })
	}
	return context.json({ orderCode, trackingToken }, 201)
})

app.get('/api/orders/track', async (context) => {
	const authorization = context.req.header('authorization')
	const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
	if (!/^[a-f0-9]{64}$/.test(token)) throw new HTTPException(401, { message: 'Mã theo dõi không hợp lệ.' })
	const tokenHash = await hashToken(token)
	const order = await context.env.DB.prepare(
		'SELECT id, order_code AS orderCode, subtotal, delivery_fee AS deliveryFee, total, payment_method AS paymentMethod, payment_status AS paymentStatus, status, created_at AS createdAt, updated_at AS updatedAt FROM orders WHERE tracking_token_hash = ?',
	).bind(tokenHash).first<{ id: string }>()
	if (!order) throw new HTTPException(404, { message: 'Không tìm thấy đơn hàng.' })
	const items = await context.env.DB.prepare(
		'SELECT product_name AS productName, unit_price AS unitPrice, quantity, line_total AS lineTotal FROM order_items WHERE order_id = ?',
	).bind(order.id).all()
	return context.json({ order: { ...order, items: items.results } })
})

app.notFound((context) => context.json({ error: 'Không tìm thấy đường dẫn.' }, 404))
app.onError((error, context) => {
	const status = error instanceof HTTPException ? error.status : 500
	if (!(error instanceof HTTPException)) {
		console.error(JSON.stringify({ event: 'api_error', path: context.req.path, method: context.req.method, name: error.name }))
	}
	return context.json({ error: error instanceof HTTPException ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.' }, status)
})

export default app