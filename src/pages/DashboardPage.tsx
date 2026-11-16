import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  Loader2,
  PackagePlus,
  Receipt,
  RefreshCw,
  Search,
  ShoppingCart,
  Tag,
  TrendingUp,
} from 'lucide-react';
import { callApi, getAuthHeaders } from '../services/api';
import type { DashboardData, PageId, Product, Session, TransactionNote } from '../types/pos';
import { fmtDate, rp } from '../utils/format';
import { Modal } from '../components/ui/Dialog';
import { StockStatusText } from '../components/ui/ProductDetailModal';
import { DailySalesSummary } from '../components/dashboard/DailySalesSummary';

interface DashboardPageProps {
  session: Session;
  products: Product[];
  refreshKey?: number;
  canSearch: boolean;
  canAccess: (page: PageId) => boolean;
  onNavigate: (page: PageId) => void;
  onGoLowStock: () => void;
  onGoOutStock: () => void;
  onQuickRestock: (items: Product[]) => void;
  onOpenNote: (note: TransactionNote) => void;
  onToast?: (msg: string, type?: 'ok' | 'warn' | 'err' | 'info') => void;
}

interface GroundingSource {
  title: string;
  uri: string;
}

interface MarketInfoResult {
  summary: string;
  sources: GroundingSource[];
  queries: string[];
  fallback?: boolean;
  notice?: string;
}

const THRESHOLD_OPTIONS = [3, 5, 10] as const;

function getSavedThreshold(): number {
  try {
    const raw = Number(localStorage.getItem('sahabat_min_stock_threshold'));
    if (THRESHOLD_OPTIONS.includes(raw as (typeof THRESHOLD_OPTIONS)[number])) {
      return raw;
    }
  } catch {
    // ignore
  }
  return 3;
}

function renderInlineBold(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-bold text-zinc-900 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

function MarketSummaryBody({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-200 leading-relaxed break-words [overflow-wrap:anywhere]">
      {lines.map((line, idx) => {
        const bulletMatch = line.match(/^([-*]|\d+\.)\s+(.*)$/);
        if (bulletMatch) {
          return (
            <div key={idx} className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              <p className="min-w-0 flex-1">{renderInlineBold(bulletMatch[2])}</p>
            </div>
          );
        }
        return <p key={idx}>{renderInlineBold(line)}</p>;
      })}
    </div>
  );
}

export function DashboardPage({
  session,
  products,
  refreshKey = 0,
  canSearch,
  canAccess,
  onNavigate,
  onGoLowStock,
  onGoOutStock,
  onQuickRestock,
  onOpenNote,
  onToast,
}: DashboardPageProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null);

  const [minThreshold, setMinThreshold] = useState<number>(() => getSavedThreshold());
  const [stockTab, setStockTab] = useState<'all' | 'out' | 'thin'>('all');
  const [showAllLowStock, setShowAllLowStock] = useState(false);

  const [marketProduct, setMarketProduct] = useState<Product | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [marketData, setMarketData] = useState<MarketInfoResult | null>(null);
  const [marketCache, setMarketCache] = useState<Record<string, MarketInfoResult>>({});

  const isOwner = session.role === 'owner';
  const canPurchase = canAccess('purchase');
  const canManageProduct = canAccess('product');
  const canRestockAction = canPurchase || canManageProduct || canSearch;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await callApi<DashboardData>('dashboard', {}, session);
      setData(res);
    } catch (err) {
      setError((err as Error).message || 'Gagal memuat dashboard');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleChangeThreshold = (next: number) => {
    setMinThreshold(next);
    setShowAllLowStock(false);
    try {
      localStorage.setItem('sahabat_min_stock_threshold', String(next));
    } catch {
      // ignore
    }
  };

  const handleOpenRecent = async (no: string) => {
    try {
      const note = await callApi<TransactionNote>('getSale', { no }, session);
      onOpenNote(note);
    } catch (err) {
      onToast?.((err as Error).message || 'Gagal membuka detail nota', 'err');
    }
  };

  const fetchMarketInfo = useCallback(
    async (product: Product, forceRefresh = false) => {
      setMarketProduct(product);
      setMarketError('');

      const cached = marketCache[product.kode];
      if (cached && !forceRefresh) {
        setMarketData(cached);
        setMarketLoading(false);
        return;
      }

      setMarketData(null);
      setMarketLoading(true);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch('/api/restock-market-info', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            kode: product.kode,
            productName: product.nama,
            category: product.kategori,
            tipe: product.tipe,
            currentHpp: isOwner ? product.hpp || 0 : 0,
            harga: product.harga || 0,
            hargaA: product.harga_a || 0,
            hargaMin: product.harga_min || 0,
            forceRefresh,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as Partial<MarketInfoResult> & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(payload.error || `Gagal memeriksa harga pasar (${res.status})`);
        }
        const normalized: MarketInfoResult = {
          summary: payload.summary || 'Informasi harga pasar tidak tersedia.',
          sources: Array.isArray(payload.sources) ? payload.sources : [],
          queries: Array.isArray(payload.queries) ? payload.queries : [],
          fallback: Boolean(payload.fallback),
          notice: payload.notice,
        };
        setMarketData(normalized);
        setMarketCache((prev) => ({ ...prev, [product.kode]: normalized }));
      } catch (err) {
        setMarketError(
          err instanceof Error ? err.message : 'Gagal menghubungi layanan pencarian harga pasar.',
        );
      } finally {
        setMarketLoading(false);
      }
    },
    [isOwner, marketCache],
  );

  const lowStockStats = useMemo(() => {
    const tracked = products.filter((p) => !p.jasa && p.stok <= minThreshold);
    tracked.sort((a, b) => {
      const aOut = a.stok <= 0 ? 0 : 1;
      const bOut = b.stok <= 0 ? 0 : 1;
      if (aOut !== bOut) return aOut - bOut;
      if (a.stok !== b.stok) return a.stok - b.stok;
      return a.nama.localeCompare(b.nama, 'id');
    });
    const outItems = tracked.filter((p) => p.stok <= 0);
    const thinItems = tracked.filter((p) => p.stok > 0);
    return {
      all: tracked,
      out: outItems,
      thin: thinItems,
    };
  }, [products, minThreshold]);

  const filteredLowItems = useMemo(() => {
    if (stockTab === 'out') return lowStockStats.out;
    if (stockTab === 'thin') return lowStockStats.thin;
    return lowStockStats.all;
  }, [lowStockStats, stockTab]);

  const visibleLowItems = showAllLowStock ? filteredLowItems : filteredLowItems.slice(0, 6);
  const lowCountDisplay = products.length > 0 ? lowStockStats.all.length : data?.low ?? 0;

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: isOwner ? 5 : 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 animate-pulse"
            />
          ))}
        </div>
        <div className="h-64 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 text-center shadow-sm">
        <p className="text-sm text-rose-600 dark:text-rose-400 font-medium mb-4">{error}</p>
        <button
          type="button"
          onClick={load}
          className="min-h-[44px] px-5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold inline-flex items-center gap-2 shadow-sm shadow-red-600/20"
        >
          <RefreshCw className="w-4 h-4" /> Coba lagi
        </button>
      </div>
    );
  }

  if (!data) return null;

  const maxWeek = Math.max(1, ...data.week.map((w) => w.total));
  const activeDayIdx =
    selectedDayIdx !== null && data.week[selectedDayIdx]
      ? selectedDayIdx
      : Math.max(0, data.week.length - 1);
  const selectedDay = data.week[activeDayIdx];

  const quickActions: { id: PageId; label: string; icon: typeof ShoppingCart; primary?: boolean }[] = [
    ...(canAccess('sales')
      ? [{ id: 'sales' as const, label: 'Transaksi Penjualan', icon: ShoppingCart, primary: true }]
      : []),
    ...(canAccess('search')
      ? [{ id: 'search' as const, label: 'Cek Harga & Stok', icon: Search }]
      : []),
    ...(canAccess('purchase')
      ? [{ id: 'purchase' as const, label: 'Pembelian', icon: PackagePlus }]
      : []),
    ...(canAccess('product')
      ? [{ id: 'product' as const, label: 'Kelola Produk', icon: Tag }]
      : []),
    ...(canAccess('report')
      ? [{ id: 'report' as const, label: 'Laporan', icon: BarChart3 }]
      : []),
  ];

  const restockButtonLabel = canPurchase
    ? 'Restok'
    : canManageProduct
      ? 'Kelola'
      : 'Cek Stok';

  return (
    <div className="space-y-4">
      {quickActions.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
          {quickActions.map((act) => {
            const Icon = act.icon;
            return (
              <button
                key={act.id}
                type="button"
                onClick={() => onNavigate(act.id)}
                className={`shrink-0 min-h-[42px] px-4 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 whitespace-nowrap transition-all ${
                  act.primary
                    ? 'bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 text-white shadow-sm shadow-red-600/25'
                    : 'bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 shadow-sm shadow-zinc-900/[0.02]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{act.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-4 shadow-sm shadow-zinc-900/[0.03]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Penjualan Hari Ini
            </span>
            <span className="w-7 h-7 rounded-lg bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
              <ShoppingCart className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="mt-2 text-lg sm:text-xl font-extrabold text-zinc-900 dark:text-white font-data">
            {rp(data.sales)}
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-4 shadow-sm shadow-zinc-900/[0.03]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Pembelian Hari Ini
            </span>
            <span className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center justify-center shrink-0">
              <PackagePlus className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="mt-2 text-lg sm:text-xl font-extrabold text-zinc-900 dark:text-white font-data">
            {rp(data.purch)}
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-4 shadow-sm shadow-zinc-900/[0.03]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Biaya Operasional
            </span>
            <span className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center justify-center shrink-0">
              <Receipt className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="mt-2 text-lg sm:text-xl font-extrabold text-zinc-900 dark:text-white font-data">
            {rp(data.exp)}
          </div>
        </div>

        {isOwner && (
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-4 shadow-sm shadow-zinc-900/[0.03]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Estimasi Laba
              </span>
              <span
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  data.profit >= 0
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                    : 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
              </span>
            </div>
            <div
              className={`mt-2 text-lg sm:text-xl font-extrabold font-data ${
                data.profit >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {rp(data.profit)}
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={!canSearch}
          onClick={onGoLowStock}
          className={`text-left rounded-2xl bg-white dark:bg-zinc-900 border p-4 transition-colors col-span-2 md:col-span-1 shadow-sm shadow-zinc-900/[0.03] ${
            lowCountDisplay > 0
              ? 'border-amber-300 dark:border-amber-700 hover:bg-amber-50/50 dark:hover:bg-amber-950/20'
              : 'border-zinc-200/80 dark:border-zinc-800'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>Stok Menipis (≤ {minThreshold})</span>
            <span
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                lowCountDisplay > 0
                  ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
              }`}
            >
              {canSearch && lowCountDisplay === 0 ? (
                <ArrowRight className="w-3.5 h-3.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5" />
              )}
            </span>
          </div>
          <div
            className={`mt-2 text-lg sm:text-xl font-extrabold font-data ${
              lowCountDisplay > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-zinc-900 dark:text-white'
            }`}
          >
            {lowCountDisplay} barang
          </div>
        </button>
      </div>

      <DailySalesSummary
        totalTransactions={data.todayTxCount ?? 0}
        totalRevenue={data.sales}
        profit={data.profit}
        grossProfit={data.sales - (data.todayHpp ?? 0)}
        expenses={data.exp}
        isOwner={isOwner}
        canOpenSales={canAccess('sales')}
        canOpenReport={canAccess('report')}
        onOpenSales={() => onNavigate('sales')}
        onOpenReport={() => onNavigate('report')}
      />

      {/* Low-stock summary & quick restock widget */}
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-4 sm:p-5 shadow-sm shadow-zinc-900/[0.03]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-start gap-3">
            <span
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                lowStockStats.out.length > 0
                  ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400'
                  : lowStockStats.all.length > 0
                    ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400'
                    : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {lowStockStats.all.length > 0 ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-white">
                  Ringkasan Stok Minimum & Restok
                </h2>
                {lowStockStats.out.length > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-800 text-[11px] font-bold text-rose-700 dark:text-rose-300 font-data">
                    {lowStockStats.out.length} Habis
                  </span>
                )}
                {lowStockStats.thin.length > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 text-[11px] font-bold text-amber-800 dark:text-amber-300 font-data">
                    {lowStockStats.thin.length} Menipis
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Pantau barang dengan stok ≤ {minThreshold} unit dan langsung masukkan ke daftar restok.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl px-2.5 min-h-[38px]">
              <span>Batas</span>
              <select
                value={minThreshold}
                onChange={(e) => handleChangeThreshold(Number(e.target.value))}
                aria-label="Batas stok minimum"
                className="bg-transparent font-bold text-zinc-900 dark:text-white focus:outline-none cursor-pointer"
              >
                {THRESHOLD_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} className="bg-white dark:bg-zinc-900">
                    ≤ {opt} unit
                  </option>
                ))}
              </select>
            </label>

            {canSearch && (
              <button
                type="button"
                onClick={stockTab === 'out' ? onGoOutStock : onGoLowStock}
                className="min-h-[38px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5 transition-colors"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{stockTab === 'out' ? 'Lihat Stok Habis' : 'Cek Stok'}</span>
              </button>
            )}

            {canPurchase && filteredLowItems.length > 0 && (
              <button
                type="button"
                onClick={() => onQuickRestock(filteredLowItems)}
                className="min-h-[38px] px-3.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm shadow-red-600/20 transition-all"
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>Restok Semua ({filteredLowItems.length})</span>
              </button>
            )}
          </div>
        </div>

        {lowStockStats.all.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {[
              { id: 'all' as const, label: 'Semua', count: lowStockStats.all.length },
              { id: 'out' as const, label: 'Stok Kosong', count: lowStockStats.out.length },
              { id: 'thin' as const, label: `Menipis (1–${minThreshold})`, count: lowStockStats.thin.length },
            ].map((tab) => {
              const active = stockTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setStockTab(tab.id);
                    setShowAllLowStock(false);
                  }}
                  className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${
                    active
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-700'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[11px] font-data ${
                      active
                        ? 'bg-white/20 text-white dark:bg-zinc-900/15 dark:text-zinc-900'
                        : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-3">
          {products.length === 0 ? (
            <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 py-6 text-center">
              Memuat daftar stok produk...
            </p>
          ) : lowStockStats.all.length === 0 ? (
            <div className="rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs sm:text-sm text-emerald-800 dark:text-emerald-300 font-medium">
                Semua stok barang aman di atas batas minimum (&gt; {minThreshold} unit).
              </div>
              {canPurchase && (
                <button
                  type="button"
                  onClick={() => onNavigate('purchase')}
                  className="self-start sm:self-auto min-h-[36px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                >
                  <PackagePlus className="w-3.5 h-3.5" />
                  <span>Buka Pembelian</span>
                </button>
              )}
            </div>
          ) : filteredLowItems.length === 0 ? (
            <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 py-5 text-center">
              Tidak ada barang pada filter ini.
            </p>
          ) : (
            <>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-100 dark:border-zinc-800 rounded-xl overflow-hidden">
                {visibleLowItems.map((p) => {
                  const isOut = p.stok <= 0;
                  return (
                    <div
                      key={p.kode}
                      className={`p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors ${
                        isOut
                          ? 'bg-rose-50/60 dark:bg-rose-950/20'
                          : 'bg-white dark:bg-zinc-900 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start gap-2">
                          <span className="text-sm font-bold text-zinc-900 dark:text-white leading-snug break-words [overflow-wrap:anywhere] min-w-0">
                            {p.nama}
                          </span>
                          <span className="shrink-0">
                            <StockStatusText product={p} compact />
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          <span className="font-data">{p.kode}</span>
                          {p.kategori && <span>· {p.kategori}</span>}
                          {p.supplier && <span>· Supplier: {p.supplier}</span>}
                          {isOwner && (
                            <span className="font-data text-zinc-700 dark:text-zinc-300 font-semibold">
                              · HPP {rp(p.hpp || 0)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => fetchMarketInfo(p)}
                          className="min-h-[36px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5 transition-colors"
                          title="Cek referensi harga pasar & ketersediaan online"
                        >
                          <Globe className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                          <span>Harga Pasar</span>
                        </button>

                        {canRestockAction && (
                          <button
                            type="button"
                            onClick={() => onQuickRestock([p])}
                            className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${
                              isOut
                                ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm shadow-rose-600/20'
                                : 'bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900'
                            }`}
                          >
                            <PackagePlus className="w-3.5 h-3.5" />
                            <span>{restockButtonLabel}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {filteredLowItems.length > 6 && (
                <div className="mt-2.5 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setShowAllLowStock((prev) => !prev)}
                    className="min-h-[36px] px-3.5 rounded-xl text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 transition-colors"
                  >
                    {showAllLowStock ? (
                      <>
                        <ChevronUp className="w-4 h-4" />
                        <span>Tampilkan lebih sedikit</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" />
                        <span>Tampilkan semua ({filteredLowItems.length} barang)</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-4 sm:p-5 shadow-sm shadow-zinc-900/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white">
                Penjualan 7 Hari Terakhir
              </h2>
              {selectedDay && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-data mt-0.5">
                  {fmtDate(selectedDay.tgl)}:{' '}
                  <span className="font-bold text-zinc-900 dark:text-white">
                    {rp(selectedDay.total)}
                  </span>
                </p>
              )}
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-data">
              Total {rp(data.week.reduce((a, b) => a + b.total, 0))}
            </span>
          </div>

          <div className="h-48 flex items-end gap-1.5 sm:gap-3 pt-4">
            {data.week.map((day, idx) => {
              const heightPct = day.total > 0 ? Math.max(8, Math.round((day.total / maxWeek) * 100)) : 4;
              const isToday = idx === data.week.length - 1;
              const isSelected = idx === activeDayIdx;
              return (
                <button
                  key={day.tgl}
                  type="button"
                  onClick={() => setSelectedDayIdx(idx)}
                  className="flex-1 h-full flex flex-col justify-end items-center group focus:outline-none"
                  title={`${fmtDate(day.tgl)}: ${rp(day.total)}`}
                >
                  <span
                    className={`text-[10px] font-data mb-1 transition-opacity truncate max-w-full ${
                      isSelected
                        ? 'opacity-100 font-bold text-zinc-800 dark:text-zinc-100'
                        : 'opacity-0 group-hover:opacity-100 text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {day.total > 0 ? Math.round(day.total / 1000) + 'k' : '0'}
                  </span>
                  <div className="w-full flex-1 flex items-end justify-center">
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full max-w-[44px] rounded-t-lg transition-all ${
                        isSelected
                          ? isToday
                            ? 'bg-gradient-to-t from-red-600 to-rose-500 ring-2 ring-red-300 dark:ring-red-800'
                            : 'bg-zinc-800 dark:bg-zinc-200 ring-2 ring-zinc-300 dark:ring-zinc-700'
                          : isToday
                            ? 'bg-gradient-to-t from-red-600/90 to-rose-500/90'
                            : day.total > 0
                              ? 'bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600'
                              : 'bg-zinc-100 dark:bg-zinc-800/70'
                      }`}
                    />
                  </div>
                  <span
                    className={`mt-2 text-[11px] font-data ${
                      isSelected
                        ? 'font-bold text-zinc-900 dark:text-white'
                        : isToday
                          ? 'font-semibold text-red-600 dark:text-red-400'
                          : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {fmtDate(day.tgl).slice(0, 5)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-5 shadow-sm shadow-zinc-900/[0.03]">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-3">
            Barang Terlaris
          </h2>
          {data.top.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 py-8 text-center">
              Belum ada data penjualan.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.top.map((item, i) => (
                <div key={item.nama} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`text-xs font-data w-5 h-5 rounded-md flex items-center justify-center shrink-0 font-bold ${
                        i === 0
                          ? 'bg-red-600 text-white'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                      {item.nama}
                    </span>
                  </div>
                  <span className="text-sm font-bold font-data text-zinc-900 dark:text-white shrink-0">
                    {item.qty} pcs
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-5 shadow-sm shadow-zinc-900/[0.03]">
        <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-3">
          Penjualan Terbaru
        </h2>
        {data.recent.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 py-6 text-center">
            Belum ada transaksi penjualan.
          </p>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-left text-xs text-zinc-500 dark:text-zinc-400">
                    <th className="py-2.5 pr-4 font-semibold">No. Nota</th>
                    <th className="py-2.5 pr-4 font-semibold">Tanggal</th>
                    <th className="py-2.5 pr-4 font-semibold">Konsumen</th>
                    <th className="py-2.5 font-semibold text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {data.recent.map((row) => (
                    <tr
                      key={row.no}
                      onClick={() => handleOpenRecent(row.no)}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-800/60 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 pr-4 font-data font-semibold text-red-600 dark:text-red-400">
                        {row.no}
                      </td>
                      <td className="py-2.5 pr-4 font-data text-zinc-600 dark:text-zinc-300">
                        {fmtDate(row.tgl)}
                      </td>
                      <td className="py-2.5 pr-4 text-zinc-800 dark:text-zinc-200">
                        {row.konsumen}
                      </td>
                      <td className="py-2.5 text-right font-data font-bold text-zinc-900 dark:text-white">
                        {rp(row.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.recent.map((row) => (
                <button
                  key={row.no}
                  type="button"
                  onClick={() => handleOpenRecent(row.no)}
                  className="w-full py-3 flex items-center justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-zinc-900 dark:text-white truncate">
                      {row.konsumen}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 font-data">
                      <span className="text-red-600 dark:text-red-400 font-semibold">{row.no}</span> · {fmtDate(row.tgl)}
                    </div>
                  </div>
                  <div className="font-data font-bold text-sm text-zinc-900 dark:text-white shrink-0">
                    {rp(row.total)}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {marketProduct && (
        <Modal
          title="Referensi Harga Pasar & Restok"
          onClose={() => setMarketProduct(null)}
          maxWidth="max-w-lg"
        >
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200/80 dark:border-zinc-700 p-3 mb-4">
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm text-zinc-900 dark:text-white leading-snug break-words [overflow-wrap:anywhere]">
                  {marketProduct.nama}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 flex flex-wrap gap-x-2">
                  <span className="font-data">{marketProduct.kode}</span>
                  {marketProduct.kategori && <span>· {marketProduct.kategori}</span>}
                  {marketProduct.tipe && <span>· {marketProduct.tipe}</span>}
                </div>
              </div>
              <div className="shrink-0">
                <StockStatusText product={marketProduct} compact />
              </div>
            </div>
            {isOwner && (
              <div className="mt-2.5 pt-2 border-t border-zinc-200/70 dark:border-zinc-700 text-xs text-zinc-600 dark:text-zinc-300 flex items-center justify-between">
                <span>HPP Toko Saat Ini</span>
                <span className="font-data font-bold text-zinc-900 dark:text-white">
                  {rp(marketProduct.hpp || 0)}
                </span>
              </div>
            )}
          </div>

          {marketLoading ? (
            <div className="py-10 flex flex-col items-center justify-center text-center gap-3">
              <Loader2 className="w-6 h-6 text-red-600 animate-spin" />
              <div className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-300 font-medium">
                Menelusuri referensi harga pasar &amp; ketersediaan terbaru...
              </div>
            </div>
          ) : marketError ? (
            <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 p-4 text-center">
              <p className="text-xs sm:text-sm text-rose-700 dark:text-rose-300 font-medium mb-3 break-words">
                {marketError}
              </p>
              <button
                type="button"
                onClick={() => fetchMarketInfo(marketProduct, true)}
                className="min-h-[38px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Coba Lagi</span>
              </button>
            </div>
          ) : marketData ? (
            <div className="space-y-4">
              {marketData.notice && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  {marketData.notice}
                </div>
              )}

              <MarketSummaryBody text={marketData.summary} />

              {marketData.sources.length > 0 && (
                <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800">
                  <div className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                    {marketData.fallback ? 'Cek Harga di Marketplace & Web' : 'Sumber Google Search'}
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {marketData.sources.map((src) => (
                      <a
                        key={src.uri}
                        href={src.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/70 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200/70 dark:border-zinc-700/80 text-xs transition-colors"
                      >
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                          {src.title}
                        </span>
                        <ExternalLink className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {marketData.queries.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span>Kata kunci:</span>
                  {marketData.queries.map((q) => (
                    <span
                      key={q}
                      className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                    >
                      {q}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2.5">
            <button
              type="button"
              disabled={marketLoading}
              onClick={() => fetchMarketInfo(marketProduct, true)}
              className="min-h-[42px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${marketLoading ? 'animate-spin' : ''}`} />
              <span>Perbarui</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMarketProduct(null)}
                className="min-h-[42px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Tutup
              </button>
              {canRestockAction && (
                <button
                  type="button"
                  onClick={() => {
                    const target = marketProduct;
                    setMarketProduct(null);
                    onQuickRestock([target]);
                  }}
                  className="min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 text-white text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm shadow-red-600/20"
                >
                  <PackagePlus className="w-4 h-4" />
                  <span>{canPurchase ? 'Lanjut Restok' : restockButtonLabel}</span>
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
