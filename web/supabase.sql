-- Chạy tệp này một lần trong Supabase -> SQL Editor.
-- Bảng giữ TOÀN BỘ phần vẽ thêm và phần sửa đối tượng gốc của một bản vẽ,
-- mỗi bản vẽ là một dòng (doc = tên bản vẽ đặt trong web/config.js).

create table if not exists ialy_thiet_ke (
  doc         text primary key,
  du_lieu     jsonb not null default '{}'::jsonb,
  cap_nhat_luc timestamptz not null default now()
);

alter table ialy_thiet_ke enable row level security;

-- CẢNH BÁO: hai chính sách dưới đây cho phép BẤT KỲ AI có khoá anon
-- (khoá này nằm trong mã nguồn trang web, tức là công khai) đọc và ghi bản vẽ.
-- Chỉ dùng khi ứng dụng chạy trong mạng nội bộ.
-- Muốn chặt chẽ hơn: bật Supabase Auth rồi đổi "using (true)" thành
-- "using (auth.role() = 'authenticated')".
drop policy if exists ialy_doc on ialy_thiet_ke;
create policy ialy_doc  on ialy_thiet_ke for select using (true);

drop policy if exists ialy_ghi on ialy_thiet_ke;
create policy ialy_ghi  on ialy_thiet_ke for insert with check (true);

drop policy if exists ialy_sua on ialy_thiet_ke;
create policy ialy_sua  on ialy_thiet_ke for update using (true) with check (true);
