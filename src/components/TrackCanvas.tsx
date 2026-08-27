import { useEffect, useRef } from 'react';
import type { RaceSim, SessionSim } from '../game/engine';
import type { TrackGeo } from '../game/types';

function posAt(track: TrackGeo, dist: number): { x: number; y: number; a: number } {
  const total = track.total;
  const d = ((dist % total) + total) % total;
  let lo = 0, hi = track.cum.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (track.cum[mid] <= d) lo = mid; else hi = mid - 1; }
  const i = lo % track.pts.length;
  const j = (i + 1) % track.pts.length;
  const span = track.cum[lo + 1] - track.cum[lo] || 1;
  const k = (d - track.cum[lo]) / span;
  const p = track.pts[i], q = track.pts[j];
  return {
    x: p[0] + (q[0] - p[0]) * k,
    y: p[1] + (q[1] - p[1]) * k,
    a: Math.atan2(q[1] - p[1], q[0] - p[0]),
  };
}

export default function TrackCanvas({ sim, track, seriesColor, phase, raining }: {
  sim: RaceSim | SessionSim | null;
  track: TrackGeo;
  seriesColor: string;
  phase?: string;
  raining?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const simRef = useRef(sim);
  simRef.current = sim;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const rainRef = useRef(raining);
  rainRef.current = raining;

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
      const now = performance.now();
      const pulse = 0.5 + 0.5 * Math.sin(now / 300);

      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0c1016');
      bg.addColorStop(1, '#080a0e');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.025)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 36) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 36) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      const sc = Math.min(W / 1080, H / 700);
      const ox = (W - 1000 * sc) / 2, oy = (H - 620 * sc) / 2;
      const tf = (x: number) => ox + x * sc;
      const tfy = (y: number) => oy + y * sc;
      const N = track.pts.length;

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1a212c';
      ctx.lineWidth = 34 * sc * 2.2;
      ctx.beginPath();
      track.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(tf(x), tfy(y)) : ctx.lineTo(tf(x), tfy(y))));
      ctx.closePath();
      ctx.stroke();

      for (let i = 0; i < N; i++) {
        if (!track.slowSegs[i]) continue;
        const p = track.pts[i], q = track.pts[(i + 1) % N];
        ctx.strokeStyle = i % 8 < 4 ? '#e0453a' : '#e8e8e8';
        ctx.lineWidth = 5 * sc;
        ctx.beginPath();
        ctx.moveTo(tf(p[0]), tfy(p[1]));
        ctx.lineTo(tf(q[0]), tfy(q[1]));
        ctx.stroke();
      }

      ctx.strokeStyle = '#313b4a';
      ctx.lineWidth = 26 * sc;
      ctx.beginPath();
      track.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(tf(x), tfy(y)) : ctx.lineTo(tf(x), tfy(y))));
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = '#3d4959';
      ctx.lineWidth = 20 * sc;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(84,227,140,0.5)';
      ctx.lineWidth = 3 * sc;
      for (let i = 0; i < N; i++) {
        if (!track.drsSegs[i]) continue;
        const p = track.pts[i], q = track.pts[(i + 1) % N];
        ctx.beginPath();
        ctx.moveTo(tf(p[0]), tfy(p[1]));
        ctx.lineTo(tf(q[0]), tfy(q[1]));
        ctx.stroke();
      }

      const sp = track.pts[0], sq = track.pts[1];
      const ang = Math.atan2(sq[1] - sp[1], sq[0] - sp[0]) + Math.PI / 2;
      const nx = Math.cos(ang), ny = Math.sin(ang);
      for (let k = -4; k <= 4; k++) {
        ctx.fillStyle = k % 2 === 0 ? '#e8e8e8' : '#151a22';
        ctx.fillRect(tf(sp[0] + nx * k * 3) - 2.5 * sc, tfy(sp[1] + ny * k * 3) - 2.5 * sc, 5 * sc, 5 * sc);
      }

      if (rainRef.current) {
        ctx.strokeStyle = 'rgba(120,170,255,0.28)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 90; i++) {
          const x = ((i * 137 + now * 0.4) % W);
          const y = ((i * 251 + now * 0.9) % H);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 5, y + 12);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(20,40,80,0.18)';
        ctx.fillRect(0, 0, W, H);
      }

      if (s) {
        const cars = [...s.cars].sort((a, b) => (a.status === 'run' ? 1 : 0) - (b.status === 'run' ? 1 : 0) || a.pos - b.pos);
        for (const car of cars) {
          if (car.status === 'out') continue;
          // сессионные машины: рисуем только те, что на трассе (остальные в боксах)
          if ('state' in car && car.state !== 'flying') continue;
          const { x, y, a } = posAt(track, car.dist);
          const X = tf(x), Y = tfy(y);
          const leader = car.pos === 1 && car.status === 'run';
          if (car.status === 'run') {
            const back = posAt(track, car.dist - 26);
            ctx.strokeStyle = car.color + '55';
            ctx.lineWidth = 3 * sc;
            ctx.beginPath();
            ctx.moveTo(tf(back.x), tfy(back.y));
            ctx.lineTo(X, Y);
            ctx.stroke();
          }
          ctx.save();
          ctx.translate(X, Y);
          ctx.rotate(a);
          const L = (car.isPlayer ? 12 : 10) * sc;
          if (leader) { ctx.shadowColor = seriesColor; ctx.shadowBlur = 14 + pulse * 6; }
          else if (car.isPlayer) { ctx.shadowColor = '#d8f224'; ctx.shadowBlur = 10; }
          ctx.fillStyle = car.status === 'fin' ? '#5a6a7e' : car.color;
          ctx.beginPath();
          ctx.moveTo(L, 0);
          ctx.lineTo(-L * 0.7, L * 0.55);
          ctx.lineTo(-L * 0.4, 0);
          ctx.lineTo(-L * 0.7, -L * 0.55);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          if (leader || car.isPlayer) {
            ctx.font = `700 ${Math.max(9, 10 * sc)}px Orbitron, sans-serif`;
            ctx.fillStyle = leader ? '#ffd75c' : '#d8f224';
            ctx.fillText(car.code, X + 10 * sc, Y - 8 * sc);
          }
          if (car.pitting) {
            ctx.font = `700 ${Math.max(8, 9 * sc)}px Orbitron, sans-serif`;
            ctx.fillStyle = '#ffc94d';
            ctx.fillText('PIT', X + 10 * sc, Y + 14 * sc);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [track, seriesColor]);

  const ph = phaseRef.current;
  return (
    <div className="relative w-full h-full">
      <canvas ref={ref} className="w-full h-full block" />
      {ph && ph !== 'green' && ph !== 'cheq' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className={`font-disp font-bold text-[13px] tracking-[0.2em] px-5 py-2 clip-sm blink ${
            ph === 'red' ? 'bg-[#c8102e] text-white' :
            ph === 'sc' ? 'bg-[#ffc94d] text-[#1a1408]' : 'bg-[#2f8f4e] text-white'
          }`}>
            {ph === 'red' ? 'КРАСНЫЙ ФЛАГ' : ph === 'sc' ? 'МАШИНА БЕЗОПАСНОСТИ' : 'ВИРТУАЛЬНЫЙ SC'}
          </div>
        </div>
      )}
      {rainRef.current && (
        <div className="absolute top-3 right-3 font-disp text-[11px] font-bold text-[#5c9eff] tracking-widest bg-[#0c1420cc] border border-[#2a4a7a] px-3 py-1.5 clip-sm">
          ДОЖДЬ
        </div>
      )}
    </div>
  );
}
