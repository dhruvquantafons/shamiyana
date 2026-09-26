"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/*
 * Dashboard charts, drawn with recharts.
 *
 * Colours are hex rather than `var(--color-*)` because recharts writes them
 * as SVG presentation attributes, which do not resolve CSS variables. Each
 * one is a step of the `.admin-theme` palette in globals.css and is named
 * after it here, so a palette change is a find-and-replace. Line and slice
 * colours were checked with the dataviz palette validator.
 */
const MUTED = "#6f7371"; // slate-500
const HAIRLINE = "#eceeed"; // slate-200

/** Occupancy — emerald-600, the reference's green deepened to 3.9:1 on white. */
export const OCCUPANCY_COLOR = "#3f8f45";
/** Revenue — amber-600, the reference's amber. */
export const REVENUE_COLOR = "#c98f1b";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const inrCompact = (n: number) =>
  `₹${new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
const dayLabel = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

type Point = { day: string; occupancy: number | null; revenue: number };

function TooltipBox({ day, rows }: { day: string; rows: { label: string; value: string; color: string }[] }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 shadow-lg px-3 py-2 text-xs min-w-36">
      <p className="text-slate-500 mb-1">{dayLabel(day)}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-slate-600">
          <span className="w-2 h-2 rounded-full" style={{ background: r.color }} />
          {r.label}
          <span className="ml-auto pl-3 font-semibold text-slate-900 tabular-nums">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** One small-multiple panel: a single measure over the shared day axis. */
function Panel({
  data,
  dataKey,
  color,
  id,
  height,
  showAxis,
  tickFormatter,
  domain,
  ticks,
}: {
  data: Point[];
  dataKey: "occupancy" | "revenue";
  color: string;
  id: string;
  height: number;
  showAxis: boolean;
  tickFormatter: (n: number) => string;
  domain?: [number, number];
  ticks?: number[];
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} syncId="occ-rev" margin={{ top: 6, right: 8, bottom: showAxis ? 0 : 8, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.14} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={HAIRLINE} strokeDasharray="4 4" />
          <XAxis
            dataKey="day"
            hide={!showAxis}
            tickFormatter={dayLabel}
            tick={{ fill: MUTED, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            tickMargin={8}
          />
          <YAxis
            tickFormatter={tickFormatter}
            tick={{ fill: MUTED, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickCount={3}
            domain={domain}
            ticks={ticks}
            interval={0}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: "#9ea2a0", strokeWidth: 1, strokeDasharray: "4 4" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Point;
              return (
                <TooltipBox
                  day={p.day}
                  rows={[
                    { label: "Occupancy", value: p.occupancy === null ? "—" : `${p.occupancy}%`, color: OCCUPANCY_COLOR },
                    { label: "Revenue", value: inr(p.revenue), color: REVENUE_COLOR },
                  ]}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${id})`}
            connectNulls
            activeDot={{ r: 4.5, fill: color, stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Occupancy and revenue by day as two small multiples on one day axis,
 * rather than one chart with two y-scales: each panel keeps an honest scale
 * of its own, and a shared crosshair and tooltip tie a day together across
 * both. The panel labels carry identity alongside colour.
 */
export function OccupancyRevenueChart({ data }: { data: Point[] }) {
  return (
    <>
      <div aria-hidden="true">
        <p className="text-[11px] font-medium text-slate-500 mb-1">Occupancy</p>
        <Panel
          data={data}
          dataKey="occupancy"
          color={OCCUPANCY_COLOR}
          id="occ-fill"
          height={120}
          showAxis={false}
          tickFormatter={(n) => `${n}%`}
          domain={[0, 100]}
          ticks={[0, 50, 100]}
        />
        <p className="text-[11px] font-medium text-slate-500 mt-3 mb-1">Revenue</p>
        <Panel
          data={data}
          dataKey="revenue"
          color={REVENUE_COLOR}
          id="rev-fill"
          height={140}
          showAxis
          tickFormatter={inrCompact}
        />
      </div>
      <table className="sr-only">
        <caption>Occupancy and revenue by day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Occupancy</th>
            <th scope="col">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{dayLabel(d.day)}</th>
              <td>{d.occupancy === null ? "—" : `${d.occupancy}%`}</td>
              <td>{inr(d.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * Room board states as a donut, with the total in the hole and a legend
 * carrying every count, so no state is identified by colour alone.
 */
export function RoomStatusDonut({ data }: { data: { label: string; count: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const slices = data.filter((d) => d.count > 0);
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative w-44 h-44 shrink-0" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="count"
              nameKey="label"
              innerRadius="72%"
              outerRadius="100%"
              paddingAngle={slices.length > 1 ? 2 : 0}
              cornerRadius={6}
              stroke="#fff"
              strokeWidth={2}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
            >
              {slices.map((d) => (
                <Cell key={d.label} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="rounded-lg bg-white border border-slate-200 shadow-lg px-3 py-2 text-xs">
                    <p className="text-slate-500">{String(payload[0].name)}</p>
                    <p className="font-semibold text-slate-900 mt-0.5 tabular-nums">{String(payload[0].value)}</p>
                  </div>
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[11px] text-slate-500">Total rooms</span>
          <span className="admin-display text-[1.75rem] leading-none text-slate-900 mt-1">{total}</span>
        </div>
      </div>
      <ul className="w-full grid grid-cols-2 gap-x-5 gap-y-2.5">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2 text-[13px] min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="text-slate-500 truncate">{d.label}</span>
            <span className="ml-auto font-semibold text-slate-900 tabular-nums">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
