import { useEffect, useRef, useState } from 'react';
import { useGame } from '../game/GameContext';
import { SERIES_META } from '../game/data';
import type { Stage, StrategyPreset } from '../game/types';
import {
  circuitOfRound, compoundDef, fmtLap, getTrack, gridForStage, makeRaceSim, stageTitle, tireName,
} from '../game/engine';
import type { RaceSim } from '../game/engine';
import TrackCanvas from './TrackCanvas';
import { Btn, FlagTag, Icon } from './ui';

const SPEEDS = [1, 2, 4, 8, 16, 32];

export default function RaceLive({ stage, startTires, onDone, onAbort }: {
  stage: Stage;
  startTires: Record<string, string>;
  onDone: () => void;
  onAbort: () => void;
}) {
  const { gs, dispatch } = useGame();
  const sid = gs.playerSeries;
  const meta = SERIES_META[sid];
  const w = gs.weekend!;
  const circuit = circuitOfRound(gs, sid, w.roundIdx);
  const grid = gridForStage(gs, stage);
  const [sim] = useState<RaceSim>(() => makeRaceSim(
    gs, stage === 'race' ? 'race' : stage === 'sprint' ? 'sprint' : 'sprintRev',
    grid, circuit, w.weather[stage] === 'wet', w.rainMidRace, startTires,
  ));
  const [started, setStarted] = useState(false);
  const [speed, setSpeed] = useState(8); // ×1 — замедленный просмотр, ×8 — комфортный темп
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const simRef = useRef(sim);
  simRef.current = sim;
  const [, force] = useState(0);
  const track = getTrack(circuit);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const prevPhaseRef = useRef<string>('green');
  const appliedRef = useRef(false); // гарантия однократного применения результатов
  const [raceDone, setRaceDone] = useState(false);
  const raceDoneRef = useRef(false);
  // Отслеживание смены позиций: зелёная ▲ (выиграл) / красная ▼ (потерял) с количеством
  const lastPosRef = useRef<Record<string, number>>({});
  const posDeltasRef = useRef<Record<string, { delta: number; ts: number }>>({});

  // Подвести итоги — только по клику игрока (не выкидываем из трансляции автоматически)
  const finish = () => {
    if (!appliedRef.current) {
      appliedRef.current = true;
      dispatch({ type: 'APPLY_SESSION', sim: simRef.current, stage });
    }
    onDone();
  };

  useEffect(() => {
    if (!started) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const STEP = 1 / 240;
    const BASE = 60 * 0.05; // базовая скорость ×1 — замедлена в 8 раз
    const loop = (now: number) => {
      const dtReal = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = simRef.current;
      // авто-пауза при появлении машины безопасности / красных флагов;
      // при рестарте после красного флага пауза снимается автоматически
      if (s.phase !== prevPhaseRef.current) {
        if (s.phase === 'sc' || s.phase === 'vsc' || s.phase === 'red') setPaused(true);
        if (prevPhaseRef.current === 'red' && s.phase === 'green') setPaused(false);
        prevPhaseRef.current = s.phase;
      }
      // красный флаг: отсчёт до рестарта идёт в РЕАЛЬНОМ времени и не блокируется паузой
      if (s.phase === 'red') {
        s.tickRedFlag(dtReal);
      } else if (!s.done && !pausedRef.current) {
        acc += dtReal * BASE * speedRef.current;
        while (acc > STEP) { s.tick(STEP); acc -= STEP; }
      }
      force((x) => (x + 1) % 1000000);
      // когда все машины финишировали — не закрываем трансляцию, а ждём клика игрока
      if (s.done && !raceDoneRef.current) {
        raceDoneRef.current = true;
        setRaceDone(true);
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
          <div className="text-[13px] text-[#9fb0c4] mb-5 num">{sim.totalLaps} кругов · {circuit.lenKm} км · {grid.length} машин</div>
          <div className="mb-5 text-[12px] text-[#9fb0c4] border-l-2 pl-3 space-y-1" style={{ borderColor: meta.color }}>
            <p>Управляйте своими машинами с пит-уолла: пит-стопы, режим гонки, топливо, командные приказы.</p>
            <p>Следите за машиной безопасности, флагами и износом шин.</p>
          </div>
          <div className="flex gap-3">
            <Btn variant="acc" onClick={() => setStarted(true)}><Icon name="play" />СТАРТ</Btn>
            <Btn onClick={onAbort}><Icon name="back" />Назад к уик-энду</Btn>
          </div>
        </div>
      </div>
    );
  }

  const cars = [...sim.cars].sort((a, b) => a.pos - b.pos);
  const leader = cars.find((c) => c.pos === 1);
  const playerCars = cars.filter((c) => c.isPlayer);
  const finCars = cars.filter((c) => c.status === 'fin');
  const winnerT = finCars.length ? Math.min(...finCars.map((c) => c.finishT)) : 0;
  const slicks = SERIES_META[sid].compounds.filter((c) => !['I', 'W'].includes(c.id));
  const wetTires = SERIES_META[sid].compounds.filter((c) => ['I', 'W', 'AW'].includes(c.id));

  // Обновляем дельты позиций (машины на трассе; в боксах/сходах не считаем, чтобы не шуметь)
  const nowMs = performance.now();
  for (const car of cars) {
    const inPit = car.pitting || car.pitCrawl > 0;
    const onTrack = car.status === 'run' && !inPit;
    const prev = lastPosRef.current[car.did];
    if (onTrack && prev != null && prev !== car.pos) {
      const d = prev - car.pos; // + = поднялся
      const existing = posDeltasRef.current[car.did];
      // серия обгонов в одном направлении складывается в одну стрелку (▲2, ▼3…)
      if (existing && nowMs - existing.ts < 4000 && Math.sign(existing.delta) === Math.sign(d)) {
        existing.delta += d;
        existing.ts = nowMs;
      } else {
        posDeltasRef.current[car.did] = { delta: d, ts: nowMs };
      }
    }
    if (car.status === 'run') lastPosRef.current[car.did] = car.pos;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2 border-b border-[#252e3b] bg-[#0d1117cc] shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-disp font-black text-lg text-[#ff2d2d]">APEX</span>
          <span className="font-disp text-[11px] tracking-[0.2em] text-[#9fb0c4]">{stageTitle(gs, stage)} · {circuit.name}</span>
          <span className="font-disp text-[11px] font-bold px-2.5 py-0.5" style={{ background: meta.color, color: '#0d1016' }}>
            КРУГ {Math.min((leader?.lap ?? 0) + 1, sim.totalLaps)}/{sim.totalLaps}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(sim.phase === 'sc' || sim.phase === 'vsc' || sim.phase === 'red') && (
            <span className={`font-disp text-[9px] font-bold px-2 py-0.5 ${sim.phase === 'red' ? 'bg-[#c8102e] text-white' : 'bg-[#ffc94d] text-[#1a1408] blink'}`}>
              {sim.phase === 'red'
                ? `КРАСНЫЙ ФЛАГ · ${Math.max(0, Math.ceil(sim.redRemaining))} с`
                : sim.phase === 'sc' ? 'МАШИНА БЕЗОПАСНОСТИ' : 'ВИРТУАЛЬНЫЙ SC'}
            </span>
          )}
          <button onClick={() => setPaused((p) => !p)}
            className={`px-3 py-0.5 border font-disp text-[10px] font-bold transition-all ${paused ? 'bg-[#4ade80] text-[#0d1016] border-[#4ade80]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#5a6a80]'}`}>
            {paused ? '▶ ПРОДОЛЖИТЬ' : '⏸ ПАУЗА'}
          </button>
          <span className="text-[9px] font-disp font-bold tracking-widest text-[#5a6a80] mr-1">СКОРОСТЬ</span>
          {SPEEDS.map((m) => (
            <button key={m} onClick={() => setSpeed(m)}
              className={`px-2 py-0.5 border font-disp text-[10px] font-bold transition-all ${speed === m ? 'bg-[#d8f224] text-[#10131a] border-[#d8f224]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#5a6a80]'}`}>
              ×{m}
            </button>
          ))}
        </div>
      </header>
      {sim.phase === 'red' && !raceDone && (
        <div className="shrink-0 px-4 py-2 bg-[#3a0d12] border-b border-[#c8102e] flex items-center gap-3 flex-wrap">
          <span className="font-disp text-[12px] font-bold tracking-[0.12em] text-white blink">🔴 КРАСНЫЙ ФЛАГ</span>
          <span className="num font-disp text-[15px] font-bold text-white">{Math.max(0, Math.ceil(sim.redRemaining))} с до рестарта</span>
          <span className="text-[11px] text-[#ffb3bc]">Машины в боксах · замена шин бесплатна (это не пит-стоп) · рестарт с пит-лейна</span>
        </div>
      )}
      {paused && !raceDone && sim.phase !== 'red' && (
        <div className="shrink-0 px-4 py-1 bg-[#141a10] border-b border-[#2f8f4e55] text-[11px] text-[#4ade80] font-semibold">
          ⏸ Симуляция на паузе{(sim.phase === 'sc' || sim.phase === 'vsc') ? ' — нейтралитет: спланируйте стратегию (пит-стоп под SC теряет вдвое меньше)' : ''}
        </div>
      )}
      {raceDone && (
        <div className="shrink-0 px-4 py-2.5 bg-[#2f8f4e] flex items-center gap-4 flex-wrap">
          <span className="font-disp text-[13px] font-bold tracking-[0.12em] text-white">🏁 ВСЕ МАШИНЫ ФИНИШИРОВАЛИ</span>
          <button onClick={finish}
            className="font-disp text-[11px] font-bold px-4 py-1.5 bg-white text-[#12351f] hover:bg-[#d8f224] transition-colors">
            ПОДВЕСТИ ИТОГИ →
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* ЛЕВО: крупная таблица отрывов */}
        <aside className="w-[40%] shrink-0 border-r border-[#252e3b] bg-[#0d1117] flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-[#1d242f] flex items-center justify-between shrink-0">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[#7f8da0] font-semibold">Тайминг · отрывы</span>
            <span className="text-[9px] text-[#5a6a80]">отрыв | посл. круг</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {cars.map((car) => {
              const team = gs.teams[car.tid];
              const tire = compoundDef(sid, car.tire);
              const isOut = car.status === 'out';
              const inPit = car.status === 'run' && (car.pitting || car.pitCrawl > 0);
              const wear = Math.min(100, Math.round((car.wear / tire.life) * 100));
              const wearCol = wear > 85 ? '#ff6b4b' : wear > 60 ? '#ffc94d' : '#4ade80';
              const isPurple = car.lastLap != null && car.bestLap != null && car.lastLap <= car.bestLap + 0.001;
              // правило двух составов: ДСК для финишировавшего с одним составом (сухая гонка Ф1/Ф2)
              const ruleLive = stage === 'race' && (sid === 'f1' || sid === 'f2') && !sim.wetSession && !sim.raining;
              const isDsq = car.dsq || (ruleLive && car.status === 'fin' && new Set(car.usedTires.filter((x) => !['I', 'W', 'AW'].includes(x))).size < 2);
              return (
                <div key={car.did}
                  className={`flex items-center gap-2.5 px-3 py-[7px] border-l-[3px] text-[14px] transition-colors ${car.isPlayer ? 'bg-[#1a2230]' : 'hover:bg-[#141a23]'} ${isOut ? 'opacity-40' : ''}`}
                  style={{ borderLeftColor: team.color }}>
                  <span className="font-disp font-bold w-8 text-[13px] text-[#9fb0c4]">{isOut ? '—' : car.pos}</span>
                  <span className="w-4 h-4 shrink-0 rounded-full border-2 relative" title={`${tire.name} · износ ${wear}%`}
                    style={{ borderColor: tire.color, background: `${tire.color}33` }}>
                    <span className="absolute inset-[3px] rounded-full" style={{ background: `conic-gradient(${wearCol} ${wear * 3.6}deg, transparent 0)` }} />
                  </span>
                  <span className="num text-[10px] font-bold w-9 text-right" style={{ color: wearCol }} title={`Износ шин ${wear}%`}>{isOut ? '' : `${wear}%`}</span>
                  <span className="font-bold w-12">{car.code}</span>
                  <span className="text-[#5a6a80] truncate flex-1 text-[12px]">{team.short}</span>
                  {car.pitCount > 0 && <span className="font-disp text-[9px] font-bold text-[#5c9eff] border border-[#5c9eff55] px-1 rounded-sm shrink-0" title={`Пит-стопов: ${car.pitCount}`}>P{car.pitCount}</span>}
                  {car.drs && <span className="font-disp text-[9px] font-bold text-[#4ade80]">DRS</span>}
                  {car.pitting && <span className="font-disp text-[9px] font-bold text-[#ffc94d] blink">PIT</span>}
                  {(() => {
                    const pd = posDeltasRef.current[car.did];
                    const show = pd && nowMs - pd.ts < 4000 && pd.delta !== 0 && car.status === 'run' && !car.pitting && car.pitCrawl <= 0;
                    if (!show || !pd) return null;
                    const up = pd.delta > 0;
                    return (
                      <span className={`font-disp text-[10px] font-bold shrink-0 ${up ? 'text-[#4ade80]' : 'text-[#ff6b4b]'}`}
                        title={up ? `Выиграл ${pd.delta} поз.` : `Потерял ${Math.abs(pd.delta)} поз.`}>
                        {up ? '▲' : '▼'}{Math.abs(pd.delta)}
                      </span>
                    );
                  })()}
                  <span className="num text-[#e7edf4] w-[70px] text-right font-semibold text-[13px]">
                    {isOut ? 'СХОД'
                      : isDsq ? <span className="text-[#ff6b4b] font-bold" title="Дисквалифицирован: правило двух составов">ДСК</span>
                      : inPit ? <span className="text-[#ffc94d]">В БОКСАХ</span>
                      : car.status === 'fin'
                        ? (car.finishT === winnerT ? '🏁' : `+${(car.finishT - winnerT).toFixed(1)}`)
                        : car.pos === 1 ? `К${car.lap + 1}` : car.interval >= 90 ? `+${Math.floor(car.interval / 60)}:${(car.interval % 60).toFixed(3).padStart(6, '0')}` : `+${car.interval.toFixed(3)}`}
                  </span>
                  <span className={`num w-[86px] text-right text-[13px] ${isPurple ? 'text-[#c884ff] font-bold' : 'text-[#7f8da0]'}`}>
                    {car.lastLap != null ? fmtLap(car.lastLap) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ПРАВО: трасса + пит-уолл + события */}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 relative">
            <TrackCanvas sim={sim} track={track} seriesColor={meta.color} phase={sim.phase} raining={sim.raining} />
          </div>

          <div className="shrink-0 border-t border-[#252e3b] bg-[#0d1117] p-2.5 max-h-[42%] overflow-y-auto">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#7f8da0] px-1 mb-1.5 font-semibold">Пит-уолл — ваши машины</div>
            <div className="space-y-2">
              {playerCars.map((car) => {
                const scheduled = sim.pitScheduled(car.did);
                const tire = compoundDef(sid, car.tire);
                const wearPct = Math.min(100, Math.round((car.wear / tire.life) * 100));
                const wearColor = wearPct > 85 ? '#ff6b4b' : wearPct > 60 ? '#ffc94d' : '#4ade80';
                const lapsLeft = Math.max(0, sim.totalLaps - car.lap);
                const burn = car.fuelMode === 'push' ? 1.55 : car.fuelMode === 'eco' ? 1.15 : 1.35;
                const fuelLeft = car.fuel - lapsLeft * burn;
                const fuelOk = fuelLeft >= 0;
                const fuelPct = Math.min(100, Math.max(0, (car.fuel / (sim.totalLaps * 1.575)) * 100));
                return (
                  <div key={car.did} className="border border-[#2a3442] bg-[#10151d] px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <FlagTag nat={car.nat} />
                      <span className="font-bold text-[13px]">{car.code}</span>
                      <span className="text-[11px] text-[#7f8da0]">P{car.pos}</span>
                      <span className="text-[11px] num text-[#9fb0c4]">{tireName(sid, car.tire)} · {car.tireAge} кр</span>
                      <span className="ml-auto text-[10px] num text-[#5a6a80]">топливо {car.fuel.toFixed(0)} кг</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] uppercase tracking-widest text-[#7f8da0] w-14 shrink-0">Шины</span>
                      <div className="flex-1 h-[7px] bg-[#0d1117] border border-[#232b37] overflow-hidden">
                        <div className="h-full transition-all duration-300" style={{ width: `${wearPct}%`, background: `linear-gradient(90deg, ${wearColor}88, ${wearColor})` }} />
                      </div>
                      <span className="num text-[10px] font-bold w-10 text-right" style={{ color: wearColor }}>{car.status === 'run' ? `${wearPct}%` : '—'}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[9px] uppercase tracking-widest text-[#7f8da0] w-14 shrink-0">Топливо</span>
                      <div className="flex-1 h-[7px] bg-[#0d1117] border border-[#232b37] overflow-hidden">
                        <div className="h-full transition-all duration-300" style={{ width: `${fuelPct}%`, background: fuelOk ? '#5c9eff' : '#ff6b4b' }} />
                      </div>
                      <span className="num text-[10px] font-bold w-[86px] text-right" style={{ color: fuelOk ? '#5c9eff' : '#ff6b4b' }}
                        title={`Осталось ${lapsLeft} кругов, расход ${burn} кг/круг`}>
                        {car.status === 'run' ? (fuelOk ? `+${fuelLeft.toFixed(0)} кг` : `−${Math.abs(fuelLeft).toFixed(0)} кг!`) : '—'}
                      </span>
                    </div>
                    {/* Правило двух составов (Ф1/Ф2, сухая гонка) */}
                    {stage === 'race' && (sid === 'f1' || sid === 'f2') && !sim.wetSession && !sim.raining && (() => {
                      const dryUsed = car.usedTires.filter((x) => x !== 'I' && x !== 'W' && x !== 'AW');
                      const ok = new Set(dryUsed).size >= 2;
                      return (
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[9px] uppercase tracking-widest text-[#7f8da0] w-14 shrink-0">2 состава</span>
                          <span className="flex items-center gap-1">
                            {dryUsed.map((id) => {
                              const c = compoundDef(sid, id);
                              return <span key={id} className="w-3 h-3 rounded-full border-2" title={c.name} style={{ borderColor: c.color, background: `${c.color}33` }} />;
                            })}
                          </span>
                          <span className={`text-[10px] font-bold ${ok ? 'text-[#4ade80]' : 'text-[#ffc94d]'}`}>
                            {ok ? '✓ выполнено' : '⚠ нужен ещё 1 состав — иначе ДСК'}
                          </span>
                        </div>
                      );
                    })()}
                    <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                      <span className="text-[10px] uppercase tracking-widest text-[#7f8da0] mr-1">{sim.phase === 'red' ? 'Шины (бесплатно):' : 'Пит:'}</span>
                      {[...slicks, ...wetTires].map((c) => (
                        <button key={c.id} disabled={car.status !== 'run' || (sim.phase === 'red' ? (car.tire === c.id) : (scheduled || car.pitting))}
                          onClick={() => {
                            if (sim.phase === 'red') sim.redFlagTire(car.did, c.id);
                            else sim.boxCar(car.did, c.id);
                            force((x) => x + 1);
                          }}
                          className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-30 ${sim.phase === 'red' && car.tire === c.id ? 'border-[#4ade80] text-[#4ade80]' : 'border-[#2a3442] hover:border-[#d8f224]'}`}
                          title={sim.phase === 'red' ? `${c.name} — бесплатная замена под красным флагом` : c.name}>
                          <span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: c.color, background: `${c.color}33` }} />
                          {c.short}
                        </button>
                      ))}
                      {scheduled && sim.phase !== 'red' && <span className="font-disp text-[9px] font-bold text-[#ffc94d] blink">ЗАЕЗЖАЕТ</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-widest text-[#7f8da0] mr-1">Режим:</span>
                      {([['aggr', 'АТАКА'], ['balanced', 'БАЛАНС'], ['cons', 'БЕРЕЧЬ']] as [StrategyPreset, string][]).map(([m, label]) => (
                        <button key={m} onClick={() => { sim.setMode(car.did, m); force((x) => x + 1); }}
                          className={`px-2 py-0.5 text-[10px] font-bold border transition-colors ${car.mode === m ? 'bg-[#d8f224] text-[#10131a] border-[#d8f224]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#5a6a80]'}`}>
                          {label}
                        </button>
                      ))}
                      <span className="text-[10px] uppercase tracking-widest text-[#7f8da0] ml-2 mr-1">Топливо:</span>
                      {([['push', 'ПУШ'], ['normal', 'НОРМА'], ['eco', 'ЭКО']] as const).map(([f, label]) => (
                        <button key={f} onClick={() => { sim.setFuelMode(car.did, f); force((x) => x + 1); }}
                          className={`px-2 py-0.5 text-[10px] font-bold border transition-colors ${car.fuelMode === f ? 'bg-[#5c9eff] text-[#0d1016] border-[#5c9eff]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#5a6a80]'}`}>
                          {label}
                        </button>
                      ))}
                      <button onClick={() => { sim.orderLetThrough(car.did); force((x) => x + 1); }}
                        disabled={car.letThrough || car.status !== 'run'}
                        className="px-2 py-0.5 text-[10px] font-bold border border-[#2a3442] text-[#c884ff] hover:border-[#c884ff] disabled:opacity-30 transition-colors">
                        ПРОПУСТИТЬ НАПАРНИКА
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-2 max-h-[90px] overflow-y-auto">
              {[...sim.events].reverse().slice(0, 12).map((e, i) => (
                <div key={sim.events.length - i} className="text-[11.5px] leading-tight px-1 py-0.5">
                  <span className={e.kind === 'pit' ? 'text-[#7dc8ff]' : e.kind === 'sc' ? 'text-[#ffc94d]' : e.kind === 'red' ? 'text-[#ff6b4b]' : e.kind === 'crash' ? 'text-[#ff9a5c]' : 'text-[#9fb0c4]'}>{e.text}</span>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
