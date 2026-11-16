import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  DailyCumulativePoint,
  MonthlySalesMetric,
  SalesGroupKey,
  SalesMomComparison as SalesMomComparisonData,
} from '../../types/pos';
import { rp } from '../../utils/format';

interface SalesMomComparisonProps {
  data: SalesMomComparisonData | null;
  loading: boolean;
  bulan: string;
  monthsWindow: 6 | 12;
  onBulanChange: (nextBulan: string) => void;
  onMonthsWindowChange: (nextMonths: 6 | 12) => void;
}

const GROUP_DOT_COLOR: Record<SalesGroupKey, string> = {
  LCD: '#dc2626',
  Sparepart: '#0284c7',
  Aksesoris: '#d97706',
  'Jasa Service': '#059669',
  Lainnya: '#71717a',
};

function formatCompactRp(value: number): string {
  if (!value) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    const m = abs / 1_000_000_000;
    return `${sign}${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1).replace('.', ',')}M`;
  }
  if (abs >= 1_000_000) {
    const jt = abs / 1_000_000;
    return `${sign}${jt % 1 === 0 ? jt.toFixed(0) : jt.toFixed(1).replace('.', ',')}jt`;
  }
  if (abs >= 1_000) {
    return `${sign}${Math.round(abs / 1_000)}rb`;
  }
  return `${sign}${abs}`;
}

function formatSignedRp(delta: number): string {
  if (delta === 0) return rp(0);
  const sign = delta > 0 ? '+' : '-';
  return `${sign}${rp(Math.abs(delta))}`;
}

function formatGrowthLabel(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '-';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1).replace('.', ',')}%`;
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct === null || !Number.isFinite(pct)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold font-data text-zinc-400">
        <Minus className="w-3.5 h-3.5" /> -
      </span>
    );
  }
  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold font-data text-emerald-600 dark:text-emerald-400">
        <TrendingUp className="w-3.5 h-3.5 shrink-0" />
        {formatGrowthLabel(pct)}
      </span>
    );
  }
  if (pct < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold font-data text-rose-600 dark:text-rose-400">
        <TrendingDown className="w-3.5 h-3.5 shrink-0" />
        {formatGrowthLabel(pct)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold font-data text-zinc-500 dark:text-zinc-400">
      <Minus className="w-3.5 h-3.5 shrink-0" />
      0,0%
    </span>
  );
}

interface MonthlyTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: MonthlySalesMetric;
  }>;
}

function MonthlyComparisonTooltip({ active, payload }: MonthlyTooltipProps) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const m = payload[0].payload;
  const pct = m.growthPct;
  const isUp = pct !== null && pct > 0;
  const isDown = pct !== null && pct < 0;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2.5 shadow-lg text-xs min-w-[210px]">
      <div className="flex items-center justify-between gap-3 pb-1.5 mb-1.5 border-b border-zinc-100 dark:border-zinc-800">
        <span className="font-bold text-zinc-900 dark:text-white">{m.fullLabel}</span>
        {pct !== null && (
          <span
            className={`font-data font-bold ${
              isUp
                ? 'text-emerald-600 dark:text-emerald-400'
                : isDown
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {formatGrowthLabel(pct)} MoM
          </span>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-500 dark:text-zinc-400">Omset</span>
          <span className="font-data font-extrabold text-zinc-900 dark:text-white">
            {rp(m.omset)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-500 dark:text-zinc-400">Bulan sblm</span>
          <span className="font-data text-zinc-700 dark:text-zinc-300">{rp(m.prevOmset)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-500 dark:text-zinc-400">Selisih</span>
          <span
            className={`font-data font-semibold ${
              m.omsetDelta > 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : m.omsetDelta < 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {formatSignedRp(m.omsetDelta)}
          </span>
        </div>
        <div className="pt-1 mt-1 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-3 text-[11px] text-zinc-500 dark:text-zinc-400 font-data">
          <span>{m.notaCount} nota</span>
          <span>{m.qtyCount} item</span>
        </div>
      </div>
    </div>
  );
}

interface CumulativeTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: DailyCumulativePoint;
  }>;
  selectedLabel: string;
  previousLabel: string;
}

function CumulativeTooltip({
  active,
  payload,
  selectedLabel,
  previousLabel,
}: CumulativeTooltipProps) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const pt = payload[0].payload;
  const hasBoth = pt.currentCum !== null && pt.prevCum !== null;
  const diff = hasBoth ? (pt.currentCum || 0) - (pt.prevCum || 0) : null;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2.5 shadow-lg text-xs min-w-[200px]">
      <div className="font-bold text-zinc-900 dark:text-white pb-1.5 mb-1.5 border-b border-zinc-100 dark:border-zinc-800">
        Akumulasi s/d Tanggal {pt.day}
      </div>
      <div className="space-y-1">
        {pt.currentCum !== null && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
              <span className="w-2 h-2 rounded-full bg-red-600 shrink-0" />
              {selectedLabel}
            </span>
            <span className="font-data font-bold text-zinc-900 dark:text-white">
              {rp(pt.currentCum)}
            </span>
          </div>
        )}
        {pt.prevCum !== null && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
              <span className="w-2 h-2 rounded-full bg-slate-500 shrink-0" />
              {previousLabel}
            </span>
            <span className="font-data font-semibold text-zinc-700 dark:text-zinc-300">
              {rp(pt.prevCum)}
            </span>
          </div>
        )}
        {diff !== null && (
          <div className="pt-1 mt-1 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-3">
            <span className="text-zinc-500 dark:text-zinc-400">Selisih</span>
            <span
              className={`font-data font-bold ${
                diff > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : diff < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-zinc-500'
              }`}
            >
              {formatSignedRp(diff)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function SalesMomComparison({
  data,
  loading,
  bulan,
  monthsWindow,
  onBulanChange,
  onMonthsWindowChange,
}: SalesMomComparisonProps) {
  const [compareMode, setCompareMode] = useState<'full' | 'mtd'>('full');

  const effectiveMode =
    compareMode === 'mtd' && data?.isCurrentMonth && data.mtdSummary ? 'mtd' : 'full';

  const displayCurrOmset =
    effectiveMode === 'mtd' && data?.mtdSummary
      ? data.mtdSummary.currentOmset
      : data?.selected.omset || 0;
  const displayPrevOmset =
    effectiveMode === 'mtd' && data?.mtdSummary
      ? data.mtdSummary.previousMtdOmset
      : data?.previous.omset || 0;
  const displayOmsetDelta =
    effectiveMode === 'mtd' && data?.mtdSummary
      ? data.mtdSummary.delta
      : data?.selected.omsetDelta || 0;
  const displayOmsetPct =
    effectiveMode === 'mtd' && data?.mtdSummary
      ? data.mtdSummary.growthPct
      : data?.selected.growthPct ?? null;

  const displayCurrNota =
    effectiveMode === 'mtd' && data?.mtdSummary
      ? data.mtdSummary.currentNota
      : data?.selected.notaCount || 0;
  const displayPrevNota =
    effectiveMode === 'mtd' && data?.mtdSummary
      ? data.mtdSummary.previousMtdNota
      : data?.previous.notaCount || 0;
  const displayNotaDelta = displayCurrNota - displayPrevNota;
  const displayNotaPct =
    displayPrevNota <= 0
      ? displayCurrNota > 0
        ? 100
        : 0
      : Math.round(((displayCurrNota - displayPrevNota) / displayPrevNota) * 1000) / 10;

  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm shadow-zinc-900/[0.03] p-4 sm:p-5 space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-white">
            Perbandingan Penjualan Bulanan (Month-over-Month)
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {data ? (
              effectiveMode === 'mtd' && data.mtdDay ? (
                <>
                  Pertumbuhan omset tanggal 1–{data.mtdDay}{' '}
                  <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                    {data.selectedLabel}
                  </span>{' '}
                  dibanding periode sama{' '}
                  <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                    {data.previousLabel}
                  </span>
                </>
              ) : (
                <>
                  Evaluasi pertumbuhan omset{' '}
                  <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                    {data.selectedLabel}
                  </span>{' '}
                  dibanding{' '}
                  <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                    {data.previousLabel}
                  </span>
                </>
              )
            ) : (
              'Memuat perbandingan omset antarbulan...'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data?.isCurrentMonth && data.mtdSummary && data.mtdDay && (
            <div className="inline-flex rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/70 p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setCompareMode('full')}
                className={`min-h-[34px] px-2.5 rounded-lg transition-colors ${
                  effectiveMode === 'full'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                1 Bulan
              </button>
              <button
                type="button"
                onClick={() => setCompareMode('mtd')}
                className={`min-h-[34px] px-2.5 rounded-lg transition-colors ${
                  effectiveMode === 'mtd'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                s/d Tgl {data.mtdDay}
              </button>
            </div>
          )}

          <div className="inline-flex rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/70 p-0.5 text-xs font-semibold">
            {([6, 12] as const).map((cnt) => (
              <button
                key={cnt}
                type="button"
                onClick={() => onMonthsWindowChange(cnt)}
                className={`min-h-[34px] px-2.5 rounded-lg transition-colors ${
                  monthsWindow === cnt
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {cnt} Bln
              </button>
            ))}
          </div>

          <input
            type="month"
            value={bulan}
            onChange={(e) => {
              if (e.target.value) onBulanChange(e.target.value);
            }}
            aria-label="Pilih bulan pembanding"
            className="min-h-[38px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
      </div>

      {loading && !data ? (
        <div className="py-12 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Menghitung perbandingan omset bulanan...
        </div>
      ) : data ? (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-60' : 'opacity-100'}`}>
          {/* 4 KPI MoM Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Omset */}
            <div className="rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Omset {effectiveMode === 'mtd' && data.mtdDay ? `(1–${data.mtdDay})` : data.selected.label}
                </span>
                <GrowthBadge pct={displayOmsetPct} />
              </div>
              <div className="text-base sm:text-lg font-extrabold font-data text-zinc-900 dark:text-white leading-tight">
                {rp(displayCurrOmset)}
              </div>
              <div className="text-[11px] font-data text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center justify-between gap-1">
                <span>vs {rp(displayPrevOmset)}</span>
                <span
                  className={`font-semibold ${
                    displayOmsetDelta > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : displayOmsetDelta < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : ''
                  }`}
                >
                  {formatSignedRp(displayOmsetDelta)}
                </span>
              </div>
            </div>

            {/* Nota Count */}
            <div className="rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Jumlah Nota
                </span>
                <GrowthBadge pct={displayNotaPct} />
              </div>
              <div className="text-base sm:text-lg font-extrabold font-data text-zinc-900 dark:text-white leading-tight">
                {displayCurrNota} nota
              </div>
              <div className="text-[11px] font-data text-zinc-500 dark:text-zinc-400 flex items-center justify-between gap-1">
                <span>vs {displayPrevNota} nota</span>
                <span
                  className={`font-semibold ${
                    displayNotaDelta > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : displayNotaDelta < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : ''
                  }`}
                >
                  {displayNotaDelta > 0 ? `+${displayNotaDelta}` : displayNotaDelta} nota
                </span>
              </div>
            </div>

            {/* Qty Terjual */}
            <div className="rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Item Terjual
                </span>
                <GrowthBadge pct={data.qtyGrowthPct} />
              </div>
              <div className="text-base sm:text-lg font-extrabold font-data text-zinc-900 dark:text-white leading-tight">
                {data.selected.qtyCount} item
              </div>
              <div className="text-[11px] font-data text-zinc-500 dark:text-zinc-400 flex items-center justify-between gap-1">
                <span>vs {data.previous.qtyCount} item</span>
                <span
                  className={`font-semibold ${
                    data.qtyDelta > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : data.qtyDelta < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : ''
                  }`}
                >
                  {data.qtyDelta > 0 ? `+${data.qtyDelta}` : data.qtyDelta} item
                </span>
              </div>
            </div>

            {/* Average Ticket */}
            <div className="rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Rata-rata Nota
                </span>
                <GrowthBadge pct={data.avgNotaGrowthPct} />
              </div>
              <div className="text-base sm:text-lg font-extrabold font-data text-zinc-900 dark:text-white leading-tight">
                {rp(data.selected.avgNota)}
              </div>
              <div className="text-[11px] font-data text-zinc-500 dark:text-zinc-400 flex items-center justify-between gap-1">
                <span>vs {rp(data.previous.avgNota)}</span>
                <span
                  className={`font-semibold ${
                    data.avgNotaDelta > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : data.avgNotaDelta < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : ''
                  }`}
                >
                  {formatSignedRp(data.avgNotaDelta)}
                </span>
              </div>
            </div>
          </div>

          {/* 2 Visualization Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Multi-month Omset & MoM Growth % Chart */}
            <div className="lg:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col justify-between">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-white">
                    Tren Omset & Pertumbuhan MoM ({monthsWindow} Bulan Terakhir)
                  </h4>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Batang menampilkan total omset bulanan, garis menunjukkan % pertumbuhan MoM.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-600 dark:text-zinc-300">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-red-600 shrink-0" />
                    {data.selected.label}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-zinc-600 shrink-0" />
                    {data.previous.label}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-emerald-500 shrink-0" />
                    % MoM
                  </span>
                </div>
              </div>

              <div className="mt-3 w-full h-[240px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <ComposedChart
                    data={data.series}
                    margin={{ top: 10, right: 4, left: -10, bottom: 0 }}
                    barCategoryGap="22%"
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="rgba(161, 161, 170, 0.25)"
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="omset"
                      tickFormatter={(v) => formatCompactRp(Number(v))}
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      axisLine={false}
                      tickLine={false}
                      width={54}
                    />
                    <YAxis
                      yAxisId="pct"
                      orientation="right"
                      tickFormatter={(v) => `${Number(v)}%`}
                      tick={{ fontSize: 10, fill: '#10b981' }}
                      axisLine={false}
                      tickLine={false}
                      width={42}
                    />
                    <ReferenceLine
                      yAxisId="pct"
                      y={0}
                      stroke="rgba(16, 185, 129, 0.35)"
                      strokeDasharray="3 3"
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(161, 161, 170, 0.10)' }}
                      content={<MonthlyComparisonTooltip />}
                    />
                    <Bar
                      yAxisId="omset"
                      dataKey="omset"
                      maxBarSize={42}
                      radius={[5, 5, 0, 0]}
                      className="cursor-pointer"
                      onClick={(entry) => {
                        const raw = entry as unknown as {
                          ym?: string;
                          payload?: MonthlySalesMetric;
                        };
                        const ym = raw?.payload?.ym || raw?.ym;
                        if (ym && ym !== bulan) onBulanChange(ym);
                      }}
                    >
                      {data.series.map((m) => {
                        const fill =
                          m.ym === data.selectedYm
                            ? '#dc2626'
                            : m.ym === data.previousYm
                              ? '#52525b'
                              : '#a1a1aa';
                        return <Cell key={m.ym} fill={fill} />;
                      })}
                    </Bar>
                    <Line
                      yAxisId="pct"
                      type="monotone"
                      dataKey="growthPct"
                      stroke="#10b981"
                      strokeWidth={2.2}
                      dot={{ r: 3.5, fill: '#10b981', strokeWidth: 1.5, stroke: '#ffffff' }}
                      activeDot={{ r: 5 }}
                      connectNulls={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Cumulative Daily Pace Comparison (Selected vs Previous Month) */}
            <div className="lg:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col justify-between">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-white">
                    Laju Akumulasi Omset Harian
                  </h4>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Kurva kumulatif tgl 1–31: {data.selected.label} vs {data.previous.label}.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-zinc-600 dark:text-zinc-300">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-red-600 shrink-0" />
                    {data.selected.label}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-0.5 border-t-2 border-dashed border-slate-500 shrink-0" />
                    {data.previous.label}
                  </span>
                </div>
              </div>

              <div className="mt-3 w-full h-[240px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <AreaChart
                    data={data.dailyCumulative}
                    margin={{ top: 10, right: 6, left: -12, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="momCurrentGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#dc2626" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#dc2626" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="rgba(161, 161, 170, 0.25)"
                    />
                    <XAxis
                      dataKey="label"
                      interval={4}
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) => formatCompactRp(Number(v))}
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      axisLine={false}
                      tickLine={false}
                      width={52}
                    />
                    <Tooltip
                      content={
                        <CumulativeTooltip
                          selectedLabel={data.selected.label}
                          previousLabel={data.previous.label}
                        />
                      }
                    />
                    {data.isCurrentMonth && data.mtdDay && (
                      <ReferenceLine
                        x={String(data.mtdDay)}
                        stroke="#dc2626"
                        strokeDasharray="3 3"
                        strokeOpacity={0.55}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="prevCum"
                      stroke="#64748b"
                      strokeWidth={1.8}
                      strokeDasharray="4 4"
                      fill="transparent"
                      connectNulls={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="currentCum"
                      stroke="#dc2626"
                      strokeWidth={2.4}
                      fill="url(#momCurrentGrad)"
                      connectNulls={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Group-by-Group MoM Breakdown */}
          {data.groupComparison.length > 0 && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-3.5 sm:p-4 space-y-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-white">
                  Pertumbuhan Omset per Kelompok ({data.selected.label} vs {data.previous.label})
                </h4>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Klik batang grafik untuk memilih bulan tertentu
                </span>
              </div>

              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">
                      <th className="py-2 pr-3 text-left font-semibold">Kelompok</th>
                      <th className="py-2 px-2 text-right font-semibold">{data.previous.label}</th>
                      <th className="py-2 px-2 text-right font-semibold">{data.selected.label}</th>
                      <th className="py-2 px-2 text-right font-semibold">Selisih</th>
                      <th className="py-2 pl-2 text-right font-semibold">Pertumbuhan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/80">
                    {data.groupComparison.map((g) => (
                      <tr key={g.group}>
                        <td className="py-2 pr-3 font-semibold text-zinc-900 dark:text-white">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: GROUP_DOT_COLOR[g.group] }}
                            />
                            {g.label}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-data text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                          {rp(g.previousOmset)}
                        </td>
                        <td className="py-2 px-2 text-right font-data font-bold text-zinc-900 dark:text-white whitespace-nowrap">
                          {rp(g.currentOmset)}
                        </td>
                        <td
                          className={`py-2 px-2 text-right font-data font-semibold whitespace-nowrap ${
                            g.delta > 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : g.delta < 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-zinc-500 dark:text-zinc-400'
                          }`}
                        >
                          {formatSignedRp(g.delta)}
                        </td>
                        <td className="py-2 pl-2 text-right whitespace-nowrap">
                          <GrowthBadge pct={g.growthPct} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Compact Breakdown */}
              <div className="sm:hidden divide-y divide-zinc-200/70 dark:divide-zinc-800">
                {data.groupComparison.map((g) => (
                  <div key={g.group} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-bold text-zinc-900 dark:text-white">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: GROUP_DOT_COLOR[g.group] }}
                        />
                        <span className="truncate">{g.label}</span>
                      </div>
                      <div className="text-[11px] font-data text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {rp(g.previousOmset)} → <strong className="text-zinc-800 dark:text-zinc-200">{rp(g.currentOmset)}</strong>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <GrowthBadge pct={g.growthPct} />
                      <div
                        className={`text-[11px] font-data font-semibold ${
                          g.delta > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : g.delta < 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-zinc-500'
                        }`}
                      >
                        {formatSignedRp(g.delta)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
