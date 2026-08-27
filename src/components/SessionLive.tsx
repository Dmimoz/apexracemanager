import { useEffect, useRef, useState } from 'react';
import { useGame } from '../game/GameContext';
import { SERIES_META } from '../game/data';
import type { Setup, Stage } from '../game/types';
import {
  circuitOfRound, compoundDef, dryCompounds, fmtLap, getTrack, makeSessionSim, sessionGridFor,
  stageTitle, stageToSimKind, tireName,
} from '../game/engine';
import type { SessionProgram, SessionSim } from '../game/engine';
import TrackCanvas from './TrackCanvas';
import { Btn, FlagTag, Icon, TeamDot } from './ui';

const SPEEDS = [1, 2, 4, 8, 16];

const PROGRAMS: { id: SessionProgram; name: string; hint: string }[] = [
  { id: 'quali', name: 'Квал. темп', hint: 'короткие серии, мягкие шины' },
  { id: 'race', name: 'Гон. симуляция', hint: 'длинные отрезки, полный бак' },
  { id: 'tires', name: 'Тест шин', hint: 'чередование составов' },
];

const SETUP_FIELDS: { f: keyof Setup; label: string }[] = [
  { f: 'aero', label: 'Прижим' },
  { f: 'mech', label: 'Мех. зацеп' },
  { f: 'tires', label: 'Давление' },
  { f: 'brake', label: 'Торм. баланс' },
  { f: 'diff', label: 'Дифференциал' },
];

export default function SessionLive({ stage, startTires, onDone, onAbort }: {
  stage: Stage;
  startTires?: Record<string, string>;
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
  const [sim] = useState<SessionSim>(() => makeSessionSim(gs, kind, grid, circuit, w.weather[stage] === 'wet', startTires));
  const [started, setStarted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const simRef = useRef(sim);
  simRef.current = sim;
  const [, force] = useState(0);
  const track = getTrack(circuit);
  const isQuali = kind === 'quali' || kind === 'sq';
  const isPractice = kind === 'practice';
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const lastSegRef = useRef<string>('');

  const finish = () => {
    dispatch({ type: 'APPLY_SESSION', sim: simRef.current, stage });
    onDone();
  };

  useEffect(() => {
    if (!started) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const STEP = 1 / 240;
    const BASE = 12; // 1 реальная сек = 12 сим-сек: сессии идут вдвое медленнее, игрок успевает управлять
    const loop = (now: number) => {
      const dtReal = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) {
        acc += dtReal * BASE * speedRef.current;
        while (acc > STEP) { simRef.current.tick(STEP); acc -= STEP; }
        // авто-пауза при старте нового сегмента (Q2/Q3/SQ…), чтобы успеть выпустить машины
        if (simRef.current.segment !== lastSegRef.current) {
          if (lastSegRef.current !== '' && !simRef.current.done) setPaused(true);
          lastSegRef.current = simRef.current.segment;
        }
      }
      force((x) => (x + 1) % 1000000);
      if (simRef.current.done) { finish(); return; }
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
              <>
                <p>Ваши машины стоят в боксах: выпускайте их на трассу кнопкой «ВЫЕЗД», задавайте число кругов в серии и комплект шин.</p>
                <p>Инженеры дают советы по настройкам после каждой серии. Менять настройки можно прямо по ходу практики.</p>
              </>
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
  const best = ranked[0]?.bestLap ?? 0;
  const slicks = dryCompounds(sid);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0a0c10]">
      {/* ШАПКА */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-[#252e3b] bg-[#0d1117] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-disp font-black text-lg" style={{ color: meta.color }}>APEX</span>
          <span className="font-disp text-[11px] tracking-[0.15em] text-[#9fb0c4] truncate">{stageTitle(gs, stage)} · {circuit.name}</span>
          <span className="font-disp text-[11px] font-bold px-2.5 py-0.5 shrink-0" style={{ background: meta.color, color: '#0d1016' }}>{sim.segment}</span>
          {sim.raining && <span className="font-disp text-[10px] font-bold text-[#5c9eff] border border-[#5c9eff55] px-2 py-0.5">ДОЖДЬ</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-disp font-bold text-[22px] text-[#ffc94d] num mr-3">{sim.displayClock()}</span>
          <button onClick={() => setPaused((p) => !p)}
            className={`px-3 py-0.5 border font-disp text-[10px] font-bold transition-all ${paused ? 'bg-[#4ade80] text-[#0d1016] border-[#4ade80]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#5a6a80]'}`}>
            {paused ? '▶ ПРОДОЛЖИТЬ' : '⏸ ПАУЗА'}
          </button>
          {SPEEDS.map((m) => (
            <button key={m} onClick={() => setSpeed(m)}
              className={`px-2 py-0.5 border font-disp text-[10px] font-bold transition-all ${speed === m ? 'bg-[#d8f224] text-[#10131a] border-[#d8f224]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#5a6a80]'}`}>
              ×{m}
            </button>
          ))}
          <Btn className="!py-1 !px-3 ml-2" onClick={() => { simRef.current.fastForward(); finish(); }} title="Досимулировать сессию до конца">
            <Icon name="flag" size={13} />ЗАВЕРШИТЬ
          </Btn>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ЛЕВО: тайминг-тауэр */}
        <aside className="w-[240px] shrink-0 border-r border-[#252e3b] bg-[#0d1117] flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-[#1d242f] text-[10px] uppercase tracking-[0.18em] text-[#7f8da0] shrink-0">
            Классификация · лучший круг
          </div>
          <div className="flex-1 overflow-y-auto">
            {ranked.map((car, i) => {
              const t = gs.teams[car.tid];
              const cd = compoundDef(sid, car.tire);
              const gap = car.bestLap != null && best > 0 ? (i === 0 ? fmtLap(car.bestLap) : `+${(car.bestLap - best).toFixed(3)}`) : '—';
              const state = car.state === 'elim' ? `ВЫБЫЛ ${car.eliminatedIn}` : car.state === 'flying' ? (car.phase2 === 'push' ? 'КРУГ' : car.phase2 === 'out' ? 'ВЫЕЗД' : 'ЗАЕЗД') : 'БОКСЫ';
              return (
                <div key={car.did}
                  className={`flex items-center gap-1.5 px-2 py-[5px] border-l-2 border-b border-b-[#161c26] text-[12px] ${car.isPlayer ? 'bg-[#1a2230]' : ''} ${car.state === 'elim' ? 'opacity-35' : ''}`}
                  style={{ borderLeftColor: t.color }}>
                  <span className="font-disp font-bold w-5 text-[10px] text-[#7f8da0]">{car.state === 'elim' ? '·' : i + 1}</span>
                  <span className="w-2.5 h-2.5 rounded-full border-2 shrink-0" style={{ borderColor: cd.color, background: `${cd.color}33` }} />
                  <span className="font-bold w-9">{car.code}</span>
                  <span className="num text-[#e7edf4] flex-1 text-right">{gap}</span>
                  <span className={`font-disp text-[8px] font-bold w-11 text-right ${car.state === 'flying' ? 'text-[#4ade80]' : car.state === 'elim' ? 'text-[#ff6b4b]' : 'text-[#5a6a80]'}`}>{state}</span>
                </div>
              );
            })}
          </div>
          <div className="px-3 py-1.5 border-t border-[#1d242f] text-[9px] text-[#5a6a80] shrink-0">
            КРУГ — атака · ВЫЕЗД/ЗАЕЗД — прогрев/охлаждение
          </div>
        </aside>

        {/* ЦЕНТР: трасса */}
        <main className="flex-1 min-w-0 relative bg-[#080a0e]">
          <TrackCanvas sim={sim} track={track} seriesColor={meta.color} phase="green" raining={sim.raining} />
          <div className="absolute bottom-3 left-3 flex gap-2">
            <button onClick={onAbort} className="btn-race !py-1.5 !px-3 opacity-80 hover:opacity-100"><span className="text-[9px]">ВЫЙТИ</span></button>
          </div>
        </main>

        {/* ПРАВО: управление пилотами */}
        <aside className="w-[330px] shrink-0 border-l border-[#252e3b] bg-[#0d1117] flex flex-col min-h-0 overflow-y-auto">
          <div className="px-3 py-2 border-b border-[#1d242f] text-[10px] uppercase tracking-[0.18em] text-[#7f8da0] shrink-0">
            {isPractice ? 'Программы работы · ваши пилоты' : 'Ваши пилоты'}
          </div>
          <div className="p-2 space-y-2">
            {playerCars.map((car) => {
              const cd = compoundDef(sid, car.tire);
              const wear = Math.min(100, Math.round(car.wear));
              const onTrack = car.state === 'flying';
              return (
                <div key={car.did} className="border border-[#2a3442] bg-[#10151d] p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <FlagTag nat={car.nat} />
                    <span className="font-bold text-[13px]">{car.name}</span>
                    <span className={`ml-auto font-disp text-[9px] font-bold px-1.5 py-0.5 ${onTrack ? 'bg-[#2f8f4e] text-white' : 'bg-[#3a4757] text-[#c8d4e2]'}`}>
                      {onTrack ? 'НА ТРАССЕ' : 'БОКСЫ'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] num mb-2">
                    <span className="text-[#7f8da0]">Лучший: <b className="text-[#e7edf4]">{car.bestLap != null ? fmtLap(car.bestLap) : '—'}</b></span>
                    <span className="text-[#7f8da0] flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: cd.color, background: `${cd.color}33` }} />
                      {cd.name} · {wear}%
                    </span>
                  </div>

                  {isPractice && (
                    <div className="grid grid-cols-3 gap-1.5 mb-2">
                      {PROGRAMS.map((p) => (
                        <button key={p.id} onClick={() => { sim.setProgram(car.did, p.id); force((x) => x + 1); }}
                          title={p.hint}
                          className={`px-1 py-1.5 text-[10px] font-bold border transition-all leading-tight ${car.program === p.id ? 'bg-[#d8f224] text-[#10131a] border-[#d8f224]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#5a6a80]'}`}>
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 mb-2">
                    <button onClick={() => { sim.sendOut(car.did); force((x) => x + 1); }} disabled={onTrack}
                      className="flex-1 py-1 text-[10px] font-bold border border-[#2f8f4e] text-[#4ade80] disabled:opacity-30 hover:bg-[#2f8f4e22] transition-colors">ВЫЕЗД</button>
                    <button onClick={() => { sim.boxCarIn(car.did); force((x) => x + 1); }} disabled={!onTrack || car.phase2 !== 'push'}
                      className="flex-1 py-1 text-[10px] font-bold border border-[#b08420] text-[#ffc94d] disabled:opacity-30 hover:bg-[#b0842022] transition-colors">В БОКСЫ</button>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => { sim.setRunLen(car.did, car.runLen - 1); force((x) => x + 1); }}
                        className="w-5 h-5 border border-[#2a3442] text-[#9fb0c4] text-[10px] font-bold">−</button>
                      <span className="num w-5 text-center text-[11px] font-bold text-[#e7edf4]" title="Кругов в серии">{car.runLen}</span>
                      <button onClick={() => { sim.setRunLen(car.did, car.runLen + 1); force((x) => x + 1); }}
                        className="w-5 h-5 border border-[#2a3442] text-[#9fb0c4] text-[10px] font-bold">+</button>
                    </div>
                  </div>

                  {isPractice && !onTrack && slicks.length > 1 && (
                    <div className="flex items-center gap-1 mb-2 flex-wrap">
                      <span className="text-[9px] uppercase tracking-wider text-[#5a6a80] mr-0.5">Шины:</span>
                      {slicks.map((c) => (
                        <button key={c.id} onClick={() => { sim.setSessionTire(car.did, c.id); force((x) => x + 1); }}
                          className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${car.tire === c.id ? 'border-white bg-[#20293a]' : 'border-[#2a3442] hover:border-[#4a5a70]'}`}>
                          <span className="w-2 h-2 rounded-full border-2" style={{ borderColor: c.color, background: `${c.color}33` }} />{c.short}
                        </button>
                      ))}
                    </div>
                  )}

                  {isPractice && (
                    <div className="space-y-0.5">
                      {SETUP_FIELDS.map(({ f, label }) => (
                        <label key={f} className="flex items-center gap-2 text-[10px] text-[#9fb0c4]">
                          <span className="w-[72px] shrink-0">{label}</span>
                          <input type="range" min={0} max={100} value={car.setup[f]}
                            onChange={(e) => { sim.setSetupField(gs, car.did, f, +e.target.value); force((x) => x + 1); }}
                            className="flex-1 accent-[#d8f224]" />
                          <span className="num w-6 text-right text-[#e7edf4] font-semibold">{Math.round(car.setup[f])}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {isPractice && car.advice && (
                    <div className="mt-1.5 text-[10.5px] leading-snug border-l-2 border-[#ffc94d] pl-2 text-[#e8d9a8]">{car.advice}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-2 pb-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#7f8da0] mb-1">Радио · события</div>
            <div className="max-h-[140px] overflow-y-auto space-y-0.5">
              {[...sim.events].reverse().slice(0, 12).map((e, i) => (
                <div key={sim.events.length - i} className="text-[10.5px] leading-tight px-1.5 py-0.5 bg-[#10151d] border-l-2 border-[#2a3442] text-[#9fb0c4]">{e.text}</div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
