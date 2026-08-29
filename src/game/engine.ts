import {
  ALL_CIRCUITS, CALENDARS, DRIVERS, JUNIOR_FIRST, JUNIOR_LAST, REG_EVENTS, RESERVES,
  ROLE_NAMES, SERIES_META, SERIES_ORDER, TEAMS, TRACK_OUTLINES, TRACK_SVGS, TRACK_SVGS_REVERSED,
  makeStaff, staffRolesFor, surnameCode,
} from './data';
import type {
  Circuit, Driver, GameState, Round, SeriesId, SeriesState, SessionResult,
  Setup, Sponsor, Stage, Staff, StrategyPreset, TableRow, Team, TrackGeo,
  UpgradeArea, UpgradeStrategy, WeatherKind, Weekend,
} from './types';

/* ================= УТИЛИТЫ ================= */

export function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T; }
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = Math.random;
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fmtLap(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(3)}`;
}
export function fmtGap(s: number): string {
  if (!isFinite(s)) return '—';
  return `+${s.toFixed(3)}`;
}
export function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/* ================= МОДЕЛЬ ТЕМПА =================
 * lap = базовое время трассы − carPerf·0.085 − навык·0.06
 *       + шины (состав + износ·деградация + «обрыв» + температура)
 *       + топливо·0.033 + повреждения·0.03 + режим + настройки + шум
 */

export function supplierPower(gs: GameState, t: Team): number {
  if (t.works) return t.power;
  const sup = Object.values(gs.teams).find((x) => x.seriesId === t.seriesId && x.works && x.engineMaker === t.engineMaker);
  return sup ? sup.power * 0.97 : t.power * 0.95;
}

export function carPerf(gs: GameState, t: Team, c: Circuit): number {
  const aeroW = 0.6 + 0.8 * (c.aeroSens || 0.5);
  const powW = 0.6 + 0.8 * (c.powerSens || 0.5);
  const pwr = supplierPower(gs, t);
  const wearPen = Math.max(0, (t.wear || 0) - 55) * 0.09;
  const v = t.base * 0.46 + (t.aero || 60) * 0.24 * aeroW + (t.chassis || 60) * 0.24
    + pwr * 0.25 * powW - wearPen;
  return isFinite(v) ? clamp(v, 20, 100) : 50;
}

export function driverSkill(d: Driver, mode: 'quali' | 'race', wet: boolean): number {
  const w = mode === 'quali'
    ? { p: 0.55, r: 0.15, c: 0.2, w: wet ? 0.25 : 0.05, f: 0.05 }
    : { p: 0.4, r: 0.25, c: 0.25, w: wet ? 0.3 : 0.05, f: 0.05 };
  const wetSkill = wet ? d.wet : d.wet * 0.25;
  return clamp(d.pace * w.p + d.racecraft * w.r + d.consistency * w.c + wetSkill * w.w + d.form * w.f * 2, 15, 100);
}

export function baseLap(c: Circuit, s: SeriesId): number {
  let base = c.kind === 'oval' ? c.lenKm * 14.5 + 6 : c.kind === 'street' ? c.lenKm * 15.6 + 16 : c.lenKm * 14.8 + 14;
  if (s === 'f2') base += 4.6;
  if (s === 'f3') base += 8.2;
  if (s === 'fe') base += 6.4;
  return base;
}

export function compoundDef(s: SeriesId, id: string) {
  return SERIES_META[s].compounds.find((c) => c.id === id) ?? SERIES_META[s].compounds[0];
}
export function tireName(sid: SeriesId, id: string): string { return compoundDef(sid, id).name; }
export function dryCompounds(sid: SeriesId) {
  return SERIES_META[sid].compounds.filter((c) => !['I', 'W'].includes(c.id));
}

/** Расход топлива за круг в зависимости от режима (кг/круг). Единый источник правды. */
export function fuelBurnFor(fuelMode: 'eco' | 'normal' | 'push'): number {
  return fuelMode === 'eco' ? 1.05 : fuelMode === 'push' ? 1.42 : 1.25;
}

/** Состав по умолчанию для старта (средний). */
export function defaultStartTire(sid: SeriesId): string {
  const dry = dryCompounds(sid);
  return dry[Math.floor(dry.length / 2)]?.id ?? 'M';
}

/** «Работа с шинами» команды: множитель деградации (90 → 0.80, 50 → 1.0, 30 → 1.10) */
export function tireCareFactor(gs: GameState, teamId: string): number {
  const t = gs.teams[teamId];
  if (!t) return 1;
  return 1.25 - (t.tires ?? 70) / 200;
}

/* ================= НАСТРОЙКИ БОЛИДА ================= */

export function defaultSetup(): Setup { return { aero: 50, mech: 50, tires: 50, brake: 50, diff: 50 }; }

/** ИИ-команды получают близкие к оптимальным настройки под трассу */
export function autoSetup(c: Circuit): Setup {
  const df = Math.round(50 + (c.aeroSens - c.powerSens) * 34);
  const mech = Math.round(50 + (c.kind === 'street' ? 14 : 0) + c.danger * 8 - 10);
  const tires = Math.round(50 + (c.deg - 0.6) * 22);
  const brake = Math.round(50 + (c.kind === 'street' ? 4 : 0) + (c.danger - 0.5) * 8);
  const diff = Math.round(50 + (c.kind === 'street' ? -6 : 4) + (c.aeroSens - 0.5) * 10);
  return { aero: clamp(df, 15, 85), mech: clamp(mech, 15, 85), tires: clamp(tires, 15, 85), brake: clamp(brake, 20, 80), diff: clamp(diff, 20, 80) };
}

/** Эффект настроек на время круга (сек) */
export function setupLapDelta(s: Setup, c: Circuit): number {
  const df = (s.aero - 50) / 50;
  const mech = (s.mech - 50) / 50;
  const press = (s.tires - 50) / 50;
  const brake = (s.brake - 50) / 50;
  const diff = (s.diff - 50) / 50;
  let d = 0;
  d -= df * 0.5 * c.aeroSens;
  d += df * 0.42 * c.powerSens;
  d -= mech * 0.3 * (c.kind === 'street' ? 1 : 0.45 + c.danger * 0.3);
  d += press * 0.12;
  const brakeOpt = c.kind === 'street' ? 0.08 : 0;
  d += Math.abs(brake - brakeOpt) * 0.28;
  const diffOpt = c.kind === 'street' ? -0.1 : 0.08;
  d += Math.abs(diff - diffOpt) * 0.22;
  return d;
}

export interface SetupTip { field: keyof Setup; label: string; current: number; suggested: number; confidence: number }

export interface DriverBriefing { did: string; driverName: string; carNo: number; engineer: string; skill: number; tips: SetupTip[] }

/** Инженер, закреплённый за конкретным болидом: инженеры занимают слоты после фиксированных
 *  ролей, и k-й пилот команды получает k-го инженера. */
export function engineerForDriver(gs: GameState, teamId: string, did: string): Staff | null {
  const t = gs.teams[teamId];
  if (!t) return null;
  const drivers = raceDriversOfTeam(gs, teamId);
  const k = drivers.findIndex((d) => d.id === did);
  if (k < 0) return null;
  const roles = staffRolesFor(t.seriesId, drivers.length);
  const fixedCount = roles.filter((r) => r !== 'engineer').length;
  const engId = t.staffIds[fixedCount + k] ?? t.staffIds[fixedCount] ?? t.staffIds[0];
  return engId ? gs.staff[engId] ?? null : null;
}

/** Инженерный брифинг перед практикой: каждый гоночный инженер даёт советы по настройкам
 *  только для своего болида. Чем выше скилл инженера, тем ближе рекомендации к идеалу
 *  (autoSetup) и тем выше уверенность. */
export function engineerSetupAdvice(gs: GameState, circuit: Circuit): DriverBriefing[] {
  const t = playerTeam(gs);
  const drivers = raceDriversOfTeam(gs, t.id);
  const ideal = autoSetup(circuit);
  const labels: Record<keyof Setup, string> = { aero: 'Прижим', mech: 'Мех. зацеп', tires: 'Давление шин', brake: 'Торм. баланс', diff: 'Дифференциал' };
  return drivers.map((d, k) => {
    const eng = engineerForDriver(gs, t.id, d.id);
    const skill = eng?.skill ?? 60;
    // скилл сильнее влияет на точность: 0.25..0.97
    const kVis = 0.25 + (skill / 100) * 0.72;
    const tips: SetupTip[] = (Object.keys(labels) as (keyof Setup)[]).map((f) => {
      const cur = driverSetup(gs, d.id)[f];
      const err = (1 - kVis) * 20 * (rnd() * 2 - 1);
      const suggested = clamp(Math.round(ideal[f] + err), 15, 85);
      return { field: f, label: labels[f], current: cur, suggested, confidence: clamp(Math.round(skill * 0.92 + rnd() * 8), 0, 100) };
    });
    return { did: d.id, driverName: d.name, carNo: k + 1, engineer: eng?.name ?? 'Инженер', skill, tips };
  });
}

export function setupWearMult(s: Setup): number {
  const press = (s.tires - 50) / 50;
  const df = (s.aero - 50) / 50;
  return 1 + press * 0.14 + Math.max(0, df) * 0.1;
}

export function driverSetup(gs: GameState, did: string): Setup {
  const d = gs.drivers[did];
  const t = d?.teamId ? gs.teams[d.teamId] : null;
  return (t && t.setups[did]) || defaultSetup();
}

export function setDriverSetup(gs: GameState, did: string, field: keyof Setup, value: number) {
  const d = gs.drivers[did];
  if (!d?.teamId) return;
  const t = gs.teams[d.teamId];
  if (!t.setups[did]) t.setups[did] = defaultSetup();
  t.setups[did][field] = clamp(value, 0, 100);
}

export function setStrategy(gs: GameState, did: string, preset: StrategyPreset) {
  gs.strategy[did] = preset;
}

export function setRookieChoice(gs: GameState, slot: 0 | 1 | 2, rookieId?: string) {
  if (gs.weekend) {
    gs.weekend.rookieChoice = slot;
    gs.weekend.rookieId = rookieId;
  }
}

/* ================= ГЕОМЕТРИЯ ТРАСС ================= */

const trackCache = new Map<string, TrackGeo>();
export function getTrack(c: Circuit): TrackGeo {
  const hit = trackCache.get(c.id);
  if (hit) return hit;
  const geo = buildTrack(c);
  trackCache.set(c.id, geo);
  return geo;
}

/** Парсер атрибута d="" SVG-путей (M/L/H/V/C/S/Q/T/A/Z, абс. и отн.) */
export function svgPathToPoints(d: string): [number, number][] {
  const tokens: string[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) tokens.push(m[1] + m[2]);
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastC: [number, number] | null = null;
  let lastCmd = '';
  const subs: [number, number][][] = [];
  let cur: [number, number][] = [];
  const push = (px: number, py: number) => {
    x = px; y = py;
    const last = cur[cur.length - 1];
    if (!last || Math.abs(last[0] - px) > 0.01 || Math.abs(last[1] - py) > 0.01) cur.push([px, py]);
  };
  const flush = () => { if (cur.length > 2) subs.push(cur); cur = []; };
  for (const tokRaw of tokens) {
    const tok = tokRaw.trim();
    if (!tok) continue;
    const cmd = tok[0];
    const nums = (tok.slice(1).match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    const C = cmd.toUpperCase();
    if (C === 'M') {
      flush();
      push(nums[0] + ox, nums[1] + oy);
      sx = x; sy = y;
      for (let k = 2; k + 1 < nums.length; k += 2) push(nums[k] + ox, nums[k + 1] + oy);
      lastC = null;
    } else if (C === 'L') {
      for (let k = 0; k + 1 < nums.length; k += 2) push(nums[k] + ox, nums[k + 1] + oy);
      lastC = null;
    } else if (C === 'H') {
      for (const n of nums) push(n + (rel ? x : 0), y);
      lastC = null;
    } else if (C === 'V') {
      for (const n of nums) push(x, n + (rel ? y : 0));
      lastC = null;
    } else if (C === 'C' || C === 'S') {
      const per = C === 'C' ? 6 : 4;
      for (let k = 0; k + per - 1 < nums.length; k += per) {
        let c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number;
        if (C === 'C') {
          [c1x, c1y, c2x, c2y, ex, ey] = nums.slice(k, k + 6);
          c1x += ox; c1y += oy; c2x += ox; c2y += oy; ex += ox; ey += oy;
        } else {
          const mirror = (lastCmd === 'C' || lastCmd === 'S') && lastC;
          c1x = mirror ? 2 * x - lastC![0] : x; c1y = mirror ? 2 * y - lastC![1] : y;
          c2x = nums[k] + ox; c2y = nums[k + 1] + oy; ex = nums[k + 2] + ox; ey = nums[k + 3] + oy;
        }
        for (let s = 1; s <= 12; s++) {
          const t = s / 12, u = 1 - t;
          push(u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
            u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey);
        }
        lastC = [c2x, c2y];
      }
    } else if (C === 'Q' || C === 'T') {
      const per = C === 'Q' ? 4 : 2;
      for (let k = 0; k + per - 1 < nums.length; k += per) {
        let cx: number, cy: number, ex: number, ey: number;
        if (C === 'Q') {
          cx = nums[k] + ox; cy = nums[k + 1] + oy; ex = nums[k + 2] + ox; ey = nums[k + 3] + oy;
        } else {
          const mirror = (lastCmd === 'Q' || lastCmd === 'T') && lastC;
          cx = mirror ? 2 * x - lastC![0] : x; cy = mirror ? 2 * y - lastC![1] : y;
          ex = nums[k] + ox; ey = nums[k + 1] + oy;
        }
        for (let s = 1; s <= 10; s++) {
          const t = s / 10, u = 1 - t;
          push(u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey);
        }
        lastC = [cx, cy];
      }
    } else if (C === 'A') {
      for (let k = 0; k + 6 < nums.length; k += 7) {
        let rx = Math.abs(nums[k]), ry = Math.abs(nums[k + 1]);
        const phi = (nums[k + 2] * Math.PI) / 180;
        const laf = nums[k + 3] ? 1 : 0, sf = nums[k + 4] ? 1 : 0;
        const ex = nums[k + 5] + ox, ey = nums[k + 6] + oy;
        const cp = Math.cos(phi), sp = Math.sin(phi);
        const dx2 = (x - ex) / 2, dy2 = (y - ey) / 2;
        const x1p = cp * dx2 + sp * dy2, y1p = -sp * dx2 + cp * dy2;
        let rx2 = rx * rx, ry2 = ry * ry;
        const lam = (x1p * x1p) / rx2 + (y1p * y1p) / ry2;
        if (lam > 1) { const sq = Math.sqrt(lam); rx2 *= lam; ry2 *= lam; rx *= sq; ry *= sq; }
        const sign = laf === sf ? -1 : 1;
        const numv = Math.max(0, rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p);
        const denv = rx2 * y1p * y1p + ry2 * x1p * x1p;
        const coef = sign * Math.sqrt(numv / (denv || 1));
        const cxp = coef * (rx * y1p) / ry, cyp = coef * -(ry * x1p) / rx;
        const ccx = cp * cxp - sp * cyp + (x + ex) / 2, ccy = sp * cxp + cp * cyp + (y + ey) / 2;
        const angB = (ux: number, uy: number, vx: number, vy: number) => {
          const dot = ux * vx + uy * vy, len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
          let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
          if (ux * vy - uy * vx < 0) a = -a;
          return a;
        };
        const th1 = angB(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
        let dth = angB((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
        if (!sf && dth > 0) dth -= Math.PI * 2;
        if (sf && dth < 0) dth += Math.PI * 2;
        const steps = Math.max(8, Math.round(Math.abs(dth) * 10));
        for (let s = 1; s <= steps; s++) {
          const th = th1 + (dth * s) / steps;
          push(cp * rx * Math.cos(th) - sp * ry * Math.sin(th) + ccx,
            sp * rx * Math.cos(th) + cp * ry * Math.sin(th) + ccy);
        }
        lastC = null;
      }
    } else if (C === 'Z') {
      push(sx, sy);
      flush();
      x = sx; y = sy;
      lastC = null;
    }
    lastCmd = C;
  }
  flush();
  if (!subs.length) return [];
  let best = subs[0], bestLen = 0;
  for (const s of subs) {
    let len = 0;
    for (let k = 1; k < s.length; k++) len += Math.hypot(s[k][0] - s[k - 1][0], s[k][1] - s[k - 1][1]);
    if (len > bestLen) { bestLen = len; best = s; }
  }
  return best;
}

/** Городская трасса: прямоугольная сетка кварталов с шиканами и «шпилькой» */
function streetShape(seed: number, rng: () => number): [number, number][] {
  const W = 800, H = 440, ox = 100, oy = 90;
  const pts: [number, number][] = [];
  const jit = (v: number, a: number) => v + (rng() * 2 - 1) * a;
  const nx = 5 + Math.floor(rng() * 2), ny = 4;
  for (let i = 0; i <= nx; i++) pts.push([jit(ox + (W * i) / nx, 16), jit(oy, 12)]);
  for (let i = 1; i <= ny; i++) pts.push([jit(ox + W, 14), jit(oy + (H * i) / ny, 14)]);
  for (let i = 1; i <= nx; i++) pts.push([jit(ox + W - (W * i) / nx, 16), jit(oy + H, 12)]);
  for (let i = 1; i < ny; i++) pts.push([jit(ox, 14), jit(oy + H - (H * i) / ny, 14)]);
  const hx = ox + W * (0.35 + rng() * 0.3), hy = oy + H;
  const idx = pts.findIndex((p) => Math.abs(p[1] - hy) < 30 && Math.abs(p[0] - hx) < W / nx);
  if (idx > 0) pts.splice(idx, 0, [hx - 26, hy - 78], [hx + 4, hy - 96], [hx + 34, hy - 70]);
  const cx = ox + W * (0.2 + rng() * 0.6);
  const ci = pts.findIndex((p) => Math.abs(p[1] - oy) < 26 && Math.abs(p[0] - cx) < W / nx);
  if (ci > 0) pts.splice(ci, 0, [cx - 18, oy + 42], [cx + 18, oy - 30]);
  return pts;
}

function buildTrack(c: Circuit): TrackGeo {
  const rng = mulberry32(c.seed);
  let raw: [number, number][] = [];
  const svgD = c.outline ? TRACK_SVGS[c.outline] : undefined;
  const outlinePts = c.outline ? TRACK_OUTLINES[c.outline] : undefined;
  let fromSvg = false;
  if (svgD) {
    raw = svgPathToPoints(svgD);
    if (c.outline && TRACK_SVGS_REVERSED.includes(c.outline)) raw.reverse();
    if (raw.length >= 8) fromSvg = true;
    else raw = [];
  }
  if (!raw.length && outlinePts) raw = outlinePts.map((p) => [p[0], p[1]] as [number, number]);
  if (!raw.length) {
    if (c.kind === 'street') raw = streetShape(c.seed, rng);
    else if (c.kind === 'oval') {
      const n = 48;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        raw.push([Math.cos(t) * 430 + Math.cos(t * 2) * 14 * rng(), Math.sin(t) * 260 + Math.sin(t * 3) * 10 * rng()]);
      }
    } else {
      const n = 11 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 300 * (0.66 + rng() * 0.5);
        raw.push([Math.cos(a) * r * 1.35, Math.sin(a) * r]);
      }
    }
  }
  const smoothIters = fromSvg || outlinePts ? (c.kind === 'street' ? 0 : 1) : 2;
  for (let it = 0; it < smoothIters; it++) {
    const out: [number, number][] = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i], q = raw[(i + 1) % raw.length];
      out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    raw = out;
  }
  const N = 240;
  const cumRaw: number[] = [0];
  for (let i = 1; i <= raw.length; i++) {
    const p = raw[i - 1], q = raw[i % raw.length];
    cumRaw.push(cumRaw[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const totalRaw = cumRaw[raw.length];
  const pts: [number, number][] = [];
  let seg = 0;
  for (let i = 0; i < N; i++) {
    const target = (i / N) * totalRaw;
    while (seg < raw.length - 1 && cumRaw[seg + 1] < target) seg++;
    const p = raw[seg], q = raw[(seg + 1) % raw.length];
    const span = cumRaw[seg + 1] - cumRaw[seg] || 1;
    const k = (target - cumRaw[seg]) / span;
    pts.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]);
  }
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const sc = Math.min(1000 / (maxX - minX || 1), 620 / (maxY - minY || 1));
  for (const p of pts) {
    p[0] = (p[0] - minX) * sc + (1000 - (maxX - minX) * sc) / 2;
    p[1] = (p[1] - minY) * sc + (620 - (maxY - minY) * sc) / 2;
  }
  const cum: number[] = [0];
  for (let i = 1; i <= N; i++) {
    const p = pts[i - 1], q = pts[i % N];
    cum.push(cum[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const total = cum[N];
  const factor: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = pts[(i - 2 + N) % N], b = pts[i], d = pts[(i + 2) % N];
    const v1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const v2 = Math.atan2(d[1] - b[1], d[0] - b[0]);
    let ang = Math.abs(v2 - v1);
    if (ang > Math.PI) ang = Math.PI * 2 - ang;
    factor.push(clamp(1 - ang * 2.6, c.kind === 'oval' ? 0.52 : 0.34, 1));
  }
  const avgFactor = factor.reduce((s, f) => s + f, 0) / N;
  return {
    pts, cum, total, factor, avgFactor,
    drsSegs: factor.map((f) => f > 0.93),
    slowSegs: factor.map((f) => f < 0.52),
  };
}

/* ================= ОБЩИЕ ПОМОЩНИКИ ================= */

export function driversOfTeam(gs: GameState, teamId: string): Driver[] {
  return Object.values(gs.drivers).filter((d) => d.teamId === teamId);
}
export function raceDriversOfTeam(gs: GameState, teamId: string): Driver[] {
  return driversOfTeam(gs, teamId).filter((d) => !d.reserve);
}
export function seriesDrivers(gs: GameState, sid: SeriesId): Driver[] {
  return Object.values(gs.drivers).filter((d) => d.seriesId === sid && d.teamId && !d.reserve);
}
export function circuitOfRound(gs: GameState, sid: SeriesId, idx: number): Circuit {
  return ALL_CIRCUITS[gs.series[sid].rounds[idx].circuitId];
}
export function playerTeam(gs: GameState): Team { return gs.teams[gs.playerTeamId]; }

export function stagesFor(gs: GameState, sid: SeriesId, roundIdx: number): Stage[] {
  const meta = SERIES_META[sid];
  const c = circuitOfRound(gs, sid, roundIdx);
  return ((sid === 'f1' && c.sprint) ? meta.stagesSprint : meta.stagesNormal) as Stage[];
}

export function stageTitle(gs: GameState, stage: Stage): string {
  const names: Record<string, string> = {
    fp1: 'Практика 1', fp2: 'Практика 2', fp3: 'Практика 3', fp: 'Свободная практика',
    quali: 'Квалификация', sq: 'Спринт-квалификация', sprint: 'Спринт',
    sprintRev: 'Спринт (реверсивная топ-10)', race: 'Гонка',
  };
  void gs;
  return names[stage] ?? stage;
}

export function isRaceLikeStage(stage: Stage): boolean {
  return stage === 'race' || stage === 'sprint' || stage === 'sprintRev';
}
export function isSessionStage(stage: Stage): boolean { return !isRaceLikeStage(stage); }
export function stageToSimKind(stage: Stage): 'practice' | 'quali' | 'sq' {
  if (stage === 'quali') return 'quali';
  if (stage === 'sq') return 'sq';
  return 'practice';
}

export function raceLapsFor(gs: GameState, kind: 'race' | 'sprint' | 'sprintRev', circuit: Circuit): number {
  if (kind === 'race') return circuit.laps;
  const f = gs.playerSeries === 'f1' ? 0.33 : 0.7;
  return clamp(Math.round(circuit.laps * f), 8, 60);
}

function sessionWeather(c: Circuit): WeatherKind {
  const w = rnd();
  if (w < c.rainChance * 0.55) return 'wet';
  if (w < c.rainChance) return 'clouds';
  return 'dry';
}

function pushNews(gs: GameState, text: string, tag: string) {
  const round = gs.series[gs.playerSeries]?.current ?? 0;
  gs.news.unshift({ text, tag, year: gs.year, round: round + 1 });
  if (gs.news.length > 70) gs.news.length = 70;
}

/* ================= СОЗДАНИЕ КАРЬЕРЫ ================= */

let juniorN = 0;
export function genJuniors(gs: GameState, count: number): Driver[] {
  const out: Driver[] = [];
  for (let i = 0; i < count; i++) {
    juniorN++;
    const fn = JUNIOR_FIRST[(juniorN * 7) % JUNIOR_FIRST.length];
    const ln = JUNIOR_LAST[(juniorN * 11) % JUNIOR_LAST.length];
    const name = `${fn} ${ln}`;
    const pace = 52 + Math.round(rnd() * 14);
    const d: Driver = {
      id: `jun_${gs.seasonN}_${juniorN}`, name,
      code: surnameCode(name),
      nat: '—', age: 16 + Math.floor(rnd() * 3),
      pace, racecraft: 48 + Math.round(rnd() * 14), consistency: 48 + Math.round(rnd() * 16),
      wet: 48 + Math.round(rnd() * 14), form: 70,
      teamId: null, seriesId: null, f1Starts: 0, gpStarts: 0,
      value: Math.round(pace * pace * 240), salary: 150_000, contract: 0,
    };
    gs.drivers[d.id] = d;
    out.push(d);
  }
  return out;
}

export function newCareer(seriesId: SeriesId, teamId: string): GameState {
  const drivers: Record<string, Driver> = {};
  for (const d of DRIVERS) drivers[d.id] = clone(d);
  const teams: Record<string, Team> = {};
  const staff: Record<string, Staff> = {};
  for (const t of TEAMS) {
    const tt = clone(t);
    const srng = mulberry32(tt.name.length * 977 + tt.reputation * 31);
    const list = makeStaff(tt, srng);
    tt.staffIds = list.map((s) => s.id);
    for (const s of list) staff[s.id] = s;
    teams[tt.id] = tt;
  }
  const series = {} as Record<SeriesId, SeriesState>;
  for (const sid of SERIES_ORDER) {
    const rounds: Round[] = CALENDARS[sid].map((c) => ({ circuitId: c.id, done: false }));
    const dStand: Record<string, number> = {};
    const tStand: Record<string, number> = {};
    for (const d of DRIVERS) if (d.seriesId === sid && d.teamId && !d.reserve) dStand[d.id] = 0;
    for (const t of TEAMS) if (t.seriesId === sid) tStand[t.id] = 0;
    series[sid] = { id: sid, rounds, current: 0, dStand, tStand };
  }
  const components: Record<string, Record<string, number>> = {};
  for (const d of DRIVERS) {
    if (d.reserve) continue;
    if (d.seriesId === 'f1') components[d.id] = { ICE: 1, TC: 1, 'MGU-H': 1, 'MGU-K': 1, ES: 1, CE: 1, EX: 1 };
    else if (d.seriesId === 'f2' || d.seriesId === 'f3') components[d.id] = { ENG: 1, wear: 0 }; // единый мотор + индивидуальный износ
  }
  const strategy: Record<string, StrategyPreset> = {};
  for (const d of DRIVERS) strategy[d.id] = 'balanced';
  const gs: GameState = {
    v: 2, year: 2026, seasonN: 1, phase: 'hub',
    playerSeries: seriesId, playerTeamId: teamId,
    reputation: teams[teamId].reputation, budget: teams[teamId].budget,
    series, drivers, teams, staff, components,
    nextRoundPen: {}, rookieUsed: 0, strategy,
    weekend: null, news: [],
    careerWins: 0, careerPodiums: 0, careerTitles: 0,
    summary: null,
    mods: { puLimitBonus: 0, degMod: 1, drsMod: 1, payMod: 1, capMod: 1 },
    negos: {}, deals: [], staffNegos: {}, staffDeals: [], programs: [],
    sponsors: [], ownerTrust: 60 + Math.round(teams[teamId].reputation * 0.3), fired: false,
    lastAdvice: {}, aiTransfers: [],
  };
  // настройки по умолчанию для каждого пилота
  for (const t of Object.values(gs.teams)) {
    for (const d of driversOfTeam(gs, t.id)) t.setups[d.id] = defaultSetup();
  }
  genJuniors(gs, 30);
  gs.sponsors = generateSponsors(gs);
  planRetirements(gs);
  pushNews(gs, `Вы возглавили ${teams[teamId].name} в чемпионате ${SERIES_META[seriesId].fullName} (сезон-2026)`, 'КАРЬЕРА');
  saveGame('auto', gs);
  return gs;
}

/* ================= УИК-ЭНД ================= */

export function beginWeekend(gs: GameState) {
  const sid = gs.playerSeries;
  const ss = gs.series[sid];
  const roundIdx = ss.current;
  const stages = stagesFor(gs, sid, roundIdx);
  const c = circuitOfRound(gs, sid, roundIdx);
  const weather: Record<string, WeatherKind> = {};
  for (const st of stages) weather[st] = sessionWeather(c);
  const w: Weekend = {
    roundIdx, stages, stageIdx: 0, results: {},
    qualiGrid: [], pendingGrid: { ...gs.nextRoundPen }, pitStart: [],
    rookieChoice: null, weather, setupNotes: [],
    rainMidRace: weather['race'] === 'clouds' && rnd() < 0.3,
  };
  gs.nextRoundPen = {};
  gs.weekend = w;
  gs.phase = 'weekend';
  if (sid === 'f1') aiFitComponents(gs, w);
  announceUpdates(gs); // анонс: что команды привезли на этот уик-энд
}

export function currentStage(gs: GameState): Stage | null {
  const w = gs.weekend;
  return w ? w.stages[w.stageIdx] : null;
}

function aiFitComponents(gs: GameState, w: Weekend) {
  for (const t of Object.values(gs.teams)) {
    if (t.id === gs.playerTeamId) continue;
    const ds = raceDriversOfTeam(gs, t.id);
    if (!ds.length) continue;
    if (t.seriesId === 'f1') {
      if (t.wear > 70 && rnd() < 0.5) {
        const d = pick(ds);
        const el = pick(['ICE', 'TC', 'MGU-H', 'MGU-K'] as const);
        const msg = fitComponent(gs, d.id, el, w);
        pushNews(gs, `${t.short}: ${msg}`, 'СУ');
        t.wear = 12;
      }
    } else if (t.seriesId === 'f2' || t.seriesId === 'f3') {
      // Ф2/Ф3: мотор индивидуальный, замена дешёвая и без штрафа — ИИ меняют тому, у кого износ высок
      // (износ копится ×0.1, поэтому порог ~6 ≈ 60 в командной шкале Ф1)
      for (const d of ds) {
        if (engineWearOf(gs, d.id) > 6 && rnd() < 0.6) swapEngine(gs, d.id);
      }
    }
  }
}

const UPG_AREA_NAMES: Record<string, string> = { aero: 'новое переднее крыло', chassis: 'обновлённое днище', power: 'форсированный мотор', tires: 'улучшенную работу с резиной' };

/** ИИ-команды развивают болиды во ВСЕХ сериях, где разрешены апгрейды (не только в серии игрока) */
function aiDevelopment(gs: GameState) {
  for (const t of Object.values(gs.teams)) {
    if (t.id === gs.playerTeamId) continue;
    if (SERIES_META[t.seriesId].specCar) continue; // единая спецификация — развивать нечего
    if (rnd() < 0.4) {
      const areas: UpgradeArea[] = t.works ? ['aero', 'chassis', 'power', 'tires'] : ['aero', 'chassis', 'tires'];
      const area = pick(areas);
      const gain = 0.3 + rnd() * 0.7;
      t[area] = clamp((t[area] ?? 60) + gain, 0, 99);
      gs._aiUpdates = gs._aiUpdates ?? {};
      gs._aiUpdates[t.id] = gs._aiUpdates[t.id] ?? [];
      gs._aiUpdates[t.id].push(UPG_AREA_NAMES[area]);
    }
  }
}

/** ИИ-команды активны на трансферном рынке в течение сезона — во ВСЕХ сериях.
 *  В каждой серии за этап происходит 0–2 сделки — рынок живёт, но не все команды действуют в один день.
 *  Новость о каждой сделке публикуется СРАЗУ при её заключении; сам переход — в конце сезона. */
function aiTransferMarket(gs: GameState) {
  for (const sid of SERIES_ORDER) {
    if (rnd() > 0.7) continue;              // в каждой серии событие происходит не на каждом этапе
    const nEvents = rnd() < 0.7 ? 1 : 2;    // 1–2 события за этап
    for (let i = 0; i < nEvents; i++) aiTransferEvent(gs, sid);
  }
}

function aiTransferEvent(gs: GameState, sid: SeriesId) {
  const roll = rnd();
  if (roll < 0.45) aiRenewContract(gs, sid);
  else if (roll < 0.8) aiAnnounceTransfer(gs, sid);
  else aiPromoteJunior(gs, sid);
}

/** Продление контракта со своим пилотом (применяется сразу) */
function aiRenewContract(gs: GameState, sid: SeriesId) {
  const teams = Object.values(gs.teams).filter((t) => t.seriesId === sid && t.id !== gs.playerTeamId);
  for (const t of shuffleArr(teams)) {
    const ds = raceDriversOfTeam(gs, t.id).filter((d) => d.contract <= 1 && !d.retiring && !d.willRetire);
    if (!ds.length) continue;
    const d = pick(ds);
    const years = 1 + Math.floor(rnd() * 2);
    d.contract = years;
    pushNews(gs, `[${SERIES_META[sid].name}] ${t.short}: ${d.name} продлил контракт на ${years} г. — до конца ${gs.year + years}`, 'ТРАНСФЕРЫ');
    return;
  }
}

/** Переход пилота между командами: анонс сразу, переход — в конце сезона */
function aiAnnounceTransfer(gs: GameState, sid: SeriesId) {
  const teams = Object.values(gs.teams).filter((t) => t.seriesId === sid && t.id !== gs.playerTeamId);
  if (teams.length < 2) return;
  const sorted = [...teams].sort((a, b) => b.reputation - a.reputation);
  const half = Math.max(1, Math.floor(sorted.length / 2));
  const fromTeam = pick(sorted.slice(half));         // пилот из нижней половины
  const toTeam = pick(sorted.slice(0, half));        // получает верхняя
  if (fromTeam.id === toTeam.id) return;
  const candidates = raceDriversOfTeam(gs, fromTeam.id).filter((d) => !d.retiring && !d.willRetire);
  if (!candidates.length) return;
  const d = pick(candidates);
  if (gs.aiTransfers.some((t) => t.did === d.id)) return;        // уже анонсирован
  if (gs.negos[d.id] || gs.deals.some((x) => x.did === d.id)) return; // не мешаем игроку
  gs.aiTransfers.push({ did: d.id, toTeamId: toTeam.id });
  pushNews(gs, `📢 [${SERIES_META[sid].name}] ${d.name} подписал контракт с ${toTeam.short} — перейдёт из ${fromTeam.short} после финала сезона`, 'ТРАНСФЕРЫ');
}

/** Повышение юниора: в Ф1 — из Ф2/Ф3, в других сериях — подписание свободного кокпита */
function aiPromoteJunior(gs: GameState, sid: SeriesId) {
  if (sid === 'f1') {
    const f1teams = Object.values(gs.teams).filter((t) => t.seriesId === 'f1' && t.id !== gs.playerTeamId);
    if (!f1teams.length) return;
    const toTeam = [...f1teams].sort((a, b) => a.reputation - b.reputation)[0];
    const juniors = Object.values(gs.drivers).filter((d) => !d.teamId && !d.seriesId && d.age <= 19);
    if (!juniors.length) return;
    const j = [...juniors].sort((a, b) => b.pace - a.pace)[0];
    if (gs.aiTransfers.some((t) => t.did === j.id) || gs.deals.some((x) => x.did === j.id)) return;
    gs.aiTransfers.push({ did: j.id, toTeamId: toTeam.id });
    pushNews(gs, `⭐ [Ф1] ${toTeam.short} подписывает юниора ${j.name} (${j.age} лет) — дебют в Ф1 со следующего сезона`, 'ТРАНСФЕРЫ');
    return;
  }
  // не-Ф1: команда с пустым кокпитом подписывает свободного пилота своей серии (применяется сразу)
  for (const t of Object.values(gs.teams).filter((x) => x.seriesId === sid && x.id !== gs.playerTeamId)) {
    if (raceDriversOfTeam(gs, t.id).length >= 2) continue;
    const free = Object.values(gs.drivers).filter((d) => !d.teamId && d.seriesId === sid);
    if (!free.length) continue;
    const d = pick(free);
    d.teamId = t.id;
    d.contract = 1;
    gs.series[sid].dStand[d.id] = gs.series[sid].dStand[d.id] ?? 0;
    pushNews(gs, `[${SERIES_META[sid].name}] ${t.short} подписывает ${d.name} — займёт пустующий кокпит`, 'ТРАНСФЕРЫ');
    return;
  }
}

function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Публикует анонсы обновлений для ВСЕХ серий (а не только серии игрока) */
export function announceUpdates(gs: GameState) {
  const ups = gs._aiUpdates ?? {};
  if (!Object.keys(ups).length) { gs._aiUpdates = {}; return; }
  // группируем команды по сериям, чтобы анонс был понятен независимо от серии игрока
  const bySeries: Record<string, string[]> = {};
  for (const [tid, list] of Object.entries(ups)) {
    const t = gs.teams[tid];
    if (!t) continue;
    const sName = SERIES_META[t.seriesId].name;
    bySeries[sName] = bySeries[sName] ?? [];
    bySeries[sName].push(`${t.short}: ${(list as string[]).join(', ')}`);
  }
  for (const [sName, entries] of Object.entries(bySeries)) {
    pushNews(gs, `🔧 [${sName}] Команды привезли обновления на этот уик-энд — ${entries.slice(0, 4).join('; ')}`, 'РАЗВИТИЕ');
  }
  gs._aiUpdates = {};
}

/* -------- сетки -------- */

export function sessionGridFor(gs: GameState, stage: Stage): string[] {
  const sid = gs.playerSeries;
  const w = gs.weekend!;
  if (stage === 'fp1' && sid === 'f1' && w.rookieChoice != null && w.rookieChoice > 0 && w.rookieId) {
    const myDrivers = raceDriversOfTeam(gs, gs.playerTeamId);
    const replaced = myDrivers[w.rookieChoice - 1];
    if (replaced && gs.drivers[w.rookieId]) {
      return seriesDrivers(gs, sid).map((d) => (d.id === replaced.id ? w.rookieId! : d.id));
    }
  }
  return seriesDrivers(gs, sid).map((d) => d.id);
}

export function gridForStage(gs: GameState, stage: Stage): string[] {
  const w = gs.weekend!;
  const sid = gs.playerSeries;
  if (stage === 'sprint') {
    const sq = w.results['sq'];
    if (sq) return sq.rows.map((r) => r.did);
    return w.qualiGrid;
  }
  if (stage === 'sprintRev') {
    const q = w.results['quali']?.rows ?? [];
    const top10 = q.slice(0, 10).map((r) => r.did).reverse();
    const rest = q.slice(10).map((r) => r.did);
    return [...top10, ...rest];
  }
  void sid;
  return w.qualiGrid;
}

/** Штрафы решётки: сдвиг вниз на N позиций. Если штраф больше оставшихся мест —
 *  пилот стартует последним; несколько таких выстраиваются по времени квалификации
 *  (лучшее время — выше). Старт с пит-лейна не применяется. */
export function applyGridPenalties(gs: GameState, w: Weekend, qualiOrder: string[]) {
  const grid = [...qualiOrder];
  const dropped: string[] = [];
  const penalized = Object.entries(w.pendingGrid)
    .filter(([did, p]) => p > 0 && grid.includes(did))
    .sort((a, b) => b[1] - a[1]);
  for (const [did, places] of penalized) {
    const idx = grid.indexOf(did);
    grid.splice(idx, 1);
    const to = idx + places;
    if (to >= grid.length) dropped.push(did);
    else grid.splice(to, 0, did);
  }
  // стартующие с конца — в порядке времени квалификации (лучший — выше)
  dropped.sort((a, b) => qualiOrder.indexOf(a) - qualiOrder.indexOf(b));
  grid.push(...dropped);
  void gs;
  return { grid, pitStart: [] as string[] };
}

/* -------- мгновенный (скип) расчёт сессий -------- */

function instantLap(gs: GameState, d: Driver, t: Team, c: Circuit, wet: boolean, mode: 'quali' | 'race'): number {
  const perf = carPerf(gs, t, c);
  const skill = driverSkill(d, mode, wet);
  const setup = driverSetup(gs, d.id);
  const noise = (1.4 - d.consistency / 100) * (mode === 'quali' ? 0.42 : 0.3) * (rnd() * 2 - 1);
  const wetPen = wet ? 9 + (100 - d.wet) * 0.06 : 0;
  return baseLap(c, t.seriesId) + 10.4 - perf * 0.085 - skill * 0.06
    + (d.teamId === gs.playerTeamId ? setupLapDelta(setup, c) : setupLapDelta(autoSetup(c), c)) + noise + wetPen;
}

function makeRow(pos: number, d: Driver, display: string, points = 0, best: string | null = null, note = ''): TableRow {
  return { pos, did: d.id, tid: d.teamId ?? '', display, points, best, note };
}

/** Совет гоночного инженера по настройкам */
export function setupAdvice(gs: GameState, c: Circuit, wet: boolean): string[] {
  const opt = autoSetup(c);
  const notes: string[] = [];
  const pt = playerTeam(gs);
  for (const d of raceDriversOfTeam(gs, pt.id)) {
    const s = driverSetup(gs, d.id);
    const diffs: [keyof Setup, number][] = [
      ['aero', opt.aero - s.aero], ['mech', opt.mech - s.mech], ['tires', opt.tires - s.tires],
    ];
    diffs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const [field, delta] = diffs[0];
    if (Math.abs(delta) < 8) {
      notes.push(`📻 ${d.code}: баланс хороший, можно атаковать`);
      continue;
    }
    const dir = delta > 0 ? 'больше' : 'меньше';
    const label = field === 'aero' ? 'прижима' : field === 'mech' ? 'мех. зацепа' : 'давления шин';
    notes.push(`📻 ${d.code}:建议${wet ? ' (дождь)' : ''} — добавьте ${dir} ${label} (${Math.round(Math.abs(delta))} пунктов)`);
  }
  return notes;
}

/** Пропуск сессии: мгновенный результат без трансляции */
export function skipSession(gs: GameState): SessionResult | null {
  const w = gs.weekend;
  if (!w) return null;
  const stage = w.stages[w.stageIdx];
  if (isRaceLikeStage(stage)) return null;
  const sid = gs.playerSeries;
  const c = circuitOfRound(gs, sid, w.roundIdx);
  const wet = w.weather[stage] === 'wet';
  const notes: string[] = [];
  notes.push('Сессия просимулирована (пропуск)');

  if (stage === 'quali' || stage === 'sq') {
    const f1KO = sid === 'f1';
    const laps = (d: Driver) => instantLap(gs, d, gs.teams[d.teamId!], c, wet, 'quali');
    const grid = sessionGridFor(gs, stage).map((id) => gs.drivers[id]);
    let order = grid.map((d) => ({ d, t: Math.min(laps(d), laps(d)) })).sort((a, b) => a.t - b.t);
    if (f1KO) {
      const q2 = order.slice(0, 15).map((r) => ({ d: r.d, t: Math.min(r.t, laps(r.d)) })).sort((a, b) => a.t - b.t);
      const q3 = q2.slice(0, 10).map((r) => ({ d: r.d, t: Math.min(r.t, laps(r.d)) })).sort((a, b) => a.t - b.t);
      order = [...q3, ...q2.slice(10), ...order.slice(15)];
      notes.push('Формат: Q1 → Q2 → Q3, по лучшему кругу');
    }
    const best = order[0].t;
    const meta = SERIES_META[sid];
    const rows = order.map((r, i) => makeRow(i + 1, r.d, i === 0 ? fmtLap(r.t) : fmtGap(r.t - best), 0, fmtLap(r.t)));
    if (stage === 'quali' && meta.polePoints > 0) {
      const pole = order[0].d;
      const ss = gs.series[sid];
      ss.dStand[pole.id] = (ss.dStand[pole.id] ?? 0) + meta.polePoints;
      if (pole.teamId) ss.tStand[pole.teamId] = (ss.tStand[pole.teamId] ?? 0) + meta.polePoints;
      notes.push(`${pole.name}: +${meta.polePoints} очк. за поул`);
    }
    if (stage === 'quali') {
      const res = applyGridPenalties(gs, w, order.map((r) => r.d.id));
      w.qualiGrid = res.grid;
      w.pitStart = res.pitStart;
      notes.push('Решётка сформирована с учётом штрафов');
    }
    const result: SessionResult = { stage, title: stageTitle(gs, stage), rows, notes };
    w.results[stage] = result;
    w.stageIdx++;
    return result;
  }

  // практика
  const grid = sessionGridFor(gs, stage).map((id) => gs.drivers[id]);
  const rows0 = grid.map((d) => ({ d, t: instantLap(gs, d, gs.teams[d.teamId!], c, wet, 'quali') + rnd() * 0.5 }));
  rows0.sort((a, b) => a.t - b.t);
  const best = rows0[0].t;
  const rows = rows0.map((r, i) => makeRow(i + 1, r.d, i === 0 ? fmtLap(r.t) : fmtGap(r.t - best), 0, fmtLap(r.t)));
  if (sid === 'f1' && stage === 'fp1' && w.rookieChoice != null && w.rookieChoice > 0 && w.rookieId) {
    const myDrivers = raceDriversOfTeam(gs, gs.playerTeamId);
    const replaced = myDrivers[w.rookieChoice - 1];
    const rk = gs.drivers[w.rookieId];
    if (replaced && rk) {
      gs.rookieUsed++;
      const pt = playerTeam(gs);
      pt.aero = clamp(pt.aero + 0.12, 0, 99);
      notes.push(`Правило новичков: ${rk.name} отработал FP1 вместо ${replaced.name} (${gs.rookieUsed}/4)`);
    }
  }
  const advice = setupAdvice(gs, c, wet);
  w.setupNotes = advice;
  notes.push(advice[0] ?? '');
  // лёгкое развитие от практики — только там, где разрешены апгрейды (не для серийных Ф2/Ф3)
  if (!SERIES_META[sid].specCar) {
    for (const t of Object.values(gs.teams)) if (t.seriesId === sid) t.base = clamp(t.base + 0.015, 0, 99);
  }
  const result: SessionResult = { stage, title: stageTitle(gs, stage), rows, notes };
  w.results[stage] = result;
  w.stageIdx++;
  return result;
}

/* ================= СИМУЛЯЦИЯ СЕССИЙ (практика / квалификация) ================= */

/** Программа работы в практике (как в F1 Manager): темп, длина серии, шины */
export type SessionProgram = 'quali' | 'race' | 'tires';

export interface SessionCar {
  did: string; tid: string; code: string; name: string; color: string; color2: string;
  isPlayer: boolean; nat: string;
  dist: number; targetLap: number; lapStartT: number; lapStartDist: number;
  lastLap: number | null; bestLap: number | null;
  segBest: Record<string, number>;
  state: 'garage' | 'flying' | 'elim' | 'done';
  phase2: 'out' | 'push' | 'in';
  pushed: number; runLen: number;
  exitAt: number;
  tire: string; tireAge: number; wear: number;
  perf: number; skill: number; cons: number;
  pos: number; status: 'run' | 'park'; pitting: boolean;
  eliminatedIn: string | null;
  // управление игроком
  manual: boolean; playerOut: boolean; boxNext: boolean; advice: string | null;
  setup: Setup;
  program: SessionProgram | null;  // выбранная программа работы
  stayBoxed: boolean;              // стоит в боксах, пока игрок не выпустит
  tireFlip: boolean;               // для теста шин: чередуем составы
  flagged: boolean;                // доехал последний круг после истечения времени (🏁 в таблице)
}

interface Segment { name: string; simClock: number; realMin: number; cutoff: number; cars?: string[]; duel?: boolean }

/** Реальные форматы сессий по сериям: FP / квалификация / спринт-квалификация */
/** Реальные форматы сессий. simClock — в тех же секундах, что и время круга (1 сим-сек = 1 сек),
 *  поэтому таймер в шапке согласован с тем, за сколько болиды проходят круг. */
function buildSegments(sid: SeriesId, kind: 'practice' | 'quali' | 'sq'): Segment[] {
  const f1 = sid === 'f1';
  const seg = (name: string, realMin: number, cutoff: number): Segment =>
    ({ name, simClock: realMin * 60, realMin, cutoff });
  if (kind === 'practice') {
    const min = f1 || sid === 'indy' ? 60 : sid === 'fe' ? 30 : 45;
    return [seg('FP', min, 0)];
  }
  if (kind === 'sq' && f1) {
    return [seg('SQ1', 12, 5), seg('SQ2', 10, 5), seg('SQ3', 8, 0)];
  }
  if (kind === 'quali' && f1) {
    return [seg('Q1', 18, 5), seg('Q2', 15, 5), seg('Q3', 12, 0)];
  }
  if (kind === 'quali' && sid === 'fe') {
    // Реальный формат Формулы Е: две группы по 12 минут, затем плей-офф дуэлей.
    // Составы дуэлей заполняются по ходу (после групп и каждой стадии).
    const duel = (name: string): Segment => ({ name, simClock: 3.5 * 60, realMin: 3.5, cutoff: 0, duel: true, cars: [] });
    return [
      seg('Группа A', 12, 0),
      seg('Группа B', 12, 0),
      duel('1/4 финала 1'), duel('1/4 финала 2'), duel('1/4 финала 3'), duel('1/4 финала 4'),
      duel('1/2 финала 1'), duel('1/2 финала 2'),
      duel('Финал'),
    ];
  }
  return [seg('QUALI', 30, 0)];
}

export class SessionSim {
  gs: GameState;
  kind: 'practice' | 'quali' | 'sq';
  circuit: Circuit;
  track: TrackGeo;
  wetSession: boolean;
  raining: boolean;
  cars: SessionCar[] = [];
  t = 0;
  clock: number;
  segments: Segment[];
  segIdx = 0;
  segment: string;
  done = false;
  clockExpired = false;      // время сегмента истекло — машины доезжают начатые круги
  awaitingConfirm = false;   // все круги доезжены — ждём подтверждения игрока
  events: { lap: number; text: string; kind: string }[] = [];
  playerSetup: Setup;
  /* --- Формула Е: дуэльная квалификация --- */
  duelWinners: Record<string, string> = {};   // имя дуэльного сегмента -> did победителя
  feGroupA: string[] = [];                    // did группы A (нечётные места в зачёте)
  feGroupB: string[] = [];                    // did группы B (чётные места в зачёте)

  constructor(gs: GameState, kind: 'practice' | 'quali' | 'sq', grid: string[], circuit: Circuit, wetSession: boolean, startTires?: Record<string, string>) {
    this.gs = gs;
    this.kind = kind;
    this.circuit = circuit;
    this.track = getTrack(circuit);
    this.wetSession = wetSession;
    this.raining = wetSession;
    const sid = gs.playerSeries;
    this.segments = buildSegments(sid, kind);
    this.segment = this.segments[0].name;
    this.clock = this.segments[0].simClock;
    this.playerSetup = { ...driverSetup(gs, grid.find((id) => gs.drivers[id]?.teamId === gs.playerTeamId) ?? '') };
    const aiSetup = autoSetup(circuit);
    grid.forEach((did, i) => {
      const d = gs.drivers[did];
      const isGuest = d.seriesId !== gs.playerSeries;
      const t = isGuest ? gs.teams[gs.playerTeamId] : gs.teams[d.teamId!];
      const isPlayer = t.id === gs.playerTeamId;
      const setup = isPlayer ? { ...driverSetup(gs, did) } : { ...aiSetup };
      this.cars.push({
        did, tid: t.id, code: d.code, name: d.name, color: t.color, color2: t.color2,
        isPlayer, nat: d.nat,
        dist: 0, targetLap: 0, lapStartT: 0, lapStartDist: 0,
        lastLap: null, bestLap: null, segBest: {},
        state: 'garage', phase2: 'out', pushed: 0,
        runLen: 4,
        exitAt: (0.03 + rnd() * 0.2) * this.segments[0].simClock + i * 3,
        tire: this.pickTire(), tireAge: 0, wear: 0,
        perf: carPerf(gs, t, circuit),
        skill: driverSkill(d, 'quali', wetSession),
        cons: d.consistency,
        pos: i + 1, status: 'park', pitting: false,
        eliminatedIn: null,
        manual: isPlayer, playerOut: false, boxNext: false, advice: null,
        setup,
        program: isPlayer && kind === 'practice' ? 'race' : null,
        stayBoxed: isPlayer, tireFlip: false,   // машины игрока ждут в боксах, выезд — вручную
        flagged: false,
      });
      const car = this.cars[this.cars.length - 1];
      car.runLen = this.planRunLen(car);
      // стартовый комплект, выбранный игроком (только на сухой трассе)
      if (!this.wetSession && isPlayer && startTires?.[did]) car.tire = startTires[did];
      if (this.wetSession) car.tire = sid === 'fe' ? 'AW' : 'I';
    });
    // Формула Е: делим пелотон на группы A/B по чётным/нечётным местам личного зачёта
    if (kind === 'quali' && sid === 'fe') {
      const ss = gs.series[sid];
      const rankedAll = [...this.cars].sort((a, b) => (ss.dStand[b.did] ?? 0) - (ss.dStand[a.did] ?? 0) || b.perf - a.perf);
      this.feGroupA = rankedAll.filter((_, i) => i % 2 === 0).map((c) => c.did);
      this.feGroupB = rankedAll.filter((_, i) => i % 2 === 1).map((c) => c.did);
      this.segments[0].cars = this.feGroupA;
      this.segments[1].cars = this.feGroupB;
      this.event(0, `Дуэльная квалификация: Группа A (${this.feGroupA.length}) и Группа B (${this.feGroupB.length})`);
    }
    this.event(0, kind === 'practice' ? 'Зелёный свет — практика началась' : `Зелёный свет — ${this.segment}`);
  }

  pickTire(): string {
    const sid = this.gs.playerSeries;
    if (this.kind === 'practice') {
      return sid === 'f1' ? pick(['M', 'S', 'H']) : sid === 'f2' ? pick(['O', 'P'])
        : sid === 'indy' ? pick(['ALT', 'PRIM']) : sid === 'f3' ? 'M' : 'AW';
    }
    return sid === 'f1' ? 'S' : sid === 'indy' ? 'ALT' : sid === 'f3' ? 'M' : sid === 'fe' ? 'AW' : 'O';
  }

  planRunLen(car?: SessionCar): number {
    if (this.kind !== 'practice') return 2 + Math.floor(rnd() * 2); // квалификация: 2–3 круга
    const prog = car?.program ?? null;
    if (prog === 'quali') return 2 + Math.floor(rnd() * 2);   // короткие атакующие серии
    if (prog === 'race') return 7 + Math.floor(rnd() * 4);    // длинные гоночные отрезки
    if (prog === 'tires') return 4 + Math.floor(rnd() * 2);   // средние серии для теста шин
    return 3 + Math.floor(rnd() * 4);
  }

  event(lap: number, text: string) {
    this.events.push({ lap, text, kind: 'info' });
    if (this.events.length > 90) this.events.shift();
  }

  sessionLap(car: SessionCar): number {
    const c = this.circuit;
    const cd = compoundDef(this.gs.playerSeries, car.tire);
    const noise = (1.4 - car.cons / 100) * 0.4 * (rnd() * 2 - 1);
    const wetPen = this.raining ? 9 + (100 - car.cons) * 0.03 : 0;
    const setupD = car.isPlayer ? setupLapDelta(car.setup, c) : 0; // ИИ уже «оптимален»
    // просадка темпа по мере износа: мягкая до 60%, прогрессирующая после
    const w = car.wear / 100;
    const wearPen = w <= 0.6 ? w * 1.6 : 0.96 + (w - 0.6) * 3.4;
    return baseLap(c, this.gs.playerSeries) + 10.4 - car.perf * 0.085 - car.skill * 0.06
      + cd.offset + wearPen + noise + wetPen + setupD;
  }

  /** Износ за круг в сессиях (%): в практиках резину берегут, в квалификации — атакуют */
  wearPerLap(car: SessionCar): number {
    const cd = compoundDef(this.gs.playerSeries, car.tire);
    const base = 100 / cd.life;
    const attack = car.program === 'quali' || this.kind !== 'practice' ? 1.15 : car.program === 'race' ? 1.0 : 0.85;
    return base * 0.62 * attack;
  }

  tick(dt: number) {
    if (this.done || this.awaitingConfirm) return;
    this.t += dt;
    if (!this.clockExpired) {
      this.clock -= dt;
      if (this.clock <= 0) {
        this.clock = 0;
        this.clockExpired = true;
        this.event(0, '⏱ Время истекло — машины доезжают начатые круги, новых выездов нет');
      }
    }
    const seg0 = this.segments[this.segIdx].simClock;
    const curSeg = this.segments[this.segIdx];
    const segCars = curSeg.cars;
    const isDuel = !!curSeg.duel;
    for (const car of this.cars) {
      if (car.state === 'elim' || car.state === 'done') { car.status = 'park'; continue; }
      // Формула Е: в каждом сегменте (группа/дуэль) едут только отведённые ему машины
      if (segCars && !segCars.includes(car.did)) { car.status = 'park'; continue; }
      if (car.state === 'garage') {
        car.status = 'park';
        if (this.clockExpired) continue; // после истечения времени новых выездов нет
        // в дуэли едут все автоматически и ровно один раз (повторный выезд после круга запрещён);
        // иначе игрок — вручную, ИИ — по таймеру
        const mayExit = isDuel
          ? (car.segBest[curSeg.name] == null && this.t >= car.exitAt)
          : (car.manual ? car.playerOut : this.t >= car.exitAt);
        if (mayExit && this.clock > seg0 * 0.05) {
          car.state = 'flying';
          car.phase2 = 'out';
          car.pushed = 0;
          car.boxNext = false;
          car.playerOut = false;
          car.runLen = isDuel ? 1 : car.runLen;   // дуэль = ровно 1 быстрый круг
          car.dist = -((car.pos % 5) * 12) - 6;
          car.lapStartT = this.t;
          car.lapStartDist = car.dist;
          car.targetLap = this.sessionLap(car);
          car.status = 'run';
          if (car.manual && !isDuel) this.event(0, `${car.code} выезжает из боксов`);
        }
        continue;
      }
      car.status = 'run';
      const idx = this.pointIndex(car.dist);
      const f = this.track.factor[idx] / this.track.avgFactor;
      car.dist += (this.track.total / car.targetLap) * f * dt;
      while (car.dist - car.lapStartDist >= this.track.total) this.cross(car);
    }
    const onTrack = this.cars.filter((c) => c.state === 'flying').sort((a, b) => b.dist - a.dist);
    onTrack.forEach((c, i) => { c.pos = i + 1; });

    // Формула Е: дуэль завершена, как только оба пилота проехали свой круг и вернулись —
    // переходим дальше сразу, не дожидаясь конца отведённого времени.
    // Если это последняя дуэль (Финал) — сессия окончена, ждём подтверждения игрока.
    if (isDuel && segCars && segCars.length === 2) {
      const duelists = segCars.map((id) => this.cars.find((c) => c.did === id)).filter(Boolean) as SessionCar[];
      const allDone = duelists.length === 2 && duelists.every((c) => c.segBest[curSeg.name] != null && c.state !== 'flying');
      if (allDone) {
        if (this.segIdx >= this.segments.length - 1) {
          this.awaitingConfirm = true;
          this.event(0, '🏁 Финал завершён — подтвердите результаты квалификации');
        } else {
          this.advanceSegment();
        }
        return;
      }
    }

    // время истекло: когда все машины доехали и вернулись в боксы —
    // либо переходим в следующий сегмент (квал), либо ждём подтверждения игрока
    if (this.clockExpired) {
      const flying = this.cars.some((c) => c.state === 'flying');
      if (!flying) {
        if (this.segIdx < this.segments.length - 1) {
          this.advanceSegment();
        } else {
          this.awaitingConfirm = true;
          this.event(0, '🏁 Все машины в боксах — подтвердите завершение сессии');
        }
      }
    }
  }

  pointIndex(dist: number): number {
    const N = this.track.pts.length;
    const d = ((dist % this.track.total) + this.track.total) % this.track.total;
    let lo = 0, hi = this.track.cum.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.track.cum[mid] <= d) lo = mid; else hi = mid - 1; }
    return lo % N;
  }

  cross(car: SessionCar) {
    car.lapStartDist += this.track.total;
    let lapTime = this.t - car.lapStartT;
    car.lapStartT = this.t;
    if (car.phase2 === 'out') {
      lapTime += 4 + rnd() * 2;
      car.phase2 = this.clockExpired ? 'in' : 'push'; // после времени — сразу в боксы
      car.pushed = 0;
    } else if (car.phase2 === 'push') {
      this.recordLap(car, lapTime);
      car.pushed++;
      car.tireAge++;
      car.wear += this.wearPerLap(car);
      if (car.pushed >= car.runLen || car.boxNext || this.clockExpired) car.phase2 = 'in';
    } else {
      lapTime += 5 + rnd() * 2;
      if (this.clockExpired) {
        // доехал последний круг после истечения времени — сессия для него закончена
        car.state = 'done';
        car.status = 'park';
        car.flagged = true;
        car.boxNext = false;
        car.playerOut = false;
        if (car.manual && this.kind === 'practice') { car.advice = this.makeAdvice(car); this.event(0, car.advice); }
        return;
      }
      car.state = 'garage';
      car.status = 'park';
      const dwell = this.kind === 'practice' ? 30 + rnd() * 50 : 20 + rnd() * 40;
      car.exitAt = this.t + dwell;
      car.phase2 = 'out';
      car.pushed = 0;
      car.boxNext = false;
      car.stayBoxed = car.manual;                    // машина игрока ждёт следующей команды
      car.playerOut = false;
      car.runLen = this.planRunLen(car);
      if (car.manual && this.kind === 'practice') {
        car.advice = this.makeAdvice(car);
        this.event(0, car.advice);
      }
      if (this.kind === 'practice') this.serviceTires(car);
      return;
    }
    car.lastLap = lapTime;
    car.targetLap = this.sessionLap(car);
  }

  /** Совет пилота после серии кругов — на основе телеметрии настроек */
  /** Совет пилота: чем больше кругов он проехал (tireAge), тем детальнее анализ (1–3 пункта) */
  makeAdvice(car: SessionCar): string {
    const c = this.circuit;
    const opt = autoSetup(c);
    const raw: [keyof Setup, number, string][] = [
      ['aero', opt.aero - car.setup.aero, 'прижим'],
      ['mech', opt.mech - car.setup.mech, 'мех. зацеп'],
      ['tires', opt.tires - car.setup.tires, 'давление шин'],
      ['brake', opt.brake - car.setup.brake, 'торм. баланс'],
      ['diff', opt.diff - car.setup.diff, 'дифференциал'],
    ];
    const deltas = raw.filter((x) => Math.abs(x[1]) >= 6);
    deltas.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    // количество пунктов совета зависит от наката: 1 пункт с 1 круга, +1 за каждые 4 круга, до 3
    const n = clamp(1 + Math.floor(car.tireAge / 4), 1, 3);
    const parts = deltas.slice(0, n).map(([, delta, label]) =>
      `${delta > 0 ? 'добавить' : 'убавить'} ${label} на ~${Math.round(Math.abs(delta))}`);
    if (!parts.length) return `📻 ${car.code}: баланс отличный, машина едет сама`;
    const extra = car.tireAge > compoundDef(this.gs.playerSeries, car.tire).life * 0.6 ? ' · резина устаёт — нужен свежий комплект' : '';
    return `📻 ${car.code}: ${parts.join('; ')}${extra}`;
  }

  /** Обслуживание шин в боксах по выбранной программе */
  serviceTires(car: SessionCar) {
    const sid = this.gs.playerSeries;
    if (sid === 'fe') return; // всесезонные шины — без замен
    if (this.raining) { car.tire = 'I'; car.tireAge = 0; car.wear = 0; return; }
    const dry = dryCompounds(sid);
    const soft = dry[0]?.id ?? car.tire;
    const med = dry.length > 1 ? dry[1].id : soft;
    const wear = car.wear / 100;
    let next: string | null = null;
    if (!car.manual && rnd() < 0.35) {
      next = dry[Math.floor(rnd() * dry.length)].id;   // ИИ сам тасует составы
    }
    if (next && next !== car.tire) {
      this.event(0, `${car.code} сменил шины: ${tireName(sid, car.tire)} → ${tireName(sid, next)}`);
      car.tire = next;
      car.tireAge = 0; car.wear = 0;
    } else if (car.tireAge > 0 && wear > 0.5) {
      car.tireAge = 0; car.wear = 0; // свежий комплект того же состава
    }
  }

  recordLap(car: SessionCar, lapTime: number) {
    car.lastLap = lapTime;
    const seg = this.segment;
    if (car.segBest[seg] == null || lapTime < car.segBest[seg]) car.segBest[seg] = lapTime;
    if (car.bestLap == null || lapTime < car.bestLap) car.bestLap = lapTime;
  }

  ranked(): SessionCar[] {
    const segs = this.segments.slice(0, this.segIdx + 1).map((s) => s.name);
    const key = (c: SessionCar) => {
      for (let i = segs.length - 1; i >= 0; i--) {
        const v = c.segBest[segs[i]];
        if (v != null) return v;
      }
      return c.bestLap ?? 1e9;
    };
    return [...this.cars].sort((a, b) => {
      if (a.state === 'elim' && b.state !== 'elim') return 1;
      if (b.state === 'elim' && a.state !== 'elim') return -1;
      return key(a) - key(b);
    });
  }

  /** Завершить сегмент (отсев в квал) и перейти к следующему. Вызывается, когда все доездили. */
  advanceSegment() {
    const seg = this.segments[this.segIdx];
    // --- Формула Е: фиксация результата дуэли ---
    if (seg.duel && seg.cars && seg.cars.length === 2) {
      const [aId, bId] = seg.cars;
      const a = this.cars.find((c) => c.did === aId);
      const b = this.cars.find((c) => c.did === bId);
      const ta = a?.segBest[seg.name] ?? Infinity;
      const tb = b?.segBest[seg.name] ?? Infinity;
      const winner = ta <= tb ? a : b;
      if (winner) {
        this.duelWinners[seg.name] = winner.did;
        const loser = winner === a ? b : a;
        this.event(0, `⚔ ${seg.name}: ${winner.code} быстрее ${loser?.code ?? '—'} (${fmtLap(ta === Infinity ? tb : ta)}) — проходит дальше`);
      }
    }
    // --- Формула Е: после групп формируем четвертьфиналы (1–4, 2–3 внутри группы) ---
    if (seg.name === 'Группа B') this.fillFeQuarterfinals();
    // --- Формула Е: заполняем следующую дуэль, когда известны оба победителя её источников ---
    this.fillFeNextDuel(seg.name);

    if (seg.cutoff > 0) {
      const ranked = this.ranked().filter((c) => c.state !== 'elim');
      const out = ranked.slice(ranked.length - seg.cutoff);
      for (const car of out) { car.state = 'elim'; car.eliminatedIn = seg.name; car.status = 'park'; }
      this.event(0, `${seg.name} завершён — выбывают: ${out.map((c) => c.code).join(', ')}`);
    } else if (!seg.duel) {
      this.event(0, `${seg.name} завершён`);
    }
    this.segIdx++;
    const next = this.segments[this.segIdx];
    this.segment = next.name;
    this.clock = next.simClock;
    this.clockExpired = false;
    const nextIsDuel = !!next.duel;
    for (const car of this.cars) {
      if (car.state === 'elim' || car.state === 'done') continue;
      car.state = 'garage';
      // в дуэли участники стартуют почти сразу; в группах/квале — как обычно
      const inNextDuel = nextIsDuel && next.cars?.includes(car.did);
      car.exitAt = this.t + (inNextDuel ? (2 + rnd() * 6) : (car.manual ? 0 : (0.04 + rnd() * 0.2) * next.simClock));
      delete car.segBest[next.name];
      if (car.manual) { car.stayBoxed = true; car.playerOut = false; car.boxNext = false; }
    }
    this.event(0, `Зелёный свет — ${next.name}`);
  }

  /** Формула Е: топ-4 каждой группы → четвертьфиналы (1v4, 2v3). */
  fillFeQuarterfinals() {
    const top4 = (group: string[], groupName: string): SessionCar[] =>
      group
        .map((id) => this.cars.find((c) => c.did === id))
        .filter((c): c is SessionCar => !!c)
        .sort((a, b) => (a.segBest[groupName] ?? 1e9) - (b.segBest[groupName] ?? 1e9))
        .slice(0, 4);
    const A = top4(this.feGroupA, 'Группа A');
    const B = top4(this.feGroupB, 'Группа B');
    const byName = (name: string) => this.segments.find((s) => s.name === name);
    const set = (name: string, a?: SessionCar, b?: SessionCar) => {
      const s = byName(name);
      if (s && a && b) s.cars = [a.did, b.did];
    };
    set('1/4 финала 1', A[0], A[3]);
    set('1/4 финала 2', A[1], A[2]);
    set('1/4 финала 3', B[0], B[3]);
    set('1/4 финала 4', B[1], B[2]);
    this.event(0, `Топ-4 групп вышли в 1/4 финала: ${[...A, ...B].map((c) => c.code).join(', ')}`);
  }

  /** Формула Е: когда известны победители обеих дуэлей-источников, заполняем целевую дуэль. */
  fillFeNextDuel(justFinished: string) {
    const FEED: Record<string, [string, string]> = {
      '1/2 финала 1': ['1/4 финала 1', '1/4 финала 2'],
      '1/2 финала 2': ['1/4 финала 3', '1/4 финала 4'],
      'Финал': ['1/2 финала 1', '1/2 финала 2'],
    };
    for (const [target, feeders] of Object.entries(FEED)) {
      if (!feeders.includes(justFinished)) continue;
      const w1 = this.duelWinners[feeders[0]];
      const w2 = this.duelWinners[feeders[1]];
      if (w1 && w2) {
        const s = this.segments.find((x) => x.name === target);
        if (s) s.cars = [w1, w2];
      }
    }
  }

  /** Игрок подтвердил завершение сессии (после того как все доездили последние круги) */
  finishSession() {
    this.awaitingConfirm = false;
    this.done = true;
    this.event(0, '🏁 Клетчатый флаг — сессия окончена');
  }

  displayClock(): string {
    if (this.clockExpired) return '0:00';
    const seg = this.segments[Math.min(this.segIdx, this.segments.length - 1)];
    const frac = Math.max(0, this.clock / seg.simClock);
    const secs = Math.ceil(frac * seg.realMin * 60);
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  /** Быстро досимулировать сессию до конца (для кнопки «Завершить сессию») */
  fastForward() {
    let guard = 0;
    while (!this.done && !this.awaitingConfirm && guard < 20000) {
      this.tick(1.5);
      guard++;
    }
  }

  /* ---- управление игроком ---- */

  sendOut(did: string) {
    const car = this.cars.find((c) => c.did === did);
    if (!car || !car.manual || car.state !== 'garage') return;
    car.stayBoxed = false;
    car.playerOut = true;
  }

  boxCarIn(did: string) {
    const car = this.cars.find((c) => c.did === did);
    if (!car || !car.manual || car.state !== 'flying' || car.phase2 !== 'push') return;
    car.boxNext = true;
    this.event(0, `BOX, ${car.code}, box — заезд в боксы после круга`);
  }

  setRunLen(did: string, n: number) {
    const car = this.cars.find((c) => c.did === did);
    if (car && car.manual) car.runLen = clamp(n, 1, 12);
  }

  /** Выбор программы работы (как в F1 Manager). Действует со следующего выезда */
  setProgram(did: string, prog: SessionProgram) {
    const car = this.cars.find((c) => c.did === did);
    if (!car || !car.manual || this.kind !== 'practice') return;
    car.program = prog;
    car.runLen = this.planRunLen(car);
    car.stayBoxed = false;
    car.playerOut = false;
    const names: Record<SessionProgram, string> = { quali: 'квалификационный темп', race: 'гоночная симуляция', tires: 'тест шин' };
    this.event(0, `${car.code}: программа — ${names[prog]}`);
  }

  /** Выбор комплекта на серию (из боксов). В практике и квалификации — решает игрок */
  setSessionTire(did: string, tireId: string) {
    const car = this.cars.find((c) => c.did === did);
    if (!car || !car.manual || car.state !== 'garage') return;
    this.event(0, `${car.code}: ставим ${tireName(this.gs.playerSeries, tireId)}`);
    car.tire = tireId;
    car.tireAge = 0;
    car.wear = 0;
  }

  /** Настройки крутятся только в практике (парк-ферме с начала квалификации) */
  setSetupField(gs: GameState, did: string, field: keyof Setup, value: number) {
    if (this.kind !== 'practice') return;
    const car = this.cars.find((c) => c.did === did);
    if (!car) return;
    car.setup[field] = clamp(value, 0, 100);
    this.playerSetup[field] = car.setup[field];
    setDriverSetup(gs, did, field, value);
  }

  /** Формула Е: проигравший в дуэли и его время круга. */
  private loserOf(segName: string): { loser?: SessionCar; time: number } {
    const seg = this.segments.find((s) => s.name === segName);
    if (!seg?.cars || seg.cars.length !== 2) return { time: Infinity };
    const winner = this.duelWinners[segName];
    const loserId = seg.cars.find((id) => id !== winner);
    const loser = this.cars.find((c) => c.did === loserId);
    return { loser, time: loser?.segBest[segName] ?? Infinity };
  }

  /** Формула Е: итоговый порядок стартовой решётки по результатам дуэлей.
   *  P1 — победитель финала, P2 — проигравший финал;
   *  P3–P4 — проигравшие в полуфиналах (по времени); P5–P8 — проигравшие в 1/4 (по времени);
   *  далее — не прошедшие: группа победителя финала занимает нечётные места (9,11,13…),
   *  вторая группа — чётные (10,12,14…), внутри — по времени в группе. */
  buildFEQualiOrder(): string[] {
    const order: string[] = [];
    const finalSeg = this.segments.find((s) => s.name === 'Финал');
    const finalWinner = this.duelWinners['Финал'];
    const finalLoserId = finalSeg?.cars?.find((id) => id !== finalWinner);
    if (finalWinner) order.push(finalWinner);
    if (finalLoserId) order.push(finalLoserId);

    const sfLosers = ['1/2 финала 1', '1/2 финала 2'].map((n) => this.loserOf(n)).filter((x) => x.loser);
    sfLosers.sort((a, b) => a.time - b.time);
    for (const x of sfLosers) order.push(x.loser!.did);

    const qfLosers = ['1/4 финала 1', '1/4 финала 2', '1/4 финала 3', '1/4 финала 4'].map((n) => this.loserOf(n)).filter((x) => x.loser);
    qfLosers.sort((a, b) => a.time - b.time);
    for (const x of qfLosers) order.push(x.loser!.did);

    const qualified = new Set(order);
    const winnerGroupIsA = this.feGroupA.includes(finalWinner ?? '');
    const oddGroup = winnerGroupIsA ? this.feGroupA : this.feGroupB;   // нечётные места (9,11,13…)
    const evenGroup = winnerGroupIsA ? this.feGroupB : this.feGroupA;  // чётные места (10,12,14…)
    const groupTime = (c: SessionCar) => c.segBest['Группа A'] ?? c.segBest['Группа B'] ?? 1e9;
    const rest = (g: string[]) => g
      .map((id) => this.cars.find((c) => c.did === id))
      .filter((c): c is SessionCar => !!c && !qualified.has(c.did))
      .sort((a, b) => groupTime(a) - groupTime(b));
    const odds = rest(oddGroup);
    const evens = rest(evenGroup);
    for (let i = 0; i < Math.max(odds.length, evens.length); i++) {
      if (odds[i]) order.push(odds[i].did);
      if (evens[i]) order.push(evens[i].did);
    }
    return order;
  }

  /** Формула Е: самая глубокая стадия пилота и его время на ней (для протокола). */
  feDriverResult(did: string): { label: string; time: number | null } {
    const car = this.cars.find((c) => c.did === did);
    if (!car) return { label: '—', time: null };
    const duels = ['Финал', '1/2 финала 1', '1/2 финала 2', '1/4 финала 1', '1/4 финала 2', '1/4 финала 3', '1/4 финала 4'];
    for (const name of duels) {
      const seg = this.segments.find((s) => s.name === name);
      if (seg?.cars?.includes(did) && car.segBest[name] != null) {
        const won = this.duelWinners[name] === did;
        return { label: `${won ? 'победа' : 'поражение'} · ${name}`, time: car.segBest[name] };
      }
    }
    const group = this.feGroupA.includes(did) ? 'Группа A' : this.feGroupB.includes(did) ? 'Группа B' : null;
    if (group) return { label: group, time: car.segBest[group] ?? null };
    return { label: '—', time: car.bestLap };
  }
}

export function makeSessionSim(gs: GameState, kind: 'practice' | 'quali' | 'sq', grid: string[], circuit: Circuit, wet: boolean, startTires?: Record<string, string>): SessionSim {
  return new SessionSim(gs, kind, grid, circuit, wet, startTires);
}

function sessionRows(sim: SessionSim): TableRow[] {
  const ranked = sim.ranked();
  const best = ranked[0]?.bestLap ?? 0;
  return ranked.map((car, i) => {
    const note = car.state === 'elim' ? `выбыл в ${car.eliminatedIn}` : car.bestLap == null ? 'без времени' : '';
    return {
      pos: i + 1, did: car.did, tid: car.tid,
      display: car.bestLap == null ? '—' : (i === 0 ? fmtLap(car.bestLap) : fmtGap(car.bestLap - best)),
      best: car.bestLap != null ? fmtLap(car.bestLap) : null,
      points: 0, note,
    };
  });
}

function applyPracticeSim(gs: GameState, sim: SessionSim, stage: Stage) {
  const w = gs.weekend!;
  const notes: string[] = [];
  const rows = sessionRows(sim);
  if (gs.playerSeries === 'f1' && stage === 'fp1' && w.rookieChoice != null && w.rookieChoice > 0 && w.rookieId) {
    const myDrivers = raceDriversOfTeam(gs, gs.playerTeamId);
    const replaced = myDrivers[w.rookieChoice - 1];
    const rk = gs.drivers[w.rookieId];
    if (replaced && rk) {
      gs.rookieUsed++;
      const pt = playerTeam(gs);
      pt.aero = clamp(pt.aero + 0.12, 0, 99);
      notes.push(`Правило новичков: ${rk.name} отработал FP1 вместо ${replaced.name} (${gs.rookieUsed}/4 за сезон)`);
      notes.push('Собраны данные для аэропрограммы (+0.12 к аэродинамике)');
    }
  }
  // лёгкое развитие от практики — только там, где разрешены апгрейды (не для серийных Ф2/Ф3)
  if (!SERIES_META[gs.playerSeries].specCar) {
    for (const t of Object.values(gs.teams)) if (t.seriesId === gs.playerSeries) t.base = clamp(t.base + 0.015, 0, 99);
  }
  if (sim.wetSession) notes.push('Мокрая трасса: собраны данные по дождевым настройкам');
  const advice = setupAdvice(gs, sim.circuit, sim.wetSession);
  w.setupNotes = advice;
  if (advice[0]) notes.push(advice[0]);
  // сохраняем последние советы пилотов — они остаются доступными после сессии (п.5)
  gs.lastAdvice = gs.lastAdvice ?? {};
  for (const car of sim.cars) if (car.isPlayer && car.advice) gs.lastAdvice[car.did] = car.advice.replace(/^📻\s*/, '');
  w.results[stage] = { stage, title: stageTitle(gs, stage), rows, notes };
  w.stageIdx++;
}

function applyQualiSim(gs: GameState, sim: SessionSim, stage: Stage) {
  const w = gs.weekend!;
  const sid = gs.playerSeries;
  const ss = gs.series[sid];
  const meta = SERIES_META[sid];
  const rows = sessionRows(sim);
  const notes: string[] = [];
  // для ФЕ порядок определяется дуэлями, для остальных — лучшим кругом
  const baseOrder = stage === 'quali' && sid === 'fe' ? sim.buildFEQualiOrder() : rows.map((r) => r.did);
  if (sid === 'f1') notes.push('Формат: Q1 (−5) → Q2 (−5) → Q3 — по лучшему кругу. Парк-ферме действует с начала сессии');
  else if (sid === 'fe' && stage === 'quali') notes.push('Дуэльная квалификация: группы A/B, 1/4, 1/2 и финал');
  else notes.push('Зачёт по лучшему кругу сессии');
  if (stage === 'quali' && meta.polePoints > 0 && baseOrder[0]) {
    const pole = gs.drivers[baseOrder[0]];
    ss.dStand[pole.id] = (ss.dStand[pole.id] ?? 0) + meta.polePoints;
    if (pole.teamId) ss.tStand[pole.teamId] = (ss.tStand[pole.teamId] ?? 0) + meta.polePoints;
    notes.push(`${pole.name}: +${meta.polePoints} очк. за поул`);
  }
  if (stage === 'quali') {
    const order = baseOrder.filter((id, i) => baseOrder.indexOf(id) === i);
    const res = applyGridPenalties(gs, w, order);
    w.qualiGrid = res.grid;
    w.pitStart = res.pitStart;
    // пометки о штрафах в протокол
    for (const [did, places] of Object.entries(w.pendingGrid)) {
      if (places <= 0) continue;
      const d = gs.drivers[did];
      if (!d) continue;
      notes.push(`⊞ ${d.name}: −${places} поз. на стартовой решётке`);
    }
    if (sid === 'fe') notes.push('Решётка — по итогам дуэлей: победитель финала на поуле, проигравшие — по временам');
    notes.push('Стартовая решётка сформирована с учётом штрафов за СУ и инциденты');
    // протокол ФЕ перестраиваем в порядке решётки; время — из самой глубокой стадии
    let feRows: TableRow[] = rows;
    if (sid === 'fe') {
      feRows = [];
      order.forEach((id, i) => {
        const base = rows.find((r) => r.did === id);
        if (!base) return;
        const info = sim.feDriverResult(id);
        feRows.push({
          pos: i + 1, did: base.did, tid: base.tid,
          display: info.time != null ? fmtLap(info.time) : base.display,
          points: 0,
          best: info.time != null ? fmtLap(info.time) : base.best ?? null,
          note: info.label,
        });
      });
    }
    w.results[stage] = { stage, title: stageTitle(gs, stage), rows: feRows, notes };
  } else {
    w.results[stage] = { stage, title: 'Спринт-квалификация', rows, notes };
  }
  w.stageIdx++;
}

/* ================= ГОНОЧНАЯ СИМУЛЯЦИЯ ================= */

export type SimKind = 'race' | 'sprint' | 'sprintRev';

/** Отрезок стратегии: машина едет на составе `tire` с круга startLap до endLap.
 *  Если endLap < totalLaps — на круге endLap происходит ПИТ-СТОП (переход к следующему отрезку).
 *  isFinish=true — последний отрезок, едем до финиша без пита.
 *  План детерминирован и строится ОДИН раз; события его переносят/заменяют, но не дублируют. */
export interface TireLeg {
  tire: string;
  startLap: number;
  endLap: number;
  isFinish: boolean;
}

export interface SimCar {
  did: string; tid: string; code: string; name: string; color: string; color2: string;
  isPlayer: boolean; nat: string;
  lap: number; dist: number; targetLap: number; lapStartT: number; lapStartDist: number;
  lastLap: number | null; bestLap: number | null;
  tire: string; tireAge: number; wear: number; fuel: number; damage: number;
  noiseState: number; // сглаженный шум темпа (случайное блуждание) — плавные отрывы
  eqDist: number;     // «эквивалентный пробег» со средней скоростью (без осцилляций f) — для стабильных отрывов
  status: 'run' | 'out' | 'fin'; outReason: string; finishT: number;
  legs: TireLeg[]; legIdx: number; pitting: boolean;  // единый детерминированный план
  pendingTire: string | null;
  pendingPitLap: number | null;  // единственный запланированный пит (игрок/событие); приоритет над планом
  pitCrawl: number; pitLap: boolean;   // ползёт по пит-лейну; флаг «круг с питом» (не в зачёт лучшего)
  pitCount: number;                    // сколько пит-стопов совершил (для тайминг-тауэра)
  penQueue: number[];
  drs: boolean; pos: number; gap: number; interval: number;
  skill: number; perf: number; cons: number; mode: StrategyPreset;
  setup: Setup; qualiSeg: string;
  finished: boolean;
  fuelMode: 'eco' | 'normal' | 'push';
  letThrough: boolean; letThroughLaps: number;
  style: number;                        // индивидуальная агрессивность ИИ 0..1
  usedTires: string[];                  // составы, на которых машина ехала (для правила двух составов)
  dsq: boolean;                         // дисквалифицирован (нарушение правила двух составов)
  redParked: boolean;                   // стоит в боксах под красным флагом
  scPitUsed: boolean;                   // уже воспользовался бесплатным питом под SC (один раз)
  finishSeq: number;                    // порядковый номер пересечения финишной черты (для стабильного порядка)
  /* --- Формула Е: энергия и режим атаки --- */
  isFE: boolean;                        // машина Формулы Е (энергия вместо топлива, без износа шин)
  attackUsed: boolean;                  // режим атаки берётся строго 1 раз за гонку
  attackUntil: number;                  // момент окончания режима атаки (sim t); 0 = не активен
  pendingTimeLoss: number;              // разовая потеря времени (активация атаки = 2 с)
  attackPlannedLap: number;             // круг, на котором ИИ планирует активировать атаку
}

export interface SimEvent { lap: number; text: string; kind: 'info' | 'sc' | 'red' | 'pit' | 'crash' | 'flag' }

/** ИИ варьирует топливные режимы: зависит от стратегии, позиции и случая — у всех по-разному */
function aiFuelMode(mode: StrategyPreset, gridPos: number): 'eco' | 'normal' | 'push' {
  // задние ряды чаще рискуют, лидеры берегут технику
  const backBias = gridPos > 12 ? 0.25 : gridPos <= 3 ? -0.2 : 0;
  const r = rnd() + backBias;
  if (mode === 'aggr') return r < 0.8 ? 'push' : 'normal';
  if (mode === 'cons') return r < 0.75 ? 'eco' : 'normal';
  return r < 0.3 ? 'push' : r < 0.55 ? 'eco' : 'normal';
}

export class RaceSim {
  gs: GameState;
  cars: SimCar[] = [];
  t = 0;
  phase: 'green' | 'sc' | 'vsc' | 'red' | 'cheq' = 'green';
  phaseEndLap = 0;
  redRemaining = 0;   // секунды реального времени до рестарта под красным флагом
  raining: boolean;
  rainAt: number;
  events: SimEvent[] = [];
  done = false;
  totalLaps: number;
  circuit: Circuit;
  track: TrackGeo;
  kind: SimKind;
  degMod: number;
  wetSession: boolean;
  leaderDone = false; // лидер финишировал — остальные доезжают свои круги
  finishSeqCounter = 0; // монотонный счётчик порядка пересечения финиша
  // Физическая машина безопасности: выезжает с пит-лейна, ЖДЁТ лидера, затем ведёт пелотон,
  // а на рестарте уезжает в боксы. state: 'waiting' — едет медленно впереди, пока лидер не догонит;
  // 'leading' — подобрала лидера, пелотон собирается.
  sc: { active: boolean; leaving: boolean; dist: number; exitTarget: number; state: 'waiting' | 'leading' } | null = null;
  scLastLapMsg = false; // объявлено ли «возобновление на следующем круге»

  constructor(gs: GameState, kind: SimKind, grid: string[], totalLaps: number, circuit: Circuit, wetSession: boolean, rainMidRace: boolean, startOverrides?: Record<string, string>) {
    this.gs = gs;
    this.kind = kind;
    this.totalLaps = totalLaps;
    this.circuit = circuit;
    this.track = getTrack(circuit);
    this.wetSession = wetSession;
    this.raining = wetSession;
    this.rainAt = !wetSession && kind === 'race' && rainMidRace ? Math.floor(totalLaps * (0.3 + rnd() * 0.35)) : -1;
    this.degMod = gs.mods.degMod;
    grid.forEach((did, i) => {
      const d = gs.drivers[did];
      const t = gs.teams[d.teamId!];
      const perf = carPerf(gs, t, circuit);
      const skill = driverSkill(d, 'race', wetSession);
      const style = clamp((100 - d.consistency) / 100 * 0.6 + (d.racecraft / 100) * 0.4 + rnd() * 0.25, 0, 1);
      const strat = this.buildStrategy(d, t, style, i, startOverrides?.[did]);
      const car: SimCar = {
        did, tid: t.id, code: d.code, name: d.name, color: t.color, color2: t.color2,
        isPlayer: t.id === gs.playerTeamId, nat: d.nat,
        lap: 0, dist: -i * 14 - (i % 2) * 7, targetLap: 0, lapStartT: 0, lapStartDist: -i * 14,
        lastLap: null, bestLap: null,
        // Формула Е: поле fuel = заряд энергии (все стартуют со 100%). Остальные — топливо в кг.
        tire: strat.startTire, tireAge: 0, wear: 0,
        fuel: gs.playerSeries === 'fe' ? 100 : Math.round(totalLaps * fuelBurnFor(strat.fuelMode) * 1.12),
        damage: 0,
        noiseState: 0,
        eqDist: -i * 14 - (i % 2) * 7, // стартует с тем же разбросом, что и dist
        status: 'run', outReason: '', finishT: 0,
        legs: strat.legs, legIdx: 0, pitting: false,
        pendingTire: null, pendingPitLap: null, pitCrawl: 0, pitLap: false, pitCount: 0,
        penQueue: [], drs: false, pos: i + 1, gap: 0, interval: 0,
        skill, perf, cons: d.consistency,
        mode: strat.mode,
        setup: strat.setup, qualiSeg: 'Q1',
        finished: false,
        fuelMode: strat.fuelMode,
        letThrough: false, letThroughLaps: 0,
        style,
        usedTires: [strat.startTire],
        dsq: false,
        redParked: false,
        scPitUsed: false,
        finishSeq: 0,
        isFE: gs.playerSeries === 'fe',
        attackUsed: false,
        attackUntil: 0,
        pendingTimeLoss: 0,
        // ИИ планирует активацию атаки в середине гонки (разброс, чтобы не все разом)
        attackPlannedLap: Math.max(2, Math.floor(totalLaps * (0.3 + rnd() * 0.35))),
      };
      car.targetLap = this.lapEstimate(car, true);
      this.cars.push(car);
    });
    this.event(0, wetSession ? 'Старт с места под дождём — все на дождевых шинах' : 'Огни погасли — гонка началась!', 'flag');
    if (this.rainAt > 0) this.events.push({ lap: this.rainAt, text: 'Синоптики: дождь ожидается в середине дистанции', kind: 'info' });
  }

  /* ============ ЕДИНАЯ ДЕТЕРМИНИРОВАННАЯ СИСТЕМА СТРАТЕГИЙ ============
   * План шин — это массив отрезков (legs), который строится ОДИН раз перед стартом.
   * Пит-стоп = переход между отрезками, он привязан к структуре плана, а не к списку
   * кругов, который можно случайно пополнить. События (SC, дождь, прокол, игрок)
   * ПЕРЕНОСЯТ или ПЕРЕСТРАИВАЮТ план целиком, но никогда не добавляют второй пит.
   * Износ за круг — константа внутри отрезка (режимы фиксированы), поэтому прогноз точен. */

  /** Износ за круг для ПЛАНА (константа на отрезок: состав/трасса/режимы фиксированы). */
  /** Износ за круг в долях life. Одинаков для всех машин при равных условиях —
   *  никаких скрытых индивидуальных множителей. */
  planWearRate(t: Team, mode: StrategyPreset, fuelMode: 'eco' | 'normal' | 'push', setup: Setup): number {
    const modeF = mode === 'aggr' ? 1.3 : mode === 'cons' ? 0.75 : 1;
    const fuelF = fuelMode === 'push' ? 1.2 : fuelMode === 'eco' ? 0.8 : 1;
    const degF = 0.55 + this.circuit.deg * 0.65;
    const f2F = this.gs.playerSeries === 'f2' ? 0.9 : 1; // в Ф2 резина изнашивается на 10% медленнее
    return degF * this.degMod * modeF * fuelF * tireCareFactor(this.gs, t.id) * setupWearMult(setup) * f2F;
  }

  /** Безопасная длина отрезка: кругов до 72% износа (запас до зоны прокола 80%). */
  safeLife(tireId: string, wearRate: number): number {
    const life = compoundDef(this.gs.playerSeries, tireId).life;
    return Math.max(3, Math.floor((life * 0.72) / wearRate));
  }

  /** Максимум для ФИНАЛЬНОГО отрезка: до 79% износа (вплотную к проколу, но безопасно). */
  finishLimit(tireId: string, wearRate: number): number {
    const life = compoundDef(this.gs.playerSeries, tireId).life;
    return Math.max(3, Math.floor((life * 0.79) / wearRate));
  }

  /** Следующий состав: самый мягкий, отличный от текущего и покрывающий остаток дистанции. */
  nextTire(dry: { id: string }[], prev: string, remaining: number, wearRate: number): string {
    for (const c of dry) if (c.id !== prev && this.finishLimit(c.id, wearRate) >= remaining) return c.id;
    // ни один «другой» не покрывает остаток — берём самый живучий
    let best = dry[dry.length - 1].id, bestLife = -1;
    for (const c of dry) { const l = this.finishLimit(c.id, wearRate); if (l > bestLife) { bestLife = l; best = c.id; } }
    return best;
  }

  /** Жадное построение плана: питаемся только когда остаток нельзя доехать в лимите износа.
   *  Число питов получается естественным и минимально необходимым — лишних не бывает. */
  buildLegs(dry: { id: string }[], start: string, laps: number, wearRate: number, maxStops: number): TireLeg[] {
    const legs: TireLeg[] = [];
    let lap = 0, tire = start, stops = 0;
    while (lap < laps) {
      const remaining = laps - lap;
      if (remaining <= this.finishLimit(tire, wearRate)) {
        legs.push({ tire, startLap: lap, endLap: laps, isFinish: true });
        lap = laps;
      } else if (stops >= maxStops) {
        // лимит питов исчерпан — доезжаем на самом живучем составе
        tire = this.nextTire(dry, '__none__', remaining, wearRate);
        legs.push({ tire, startLap: lap, endLap: laps, isFinish: true });
        lap = laps;
      } else {
        const end = lap + this.safeLife(tire, wearRate);
        legs.push({ tire, startLap: lap, endLap: end, isFinish: false });
        lap = end;
        stops++;
        tire = this.nextTire(dry, tire, laps - lap, wearRate);
      }
    }
    return legs;
  }

  /** План с ЗАДАННЫМ числом пит-стопов: дистанция делится на (stops+1) отрезков,
   *  каждому подбирается подходящий состав. Используется для перебора кандидатов. */
  buildLegsFixed(start: string, laps: number, wearRate: number, stops: number, dry: { id: string }[]): TireLeg[] {
    const segs = stops + 1;
    const legs: TireLeg[] = [];
    let lap = 0, tire = start;
    for (let i = 0; i < segs; i++) {
      const remaining = laps - lap;
      const isLast = i === segs - 1;
      let len: number;
      if (isLast) len = remaining;
      else {
        const target = Math.ceil(remaining / (segs - i));
        len = clamp(target, 3, remaining - 3 * (segs - i - 1));
        len = Math.min(len, this.safeLife(tire, wearRate));
      }
      // если отрезок не вмещается в ресурс состава — берём самый живучий, который покроет
      if (len > this.finishLimit(tire, wearRate)) {
        let hard = tire, hl = -1;
        for (const c of dry) { const fl = this.finishLimit(c.id, wearRate); if (fl > hl) { hl = fl; hard = c.id; } }
        if (hl >= len) tire = hard;
      }
      legs.push({ tire, startLap: lap, endLap: lap + len, isFinish: isLast });
      lap += len;
      if (!isLast) tire = this.nextTire(dry, tire, laps - lap, wearRate);
    }
    return legs;
  }

  /** Стартовый состав по режиму: агрессивный — мягкий, консервативный — жёсткий. */
  pickStartTire(dry: { id: string }[], mode: StrategyPreset): string {
    if (mode === 'aggr') return dry[0].id;
    if (mode === 'cons') return dry[dry.length - 1].id;
    return dry[Math.floor(dry.length / 2)].id;
  }

  /** Состав для гонки БЕЗ пит-стопов: самый мягкий, который доедет до финиша с износом <79%
   *  (не войдёт в зону проколов). Если ни один не хватает — самый живучий. */
  noStopTire(dry: { id: string }[], laps: number, wearRate: number): string {
    for (const c of dry) if (this.finishLimit(c.id, wearRate) >= laps) return c.id;
    return dry[dry.length - 1].id;
  }

  /** Построить полную стратегию машины (режим + план отрезков). Вызывается ОДИН раз.
   *  Износ одинаков для всех при равных условиях; разнообразие стратегий — из логического
   *  выбора между разумными вариантами (составы × число питов), направленного режимом и позицией. */
  buildStrategy(d: Driver, t: Team, style: number, gridPos: number, startOverride?: string) {
    const sid = this.gs.playerSeries;
    const laps = this.totalLaps;
    const isPlayer = t.id === this.gs.playerTeamId;
    const isSprint = this.kind !== 'race';
    const rainTire = sid === 'fe' ? 'AW' : 'I';

    const mode: StrategyPreset = isPlayer
      ? this.gs.strategy[d.id] ?? 'balanced'
      : style > 0.66 ? 'aggr' : style < 0.33 ? 'cons' : 'balanced';
    const fuelMode: 'eco' | 'normal' | 'push' = isPlayer ? 'normal' : aiFuelMode(mode, gridPos);
    const setup = isPlayer ? { ...driverSetup(this.gs, d.id) } : autoSetup(this.circuit);
    const wearRate = this.planWearRate(t, mode, fuelMode, setup);

    // Дождь: один комплект дождевых до финища (питы — только по событию)
    if (this.wetSession) {
      return { mode, fuelMode, setup, legs: [{ tire: rainTire, startLap: 0, endLap: laps, isFinish: true }], startTire: rainTire };
    }

    // Игрок: плановых питов нет — решает сам; один длинный отрезок
    if (isPlayer) {
      const start = startOverride ?? defaultStartTire(sid);
      return { mode, fuelMode, setup, legs: [{ tire: start, startLap: 0, endLap: laps, isFinish: true }], startTire: start };
    }

    const dry = dryCompounds(sid); // мягкий → жёсткий

    // Спринты, Ф3 и ФЕ — без пит-стопов: один отрезок до финища.
    // Состав подбирается так, чтобы доехать без пита и с износом <80% (без риска прокола).
    if (isSprint || sid === 'f3' || sid === 'fe') {
      const start = startOverride ?? this.noStopTire(dry, laps, wearRate);
      return { mode, fuelMode, setup, legs: [{ tire: start, startLap: 0, endLap: laps, isFinish: true }], startTire: start };
    }

    const start = startOverride ?? this.pickStartTire(dry, mode);

    // Овалы Индикара: регулярные заезды под топливо
    if (sid === 'indy' && this.circuit.kind === 'oval') {
      const stopEvery = Math.max(8, this.safeLife('ALT', wearRate) - Math.round(rnd() * 5));
      const legs: TireLeg[] = [];
      let lap = 0;
      while (lap < laps) {
        const end = Math.min(lap + stopEvery, laps);
        const tire = lap === 0 ? start : (rnd() < 0.7 ? 'ALT' : 'PRIM');
        legs.push({ tire, startLap: lap, endLap: end, isFinish: end >= laps });
        lap = end;
      }
      return { mode, fuelMode, setup, legs, startTire: legs[0].tire };
    }

    // Ф1, Ф2, Индикара-роуд: ИИ выбирает лучшую стратегию из набора разумных кандидатов.
    // Разнообразие — не из случая, а из логики: режим пилота ограничивает стартовые составы
    // и число питов, а стартовая позиция направляет выбор (лидеры берегут track position —
    // меньше стопов, задние рискуют ради undercut'а).
    const posStopAdj = gridPos <= 3 ? 2.2 : gridPos >= 12 ? -1.8 : 0; // сек. «цены» каждого стопа
    const pitBase = sid === 'f1' ? 21.5 : 34;                         // средняя потеря на пит-стопе
    const stopOpts = mode === 'aggr' ? [2, 3] : mode === 'cons' ? [1] : [1, 2];
    const startOpts = (mode === 'aggr' ? dry.slice(0, Math.min(2, dry.length))
      : mode === 'cons' ? dry.slice(Math.max(0, dry.length - 2)) : dry).map((c) => c.id);

    // оценка суммарного времени стратегии: темп на каждом отрезке + потери на пит-стопы
    const legTime = (tireId: string, len: number) => {
      const cd = compoundDef(sid, tireId);
      // cd.offset — скорость состава; второе слагаемое — средняя просадка от износа за отрезок
      return len * (cd.offset + 1.7 * (wearRate * len) / cd.life);
    };
    const estTotal = (cand: TireLeg[]) => {
      let sum = 0;
      for (const l of cand) sum += legTime(l.tire, l.endLap - l.startLap);
      return sum + (cand.length - 1) * (pitBase + posStopAdj);
    };
    // стратегия безопасна, если НИ ОДИН отрезок не изнашивает шину выше зоны проколов
    const planSafe = (cand: TireLeg[]) =>
      cand.every((l) => (l.endLap - l.startLap) <= this.finishLimit(l.tire, wearRate));

    let legs: TireLeg[] = [];
    let bestEst = Infinity;
    for (const st of startOpts) {
      for (const n of stopOpts) {
        const cand = this.mergeLegs(this.buildLegsFixed(st, laps, wearRate, n, dry));
        if (!planSafe(cand)) continue; // переизнашивает резину (риск прокола) — не рассматриваем
        const e = estTotal(cand);
        if (e < bestEst) { bestEst = e; legs = cand; }
      }
    }
    if (!legs.length) legs = this.mergeLegs(this.buildLegs(dry, start, laps, wearRate, 3));

    // ПРАВИЛО ДВУХ СОСТАВОВ (сухие гонки Ф1/Ф2): гарантируем >=2 разных состава,
    // добавляя МИНИМАЛЬНО возможное число пит-стопов (а не расковыривая план).
    if ((sid === 'f1' || sid === 'f2') && this.kind === 'race') {
      let guard = 0;
      while (new Set(legs.map((l) => l.tire)).size < 2 && guard < 4) {
        guard++;
        if (legs.length === 1) {
          // один отрезок — вставляем ровно один пит, разбивая дистанцию на два разных состава
          const leg = legs[0];
          const len = leg.endLap - leg.startLap;
          // перебираем стартовый состав (сначала исходный) и второй состав
          const t1order = [leg.tire, ...dry.map((c) => c.id).filter((id) => id !== leg.tire)];
          let done = false;
          for (const t1 of t1order) {
            if (done) break;
            for (const c of dry) {
              if (c.id === t1 || done) continue;
              const maxX = this.finishLimit(t1, wearRate);             // t1 выдержит 1-й отрезок
              const minX = len - this.finishLimit(c.id, wearRate);     // t2 должен покрыть остаток
              if (maxX >= 3 && minX < maxX) {
                const X = leg.startLap + clamp(Math.max(3, Math.round(len * 0.5)), Math.max(3, minX), maxX);
                legs = [
                  { tire: t1, startLap: leg.startLap, endLap: X, isFinish: false },
                  { tire: c.id, startLap: X, endLap: leg.endLap, isFinish: true },
                ];
                done = true;
              }
            }
          }
          if (!done) break; // физически невозможно — оставляем (риск ДСК)
        } else {
          // несколько отрезков одного состава — заменяем ОДИН (самый короткий) на другой состав
          const order = legs.map((_, i) => i).sort((a, b) =>
            (legs[a].endLap - legs[a].startLap) - (legs[b].endLap - legs[b].startLap));
          let replaced = false;
          for (const i of order) {
            if (replaced) break;
            const leg = legs[i];
            const len = leg.endLap - leg.startLap;
            for (const c of dry) {
              if (c.id === leg.tire) continue;
              const lim = leg.isFinish ? this.finishLimit(c.id, wearRate) : this.safeLife(c.id, wearRate);
              if (lim >= len) { legs[i] = { ...leg, tire: c.id }; replaced = true; break; }
            }
          }
          if (!replaced) break;
        }
        legs = this.mergeLegs(legs);
      }
    }
    return { mode, fuelMode, setup, legs, startTire: legs[0].tire };
  }

  /** Слить соседние отрезки одного состава (убирает бессмысленные питы между ними). */
  mergeLegs(legs: TireLeg[]): TireLeg[] {
    const out: TireLeg[] = [];
    for (const l of legs) {
      const prev = out[out.length - 1];
      if (prev && prev.tire === l.tire) { prev.endLap = l.endLap; prev.isFinish = l.isFinish; }
      else out.push({ ...l });
    }
    return out;
  }

  // (старый makePlan удалён — вся логика стратегий теперь в buildStrategy/buildLegs)
  event(lap: number, text: string, kind: SimEvent['kind']) {
    this.events.push({ lap, text, kind });
    if (this.events.length > 90) this.events.shift();
  }

  /** Фактический износ за круг = плановый (режимы зафиксированы на отрезок) × нейтралитет.
   *  Совпадает с planWearRate, поэтому прогноз плана точен. Под SC/VSC резину берегут. */
  wearPerLap(car: SimCar): number {
    if (car.isFE) return 0; // Формула Е: единая резина без износа
    const neutralF = this.phase === 'sc' || this.phase === 'vsc' ? 0.3 : 1;
    return this.planWearRate(this.gs.teams[car.tid], car.mode, car.fuelMode, car.setup) * neutralF;
  }

  /** Прокол с растущей вероятностью: 80% износа — 1%, дальше +~5 п.п. за процент, на 100% — гарантирован */
  punctureChance(wearPct: number): number {
    if (wearPct < 80) return 0;
    return Math.min(100, 1 + (wearPct - 80) * 4.95);
  }

  /** Динамическая просадка темпа по мере износа: заметная уже с 40%, резкий «обрыв» после 60% */
  tirePenalty(car: SimCar): number {
    const cd = compoundDef(this.gs.playerSeries, car.tire);
    const frac = car.wear / cd.life; // 0..1+
    let p = cd.offset + frac * 3.8;                 // до ~3.8 с на полном ресурсе
    p += Math.max(0, frac - 0.5) * 6;               // клифф: после 50% резина «плывёт» всё быстрее
    return p;
  }

  lapEstimate(car: SimCar, first = false): number {
    const c = this.circuit;
    const tire = this.tirePenalty(car);
    const modePen = car.mode === 'aggr' ? -0.38 : car.mode === 'cons' ? 0.3 : 0;
    const fuelPen = car.fuelMode === 'push' ? -0.3 : car.fuelMode === 'eco' ? 0.3 : 0;
    const orderPen = car.letThrough ? 0.9 : 0;
    // сглаженный шум: случайное блуждание с возвратом — темп меняется плавно, отрывы не «скачут»
    const noise = (1.4 - car.cons / 100) * 0.34 * car.noiseState;
    let lap = baseLap(c, this.gs.playerSeries) + 10.4 - car.perf * 0.085 - car.skill * 0.06
      + tire + (car.isFE ? 0 : car.fuel * 0.033) + car.damage * 0.03 + modePen + fuelPen + orderPen + noise
      + setupLapDelta(car.setup, c);
    if (car.isFE) {
      // Формула Е: экономия = 98% темпа стандарта, режим атаки = на 3% быстрее
      if (car.fuelMode === 'eco') lap /= 0.98;
      if (this.t < car.attackUntil) lap /= 1.03;
    }
    if (this.raining) {
      const rainOk = ['I', 'W', 'AW'].includes(car.tire);
      lap += rainOk ? 1.2 : 7.5;
    }
    // DRS даёт время только на прямых (drs-сегментах трассы)
    if (!first && car.drs && this.track.drsSegs[this.pointIndex(car.dist)]) {
      lap -= 0.55 * c.ovrt * this.gs.mods.drsMod;
    }
    return Math.max(lap, baseLap(c, this.gs.playerSeries) * 0.8);
  }

  /** Доля износа 0..1+ для отображения и решений ИИ */
  wearFrac(car: SimCar): number {
    return car.wear / compoundDef(this.gs.playerSeries, car.tire).life;
  }

  /** Формула Е: расход энергии за круг (%). База рассчитана так, что чистый «стандарт»
   *  расходует ~98% за гонку; экономия = 98% от базы, режим атаки = +3% в своё окно. */
  energyPerLap(car: SimCar): number {
    const base = 100 / (this.totalLaps * 1.02);
    let burn = base * (car.fuelMode === 'eco' ? 0.98 : 1);
    if (this.t < car.attackUntil) burn *= 1.03;
    return burn;
  }

  /** Ф1: 18–25 с под зелёными; остальные серии 30–40 с; под SC/VSC — вдвое меньше */
  pitLoss(car: SimCar): number {
    const mech = this.gs.teams[car.tid].staffIds[2];
    const mechSkill = mech ? this.gs.staff[mech]?.skill ?? 70 : 70;
    const sid = this.gs.playerSeries;
    const min = sid === 'f1' ? 18 : 30;
    const max = sid === 'f1' ? 25 : 40;
    const skillPen = (100 - mechSkill) / 100;
    const green = min + (max - min) * clamp(rnd() * 0.55 + skillPen * 0.9, 0, 1.15);
    if (this.phase === 'sc' || this.phase === 'vsc') return green * 0.5;
    return green;
  }

  leader(): SimCar {
    let best: SimCar | null = null;
    for (const car of this.cars) if (car.status === 'run') if (!best || car.dist > best.dist) best = car;
    return best ?? this.cars[0];
  }

  tick(dt: number) {
    if (this.done) return;
    if (this.phase === 'red') {
      // Все машины в боксах, гонка стоит. Отсчёт идёт в tickRedFlag (реальное время),
      // поэтому красный флаг завершится гарантированно — даже если трансляция на паузе.
      this.t += dt;
      return;
    }
    this.t += dt;
    const lead = this.leader();

    // Машина безопасности после рестарта разгоняется и уезжает на пит-лейн
    if (this.sc && this.sc.leaving) {
      const sIdx = this.pointIndex(this.sc.dist);
      const sF = this.track.factor[sIdx] / this.track.avgFactor;
      this.sc.dist += (this.track.total / lead.targetLap) * sF * 1.15 * dt;
      if (this.sc.dist >= this.sc.exitTarget) {
        this.sc = null;
        this.event(lead.lap, 'Машина безопасности в боксах — свободная гонка', 'sc');
      }
    }

    if (this.phase === 'sc' || this.phase === 'vsc') {
      // Машина безопасности: темп на 30% ниже боевого, пелотон сбивается максимально плотно.
      // Машины в боксах НЕ участвуют в построении — они стоят и не сбивают позиции остальных.
      const gap = this.phase === 'sc' ? 12 : 45;   // дистанция между машинами, м
      const crawlCap = this.track.total / lead.targetLap;
      const catchMul = this.phase === 'sc' ? 0.97 : 0.75;
      // 1) машины в боксах: просто стоят и отсчитывают время пит-стопа
      for (const car of this.cars) {
        if (car.status !== 'run') continue;
        if (car.pitCrawl > 0 || car.pitting) {
          car.pitCrawl -= dt;
          if (car.pitCrawl <= 0) this.leavePit(car);
        }
      }
      // 2) физическая машина безопасности: едет медленно, пока лидер её не догонит ('waiting'),
      //    затем ведёт пелотон ('leading')
      const scLead = this.sc && this.sc.active && !this.sc.leaving;
      if (scLead) {
        const sIdx = this.pointIndex(this.sc!.dist);
        const sF = this.track.factor[sIdx] / this.track.avgFactor;
        // в 'waiting' SC почти стоит у выезда из боксов, в 'leading' — ведёт пелотон
        const scSpeedMul = this.sc!.state === 'waiting' ? 0.06 : 0.72;
        this.sc!.dist += crawlCap * sF * scSpeedMul * dt;
        // лидер доехал до машины безопасности — она «подобрала» его, начинается сбор пелотона
        if (this.sc!.state === 'waiting' && this.sc!.dist - lead.dist <= 25) {
          this.sc!.state = 'leading';
          this.phaseEndLap = lead.lap + 3 + Math.floor(rnd() * 2); // минимум 3 круга — с момента поимки
          this.event(lead.lap, '🚔 Машина безопасности подобрала лидера — пелотон собирается', 'sc');
        }
      }
      const bunching = scLead && this.sc!.state === 'leading';
      // 3) пелотон: при 'waiting' — просто сбавляют темп (жёлтые флаги), при 'leading' — плотно за SC
      const onTrack = this.runningSorted().filter((c) => c.pitCrawl <= 0 && !c.pitting);
      let prevDist = -1e9;
      for (let rank = 0; rank < onTrack.length; rank++) {
        const car = onTrack[rank];
        if (!car.isPlayer && car.fuelMode !== 'eco') car.fuelMode = 'eco'; // под SC берегут топливо
        const idx = this.pointIndex(car.dist);
        const f = this.track.factor[idx] / this.track.avgFactor;
        // лидер следует за машиной безопасности; остальные — за впереди идущим
        const target = (rank === 0 && bunching) ? this.sc!.dist - 20 : (rank === 0 || !bunching ? Infinity : prevDist - gap);
        let speed = (this.track.total / car.targetLap) * f * (bunching ? 0.7 : 0.78); // −30% / −22% к темпу
        if (car.dist < target) {
          const need = target - car.dist;
          speed = Math.max(speed, Math.min(need / dt, crawlCap * f * catchMul));
        }
        const prevD = car.dist;
        car.dist += speed * dt;
        if (car.dist > target) car.dist = target;
        car.eqDist += car.dist - prevD; // под SC пелотон сбивается — зеркалим реальную дельту
        prevDist = car.dist;
        while (car.dist - car.lapStartDist >= this.track.total) this.cross(car);
      }
    } else {
      const phaseMod = this.phase === 'cheq' ? 0 : 1;
      for (const car of this.cars) {
        if (car.status !== 'run' || this.phase === 'cheq') continue;
        // машина в боксах: стоит на месте, пока не отсчитается время пит-стопа
        if (car.pitCrawl > 0 || car.pitting) {
          car.pitCrawl -= dt;
          if (car.pitCrawl <= 0) this.leavePit(car);
          continue;
        }
        const idx = this.pointIndex(car.dist);
        const f = this.track.factor[idx] / this.track.avgFactor;
        const speed = (this.track.total / car.targetLap) * f * phaseMod;
        car.dist += speed * dt;
        car.eqDist += (this.track.total / car.targetLap) * dt; // средняя скорость — без осцилляций f
        while (car.dist - car.lapStartDist >= this.track.total) this.cross(car);
      }
    }
    if (this.phase === 'sc' || this.phase === 'vsc') {
      // последний круг под нейтрализацией — предупреждаем о возобновлении
      if (lead.lap === this.phaseEndLap - 1 && !this.scLastLapMsg) {
        this.scLastLapMsg = true;
        this.event(lead.lap, this.phase === 'sc'
          ? '🚔 SC IN THIS LAP — гонка возобновится на следующем круге'
          : '⚠ VSC заканчивается — возобновление на следующем круге', 'sc');
      }
      if (lead.lap >= this.phaseEndLap) {
        if (this.phase === 'sc' && this.sc) {
          this.sc.leaving = true;                       // машина безопасности уходит на пит-лейн
          this.sc.exitTarget = lead.dist + 140;
          this.event(lead.lap, '🏁 Рестарт! Машина безопасности свернула на пит-лейн', 'flag');
        } else {
          this.event(lead.lap, 'Конец VSC — гонка возобновлена', 'flag');
        }
        this.phase = 'green';
        for (const car of this.cars) if (car.status === 'run') car.targetLap = this.lapEstimate(car);
      }
    }
    this.computeStandings();
    // лидер финишировал: ждём, пока все остальные машины реально пересекут финиш
    if (this.leaderDone && !this.cars.some((c) => c.status === 'run')) {
      this.done = true;
      this.event(this.totalLaps, '🏁 Клетчатый флаг — все машины финишировали', 'flag');
    }
  }

  pointIndex(dist: number): number {
    const N = this.track.pts.length;
    const d = ((dist % this.track.total) + this.track.total) % this.track.total;
    let lo = 0, hi = this.track.cum.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.track.cum[mid] <= d) lo = mid; else hi = mid - 1; }
    return lo % N;
  }

  runningSorted(): SimCar[] {
    return this.cars.filter((c) => c.status === 'run' && !c.redParked).sort((a, b) => b.dist - a.dist);
  }

  computeStandings() {
    const inPit = (c: SimCar) => c.status === 'run' && (c.pitting || c.pitCrawl > 0);
    // Машина в боксах стоит на месте (dist заморожен) — соперники обходят её по одному,
    // поэтому в таблице она ОПУСКАЕТСЯ ПЛАВНО, а не падает вниз и не телепортируется обратно.
    const sorted = [...this.cars].sort((a, b) => {
      if (a.status === 'fin' && b.status === 'fin') return a.finishSeq - b.finishSeq;
      if (a.status === 'fin') return -1;
      if (b.status === 'fin') return 1;
      if (a.status === 'out' && b.status === 'out') return b.dist - a.dist;
      if (a.status === 'out') return 1;
      if (b.status === 'out') return -1;
      return b.dist - a.dist;
    });
    const lead = sorted.find((c) => c.status === 'run');
    const leaderSpeed = lead ? this.track.total / lead.targetLap : 60;
    const drsSeries = this.gs.playerSeries === 'f2' || this.gs.playerSeries === 'f3';
    sorted.forEach((car, i) => {
      car.pos = i + 1;
      if (lead && car.status === 'run') {
        // Отрывы считаем по eqDist (средняя скорость каждой машины) — они НЕ скачут
        // от мгновенного положения на трассе (прямая/поворот), а плавно отражают чистый темп.
        const carSpeed = this.track.total / car.targetLap;
        if (inPit(car)) {
          // машина в боксах: отставание = текущее время простоя (реалистично, без аномалий)
          car.gap = Math.max(0, (lead.eqDist - car.eqDist) / carSpeed);
          car.interval = car.gap;
        } else {
          car.gap = car === lead ? 0 : Math.max(0, (lead.eqDist - car.eqDist) / carSpeed);
          const ahead = sorted[i - 1];
          car.interval = ahead && ahead.status === 'run' && !inPit(ahead) ? Math.max(0, (ahead.eqDist - car.eqDist) / carSpeed) : car.gap;
        }
        // защита от аномально больших отставаний (не более 2 кругов)
        const maxGap = (this.track.total * 2) / leaderSpeed;
        car.gap = Math.min(car.gap, maxGap);
        car.interval = Math.min(car.interval, maxGap);
        // DRS: только Ф2/Ф3, со 2-го круга, при отставании менее секунды, только по сухому
        car.drs = drsSeries && !this.raining && !inPit(car) && car.lap >= 1 && car.interval < 1.0 && this.phase === 'green';
      } else {
        car.drs = false;
      }
    });
  }

  /** Выезд из боксов: машина возвращается на трассу и продолжает со своей дистанции.
   *  Отставание накоплено естественно (пока стояла — пелотон уехал), аномалии ограничены в computeStandings. */
  leavePit(car: SimCar) {
    car.pitting = false;
    car.pitCrawl = 0;
    car.targetLap = this.lapEstimate(car);
    this.event(car.lap, `${car.code} возвращается на трассу`, 'pit');
  }

  /** Круг ближайшего пита (если есть): pendingPitLap (игрок/событие) имеет приоритет над планом.
   *  ВАЖНО: >= (не >) — триггер в cross() проверяется ПОСЛЕ инкремента круга, поэтому
   *  круг пита всегда равен car.lap в момент срабатывания. */
  nextPitLap(car: SimCar): number | null {
    if (car.pendingPitLap != null && car.pendingPitLap >= car.lap) return car.pendingPitLap;
    const leg = car.legs[car.legIdx];
    if (leg && !leg.isFinish && leg.endLap >= car.lap) return leg.endLap;
    return null;
  }

  /** Начало пит-стопа — ЕДИНСТВЕННАЯ точка, где происходит пит. Меняет шины и перестраивает план. */
  beginPit(car: SimCar) {
    car.pitting = true;
    car.pitLap = true; // текущий круг — «грязный» (не в зачёт лучшего)
    car.pitCrawl = this.pitLoss(car);
    const planNext = car.legs[car.legIdx + 1]?.tire;
    const nextTire = this.raining
      ? (car.pendingTire ?? (car.tire === 'AW' ? 'AW' : 'I'))
      : (car.pendingTire ?? planNext ?? car.tire);
    car.pendingTire = null;
    car.pendingPitLap = null;
    const servedPen = car.penQueue.reduce((s, p) => s + p, 0);
    if (servedPen > 0) { car.pitCrawl += servedPen; this.event(car.lap, `${car.code}: отбыт штраф ${servedPen} с на пит-стопе`, 'pit'); car.penQueue = []; }
    this.event(car.lap, `${car.code} свернул на пит-лейн: ${tireName(this.gs.playerSeries, car.tire)} → ${tireName(this.gs.playerSeries, nextTire)} (~${car.pitCrawl.toFixed(0)} с)`, 'pit');
    car.tire = nextTire;
    car.tireAge = 0;
    car.wear = 0;
    car.pitCount++;
    if (!car.usedTires.includes(nextTire)) car.usedTires.push(nextTire);
    this.advancePlan(car);
  }

  /** Перестроить остаток плана после пита: от следующего круга, на текущем составе. */
  advancePlan(car: SimCar) {
    const cur = car.legs[car.legIdx];
    if (cur) { cur.endLap = car.lap + 1; cur.isFinish = false; }
    const fromLap = car.lap + 1;
    const remaining = this.totalLaps - fromLap;
    // Машины игрока питаются только вручную — остаток всегда один отрезок до финиша
    if (car.isPlayer || remaining <= 0) {
      car.legs = car.legs.slice(0, car.legIdx + 1);
      car.legs.push({ tire: car.tire, startLap: fromLap, endLap: this.totalLaps, isFinish: true });
      car.legIdx++;
      return;
    }
    const wearRate = this.planWearRate(this.gs.teams[car.tid], car.mode, car.fuelMode, car.setup);
    const dry = dryCompounds(this.gs.playerSeries);
    const tail = this.buildLegs(dry, car.tire, remaining, wearRate, Math.max(0, 3 - car.pitCount));
    for (const l of tail) { l.startLap += fromLap; l.endLap += fromLap; }
    car.legs = [...car.legs.slice(0, car.legIdx + 1), ...tail];
    car.legIdx++;
  }

  cross(car: SimCar) {
    car.lapStartDist += this.track.total;
    let lapTime = this.t - car.lapStartT;
    // разовая потеря времени (активация режима атаки в Формуле Е)
    if (car.pendingTimeLoss > 0) { lapTime += car.pendingTimeLoss; car.pendingTimeLoss = 0; }
    car.lapStartT = this.t;
    car.lap++;
    car.lastLap = lapTime;
    // круг, в который вошёл простой пит-стопа, не идёт в зачёт лучшего
    if (this.phase === 'green' && !car.pitLap && (car.bestLap == null || lapTime < car.bestLap)) car.bestLap = lapTime;
    car.pitLap = false;
    // прокол: 80% износа — 1%, дальше ~+5 п.п. за процент, на 100% — гарантирован
    const wearPct = this.wearFrac(car) * 100;
    const pP = this.punctureChance(wearPct);
    if (pP > 0 && rnd() * 100 < pP) {
      this.event(car.lap, `💥 ${car.code}: прокол на износе ${Math.round(wearPct)}%!`, 'crash');
      return this.retire(car, `Прокол (износ ${Math.round(wearPct)}%)`);
    }
    if (car.lap >= this.totalLaps) {
      car.status = 'fin';
      car.finished = true;
      car.finishT = this.t;
      car.finishSeq = ++this.finishSeqCounter; // фиксируем точный порядок пересечения линии
      car.dist = this.track.total * car.lap;
      const sortedFin = this.cars.filter((c) => c.status === 'fin').sort((a, b) => a.finishSeq - b.finishSeq);
      if (sortedFin[0] === car) {
        this.event(car.lap, `🏁 ${car.code} — ${car.name} выигрывает! Остальные доезжают круги`, 'flag');
        this.leaderDone = true;
      }
      return;
    }
    if (this.rainAt > 0 && car.lap >= this.rainAt && !this.raining && car.pos === 1) {
      this.raining = true;
      this.event(car.lap, '☔ НАЧАЛСЯ ДОЖДЬ! Все за промежуточными', 'info');
      for (const c2 of this.cars) if (c2.status === 'run' && !['I', 'W', 'AW'].includes(c2.tire)) {
        // дождевой заезд: единственный pending-пит на следующем круге (заменяет план, не дублирует)
        c2.pendingPitLap = car.lap + 1;
        c2.pendingTire = this.gs.playerSeries === 'fe' ? 'AW' : 'I';
      }
    }
    this.rollIncidents(car);
    this.aiDecide(car);
    // машина свернула в боксы: комплект свежий (0%), топливо и износ за этот круг не тратятся
    if (this.nextPitLap(car) === car.lap) { this.beginPit(car); return; }
    if (car.isFE) {
      car.fuel = Math.max(0, car.fuel - this.energyPerLap(car));
      if (car.fuel <= 0) return this.retire(car, 'Села батарея — энергия исчерпана');
    } else {
      car.fuel = Math.max(0, car.fuel - fuelBurnFor(car.fuelMode));
      if (car.fuel <= 0) return this.retire(car, 'Закончилось топливо');
    }
    if (car.letThrough) {
      car.letThroughLaps--;
      if (car.letThroughLaps <= 0) { car.letThrough = false; this.event(car.lap, `${car.code}: приказ снят, свободная гонка`, 'info'); }
    }
    car.tireAge++;
    car.wear += this.wearPerLap(car);
    // плавный шум темпа на следующий круг (обновляется раз в круг)
    car.noiseState = car.noiseState * 0.55 + (rnd() * 2 - 1) * 0.45;
    car.targetLap = this.lapEstimate(car);
  }

  /** Решения ИИ: реагируют ТОЛЬКО на события (топливо, SC, правило, авария) и меняют план
   *  через единственный pendingPitLap. Плановые питы заданы заранее в legs и не пересчитываются
   *  каждый круг — именно это гарантирует отсутствие лишних пит-стопов. */
  aiDecide(car: SimCar) {
    if (car.isPlayer || car.status !== 'run' || car.pitting) return;
    if (this.kind !== 'race' && this.kind !== 'sprint' && this.kind !== 'sprintRev') return;
    const isSprint = this.kind !== 'race';
    const lapsLeft = this.totalLaps - car.lap;

    // ---- ФОРМУЛА Е: энергия + обязательный режим атаки (строго 1 раз) ----
    if (car.isFE) {
      // режим атаки: активируем в запланированный момент, обязательно до конца гонки
      if (!car.attackUsed && this.phase === 'green' && car.lap >= 1) {
        const mustUse = lapsLeft <= 3; // крайний срок — иначе не успеет
        if (mustUse || car.lap === car.attackPlannedLap) this.activateAttack(car, false);
      }
      // экономия энергии: если на стандарте не хватит до финиша — переходим в эко
      if (car.fuelMode !== 'eco') {
        const projected = car.fuel - lapsLeft * this.energyPerLap(car);
        if (projected < 2) {
          car.fuelMode = 'eco';
          if (rnd() < 0.3) this.event(car.lap, `🔋 ${car.code} экономит энергию`, 'info');
        }
      } else if (car.fuel > lapsLeft * this.energyPerLap(car) + 6 && rnd() < 0.2) {
        car.fuelMode = 'normal'; // достаточный запас — можно ехать в стандартном темпе
      }
      return;
    }

    // Топливный менеджмент (и в гонках, и в спринтах): ИИ следит, чтобы топливо не кончилось.
    // Если на текущем режиме не хватит до финиша — ступенчато снижает (push → normal → eco).
    if (car.fuelMode !== 'eco') {
      const burn = fuelBurnFor(car.fuelMode);
      if (lapsLeft * burn > car.fuel + 1) {
        car.fuelMode = car.fuelMode === 'push' ? 'normal' : 'eco';
        if (rnd() < 0.3) this.event(car.lap, `⛽ ${car.code} бережёт топливо — ${car.fuelMode === 'eco' ? 'экономия' : 'стандарт'}`, 'info');
      }
    }
    if (['AW', 'I', 'W'].includes(car.tire)) return;

    const wear = this.wearFrac(car);
    const nextPlanned = this.nextPitLap(car);

    // ДИНАМИЧЕСКИЕ РЕЖИМЫ: ИИ осмысленно управляет агрессией под состояние резины и борьбу.
    // Свежие шины + плотная борьба → атака/полный газ; изношенная резина → сбавить, беречь.
    const fighting = car.interval > 0.05 && car.interval < 1.0;
    if (wear < 0.3 && fighting && car.fuelMode === 'normal' && car.fuel > lapsLeft * fuelBurnFor('push') + 2) {
      car.fuelMode = 'push';
    } else if (wear > 0.55 && car.fuelMode === 'push') {
      car.fuelMode = 'normal';
    }
    if (wear > 0.55 && car.mode === 'aggr') {
      car.mode = 'balanced'; // резина «плывёт» — сбавить, не добивать комплект
      car.targetLap = this.lapEstimate(car);
    } else if (wear < 0.25 && fighting && car.mode === 'balanced') {
      car.mode = 'aggr'; // свежие шины + борьба за позицию — атаковать
      car.targetLap = this.lapEstimate(car);
    }

    // СПРИНТ: питов нет — бережём резину, чтобы не войти в зону проколов
    if (isSprint) {
      if (wear > 0.4 && car.mode !== 'cons') {
        car.mode = 'cons';
        if (rnd() < 0.4) this.event(car.lap, `${car.code} бережёт резину — щадящий режим`, 'info');
      }
      return;
    }

    // ПОД МАШИНОЙ БЕЗОПАСНОСТИ: единственный «бесплатный» пит (перенос дальнего планового)
    if ((this.phase === 'sc' || this.phase === 'vsc') && !car.scPitUsed) {
      const farOrNone = nextPlanned == null || nextPlanned - car.lap > 3;
      if (farOrNone) {
        const sid = this.gs.playerSeries;
        const dry = dryCompounds(sid);
        const soft = dry[0].id;
        const scTire = car.usedTires.includes(soft) ? (dry.find((x) => x.id !== soft)?.id ?? soft) : soft;
        if (sid === 'f2') {
          // Ф2: пит под SC со свежим комплектом; вне топ-10 рискуют даже уже питавшиеся
          const eligible = car.pitCount === 0
            ? (wear > 0.2 && car.lap < this.totalLaps - 6 && rnd() < 0.8)
            : (car.pos > 10 && wear > 0.4 && lapsLeft > 10 && rnd() < 0.6);
          if (eligible) {
            car.pendingPitLap = car.lap + 1;
            car.pendingTire = scTire;
            car.scPitUsed = true;
            this.event(car.lap, `${car.code}${car.pitCount > 0 ? ` (P${car.pos})` : ''}: бесплатный пит под SC — свежий ${scTire === soft ? 'мягкий' : 'жёсткий'}`, 'pit');
            return;
          }
          return; // Ф2 в топ-10 уже питавшийся — остаётся, бережёт позицию
        }
        // другие серии: переносим плановый стоп под SC, если резина уже поработала
        if (wear > 0.5 && car.lap < this.totalLaps - 4) {
          car.pendingPitLap = car.lap + 1;
          car.pendingTire = null;
          car.scPitUsed = true;
          this.event(car.lap, `${car.code} пользуется машиной безопасности — ранний пит`, 'pit');
          return;
        }
      }
    }

    // СТРАХОВКА правила двух составов (Ф1/Ф2, сухая): если не выполнено и питов больше нет
    const sidRule = this.gs.playerSeries;
    if ((sidRule === 'f1' || sidRule === 'f2') && !this.raining && !this.wetSession) {
      const dryUsed = car.usedTires.filter((x) => !['I', 'W', 'AW'].includes(x));
      if (new Set(dryUsed).size < 2 && nextPlanned == null && car.lap < this.totalLaps - 2) {
        const other = dryCompounds(sidRule).find((cc) => !dryUsed.includes(cc.id));
        if (other) {
          car.pendingPitLap = car.lap + 1;
          car.pendingTire = other.id;
          this.event(car.lap, `${car.code}: обязательный пит — правило двух составов`, 'pit');
          return;
        }
      }
    }

    // АВАРИЙНЫЙ пит: износ достиг зоны проколов (80%+). Не питаемся, если до финиша ≤3 кругов —
    // дешевле доехать, чем тратить пит. ИИ старается планировать так, чтобы сюда не попадать.
    if (wear >= 0.80 && lapsLeft > 3) {
      car.pendingPitLap = car.lap + 1;
      car.pendingTire = null;
      this.event(car.lap, `${car.code}: износ ${Math.round(wear * 100)}% — вынужденный заезд`, 'pit');
    }
  }

  rollIncidents(car: SimCar) {
    const c = this.circuit;
    const wetF = this.raining ? (['I', 'W', 'AW'].includes(car.tire) ? 1.5 : 3.2) : 1;
    const ovalF = c.kind === 'oval' ? 1.25 : 1;
    const modeF = car.mode === 'aggr' ? 1.25 : car.mode === 'cons' ? 0.8 : 1;
    const p = c.danger * 0.0075 * (1.45 - car.cons / 100) * wetF * ovalF * modeF * (1 + car.damage / 140);
    if (rnd() < p) {
      const sev = rnd();
      if (sev < 0.42) {
        const loss = 6 + rnd() * 6;
        car.damage = clamp(car.damage + 5 + rnd() * 8, 0, 60);
        car.targetLap += loss;
        this.event(car.lap, `${car.code} развернуло в повороте (+${loss.toFixed(0)} с)`, 'crash');
      } else if (sev < 0.78) {
        // машины в боксах (пит-стоп) НЕ могут быть участниками контакта на трассе
        const others = this.runningSorted().filter((x) => x !== car && !x.pitting && x.pitCrawl <= 0 && Math.abs(x.dist - car.dist) < 60);
        const rival = others.length ? pick(others) : null;
        car.damage = clamp(car.damage + 8 + rnd() * 9, 0, 70);
        car.targetLap += 2.4;
        if (rival) {
          rival.damage = clamp(rival.damage + 8 + rnd() * 9, 0, 70);
          rival.targetLap += 2.0;
          this.event(car.lap, `Контакт: ${car.code} и ${rival.code} — повреждены антикрылья`, 'crash');
          if (rnd() < 0.55) {
            car.penQueue.push(5);
            this.event(car.lap, `Стюарды: ${car.code} — 5 секунд за столкновение`, 'info');
          } else {
            this.gs.nextRoundPen[car.did] = (this.gs.nextRoundPen[car.did] ?? 0) + 3;
            this.event(car.lap, `Стюарды: ${car.code} — штраф 3 позиции на следующую гонку`, 'info');
          }
          if (rival.damage > 55 && rnd() < 0.3) this.retire(rival, 'Повреждения после контакта');
        }
        if (car.damage > 55 && rnd() < 0.3) this.retire(car, 'Повреждения после контакта');
      } else {
        this.retire(car, 'Авария — удар в барьеры');
      }
    }
    const team = this.gs.teams[car.tid];
    // Ф2/Ф3: износ СУ индивидуальный (×0.1 при накоплении, поэтому ×10 для сопоставимой шкалы отказов)
    const wearBase = this.gs.playerSeries === 'f1' ? team.wear
      : (this.gs.playerSeries === 'f2' || this.gs.playerSeries === 'f3') ? engineWearOf(this.gs, car.did) * 10
      : team.wear * 0.6;
    const modeF2 = car.mode === 'aggr' ? 1.6 : car.mode === 'cons' ? 0.55 : 1;
    const pf = Math.max(0, wearBase - 40) * 0.00022 * modeF2 + 0.00045;
    if (rnd() < pf) {
      const sid = this.gs.playerSeries;
      // 50% отказов — неремонтируемые: узел подлежит замене
      const unrecoverable = rnd() < 0.5;
      if (unrecoverable) {
        if (sid === 'f1') {
          // Ф1: замена элемента сверх лимита влечёт штраф решётки
          const el = pick(['ICE', 'TC', 'MGU-H', 'MGU-K'] as const);
          const msg = fitComponent(this.gs, car.did, el, null);
          this.retire(car, `Отказ ${el} — узел не подлежит ремонту (замена: ${msg.split('→ ')[1] ?? 'штраф'})`);
        } else if (sid === 'f2' || sid === 'f3') {
          swapEngine(this.gs, car.did);
          this.retire(car, 'Отказ мотора — не подлежит ремонту (установлен свежий)');
        } else {
          team.wear = 60;
          this.retire(car, 'Механический отказ — узел заменён');
        }
      } else {
        // ремонтируемый отказ: мотор починят, износ частично сброшен
        if (sid === 'f2' || sid === 'f3') {
          const comps = this.gs.components[car.did];
          if (comps) comps.wear = Math.max(1, (comps.wear ?? 0) * 0.4);
        } else {
          team.wear = Math.max(10, team.wear * 0.4);
        }
        this.retire(car, 'Механический отказ (отремонтирован к следующей сессии)');
      }
    }
  }

  /** Выезд физической машины безопасности: она выезжает с пит-лейна впереди лидера
   *  и едет медленно, пока лидер её не «поймает» — только тогда пелотон начинает собираться. */
  deploySafetyCar(lap: number) {
    this.phase = 'sc';
    this.phaseEndLap = 9999; // сбросится, когда SC подберёт лидера
    const lead = this.leader();
    // SC выезжает с пит-лейна — у выезда, сразу за той стартовой чертой, которую лидер
    // пересечёт следующей, — и ЖДЁТ там лидера. Пелотон начнёт собираться только после поимки.
    const nextLine = (Math.floor(lead.dist / this.track.total) + 1) * this.track.total;
    this.sc = { active: true, leaving: false, dist: nextLine + 40, exitTarget: 0, state: 'waiting' };
    this.scLastLapMsg = false;
    this.event(lap, '🚔 Машина безопасности выехала с пит-лейна — ждёт лидера, жёлтые флаги', 'sc');
  }

  retire(car: SimCar, reason: string) {
    if (car.status !== 'run') return;
    car.status = 'out';
    car.outReason = reason;
    this.event(car.lap, `⚠ ${car.code} (${car.name}) сошёл: ${reason}`, 'crash');
    const lapsLeft = this.totalLaps - this.leader().lap;
    if (this.phase === 'green' && !this.leaderDone && lapsLeft > 3) {
      const roll = rnd();
      if (reason.includes('Авария') && roll < 0.12 && this.leader().lap < this.totalLaps * 0.6) {
        this.raiseRedFlag(car.lap);
      } else if (roll < 0.48) {
        this.deploySafetyCar(car.lap);
      } else if (roll < 0.8) {
        this.phase = 'vsc';
        this.phaseEndLap = this.leader().lap + 2;
        this.scLastLapMsg = false;
        this.event(car.lap, '⚠ ВИРТУАЛЬНАЯ МАШИНА БЕЗОПАСНОСТИ', 'sc');
      }
    }
  }

  /**
   * КРАСНЫЙ ФЛАГ: гонка останавливается, все машины съезжают в боксы.
   * Отсчёт до рестарта идёт в реальном времени (tickRedFlag) и НЕ блокируется паузой.
   * Под красным флагом замена шин бесплатна (это не пит-стоп — машины уже в боксах).
   */
  raiseRedFlag(lap: number) {
    this.phase = 'red';
    this.redRemaining = 40; // секунд реального времени
    this.sc = null;         // машина безопасности тоже уходит в боксы
    for (const car of this.cars) {
      if (car.status === 'run') {
        car.redParked = true;
        car.pitting = false;
        car.pitCrawl = 0;
      }
    }
    this.event(lap, '🔴 КРАСНЫЙ ФЛАГ — гонка остановлена, все машины в боксах', 'red');
    // ИИ пользуются моментом: бесплатно ставят свежие шины
    for (const car of this.cars) {
      if (car.status !== 'run' || car.isPlayer) continue;
      this.aiRedFlagTire(car);
    }
  }

  /** Отсчёт реального времени под красным флагом. Возвращает true, когда рестарт готов. */
  tickRedFlag(dtReal: number): boolean {
    if (this.phase !== 'red') return false;
    this.redRemaining -= dtReal;
    if (this.redRemaining <= 0) {
      this.restartFromRed();
      return true;
    }
    return false;
  }

  /** Рестарт после красного флага: машины выстраиваются в боксах по текущим позициям и стартуют с пит-лейна */
  restartFromRed() {
    this.phase = 'green';
    const ranked = [...this.cars].filter((c) => c.status === 'run').sort((a, b) => a.pos - b.pos);
    const lead = this.leader();
    // все машины выстраиваются плотной колонной за лидером и стартуют с пит-лейна
    ranked.forEach((car, i) => {
      car.redParked = false;
      car.dist = lead.dist - i * 10;
      car.lapStartDist = car.dist;
      car.lapStartT = this.t;
      car.targetLap = this.lapEstimate(car);
    });
    this.event(lead.lap, '🟢 ЗЕЛЁНЫЙ ФЛАГ — рестарт с пит-лейна!', 'flag');
  }

  /** Бесплатная замена шин под красным флагом (доступна игроку и ИИ). Это НЕ пит-стоп. */
  redFlagTire(did: string, tireId: string): boolean {
    if (this.phase !== 'red') return false;
    const car = this.cars.find((c) => c.did === did);
    if (!car || car.status !== 'run' || !car.redParked) return false;
    if (car.tire === tireId) return false;
    car.tire = tireId;
    car.tireAge = 0;
    car.wear = 0;
    car.usedTires.push(tireId);
    this.event(car.lap, `🔧 ${car.code}: бесплатная замена шин под красным флагом → ${tireName(this.gs.playerSeries, tireId)}`, 'pit');
    return true;
  }

  /** ИИ выбирает шины под красным флагом: если правило двух составов не выполнено — берёт недостающий, иначе свежий мягкий */
  aiRedFlagTire(car: SimCar) {
    const sid = this.gs.playerSeries;
    const dry = dryCompounds(sid);
    const ruleActive = (sid === 'f1' || sid === 'f2') && this.kind === 'race' && !this.raining && !this.wetSession;
    const dryUsed = car.usedTires.filter((x) => !['I', 'W', 'AW'].includes(x));
    let want: string | null = null;
    if (ruleActive && new Set(dryUsed).size < 2) {
      want = dry.find((cc) => !dryUsed.includes(cc.id))?.id ?? null; // добираем недостающий состав
    } else if (car.wear / Math.max(1, compoundDef(sid, car.tire).life) > 0.2) {
      want = car.tire; // свежий комплект того же состава
    }
    if (this.raining) want = sid === 'fe' ? 'AW' : 'I';
    if (want && want !== car.tire) {
      car.tire = want;
      car.tireAge = 0;
      car.wear = 0;
      car.usedTires.push(want);
    }
  }

  /** Корректные времена финиша: у каждого финишёра — свой момент пересечения линии */
  finishAll() {
    const totalDist = this.totalLaps * this.track.total;
    const finishing: SimCar[] = [];
    for (const car of this.cars) {
      if (car.status === 'run') {
        car.status = 'fin';
        car.finished = true;
        const remaining = Math.max(0, totalDist - car.dist);
        const speed = Math.max(20, this.track.total / car.targetLap);
        car.finishT = this.t + remaining / speed + (car.pos - 1) * 0.05;
        finishing.push(car);
      }
    }
    // назначаем finishSeq в порядке прогнозного финиша, чтобы порядок был однозначным
    finishing.sort((a, b) => a.finishT - b.finishT);
    for (const car of finishing) car.finishSeq = ++this.finishSeqCounter;
    this.done = true;
  }

  results(): SimCar[] {
    return [...this.cars].sort((a, b) => {
      if (a.dsq !== b.dsq) return a.dsq ? 1 : -1; // дисквалифицированные — в конец
      // финишёры — строго в порядке пересечения линии (finishSeq), без «перескоков»
      if (a.finished && b.finished) return a.finishSeq - b.finishSeq;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.lap - a.lap || b.dist - a.dist;
    });
  }

  /* ---- live-управление игроком ---- */

  /** Игрок зовёт машину на пит: единственный pending-пит на следующем круге (не дублируется). */
  boxCar(did: string, tireId: string): boolean {
    const car = this.cars.find((c) => c.did === did);
    if (!car || car.status !== 'run') return false;
    if (this.phase === 'red') return false; // под красным флагом машины уже в боксах — используйте бесплатную замену
    if (car.redParked || car.pitting || this.nextPitLap(car) != null) return false;
    car.pendingPitLap = car.lap + 1;
    car.pendingTire = tireId;
    this.event(car.lap, `BOX BOX BOX! ${car.code} → ${tireName(this.gs.playerSeries, tireId)}`, 'pit');
    return true;
  }

  pitScheduled(did: string): boolean {
    const car = this.cars.find((c) => c.did === did);
    if (!car) return false;
    return car.pitting || this.nextPitLap(car) === car.lap + 1;
  }

  setMode(did: string, mode: StrategyPreset): void {
    const car = this.cars.find((c) => c.did === did);
    if (!car || car.status !== 'run' || car.mode === mode) return;
    car.mode = mode;
    car.targetLap = this.lapEstimate(car);
    const label = mode === 'aggr' ? 'АТАКА' : mode === 'cons' ? 'БЕРЕЖЁМ ШИНЫ' : 'БАЛАНС';
    this.event(car.lap, `${car.code}: режим — ${label}`, 'info');
  }

  setFuelMode(did: string, fuelMode: 'eco' | 'normal' | 'push'): void {
    const car = this.cars.find((c) => c.did === did);
    if (!car || car.status !== 'run' || car.fuelMode === fuelMode) return;
    car.fuelMode = fuelMode;
    car.targetLap = this.lapEstimate(car);
    const label = fuelMode === 'push' ? 'полный газ' : fuelMode === 'eco' ? 'экономия топлива' : 'стандарт';
    this.event(car.lap, `${car.code}: топливо — ${label}`, 'info');
  }

  orderLetThrough(did: string): void {
    const car = this.cars.find((c) => c.did === did);
    if (!car || car.status !== 'run' || car.letThrough) return;
    car.letThrough = true;
    car.letThroughLaps = 3;
    car.targetLap = this.lapEstimate(car);
    this.event(car.lap, `📻 КОМАНДНЫЙ ПРИКАЗ: ${car.code} пропускает напарника`, 'info');
  }

  /** Формула Е: активация режима атаки (строго 1 раз за гонку).
   *  Сейчас −2 с, затем 8 минут (480 с симуляции) темп на 3% выше и расход энергии +3%. */
  activateAttack(car: SimCar, byPlayer: boolean): void {
    if (!car.isFE || car.attackUsed || car.status !== 'run') return;
    car.attackUsed = true;
    car.attackUntil = this.t + 480;
    car.pendingTimeLoss = 2;
    car.targetLap = this.lapEstimate(car);
    this.event(car.lap, `⚡ ${car.code}: РЕЖИМ АТАКИ — ${byPlayer ? 'по команде игрока' : ''} +3% темпа на 8 минут (−2 с сейчас)`, 'info');
  }

  /** Публичный метод для игрока (Формула Е): включить режим атаки по did. */
  playerActivateAttack(did: string): void {
    const car = this.cars.find((c) => c.did === did);
    if (car) this.activateAttack(car, true);
  }

  /** Оставшееся время режима атаки в секундах (0 = не активен). */
  attackRemaining(car: SimCar): number {
    return Math.max(0, car.attackUntil - this.t);
  }
}

export function makeRaceSim(gs: GameState, kind: SimKind, grid: string[], circuit: Circuit, wet: boolean, rainMid: boolean, startOverrides?: Record<string, string>): RaceSim {
  return new RaceSim(gs, kind, grid, raceLapsFor(gs, kind, circuit), circuit, wet, rainMid, startOverrides);
}

/* ================= ПРИМЕНЕНИЕ РЕЗУЛЬТАТОВ ================= */

export function applySession(gs: GameState, sim: SessionSim | RaceSim, stage: Stage) {
  // тип симуляции определяем по стадии (instanceof ненадёжен после hot-reload модуля)
  if (isRaceLikeStage(stage)) return applyRace(gs, sim as RaceSim, stage);
  if (stage === 'quali' || stage === 'sq') return applyQualiSim(gs, sim as SessionSim, stage);
  return applyPracticeSim(gs, sim as SessionSim, stage);
}

export function applyRace(gs: GameState, sim: RaceSim, stage: Stage) {
  const w = gs.weekend!;
  const sid = gs.playerSeries;
  const meta = SERIES_META[sid];
  const ss = gs.series[sid];

  // ПРАВИЛО ДВУХ СОСТАВОВ (Ф1/Ф2, только сухие гонки, не спринты):
  // каждый финишировавший обязан использовать >=2 разных состава, иначе — ДИСКВАЛИФИКАЦИЯ.
  // Не действует, если по ходу гонки был дождь или машина использовала дождевые шины.
  const twoCompoundViolators: string[] = [];
  if (stage === 'race' && (sid === 'f1' || sid === 'f2') && !sim.wetSession && !sim.raining) {
    for (const car of sim.cars) {
      if (car.status !== 'fin' || car.dsq) continue;
      const dryUsed = car.usedTires.filter((x) => x !== 'I' && x !== 'W' && x !== 'AW');
      if (new Set(dryUsed).size < 2) {
        car.dsq = true;
        twoCompoundViolators.push(car.code);
      }
    }
  }

  const results = sim.results();
  const winner = results[0];
  const winT = winner.finishT;
  const ptsArr = stage === 'sprint' ? meta.sprintPoints : stage === 'sprintRev' ? meta.revSprintPoints : meta.points;
  const indy500 = sid === 'indy' && sim.circuit.name.includes('Индианаполис 500');
  const rows: TableRow[] = results.map((car, i) => {
    let pts = car.dsq ? 0 : (ptsArr[i] ?? 0);
    if (indy500 && stage === 'race' && !car.dsq) pts *= 2;
    ss.dStand[car.did] = (ss.dStand[car.did] ?? 0) + pts;
    ss.tStand[car.tid] = (ss.tStand[car.tid] ?? 0) + pts;
    const gap = car.finishT - winT;
    const display = car.dsq ? 'ДСК'
      : car.status === 'fin'
        ? (i === 0 ? fmtLap(winT) : `+${gap.toFixed(3)}`)
        : `+${sim.totalLaps - car.lap} круг(ов)`;
    return {
      pos: i + 1, did: car.did, tid: car.tid, display,
      best: car.bestLap != null ? fmtLap(car.bestLap) : null,
      points: pts,
      note: car.dsq ? 'Дисквалифицирован: правило двух составов' : car.status === 'out' ? `Сход: ${car.outReason}` : '',
    };
  });
  let fl: SimCar | null = null;
  for (const car of results) if (car.status === 'fin' && !car.dsq && car.pos <= 10) if (!fl || (car.bestLap ?? 1e9) < (fl.bestLap ?? 1e9)) fl = car;
  const notes: string[] = [];
  if (fl && meta.flPoints > 0 && stage === 'race') {
    ss.dStand[fl.did] += meta.flPoints;
    ss.tStand[fl.tid] += meta.flPoints;
    notes.push(`Быстрейший круг: ${gs.drivers[fl.did].name} (+${meta.flPoints} очк.)`);
  }
  if (indy500 && stage === 'race') notes.push('Инди-500: двойные очки');
  if (twoCompoundViolators.length) {
    notes.push(`⛔ Дисквалификация за нарушение правила двух составов: ${twoCompoundViolators.join(', ')}`);
  }
  w.results[stage] = { stage, title: stageTitle(gs, stage), rows, notes };
  w.stageIdx++;

  const pt = playerTeam(gs);
  let myBest: number | null = null;
  for (const car of sim.cars) {
    const d = gs.drivers[car.did];
    const t = gs.teams[car.tid];
    if (stage === 'race') { d.gpStarts++; if (sid === 'f1') d.f1Starts++; }
    const pos = results.indexOf(car) + 1;
    d.form = clamp(d.form + (pos === 1 ? 4 : pos <= 3 ? 2 : pos <= 6 ? 1 : car.status === 'out' ? -2 : -0.5), 40, 95);
    // износ СУ: в Ф2/Ф3 — в 10 раз ниже (надёжные серийные моторы) и ИНДИВИДУАЛЕН для каждого болида
    const wearMul = (sid === 'f2' || sid === 'f3') ? 0.1 : 1;
    const inc = (car.mode === 'aggr' ? 3.2 : car.mode === 'cons' ? 1.1 : 2) * wearMul;
    if (sid === 'f2' || sid === 'f3') {
      addEngineWear(gs, car.did, inc); // свой мотор — свой износ
    } else {
      t.wear += inc;
    }
    if (t.id === gs.playerTeamId && (myBest == null || pos < myBest)) myBest = pos;
    // ИИ-команды развивают болиды — только в сериях с апгрейдами (не в серийных Ф2/Ф3)
    if (t.id !== gs.playerTeamId && !SERIES_META[sid].specCar && rnd() < 0.3) {
      const area = pick(['aero', 'chassis', 'base'] as const);
      t[area] = clamp(t[area] + 0.25 + rnd() * 0.4, 0, 99);
    }
  }
  for (const t of Object.values(gs.teams)) t.wear = clamp(t.wear, 0, 130);

  // объявления о завершении карьеры (пилоты 34+, в течение сезона)
  if (stage === 'race') checkRetirements(gs);

  // призовые за позицию КАЖДОГО вашего пилота + бонус за быстрый круг в топ-10
  const prizeTable = [0, 500_000, 350_000, 250_000, 150_000, 100_000, 80_000, 60_000, 45_000, 30_000, 20_000];
  const myPos = rows.filter((r) => r.tid === gs.playerTeamId).map((r) => r.pos);
  let earned = myPos.reduce((s, p) => s + (prizeTable[Math.min(p, 10)] ?? 10_000), 0);
  const myFl = rows.find((r) => r.tid === gs.playerTeamId && r.pos <= 10 && r.note?.includes('БК'));
  if (myFl) earned += 40_000; // бонус за быстрейший круг
  if (myBest === 1) { gs.careerWins++; pushNews(gs, `ПОБЕДА! ${gs.drivers[winner.did].name} выигрывает «${sim.circuit.name}»`, 'ГОНКА'); }
  else if (myBest != null && myBest <= 3) gs.careerPodiums++;
  const income = Math.round(earned * SERIES_META[sid].budgetFactor * gs.mods.payMod);
  pt.budget += income;
  gs.budget += income;

  if (stage === 'race') {
    // спонсоры и доверие владельца
    const myRows = rows.filter((r) => r.tid === gs.playerTeamId);
    const teamPts = myRows.reduce((s, r) => s + r.points, 0);
    const poss = myRows.map((r) => r.pos).sort((a, b) => a - b);
    evaluateSponsorsRound(gs, teamPts, poss[0] ?? 99, poss[1] ?? null);
    const dnfs = sim.cars.filter((c) => c.isPlayer && c.status === 'out').length;
    applyTrustRound(gs, poss[0] ?? 20, dnfs);
    const payout = sponsorRoundPayout(gs);
    pt.budget += payout;
    gs.budget += payout;

    const round = ss.rounds[w.roundIdx];
    round.done = true;
    round.result = {
      quali: w.results['quali']?.rows ?? [],
      race: rows,
      sprint: w.results['sprint']?.rows ?? w.results['sprintRev']?.rows,
    };
    ss.current++;
    tickUpgrades(gs);
    aiDevelopment(gs); // ИИ-команды развивают болиды между этапами
    aiTransferMarket(gs); // ИИ-команды активны на трансферном рынке (1-2 сделки за этап, не все сразу)
    // уик-энд завершён, но остаётся открытым: игрок видит итоговые результаты и сам уходит в штаб
    w.stageIdx = w.stages.length;
    gs.phase = 'weekend';
    const leader = Object.entries(ss.dStand).sort((a, b) => b[1] - a[1])[0];
    pushNews(gs, `Итог «${sim.circuit.name}»: победил ${gs.drivers[winner.did].name}. Лидер ЧМ: ${leader ? gs.drivers[leader[0]].name : '—'}`, 'ЧЕМПИОНАТ');
  }
}

/* ================= ЭЛЕМЕНТЫ СУ (Ф1) ================= */

export const PU_ELEMENTS = ['ICE', 'TC', 'MGU-H', 'MGU-K', 'ES', 'CE', 'EX'] as const;
export type PUElement = (typeof PU_ELEMENTS)[number];

export function puLimit(gs: GameState, el: PUElement): number {
  if (el === 'EX') return 8;
  if (el === 'ES' || el === 'CE') return 4;
  return 4 + gs.mods.puLimitBonus;
}

export function fitComponent(gs: GameState, did: string, el: PUElement, w: Weekend | null): string {
  const comps = gs.components[did] ?? (gs.components[did] = { ICE: 1, TC: 1, 'MGU-H': 1, 'MGU-K': 1, ES: 1, CE: 1, EX: 1 });
  comps[el] = (comps[el] ?? 0) + 1;
  const limit = puLimit(gs, el);
  const d = gs.drivers[did];
  if (comps[el] <= limit) return `${d.code}: новый ${el} (${comps[el]}/${limit}) — без штрафа`;
  const over = comps[el] - limit;
  const places = el === 'EX' ? (over === 1 ? 10 : 5) : el === 'ES' || el === 'CE' ? 5 : 15;
  const target = w ? w.pendingGrid : gs.nextRoundPen;
  target[did] = (target[did] ?? 0) + places;
  return `${d.code}: ${el} №${comps[el]} сверх лимита → −${places} поз. (суммарно −${target[did]}, при переборе — старт с конца)`;
}

/* --- Силовая установка Ф2/Ф3: единый мотор, замена без штрафа решётки --- */

/** Цена замены мотора: Ф2 — $500K, Ф3 — $100K */
export function engineSwapCost(sid: SeriesId): number {
  return sid === 'f2' ? 500_000 : 100_000;
}

/** Износ СУ конкретного болида (Ф2/Ф3 — индивидуальный; в Ф1 износ командный, хранится в team.wear) */
export function engineWearOf(gs: GameState, did: string): number {
  return gs.components[did]?.wear ?? 0;
}

/** Начислить износ СУ конкретному болиду (Ф2/Ф3) */
export function addEngineWear(gs: GameState, did: string, amount: number) {
  const comps = gs.components[did] ?? (gs.components[did] = { ENG: 1, wear: 0 });
  comps.wear = clamp((comps.wear ?? 0) + amount, 0, 130);
}

/** Заменить мотор Ф2/Ф3 (ENG+1). Без штрафа решётки, списывает стоимость с бюджета команды. */
export function swapEngine(gs: GameState, did: string): string {
  const d = gs.drivers[did];
  const t = gs.teams[d.teamId!];
  const sid = t.seriesId;
  if (sid !== 'f2' && sid !== 'f3') return '';
  const comps = gs.components[did] ?? (gs.components[did] = { ENG: 1, wear: 0 });
  comps.ENG = (comps.ENG ?? 0) + 1;
  comps.wear = 0; // износ СУ индивидуален для каждого болида — сбрасываем только у этого пилота
  const cost = engineSwapCost(sid);
  t.budget = Math.max(0, t.budget - cost);
  if (t.id === gs.playerTeamId) gs.budget = Math.max(0, gs.budget - cost);
  pushNews(gs, `${t.short}: ${d.code} получил свежий мотор №${comps.ENG} (${money(cost)}, без штрафа)`, 'СУ');
  return `${d.code}: новый мотор №${comps.ENG} — ${money(cost)}, без штрафа`;
}

/* ================= ПРОГРАММЫ ОБНОВЛЕНИЙ / ЛИМИТ БЮДЖЕТОВ ================= */

export const F1_BUDGET_CAP = 140_000_000;
export function budgetCap(gs: GameState): number {
  return gs.playerSeries === 'f1' ? F1_BUDGET_CAP * gs.mods.capMod : Infinity;
}
export function capRemaining(gs: GameState): number {
  return budgetCap(gs) - playerTeam(gs).capSpent;
}

export const UPG_STRAT = {
  cons: { costF: 0.7, gainF: 0.6, fail: 0.05, label: 'Консервативная' },
  std: { costF: 1.0, gainF: 1.0, fail: 0.10, label: 'Стандартная' },
  aggr: { costF: 1.4, gainF: 1.5, fail: 0.25, label: 'Агрессивная' },
} as const;

export function upgradeRounds(area: UpgradeArea, strat: UpgradeStrategy): number {
  const isPU = area === 'power';
  if (strat === 'aggr') return isPU ? 6 : 3;
  if (strat === 'std') return isPU ? 8 : 4;
  return isPU ? 10 : 5;
}

export function upgradeCost(gs: GameState, t: Team, area: UpgradeArea, strat: UpgradeStrategy = 'std'): number {
  const stat = t[area] ?? 60;
  return Math.round(Math.pow(Math.max(4, stat - 26), 2.15) * 9000 * SERIES_META[t.seriesId].budgetFactor * UPG_STRAT[strat].costF);
}

export function upgradeGain(gs: GameState, area: UpgradeArea, strat: UpgradeStrategy = 'std'): number {
  const t = playerTeam(gs);
  const td = gs.staff[t.staffIds[0]];
  const base = clamp(2.3 + (td?.skill ?? 60) * 0.018 - (t[area] ?? 60) * 0.016, 0.9, 4.2);
  return Math.round(base * UPG_STRAT[strat].gainF * 10) / 10;
}

export function canUpgrade(gs: GameState, area: UpgradeArea): string | null {
  const t = playerTeam(gs);
  const meta = SERIES_META[t.seriesId];
  if (meta.specCar) return `${meta.specCar}: единая спецификация — апгрейды запрещены`;
  if (area === 'power' && !t.works) return 'Клиентская команда: мотор поставляет ' + t.engineMaker;
  if (gs.programs.some((p) => p.teamId === t.id && p.area === area && p.status === 'active')) return 'Программа уже выполняется';
  if (gs.programs.filter((p) => p.teamId === t.id && p.status === 'active').length >= 3) return 'Не больше 3 параллельных программ';
  return null;
}

export function startUpgrade(gs: GameState, area: UpgradeArea, strat: UpgradeStrategy): string | null {
  const err = canUpgrade(gs, area);
  if (err) return err;
  const t = playerTeam(gs);
  const cost = upgradeCost(gs, t, area, strat);
  if (gs.playerSeries === 'f1' && t.capSpent + cost > budgetCap(gs)) {
    return `Превышен лимит бюджетов Ф1 (${money(budgetCap(gs))})`;
  }
  if (gs.budget < cost) return 'Недостаточно бюджета';
  gs.budget -= cost;
  t.budget = Math.max(0, t.budget - cost);
  t.capSpent += cost;
  gs.programs.push({
    id: `up_${gs.seasonN}_${gs.series[gs.playerSeries].current}_${Math.floor(rnd() * 1e6)}`,
    teamId: t.id, area, strategy: strat,
    roundsLeft: upgradeRounds(area, strat), totalRounds: upgradeRounds(area, strat),
    gain: upgradeGain(gs, area, strat), cost, status: 'active',
  });
  pushNews(gs, `${t.short}: программа «${areaLabel(area)}» — ${UPG_STRAT[strat].label.toLowerCase()} (${upgradeRounds(area, strat)} ГП)`, 'РАЗВИТИЕ');
  return null;
}

export function tickUpgrades(gs: GameState) {
  const t = playerTeam(gs);
  for (const p of gs.programs) {
    if (p.teamId !== t.id || p.status !== 'active') continue;
    p.roundsLeft--;
    if (p.roundsLeft > 0) continue;
    if (rnd() < UPG_STRAT[p.strategy].fail) {
      p.status = 'failed';
      pushNews(gs, `⚠ ${t.short}: «${areaLabel(p.area)}» не сработала — улучшения нет`, 'РАЗВИТИЕ');
    } else {
      p.status = 'done';
      t[p.area] = clamp((t[p.area] ?? 60) + p.gain, 0, 99);
      pushNews(gs, `✓ ${t.short}: «${areaLabel(p.area)}» +${p.gain.toFixed(1)}`, 'РАЗВИТИЕ');
    }
  }
}

export function areaLabel(a: string): string {
  return a === 'aero' ? 'Аэродинамика' : a === 'chassis' ? 'Шасси' : a === 'power' ? 'Силовая установка'
    : a === 'tires' ? 'Работа с шинами' : 'Базовый пакет';
}

/* ================= ПЕРЕГОВОРЫ И СДЕЛКИ ================= */

export function availableRookies(gs: GameState): Driver[] {
  const all = Object.values(gs.drivers);
  const raceSeat = new Set<string>();
  for (const t of Object.values(gs.teams)) {
    if (t.seriesId !== 'f1') continue;
    driversOfTeam(gs, t.id).filter((d) => !d.reserve).sort((a, b) => b.salary - a.salary).slice(0, 2).forEach((d) => raceSeat.add(d.id));
  }
  return all
    .filter((d) => d.f1Starts <= 2 && !d.retiring && (
      (!d.teamId && !d.seriesId)
      || (d.teamId && ((d.seriesId === 'f2' || d.seriesId === 'f3') || (d.seriesId === 'f1' && !raceSeat.has(d.id))))
    ))
    .sort((a, b) => b.pace - a.pace)
    .slice(0, 14);
}

export function startNego(gs: GameState, did: string): string | null {
  if (gs.deals.some((x) => x.did === did)) return 'Сделка уже согласована';
  if (gs.negos[did]) return 'Переговоры уже идут';
  const d = gs.drivers[did];
  if (!d) return 'Пилот не найден';
  if (d.teamId === gs.playerTeamId) return 'Это ваш пилот';
  const standing = Object.entries(gs.series[gs.playerSeries].tStand).sort((a, b) => b[1] - a[1]).findIndex(([tid]) => tid === gs.playerTeamId);
  // престиж серии: пилот не хочет спускаться ниже, но охотно поднимается выше
  const tierRank: Record<SeriesId, number> = { f1: 5, f2: 4, indy: 4, f3: 3, fe: 3 };
  const dTier = tierRank[d.seriesId ?? 'f3'];
  const pTier = tierRank[gs.playerSeries];
  const tierPen = (pTier - dTier) * 22;
  // звёзды не идут в слабые команды — требуемая репутация растёт с классом пилота
  const starPen = d.pace > 88 && gs.reputation < 75 ? (d.pace - 88) * 4 : 0;
  const interest = clamp(
    Math.round(38 + gs.reputation * 0.45 - d.value / 900_000 + (standing >= 0 ? (6 - Math.min(standing, 6)) * 4 : 0) + (d.form - 70) * 0.3 + tierPen - starPen),
    5, 92,
  );
  const askSalary = Math.round(Math.max(d.salary, d.value * 0.08) * (1.1 + rnd() * 0.4));
  const askBonus = Math.round(d.value * (0.06 + rnd() * 0.09));
  const fromTeam = d.teamId ? gs.teams[d.teamId] : null;
  // отступные = выкуп оставшихся зарплат (зарплата × лет) + премия от рыночной цены;
  // чем выше зарплата и длиннее остаток контракта — тем дороже
  let feeAsk = 0;
  if (fromTeam) {
    const yearsLeft = Math.max(1, d.contract);
    const salaryPart = d.salary * yearsLeft * (1.35 + rnd() * 0.35);  // 135–170% от оставшихся зарплат
    const valuePart = d.value * (0.22 + rnd() * 0.16);                // премия за рыночную ценность
    const strengthMult = 0.9 + fromTeam.reputation / 300;             // топ-команды заламывают цену
    const starMult = d.pace > 86 ? 1 + (d.pace - 86) * 0.035 : 1;     // звёзды дороже
    feeAsk = Math.round((salaryPart + valuePart) * strengthMult * starMult);
  }
  gs.negos[did] = {
    did, interest, askSalary, askBonus, askYears: 1 + Math.floor(rnd() * 2),
    offerSalary: askSalary, offerBonus: askBonus, offerYears: 1 + Math.floor(rnd() * 2),
    driverAgreed: false, feeAsk, feeOffer: feeAsk, feeAgreed: !fromTeam, collapsed: false,
  };
  pushNews(gs, `Начаты переговоры с ${d.name}`, 'ПЕРЕГОВОРЫ');
  return null;
}

export function offerToDriver(gs: GameState, did: string): string {
  const n = gs.negos[did];
  const d = gs.drivers[did];
  if (!n || n.driverAgreed || n.collapsed) return '';
  const askV = n.askSalary * n.askYears + n.askBonus;
  const offV = n.offerSalary * n.offerYears + n.offerBonus;
  const ratio = offV / Math.max(1, askV);
  const p = clamp(0.42 + (ratio - 1) * 2.2 + n.interest / 250 + (gs.reputation - 60) / 200, 0.04, 0.96);
  if (rnd() < p) {
    n.driverAgreed = true;
    maybeSealDeal(gs, did);
    return `${d.name} принимает: ${money(n.offerSalary)}/год на ${n.offerYears} г.`;
  }
  n.interest = clamp(n.interest - Math.round(10 + (1 - ratio) * 30), 0, 100);
  n.askSalary = Math.round(n.askSalary * (ratio > 0.85 ? 0.94 : 1));
  n.askBonus = Math.round(n.askBonus * (ratio > 0.85 ? 0.92 : 1));
  if (n.interest <= 12) {
    n.collapsed = true;
    return `${d.name} прекращает переговоры — интерес потерян`;
  }
  return `${d.name}: «Предложение ниже ожиданий». Интерес ${n.interest}%, требования: ${money(n.askSalary)}/год`;
}

export function offerFeeToTeam(gs: GameState, did: string): string {
  const n = gs.negos[did];
  const d = gs.drivers[did];
  if (!n || n.feeAgreed || n.collapsed || !d.teamId) return '';
  const fromTeam = gs.teams[d.teamId];
  const ratio = n.feeOffer / Math.max(1, n.feeAsk);
  // команда категорически не отпустит лидера/звезду за бесценок при длинном контракте
  const isKeyDriver = d.pace > 84 || fromTeam.staffIds.length > 0 && raceDriversOfTeam(gs, fromTeam.id)[0]?.id === did;
  if (ratio < 0.45 && isKeyDriver && d.contract >= 2) {
    n.collapsed = true;
    return `${fromTeam.short}: «${d.name} не продаётся. Переговоры окончены»`;
  }
  const p = clamp(0.4 + (ratio - 1) * 2.4 + (100 - fromTeam.reputation) / 300, 0.05, 0.95);
  if (rnd() < p) {
    n.feeAgreed = true;
    maybeSealDeal(gs, did);
    return `${fromTeam.short} отпускает ${d.name} за ${money(n.feeOffer)}`;
  }
  // торг: команда уступает тем охотнее, чем ближе офер к её цене
  n.feeAsk = Math.round(n.feeAsk * (ratio > 0.85 ? 0.9 : ratio > 0.6 ? 0.95 : 0.99));
  return `${fromTeam.short}: «Цена ниже рыночной». Новая планка: ${money(n.feeAsk)}`;
}

export function cancelNego(gs: GameState, did: string) { delete gs.negos[did]; }
export function cancelDeal(gs: GameState, did: string) {
  gs.deals = gs.deals.filter((x) => x.did !== did);
  pushNews(gs, `Соглашение с ${gs.drivers[did].name} расторгнуто`, 'ТРАНСФЕРЫ');
}

function maybeSealDeal(gs: GameState, did: string) {
  const n = gs.negos[did];
  if (!n || !n.driverAgreed || !n.feeAgreed) return;
  gs.deals.push({ did, fee: n.feeOffer, salary: n.offerSalary, years: n.offerYears });
  delete gs.negos[did];
  pushNews(gs, `🤝 СДЕЛКА: ${gs.drivers[did].name} подписал контракт с ${playerTeam(gs).short} (${money(n.feeOffer)} отступных, ${money(n.offerSalary)}/год, ${n.offerYears} г.) — переход после финала сезона`, 'ТРАНСФЕРЫ');
}

export function startStaffNego(gs: GameState, sid: string, slotIdx: number): string | null {
  const s = gs.staff[sid];
  if (!s) return 'Специалист не найден';
  if (s.teamId === gs.playerTeamId) return 'Он уже в вашей команде';
  if (gs.staffNegos[sid] || gs.staffDeals.some((x) => x.sid === sid)) return 'Переговоры уже ведутся';
  const ask = Math.round(s.skill * s.skill * 260 * (1.1 + rnd() * 0.3));
  gs.staffNegos[sid] = { sid, askSalary: ask, offerSalary: ask, agreed: false, collapsed: false, slotIdx };
  return null;
}

export function offerToStaff(gs: GameState, sid: string): string {
  const n = gs.staffNegos[sid];
  const s = gs.staff[sid];
  if (!n || n.agreed || n.collapsed) return '';
  const ratio = n.offerSalary / Math.max(1, n.askSalary);
  const p = clamp(0.45 + (ratio - 1) * 2.5, 0.08, 0.95);
  if (rnd() < p) {
    n.agreed = true;
    gs.staffDeals.push({ sid, salary: n.offerSalary, slotIdx: n.slotIdx });
    delete gs.staffNegos[sid];
    pushNews(gs, `🤝 ${s.name} (${ROLE_NAMES[s.role]}, ${s.skill}) перейдёт к вам после сезона`, 'КАДРЫ');
    return `${s.name} согласен: ${money(n.offerSalary)}/год. Переход — после финала`;
  }
  n.askSalary = Math.round(n.askSalary * 0.95);
  if (ratio < 0.7) { n.collapsed = true; return `${s.name} оскорблён предложением — переговоры сорваны`; }
  return `${s.name}: «Хочу ${money(n.askSalary)}/год»`;
}

export function cancelStaffNego(gs: GameState, sid: string) { delete gs.staffNegos[sid]; }

/* ================= СПОНСОРЫ И ДОВЕРИЕ ВЛАДЕЛЬЦА ================= */

const SPONSOR_NAMES = [
  ['Petronas Prime', 'Oracle Cloud', 'Rolex Grand', 'Aramco Tech'],
  ['Santander Speed', 'Gulf Racing', 'Tag Heuer', 'BWT Aqua'],
  ['Pirelli Local', 'DHL Express', 'Singha Energy', 'Alpinestars'],
];

export function generateSponsors(gs: GameState): Sponsor[] {
  const rep = gs.reputation;
  const tierMult = SERIES_META[gs.playerSeries].budgetFactor;
  const tiers: Sponsor['tier'][] = ['title', 'major', 'partner'];
  return tiers.map((tier, i) => {
    const base = (tier === 'title' ? 9e6 : tier === 'major' ? 4.5e6 : 2e6) * (0.5 + rep / 100) * Math.max(0.25, tierMult);
    const goalPool = [
      { type: 'pts_per_round', target: tier === 'title' ? 25 : 15, label: `${tier === 'title' ? 25 : 15}+ очков команды за этап` },
      { type: 'podium', target: tier === 'title' ? 8 : 4, label: `${tier === 'title' ? 8 : 4}+ подиумов за сезон` },
      { type: 'top10', target: 12, label: 'Обе машины в топ-10 этапа' },
      { type: 'constructor_pos', target: tier === 'title' ? 3 : 6, label: `Место не ниже P${tier === 'title' ? 3 : 6} в Кубке конструкторов` },
    ];
    const goal = goalPool[(i + gs.seasonN) % goalPool.length];
    return {
      id: `sp_${gs.seasonN}_${i}`,
      name: SPONSOR_NAMES[i % 3][Math.floor(rnd() * 4)],
      tier, value: Math.round(base), goal: { ...goal, roundsMet: 0, seasonMet: false }, active: true,
    };
  });
}

export function sponsorRoundPayout(gs: GameState): number {
  // базовая выплата за этап от активных спонсоров
  return Math.round(gs.sponsors.filter((s) => s.active).reduce((sum, s) => sum + s.value / 24, 0));
}

export function evaluateSponsorsRound(gs: GameState, teamPts: number, bestPos: number, secondPos: number | null) {
  for (const s of gs.sponsors) {
    if (!s.active) continue;
    const g = s.goal;
    if (g.type === 'pts_per_round' && teamPts >= g.target) g.roundsMet++;
    if (g.type === 'podium' && bestPos <= 3) g.roundsMet++;
    if (g.type === 'top10' && bestPos <= 10 && secondPos != null && secondPos <= 10) g.roundsMet++;
  }
}

export function evaluateSponsorsSeason(gs: GameState, playerPos: number): string[] {
  const out: string[] = [];
  const totalRounds = gs.series[gs.playerSeries].rounds.length;
  for (const s of gs.sponsors) {
    if (!s.active) continue;
    const g = s.goal;
    let met = false;
    if (g.type === 'pts_per_round') met = g.roundsMet >= Math.ceil(totalRounds * 0.4);
    if (g.type === 'podium') met = g.roundsMet >= g.target;
    if (g.type === 'top10') met = g.roundsMet >= Math.ceil(totalRounds * 0.35);
    if (g.type === 'constructor_pos') met = playerPos <= g.target;
    g.seasonMet = met;
    if (met) {
      const bonus = Math.round(s.value * 0.3);
      gs.budget += bonus;
      playerTeam(gs).budget += bonus;
      out.push(`${s.name}: цель выполнена — бонус ${money(bonus)}`);
      gs.ownerTrust = clamp(gs.ownerTrust + 2, 0, 100);
    } else if (rnd() < 0.4) {
      s.active = false;
      out.push(`${s.name}: цель не выполнена — спонсор уходит`);
      gs.ownerTrust = clamp(gs.ownerTrust - 4, 0, 100);
    } else {
      out.push(`${s.name}: цель не выполнена, контракт продлён с предупреждением`);
      gs.ownerTrust = clamp(gs.ownerTrust - 2, 0, 100);
    }
  }
  return out;
}

export function applyTrustRound(gs: GameState, bestPos: number, dnfs: number) {
  let delta = 0;
  if (bestPos === 1) delta += 3;
  else if (bestPos <= 3) delta += 1.5;
  else if (bestPos <= 6) delta += 0.5;
  else if (bestPos > 12) delta -= 1.5;
  delta -= dnfs * 0.8;
  gs.ownerTrust = clamp(gs.ownerTrust + delta, 0, 100);
  if (gs.ownerTrust <= 8 && !gs.fired) {
    gs.fired = true;
    pushNews(gs, '🚪 Совет директоров расторг ваш контракт — доверие исчерпано', 'КАРЬЕРА');
  }
}

/* ================= ДРУГИЕ СЕРИИ (ИИ) ================= */

export function simOtherSeries(gs: GameState) {
  for (const sid of SERIES_ORDER) {
    if (sid === gs.playerSeries) continue;
    const ss = gs.series[sid];
    if (ss.current >= ss.rounds.length) continue;
    const c = ALL_CIRCUITS[ss.rounds[ss.current].circuitId];
    const ds = seriesDrivers(gs, sid);
    if (!ds.length) { ss.current++; continue; }
    const meta = SERIES_META[sid];
    const q = ds.map((d) => ({
      d,
      t: baseLap(c, sid) + 10 - carPerf(gs, gs.teams[d.teamId!], c) * 0.085 - driverSkill(d, 'quali', false) * 0.06 + rnd() * 1.2,
    })).sort((a, b) => a.t - b.t);
    if (meta.polePoints > 0) {
      ss.dStand[q[0].d.id] = (ss.dStand[q[0].d.id] ?? 0) + meta.polePoints;
      ss.tStand[q[0].d.teamId!] = (ss.tStand[q[0].d.teamId!] ?? 0) + meta.polePoints;
    }
    if (meta.revSprintPoints.length > 0) {
      const rev = [...q.slice(0, 10)].reverse();
      rev.forEach((r, i) => {
        const pts = meta.revSprintPoints[i] ?? 0;
        ss.dStand[r.d.id] = (ss.dStand[r.d.id] ?? 0) + pts;
        ss.tStand[r.d.teamId!] = (ss.tStand[r.d.teamId!] ?? 0) + pts;
      });
    }
    const race = q.map((r) => ({
      d: r.d,
      score: driverSkill(r.d, 'race', false) * 0.6 + carPerf(gs, gs.teams[r.d.teamId!], c) * 0.4 + rnd() * 14 - (rnd() < 0.07 ? 40 : 0),
      dnf: rnd() < 0.055,
    })).sort((a, b) => (a.dnf ? 1 : 0) - (b.dnf ? 1 : 0) || b.score - a.score);
    race.forEach((r, i) => {
      const pts = r.dnf ? 0 : meta.points[i] ?? 0;
      ss.dStand[r.d.id] = (ss.dStand[r.d.id] ?? 0) + pts;
      ss.tStand[r.d.teamId!] = (ss.tStand[r.d.teamId!] ?? 0) + pts;
      r.d.form = clamp(r.d.form + (i < 3 ? 2 : -0.5), 40, 95);
    });
    ss.rounds[ss.current].done = true;
    ss.rounds[ss.current].result = {
      quali: q.map((r, i) => makeRow(i + 1, r.d, fmtLap(r.t))),
      race: race.map((r, i) => makeRow(i + 1, r.d, r.dnf ? 'Сход' : i === 0 ? 'Победа' : `P${i + 1}`, r.dnf ? 0 : meta.points[i] ?? 0)),
    };
    ss.current++;
    if (rnd() < 0.45) pushNews(gs, `${meta.fullName}: ${race[0].d.name} побеждает на «${c.name}»`, meta.name);
  }
}

/* ================= КОНЕЦ / НАЧАЛО СЕЗОНА ================= */

export function isSeasonOver(gs: GameState): boolean {
  return gs.series[gs.playerSeries].current >= gs.series[gs.playerSeries].rounds.length;
}

function retireProb(age: number): number {
  // мягкая прогрессивная шкала: до 35 почти не уходят
  if (age < 35) return 0;
  if (age === 35) return 0.02;
  if (age === 36) return 0.04;
  if (age === 37) return 0.07;
  if (age === 38) return 0.12;
  if (age === 39) return 0.2;
  if (age >= 43) return 0.5;
  return 0.3;
}

/** Назначает «план завершения карьеры» на сезон: решает, кто уйдёт по его окончании. */
export function planRetirements(gs: GameState) {
  const n = gs.series[gs.playerSeries].rounds.length;
  for (const d of Object.values(gs.drivers)) {
    d.retiring = false;
    if (d.age >= 35 && d.teamId) {
      const pSeason = 1 - Math.pow(1 - retireProb(d.age), n); // шанс объявить за сезон
      d.willRetire = rnd() < pSeason;
    } else {
      d.willRetire = false;
    }
  }
}

/** Объявления о завершении карьеры в течение сезона: не позднее чем за 5 ГП до конца. */
function checkRetirements(gs: GameState) {
  const ss = gs.series[gs.playerSeries];
  const roundsLeft = ss.rounds.length - ss.current;
  for (const d of Object.values(gs.drivers)) {
    if (!d.teamId || !d.willRetire || d.retiring) continue;
    // вероятность объявления растёт к концу; за 5 ГП до конца — гарантированно
    const p = roundsLeft <= 5 ? 1 : 1 / Math.max(1, roundsLeft - 4);
    if (rnd() < p) {
      d.retiring = true;
      pushNews(gs, `🏁 ${d.name} (${gs.teams[d.teamId].short}, ${d.age} лет) объявил: этот сезон станет последним в его карьере`, 'КАРЬЕРА');
    }
  }
}

export function endSeason(gs: GameState) {
  const sid = gs.playerSeries;
  const ss = gs.series[sid];
  const meta = SERIES_META[sid];
  const dSorted = Object.entries(ss.dStand).sort((a, b) => b[1] - a[1]);
  const tSorted = Object.entries(ss.tStand).sort((a, b) => b[1] - a[1]);
  const champ = gs.drivers[dSorted[0]?.[0] ?? ''];
  const tChamp = gs.teams[tSorted[0]?.[0] ?? ''];
  const playerPos = tSorted.findIndex(([tid]) => tid === gs.playerTeamId) + 1;
  let rookieFine = 0;
  if (sid === 'f1' && gs.rookieUsed < 4) {
    rookieFine = (4 - gs.rookieUsed) * 250_000;
    gs.budget = Math.max(0, gs.budget - rookieFine);
    gs.reputation = clamp(gs.reputation - (4 - gs.rookieUsed) * 2, 0, 100);
    pushNews(gs, `Штраф ФИА: ${money(rookieFine)} за нарушение правила новичков (${gs.rookieUsed}/4 FP1)`, 'РЕГЛАМЕНТ');
  }
  const skillChanges: { did: string; delta: number }[] = [];
  for (const d of Object.values(gs.drivers)) {
    let delta = 0;
    if (d.age < 24) delta += 0.6 + rnd() * 1.3;
    else if (d.age <= 30) delta += rnd() * 0.8 - 0.35;
    else if (d.age <= 34) delta -= 0.3 + rnd() * 0.6;
    else delta -= 0.8 + rnd() * 1.1;
    delta += d.form > 78 ? 0.4 : d.form < 55 ? -0.3 : 0;
    const r = Math.round(delta * 10) / 10;
    if (r !== 0) {
      d.pace = clamp(d.pace + r * 0.8, 30, 99);
      d.racecraft = clamp(d.racecraft + r * 0.6, 30, 99);
      d.consistency = clamp(d.consistency + r * 0.4, 30, 99);
      d.wet = clamp(d.wet + r * 0.3, 30, 99);
      if (d.teamId) skillChanges.push({ did: d.id, delta: r });
    }
    d.age++;
    if (d.contract > 0) d.contract--;
    d.form = 68 + Math.round(rnd() * 14);
    d.value = Math.round(d.value * (1 + r * 0.02));
  }
  const pt = playerTeam(gs);
  // расходы: зарплаты пилотов и персонала за сезон
  const driverWages = raceDriversOfTeam(gs, pt.id).reduce((s, d) => s + d.salary, 0);
  const staffWages = pt.staffIds.reduce((s, id) => s + (gs.staff[id]?.salary ?? 0), 0);
  const wages = driverWages + staffWages;
  gs.budget = Math.max(0, gs.budget - wages);
  pt.budget = Math.max(0, pt.budget - wages);
  pushNews(gs, `Расходы на зарплаты: ${money(wages)} (пилоты ${money(driverWages)} + персонал ${money(staffWages)})`, 'ФИНАНСЫ');
  // призовые за место в Кубке конструкторов
  const prize = Math.round((2_500_000 * meta.budgetFactor * (1 + (11 - Math.min(playerPos, 11)) * 0.09)) * gs.mods.payMod);
  gs.budget += prize;
  pt.budget += prize;
  pushNews(gs, `Призовые за ${playerPos}-е место: ${money(prize)}`, 'ФИНАНСЫ');
  if (playerPos === 1) { gs.careerTitles++; pushNews(gs, '🏆 ВАША КОМАНДА — ЧЕМПИОН СРЕДИ КОНСТРУКТОРОВ!', 'ТРИУМФ'); }

  const sponsorNews = evaluateSponsorsSeason(gs, playerPos);
  for (const n of sponsorNews) pushNews(gs, n, 'СПОНСОРЫ');

  const moves: string[] = [];
  const dealsApplied = applyPlayerDeals(gs, moves);
  applyAiTransfers(gs, moves); // ИИ-сделки, анонсированные в течение сезона, вступают в силу

  // завершающие карьеру уходят
  const retirees = Object.values(gs.drivers).filter((d) => d.retiring);
  for (const d of retirees) {
    if (d.teamId) moves.push(`🏁 ${d.name} завершает карьеру (${gs.teams[d.teamId].short})`);
    if (d.seriesId) delete gs.series[d.seriesId].dStand[d.id];
    delete gs.components[d.id];
    gs.deals = gs.deals.filter((x) => x.did !== d.id);
    delete gs.drivers[d.id];
  }
  if (retirees.length) pushNews(gs, `Карьеру завершили: ${retirees.map((d) => d.name).join(', ')}`, 'КАРЬЕРА');

  // контракты ИИ
  for (const d of Object.values(gs.drivers)) {
    if (!d.teamId || d.contract > 0) continue;
    const t = gs.teams[d.teamId];
    if (t.id === gs.playerTeamId) { d.contract = 1 + Math.floor(rnd() * 2); continue; }
    if (rnd() < 0.5 + t.reputation / 300) d.contract = 1 + Math.floor(rnd() * 2);
    else { d.teamId = null; moves.push(`${d.name} покидает ${t.short}`); }
  }
  for (const t of Object.values(gs.teams)) {
    let seats = raceDriversOfTeam(gs, t.id).length;
    while (seats < 2) {
      const pool = Object.values(gs.drivers).filter((d) => !d.teamId);
      const candidates = pool.sort((a, b) => b.pace - a.pace);
      const target = candidates[Math.floor(rnd() * Math.min(6, candidates.length))];
      if (!target) {
        const nd = genJuniors(gs, 1)[0];
        nd.teamId = t.id;
        nd.seriesId = t.seriesId;
        nd.contract = 2;
        seats++;
        moves.push(`${t.short}: дебют новичка ${nd.name}`);
        continue;
      }
      target.teamId = t.id;
      target.seriesId = t.seriesId;
      target.contract = 1 + Math.floor(rnd() * 2);
      seats++;
      moves.push(`${target.name} → ${t.short}`);
    }
  }
  // промо из Ф2 в Ф1
  if (rnd() < 0.75) {
    const f2best = seriesDrivers(gs, 'f2').sort((a, b) => (gs.series.f2.dStand[b.id] ?? 0) - (gs.series.f2.dStand[a.id] ?? 0))[0];
    const weakF1 = Object.values(gs.teams).filter((t) => t.seriesId === 'f1').sort((a, b) => (gs.series.f1.tStand[a.id] ?? 0) - (gs.series.f1.tStand[b.id] ?? 0))[0];
    if (f2best && weakF1 && f2best.teamId !== gs.playerTeamId && weakF1.id !== gs.playerTeamId) {
      const victim = raceDriversOfTeam(gs, weakF1.id).sort((a, b) => a.pace - b.pace)[0];
      if (victim) {
        victim.teamId = null;
        victim.seriesId = 'f1';
        f2best.teamId = weakF1.id;
        f2best.seriesId = 'f1';
        moves.push(`⭐ ${f2best.name} повышен в Ф1 (${weakF1.short})`);
      }
    }
  }
  // трансферные переходы — в новости
  for (const m of moves.slice(0, 10)) pushNews(gs, m, 'ТРАНСФЕРЫ');
  gs.summary = {
    year: gs.year,
    champion: champ?.name ?? '—',
    teamChampion: tChamp?.name ?? '—',
    playerPos,
    driverMoves: moves.slice(0, 12),
    skillChanges: skillChanges.slice(0, 14),
    rookieFine, dealsApplied,
  };
  gs.phase = 'summary';
  saveGame('auto', gs);
}

function applyPlayerDeals(gs: GameState, moves: string[]): string[] {
  const out: string[] = [];
  const pt = playerTeam(gs);
  for (const deal of gs.deals) {
    const d = gs.drivers[deal.did];
    if (!d) continue;
    gs.budget = Math.max(0, gs.budget - deal.fee);
    pt.budget = Math.max(0, pt.budget - deal.fee);
    const seats = raceDriversOfTeam(gs, pt.id);
    if (seats.length >= 2) {
      const victim = [...seats].sort((a, b) => (a.pace + a.consistency) - (b.pace + b.consistency))[0];
      victim.teamId = null;
      moves.push(`${victim.name} освобождает кокпит ${pt.short}`);
    }
    const from = d.teamId ? gs.teams[d.teamId] : null;
    d.teamId = pt.id;
    d.seriesId = pt.seriesId;
    d.salary = deal.salary;
    d.contract = deal.years;
    if (pt.seriesId === 'f1' && !gs.components[d.id]) {
      gs.components[d.id] = { ICE: 1, TC: 1, 'MGU-H': 1, 'MGU-K': 1, ES: 1, CE: 1, EX: 1 };
    }
    pt.setups[d.id] = defaultSetup();
    const line = `${d.name} переходит в ${pt.short}${from ? ` из ${from.short}` : ''}`;
    moves.push(line);
    out.push(line);
  }
  for (const sd of gs.staffDeals) {
    const s = gs.staff[sd.sid];
    if (!s) continue;
    const idx = sd.slotIdx;
    if (idx >= 0 && pt.staffIds[idx] && gs.staff[pt.staffIds[idx]]) gs.staff[pt.staffIds[idx]].teamId = null;
    if (idx >= 0) pt.staffIds[idx] = s.id;
    s.teamId = pt.id;
    s.salary = sd.salary;
    const line = `${s.name} (${ROLE_NAMES[s.role]}) присоединяется к ${pt.short}`;
    moves.push(line);
    out.push(line);
  }
  gs.deals = [];
  gs.staffDeals = [];
  gs.negos = {};
  gs.staffNegos = {};
  return out;
}

/** ИИ-сделки, анонсированные в течение сезона, вступают в силу в конце. */
function applyAiTransfers(gs: GameState, moves: string[]) {
  for (const tr of gs.aiTransfers) {
    const d = gs.drivers[tr.did];
    const toTeam = gs.teams[tr.toTeamId];
    if (!d || !toTeam) continue;
    if (d.retiring) continue;              // передумал — завершает карьеру
    if (d.teamId === toTeam.id) continue;  // уже там
    const from = d.teamId ? gs.teams[d.teamId] : null;
    // если место занято — слабейший пилот получателя освобождает кокпит
    const seats = raceDriversOfTeam(gs, toTeam.id);
    if (seats.length >= 2) {
      const victim = [...seats].sort((a, b) => (a.pace + a.consistency) - (b.pace + b.consistency))[0];
      victim.teamId = null;
      moves.push(`${victim.name} освобождает кокпит ${toTeam.short}`);
    }
    if (d.seriesId && d.seriesId !== toTeam.seriesId) delete gs.series[d.seriesId].dStand[d.id];
    d.teamId = toTeam.id;
    d.seriesId = toTeam.seriesId;
    d.contract = 1 + Math.floor(rnd() * 2);
    gs.series[toTeam.seriesId].dStand[d.id] = gs.series[toTeam.seriesId].dStand[d.id] ?? 0;
    if (toTeam.seriesId === 'f1' && !gs.components[d.id]) {
      gs.components[d.id] = { ICE: 1, TC: 1, 'MGU-H': 1, 'MGU-K': 1, ES: 1, CE: 1, EX: 1 };
    }
    if (toTeam.seriesId === 'f2' || toTeam.seriesId === 'f3') gs.components[d.id] = { ENG: 1, wear: 0 };
    toTeam.setups[d.id] = defaultSetup();
    moves.push(`${d.name} переходит в ${toTeam.short}${from ? ` из ${from.short}` : ''}`);
  }
  gs.aiTransfers = [];
}

export function switchPlayerTeam(gs: GameState, teamId: string) {
  const t = gs.teams[teamId];
  gs.playerSeries = t.seriesId;
  gs.playerTeamId = teamId;
  gs.reputation = t.reputation;
  gs.phase = 'hub';
  pushNews(gs, `Новая глава: вы возглавили ${t.name}`, 'КАРЬЕРА');
  saveGame('auto', gs);
}

export function startNewSeason(gs: GameState) {
  gs.year++;
  gs.seasonN++;
  gs.mods = { ...gs.mods };
  genJuniors(gs, 30);
  planRetirements(gs);
  // ротация календаря
  for (const sid of SERIES_ORDER) {
    const ss = gs.series[sid];
    if (rnd() < 0.45 && ss.rounds.length > 5) {
      const res = RESERVES[sid];
      const idx = 2 + Math.floor(rnd() * (ss.rounds.length - 4));
      const oldId = ss.rounds[idx].circuitId;
      const nc = res[Math.floor(rnd() * res.length)];
      ss.rounds[idx] = { circuitId: nc.id, done: false };
      pushNews(gs, `Календарь ${SERIES_META[sid].name}: «${ALL_CIRCUITS[oldId].name}» → «${nc.name}»`, 'КАЛЕНДАРЬ');
    }
  }
  // регламент
  const ev = pick(REG_EVENTS);
  pushNews(gs, `РЕГЛАМЕНТ ${gs.year}: ${ev}`, 'РЕГЛАМЕНТ');
  if (ev.includes('силовых установок')) gs.mods.puLimitBonus += 1;
  if (ev.includes('Деградация снижена')) gs.mods.degMod = Math.max(0.7, gs.mods.degMod - 0.12);
  if (ev.includes('DRS сокращены')) gs.mods.drsMod = Math.max(0.6, gs.mods.drsMod - 0.15);
  if (ev.includes('Призовые')) gs.mods.payMod += 0.08;
  if (ev.includes('бюджетов')) gs.mods.capMod += 0.08;
  for (const sid of SERIES_ORDER) {
    const ss = gs.series[sid];
    ss.current = 0;
    for (const r of ss.rounds) { r.done = false; delete r.result; }
    for (const k of Object.keys(ss.dStand)) ss.dStand[k] = 0;
    for (const k of Object.keys(ss.tStand)) ss.tStand[k] = 0;
    for (const d of seriesDrivers(gs, sid)) ss.dStand[d.id] = 0;
  }
  for (const did of Object.keys(gs.components)) {
    const sidOf = gs.drivers[did]?.seriesId;
    if (sidOf === 'f2' || sidOf === 'f3') gs.components[did] = { ENG: 1, wear: 0 };
    else gs.components[did] = { ICE: 1, TC: 1, 'MGU-H': 1, 'MGU-K': 1, ES: 1, CE: 1, EX: 1 };
  }
  for (const t of Object.values(gs.teams)) { t.wear = 0; t.capSpent = 0; }
  gs.rookieUsed = 0;
  gs.nextRoundPen = {};
  gs.weekend = null;
  gs.summary = null;
  gs.fired = false;
  gs.ownerTrust = clamp(gs.ownerTrust + 10, 0, 100);
  gs.sponsors = generateSponsors(gs);
  gs.phase = 'hub';
  pushNews(gs, `Сезон ${gs.year} открыт. Удачи!`, 'СЕЗОН');
  saveGame('auto', gs);
}

/* ================= РЕДАКТОР ================= */

export function editorSet(gs: GameState, kind: 'driver' | 'team' | 'staff', id: string, field: string, value: number) {
  if (kind === 'driver' && gs.drivers[id]) (gs.drivers[id] as unknown as Record<string, number>)[field] = value;
  if (kind === 'team' && gs.teams[id]) (gs.teams[id] as unknown as Record<string, number>)[field] = value;
  if (kind === 'staff' && gs.staff[id]) (gs.staff[id] as unknown as Record<string, number>)[field] = value;
}

export function editorPoints(gs: GameState, sid: SeriesId, did: string, delta: number) {
  const ss = gs.series[sid];
  ss.dStand[did] = (ss.dStand[did] ?? 0) + delta;
  const d = gs.drivers[did];
  if (d?.teamId) ss.tStand[d.teamId] = (ss.tStand[d.teamId] ?? 0) + delta;
}

/* ================= СОХРАНЕНИЯ ================= */

const SAVE_KEY = (slot: string) => `apex_save_${slot}`;

export function saveGame(slot: string, gs: GameState) {
  try {
    const meta = {
      slot, year: gs.year, seasonN: gs.seasonN, series: gs.playerSeries,
      team: gs.teams[gs.playerTeamId]?.name ?? '—', phase: gs.phase, ts: Date.now(),
    };
    localStorage.setItem(SAVE_KEY(slot), JSON.stringify({ meta, gs }));
  } catch { /* quota */ }
}

export function loadGame(slot: string): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY(slot));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const gs = parsed.gs as GameState;
    if (!gs || !gs.teams) return null;
    // миграция со старых версий
    gs.negos = gs.negos ?? {};
    gs.deals = gs.deals ?? [];
    gs.staffNegos = gs.staffNegos ?? {};
    gs.staffDeals = gs.staffDeals ?? [];
    gs.programs = gs.programs ?? [];
    gs.sponsors = gs.sponsors?.length ? gs.sponsors : generateSponsors(gs);
    gs.ownerTrust = gs.ownerTrust ?? 60;
    gs.fired = gs.fired ?? false;
    gs.mods = gs.mods ?? { puLimitBonus: 0, degMod: 1, drsMod: 1, payMod: 1, capMod: 1 };
    for (const t of Object.values(gs.teams)) {
      t.setups = t.setups ?? {};
      t.tires = t.tires ?? 70;
      t.capSpent = t.capSpent ?? 0;
    }
    return gs;
  } catch { return null; }
}

export function listSaves(): ({ slot: string; year: number; seasonN: number; series: SeriesId; team: string; phase: string; ts: number } | null)[] {
  return ['auto', 's1', 's2', 's3'].map((slot) => {
    try {
      const raw = localStorage.getItem(SAVE_KEY(slot));
      if (!raw) return null;
      return JSON.parse(raw).meta;
    } catch { return null; }
  });
}

export function deleteSave(slot: string) {
  localStorage.removeItem(SAVE_KEY(slot));
}
