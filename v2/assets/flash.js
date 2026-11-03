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
  function render() {
    bindOnce();
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
        this.buf = this.buf.slice(7 + len);
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
        w.write(frame(cmd, payload))
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

  async function connectReal() {
    if (!('serial' in navigator)) {
      App.toast('เบราว์เซอร์ไม่รองรับ Web Serial', 'bad');
      return;
    }
    if (App.serial.open) {
      try { await App.serial.disconnect(); } catch (e) { }
    }
    let port;
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' });
    } catch (e) {
      if (e && e.name === 'NotFoundError') return;
      App.toast('เปิดพอร์ตไม่ได้: ' + (e.message || e), 'bad');
      return;
    }
    if (link && link.close) { try { await link.close(); } catch (e) { } }
    link = new SerialLink(port);
    await link.start();
    mode = 'real';
    $id('flashMode').textContent = 'อุปกรณ์จริง';
    $id('btnConnect').textContent = 'เปลี่ยนสาย';
    setStep('connect', 'run', 'กำลังถามรหัสกล่อง…');
    try {
      const res = await link.cmd(0x01, null, 2000);
      const id = new TextDecoder().decode(res.payload);
      log('เชื่อมต่อแล้ว · ' + id, 'ok');
      setStep('connect', 'done', 'ต่อแล้ว · ' + id);
      App.toast('เชื่อมต่อกล่องแล้ว', 'good');
    } catch (e) {
      setStep('connect', 'fail', 'ตอบสนองผิดรูปแบบ');
      log('เชื่อมต่อแล้วแต่ไม่ตอบสนอง: ' + e.message, 'er');
      App.toast('กล่องไม่ตอบสนอง — ตรวจสาย/โปรโตคอล', 'bad');
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
    btn.addEventListener('pointerdown', e => { e.preventDefault(); start(); });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
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
    $id('btnConnect').onclick = connectReal;
    $id('btnSim').onclick = useDemo;
    $id('flashMode').style.cursor = 'pointer';
    $id('flashMode').onclick = protocolSheet;
    $id('ckDefRow').onclick = protocolSheet;
    const proto = $id('btnProto');
    if (proto) proto.onclick = protocolSheet;

    bindHold();

    App.on('binchange', () => { if (App.state.tab === 'flash') render(); else render(); });
    App.on('binload', render);
    App.on('xdfchange', render);
  }

  App.registerView('flash', { render });
  App.on('binchange', () => { if (!built) return; const t = $id('flashMod'); if (t) render(); });
})();
