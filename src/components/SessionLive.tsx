import { useEffect, useRef, useState } from 'react';
import { useGame } from '../game/GameContext';
import { SERIES_META } from '../game/data';
import type { Setup, Stage } from '../game/types';
import {
  circuitOfRound, compoundDef, fmtLap, getTrack, makeSessionSim, sessionGridFor, stageTitle,
  stageToSimKind, tireName,
} from '../game/engine';
import type { SessionSim } from '../game/engine';
import TrackCanvas from './TrackCanvas';
import { Btn, FlagTag, Icon } from './ui';

const SPEEDS = [1, 2, 4, 8, 16];

export default function SessionLive({ stage, onDone, onAbort }: {
  stage: Stage;
  onDone: () => void;
  onAbort: () => void;
}) {
  const { gs, dispatch } = useGame();
  const sid = gs.playerSeries;
  const meta = SERIES_META[sid];
  const w = gs.weekend!;
  const circuit = circuitOfRound(gs, sid, w.roundIdx);
  const kind = stageToSimKind(stage);
  const grid = sessionGridFor(gs, stage);
  const [sim] = useState<SessionSim>(() => makeSessionSim(gs, kind, grid, circuit, w.weather[stage] === 'wet'));
  const [started, setStarted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const simRef = useRef(sim);
  simRef.current = sim;
  const [, force] = useState(0);
  const track = getTrack(circuit);
  const isQuali = kind === 'quali' || kind === 'sq';
  const canSetup = kind === 'practice'; // парк-ферме с начала квалификации

  useEffect(() => {
    if (!started) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const STEP = 1 / 240;
    const BASE = 60 * 0.5;
    const loop = (now: number) => {
      const dtReal = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += dtReal * BASE * speedRef.current;
      while (acc > STEP) { simRef.current.tick(STEP); acc -= STEP; }
      force((x) => (x + 1) % 1000000);
      if (simRef.current.done) {
        dispatch({ type: 'APPLY_SESSION', sim: simRef.current, stage });
        onDone();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  if (!started) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="panel clip p-8 max-w-2xl w-full reveal">
          <div className="checker h-2 mb-6" />
          <div className="font-disp text-[11px] tracking-[0.3em] text-[#7f8da0] mb-1">{stageTitle(gs, stage).toUpperCase()} · {circuit.country}</div>
          <h1 className="font-disp font-black text-3xl mb-1">{circuit.name.toUpperCase()}</h1>
          <div className="text-[13px] text-[#9fb0c4] mb-5 num">{grid.length} машин · {sim.wetSession ? 'мокрая трасса' : 'сухая трасса'}</div>
          <div className="mb-5 text-[12px] text-[#9fb0c4] border-l-2 pl-3 space-y-1" style={{ borderColor: meta.color }}>
            {isQuali ? (
              <>
                <p>Машины выезжают сериями быстрых кругов, между ними — боксы. Зачёт по лучшему кругу.</p>
                {sid === 'f1'
                  ? <p>Формат Q1→Q2→Q3: после каждого сегмента выбывают 5 медленнейших.</p>
                  : <p>Одна сессия, зачёт по лучшему кругу.</p>}
                <p className="text-[#e8d9a8]">🔒 Парк-ферме: настройки зафиксированы.</p>
              </>
            ) : (
              <p>Свободная практика: выпускайте машины на серию кругов, меняйте шины и крутите настройки. Инженеры дают советы после каждой серии.</p>
            )}
          </div>
          <div className="flex gap-3">
            <Btn variant="acc" onClick={() => setStarted(true)}><Icon name="play" />НАЧАТЬ СЕССИЮ</Btn>
            <Btn onClick={onAbort}><Icon name="back" />Назад к уик-энду</Btn>
          </div>
        </div>
      </div>
    );
  }

  const ranked = sim.ranked();
  const playerCars = sim.cars.filter((c) => c.isPlayer);
  const compounds = SERIES_META[sid].compounds.filter((c) =>
    sim.raining ? ['I', 'W', 'AW'].includes(c.id) : !['I', 'W'].includes(c.id));

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2 border-b border-[#252e3b] bg-[#0d1117cc] shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-disp font-black text-lg text-[#ff2d2d]">APEX</span>
          <span className="font-disp text-[11px] tracking-[0.2em] text-[#9fb0c4]">{stageTitle(gs, stage)} · {circuit.name}</span>
          <span className="font-disp text-[11px] font-bold px-2.5 py-0.5" style={{ background: meta.color, color: '#0d1016' }}>{sim.segment}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-disp font-bold text-[20px] text-[#ffc94d] num mr-3">{sim.displayClock()}</span>
          {SPEEDS.map((m) => (
            <button key={m} onClick={() => setSpeed(m)}
              className={`px-2 py-0.5 border font-disp text-[10px] font-bold transition-all ${speed === m ? 'bg-[#d8f224] text-[#10131a] border-[#d8f224]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#5a6a80]'}`}>
              ×{m}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ЛЕВО: тайминг */}
        <aside className="w-[44%] shrink-0 border-r border-[#252e3b] bg-[#0d1117] flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-[#1d242f] flex items-center justify-between shrink-0">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[#7f8da0] font-semibold">Тайминг · лучший круг</span>
            <span className="text-[9px] text-[#5a6a80]">отрыв | посл. | лучший</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {ranked.map((car, idx) => {
              const team = gs.teams[car.tid];
              const tire = compoundDef(sid, car.tire);
              const isElim = car.state === 'elim';
              const best = ranked.find((c) => c.bestLap != null)?.bestLap ?? null;
              const gap = car.bestLap != null && best != null ? car.bestLap - best : null;
              const isBestLap = car.bestLap != null && best != null && Math.abs(car.bestLap - best) < 0.0005;
              return (
                <div key={car.did}
                  className={`flex items-center gap-2.5 px-3 py-[7px] border-l-[3px] text-[14px] transition-colors ${car.isPlayer ? 'bg-[#1a2230]' : 'hover:bg-[#141a23]'} ${isElim ? 'opacity-45' : ''}`}
                  style={{ borderLeftColor: team.color }}>
                  <span className="font-disp font-bold w-8 text-[13px] text-[#9fb0c4]">{isElim ? '—' : idx + 1}</span>
                  <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2" style={{ borderColor: tire.color, background: `${tire.color}33` }} title={tire.name} />
                  <span className="font-bold w-12">{car.code}</span>
                  <span className="text-[#9fb0c4] truncate flex-1 text-[13px]">{car.name}</span>
                  <span className={`font-disp text-[9px] font-bold px-1.5 py-0.5 ${car.state === 'flying' ? 'text-[#4ade80]' : car.state === 'garage' ? 'text-[#7f8da0]' : 'text-[#ff6b4b]'}`}>
                    {car.state === 'flying' ? 'ТРК' : car.state === 'garage' ? 'БОКС' : `OUT ${car.eliminatedIn}`}
                  </span>
                  <span className="num text-[#e7edf4] w-[74px] text-right font-semibold text-[13px]">
                    {isElim || gap == null ? '—' : isBestLap ? fmtLap(car.bestLap!) : `+${gap.toFixed(3)}`}
                  </span>
                  <span className="num w-[80px] text-right text-[12px] text-[#7f8da0]">{car.lastLap != null ? fmtLap(car.lastLap) : '—'}</span>
                  <span className={`num w-[80px] text-right text-[13px] font-bold ${isBestLap ? 'text-[#c884ff]' : 'text-[#c8d4e2]'}`}>
                    {car.bestLap != null ? fmtLap(car.bestLap) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ПРАВО: трасса + управление */}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 relative">
            <TrackCanvas sim={null as never} track={track} seriesColor={meta.color} raining={sim.raining} />
            <SessionTrackOverlay sim={sim} track={track} seriesColor={meta.color} />
          </div>

          <div className="shrink-0 border-t border-[#252e3b] bg-[#0d1117] p-2.5 max-h-[44%] overflow-y-auto">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#7f8da0] px-1 mb-1.5 font-semibold">Пит-уолл — ваши машины</div>
            <div className="space-y-2">
              {playerCars.map((car) => (
                <div key={car.did} className="border border-[#2a3442] bg-[#10151d] px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <FlagTag nat={car.nat} />
                    <span className="font-bold text-[13px]">{car.code}</span>
                    <span className={`font-disp text-[9px] font-bold px-1.5 py-0.5 ${car.state === 'flying' ? 'bg-[#2f8f4e] text-white' : car.state === 'garage' ? 'bg-[#3a4757] text-[#c8d4e2]' : 'bg-[#8a2430] text-white'}`}>
                      {car.state === 'flying' ? 'НА ТРАССЕ' : car.state === 'garage' ? 'БОКСЫ' : `ВЫБЫЛ ${car.eliminatedIn ?? ''}`}
                    </span>
                    <span className="ml-auto text-[11px] num text-[#9fb0c4]">{tireName(sid, car.tire)} · {car.tireAge} кр</span>
                  </div>
                  {car.state !== 'elim' && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {car.state === 'garage' ? (
                        <button onClick={() => { sim.sendOut(car.did); force((x) => x + 1); }}
                          className="font-disp text-[10px] font-bold px-3 py-1 bg-[#2f8f4e] hover:bg-[#3aa85f] text-white transition-colors">
                          ВЫЕЗД НА ТРАССУ
                        </button>
                      ) : (
                        <button onClick={() => { sim.boxCarIn(car.did); force((x) => x + 1); }}
                          disabled={car.boxNext}
                          className="font-disp text-[10px] font-bold px-3 py-1 bg-[#b08420] hover:bg-[#c99a2e] disabled:opacity-40 text-white transition-colors">
                          {car.boxNext ? 'ЗАЕЗЖАЕТ…' : 'BOX — В БОКСЫ'}
                        </button>
                      )}
                      <span className="text-[9px] font-disp font-bold tracking-wider text-[#5a6a80] ml-1">СЕРИЯ:</span>
                      {[2, 3, 4, 5, 6].map((n) => (
                        <button key={n} onClick={() => { sim.setRunLen(car.did, n); force((x) => x + 1); }}
                          className={`w-6 h-6 font-disp text-[10px] font-bold border transition-colors ${car.runLen === n ? 'bg-[#d8f224] text-[#10131a] border-[#d8f224]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#5a6a80]'}`}>
                          {n}
                        </button>
                      ))}
                      {canSetup && car.state === 'garage' && (
                        <>
                          <span className="text-[9px] font-disp font-bold tracking-wider text-[#5a6a80] ml-1">ШИНЫ:</span>
                          {compounds.map((c) => (
                            <button key={c.id} onClick={() => { sim.setSessionTire(car.did, c.id); force((x) => x + 1); }}
                              className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${car.tire === c.id ? 'border-white bg-[#20293a]' : 'border-[#2a3442] hover:border-[#4a5a70]'}`}
                              title={c.name}>
                              <span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: c.color, background: `${c.color}33` }} />
                              {c.short}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                  {canSetup && car.state !== 'elim' && (
                    <div className="grid grid-cols-2 gap-x-5 gap-y-0.5 mt-1.5">
                      {([['aero', 'Прижим'], ['mech', 'Мех. зацеп'], ['tires', 'Давление'], ['brake', 'Торм. баланс'], ['diff', 'Дифференциал']] as [keyof Setup, string][]).map(([f, label]) => (
                        <label key={f} className="flex items-center gap-2 text-[11px] text-[#9fb0c4]">
                          <span className="w-[86px] shrink-0">{label}</span>
                          <input type="range" min={0} max={100}
                            value={car.setup[f]}
                            onChange={(e) => { sim.setSetupField(gs, car.did, f, +e.target.value); force((x) => x + 1); }}
                            className="flex-1 accent-[#d8f224]" />
                          <span className="num w-7 text-right text-[#e7edf4] font-semibold">{Math.round(car.setup[f])}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {car.advice && (
                    <div className="mt-1.5 text-[11.5px] leading-snug border-l-2 border-[#ffc94d] pl-2 text-[#e8d9a8]">
                      {car.advice}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-2 max-h-[80px] overflow-y-auto">
              {[...sim.events].reverse().slice(0, 10).map((e, i) => (
                <div key={sim.events.length - i} className="text-[11.5px] leading-tight px-1 py-0.5 text-[#9fb0c4]">{e.text}</div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/** Отрисовка машин сессии поверх трассы (SessionSim не совместим с RaceSim-пропсом) */
function SessionTrackOverlay({ sim, track, seriesColor }: { sim: SessionSim; track: import('../game/types').TrackGeo; seriesColor: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const simRef = useRef(sim);
  simRef.current = sim;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const s = simRef.current;
      const W = cv.clientWidth, H = cv.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const sc = Math.min(W / 1080, H / 700);
      const ox = (W - 1000 * sc) / 2, oy = (H - 620 * sc) / 2;
      const tf = (x: number) => ox + x * sc;
      const tfy = (y: number) => oy + y * sc;
      const posAt = (dist: number) => {
        const total = track.total;
        const d = ((dist % total) + total) % total;
        let lo = 0, hi = track.cum.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (track.cum[mid] <= d) lo = mid; else hi = mid - 1; }
        const i = lo % track.pts.length;
        const j = (i + 1) % track.pts.length;
        const span = track.cum[lo + 1] - track.cum[lo] || 1;
        const k = (d - track.cum[lo]) / span;
        const p = track.pts[i], q = track.pts[j];
        return { x: p[0] + (q[0] - p[0]) * k, y: p[1] + (q[1] - p[1]) * k, a: Math.atan2(q[1] - p[1], q[0] - p[0]) };
      };
      const now = performance.now();
      const pulse = 0.5 + 0.5 * Math.sin(now / 300);
      const onTrack = s.cars.filter((c) => c.state === 'flying').sort((a, b) => b.dist - a.dist);
      onTrack.forEach((car, rank) => {
        const { x, y, a } = posAt(car.dist);
        const X = tf(x), Y = tfy(y);
        ctx.save();
        ctx.translate(X, Y);
        ctx.rotate(a);
        const L = (car.isPlayer ? 12 : 10) * sc;
        if (rank === 0) { ctx.shadowColor = seriesColor; ctx.shadowBlur = 12 + pulse * 6; }
        else if (car.isPlayer) { ctx.shadowColor = '#d8f224'; ctx.shadowBlur = 10; }
        ctx.fillStyle = car.color;
        ctx.beginPath();
        ctx.moveTo(L, 0);
        ctx.lineTo(-L * 0.7, L * 0.55);
        ctx.lineTo(-L * 0.4, 0);
        ctx.lineTo(-L * 0.7, -L * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        if (rank === 0 || car.isPlayer) {
          ctx.font = `700 ${Math.max(9, 10 * sc)}px Orbitron, sans-serif`;
          ctx.fillStyle = rank === 0 ? '#ffd75c' : '#d8f224';
          ctx.fillText(car.code, X + 10 * sc, Y - 8 * sc);
        }
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [track, seriesColor]);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" />;
}
