import { useState } from 'react';
import { useGame } from '../game/GameContext';
import {
  ALL_CIRCUITS, CALENDARS, DRIVERS, ROLE_NAMES, SERIES_META, SERIES_ORDER, TEAMS, staffRolesFor,
} from '../game/data';
import type { Driver, SeriesId, Staff } from '../game/types';
import {
  F1_BUDGET_CAP, PU_ELEMENTS, UPG_STRAT, areaLabel, availableRookies, budgetCap, canUpgrade,
  capRemaining, carPerf, circuitOfRound, deleteSave, driversOfTeam, fitComponent, fmtLap,
  isSeasonOver, listSaves, loadGame, money, playerTeam, puLimit, raceDriversOfTeam, saveGame,
  seriesDrivers, stagesFor, supplierPower, upgradeCost, upgradeGain, upgradeRounds,
} from '../game/engine';
import type { PUElement } from '../game/engine';
import { Btn, FlagTag, Icon, Panel, PosBadge, ResultTable, StatBar, TeamDot, WeatherTag } from './ui';

function useDummy() { return null; }
void useDummy;

/* ================= ТИТУЛЬНЫЙ ЭКРАН ================= */

export function TitleScreen({ onLoad, onNew }: { onLoad: (g: import('../game/types').GameState) => void; onNew: () => void }) {
  const saves = listSaves();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 checker opacity-[0.04]" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[3px] bg-gradient-to-r from-transparent via-[#ff2d2d] to-transparent" />
      <div className="reveal text-center mb-10 relative">
        <div className="font-disp text-[12px] tracking-[0.6em] text-[#7f8da0] mb-3">F1 · F2 · F3 · INDYCAR · FORMULA E</div>
        <h1 className="font-disp font-black text-[84px] leading-none tracking-tight">
          AP<span className="text-[#ff2d2d]">E</span>X
        </h1>
        <div className="font-disp text-[14px] tracking-[0.45em] text-[#d8f224] mt-2">ГОНОЧНЫЙ МЕНЕДЖЕР · СЕЗОН 2026</div>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-md reveal" style={{ animationDelay: '120ms' }}>
        <Btn variant="acc" onClick={onNew}><Icon name="play" />НОВАЯ КАРЬЕРА</Btn>

        {saves.some(Boolean) && (
          <div className="panel clip p-4 mt-4">
            <div className="font-disp text-[10px] font-bold tracking-[0.2em] text-[#7f8da0] mb-3 uppercase">Продолжить</div>
            <div className="space-y-2">
              {saves.map((s, i) => s && (
                <div key={i} className="flex items-center justify-between border border-[#2a3442] hover:border-[#ff2d2d] transition-colors px-3 py-2">
                  <div>
                    <div className="text-[13px] font-semibold">{s.team}</div>
                    <div className="text-[11px] text-[#7f8da0]">{SERIES_META[s.series].fullName} · сезон {s.seasonN} · {s.year}</div>
                  </div>
                  <div className="flex gap-2">
                    <button className="font-disp text-[9px] font-bold px-2.5 py-1 bg-[#2f8f4e] hover:bg-[#3aa85f] text-white transition-colors" onClick={() => { const g = loadGame(s.slot); if (g) onLoad(g); }}>ЗАГРУЗИТЬ</button>
                    <button className="font-disp text-[9px] font-bold px-2 py-1 border border-[#3a2a2a] text-[#ff6b4b] hover:bg-[#2a1515] transition-colors" onClick={() => deleteSave(s.slot)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="mt-10 text-[11px] text-[#4a5a70] reveal" style={{ animationDelay: '200ms' }}>
        Реальные пилоты и команды · прокачка болидов и СУ · трансферы · регламент · живые гонки
      </div>
    </div>
  );
}

/* ================= НОВАЯ КАРЬЕРА ================= */

export function NewCareer({ onBack, onStart }: { onBack: () => void; onStart: (sid: SeriesId, teamId: string) => void }) {
  const [sid, setSid] = useState<SeriesId>('f1');
  const [teamId, setTeamId] = useState<string>('');
  const meta = SERIES_META[sid];
  const teams = TEAMS.filter((t) => t.seriesId === sid);
  const sel = teams.find((t) => t.id === teamId);

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Btn onClick={onBack}><Icon name="back" />Назад</Btn>
        <h1 className="font-disp font-black text-3xl">НОВАЯ КАРЬЕРА</h1>
      </div>

      <div className="font-disp text-[11px] font-bold tracking-[0.2em] text-[#7f8da0] mb-3 uppercase">1 · Выберите серию</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-8">
        {SERIES_ORDER.map((s) => {
          const m = SERIES_META[s];
          const on = s === sid;
          return (
            <button key={s} onClick={() => { setSid(s); setTeamId(''); }}
              className={`border-2 px-3 py-4 text-left transition-all ${on ? 'border-current bg-[#141a24] -translate-y-0.5' : 'border-[#2a3442] hover:border-[#4a5a70]'}`}
              style={{ color: m.color }}>
              <div className="font-disp font-black text-xl">{m.name}</div>
              <div className="text-[11px] text-[#9fb0c4] mt-1">{m.fullName}</div>
            </button>
          );
        })}
      </div>

      <div className="font-disp text-[11px] font-bold tracking-[0.2em] text-[#7f8da0] mb-3 uppercase">2 · Выберите команду</div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        {teams.map((t) => {
          const ds = raceDriversOfTeamSafe(t.id);
          const on = t.id === teamId;
          return (
            <button key={t.id} onClick={() => setTeamId(t.id)}
              className={`border-2 p-4 text-left transition-all ${on ? 'border-[#ff2d2d] bg-[#16121a] -translate-y-0.5' : 'border-[#2a3442] hover:border-[#4a5a70]'}`}>
              <div className="flex items-center gap-2 mb-2">
                <TeamDot color={t.color} color2={t.color2} size={16} />
                <span className="font-bold text-[15px]">{t.name}</span>
              </div>
              <div className="text-[12px] text-[#9fb0c4] space-y-0.5">
                <div>Мотор: {t.engineMaker}{t.works ? ' (заводская)' : ''}</div>
                <div>Пилоты: {ds.map((d) => d.code).join(' / ') || '—'}</div>
                <div className="num">Бюджет: {money(t.budget)} · Репутация: {t.reputation}</div>
              </div>
            </button>
          );
        })}
      </div>

      {sel && (
        <div className="panel clip p-5 mb-6 reveal">
          <div className="flex items-center gap-3 mb-3">
            <TeamDot color={sel.color} color2={sel.color2} size={20} />
            <div>
              <div className="font-disp font-bold text-lg">{sel.name}</div>
              <div className="text-[12px] text-[#9fb0c4]">{meta.fullName} · бюджет {money(sel.budget)}</div>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-8">
            <StatBar label="Аэродинамика" value={sel.aero} color={sel.color} />
            <StatBar label="Шасси" value={sel.chassis} color={sel.color} />
            <StatBar label="Силовая установка" value={supplierPowerSafe(sel)} color={sel.color} />
            <StatBar label="Работа с шинами" value={sel.tires} color={sel.color} />
          </div>
        </div>
      )}

      <Btn variant="acc" disabled={!teamId} onClick={() => onStart(sid, teamId)}>
        <Icon name="flag" />НАЧАТЬ СЕЗОН 2026
      </Btn>
    </div>
  );
}

function raceDriversOfTeamSafe(teamId: string): Driver[] {
  return DRIVERS.filter((d) => d.teamId === teamId && !d.reserve);
}
function supplierPowerSafe(t: import('../game/types').Team): number {
  if (t.works) return t.power;
  const sup = TEAMS.find((x) => x.seriesId === t.seriesId && x.works && x.engineMaker === t.engineMaker);
  return sup ? sup.power * 0.97 : t.power * 0.95;
}

/* ================= ХАБ ================= */

type HubTab = 'calendar' | 'standings' | 'garage' | 'power' | 'market' | 'editor' | 'saves' | 'news';

export function HubScreen({ onStartWeekend, onResumeWeekend, onEndSeason }: {
  onStartWeekend: () => void; onResumeWeekend: () => void; onEndSeason: () => void;
}) {
  const { gs, dispatch, msg } = useGame();
  const [tab, setTab] = useState<HubTab>('calendar');
  const sid = gs.playerSeries;
  const ss = gs.series[sid];
  const meta = SERIES_META[sid];
  const pt = playerTeam(gs);
  const over = isSeasonOver(gs);

  if (gs.fired) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Panel accent className="max-w-lg w-full text-center">
          <div className="font-disp font-black text-3xl text-[#ff2d2d] mb-3">ВЫ УВОЛЕНЫ</div>
          <p className="text-[14px] text-[#9fb0c4] mb-6">Совет директоров потерял доверие к вашему руководству. Контракт расторгнут.</p>
          <Btn variant="acc" onClick={() => dispatch({ type: 'NEW_SEASON' })}>НАЧАТЬ ЗАНОВО С НОВОЙ КОМАНДОЙ</Btn>
        </Panel>
      </div>
    );
  }

  const tabs: [HubTab, string, string][] = [
    ['calendar', 'cal', 'Календарь'],
    ['standings', 'trophy', 'Зачёты'],
    ['garage', 'garage', 'Боксы'],
    ['power', 'bolt', 'Рейтинги'],
    ['market', 'swap', 'Трансферы'],
    ['editor', 'edit', 'Редактор'],
    ['news', 'radio', 'Новости'],
    ['saves', 'save', 'Сэйвы'],
  ];

  return (
    <div className="min-h-screen pb-16">
      {msg && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 panel clip-sm border-l-4 border-[#d8f224] px-5 py-2.5 text-[13px] font-semibold reveal">{msg}</div>
      )}

      <header className="border-b border-[#252e3b] bg-[#0d1117cc] backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 pt-3 flex items-center gap-4 flex-wrap">
          <span className="font-disp font-black text-2xl text-[#ff2d2d]">APEX</span>
          <TeamDot color={pt.color} color2={pt.color2} size={18} />
          <div>
            <div className="font-disp font-bold text-[15px] leading-tight">{pt.name}</div>
            <div className="text-[11px] text-[#7f8da0]">{meta.fullName} · сезон {gs.seasonN} · {gs.year}</div>
          </div>
          <div className="ml-auto flex items-center gap-4 text-[12px] num flex-wrap">
            <div className="text-right">
              <div className="text-[10px] text-[#7f8da0] uppercase tracking-wider">Бюджет</div>
              <div className="font-bold text-[#d8f224]">{money(gs.budget)}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[#7f8da0] uppercase tracking-wider">Доверие</div>
              <div className="font-bold" style={{ color: gs.ownerTrust > 50 ? '#4ade80' : gs.ownerTrust > 25 ? '#ffc94d' : '#ff6b4b' }}>{Math.round(gs.ownerTrust)}%</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[#7f8da0] uppercase tracking-wider">Репутация</div>
              <div className="font-bold text-[#9fb0c4]">{gs.reputation}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[#7f8da0] uppercase tracking-wider">Титулы</div>
              <div className="font-bold text-[#ffd75c]">{gs.careerTitles}</div>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {tabs.map(([t, ic, label]) => (
            <button key={t} className={`btn-tab whitespace-nowrap ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
              <Icon name={ic} size={14} />{label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center gap-4 flex-wrap">
          {!over ? (gs.weekend ? (
            <Btn variant="acc" className="pulse-acc" onClick={onResumeWeekend}><Icon name="play" />ПРОДОЛЖИТЬ УИК-ЭНД</Btn>
          ) : (
            <Btn variant="acc" className="pulse-acc" onClick={onStartWeekend}><Icon name="flag" />УИК-ЭНД: {circuitOfRound(gs, sid, ss.current).name}</Btn>
          )) : (
            <Btn variant="acc" onClick={onEndSeason}><Icon name="trophy" />ЗАВЕРШИТЬ СЕЗОН</Btn>
          )}
          <div className="text-[13px] text-[#9fb0c4]">
            Этап {Math.min(ss.current + 1, ss.rounds.length)} из {ss.rounds.length}
            {over && <span className="text-[#ffc94d] ml-2 font-semibold">· сезон завершён, подведите итоги</span>}
          </div>
        </div>

        {tab === 'calendar' && <CalendarTab />}
        {tab === 'standings' && <StandingsTab />}
        {tab === 'garage' && <GarageTab />}
        {tab === 'power' && <PowerTab />}
        {tab === 'market' && <MarketTab />}
        {tab === 'editor' && <EditorTab />}
        {tab === 'news' && <NewsTab />}
        {tab === 'saves' && <SavesTab />}
      </main>
    </div>
  );
}

/* ---- Календарь ---- */
function CalendarTab() {
  const { gs } = useGame();
  const sid = gs.playerSeries;
  const ss = gs.series[sid];
  const meta = SERIES_META[sid];
  return (
    <Panel title={`Календарь — ${meta.fullName} · ${gs.year}`} accent delay={0}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {ss.rounds.map((r, i) => {
          const c = ALL_CIRCUITS[r.circuitId];
          const stages = stagesFor(gs, sid, i);
          const cur = i === ss.current;
          const done = r.done;
          return (
            <div key={i} className={`border px-3 py-2.5 flex items-center gap-3 transition-all ${cur ? 'border-[#ff2d2d] bg-[#16121a]' : done ? 'border-[#1d242f] opacity-60' : 'border-[#2a3442]'}`}>
              <span className="font-disp font-black text-[18px] w-8 text-[#3a4757]">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[13px] truncate">{c.name}</div>
                <div className="text-[11px] text-[#7f8da0]">{c.country} · {c.lenKm} км · {stages.length === 5 && sid === 'f1' ? 'спринт' : c.kind === 'oval' ? 'овал' : c.kind === 'street' ? 'городская' : 'стационарная'}</div>
              </div>
              {done ? <Icon name="check" size={16} /> : cur ? <span className="font-disp text-[9px] font-bold text-[#ff2d2d] blink">СЛЕД.</span> : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ---- Зачёты ---- */
function StandingsTab() {
  const { gs } = useGame();
  const sid = gs.playerSeries;
  const ss = gs.series[sid];
  const meta = SERIES_META[sid];
  const dSorted = Object.entries(ss.dStand).filter(([id]) => gs.drivers[id]).sort((a, b) => b[1] - a[1]);
  const tSorted = Object.entries(ss.tStand).filter(([id]) => gs.teams[id]).sort((a, b) => b[1] - a[1]);
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Panel title="Личный зачёт" accent delay={0}>
        {dSorted.map(([did, pts], i) => {
          const d = gs.drivers[did];
          const t = d.teamId ? gs.teams[d.teamId] : null;
          const mine = d.teamId === gs.playerTeamId;
          return (
            <div key={did} className={`flex items-center gap-2.5 py-1.5 border-b border-[#1d242f] ${mine ? 'bg-[#141a24] -mx-2 px-2' : ''}`}>
              <PosBadge pos={i + 1} />
              <FlagTag nat={d.nat} />
              <span className="font-semibold text-[13px] flex-1 truncate">{d.name}</span>
              {t && <TeamDot color={t.color} color2={t.color2} size={9} />}
              <span className="num font-disp font-bold text-[13px]" style={{ color: meta.color }}>{pts}</span>
            </div>
          );
        })}
      </Panel>
      <Panel title="Кубок конструкторов" delay={60}>
        {tSorted.map(([tid, pts], i) => {
          const t = gs.teams[tid];
          const mine = tid === gs.playerTeamId;
          return (
            <div key={tid} className={`flex items-center gap-2.5 py-1.5 border-b border-[#1d242f] ${mine ? 'bg-[#141a24] -mx-2 px-2' : ''}`}>
              <PosBadge pos={i + 1} />
              <TeamDot color={t.color} color2={t.color2} size={12} />
              <span className="font-semibold text-[13px] flex-1 truncate">{t.name}</span>
              <span className="num font-disp font-bold text-[13px]" style={{ color: meta.color }}>{pts}</span>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}

/* ---- Боксы ---- */
function GarageTab() {
  const { gs, dispatch, say } = useGame();
  const pt = playerTeam(gs);
  const meta = SERIES_META[gs.playerSeries];
  const myDrivers = raceDriversOfTeam(gs, pt.id);
  const [msg, setMsg] = useState<string | null>(null);
  const areas = ['aero', 'chassis', 'base', 'power', 'tires'] as const;
  const [pickArea, setPickArea] = useState<null | typeof areas[number]>(null);
  const isF1 = gs.playerSeries === 'f1';

  return (
    <div className="space-y-4">
      {msg && <div className="panel clip-sm border-l-4 px-4 py-2 text-[13px]" style={{ borderLeftColor: meta.color }}>{msg}</div>}

      <Panel title={`Болид — ${pt.name}${meta.specCar ? ` · ${meta.specCar}` : ''}`} accent right={
        <span className="font-disp text-[11px] text-[#9fb0c4]">{meta.specCar ? 'единая спецификация' : ''}</span>
      }>
        <div className="grid sm:grid-cols-2 gap-x-8">
          {areas.map((a) => (
            <StatBar key={a} label={areaLabel(a) + (a === 'power' && !pt.works ? ' (клиентский)' : '')}
              value={a === 'power' ? supplierPower(gs, pt) : pt[a] ?? 60} color={pt.color} />
          ))}
          <StatBar label="Износ силовой установки" value={Math.min(100, pt.wear)} color="#ff6b4b" />
        </div>

        {meta.specCar ? (
          <div className="mt-3 border border-[#2a3442] bg-[#11161d] px-4 py-3 text-[13px] text-[#9fb0c4]">
            <span className="text-[#ffc94d] font-semibold">Серийная техника:</span> все машины одинаковые. Скорость решают настройки болида, работа с шинами и пилоты.
          </div>
        ) : (
          <div className="mt-4">
            <div className="font-disp text-[10px] font-bold tracking-[0.2em] text-[#7f8da0] mb-2 uppercase">Программы развития (обновления не мгновенны)</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {areas.filter((a) => !(a === 'power' && !pt.works)).map((a) => {
                const block = canUpgrade(gs, a);
                return (
                  <button key={a} disabled={!!block} onClick={() => setPickArea(a)}
                    className={`border px-3 py-2 text-left transition-all ${block ? 'border-[#1d242f] opacity-40' : 'border-[#2a3442] hover:border-[#d8f224] hover:-translate-y-0.5'}`}>
                    <div className="text-[12px] font-semibold">{areaLabel(a)}</div>
                    <div className="num text-[11px] text-[#9fb0c4]">{block ?? `от ${money(upgradeCost(gs, pt, a, 'std'))}`}</div>
                  </button>
                );
              })}
            </div>
            {pickArea && (
              <div className="mt-3 border border-[#d8f224] bg-[#141a10] p-3 reveal">
                <div className="font-disp text-[11px] font-bold tracking-widest mb-2" style={{ color: meta.color }}>
                  {areaLabel(pickArea).toUpperCase()} — ВЫБЕРИТЕ ПОДХОД
                </div>
                <div className="grid sm:grid-cols-3 gap-2">
                  {(['cons', 'std', 'aggr'] as const).map((s) => {
                    const st = UPG_STRAT[s];
                    const rounds = upgradeRounds(pickArea, s);
                    const gain = upgradeGain(gs, pickArea, s);
                    const cost = upgradeCost(gs, pt, pickArea, s);
                    return (
                      <div key={s} className="border border-[#2a3442] p-2.5">
                        <div className="text-[12px] font-bold mb-1">{st.label}</div>
                        <ul className="text-[11px] text-[#9fb0c4] space-y-0.5 mb-2">
                          <li>Срок: <b className="text-[#e7edf4]">{rounds} ГП</b></li>
                          <li>Эффект: <b className="text-[#4ade80]">+{gain}</b></li>
                          <li>Цена: <b className="num text-[#e7edf4]">{money(cost)}</b></li>
                          <li>Риск провала: <b style={{ color: st.fail > 0.15 ? '#ff6b4b' : '#4ade80' }}>{Math.round(st.fail * 100)}%</b></li>
                        </ul>
                        <Btn className="w-full !py-1.5" variant="acc" onClick={() => {
                          const err = dispatchUpgrade(gs, dispatch, pickArea, s);
                          setMsg(err ?? `Программа «${areaLabel(pickArea)}» запущена: ${rounds} ГП, ${money(cost)}`);
                          setPickArea(null);
                        }}>Запустить</Btn>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <ActivePrograms />
          </div>
        )}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Элементы силовой установки (Ф1)" delay={40}>
          {isF1 ? myDrivers.map((d) => (
            <div key={d.id} className="mb-4 border border-[#2a3442] p-3">
              <div className="flex items-center gap-2 mb-2">
                <FlagTag nat={d.nat} /><span className="font-bold text-[13px]">{d.name}</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {PU_ELEMENTS.map((el) => <PUChip key={el} did={d.id} el={el} />)}
              </div>
            </div>
          )) : <div className="text-[13px] text-[#7f8da0]">Правило лимита СУ действует только в Формуле 1.</div>}
        </Panel>

        <Panel title="Настройки болидов (по пилотам)" delay={80}>
          <div className="text-[12px] text-[#7f8da0] mb-3">Настраиваются в практиках во время уик-энда. Здесь — текущие значения.</div>
          {myDrivers.map((d) => (
            <div key={d.id} className="mb-3 border border-[#2a3442] p-3">
              <div className="flex items-center gap-2 mb-2"><FlagTag nat={d.nat} /><span className="font-bold text-[13px]">{d.name}</span></div>
              <div className="grid grid-cols-2 gap-x-6">
                {(['aero', 'mech', 'tires', 'brake', 'diff'] as const).map((f) => (
                  <SetupSlider key={f} did={d.id} field={f} />
                ))}
              </div>
            </div>
          ))}
        </Panel>
      </div>

      <Panel title="Стратегия пилотов на гонку" delay={120}>
        <div className="text-[12px] text-[#7f8da0] mb-3">Режим влияет на темп и износ шин. Менять можно и прямо во время гонки с пит-уолла.</div>
        <div className="grid sm:grid-cols-2 gap-3">
          {myDrivers.map((d) => (
            <div key={d.id} className="border border-[#2a3442] p-3">
              <div className="flex items-center gap-2 mb-2"><FlagTag nat={d.nat} /><span className="font-bold text-[13px]">{d.name}</span></div>
              <div className="flex gap-2">
                {([['aggr', 'Атака'], ['balanced', 'Баланс'], ['cons', 'Беречь шины']] as const).map(([m, label]) => (
                  <button key={m} onClick={() => dispatch({ type: 'SET_STRATEGY', did: d.id, preset: m })}
                    className={`flex-1 py-1.5 text-[12px] font-semibold border transition-colors ${gs.strategy[d.id] === m ? 'bg-[#d8f224] text-[#10131a] border-[#d8f224]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#4a5a70]'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Персонал команды" delay={160}>
        <div className="grid sm:grid-cols-2 gap-2">
          {pt.staffIds.map((sid2, i) => {
            const s = gs.staff[sid2];
            if (!s) return null;
            const role = staffRolesFor(pt.seriesId)[i];
            return (
              <div key={sid2} className="border border-[#2a3442] px-3 py-2 flex items-center gap-3">
                <span className="font-disp text-[9px] font-bold text-[#d8f224] w-14 uppercase">{ROLE_NAMES[role]?.slice(0, 12)}</span>
                <span className="font-semibold text-[13px] flex-1 truncate">{s.name}</span>
                <span className="num font-bold text-[13px]" style={{ color: s.skill >= 85 ? '#4ade80' : '#ffc94d' }}>{s.skill}</span>
              </div>
            );
          })}
        </div>
        <div className="text-[11px] text-[#5a6a80] mt-2">Техдиректор усиливает апгрейды · механик ускоряет пит-стопы · инженеры дают советы по настройкам</div>
      </Panel>
    </div>
  );
}

function dispatchUpgrade(gs: import('../game/types').GameState, dispatch: (a: { type: 'UPGRADE'; area: import('../game/types').UpgradeArea; strategy: import('../game/types').UpgradeStrategy }) => void, area: import('../game/types').UpgradeArea, s: import('../game/types').UpgradeStrategy): string | null {
  const err = canUpgrade(gs, area);
  if (err) return err;
  dispatch({ type: 'UPGRADE', area, strategy: s });
  return null;
}

function ActivePrograms() {
  const { gs } = useGame();
  const pt = playerTeam(gs);
  const act = gs.programs.filter((p) => p.teamId === pt.id && p.status === 'active');
  const done = gs.programs.filter((p) => p.teamId === pt.id && p.status !== 'active').slice(-4).reverse();
  if (!act.length && !done.length) return null;
  return (
    <div className="mt-3 space-y-1.5">
      {act.map((p) => (
        <div key={p.id} className="flex items-center gap-3 border border-[#2a3442] px-3 py-2">
          <span className="text-[12px] font-semibold w-36">{areaLabel(p.area)}</span>
          <div className="flex-1 h-[7px] bg-[#0d1117] border border-[#232b37]">
            <div className="h-full bg-[#d8f224] transition-all" style={{ width: `${((p.totalRounds - p.roundsLeft) / p.totalRounds) * 100}%` }} />
          </div>
          <span className="num text-[11px] text-[#9fb0c4]">{p.roundsLeft} ГП · +{p.gain}</span>
        </div>
      ))}
      {done.map((p) => (
        <div key={p.id} className="text-[11px]">
          {p.status === 'done'
            ? <span className="text-[#4ade80]">✓ {areaLabel(p.area)}: +{p.gain} — успешно</span>
            : <span className="text-[#ff6b4b]">✗ {areaLabel(p.area)}: провал обновления</span>}
        </div>
      ))}
    </div>
  );
}

function PUChip({ did, el }: { did: string; el: PUElement }) {
  const { gs, dispatch } = useGame();
  const used = gs.components[did]?.[el] ?? 1;
  const limit = puLimit(gs, el);
  const over = used > limit;
  return (
    <button onClick={() => { dispatch({ type: 'FIT_COMPONENT', did, el }); }}
      title={`Установить новый ${el} (сверх лимита — штраф на решётке)`}
      className={`border px-2 py-1.5 text-left transition-colors ${over ? 'border-[#ff6b4b] bg-[#2a1515]' : 'border-[#2a3442] hover:border-[#4a5a70]'}`}>
      <div className="font-disp text-[9px] font-bold">{el}</div>
      <div className={`num text-[11px] ${over ? 'text-[#ff6b4b]' : 'text-[#9fb0c4]'}`}>{used}/{limit}</div>
    </button>
  );
}

function SetupSlider({ did, field }: { did: string; field: 'aero' | 'mech' | 'tires' | 'brake' | 'diff' }) {
  const { gs, dispatch } = useGame();
  const d = gs.drivers[did];
  const t = d.teamId ? gs.teams[d.teamId] : null;
  const val = t?.setups[did]?.[field] ?? 50;
  const labels = { aero: 'Прижим', mech: 'Мех. зацеп', tires: 'Давление', brake: 'Торм. баланс', diff: 'Дифференциал' };
  return (
    <label className="flex items-center gap-2 text-[11px] text-[#9fb0c4] mb-1">
      <span className="w-[80px] shrink-0">{labels[field]}</span>
      <input type="range" min={0} max={100} value={val}
        onChange={(e) => dispatch({ type: 'SET_SETUP', did, field, value: +e.target.value })}
        className="flex-1 accent-[#d8f224]" />
      <span className="num w-7 text-right text-[#e7edf4] font-semibold">{Math.round(val)}</span>
    </label>
  );
}

/* ---- Рейтинги силы ---- */
function PowerTab() {
  const { gs } = useGame();
  const [sid, setSid] = useState<SeriesId>(gs.playerSeries);
  const meta = SERIES_META[sid];
  const circuits = CALENDARS[sid];
  const ss = gs.series[sid];
  const repCircuit = !isSeasonSeriesOver(gs, sid) ? circuitOfSeries(gs, sid) : circuits[0];

  const teams = Object.values(gs.teams).filter((t) => t.seriesId === sid)
    .map((t) => {
      const aeroW = 0.6 + 0.8 * repCircuit.aeroSens;
      const powW = 0.6 + 0.8 * repCircuit.powerSens;
      const pwr = supplierPower(gs, t);
      const aeroC = (t.aero || 60) * 0.24 * aeroW;
      const chasC = (t.chassis || 60) * 0.24;
      const powC = pwr * 0.25 * powW;
      const baseC = t.base * 0.46;
      let perf = baseC + aeroC + chasC + powC - Math.max(0, t.wear - 55) * 0.09;
      if (!isFinite(perf)) perf = 50;
      return { t, perf: clampNum(perf, 20, 100), aeroC, chasC, powC, pwr };
    })
    .sort((a, b) => b.perf - a.perf);
  const maxPerf = teams[0]?.perf ?? 1;

  const engineMakers = [...new Set(teams.map((x) => x.t.engineMaker))];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {SERIES_ORDER.map((s) => (
          <button key={s} onClick={() => setSid(s)}
            className={`px-3 py-1.5 font-disp text-[11px] font-bold border transition-colors ${sid === s ? 'text-[#10131a]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#4a5a70]'}`}
            style={sid === s ? { background: SERIES_META[s].color, borderColor: SERIES_META[s].color } : undefined}>
            {SERIES_META[s].name}
          </button>
        ))}
      </div>

      <Panel title={`Сила команд — ${meta.fullName}`} accent delay={0}>
        <div className="space-y-2.5">
          {teams.map(({ t, perf, aeroC, chasC, powC }, i) => {
            const mine = t.id === gs.playerTeamId;
            return (
              <div key={t.id}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-disp font-bold text-[12px] w-6 text-[#7f8da0]">{i + 1}</span>
                  <TeamDot color={t.color} color2={t.color2} size={10} />
                  <span className="font-semibold text-[13px] flex-1 truncate">{t.name}{mine && <span className="ml-2 text-[9px] font-disp text-[#ff2d2d]">ВЫ</span>}</span>
                  <span className="num font-disp font-bold text-[13px]" style={{ color: meta.color }}>{perf.toFixed(1)}</span>
                </div>
                <div className="flex h-[8px] bg-[#0d1117] border border-[#232b37] overflow-hidden ml-8">
                  <div style={{ width: `${(aeroC / maxPerf) * 100}%`, background: '#5c9eff' }} title="Аэро" />
                  <div style={{ width: `${(chasC / maxPerf) * 100}%`, background: '#4ade80' }} title="Шасси" />
                  <div style={{ width: `${(powC / maxPerf) * 100}%`, background: '#ffc94d' }} title="Мотор" />
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-3 ml-8 text-[10px] text-[#7f8da0]">
          <span><span className="inline-block w-2 h-2 bg-[#5c9eff] mr-1" />Аэро</span>
          <span><span className="inline-block w-2 h-2 bg-[#4ade80] mr-1" />Шасси</span>
          <span><span className="inline-block w-2 h-2 bg-[#ffc94d] mr-1" />Мотор</span>
        </div>
      </Panel>

      <Panel title="Силовые установки" delay={60}>
        <div className="grid sm:grid-cols-2 gap-3">
          {engineMakers.map((mk) => {
            const users = teams.filter((x) => x.t.engineMaker === mk);
            const works = users.find((x) => x.t.works);
            const power = works ? works.pwr : users[0]?.pwr ?? 0;
            return (
              <div key={mk} className="border border-[#2a3442] p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-disp font-bold text-[14px]">{mk}</span>
                  <span className="num font-disp font-bold text-[15px] text-[#ffc94d]">{power.toFixed(0)}</span>
                </div>
                <div className="text-[11px] text-[#9fb0c4] space-y-0.5">
                  {users.map((x) => (
                    <div key={x.t.id} className="flex items-center gap-1.5">
                      <TeamDot color={x.t.color} color2={x.t.color2} size={8} />
                      <span className="flex-1">{x.t.short}</span>
                      {x.t.works ? <span className="text-[9px] font-disp text-[#4ade80]">ЗАВОДСКАЯ</span> : <span className="text-[9px] text-[#7f8da0]">клиент · 97%</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function clampNum(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function circuitOfSeries(gs: import('../game/types').GameState, sid: SeriesId) {
  return circuitOfRound(gs, sid, gs.series[sid].current);
}
function isSeasonSeriesOver(gs: import('../game/types').GameState, sid: SeriesId) {
  return gs.series[sid].current >= gs.series[sid].rounds.length;
}

/* ---- Трансферы ---- */
function MarketTab() {
  const { gs, dispatch, say } = useGame();
  const [tab2, setTab2] = useState<'drivers' | 'staff' | 'juniors'>('drivers');
  const allDrivers = Object.values(gs.drivers).sort((a, b) => b.pace - a.pace);
  const allStaff = Object.values(gs.staff).filter((s) => s.teamId !== gs.playerTeamId).sort((a, b) => b.skill - a.skill);
  const juniors = Object.values(gs.drivers).filter((d) => !d.teamId && d.age <= 19).sort((a, b) => b.pace - a.pace);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {([['drivers', 'Пилоты'], ['staff', 'Персонал'], ['juniors', 'Юниоры']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab2(t)}
            className={`px-3 py-1.5 font-disp text-[11px] font-bold border transition-colors ${tab2 === t ? 'bg-[#d8f224] text-[#10131a] border-[#d8f224]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#4a5a70]'}`}>
            {label}
          </button>
        ))}
      </div>

      <NegotiationBanners />

      {tab2 === 'drivers' && (
        <Panel title="Рынок пилотов" accent>
          <div className="text-[12px] text-[#7f8da0] mb-3">Переходы вступают в силу только после финала сезона. Ведите переговоры сейчас.</div>
          <div className="max-h-[500px] overflow-y-auto pr-1">
            {allDrivers.filter((d) => d.teamId).map((d) => <DriverRow key={d.id} d={d} />)}
          </div>
        </Panel>
      )}
      {tab2 === 'staff' && (
        <Panel title="Рынок персонала" accent>
          <div className="max-h-[500px] overflow-y-auto pr-1">
            {allStaff.map((s) => <StaffRow key={s.id} s={s} />)}
          </div>
        </Panel>
      )}
      {tab2 === 'juniors' && (
        <Panel title="Академия — юниоры без контракта" accent>
          <div className="text-[12px] text-[#7f8da0] mb-3">Молодые пилоты для правила новичков (Ф1, FP1) и будущих подписаний.</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {juniors.map((d) => (
              <div key={d.id} className="border border-[#2a3442] px-3 py-2">
                <div className="flex items-center gap-2"><FlagTag nat={d.nat} /><span className="font-semibold text-[13px]">{d.name}</span></div>
                <div className="text-[11px] text-[#7f8da0] num">{d.age} лет · темп {d.pace} · форма {d.form}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function NegotiationBanners() {
  const { gs } = useGame();
  const deals = gs.deals;
  const staffDeals = gs.staffDeals;
  if (!deals.length && !staffDeals.length) return null;
  return (
    <Panel title="Согласованные сделки — вступят в силу после финала сезона">
      <div className="space-y-1.5">
        {deals.map((dl) => (
          <div key={dl.did} className="flex items-center gap-3 text-[13px]">
            <Icon name="check" size={14} />
            <span className="font-semibold">{gs.drivers[dl.did]?.name}</span>
            <span className="text-[#7f8da0] num">сбор {money(dl.fee)} · {money(dl.salary)}/год · {dl.years} г.</span>
          </div>
        ))}
        {staffDeals.map((sd) => (
          <div key={sd.sid} className="flex items-center gap-3 text-[13px]">
            <Icon name="check" size={14} />
            <span className="font-semibold">{gs.staff[sd.sid]?.name}</span>
            <span className="text-[#7f8da0] num">{ROLE_NAMES[sd.slotRole]} · {money(sd.salary)}/год</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DriverRow({ d }: { d: Driver }) {
  const { gs, dispatch, say } = useGame();
  const t = d.teamId ? gs.teams[d.teamId] : null;
  const mine = d.teamId === gs.playerTeamId;
  const nego = gs.negos[d.id];
  const hasDeal = gs.deals.some((x) => x.did === d.id);
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#1d242f] py-2">
      <div className="flex items-center gap-2.5 flex-wrap">
        <FlagTag nat={d.nat} />
        <span className="font-semibold text-[13px]">{d.name}</span>
        {t && <span className="text-[11px] text-[#7f8da0]">{SERIES_META[d.seriesId!].name} · {t.short}</span>}
        <span className="text-[11px] text-[#5a6a80] num">{d.age} лет</span>
        {d.retiring && <span className="text-[10px] font-disp font-bold text-[#ff6b4b] border border-[#ff6b4b] px-1.5 py-0.5">УХОДИТ ПОСЛЕ СЕЗОНА</span>}
        <span className="ml-auto flex items-center gap-2">
          <span className="num text-[12px] text-[#d8f224]">{money(d.value)}</span>
          {!mine && !hasDeal && !nego && (
            <button className="font-disp text-[9px] font-bold px-2 py-1 border border-[#2a3442] hover:border-[#d8f224] hover:text-[#d8f224] transition-colors"
              onClick={() => { dispatch({ type: 'START_NEGO', did: d.id }); setOpen(true); }}>ПЕРЕГОВОРЫ</button>
          )}
          {hasDeal && <span className="font-disp text-[9px] font-bold text-[#4ade80]">СДЕЛКА ✓</span>}
          {nego && (
            <button className="font-disp text-[9px] font-bold px-2 py-1 border border-[#ffc94d] text-[#ffc94d]" onClick={() => setOpen(!open)}>
              {open ? 'СВЕРНУТЬ' : 'ПЕРЕГОВОРЫ'}
            </button>
          )}
        </span>
      </div>
      <div className="flex gap-4 mt-1 ml-7 text-[11px] num text-[#7f8da0]">
        <span>Темп {Math.round(d.pace)}</span><span>Борьба {Math.round(d.racecraft)}</span>
        <span>Стаб. {Math.round(d.consistency)}</span><span>Дождь {Math.round(d.wet)}</span>
        <span>Контракт: {d.contract > 0 ? `${d.contract} г.` : 'свободен'}</span>
      </div>
      {nego && open && <NegoPanel did={d.id} />}
    </div>
  );
}

function NegoPanel({ did }: { did: string }) {
  const { gs, dispatch, say } = useGame();
  const [, force] = useState(0);
  const n = gs.negos[did];
  const d = gs.drivers[did];
  if (!n) return null;
  const bump = () => force((x) => x + 1);
  return (
    <div className="ml-7 mt-2 border border-[#2a3442] bg-[#11161d] p-3 reveal">
      <div className="text-[12px] mb-2">Интерес пилота: <b className="num" style={{ color: n.interest > 50 ? '#4ade80' : '#ffc94d' }}>{n.interest}%</b>
        {n.collapsed && <span className="ml-2 text-[#ff6b4b] font-semibold">— переговоры сорваны</span>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="border border-[#2a3442] p-2.5">
          <div className="font-disp text-[9px] font-bold tracking-wider text-[#7f8da0] mb-1.5 uppercase">Контракт с пилотом</div>
          <div className="text-[11px] text-[#9fb0c4] num mb-1.5">Требует: {money(n.askSalary)}/год · бонус {money(n.askBonus)} · {n.askYears} г.</div>
          <div className="flex gap-1.5 items-center mb-1.5">
            <span className="text-[11px] text-[#7f8da0] w-14">Зарплата:</span>
            <input type="range" min={Math.round(n.askSalary * 0.5)} max={Math.round(n.askSalary * 1.6)} step={50000}
              value={n.offerSalary} onChange={(e) => { n.offerSalary = +e.target.value; bump(); }} className="flex-1 accent-[#d8f224]" />
            <span className="num text-[11px] w-16 text-right">{money(n.offerSalary)}</span>
          </div>
          <div className="flex gap-1.5 items-center mb-1.5">
            <span className="text-[11px] text-[#7f8da0] w-14">Бонус:</span>
            <input type="range" min={0} max={Math.round(n.askBonus * 1.6)} step={50000}
              value={n.offerBonus} onChange={(e) => { n.offerBonus = +e.target.value; bump(); }} className="flex-1 accent-[#d8f224]" />
            <span className="num text-[11px] w-16 text-right">{money(n.offerBonus)}</span>
          </div>
          <div className="flex gap-1.5 items-center mb-1.5">
            <span className="text-[11px] text-[#7f8da0] w-14">Лет:</span>
            {[1, 2, 3].map((y) => (
              <button key={y} onClick={() => { n.offerYears = y; bump(); }}
                className={`w-7 h-7 font-disp text-[11px] font-bold border ${n.offerYears === y ? 'bg-[#d8f224] text-[#10131a] border-[#d8f224]' : 'border-[#2a3442] text-[#9fb0c4]'}`}>{y}</button>
            ))}
          </div>
          {n.driverAgreed
            ? <div className="text-[11px] font-semibold text-[#4ade80]">✓ Пилот согласен</div>
            : <Btn className="!py-1 w-full" disabled={n.collapsed} onClick={() => { dispatch({ type: 'OFFER_DRIVER', did }); bump(); say('Предложение отправлено пилоту'); }}>Предложить</Btn>}
        </div>
        <div className="border border-[#2a3442] p-2.5">
          <div className="font-disp text-[9px] font-bold tracking-wider text-[#7f8da0] mb-1.5 uppercase">Отступные команде</div>
          {n.feeAgreed ? (
            <div className="text-[11px] font-semibold text-[#4ade80]">✓ Команда согласна{d.teamId ? '' : ' (свободный агент)'}</div>
          ) : (
            <>
              <div className="text-[11px] text-[#9fb0c4] num mb-1.5">Просят: {money(n.feeAsk)}</div>
              <div className="flex gap-1.5 items-center mb-1.5">
                <span className="text-[11px] text-[#7f8da0] w-14">Офер:</span>
                <input type="range" min={Math.round(n.feeAsk * 0.5)} max={Math.round(n.feeAsk * 1.6)} step={50000}
                  value={n.feeOffer} onChange={(e) => { n.feeOffer = +e.target.value; bump(); }} className="flex-1 accent-[#d8f224]" />
                <span className="num text-[11px] w-16 text-right">{money(n.feeOffer)}</span>
              </div>
              <Btn className="!py-1 w-full" disabled={n.collapsed} onClick={() => { dispatch({ type: 'OFFER_FEE', did }); bump(); say('Предложение отправлено команде'); }}>Предложить</Btn>
            </>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-2">
        <Btn className="!py-1" onClick={() => dispatch({ type: 'CANCEL_NEGO', did })}>Прервать</Btn>
      </div>
    </div>
  );
}

function StaffRow({ s }: { s: Staff }) {
  const { gs, dispatch, say } = useGame();
  const t = s.teamId ? gs.teams[s.teamId] : null;
  const nego = gs.staffNegos[s.id];
  const hasDeal = gs.staffDeals.some((x) => x.sid === s.id);
  return (
    <div className="border-b border-[#1d242f] py-2 flex items-center gap-2.5 flex-wrap">
      <span className="font-semibold text-[13px]">{s.name}</span>
      <span className="text-[11px] text-[#7f8da0]">{ROLE_NAMES[s.role]} · {t?.short ?? '—'}</span>
      <span className="ml-auto flex items-center gap-2">
        <span className="num font-bold text-[13px]" style={{ color: s.skill >= 85 ? '#4ade80' : '#ffc94d' }}>{s.skill}</span>
        {hasDeal ? <span className="font-disp text-[9px] font-bold text-[#4ade80]">СДЕЛКА ✓</span>
          : nego ? (
            <button className="font-disp text-[9px] font-bold px-2 py-1 border border-[#ffc94d] text-[#ffc94d]"
              onClick={() => say(negoStaff(gs, dispatch, s.id))}>ПРЕДЛОЖИТЬ {money(nego.offerSalary)}</button>
          ) : (
            <button className="font-disp text-[9px] font-bold px-2 py-1 border border-[#2a3442] hover:border-[#d8f224] hover:text-[#d8f224] transition-colors"
              onClick={() => { dispatch({ type: 'STAFF_NEGO', sid: s.id, slotRole: s.role }); say('Переговоры начаты'); }}>ПЕРЕГОВОРЫ</button>
          )}
      </span>
    </div>
  );
}
function negoStaff(gs: import('../game/types').GameState, dispatch: (a: { type: 'OFFER_STAFF'; sid: string }) => void, sid: string): string {
  dispatch({ type: 'OFFER_STAFF', sid });
  return 'Предложение отправлено';
}

/* ---- Редактор ---- */
function EditorTab() {
  const { gs, dispatch } = useGame();
  const [kind, setKind] = useState<'driver' | 'team' | 'points'>('driver');
  const [selDriver, setSelDriver] = useState<string>(Object.keys(gs.drivers)[0] ?? '');
  const [selTeam, setSelTeam] = useState<string>(gs.playerTeamId);
  const d = gs.drivers[selDriver];
  const t = gs.teams[selTeam];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {([['driver', 'Пилоты'], ['team', 'Команды'], ['points', 'Очки']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)}
            className={`px-3 py-1.5 font-disp text-[11px] font-bold border transition-colors ${kind === k ? 'bg-[#d8f224] text-[#10131a] border-[#d8f224]' : 'border-[#2a3442] text-[#9fb0c4] hover:border-[#4a5a70]'}`}>
            {label}
          </button>
        ))}
      </div>

      {kind === 'driver' && d && (
        <Panel title="Редактор пилота" accent>
          <select value={selDriver} onChange={(e) => setSelDriver(e.target.value)}
            className="w-full bg-[#0d1117] border border-[#2a3442] px-2 py-1.5 text-[13px] mb-4">
            {Object.values(gs.drivers).sort((a, b) => a.name.localeCompare(b.name)).map((x) => (
              <option key={x.id} value={x.id}>{x.name} ({x.code})</option>
            ))}
          </select>
          <div className="grid sm:grid-cols-2 gap-x-8">
            {([['pace', 'Темп'], ['racecraft', 'Борьба'], ['consistency', 'Стабильность'], ['wet', 'Дождь'], ['form', 'Форма']] as const).map(([f, label]) => (
              <label key={f} className="flex items-center gap-2 text-[12px] text-[#9fb0c4] mb-2">
                <span className="w-[110px] shrink-0">{label}</span>
                <input type="range" min={30} max={99} value={d[f]}
                  onChange={(e) => dispatch({ type: 'EDITOR_SET', kind: 'driver', id: d.id, field: f, value: +e.target.value })}
                  className="flex-1 accent-[#ff2d2d]" />
                <span className="num w-8 text-right font-bold text-[#e7edf4]">{d[f]}</span>
              </label>
            ))}
            <label className="flex items-center gap-2 text-[12px] text-[#9fb0c4] mb-2">
              <span className="w-[110px] shrink-0">Возраст</span>
              <input type="range" min={16} max={46} value={d.age}
                onChange={(e) => dispatch({ type: 'EDITOR_SET', kind: 'driver', id: d.id, field: 'age', value: +e.target.value })}
                className="flex-1 accent-[#ff2d2d]" />
              <span className="num w-8 text-right font-bold text-[#e7edf4]">{d.age}</span>
            </label>
          </div>
        </Panel>
      )}

      {kind === 'team' && t && (
        <Panel title="Редактор команды" accent>
          <select value={selTeam} onChange={(e) => setSelTeam(e.target.value)}
            className="w-full bg-[#0d1117] border border-[#2a3442] px-2 py-1.5 text-[13px] mb-4">
            {Object.values(gs.teams).sort((a, b) => a.name.localeCompare(b.name)).map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
          <div className="grid sm:grid-cols-2 gap-x-8">
            {([['base', 'База'], ['aero', 'Аэро'], ['chassis', 'Шасси'], ['power', 'Мотор'], ['tires', 'Шины'], ['reputation', 'Репутация']] as const).map(([f, label]) => (
              <label key={f} className="flex items-center gap-2 text-[12px] text-[#9fb0c4] mb-2">
                <span className="w-[110px] shrink-0">{label}</span>
                <input type="range" min={20} max={99} value={t[f] ?? 60}
                  onChange={(e) => dispatch({ type: 'EDITOR_SET', kind: 'team', id: t.id, field: f, value: +e.target.value })}
                  className="flex-1 accent-[#ff2d2d]" />
                <span className="num w-8 text-right font-bold text-[#e7edf4]">{Math.round(t[f] ?? 60)}</span>
              </label>
            ))}
          </div>
        </Panel>
      )}

      {kind === 'points' && (
        <Panel title="Начислить / снять очки" accent>
          <div className="max-h-[420px] overflow-y-auto pr-1">
            {seriesDrivers(gs, gs.playerSeries).sort((a, b) => (gs.series[gs.playerSeries].dStand[b.id] ?? 0) - (gs.series[gs.playerSeries].dStand[a.id] ?? 0)).map((drv) => (
              <div key={drv.id} className="flex items-center gap-2.5 border-b border-[#1d242f] py-1.5">
                <span className="font-semibold text-[13px] flex-1">{drv.name}</span>
                <span className="num font-bold text-[13px] text-[#d8f224] w-12 text-right">{gs.series[gs.playerSeries].dStand[drv.id] ?? 0}</span>
                {[-25, -10, +10, +25].map((delta) => (
                  <button key={delta} onClick={() => dispatch({ type: 'EDITOR_POINTS', sid: gs.playerSeries, did: drv.id, delta })}
                    className={`num font-disp text-[10px] font-bold px-2 py-1 border transition-colors ${delta < 0 ? 'border-[#3a2a2a] text-[#ff6b4b] hover:bg-[#2a1515]' : 'border-[#2a3a2a] text-[#4ade80] hover:bg-[#152a15]'}`}>
                    {delta > 0 ? `+${delta}` : delta}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ---- Новости ---- */
function NewsTab() {
  const { gs } = useGame();
  return (
    <Panel title="Лента новостей" accent>
      <div className="space-y-2">
        {gs.news.map((n, i) => (
          <div key={i} className="flex gap-3 border-b border-[#1d242f] pb-2">
            <span className="font-disp text-[9px] font-bold px-1.5 py-0.5 h-fit whitespace-nowrap" style={{ background: '#1a2230', color: '#9fb0c4' }}>{n.tag}</span>
            <div className="flex-1">
              <div className="text-[13px]">{n.text}</div>
              <div className="text-[10px] text-[#5a6a80] num">сезон {n.year} · этап {n.round}</div>
            </div>
          </div>
        ))}
        {!gs.news.length && <div className="text-[13px] text-[#7f8da0]">Пока тихо…</div>}
      </div>
    </Panel>
  );
}

/* ---- Сэйвы ---- */
function SavesTab() {
  const { gs, dispatch, say } = useGame();
  const saves = listSaves();
  return (
    <Panel title="Сохранения" accent>
      <div className="grid sm:grid-cols-2 gap-3">
        {['s1', 's2', 's3'].map((slot, i) => {
          const s = saves[i + 1];
          return (
            <div key={slot} className="border border-[#2a3442] p-3">
              <div className="font-disp font-bold text-[13px] mb-1 uppercase">Слот {slot.toUpperCase()}</div>
              {s ? (
                <>
                  <div className="text-[12px] text-[#9fb0c4]">{s.team} · {SERIES_META[s.series].fullName}</div>
                  <div className="text-[11px] text-[#5a6a80] num mb-2">сезон {s.seasonN} · {s.year} · {new Date(s.ts).toLocaleString()}</div>
                </>
              ) : <div className="text-[12px] text-[#5a6a80] mb-2">Пусто</div>}
              <div className="flex gap-2">
                <Btn className="!py-1.5" variant="acc" onClick={() => { dispatch({ type: 'SAVE', slot }); say(`Сохранено в ${slot.toUpperCase()}`); }}>
                  <Icon name="save" />Сохранить
                </Btn>
                {s && <Btn className="!py-1.5" onClick={() => { deleteSave(slot); say('Слот очищен'); }}>Очистить</Btn>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] text-[#5a6a80] mt-3">Автосейв записывается после каждой сессии и гонки.</div>
    </Panel>
  );
}

/* ---- Трансферное окно (фаза market) ---- */
export function MarketStandalone({ onNewSeason }: { onNewSeason: () => void }) {
  const { gs } = useGame();
  return (
    <div className="min-h-screen pb-16">
      <header className="border-b border-[#252e3b] bg-[#0d1117cc] backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <span className="font-disp font-black text-2xl text-[#ff2d2d]">APEX</span>
          <div>
            <div className="font-disp font-bold text-[16px]">ТРАНСФЕРНОЕ ОКНО</div>
            <div className="text-[11px] text-[#7f8da0]">Межсезонье · согласуйте сделки перед новым чемпионатом</div>
          </div>
          <div className="ml-auto">
            <Btn variant="acc" onClick={onNewSeason}><Icon name="flag" />НОВЫЙ СЕЗОН {gs.year + 1}</Btn>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="text-[13px] text-[#9fb0c4] mb-4">
          Сделки, согласованные сейчас, вступят в силу со стартом сезона. Также можно сменить команду ниже.
        </div>
        <TeamSwitcher />
        <div className="mt-6"><MarketTab /></div>
      </main>
    </div>
  );
}

function TeamSwitcher() {
  const { gs, dispatch, say } = useGame();
  const [open, setOpen] = useState(false);
  const others = Object.values(gs.teams).filter((t) => t.id !== gs.playerTeamId);
  return (
    <Panel title="Сменить команду / серию">
      {!open ? (
        <Btn onClick={() => setOpen(true)}><Icon name="swap" />ВЫБРАТЬ ДРУГУЮ КОМАНДУ</Btn>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {others.map((t) => (
            <button key={t.id} onClick={() => { dispatch({ type: 'SWITCH_TEAM', teamId: t.id }); say(`Вы возглавили ${t.name}`); }}
              className="border border-[#2a3442] hover:border-[#ff2d2d] px-3 py-2 text-left transition-colors">
              <div className="flex items-center gap-2"><TeamDot color={t.color} color2={t.color2} size={12} /><span className="font-semibold text-[13px]">{t.name}</span></div>
              <div className="text-[11px] text-[#7f8da0]">{SERIES_META[t.seriesId].fullName} · бюджет {money(t.budget)}</div>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---- Итоги сезона ---- */
export function SummaryScreen({ onNewSeason, onMarket }: { onNewSeason: () => void; onMarket: () => void }) {
  const { gs } = useGame();
  const s = gs.summary;
  if (!s) return null;
  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <div className="checker h-2 mb-6" />
      <h1 className="font-disp font-black text-4xl mb-1">ИТОГИ СЕЗОНА {s.year}</h1>
      <div className="text-[14px] text-[#9fb0c4] mb-6">Чемпион: <b className="text-[#ffd75c]">{s.champion}</b> · Кубок конструкторов: <b className="text-[#ffd75c]">{s.teamChampion}</b> · Вы — <b className="text-[#d8f224]">{s.playerPos}-е место</b></div>

      {s.rookieFine > 0 && (
        <div className="panel clip-sm border-l-4 border-[#ff6b4b] px-4 py-2.5 text-[13px] mb-4">
          Штраф за нарушение правила новичков: <b className="num">{money(s.rookieFine)}</b>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <Panel title="Трансферы и сделки" delay={0}>
          {s.dealsApplied.length ? s.dealsApplied.map((m, i) => <div key={i} className="text-[13px] text-[#4ade80] py-0.5">✓ {m}</div>) : <div className="text-[12px] text-[#7f8da0]">Сделок не было</div>}
          {s.driverMoves.map((m, i) => <div key={i} className="text-[13px] py-0.5">{m}</div>)}
        </Panel>
        <Panel title="Изменение навыков пилотов" delay={60}>
          {s.skillChanges.map((sc) => {
            const d = gs.drivers[sc.did];
            if (!d) return null;
            return (
              <div key={sc.did} className="flex items-center gap-2 text-[13px] py-0.5">
                <span className="flex-1">{d.name}</span>
                <span className={`num font-bold ${sc.delta >= 0 ? 'text-[#4ade80]' : 'text-[#ff6b4b]'}`}>{sc.delta >= 0 ? '+' : ''}{sc.delta}</span>
              </div>
            );
          })}
        </Panel>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Btn variant="acc" onClick={onMarket}><Icon name="swap" />ТРАНСФЕРНОЕ ОКНО</Btn>
        <Btn onClick={onNewSeason}><Icon name="flag" />НОВЫЙ СЕЗОН {s.year + 1}</Btn>
      </div>
    </div>
  );
}
