/* ============================================================
   ECU TUNE — flash screen (Web Serial + demo ECU)
   frame: AA 55 | cmd | len hi | len lo | payload | CRC16 hi lo
   cmd 01 ping · 02 info · 03 erase · 04 write · 05 read · 06 commit · 07 reset
   ============================================================ */
(function () {
  'use strict';

  const BLOCK = 256;
  let link = null;
  let mode = 'demo';
  let running = false;
  let built = false;
  let holdTimer = 0, holdStart = 0;

  const stepNames = ['check', 'connect', 'erase', 'write', 'verify', 'reset'];
  const stepText = { check: 'sCheck', connect: 'sConnect', erase: 'sErase', write: 'sWrite', verify: 'sVerify', reset: 'sReset' };

  const $id = id => document.getElementById(id);

  /* ---------------- UI helpers ---------------- */
  function setStep(name, state, text) {
    const el = document.querySelector('.step[data-step="' + name + '"]');
    if (el) {
      el.classList.remove('run', 'done', 'fail');
      if (state) el.classList.add(state);
    }
    if (text != null) {
      const t = $id(stepText[name]);
      if (t) t.textContent = text;
    }
  }
  function resetSteps() {
    stepNames.forEach(n => setStep(n, '', n === 'check' ? 'รอตรวจสอบ' : n === 'connect' ? 'ยังไม่เชื่อมต่อ' : '—'));
    progress(0, 0);
  }
  function progress(pct, bytesDone) {
    const s = App.state;
    const total = s.bin ? s.bin.length : 0;
    const fill = $id('flashFill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    $id('flashPct') && ($id('flashPct').textContent = Math.round(pct) + '%');
    if ($id('flashBytes')) {
      $id('flashBytes').textContent = Math.round((bytesDone || 0) / 1024) + ' / ' + Math.round(total / 1024) + ' KB';
    }
  }
  function log(msg, cls) {
    const box = $id('flashLog');
    if (!box) return;
    box.innerHTML += (box.dataset.started ? '\n' : '');
    box.dataset.started = '1';
    const t = new Date();
    const stamp = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = stamp + '  ' + msg;
    box.appendChild(span);
    box.scrollTop = box.scrollHeight;
  }
  function clearLog() {
    const box = $id('flashLog');
    if (box) { box.innerHTML = ''; box.dataset.started = ''; }
  }

  /* ---------------- checksums ---------------- */
  function renderChecksums() {
    const s = App.state;
    const bin = s.bin, orig = s.orig;
    const ck = App.checksums(bin);
    const co = App.checksums(orig);
    const set = (id, a, b, pad) => {
      const el = $id(id);
      if (!el) return;
      if (!bin || a == null) { el.textContent = '—'; return; }
      const changed = b != null && a !== b;
      el.innerHTML = App.hex(a, pad) + (changed ? ' <span style="color:var(--amber)">(เดิม ' + App.hex(b, pad) + ')</span>' : '');
    };
    set('ckSum8', ck && ck.sum8, co && co.sum8, 2);
    set('ckSum16', ck && ck.sum16, co && co.sum16, 4);
    set('ckCrc', ck && ck.crc16, co && co.crc16, 4);

    const row = $id('ckDefRow');
    const out = $id('ckDef');
    if (!row || !out) return;
    const defs = (s.xdf && s.xdf.checksums) ? s.xdf.checksums.filter(c => c.valid) : [];
    if (!bin || !defs.length) { row.hidden = true; return; }
    row.hidden = false;
    out.textContent = defs.map(c => {
      const end = Math.min(c.end, bin.length - 1);
      const v = c.bits === 16 ? Xdf.sum16(bin, c.start, end) : Xdf.sum8(bin, c.start, end);
      return c.title + ': ' + App.hex(v, c.bits === 16 ? 4 : 2);
    }).join(' · ');
  }

  /* ---------------- preflight ---------------- */
  let autoTried = false;
  function autoFlashConnect() {
    if (autoTried || running || raw.running || mode === 'real') return;
    autoTried = true;
    connectReal('auto');
  }
  document.addEventListener('serial-plugged', () => { autoTried = false; if (App.state.tab === 'flash') setTimeout(autoFlashConnect, 400); });

  /* ให้หน้า Live Data ขอพอร์ตคืนจากหน้าอัดไฟ (พอร์ตใช้ได้ทีละหน้า) */
  App.releasePort = async function () {
    if (raw.running) { try { await rawStop(); } catch (e) { } }
    if (mode === 'real' && link) {
      try { await link.close(); } catch (e) { }
      link = new DemoLink(); mode = 'demo';
      const fm = $id('flashMode'); if (fm) fm.textContent = 'โหมดจำลอง';
      const bc = $id('btnConnect'); if (bc) bc.textContent = 'เชื่อมต่อสาย';
    }
    autoTried = false;
  };

  function render() {
    bindOnce();
    if (App.state.tab === 'flash') setTimeout(autoFlashConnect, 0);
    const s = App.state;
    const has = !!s.bin;
    const mod = App.changedBytes();

    $id('flashSrc').textContent = has ? 'READY' : 'ไม่มีไฟล์';
    $id('flashName').textContent = has ? s.binName : '—';
    $id('flashSize').textContent = has ? App.kb(s.bin.length) + ' (' + s.bin.length.toLocaleString('en-US') + ' ไบต์)' : '—';
    $id('flashMod').innerHTML = has ? (mod ? '<span style="color:var(--amber)">' + mod + ' ไบต์</span>' : '0 ไบต์ (เดิม)') : '—';
    $id('flashXdf').textContent = s.xdfName || (has ? 'ไม่มี (สแกน)' : '—');

    const chk = $id('flashCheck');
    if (!has) { chk.textContent = '—'; chk.className = 'v'; }
    else if (s.xdf && s.xdf.binSize && s.xdf.binSize !== s.bin.length) {
      chk.innerHTML = 'ขนาดไม่ตรง XDF (' + App.kb(s.xdf.binSize) + ')';
      chk.className = 'v bad';
    } else {
      chk.textContent = 'ผ่าน · ' + App.kb(s.bin.length);
      chk.className = 'v good';
    }

    $id('flashMode').textContent = running ? 'กำลังทำงาน' : (mode === 'demo' ? 'โหมดจำลอง' : 'อุปกรณ์จริง');
    $id('btnFlash').disabled = running || !has;
    $id('btnBackup').disabled = !has;
    $id('btnExport').disabled = !has;
    $id('btnConnect').disabled = running;
    $id('btnSim').disabled = running;

    renderChecksums();
  }

  /* ---------------- live link (Web Serial) ---------------- */
  const crc16 = (bytes) => {
    let crc = 0xFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let b = 0; b < 8; b++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
    }
    return crc & 0xFFFF;
  };

  function frame(cmd, payload) {
    const p = payload || new Uint8Array(0);
    const out = new Uint8Array(7 + p.length);
    out[0] = 0xAA; out[1] = 0x55; out[2] = cmd;
    out[3] = (p.length >> 8) & 0xFF; out[4] = p.length & 0xFF;
    out.set(p, 5);
    const c = crc16(out.subarray(2, 5 + p.length));
    out[5 + p.length] = (c >> 8) & 0xFF;
    out[6 + p.length] = c & 0xFF;
    return out;
  }

  class SerialLink {
    constructor(port) {
      this.port = port;
      this.reader = null;
      this.buf = new Uint8Array(0);
      this.waiter = null;
      this.open = false;
    }
    async start() {
      this.open = true;
      this.reader = this.port.readable.getReader();
      this.readLoop();
    }
    async readLoop() {
      try {
        while (this.open) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value && value.length) this.feed(value);
        }
      } catch (e) { /* closed */ }
    }
    feed(chunk) {
      this.rxTotal = (this.rxTotal || 0) + chunk.length;
      if (!this.rxHead || this.rxHead.length < 48) {
        this.rxHead = (this.rxHead || []).concat(Array.from(chunk.slice(0, 48 - (this.rxHead ? this.rxHead.length : 0))));
      }
      const nb = new Uint8Array(this.buf.length + chunk.length);
      nb.set(this.buf); nb.set(chunk, this.buf.length);
      this.buf = nb;
      for (;;) {
        let start = -1;
        for (let i = 0; i + 1 < this.buf.length; i++) {
          if (this.buf[i] === 0xAA && this.buf[i + 1] === 0x55) { start = i; break; }
        }
        if (start < 0) { this.buf = this.buf.slice(Math.max(0, this.buf.length - 1)); return; }
        if (start > 0) this.buf = this.buf.slice(start);
        if (this.buf.length < 5) return;
        const cmd = this.buf[2];
        const len = (this.buf[3] << 8) | this.buf[4];
        if (this.buf.length < 7 + len) return;
        const payload = this.buf.slice(5, 5 + len);
        const crc = (this.buf[5 + len] << 8) | this.buf[6 + len];
        const good = crc === crc16(this.buf.subarray(2, 5 + len));
        const whole = this.buf.slice(0, 7 + len);
        this.buf = this.buf.slice(7 + len);
        /* สาย K-line/อะแดปเตอร์หลายตัวสะท้อนไบต์ที่ส่งกลับมา — ถ้าเฟรมที่รับตรงกับที่เพิ่งส่งทุกไบต์ ถือว่าเป็นเสียงสะท้อน ไม่ใช่คำตอบจากกล่อง */
        if (this.lastTx && whole.length === this.lastTx.length && whole.every((b, i) => b === this.lastTx[i])) {
          this.echoes = (this.echoes || 0) + 1;
          continue;
        }
        if (good && this.waiter) {
          const w = this.waiter; this.waiter = null;
          w.resolve({ cmd, payload });
        }
      }
    }
    cmd(cmd, payload, timeout) {
      if (!this.port || !this.port.writable) return Promise.reject(new Error('พอร์ตไม่พร้อม'));
      return new Promise((resolve, reject) => {
        const to = setTimeout(() => {
          if (this.waiter) this.waiter = null;
          reject(new Error('กล่องไม่ตอบสนอง (timeout)'));
        }, timeout || 2500);
        this.waiter = {
          resolve: (f) => { clearTimeout(to); resolve(f); },
          reject: (e) => { clearTimeout(to); reject(e); }
        };
        const w = this.port.writable.getWriter();
        this.lastTx = frame(cmd, payload);
        w.write(this.lastTx)
          .catch(e => {
            if (this.waiter) this.waiter = null;
            clearTimeout(to);
            reject(e);
          })
          .finally(() => { try { w.releaseLock(); } catch (e) { } });
      });
    }
    async close() {
      this.open = false;
      try { if (this.reader) await this.reader.cancel(); } catch (e) { }
      try { this.reader && this.reader.releaseLock(); } catch (e) { }
      try { await this.port.close(); } catch (e) { }
      this.port = null;
    }
  }

  /* demo ECU that speaks the same commands */
  class DemoLink {
    constructor() {
      this.img = new Uint8Array(65536);
      this.open = true;
    }
    async cmd(cmd, payload) {
      // ไม่หน่วงเมื่อแท็บถูกซ่อน เพื่อไม่ให้การจำลองค้างตอนสลับแอป
      if (!document.hidden) await new Promise(r => setTimeout(r, 6 + Math.random() * 10));
      if (cmd === 0x01) return { cmd, payload: new TextEncoder().encode('ECU-FLASH/1') };
      if (cmd === 0x02) return { cmd, payload: new TextEncoder().encode('HONDA-PGM-FI;65536') };
      if (cmd === 0x03) {
        const n = ((payload[0] << 24) | (payload[1] << 16) | (payload[2] << 8) | payload[3]) >>> 0;
        if (n > this.img.length) throw new Error('ขนาดไฟล์ใหญ่กว่าความจุกล่อง');
        return { cmd, payload: new Uint8Array([0]) };
      }
      if (cmd === 0x04) {
        const addr = ((payload[0] << 24) | (payload[1] << 16) | (payload[2] << 8) | payload[3]) >>> 0;
        const data = payload.slice(4);
        if (addr + data.length > this.img.length) throw new Error('เขียนเกินขอบเขต');
        this.img.set(data, addr);
        return { cmd, payload: new Uint8Array([0]) };
      }
      if (cmd === 0x05) {
        const addr = ((payload[0] << 24) | (payload[1] << 16) | (payload[2] << 8) | payload[3]) >>> 0;
        const len = (payload[4] << 8) | payload[5];
        return { cmd, payload: this.img.slice(addr, addr + len) };
      }
      return { cmd, payload: new Uint8Array([0]) };
    }
    async close() { this.open = false; }
  }

  const u32 = n => new Uint8Array([(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]);

  function startConnectReal() { App.chooseTransport(kind => connectReal(kind)); }

  async function connectReal(kind) {
    let port;
    if (raw.running) await rawStop();
    try {
      if (kind === 'auto') {
        port = await App.serial.knownPort();
        if (!port) return;                                 /* ยังไม่เคยอนุญาตพอร์ต — รอให้กดเชื่อมต่อเอง */
      } else port = await App.serial.requestPort(kind);           /* ขอพอร์ตก่อน เพื่อให้ยังนับเป็นการกดปุ่ม */
      if (App.serial.open) { try { await App.serial.disconnect(); } catch (e) { } }
      if (kind !== 'ble') App.serial.lastPort = port;
      if (kind !== 'ble') await port.open({ baudRate: App.serial.baud(), dataBits: 8, stopBits: 1, parity: 'none' });
    } catch (e) {
      const msg = App.serial.friendly(e);
      if (msg && kind !== 'auto') App.toast('เปิดพอร์ตไม่ได้: ' + msg, 'bad');
      return;
    }
    if (link && link.close) { try { await link.close(); } catch (e) { } }
    link = new SerialLink(port);
    await link.start();
    mode = 'real';
    $id('flashMode').textContent = 'อุปกรณ์จริง';
    $id('btnConnect').textContent = 'เปลี่ยนสาย';
    setStep('connect', 'run', 'รอกล่องบูต…');
    /* บอร์ดส่วนใหญ่รีเซ็ตตอนเปิดพอร์ต — รอให้บูตก่อน แล้วลองถามซ้ำ */
    await new Promise(r => setTimeout(r, 1500));
    setStep('connect', 'run', 'กำลังถามรหัสกล่อง…');
    let okId = null, lastErr = null;
    for (let i = 1; i <= 3 && !okId; i++) {
      try {
        const res = await link.cmd(0x01, null, 1500);
        okId = new TextDecoder().decode(res.payload);
      } catch (e) { lastErr = e; log('ลองถามครั้งที่ ' + i + ' ไม่มีคำตอบ', 'dm'); }
    }
    if (okId !== null) {
      log('เชื่อมต่อแล้ว · ' + okId, 'ok');
      setStep('connect', 'done', 'ต่อแล้ว · ' + okId);
      App.toast('เชื่อมต่อกล่องแล้ว', 'good');
    } else {
      const n = link.rxTotal || 0;
      const hex = (link.rxHead || []).map(b => (b < 16 ? '0' : '') + b.toString(16)).join(' ');
      let txt = '';
      try { txt = new TextDecoder().decode(new Uint8Array(link.rxHead || [])).replace(/[^\x20-\x7e]/g, '.'); } catch (e) { }
      setStep('connect', 'fail', n ? ('รับ ' + n + ' ไบต์ hex: ' + hex.slice(0, 48)) : 'อุปกรณ์เงียบ ไม่ส่งอะไรกลับ');
      if (n) log('รับมา ' + n + ' ไบต์ แต่ไม่ใช่เฟรม AA 55: ' + hex, 'er');
      if (n && txt) log('ข้อความที่เห็น: ' + txt, 'er');
      if (link.echoes) log('อุปกรณ์แค่สะท้อนไบต์ที่ส่งกลับมา (' + link.echoes + ' เฟรม) — ไม่ใช่กล่องที่รองรับโปรโตคอลอัดไฟ จึงไม่ได้เขียนอะไรลง ECU', 'er');
      if (!n) log('ไม่ได้รับไบต์ใดเลย — ตรวจพอร์ตที่เลือก/บอดเรต 115200/เฟิร์มแวร์ฝั่งกล่อง', 'er');
      App.toast(link.echoes ? 'อุปกรณ์สะท้อนไบต์กลับ — ไม่ใช่กล่องอัดไฟ' : (n ? 'ไม่ใช่โปรโตคอลอัดไฟ' : 'อุปกรณ์เงียบ'), 'bad');
    }
    render();
  }

  function useDemo() {
    if (link && link.close) { try { link.close(); } catch (e) { } }
    link = new DemoLink();
    mode = 'demo';
    $id('flashMode').textContent = 'โหมดจำลอง';
    $id('btnConnect').textContent = 'เชื่อมต่อสาย';
    setStep('connect', 'done', 'จำลอง ECU 64 KB');
    log('เปิด ECU จำลอง · 64 KB', 'dm');
    App.toast('โหมดจำลองพร้อมอัด');
    render();
  }

  /* ---------------- flash sequence ---------------- */
  async function flash() {
    const s = App.state;
    if (!s.bin) { App.toast('ยังไม่มีไฟล์ .bin', 'bad'); return; }
    if (running) return;
    if (!link) useDemo();

    running = true;
    resetSteps();
    clearLog();
    render();
    const img = s.bin;
    const total = img.length;

    try {
      /* 1. check */
      setStep('check', 'run', 'ตรวจขนาดและไบต์…');
      log('ตรวจไฟล์ ' + s.binName + ' · ' + App.kb(total));
      if (total < 512) throw new Error('ไฟล์เล็กเกินไป');
      if (s.xdf && s.xdf.binSize && s.xdf.binSize !== total) {
        throw new Error('ขนาดไฟล์ไม่ตรงกับ XDF (' + App.kb(s.xdf.binSize) + ')');
      }
      const mod = App.changedBytes();
      if (!mod) log('ไม่มีการแก้ไข — เขียนไฟล์เดิมทับ', 'wn');
      progress(3, 0);
      setStep('check', 'done', 'ผ่าน · ' + App.kb(total) + (mod ? ' · แก้ ' + mod + ' ไบต์' : ''));

      /* 2. connect */
      setStep('connect', 'run', 'เตรียมการเชื่อมต่อ…');
      if (!link || !link.open) useDemo();
      let info = '';
      try {
        const r = await link.cmd(0x02, null, 2500);
        info = new TextDecoder().decode(r.payload);
        log('ข้อมูลกล่อง: ' + info, 'ok');
      } catch (e) {
        log('อ่านข้อมูลกล่องไม่ได้: ' + e.message, 'wn');
      }
      setStep('connect', 'done', info ? info : 'พร้อมส่งข้อมูล');
      progress(8, 0);

      /* 3. erase */
      setStep('erase', 'run', 'ส่งคำสั่งลบหน่วยความจำ…');
      await link.cmd(0x03, u32(total), 8000);
      log('ลบหน่วยความจำแล้ว (' + App.kb(total) + ')', 'ok');
      setStep('erase', 'done', 'ลบแล้ว');
      progress(12, 0);

      /* 4. write */
      setStep('write', 'run', 'เขียน 0 / ' + Math.ceil(total / BLOCK) + ' บล็อก');
      const blocks = Math.ceil(total / BLOCK);
      for (let i = 0; i < blocks; i++) {
        if (!running) throw new Error('ยกเลิกแล้ว');
        const addr = i * BLOCK;
        const data = img.slice(addr, Math.min(total, addr + BLOCK));
        const payload = new Uint8Array(4 + data.length);
        payload.set(u32(addr), 0);
        payload.set(data, 4);
        await link.cmd(0x04, payload, 6000);
        const pct = 12 + ((i + 1) / blocks) * 68;
        progress(pct, Math.min(total, addr + BLOCK));
        if (i % 16 === 0 || i === blocks - 1) {
          setStep('write', 'run', 'เขียน ' + (i + 1) + ' / ' + blocks + ' บล็อก');
        }
      }
      setStep('write', 'done', 'เขียนครบ ' + blocks + ' บล็อก');
      log('เขียนข้อมูลครบ ' + blocks + ' บล็อก', 'ok');

      /* 5. verify */
      setStep('verify', 'run', 'อ่านกลับเพื่อตรวจไบต์…');
      let bad = 0;
      for (let i = 0; i < blocks; i++) {
        const addr = i * BLOCK;
        const len = Math.min(BLOCK, total - addr);
        const req = new Uint8Array(6);
        req.set(u32(addr), 0);
        req[4] = (len >> 8) & 0xFF; req[5] = len & 0xFF;
        const res = await link.cmd(0x05, req, 4000);
        const back = res.payload;
        for (let k = 0; k < len; k++) {
          if (back[k] !== img[addr + k]) { bad++; }
        }
        progress(80 + ((i + 1) / blocks) * 16, total);
      }
      if (bad) throw new Error('ตรวจไบต์ไม่ตรง ' + bad + ' ตำแหน่ง');
      setStep('verify', 'done', 'ไบต์ตรงกันทั้งหมด');
      log('ตรวจสอบไบต์ผ่าน (0 ผิดพลาด)', 'ok');

      /* 6. reset */
      setStep('reset', 'run', 'ส่งคำสั่งรีเซ็ต…');
      await link.cmd(0x07, null, 2000);
      progress(100, total);
      setStep('reset', 'done', 'รีเซ็ตแล้ว · พร้อมสตาร์ท');
      log('อัดไฟสำเร็จ — ปิดสวิตช์กุญแจ 3 วินาทีแล้วสตาร์ท', 'ok');
      if (window.FlashCount) window.FlashCount.bump(s.binName);
      App.toast('อัดไฟสำเร็จ', 'good');
    } catch (e) {
      running = false;
      const cur = stepNames.find(n => document.querySelector('.step[data-step="' + n + '"]').classList.contains('run'));
      if (cur) setStep(cur, 'fail', 'ล้มเหลว: ' + (e.message || 'ไม่ทราบสาเหตุ'));
      log('ผิดพลาด: ' + (e.message || e), 'er');
      App.toast('อัดไฟไม่สำเร็จ — ดูบันทึก', 'bad');
      render();
      return;
    }
    running = false;
    render();
  }

  function confirmSheet() {
    const s = App.state;
    const mod = App.changedBytes();
    App.sheet(
      '<div class="sh-head"><b>ยืนยันการอัดไฟ</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub">' + App.esc(s.binName) + ' · ' + App.kb(s.bin.length) + ' · แก้ ' + mod + ' ไบต์' +
      (s.xdf ? ' · ' + App.esc(s.xdfName) : '') + '</div>' +
      '<div class="note red"><b>การอัดไฟจริง:</b> ตรวจว่าเลือกไฟล์ของรุ่น/ปีให้ถูก และต่อแบตเตอรี่สำรองไว้ ' +
      'ถ้าตัดไฟกลางทางกล่องอาจล็อก</div>' +
      '<label class="chk"><input type="checkbox" id="ckConfirm"> ฉันตรวจไฟล์และรุ่นกล่องแล้ว</label>' +
      '<label class="chk"><input type="checkbox" id="ckBatt"> ต่อแบตเตอรี่/ไฟเลี้ยงสำรองแล้ว</label>' +
      '<button class="btn danger wide" id="btnConfirmFlash" disabled>เริ่มอัดไฟ</button>'
    );
    const a = document.getElementById('ckConfirm');
    const b = document.getElementById('ckBatt');
    const go = document.getElementById('btnConfirmFlash');
    const sync = () => { go.disabled = !(a.checked && b.checked); };
    a.onchange = sync; b.onchange = sync;
    go.onclick = () => { App.closeSheet(); flash(); };
  }

  /* ---------------- K-line raw tool (ส่ง/รับไบต์เอง) ---------------- */
  const raw = { poll: false, last: null, lastOk: false, port: null, reader: null, running: false, baud: 10400, buf: [], timer: null, dtr: true, rts: false };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hexs = a => Array.from(a).map(b => (b < 16 ? '0' : '') + b.toString(16)).join(' ').toUpperCase();
  function rawLine(dir, bytes, extra) {
    const box = $id('rawLog');
    if (!box) return;
    const d = document.createElement('div');
    d.style.color = dir === 'TX' ? '#ffb347' : dir === 'RX' ? '#7ee787' : dir === 'DAT' ? '#6cb6ff' : '#9fb3c8';
    const t = new Date();
    const ms = String(t.getSeconds()).padStart(2, '0') + '.' + String(t.getMilliseconds()).padStart(3, '0');
    d.textContent = ms + '  ' + dir + (bytes ? '  ' + hexs(bytes) : '') + (extra ? '  ' + extra : '');
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }
  function rawFlush() {
    if (!raw.buf.length) return;
    const b = raw.buf; raw.buf = [];
    /* ตัดเสียงสะท้อนของคำสั่งที่เราส่ง (72 05 71 00 xx) ออก แล้วดูว่าเป็นคำตอบตาราง 71 ไหม: 02 LEN 71 00 ...data... CS */
    const off = (b.length >= 5 && b[0] === 0x72 && b[1] === 0x05) ? 5 : 0;
    const r = b.slice(off);
    if (r.length >= 6 && r[0] === 0x02 && r[1] === r.length && r[2] === 0x71) {
      const sum = r.reduce((a, x) => (a + x) & 0xFF, 0);
      raw.last = r.slice(4, r.length - 1);
      raw.lastOk = sum === 0;
      if (raw.poll) rawLine('DAT', raw.last, raw.lastOk ? '' : '(checksum ผิด)');
      else {
        rawLine('RX', b, '(' + b.length + ' ไบต์)');
        rawLine('DAT', raw.last, raw.lastOk ? '← ข้อมูลตาราง 71 (checksum ถูก)' : '← checksum ผิด');
      }
      return;
    }
    if (raw.poll) return;
    rawLine('RX', b, '(' + b.length + ' ไบต์)');
  }
  /* ตัวรับไบต์ของเครื่องมือนี้ — ใช้ตัวอ่านกลางของ App.serial ไม่ถือพอร์ตเอง จึงไม่ชนกับหน้าอื่น */
  function rawOnBytes(value) {
    if (!raw.running) return;
    for (const x of value) raw.buf.push(x);
    clearTimeout(raw.timer);
    raw.timer = setTimeout(rawFlush, 30);   /* รวมไบต์ที่มาติดกันเป็นบรรทัดเดียว */
  }
  async function rawStop() {
    raw.running = false; raw.poll = false;
    clearTimeout(raw.timer); rawFlush();
    raw.port = null;
    try { await App.serial.disconnect(); } catch (e) { }
    const st = $id('rawState'); if (st) st.textContent = 'ยังไม่ได้เชื่อมต่อ';
  }
  async function rawStart() {
    if (raw.running && App.serial.open && App.serial.curBaud === raw.baud) return true;
    autoTried = true;
    try {
      let port = App.serial.port || App.serial.lastPort || await App.serial.knownPort();
      if (!port) port = await App.serial.requestPort('usb');   /* ต้องมาจากการกดปุ่ม */
      if (link && mode === 'real') { try { await link.close(); } catch (e) { } link = new DemoLink(); mode = 'demo'; const fm = $id('flashMode'); if (fm) fm.textContent = 'โหมดจำลอง'; }
      await App.serial.openPort(port, raw.baud, 'usb', null);
      App.serial.onBytes = rawOnBytes;
      raw.port = App.serial.port; raw.running = true;
      try { await raw.port.setSignals({ dataTerminalReady: raw.dtr, requestToSend: raw.rts }); } catch (e) { }
      const st = $id('rawState'); if (st) st.textContent = 'เชื่อมต่อแล้ว · ' + raw.baud + ' baud';
      rawLine('SYS', null, 'เปิดพอร์ต ' + raw.baud + ' 8N1');
      return true;
    } catch (e) {
      rawLine('SYS', null, 'เปิดไม่ได้: ' + (e && e.message ? e.message : e));
      const msg = App.serial.friendly(e);
      if (msg) App.toast('เปิดพอร์ตไม่ได้: ' + msg, 'bad');
      return false;
    }
  }
  function csum(bytes, mode) {
    const s = bytes.reduce((a, b) => (a + b) & 0xFF, 0);
    if (mode === 'sum') return bytes.concat([s]);
    if (mode === 'twos') return bytes.concat([(0x100 - s) & 0xFF]);   /* ส่วนเติมเต็มสอง แบบที่ Honda ใช้ */
    return bytes;
  }
  async function rawTx(bytes, gap, quiet) {
    if (gap > 0) { for (const b of bytes) { await App.serial.writeBytes([b]); await sleep(gap); } }
    else await App.serial.writeBytes(bytes);
    if (!quiet) rawLine('TX', bytes);
  }
  async function rawSend() {
    const inp = $id('rawHex');
    const hex = (inp.value || '').replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
    if (!hex || hex.length % 2) { App.toast('ใส่ hex เป็นคู่ เช่น 81 11 F1 81', 'bad'); return; }
    let bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    bytes = csum(bytes, $id('rawSum').value);
    if (!(await rawStart())) return;
    await rawTx(bytes, parseInt($id('rawGap').value, 10) || 0);
  }
  /* ลองปลุก + อ่านรหัส (อ่านอย่างเดียว) แบบ Honda K-line: ต่ำ 70ms / สูง 120ms แล้วส่ง FE 04 72 8C, 72 05 00 F0 99 */
  async function rawHonda(kind) {
    if (!(await rawStart())) return;
    try {
      if (kind === 'id') {
        rawLine('SYS', null, 'ปลุกกล่อง: ต่ำ 70 ms → สูง 120 ms');
        await App.serial.port.setSignals({ break: true }); await sleep(70);
        await App.serial.port.setSignals({ break: false }); await sleep(120);
        await rawTx([0xFE, 0x04, 0x72, 0x8C], 0);
        await sleep(300);
        await rawTx(csum([0x72, 0x05, 0x00, 0xF0], 'twos'), 0);
      } else {
        await rawTx(csum([0x72, 0x05, 0x71, 0x17], 'twos'), 0);
      }
    } catch (e) { App.toast('ส่งไม่สำเร็จ: ' + e.message, 'bad'); }
  }
  async function rawPollToggle() {
    const btn = $id('rawPoll');
    if (raw.poll) { raw.poll = false; if (btn) btn.textContent = 'อ่านต่อเนื่อง'; return; }
    if (!(await rawStart())) return;
    raw.poll = true;
    if (btn) btn.textContent = 'หยุดอ่าน';
    rawLine('SYS', null, 'อ่านตาราง 17 ต่อเนื่อง (แสดงเฉพาะข้อมูล DAT)');
    const req = csum([0x72, 0x05, 0x71, 0x17], 'twos');
    while (raw.poll && raw.running) {
      try { await rawTx(req, 0, true); } catch (e) { break; }
      await sleep(250);
    }
    raw.poll = false;
    if ($id('rawPoll')) $id('rawPoll').textContent = 'อ่านต่อเนื่อง';
  }
  async function rawCopy() {
    const t = $id('rawLog').innerText;
    try { await navigator.clipboard.writeText(t); App.toast('คัดลอกบันทึกแล้ว', 'good'); }
    catch (e) { App.toast('คัดลอกไม่ได้ — ถ่ายภาพจอแทน', 'bad'); }
  }
  async function rawBreak() {
    if (!(await rawStart())) return;
    const ms = parseInt($id('rawBreakMs').value, 10) || 25;
    try {
      await App.serial.port.setSignals({ break: true });
      await sleep(ms);
      await App.serial.port.setSignals({ break: false });
      rawLine('SYS', null, 'BREAK (ลากสายต่ำ) ' + ms + ' ms');
    } catch (e) { App.toast('สายนี้ไม่รองรับ BREAK: ' + e.message, 'bad'); }
  }
  async function rawSignals() {
    raw.dtr = $id('rawDtr').checked; raw.rts = $id('rawRts').checked;
    if (!App.serial.port) return;
    try { await App.serial.port.setSignals({ dataTerminalReady: raw.dtr, requestToSend: raw.rts }); rawLine('SYS', null, 'DTR=' + (raw.dtr ? 1 : 0) + ' RTS=' + (raw.rts ? 1 : 0)); } catch (e) { }
  }
  function rawSheet() {
    const bauds = [10400, 9600, 4800, 38400, 57600, 115200];
    App.sheet(
      '<div class="sh-head"><b>เครื่องมือ K-line</b><button class="x" id="rawX">✕</button></div>' +
      '<div class="sh-sub" id="rawState">ยังไม่ได้เชื่อมต่อ</div>' +
      '<div class="lbl">บอดเรต</div><div class="row" style="flex-wrap:wrap;gap:6px" id="rawBauds">' +
      bauds.map(b => '<button class="btn sm" data-b="' + b + '">' + b + '</button>').join('') + '</div>' +
      '<div class="lbl">กระตุกสาย (BREAK) · ลองกับสายที่รองรับ</div>' +
      '<div class="row" style="gap:6px"><input id="rawBreakMs" type="number" value="25" style="width:80px"> ms ' +
      '<button class="btn sm" id="rawBrk">ส่ง BREAK</button></div>' +
      '<div class="lbl">ลองอ่านจากกล่อง Honda (อ่านอย่างเดียว)</div>' +
      '<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn sm" id="rawH1">ปลุก + อ่านรหัส</button>' +
      '<button class="btn sm" id="rawH2">อ่านตาราง 17 (ค่าสด)</button>' +
      '<button class="btn sm" id="rawPoll">อ่านต่อเนื่อง</button></div>' +
      '<div class="lbl">ส่งไบต์ (hex)</div>' +
      '<input id="rawHex" placeholder="เช่น 81 11 F1 81" style="width:100%;box-sizing:border-box">' +
      '<div class="row" style="gap:10px;margin-top:6px;flex-wrap:wrap;align-items:center">' +
      '<label>checksum <select id="rawSum"><option value="">ไม่ต่อ</option><option value="sum">ผลรวม 8 บิต</option><option value="twos">ส่วนเติมเต็มสอง (Honda)</option></select></label>' +
      '<label>เว้นระหว่างไบต์ <input id="rawGap" type="number" value="0" style="width:56px"> ms</label></div>' +
      '<div class="row" style="gap:6px;margin-top:6px"><button class="btn sm" id="rawSend">ส่ง</button>' +
      '<button class="btn sm" id="rawConn">เชื่อมต่อ/ฟัง</button><button class="btn sm" id="rawClr">ล้างจอ</button><button class="btn sm" id="rawCp">คัดลอก</button></div>' +
      '<div class="row" style="gap:12px;margin-top:6px"><label><input type="checkbox" id="rawDtr" checked> DTR</label>' +
      '<label><input type="checkbox" id="rawRts"> RTS</label></div>' +
      '<div class="lbl">ไบต์ที่ส่ง (ส้ม) / รับ (เขียว) — สาย K-line บางตัวสะท้อนไบต์ที่ส่งกลับมาด้วย</div>' +
      '<div id="rawLog" style="font:12px monospace;height:190px;overflow:auto;background:rgba(0,0,0,.35);padding:8px;border-radius:8px"></div>'
    );
    const paint = () => document.querySelectorAll('#rawBauds [data-b]').forEach(el => {
      const on = parseInt(el.dataset.b, 10) === raw.baud;
      el.style.outline = on ? '2px solid var(--red, #ff5a44)' : ''; el.style.fontWeight = on ? '700' : '';
    });
    document.querySelectorAll('#rawBauds [data-b]').forEach(el => {
      el.onclick = async () => {
        raw.baud = parseInt(el.dataset.b, 10); paint();
        if (raw.running) { await rawStart(); }
      };
    });
    paint();
    $id('rawX').onclick = async () => { await rawStop(); App.closeSheet(); autoTried = false; };
    $id('rawConn').onclick = rawStart;
    $id('rawH1').onclick = () => rawHonda('id');
    $id('rawH2').onclick = () => rawHonda('live');
    $id('rawCp').onclick = rawCopy;
    $id('rawPoll').onclick = rawPollToggle;
    $id('rawSend').onclick = rawSend;
    $id('rawBrk').onclick = rawBreak;
    $id('rawClr').onclick = () => { $id('rawLog').innerHTML = ''; };
    $id('rawDtr').onchange = rawSignals; $id('rawRts').onchange = rawSignals;
    if (raw.running) $id('rawState').textContent = 'เชื่อมต่อแล้ว · ' + raw.baud + ' baud';
  }

  function protocolSheet() {
    App.sheet(
      '<div class="sh-head"><b>โปรโตคอลอัดไฟ</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub">แอปส่งข้อมูลผ่าน Web Serial ที่ 115200 8N1 เป็นเฟรม:</div>' +
      '<div class="note blue mono" style="font-size:10px;line-height:1.9">AA 55 · CMD · LEN(16) · DATA · CRC16\n' +
      '01 ping   02 info   03 erase(size)\n' +
      '04 write(addr32 + data)   05 read(addr32 + len16)\n' +
      '06 commit   07 reset</div>' +
      '<div class="sh-sub" style="margin-top:9px">ใช้ได้กับอะแดปเตอร์/บอร์ดที่ทำเฟรมนี้ (หรือปรับโค้ด assets/flash.js ให้ตรงกับสายจูนของคุณ) ' +
      'กล่อง Honda PGM-FI ดิบ ๆ ต้องมี bootloader/โปรโตคอลของผู้ผลิตจึงจะแฟลชได้ — โหมดจำลองไว้ทดสอบขั้นตอนทั้งหมด</div>'
    );
  }

  /* ---------------- hold to flash ---------------- */
  function bindHold() {
    const btn = $id('btnFlash');
    const fill = $id('flashHold');
    const stop = () => {
      clearInterval(holdTimer);
      holdTimer = 0;
      if (fill) fill.style.width = '0%';
    };
    const start = () => {
      if (running || !App.state.bin) return;
      if (mode === 'real' && !link) {
        App.toast('ยังไม่ได้เชื่อมต่อสาย — ใช้โหมดจำลองก่อน', 'bad');
        return;
      }
      holdStart = Date.now();
      if (fill) fill.style.width = '0%';
      holdTimer = setInterval(() => {
        const p = Math.min(1, (Date.now() - holdStart) / 1200);
        if (fill) fill.style.width = (p * 100) + '%';
        if (p >= 1) {
          stop();
          if (mode === 'real') confirmSheet();
          else flash();
        }
      }, 30);
    };
    /* มือถือ: ต้องล็อกนิ้วไว้กับปุ่ม ไม่งั้นเบราว์เซอร์ยิง pointercancel/เมนูกดค้าง แล้วนับค้างไม่ถึง 1.2 วิ */
    btn.style.touchAction = 'none';
    btn.style.userSelect = 'none';
    btn.style.webkitUserSelect = 'none';
    btn.style.webkitTouchCallout = 'none';
    btn.addEventListener('contextmenu', e => e.preventDefault());
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (err) { }
      start();
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('lostpointercapture', stop);
  }

  /* ---------------- events ---------------- */
  function bindOnce() {
    if (built) return;
    built = true;

    $id('btnBackup').onclick = () => {
      const s = App.state;
      if (!s.orig) return;
      const base = (s.binName || 'ecu').replace(/\.[^.]+$/, '');
      App.download(base + '-backup.bin', s.orig);
      App.toast('สำรองไฟล์เดิมแล้ว', 'good');
      log('ดาวน์โหลดไฟล์สำรอง ' + base + '-backup.bin', 'ok');
    };
    $id('btnExport').onclick = () => {
      const s = App.state;
      if (!s.bin) return;
      const base = (s.binName || 'ecu').replace(/\.[^.]+$/, '');
      App.download(base + '-tuned.bin', s.bin);
      App.toast('บันทึกไฟล์ที่จูนแล้ว', 'good');
      log('บันทึก ' + base + '-tuned.bin', 'ok');
    };
    $id('btnFlashLoadBin').onclick = () => App.pick('bin');
    $id('btnFlashLoadXdf').onclick = () => App.pick('xdf');
    $id('btnConnect').onclick = startConnectReal;
    $id('btnSim').onclick = useDemo;
    $id('flashMode').style.cursor = 'pointer';
    $id('flashMode').onclick = protocolSheet;
    $id('ckDefRow').onclick = protocolSheet;
    const proto = $id('btnProto');
    if (proto) proto.onclick = protocolSheet;
    const rawBtn = $id('btnRaw');
    if (rawBtn) rawBtn.onclick = rawSheet;

    bindHold();

    App.on('binchange', () => { if (App.state.tab === 'flash') render(); else render(); });
    App.on('binload', render);
    App.on('xdfchange', render);
  }

  App.registerView('flash', { render });
  App.on('binchange', () => { if (!built) return; const t = $id('flashMod'); if (t) render(); });
})();
