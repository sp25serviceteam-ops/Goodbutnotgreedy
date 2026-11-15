// First Crack: roast thermodynamics, scoring and autopilot. Pure logic, no DOM.
const Model = (() => {
  const AMB = 24;      // room temperature, C
  const SD = 3.0;      // spread of crack temperatures across the batch
  const K = {
    HC: 0.0062,   // air to bean convection
    KDB: 0.0020,  // drum to bean conduction
    PE: 6.3,      // burner into air
    KDA: 0.010,   // drum to air
    X0: 0.016,    // exhaust loss, fan off
    X1: 0.006,    // extra exhaust loss per unit airflow
    HCE: 0.006,   // air cooled by beans
    PD: 0.65,     // burner into drum
    KDA2: 0.003,
    L: 0.002,     // drum to room
    KDBD: 0.0008,
    KEV: 0.0058,  // moisture evaporation rate
    LH: 520,      // evaporative cooling
    CRASH: 9,     // steam burst at first crack
    EXO: 0.05     // exothermic kick after first crack
  };
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const phi = z => {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  };

  const BEANS = [
    {
      id: 'guji', name: 'Ethiopia Guji', detail: 'Washed heirloom, 2,100 m', style: 'Filter',
      brief: 'Dense and floral. Keep it light and bright.',
      cond: 0.93, m0: 0.105, fc: 201.5, sc: 229.5, charge: 200, scorch: 224,
      target: { drop: [205, 208], dtr: [15, 19] },
      prof: { acid: 9.2, sweet: 7.6, body: 5.2, aroma: 9.5 },
      notes: {
        light: ['jasmine', 'bergamot', 'white peach', 'lemon zest'],
        mid: ['apricot jam', 'black tea', 'honey', 'nectarine'],
        dark: ['dark chocolate', 'molasses', 'burnt orange', 'clove']
      }
    },
    {
      id: 'huila', name: 'Colombia Huila', detail: 'Washed caturra, 1,750 m', style: 'Omni',
      brief: 'The all-rounder. Sweet enough for milk, clean enough for filter.',
      cond: 1.0, m0: 0.11, fc: 200.5, sc: 228.5, charge: 198, scorch: 220,
      target: { drop: [209, 212], dtr: [18, 22] },
      prof: { acid: 7.4, sweet: 8.8, body: 7.0, aroma: 8.0 },
      notes: {
        light: ['green apple', 'lime', 'panela', 'white grape'],
        mid: ['red apple', 'caramel', 'milk chocolate', 'orange'],
        dark: ['cocoa', 'toasted walnut', 'treacle', 'cedar']
      }
    },
    {
      id: 'cerrado', name: 'Brazil Cerrado', detail: 'Natural yellow bourbon, 1,100 m', style: 'Espresso',
      brief: 'Soft, low grown, scorches if you look at it wrong. Take it deeper.',
      cond: 1.08, m0: 0.115, fc: 199.5, sc: 227.5, charge: 190, scorch: 208,
      target: { drop: [214, 218], dtr: [20, 25] },
      prof: { acid: 4.8, sweet: 8.4, body: 9.0, aroma: 7.2 },
      notes: {
        light: ['peanut', 'cereal', 'lemon', 'raw almond'],
        mid: ['hazelnut', 'milk chocolate', 'dried fig', 'malt'],
        dark: ['dark chocolate', 'roasted almond', 'brown sugar', 'pipe tobacco']
      }
    }
  ];

  const fcStart = b => b.fc - 1.645 * SD;
  const burner = g => 0.25 + 0.75 * g;   // the pilot flame never goes out

  // Reference curve: BT(t) = A - B exp(-t/tau), fitted through the turning
  // point region, first crack at 9:00 and the target drop.
  function targetCurve(bean) {
    const tFC = 540;
    const dtr = (bean.target.dtr[0] + bean.target.dtr[1]) / 200;
    const tDrop = tFC / (1 - dtr);
    const drop = (bean.target.drop[0] + bean.target.drop[1]) / 2;
    const fcT = fcStart(bean) - 1;
    const fit = tau => {
      const x1 = Math.exp(-90 / tau), x2 = Math.exp(-tFC / tau);
      const B = (fcT - 84) / (x1 - x2), A = 84 + B * x1;
      return { A, B, err: A - B * Math.exp(-tDrop / tau) - drop };
    };
    let lo = 100, hi = 4000, r = fit(400);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      r = fit(mid);
      if (r.err > 0) hi = mid; else lo = mid;
    }
    const tau = (lo + hi) / 2, A = r.A, B = r.B;
    return {
      A, B, tau, tFC, tDrop, drop,
      bt: t => A - B * Math.exp(-t / tau),
      ror: t => 60 * B / tau * Math.exp(-t / tau)
    };
  }

  function create(beanId, chargeTemp) {
    const bean = BEANS.find(b => b.id === beanId) || BEANS[0];
    const ct = chargeTemp == null ? bean.charge : chargeTemp;
    return {
      bean, chargeTemp: ct, t: 0, charged: false, dropped: false, fire: false,
      Tb: AMB, Te: ct, Td: ct + 8, P: ct - 5, M: bean.m0, gas: 0.4, air: 0.25,
      f1: 0, f2: 0, ror: 0, tp: null, minP: ct, tMin: 0, ev: {}, events: [], hist: [],
      acc: 0, pbuf: [], stall: 0, smoke: 0, smokeExp: 0, tdPeakEarly: 0, tePeakEarly: 0, rorPeak: 0,
      ai: 0, curve: targetCurve(bean)
    };
  }

  function log(s, key, label) {
    if (s.ev[key]) return;
    const e = { key, label, t: s.t, temp: s.P };
    s.ev[key] = e;
    s.events.push(e);
  }

  function charge(s) {
    if (s.charged) return;
    s.charged = true; s.t = 0; s.Tb = AMB; s.minP = s.P; s.pbuf = [];
    log(s, 'charge', 'Charge');
  }

  function drop(s) {
    if (!s.charged || s.dropped) return;
    s.dropped = true;
    log(s, 'drop', 'Drop');
  }

  function sample(s) {
    const pb = s.pbuf;
    pb.push(s.P);
    const n = pb.length;
    const raw = n > 30 ? (s.P - pb[n - 31]) * 2 : n > 1 ? (s.P - pb[0]) * 60 / (n - 1) : 0;
    s.ror += (raw - s.ror) * 0.3;
    if (!s.tp) {
      if (s.P < s.minP) { s.minP = s.P; s.tMin = s.t; }
      else if (s.t > 25 && s.P > s.minP + 0.4) {
        s.tp = { t: s.tMin, temp: s.minP };
        const e = { key: 'tp', label: 'Turning point', t: s.tMin, temp: s.minP };
        s.ev.tp = e; s.events.push(e);
      }
    } else {
      if (s.t > s.tp.t + 45 && s.ror > s.rorPeak) s.rorPeak = s.ror;
      if (s.ev.dry && s.ror < 3) s.stall += 1;
    }
    if (s.Tb < 150 && s.Td > s.tdPeakEarly) s.tdPeakEarly = s.Td;
    if (s.Tb < 170 && s.t > 40 && s.Te > s.tePeakEarly) s.tePeakEarly = s.Te;
    if (s.tp && s.P >= 150) log(s, 'dry', 'Dry end');
    if (s.f1 >= 0.05) log(s, 'fc', 'First crack');
    if (s.f1 >= 0.97) log(s, 'fcEnd', 'First crack ends');
    if (s.f2 >= 0.05) log(s, 'sc', 'Second crack');
    s.hist.push({ t: s.t, P: s.P, Te: s.Te, ror: s.ror, gas: s.gas, air: s.air });
  }

  function step(s, dt) {
    if (s.dropped) return;
    if (!s.charged) {
      // Idle: thermostat holds the drum at charge temperature.
      s.Te += (s.chargeTemp - s.Te) * dt / 20;
      s.Td += (s.chargeTemp + 8 - s.Td) * dt / 40;
      s.P += (s.Te - 5 - s.P) * dt / 12;
      return;
    }
    const b = s.bean, a = s.air, g = burner(s.gas);
    const conv = 0.55 + 0.9 * a;
    const hc = K.HC * b.cond * conv;
    const fT = clamp((s.Tb - 60) / 100, 0, 1.6);
    const dM = Math.min(s.M - 0.012, K.KEV * (s.M - 0.012) * fT * fT * dt);
    s.M -= dM;
    const F1 = phi((s.Tb - b.fc) / SD), F2 = phi((s.Tb - b.sc) / SD);
    const dF1 = Math.max(0, F1 - s.f1), dF2 = Math.max(0, F2 - s.f2);
    s.f1 += dF1; s.f2 += dF2;
    const qevap = (K.LH * dM + K.CRASH * dF1) / dt;
    const qexo = K.EXO * clamp((s.Tb - b.fc) / 20, 0, 1.4);
    const dTb = hc * (s.Te - s.Tb) + K.KDB * (s.Td - s.Tb) - qevap + qexo;
    const dTe = g * K.PE + K.KDA * (s.Td - s.Te) - (K.X0 + K.X1 * a) * (s.Te - AMB) - K.HCE * conv * (s.Te - s.Tb);
    const dTd = g * K.PD - K.KDA2 * (s.Td - s.Te) - K.L * (s.Td - AMB) - K.KDBD * (s.Td - s.Tb);
    s.Tb += dTb * dt; s.Te += dTe * dt; s.Td += dTd * dt;
    s.P += (s.Tb - s.P) * dt / (6 + 24 * Math.exp(-s.t / 50));
    s.smoke = Math.pow(clamp((s.Tb - 188) / 45, 0, 1), 1.5);
    s.smokeExp += s.smoke * (1 - a) * dt;
    s.t += dt;
    s.acc += dt;
    while (s.acc >= 1) { s.acc -= 1; sample(s); }
    if (s.Tb >= 247 && !s.fire) {
      s.fire = true; s.dropped = true;
      log(s, 'fire', 'Roaster fire');
    }
  }

  // Autopilot: inverts the heat model to find the gas that produces the
  // rate of rise the reference curve wants, then corrects for drift.
  function autopilot(s, dt) {
    if (!s.charged || s.dropped) return;
    const c = s.curve, b = s.bean;
    const airWant = !s.tp || s.P < 150 ? 0.25 : s.f1 < 0.02 ? 0.5 : 0.8;
    s.air += clamp(airWant - s.air, -0.02 * dt, 0.02 * dt);
    const conv = 0.55 + 0.9 * s.air, hc = K.HC * b.cond * conv;
    let rate = !s.tp || s.t < 85 ? c.ror(90) / 60 * 1.1 : c.ror(s.t) / 60 + 0.03 * (c.bt(s.t) - s.P);
    rate = clamp(rate, 0.02, 0.6);
    const fT = clamp((s.Tb - 60) / 100, 0, 1.6);
    const lead = s.Tb + rate * 22;
    const z = (lead - b.fc) / SD;
    const qev = K.LH * K.KEV * (s.M - 0.012) * fT * fT + K.CRASH * 0.3989 * Math.exp(-z * z / 2) / SD * rate;
    const qexo = K.EXO * clamp((lead - b.fc) / 20, 0, 1.4);
    const TeNeed = s.Tb + (rate + qev - qexo - K.KDB * (s.Td - s.Tb)) / hc;
    const need = ((K.X0 + K.X1 * s.air) * (TeNeed - AMB) + K.HCE * conv * (TeNeed - s.Tb) - K.KDA * (s.Td - TeNeed)) / K.PE;
    const want = clamp((need - 0.25) / 0.75, 0, 1);
    s.gas += clamp(want - s.gas, -0.04 * dt, 0.04 * dt);
    if (s.ev.fc && s.P >= c.drop) drop(s);
  }

  const ROASTS = [
    [194, 'Underdone'], [201, 'Cinnamon'], [208.5, 'Light'], [213, 'City'], [217.5, 'City+'],
    [222, 'Full City'], [226, 'Full City+'], [232, 'Vienna'], [239, 'French'], [999, 'Charcoal']
  ];

  function evaluate(s) {
    const b = s.bean, ev = s.ev, total = s.t, dropT = s.P, h = s.hist;
    const fc = ev.fc ? ev.fc.t : null, dry = ev.dry ? ev.dry.t : null;
    const dev = fc != null ? total - fc : 0;
    const dtr = fc != null && total > 0 ? dev / total * 100 : 0;
    const maillard = fc != null && dry != null ? fc - dry : null;
    const Teff = dropT + 0.02 * (Math.min(dev, 300) - 90);
    const deg = clamp((Teff - 195) / 45, 0, 1);
    const roast = ROASTS.find(r => Teff < r[0])[1];
    const agtron = Math.round(clamp(78 - 1.25 * (Teff - 200), 18, 96));
    const loss = (b.m0 - s.M) * 100 + Math.max(0, Teff - 180) * 0.15;

    // RoR behaviour through first crack
    let crash = false, flick = false;
    if (fc != null) {
      const at = h.find(p => p.t >= fc);
      const r0 = at ? at.ror : 0;
      let rmin = r0, tminI = -1;
      h.forEach((p, i) => { if (p.t >= fc && p.t <= fc + 100 && p.ror < rmin) { rmin = p.ror; tminI = i; } });
      let rmax = rmin;
      if (tminI >= 0) for (let i = tminI; i < h.length; i++) if (h[i].ror > rmax) rmax = h[i].ror;
      crash = r0 > 4 && r0 - rmin > 0.5 * r0;
      flick = rmax - rmin > 2.5;
    }
    const baked = s.stall >= 40 || total > 15 * 60;
    const scorched = s.chargeTemp > b.scorch || s.tdPeakEarly > 238;
    const tipped = s.tePeakEarly > 285;
    const smoky = s.smokeExp > 26;
    const under = fc == null || dtr < 9;
    const burnt = Teff > 233;

    const pen = [];
    const add = (label, pts) => { if (pts > 0.5) pen.push({ label, pts: Math.round(pts) }); };
    const outside = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
    add('Drop temperature off target', Math.min(30, 3 * outside(dropT, b.target.drop[0], b.target.drop[1])));
    if (fc != null) add('Development ratio off target', Math.min(20, 2 * outside(dtr, b.target.dtr[0], b.target.dtr[1])));
    add('Total time out of range', Math.min(15, outside(total, 510, 750) / 30 * 4));
    if (maillard != null) add('Browning phase out of range', Math.min(12, outside(maillard, 180, 300) / 30 * 3));
    if (crash) add('Rate of rise crashed at first crack', 6);
    if (flick) add('Rate of rise flicked up late', 8);
    if (baked) add('Stalled and baked', 15);
    if (scorched) add('Scorched on a hot drum', 12);
    if (tipped) add('Tipping from too much early heat', 8);
    if (smoky) add('Stewed in its own smoke', Math.min(8, (s.smokeExp - 26) / 6 + 3));
    let score = 100 - pen.reduce((n, p) => n + p.pts, 0);
    if (fc == null) score = Math.min(score, 25);
    if (s.fire) score = 0;
    score = Math.round(clamp(score, 0, 100));

    const bell = (x, c, w) => Math.exp(-((x - c) * (x - c)) / (2 * w * w));
    const p = b.prof;
    const mq = maillard == null ? 0.5 : clamp(1 - outside(maillard, 170, 310) / 240, 0.5, 1);
    const flavour = {
      Acidity: p.acid * (1 - 0.85 * deg) * (baked ? 0.6 : 1) * (under ? 1.1 : 1),
      Sweetness: p.sweet * (0.35 + 0.65 * bell(deg, 0.42, 0.3)) * mq * (under ? 0.5 : 1) * (baked ? 0.7 : 1),
      Body: p.body * clamp(0.45 + 0.8 * deg - (deg > 0.85 ? (deg - 0.85) * 2.5 : 0), 0.2, 1.1),
      Bitterness: 0.8 + 8.6 * Math.pow(deg, 1.8) + (smoky ? 1.2 : 0) + (scorched ? 1.5 : 0) + (tipped ? 0.8 : 0),
      Aroma: p.aroma * (0.4 + 0.6 * bell(deg, 0.3, 0.42)) * (baked ? 0.6 : 1) * (under ? 0.55 : 1) * (smoky ? 0.85 : 1)
    };
    Object.keys(flavour).forEach(k => { flavour[k] = clamp(flavour[k], 0.3, 10); });

    let notes;
    if (s.fire) notes = ['charcoal', 'regret', 'insurance paperwork'];
    else if (under) notes = ['cut grass', 'raw peanut', 'hay'];
    else {
      const band = deg < 0.3 ? 'light' : deg < 0.62 ? 'mid' : 'dark';
      const pool = b.notes[band];
      const k = Math.floor(total) % pool.length;
      notes = [pool[k], pool[(k + 1) % pool.length], pool[(k + 2) % pool.length]];
      if (baked) notes[2] = 'stale bread';
      if (burnt) notes = ['ash', 'burnt rubber', pool[0]];
      else if (scorched) notes[2] = 'char';
      else if (smoky) notes[2] = 'campfire';
    }
    const defects = [];
    if (under) defects.push('Underdeveloped');
    if (baked) defects.push('Baked');
    if (scorched) defects.push('Scorched');
    if (tipped) defects.push('Tipped');
    if (smoky) defects.push('Smoky');
    if (burnt) defects.push('Burnt');
    const verdict = s.fire ? 'Call the fire brigade'
      : score >= 92 ? 'Competition roast'
      : score >= 82 ? 'This sells out'
      : score >= 68 ? 'Solid production roast'
      : score >= 45 ? 'Staff grinder only'
      : 'Straight to compost';
    return {
      score, verdict, roast, agtron, loss, total, dropT, fc, dry, dev, dtr, maillard,
      flavour, notes, defects, pen, crash, flick, fire: s.fire
    };
  }

  return { AMB, SD, BEANS, create, charge, drop, step, autopilot, evaluate, targetCurve, fcStart, clamp };
})();
if (typeof module !== 'undefined') module.exports = Model;
