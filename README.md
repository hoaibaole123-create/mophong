# Mô phỏng 3D vị trí bình chữa cháy — Thuỷ điện Ialy mở rộng (2×180MW)

Ứng dụng web 3D đọc trực tiếp từ bản vẽ `mặt bằng và vị trí các bình chữa cháy.pdf`
(ANDRITZ HYDRO / EVNPMB2, bản vẽ IALY-P40-AH-300-LAY-SGA-DG-1932-DI), dựng lại
11 cao trình của nhà máy và **224 bình chữa cháy** đúng vị trí trên mặt bằng.

## Chạy ứng dụng

Nhấp đúp `start.bat` (cần đã cài Python), hoặc:

```bash
cd web && python -m http.server 8765
```

rồi mở http://localhost:8765/ . Ứng dụng chạy hoàn toàn ngoại tuyến
(thư viện three.js đã nằm trong `web/vendor/`).

## Trong ứng dụng

| Thao tác | Kết quả |
|---|---|
| Chuột trái kéo | Xoay mô hình |
| Chuột phải kéo | Di chuyển |
| Lăn chuột | Phóng to / thu nhỏ |
| Bấm vào một bình | Hiện thẻ thông tin: mã, loại, cao trình, phòng, toạ độ |
| Bấm tên cao trình | Chỉ hiện cao trình đó và bay tới |
| Biểu tượng 👁 | Bật/tắt thêm từng cao trình (xem nhiều tầng cùng lúc) |
| Hiện tất cả | Quay lại xem toàn bộ 11 cao trình |
| Ô tìm kiếm | Lọc theo mã bình (FE-001…), tên phòng (P601, CT.1…) hoặc loại bình |
| Tường / sàn | Bật/tắt sàn, tường bao, vách ngăn, ô cửa |
| Tủ, thiết bị | Bật/tắt khối tủ điện / thiết bị (màu xanh thép, cao 2 m) |
| Độ mờ khối nhà | Chỉnh độ trong của tường/sàn để nhìn xuyên vào trong |
| Nền giấy trắng | Đổi giữa nền tối (nét sáng) và nền giấy trắng như bản vẽ gốc |
| Xuất CSV | Tải danh sách 224 bình kèm toạ độ |

## Tab "Thiết kế" — tự vẽ thêm vào bản vẽ

Chuyển sang tab **Thiết kế** ở đầu bảng điều khiển. Mọi thứ vẽ ra được đặt lên
**cao trình đang chọn** (đổi tầng ở tab *Xem*).

| Công cụ | Phím | Thao tác |
|---|---|---|
| 🖱 Chọn / xoá | `1` | Bấm vào **bất kỳ tường, tủ thiết bị hay khối tự vẽ nào** → chuyển vàng, ô *Đối tượng đang chọn* hiện tên. Xoá bằng `Delete`, `Backspace` hoặc nút 🗑; `Esc` bỏ chọn |
| 🧱 Vẽ tường | `2` | Giữ chuột trái kéo trên mặt sàn; tự bắt phương ngang/dọc, lưới 5 cm |
| 📦 Khối hộp thiết bị | `3` | Kéo một hình chữ nhật → khối hộp |
| ⚡ Máy biến áp | `4` | Kéo khung chân máy → dựng **mô hình máy biến áp**: thùng dầu, bệ, 5 cánh tản nhiệt mỗi bên, bình dầu phụ nằm ngang và 3 sứ cao thế |
| 🧯 Bình chữa cháy | `5` | Bấm một điểm để đặt thêm bình |
| 🛡 Lan can | `6` | Kéo theo tuyến lan can → tay vịn + thanh giữa + trụ cách nhau ~1,2 m (cao 1,1 m, chỉnh được) |
| 🪜 Cầu thang | `7` | Kéo từ **chân thang tới đỉnh thang** → bậc thang + tay vịn hai bên. Bề rộng lấy ở ô *Bề rộng cầu thang*; chiều cao lấy ô *Chiều cao tường*, để 0 là thang lên đúng cao trình kế tiếp |

Cầu thang dựng theo chiều cao tầng đang hiển thị, nên khi để **Giãn cách tầng > 1**
thang sẽ dốc hơn thực tế — kéo thanh đó về **1,0** là thấy đúng độ dốc thật.

Kích thước nhập ở các ô **Bề dày tường / Chiều cao tường / Chiều cao khối /
Chiều cao lan can / Bề rộng cầu thang**
(chiều cao tường = 0 → cao hết tầng). Trong lúc kéo, ứng dụng hiện ngay
chiều dài · bề dày (hoặc rộng × sâu × cao) bằng mét.

### Sửa trực tiếp đối tượng bóc từ bản vẽ

Không chỉ sửa được thứ mình vẽ: bấm vào **tường hoặc tủ thiết bị mà chương trình
bóc ra từ bản vẽ** cũng chọn được (ví dụ *"Tường #78 — EL. 339.10"*). Khi đó ô
*Đối tượng đang chọn* có hai nút:

- **🗑 Xoá** — bỏ hẳn bức tường / khối đó khỏi mô hình (dùng khi máy nhận nhầm).
  Một bức tường trên bản vẽ có thể bị bóc thành 2–3 khối chồng lên nhau, nên khi
  xoá, mọi khối trùng trên 60 % diện tích cũng bị xoá theo — không còn cảnh xoá
  xong tường vẫn nguyên.
- **→ Đổi thành tủ/thiết bị** hoặc **→ Đổi thành tường** — sửa lại phân loại sai,
  khối sẽ dựng lại ngay với chiều cao và màu của loại mới
- **✥ Tách ra để sửa** — biến khối bóc từ bản vẽ thành đối tượng tự vẽ, sau đó
  kéo để di chuyển và xoay tuỳ ý

**Bình chữa cháy và cánh cửa cũng chọn và xoá được.** Khi bình nằm sát tường thì
bình được ưu tiên, không bị tường phía sau giành mất.

### Mặt bằng 2D — cách vẽ dễ nhất

Vẽ trong khung nhìn 3D rất khó canh vì phối cảnh làm lệch tay. Bấm nút
**◳ Mặt bằng 2D** (hoặc phím **P**) trong tab *Thiết kế*:

- Camera đổi sang **chiếu song song, nhìn vuông góc từ trên xuống** — không còn phối cảnh,
  kéo ngang trên màn hình là ra tường ngang, đúng như vẽ trên giấy.
- **Khoá xoay**: chuột trái chỉ để vẽ, không lỡ tay xoay cảnh nữa. Lăn chuột = phóng to,
  chuột phải = kéo màn hình.
- Chỉ hiện đúng cao trình đang vẽ, nét bản vẽ để rõ nhất, tường 3D mờ bớt để thấy nét dưới.

Bấm nút lần nữa (hoặc rời tab *Thiết kế*) để quay lại nhìn 3D. Khi thoát, chương trình
**trả lại đúng cài đặt hiển thị trước đó** — danh sách cao trình đang hiện, độ mờ bản vẽ và
độ mờ tường — nên chế độ vẽ không làm xáo trộn chế độ xem.

Ảnh bản vẽ mặt bằng **mặc định TẮT**. Muốn xem thì bấm nút **Bản vẽ mặt bằng** ở tab *Xem*.

Nút này **bật/tắt hẳn** ảnh, không phải chỉnh độ mờ — tắt rồi thì kéo thanh *Độ mờ bản vẽ*
cũng không làm nó hiện lại. Lựa chọn được **nhớ trong trình duyệt**: đã bật thì lần sau mở
trang vẫn bật, chưa bật bao giờ thì luôn tắt. Nút ghi rõ trạng thái *"(đang tắt)"*.

### Đi lại trong mô hình bằng phím mũi tên

- **← → ↑ ↓** dời góc nhìn theo mặt phẳng ngang, theo đúng hướng đang nhìn.
- **PageUp / PageDown** nâng hoặc hạ cao độ góc nhìn.
- **Shift** + các phím trên = bước dài gấp ba.
- Bước dời tự co giãn theo tầm nhìn: phóng to thì đi chậm, nhìn xa thì đi nhanh.

### Vẽ cửa đi

Công cụ **🚪 Cửa đi** (phím **9**). Vẽ **bề rộng ô cửa dọc theo tường**: bấm mép này,
rê sang mép kia, bấm chốt (hướng tự khoá về bội số 15° như khi vẽ tường).

Ba loại trong ô **Loại cửa**:

| Loại | Mô hình dựng ra |
|---|---|
| **Cửa đơn** | khuôn cửa + một cánh mở 90°, có tay nắm |
| **Cửa đôi** | khuôn cửa + hai cánh, mỗi cánh nửa ô, mở 90° về cùng phía |
| **Cửa cuốn** | thân cửa gồm các nan ngang + trục cuốn nằm trên lanh tô |

Ô **Cửa mở sang** chọn bên trái / bên phải; ô **Chiều cao cửa** mặc định 2,1 m;
ô **Cao độ chân** dùng khi cửa nằm ở tường phía trên.

**Cửa khoét thủng tường thật**, cả hai loại tường:

- Tường **tự vẽ**: tường tự tách thành các mảng đặc, chừa ô cửa và **để lại lanh tô** phía trên.
- Tường **bóc từ bản vẽ PDF**: cửa tự vẽ được đưa vào cùng danh sách cửa của khối nhà,
  nên cũng khoét ô và chừa lanh tô y như cửa có sẵn trên bản vẽ.

Cửa được nhận là "thuộc" một bức tường khi nó gần như song song với tường (lệch dưới 15°)
và tim cửa cách tim tường không quá nửa bề dày + 0,8 m. Vẽ lệch xa hơn thì cửa vẫn dựng
nhưng tường không bị khoét — lúc đó kéo cửa lại sát tường (công cụ Chọn, kéo để di chuyển).

### Mái nhà và tường ở cao độ trên

- Công cụ **🏠 Mái bê tông** (phím **8**): kéo khung chữ nhật như vẽ khối hộp. Mái dựng ra là
  **bê tông cốt thép đổ tại chỗ**, không phải mái ngói / mái tôn.
  - Ô **cao đỉnh = 0** → **đổ mê bê tông (mái bằng)**: bản mê dày 15 cm, **dầm biên** 22×35 cm
    chạy dưới mép bản và **gờ chắn mái** cao 30 cm quanh chu vi.
  - Ô **cao đỉnh > 0** → **mái dốc BTCT hai mái**, sống mái chạy theo cạnh dài, có dầm biên ở chân mái.
  - **Mái tự gác lên đỉnh tường**, không nằm dưới sàn: để ô *Cao độ chân* = 0 thì chương trình
    tự tìm tường tự vẽ nằm trong khung mái và đặt mái lên bức cao nhất; không có tường nào
    thì lấy đúng chiều cao tầng (chiều cao tầng trừ bề dày sàn). Cao độ chọn được ghi luôn
    vào tên mái, ví dụ *"Mái 6 (+4.0)"*, và vẫn sửa lại được ở ô *Cao độ chân*.
  - Ô **Mái: cao đỉnh** = 0 → **mái bằng** (tấm phẳng dày 18 cm).
  - Lớn hơn 0 → **mái dốc hai mái**, sống mái tự chạy theo **cạnh dài** của khung,
    có đủ hai mái dốc, hai đầu hồi và đường viền mép mái.
- Ô **Cao độ chân (m, so với sàn)** áp dụng cho **tường, khối hộp, máy biến áp,
  lan can và mái**: đặt 3,5 chẳng hạn thì vật nằm lơ lửng cao 3,5 m so với sàn của
  cao trình đó — dùng để dựng tường lửng phía trên, tường thu hồi đỡ mái, hay mái
  đặt trên đỉnh tường.
- Tên vật tự ghi kèm cao độ, ví dụ *"Tường 4 (cao độ +6)"*, để khỏi lẫn với tường dưới sàn.
- **Cẩn thận với ô này**: nó giữ nguyên giá trị cho lần vẽ sau. Đặt 5 để dựng tường lửng rồi
  quên đưa về 0 thì mọi thứ vẽ tiếp — tường, cửa, lan can — đều **treo lơ lửng 5 m trên sàn**.
  Nay có ba lớp chặn: (1) dòng cảnh báo vàng hiện ngay dưới ô khi giá trị khác 0;
  (2) đổi cao trình thì ô tự về 0; (3) nút **⤓ Hạ cao trình này về sàn** trong tab *Thiết kế*
  hạ toàn bộ vật đang treo của cao trình đang chọn xuống sàn (có hỏi xác nhận, hoàn tác được).

### Cách vẽ: hai lần bấm

Chọn công cụ, **bấm một lần** để đặt điểm đầu, **rê chuột** (không cần giữ nút) —
khối xem trước bám theo con trỏ và hiện luôn kích thước — rồi **bấm lần nữa** để
chốt. **Esc** huỷ nét đang vẽ. Kiểu cũ (giữ chuột và kéo) vẫn dùng được.

### Bộ nhớ và nhiều tab

Bản vẽ thêm lưu trong **localStorage của trình duyệt**, theo đúng địa chỉ đang mở
(`http://localhost:8765`). Vì vậy:

- Đổi cổng, mở bằng `file://`, đổi trình duyệt hay cửa sổ ẩn danh → **kho khác, bản vẽ khác**.
- Nhiều tab cùng địa chỉ **dùng chung một kho**; các tab tự cập nhật cho nhau ngay
  khi một tab lưu (qua sự kiện `storage`), không phải tải lại trang.
- Muốn mang sang máy khác hoặc sang trình duyệt khác: **Xuất JSON** rồi **Nạp JSON**,
  hoặc bật đồng bộ Supabase ở mục dưới.

### Lưu chung qua Supabase (tuỳ chọn)

Muốn nhiều người cùng thấy một bản vẽ, hoặc mở ở máy nào cũng có:

1. Tạo dự án trên [supabase.com](https://supabase.com).
2. Mở **SQL Editor**, dán toàn bộ `web/supabase.sql` rồi chạy — tạo bảng `ialy_thiet_ke`.
3. Vào **Project Settings → API**, chép **Project URL** và khoá **anon public**.
4. Dán vào `web/config.js`:

```js
window.IALY_CLOUD = {
  url: 'https://xxxxxxxx.supabase.co',
  key: 'eyJhbGciOi...',      // anon public key, KHÔNG dùng service_role
  doc: 'ialy-mo-rong'        // đổi tên = một bản vẽ riêng biệt
};
```

Ứng dụng gọi thẳng REST API bằng `fetch`, **không cần cài thư viện**. Cách chạy:

- Mở trang → tải bản mới nhất từ đám mây.
- Vẽ / xoá / sửa → **chỉ lưu trong máy**, nút lưu đổi thành **● Lưu thay đổi**.
  Đám mây chỉ được cập nhật khi bạn **bấm nút đó** — làm xong cả loạt việc rồi lưu một lần.
- Cứ 15 giây lấy thay đổi của người khác về; ai lưu sau thì bản của người đó là bản hiện hành.
- Nếu bản trong máy khác bản trên đám mây mà bạn **chưa bấm Lưu**, ứng dụng **không đè lên
  việc của bạn**: nó báo *"Bản trên máy khác với đám mây"* và hiện nút **⤓ Lấy bản đám mây**
  để bạn tự chọn bỏ việc đang làm mà lấy bản chung về.
- localStorage vẫn giữ một bản sao, nên **mất mạng vẫn vẽ được**; trạng thái hiện ở dòng
  **☁** cuối tab *Thiết kế* (`Đã đồng bộ`, `Đang lưu…`, `Không kết nối được: …`).
- Để trống `url`/`key` → chạy y như cũ, chỉ lưu trong trình duyệt.

**Sao lưu tự động:** trước mỗi lần ghi đè, bản đang có trên đám mây được chép sang một dòng
lịch sử `<tên>#<thời điểm>`. Nút **⟲ Bản lưu trước** trong tab *Thiết kế* liệt kê 15 bản gần
nhất kèm số vật thể, chọn số thứ tự là lấy lại được — dùng khi lỡ tay lưu đè hoặc lưu nhầm
bản trống. Lấy về xong phải bấm **● Lưu thay đổi** mới chốt lên đám mây.

**Lưu ý an toàn:** khoá anon nằm trong mã nguồn trang web nên ai mở được trang cũng
sửa được bản vẽ. Chỉ nên dùng trong mạng nội bộ. Muốn chặt hơn thì bật Supabase Auth
và sửa chính sách RLS trong `supabase.sql` (`using (auth.role() = 'authenticated')`).

### Máy biến áp: chỉnh chiều cao, phóng to vẫn đúng hình

Máy biến áp có ô riêng **Chiều cao máy biến áp (m)** (mặc định 3,2 m), không dùng chung với
chiều cao khối hộp nữa. Chọn máy rồi sửa ô này, bấm **Lưu** hoặc **✓ Áp dụng số đo** là đổi ngay.

Mô hình dựng theo **kích thước thật của từng chi tiết**, không co giãn cả cụm theo khung:
khi máy to lên thì **số lượng** chi tiết tăng, còn từng chi tiết vẫn giữ cỡ thật.

| Chi tiết | Quy tắc |
|---|---|
| Bánh xe | Ø24–56 cm, cứ ~2,5 m chiều dài thùng thêm một cặp |
| Gân đứng thùng dầu | ~1,2 m một gân, dày 6–14 cm |
| Cánh tản nhiệt | ~0,32 m một cánh, dày 5–12 cm, nhô ra 25–70 cm |
| Sứ cao/hạ thế | luôn 3 + 3; cao 0,5–1,6 m, số tán theo chiều cao (mỗi tán ~12 cm) |
| Bình dầu phụ | bán kính 18–55 cm, nằm dọc cạnh dài |
| Bộ đổi nấc, hộp đấu dây, móc cẩu | 18–45 cm |

Đo thử ba cỡ máy (2,0×1,3×2,2 m · 3,2×2,0×3,2 m · 7,0×4,5×6,5 m): bánh xe Ø24 → Ø29 → Ø56 cm
(không phình theo tỉ lệ), số cánh tản nhiệt 14 → 14 → 30, tổng chi tiết 99 → 105 → 165.

### Sửa số đo của vật đã vẽ

Chọn một vật (công cụ *Chọn/xoá*) → các ô trong mục **Kích thước** **tự nhảy về đúng số đo
của vật đó**. Sửa số rồi bấm **Lưu** (hoặc nút **✓ Áp dụng số đo** trong ô *Đối tượng đang
chọn*) là vật đổi theo ngay.

Áp dụng cho: bề dày và chiều cao tường · chiều cao khối hộp / máy biến áp · chiều cao lan can ·
bề rộng cầu thang · cao đỉnh mái · chiều cao, loại và hướng mở của cửa · cao độ chân của mọi loại.
Đổi loại cửa (đơn ↔ đôi ↔ cuốn) cũng làm theo cách này. Mọi thay đổi số đo đều **hoàn tác được
bằng Ctrl+Z**.

### Di chuyển, xoay, bắt nét

- **Di chuyển:** công cụ *Chọn/xoá*, bấm giữ trên đối tượng tự vẽ rồi kéo.
- **Xoay:** ba nút **⟲ 15° · ⟳ 15° · ⟳ 90°** trong ô *Đối tượng đang chọn*, hoặc
  phím **R** (Shift+R để xoay ngược).
- **Bắt nét:** khi vẽ, điểm đầu/cuối tự hút vào góc và tim của tường có sẵn trong
  bán kính 0,35 m; hướng tường bị khoá về bội số **15°**, và trong khoảng ±8°
  quanh phương ngang/dọc thì ép hẳn về thẳng góc.
- Tường tự vẽ dùng **chung vật liệu và chiều cao tầng** với tường bóc từ bản vẽ,
  nên nhìn không phân biệt được tường mới với tường cũ.

Các sửa đổi này lưu riêng (`ialy.edits`), **không đụng vào `plant.json`**, nên chạy
lại `tools/extract.py` vẫn giữ nguyên bản gốc.

**Hoàn tác (nút ↶ hoặc Ctrl+Z)** quay ngược được **mọi thao tác**: vẽ thêm, xoá tường,
xoá bình, đổi loại, di chuyển, xoay — giữ 60 bước gần nhất. Cách làm là chụp lại toàn bộ
bản vẽ trước mỗi thao tác, nên không có thao tác nào lọt lưới.

Dữ liệu vẽ thêm **lưu tự động trong trình duyệt** (localStorage), có nút **Hoàn
tác**, **Xoá cao trình này**, **Xuất JSON** (`thiet-ke.json`, gồm cả phần vẽ thêm lẫn phần sửa đối tượng gốc) và
**Nạp JSON** để mang sang máy khác. Toạ độ lưu theo đơn vị bản vẽ gốc nên
không bị lệch khi đổi hệ số hiệu chỉnh tỉ lệ M1–M2.

### Những nét không xoá được (và cách tắt)

Trong khung nhìn có mấy thứ **không phải vật thể bóc từ bản vẽ**, nên bấm chọn không trúng
và cũng không xoá được. Muốn chúng biến mất thì tắt bằng nút, không phải xoá:

| Thứ nhìn thấy | Là gì | Tắt bằng |
|---|---|---|
| Khung hộp mảnh bao quanh mỗi tầng, có cả đường chéo | đường gióng định hướng cho khối nhà | **chỉ hiện trong tab Thiết kế**, tab *Xem* không còn; tắt hẳn bằng nút **Khung bao khối** |
| Ảnh mặt bằng phẳng nằm trên sàn | ảnh quét từ PDF, không tách được từng nét | nút **Bản vẽ mặt bằng**, hoặc thanh **Độ mờ bản vẽ** kéo về 0 |
| Mảng tường / sàn mờ | khối nhà dựng ra | nút **Tường / sàn**, thanh **Độ mờ tường** |
| Khối tủ thiết bị | vật bóc từ bản vẽ | nút **Tủ, thiết bị**, hoặc chọn từng khối rồi Xoá |

## Đèn EXIT

Nguồn: `đèn exit.pdf` (10 trang). Bộ bóc: `tools/exitlamps.py` → `web/data/exit.json`.

Ký hiệu đèn trên bản vẽ là **hình chữ nhật đen ~30×9 pt, bên trong có mũi tên và chữ EXIT**.
Bộ bóc nhận dạng đúng hình chữ nhật đó (kèm điều kiện bên trong phải có nét chữ), nên không
nhầm với vòng tròn tim tổ máy hay chữ trong khung tên.

Toạ độ đưa về **đúng hệ của `plant.json`** (gốc là trung điểm tim hai tổ máy M1–M2 của chính
trang đó, chia cho hệ số tỉ lệ k), rồi khớp cao trình theo dòng *"AT EL xxx.xM"* in trên bản vẽ.

| Cao trình | Số đèn | | Cao trình | Số đèn |
|---|---|---|---|---|
| EL. 348.00 | 6 | | EL. 309.50 | 15 |
| EL. 339.10 | 9 | | EL. 303.90 | 10 |
| EL. 331.40 | 8 | | EL. 298.30 | 7 |
| EL. 323.70 | 9 | | EL. 292.70 | 11 |
| EL. 316.60 | 8 | | **Tổng** | **83** |

Trong 3D, mỗi đèn được **gắn lên bức tường gần nhất**: xoay theo phương của tường, áp sát mặt
tường, cao **2,4 m**. Đèn nào không có tường nào trong vòng 4 m thì giữ nguyên vị trí trên bản
vẽ và xoay theo hướng ký hiệu (ngang/dọc). Bật tắt bằng nút **Đèn EXIT** ở tab *Xem*.

### Chỉnh đèn EXIT trong ứng dụng

- **Cỡ biển**: thanh **Cỡ biển EXIT** ở tab *Xem* (1×–6×, mặc định 2,4×). Biển dựng đúng cỡ
  thật 0,62 × 0,24 m nên nhìn từ xa rất nhỏ; phóng to chỉ để dễ quan sát, không đổi vị trí.
- **Thêm thủ công**: tab *Thiết kế* → công cụ **🟩 Đèn EXIT** (phím **0**) → bấm lên mặt sàn.
  Đèn tự áp vào tường gần nhất. Cao độ lắp đặt ở ô *Cao độ lắp đèn EXIT* (mặc định 2,4 m).
- **Treo trên cửa**: đèn EXIT nằm trong vòng **1,4 m quanh một cửa** sẽ **tự treo ngay trên
  cửa đó** — giữa ô cửa, cao hơn mép cửa 0,28 m, xoay đúng phương cánh cửa. Muốn ép một đèn ở
  xa về treo trên cửa thì chọn đèn rồi bấm **⤒ Gắn lên cửa gần nhất** (tìm trong bán kính 12 m).
- **Di chuyển**: công cụ *Chọn/xoá*, bấm giữ trên đèn rồi kéo — dùng được cho **cả đèn bóc từ
  bản vẽ lẫn đèn tự thêm**. Vị trí mới của đèn gốc lưu riêng trong `edits.movExit`,
  **không sửa `exit.json`**, nên chạy lại `tools/exitlamps.py` vẫn giữ bản gốc.
- **Xoá**: chọn đèn rồi bấm 🗑 hoặc Delete. Mọi thao tác trên đều **hoàn tác được (Ctrl+Z)**.

Trang cuối của tệp (trang 10, cũng ghi EL 292.70) **không bóc được** vì không tìm thấy tim hai
tổ máy để căn toạ độ.

## Số liệu đã trích xuất

| Trang | Cao trình | ABC 8kg | CO₂ 5kg | CO₂ 24kg | Tổng |
|---|---|---|---|---|---|
| 1 | EL. 348.00 — Sàn gian máy | 53 | | | 53 |
| 2 | EL. 339.10 — Sàn điều khiển trung tâm | 20 | | | 20 |
| 3 | EL. 331.40 — Sàn thiết bị phân phối | 20 | | | 20 |
| 4 | EL. 323.70 — Sàn thiết bị AC & DC | 35 | | 2 | 37 |
| 5 | EL. 316.60 — Sàn trung gian | 12 | | | 12 |
| 6 | EL. 309.50 — Sàn tủ kích từ | 33 | | | 33 |
| 7 | EL. 303.90 — Sàn tuabin | 21 | | | 21 |
| 8 | EL. 298.30 — Sàn buồng xoắn | 5 | 5 | | 10 |
| 9 | EL. 292.70 — Sàn ống hút | 6 | 6 | | 12 |
| 10 | EL. 288.65 — Sàn đáy ống hút | 2 | 2 | | 4 |
| 11 | EL. 521.25 — Nhà van cửa nhận nước | 2 | | | 2 |
| | **Tổng** | **209** | **13** | **2** | **224** |

Số lượng từng loại trên từng trang **khớp đúng 100%** với bảng kê (LEGEND) in trên
bản vẽ — đây là phép kiểm tra tự động trong `tools/extract.py`.

## Cách dữ liệu được lấy ra

- Ký hiệu bình là hình tam giác đỏ trong bản vẽ vector. Loại bình nhận dạng theo
  hình bên trong: **vuông đặc = ABC 8kg**, **tam giác đặc = CO₂ 5kg**,
  **vòng tròn = CO₂ 24kg xe đẩy (MT-24)**. Trong mô hình 3D, bình 24kg được vẽ
  đúng dạng xe đẩy (bình lớn + 2 bánh + tay kéo, màu xanh lá) để phân biệt ngay
  với bình xách tay.
- Các tầng được ghép chồng đúng vị trí nhờ **tim hai tổ máy M1–M2** (tâm các vòng
  tròn buồng xoắn / hố tuabin) — điểm chuẩn chung xuất hiện trên mọi mặt bằng.
  Vì các trang vẽ ở 4 tỉ lệ khác nhau (hệ số 1 : 1.2 : 1.5 : 2.0), hệ số này được
  tính lại cho từng trang từ khoảng cách M1–M2 đo trên trang.
- Ảnh nền mỗi tầng là chính mặt bằng trong PDF, đã xoá khung tên, bảng kê và khối
  chi tiết, chuyển nền trắng thành trong suốt.
- Tên phòng (P601, P1003, CT.1…) lấy từ lớp chữ của PDF, gán cho bình gần nhất.

### Khối nhà 3D

Mỗi cao trình được dựng thành một tầng thật: **sàn bê tông dày 0,4 m + tường bao
0,7 m**, cao đúng bằng khoảng cách tới cao trình trên (tầng gian máy trên cùng lấy
12 m). Mặt bằng gốc nằm ngay trên mặt sàn, các bình chữa cháy đứng trong lòng tầng.

**Tường ngăn phòng, tường hành lang, lối đi** được bóc tự động từ bản vẽ vector
(`tools/walls.py`): ứng viên = một **cặp nét thẳng song song** gần nhau, chồng lấn
nhau, dài tối thiểu ~1,8 m. Sau đó phân loại theo đúng cách đọc bản vẽ:

| Dấu hiệu trên bản vẽ | Kết luận | Dựng 3D |
|---|---|---|
| Có **gạch chéo** bên trong dải (khối xây / bê tông) | Tường | Cao hết tầng, màu xám sáng |
| Thon dài (dài ≥ 6× bề dày) **và hai đầu gác vào tường khác** | Vách ngăn | Cao hết tầng |
| Thon dài nhưng **đứng độc lập giữa phòng** | Giá, kệ, tủ dài | Khối cao 2,0 m |
| Nằm **sát và song song** một vách tường đã nhận | Lớp thứ hai của tường | Cao hết tầng |
| Hình chữ nhật **rỗng ruột, mập**, không gạch chéo | Tủ điện / thiết bị | Khối cao 2,0 m, màu xanh thép |

Bề dày vách nhận từ **0,13 m đến 3,3 m** — phải xuống tới 0,13 m mới bắt được các
vách xây 190 mm (ví dụ bức tường treo bình ở cạnh phòng P1005, EL. 339.10).

Mức độ gạch chéo đo bằng mật độ nét bên trong dải (`ink_sampler` trong
`tools/extract.py`), lấy phần lõi 56% để không dính hai nét biên.

**Vẽ tay bổ sung.** `MANUAL_WALLS` trong `tools/extract.py` cho phép thêm các bức
đọc thẳng từ mặt bằng (`[x0, y0, x1, y1]`, đơn vị bản vẽ gốc); chúng được **cộng
thêm** vào kết quả tự động chứ không thay thế — tránh việc một bức vẽ tay chạy
thẳng xuyên qua các khối có hình dạng gấp khúc (như khối TM / thang bộ CT.1 ở
EL. 339.10). Hiện EL. 339.10 có 12 bức vẽ tay (tường sau, hai đầu hồi, các vách
ngăn chính giữa P1002–P1008).

**Cửa ra vào** (`tools/doors.py`) nhận từ **cung tròn ¼ thể hiện chiều quay cánh
cửa**, chỉ giữ những cung nằm sát một vách tường (để loại cung của thiết bị). Từ
cung đó lấy được toàn bộ hình học cánh cửa:

- **bản lề** = giao điểm hai tiếp tuyến ở hai đầu cung;
- **cánh tay nằm dọc theo tường** = bề rộng ô cửa → khoét thủng tường đúng chỗ đó,
  chừa lanh tô phía trên;
- **cánh tay còn lại** = hướng mở → dựng **cánh cửa** dày 7 cm, cao 2,05 m, xoay
  đúng chiều mở như trên bản vẽ (màu vàng gỗ).

Bao ngoài từng tầng (`FOOTPRINT` trong `tools/extract.py`) là **hình chữ nhật gần
đúng** dùng cho sàn; muốn chỉnh, sửa số trong bảng đó rồi chạy lại
`python tools/extract.py`.

### Lưu ý về tỉ lệ mét

Bản vẽ mặt bằng nhà máy **không ghi kích thước**, nên không thể suy ra tỉ lệ mét
tuyệt đối từ chính tờ vẽ. Ứng dụng vì vậy dùng một tham số hiệu chỉnh duy nhất:
**khoảng cách tim tổ máy M1–M2**, mặc định giả định **22,0 m**. Nhập giá trị thực
tế vào ô "Hiệu chỉnh tỉ lệ" là mọi khoảng cách/toạ độ hiển thị sẽ đúng ngay.
Vị trí tương đối của các bình so với mặt bằng **không phụ thuộc** giá trị này.

Riêng nhà van cửa nhận nước (trang 11) có ghi kích thước (16200 mm), nên toạ độ
tầng đó là mét thật. Đây là công trình riêng, được đặt tách sang một bên và phía
trên nhà máy cho dễ quan sát (cao độ thực EL 521.25).

## Cấu trúc thư mục

```
tools/extract.py        đọc PDF -> web/data/plant.json + ảnh từng tầng
tools/walls.py          tách tường/vách ngăn từ các cặp nét song song
tools/doors.py          tách cửa ra vào từ cung quay cánh cửa
tools/verify.py         xuất ảnh kiểm tra: khoanh tròn vị trí đã nhận dạng
web/index.html, app.js  ứng dụng 3D (three.js) + tab Thiết kế
web/config.js           cấu hình đồng bộ Supabase (để trống = chỉ lưu cục bộ)
web/supabase.sql        câu lệnh tạo bảng trên Supabase
tools/_design_block.js  mã nguồn tab Thiết kế (đã nhúng vào web/app.js)
web/data/plant.json     224 bình: mã, loại, tầng, phòng, toạ độ
web/data/floors/*.png   ảnh mặt bằng từng cao trình (nền trong suốt)
web/vendor/             three.js + OrbitControls (chạy ngoại tuyến)
start.bat               khởi động máy chủ cục bộ và mở trình duyệt
```

Nếu bản vẽ được cập nhật, chạy lại:

```bash
python tools/extract.py
```

## Nguồn khác trong thư mục

`12323.pdf` là sơ đồ nguyên lý hệ thống chữa cháy khí FM-200. Danh sách phòng
được bảo vệ bằng FM-200 (P902, P803, P604, P1002, P1003, P1004) đã được đưa vào
phần "Ghi chú" của ứng dụng.
