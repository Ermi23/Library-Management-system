/**
 * Small SVG charts. Colors follow the validated categorical palette (slot 1 blue, slot 2 orange);
 * single-series bars use the blue sequential hue. Every chart has hover tooltips and a legend
 * when it shows more than one series.
 */
import { useState } from 'react';

const SERIES = ['#2a78d6', '#eb6834'];

interface TrendPoint {
  label: string;
  values: number[];
}

/** Grouped vertical bars over time (e.g. checkouts vs returns per day). */
export function GroupedBarChart({ data, series, height = 200 }: { data: TrendPoint[]; series: string[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const niceMax = niceCeil(max);
  const ticks = niceMax % 2 === 0 ? [0, niceMax / 2, niceMax] : [0, niceMax];
  const padL = 28;
  const padB = 22;
  const w = 600;
  const plotW = w - padL;
  const plotH = height - padB - 8;
  const group = plotW / Math.max(1, data.length);
  const gap = 2;
  const barW = Math.max(2, Math.min(18, (group * 0.7 - gap * (series.length - 1)) / series.length));
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600">
        {series.map((s, i) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: SERIES[i] }} />
            {s}
          </span>
        ))}
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${w} ${height}`} className="h-auto w-full" role="img" aria-label={`${series.join(' and ')} chart`}>
          {ticks.map((t) => {
            const y = 8 + plotH - (t / niceMax) * plotH;
            return (
              <g key={t}>
                <line x1={padL} x2={w} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
                <text x={padL - 6} y={y + 3} textAnchor="end" className="fill-slate-400" fontSize={10}>
                  {t}
                </text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const x0 = padL + i * group + (group - (barW * series.length + gap * (series.length - 1))) / 2;
            return (
              <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {/* Hit target covers the whole column, not just the thin bars. */}
                <rect x={padL + i * group} y={8} width={group} height={plotH} fill={hover === i ? '#f1f5f9' : 'transparent'} />
                {d.values.map((v, s) => {
                  const h = (v / niceMax) * plotH;
                  return <BarUp key={s} x={x0 + s * (barW + gap)} y={8 + plotH - h} w={barW} h={h} fill={SERIES[s]} />;
                })}
                {i % labelEvery === 0 && (
                  <text x={padL + i * group + group / 2} y={height - 6} textAnchor="middle" className="fill-slate-400" fontSize={10}>
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `${((padL + hover * group + group / 2) / w) * 100}%` }}
          >
            <div className="font-medium text-slate-900">{data[hover].label}</div>
            {series.map((s, i) => (
              <div key={s} className="flex items-center gap-1.5 text-slate-600">
                <span className="size-2 rounded-sm" style={{ background: SERIES[i] }} />
                {s}: <span className="font-medium tabular-nums text-slate-900">{data[hover].values[i]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Bar with 4px rounded top, square at the baseline. */
function BarUp({ x, y, w, h, fill }: { x: number; y: number; w: number; h: number; fill: string }) {
  if (h <= 0) return null;
  const r = Math.min(4, w / 2, h);
  return <path d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`} fill={fill} />;
}

/** Horizontal bars for a ranked or categorical breakdown (single series, direct value labels). */
export function HBarChart({ data, format = (v) => v.toLocaleString() }: { data: { label: string; value: number; hint?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="group" title={`${d.label}: ${format(d.value)}${d.hint ? ` (${d.hint})` : ''}`}>
          <div className="mb-0.5 flex justify-between gap-3 text-xs">
            <span className="truncate text-slate-700">{d.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-slate-900">{format(d.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-[#2a78d6] transition-all group-hover:bg-[#256abf]" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function niceCeil(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
