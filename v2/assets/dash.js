/* ============================================================
   ECU TUNE — dashboard: tach, AFR, TPS, live trace, demo ride
   ============================================================ */
(function () {
  'use strict';

  const MAXR = 12000, REDLINE = 10500;
  const CX = 160, CY = 160, R = 126, START = 145, SWEEP = 250;

  const el = {};
  const tach = { needle: null, valuePath: null, shiftRing: null, lastRpm: -1 };

  const live = {
    rpm: 0, speed: 0, tps: 0, afr: 0, ect: 26, iat: 30,
    map: 34, inj: 0, ign: 0, batt: 12.5, gear: 1,
    demo: true, connected: false, source: 'demo'
  };

  const trip = { start: 0, maxRpm: 0, topSpeed: 0, afrSum: 0, afrN: 0, dist: 0 };
  const trace = { rpm: [], afr: [], tps: [], max: 400, t: 0 };
  let raf = 0, last = 0, demoT = 0, gearShiftAt = 0, shiftCutUntil = 0;

  const RATIO = [0, 3.05, 2.05, 1.5, 1.22, 1.02];

  /* ---------------- tachometer ---------------- */
  const pt = (r, a) => {
    const rad = a * Math.PI / 180;
    return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
  };
  const angOf = v => START + (Math.max(0, Math.min(MAXR, v)) / MAXR) * SWEEP;
  function arcPath(r, v1, v2) {
    const a1 = angOf(v1), a2 = angOf(v2);
    const p1 = pt(r, a1), p2 = pt(r, a2);
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
    return 'M' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2) +
      ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2);
  }

  function buildTach() {
    const svg = document.getElementById('tachSvg');
    if (!svg) return;
    let html = '';
    html += '<defs>' +
      '<radialGradient id="hubG" cx="50%" cy="40%"><stop offset="0%" stop-color="#1B2A38"/><stop offset="100%" stop-color="#0A1219"/></radialGradient>' +
      '<filter id="glow" x="-60%" y="-60%" width="220%" height="220%">' +
      '<feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>';

    /* track */
    html += '<path d="' + arcPath(R, 0, MAXR) + '" fill="none" stroke="#101C27" stroke-width="10" stroke-linecap="round"/>';
    html += '<path d="' + arcPath(R - 0.5, 0, MAXR) + '" fill="none" stroke="#1A2B39" stroke-width="1" opacity=".7"/>';
    /* red zone */
    html += '<path d="' + arcPath(R, REDLINE, MAXR) + '" fill="none" stroke="#FF5A45" stroke-width="10" stroke-linecap="round" opacity=".22"/>';

    /* ticks + labels */
    for (let v = 0; v <= MAXR; v += 250) {
      const major = v % 1000 === 0;
      if (!major && v % 500 !== 0) continue;
      const a = angOf(v);
      const p1 = pt(R - (major ? 16 : 10), a);
      const p2 = pt(R - 4, a);
      const red = v >= REDLINE;
      html += '<line x1="' + p1[0].toFixed(1) + '" y1="' + p1[1].toFixed(1) + '" x2="' + p2[0].toFixed(1) +
        '" y2="' + p2[1].toFixed(1) + '" stroke="' + (red ? '#FF5A45' : major ? '#4C5D6E' : '#26343F') +
        '" stroke-width="' + (major ? 1.8 : 1) + '" stroke-linecap="round"/>';
      if (major && v % 1000 === 0) {
        const pl = pt(R - 30, a);
        html += '<text x="' + pl[0].toFixed(1) + '" y="' + (pl[1] + 3.5).toFixed(1) +
          '" fill="' + (red ? '#FF7B69' : '#67788A') + '" font-family="JetBrains Mono,monospace" font-size="10.5" text-anchor="middle">' +
          (v / 1000) + '</text>';
      }
    }

    /* needle + hub */
    html += '<g id="tachNeedle" transform="rotate(' + angOf(0) + ' 160 160)">' +
      '<line x1="160" y1="160" x2="' + (CX + R - 26) + '" y2="160" stroke="#fff" stroke-width="2.4" stroke-linecap="round" filter="url(#glow)"/>' +
      '<line x1="160" y1="160" x2="' + (CX - 16) + '" y2="160" stroke="#8FA3B4" stroke-width="2" stroke-linecap="round" opacity=".6"/>' +
      '</g>';
    html += '<circle cx="160" cy="160" r="52" fill="#070C11" opacity=".55"/>';
    html += '<circle cx="160" cy="160" r="11" fill="url(#hubG)" stroke="#2C3E4E"/>';
    html += '<circle cx="160" cy="160" r="3.4" fill="#FF5A45"/>';
    html += '<path id="tachValue" fill="none" stroke="#35C7FF" stroke-width="10" stroke-linecap="round" opacity=".95" filter="url(#glow)"/>';
    html += '<circle id="tachRing" cx="160" cy="160" r="146" fill="none" stroke="#FF5A45" stroke-width="5" opacity="0"/>';
    svg.innerHTML = html;

    tach.needle = svg.querySelector('#tachNeedle');
    tach.valuePath = svg.querySelector('#tachValue');
    tach.shiftRing = svg.querySelector('#tachRing');
  }

  function tachColor(rpm) {
    if (rpm >= REDLINE) return '#FF5A45';
    if (rpm >= 9000) return '#FFB020';
    if (rpm >= 6000) return '#C8F53C';
    return '#35C7FF';
  }

  function drawTach() {
    const rpm = Math.max(0, Math.min(MAXR, live.rpm));
    const key = Math.round(rpm);
    if (key === tach.lastRpm) return;
    tach.lastRpm = key;
    if (tach.needle) tach.needle.setAttribute('transform', 'rotate(' + angOf(rpm).toFixed(2) + ' 160 160)');
    if (tach.valuePath) {
      const c = tachColor(rpm);
      tach.valuePath.setAttribute('d', arcPath(R, 0, Math.max(1, rpm)));
      tach.valuePath.setAttribute('stroke', c);
      const mid = document.querySelector('.rpmline b');
      if (mid) mid.style.textShadow = '0 0 26px ' + c + '55';
    }
    const shift = rpm >= REDLINE;
    if (tach.shiftRing) tach.shiftRing.setAttribute('opacity', shift ? '0.55' : '0');
    const pill = document.getElementById('shiftPill');
    if (pill) pill.classList.toggle('on', shift);
  }

  /* ---------------- demo ride ---------------- */
  function demoStep(dt) {
    demoT += dt;
    const t = demoT;
    let phase = (t % 34);
    let tpsTarget;
    if (phase < 4) tpsTarget = 0;                    /* idle */
    else if (phase < 12) tpsTarget = 88;             /* accelerate */
    else if (phase < 20) tpsTarget = 26;             /* cruise */
    else if (phase < 25) tpsTarget = 100;            /* full throttle */
    else if (phase < 31) tpsTarget = 8;              /* decel */
    else tpsTarget = 0;                              /* stop */
    tpsTarget += Math.sin(t * 1.7) * 3;
    live.tps += (Math.max(0, Math.min(100, tpsTarget)) - live.tps) * Math.min(1, dt * 2.2);

    if (live.gear <= 0) live.gear = 1;
    if (t >= gearShiftAt) {
      const rpmTarget = 1500 + live.tps * 105;
      if (live.rpm > 10300 && live.gear < 5) {
        live.gear++;
        gearShiftAt = t + 0.9;
        shiftCutUntil = t + 0.22;
      } else if (live.rpm < 3400 && live.tps < 20 && live.gear > 1) {
        live.gear--;
        gearShiftAt = t + 0.5;
      }
    }
    const target = t > shiftCutUntil
      ? 1200 + live.tps * 108 + (live.gear - 3) * 180
      : 8600;
    const k = live.tps > 60 ? 3.2 : 1.7;
    live.rpm += (Math.max(900, Math.min(MAXR - 60, target)) - live.rpm) * Math.min(1, dt * k);
    live.rpm += (Math.random() - 0.5) * 26;

    const wheel = live.rpm * 0.021 / RATIO[live.gear];
    if (live.tps < 3) live.speed += (0 - live.speed) * Math.min(1, dt * 1.4);
    else live.speed += (wheel - live.speed) * Math.min(1, dt * 1.1);

    const load = live.tps / 100;
    const afrTarget = 14.8 - Math.pow(load, 1.25) * 2.1 + (live.gear >= 4 ? 0.15 : 0);
    live.afr += (afrTarget + (Math.random() - 0.5) * 0.22 - live.afr) * Math.min(1, dt * 2.4);
    live.ect += (88 + load * 5 - live.ect) * Math.min(1, dt * 0.05);
    live.iat += (31 + load * 9 + Math.sin(t * 0.3) * 2 - live.iat) * Math.min(1, dt * 0.04);
    live.map = 34 + load * 62;
    live.inj = 1.9 + load * 8.4 + (live.rpm / MAXR) * 0.8;
    live.ign = 9 + load * 17 - (live.rpm > 8000 ? 3 : 0);
    live.batt = 13.85 + Math.sin(t * 0.7) * 0.06;
  }

  /* ---------------- serial input ---------------- */
  let serialOn = false;
  /* ---------------- K-line (Honda Wave/Cub) อ่านค่าสด ----------------
     ทำตามลำดับเดียวกับเฟิร์มแวร์สมาร์ทเกจ (smart_gaugebin.ino):
       1) ปลุก: ลากสายต่ำ 70ms → สูง 130ms แล้วส่ง FE 04 72 8C (ไม่ตอบ → 2C 54 4E 23)
       2) วนอ่านตาราง 17 (72 05 71 17 01) และตาราง 20 (72 05 71 20 F8) ทีละคำสั่ง
          รอเฟรมตอบได้ทันทีที่มาถึง (ไม่ใช้เวลารอตายตัว) เว้น 20ms ระหว่างคำสั่ง
       3) ล้มเหลวติดกัน 5 รอบ → ปลุกใหม่ (ห่างกันอย่างน้อย 2.5 วินาที)
     ตำแหน่งไบต์นับจากไบต์แรกของเฟรมตอบ (02 LEN 71 TT ...) */
  const KREQ17 = [0x72, 0x05, 0x71, 0x17, 0x01];
  const KREQ20 = [0x72, 0x05, 0x71, 0x20, 0xF8];
  const KWAKE = [[0xFE, 0x04, 0x72, 0x8C], [0x2C, 0x54, 0x4E, 0x23], [0x2C, 0x41, 0x4E, 0x23]];
  let kbuf = [], kpoll = false, kgot = 0, klast17 = null, klast20 = null, kbytes = 0, ktail = [], ksent = 0, kwakes = 0, kwait = null, kbreak = '', kstop = '', kpause = false, ksvc = null, ksvcBusy = false;
  function klineReset() { Object.assign(live, { rpm: 0, speed: 0, tps: 0, afr: 0, ect: 0, iat: 0, map: 0, inj: 0, ign: 0, batt: 0 }); }
  const hex2 = a => Array.from(a).map(b => (b < 16 ? '0' : '') + b.toString(16)).join(' ').toUpperCase();
  const ksleep = ms => new Promise(r => setTimeout(r, ms));

  function klineFeed(bytes) {
    kbytes += bytes.length;
    ktail = ktail.concat(Array.from(bytes)).slice(-24);
    if (ksvc) { for (const x of bytes) ksvc.buf.push(x); ksvcCheck(); return; }   /* กำลังรอคำตอบของคำสั่งบริการ (DTC) */
    for (const x of bytes) kbuf.push(x);
    if (kbuf.length > 200) kbuf = kbuf.slice(-100);
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i + 4 <= kbuf.length; i++) {
        if (kbuf[i] !== 0x02 || kbuf[i + 2] !== 0x71) continue;
        const tbl = kbuf[i + 3], len = kbuf[i + 1];
        if (tbl !== 0x17 && tbl !== 0x20) continue;
        if (len < 6 || len > 60) continue;
        if (i + len > kbuf.length) return;                       /* ยังมาไม่ครบ */
        const fr = kbuf.slice(i, i + len);
        if (fr.reduce((a, b) => (a + b) & 0xFF, 0) !== 0) continue;  /* checksum ผิด */
        kbuf = kbuf.slice(i + len);
        klineApply(tbl, fr);
        progress = true;
        break;
      }
    }
  }

  function klineApply(tbl, f) {
    kgot++;
    live.demo = false; live.connected = true; live.source = 'serial';
    const u8 = i => (i < f.length ? f[i] : 0);
    if (tbl === 0x17) {
      klast17 = f;
      live.rpm = (u8(4) << 8) | u8(5);
      live.tps = Math.max(0, Math.min(100, u8(7) * 0.5));
      live.iat = u8(9) - 40;                         /* ตำแหน่ง 0x09 (สมมติเป็นอากาศเข้า — เฟิร์มแวร์รุ่น blue ใช้เป็นอุณหภูมิ) */
      live.ect = (u8(0x0B) === 0xFF || u8(0x0B) <= 40) ? 0 : u8(0x0B) - 40;   /* ตำแหน่ง 0x0B ยังไม่ยืนยัน: ECU ตัวที่ทดสอบส่ง FF (ไม่ใช้) → แสดง -- */
      live.batt = u8(0x0E) / 10;
      live.inj = (((u8(0x0F) << 8) | u8(0x10)) / 250);
      live.ign = u8(0x11) / 2 - 64;
    } else {
      klast20 = f;
      const afr = 10 + (u8(4) / 255) * 8;
      live.afr = (afr < 5 || afr > 25) ? 0 : afr;
    }
    setConn('serial');
    klineStatus();
    if (kgot === 1) App.toast('ต่อ ECU สำเร็จ · กำลังอ่านค่าสด', 'good');
    if (kwait && kwait.tbl === tbl) { const w = kwait; kwait = null; w.resolve(true); }
  }

  function klineStatus() {
    const el = document.getElementById('klineRaw');
    if (!el) return;
    el.style.display = '';
    let h = (kgot ? '<b>ECU ตอบแล้ว</b>' : '<b>ยังไม่มีเฟรมตอบ</b>') + ' · ส่ง ' + ksent + ' ครั้ง · เฟรมที่ถอดได้ ' + kgot +
      ' · รับ ' + kbytes + ' ไบต์ · ปลุก ' + kwakes + ' ครั้ง' + (kbreak ? ' (' + kbreak + ')' : '');
    if (!kgot && ktail.length) h += '<br>ไบต์ล่าสุด: <span style="font-family:monospace">' + hex2(ktail) + '</span>';
    if (klast17) h += '<br>T17: <span style="font-family:monospace">' + hex2(klast17) + '</span>';
    if (klast20) h += '<br>T20: <span style="font-family:monospace">' + hex2(klast20) + '</span>';
    const dg = App.serial.dbg || {};
    h += '<br><span style="font-family:monospace;opacity:.8">build r7 · open=' + App.serial.open + ' · loop#' + (dg.n || 0) +
      ' chunks=' + (dg.chunks || 0) + ' errs=[' + (dg.errs || []).join(',') + ']' + (dg.end ? ' end=' + dg.end : '') + (kstop ? ' · ' + kstop : '') + '</span>';
    el.innerHTML = h;
  }

  /* ส่ง 1 คำสั่งแล้วรอเฟรมตอบของตารางนั้น (หรือหมดเวลา) — แต่ละรอบมีตัวรอและตัวจับเวลาของตัวเอง ไม่ปนกัน */
  function ktxn(req, tbl, timeoutMs) {
    return new Promise(res => {
      kbuf = [];
      ksent++;
      const me = { tbl: tbl, t: 0, resolve: null };
      me.resolve = v => { clearTimeout(me.t); res(v); };
      kwait = me;
      me.t = setTimeout(() => { if (kwait === me) kwait = null; res(false); }, timeoutMs);
      App.serial.writeBytes(req).catch(() => { if (kwait === me) kwait = null; me.resolve(false); });
    });
  }

  async function klineWake() {
    const port = App.serial.port;
    if (!port) return;
    kwakes++;
    try {
      await port.setSignals({ break: true }); await ksleep(70);
      await port.setSignals({ break: false }); await ksleep(130);
      kbreak = 'BREAK ok';
    } catch (e) { kbreak = 'สายไม่รองรับ BREAK'; }
    kbuf = [];
    for (const w of KWAKE) {
      const before = kbytes;
      try { await App.serial.writeBytes(w); } catch (e) { return; }
      await ksleep(220);
      if (kbytes !== before) break;          /* มีไบต์กลับมา (รวมเสียงสะท้อน) = ถือว่าปลุกสำเร็จ เหมือนเฟิร์มแวร์ */
    }
    /* init (ทดสอบแล้วบน ECU จริง: ตอบ 02 04 00 FA) — ส่งก่อนเริ่มขอตาราง */
    try { await App.serial.writeBytes([0x72, 0x05, 0x00, 0xF0, 0x99]); } catch (e) { return; }
    await ksleep(150);
    kbuf = [];
    klineStatus();
  }

  async function klinePoll() {
    if (kpoll) return;
    kpoll = true; kstop = ''; kgot = 0; kbuf = []; klast17 = klast20 = null; kbytes = 0; ktail = []; ksent = 0; kwakes = 0; kbreak = '';
    klineReset();
    App.serial.onBytes = klineFeed;
    const alive = () => App.serial.open && App.serial.onBytes === klineFeed;
    let fails = 0, lastWake = Date.now(), lastUi = 0;
    klineStatus();
    await klineWake();
    while (alive()) {
      if (kpause) { await ksleep(40); continue; }            /* หยุดพักระหว่างทำคำสั่งบริการ */
      const ok17 = await ktxn(KREQ17, 0x17, 150); if (!alive()) break;
      await ksleep(20);
      const ok20 = await ktxn(KREQ20, 0x20, 150); if (!alive()) break;
      await ksleep(20);
      fails = (ok17 || ok20) ? 0 : fails + 1;
      if (fails >= 5) {                                   /* ไม่ตอบติดกัน 5 รอบ → ปลุกใหม่ */
        klineReset();
        const wait = 2500 - (Date.now() - lastWake);
        if (wait > 0) await ksleep(wait);
        if (!alive()) break;
        lastWake = Date.now(); fails = 0;
        await klineWake();
      }
      if (Date.now() - lastUi > 500) { lastUi = Date.now(); klineStatus(); }
    }
    kstop = 'poll หยุด: open=' + App.serial.open + ' onBytes=' + (App.serial.onBytes === klineFeed ? 'ok' : 'ไม่ตรง');
    klineStatus();
    kpoll = false;
  }

  /* ---------------- คำสั่งบริการ: อ่าน/ล้าง DTC ----------------
     คำสั่งและรูปแบบตอบ แกะจากเฟิร์มแวร์ smart_gauge_blue.ino:
       อ่าน DTC  72 05 74 01 14 → ตอบ 02 LEN 74 xx [โค้ด…] CS   (โค้ดแต่ละไบต์ ยกเว้น 00 และ FF)
       ล้าง DTC  72 05 60 01 28 → ตอบ 02 LEN 60 …
     ทำงานบนการเชื่อมต่อ K-line ของหน้าข้อมูลสด (พักการอ่านค่าสดชั่วคราวระหว่างส่งคำสั่ง) */
  const KDTC_READ = [0x72, 0x05, 0x74, 0x01, 0x14];
  const KDTC_CLEAR = [0x72, 0x05, 0x60, 0x01, 0x28];
  const DTC_NAMES = { 1: 'MAP Sensor', 8: 'Throttle Pos', 9: 'IAT Sensor', 11: 'ABS / Speed', 12: 'Injector', 14: 'IACV Valve',
    15: 'ECT Sensor', 18: 'CKP Sensor', 19: 'CMP Sensor', 21: 'O2 Sensor', 24: 'Ignition Coil', 29: 'IACV Error', 32: 'Injector Err',
    33: 'Battery Volt', 35: 'EGR System', 44: 'EVAP Valve', 52: 'CKP Fault', 54: 'Bank Fault', 63: 'Mode Switch', 72: 'Exhaust Valve',
    87: 'Fuel Pump', 90: 'Smart Key', 91: 'Security' };

  function ksvcCheck() {
    const b = ksvc.buf;
    for (let i = 0; i + 4 <= b.length; i++) {
      if (b[i] !== 0x02 || b[i + 2] !== ksvc.svc) continue;
      const len = b[i + 1];
      if (len < 4 || len > 40) continue;
      if (i + len > b.length) return;                         /* ยังมาไม่ครบ */
      const fr = b.slice(i, i + len);
      if (fr.reduce((a, x) => (a + x) & 0xFF, 0) !== 0) continue;   /* checksum ผิด */
      const s = ksvc; ksvc = null; s.resolve(fr); return;
    }
  }
  async function ksvcTxn(req, svc, timeoutMs, tries) {
    for (let a = 0; a < tries; a++) {
      const r = await new Promise(res => {
        const me = { svc: svc, buf: [], t: 0, resolve: null };
        me.resolve = v => { clearTimeout(me.t); res(v); };
        ksvc = me;
        me.t = setTimeout(() => { if (ksvc === me) ksvc = null; res(null); }, timeoutMs);
        App.serial.writeBytes(req).catch(() => { if (ksvc === me) ksvc = null; me.resolve(null); });
      });
      if (r) return r;
      await ksleep(40);
    }
    return null;
  }
  async function ksvcRun(fn) {
    if (ksvcBusy) return;
    if (!App.serial.open || !kgot) {
      App.toast('ยังไม่ได้ต่อ ECU — ไปหน้าข้อมูลสดแล้วเชื่อมต่อให้ขึ้น “ECU ตอบแล้ว” ก่อน', 'bad');
      return;
    }
    ksvcBusy = true; kpause = true;
    try { await ksleep(400); return await fn(); }
    finally { ksvc = null; kpause = false; ksvcBusy = false; }
  }

  function showDtc(codes, fr) {
    const st = document.getElementById('dtcStatus'), ct = document.getElementById('dtcCountText');
    const list = codes.map(c => c + ' ' + (DTC_NAMES[c] || '')).join(' · ');
    if (st) st.textContent = codes.length ? ('พบ ' + codes.length + ' โค้ด: ' + list) : 'ปกติ (0 Code)';
    if (ct) ct.textContent = codes.length ? ('พบ ' + codes.length + ' โค้ด') : 'ไม่พบโค้ดค้าง';
    let raw = document.getElementById('dtcRaw');
    if (!raw && st && st.parentNode && st.parentNode.parentNode) {
      raw = document.createElement('div');
      raw.id = 'dtcRaw';
      raw.style.cssText = 'font:10px monospace;color:var(--dim);margin-top:6px;word-break:break-all';
      st.parentNode.parentNode.insertBefore(raw, st.parentNode.nextSibling);
    }
    if (raw && fr) raw.textContent = 'เฟรมตอบจาก ECU: ' + hex2(fr);
  }
  async function dtcRead(quiet) {
    const fr = await ksvcTxn(KDTC_READ, 0x74, 1000, 2);
    if (!fr) { if (!quiet) App.toast('อ่าน DTC ไม่สำเร็จ — ECU ไม่ตอบ (เปิดกุญแจ ON แต่ยังไม่ต้องสตาร์ท)', 'bad'); return null; }
    const codes = [];
    for (const b of fr.slice(4, fr.length - 1)) if (b !== 0x00 && b !== 0xFF && codes.length < 8) codes.push(b);
    showDtc(codes, fr);
    return codes;
  }
  function dtcClearSheet() {
    App.sheet(
      '<div class="sh-head"><b>ล้างโค้ดข้อผิดพลาด</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="note red">ส่งคำสั่งล้าง DTC เข้า ECU ตัวจริง — ควรเปิดกุญแจ ON โดยไม่สตาร์ทเครื่อง ' +
      'ถ้าอาการเสียยังอยู่ โค้ดจะกลับมาเอง</div>' +
      '<div class="row" style="margin-top:12px">' +
      '<button class="btn" id="dcCancel">ยกเลิก</button>' +
      '<button class="btn danger" id="dcOk">ล้างโค้ด</button></div>');
    document.getElementById('dcCancel').onclick = () => App.closeSheet();
    document.getElementById('dcOk').onclick = () => {
      App.closeSheet();
      ksvcRun(async () => {
        const fr = await ksvcTxn(KDTC_CLEAR, 0x60, 500, 6);
        if (!fr) { App.toast('ล้างโค้ดไม่สำเร็จ — ECU ไม่ตอบ', 'bad'); return; }
        await ksleep(100);
        await dtcRead(true);
        App.toast('ส่งคำสั่งล้างโค้ดแล้ว · ECU ตอบรับ', 'good');
      });
    };
  }
  function bindService() {
    const g = id => document.getElementById(id);
    if (g('btnReadDtc')) g('btnReadDtc').onclick = () => ksvcRun(async () => { const c = await dtcRead(false); if (c) App.toast(c.length ? 'พบ ' + c.length + ' โค้ด' : 'ไม่พบโค้ดค้าง', c.length ? 'bad' : 'good'); });
    if (g('btnClearDtc')) g('btnClearDtc').onclick = dtcClearSheet;

    /* ---------------- จำนวนครั้งการอัดไฟล์ (Flash Counter) ---------------- */
    const fc = window.FlashCount || App.flashCount;
    function countText() {
      if (!fc) return 'ยังไม่มีตัวนับ';
      const c = fc.read();
      return 'อัดสำเร็จในแอป ' + c.count + '/255 ครั้ง' + (c.last ? ' · ล่าสุด ' + fc.human() : ' · ยังไม่เคยอัด');
    }
    if (fc) fc.render();

    if (g('btnReadFlashCount')) g('btnReadFlashCount').onclick = () => {
      if (fc) fc.render();
      App.toast('อ่านจำนวนอัดแล้ว — ' + countText(), 'good');
    };

    if (g('btnResetFlashCount')) g('btnResetFlashCount').onclick = () => {
      if (!fc) { App.toast('ยังไม่มีตัวนับจำนวนอัด', 'bad'); return; }
      App.sheet(
        '<div class="sh-head"><b>ลบจำนวนการอัด</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
        '<div class="note red">ตั้งตัวนับจำนวนการอัดในแอปกลับเป็น 0 — ไม่แตะข้อมูลหรือตัวนับในกล่อง ECU</div>' +
        '<div class="kv"><span class="k">ตอนนี้</span><span class="v">' + countText() + '</span></div>' +
        '<div class="row" style="margin-top:12px"><button class="btn" id="fcCancel">ยกเลิก</button>' +
        '<button class="btn danger" id="fcOk">ลบจำนวนอัด</button></div>');
      document.getElementById('fcCancel').onclick = () => App.closeSheet();
      document.getElementById('fcOk').onclick = () => {
        App.closeSheet();
        fc.reset();
        fc.render();
        App.toast('ลบจำนวนการอัดแล้ว — 0/255 ครั้ง', 'good');
      };
    };

    /* ---------------- รีเซ็ตกล่อง ECU (KWP2000 ECUReset 11 01) ---------------- */
    if (g('btnResetEcu')) g('btnResetEcu').onclick = () => {
      App.sheet(
        '<div class="sh-head"><b>รีเซ็ตกล่อง ECU</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
        '<div class="note red">ส่งคำสั่ง ECU Reset เข้ากล่องจริง (KWP2000 service 11 / hardReset 01) — เปิดกุญแจ ON แต่ยังไม่ต้องสตาร์ท<br>' +
        'กล่องจะล้างการเรียนรู้ลิ้นผีเสื้อ ถ้ากล่องรุ่นนั้นไม่รับคำสั่งนี้ จะไม่มีการเขียนข้อมูลใด ๆ ลงกล่อง</div>' +
        '<div class="row" style="margin-top:12px"><button class="btn" id="reCancel">ยกเลิก</button>' +
        '<button class="btn danger" id="reOk">รีเซ็ตกล่อง</button></div>');
      document.getElementById('reCancel').onclick = () => App.closeSheet();
      document.getElementById('reOk').onclick = () => {
        App.closeSheet();
        ksvcRun(async () => {
          const req = [0x72, 0x05, 0x11, 0x01, 0x77];   /* 72 05 11 01 + checksum (ผลรวมไบต์ = 0) */
          const fr = await ksvcTxn(req, 0x11, 1200, 2);
          if (fr) App.toast('ส่งคำสั่งรีเซ็ตกล่องแล้ว · ECU ตอบรับ', 'good');
          else App.toast('รีเซ็ตไม่สำเร็จ — ECU ไม่ตอบคำสั่งนี้ (กล่องรุ่นนี้อาจใช้โปรแกรมจูนของตัวเอง)', 'bad');
        });
      };
    };
  }

  document.addEventListener('DOMContentLoaded', bindService);

  /* เลือกโหมดตามบอดเรต: 10400 = K-line ECU, อย่างอื่น = อุปกรณ์ส่งข้อความ rpm=...,tps=... */
  function afterOpen() {
    const baud = App.serial.baud();
    const el = document.getElementById('klineRaw');
    if (baud === 10400) {
      if (el) { el.style.display = ''; el.textContent = 'ต่อพอร์ตแล้ว · 10400 baud · โหมด K-line (Honda) — กำลังรอ ECU ตอบ…'; }
      klinePoll();
    } else {
      App.serial.onBytes = null;
      if (el) {
        el.style.display = '';
        el.innerHTML = 'ต่อพอร์ตแล้ว · <b>' + baud + ' baud</b> · โหมดอุปกรณ์ส่งข้อความ (rpm=..,tps=..) — ' +
          'ถ้าต่อกับ ECU ผ่านสาย K-line ให้ใช้โหมด K-line ' +
          '<button class="btn sm" id="klineSwitch" style="margin-left:6px">สลับเป็น K-line 10400</button>';
        const sw = document.getElementById('klineSwitch');
        if (sw) sw.onclick = async () => {
          App.serial.setBaud(10400);
          const p = App.serial.port;
          await App.serial.disconnect();
          if (p) { try { await App.serial.openPort(p, 10400, 'usb', parseSerialLine); live.demo = false; live.source = 'serial'; bindSerialClose(); afterOpen(); } catch (e) { App.toast('เปิดพอร์ตไม่ได้: ' + (App.serial.friendly(e) || ''), 'bad'); } }
        };
      }
    }
  }

  function parseSerialLine(line) {
    let used = 0;
    line.split(/[,\s]+/).forEach(part => {
      const m = part.match(/^([a-zA-Z_]+)\s*[=:]\s*(-?\d+(?:\.\d+)?)$/);
      if (!m) return;
      const v = parseFloat(m[2]);
      const key = m[1].toLowerCase();
      const map = {
        rpm: 'rpm', spd: 'speed', speed: 'speed', tps: 'tps', afr: 'afr', afr1: 'afr',
        ect: 'ect', clt: 'ect', iat: 'iat', mat: 'iat', map: 'map', map1: 'map',
        inj: 'inj', pw: 'inj', ign: 'ign', adv: 'ign', batt: 'batt', volt: 'batt', v: 'batt',
        gear: 'gear'
      };
      if (map[key]) { live[map[key]] = v; used++; }
    });
    if (used) {
      live.demo = false;
      live.connected = true;
      live.source = 'serial';
      setConn('serial');
    }
  }

  function setConn(kind) {
    const chip = document.getElementById('connChip');
    const txt = document.getElementById('connText');
    if (!chip || !txt) return;
    chip.classList.remove('dim', 'amber', 'red');
    if (kind === 'serial') { chip.className = 'pill'; txt.textContent = 'ต่อสายแล้ว'; }
    else if (kind === 'demo') { chip.className = 'pill dim'; txt.textContent = 'เดโม · แตะเพื่อต่อ'; }
    else { chip.className = 'pill amber'; txt.textContent = 'หยุดชั่วคราว'; }
    const st = document.getElementById('statusPill');
    if (st) {
      st.className = 'pill ' + (kind === 'serial' ? '' : 'dim');
      st.innerHTML = '<i></i>' + (kind === 'serial' ? 'LIVE' : 'ออฟไลน์');
    }
  }

  async function connectSerial(kind) {
    if (!App.serial.available()) {
      App.toast(App.serial.why(), 'bad');
      return false;
    }
    try {
      if (App.releasePort) await App.releasePort();
      await App.serial.connect(App.serial.baud(), parseSerialLine, kind);
      serialOn = true;
      live.demo = false;
      live.source = 'serial';
      setConn('serial');
      bindSerialClose();
      afterOpen();
      App.toast('เชื่อมต่อแล้ว · รอข้อมูลจากอุปกรณ์', 'good');
      return true;
    } catch (e) {
      const msg = App.serial.friendly(e);
      if (msg) App.toast('เชื่อมต่อไม่สำเร็จ: ' + msg, 'bad');
      return false;
    }
  }

  function bindSerialClose() {
    App.serial.onClose = (why) => {
      if (live.source === 'serial') {
        live.source = 'demo'; live.demo = true; setConn('demo');
        if (why === 'unplug') App.toast('สายหลุด — กลับโหมดเดโม', 'bad');
      }
    };
  }

  /* เสียบสายแล้วต่อเอง ใช้พอร์ตที่เคยอนุญาตไว้ */
  let autoBusy = false;
  async function autoConnect() {
    if (autoBusy || App.serial.open || !App.serial.available()) return;
    autoBusy = true;
    try {
      if (App.releasePort) await App.releasePort();
      const p = await App.serial.autoOpen(App.serial.baud(), parseSerialLine);
      if (p) {
        serialOn = true; live.demo = false; live.source = 'serial';
        setConn('serial'); bindSerialClose();
        afterOpen();
        App.toast('ต่ออุปกรณ์อัตโนมัติแล้ว · รอข้อมูล', 'good');
      }
    } finally { autoBusy = false; }
  }
  document.addEventListener('serial-plugged', () => setTimeout(autoConnect, 400));

  function startConnect() {
    App.chooseTransport(kind => { connectSerial(kind); });
  }

  function connSheet() {
    const support = App.serial.available();
    App.sheet(
      '<div class="sh-head"><b>แหล่งข้อมูลสด</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub">เลือกโหมดการอ่านค่าของมาตรวัด</div>' +
      '<button class="item' + (live.source === 'demo' ? ' on' : '') + '" data-src="demo" style="margin-bottom:6px">' +
      '<div><div class="nm">โหมดเดโม</div><div class="mt">จำลองรอบเครื่อง/เกียร์/AFR ให้ดูก่อน</div></div><div class="sp">ฟรี</div></button>' +
      '<button class="item' + (live.source === 'serial' ? ' on' : '') + '" data-src="serial">' +
      '<div><div class="nm">USB / บลูทูธ</div><div class="mt">อ่านบรรทัด rpm=..,afr=..,tps=.. จากอุปกรณ์</div></div>' +
      '<div class="sp">' + (support ? 'รองรับ' : 'ไม่รองรับ') + '</div></button>' +
      '<div class="lbl">รูปแบบข้อมูลที่รับ</div>' +
      '<div class="note blue mono" style="font-size:10px">rpm=5200,afr=13.2,tps=45,ect=88,iat=32,map=68,inj=4.2,ign=18,batt=13.9,spd=92,gear=3</div>' +
      '<button class="btn wide" id="btnSerialConnect" style="margin-top:10px"' + '>เชื่อมต่อ USB / บลูทูธ</button>' +
      (support ? '' : '<div class="note red" style="margin-top:8px">' + App.esc(App.serial.why()) + '</div>') +
      '<div class="sh-sub" style="margin-top:8px">ปิดการเชื่อมต่อก่อนไปหน้าอัดไฟ เพราะพอร์ตหนึ่งใช้ได้ทีละโปรแกรม</div>'
    );
    document.querySelectorAll('[data-src]').forEach(b => b.onclick = () => {
      const src = b.dataset.src;
      if (src === 'demo') {
        live.source = 'demo'; live.demo = true;
        demoT = 0; live.gear = 1;
        setConn('demo'); App.closeSheet();
        App.toast('โหมดเดโม');
      } else {
        App.closeSheet(); startConnect();
      }
    });
    const c = document.getElementById('btnSerialConnect');
    if (c) c.onclick = () => { App.closeSheet(); startConnect(); };
  }

  /* ---------------- trace ---------------- */
  let traceCtx = null, traceW = 0, traceH = 0;
  function sizeCanvas() {
    const cv = document.getElementById('traceCanvas');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 300, h = cv.clientHeight || 96;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    traceCtx = cv.getContext('2d');
    traceCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    traceW = w; traceH = h;
  }

  function pushTrace() {
    trace.rpm.push(live.rpm / MAXR);
    trace.afr.push(Math.max(0, Math.min(1, (live.afr - 10) / 8)));
    trace.tps.push(live.tps / 100);
    if (trace.rpm.length > 300) { trace.rpm.shift(); trace.afr.shift(); trace.tps.shift(); }
  }

  function drawTrace() {
    if (!traceCtx) return;
    const w = traceW, h = traceH;
    traceCtx.clearRect(0, 0, w, h);
    traceCtx.strokeStyle = '#16212C';
    traceCtx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      traceCtx.beginPath(); traceCtx.moveTo(0, y); traceCtx.lineTo(w, y); traceCtx.stroke();
    }
    const draw = (arr, color) => {
      if (arr.length < 2) return;
      traceCtx.beginPath();
      traceCtx.strokeStyle = color;
      traceCtx.lineWidth = 1.6;
      traceCtx.lineJoin = 'round';
      const step = w / (300 - 1);
      const off = 300 - arr.length;
      for (let i = 0; i < arr.length; i++) {
        const x = (off + i) * step;
        const y = h - 4 - arr[i] * (h - 8);
        if (i === 0) traceCtx.moveTo(x, y); else traceCtx.lineTo(x, y);
      }
      traceCtx.stroke();
    };
    draw(trace.rpm, '#35C7FF');
    draw(trace.afr, '#C8F53C');
    draw(trace.tps, '#FFB020');
  }

  /* ---------------- render ---------------- */
  function setText(id, v) {
    const e = document.getElementById(id);
    if (e && e.textContent !== String(v)) e.textContent = v;
  }

  function renderLive() {
    const rpm = Math.round(live.rpm);
    setText('rpmVal', rpm.toLocaleString('en-US'));
    setText('spdVal', Math.round(live.speed));
    setText('gearVal', live.speed < 1 && live.rpm < 1600 ? 'N' : String(Math.max(1, live.gear)));
    setText('tpsText', Math.round(live.tps) + '%');
    const fill = document.getElementById('tpsFill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, live.tps)) + '%';

    const afr = live.afr;
    setText('afrVal', afr ? afr.toFixed(1) : '--');
    const tag = document.getElementById('afrTag');
    if (tag) {
      let cls = '', txt = 'รอข้อมูล';
      if (afr) {
        if (afr < 12.4) { cls = 'rich'; txt = 'หนา (Rich)'; }
        else if (afr > 14.9) { cls = 'lean'; txt = 'บาง (Lean)'; }
        else { cls = 'ok'; txt = 'พอดี'; }
      }
      tag.className = 'tag ' + cls;
      tag.textContent = txt;
      tag.style.color = afr < 12.4 ? '#35C7FF' : '';
    }
    const mark = document.getElementById('afrMark');
    if (mark) mark.style.left = Math.max(2, Math.min(98, ((afr || 14.7) - 10) / 8 * 100)) + '%';

    setText('mEct', live.ect ? Math.round(live.ect) : '--');
    setText('mIat', live.iat ? Math.round(live.iat) : '--');
    setText('mMap', live.map ? Math.round(live.map) : '--');
    setText('mInj', live.inj ? live.inj.toFixed(1) : '--');
    setText('mIgn', live.ign ? Math.round(live.ign) : '--');
    setText('mBatt', live.batt ? live.batt.toFixed(1) : '--');
    const bcard = document.getElementById('mBattCard');
    if (bcard) bcard.classList.toggle('warn', live.batt > 0 && live.batt < 12.2);
    const ecard = document.getElementById('mEct');
    if (ecard && ecard.parentElement.parentElement) {
      ecard.parentElement.parentElement.classList.toggle('warn', live.ect > 104);
    }

    setText('sumMaxRpm', Math.round(trip.maxRpm).toLocaleString('en-US'));
    setText('sumTopSpd', Math.round(trip.topSpeed));
    setText('sumAvgAfr', trip.afrN ? (trip.afrSum / trip.afrN).toFixed(1) : '--');
    setText('sumDist', trip.dist.toFixed(1));

    drawTach();
    drawTrace();
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!last) { last = now; return; }
    const dt = Math.min(0.08, (now - last) / 1000);
    last = now;

    if (live.demo) demoStep(dt);
    if (live.rpm > trip.maxRpm) trip.maxRpm = live.rpm;
    if (live.speed > trip.topSpeed) trip.topSpeed = live.speed;
    if (live.afr > 8) { trip.afrSum += live.afr; trip.afrN++; }
    trip.dist += live.speed / 3600 * dt;
    trace.t += dt;
    if (trace.t >= 0.1) { trace.t = 0; pushTrace(); }

    const view = document.getElementById('view-live');
    if (view && view.classList.contains('on')) renderLive();

    const clock = document.getElementById('rideClock');
    if (clock) {
      if (!trip.start) trip.start = now;
      const sec = Math.floor((now - trip.start) / 1000);
      clock.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    }
  }

  /* ---------------- file / tune sync ---------------- */
  function syncTune() {
    const s = App.state;
    setText('ecuState', App.changedBytes() ? App.changedBytes() + ' ไบต์ที่แก้' : (s.bin ? 'พร้อมจูน' : 'ยังไม่โหลด'));
    setText('ecuName', s.bin ? s.binName : 'ยังไม่มีไฟล์ .bin');
    let meta = 'โหลด .bin + .xdf เพื่อเริ่มจูน';
    if (s.bin) {
      meta = App.kb(s.bin.length) + ' · ' + s.items.length + ' รายการ';
      if (s.xdfName) meta += ' · ' + s.xdfName;
      else if (s.scanOnly) meta += ' · สแกนอัตโนมัติ';
    }
    setText('ecuMeta', meta);
    setText('heroSub', (s.bin ? 'ไฟล์ ' + s.binName : 'ยังไม่โหลดไฟล์') + ' · 4 สปีด · 125 cc');
  }

  function render() {
    buildTachIfNeeded();
    sizeCanvas();
    syncTune();
    renderLive();
    if (!raf) raf = requestAnimationFrame(tick);
  }

  let built = false;
  function buildTachIfNeeded() {
    if (built) return;
    buildTach();
    built = true;
    const band = document.getElementById('afrBand');
    if (band) {
      band.style.left = ((12.8 - 10) / 8 * 100) + '%';
      band.style.width = ((1.0 / 8) * 100) + '%';
    }
    const chip = document.getElementById('connChip');
    if (chip) chip.onclick = connSheet;
    const go = document.getElementById('goTune');
    if (go) go.onclick = () => App.go('tune');

    window.addEventListener('resize', () => { sizeCanvas(); drawTrace(); });
    window.addEventListener('visibilitychange', () => {
      if (!document.hidden) { last = 0; }
    });
    setConn('demo');
    const kr0 = document.getElementById('klineRaw');
    if (kr0 && live.demo) kr0.textContent = 'สถานะ: ยังไม่ได้เชื่อมต่อ — ค่าที่เห็นเป็นเดโม · build r6';
    const lb = document.getElementById('liveConnectBtn');
    if (lb) lb.onclick = startConnect;
    autoConnect();
  }

  App.registerView('live', { render: render });
  App.on('binchange', syncTune);
  App.on('binload', () => { syncTune(); });
  App.on('xdfchange', syncTune);
  document.addEventListener('DOMContentLoaded', () => {
    /* App.init runs at end of body; make sure elements exist */
    setTimeout(render, 0);
  });
})();
