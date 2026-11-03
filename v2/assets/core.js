/* ============================================================
   ECU TUNE — app core (state / storage / UI plumbing)
   ============================================================ */
(function (global) {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const KEY = 'ecutune.v1';

  const App = {
    views: {},
    state: {
      bin: null, orig: null, binName: '',
      xdfName: '', xdfText: '', xdf: null,
      items: [], mapIdx: 0, scanOnly: false,
      undo: [], redo: [],
      tab: 'dash'
    },
    pending: null,
    handlers: {}
  };

  /* ---------------- basic ui ---------------- */
  App.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  App.toast = function (msg, kind) {
    const wrap = $('#toasts');
    if (!wrap) return;
    const el = document.createElement('div');
    el.textContent = msg;
    if (kind) el.className = kind;
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    setTimeout(() => {
      el.classList.remove('on');
      setTimeout(() => el.remove(), 240);
    }, 2300);
  };

  App.sheet = function (html) {
    $('#sheetBody').innerHTML = html;
    $('#sheetWrap').classList.add('open');
  };
  App.closeSheet = function () {
    $('#sheetWrap').classList.remove('open');
  };

  /* ---------------- bytes / files ---------------- */
  App.bytesToB64 = function (u8) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(u8.length, i + chunk)));
    }
    return btoa(s);
  };
  App.b64ToBytes = function (b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };
  App.download = function (name, bytes) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  App.kb = (n) => (n >= 1024 ? (n / 1024).toFixed(n >= 10240 ? 0 : 1) + ' KB' : n + ' B');
  App.hex = (n, pad) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(pad || 4, '0');
  App.fmt = function (v, d) {
    if (v == null || !isFinite(v)) return '—';
    if (typeof v === 'string') return v;
    const dec = Math.max(0, Math.min(4, d || 0));
    return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  };

  /* ---------------- persist ---------------- */
  let saveTimer = null;
  App.persist = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const s = App.state;
      if (!s.bin) {
        try { localStorage.removeItem(KEY); } catch (e) { }
        return;
      }
      try {
        const payload = {
          binName: s.binName,
          bin: App.bytesToB64(s.bin),
          orig: App.bytesToB64(s.orig),
          xdfName: s.xdfName,
          xdfText: s.xdfText,
          mapIdx: s.mapIdx,
          scanOnly: s.scanOnly,
          xdfLockName: s.xdfLocked ? s.xdfLocked.name : '',
          xdfLockSize: s.xdfLocked ? s.xdfLocked.size : 0,
          xdfLockMagic: s.xdfLocked ? s.xdfLocked.magic : '',
          xdfErr: s.xdfLastError || ''
        };
        localStorage.setItem(KEY, JSON.stringify(payload));
      } catch (e) {
        /* quota — working copy still lives in memory */
      }
    }, 320);
  };

  App.restore = function () {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { }
    if (!raw) return false;
    try {
      const p = JSON.parse(raw);
      const bin = App.b64ToBytes(p.bin);
      const orig = App.b64ToBytes(p.orig);
      if (!bin.length || bin.length !== orig.length) return false;
      const s = App.state;
      s.bin = bin; s.orig = orig;
      s.binName = p.binName || 'ecu.bin';
      s.xdfName = p.xdfName || '';
      s.xdfText = p.xdfText || '';
      s.scanOnly = !!p.scanOnly;
      s.mapIdx = p.mapIdx || 0;
      s.xdfLocked = p.xdfLockName ? { name: p.xdfLockName, size: p.xdfLockSize || 0, magic: p.xdfLockMagic || '', enc: '' } : null;
      s.xdfLastError = p.xdfErr || '';
      if (s.xdfText) {
        try {
          s.xdf = Xdf.parse(s.xdfText);
          Xdf.resolve(s.xdf, bin);
          s.items = s.xdf.items.filter(i => i.kind !== 'flag' || true);
          s.scanOnly = s.items.length === 0;
          if (s.scanOnly) s.items = Xdf.autoScan(bin);
        } catch (e) {
          s.xdf = null;
          s.items = Xdf.autoScan(bin);
          s.scanOnly = true;
        }
      } else {
        s.items = Xdf.autoScan(bin);
        s.scanOnly = true;
      }
      if (s.mapIdx >= s.items.length) s.mapIdx = 0;
      App.itemsChanged();
      return true;
    } catch (e) {
      return false;
    }
  };

  /* ---------------- change plumbing ---------------- */
  App.on = function (evt, fn) {
    (App.handlers[evt] = App.handlers[evt] || []).push(fn);
  };
  App.emit = function (evt, data) {
    (App.handlers[evt] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });
  };

  App.changedBytes = function () {
    return App.state.bin && App.state.orig ? Xdf.diffBytes(App.state.bin, App.state.orig) : 0;
  };

  App.itemsChanged = function () {
    const s = App.state;
    if (!s.bin || !s.orig) return 0;
    let n = 0;
    s.items.forEach(it => {
      it.changed = Xdf.scanChangeCount(it, s.bin, s.orig, s.xdf);
      n += it.changed;
    });
    return n;
  };

  App.beginEdit = function () {
    const s = App.state;
    if (!s.bin) return;
    App.pending = s.bin.slice();
  };
  App.commitEdit = function (label) {
    const s = App.state;
    if (!App.pending || !s.bin) return false;
    let same = App.pending.length === s.bin.length;
    if (same) {
      for (let i = 0; i < s.bin.length; i++) if (App.pending[i] !== s.bin[i]) { same = false; break; }
    }
    if (same) { App.pending = null; return false; }
    s.undo.push({ before: App.pending, after: s.bin.slice(), label: label || 'แก้ตาราง' });
    if (s.undo.length > 24) s.undo.shift();
    s.redo.length = 0;
    App.pending = null;
    App.afterEdit();
    return true;
  };
  App.afterEdit = function () {
    App.persist();
    App.itemsChanged();
    App.emit('binchange');
    App.updateNav();
  };
  App.undoEdit = function () {
    const s = App.state;
    const e = s.undo.pop();
    if (!e) { App.toast('ไม่มีรายการให้ย้อน'); return; }
    const cur = s.bin.slice();
    s.bin = e.before.slice();
    s.redo.push({ before: e.before.slice(), after: cur, label: e.label });
    App.afterEdit();
    App.toast('ย้อนกลับ · ' + e.label);
  };
  App.redoEdit = function () {
    const s = App.state;
    const e = s.redo.pop();
    if (!e) { App.toast('ไม่มีรายการให้ทำซ้ำ'); return; }
    s.bin = e.after.slice();
    s.undo.push({ before: e.before.slice(), after: e.after.slice(), label: e.label });
    App.afterEdit();
    App.toast('ทำซ้ำ · ' + e.label);
  };
  App.revertFile = function () {
    const s = App.state;
    if (!s.bin || !s.orig) return;
    App.beginEdit();
    s.bin = s.orig.slice();
    App.commitEdit('คืนค่าไฟล์เดิม');
    App.toast('คืนค่าไบต์ทั้งหมดแล้ว', 'good');
  };

  /* ---------------- load bin / xdf ---------------- */
  App.rebuildItems = function () {
    const s = App.state;
    if (!s.bin) { s.items = []; return; }
    if (s.xdf) {
      Xdf.resolve(s.xdf, s.bin);
      s.items = s.xdf.items;
      s.scanOnly = false;
      if (!s.items.length) {
        s.items = Xdf.autoScan(s.bin);
        s.scanOnly = true;
      }
    } else {
      s.items = Xdf.autoScan(s.bin);
      s.scanOnly = true;
    }
    if (s.mapIdx >= s.items.length) s.mapIdx = 0;
    App.itemsChanged();
  };

  App.setBin = function (bytes, name) {
    const s = App.state;
    if (!bytes || bytes.length < 512) {
      App.toast('ไฟล์เล็กเกินไป — ต้องเป็นไฟล์ ECU (.bin)', 'bad');
      return false;
    }
    s.bin = new Uint8Array(bytes);
    s.orig = new Uint8Array(bytes);
    s.binName = name || 'ecu.bin';
    s.undo = []; s.redo = [];
    s.mapIdx = 0;
    App.rebuildItems();
    App.persist();
    App.emit('binload');
    App.emit('binchange');
    App.updateNav();
    if (App.views[App.state.tab] && App.views[App.state.tab].render) App.views[App.state.tab].render();
    const n = s.items.length;
    App.toast(n ? ('โหลด ' + s.binName + ' · ' + n + ' รายการ') : 'โหลดไฟล์แล้ว แต่ยังไม่พบตาราง', 'good');
    return true;
  };

  App.setXdf = function (text, name) {
    const s = App.state;
    s.xdfLocked = null;
    let def;
    try {
      def = Xdf.parse(text);
    } catch (e) {
      s.xdfLastError = e && e.message ? e.message : 'อ่าน XDF ไม่ได้';
      App.toast(s.xdfLastError, 'bad');
      App.emit('xdferror', e);
      return false;
    }
    if (!def.items.length) {
      App.toast('XDF ไม่มีตาราง/ค่าคงที่ที่อ่านได้', 'bad');
      return false;
    }
    s.xdf = def;
    s.xdfText = text;
    s.xdfName = name || 'definition.xdf';
    s.mapIdx = 0;
    if (s.bin) {
      Xdf.resolve(def, s.bin);
      s.items = def.items;
      s.scanOnly = false;
      App.itemsChanged();
    }
    App.persist();
    App.emit('xdfchange');
    if (App.views[s.tab] && App.views[s.tab].render) App.views[s.tab].render();
    App.toast('โหลด XDF · ' + def.items.length + ' รายการ', 'good');
    return true;
  };

  App.xdfLocked = function (bytes, name, enc) {
    const s = App.state;
    s.xdf = null; s.xdfText = ''; s.xdfName = '';
    s.xdfLastError = '';
    s.xdfLocked = {
      name: name || 'definition.xdf',
      size: bytes ? bytes.length : 0,
      magic: bytes ? App.hexHead(bytes, 16) : '',
      enc: enc || ''
    };
    if (s.bin) {
      App.rebuildItems();
    }
    App.persist();
    App.emit('binload');
    App.emit('binchange');
    App.emit('xdflocked');
    App.toast('ไฟล์ XDF ถูกล็อก/เข้ารหัส — ใช้โหมดสแกนแทน (ดูรายงาน)', 'bad');
  };

  /* ใช้รายการแมพที่ผู้ใช้กำหนด (สร้าง XDF XML ของตัวเอง แล้ว parse กลับเข้าระบบเดิม) */
  App.applyUserItems = function (items, title, name) {
    const s = App.state;
    if (!s.bin) { App.toast('ต้องโหลดไฟล์ .bin ก่อน', 'bad'); return false; }
    if (!items || !items.length) { App.toast('ไม่มีรายการที่ถูกต้อง', 'bad'); return false; }
    const xml = Xdf.writeXdf(items, {
      title: title || 'แมพของฉัน',
      author: 'ECU TUNE app',
      description: 'คำนิยามที่ผู้ใช้สร้างจากไฟล์ ' + s.binName,
      binSize: s.bin.length
    });
    return App.setXdf(xml, name || 'user-defined.xdf');
  };

  /* ส่งออกคำนิยามปัจจุบันเป็น XDF แบบ XML (เปิดต่อใน TunerPro ได้ถ้าเป็นรูปแบบมาตรฐาน) */
  App.exportXdf = function () {
    const s = App.state;
    if (!s.bin) { App.toast('ต้องโหลดไฟล์ .bin ก่อน', 'bad'); return; }
    let xml = s.xdfText;
    if (!xml || !s.xdf) {
      if (!s.items.length) { App.toast('ยังไม่มีตารางให้ส่งออก', 'bad'); return; }
      xml = Xdf.writeXdf(s.items, {
        title: s.binName.replace(/\.[^.]+$/, '') + ' · สแกนอัตโนมัติ',
        author: 'ECU TUNE app',
        description: 'สแกนจากไบต์จริงของ ' + s.binName + ' (ตำแหน่ง/สเกลต้องตรวจกับกล่องจริง)',
        binSize: s.bin.length
      });
    }
    const base = (s.binName || 'ecu').replace(/\.[^.]+$/, '');
    const bytes = new TextEncoder().encode(xml);
    App.download(base + '.xdf', bytes);
    App.toast('ส่งออกคำนิยาม ' + base + '.xdf แล้ว', 'good');
  };

  App.clearFile = function () {
    const s = App.state;
    s.bin = null; s.orig = null; s.binName = '';
    s.xdf = null; s.xdfText = ''; s.xdfName = '';
    s.xdfLocked = null; s.xdfLastError = '';
    s.items = []; s.mapIdx = 0; s.undo = []; s.redo = [];
    try { localStorage.removeItem(KEY); } catch (e) { }
    App.emit('binload'); App.emit('binchange');
    App.updateNav();
    if (App.views[s.tab] && App.views[s.tab].render) App.views[s.tab].render();
  };

  App.readBinFile = function (file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => App.setBin(new Uint8Array(r.result), file.name);
    r.onerror = () => App.toast('อ่านไฟล์ไม่สำเร็จ', 'bad');
    r.readAsArrayBuffer(file);
  };
  App.hexHead = function (bytes, n) {
    const out = [];
    const len = n || 8;
    for (let i = 0; i < len && i < bytes.length; i++) {
      out.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16).toUpperCase());
    }
    return out.join(' ');
  };
  App.decodeXdfText = function (bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return { text: new TextDecoder('utf-16le').decode(bytes), enc: 'utf-16' };
    }
    const decU8 = new TextDecoder('utf-8', { fatal: true });
    try { return { text: decU8.decode(bytes), enc: 'utf8' }; } catch (e) { }
    return { text: new TextDecoder('windows-1252').decode(bytes), enc: 'windows-1252' };
  };
  App.readXdfFile = function (file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const bytes = new Uint8Array(r.result || new ArrayBuffer(0));
      const d = App.decodeXdfText(bytes);
      if (/<\s*XDFFORMAT[\s\/\>]/i.test(d.text)) {
        App.setXdf(d.text, file.name);
        return;
      }
      App.xdfLocked(bytes, file.name, d.enc);
    };
    r.onerror = () => App.toast('อ่านไฟล์ไม่สำเร็จ', 'bad');
    r.readAsArrayBuffer(file);
  };

  App.pick = function (kind) {
    const input = kind === 'xdf' ? $('#xdfInput') : $('#binInput');
    if (input) { input.value = ''; input.click(); }
  };

  /* ---------------- checksums / summary ---------------- */
  App.checksums = function (bytes) {
    if (!bytes) return null;
    const end = bytes.length - 1;
    return {
      sum8: Xdf.sum8(bytes, 0, end),
      sum16: Xdf.sum16(bytes, 0, end),
      crc16: Xdf.crc16(bytes, 0, end)
    };
  };

  App.mapValueRange = function (item) {
    const s = App.state;
    if (!s.bin) return { min: 0, max: 1 };
    let min = Infinity, max = -Infinity;
    for (let r = 0; r < item.rows; r++) {
      for (let c = 0; c < item.cols; c++) {
        const v = Xdf.readCell(item, r, c, s.bin, s.xdf);
        if (v == null || !isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 };
    if (max - min < 1e-9) { max = min + 1; }
    return { min, max };
  };

  /* ---------------- heat colours ---------------- */
  const STOPS = [
    [0.00, 18, 49, 96],
    [0.28, 24, 120, 165],
    [0.52, 53, 199, 255],
    [0.72, 200, 245, 60],
    [0.88, 255, 176, 32],
    [1.00, 255, 90, 69]
  ];
  App.heat = function (t) {
    t = Math.max(0, Math.min(1, isFinite(t) ? t : 0));
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const a = STOPS[i - 1], b = STOPS[i];
        const k = (t - a[0]) / (b[0] - a[0] || 1);
        const r = Math.round(a[1] + (b[1] - a[1]) * k);
        const g = Math.round(a[2] + (b[2] - a[2]) * k);
        const bl = Math.round(a[3] + (b[3] - a[3]) * k);
        return { r, g, b: bl };
      }
    }
    const z = STOPS[STOPS.length - 1];
    return { r: z[1], g: z[2], b: z[3] };
  };
  App.heatCss = function (t, alpha) {
    const c = App.heat(t);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (alpha == null ? 0.35 : alpha) + ')';
  };

  /* ---------------- views / nav ---------------- */
  App.registerView = function (name, obj) { App.views[name] = obj; };

  App.go = function (name) {
    App.state.tab = name;
    $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + name));
    $$('.nav button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
    const wrap = $('.scroller');
    if (wrap) wrap.scrollTop = 0;
    const v = App.views[name];
    if (v && v.render) v.render();
    App.closeSheet();
  };

  App.updateNav = function () {
    const s = App.state;
    const btn = $('.nav button[data-view="tune"]');
    if (!btn) return;
    const changed = App.changedBytes();
    let dot = btn.querySelector('.dot');
    if (changed > 0) {
      if (!dot) { dot = document.createElement('span'); dot.className = 'dot'; btn.appendChild(dot); }
    } else if (dot) dot.remove();
    const title = $('#ecuState');
    if (title) title.textContent = changed ? changed + ' ไบต์ที่แก้' : (s.bin ? 'พร้อมจูน' : 'ยังไม่โหลด');
  };

  /* ---------------- serial (shared) ---------------- */
  App.serial = {
    port: null, reader: null, open: false, onLine: null, onClose: null, buffer: '',
    supported: function () { return typeof navigator !== 'undefined' && 'serial' in navigator; },
    connect: async function (baud, onLine) {
      if (!this.supported()) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Web Serial');
      if (this.port) await this.disconnect();
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: baud || 115200, dataBits: 8, stopBits: 1, parity: 'none' });
      this.port = port;
      this.open = true;
      this.onLine = onLine;
      this.buffer = '';
      this.loop();
      return port;
    },
    loop: async function () {
      const decoder = new TextDecoder();
      try {
        this.reader = this.port.readable.getReader();
        while (this.open) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (!value) continue;
          this.buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, idx).replace(/\r$/, '');
            this.buffer = this.buffer.slice(idx + 1);
            if (line && this.onLine) { try { this.onLine(line); } catch (e) { } }
          }
        }
      } catch (e) {
        /* device unplugged */
      } finally {
        try { if (this.reader) this.reader.releaseLock(); } catch (e) { }
        this.reader = null;
      }
    },
    write: async function (text) {
      if (!this.port || !this.port.writable) return false;
      const w = this.port.writable.getWriter();
      try {
        await w.write(new TextEncoder().encode(text));
        return true;
      } finally { try { w.releaseLock(); } catch (e) { } }
    },
    disconnect: async function () {
      this.open = false;
      try { if (this.reader) await this.reader.cancel(); } catch (e) { }
      try { if (this.port) await this.port.close(); } catch (e) { }
      this.port = null;
      if (this.onClose) this.onClose();
    }
  };

  /* ---------------- boot ---------------- */
  function bindShell() {
    $$('.nav button').forEach(b => b.addEventListener('click', () => App.go(b.dataset.view)));
    $('#sheetWrap').addEventListener('click', (e) => {
      if (e.target.id === 'sheetWrap' || e.target.classList.contains('scrim')) App.closeSheet();
    });
    const binInput = $('#binInput');
    const xdfInput = $('#xdfInput');
    if (binInput) binInput.addEventListener('change', e => {
      App.readBinFile(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
    if (xdfInput) xdfInput.addEventListener('change', e => {
      App.readXdfFile(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') < 0) return;
      e.preventDefault();
    }));
    document.addEventListener('drop', function (e) {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      if (/\.xdf$/i.test(f.name)) App.readXdfFile(f);
      else App.readBinFile(f);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') App.closeSheet();
    });
  }

  App.init = function () {
    bindShell();
    const restored = App.restore();
    App.updateNav();
    App.go('dash');
    if (restored) App.toast('กู้คืนไฟล์ที่จูนค้างไว้แล้ว', 'good');
  };

  global.App = App;
  global.$ = $;
  global.$$ = $$;
})(window);
