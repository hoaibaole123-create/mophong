// Doc BANG THEO DOI TINH TRANG PCCC hang thang (file Excel tren Google Drive cua
// don vi) va tra ve ket qua kiem tra tung binh, de the theo doi trong phan mem
// tu cap nhat ma khong phai nap tay.
//   GET /api/kiemtra -> { "2026": { "9": { "BỘT-▼348-153IMR-PX1": {ngay, kq, nguoi, thay?}, ... } }, ... }
//   (theo NAM roi theo THANG: nhieu file nhieu nam khong de len nhau; thay=true khi
//   cot danh gia ghi co thay binh moi)
// Nguon: bien moi truong NGUON_KIEM_TRA (cac ID file Drive, cach nhau dau phay)
// hoac danh sach mac dinh duoi day. File phai de "Bat ky ai co duong lien ket".
const XLSX = require('xlsx');

const MAC_DINH = ['1bO_AEKC1c22LpBtfQRoVelX66OUKCnKI'];   // IMR_BẢNG THEO DÕI TÌNH TRẠNG PCCC-T09.xlsx

const chuan = s => String(s || '').replace(/\s+/g, '');
const ngayVN = v => {
  if (typeof v === 'number') {                             // so ngay kieu Excel -> dd/mm/yyyy
    const d = XLSX.SSF.parse_date_code(v);                  // khong phu thuoc mui gio may chu
    if (d) return String(d.d).padStart(2, '0') + '/' + String(d.m).padStart(2, '0') + '/' + d.y;
  }
  const s = String(v || '').trim();
  const m = s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  return m ? m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[3] : s;
};
// cot danh gia ghi mo ta tinh trang (".../Đạt", "...kim chỉ thị áp lực xanh");
// chi ghi Khong dat khi co ghi ro khong dat / hong / that bai
const ketQua = s => (/không\s*đạt|hư\s*hỏng|hỏng|thất\s*bại/i.test(String(s || '')) ? 'Không đạt' : 'Đạt');

async function docFile(id) {
  const r = await fetch('https://drive.google.com/uc?export=download&id=' + encodeURIComponent(id));
  if (!r.ok) throw new Error('Drive ' + r.status);
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  const ra = {};
  for (const ten of wb.SheetNames) {
    const m = ten.match(/th[aá]ng\s*(\d{1,2})/i);
    if (!m) continue;
    const thang = String(+m[1]);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[ten], { header: 1, raw: true });
    let nguoiTruoc = '';                                     // o "nguoi quan ly" hay gop nhieu dong
    for (const row of rows) {
      const tb = row[1];
      if (typeof tb === 'string' && /cao\s*trình/i.test(tb)) nguoiTruoc = '';   // sang cao trinh moi
      if (typeof tb !== 'string' || tb.indexOf('▼') < 0) continue;
      if (!row[4] && !row[5]) continue;                      // chua kiem tra thang nay
      const ngay = ngayVN(row[4]);
      // trang thang moi thuong chep tu thang truoc, ngay van la thang cu -> chua
      // kiem tra that, bo qua cho toi khi dien ngay dung thang
      const mt = ngay.match(/^\d{2}\/(\d{2})\//);
      if (mt && String(+mt[1]) !== thang) continue;
      const nam = (ngay.match(/\/(\d{4})$/) || [])[1] || String(new Date().getFullYear());
      const o = { ngay: ngay, kq: ketQua(row[5]), nguoi: (String(row[6] || '').trim() || nguoiTruoc) };
      if (/thay\s*(mới|bình|moi)/i.test(String(row[5] || ''))) o.thay = true;
      ((ra[nam] = ra[nam] || {})[thang] = ra[nam][thang] || {})[chuan(tb)] = o;
      nguoiTruoc = o.nguoi;
    }
  }
  return ra;
}

module.exports = async (req, res) => {
  const ids = (process.env.NGUON_KIEM_TRA || MAC_DINH.join(',')).split(',').map(s => s.trim()).filter(Boolean);
  const gop = {}, loi = [];
  for (const id of ids) {
    try {
      const d = await docFile(id);
      for (const n in d) for (const t in d[n]) Object.assign(((gop[n] = gop[n] || {})[t] = gop[n][t] || {}), d[n][t]);
    } catch (e) { loi.push(id + ': ' + e.message); }
  }
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).send(JSON.stringify(loi.length ? Object.assign(gop, { _loi: loi }) : gop));
};
