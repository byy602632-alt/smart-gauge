/* ============================================================
   ECU TUNE — XDF parser + binary map engine
   รองรับ XDF มาตรฐาน TunerPro (XML) เท่านั้น
   flags: 0x01 signed · 0x02 LSB first · 0x04 column-major · 0x10000 float
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- equation compiler ---------------- */
  const FN = {
    abs: 'Math.abs', sqrt: 'Math.sqrt', pow: 'Math.pow', exp: 'Math.exp',
    ln: 'Math.log', log: 'Math.log10', sin: 'Math.sin', cos: 'Math.cos',
    tan: 'Math.tan', asin: 'Math.asin', acos: 'Math.acos', atan: 'Math.atan',
    atan2: 'Math.atan2', min: 'Math.min', max: 'Math.max', round: 'Math.round',
    floor: 'Math.floor', ceil: 'Math.ceil', sign: 'Math.sign', trunc: 'Math.trunc'
  };
  const VARS = { X: 'X', Y: 'Y', Z: 'Z' };

  function compile(src) {
    const raw = (src == null || String(src).trim() === '') ? 'X' : String(src).trim();
    const tokens = raw.match(/[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+|[+\-*/%^(),]/g);
    if (!tokens) return null;
    if (tokens.join('').replace(/\s+/g, '') !== raw.replace(/\s+/g, '')) return null;

    let out = '';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (/^[A-Za-z_]/.test(t)) {
        const key = t.toLowerCase();
        if (VARS[t] || VARS[t.toUpperCase()]) out += t.toUpperCase();
        else if (FN[key]) out += FN[key];
        else return null;
      } else if (t === '^') {
        out += '**';
      } else {
        out += t;
      }
    }
    try {
      const fn = new Function('X', 'Y', 'Z', 'with (Math) { return (' + out + '); }');
      const probe = fn(1, 1, 1);
      if (typeof probe !== 'number' || !isFinite(probe)) {
        const probe2 = fn(10, 7, 3);
        if (typeof probe2 !== 'number') return null;
      }
      return fn;
    } catch (e) {
      return null;
    }
  }

  function applyMath(fn, raw) {
    if (!fn) return raw;
    try {
      const v = fn(raw, 1, 1);
      return (typeof v === 'number' && isFinite(v)) ? v : raw;
    } catch (e) { return raw; }
  }

  /* inverse: display value -> raw integer (bisection + fallback scan) */
  function invertRaw(fn, target, bits, signed) {
    const max = Math.pow(2, bits);
    const lo = signed ? -(max / 2) : 0;
    const hi = signed ? (max / 2 - 1) : (max - 1);
    if (!fn) return Math.max(lo, Math.min(hi, Math.round(target)));

    const f = (v) => {
      try { const r = fn(v, 1, 1); return (typeof r === 'number' && isFinite(r)) ? r : NaN; }
      catch (e) { return NaN; }
    };
    const flo = f(lo), fhi = f(hi);
    if (!isFinite(flo) || !isFinite(fhi)) return null;

    const inc = fhi >= flo;
    let a = lo, b = hi;
    for (let i = 0; i < 64; i++) {
      const m = (a + b) / 2;
      const fm = f(m);
      if (!isFinite(fm)) break;
      if ((fm < target) === inc) a = m; else b = m;
    }
    const cand = [Math.round(a), Math.floor(a), Math.ceil(a), Math.round(b), Math.floor(b), Math.ceil(b)];
    let best = null, bestErr = Infinity;
    for (let i = 0; i < cand.length; i++) {
      let c = Math.max(lo, Math.min(hi, cand[i]));
      const e = Math.abs(f(c) - target);
      if (e < bestErr) { bestErr = e; best = c; }
    }
    /* not monotonic in range? scan everything (u8/u16 only) */
    const tol = Math.max(Math.abs(target) * 1e-4, 1e-4);
    if (bestErr > tol && !signed && bits <= 16) {
      for (let v = 0; v <= hi; v++) {
        const e = Math.abs(f(v) - target);
        if (e < bestErr) { bestErr = e; best = v; if (e === 0) break; }
      }
    }
    return best;
  }

  /* ---------------- flags / raw read-write ---------------- */
  function flagSet(flags, defaults, mask) {
    if (flags != null) return (flags & mask) !== 0;
    if (!defaults) return false;
    if (mask === 1) return !!defaults.signed;
    if (mask === 2) return !!defaults.lsb;
    return false;
  }

  function readRaw(bytes, addr, bits, flags, defaults) {
    const n = bits / 8;
    if (!bytes || addr == null || addr < 0 || addr + n > bytes.length) return null;
    try {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const lsb = flagSet(flags, defaults, 2);
      if (flagSet(flags, defaults, 0x10000) && bits === 32) {
        return dv.getFloat32(addr, lsb);
      }
      let v = 0;
      if (n === 1) v = bytes[addr];
      else if (lsb) {
        for (let i = n - 1; i >= 0; i--) v = v * 256 + bytes[addr + i];
      } else {
        for (let i = 0; i < n; i++) v = v * 256 + bytes[addr + i];
      }
      if (flagSet(flags, defaults, 1)) {
        const half = Math.pow(2, bits - 1);
        if (v >= half) v -= half * 2;
      }
      return v;
    } catch (e) { return null; }
  }

  function writeRaw(bytes, addr, bits, flags, defaults, value) {
    const n = bits / 8;
    if (!bytes || addr == null || addr < 0 || addr + n > bytes.length) return false;
    if (flagSet(flags, defaults, 0x10000)) return false; /* float write not supported */
    const signed = flagSet(flags, defaults, 1);
    const max = signed ? Math.pow(2, bits - 1) - 1 : Math.pow(2, bits) - 1;
    const lo = signed ? -Math.pow(2, bits - 1) : 0;
    let v = Math.round(value);
    if (!isFinite(v)) return false;
    v = Math.max(lo, Math.min(max, v));
    let u = v < 0 ? v + Math.pow(2, bits) : v;
    const lsb = flagSet(flags, defaults, 2);
    if (n === 1) bytes[addr] = u & 0xFF;
    else if (lsb) { for (let i = 0; i < n; i++) { bytes[addr + i] = u & 0xFF; u = Math.floor(u / 256); } }
    else { for (let i = n - 1; i >= 0; i--) { bytes[addr + i] = u & 0xFF; u = Math.floor(u / 256); } }
    return true;
  }

  const fmtHex = (n, pad) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(pad || 4, '0');

  /* ---------------- XDF parse ---------------- */
  function attr(el, name) { return el && el.getAttribute ? el.getAttribute(name) : null; }
  function num(v, dflt) {
    if (v == null || String(v).trim() === '') return dflt;
    const s = String(v).trim();
    if (/^0x/i.test(s)) { const n = parseInt(s, 16); return isNaN(n) ? dflt : n; }
    if (/^[+-]?\d+$/.test(s)) { const n = parseInt(s, 10); return isNaN(n) ? dflt : n; }
    const n = parseInt(s, 16);
    return isNaN(n) ? dflt : n;
  }
  function childList(el, tag) {
    const out = [];
    if (!el) return out;
    for (let i = 0; i < el.children.length; i++) if (el.children[i].nodeName === tag) out.push(el.children[i]);
    return out;
  }
  function child(el, tag) {
    if (!el) return null;
    for (let i = 0; i < el.children.length; i++) if (el.children[i].nodeName === tag) return el.children[i];
    return null;
  }
  function text(el, tag) {
    const c = child(el, tag);
    return c ? (c.textContent || '').trim() : '';
  }
  function mathOf(el) {
    const m = child(el, 'MATH');
    if (!m) return 'X';
    return attr(m, 'equation') || 'X';
  }

  function parseEmbedded(axisEl) {
    const ed = child(axisEl, 'EMBEDDEDDATA');
    if (!ed) return null;
    return {
      addr: attr(ed, 'mmedaddress') != null ? num(attr(ed, 'mmedaddress')) : null,
      bits: num(attr(ed, 'mmedelementsizebits'), 8),
      rows: num(attr(ed, 'mmedrowcount'), 1),
      cols: num(attr(ed, 'mmedcolcount'), 1),
      major: num(attr(ed, 'mmedmajorstridebits'), 0),
      minor: num(attr(ed, 'mmedminorstridebits'), 0),
      flags: attr(ed, 'mmedtypeflags') != null ? num(attr(ed, 'mmedtypeflags')) : null,
      mask: attr(ed, 'mmedbitmask') != null ? num(attr(ed, 'mmedbitmask')) : null
    };
  }

  function axisInfo(axisEl, defaults, baseOffset, idMap) {
    if (!axisEl) return null;
    const info = {
      id: attr(axisEl, 'id') || '',
      units: text(axisEl, 'units'),
      title: text(axisEl, 'title'),
      decimals: num(text(axisEl, 'decimalpl'), 0),
      count: num(text(axisEl, 'indexcount'), 0),
      labels: null,
      ref: null,
      mathFn: compile(mathOf(axisEl))
    };
    const labels = childList(axisEl, 'LABEL');
    if (labels.length) {
      info.labels = labels
        .sort((a, b) => num(attr(a, 'index'), 0) - num(attr(b, 'index'), 0))
        .map(l => { const v = parseFloat(attr(l, 'value')); return isNaN(v) ? attr(l, 'value') : v; });
    }
    const emb = parseEmbedded(axisEl);
    const link = axisEl.querySelector(':scope > embedinfo[type="2"]');
    const linkedId = link ? num(attr(link, 'linkobjid')) : null;
    if (linkedId != null && idMap[linkedId]) {
      const linked = idMap[linkedId];
      const lemb = parseEmbedded(linked);
      if (lemb && lemb.addr != null) {
        info.ref = {
          addr: lemb.addr + baseOffset,
          bits: lemb.bits, flags: lemb.flags,
          major: lemb.major, minor: lemb.minor,
          mathFn: compile(mathOf(linked))
        };
      }
    } else if (emb && emb.addr != null) {
      info.ref = {
        addr: emb.addr + baseOffset,
        bits: emb.bits, flags: emb.flags,
        major: emb.major, minor: emb.minor,
        mathFn: info.mathFn
      };
    }
    return info;
  }

  function axisValues(axis, bytes, defaults, fallbackCount) {
    const n = axis.count || fallbackCount || 0;
    if (axis.labels && axis.labels.length) {
      const out = axis.labels.slice(0, n || axis.labels.length);
      while (out.length < n) out.push(out.length);
      return out;
    }
    if (axis.ref && bytes) {
      const out = [];
      const step = axis.ref.minor || axis.ref.bits;
      for (let i = 0; i < n; i++) {
        const addr = axis.ref.addr + Math.floor((i * step) / 8);
        const raw = readRaw(bytes, addr, axis.ref.bits, axis.ref.flags, defaults);
        if (raw == null) { out.push(i); continue; }
        out.push(applyMath(axis.ref.mathFn, raw));
      }
      return out;
    }
    return Array.from({ length: n }, (_, i) => i);
  }

  function parse(textSource) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(textSource, 'text/xml');
    } catch (e) {
      const err = new Error('อ่านไฟล์ XDF ไม่ได้');
      err.code = 'XDF_XML';
      throw err;
    }
    const root = doc.documentElement;
    if (!root || root.nodeName !== 'XDFFORMAT') {
      const err = new Error('ไฟล์ XDF นี้ไม่ได้อยู่ในรูปแบบ XML มาตรฐาน (อาจถูกเข้ารหัส)');
      err.code = 'XDF_ENCRYPTED';
      throw err;
    }
    const pe = doc.querySelector('parsererror');
    if (pe) {
      const err = new Error('XDF มีรูปแบบ XML ไม่ถูกต้อง');
      err.code = 'XDF_XML';
      throw err;
    }

    const header = child(root, 'XDFHEADER') || root;
    const defaultsEl = child(header, 'DEFAULTS');
    const defaults = {
      bits: num(attr(defaultsEl, 'datasizeinbits'), 8) || 8,
      signed: num(attr(defaultsEl, 'signed'), 0) === 1,
      lsb: num(attr(defaultsEl, 'lsbfirst'), 0) === 1
    };
    const bo = child(header, 'BASEOFFSET');
    const boVal = bo ? num(attr(bo, 'offset'), 0) : 0;
    const subtract = bo ? num(attr(bo, 'subtract'), 0) : 0;
    const baseOffset = subtract ? -boVal : boVal;
    const region = child(header, 'REGION');
    const binSize = region ? num(attr(region, 'size'), 0) : 0;

    const categories = {};
    childList(header, 'CATEGORY').forEach(c => { categories[num(attr(c, 'index'))] = attr(c, 'name') || ''; });

    /* uniqueid map for linked axes */
    const idMap = {};
    for (let i = 0; i < root.children.length; i++) {
      const el = root.children[i];
      const id = attr(el, 'uniqueid');
      if (id != null) idMap[num(id)] = el;
    }

    const items = [];
    const pushTable = (el, kind) => {
      const zEl = childList(el, 'XDFAXIS').find(a => attr(a, 'id') === 'z');
      const xEl = childList(el, 'XDFAXIS').find(a => attr(a, 'id') === 'x');
      const yEl = childList(el, 'XDFAXIS').find(a => attr(a, 'id') === 'y');
      const emb = parseEmbedded(zEl || el);
      if (!emb || emb.addr == null) return;
      let rows = emb.rows > 0 ? emb.rows : 1;
      let cols = emb.cols > 0 ? emb.cols : 1;
      if (kind === 'const') { rows = 1; cols = 1; }
      const item = {
        kind: kind,
        title: text(el, 'title') || (kind === 'const' ? 'ค่าคงที่' : 'ตาราง'),
        desc: text(el, 'description'),
        address: emb.addr + baseOffset,
        rows: rows, cols: cols,
        sizeBits: emb.bits || defaults.bits,
        flags: emb.flags,
        majorBits: emb.major || 0,
        minorBits: emb.minor || 0,
        mathSrc: mathOf(zEl || el),
        mathFn: compile(mathOf(zEl || el)),
        units: (zEl && text(zEl, 'units')) || text(el, 'units') || '',
        decimals: (zEl && num(text(zEl, 'decimalpl'), 0)) || num(text(el, 'decimalpl'), 0),
        min: null,
        axisX: axisInfo(xEl, defaults, baseOffset, idMap),
        axisY: axisInfo(yEl, defaults, baseOffset, idMap),
        category: (() => {
          const cm = child(el, 'CATEGORYMEM');
          return cm ? (categories[num(attr(cm, 'category'))] || '') : '';
        })(),
        changed: 0
      };
      const zmin = zEl ? parseFloat(text(zEl, 'min')) : NaN;
      const zmax = zEl ? parseFloat(text(zEl, 'max')) : NaN;
      item.min = isNaN(zmin) ? null : zmin;
      item.max = isNaN(zmax) ? null : zmax;
      items.push(item);
    };

    childList(root, 'XDFTABLE').forEach(el => pushTable(el, 'table'));
    childList(root, 'XDFCONSTANT').forEach(el => pushTable(el, 'const'));

    childList(root, 'XDFFLAG').forEach(el => {
      const emb = parseEmbedded(el);
      if (!emb || emb.addr == null) return;
      items.push({
        kind: 'flag',
        title: text(el, 'title') || 'สวิตช์',
        desc: text(el, 'description'),
        address: emb.addr + baseOffset,
        rows: 1, cols: 1,
        sizeBits: emb.bits || 8,
        flags: emb.flags,
        mask: emb.mask || 1,
        mathSrc: '', mathFn: null,
        units: '', decimals: 0, min: null, max: null,
        category: '', changed: 0
      });
    });

    const cks = [];
    childList(root, 'XDFCHECKSUM').forEach(el => {
      const get = (names) => {
        const nodes = [el].concat(Array.from(el.querySelectorAll('*')));
        for (const node of nodes) {
          for (const a of node.attributes || []) {
            if (names.indexOf(a.name.toLowerCase()) >= 0) return num(a.value, null);
          }
        }
        return null;
      };
      const start = get(['start', 'startaddress', 'datastart', 'data_start']);
      const end = get(['end', 'endaddress', 'dataend', 'data_end']);
      const store = get(['store', 'storeaddress', 'store_address', 'checksumaddress']);
      const bits = get(['size', 'storesize', 'bits', 'checksumsize']) || 8;
      cks.push({
        title: text(el, 'title') || 'Checksum',
        start: start, end: end, store: store,
        bits: bits > 32 ? 8 : bits,
        valid: start != null && end != null && store != null,
        algorithm: 'sum'
      });
    });

    return {
      title: text(header, 'deftitle') || 'XDF',
      desc: text(header, 'description'),
      author: text(header, 'author'),
      version: text(header, 'fileversion') || attr(root, 'version') || '',
      binSize: binSize,
      defaults: defaults,
      items: items,
      checksums: cks,
      categories: categories
    };
  }

  /* ---------------- resolved items (bind to bytes) ---------------- */
  function resolve(def, bytes) {
    const defaults = def.defaults;
    def.items.forEach(item => {
      if (item.kind === 'flag') return;
      const maxBits = item.sizeBits * item.rows * item.cols;
      if (!item.axisX) item.axisX = null;
      if (!item.axisY) item.axisY = null;
      if (item.axisX) item.x = axisValues(item.axisX, bytes, defaults, item.cols);
      else item.x = Array.from({ length: item.cols }, (_, i) => i);
      if (item.axisY) item.y = axisValues(item.axisY, bytes, defaults, item.rows);
      else item.y = Array.from({ length: item.rows }, (_, i) => i);
      item.hasAxis = !!(item.axisX || item.axisY);
      item.sizeOk = item.address + Math.ceil(item.majorBits ? 0 : maxBits / 8) <= (bytes ? bytes.length : 0);
    });
    return def;
  }

  /* ---------------- cell access ---------------- */
  function cellAddr(item, r, c) {
    const size = item.sizeBits;
    const major = item.majorBits || (item.cols * size);
    const minor = item.minorBits || size;
    const colMajor = item.flags != null && (item.flags & 4);
    const bits = colMajor ? (c * major + r * minor) : (r * major + c * minor);
    return item.address + Math.floor(bits / 8);
  }

  function readCell(item, r, c, bytes, def) {
    const defaults = def ? def.defaults : null;
    if (item.kind === 'flag') {
      const raw = readRaw(bytes, item.address, 8, null, defaults);
      if (raw == null) return null;
      return (raw & item.mask) ? 1 : 0;
    }
    const addr = cellAddr(item, r, c);
    const raw = readRaw(bytes, addr, item.sizeBits, item.flags, defaults);
    if (raw == null) return null;
    return applyMath(item.mathFn, raw);
  }

  function readRawCell(item, r, c, bytes, def) {
    const defaults = def ? def.defaults : null;
    return readRaw(bytes, cellAddr(item, r, c), item.sizeBits, item.flags, defaults);
  }

  function writeCell(item, r, c, value, bytes, def) {
    const defaults = def ? def.defaults : null;
    if (item.kind === 'flag') {
      const addr = item.address;
      let raw = readRaw(bytes, addr, 8, null, defaults);
      if (raw == null) return false;
      raw = value ? (raw | item.mask) : (raw & ~item.mask);
      return writeRaw(bytes, addr, 8, null, defaults, raw);
    }
    const raw = invertRaw(item.mathFn, value, item.sizeBits, item.flags != null ? (item.flags & 1) !== 0 : !!(defaults && defaults.signed));
    if (raw == null) return false;
    return writeRaw(bytes, cellAddr(item, r, c), item.sizeBits, item.flags, defaults, raw);
  }

  function scanChangeCount(item, bytes, orig, def) {
    if (!bytes || !orig) return 0;
    if (item.kind === 'flag') {
      const a = readRaw(bytes, item.address, 8, null, def.defaults);
      const b = readRaw(orig, item.address, 8, null, def.defaults);
      return a === b ? 0 : 1;
    }
    let n = 0;
    for (let r = 0; r < item.rows; r++) {
      for (let c = 0; c < item.cols; c++) {
        const a = cellAddr(item, r, c);
        const len = Math.max(1, item.sizeBits / 8);
        let diff = false;
        for (let i = 0; i < len; i++) if (bytes[a + i] !== orig[a + i]) { diff = true; break; }
        if (diff) n++;
      }
    }
    return n;
  }

  function diffBytes(bytes, orig) {
    if (!bytes || !orig) return 0;
    const len = Math.min(bytes.length, orig.length);
    let n = 0;
    for (let i = 0; i < len; i++) if (bytes[i] !== orig[i]) n++;
    return n;
  }

  /* ---------------- fallback auto scan (no/invalid XDF) ---------------- */
  function autoScan(bytes) {
    const out = [];
    if (!bytes || bytes.length < 512) return out;
    const R = 16, C = 16;
    const step = Math.max(1, Math.round(bytes.length / 5000));

    function score(addr, size) {
      const need = R * C * size;
      if (addr + need > bytes.length) return null;
      const cap = size === 2 ? 65535 : 255;
      const vals = new Array(R * C);
      let min = Infinity, max = -Infinity, sum = 0, bad = 0;
      for (let i = 0; i < R * C; i++) {
        const p = addr + i * size;
        const v = size === 2 ? (bytes[p] | (bytes[p + 1] << 8)) : bytes[p];
        vals[i] = v;
        if (v === 0 || v >= cap * 0.99) bad++;
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      if (bad > R * C * 0.10) return null;
      const range = max - min;
      if (range < cap * 0.02) return null;
      let rough = 0, pairs = 0, up = 0, down = 0;
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          const v = vals[r * C + c];
          if (c + 1 < C) {
            const d = vals[r * C + c + 1] - v;
            rough += Math.abs(d); pairs++;
            if (d > 0) up++; else if (d < 0) down++;
          }
          if (r + 1 < R) {
            const d = vals[(r + 1) * C + c] - v;
            rough += Math.abs(d) * 0.7; pairs++;
            if (d > 0) up++; else if (d < 0) down++;
          }
        }
      }
      const roughPer = rough / pairs;
      if (roughPer > range * 0.45) return null;
      const trend = Math.max(up, down) / Math.max(1, up + down);
      if (trend < 0.6) return null;
      const smooth = 1 - (roughPer / Math.max(1, range));
      const band = Math.min(1, range / (cap * 0.35));
      return { score: smooth * 0.5 + trend * 0.35 + band * 0.15, min, max, avg: sum / (R * C) };
    }

    for (const size of [2, 1]) {
      for (let addr = 0; addr + R * C * size <= bytes.length; addr += step) {
        if (bytes[addr] === 0xFF && bytes[addr + 1] === 0xFF && bytes[addr + 2] === 0xFF) continue;
        const s = score(addr, size);
        if (s) out.push(Object.assign({ addr, size }, s));
      }
    }
    out.sort((a, b) => b.score - a.score);
    const picked = [];
    for (const cand of out) {
      const a0 = cand.addr, a1 = cand.addr + R * C * cand.size;
      if (picked.some(p => a0 < p.addr + R * C * p.size && p.addr < a1)) continue;
      picked.push(cand);
      if (picked.length >= 8) break;
    }
    return picked.map((m, i) => ({
      kind: 'table',
      title: 'พื้นที่ ' + (i + 1) + ' · ' + fmtHex(m.addr),
      desc: 'ตรวจพบอัตโนมัติจากไฟล์ BIN (ไม่มี XDF ที่อ่านได้)',
      address: m.addr, rows: R, cols: C,
      sizeBits: m.size * 8,
      flags: 0x02,
      majorBits: 0, minorBits: 0,
      mathSrc: 'X', mathFn: null,
      units: '', decimals: 0, min: m.min, max: m.max,
      x: Array.from({ length: C }, (_, i) => i),
      y: Array.from({ length: R }, (_, i) => i),
      hasAxis: false,
      scan: true,
      changed: 0
    }));
  }

  /* ---------------- XDF writer (TunerPro XML, ใช้กับ parser ในไฟล์นี้ได้) ---------------- */
  function escXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function hexAddr(n) { return '0x' + (n >>> 0).toString(16).toUpperCase(); }

  function writeXdfAxisZ(it) {
    let s = '<XDFAXIS id="z">';
    if (it.units) s += '<units>' + escXml(it.units) + '</units>';
    s += '<decimalpl>' + (it.decimals || 0) + '</decimalpl>';
    if (it.min != null && isFinite(it.min)) s += '<min>' + it.min + '</min>';
    if (it.max != null && isFinite(it.max)) s += '<max>' + it.max + '</max>';
    if (it.address != null && isFinite(it.address)) {
      s += '<EMBEDDEDDATA mmedaddress="' + hexAddr(it.address) +
        '" mmedelementsizebits="' + (it.sizeBits || 8) +
        '" mmedrowcount="' + (it.rows || 1) +
        '" mmedcolcount="' + (it.cols || 1) + '"';
      if ((it.flags & 2)) s += ' mmedtypeflags="2"';
      s += '/>';
    }
    s += '<MATH equation="X"/>';
    s += '</XDFAXIS>';
    return s;
  }

  function writeXdfAxisIndex(id, count, units) {
    if (!count || count <= 1) return '';
    let s = '<XDFAXIS id="' + id + '">';
    if (units) s += '<units>' + escXml(units) + '</units>';
    s += '<indexcount>' + count + '</indexcount>';
    s += '</XDFAXIS>';
    return s;
  }

  function writeXdf(items, meta) {
    meta = meta || {};
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    x += '<XDFFORMAT version="3.001">\n';
    x += '<XDFHEADER>\n';
    x += '<deftitle>' + escXml(meta.title || 'แมพของฉัน') + '</deftitle>\n';
    x += '<author>' + escXml(meta.author || 'ECU TUNE app') + '</author>\n';
    if (meta.description) x += '<description>' + escXml(meta.description) + '</description>\n';
    x += '<DEFAULTS datasizeinbits="8" signed="0" lsbfirst="0"/>\n';
    x += '<BASEOFFSET offset="0x0" subtract="1"/>\n';
    if (meta.binSize) x += '<REGION size="' + (meta.binSize >>> 0) + '"/>\n';
    x += '</XDFHEADER>\n';
    let uid = 100;
    (items || []).forEach(it => {
      const rows = Math.max(1, it.rows || 1), cols = Math.max(1, it.cols || 1);
      const isConst = it.kind === 'const' || (rows * cols <= 1 && it.kind !== 'flag');
      x += (isConst ? '<XDFCONSTANT' : '<XDFTABLE') + ' uniqueid="' + (uid++) + '">\n';
      x += '<title>' + escXml(it.title || (isConst ? 'ค่าคงที่' : 'ตาราง')) + '</title>\n';
      if (it.category) x += '<CATEGORYMEM category="1"/>\n';
      x += writeXdfAxisZ(Object.assign({}, it, { rows: rows, cols: cols })) + '\n';
      if (!isConst) {
        x += writeXdfAxisIndex('y', rows, '') + '\n';
        x += writeXdfAxisIndex('x', cols, '') + '\n';
      }
      x += (isConst ? '</XDFCONSTANT>' : '</XDFTABLE>') + '\n';
    });
    x += '</XDFFORMAT>\n';
    return x;
  }

  /* ---------------- checksums ---------------- */
  function sum8(bytes, start, end) {
    let s = 0;
    for (let i = start; i <= end && i < bytes.length; i++) s = (s + bytes[i]) & 0xFF;
    return s;
  }
  function sum16(bytes, start, end) {
    let s = 0;
    for (let i = start; i <= end && i < bytes.length; i++) s = (s + bytes[i]) & 0xFFFF;
    return s;
  }
  function crc16(bytes, start, end) {
    let crc = 0xFFFF;
    for (let i = start; i <= end && i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let b = 0; b < 8; b++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
    }
    return crc & 0xFFFF;
  }

  global.Xdf = {
    parse, resolve, autoScan, compile, applyMath, invertRaw, writeXdf,
    readRaw, writeRaw, readCell, readRawCell, writeCell, cellAddr,
    scanChangeCount, diffBytes, sum8, sum16, crc16, fmtHex
  };
})(window);
