# Đưa ứng dụng lên Vercel

Ứng dụng là trang tĩnh (HTML + JS + dữ liệu), không có máy chủ riêng, nên gói
Hobby miễn phí của Vercel là đủ.

## Cách nhanh nhất (một lệnh)

```bash
npx vercel deploy --prod
```

Lần đầu sẽ hỏi đăng nhập (email/GitHub) và hỏi tên dự án — chọn mặc định là được.
`vercel.json` ở thư mục gốc đã khai báo sẵn:

- `outputDirectory: "web"` — chỉ thư mục `web/` được đưa lên (5,6 MB).
- `index.html` đặt `no-cache` — bản mới luôn được nạp, không phải Ctrl+F5.
- `app.js`, `vendor/` cache một năm (đã có `?v=` để đổi bản).
- `data/` cache một giờ.

## Nếu muốn deploy từ GitHub

1. Đẩy mã lên một repo.
2. Vercel → New Project → chọn repo đó → Framework Preset: **Other** → Deploy.
3. Mỗi lần push là Vercel tự dựng lại.

## Lưu ý

- Dữ liệu thiết kế vẫn nằm ở Supabase, không đổi gì. `web/config.js` chỉ chứa
  khoá publishable (khoá công khai, chỉ đọc/ghi theo RLS) nên đưa lên được.
- Trang chạy HTTPS nên **khoá chuột (pointer lock)** ở chế độ đi bộ ổn định hơn
  khi chạy ở `localhost`.
