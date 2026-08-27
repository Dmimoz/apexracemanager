import { useState } from 'react';
import { GameProvider, useGame } from './game/GameContext';
import { newCareer } from './game/engine';
import type { GameState, SeriesId, Stage } from './game/types';
import { HubScreen, MarketStandalone, NewCareer, SummaryScreen, TitleScreen } from './components/Screens';
import WeekendScreen from './components/Weekend';
import RaceLive from './components/RaceLive';
import SessionLive from './components/SessionLive';
import { isRaceLikeStage } from './game/engine';

function Shell() {
  const { gs, dispatch } = useGame();
  const [live, setLive] = useState<{ kind: 'race' | 'session'; stage: Stage } | null>(null);
  const [startTires, setStartTires] = useState<Record<string, string>>({});

  if (gs.phase === 'summary') {
    return (
      <SummaryScreen
        onNewSeason={() => dispatch({ type: 'NEW_SEASON' })}
        onMarket={() => dispatch({ type: 'TO_MARKET' })}
      />
    );
  }
  if (gs.phase === 'market') {
    return <MarketStandalone onNewSeason={() => dispatch({ type: 'NEW_SEASON' })} />;
  }

  if (live && gs.weekend) {
    if (live.kind === 'race') {
      return (
        <RaceLive
          stage={live.stage}
          startTires={startTires}
          onDone={() => { setLive(null); setStartTires({}); }}
          onAbort={() => setLive(null)}
        />
      );
    }
    return (
      <SessionLive
        stage={live.stage}
        onDone={() => setLive(null)}
        onAbort={() => setLive(null)}
      />
    );
  }

  if (gs.phase === 'weekend' && gs.weekend) {
    return (
      <WeekendScreen
        onStartSession={(stage) => {
          setLive({ kind: isRaceLikeStage(stage) ? 'race' : 'session', stage });
        }}
      />
    );
  }

  return (
    <HubScreen
      onStartWeekend={() => dispatch({ type: 'BEGIN_WEEKEND' })}
      onResumeWeekend={() => dispatch({ type: 'RESUME_WEEKEND' })}
      onEndSeason={() => dispatch({ type: 'END_SEASON' })}
    />
  );
}

export default function App() {
  const [gs, setGs] = useState<GameState | null>(null);
  const [screen, setScreen] = useState<'title' | 'new' | 'game'>('title');
  const [sessionKey, setSessionKey] = useState(0);

  if (screen === 'title') {
    return (
      <TitleScreen
        onLoad={(g) => { setGs(g); setSessionKey((k) => k + 1); setScreen('game'); }}
        onNew={() => setScreen('new')}
      />
    );
  }
  if (screen === 'new') {
    return (
      <NewCareer
        onBack={() => setScreen('title')}
        onStart={(sid: SeriesId, teamId: string) => {
          setGs(newCareer(sid, teamId));
          setSessionKey((k) => k + 1);
          setScreen('game');
        }}
      />
    );
  }
  if (!gs) return null;
  return (
    <GameProvider key={sessionKey} initial={gs}>
      <Shell />
      <button
        className="fixed bottom-3 right-3 z-40 btn-race !px-3 !py-1.5 opacity-70 hover:opacity-100"
        title="Выйти в главное меню (прогресс сохраняется автоматически)"
        onClick={() => { setGs(null); setScreen('title'); }}
      >
        <span className="text-[10px]">В МЕНЮ</span>
      </button>
    </GameProvider>
  );
}
