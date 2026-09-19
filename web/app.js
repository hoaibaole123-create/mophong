import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h !== undefined) e.innerHTML = h; return e; };

const FM200 = [
  ['P902', 'Phòng thiết bị G-Voltage & phụ trợ', 331.40],
  ['P803', 'Phòng thiết bị AC & DC', 323.70],
  ['P604', 'Phòng tủ kích từ', 309.50],
  ['P1002', 'Phòng thông tin', 339.10],
  ['P1003', 'Phòng điều khiển trung tâm (và trần giả)', 339.10],
  ['P1004', 'Phòng ắc quy', 339.10],
];

const state = {
  plan: false,
  frame: true,
  exitOn: true,
  exitData: null,
  lines: {},               // tuyến tường bóc từ vector PDF (dùng khi đi bộ)
  exitScale: 2.4,   // phóng to biển cho dễ thấy
  showPlan: false,  // ảnh bản vẽ mặt bằng: MẶC ĐỊNH TẮT, ai cần thì tự bật
  data: null, unitM: 22, explode: 1.6, mkScale: 1, opacity: 1,
  visible: new Set(), typeOn: new Set(), selected: null, query: '', paper: false, massing: true, cabinets: true,
  activeFloor: null,
  mode: 'view', tool: 'sel', custom: {}, sel: null, undo: [], edits: {},
};

const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// Máy yếu thì hạ mật độ điểm ảnh, máy khoẻ mới lấy tối đa 1,75× — nhiều máy văn
// phòng chạy 2× là tụt khung hình mà mắt gần như không thấy khác.
renderer.setPixelRatio(Math.min(devicePixelRatio, (navigator.hardwareConcurrency || 4) >= 8 ? 1.75 : 1.25));
// Ánh sáng thật (ACES) + không gian màu sRGB: bê tông hết bị bệt, màu sơn, biển
// EXIT, bình chữa cháy lên đúng sắc, vùng sáng không bị cháy trắng.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Bóng đổ mềm, CHỈ bật ở chế độ đi bộ (một cao trình, ít vật) để máy thường
// vẫn chạy mượt; khung nhìn tổng thể không bật.
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
scene.fog = new THREE.Fog(0x0e1116, 260, 900);

const camPersp = new THREE.PerspectiveCamera(45, 1, 0.5, 4000);
// Camera chiếu song song, nhìn thẳng từ trên xuống: vẽ tường như vẽ trên giấy,
// không bị phối cảnh làm lệch tay.
const camOrtho = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.5, 4000);
let camera = camPersp;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;

const denTroi = new THREE.HemisphereLight(0xffffff, 0x30404f, 2.0);
scene.add(denTroi);
// đèn trong nhà: chỉ bật ở chế độ đi bộ, để mặt dưới trần / mặt sàn lật xuống
// không bị tối đen (đèn bán cầu lấy màu đất xanh xám cho mặt hướng xuống)
const denTrongNha = new THREE.AmbientLight(0xffffff, 0);
scene.add(denTrongNha);
const dir = new THREE.DirectionalLight(0xffffff, 1.4);
dir.shadow.mapSize.set(1024, 1024);
dir.shadow.camera.near = 1; dir.shadow.camera.far = 400;
dir.shadow.camera.left = -60; dir.shadow.camera.right = 60;
dir.shadow.camera.top = 60; dir.shadow.camera.bottom = -60;
dir.shadow.bias = -0.0015;
// đèn hắt phụ: gờ tường, mép bậc thang có sáng tối, không bẹt như giấy
const denPhu = new THREE.DirectionalLight(0xdfe7f0, 0.35);
denPhu.position.set(-70, 45, -60);
scene.add(denPhu);
dir.position.set(60, 120, 40);
scene.add(dir);

const floorGroup = new THREE.Group();
const markerGroup = new THREE.Group();
const massGroup = new THREE.Group();
const customGroup = new THREE.Group();
const exitGroup = new THREE.Group();
scene.add(floorGroup, massGroup, customGroup, markerGroup, exitGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let floorMeshes = [], markers = [], labels = [], backs = [], masses = [], pickables = [];
// hinh chieu bang cua tung khoi -> chon duoc ca khi tia ban truot (tuong day 0,19 m rat kho tro)
let pickRects = [];

// ---------------------------------------------------------------- helpers
// ---------------------------------------------------------------------------
// HAI NHA MAY trong cung mot ung dung. Moi nha may co thu muc du lieu rieng,
// kho localStorage rieng va ban ve dam may rieng -> sua ben nay khong dung ben kia.
// ---------------------------------------------------------------------------
const NHA_MAY = {
  mr: { ten: 'Ialy mở rộng', duong: './data/', kho: 'ialy', doc: 'ialy-mo-rong',
        mo: 'Nhà máy thuỷ điện Ialy mở rộng (2×180MW) — bình chữa cháy xách tay',
        ngaySD: '22/06/2023' },
  nm: { ten: 'Nhà máy Ialy', duong: './data/ialy/', kho: 'ialy.nm', doc: 'ialy-nha-may',
        mo: 'Nhà máy thuỷ điện Ialy — sơ đồ thoát nạn & phương tiện PCCC&CNCH',
        ngaySD: '' }
};
const nhaMayDang = (() => {
  try { return localStorage.getItem('ialy.nhamay') === 'nm' ? 'nm' : 'mr'; }
  catch (e) { return 'mr'; }
})();
const NM = NHA_MAY[nhaMayDang];
const duongDL = t => NM.duong + t;              // ./data/… hoac ./data/ialy/…
const khoaKho = t => NM.kho + '.' + t;          // ialy.custom hoac ialy.nm.custom

function doiNhaMay(ma) {
  if (ma === nhaMayDang) return;
  try { localStorage.setItem('ialy.nhamay', ma); } catch (e) { }
  location.reload();
}

const mpp = () => state.unitM / state.data.base_unit_spacing_pt;   // mét / đơn vị bản vẽ gốc

function floorOf(page) { return state.data.floors.find(f => f.page === page); }

function floorY(f) {
  const base = Math.min(...state.data.floors.filter(x => x.georef !== 'standalone').map(x => x.elevation));
  if (f.georef === 'standalone') {
    const top = Math.max(...state.data.floors.filter(x => x.georef !== 'standalone').map(x => x.elevation));
    return (top - base) * state.explode + 22;      // đặt tách phía trên cho dễ nhìn
  }
  return (f.elevation - base) * state.explode;
}

function worldXZ(f, bx, by) {
  if (f.georef === 'standalone') return [bx + 110, by - 40];        // công trình riêng, dời sang bên
  const s = mpp();
  return [bx * s, by * s];
}

function labelSprite(text, color = '#9aa7b4', px = 96) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `bold ${px}px Segoe UI, sans-serif`;
  c.width = Math.ceil(ctx.measureText(text).width) + 24;
  c.height = px * 1.5;
  const g = c.getContext('2d');
  g.font = `bold ${px}px Segoe UI, sans-serif`;
  g.fillStyle = color; g.textBaseline = 'middle';
  g.fillText(text, 12, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(c.width / c.height * 2.8, 2.8, 1);
  return sp;
}

// ---------------------------------------------------------------------------
// THE MA SO treo tren tung thiet bi. Ve mot lan roi dung chung texture cho cac
// ma giong nhau; moi cao trinh hang tram thiet bi nen phai tiet kiem.
// ---------------------------------------------------------------------------
const _theMa = new Map();
function theMaSo(ma) {
  let t = _theMa.get(ma);
  if (!t) {
    const px = 64, c = document.createElement('canvas');
    let x = c.getContext('2d');
    x.font = `bold ${px}px Segoe UI, sans-serif`;
    const w = Math.ceil(x.measureText(ma).width) + 34;
    c.width = w; c.height = px * 1.6;
    x = c.getContext('2d');
    const r = 16;                                   // nền bo góc cho dễ đọc
    x.fillStyle = 'rgba(14,18,24,.82)';
    x.beginPath(); x.moveTo(r, 0); x.lineTo(w - r, 0); x.quadraticCurveTo(w, 0, w, r);
    x.lineTo(w, c.height - r); x.quadraticCurveTo(w, c.height, w - r, c.height);
    x.lineTo(r, c.height); x.quadraticCurveTo(0, c.height, 0, c.height - r);
    x.lineTo(0, r); x.quadraticCurveTo(0, 0, r, 0); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.28)'; x.lineWidth = 3; x.stroke();
    x.font = `bold ${px}px Segoe UI, sans-serif`;
    x.fillStyle = '#eaf2fb'; x.textBaseline = 'middle';
    x.fillText(ma, 17, c.height / 2 + 2);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    _theMa.set(ma, t);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true,
                                                         depthTest: false }));
  const k = t.image.width / t.image.height;
  sp.scale.set(k * 0.45, 0.45, 1);
  sp.renderOrder = 5;
  return sp;
}

// hình khối ký hiệu: bình xách tay, và bình CO2 24kg là loại xe đẩy
const GEO = {
  bodyABC: new THREE.CylinderGeometry(.42, .50, 1.50, 14),
  neckABC: new THREE.CylinderGeometry(.18, .30, .50, 12),
  bodyCO2: new THREE.CylinderGeometry(.34, .40, 1.35, 14),
  neckCO2: new THREE.CylinderGeometry(.15, .26, .55, 12),
  bodyBig: new THREE.CylinderGeometry(.52, .58, 2.10, 16),
  neckBig: new THREE.CylinderGeometry(.20, .36, .60, 12),
  wheel: new THREE.TorusGeometry(.36, .11, 8, 16),
  bar: new THREE.CylinderGeometry(.075, .075, 2.60, 8),
  axle: new THREE.CylinderGeometry(.07, .07, 1.30, 8),
};


// ---------------------------------------------------------------------------
// BÌNH BỘT ABC: vẽ theo đúng ký hiệu trên bản vẽ — thân trụ đỏ có nhãn ABC,
// vai cầu, cổ van đồng, cò bóp nằm ngang, đồng hồ áp, vòi phun vắt xuống,
// chân đế cao su. Hình được dựng MỘT LẦN rồi dùng chung cho mọi bình.
// ---------------------------------------------------------------------------
let _geoABC = null, _vlABC = null;
function vlABC() {
  if (_vlABC) return _vlABC;
  const G = geoABC();
  _vlABC = {
    do: new THREE.MeshStandardMaterial({ map: G.tex, roughness: .42, metalness: .12,
      emissive: 0x340a06, emissiveIntensity: 1 }),
    den: new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: .55, metalness: .45 }),
    sang: new THREE.MeshStandardMaterial({ map: G.tex, roughness: .35, metalness: .1,
      emissive: 0xffc14d, emissiveIntensity: 1.5 }),
    mo: new THREE.MeshStandardMaterial({ map: G.tex, roughness: .5, transparent: true, opacity: .15 }),
    moDen: new THREE.MeshStandardMaterial({ color: 0x2f3338, transparent: true, opacity: .15 }),
  };
  return _vlABC;
}
function texThanBinh() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d42a1f'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#f2efe6'; g.fillRect(40, 48, 176, 34);          // nhãn trắng
  g.strokeStyle = '#8f1710'; g.lineWidth = 2; g.strokeRect(40, 48, 176, 34);
  g.fillStyle = '#c0261c'; g.font = 'bold 25px system-ui'; g.textAlign = 'center';
  g.fillText('ABC', 128, 73);
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, 0, 18, 128);  // vệt sáng thân trụ
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function geoABC() {
  if (_geoABC) return _geoABC;
  const do_ = [], den = [];
  const them = (ds, geo, x, y, z, rx, ry, rz) => {
    const m = new THREE.Matrix4();
    m.makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    m.setPosition(x, y, z);
    ds.push(geo.clone().applyMatrix4(m));
  };
  // Chỉ THÂN TRỤ mới lấy ảnh nhãn ABC; vai cầu và đầu van dồn UV về một điểm đỏ
  // trơn của ảnh, nhờ vậy vẫn dùng chung một vật liệu mà không bị nhãn trắng
  // trùm lên đỉnh bình.
  const doTron = g => {
    const uv = g.attributes.uv;
    if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.05);
    return g;
  };
  them(do_, new THREE.CylinderGeometry(.30, .31, 1.34, 20, 1, true), 0, .80, 0);
  them(do_, doTron(new THREE.SphereGeometry(.30, 20, 10, 0, Math.PI * 2, 0, Math.PI * .5)), 0, 1.47, 0);
  them(do_, doTron(new THREE.CylinderGeometry(.30, .30, .02, 20)), 0, .14, 0);
  them(do_, doTron(new THREE.BoxGeometry(.26, .16, .19)), 0, 1.86, 0);
  // đế cao su, cổ, cò bóp, tay xách, đồng hồ áp, vòi phun (phần sẫm)
  them(den, new THREE.CylinderGeometry(.32, .34, .14, 20), 0, .07, 0);
  them(den, new THREE.TorusGeometry(.305, .025, 8, 24), 0, 1.44, 0, Math.PI / 2);
  them(den, new THREE.CylinderGeometry(.10, .13, .20, 12), 0, 1.70, 0);
  them(den, new THREE.BoxGeometry(.46, .05, .07), .12, 1.99, 0, 0, 0, -.07);   // cò bóp
  them(den, new THREE.BoxGeometry(.38, .05, .07), .08, 1.90, 0);               // tay xách
  them(den, new THREE.CylinderGeometry(.09, .09, .05, 12), -.20, 1.86, 0, 0, 0, Math.PI / 2);
  them(den, new THREE.CylinderGeometry(.03, .03, .26, 10), -.14, 1.93, 0, 0, 0, Math.PI / 2);
  them(den, new THREE.TorusGeometry(.15, .03, 8, 16, Math.PI / 2), -.28, 1.78, 0, 0, 0, Math.PI / 2);
  them(den, new THREE.CylinderGeometry(.03, .03, 1.16, 10), -.43, 1.18, 0);
  them(den, new THREE.TorusGeometry(.13, .03, 8, 16, Math.PI / 2), -.30, .60, 0, 0, 0, Math.PI);
  them(den, new THREE.CylinderGeometry(.045, .075, .24, 12, 1, true), -.19, .47, 0, 0, 0, -.55);
  _geoABC = { do: _noiHinh(do_), den: _noiHinh(den), tex: texThanBinh() };
  do_.forEach(g => g.dispose()); den.forEach(g => g.dispose());
  return _geoABC;
}


// ---------------------------------------------------------------------------
// BÌNH KHÍ CO₂ 5kg: chai thép đỏ cao và thon hơn bình bột, KHÔNG có đồng hồ áp,
// van tay vặn, và đặc trưng nhất là LOA PHUN hình nón đen gắn trên ống vòi cứng.
// ---------------------------------------------------------------------------
let _geoCO2 = null, _vlCO2 = null;
function texThanCO2() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#cf2a20'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#f2efe6'; g.fillRect(44, 50, 168, 32);
  g.strokeStyle = '#8f1710'; g.lineWidth = 2; g.strokeRect(44, 50, 168, 32);
  g.fillStyle = '#c0261c'; g.font = 'bold 23px system-ui'; g.textAlign = 'center';
  g.fillText('CO2', 128, 73);
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, 0, 16, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function geoCO2() {
  if (_geoCO2) return _geoCO2;
  const do_ = [], den = [];
  const them = (ds, geo, x, y, z, rx, ry, rz) => {
    const m = new THREE.Matrix4();
    m.makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    m.setPosition(x, y, z);
    ds.push(geo.clone().applyMatrix4(m));
  };
  const doTron = g => {
    const uv = g.attributes.uv;
    if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.05);
    return g;
  };
  // chai thép: thon hơn bình bột, cao hơn một chút
  them(do_, new THREE.CylinderGeometry(.27, .28, 1.46, 20, 1, true), 0, .85, 0);
  them(do_, doTron(new THREE.SphereGeometry(.27, 20, 10, 0, Math.PI * 2, 0, Math.PI * .5)), 0, 1.58, 0);
  them(do_, doTron(new THREE.CylinderGeometry(.27, .27, .02, 20)), 0, .14, 0);
  them(do_, doTron(new THREE.BoxGeometry(.22, .18, .18)), 0, 1.92, 0);      // thân van
  // chân đế, cổ chai, van tay vặn, ống vòi cứng và LOA PHUN hình nón
  them(den, new THREE.CylinderGeometry(.29, .31, .14, 20), 0, .07, 0);
  them(den, new THREE.CylinderGeometry(.11, .14, .22, 12), 0, 1.78, 0);
  them(den, new THREE.TorusGeometry(.275, .025, 8, 24), 0, 1.55, 0, Math.PI / 2);
  them(den, new THREE.CylinderGeometry(.10, .10, .04, 14), 0, 2.03, 0);      // vô lăng van
  them(den, new THREE.BoxGeometry(.32, .05, .06), .07, 2.03, 0, 0, 0, -.12); // cần bóp
  // Vòi phun: từ van vắt sang bên rồi CHẠY DỌC THÂN xuống gần chân bình, đầu
  // vòi là loa nhỏ chúc xuống — đúng như ký hiệu trên bản vẽ.
  them(den, new THREE.CylinderGeometry(.035, .035, .30, 10), -.15, 2.00, 0, 0, 0, Math.PI / 2);
  them(den, new THREE.TorusGeometry(.16, .035, 8, 16, Math.PI / 2), -.30, 1.84, 0, 0, 0, Math.PI / 2);
  them(den, new THREE.CylinderGeometry(.035, .035, 1.34, 10), -.46, 1.17, 0);
  them(den, new THREE.TorusGeometry(.14, .035, 8, 16, Math.PI / 2), -.32, .50, 0, 0, 0, Math.PI);
  them(den, new THREE.CylinderGeometry(.05, .085, .26, 12, 1, true), -.20, .36, 0, 0, 0, -.55);
  _geoCO2 = { do: _noiHinh(do_), den: _noiHinh(den), tex: texThanCO2() };
  do_.forEach(g => g.dispose()); den.forEach(g => g.dispose());
  return _geoCO2;
}
function vlCO2() {
  if (_vlCO2) return _vlCO2;
  const G = geoCO2();
  _vlCO2 = {
    do: new THREE.MeshStandardMaterial({ map: G.tex, roughness: .4, metalness: .25,
      emissive: 0x2a0806, emissiveIntensity: 1 }),
    den: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: .5, metalness: .4,
      side: THREE.DoubleSide }),
    sang: new THREE.MeshStandardMaterial({ map: G.tex, roughness: .35, metalness: .1,
      emissive: 0xffc14d, emissiveIntensity: 1.5 }),
    mo: new THREE.MeshStandardMaterial({ map: G.tex, roughness: .5, transparent: true, opacity: .15 }),
    moDen: new THREE.MeshStandardMaterial({ color: 0x23262a, transparent: true, opacity: .15,
      side: THREE.DoubleSide }),
  };
  return _vlCO2;
}

const TEN_BINH = { ABC8: 'Bình bột ABC 8kg', CO25: 'Bình CO₂ 5kg',
                   CO224: 'Bình CO₂ 24kg xe đẩy', FM200: 'Bình FM200' };

function makeMarker(type, mat) {
  const g = new THREE.Group();
  if (type === 'CO224') {                       // xe đẩy: bình lớn + 2 bánh + tay kéo
    const body = new THREE.Mesh(GEO.bodyBig, mat); body.position.set(0, 1.25, 0);
    const neck = new THREE.Mesh(GEO.neckBig, mat); neck.position.set(0, 2.55, 0);
    const axle = new THREE.Mesh(GEO.axle, mat);
    axle.rotation.z = Math.PI / 2; axle.position.set(0, .38, -.55);
    const w1 = new THREE.Mesh(GEO.wheel, mat); w1.position.set(-.74, .38, -.55);
    const w2 = new THREE.Mesh(GEO.wheel, mat); w2.position.set(.74, .38, -.55);
    w1.rotation.y = Math.PI / 2; w2.rotation.y = Math.PI / 2;
    const bar = new THREE.Mesh(GEO.bar, mat);
    bar.rotation.x = -0.22; bar.position.set(0, 1.60, -.78);
    g.add(body, neck, axle, w1, w2, bar);
  } else if (type === 'ABC8') {
    const G = geoABC(), V = vlABC();
    const m1 = new THREE.Mesh(G.do, V.do), m2 = new THREE.Mesh(G.den, V.den);
    g.add(m1, m2);
    g.userData.abc = [m1, m2];                   // đổi vật liệu khi chọn / khi lọc
    g.userData.vl = V;
  } else if (type === 'CO25' || type === 'CO2') {   // nha may Ialy dung chung mo hinh binh CO2
    const G = geoCO2(), V = vlCO2();
    const m1 = new THREE.Mesh(G.do, V.do), m2 = new THREE.Mesh(G.den, V.den);
    g.add(m1, m2);
    g.userData.abc = [m1, m2];                   // dùng chung cơ chế đổi vật liệu
    g.userData.vl = V;
  } else if (type === 'NUTBAO') {
    g.add(makeNutBao());
  } else {
    const body = new THREE.Mesh(GEO.bodyCO2, mat);
    const neck = new THREE.Mesh(GEO.neckCO2, mat);
    body.position.y = .68;
    neck.position.y = 1.63;
    g.add(body, neck);
  }
  g.userData.mat = mat;
  return g;
}

// ---- NUT AN BAO CHAY kieu PPE-1 (JE): mat chuong tron do, chu FIRE ALARM,
// nut PUSH den o giua, den bao nho phia duoi. Treo o do cao 1,4 m.
let _matNutBao = null;
function vlNutBao() {
  if (_matNutBao) return _matNutBao;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#cc1f18'; x.fillRect(0, 0, 256, 256);        // nền đỏ
  x.strokeStyle = '#8d130e'; x.lineWidth = 6;
  x.beginPath(); x.arc(128, 128, 120, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#ffffff';
  x.font = 'bold 30px Arial, sans-serif'; x.textAlign = 'center';
  x.fillText('FIRE ALARM', 128, 74);
  x.font = '13px Arial, sans-serif';
  x.fillText('TELEPHONE', 128, 92);
  x.fillStyle = '#14181c';                                    // hốc nút bấm
  x.beginPath(); x.arc(128, 150, 46, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#2f7d3a';
  x.beginPath(); x.arc(128, 150, 34, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#ffffff'; x.font = 'bold 22px Arial, sans-serif';
  x.fillText('PUSH', 128, 158);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _matNutBao = {
    mat: new THREE.MeshStandardMaterial({ map: t, roughness: .5, metalness: .05 }),
    vo: new THREE.MeshStandardMaterial({ color: 0xbb1b14, roughness: .45, metalness: .1 }),
    nut: new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: .35,
                                          emissive: 0x0d2a12 }),
    den: new THREE.MeshStandardMaterial({ color: 0xff5a3c, emissive: 0xc02a10,
                                          roughness: .3 })
  };
  return _matNutBao;
}

// Nut bao gan tuong: quay mat ra phia phong, ap lung vao tuong gan nhat.
// Chua ve tuong thi de mac dinh huong +Z.
// Ap mot vat vao BUC TUONG GAN NHAT va quay mat no huong ra ngoai phong.
// lui = khoang cach tu mat tuong ra tam vat.
function apVaoTuong(g, f, x, z, lui) {
  if (typeof tuongGanNhat !== 'function') return false;
  const t = tuongGanNhat(f, x, z);
  if (!t || t.d > 4) return false;
  const nx = -t.uz, nz = t.ux;
  const ben = ((x - t.x) * nx + (z - t.z) * nz) >= 0 ? 1 : -1;
  g.position.x = t.x + nx * ben * (t.day / 2 + lui);
  g.position.z = t.z + nz * ben * (t.day / 2 + lui);
  g.rotation.y = -Math.atan2(t.uz, t.ux) + (ben < 0 ? Math.PI : 0);
  return true;
}

function xoayNutBao(g, f, x, z) { apVaoTuong(g, f, x, z, .05); }

// Binh chua chay XACH TAY duoc treo tren gia gan tuong, day binh cach san
// khoang 40 cm. Binh xe day (CO224) dung duoi san, binh khi FM-200 la cum
// chai co dinh nen ca hai deu khong treo.
const CAO_TREO_BINH = 0.40;
const LOAI_TREO = ['ABC8', 'CO25', 'CO2'];
let MAT_GIA_BINH = null;
function treoBinhLenTuong(g, f, x, z, loai, ySan) {
  if (!LOAI_TREO.includes(loai)) return;
  // ban kinh binh ~0,10 m -> lui 0,14 m de vo binh vua cham mat tuong
  if (!apVaoTuong(g, f, x, z, .14)) return;   // khong co tuong -> cu de duoi san
  g.position.y = ySan + CAO_TREO_BINH;
  MAT_GIA_BINH = MAT_GIA_BINH || new THREE.MeshStandardMaterial(
    { color: 0x8d9aa6, roughness: .6, metalness: .5 });
  // gia do: mot ban thep ap tuong sau lung binh
  const gia = new THREE.Mesh(new THREE.BoxGeometry(.24, .10, .03), MAT_GIA_BINH);
  gia.position.set(0, .30, -.13);
  gia.userData.gia = true;
  g.add(gia);
}

// Dat lai toan bo binh boc tu ban ve: ve them/xoa tuong thi binh gan do phai
// tu bam len tuong (hoac roi xuong san neu tuong bi xoa) ma khong phai tai lai.
function datLaiViTriBinh() {
  for (const m of markers) {
    const it = m.userData.item, f = floorOf(it.floor);
    const cu = m.children.find(c => c.userData.gia);   // go gia do cu di da
    if (cu) { m.remove(cu); cu.geometry.dispose(); }
    const doi = editsOf(f.page).movItem[it.id];
    const [x, z] = worldXZ(f, doi ? doi[0] : it.bx, doi ? doi[1] : it.by);
    m.position.set(x, floorY(f) + .05, z);
    m.rotation.y = 0;
    if (it.type === 'NUTBAO') xoayNutBao(m, f, x, z);
    else treoBinhLenTuong(m, f, x, z, it.type, floorY(f));
  }
}

function makeNutBao(chon) {
  const V = vlNutBao();
  const g = new THREE.Group();
  if (chon) { g.userData.chon = true; }
  const R = .11;                                   // hộp tròn đường kính 22 cm
  const than = new THREE.Mesh(new THREE.CylinderGeometry(R, R * .82, .07, 24), V.vo);
  than.rotation.x = Math.PI / 2;
  const mat = new THREE.Mesh(new THREE.CircleGeometry(R, 24), V.mat);
  mat.position.z = .036;
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, .018, 16), V.nut);
  nut.rotation.x = Math.PI / 2; nut.position.set(0, -.012, .045);
  const den = new THREE.Mesh(new THREE.SphereGeometry(.012, 10, 8), V.den);
  den.position.set(0, -.072, .042);
  if (chon) { than.material = MAT_SEL; mat.material = MAT_SEL; }
  g.add(than, mat, nut, den);
  g.position.y = 1.4;                              // treo cao 1,4 m như thực tế
  return g;
}

// ------------------------------------------------- khối nhà 3D từng cao trình
const MASS = {
  slab: 0.40,          // chiều dày sàn (m)
  wall: 0.70,          // chiều dày tường bao (m)
  topFloorH: 12.0,     // chiều cao gian máy phía trên cùng (m)
  standaloneH: 4.5,
};

function floorHeight(f) {
  if (f.georef === 'standalone') return MASS.standaloneH;
  const above = state.data.floors
    .filter(x => x.georef !== 'standalone' && x.elevation > f.elevation)
    .sort((a, b) => a.elevation - b.elevation)[0];
  return above ? above.elevation - f.elevation : MASS.topFloorH;
}

function footprintWorld(f) {
  if (!f.footprint) return null;
  const [a, b, c, e] = f.footprint;
  const [x0, z0] = worldXZ(f, a, b), [x1, z1] = worldXZ(f, c, e);
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) };
}

const matSlab = new THREE.MeshStandardMaterial({
  color: 0x7f96ad, roughness: .95, metalness: 0, transparent: true, opacity: .22, side: THREE.DoubleSide });
const matWallShared = new THREE.MeshStandardMaterial({
  color: 0xa9bdd1, roughness: .95, metalness: 0, transparent: true, opacity: .55,
  side: THREE.DoubleSide, depthWrite: false });

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const matCab = new THREE.MeshStandardMaterial({
  color: 0x4f7f9c, roughness: .55, metalness: .25, transparent: true, opacity: .85 });
const matDoor = new THREE.MeshStandardMaterial({
  color: 0xf0a84a, roughness: .6, metalness: .05, emissive: 0x3a2408,
  transparent: true, opacity: .9 });

const DOOR_H = 2.1;          // chiều cao ô cửa (m)
const CAB_H = 2.0;           // chiều cao tủ / thiết bị (m)


// ---- sửa đổi do người dùng thực hiện trên các đối tượng bóc từ bản vẽ
// Toa do binh: uu tien vi tri nguoi dung da doi tay, khong co thi lay ban goc.
function viTriBinh(it) {
  const doi = editsOf(floorOf(it.floor).page).movItem[it.id];
  return doi ? doi : [it.bx, it.by];
}

function editsOf(page) {
  if (!state.edits[page]) state.edits[page] = {};
  const e = state.edits[page];
  e.delWall = e.delWall || []; e.delCab = e.delCab || [];
  e.toCab = e.toCab || []; e.toWall = e.toWall || [];
  e.delDoor = e.delDoor || [];      // cánh cửa bóc từ bản vẽ
  e.delItem = e.delItem || [];      // bình chữa cháy bóc từ bản vẽ (theo mã bình)
  e.delExit = e.delExit || [];      // đèn EXIT bóc từ bản vẽ đã xoá
  e.movExit = e.movExit || {};      // đèn EXIT đã dời: mã đèn -> [bx, by]
  e.movItem = e.movItem || {};      // bình chữa cháy đã dời: mã bình -> [bx, by]
  e.matExit = e.matExit || {};      // đèn EXIT đặt mặt nào của cửa: mã đèn -> 1 (trước) / -1 (sau)
  return e;
}

// ---- mô hình máy biến áp: thùng dầu + cánh tản nhiệt + sứ cao thế + bình dầu phụ
const MAT_TRA = {
  tank: new THREE.MeshStandardMaterial({ color: 0x8e9aa6, roughness: .55, metalness: .45 }),
  fin: new THREE.MeshStandardMaterial({ color: 0x7c8894, roughness: .7, metalness: .35 }),
  ins: new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: .45 }),
  sel: new THREE.MeshStandardMaterial({ color: 0xffc14d, roughness: .4, emissive: 0x4a3300 }),
};

function makeTransformer(w, d, h, selected) {
  // Máy biến áp dầu 3 pha. Các chi tiết được dựng theo KÍCH THƯỚC THẬT (mét) chứ
  // không co giãn theo khung: máy to lên thì SỐ LƯỢNG cánh tản nhiệt, gân thùng,
  // bánh xe tăng theo, còn từng chi tiết vẫn giữ cỡ thật -> nhìn vẫn ra máy biến áp.
  const g = new THREE.Group();
  const M = selected ? MAT_TRA.sel : null;
  const vl = k => M || MAT_TRA[k];
  const kep = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const hop = (x, y, z, a, b, c, k) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(.02, a), Math.max(.02, b), Math.max(.02, c)), vl(k));
    m.position.set(x, y, z); g.add(m); return m;
  };
  const tru = (x, y, z, r1, r2, L, k, truc) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, L, 14), vl(k));
    m.position.set(x, y, z);
    if (truc === 'z') m.rotation.x = Math.PI / 2;
    if (truc === 'x') m.rotation.z = Math.PI / 2;
    g.add(m); return m;
  };

  // ----- kích thước thật, có chặn trên/dưới theo khung người dùng kéo
  const rBanh = kep(h * .045, .12, .28);              // bánh xe Ø24–56 cm
  const hDe = kep(h * .05, .12, .35);                 // khung đế
  const yThung = rBanh * 2 + hDe;
  const hThung = Math.max(.6, h * .50);
  const wThung = w * .66, dThung = d * .78;
  const dayGan = kep(w * .03, .06, .14);              // gân thùng
  const dayCanh = kep(d * .022, .05, .12);            // cánh tản nhiệt
  const sauCanh = kep(w * .14, .25, .70);             // chiều nhô của dàn tản nhiệt

  // ----- bánh xe: cứ ~2,5 m một cặp, tối thiểu 2 cặp
  const nBanh = Math.max(2, Math.round(wThung / 2.5) + 1);
  for (let i = 0; i < nBanh; i++) {
    const x = nBanh === 1 ? 0 : -wThung * .42 + wThung * .84 * i / (nBanh - 1);
    for (const sz of [-1, 1])
      tru(x, rBanh, sz * dThung * .52, rBanh, rBanh, kep(w * .07, .14, .32), 'fin', 'x');
  }
  hop(0, rBanh * 2 + hDe / 2, 0, w * .80, hDe, d * .90, 'fin');
  for (const sz of [-1, 1])
    hop(0, rBanh * 2 + hDe / 2, sz * d * .40, w * .86, hDe * 1.1, kep(d * .07, .15, .45), 'fin');

  // ----- thùng dầu + gân đứng, cứ ~1,2 m một gân
  hop(0, yThung + hThung / 2, 0, wThung, hThung, dThung, 'tank');
  const nGan = kep(Math.round(wThung / 1.2), 2, 10);
  for (let i = 0; i < nGan; i++) {
    const x = -wThung * .38 + wThung * .76 * (nGan === 1 ? .5 : i / (nGan - 1));
    for (const sz of [-1, 1])
      hop(x, yThung + hThung / 2, sz * (dThung / 2 + .015), dayGan, hThung * .96, .03, 'fin');
  }
  const dayNap = kep(h * .024, .06, .12);
  hop(0, yThung + hThung + dayNap / 2, 0, wThung * 1.06, dayNap, dThung * 1.06, 'fin');
  hop(0, yThung + kep(h * .02, .05, .12), 0, wThung * 1.03, kep(h * .02, .05, .12), dThung * 1.03, 'fin');

  // ----- hai dàn tản nhiệt: số cánh theo chiều dài thùng (~0,32 m một cánh)
  const nCanh = kep(Math.round(dThung / .32), 5, 26);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < nCanh; i++) {
      const z = -dThung * .42 + dThung * .84 * i / (nCanh - 1);
      hop(sx * (wThung / 2 + sauCanh / 2), yThung + hThung * .52, z,
          sauCanh, hThung * .72, dayCanh, 'fin');
    }
    const rOng = kep(d * .018, .04, .10);
    for (const yy of [yThung + hThung * .88, yThung + hThung * .16])
      tru(sx * (wThung / 2 + sauCanh / 2), yy, 0, rOng, rOng, dThung * .88, 'fin', 'z');
  }

  // ----- bình dầu phụ nằm dọc cạnh dài
  const rBinh = kep(h * .075, .18, .55);
  const yBinh = yThung + hThung + rBinh + kep(h * .05, .12, .35);
  const ngangX = wThung >= dThung;
  const Lbinh = (ngangX ? wThung : dThung) * .62;
  const zBinh = ngangX ? -dThung * .30 : 0, xBinh = ngangX ? 0 : -wThung * .28;
  tru(xBinh, yBinh, zBinh, rBinh, rBinh, Lbinh, 'tank', ngangX ? 'x' : 'z');
  for (const sg of [-1, 1]) {
    const gx = ngangX ? sg * Lbinh * .36 : xBinh, gz = ngangX ? zBinh : sg * Lbinh * .36;
    hop(gx, yThung + hThung + rBinh * .5, gz, rBinh * 1.2, rBinh, rBinh * 1.2, 'fin');
  }
  tru(ngangX ? -Lbinh * .34 : xBinh + wThung * .16, yThung + hThung + kep(h * .10, .25, .7),
      ngangX ? zBinh : dThung * .34, kep(h * .018, .04, .10), kep(h * .018, .04, .10),
      kep(h * .12, .3, .8), 'ins');                         // ống thở hút ẩm

  // ----- sứ: luôn 3 cao thế + 3 hạ thế, cỡ theo chiều cao máy
  const caoSu = kep(h * .20, .5, 1.6), rSu = kep(h * .028, .06, .16);
  const suCao = (x, z, cao, r) => {
    const n = kep(Math.round(cao / .12), 4, 10);
    for (let i = 0; i < n; i++) {
      const y = yThung + hThung + dayNap + cao * (i + .5) / n;
      tru(x, y, z, r * (1 - .05 * i), r * (1 - .05 * i), cao / n * .7, 'ins');
      const tan = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 1.35, r * 1.55, cao / n * .18, 16), vl('ins'));
      tan.position.set(x, y + cao / n * .26, z); g.add(tan);
    }
    tru(x, yThung + hThung + dayNap + cao + r * .6, z, r * .35, r * .35, r * 1.6, 'fin');
    hop(x, yThung + hThung + dayNap, z, r * 2.6, dayNap * .8, r * 2.6, 'fin');
  };
  const doc = wThung >= dThung;
  const buoc = kep((doc ? wThung : dThung) * .27, rSu * 4, 3.0);   // 3 sứ không văng quá xa nhau
  for (let i = -1; i <= 1; i++) {
    const x1 = doc ? i * buoc : wThung * .16, z1 = doc ? dThung * .18 : i * buoc;
    suCao(x1, z1, caoSu, rSu);
    const x2 = doc ? i * buoc * .72 : -wThung * .10, z2 = doc ? -dThung * .06 : i * buoc * .72;
    suCao(x2, z2, caoSu * .55, rSu * .68);
  }

  // ----- bộ đổi nấc, hộp đấu dây, móc cẩu (cỡ thật)
  const cot = kep(h * .07, .18, .45);
  tru(wThung * .5 + cot * .5, yThung + hThung * .72, dThung * .30, cot * .5, cot * .5, cot, 'fin', 'x');
  hop(wThung * .5 + cot * 1.1, yThung + hThung * .72, dThung * .30, cot * .6, cot * 1.1, cot * 1.1, 'tank');
  hop(-wThung * .5 - cot * .4, yThung + hThung * .45, -dThung * .34, cot * .8, cot * 1.5, cot * 1.5, 'fin');
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    hop(sx * wThung * .44, yThung + hThung + dayNap + cot * .35, sz * dThung * .44,
        cot * .5, cot * .7, cot * .35, 'fin');
  return g;
}


// ---- lan can & cầu thang
const MAT_RAIL = new THREE.MeshStandardMaterial({ color: 0xc9d4de, roughness: .35, metalness: .75 });
const MAT_STEP = new THREE.MeshStandardMaterial({ color: 0xb9c3cd, roughness: .85, metalness: .05 });

function makeRailing(len, h, mat) {
  const g = new THREE.Group();
  const m = mat || MAT_RAIL;
  const bar = (y, t) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(len, t, t), m);
    b.position.set(0, y, 0); g.add(b);
  };
  bar(h, .055);                       // tay vịn
  bar(h * .55, .04);                  // thanh giữa
  const n = Math.max(2, Math.round(len / 1.2) + 1);
  for (let i = 0; i < n; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(.05, h, .05), m);
    p.position.set(-len / 2 + len * i / (n - 1), h / 2, 0);
    g.add(p);
  }
  return g;
}

function makeStair(len, w, h, mat) {
  const g = new THREE.Group();
  const mStep = mat || MAT_STEP, mRail = mat || MAT_RAIL;
  const n = Math.max(3, Math.round(h / 0.34));      // số bậc
  const rise = h / n, tread = len / n;
  for (let i = 0; i < n; i++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(tread, rise, w), mStep);
    st.position.set(-len / 2 + tread * (i + .5), rise * (i + .5), 0);
    g.add(st);
  }
  // hai bên: tay vịn nghiêng theo dốc thang
  const slope = Math.atan2(h, len), diag = Math.hypot(len, h);
  for (const side of [-1, 1]) {
    const hr = new THREE.Mesh(new THREE.BoxGeometry(diag, .055, .055), mRail);
    hr.position.set(0, h / 2 + .95, side * (w / 2 - .04));
    hr.rotation.z = slope;
    g.add(hr);
    const np = Math.max(2, Math.round(diag / 1.3) + 1);
    for (let i = 0; i < np; i++) {
      const t = i / (np - 1);
      const p = new THREE.Mesh(new THREE.BoxGeometry(.05, .95, .05), mRail);
      p.position.set(-len / 2 + len * t, h * t + .95 / 2 + rise, side * (w / 2 - .04));
      g.add(p);
    }
  }
  return g;
}


// Các ô thông tầng cắt qua sàn của cao trình này: lỗ vẽ ngay tại tầng, cộng thêm
// lỗ vẽ ở các cao trình TRÊN có đặt "thông xuống n cao trình".
function loSanCuaTang(f) {
  const ra = [];
  // Đang đi bộ: khoét sàn quanh đầu các vế thang từ cao trình dưới lên, nếu
  // không thì sàn liền một tấm, đứng trên nhìn xuống chẳng thấy thang đâu.
  if (typeof wk !== 'undefined' && wk.on && wk.f && wk.f.page === f.page) {
    for (const t of thangXuong(f)) {
      const r = 1.6;
      ra.push({ pts: [[t.x - r, t.z - r], [t.x + r, t.z - r], [t.x + r, t.z + r], [t.x - r, t.z + r]] });
    }
  }
  const ds = (state.data && state.data.floors) || [];
  for (const g of ds) {
    if (g.elevation < f.elevation) continue;            // chỉ tầng này và tầng trên
    const duoi = ds.filter(x => x.elevation < g.elevation && x.elevation >= f.elevation).length;
    for (const o of customOf(g.page)) {
      if (o.type !== 'lo') continue;
      const n = Math.max(1, Math.round(o.tang || 1));
      if (g.page === f.page) { if (n < 1) continue; }
      else if (duoi >= n) continue;                     // không với tới tầng này
      const dsPts = o.pts && o.pts.length >= 3
        ? o.pts
        : [[o.u0, o.v0], [o.u1, o.v0], [o.u1, o.v1], [o.u0, o.v1]];
      ra.push({ pts: dsPts.map(q => worldXZ(f, q[0], q[1])) });
    }
  }
  return ra;
}



// ---------------------------------------------------------------------------
// TỰ TẠO TẤM SÀN THEO BỜ TƯỜNG: bấm một điểm trong phòng -> loang tới khi chạm
// tường (kể cả tường bóc từ bản vẽ lẫn tường tự vẽ), rồi lần biên thành đa giác.
// ---------------------------------------------------------------------------

// ---- đọc nét mực của ảnh bản vẽ để làm ranh giới sàn (chính xác hơn tường bóc)
const _muc = {};
function mucCuaTang(f) {
  if (_muc[f.page] !== undefined) return _muc[f.page];
  _muc[f.page] = null;                                   // đánh dấu đang nạp
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    const W = Math.min(1600, img.width), H = Math.round(img.height * W / img.width);
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const l = (d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114);
      m[i] = (d[i * 4 + 3] > 40 && l < 120) ? 1 : 0;      // chỉ nét ĐẬM mới là ranh giới
    }
    const [x0, y0, x1, y1] = f.box;
    const a = worldXZ(f, x0, y0), b = worldXZ(f, x1, y1);
    _muc[f.page] = { m: m, W: W, H: H,
      x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]),
      z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) };
    hint('Đã nạp nét bản vẽ của ' + f.name + ' — bấm vào giữa phòng để tạo sàn');
    setTimeout(() => hint(''), 2500);
  };
  img.src = duongDL('floors/') + f.image;
  return null;
}

const BUOC_SAN = 0.3;           // độ mịn khi loang (m)

function luoiTuong(f) {
  const fp = footprintWorld(f);
  if (!fp) return null;
  const nx = Math.ceil((fp.x1 - fp.x0) / BUOC_SAN), nz = Math.ceil((fp.z1 - fp.z0) / BUOC_SAN);
  const can = [];
  const ed = editsOf(f.page);
  (f.walls || []).forEach((r, i) => {
    if (ed.delWall.indexOf(i) >= 0) return;
    const a = worldXZ(f, r[0], r[1]), b = worldXZ(f, r[2], r[3]);
    can.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
  });
  (f.cabinets || []).forEach((r, i) => {
    if (ed.delCab.indexOf(i) >= 0 || ed.toWall.indexOf(i) < 0) return;
    const a = worldXZ(f, r[0], r[1]), b = worldXZ(f, r[2], r[3]);
    can.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
  });
  for (const o of customOf(f.page)) {
    // Tường VÀ lan can đều là mép sàn: có lan can nghĩa là sàn dừng ở đó.
    if (o.type !== 'wall' && o.type !== 'rail') continue;
    const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
    const t = (o.type === 'rail' ? .10 : (o.t || .22) / 2);
    can.push([Math.min(a[0], b[0]) - t, Math.min(a[1], b[1]) - t,
              Math.max(a[0], b[0]) + t, Math.max(a[1], b[1]) + t]);
  }
  const muc = mucCuaTang(f);
  // Một ô lưới chỉ bị coi là "nét chặn" khi PHẦN LỚN ô là mực đậm. Nhờ vậy các
  // mảng gạch chéo (nét mảnh, thưa) không chặn, còn tường đặc thì chặn.
  const coMuc = (x, z) => {
    if (!muc) return false;
    const sx = (muc.W - 1) / (muc.x1 - muc.x0), sz = (muc.H - 1) / (muc.z1 - muc.z0);
    const a0 = Math.round((x - BUOC_SAN / 2 - muc.x0) * sx), a1 = Math.round((x + BUOC_SAN / 2 - muc.x0) * sx);
    const b0 = Math.round((z - BUOC_SAN / 2 - muc.z0) * sz), b1 = Math.round((z + BUOC_SAN / 2 - muc.z0) * sz);
    if (a1 < 0 || b1 < 0 || a0 >= muc.W || b0 >= muc.H) return true;   // ngoài bản vẽ
    let den = 0, tong = 0;
    for (let a = Math.max(0, a0); a <= Math.min(muc.W - 1, a1); a++)
      for (let b = Math.max(0, b0); b <= Math.min(muc.H - 1, b1); b++) {
        tong++; if (muc.m[b * muc.W + a]) den++;
      }
    return tong > 0 && den / tong > 0.45;
  };
  const o = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++) {
    const x = fp.x0 + (i + .5) * BUOC_SAN;
    for (let j = 0; j < nz; j++) {
      const z = fp.z0 + (j + .5) * BUOC_SAN;
      o[i * nz + j] = (can.some(c => x >= c[0] && x <= c[2] && z >= c[1] && z <= c[3]) || coMuc(x, z)) ? 0 : 1;
    }
  }
  return { fp: fp, nx: nx, nz: nz, o: o, coMuc: !!muc };
}

// bấm một điểm -> tạo tấm sàn ôm theo bờ tường quanh điểm đó
// Lưới mịn chỉ chặn bằng TUYẾN TƯỜNG (không dùng nét ảnh), để loang ra đúng
// căn phòng mà người dùng đã quây tường.
const O_SAN = 0.25;
function luoiTheoTuong(f) {
  const fp = footprintWorld(f);
  if (!fp) return null;
  const tuong = [];
  const them = (ax, az, bx, bz, day) => {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < .25) return;
    tuong.push({ ax: ax, az: az, ux: (bx - ax) / L, uz: (bz - az) / L, L: L, day: Math.max(.08, day || .2) });
  };
  for (const o of customOf(f.page)) {
    if (o.type !== 'wall' && o.type !== 'rail') continue;
    const p = worldXZ(f, o.u0, o.v0), q = worldXZ(f, o.u1, o.v1);
    them(p[0], p[1], q[0], q[1], o.type === 'rail' ? .12 : (o.t || .22));
  }
  const ed = editsOf(f.page);
  (f.walls || []).forEach((r, i) => {
    if (ed.delWall.indexOf(i) >= 0) return;
    const ngang = (r[2] - r[0]) >= (r[3] - r[1]);
    const p = worldXZ(f, ngang ? r[0] : (r[0] + r[2]) / 2, ngang ? (r[1] + r[3]) / 2 : r[1]);
    const q = worldXZ(f, ngang ? r[2] : (r[0] + r[2]) / 2, ngang ? (r[1] + r[3]) / 2 : r[3]);
    them(p[0], p[1], q[0], q[1], (ngang ? r[3] - r[1] : r[2] - r[0]) * mpp());
  });
  for (const w of tuyenTuong(f)) them(w.x0, w.z0, w.x1, w.z1, w.day);
  const nx = Math.ceil((fp.x1 - fp.x0) / O_SAN), nz = Math.ceil((fp.z1 - fp.z0) / O_SAN);
  const o = new Uint8Array(nx * nz).fill(1);
  for (const w of tuong) {                       // tô các ô nằm trong bề dày tường
    const b = w.day / 2 + O_SAN * .5;
    for (let t = -b; t <= w.L + b; t += O_SAN * .5) {
      for (let n = -b; n <= b; n += O_SAN * .5) {
        const x = w.ax + w.ux * t - w.uz * n, z = w.az + w.uz * t + w.ux * n;
        const i = Math.floor((x - fp.x0) / O_SAN), j = Math.floor((z - fp.z0) / O_SAN);
        if (i >= 0 && j >= 0 && i < nx && j < nz) o[i * nz + j] = 0;
      }
    }
  }
  return { fp: fp, nx: nx, nz: nz, o: o,
    iOf: x => Math.floor((x - fp.x0) / O_SAN), jOf: z => Math.floor((z - fp.z0) / O_SAN),
    xOf: i => fp.x0 + (i + .5) * O_SAN, zOf: j => fp.z0 + (j + .5) * O_SAN };
}

function sanTheoTuong(f, x, z) {
  const L = luoiTheoTuong(f);
  if (!L) { hint('Cao trình này chưa có khung mặt bằng'); return false; }
  const i0 = L.iOf(x), j0 = L.jOf(z);
  if (i0 < 0 || j0 < 0 || i0 >= L.nx || j0 >= L.nz || !L.o[i0 * L.nz + j0]) {
    hint('Chỗ bấm trùng tường — hãy bấm vào khoảng trống trong phòng');
    setTimeout(() => hint(''), 2600);
    return false;
  }
  // ô sàn đã có thì không làm chồng
  for (const o of customOf(f.page)) {
    if (o.type !== 'san' || !o.pts || o.pts.length < 3) continue;
    if (trongDaGiac(o.pts.map(p => worldXZ(f, p[0], p[1])), x, z)) {
      hint('Chỗ này đã có tấm sàn rồi'); setTimeout(() => hint(''), 2200); return false;
    }
  }
  // LOANG trong phạm vi tường đã vây
  const m = new Uint8Array(L.nx * L.nz);
  const q = [i0 * L.nz + j0]; m[q[0]] = 1;
  const GH = 200000;
  for (let h = 0; h < q.length; h++) {
    if (q.length > GH) break;
    const c = q[h], ci = (c / L.nz) | 0, cj = c % L.nz;
    for (const k of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ci + k[0], nj = cj + k[1];
      if (ni < 0 || nj < 0 || ni >= L.nx || nj >= L.nz) continue;
      const n = ni * L.nz + nj;
      if (m[n] || !L.o[n]) continue;
      m[n] = 1; q.push(n);
    }
  }
  const dt = q.length * O_SAN * O_SAN;
  if (dt < 0.8) { hint('Khoảng trống quá nhỏ'); setTimeout(() => hint(''), 2200); return false; }
  // Đổi vùng loang thành ĐA GIÁC bằng cách gom từng hàng ô thành dải chữ nhật,
  // rồi nối các dải cùng bề ngang lại -> ít đỉnh mà vẫn khít mép tường.
  const dai = [];
  for (let j = 0; j < L.nz; j++) {
    let i = 0;
    while (i < L.nx) {
      if (!m[i * L.nz + j]) { i++; continue; }
      let k = i;
      while (k + 1 < L.nx && m[(k + 1) * L.nz + j]) k++;
      dai.push([j, i, k]);
      i = k + 1;
    }
  }
  const nhom = [];
  for (const [j, i0d, i1d] of dai) {
    const tr = nhom.length ? nhom[nhom.length - 1] : null;
    if (tr && tr.i0 === i0d && tr.i1 === i1d && tr.j1 === j - 1) tr.j1 = j;
    else nhom.push({ i0: i0d, i1: i1d, j0: j, j1: j });
  }
  const ra = [];
  for (const g of nhom) {
    const x0 = L.fp.x0 + g.i0 * O_SAN, x1 = L.fp.x0 + (g.i1 + 1) * O_SAN;
    const z0 = L.fp.z0 + g.j0 * O_SAN, z1 = L.fp.z0 + (g.j1 + 1) * O_SAN;
    if ((x1 - x0) < .4 || (z1 - z0) < .4) continue;
    ra.push([x0, z0, x1, z1]);
  }
  if (!ra.length) { hint('Không dựng được tấm sàn ở đây'); setTimeout(() => hint(''), 2200); return false; }
  chup();
  let n = customOf(f.page).filter(o => o.type === 'san').length;
  for (const [x0, z0, x1, z1] of ra) {
    const goc = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const uv = goc.map(p => baseFromWorld(f, p[0], p[1])).map(qq => [round2(qq[0]), round2(qq[1])]);
    const xs = uv.map(qq => qq[0]), ys = uv.map(qq => qq[1]);
    n++;
    customOf(f.page).push({ id: 'C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      type: 'san', pts: uv,
      u0: Math.min(...xs), v0: Math.min(...ys), u1: Math.max(...xs), v1: Math.max(...ys),
      h: 0, base: 0, name: 'Tấm sàn ' + n + ' — ' + ((x1 - x0) * (z1 - z0)).toFixed(0) + ' m²' });
  }
  saveCustom(); rebuildCustom(); rebuildMasses();
  hint('Đã tạo sàn ' + dt.toFixed(0) + ' m² bám đúng mặt trong tường (' + ra.length + ' mảnh)');
  setTimeout(() => hint(''), 3000);
  return true;
}



// ---------------------------------------------------------------------------
// CẮT SÀN DƯ + NỐI HAI TẤM SÀN GẦN NHAU
// ---------------------------------------------------------------------------
// Tấm sàn có đúng 4 đỉnh và các cạnh song song trục thì coi là hình chữ nhật;
// tấm đã gộp (hình chữ L, nhiều đỉnh) được giữ nguyên, không bóp về khung bao.
function laChuNhat(pts) {
  if (!pts || pts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    if (Math.abs(a[0] - b[0]) > 0.01 && Math.abs(a[1] - b[1]) > 0.01) return false;
  }
  return true;
}
function hopSan(f) {                 // các tấm sàn -> hình chữ nhật thế giới
  return customOf(f.page).filter(o => o.type === 'san' && o.pts && laChuNhat(o.pts))
    .map(o => {
      const p = o.pts.map(q => worldXZ(f, q[0], q[1]));
      return { o: o,
        x0: Math.min(...p.map(q => q[0])), x1: Math.max(...p.map(q => q[0])),
        z0: Math.min(...p.map(q => q[1])), z1: Math.max(...p.map(q => q[1])) };
    });
}
function ghiSan(f, ds) {             // ghi lại danh sách tấm sàn của cao trình
  // giữ nguyên các tấm đa giác (đã gộp) — chỉ ghi đè các tấm chữ nhật
  const con = customOf(f.page).filter(o => o.type !== 'san' ||
    (o.pts && !laChuNhat(o.pts)));
  let n = 0;
  for (const h of ds) {
    if (h.x1 - h.x0 < .35 || h.z1 - h.z0 < .35) continue;
    const goc = [[h.x0, h.z0], [h.x1, h.z0], [h.x1, h.z1], [h.x0, h.z1]];
    const uv = goc.map(p => baseFromWorld(f, p[0], p[1])).map(q => [round2(q[0]), round2(q[1])]);
    const xs = uv.map(q => q[0]), ys = uv.map(q => q[1]);
    n++;
    con.push({ id: (h.o && h.o.id) || ('C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
      type: 'san', pts: uv,
      u0: Math.min(...xs), v0: Math.min(...ys), u1: Math.max(...xs), v1: Math.max(...ys),
      h: 0, base: 0,
      name: 'Tấm sàn ' + n + ' — ' + ((h.x1 - h.x0) * (h.z1 - h.z0)).toFixed(0) + ' m²' });
  }
  state.custom[f.page] = con;
  saveCustom(); rebuildCustom(); rebuildMasses();
  return n;
}

// Cắt bỏ phần sàn nằm trong khung vừa khoanh; phần còn lại chia thành các mảnh
function catSan(f, kx0, kz0, kx1, kz1) {
  const ds = hopSan(f);
  if (!ds.length) { hint('Cao trình này chưa có tấm sàn nào'); setTimeout(() => hint(''), 2200); return; }
  chup();
  const ra = [];
  let cat = 0;
  for (const h of ds) {
    const gx = Math.min(h.x1, kx1) - Math.max(h.x0, kx0);
    const gz = Math.min(h.z1, kz1) - Math.max(h.z0, kz0);
    if (gx <= .02 || gz <= .02) { ra.push(h); continue; }
    cat++;
    const cx0 = Math.max(h.x0, kx0), cx1 = Math.min(h.x1, kx1);
    const cz0 = Math.max(h.z0, kz0), cz1 = Math.min(h.z1, kz1);
    if (h.z0 < cz0) ra.push({ o: null, x0: h.x0, x1: h.x1, z0: h.z0, z1: cz0 });
    if (cz1 < h.z1) ra.push({ o: null, x0: h.x0, x1: h.x1, z0: cz1, z1: h.z1 });
    if (h.x0 < cx0) ra.push({ o: null, x0: h.x0, x1: cx0, z0: cz0, z1: cz1 });
    if (cx1 < h.x1) ra.push({ o: null, x0: cx1, x1: h.x1, z0: cz0, z1: cz1 });
  }
  const n = ghiSan(f, ra);
  hint('Đã cắt sàn ở ' + cat + ' tấm — còn ' + n + ' tấm');
  setTimeout(() => hint(''), 3000);
}

// Nối hai tấm sàn gần nhau nhất: chèn dải nối cho sàn liền mạch rồi hợp lại
function gopSanGanNhat(f) {
  const ds = hopSan(f);
  if (ds.length < 2) { hint('Cần ít nhất hai tấm sàn'); setTimeout(() => hint(''), 2200); return; }
  let tot = null;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const A = ds[i], B = ds[j];
      const dx = Math.max(0, Math.max(A.x0, B.x0) - Math.min(A.x1, B.x1));
      const dz = Math.max(0, Math.max(A.z0, B.z0) - Math.min(A.z1, B.z1));
      const d = Math.hypot(dx, dz);
      if (!tot || d < tot.d) tot = { d: d, i: i, j: j, dx: dx, dz: dz };
    }
  }
  if (!tot) return;
  chup();
  const A = ds[tot.i], B = ds[tot.j];
  const px = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
  const pz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
  let noi = null;
  if (px > .3 && tot.dz > 0) {
    noi = { o: null, x0: Math.max(A.x0, B.x0), x1: Math.min(A.x1, B.x1),
            z0: Math.min(A.z1, B.z1), z1: Math.max(A.z0, B.z0) };
  } else if (pz > .3 && tot.dx > 0) {
    noi = { o: null, x0: Math.min(A.x1, B.x1), x1: Math.max(A.x0, B.x0),
            z0: Math.max(A.z0, B.z0), z1: Math.min(A.z1, B.z1) };
  }
  const ra = ds.slice();
  if (noi && noi.x1 - noi.x0 > .2 && noi.z1 - noi.z0 > .2) ra.push(noi);
  const gan = (a, b) => Math.abs(a - b) < .12;
  let doi = true;
  while (doi) {
    doi = false;
    for (let i = 0; i < ra.length && !doi; i++) {
      for (let j = i + 1; j < ra.length && !doi; j++) {
        const P = ra[i], Q = ra[j];
        if (gan(P.x0, Q.x0) && gan(P.x1, Q.x1) &&
            Math.min(P.z1, Q.z1) >= Math.max(P.z0, Q.z0) - .12) {
          P.z0 = Math.min(P.z0, Q.z0); P.z1 = Math.max(P.z1, Q.z1); ra.splice(j, 1); doi = true;
        } else if (gan(P.z0, Q.z0) && gan(P.z1, Q.z1) &&
            Math.min(P.x1, Q.x1) >= Math.max(P.x0, Q.x0) - .12) {
          P.x0 = Math.min(P.x0, Q.x0); P.x1 = Math.max(P.x1, Q.x1); ra.splice(j, 1); doi = true;
        }
      }
    }
  }
  const n = ghiSan(f, ra);
  hint(noi ? ('Đã nối hai tấm sàn cách nhau ' + tot.d.toFixed(2) + ' m — còn ' + n + ' tấm')
           : ('Hai tấm gần nhất không thẳng hàng, chỉ hợp phần giáp nhau — còn ' + n + ' tấm'));
  setTimeout(() => hint(''), 3500);
}


// ---------------------------------------------------------------------------
// GỘP HAI MÉP SÀN: bấm vào tấm thứ nhất rồi tấm thứ hai, hai mép đối diện của
// chúng được kéo về cùng một đường -> sàn giáp nhau khít, hết khe và hết chồng.
// ---------------------------------------------------------------------------
const gm = { a: null };

function sanTaiDiem(f, x, z) {
  for (const h of hopSan(f)) {
    if (x >= h.x0 - .05 && x <= h.x1 + .05 && z >= h.z0 - .05 && z <= h.z1 + .05) return h;
  }
  return null;
}

function gopMepSan(f, x, z) {
  const h = sanTaiDiem(f, x, z);
  if (!h) { hint('Bấm trúng vào một tấm sàn'); setTimeout(() => hint(''), 2000); return; }
  if (!gm.a) {
    gm.a = h.o.id;
    hint('Đã chọn "' + (h.o.name || 'tấm sàn') + '" — bấm tiếp tấm thứ hai để gộp hai mép');
    return;
  }
  if (gm.a === h.o.id) { gm.a = null; hint('Đã bỏ chọn'); setTimeout(() => hint(''), 1500); return; }
  const ds = hopSan(f);
  const A = ds.find(q => q.o.id === gm.a), B = ds.find(q => q.o.id === h.o.id);
  gm.a = null;
  if (!A || !B) return;
  chup();
  const px = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);   // bề gối theo trục x
  const pz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);   // bề gối theo trục z
  let mo = '';
  if (px >= pz) {                       // hai tấm nằm trên/dưới nhau -> gộp mép ngang
    const tren = A.z1 <= B.z1 ? A : B, duoi = tren === A ? B : A;
    const giua = (tren.z1 + duoi.z0) / 2;
    tren.z1 = giua; duoi.z0 = giua;
    mo = 'mép ngang';
  } else {                              // hai tấm cạnh nhau -> gộp mép dọc
    const trai = A.x1 <= B.x1 ? A : B, phai = trai === A ? B : A;
    const giua = (trai.x1 + phai.x0) / 2;
    trai.x1 = giua; phai.x0 = giua;
    mo = 'mép dọc';
  }
  // Nhập hai tấm thành MỘT: cùng bề ngang thì ra hình chữ nhật, khác bề ngang
  // thì ra đa giác chữ L ôm trọn cả hai — sàn liền một mảnh, không còn hai vật.
  const gan = (a, b) => Math.abs(a - b) < .12;
  const ra = ds.filter(q => q !== A && q !== B);
  let dinh = null;
  if (gan(A.x0, B.x0) && gan(A.x1, B.x1)) {
    ra.push({ o: A.o, x0: Math.min(A.x0, B.x0), x1: Math.max(A.x1, B.x1),
              z0: Math.min(A.z0, B.z0), z1: Math.max(A.z1, B.z1) });
    mo += ' + nhập thành một tấm';
  } else if (gan(A.z0, B.z0) && gan(A.z1, B.z1)) {
    ra.push({ o: A.o, x0: Math.min(A.x0, B.x0), x1: Math.max(A.x1, B.x1),
              z0: Math.min(A.z0, B.z0), z1: Math.max(A.z1, B.z1) });
    mo += ' + nhập thành một tấm';
  } else if (px >= pz) {                        // xếp trên/dưới -> đa giác chữ L đứng
    const T = A.z1 <= B.z1 ? A : B, D = T === A ? B : A;
    const zm = (T.z1 + D.z0) / 2;
    dinh = [[T.x0, T.z0], [T.x1, T.z0], [T.x1, zm], [D.x1, zm],
            [D.x1, D.z1], [D.x0, D.z1], [D.x0, zm], [T.x0, zm]];
    mo += ' + nhập thành một tấm hình chữ L';
  } else {                                      // cạnh nhau -> đa giác chữ L ngang
    const T = A.x1 <= B.x1 ? A : B, P = T === A ? B : A;
    const xm = (T.x1 + P.x0) / 2;
    dinh = [[T.x0, T.z0], [xm, T.z0], [xm, P.z0], [P.x1, P.z0],
            [P.x1, P.z1], [xm, P.z1], [xm, T.z1], [T.x0, T.z1]];
    mo += ' + nhập thành một tấm hình chữ L';
  }
  let n = ghiSan(f, ra);
  if (dinh) {
    const loc = [];
    for (const p of dinh) {                     // bỏ đỉnh trùng nhau
      const q = loc[loc.length - 1];
      if (!q || Math.abs(q[0] - p[0]) > 0.01 || Math.abs(q[1] - p[1]) > 0.01) loc.push(p);
    }
    const uv = loc.map(p => baseFromWorld(f, p[0], p[1])).map(q => [round2(q[0]), round2(q[1])]);
    const xs = uv.map(q => q[0]), ys = uv.map(q => q[1]);
    let dt = 0;                                 // diện tích đa giác
    for (let i = 0; i < loc.length; i++) {
      const a2 = loc[i], b2 = loc[(i + 1) % loc.length];
      dt += a2[0] * b2[1] - b2[0] * a2[1];
    }
    customOf(f.page).push({ id: A.o.id, type: 'san', pts: uv,
      u0: Math.min(...xs), v0: Math.min(...ys), u1: Math.max(...xs), v1: Math.max(...ys),
      h: 0, base: 0,
      name: 'Tấm sàn gộp — ' + Math.abs(dt / 2).toFixed(0) + ' m² (' + uv.length + ' cạnh)' });
    saveCustom(); rebuildCustom(); rebuildMasses();
    n += 1;
  }
  hint('Đã gộp ' + mo + ' — còn ' + n + ' tấm sàn');
  setTimeout(() => hint(''), 3500);
}

// ---------------------------------------------------------------------------
// DỌN MÉP SÀN: đẩy từng mép tấm sàn ra sát mặt trong tường, rồi hợp các tấm
// giáp nhau thành một tấm và bỏ phần chồng lấn.
// ---------------------------------------------------------------------------
function tuongCuaTang(f) {
  const ra = [];
  const them = (ax, az, bx, bz, day) => {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < .25) return;
    ra.push({ ax: ax, az: az, ux: (bx - ax) / L, uz: (bz - az) / L, L: L, day: Math.max(.08, day || .2) });
  };
  for (const o of customOf(f.page)) {
    if (o.type !== 'wall' && o.type !== 'rail') continue;
    const p = worldXZ(f, o.u0, o.v0), q = worldXZ(f, o.u1, o.v1);
    them(p[0], p[1], q[0], q[1], o.type === 'rail' ? .12 : (o.t || .22));
  }
  const ed = editsOf(f.page);
  (f.walls || []).forEach((r, i) => {
    if (ed.delWall.indexOf(i) >= 0) return;
    const ngang = (r[2] - r[0]) >= (r[3] - r[1]);
    const p = worldXZ(f, ngang ? r[0] : (r[0] + r[2]) / 2, ngang ? (r[1] + r[3]) / 2 : r[1]);
    const q = worldXZ(f, ngang ? r[2] : (r[0] + r[2]) / 2, ngang ? (r[1] + r[3]) / 2 : r[3]);
    them(p[0], p[1], q[0], q[1], (ngang ? r[3] - r[1] : r[2] - r[0]) * mpp());
  });
  for (const w of tuyenTuong(f)) them(w.x0, w.z0, w.x1, w.z1, w.day);
  return ra;
}

function donMepSan(f) {
  const ds = customOf(f.page).filter(o => o.type === 'san' && o.pts && o.pts.length >= 3);
  if (!ds.length) { hint('Cao trình này chưa có tấm sàn nào'); setTimeout(() => hint(''), 2200); return; }
  chup();
  const tuong = tuongCuaTang(f);
  const hop = ds.map(o => {
    const p = o.pts.map(q => worldXZ(f, q[0], q[1]));
    return { o: o,
      x0: Math.min(...p.map(q => q[0])), x1: Math.max(...p.map(q => q[0])),
      z0: Math.min(...p.map(q => q[1])), z1: Math.max(...p.map(q => q[1])) };
  });

  // --- 1) đẩy từng mép ra tới mặt trong tường gần nhất (tối đa 4 m)
  const TOI_DA = 4;
  const doXa = (x, z, dx, dz) => {              // khoảng cách tới mặt trong tường
    let gan = TOI_DA + 1;
    for (const w of tuong) {
      const song = Math.abs(w.ux * dx + w.uz * dz);
      if (song > .45) continue;
      const den = dx * w.uz - dz * w.ux;
      if (Math.abs(den) < 1e-6) continue;
      const t = ((w.ax - x) * w.uz - (w.az - z) * w.ux) / den;
      const u = ((w.ax - x) * dz - (w.az - z) * dx) / den;
      if (t <= 0 || u < -.1 || u > w.L + .1) continue;
      const cach = t - w.day / 2;
      if (cach >= -.02 && cach < gan) gan = cach;
    }
    return gan;
  };
  let dayRa = 0;
  for (const h of hop) {
    const canh = [
      { d: [1, 0], lay: () => [[h.x1, h.z0 + .2], [h.x1, (h.z0 + h.z1) / 2], [h.x1, h.z1 - .2]], dat: v => h.x1 += v },
      { d: [-1, 0], lay: () => [[h.x0, h.z0 + .2], [h.x0, (h.z0 + h.z1) / 2], [h.x0, h.z1 - .2]], dat: v => h.x0 -= v },
      { d: [0, 1], lay: () => [[h.x0 + .2, h.z1], [(h.x0 + h.x1) / 2, h.z1], [h.x1 - .2, h.z1]], dat: v => h.z1 += v },
      { d: [0, -1], lay: () => [[h.x0 + .2, h.z0], [(h.x0 + h.x1) / 2, h.z0], [h.x1 - .2, h.z0]], dat: v => h.z0 -= v },
    ];
    for (const c of canh) {
      let it = TOI_DA + 1;
      for (const p of c.lay()) it = Math.min(it, doXa(p[0], p[1], c.d[0], c.d[1]));
      if (it > TOI_DA) continue;                 // không thấy tường -> để nguyên
      if (it > .01) { c.dat(it); dayRa++; }
    }
  }

  // --- 2) bỏ phần chồng lấn: tấm nhỏ hơn lùi lại cho giáp mép tấm lớn
  let catBot = 0;
  hop.sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0));
  for (let i = 0; i < hop.length; i++) {
    for (let j = i + 1; j < hop.length; j++) {
      const A = hop[i], B = hop[j];
      const gx = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
      const gz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
      if (gx <= .02 || gz <= .02) continue;      // không chồng
      if (gx < gz) {                             // chồng ít theo x -> cắt theo x
        if (B.x0 < A.x0) B.x1 = A.x0; else B.x0 = A.x1;
      } else {
        if (B.z0 < A.z0) B.z1 = A.z0; else B.z0 = A.z1;
      }
      catBot++;
    }
  }

  // --- 3) hợp các tấm giáp nhau và cùng bề ngang thành MỘT tấm
  let gop = 0;
  const gan = (a, b) => Math.abs(a - b) < .06;
  let doi = true;
  while (doi) {
    doi = false;
    for (let i = 0; i < hop.length && !doi; i++) {
      for (let j = i + 1; j < hop.length && !doi; j++) {
        const A = hop[i], B = hop[j];
        if (gan(A.x0, B.x0) && gan(A.x1, B.x1) && (gan(A.z1, B.z0) || gan(B.z1, A.z0))) {
          A.z0 = Math.min(A.z0, B.z0); A.z1 = Math.max(A.z1, B.z1);
          hop.splice(j, 1); gop++; doi = true;
        } else if (gan(A.z0, B.z0) && gan(A.z1, B.z1) && (gan(A.x1, B.x0) || gan(B.x1, A.x0))) {
          A.x0 = Math.min(A.x0, B.x0); A.x1 = Math.max(A.x1, B.x1);
          hop.splice(j, 1); gop++; doi = true;
        }
      }
    }
  }

  // --- ghi lại
  const con = customOf(f.page).filter(o => o.type !== 'san');
  let n = 0;
  for (const h of hop) {
    if (h.x1 - h.x0 < .4 || h.z1 - h.z0 < .4) continue;
    const goc = [[h.x0, h.z0], [h.x1, h.z0], [h.x1, h.z1], [h.x0, h.z1]];
    const uv = goc.map(p => baseFromWorld(f, p[0], p[1])).map(q => [round2(q[0]), round2(q[1])]);
    const xs = uv.map(q => q[0]), ys = uv.map(q => q[1]);
    n++;
    con.push({ id: h.o.id, type: 'san', pts: uv,
      u0: Math.min(...xs), v0: Math.min(...ys), u1: Math.max(...xs), v1: Math.max(...ys),
      h: 0, base: 0,
      name: 'Tấm sàn ' + n + ' — ' + ((h.x1 - h.x0) * (h.z1 - h.z0)).toFixed(0) + ' m²' });
  }
  state.custom[f.page] = con;
  saveCustom(); rebuildCustom(); rebuildMasses();
  hint('Dọn sàn: đẩy ' + dayRa + ' mép ra sát tường · cắt ' + catBot + ' chỗ chồng · hợp ' +
       gop + ' tấm · còn ' + n + ' tấm');
  setTimeout(() => hint(''), 5000);
  return { dayRa: dayRa, catBot: catBot, gop: gop, con: n };
}

// Các tấm sàn do người dùng khoanh cho cao trình này. Có ít nhất một tấm thì
// SÀN CHỈ NẰM TRONG các tấm đó — phần còn lại là khoảng không (nhìn thủng xuống).
function tamSanCuaTang(f) {
  const ra = [];
  for (const o of customOf(f.page)) {
    if (o.type !== 'san' || !o.pts || o.pts.length < 3) continue;
    ra.push(o.pts.map(q => worldXZ(f, q[0], q[1])));
  }
  return ra;
}
function trongDaGiac(pts, x, z) {
  let trong = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) trong = !trong;
  }
  return trong;
}

function buildMassing(f) {
  const fp = footprintWorld(f);
  if (!fp) return null;
  const g = new THREE.Group();
  const w = fp.x1 - fp.x0, d = fp.z1 - fp.z0;
  const cx = (fp.x0 + fp.x1) / 2, cz = (fp.z0 + fp.z1) / 2;
  const y = floorY(f);
  const h = Math.max(1.2, floorHeight(f) * state.explode - MASS.slab);
  const dh = Math.min(h * .85, DOOR_H * state.explode);

  // ----- sàn: ưu tiên các tấm sàn người dùng khoanh; nếu không có thì lấy cả khung
  const lo = loSanCuaTang(f);
  const tam = tamSanCuaTang(f);
  if (tam.length) {
    for (const pts of tam) {
      const sh = new THREE.Shape();
      sh.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
      sh.closePath();
      for (const r of lo) {                       // lỗ nào nằm trong tấm này thì khoét
        if (r.pts.length < 3) continue;
        const cx = r.pts.reduce((a, q) => a + q[0], 0) / r.pts.length;
        const cz = r.pts.reduce((a, q) => a + q[1], 0) / r.pts.length;
        if (!trongDaGiac(pts, cx, cz)) continue;
        const pth = new THREE.Path();
        pth.moveTo(r.pts[0][0], r.pts[0][1]);
        for (let i = 1; i < r.pts.length; i++) pth.lineTo(r.pts[i][0], r.pts[i][1]);
        pth.closePath();
        sh.holes.push(pth);
      }
      const m = new THREE.Mesh(
        new THREE.ExtrudeGeometry(sh, { depth: MASS.slab, bevelEnabled: false }), matSlab);
      m.rotation.x = Math.PI / 2;
      m.position.y = y - .02;
      g.add(m);
    }
  } else if (!lo.length) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, MASS.slab, d), matSlab);
    slab.position.set(cx, y - MASS.slab / 2 - .02, cz);
    g.add(slab);
  } else {
    // sàn = mặt phẳng có lỗ: dựng THREE.Shape rồi đùn dày bằng chiều dày sàn,
    // nhờ vậy lỗ có hình dạng BẤT KỲ theo đa giác người dùng vẽ.
    const ngoai = new THREE.Shape();
    ngoai.moveTo(fp.x0, fp.z0); ngoai.lineTo(fp.x1, fp.z0);
    ngoai.lineTo(fp.x1, fp.z1); ngoai.lineTo(fp.x0, fp.z1); ngoai.closePath();
    for (const r of lo) {
      if (r.pts.length < 3) continue;
      const p = new THREE.Path();
      p.moveTo(r.pts[0][0], r.pts[0][1]);
      for (let i = 1; i < r.pts.length; i++) p.lineTo(r.pts[i][0], r.pts[i][1]);
      p.closePath();
      ngoai.holes.push(p);
    }
    const geo = new THREE.ExtrudeGeometry(ngoai, { depth: MASS.slab, bevelEnabled: false });
    const m = new THREE.Mesh(geo, matSlab);
    m.rotation.x = Math.PI / 2;                 // mặt phẳng XY -> nằm ngang XZ
    m.position.y = y - .02;
    g.add(m);
  }

  // ----- cửa: hình học thật (bản lề + hai cánh tay của cung quay)
  const doors = (f.doors || []).map(a => {
    const h = [a[0], a[1]], p = [a[2], a[3]], q = [a[4], a[5]];
    const arm = (u) => [u[0] - h[0], u[1] - h[1]];
    const ap = arm(p), aq = arm(q);
    const horiz = (v) => Math.abs(v[0]) >= Math.abs(v[1]);
    return { h, p, q, ap, aq, horizP: horiz(ap) };
  });

  // Cửa do người dùng tự vẽ cũng được đưa vào danh sách cửa -> khoét luôn
  // tường bóc từ bản vẽ, không chỉ tường tự vẽ.
  for (const c of customOf(f.page)) {
    if (c.type !== 'door') continue;
    const ap = [c.u1 - c.u0, c.v1 - c.v0];
    const d = Math.hypot(ap[0], ap[1]);
    if (d < 1) continue;
    const aq = [-ap[1] * 0.35, ap[0] * 0.35];        // cánh mở, vuông góc với ô cửa
    // chỉ khoét bức tường bản vẽ GẦN NHẤT, tránh đục thủng cả hai bên hành lang
    const gx = (c.u0 + c.u1) / 2, gy = (c.v0 + c.v1) / 2;
    const ux = ap[0] / d, uy = ap[1] / d;
    let chu = -1, tot = 1e9;
    (f.walls || []).forEach((r, i) => {
      const ngang = (r[2] - r[0]) >= (r[3] - r[1]);
      const ax = ngang ? r[0] : (r[0] + r[2]) / 2, ay = ngang ? (r[1] + r[3]) / 2 : r[1];
      const bx = ngang ? r[2] : (r[0] + r[2]) / 2, by = ngang ? (r[1] + r[3]) / 2 : r[3];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 1e-6) return;
      const vx = (bx - ax) / L, vy = (by - ay) / L;
      if (Math.abs(vx * uy - vy * ux) > 0.26) return;
      const tr = (gx - ax) * vx + (gy - ay) * vy;
      // cửa phải THỰC SỰ nằm trên bức tường này (phủ >= 50% bề rộng cửa)
      const phu = Math.max(0, Math.min(L, tr + d / 2) - Math.max(0, tr - d / 2)) / d;
      if (phu < 0.5) return;
      const t = Math.max(0, Math.min(L, tr));
      const dd = Math.hypot(gx - (ax + vx * t), gy - (ay + vy * t));
      if (dd < tot) { tot = dd; chu = i; }
    });
    doors.push({ h: [c.u0, c.v0], p: [c.u1, c.v1], q: [c.u0 + aq[0], c.v0 + aq[1]],
                 ap: ap, aq: aq, horizP: Math.abs(ap[0]) >= Math.abs(ap[1]),
                 tuVe: true, chu: chu });
  }

  // ----- tường: cắt ô cửa, chừa lanh tô
  const ed = editsOf(f.page);
  const wallSrc = [], cabSrc = [];
  // BẢN VẼ HIỆN TẠI LÀ DUY NHẤT: cao trình nào đã có tường tự vẽ thì tường/tủ
  // bóc tự động từ PDF gốc không dựng nữa — ở MỌI chế độ (Xem, Thiết kế, đi bộ),
  // không riêng đi bộ. Bản vẽ gốc chỉ còn dùng cho cao trình chưa vẽ gì.
  const boQuaBoc = typeof coBanVeRieng === 'function' && coBanVeRieng(f);
  (f.walls || []).forEach((r, i) => {
    if (boQuaBoc) return;
    if (ed.delWall.indexOf(i) >= 0) return;
    (ed.toCab.indexOf(i) >= 0 ? cabSrc : wallSrc).push({ r: r, key: 'w:' + f.page + ':' + i });
  });
  (f.cabinets || []).forEach((r, i) => {
    if (boQuaBoc) return;
    if (ed.delCab.indexOf(i) >= 0) return;
    (ed.toWall.indexOf(i) >= 0 ? wallSrc : cabSrc).push({ r: r, key: 'b:' + f.page + ':' + i });
  });

  const boxes = [], boxMeta = [], leaves = [];
  for (const src of wallSrc) {
    const r = src.r;
    const horiz = (r[2] - r[0]) >= (r[3] - r[1]);       // trục dài theo x hay y
    const lo = horiz ? r[0] : r[1], hi = horiz ? r[2] : r[3];
    const c0 = horiz ? r[1] : r[0], c1 = horiz ? r[3] : r[2];
    const gaps = [];
    for (const dr of doors) {
      // cửa tự vẽ: chỉ khoét đúng bức tường chứa nó; không tường nào chứa -> không khoét
      if (dr.tuVe && (dr.chu < 0 || src.key !== 'w:' + f.page + ':' + dr.chu)) continue;
      // cánh tay nằm DỌC THEO tường = bề rộng ô cửa
      const along = (dr.horizP === horiz) ? dr.ap : dr.aq;
      const other = (dr.horizP === horiz) ? dr.aq : dr.ap;
      if (Math.abs(horiz ? along[1] : along[0]) > 6) continue;    // không song song tường
      const cc = horiz ? dr.h[1] : dr.h[0];
      if (cc < c0 - 9 || cc > c1 + 9) continue;                   // bản lề không nằm trên tường
      const s0 = horiz ? dr.h[0] : dr.h[1];
      const s1 = s0 + (horiz ? along[0] : along[1]);
      let a = Math.min(s0, s1), b = Math.max(s0, s1);
      if (dr.tuVe) {
        // Cửa tự vẽ: khoét ĐÚNG CHỖ cửa đứng, không trượt đi nơi khác.
        const rong = b - a;
        if (hi - lo < rong * 1.1) continue;
        a = Math.max(lo, a); b = Math.min(hi, b);
        if (b - a < rong * 0.5) continue;      // cửa không thực sự nằm trên tường này
      } else {
        a = Math.max(lo, a); b = Math.min(hi, b);
      }
      if (b - a > 3) { gaps.push([a, b]); dr.used = true; }
    }
    gaps.sort((p, q) => p[0] - q[0]);
    let cur = lo;
    const segs = [];
    for (const [ga, gb] of gaps) {
      if (ga > cur) segs.push([cur, ga]);
      cur = Math.max(cur, gb);
    }
    if (cur < hi) segs.push([cur, hi]);

    const push = (p0, p1, yc, hh) => {
      const q0 = horiz ? [p0, r[1]] : [r[0], p0];
      const q1 = horiz ? [p1, r[3]] : [r[2], p1];
      const [ax, az] = worldXZ(f, q0[0], q0[1]);
      const [bx, bz] = worldXZ(f, q1[0], q1[1]);
      boxes.push([(ax + bx) / 2, yc, (az + bz) / 2,
                  Math.max(.12, Math.abs(bx - ax)), hh, Math.max(.12, Math.abs(bz - az))]);
      boxMeta.push(src.key);
    };
    for (const [p0, p1] of segs) push(p0, p1, y + h / 2, h);
    for (const [ga, gb] of gaps) if (h - dh > .15) push(ga, gb, y + dh + (h - dh) / 2, h - dh);
  }

  // ----- cánh cửa: tấm mỏng, xoay quanh bản lề theo đúng hướng mở trên bản vẽ
  for (const dr of doors) {
    if (dr.tuVe) continue;                       // cửa tự vẽ đã có mô hình riêng
    const open = dr.used ? ((dr.horizP) ? dr.aq : dr.ap) : dr.ap;   // tay còn lại = hướng mở
    const [hx, hz] = worldXZ(f, dr.h[0], dr.h[1]);
    const [ex, ez] = worldXZ(f, dr.h[0] + open[0], dr.h[1] + open[1]);
    const dx = ex - hx, dz = ez - hz;
    const len = Math.hypot(dx, dz);
    if (len < .3) continue;
    const di = doors.indexOf(dr);
    if (ed.delDoor.indexOf(di) >= 0) continue;
    leaves.push({ x: hx + dx / 2, z: hz + dz / 2, len, ang: Math.atan2(dz, dx), key: 'd:' + f.page + ':' + di });
  }

  const addInst = (list, mat, meta) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(unitBox, mat, list.length);
    const m = new THREE.Matrix4();
    list.forEach((p, i) => {
      m.makeScale(p[3], p[4], p[5]);
      m.setPosition(p[0], p[1], p[2]);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (meta) {
      inst.userData.meta = meta; pickables.push(inst);
      list.forEach((p, i) => pickRects.push({
        key: meta[i], page: f.page, obj: inst, idx: i,
        x0: p[0] - p[3] / 2, z0: p[2] - p[5] / 2, x1: p[0] + p[3] / 2, z1: p[2] + p[5] / 2
      }));
    }
    g.add(inst);
  };
  addInst(boxes, matWallShared, boxMeta);

  // cánh cửa
  if (leaves.length) {
    const inst = new THREE.InstancedMesh(unitBox, matDoor, leaves.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(),
          pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const lh = Math.min(h * .92, 2.05 * state.explode);
    leaves.forEach((d, i) => {
      q.setFromAxisAngle(up, -d.ang);
      sc.set(d.len, lh, .07);
      pos.set(d.x, y + lh / 2, d.z);
      m.compose(pos, q, sc);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.userData.meta = leaves.map(d => d.key);
    pickables.push(inst);
    leaves.forEach((d, i) => pickRects.push({
      key: d.key, page: f.page, obj: inst, idx: i,
      x0: d.x - d.len / 2, z0: d.z - d.len / 2, x1: d.x + d.len / 2, z1: d.z + d.len / 2
    }));
    g.add(inst);
  }

  // tủ điện / thiết bị: khối thấp, màu khác hẳn tường
  if (state.cabinets) {
    const ch = Math.min(h * .8, CAB_H * state.explode);
    const cabs = [], cabMeta = [];
    cabSrc.forEach(src => {
      const r = src.r;
      const [ax, az] = worldXZ(f, r[0], r[1]);
      const [bx, bz] = worldXZ(f, r[2], r[3]);
      cabs.push([(ax + bx) / 2, y + ch / 2, (az + bz) / 2,
                 Math.max(.2, Math.abs(bx - ax)), ch, Math.max(.2, Math.abs(bz - az))]);
      cabMeta.push(src.key);
    });
    addInst(cabs, matCab, cabMeta);
  }

  // Khung bao khối nhà: chỉ là đường gióng cho dễ định hướng, KHÔNG phải vật thể
  // bóc từ bản vẽ nên không chọn / xoá được — tắt bằng nút "Khung bao khối".
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    new THREE.LineBasicMaterial({ color: 0x7f9fbe, transparent: true, opacity: .28 }));
  edges.position.set(cx, y + h / 2, cz);
  edges.userData.khung = true;
  edges.visible = state.frame && state.mode === 'design';
  g.add(edges);
  g.userData.floor = f;
  return g;
}

// ---------------------------------------------------------------- đèn EXIT
// Vị trí lấy từ bản vẽ "đèn exit.pdf" (tools/exitlamps.py). Đèn được GẮN LÊN
// bức tường gần nhất: xoay theo phương của tường, áp sát mặt tường, cao 2,4 m.
let exitMeshes = [];
const EXIT_H = 2.4;                    // cao độ lắp đèn (m)

function exitTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#0a7a3c'; x.fillRect(0, 0, 256, 96);
  x.strokeStyle = '#ffffff'; x.lineWidth = 5; x.strokeRect(6, 6, 244, 84);
  // mũi tên
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.moveTo(34, 48); x.lineTo(70, 24); x.lineTo(70, 38); x.lineTo(96, 38);
  x.lineTo(96, 58); x.lineTo(70, 58); x.lineTo(70, 72); x.closePath(); x.fill();
  x.font = 'bold 54px sans-serif'; x.textBaseline = 'middle';
  x.fillText('EXIT', 112, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let MAT_EXIT = null;
function matExit() {
  if (!MAT_EXIT) {
    const t = exitTexture();
    MAT_EXIT = [
      new THREE.MeshStandardMaterial({ color: 0x0a7a3c, roughness: .6 }),   // cạnh
      new THREE.MeshStandardMaterial({ map: t, emissive: 0x0a7a3c, emissiveMap: t,
        emissiveIntensity: 1.1, roughness: .5 })                            // hai mặt chữ
    ];
  }
  return MAT_EXIT;
}


// Biển EXIT treo trên cửa hay nằm LỌT trong bề dày tường/lanh tô nên bị che.
// Đẩy biển ra hẳn mặt tường, và treo LUÔN CẢ HAI MẶT (trước + sau) như hộp đèn
// exit hai mặt ngoài thực tế — nhìn từ phía nào cũng thấy.
function matTuongCuaBien(f, x, z) {
  const t = tuongGanNhat(f, x, z);
  const day = t && t.d < 4 ? t.day : .22;
  const nx = t && t.d < 4 ? -t.uz : 0, nz = t && t.d < 4 ? t.ux : 1;
  return { lech: day / 2 + .07, nx: nx, nz: nz };
}

function makeExitSign() {
  const [canh, mat] = matExit();
  const w = 0.62, h = 0.24, d = 0.07;
  // thứ tự mặt của BoxGeometry: +x, -x, +y, -y, +z, -z
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
    [canh, canh, canh, canh, mat, mat]);
  const g = new THREE.Group();
  g.add(m);
  const gia = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), canh);
  gia.position.set(0, h / 2 + 0.08, 0);
  g.add(gia);
  return g;
}

// Tìm bức tường gần nhất (bóc từ bản vẽ hoặc tự vẽ) để áp đèn vào.
function tuongGanNhat(f, wx, wz) {
  let tot = null;
  const xet = (ax, az, bx, bz, day) => {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) return;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    let t = (wx - ax) * ux + (wz - az) * uz;
    t = Math.max(0, Math.min(L, t));
    const px = ax + ux * t, pz = az + uz * t;
    const d = Math.hypot(wx - px, wz - pz);
    if (!tot || d < tot.d) tot = { d: d, x: px, z: pz, ux: ux, uz: uz, day: day };
  };
  const ed = editsOf(f.page);
  (f.walls || []).forEach((r, i) => {
    if (ed.delWall.indexOf(i) >= 0 || ed.toCab.indexOf(i) >= 0) return;
    const ngang = (r[2] - r[0]) >= (r[3] - r[1]);
    const day = (ngang ? r[3] - r[1] : r[2] - r[0]) * mpp();
    const [ax, az] = worldXZ(f, ngang ? r[0] : (r[0] + r[2]) / 2, ngang ? (r[1] + r[3]) / 2 : r[1]);
    const [bx, bz] = worldXZ(f, ngang ? r[2] : (r[0] + r[2]) / 2, ngang ? (r[1] + r[3]) / 2 : r[3]);
    xet(ax, az, bx, bz, day);
  });
  for (const o of customOf(f.page)) {
    if (o.type !== 'wall') continue;
    const [ax, az] = worldXZ(f, o.u0, o.v0);
    const [bx, bz] = worldXZ(f, o.u1, o.v1);
    xet(ax, az, bx, bz, o.t || .22);
  }
  return tot;
}

// Đèn EXIT thường treo NGAY TRÊN cửa ra vào. Trả về chỗ treo trên cửa gần nhất.
function cuaGanNhat(f, wx, wz, banKinh) {
  let tot = null;
  for (const c of customOf(f.page)) {
    if (c.type !== 'door') continue;
    const [ax, az] = worldXZ(f, c.u0, c.v0), [bx, bz] = worldXZ(f, c.u1, c.v1);
    const gx = (ax + bx) / 2, gz = (az + bz) / 2;
    const d = Math.hypot(wx - gx, wz - gz);
    if (d > (banKinh || 1.4)) continue;
    if (!tot || d < tot.d) {
      tot = { d: d, x: gx, z: gz,
              ang: -Math.atan2(bz - az, bx - ax) + (c.rot || 0),
              cao: (c.h || 2.1) * state.explode, cua: c };
    }
  }
  return tot;
}

function buildExits() {
  exitMeshes.forEach(m => { exitGroup.remove(m); });
  exitMeshes = [];
  const ds = (state.exitData && state.exitData.items) || [];
  for (const it of ds) {
    const f = floorOf(it.floor);
    if (!f) continue;
    const ed = editsOf(f.page);
    if (ed.delExit.indexOf(it.id) >= 0) continue;
    const doi = ed.movExit[it.id];
    const [wx, wz] = worldXZ(f, doi ? doi[0] : it.bx, doi ? doi[1] : it.by);
    const g = makeExitSign();
    const t = tuongGanNhat(f, wx, wz);
    let x = wx, z = wz, goc;
    if (t && t.d < 4) {                       // gắn áp vào mặt tường
      const nx = -t.uz, nz = t.ux;            // pháp tuyến của tường
      const ben = ((wx - t.x) * nx + (wz - t.z) * nz) >= 0 ? 1 : -1;
      x = t.x + nx * ben * (t.day / 2 + 0.05);
      z = t.z + nz * ben * (t.day / 2 + 0.05);
      goc = -Math.atan2(t.uz, t.ux);
      if (ben < 0) goc += Math.PI;
    } else {
      goc = it.dir === 'doc' ? Math.PI / 2 : 0;
    }
    const storey = Math.max(1.2, floorHeight(f) * state.explode - MASS.slab);
    let y = floorY(f) + Math.min(EXIT_H * state.explode, storey - 0.4);
    const cua = cuaGanNhat(f, wx, wz);          // ở gần cửa thì treo ngay trên cửa
    let hai = null;
    if (cua) {
      x = cua.x; z = cua.z; goc = cua.ang;
      y = floorY(f) + Math.min(cua.cao + 0.28 * state.explode, storey - 0.3);
      hai = matTuongCuaBien(f, wx, wz);         // treo ra hai mặt tường cho khỏi bị che
    }
    // NGƯỜI DÙNG CHỌN MẶT: đặt hẳn ra trước hoặc sau cửa, không để máy tự lật nữa.
    const mat = ed.matExit[it.id];
    if (mat && cua) {
      const nx = Math.sin(goc), nz = Math.cos(goc);
      const lui = 0.16 * state.explode;
      x += nx * mat * lui; z += nz * mat * lui;
      if (mat < 0) goc += Math.PI;
      hai = null;
      g.userData.matTay = true;                // đã chọn tay -> chinhBienExit bỏ qua
    }
    g.position.set(x + (hai ? hai.nx * hai.lech : 0), y, z + (hai ? hai.nz * hai.lech : 0));
    g.rotation.y = goc;
    g.scale.setScalar(state.exitScale);
    g.userData.exit = it;
    exitGroup.add(g); exitMeshes.push(g);

  }
  applyVisibility();
}

// ---------------------------------------------------------------- build
function buildScene() {
  [...floorMeshes, ...markers, ...labels, ...backs, ...masses].forEach(m => m.parent && m.parent.remove(m));
  floorMeshes = []; markers = []; labels = []; backs = []; masses = []; pickables = []; pickRects = [];
  const loader = new THREE.TextureLoader();

  for (const f of state.data.floors) {
    const [x0, y0, x1, y1] = f.box;
    const [wx0, wz0] = worldXZ(f, x0, y0);
    const [wx1, wz1] = worldXZ(f, x1, y1);
    const w = Math.abs(wx1 - wx0), h = Math.abs(wz1 - wz0);
    const tex = loader.load(duongDL('floors/') + f.image);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: state.opacity, side: THREE.DoubleSide })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((wx0 + wx1) / 2, floorY(f), (wz0 + wz1) / 2);
    mesh.renderOrder = 1;
    mesh.userData.floor = f;
    floorGroup.add(mesh); floorMeshes.push(mesh);

    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: 0xf4f6f8, transparent: true, opacity: .95, side: THREE.DoubleSide }));
    back.rotation.x = -Math.PI / 2;
    back.position.set(mesh.position.x, mesh.position.y - .06, mesh.position.z);
    back.visible = state.paper;
    floorGroup.add(back); backs.push(back);

    const mass = buildMassing(f);
    if (mass) { massGroup.add(mass); masses.push(mass); }

    const lab = labelSprite(`EL. ${f.elevation.toFixed(2)}`, '#c9d6e2');
    lab.position.set(wx0 + 4, floorY(f) + 2.4, (wz0 + wz1) / 2);
    floorGroup.add(lab); labels.push(lab);
  }

  for (const it of state.data.items) {
    const f = floorOf(it.floor);
    const doi = editsOf(f.page).movItem[it.id];        // bình đã được dời tay
    const [x, z] = worldXZ(f, doi ? doi[0] : it.bx, doi ? doi[1] : it.by);
    const col = new THREE.Color(state.data.types[it.type].color);
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: .45, metalness: .15,
      emissive: col.clone().multiplyScalar(.25) });
    const g = makeMarker(it.type, mat);
    g.position.set(x, floorY(f) + .05, z);
    if (it.type === 'NUTBAO') xoayNutBao(g, f, x, z);
    else treoBinhLenTuong(g, f, x, z, it.type, floorY(f));
    g.userData.item = it;
    g.userData.mat = mat;
    markerGroup.add(g); markers.push(g);
  }
  applyVisibility();
}

// Ma so tung thiet bi: binh chua chay lay ma san co, hong nuoc va nut an duoc
// danh ma theo cao trinh (HCC-<trang>-<n>, NA-<trang>-<n>) vi ban ve khong ghi.
function maCuaVat(o, f, n) {
  if (o.ma) return o.ma;
  const t = String(f.page + 1).padStart(2, '0');
  if (o.type === 'hong') return 'HCC-' + t + '-' + String(n).padStart(2, '0');
  if (o.type === 'nutbao') return 'NA-' + t + '-' + String(n).padStart(2, '0');
  if (o.type === 'bin') return 'BX-' + t + '-' + String(n).padStart(2, '0');
  if (o.type === 'fm200') return 'FM-' + t + '-' + String(n).padStart(2, '0');
  return null;
}

function ganMaSo() {
  // Danh ma cho cac vat tu ve theo tung cao trinh, cat vao mesh de khi bam
  // vao thi hien ra. KHONG treo the noi tren dau vat.
  const dem = {};
  for (const mesh of customMeshes) {
    const o = mesh.userData.obj;
    if (!o || !['hong', 'nutbao', 'bin', 'fm200'].includes(o.type)) continue;
    const page = mesh.userData.page ?? state.data.floors[0].page;
    const k = o.type + page;
    dem[k] = (dem[k] || 0) + 1;
    mesh.userData.maSo = maCuaVat(o, floorOf(page), dem[k]);
  }
}

function applyVisibility() {
  const q = state.query.trim().toUpperCase();
  for (const m of markers) {
    const it = m.userData.item;
    const okF = state.visible.has(it.floor);
    const okT = state.typeOn.has(it.type);
    const okQ = !q || it.id.includes(q) || (it.ma || '').toUpperCase().includes(q) ||
      (it.room || '').includes(q) ||
      state.data.types[it.type].label.toUpperCase().includes(q);
    m.visible = okF && okT && okQ && editsOf(it.floor).delItem.indexOf(it.id) < 0;
    // Đi bộ thì bình phải đúng cỡ thật (cao ~0,55 m) chứ không phải cỡ ký hiệu
    // phóng to dùng cho góc nhìn tổng thể — nếu không, đứng cạnh sẽ thấy bình
    // cao ngang đầu người.
    const coKyHieu = (typeof wk !== 'undefined' && wk.on)
      ? 0.26 * state.explode : state.mkScale;
    const s = coKyHieu * (state.selected === it.id ? 1.9 : 1);
    m.scale.setScalar(s);
    if (m.userData.abc) {                        // bình ABC / CO₂ dùng vật liệu chung
      const V = m.userData.vl || vlABC();
      const chon = state.selected === it.id, motMinh = q && !okQ;
      m.userData.abc[0].material = chon ? V.sang : (motMinh ? V.mo : V.do);
      m.userData.abc[1].material = motMinh ? V.moDen : V.den;
      continue;
    }
    m.userData.mat.emissiveIntensity = state.selected === it.id ? 2.2 : 1;
    m.userData.mat.opacity = (q && !okQ) ? .15 : 1;
  }
  floorMeshes.forEach((f, i) => {
    // showPlan = tắt hẳn ảnh bản vẽ, không liên quan gì tới thanh độ mờ
    f.visible = state.showPlan && state.visible.has(f.userData.floor.page);
    f.material.opacity = state.opacity;
    if (backs[i]) {
      backs[i].visible = state.visible.has(f.userData.floor.page) && state.paper;
      backs[i].material.opacity = state.opacity * .95;
    }
  });
  labels.forEach((l, i) => { l.visible = state.visible.has(floorMeshes[i].userData.floor.page); });
  labels.forEach((l, i) => { l.visible = floorMeshes[i].visible; });
  exitMeshes.forEach(m => {
    m.visible = state.exitOn && state.visible.has(m.userData.exit.floor);
  });
  masses.forEach(m => {
    m.visible = state.massing && state.visible.has(m.userData.floor.page);
    // khung bao chỉ là đường gióng phục vụ lúc vẽ -> chỉ hiện trong tab Thiết kế
    m.traverse(o => { if (o.userData.khung) o.visible = state.frame && state.mode === 'design'; });
  });
  if (typeof rebuildCustom === 'function') rebuildCustom();
  renderSidebarCounts();
}

function relayout() {
  for (const m of floorMeshes) {
    const f = m.userData.floor;
    const [x0, y0, x1, y1] = f.box;
    const [wx0, wz0] = worldXZ(f, x0, y0), [wx1, wz1] = worldXZ(f, x1, y1);
    const w = Math.abs(wx1 - wx0), h = Math.abs(wz1 - wz0);
    m.geometry.dispose();
    m.geometry = new THREE.PlaneGeometry(w, h);
    m.position.set((wx0 + wx1) / 2, floorY(f), (wz0 + wz1) / 2);
    const i = floorMeshes.indexOf(m);
    if (backs[i]) {
      backs[i].geometry.dispose();
      backs[i].geometry = new THREE.PlaneGeometry(w, h);
      backs[i].position.set(m.position.x, m.position.y - .06, m.position.z);
    }
  }
  labels.forEach((l, i) => {
    const f = floorMeshes[i].userData.floor;
    const [x0, y0] = f.box, [, y1] = [0, f.box[3]];
    const [wx0, wz0] = worldXZ(f, x0, y0), [, wz1] = worldXZ(f, 0, f.box[3]);
    l.position.set(wx0 + 4, floorY(f) + 2.4, (wz0 + wz1) / 2);
  });
  datLaiViTriBinh();
  masses.forEach(m => { m.traverse(o => o.geometry && o.geometry.dispose()); massGroup.remove(m); });
  masses = []; pickables = []; pickRects = [];
  for (const f of state.data.floors) {
    const mass = buildMassing(f);
    if (mass) { massGroup.add(mass); masses.push(mass); }
  }
  applyVisibility();
}

// ============================================================ TAB THIẾT KẾ
// Cho phép vẽ thêm tường, khối hộp thiết bị / máy biến áp và bình chữa cháy
// ngay trên mặt bằng của cao trình đang chọn. Dữ liệu lưu trong localStorage
// và xuất được ra tệp thiet-ke.json.
const MAT_CUSTOM = {
  wall: matWallShared,          // dùng chung vật liệu với tường bóc từ bản vẽ -> nhìn đồng nhất
  box: matCab,                  // khối thiết bị = cùng màu tủ/thiết bị của bản vẽ
  tra: new THREE.MeshStandardMaterial({ color: 0x96a3b0, roughness: .45, metalness: .5 }),
  roof: new THREE.MeshStandardMaterial({ color: 0xb4b7b2, roughness: .96, metalness: .02,
    side: THREE.DoubleSide }),                       // bê tông đổ tại chỗ
};
const MAT_SEL = new THREE.MeshStandardMaterial({ color: 0xffc14d, roughness: .4, emissive: 0x4a3300 });

let customMeshes = [], ghost = null;
const drag = { on: false, a: null, b: null, id: null, px: 0, py: 0 };

// Be day tuong LUC VE. Tuong that chi 0,22 m; o mat bang 2D khung nhin rong
// hang chuc met nen ra khoang 2 pixel, lan het vao net den cua ban ve -> nguoi
// dung tuong la ve khong len net. Khi dang o 2D thi ve day toi thieu bang
// 1/150 be rong khung nhin, doi ra man hinh khoang 5-6 pixel.
function dayVeTuong(o) {
  const that = o.t || .22;
  if (!state.plan || !camOrtho) return that;
  const nua = (camOrtho.top - camOrtho.bottom) / 2 / (camOrtho.zoom || 1);
  // Chi cong them cho du thay, KHONG duoc beo hon 1,6 lan be day that — neu
  // khong ca mat bang toan net hong to tuong, khong con giong ban ve.
  return Math.min(that * 1.6, Math.max(that, nua / 90));
}

function activeFloorObj() {
  return floorOf(state.activeFloor ?? state.data.floors[0].page);
}
function customOf(page) {
  if (!state.custom[page]) state.custom[page] = [];
  return state.custom[page];
}
function baseFromWorld(f, x, z) {
  if (f.georef === 'standalone') return [x - 110, z + 40];
  const s = mpp();
  return [x / s, z / s];
}


// ---------------------------------------------------------------------------
// GỘP HÌNH: một vật như cầu thang / bình FM-200 / họng nước gồm hàng chục khối
// nhỏ -> mỗi khối một lệnh vẽ. Gộp lại theo vật liệu: mỗi vật chỉ còn vài lệnh.
// ---------------------------------------------------------------------------
function _noiHinh(ds) {
  const pos = [], nor = [], uv = [];
  for (const g of ds) {
    const h = g.index ? g.toNonIndexed() : g;
    const p = h.attributes.position, n = h.attributes.normal, t = h.attributes.uv;
    for (let i = 0; i < p.count * 3; i++) pos.push(p.array[i]);
    if (n) for (let i = 0; i < n.count * 3; i++) nor.push(n.array[i]);
    if (t) for (let i = 0; i < t.count * 2; i++) uv.push(t.array[i]);
    if (h !== g) h.dispose();
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nor.length === pos.length) r.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  else r.computeVertexNormals();
  if (uv.length / 2 === pos.length / 3) r.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return r;
}

function gopNhom(g) {
  if (!g || !g.isGroup) return g;
  g.updateMatrixWorld(true);
  const nghich = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const theoVL = new Map();
  let so = 0;
  g.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
    so++;
    const geo = o.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(nghich, o.matrixWorld));
    const k = o.material.uuid;
    if (!theoVL.has(k)) theoVL.set(k, { mat: o.material, ds: [] });
    theoVL.get(k).ds.push(geo);
  });
  if (so < 2) return g;                          // một khối thì gộp cũng chẳng lợi
  const ng = new THREE.Group();
  ng.position.copy(g.position); ng.rotation.copy(g.rotation); ng.scale.copy(g.scale);
  for (const { mat, ds } of theoVL.values()) {
    const m = new THREE.Mesh(_noiHinh(ds), mat);
    m.userData.gop = true;
    ng.add(m);
    ds.forEach(d => d.dispose());
  }
  // vẫn giữ các mesh nhiều vật liệu (hiếm) ở dạng cũ
  g.traverse(o => { if (o.isMesh && Array.isArray(o.material)) ng.add(o.clone()); });
  g.traverse(o => { if (o.isMesh && !Array.isArray(o.material)) o.geometry.dispose(); });
  return ng;
}


// ---------------------------------------------------------------------------
// LÀM KHÍT GÓC TƯỜNG của cao trình đang chọn:
//  1) các đầu tường gần nhau  -> gom về một điểm (hai tường vuông góc thì lấy
//     đúng giao điểm hai trục, không phải trung bình),
//  2) đầu tường chạm thân bức khác -> chiếu vuông góc lên trục bức đó (mối nối T),
//  3) nối dài mỗi đầu thêm nửa bề dày bức kia -> hai khối chồng nhau, hết hở góc.
// ---------------------------------------------------------------------------
function lamKhitGoc(f) {
  const W = customOf(f.page).filter(o => o.type === 'wall');
  if (W.length < 2) { hint('Cao trình này chưa có tường tự vẽ'); return; }
  chup();
  const m2dv = 1 / mpp();
  const GAN = 0.8 * m2dv, TJ = 0.5 * m2dv;
  const lay = (o, k) => k ? [o.u1, o.v1] : [o.u0, o.v0];
  const dat = (o, k, x, y) => {
    if (k) { o.u1 = round2(x); o.v1 = round2(y); } else { o.u0 = round2(x); o.v0 = round2(y); }
  };
  const nut = [];
  W.forEach(o => { nut.push([o, 0]); nut.push([o, 1]); });
  let gom = 0, T = 0, noi = 0;

  const xong = new Set();
  nut.forEach(([oa, ka], i) => {
    if (xong.has(oa.id + ':' + ka)) return;
    const pa = lay(oa, ka);
    const cum = [[oa, ka]];
    nut.forEach(([ob, kb], j) => {
      if (j <= i || ob === oa || xong.has(ob.id + ':' + kb)) return;
      const pb = lay(ob, kb);
      if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < GAN) cum.push([ob, kb]);
    });
    if (cum.length < 2) return;
    let pt = null;
    if (cum.length === 2) {                       // hai tường -> giao điểm hai trục
      const [[o1], [o2]] = cum;
      const a1 = [o1.u1 - o1.u0, o1.v1 - o1.v0], a2 = [o2.u1 - o2.u0, o2.v1 - o2.v0];
      const L1 = Math.hypot(a1[0], a1[1]), L2 = Math.hypot(a2[0], a2[1]);
      if (L1 > 1e-6 && L2 > 1e-6) {
        const u1 = [a1[0] / L1, a1[1] / L1], u2 = [a2[0] / L2, a2[1] / L2];
        const cheo = u1[0] * u2[1] - u1[1] * u2[0];
        if (Math.abs(cheo) > 0.3) {
          const t = ((o2.u0 - o1.u0) * u2[1] - (o2.v0 - o1.v0) * u2[0]) / cheo;
          const c = [o1.u0 + u1[0] * t, o1.v0 + u1[1] * t];
          if (cum.every(([o, k]) => {
            const q = lay(o, k);
            return Math.hypot(c[0] - q[0], c[1] - q[1]) < GAN * 1.6;
          })) pt = c;
        }
      }
    }
    if (!pt) pt = [cum.reduce((a, [o, k]) => a + lay(o, k)[0], 0) / cum.length,
                   cum.reduce((a, [o, k]) => a + lay(o, k)[1], 0) / cum.length];
    cum.forEach(([o, k]) => { dat(o, k, pt[0], pt[1]); xong.add(o.id + ':' + k); gom++; });
  });

  nut.forEach(([o, k]) => {                       // mối nối chữ T
    const p = lay(o, k);
    for (const w of W) {
      if (w === o) continue;
      const L = Math.hypot(w.u1 - w.u0, w.v1 - w.v0);
      if (L < 1e-6) continue;
      const ux = (w.u1 - w.u0) / L, uy = (w.v1 - w.v0) / L;
      const t = (p[0] - w.u0) * ux + (p[1] - w.v0) * uy;
      if (t < GAN * .5 || t > L - GAN * .5) continue;
      const d = Math.abs((p[0] - w.u0) * uy - (p[1] - w.v0) * ux);
      if (d > 1e-6 && d < TJ) { dat(o, k, w.u0 + ux * t, w.v0 + uy * t); T++; break; }
    }
  });

  nut.forEach(([o, k]) => {                       // nối dài cho chồng khít
    const p = lay(o, k), q = lay(o, k ? 0 : 1);
    let day = 0;
    for (const w of W) {
      if (w === o) continue;
      for (const kk of [0, 1]) {
        const r = lay(w, kk);
        if (Math.hypot(p[0] - r[0], p[1] - r[1]) < 0.02 * m2dv) day = Math.max(day, w.t || .22);
      }
    }
    if (!day) return;
    const L = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (L < 1e-6) return;
    const e = day / 2 * m2dv;
    dat(o, k, p[0] + (p[0] - q[0]) / L * e, p[1] + (p[1] - q[1]) / L * e);
    noi++;
  });

  saveCustom(); rebuildCustom(); rebuildMasses();
  hint('Đã làm khít: gom ' + gom + ' đầu tường, ' + T + ' mối nối chữ T, nối dài ' + noi + ' đầu');
  setTimeout(() => hint(''), 4000);
}

function rebuildCustom() {
  customMeshes.forEach(m => {
    customGroup.remove(m);
    m.traverse(o => { if (o.geometry) o.geometry.dispose(); });   // trả lại bộ nhớ GPU
  });
  customMeshes = [];
  for (const f of state.data.floors) {
    if (!state.visible.has(f.page)) continue;
    const ySan = floorY(f);
    const storey = Math.max(1.2, floorHeight(f) * state.explode - MASS.slab);
    for (const o of customOf(f.page)) {
      // Trong chế độ đi bộ, lỗ thông tầng chỉ là chỗ hụt sàn: không vẽ gờ bao,
      // không dựng gì quanh nó.
      if (o.type === 'lo' && typeof wk !== 'undefined' && wk.on) continue;
      const [ax, az] = worldXZ(f, o.u0, o.v0);
      const [bx, bz] = worldXZ(f, o.u1, o.v1);
      const y = ySan + (o.base || 0) * state.explode;   // cao độ chân riêng của vật
      let mesh;
      if (o.type === 'emg') {
        mesh = makeEmergencyLight(state.sel === 'c:' + o.id);
        const t = tuongGanNhat(f, ax, az);
        let x = ax, z = az, goc = (o.rot || 0);
        if (t && t.d < 4) {
          const nx = -t.uz, nz = t.ux;
          const ben = ((ax - t.x) * nx + (az - t.z) * nz) >= 0 ? 1 : -1;
          x = t.x + nx * ben * (t.day / 2 + 0.02);
          z = t.z + nz * ben * (t.day / 2 + 0.02);
          goc = -Math.atan2(t.uz, t.ux) + (ben < 0 ? Math.PI : 0) + (o.rot || 0);
        }
        mesh.position.set(x, ySan + Math.min((o.h || 2.6) * state.explode, storey - 0.3), z);
        mesh.rotation.y = goc;
        // đèn sự cố hiển thị to bằng biển EXIT (0.62 m / thân 0.34 m)
        mesh.scale.setScalar(state.exitScale * EMG_PHONG * (state.sel === 'c:' + o.id ? 1.3 : 1));
      } else if (o.type === 'exit') {
        mesh = makeExitSign();
        const t = tuongGanNhat(f, ax, az);
        let x = ax, z = az, goc = (o.rot || 0);
        if (t && t.d < 4) {
          const nx = -t.uz, nz = t.ux;
          const ben = ((ax - t.x) * nx + (az - t.z) * nz) >= 0 ? 1 : -1;
          x = t.x + nx * ben * (t.day / 2 + 0.05);
          z = t.z + nz * ben * (t.day / 2 + 0.05);
          goc = -Math.atan2(t.uz, t.ux) + (ben < 0 ? Math.PI : 0) + (o.rot || 0);
        }
        let yd = ySan + Math.min((o.h || EXIT_H) * state.explode, storey - 0.4);
        const cua = cuaGanNhat(f, ax, az);
        let hai = null;
        if (cua) {
          x = cua.x; z = cua.z; goc = cua.ang + (o.rot || 0);
          yd = ySan + Math.min(cua.cao + 0.28 * state.explode, storey - 0.3);
          hai = matTuongCuaBien(f, ax, az);      // đẩy ra hẳn mặt tường, MỘT biển
          x += hai.nx * hai.lech; z += hai.nz * hai.lech;
        }
        mesh.position.set(x, yd, z);
        mesh.rotation.y = goc;
        mesh.scale.setScalar(state.exitScale * (state.sel === 'c:' + o.id ? 1.3 : 1));
      } else if (o.type === 'san' || o.type === 'lo') {
        // gờ chạy vòng quanh miệng lỗ, bám đúng đa giác đã vẽ
        const pts = (o.pts && o.pts.length >= 3 ? o.pts
          : [[o.u0, o.v0], [o.u1, o.v0], [o.u1, o.v1], [o.u0, o.v1]]).map(q => worldXZ(f, q[0], q[1]));
        mesh = new THREE.Group();
        const vlv = (state.sel === 'c:' + o.id) ? MAT_SEL
                  : (o.type === 'san' ? MAT_SAN : MAT_LO);
        for (let i = 0; i < pts.length; i++) {
          const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
          const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          if (L < .05) continue;
          const m = new THREE.Mesh(new THREE.BoxGeometry(L, .15, .16), vlv);
          m.position.set((p0[0] + p1[0]) / 2, y + .075, (p0[1] + p1[1]) / 2);
          m.rotation.y = -Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
          mesh.add(m);
        }
        mesh.position.set(0, 0, 0);
      } else if (o.type === 'nutbao') {
        // makeNutBao() tu nang minh len 1,4 m; o day dat lai nen phai cong vao,
        // neu khong nut se nam bet duoi san.
        mesh = makeNutBao(state.sel === 'c:' + o.id);
        mesh.position.set(ax, y + (o.h || 1.4), az);
        mesh.rotation.y = (o.rot || 0);
        xoayNutBao(mesh, f, ax, az);            // áp lưng vào tường gần nhất
      } else if (o.type === 'hong') {
        mesh = makeHydrant(state.sel === 'c:' + o.id);
        const t = tuongGanNhat(f, ax, az);
        let x = ax, z = az, goc = (o.rot || 0);
        if (t && t.d < 5) {                      // áp lưng vào tường gần nhất
          const nx = -t.uz, nz = t.ux;
          const ben = ((ax - t.x) * nx + (az - t.z) * nz) >= 0 ? 1 : -1;
          x = t.x + nx * ben * (t.day / 2 + .12);
          z = t.z + nz * ben * (t.day / 2 + .12);
          goc = -Math.atan2(t.uz, t.ux) + (ben < 0 ? Math.PI : 0) + (o.rot || 0);
        }
        mesh.position.set(x, y, z);
        mesh.rotation.y = goc;
        if (state.sel === 'c:' + o.id) mesh.scale.setScalar(1.25);
      } else if (o.type === 'thangmay') {
        const wq = Math.max(1.2, Math.abs(bx - ax)), dq = Math.max(1.2, Math.abs(bz - az));
        mesh = makeElevator(wq, dq, (o.h || 10) * state.explode, (o.moc || [0]).map(v => v * state.explode),
                            state.sel === 'c:' + o.id);
        mesh.position.set((ax + bx) / 2, y, (az + bz) / 2);
        mesh.rotation.y = (o.rot || 0);
      } else if (o.type === 'thangbo') {
        const dx = bx - ax, dz = bz - az;
        const ve = Math.max(.6, Math.hypot(dx, dz));
        mesh = makeStairTower(ve, rongThangTheoTuong(f, o), (o.h || 3) * state.explode,
                              state.sel === 'c:' + o.id);
        mesh.position.set((ax + bx) / 2, y, (az + bz) / 2);
        mesh.rotation.y = -Math.atan2(dz, dx) + (o.rot || 0);
      } else if (o.type === 'beacon') {
        mesh = makeBeacon((o.h || .18) * state.explode, state.sel === 'c:' + o.id);
        mesh.scale.setScalar(Math.max(1, state.exitScale * .8) *
                             (state.sel === 'c:' + o.id ? 1.3 : 1));
        mesh.position.set(ax, y, az);
        mesh.rotation.y = (o.rot || 0);
      } else if (o.type === 'chop') {
        const D = Math.max(1, Math.hypot(bx - ax, bz - az));
        mesh = makeFrustum(D, (o.h || 1.5) * state.explode, o.top || .58,
                           state.sel === 'c:' + o.id);
        mesh.position.set((ax + bx) / 2, y, (az + bz) / 2);
        mesh.rotation.y = (o.rot || 0);
      } else if (o.type === 'toma') {
        const D = Math.max(1, Math.hypot(bx - ax, bz - az));
        mesh = makeUnitPit(D, (o.h || 3) * state.explode, state.sel === 'c:' + o.id);
        mesh.position.set((ax + bx) / 2, y, (az + bz) / 2);
        mesh.rotation.y = (o.rot || 0);
      } else if (o.type === 'fm200') {
        mesh = makeFM200(state.sel === 'c:' + o.id, o.h || 1.80);
        mesh.position.set(ax, y, az);
        mesh.rotation.y = (o.rot || 0);
      } else if (o.type === 'bin') {
        // Moi loai binh mot mo hinh rieng, dung chung voi binh boc tu ban ve.
        const lb = o.binh || 'ABC8';
        mesh = makeMarker(lb, lb === 'CO224' ? MAT_BINH_CO224 : MAT_BINH_THEM);
        mesh.position.set(ax, y + .05, az);
        treoBinhLenTuong(mesh, f, ax, az, lb, y);
        mesh.scale.setScalar(state.mkScale * (state.sel === 'c:' + o.id ? 1.8 : 1));
      } else {
        const h = (o.type === 'wall')
          ? (o.h > 0 ? o.h * state.explode : storey)
          : o.h * state.explode;
        const mat = (state.sel === 'c:' + o.id) ? MAT_SEL : MAT_CUSTOM[o.type];
        if (o.type === 'rail' || o.type === 'stair') {
          const dx = bx - ax, dz = bz - az;
          const len = Math.max(.4, Math.hypot(dx, dz));
          const selMat = (state.sel === 'c:' + o.id) ? MAT_SEL : null;
          if (o.type === 'rail') {
            mesh = makeRailing(len, (o.h || 1.1), selMat);   // lan can giữ cao độ thật
          } else {
            const rise = (o.h > 0 ? o.h : floorHeight(f)) * state.explode;
            mesh = makeStair(len, o.w || 1.2, rise, selMat);
          }
          mesh.position.set((ax + bx) / 2, y, (az + bz) / 2);
          mesh.rotation.y = -Math.atan2(dz, dx) + (o.rot || 0);
        } else if (o.type === 'door') {
          const dx = bx - ax, dz = bz - az;
          const rong = Math.max(.5, Math.hypot(dx, dz));
          const caoCua = (o.h || 2.1) * state.explode;
          // Cửa đứng một mình (không nằm trên bức tường nào) thì phần trên ô cửa
          // phải có mảng tường/lanh tô, nếu không sẽ hổng một khoảng tới trần.
          // LUÔN đắp mảng tường phía trên ô cửa, cao bằng bức tường lân cận (hoặc hết
          // tầng). Nếu bức tường chủ đã có lanh tô thì hai mảng trùng nhau, cùng vật
          // liệu nên nhìn vẫn liền một khối; mảng đắp mỏng hơn 10% để không rung mặt.
          // Cửa nằm trên một bức tường thì CHÍNH bức tường đó đã xây lanh tô khi
          // khoét ô cửa -> không đắp thêm mảng nữa (trước đây thành hai bức chồng
          // nhau, lại nhô ra che mất đèn EXIT treo trên cửa).
          // VỊ TRÍ CỬA LÀ TƯỜNG, Ô CỬA LÀ PHẦN KHOÉT: mảng tường trên ô cửa chạy
          // từ đúng chiều cao cửa lên hết tầng, rộng đúng bề rộng cửa, dày bằng
          // bức tường. Áp dụng cho cả tab Xem lẫn chế độ đi bộ nên hai nơi giống
          // hệt nhau.
          const caoTren = Math.max(0, storey - caoCua);
          mesh = makeDoor(rong, caoCua, o.kind || 'don', !!o.flip,
            state.sel === 'c:' + o.id, caoTren, (o.t || .22) * 0.9);
          mesh.position.set((ax + bx) / 2, y, (az + bz) / 2);
          mesh.rotation.y = -Math.atan2(dz, dx) + (o.rot || 0);
        } else if (o.type === 'roof') {
          const wq = Math.max(.5, Math.abs(bx - ax)), dq = Math.max(.5, Math.abs(bz - az));
          mesh = makeRoof(wq, dq, (o.h || 0) * state.explode,
            (state.sel === 'c:' + o.id) ? MAT_SEL : MAT_CUSTOM.roof);
          mesh.position.set((ax + bx) / 2, y, (az + bz) / 2);
          mesh.rotation.y = (o.rot || 0);
        } else if (o.type === 'tra') {
          const wq = Math.max(.6, Math.abs(bx - ax)), dq = Math.max(.6, Math.abs(bz - az));
          mesh = makeTransformer(wq, dq, h, state.sel === 'c:' + o.id);
          mesh.position.set((ax + bx) / 2, y, (az + bz) / 2);
          mesh.rotation.y = (o.rot || 0);
        } else if (o.type === 'wall') {
          const dx = bx - ax, dz = bz - az;
          const len = Math.max(.1, Math.hypot(dx, dz));
          const day = dayVeTuong(o);            // ở 2D phải đủ dày để nhìn thấy
          const goc = -Math.atan2(dz, dx) + (o.rot || 0);
          // Khoét ô cửa: cửa nào nằm trên tuyến tường này thì tường chừa ra, chỉ còn lanh tô.
          const o_ = { x: (ax + bx) / 2, z: (az + bz) / 2 };
          const ux = dx / len, uz = dz / len;
          const oCua = [];
          for (const c of customOf(f.page)) {
            if (c.type !== 'door') continue;
            if (chuCuaTuVe(f, c) !== o.id) continue;   // chỉ bức tường GẦN NHẤT mới bị khoét
            const [cx0, cz0] = worldXZ(f, c.u0, c.v0), [cx1, cz1] = worldXZ(f, c.u1, c.v1);
            const cd = Math.hypot(cx1 - cx0, cz1 - cz0);
            if (cd < .2) continue;
            // song song với tường?
            const cheo = Math.abs(((cx1 - cx0) * uz - (cz1 - cz0) * ux) / cd);
            if (cheo > 0.26) continue;                         // lệch quá 15° -> không phải cửa của tường này
            const chieu = (px, pz) => (px - ax) * ux + (pz - az) * uz;   // toạ độ dọc tường
            const ngang = (px, pz) => Math.abs((px - ax) * uz - (pz - az) * ux);
            const gx = (cx0 + cx1) / 2, gz = (cz0 + cz1) / 2;
            if (ngang(gx, gz) > (o.t || .22) / 2 + 0.8) continue;       // cửa không nằm trên tường
            const tg = chieu(gx, gz);
            if (tg < -(cd / 2 + 1.0) || tg > len + cd / 2 + 1.0) continue;  // cùng dung sai với phép dò bên cửa
            // Ô cửa khoét ĐÚNG CHỖ cửa đứng, không trượt đi đâu cả.
            if (len < cd * 1.1) continue;         // tường ngắn hơn cửa thì không khoét
            const a0 = Math.max(0, tg - cd / 2);
            const a1 = Math.min(len, tg + cd / 2);
            if (a1 - a0 < cd * 0.5) continue;     // cửa không thực sự nằm trên tường này
            oCua.push([a0, a1, (c.h || 2.1) * state.explode]);
          }
          if (!oCua.length) {
            mesh = new THREE.Mesh(new THREE.BoxGeometry(len, h, day), mat);
            mesh.position.set((ax + bx) / 2, y + h / 2, (az + bz) / 2);
            mesh.rotation.y = goc;
          } else {
            oCua.sort((p1, p2) => p1[0] - p2[0]);
            mesh = new THREE.Group();
            const dat = (t0, t1, yTam, cao) => {
              if (t1 - t0 < .02 || cao < .02) return;
              const m = new THREE.Mesh(new THREE.BoxGeometry(t1 - t0, cao, day), mat);
              m.position.set((t0 + t1) / 2 - len / 2, yTam, 0);
              mesh.add(m);
            };
            let cur = 0;
            for (const [a0, a1, hc] of oCua) {
              if (a0 > cur) dat(cur, a0, h / 2, h);
              dat(a0, a1, hc + (h - hc) / 2, h - hc);          // lanh tô trên ô cửa
              cur = Math.max(cur, a1);
            }
            if (cur < len) dat(cur, len, h / 2, h);
            mesh.position.set((ax + bx) / 2, y, (az + bz) / 2);
            mesh.rotation.y = goc;
          }
        } else {
          const w = Math.max(.15, Math.abs(bx - ax)), d = Math.max(.15, Math.abs(bz - az));
          mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          mesh.position.set((ax + bx) / 2, y + h / 2, (az + bz) / 2);
          mesh.rotation.y = (o.rot || 0);
        }
      }
      if (mesh.isGroup) mesh = gopNhom(mesh);     // gộp để giảm số lệnh vẽ
      mesh.userData.obj = o;
      mesh.userData.page = f.page;               // để đánh mã số khỏi phải dò lại
      // Ở MẶT BẰNG 2D phải vẽ SAU tấm ảnh bản vẽ. Vật liệu tường đặt
      // depthWrite = false (cho khỏi vỡ mặt khi mờ), nên nó không ghi chiều sâu;
      // tấm ảnh bản vẽ có renderOrder = 1, vẽ sau, phủ luôn lên tường -> vẽ
      // tường ra mà màn hình không thấy gì. Cho vật tự vẽ renderOrder = 3.
      mesh.renderOrder = state.plan ? 3 : 0;
      mesh.traverse(q => { if (q.isMesh) q.renderOrder = mesh.renderOrder; });
      customGroup.add(mesh);
      customMeshes.push(mesh);
    }
  }
  ganMaSo();                                   // đánh mã cho vật tự vẽ
  // Vua ve/xoa/doi tuong -> dat lai binh de no bam len tuong moi ngay lap tuc.
  if (markers.length) datLaiViTriBinh();
  renderDesignList();
}

function selectedObj() {
  if (!state.sel || state.sel.slice(0, 2) !== 'c:') return null;
  const id = state.sel.slice(2);
  for (const p of Object.keys(state.custom)) {
    const o = state.custom[p].find(x => x.id === id);
    if (o) return o;
  }
  return null;
}

function renderDesignList() {
  const box = $('#dlist');
  if (!box) return;
  const f = activeFloorObj();
  const list = customOf(f.page);
  $('#dtarget').innerHTML = 'Đang vẽ lên: <b>' + f.name + '</b><br>' +
    'Muốn đổi tầng: sang tab <i>Xem</i>, bấm tên cao trình khác.';
  box.innerHTML = list.length ? '' : '<div class="sub">Chưa có đối tượng nào ở cao trình này.</div>';
  const col = t => t === 'san' ? '#6fa8c8' : t === 'nutbao' ? '#cc1f18' : t === 'hong' ? '#cf2b20' : t === 'thangmay' ? '#7f8b97' : t === 'lo' ? '#c8b06a' : t === 'thangbo' ? '#c3bfb4' : t === 'beacon' ? '#e0231c' : t === 'chop' ? '#c6c2b7' : t === 'toma' ? '#b9b6ad' : t === 'emg' ? '#f2f2ee' : t === 'fm200' ? '#c2231b' : t === 'bin' ? '#e23b2e' : t === 'wall' ? '#d8c6a8'
    : t === 'tra' ? '#96a3b0' : t === 'rail' ? '#c9d4de' : t === 'stair' ? '#b9c3cd' : '#5fa0c8';
  list.forEach(o => {
    const r = el('div', 'objrow',
      '<span class="dot" style="background:' + col(o.type) + '"></span>' +
      '<span style="flex:1">' + o.name + '</span><span class="x" title="Xoá">✕</span>');
    if ('c:' + o.id === state.sel) { r.style.background = '#3a2a12'; r.style.outline = '1px solid #6d4f1d'; }
    r.onclick = () => { selectKey('c:' + o.id); };
    r.querySelector('.x').onclick = ev => { ev.stopPropagation(); removeObj(o.id); };
    box.appendChild(r);
  });
}

// Hoàn tác theo ảnh chụp: trước mỗi thao tác làm thay đổi bản vẽ, chụp lại
// toàn bộ {custom, edits}. Nhờ vậy hoàn tác được CẢ việc xoá, đổi loại, di chuyển,
// xoay — không riêng gì việc vẽ thêm.
const MAX_UNDO = 60;
function chup() {
  state.undo.push(JSON.stringify({ custom: state.custom, edits: state.edits }));
  if (state.undo.length > MAX_UNDO) state.undo.shift();
  banDoiChua(true);
  renderEditPanel();
}

function hoanTac() {
  const snap = state.undo.pop();
  if (!snap) { hint('Không còn gì để hoàn tác'); setTimeout(() => hint(''), 1500); return; }
  const d = JSON.parse(snap);
  state.custom = d.custom || {};
  state.edits = d.edits || {};
  state.sel = null; clearHighlight();
  luuCucBo();
  rebuildMasses(); rebuildCustom(); buildExits(); renderEditPanel();
  hint('Đã hoàn tác (' + state.undo.length + ' bước nữa)');
  setTimeout(() => hint(''), 1600);
}

function addObj(f, o) {
  chup();
  o.id = 'C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  customOf(f.page).push(o);
  saveCustom();
  rebuildCustom();
  if (o.type === 'door' || o.type === 'lo' || o.type === 'san') rebuildMasses();  // khoét tường / dựng lại sàn
}
function removeObj(id) {
  chup();
  for (const p of Object.keys(state.custom)) {
    const i = state.custom[p].findIndex(o => o.id === id);
    if (i < 0) continue;
    // Tuong cong gom nhieu doan mang chung ma nhom -> xoa la di ca vong,
    // khong bat nguoi dung xoa tung doan mot.
    const nhom = state.custom[p][i].nhom;
    if (nhom) state.custom[p] = state.custom[p].filter(o => o.nhom !== nhom);
    else state.custom[p].splice(i, 1);
    break;
  }
  if (state.sel === 'c:' + id) state.sel = null;
  saveCustom(); rebuildCustom(); rebuildMasses();
}
// Lưu cục bộ (localStorage) diễn ra ngay để không mất việc khi đóng nhầm trang;
// còn đẩy lên đám mây thì CHỈ khi bấm nút "Lưu".
function luuCucBo() {
  try {
    localStorage.setItem(khoaKho('custom'), JSON.stringify(state.custom));
    localStorage.setItem(khoaKho('edits'), JSON.stringify(state.edits));
  } catch (e) { }
}

let coThayDoi = false;
function banDoiChua(v) {
  coThayDoi = v;
  const b = $('#dSave');
  if (b) { b.textContent = v ? '● Lưu thay đổi' : 'Lưu'; b.classList.toggle('pri', true); }
  if (v && cloud.san) cloud.trangThai('Có thay đổi chưa lưu — bấm “Lưu thay đổi”', '#e0b05f');
}

function saveCustom() {
  luuCucBo();
  banDoiChua(true);
}


// ---- chọn: dùng chung cho đối tượng tự vẽ (c:id) và đối tượng bóc từ bản vẽ
// (w:trang:chỉ_số = tường, b:trang:chỉ_số = tủ/thiết bị)
let selHighlight = null;
const MAT_BINH_THEM = new THREE.MeshStandardMaterial({ color: 0xe23b2e, roughness: .45, emissive: 0x3a0a06 });
// binh CO2 24kg xe day: mau xanh nhu ben ban ve goc, cho de phan biet
const MAT_BINH_CO224 = new THREE.MeshStandardMaterial({ color: 0x1f9d6b, roughness: .45, emissive: 0x08251a });
const MAT_HL = new THREE.MeshBasicMaterial({ color: 0xffc14d, transparent: true, opacity: .55,
  depthTest: false });

function clearHighlight() {
  if (selHighlight) { customGroup.remove(selHighlight); selHighlight.geometry.dispose(); selHighlight = null; }
}

function keyLabel(key) {
  if (!key) return '';
  if (key.slice(0, 2) === 'c:') { const o = selectedObj(); return o ? o.name : 'đối tượng tự vẽ'; }
  const p = key.split(':');
  const f = floorOf(+p[1]);
  const ten = p[0] === 'w' ? 'Tường #' : p[0] === 'b' ? 'Tủ/thiết bị #'
    : p[0] === 'd' ? 'Cánh cửa #' : p[0] === 'x' ? 'Đèn EXIT ' : 'Bình ';
  return ten + key.split(':').slice(2).join(':') + ' — ' + (f ? f.name : '');
}

function selectKey(key, hitObj, instanceId) {
  state.sel = key;
  clearHighlight();
  if (key && hitObj && instanceId !== undefined && instanceId !== null && hitObj.isInstancedMesh) {
    const m = new THREE.Matrix4();
    hitObj.getMatrixAt(instanceId, m);
    selHighlight = new THREE.Mesh(unitBox, MAT_HL);
    selHighlight.applyMatrix4(m);
    selHighlight.scale.multiplyScalar(1.04);
    selHighlight.renderOrder = 9;
    customGroup.add(selHighlight);
  } else if (key && (key.slice(0, 2) === 'm:' || key.slice(0, 2) === 'x:') && hitObj) {
    const b = new THREE.Box3().setFromObject(hitObj);
    const sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    selHighlight = new THREE.Mesh(unitBox, MAT_HL);
    selHighlight.scale.set(Math.max(sz.x, .3) * 1.5, Math.max(sz.y, .3) * 1.2, Math.max(sz.z, .3) * 1.5);
    selHighlight.position.copy(c);
    selHighlight.renderOrder = 9;
    customGroup.add(selHighlight);
  }
  rebuildCustom();
  if (key && key.slice(0, 2) === 'c:') docSoDo(selectedObj());
  renderEditPanel();
  hint(key ? 'Đã chọn: ' + keyLabel(key) + ' — Delete để xoá'
    : 'Chưa trúng đối tượng nào — bấm đúng vào tường / khối');
}

// ---- Ô kích thước <-> đối tượng đang chọn
// Chọn vật nào thì các ô số nhảy về đúng số đo của vật đó; sửa số rồi bấm Lưu
// (hoặc nút ✓ Áp dụng) là vật đổi theo ngay.
function docSoDo(o) {
  if (!o) return;
  const dat = (id, v) => { const e = $(id); if (e && v !== undefined && v !== null) e.value = v; };
  dat('#dBase', o.base || 0);
  if (o.type === 'wall') { dat('#dThick', o.t || .22); dat('#dWallH', o.h || 0); }
  else if (o.type === 'box') dat('#dBoxH', o.h);
  else if (o.type === 'tra') dat('#dTraH', o.h);
  else if (o.type === 'rail') dat('#dRailH', o.h);
  else if (o.type === 'stair') { dat('#dStairW', o.w || 1.2); dat('#dWallH', o.h || 0); }
  else if (o.type === 'roof') dat('#dRoofH', o.h || 0);
  else if (o.type === 'toma') dat('#dTomaH', o.h || 3);
  else if (o.type === 'chop') { dat('#dChopH', o.h || 1.5); dat('#dChopTop', o.top || .58); }
  else if (o.type === 'beacon') dat('#dBeaconH', o.h || .18);
  else if (o.type === 'thangbo') { dat('#dThangH', o.h || 3); dat('#dStairW', o.w || 1.26); }
  else if (o.type === 'lo') dat('#dLoTang', o.tang || 1);
  else if (o.type === 'thangmay') dat('#dTmayH', o.h || 10);
  else if (o.type === 'fm200') dat('#dFmH', o.h || 1.8);
  else if (o.type === 'exit') dat('#dExitH', o.h || EXIT_H);
  else if (o.type === 'emg') dat('#dEmgH', o.h || 2.6);
  else if (o.type === 'door') {
    dat('#dDoorH', o.h || 2.1);
    if ($('#dDoorKind')) $('#dDoorKind').value = o.kind || 'don';
    if ($('#dFlip')) $('#dFlip').value = o.flip ? '1' : '0';
  }
}

function apDungSoDo(im) {
  const o = selectedObj();
  if (!o) return false;
  const so = id => +$(id).value;
  chup();
  o.base = so('#dBase') || 0;
  if (o.type === 'wall') { o.t = Math.max(.05, so('#dThick') || .22); o.h = so('#dWallH') || 0; }
  else if (o.type === 'box') o.h = Math.max(.1, so('#dBoxH') || 2);
  else if (o.type === 'tra') o.h = Math.max(1, so('#dTraH') || 3.2);
  else if (o.type === 'rail') o.h = Math.max(.3, so('#dRailH') || 1.1);
  else if (o.type === 'stair') { o.w = Math.max(.5, so('#dStairW') || 1.2); o.h = so('#dWallH') || 0; }
  else if (o.type === 'roof') o.h = Math.max(0, so('#dRoofH') || 0);
  else if (o.type === 'toma') o.h = Math.max(0.2, so('#dTomaH') || 3);
  else if (o.type === 'beacon') o.h = Math.max(0.06, so('#dBeaconH') || .18);
  else if (o.type === 'lo') o.tang = Math.max(1, Math.round(so('#dLoTang') || 1));
  else if (o.type === 'thangmay') o.h = Math.max(2, so('#dTmayH') || 10);
  else if (o.type === 'thangbo') {
    o.h = Math.max(0.3, so('#dThangH') || 3);
    o.w = Math.max(0.8, so('#dStairW') || 1.26);
  }
  else if (o.type === 'chop') {
    o.h = Math.max(0.15, so('#dChopH') || 1.5);
    o.top = Math.min(.92, Math.max(.25, so('#dChopTop') || .58));
  }
  else if (o.type === 'fm200') o.h = Math.max(0.6, so('#dFmH') || 1.8);
  else if (o.type === 'exit') o.h = Math.max(0.5, so('#dExitH') || EXIT_H);
  else if (o.type === 'emg') o.h = Math.max(0.5, so('#dEmgH') || 2.6);
  else if (o.type === 'door') {
    o.h = Math.max(1, so('#dDoorH') || 2.1);
    o.kind = $('#dDoorKind').value;
    o.flip = $('#dFlip').value === '1';
  }
  saveCustom(); rebuildCustom();
  if (o.type === 'door' || o.type === 'lo' || o.type === 'san') rebuildMasses();
  renderEditPanel();
  if (!im) { hint('Đã đổi số đo: ' + (o.name || 'đối tượng')); setTimeout(() => hint(''), 1800); }
  return true;
}

function renderEditPanel() {
  const box = $('#dsel');
  if (!box) return;
  if (!state.sel) { box.innerHTML = '<div class="sub">Chưa chọn gì.</div>'; return; }
  const p = state.sel.split(':');
  const isDrawn = p[0] === 'w' || p[0] === 'b';
  box.innerHTML = '<div style="font-size:12px;margin-bottom:6px">' + keyLabel(state.sel) + '</div>';
  const btns = el('div', 'btns');
  const bDel = el('button', 'pri', '🗑 Xoá');
  bDel.onclick = () => deleteSelection();
  btns.appendChild(bDel);
  if (isDrawn) {
    const b2 = el('button', '', p[0] === 'w' ? '→ Đổi thành tủ/thiết bị' : '→ Đổi thành tường');
    b2.onclick = () => {
      chup();
      const ed = editsOf(+p[1]), i = +p[2];
      if (p[0] === 'w') { if (ed.toCab.indexOf(i) < 0) ed.toCab.push(i); }
      else { if (ed.toWall.indexOf(i) < 0) ed.toWall.push(i); }
      saveEdits(); state.sel = null; clearHighlight(); rebuildMasses(); renderEditPanel();
    };
    btns.appendChild(b2);
  }
  if (p[0] === 'x' || (state.sel.slice(0, 2) === 'c:' && (selectedObj() || {}).type === 'exit')) {
    const bc = el('button', '', '⤒ Gắn lên cửa gần nhất');
    bc.onclick = () => ganDenLenCua();
    btns.appendChild(bc);
  }
  if (p[0] === 'x') {                         // đèn EXIT bóc từ bản vẽ: chọn mặt treo
    const id = p.slice(2).join(':'), ed = editsOf(+p[1]);
    const nay = ed.matExit[id] || 0;
    const datMat = v => {
      chup();
      if (v === 0) delete ed.matExit[id]; else ed.matExit[id] = v;
      saveEdits(); buildExits(); renderEditPanel();
      hint(v === 0 ? 'Đèn EXIT: để máy tự chọn mặt'
        : 'Đèn EXIT đặt ' + (v > 0 ? 'PHÍA TRƯỚC' : 'PHÍA SAU') + ' cửa');
      setTimeout(() => hint(''), 2200);
    };
    const b1 = el('button', nay > 0 ? 'pri' : '', '◀ Trước cửa');
    const b2 = el('button', nay < 0 ? 'pri' : '', 'Sau cửa ▶');
    const b0 = el('button', nay === 0 ? 'pri' : '', '⟲ Tự động');
    b1.onclick = () => datMat(1); b2.onclick = () => datMat(-1); b0.onclick = () => datMat(0);
    btns.appendChild(b1); btns.appendChild(b2); btns.appendChild(b0);
  }
  if (state.sel.slice(0, 2) === 'c:' && (selectedObj() || {}).base) {
    const hz = el('button', '', '⤓ Hạ về sàn');
    hz.onclick = () => { const o = selectedObj(); if (!o) return;
      chup(); o.base = 0; saveCustom(); rebuildCustom(); buildExits(); renderEditPanel(); };
    btns.appendChild(hz);
  }
  if (state.sel.slice(0, 2) === 'c:') {
    const ap = el('button', 'pri', '✓ Áp dụng số đo');
    ap.onclick = () => apDungSoDo();
    btns.appendChild(ap);
    const r1 = el('button', '', '⟲ 15°'); r1.onclick = () => rotateSel(-15);
    const r2 = el('button', '', '⟳ 15°'); r2.onclick = () => rotateSel(15);
    const r3 = el('button', '', '⟳ 90°'); r3.onclick = () => rotateSel(90);
    btns.appendChild(r1); btns.appendChild(r2); btns.appendChild(r3);
  } else if (p[0] === 'w' || p[0] === 'b') {
    const b3 = el('button', '', '✥ Tách ra để sửa');
    b3.onclick = () => detachToCustom(state.sel);
    btns.appendChild(b3);
  }
  box.appendChild(btns);
  if (state.sel.slice(0, 2) === 'c:')
    box.appendChild(el('div', 'sub', 'Kéo chuột trên đối tượng để di chuyển · R / Shift+R xoay · ' +
      'sửa ô Kích thước rồi bấm ✓ (hoặc Lưu) để đổi số đo vật này'));
}

// Biến một tường / tủ bóc từ bản vẽ thành đối tượng tự vẽ để di chuyển, xoay, đổi kích thước.
function detachToCustom(key) {
  const p = key.split(':'), f = floorOf(+p[1]), i = +p[2];
  const src = p[0] === 'w' ? (f.walls || []) : (f.cabinets || []);
  const r = src[i]; if (!r) return;
  const ngang = (r[2] - r[0]) >= (r[3] - r[1]);
  const o = p[0] === 'w'
    ? { type: 'wall', t: Math.max(.12, (ngang ? r[3] - r[1] : r[2] - r[0]) * mpp()), h: 0,
        u0: ngang ? r[0] : (r[0] + r[2]) / 2, v0: ngang ? (r[1] + r[3]) / 2 : r[1],
        u1: ngang ? r[2] : (r[0] + r[2]) / 2, v1: ngang ? (r[1] + r[3]) / 2 : r[3],
        name: 'Tường tách ra #' + i }
    : { type: 'box', h: CAB_H, u0: r[0], v0: r[1], u1: r[2], v1: r[3], name: 'Tủ tách ra #' + i };
  state.sel = key; deleteSelection();          // bỏ bản gốc
  addObj(f, o);
  selectKey('c:' + o.id);
  hint('Đã tách ra — nay kéo để di chuyển, bấm ⟳ để xoay');
  setTimeout(() => hint(''), 2600);
}

// Kéo đèn EXIT đang chọn về treo trên cửa gần nhất (trong vòng 12 m).
function ganDenLenCua() {
  if (!state.sel) return;
  const pr = state.sel.split(':');
  let f, wx, wz, dat;
  if (pr[0] === 'x') {
    const id = pr.slice(2).join(':');
    f = floorOf(+pr[1]);
    const it = ((state.exitData && state.exitData.items) || []).find(x => x.id === id);
    if (!f || !it) return;
    const ed = editsOf(f.page), cu = ed.movExit[id] || [it.bx, it.by];
    [wx, wz] = worldXZ(f, cu[0], cu[1]);
    dat = (u, v) => { editsOf(f.page).movExit[id] = [round2(u), round2(v)]; saveEdits(); buildExits(); };
  } else {
    const o = selectedObj();
    if (!o || o.type !== 'exit') return;
    f = activeFloorObj();
    [wx, wz] = worldXZ(f, o.u0, o.v0);
    dat = (u, v) => { o.u0 = o.u1 = u; o.v0 = o.v1 = v; saveCustom(); rebuildCustom(); };
  }
  const cua = cuaGanNhat(f, wx, wz, 12);
  if (!cua) { hint('Không có cửa nào trong vòng 12 m'); setTimeout(() => hint(''), 2500); return; }
  chup();
  const uv = baseFromWorld(f, cua.x, cua.z);
  dat(uv[0], uv[1]);
  hint('Đã gắn đèn lên cửa: ' + (cua.cua.name || 'cửa'));
  setTimeout(() => hint(''), 2500);
}

function deleteSelection() {
  if (!state.sel) { hint('Chưa chọn đối tượng nào'); setTimeout(() => hint(''), 1500); return; }
  chup();
  if (state.sel.slice(0, 2) === 'c:') { removeObj(state.sel.slice(2)); }
  else {
    const p = state.sel.split(':'), ed = editsOf(+p[1]);
    if (p[0] === 'x') {
      const id = state.sel.split(':').slice(2).join(':');
      if (ed.delExit.indexOf(id) < 0) ed.delExit.push(id);
      saveEdits(); state.sel = null; clearHighlight(); buildExits();
    } else if (p[0] === 'm') {
      const id = state.sel.split(':').slice(2).join(':');
      if (ed.delItem.indexOf(id) < 0) ed.delItem.push(id);
      saveEdits(); state.sel = null; clearHighlight();
      applyVisibility(); renderSidebar && renderSidebar();
    } else {
      const i = +p[2];
      const arr = p[0] === 'w' ? ed.delWall : p[0] === 'b' ? ed.delCab : ed.delDoor;
      if (arr.indexOf(i) < 0) arr.push(i);
      // Một bức tường trên bản vẽ có thể bị bóc ra thành 2–3 hình chồng lên nhau
      // (cặp nét song song trùng nhau). Xoá luôn các hình trùng, nếu không người dùng
      // xoá xong vẫn thấy tường vì hình còn lại nằm ngay dưới.
      if (p[0] === 'w' || p[0] === 'b') {
        const f = floorOf(+p[1]);
        const src = p[0] === 'w' ? f.walls : f.cabinets;
        const r0 = src[i];
        if (r0) {
          const dt = (a, b) => {
            const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
            const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
            if (ox <= 0 || oy <= 0) return 0;
            const A = Math.max(1e-6, (a[2] - a[0]) * (a[3] - a[1]));
            const B = Math.max(1e-6, (b[2] - b[0]) * (b[3] - b[1]));
            return (ox * oy) / Math.min(A, B);
          };
          [['w', f.walls || [], ed.delWall], ['b', f.cabinets || [], ed.delCab]]
            .forEach(([t, list, del]) => list.forEach((r, j) => {
              if (t === p[0] && j === i) return;
              if (del.indexOf(j) < 0 && dt(r0, r) > 0.6) del.push(j);
            }));
        }
      }
      saveEdits(); state.sel = null; clearHighlight(); rebuildMasses();
    }
  }
  renderEditPanel();
  hint('Đã xoá'); setTimeout(() => hint(''), 1200);
}

function saveEdits() {
  luuCucBo();
  banDoiChua(true);
}

// ====================================================== ĐỒNG BỘ QUA SUPABASE
// Tuỳ chọn: khai báo url + anon key trong web/config.js. Không khai báo thì
// mọi thứ chạy y như cũ, chỉ lưu trong trình duyệt.
// Gọi thẳng REST API (PostgREST) bằng fetch nên không cần thư viện ngoài.
// Trên máy có sẵn dữ liệu (lần trước vẽ mà chưa kịp bấm Lưu) hay không.
function coViecCuTrenMay() {
  const n = Object.values(state.custom || {}).reduce((a, x) => a + (x ? x.length : 0), 0);
  const e = Object.values(state.edits || {}).reduce((a, x) => a + (x ?
    (x.delWall.length + x.delCab.length + x.toCab.length + x.toWall.length +
     (x.delDoor || []).length + (x.delItem || []).length) : 0), 0);
  return n + e > 0;
}

const cloud = {
  cfg: null, san: false, dangDay: false, hen: null, lanCuoi: 0, moc: null,

  khoi() {
    const c = window.IALY_CLOUD;
    if (!c || !c.url || !c.key) { this.trangThai('Chỉ lưu trong trình duyệt này'); return; }
    // Mỗi nhà máy một bản vẽ riêng trên đám mây.
    this.cfg = Object.assign({}, c, { doc: NM.doc });
    this.san = true;
    this.keo(true);
    setInterval(() => this.keo(false), 15000);   // 15 giây lấy thay đổi của người khác
  },

  api(duong, opt = {}) {
    const c = this.cfg;
    // Gộp opt TRƯỚC rồi mới đặt headers, nếu không headers của opt sẽ đè mất khoá.
    const y = Object.assign({}, opt);
    y.headers = Object.assign({
      apikey: c.key, Authorization: 'Bearer ' + c.key,
      'Content-Type': 'application/json'
    }, opt.headers || {});
    return fetch(c.url.replace(/\/$/, '') + '/rest/v1/' + duong, y);
  },

  trangThai(txt, mau) {
    const e = $('#cloud');
    if (!e) return;
    e.textContent = '☁ ' + txt;
    e.style.color = mau || '';
  },

  async keo(lanDau, ep) {
    if (!this.san || this.dangDay) return;
    try {
      const r = await this.api('ialy_thiet_ke?doc=eq.' +
        encodeURIComponent(this.cfg.doc) + '&select=du_lieu,cap_nhat_luc');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rows = await r.json();
      if (!rows.length) {                       // chưa có trên đám mây -> đẩy bản đang có lên
        this.trangThai('Đã kết nối — chưa có dữ liệu, sẽ tạo mới');
        if (lanDau) this.push(true);
        return;
      }
      const row = rows[0];
      if (row.cap_nhat_luc === this.moc && !ep) { this.trangThai('Đã đồng bộ'); return; }
      const d = row.du_lieu || {};
      // Không bao giờ đè lên thay đổi người dùng chưa bấm Lưu.
      const khac = JSON.stringify({ custom: state.custom, edits: state.edits }) !==
                   JSON.stringify({ custom: d.custom || {}, edits: d.edits || {} });
      if (!ep && khac && (coThayDoi || (lanDau && coViecCuTrenMay()))) {
        this.moc = null;
        this.trangThai('Bản trên máy khác với đám mây — bấm “Lưu thay đổi” để đẩy lên', '#e0b05f');
        const b = $('#dPull'); if (b) b.style.display = '';
        return;
      }
      this.moc = row.cap_nhat_luc;
      const b = $('#dPull'); if (b) b.style.display = 'none';
      state.custom = d.custom || {};
      state.edits = d.edits || {};
      try {
        localStorage.setItem(khoaKho('custom'), JSON.stringify(state.custom));
        localStorage.setItem(khoaKho('edits'), JSON.stringify(state.edits));
      } catch (e) { }
      // Luôn dựng lại: lần kéo đầu tiên chạy bất đồng bộ nên xong SAU khi cảnh đã dựng,
      // không dựng lại thì dữ liệu tải về không hiện lên.
      rebuildMasses(); rebuildCustom(); buildExits();
      banDoiChua(false);
      this.trangThai('Đã tải bản mới nhất (' + new Date(row.cap_nhat_luc).toLocaleTimeString() + ')');
    } catch (e) {
      this.trangThai('Không kết nối được: ' + e.message, '#e07a5f');
    }
  },

  // Chụp lại bản đang có trên đám mây thành một dòng lịch sử trước khi ghi đè.
  // Nhờ vậy lỡ tay lưu đè (hoặc lưu nhầm bản trống) vẫn lấy lại được.
  async luuLichSu() {
    try {
      const r = await this.api('ialy_thiet_ke?doc=eq.' +
        encodeURIComponent(this.cfg.doc) + '&select=du_lieu');
      if (!r.ok) return;
      const rows = await r.json();
      if (!rows.length) return;
      const d = rows[0].du_lieu || {};
      const n = Object.values(d.custom || {}).reduce((a, x) => a + (x ? x.length : 0), 0);
      if (!n) return;                                   // bản trống thì khỏi lưu lịch sử
      await this.api('ialy_thiet_ke?on_conflict=doc', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([{ doc: this.cfg.doc + '#' + new Date().toISOString(),
                                du_lieu: d, cap_nhat_luc: new Date().toISOString() }])
      });
    } catch (e) { /* lưu lịch sử hỏng thì cũng không chặn việc lưu chính */ }
  },

  // Lấy danh sách bản lưu cũ, mới nhất trước.
  async lichSu() {
    const r = await this.api('ialy_thiet_ke?doc=like.' +
      encodeURIComponent(this.cfg.doc + '#*') + '&select=doc,cap_nhat_luc,du_lieu&order=doc.desc');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  },

  push(ngay) {
    if (!this.san) return;
    clearTimeout(this.hen);                     // gom nhiều thay đổi liên tiếp thành một lần ghi
    this.hen = setTimeout(() => this.day(), ngay ? 0 : 1200);
  },

  async day() {
    if (!this.san) return;
    this.dangDay = true;
    this.trangThai('Đang lưu…');
    try {
      await this.luuLichSu();          // giữ lại bản trước khi ghi đè
      const r = await this.api('ialy_thiet_ke?on_conflict=doc', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([{
          doc: this.cfg.doc,
          du_lieu: { custom: state.custom, edits: state.edits },
          cap_nhat_luc: new Date().toISOString()
        }])
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + (await r.text()).slice(0, 120));
      const rows = await r.json();
      if (rows && rows[0]) this.moc = rows[0].cap_nhat_luc;
      this.trangThai('Đã lưu lên đám mây ' + new Date().toLocaleTimeString());
    } catch (e) {
      this.trangThai('Lưu thất bại: ' + e.message, '#e07a5f');
    }
    this.dangDay = false;
  }
};

function rebuildMasses() {
  masses.forEach(m => { m.traverse(o => o.geometry && o.geometry.dispose()); massGroup.remove(m); });
  masses = []; pickables = []; pickRects = [];
  for (const f of state.data.floors) {
    const mass = buildMassing(f);
    if (mass) { massGroup.add(mass); masses.push(mass); }
  }
  applyVisibility();
}

// ---- mái nhà: cao đỉnh = 0 -> mái bằng (tấm phẳng); > 0 -> mái dốc hai mái,
// sống mái chạy dọc theo cạnh DÀI của hình chữ nhật vừa kéo.
function makeRoof(w, d, dinh, mat) {
  // Mái bê tông cốt thép đổ tại chỗ:
  //  - cao đỉnh = 0 -> mái bằng: bản mê dày 15 cm, có dầm biên và gờ chắn mái quanh chu vi
  //  - cao đỉnh > 0 -> mái dốc BTCT hai mái, sống mái chạy theo cạnh dài
  const g = new THREE.Group();
  const day = 0.15;                                   // chiều dày bản mê (m)
  const hDam = 0.35, bDam = 0.22;                     // dầm biên
  const hGo = 0.30, bGo = 0.12;                       // gờ chắn mái (bo mái)

  if (dinh <= 0.05) {
    const ban = new THREE.Mesh(new THREE.BoxGeometry(w, day, d), mat);
    ban.position.y = day / 2;
    g.add(ban);
    // dầm biên chạy dưới mép bản
    for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hDam, bDam), mat);
      m.position.set(0, -hDam / 2, sz * (d / 2 - bDam / 2)); g.add(m);
    }
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bDam, hDam, d - 2 * bDam), mat);
      m.position.set(sx * (w / 2 - bDam / 2), -hDam / 2, 0); g.add(m);
    }
    // gờ chắn mái quanh chu vi
    for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hGo, bGo), mat);
      m.position.set(0, day + hGo / 2, sz * (d / 2 - bGo / 2)); g.add(m);
    }
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bGo, hGo, d - 2 * bGo), mat);
      m.position.set(sx * (w / 2 - bGo / 2), day + hGo / 2, 0); g.add(m);
    }
    const vien = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, day, d)),
      new THREE.LineBasicMaterial({ color: 0x27323d, transparent: true, opacity: .5 }));
    vien.position.y = day / 2;
    g.add(vien);
    return g;
  }

  // ----- mái dốc BTCT: lăng trụ tam giác, có bản dày nên dựng hai lớp
  const doc = w >= d;
  const L = doc ? w : d, N = doc ? d : w;
  const hw = L / 2, hn = N / 2;
  const v = [
    [-hw, 0, -hn], [hw, 0, -hn], [hw, 0, hn], [-hw, 0, hn],
    [-hw, dinh, 0], [hw, dinh, 0]
  ];
  const f = [
    [0, 1, 5], [0, 5, 4], [3, 4, 5], [3, 5, 2],
    [0, 4, 3], [1, 2, 5], [0, 3, 2], [0, 2, 1]
  ];
  const pos = [];
  for (const t of f) for (const i of t) pos.push(...v[i]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  const vien = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x27323d }));
  if (!doc) { m.rotation.y = Math.PI / 2; vien.rotation.y = Math.PI / 2; }
  g.add(m); g.add(vien);
  // dầm biên chân mái dốc
  for (const sz of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(doc ? w : bDam, hDam, doc ? bDam : d), mat);
    b.position.set(doc ? 0 : sz * (w / 2 - bDam / 2), -hDam / 2, doc ? sz * (d / 2 - bDam / 2) : 0);
    g.add(b);
  }
  return g;
}

// Cửa này có nằm trên một bức tường nào không (tường tự vẽ hoặc tường bóc từ bản vẽ)?
// Nếu có thì chính bức tường đó đã chừa ô cửa và để lại lanh tô, khỏi dựng thêm.
// Bức tường tự vẽ gần cửa nhất — chỉ bức này mới được khoét ô cửa, nếu không
// một ô cửa sẽ đục thủng cả hai bức tường song song hai bên hành lang.
let _chuCua = { khoa: null, map: null };
function chuCuaTuVe(f, c) {
  const khoa = f.page + '|' + customOf(f.page).length + '|' + state.explode;
  if (_chuCua.khoa !== khoa) {
    const map = {};
    for (const d of customOf(f.page)) {
      if (d.type !== 'door') continue;
      const [dx0, dz0] = worldXZ(f, d.u0, d.v0), [dx1, dz1] = worldXZ(f, d.u1, d.v1);
      const gx = (dx0 + dx1) / 2, gz = (dz0 + dz1) / 2;
      const cd = Math.hypot(dx1 - dx0, dz1 - dz0);
      if (cd < .2) continue;
      const ux = (dx1 - dx0) / cd, uz = (dz1 - dz0) / cd;
      let tot = null;
      for (const w of customOf(f.page)) {
        if (w.type !== 'wall') continue;
        const [ax, az] = worldXZ(f, w.u0, w.v0), [bx, bz] = worldXZ(f, w.u1, w.v1);
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1e-6) continue;
        const vx = (bx - ax) / L, vz = (bz - az) / L;
        if (Math.abs(vx * uz - vz * ux) > 0.26) continue;
        const t = (gx - ax) * vx + (gz - az) * vz;
        if (t < -(cd / 2 + 1) || t > L + cd / 2 + 1) continue;
        const tk = Math.max(0, Math.min(L, t));
        const dd = Math.hypot(gx - (ax + vx * tk), gz - (az + vz * tk));
        // phần ô cửa thực sự nằm trong bức tường này
        const phu = Math.max(0, Math.min(L, t + cd / 2) - Math.max(0, t - cd / 2)) / cd;
        if (phu < 0.5) continue;               // cửa phải NẰM TRONG bức tường mới được khoét
        const diem = dd - phu * 2.0;           // phủ càng nhiều càng được ưu tiên
        if (!tot || diem < tot.diem) tot = { diem: diem, d: dd, phu: phu, id: w.id };
      }
      // Không có tường nào chứa cửa (cửa đặt vào khe hở giữa hai đoạn tường)
      // -> KHÔNG khoét tường nào cả, nếu không sẽ thủng thêm một lỗ bên cạnh cửa.
      if (tot) map[d.id] = tot.id;
    }
    _chuCua = { khoa: khoa, map: map };
  }
  return _chuCua.map[c.id];
}

function tuongChuaCua(f, c) {
  // Tra ve { coTuong, caoTuong } — caoTuong (m) lay theo buc tuong gan nhat.
  const cd = Math.hypot(c.u1 - c.u0, c.v1 - c.v0);
  if (cd < .2) return { coTuong: false, caoTuong: 0 };
  const ux = (c.u1 - c.u0) / cd, uy = (c.v1 - c.v0) / cd;
  const gx = (c.u0 + c.u1) / 2, gy = (c.v0 + c.v1) / 2;
  const noiRong = cd / 2 + 1.0 / mpp();                 // cho phép cửa nằm sát đầu tường
  let tot = null;
  const xet = (x0, y0, x1, y1, day, cao) => {
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 1e-6) return;
    const vx = (x1 - x0) / L, vy = (y1 - y0) / L;
    if (Math.abs(vx * uy - vy * ux) > 0.26) return;     // không song song thì bỏ
    const t = (gx - x0) * vx + (gy - y0) * vy;
    if (t < -noiRong || t > L + noiRong) return;
    const n = Math.abs((gx - x0) * vy - (gy - y0) * vx);
    if (n > day / 2 + 0.8 / mpp()) return;
    if (!tot || n < tot.n) tot = { n: n, cao: cao };
  };
  for (const o of customOf(f.page)) {
    if (o.type !== 'wall') continue;
    xet(o.u0, o.v0, o.u1, o.v1, (o.t || .22) / mpp(), o.h || 0);
  }
  // Tường bóc từ bản vẽ chỉ được tính khi khối nhà đang hiện, vì chính nó mới
  // tạo ra mảng tường trên ô cửa; tắt khối nhà thì phải tự đắp.
  if (state.massing && matWallShared.visible) {
    const ed = editsOf(f.page), ds = f.walls || [];
    for (let i = 0; i < ds.length; i++) {
      if (ed.delWall.indexOf(i) >= 0 || ed.toCab.indexOf(i) >= 0) continue;
      const r = ds[i];
      const ngang = (r[2] - r[0]) >= (r[3] - r[1]);
      const day = ngang ? (r[3] - r[1]) : (r[2] - r[0]);
      xet(ngang ? r[0] : (r[0] + r[2]) / 2, ngang ? (r[1] + r[3]) / 2 : r[1],
          ngang ? r[2] : (r[0] + r[2]) / 2, ngang ? (r[1] + r[3]) / 2 : r[3], day, 0);
    }
  }
  if (tot) return { coTuong: true, caoTuong: tot.cao };
  // Không nằm trên tường nào: mượn chiều cao của bức tường gần nhất trong vòng 8 m
  // để mảng tường trên cửa cao bằng các tường xung quanh, nhìn cho đồng bộ.
  let gan = null;
  const R = 8 / mpp();
  for (const o of customOf(f.page)) {
    if (o.type !== 'wall') continue;
    const mx = (o.u0 + o.u1) / 2, my = (o.v0 + o.v1) / 2;
    const d = Math.hypot(mx - gx, my - gy);
    if (d < R && (!gan || d < gan.d)) gan = { d: d, cao: o.h || 0 };
  }
  return { coTuong: false, caoTuong: gan ? gan.cao : 0 };
}

// ---- Đèn chiếu sáng sự cố (đèn khẩn cấp 2 bóng pha)
// Thân hộp nhựa trắng gắn tường, hai chóa đèn tròn xoay được, đèn báo sạc màu
// xanh và nút thử ở mặt trước. Trục X dọc theo thân, gốc ở tâm thân, mặt trước +Z.
// ---- bình khí chữa cháy FM-200 (HFC-227ea): chai thép đỏ đứng, cổ van đồng,
// ống xả mềm lên ống góp, đai ôm bắt vào giá đỡ sát tường.
// ---- khối tổ máy (hố turbine/máy phát): vành bê tông ngoài, 8 vách hướng tâm
// chia thành 8 hốc, vành bát giác giữa, trụ ổ trục nhiều bậc và 8 bệ thép chôn.
const MAT_TM = {
  be: new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: .88 }),      // bê tông
  be2: new THREE.MeshStandardMaterial({ color: 0xa8a59c, roughness: .9 }),
  thep: new THREE.MeshStandardMaterial({ color: 0x8c96a1, roughness: .45, metalness: .65 }),
  truc: new THREE.MeshStandardMaterial({ color: 0x6e7781, roughness: .35, metalness: .8 }),
};
function makeUnitPit(D, sau, chon) {
  const g = new THREE.Group();
  const vl = k => chon ? MAT_SEL : MAT_TM[k];
  const R = Math.max(1, D / 2);                 // bán kính mép ngoài
  const H = Math.max(.2, sau || 3);             // chiều cao khối
  const rTang = R * .80;                        // mặt trong vành bê tông
  const rHub = R * .30;                         // vành bát giác giữa
  const N = 8;

  // vành bê tông ngoài (ống rỗng)
  const vanh = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 64, 1, true), vl('be'));
  vanh.position.y = H / 2; g.add(vanh);
  const vanhTr = new THREE.Mesh(new THREE.CylinderGeometry(rTang, rTang, H, 64, 1, true), vl('be2'));
  vanhTr.position.y = H / 2; g.add(vanhTr);
  const nap = new THREE.Mesh(new THREE.RingGeometry(rTang, R, 64), vl('be'));
  nap.rotation.x = -Math.PI / 2; nap.position.y = H + .002; g.add(nap);
  const day = new THREE.Mesh(new THREE.CircleGeometry(rTang, 64), vl('be2'));
  day.rotation.x = -Math.PI / 2; day.position.y = .01; g.add(day);

  // 8 vách hướng tâm nối vành ngoài với lõi giữa
  const dai = rTang - rHub;
  for (let i = 0; i < N; i++) {
    const a = (i + .5) * Math.PI * 2 / N;
    const v = new THREE.Mesh(new THREE.BoxGeometry(dai, H, R * .045), vl('be'));
    v.position.set(Math.cos(a) * (rHub + dai / 2), H / 2, Math.sin(a) * (rHub + dai / 2));
    v.rotation.y = -a;
    g.add(v);
  }

  // lõi giữa: vành bát giác + các bậc trụ ổ trục
  const bat = new THREE.Mesh(new THREE.CylinderGeometry(rHub, rHub, H, N, 1, true), vl('be'));
  bat.rotation.y = Math.PI / N; bat.position.y = H / 2; g.add(bat);
  const bac = (r0, r1, y0, y1, k) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, y1 - y0, 48), vl(k));
    m.position.y = (y0 + y1) / 2; g.add(m);
  };
  bac(R * .24, R * .24, 0, H * .96, 'be2');          // bệ ổ trục
  bac(R * .185, R * .185, H * .96, H * 1.10, 'thep');// vành ổ
  bac(R * .135, R * .135, H * 1.10, H * 1.28, 'truc');// trục
  [R * .24, R * .185].forEach((r, i) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, R * .012, 8, 48), vl('thep'));
    t.rotation.x = Math.PI / 2; t.position.y = H * (i ? 1.10 : .96); g.add(t);
  });

  // 8 bệ thép chôn trong hốc (ô gạch chéo trên bản vẽ)
  for (let i = 0; i < N; i++) {
    const a = i * Math.PI * 2 / N;
    const c = R * .55, w = R * .17;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, H * .10, w), vl('thep'));
    m.position.set(Math.cos(a) * c, H + H * .05, Math.sin(a) * c);
    m.rotation.y = -a;
    g.add(m);
  }
  return g;
}

// ---- hộp họng nước chữa cháy vách tường (DN65): tủ thép sơn đỏ, cánh kính,
// bên trong có cuộn vòi, lăng phun và van góc; chữ PCCC trắng trên cánh.
const MAT_HONG = {
  tu: new THREE.MeshStandardMaterial({ color: 0xcf2b20, roughness: .45, metalness: .2 }),
  kinh: new THREE.MeshStandardMaterial({ color: 0xbcd4e2, roughness: .1, metalness: .15,
    transparent: true, opacity: .45 }),
  voi: new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: .85 }),
  dong: new THREE.MeshStandardMaterial({ color: 0xc0903f, roughness: .35, metalness: .8 }),
  chu: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6 }),
};
function makeHydrant(chon) {
  const g = new THREE.Group();
  const vl = k => chon ? MAT_SEL : MAT_HONG[k];
  const W = .70, H = .85, D = .22, CHAN = .80;        // tủ 70×85×22, đáy cao 0,80 m
  const vo = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), vl('tu'));
  vo.position.y = CHAN + H / 2; g.add(vo);
  const canh = new THREE.Mesh(new THREE.BoxGeometry(W * .82, H * .8, .02), vl('kinh'));
  canh.position.set(0, CHAN + H / 2, D / 2 + .012); g.add(canh);
  const nhan = new THREE.Mesh(new THREE.BoxGeometry(W * .5, H * .12, .01), vl('chu'));
  nhan.position.set(0, CHAN + H * .9, D / 2 + .016); g.add(nhan);
  // cuộn vòi + van góc + lăng phun bên trong
  const cuon = new THREE.Mesh(new THREE.TorusGeometry(W * .22, W * .075, 10, 24), vl('voi'));
  cuon.position.set(-W * .18, CHAN + H * .45, 0); g.add(cuon);
  const van = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .16, 12), vl('dong'));
  van.rotation.z = Math.PI / 2;
  van.position.set(W * .26, CHAN + H * .3, 0); g.add(van);
  const lang = new THREE.Mesh(new THREE.CylinderGeometry(.03, .055, .26, 12), vl('dong'));
  lang.rotation.x = Math.PI / 2;
  lang.position.set(W * .26, CHAN + H * .66, 0); g.add(lang);
  // ống đứng DN65 chạy sau tủ
  const ong = new THREE.Mesh(new THREE.CylinderGeometry(.038, .038, CHAN + H + .5, 10), vl('dong'));
  ong.position.set(W * .42, (CHAN + H + .5) / 2, -D / 2 - .05); g.add(ong);
  return g;
}

// ---- thang máy: hố thang 4 cột thép + vách kính, cửa tầng ở từng cao trình,
// cabin có cửa và đèn trần, hai ray dẫn hướng, cáp kéo và phòng máy trên đỉnh.
const MAT_TMAY = {
  khung: new THREE.MeshStandardMaterial({ color: 0x7f8b97, roughness: .45, metalness: .65 }),
  kinh: new THREE.MeshStandardMaterial({ color: 0xa8c4d6, roughness: .12, metalness: .2,
    transparent: true, opacity: .28 }),
  cua: new THREE.MeshStandardMaterial({ color: 0xb8c6d2, roughness: .35, metalness: .7 }),
  cabin: new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: .4, metalness: .35 }),
  den: new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xffe9b0,
    emissiveIntensity: 1.3, roughness: .4 }),
};
function makeElevator(W, D, HT, moc, chon) {
  const g = new THREE.Group();
  const vl = k => chon ? MAT_SEL : MAT_TMAY[k];
  const w = Math.max(1.2, W), d = Math.max(1.2, D), H = Math.max(2, HT);
  const c = .14;                                    // cạnh cột
  // 4 cột góc
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(c, H, c), vl('khung'));
    m.position.set(sx * (w / 2 - c / 2), H / 2, sz * (d / 2 - c / 2));
    g.add(m);
  });
  // 3 vách kính (chừa mặt trước -z làm cửa tầng)
  const vach = (lx, lz, px, pz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(lx, H, lz), vl('kinh'));
    m.position.set(px, H / 2, pz); g.add(m);
  };
  vach(w - c, .04, 0, d / 2 - .02);
  vach(.04, d - c, -w / 2 + .02, 0);
  vach(.04, d - c, w / 2 - .02, 0);
  // hai ray dẫn hướng
  [-1, 1].forEach(sx => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(.07, H, .12), vl('khung'));
    r.position.set(sx * (w / 2 - .22), H / 2, 0); g.add(r);
  });
  // cửa tầng: hai cánh trượt ở mỗi cao trình
  const cuaCao = 2.1, cuaRong = Math.min(1.1, w * .5);
  (moc || [0]).forEach(yy => {
    if (yy > H - 1.2) return;
    [-1, 1].forEach(sx => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(cuaRong, cuaCao, .06), vl('cua'));
      m.position.set(sx * cuaRong / 2, yy + cuaCao / 2, -d / 2 + .05);
      g.add(m);
    });
    const lt = new THREE.Mesh(new THREE.BoxGeometry(cuaRong * 2 + .2, .16, .1), vl('khung'));
    lt.position.set(0, yy + cuaCao + .08, -d / 2 + .05); g.add(lt);
  });
  // cabin đứng ở cao trình thấp nhất
  const cw = w - .5, cd = d - .5, ch = 2.35;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cd), vl('cabin'));
  cab.position.set(0, (moc && moc.length ? moc[0] : 0) + ch / 2 + .12, 0);
  g.add(cab);
  const tran = new THREE.Mesh(new THREE.BoxGeometry(cw * .6, .05, cd * .6), vl('den'));
  tran.position.set(0, (moc && moc.length ? moc[0] : 0) + ch + .06, 0);
  g.add(tran);
  // cáp kéo + phòng máy trên đỉnh
  [-1, 1].forEach(sx => {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, H * .9, 6), vl('khung'));
    cap.position.set(sx * .25, H * .55, 0); g.add(cap);
  });
  const pm = new THREE.Mesh(new THREE.BoxGeometry(w + .3, 1.6, d + .3), vl('khung'));
  pm.position.set(0, H + .8, 0); g.add(pm);
  return g;
}

// ---- cầu thang bộ nhiều vế có chiếu nghỉ (thang xoay 180°): dựng đủ số vế để
// leo hết chiều cao tầng, các vế so le hai bên, giữa là chiếu nghỉ, có tay vịn.
const MAT_LO = new THREE.MeshStandardMaterial({ color: 0xc8b06a, roughness: .6 });
const MAT_SAN = new THREE.MeshStandardMaterial({ color: 0x6fa8c8, roughness: .6 });
const MAT_THANG = {
  ban: new THREE.MeshStandardMaterial({ color: 0xc3bfb4, roughness: .85 }),
  bac: new THREE.MeshStandardMaterial({ color: 0xd2cec3, roughness: .8 }),
  vin: new THREE.MeshStandardMaterial({ color: 0x9fb0be, roughness: .4, metalness: .6 }),
};
// Thông số một thang bộ: lấy SỐ BẬC ÍT NHẤT đủ lên hết chiều cao (bậc cao tối
// đa 19 cm theo QCVN), mặt bậc 30 cm; hai vế nằm sát nhau lấp kín bề ngang ô
// thang, chiếu nghỉ rộng bằng cả ô -> thang vẽ đầy ô, không còn khoảng trống.
const THANG_BAC = 0.30;          // bề rộng mặt bậc
const THANG_CAO = 0.19;          // chiều cao bậc tối đa
function thongSoThang(veDai, rong, caoTong) {
  const W = Math.max(.8, rong || 1.26);
  const HT = Math.max(.3, caoTong || 3);
  const dai = Math.max(1.2, veDai);                          // vế dài đúng nét đã vẽ
  const nMax = Math.max(3, Math.floor(dai / THANG_BAC));     // số bậc lọt trong vế
  const tongBac = Math.max(2, Math.ceil(HT / THANG_CAO));    // ít bậc nhất có thể
  const soVe = Math.max(1, Math.ceil(tongBac / nMax));
  const nVe = Math.max(2, Math.ceil(tongBac / soVe));        // bậc mỗi vế
  // mặt bậc giãn ra cho vế phủ kín chiều dài đã vẽ -> bậc to hơn, ít bậc hơn
  // Chiếu nghỉ / chiếu tới dài vừa phải (1,0–1,6 m). Trước lấy bằng cả bề ngang
  // buồng thang, mà bề ngang nay đo theo tường (gần 3 m) nên chiếu thò hẳn ra
  // ngoài sàn — đúng kiểu "mấy bậc tới cao trình bị dư".
  return { W: W, HT: HT, BAC: dai / nVe, nVe: nVe, soVe: soVe,
           r: HT / (nVe * soVe), dai: dai, ve: W / 2,
           cn: Math.max(1.0, Math.min(1.6, W * 0.5)) };
}


// Bề rộng vế thang lấy theo ĐÚNG hai bức tường đã vẽ hai bên: đo từ trục vế ra
// mỗi phía tới bức tường gần nhất chắn ngang, trừ nửa bề dày tường. Nhờ vậy bậc
// thang ăn sát tường như thang thật, mà không phải dựng thêm bức tường nào.
function rongThangTheoTuong(f, o) {
  const rongVe = Math.max(.8, o.w || 1.26);
  const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < .4) return rongVe;
  const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
  const nx = -uz, nz = ux;
  const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
  const tuong = tuyenTuong(f);
  const doBen = (dau) => {
    let gan = 4.0;                       // không tìm thấy thì giữ tối đa 4 m
    for (const w of tuong) {
      const wx = (w.x1 - w.x0) / w.L, wz = (w.z1 - w.z0) / w.L;
      const cheo = nx * wz - nz * wx;
      if (Math.abs(cheo) < 0.3) continue;            // tường song song hướng đo -> bỏ
      const t = ((w.x0 - cx) * wz - (w.z0 - cz) * wx) / (nx * wz - nz * wx);
      if (t * dau <= 0) continue;                    // nằm phía bên kia
      const px = cx + nx * t, pz = cz + nz * t;
      const tw = (px - w.x0) * wx + (pz - w.z0) * wz;
      if (tw < -.2 || tw > w.L + .2) continue;       // không cắt trong thân tường
      const d = Math.abs(t) - w.day / 2;
      if (d > .3 && d < gan) gan = d;
    }
    return gan;
  };
  const HE = 0.10;                        // chừa khe mỗi bên, không cho bậc chạm/xuyên tường
  const r = (doBen(1) - HE) + (doBen(-1) - HE);
  return Math.max(rongVe, Math.min(6, r));
}

function makeStairTower(veDai, rong, caoTong, chon) {
  const g = new THREE.Group();
  const vl = k => chon ? MAT_SEL : MAT_THANG[k];
  const ts = thongSoThang(veDai, rong, caoTong);
  const W = ts.W, HT = ts.HT, BAC = ts.BAC, nVe = ts.nVe, soVe = ts.soVe;
  const r = ts.r, dai = ts.dai, beVe = ts.ve;         // bề ngang mỗi vế = nửa ô

  const tayVin = (x0, x1, z, y0, y1) => {             // tay vịn nghiêng theo vế
    const L = Math.hypot(x1 - x0, y1 - y0);
    const th = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, L, 8), vl('vin'));
    th.position.set((x0 + x1) / 2, (y0 + y1) / 2 + .95, z);
    th.rotation.z = Math.PI / 2 - Math.atan2(y1 - y0, x1 - x0);
    g.add(th);
  };

  let y = 0, huong = 1;
  for (let v = 0; v < soVe; v++) {
    const z = huong > 0 ? -beVe / 2 : beVe / 2;       // hai vế kề nhau, kín bề ngang
    const xBatDau = huong > 0 ? -dai / 2 : dai / 2;
    const rongBac = beVe;                            // bậc phủ kín nửa buồng thang
    for (let i = 0; i < nVe; i++) {
      const x = xBatDau + huong * (i + .5) * BAC;
      const b = new THREE.Mesh(new THREE.BoxGeometry(BAC, r, rongBac), vl('bac'));
      b.position.set(x, y + r * (i + .5), z);
      g.add(b);
    }
    tayVin(xBatDau, xBatDau + huong * dai, z + huong * (beVe / 2 - .04), y, y + nVe * r);
    y += nVe * r;
    if (v < soVe - 1) {                               // chiếu nghỉ rộng bằng cả ô thang
      const cn = new THREE.Mesh(new THREE.BoxGeometry(ts.cn, .16, W), vl('ban'));
      cn.position.set(huong > 0 ? dai / 2 + ts.cn / 2 - .02 : -dai / 2 - ts.cn / 2 + .02,
                      y - .08, 0);
      g.add(cn);
    }
    huong = -huong;
  }
  // CHIẾU TỚI / CHIẾU ĐI: hai đầu thang có bản phẳng ngang đúng cao độ mặt sàn
  // của hai cao trình (mặt trên = 0 và = HT), để bước từ sàn sang thang là liền
  // mặt, không còn hụt một bậc rồi rơi vào khoảng trống.
  const ban = (x, mat) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(ts.cn, .16, W), vl('ban'));
    b.position.set(x, mat - .08, 0);
    g.add(b);
  };
  ban(-dai / 2 - ts.cn / 2 + .02, 0);                 // đầu dưới: khít sàn tầng dưới
  const huongCuoi = (soVe % 2) ? 1 : -1;              // chiều của vế cuối
  const xCuoi = huongCuoi > 0 ? dai / 2 : -dai / 2;
  ban(xCuoi + huongCuoi * (ts.cn / 2 - .02), HT);     // đầu trên: khít sàn tầng trên
  return g;
}

// ---- đèn quay báo động (đèn chớp xoay): đế nhựa trắng có gân, chụp đỏ trong
// suốt hình trụ khía dọc, đỉnh vòm, trong có bóng phát sáng.
const MAT_DEN = {
  de: new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: .6 }),
  gan: new THREE.MeshStandardMaterial({ color: 0xc9c9c2, roughness: .7 }),
  chup: new THREE.MeshStandardMaterial({ color: 0xe0231c, roughness: .18, metalness: .05,
    emissive: 0xb3140f, emissiveIntensity: .75, transparent: true, opacity: .82 }),
  bong: new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffd98a,
    emissiveIntensity: 1.6, roughness: .3 }),
};
function makeBeacon(cao, chon) {
  const g = new THREE.Group();
  const vl = k => chon ? MAT_SEL : MAT_DEN[k];
  const H = Math.max(.06, cao || .18);
  const R = H * .38;                              // Ø ~ 13 cm khi cao 18 cm
  const de = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.05, R * 1.12, H * .18, 24), vl('de'));
  de.position.y = H * .09; g.add(de);
  const gan = new THREE.Mesh(new THREE.CylinderGeometry(R * .98, R * .98, H * .07, 24), vl('gan'));
  gan.position.y = H * .21; g.add(gan);
  const bong = new THREE.Mesh(new THREE.SphereGeometry(R * .45, 14, 10), vl('bong'));
  bong.position.y = H * .5; g.add(bong);
  const chup = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H * .52, 28, 1, true), vl('chup'));
  chup.position.y = H * .51; g.add(chup);
  const vom = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 14, 0, Math.PI * 2, 0, Math.PI * .5), vl('chup'));
  vom.scale.y = .62; vom.position.y = H * .77; g.add(vom);
  for (let i = 0; i < 3; i++) {                   // gân ngang trên chụp
    const t = new THREE.Mesh(new THREE.TorusGeometry(R * 1.004, R * .035, 6, 28), vl('chup'));
    t.rotation.x = Math.PI / 2; t.position.y = H * (.33 + i * .17); g.add(t);
  }
  return g;
}

// ---- khối chóp cụt bát giác (bệ đỡ / móng máy): đáy bát giác lớn thu nhỏ dần
// lên mặt trên, giữa khoét lỗ tròn có vành bậc, bốn góc có bệ thép chôn.
function makeFrustum(D, H, tiLe, chon) {
  const g = new THREE.Group();
  const vl = k => chon ? MAT_SEL : MAT_TM[k];
  const R = Math.max(.5, D / 2);
  const h = Math.max(.15, H || 1.5);
  const rT = R * Math.min(.92, Math.max(.25, tiLe || .58));   // bán kính mặt trên
  const N = 8;
  const lech = Math.PI / N;                       // cạnh bát giác nằm ngang

  const than = new THREE.Mesh(new THREE.CylinderGeometry(rT, R, h, N), vl('be'));
  than.rotation.y = lech; than.position.y = h / 2;
  g.add(than);
  // mặt trên: vành khuyên quanh lỗ tròn giữa
  const rLo = rT * .52;
  const mat = new THREE.Mesh(new THREE.RingGeometry(rLo, rT, N, 1), vl('be2'));
  mat.rotation.x = -Math.PI / 2; mat.rotation.z = lech; mat.position.y = h + .003;
  g.add(mat);
  // vành bậc quanh lỗ (mấy vòng tròn đồng tâm trên bản vẽ)
  [[rLo * 1.00, .06], [rLo * .84, .12], [rLo * .70, .18]].forEach(([r, d], i) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h * d, 48, 1, true), vl('be2'));
    b.position.y = h - h * d / 2; g.add(b);
    const v = new THREE.Mesh(new THREE.TorusGeometry(r, R * .012, 8, 48), vl('thep'));
    v.rotation.x = Math.PI / 2; v.position.y = h - h * d + .002; g.add(v);
  });
  const dayLo = new THREE.Mesh(new THREE.CircleGeometry(rLo * .70, 48), vl('be2'));
  dayLo.rotation.x = -Math.PI / 2; dayLo.position.y = h * .78;
  g.add(dayLo);
  const beDen = new THREE.Mesh(new THREE.CylinderGeometry(rLo * .34, rLo * .40, h * .22, 24), vl('be'));
  beDen.position.y = h * .89;                      // bệ nhỏ đội đèn lên ngang mặt chóp
  g.add(beDen);
  // đèn quay báo động đặt giữa mặt trên
  const den = makeBeacon(.18 * state.explode, chon);
  den.scale.setScalar(Math.max(1, state.exitScale * .8));
  den.position.y = h + .002;        // đứng trên MẶT chóp, không thụt trong lỗ
  g.add(den);

  // bốn bệ thép chôn ở góc đáy
  for (let i = 0; i < 4; i++) {
    const a = (i + .5) * Math.PI / 2;
    const w = R * .16;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h * .12, w), vl('thep'));
    m.position.set(Math.cos(a) * R * .92, h * .06, Math.sin(a) * R * .92);
    m.rotation.y = -a;
    g.add(m);
  }
  return g;
}

const MAT_FM = {
  chai: new THREE.MeshStandardMaterial({ color: 0xc2231b, roughness: .42, metalness: .25 }),
  van: new THREE.MeshStandardMaterial({ color: 0xb98a3c, roughness: .35, metalness: .75 }),
  thep: new THREE.MeshStandardMaterial({ color: 0x8e99a4, roughness: .45, metalness: .6 }),
  nhan: new THREE.MeshStandardMaterial({ color: 0xf0efe6, roughness: .75 }),
};
function makeFM200(chon, cao) {
  const g = new THREE.Group();
  const vl = k => chon ? MAT_SEL : MAT_FM[k];
  const H = Math.max(.6, cao || 1.80);          // chiều cao chai (m) — FM-200 180 L
  const R = H * .185;                           // bán kính chai ~ 33 cm (Ø 0,66 m)
  const than = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H * .82, 24), vl('chai'));
  than.position.y = H * .06 + H * .41;
  g.add(than);
  const vaiTren = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), vl('chai'));
  vaiTren.position.y = H * .06 + H * .82;
  g.add(vaiTren);
  const day = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, H * .07, 24), vl('thep'));
  day.position.y = H * .035;
  g.add(day);
  // cổ + van + đồng hồ áp
  const co = new THREE.Mesh(new THREE.CylinderGeometry(R * .3, R * .34, H * .07, 14), vl('van'));
  co.position.y = H * .92;
  g.add(co);
  const van = new THREE.Mesh(new THREE.BoxGeometry(R * .9, H * .07, R * .8), vl('van'));
  van.position.y = H * .99;
  g.add(van);
  const dh = new THREE.Mesh(new THREE.CylinderGeometry(R * .28, R * .28, R * .12, 14), vl('thep'));
  dh.rotation.z = Math.PI / 2;
  dh.position.set(R * .62, H * .99, 0);
  g.add(dh);
  // ống xả mềm nối lên ống góp
  const ong = new THREE.Mesh(new THREE.CylinderGeometry(R * .16, R * .16, H * .22, 10), vl('thep'));
  ong.position.set(0, H * 1.08, -R * .3);
  ong.rotation.x = .35;
  g.add(ong);
  // đai ôm + giá đỡ phía sau
  [H * .34, H * .68].forEach(yy => {
    const dai = new THREE.Mesh(new THREE.TorusGeometry(R * 1.06, R * .07, 8, 24), vl('thep'));
    dai.rotation.x = Math.PI / 2;
    dai.position.y = yy;
    g.add(dai);
  });
  const gia = new THREE.Mesh(new THREE.BoxGeometry(R * 2.1, H * .06, R * .18), vl('thep'));
  gia.position.set(0, H * .68, -R * 1.2);
  g.add(gia);
  const nhan = new THREE.Mesh(new THREE.BoxGeometry(R * 1.1, H * .16, R * .04), vl('nhan'));
  nhan.position.set(0, H * .5, R * 1.005);
  g.add(nhan);
  return g;
}

const MAT_EMG = {
  than: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: .55, metalness: .03 }),
  choa: new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: .45 }),
  kinh: new THREE.MeshStandardMaterial({ color: 0xfaffff, roughness: .12, metalness: .1,
    emissive: 0xfff4d6, emissiveIntensity: .85, transparent: true, opacity: .92 }),
  bao: new THREE.MeshStandardMaterial({ color: 0x27d07a, emissive: 0x27d07a,
    emissiveIntensity: 1.4, roughness: .4 }),
  nhan: new THREE.MeshStandardMaterial({ color: 0x9fb6cc, roughness: .6 }),
};

const EMG_PHONG = 0.62 / 0.34;   // cho đèn sự cố to ngang biển EXIT

function makeEmergencyLight(chon) {
  const g = new THREE.Group();
  const vl = k => chon ? MAT_SEL : MAT_EMG[k];
  const W = 0.34, H = 0.15, D = 0.11;              // thân hộp 34 × 15 × 11 cm

  const than = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), vl('than'));
  than.position.y = H / 2;
  g.add(than);
  // vát mặt trên cho giống vỏ nhựa đúc
  const vat = new THREE.Mesh(new THREE.BoxGeometry(W * .98, H * .34, D * .78), vl('than'));
  vat.position.set(0, H * .92, -D * .06);
  g.add(vat);
  // đế bắt tường
  const de = new THREE.Mesh(new THREE.BoxGeometry(W * .9, H * .12, D * .25), vl('than'));
  de.position.set(0, H * .06, -D / 2 + D * .12);
  g.add(de);

  // hai chóa đèn tròn BẰNG NHAU, to gần hết chiều cao thân, chếch nhẹ ra hai bên
  const R = H * .52;                               // bán kính chóa ~ 7.8 cm
  const choa = (x, quay) => {
    const c = new THREE.Group();
    const than2 = new THREE.Mesh(new THREE.CylinderGeometry(R, R * .88, R * .62, 28), vl('choa'));
    than2.rotation.x = Math.PI / 2;
    c.add(than2);
    const vien = new THREE.Mesh(new THREE.TorusGeometry(R * .96, R * .09, 10, 30), vl('choa'));
    vien.position.z = R * .3;
    c.add(vien);
    // mặt kính khía như chóa pha
    const kinh = new THREE.Mesh(new THREE.SphereGeometry(R * .9, 28, 16,
      0, Math.PI * 2, 0, Math.PI * .4), vl('kinh'));
    kinh.rotation.x = Math.PI / 2;
    kinh.position.z = R * .28;
    c.add(kinh);
    for (let i = 1; i <= 3; i++) {                 // vòng khía trên mặt kính
      const kh = new THREE.Mesh(
        new THREE.TorusGeometry(R * .9 * i / 4, R * .022, 6, 26), vl('choa'));
      kh.position.z = R * (.3 + .06 * (1 - i / 4));
      c.add(kh);
    }
    c.position.set(x, H * .5, D * .34);
    c.rotation.order = 'YXZ';
    c.rotation.y = quay;                           // chếch nhẹ ra ngoài
    c.rotation.x = -0.05;
    g.add(c);
  };
  choa(W * .31, -0.22);                            // chóa phải
  choa(-W * .31, 0.22);                            // chóa trái

  // đèn báo sạc + nút thử + nhãn
  const bao = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), vl('bao'));
  bao.position.set(-W * .06, H * .16, D / 2 + 0.002);
  g.add(bao);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 10), vl('nhan'));
  nut.rotation.x = Math.PI / 2;
  nut.position.set(W * .06, H * .16, D / 2 + 0.003);
  g.add(nut);
  const nhan = new THREE.Mesh(new THREE.BoxGeometry(W * .17, H * .2, 0.004), vl('nhan'));
  nhan.position.set(0, H * .62, D / 2 + 0.002);   // nhãn hiệu ở giữa thân
  g.add(nhan);
  return g;
}

// ---- cửa đi: đơn (1 cánh) · đôi (2 cánh) · cuốn (cửa cuốn có trục cuốn trên lanh tô)
// Trục X của nhóm nằm DỌC theo ô cửa, gốc toạ độ ở giữa ô cửa, chân cửa ở y = 0.
const MAT_KHUON = new THREE.MeshStandardMaterial({ color: 0x8b6a3f, roughness: .8 });
const MAT_NAN = new THREE.MeshStandardMaterial({ color: 0xb8c2cc, roughness: .5, metalness: .6 });
function makeDoor(rong, cao, loai, lat, chon, caoTren, dayTuong) {
  const g = new THREE.Group();
  const mat = chon ? MAT_SEL : matDoor;
  const day = 0.06;
  if (caoTren > 0.05) {                       // mảng tường phía trên ô cửa
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(rong + 0.24, caoTren, Math.max(.12, dayTuong || .22)),
      chon ? MAT_SEL : matWallShared);
    m.position.set(0, cao + caoTren / 2, 0);
    g.add(m);
  }
  // khuôn cửa: hai đố đứng + đố ngang trên
  const doDung = (x) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, cao, 0.16), MAT_KHUON);
    m.position.set(x, cao / 2, 0); g.add(m);
  };
  doDung(-rong / 2); doDung(rong / 2);
  const tren = new THREE.Mesh(new THREE.BoxGeometry(rong + 0.12, 0.08, 0.16), MAT_KHUON);
  tren.position.set(0, cao + 0.04, 0); g.add(tren);

  if (loai === 'cuon') {
    // thân cửa cuốn: các nan ngang
    const nan = Math.max(6, Math.round(cao / 0.12));
    const caoNan = cao / nan;
    for (let i = 0; i < nan; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(rong - 0.04, caoNan * 0.82, 0.05), mat);
      m.position.set(0, caoNan * (i + 0.5), 0);
      g.add(m);
    }
    // trục cuốn nằm trên lanh tô
    const truc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, rong + 0.1, 14), MAT_NAN);
    truc.rotation.z = Math.PI / 2;
    truc.position.set(0, cao + 0.22, 0);
    g.add(truc);
    return g;
  }

  // cánh mở: quay quanh bản lề, mở 90° sang phía đã chọn
  const huong = lat ? -1 : 1;
  const canh = (xBanLe, rongCanh, chieu) => {
    const tam = new THREE.Group();
    tam.position.set(xBanLe, 0, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(rongCanh, cao, day), mat);
    m.position.set(chieu * rongCanh / 2, cao / 2, 0);
    tam.add(m);
    const tay = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), MAT_NAN);
    tay.position.set(chieu * (rongCanh - 0.09), cao * 0.47, day);
    tam.add(tay);
    // Cánh mở vuông góc 90° như trên bản vẽ mặt bằng.
    tam.rotation.y = huong * (Math.PI / 2) * chieu * -1;
    g.add(tam);
  };
  if (loai === 'doi') { canh(-rong / 2, rong / 2, 1); canh(rong / 2, rong / 2, -1); }
  else canh(-rong / 2, rong, 1);
  return g;
}

// ---- vẽ bằng chuột trên mặt sàn của cao trình đang chọn
const planeHelper = new THREE.Plane();
function pickOnFloor(ev) {
  const f = activeFloorObj();
  camera.updateMatrixWorld(true);
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  planeHelper.set(new THREE.Vector3(0, 1, 0), -(floorY(f) + 0.02));
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(planeHelper, hit)) return null;
  const snap = v => Math.round(v * 20) / 20;      // lưới 5 cm
  return snapPoint(f, snap(hit.x), snap(hit.z));
}

function hint(txt) {
  const h = $('#dhint');
  if (!txt) { h.style.display = 'none'; return; }
  h.style.display = 'block'; h.textContent = txt;
}

function canhBaoChan() {
  const v = +$('#dBase').value || 0;
  const e = $('#dBaseWarn');
  if (e) {
    e.style.display = v ? '' : 'none';
    e.textContent = '⚠ Đang vẽ ở cao độ chân +' + v + ' m — vật sẽ nằm lơ lửng trên sàn';
  }
  return v;
}

function showGhost(a, b) {
  if (ghost) { ghost.geometry.dispose(); customGroup.remove(ghost); ghost = null; }
  if (!a || !b) return;
  const f = a.f, y = floorY(f);
  const t = +$('#dThick').value || .22;
  const hb = +$('#dBoxH').value || 2;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffc14d, transparent: true, opacity: .5 });
  if (state.tool === 'wall') {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.max(.1, Math.hypot(dx, dz));
    ghost = new THREE.Mesh(new THREE.BoxGeometry(len, 2.5, t), mat);
    ghost.position.set((a.x + b.x) / 2, y + 1.25, (a.z + b.z) / 2);
    ghost.rotation.y = -Math.atan2(dz, dx);
    const ch = canhBaoChan();
    hint('Dài ' + len.toFixed(2) + ' m · dày ' + t + ' m' +
      (ch ? ' · CHÂN +' + ch + ' m' : '') + ' — bấm lần nữa để chốt');
  } else {
    const w = Math.max(.15, Math.abs(b.x - a.x)), d = Math.max(.15, Math.abs(b.z - a.z));
    const cua = state.tool === 'door';
    const chanMai = state.tool === 'roof'
      ? ((+$('#dBase').value || 0) || Math.max(0, floorHeight(f) - MASS.slab))
      : (+$('#dBase').value || 0);
    const nen = (state.tool === 'roof' || cua) ? y + chanMai * state.explode : y;
    const cao = cua ? (+$('#dDoorH').value || 2.1) * state.explode
      : state.tool === 'roof' ? Math.max(.2, (+$('#dRoofH').value || 0.2))
      : state.tool === 'tra' ? (+$('#dTraH').value || 3.2) * state.explode : hb;
    if (state.tool === 'chop') {                 // xem trước: chóp cụt bát giác
      const D = Math.max(1, Math.hypot(b.x - a.x, b.z - a.z));
      const hh = (+($('#dChopH') || {}).value || 1.5) * state.explode;
      const tl = Math.min(.92, Math.max(.25, +($('#dChopTop') || {}).value || .58));
      ghost = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 * tl, D / 2, hh, 8), mat);
      ghost.rotation.y = Math.PI / 8;
      ghost.position.set((a.x + b.x) / 2, y + hh / 2, (a.z + b.z) / 2);
      canhBaoChan();
      hint('Chóp cụt · đáy ' + D.toFixed(2) + ' m · mặt trên ' + (D * tl).toFixed(2) +
        ' m · cao ' + (($('#dChopH') || {}).value || 1.5) + ' m — bấm lần nữa để chốt');
      customGroup.add(ghost);
      return;
    }
    if (state.tool === 'toma') {                 // xem trước: hình trụ đúng đường kính
      const D = Math.max(1, Math.hypot(b.x - a.x, b.z - a.z));
      const sau = (+($('#dTomaH') || {}).value || 3) * state.explode;
      ghost = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, sau, 48), mat);
      ghost.position.set((a.x + b.x) / 2, y + sau / 2, (a.z + b.z) / 2);
      canhBaoChan();
      hint('Khối tổ máy · đường kính ' + D.toFixed(2) + ' m · cao ' +
        (($('#dTomaH') || {}).value || 3) + ' m — bấm lần nữa để chốt');
      customGroup.add(ghost);
      return;
    }
    if (cua) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const L = Math.max(.3, Math.hypot(dx, dz));
      ghost = new THREE.Mesh(new THREE.BoxGeometry(L, cao, .12), mat);
      ghost.rotation.y = -Math.atan2(dz, dx);
    } else {
      ghost = new THREE.Mesh(new THREE.BoxGeometry(w, cao, d), mat);
    }
    ghost.position.set((a.x + b.x) / 2, nen + cao / 2, (a.z + b.z) / 2);
    canhBaoChan();
    if (state.tool === 'door') {
      const rong = Math.hypot(b.x - a.x, b.z - a.z);
      const k = $('#dDoorKind').value;
      hint('Ô cửa rộng ' + rong.toFixed(2) + ' m · cao ' + ($('#dDoorH').value || 2.1) + ' m · ' +
        (k === 'doi' ? 'cửa đôi' : k === 'cuon' ? 'cửa cuốn' : 'cửa đơn') + ' — bấm lần nữa để chốt');
    } else if (state.tool === 'roof') {
      const dinh = +$('#dRoofH').value || 0;
      hint('Mái ' + w.toFixed(2) + ' × ' + d.toFixed(2) + ' m · ' +
        (dinh > 0 ? 'mái dốc BTCT, cao đỉnh ' + dinh + ' m' : 'mê bê tông (mái bằng)') +
        ' · chân +' + chanMai.toFixed(2) + ' m — bấm lần nữa để chốt');
    } else {
      hint(w.toFixed(2) + ' × ' + d.toFixed(2) + ' × cao ' +
        (state.tool === 'tra' ? ($('#dTraH').value || 3.2) : hb) + ' m — bấm lần nữa để chốt');
    }
  }
  customGroup.add(ghost);
}

// Bắt điểm: hút vào đầu/góc của tường đã có (bóc từ bản vẽ lẫn tự vẽ) trong bán kính 0,35 m.
const SNAP_R = 0.35;
function snapPoint(f, x, z) {
  let bx = x, bz = z, bd = SNAP_R;
  const thu = (px, pz) => {
    const d = Math.hypot(px - x, pz - z);
    if (d < bd) { bd = d; bx = px; bz = pz; }
  };
  for (const r of pickRects) {
    if (r.page !== f.page || r.key[0] !== 'w') continue;
    thu(r.x0, r.z0); thu(r.x1, r.z0); thu(r.x0, r.z1); thu(r.x1, r.z1);
    thu((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
  }
  for (const o of customOf(f.page)) {
    if (o.type === 'bin') continue;
    const [ax, az] = worldXZ(f, o.u0, o.v0), [cx, cz] = worldXZ(f, o.u1, o.v1);
    thu(ax, az); thu(cx, cz);
  }
  return { f: f, x: bx, z: bz, snapped: bd < SNAP_R };
}

// Khoá hướng vẽ về bội số 15°, ưu tiên tuyệt đối ngang/dọc -> tường luôn thẳng.
function axisSnap(a, b) {
  if (b.snapped) return b;                       // đã hút vào góc tường thì giữ nguyên
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return b;
  let ang = Math.atan2(dz, dx);
  const step = Math.PI / 12;                     // 15°
  const k = Math.round(ang / step);
  let sn = k * step;
  const vuong = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(ang - vuong) < 0.14) sn = vuong;  // trong ±8° thì ép hẳn về ngang/dọc
  // không làm tròn lưới ở đây: làm tròn sau khi xoay sẽ phá mất góc vừa khoá
  const L = Math.round(len * 20) / 20;
  return { f: b.f, x: a.x + Math.cos(sn) * L, z: a.z + Math.sin(sn) * L };
}

function setRay(ev) {
  camera.updateMatrixWorld(true);
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function designDown(ev) {
  if (state.mode !== 'design' || ev.button !== 0) return;
  if (state.tool === 'sel') {                 // chọn: tường/khối bóc từ bản vẽ lẫn tự vẽ
    setRay(ev);
    const shown = m => {            // chỉ bắt đối tượng của cao trình đang hiện
      let o = m;
      while (o) { if (o.visible === false) return false; o = o.parent; }
      return true;
    };
    const targets = customMeshes.filter(shown)
      .concat(exitMeshes.filter(m => m.visible && shown(m)))
      .concat(markers.filter(m => m.visible && shown(m)))
      .concat(pickables.filter(shown));
    // bắn cả chùm tia quanh điểm bấm: tường chỉ dày 0,19 m nên một tia rất dễ trượt.
    // Bình chữa cháy và vật tự vẽ được ưu tiên hơn tường/tủ vì chúng nhỏ và hay bị tường che.
    let nho = null, to = null;
    for (const [ox, oz] of [[0, 0], [-7, 0], [7, 0], [0, -7], [0, 7], [-7, -7], [7, 7], [-7, 7], [7, -7]]) {
      setRay({ clientX: ev.clientX + ox, clientY: ev.clientY + oz });
      for (const hit of raycaster.intersectObjects(targets, true)) {
        let o = hit.object;
        if (o.userData.meta && hit.instanceId !== undefined && hit.instanceId !== null) {
          const k = o.userData.meta[hit.instanceId];
          if (k && (!to || hit.distance < to.d)) to = { k: k, o: o, i: hit.instanceId, d: hit.distance };
          continue;
        }
        while (o && !o.userData.obj && !o.userData.item && !o.userData.exit) o = o.parent;
        if (!o) continue;
        const k = o.userData.exit ? 'x:' + o.userData.exit.floor + ':' + o.userData.exit.id
          : o.userData.item ? 'm:' + o.userData.item.floor + ':' + o.userData.item.id
            : 'c:' + o.userData.obj.id;
        if (!nho || hit.distance < nho.d) nho = { k: k, o: o, d: hit.distance };
      }
      if (nho) {
        selectKey(nho.k, nho.o);
        if (nho.k.slice(0, 2) === 'c:') startMove(ev, nho.k.slice(2));
        else if (nho.k.slice(0, 2) === 'x:') startMoveExit(ev, nho.k);
        else if (nho.k.slice(0, 2) === 'm:') startMoveItem(ev, nho.k);
        return;
      }
    }
    if (to) { selectKey(to.k, to.o, to.i); return; }
    // vẫn trượt: chiếu điểm bấm xuống mặt sàn rồi bắt khối gần nhất theo hình chiếu bằng
    const p2 = pickOnFloor(ev);
    if (!p2) { selectKey(null); return; }
    let best = null, bd = 1e9;
    for (const m of customMeshes) {
      const d = Math.hypot(m.position.x - p2.x, m.position.z - p2.z);
      if (d < bd && d < 2.5) { bd = d; best = { c: 'c:' + m.userData.obj.id }; }
    }
    for (const m of exitMeshes) {
      if (!m.visible) continue;
      const d = Math.hypot(m.position.x - p2.x, m.position.z - p2.z);
      if (d < bd && d < 1.5) { bd = d; best = { c: 'x:' + m.userData.exit.floor + ':' + m.userData.exit.id, mk: m }; }
    }
    for (const m of markers) {
      if (!m.visible) continue;
      const d = Math.hypot(m.position.x - p2.x, m.position.z - p2.z);
      if (d < bd && d < 1.2) { bd = d; best = { c: 'm:' + m.userData.item.floor + ':' + m.userData.item.id, mk: m }; }
    }
    for (const r of pickRects) {
      if (!state.visible.has(r.page)) continue;
      const dx = Math.max(r.x0 - p2.x, 0, p2.x - r.x1);
      const dz = Math.max(r.z0 - p2.z, 0, p2.z - r.z1);
      const d = Math.hypot(dx, dz);
      if (d < bd && d < 1.2) { bd = d; best = r; }
    }
    if (!best) { selectKey(null); return; }
    if (best.c) selectKey(best.c, best.mk); else selectKey(best.key, best.obj, best.idx);
    return;
  }
  const p = pickOnFloor(ev);
  if (!p) return;
  if (!state.visible.has(p.f.page)) {        // đang vẽ lên một cao trình đang bị ẩn
    hint('Cao trình đang vẽ (' + p.f.name + ') đang bị ẩn — bấm tên nó ở tab Xem trước đã');
    setTimeout(() => hint(''), 3500);
    return;
  }
  if (state.tool === 'emg') {
    const uv = baseFromWorld(p.f, p.x, p.z);
    const n = customOf(p.f.page).filter(o => o.type === 'emg').length + 1;
    addObj(p.f, { type: 'emg', u0: uv[0], v0: uv[1], u1: uv[0], v1: uv[1],
                  h: 2.6, base: 0, name: 'Đèn sự cố ' + n });
    return;
  }
  if (state.tool === 'exit') {
    const uv = baseFromWorld(p.f, p.x, p.z);
    const n = customOf(p.f.page).filter(o => o.type === 'exit').length + 1;
    addObj(p.f, { type: 'exit', u0: uv[0], v0: uv[1], u1: uv[0], v1: uv[1],
                  h: EXIT_H, name: 'Đèn EXIT thêm ' + n });
    return;
  }
  if (state.tool === 'san' && !($('#dSanTay') || {}).checked) {
    sanTheoTuong(p.f, p.x, p.z);              // bấm trong phòng -> sàn ăn tới bờ tường
    return;
  }
  if (state.tool === 'gopmep') {                 // bấm hai tấm sàn để gộp mép
    gopMepSan(p.f, p.x, p.z);
    return;
  }
  if (state.tool === 'lo' || state.tool === 'san' || state.tool === 'catsan') {
    if (!dg.on) { dg.on = true; dg.f = p.f; dg.pts = []; controls.enabled = false; }
    const d0 = dg.pts.length ? Math.hypot(p.x - dg.pts[0][0], p.z - dg.pts[0][1]) : 9;
    if (dg.pts.length >= 3 && d0 < .8) { dgChot(); return; }
    dg.pts.push([p.x, p.z]); dg.tam = null; dgVe();
    hint('Đã có ' + dg.pts.length + ' điểm — bấm tiếp theo con trỏ; bấm lại vào điểm đầu' +
         ' (hoặc Enter) để khép kín, Backspace bỏ điểm cuối, Esc huỷ');
    return;
  }
  if (state.tool === 'nutbao') {
    const uv = baseFromWorld(p.f, p.x, p.z);
    const n = customOf(p.f.page).filter(o => o.type === 'nutbao').length + 1;
    addObj(p.f, { type: 'nutbao', u0: uv[0], v0: uv[1], u1: uv[0], v1: uv[1],
                  h: 1.4, base: 0, name: 'Nút ấn báo cháy ' + n });
    return;
  }
  if (state.tool === 'hong') {
    const uv = baseFromWorld(p.f, p.x, p.z);
    const n = customOf(p.f.page).filter(o => o.type === 'hong').length + 1;
    addObj(p.f, { type: 'hong', u0: uv[0], v0: uv[1], u1: uv[0], v1: uv[1],
                  h: 0, base: 0, name: 'Họng nước vách tường ' + n });
    return;
  }
  if (state.tool === 'beacon') {
    const uv = baseFromWorld(p.f, p.x, p.z);
    const n = customOf(p.f.page).filter(o => o.type === 'beacon').length + 1;
    addObj(p.f, { type: 'beacon', u0: uv[0], v0: uv[1], u1: uv[0], v1: uv[1],
                  h: 0.18, base: +$('#dBase').value || 0, name: 'Đèn quay báo động ' + n });
    return;
  }
  if (state.tool === 'fm200') {
    const uv = baseFromWorld(p.f, p.x, p.z);
    const n = customOf(p.f.page).filter(o => o.type === 'fm200').length + 1;
    addObj(p.f, { type: 'fm200', u0: uv[0], v0: uv[1], u1: uv[0], v1: uv[1],
                  h: +($('#dFmH') || {}).value || 1.80, name: 'Bình FM200 ' + n });
    return;
  }
  if (state.tool === 'bin') {
    const uv = baseFromWorld(p.f, p.x, p.z);
    const loai = (($('#dBinhLoai') || {}).value) || 'ABC8';
    if (loai === 'FM200') {                     // FM-200 la khoi binh lon rieng
      const n = customOf(p.f.page).filter(o => o.type === 'fm200').length + 1;
      addObj(p.f, { type: 'fm200', u0: uv[0], v0: uv[1], u1: uv[0], v1: uv[1],
                    h: +($('#dFmH') || {}).value || 1.80, name: 'Bình FM200 ' + n });
      return;
    }
    const n = customOf(p.f.page).filter(o => o.type === 'bin').length + 1;
    addObj(p.f, { type: 'bin', binh: loai, u0: uv[0], v0: uv[1], u1: uv[0], v1: uv[1],
                  h: 0, name: TEN_BINH[loai] + ' ' + n });
    return;
  }
  if (state.tool === 'cong') {              // tường cong: bấm từng mốc, máy tự bo cong
    if (!veTay.on) { veTay.on = true; veTay.f = p.f; veTay.pts = []; controls.enabled = false; }
    const d0 = veTay.pts.length ? Math.hypot(p.x - veTay.pts[0][0], p.z - veTay.pts[0][1]) : 9;
    if (veTay.pts.length >= 3 && d0 < .8) { veTayChot(true); return; }   // bấm lại mốc đầu -> khép kín
    veTay.pts.push([p.x, p.z]); veTay.tam = null; veTayVe();
    hint('Đã có ' + veTay.pts.length + ' mốc — bấm tiếp trên đường cong; Enter để kết thúc,' +
         ' bấm lại mốc đầu để khép kín, Backspace bỏ mốc cuối, Esc huỷ');
    return;
  }
  if (ev.target !== renderer.domElement) return;
  if (drag.on) { chotVe(); return; }        // đang vẽ dở -> bấm lần hai là chốt
  drag.on = true; drag.a = p; drag.b = p; drag.id = ev.pointerId;
  drag.px = ev.clientX; drag.py = ev.clientY;
  controls.enabled = false;
  hint('Rê chuột tới vị trí muốn đặt rồi bấm lần nữa để chốt (Esc để huỷ)');
}

// ---- di chuyển đối tượng tự vẽ bằng cách kéo chuột
const mv = { on: false, id: null, obj: null, x0: 0, z0: 0, goc: null, den: null, binh: null };
function startMove(ev, id) {
  const o = selectedObj(); if (!o) return;
  const p = pickOnFloor(ev); if (!p) return;
  chup();
  mv.on = true; mv.id = ev.pointerId; mv.obj = o; mv.x0 = p.x; mv.z0 = p.z;
  mv.goc = { u0: o.u0, v0: o.v0, u1: o.u1, v1: o.v1,
             pts: o.pts ? o.pts.map(q => [q[0], q[1]]) : null };
  controls.enabled = false;
  hint('Kéo để di chuyển — thả chuột để chốt');
}

// Dời đèn EXIT bóc từ bản vẽ: vị trí mới ghi đè vào edits, bản gốc không đổi.
function startMoveExit(ev, key) {
  const p = pickOnFloor(ev); if (!p) return;
  const pr = key.split(':'), page = +pr[1], id = pr.slice(2).join(':');
  const it = ((state.exitData && state.exitData.items) || []).find(x => x.id === id);
  if (!it) return;
  const ed = editsOf(page), cu = ed.movExit[id] || [it.bx, it.by];
  chup();
  mv.on = true; mv.id = ev.pointerId; mv.obj = null; mv.x0 = p.x; mv.z0 = p.z;
  mv.den = { page: page, id: id, goc: [cu[0], cu[1]] };
  controls.enabled = false;
  hint('Kéo để dời đèn EXIT — thả chuột để chốt');
}

// Dời bình chữa cháy bóc từ bản vẽ: y hệt đèn EXIT, ghi vào edits, gốc không đổi.
function startMoveItem(ev, key) {
  const p = pickOnFloor(ev); if (!p) return;
  const pr = key.split(':'), page = +pr[1], id = pr.slice(2).join(':');
  const it = (state.data.items || []).find(x => x.id === id && floorOf(x.floor).page === page);
  if (!it) return;
  const ed = editsOf(page), cu = ed.movItem[id] || [it.bx, it.by];
  chup();
  mv.on = true; mv.id = ev.pointerId; mv.obj = null; mv.x0 = p.x; mv.z0 = p.z;
  mv.binh = { page: page, id: id, goc: [cu[0], cu[1]] };
  controls.enabled = false;
  hint('Kéo để dời bình chữa cháy — thả chuột để chốt');
}

function doMove(ev) {
  if (mv.binh) {
    const f = floorOf(mv.binh.page);
    const p = pickOnFloor(ev); if (!p) return;
    const a = baseFromWorld(f, mv.x0, mv.z0), b = baseFromWorld(f, p.x, p.z);
    const ed = editsOf(mv.binh.page);
    ed.movItem[mv.binh.id] = [round2(mv.binh.goc[0] + b[0] - a[0]),
                              round2(mv.binh.goc[1] + b[1] - a[1])];
    const mk = markers.find(m => m.userData.item && m.userData.item.id === mv.binh.id);
    if (mk) {
      const q = ed.movItem[mv.binh.id];
      const [nx, nz] = worldXZ(f, q[0], q[1]);
      mk.position.x = nx; mk.position.z = nz;
    }
    return;
  }
  if (mv.den) {
    const f = floorOf(mv.den.page);
    const p = pickOnFloor(ev); if (!p) return;
    const a = baseFromWorld(f, mv.x0, mv.z0), b = baseFromWorld(f, p.x, p.z);
    const ed = editsOf(mv.den.page);
    ed.movExit[mv.den.id] = [round2(mv.den.goc[0] + b[0] - a[0]),
                             round2(mv.den.goc[1] + b[1] - a[1])];
    buildExits();
    return;
  }
  const f = activeFloorObj();
  const p = pickOnFloor(ev); if (!p) return;
  const a = baseFromWorld(f, mv.x0, mv.z0), b = baseFromWorld(f, p.x, p.z);
  const du = b[0] - a[0], dv = b[1] - a[1];
  const o = mv.obj, g = mv.goc;
  o.u0 = g.u0 + du; o.v0 = g.v0 + dv; o.u1 = g.u1 + du; o.v1 = g.v1 + dv;
  if (g.pts) o.pts = g.pts.map(q => [q[0] + du, q[1] + dv]);
  rebuildCustom();
  if (o.type === 'lo' || o.type === 'san') rebuildMasses();
}

function round2(v) { return Math.round(v * 100) / 100; }

function rotateSel(deg) {
  const o = selectedObj(); if (!o) return;
  chup();
  const f = activeFloorObj();
  const a = Math.PI * deg / 180;
  if (o.type === 'box' || o.type === 'tra') { o.rot = (o.rot || 0) + a; }
  else {                                     // tường / lan can / cầu thang: quay quanh tâm
    const [ax, az] = worldXZ(f, o.u0, o.v0), [bx, bz] = worldXZ(f, o.u1, o.v1);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, c = Math.cos(a), sn = Math.sin(a);
    const q = (x, z) => [cx + (x - cx) * c - (z - cz) * sn, cz + (x - cx) * sn + (z - cz) * c];
    const p0 = baseFromWorld(f, ...q(ax, az)), p1 = baseFromWorld(f, ...q(bx, bz));
    o.u0 = p0[0]; o.v0 = p0[1]; o.u1 = p1[0]; o.v1 = p1[1];
  }
  saveCustom(); rebuildCustom(); renderEditPanel();
}


// ---- vẽ ĐA GIÁC tự do (lỗ thông tầng): bấm từng điểm theo con trỏ, bấm lại vào
// điểm đầu (hoặc Enter / bấm đúp) để khép kín, Esc để huỷ, Backspace bỏ điểm cuối.
const dg = { on: false, f: null, pts: [], tam: null };
let dgGhost = null;
function dgVe() {
  if (dgGhost) { customGroup.remove(dgGhost); dgGhost = null; }
  if (!dg.on || !dg.pts.length) return;
  dgGhost = new THREE.Group();
  const y = floorY(dg.f) + .08;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd479 });
  const ds = dg.tam ? dg.pts.concat([dg.tam]) : dg.pts.slice();
  for (let i = 0; i < ds.length; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(i === 0 ? .26 : .18, 10, 8), mat);
    c.position.set(ds[i][0], y, ds[i][1]);
    dgGhost.add(c);
    const p1 = ds[(i + 1) % ds.length];
    if (ds.length < 2) break;
    if (i === ds.length - 1 && ds.length < 3) break;
    const L = Math.hypot(p1[0] - ds[i][0], p1[1] - ds[i][1]);
    if (L < .02) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, .1, .14), mat);
    m.position.set((ds[i][0] + p1[0]) / 2, y, (ds[i][1] + p1[1]) / 2);
    m.rotation.y = -Math.atan2(p1[1] - ds[i][1], p1[0] - ds[i][0]);
    dgGhost.add(m);
  }
  customGroup.add(dgGhost);
}
function dgHuy() {
  dg.on = false; dg.pts = []; dg.tam = null; dg.f = null;
  controls.enabled = true; dgVe(); hint('');
}
function dgChot() {
  if (!dg.on || dg.pts.length < 3) { dgHuy(); return; }
  const f = dg.f;
  if (state.tool === 'catsan') {                 // khoanh vùng nào thì cắt bỏ sàn ở đó
    const xs = dg.pts.map(p => p[0]), zs = dg.pts.map(p => p[1]);
    catSan(f, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
    dgHuy();
    return;
  }
  const laSan = state.tool === 'san';
  const uv = dg.pts.map(p => baseFromWorld(f, p[0], p[1]));
  const xs = uv.map(q => q[0]), ys = uv.map(q => q[1]);
  const n = customOf(f.page).length + 1;
  addObj(f, { type: laSan ? 'san' : 'lo', pts: uv.map(q => [round2(q[0]), round2(q[1])]),
    u0: Math.min(...xs), v0: Math.min(...ys), u1: Math.max(...xs), v1: Math.max(...ys),
    tang: laSan ? 1 : (+($('#dLoTang') || {}).value || 1), h: 0, base: 0,
    name: (laSan ? 'Tấm sàn ' : 'Lỗ thông tầng ') + n + ' (' + uv.length + ' cạnh)' });
  dgHuy();
}

function designMove(ev) {
  if (state.mode !== 'design') return;
  if (mv.on) { doMove(ev); return; }
  if (veTay.on) { const q = pickOnFloor(ev); if (q) { veTay.tam = [q.x, q.z]; veTayVe(); } return; }
  if (dg.on) { const q = pickOnFloor(ev); if (q) { dg.tam = [q.x, q.z]; dgVe(); } return; }
  if (!drag.on) return;                     // bóng xem trước bám con trỏ dù không giữ chuột
  let p = pickOnFloor(ev);
  if (!p) return;
  if (state.tool === 'wall' || state.tool === 'door') p = axisSnap(drag.a, p);
  drag.b = p;
  showGhost(drag.a, drag.b);
}

function designUp(ev) {
  if (state.mode !== 'design') return;
  if (mv.on) {
    const laDen = !!mv.den, laBinh = !!mv.binh;
    mv.on = false; mv.obj = null; mv.den = null; mv.binh = null; controls.enabled = true;
    if (laBinh) { saveEdits(); banDoiChua(true); }
    else if (laDen) { saveEdits(); buildExits(); }
    else { saveCustom(); rebuildCustom(); }
    hint('');
    return;
  }
  if (!drag.on) return;
  if (ev && drag.id !== null && ev.pointerId !== undefined && ev.pointerId !== drag.id) return;
  // Nhả chuột ngay tại chỗ vừa bấm = người dùng đang dùng kiểu HAI LẦN BẤM -> chưa chốt vội.
  if (ev && Math.hypot(ev.clientX - drag.px, ev.clientY - drag.py) < 8) return;
  chotVe();
}

// ---------------------------------------------------------------------------
// TUONG CONG — bam tung DIEM MOC, duong cong tu chay muot qua cac moc do.
// Nha PK cua Ialy mat bang hinh tron nen tuong bao khong ghep bang doan thang
// duoc; con re chuot thi tay khong bao gio ra duong tron deu. Nen: bam vai
// diem tren duong muon ve, may noi chung lai bang duong cong Catmull-Rom roi
// chia thanh cac DOAN TUONG THANG ngan (~0,5 m).
//
// Vi ket qua van la tuong thuong nen dung tuong khi di bo, treo binh len tuong,
// khoet o cua, net tuong tren mat bang 2D deu chay dung ngay. Cac doan mang
// chung mot ma nhom nen xoa mot doan la di ca tuyen.
const veTay = { on: false, f: null, pts: [], tam: null };
let veTayGhost = null;

// Cac moc co cung nam tren MOT DUONG TRON khong? Tra ve {x, z, r} neu co.
// Nha tron nhu nha PK chi can bam vai moc tren tuong bao, con lai de may lo.
function vongTronQua(pts) {
  const n = pts.length;
  if (n < 3) return null;
  // khop tam bang binh phuong toi thieu: tam cach deu moi moc nhat
  let sx = 0, sz = 0;
  for (const q of pts) { sx += q[0]; sz += q[1]; }
  let cx = sx / n, cz = sz / n;
  for (let lap = 0; lap < 60; lap++) {        // Landau: lap la hoi tu rat nhanh
    let mx = 0, mz = 0, mr = 0;
    for (const q of pts) {
      const dx = q[0] - cx, dz = q[1] - cz, d = Math.hypot(dx, dz);
      if (d < 1e-9) return null;
      mr += d; mx += dx / d; mz += dz / d;
    }
    mr /= n;
    const nx = sx / n - mr * (mx / n), nz = sz / n - mr * (mz / n);
    if (Math.hypot(nx - cx, nz - cz) < 1e-7) { cx = nx; cz = nz; break; }
    cx = nx; cz = nz;
  }
  let r = 0;
  for (const q of pts) r += Math.hypot(q[0] - cx, q[1] - cz);
  r /= n;
  if (r < .3) return null;
  for (const q of pts)                        // lech qua 3% thi khong phai vong tron
    if (Math.abs(Math.hypot(q[0] - cx, q[1] - cz) - r) / r > .03) return null;
  return { x: cx, z: cz, r };
}

// Duong cong muot di qua het cac moc.
function duongCong(pts, kin) {
  if (pts.length < 2) return pts.slice();
  if (pts.length === 2 && !kin) return pts.slice();
  // Cac moc nam tren mot vong tron -> ve dung vong tron do. Duong Catmull-Rom
  // qua 4 moc cua mot vong tron bi vong vao trong hon 10%, nha tron se meo.
  if (kin) {
    const v = vongTronQua(pts);
    if (v) {
      const n = Math.max(24, Math.min(400, Math.round(2 * Math.PI * v.r / 0.5)));
      const g0 = Math.atan2(pts[0][1] - v.z, pts[0][0] - v.x);
      // giu dung chieu nguoi dung bam
      const g1 = Math.atan2(pts[1][1] - v.z, pts[1][0] - v.x);
      let d = g1 - g0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const chieu = d >= 0 ? 1 : -1;
      const ra = [];
      for (let i = 0; i <= n; i++) {
        const g = g0 + chieu * 2 * Math.PI * i / n;
        ra.push([v.x + v.r * Math.cos(g), v.z + v.r * Math.sin(g)]);
      }
      return ra;
    }
  }
  const v = pts.map(q => new THREE.Vector3(q[0], 0, q[1]));
  const c = new THREE.CatmullRomCurve3(v, !!kin, 'centripetal');
  const n = Math.max(8, Math.min(400, Math.round(c.getLength() / 0.5)));
  return c.getPoints(n).map(q => [q.x, q.z]);
}

function veTayVe() {
  if (veTayGhost) { customGroup.remove(veTayGhost); veTayGhost = null; }
  if (!veTay.on || !veTay.pts.length) return;
  veTayGhost = new THREE.Group();
  const y = floorY(veTay.f) + .08;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffc14d });
  const matMoc = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const t = +$('#dThick').value || .22;
  const ds = veTay.tam ? veTay.pts.concat([veTay.tam]) : veTay.pts;
  const duong = duongCong(ds, false);
  for (let i = 0; i < duong.length - 1; i++) {
    const a = duong[i], b = duong[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < .01) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, .12, t), mat);
    m.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
    m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    veTayGhost.add(m);
  }
  veTay.pts.forEach((q, i) => {                  // moc da bam
    const c = new THREE.Mesh(new THREE.SphereGeometry(i === 0 ? .34 : .24, 10, 8), matMoc);
    c.position.set(q[0], y, q[1]);
    veTayGhost.add(c);
  });
  customGroup.add(veTayGhost);
}

function veTayHuy() {
  veTay.on = false; veTay.pts = []; veTay.tam = null;
  if (veTayGhost) { customGroup.remove(veTayGhost); veTayGhost = null; }
  controls.enabled = true; hint('');
}

function veTayChot(kin) {
  const f = veTay.f, moc = veTay.pts.slice();
  veTayHuy();
  if (!f || moc.length < 2) return;
  const duong = duongCong(moc, kin);
  if (duong.length < 2) return;

  const t = +$('#dThick').value || .22, h = +$('#dWallH').value || 0;
  const base = +$('#dBase').value || 0;
  const stt = customOf(f.page).length + 1;
  const nhom = 'N' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const n = duong.length - 1;
  chup();
  for (let i = 0; i < n; i++) {
    const a = baseFromWorld(f, duong[i][0], duong[i][1]);
    const b = baseFromWorld(f, duong[i + 1][0], duong[i + 1][1]);
    customOf(f.page).push({
      type: 'wall', nhom,
      id: 'C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + i,
      u0: a[0], v0: a[1], u1: b[0], v1: b[1], t, h, base,
      name: 'Tường cong ' + stt + ' (' + (i + 1) + '/' + n + ')',
    });
  }
  saveCustom(); rebuildCustom();
  hint('Đã vẽ tường cong ' + n + ' đoạn qua ' + moc.length + ' mốc' +
       (kin ? ' (khép kín)' : ''));
  setTimeout(() => hint(''), 2000);
}

function huyVe() {
  drag.on = false; drag.id = null; drag.a = null; drag.b = null;
  controls.enabled = true; showGhost(null, null); hint('');
}

function chotVe() {
  drag.on = false; drag.id = null; controls.enabled = true;
  showGhost(null, null); hint('');
  const a = drag.a, b = drag.b;
  if (!a || !b) { drag.a = drag.b = null; return; }
  if (Math.hypot(b.x - a.x, b.z - a.z) < .25) { drag.a = drag.b = null; return; }
  const f = a.f;
  const p0 = baseFromWorld(f, a.x, a.z), p1 = baseFromWorld(f, b.x, b.z);
  const n = customOf(f.page).length + 1;
  const common = { u0: p0[0], v0: p0[1], u1: p1[0], v1: p1[1] };
  if (state.tool === 'wall') {
    addObj(f, Object.assign({ type: 'wall', t: +$('#dThick').value || .22,
      h: +$('#dWallH').value || 0, base: +$('#dBase').value || 0,
      name: 'Tường ' + n + ((+$('#dBase').value) ? ' (cao độ +' + $('#dBase').value + ')' : '') }, common));
  } else if (state.tool === 'box') {
    addObj(f, Object.assign({ type: 'box', h: +$('#dBoxH').value || 2,
      base: +$('#dBase').value || 0, name: 'Khối thiết bị ' + n }, common));
  } else if (state.tool === 'tra') {
    addObj(f, Object.assign({ type: 'tra', h: +$('#dTraH').value || 3.2,
      base: +$('#dBase').value || 0, name: 'Máy biến áp ' + n }, common));
  } else if (state.tool === 'rail') {
    addObj(f, Object.assign({ type: 'rail', h: +$('#dRailH').value || 1.1,
      base: +$('#dBase').value || 0, name: 'Lan can ' + n }, common));
  } else if (state.tool === 'roof') {
    // Mái phải nằm TRÊN ĐỈNH TƯỜNG. Nếu người dùng chưa tự đặt cao độ chân thì
    // lấy luôn chiều cao tường của cao trình đang vẽ (hoặc tường tự vẽ cao nhất
    // nằm trong khung mái, nếu có).
    let chan = +$('#dBase').value || 0;
    if (!chan) {
      const x0 = Math.min(p0[0], p1[0]), x1 = Math.max(p0[0], p1[0]);
      const y0 = Math.min(p0[1], p1[1]), y1 = Math.max(p0[1], p1[1]);
      const dinhTuong = [];
      for (const c of customOf(f.page)) {                   // tường tự vẽ nằm trong khung mái
        if (c.type !== 'wall') continue;
        const cx = (c.u0 + c.u1) / 2, cy = (c.v0 + c.v1) / 2;
        if (cx < x0 - 12 || cx > x1 + 12 || cy < y0 - 12 || cy > y1 + 12) continue;
        dinhTuong.push(c.h > 0 ? (c.base || 0) + c.h
                               : Math.max(0, floorHeight(f) - MASS.slab));
      }
      // có tường thì gác lên đỉnh bức cao nhất; không có thì lấy chiều cao tầng
      chan = dinhTuong.length ? Math.max(...dinhTuong)
                              : Math.max(0, floorHeight(f) - MASS.slab);
      $('#dBase').value = +chan.toFixed(2);
      hint('Mái đặt lên đỉnh tường, cao độ chân +' + chan.toFixed(2) + ' m (sửa ở ô Cao độ chân)');
      setTimeout(() => hint(''), 3500);
    }
    addObj(f, Object.assign({ type: 'roof', h: +$('#dRoofH').value || 0,
      base: chan,
      name: ((+$('#dRoofH').value || 0) > 0 ? 'Mái dốc BTCT ' : 'Mê bê tông ') + n +
            ' (+' + chan.toFixed(1) + ')' }, common));
  } else if (state.tool === 'door') {
    addObj(f, Object.assign({ type: 'door', h: +$('#dDoorH').value || 2.1,
      kind: $('#dDoorKind').value || 'don', flip: $('#dFlip').value === '1',
      base: +$('#dBase').value || 0, name: 'Cửa ' + n }, common));
  } else if (state.tool === 'chop') {
    addObj(f, Object.assign({ type: 'chop', h: +($('#dChopH') || {}).value || 1.5,
      top: +($('#dChopTop') || {}).value || .58,
      base: +$('#dBase').value || 0, name: 'Chóp cụt bát giác ' + n }, common));
  } else if (state.tool === 'toma') {
    addObj(f, Object.assign({ type: 'toma', h: +($('#dTomaH') || {}).value || 3,
      base: +$('#dBase').value || 0, name: 'Khối tổ máy ' + n }, common));

  } else if (state.tool === 'thangmay') {
    // mốc dừng = các cao trình nằm trên cao trình đang vẽ
    const moc = (state.data.floors || []).filter(x => x.elevation >= f.elevation && x.elevation < 500)
      .map(x => +(x.elevation - f.elevation).toFixed(2)).sort((a, b) => a - b);
    addObj(f, Object.assign({ type: 'thangmay',
      h: +($('#dTmayH') || {}).value || 10, moc: moc, base: 0,
      name: 'Thang máy ' + n }, common));
  } else if (state.tool === 'thangbo') {
    addObj(f, Object.assign({ type: 'thangbo', w: +$('#dStairW').value || 1.26,
      h: +($('#dThangH') || {}).value || Math.max(1, floorHeight(f)),
      base: +$('#dBase').value || 0, name: 'Cầu thang bộ ' + n }, common));
  } else if (state.tool === 'stair') {
    addObj(f, Object.assign({ type: 'stair', h: +$('#dWallH').value || 0,
      w: +$('#dStairW').value || 1.2, name: 'Cầu thang ' + n }, common));
  }
  drag.a = null; drag.b = null;
}

function setTool(t) {
  if (typeof gm !== 'undefined') gm.a = null;
  if (typeof dg !== 'undefined' && dg.on) dgHuy();
  if (typeof veTay !== 'undefined' && veTay.on) veTayHuy();
  if (drag.on) huyVe();
  if (typeof canhBaoChan === 'function') canhBaoChan();
  state.tool = t;
  document.querySelectorAll('.tool').forEach(e => e.classList.toggle('on', e.dataset.tool === t));
  hint(t === 'emg' ? 'Bấm lên mặt sàn để đặt đèn chiếu sáng sự cố — đèn tự áp vào tường, cao 2,6 m'
    : t === 'exit' ? 'Bấm lên mặt sàn để đặt đèn EXIT — đèn tự áp vào tường gần nhất'
    : t === 'door' ? 'Vẽ bề rộng ô cửa DỌC THEO tường: bấm mép này, rê sang mép kia, bấm chốt'
    : t === 'roof' ? 'Đổ mê bê tông: kéo khung mái: bấm một góc, rê tới góc đối diện, bấm lần nữa. Sống mái chạy theo cạnh dài.'
    : t === 'sel' ? 'Bấm vào đối tượng để chọn · kéo để di chuyển · Delete để xoá'
    : t === 'gopmep' ? 'Bấm tấm sàn thứ nhất rồi tấm thứ hai — hai mép đối diện sẽ kéo về cùng một đường'
    : t === 'catsan' ? 'Khoanh vùng cần bỏ sàn (bấm từng điểm, Enter khép kín) — phần sàn trong vùng đó bị cắt'
    : t === 'san' ? (($('#dSanTay') || {}).checked
        ? 'Bấm từng điểm quanh mép tấm sàn; bấm lại vào điểm đầu (hoặc Enter) để khép kín'
        : 'Bấm vào GIỮA PHÒNG — sàn tự ăn tới mép trong các bờ tường; tick "vẽ tay" nếu muốn tự khoanh')
    : t === '_san_tay' ? 'Bấm từng điểm quanh mép tấm sàn; bấm lại vào điểm đầu (hoặc Enter) để khép kín — ngoài tấm sàn là khoảng không'
    : t === 'lo' ? 'Bấm từng điểm theo con trỏ để vẽ đường bao ô thông tầng; bấm lại vào điểm đầu (hoặc Enter) để khép kín'
    : t === 'thangmay' ? 'Rê khung hố thang (bề rộng × chiều sâu); chiều cao đặt ở ô Chiều cao thang máy'
    : t === 'thangbo' ? 'Vẽ dọc theo một vế thang (chiều dài vế); thang tự chia đủ số vế và chiếu nghỉ để lên hết tầng'
    : t === 'nutbao' ? 'Bấm lên sàn để đặt nút ấn báo cháy — tự áp vào tường gần nhất, cao 1,4 m'
    : t === 'hong' ? 'Bấm lên sàn để đặt hộp họng nước — tủ tự áp lưng vào tường gần nhất'
    : t === 'beacon' ? 'Bấm lên vị trí muốn đặt đèn quay báo động'
    : t === 'chop' ? 'Bấm ở mép đáy chóp, rê sang mép đối diện rồi bấm lần nữa (khoảng cách = bề rộng đáy)'
    : t === 'toma' ? 'Bấm ở mép hố tổ máy, rê sang mép đối diện rồi bấm lần nữa (khoảng cách = đường kính)'
    : t === 'fm200' ? 'Bấm lên mặt sàn để đặt bình khí FM-200'
    : t === 'cong' ? 'Bấm vài mốc trên đường cong — máy tự bo qua các mốc đó; Enter để kết thúc'
    : t === 'bin' ? 'Bấm lên mặt sàn để đặt bình chữa cháy'
      : t === 'stair' ? 'Bấm CHÂN thang, rê chuột lên, bấm lần nữa ở ĐỈNH thang'
        : t === 'rail' ? 'Bấm điểm đầu lan can, rê chuột, bấm lần nữa để chốt'
          : 'Bấm điểm đầu, rê chuột tới vị trí, bấm lần nữa để chốt (Esc huỷ)');
  setTimeout(() => { if (state.tool === t) hint(''); }, 2800);
}

// O chon cao trinh ngay trong tab Thiet ke. Truoc day phai sang tab Xem bam ten
// cao trinh; chua bam thi may van ve len cao trinh dau tien -> vat roi ra ngoai
// tam nhin, nguoi dung tuong la khong ve duoc.
function dungOChonTang() {
  const sl = $('#dTang');
  if (!sl) return;
  if (!sl.options.length) {
    for (const f of state.data.floors) {
      const o = document.createElement('option');
      o.value = f.page;
      o.textContent = f.name;
      sl.appendChild(o);
    }
    sl.onchange = () => {
      state.activeFloor = +sl.value;
      state.visible = new Set([state.activeFloor]);
      applyVisibility();
      if (typeof syncFloorRows === 'function') syncFloorRows();
      renderDesignList(); renderEditPanel();
      focusFloor(state.activeFloor);
    };
  }
  if (state.activeFloor == null) {          // chua chon -> lay cao trinh gan mat nhin nhat
    let tot = state.data.floors[0], d = 1e9;
    for (const f of state.data.floors) {
      const k = Math.abs(floorY(f) - controls.target.y);
      if (k < d) { d = k; tot = f; }
    }
    state.activeFloor = tot.page;
    if (typeof syncFloorRows === 'function') syncFloorRows();
  }
  sl.value = state.activeFloor;
}

function setMode(m) {
  state.mode = m;
  if (typeof applyVisibility === 'function' && masses.length) setTimeout(applyVisibility, 0);
  $('#tabView').classList.toggle('on', m === 'view');
  $('#tabDesign').classList.toggle('on', m === 'design');
  $('#paneView').style.display = m === 'view' ? '' : 'none';
  $('#paneDesign').style.display = m === 'design' ? '' : 'none';
  $('#hud').style.display = m === 'view' ? '' : 'none';
  if (m === 'design') {
    dungOChonTang();
    renderDesignList(); renderEditPanel(); setTool(state.tool);
    if (!state.plan) {
      hint('Mẹo: bấm “◳ Mặt bằng 2D” (phím P) để vẽ như trên giấy — dễ hơn nhiều');
      setTimeout(() => hint(''), 4000);
    }
  }
  else { hint(''); selectKey(null); if (state.plan) matBang(false); }
}

// Phai goi TRUOC buildScene(): neu khong, cac tuong/tu da xoa se hien lai sau khi tai lai trang.
function loadStore() {
  try {
    const raw = localStorage.getItem(khoaKho('custom'));
    if (raw) state.custom = JSON.parse(raw) || {};
    const raw2 = localStorage.getItem(khoaKho('edits'));
    if (raw2) state.edits = JSON.parse(raw2) || {};
  } catch (e) { }
}

// ---------------------------------------------------------------------------
// KHOA TAB THIET KE: phai nhap dung mat khau moi vao duoc. Mat khau khong nam
// trong ma nguon, chi luu ban bam SHA-256. Mo duoc roi thi nho trong phien nay.
// Luu y: day la khoa phia trinh duyet, chi de ngan nguoi xem sua nham; ai biet
// mo cong cu nha phat trien van qua duoc. Muon chan that thi phai khoa o may chu.
// ---------------------------------------------------------------------------
const BAM_THIETKE = 'bbd2fcdcc81d2a30a408f0632495b1000a00a86f904678771074900ba4b80a98';
let daMoThietKe = false;

async function bamChuoi(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function xinMatKhauThietKe() {
  if (daMoThietKe) return true;
  try {
    if (sessionStorage.getItem('ialy.tk') === BAM_THIETKE) { daMoThietKe = true; return true; }
  } catch (e) { }
  const mk = prompt('Tab Thiết kế có khoá. Nhập mật khẩu:');
  if (mk === null) return false;
  let ok = false;
  try { ok = (await bamChuoi(mk.trim())) === BAM_THIETKE; } catch (e) { ok = false; }
  if (!ok) {
    hint('Sai mật khẩu — không vào được tab Thiết kế');
    setTimeout(() => hint(''), 2500);
    return false;
  }
  daMoThietKe = true;
  try { sessionStorage.setItem('ialy.tk', BAM_THIETKE); } catch (e) { }
  return true;
}

function initDesign() {
  const bMR = $('#nmMR'), bNM = $('#nmNM');
  if (bMR && bNM) {
    bMR.classList.toggle('on', nhaMayDang === 'mr');
    bNM.classList.toggle('on', nhaMayDang === 'nm');
    bMR.onclick = () => doiNhaMay('mr');
    bNM.onclick = () => doiNhaMay('nm');
  }
  const h1 = document.querySelector('#side header h1');
  if (h1) h1.firstChild.nodeValue = 'Bình chữa cháy — ' + NM.ten + ' ';
  document.title = NM.ten + ' — phương tiện PCCC';
  $('#tabView').onclick = () => setMode('view');
  $('#tabDesign').onclick = async () => { if (await xinMatKhauThietKe()) setMode('design'); };
  document.querySelectorAll('.tool').forEach(t => { t.onclick = () => setTool(t.dataset.tool); });
  renderer.domElement.addEventListener('pointerdown', designDown);
  renderer.domElement.addEventListener('pointermove', designMove);
  addEventListener('pointerup', designUp);
  addEventListener('keydown', e => {
    if (state.mode !== 'design') return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''));
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel && !typing) {
      e.preventDefault(); deleteSelection(); return;
    }
    if (e.key === 'Escape') { if (veTay.on) veTayHuy(); else if (dg.on) dgHuy(); else if (drag.on) huyVe(); else selectKey(null); }
    if (e.key === 'Enter' && veTay.on && !typing) { e.preventDefault(); veTayChot(false); return; }
    if (e.key === 'Backspace' && veTay.on && !typing) {
      e.preventDefault(); veTay.pts.pop(); veTayVe();
      if (!veTay.pts.length) veTayHuy(); return;
    }
    if (e.key === 'Enter' && dg.on && !typing) { e.preventDefault(); dgChot(); return; }
    if (e.key === 'Backspace' && dg.on && !typing) {
      e.preventDefault(); dg.pts.pop(); dgVe();
      if (!dg.pts.length) dgHuy(); return;
    }
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !typing) {
      e.preventDefault(); hoanTac(); return;
    }
    if ((e.key === 'r' || e.key === 'R') && state.sel && state.sel.slice(0, 2) === 'c:' && !typing) {
      rotateSel(e.shiftKey ? -15 : 15); return;
    }
    if (typing) return;
    if (e.key === 'p' || e.key === 'P') { matBang(!state.plan); return; }
    const map = { '1': 'sel', '2': 'wall', 'c': 'cong', 'C': 'cong', '3': 'box', '4': 'tra', '5': 'bin', '6': 'rail', '7': 'stair', '8': 'roof', '9': 'door', '0': 'exit', 'e': 'emg', 'E': 'emg', 'f': 'fm200', 'F': 'fm200', 'g': 'toma', 'G': 'toma', 'p': 'chop', 'P': 'chop', 'b': 'beacon', 'B': 'beacon', 't': 'thangbo', 'T': 'thangbo', 'o': 'lo', 'O': 'lo', 'n': 'san', 'N': 'san', 'k': 'catsan', 'K': 'catsan', 'j': 'gopmep', 'J': 'gopmep', 'm': 'thangmay', 'M': 'thangmay', 'h': 'hong', 'H': 'hong', 'a': 'nutbao', 'A': 'nutbao' };
    if (map[e.key]) setTool(map[e.key]);
  });
  $('#dDel').onclick = () => deleteSelection();
  $('#dUndo').onclick = () => hoanTac();
  $('#dClear').onclick = () => {
    chup();
    const f = activeFloorObj();
    const ed = state.edits[f.page];
    const nEd = ed ? (ed.delWall.length + ed.delCab.length + ed.toCab.length + ed.toWall.length) : 0;
    if (!customOf(f.page).length && !nEd) return;
    if (confirm('Hoàn tác toàn bộ chỉnh sửa ở ' + f.name + ' (xoá đối tượng tự vẽ và khôi phục tường/tủ đã xoá)?')) {
      state.custom[f.page] = []; delete state.edits[f.page];
      saveCustom(); saveEdits(); rebuildMasses(); rebuildCustom(); buildExits();
    }
  };
  $('#dExport').onclick = () => {
    const blob = new Blob([JSON.stringify({ custom: state.custom, edits: state.edits }, null, 1)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'thiet-ke.json'; a.click();
  };
  $('#d2d').onclick = () => matBang(!state.plan);
  $('#dHist').onclick = async () => {
    if (!cloud.san) { alert('Chưa bật đồng bộ Supabase.'); return; }
    let ds;
    try { ds = await cloud.lichSu(); }
    catch (e) { alert('Không đọc được lịch sử: ' + e.message); return; }
    if (!ds.length) { alert('Chưa có bản lưu cũ nào trên đám mây.'); return; }
    const dong = ds.slice(0, 15).map((r, i) => {
      const n = Object.values((r.du_lieu || {}).custom || {})
        .reduce((a, x) => a + (x ? x.length : 0), 0);
      return (i + 1) + ') ' + new Date(r.cap_nhat_luc).toLocaleString() + ' — ' + n + ' vật';
    }).join(String.fromCharCode(10));
    const xd = String.fromCharCode(10);
    const ch = prompt('Chọn bản muốn lấy lại (gõ số thứ tự):' + xd + xd + dong, '1');
    const k = parseInt(ch, 10);
    if (!k || k < 1 || k > ds.length) return;
    const d = ds[k - 1].du_lieu || {};
    chup();
    state.custom = d.custom || {};
    state.edits = d.edits || {};
    luuCucBo(); banDoiChua(true);
    rebuildMasses(); rebuildCustom();
    hint('Đã lấy lại bản lưu — kiểm tra rồi bấm “Lưu thay đổi” để chốt');
    setTimeout(() => hint(''), 4000);
  };
  $('#dFloorDown').onclick = () => {
    const f = activeFloorObj();
    const ds = customOf(f.page).filter(o => o.base);
    if (!ds.length) { alert('Cao trình này không có vật nào bị treo trên cao.'); return; }
    const dem = {};
    ds.forEach(o => { dem[o.type] = (dem[o.type] || 0) + 1; });
    const mo = Object.entries(dem).map(([t, n]) => n + ' ' + ({
      wall: 'tường', door: 'cửa', rail: 'lan can', box: 'khối hộp',
      tra: 'máy biến áp', roof: 'mái', exit: 'đèn EXIT' }[t] || t)).join(', ');
    if (!confirm('Hạ ' + ds.length + ' vật (' + mo + ') ở ' + f.name +
                 ' xuống cao độ sàn?')) return;
    chup();
    ds.forEach(o => { o.base = 0; });
    saveCustom(); rebuildCustom(); buildExits();
    hint('Đã hạ ' + ds.length + ' vật về cao độ sàn');
    setTimeout(() => hint(''), 3000);
  };
  $('#dPull').onclick = () => {
    if (!confirm('Bỏ thay đổi trên máy và lấy bản trên đám mây về?')) return;
    chup();
    cloud.keo(false, true);
  };
  $('#dImport').onclick = () => $('#dFile').click();
  $('#dFile').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then(t => {
      try {
        const j = JSON.parse(t);
        chup();
        state.custom = j.custom || j;
        state.edits = j.edits || {};
        saveCustom(); saveEdits(); rebuildMasses(); rebuildCustom(); buildExits();
      }
      catch (err) { alert('Tệp không đọc được: ' + err); }
    });
  };
  $('#dSave').onclick = () => {
    apDungSoDo(true);                  // vật đang chọn nhận luôn số đo vừa sửa
    luuCucBo();
    banDoiChua(false);
    if (cloud.san) cloud.push(true);
    hint(cloud.san ? 'Đang đẩy lên đám mây…' : 'Đã lưu vào trình duyệt');
    setTimeout(() => hint(''), 1800);
  };
  // Đồng bộ giữa các tab: localStorage dùng chung cho cùng một địa chỉ, nhưng mỗi tab
  // chỉ đọc lúc mở. Không nghe sự kiện này thì hai tab sẽ hiện hai bản vẽ khác nhau
  // và tab lưu sau ghi đè tab lưu trước.
  addEventListener('storage', e => {
    if (e.key !== khoaKho('custom') && e.key !== khoaKho('edits')) return;
    if (coThayDoi) return;                  // tab này đang có thay đổi chưa lưu -> giữ nguyên
    loadStore();
    rebuildMasses(); rebuildCustom(); buildExits();
    hint('Đã cập nhật thay đổi từ tab khác');
    setTimeout(() => hint(''), 2000);
  });

  window.__CUSTOM = () => customMeshes;
  window.__PICK = () => pickables;
  const v = $('#ver');
  if (v) {                       // de kiem tra trinh duyet da nap dung ban moi chua
    const src = document.querySelector('script[src*="app.js"]');
    v.textContent = 'Bản dựng: ' + ((src && src.src.split('v=')[1]) || '?') + ' (ialy.build)';
  }
  // Ban ve khoi tao phai nap XONG truoc khi noi dam may. Neu khong, cloud.keo()
  // thay ban do trong se day ban rong len va keo ve -> mat sach 80 hong nuoc.
  (window.__banVeGoc || Promise.resolve()).then(() => cloud.khoi());
  rebuildCustom();
}

// ---- phím mũi tên: dời góc nhìn theo mặt phẳng ngang; Shift = lên/xuống cao độ
addEventListener('keydown', e => {
  const t = (e.target && e.target.tagName) || '';
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(t)) return;
  const k = e.key;
  if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown' &&
      k !== 'PageUp' && k !== 'PageDown') return;
  e.preventDefault();
  // bước dời tỉ lệ với tầm nhìn hiện tại -> zoom sâu thì đi chậm, nhìn xa thì đi nhanh
  let buoc = camera.isOrthographicCamera
    ? (nuaKhung / camera.zoom) * 0.12
    : camera.position.distanceTo(controls.target) * 0.06;
  if (e.shiftKey) buoc *= 3;
  const nhin = new THREE.Vector3();
  camera.getWorldDirection(nhin);
  const truoc = new THREE.Vector3(nhin.x, 0, nhin.z);
  if (truoc.lengthSq() < 1e-6) truoc.set(0, 0, -1);           // nhìn thẳng từ trên xuống
  truoc.normalize();
  const phai = new THREE.Vector3().crossVectors(truoc, new THREE.Vector3(0, 1, 0)).normalize();
  const d = new THREE.Vector3();
  if (k === 'ArrowLeft') d.copy(phai).multiplyScalar(-buoc);
  else if (k === 'ArrowRight') d.copy(phai).multiplyScalar(buoc);
  else if (k === 'ArrowUp') d.copy(truoc).multiplyScalar(buoc);
  else if (k === 'ArrowDown') d.copy(truoc).multiplyScalar(-buoc);
  else d.set(0, k === 'PageUp' ? buoc : -buoc, 0);
  camera.position.add(d);
  controls.target.add(d);
  controls.update();
});

// ---------------------------------------------------------------- camera
function fitAll() {
  const box = new THREE.Box3();
  floorMeshes.filter(m => m.userData.floor.georef !== 'standalone').forEach(m => box.expandByObject(m));
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.z, s.y) * 0.9;
  controls.target.copy(c);
  camera.position.set(c.x - r * 0.75, c.y + r * 0.85, c.z + r * 1.15);
  camera.updateProjectionMatrix();
}

// Đổi cao trình thì đưa "Cao độ chân" về 0: giữ lại số của tầng trước là nguồn
// gốc của việc cả loạt tường/cửa/lan can bị treo lơ lửng giữa không trung.
function resetChan(page) {
  if (state.activeFloor === page) return;
  const e = $('#dBase');
  if (e && +e.value) {
    e.value = 0;
    canhBaoChan();
    hint('Đã đưa “Cao độ chân” về 0 cho cao trình mới');
    setTimeout(() => hint(''), 2500);
  }
}

function focusFloor(page, top = false) {
  resetChan(page);
  const m = floorMeshes.find(x => x.userData.floor.page === page);
  if (!m) return;
  const box = new THREE.Box3().setFromObject(m);
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.z) * 0.62;
  controls.target.copy(c);
  if (top) camera.position.set(c.x, c.y + r * 1.6, c.z + 0.01);
  else camera.position.set(c.x - r * .5, c.y + r * .8, c.z + r);
}

// ---------------------------------------------------------------- sidebar
function renderSidebar() {
  const d = state.data;

  const types = $('#types'); types.innerHTML = '';
  for (const [code, t] of Object.entries(d.types)) {
    const n = d.items.filter(i => i.type === code).length;
    const row = el('div', 'row active');
    row.innerHTML = `<span class="dot" style="background:${t.color}"></span>
      <span class="nm">${t.label}</span><span class="ct">${n}</span>`;
    row.onclick = () => {
      if (state.typeOn.has(code)) state.typeOn.delete(code); else state.typeOn.add(code);
      row.classList.toggle('active', state.typeOn.has(code));
      applyVisibility();
    };
    types.appendChild(row);
  }

  const fl = $('#floors'); fl.innerHTML = '';
  // Nha may Ialy gom nhieu hang muc roi rac -> xep theo KHU NHA cho de tim.
  // Ban ve chi co mot khoi (Ialy mo rong) thi khong hien tieu de khu.
  const dsF = [...d.floors].sort((a, b) =>
    (THU_TU_KHU.indexOf(khuNha(a)) - THU_TU_KHU.indexOf(khuNha(b))) ||
    (b.elevation - a.elevation));
  const nhomCo = [...new Set(dsF.map(khuNha))];
  // Moi khu mot the gap lai: bam tieu de moi mo ra, va chi mo MOT khu mot luc.
  const chiaKhu = nhomCo.length > 1;
  const oKhu = {};
  if (chiaKhu) {
    const dangO = dsF.find(f => f.page === state.activeFloor);
    // Mo san khu dang xem; chua chon gi thi mo Gian may — khu chinh cua nha may.
    const moSan = (nhomCo.includes(state.khuMo) && state.khuMo) ||
                  (dangO ? khuNha(dangO)
                         : (nhomCo.includes('Gian máy') ? 'Gian máy' : nhomCo[0]));
    for (const khu of nhomCo) {
      const dau = el('div', 'khu');
      const than = el('div', 'khuThan');
      const soTB = d.items.filter(i =>
        dsF.some(f => khuNha(f) === khu && f.page === i.floor)).length;
      const soCT = dsF.filter(f => khuNha(f) === khu).length;
      dau.innerHTML = `<span class="mui">▸</span><span class="nm">${khu}</span>` +
                      `<span class="ct">${soCT} cao trình · ${soTB}</span>`;
      const mo = m => {
        dau.classList.toggle('mo', m);
        than.style.display = m ? 'block' : 'none';
      };
      dau.onclick = () => {
        const dangMo = dau.classList.contains('mo');
        for (const k of nhomCo) oKhu[k].mo(false);
        mo(!dangMo);
      };
      oKhu[khu] = { dau, than, mo };
      fl.appendChild(dau); fl.appendChild(than);
      mo(khu === moSan);
    }
  }
  for (const f of dsF) {
    const n = d.items.filter(i => i.floor === f.page).length;
    const row = el('div', 'row active');
    row.dataset.page = f.page;
    row.innerHTML = `<span class="dot" style="background:#3d5468"></span>
      <span class="nm" title="${f.name}${f.note ? ' — ' + f.note : ''}">${f.name}</span>
      <span class="ct" data-ct>${n}</span>`;
    row.onclick = () => {
      state.activeFloor = f.page;
      state.khuMo = khuNha(f);
      document.querySelectorAll('#floors .row').forEach(r => r.style.outline = '');
      row.style.outline = '1px solid #4a7ba8';
      state.visible = new Set([f.page]);   // bấm cao trình nào -> chỉ hiện cao trình đó
      syncFloorRows();
      if (wk.on) { doiTangDiBo(f); return; }   // đang đi bộ -> dựng lại vách/lưới của cao trình mới
      focusFloor(f.page);
      applyVisibility();
    };
    const eye = el('span', 'ct', '👁');
    eye.style.cursor = 'pointer';
    eye.onclick = ev => {
      ev.stopPropagation();
      if (state.visible.has(f.page)) state.visible.delete(f.page); else state.visible.add(f.page);
      syncFloorRows(); applyVisibility();
    };
    row.appendChild(eye);
    (chiaKhu ? oKhu[khuNha(f)].than : fl).appendChild(row);
  }

  // Muc "Ghi chu" chi con cho canh bao cua ban ve; khong co canh bao thi an han.
  const notes = $('#notes');
  notes.innerHTML = '';
  if (d.warnings && d.warnings.length) {
    notes.innerHTML = '<h2>Ghi chú</h2>';
    notes.appendChild(el('div', 'warn', d.warnings.join('<br>')));
  }
}

// Khu nha cua mot cao trinh. Thu tu tra ve cung la thu tu hien trong danh sach
// (danh sach da sap theo cao do, cac cao trinh cung khu nam lien nhau).
const THU_TU_KHU = ['Cửa nhận nước', 'Nhà PK', 'Gian biến áp', 'Gian máy',
                    'Công trình phụ trợ'];
function khuNha(f) {
  const t = (f.name || '').toUpperCase();
  if (t.startsWith('CNN') || t.includes('CỬA NHẬN NƯỚC')) return 'Cửa nhận nước';
  if (t.includes('NHÀ PK')) return 'Nhà PK';
  if (t.includes('GIAN BIẾN ÁP')) return 'Gian biến áp';
  if (t.includes('GIAN MÁY') || t.includes('SÀN ')) return 'Gian máy';
  return 'Công trình phụ trợ';
}

function syncFloorRows() {
  document.querySelectorAll('#floors .row').forEach(r => {
    r.classList.toggle('active', state.visible.has(+r.dataset.page));
  });
}

function renderSidebarCounts() {
  const shown = markers.filter(m => m.visible).length;
  const d = state.data;
  const byType = {};
  for (const [c, t] of Object.entries(d.types)) byType[c] = d.items.filter(i => i.type === c).length;
  $('#stats').innerHTML =
    `<div class="chip">Tổng<b>${d.items.length}</b></div>
     <div class="chip">Đang hiện<b>${shown}</b></div>
     <div class="chip">Cao trình<b>${d.floors.length}</b></div>
     <div class="chip">Đèn EXIT<b>${((state.exitData && state.exitData.items) || []).length}</b></div>`;
}

function showInfo(it) {
  const f = floorOf(it.floor), t = state.data.types[it.type];
  const sM = mpp();
  const pos = f.georef === 'standalone'
    ? `X ${viTriBinh(it)[0].toFixed(1)} m · Y ${viTriBinh(it)[1].toFixed(1)} m`
    : `X ${(viTriBinh(it)[0] * sM).toFixed(1)} m · Y ${(viTriBinh(it)[1] * sM).toFixed(1)} m`;
  veTheKiemTra('i:' + it.id, f.page, TEN_PT[it.type] || t.label,
    kyMaHieu(it.type, f, it.ma || it.id, !!it.ma),
    f.name + (it.room ? ' · ' + it.room : '') + ' — ' + pos);
}

// ---------------------------------------------------------------------------
// THE THEO DOI KET QUA KIEM TRA PHUONG TIEN PCCC
// Bam vao mot thiet bi -> hien dung mau the treo tren binh ngoai thuc te:
// ten phuong tien, ky ma hieu, so seri, ngay dua vao su dung va bang 12 thang
// ghi ket qua kiem tra. Phan nguoi dung dien duoc luu theo tung thiet bi.
// ---------------------------------------------------------------------------
function theOf(page) {
  const e = editsOf(page);
  e.the = e.the || {};
  return e.the;
}

const TEN_PT = {
  ABC8: 'Bình Bột', CO25: 'Bình CO₂', CO224: 'Bình CO₂ xe đẩy', CO2: 'Bình CO₂',
  HONG: 'Họng nước', NUTBAO: 'Nút ấn báo cháy',
  hong: 'Họng nước vách tường', nutbao: 'Nút ấn báo cháy', fm200: 'Bình khí FM-200'
};
const VIET_TAT = { ABC8: 'BỘT', CO25: 'CO2', CO224: 'CO2', CO2: 'CO2', HONG: 'HCC',
                   NUTBAO: 'NA', hong: 'HCC', nutbao: 'NA', fm200: 'FM200', bin: 'BỘT' };

// Ky ma hieu theo mau cua don vi: <LOAI>-▼<cao trinh>-<ma thiet bi>.
// Rieng thiet bi CO TEN IN SAN TREN BAN VE (HCC-GM05, CO2-61, THB7-FM200-B01)
// thi giu nguyen ten do — day moi la ky ma hieu that cua don vi.
function kyMaHieu(loai, f, ma, veGoc) {
  if (veGoc) return String(ma);
  const el = (f.elevation || 0).toFixed(2).replace('.', ',');
  const vt = VIET_TAT[loai] || 'PT';
  // Ma cua vat tu ve da mang san tien to (HCC-01-01) -> bo di cho khoi lap lai
  const so = String(ma || '').replace(new RegExp('^' + vt + '-', 'i'), '');
  return vt + '-▼' + el + ' -' + so;
}

function veTheKiemTra(khoa, page, tenPT, ky, ghiChu) {
  const kho = theOf(page);
  const d = kho[khoa] || (kho[khoa] = { seri: '', ngaySD: '', hang: [] });
  const nam = new Date().getFullYear();
  let h = '<div class="tpccc"><h4>THẺ THEO DÕI KẾT QUẢ KIỂM TRA<br>PHƯƠNG TIỆN PCCC</h4>';
  h += '<div class="dong">- Tên phương tiện: <b>' + tenPT + '</b></div>';
  h += '<div class="dong">- Ký mã hiệu: <b>' + ky + '</b> Số Seri: ' +
       '<input data-o="seri" value="' + (d.seri || '') + '" style="text-align:left;width:38%"></div>';
  // Ca nha may dua vao su dung cung mot ngay -> dien san, ai can thi sua lai.
  const ngay = d.ngaySD || NM.ngaySD || '';
  h += '<div class="dong">- Ngày, tháng, năm đưa vào sử dụng: ' +
       '<input data-o="ngaySD" value="' + ngay + '" style="text-align:left;width:40%" placeholder="dd/mm/yyyy"></div>';
  h += '<table><tr><th>Ngày, tháng<br>kiểm tra</th><th>Kết quả<br>kiểm tra</th>' +
       '<th>Người, đơn vị<br>kiểm tra</th></tr>';
  for (let i = 0; i < 12; i++) {
    const r = d.hang[i] || {};
    const thang = String(i + 1).padStart(2, '0');
    h += '<tr><td class="ng">….../' + thang + '/' + nam +
         '<input data-h="' + i + '" data-o="ngay" value="' + (r.ngay || '') +
         '" style="width:0;height:0;position:absolute;opacity:0"></td>' +
         '<td><input data-h="' + i + '" data-o="kq" value="' + (r.kq || '') + '"></td>' +
         '<td><input data-h="' + i + '" data-o="nguoi" value="' + (r.nguoi || '') + '"></td></tr>';
  }
  h += '</table>';
  if (ghiChu) h += '<div class="ghi">' + ghiChu + '</div>';
  h += '</div>';
  $('#infobody').innerHTML = h;
  $('#info').classList.add('the');
  $('#info').style.display = 'block';
  $('#infobody').querySelectorAll('input').forEach(inp => {
    inp.oninput = () => {
      const i = inp.dataset.h, o = inp.dataset.o;
      if (i === undefined) d[o] = inp.value;
      else { d.hang[i] = d.hang[i] || {}; d.hang[i][o] = inp.value; }
      saveEdits();
    };
  });
}

// The thong tin cho VAT TU VE (hong nuoc, nut an, binh tu ve, FM-200).
const TEN_LOAI_VE = { hong: 'Họng lấy nước chữa cháy', nutbao: 'Nút ấn báo cháy',
                      bin: 'Bình chữa cháy xách tay', fm200: 'Bình khí FM-200' };
function showInfoVe(mesh) {
  const o = mesh.userData.obj;
  const f = floorOf(mesh.userData.page ?? state.data.floors[0].page);
  const sM = mpp();
  const ten = o.type === 'bin' ? (TEN_PT[o.binh || 'ABC8'] || 'Bình chữa cháy')
                               : (TEN_PT[o.type] || o.name);
  const loai = o.type === 'bin' ? (o.binh || 'ABC8') : o.type;
  const ma = mesh.userData.maSo || o.id;
  veTheKiemTra('c:' + o.id, f.page, ten, kyMaHieu(loai, f, ma, !!o.ma),
    f.name + ' — X ' + (o.u0 * sM).toFixed(1) + ' m · Y ' + (o.v0 * sM).toFixed(1) + ' m');
}


// ---------------------------------------------------------------- events
function onPointer(ev, click) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(markers.filter(m => m.visible), true);
  const tip = $('#tip');
  if (!hits.length) {
    // Bam vao HONG NUOC / NUT AN / binh tu ve cung phai ra ma so, khong chi binh
    // boc tu ban ve. Cac vat nay nam trong customMeshes chu khong phai markers.
    const dsVe = customMeshes.filter(m => m.visible && m.userData.obj &&
      ['hong', 'nutbao', 'bin', 'fm200'].includes(m.userData.obj.type));
    const h2 = raycaster.intersectObjects(dsVe, true);
    if (h2.length) {
      let o = h2[0].object;
      while (o && !o.userData.obj) o = o.parent;
      if (o) {
        const ob = o.userData.obj;
        const loai = ob.type === 'bin' ? (TEN_BINH[ob.binh || 'ABC8'] || TEN_LOAI_VE.bin)
                                       : TEN_LOAI_VE[ob.type];
        if (click) { state.selected = null; showInfoVe(o); applyVisibility(); }
        tip.style.display = 'block';
        tip.style.left = (ev.clientX - r.left + 14) + 'px';
        tip.style.top = (ev.clientY - r.top + 12) + 'px';
        tip.innerHTML = `<b>${o.userData.maSo || ob.name}</b> — ${loai}<br>` +
          floorOf(o.userData.page ?? state.data.floors[0].page).name;
        renderer.domElement.style.cursor = 'pointer';
        return;
      }
    }
  }
  if (hits.length) {
    let o = hits[0].object; while (o && !o.userData.item) o = o.parent;
    const it = o.userData.item, f = floorOf(it.floor);
    if (click) { state.selected = it.id; showInfo(it); applyVisibility(); }
    tip.style.display = 'block';
    tip.style.left = (ev.clientX - r.left + 14) + 'px';
    tip.style.top = (ev.clientY - r.top + 12) + 'px';
    // Hien dung ten in tren ban ve (neu co) — phai khop voi the kiem tra.
    tip.innerHTML = `<b>${it.ma || it.id}</b> — ${state.data.types[it.type].label}<br>
                     ${f.name}${it.room ? ' · ' + it.room : ''}`;
    renderer.domElement.style.cursor = 'pointer';
  } else {
    tip.style.display = 'none';
    renderer.domElement.style.cursor = 'grab';
    if (click) { state.selected = null; $('#info').style.display = 'none'; applyVisibility(); }
  }
}
renderer.domElement.addEventListener('pointermove', e => { if (state.mode === 'view') onPointer(e, false); });
renderer.domElement.addEventListener('click', e => { if (state.mode === 'view') onPointer(e, true); });
// Rê chuột ra khỏi khung 3D (ví dụ sang đọc thẻ) thì tắt chú thích bay, nếu
// không nó nằm đè lên thẻ theo dõi.
renderer.domElement.addEventListener('pointerleave', () => { $('#tip').style.display = 'none'; });
$('#infoclose').onclick = () => { $('#info').style.display = 'none'; $('#info').classList.remove('the'); state.selected = null; applyVisibility(); };

$('#q').oninput = e => { state.query = e.target.value; applyVisibility(); };
$('#explode').oninput = e => { state.explode = +e.target.value; $('#expv').textContent = state.explode.toFixed(1); relayout(); };
$('#mksize').oninput = e => { state.mkScale = +e.target.value; $('#mkv').textContent = state.mkScale.toFixed(1); applyVisibility(); };
$('#opacity').oninput = e => { state.opacity = +e.target.value; applyVisibility(); };
// O "Hieu chinh ti le" co the bi go khoi trang; thieu no thi bo qua, dung de
// mot phan tu vang mat lam dut ca doan khoi tao phia sau.
if ($('#calib')) $('#calib').onchange = e => {
  state.unitM = Math.max(5, +e.target.value || 22);
  localStorage.setItem(khoaKho('unitM'), state.unitM);
  relayout();
};
$('#allOn').onclick = () => { state.visible = new Set(state.data.floors.map(f => f.page)); syncFloorRows(); applyVisibility(); fitAll(); };
$('#cab').onclick = e => {
  state.cabinets = !state.cabinets;
  e.target.classList.toggle('pri', state.cabinets);
  relayout();
};
$('#massing').onclick = e => {
  state.massing = !state.massing;
  e.target.classList.toggle('pri', state.massing);
  applyVisibility();
};
$('#plan2d').onclick = e => {
  state.showPlan = !state.showPlan;
  e.target.classList.toggle('pri', state.showPlan);
  e.target.textContent = state.showPlan ? 'Bản vẽ mặt bằng' : 'Bản vẽ mặt bằng (đang tắt)';
  try { localStorage.setItem(khoaKho('showPlan'), state.showPlan ? '1' : '0'); } catch (err) { }
  applyVisibility();
};
$('#exitScale').oninput = e => {
  state.exitScale = +e.target.value;
  $('#exitScaleVal').textContent = state.exitScale.toFixed(1) + '×';
  buildExits(); rebuildCustom();
};
$('#exitBtn').onclick = e => {
  state.exitOn = !state.exitOn;
  e.target.classList.toggle('pri', state.exitOn);
  applyVisibility();
};
$('#frame').onclick = e => {
  state.frame = !state.frame;
  e.target.classList.toggle('pri', state.frame);
  applyVisibility();
};
$('#wallop').oninput = e => {
  const v = +e.target.value;
  matWallShared.opacity = v; matSlab.opacity = Math.min(1, v * .42);
  matWallShared.visible = v > 0.02; matSlab.visible = v > 0.02;
};
$('#paper').onclick = e => {
  state.paper = !state.paper;
  e.target.classList.toggle('pri', state.paper);
  scene.background = new THREE.Color(state.paper ? 0x223042 : 0x0e1116);
  scene.fog.color = scene.background;
  applyVisibility();
};
$('#reset').onclick = () => { state.visible = new Set(state.data.floors.map(f => f.page)); syncFloorRows(); applyVisibility(); fitAll(); };
$('#top').onclick = () => focusFloor(state.activeFloor ?? state.data.floors[0].page, true);
$('#csv').onclick = () => {
  const s = mpp(), rows = [['ma', 'loai', 'cao_trinh_m', 'tang', 'phong', 'x_m', 'y_m', 'trang_ban_ve']];
  for (const it of state.data.items) {
    const f = floorOf(it.floor);
    const k = f.georef === 'standalone' ? 1 : s;
    rows.push([it.ma || it.id, state.data.types[it.type].label, f.elevation.toFixed(2), f.name,
      it.room || '', (viTriBinh(it)[0] * k).toFixed(2), (viTriBinh(it)[1] * k).toFixed(2), f.page + 1]);
  }
  const csv = '﻿' + rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'binh-chua-chay-ialy.csv'; a.click();
};

$('#collapse').onclick = () => { $('#app').classList.add('collapsed'); setTimeout(resize, 0); };
$('#burger').onclick = () => { $('#app').classList.remove('collapsed'); setTimeout(resize, 0); };

let nuaKhung = 40;                 // nửa chiều cao khung nhìn 2D, tính bằng mét
function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h);
  camPersp.aspect = w / h; camPersp.updateProjectionMatrix();
  const a = w / Math.max(1, h);
  camOrtho.top = nuaKhung; camOrtho.bottom = -nuaKhung;
  camOrtho.left = -nuaKhung * a; camOrtho.right = nuaKhung * a;
  camOrtho.updateProjectionMatrix();
}

// ---- chế độ MẶT BẰNG 2D: khoá xoay, nhìn vuông góc từ trên xuống
function matBang(bat) {
  state.plan = bat;
  const f = activeFloorObj();
  const b = $('#d2d');
  if (b) { b.classList.toggle('pri', bat); b.textContent = bat ? '◳ Đang ở mặt bằng 2D' : '◳ Mặt bằng 2D'; }
  if (bat) {
    if (!state.truocPlan) {                    // nhớ cài đặt hiển thị của người dùng
      state.truocPlan = {
        visible: [...state.visible], opacity: state.opacity,
        wallop: +$('#wallop').value,
        mauTuong: matWallShared.color.getHex()
      };
    }
    // Tường vốn màu be xám, nằm trên nền BẢN VẼ TRẮNG thì gần như mất hút.
    // Vào mặt bằng 2D thì đổi sang xanh đậm cho nổi rõ trên nền trắng.
    matWallShared.color.setHex(0xff2d55);   // hong canh, khong lan voi net den va mui ten xanh
    const m = floorMeshes.find(x => x.userData.floor.page === f.page);
    const hop = m ? new THREE.Box3().setFromObject(m) : null;
    const c = hop ? hop.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, floorY(f), 0);
    const sz = hop ? hop.getSize(new THREE.Vector3()) : new THREE.Vector3(80, 1, 80);
    const a = Math.max(0.2, view.clientWidth / Math.max(1, view.clientHeight));
    // Khung ảnh bản vẽ thường thừa nhiều giấy trắng quanh mặt bằng. Lấy vùng
    // THỰC SỰ CÓ THIẾT BỊ để phóng cho vừa, nếu không mặt bằng hiện bé tí giữa
    // tờ giấy, vẽ tường ra chỉ còn vài pixel, tưởng là không lên nét.
    let bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9;
    const gom = (px, pz) => {
      bx0 = Math.min(bx0, px); bz0 = Math.min(bz0, pz);
      bx1 = Math.max(bx1, px); bz1 = Math.max(bz1, pz);
    };
    for (const it of state.data.items) {
      if (it.floor !== f.page) continue;
      const q = worldXZ(f, ...viTriBinh(it)); gom(q[0], q[1]);
    }
    for (const o of customOf(f.page)) {
      gom(...worldXZ(f, o.u0, o.v0)); gom(...worldXZ(f, o.u1, o.v1));
    }
    if (bx0 < bx1 && bz0 < bz1 && (bx1 - bx0) > 3 && (bz1 - bz0) > 3) {
      c.x = (bx0 + bx1) / 2; c.z = (bz0 + bz1) / 2;
      sz.x = (bx1 - bx0) * 1.35; sz.z = (bz1 - bz0) * 1.35;   // chừa lề 35 %
    }
    nuaKhung = Math.max(8, sz.z * 0.55, (sz.x * 0.55) / a);   // lọt cả bề ngang lẫn bề dọc
    camera = camOrtho;
    camOrtho.zoom = 1;
    camOrtho.position.set(c.x, floorY(f) + 300, c.z + 0.001);
    camOrtho.up.set(0, 0, -1);
    controls.target.set(c.x, floorY(f), c.z);
    controls.object = camOrtho;
    controls.enableRotate = false;                 // kéo chuột trái = vẽ, không xoay nữa
    camOrtho.lookAt(controls.target);
    camOrtho.updateMatrixWorld(true);        // cập nhật ngay, nếu không cú bấm đầu tiên sẽ trượt
    // chỉ hiện đúng cao trình đang vẽ, nét bản vẽ rõ nhất, tường mờ bớt để thấy nét dưới
    state.visible = new Set([f.page]);
    // Vao mat bang 2D la de DO LAI theo ban ve -> tu bat anh ban ve nen.
    // Truoc day mac dinh tat, nguoi dung vao thay to giay trang, tuong la
    // ve tuong ra ma khong len net.
    if (!state.showPlan && f.image) {
      state.showPlan = true;
      try { localStorage.setItem(khoaKho('showPlan'), '1'); } catch (err) { }
      const bp = $('#plan2d');
      if (bp) { bp.classList.add('pri'); bp.textContent = 'Bản vẽ mặt bằng'; }
    }
    if (state.showPlan) { state.opacity = 1; $('#opacity').value = 1; }
    rebuildCustom();                           // dung lai tuong theo be day cua che do 2D
    const dam = 0.75;                          // du dam de thay ro tren nen trang
    $('#wallop').value = dam;
    matWallShared.opacity = dam; matWallShared.visible = true;
    matSlab.opacity = Math.min(1, dam * .42);
    applyVisibility(); renderSidebar();
  } else {
    camera = camPersp;
    controls.object = camPersp;
    controls.enableRotate = true;
    camOrtho.up.set(0, 1, 0);
    const t = state.truocPlan;                 // trả lại đúng cài đặt trước khi vào 2D
    if (t) {
      state.visible = new Set(t.visible);
      state.opacity = t.opacity; $('#opacity').value = t.opacity;
      $('#wallop').value = t.wallop;
      if (t.mauTuong !== undefined) matWallShared.color.setHex(t.mauTuong);
      matWallShared.opacity = t.wallop; matSlab.opacity = Math.min(1, t.wallop * .42);
      matWallShared.visible = t.wallop > 0.02; matSlab.visible = t.wallop > 0.02;
      state.truocPlan = null;
      applyVisibility(); renderSidebar();
    }
    rebuildCustom();                           // tra tuong ve be day that
    focusFloor(f.page);
  }
  resize();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- start
fetch(duongDL('plant.json?v=') + Date.now()).then(r => r.json()).then(d => {
  state.data = d;
  state.unitM = +(localStorage.getItem(khoaKho('unitM')) || d.default_unit_spacing_m);
  state.showPlan = localStorage.getItem(khoaKho('showPlan')) === '1';   // mặc định tắt
  if ($('#calib')) $('#calib').value = state.unitM;
  state.visible = new Set(d.floors.map(f => f.page));
  state.typeOn = new Set(Object.keys(d.types));
  fetch(duongDL('lines.json?v=') + Date.now())
    .then(r => r.ok ? r.json() : { walls: {} })
    .then(l => {
      state.lines = l.walls || {};
      if (typeof rebuildMasses === 'function') { /* chỉ dùng cho chế độ đi bộ */ }
    })
    .catch(() => { state.lines = {}; });
  fetch(duongDL('exit.json?v=') + Date.now()).then(r => r.ok ? r.json() : { items: [] })
    .then(e => { state.exitData = e; buildExits(); renderSidebarCounts(); })
    .catch(() => { state.exitData = { items: [] }; });
  renderSidebar();
  loadStore();
  // Ban ve khoi tao cua nha may (neu co): chi nap khi nguoi dung chua ve gi va
  // dam may cung chua co — de khong de len viec dang lam.
  // Dem SO VAT, khong dem so trang: customOf() tu tao mang rong cho moi trang
  // nen Object.keys(...) luon > 0 va ban ve khoi tao se khong bao gio nap.
  const soVat = o => Object.values(o || {}).reduce((a, b) => a + (b ? b.length : 0), 0);
  window.__banVeGoc = soVat(state.custom) ? Promise.resolve()
    : fetch(duongDL('custom.json?v=') + Date.now())
        .then(r => r.ok ? r.json() : null)
        .then(j => {
          if (!j || !j.custom || soVat(state.custom)) return;
          state.custom = j.custom; state.edits = j.edits || {};
          luuCucBo();
          if (typeof rebuildCustom === 'function') rebuildCustom();
          renderSidebarCounts();
        })
        .catch(() => { });
  buildScene();
  initDesign();
  resize();
  fitAll();
  const bPlan = $('#plan2d');
  if (bPlan) {
    bPlan.classList.toggle('pri', state.showPlan);
    bPlan.textContent = state.showPlan ? 'Bản vẽ mặt bằng' : 'Bản vẽ mặt bằng (đang tắt)';
  }
  window.__S = state; window.__M = () => markers; window.__C = camera; window.__CAM = () => camera; window.__R = renderer; window.__O = controls;
  // Chỉ vẽ lại khi thực sự có thay đổi (xoay, kéo, sửa, đi bộ). Lúc để yên thì
// không đụng tới GPU -> máy đỡ nóng, đỡ giật khi cảnh nhiều vật.
  let canVe = true, choiLai = 0;
  window.veLai = (n) => { canVe = true; choiLai = Math.max(choiLai, n || 0); };
  controls.addEventListener('change', () => window.veLai(2));
  // O mat bang 2D, be day ve cua tuong phu thuoc muc phong to -> dung lai khi
  // muc phong doi nhieu, co han luong cho khoi giat.
  let zoomCu = 0, henZoom = null;
  controls.addEventListener('change', () => {
    if (!state.plan) return;
    const z = camOrtho.zoom;
    if (Math.abs(Math.log(z / (zoomCu || 1))) < 0.18) return;
    clearTimeout(henZoom);
    henZoom = setTimeout(() => { zoomCu = z; rebuildCustom(); }, 160);
  });
  ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'keydown', 'keyup', 'input', 'change']
    .forEach(e => addEventListener(e, () => window.veLai(2), { passive: true }));
  addEventListener('resize', () => window.veLai(4));
  (function loop() {
    requestAnimationFrame(loop);
    const nay = performance.now();
    const dt = Math.min(.05, (nay - (loop.truoc || nay)) / 1000); loop.truoc = nay;
    if (typeof buocDiBo === 'function') buocDiBo(dt);
    if (!wk.on) controls.update();
    // nhịp nền 2 lần/giây để ảnh nạp xong là hiện ngay
    if (nay - (loop.nen || 0) > 500) { loop.nen = nay; canVe = true; }
    if (wk.on || canVe || choiLai > 0) {
      if (choiLai > 0) choiLai--; else canVe = false;
      renderer.render(scene, camera);
    }
  })();
}).catch(e => {
  document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif;color:#e6edf3">
    Không đọc được dữ liệu: ${e}. Hãy mở ứng dụng qua máy chủ cục bộ (chạy <code>start.bat</code>).</div>`;
});


// ===========================================================================
// CHẾ ĐỘ ĐI BỘ (góc nhìn thứ nhất) + DẪN ĐƯỜNG THOÁT NẠN LÊN EL. 348.00
// Nạp sau app.js; dùng các hàm/biến toàn cục mà app.js đã gắn lên window.
// ===========================================================================
const CAO_MAT = 1.65;          // tầm mắt người đi (m)
const BAN_KINH_NGUOI = 0.30;   // bán kính va chạm của người
const O_LUOI = 0.6;            // cạnh ô lưới dò đường (m)

const wk = { on: false, f: null, x: 0, z: 0, yaw: 0, pitch: 0,
             phim: {}, luoi: null, duong: [], dich: null, lan: 0 };

// ---- lưới đi lại của một cao trình: ô chạm tường thì cấm, ô trong ô cửa thì mở

// Tuyến tường bóc từ vector của PDF cho một cao trình (toạ độ thế giới).
// Đây mới là nguồn tường ĐẦY ĐỦ: ảnh mặt bằng nhiều tờ gần như trắng nên cách
// dò "nét mực" trên ảnh chỉ bắt được vài ô.
// Cao trình đã được người dùng vẽ tường riêng thì bản vẽ đó là nguồn duy nhất:
// không lấy thêm nét mực của ảnh mặt bằng gốc (những nét đã xoá sẽ mọc lại).
function coBanVeRieng(f) {
  let n = 0;
  for (const o of customOf(f.page))
    if (o.type === 'wall' || o.type === 'box' || o.type === 'tra') n++;
  return n >= 3;
}

function tuyenTuong(f) {
  const fp = footprintWorld(f);
  // BẢN VẼ CỦA NGƯỜI DÙNG LÀ CHÍNH: cao trình nào đã có tường tự vẽ thì chỉ lấy
  // tường đó + tường bóc từ bản vẽ CHƯA bị xoá. Tuyến vector của PDF chỉ dùng
  // cho cao trình còn trắng, nếu không những nét đã xoá sẽ mọc lại ở chế độ đi bộ.
  const tuVe = customOf(f.page).filter(o => o.type === 'wall' || o.type === 'box' ||
                                            o.type === 'tra');
  if (tuVe.length >= 3) {
    const ra = [];
    const them = (a, b, day) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < .3) return;
      ra.push({ x0: a[0], z0: a[1], x1: b[0], z1: b[1], day: Math.max(.1, day), L: L });
    };
    for (const o of tuVe) {
      them(worldXZ(f, o.u0, o.v0), worldXZ(f, o.u1, o.v1), o.t || .22);
    }
    const ed = editsOf(f.page);
    (f.walls || []).forEach((r, i) => {
      if (ed.delWall.indexOf(i) >= 0) return;         // tường đã xoá thì thôi
      const ngang = (r[2] - r[0]) >= (r[3] - r[1]);
      them(worldXZ(f, ngang ? r[0] : (r[0] + r[2]) / 2, ngang ? (r[1] + r[3]) / 2 : r[1]),
           worldXZ(f, ngang ? r[2] : (r[0] + r[2]) / 2, ngang ? (r[1] + r[3]) / 2 : r[3]),
           (ngang ? r[3] - r[1] : r[2] - r[0]) * mpp());
    });
    return ra;
  }
  const ds = (state.lines && state.lines[f.page]) || [];
  const ra = [];
  for (const w of ds) {
    let a = worldXZ(f, w[0], w[1]), b = worldXZ(f, w[2], w[3]);
    if (fp) {                       // CẮT theo đúng khung sàn: tường không tràn ra ngoài sàn
      let t0 = 0, t1 = 1;
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const cat = (p, q) => {       // p*t <= q
        if (Math.abs(p) < 1e-9) return q >= 0;
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
        else { if (r < t0) return false; if (r < t1) t1 = r; }
        return true;
      };
      const m = .15;
      if (!cat(-dx, a[0] - fp.x0 + m) || !cat(dx, fp.x1 - a[0] + m) ||
          !cat(-dz, a[1] - fp.z0 + m) || !cat(dz, fp.z1 - a[1] + m)) continue;
      a = [a[0] + dx * t0, a[1] + dz * t0];
      b = [a[0] + dx * (t1 - t0), a[1] + dz * (t1 - t0)];
    }
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < .5) continue;
    ra.push({ x0: a[0], z0: a[1], x1: b[0], z1: b[1], day: Math.max(.1, w[4] || .2), L: L });
  }
  return ra;
}


// ---------------------------------------------------------------------------
// NỐI CÁC MẢNH SÀN BỊ CÔ LẬP VÀO VÙNG CHÍNH (làm một lần cho MỌI cao trình).
// Bản vẽ không phải lúc nào cũng có ký hiệu cửa, nên nhiều buồng thang / hành
// lang bị nét tường khép kín thành "ốc đảo": xuống thang tới đó là đứng chôn
// chân. Ở đây dò lối rẻ nhất (0-1 BFS: đi qua ô trống giá 0, phá một ô chặn giá
// 1) từ mảnh cô lập sang vùng chính rồi mở một lối rộng 0,6 m qua chỗ vách MỎNG
// NHẤT. Các ô vừa mở được trả về để đục luôn ô cửa tương ứng trên vách 3D, nhờ
// vậy chỗ đi được và chỗ nhìn thấy vẫn khớp nhau — không có chuyện đi xuyên
// tường đặc.
// ---------------------------------------------------------------------------
function noiManhVaoChinh(L, f, toiDa) {
  const N = L.nx * L.nz;
  const ke = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const nhan = new Int32Array(N).fill(-1);
  const co = [];
  for (let c = 0; c < N; c++) {
    if (!L.o[c] || nhan[c] >= 0) continue;
    const id = co.length, q = [c]; nhan[c] = id;
    for (let h = 0; h < q.length; h++) {
      const u = q[h], ui = (u / L.nz) | 0, uj = u % L.nz;
      for (const k of ke) {
        const ni = ui + k[0], nj = uj + k[1];
        if (ni < 0 || nj < 0 || ni >= L.nx || nj >= L.nz) continue;
        const n = ni * L.nz + nj;
        if (nhan[n] >= 0 || !L.o[n]) continue;
        nhan[n] = id; q.push(n);
      }
    }
    co.push(q);
  }
  if (co.length < 2) return [];
  let idLon = 0;
  co.forEach((v, i) => { if (v.length > co[idLon].length) idLon = i; });

  // mảnh cần nối: mảnh có vế thang, hoặc mảnh đủ rộng (>= 20 ô ~ 7 m²)
  const thang = diemThoat(f).concat(thangXuong(f));
  const canNoi = new Set();
  for (const t of thang) {
    const i = L.iOf(t.x), j = L.jOf(t.z);
    if (i < 0 || j < 0 || i >= L.nx || j >= L.nz) continue;
    const id = nhan[i * L.nz + j];
    if (id >= 0 && id !== idLon) canNoi.add(id);
  }
  co.forEach((v, i) => { if (i !== idLon && v.length >= 20) canNoi.add(i); });

  const moRa = [];
  const coThang = new Set();
  for (const t of thang) {
    const i = L.iOf(t.x), j = L.jOf(t.z);
    if (i < 0 || j < 0 || i >= L.nx || j >= L.nz) continue;
    const id = nhan[i * L.nz + j];
    if (id >= 0) coThang.add(id);
  }
  for (const id of canNoi) {
   // mảnh có vế thang thì cố nối bằng được: cho phá dày hơn (tới ~7 m)
   const muc = coThang.has(id) ? [toiDa || 5, 8, 12] : [toiDa || 5];
   for (let lan = 0; lan < muc.length; lan++) {
    const CAP = muc[lan];
    // Dijkstra 0-1: đi trong ô trống giá 0, phá một ô chặn giá 1
    const gia = new Int32Array(N).fill(1e9);
    const truoc = new Int32Array(N).fill(-1);
    const thung = [];                     // thung[g] = danh sách ô có giá g
    const day = (c, g) => { (thung[g] || (thung[g] = [])).push(c); };
    for (const c of co[id]) { gia[c] = 0; day(c, 0); }
    let dich = -1;
    for (let g = 0; g <= CAP && dich < 0; g++) {
      const t = thung[g];
      if (!t) continue;
      for (let h = 0; h < t.length; h++) {
        const c = t[h];
        if (gia[c] !== g) continue;
        if (nhan[c] === idLon) { dich = c; break; }
        const ci = (c / L.nz) | 0, cj = c % L.nz;
        for (const k of ke) {
          const ni = ci + k[0], nj = cj + k[1];
          if (ni < 0 || nj < 0 || ni >= L.nx || nj >= L.nz) continue;
          const n = ni * L.nz + nj;
          const g2 = g + (L.o[n] ? 0 : 1);
          if (g2 > CAP || g2 >= gia[n]) continue;
          gia[n] = g2; truoc[n] = c;
          if (g2 === g) t.push(n); else day(n, g2);
        }
      }
    }
    if (dich < 0) continue;                        // chưa tới -> thử mức dày hơn
    for (let c = dich; c >= 0; c = truoc[c]) {     // mở đúng các ô chặn trên lối
      if (!L.o[c]) {
        L.o[c] = 1;
        moRa.push([L.xOf((c / L.nz) | 0), L.zOf(c % L.nz)]);
      }
      if (truoc[c] < 0) break;
    }
    break;
   }
  }
  return moRa;
}

function dungLuoi(f) {
  const fp = footprintWorld(f);
  if (!fp) return null;
  const nx = Math.ceil((fp.x1 - fp.x0) / O_LUOI), nz = Math.ceil((fp.z1 - fp.z0) / O_LUOI);
  const can = [];
  const ed = editsOf(f.page);
  // Tường/lan can là ĐOẠN THẲNG, không phải hình chữ nhật bao. Trước đây lấy hộp
  // bao nên một bức tường XIÊN chặn nguyên cả vùng chữ nhật quanh nó -> EL.288.65
  // chỉ còn 105/3626 ô đi được, xuống tới nơi là kẹt cứng. Nay đo khoảng cách
  // thật tới đoạn thẳng; chỉ box/trụ mới dùng hộp bao.
  const doan = [];
  const themDoan = (a, b, t) => {
    const L2 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L2 < 1e-6) return;
    doan.push({ x0: a[0], z0: a[1], ux: (b[0] - a[0]) / L2, uz: (b[1] - a[1]) / L2, L: L2, t: t });
  };
  (f.walls || []).forEach((r, i) => {
    if (ed.delWall.indexOf(i) >= 0) return;
    themDoan(worldXZ(f, r[0], r[1]), worldXZ(f, r[2], r[3]), .11);
  });
  for (const o of customOf(f.page)) {
    if (o.type !== 'wall' && o.type !== 'box' && o.type !== 'tra' && o.type !== 'rail') continue;
    const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
    if (o.type === 'box' || o.type === 'tra') {          // khối đặc: giữ hộp bao
      const t = (o.t || .22) / 2;
      can.push({ x0: Math.min(a[0], b[0]) - t, x1: Math.max(a[0], b[0]) + t,
                 z0: Math.min(a[1], b[1]) - t, z1: Math.max(a[1], b[1]) + t });
    } else themDoan(a, b, o.type === 'rail' ? .10 : (o.t || .22) / 2);
  }
  const chamDoan = (x, z) => {
    for (const w of doan) {
      let t = (x - w.x0) * w.ux + (z - w.z0) * w.uz;
      if (t < -BAN_KINH_NGUOI || t > w.L + BAN_KINH_NGUOI) continue;
      t = Math.max(0, Math.min(w.L, t));
      const dx = x - (w.x0 + w.ux * t), dz = z - (w.z0 + w.uz * t);
      if (Math.hypot(dx, dz) < w.t + BAN_KINH_NGUOI) return true;
    }
    return false;
  };
  const cua = [];                       // ô cửa: cho phép đi xuyên qua
  for (const o of customOf(f.page)) {
    if (o.type !== 'door') continue;
    const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
    cua.push({ x0: Math.min(a[0], b[0]) - .4, x1: Math.max(a[0], b[0]) + .4,
               z0: Math.min(a[1], b[1]) - .4, z1: Math.max(a[1], b[1]) + .4 });
  }
  (f.doors || []).forEach(d => {
    const a = worldXZ(f, d[0], d[1]), b = worldXZ(f, d[2], d[3]);
    cua.push({ x0: Math.min(a[0], b[0]) - .5, x1: Math.max(a[0], b[0]) + .5,
               z0: Math.min(a[1], b[1]) - .5, z1: Math.max(a[1], b[1]) + .5 });
  });
  const tam = tamSanCuaTang(f);
  // Nét vẽ trên bản vẽ cũng là vách: phòng nào kín nét, không có ô cửa thì
  // không lọt vào được. Ô 0,6 m chỉ chặn khi phần lớn ô là mực đậm -> gạch
  // chéo, nét gióng mảnh vẫn đi qua bình thường.
  const muc = mucCuaTang(f);
  const boMuc = coBanVeRieng(f);       // đã có bản vẽ riêng -> bỏ nét mực ảnh gốc
  const coMuc = (x, z) => {
    if (!muc || boMuc) return false;
    const sx = (muc.W - 1) / (muc.x1 - muc.x0), sz = (muc.H - 1) / (muc.z1 - muc.z0);
    const a0 = Math.round((x - O_LUOI / 2 - muc.x0) * sx), a1 = Math.round((x + O_LUOI / 2 - muc.x0) * sx);
    const b0 = Math.round((z - O_LUOI / 2 - muc.z0) * sz), b1 = Math.round((z + O_LUOI / 2 - muc.z0) * sz);
    if (a1 < 0 || b1 < 0 || a0 >= muc.W || b0 >= muc.H) return false;
    let den = 0, tong = 0;
    for (let a = Math.max(0, a0); a <= Math.min(muc.W - 1, a1); a++)
      for (let b = Math.max(0, b0); b <= Math.min(muc.H - 1, b1); b++) {
        tong++; if (muc.m[b * muc.W + a]) den++;
      }
    return tong > 0 && den / tong > 0.45;
  };
  const lo = (loSanCuaTang(f) || []).filter(r => r.pts && r.pts.length >= 3);
  // Cả MẶT BẰNG vế thang và hai chiếu đều đi được. Trước đây chỉ mở một vòng
  // tròn 1,1 m quanh TÂM vế nên xuống tới nơi là đứng trên một ốc đảo bé tí,
  // bước một bước là đụng ô cấm -> kẹt cứng ở chân thang.
  const veThang = oThangCuaTang(f);
  const trenVeThang = (x, z) => veThang.some(t => {
    const c = Math.cos(-t.ang), s2 = Math.sin(-t.ang);
    const dx = x - t.x, dz = z - t.z;
    return Math.abs(dx * c - dz * s2) <= t.nua + .35 &&
           Math.abs(dx * s2 + dz * c) <= t.ngang + .35;
  });
  const chanThang = diemThoat(f).concat(thangXuong(f));
  const tuyen = tuyenTuong(f);
  const chamTuyen = (x, z) => {
    for (const w of tuyen) {
      const ux = (w.x1 - w.x0) / w.L, uz = (w.z1 - w.z0) / w.L;
      let t = (x - w.x0) * ux + (z - w.z0) * uz;
      if (t < 0 || t > w.L) continue;
      const d = Math.abs((x - w.x0) * uz - (z - w.z0) * ux);
      if (d < w.day / 2 + BAN_KINH_NGUOI) return true;
    }
    return false;
  };
  const trong = (x, z) => {
    // chân thang / chiếu nghỉ luôn đi được
    if (trenVeThang(x, z)) return true;
    if (chanThang.some(t => Math.hypot(t.x - x, t.z - z) < 1.6)) return true;
    if (lo.some(r => trongDaGiac(r.pts, x, z))) return false;   // lỗ thông tầng: hụt chân
    if (tam.length && !tam.some(p => trongDaGiac(p, x, z))) return false;   // khoảng không
    if (cua.some(c => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1)) return true;
    const m = BAN_KINH_NGUOI;
    if (can.some(c => x >= c.x0 - m && x <= c.x1 + m && z >= c.z0 - m && z <= c.z1 + m)) return false;
    if (chamDoan(x, z)) return false;
    if (chamTuyen(x, z)) return false;
    return !coMuc(x, z);
  };
  const o = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++)
      o[i * nz + j] = trong(fp.x0 + (i + .5) * O_LUOI, fp.z0 + (j + .5) * O_LUOI) ? 1 : 0;
  const L = { fp: fp, nx: nx, nz: nz, o: o,
    iOf: x => Math.floor((x - fp.x0) / O_LUOI), jOf: z => Math.floor((z - fp.z0) / O_LUOI),
    xOf: i => fp.x0 + (i + .5) * O_LUOI, zOf: j => fp.z0 + (j + .5) * O_LUOI };
  // nối các mảnh bị cô lập (nhất là buồng thang) vào vùng chính
  L.moThem = noiManhVaoChinh(L, f);
  // "trong" phải tra theo lưới đã nối, nếu không người vẫn bị chặn ở lối vừa mở
  L.trong = (x, z) => {
    const i = L.iOf(x), j = L.jOf(z);
    if (i < 0 || j < 0 || i >= L.nx || j >= L.nz) return trong(x, z);
    return !!L.o[i * L.nz + j];
  };
  return L;
}

// ---- điểm thoát nạn của cao trình: các vế cầu thang đi lên
function diemThoat(f) {
  const ra = [];
  for (const o of customOf(f.page)) {
    if (o.type !== 'thangbo' && o.type !== 'stair') continue;
    const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
    ra.push({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, ten: o.name || 'Cầu thang' });
  }
  return ra;
}

// ---- dò đường ngắn nhất (BFS trên lưới) tới cầu thang gần nhất
function doDuong() {
  wk.duong = []; wk.dich = null;
  const L = wk.luoi; if (!L) return;
  const dich = diemThoat(wk.f);
  if (!dich.length) return;
  const i0 = L.iOf(wk.x), j0 = L.jOf(wk.z);
  if (i0 < 0 || j0 < 0 || i0 >= L.nx || j0 >= L.nz) return;
  // BFS toàn bộ vùng đi được, rồi chọn Ô ĐẾN ĐƯỢC gần chân thang nhất.
  // (Chân thang thường nằm trên nét vẽ nên chính ô đó có thể bị chặn.)
  const truoc = new Int32Array(L.nx * L.nz).fill(-1);
  const tham = new Uint8Array(L.nx * L.nz);
  const q = [i0 * L.nz + j0]; tham[q[0]] = 1;
  const ke = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let h = 0; h < q.length; h++) {
    const c = q[h], ci = (c / L.nz) | 0, cj = c % L.nz;
    for (const k of ke) {
      const ni = ci + k[0], nj = cj + k[1];
      if (ni < 0 || nj < 0 || ni >= L.nx || nj >= L.nz) continue;
      const n = ni * L.nz + nj;
      if (tham[n] || !L.o[n]) continue;
      tham[n] = 1; truoc[n] = c; q.push(n);
    }
  }
  let tot = null;
  for (const c of q) {
    const x = L.xOf((c / L.nz) | 0), z = L.zOf(c % L.nz);
    for (const d of dich) {
      const dd = Math.hypot(x - d.x, z - d.z);
      if (!tot || dd < tot.dd) tot = { dd: dd, c: c, ten: d.ten };
    }
  }
  if (!tot || tot.dd > 6) {
    // Không tới được chân thang: nhiều khi cửa buồng thang có trên bản vẽ nhưng
    // nét vẽ (cánh cửa, cung quay) bịt kín ô cửa. Tìm chỗ vách MỎNG NHẤT ngăn
    // giữa vùng đang đứng và chân thang rồi mở đúng chỗ đó ra làm lối vào.
    if (moLoiVaoThang(tham, dich)) { doDuong(); }
    return;
  }
  const dsO = [];
  for (let c = tot.c; c >= 0; c = truoc[c]) dsO.push(c);
  dsO.reverse();
  wk.duong = dsO.map(c => [L.xOf((c / L.nz) | 0), L.zOf(c % L.nz)]);
  wk.dich = { ten: tot.ten, dai: (dsO.length - 1) * O_LUOI + tot.dd };
}




// ---------------------------------------------------------------------------
// BỊT KÍN HỐ THANG: quanh mỗi vế thang, phần sàn còn hụt được lấp bằng bản bê
// tông ngang mặt sàn, chỉ CHỪA ĐÚNG khe cho vế thang chui xuống. Nhờ vậy đứng
// ở cao trình trên không còn thấy mảng đen hai bên cầu thang.
// ---------------------------------------------------------------------------
function oThangCuaTang(f) {          // hình chữ nhật chiếm chỗ của từng vế thang
  const ra = [];
  const them = (fo, o) => {
    const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
    const L = Math.max(.6, Math.hypot(b[0] - a[0], b[1] - a[1]));
    const ts = thongSoThang(L, o.w || 1.26, (o.h || 3) * state.explode);
    ra.push({ x: cx, z: cz, ang: Math.atan2(b[1] - a[1], b[0] - a[0]),
              nua: ts.dai / 2 + ts.cn, ngang: ts.W / 2 });
  };
  for (const o of customOf(f.page))
    if (o.type === 'thangbo' || o.type === 'stair') them(f, o);
  const ds = state.data.floors.filter(x => x.georef !== 'standalone')
    .sort((a, b) => b.elevation - a.elevation);
  const duoi = ds.find(x => x.elevation < f.elevation);
  if (duoi) for (const o of customOf(duoi.page))
    if (o.type === 'thangbo' || o.type === 'stair') them(f, o);
  return ra;
}

function bitHoThang(f, hinh, y) {
  const os = oThangCuaTang(f);
  if (!os.length) return;
  const B = .5;                                  // ô lấp 0,5 m
  const R = 6;                                   // lấp trong bán kính 6 m quanh thang
  const fp = footprintWorld(f);
  // lỗ thông tầng do người dùng vẽ là chỗ hụt CÓ CHỦ Ý -> không lấp
  const lo = (loSanCuaTang(f) || []).filter(r => r.pts && r.pts.length >= 3);
  const trongVe = (x, z) => os.some(t => {
    const c = Math.cos(-t.ang), s2 = Math.sin(-t.ang);
    const dx = x - t.x, dz = z - t.z;
    const lx = dx * c - dz * s2, lz = dx * s2 + dz * c;
    return Math.abs(lx) <= t.nua + .15 && Math.abs(lz) <= t.ngang + .15;
  });
  for (const t of os) {
    const n = Math.ceil(R * 2 / B);
    for (let j = 0; j < n; j++) {
      let i = 0;
      const co = q => {
        const x = t.x - R + (q + .5) * B, z = t.z - R + (j + .5) * B;
        if (fp && (x < fp.x0 || x > fp.x1 || z < fp.z0 || z > fp.z1)) return false;
        if (lo.some(r => trongDaGiac(r.pts, x, z))) return false;
        return !trongVe(x, z);
      };
      while (i < n) {
        if (!co(i)) { i++; continue; }
        let k = i;
        while (k + 1 < n && co(k + 1)) k++;
        const g = new THREE.BoxGeometry((k - i + 1) * B, .3, B);
        g.translate(t.x - R + (i + (k - i + 1) / 2) * B, y - .16,
                    t.z - R + (j + .5) * B);
        hinh.push(g);
        i = k + 1;
      }
    }
  }
}


// Sau khi dựng vách xong: biển EXIT nào còn bị tường/lanh tô che thì tự đẩy ra
// khỏi mặt tường từng nấc 10 cm (tối đa 60 cm); vẫn bị che thì hạ xuống ngang
// mép trên ô cửa. Kỹ sư đặt biển thế nào thì phải NHÌN THẤY được, nên chương
// trình tự kiểm rồi tự chỉnh, không để người dùng phải bắt lỗi.
function chinhBienExit(f) {
  const nhom = [];
  exitMeshes.forEach(g => nhom.push(g));
  customMeshes.forEach(g => { if (g.userData.obj && g.userData.obj.type === 'exit') nhom.push(g); });
  const bi = (g) => {
    const p = new THREE.Vector3(); g.getWorldPosition(p);
    const h = new THREE.Vector3(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
    const o = p.clone().addScaledVector(h, 2.5);
    const rc = new THREE.Raycaster(o, p.clone().sub(o).normalize(), 0, 2.4);
    return rc.intersectObject(wkTuong, true).length + rc.intersectObject(massGroup, true).length;
  };
  for (const g of nhom) {
    if (g.userData.matTay) continue;          // người dùng đã tự chọn mặt -> giữ nguyên
    if (!bi(g)) continue;
    const h = new THREE.Vector3(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
    const p0 = g.position.clone(), goc0 = g.rotation.y;
    let xong = false;
    // MỘT biển cho mỗi vị trí: bị che thì lật sang MẶT BÊN KIA của tường trước
    g.rotation.y = goc0 + Math.PI;
    for (let k = 2; k <= 8 && !xong; k++) {          // lùi dần sang mặt bên kia
      g.position.copy(p0).addScaledVector(h, -k * .12);
      if (!bi(g)) xong = true;
    }
    if (!xong) { g.position.copy(p0); g.rotation.y = goc0; }
    for (let k = 1; k <= 6 && !xong; k++) {
      g.position.copy(p0).addScaledVector(h, k * .1);
      if (!bi(g)) xong = true;
    }
    if (!xong) {                       // hạ xuống ngay trên mép cửa
      g.position.copy(p0).addScaledVector(h, .25);
      g.position.y -= .35 * state.explode;
      if (bi(g)) { g.position.copy(p0).addScaledVector(h, .6); }
    }
  }
}

function dungVachNet(f) {
  wkTuong.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  wkTuong.clear();
  const kq = vachCuaTang(f);
  if (!kq) return false;
  const { L, hinh, y, cao } = kq;
  // TRẦN của tầng, KHOÉT LỖ trên các ô thang (cả thang lên lẫn thang xuống) —
  // không khoét thì leo thang sẽ đâm thẳng vào trần.
  const oTrong = diemThoat(f).concat(thangXuong(f));
  const B = 1.0;                                  // ô lưới trần 1 m
  const nxT = Math.ceil((L.fp.x1 - L.fp.x0 + 2) / B), nzT = Math.ceil((L.fp.z1 - L.fp.z0 + 2) / B);
  for (let j = 0; j < nzT; j++) {
    let i = 0;
    const co = q => {
      const x = L.fp.x0 - 1 + (q + .5) * B, z = L.fp.z0 - 1 + (j + .5) * B;
      return !oTrong.some(t => Math.abs(t.x - x) < 2.6 && Math.abs(t.z - z) < 2.6);
    };
    while (i < nxT) {
      if (!co(i)) { i++; continue; }
      let k = i;
      while (k + 1 < nxT && co(k + 1)) k++;
      const g = new THREE.BoxGeometry((k - i + 1) * B, .25, B);
      g.translate(L.fp.x0 - 1 + (i + (k - i + 1) / 2) * B, y + cao + .12,
                  L.fp.z0 - 1 + (j + .5) * B);
      hinh.push(g);
      i = k + 1;
    }
  }

  // Buồng thang phải KÍN: dựng thêm vách của cao trình dưới trong bán kính 9 m
  // quanh mỗi ô thang, cộng mảng sàn dưới — nếu không, nhìn xuống hố thang sẽ
  // thấy khoảng đen và thấy xuyên sang vế thang bên kia.
  const ds = state.data.floors.filter(x => x.georef !== 'standalone')
    .sort((a, b) => b.elevation - a.elevation);
  const duoi = ds.find(x => x.elevation < f.elevation);
  const oThang = thangXuong(f);
  if (duoi && oThang.length) {
    const gan = (x, z) => oThang.some(t => Math.hypot(t.x - x, t.z - z) < 9);
    const kq2 = vachCuaTang(duoi, gan);
    if (kq2) kq2.hinh.forEach(g => hinh.push(g));
    for (const t of oThang) {
      const m = new THREE.BoxGeometry(9, .3, 9);
      m.translate(t.x, floorY(duoi) - .15, t.z);
      hinh.push(m);
    }
  }
  bitHoThang(f, hinh, y);              // lấp mảng sàn hụt quanh hố thang
  if (hinh.length) {
    wkTuong.add(new THREE.Mesh(_noiHinh(hinh), MAT_VACH));   // gộp thành MỘT lệnh vẽ
    hinh.forEach(g => g.dispose());
  }
  if (renderer.shadowMap.enabled) wkTuong.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  chinhBienExit(f);                   // biển EXIT nào bị che thì tự đẩy ra chỗ thấy được
  return true;
}


// Bị nhốt trong một ô kín (buồng thang, phòng không có cửa trong dữ liệu):
// mở một lối ra chỗ rộng bên ngoài, xuyên qua mảng vách mỏng nhất.
function moLoiRaPhong(viDu) {
  const L = wk.luoi;
  if (!L) return false;
  if ((wk.soLanMo || 0) >= 3) return false;      // mỗi cao trình mở tối đa 3 lối
  wk.daMoRa = false;
  const i0 = L.iOf(wk.x), j0 = L.jOf(wk.z);
  if (i0 < 0 || j0 < 0 || i0 >= L.nx || j0 >= L.nz) return false;
  // vùng đang đứng
  const trong = new Uint8Array(L.nx * L.nz);
  const q = [i0 * L.nz + j0]; trong[q[0]] = 1;
  const ke4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let h = 0; h < q.length; h++) {
    const c = q[h], ci = (c / L.nz) | 0, cj = c % L.nz;
    for (const k of ke4) {
      const ni = ci + k[0], nj = cj + k[1];
      if (ni < 0 || nj < 0 || ni >= L.nx || nj >= L.nz) continue;
      const n = ni * L.nz + nj;
      if (trong[n] || !L.o[n]) continue;
      trong[n] = 1; q.push(n);
    }
  }
  let tongTrong = 0;
  for (let c = 0; c < L.o.length; c++) if (L.o[c]) tongTrong++;
  wk.lyDo = 'vung dang dung ' + q.length + ' o / tong ' + tongTrong;
  if (q.length > 240 || q.length > tongTrong * 0.5) return false;   // không bị nhốt
  // Dijkstra 0-1: xuyên vách giá 1, tìm ô trống NGOÀI vùng đang đứng
  const INF = 1e9;
  const gia = new Int32Array(L.nx * L.nz).fill(INF);
  const truoc = new Int32Array(L.nx * L.nz).fill(-1);
  const hang = [[], []];
  for (const c of q) { gia[c] = 0; hang[0].push(c); }
  let cuoi = -1;
  while ((hang[0].length || hang[1].length) && cuoi < 0) {
    const c = hang[0].length ? hang[0].pop() : hang[1].pop();
    const ci = (c / L.nz) | 0, cj = c % L.nz;
    if (L.o[c] && !trong[c] && gia[c] > 0) {
      const ci2 = (c / L.nz) | 0, cj2 = c % L.nz;
      let n = 0;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const u = ci2 + a, v = cj2 + b;
        if (u >= 0 && v >= 0 && u < L.nx && v < L.nz && L.o[u * L.nz + v]) n++;
      }
      if (n >= 12) { cuoi = c; break; }        // phải mở ra chỗ RỘNG, không phải ngách cụt
    }
    for (const k of ke4) {
      const ni = ci + k[0], nj = cj + k[1];
      if (ni < 0 || nj < 0 || ni >= L.nx || nj >= L.nz) continue;
      const n = ni * L.nz + nj;
      const them = L.o[n] ? 0 : 1;
      if (gia[c] + them < gia[n]) { gia[n] = gia[c] + them; truoc[n] = c; hang[them ? 1 : 0].push(n); }
    }
  }
  wk.lyDo += ' | chi phi xuyen vach = ' + (cuoi < 0 ? 'khong tim thay' : gia[cuoi]);
  if (cuoi < 0 || gia[cuoi] > 8) return false;
  let mo = 0;
  for (let c = cuoi; c >= 0 && gia[c] > 0; c = truoc[c]) {
    const ci = (c / L.nz) | 0, cj = c % L.nz;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const u = ci + a, v = cj + b;
      if (u < 0 || v < 0 || u >= L.nx || v >= L.nz) continue;
      if (!L.o[u * L.nz + v]) { L.o[u * L.nz + v] = 1; mo++; }
    }
  }
  if (!mo) return false;
  wk.daMoRa = true; wk.soLanMo = (wk.soLanMo || 0) + 1;
  hint('Buồng thang không có ô cửa trong dữ liệu — đã mở một lối ra chỗ thoáng');
  setTimeout(() => hint(''), 3500);
  return true;
}

// Mở một ô cửa xuyên qua mảng vách mỏng nhất ngăn giữa vùng đi được và chân thang.
// Trả về true nếu có mở (khi đó lưới đã đổi, cần dò đường lại).
function moLoiVaoThang(tham, dich) {
  const L = wk.luoi;
  if (!L || wk.daMo) return false;
  // Dijkstra: đi qua ô trống giá 0, xuyên qua ô đặc giá 1 -> tìm đường rẻ nhất
  const INF = 1e9;
  const gia = new Int32Array(L.nx * L.nz).fill(INF);
  const truoc = new Int32Array(L.nx * L.nz).fill(-1);
  const hang = [[], []];                        // hàng đợi 0-1
  for (let c = 0; c < tham.length; c++) if (tham[c]) { gia[c] = 0; hang[0].push(c); }
  const ke = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let cuoi = -1;
  const laDich = (i, j) => dich.some(d => Math.abs(i - L.iOf(d.x)) <= 2 && Math.abs(j - L.jOf(d.z)) <= 2);
  while ((hang[0].length || hang[1].length) && cuoi < 0) {
    const c = hang[0].length ? hang[0].pop() : hang[1].pop();
    const ci = (c / L.nz) | 0, cj = c % L.nz;
    if (laDich(ci, cj)) { cuoi = c; break; }
    for (const k of ke) {
      const ni = ci + k[0], nj = cj + k[1];
      if (ni < 0 || nj < 0 || ni >= L.nx || nj >= L.nz) continue;
      const n = ni * L.nz + nj;
      const them = L.o[n] ? 0 : 1;                // ô đặc thì tốn 1
      if (gia[c] + them < gia[n]) {
        gia[n] = gia[c] + them; truoc[n] = c;
        hang[them ? 1 : 0].push(n);
      }
    }
  }
  if (cuoi < 0 || gia[cuoi] > 6) return false;    // vách dày quá 1,8 m thì không phải cửa
  let mo = 0;
  for (let c = cuoi; c >= 0 && gia[c] > 0; c = truoc[c]) {
    const ci = (c / L.nz) | 0, cj = c % L.nz;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {   // mở rộng ~1 m cho dễ đi
      const u = ci + a, v = cj + b;
      if (u < 0 || v < 0 || u >= L.nx || v >= L.nz) continue;
      if (!L.o[u * L.nz + v]) { L.o[u * L.nz + v] = 1; mo++; }
    }
  }
  if (!mo) return false;
  wk.daMo = true;
  hint('Đã mở lối vào buồng thang tại chỗ vách mỏng nhất (bản vẽ không có ô cửa ở đây)');
  setTimeout(() => hint(''), 3500);
  return true;
}

// ---- mũi tên chỉ đường rải trên sàn + cột sáng ở chân cầu thang
const wkGroup = new THREE.Group();
scene.add(wkGroup);
const MAT_MUI = new THREE.MeshBasicMaterial({ color: 0x35d07f });
function veDuong() {
  wkGroup.clear();
  if (!wk.on || wk.duong.length < 2) return;
  const y = floorY(wk.f) + .08;
  const hinh = new THREE.ConeGeometry(.22, .6, 4);
  for (let i = 0; i < wk.duong.length - 1; i += 3) {
    const a = wk.duong[i], b = wk.duong[Math.min(i + 3, wk.duong.length - 1)];
    const m = new THREE.Mesh(hinh, MAT_MUI);
    m.position.set(a[0], y, a[1]);
    m.rotation.x = Math.PI / 2;
    m.rotation.z = -Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2;
    wkGroup.add(m);
  }
  const d = wk.duong[wk.duong.length - 1];
  const cot = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, 3, 12),
    new THREE.MeshBasicMaterial({ color: 0x35d07f, transparent: true, opacity: .35 }));
  cot.position.set(d[0], y + 1.5, d[1]);
  wkGroup.add(cot);
}

function hudDiBo() {
  const el = document.querySelector('#wkHud'); if (!el) return;
  if (!wk.on) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const tren = state.data.floors
    .filter(x => x.georef !== 'standalone' && x.elevation > wk.f.elevation)
    .sort((a, b) => a.elevation - b.elevation);
  let s = '<b>' + wk.f.name + '</b> — EL. ' + wk.f.elevation.toFixed(2) + ' m<br>';
  if (!tren.length) {
    const xd = thangXuong(wk.f);
    s += '<span style="color:#35d07f">✔ Đang ở cao trình thoát nạn trên cùng — EL. 348.00</span>';
    if (xd.length) {
      const g = xd.reduce((a, t) => {
        const d = Math.hypot(t.x - wk.x, t.z - wk.z);
        return (!a || d < a.d) ? { d: d, t: t } : a;
      }, null);
      s += '<br><span style="color:#93a4b5">Muốn xuống: tới ' + g.t.ten.slice(0, 24) +
           ' (' + g.d.toFixed(0) + ' m) rồi bấm <b>X</b></span>';
    }
  } else if (wk.dich && wk.duong.length <= 1) {
    s += '<span style="color:#35d07f">Bạn đang đứng ngay chân ' + wk.dich.ten.slice(0, 26) +
         '</span><br><span style="color:#93a4b5">Bước ra xa 3 m rồi quay lại để lên, ' +
         'hoặc bấm <b>X</b> để xuống</span>';
  } else if (wk.dich && wk.duong.length > 1) {
    const k = wk.duong[Math.min(4, wk.duong.length - 1)];
    const g = Math.atan2(k[1] - wk.z, k[0] - wk.x) + wk.yaw;
    const mui = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][((Math.round(g / (Math.PI / 4)) % 8) + 8) % 8];
    s += '<span style="color:#35d07f;font-size:22px">' + mui + '</span> ' + wk.dich.ten +
         ' — còn <b>' + wk.dich.dai.toFixed(0) + ' m</b><br>' +
         '<span style="color:#93a4b5">Lên EL. ' + tren[0].elevation.toFixed(2) +
         ' rồi tiếp tục cho tới EL. 348.00</span>' +
         '<br><span style="color:#93a4b5">Bấm <b>X</b> ở đầu thang để đi xuống</span>';
  } else {
    s += '<span style="color:#e0a33b">Không tìm được lối vào buồng thang — bản vẽ ' +
         'có thể thiếu cửa ở đây. Sang tab Thiết kế vẽ thêm cửa (phím 9) là đi được.</span>';
  }
  el.innerHTML = s;
}


// ---- ảnh gạch lát sàn 600×600 cho chế độ đi bộ (vẽ bằng canvas, không cần tệp ngoài)
let TEX_GACH = null;
function texGach() {
  if (TEX_GACH) return TEX_GACH;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9c6bd'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {                 // vân đá lấm tấm
    g.fillStyle = 'rgba(0,0,0,' + (Math.random() * .05) + ')';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = '#8f8c84'; g.lineWidth = 6;      // mạch vữa
  g.strokeRect(0, 0, 256, 256);
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256);
  g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  TEX_GACH = t;
  return t;
}

// ---- đổi vật liệu sang "trong nhà": sàn lát gạch đặc, tường đặc, không nhìn xuyên
const _vlCu = {};
function vlDiBo(bat) {
  if (bat) {
    if (!_vlCu.luu) {
      _vlCu.luu = true;
      _vlCu.slab = { o: matSlab.opacity, t: matSlab.transparent, c: matSlab.color.getHex(),
                     m: matSlab.map, v: matSlab.visible };
      _vlCu.tuong = { o: matWallShared.opacity, t: matWallShared.transparent,
                      c: matWallShared.color.getHex(), v: matWallShared.visible };
    }
    // BÓNG ĐỔ chỉ bật khi đi bộ: lúc này chỉ hiện một cao trình nên số vật ít,
    // máy văn phòng vẫn tải được; khung nhìn tổng thể (cả toà nhà) thì tắt.
    renderer.shadowMap.enabled = true;
    dir.castShadow = true;
    const batBong = (g) => g && g.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
    });
    batBong(wkTuong); batBong(customGroup); batBong(massGroup); batBong(wkThang);
    _vlCu.dat = denTroi.groundColor.getHex();
    denTroi.groundColor.setHex(0xbfbcb4);        // mặt hướng xuống cũng sáng như tường
    denTrongNha.intensity = .55;                  // ánh sáng đều trong phòng
    _vlCu.nen = scene.background ? scene.background.getHex() : 0x0e1116;
    _vlCu.fog = scene.fog ? scene.fog.color.getHex() : _vlCu.nen;
    scene.background = new THREE.Color(0x9c9890);   // nen trong nha, khong phai nen den
    if (scene.fog) scene.fog.color.setHex(0x9c9890);
    const tx = texGach();
    tx.repeat.set(1.6 * state.explode, 1.6 * state.explode);
    matSlab.map = tx; matSlab.color.setHex(0xffffff);
    matSlab.transparent = false; matSlab.opacity = 1; matSlab.needsUpdate = true;
    matWallShared.transparent = false; matWallShared.opacity = 1;
    // Thanh trượt "độ mờ tường" có thể đang để 0 -> tường tự vẽ bị ẩn hẳn.
    // Trong nhà thì luôn phải thấy tường, nên bật lại bằng được.
    matWallShared.visible = true; matSlab.visible = true;
    matWallShared.color.setHex(0xd7d2c6); matWallShared.needsUpdate = true;
    _vlCu.khac = [];
    [matDoor, MAT_CUSTOM.box, MAT_CUSTOM.tra, MAT_CUSTOM.rail, MAT_CUSTOM.stair,
     MAT_CUSTOM.roof, matCab].forEach(m => {
      if (!m) return;
      _vlCu.khac.push({ m: m, t: m.transparent, o: m.opacity });
      m.transparent = false; m.opacity = 1; m.needsUpdate = true;
    });
  } else if (_vlCu.luu) {
    matSlab.map = _vlCu.slab.m; matSlab.color.setHex(_vlCu.slab.c);
    matSlab.transparent = _vlCu.slab.t; matSlab.opacity = _vlCu.slab.o; matSlab.needsUpdate = true;
    if (_vlCu.slab.v !== undefined) matSlab.visible = _vlCu.slab.v;
    if (_vlCu.tuong.v !== undefined) matWallShared.visible = _vlCu.tuong.v;
    matWallShared.transparent = _vlCu.tuong.t; matWallShared.opacity = _vlCu.tuong.o;
    matWallShared.color.setHex(_vlCu.tuong.c); matWallShared.needsUpdate = true;
    (_vlCu.khac || []).forEach(k => {
      k.m.transparent = k.t; k.m.opacity = k.o; k.m.needsUpdate = true;
    });
    _vlCu.khac = [];
    renderer.shadowMap.enabled = false;
    dir.castShadow = false;
    if (_vlCu.dat !== undefined) { denTroi.groundColor.setHex(_vlCu.dat); denTrongNha.intensity = 0; }
    if (_vlCu.nen !== undefined) {                 // tra lai nen canh cu
      scene.background = new THREE.Color(_vlCu.nen);
      if (scene.fog) scene.fog.color.setHex(_vlCu.fog);
    }
  }
}


// ---- dựng VÁCH ĐẶC theo nét bản vẽ cho chế độ đi bộ: mọi chỗ là nét tường đều
// thành khối thật, nên nhìn không thủng và đi không xuyên qua được.
const MAT_VACH = new THREE.MeshStandardMaterial({ color: 0xd7d2c6, roughness: .88, metalness: .02 });
const MAT_TRAN = new THREE.MeshStandardMaterial({ color: 0xb9b5ab, roughness: .98,
  side: THREE.DoubleSide });
const wkTuong = new THREE.Group();
scene.add(wkTuong);

function vachCuaTang(f, gioiHan) {
  const L = luoiTuong(f);                 // lưới 0,3 m: nét tường/mực = ô chặn
  // Trước đây bỏ dựng vách khi ảnh mặt bằng CHƯA TẢI XONG (L.coMuc = false) —
  // cao trình nào ảnh nặng là vào đi bộ thấy trống trơn, nhìn xuyên hết. Tường
  // nay lấy từ bản vẽ nên không phụ thuộc ảnh nữa.
  if (!L) return null;
  // ô cửa thì chừa ra cho đi qua
  // Ô cửa đục trên vách phải ĐÚNG BẰNG bộ cửa, không nới thêm: nới ra thì hai
  // bên khung cửa hở một khoảng trống nhìn thấy rõ. (Lưới đi lại vẫn nới rộng
  // riêng cho người lọt qua — việc đó không liên quan tới hình.)
  const NOI = .03;
  const cua = [];
  for (const o of customOf(f.page)) {
    if (o.type !== 'door') continue;
    const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
    cua.push([Math.min(a[0], b[0]) - NOI, Math.min(a[1], b[1]) - NOI,
              Math.max(a[0], b[0]) + NOI, Math.max(a[1], b[1]) + NOI]);
  }
  (f.doors || []).forEach(d => {
    const a = worldXZ(f, d[0], d[1]), b = worldXZ(f, d[2], d[3]);
    cua.push([Math.min(a[0], b[0]) - NOI, Math.min(a[1], b[1]) - NOI,
              Math.max(a[0], b[0]) + NOI, Math.max(a[1], b[1]) + NOI]);
  });
  // lối vừa mở để nối mảnh cô lập: đục luôn trên vách cho khớp chỗ đi được
  if (wk.on && wk.f === f && wk.luoi && wk.luoi.moThem)
    for (const p of wk.luoi.moThem)
      cua.push([p[0] - .45, p[1] - .45, p[0] + .45, p[1] + .45]);
  const y = floorY(f);
  const cao = Math.max(1.6, floorHeight(f) * state.explode - MASS.slab);
  // Lỗ thông tầng là CHỖ HỤT SÀN, không phải tường: không dựng vách ở đó.
  const lo = (loSanCuaTang(f) || []).filter(r => r.pts && r.pts.length >= 3);
  // Lan can cũng vậy: đã có mô hình lan can riêng rồi, không đắp vách kín lên nó
  // (nét lan can trên bản vẽ là hai vạch song song, dễ bị hiểu nhầm là tường).
  const lanCan = [];
  for (const o of customOf(f.page)) {
    if (o.type !== 'rail') continue;
    const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
    lanCan.push([Math.min(a[0], b[0]) - .45, Math.min(a[1], b[1]) - .45,
                 Math.max(a[0], b[0]) + .45, Math.max(a[1], b[1]) + .45]);
  }
  const chan = (i, j) => {
    if (L.o[i * L.nz + j]) return false;             // ô trống
    const x = L.fp.x0 + (i + .5) * BUOC_SAN, z = L.fp.z0 + (j + .5) * BUOC_SAN;
    if (gioiHan && !gioiHan(x, z)) return false;     // chỉ dựng trong vùng cần
    if (lo.some(r => trongDaGiac(r.pts, x, z))) return false;
    if (lanCan.some(c => x >= c[0] && x <= c[2] && z >= c[1] && z <= c[3])) return false;
    return !cua.some(c => x >= c[0] && x <= c[2] && z >= c[1] && z <= c[3]);
  };
  const hinh = [];
  // ---- vách đặc cho cả cao trình (mọi bức tường đều không nhìn xuyên qua)
  // Vách đặc dựng cho MỌI cao trình theo đúng các bức tường trong bản vẽ hiện
  // tại (tuyenTuong đã chỉ lấy tường tự vẽ). Có lớp này thì chỗ nào có tường là
  // chắn tầm nhìn, kể cả khi tường trong bản vẽ đang để mờ.
  // ĐI BỘ = ĐÚNG BẢN VẼ: cao trình đang đứng đã có tường tự vẽ thì KHÔNG dựng
  // lại vách nữa — dùng chính các bức tường của bản vẽ (tab Xem đang hiển thị
  // đúng: ô cửa khoét đúng chỗ, lanh tô đầy đủ). Vách dựng lại chỉ dùng cho cao
  // trình chưa vẽ gì, và cho cao trình DƯỚI khi bịt buồng thang (gioiHan).
  // Tường của bản vẽ đã được ép hiện + đặc khi vào đi bộ nên không nhìn xuyên.
  const nguonVach = tuyenTuong(f);   // lớp vách đặc: chỗ nào có tường là chắn được
  const boLanCan = !coBanVeRieng(f);     // chỉ trừ lan can khi tường là nét bóc tự động
  // Ô CỬA TÍNH ĐÚNG NHƯ BẢN VẼ: chiếu bộ cửa lên tim bức tường gần nhất rồi
  // khoét đúng bề rộng cửa. Cách cũ so theo khung chữ nhật của cửa nên cửa vẽ
  // lệch tim tường vài chục cm là khoét trượt — chỗ hở toang, chỗ không khoét.
  const cuaCuaTuyen = nguonVach.map(() => []);
  const daKhoet = new Set();
  for (const c of customOf(f.page).concat(
        (f.doors || []).map(d => ({ type: 'door', _th: d })))) {
    if (c.type !== 'door') continue;
    const a = c._th ? worldXZ(f, c._th[0], c._th[1]) : worldXZ(f, c.u0, c.v0);
    const b = c._th ? worldXZ(f, c._th[2], c._th[3]) : worldXZ(f, c.u1, c.v1);
    const cd = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (cd < .2) continue;
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
    const dx = (b[0] - a[0]) / cd, dz = (b[1] - a[1]) / cd;
    let tot = null;
    nguonVach.forEach((w, i) => {
      const ux = (w.x1 - w.x0) / w.L, uz = (w.z1 - w.z0) / w.L;
      if (Math.abs(ux * dz - uz * dx) > 0.26) return;        // không song song -> bỏ
      const t = (cx - w.x0) * ux + (cz - w.z0) * uz;
      if (t < -(cd / 2 + 1) || t > w.L + cd / 2 + 1) return;
      // TƯỜNG CÓ SẴN, CỬA LÀ Ô KHOÉT: cửa vẽ lệch tim tường bao nhiêu cũng vẫn
      // khoét vào bức tường gần nhất trong 2,5 m, đúng bề rộng và chiều cao cửa.
      // CHỈ KHOÉT KHI CỬA THỰC SỰ NẰM TRÊN BỨC TƯỜNG (lệch tim ≤ nửa bề dày +
      // 0,5 m). Nới rộng hơn là đục thủng cả những bức tường cách đó mấy mét —
      // đúng kiểu "tự ý cắt bỏ tường".
      const ngang = Math.abs((cx - w.x0) * uz - (cz - w.z0) * ux);
      if (ngang > w.day / 2 + 0.5) return;
      const phu = (Math.min(w.L, t + cd / 2) - Math.max(0, t - cd / 2)) / cd;
      if (phu < 0.5) return;
      if (!tot || ngang < tot.ngang) tot = { i: i, t: t, ngang: ngang };
    });
    if (!tot) continue;
    // ghi kèm CHIỀU CAO RIÊNG của bộ cửa này (mỗi cửa một kích thước khác nhau)
    const hRieng = Math.min(cao - .05, ((c._th ? 2.1 : (c.h || 2.1))) * state.explode);
    cuaCuaTuyen[tot.i].push([tot.t - cd / 2, tot.t + cd / 2, hRieng]);
    daKhoet.add(c._th ? c._th : c);      // cửa này đã có lanh tô ngay trên tường
  }
  for (let iw = 0; iw < nguonVach.length; iw++) {
    const w = nguonVach[iw];
    const khoet = cuaCuaTuyen[iw];
    const ux = (w.x1 - w.x0) / w.L, uz = (w.z1 - w.z0) / w.L;
    const goc = -Math.atan2(uz, ux);
    // cắt bỏ đoạn trùng ô cửa / lan can / lỗ sàn: đi dọc tuyến, gom các quãng "được xây"
    const buoc = .05;                  // bước dò nhỏ -> mép ô cửa cắt đúng chỗ
    let d0 = null, c0 = null, hC0 = null;
    // đoạn tường đặc: xây suốt từ sàn lên trần
    const dat = (a, b, tu, den) => {
      if (b - a < .25 || den - tu < .05) return;
      const g = new THREE.BoxGeometry(b - a, den - tu, w.day);
      const mx = w.x0 + ux * (a + b) / 2, mz = w.z0 + uz * (a + b) / 2;
      const m = new THREE.Matrix4().makeRotationY(goc);
      m.setPosition(mx, y + (tu + den) / 2, mz);
      hinh.push(g.applyMatrix4(m));
    };
    // LANH TÔ: mảng tường phía TRÊN ô cửa. Ô cửa chỉ cao 2,1 m, phần tường từ
    // đó lên trần vẫn phải có, nếu không nhìn qua cửa là thấy hở một dải tới trần.
    const hCua = Math.min(cao - .05, 2.1 * state.explode);   // mặc định khi không rõ
    // Lanh tô PHỦ CHỜM lên khuôn cửa: rộng thêm 6 cm mỗi bên, hạ thấp 8 cm so
    // với mép trên ô cửa. Không chờm thì bước dò 5 cm để lại khe hở mảnh ở ba
    // cạnh ô cửa — đúng chỗ "còn thiếu một ít" nhìn thấy khi đứng sát cửa.
    const datCua = (a, b, h1) => dat(a - .06, b + .06,
      Math.max(.05, (h1 === undefined ? hCua : h1) - .08), cao);
    for (let t = 0; t <= w.L; t += buoc) {
      const x = w.x0 + ux * t, z = w.z0 + uz * t;
      // Ô CỬA CHỈ LẤY THEO CÁCH CỦA BẢN VẼ (chiếu bộ cửa lên tim tường). Không
      // dùng khung chữ nhật bao quanh bộ cửa nữa: cửa vẽ lệch tim tường thì khung
      // đó cắt trúng chỗ khác, để lại lỗ hổng ngay CẠNH khuôn cửa.
      const kCua = khoet.find(k => t >= k[0] && t <= k[1]);
      const laCua = !!kCua ||
                    (wk.luoi && wk.luoi.moThem || []).some(q =>
                      Math.abs(x - q[0]) < .45 && Math.abs(z - q[1]) < .45);
      // Chỗ THẬT SỰ không có tường: ngoài phạm vi, hoặc lỗ thông sàn.
      const trong0 = (gioiHan && !gioiHan(x, z)) || lo.some(r => trongDaGiac(r.pts, x, z));
      // Lan can: CHỈ dùng để loại nét lan can khi nguồn là nét bóc tự động. Nếu
      // cao trình đã có bản vẽ riêng thì bức tường là do bạn vẽ — có lan can chạy
      // cạnh cũng không được xoá tường đi (buồng thang hay bị mất hẳn một bức
      // vì lan can thang chạy sát tường).
      const laLanCan = boLanCan &&
        lanCan.some(c => x >= c[0] && x <= c[2] && z >= c[1] && z <= c[3]);
      const bo = laCua || laLanCan || trong0;
      if (bo) { if (d0 !== null) { dat(d0, t - buoc, 0, cao); d0 = null; } }
      else if (d0 === null) d0 = t;
      // Lanh tô: chỉ xây trên Ô CỬA. Lan can vẫn để trống suốt chiều cao (đó là
      // mép sàn thông thoáng, không phải tường) — kể cả khi ô cửa nằm lọt trong
      // vùng nới của lan can thì phần trên cửa vẫn phải có tường.
      if (laCua && !trong0) { if (c0 === null) { c0 = t; hC0 = kCua ? kCua[2] : hCua; } }
      else if (c0 !== null) { datCua(c0, t - buoc, hC0); c0 = null; }
    }
    if (d0 !== null) dat(d0, w.L, 0, cao);
    if (c0 !== null) datCua(c0, w.L, hC0);
  }
  // ---- thêm vách theo nét mực của ảnh (chỉ cho cao trình chưa có bản vẽ riêng)
  for (let j = 0; !coBanVeRieng(f) && j < L.nz; j++) {
    let i = 0;
    while (i < L.nx) {
      if (!chan(i, j)) { i++; continue; }
      let k = i;
      while (k + 1 < L.nx && chan(k + 1, j)) k++;
      const w = (k - i + 1) * BUOC_SAN;
      const g = new THREE.BoxGeometry(w, cao, BUOC_SAN);
      g.translate(L.fp.x0 + (i + (k - i + 1) / 2) * BUOC_SAN, y + cao / 2,
                  L.fp.z0 + (j + .5) * BUOC_SAN);
      hinh.push(g);
      i = k + 1;
    }
  }
  // (Không tự dựng tường bao buồng thang: tường là do bản vẽ của người dùng.
  //  Thay vào đó vế thang được nới rộng ra SÁT hai bức tường đã vẽ — xem
  //  rongThangTheoTuong().)
  // ---- VỊ TRÍ CỬA = TƯỜNG, rồi KHOÉT ĐÚNG KÍCH THƯỚC CỬA
  // Mỗi bộ cửa được coi như một mảnh tường đặc ngay tại chỗ nó đứng, rộng đúng
  // bề rộng cửa, cao hết tầng; phần từ sàn lên tới chiều cao cửa được khoét đi
  // làm ô cửa. Vậy phía trên và hai bên ô cửa luôn là tường, không bao giờ hở.
  {
    const ds = customOf(f.page).filter(o => o.type === 'door')
      .map(o => [worldXZ(f, o.u0, o.v0), worldXZ(f, o.u1, o.v1), o])
      .concat((f.doors || []).map(d => [worldXZ(f, d[0], d[1]), worldXZ(f, d[2], d[3]), null]));
    for (const [a, b, o] of ds) {
      const rong = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const hC = Math.min(cao - .05, ((o && o.h) ? o.h : 2.1) * state.explode);
      if (rong < .2 || cao - hC < .05) continue;
      const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
      if (gioiHan && !gioiHan(cx, cz)) continue;
      if (lo.some(r => trongDaGiac(r.pts, cx, cz))) continue;
      let day = .22, gan = 1e9, wux = 0, wuz = 0, wx0 = 0, wz0 = 0;
      for (const w of nguonVach) {                 // tường gần nhất: bề dày + trục
        const ux = (w.x1 - w.x0) / w.L, uz = (w.z1 - w.z0) / w.L;
        const t = Math.max(0, Math.min(w.L, (cx - w.x0) * ux + (cz - w.z0) * uz));
        const dd = Math.hypot(cx - (w.x0 + ux * t), cz - (w.z0 + uz * t));
        if (dd < gan) { gan = dd; day = w.day; wux = ux; wuz = uz; wx0 = w.x0; wz0 = w.z0; }
      }
      // TƯỜNG CHỈ Ở KHUNG CỬA, KHÔNG Ở CÁNH CỬA: nét cửa trong bản vẽ nhiều khi
      // là CÁNH mở 90° (vuông góc với tường). Khi đó khung cửa nằm dọc theo
      // tường, bắt đầu từ bản lề — phải đắp theo hướng tường, không theo hướng
      // cánh, nếu không mảng tường sẽ đứng chình ình trên cánh cửa.
      // Không có bức tường nào trong 2,5 m thì KHÔNG đắp gì: chỗ đó vốn không có
      // tường, và cũng không biết khung cửa quay hướng nào — đắp bừa là ra mảng
      // tường dính trên cánh cửa.
      if (gan > 0.9) continue;        // cửa không nằm trên tường nào -> không đụng vào tường
      let px = cx, pz = cz, goc = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      {
        const dx = (b[0] - a[0]) / rong, dz = (b[1] - a[1]) / rong;
        const cheo = Math.abs(dx * wuz - dz * wux);      // 0 = song song, 1 = vuông góc
        if (cheo > 0.5) {                                // nét cửa là CÁNH
          const ban = a;                                 // bản lề
          const chieu = ((cx - ban[0]) * wux + (cz - ban[1]) * wuz) >= 0 ? 1 : -1;
          px = ban[0] + wux * chieu * rong / 2;
          pz = ban[1] + wuz * chieu * rong / 2;
          goc = -Math.atan2(wuz, wux);
        }
      }
      // CHỐT CHẶN: kéo mảng tường về ĐÚNG TIM BỨC TƯỜNG. Dù nét cửa nghiêng ngả
      // thế nào, mảng luôn nằm trong mặt phẳng tường, không thể đè lên cánh cửa.
      {
        const tt = (px - wx0) * wux + (pz - wz0) * wuz;
        px = wx0 + wux * tt; pz = wz0 + wuz * tt;
        goc = -Math.atan2(wuz, wux);
      }
      const g = new THREE.BoxGeometry(rong, cao - hC + .08, Math.max(.12, day * .96));
      const m = new THREE.Matrix4().makeRotationY(goc);
      m.setPosition(px, y + (hC - .08 + cao) / 2, pz);
      hinh.push(g.applyMatrix4(m));
    }
  }
  return { L: L, hinh: hinh, y: y, cao: cao };
}



// dựng hình các vế thang từ cao trình dưới lên, để đứng ở tầng trên nhìn thấy
const wkThang = new THREE.Group();
scene.add(wkThang);
function dungThangDuoi(f) {
  wkThang.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  wkThang.clear();
  const ds = state.data.floors.filter(x => x.georef !== 'standalone')
    .sort((a, b) => b.elevation - a.elevation);
  const duoi = ds.find(x => x.elevation < f.elevation);
  if (!duoi) return;
  const y = floorY(duoi);
  for (const o of customOf(duoi.page)) {
    if (o.type !== 'thangbo' && o.type !== 'stair') continue;
    const a = worldXZ(duoi, o.u0, o.v0), b = worldXZ(duoi, o.u1, o.v1);
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const ve = Math.max(.6, Math.hypot(dx, dz));
    const m = gopNhom(makeStairTower(ve, rongThangTheoTuong(duoi, o), (o.h || 3) * state.explode, false));
    m.position.set((a[0] + b[0]) / 2, y + (o.base || 0) * state.explode, (a[1] + b[1]) / 2);
    m.rotation.y = -Math.atan2(dz, dx) + (o.rot || 0);
    wkThang.add(m);
  }
}

function vaoDiBo() {
  const f = activeFloorObj();
  wk.f = f; wk.on = true;
  wk.luoi = dungLuoi(f); wk.daMo = false; wk.daMoRa = false; wk.soLanMo = 0;
  const fp = footprintWorld(f);
  wk.x = (fp.x0 + fp.x1) / 2; wk.z = (fp.z0 + fp.z1) / 2;
  // Đứng vào chỗ THOÁNG nhất gần tâm, không phải ô trống đầu tiên gặp, để khỏi
  // bị kẹt cứng giữa hai vách ngay lúc vào.
  if (wk.luoi) {
    const L = wk.luoi;
    const thoang = (i, j) => {
      let n = 0;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const u = i + a, v = j + b;
        if (u < 0 || v < 0 || u >= L.nx || v >= L.nz) continue;
        if (L.o[u * L.nz + v]) n++;
      }
      return n;                                   // tối đa 25 ô (~3 × 3 m)
    };
    let tot = null;
    for (let i = 0; i < L.nx; i++) for (let j = 0; j < L.nz; j++) {
      if (!L.o[i * L.nz + j]) continue;
      const x = L.xOf(i), z = L.zOf(j);
      const d = Math.hypot(x - wk.x, z - wk.z);
      const th = thoang(i, j);
      if (th < 18) continue;                      // chỗ chật thì bỏ qua
      const diem = d - th * 1.5;
      if (!tot || diem < tot.diem) tot = { diem: diem, x: x, z: z };
    }
    if (!tot) {                                   // không có chỗ thoáng -> lấy ô trống gần tâm
      for (let i = 0; i < L.nx; i++) for (let j = 0; j < L.nz; j++) {
        if (!L.o[i * L.nz + j]) continue;
        const x = L.xOf(i), z = L.zOf(j), d = Math.hypot(x - wk.x, z - wk.z);
        if (!tot || d < tot.diem) tot = { diem: d, x: x, z: z };
      }
    }
    if (tot) { wk.x = tot.x; wk.z = tot.z; }
  }
  wk.yaw = 0; wk.pitch = 0; wk.leo = null;
  // chỉ hiện đúng cao trình đang đứng -> không nhìn thấy các cao trình khác
  wk.visCu = new Set(state.visible);
  wk.massCu = state.massing;
  wk.planCu = state.showPlan;
  state.visible = new Set([f.page]);
  state.massing = true; state.showPlan = false;
  vlDiBo(true);
  applyVisibility();
  if (typeof syncFloorRows === 'function') syncFloorRows();
  camera = camPersp; controls.object = camPersp; controls.enabled = false;
  camPersp.fov = 70; camPersp.updateProjectionMatrix();
  dungVachNet(f);
  dungThangDuoi(f);                 // thấy vế thang đi xuống
  rebuildCustom();                  // bỏ gờ lỗ thông tầng khi đang đi bộ
  rebuildMasses();                  // khoét sàn quanh đầu thang
  doDuong(); veDuong(); hudDiBo();
  if (!_muc[f.page]) {                      // ảnh nét đang nạp -> dựng lại lưới khi xong
    let n = 0;
    const cho = setInterval(() => {
      // Đã đổi sang cao trình khác (lên/xuống thang) thì BỎ, nếu không lưới của
      // cao trình cũ sẽ ghi đè lên lưới hiện tại -> người bị nhốt hoặc đi xuyên.
      if (!wk.on || wk.f !== f || ++n > 30) { clearInterval(cho); return; }
      if (!_muc[f.page]) return;
      clearInterval(cho);
      wk.luoi = dungLuoi(f);
      dungVachNet(f);
      doDuong(); veDuong(); hudDiBo();
    }, 200);
  }
  const btn = document.querySelector('#walk'); if (btn) btn.classList.add('on');
  if (renderer.domElement.requestPointerLock) {
    const r = renderer.domElement.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  }
  hint('Đi bộ: W/A/S/D hoặc mũi tên · Shift chạy · tới chân thang là TỰ LÊN · bấm X để XUỐNG · Esc thoát');
}

// Đổi cao trình trong lúc ĐANG đi bộ: phải dựng lại vách, lưới đi lại, thang và
// đặt người vào chỗ thoáng của cao trình mới. Trước đây chỉ đổi tầng hiển thị,
// còn vách vẫn là của cao trình cũ -> đứng giữa khoảng không, nhìn xuyên hết.
function doiTangDiBo(f) {
  if (!f || (wk.f && wk.f.page === f.page)) return;
  wk.f = f; wk.leo = null; wk.khoaThang = true;
  wk.luoi = dungLuoi(f); wk.daMo = false; wk.daMoRa = false; wk.soLanMo = 0;
  const fp = footprintWorld(f);
  if (fp) {
    const t = choThoang(wk.luoi, (fp.x0 + fp.x1) / 2, (fp.z0 + fp.z1) / 2) ||
              choThoang(wk.luoi, (fp.x0 + fp.x1) / 2, (fp.z0 + fp.z1) / 2, 8);
    if (t) { wk.x = t.x; wk.z = t.z; }
  }
  state.visible = new Set([f.page]);
  applyVisibility();
  dungVachNet(f);
  dungThangDuoi(f);
  rebuildCustom(); rebuildMasses();
  doDuong(); veDuong(); hudDiBo();
  if (typeof veLai === 'function') veLai();
}

function raDiBo() {
  wk.on = false; wk.leo = null; wkGroup.clear();
  wkTuong.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  wkTuong.clear();
  hudDiBo();
  vlDiBo(false);
  if (wk.visCu) { state.visible = wk.visCu; wk.visCu = null; }
  if (wk.massCu !== undefined) state.massing = wk.massCu;
  if (wk.planCu !== undefined) state.showPlan = wk.planCu;
  applyVisibility();
  if (typeof syncFloorRows === 'function') syncFloorRows();
  controls.enabled = true;
  camPersp.fov = 45; camPersp.updateProjectionMatrix();
  wkThang.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  wkThang.clear();
  rebuildCustom();                  // trả lại gờ lỗ thông tầng
  rebuildMasses();                  // trả lại sàn nguyên vẹn
  const btn = document.querySelector('#walk'); if (btn) btn.classList.remove('on');
  if (document.exitPointerLock) document.exitPointerLock();
  hint('');
}

addEventListener('keydown', function (e) {
  if (!wk.on) return;
  if (e.key === 'Escape') {
    if (wk.leo) { wk.leo = null; wk.khoaThang = true; doDuong(); veDuong(); hudDiBo(); return; }
    raDiBo(); return;
  }
  if (e.key === 'x' || e.key === 'X') {            // X = đi XUỐNG cao trình dưới
    const ds = thangXuong(wk.f);
    let gan = null;
    for (const t of ds) {
      const d = Math.hypot(t.x - wk.x, t.z - wk.z);
      if (!gan || d < gan.d) gan = { d: d, t: t };
    }
    if (gan && gan.d < 6) {
      const duoi = gan.t.tang;
      let ve = null, tot = 1e9;
      for (const o of customOf(duoi.page)) {
        if (o.type !== 'thangbo' && o.type !== 'stair') continue;
        const a = worldXZ(duoi, o.u0, o.v0), b = worldXZ(duoi, o.u1, o.v1);
        const dd = Math.hypot((a[0] + b[0]) / 2 - wk.x, (a[1] + b[1]) / 2 - wk.z);
        if (dd < tot) { tot = dd; ve = o; }
      }
      if (ve) batDauLeo(ve, duoi, -1, ve.name); else xuongThang(gan.t.ten);
    }
    else if (gan) {
      hint('Còn ' + gan.d.toFixed(0) + ' m nữa tới ' + gan.t.ten.slice(0, 26) +
           ' — lại gần rồi bấm X để xuống');
      setTimeout(() => hint(''), 2600);
    } else {
      hint('Cao trình này không có thang đi xuống');
      setTimeout(() => hint(''), 2200);
    }
    return;
  }
  wk.phim[e.key.toLowerCase()] = true;
  const dt = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  if (dt.indexOf(e.key.toLowerCase()) >= 0) e.preventDefault();
});
addEventListener('keyup', function (e) { if (wk.on) wk.phim[e.key.toLowerCase()] = false; });
// Xoay hướng nhìn: bình thường dùng pointer lock. Nhưng chuột có thể rời khoá
// bất cứ lúc nào (bấm ra ngoài khung 3D, chuyển cửa sổ, trình duyệt từ chối) —
// khi đó vẫn cho xoay theo chuột rê trên khung 3D để không bị "chết" hướng nhìn.
addEventListener('mousemove', function (e) {
  if (!wk.on) return;
  const khoa = document.pointerLockElement === renderer.domElement;
  if (!khoa && e.target !== renderer.domElement) return;
  wk.yaw -= (e.movementX || 0) * .0024;
  wk.pitch = Math.max(-1.2, Math.min(1.2, wk.pitch - (e.movementY || 0) * .0024));
  if (typeof veLai === 'function') veLai();
});
// bấm lại vào khung 3D thì xin khoá chuột lại
renderer.domElement.addEventListener('mousedown', function () {
  if (wk.on && document.pointerLockElement !== renderer.domElement &&
      renderer.domElement.requestPointerLock) {
    const r = renderer.domElement.requestPointerLock();
    if (r && r.catch) r.catch(() => {});          // trình duyệt từ chối thì thôi
  }
});
document.addEventListener('pointerlockerror', () => {
  if (wk.on) hint('Trình duyệt không khoá được chuột — rê chuột trên khung 3D để xoay hướng nhìn');
});



// Sau khi lên/xuống thang, đứng ở ĐẦU CHIẾU của vế thang (phía thông ra vùng
// rộng nhất) thay vì đứng giữa vế: từ đó bước thẳng ra hành lang, ra cửa được.
function vungRong(L, x, z, tran) {
  if (!L) return 0;
  const i0 = L.iOf(x), j0 = L.jOf(z);
  if (i0 < 0 || j0 < 0 || i0 >= L.nx || j0 >= L.nz || !L.o[i0 * L.nz + j0]) return 0;
  const tham = new Uint8Array(L.nx * L.nz);
  const q = [i0 * L.nz + j0]; tham[q[0]] = 1;
  const ke = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let h = 0; h < q.length && q.length < (tran || 400); h++) {
    const c = q[h], ci = (c / L.nz) | 0, cj = c % L.nz;
    for (const k of ke) {
      const ni = ci + k[0], nj = cj + k[1];
      if (ni < 0 || nj < 0 || ni >= L.nx || nj >= L.nz) continue;
      const n = ni * L.nz + nj;
      if (tham[n] || !L.o[n]) continue;
      tham[n] = 1; q.push(n);
    }
  }
  return q.length;
}

function viTriRaThang(f, ten) {
  const ma = (ten || '').match(/CT\.\d/);
  let o = null;
  for (const c of customOf(f.page)) {
    if (c.type !== 'thangbo' && c.type !== 'stair') continue;
    if (!o) o = c;
    if (ma && (c.name || '').indexOf(ma[0]) >= 0) { o = c; break; }
  }
  if (!o || !wk.luoi) return null;
  const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
  const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
  const L0 = Math.max(.6, Math.hypot(b[0] - a[0], b[1] - a[1]));
  const ts = thongSoThang(L0, o.w || 1.26, (o.h || 3) * state.explode);
  const ux = (b[0] - a[0]) / L0, uz = (b[1] - a[1]) / L0;
  const d = ts.dai / 2 + ts.cn * .6;
  const thu = [[cx + ux * d, cz + uz * d], [cx - ux * d, cz - uz * d], [cx, cz]];
  let tot = null;
  for (const p of thu) {
    const t = choThoang(wk.luoi, p[0], p[1], 6) || { x: p[0], z: p[1] };
    const n = vungRong(wk.luoi, t.x, t.z);
    if (!tot || n > tot.n) tot = { x: t.x, z: t.z, n: n };
  }
  return tot;
}

// ---- tới chân thang thì LEO LÊN cao trình trên: đổi tầng, dựng lại vách/lưới,
// đặt người ngay đầu thang của tầng mới rồi tính tiếp đường lên EL. 348.00.

// chỗ đứng tốt: ô trống, quanh nó thoáng, và gần điểm mong muốn nhất
function choThoang(L, x0, z0, toiThieu) {
  if (!L) return null;
  const min = toiThieu === undefined ? 18 : toiThieu;
  const thoang = (i, j) => {
    let n = 0;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const u = i + a, v = j + b;
      if (u < 0 || v < 0 || u >= L.nx || v >= L.nz) continue;
      if (L.o[u * L.nz + v]) n++;
    }
    return n;
  };
  let tot = null;
  for (let i = 0; i < L.nx; i++) for (let j = 0; j < L.nz; j++) {
    if (!L.o[i * L.nz + j]) continue;
    const x = L.xOf(i), z = L.zOf(j);
    const th = thoang(i, j);
    if (th < min) continue;
    const d = Math.hypot(x - x0, z - z0);
    if (!tot || d < tot.d) tot = { d: d, x: x, z: z, th: th };
  }
  return tot;
}

function leoThang(ten) {
  const ds = state.data.floors.filter(x => x.georef !== 'standalone')
    .sort((a, b) => a.elevation - b.elevation);
  const tren = ds.find(x => x.elevation > wk.f.elevation);
  if (!tren) return;
  const cu = wk.f;
  state.activeFloor = tren.page;
  state.visible = new Set([tren.page]);
  applyVisibility();
  if (typeof syncFloorRows === 'function') syncFloorRows();
  wk.f = tren;
  wk.luoi = dungLuoi(tren); wk.daMo = false; wk.daMoRa = false; wk.soLanMo = 0;
  dungVachNet(tren);
  dungThangDuoi(tren);
  rebuildCustom(); rebuildMasses();
  // đứng ở đầu thang tương ứng trên tầng mới, nếu không có thì giữ nguyên chỗ cũ
  let dat = null;
  const thangTren = diemThoat(tren);
  const ma = (ten || '').match(/CT\.\d/);
  if (ma) dat = thangTren.find(t => t.ten.indexOf(ma[0]) >= 0) || null;
  if (!dat && thangTren.length) dat = thangTren[0];
  let x = dat ? dat.x : wk.x, z = dat ? dat.z : wk.z;
  const ra0 = viTriRaThang(tren, ten);            // ra đầu chiếu, phía thoáng nhất
  if (ra0 && ra0.n > 8) { x = ra0.x; z = ra0.z; }
  if (wk.luoi && !wk.luoi.trong(x, z)) {          // chân thang nằm trên nét -> lùi ra ô trống cạnh đó
    const L = wk.luoi; let tot = null;
    for (let i = 0; i < L.nx; i++) for (let j = 0; j < L.nz; j++) {
      if (!L.o[i * L.nz + j]) continue;
      const a = L.xOf(i), b = L.zOf(j), dd = Math.hypot(a - x, b - z);
      if (!tot || dd < tot.dd) tot = { dd: dd, x: a, z: b };
    }
    if (tot) { x = tot.x; z = tot.z; }
  }
  wk.x = x; wk.z = z;
  for (let i = 0; i < 3; i++) if (!moLoiRaPhong()) break;   // mở tới khi hết bị nhốt
  doDuong();
  if (!wk.dich) {                       // chỗ vừa lên bị kẹt -> ra chỗ thoáng gần nhất
    const t = choThoang(wk.luoi, x, z) || choThoang(wk.luoi, x, z, 8);
    if (t) { wk.x = t.x; wk.z = t.z; doDuong(); }
  }
  veDuong(); hudDiBo();
  hint('Đã lên ' + tren.name + ' — EL. ' + tren.elevation.toFixed(2) + ' m');
  setTimeout(() => hint(''), 2500);
}


// Thang đi XUỐNG của một cao trình chính là các vế thang của cao trình NGAY DƯỚI
// (đầu trên của chúng đổ ra đúng sàn này). EL. 348.00 không có vế thang nào của
// riêng nó, nên trước đây đứng trên cùng là hết đường xuống.
function thangXuong(f) {
  const ds = state.data.floors.filter(x => x.georef !== 'standalone')
    .sort((a, b) => b.elevation - a.elevation);
  const duoi = ds.find(x => x.elevation < f.elevation);
  if (!duoi) return [];
  const ra = [];
  for (const o of customOf(duoi.page)) {
    if (o.type !== 'thangbo' && o.type !== 'stair') continue;
    const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
    ra.push({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, ten: o.name || 'Cầu thang', tang: duoi });
  }
  return ra;
}

function xuongThang(ten) {
  const ds = thangXuong(wk.f);
  if (!ds.length) { hint('Cao trình này không có thang đi xuống'); setTimeout(() => hint(''), 2000); return; }
  const duoi = ds[0].tang;
  state.activeFloor = duoi.page;
  state.visible = new Set([duoi.page]);
  applyVisibility();
  if (typeof syncFloorRows === 'function') syncFloorRows();
  wk.f = duoi;
  wk.luoi = dungLuoi(duoi); wk.daMo = false; wk.daMoRa = false; wk.soLanMo = 0;
  dungVachNet(duoi);
  dungThangDuoi(duoi);
  rebuildCustom(); rebuildMasses();
  let dat = null;
  const ma = (ten || '').match(/CT\.\d/);
  const thangDuoi = diemThoat(duoi);
  if (ma) dat = thangDuoi.find(t => t.ten.indexOf(ma[0]) >= 0) || null;
  if (!dat && thangDuoi.length) dat = thangDuoi[0];
  let x = dat ? dat.x : wk.x, z = dat ? dat.z : wk.z;
  const ra0 = viTriRaThang(duoi, ten);            // ra đầu chiếu, phía thoáng nhất
  if (ra0 && ra0.n > 8) { x = ra0.x; z = ra0.z; }
  if (wk.luoi && !wk.luoi.trong(x, z)) {
    const t = choThoang(wk.luoi, x, z) || choThoang(wk.luoi, x, z, 8);
    if (t) { x = t.x; z = t.z; }
  }
  wk.x = x; wk.z = z;
  for (let i = 0; i < 3; i++) if (!moLoiRaPhong()) break;   // mở tới khi hết bị nhốt
  doDuong();
  if (!wk.dich) {
    const t = choThoang(wk.luoi, x, z) || choThoang(wk.luoi, x, z, 8);
    if (t) { wk.x = t.x; wk.z = t.z; doDuong(); }
  }
  veDuong(); hudDiBo();
  hint('Đã xuống ' + duoi.name + ' — EL. ' + duoi.elevation.toFixed(2) + ' m');
  setTimeout(() => hint(''), 2500);
}


// ---------------------------------------------------------------------------
// LEO THANG TỪNG BẬC: dựng đường đi bám đúng hình học các vế thang (giống hệt
// cách makeStairTower dựng bậc), rồi cho người men theo đường đó, lên/xuống dần
// từng nấc thay vì nhảy tầng.
// ---------------------------------------------------------------------------
function duongLeo(o, fTang) {
  const a = worldXZ(fTang, o.u0, o.v0), b = worldXZ(fTang, o.u1, o.v1);
  const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
  const ang = -Math.atan2(b[1] - a[1], b[0] - a[0]) + (o.rot || 0);
  const veDai = Math.max(.6, Math.hypot(b[0] - a[0], b[1] - a[1]));
  const ts = thongSoThang(veDai, o.w || 1.26, (o.h || 3) * state.explode);
  const W = ts.W, BAC = ts.BAC, nVe = ts.nVe, soVe = ts.soVe, r = ts.r, dai = ts.dai;
  const beVe = ts.ve;
  const y0 = floorY(fTang) + (o.base || 0) * state.explode;
  const cn = ts.cn;                             // bề rộng chiếu nghỉ
  const ds = [];
  const dat = (lx, ly, lz) => {                  // local -> world
    const c = Math.cos(ang), s2 = Math.sin(ang);
    ds.push([cx + lx * c - lz * s2, ly, cz + lx * s2 + lz * c]);
  };
  let y = y0, huong = 1;
  for (let v = 0; v < soVe; v++) {
    const z = huong > 0 ? -beVe / 2 : beVe / 2;
    const x0 = huong > 0 ? -dai / 2 : dai / 2;
    dat(x0, y, z);
    y += nVe * r;
    dat(x0 + huong * dai, y, z);
    if (v < soVe - 1) {                          // vòng qua chiếu nghỉ
      dat(x0 + huong * (dai + cn * .5), y, z * .3);
      dat(x0 + huong * (dai + cn * .5), y, -z * .8);
    }
    huong = -huong;
  }
  // bước hẳn lên chiếu tới ngang mặt sàn tầng trên rồi mới rời thang
  const huongCuoi = (soVe % 2) ? 1 : -1;
  const xCuoi = huongCuoi > 0 ? dai / 2 : -dai / 2;
  dat(xCuoi + huongCuoi * cn * .8, y, 0);
  {                                            // và bắt đầu từ chiếu đi ở tầng dưới
    const c = Math.cos(ang), s2 = Math.sin(ang);
    const lx = -dai / 2 - cn * .8, lz = -beVe / 2;
    ds.unshift([cx + lx * c - lz * s2, y0, cz + lx * s2 + lz * c]);
  }
  return { ds: ds, r: r, bac: BAC, nVe: nVe };
}

// bắt đầu leo: huong = +1 lên, -1 xuống
function batDauLeo(o, fTang, huong, ten) {
  const kq = duongLeo(o, fTang);
  const ds = kq.ds;
  if (ds.length < 2) return false;
  wk.leo = { ds: huong > 0 ? ds : ds.slice().reverse(), i: 0, t: 0, huong: huong,
             r: kq.r, nVe: kq.nVe, s: 0, ten: ten || o.name };
  hint((huong > 0 ? 'Đang lên ' : 'Đang xuống ') + (ten || o.name || 'cầu thang') +
       ' — giữ nguyên, người tự bước từng bậc');
  return true;
}

// mỗi khung hình đi thêm một đoạn trên đường leo
function buocLeo(dt) {
  const L = wk.leo;
  // người leo thang thật đi chậm hơn đi trên sàn: ~0,85 m/s dọc theo mặt dốc
  const toc = (wk.phim['shift'] ? 3.2 : 1.8) * state.explode * dt;
  let con = toc;
  while (con > 0 && L.i < L.ds.length - 1) {
    const p = L.ds[L.i], q = L.ds[L.i + 1];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    const conLai = d * (1 - L.t);
    if (con < conLai) { L.t += con / d; con = 0; }
    else { con -= conLai; L.i++; L.t = 0; }
  }
  const i = Math.min(L.i, L.ds.length - 2);
  const p = L.ds[i], q = L.ds[i + 1], t = L.t;
  wk.x = p[0] + (q[0] - p[0]) * t;
  wk.z = p[2] + (q[2] - p[2]) * t;
  // Trên vế thang thì độ cao NHẢY TỪNG BẬC chứ không trượt đều như dốc:
  // đặt chân lên bậc nào thì mắt ở đúng cao độ bậc đó.
  const dy = q[1] - p[1];
  let y;
  if (Math.abs(dy) > 0.05 && L.nVe > 0) {
    const nac = Math.floor(t * L.nVe + (L.huong > 0 ? 0.35 : 0.65));
    y = p[1] + dy * Math.min(1, Math.max(0, nac / L.nVe));
  } else {
    y = p[1] + dy * t;                            // chiếu nghỉ: phẳng
  }
  L.s += toc;
  const nhun = Math.sin(L.s * 7.5) * 0.018 * state.explode;   // nhún theo nhịp bước
  wk.yaw = -Math.atan2(q[2] - p[2], q[0] - p[0]) - Math.PI / 2;
  camPersp.position.set(wk.x, y + CAO_MAT * state.explode + nhun, wk.z);
  camPersp.rotation.order = 'YXZ';
  camPersp.rotation.set(wk.pitch, wk.yaw, 0);
  const el = document.querySelector('#wkHud');
  if (el) {
    const phan = Math.round(((L.i + L.t) / Math.max(1, L.ds.length - 1)) * 100);
    el.style.display = 'block';
    el.innerHTML = '<b>' + (L.huong > 0 ? 'Đang lên' : 'Đang xuống') + '</b> ' +
      L.ten.slice(0, 34) + '<br><span style="color:#35d07f">' + phan + '%</span>' +
      ' <span style="color:#93a4b5">· giữ Shift đi nhanh · Esc dừng</span>';
  }
  // Hết đường: khi chỉ số đoạn chạy tới đoạn cuối (lúc đó L.t bị đặt lại 0 nên
  // KHÔNG được chỉ dựa vào L.t, nếu không sẽ leo mãi không bao giờ tới nơi).
  if (L.i >= L.ds.length - 1 || (L.i === L.ds.length - 2 && L.t > .98)) {
    const huong = L.huong, ten = L.ten;
    wk.leo = null; wk.khoaThang = true;
    if (huong > 0) leoThang(ten); else xuongThang(ten);
  }
}

function buocDiBo(dt) {
  if (!wk.on) return;
  if (wk.leo) { buocLeo(dt); return; }
  const p = wk.phim;
  let tx = 0, tz = 0;
  if (p['w'] || p['arrowup']) tz += 1;
  if (p['s'] || p['arrowdown']) tz -= 1;
  if (p['a'] || p['arrowleft']) tx -= 1;
  if (p['d'] || p['arrowright']) tx += 1;
  const v = (p['shift'] ? 3.4 : 1.5) * dt * state.explode;
  if (tx || tz) {
    const L = Math.hypot(tx, tz);
    const sx = Math.sin(wk.yaw), cy = Math.cos(wk.yaw);
    const dx = (tz / L) * -sx + (tx / L) * cy;
    const dz = (tz / L) * -cy - (tx / L) * sx;
    const nx = wk.x + dx * v, nz = wk.z + dz * v;
    const ok = (x, z) => !wk.luoi || wk.luoi.trong(x, z);
    if (ok(nx, wk.z)) wk.x = nx;                   // trượt dọc tường thay vì dính cứng
    if (ok(wk.x, nz)) wk.z = nz;
    // tới sát chân thang -> bước lên từng bậc. Sau khi vừa lên/xuống xong thì
    // phải rời khỏi khu vực thang (3,5 m) rồi quay lại mới leo tiếp, để không bị
    // cuốn lên thẳng một mạch tới cao trình trên cùng.
    let gan = null, xa = 1e9;
    for (const o of customOf(wk.f.page)) {
      if (o.type !== 'thangbo' && o.type !== 'stair') continue;
      const a = worldXZ(wk.f, o.u0, o.v0), b = worldXZ(wk.f, o.u1, o.v1);
      const d = Math.hypot((a[0] + b[0]) / 2 - wk.x, (a[1] + b[1]) / 2 - wk.z);
      if (d < xa) { xa = d; gan = o; }
    }
    if (wk.khoaThang && xa > 3.5) wk.khoaThang = false;
    if (gan && xa < 2.2 && !wk.khoaThang) { batDauLeo(gan, wk.f, 1, gan.name); return; }
    if (++wk.lan % 12 === 0) { doDuong(); veDuong(); }
    hudDiBo();
  }
  camPersp.position.set(wk.x, floorY(wk.f) + CAO_MAT * state.explode, wk.z);
  camPersp.rotation.order = 'YXZ';
  camPersp.rotation.set(wk.pitch, wk.yaw, 0);
}


// ---- chẩn đoán hiệu năng: gõ IALY.thongKe() trong Console để xem số liệu
window.IALY = {
  // Kiem tra tung o cua tren cao trinh dang di bo: phia TREN cua co tuong khong?
  viSao(ten) {                 // vi sao o cua nay khong co lanh to
    const f = wk.f, y = floorY(f);
    const o = customOf(f.page).find(q => q.type === 'door' && (q.name || '').indexOf(ten) >= 0);
    if (!o) return 'khong thay cua';
    const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    let tot = null;
    for (const w of tuyenTuong(f)) {
      const ux = (w.x1 - w.x0) / w.L, uz = (w.z1 - w.z0) / w.L;
      const t = Math.max(0, Math.min(w.L, (mx - w.x0) * ux + (mz - w.z0) * uz));
      const d = Math.hypot(mx - (w.x0 + ux * t), mz - (w.z0 + uz * t));
      if (!tot || d < tot.d) tot = { d: d, w: w, ux: ux, uz: uz, t: t };
    }
    const cua = [];
    for (const q of customOf(f.page)) {
      if (q.type !== 'door') continue;
      const p1 = worldXZ(f, q.u0, q.v0), p2 = worldXZ(f, q.u1, q.v1);
      cua.push([Math.min(p1[0], p2[0]) - .03, Math.min(p1[1], p2[1]) - .03,
                Math.max(p1[0], p2[0]) + .03, Math.max(p1[1], p2[1]) + .03]);
    }
    let soBuoc = 0;
    if (tot) for (let t = 0; t <= tot.w.L; t += .05) {
      const x = tot.w.x0 + tot.ux * t, z = tot.w.z0 + tot.uz * t;
      if (cua.some(c => x >= c[0] && x <= c[2] && z >= c[1] && z <= c[3])) soBuoc++;
    }
    const dem = (h) => {
      if (!tot) return -1;
      const px = tot.w.x0 + tot.ux * tot.t, pz = tot.w.z0 + tot.uz * tot.t;
      const nx = -tot.uz, nz = tot.ux;
      const rc = new THREE.Raycaster(new THREE.Vector3(px - nx * 1.2, y + h, pz - nz * 1.2),
        new THREE.Vector3(nx, 0, nz).normalize(), 0, 2.4);
      return rc.intersectObject(wkTuong, true).length + '/' +
             rc.intersectObject(customGroup, true).length + '/' +
             rc.intersectObject(massGroup, true).length;
    };
    return { cua: o.name, hCua: o.h, cachTuyenTuong: tot ? +tot.d.toFixed(2) : null,
             chamO1m: dem(1.0), chamO25m: dem(2.5), chamO5m: dem(5.0),
             dayTuyen: tot ? +tot.w.day.toFixed(2) : null,
             soBuocTrungOCua: soBuoc, caoTang: +(floorHeight(f) * state.explode).toFixed(1) };
  },
  kiemLanhTo() {
    if (!wk.on) return 'hay bat di bo';
    const f = wk.f, y = floorY(f);
    const hC = Math.min(floorHeight(f) * state.explode - .3, 2.1 * state.explode);
    const ra = [];
    for (const o of customOf(f.page)) {
      if (o.type !== 'door') continue;
      const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      let tot = null;
      for (const w of tuyenTuong(f)) {              // tuyen tuong gan o cua nhat
        const ux = (w.x1 - w.x0) / w.L, uz = (w.z1 - w.z0) / w.L;
        const t = Math.max(0, Math.min(w.L, (mx - w.x0) * ux + (mz - w.z0) * uz));
        const d = Math.hypot(mx - (w.x0 + ux * t), mz - (w.z0 + uz * t));
        if (!tot || d < tot.d) tot = { d: d, w: w, ux: ux, uz: uz, t: t };
      }
      if (!tot || tot.d > 1.2) { ra.push({ cua: o.name, ket: 'khong dinh tuyen tuong nao' }); continue; }
      const px = tot.w.x0 + tot.ux * tot.t, pz = tot.w.z0 + tot.uz * tot.t;
      const nx = -tot.uz, nz = tot.ux;              // do tren chinh buc tuong
      // dò ở nhiều cao độ: ngay trên cửa, giữa chừng và sát trần
      const tran = Math.max(hC + .6, floorHeight(f) * state.explode - MASS.slab);
      const mucCao = [hC + .4, (hC + tran) / 2, tran - .5].filter(v => v > hC + .2);
      let hong = 0;
      for (const hh of mucCao) {
        const rc = new THREE.Raycaster(new THREE.Vector3(px - nx * 1.2, y + hh, pz - nz * 1.2),
          new THREE.Vector3(nx, 0, nz).normalize(), 0, 2.4);
        const hit = rc.intersectObject(wkTuong, true).length +
                    rc.intersectObject(customGroup, true).length +
                    rc.intersectObject(massGroup, true).length;
        if (!hit) hong++;
      }
      ra.push({ cua: (o.name || '').slice(0, 14),
                lanhTo: hong === 0 ? 'CO' : 'THIEU ' + hong + '/' + mucCao.length });
    }
    const thieu = ra.filter(r => r.lanhTo && r.lanhTo.indexOf('THIEU') === 0).length;
    return { tong: ra.length, thieu: thieu, chiTiet: ra.slice(0, 30) };
  },
  // Moi buc tuong trong ban ve: di doc tuong, ban tia ngang qua o cao 1,5 m va
  // 4 m -> cho nao khong co gi chan tuc la DI BO NHIN XUYEN duoc.
  soSanhTuong(caoTia) {
    if (!wk.on) return 'hay bat di bo';
    const f = wk.f, y = floorY(f), h = caoTia === undefined ? 1.5 : caoTia;
    const xau = [];
    let mau = 0, hong = 0;
    for (const o of customOf(f.page)) {
      if (o.type !== 'wall') continue;
      const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < .4) continue;
      const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
      const nx = -uz, nz = ux;
      // bỏ qua các đoạn là Ô CỬA (đó là lỗ mở có chủ ý, không phải "xuyên tường")
      const moCua = [];
      for (const q of customOf(f.page)) {
        if (q.type !== 'door') continue;
        const p1 = worldXZ(f, q.u0, q.v0), p2 = worldXZ(f, q.u1, q.v1);
        const cd = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        if (cd < .2) continue;
        for (const pt of [p1, p2, [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]]) {
          const tt = (pt[0] - a[0]) * ux + (pt[1] - a[1]) * uz;
          const nn = Math.abs((pt[0] - a[0]) * uz - (pt[1] - a[1]) * ux);
          if (nn < 2.5) moCua.push([tt - cd / 2 - .3, tt + cd / 2 + .3]);
        }
      }
      let thieu = 0, tong = 0;
      for (let t = .3; t < L - .3; t += .5) {
        if (moCua.some(k => t >= k[0] && t <= k[1])) continue;
        const x = a[0] + ux * t, z = a[1] + uz * t;
        const rc = new THREE.Raycaster(new THREE.Vector3(x - nx * .9, y + h, z - nz * .9),
          new THREE.Vector3(nx, 0, nz).normalize(), 0, 1.8);
        const n = rc.intersectObject(wkTuong, true).length +
                  rc.intersectObject(customGroup, true).length +
                  rc.intersectObject(massGroup, true).length;
        tong++; if (!n) thieu++;
      }
      mau += tong; hong += thieu;
      if (tong && thieu / tong > .25) xau.push({ tuong: o.name || o.id, hong: thieu + '/' + tong });
    }
    return { cao: h, mauDo: mau, khongChan: hong,
             tiLeHong: mau ? +(hong * 100 / mau).toFixed(1) : 0, tuongXau: xau.slice(0, 12) };
  },
  raSoatCua() {          // moi cao trinh: o cua nao duoc khoet vao tuong (=> co lanh to)
    const ra = [];
    for (const f of state.data.floors) {
      if (f.georef === 'standalone') continue;
      const tuyen = tuyenTuong(f);
      let khop = 0, roi = [];
      for (const c of customOf(f.page)) {
        if (c.type !== 'door') continue;
        const a = worldXZ(f, c.u0, c.v0), b = worldXZ(f, c.u1, c.v1);
        const cd = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (cd < .2) continue;
        const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
        const dx = (b[0] - a[0]) / cd, dz = (b[1] - a[1]) / cd;
        let ok = false;
        for (const w of tuyen) {
          const ux = (w.x1 - w.x0) / w.L, uz = (w.z1 - w.z0) / w.L;
          if (Math.abs(ux * dz - uz * dx) > 0.26) continue;
          const t = (cx - w.x0) * ux + (cz - w.z0) * uz;
          if (t < -(cd / 2 + 1) || t > w.L + cd / 2 + 1) continue;
          if (Math.abs((cx - w.x0) * uz - (cz - w.z0) * ux) > w.day / 2 + 0.8) continue;
          if ((Math.min(w.L, t + cd / 2) - Math.max(0, t - cd / 2)) / cd < 0.5) continue;
          ok = true; break;
        }
        if (ok) khop++; else roi.push((c.name || '').slice(0, 10));
      }
      ra.push({ el: f.elevation, coTuong: khop, khongCoTuong: roi });
    }
    return ra;
  },
  // Ve THEM TUONG THAT vao ban ve o hai dau buong thang (cho nao ban ve chua co),
  // chua loi vao rong LOT met o giua. Tra ve danh sach tuong da them.
  kinThang(chiXem, LOT) {
    LOT = LOT || 1.2;
    const them = [], s = mpp();
    const veUV = (f, x, z) => f.georef === 'standalone' ? [x - 110, z + 40] : [x / s, z / s];
    for (const f of state.data.floors) {
      const ds = customOf(f.page).filter(o => o.type === 'thangbo' || o.type === 'stair');
      if (!ds.length) continue;
      const tuong = tuyenTuong(f);
      for (const o of ds) {
        const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < .4) continue;
        const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz, nz = ux;
        const W = rongThangTheoTuong(f, o);
        for (const dau of [-1, 1]) {
          const e = dau < 0 ? a : b;
          const px = e[0] + ux * dau * .15, pz = e[1] + uz * dau * .15;
          // da co tuong chan dau nay chua? lay mau ngang mat cat
          let coMau = 0, tongMau = 0;
          for (let k = -4; k <= 4; k++) {
            const q = k / 8 * W, qx = px + nx * q, qz = pz + nz * q;
            tongMau++;
            for (const w of tuong) {
              const wx = (w.x1 - w.x0) / w.L, wz = (w.z1 - w.z0) / w.L;
              const t = Math.max(0, Math.min(w.L, (qx - w.x0) * wx + (qz - w.z0) * wz));
              const dx = qx - (w.x0 + wx * t), dz = qz - (w.z0 + wz * t);
              if (Math.hypot(dx, dz) < .45) { coMau++; break; }
            }
          }
          if (coMau / tongMau >= .6) continue;            // dau nay da kin
          for (const ben of [-1, 1]) {                    // hai ma tuong, chua loi giua
            const t0 = ben * LOT / 2, t1 = ben * W / 2;
            if (Math.abs(t1 - t0) < .25) continue;
            const A = veUV(f, px + nx * t0, pz + nz * t0);
            const B = veUV(f, px + nx * t1, pz + nz * t1);
            const w = { type: 'wall', t: .22, h: 0, base: 0,
                        u0: A[0], v0: A[1], u1: B[0], v1: B[1],
                        id: 'kt' + Math.random().toString(36).slice(2, 10),
                        name: 'Tuong dau thang ' + (o.name || '').slice(10, 16) + ' EL.' + f.elevation };
            them.push({ el: f.elevation, ten: w.name, dai: +Math.hypot(B[0] - A[0], B[1] - A[1]).toFixed(1) });
            if (!chiXem) customOf(f.page).push(w);
          }
        }
      }
    }
    if (!chiXem && them.length) { saveCustom(); rebuildCustom(); banDoiChua(true); }
    return them;
  },
  xuongThu() {                 // tu dong: den chan thang xuong roi bam X, bao ket o dau
    if (!wk.on) return 'hay bat di bo';
    const ds = thangXuong(wk.f);
    if (!ds.length) return 'khong co thang xuong';
    const t = ds[0];
    const o = wk.luoi && choThoang(wk.luoi, t.x, t.z, 8);
    if (o) { wk.x = o.x; wk.z = o.z; } else { wk.x = t.x; wk.z = t.z; }
    const truoc = wk.f.elevation;
    dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    for (let i = 0; i < 4000 && wk.leo; i++) buocLeo(0.4);
    const L = wk.luoi;
    let trong = 0; for (let i = 0; i < L.nx * L.nz; i++) if (L.o[i]) trong++;
    const tham = new Uint8Array(L.nx * L.nz);
    const q = [L.iOf(wk.x) * L.nz + L.jOf(wk.z)]; tham[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], ci = (c / L.nz) | 0, cj = c % L.nz;
      for (const k of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const ni = ci + k[0], nj = cj + k[1];
        if (ni < 0 || nj < 0 || ni >= L.nx || nj >= L.nz) continue;
        const n = ni * L.nz + nj;
        if (tham[n] || !L.o[n]) continue;
        tham[n] = 1; q.push(n);
      }
    }
    return { tu: truoc, toi: wk.f.elevation, conLeo: !!wk.leo,
             oTrongTang: trong, oDenDuoc: q.length,
             dungTrongLuoi: !!(L.trong && L.trong(wk.x, wk.z)) };
  },
  sanTang() {                  // dien tich tung tam san cua cao trinh dang xem
    const f = wk.on ? wk.f : activeFloorObj();
    const ra = [];
    for (const o of customOf(f.page)) {
      if (o.type !== 'san') continue;
      const p = (o.pts || []).map(q => worldXZ(f, q[0], q[1]));
      let A = 0;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++)
        A += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
      ra.push({ ten: (o.name || '').slice(0, 24), dinh: p.length, m2: +Math.abs(A / 2).toFixed(1) });
    }
    return { el: f.elevation, san: ra, oTrongLuoi: wk.on && wk.luoi ?
      wk.luoi.o.reduce((a2, b) => a2 + b, 0) : null };
  },
  nguonTuong() {               // tuong trong che do di bo den tu dau
    const ra = [];
    for (const f of state.data.floors) {
      const ed = editsOf(f.page);
      const tuVe = customOf(f.page).filter(o => o.type === 'wall' || o.type === 'box' || o.type === 'tra');
      const boc = (f.walls || []).filter((r, i) => ed.delWall.indexOf(i) < 0).length;
      const net = ((state.lines && state.lines[f.page]) || []).length;
      ra.push({ el: f.elevation, tuVe: tuVe.length,
                bocTuPDF: tuVe.length >= 3 ? boc : 0,
                netVector: tuVe.length >= 3 ? 0 : net,
                nguon: tuVe.length >= 3 ? 'ban ve cua ban + tuong boc tu PDF' : 'NET VECTOR PDF' });
    }
    return ra;
  },
  themGi() {                   // che do di bo dung them nhung gi ngoai ban ve
    const ra = [];
    const ds = state.data.floors.filter(x => x.georef !== 'standalone')
      .sort((a2, b) => b.elevation - a2.elevation);
    for (const f of ds) {
      const kq = vachCuaTang(f);
      if (!kq) { ra.push({ el: f.elevation, loi: 'khong dung duoc' }); continue; }
      const cuaTang = kq.hinh.length;
      const oThang = thangXuong(f);
      const duoi = ds.find(x => x.elevation < f.elevation);
      let tangDuoi = 0;
      if (duoi && oThang.length) {
        const gan = (x, z) => oThang.some(t => Math.hypot(t.x - x, t.z - z) < 9);
        const k2 = vachCuaTang(duoi, gan);
        tangDuoi = k2 ? k2.hinh.length : 0;
      }
      const h2 = [];
      bitHoThang(f, h2, kq.y);
      ra.push({ el: f.elevation, vachTangNay: cuaTang,
                vachTangDUOI: tangDuoi, lapHoThang: h2.length,
                sanDuoiHoThang: oThang.length });
      h2.forEach(g => g.dispose());
      kq.hinh.forEach(g => g.dispose());
    }
    return ra;
  },
  rongThangCaTang() {          // be rong ve thang cua toan bo cao trinh
    const ra = [];
    for (const f of state.data.floors) {
      const ds = customOf(f.page).filter(o => o.type === 'thangbo' || o.type === 'stair');
      for (const o of ds) ra.push({ el: f.elevation, ten: (o.name || '').slice(0, 10),
        veVe: +(o.w || 1.26).toFixed(2), theoTuong: +rongThangTheoTuong(f, o).toFixed(2) });
    }
    return ra;
  },
  rongThang() {                // be rong ve thang: ve ve so voi do duoc theo tuong
    const f = wk.on ? wk.f : activeFloorObj();
    return customOf(f.page).filter(o => o.type === 'thangbo' || o.type === 'stair')
      .map(o => ({ ten: (o.name || '').slice(0, 22), veVe: +(o.w || 1.26).toFixed(2),
                   theoTuong: +rongThangTheoTuong(f, o).toFixed(2) }));
  },
  denThang(ten, xa) {          // dung truoc mot ve thang de xem
    if (!wk.on) return 'hay bat di bo';
    const ds = diemThoat(wk.f).concat(thangXuong(wk.f));
    const t = ds.find(q => (q.ten || '').indexOf(ten || '') >= 0) || ds[0];
    if (!t) return 'khong co thang';
    const d = xa || 7;
    wk.x = t.x + d; wk.z = t.z + d * .2;
    wk.yaw = -Math.atan2(t.z - wk.z, t.x - wk.x) - Math.PI / 2;
    wk.pitch = .05; hudDiBo();
    return { thang: t.ten, dung: [+wk.x.toFixed(1), +wk.z.toFixed(1)] };
  },
  denCua(ten, xa) {                 // dua nguoi di bo toi truoc mot o cua de xem
    if (!wk.on) return 'hay bat di bo';
    const f = wk.f;
    const o = customOf(f.page).find(q => q.type === 'door' &&
      (ten ? (q.name || '').indexOf(ten) >= 0 : true));
    if (!o) return 'khong thay cua';
    const a = worldXZ(f, o.u0, o.v0), b = worldXZ(f, o.u1, o.v1);
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
    const cd = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / cd, nz = (b[0] - a[0]) / cd;   // pháp tuyến
    const d = xa || 5;
    wk.x = cx + nx * d; wk.z = cz + nz * d;
    wk.yaw = -Math.atan2(cz - wk.z, cx - wk.x) - Math.PI / 2;
    wk.pitch = 0.12;
    hudDiBo();
    return { cua: o.name, dungTai: [+wk.x.toFixed(1), +wk.z.toFixed(1)] };
  },
  kiemThang() {                // hai ben ve thang con ho khong (do bang tia)
    if (!wk.on) return 'hay bat di bo';
    const f = wk.f, y = floorY(f);
    const ds = oThangCuaTang(f);
    const oCua = [];                       // chừa ô cửa ra: đó là lối vào thang
    for (const q of customOf(f.page)) {
      if (q.type !== 'door') continue;
      const a1 = worldXZ(f, q.u0, q.v0), b1 = worldXZ(f, q.u1, q.v1);
      oCua.push([Math.min(a1[0], b1[0]) - .8, Math.min(a1[1], b1[1]) - .8,
                 Math.max(a1[0], b1[0]) + .8, Math.max(a1[1], b1[1]) + .8]);
    }
    let tong = 0, ho = 0; const xau = [];
    for (const t of ds) {
      const c = Math.cos(t.ang), s2 = Math.sin(t.ang);
      let thieu = 0, n = 0;
      const diem = [];
      for (const ben of [1, -1])
        for (let a = -t.nua + .3; a < t.nua - .3; a += .5)
          diem.push({ lx: a, lz: ben * (t.ngang + .4), nx: -s2 * ben, nz: c * ben });
      for (const dau of [1, -1])
        for (let b = -t.ngang + .3; b < t.ngang - .3; b += .5)
          diem.push({ lx: dau * (t.nua + .4), lz: b, nx: c * dau, nz: s2 * dau });
      {
        for (const d of diem) {
          const x = t.x + d.lx * c - d.lz * s2, z = t.z + d.lx * s2 + d.lz * c;
          const nx = d.nx, nz = d.nz;
          const rc = new THREE.Raycaster(
            new THREE.Vector3(x + nx * .9, y + 1.5 * state.explode, z + nz * .9),
            new THREE.Vector3(-nx, 0, -nz).normalize(), 0, 1.8);
          const hit = rc.intersectObject(wkTuong, true).length +
                      rc.intersectObject(customGroup, true).length +
                      rc.intersectObject(massGroup, true).length;
          if (oCua.some(q => x >= q[0] && x <= q[2] && z >= q[1] && z <= q[3])) continue;
          n++; if (!hit) thieu++;
        }
      }
      tong += n; ho += thieu;
      if (thieu) xau.push({ thang: t.x.toFixed(1) + ',' + t.z.toFixed(1), ho: thieu + '/' + n });
    }
    return { diemDo: tong, diemHo: ho, veThang: ds.length, chiTiet: xau.slice(0, 8) };
  },
  kiemExit() {                 // bien EXIT nao bi tuong che khuat (do bang tia)
    if (!wk.on) return 'hay bat di bo';
    const f = wk.f;
    let tong = 0, che = 0; const ds = [], tatCa = [];
    const xet = (g) => {
      const p = new THREE.Vector3(); g.getWorldPosition(p);
      if (Math.abs(p.y - (floorY(f) + 2.4 * state.explode)) > 6) return;
      const huong = new THREE.Vector3(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
      const xa = 2.5;
      const o = p.clone().addScaledVector(huong, xa);
      const rc = new THREE.Raycaster(o, p.clone().sub(o).normalize(), 0, xa - .1);
      const n = rc.intersectObject(wkTuong, true).length +
                rc.intersectObject(massGroup, true).length;
      tong++;
      tatCa.push({ x: p.x, z: p.z, che: !!n });
      if (n) { che++; ds.push(+p.x.toFixed(1) + ',' + +p.z.toFixed(1)); }
    };
    exitMeshes.forEach(xet); customMeshes.forEach(g => { if (g.userData.obj &&
      g.userData.obj.type === 'exit') xet(g); });
    // gom theo cụm 0,8 m: mỗi ô cửa có hai biển hai mặt, chỉ cần MỘT mặt nhìn thấy
    const cum = [];
    for (const b of tatCa) {
      let c = cum.find(q => Math.hypot(q.x - b.x, q.z - b.z) < .8);
      if (!c) { c = { x: b.x, z: b.z, thay: 0, tong: 0 }; cum.push(c); }
      c.tong++; if (!b.che) c.thay++;
    }
    const mu = cum.filter(c => !c.thay);
    return { bien: tong, bienBiChe: che, viTriBien: ds.slice(0, 6),
             cumBien: cum.length, cumKhongThayMatNao: mu.length,
             viTriMu: mu.slice(0, 6).map(c => c.x.toFixed(1) + ',' + c.z.toFixed(1)) };
  },
  fps(giay) {                  // do so khung hinh/giay thuc te
    const t0 = performance.now(); let n = 0;
    return new Promise(res => {
      const b = () => {
        n++;
        if (performance.now() - t0 < (giay || 2) * 1000) requestAnimationFrame(b);
        else res({ fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1),
                   bong: renderer.shadowMap.enabled,
                   diemAnh: renderer.getPixelRatio(),
                   lenhVe: renderer.info.render.calls,
                   tamGiac: renderer.info.render.triangles });
      };
      requestAnimationFrame(b);
    });
  },
  vlTuong() { return { hien: matWallShared.visible, mo: matWallShared.opacity,
                       trongSuot: matWallShared.transparent,
                       sanHien: matSlab.visible, sanMo: matSlab.opacity,
                       wallop: (document.querySelector('#wallop') || {}).value }; },
  nen() { return { nen: scene.background ? '#' + scene.background.getHexString() : '-',
                   fog: scene.fog ? '#' + scene.fog.color.getHexString() : '-',
                   xa: scene.fog ? [scene.fog.near, scene.fog.far] : null,
                   diBo: wk.on }; },
  // chieu tia tu camera theo huong man hinh (x,y trong [-1,1]) -> vat gi dang che
  doVat(mx, my) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(mx || 0, my || 0), camera);
    const hit = rc.intersectObjects(scene.children, true)
      .filter(h => h.object.visible && h.object.type !== 'Line' && h.object.type !== 'LineSegments');
    return hit.slice(0, 4).map(h => ({
      ten: h.object.name || h.object.parent && h.object.parent.name || h.object.type,
      mau: h.object.material && h.object.material.color ? '#' + h.object.material.color.getHexString() : '-',
      xa: +h.distance.toFixed(2),
      nhom: (function (o) { let n = o, d = []; while (n) { if (n.name) d.push(n.name); n = n.parent; } return d.join('<'); })(h.object)
    }));
  },
  // Ra soat TOAN BO cao trinh: o di duoc, vung lien thong lon nhat, va cac ve
  // thang co nam trong vung lon nhat khong (thang nam ngoai = xuong toi la ket).
  raSoatTang() {
    const ra = [];
    for (const f of state.data.floors) {
      if (f.georef === 'standalone') continue;
      const L = dungLuoi(f);
      if (!L) { ra.push({ el: f.elevation, loi: 'khong co khung san' }); continue; }
      const nhan = new Int32Array(L.nx * L.nz).fill(-1);
      const co = [];
      const ke = [[1,0],[-1,0],[0,1],[0,-1]];
      for (let c = 0; c < L.o.length; c++) {
        if (!L.o[c] || nhan[c] >= 0) continue;
        const id = co.length; const q = [c]; nhan[c] = id;
        for (let h = 0; h < q.length; h++) {
          const u = q[h], ui = (u / L.nz) | 0, uj = u % L.nz;
          for (const k of ke) {
            const ni = ui + k[0], nj = uj + k[1];
            if (ni < 0 || nj < 0 || ni >= L.nx || nj >= L.nz) continue;
            const n = ni * L.nz + nj;
            if (nhan[n] >= 0 || !L.o[n]) continue;
            nhan[n] = id; q.push(n);
          }
        }
        co.push(q.length);
      }
      let lon = 0, tong = 0;
      co.forEach(v => { tong += v; if (v > lon) lon = v; });
      const idLon = co.indexOf(lon);
      const thang = diemThoat(f).concat(thangXuong(f)).map(t => {
        const i = L.iOf(t.x), j = L.jOf(t.z);
        const c = (i >= 0 && j >= 0 && i < L.nx && j < L.nz) ? nhan[i * L.nz + j] : -1;
        return { ten: t.ten.slice(0, 22), vung: c < 0 ? 'o cam' : (c === idLon ? 'vung chinh' : 'oc dao ' + co[c] + ' o') };
      });
      ra.push({ el: f.elevation, oTrong: tong, vungChinh: lon,
                soManh: co.length, thang: thang });
    }
    return ra;
  },
  diBo() {
    if (!wk.on) return 'chua bat di bo';
    const L = wk.luoi;
    const i = L ? L.iOf(wk.x) : -1, j = L ? L.jOf(wk.z) : -1;
    let trong = 0;
    if (L) for (let a=-2;a<=2;a++) for (let b=-2;b<=2;b++){const u=i+a,v=j+b;
      if(u>=0&&v>=0&&u<L.nx&&v<L.nz&&L.o[u*L.nz+v]) trong++;}
    return { x:+wk.x.toFixed(2), z:+wk.z.toFixed(2), yaw:+wk.yaw.toFixed(2),
             oTrongQuanh:trong, tongO:L?L.nx*L.nz:0, phim:Object.keys(wk.phim).filter(k=>wk.phim[k]) };
  },
  gopThu(i, j) {
    const f = activeFloorObj();
    const ds = hopSan(f);
    if (!ds[i] || !ds[j]) return 'khong co tam ' + i + '/' + j + ' (co ' + ds.length + ' tam)';
    const A = ds[i], B = ds[j];
    gm.a = null;
    gopMepSan(f, (A.x0 + A.x1) / 2, (A.z0 + A.z1) / 2);
    gopMepSan(f, (B.x0 + B.x1) / 2, (B.z0 + B.z1) / 2);
    return customOf(f.page).filter(o => o.type === 'san').map(o => o.name);
  },
  thangDuoi() { return { soVeThangHien: wkThang.children.length,
      diem: (wk.on ? thangXuong(wk.f) : []).map(t => ({ ten: t.ten.slice(0,24),
        cach: +Math.hypot(t.x - wk.x, t.z - wk.z).toFixed(1) })) }; },
  lyDoMoLoi() { return wk.lyDo || 'chua chay'; },
  moLoiThu() {
    if (!wk.on) return 'hay bat di bo';
    wk.daMoRa = false; wk.soLanMo = 0;
    const kq = moLoiRaPhong();
    const c = this.chanDoanThang();
    return { daMo: kq, oDenDuoc: c.oDenDuocTuChoDung, oTrongToanTang: c.oTrongToanTang };
  },
  leoNhanh() {
    if (!wk.on) return 'hay bat di bo';
    if (!wk.leo) return 'chua bat dau leo (bam X hoac di toi chan thang)';
    for (let i = 0; i < 2000 && wk.leo; i++) buocLeo(0.4);
    return { caoTrinhHienTai: wk.f.elevation, conLeo: !!wk.leo };
  },
  leoThu() { if (!wk.on) return 'hay bat di bo'; leoThang(wk.dich && wk.dich.ten); return wk.f.name; },
  chanDoanThang() {
    if (!wk.on) return 'hay bat che do di bo truoc';
    const L = wk.luoi, f = wk.f;
    const th = diemThoat(f);
    let trong = 0;
    for (let i = 0; i < L.nx * L.nz; i++) if (L.o[i]) trong++;
    // BFS tu cho dung
    const tham = new Uint8Array(L.nx * L.nz);
    const q = [L.iOf(wk.x) * L.nz + L.jOf(wk.z)]; tham[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], ci = (c / L.nz) | 0, cj = c % L.nz;
      for (const k of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const ni = ci + k[0], nj = cj + k[1];
        if (ni < 0 || nj < 0 || ni >= L.nx || nj >= L.nz) continue;
        const n = ni * L.nz + nj;
        if (tham[n] || !L.o[n]) continue;
        tham[n] = 1; q.push(n);
      }
    }
    const dsThang = th.map(t => {
      const i = L.iOf(t.x), j = L.jOf(t.z);
      const trongLuoi = i >= 0 && j >= 0 && i < L.nx && j < L.nz;
      let oTrongGan = 0, oDenDuoc = 0;
      if (trongLuoi) for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {
        const u = i + a, v = j + b;
        if (u < 0 || v < 0 || u >= L.nx || v >= L.nz) continue;
        if (L.o[u * L.nz + v]) oTrongGan++;
        if (tham[u * L.nz + v]) oDenDuoc++;
      }
      return { ten: t.ten.slice(0, 26), trongLuoi: trongLuoi,
               oTrongQuanhThang: oTrongGan, oDenDuocQuanhThang: oDenDuoc,
               cachNguoi: +Math.hypot(t.x - wk.x, t.z - wk.z).toFixed(1) };
    });
    return { caoTrinh: f.elevation, oTrongToanTang: trong, oDenDuocTuChoDung: q.length, thang: dsThang };
  },
  kiemTuong() {
    const ra = {};
    const xet = (g, ten) => g.traverse(o => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const ds = Array.isArray(o.material) ? o.material : [o.material];
      ds.forEach(m => {
        if (!m) return;
        const mo = m.transparent && m.opacity < 0.98;
        if (!mo) return;
        const k = ten + ' · ' + (m.name || ('#' + m.uuid.slice(0, 6))) + ' · mo=' + m.opacity;
        ra[k] = (ra[k] || 0) + 1;
      });
    });
    xet(massGroup, 'tuong/san boc tu ban ve');
    xet(customGroup, 'vat tu ve');
    xet(wkTuong, 'vach che do di bo');
    return Object.keys(ra).length ? ra : 'khong con vat lieu trong suot nao';
  },
  theoNhom() {
    const dem = g => { let n = 0; g.traverse(o => { if (o.isMesh || o.isInstancedMesh) n++; }); return n; };
    return { ban_ve: dem(floorGroup), khoi_tuong_san: dem(massGroup), vat_tu_ve: dem(customGroup),
             binh: dem(markerGroup), den_exit: dem(exitGroup) };
  },
  thongKe() {
    let mesh = 0, tamGiac = 0, vatLieu = new Set(), hinh = new Set();
    scene.traverse(o => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      mesh += o.isInstancedMesh ? o.count : 1;
      const g = o.geometry;
      if (g) {
        hinh.add(g.uuid);
        const n = (g.index ? g.index.count : (g.attributes.position || { count: 0 }).count) / 3;
        tamGiac += n * (o.isInstancedMesh ? o.count : 1);
      }
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m && vatLieu.add(m.uuid));
    });
    const vat = Object.values(state.custom).reduce((a, b) => a + b.length, 0);
    return {
      lenhVe: renderer.info.render.calls,
      tamGiacMoiKhung: renderer.info.render.triangles,
      meshTrongCanh: mesh,
      tamGiacTongCong: Math.round(tamGiac),
      hinhHoc: renderer.info.memory.geometries,
      texture: renderer.info.memory.textures,
      vatLieuKhacNhau: vatLieu.size,
      vatTuVe: vat,
      boNhoJS_MB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      theoNhom: this.theoNhom(),
    };
  }
};

const btnGop = document.querySelector('#dGopSan');
if (btnGop) btnGop.onclick = () => gopSanGanNhat(activeFloorObj());

const btnSan = document.querySelector('#dDonSan');
if (btnSan) btnSan.onclick = () => donMepSan(activeFloorObj());

const btnKhit = document.querySelector('#dKhit');
if (btnKhit) btnKhit.onclick = () => lamKhitGoc(activeFloorObj());

const btnWalk = document.querySelector('#walk');
if (btnWalk) btnWalk.onclick = function () { if (wk.on) raDiBo(); else vaoDiBo(); };

