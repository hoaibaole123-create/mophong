// ============================================================ TAB THIẾT KẾ
// Cho phép vẽ thêm tường, khối hộp thiết bị / máy biến áp và bình chữa cháy
// ngay trên mặt bằng của cao trình đang chọn. Dữ liệu lưu trong localStorage
// và xuất được ra tệp thiet-ke.json.
const MAT_CUSTOM = {
  wall: new THREE.MeshStandardMaterial({ color: 0xd8c6a8, roughness: .9 }),
  box: new THREE.MeshStandardMaterial({ color: 0x5fa0c8, roughness: .5, metalness: .2 }),
  tra: new THREE.MeshStandardMaterial({ color: 0x96a3b0, roughness: .45, metalness: .5 }),
};
const MAT_SEL = new THREE.MeshStandardMaterial({ color: 0xffc14d, roughness: .4, emissive: 0x4a3300 });

let customMeshes = [], ghost = null;
const drag = { on: false, a: null, b: null };

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

function rebuildCustom() {
  customMeshes.forEach(m => { customGroup.remove(m); });
  customMeshes = [];
  for (const f of state.data.floors) {
    if (!state.visible.has(f.page)) continue;
    const y = floorY(f);
    const storey = Math.max(1.2, floorHeight(f) * state.explode - MASS.slab);
    for (const o of customOf(f.page)) {
      const [ax, az] = worldXZ(f, o.u0, o.v0);
      const [bx, bz] = worldXZ(f, o.u1, o.v1);
      let mesh;
      if (o.type === 'bin') {
        const mat = new THREE.MeshStandardMaterial({ color: 0xe23b2e, roughness: .45, emissive: 0x3a0a06 });
        mesh = makeMarker('ABC8', mat);
        mesh.position.set(ax, y + .05, az);
        mesh.scale.setScalar(state.mkScale * (state.sel === o.id ? 1.8 : 1));
      } else {
        const h = (o.type === 'wall')
          ? (o.h > 0 ? o.h * state.explode : storey)
          : o.h * state.explode;
        const mat = (state.sel === o.id) ? MAT_SEL : MAT_CUSTOM[o.type];
        if (o.type === 'wall') {
          const dx = bx - ax, dz = bz - az;
          const len = Math.max(.1, Math.hypot(dx, dz));
          mesh = new THREE.Mesh(new THREE.BoxGeometry(len, h, o.t || .22), mat);
          mesh.position.set((ax + bx) / 2, y + h / 2, (az + bz) / 2);
          mesh.rotation.y = -Math.atan2(dz, dx);
        } else {
          const w = Math.max(.15, Math.abs(bx - ax)), d = Math.max(.15, Math.abs(bz - az));
          mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          mesh.position.set((ax + bx) / 2, y + h / 2, (az + bz) / 2);
        }
      }
      mesh.userData.obj = o;
      customGroup.add(mesh);
      customMeshes.push(mesh);
    }
  }
  renderDesignList();
}

function renderDesignList() {
  const box = $('#dlist');
  if (!box) return;
  const f = activeFloorObj();
  const list = customOf(f.page);
  $('#dtarget').innerHTML = 'Đang vẽ lên: <b>' + f.name + '</b><br>' +
    'Muốn đổi tầng: sang tab <i>Xem</i>, bấm tên cao trình khác.';
  box.innerHTML = list.length ? '' : '<div class="sub">Chưa có đối tượng nào ở cao trình này.</div>';
  const col = t => t === 'bin' ? '#e23b2e' : t === 'wall' ? '#d8c6a8' : t === 'tra' ? '#96a3b0' : '#5fa0c8';
  list.forEach(o => {
    const r = el('div', 'objrow',
      '<span class="dot" style="background:' + col(o.type) + '"></span>' +
      '<span style="flex:1">' + o.name + '</span><span class="x" title="Xoá">✕</span>');
    r.onclick = () => { state.sel = o.id; rebuildCustom(); };
    r.querySelector('.x').onclick = ev => { ev.stopPropagation(); removeObj(o.id); };
    box.appendChild(r);
  });
}

function addObj(f, o) {
  o.id = 'C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  customOf(f.page).push(o);
  state.undo.push(o.id);
  saveCustom();
  rebuildCustom();
}
function removeObj(id) {
  for (const p of Object.keys(state.custom)) {
    const i = state.custom[p].findIndex(o => o.id === id);
    if (i >= 0) { state.custom[p].splice(i, 1); break; }
  }
  if (state.sel === id) state.sel = null;
  saveCustom(); rebuildCustom();
}
function saveCustom() {
  try { localStorage.setItem('ialy.custom', JSON.stringify(state.custom)); } catch (e) { }
}

// ---- vẽ bằng chuột trên mặt sàn của cao trình đang chọn
const planeHelper = new THREE.Plane();
function pickOnFloor(ev) {
  const f = activeFloorObj();
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  planeHelper.set(new THREE.Vector3(0, 1, 0), -(floorY(f) + 0.02));
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(planeHelper, hit)) return null;
  const snap = v => Math.round(v * 20) / 20;      // lưới 5 cm
  return { f: f, x: snap(hit.x), z: snap(hit.z) };
}

function hint(txt) {
  const h = $('#dhint');
  if (!txt) { h.style.display = 'none'; return; }
  h.style.display = 'block'; h.textContent = txt;
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
    hint('Dài ' + len.toFixed(2) + ' m · dày ' + t + ' m — thả chuột để chốt');
  } else {
    const w = Math.max(.15, Math.abs(b.x - a.x)), d = Math.max(.15, Math.abs(b.z - a.z));
    ghost = new THREE.Mesh(new THREE.BoxGeometry(w, hb, d), mat);
    ghost.position.set((a.x + b.x) / 2, y + hb / 2, (a.z + b.z) / 2);
    hint(w.toFixed(2) + ' × ' + d.toFixed(2) + ' × cao ' + hb + ' m — thả chuột để chốt');
  }
  customGroup.add(ghost);
}

function axisSnap(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  if (Math.abs(dx) > Math.abs(dz) * 4) return { f: b.f, x: b.x, z: a.z };
  if (Math.abs(dz) > Math.abs(dx) * 4) return { f: b.f, x: a.x, z: b.z };
  return b;
}

function designDown(ev) {
  if (state.mode !== 'design' || ev.button !== 0) return;
  const p = pickOnFloor(ev);
  if (!p) return;
  if (state.tool === 'sel') {
    const hits = raycaster.intersectObjects(customMeshes, true);
    let o = hits[0] && hits[0].object;
    while (o && !o.userData.obj) o = o.parent;
    state.sel = o ? o.userData.obj.id : null;
    rebuildCustom();
    hint(state.sel ? 'Đã chọn — bấm phím Delete để xoá' : '');
    return;
  }
  if (state.tool === 'bin') {
    const uv = baseFromWorld(p.f, p.x, p.z);
    const n = customOf(p.f.page).filter(o => o.type === 'bin').length + 1;
    addObj(p.f, { type: 'bin', u0: uv[0], v0: uv[1], u1: uv[0], v1: uv[1], h: 0, name: 'Bình thêm ' + n });
    return;
  }
  drag.on = true; drag.a = p; drag.b = p;
  controls.enabled = false;
}

function designMove(ev) {
  if (state.mode !== 'design' || !drag.on) return;
  let p = pickOnFloor(ev);
  if (!p) return;
  if (state.tool === 'wall') p = axisSnap(drag.a, p);
  drag.b = p;
  showGhost(drag.a, drag.b);
}

function designUp() {
  if (state.mode !== 'design' || !drag.on) return;
  drag.on = false; controls.enabled = true;
  showGhost(null, null); hint('');
  const a = drag.a, b = drag.b;
  if (!a || !b) return;
  if (Math.hypot(b.x - a.x, b.z - a.z) < .25) return;
  const f = a.f;
  const p0 = baseFromWorld(f, a.x, a.z), p1 = baseFromWorld(f, b.x, b.z);
  const n = customOf(f.page).length + 1;
  const common = { u0: p0[0], v0: p0[1], u1: p1[0], v1: p1[1] };
  if (state.tool === 'wall') {
    addObj(f, Object.assign({ type: 'wall', t: +$('#dThick').value || .22,
      h: +$('#dWallH').value || 0, name: 'Tường ' + n }, common));
  } else if (state.tool === 'box') {
    addObj(f, Object.assign({ type: 'box', h: +$('#dBoxH').value || 2,
      name: 'Khối thiết bị ' + n }, common));
  } else if (state.tool === 'tra') {
    addObj(f, Object.assign({ type: 'tra', h: +$('#dBoxH').value || 3.2,
      name: 'Máy biến áp ' + n }, common));
  }
}

function setTool(t) {
  state.tool = t;
  document.querySelectorAll('.tool').forEach(e => e.classList.toggle('on', e.dataset.tool === t));
  hint(t === 'sel' ? 'Bấm vào đối tượng đã vẽ để chọn, phím Delete để xoá'
    : t === 'bin' ? 'Bấm lên mặt sàn để đặt bình chữa cháy'
      : 'Giữ chuột trái và kéo trên mặt sàn để vẽ');
  setTimeout(() => { if (state.tool === t) hint(''); }, 2800);
}

function setMode(m) {
  state.mode = m;
  $('#tabView').classList.toggle('on', m === 'view');
  $('#tabDesign').classList.toggle('on', m === 'design');
  $('#paneView').style.display = m === 'view' ? '' : 'none';
  $('#paneDesign').style.display = m === 'design' ? '' : 'none';
  $('#hud').style.display = m === 'view' ? '' : 'none';
  if (m === 'design') { renderDesignList(); setTool(state.tool); }
  else { hint(''); state.sel = null; rebuildCustom(); }
}

function initDesign() {
  try {
    const raw = localStorage.getItem('ialy.custom');
    if (raw) state.custom = JSON.parse(raw);
  } catch (e) { }
  $('#tabView').onclick = () => setMode('view');
  $('#tabDesign').onclick = () => setMode('design');
  document.querySelectorAll('.tool').forEach(t => { t.onclick = () => setTool(t.dataset.tool); });
  renderer.domElement.addEventListener('pointerdown', designDown);
  renderer.domElement.addEventListener('pointermove', designMove);
  addEventListener('pointerup', designUp);
  addEventListener('keydown', e => {
    if (state.mode !== 'design') return;
    if (e.key === 'Delete' && state.sel) removeObj(state.sel);
    const map = { '1': 'sel', '2': 'wall', '3': 'box', '4': 'tra', '5': 'bin' };
    if (map[e.key]) setTool(map[e.key]);
  });
  $('#dUndo').onclick = () => { const last = state.undo.pop(); if (last) removeObj(last); };
  $('#dClear').onclick = () => {
    const f = activeFloorObj();
    if (!customOf(f.page).length) return;
    if (confirm('Xoá toàn bộ đối tượng đã vẽ ở ' + f.name + '?')) {
      state.custom[f.page] = []; saveCustom(); rebuildCustom();
    }
  };
  $('#dExport').onclick = () => {
    const blob = new Blob([JSON.stringify(state.custom, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'thiet-ke.json'; a.click();
  };
  $('#dImport').onclick = () => $('#dFile').click();
  $('#dFile').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then(t => {
      try { state.custom = JSON.parse(t); saveCustom(); rebuildCustom(); }
      catch (err) { alert('Tệp không đọc được: ' + err); }
    });
  };
  $('#dSave').onclick = () => {
    saveCustom(); hint('Đã lưu vào trình duyệt'); setTimeout(() => hint(''), 1800);
  };
  rebuildCustom();
}

