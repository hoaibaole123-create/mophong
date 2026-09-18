// ---------------------------------------------------------------------------
// Cấu hình lưu bản vẽ lên Supabase (tuỳ chọn).
// Bỏ trống -> ứng dụng chỉ lưu trong trình duyệt (localStorage) như trước.
//
// Cách lấy hai giá trị này: vào supabase.com -> dự án của bạn ->
// Project Settings -> API:
//   url = "Project URL"        (dạng https://xxxxxxxx.supabase.co)
//   key = "anon public" key    (KHÔNG dùng service_role key)
//
// Trước khi bật, chạy tệp supabase.sql trong SQL Editor của dự án để tạo bảng.
// ---------------------------------------------------------------------------
window.IALY_CLOUD = {
  url: 'https://hldbpgwwtnpaclstiqar.supabase.co',
  key: 'sb_publishable_7HYfF7pX0OLQIPdxxys9kA_dZa5B77F',
  doc: 'ialy-mo-rong' // tên bản vẽ; đổi tên = một bản vẽ riêng biệt
};
