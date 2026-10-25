import { useEffect, useState } from 'react'
import { Link, Route, Routes, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, ChefHat, Clock3, Minus, Plus, Search, ShoppingBag, Soup, Trash2, Truck, X } from 'lucide-react'
import { z } from 'zod'

type Category = { id: string; name: string; slug: string }
type Product = { id: string; categoryId: string; categoryName: string; name: string; description: string; price: number; imageKey: string | null; isAvailable: number }
type Cart = Record<string, number>
type OrderResult = { orderCode: string; trackingToken: string }

const money = (value: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value)
const readCart = (): Cart => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('food-cart') ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isInteger(entry[1]) && entry[1] > 0 && entry[1] <= 20))
  } catch {
    return {}
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
  const response = await fetch(path, { ...init, headers: { ...(init?.body && !isFormData ? { 'content-type': 'application/json' } : {}), ...init?.headers } })
  const data = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? 'Đã xảy ra lỗi. Vui lòng thử lại.')
  return data
}

export default function App() {
  const [cart, setCart] = useState<Cart>(readCart)
  const [cartOpen, setCartOpen] = useState(false)
  const [categoryId, setCategoryId] = useState('')
  const [search, setSearch] = useState('')
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => api<{ categories: Category[] }>('/api/categories') })
  const storeQuery = useQuery({ queryKey: ['store'], queryFn: () => api<{ deliveryFee: number }>('/api/store') })
  const productsQuery = useQuery({
    queryKey: ['products', categoryId, search],
    queryFn: () => api<{ products: Product[] }>(`/api/products?${new URLSearchParams({ ...(categoryId ? { categoryId } : {}), ...(search ? { q: search } : {}) })}`),
  })
  const cartProductsQuery = useQuery({ queryKey: ['cart-products'], queryFn: () => api<{ products: Product[] }>('/api/products') })
  useEffect(() => localStorage.setItem('food-cart', JSON.stringify(cart)), [cart])
  const products = productsQuery.data?.products ?? []
  const cartProducts = cartProductsQuery.data?.products ?? products
  const deliveryFee = storeQuery.data?.deliveryFee ?? 0
  const cartItems = cartProducts.filter((product) => cart[product.id])
  const itemCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0)
  const subtotal = cartItems.reduce((sum, product) => sum + product.price * cart[product.id], 0)
  const updateQuantity = (id: string, quantity: number) => setCart((current) => {
    const next = { ...current }
    if (quantity < 1) delete next[id]
    else next[id] = Math.min(20, quantity)
    return next
  })

  return <Routes>
    <Route path="/" element={<>
      <header className="topbar">
        <Link className="brand" to="/"><span className="brand-mark"><ChefHat size={21} /></span><span>Bếp Nhà Mình<small>MÓN NGON GIAO TẬN NHÀ</small></span></Link>
        <nav className="desktop-nav"><a href="#thuc-don">Thực đơn</a><Link to="/track">Theo dõi đơn</Link></nav>
        <button className="cart-trigger" aria-label={`Mở giỏ hàng, ${itemCount} món`} onClick={() => setCartOpen(true)}><ShoppingBag size={19} /><span>Giỏ hàng</span>{itemCount > 0 && <b>{itemCount}</b>}</button>
      </header>
      <main>
        <section className="hero">
          <img className="hero-photo" src="https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1800&q=85" alt="Mâm cơm Việt với món ăn tươi ngon" />
          <div className="hero-copy"><p className="eyebrow"><span /> NẤU TƯƠI MỖI NGÀY</p><h1>Bữa cơm nhà,<br /><em>ấm lòng bạn.</em></h1><p>Món Việt thân quen, nấu bằng nguyên liệu tươi và giao đến tận cửa.</p><a className="primary-button" href="#thuc-don">Khám phá thực đơn <ArrowRight size={17} /></a><div className="hero-meta"><span><Clock3 size={15} /> 30–45 phút</span><span><Truck size={16} /> Phí giao {money(deliveryFee)}</span></div></div>
          <div className="hero-stamp"><span>NGON NHƯ</span><strong>CƠM<br />NHÀ</strong><span>♡</span></div>
        </section>
        <section className="menu-section" id="thuc-don">
          <div className="section-heading"><div><p className="eyebrow">BẾP ĐANG LÊN MÓN</p><h2>Hôm nay ăn gì?</h2></div><p className="section-note">Chọn món bạn thích, bếp chuẩn bị thật ngon.</p></div>
          <div className="menu-toolbar">
            <div className="category-tabs" aria-label="Lọc danh mục">
              <button className={!categoryId ? 'selected' : ''} onClick={() => setCategoryId('')}>Tất cả</button>
              {(categoriesQuery.data?.categories ?? []).map((category) => <button key={category.id} className={categoryId === category.id ? 'selected' : ''} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}
            </div>
            <label className="search-field"><Search size={17} /><input aria-label="Tìm món ăn" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm món ăn..." /></label>
          </div>
          {productsQuery.isPending && <div className="menu-state"><span className="loader" />Đang lấy thực đơn từ nhà bếp...</div>}
          {productsQuery.isError && <div className="menu-state error-state"><Soup size={26} /><p>{productsQuery.error.message}</p><button onClick={() => void productsQuery.refetch()}>Thử lại</button></div>}
          {!productsQuery.isPending && !productsQuery.isError && products.length === 0 && <div className="menu-state empty-state"><Soup size={32} /><h3>Hôm nay bếp chưa lên món</h3><p>Thực đơn mới sẽ sớm có mặt ở đây.</p></div>}
          <div className="product-grid">{products.map((product, index) => <article className="product-card" key={product.id} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
            <div className="product-image">{product.imageKey ? <img loading="lazy" src={`/api/images/${product.imageKey}`} alt={product.name} /> : <div className="image-placeholder"><Soup size={34} /><span>VỪA NẤU</span></div>}{!product.isAvailable && <span className="sold-out">Tạm hết</span>}<span className="product-category">{product.categoryName}</span></div>
            <div className="product-details"><div><h3>{product.name}</h3><p>{product.description}</p></div><div className="product-bottom"><strong>{money(product.price)}</strong><button disabled={!product.isAvailable || (cart[product.id] ?? 0) >= 20} aria-label={`Thêm ${product.name} vào giỏ`} onClick={() => updateQuantity(product.id, (cart[product.id] ?? 0) + 1)}><Plus size={19} /></button></div></div>
          </article>)}</div>
        </section>
        <section className="promise-strip"><span><Truck size={18} /> Giao tận nhà</span><span><Check size={18} /> Thanh toán khi nhận</span><span><Soup size={18} /> Nấu mới mỗi ngày</span></section>
      </main>
      <footer className="site-footer"><Link className="brand" to="/"><span className="brand-mark"><ChefHat size={20} /></span><span>Bếp Nhà Mình<small>MÓN NGON GIAO TẬN NHÀ</small></span></Link><p>Ấm bụng như bữa cơm nhà.</p><Link to="/admin">Quản trị</Link></footer>
      {cartOpen && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false) }}><aside className="cart-drawer" aria-label="Giỏ hàng"><div className="drawer-heading"><div><span className="eyebrow">BẾP NHẬN ĐƠN</span><h2>Giỏ của bạn <span>({itemCount})</span></h2></div><button className="icon-button" aria-label="Đóng giỏ hàng" onClick={() => setCartOpen(false)}><X /></button></div>
        {cartItems.length === 0 ? <div className="drawer-empty"><ShoppingBag size={31} /><p>Giỏ còn đang trống</p><button className="text-button" onClick={() => setCartOpen(false)}>Xem thực đơn <ArrowRight size={15} /></button></div> : <><div className="cart-lines">{cartItems.map((product) => <div className="cart-line" key={product.id}><div className="cart-line-copy"><strong>{product.name}</strong><span>{money(product.price)}</span></div><div className="quantity-control"><button aria-label="Giảm số lượng" onClick={() => updateQuantity(product.id, cart[product.id] - 1)}>{cart[product.id] === 1 ? <Trash2 size={15} /> : <Minus size={15} />}</button><span>{cart[product.id]}</span><button aria-label="Tăng số lượng" disabled={cart[product.id] >= 20} onClick={() => updateQuantity(product.id, cart[product.id] + 1)}><Plus size={15} /></button></div></div>)}</div><div className="cart-summary"><div><span>Tạm tính</span><strong>{money(subtotal)}</strong></div><div><span>Giao hàng</span><strong>{money(deliveryFee)}</strong></div><div className="summary-total"><span>Tổng cộng</span><strong>{money(subtotal + deliveryFee)}</strong></div><Link to="/checkout" onClick={() => setCartOpen(false)} className="primary-button checkout-cta">Tiến hành đặt món <ArrowRight size={17} /></Link><p className="cod-note">Thanh toán tiền mặt khi nhận món</p></div></>}
      </aside></div>}
    </>} />
    <Route path="/checkout" element={<CheckoutPage cart={cart} products={cartProducts} deliveryFee={deliveryFee} onSuccess={(result) => { sessionStorage.setItem('food-tracking-token', result.trackingToken); sessionStorage.setItem('food-order-code', result.orderCode); setCart({}) }} />} />
    <Route path="/track" element={<TrackingPage />} />
    <Route path="/admin" element={<AdminPage />} />
    <Route path="*" element={<main className="standalone-page"><h1>Không tìm thấy trang</h1><Link to="/">Về trang chủ <ArrowRight size={16} /></Link></main>} />
  </Routes>
}

const checkoutSchema = z.object({
  customerName: z.string().trim().min(2, 'Vui lòng nhập họ tên.').max(100),
  customerPhone: z.string().trim().regex(/^(\+?84|0)(3|5|7|8|9)\d{8}$/, 'Số điện thoại Việt Nam chưa đúng.'),
  deliveryAddress: z.string().trim().min(8, 'Địa chỉ cần ít nhất 8 ký tự.').max(300),
  customerNote: z.string().max(500),
})

function CheckoutPage({ cart, products, deliveryFee, onSuccess }: { cart: Cart; products: Product[]; deliveryFee: number; onSuccess: (result: OrderResult) => void }) {
  const navigate = useNavigate()
  const mutation = useMutation({ mutationFn: (data: z.infer<typeof checkoutSchema>) => {
    const key = sessionStorage.getItem('food-idempotency-key') ?? crypto.randomUUID().replaceAll('-', '')
    sessionStorage.setItem('food-idempotency-key', key)
    return api<OrderResult>('/api/orders', { method: 'POST', headers: { 'idempotency-key': key }, body: JSON.stringify({ ...data, items: Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity })) }) })
  }, onSuccess: (result) => { sessionStorage.removeItem('food-idempotency-key'); onSuccess(result); navigate('/track?new=1') } })
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const currentProducts = products.filter((product) => cart[product.id])
  const subtotal = currentProducts.reduce((sum, product) => sum + product.price * cart[product.id], 0)
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    const parsed = checkoutSchema.safeParse(values)
    if (!parsed.success) { setErrors(z.flattenError(parsed.error).fieldErrors); return }
    setErrors({})
    mutation.mutate(parsed.data)
  }
  return <main className="standalone-page"><Link className="back-link" to="/"><ArrowLeft size={16} /> Tiếp tục chọn món</Link><div className="checkout-layout"><section><p className="eyebrow">GIAO HÀNG TẬN NƠI</p><h1>Thông tin nhận món</h1><form className="checkout-form" onSubmit={submit} noValidate>
    <label>Họ và tên<input name="customerName" autoComplete="name" required placeholder="Tên người nhận" />{errors.customerName && <small>{errors.customerName[0]}</small>}</label>
    <label>Số điện thoại<input name="customerPhone" type="tel" autoComplete="tel" required placeholder="09xx xxx xxx" />{errors.customerPhone && <small>{errors.customerPhone[0]}</small>}</label>
    <label>Địa chỉ giao hàng<textarea name="deliveryAddress" autoComplete="street-address" required rows={3} placeholder="Số nhà, tên đường, phường/xã, quận/huyện" />{errors.deliveryAddress && <small>{errors.deliveryAddress[0]}</small>}</label>
    <label>Ghi chú cho quán <span className="optional">Không bắt buộc</span><textarea name="customerNote" rows={2} placeholder="Ví dụ: ít cay, gọi trước khi giao" /></label>
    <div className="payment-choice"><span className="payment-icon">₫</span><span><strong>Tiền mặt khi nhận (COD)</strong><small>Thanh toán trực tiếp cho người giao hàng</small></span><Check size={18} /></div>
    {mutation.isError && <p className="form-error" role="alert">{mutation.error.message}</p>}
    <button className="primary-button submit-order" type="submit" disabled={mutation.isPending || !Object.keys(cart).length}>{mutation.isPending ? 'Đang gửi đơn...' : 'Xác nhận đặt hàng'} <ArrowRight size={17} /></button>
  </form></section><aside className="order-summary"><h2>Đơn hàng</h2>{!currentProducts.length ? <p>Giỏ hàng trống. <Link to="/">Chọn món trước nhé.</Link></p> : currentProducts.map((product) => <div className="summary-line" key={product.id}><span>{product.name} <b>× {cart[product.id]}</b></span><strong>{money(product.price * cart[product.id])}</strong></div>)}<div className="summary-line"><span>Tạm tính</span><strong>{money(subtotal)}</strong></div><div className="summary-line"><span>Giao hàng</span><strong>{money(deliveryFee)}</strong></div><div className="summary-line summary-total"><span>Tổng cộng</span><strong>{money(subtotal + (currentProducts.length ? deliveryFee : 0))}</strong></div></aside></div></main>
}

function TrackingPage() {
  const token = sessionStorage.getItem('food-tracking-token')
  const orderCode = sessionStorage.getItem('food-order-code')
  const tracking = useQuery({ queryKey: ['tracked-order', token], enabled: Boolean(token), refetchInterval: 30_000, queryFn: () => api<{ order: { orderCode: string; status: string; paymentStatus: string; total: number; createdAt: string; items: { productName: string; quantity: number; lineTotal: number }[] } }>('/api/orders/track', { headers: { authorization: `Bearer ${token}` } }) })
  const statusLabels: Record<string, string> = { pending: 'Đã nhận đơn', confirmed: 'Quán đã xác nhận', preparing: 'Đang chuẩn bị', delivering: 'Đang giao', completed: 'Đã giao thành công', cancelled: 'Đơn đã hủy' }
  return <main className="standalone-page tracking-page"><Link className="back-link" to="/"><ArrowLeft size={16} /> Về thực đơn</Link><p className="eyebrow">BẾP ĐANG CHĂM ĐƠN</p><h1>Theo dõi đơn hàng</h1>{token && tracking.isPending && <p>Đang kiểm tra trạng thái...</p>}{tracking.isError && <p className="form-error">{tracking.error.message}</p>}{tracking.data && <section className="tracking-card"><div className="tracking-status"><span className="status-check"><Check size={23} /></span><div><span>MÃ ĐƠN {tracking.data.order.orderCode}</span><h2>{statusLabels[tracking.data.order.status] ?? tracking.data.order.status}</h2></div></div><p className="tracking-date">{new Date(tracking.data.order.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</p><div className="tracking-items">{tracking.data.order.items.map((item) => <div key={item.productName}><span>{item.productName} × {item.quantity}</span><strong>{money(item.lineTotal)}</strong></div>)}</div><div className="summary-line"><span>Thanh toán</span><strong>{tracking.data.order.paymentStatus === 'paid' ? 'Đã thanh toán' : 'COD · Khi nhận hàng'}</strong></div><div className="summary-line summary-total"><span>Tổng cộng</span><strong>{money(tracking.data.order.total)}</strong></div></section>}{!token && <div className="tracking-card tracking-empty"><span className="status-check"><Check size={22} /></span><h2>{orderCode ? `Đã gửi đơn ${orderCode}` : 'Chưa có đơn đang theo dõi'}</h2><p>{orderCode ? 'Giữ mã theo dõi an toàn trên thiết bị này để xem cập nhật từ quán.' : 'Sau khi đặt món, bạn có thể theo dõi trạng thái đơn tại đây.'}</p><Link className="primary-button" to="/">Về thực đơn <ArrowRight size={16} /></Link></div>}</main>
}

function AdminPage() {
  const client = useQueryClient()
  const [user, setUser] = useState<{ username: string; role: string } | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'orders' | 'catalog'>('orders')
  const [orderSearch, setOrderSearch] = useState('')
  const [orderStatus, setOrderStatus] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selectedOrder, setSelectedOrder] = useState('')
  const orders = useQuery({
    queryKey: ['admin-orders', orderSearch, orderStatus, fromDate, toDate],
    enabled: Boolean(user),
    queryFn: () => api<{ orders: { id: string; orderCode: string; customerName: string; total: number; status: string; paymentStatus: string; createdAt: string }[] }>(`/api/admin/orders?${new URLSearchParams({ ...(orderSearch ? { q: orderSearch } : {}), ...(orderStatus ? { status: orderStatus } : {}), ...(fromDate ? { from: fromDate } : {}), ...(toDate ? { to: toDate } : {}) })}`),
  })
  const orderDetails = useQuery({
    queryKey: ['admin-order', selectedOrder],
    enabled: Boolean(user && selectedOrder),
    queryFn: () => api<{ order: { orderCode: string; customerName: string; customerPhone: string; deliveryAddress: string; customerNote: string; status: string; total: number; paymentStatus: string; items: { productName: string; quantity: number; lineTotal: number }[] } }>(`/api/admin/orders/${selectedOrder}`),
  })
  useEffect(() => { void api<{ user: { username: string; role: string } }>('/api/admin/auth/me').then((data) => setUser(data.user)).catch(() => undefined) }, [])
  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try { const data = await api<{ user: { username: string; role: string } }>('/api/admin/auth/login', { method: 'POST', body: JSON.stringify(values) }); setUser(data.user) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Đăng nhập thất bại.') }
  }
  const updateStatus = async (id: string, status: string) => {
    try { await api(`/api/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await client.invalidateQueries({ queryKey: ['admin-orders'] }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể cập nhật đơn.') }
  }
  const markPaid = async (id: string) => {
    try { await api(`/api/admin/orders/${id}/payment-status`, { method: 'PATCH', body: JSON.stringify({ paymentStatus: 'paid' }) }); await client.invalidateQueries({ queryKey: ['admin-orders'] }); await client.invalidateQueries({ queryKey: ['admin-order', selectedOrder] }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xác nhận thu tiền.') }
  }
  if (!user) return <main className="standalone-page admin-login"><Link className="back-link" to="/"><ArrowLeft size={16} /> Về cửa hàng</Link><p className="eyebrow">KHU VỰC NHÂN VIÊN</p><h1>Đăng nhập quản trị</h1><form className="checkout-form" onSubmit={(event) => void login(event)}><label>Tên đăng nhập<input name="username" autoComplete="username" required /></label><label>Mật khẩu<input name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button submit-order">Đăng nhập <ArrowRight size={16} /></button></form></main>
  return <main className="standalone-page admin-page">
    <div className="admin-heading"><div><p className="eyebrow">BẾP NHÀ MÌNH · QUẢN TRỊ</p><h1>{tab === 'orders' ? 'Đơn hàng' : 'Thực đơn'}</h1></div><button className="outline-button" onClick={() => void api('/api/admin/auth/logout', { method: 'POST' }).then(() => { setUser(null); setError('') })}>Đăng xuất</button></div>
    <div className="admin-tabs"><button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>Đơn hàng</button><button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>Món & danh mục</button></div>
    {error && <p className="form-error">{error}</p>}
    {tab === 'catalog' ? <CatalogManager canEdit={user.role === 'admin'} onError={setError} /> : <>
      <div className="admin-filters"><input aria-label="Tìm theo mã đơn" placeholder="Tìm mã đơn..." value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} /><select aria-label="Lọc trạng thái" value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)}><option value="">Mọi trạng thái</option>{['pending', 'confirmed', 'preparing', 'delivering', 'completed', 'cancelled'].map((status) => <option key={status} value={status}>{status}</option>)}</select><label>Từ ngày<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label>Đến ngày<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div>
      {orders.isPending && <p>Đang tải đơn hàng...</p>}{orders.isError && <p className="form-error">{orders.error.message}</p>}
      <div className="admin-orders">{(orders.data?.orders ?? []).map((order) => <article className="admin-order" key={order.id}><button className="admin-order-info" onClick={() => setSelectedOrder(selectedOrder === order.id ? '' : order.id)}><strong>#{order.orderCode}</strong><span>{order.customerName} · {money(order.total)}</span><small>{new Date(order.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</small></button><div className="admin-order-actions"><label className="status-select">{order.status}<select aria-label={`Cập nhật trạng thái đơn ${order.orderCode}`} value={order.status} onChange={(event) => void updateStatus(order.id, event.target.value)}><option value={order.status}>{order.status}</option>{({ pending: ['confirmed', 'cancelled'], confirmed: ['preparing', 'cancelled'], preparing: ['delivering', 'cancelled'], delivering: ['completed'], completed: [], cancelled: [] }[order.status] ?? []).map((status) => <option value={status} key={status}>{status}</option>)}</select></label>{user.role === 'admin' && order.status === 'completed' && order.paymentStatus === 'unpaid' && <button className="paid-button" onClick={() => void markPaid(order.id)}>Đã thu COD</button>}</div>{selectedOrder === order.id && orderDetails.data && <div className="order-detail"><p><strong>{orderDetails.data.order.customerName}</strong> · {orderDetails.data.order.customerPhone}</p><p>{orderDetails.data.order.deliveryAddress}</p>{orderDetails.data.order.customerNote && <p>Ghi chú: {orderDetails.data.order.customerNote}</p>}{orderDetails.data.order.items.map((item) => <p key={item.productName}>{item.productName} × {item.quantity} · {money(item.lineTotal)}</p>)}</div>}</article>)}</div>
      {orders.data?.orders.length === 0 && <div className="menu-state empty-state"><ShoppingBag size={28} /><p>Không có đơn nào phù hợp.</p></div>}
    </>}
  </main>
}

type AdminCategory = { id: string; name: string; slug: string; description: string; sortOrder: number; isActive: number }
type AdminProduct = { id: string; categoryId: string; name: string; slug: string; description: string; price: number; imageKey: string | null; isAvailable: number }

function makeSlug(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function CatalogManager({ canEdit, onError }: { canEdit: boolean; onError: (message: string) => void }) {
  const client = useQueryClient()
  const categories = useQuery({ queryKey: ['admin-categories'], queryFn: () => api<{ categories: AdminCategory[] }>('/api/admin/categories') })
  const products = useQuery({ queryKey: ['admin-products'], queryFn: () => api<{ products: AdminProduct[] }>('/api/admin/products') })
  const [editing, setEditing] = useState<AdminProduct | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const saveProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    const payload = { categoryId: String(values.categoryId), name: String(values.name).trim(), slug: String(values.slug).trim(), description: String(values.description), price: Number(values.price), imageKey: String(values.imageKey || '') || null, isAvailable: values.isAvailable === 'on' }
    setSaving(true)
    try {
      await api(`/api/admin/products${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) })
      await client.invalidateQueries({ queryKey: ['admin-products'] })
      setEditing(null)
      setMessage('Đã lưu món ăn.')
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Không thể lưu món ăn.') }
    finally { setSaving(false) }
  }

  const uploadImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadInput = event.currentTarget
    const file = uploadInput.files?.[0]
    if (!file) return
    const form = new FormData()
    form.set('file', file)
    setSaving(true)
    try {
      const result = await api<{ key: string }>('/api/admin/uploads', { method: 'POST', body: form })
      const imageInput = document.querySelector<HTMLInputElement>('#admin-image-key')
      if (imageInput) imageInput.value = result.key
      setMessage('Đã tải ảnh lên.')
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Không thể tải ảnh lên.') }
    finally { setSaving(false); uploadInput.value = '' }
  }

  const saveCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ name: values.name, slug: makeSlug(String(values.name)), description: '', sortOrder: (categories.data?.categories.length ?? 0) + 1, isActive: true }) })
      await client.invalidateQueries({ queryKey: ['admin-categories'] })
      event.currentTarget.reset()
      setMessage('Đã thêm danh mục.')
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Không thể tạo danh mục.') }
  }

  const toggleCategory = async (category: AdminCategory) => {
    try {
      await api(`/api/admin/categories/${category.id}`, { method: 'PUT', body: JSON.stringify({ name: category.name, slug: category.slug, description: category.description ?? '', sortOrder: category.sortOrder, isActive: !category.isActive }) })
      await client.invalidateQueries({ queryKey: ['admin-categories'] })
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Không thể cập nhật danh mục.') }
  }

  const reorderCategory = async (category: AdminCategory, value: string) => {
    const sortOrder = Number(value)
    if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder === category.sortOrder) return
    try {
      await api(`/api/admin/categories/${category.id}`, { method: 'PUT', body: JSON.stringify({ name: category.name, slug: category.slug, description: category.description ?? '', sortOrder, isActive: Boolean(category.isActive) }) })
      await client.invalidateQueries({ queryKey: ['admin-categories'] })
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Không thể sắp xếp danh mục.') }
  }

  if (categories.isPending || products.isPending) return <p>Đang tải thực đơn...</p>
  if (categories.isError || products.isError) return <p className="form-error">Không thể tải danh mục và món ăn.</p>
  return <div className="catalog-manager">
    {message && <p className="success-note">{message}</p>}
    <section className="catalog-section"><div className="catalog-title"><h2>Danh mục</h2>{canEdit && <form className="category-add" onSubmit={(event) => void saveCategory(event)}><input name="name" required maxLength={100} placeholder="Tên danh mục mới" /><button className="outline-button">Thêm</button></form>}</div>
      <div className="category-admin-list">{categories.data.categories.map((category) => <div key={category.id}><span>{category.name}<small>{category.slug}</small></span>{canEdit && <input className="sort-order-input" aria-label={`Thứ tự ${category.name}`} type="number" min="0" defaultValue={category.sortOrder} onBlur={(event) => void reorderCategory(category, event.currentTarget.value)} />}<strong>{category.isActive ? 'Đang hiện' : 'Đang ẩn'}</strong>{canEdit && <button className="outline-button" onClick={() => void toggleCategory(category)}>{category.isActive ? 'Ẩn' : 'Hiện'}</button>}</div>)}</div>
    </section>
    {canEdit && <section className="catalog-section"><div className="catalog-title"><h2>{editing ? 'Sửa món ăn' : 'Thêm món ăn'}</h2>{editing && <button className="outline-button" onClick={() => setEditing(null)}>Hủy sửa</button>}</div>
      <form className="product-admin-form" key={editing?.id ?? 'new-product'} onSubmit={(event) => void saveProduct(event)}>
        <label>Danh mục<select name="categoryId" required defaultValue={editing?.categoryId ?? categories.data.categories[0]?.id ?? ''}>{categories.data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Tên món<input name="name" required maxLength={160} defaultValue={editing?.name ?? ''} onChange={(event) => { const slug = event.currentTarget.form?.elements.namedItem('slug') as HTMLInputElement | null; if (slug && !editing) slug.value = makeSlug(event.currentTarget.value) }} /></label>
        <label>Slug<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={editing?.slug ?? ''} /></label>
        <label>Giá (VND)<input name="price" type="number" required min="0" max="1000000000" step="1000" defaultValue={editing?.price ?? ''} /></label>
        <label className="wide-field">Mô tả<textarea name="description" maxLength={2000} rows={2} defaultValue={editing?.description ?? ''} /></label>
        <label className="wide-field">Ảnh món ăn<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadImage(event)} /><input id="admin-image-key" name="imageKey" type="hidden" defaultValue={editing?.imageKey ?? ''} />{editing?.imageKey && <small>Ảnh hiện tại: {editing.imageKey}</small>}</label>
        <label className="availability-toggle"><input name="isAvailable" type="checkbox" defaultChecked={editing ? Boolean(editing.isAvailable) : true} /> Còn phục vụ</label>
        <button className="primary-button" type="submit" disabled={saving || !categories.data.categories.length}>{saving ? 'Đang lưu...' : editing ? 'Lưu thay đổi' : 'Tạo món ăn'} <Check size={16} /></button>
      </form>
    </section>}
    <section className="catalog-section"><div className="catalog-title"><h2>Món ăn</h2><span>{products.data.products.length} món</span></div><div className="category-admin-list">{products.data.products.map((product) => <div key={product.id}><span>{product.name}<small>{money(product.price)} · {categories.data.categories.find((category) => category.id === product.categoryId)?.name ?? 'Danh mục ẩn'}</small></span><strong>{product.isAvailable ? 'Còn món' : 'Tạm ẩn'}</strong>{canEdit && <><button className="outline-button" onClick={() => setEditing(product)}>Sửa</button><button className="outline-button" onClick={() => void api(`/api/admin/products/${product.id}`, { method: 'DELETE' }).then(() => client.invalidateQueries({ queryKey: ['admin-products'] })).catch((cause) => onError(cause instanceof Error ? cause.message : 'Không thể ẩn món.'))}>Ẩn</button></>}</div>)}</div></section>
  </div>
}