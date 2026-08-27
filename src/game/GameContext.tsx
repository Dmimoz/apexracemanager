import { createContext, useContext, useMemo, useReducer, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { GameState, SeriesId, Setup, Stage, StrategyPreset, UpgradeArea, UpgradeStrategy } from './types';
import type { RaceSim, SessionSim } from './engine';
import {
  applySession, beginWeekend, cancelDeal, cancelNego, cancelStaffNego, clone, editorPoints, editorSet,
  endSeason, fitComponent, offerFeeToTeam, offerToDriver, offerToStaff, saveGame, setDriverSetup,
  setRookieChoice, setStrategy, simOtherSeries, skipSession, startNego, startNewSeason,
  startStaffNego, startUpgrade, switchPlayerTeam,
} from './engine';

export type Action =
  | { type: 'BEGIN_WEEKEND' }
  | { type: 'RESUME_WEEKEND' }
  | { type: 'BACK_TO_HUB' }
  | { type: 'SKIP_SESSION' }
  | { type: 'APPLY_SESSION'; sim: SessionSim | RaceSim; stage: Stage }
  | { type: 'SET_STRATEGY'; did: string; preset: StrategyPreset }
  | { type: 'SET_ROOKIE'; slot: 0 | 1 | 2; rookieId?: string }
  | { type: 'SET_SETUP'; did: string; field: keyof Setup; value: number }
  | { type: 'FIT_COMPONENT'; did: string; el: Parameters<typeof fitComponent>[2] }
  | { type: 'UPGRADE'; area: UpgradeArea; strategy: UpgradeStrategy }
  | { type: 'START_NEGO'; did: string }
  | { type: 'OFFER_DRIVER'; did: string }
  | { type: 'OFFER_FEE'; did: string }
  | { type: 'CANCEL_NEGO'; did: string }
  | { type: 'CANCEL_DEAL'; did: string }
  | { type: 'STAFF_NEGO'; sid: string; slotRole: Parameters<typeof startStaffNego>[2] }
  | { type: 'OFFER_STAFF'; sid: string }
  | { type: 'CANCEL_STAFF_NEGO'; sid: string }
  | { type: 'SWITCH_TEAM'; teamId: string }
  | { type: 'END_SEASON' }
  | { type: 'TO_MARKET' }
  | { type: 'NEW_SEASON' }
  | { type: 'SAVE'; slot: string }
  | { type: 'EDITOR_SET'; kind: 'driver' | 'team' | 'staff'; id: string; field: string; value: number }
  | { type: 'EDITOR_POINTS'; sid: SeriesId; did: string; delta: number };

function reducer(gs: GameState, a: Action): GameState {
  const g = clone(gs);
  switch (a.type) {
    case 'BEGIN_WEEKEND':
      beginWeekend(g);
      saveGame('auto', g);
      return g;
    case 'RESUME_WEEKEND':
      if (g.weekend) g.phase = 'weekend';
      return g;
    case 'BACK_TO_HUB':
      g.phase = 'hub';
      return g;
    case 'SKIP_SESSION': {
      const res = skipSession(g);
      if (res) saveGame('auto', g);
      return g;
    }
    case 'APPLY_SESSION': {
      applySession(g, a.sim, a.stage);
      if (a.stage === 'race') simOtherSeries(g);
      saveGame('auto', g);
      return g;
    }
    case 'SET_STRATEGY':
      setStrategy(g, a.did, a.preset);
      return g;
    case 'SET_ROOKIE':
      setRookieChoice(g, a.slot, a.rookieId);
      return g;
    case 'SET_SETUP':
      setDriverSetup(g, a.did, a.field, a.value);
      return g;
    case 'FIT_COMPONENT': {
      fitComponent(g, a.did, a.el, g.weekend);
      saveGame('auto', g);
      return g;
    }
    case 'UPGRADE':
      startUpgrade(g, a.area, a.strategy);
      saveGame('auto', g);
      return g;
    case 'START_NEGO':
      startNego(g, a.did);
      return g;
    case 'OFFER_DRIVER':
      offerToDriver(g, a.did);
      return g;
    case 'OFFER_FEE':
      offerFeeToTeam(g, a.did);
      return g;
    case 'CANCEL_NEGO':
      cancelNego(g, a.did);
      return g;
    case 'CANCEL_DEAL':
      cancelDeal(g, a.did);
      return g;
    case 'STAFF_NEGO':
      startStaffNego(g, a.sid, a.slotRole);
      return g;
    case 'OFFER_STAFF':
      offerToStaff(g, a.sid);
      return g;
    case 'CANCEL_STAFF_NEGO':
      cancelStaffNego(g, a.sid);
      return g;
    case 'SWITCH_TEAM':
      switchPlayerTeam(g, a.teamId);
      return g;
    case 'END_SEASON':
      endSeason(g);
      return g;
    case 'TO_MARKET':
      g.phase = 'market';
      return g;
    case 'NEW_SEASON':
      startNewSeason(g);
      return g;
    case 'SAVE':
      saveGame(a.slot, g);
      return g;
    case 'EDITOR_SET':
      editorSet(g, a.kind, a.id, a.field, a.value);
      return g;
    case 'EDITOR_POINTS':
      editorPoints(g, a.sid, a.did, a.delta);
      saveGame('auto', g);
      return g;
    default:
      return g;
  }
}

interface Ctx {
  gs: GameState;
  dispatch: React.Dispatch<Action>;
  msg: string | null;
  say: (m: string) => void;
}

const GameCtx = createContext<Ctx | null>(null);

export function GameProvider({ initial, children }: { initial: GameState; children: ReactNode }) {
  const [gs, dispatch] = useReducer(reducer, initial);
  const [msg, setMsg] = useState<string | null>(null);
  const say = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3200);
  }, []);
  const value = useMemo(() => ({ gs, dispatch, msg, say }), [gs, msg, say]);
  return <GameCtx.Provider value={value}>{children}</GameCtx.Provider>;
}

export function useGame(): Ctx {
  const ctx = useContext(GameCtx);
  if (!ctx) throw new Error('useGame outside provider');
  return ctx;
}
