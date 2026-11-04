/* ============================================================
   ECU TUNE — home launcher (tiles / settings / files)
   ============================================================ */
(function (global) {
  'use strict';

  const $ = global.$ || ((s, r) => (r || document).querySelector(s));
  const $$ = global.$$ || ((s, r) => Array.from((r || document).querySelectorAll(s)));

  function setText(id, v) {
    const e = document.getElementById(id);
    if (e && e.textContent !== String(v)) e.textContent = v;
  }

  /* ---------------- status sync ---------------- */
  function syncConn() {
    const src = document.getElementById('connText');
    const chip = document.getElementById('homeConn');
    const txt = document.getElementById('homeConnText');
    const label = src ? src.textContent.trim() : 'เดโม';
    if (txt && txt.textContent !== label) txt.textContent = label;
    if (chip) chip.className = 'pill' + (label === 'ต่อสายแล้ว' ? '' : label === 'หยุดชั่วคราว' ? ' amber' : ' dim');
    setText('tileLive', label);
  }

  function syncHome() {
    const s = App.state;
    const changed = App.changedBytes();
    const maps = s.items ? s.items.length : 0;
    setText('homeSub', s.bin ? ('ไฟล์ ' + s.binName + ' · ' + App.kb(s.bin.length)) : 'ยังไม่โหลดไฟล์ ECU');
    setText('homeBin', s.bin ? s.binName : '—');
    setText('homeChg', changed);
    setText('homeMaps', maps);
    setText('tileTune', s.bin ? (maps + ' ตาราง · ' + changed + ' ไบต์ที่แก้') : 'โหลด .bin เพื่อเริ่มจูน');
    setText('tileFlash', s.bin ? ('พร้อมอัด · ' + App.kb(s.bin.length)) : 'ยังไม่มีไฟล์ให้อัด');
    const files = (s.bin ? 1 : 0) + (s.xdfName || s.xdfLocked ? 1 : 0);
    setText('tileFiles', files ? files + ' ไฟล์ในเครื่อง' : 'ยังไม่มีไฟล์');
    syncConn();
  }

  /* ---------------- sheets ---------------- */
  function addBin() {
    const s = App.state;
    if (!s.bin) { App.toast('ยังไม่มีไฟล์', 'bad'); return; }
    const base = (s.binName || 'ecu.bin').replace(/\.[^.]+$/, '');
    App.download(base + '-tuned.bin', s.bin);
    App.toast('บันทึก ' + base + '-tuned.bin แล้ว', 'good');
  }

  function clearSheet() {
    App.sheet(
      '<div class="sh-head"><b>ล้างข้อมูลในเครื่อง</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="note red">ไฟล์ .bin, .xdf และประวัติการแก้ไขที่เก็บไว้ในเบราว์เซอร์จะถูกลบทั้งหมด ' +
      '— ไฟล์ที่ดาวน์โหลดไว้แล้วไม่หาย</div>' +
      '<div class="row" style="margin-top:12px">' +
      '<button class="btn" id="clCancel">ยกเลิก</button>' +
      '<button class="btn danger" id="clOk">ล้างทั้งหมด</button></div>'
    );
    const c = document.getElementById('clCancel');
    if (c) c.onclick = () => App.closeSheet();
    const ok = document.getElementById('clOk');
    if (ok) ok.onclick = () => {
      App.clearFile();
      App.closeSheet();
      App.toast('ล้างไฟล์ทั้งหมดแล้ว', 'good');
    };
  }

  function filesSheet() {
    const s = App.state;
    const locked = s.xdfLocked;
    const xdfName = s.xdfName || (locked ? locked.name : '');
    const xdfMeta = s.xdfName
      ? (s.items.length + ' รายการ · ' + App.kb(new TextEncoder().encode(s.xdfText || '').length))
      : locked
        ? ('ถูกล็อก/เข้ารหัส · ' + App.kb(locked.size) + ' — อ่านตารางไม่ได้')
        : 'ยังไม่มีคำนิยาม — ใช้การสแกนไบต์หรือเพิ่มแมพเอง';

    App.sheet(
      '<div class="sh-head"><b>ไฟล์ในเครื่อง</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub">ไฟล์ถูกเก็บไว้ในเบราว์เซอร์ของเครื่องนี้ จนกว่าจะล้างข้อมูล</div>' +

      '<div class="lbl">ไฟล์ ECU (.bin)</div>' +
      '<div class="item" style="cursor:default">' +
      '<div style="min-width:0"><div class="nm">' + App.esc(s.bin ? s.binName : 'ยังไม่มีไฟล์ .bin') + '</div>' +
      '<div class="mt">' + (s.bin ? (App.kb(s.bin.length) + ' · ' + App.fmt(s.bin.length) + ' ไบต์ · แก้ ' + App.changedBytes() + ' ไบต์') : 'โหลดไฟล์ที่อ่านจากกล่อง') + '</div></div>' +
      '</div>' +
      '<div class="row" style="margin-top:8px">' +
      '<button class="btn sm" id="flLoadBin">โหลด .bin</button>' +
      (s.bin ? '<button class="btn sm" id="flSaveBin">บันทึก .bin</button>' : '') +
      '</div>' +

      '<div class="lbl">คำนิยามตาราง (.xdf)</div>' +
      '<div class="item" style="cursor:default">' +
      '<div style="min-width:0"><div class="nm">' + App.esc(xdfName || 'ยังไม่มีไฟล์ .xdf') + '</div>' +
      '<div class="mt">' + App.esc(xdfMeta) + '</div></div>' +
      '</div>' +
      '<div class="row" style="margin-top:8px">' +
      '<button class="btn sm" id="flLoadXdf">โหลด .xdf</button>' +
      '<button class="btn sm" id="flExportXdf">ส่งออก .xdf</button>' +
      '</div>' +
      (s.xdfText ? '<div class="row" style="margin-top:8px">' +
        '<button class="btn sm" id="flFixLang">ภาษา / ซ่อมชื่อตาราง</button></div>' : '') +

      (locked ? '<div class="note red" style="margin-top:10px">ไฟล์ XDF นี้เข้ารหัสทั้งไฟล์ แอปจึงอ่านรายชื่อตารางไม่ได้ ' +
        '— ใช้ “จูน ECU → เพิ่มแมพเอง” ระบุ offset/แถว/คอลัมน์แทน</div>' : '') +

      '<div class="row" style="margin-top:12px">' +
      '<button class="btn ghost sm" id="flClear" style="color:var(--red)">ล้างข้อมูลทั้งหมด</button></div>'
    );

    const lb = document.getElementById('flLoadBin');
    if (lb) lb.onclick = () => { App.closeSheet(); App.pick('bin'); };
    const sb = document.getElementById('flSaveBin');
    if (sb) sb.onclick = addBin;
    const lx = document.getElementById('flLoadXdf');
    if (lx) lx.onclick = () => { App.closeSheet(); App.pick('xdf'); };
    const ex = document.getElementById('flExportXdf');
    if (ex) ex.onclick = () => { App.closeSheet(); App.exportXdf(); };
    const fl = document.getElementById('flFixLang');
    if (fl) fl.onclick = () => { App.closeSheet(); App.encodingSheet(); };
    const cl = document.getElementById('flClear');
    if (cl) cl.onclick = clearSheet;
  }

  function settingsSheet() {
    const src = document.getElementById('connText');
    const connLabel = src ? src.textContent.trim() : 'เดโม';
    App.sheet(
      '<div class="sh-head"><b>การตั้งค่า</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +

      '<div class="lbl">ข้อมูลสด</div>' +
      '<button class="item" id="stConn">' +
      '<div><div class="nm">แหล่งข้อมูลสด</div><div class="mt">เดโม หรืออ่านจากอุปกรณ์ผ่าน Web Serial</div></div>' +
      '<div class="sp">' + App.esc(connLabel) + ' ›</div></button>' +

      '<div class="lbl">ไฟล์</div>' +
      '<button class="item" id="stFiles">' +
      '<div><div class="nm">ไฟล์ที่โหลดไว้</div><div class="mt">.bin และ .xdf ที่เก็บในเครื่อง</div></div>' +
      '<div class="sp">›</div></button>' +
      '<button class="item" id="stExportXdf" style="margin-top:5px">' +
      '<div><div class="nm">ส่งออกคำนิยาม XDF</div><div class="mt">บันทึกตารางที่ใช้อยู่เป็นไฟล์ .xdf</div></div>' +
      '<div class="sp">↓</div></button>' +

      '<div class="lbl">ข้อมูลในเครื่อง</div>' +
      '<button class="item" id="stClear">' +
      '<div><div class="nm">ล้างไฟล์และข้อมูลที่บันทึก</div><div class="mt">ลบ .bin/.xdf และประวัติการแก้ไข</div></div>' +
      '<div class="sp" style="color:var(--red)">✕</div></button>' +

      '<div class="lbl">เกี่ยวกับ</div>' +
      '<div class="kv"><span class="k">เวอร์ชัน</span><span class="v">ECU TUNE 1.0</span></div>' +
      '<div class="kv"><span class="k">รูปแบบคำนิยาม</span><span class="v">XDF XML</span></div>' +
      '<div class="kv"><span class="k">การเชื่อมต่อ</span><span class="v">Web Serial 115200</span></div>' +
      '<div class="note blue" style="margin-top:10px">ไฟล์ XDF ที่เข้ารหัสล็อกไม่สามารถถอดได้ในแอป ' +
      '— ใช้ “เพิ่มแมพเอง” ระบุตำแหน่งจากโปรแกรมต้นทางแทน</div>'
    );

    const conn = document.getElementById('stConn');
    if (conn) conn.onclick = () => {
      const chip = document.getElementById('connChip');
      App.closeSheet();
      if (chip) chip.click();
      else App.toast('เปิดหน้าข้อมูลสดก่อน แล้วแตะปุ่มสถานะ', 'bad');
    };
    const files = document.getElementById('stFiles');
    if (files) files.onclick = filesSheet;
    const ex = document.getElementById('stExportXdf');
    if (ex) ex.onclick = () => { App.closeSheet(); App.exportXdf(); };
    const cl = document.getElementById('stClear');
    if (cl) cl.onclick = clearSheet;
  }

  /* ---------------- tiles ---------------- */
  function bind() {
    $$('#view-home .tile').forEach(t => {
      t.addEventListener('click', () => {
        if (t.dataset.go) { App.go(t.dataset.go); return; }
        if (t.dataset.open === 'settings') settingsSheet();
        else if (t.dataset.open === 'files') filesSheet();
      });
    });
    const chip = document.getElementById('homeConn');
    if (chip) chip.onclick = () => {
      const c = document.getElementById('connChip');
      if (c) c.click();
    };
  }

  App.registerView('home', { render: syncHome });
  App.on('binload', syncHome);
  App.on('binchange', syncHome);
  App.on('xdfchange', syncHome);
  App.on('xdflocked', syncHome);

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    syncHome();
    setInterval(() => { if (App.state.tab === 'home') syncConn(); }, 1500);
  });
})(window);
