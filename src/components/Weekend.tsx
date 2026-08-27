import { useState } from 'react';
import { useGame } from '../game/GameContext';
import { SERIES_META } from '../game/data';
import type { Setup, Stage } from '../game/types';
import {
  availableRookies, circuitOfRound, compoundDef, driverSetup, dryCompounds, engineerSetupAdvice,
  playerTeam, raceDriversOfTeam, stageTitle,
} from '../game/engine';
import { Btn, FlagTag, Icon, Panel, ResultTable, WeatherTag } from './ui';

const SETUP_FIELDS: { f: keyof Setup; label: string }[] = [
  { f: 'aero', label: 'Прижим' },
  { f: 'mech', label: 'Мех. зацеп' },
  { f: 'tires', label: 'Давление шин' },
  { f: 'brake', label: 'Торм. баланс' },
  { f: 'diff', label: 'Дифференциал' },
];

export default function WeekendScreen({ onStartSession, startTires, setStartTires }: {
  onStartSession: (stage: Stage) => void;
  startTires: Record<string, string>;
  setStartTires: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const { gs, dispatch } = useGame();
  const w = gs.weekend!;
  const sid = gs.playerSeries;
  const meta = SERIES_META[sid];
  const circuit = circuitOfRound(gs, sid, w.roundIdx);
  const stage = w.stages[w.stageIdx];
  const isQuali = stage === 'quali' || stage === 'sq';
  const isRaceStage = stage === 'race' || stage === 'sprint' || stage === 'sprintRev';
  const isPractice = !isQuali && !isRaceStage;
  const myDrivers = raceDriversOfTeam(gs, gs.playerTeamId);
  const rookies = availableRookies(gs);
  const [rookieSel, setRookieSel] = useState<string>(rookies[0]?.id ?? '');

  const showRookie = sid === 'f1' && stage === 'fp1' && gs.rookieUsed < 4;
  const pastStages = w.stages.slice(0, w.stageIdx);
  const practiceDone = pastStages.some((s) => s.startsWith('fp'));

  // инженерный брифинг — один раз на уик-энд, перед первой практикой
  const [briefing] = useState(() => engineerSetupAdvice(gs, circuit));
  const showBriefing = w.stageIdx === 0 && isPractice;

  // настройки можно крутить до начала квалификации
  const setupLocked = !isPractice;

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
            <button onClick={() => dispatch({ type: 'BACK_TO_HUB' })}
              className="btn-tab !py-1.5 border border-[#2a3442] hover:border-[#5a6879] ml-2" title="Вернуться в штаб (уик-энд сохранится)">
              <Icon name="back" size={13} />В штаб
            </button>
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

        {showBriefing && (
          <Panel title={`Инженерный брифинг — ${circuit.name}`} accent delay={30}>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span className="font-semibold text-[13px]">🎧 {briefing.engineer}</span>
              <span className="text-[11px] text-[#7f8da0]">гоночный инженер · скилл <b className="num text-[#d8f224]">{briefing.skill}</b></span>
              <div className="flex-1 min-w-[120px] h-[6px] bg-[#0d1117] border border-[#232b37]">
                <div className="h-full" style={{ width: `${briefing.skill}%`, background: 'linear-gradient(90deg,#d8f22488,#d8f224)' }} />
              </div>
              <Btn className="!py-1.5" onClick={() => {
                briefing.tips.forEach((t) => myDrivers.forEach((d) => dispatch({ type: 'SET_SETUP', did: d.id, field: t.field, value: t.suggested })));
              }}>
                <Icon name="check" size={13} />Применить всё
              </Btn>
            </div>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-2">
              {briefing.tips.map((t, i) => {
                const diff = t.suggested - t.current;
                const col = Math.abs(diff) < 5 ? '#4ade80' : Math.abs(diff) < 14 ? '#ffc94d' : '#ff6b4b';
                return (
                  <div key={t.field} className="flex items-center gap-3 border border-[#1d242f] px-3 py-2 reveal" style={{ animationDelay: `${i * 60}ms` }}>
                    <span className="text-[12px] w-[92px] shrink-0 text-[#9fb0c4]">{t.label}</span>
                    <span className="num text-[12px] w-8 text-right text-[#7f8da0]">{t.current}</span>
                    <span className="text-[#5a6a80]">→</span>
                    <span className="num text-[13px] font-bold w-8" style={{ color: col }}>{t.suggested}</span>
                    <div className="flex-1 h-[5px] bg-[#0d1117] border border-[#232b37]" title={`Уверенность ${t.confidence}%`}>
                      <div className="h-full" style={{ width: `${t.confidence}%`, background: t.confidence > 70 ? '#4ade80' : '#ffc94d' }} />
                    </div>
                    <button onClick={() => myDrivers.forEach((d) => dispatch({ type: 'SET_SETUP', did: d.id, field: t.field, value: t.suggested }))}
                      className="font-disp text-[9px] font-bold px-2 py-1 border border-[#2a3442] hover:border-[#d8f224] hover:text-[#d8f224] transition-colors shrink-0">
                      ОК
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-[#5a6a80] mt-2.5">Чем выше скилл инженера, тем точнее рекомендации. Пилоты уточнят советы по ходу практик.</p>
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

          {(isPractice || isQuali) && w.weather[stage] !== 'wet' && (
            <div className="mb-3">
              <div className="font-disp text-[10px] font-bold tracking-[0.2em] text-[#7f8da0] mb-1.5 uppercase">Стартовый комплект — ваши машины</div>
              {myDrivers.map((d) => {
                const cur = startTires[d.id] ?? compoundDef(sid, driverSetupTireDefault(sid)).id;
                return (
                  <div key={d.id} className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <FlagTag nat={d.nat} />
                    <span className="text-[12px] font-semibold w-12">{d.code}</span>
                    {dryCompounds(sid).map((c) => (
                      <button key={c.id}
                        onClick={() => setStartTires((p) => ({ ...p, [d.id]: c.id }))}
                        className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[11px] font-semibold transition-all ${cur === c.id ? 'border-white bg-[#20293a] -translate-y-px' : 'border-[#2a3442] hover:border-[#4a5a70]'}`}
                        title={`${c.name}: темп ${c.offset >= 0 ? '+' + c.offset.toFixed(1) : c.offset.toFixed(1)} с/круг · ресурс ~${c.life} кр`}>
                        <span className="w-3 h-3 rounded-full border-2" style={{ borderColor: c.color, background: `${c.color}33` }} />
                        {c.name}
                      </button>
                    ))}
                  </div>
                );
              })}
              <div className="text-[11px] text-[#5a6a80]">В дождь все стартуют на дождевых. Комплект можно менять и в боксах по ходу сессии.</div>
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

        {(practiceDone || isQuali || isRaceStage) && (
          <Panel title="Настройки болидов и советы пилотов" delay={60}>
            {setupLocked && (
              <div className="text-[11px] text-[#ffc94d] mb-2">🔒 Парк-ферме: настройки зафиксированы до конца уик-энда.</div>
            )}
            <div className="grid md:grid-cols-2 gap-4">
              {myDrivers.map((d) => {
                const s = driverSetup(gs, d.id);
                const advice = gs.lastAdvice?.[d.id];
                return (
                  <div key={d.id} className="border border-[#1d242f] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <FlagTag nat={d.nat} />
                      <span className="font-bold text-[13px]">{d.name}</span>
                    </div>
                    {SETUP_FIELDS.map(({ f, label }) => (
                      <label key={f} className="flex items-center gap-2 text-[11px] text-[#9fb0c4] mb-1">
                        <span className="w-[86px] shrink-0">{label}</span>
                        <input type="range" min={15} max={85} disabled={setupLocked}
                          value={s[f]}
                          onChange={(e) => dispatch({ type: 'SET_SETUP', did: d.id, field: f, value: +e.target.value })}
                          className="flex-1 accent-[#d8f224] disabled:opacity-40" />
                        <span className="num w-7 text-right text-[#e7edf4] font-semibold">{Math.round(s[f])}</span>
                      </label>
                    ))}
                    {advice && (
                      <div className="mt-2 text-[11.5px] leading-snug border-l-2 border-[#ffc94d] pl-2 text-[#e8d9a8]">
                        {advice}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

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
                    <ResultTable rows={r.rows} game={gs} showBest={st !== 'race' && st !== 'sprint' && st !== 'sprintRev'} showPts={(st === 'race' || st === 'sprint' || st === 'sprintRev')} />
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

/** Состав по умолчанию для серии (если игрок не выбрал) */
function driverSetupTireDefault(sid: string): string {
  return sid === 'f1' ? 'M' : sid === 'f2' ? 'O' : sid === 'indy' ? 'ALT' : sid === 'f3' ? 'M' : 'AW';
}
