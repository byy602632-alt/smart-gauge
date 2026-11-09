
/* ============================================================
   ECU TUNE — tuning screen: maps, table editor, 3D, tools
   ============================================================ */
(function () {
  'use strict';
  if (typeof console !== 'undefined') console.log('[ECU TUNE] tune.js เวอร์ชันกราฟสไตล์ TunerPro (3D + ลากจุด 2D)');
 
  const sel = { r: 0, c: 0 };
  let mode = 'table';
  let built = false;
  let xdfError = '';
  
  // --- อัปเกรดตัวแปรควบคุมมุมมอง 3D ให้รองรับการซูมและการก้ม-เงย ---
  const surf = { 
    yaw: 0.65, 
    pitch: 0.6, 
    scale: 1.0,      // สเกลซูม (เริ่มต้น 1.0)
    panX: 0,         // ขยับซ้าย-ขวา
    panY: 0,         // ขยับขึ้น-ลง
    dragging: false, 
    lastX: 0, 
    lastY: 0, 
    pinchDist: 0,    // ระยะถ่างนิ้วซูมบนมือถือ
    canvas: null 
  };
  
  let lastRange = { min: 0, max: 1 };
 
  // --- State สำหรับการลากคลุมเลือกหลายช่อง (Drag Selection) ---
  let isSelecting = false;
  let startCoords = null; // { r, c }
  let selectedRange = { minR: 0, maxR: 0, minC: 0, maxC: 0 };
 
  const item = () => App.state.items[App.state.mapIdx] || null;
  const def = () => App.state.xdf;
 
  /* ---------------- helpers ---------------- */
  function cellVal(it, r, c) {
    try { return Xdf.readCell(it, r, c, App.state.bin, App.state.xdf); }
    catch (e) { return null; }
  }
  function cellRaw(it, r, c) {
    try { return Xdf.readRawCell(it, r, c, App.state.bin, App.state.xdf); }
    catch (e) { return null; }
  }
  function cellOrigVal(it, r, c) {
    try { return Xdf.readCell(it, r, c, App.state.orig, App.state.xdf); }
    catch (e) { return null; }
  }
  function isDirty(it, r, c) {
    if (!App.state.bin || !App.state.orig) return false;
    return cellRaw(it, r, c) !== Xdf.readRawCell(it, r, c, App.state.orig, App.state.xdf);
  }
  function origBytes() { return App.state.orig; }
  function dec(it) {
    if (it.kind === 'flag') return 0;
    return Math.max(0, Math.min(8, it.decimals == null ? 2 : it.decimals));
  }
  function valText(it, v) {
    if (it.kind === 'flag') return v ? 'ON' : 'OFF';
    if (v == null) return '—';
    if (typeof v === 'string') return v;
    return Xdf.formatValue(v, it.decimals == null ? 2 : it.decimals, it.outputType);
  }
  function axisText(v, axis) {
    if (v == null) return '—';
    if (typeof v === 'number') {
      return axis ? Xdf.formatValue(v, axis.decimals, axis.outputType)
        : ((Math.abs(v) < 10 && v % 1 !== 0) ? v.toFixed(1) : String(Math.round(v)));
    }
    return String(v);
  }
 
  /* ---------------- render ---------------- */
  function render() {
    bindOnce();
    const s = App.state;
    const hasBin = !!s.bin;
    const hasXdf = !!s.xdf;
 
    if (hasXdf && hasBin && window.Xdf && typeof Xdf.resolve === 'function') {
      Xdf.resolve(s.xdf, s.bin);
    }
 
    const binChip = document.getElementById('fBinChip');
    const xdfChip = document.getElementById('fXdfChip');
    binChip.classList.toggle('filled', hasBin);
    xdfChip.classList.toggle('filled', hasXdf);
    document.getElementById('fBinName').textContent = hasBin ? s.binName : 'โหลดไฟล์ .bin';
    document.getElementById('fBinMeta').textContent = hasBin
      ? App.kb(s.bin.length) + ' · ' + s.items.length + ' รายการ'
      : 'ไฟล์ firmware / แผนที่ ECU';
    document.getElementById('fXdfName').textContent = hasXdf ? s.xdfName : 'โหลดไฟล์ .xdf';
    document.getElementById('fXdfMeta').textContent = hasXdf
      ? (s.xdf.items.length + ' ตาราง · ' + (s.xdf.version || 'XDF'))
      : 'คำนิยามตาราง (TunerPro)';
 
    document.getElementById('tuneEmpty').hidden = hasBin;
    document.getElementById('tuneBody').hidden = !hasBin;
 
    const note = document.getElementById('tuneNote');
    let langFix = false;
    if (hasBin) {
      let txt = '', show = true;
      if (!hasXdf) {
        txt = '<b>ยังไม่มี XDF:</b> กำลังแสดงตารางที่สแกนจากไบต์ในไฟล์';
      } else if (s.scanOnly) {
        txt = '<b>XDF ไม่มีตารางที่อ่านได้</b> — ใช้โหมดสแกนอัตโนมัติแทน';
      } else {
        txt = '<b>' + App.esc(s.xdf.title || s.xdfName) + '</b> · ' + App.esc(s.xdf.author || 'ไม่ระบุผู้ทำ') +
          '<br>ค่าในตารางเป็นหน่วยจริงตามสูตรใน XDF · แตะช่องเพื่อแก้ค่า';
        show = true;
      }
      note.innerHTML = txt;
      note.hidden = !show;
    }
 
    if (!hasBin) return;
    const it = item();
    if (!it) return;
 
    document.getElementById('mapCount').textContent = '(' + (s.mapIdx + 1) + '/' + s.items.length + ')';
    document.getElementById('mapTitle').textContent = it.title;
    document.getElementById('mapMeta').textContent =
      Xdf.fmtHex(it.address) + ' · ' + it.rows + '×' + it.cols + ' · ' +
      (it.sizeBits) + ' bit' + (it.units ? ' · ' + it.units : '');
    document.getElementById('mapChanged').textContent = it.changed || 0;
    document.getElementById('btnUndo').style.opacity = s.undo.length ? 1 : 0.45;
    document.getElementById('btnRedo').style.opacity = s.redo.length ? 1 : 0.45;
 
    if (mode === 'table') renderTable(it);
    else { renderSurface(it); }
    renderCellInfo(it);
  }
 
  function renderTable(it) {
    const wrap = document.getElementById('tableWrap');
    const table = document.getElementById('mapGrid');
    wrap.hidden = false;
    document.getElementById('surface3d').hidden = true;
    document.getElementById('surfBar').hidden = true;
 
    const range = App.mapValueRange(it);
    lastRange = range;
    const span = range.max - range.min || 1;
    if (sel.r >= it.rows) sel.r = 0;
    if (sel.c >= it.cols) sel.c = 0;
 
    // แกนจริงจาก XDF แบบเดียวกับ TunerPro: X อยู่ด้านบน (เช่น TPS), Y อยู่ด้านซ้าย (เช่น RPM)
    const topLabels = it.x && it.x.length === it.cols ? it.x : Array.from({ length: it.cols }, (_, i) => i);
    const sideLabels = it.y && it.y.length === it.rows ? it.y : Array.from({ length: it.rows }, (_, i) => i);
    const xAxis = it.axes && it.axes.x, yAxis = it.axes && it.axes.y;
 
    let html = '<thead><tr><th class="corner"></th>';
    for (let c = 0; c < it.cols; c++) {
      html += '<th class="' + (c === sel.c ? 'sel' : '') + '">' + axisText(topLabels[c], xAxis) + '</th>';
    }
    html += '</tr></thead><tbody>';
 
    for (let r = 0; r < it.rows; r++) {
      html += '<tr><td class="axis ' + (r === sel.r ? 'sel' : '') + '">' + axisText(sideLabels[r], yAxis) + '</td>';
      for (let c = 0; c < it.cols; c++) {
        const v = cellVal(it, r, c);
        const t = v == null ? 0 : (v - range.min) / span;
        const dirty = isDirty(it, r, c);
        const bg = v == null ? '#131B22' : App.heatCss(t, 0.30 + Math.min(0.25, Math.abs(t - 0.5) * 0.3));
        
        const isSelectedRange = r >= selectedRange.minR && r <= selectedRange.maxR && c >= selectedRange.minC && c <= selectedRange.maxC;
        const isSel = r === sel.r && c === sel.c;
 
        html += '<td class="cell' + (isSel ? ' sel' : '') + (isSelectedRange ? ' selected-range' : '') + (dirty ? ' dirty' : '') +
          '" data-r="' + r + '" data-c="' + c + '" style="background:' + bg + '">' +
          (it.kind === 'flag' ? (v ? 'ON' : 'OFF') : valText(it, v)) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody>';
    table.innerHTML = html;
  }
 
  function renderCellInfo(it) {
    const v = cellVal(it, sel.r, sel.c);
    const raw = cellRaw(it, sel.r, sel.c);
    const addr = Xdf.cellAddr(it, sel.r, sel.c);
    const o = cellOrigVal(it, sel.r, sel.c);
    const changed = raw !== null && raw !== Xdf.readRawCell(it, sel.r, sel.c, origBytes(), def());
    document.getElementById('cellInfo').innerHTML =
      'ช่อง <b>' + (sel.r + 1) + '/' + (sel.c + 1) + '</b>' +
      ' · <b>' + App.esc(valText(it, v)) + (it.units ? ' ' + App.esc(it.units) : '') + '</b>' +
      ' · ' + Xdf.fmtHex(addr);
  }
 
  /* ---------------- editing ---------------- */
  function writeCellValue(it, r, c, value, label) {
    App.beginEdit();
    const ok = Xdf.setCell(it, r, c, value, App.state.bin);
    if (!ok) { App.pending = null; App.toast('เขียนค่าไม่ได้ (นอกช่วงหรือไบต์ไม่พอ)', 'bad'); return false; }
    const done = App.commitEdit(label);
    if (!done) { App.toast('ค่าไม่เปลี่ยน'); }
    return done;
  }
 
  function editSheet(it, r, c) {
    const v = cellVal(it, r, c);
    const isFlag = it.kind === 'flag';
    App.sheet(
      '<div class="sh-head"><b>' + App.esc(it.title) + '</b>' +
      '<span class="mono" style="font-size:9px;color:var(--dim2);margin-left:auto">row ' + (r + 1) + ' · col ' + (c + 1) + '</span>' +
      '<button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub" id="editSub">' + Xdf.fmtHex(Xdf.cellAddr(it, r, c)) + '</div>' +
      (isFlag
        ? '<div class="row" style="margin-bottom:8px"><button class="btn wide" id="btnToggle">' + (v ? 'ปิดสวิตช์ (OFF)' : 'เปิดสวิตช์ (ON)') + '</button></div>'
        : '<input class="inp big" id="cellValue" type="text" inputmode="decimal" value="' + (v == null ? '' : valText(it, v)) + '">' +
          '<div class="steps4" id="cellSteps" style="margin-top:8px">' +
          '<button data-d="-' + (dec(it) ? 1 : 10) + '">-' + (dec(it) ? 1 : 10) + '</button>' +
          '<button data-d="-1">-1</button><button data-d="1">+1</button>' +
          '<button data-d="' + (dec(it) ? 1 : 10) + '">+' + (dec(it) ? 1 : 10) + '</button></div>') +
      '<div class="lbl">จัดการช่องนี้</div>' +
      '<div class="row tight" style="margin-bottom:7px">' +
      '<button class="btn sm" id="btnSet">ใช้ค่านี้</button>' +
      '<button class="btn sm" id="btnResetCell">คืนค่าเดิม</button>' +
      '</div>'
    );
 
    const valInput = document.getElementById('cellValue');
    const readVal = () => {
      if (!valInput) return v;
      const n = parseFloat(String(valInput.value).replace(',', '.'));
      return isNaN(n) ? v : n;
    };
    if (valInput) valInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
 
    function apply() {
      const nv = readVal();
      if (writeCellValue(it, r, c, nv, 'แก้ช่อง ' + (r + 1) + ',' + (c + 1))) {
        App.closeSheet();
        App.toast('อัปเดตค่าแล้ว', 'good');
        render();
      }
    }
    const setBtn = document.getElementById('btnSet');
    if (setBtn) setBtn.onclick = apply;
    const rc = document.getElementById('btnResetCell');
    if (rc) rc.onclick = () => {
      const ov = cellOrigVal(it, r, c);
      if (ov == null) return;
      writeCellValue(it, r, c, ov, 'คืนค่าเดิม');
      App.closeSheet(); render();
    };
    document.querySelectorAll('#cellSteps button').forEach(b => b.onclick = () => {
      const d = parseFloat(b.dataset.d);
      const cur = readVal() + d;
      if (valInput) valInput.value = Number.isInteger(cur) ? cur : cur.toFixed(2);
    });
  }
 
  /* ---------------- 3D surface & Line Graph (สไตล์ TunerPro) ---------------- */
  const GRAPH_BG = '#ffffff';
 
  function lerpStops(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i], f = (t - a[0]) / ((b[0] - a[0]) || 1);
        return a[1].map((v, k) => Math.round(v + (b[1][k] - v) * f));
      }
    }
    return stops[stops.length - 1][1];
  }
  // ไล่สีแบบ TunerPro: น้ำเงิน -> ฟ้า -> เขียว -> เขียวสว่าง
  const SURF_STOPS = [[0, [0, 40, 255]], [0.33, [0, 200, 255]], [0.66, [0, 255, 110]], [1, [150, 255, 0]]];
  function surfColor(t) { const c = lerpStops(SURF_STOPS, t); return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
 
  function isVector(it) { return it.cols === 1 || it.rows === 1; }
  function vecCell(it, i) { return it.cols === 1 ? [i, 0] : [0, i]; }
  function vecLen(it) { return it.cols === 1 ? it.rows : it.cols; }
  function numFmt(v, span) {
    if (span < 5) return v.toFixed(2);
    if (span < 50) return v.toFixed(1);
    return String(Math.round(v));
  }
  function niceCeil(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : n <= 7.5 ? 7.5 : 10) * p;
  }
 
  function renderSurface(it) {
    document.getElementById('tableWrap').hidden = true;
    const cv = document.getElementById('surface3d');
    if (!cv) return;
    cv.hidden = false;
    const bar = document.getElementById('surfBar');
    bar.hidden = false;
    surf.canvas = cv;
 
    const range = App.mapValueRange(it);
    lastRange = range;
    document.getElementById('surfMin').textContent = App.fmt(range.min, 1);
    document.getElementById('surfMax').textContent = App.fmt(range.max, 1);
    const vec = isVector(it);
    const legend = bar.querySelector('.legendbar');
    if (legend) legend.style.background = vec ? 'transparent'
      : 'linear-gradient(90deg,#0028ff,#00c8ff,#00ff6e,#96ff00)';
    if (bar.lastElementChild) bar.lastElementChild.textContent = vec ? 'ลากจุดขึ้น-ลงเพื่อแก้ค่า' : 'ลากเพื่อหมุน · ล้อเมาส์ซูม';
 
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = GRAPH_BG;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(it.title || '', w / 2, 20, w - 20);
 
    if (vec) drawLineGraph(ctx, cv, it, w, h);
    else drawSurface3D(ctx, cv, it, w, h, range);
  }
 
  /* ----- กราฟเส้น 2D (ตาราง 1 มิติ เช่น Breakpoints) ลากจุดได้ ----- */
  function drawLineGraph(ctx, cv, it, w, h) {
    const n = vecLen(it);
    const vals = [], labels = [];
    for (let i = 0; i < n; i++) {
      const [r, c] = vecCell(it, i);
      const v = cellVal(it, r, c);
      vals.push(typeof v === 'number' ? v : 0);
      let o = null;
      if (App.state.orig) { try { o = Xdf.readCell(it, r, c, App.state.orig, App.state.xdf); } catch (e) {} }
      labels.push(typeof o === 'number' ? o : (typeof v === 'number' ? v : i));
    }
    const dmin = Math.min.apply(null, vals), dmax = Math.max.apply(null, vals);
    let lo = dmin < 0 ? -niceCeil(-dmin) : 0, hi = niceCeil(Math.max(dmax, 1e-9));
    if (cv._dragRange) { lo = cv._dragRange.lo; hi = cv._dragRange.hi; }
    const span = hi - lo || 1;
 
    const padL = 52, padR = 22, padT = 36, padB = 58;
    const gw = w - padL - padR, gh = h - padT - padB;
 
    // ตำแหน่งแกน X สัดส่วนตามค่าป้าย (เหมือนจูนโปร) ถ้าเรียงจากน้อยไปมาก
    let mono = true;
    for (let i = 1; i < n; i++) if (labels[i] < labels[i - 1]) mono = false;
    const lmin = Math.min.apply(null, labels), lmax = Math.max.apply(null, labels);
    const px = labels.map((l, i) => padL + 8 + ((mono && lmax > lmin ? (l - lmin) / (lmax - lmin) : i / (n - 1 || 1)) * (gw - 16)));
    const py = (v) => padT + gh - ((v - lo) / span) * gh;
 
    // เส้นกริด + แกน Y
    ctx.lineWidth = 1;
    ctx.font = '10px Arial, sans-serif';
    const ticks = 8;
    ctx.setLineDash([3, 3]);
    for (let i = 0; i <= ticks; i++) {
      const v = lo + (span * i) / ticks, y = py(v);
      ctx.strokeStyle = '#d4d4d4';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#000'; ctx.textAlign = 'right';
      ctx.fillText(numFmt(v, span), padL - 6, y + 3);
    }
    px.forEach((x) => { ctx.strokeStyle = '#e2e2e2'; ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + gh); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + gh); ctx.lineTo(w - padR + 8, padT + gh); ctx.stroke();
 
    // ป้ายแกน X (ค่าเดิม ตั้งแนวตั้ง) กันตัวเลขซ้อนกัน
    let lastX = -99;
    const xAxis = it.axes && it.axes.z;
    labels.forEach((l, i) => {
      if (px[i] - lastX < 11 && i !== n - 1) return;
      lastX = px[i];
      ctx.save(); ctx.translate(px[i] + 3, padT + gh + 6); ctx.rotate(Math.PI / 2);
      ctx.fillStyle = i === sel.r || i === sel.c && it.rows === 1 ? '#0000ff' : '#000';
      ctx.font = '10px Arial, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(valText(it, l), 0, 0);
      ctx.restore();
    });
 
    // เส้นกราฟ + จุด
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    vals.forEach((v, i) => { const x = px[i], y = py(v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    const selI = it.cols === 1 ? sel.r : sel.c;
    vals.forEach((v, i) => {
      const x = px[i], y = py(v), on = i === selI;
      ctx.beginPath(); ctx.arc(x, y, on ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#e00000' : '#fff'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.stroke();
      if (on) {
        ctx.fillStyle = '#0000ff'; ctx.font = 'bold 11px Arial, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(valText(it, v), x, y - 10);
      }
    });
    cv._lineGraphData = { px, padT, gh, lo, hi, n };
  }
 
  /* ----- พื้นผิว 3D ----- */
  function drawSurface3D(ctx, cv, it, w, h, range) {
    cv._lineGraphData = null;
    const rows = it.rows, cols = it.cols;
    const span = range.max - range.min || 1;
    const zn = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const v = cellVal(it, r, c);
        row.push(typeof v === 'number' ? (v - range.min) / span : 0);
      }
      zn.push(row);
    }
 
    const H = 0.6;
    const S = Math.min(w * 0.38, h * 0.42) * surf.scale;
    const cx = w / 2 + surf.panX, cy = h * 0.52 + surf.panY;
    const cY = Math.cos(surf.yaw), sY = Math.sin(surf.yaw);
    const cP = Math.cos(surf.pitch), sP = Math.sin(surf.pitch);
    // u = แกน X (คอลัมน์ เช่น TPS), v = แกน Y (แถว เช่น RPM), z = ค่า (0..H)
    const P = (u, v, z) => {
      const x1 = u * cY - v * sY, d = u * sY + v * cY, pz = z - H / 2;
      return { x: cx + x1 * S, y: cy - (pz * cP + d * sP) * S, d: d };
    };
    const U = (c) => (cols > 1 ? c / (cols - 1) : 0.5) - 0.5;
    const V = (r) => (rows > 1 ? r / (rows - 1) : 0.5) - 0.5;
    const poly = (pts, fill, stroke) => {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    };
    const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
 
    // ผนังด้านหลัง 2 ด้าน + พื้น
    const uw = (sY >= 0) ? 0.5 : -0.5;   // ผนังแกน u ที่อยู่ไกลกว่า
    const vw = (cY >= 0) ? 0.5 : -0.5;   // ผนังแกน v ที่อยู่ไกลกว่า
    const ZT = 6;
    ctx.lineWidth = 1;
    poly([P(-.5, -.5, 0), P(.5, -.5, 0), P(.5, .5, 0), P(-.5, .5, 0)], '#f3f3f3', '#888');
    poly([P(uw, -.5, 0), P(uw, .5, 0), P(uw, .5, H), P(uw, -.5, H)], '#fbfbfb', '#888');
    poly([P(-.5, vw, 0), P(.5, vw, 0), P(.5, vw, H), P(-.5, vw, H)], '#fbfbfb', '#888');
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#bdbdbd';
    for (let i = 1; i < ZT; i++) {
      const z = (H * i) / ZT;
      line(P(uw, -.5, z), P(uw, .5, z));
      line(P(-.5, vw, z), P(.5, vw, z));
    }
    for (let i = 1; i < 8; i++) {
      const t = i / 8 - 0.5;
      line(P(uw, t, 0), P(uw, t, H));
      line(P(t, vw, 0), P(t, vw, H));
    }
    ctx.setLineDash([]);
 
    // พื้นผิว เรียงไกล -> ใกล้
    const quads = [];
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const pts = [
        P(U(c), V(r), zn[r][c] * H), P(U(c + 1), V(r), zn[r][c + 1] * H),
        P(U(c + 1), V(r + 1), zn[r + 1][c + 1] * H), P(U(c), V(r + 1), zn[r + 1][c] * H)];
      quads.push({ pts, avg: (zn[r][c] + zn[r][c + 1] + zn[r + 1][c + 1] + zn[r + 1][c]) / 4,
        d: (pts[0].d + pts[1].d + pts[2].d + pts[3].d) / 4 });
    }
    quads.sort((a, b) => b.d - a.d);
    ctx.lineWidth = quads.length > 900 ? 0.5 : 0.8;
    quads.forEach((q) => poly(q.pts, surfColor(q.avg), '#000'));
 
    // ป้ายแกน
    const corners = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map((k) => ({ u: k[0], v: k[1], p: P(k[0], k[1], 0) }));
    const near = corners.reduce((a, b) => (b.p.d < a.p.d ? b : a));
    const mx = (corners.reduce((s, k) => s + k.p.x, 0) / 4), my = (corners.reduce((s, k) => s + k.p.y, 0) / 4);
    const away = (p, dist) => { const dx = p.x - mx, dy = p.y - my, l = Math.hypot(dx, dy) || 1; return { x: p.x + dx / l * dist, y: p.y + dy / l * dist }; };
    const xAx = it.axes && it.axes.x, yAx = it.axes && it.axes.y;
    const tickIdx = (n) => { const step = Math.max(1, Math.ceil(n / 8)), a = []; for (let i = 0; i < n; i += step) a.push(i); if (a[a.length - 1] !== n - 1) a.push(n - 1); return a; };
    ctx.font = '10px Arial, sans-serif'; ctx.textAlign = 'center';
    const xl = it.x || [], yl = it.y || [];
    tickIdx(cols).forEach((c) => {         // แกน X (ดำ) ตามขอบพื้นที่ใกล้ผู้ดู
      const t = away(P(U(c), near.v, 0), 12);
      ctx.fillStyle = '#000';
      ctx.fillText(typeof xl[c] === 'number' ? Xdf.formatValue(xl[c], xAx ? xAx.decimals : 1, xAx ? xAx.outputType : 1) : String(c), t.x, t.y + 3);
    });
    tickIdx(rows).forEach((r) => {         // แกน Y (แดง)
      const t = away(P(near.u, V(r), 0), 14);
      ctx.fillStyle = '#e00000';
      ctx.fillText(typeof yl[r] === 'number' ? Xdf.formatValue(yl[r], yAx ? yAx.decimals : 0, yAx ? yAx.outputType : 1) : String(r), t.x, t.y + 3);
    });
    const left = corners.reduce((a, b) => (b.p.x < a.p.x ? b : a));
    const right = corners.reduce((a, b) => (b.p.x > a.p.x ? b : a));
    ctx.fillStyle = '#0000ff';
    for (let i = 0; i <= ZT; i++) {          // แกน Z (น้ำเงิน) ซ้าย/ขวา
      const val = range.min + (span * i) / ZT, z = (H * i) / ZT, txt = numFmt(val, span);
      const a = P(left.u, left.v, z), b = P(right.u, right.v, z);
      ctx.textAlign = 'right'; ctx.fillText(txt, a.x - 6, a.y + 3);
      ctx.textAlign = 'left'; ctx.fillText(txt, b.x + 6, b.y + 3);
    }
 
    // จุดที่เลือก
    if (zn[sel.r] && zn[sel.r][sel.c] != null) {
      const m = P(U(sel.c), V(sel.r), zn[sel.r][sel.c] * H);
      ctx.beginPath(); ctx.arc(m.x, m.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#e00000'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
 
  /* --- ลากจุดบนกราฟ 2D, หมุน/ซูม 3D --- */
  function bindSurfaceDrag() {
    const cv = document.getElementById('surface3d');
    if (!cv) return;
    cv.style.touchAction = 'none';
    const pointers = new Map();
    let drag = null;   // { i } เมื่อกำลังลากจุดบนกราฟ 2D
 
    function localXY(e) { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
    function dragTo(e) {
      const it = item(), g = cv._lineGraphData;
      if (!it || !g || !drag) return;
      const p = localXY(e);
      const t = Math.max(0, Math.min(1, (g.padT + g.gh - p.y) / g.gh));
      const value = g.lo + t * (g.hi - g.lo);
      const [r, c] = vecCell(it, drag.i);
      Xdf.setCell(it, r, c, value, App.state.bin);
      renderSurface(it);
      renderCellInfo(it);
    }
 
    cv.addEventListener('wheel', (e) => {
      const it = item(); if (!it || isVector(it)) return;
      e.preventDefault();
      surf.scale = Math.max(0.4, Math.min(4, surf.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
      renderSurface(it);
    }, { passive: false });
 
    cv.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, e);
      const it = item();
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      if (it && isVector(it) && cv._lineGraphData) {
        const g = cv._lineGraphData, p = localXY(e);
        let best = 0, bd = Infinity;
        g.px.forEach((x, i) => { const d = Math.abs(x - p.x); if (d < bd) { bd = d; best = i; } });
        const [r, c] = vecCell(it, best);
        sel.r = r; sel.c = c;
        cv._dragRange = { lo: g.lo, hi: g.hi };   // ล็อกสเกลแกน Y ระหว่างลาก
        App.beginEdit();
        drag = { i: best };
        dragTo(e);
        e.preventDefault();
        return;
      }
      if (pointers.size === 1) { surf.dragging = true; surf.lastX = e.clientX; surf.lastY = e.clientY; }
    });
 
    cv.addEventListener('pointermove', (e) => {
      pointers.set(e.pointerId, e);
      if (drag) { dragTo(e); return; }
      const it = item();
      if (pointers.size === 2 && it && !isVector(it)) {
        const a = Array.from(pointers.values());
        const dist = Math.hypot(a[0].clientX - a[1].clientX, a[0].clientY - a[1].clientY);
        if (surf.pinchDist > 0) { surf.scale = Math.max(0.4, Math.min(4, surf.scale * dist / surf.pinchDist)); renderSurface(it); }
        surf.pinchDist = dist;
        return;
      }
      if (!surf.dragging || pointers.size !== 1 || !it) return;
      surf.yaw += (e.clientX - surf.lastX) * 0.012;
      surf.pitch = Math.max(0.1, Math.min(1.5, surf.pitch + (e.clientY - surf.lastY) * 0.008));
      surf.lastX = e.clientX; surf.lastY = e.clientY;
      renderSurface(it);
    });
 
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) surf.pinchDist = 0;
      if (pointers.size === 0) {
        surf.dragging = false;
        if (drag) {
          drag = null; cv._dragRange = null;
          App.commitEdit('ลากกราฟ');       // บันทึกเป็นการแก้ 1 ครั้ง ย้อนได้
          const it = item(); if (it) { renderSurface(it); renderCellInfo(it); }
        }
      }
      try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }
 
  /* --- ระบบลากเมาส์/สัมผัส คลุมเลือกหลายช่อง (Drag Selection) --- */
  function initGridSelection() {
    const tableWrap = document.getElementById('tableWrap');
    if (!tableWrap || tableWrap.dataset.dragBound) return;
    tableWrap.dataset.dragBound = 'true';
 
    let hasDragged = false;
 
    function getCoords(e) {
      const td = e.target.closest('td.cell');
      if (!td) return null;
      return { r: +td.dataset.r, c: +td.dataset.c };
    }
 
    tableWrap.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const coords = getCoords(e);
      if (!coords) return;
 
      isSelecting = true;
      hasDragged = false;
      startCoords = coords;
      selectedRange = { minR: coords.r, maxR: coords.r, minC: coords.c, maxC: coords.c };
      sel.r = coords.r;
      sel.c = coords.c;
 
      const it = item();
      if (it) renderTable(it);
    });
 
    tableWrap.addEventListener('pointermove', e => {
      if (!isSelecting || !startCoords) return;
      const coords = getCoords(e);
      if (!coords) return;
 
      if (coords.r !== startCoords.r || coords.c !== startCoords.c) {
        hasDragged = true;
      }
 
      selectedRange = {
        minR: Math.min(startCoords.r, coords.r),
        maxR: Math.max(startCoords.r, coords.r),
        minC: Math.min(startCoords.c, coords.c),
        maxC: Math.max(startCoords.c, coords.c)
      };
 
      const it = item();
      if (it) renderTable(it);
    });
 
    const endSelection = e => {
      if (!isSelecting) return;
      isSelecting = false;
      const it = item();
      if (it) {
        renderCellInfo(it);
        // ถ้าเป็นการคลิกปกติ (ไม่ได้ลาก) ให้เปิด sheet แก้ไขช่องเดี่ยว
        if (!hasDragged && startCoords) {
          editSheet(it, startCoords.r, startCoords.c);
        }
      }
    };
 
    window.addEventListener('pointerup', endSelection);
    window.addEventListener('pointercancel', endSelection);
  }
 
  function bindOnce() {
    if (built) return;
    built = true;
 
    document.getElementById('fBinChip').onclick = () => App.pick('bin');
    document.getElementById('fXdfChip').onclick = () => App.pick('xdf');
    document.getElementById('btnPickBin').onclick = () => App.pick('bin');
    document.getElementById('btnPickXdf').onclick = () => App.pick('xdf');
    document.getElementById('btnMaps').onclick = mapsSheet;
    document.getElementById('btnTools').onclick = () => toolsSheet();
    document.getElementById('btnReport').onclick = () => reportSheet();
    document.getElementById('btnUndo').onclick = () => { App.undoEdit(); render(); };
    document.getElementById('btnRedo').onclick = () => { App.redoEdit(); render(); };
    
    const btn3d = document.getElementById('btn3d');
    if (btn3d) {
      btn3d.onclick = function () {
        mode = mode === '3d' ? 'table' : '3d';
        this.classList.toggle('on', mode === '3d');
        this.innerHTML = mode === '3d' ? '▦ ตาราง' : '◢ 3D';
        render();
      };
    }
 
    document.getElementById('btnSaveBin').onclick = saveBin;
    document.getElementById('btnGoFlash').onclick = () => App.go('flash');
 
    initGridSelection();
    bindSurfaceDrag();
 
    App.on('binload', render);
    App.on('binchange', () => { if (App.state.tab === 'tune') render(); });
    App.on('xdfchange', render);
  }
 
  function saveBin() {
    const s = App.state;
    if (!s.bin) { App.toast('ยังไม่มีไฟล์', 'bad'); return; }
    let name = s.binName || 'ecu.bin';
    const base = name.replace(/\.[^.]+$/, '');
    App.download(base + '-tuned.bin', s.bin);
    App.toast('บันทึก ' + base + '-tuned.bin แล้ว', 'good');
  }
 
  function mapsSheet() {
    const s = App.state;
    const rows = s.items.map((it, i) => {
      return '<button class="item' + (i === s.mapIdx ? ' on' : '') + '" data-i="' + i + '">' +
        '<div style="min-width:0"><div class="nm">' + App.esc(it.title) + '</div>' +
        '<div class="mt">' + Xdf.fmtHex(it.address) + ' · ' + it.rows + '×' + it.cols + '</div></div></button>';
    }).join('');
    App.sheet('<div class="sh-head"><b>ตารางทั้งหมด</b><button class="x" onclick="App.closeSheet()">✕</button></div><div class="list" id="mapList">' + rows + '</div>');
    document.getElementById('mapList').querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
      s.mapIdx = +b.dataset.i;
      sel.r = 0; sel.c = 0;
      selectedRange = { minR: 0, maxR: 0, minC: 0, maxC: 0 };
      App.persist();
      App.closeSheet();
      render();
    });
  }
 
  /* ---------------- เมนูเครื่องมือจูน รองรับการลากคลุมเลือกหลายช่อง (Multi-cell Selection) ---------------- */
  function toolsSheet() {
    const it = item(); if (!it) return;
    
    // ตรวจสอบว่ามีการลากคลุมเลือกช่วงช่องไว้หรือไม่ ถ้าไม่มีให้ใช้ทั้งตาราง
    const hasRange = selectedRange && typeof selectedRange.minR === 'number' && 
                     (selectedRange.minR !== selectedRange.maxR || selectedRange.minC !== selectedRange.maxC);
    
    const rangeText = hasRange ? 
      ` (เฉพาะช่วงที่เลือก Row ${selectedRange.minR+1}-${selectedRange.maxR+1})` : 
      ` (ทั้งตาราง)`;
 
    App.sheet(
      '<div class="sh-head"><b>เครื่องมือจูนตาราง</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub">เลือกคำสั่งคำนวณปรับค่า' + rangeText + '</div>' +
      '<div class="lbl">ปรับเปอร์เซ็นต์ (%)</div>' +
      '<div class="steps4" style="margin-bottom:8px">' +
      '<button class="btnToolPct" data-p="-5">-5%</button>' +
      '<button class="btnToolPct" data-p="-1">-1%</button>' +
      '<button class="btnToolPct" data-p="1">+1%</button>' +
      '<button class="btnToolPct" data-p="5">+5%</button>' +
      '</div>' +
      '<div class="lbl">ปรับค่าคงที่ (+/-)</div>' +
      '<div class="steps4" style="margin-bottom:12px">' +
      '<button class="btnToolAdd" data-a="-10">-10</button>' +
      '<button class="btnToolAdd" data-a="-1">-1</button>' +
      '<button class="btnToolAdd" data-a="1">+1</button>' +
      '<button class="btnToolAdd" data-a="10">+10</button>' +
      '</div>' +
      '<div class="lbl">ฟังก์ชันพิเศษ</div>' +
      '<div class="row tight" style="margin-bottom:8px">' +
      '<button class="btn sm wide" id="btnToolReset">คืนค่าเดิม</button>' +
      '<button class="btn sm wide" id="btnToolSmooth">เกลี่ยค่าเฉลี่ยสโลป (Interpolate XY)</button>' +
      '</div>'
    );
 
    document.querySelectorAll('.btnToolPct').forEach(b => b.onclick = () => {
      const pct = parseFloat(b.dataset.p);
      applyTool((v) => v * (1 + pct / 100), 'ปรับค่า ' + (pct > 0 ? '+' : '') + pct + '%');
    });
 
    document.querySelectorAll('.btnToolAdd').forEach(b => b.onclick = () => {
      const add = parseFloat(b.dataset.a);
      applyTool((v) => v + add, 'ปรับค่า ' + (add > 0 ? '+' : '') + add);
    });
 
    const btnReset = document.getElementById('btnToolReset');
    if (btnReset) btnReset.onclick = () => {
      App.beginEdit();
      let count = 0;
      const minR = hasRange ? selectedRange.minR : 0;
      const maxR = hasRange ? selectedRange.maxR : it.rows - 1;
      const minC = hasRange ? selectedRange.minC : 0;
      const maxC = hasRange ? selectedRange.maxC : it.cols - 1;
 
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const ov = cellOrigVal(it, r, c);
          if (ov != null) {
            Xdf.setCell(it, r, c, ov, App.state.bin);
            count++;
          }
        }
      }
      App.commitEdit('คืนค่าเดิม');
      App.closeSheet();
      App.toast('คืนค่าเดิมสำเร็จ (' + count + ' ช่อง)', 'good');
      render();
    };
 
    const btnSmooth = document.getElementById('btnToolSmooth');
    if (btnSmooth) btnSmooth.onclick = () => {
      App.beginEdit();
      let count = 0;
      const minC = hasRange ? selectedRange.minC : 0;
      const maxC = hasRange ? selectedRange.maxC : it.cols - 1;
      const minR = hasRange ? selectedRange.minR : 0;
      const maxR = hasRange ? selectedRange.maxR : it.rows - 1;
 
      for (let c = minC; c <= maxC; c++) {
        const startVal = cellVal(it, minR, c);
        const endVal = cellVal(it, maxR, c);
        const rowSpan = maxR - minR || 1;
        if (startVal != null && endVal != null) {
          const step = (endVal - startVal) / rowSpan;
          for (let r = minR; r <= maxR; r++) {
            const interpolated = startVal + (step * (r - minR));
            if (Xdf.setCell(it, r, c, interpolated, App.state.bin)) count++;
          }
        }
      }
      App.commitEdit('เกลี่ยค่า Interpolate XY');
      App.closeSheet();
      App.toast('เกลี่ยค่าสโลปสำเร็จ (' + count + ' ช่อง)', 'good');
      render();
    };
 
    function applyTool(fn, label) {
      App.beginEdit();
      let count = 0;
      const minR = hasRange ? selectedRange.minR : 0;
      const maxR = hasRange ? selectedRange.maxR : it.rows - 1;
      const minC = hasRange ? selectedRange.minC : 0;
      const maxC = hasRange ? selectedRange.maxC : it.cols - 1;
 
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const v = cellVal(it, r, c);
          if (v != null) {
            const nv = fn(v);
            if (Xdf.setCell(it, r, c, nv, App.state.bin)) count++;
          }
        }
      }
      if (count > 0) {
        App.commitEdit(label);
        App.toast(label + ' สำเร็จ (' + count + ' ช่อง)', 'good');
      } else {
        App.pending = null;
      }
      App.closeSheet();
      render();
    }
  }
 
  function reportSheet() {
    App.sheet(
      '<div class="sh-head"><b>รายงานรายการปรับแต่ง</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub">แสดงตารางที่มีการแก้ไขทั้งหมดในไฟล์ BIN นี้</div>' +
      '<div class="list" id="reportList"></div>'
    );
    const list = document.getElementById('reportList');
    if (!list) return;
    const items = App.state.items || [];
    let html = '';
    items.forEach((it, i) => {
      let changed = 0;
      for (let r = 0; r < it.rows; r++) {
        for (let c = 0; c < it.cols; c++) {
          if (isDirty(it, r, c)) changed++;
        }
      }
      if (changed > 0) {
        html += '<div class="item" style="cursor:default"><div style="min-width:0">' +
          '<div class="nm">' + App.esc(it.title) + '</div>' +
          '<div class="mt">แก้ไขไป ' + changed + ' ช่อง</div></div></div>';
      }
    });
    list.innerHTML = html || '<div style="padding:15px;text-align:center;color:var(--dim2)">ยังไม่มีการแก้ไขค่าในตารางใดๆ</div>';
  }
 
  App.registerView('tune', { render });
  App.on('binchange', () => App.updateNav());
  App.on('binload', () => setTimeout(render, 0));
})();
