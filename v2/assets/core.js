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
      tab: 'home'
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
          xdfRaw: s.xdfRaw ? App.bytesToB64(s.xdfRaw) : '',
          xdfManual: !!s.xdfManual,
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
      s.xdfRaw = p.xdfRaw ? App.b64ToBytes(p.xdfRaw) : null;
      s.xdfManual = !!p.xdfManual;
      s.xdfText = p.xdfText || '';
      /* ถ้ามีไบต์ต้นฉบับให้ถอดใหม่เสมอ (ตัวถอด/ซ่อมภาษาอาจดีขึ้น) */
      if (!s.xdfManual && s.xdfRaw && s.xdfRaw.length) {
        const d = App.decodeXdfText(s.xdfRaw);
        if (/<\s*XDFFORMAT[\s\/\>]/i.test(d.text)) s.xdfText = d.text;
      } else if (s.xdfText) {
        /* ไฟล์ที่เคยบันทึกไว้ตอนถอดภาษาผิด — ซ่อมให้เลยตอนเปิดแอป */
        s.xdfText = App.fixXdfLanguage(s.xdfText);
      }
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
    s.xdf = null; s.xdfText = ''; s.xdfName = ''; s.xdfRaw = null; s.xdfManual = false;
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
    s.xdfRaw = null;
    s.xdfManual = false;
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
    s.xdf = null; s.xdfText = ''; s.xdfName = ''; s.xdfRaw = null; s.xdfManual = false;
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
  /* ---------------- ตัวช่วยเรื่องภาษา/encoding ---------------- */
  /* ตารางแปลงตัวอักษรกลับเป็นไบต์ สำหรับ single-byte encoding ที่เบราว์เซอร์ถอดได้ */
  const SINGLE_BYTE_REV = (function () {
    const maps = {};
    ['windows-1252', 'windows-874', 'iso-8859-11', 'macintosh'].forEach(enc => {
      try {
        const all = new Uint8Array(256);
        for (let i = 0; i < 256; i++) all[i] = i;
        const t = new TextDecoder(enc).decode(all);
        if (!t || t.length !== 256) return;
        const rev = {};
        for (let i = 0; i < 256; i++) {
          const ch = t[i];
          if (ch === '\uFFFD' || ch in rev) continue;
          rev[ch] = i;
        }
        maps[enc] = rev;
      } catch (e) { }
    });
    return maps;
  })();

  /* วัดว่า “อ่านเป็นคำไทยได้กี่คำ” — ใช้ตัดสินระหว่าง encoding/การซ่อม
     (ไม่นับตัวอักษร ASCII เพราะ XML ทุกตัวเลือกมีเท่ากัน) */
  /* คำที่พบบ่อยในไฟล์จูน — ใช้เป็นหลักฐานว่า “ข้อความนี้เป็นภาษาไทยจริง” */
  const THAI_WORDS = ['ปรับ', 'แต่ง', 'ตั้ง', 'น้ำมัน', 'จุด', 'ระเบิด', 'รอบ', 'เดิน', 'เบา',
    'องศา', 'แผนที่', 'ตาราง', 'ฉีด', 'อากาศ', 'อุณหภูมิ', 'แก้', 'เพิ่ม', 'ลด', 'ค่า',
    'เครื่อง', 'ยนต์', 'ไฟ', 'แก๊ส', 'โหลด', 'ความ', 'เร็ว', 'เกียร์', 'ทด', 'เฟือง',
    'ไอดี', 'ไอเสีย', 'วาล์ว', 'ปั๊ม', 'แรง', 'ดัน', 'คันเร่ง', 'เซ็นเซอร์', 'แมพ',
    'หัวฉีด', 'ส่วนผสม', 'ความร้อน', 'สตาร์ท', 'วินาที', 'โวลต์', 'รอบเครื่อง', 'เวลา'];

  function wordHits(t) {
    if (!t) return 0;
    let n = 0;
    for (let i = 0; i < THAI_WORDS.length; i++) {
      if (t.indexOf(THAI_WORDS[i]) >= 0) n++;
    }
    return n;
  }

  const SCORE_CACHE = new Map();

  function thaiScore(t) {
    if (typeof t !== 'string') return -1e9;
    const hit = SCORE_CACHE.get(t);
    if (hit !== undefined) return hit;
    let runs = 0, thai = 0;
    const re = /[\u0E00-\u0E7F]+/g;
    let m;
    while ((m = re.exec(t))) {
      if (m[0].length >= 2) runs++;
      thai += m[0].length;
    }
    const bad = (t.match(/\uFFFD/g) || []).length;
    /* ตัวอักษรแปลก ๆ (Latin-1 ส่วนขยาย, เครื่องหมายวรรคตอนพิเศษ) = สัญญาณข้อความเพี้ยน */
    const odd = (t.match(/[\u0080-\u02FF\u2000-\u206F\u20A0-\u20CF]/g) || []).length;
    /* ตรวจคำจากตัวอย่างต้นข้อความเพื่อความเร็ว (พอต่อการแยกแยะ) */
    const hits = thai > 0 ? wordHits(t.length > 3000 ? t.slice(0, 3000) : t) : 0;
    const sc = hits * 5000 + runs * 100 + thai - bad * 80 - odd * 30;
    if (SCORE_CACHE.size > 80) SCORE_CACHE.clear();
    SCORE_CACHE.set(t, sc);
    return sc;
  }

  function encodeBytes(text, rev) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      const b = rev[text[i]];
      if (b === undefined) return null;
      out.push(b);
    }
    return new Uint8Array(out);
  }

  function strictUtf8(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return null; }
  }

  /* ซ่อมข้อความที่ถูกเข้ารหัสซ้อน (mojibake) เช่น Â»Ã‘Âº... → ปรับ...
     วิธี: แปลงกลับเป็นไบต์แบบ cp1252 แล้วลองถอดเป็น UTF-8/TIS-620 ซ้ำจนกว่าจะดีที่สุด */
  App.repairMojibake = function (text, maxPasses) {
    let cur = text;
    let curScore = thaiScore(text);
    let passes = 0;
    const visited = {};
    visited[cur] = 1;
    for (let i = 0; i < (maxPasses || 3); i++) {
      /* 1) ถ้าไบตต์ที่แปลงกลับเป็น UTF-8 ที่ถูกต้อง = ถอดซ้อนมาแล้วหนึ่งชั้นแน่นอน → ใช้เลย */
      let pick = null;
      Object.keys(SINGLE_BYTE_REV).forEach(enc => {
        const bytes = encodeBytes(cur, SINGLE_BYTE_REV[enc]);
        if (!bytes) return;
        const u8 = strictUtf8(bytes);
        if (u8 == null || u8 === cur || visited[u8]) return;
        const sc = thaiScore(u8);
        if (!pick || sc > pick.score) pick = { text: u8, score: sc };
      });
      if (!pick) {
        /* 2) ไม่มี UTF-8 ที่ถูกต้อง → ลองถอดเป็น TIS-620/cp1252 แล้วเลือกที่อ่านเป็นคำไทยได้ */
        Object.keys(SINGLE_BYTE_REV).forEach(enc => {
          const bytes = encodeBytes(cur, SINGLE_BYTE_REV[enc]);
          if (!bytes) return;
          ['windows-874', 'windows-1252'].forEach(d => {
            let t = null;
            try { t = new TextDecoder(d).decode(bytes); } catch (e) { return; }
            if (t === cur || visited[t]) return;
            const sc = thaiScore(t);
            /* ต้องได้ “คำไทย” จริง (มีพยางค์ติดกัน) ไม่ใช่แค่เครื่องหมายวรรณยุกต์หลงมา */
            if (sc < 100) return;
            if (sc > curScore && (!pick || sc > pick.score)) pick = { text: t, score: sc };
          });
        });
      }
      if (!pick) break;
      if (pick.score < curScore) break;
      cur = pick.text;
      curScore = pick.score;
      visited[cur] = 1;
      passes++;
    }
    return { text: cur, score: curScore, passes: passes };
  };

  /* ซ่อมอัตโนมัติเฉพาะเมื่อเห็นผลชัดว่าเป็นข้อความเพี้ยน (มีคำไทยยาว ๆ หลังซ่อม) */
  App.repairIfNeeded = function (text) {
    if (!text || /[\u0E00-\u0E7F]/.test(text)) return text;
    const r = App.repairMojibake(text);
    if (r.passes && /[\u0E00-\u0E7F]{3,}/.test(r.text)) return r.text;
    return text;
  };

  /* ตารางถอดไบต์เดียวเป็นอักษร (windows-874/TIS-620) ใช้แปลง numeric entity กลับเป็นไทย */
  const WIN874_DECODE = (function () {
    try {
      const all = new Uint8Array(256);
      for (let i = 0; i < 256; i++) all[i] = i;
      return new TextDecoder('windows-874').decode(all);
    } catch (e) { return null; }
  })();

  /* XDF จาก TunerPro มักเก็บชื่อไทยเป็น &#205; (รหัสไบต์ TIS-620) — แปลงกลับเป็นอักษรไทย */
  App.decodeNumericRefs = function (text) {
    if (!text || !WIN874_DECODE || text.indexOf('&#') < 0) return text;
    const out = text.replace(/&#(?:x([0-9a-fA-F]{1,4})|(\d{1,5}));/g, (m, hex, dec) => {
      const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      if (!(cp >= 0x80 && cp <= 0xFF)) return m;
      const ch = WIN874_DECODE[cp];
      return ch && ch !== '\uFFFD' ? ch : m;
    });
    if (out === text) return text;
    return thaiScore(out) > thaiScore(text) + 50 ? out : text;
  };

  /* รวมทุกวิธีซ่อมภาษา: entity → ซ่อมซ้อนทีละบรรทัด (เฉพาะบรรทัดที่ยังไม่มีอักษรไทย) */
  App.fixXdfLanguage = function (text) {
    if (!text) return text;
    let t = App.decodeNumericRefs(text);
    if (t.indexOf('\n') >= 0) {
      t = t.split('\n').map(line => {
        if (!line || /[\u0E00-\u0E7F]/.test(line)) return line;
        return App.repairIfNeeded(line);
      }).join('\n');
    } else {
      t = App.repairIfNeeded(t);
    }
    return t;
  };

  /* ข้อความดูเหมือนถูกเข้ารหัสซ้อน (ไม่มีอักษรไทยเลย แต่มีตัวอักษร Latin-1 เกลื่อน) */
  App.looksGarbled = function (text) {
    if (!text || /[\u0E00-\u0E7F]/.test(text)) return false;
    const bad = (text.match(/[\u00A0-\u00FF]/g) || []).length;
    return bad >= 8;
  };

  /* รายการตัวเลือกภาษา/การซ่อมข้อความ สำหรับให้ผู้ใช้เลือกเอง */
  App.xdfVariants = function () {
    const s = App.state;
    const out = [];
    const addVariant = (label, text) => {
      if (!text) return;
      if (out.some(v => v.text === text)) return;
      const sample = [];
      const re = /<title>([^<]{1,80})<\/title>/gi;
      let m;
      while ((m = re.exec(text)) && sample.length < 3) sample.push(m[1]);
      out.push({ label: label, text: text, sample: sample, score: thaiScore(text), current: text === s.xdfText });
    };
    const bases = [];
    if (s.xdfRaw && s.xdfRaw.length) {
      [['UTF-8', 'utf-8'], ['TIS-620 / windows-874', 'windows-874'], ['Windows-1252', 'windows-1252']].forEach(pair => {
        let t = null;
        try { t = new TextDecoder(pair[1]).decode(s.xdfRaw); } catch (e) { return; }
        bases.push([pair[0], t]);
      });
    } else if (s.xdfText) {
      bases.push(['ข้อความที่โหลดไว้', s.xdfText]);
    }
    bases.forEach(b => {
      const fixedText = App.fixXdfLanguage(b[1]);
      if (fixedText !== b[1]) addVariant(b[0] + ' + ซ่อมภาษา', fixedText);
      addVariant(b[0], b[1]);
      let cur = b[1];
      for (let i = 1; i <= 3; i++) {
        const r = App.repairMojibake(cur, 1);
        if (r.text === cur) break;
        cur = r.text;
        addVariant(b[0] + ' + ซ่อมซ้อน ' + i + ' ชั้น', cur);
      }
    });
    out.sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || b.score - a.score);
    return out;
  };

  /* หน้าเลือกภาษา: โชว์ตัวอย่างชื่อตารางของแต่ละตัวเลือกให้กดเลือก */
  App.encodingSheet = function () {
    const s = App.state;
    const variants = App.xdfVariants();
    if (!variants.length) { App.toast('ยังไม่มี XDF ที่โหลดไว้', 'bad'); return; }
    let html = '<div class="sh-head"><b>ภาษา / ชื่อตารางเพี้ยน</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub">แตะตัวเลือกที่ชื่อตารางอ่านออก (เรียงจากที่น่าจะถูกก่อน)' +
      (s.xdfRaw && s.xdfRaw.length ? '' : '<br><b>หมายเหตุ:</b> ยังไม่มีไบต์ต้นฉบับของไฟล์นี้ — กด “โหลด .xdf ใหม่” เพื่อให้ถอดจากไบต์จริงได้แม่นยำที่สุด') + '</div>';
    variants.forEach((v, i) => {
      html += '<button class="item' + (v.current ? ' on' : '') + '" data-vi="' + i + '" style="margin-bottom:6px">' +
        '<div style="min-width:0"><div class="nm">' + (v.current ? 'ใช้อยู่ · ' : '') + App.esc(v.label) + '</div>' +
        '<div class="mt">' + App.esc(v.sample.length ? v.sample.join(' · ') : '(ไม่พบชื่อตาราง)') + '</div></div>' +
        '<div class="sp">' + (v.current ? '✓' : '') + '</div></button>';
    });
    html += '<div class="row" style="margin-top:10px"><button class="btn sm" id="lgReload">โหลด .xdf ใหม่</button></div>';
    App.sheet(html);
    document.querySelectorAll('#sheetBody [data-vi]').forEach(b => b.onclick = () => {
      const v = variants[+b.dataset.vi];
      s.xdfManual = true;
      if (App.setXdf(v.text, s.xdfName || 'definition.xdf')) {
        App.persist();
        App.closeSheet();
        App.toast('ใช้ภาษานี้แล้ว', 'good');
      }
    });
    const rl = document.getElementById('lgReload');
    if (rl) rl.onclick = () => { App.closeSheet(); App.pick('xdf'); };
  };

  /* แปลงไบต์ XDF เป็นข้อความโดยไม่ให้ภาษาเพี้ยน
     ลำดับ: BOM → UTF-8 แบบเข้ม → encoding ที่ประกาศใน XML → เดาจากรูปคำ (ไทย/ละติน) */
  function decodeXdfBytes(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const decode = (enc, slice) => {
      try { return new TextDecoder(enc).decode(slice || u8); } catch (e) { return null; }
    };

    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return { text: decode('utf-8', u8.subarray(3)) || '', enc: 'utf-8' };
    }
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
      return { text: decode('utf-16le', u8.subarray(2)) || '', enc: 'utf-16le' };
    }
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
      return { text: decode('utf-16be', u8.subarray(2)) || '', enc: 'utf-16be' };
    }

    /* ชื่อ encoding ที่ประกาศไว้ในหัวไฟล์ (อ่านเฉพาะไบต์ ASCII) */
    let prolog = '';
    for (let i = 0; i < Math.min(u8.length, 512); i++) prolog += String.fromCharCode(u8[i]);
    const m = prolog.match(/<\?xml[^>]*?encoding\s*=\s*["']([A-Za-z0-9._:\-]+)["']/);
    const declared = m ? m[1].toLowerCase() : '';

    /* ถ้าถอดเป็น UTF-8 ได้ทั้งไฟล์ (ไม่มีไบต์เสีย) = UTF-8 แน่นอน */
    let strict = null;
    try { strict = new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { strict = null; }
    if (strict != null && strict.indexOf('\uFFFD') < 0) return { text: strict, enc: 'utf-8' };

    const score = thaiScore;

    const seen = {};
    const candidates = [];
    [declared, 'windows-874', 'windows-1252', 'utf-8'].forEach(enc => {
      if (!enc || seen[enc]) return;
      seen[enc] = 1;
      candidates.push(enc);
    });

    let best = null;
    candidates.forEach(enc => {
      const text = decode(enc);
      if (text == null) return;
      const sc = score(text);
      if (!best || sc > best.score) best = { text: text, enc: enc, score: sc };
    });
    return best || { text: decode('windows-1252') || '', enc: 'windows-1252' };
  }

  App.decodeXdfText = function (bytes) {
    const out = decodeXdfBytes(bytes);
    const fixed = App.fixXdfLanguage(out.text);
    if (fixed !== out.text) return { text: fixed, enc: out.enc + '+fix' };
    return out;
  };

  /* ปุ่มซ่อมภาษา: ใช้กับคำนิยามที่โหลด/บันทึกค้างไว้แล้ว */
  App.repairXdfText = function () {
    const s = App.state;
    if (!s.xdfText) { App.toast('ยังไม่มีคำนิยาม XDF ที่โหลดไว้', 'bad'); return false; }
    const fixed = App.repairIfNeeded(s.xdfText);
    if (fixed === s.xdfText) {
      App.toast('ข้อความนี้อ่านได้ปกติอยู่แล้ว', 'bad');
      return false;
    }
    if (!App.setXdf(fixed, s.xdfName || 'definition.xdf')) return false;
    App.toast('ซ่อมชื่อตารางที่เพี้ยนแล้ว', 'good');
    return true;
  };

  App.readXdfFile = function (file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const bytes = new Uint8Array(r.result || new ArrayBuffer(0));
      const d = App.decodeXdfText(bytes);
      if (/<\s*XDFFORMAT[\s\/\>]/i.test(d.text)) {
        App.state.xdfRaw = bytes;
        App.state.xdfManual = false;
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
    const back = $('#btnBack');
    if (back) back.hidden = name === 'home';
    const wrap = $('.scroller');
    if (wrap) wrap.scrollTop = 0;
    const v = App.views[name];
    if (v && v.render) v.render();
    App.closeSheet();
  };

  App.updateNav = function () {
    const s = App.state;
    const changed = App.changedBytes();
    const title = $('#ecuState');
    if (title) title.textContent = changed ? changed + ' ไบต์ที่แก้' : (s.bin ? 'พร้อมจูน' : 'ยังไม่โหลด');
  };

  /* ---------------- transport: USB serial + Bluetooth LE (shared) ---------------- */
  const BLE_UUID = {
    nus: ['6e400001-b5a0-f393-e0a9-e3a5e5e8f2e0', '6e400002-b5a0-f393-e0a9-e3a5e5e8f2e0', '6e400003-b5a0-f393-e0a9-e3a5e5e8f2e0'], // Nordic UART (ESP32/nRF)
    ffe0: [0xFFE0, 0xFFE1, 0xFFE1],                                                                                              // HM-10 / JDY style
    spp: ['0000abf0-0000-1000-8000-00805f9b34fb', '0000abf1-0000-1000-8000-00805f9b34fb', '0000abf2-0000-1000-8000-00805f9b34fb']
  };
  const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /* ทำให้ BLE หน้าตาเหมือน SerialPort (readable/writable/open/close) เพื่อให้โค้ดเดิมใช้ต่อได้ */
  function makeBlePort(device, server, rxChar, txChar) {
    let onNotify = null, closed = false;
    const port = {
      kind: 'ble', device: device, readable: null, writable: null,
      open: async function () { /* เปิดแล้วตอน requestDevice */ },
      close: async function () {
        closed = true;
        try { if (txChar) { txChar.removeEventListener('characteristicvaluechanged', onNotify); await txChar.stopNotifications(); } } catch (e) { }
        try { if (device.gatt && device.gatt.connected) device.gatt.disconnect(); } catch (e) { }
      }
    };
    port.readable = new ReadableStream({
      start: function (c) {
        onNotify = function (ev) {
          const v = ev.target.value;
          try { c.enqueue(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice()); } catch (e) { }
        };
        txChar.addEventListener('characteristicvaluechanged', onNotify);
        device.addEventListener('gattserverdisconnected', function () {
          if (closed) return;
          closed = true;
          try { c.close(); } catch (e) { }
        });
      },
      cancel: function () { closed = true; }
    });
    const canNoResp = !!rxChar.properties.writeWithoutResponse && typeof rxChar.writeValueWithoutResponse === 'function';
    port.writable = new WritableStream({
      write: async function (chunk) {
        const CH = 20; // MTU ค่าเริ่มต้น 23 → payload 20 ไบต์ ใช้ได้กับทุกอุปกรณ์
        for (let i = 0; i < chunk.length; i += CH) {
          const part = chunk.slice(i, i + CH);
          if (canNoResp) await rxChar.writeValueWithoutResponse(part);
          else await rxChar.writeValue(part);
        }
      }
    });
    return port;
  }

  async function requestBlePort() {
    const optional = [BLE_UUID.nus[0], BLE_UUID.ffe0[0], BLE_UUID.spp[0]];
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: optional });
    const server = await device.gatt.connect();
    let rx = null, tx = null;
    for (const k of ['nus', 'ffe0', 'spp']) {
      const u = BLE_UUID[k];
      try {
        const svc = await server.getPrimaryService(u[0]);
        const w = await svc.getCharacteristic(u[1]);
        const n = (u[2] === u[1]) ? w : await svc.getCharacteristic(u[2]);
        rx = w; tx = n; break;
      } catch (e) { /* ลองชุดถัดไป */ }
    }
    if (!rx || !tx) {
      try { server.disconnect(); } catch (e) { }
      const err = new Error('อุปกรณ์นี้ไม่มีบริการ BLE UART (Nordic UART / FFE0)');
      err.name = 'NoUartError';
      throw err;
    }
    await tx.startNotifications();
    return makeBlePort(device, server, rx, tx);
  }

  /* ---------------- จำนวนครั้งการอัดไฟล์ (Flash Counter) ----------------
     นับทุกครั้งที่อัดสำเร็จจากแอปนี้ เก็บไว้ในเครื่อง (localStorage)
     ใช้กับการ์ด "จำนวนครั้งการอัดไฟล์" และปุ่มอ่าน/ลบจำนวนอัด */
  App.flashCount = (function () {
    const KEY = 'ecu.flashcount.v1';
    let data = { count: 0, last: '', byName: {} };
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && typeof raw === 'object') {
        data.count = Math.max(0, Math.min(255, Number(raw.count) || 0));
        data.last = typeof raw.last === 'string' ? raw.last : '';
        data.byName = raw.byName && typeof raw.byName === 'object' ? raw.byName : {};
      }
    } catch (e) { }

    function human(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      const p = n => String(n).padStart(2, '0');
      return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function render() {
      const val = document.getElementById('flashCountVal');
      const txt = document.getElementById('flashCountText');
      if (val) val.textContent = data.count + ' ครั้ง';
      if (txt) txt.textContent = data.count + '/255 ครั้ง' + (data.last ? ' · ล่าสุด ' + human(data.last) : ' · ยังไม่เคยอัด');
    }

    function save() {
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { }
      render();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
    else render();

    return {
      read: function () { return data; },
      human: function () { return human(data.last); },
      bump: function (name) {
        data.byName[name || 'ecu'] = (data.byName[name || 'ecu'] || 0) + 1;
        data.count = Math.min(255, data.count + 1);
        data.last = new Date().toISOString();
        save();
        return data.count;
      },
      reset: function () {
        data = { count: 0, last: '', byName: {} };
        save();
        return 0;
      },
      render: render
    };
  })();
  window.FlashCount = App.flashCount;

  App.serial = {
    baud: function () { try { const v = parseInt(localStorage.getItem('ecu.baud'), 10); return v > 0 ? v : 10400; } catch (e) { return 10400; } },
    setBaud: function (v) { try { localStorage.setItem('ecu.baud', String(v)); } catch (e) { } },
    onBytes: null, port: null, lastPort: null, reader: null, open: false, onLine: null, onClose: null, buffer: '', kind: '',
    usbSupported: function () { return typeof navigator !== 'undefined' && 'serial' in navigator; },
    bleSupported: function () { return typeof navigator !== 'undefined' && 'bluetooth' in navigator; },
    supported: function () { return this.usbSupported() || this.bleSupported(); },
    secure: function () { return typeof window === 'undefined' || window.isSecureContext !== false; },
    /* เหตุผลที่ใช้ไม่ได้ — ข้อความภาษาไทยบอกวิธีแก้ */
    why: function () {
      if (!this.secure()) return 'ต้องเปิดแอปผ่าน https:// (หรือ localhost) เบราว์เซอร์จึงจะอนุญาตให้ต่อ USB/บลูทูธ';
      if (isIOS()) return 'iPhone/iPad (Safari, Chrome) ไม่รองรับ USB/บลูทูธจากเว็บ — ใช้แอปเบราว์เซอร์ Bluefy หรือเปิดบนมือถือ Android (Chrome) / คอมพิวเตอร์';
      return 'เบราว์เซอร์นี้ไม่รองรับ — บนมือถือใช้ Chrome (Android) หรือ Edge';
    },
    available: function () { return this.secure() && this.supported(); },
    friendly: function (e) {
      const n = e && e.name, m = (e && e.message) || String(e);
      if (n === 'NotFoundError') return null;                 /* ผู้ใช้กดยกเลิก */
      if (n === 'SecurityError') return 'เบราว์เซอร์ไม่อนุญาต — ต้องเปิดผ่าน https:// และกดปุ่มเอง';
      if (n === 'NetworkError' || /Failed to open|GATT|Connection/i.test(m))
        return 'เปิดพอร์ตไม่ได้ — ตรวจสาย OTG/ให้สิทธิ์ USB ปิดแอปอื่นที่ใช้พอร์ตอยู่ แล้วลองใหม่';
      if (n === 'InvalidStateError') return 'พอร์ตถูกใช้งานอยู่ — ตัดการเชื่อมต่อก่อน แล้วลองใหม่';
      return m;
    },
    /* ต้องเรียกจากการกดปุ่มโดยตรง (user gesture) — จึงขอพอร์ตก่อนทำอย่างอื่น */
    requestPort: async function (kind) {
      if (!this.secure()) throw new Error(this.why());
      if (kind === 'ble') {
        if (!this.bleSupported()) throw new Error(this.why());
        return requestBlePort();
      }
      if (!this.usbSupported()) throw new Error(this.why());
      return navigator.serial.requestPort();
    },
    curBaud: 0, _loopP: null, _wq: null,
    /* เปิดพอร์ตที่มีอยู่แล้ว (ใช้ร่วมกันทุกทาง) — ถ้าเปิดอยู่แล้วที่พอร์ต/บอดเรตเดียวกันจะใช้ต่อเลย ไม่ปิดแล้วเปิดใหม่ */
    openPort: async function (port, baud, kind, onLine) {
      baud = baud || this.baud();
      if (this.open && this.port === port && this.curBaud === baud) {
        if (onLine) this.onLine = onLine;
        return port;
      }
      if (this.open || this.port) await this.disconnect();
      if (kind !== 'ble') {
        await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none' });
        this.lastPort = port;
      }
      this.port = port; this.kind = kind; this.curBaud = baud;
      this.open = true; this.onLine = onLine || null; this.buffer = '';
      this.loop();
      return port;
    },
    connect: async function (baud, onLine, kind) {
      kind = kind || (this.usbSupported() ? 'usb' : 'ble');
      const port = await this.requestPort(kind);               /* ขอพอร์ตก่อน เพื่อให้ยังนับเป็นการกดปุ่ม */
      return this.openPort(port, baud, kind, onLine);
    },
    /* พอร์ต USB ที่เคยอนุญาตไว้แล้ว — เปิดได้เองโดยไม่ต้องกดเลือกใหม่ */
    knownPort: async function () {
      if (!this.usbSupported() || !this.secure()) return null;
      if (this.lastPort) return this.lastPort;
      try { const l = await navigator.serial.getPorts(); return l.length ? l[0] : null; } catch (e) { return null; }
    },
    autoOpen: async function (baud, onLine) {
      if (this.open) return this.port;
      const port = await this.knownPort();
      if (!port) return null;
      try { return await this.openPort(port, baud, 'usb', onLine); } catch (e) { return null; }
    },
    loop: function () {
      const self = this;
      self.dbg = { n: (self.dbg ? self.dbg.n : 0) + 1, chunks: 0, errs: [], end: '' };
      this._loopP = (async function () {
        const decoder = new TextDecoder();
        const port = self.port;
        let ended = false, errs = 0;
        try {
          /* BREAK / Framing / Parity / BufferOverrun เป็นข้อผิดพลาดที่กู้คืนได้ — port.readable จะกลายเป็นสตรีมใหม่
             จึงต้องวนขอ reader ใหม่แล้วอ่านต่อ (เดิมจับ error แล้วถือว่าสายหลุด ทำให้หลัง BREAK แรกไม่รับอะไรอีกเลย)
             ส่วนสายหลุดจริง port.readable จะเป็น null แล้วออกจากลูปเอง */
          while (!ended && self.open && self.port === port && port.readable) {
            const reader = port.readable.getReader();
            self.reader = reader;
            try {
              while (self.open && self.port === port) {
                const { value, done } = await reader.read();
                if (done) { ended = true; break; }
                if (!value) continue;
                errs = 0; self.dbg.chunks++;
                if (self.onBytes) { try { self.onBytes(value); } catch (e) { } }
                self.buffer += decoder.decode(value, { stream: true });
                let idx;
                while ((idx = self.buffer.indexOf('\n')) >= 0) {
                  const line = self.buffer.slice(0, idx).replace(/\r$/, '');
                  self.buffer = self.buffer.slice(idx + 1);
                  if (line && self.onLine) { try { self.onLine(line); } catch (e) { } }
                }
              }
            } catch (e) {
              self.dbg.errs = self.dbg.errs.concat((e && e.name) || 'err').slice(-4);
              if (typeof console !== 'undefined') console.warn('[serial] read error', e && e.name, e && e.message);
              if (++errs > 50) ended = true;            /* error ซ้ำๆ โดยไม่มีข้อมูลเลย = พังจริง */
              else await new Promise(r => setTimeout(r, 5));
            } finally {
              try { reader.releaseLock(); } catch (e) { }
              if (self.reader === reader) self.reader = null;
            }
          }
        } finally {
          self.dbg.end = ended ? 'stream done/errors' : !self.open ? 'closed' : self.port !== port ? 'port changed' : !port.readable ? 'readable=null' : '?';
          /* อุปกรณ์หลุดเอง (ไม่ได้กดตัดการเชื่อมต่อ) */
          if (self.open && self.port === port) { self.open = false; self.port = null; if (self.onClose) self.onClose('unplug'); }
        }
      })();
      return this._loopP;
    },
    /* เขียนทีละคำสั่งตามลำดับ ไม่ให้ตัวเขียนซ้อนกัน (writer ล็อกอยู่ทีละตัว) */
    writeBytes: function (arr) {
      const self = this;
      const run = async function () {
        if (!self.port || !self.port.writable) return false;
        const w = self.port.writable.getWriter();
        try { await w.write(new Uint8Array(arr)); return true; }
        finally { try { w.releaseLock(); } catch (e) { } }
      };
      this._wq = (this._wq || Promise.resolve()).then(run, run);
      return this._wq;
    },
    write: function (text) { return this.writeBytes(new TextEncoder().encode(text)); },
    disconnect: async function () {
      const port = this.port, loopP = this._loopP;
      this.open = false;
      try { if (this.reader) await this.reader.cancel(); } catch (e) { }
      /* ต้องรอให้ลูปอ่านปล่อย reader ก่อน ไม่งั้น port.close() จะล้มเหลวและพอร์ตค้างเปิดอยู่ */
      try { if (loopP) await Promise.race([loopP, new Promise(r => setTimeout(r, 1500))]); } catch (e) { }
      try { if (this._wq) await Promise.race([this._wq, new Promise(r => setTimeout(r, 500))]); } catch (e) { }
      try { if (port) await port.close(); } catch (e) { }
      this.port = null; this.curBaud = 0; this.onBytes = null;
      if (this.onClose) this.onClose('manual');
    }
  };
  /* เสียบสาย/ถอดสาย → แจ้งทั้งแอป */
  if (typeof navigator !== 'undefined' && 'serial' in navigator) {
    navigator.serial.addEventListener('connect', function () { document.dispatchEvent(new CustomEvent('serial-plugged')); });
    navigator.serial.addEventListener('disconnect', function () { document.dispatchEvent(new CustomEvent('serial-unplugged')); });
  }

  /* เลือกช่องทางเชื่อมต่อ: USB หรือ บลูทูธ — ถ้ามีแบบเดียวก็ไปต่อเลย */
  App.chooseTransport = function (cb) {
    const S = App.serial;
    if (!S.secure() || !S.supported()) { App.toast(S.why(), 'bad'); return; }
    const BAUDS = [10400, 9600, 4800, 38400, 57600, 115200];
    let h = '<div class="sh-head"><b>เชื่อมต่ออุปกรณ์</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="lbl">บอดเรต (K-line ปกติ = 10400)</div><div class="row" style="flex-wrap:wrap;gap:6px" id="trBauds">';
    BAUDS.forEach(b => { h += '<button class="btn sm" data-baud="' + b + '">' + b + '</button>'; });
    h += '</div><div class="lbl">ช่องทาง</div>';
    if (S.usbSupported()) h += '<button class="item" id="trUsb"><div><div class="nm">สาย USB / OTG</div>' +
      '<div class="mt">เลือกพอร์ตที่ต่อกับสาย</div></div><div class="sp">›</div></button>';
    if (S.bleSupported()) h += '<button class="item" id="trBle" style="margin-top:6px"><div><div class="nm">บลูทูธ (BLE)</div>' +
      '<div class="mt">โมดูล BLE เช่น ESP32, HM-10 (Nordic UART / FFE0)</div></div><div class="sp">›</div></button>';
    App.sheet(h);
    const paint = () => {
      const cur = S.baud();
      document.querySelectorAll('#trBauds [data-baud]').forEach(el => {
        const on = parseInt(el.dataset.baud, 10) === cur;
        el.style.outline = on ? '2px solid var(--red, #ff5a44)' : '';
        el.style.fontWeight = on ? '700' : '';
      });
    };
    document.querySelectorAll('#trBauds [data-baud]').forEach(el => {
      el.onclick = () => { S.setBaud(parseInt(el.dataset.baud, 10)); paint(); };
    });
    paint();
    const u = document.getElementById('trUsb'), bl = document.getElementById('trBle');
    if (u) u.onclick = () => { App.closeSheet(); cb('usb'); };
    if (bl) bl.onclick = () => { App.closeSheet(); cb('ble'); };
  };

  /* ---------------- boot ---------------- */
  function bindShell() {
    const back = $('#btnBack');
    if (back) back.onclick = () => App.go('home');
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
    App.go('home');
    if (restored) App.toast('กู้คืนไฟล์ที่จูนค้างไว้แล้ว', 'good');
  };

  global.App = App;
  global.$ = $;
  global.$$ = $$;
})(window);
