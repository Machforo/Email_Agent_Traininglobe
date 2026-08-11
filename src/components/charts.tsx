'use client';

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Table, Td, Th } from './ui';

/**
 * Chart palette.
 *
 * Slots 1-3 of the reference categorical palette, validated with the skill's
 * validator against both surfaces (#ffffff light, #131720 dark): lightness band,
 * chroma floor, CVD separation (worst adjacent ΔE 9.2 light / 9.4 dark) and the
 * normal-vision floor all pass. Aqua sits at 2.82:1 on the light surface, below the
 * 3:1 line, so every chart here ships a legend *and* a table view — the relief rule.
 *
 * Colours are assigned to a fixed series identity and never cycled by rank, so
 * filtering never repaints the surviving series.
 */
const SERIES = {
  sent: { light: '#2a78d6', dark: '#3987e5', label: 'Sent' },
  opens: { light: '#eb6834', dark: '#d95926', label: 'Opens' },
  replies: { light: '#1baf7a', dark: '#199e70', label: 'Replies' },
} as const;

function useSeriesColors() {
  const [dark, setDark] = useState(false);
  if (typeof window !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    const isDark =
      attr === 'dark' ||
      (attr !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark !== dark) setDark(isDark);
  }
  const key = dark ? 'dark' : 'light';
  return {
    sent: SERIES.sent[key],
    opens: SERIES.opens[key],
    replies: SERIES.replies[key],
    grid: dark ? '#242b38' : '#e4e7ec',
    text: dark ? '#98a2b3' : '#667085',
    surface: dark ? '#131720' : '#ffffff',
  };
}

const axisStyle = { fontSize: 11 };

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-[var(--surface)] px-3 py-2 shadow-[var(--shadow-lg)]">
      <p className="mb-1 text-[12px] font-medium text-[var(--text)]">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: p.color }}
            aria-hidden
          />
          {p.name}: <span className="font-medium text-[var(--text)]">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

/* ------------------------------- Activity ------------------------------- */

export function ActivityChart({
  data,
}: {
  data: { date: string; sent: number; replies: number; opens: number }[];
}) {
  const c = useSeriesColors();
  const [showTable, setShowTable] = useState(false);

  const shaped = data.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  }));

  return (
    <div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={shaped} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              stroke={c.text}
              tick={axisStyle}
              tickLine={false}
              axisLine={{ stroke: c.grid }}
              minTickGap={26}
            />
            <YAxis
              stroke={c.text}
              tick={axisStyle}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<TooltipBox />} cursor={{ stroke: c.grid, strokeWidth: 1 }} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: c.text, paddingTop: 8 }}
            />
            {/* 2px strokes, 8px active markers, ringed against the surface. */}
            <Line
              type="monotone"
              dataKey="sent"
              name="Sent"
              stroke={c.sent}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }}
            />
            <Line
              type="monotone"
              dataKey="opens"
              name="Opens"
              stroke={c.opens}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }}
            />
            <Line
              type="monotone"
              dataKey="replies"
              name="Replies"
              stroke={c.replies}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <button
        onClick={() => setShowTable((s) => !s)}
        className="mt-2 text-[12px] font-medium text-[var(--brand)] hover:underline"
      >
        {showTable ? 'Hide data table' : 'View as table'}
      </button>

      {showTable && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border">
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Sent</Th>
                <Th>Opens</Th>
                <Th>Replies</Th>
              </tr>
            </thead>
            <tbody>
              {shaped
                .filter((d) => d.sent || d.opens || d.replies)
                .map((d) => (
                  <tr key={d.date}>
                    <Td>{d.label}</Td>
                    <Td>{d.sent}</Td>
                    <Td>{d.opens}</Td>
                    <Td>{d.replies}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Stage chart ------------------------------ */

export function StageChart({
  data,
}: {
  data: { stage: string; sent: number; replied: number; replyRate: number }[];
}) {
  const c = useSeriesColors();
  const [showTable, setShowTable] = useState(false);

  return (
    <div>
      <div style={{ width: '100%', height: 230 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="stage"
              stroke={c.text}
              tick={axisStyle}
              tickLine={false}
              axisLine={{ stroke: c.grid }}
            />
            <YAxis
              stroke={c.text}
              tick={axisStyle}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<TooltipBox />} cursor={{ fill: c.grid, opacity: 0.3 }} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: c.text, paddingTop: 8 }}
            />
            {/* 4px rounded data-ends anchored to the baseline; 2px gap between bars. */}
            <Bar dataKey="sent" name="Sent" fill={c.sent} radius={[4, 4, 0, 0]} maxBarSize={38} />
            <Bar
              dataKey="replied"
              name="Replied"
              fill={c.replies}
              radius={[4, 4, 0, 0]}
              maxBarSize={38}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <button
        onClick={() => setShowTable((s) => !s)}
        className="mt-2 text-[12px] font-medium text-[var(--brand)] hover:underline"
      >
        {showTable ? 'Hide data table' : 'View as table'}
      </button>

      {showTable && (
        <div className="mt-2 rounded-lg border">
          <Table>
            <thead>
              <tr>
                <Th>Stage</Th>
                <Th>Sent</Th>
                <Th>Replied</Th>
                <Th>Reply rate</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.stage}>
                  <Td>{d.stage}</Td>
                  <Td>{d.sent}</Td>
                  <Td>{d.replied}</Td>
                  <Td>{d.replyRate}%</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * Funnel as a set of proportional bars. Deliberately not a pie: comparing
 * magnitudes along a common baseline is easier than comparing angles.
 */
export function FunnelBars({
  steps,
}: {
  steps: { label: string; value: number; tone: string }[];
}) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="space-y-3">
      {steps.map((s) => (
        <div key={s.label}>
          <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
            <span className="text-[var(--text-muted)]">{s.label}</span>
            <span className="font-semibold">{s.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(s.value / max) * 100}%`, background: s.tone }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function useChartColors() {
  return useSeriesColors();
}
