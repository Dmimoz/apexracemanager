import type { CSSProperties, ReactNode } from 'react';
import type { WeatherKind } from '../game/types';

export function Btn({ children, onClick, variant, disabled, className = '', title }: {
  children: ReactNode; onClick?: () => void; variant?: 'acc' | 'ghost' | 'tab';
  disabled?: boolean; className?: string; title?: string;
}) {
  return (
    <button title={title}
      className={`btn-race ${variant === 'acc' ? 'btn-acc' : ''} ${className}`}
      onClick={onClick} disabled={disabled}>
      <span className="inline-flex items-center gap-2">{children}</span>
    </button>
  );
}

export function Panel({ title, children, className = '', delay = 0, accent = false, right }: {
  title?: ReactNode; children: ReactNode; className?: string; delay?: number; accent?: boolean; right?: ReactNode;
}) {
  return (
    <section className={`panel ${accent ? 'panel-hl' : ''} clip reveal ${className}`}
      style={{ animationDelay: `${delay}ms` } as CSSProperties}>
      {title != null && (
        <header className="flex items-center justify-between gap-3 border-b border-[#252e3b] px-4 py-2.5">
          <h3 className="font-disp text-[11px] font-bold uppercase tracking-[0.18em] text-[#9fb0c4]">{title}</h3>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatBar({ label, value, color, suffix = '' }: { label: string; value: number; color?: string; suffix?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const col = color ?? (v >= 82 ? '#4ade80' : v >= 65 ? '#d8f224' : v >= 50 ? '#ffc94d' : '#ff6b4b');
  return (
    <div className="mb-2">
      <div className="flex justify-between text-[12px] mb-0.5">
        <span className="text-[#9fb0c4]">{label}</span>
        <span className="num font-bold" style={{ color: col }}>{value.toFixed(1)}{suffix}</span>
      </div>
      <div className="h-[7px] bg-[#0d1117] border border-[#232b37] overflow-hidden">
        <div className="h-full transition-all duration-700" style={{ width: `${v}%`, background: `linear-gradient(90deg, ${col}88, ${col})` }} />
      </div>
    </div>
  );
}

export function TeamDot({ color, color2, size = 12 }: { color: string; color2: string; size?: number }) {
  return (
    <span className="inline-block shrink-0" style={{
      width: size, height: size,
      background: `linear-gradient(135deg, ${color} 55%, ${color2})`,
      clipPath: 'polygon(20% 0, 100% 0, 80% 100%, 0 100%)',
    }} />
  );
}

export function PosBadge({ pos, big }: { pos: number; big?: boolean }) {
  const col = pos === 1 ? '#ffd75c' : pos === 2 ? '#cfd8e3' : pos === 3 ? '#d9a05c' : pos <= 10 ? '#3b4a5e' : '#232b37';
  return (
    <span className={`font-disp inline-flex items-center justify-center font-bold ${big ? 'w-9 h-9 text-sm' : 'w-6 h-6 text-[11px]'}`}
      style={{ background: col, color: pos <= 3 ? '#10131a' : '#c8d4e2', clipPath: 'polygon(18% 0, 100% 0, 82% 100%, 0 100%)' }}>
      {pos}
    </span>
  );
}

export function WeatherTag({ w }: { w: WeatherKind }) {
  const map = { dry: { t: 'Сухо', c: '#ffc94d' }, clouds: { t: 'Облачно', c: '#9fb0c4' }, wet: { t: 'Дождь', c: '#5c9eff' } } as const;
  const m = map[w];
  return <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: m.c }}>{m.t}</span>;
}

/** ISO 3166-1 alpha-3 → alpha-2, чтобы собрать флаг из региональных индикаторов */
const ISO3: Record<string, string> = {
  AUS: 'AU', AUT: 'AT', ARG: 'AR', BEL: 'BE', BRA: 'BR', BUL: 'BG', CAN: 'CA', CHN: 'CN',
  COL: 'CO', CZE: 'CZ', DEN: 'DK', EST: 'EE', FIN: 'FI', FRA: 'FR', GBR: 'GB', GER: 'DE',
  HUN: 'HU', IND: 'IN', IRL: 'IE', ITA: 'IT', JPN: 'JP', KOR: 'KR', LAT: 'LV', MEX: 'MX',
  MON: 'MC', NED: 'NL', NOR: 'NO', NZL: 'NZ', PAR: 'PY', POL: 'PL', POR: 'PT', RSA: 'ZA',
  SIN: 'SG', ESP: 'ES', SWE: 'SE', SUI: 'CH', THA: 'TH', USA: 'US', BAR: 'BB', CHL: 'CL',
  CRC: 'CR', ECU: 'EC', ISR: 'IL', LUX: 'LU', MYS: 'MY', KSA: 'SA', QAT: 'QA', UAE: 'AE',
  GRE: 'GR', ROU: 'RO', SVK: 'SK', SLO: 'SI', UKR: 'UA', CRO: 'HR', SRB: 'RS', LTU: 'LT',
  KAZ: 'KZ', GEO: 'GE', ARM: 'AM', AZE: 'AZ', TUR: 'TR', INA: 'ID', MAR: 'MA', RUS: 'RU',
  VEN: 'VE', ZWE: 'ZW', URU: 'UY', ISL: 'IS',
};

export function natFlag(nat: string): string {
  const iso2 = ISO3[nat] ?? nat;
  if (iso2.length !== 2) return '';
  return String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}

export function FlagTag({ nat }: { nat: string }) {
  const flag = natFlag(nat);
  if (!flag) return <span className="font-disp text-[9px] font-bold tracking-wider text-[#8b99ac] border border-[#2a3442] px-1 py-px bg-[#11161d]">{nat}</span>;
  return <span title={nat} className="text-[11px] leading-none">{flag}</span>;
}

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const p: Record<string, ReactNode> = {
    cal: <><rect x="3" y="5" width="18" height="16" rx="1" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
    trophy: <><path d="M8 4h8v6a4 4 0 0 1-8 0V4z" /><path d="M8 5H4.5A.5.5 0 0 0 4 5.5C4 8.5 5.8 10.4 8 11M16 5h3.5a.5.5 0 0 1 .5.5c0 3-1.8 4.9-4 5.4M12 14v3M8.5 20h7M10 17h4v3h-4z" /></>,
    garage: <><path d="M3 20V9l9-5 9 5v11" /><path d="M7 20v-7h10v7M7 16.5h10" /></>,
    users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c.5-3.5 2.7-5.5 5.5-5.5s5 2 5.5 5.5M15.5 8.6a3.2 3.2 0 1 0 .1-6.2M16.5 14.7c2.3.4 3.7 2.2 4 5.3" /></>,
    swap: <><path d="M7 8h11l-3-3M17 16H6l3 3" /></>,
    save: <><path d="M5 4h11l3 3v13H5V4z" /><path d="M8 4v5h7V4M8 14h8v6H8z" /></>,
    flag: <><path d="M5 21V4" /><path d="M5 4h13l-2.5 4L18 12H5" /></>,
    engine: <><rect x="6" y="8" width="12" height="9" rx="1" /><path d="M9 8V5h6v3M4 12h2M18 11h2v4h-2M9 17v2M15 17v2M9 11.5h2M13 11.5h2" /></>,
    play: <path d="M7 5l12 7-12 7V5z" />,
    bolt: <path d="M13 2L5 13h5l-1 9 8-11h-5l1-9z" />,
    chev: <path d="M9 5l7 7-7 7" />,
    back: <path d="M15 5l-7 7 7 7" />,
    check: <path d="M4 12l5 5L20 7" />,
    warn: <><path d="M12 3L2 20h20L12 3z" /><path d="M12 10v4M12 17.5v.5" /></>,
    wheel: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.6" /><path d="M12 3v6.4M12 14.6V21M3.5 10l5.9 1.9M14.6 11.9l5.9-1.9M6.3 18.5l4.3-4.9M13.4 13.6l4.3 4.9" /></>,
    doc: <><path d="M6 3h9l3 3v15H6V3z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></>,
    radio: <><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {p[name]}
    </svg>
  );
}

export function ResultTable({ rows, game, showBest, showPts }: {
  rows: { pos: number; did: string; tid: string; display: string; best?: string | null; points: number; note?: string }[];
  game: { drivers: Record<string, { name: string; code: string; nat: string }>; teams: Record<string, { name: string; short: string; color: string; color2: string; id: string }> };
  showBest?: boolean; showPts?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-[#7f8da0]">
            <th className="py-1.5 pr-2 w-9">Поз</th>
            <th className="pr-2">Пилот</th>
            <th className="pr-2">Команда</th>
            {showBest && <th className="pr-2">Лучший</th>}
            <th className="pr-2 text-right">Результат</th>
            {showPts && <th className="pl-2 text-right">Очки</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = game.drivers[r.did];
            const t = game.teams[r.tid];
            if (!d || !t) return null;
            return (
              <tr key={r.pos + r.did} className="border-t border-[#1d242f] hover:bg-[#171d27] transition-colors">
                <td className="py-1.5 pr-2"><PosBadge pos={r.pos} /></td>
                <td className="pr-2">
                  <div className="flex items-center gap-2 font-semibold whitespace-nowrap">
                    <FlagTag nat={d.nat} />{d.name}
                    {r.note && <span className="text-[10px] text-[#ffc94d] max-w-[220px] truncate" title={r.note}>· {r.note}</span>}
                  </div>
                </td>
                <td className="pr-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5 text-[#9fb0c4]"><TeamDot color={t.color} color2={t.color2} size={9} />{t.short}</span>
                </td>
                {showBest && <td className="pr-2 num text-[#9fb0c4]">{r.best ?? '—'}</td>}
                <td className="pr-2 num text-right font-semibold">{r.display}</td>
                {showPts && <td className="pl-2 num text-right font-disp text-[12px] text-[#d8f224]">{r.points > 0 ? r.points : ''}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
