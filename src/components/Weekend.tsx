import { useState } from 'react';
import { useGame } from '../game/GameContext';
import { SERIES_META } from '../game/data';
import type { Stage } from '../game/types';
import {
  availableRookies, circuitOfRound, playerTeam, raceDriversOfTeam, stageTitle,
} from '../game/engine';
import { Btn, FlagTag, Icon, Panel, ResultTable, WeatherTag } from './ui';

export default function WeekendScreen({ onStartSession }: { onStartSession: (stage: Stage) => void }) {
  const { gs, dispatch } = useGame();
  const w = gs.weekend!;
  const sid = gs.playerSeries;
  const meta = SERIES_META[sid];
  const circuit = circuitOfRound(gs, sid, w.roundIdx);
  const stage = w.stages[w.stageIdx];
  const isQuali = stage === 'quali' || stage === 'sq';
  const isPractice = !isQuali && !(stage === 'race' || stage === 'sprint' || stage === 'sprintRev');
  const myDrivers = raceDriversOfTeam(gs, gs.playerTeamId);
  const rookies = availableRookies(gs);
  const [rookieSel, setRookieSel] = useState<string>(rookies[0]?.id ?? '');

  const showRookie = sid === 'f1' && stage === 'fp1' && gs.rookieUsed < 4;

  const pastStages = w.stages.slice(0, w.stageIdx);

  return (
    <div className="min-h-screen pb-16">
      <header className="border-b border-[#252e3b] bg-[#0d1117cc] backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4 flex-wrap">
          <span className="font-disp font-black text-2xl text-[#ff2d2d]">APEX</span>
          <div>
            <div className="font-disp font-bold text-[16px] leading-tight">{circuit.name}</div>
            <div className="text-[11px] text-[#7f8da0]">{circuit.country} · этап {w.roundIdx + 1} · {meta.fullName}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {w.stages.map((st, i) => (
              <span key={st} className={`font-disp text-[9px] font-bold px-2 py-1 border ${i < w.stageIdx ? 'border-[#2f8f4e] text-[#4ade80]' : i === w.stageIdx ? 'border-[#ff2d2d] text-[#ff2d2d] blink' : 'border-[#2a3442] text-[#5a6a80]'}`}>
                {stageTitle(gs, st).split(' ')[0].toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {showRookie && (
          <Panel title="Правило новичков Ф1 — FP1" accent>
            <div className="text-[13px] text-[#9fb0c4] mb-3">
              Вы обязаны 4 раза за сезон отдать FP1 пилоту с не более чем 2 стартами в Ф1. Использовано: <b className="num text-[#d8f224]">{gs.rookieUsed}/4</b>.
              Выберите, кто сядет за руль (или пропустите — в конце сезона штраф $250K за каждый пропуск).
            </div>
            <div className="grid sm:grid-cols-2 gap-3 mb-3">
              <button onClick={() => dispatch({ type: 'SET_ROOKIE', slot: 0 })}
                className={`border-2 px-3 py-2.5 text-left transition-all ${w.rookieChoice === 0 ? 'border-[#d8f224] bg-[#141a10]' : 'border-[#2a3442] hover:border-[#4a5a70]'}`}>
                <div className="font-semibold text-[13px]">Без замены</div>
                <div className="text-[11px] text-[#7f8da0]">Оба основных пилота работают</div>
              </button>
              {myDrivers.map((d, i) => (
                <button key={d.id} onClick={() => dispatch({ type: 'SET_ROOKIE', slot: (i + 1) as 1 | 2, rookieId: rookieSel })}
                  className={`border-2 px-3 py-2.5 text-left transition-all ${w.rookieChoice === i + 1 ? 'border-[#d8f224] bg-[#141a10]' : 'border-[#2a3442] hover:border-[#4a5a70]'}`}>
                  <div className="font-semibold text-[13px]">Новичок вместо {d.code}</div>
                  <div className="text-[11px] text-[#7f8da0]">Освободить болид #{i + 1}</div>
                </button>
              ))}
            </div>
            {w.rookieChoice !== 0 && w.rookieChoice != null && (
              <div>
                <div className="font-disp text-[10px] font-bold tracking-[0.2em] text-[#7f8da0] mb-1.5 uppercase">Молодой пилот</div>
                <select value={rookieSel} onChange={(e) => { setRookieSel(e.target.value); dispatch({ type: 'SET_ROOKIE', slot: w.rookieChoice as 1 | 2, rookieId: e.target.value }); }}
                  className="w-full bg-[#0d1117] border border-[#2a3442] px-2 py-1.5 text-[13px]">
                  {rookies.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} · {r.age} лет · темп {r.pace}</option>
                  ))}
                </select>
              </div>
            )}
          </Panel>
        )}

        <Panel title={`Сейчас: ${stageTitle(gs, stage)}`} accent delay={40}
          right={<WeatherTag w={w.weather[stage]} />}>
          {isQuali && (
            <div className="border-l-4 border-[#ffc94d] bg-[#1a1710] px-3 py-2 text-[12px] text-[#e8d9a8] mb-3">
              🔒 Парк-ферме действует с начала квалификации — настройки болидов зафиксированы.
            </div>
          )}
          {isPractice && w.setupNotes.length > 0 && (
            <div className="mb-3 space-y-1">
              {w.setupNotes.map((n, i) => <div key={i} className="text-[12px] text-[#c8d4e2]">{n}</div>)}
            </div>
          )}
          <div className="flex gap-3 flex-wrap">
            <Btn variant="acc" className="pulse-acc" onClick={() => onStartSession(stage)}>
              <Icon name="play" />ТРАНСЛЯЦИЯ
            </Btn>
            {(isPractice || isQuali) && (
              <Btn onClick={() => dispatch({ type: 'SKIP_SESSION' })}>
                <Icon name="chev" />ПРОПУСТИТЬ СЕССИЮ
              </Btn>
            )}
          </div>
        </Panel>

        {pastStages.length > 0 && (
          <Panel title="Результаты сессий" delay={80}>
            <div className="space-y-5">
              {pastStages.map((st) => {
                const r = w.results[st];
                if (!r) return null;
                return (
                  <div key={st}>
                    <div className="font-disp text-[11px] font-bold tracking-[0.18em] text-[#9fb0c4] mb-2 uppercase">{r.title}</div>
                    {r.notes.map((n, i) => <div key={i} className="text-[12px] text-[#7f8da0] mb-1">· {n}</div>)}
                    <ResultTable rows={r.rows.slice(0, 10)} game={gs} showBest={st !== 'race' && st !== 'sprint' && st !== 'sprintRev'} showPts={(st === 'race' || st === 'sprint' || st === 'sprintRev')} />
                  </div>
                );
              })}
            </div>
          </Panel>
        )}
      </main>
    </div>
  );
}
