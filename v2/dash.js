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
    else if (kind === 'demo') { chip.className = 'pill dim'; txt.textContent = 'เดโม'; }
    else { chip.className = 'pill amber'; txt.textContent = 'หยุดชั่วคราว'; }
    const st = document.getElementById('statusPill');
    if (st) {
      st.className = 'pill ' + (kind === 'serial' ? '' : 'dim');
      st.innerHTML = '<i></i>' + (kind === 'serial' ? 'LIVE' : 'ออฟไลน์');
    }
  }

  async function connectSerial() {
    if (!App.serial.supported()) {
      App.toast('เบราว์เซอร์ไม่รองรับ Web Serial — ใช้ Chrome/Edge', 'bad');
      return;
    }
    try {
      await App.serial.connect(115200, parseSerialLine);
      serialOn = true;
      live.demo = false;
      live.source = 'serial';
      setConn('serial');
      App.toast('เชื่อมต่อแล้ว · รอข้อมูลจากอุปกรณ์', 'good');
    } catch (e) {
      if (e && e.name === 'NotFoundError') return;
      App.toast('เชื่อมต่อไม่สำเร็จ: ' + (e.message || e), 'bad');
    }
  }

  function connSheet() {
    const support = App.serial.supported();
    App.sheet(
      '<div class="sh-head"><b>แหล่งข้อมูลสด</b><button class="x" onclick="App.closeSheet()">✕</button></div>' +
      '<div class="sh-sub">เลือกโหมดการอ่านค่าของมาตรวัด</div>' +
      '<button class="item' + (live.source === 'demo' ? ' on' : '') + '" data-src="demo" style="margin-bottom:6px">' +
      '<div><div class="nm">โหมดเดโม</div><div class="mt">จำลองรอบเครื่อง/เกียร์/AFR ให้ดูก่อน</div></div><div class="sp">ฟรี</div></button>' +
      '<button class="item' + (live.source === 'serial' ? ' on' : '') + '" data-src="serial">' +
      '<div><div class="nm">Web Serial</div><div class="mt">อ่านบรรทัด rpm=..,afr=..,tps=.. จากอุปกรณ์</div></div>' +
      '<div class="sp">' + (support ? 'รองรับ' : 'ไม่รองรับ') + '</div></button>' +
      '<div class="lbl">รูปแบบข้อมูลที่รับ</div>' +
      '<div class="note blue mono" style="font-size:10px">rpm=5200,afr=13.2,tps=45,ect=88,iat=32,map=68,inj=4.2,ign=18,batt=13.9,spd=92,gear=3</div>' +
      '<button class="btn wide" id="btnSerialConnect" style="margin-top:10px"' + (support ? '' : ' disabled') + '>เชื่อมต่อ USB/ serial</button>' +
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
        connectSerial().then(() => App.closeSheet());
      }
    });
    const c = document.getElementById('btnSerialConnect');
    if (c) c.onclick = () => connectSerial().then(() => App.closeSheet());
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
