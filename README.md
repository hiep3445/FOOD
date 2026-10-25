# Bếp Nhà Mình

Ứng dụng đặt món COD cho một cửa hàng, triển khai bằng React, Vite, Hono, Cloudflare Workers, D1 và R2.

## Cấu hình mặc định

- Tên cửa hàng: **Bếp Nhà Mình**.
- Phí giao hàng: **20.000 VND**.
- Chỉ giao hàng tận nơi, thanh toán COD.
- Ảnh lưu trong bucket R2 `food-ordering-images`.
- Múi giờ hiển thị: `Asia/Ho_Chi_Minh`.

Các giá trị cấu hình cửa hàng nằm trong `wrangler.jsonc`; có thể thay đổi trước khi chạy hoặc triển khai.

## Môi trường

- Node.js 22 trở lên và npm.
- Wrangler 4 được cài khóa trong dependencies; không cần cài global.
- Tài khoản Cloudflare chỉ cần khi tạo tài nguyên thật hoặc deploy.

## Cài và chạy local

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

Vite chạy tại `http://localhost:5173`, Worker tại `http://localhost:8787`; Vite proxy `/api` tới Worker. Tạo secret local trước khi nhận đơn trong `.dev.vars` (file đã được Git ignore):

```powershell
TOKEN_SECRET=<chuoi-ngau-nhien-it-nhat-32-ky-tu>
ADMIN_BOOTSTRAP_SECRET=<chuoi-ngau-nhien-it-nhat-32-ky-tu>
PUBLIC_ORIGIN=http://localhost:5173
```

Có thể tạo chuỗi ngẫu nhiên bằng PowerShell:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Chạy kiểm tra bằng `npm run typecheck`, `npm run test`, `npm run build` và `npm audit`.

## Database và ảnh local

`wrangler.jsonc` khai báo D1 `food-ordering` và R2 binding `IMAGES`. D1 local được giả lập bởi Wrangler, không cần Cloudflare account. Migration `0004_starter_menu.sql` thêm 10 món Việt mặc định thuộc 3 danh mục; hãy sửa giá, mô tả và món trong quản trị cho đúng thực đơn thực tế của quán.

```powershell
npm run db:local
```

R2 local được giả lập khi chạy Worker. Không có tài khoản admin mặc định; bootstrap tài khoản theo hướng dẫn bên dưới.

Mười ảnh minh họa hiện được nạp vào R2 local và liên kết với các món trong database local. Ảnh không nằm trong migration hay bucket production; khi triển khai thật, tải ảnh của quán lên bằng trang quản trị rồi gán cho món tương ứng. Nguồn ảnh minh họa:

- 1 ảnh món ăn từ Unsplash Images, sử dụng theo Unsplash License: https://unsplash.com/license.
- Ảnh cơm gà nướng, “Cơm gà sườn nướng, ng23th8n2022 (Đùi gà nướng) (2)”, tác giả Phương Huy, CC0: https://commons.wikimedia.org/wiki/File:C%C6%A1m_g%C3%A0_s%C6%B0%E1%BB%9Dn_n%C6%B0%E1%BB%9Bng,_ng23th8n2022_(%C4%90%C3%B9i_g%C3%A0_n%C6%B0%E1%BB%9Bng)_(2).jpg.
- Ảnh cơm sườn trứng, “Cơm tấm Sài Gòn (sườn trứng), ng15th8n2022”, tác giả Phương Huy, CC BY-SA 4.0: https://commons.wikimedia.org/wiki/File:C%C6%A1m_t%E1%BA%A5m_S%C3%A0i_G%C3%B2n_(s%C6%B0%E1%BB%9Dn_tr%E1%BB%A9ng),_ng15th8n2022.jpg.
- Ảnh bún bò Huế, “Bun Bo Hue - Spicy Noodle”, tác giả avlxyz, CC BY-SA 2.0: https://commons.wikimedia.org/wiki/File:Bun_Bo_Hue_-_Spicy_Noodle.jpg.
- Ảnh bún thịt nướng, “Bun thit nuong”, tác giả Lưu Ly, public domain: https://commons.wikimedia.org/wiki/File:Bun_thit_nuong.jpg.
- Ảnh phở bò, “Phở bò, Cầu Giấy, Hà Nội”, tác giả Codename5281, CC BY-SA 3.0: https://commons.wikimedia.org/wiki/File:Ph%E1%BB%9F_b%C3%B2,_C%E1%BA%A7u_Gi%E1%BA%A5y,_H%C3%A0_N%E1%BB%99i.jpg.
- Ảnh thịt kho trứng, “Caramelized Pork and Eggs”, tác giả Kingofthepings, CC BY-SA 3.0: https://commons.wikimedia.org/wiki/File:Caramelized_Pork_and_Eggs.jpg.
- Ảnh gỏi cuốn, “Spring rolls with peanut sauce”, tác giả T. Tseng, CC BY 2.0: https://commons.wikimedia.org/wiki/File:Spring_rolls_with_peanut_sauce.jpg.
- Ảnh chả giò, “Chả giò (Vietnamese Spring Rolls) - 07”, tác giả Satdeep Gill, CC BY-SA 4.0: https://commons.wikimedia.org/wiki/File:Ch%E1%BA%A3_gi%C3%B2_(Vietnamese_Spring_Rolls)_-_07.jpg.
- Ảnh canh chua cá diêu hồng, tác giả Phương Huy, public domain: https://commons.wikimedia.org/wiki/File:Canh_chua_c%C3%A1_di%C3%AAu_h%E1%BB%93ng.jpg.

## Bootstrap admin

Tạo secret riêng bằng lệnh PowerShell bên trên và nhập chúng vào `.dev.vars`; không để trống hai secret, không dùng giá trị ví dụ. Sau khi chạy app, gửi một lần request cùng secret header; thay giá trị prompt bằng secret local của bạn, không commit hoặc ghi nó vào script:

```powershell
$bootstrap = Read-Host "Bootstrap secret"
$password = Read-Host "Mat khau admin (it nhat 12 ky tu)"
$body = @{ username = "admin"; password = $password } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:8787/api/admin/auth/bootstrap -Headers @{ "x-bootstrap-secret" = $bootstrap; Origin = "http://localhost:5173" } -ContentType "application/json" -Body $body
```

Bootstrap chỉ tạo user khi chưa có user nào và giới hạn request. Tạo tài khoản xong, xóa dòng `ADMIN_BOOTSTRAP_SECRET` khỏi `.dev.vars` rồi đăng nhập tại `/admin`. Mật khẩu tối thiểu 12 ký tự; không có mật khẩu admin mặc định.

## Tạo tài nguyên Cloudflare

Đăng nhập đúng tài khoản bằng `npx wrangler login`, sau đó tạo D1 và R2:

```powershell
npx wrangler d1 create food-ordering
npx wrangler r2 bucket create food-ordering-images
```

Sao chép `database_id` Cloudflare trả về vào `wrangler.jsonc` thay cho `REPLACE_WITH_REAL_D1_DATABASE_ID`. Tên bucket trong config phải khớp bucket vừa tạo. Không dùng ID giả, không bật ghi công khai cho R2.

## Migration và secrets production

Chỉ chạy các bước sau sau khi đã xác nhận tài khoản, database ID, bucket và môi trường production:

```powershell
npx wrangler d1 migrations apply food-ordering --remote
npx wrangler secret put TOKEN_SECRET
npx wrangler secret put ADMIN_BOOTSTRAP_SECRET
npx wrangler secret put PUBLIC_ORIGIN
```

Wrangler sẽ yêu cầu nhập secret trực tiếp trong terminal. Dùng giá trị ngẫu nhiên riêng cho production; không tái sử dụng `.dev.vars`. Sau lần bootstrap admin production đầu tiên, gỡ `ADMIN_BOOTSTRAP_SECRET` bằng `npx wrangler secret delete ADMIN_BOOTSTRAP_SECRET`.

## Build và deploy

`npm run build` build frontend vào `apps/web/dist`; Wrangler phục vụ static assets và chuyển các route `/api/*` tới Worker.

```powershell
npm run build
npx wrangler deploy
```

Không chạy migration remote hoặc deploy nếu chưa kiểm tra lại Cloudflare account, D1 ID, bucket, domain và secrets. Health endpoint: `GET /api/health`.

## Cấu hình

- `wrangler.jsonc`: tên Worker, binding và biến không nhạy cảm `STORE_NAME`, `DELIVERY_FEE` (VND), `SESSION_TTL_HOURS`.
- Secrets Worker: `TOKEN_SECRET`, `ADMIN_BOOTSTRAP_SECRET`, `PUBLIC_ORIGIN`.
- Cửa hàng duy nhất, giao hàng tận nơi, COD; không tích hợp thanh toán online.
- Các mốc thời gian lưu UTC; UI hiển thị `Asia/Ho_Chi_Minh`.

## Windows PowerShell

- Dùng `Copy-Item` để tạo `.dev.vars`; file này không được commit.
- D1 migration local của Wrangler có thể hỏi xác nhận tương tác. Chỉ xác nhận khi lệnh có cờ `--local` và tên D1 đúng.
- Nếu `npm` chặn script PowerShell, chạy `npm.cmd` với cùng tham số.
- Chạy local bằng `npm run dev`; frontend và Worker là hai tiến trình riêng.