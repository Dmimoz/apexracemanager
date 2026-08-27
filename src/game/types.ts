export type SeriesId = 'f1' | 'f2' | 'f3' | 'indy' | 'fe';

export type Stage =
  | 'fp1' | 'fp2' | 'fp3' | 'fp'
  | 'quali' | 'sq'
  | 'sprint' | 'sprintRev'
  | 'race';

export type WeatherKind = 'dry' | 'clouds' | 'wet';
export type StrategyPreset = 'aggr' | 'balanced' | 'cons';
export type StaffRole = 'techdir' | 'aero' | 'mechanic' | 'engineer';
export type UpgradeArea = 'aero' | 'chassis' | 'power' | 'base' | 'tires';
export type UpgradeStrategy = 'cons' | 'std' | 'aggr';

/** Настройки болида (0-100), отдельные для каждого пилота */
export interface Setup {
  aero: number;   // прижимная сила
  mech: number;   // механический зацеп
  tires: number;  // давление шин
  brake: number;  // тормозной баланс (50 — нейтрально)
  diff: number;   // дифференциал
}

export interface Driver {
  id: string; name: string; code: string; nat: string; age: number;
  pace: number; racecraft: number; consistency: number; wet: number; form: number;
  teamId: string | null; seriesId: SeriesId | null;
  f1Starts: number; gpStarts: number;
  value: number; salary: number; contract: number;
  reserve?: boolean; retiring?: boolean;
}

export interface Staff {
  id: string; name: string; role: StaffRole; skill: number; salary: number; teamId: string | null;
}

export interface Team {
  id: string; seriesId: SeriesId; name: string; short: string; color: string; color2: string;
  engineMaker: string; works: boolean;
  base: number; aero: number; chassis: number; power: number; tires: number; wear: number;
  budget: number; reputation: number; capSpent: number;
  staffIds: string[];
  setups: Record<string, Setup>; // по did — настройки каждого пилота
}

export type TrackKind = 'road' | 'street' | 'oval';

export interface Circuit {
  id: string; name: string; country: string; lenKm: number; laps: number;
  aeroSens: number; powerSens: number; deg: number; danger: number; ovrt: number;
  kind: TrackKind; seed: number; rainChance: number; sprint?: boolean;
  outline?: string;
}

export interface TableRow {
  pos: number; did: string; tid: string; display: string; best?: string | null;
  points: number; note?: string;
}

export interface RoundResult { quali: TableRow[]; race: TableRow[]; sprint?: TableRow[]; }
export interface Round { circuitId: string; done: boolean; result?: RoundResult; }

export interface SeriesState {
  id: SeriesId; rounds: Round[]; current: number;
  dStand: Record<string, number>; tStand: Record<string, number>;
}

export interface SessionResult { stage: Stage; title: string; rows: TableRow[]; notes: string[]; }

export interface Weekend {
  roundIdx: number; stages: Stage[]; stageIdx: number;
  results: Record<string, SessionResult>;
  qualiGrid: string[]; pendingGrid: Record<string, number>; pitStart: string[];
  rookieChoice: 0 | 1 | 2 | null; rookieId?: string;
  weather: Record<string, WeatherKind>;
  rainMidRace: boolean;
  setupNotes: string[];
}

export interface NewsItem { text: string; tag: string; year: number; round: number; }

export interface SummaryData {
  year: number; champion: string; teamChampion: string;
  playerPos: number; driverMoves: string[];
  skillChanges: { did: string; delta: number }[]; rookieFine: number; dealsApplied: string[];
}

export interface UpgradeProgram {
  id: string; teamId: string; area: UpgradeArea; strategy: UpgradeStrategy;
  roundsLeft: number; totalRounds: number; gain: number; cost: number;
  status: 'active' | 'done' | 'failed';
}

export interface SponsorGoal { type: string; target: number; label: string; roundsMet: number; seasonMet: boolean; }
export interface Sponsor {
  id: string; name: string; tier: 'title' | 'major' | 'partner'; value: number;
  goal: SponsorGoal; active: boolean;
}

export interface Negotiation {
  did: string; interest: number; askSalary: number; askBonus: number; askYears: number;
  offerSalary: number; offerBonus: number; offerYears: number;
  driverAgreed: boolean; feeAsk: number; feeOffer: number; feeAgreed: boolean; collapsed: boolean;
}
export interface Deal { did: string; fee: number; salary: number; years: number; }
export interface StaffNegotiation { sid: string; askSalary: number; offerSalary: number; agreed: boolean; collapsed: boolean; slotRole: StaffRole; }
export interface StaffDeal { sid: string; salary: number; slotRole: StaffRole; }

export type Phase = 'hub' | 'weekend' | 'summary' | 'market';

export interface GameState {
  v: number; year: number; seasonN: number; phase: Phase;
  playerSeries: SeriesId; playerTeamId: string;
  reputation: number; budget: number;
  series: Record<SeriesId, SeriesState>;
  drivers: Record<string, Driver>; teams: Record<string, Team>; staff: Record<string, Staff>;
  components: Record<string, Record<string, number>>;
  nextRoundPen: Record<string, number>;
  rookieUsed: number; strategy: Record<string, StrategyPreset>;
  weekend: Weekend | null; news: NewsItem[];
  careerWins: number; careerPodiums: number; careerTitles: number;
  summary: SummaryData | null;
  mods: { puLimitBonus: number; degMod: number; drsMod: number; payMod: number; capMod: number };
  negos: Record<string, Negotiation>; deals: Deal[];
  staffNegos: Record<string, StaffNegotiation>; staffDeals: StaffDeal[];
  programs: UpgradeProgram[];
  sponsors: Sponsor[]; ownerTrust: number; fired: boolean;
}

export interface TrackGeo {
  pts: [number, number][]; cum: number[]; total: number;
  factor: number[]; avgFactor: number; drsSegs: boolean[]; slowSegs: boolean[];
}

export interface SaveMeta {
  slot: string; year: number; seasonN: number; series: SeriesId; team: string; phase: Phase; ts: number;
}
