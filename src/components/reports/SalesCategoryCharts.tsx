import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SalesGroupKey, SalesGroupSummary, SalesTrendPoint } from '../../types/pos';
import { fmtDate, rp } from '../../utils/format';

interface SalesCategoryChartsProps {
  groups: SalesGroupSummary[];
  trend: SalesTrendPoint[];
  totalOmset: number;
}

const GROUP_COLOR: Record<SalesGroupKey, string> = {
  LCD: '#dc2626',
  Sparepart: '#0284c7',
  Aksesoris: '#d97706',
  'Jasa Service': '#059669',
  Lainnya: '#71717a',
};

const GROUP_SHORT: Record<SalesGroupKey, string> = {
  LCD: 'LCD',
  Sparepart: 'Sparepart',
  Aksesoris: 'Aksesoris',
  'Jasa Service': 'Jasa Service',
  Lainnya: 'Lainnya',
};

function formatCompactRp(value: number): string {
  if (!value) return '0';
  if (Math.abs(value) >= 1_000_000) {
    const jt = value / 1_000_000;
    return `${jt % 1 === 0 ? jt.toFixed(0) : jt.toFixed(1).replace('.', ',')}jt`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${Math.round(value / 1_000)}rb`;
  }
  return String(value);
}

function formatShortDay(tgl: string): string {
  const parts = tgl.split('-');
  if (parts.length !== 3) return tgl;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'Mei',
    'Jun',
    'Jul',
    'Agu',
    'Sep',
    'Okt',
    'Nov',
    'Des',
  ];
  const m = Number(parts[1]) - 1;
  return `${Number(parts[2])} ${months[m] || parts[1]}`;
}

interface PieTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: {
      group: SalesGroupKey;
      label: string;
      omset: number;
      qty: number;
      notaCount: number;
      pct: number;
      color: string;
    };
  }>;
}

function PieCustomTooltip({ active, payload }: PieTooltipProps) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 shadow-lg text-xs">
      <div className="flex items-center gap-2 font-bold text-zinc-900 dark:text-white">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: item.color }}
        />
        <span>{item.label}</span>
      </div>
      <div className="mt-1 font-data font-extrabold text-zinc-900 dark:text-white">
        {rp(item.omset)}{' '}
        <span className="font-semibold text-zinc-500 dark:text-zinc-400">({item.pct}%)</span>
      </div>
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-data">
        {item.qty} item · {item.notaCount} nota
      </div>
    </div>
  );
}

interface BarTooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey?: string;
    value?: number;
    color?: string;
    payload?: SalesTrendPoint & { label: string };
  }>;
}

function BarCustomTooltip({ active, payload }: BarTooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const nonZero = payload.filter((p) => Number(p.value || 0) > 0);
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2.5 shadow-lg text-xs min-w-[180px]">
      <div className="font-bold text-zinc-900 dark:text-white pb-1.5 mb-1.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-3">
        <span>{fmtDate(point.tgl)}</span>
        <span className="font-data text-red-600 dark:text-red-400">{rp(point.total)}</span>
      </div>
      {nonZero.length === 0 ? (
        <div className="text-zinc-500 dark:text-zinc-400">Tidak ada penjualan</div>
      ) : (
        <div className="space-y-1">
          {nonZero.map((entry) => {
            const val = Number(entry.value || 0);
            const pct = point.total > 0 ? Math.round((val / point.total) * 100) : 0;
            return (
              <div key={String(entry.dataKey)} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: entry.color }}
                  />
                  {entry.dataKey}
                </span>
                <span className="font-data font-semibold text-zinc-900 dark:text-white whitespace-nowrap">
                  {rp(val)} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SalesCategoryCharts({ groups, trend, totalOmset }: SalesCategoryChartsProps) {
  const pieData = groups
    .filter((g) => g.omset > 0)
    .map((g) => ({
      ...g,
      pct: totalOmset > 0 ? Math.round((g.omset / totalOmset) * 100) : 0,
      color: GROUP_COLOR[g.group],
    }));

  const totalItemsSold = groups.reduce((sum, g) => sum + g.qty, 0);

  const activeBarKeys = (
    ['LCD', 'Sparepart', 'Aksesoris', 'Jasa Service', 'Lainnya'] as SalesGroupKey[]
  ).filter((key) => {
    if (key === 'LCD' || key === 'Sparepart' || key === 'Aksesoris') return true;
    return trend.some((pt) => pt[key] > 0);
  });

  const trendChartData = trend.map((pt) => ({
    ...pt,
    label: formatShortDay(pt.tgl),
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Donut Proportion Chart */}
      <div className="lg:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex flex-col justify-between">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
            Persentase Penjualan per Kategori
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Porsi omset LCD, Sparepart, dan Aksesoris pada periode terpilih.
          </p>
        </div>

        {totalOmset <= 0 || pieData.length === 0 ? (
          <div className="h-[220px] flex flex-col items-center justify-center text-center px-4">
            <div className="w-28 h-28 rounded-full border-[10px] border-zinc-100 dark:border-zinc-800 flex items-center justify-center">
              <span className="text-xs font-semibold font-data text-zinc-400">0%</span>
            </div>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Belum ada omset penjualan pada periode ini.
            </p>
          </div>
        ) : (
          <div className="mt-3 flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-4">
            <div className="relative w-full max-w-[200px] h-[190px] shrink-0 mx-auto">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="omset"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={54}
                    outerRadius={80}
                    paddingAngle={pieData.length > 1 ? 2 : 0}
                    stroke="none"
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.group} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieCustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Total
                </span>
                <span className="text-xs sm:text-sm font-extrabold font-data text-zinc-900 dark:text-white leading-tight">
                  {formatCompactRp(totalOmset)}
                </span>
                <span className="text-[10px] font-data text-zinc-500 dark:text-zinc-400">
                  {totalItemsSold} item
                </span>
              </div>
            </div>

            <div className="w-full flex-1 space-y-2">
              {groups.map((g) => {
                const pct = totalOmset > 0 ? Math.round((g.omset / totalOmset) * 100) : 0;
                return (
                  <div
                    key={g.group}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: GROUP_COLOR[g.group] }}
                      />
                      <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                        {GROUP_SHORT[g.group]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 font-data whitespace-nowrap">
                      <span className="font-bold text-zinc-900 dark:text-white">{pct}%</span>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        ({formatCompactRp(g.omset)})
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Stacked Daily Revenue Trend Chart */}
      <div className="lg:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex flex-col justify-between">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
              Tren Omset Harian per Kelompok
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Perbandingan kontribusi omset harian antar kelompok penjualan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
            {activeBarKeys.map((key) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: GROUP_COLOR[key] }}
                />
                {GROUP_SHORT[key]}
              </span>
            ))}
          </div>
        </div>

        {trendChartData.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400">
            Belum ada grafik tren harian pada periode ini.
          </div>
        ) : (
          <div className="mt-3 w-full h-[220px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart
                data={trendChartData}
                margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                barCategoryGap="24%"
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
                  tickFormatter={(v) => formatCompactRp(Number(v))}
                  tick={{ fontSize: 11, fill: '#71717a' }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(161, 161, 170, 0.12)' }}
                  content={<BarCustomTooltip />}
                />
                {activeBarKeys.map((key, idx) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="omset"
                    fill={GROUP_COLOR[key]}
                    maxBarSize={44}
                    radius={idx === activeBarKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
