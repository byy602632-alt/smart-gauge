/* ============================================================
   ECU TUNE — tuning screen: maps, table editor, 3D, tools
   ============================================================ */
(function () {
  'use strict';

  const sel = { r: 0, c: 0 };
  let mode = 'table';
  let built = false;
  let xdfError = '';
  const surf = { yaw: -0.62, pitch: 0.95, dragging: false, lastX: 0, lastY: 0, canvas: null };
  let lastRange = { min: 0, max: 1 };

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
    const a = cellRaw(it, r, c);
    const p = Xdf.readRaw(origBytes(), Xdf.cellAddr(it, r, c), it.sizeBits, it.flags, App.state.xdf ? App.state.xdf.defaults : null);
    return a !== p;
  }
  function origBytes() { return App.state.orig; }
  function dec(it) {
    if (it.kind === 'flag') return 0;
    return Math.max(0, Math.min(4, it.decimals || 0));
  }
  function valText(it, v) {
    if (it.kind === 'flag') return v ? 'ON' : 'OFF';
    if (v == null) return '—';
    if (typeof v === 'string') return v;
    const d = dec(it);
    const n = Math.abs(v);
    if (n >= 100000) return v.toExponential(1);
    return v.toFixed(d);
  }
  function axisText(v) {
    if (v == null) return '—';
    if (typeof v === 'number') {
      if (Math.abs(v) >= 1000) return (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k';
      return (Math.abs(v) < 10 && v % 1 !== 0) ? v.toFixed(1) : String(Math.round(v));
    }
    return String(v);
  }

  /* ---------------- render ---------------- */
  function render() {
    bindOnce();
    const s = App.state;
    const hasBin = !!s.bin;
    const hasXdf = !!s.xdf;

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
    if (hasBin) {
      let txt = '', show = true;
      if (!hasXdf) {
        txt = '<b>ยังไม่มี XDF:</b> กำลังแสดงตารางที่สแกนจากไบต์ในไฟล์ (16×16) — ตำแหน่ง/สเกลเป็นเพียงจุดเริ่มต้น ' +
          'โหลด .xdf ของรุ่นเพื่อให้ได้ชื่อตาราง หน่วย และสเกลที่ถูกต้อง';
        if (xdfError) txt += '<br><br><b>XDF ที่เพิ่งโหลด:</b> ' + App.esc(xdfError) + '<br>ถ้าเป็นไฟล์ XDF ที่เข้ารหัส/ไม่ใช่ XML มาตรฐาน แอปจะใช้โหมดสแกนแทน';
      } else if (s.scanOnly) {
        txt = '<b>XDF ไม่มีตารางที่อ่านได้</b> — ใช้โหมดสแกนอัตโนมัติแทน';
      } else {
        txt = '<b>' + App.esc(s.xdf.title || s.xdfName) + '</b> · ' + App.esc(s.xdf.author || 'ไม่ระบุผู้ทำ') +
          (s.xdf.binSize ? ' · ไฟล์เป้าหมาย ' + App.kb(s.xdf.binSize) : '') +
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
      (it.sizeBits) + ' bit' + (it.units ? ' · ' + it.units : '') +
      (it.scan ? ' · สแกน' : (it.category ? ' · ' + it.category : ''));
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

    const xLabels = it.x || [];
    let html = '<thead><tr><th class="corner"></th>';
    for (let c = 0; c < it.cols; c++) {
      html += '<th class="' + (c === sel.c ? 'sel' : '') + '">' + axisText(xLabels[c] != null ? xLabels[c] : c) + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (let r = 0; r < it.rows; r++) {
      html += '<tr><td class="axis ' + (r === sel.r ? 'sel' : '') + '">' + axisText(it.y ? it.y[r] : r) + '</td>';
      for (let c = 0; c < it.cols; c++) {
        const v = cellVal(it, r, c);
        const t = v == null ? 0 : (v - range.min) / span;
        const dirty = isDirty(it, r, c);
        const bg = v == null ? '#131B22' : App.heatCss(t, 0.30 + Math.min(0.25, Math.abs(t - 0.5) * 0.3));
        const isSel = r === sel.r && c === sel.c;
        html += '<td class="cell' + (isSel ? ' sel' : '') + (dirty ? ' dirty' : '') +
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
    const changed = raw !== null && raw !== Xdf.readRaw(origBytes(), addr, it.sizeBits, it.flags, def() ? def().defaults : null);
    document.getElementById('cellInfo').innerHTML =
      'ช่อง <b>' + (sel.r + 1) + '/' + (sel.c + 1) + '</b>' +
      ' · <b>' + App.esc(valText(it, v)) + (it.units ? ' ' + App.esc(it.units) : '') + '</b>' +
      ' · ' + Xdf.fmtHex(addr) +
      (raw != null ? ' · raw ' + raw : '') +
      (changed ? ' · เดิม ' + App.esc(valText(it, o)) : '') +
      '<span class="sp">' + (it.x ? 'x ' + axisText(it.x[sel.c]) + ' · ' : '') +
      (it.y ? 'y ' + axisText(it.y[sel.r]) : '') + '</span>';
  }

  /* ---------------- editing ---------------- */
  function writeCellValue(it, r, c, value, label) {
    App.beginEdit();
    const ok = Xdf.writeCell(it, r, c, value, App.state.bin, App.state.xdf);
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
      '<div class="sh-sub" id="editSub">' + Xdf.fmtHex(Xdf.cellAddr(it, r, c)) + ' · ' +
      (it.x ? 'x=' + axisText(it.x[c]) + ' · ' : '') + (it.y ? 'y=' + axisText(it.y[r]) + ' · ' : '') +
      (it.units ? 'หน่วย ' + App.esc(it.units) : 'ไม่มีหน่วย') + ' · ค่าเดิม ' + App.esc(valText(it, cellOrigVal(it, r, c))) + '</div>' +
      (isFlag
        ? '<div class="row" style="margin-bottom:8px"><button class="btn wide" id="btnToggle">' + (v ? 'ปิดสวิตช์ (OFF)' : 'เปิดสวิตช์ (ON)') + '</button></div>'
        : '<input class="inp big" id="cellValue" type="text" inputmode="decimal" value="' + (v == null ? '' : v) + '">' +
        '<div class="steps4" id="cellSteps" style="margin-top:8px">' +
        '<button data-d="-' + (dec(it) ? 1 : 10) + '">-' + (dec(it) ? 1 : 10) + '</button>' +
        '<button data-d="-1">-1</button><button data-d="1">+1</button>' +
        '<button data-d="' + (dec(it) ? 1 : 10) + '">+' + (dec(it) ? 1 : 10) + '</button></div>') +
      '<div class="lbl">จัดการช่องนี้</div>' +
      '<div class="row tight" style="margin-bottom:7px">' +
      '<button class="btn sm" id="btnSet">ใช้ค่านี้</button>' +
      '<button class="btn sm" id="btnResetCell">คืนค่าเดิม</button>' +
      '</div>' +
      '<div class="row tight">' +
      '<button class="btn sm" id="btnFillRow">เติมทั้งแถว</button>' +
      '<button class="btn sm" id="btnRowPct">แถวนี้ ±%</button>' +
      '</div>' +
      '<div class="sh-sub" style="margin-top:10px">ค่าแสดงเป็นหน่วยจริง ปัดเป็นจำนวนเต็มของไบต์ให้อัตโนมัติ</div>'
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
    const tog = document.getElementById('btnToggle');
    if (tog) tog.onclick = () => {
      writeCellValue(it, r, c, v ? 0 : 1, 'สวิตช์');
      App.closeSheet(); render();
    };
    document.querySelectorAll('#cellSteps button').forEach(b => b.onclick = () => {
      const d = parseFloat(b.dataset.d);
      const cur = readVal() + d;
      if (valInput) valInput.value = Number.isInteger(cur) ? cur : cur.toFixed(2);
    });
    const rc = document.getElementById('btnResetCell');
    if (rc) rc.onclick = () => {
      const ov = cellOrigVal(it, r, c);
      if (ov == null) return;
      writeCellValue(it, r, c, ov, 'คืนค่าเดิม');
      App.closeSheet(); render();
    };
    const fr = document.getElementById('btnFillRow');
    if (fr) fr.onclick = () => {
      const nv = readVal();
      App.beginEdit();
      for (let cc = 0; cc < it.cols; cc++) Xdf.writeCell(it, r, cc, nv, App.state.bin, App.state.xdf);
      App.commitEdit('เติมแถว');
      App.closeSheet(); render();
      App.toast('เติมทั้งแถวแล้ว');
    };
    const rp = document.getElementById('btnRowPct');
    if (rp) rp.onclick = () => { App.closeSheet(); pctSheet('row'); };
  }

  function pctSheet(forceScope) {
    const it = item(); if (!it) return;
    const scope = forceScope || 'map';
    App.sheet(
      '<div class="sh-head"><b>ปรับเป็น %</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub" id="pctSub">' + App.esc(it.title) + ' · ใช้กับค่าที่แสดง (หน่วยจริง)</div>' +
      '<div class="seg" id="pctScope" style="margin-bottom:10px">' +
      '<button data-s="map" class="' + (scope === 'map' ? 'on' : '') + '">ทั้งตาราง</button>' +
      '<button data-s="row" class="' + (scope === 'row' ? 'on' : '') + '">แถวที่เลือก</button>' +
      '<button data-s="col" class="' + (scope === 'col' ? 'on' : '') + '">คอลัมน์ที่เลือก</button>' +
      '</div>' +
      '<div class="pctgrid">' +
      '<button data-p="-10">−10%</button><button data-p="-5">−5%</button>' +
      '<button data-p="-2">−2%</button><button data-p="2">+2%</button>' +
      '<button data-p="5">+5%</button><button data-p="10">+10%</button>' +
      '</div>' +
      '<div class="lbl">หรือใส่ตัวเลขเอง</div>' +
      '<div class="row"><input class="inp" id="pctInput" type="number" inputmode="decimal" placeholder="เช่น 3 หรือ -2.5">' +
      '<button class="btn primary" id="pctGo" style="flex:0 0 100px">ใช้</button></div>' +
      '<div class="sh-sub" style="margin-top:10px">ค่าใหม่ = ค่าเดิม × (1 + %) · ปัดตามความละเอียดของไบต์</div>'
    );
    let curScope = scope;
    document.querySelectorAll('#pctScope button').forEach(b => b.onclick = () => {
      curScope = b.dataset.s;
      document.querySelectorAll('#pctScope button').forEach(x => x.classList.toggle('on', x === b));
    });
    function run(p) {
      if (!isFinite(p) || p === 0) return;
      const rows = curScope === 'row' ? [sel.r] : Array.from({ length: it.rows }, (_, i) => i);
      const cols = curScope === 'col' ? [sel.c] : Array.from({ length: it.cols }, (_, i) => i);
      App.beginEdit();
      let n = 0;
      rows.forEach(r => cols.forEach(c => {
        const v = cellVal(it, r, c);
        if (v == null) return;
        const nv = v * (1 + p / 100);
        if (Xdf.writeCell(it, r, c, nv, App.state.bin, App.state.xdf)) n++;
      }));
      App.commitEdit('ปรับ ' + p + '%');
      App.closeSheet(); render();
      App.toast((p > 0 ? '+' : '') + p + '% · ' + n + ' ช่อง', 'good');
    }
    document.querySelectorAll('.pctgrid button').forEach(b => b.onclick = () => run(parseFloat(b.dataset.p)));
    document.getElementById('pctGo').onclick = () => run(parseFloat(document.getElementById('pctInput').value));
  }

  function smooth(scope, strength) {
    const it = item(); if (!it) return;
    const src = new Float64Array(it.rows * it.cols);
    let bad = false;
    for (let r = 0; r < it.rows; r++) for (let c = 0; c < it.cols; c++) {
      const v = cellVal(it, r, c);
      if (v == null) { bad = true; continue; }
      src[r * it.cols + c] = v;
    }
    if (bad) { App.toast('มีช่องที่อ่านค่าไม่ได้', 'bad'); return; }
    App.beginEdit();
    let n = 0;
    for (let r = 0; r < it.rows; r++) {
      for (let c = 0; c < it.cols; c++) {
        if (scope === 'row' && r !== sel.r) continue;
        if (scope === 'col' && c !== sel.c) continue;
        let sum = 0, w = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= it.rows || cc >= it.cols) continue;
          const weight = (dr === 0 && dc === 0) ? 2 : 1;
          sum += src[rr * it.cols + cc] * weight;
          w += weight;
        }
        const avg = sum / w;
        const mixed = src[r * it.cols + c] * (1 - strength) + avg * strength;
        Xdf.writeCell(it, r, c, mixed, App.state.bin, App.state.xdf);
        n++;
      }
    }
    App.commitEdit('เกลี่ยผิว');
    render();
    App.toast('เกลี่ย ' + n + ' ช่อง · ' + Math.round(strength * 100) + '%', 'good');
  }

  function interpolateRows() {
    const it = item(); if (!it) return;
    if (it.cols < 3) { App.toast('ตารางต้องมีอย่างน้อย 3 คอลัมน์'); return; }
    App.beginEdit();
    for (let r = 0; r < it.rows; r++) {
      const a = cellVal(it, r, 0);
      const b = cellVal(it, r, it.cols - 1);
      if (a == null || b == null) continue;
      for (let c = 1; c < it.cols - 1; c++) {
        const t = c / (it.cols - 1);
        Xdf.writeCell(it, r, c, a + (b - a) * t, App.state.bin, App.state.xdf);
      }
    }
    App.commitEdit('เกลี่ยเส้นตรงตามแถว');
    render();
    App.toast('เติมเส้นตรงทุกแถวแล้ว', 'good');
  }

  function revertMap() {
    const it = item(); if (!it) return;
    App.beginEdit();
    if (it.kind === 'flag') {
      const raw = Xdf.readRaw(origBytes(), it.address, 8, null, def() ? def().defaults : null);
      App.state.bin[it.address] = raw == null ? 0 : raw;
    } else {
      for (let r = 0; r < it.rows; r++) for (let c = 0; c < it.cols; c++) {
        const addr = Xdf.cellAddr(it, r, c);
        const n = Math.max(1, it.sizeBits / 8);
        for (let i = 0; i < n; i++) {
          if (addr + i < App.state.bin.length && addr + i < App.state.orig.length) {
            App.state.bin[addr + i] = App.state.orig[addr + i];
          }
        }
      }
    }
    App.commitEdit('คืนค่าตาราง');
    render();
    App.toast('คืนค่าเฉพาะตารางนี้แล้ว');
  }

  /* ---------------- tools / map list ---------------- */
  function toolsSheet() {
    const it = item(); if (!it) return;
    App.sheet(
      '<div class="sh-head"><b>เครื่องมือจูน</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub">' + App.esc(it.title) + ' · ' + it.rows + '×' + it.cols + '</div>' +
      '<button class="item" data-act="pct" style="margin-bottom:6px"><div><div class="nm">ปรับเป็น %</div>' +
      '<div class="mt">ทั้งตาราง / แถว / คอลัมน์ — เพิ่ม-ลดน้ำมันหรือองศาเป็นเปอร์เซ็นต์</div></div><div class="sp">%</div></button>' +
      '<button class="item" data-act="smooth" style="margin-bottom:6px"><div><div class="nm">เกลี่ยผิวตาราง (Smooth)</div>' +
      '<div class="mt">ลดจุดกระโดดระหว่างช่องติดกัน</div></div><div class="sp">≈</div></button>' +
      '<button class="item" data-act="interp" style="margin-bottom:6px"><div><div class="nm">เกลี่ยเส้นตรงตามแถว</div>' +
      '<div class="mt">ลากค่าจากหัวแถวถึงท้ายแถวเป็นเส้นตรง</div></div><div class="sp">↗</div></button>' +
      '<button class="item" data-act="revertMap" style="margin-bottom:6px"><div><div class="nm">คืนค่าเฉพาะตารางนี้</div>' +
      '<div class="mt">ย้อนค่าทุกช่องในตารางกลับเป็นไฟล์เดิม</div></div><div class="sp">↺</div></button>' +
      '<button class="item" data-act="revertAll"><div><div class="nm">คืนค่าทั้งไฟล์</div>' +
      '<div class="mt">ล้างการแก้ไขทั้งหมด (ย้อนได้)</div></div><div class="sp" style="color:var(--red)">!</div></button>' +
      (App.state.bin ? '<button class="item" data-act="batch" style="margin-top:6px"><div><div class="nm">ใส่หลายแมพทีเดียว (จดจากโปรแกรมอื่น)</div>' +
        '<div class="mt">พิมพ์ชื่อ, offset, แถว, คอลัมน์, ไบต์/ต่อช่อง หลายบรรทัดในครั้งเดียว</div></div><div class="sp">✒</div></button>' : '') +
      (App.state.bin ? '<button class="item" data-act="exportXdf"><div><div class="nm">ส่งออกคำนิยาม XDF (XML)</div>' +
        '<div class="mt">เก็บเป็นไฟล์ .xdf ของตัวเอง โหลดครั้งต่อไปไม่ต้องจดซ้ำ</div></div><div class="sp">⬇</div></button>' : '') +
      (App.state.scanOnly ? '<button class="item" data-act="manual" style="margin-top:6px"><div><div class="nm">กำหนดตารางเอง (แมพเดียว)</div>' +
        '<div class="mt">ใส่ offset / จำนวนแถว-คอลัมน์ / ขนาดช่อง</div></div><div class="sp">＋</div></button>' : '') +
      '<div class="lbl">ช่วงค่าที่แสดง</div>' +
      '<div class="sh-sub mono">min ' + App.fmt(lastRange.min, 1) + ' · max ' + App.fmt(lastRange.max, 1) + '</div>'
    );
    document.querySelectorAll('#sheetBody [data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      App.closeSheet();
      if (a === 'pct') pctSheet('map');
      else if (a === 'smooth') smoothSheet();
      else if (a === 'interp') interpolateRows();
      else if (a === 'revertMap') revertMap();
      else if (a === 'revertAll') { if (confirm('คืนค่าไบต์ทั้งหมดเป็นไฟล์เดิม?')) { App.revertFile(); render(); } }
      else if (a === 'manual') manualTableSheet();
      else if (a === 'batch') batchSheet();
      else if (a === 'exportXdf') App.exportXdf();
    });
  }

  /* ใส่หลายแมพทีเดียว: จดชื่อ/offset มาจากโปรแกรมอื่นแล้ววางเป็นข้อความได้เลย */
  function batchSheet() {
    App.sheet(
      '<div class="sh-head"><b>ใส่หลายแมพทีเดียว</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub">จากโปรแกรมจูนตัวอื่น ให้จดชื่อ + offset + ขนาดของแต่ละแมพ แล้วพิมพ์/วางที่นี่ บรรทัดละแมพ:</div>' +
      '<div class="note blue mono" style="font-size:10px;line-height:1.8">ชื่อ, offset(hex), แถว, คอลัมน์, ไบต์ต่อช่อง, endian(L/M)\n' +
      'แมพน้ำมัน, 116B, 16, 16, 2, L\nแมพองศา, 1200, 8, 8, 1\n# บรรทัดที่ขึ้นต้น # = คำติบาย</div>' +
      '<textarea class="inp" id="batchText" rows="6" placeholder="แมพน้ำมัน, 116B, 16, 16, 2, L" style="margin-top:8px;font-family:JetBrains Mono,monospace;font-size:11px;resize:vertical"></textarea>' +
      '<div class="sh-sub" id="batchErr" style="margin-top:6px;color:#FF817A"></div>' +
      '<div class="row" style="margin-top:8px"><button class="btn primary" id="btnBatchApply">เพิ่มรายการเป็นคำนิยามของฉัน</button></div>' +
      '<div class="sh-sub" style="margin-top:8px">ระบบจะสร้างไฟล์ XDF ของคุณเองในแอป (แก้/ส่งออก/พรีวิวได้ทุกอัน) — ค่าที่แสดงยึดตามเลขในไบต์จริง ถ้าไม่แน่ใจ endian ให้เริ่มที่ L แล้วเทียบกับโปรแกรมเดิม</div>'
    );
    document.getElementById('btnBatchApply').onclick = () => {
      const res = parseBatchLines(document.getElementById('batchText').value, App.state.bin ? App.state.bin.length : 0);
      const errBox = document.getElementById('batchErr');
      if (res.errs.length) { errBox.textContent = res.errs.join('\n'); return; }
      errBox.textContent = '';
      if (!res.items.length) { errBox.textContent = 'ไม่มีบรรทัดที่อ่านได้'; return; }
      const ok = App.applyUserItems(res.items, 'แมพที่จดเอง', 'my-maps.xdf');
      if (ok) { App.closeSheet(); App.go('tune'); render(); }
    };
  }

  function parseBatchLines(text, binLen) {
    const items = [];
    const errs = [];
    String(text || '').split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (!t || t.charAt(0) === '#' || t.slice(0, 2) === '//') return;
      const p = t.split(/[,;\t]+/).map(s => s.trim());
      const addr = parseInt(String(p[1] || '').replace(/^0x/i, ''), 16);
      if (isNaN(addr)) { errs.push('บรรทัด ' + (i + 1) + ': offset ไม่ใช่เลขฐาน 16'); return; }
      const r = Math.max(1, Math.min(128, parseInt(p[2], 10) || 1));
      const c = Math.max(1, Math.min(128, parseInt(p[3], 10) || 1));
      const size = parseInt(p[4], 10) === 1 ? 8 : 16;
      const lsb = !/^m/i.test(p[5] || '');
      const end = addr + r * c * (size / 8);
      if (binLen && end > binLen) { errs.push('บรรทัด ' + (i + 1) + ': เกินขนาดไฟล์ (' + Xdf.fmtHex(end) + ' > ' + Xdf.fmtHex(binLen) + ')'); return; }
      items.push({
        kind: 'table', title: p[0] || ('แมพ ' + (items.length + 1)),
        desc: 'กำหนดเอง', address: addr, rows: r, cols: c, sizeBits: size,
        flags: lsb ? 0x02 : 0, majorBits: 0, minorBits: 0,
        mathSrc: 'X', mathFn: null, units: '', decimals: 0, min: null, max: null,
        category: '', changed: 0
      });
    });
    return { items, errs };
  }

  function smoothSheet() {
    const it = item(); if (!it) return;
    App.sheet(
      '<div class="sh-head"><b>เกลี่ยผิวตาราง</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub">เลือกความแรงและขอบเขต</div>' +
      '<div class="pctgrid" style="margin-bottom:9px">' +
      '<button data-s="row">เฉพาะแถว</button><button data-s="col">เฉพาะคอลัมน์</button>' +
      '<button data-s="map">ทั้งตาราง</button></div>' +
      '<div class="lbl">ความแรง</div>' +
      '<div class="pctgrid">' +
      '<button data-k="0.25">เบา</button><button data-k="0.5">กลาง</button>' +
      '<button data-k="0.85">แรง</button></div>'
    );
    let sc = 'map';
    document.querySelectorAll('#sheetBody .pctgrid')[0].querySelectorAll('button').forEach(b =>
      b.onclick = () => { sc = b.dataset.s; smooth(sc, 0.5); App.closeSheet(); });
    document.querySelectorAll('#sheetBody .pctgrid')[1].querySelectorAll('button').forEach(b =>
      b.onclick = () => { smooth(sc, parseFloat(b.dataset.k)); App.closeSheet(); });
  }

  /* ---------------- XDF / BIN report ---------------- */
  function reportRow(it, i, binLen) {
    const kind = it.kind === 'const' ? 'ค่าคงที่' : it.kind === 'flag' ? 'สวิตช์' : (it.scan ? 'ตาราง (สแกน)' : 'ตาราง');
    const sizeBytes = (it.sizeBits / 8) * it.rows * it.cols;
    const end = it.address + Math.ceil(sizeBytes);
    const oob = binLen != null && end > binLen;
    const warns = [];
    if (oob) warns.push('อยู่นอกขนาดไฟล์ .bin (เกินออกไป ' + (end - binLen) + ' ไบต์)');
    if (!it.hasAxis && !it.scan && it.kind === 'table') warns.push('ไม่มีแกน x/y ใน XDF');
    if (it.mathFn == null && it.kind !== 'flag' && !it.scan) warns.push('ไม่มีสูตรแปลงค่า (แสดงค่าดิบ)');
    return '<div class="item" style="pointer-events:none"><div style="min-width:0">' +
      '<div class="nm">' + (i + 1) + '. ' + App.esc(it.title) + '</div>' +
      '<div class="mt">' + kind + ' · ' + Xdf.fmtHex(it.address) + ' → ' + Xdf.fmtHex(end) +
      ' · ' + it.rows + '×' + it.cols + ' · ' + it.sizeBits + ' bit' +
      (it.units ? ' · ' + App.esc(it.units) : '') +
      (it.decimals ? ' · ' + it.decimals + ' ตำแหน่ง' : '') +
      (it.kind === 'flag' ? ' · mask ' + Xdf.fmtHex(it.mask || 1, 2) : '') +
      (it.min != null ? ' · min ' + App.fmt(it.min) : '') +
      (it.max != null ? ' · max ' + App.fmt(it.max) : '') +
      (it.category ? ' · ' + App.esc(it.category) : '') +
      (it.changed ? ' <span style="color:var(--amber)">· แก้แล้ว ' + it.changed + ' ช่อง</span>' : '') +
      '</div>' +
      (warns.length ? '<div class="mt" style="color:var(--amber)">⚠ ' + warns.join(' · ') + '</div>' : '') +
      '</div><div class="sp">' + (oob ? '<span style="color:var(--red)">✕</span>' : '✓') + '</div></div>';
  }

  function reportSheet() {
    const s = App.state;
    let html = '<div class="sh-head"><b>รายงานผลการอ่านไฟล์</b><button class="x" onclick="App.closeSheet()">✕</button></div>';

    /* ไฟล์ .bin */
    html += '<div class="lbl">ไฟล์ .bin (firmware กล่อง)</div>';
    if (s.bin) {
      const ck = App.checksums(s.bin);
      const mod = App.changedBytes();
      html += '<div class="item" style="pointer-events:none"><div><div class="nm">' + App.esc(s.binName) + '</div>' +
        '<div class="mt">ขนาด ' + App.kb(s.bin.length) + ' (' + s.bin.length.toLocaleString('en-US') + ' ไบต์) · แก้แล้ว ' +
        (mod ? '<span style="color:var(--amber)">' + mod + ' ไบต์</span>' : '0') +
        ' · Sum16 ' + App.hex(ck.sum16, 4) + ' · CRC16 ' + App.hex(ck.crc16, 4) + '</div></div>' +
        '<div class="sp">✓</div></div>';
    } else {
      html += '<div class="sh-sub">ยังไม่มีไฟล์ .bin — โหลดก่อนเพื่ออ่านตารางจากไบต์จริง</div>';
    }

    /* ไฟล์ .xdf */
    html += '<div class="lbl" style="margin-top:8px">ไฟล์ .xdf (คำนิยามตาราง)</div>';
    if (s.xdf) {
      let ok = 0;
      s.items.forEach(it => {
        const end = it.address + Math.ceil((it.sizeBits / 8) * it.rows * it.cols);
        if (s.bin && end <= s.bin.length) ok++;
      });
      const warn = s.items.length - ok;
      html += '<div class="item" style="pointer-events:none"><div><div class="nm">' + App.esc(s.xdf.title || s.xdfName) + '</div>' +
        '<div class="mt">' + App.esc(s.xdfName || '') + ' · เวอร์ชัน ' + App.esc(s.xdf.version || '?') +
        ' · ผู้จัดทำ ' + App.esc(s.xdf.author || 'ไม่ระบุ') +
        (s.xdf.binSize ? ' · ไฟล์เป้าหมาย ' + App.kb(s.xdf.binSize) : '') + '</div>' +
        '<div class="mt">อ่านได้ ' + s.items.length + ' รายการ · ใช้ได้กับไฟล์นี้ ' + ok +
        (warn ? ' <span style="color:var(--amber)">· เกินขนาดไฟล์ ' + warn + '</span>' : '') +
        (s.xdf.checksums && s.xdf.checksums.length ? ' · checksum ที่ระบุ ' + s.xdf.checksums.filter(c => c.valid).length : '') +
        '</div></div>' +
        (s.bin && s.xdf.binSize && s.xdf.binSize !== s.bin.length
          ? '<div class="note red" style="margin-top:6px"><b>⚠ ขนาดไฟล์ไม่ตรง:</b> XDF ระบุไฟล์เป้าหมาย ' + App.kb(s.xdf.binSize) +
          ' แต่ .bin ที่โหลดคือ ' + App.kb(s.bin.length) + ' — อาจไม่ใช่ไฟล์ของกล่องรุ่นนี้</div>' : '');
    } else if (s.xdfLocked) {
      const L = s.xdfLocked;
      html += '<div class="item" style="pointer-events:none"><div><div class="nm" style="color:#FF817A">' + App.esc(L.name) + '</div>' +
        '<div class="mt">ขนาด ' + App.kb(L.size) + ' (' + L.size.toLocaleString('en-US') + ' ไบต์) · ไบต์ต้นไฟล์:' +
        ' <span class="mono" style="font-size:9.5px">' + App.esc(L.magic) + '</span></div></div>' +
        '<div class="sp"><span style="color:var(--red)">✕</span></div></div>' +
        '<div class="note red" style="margin-top:6px"><b>ไม่สามารถอ่านคำนิยามได้:</b> ไฟล์นี้ไม่ใช่ XDF แบบ XML มาตรฐาน (TunerPro) ' +
        'แต่เป็นแฟ้มที่ถูกล็อกด้วยระบบลิขสิทธิ์ของผู้จัดทำ — แอปไม่ถอดรหัสไฟล์ลิขสิทธิ์ของผู้อื่น<br><br>' +
        '<b>ทางแก้:</b> ขอไฟล์ XDF <b>แบบ XML ที่ปลดล็อก</b> จากผู้จัดทำ หรือใช้ XDF ของ TunerPro สำหรับกล่องรุ่นนั้น ' +
        'ขณะนี้แอปใช้<b>โหมดสแกนอัตโนมัติ</b>จากไบต์จริงแทน ชื่อ/หน่วย/สเกลจึงต้องตรวจกับกล่องจริงก่อนแก้ทุกครั้ง</div>';
    } else if (s.xdfLastError) {
      html += '<div class="item" style="pointer-events:none"><div><div class="nm" style="color:#FF817A">' + App.esc(s.xdfName || '(ไฟล์ล่าสุด)') + '</div>' +
        '<div class="mt">ข้อผิดพลาด: ' + App.esc(s.xdfLastError) + '</div></div>' +
        '<div class="sp"><span style="color:var(--red)">✕</span></div></div>';
    } else {
      html += '<div class="sh-sub">ยังไม่ได้โหลดไฟล์ .xdf</div>';
    }

    /* รายการตารางทั้งหมด */
    if (s.bin && s.items.length) {
      html += '<div class="lbl" style="margin-top:8px">รายการทั้งหมด ' + s.items.length + ' รายการ</div>' +
        '<div class="list" style="max-height:46vh">' +
        s.items.map((it, i) => reportRow(it, i, s.bin.length)).join('') + '</div>' +
        '<div class="sh-sub" style="margin-top:6px">✕ = ตำแหน่งที่เกินขนาดไฟล์ .bin — XDF อาจไม่ตรงกับรุ่นกล่อง</div>';
    } else if (s.bin) {
      html += '<div class="sh-sub">ยังไม่พบตาราง/ค่าใดในไฟล์ — ลองกำหนด offset เองในเมนูเครื่องมือ</div>';
    }

    App.sheet(html);
  }

  function mapsSheet() {
    const s = App.state;
    const rows = s.items.map((it, i) => {
      const kind = it.kind === 'const' ? 'ค่าคงที่' : it.kind === 'flag' ? 'สวิตช์' : (it.scan ? 'สแกน' : 'ตาราง');
      return '<button class="item' + (i === s.mapIdx ? ' on' : '') + '" data-i="' + i + '">' +
        '<div style="min-width:0"><div class="nm">' + App.esc(it.title) + '</div>' +
        '<div class="mt">' + kind + ' · ' + Xdf.fmtHex(it.address) + ' · ' + it.rows + '×' + it.cols +
        (it.units ? ' · ' + App.esc(it.units) : '') + '</div></div>' +
        '<div class="sp">' + (it.changed ? '<span style="color:var(--amber)">' + it.changed + '</span>' : '') +
        (i === s.mapIdx ? ' ●' : '') + '</div></button>';
    }).join('');
    App.sheet(
      '<div class="sh-head"><b>ตารางและค่าทั้งหมด</b><span class="mono" style="font-size:9px;color:var(--dim2);margin-left:auto">' +
      s.items.length + '</span><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<input class="search" id="mapSearch" placeholder="ค้นหาชื่อตาราง / หมวด">' +
      '<div class="list" id="mapList">' + rows + '</div>' +
      (s.scanOnly ? '<button class="btn wide" id="btnManual2" style="margin-top:9px">กำหนดตารางเอง</button>' : '')
    );
    const list = document.getElementById('mapList');
    const bind = () => {
      list.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
        s.mapIdx = +b.dataset.i;
        sel.r = 0; sel.c = 0;
        App.persist();
        App.closeSheet();
        render();
      });
    };
    bind();
    const search = document.getElementById('mapSearch');
    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      list.querySelectorAll('[data-i]').forEach(b => {
        const i = +b.dataset.i;
        const it = s.items[i];
        const hay = (it.title + ' ' + (it.category || '')).toLowerCase();
        b.hidden = q && hay.indexOf(q) < 0;
      });
    };
    const m2 = document.getElementById('btnManual2');
    if (m2) m2.onclick = manualTableSheet;
  }

  function manualTableSheet() {
    const s = App.state;
    const it = item();
    App.sheet(
      '<div class="sh-head"><b>กำหนดตารางเอง</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub">ใช้เมื่อไม่มี XDF — ใส่ offset เป็นเลขฐาน 16 เช่น 800</div>' +
      '<div class="lbl">Offset</div><input class="inp" id="mAddr" placeholder="800" value="' + (it ? it.address.toString(16).toUpperCase() : '') + '">' +
      '<div class="row" style="margin-top:9px">' +
      '<div><div class="lbl">แถว</div><input class="inp" id="mRows" type="number" value="16"></div>' +
      '<div><div class="lbl">คอลัมน์</div><input class="inp" id="mCols" type="number" value="16"></div>' +
      '<div><div class="lbl">ไบต์/ช่อง</div><input class="inp" id="mSize" type="number" value="2"></div>' +
      '</div>' +
      '<div class="lbl">Endian</div>' +
      '<div class="seg" id="mEndian"><button data-e="1" class="on">LSB first</button><button data-e="0">MSB first</button></div>' +
      '<button class="btn primary wide" id="mOk" style="margin-top:14px">ใช้ตารางนี้</button>'
    );
    let lsb = 1;
    document.querySelectorAll('#mEndian button').forEach(b => b.onclick = () => {
      lsb = +b.dataset.e;
      document.querySelectorAll('#mEndian button').forEach(x => x.classList.toggle('on', x === b));
    });
    document.getElementById('mOk').onclick = () => {
      const addr = parseInt(document.getElementById('mAddr').value, 16);
      const r = Math.max(1, Math.min(64, parseInt(document.getElementById('mRows').value, 10) || 16));
      const c = Math.max(1, Math.min(64, parseInt(document.getElementById('mCols').value, 10) || 16));
      const size = parseInt(document.getElementById('mSize').value, 10) === 1 ? 8 : 16;
      if (isNaN(addr)) { App.toast('offset ไม่ถูกต้อง', 'bad'); return; }
      const item2 = {
        kind: 'table',
        title: 'กำหนดเอง · ' + Xdf.fmtHex(addr),
        desc: 'ตารางที่ผู้ใช้กำหนด',
        address: addr, rows: r, cols: c, sizeBits: size,
        flags: lsb ? 0x02 : 0,
        majorBits: 0, minorBits: 0,
        mathSrc: 'X', mathFn: null, units: '', decimals: 0, min: null, max: null,
        x: Array.from({ length: c }, (_, i) => i),
        y: Array.from({ length: r }, (_, i) => i),
        hasAxis: false, scan: true, changed: 0
      };
      s.items.push(item2);
      s.mapIdx = s.items.length - 1;
      sel.r = 0; sel.c = 0;
      App.persist();
      App.closeSheet();
      render();
      App.toast('เพิ่มตารางแล้ว', 'good');
    };
  }

  /* ---------------- 3D surface ---------------- */
  function renderSurface(it) {
    document.getElementById('tableWrap').hidden = true;
    const cv = document.getElementById('surface3d');
    cv.hidden = false;
    document.getElementById('surfBar').hidden = false;
    surf.canvas = cv;
    const range = App.mapValueRange(it);
    lastRange = range;
    document.getElementById('surfMin').textContent = App.fmt(range.min, 1);
    document.getElementById('surfMax').textContent = App.fmt(range.max, 1);

    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const rows = it.rows, cols = it.cols;
    const span = range.max - range.min || 1;
    const vals = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const v = cellVal(it, r, c);
        row.push(v == null ? range.min : (v - range.min) / span);
      }
      vals.push(row);
    }

    const scale = Math.min(w / (cols + 3), h / (rows + 3)) * 1.5;
    const cx = w / 2, cy = h * 0.60;
    const height = Math.min(78, h * 0.45);
    const cosY = Math.cos(surf.yaw), sinY = Math.sin(surf.yaw);

    function project(r, c, v) {
      let x = (c - (cols - 1) / 2) * 0.92;
      let z = (r - (rows - 1) / 2) * 0.92;
      const rx = x * cosY - z * sinY;
      const rz = x * sinY + z * cosY;
      const px = cx + rx * scale;
      const py = cy + rz * scale * 0.52 - (v - 0.35) * height;
      return { x: px, y: py, z: rz };
    }

    const quads = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const pts = [
          project(r, c, vals[r][c]),
          project(r, c + 1, vals[r][c + 1]),
          project(r + 1, c + 1, vals[r + 1][c + 1]),
          project(r + 1, c, vals[r + 1][c])
        ];
        const avg = (vals[r][c] + vals[r][c + 1] + vals[r + 1][c + 1] + vals[r + 1][c]) / 4;
        quads.push({ pts, avg, depth: (pts[0].z + pts[1].z + pts[2].z + pts[3].z) / 4 });
      }
    }
    quads.sort((a, b) => a.depth - b.depth);
    quads.forEach(q => {
      const col = App.heat(q.avg);
      ctx.beginPath();
      ctx.moveTo(q.pts[0].x, q.pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(q.pts[i].x, q.pts[i].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(' + col.r + ',' + col.g + ',' + col.b + ',0.82)';
      ctx.strokeStyle = 'rgba(4,10,15,0.45)';
      ctx.lineWidth = 0.8;
      ctx.fill();
      ctx.stroke();
    });
    /* selection marker */
    const m = project(sel.r, sel.c, vals[sel.r][sel.c]);
    ctx.beginPath();
    ctx.arc(m.x, m.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#35C7FF';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function bindSurfaceDrag() {
    const cv = document.getElementById('surface3d');
    cv.addEventListener('pointerdown', e => {
      surf.dragging = true; surf.lastX = e.clientX; surf.lastY = e.clientY;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (!surf.dragging) return;
      surf.yaw += (e.clientX - surf.lastX) * 0.012;
      surf.lastX = e.clientX;
      surf.lastY = e.clientY;
      const it = item();
      if (it) renderSurface(it);
    });
    cv.addEventListener('pointerup', e => { surf.dragging = false; });
    cv.addEventListener('pointercancel', () => { surf.dragging = false; });
  }

  /* ---------------- events ---------------- */
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
    document.getElementById('btn3d').onclick = function () {
      mode = mode === '3d' ? 'table' : '3d';
      this.classList.toggle('on', mode === '3d');
      this.innerHTML = mode === '3d' ? '▦ ตาราง' : '◢ 3D';
      render();
    };
    document.getElementById('btnSaveBin').onclick = saveBin;
    document.getElementById('btnGoFlash').onclick = () => App.go('flash');

    document.getElementById('mapGrid').addEventListener('click', e => {
      const td = e.target.closest('td.cell');
      if (!td) return;
      const it = item(); if (!it) return;
      sel.r = +td.dataset.r; sel.c = +td.dataset.c;
      renderTable(it);
      renderCellInfo(it);
      editSheet(it, sel.r, sel.c);
    });

    bindSurfaceDrag();

    App.on('binload', render);
    App.on('binchange', () => { if (App.state.tab === 'tune') render(); });
    App.on('xdfchange', render);
    App.on('xdferror', e => {
      xdfError = e && e.message ? e.message : 'อ่าน XDF ไม่ได้';
      if (App.state.tab === 'tune') render();
    });
  }

  function saveBin() {
    const s = App.state;
    if (!s.bin) { App.toast('ยังไม่มีไฟล์', 'bad'); return; }
    let name = s.binName || 'ecu.bin';
    const base = name.replace(/\.[^.]+$/, '');
    App.download(base + '-tuned.bin', s.bin);
    App.toast('บันทึก ' + base + '-tuned.bin แล้ว', 'good');
  }

  function lockedSheet() {
    const L = App.state.xdfLocked || {};
    App.sheet(
      '<div class="sh-head"><b>ไฟล์ XDF ที่เปิดไม่ได้</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="note red" style="margin-top:4px"><b>ไฟล์ <span class="mono">' + App.esc(L.name || 'ไฟล์') + '</span> ถูกล็อกด้วยระบบลิขสิทธิ์ (เข้ารหัสทั้งไฟล์)</b><br>' +
      'โปรแกรมหลักของผู้ผลิตจึงเปิดได้ แต่แอปนี้อ่านรายชืื่อตาราง/ตำแหน่งจากมันไม่ได้ — นี่ไม่ใช่ความผิดของไฟล์ .bin ซึ่งใช้งานได้ปกติ<br><br>' +
      '<b>วิธีใช้งานต่อได้ 2 ทาง:</b><br>' +
      '1. เปิดไฟล์ล็อกในโปรแกรมที่เปิดได้ แล้วจดของแต่ละแมพ (ชือ, offset, แถว, คอลัมน์, ไบต์/ช่อง) มาใส่ทีนี่ แก้ค่า+บันทึก .bin ได้เต็มรูปแบบ<br>' +
      '2. ขอไฟล์ XDF <b>แบบ XML ที่ปลดล็อก</b> จากผู้จัดทำ — ยกมาโหลดที่นี่ใช้ได้ทันที</div>' +
      '<button class="item" id="btnLkBatch" style="margin-top:8px"><div><div class="nm">เริ่มเพิ่มแมพเอง (ใส่หลายอันได้)</div>' +
      '<div class="mt">ต้องโหลดไฟล์ .bin ก่อน</div></div><div class="sp">✒</div></button>' +
      '<button class="item" id="btnLkReport"><div><div class="nm">ดูรายงานไฟล์</div>' +
      '<div class="mt">ขนาด/ไบต์ต้นของไฟล์ล็อก · ตารางที่สแกนได้จาก .bin</div></div><div class="sp">≡</div></button>'
    );
    const b = document.getElementById('btnLkBatch');
    if (b) b.onclick = () => {
      if (!App.state.bin) { App.toast('โหลดไฟล์ .bin ก่อน แล้วกลับมาเพิ่มแมพได้เลย', 'bad'); App.closeSheet(); return; }
      App.closeSheet();
      batchSheet();
    };
    const r = document.getElementById('btnLkReport');
    if (r) r.onclick = () => { App.closeSheet(); reportSheet(); };
  }

  App.registerView('tune', { render });
  App.on('binchange', () => App.updateNav());
  App.on('binload', () => setTimeout(render, 0));
  App.on('xdflocked', () => { render(); lockedSheet(); });
})();
