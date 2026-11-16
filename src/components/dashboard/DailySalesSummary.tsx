import { ArrowUpRight, ReceiptText, ShoppingBag, TrendingUp } from 'lucide-react';
import { fmtDate, isoDate, rp } from '../../utils/format';

interface DailySalesSummaryProps {
  totalTransactions: number;
  totalRevenue: number;
  profit: number;
  grossProfit?: number;
  expenses?: number;
  isOwner: boolean;
  canOpenSales?: boolean;
  canOpenReport?: boolean;
  onOpenSales?: () => void;
  onOpenReport?: () => void;
}

export function DailySalesSummary({
  totalTransactions,
  totalRevenue,
  profit,
  grossProfit,
  expenses = 0,
  isOwner,
  canOpenSales = false,
  canOpenReport = false,
  onOpenSales,
  onOpenReport,
}: DailySalesSummaryProps) {
  const todayLabel = fmtDate(isoDate());
  const avgPerTx = totalTransactions > 0 ? Math.round(totalRevenue / totalTransactions) : 0;

  return (
    <section
      aria-label="Ringkasan Penjualan Harian"
      className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm shadow-zinc-900/[0.03] overflow-hidden"
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-white">
            Ringkasan Penjualan Hari Ini
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 font-data">
            {todayLabel} · Data transaksi aktif hari ini
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canOpenSales && onOpenSales && (
            <button
              type="button"
              onClick={onOpenSales}
              className="min-h-[36px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1 transition-colors"
            >
              <span>Buka Kasir</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
          {canOpenReport && onOpenReport && (
            <button
              type="button"
              onClick={onOpenReport}
              className="min-h-[36px] px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold inline-flex items-center gap-1 transition-colors"
            >
              <span>Laporan</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-100 dark:divide-zinc-800">
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Total Transaksi
            </span>
            <ReceiptText className="w-4 h-4 text-zinc-400 dark:text-zinc-500 shrink-0" />
          </div>
          <div className="mt-2 text-2xl font-extrabold font-data text-zinc-900 dark:text-white tracking-tight">
            {totalTransactions} <span className="text-sm font-semibold text-zinc-500">nota</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 font-data">
            {totalTransactions > 0 ? `Rata-rata ${rp(avgPerTx)} / nota` : 'Belum ada transaksi hari ini'}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Total Pendapatan
            </span>
            <ShoppingBag className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
          </div>
          <div className="mt-2 text-2xl font-extrabold font-data text-zinc-900 dark:text-white tracking-tight">
            {rp(totalRevenue)}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Omzet penjualan bersih hari ini
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Laba Hari Ini
            </span>
            <TrendingUp
              className={`w-4 h-4 shrink-0 ${
                !isOwner
                  ? 'text-zinc-400 dark:text-zinc-500'
                  : profit >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
              }`}
            />
          </div>
          {isOwner ? (
            <>
              <div
                className={`mt-2 text-2xl font-extrabold font-data tracking-tight ${
                  profit >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {rp(profit)}
              </div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 font-data">
                {grossProfit !== undefined
                  ? `Kotor ${rp(grossProfit)} − Biaya ${rp(expenses)}`
                  : 'Laba bersih setelah HPP & biaya'}
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 text-lg font-bold text-zinc-400 dark:text-zinc-500">
                Khusus Owner
              </div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Data HPP &amp; laba hanya tampil untuk Owner
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
