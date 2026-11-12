(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2, clamp = Model.clamp;
  const mmss = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += Math.random(); return (u - 3) * 1.4142; };
  const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  // ------------------------------------------------------------ state
  let beanId = 'guji', chargeTemp = null;
  let S = Model.create(beanId);
  let phase = 'idle';            // idle | roasting | dropping | fire | done
  let auto = false, usedAuto = false, speed = 8, simAcc = 0, seen = 0, clock = 0;
  let burnVis = 0.3, coachClock = 0;
  let best = {};
  try { best = JSON.parse(localStorage.getItem('firstcrack.best') || '{}') || {}; } catch (e) { best = {}; }

  // ------------------------------------------------------------ sound
  const Sound = (() => {
    let ac = null, master = null, enabled = true;
    const n = {};
    const noise = (kind, len) => {
      const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
      }
      return buf;
    };
    const loop = (buf, type, freq, q) => {
      const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ac.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(master); src.start();
      return { f, g };
    };
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; return; }
      master = ac.createGain(); master.gain.value = enabled ? 0.9 : 0;
      const comp = ac.createDynamicsCompressor();
      master.connect(comp); comp.connect(ac.destination);
      n.white = noise('white', 2);
      n.rumble = loop(noise('brown', 3), 'lowpass', 150, 0.7);
      n.burner = loop(n.white, 'bandpass', 460, 0.6);
      n.fan = loop(n.white, 'bandpass', 1700, 0.4);
      n.tumble = loop(n.white, 'bandpass', 2400, 1.1);
    }
    function update(st) {
      if (!ac) return;
      const t = ac.currentTime, set = (node, v) => node.g.gain.setTargetAtTime(v, t, 0.15);
      set(n.rumble, 0.45);
      set(n.burner, 0.015 + 0.1 * st.burn);
      set(n.fan, 0.006 + 0.045 * st.air);
      set(n.tumble, st.beans ? 0.03 + 0.025 * st.dry : 0);
      n.tumble.f.frequency.setTargetAtTime(1700 + 2000 * st.dry, t, 0.3);
    }
    function pop(kind) {
      if (!ac || !enabled) return;
      const t = ac.currentTime + Math.random() * 0.04;
      const src = ac.createBufferSource(); src.buffer = n.white;
      const f = ac.createBiquadFilter(), g = ac.createGain();
      if (kind === 1) {
        f.type = 'bandpass'; f.frequency.value = 1200 + Math.random() * 1500; f.Q.value = 2.4;
        g.gain.setValueAtTime(0.5 + Math.random() * 0.45, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + Math.random() * 0.03);
      } else {
        f.type = 'highpass'; f.frequency.value = 4200 + Math.random() * 2500;
        g.gain.setValueAtTime(0.2 + Math.random() * 0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
      }
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t, Math.random() * 1.5, 0.14);
    }
    function tone(freq, dur, vol, type, delay) {
      if (!ac || !enabled) return;
      const t = ac.currentTime + (delay || 0);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.1, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    }
    const chime = good => (good ? [523, 659, 784, 1047] : [392, 349, 294]).forEach((f, i) => tone(f, 0.5, 0.09, 'triangle', i * 0.11));
    const alarm = () => { for (let i = 0; i < 6; i++) tone(i % 2 ? 620 : 880, 0.22, 0.12, 'square', i * 0.24); };
    function toggle() {
      enabled = !enabled;
      if (enabled) init();
      if (master) master.gain.setTargetAtTime(enabled ? 0.9 : 0, ac.currentTime, 0.05);
      return enabled;
    }
    return { init, update, pop, tone, chime, alarm, toggle, get enabled() { return enabled; } };
  })();

  // ------------------------------------------------------------ drum
  const W = 520, H = 560, CX = 260, CY = 246, R = 190, NB = 170, GRAV = 4300, OMEGA = 3.1, VANE = 44, CELL = 22;
  const COLS = Math.ceil(W / CELL) + 1, ROWS = Math.ceil((H + 80) / CELL) + 1;
  const head = new Int16Array(COLS * ROWS), nextI = new Int16Array(NB + 8);
  let beans = [], toSpawn = 0, theta = 0, doorOpen = false;
  let smoke = [], chaff = [], rings = [];
  const drumCv = $('drum'), dctx = drumCv.getContext('2d');
  let layerBody = null, layerRing = null, layerScale = 0;

  const STOPS = [
    [24, 124, 142, 92], [110, 142, 152, 96], [150, 200, 172, 98], [170, 192, 142, 82], [185, 166, 110, 62],
    [198, 136, 86, 48], [208, 110, 68, 38], [216, 88, 52, 30], [224, 66, 38, 23], [232, 46, 27, 18], [244, 26, 17, 13]
  ];
  function beanRGB(T) {
    if (T <= STOPS[0][0]) return STOPS[0].slice(1);
    for (let i = 1; i < STOPS.length; i++) {
      if (T <= STOPS[i][0]) {
        const a = STOPS[i - 1], b = STOPS[i], k = (T - a[0]) / (b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
      }
    }
    return STOPS[STOPS.length - 1].slice(1);
  }
  const css = (c, m) => 'rgb(' + (c[0] * m | 0) + ',' + (c[1] * m | 0) + ',' + (c[2] * m | 0) + ')';

  function spawnBean() {
    const b = S.bean, r0 = rnd(6.5, 7.7);
    beans.push({
      x: CX - 62 + rnd(-24, 24), y: CY - R + 36 + rnd(0, 30), vx: rnd(40, 220), vy: rnd(150, 380), ox: 0, oy: 0,
      r0, r: r0, ang: rnd(0, TAU), av: 0, fcT: b.fc + Model.SD * gauss(), scT: b.sc + Model.SD * gauss(),
      tint: rnd(-5, 5), c1: false, c2: false, grow: 1, touch: false, out: false, gx: 0, gy: 0
    });
  }

  function buildGrid() {
    head.fill(-1);
    for (let i = 0; i < beans.length; i++) {
      const b = beans[i];
      b.gx = clamp(Math.floor(b.x / CELL), 0, COLS - 1);
      b.gy = clamp(Math.floor(b.y / CELL), 0, ROWS - 1);
      const c = b.gy * COLS + b.gx;
      nextI[i] = head[c]; head[c] = i;
    }
  }
  function pairs() {
    const n = beans.length;
    for (let i = 0; i < n; i++) {
      const a = beans[i];
      for (let gy = a.gy - 1; gy <= a.gy + 1; gy++) {
        if (gy < 0 || gy >= ROWS) continue;
        for (let gx = a.gx - 1; gx <= a.gx + 1; gx++) {
          if (gx < 0 || gx >= COLS) continue;
          for (let j = head[gy * COLS + gx]; j !== -1; j = nextI[j]) {
            if (j <= i) continue;
            const b = beans[j], dx = b.x - a.x, dy = b.y - a.y, m = a.r + b.r, d2 = dx * dx + dy * dy;
            if (d2 < m * m && d2 > 1e-6) {
              const d = Math.sqrt(d2), p = (m - d) / d * 0.4;
              a.x -= dx * p; a.y -= dy * p; b.x += dx * p; b.y += dy * p;
            }
          }
        }
      }
    }
  }
  function bounds() {
    for (let i = 0; i < beans.length; i++) {
      const b = beans[i];
      if (b.out) continue;
      const dx = b.x - CX, dy = b.y - CY, d = Math.hypot(dx, dy) || 0.001, lim = R - b.r;
      if (d > lim) {
        let through = false;
        if (doorOpen) { const a = Math.atan2(dy, dx); through = a > 0.75 && a < 1.85; }
        if (through) { if (d > R + 3) b.out = true; }
        else { b.x = CX + dx / d * lim; b.y = CY + dy / d * lim; b.touch = true; }
      }
      if (d > R - VANE - b.r - 5) {
        for (let k = 0; k < 4; k++) {
          const ph = theta + k * Math.PI / 2, ux = Math.cos(ph), uy = Math.sin(ph);
          const pr = clamp((b.x - CX) * ux + (b.y - CY) * uy, R - VANE, R);
          const qx = CX + ux * pr, qy = CY + uy * pr;
          let ex = b.x - qx, ey = b.y - qy;
          const e = Math.hypot(ex, ey), m = b.r + 3;
          if (e < m) {
            if (e < 0.01) { ex = -uy; ey = ux; } else { ex /= e; ey /= e; }
            b.x = qx + ex * m; b.y = qy + ey * m;
          }
        }
      }
    }
  }
  function physics(dt) {
    const sub = dt > 0.025 ? 5 : 3, h = dt / sub;
    for (let k = 0; k < sub; k++) {
      theta += OMEGA * h;
      const n = beans.length;
      for (let i = 0; i < n; i++) {
        const b = beans[i];
        b.vy += GRAV * h; b.ox = b.x; b.oy = b.y; b.x += b.vx * h; b.y += b.vy * h; b.touch = false;
      }
      buildGrid();
      for (let it = 0; it < 3; it++) { pairs(); bounds(); }
      for (let i = 0; i < n; i++) {
        const b = beans[i];
        b.vx = (b.x - b.ox) / h; b.vy = (b.y - b.oy) / h;
        if (b.touch) {
          const dx = b.x - CX, dy = b.y - CY, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
          let vn = b.vx * nx + b.vy * ny, vt = -b.vx * ny + b.vy * nx;
          vt += (OMEGA * d - vt) * 0.3; if (vn > 0) vn = 0;
          b.vx = vn * nx - vt * ny; b.vy = vn * ny + vt * nx;
        }
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 1700) { b.vx *= 1700 / sp; b.vy *= 1700 / sp; }
        b.vx *= 0.998; b.vy *= 0.998;
        b.av += (b.vx * 0.5 / b.r - b.av) * 0.08; b.ang += b.av * h;
      }
    }
    if (doorOpen) beans = beans.filter(b => b.y < H + 30);
  }

  function particles(dt) {
    const live = phase === 'roasting' || phase === 'fire';
    if (live && beans.length) {
      const air = S.air, sm = phase === 'fire' ? 1.6 : S.smoke;
      let nS = (1.5 + 34 * sm) * dt;
      while (nS > 0 && smoke.length < 90) {
        if (Math.random() < nS) {
          const b = beans[(Math.random() * beans.length) | 0];
          smoke.push({ x: b.x, y: b.y - 6, vx: rnd(10, 30) + 70 * air, vy: -rnd(30, 60) - 60 * air, r: rnd(8, 16), age: 0, max: rnd(1.1, 1.9) - 0.7 * air, a: 0.05 + 0.1 * sm });
        }
        nS -= 1;
      }
      if (S.P > 135 && S.P < 214 && S.tp) {
        let nC = 7 * (0.6 + 1.6 * air) * dt;
        while (nC > 0 && chaff.length < 70) {
          if (Math.random() < nC) {
            const b = beans[(Math.random() * beans.length) | 0];
            chaff.push({ x: b.x, y: b.y, vx: rnd(-50, 50) + 110 * air, vy: -rnd(60, 190) * (0.5 + air), age: 0, max: rnd(0.7, 1.4), ang: rnd(0, TAU), av: rnd(-9, 9) });
          }
          nC -= 1;
        }
      }
    }
    for (const p of smoke) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += 14 * dt; }
    for (const p of chaff) { p.age += dt; p.vy += 170 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ang += p.av * dt; }
    for (const p of rings) p.age += dt;
    smoke = smoke.filter(p => p.age < p.max);
    chaff = chaff.filter(p => p.age < p.max);
    rings = rings.filter(p => p.age < 0.4);
  }

  function buildLayers(sc) {
    layerScale = sc;
    const mk = () => { const c = document.createElement('canvas'); c.width = Math.round(W * sc); c.height = Math.round(H * sc); const x = c.getContext('2d'); x.setTransform(sc, 0, 0, sc, 0, 0); return [c, x]; };
    let c, x;
    [c, x] = mk(); layerBody = c;
    let g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#262726'); g.addColorStop(0.55, '#181918'); g.addColorStop(1, '#0e0f0e');
    x.fillStyle = g; x.beginPath(); x.rect(0, 0, W, H); x.fill();
    x.globalAlpha = 0.035; x.strokeStyle = '#fff'; x.lineWidth = 1;
    for (let y = 3; y < H; y += 4) { x.beginPath(); x.moveTo(8, y + 0.5); x.lineTo(W - 8, y + 0.5); x.stroke(); }
    x.globalAlpha = 1;
    // burner slot
    x.fillStyle = '#080706'; x.beginPath(); x.roundRect(CX - 152, 468, 304, 60, 10); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.07)'; x.lineWidth = 1; x.beginPath(); x.roundRect(CX - 152.5, 467.5, 305, 61, 10); x.stroke();
    x.fillStyle = '#2a2b2a';
    for (let i = 0; i < 11; i++) { x.beginPath(); x.roundRect(CX - 133 + i * 26.6 - 5, 520, 10, 6, 2); x.fill(); }
    // nameplate
    x.fillStyle = 'rgba(255,255,255,.62)'; x.font = '600 9px ' + mono; x.textAlign = 'center';
    x.fillText('C A R E   P A C K   R O A S T E R   N o . 1', CX, 547);
    x.textAlign = 'left'; x.fillStyle = 'rgba(255,255,255,.22)'; x.font = '8px ' + mono;
    x.fillText('GAS', 28, 502); x.textAlign = 'right'; x.fillText('1 KG', W - 28, 502);

    [c, x] = mk(); layerRing = c;
    g = x.createLinearGradient(0, CY - R - 28, 0, CY + R + 28);
    g.addColorStop(0, '#8a8c88'); g.addColorStop(0.5, '#4a4c49'); g.addColorStop(1, '#222322');
    x.fillStyle = g; x.beginPath(); x.arc(CX, CY, R + 26, 0, TAU); x.arc(CX, CY, R, 0, TAU, true); x.fill('evenodd');
    x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = 3; x.beginPath(); x.arc(CX, CY, R + 1, 0, TAU); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1; x.beginPath(); x.arc(CX, CY, R + 25.5, 0, TAU); x.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU + 0.26, bx = CX + Math.cos(a) * (R + 13), by = CY + Math.sin(a) * (R + 13);
      x.fillStyle = '#161716'; x.beginPath(); x.arc(bx, by + 1, 4.6, 0, TAU); x.fill();
      const bg = x.createRadialGradient(bx - 1.2, by - 1.2, 0.5, bx, by, 4.2);
      bg.addColorStop(0, '#c9cbc6'); bg.addColorStop(1, '#4a4c49');
      x.fillStyle = bg; x.beginPath(); x.arc(bx, by, 3.9, 0, TAU); x.fill();
    }
  }

  function drawBean(x, b, T, sheen) {
    const c = beanRGB(T + b.tint - (b.c1 ? 0 : 1.5));
    const r = b.r;
    x.save(); x.translate(b.x, b.y); x.rotate(b.ang);
    x.beginPath(); x.ellipse(0, 0, r * 1.2, r * 0.84, 0, 0, TAU);
    x.fillStyle = css(c, 1); x.fill();
    x.strokeStyle = css(c, 0.55); x.lineWidth = 1; x.stroke();
    x.beginPath(); x.moveTo(-r * 0.85, -r * 0.05); x.quadraticCurveTo(0, r * 0.34, r * 0.85, -r * 0.05);
    x.strokeStyle = css(c, 0.5); x.lineWidth = 1.3; x.stroke();
    x.beginPath(); x.ellipse(-r * 0.25, -r * 0.36, r * 0.55, r * 0.17, 0, 0, TAU);
    x.fillStyle = 'rgba(255,255,255,' + (0.1 + sheen) + ')'; x.fill();
    x.restore();
  }

  function drawDrum(now) {
    const cw = drumCv.clientWidth; if (!cw) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), sc = cw * dpr / W;
    const pw = Math.round(W * sc), ph = Math.round(H * sc);
    if (drumCv.width !== pw || drumCv.height !== ph) { drumCv.width = pw; drumCv.height = ph; }
    if (Math.abs(layerScale - sc) > 1e-6) buildLayers(sc);
    const x = dctx;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, pw, ph); x.drawImage(layerBody, 0, 0);
    x.setTransform(sc, 0, 0, sc, 0, 0);
    const fire = phase === 'fire', T = S.Tb, flick = 0.85 + 0.15 * Math.sin(now * 0.021) * Math.sin(now * 0.0133);

    // inside the drum
    x.save(); x.beginPath(); x.arc(CX, CY, R, 0, TAU); x.clip();
    let g = x.createRadialGradient(CX, CY, 20, CX, CY, R);
    g.addColorStop(0, '#221b17'); g.addColorStop(1, '#0d0a09');
    x.fillStyle = g; x.fillRect(CX - R, CY - R, R * 2, R * 2);
    // perforated back plate turning with the drum
    x.fillStyle = 'rgba(0,0,0,.55)';
    [[0.3, 8], [0.55, 14], [0.8, 22]].forEach(([f, cnt], ri) => {
      for (let i = 0; i < cnt; i++) {
        const a = theta + i / cnt * TAU + ri * 0.4;
        x.beginPath(); x.arc(CX + Math.cos(a) * R * f, CY + Math.sin(a) * R * f, 3.2, 0, TAU); x.fill();
      }
    });
    x.fillStyle = '#2c2c2a'; x.beginPath(); x.arc(CX, CY, 15, 0, TAU); x.fill();
    x.fillStyle = '#131010'; x.beginPath(); x.arc(CX, CY, 5, 0, TAU); x.fill();
    // lifting vanes
    x.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const a = theta + k * Math.PI / 2, ux = Math.cos(a), uy = Math.sin(a);
      x.strokeStyle = '#3a3a37'; x.lineWidth = 7;
      x.beginPath(); x.moveTo(CX + ux * (R - VANE), CY + uy * (R - VANE)); x.lineTo(CX + ux * R, CY + uy * R); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,.1)'; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(CX + ux * (R - VANE) + uy * 2, CY + uy * (R - VANE) - ux * 2); x.lineTo(CX + ux * R + uy * 2, CY + uy * R - ux * 2); x.stroke();
    }
    const sheen = clamp((T - 224) / 14, 0, 1) * 0.22;
    for (let i = 0; i < beans.length; i++) if (!beans[i].out) drawBean(x, beans[i], T, sheen);
    // crack flashes
    for (const p of rings) {
      const k = p.age / 0.4;
      x.strokeStyle = p.k === 1 ? 'rgba(255,236,200,' + (1 - k) + ')' : 'rgba(255,150,70,' + (0.8 - 0.8 * k) + ')';
      x.lineWidth = p.k === 1 ? 2 : 1.3;
      x.beginPath(); x.arc(p.x, p.y, 5 + k * (p.k === 1 ? 20 : 11), 0, TAU); x.stroke();
    }
    for (const p of chaff) {
      x.save(); x.translate(p.x, p.y); x.rotate(p.ang);
      x.fillStyle = 'rgba(236,208,150,' + (0.85 * (1 - p.age / p.max)) + ')'; x.fillRect(-2.4, -1, 4.8, 2); x.restore();
    }
    for (const p of smoke) {
      const k = p.age / p.max, a = p.a * Math.sin(Math.PI * Math.min(1, k * 1.1));
      const sg = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      sg.addColorStop(0, 'rgba(214,206,198,' + a + ')'); sg.addColorStop(1, 'rgba(214,206,198,0)');
      x.fillStyle = sg; x.beginPath(); x.arc(p.x, p.y, p.r, 0, TAU); x.fill();
    }
    // burner glow rising through the drum
    x.globalCompositeOperation = 'lighter';
    g = x.createRadialGradient(CX, CY + R + 40, 10, CX, CY + R + 40, R * 1.55);
    const ga = (0.1 + 0.3 * burnVis) * flick;
    g.addColorStop(0, 'rgba(255,128,40,' + ga + ')'); g.addColorStop(1, 'rgba(255,100,20,0)');
    x.fillStyle = g; x.fillRect(CX - R, CY - R, R * 2, R * 2);
    if (fire) {
      x.fillStyle = 'rgba(255,90,20,' + (0.25 + 0.2 * Math.sin(now * 0.03)) + ')'; x.fillRect(CX - R, CY - R, R * 2, R * 2);
      for (let i = 0; i < 14; i++) {
        const fx = CX - R + 20 + i * 26 + 8 * Math.sin(now * 0.01 + i), fh = 120 + 90 * Math.sin(now * 0.013 + i * 1.7);
        const fg = x.createLinearGradient(0, CY + R, 0, CY + R - fh - 80);
        fg.addColorStop(0, 'rgba(255,220,120,.55)'); fg.addColorStop(1, 'rgba(255,60,10,0)');
        x.fillStyle = fg; x.beginPath(); x.ellipse(fx, CY + R - 20, 24, fh + 60, 0, 0, TAU); x.fill();
      }
    }
    x.globalCompositeOperation = 'source-over';
    g = x.createRadialGradient(CX, CY, R * 0.7, CX, CY, R);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.6)');
    x.fillStyle = g; x.fillRect(CX - R, CY - R, R * 2, R * 2);
    // glass
    g = x.createLinearGradient(CX - R, CY - R, CX, CY);
    g.addColorStop(0, 'rgba(255,255,255,.11)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.ellipse(CX - 50, CY - R * 0.72, R * 0.95, R * 0.42, -0.35, 0, TAU); x.fill();
    x.restore();

    x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(layerRing, 0, 0); x.setTransform(sc, 0, 0, sc, 0, 0);
    if (doorOpen) {
      x.strokeStyle = '#050404'; x.lineWidth = 27; x.lineCap = 'butt';
      x.beginPath(); x.arc(CX, CY, R + 13, 0.75, 1.85); x.stroke();
      x.strokeStyle = 'rgba(255,140,60,.8)'; x.lineWidth = 1.5;
      x.beginPath(); x.arc(CX, CY, R + 26, 0.75, 1.85); x.stroke();
    }
    // burner flames
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 11; i++) {
      const fx = CX - 133 + i * 26.6, n1 = Math.sin(now * 0.02 + i * 1.9) * Math.sin(now * 0.031 + i * 0.7);
      const fh = (7 + 40 * burnVis) * (0.82 + 0.18 * n1), fw = 5 + 4.5 * burnVis, by = 520;
      let fg = x.createLinearGradient(0, by, 0, by - fh);
      fg.addColorStop(0, 'rgba(90,150,255,.95)'); fg.addColorStop(0.45, 'rgba(110,130,255,.55)');
      fg.addColorStop(0.75, 'rgba(255,150,60,' + (0.25 + 0.6 * burnVis) + ')'); fg.addColorStop(1, 'rgba(255,120,30,0)');
      x.fillStyle = fg; x.beginPath();
      x.moveTo(fx - fw, by); x.quadraticCurveTo(fx - fw, by - fh * 0.5, fx + n1 * 2, by - fh);
      x.quadraticCurveTo(fx + fw, by - fh * 0.5, fx + fw, by); x.closePath(); x.fill();
      fg = x.createRadialGradient(fx, by - 3, 0, fx, by - 3, 16 + 24 * burnVis);
      fg.addColorStop(0, 'rgba(255,140,50,' + (0.1 + 0.16 * burnVis) + ')'); fg.addColorStop(1, 'rgba(255,140,50,0)');
      x.fillStyle = fg; x.fillRect(fx - 42, by - 46, 84, 58);
    }
    x.globalCompositeOperation = 'source-over';
    // beans that have left through the door fall in front of the machine
    for (let i = 0; i < beans.length; i++) if (beans[i].out) drawBean(x, beans[i], T, sheen);
  }

  // ------------------------------------------------------------ chart
  const chartCv = $('chart'), cctx = chartCv.getContext('2d');
  function drawChart(now) {
    const cw = chartCv.clientWidth, ch = chartCv.clientHeight; if (!cw || !ch) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (chartCv.width !== Math.round(cw * dpr) || chartCv.height !== Math.round(ch * dpr)) { chartCv.width = Math.round(cw * dpr); chartCv.height = Math.round(ch * dpr); }
    const x = cctx; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, cw, ch);
    const L = 40, Rr = 38, Tp = 24, Bm = 62, pw = cw - L - Rr, ph = ch - Tp - Bm;
    const h = S.hist, c = S.curve, b = S.bean;
    const tMax = Math.max(12 * 60, Math.ceil((Math.max(S.t, c.tDrop) + 40) / 60) * 60);
    let peak = 260; for (let i = 0; i < h.length; i += 5) if (h[i].Te > peak) peak = h[i].Te;
    const yMin = 50, yMax = Math.ceil((peak + 8) / 20) * 20, rMax = 40;
    const X = t => L + t / tMax * pw, Y = v => Tp + (1 - (v - yMin) / (yMax - yMin)) * ph;
    const YR = r => Tp + ph - clamp(r, 0, rMax) / rMax * ph * 0.6;
    x.font = '10px ' + mono; x.textBaseline = 'middle';

    // phase bands
    const ev = S.ev, tNow = S.t;
    const bands = [];
    if (S.charged) {
      const d = ev.dry ? ev.dry.t : tNow, f = ev.fc ? ev.fc.t : tNow;
      bands.push([0, d, 'rgba(0,160,77,.05)', 'DRYING']);
      if (ev.dry) bands.push([d, f, 'rgba(0,160,77,.10)', 'BROWNING']);
      if (ev.fc) bands.push([f, tNow, 'rgba(0,160,77,.17)', 'DEVELOPMENT']);
    }
    for (const [a, z, col, name] of bands) {
      x.fillStyle = col; x.fillRect(X(a), Tp, X(z) - X(a), ph);
      const wpx = X(z) - X(a);
      if (wpx > 74) {
        x.fillStyle = 'rgba(11,12,11,.6)'; x.textAlign = 'center';
        x.fillText(name + ' ' + Math.round((z - a) / Math.max(1, tNow) * 100) + '%', X(a) + wpx / 2, Tp + 11);
      }
    }
    // grid
    x.lineWidth = 1; x.textAlign = 'right';
    for (let v = 100; v < yMax; v += 50) {
      x.strokeStyle = 'rgba(11,12,11,.07)'; x.beginPath(); x.moveTo(L, Y(v) + 0.5); x.lineTo(L + pw, Y(v) + 0.5); x.stroke();
      x.fillStyle = '#63665f'; x.fillText(v + '°', L - 7, Y(v));
    }
    x.textAlign = 'left'; x.fillStyle = '#9a9d95';
    for (let r = 0; r <= 30; r += 10) x.fillText(String(r), L + pw + 7, YR(r));
    x.textAlign = 'center';
    const stepMin = pw / (tMax / 60) < 34 ? 2 : 1;
    for (let m = 0; m <= tMax / 60; m += stepMin) {
      x.strokeStyle = 'rgba(11,12,11,.05)'; x.beginPath(); x.moveTo(X(m * 60) + 0.5, Tp); x.lineTo(X(m * 60) + 0.5, Tp + ph); x.stroke();
      x.fillStyle = '#63665f'; x.fillText(m + ':00', X(m * 60), ch - 9);
    }
    // drop window
    const y1 = Y(b.target.drop[1]), y0 = Y(b.target.drop[0]);
    x.fillStyle = 'rgba(11,12,11,.055)'; x.fillRect(L, y1, pw, y0 - y1);
    x.strokeStyle = 'rgba(11,12,11,.35)'; x.setLineDash([2, 4]);
    x.beginPath(); x.moveTo(L, y1 + 0.5); x.lineTo(L + pw, y1 + 0.5); x.moveTo(L, y0 + 0.5); x.lineTo(L + pw, y0 + 0.5); x.stroke(); x.setLineDash([]);
    x.textAlign = 'left'; x.fillStyle = '#63665f'; x.fillText('DROP WINDOW', L + 6, y1 - 8);
    // reference curve
    x.strokeStyle = 'rgba(11,12,11,.38)'; x.lineWidth = 1.5; x.setLineDash([6, 6]); x.beginPath();
    for (let t = 95; t <= c.tDrop; t += 5) { const px = X(t), py = Y(c.bt(t)); if (t === 95) x.moveTo(px, py); else x.lineTo(px, py); }
    x.stroke(); x.setLineDash([]);

    x.save(); x.beginPath(); x.rect(L, Tp - 2, pw, ph + 4); x.clip();
    if (h.length > 1) {
      x.lineJoin = 'round';
      x.strokeStyle = 'rgba(11,12,11,.8)'; x.lineWidth = 1.4; x.beginPath();
      h.forEach((p, i) => { if (i) x.lineTo(X(p.t), Y(p.Te)); else x.moveTo(X(p.t), Y(p.Te)); }); x.stroke();
      if (S.tp) {
        x.strokeStyle = '#9a9d95'; x.lineWidth = 1.5; x.beginPath(); let started = false;
        for (const p of h) { if (p.t < S.tp.t + 34) continue; if (started) x.lineTo(X(p.t), YR(p.ror)); else { x.moveTo(X(p.t), YR(p.ror)); started = true; } }
        x.stroke();
      }
      const lg = x.createLinearGradient(L, 0, L + pw, 0); lg.addColorStop(0, '#00A04D'); lg.addColorStop(1, '#00A04D');
      x.strokeStyle = lg; x.lineWidth = 2.6; x.shadowColor = 'rgba(0,160,77,.25)'; x.shadowBlur = 6; x.beginPath();
      h.forEach((p, i) => { if (i) x.lineTo(X(p.t), Y(p.P)); else x.moveTo(X(p.t), Y(p.P)); }); x.stroke(); x.shadowBlur = 0;
    }
    x.restore();
    // events
    const tag = { tp: 'TP', dry: 'DRY', fc: 'FC', fcEnd: '', sc: 'SC', drop: 'DROP', fire: 'FIRE' };
    for (const e of S.events) {
      const name = tag[e.key]; if (!name) continue;
      const px = X(e.t), py = Y(e.temp);
      x.strokeStyle = 'rgba(11,12,11,.3)'; x.setLineDash([2, 3]); x.beginPath(); x.moveTo(px + 0.5, Tp + 18); x.lineTo(px + 0.5, Tp + ph); x.stroke(); x.setLineDash([]);
      x.fillStyle = '#0b0c0b'; x.beginPath(); x.arc(px, py, 3.2, 0, TAU); x.fill();
      x.fillStyle = '#0b0c0b'; x.textAlign = 'center'; x.font = '600 10px ' + mono;
      x.fillText(name, clamp(px, L + 14, L + pw - 16), py - 12); x.font = '10px ' + mono;
    }
    if (h.length && phase === 'roasting') {
      const p = h[h.length - 1], pulse = 5 + 2.5 * Math.sin(now * 0.008);
      x.fillStyle = 'rgba(0,160,77,.22)'; x.beginPath(); x.arc(X(p.t), Y(p.P), pulse + 4, 0, TAU); x.fill();
      x.fillStyle = '#0b0c0b'; x.beginPath(); x.arc(X(p.t), Y(p.P), 3.5, 0, TAU); x.fill();
    }
    // gas and air strip
    const sy = Tp + ph + 8, sh = 26;
    x.fillStyle = 'rgba(11,12,11,.04)'; x.fillRect(L, sy, pw, sh);
    if (h.length > 1) {
      x.fillStyle = 'rgba(0,160,77,.35)'; x.beginPath(); x.moveTo(X(h[0].t), sy + sh);
      for (const p of h) x.lineTo(X(p.t), sy + sh - p.gas * sh);
      x.lineTo(X(h[h.length - 1].t), sy + sh); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(11,12,11,.85)'; x.lineWidth = 1.3; x.beginPath();
      h.forEach((p, i) => { const py = sy + sh - p.air * sh; if (i) x.lineTo(X(p.t), py); else x.moveTo(X(p.t), py); }); x.stroke();
    }
    x.textAlign = 'right'; x.fillStyle = '#9a9d95'; x.fillText('GAS', L - 7, sy + 7); x.fillText('AIR', L - 7, sy + 20);
    x.strokeStyle = 'rgba(11,12,11,.2)'; x.lineWidth = 1; x.strokeRect(L + 0.5, Tp + 0.5, pw, ph);
  }

  // ------------------------------------------------------------ UI
  const el = {
    bt: $('roBT'), et: $('roET'), ror: $('roRoR'), time: $('roTime'), dev: $('roDev'),
    gas: $('gas'), air: $('air'), gasV: $('gasV'), airV: $('airV'), main: $('btnMain'), auto: $('btnAuto'),
    reset: $('btnReset'), coach: $('coach'), log: $('log'), toast: $('toast'), ct: $('ctV'), result: $('result'),
    beans: $('beans'), brief: $('brief'), sound: $('btnSound')
  };

  function renderBeans() {
    el.beans.innerHTML = Model.BEANS.map(b =>
      '<button class="bean' + (b.id === beanId ? ' on' : '') + '" data-id="' + b.id + '"' + (phase === 'idle' || phase === 'done' ? '' : ' disabled') + '>' +
      '<span class="bn">' + b.name + '</span><span class="bd">' + b.style + (best[b.id] != null ? ' · best ' + best[b.id] : '') + '</span></button>').join('');
  }
  function renderBrief() {
    const b = S.bean, t = b.target;
    el.brief.innerHTML = '<div class="bt"><h2>' + b.name + '</h2><span>' + b.detail + '</span></div>' +
      '<p>' + b.brief + '</p><div class="chips"><i>Drop ' + t.drop[0] + ' to ' + t.drop[1] + '°C</i><i>Development ' + t.dtr[0] + ' to ' + t.dtr[1] + '%</i><i>First crack near ' + Math.round(Model.fcStart(b)) + '°C</i></div>';
    el.ct.textContent = S.chargeTemp + '°C';
  }
  function setSlider(input, out, v) {
    const p = Math.round(v * 100);
    if (+input.value !== p) input.value = p;
    input.style.setProperty('--v', p + '%');
    out.textContent = p + '%';
  }
  function toast(text, cls) {
    el.toast.textContent = text; el.toast.className = 'toast';
    void el.toast.offsetWidth;
    el.toast.className = 'toast show ' + (cls || '');
  }
  function addLog(e) {
    const li = document.createElement('li');
    li.innerHTML = '<b>' + mmss(e.t) + '</b> ' + e.label + ' <span>' + e.temp.toFixed(0) + '°</span>';
    el.log.appendChild(li);
  }
  function coach() {
    const b = S.bean, t = b.target;
    if (phase === 'idle') return 'Drum is preheated and turning. Charge the beans, or let the autopilot show you a clean roast first.';
    if (phase === 'fire') return 'The batch is on fire.';
    if (phase !== 'roasting') return 'Dropped into the cooling tray.';
    if (auto) {
      if (!S.tp) return 'Autopilot: soaking. Gas low while the cold beans pull heat out of the drum.';
      if (!S.ev.dry) return 'Autopilot: drying. Building momentum along the dashed curve.';
      if (!S.ev.fc) return 'Autopilot: browning. Easing the gas so the rate of rise falls steadily.';
      return 'Autopilot: first crack. Air wide open, gliding into the drop window.';
    }
    if (!S.tp) return 'Cold beans are soaking up heat, so the probe falls. Wait for the turning point.';
    if (S.P > 238) return 'Thick smoke. Drop now or this ends in a fire.';
    if (S.ev.sc) return 'Second crack. Oils are coming to the surface. Drop.';
    if (S.ev.fc && S.P > t.drop[1]) return 'Past the drop window. Drop!';
    if (S.ev.fc && S.P >= t.drop[0]) return 'Inside the drop window. Drop now (space bar).';
    if (S.ev.fc) return S.ror > 12 ? 'First crack is rolling and you are coming in hot. Cut the gas, open the air.'
      : S.ror < 3 ? 'Rate of rise is dying. A touch more gas or it will bake.'
      : 'First crack. Open the air, trim the gas, glide into the drop window.';
    const diff = S.P - S.curve.bt(S.t);
    if (S.t > 95 && diff > 6) return 'Ahead of the dashed curve. Ease the gas back.';
    if (S.t > 95 && diff < -6) return 'Behind the dashed curve. Give it more gas.';
    if (!S.ev.dry) return 'Drying. Follow the dashed curve until the beans turn yellow near 150°C.';
    return 'Browning. Let the rate of rise fall gently. First crack arrives near ' + Math.round(Model.fcStart(b)) + '°C.';
  }
  function syncButtons() {
    el.main.textContent = phase === 'idle' ? 'Charge beans' : phase === 'roasting' ? 'Drop' : phase === 'done' ? 'New batch' : '…';
    el.main.disabled = phase === 'dropping' || phase === 'fire';
    el.main.classList.toggle('drop', phase === 'roasting');
    el.auto.textContent = phase === 'idle' ? 'Watch the autopilot' : auto ? 'Autopilot on' : 'Autopilot off';
    el.auto.classList.toggle('on', auto);
    el.auto.disabled = phase !== 'idle' && phase !== 'roasting';
    $('ctDown').disabled = $('ctUp').disabled = phase !== 'idle';
    renderBeans();
  }
  function updateReadouts() {
    el.bt.textContent = S.P.toFixed(1);
    el.et.textContent = S.Te.toFixed(0);
    el.ror.textContent = S.tp && S.t > S.tp.t + 20 ? S.ror.toFixed(1) : '··';
    el.time.textContent = S.charged ? mmss(S.t) : '0:00';
    el.dev.textContent = S.ev.fc ? ((S.t - S.ev.fc.t) / S.t * 100).toFixed(1) + '%' : '··';
    if (auto || phase !== 'roasting') { setSlider(el.gas, el.gasV, S.gas); setSlider(el.air, el.airV, S.air); }
  }

  // ------------------------------------------------------------ flow
  function reset() {
    S = Model.create(beanId, chargeTemp);
    phase = 'idle'; auto = false; usedAuto = false; simAcc = 0; seen = 0; clock = 0;
    beans = []; toSpawn = 0; doorOpen = false; smoke = []; chaff = []; rings = [];
    el.log.innerHTML = ''; el.result.classList.remove('show');
    setSlider(el.gas, el.gasV, S.gas); setSlider(el.air, el.airV, S.air);
    renderBrief(); syncButtons(); el.coach.textContent = coach();
  }
  function chargeNow() {
    if (phase !== 'idle') return;
    Sound.init();
    Model.charge(S); phase = 'roasting'; toSpawn = NB;
    Sound.tone(180, 0.25, 0.12, 'triangle');
    toast('Charged');
    syncButtons();
  }
  function dropNow() {
    if (phase !== 'roasting') return;
    Model.drop(S); handleEvents(); beginDrop();
  }
  function beginDrop() {
    phase = 'dropping'; doorOpen = true; clock = 0; auto = false;
    Sound.tone(140, 0.5, 0.14, 'sawtooth');
    toast('Dropped at ' + S.P.toFixed(1) + '°C');
    syncButtons();
  }
  function startFire() {
    phase = 'fire'; clock = 0; auto = false;
    Sound.alarm(); toast('Roaster fire', 'bad'); syncButtons();
  }
  function finish() {
    phase = 'done'; doorOpen = false;
    const r = Model.evaluate(S);
    if (!usedAuto && (best[beanId] == null || r.score > best[beanId])) {
      best[beanId] = r.score;
      try { localStorage.setItem('firstcrack.best', JSON.stringify(best)); } catch (e) { /* private mode */ }
    }
    showResult(r);
    if (!r.fire) Sound.chime(r.score >= 68);
    beans = []; syncButtons();
  }
  function handleEvents() {
    while (seen < S.events.length) {
      const e = S.events[seen++];
      addLog(e);
      if (e.key === 'tp') { toast('Turning point'); Sound.tone(520, 0.18, 0.06); }
      if (e.key === 'dry') { toast('Yellowing. Dry end'); Sound.tone(620, 0.18, 0.06); }
      if (e.key === 'fc') { toast('First crack', 'hot'); Sound.tone(740, 0.3, 0.08); }
      if (e.key === 'sc') { toast('Second crack', 'hot'); Sound.tone(880, 0.3, 0.08); }
    }
  }
  function setAuto(v) {
    if (phase === 'idle' && v) { usedAuto = true; auto = true; chargeNow(); return; }
    if (phase !== 'roasting') return;
    auto = v; if (v) usedAuto = true;
    syncButtons();
  }
  function setBean(id) {
    if (phase !== 'idle' && phase !== 'done') return;
    beanId = id; chargeTemp = null; reset();
  }
  function setSpeed(v) {
    speed = v;
    document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', +b.dataset.v === v));
  }

  // ------------------------------------------------------------ result card
  function showResult(r) {
    const b = S.bean, col = r.score >= 68 && !r.fire ? '#00A04D' : '#0b0c0b';
    const C = 2 * Math.PI * 52;
    const keys = Object.keys(r.flavour), cx = 120, cy = 112, rad = 76;
    const pt = (i, f) => { const a = -Math.PI / 2 + i / keys.length * TAU; return [cx + Math.cos(a) * rad * f, cy + Math.sin(a) * rad * f]; };
    let radar = '';
    [0.25, 0.5, 0.75, 1].forEach(f => { radar += '<polygon points="' + keys.map((k, i) => pt(i, f).map(n => n.toFixed(1)).join(',')).join(' ') + '" fill="none" stroke="#e2e4de"/>'; });
    keys.forEach((k, i) => {
      const [ax, ay] = pt(i, 1), [lx, ly] = pt(i, 1.26);
      radar += '<line x1="' + cx + '" y1="' + cy + '" x2="' + ax.toFixed(1) + '" y2="' + ay.toFixed(1) + '" stroke="#e2e4de"/>' +
        '<text x="' + lx.toFixed(1) + '" y="' + (ly + 3).toFixed(1) + '" text-anchor="middle">' + k + '</text>';
    });
    radar += '<polygon points="' + keys.map((k, i) => pt(i, r.flavour[k] / 10).map(n => n.toFixed(1)).join(',')).join(' ') + '" fill="' + col + '26" stroke="' + col + '" stroke-width="2" stroke-linejoin="round"/>';
    const bc = beanRGB(S.Tb), stat = (k, v) => '<div><span>' + k + '</span><b>' + v + '</b></div>';
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    el.result.innerHTML = '<div class="card">' +
      '<div class="rc-top"><svg class="ring" viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="#e2e4de" stroke-width="8"/>' +
      '<circle cx="60" cy="60" r="52" fill="none" stroke="' + col + '" stroke-width="8" stroke-dasharray="' + (r.score / 100 * C).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 60 60)"/>' +
      '<text x="60" y="66" text-anchor="middle" class="sc">' + r.score + '</text><text x="60" y="84" text-anchor="middle" class="so">out of 100</text></svg>' +
      '<div class="rc-head"><small>' + b.name + (usedAuto ? ', roasted by the autopilot' : '') + '</small><h2 style="color:' + col + '">' + r.verdict + '.</h2>' +
      '<div class="roastline"><svg viewBox="0 0 60 44" width="46" height="34"><ellipse cx="30" cy="22" rx="27" ry="19" fill="' + css(bc, 1) + '" stroke="' + css(bc, 0.5) + '" stroke-width="2"/><path d="M8 20 Q30 31 52 20" fill="none" stroke="' + css(bc, 0.45) + '" stroke-width="3" stroke-linecap="round"/></svg>' +
      '<span><b>' + r.roast + '</b> roast, Agtron ' + r.agtron + '</span></div>' +
      '<p class="notes">' + cap(r.notes.join(', ')) + '.</p></div></div>' +
      '<div class="rc-mid"><svg class="radar" viewBox="0 0 240 224">' + radar + '</svg><div class="stats">' +
      stat('Total time', mmss(r.total)) + stat('First crack', r.fc == null ? 'never' : mmss(r.fc)) +
      stat('Development', r.fc == null ? 'none' : mmss(r.dev) + ' / ' + r.dtr.toFixed(1) + '%') + stat('Drop temp', r.dropT.toFixed(1) + '°C') +
      stat('Weight loss', r.loss.toFixed(1) + '%') + stat('Browning', r.maillard == null ? 'none' : mmss(r.maillard)) + '</div></div>' +
      '<div class="rc-pen"><h3>' + (r.pen.length ? 'What cost you points' : 'Nothing cost you points') + '</h3>' +
      (r.pen.length ? '<ul>' + r.pen.map(p => '<li><b>-' + p.pts + '</b>' + p.label + '</li>').join('') + '</ul>' : '<p>A clean roast, start to finish.</p>') +
      (r.defects.length ? '<div class="defects">' + r.defects.map(d => '<i>' + d + '</i>').join('') + '</div>' : '') + '</div>' +
      '<div class="rc-act"><button class="btn primary" id="rAgain">Roast again</button><button class="btn" id="rNext">Next bean</button>' +
      (usedAuto ? '<button class="btn" id="rSelf">Now you try</button>' : '<button class="btn" id="rShare">Share my score</button><button class="btn" id="rAuto">Watch the autopilot</button>') + '</div>' +
      '<p class="rc-cp">First Crack is made by Care Pack: orders, stock management, payments and packing for coffee roasters. <a href="/wholesale/">See Care Pack</a></p></div>';
    el.result.classList.add('show');
    $('rAgain').onclick = () => reset();
    $('rNext').onclick = () => { const i = Model.BEANS.findIndex(q => q.id === beanId); setBean(Model.BEANS[(i + 1) % Model.BEANS.length].id); };
    if ($('rAuto')) $('rAuto').onclick = () => { reset(); setAuto(true); };
    if ($('rSelf')) $('rSelf').onclick = () => reset();
    if ($('rShare')) $('rShare').onclick = () => {
      const text = 'I scored ' + r.score + ' roasting ' + b.name + ' on First Crack. Beat that.';
      const url = 'https://cafecarepackage.com/roast/';
      if (navigator.share) navigator.share({ text, url }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text + ' ' + url).then(() => { $('rShare').textContent = 'Copied'; }, () => {});
    };
  }

  // ------------------------------------------------------------ main loop
  function simulate(dt) {
    if (phase === 'roasting') {
      simAcc += dt * speed;
      let guard = 0;
      while (simAcc >= 0.25 && guard++ < 400) {
        simAcc -= 0.25;
        if (auto) Model.autopilot(S, 0.25);
        Model.step(S, 0.25);
        if (S.dropped) break;
      }
      handleEvents();
      if (S.fire) startFire(); else if (S.dropped) beginDrop();
    } else if (phase === 'idle') {
      Model.step(S, Math.min(1, dt * speed));
    } else if (phase === 'dropping') {
      clock += dt;
      if (clock > 3 || (clock > 1.2 && beans.length === 0)) finish();
    } else if (phase === 'fire') {
      clock += dt;
      if (clock > 2.6) finish();
    }
  }
  function cracks() {
    if (phase !== 'roasting') return;
    let pops = 0;
    for (const b of beans) {
      if (!b.c1 && S.Tb >= b.fcT) { b.c1 = true; rings.push({ x: b.x, y: b.y, age: 0, k: 1 }); if (pops++ < 4) Sound.pop(1); }
      if (!b.c2 && S.Tb >= b.scT) { b.c2 = true; rings.push({ x: b.x, y: b.y, age: 0, k: 2 }); if (pops++ < 5) Sound.pop(2); }
      b.grow += ((b.c1 ? 1.16 : 1) - b.grow) * 0.08; b.r = b.r0 * b.grow;
    }
  }
  let last = performance.now();
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
    simulate(dt);
    for (let i = 0; i < 5 && toSpawn > 0; i++, toSpawn--) spawnBean();
    cracks(); physics(dt); particles(dt);
    const burnTarget = phase === 'idle' ? 0.3 : phase === 'roasting' ? 0.25 + 0.75 * S.gas : 0.12;
    burnVis += (burnTarget - burnVis) * Math.min(1, dt * 6);
    Sound.update({ burn: burnVis, air: S.air, beans: beans.length > 20, dry: clamp((S.Tb - 60) / 150, 0, 1) });
    drawDrum(now); drawChart(now); updateReadouts();
    coachClock += dt;
    if (coachClock > 0.3) { coachClock = 0; const c = coach(); if (el.coach.textContent !== c) el.coach.textContent = c; }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ wiring
  el.gas.addEventListener('input', () => { if (auto) setAuto(false); S.gas = el.gas.value / 100; setSlider(el.gas, el.gasV, S.gas); });
  el.air.addEventListener('input', () => { if (auto) setAuto(false); S.air = el.air.value / 100; setSlider(el.air, el.airV, S.air); });
  el.main.addEventListener('click', () => { Sound.init(); if (phase === 'idle') chargeNow(); else if (phase === 'roasting') dropNow(); else if (phase === 'done') reset(); });
  el.auto.addEventListener('click', () => { Sound.init(); setAuto(phase === 'idle' ? true : !auto); });
  el.reset.addEventListener('click', () => reset());
  el.beans.addEventListener('click', e => { const b = e.target.closest('.bean'); if (b && !b.disabled) setBean(b.dataset.id); });
  $('speed').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setSpeed(+b.dataset.v); });
  el.sound.addEventListener('click', () => { const on = Sound.toggle(); el.sound.textContent = on ? 'Sound on' : 'Sound off'; el.sound.classList.toggle('on', on); });
  const stepCT = d => { if (phase !== 'idle') return; chargeTemp = clamp(S.chargeTemp + d, 170, 230); reset(); };
  $('ctDown').addEventListener('click', () => stepCT(-2));
  $('ctUp').addEventListener('click', () => stepCT(2));
  const nudge = (input, d) => { input.value = clamp(+input.value + d, 0, 100); input.dispatchEvent(new Event('input')); };
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); el.main.click(); }
    else if (k === 'ArrowUp') { e.preventDefault(); nudge(el.gas, 5); }
    else if (k === 'ArrowDown') { e.preventDefault(); nudge(el.gas, -5); }
    else if (k === 'ArrowRight') { e.preventDefault(); nudge(el.air, 5); }
    else if (k === 'ArrowLeft') { e.preventDefault(); nudge(el.air, -5); }
    else if (k === 'a' || k === 'A') el.auto.click();
    else if (k === 'r' || k === 'R') reset();
    else if (k === 'm' || k === 'M') el.sound.click();
    else if (k >= '1' && k <= '4') setSpeed([1, 4, 8, 16][+k - 1]);
  });

  // Headless hooks, used for testing the page without waiting in real time.
  window.FirstCrack = {
    get state() { return S; }, get phase() { return phase; }, get beans() { return beans; },
    charge: chargeNow, drop: dropNow, auto: setAuto, reset, setBean,
    fast(seconds) { const save = speed; speed = 1; for (let i = 0; i < seconds * 4 && phase === 'roasting'; i++) simulate(0.25); speed = save; return phase; },
    tick(n) { for (let i = 0; i < (n || 1); i++) { for (let j = 0; j < 5 && toSpawn > 0; j++, toSpawn--) spawnBean(); cracks(); physics(1 / 60); particles(1 / 60); } drawDrum(performance.now()); drawChart(performance.now()); updateReadouts(); return beans.length; },
    finish() { if (phase === 'dropping' || phase === 'fire') finish(); return phase; }
  };

  setSpeed(8); reset();
  requestAnimationFrame(frame);
})();
