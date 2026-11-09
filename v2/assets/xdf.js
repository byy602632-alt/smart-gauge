
/* ============================================================
   ECU TUNE — XDF Parser & TunerPro Parity Engine (Fixed IIFE)
   ============================================================ */
(function (global) {
  'use strict';
 
  function parseNumber(v, dflt = 0) {
    if (v == null) return dflt;
    const s = String(v).trim();
    if (/^0x/i.test(s)) {
      const n = parseInt(s, 16);
      return Number.isFinite(n) ? n : dflt;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : dflt;
  }
 
  const MATH_FN = { ABS:'abs', ACOS:'acos', ASIN:'asin', ATAN:'atan', ATAN2:'atan2', CEIL:'ceil', COS:'cos',
    EXP:'exp', FLOOR:'floor', LOG:'log', LN:'log', LOG10:'log10', MAX:'max', MIN:'min', POW:'pow',
    ROUND:'round', SIN:'sin', SQRT:'sqrt', TAN:'tan', INT:'trunc', TRUNC:'trunc' };
  function compileMath(src) {
    const raw = (src == null || String(src).trim() === '') ? 'X' : String(src).trim();
    // TunerPro ไม่แยกตัวพิมพ์เล็ก/ใหญ่ของชื่อฟังก์ชัน และใช้ ^ เป็นยกกำลัง
    const clean = raw
      .replace(/\^/g, '**')
      .replace(/\b([A-Za-z0-9]+)\s*\(/g, (m, name) => MATH_FN[name.toUpperCase()] ? 'Math.' + MATH_FN[name.toUpperCase()] + '(' : m)
      .replace(/\bPI\b/gi, 'Math.PI')
      .replace(/\bx\b/g, 'X').replace(/\by\b/g, 'Y').replace(/\bz\b/g, 'Z'); // TunerPro ไม่แยกตัวพิมพ์ของ X
    try {
      const f = new Function('X', 'Y', 'Z', 'return (' + clean + ');');
      const fn = (x, y, z) => f(x, y == null ? 1 : y, z == null ? 1 : z);
      fn(1, 1, 1);
      return { fn, source: raw, error: null };
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[XDF] สมการอ่านไม่ได้:', JSON.stringify(raw), '→', JSON.stringify(clean), e.message);
      return { fn: (x) => x, source: raw, error: e.message };
    }
  }
 
  function tagNameOf(node) {
    return ((node && (node.localName || node.tagName)) || '').toUpperCase();
  }
 
  function childElements(parent, name) {
    const wanted = name.toUpperCase();
    const out = [];
    if (!parent || !parent.children) return out;
    for (const node of parent.children) {
      if (tagNameOf(node) === wanted) out.push(node);
    }
    return out;
  }
 
  function childElement(parent, name) {
    return childElements(parent, name)[0] || null;
  }
 
  function childText(parent, name, fallback = '') {
    const node = childElement(parent, name);
    if (!node) return fallback;
    return (node.textContent || '').trim();
  }
 
  function attrNumber(el, name, fallback = NaN) {
    if (!el || !el.hasAttribute(name)) return fallback;
    return parseNumber(el.getAttribute(name), fallback);
  }
 
  function attrBool(el, name, fallback = false) {
    if (!el || !el.hasAttribute(name)) return fallback;
    const raw = String(el.getAttribute(name)).trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes') return true;
    if (raw === '0' || raw === 'false' || raw === 'no') return false;
    return fallback;
  }
 
  function makeElement(embed, defaults) {
    const hasFlags = !!(embed && embed.hasAttribute('mmedtypeflags'));
    const rawFlags = hasFlags ? attrNumber(embed, 'mmedtypeflags', 0) : 0;
    const useDefaults = !hasFlags || rawFlags === 0 || !Number.isFinite(rawFlags);
 
    const signed = useDefaults ? !!defaults.signed : (rawFlags & 0x01) !== 0;
    const littleEndian = useDefaults ? !!defaults.littleEndian : (rawFlags & 0x02) !== 0;
    const float = useDefaults ? !!defaults.float : (rawFlags & 0x04) !== 0;
 
    let sizeBits = embed ? attrNumber(embed, 'mmedelementsizebits', NaN) : NaN;
    if (!Number.isFinite(sizeBits) || sizeBits <= 0) {
      sizeBits = defaults && defaults.sizeBits ? defaults.sizeBits : 8;
    }
    return { sizeBits, signed, littleEndian, float };
  }
 
  function readMath(scope) {
    const mathEl = childElement(scope, 'MATH');
    if (!mathEl) return compileMath('X');
    return compileMath(mathEl.getAttribute('equation') || 'X');
  }
 
  function readLabels(axisEl) {
    const labels = [];
    for (const label of childElements(axisEl, 'LABEL')) {
      const index = attrNumber(label, 'index', NaN);
      const value = label.getAttribute('value');
      if (Number.isFinite(index) && value != null) labels[index] = value;
    }
    return labels;
  }
 
  function readAxis(axisEl, defaults, baseOffsetValue) {
    const embed = childElement(axisEl, 'EMBEDDEDDATA');
    const element = makeElement(embed, defaults);
    const rawAddress = embed && embed.hasAttribute('mmedaddress') ? attrNumber(embed, 'mmedaddress', NaN) : NaN;
    const indexCount = parseNumber(childText(axisEl, 'indexcount', '0'), 0);
    const majorStride = attrNumber(embed, 'mmedmajorstridebits', 0);
    const minorStride = attrNumber(embed, 'mmedminorstridebits', 0);
    const decimals = parseNumber(childText(axisEl, 'decimalpl', '2'), 2);
    const outputType = parseNumber(childText(axisEl, 'outputtype', '1'), 1);
    
    const infoEl = childElement(axisEl, 'embedinfo');
    const embedInfoType = infoEl ? attrNumber(infoEl, 'type', 0) || 0 : 0;
    const linkObjId = infoEl ? String(infoEl.getAttribute('linkobjid') || '').toLowerCase() : '';
 
    return {
      id: (axisEl.getAttribute('id') || '').toLowerCase(),
      element,
      address: Number.isFinite(rawAddress) ? rawAddress + baseOffsetValue : null,
      rawAddress: Number.isFinite(rawAddress) ? rawAddress : null,
      indexCount: Number.isFinite(indexCount) ? indexCount : 0,
      majorStride: majorStride > 0 ? majorStride : 0,
      minorStride: minorStride > 0 ? minorStride : 0,
      embedRowCount: attrNumber(embed, 'mmedrowcount', 0) || 0,
      embedColCount: attrNumber(embed, 'mmedcolcount', 0) || 0,
      labels: readLabels(axisEl),
      math: readMath(axisEl),
      decimals: Number.isFinite(decimals) ? decimals : 2,
      outputType: Number.isFinite(outputType) ? outputType : 1,
      units: childText(axisEl, 'units', ''),
      min: parseNumber(childText(axisEl, 'min', 'NaN'), NaN),
      max: parseNumber(childText(axisEl, 'max', 'NaN'), NaN),
      embedInfoType,
      linkObjId,
      linkedTo: '',
    };
  }
 
  function resolveLinkedAxes(items) {
    const tables = items.filter((item) => item.kind === 'table');
    const byUniqueId = new Map();
    const byAddress = new Map();
    for (const table of tables) {
      if (table.uniqueId) byUniqueId.set(String(table.uniqueId).toLowerCase(), table);
      if (table.address != null && !byAddress.has(table.address)) byAddress.set(table.address, table);
    }
    const labelStrideBits = (table) => {
      const bits = (table.fileRows || 1) > 1 ? table.rowPitchBits : table.withinRowStrideBits;
      return bits > 0 ? bits : table.element.sizeBits;
    };
    const borrow = (axis, source) => {
      axis.element = source.element;
      axis.math = source.math;
      axis.decimals = source.decimals;
      if (!axis.units) axis.units = source.units || '';
      if (axis.address == null) axis.address = source.address;
      if (!(axis.indexCount > 0)) axis.indexCount = (source.fileRows || 0) * (source.fileCols || 0);
      axis.majorStride = labelStrideBits(source);
      axis.linkedTo = source.title || source.uniqueId;
    };
    for (const item of tables) {
      if (!item.axes) continue;
      for (const axis of [item.axes.x, item.axes.y]) {
        if (!axis || axis.embedInfoType !== 3 || axis.linkedTo) continue;
        let linked = (axis.linkObjId && byUniqueId.get(axis.linkObjId)) || (axis.address != null ? byAddress.get(axis.address) : null);
        const selfShaped = !linked && axis.address == null && axis.indexCount > 0
          && axis.indexCount === (item.fileRows || 0) * (item.fileCols || 0);
        if (selfShaped) linked = item;
        if (!linked || linked.kind !== 'table' || !linked.element) continue;
        borrow(axis, linked);
      }
    }
  }
 
  function categoriesOf(itemEl, headerCategories) {
    const names = [];
    for (const mem of childElements(itemEl, 'CATEGORYMEM')) {
      const category = attrNumber(mem, 'category', NaN);
      const slot = attrNumber(mem, 'index', NaN);
      const byCategory = Number.isFinite(category) ? headerCategories[category - 1] : null;
      const bySlot = Number.isFinite(slot) ? headerCategories[slot] : null;
      const picked = byCategory || bySlot;
      if (picked && picked.name && !names.includes(picked.name)) names.push(picked.name);
    }
    return names;
  }
 
  function baseItem(el, header) {
    const uniqueId = el.getAttribute('uniqueid') || '';
    const title = childText(el, 'title', '') || `(ไม่มีชื่อ ${uniqueId})`.trim();
    return {
      id: 'item:' + (uniqueId || title),
      uniqueId,
      kind: 'unknown',
      title,
      description: childText(el, 'description', ''),
      categories: categoriesOf(el, header.categories),
      issues: [],
      supported: true,
    };
  }
 
  function parseTable(el, header) {
    const item = baseItem(el, header);
    item.kind = 'table';
    item.tableFlags = attrNumber(el, 'flags', 0) || 0;
 
    const axes = {};
    for (const axisEl of childElements(el, 'XDFAXIS')) {
      const id = (axisEl.getAttribute('id') || '').toLowerCase();
      if (['x', 'y', 'z'].includes(id)) axes[id] = readAxis(axisEl, header.defaults, header.baseOffsetValue);
    }
    if (!axes.z || axes.z.address == null) {
      item.kind = 'note';
      item.issues = [];
      return item;
    }
 
    const zAxis = axes.z;
    const element = zAxis.element;
    item.element = element;
    item.sizeBits = element.sizeBits; // ป้องกันปัญหา undefined bit ที่หน้า UI
    item.rawAddress = zAxis.rawAddress;
    item.address = zAxis.address;
    item.math = zAxis.math;
    if (zAxis.math && zAxis.math.error) {
      item.issues.push(`สมการใน XDF อ่านไม่ได้: ${zAxis.math.source}`);
    }
    item.units = zAxis.units;
    item.decimals = zAxis.decimals;
    item.outputType = zAxis.outputType;
    item.min = zAxis.min;
    item.max = zAxis.max;
 
    const topRows = parseNumber(childText(el, 'rowcount', '0'), 0);
    const topCols = parseNumber(childText(el, 'colcount', '0'), 0);
    let cols = topCols > 0 ? topCols : axes.x && axes.x.indexCount > 0 ? axes.x.indexCount : zAxis.embedColCount || 1;
    let rows = topRows > 0 ? topRows : axes.y && axes.y.indexCount > 0 ? axes.y.indexCount : zAxis.embedRowCount || 1;
    cols = Math.max(1, Math.round(cols));
    rows = Math.max(1, Math.round(rows));
 
    const within = zAxis.majorStride || element.sizeBits;
    const tail = zAxis.minorStride || element.sizeBits;
 
    // TunerPro แสดงตามที่ XDF กำหนดเสมอ: แกน X = หัวตารางด้านบน, แกน Y = ด้านซ้าย
    // (ไม่สลับแกนเองตามหน่วย rpm/tps อีกต่อไป)
    item.fileRows = rows;
    item.fileCols = cols;
    item.transposed = false;
    item.rows = rows;
    item.cols = cols;
    item.withinRowStrideBits = within;
    item.tailStrideBits = tail;
    item.rowPitchBits = tail + (cols - 1) * within;
    item.axes = { x: axes.x || null, y: axes.y || null, z: zAxis };
 
    item.effectiveRows = item.rows;
    return item;
  }
 
  function parseConstant(el, header) {
    const item = baseItem(el, header);
    item.kind = 'constant';
    const embed = childElement(el, 'EMBEDDEDDATA');
    const element = makeElement(embed, header.defaults);
    const rawAddress = embed && embed.hasAttribute('mmedaddress') ? attrNumber(embed, 'mmedaddress', NaN) : NaN;
    if (!Number.isFinite(rawAddress)) {
      item.kind = 'note';
      item.issues = [];
      return item;
    }
    item.element = element;
    item.sizeBits = element.sizeBits;
    item.rawAddress = rawAddress;
    item.address = rawAddress + header.baseOffsetValue;
    item.math = readMath(el);
    item.units = childText(el, 'units', '');
    item.decimals = parseNumber(childText(el, 'decimalpl', '2'), 2);
    return item;
  }
 
  function parseXdf(xmlText, { binSize = 0 } = {}) {
    if (!String(xmlText || '').replace(/^\uFEFF/, '').trimStart().startsWith('<')) {
      throw new Error('ไฟล์ XDF นี้ถูกเข้ารหัส/ล็อกไว้');
    }
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error('อ่านไฟล์ XDF ไม่ได้: รูปแบบ XML ไม่ถูกต้อง');
    }
    const root = doc.documentElement;
    if (!root || tagNameOf(root) !== 'XDFFORMAT') {
      throw new Error('ไฟล์นี้ไม่ใช่ XDF');
    }
 
    const headerEl = childElement(root, 'XDFHEADER');
    const baseOffsetEl = headerEl ? childElement(headerEl, 'BASEOFFSET') : null;
    const offset = attrNumber(baseOffsetEl, 'offset', 0) || 0;
    const subtract = attrBool(baseOffsetEl, 'subtract', false);
    const defaultsEl = headerEl ? childElement(headerEl, 'DEFAULTS') : null;
 
    const categories = [];
    if (headerEl) {
      let position = 0;
      for (const categoryEl of childElements(headerEl, 'CATEGORY')) {
        categories.push({ index: attrNumber(categoryEl, 'index', position), name: categoryEl.getAttribute('name') || `หมวด ${position + 1}` });
        position += 1;
      }
    }
 
    let declaredBinSize = 0;
    if (headerEl) {
      const region = childElement(headerEl, 'REGION');
      if (region) declaredBinSize = attrNumber(region, 'size', 0) || 0;
    }
 
    const header = {
      baseOffsetValue: subtract ? -offset : offset,
      baseOffset: { offset, subtract },
      defaults: {
        sizeBits: defaultsEl ? attrNumber(defaultsEl, 'datasizeinbits', 8) || 8 : 8,
        signed: defaultsEl ? attrBool(defaultsEl, 'signed', false) : false,
        littleEndian: defaultsEl ? attrBool(defaultsEl, 'lsbfirst', true) : true,
        float: defaultsEl ? attrBool(defaultsEl, 'float', false) : false,
      },
      categories,
      binSize: declaredBinSize || binSize || 0,
    };
 
    const items = [];
    for (const node of root.querySelectorAll('XDFTABLE, XDFCONSTANT, XDFFLAG, XDFPATCH')) {
      const tag = tagNameOf(node);
      let item;
      if (tag === 'XDFTABLE') item = parseTable(node, header);
      else if (tag === 'XDFCONSTANT') item = parseConstant(node, header);
      if (item) items.push(item);
    }
    resolveLinkedAxes(items);
 
    return {
      version: root.getAttribute('version') || '',
      title: headerEl ? childText(headerEl, 'deftitle', '') : '',
      items,
      defaults: header.defaults,
    };
  }
 
  function readRawBytes(bytes, addr, element) {
    const bits = element.sizeBits || 8;
    const n = bits / 8;
    if (!bytes || addr == null || addr < 0 || addr + n > bytes.length) return null;
    try {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const lsb = element.littleEndian;
      if (element.float && bits === 32) return dv.getFloat32(addr, lsb);
      let v = 0;
      if (n === 1) v = bytes[addr];
      else if (lsb) { for (let i = n - 1; i >= 0; i--) v = v * 256 + bytes[addr + i]; }
      else { for (let i = 0; i < n; i++) v = v * 256 + bytes[addr + i]; }
      if (element.signed) {
        const half = Math.pow(2, bits - 1);
        if (v >= half) v -= half * 2;
      }
      return v;
    } catch (e) { return null; }
  }
 
  function evaluateAxisValues(axis, count, bytes) {
    if (!axis || count <= 0) return Array.from({ length: count }, (_, i) => i);
    if (axis.address == null && axis.labels && axis.labels.length) {
      return Array.from({ length: count }, (_, i) => {
        const l = axis.labels[i];
        if (l == null) return i;
        const n = Number(l);
        return Number.isFinite(n) ? n : l;
      });
    }
    if (axis.address != null && bytes) {
      const out = [];
      const step = axis.majorStride || axis.element.sizeBits;
      let lastVal = 0;
      for (let i = 0; i < count; i++) {
        const readIndex = (axis.indexCount && i >= axis.indexCount) ? axis.indexCount - 1 : i;
        const addr = axis.address + Math.floor((readIndex * step) / 8);
        const raw = readRawBytes(bytes, addr, axis.element);
        if (raw == null || isNaN(raw)) {
          out.push(lastVal);
          continue;
        }
        try {
          const val = axis.math.fn(raw, 1, 1);
          const res = (typeof val === 'number' && isFinite(val)) ? val : raw;
          lastVal = res;
          out.push(res);
        } catch (e) {
          out.push(lastVal);
        }
      }
      return out;
    }
    return Array.from({ length: count }, (_, i) => i);
  }
 
  function resolve(def, bytes) {
    def.items.forEach(item => {
      if (item.kind !== 'table') return;
      if (item.axes && item.axes.y) {
        item.y = evaluateAxisValues(item.axes.y, item.rows, bytes);
      } else {
        item.y = Array.from({ length: item.rows }, (_, i) => i);
      }
      if (item.axes && item.axes.x) {
        item.x = evaluateAxisValues(item.axes.x, item.cols, bytes);
      } else {
        item.x = Array.from({ length: item.cols }, (_, i) => i);
      }
      item.effectiveRows = item.rows;
    });
    return def;
  }
 
  function cellAddress(item, row, col) {
    const r = item.transposed ? col : row;
    const c = item.transposed ? row : col;
    const bits = r * item.rowPitchBits + c * item.withinRowStrideBits;
    return item.address + Math.round(bits / 8);
  }
 
  function readCell(item, r, c, bytes, def) {
    if (!item.element) return null;
    const addr = cellAddress(item, r, c);
    const raw = readRawBytes(bytes, addr, item.element);
    if (raw == null) return null;
    try {
      const val = item.math.fn(raw, 1, 1);
      return (typeof val === 'number' && isFinite(val)) ? val : raw;
    } catch (e) { return raw; }
  }
 
  function readRawCell(item, r, c, bytes, def) {
    if (!item.element) return null;
    return readRawBytes(bytes, cellAddress(item, r, c), item.element);
  }
 
  function writeCell(item, r, c, value, bytes, def) {
    const element = item.element;
    let targetRaw = Math.round(value);
    const addr = cellAddress(item, r, c);
    const n = element.sizeBits / 8;
    if (!bytes || addr < 0 || addr + n > bytes.length) return false;
    if (element.float && element.sizeBits === 32) {
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setFloat32(addr, value, element.littleEndian);
      return true;
    }
    let u = targetRaw < 0 ? targetRaw + Math.pow(2, element.sizeBits) : targetRaw;
    const lsb = element.littleEndian;
    if (n === 1) bytes[addr] = u & 0xFF;
    else if (lsb) { for (let i = 0; i < n; i++) { bytes[addr + i] = u & 0xFF; u = Math.floor(u / 256); } }
    else { for (let i = n - 1; i >= 0; i--) { bytes[addr + i] = u & 0xFF; u = Math.floor(u / 256); } }
    return true;
  }
 
  function diffBytes(bytes, orig) {
    if (!bytes || !orig) return 0;
    const len = Math.min(bytes.length, orig.length);
    let n = 0;
    for (let i = 0; i < len; i++) if (bytes[i] !== orig[i]) n++;
    return n;
  }
 
 
  /* ---------- การแสดงผล / การกรอกค่าแบบ TunerPro ---------- */
  function formatValue(v, decimals, outputType) {
    if (typeof v !== 'number' || !isFinite(v)) return v == null ? '' : String(v);
    if (outputType === 2) return String(Math.round(v));
    if (outputType === 3) return '0x' + (Math.round(v) >>> 0).toString(16).toUpperCase();
    return v.toFixed(Math.max(0, decimals == null ? 2 : decimals));
  }
 
  function rawRange(el) {
    const b = el.sizeBits || 8;
    if (el.float) return [-Infinity, Infinity];
    return el.signed ? [-Math.pow(2, b - 1), Math.pow(2, b - 1) - 1] : [0, Math.pow(2, b) - 1];
  }
 
  // แปลงค่าที่ผู้ใช้พิมพ์ (หลังสมการ) กลับเป็นค่า raw ที่จะเขียนลงไบนารี
  function displayToRaw(item, value) {
    const el = item.element, fn = item.math.fn;
    if (el.float) { // float: เขียนตรงๆ ถ้าสมการเป็นเชิงเส้น
      const b0 = fn(0, 1, 1), a0 = fn(1, 1, 1) - b0;
      return a0 ? (value - b0) / a0 : value;
    }
    const [lo, hi] = rawRange(el);
    const f = (r) => { try { const v = fn(r, 1, 1); return typeof v === 'number' ? v : NaN; } catch (e) { return NaN; } };
    const b = f(0), a = f(1) - b;
    const mid = Math.min(hi, 100);
    if (a && isFinite(a) && Math.abs(f(mid) - (a * mid + b)) <= 1e-9 * (1 + Math.abs(f(mid)))) {
      return Math.min(hi, Math.max(lo, Math.round((value - b) / a)));
    }
    let best = 0, bestErr = Infinity;
    if ((el.sizeBits || 8) <= 16) { // สแกนทุกค่า raw เลือกค่าที่ใกล้ที่สุด
      for (let r = lo; r <= hi; r++) {
        const e = Math.abs(f(r) - value);
        if (e < bestErr) { bestErr = e; best = r; }
      }
      return best;
    }
    let L = lo, H = hi; // 32 บิต: bisection (สมมติสมการเพิ่ม/ลดต่อเนื่อง)
    const inc = f(H) >= f(L);
    for (let i = 0; i < 80; i++) {
      const m = (L + H) / 2;
      if ((f(m) < value) === inc) L = m; else H = m;
    }
    return Math.round((L + H) / 2);
  }
 
  function setCell(item, r, c, displayValue, bytes) {
    const n = Number(displayValue);
    if (!isFinite(n)) return false;
    const raw = displayToRaw(item, n);
    return writeCell(item, r, c, raw, bytes);
  }
 
  function heatColor(t) {
    const stops = [[150, 235, 240], [190, 185, 190], [255, 90, 90]];
    t = Math.min(1, Math.max(0, t));
    const k = t * 2, i = Math.min(1, Math.floor(k)), f = k - i;
    const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
 
  let cssDone = false;
  function injectCss() {
    if (cssDone) return; cssDone = true;
    const st = document.createElement('style');
    st.textContent = `
.tp-wrap{overflow:auto;max-width:100%;background:#2b2b2b;padding:2px}
.tp-table{border-collapse:collapse;font:12px Tahoma,Arial,sans-serif;color:#000}
.tp-table th{background:#e8e8e8;border:1px solid #888;padding:2px 6px;text-align:right;font-weight:normal;position:sticky;z-index:2}
.tp-table thead th{top:0}
.tp-table tbody th{left:0}
.tp-table th.tp-corner{left:0;top:0;z-index:3;background:#d0d0d0;text-align:center}
.tp-table td{border:1px solid #777;padding:0;min-width:52px}
.tp-table td input{width:100%;box-sizing:border-box;border:0;background:transparent;text-align:right;font:inherit;padding:2px 6px;outline:none}
.tp-table td input:focus{outline:2px solid #000;outline-offset:-2px;background:rgba(255,255,255,.35)}
.tp-table th.tp-hl{background:#ffe98a}`;
    document.head.appendChild(st);
  }
 
  /* วาดตารางแบบ TunerPro: X (เช่น TPS) อยู่ด้านบน, Y (เช่น RPM) อยู่ด้านซ้าย */
  function renderTable(item, bytes, container, opts) {
    opts = opts || {};
    injectCss();
    const editable = opts.editable !== false;
    const xs = item.x || Array.from({ length: item.cols }, (_, i) => i);
    const ys = item.y || Array.from({ length: item.rows }, (_, i) => i);
    const xa = item.axes && item.axes.x, ya = item.axes && item.axes.y;
    const fx = (v) => formatValue(v, xa ? xa.decimals : 2, xa ? xa.outputType : 1);
    const fy = (v) => formatValue(v, ya ? ya.decimals : 0, ya ? ya.outputType : 1);
    const fz = (v) => formatValue(v, item.decimals, item.outputType);
 
    const wrap = document.createElement('div'); wrap.className = 'tp-wrap';
    const table = document.createElement('table'); table.className = 'tp-table';
    const thead = table.createTHead().insertRow();
    const corner = document.createElement('th'); corner.className = 'tp-corner'; thead.appendChild(corner);
    const colTh = xs.map((v) => { const th = document.createElement('th'); th.textContent = typeof v === 'number' ? fx(v) : v; thead.appendChild(th); return th; });
    const tbody = table.createTBody();
    const inputs = [], rowTh = [];
    for (let r = 0; r < item.rows; r++) {
      const tr = tbody.insertRow();
      const th = document.createElement('th'); th.textContent = typeof ys[r] === 'number' ? fy(ys[r]) : ys[r]; tr.appendChild(th); rowTh.push(th);
      inputs[r] = [];
      for (let c = 0; c < item.cols; c++) {
        const td = tr.insertCell(); const inp = document.createElement('input');
        inp.type = 'text'; inp.readOnly = !editable; inp.dataset.r = r; inp.dataset.c = c;
        td.appendChild(inp); inputs[r][c] = inp;
      }
    }
    function refresh() {
      let mn = Infinity, mx = -Infinity; const vals = [];
      for (let r = 0; r < item.rows; r++) { vals[r] = []; for (let c = 0; c < item.cols; c++) {
        const v = readCell(item, r, c, bytes); vals[r][c] = v;
        if (typeof v === 'number') { mn = Math.min(mn, v); mx = Math.max(mx, v); } } }
      for (let r = 0; r < item.rows; r++) for (let c = 0; c < item.cols; c++) {
        const v = vals[r][c], inp = inputs[r][c];
        if (document.activeElement !== inp) inp.value = v == null ? '' : fz(v);
        inp.parentNode.style.background = typeof v === 'number' ? heatColor(mx > mn ? (v - mn) / (mx - mn) : 0) : '#999';
      }
    }
    function commit(inp) {
      const r = +inp.dataset.r, c = +inp.dataset.c;
      if (inp.value.trim() === '') { inp.value = fz(readCell(item, r, c, bytes)); return; }
      if (setCell(item, r, c, inp.value.trim().replace(',', '.'), bytes) && opts.onChange) opts.onChange(r, c, readRawCell(item, r, c, bytes));
      inp.value = fz(readCell(item, r, c, bytes)); // แสดงค่าที่ถูกปัดตามความละเอียดจริง เหมือน TunerPro
      refresh();
    }
    function focusCell(r, c) { if (inputs[r] && inputs[r][c]) { inputs[r][c].focus(); inputs[r][c].select(); } }
    table.addEventListener('keydown', (e) => {
      const inp = e.target; if (inp.tagName !== 'INPUT') return;
      const r = +inp.dataset.r, c = +inp.dataset.c;
      const go = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [e.shiftKey ? -1 : 1, 0] }[e.key];
      if (e.key === 'ArrowLeft' && inp.selectionStart === 0) { commit(inp); focusCell(r, c - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight' && inp.selectionEnd === inp.value.length) { commit(inp); focusCell(r, c + 1); e.preventDefault(); }
      else if (go) { commit(inp); focusCell(r + go[0], c + go[1]); e.preventDefault(); }
      else if (e.key === 'Escape') { inp.value = fz(readCell(item, r, c, bytes)); inp.blur(); }
    });
    table.addEventListener('focusin', (e) => {
      if (e.target.tagName !== 'INPUT') return;
      colTh.forEach((t) => t.classList.remove('tp-hl')); rowTh.forEach((t) => t.classList.remove('tp-hl'));
      colTh[+e.target.dataset.c].classList.add('tp-hl'); rowTh[+e.target.dataset.r].classList.add('tp-hl');
      e.target.select();
    });
    table.addEventListener('focusout', (e) => { if (e.target.tagName === 'INPUT') commit(e.target); });
    // วางข้อมูลหลายช่องจาก Excel/TunerPro (คั่นด้วย Tab / ขึ้นบรรทัดใหม่)
    table.addEventListener('paste', (e) => {
      const inp = e.target; if (inp.tagName !== 'INPUT' || !editable) return;
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\t\n]/.test(text.trim())) return;
      e.preventDefault();
      const r0 = +inp.dataset.r, c0 = +inp.dataset.c;
      text.trim().split(/\r?\n/).forEach((line, i) => line.split('\t').forEach((cell, j) => {
        const t = inputs[r0 + i] && inputs[r0 + i][c0 + j];
        if (t && cell.trim() !== '') { t.value = cell.trim(); commit(t); }
      }));
    });
    wrap.appendChild(table);
    container.innerHTML = ''; container.appendChild(wrap);
    refresh();
    return { refresh, element: wrap };
  }
 
 
  /* ---------- ฟังก์ชันที่ core.js / tune.js / flash.js เรียกใช้ ---------- */
  function readRaw(bytes, addr, sizeBits, flags, defaults) {
    const d = defaults || {};
    const f = Number(flags);
    const hasFlags = Number.isFinite(f) && f !== 0;
    return readRawBytes(bytes, addr, {
      sizeBits: sizeBits || 8,
      signed: hasFlags ? (f & 1) !== 0 : !!d.signed,
      littleEndian: hasFlags ? (f & 2) !== 0 : d.littleEndian !== false,
      float: hasFlags ? (f & 4) !== 0 : !!d.float,
    });
  }
  function sum8(b, s, e) { let t = 0; for (let i = s; i <= e && i < b.length; i++) t = (t + b[i]) & 0xFF; return t; }
  function sum16(b, s, e) { let t = 0; for (let i = s; i <= e && i < b.length; i++) t = (t + b[i]) & 0xFFFF; return t; }
  function crc16(b, s, e) {
    let crc = 0xFFFF;
    for (let i = s; i <= e && i < b.length; i++) {
      crc ^= b[i] << 8;
      for (let k = 0; k < 8; k++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc;
  }
  function scanChangeCount(item, bin, orig) {
    if (!item || !item.element || !bin || !orig) return 0;
    let n = 0;
    for (let r = 0; r < item.rows; r++) for (let c = 0; c < item.cols; c++) {
      if (readRawCell(item, r, c, bin) !== readRawCell(item, r, c, orig)) n++;
    }
    return n;
  }
 
  /* ---------- สแกนหาตารางจากไบต์ (ใช้เมื่อไม่มี XDF) + เขียน XDF ---------- */
  function scanWords(bin, le) {
    const n = Math.floor(bin.length / 2), v = new Array(n);
    for (let i = 0; i < n; i++) v[i] = le ? bin[2 * i] | (bin[2 * i + 1] << 8) : (bin[2 * i] << 8) | bin[2 * i + 1];
    return v;
  }
  function findAxisRuns(v) {
    const runs = [];
    let k = 0;
    while (k < v.length - 8) {
      if (v[k + 1] === v[k]) { k++; continue; }   // ข้ามช่วงค่าซ้ำ (เช่น 0 หรือ 0xFFFF)
      let e = k, up = 0;
      while (e + 1 < v.length && e - k < 80 && v[e + 1] >= v[e] && v[e + 1] - v[e] <= 4000) { if (v[e + 1] > v[e]) up++; e++; }
      let len = e - k + 1;
      if (len >= 8 && up >= (len - 1) * 0.8 && v[e] > v[k] && v[e] < 0xFFF0 && v[e] - v[k] >= 8) {
        let parts = [[k, e]];
        if (len > 34) {   // อาจเป็นสองแกนที่ต่อกัน (เช่น TPS ต่อด้วย RPM) → แยกกลาง/ตรงรอยต่อที่กระโดดสุด
          let cut = k + Math.floor(len / 2) - 1;
          if (len % 2 !== 0) { let bj = -1, bi = k; for (let i = k + 6; i < e - 6; i++) if (v[i + 1] - v[i] > bj) { bj = v[i + 1] - v[i]; bi = i; } cut = bi; }
          parts = [[k, cut], [cut + 1, e]];
        }
        parts.forEach((p) => runs.push({ w: p[0], n: p[1] - p[0] + 1, vals: v.slice(p[0], p[1] + 1) }));
        k = e + 1;
      } else k++;
    }
    return runs;
  }
  function blockSmooth(v, w, rows, cols) {
    let mn = Infinity, mx = -Infinity, sum = 0, cnt = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = v[w + r * cols + c];
      if (x === undefined) return 1;
      if (x < mn) mn = x; if (x > mx) mx = x;
      if (c > 0) { sum += Math.abs(x - v[w + r * cols + c - 1]); cnt++; }
    }
    if (mx === mn || mx > 0xFFF0) return 1;
    return (sum / (cnt || 1)) / (mx - mn + 1);
  }
  function makeScanItem(title, w, rows, cols, le, xs, ys, xAddr, yAddr) {
    const element = { sizeBits: 16, signed: false, littleEndian: le, float: false };
    const ax = (addr) => ({ element, address: addr, decimals: 0, outputType: 1, units: '', math: { fn: (x) => x, source: 'X', error: null } });
    return {
      id: 'scan:' + w, uniqueId: '', kind: 'table', title, description: '', categories: ['สแกนอัตโนมัติ'], issues: [], supported: true,
      tableFlags: 0, element, sizeBits: 16, rawAddress: w * 2, address: w * 2,
      math: { fn: (x) => x, source: 'X', error: null }, units: '', decimals: 0, outputType: 1,
      fileRows: rows, fileCols: cols, transposed: false, rows, cols,
      withinRowStrideBits: 16, tailStrideBits: 16, rowPitchBits: cols * 16, effectiveRows: rows,
      axes: { x: ax(xAddr), y: ax(yAddr), z: ax(w * 2) },
      x: xs, y: ys, axisAddrX: xAddr, axisAddrY: yAddr, scanned: true,
    };
  }
  function scanEndian(bin, le) {
    const v = scanWords(bin, le), runs = findAxisRuns(v), items = [], claimed = [], usedAxes = new Set();
    const inClaimed = (w, n) => claimed.some((c) => w < c[1] && w + n > c[0]);
    for (let i = 0; i + 1 < runs.length && items.length < 60; i++) {
      const a = runs[i], b = runs[i + 1], endB = b.w + b.n;
      if (inClaimed(a.w, a.n) || inClaimed(b.w, b.n)) continue;
      if (b.w - (a.w + a.n) > 8) continue;
      let w = null;
      for (let g = 0; g <= 8; g++) if (blockSmooth(v, endB + g, b.n, a.n) < 0.1) { w = endB + g; break; }
      if (w == null) continue;
      let count = 0;
      const step = a.n * b.n;
      while (count < 12 && !inClaimed(w, step) && blockSmooth(v, w, b.n, a.n) < 0.1) {
        claimed.push([w, w + step]); count++;
        items.push(makeScanItem('Map ' + (items.length + 1) + ' @0x' + (w * 2).toString(16).toUpperCase() + ' (' + a.n + '×' + b.n + ')', w, b.n, a.n, le, a.vals.slice(), b.vals.slice(), a.w * 2, b.w * 2));
        let nw = null;
        for (let g = 0; g <= 8; g++) if (blockSmooth(v, w + step + g, b.n, a.n) < 0.1) { nw = w + step + g; break; }
        if (nw == null) break;
        w = nw;
      }
      if (count) { usedAxes.add(a.w); usedAxes.add(b.w); claimed.push([a.w, a.w + a.n], [b.w, b.w + b.n]); }
    }
    let extra = 0;
    runs.forEach((r) => {
      if (extra < 30 && !usedAxes.has(r.w) && !inClaimed(r.w, r.n)) {
        extra++;
        items.push(makeScanItem('Axis @0x' + (r.w * 2).toString(16).toUpperCase() + ' (' + r.n + ')', r.w, r.n, 1, le, [0], r.vals.map((_, k) => k), null, null));
      }
    });
    return items;
  }
  function autoScan(bin) {
    if (!bin || bin.length < 256) return [];
    const a = scanEndian(bin, true), b = scanEndian(bin, false);
    const score = (arr) => arr.filter((i) => i.cols > 1).length * 10 + arr.length;
    const best = score(b) > score(a) ? b : a;
    return best.sort((p, q) => p.address - q.address);
  }
 
  function xe(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function writeXdf(items, opts) {
    opts = opts || {};
    const tables = (items || []).filter((i) => i.kind === 'table' && i.element && i.address != null);
    const le = tables.length ? !!tables[0].element.littleEndian : true;
    const hex = (n) => '0x' + Math.max(0, Math.round(n)).toString(16).toUpperCase();
    const flagsOf = (e) => (e.signed ? 1 : 0) | (e.littleEndian ? 2 : 0) | (e.float ? 4 : 0);
    const axisXml = (id, count, addr, el, decimals) => '    <XDFAXIS id="' + id + '">\n' +
      '      <EMBEDDEDDATA' + (addr != null ? ' mmedaddress="' + hex(addr) + '"' : '') + ' mmedelementsizebits="' + el.sizeBits +
      '" mmedmajorstridebits="-1" mmedminorstridebits="0"' + (flagsOf(el) ? ' mmedtypeflags="' + hex(flagsOf(el)) + '"' : '') + ' />\n' +
      '      <indexcount>' + count + '</indexcount>\n      <decimalpl>' + decimals + '</decimalpl>\n      <outputtype>1</outputtype>\n' +
      '      <MATH equation="X"><VAR id="X" /></MATH>\n    </XDFAXIS>\n';
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<XDFFORMAT version="1.70">\n  <XDFHEADER>\n    <flags>0x1</flags>\n' +
      '    <deftitle>' + xe(opts.title || 'ECU TUNE') + '</deftitle>\n    <description>' + xe(opts.description || '') + '</description>\n' +
      '    <author>' + xe(opts.author || '') + '</author>\n    <BASEOFFSET offset="0" subtract="0" />\n' +
      '    <DEFAULTS datasizeinbits="16" sigdigits="2" outputtype="1" signed="0" lsbfirst="' + (le ? 1 : 0) + '" float="0" />\n' +
      '    <REGION type="0xFFFFFFFF" startaddress="0x0" size="' + hex(opts.binSize || 0) + '" regionflags="0x0" name="Binary" desc="Binary" />\n  </XDFHEADER>\n';
    tables.forEach((it, n) => {
      const eq = (it.math && it.math.source) || 'X';
      xml += '  <XDFTABLE uniqueid="' + hex(n + 1) + '" flags="0x0">\n    <title>' + xe(it.title) + '</title>\n';
      if (it.cols > 1) xml += axisXml('x', it.cols, it.axisAddrX != null ? it.axisAddrX : null, it.element, 0);
      if (it.rows > 1) xml += axisXml('y', it.rows, it.axisAddrY != null ? it.axisAddrY : null, it.element, 0);
      xml += '    <XDFAXIS id="z">\n      <EMBEDDEDDATA mmedaddress="' + hex(it.address) + '" mmedelementsizebits="' + it.element.sizeBits +
        '" mmedmajorstridebits="-1" mmedminorstridebits="0"' + (flagsOf(it.element) ? ' mmedtypeflags="' + hex(flagsOf(it.element)) + '"' : '') + ' />\n' +
        '      <units>' + xe(it.units || '') + '</units>\n      <decimalpl>' + (it.decimals == null ? 2 : it.decimals) + '</decimalpl>\n' +
        '      <outputtype>' + (it.outputType || 1) + '</outputtype>\n      <MATH equation="' + xe(eq) + '"><VAR id="X" /></MATH>\n    </XDFAXIS>\n' +
        '    <rowcount>' + it.rows + '</rowcount>\n    <colcount>' + it.cols + '</colcount>\n  </XDFTABLE>\n';
    });
    return xml + '</XDFFORMAT>\n';
  }
 
  global.Xdf = {
    parse: parseXdf,
    parseXdf: parseXdf,
    resolve,
    cellAddress,
    cellAddr: cellAddress,
    readCell,
    readRawCell,
    writeCell,
    setCell,
    displayToRaw,
    formatValue,
    renderTable,
    diffBytes,
    readRaw,
    sum8,
    sum16,
    crc16,
    scanChangeCount,
    autoScan,
    writeXdf,
    fmtHex: (n, pad) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(pad || 4, '0')
  };
})(window);
